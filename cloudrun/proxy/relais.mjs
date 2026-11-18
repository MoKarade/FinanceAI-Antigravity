// cloudrun/proxy/relais.mjs
// Relais same-origin de FinanceAI sur Cloud Run (derrière Firebase Hosting : `/api/**` → service `financeai-proxy`).
// Portage FIDÈLE de `api/_lib/proxies.ts` + `api/_lib/garde.ts` + routes publiques Valoria en JS ESM pur, sans dépendance :
// chaque relais est une LISTE BLANCHE (hôte amont fixe ou URL publique vérifiée anti-SSRF, paramètres validés un à un,
// délai borné, limite de débit IP, aucun cookie, aucun secret).
// Le jeton Fintable vient du navigateur (`Authorization: Bearer …`), il est relayé tel quel, JAMAIS stocké ni journalisé.

const DELAI_AMONT_MS = 15_000;
const DEBIT_PROXY_PAR_MIN = 120;
const BRIDGE_MAX_OCTETS = 2 * 1024 * 1024;
const UA = 'Mozilla/5.0 (compatible; FinanceAI/1.0)';
const FENETRE_MS = 60_000;
const COMPTEURS_MAX = 2_000;

/** Origines autorisées (navigateur). Un appel sans en-tête `Origin` (GET same-origin, curl) reste accepté. */
export const ORIGINES_AUTORISEES = new Set([
    'https://finance.hubperso.com',
    'https://financeai-f5382.web.app',
    'https://financeai-f5382.firebaseapp.com',
]);
const ORIGINE_FIREBASE = /^https:\/\/financeai-[a-z0-9-]+\.(web\.app|firebaseapp\.com)$/;
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
let latestBridgeState = {
    schema: 'FinanceAI-Valoria-Bridge/v1.2',
    status: 'ready',
    updatedAt: new Date().toISOString(),
    note: 'Synchronisez depuis Valoria ou envoyez un POST JSON (max 2 Mo).',
};

/** Tests uniquement. */
export function reinitialiserLimites() {
    compteurs.clear();
    newsCache.clear();
    cachedVerifiedFeed = null;
    cachedInstitutionalCorrelated = null;
    latestBridgeState = {
        schema: 'FinanceAI-Valoria-Bridge/v1.2',
        status: 'ready',
        updatedAt: new Date().toISOString(),
        note: 'Synchronisez depuis Valoria ou envoyez un POST JSON (max 2 Mo).',
    };
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
export function origineAutorisee(headers) {
    if (headers.get('sec-fetch-site') === 'cross-site') return false;
    const origine = headers.get('origin');
    if (origine === null) return true;
    return ORIGINES_AUTORISEES.has(origine) || ORIGINE_FIREBASE.test(origine) || ORIGINE_LOCALE.test(origine);
}

/** Garde commune : origine, méthode autorisée et débit par IP. `null` = tout va bien. */
function garder(request, methodesPermises = ['GET']) {
    if (!origineAutorisee(request.headers)) return erreur(403, 'Origine non autorisée.', 'forbidden_origin');
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

class CorpsTropGros extends Error {}

async function lireCorpsBorne(request, max = BRIDGE_MAX_OCTETS) {
    const annonce = Number(request.headers.get('content-length'));
    if (Number.isFinite(annonce) && annonce > max) throw new CorpsTropGros();
    if (!request.body) return '';
    const lecteur = request.body.getReader();
    const morceaux = [];
    let total = 0;
    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await lecteur.cancel().catch(() => undefined);
            throw new CorpsTropGros();
        }
        morceaux.push(value);
    }
    const tout = new Uint8Array(total);
    let pos = 0;
    for (const m of morceaux) { tout.set(m, pos); pos += m.byteLength; }
    return new TextDecoder().decode(tout);
}

// ─── Garde SSRF stricte & compaction bridge ───────────────────────────────────────────────────────────────

function ipv4Privee(octets) {
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return a >= 224;
}

function parserIpv4(host) {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
    const parts = host.split('.').map(Number);
    return parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? parts : null;
}

function ipv6Privee(rawHost) {
    const host = rawHost.replace(/^\[|\]$/g, '').toLowerCase().split('%')[0];
    if (!host.includes(':')) return false;
    if (host === '::' || host === '::1' || host === '0:0:0:0:0:0:0:1' || host === '0:0:0:0:0:0:0:0') return true;
    if (/^(fe8|fe9|fea|feb|fc|fd)[0-9a-f]{0,2}:/.test(host) || /^ff/.test(host)) return true;
    const v4Mapped = host.match(/::ffff:([0-9a-f:.]+)$/);
    if (v4Mapped) {
        const tail = v4Mapped[1];
        const dotted = parserIpv4(tail);
        if (dotted) return ipv4Privee(dotted);
        const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (hex) {
            const hi = parseInt(hex[1], 16);
            const lo = parseInt(hex[2], 16);
            return ipv4Privee([(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255]);
        }
    }
    return false;
}

export function urlSurePourRelais(rawUrl) {
    let parsed;
    try { parsed = new URL(String(rawUrl).trim()); } catch { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return false;
    if (
        host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
        host.endsWith('.internal') || host.endsWith('.localdomain') ||
        host === 'metadata' || host === 'metadata.google.internal'
    ) return false;
    if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
    const ipv4 = parserIpv4(host);
    if (ipv4) return !ipv4Privee(ipv4);
    if (host.startsWith('[') || host.includes(':')) return !ipv6Privee(host);
    return host.includes('.');
}

const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);

function nettoyerObjet(val, prof = 0) {
    if (prof > 16 || val === null || val === undefined) return val;
    if (Array.isArray(val)) return val.map((x) => nettoyerObjet(x, prof + 1));
    if (typeof val !== 'object') return val;
    const out = {};
    for (const [k, v] of Object.entries(val)) {
        if (!CLES_INTERDITES.has(k)) out[k] = nettoyerObjet(v, prof + 1);
    }
    return out;
}

function compacterBridgePayload(raw) {
    const safe = nettoyerObjet(raw);
    if (!safe || typeof safe !== 'object' || Array.isArray(safe)) {
        return { positions: Array.isArray(safe) ? safe.slice(0, 500) : [] };
    }
    if (safe.schema === 'FinanceAI-Valoria-Bridge/v1.2' || safe.schema === 'FinanceAI-Valoria-Bridge/v1.3-CAD') {
        return safe;
    }
    const outer = safe.payload && typeof safe.payload === 'object' && !Array.isArray(safe.payload) ? safe.payload : safe;
    const stateObj = outer.store?.state && typeof outer.store.state === 'object'
        ? outer.store.state
        : (outer.state && typeof outer.state === 'object' && !Array.isArray(outer.state) ? outer.state : outer);

    if (!safe.store && !safe.transactions && !safe.state && !safe.assets && !safe.positions) return safe;

    const rawList =
        (Array.isArray(stateObj.positions) && stateObj.positions) ||
        (Array.isArray(stateObj.holdings) && stateObj.holdings) ||
        (Array.isArray(stateObj.portfolio) && stateObj.portfolio) ||
        (Array.isArray(stateObj.lots) && stateObj.lots) ||
        (Array.isArray(stateObj.assets) && stateObj.assets) ||
        null;

    const compactObject = { app: outer.app ?? 'FinanceAI' };
    if (typeof outer.version === 'string') compactObject.version = outer.version;
    if (stateObj.fxRates ?? outer.fxRates) compactObject.fxRates = stateObj.fxRates ?? outer.fxRates;
    if (stateObj.profile) compactObject.profile = stateObj.profile;
    if (stateObj.investorProfile) compactObject.investorProfile = stateObj.investorProfile;
    if (stateObj.budget) compactObject.budget = stateObj.budget;
    if (stateObj.initialBalances) compactObject.initialBalances = stateObj.initialBalances;
    if (Array.isArray(stateObj.watchlist)) compactObject.watchlist = stateObj.watchlist.slice(0, 100);
    if (rawList) {
        compactObject.positions = rawList.slice(0, 500).map((item) => {
            if (!item || typeof item !== 'object') return item;
            const { priceHistory: _ph, purchases: _pur, owner: _own, lastHistorySync: _lhs, priceUpdatedAt: _pua, ...essential } = item;
            return essential;
        });
    }
    return compactObject;
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

/** GET /api/yahoo/search | /api/search/yahoo */
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

/** GET /api/fintable/<chemin sous /api/v2> (ou /api/proxy/fintable?path=…) */
export async function proxyFintable(request, opts = {}) {
    const refus = garder(request);
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

function corsHeaders(request) {
    const origin = request.headers.get('origin');
    const h = {
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization',
    };
    if (origin && origineAutorisee(request.headers)) {
        h['access-control-allow-origin'] = origin;
        h.vary = 'Origin';
    }
    return h;
}

export async function bridgeFinanceAI(request, opts = {}) {
    const refus = garder(request, ['GET', 'POST', 'OPTIONS']);
    if (refus) return refus;
    const ch = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...ch, 'cache-control': 'no-store' } });
    if (request.method === 'GET') return jsonReponse(latestBridgeState, 200, 'no-store', ch);

    let brut;
    try {
        brut = await lireCorpsBorne(request, BRIDGE_MAX_OCTETS);
    } catch (e) {
        if (e instanceof CorpsTropGros) return erreur(413, 'Corps de requête limité à 2 Mo.', 'payload_too_large');
        return erreur(400, 'Corps de requête illisible.');
    }

    let body;
    try {
        body = brut.trim() ? JSON.parse(brut) : {};
    } catch {
        return erreur(400, 'JSON invalide.');
    }
    if (!body || typeof body !== 'object') return erreur(400, 'Objet JSON attendu.');

    if (typeof body.remoteUrl === 'string' && body.remoteUrl.trim()) {
        const targetUrl = body.remoteUrl.trim();
        if (!urlSurePourRelais(targetUrl)) {
            return erreur(400, 'URL FinanceAI invalide ou hôte privé interdit (garde SSRF).', 'ssrf_blocked');
        }
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(DELAI_AMONT_MS)]);
        let amont;
        try {
            amont = await (opts.fetchImpl ?? fetch)(targetUrl, {
                method: 'GET', headers: { accept: 'application/json' }, signal, redirect: 'error',
            });
        } catch {
            return erreur(502, 'FinanceAI distant injoignable.');
        }
        if (!amont.ok) return erreur(502, `FinanceAI distant a répondu avec le statut ${amont.status}.`);
        let remoteText;
        try {
            remoteText = await lireCorpsBorne(amont, BRIDGE_MAX_OCTETS);
        } catch (e) {
            if (e instanceof CorpsTropGros) return erreur(413, 'Réponse distante supérieure à 2 Mo.');
            return erreur(502, 'Réponse distante illisible.');
        }
        let remoteJson;
        try { remoteJson = JSON.parse(remoteText); } catch { return erreur(502, 'Réponse distante non JSON.'); }
        const slimRemote = compacterBridgePayload(remoteJson);
        latestBridgeState = {
            schema: 'FinanceAI-Valoria-Bridge/v1.2',
            syncedFromUrl: targetUrl,
            updatedAt: new Date().toISOString(),
            payload: slimRemote,
        };
        return jsonReponse({ ok: true, remotePayload: slimRemote, bridgeState: latestBridgeState }, 200, 'no-store', ch);
    }

    const slimBody = compacterBridgePayload(body);
    if (new TextEncoder().encode(JSON.stringify(slimBody)).length > BRIDGE_MAX_OCTETS) {
        return erreur(413, 'État compacté supérieur à 2 Mo.', 'payload_too_large');
    }
    latestBridgeState = { ...slimBody, updatedAt: new Date().toISOString() };
    return jsonReponse({ ok: true, bridgeState: latestBridgeState }, 200, 'no-store', ch);
}

export async function proxyMarketVerifiedFeed(request, opts = {}) {
    const refus = garder(request);
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
    const refus = garder(request);
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
    const refus = garder(request);
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
                    url: n.link ? String(n.link) : undefined, isLiveWeb: true,
                });
            }
        }
    } catch { /* fallback */ }
    if (newsCache.size > 500) newsCache.clear();
    newsCache.set(key, { expiresAt: Date.now() + 5 * 60 * 1000, articles: collected });
    return collected;
}

export async function proxyNewsIntelligence(request, opts = {}) {
    const refus = garder(request);
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
    const refus = garder(request);
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
    const entetes = { 'content-type': 'application/json', 'cache-control': 'no-store' };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ error: 'Méthode non permise.' }), { status: 405, headers: { ...entetes, allow: 'GET, HEAD' } });
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({ ok: true }), { status: 200, headers: entetes });
}

/** Aiguillage : mêmes chemins que `vercel.json`, `vite.config.ts` et les 7 routes publiques Valoria. */
export async function traiter(request, opts = {}) {
    const { pathname } = new URL(request.url);
    try {
        if (pathname === '/api/sante') return repondreSante(request);
        if (pathname === '/api/proxy/fintable' || pathname.startsWith('/api/fintable/')) return await proxyFintable(request, opts);
        if (pathname === '/api/yahoo/history' || pathname.startsWith('/api/history/yahoo/')) return await proxyYahooHistorique(request, opts);
        if (pathname === '/api/yahoo/search' || pathname === '/api/search/yahoo') return await proxyYahooRecherche(request, opts);
        if (pathname === '/api/financeai/bridge') return await bridgeFinanceAI(request, opts);
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
