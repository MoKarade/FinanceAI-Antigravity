// cloudrun/proxy/relais.mjs
// Relais same-origin de FinanceAI sur Cloud Run (derrière Firebase Hosting : `/api/**` → service `financeai-proxy`).
// Portage FIDÈLE de `api/_lib/proxies.ts` + `api/_lib/garde.ts` (anciennes fonctions Vercel) en JS ESM pur, sans dépendance :
// chaque relais est une LISTE BLANCHE (hôte amont fixe, paramètres validés un à un, GET seulement, délai borné, aucun cookie).
// Ajouts propres à Cloud Run : garde d'origine (liste fermée), refus d'un appel Fintable sans jeton `Bearer`.
// Le jeton Fintable vient du navigateur (`Authorization: Bearer …`), il est relayé tel quel, JAMAIS stocké ni journalisé.
// Aucun secret, aucune variable d'environnement secrète.

const DELAI_AMONT_MS = 15_000;
const DEBIT_PROXY_PAR_MIN = 120;
const UA = 'Mozilla/5.0 (compatible; FinanceAI/1.0)';
const FENETRE_MS = 60_000;
const COMPTEURS_MAX = 2_000;

/** Origines autorisées (navigateur). Un appel sans en-tête `Origin` (GET same-origin, curl) reste accepté. */
export const ORIGINES_AUTORISEES = new Set([
    'https://finance.hubperso.com',
    'https://financeai-497112.web.app',
    'https://financeai-497112.firebaseapp.com',
]);
const ORIGINE_LOCALE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

// ─── Débit : fenêtre fixe, mémoire bornée, éviction par ancienneté (cf. api/_lib/garde.ts) ──────────────

const compteurs = new Map();

/** Tests uniquement. */
export function reinitialiserLimites() {
    compteurs.clear();
}

function poser(cle, valeur, maintenant) {
    compteurs.delete(cle);
    if (compteurs.size >= COMPTEURS_MAX) {
        for (const [k, v] of compteurs) if (v.debut + FENETRE_MS <= maintenant) compteurs.delete(k);
        while (compteurs.size >= COMPTEURS_MAX) {
            const plusAncien = compteurs.keys().next().value;
            if (plusAncien === undefined) break;
            compteurs.delete(plusAncien);
        }
    }
    compteurs.set(cle, valeur);
}

function essayerDebit(cle, max, maintenant = Date.now()) {
    const c = compteurs.get(cle);
    if (!c || c.debut + FENETRE_MS <= maintenant) {
        poser(cle, { debut: maintenant, n: 1 }, maintenant);
        return { ok: true };
    }
    if (c.n >= max) return { ok: false, retryApresSec: Math.max(1, Math.ceil((c.debut + FENETRE_MS - maintenant) / 1000)) };
    c.n += 1;
    return { ok: true };
}

/** IP du client : premier saut de `x-forwarded-for` (posé par Firebase Hosting / le frontal Google), sinon `x-real-ip`. */
function ipClient(headers) {
    const candidats = [headers.get('x-forwarded-for')?.split(',')[0], headers.get('x-real-ip')];
    const ip = candidats.map((c) => c?.trim()).find((c) => c);
    return (ip || 'inconnue').slice(0, 64);
}

// ─── Réponses ─────────────────────────────────────────────────────────────────────────────────────────────

// Forme `{ error: { type, message } }` : celle que lit déjà le client Fintable (errorMessage), donc le motif du refus s'affiche.
function erreur(status, message, type = 'proxy_error') {
    return new Response(JSON.stringify({ error: { type, message } }), {
        status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
}

/** Origine autorisée ? `true` si absente (GET same-origin, outil en ligne de commande). */
export function origineAutorisee(headers) {
    // Un navigateur signale lui-même un appel inter-sites : refus même si l'en-tête Origin manque.
    if (headers.get('sec-fetch-site') === 'cross-site') return false;
    const origine = headers.get('origin');
    if (origine === null) return true;
    return ORIGINES_AUTORISEES.has(origine) || ORIGINE_LOCALE.test(origine);
}

/** Garde commune : origine, méthode GET et débit par IP. `null` = tout va bien. */
function garder(request) {
    if (!origineAutorisee(request.headers)) return erreur(403, 'Origine non autorisée.', 'forbidden_origin');
    if (request.method !== 'GET') return erreur(405, 'Méthode non autorisée.');
    const debit = essayerDebit(`px:${ipClient(request.headers)}`, DEBIT_PROXY_PAR_MIN);
    if (!debit.ok) {
        const r = erreur(429, 'Trop de requêtes.');
        r.headers.set('retry-after', String(debit.retryApresSec));
        return r;
    }
    return null;
}

async function relayer(url, headers, request, opts) {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DELAI_AMONT_MS)]);
    let amont;
    try {
        amont = await (opts.fetchImpl ?? fetch)(url, { method: 'GET', headers, signal, redirect: 'error' });
    } catch (e) {
        // Nom d'erreur SEUL : le message brut peut porter l'URL (et donc des paramètres).
        console.error('[proxy] échec amont:', e?.name ?? 'Error');
        return erreur(502, 'Service amont injoignable.');
    }
    const h = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    const ct = amont.headers.get('content-type');
    if (ct) h.set('content-type', ct);
    const ra = amont.headers.get('retry-after');
    if (ra) h.set('retry-after', ra);
    return new Response(amont.body, { status: amont.status, headers: h });
}

// ─── Paramètres : validés un à un ─────────────────────────────────────────────────────────────────────────

const SYMBOLE = /^[A-Za-z0-9.^=\-]{1,24}$/;
const RANGE = /^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|ytd|max)$/;
const INTERVAL = /^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$/;
const ENTIER = /^\d{1,12}$/;

/** Valeur UNIQUE d'un paramètre : `undefined` si absent, `null` si présent plusieurs fois (ambigu → refus). */
function unique(u, cle) {
    const v = u.searchParams.getAll(cle);
    return v.length === 0 ? undefined : v.length === 1 ? v[0] : null;
}

function pris(u, cle, motif) {
    const v = u.searchParams.get(cle);
    if (v === null) return undefined; // absent : sans effet
    return motif.test(v) ? v : null; // présent mais invalide : refus
}

function symboleDuChemin(pathname) {
    const m = /^\/api\/history\/yahoo\/([^/]+)$/.exec(pathname);
    if (!m) return undefined;
    try { return decodeURIComponent(m[1]); } catch { return undefined; }
}

function cheminFintableDuChemin(pathname) {
    const m = /^\/api\/fintable\/(.+)$/.exec(pathname);
    if (!m) return undefined;
    try { return decodeURIComponent(m[1]); } catch { return undefined; }
}

/** GET /api/yahoo/history?symbol=… | /api/history/yahoo/:symbol — &range=…&interval=… | &period1=…&period2=… */
export async function proxyYahooHistorique(request, opts = {}) {
    const refus = garder(request);
    if (refus) return refus;
    const u = new URL(request.url);
    const param = unique(u, 'symbol');
    if (param === null) return erreur(400, 'Symbole ambigu.');
    const symbole = param ?? symboleDuChemin(u.pathname) ?? '';
    if (!SYMBOLE.test(symbole) || /^\.+$/.test(symbole)) return erreur(400, 'Symbole invalide.');
    const q = new URLSearchParams();
    for (const [cle, motif] of [['range', RANGE], ['interval', INTERVAL], ['period1', ENTIER], ['period2', ENTIER]]) {
        const v = pris(u, cle, motif);
        if (v === null) return erreur(400, `Paramètre invalide : ${cle}.`);
        if (v !== undefined) q.set(cle, v);
    }
    return relayer(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbole)}?${q}`,
        { accept: 'application/json', 'user-agent': UA }, request, opts);
}

/** GET /api/yahoo/search | /api/search/yahoo — ?q=…&quotesCount=…&newsCount=…&listsCount=… */
export async function proxyYahooRecherche(request, opts = {}) {
    const refus = garder(request);
    if (refus) return refus;
    const u = new URL(request.url);
    const terme = u.searchParams.get('q') ?? '';
    if (!terme || terme.length > 100) return erreur(400, 'Recherche invalide.');
    const q = new URLSearchParams({ q: terme });
    for (const cle of ['quotesCount', 'newsCount', 'listsCount']) {
        const v = pris(u, cle, /^\d{1,2}$/);
        if (v === null) return erreur(400, `Paramètre invalide : ${cle}.`);
        if (v !== undefined) q.set(cle, v);
    }
    return relayer(`https://query1.finance.yahoo.com/v1/finance/search?${q}`,
        { accept: 'application/json', 'user-agent': UA }, request, opts);
}

const CHEMIN_FINTABLE = /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;
const BEARER = /^Bearer [\x21-\x7E]{1,4096}$/;

/**
 * GET /api/fintable/<chemin sous /api/v2> (ou /api/proxy/fintable?path=…) : les autres paramètres sont relayés tels quels.
 * L'en-tête `Authorization: Bearer <jeton Fintable>` du navigateur est relayé ; il n'est jamais stocké ni journalisé.
 */
export async function proxyFintable(request, opts = {}) {
    const refus = garder(request);
    if (refus) return refus;
    const u = new URL(request.url);
    const param = unique(u, 'path');
    if (param === null) return erreur(400, 'Chemin ambigu.');
    const chemin = param ?? cheminFintableDuChemin(u.pathname) ?? '';
    // Aucun segment « .. » ou « . » : le chemin reste SOUS /api/v2 (pas de remontée vers d'autres routes de l'hôte amont).
    if (!CHEMIN_FINTABLE.test(chemin) || chemin.split('/').some((s) => s === '.' || s === '..')) {
        return erreur(400, 'Chemin invalide.');
    }
    const auth = request.headers.get('authorization');
    if (!auth || !BEARER.test(auth)) return erreur(401, 'Jeton Fintable manquant.', 'unauthorized');
    const q = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (k !== 'path') q.append(k, v);
    return relayer(`https://fintable.io/api/v2/${chemin}${q.size ? `?${q}` : ''}`,
        { accept: 'application/json', authorization: auth }, request, opts);
}

/** Sonde de santé (cf. api/sante.ts). */
function repondreSante(request) {
    const entetes = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Méthode non permise.' }), { status: 405, headers: { ...entetes, allow: 'GET, HEAD' } });
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true }), { status: 200, headers: entetes });
}

/** Aiguillage : mêmes chemins que les réécritures de `vercel.json` et le proxy de dev de `vite.config.ts`. */
export async function traiter(request, opts = {}) {
    const { pathname } = new URL(request.url);
    try {
        if (pathname === '/api/sante') return repondreSante(request);
        if (pathname === '/api/proxy/fintable' || pathname.startsWith('/api/fintable/')) return await proxyFintable(request, opts);
        if (pathname === '/api/yahoo/history' || pathname.startsWith('/api/history/yahoo/')) return await proxyYahooHistorique(request, opts);
        if (pathname === '/api/yahoo/search' || pathname === '/api/search/yahoo') return await proxyYahooRecherche(request, opts);
        return erreur(404, 'Route inconnue.', 'not_found');
    } catch (e) {
        console.error('[proxy] exception non prévue:', e?.name ?? 'Error');
        return erreur(500, 'Erreur interne.');
    }
}
