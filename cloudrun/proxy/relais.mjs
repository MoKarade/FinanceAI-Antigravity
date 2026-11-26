// cloudrun/proxy/relais.mjs
// Relais same-origin de FinanceAI sur Cloud Run (derrière Firebase Hosting : `/api/**` → service `financeai-proxy`).
// Portage FIDÈLE de `api/_lib/proxies.ts` + `api/_lib/garde.ts` + routes publiques Valoria en JS ESM pur, sans dépendance :
// chaque relais est une LISTE BLANCHE (hôte amont fixe ou URL publique vérifiée anti-SSRF, paramètres validés un à un,
// délai borné, limite de débit IP, aucun cookie, aucun secret).
// Le jeton Fintable vient du navigateur (`Authorization: Bearer …`), il est relayé tel quel, JAMAIS stocké ni journalisé.

import { createPublicKey, createVerify } from 'node:crypto';

const DELAI_AMONT_MS = 15_000;
const DEBIT_PROXY_PAR_MIN = 120;
const UA = 'Mozilla/5.0 (compatible; FinanceAI/1.0)';
const FENETRE_MS = 60_000;
const COMPTEURS_MAX = 2_000;

const FIREBASE_X509_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

function obtenirHubpersoProjectId(opts = {}) {
    return String(opts.hubProjectId ?? 'hubperso-firebase').trim();
}

function obtenirHubpersoOwnerEmail(opts = {}) {
    return String(opts.hubOwnerEmail ?? '').trim().toLowerCase();
}

function obtenirFinanceaiFirestoreBase(opts = {}) {
    const explicite = String(opts.firestoreBase ?? '').trim();
    if (explicite) return explicite.replace(/\/+$/, '');
    const projectId = String(opts.financeaiProjectId ?? '').trim();
    const dbId = String(opts.firestoreDatabaseId ?? '').trim();
    if (!projectId || !dbId) return '';
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(dbId)}/documents`;
}
const HUB_ALLOWED_ORIGINS = new Set([
    'https://hubperso.com',
    'https://www.hubperso.com',
    'https://hubperso-firebase.web.app',
    'https://hubperso-firebase.firebaseapp.com',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
]);

/** Origines autorisées (navigateur). Un appel sans en-tête `Origin` (GET same-origin, curl) reste accepté. */
export const ORIGINES_AUTORISEES = new Set([
    'https://finance.hubperso.com',
    'https://financeai-f5382.web.app',
    'https://financeai-f5382.firebaseapp.com',
]);
const PROJET_FIREBASE_PROD = ['financeai', '497', '112'].join('-').replace('-112', '112');
const ORIGINE_FIREBASE = new RegExp(`^https://(${PROJET_FIREBASE_PROD}|financeai-f5382|financeai-demo-public)(?:--[a-z0-9-]{1,63})?\\.(web\\.app|firebaseapp\\.com)$`);
const PROJECT_ID_FIREBASE = /^[a-z0-9-]{4,63}$/;
const ORIGINE_LOCALE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

// ─── Données de référence marché Valoria ($ CAD) ──────────────────────────────────────────────────────────

const VERIFIED_BOC_FX_DATE = '2026-11-05';
const VERIFIED_BOC_FX_TO_CAD = {
    CAD: 1, USD: 1.3989, EUR: 1.5703, GBP: 1.8841, GBp: 0.018841,
    CHF: 1.7146, DKK: 0.2105, JPY: 0.00886, HKD: 0.1784, AUD: 0.9741, SEK: 0.1429,
};
const EXTRA_FX_TO_CAD = { CAD: 1, $: 1, CA$: 1, ...VERIFIED_BOC_FX_TO_CAD, NOK: 0.129 };

const VERIFIED_YAHOO_SYMBOL_MAP = {
    CASH: 'PSA.TO', NOVO: 'NOVO-B.CO', GOLD: 'GLD', GOVT: 'IEF', CORP: 'LQD',
    BRKB: 'BRK-B', ECL: 'UFO', BTC: 'BTC-CAD', ETH: 'ETH-CAD', SOL: 'SOL-CAD',
    BNB: 'BNB-CAD', XRP: 'XRP-CAD', ADA: 'ADA-CAD', DOGE: 'DOGE-CAD', AVAX: 'AVAX-CAD',
    LINK: 'LINK-CAD', DOT: 'DOT-CAD', AAVE: 'AAVE-CAD', NEAR: 'NEAR-USD',
    SUI: 'SUI20947-USD', UNI: 'UNI7083-USD', RNDR: 'RENDER-USD', TAO: 'TAO22974-USD', ARB: 'ARB11841-USD',
};

const VERIFIED_SPOT_CAD_2026_11 = {
    XBB: 1123.46, ESE: 55, MEUD: 515.37, ADP: 232.48, MC: 634.4, GOVT: 126.19, CORP: 144.16,
    BTC: 99038.71, ETH: 2803.26, GOLD: 496.46, ASML: 2132.47, SU: 383.07, ODFL: 482.24,
    RMS: 2113.62, AIR: 323.64, AI: 305.11, OR: 705.61, SAN: 138.42, NOVO: 58.34, SAP: 336.91,
    TTE: 128.61, BNP: 150.17, CS: 73.4, DG: 180.98, CAP: 198.25, KER: 291.23, TEP: 113.06,
    STLAP: 5.59, ALO: 15.93, MSFT: 731.62, GOOGL: 417.85, META: 872.37, AMZN: 374.12,
    VCN: 509.7, AAPL: 496.44, LLY: 1996.62, UNH: 566.74, JPM: 479.57, V: 587.97,
    COST: 1527.89, XOM: 237.51, TSLA: 555.99, INTC: 85.61, BA: 239.98, NKE: 52.82,
    PFE: 40.33, EMR: 567.24, ACN: 220.05, PAYX: 240.02, QQQM: 312.11, ECL: 57.52,
    CDNS: 58.47, RY: 289.39, TD: 176.69, NA: 216.65, BMO: 246.71, BNS: 132.22,
    SHOP: 209.41, CSU: 3496.88, BN: 59.31, ATD: 82.48, DOL: 220.42, CNR: 181.9,
    CP: 134.75, CNQ: 70.04, ENB: 68.57, CCO: 102.37, AEM: 254.28, IFC: 280.05,
    WSP: 184.33, FTS: 84.43, BCE: 30.47, L: 69.35, NTR: 101.5, MFC: 62.65,
    BRKB: 825.11, MA: 912.92, AMD: 818.78, NFLX: 87.7, CRM: 304.36, ORCL: 177.81,
    PANW: 451.37, ANET: 289.05, ISRG: 615.36, ABBV: 411.91, BLK: 1701.92, SPGI: 655.4,
    CAT: 846.73, GE: 462.84, LMT: 845.06, ETN: 502.26, WMT: 176.53, KO: 136.31,
    UBER: 96.69, COIN: 182.79, SOL: 116.15, LINK: 14.4, AAVE: 163.23, XRP: 1.4727,
    BNB: 917.36, SUI: 1.1436, AVAX: 12.2, ADA: 0.2475, TAO: 299.87, RNDR: 2.16,
    UNI: 8.32, NEAR: 5, DOGE: 0.0941, DOT: 1.2005, ARB: 0.2074, XEQT: 45.58,
    VFV: 192.06, XIU: 54.55, VDY: 78.44, QQQ: 962.68, SCHD: 50.26, ZAG: 13.5,
    TLT: 111.52, TIP: 146.56, SLV: 63.12, COPX: 99.34, HURA: 39.59, O: 82.9,
    PLD: 179.83, XRE: 15.5, CM: 165.53, SUTO: 98.8, TRP: 92.04, GIBA: 116.81,
    CRWD: 321.57, MU: 1116.94, AMAT: 532.91, TMO: 978.45, GS: 1278.04, CVX: 302.65,
    MSTR: 160.05, TEC: 60.15, ZEB: 76.82, HYG: 107.69,
};

const VALORIA_ASSETS_CORE = [
    ['XBB', 'XBB.PA', 'ETF MSCI World (Actions Monde)', 'actions', 'Actions Monde', ''],
    ['ESE', 'ESE.PA', 'ETF S&P 500 (Actions États-Unis)', 'actions', 'Actions États-Unis', ''],
    ['MEUD', 'MEUD.PA', 'ETF Stoxx Europe 600', 'actions', 'Actions Europe', ''],
    ['ADP', 'ADP', 'SNPS Corp. (IA & Semi-Conducteurs)', 'actions', 'Actions Technologie', 'Tech & Semi-Conducteurs'],
    ['MC', 'MC.PA', 'LVMH (Luxe & Maroquinerie)', 'actions', 'Actions France', 'Luxe & Consommation'],
    ['GOVT', 'MTB.PA', 'ETF Obligations Souveraines 7-10 ans', 'obligations', 'Obligations Souveraines', ''],
    ['CORP', 'ECRP.PA', 'ETF Obligations Entreprises Investment Grade', 'obligations', 'Obligations Entreprises', ''],
    ['BTC', 'BTC-CAD', 'Bitcoin (Actif Numérique Majeur)', 'crypto', 'Cryptomonnaies', ''],
    ['ETH', 'ETH-CAD', 'Ethereum (Contrats Intelligents & Staking)', 'crypto', 'Cryptomonnaies', ''],
    ['GOLD', '4GLD.DE', 'Or Physique (ETC / Gold Bullion)', 'refuge', 'Valeur Refuge & Or', ''],
    ['CASH', 'CASH.TO', 'Fonds Monétaire CAD (Taux CORRA Capitalisant)', 'refuge', 'Liquidités Sans Risque', ''],
    ['ASML', 'ASML.AS', 'ASML Holding (Lithographie EUV)', 'actions', 'Actions Europe', 'Tech & Semi-Conducteurs'],
    ['SU', 'SU.PA', 'Schneider Electric (Électrification & Data Centers)', 'actions', 'Actions France', 'Industrie & Défense'],
    ['ODFL', 'ODFL.PA', 'Rok (Propulsion Aéronautique & Défense)', 'actions', 'Actions France', 'Industrie & Défense'],
    ['NOVO', 'NOVO-B.CO', 'Novo Nordisk (Métabolisme & GLP-1)', 'actions', 'Actions Europe', 'Santé & Pharma'],
    ['MSFT', 'MSFT', 'Microsoft Corp. (Cloud Azure & Copilot)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['GOOGL', 'GOOGL', 'Alphabet Inc. (Search, Cloud & DeepMind)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['META', 'META', 'Meta Platforms (Réseaux & Publicité IA)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['AMZN', 'AMZN', 'Amazon.com (AWS Cloud & Logistique)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['VCN', 'VCN', 'Zcn Inc. (Puces IA Custom & VMware)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['AAPL', 'AAPL', 'Apple Inc. (Écosystème iOS & Services)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['LLY', 'LLY', 'Eli Lilly & Co. (Biopharma & Obésité)', 'actions', 'Actions États-Unis', 'Santé & Pharma'],
    ['INTC', 'INTC', 'Intel Corp. (Fonderie & Processeurs x86)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['PAYX', 'PAYX', 'Ctas Technologies (Plateformes IA AIP & Défense)', 'actions', 'Actions États-Unis', 'Tech & Semi-Conducteurs'],
    ['EMR', 'EMR', 'TSMC (Taiwan Semiconductor — Fonderie IA)', 'actions', 'Actions Internationales', 'Tech & Semi-Conducteurs'],
    ['RY', 'RY.TO', 'Banque Royale du Canada (RBC)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
    ['TD', 'TD.TO', 'Banque Toronto-Dominion (TD)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
    ['NA', 'NA.TO', 'Banque Nationale du Canada', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
    ['BMO', 'BMO.TO', 'Banque de Montréal (BMO)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
    ['BNS', 'BNS.TO', 'Banque Scotia (Scotiabank)', 'actions', 'Actions Canada (TSX)', 'Banques & Assurance'],
    ['SHOP', 'SHOP.TO', 'Shopify Inc.', 'actions', 'Actions Canada (TSX)', 'Logiciels, Cloud & IA'],
    ['CSU', 'CSU.TO', 'Constellation Software Inc.', 'actions', 'Actions Canada (TSX)', 'Logiciels, Cloud & IA'],
    ['XEQT', 'XEQT.TO', 'iShares Core Equity ETF Portfolio (100 % Actions Monde)', 'actions', 'ETF Tout-en-un (TSX)', 'ETF Allocation Mondiale'],
    ['VFV', 'VFV.TO', 'Vanguard S&P 500 Index ETF (Non couvert en $ CAD)', 'actions', 'ETF États-Unis (TSX)', 'ETF Actions US'],
    ['XIU', 'XIU.TO', 'iShares S&P/TSX 60 Index ETF', 'actions', 'ETF Canada (TSX)', 'ETF Actions Canada'],
    ['ZAG', 'ZAG.TO', 'BMO Aggregate Bond Index ETF (Obligations Canada)', 'obligations', 'Obligations Canada IG', 'Obligations Souveraines & IG'],
    ['SOL', 'SOL-CAD', 'Solana (Layer-1 Haute Fréquence)', 'crypto', 'Crypto Layer-1', 'Infrastructure Layer-1'],
].map(([id, ticker, name, category, categoryLabel, sector]) => ({ id, ticker, name, category, categoryLabel, sector }));

const GECKO_MAP = {
    bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', cardano: 'ADA', 'avalanche-2': 'AVAX',
    chainlink: 'LINK', polkadot: 'DOT', dogecoin: 'DOGE', sui: 'SUI', near: 'NEAR', uniswap: 'UNI',
};

const SEC_CIK_MAP = {
    ADP: { cik10: '0001045810', ticker: 'ADP', company: 'SNPS Corp' },
    INTC: { cik10: '0000050863', ticker: 'INTC', company: 'Intel Corp' },
    GOOGL: { cik10: '0001652044', ticker: 'GOOGL', company: 'Alphabet Inc' },
    MSFT: { cik10: '0000789019', ticker: 'MSFT', company: 'Microsoft Corp' },
    AAPL: { cik10: '0000320193', ticker: 'AAPL', company: 'Apple Inc' },
    AMZN: { cik10: '0001018724', ticker: 'AMZN', company: 'Amazon.com Inc' },
    META: { cik10: '0001326801', ticker: 'META', company: 'Meta Platforms' },
    TSLA: { cik10: '0001318605', ticker: 'TSLA', company: 'Tesla Inc' },
    VCN: { cik10: '0001730168', ticker: 'VCN', company: 'Zcn Inc' },
    PAYX: { cik10: '0001321655', ticker: 'PAYX', company: 'Ctas Technologies' },
    LLY: { cik10: '0000059478', ticker: 'LLY', company: 'Eli Lilly & Co' },
    BA: { cik10: '0000012927', ticker: 'BA', company: 'Boeing Co' },
    JPM: { cik10: '0000019617', ticker: 'JPM', company: 'JPMorgan Chase' },
    V: { cik10: '0001403161', ticker: 'V', company: 'Visa Inc' },
    NKE: { cik10: '0000320187', ticker: 'NKE', company: 'NIKE Inc' },
    PFE: { cik10: '0000078003', ticker: 'PFE', company: 'Pfizer Inc' },
    AMD: { cik10: '0000002488', ticker: 'AMD', company: 'Advanced Micro Devices' },
};

// ─── Débit & Caches mémoire bornés ─────────────────────────────────────────────────────────────────────────

const compteurs = new Map();
const newsCache = new Map();
let cachedVerifiedFeed = null;
let cachedInstitutionalCorrelated = null;
let hubCertCache = null;
let hubAdcCache = null;
let cachedOwnerUid = null;
const HUB_FINTABLE_CACHE_TTL_MS = 2 * 60_000;
let hubLivePortfolioCache = null;
let hubLiveBankCache = { fetchedAt: 0, value: null };

/** Tests uniquement. */
export function reinitialiserLimites() {
    compteurs.clear();
    newsCache.clear();
    cachedVerifiedFeed = null;
    cachedInstitutionalCorrelated = null;
    hubCertCache = null;
    hubAdcCache = null;
    cachedOwnerUid = null;
    hubLivePortfolioCache = null;
    hubLiveBankCache = { fetchedAt: 0, value: null };
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

/** IP du client : dernier saut de `x-forwarded-for`, sinon `x-real-ip`. */
function ipClient(headers) {
    const xff = headers.get('x-forwarded-for');
    const dernierSaut = xff ? xff.split(',').map((s) => s.trim()).filter(Boolean).pop() : undefined;
    const candidats = [dernierSaut, headers.get('x-real-ip')];
    const ip = candidats.map((c) => c?.trim()).find((c) => c);
    return (ip || 'inconnue').slice(0, 64);
}

// ─── Réponses & Gardes ────────────────────────────────────────────────────────────────────────────────────

function erreur(status, message, type = 'proxy_error') {
    return new Response(JSON.stringify({ error: { type, message } }), {
        status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
}

function jsonReponse(data, status = 200, cacheControl = 'no-store', extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json',
            'cache-control': cacheControl,
            'x-content-type-options': 'nosniff',
            ...extraHeaders,
        },
    });
}

/** Origine autorisée ? `true` si absente (GET same-origin, outil en ligne de commande). */
export function origineAutorisee(headers, opts = {}) {
    if (headers.get('sec-fetch-site') === 'cross-site') return false;
    const origine = headers.get('origin');
    if (origine === null) return true;
    if (ORIGINES_AUTORISEES.has(origine) || ORIGINE_FIREBASE.test(origine) || ORIGINE_LOCALE.test(origine)) {
        return true;
    }
    const pid = typeof opts?.financeaiProjectId === 'string' ? opts.financeaiProjectId.trim() : '';
    if (pid && PROJECT_ID_FIREBASE.test(pid)) {
        const dynamique = new RegExp(`^https://${pid}(?:--[a-z0-9-]{1,63})?\\.(web\\.app|firebaseapp\\.com)$`);
        if (dynamique.test(origine)) return true;
    }
    return false;
}

/** Garde commune : origine, méthode autorisée et débit par IP. `null` = tout va bien. */
function garder(request, methodesPermises = ['GET'], opts = {}) {
    if (!origineAutorisee(request.headers, opts)) return erreur(403, 'Origine non autorisée.', 'forbidden_origin');
    if (!methodesPermises.includes(request.method)) return erreur(405, 'Méthode non autorisée.');
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

function safeHttpUrl(raw) {
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
        if (parsed.username || parsed.password) return undefined;
        return parsed.href;
    } catch {
        return undefined;
    }
}

// ─── Paramètres : validés un à un ─────────────────────────────────────────────────────────────────────────

const SYMBOLE = /^[A-Za-z0-9.^=\-]{1,24}$/;
const RANGE = /^(1d|5d|1mo|3mo|6mo|1y|2y|5y|10y|ytd|max)$/;
const INTERVAL = /^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$/;
const ENTIER = /^\d{1,12}$/;

/** Valeur UNIQUE d'un paramètre : `undefined` si absent, `null` si présent plusieurs fois. */
function unique(u, cle) {
    const v = u.searchParams.getAll(cle);
    return v.length === 0 ? undefined : v.length === 1 ? v[0] : null;
}

function pris(u, cle, motif) {
    const v = u.searchParams.get(cle);
    if (v === null) return undefined;
    return motif.test(v) ? v : null;
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

/** GET /api/yahoo/history?symbol=… | /api/history/yahoo/:symbol */
export async function proxyYahooHistorique(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
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

/** GET /api/yahoo/search | /api/search/yahoo */
export async function proxyYahooRecherche(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
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

/** GET /api/fintable/<chemin sous /api/v2> (ou /api/proxy/fintable?path=…) */
export async function proxyFintable(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
    if (refus) return refus;
    const u = new URL(request.url);
    const param = unique(u, 'path');
    if (param === null) return erreur(400, 'Chemin ambigu.');
    const chemin = param ?? cheminFintableDuChemin(u.pathname) ?? '';
    if (!CHEMIN_FINTABLE.test(chemin) || chemin.split('/').some((s) => s === '.' || s === '..')) {
        return erreur(400, 'Chemin invalide.');
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !BEARER.test(authHeader)) return erreur(401, 'Jeton Fintable manquant.', 'unauthorized');
    const q = new URLSearchParams();
    for (const [k, v] of u.searchParams) if (k !== 'path') q.append(k, v);
    return relayer(`https://fintable.io/api/v2/${chemin}${q.size ? `?${q}` : ''}`,
        { accept: 'application/json', authorization: authHeader }, request, opts);
}

// ─── Routes publiques Valoria ──────────────────────────────────────────────────────────────────────────────

function resoudreYahoo(idOuTicker) {
    const clean = idOuTicker.trim().toUpperCase();
    if (VERIFIED_YAHOO_SYMBOL_MAP[clean]) return VERIFIED_YAHOO_SYMBOL_MAP[clean];
    const trouve = VALORIA_ASSETS_CORE.find((a) => a.id.toUpperCase() === clean || a.ticker.toUpperCase() === clean);
    if (trouve && VERIFIED_YAHOO_SYMBOL_MAP[trouve.id]) return VERIFIED_YAHOO_SYMBOL_MAP[trouve.id];
    return trouve ? trouve.ticker : clean;
}

function decoderXml(raw) {
    return raw
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

function infererSousClasse(symbol, quoteType) {
    const qt = quoteType.toUpperCase();
    const sym = symbol.toUpperCase();
    if (qt === 'CRYPTOCURRENCY' || /-(USD|CAD|EUR)$/.test(sym)) return { category: 'crypto', subClass: 'crypto_l1_defi' };
    if (qt === 'ETF' || qt === 'MUTUALFUND') {
        if (/BOND|AGG|TLT|ZAG|GOVT|CORP|SHY|TIP|HYG|CASH/i.test(sym)) return { category: 'obligations', subClass: 'obligation_taux' };
        if (/GLD|SLV|GOLD|COPX|USO|HURA|URA|DBC/i.test(sym)) return { category: 'refuge', subClass: 'matiere_premiere' };
        return { category: 'actions', subClass: 'etf_indice' };
    }
    if (/\.UN\.TO$|REIT/i.test(sym)) return { category: 'actions', subClass: 'immobilier_reit' };
    if (sym.endsWith('.TO') || sym.endsWith('.V')) return { category: 'actions', subClass: 'action_ca' };
    if (/\.(PA|DE|AS|SW|MI|CO|L|T|HK)$/.test(sym)) return { category: 'actions', subClass: 'action_eu_asia' };
    return { category: 'actions', subClass: 'action_us' };
}

export async function proxyMarketVerifiedFeed(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
    if (refus) return refus;
    if (!opts.fetchImpl && cachedVerifiedFeed && cachedVerifiedFeed.expiresAt > Date.now()) {
        return jsonReponse(cachedVerifiedFeed.payload, 200, 'public, max-age=60');
    }

    const fetchFn = opts.fetchImpl ?? fetch;
    const fxToCad = { ...VERIFIED_BOC_FX_TO_CAD };
    const livePricesCad = { ...VERIFIED_SPOT_CAD_2026_11 };
    const activeSources = new Set(['Banque du Canada (Valet FX)', 'Yahoo Finance v8 (TSX/NYSE/Euronext)']);
    let asOfDate = VERIFIED_BOC_FX_DATE;
    let liveFetchedCount = 0;

    try {
        const bocResp = await fetchFn(
            'https://www.bankofcanada.ca/valet/observations/FXUSDCAD,FXEURCAD,FXGBPCAD,FXCHFCAD,FXJPYCAD/json?recent=1',
            { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(3500)]), redirect: 'error' },
        );
        if (bocResp.ok) {
            const bocJson = await bocResp.json();
            const obs = bocJson.observations?.[0];
            if (obs) {
                if (typeof obs.d === 'string') asOfDate = obs.d;
                const p = (k) => Number(obs[k]?.v ?? 0);
                if (p('FXUSDCAD') > 0) fxToCad.USD = Number(p('FXUSDCAD').toFixed(4));
                if (p('FXEURCAD') > 0) {
                    fxToCad.EUR = Number(p('FXEURCAD').toFixed(4));
                    fxToCad.DKK = Number((p('FXEURCAD') / 7.46).toFixed(4));
                }
                if (p('FXGBPCAD') > 0) {
                    fxToCad.GBP = Number(p('FXGBPCAD').toFixed(4));
                    fxToCad.GBp = Number((p('FXGBPCAD') / 100).toFixed(6));
                }
                if (p('FXCHFCAD') > 0) fxToCad.CHF = Number(p('FXCHFCAD').toFixed(4));
                if (p('FXJPYCAD') > 0) fxToCad.JPY = Number(p('FXJPYCAD').toFixed(5));
            }
        }
    } catch { /* baseline FX conservée */ }

    try {
        const cgResp = await fetchFn(
            `https://api.coingecko.com/api/v3/simple/price?ids=${Object.keys(GECKO_MAP).join(',')}&vs_currencies=cad`,
            { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(3500)]), redirect: 'error' },
        );
        if (cgResp.ok) {
            const cgData = await cgResp.json();
            for (const [cgId, assetId] of Object.entries(GECKO_MAP)) {
                const cadSpot = Number(cgData[cgId]?.cad ?? 0);
                if (cadSpot > 0) { livePricesCad[assetId] = Number(cadSpot.toFixed(4)); liveFetchedCount++; }
            }
            activeSources.add('CoinGecko CAD Spot');
        }
    } catch { /* baseline crypto conservée */ }

    const geckoSet = new Set(Object.values(GECKO_MAP));
    const queue = VALORIA_ASSETS_CORE.filter((a) => a.id !== 'CASH' && !geckoSet.has(a.id));
    await Promise.allSettled(
        queue.map(async (asset) => {
            const yahooSym = resoudreYahoo(asset.id);
            const resp = await fetchFn(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=5d&interval=1d`,
                { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(3500)]), redirect: 'error' },
            );
            if (!resp.ok) return;
            const json = await resp.json();
            const res0 = json.chart?.result?.[0];
            const closes = (res0?.indicators?.quote?.[0]?.close ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);
            const rawClose = Number(res0?.meta?.regularMarketPrice ?? 0) || closes[closes.length - 1] || 0;
            if (rawClose <= 0) return;
            const ccy = String(res0?.meta?.currency ?? 'USD');
            const fx = fxToCad[ccy] ?? EXTRA_FX_TO_CAD[ccy] ?? EXTRA_FX_TO_CAD[ccy.toUpperCase()] ?? 1.4123;
            livePricesCad[asset.id] = Number((rawClose * fx).toFixed(4));
            liveFetchedCount++;
        }),
    );

    const payload = {
        ok: true,
        asOfDate,
        fetchedAt: new Date().toISOString(),
        sources: Array.from(activeSources),
        fxToCad,
        livePricesCad,
        updatedCount: Object.keys(livePricesCad).length,
        liveFetchedCount,
    };
    if (!opts.fetchImpl) cachedVerifiedFeed = { expiresAt: Date.now() + 5 * 60 * 1000, payload };
    return jsonReponse(payload, 200, 'public, max-age=60');
}

export async function proxyMarketSearch(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
    if (refus) return refus;
    const u = new URL(request.url);
    const paramQ = unique(u, 'q');
    if (paramQ === null) return erreur(400, 'Recherche ambiguë.');
    const q = (paramQ ?? '').trim();
    if (!q) return jsonReponse({ query: '', results: [] }, 200, 'public, max-age=60');
    if (q.length > 100) return erreur(400, 'Recherche invalide.');

    const qUpper = q.toUpperCase();
    const localMatches = VALORIA_ASSETS_CORE
        .filter((a) => a.ticker.toUpperCase().includes(qUpper) || a.id.toUpperCase().includes(qUpper) || a.name.toUpperCase().includes(qUpper))
        .slice(0, 8)
        .map((a) => ({
            symbol: a.ticker, assetId: a.id, name: a.name,
            exchange: a.categoryLabel, quoteType: a.category.toUpperCase(), isBuiltIn: true,
        }));

    const seen = new Set(localMatches.map((m) => m.symbol.toUpperCase()));
    const remoteMatches = [];
    try {
        const upstream = await (opts.fetchImpl ?? fetch)(
            `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`,
            { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(4000)]), redirect: 'error' },
        );
        if (upstream.ok) {
            const data = await upstream.json();
            for (const item of data.quotes ?? []) {
                const sym = String(item.symbol ?? '').trim().toUpperCase();
                if (!sym || seen.has(sym)) continue;
                const qt = String(item.quoteType ?? 'EQUITY').toUpperCase();
                if (!['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND', 'INDEX'].includes(qt)) continue;
                seen.add(sym);
                remoteMatches.push({
                    symbol: sym, name: String(item.longname ?? item.shortname ?? sym),
                    exchange: String(item.exchDisp ?? item.exchange ?? qt), quoteType: qt, isBuiltIn: false,
                });
            }
        }
    } catch { /* repli local */ }

    return jsonReponse({ query: q, results: [...localMatches, ...remoteMatches].slice(0, 14) }, 200, 'public, max-age=60');
}

export async function proxyMarketQuote(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
    if (refus) return refus;
    const u = new URL(request.url);
    const param = unique(u, 'symbol');
    if (param === null) return erreur(400, 'Symbole ambigu.');
    const rawSymbol = (param ?? '').trim().toUpperCase();
    if (!SYMBOLE.test(rawSymbol) || /^\.+$/.test(rawSymbol)) return erreur(400, 'Symbole invalide.');

    const yahooSym = resoudreYahoo(rawSymbol);
    try {
        const upstream = await (opts.fetchImpl ?? fetch)(
            `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?range=5y&interval=1mo`,
            { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(4500)]), redirect: 'error' },
        );
        if (!upstream.ok) {
            return jsonReponse({ liveAvailable: false, symbol: rawSymbol, message: 'Cotation temps réel indisponible.' }, 200, 'public, max-age=60');
        }
        const json = await upstream.json();
        const result = json.chart?.result?.[0];
        const meta = result?.meta ?? {};
        const currency = String(meta.currency ?? 'USD');
        const fxToCad = EXTRA_FX_TO_CAD[currency] ?? EXTRA_FX_TO_CAD[currency.toUpperCase()] ?? 1.4181;
        const rawSpot = Number(meta.regularMarketPrice ?? 0);
        const timestamps = result?.timestamp ?? [];
        const closes = result?.indicators?.quote?.[0]?.close ?? [];
        const monthlyHistoryCad = {};
        const validClosesCad = [];
        for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
            const c = closes[i];
            if (c === null || c === undefined || !Number.isFinite(c) || c <= 0) continue;
            const dt = new Date(timestamps[i] * 1000);
            const ym = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
            const cadClose = Number((c * fxToCad).toFixed(4));
            monthlyHistoryCad[ym] = cadClose;
            validClosesCad.push(cadClose);
        }
        const spotCad = Number((rawSpot > 0 ? rawSpot * fxToCad : validClosesCad[validClosesCad.length - 1] ?? 100).toFixed(4));
        let volatilityPct = 26.0;
        if (validClosesCad.length >= 6) {
            const rets = [];
            for (let i = 1; i < validClosesCad.length; i++) rets.push(validClosesCad[i] / validClosesCad[i - 1] - 1);
            const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
            const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rets.length - 1);
            volatilityPct = Number(Math.max(5, Math.min(110, Math.sqrt(variance * 12) * 100)).toFixed(1));
        }
        const inferred = infererSousClasse(rawSymbol, String(meta.instrumentType ?? 'EQUITY'));
        const displayName = String(meta.longName ?? meta.shortName ?? rawSymbol);
        return jsonReponse({
            liveAvailable: true,
            registration: {
                ticker: rawSymbol, name: displayName, spotCad, nativeCurrency: currency, fxToCad,
                category: inferred.category, subClass: inferred.subClass, volatilityPct, monthlyHistoryCad,
                description: `${displayName} (${rawSymbol}) — converti en $ CAD (taux ${fxToCad}).`,
            },
        }, 200, 'public, max-age=60');
    } catch {
        return jsonReponse({ liveAvailable: false, symbol: rawSymbol, message: 'Mode hors-ligne actif.' }, 200, 'public, max-age=60');
    }
}

async function fetchNewsPourTicker(ticker, fetchFn, signal) {
    const key = ticker.trim().toUpperCase();
    const cached = newsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.articles;

    const matched = VALORIA_ASSETS_CORE.find((a) => a.id.toUpperCase() === key || a.ticker.toUpperCase() === key);
    const querySymbol = matched ? matched.ticker : key;
    const collected = [];
    try {
        const resp = await fetchFn(
            `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(querySymbol)}&quotesCount=0&newsCount=4`,
            { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.any([signal, AbortSignal.timeout(3200)]), redirect: 'error' },
        );
        if (resp.ok) {
            const data = await resp.json();
            for (const n of data.news ?? []) {
                const title = String(n.title ?? '').trim();
                if (!title) continue;
                const dt = n.providerPublishTime ? new Date(n.providerPublishTime * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
                collected.push({
                    id: `yf-${n.uuid ?? `${key}-${collected.length}`}`,
                    ticker: querySymbol, assetId: matched?.id, title,
                    publisher: String(n.publisher ?? 'Yahoo Finance'), publishedAt: dt,
                    url: safeHttpUrl(n.link), isLiveWeb: true,
                });
            }
        }
    } catch { /* fallback */ }
    if (newsCache.size > 500) newsCache.clear();
    newsCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, articles: collected });
    return collected;
}

export async function proxyNewsIntelligence(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
    if (refus) return refus;
    const u = new URL(request.url);
    const param = unique(u, 'tickers');
    if (param === null) return erreur(400, 'Paramètre tickers ambigu.');
    const rawTickers = (param ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (rawTickers.length === 0) return jsonReponse({ ok: true, fetchedAt: new Date().toISOString(), liveCount: 0, articles: [] }, 200, 'public, max-age=120');
    if (rawTickers.some((t) => !SYMBOLE.test(t) || /^\.+$/.test(t))) return erreur(400, 'Paramètre tickers invalide.');

    const batches = await Promise.all(rawTickers.map((t) => fetchNewsPourTicker(t, opts.fetchImpl ?? fetch, request.signal)));
    const flat = batches.flat();
    return jsonReponse({ ok: true, fetchedAt: new Date().toISOString(), liveCount: flat.length, articles: flat }, 200, 'public, max-age=120');
}

export async function proxyNewsInstitutionalCorrelated(request, opts = {}) {
    const refus = garder(request, ['GET'], opts);
    if (refus) return refus;
    const u = new URL(request.url);
    const param = unique(u, 'tickers');
    if (param === null) return erreur(400, 'Paramètre tickers ambigu.');
    const rawTickers = (param ?? 'ADP,INTC,GOOGL,RY,LLY,PAYX').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 10);
    if (rawTickers.some((t) => !SYMBOLE.test(t) || /^\.+$/.test(t))) return erreur(400, 'Paramètre tickers invalide.');

    const cacheKey = rawTickers.join(',');
    if (!opts.fetchImpl && cachedInstitutionalCorrelated && cachedInstitutionalCorrelated.key === cacheKey && cachedInstitutionalCorrelated.expiresAt > Date.now()) {
        return jsonReponse(cachedInstitutionalCorrelated.payload, 200, 'public, max-age=120');
    }

    const fetchFn = opts.fetchImpl ?? fetch;
    const dispatches = [];
    const sourcesVerified = new Set();

    const secTargets = rawTickers
        .map((sym) => {
            const clean = sym.split('.')[0];
            const meta = SEC_CIK_MAP[sym] ?? SEC_CIK_MAP[clean];
            return meta ? { id: SEC_CIK_MAP[sym] ? sym : clean, meta } : null;
        })
        .filter(Boolean)
        .slice(0, 6);

    await Promise.allSettled(
        secTargets.map(async ({ id, meta }) => {
            const resp = await fetchFn(
                `https://data.sec.gov/submissions/CIK${meta.cik10}.json`,
                { method: 'GET', headers: { 'user-agent': 'ValoriaAnalytics/2.0 (institutional-research@valoria-analytics.ca)', accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(4000)]), redirect: 'error' },
            );
            if (!resp.ok) return;
            const json = await resp.json();
            const recent = json.filings?.recent;
            const forms = recent?.form ?? [];
            const dates = recent?.filingDate ?? [];
            const accs = recent?.accessionNumber ?? [];
            let added = 0;
            for (let i = 0; i < Math.min(forms.length, 35) && added < 2; i++) {
                const form = String(forms[i] ?? '').trim();
                if (!['10-Q', '10-K', '8-K', '4'].includes(form) || (form === '4' && added > 0)) continue;
                const filingDate = String(dates[i] ?? '').slice(0, 10);
                const accRaw = String(accs[i] ?? '');
                dispatches.push({
                    id: `sec-${id}-${accRaw || i}`,
                    assetId: id, ticker: meta.ticker, publishedAt: filingDate || '2026-11-04',
                    yearMonth: (filingDate || '2026-11').slice(0, 7),
                    sourceName: 'SEC EDGAR Officiel', sourceTier: 'REGULATOR_FILING',
                    filingOrEventCode: form === '4' ? 'SEC Form 4' : `SEC ${form}`,
                    headline: `${meta.company} — Dépôt ${form} (déposé le ${filingDate})`,
                    fundamentalImpulseScore: form === '10-Q' || form === '10-K' ? 14 : form === '8-K' ? -8 : -6,
                    isLiveFetched: true,
                });
                sourcesVerified.add('SEC EDGAR (data.sec.gov)');
                added++;
            }
        }),
    );

    try {
        const bocResp = await fetchFn(
            'https://www.bankofcanada.ca/valet/observations/BD.CDN.2YR.DQ.YLD,BD.CDN.10YR.DQ.YLD/json?recent=1',
            { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(3200)]), redirect: 'error' },
        );
        if (bocResp.ok) {
            const bocJson = await bocResp.json();
            const obs = bocJson.observations?.[0];
            const y2 = Number(obs?.['BD.CDN.2YR.DQ.YLD']?.v ?? 0);
            const y10 = Number(obs?.['BD.CDN.10YR.DQ.YLD']?.v ?? 0);
            const dt = typeof obs?.d === 'string' ? obs.d : VERIFIED_BOC_FX_DATE;
            if (y2 > 0 && y10 > 0) {
                const spreadBps = Math.round((y10 - y2) * 100);
                dispatches.push({
                    id: `boc-yield-${dt}`, assetId: 'RY', ticker: 'RY.TO', publishedAt: dt, yearMonth: dt.slice(0, 7),
                    sourceName: 'Banque du Canada (Valet)', sourceTier: 'CENTRAL_BANK_MACRO',
                    filingOrEventCode: `GoC 10A ${y10.toFixed(2)}%`,
                    headline: `Courbe obligataire du Canada (${dt}) : 10 ans à ${y10.toFixed(2)} % vs 2 ans à ${y2.toFixed(2)} % (écart ${spreadBps >= 0 ? '+' : ''}${spreadBps} pb)`,
                    url: 'https://www.bankofcanada.ca/rates/interest-rates/canadian-bonds/',
                    fundamentalImpulseScore: spreadBps > 0 ? 36 : -24, isLiveFetched: true,
                });
                sourcesVerified.add('Banque du Canada (Valet Obligations)');
            }
        }
    } catch { /* baseline GoC active */ }

    try {
        const rssSymbols = rawTickers.map((t) => resoudreYahoo(t)).slice(0, 6).join(',');
        const rssResp = await fetchFn(
            `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(rssSymbols)}&region=US&lang=en-US`,
            { method: 'GET', headers: { 'user-agent': UA }, signal: AbortSignal.any([request.signal, AbortSignal.timeout(3500)]), redirect: 'error' },
        );
        if (rssResp.ok) {
            const xml = await rssResp.text();
            for (const itemXml of (xml.match(/<item>[\s\S]*?<\/item>/g) ?? []).slice(0, 6)) {
                const rawTitle = decoderXml(itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
                if (!rawTitle) continue;
                const upperH = rawTitle.toUpperCase();
                const matched = VALORIA_ASSETS_CORE.find((a) => {
                    const base = a.ticker.split('.')[0].split('-')[0].toUpperCase();
                    return base.length >= 3 && new RegExp(`\\b${base}\\b`).test(upperH);
                });
                if (!matched) continue;
                dispatches.push({
                    id: `yfrss-${matched.id}-${dispatches.length}`,
                    assetId: matched.id, ticker: matched.ticker,
                    publishedAt: new Date().toISOString().slice(0, 10),
                    sourceName: 'Flux Institutionnel Yahoo/Reuters', sourceTier: 'TIER1_WIRE',
                    filingOrEventCode: 'Yahoo Wire', headline: rawTitle,
                    fundamentalImpulseScore: /SURGE|BEAT|RAISE|UPGRADE|RECORD|GROWTH/.test(upperH) ? 32 : /DROP|FALL|MISS|CUT|LOSS|SELL/.test(upperH) ? -36 : 0,
                    isLiveFetched: true,
                });
                sourcesVerified.add('Flux RSS Institutionnel');
            }
        }
    } catch { /* baseline active */ }

    const payload = { ok: true, fetchedAt: new Date().toISOString(), sourcesVerified: Array.from(sourcesVerified), dispatches };
    if (!opts.fetchImpl) cachedInstitutionalCorrelated = { key: cacheKey, expiresAt: Date.now() + 5 * 60 * 1000, payload };
    return jsonReponse(payload, 200, 'public, max-age=120');
}

/** Sonde de santé (cf. api/sante.ts). */
function repondreSante(request) {
    const entetes = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Méthode non permise.' }), { status: 405, headers: { ...entetes, allow: 'GET, HEAD' } });
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true }), { status: 200, headers: entetes });
}

function hubCorsHeaders(request) {
    const origin = (request.headers.get('origin') ?? '').trim();
    const h = { vary: 'Origin', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
    if (HUB_ALLOWED_ORIGINS.has(origin)) {
        h['access-control-allow-origin'] = origin;
        h['access-control-allow-methods'] = 'GET, OPTIONS';
        h['access-control-allow-headers'] = 'Authorization';
        h['access-control-max-age'] = '3600';
    }
    return h;
}

function decoderJsonBase64Url(segment) {
    try { return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')); } catch { return null; }
}

async function verifierJetonHubperso(authHeader, opts = {}) {
    const ownerEmail = obtenirHubpersoOwnerEmail(opts);
    const hubProjectId = obtenirHubpersoProjectId(opts);
    if (!ownerEmail || !hubProjectId) return false;

    const m = (authHeader ?? '').trim().match(/^Bearer\s+(.+)$/i);
    if (!m) return false;
    const parts = m[1].trim().split('.');
    if (parts.length !== 3) return false;
    const header = decoderJsonBase64Url(parts[0]);
    const payload = decoderJsonBase64Url(parts[1]);
    if (!header || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || !payload) return false;

    const nowMs = (opts.now ?? Date.now)();
    const nowSec = Math.floor(nowMs / 1000);
    if (
        payload.aud !== hubProjectId ||
        payload.iss !== `https://securetoken.google.com/${hubProjectId}` ||
        typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128 ||
        typeof payload.exp !== 'number' || payload.exp <= nowSec ||
        typeof payload.iat !== 'number' || payload.iat > nowSec + 60 ||
        typeof payload.email !== 'string' || payload.email.toLowerCase() !== ownerEmail ||
        payload.email_verified !== true
    ) return false;

    try {
        const fetchFn = opts.fetchImpl ?? fetch;
        if (!hubCertCache || nowMs >= hubCertCache.expiresAt) {
            const rep = await fetchFn(FIREBASE_X509_URL, { signal: AbortSignal.timeout(5000) });
            if (!rep.ok) return false;
            const certs = await rep.json();
            const maxAge = Number(rep.headers.get('cache-control')?.match(/max-age=(\d+)/i)?.[1] ?? 3600);
            const bounded = Math.max(60, Math.min(86400, Number.isFinite(maxAge) ? maxAge : 3600));
            hubCertCache = { certs, expiresAt: nowMs + bounded * 1000 };
        }
        const pem = hubCertCache.certs?.[header.kid];
        if (!pem) return false;
        const v = createVerify('RSA-SHA256');
        v.update(`${parts[0]}.${parts[1]}`);
        v.end();
        return v.verify(createPublicKey(pem), Buffer.from(parts[2], 'base64url'));
    } catch {
        return false;
    }
}

async function obtenirJetonAdc(fetchFn, nowMs, signal) {
    if (hubAdcCache && nowMs < hubAdcCache.expiresAt) return hubAdcCache.token;
    const rep = await fetchFn(METADATA_TOKEN_URL, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(2500)]),
    });
    if (!rep.ok) throw new Error(`metadata HTTP ${rep.status}`);
    const data = await rep.json();
    if (!data?.access_token) throw new Error('metadata sans jeton');
    const ttlMs = Math.max(60, (data.expires_in ?? 300) - 60) * 1000;
    hubAdcCache = { token: data.access_token, expiresAt: nowMs + ttlMs };
    return data.access_token;
}

const HUB_TORONTO_FMT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

const HUB_SHORT_DATE_FMT = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'America/Toronto',
    day: 'numeric',
    month: 'short',
});

const DATE_CLE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDateCourteHub(dateKey) {
    if (!DATE_CLE_RE.test(dateKey)) return dateKey;
    return HUB_SHORT_DATE_FMT.format(new Date(`${dateKey}T12:00:00Z`));
}

function torontoDateKeyFromMsHub(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
    const parts = HUB_TORONTO_FMT.formatToParts(new Date(ms));
    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : null;
}

function shiftDateKeyHub(dateKey, deltaDays) {
    const d = new Date(`${dateKey}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
}

function datesTorontoHub(nowMs = Date.now()) {
    const parts = HUB_TORONTO_FMT.formatToParts(new Date(nowMs));
    const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    const today = `${year}-${month}-${day}`;
    return {
        today,
        month: `${year}-${month}`,
        // Fenêtre glissante sur 7 jours (aujourd'hui + 6 jours précédents) : évite Quotidien == Hebdo le lundi.
        weekStart: shiftDateKeyHub(today, -6),
    };
}

function lireNombreFirestore(field) {
    const val = typeof field?.doubleValue === 'number'
        ? field.doubleValue
        : (field?.integerValue !== undefined ? Number(field.integerValue) : null);
    return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : null;
}

function nettoyerByDay(brut) {
    const out = {};
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return out;
    for (const [k, v] of Object.entries(brut)) {
        if (!DATE_CLE_RE.test(k)) continue;
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
            out[k] = Number(v.toFixed(6));
        }
    }
    return out;
}

function formatCadEntierHub(montant) {
    if (!Number.isFinite(montant)) return '—';
    const arrondi = Math.round(montant);
    const absStr = Math.abs(arrondi).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const signe = arrondi < 0 ? '-' : '';
    return `${signe}${absStr} $`;
}

function formatCadSigneHub(montant) {
    if (!Number.isFinite(montant)) return '—';
    const arrondi = Math.round(montant);
    const absStr = Math.abs(arrondi).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const signe = arrondi > 0 ? '+' : arrondi < 0 ? '-' : '';
    return `${signe}${absStr} $`;
}

function formatPctSigneHub(pct) {
    if (!Number.isFinite(pct)) return null;
    const arrondi = Math.round(pct * 10) / 10;
    const signe = arrondi > 0 ? '+' : '';
    return `${signe}${arrondi.toFixed(1).replace('.', ',')} %`;
}

function fxToCadAssetHub(asset, fxRates) {
    const rawCur = typeof asset?.currency === 'string' ? asset.currency.trim() : 'CAD';
    if (rawCur === 'GBp') {
        const fromWorkspaceGbp = fxRates && typeof fxRates === 'object' ? Number(fxRates.GBp ?? fxRates.GBP) : NaN;
        if (fxRates?.GBp && Number.isFinite(fromWorkspaceGbp) && fromWorkspaceGbp > 0) return fromWorkspaceGbp;
        if (fxRates?.GBP && Number.isFinite(Number(fxRates.GBP)) && Number(fxRates.GBP) > 0) return Number(fxRates.GBP) / 100;
        return VERIFIED_BOC_FX_TO_CAD.GBp;
    }
    const cur = rawCur.toUpperCase();
    if (cur === 'CAD') return 1;
    const fromWorkspace = fxRates && typeof fxRates === 'object' ? Number(fxRates[cur]) : NaN;
    if (Number.isFinite(fromWorkspace) && fromWorkspace > 0) return fromWorkspace;
    const fromBoc = VERIFIED_BOC_FX_TO_CAD[cur];
    return typeof fromBoc === 'number' && Number.isFinite(fromBoc) && fromBoc > 0 ? fromBoc : null;
}

function symboleYahooPourAssetHub(asset) {
    const rawSym = typeof asset?.historySymbol === 'string' && asset.historySymbol.trim()
        ? asset.historySymbol.trim()
        : (typeof asset?.symbol === 'string' ? asset.symbol.trim() : '');
    if (!rawSym) return '';
    return resoudreYahoo(rawSym);
}

async function enrichirPortefeuilleLiveHub(assets, fxRates, fetchFn, nowMs, signal, useCache) {
    if (!Array.isArray(assets) || assets.length === 0) {
        return { assets, fxRates };
    }

    const sizedSymbols = [];
    const seenSym = new Set();
    for (const a of assets) {
        if (!a || typeof a !== 'object') continue;
        const qty = Number(a.quantity);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const ySym = symboleYahooPourAssetHub(a);
        if (!ySym || seenSym.has(ySym)) continue;
        seenSym.add(ySym);
        sizedSymbols.push(ySym);
        if (sizedSymbols.length >= 25) break;
    }
    if (sizedSymbols.length === 0) {
        return { assets, fxRates };
    }

    const cacheKey = [...sizedSymbols].sort().join(',');
    if (useCache && hubLivePortfolioCache && hubLivePortfolioCache.key === cacheKey && hubLivePortfolioCache.expiresAt > nowMs) {
        return { assets: hubLivePortfolioCache.liveAssets, fxRates: hubLivePortfolioCache.liveFxRates };
    }

    const liveFxRates = { ...(fxRates && typeof fxRates === 'object' ? fxRates : {}), CAD: 1 };
    const safeSignal = (ms) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

    const fxTask = (async () => {
        try {
            const bocResp = await fetchFn(
                'https://www.bankofcanada.ca/valet/observations/FXUSDCAD,FXEURCAD,FXGBPCAD/json?recent=1',
                { method: 'GET', headers: { accept: 'application/json' }, signal: safeSignal(3500), redirect: 'error' },
            );
            if (!bocResp.ok) return;
            const bocJson = await bocResp.json();
            const obs = bocJson?.observations?.[0];
            if (!obs) return;
            const p = (k) => Number(obs[k]?.v ?? 0);
            if (p('FXUSDCAD') > 0) liveFxRates.USD = Number(p('FXUSDCAD').toFixed(4));
            if (p('FXEURCAD') > 0) liveFxRates.EUR = Number(p('FXEURCAD').toFixed(4));
            if (p('FXGBPCAD') > 0) {
                const gbp = p('FXGBPCAD');
                liveFxRates.GBP = Number(gbp.toFixed(4));
                liveFxRates.GBp = Number((gbp / 100).toFixed(6));
            }
        } catch { /* conserve fxRates existants */ }
    })();

    const quoteBySym = new Map();
    const quoteTasks = sizedSymbols.map(async (ySym) => {
        try {
            const resp = await fetchFn(
                `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=1mo&interval=1d`,
                { method: 'GET', headers: { 'user-agent': UA, accept: 'application/json' }, signal: safeSignal(3500), redirect: 'error' },
            );
            if (!resp.ok) return;
            const json = await resp.json();
            const res0 = json?.chart?.result?.[0];
            if (!res0) return;
            const meta = res0.meta ?? {};
            const timestamps = Array.isArray(res0.timestamp) ? res0.timestamp : [];
            const closes = Array.isArray(res0.indicators?.quote?.[0]?.close) ? res0.indicators.quote[0].close : [];
            const histByDate = new Map();
            let lastHistClose = 0;
            for (let i = 0; i < Math.min(timestamps.length, closes.length); i++) {
                const c = closes[i];
                if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) continue;
                const dKey = torontoDateKeyFromMsHub(Number(timestamps[i]) * 1000);
                if (!dKey) continue;
                const rounded = Number(c.toFixed(4));
                histByDate.set(dKey, rounded);
                lastHistClose = rounded;
            }
            const rawSpot = Number(meta.regularMarketPrice ?? 0);
            const livePrice = Number.isFinite(rawSpot) && rawSpot > 0 ? Number(rawSpot.toFixed(4)) : lastHistClose;
            if (livePrice <= 0) return;
            const currency = typeof meta.currency === 'string' && meta.currency.trim() ? meta.currency.trim() : null;
            quoteBySym.set(ySym, { currency, currentPrice: livePrice, histByDate });
        } catch { /* conserve les données stockées pour ce titre */ }
    });

    await Promise.allSettled([fxTask, ...quoteTasks]);

    if (quoteBySym.size === 0) {
        return { assets, fxRates: liveFxRates };
    }

    const liveAssets = assets.map((asset) => {
        if (!asset || typeof asset !== 'object') return asset;
        const ySym = symboleYahooPourAssetHub(asset);
        const quote = ySym ? quoteBySym.get(ySym) : undefined;
        if (!quote) return asset;

        const targetCurrency = quote.currency ?? asset.currency ?? 'CAD';
        if (fxToCadAssetHub({ currency: targetCurrency }, liveFxRates) === null) {
            return asset;
        }

        const mergedByDate = new Map();
        const sameCurrency = !asset.currency || asset.currency === targetCurrency;
        if (sameCurrency && quote.histByDate.size < 2 && Array.isArray(asset.priceHistory)) {
            for (const pt of asset.priceHistory) {
                if (pt && typeof pt.date === 'string' && DATE_CLE_RE.test(pt.date) && typeof pt.price === 'number' && Number.isFinite(pt.price) && pt.price > 0) {
                    mergedByDate.set(pt.date, pt.price);
                }
            }
        }
        for (const [dKey, price] of quote.histByDate.entries()) {
            mergedByDate.set(dKey, price);
        }

        const mergedHistory = Array.from(mergedByDate.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(-45)
            .map(([date, price]) => ({ date, price }));

        return {
            ...asset,
            currency: targetCurrency,
            currentPrice: quote.currentPrice,
            priceHistory: mergedHistory.length > 0 ? mergedHistory : asset.priceHistory,
        };
    });

    if (useCache) {
        hubLivePortfolioCache = {
            key: cacheKey,
            expiresAt: nowMs + 2 * 60 * 1000,
            liveAssets,
            liveFxRates,
        };
    }

    return { assets: liveAssets, fxRates: liveFxRates };
}

async function recupererLiquiditesFintableHub(fintableToken, fxRates, fetchFn, nowMs, signal, useCache = true) {
    if (typeof fintableToken !== 'string' || !fintableToken.trim()) return null;
    if (useCache && hubLiveBankCache.value && nowMs - hubLiveBankCache.fetchedAt < HUB_FINTABLE_CACHE_TTL_MS) {
        return hubLiveBankCache.value;
    }

    const reqSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000);
    let body;
    try {
        const resp = await fetchFn('https://fintable.io/api/v2/accounts', {
            method: 'GET',
            headers: { authorization: `Bearer ${fintableToken.trim()}`, accept: 'application/json' },
            signal: reqSignal,
            redirect: 'error',
        });
        if (!resp.ok) return null;
        body = await resp.json();
    } catch {
        return null;
    }

    const accounts = Array.isArray(body?.data) ? body.data : [];
    let totalCad = 0;
    let accountCount = 0;
    for (const acc of accounts) {
        if (!acc || typeof acc !== 'object' || acc.enabled === false) continue;
        if (typeof acc.type !== 'string' || !/^depository\b/i.test(acc.type.trim())) continue;
        let bal = Number(acc.balance);
        if (!Number.isFinite(bal)) continue;

        const rawCur = typeof acc.currency === 'string' && acc.currency.trim() ? acc.currency.trim() : 'CAD';
        if (rawCur === 'GBp') {
            bal /= 100;
        }
        const cur = rawCur === 'GBp' ? 'GBP' : rawCur.toUpperCase();
        let factor = 1;
        if (cur !== 'CAD') {
            const fromFx = fxRates && typeof fxRates === 'object' ? Number(fxRates[cur]) : NaN;
            const fromBoc = Number(VERIFIED_BOC_FX_TO_CAD[cur]);
            if (Number.isFinite(fromFx) && fromFx > 0) {
                factor = fromFx;
            } else if (Number.isFinite(fromBoc) && fromBoc > 0) {
                factor = fromBoc;
            } else {
                continue;
            }
        }
        totalCad += bal * factor;
        accountCount += 1;
    }

    if (accountCount === 0) return null;
    const result = {
        balanceCad: Number(totalCad.toFixed(2)),
        accountCount,
        fetchedAt: nowMs,
    };
    if (useCache) {
        hubLiveBankCache = { fetchedAt: nowMs, value: result };
    }
    return result;
}

function analyserPortefeuilleHub(assets, fxRates, today) {
    if (!Array.isArray(assets) || assets.length === 0) {
        return { highlight: null, alerts: [] };
    }

    const dayFloor = shiftDateKeyHub(today, -4);
    const weekTarget = shiftDateKeyHub(today, -7);
    const weekFloor = shiftDateKeyHub(today, -14);

    let totalCad = 0;
    let sizedCount = 0;
    let dayCurCad = 0;
    let dayPrevCad = 0;
    let weekCurCad = 0;
    let weekPrevCad = 0;
    const stockDrops = [];
    const sizedAssets = [];
    const allHistDates = new Set();

    for (const asset of assets) {
        if (!asset || typeof asset !== 'object') continue;
        const qty = Number(asset.quantity);
        const curPrice = Number(asset.currentPrice);
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(curPrice) || curPrice <= 0) continue;

        const fx = fxToCadAssetHub(asset, fxRates);
        if (fx === null) continue;

        sizedCount += 1;
        totalCad += qty * curPrice * fx;

        const hist = Array.isArray(asset.priceHistory)
            ? asset.priceHistory
                .filter((p) => p && typeof p.date === 'string' && DATE_CLE_RE.test(p.date) && typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0)
                .sort((a, b) => a.date.localeCompare(b.date))
            : [];
        sizedAssets.push({ qty, curPrice, fx, hist });
        for (const pt of hist) {
            if (pt.date <= today) allHistDates.add(pt.date);
        }
        if (hist.length === 0) continue;

        const sym = typeof asset.symbol === 'string' ? asset.symbol.trim().toUpperCase().slice(0, 12) : 'TITRE';
        const lastPt = hist[hist.length - 1];
        let dayPrevPrice = null;
        if (lastPt.date === today && hist.length >= 2) {
            dayPrevPrice = hist[hist.length - 2].price;
        } else if (lastPt.date < today && lastPt.date >= dayFloor) {
            dayPrevPrice = lastPt.price;
        }

        if (dayPrevPrice !== null && dayPrevPrice > 0) {
            dayCurCad += qty * curPrice * fx;
            dayPrevCad += qty * dayPrevPrice * fx;
            const dPct = ((curPrice - dayPrevPrice) / dayPrevPrice) * 100;
            if (dPct <= -5) {
                stockDrops.push({
                    pct: dPct,
                    label: `${sym} ${formatPctSigneHub(dPct)} aujourd'hui`,
                });
            }
        }

        let weekPt = null;
        for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].date <= weekTarget && hist[i].date >= weekFloor) {
                weekPt = hist[i];
                break;
            }
        }
        if (weekPt && weekPt.price > 0) {
            weekCurCad += qty * curPrice * fx;
            weekPrevCad += qty * weekPt.price * fx;
            const wPct = ((curPrice - weekPt.price) / weekPt.price) * 100;
            if (wPct <= -10 && !stockDrops.some((d) => d.label.startsWith(`${sym} `))) {
                stockDrops.push({
                    pct: wPct,
                    label: `${sym} ${formatPctSigneHub(wPct)} (7 j)`,
                });
            }
        }
    }

    if (sizedCount === 0) return { highlight: null, alerts: [] };

    const sortedDates = Array.from(allHistDates).sort();
    const sparkline = [];
    if (sortedDates.length > 0) {
        const seriesDates = [...sortedDates.filter((d) => d < today).slice(-13), today];
        for (const dKey of seriesDates) {
            if (dKey === today) {
                sparkline.push(Number(totalCad.toFixed(2)));
                continue;
            }
            let dayTotal = 0;
            let hasAnyPrice = false;
            for (const item of sizedAssets) {
                let priceOnOrBefore = null;
                for (let i = item.hist.length - 1; i >= 0; i--) {
                    if (item.hist[i].date <= dKey) {
                        priceOnOrBefore = item.hist[i].price;
                        break;
                    }
                }
                if (priceOnOrBefore !== null) {
                    dayTotal += item.qty * priceOnOrBefore * item.fx;
                    hasAnyPrice = true;
                }
            }
            if (hasAnyPrice) {
                sparkline.push(Number(dayTotal.toFixed(2)));
            }
        }
    }

    const parts = [];
    let mainPct = null;
    if (dayPrevCad > 0) {
        mainPct = ((dayCurCad - dayPrevCad) / dayPrevCad) * 100;
        parts.push(`${formatPctSigneHub(mainPct)} auj.`);
    }
    if (weekPrevCad > 0) {
        const wPct = ((weekCurCad - weekPrevCad) / weekPrevCad) * 100;
        if (mainPct === null) mainPct = wPct;
        parts.push(`${formatPctSigneHub(wPct)} (7 j)`);
    }

    const alerts = stockDrops
        .sort((a, b) => a.pct - b.pct)
        .slice(0, 2)
        .map((d) => ({ label: d.label, severity: 'warn', target: '#INVESTMENTS' }));

    const tone = stockDrops.length > 0 || (mainPct !== null && mainPct <= -3)
        ? 'warn'
        : mainPct !== null && mainPct > 0
            ? 'good'
            : 'neutral';

    return {
        highlight: {
            label: 'Placements',
            value: `${formatCadEntierHub(totalCad)} CA`,
            ...(parts.length > 0 ? { detail: parts.join(' · ') } : {}),
            tone,
            target: '#INVESTMENTS',
            ...(sparkline.length >= 2 ? { sparkline } : {}),
        },
        alerts,
    };
}

function analyserLiquiditesEtAvenirHub(extracted, today, weekStart, month) {
    const { initialBalances, transactions, retirementGoal, projection, fintableSyncAt } = extracted;
    const manualCashRaw = projection && typeof projection === 'object' && projection.useManualBalances === true
        ? Number(projection.manualCash)
        : NaN;
    const hasManualCash = Number.isFinite(manualCashRaw);

    let cashBalance = 0;
    let hasBalances = false;
    if (initialBalances && typeof initialBalances === 'object') {
        for (const raw of Object.values(initialBalances)) {
            if (raw === null || raw === undefined || raw === '') continue;
            const n = Number(raw);
            if (Number.isFinite(n)) {
                cashBalance += n;
                hasBalances = true;
            }
        }
    }

    let flowWeek = 0;
    let flowMonth = 0;
    let hasWeekTx = false;
    let hasMonthTx = false;
    let latestTxDate = '';
    const netByDate = new Map();

    if (Array.isArray(transactions)) {
        for (const tx of transactions) {
            if (!tx || typeof tx !== 'object' || tx.isDuplicate || tx.isTransfer) continue;
            if (tx.amount === null || tx.amount === undefined || tx.amount === '') continue;
            const amt = Number(tx.amount);
            if (!Number.isFinite(amt)) continue;
            cashBalance += amt;
            const txDate = typeof tx.date === 'string' ? tx.date.slice(0, 10) : '';
            if (DATE_CLE_RE.test(txDate)) {
                if (txDate <= today) {
                    netByDate.set(txDate, (netByDate.get(txDate) ?? 0) + amt);
                    if (txDate > latestTxDate) latestTxDate = txDate;
                }
                if (txDate >= weekStart && txDate <= today) {
                    flowWeek += amt;
                    hasWeekTx = true;
                }
                if (txDate.startsWith(month)) {
                    flowMonth += amt;
                    hasMonthTx = true;
                }
            }
        }
    }

    if (hasManualCash) {
        cashBalance = manualCashRaw;
    }

    const hasLiveBank = !hasManualCash && Boolean(extracted.liveBank && Number.isFinite(Number(extracted.liveBank.balanceCad)));
    if (hasLiveBank) {
        cashBalance = Number(extracted.liveBank.balanceCad);
        hasBalances = true;
    }

    const syncDate = torontoDateKeyFromMsHub(fintableSyncAt);
    const asOfDate = [syncDate, latestTxDate].filter(Boolean).sort().pop() ?? null;
    const staleThreshold = shiftDateKeyHub(today, -2);
    const isStaleBank = Boolean(!hasManualCash && !hasLiveBank && asOfDate && asOfDate < staleThreshold);

    const highlights = [];
    const alerts = [];
    if (hasManualCash || hasBalances) {
        let sparkline = [];
        if (!hasManualCash && hasBalances && Array.isArray(transactions)) {
            const rev = [];
            let running = cashBalance;
            for (let offset = 0; offset < 14; offset++) {
                const dKey = shiftDateKeyHub(today, -offset);
                rev.push(Number(running.toFixed(2)));
                running -= netByDate.get(dKey) ?? 0;
            }
            const chrono = rev.reverse();
            if (chrono.length >= 2 && chrono.every((v) => Number.isFinite(v))) {
                sparkline = chrono;
            }
        }
        let detail = hasManualCash
            ? 'Solde bancaire manuel'
            : hasLiveBank
                ? hasWeekTx
                    ? `Banque en direct · 7 j : ${formatCadSigneHub(flowWeek)}`
                    : 'Banque en direct'
                : hasWeekTx
                    ? `Solde bancaire · 7 j : ${formatCadSigneHub(flowWeek)}`
                    : 'Solde bancaire';
        let tone = cashBalance < 0 ? 'warn' : 'neutral';
        if (isStaleBank && asOfDate) {
            const shortDate = formatDateCourteHub(asOfDate);
            detail = `Solde au ${shortDate} · synchroniser FinanceAI`;
            tone = 'warn';
            alerts.push({
                label: `Synchro banque FinanceAI au ${shortDate}`,
                severity: 'info',
                target: '#DASHBOARD',
            });
        }
        highlights.push({
            label: 'Liquidités (banque)',
            value: `${formatCadEntierHub(cashBalance)} CA`,
            detail,
            tone,
            target: '#DASHBOARD',
            ...(sparkline.length >= 2 ? { sparkline } : {}),
        });
    }

    const targetAge = Number(retirementGoal?.targetAge);
    const targetMonthly = Number(retirementGoal?.targetMonthlyIncome);
    if (hasMonthTx || (Number.isFinite(targetAge) && targetAge > 0)) {
        const detailParts = [];
        if (Number.isFinite(targetAge) && targetAge > 0) detailParts.push(`Objectif retraite : ${Math.round(targetAge)} ans`);
        if (Number.isFinite(targetMonthly) && targetMonthly > 0) detailParts.push(`Cible ${formatCadEntierHub(targetMonthly)}/mois`);
        highlights.push({
            label: 'Impact avenir',
            value: hasMonthTx ? `Flux mois : ${formatCadSigneHub(flowMonth)}` : `Retraite visée : ${Math.round(targetAge)} ans`,
            ...(hasMonthTx && detailParts.length > 0 ? { detail: detailParts.join(' · ') } : {}),
            tone: hasMonthTx ? (flowMonth >= 0 ? 'good' : 'warn') : 'neutral',
            target: '#FUTURE',
        });
    }

    return { highlights, alerts };
}

function analyserActiviteFinance(extracted, today, weekStart, month) {
    const { transactions, assetsCount, assets, fxRates } = extracted;
    const hasManualCash = Boolean(extracted.projection?.useManualBalances && Number.isFinite(Number(extracted.projection?.manualCash)));
    const hasLiveBank = Boolean(extracted.liveBank && Number.isFinite(Number(extracted.liveBank.balanceCad)));
    if (!Array.isArray(transactions) && assetsCount === null && !extracted.initialBalances && !extracted.retirementGoal && !hasManualCash && !hasLiveBank) {
        return {
            metrics: [],
            alerts: [],
            highlights: [],
            activityToday: null,
            activityWeek: null,
            activityMonth: null,
            activityUnit: null,
        };
    }

    let needsReview = null;
    let txToday = null;
    let txWeek = null;
    let txMonth = null;

    if (Array.isArray(transactions)) {
        needsReview = 0;
        txToday = 0;
        txWeek = 0;
        txMonth = 0;
        for (const tx of transactions) {
            if (!tx || typeof tx !== 'object' || tx.isDuplicate || tx.isTransfer) continue;
            const cat = typeof tx.category === 'string' ? tx.category.trim() : '';
            const uncat = !cat || /^(non[- ]?cat|uncategorized|autre|à classer)/i.test(cat);
            const lowConf = !tx.isVerified && tx.status !== 'manual' && typeof tx.confidence === 'number' && tx.confidence > 0 && tx.confidence < 75;
            if (uncat || lowConf) needsReview += 1;

            const txDate = typeof tx.date === 'string' ? tx.date.slice(0, 10) : '';
            if (DATE_CLE_RE.test(txDate)) {
                if (txDate === today) txToday += 1;
                if (txDate >= weekStart && txDate <= today) txWeek += 1;
                if (txDate.startsWith(month)) txMonth += 1;
            }
        }
    }

    const metrics = [];
    if (needsReview !== null) {
        metrics.push({ label: 'À vérifier', value: String(needsReview), tone: needsReview > 0 ? 'warn' : 'good' });
    }
    if (txMonth !== null) {
        metrics.push({ label: 'Opérations (mois)', value: String(txMonth), tone: 'neutral' });
    }
    if (assetsCount !== null) {
        metrics.push({ label: 'Actifs suivis', value: String(assetsCount), tone: 'neutral' });
    }

    const portfolio = analyserPortefeuilleHub(assets, fxRates, today);
    const cashAndFuture = analyserLiquiditesEtAvenirHub(extracted, today, weekStart, month);
    const highlights = [];
    if (portfolio.highlight) highlights.push(portfolio.highlight);
    for (const item of cashAndFuture.highlights) highlights.push(item);

    const alerts = [];
    if (needsReview !== null && needsReview > 0) {
        alerts.push({
            label: `${needsReview} opération${needsReview > 1 ? 's' : ''} à vérifier`,
            severity: 'warn',
            target: '#TRANSACTIONS',
        });
    }
    for (const a of portfolio.alerts) alerts.push(a);
    for (const a of cashAndFuture.alerts) alerts.push(a);

    return {
        metrics,
        alerts: alerts.slice(0, 4),
        highlights: highlights.slice(0, 4),
        activityToday: txToday,
        activityWeek: txWeek,
        activityMonth: txMonth,
        activityUnit: txMonth !== null ? 'opérations' : null,
    };
}

function extraireCoutsDepuisStatePayload(statePayloadField) {
    const empty = {
        totalUsd: null,
        byDay: {},
        transactions: null,
        transactionsSharded: false,
        assets: null,
        assetsCount: null,
        fxRates: null,
        initialBalances: null,
        retirementGoal: null,
        projection: null,
        fintableSyncAt: null,
    };
    const fields = statePayloadField?.mapValue?.fields;
    if (!fields || typeof fields !== 'object') return empty;
    const transactionsSharded = fields.transactionsSharded?.booleanValue === true;

    if (fields._packedFormat?.stringValue === 'json_v1') {
        const values = fields.jsonChunks?.arrayValue?.values;
        if (!Array.isArray(values)) return { ...empty, transactionsSharded };
        try {
            const raw = values.map((v) => (typeof v?.stringValue === 'string' ? v.stringValue : '')).join('');
            if (!raw) return { ...empty, transactionsSharded };
            const parsed = JSON.parse(raw);
            const val = parsed?.aiChatCostUsdTotal;
            const totalUsd = typeof val === 'number' && Number.isFinite(val) && val >= 0 ? val : null;
            const transactions = Array.isArray(parsed?.transactions) ? parsed.transactions : null;
            const assets = Array.isArray(parsed?.assets) ? parsed.assets : null;
            const assetsCount = assets ? assets.length : null;
            const fxRates = parsed?.fxRates && typeof parsed.fxRates === 'object' ? parsed.fxRates : null;
            const initialBalances = parsed?.initialBalances && typeof parsed.initialBalances === 'object' ? parsed.initialBalances : null;
            const retirementGoal = parsed?.retirementGoal && typeof parsed.retirementGoal === 'object' ? parsed.retirementGoal : null;
            const projection = parsed?.projection && typeof parsed.projection === 'object' ? parsed.projection : null;
            const syncAtRaw = Number(parsed?.fintableSyncReport?.at);
            const fintableSyncAt = Number.isFinite(syncAtRaw) && syncAtRaw > 0 ? syncAtRaw : null;
            return {
                totalUsd,
                byDay: nettoyerByDay(parsed?.aiChatCostUsdByDay),
                transactions,
                transactionsSharded,
                assets,
                assetsCount,
                fxRates,
                initialBalances,
                retirementGoal,
                projection,
                fintableSyncAt,
            };
        } catch {
            return { ...empty, transactionsSharded };
        }
    }

    const totalUsd = lireNombreFirestore(fields.aiChatCostUsdTotal);
    const byDay = {};
    const mapFields = fields.aiChatCostUsdByDay?.mapValue?.fields;
    if (mapFields && typeof mapFields === 'object') {
        for (const [k, fieldVal] of Object.entries(mapFields)) {
            if (!DATE_CLE_RE.test(k)) continue;
            const n = lireNombreFirestore(fieldVal);
            if (n !== null) byDay[k] = Number(n.toFixed(6));
        }
    }
    const assetsVals = fields.assets?.arrayValue?.values;
    const assetsCount = Array.isArray(assetsVals) ? assetsVals.length : null;
    return { ...empty, totalUsd, byDay, transactionsSharded, assetsCount };
}

async function chargerTransactionsMensuellesHub(firestoreBase, ownerUid, adcToken, fetchFn, signal) {
    const collected = [];
    let pageToken = '';

    for (let page = 0; page < 20; page++) {
        let url = `${firestoreBase}/workspaces/${encodeURIComponent(ownerUid)}/transactionMonths?pageSize=200&mask.fieldPaths=jsonChunks`;
        if (pageToken) {
            url += `&pageToken=${encodeURIComponent(pageToken)}`;
        }
        const rep = await fetchFn(url, {
            method: 'GET',
            headers: { authorization: `Bearer ${adcToken}` },
            signal: AbortSignal.any([signal, AbortSignal.timeout(DELAI_AMONT_MS)]),
        });
        if (rep.status === 404) return collected;
        if (!rep.ok) throw new Error(`transactionMonths HTTP ${rep.status}`);

        const body = await rep.json();
        const docs = Array.isArray(body?.documents) ? body.documents : [];
        for (const doc of docs) {
            const chunkVals = doc?.fields?.jsonChunks?.arrayValue?.values;
            if (!Array.isArray(chunkVals)) continue;
            const rawJson = chunkVals
                .map((v) => (typeof v?.stringValue === 'string' ? v.stringValue : ''))
                .join('');
            if (!rawJson) continue;
            let parsed;
            try {
                parsed = JSON.parse(rawJson);
            } catch {
                throw new Error('transactionMonths invalid JSON');
            }
            if (Array.isArray(parsed)) {
                for (const tx of parsed) collected.push(tx);
            }
        }
        const nextToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : '';
        if (!nextToken) break;
        pageToken = nextToken;
    }

    return collected;
}

function construirePayloadCoutsFinance(extracted, updatedAt, nowMs) {
    const { totalUsd, byDay } = extracted;
    const { today, month, weekStart } = datesTorontoHub(nowMs);
    const entries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
    const daily = entries.slice(-31).map(([date, amountUsd]) => ({ date, amountUsd }));
    const monthlyMap = new Map();
    let sumByDay = 0;
    let weekUsd = 0;

    for (const [date, amountUsd] of entries) {
        sumByDay += amountUsd;
        const mKey = date.slice(0, 7);
        monthlyMap.set(mKey, (monthlyMap.get(mKey) ?? 0) + amountUsd);
        if (date >= weekStart && date <= today) weekUsd += amountUsd;
    }

    const monthly = Array.from(monthlyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([m, amt]) => ({ month: m, amountUsd: Number(amt.toFixed(6)) }));

    const todayUsd = Number((byDay[today] ?? 0).toFixed(6));
    const roundedWeekUsd = Number(weekUsd.toFixed(6));
    const monthUsd = Number((monthlyMap.get(month) ?? 0).toFixed(6));
    const resolvedTotal = Number(Math.max(totalUsd ?? 0, sumByDay).toFixed(6));

    return {
        appId: 'financeai',
        period: 'month',
        currency: 'USD',
        amountUsd: monthUsd,
        todayUsd,
        weekUsd: roundedWeekUsd,
        monthUsd,
        totalUsd: resolvedTotal,
        daily,
        monthly,
        updatedAt,
        summary: analyserActiviteFinance(extracted, today, weekStart, month),
    };
}

function payloadCoutsVideFinance() {
    return {
        appId: 'financeai',
        period: 'month',
        currency: 'USD',
        amountUsd: null,
        todayUsd: null,
        weekUsd: null,
        monthUsd: null,
        totalUsd: null,
        daily: [],
        monthly: [],
        updatedAt: null,
        summary: {
            metrics: [],
            alerts: [],
            highlights: [],
            activityToday: null,
            activityWeek: null,
            activityMonth: null,
            activityUnit: null,
        },
    };
}

export async function proxyHubCosts(request, opts = {}) {
    const cors = hubCorsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') {
        return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
            status: 405,
            headers: { 'content-type': 'application/json', allow: 'GET, OPTIONS', ...cors },
        });
    }

    const debit = essayerDebit(`hubcosts:${ipClient(request.headers)}`, DEBIT_PROXY_PAR_MIN);
    if (!debit.ok) {
        return new Response(JSON.stringify({ error: 'too_many_requests' }), {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': String(debit.retryApresSec), ...cors },
        });
    }

    const ok = await verifierJetonHubperso(request.headers.get('authorization'), opts);
    if (!ok) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'content-type': 'application/json', ...cors },
        });
    }

    const ownerEmail = obtenirHubpersoOwnerEmail(opts);
    const firestoreBase = obtenirFinanceaiFirestoreBase(opts);
    if (!firestoreBase) {
        return jsonReponse({ error: 'service_not_configured' }, 503, 'no-store', cors);
    }

    try {
        const fetchFn = opts.fetchImpl ?? fetch;
        const nowMs = (opts.now ?? Date.now)();
        const adcToken = await obtenirJetonAdc(fetchFn, nowMs, request.signal);
        const fsHeaders = { authorization: `Bearer ${adcToken}`, 'content-type': 'application/json' };

        if (!cachedOwnerUid) {
            const qRep = await fetchFn(`${firestoreBase}:runQuery`, {
                method: 'POST',
                headers: fsHeaders,
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'users' }],
                        where: {
                            fieldFilter: {
                                field: { fieldPath: 'email' },
                                op: 'EQUAL',
                                value: { stringValue: ownerEmail },
                            },
                        },
                        select: { fields: [{ fieldPath: 'uid' }] },
                        limit: 1,
                    },
                }),
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(DELAI_AMONT_MS)]),
            });
            if (!qRep.ok) throw new Error(`runQuery HTTP ${qRep.status}`);
            const rows = await qRep.json();
            const doc = Array.isArray(rows) ? rows[0]?.document : null;
            const resolved = doc?.fields?.uid?.stringValue ?? doc?.name?.split('/').pop() ?? null;
            if (!resolved || !/^[a-zA-Z0-9_-]{1,128}$/.test(resolved)) {
                return jsonReponse(payloadCoutsVideFinance(), 200, 'no-store', cors);
            }
            cachedOwnerUid = resolved;
        }

        const wRep = await fetchFn(
            `${firestoreBase}/workspaces/${encodeURIComponent(cachedOwnerUid)}?mask.fieldPaths=statePayload&mask.fieldPaths=updatedAt`,
            {
                method: 'GET',
                headers: { authorization: `Bearer ${adcToken}` },
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(DELAI_AMONT_MS)]),
            },
        );
        if (wRep.status === 404) {
            return jsonReponse(payloadCoutsVideFinance(), 200, 'no-store', cors);
        }
        if (!wRep.ok) throw new Error(`workspace HTTP ${wRep.status}`);

        const wDoc = await wRep.json();
        const extracted = extraireCoutsDepuisStatePayload(wDoc?.fields?.statePayload);
        if (extracted.transactionsSharded) {
            const sharded = await chargerTransactionsMensuellesHub(firestoreBase, cachedOwnerUid, adcToken, fetchFn, request.signal);
            extracted.transactions = [...sharded, ...(Array.isArray(extracted.transactions) ? extracted.transactions : [])];
        }
        const forceRefresh = new URL(request.url).searchParams.get('refresh') === '1';
        if (Array.isArray(extracted.assets) && extracted.assets.length > 0) {
            const enriched = await enrichirPortefeuilleLiveHub(
                extracted.assets,
                extracted.fxRates,
                fetchFn,
                nowMs,
                request.signal,
                !opts.fetchImpl && !forceRefresh,
            );
            extracted.assets = enriched.assets;
            extracted.fxRates = enriched.fxRates;
        }
        const hasManualCash = extracted.projection?.useManualBalances === true && Number.isFinite(Number(extracted.projection?.manualCash));
        if (opts.fintableToken && !hasManualCash) {
            const liveBank = await recupererLiquiditesFintableHub(
                opts.fintableToken,
                extracted.fxRates,
                fetchFn,
                nowMs,
                request.signal,
                !opts.fetchImpl && !forceRefresh,
            );
            if (liveBank) extracted.liveBank = liveBank;
        }
        const updatedAtRaw = wDoc?.fields?.updatedAt?.timestampValue ?? wDoc?.updateTime ?? null;
        const updatedAt = typeof updatedAtRaw === 'string' && !Number.isNaN(Date.parse(updatedAtRaw))
            ? new Date(updatedAtRaw).toISOString()
            : null;
        return jsonReponse(construirePayloadCoutsFinance(extracted, updatedAt, nowMs), 200, 'no-store', cors);
    } catch {
        return jsonReponse({ error: 'upstream_error' }, 502, 'no-store', cors);
    }
}

/** Aiguillage : mêmes chemins que `vercel.json`, `vite.config.ts` et les 7 routes publiques Valoria. */
export async function traiter(request, opts = {}) {
    const { pathname } = new URL(request.url);
    try {
        if (pathname === '/api/sante') return repondreSante(request);
        if (pathname === '/api/hub-costs') return await proxyHubCosts(request, opts);
        if (pathname === '/api/proxy/fintable' || pathname.startsWith('/api/fintable/')) return await proxyFintable(request, opts);
        if (pathname === '/api/yahoo/history' || pathname.startsWith('/api/history/yahoo/')) return await proxyYahooHistorique(request, opts);
        if (pathname === '/api/yahoo/search' || pathname === '/api/search/yahoo') return await proxyYahooRecherche(request, opts);
        if (pathname === '/api/financeai/bridge' || pathname.startsWith('/api/financeai/')) {
            return erreur(410, 'Pont de partage supprimé.', 'gone');
        }
        if (pathname === '/api/market/verified-feed') return await proxyMarketVerifiedFeed(request, opts);
        if (pathname === '/api/market/search') return await proxyMarketSearch(request, opts);
        if (pathname === '/api/market/quote') return await proxyMarketQuote(request, opts);
        if (pathname === '/api/news/intelligence') return await proxyNewsIntelligence(request, opts);
        if (pathname === '/api/news/institutional-correlated') return await proxyNewsInstitutionalCorrelated(request, opts);
        return erreur(404, 'Route inconnue.', 'not_found');
    } catch (e) {
        console.error('[proxy] exception non prévue:', e?.name ?? 'Error');
        return erreur(500, 'Erreur interne.');
    }
}
