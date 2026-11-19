// services/investments/multiAgentCommittee.ts
//
// Comité d'investissement multi-agents réel pour FinanceAI :
//   Phase 1 — Collecte réelle (détection coté vs société privée non cotée, cotes/actus
//             via /api/yahoo/search, /api/market/quote et /api/news/intelligence, + portefeuille
//             anonymisé ACTIF_01..12 et fiscalité QC/CA).
//   Phase 2 — 4 agents spécialistes indépendants en parallèle (Promise.all) via @google/genai
//             avec recherche Web Google Search (tools: [{ googleSearch: {} }]) et suivi des coûts.
//   Phase 3 — Agent 5 Président : confrontation des 4 avis (accords & désaccords) + verdict.
//
// Sécurité & No-fake-data :
//   - Bloqué sans appel en mode discret (`isPrivacyMode`).
//   - Aucun nom personnel, NIP ou symbole détenu privé envoyé sans anonymisation.
//   - Valeurs absentes -> null / « — », jamais 0 inventé.

import { z } from 'zod';
import type { AppState, Asset } from '../../types';
import { assetValueCad } from '../portfolio';
import { formatCAD } from '../../utils/format';
import { calculateFiscalReport } from '../../utils/tax';
import { MESSAGE_IA_MODE_DISCRET } from '../messageErreurIa';
import { signalerUsageIa } from '../aiChat/coutIa';
import type { BlocTableau } from '../assistant/blocsRiches';
import {
    marquerSystemFictif,
    PROMPT_DATA_ISOLATION_NOTE,
    sanitizePromptText,
    wrapUserData,
} from '../../utils/promptSafety';
import type {
    CommitteeAgentCallRequest,
    CommitteeAgentCallResponse,
    CommitteeAgentId,
    CommitteeAgentReport,
    CommitteeAgentRunner,
    CommitteeAgentStance,
    CommitteeAgentStatus,
    CommitteeAnalysisReport,
    CommitteeEntityStatus,
    CommitteeIndirectProxy,
    CommitteeLiveQuote,
    CommitteeNewsHeadline,
    CommitteeProgressEvent,
    CommitteeSourceLink,
    CommitteeSpecialistAgentId,
    CommitteeVerdict,
} from './multiAgentCommitteeTypes';

const DEFAULT_COMMITTEE_MODEL = 'gemini-2.5-flash';
const MARKET_FETCH_TIMEOUT_MS = 3500;
const MAX_HOLDINGS_PROMPT = 12;

export const PRIVATE_COMPANY_DIRECTORY: ReadonlyArray<{
    name: string;
    aliases: ReadonlyArray<string>;
    sector: string;
    note: string;
    proxies: ReadonlyArray<CommitteeIndirectProxy>;
}> = [
    {
        name: 'Anthropic',
        aliases: ['anthropic', 'claude ai', 'anthropic pbc'],
        sector: 'Intelligence artificielle (modèles de fondation)',
        note: 'Entreprise privée américaine (Public Benefit Corporation), non cotée sur les marchés publics.',
        proxies: [
            { symbol: 'AMZN', name: 'Amazon.com', rationale: 'Actionnaire stratégique majeur d’Anthropic et distributeur principal via AWS Bedrock.' },
            { symbol: 'GOOGL', name: 'Alphabet (Google)', rationale: 'Investisseur stratégique important et partenaire cloud/TPU d’Anthropic.' },
            { symbol: 'NVDA', name: 'NVIDIA', rationale: 'Fournisseur central d’infrastructure GPU pour l’entraînement et l’inférence des grands modèles IA.' },
            { symbol: 'XEQT.TO', name: 'iShares Core Equity ETF (CAD)', rationale: 'Exposition mondiale diversifiée incluant indirectement les géants cloud qui financent l’IA.' },
        ],
    },
    {
        name: 'OpenAI',
        aliases: ['openai', 'open ai', 'chatgpt'],
        sector: 'Intelligence artificielle',
        note: 'Entreprise privée non cotée directement en bourse.',
        proxies: [
            { symbol: 'MSFT', name: 'Microsoft', rationale: 'Partenaire stratégique majeur et intégrateur Azure/Copilot des modèles OpenAI.' },
            { symbol: 'NVDA', name: 'NVIDIA', rationale: 'Infrastructure de calcul GPU au cœur de l’écosystème IA.' },
        ],
    },
    {
        name: 'SpaceX',
        aliases: ['spacex', 'space x', 'starlink'],
        sector: 'Aérospatial & télécoms satellitaires',
        note: 'Entreprise privée non cotée ; Starlink reste intégré à SpaceX.',
        proxies: [
            { symbol: 'RKLB', name: 'Rocket Lab', rationale: 'Acteur coté des lancements spatiaux et systèmes satellitaires.' },
            { symbol: 'GOOGL', name: 'Alphabet', rationale: 'Détient une participation minoritaire historique au capital de SpaceX.' },
        ],
    },
    {
        name: 'Stripe',
        aliases: ['stripe'],
        sector: 'Fintech & paiements',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'SHOP.TO', name: 'Shopify', rationale: 'Partenaire commercial étroit dont Shopify Payments s’appuie largement sur Stripe.' },
            { symbol: 'ADYEN.AS', name: 'Adyen', rationale: 'Pair coté européen du traitement des paiements d’entreprise.' },
        ],
    },
    {
        name: 'Databricks',
        aliases: ['databricks'],
        sector: 'Données & IA d’entreprise',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'SNOW', name: 'Snowflake', rationale: 'Concurrent direct coté dans les plateformes de données infonuagiques.' },
            { symbol: 'MSFT', name: 'Microsoft', rationale: 'Partenaire cloud majeur (Azure Databricks).' },
        ],
    },
    {
        name: 'xAI',
        aliases: ['xai', 'grok'],
        sector: 'Intelligence artificielle',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'TSLA', name: 'Tesla', rationale: 'Synergies d’IA embarquée et liens opérationnels avec l’écosystème Elon Musk.' },
            { symbol: 'NVDA', name: 'NVIDIA', rationale: 'Fournisseur des grappes GPU utilisées pour l’entraînement.' },
        ],
    },
    {
        name: 'Mistral AI',
        aliases: ['mistral', 'mistral ai'],
        sector: 'Intelligence artificielle (Europe)',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'MSFT', name: 'Microsoft', rationale: 'Partenaire et investisseur minoritaire distribuant Mistral sur Azure.' },
        ],
    },
    {
        name: 'Perplexity',
        aliases: ['perplexity', 'perplexity ai'],
        sector: 'Recherche IA',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'NVDA', name: 'NVIDIA', rationale: 'Investisseur stratégique et fournisseur d’infrastructure IA.' },
            { symbol: 'AMZN', name: 'Amazon.com', rationale: 'Infrastructure AWS et investissement via Jeff Bezos.' },
        ],
    },
    {
        name: 'Canva',
        aliases: ['canva'],
        sector: 'Logiciel SaaS créatif',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'ADBE', name: 'Adobe', rationale: 'Concurrent coté dominant du logiciel créatif.' },
        ],
    },
    {
        name: 'Scale AI',
        aliases: ['scale ai'],
        sector: 'Infrastructure de données IA',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'PLTR', name: 'Palantir Technologies', rationale: 'Acteur coté des plateformes de données et d’IA décisionnelle.' },
        ],
    },
    {
        name: 'Anduril',
        aliases: ['anduril', 'anduril industries'],
        sector: 'Défense & systèmes autonomes',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'KTOS', name: 'Kratos Defense', rationale: 'Acteur coté des drones et systèmes autonomes de défense.' },
            { symbol: 'PLTR', name: 'Palantir Technologies', rationale: 'Logiciels de défense et partenariats IA.' },
        ],
    },
    {
        name: 'Discord',
        aliases: ['discord'],
        sector: 'Plateforme sociale & communication',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'SONY', name: 'Sony Group', rationale: 'Partenaire stratégique et investisseur minoritaire.' },
        ],
    },
    {
        name: 'Epic Games',
        aliases: ['epic games', 'unreal engine'],
        sector: 'Jeux vidéo & moteurs 3D',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'DIS', name: 'Walt Disney', rationale: 'Investisseur stratégique minoritaire dans Epic Games.' },
            { symbol: 'TCEHY', name: 'Tencent Holdings', rationale: 'Actionnaire minoritaire important d’Epic Games.' },
        ],
    },
    {
        name: 'ByteDance',
        aliases: ['bytedance', 'tiktok'],
        sector: 'Médias sociaux & algorithmes',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'META', name: 'Meta Platforms', rationale: 'Bénéficiaire concurrentiel coté de la publicité vidéo courte (Reels).' },
        ],
    },
    {
        name: 'Cohere',
        aliases: ['cohere'],
        sector: 'IA d’entreprise (Canada)',
        note: 'Entreprise canadienne privée non cotée.',
        proxies: [
            { symbol: 'NVDA', name: 'NVIDIA', rationale: 'Investisseur et fournisseur GPU de Cohere.' },
            { symbol: 'ORCL', name: 'Oracle', rationale: 'Partenaire cloud et investisseur de Cohere.' },
        ],
    },
    {
        name: 'Revolut',
        aliases: ['revolut'],
        sector: 'Néobanque & fintech',
        note: 'Entreprise privée non cotée.',
        proxies: [
            { symbol: 'NU', name: 'Nu Holdings', rationale: 'Pair coté à forte croissance dans la banque numérique.' },
        ],
    },
    {
        name: 'Klarna',
        aliases: ['klarna'],
        sector: 'Paiements & crédit fractionné',
        note: 'Société privée en préparation d’introduction ou accès restreint selon la date.',
        proxies: [
            { symbol: 'AFRM', name: 'Affirm Holdings', rationale: 'Pair coté comparable dans le paiement fractionné.' },
        ],
    },
];

export const VERDICT_LABELS: Record<CommitteeVerdict, string> = {
    ACHETER: 'Acheter',
    ACCUMULER: 'Accumuler graduellement',
    EXPOSITION_INDIRECTE: 'Non coté — Exposition indirecte',
    ATTENDRE: 'Attendre / Surveiller',
    EVITER: 'Éviter pour le moment',
    CONSERVER: 'Conserver / Maintenir',
};

const KNOWN_COMPANY_TICKER_HINTS: ReadonlyArray<[RegExp, { symbol: string; name: string }]> = [
    [/\bnvidia\b/i, { symbol: 'NVDA', name: 'NVIDIA' }],
    [/\bapple\b/i, { symbol: 'AAPL', name: 'Apple' }],
    [/\bmicrosoft\b/i, { symbol: 'MSFT', name: 'Microsoft' }],
    [/\bamazon\b/i, { symbol: 'AMZN', name: 'Amazon' }],
    [/\bgoogle\b|\balphabet\b/i, { symbol: 'GOOGL', name: 'Alphabet' }],
    [/\bmeta\b|\bfacebook\b/i, { symbol: 'META', name: 'Meta Platforms' }],
    [/\btesla\b/i, { symbol: 'TSLA', name: 'Tesla' }],
    [/\bshopify\b/i, { symbol: 'SHOP.TO', name: 'Shopify' }],
    [/\bbitcoin\b|\bbtc\b/i, { symbol: 'BTC-USD', name: 'Bitcoin' }],
    [/\bethereum\b|\beth\b/i, { symbol: 'ETH-USD', name: 'Ethereum' }],
];

function stripAccents(raw: string): string {
    return raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function detectKnownPrivateCompany(text: string): (typeof PRIVATE_COMPANY_DIRECTORY)[number] | null {
    const clean = stripAccents(text).toLowerCase();
    for (const entry of PRIVATE_COMPANY_DIRECTORY) {
        for (const alias of entry.aliases) {
            const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
            if (re.test(clean)) return entry;
        }
    }
    return null;
}

const QUESTION_STOPWORDS = new Set([
    'est', 'ce', 'que', 'ca', 'vaut', 'le', 'coup', 'd', 'de', 'des', 'du', 'un', 'une', 'en',
    'acheter', 'achat', 'vendre', 'vente', 'renforcer', 'alleger', 'investir', 'dans', 'sur',
    'pour', 'avec', 'mon', 'ma', 'mes', 'celi', 'reer', 'celiapp', 'fnb', 'etf', 'action',
    'actions', 'titre', 'titres', 'analyser', 'analyse', 'avis', 'opinion', 'dois', 'je', 'faut',
    'il', 'ou', 'et', 'si', 'aujourd', 'hui', 'maintenant', 'bonne', 'bon', 'idee', 'societe',
    'entreprise', 'compagnie', 'cad', 'usd',
]);

export function extractSubjectFromQuestion(question: string): {
    subject: string;
    explicitTicker: string | null;
    isPortfolioQuestion: boolean;
} {
    const trimmed = question.trim();
    const priv = detectKnownPrivateCompany(trimmed);
    if (priv) {
        return { subject: priv.name, explicitTicker: null, isPortfolioQuestion: false };
    }

    const tickerMatches = trimmed.match(/\b([A-Z]{2,5}(?:\.[A-Z]{1,3}|-USD|-CAD)?)\b/g) ?? [];
    const ignoredUpper = new Set(['IA', 'AI', 'QC', 'CA', 'US', 'USA', 'CELI', 'REER', 'REEE', 'CAD', 'USD', 'EUR', 'ETF', 'FNB', 'IPO', 'DCA', 'PME', 'TSX', 'NASDAQ', 'NYSE']);
    const explicitTicker = tickerMatches.find((t) => !ignoredUpper.has(t.toUpperCase())) ?? null;

    if (explicitTicker) {
        return { subject: explicitTicker, explicitTicker, isPortfolioQuestion: false };
    }

    for (const [re, hint] of KNOWN_COMPANY_TICKER_HINTS) {
        if (re.test(trimmed)) {
            return { subject: `${hint.name} (${hint.symbol})`, explicitTicker: hint.symbol, isPortfolioQuestion: false };
        }
    }

    const low = stripAccents(trimmed).toLowerCase();
    if (/\b(mon portefeuille|mes placements|mes titres|trop concentre|reequilibrer|diversification)\b/.test(low)) {
        return { subject: 'Portefeuille global', explicitTicker: null, isPortfolioQuestion: true };
    }

    const tokens = stripAccents(trimmed)
        .replace(/[?!.,:;'"()[\]{}]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 2 && !QUESTION_STOPWORDS.has(w.toLowerCase()));

    const candidate = tokens.slice(0, 4).join(' ').trim();
    return {
        subject: candidate || trimmed.slice(0, 60),
        explicitTicker: null,
        isPortfolioQuestion: false,
    };
}

export interface AnonymizedHoldingSummary {
    code: string;
    sector: string;
    region: string;
    accountType: string;
    weightPct: number;
    annualYieldPct: number | null;
    matchesSubject: boolean;
}

export interface AnonymizedPortfolioContext {
    totalValueCad: number | null;
    holdingCount: number;
    envelopesCad: Record<string, number>;
    envelopesPct: Record<string, number>;
    topSectorsPct: Array<{ sector: string; weightPct: number }>;
    holdings: AnonymizedHoldingSummary[];
    alreadyHeldPct: number | null;
    alreadyHeldAccounts: string[];
    marginalTaxRatePct: number | null;
    riskProfileLabel: string | null;
}

export function anonymizePortfolioForCommittee(
    state: AppState,
    resolvedTicker: string | null,
    subject: string,
): AnonymizedPortfolioContext {
    const assets: Asset[] = Array.isArray(state.assets) ? state.assets : [];
    const fxRates = state.fxRates;
    const subjectUpper = (resolvedTicker || subject || '').trim().toUpperCase();

    const valued = assets
        .map((a) => ({
            asset: a,
            cad: assetValueCad(a, fxRates),
        }))
        .filter((x) => Number.isFinite(x.cad) && x.cad > 0)
        .sort((a, b) => b.cad - a.cad);

    const totalRaw = valued.reduce((s, x) => s + x.cad, 0);
    const totalValueCad = totalRaw > 0 ? Math.round(totalRaw) : null;

    const envelopesCad: Record<string, number> = {};
    const sectorTotals: Record<string, number> = {};
    let alreadyHeldCad = 0;
    const alreadyHeldAccountsSet = new Set<string>();

    const holdings: AnonymizedHoldingSummary[] = valued.slice(0, MAX_HOLDINGS_PROMPT).map((item, idx) => {
        const acct = item.asset.accountType || 'NON-ENREG';
        envelopesCad[acct] = (envelopesCad[acct] ?? 0) + item.cad;
        const sec = item.asset.sector || 'Autre';
        sectorTotals[sec] = (sectorTotals[sec] ?? 0) + item.cad;

        const symUpper = (item.asset.symbol || '').trim().toUpperCase();
        const nameUpper = (item.asset.name || '').trim().toUpperCase();
        const matchesSubject = Boolean(
            subjectUpper &&
                (symUpper === subjectUpper ||
                    symUpper.split('.')[0] === subjectUpper.split('.')[0] ||
                    (subjectUpper.length >= 4 && nameUpper.includes(subjectUpper))),
        );
        if (matchesSubject) {
            alreadyHeldCad += item.cad;
            alreadyHeldAccountsSet.add(acct);
        }

        return {
            code: `ACTIF_${String(idx + 1).padStart(2, '0')}`,
            sector: sec,
            region: item.asset.region || 'Global',
            accountType: acct,
            weightPct: totalRaw > 0 ? Number(((item.cad / totalRaw) * 100).toFixed(1)) : 0,
            annualYieldPct:
                typeof item.asset.dividendYield === 'number' && Number.isFinite(item.asset.dividendYield)
                    ? Number(item.asset.dividendYield.toFixed(2))
                    : null,
            matchesSubject,
        };
    });

    // Inclure aussi les lignes au-delà de MAX_HOLDINGS_PROMPT dans les agrégats d'enveloppes/secteurs
    for (const item of valued.slice(MAX_HOLDINGS_PROMPT)) {
        const acct = item.asset.accountType || 'NON-ENREG';
        envelopesCad[acct] = (envelopesCad[acct] ?? 0) + item.cad;
        const sec = item.asset.sector || 'Autre';
        sectorTotals[sec] = (sectorTotals[sec] ?? 0) + item.cad;
    }

    const envelopesPct: Record<string, number> = {};
    if (totalRaw > 0) {
        for (const [k, v] of Object.entries(envelopesCad)) {
            envelopesPct[k] = Number(((v / totalRaw) * 100).toFixed(1));
        }
    }

    const topSectorsPct = Object.entries(sectorTotals)
        .map(([sector, v]) => ({
            sector,
            weightPct: totalRaw > 0 ? Number(((v / totalRaw) * 100).toFixed(1)) : 0,
        }))
        .sort((a, b) => b.weightPct - a.weightPct)
        .slice(0, 6);

    let marginalTaxRatePct: number | null = null;
    try {
        const u0 = state.config?.users?.[0];
        const grossMonthly = Number(u0?.grossSalary);
        if (Number.isFinite(grossMonthly) && grossMonthly > 0) {
            // Salaires du profil sont MENSUELS (x12 pour l'annuel, règle FISCAL_REFERENCE)
            const fiscal = calculateFiscalReport(grossMonthly * 12, 0, 0, new Date().getFullYear());
            if (Number.isFinite(fiscal.marginalRate) && fiscal.marginalRate > 0) {
                marginalTaxRatePct = Number(fiscal.marginalRate.toFixed(1));
            }
        }
    } catch {
        marginalTaxRatePct = null;
    }

    const riskProfileLabel =
        typeof state.valoriaRiskProfile === 'string' && state.valoriaRiskProfile.trim()
            ? state.valoriaRiskProfile.trim()
            : null;

    return {
        totalValueCad,
        holdingCount: valued.length,
        envelopesCad,
        envelopesPct,
        topSectorsPct,
        holdings,
        alreadyHeldPct: totalRaw > 0 && alreadyHeldCad > 0 ? Number(((alreadyHeldCad / totalRaw) * 100).toFixed(1)) : null,
        alreadyHeldAccounts: Array.from(alreadyHeldAccountsSet),
        marginalTaxRatePct,
        riskProfileLabel,
    };
}

export interface CommitteeCollectedContext {
    question: string;
    subject: string;
    entityStatus: CommitteeEntityStatus;
    resolvedTicker: string | null;
    privateEntry: (typeof PRIVATE_COMPANY_DIRECTORY)[number] | null;
    liveQuote: CommitteeLiveQuote | null;
    news: CommitteeNewsHeadline[];
    portfolio: AnonymizedPortfolioContext;
    targetAmountCad: number | null;
}

async function fetchJsonWithTimeout(
    fetchFn: typeof fetch,
    url: string,
    signal?: AbortSignal,
    timeoutMs: number = MARKET_FETCH_TIMEOUT_MS,
): Promise<unknown | null> {
    const ac = new AbortController();
    const onParentAbort = () => ac.abort(signal?.reason);
    if (signal) {
        if (signal.aborted) return null;
        signal.addEventListener('abort', onParentAbort, { once: true });
    }
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
        const res = await fetchFn(url, { signal: ac.signal });
        if (!res.ok) return null;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return null;
        return (await res.json()) as unknown;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onParentAbort);
    }
}

function isStrictHttpUrl(raw: unknown): raw is string {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    try {
        const u = new URL(raw.trim());
        return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
        return false;
    }
}

function domainOfUrl(raw: string): string {
    try {
        return new URL(raw).hostname.replace(/^www\./i, '');
    } catch {
        return '';
    }
}

function mergeSources(...groups: Array<ReadonlyArray<CommitteeSourceLink>>): CommitteeSourceLink[] {
    const seen = new Set<string>();
    const out: CommitteeSourceLink[] = [];
    for (const list of groups) {
        for (const s of list) {
            if (!isStrictHttpUrl(s.url)) continue;
            const norm = s.url.trim();
            if (seen.has(norm)) continue;
            seen.add(norm);
            out.push({
                title: s.title?.trim() || domainOfUrl(norm) || 'Source',
                url: norm,
                domain: s.domain?.trim() || domainOfUrl(norm),
            });
        }
    }
    return out.slice(0, 14);
}

export async function collectCommitteeContext(params: {
    question: string;
    state: AppState;
    isPrivacyMode?: boolean;
    targetAmountCad?: number;
    signal?: AbortSignal;
    fetchFn?: typeof fetch;
}): Promise<CommitteeCollectedContext> {
    const privacy = params.isPrivacyMode ?? Boolean((params.state as AppState & { isPrivacyMode?: boolean }).isPrivacyMode);
    if (privacy) {
        throw new Error(MESSAGE_IA_MODE_DISCRET);
    }
    const fetchFn = params.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
    const canFetch = Boolean(params.fetchFn || (fetchFn && typeof window !== 'undefined'));
    const extracted = extractSubjectFromQuestion(params.question);
    const privateEntry = detectKnownPrivateCompany(params.question);

    let entityStatus: CommitteeEntityStatus = privateEntry
        ? 'private_unlisted'
        : extracted.isPortfolioQuestion
          ? 'portfolio_question'
          : extracted.explicitTicker
            ? 'public_listed'
            : 'sector_or_theme';

    let resolvedTicker: string | null = privateEntry ? null : extracted.explicitTicker;
    let liveQuote: CommitteeLiveQuote | null = null;
    const news: CommitteeNewsHeadline[] = [];

    if (!privateEntry && !extracted.isPortfolioQuestion && canFetch && fetchFn) {
        const searchTerm = resolvedTicker || extracted.subject;
        if (!resolvedTicker && searchTerm.length >= 2) {
            const searchJson = (await fetchJsonWithTimeout(
                fetchFn,
                `/api/yahoo/search?q=${encodeURIComponent(searchTerm)}&quotesCount=5&newsCount=4`,
                params.signal,
            )) as { quotes?: Array<Record<string, unknown>>; news?: Array<Record<string, unknown>> } | null;

            const quotes = Array.isArray(searchJson?.quotes) ? searchJson.quotes : [];
            const termLower = stripAccents(searchTerm).toLowerCase();
            const match = quotes.find((q) => {
                const sym = String(q.symbol ?? '').trim().toUpperCase();
                const shortname = stripAccents(String(q.shortname ?? q.longname ?? '')).toLowerCase();
                const qt = String(q.quoteType ?? '').toUpperCase();
                if (!sym || !['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND'].includes(qt)) return false;
                return sym.toLowerCase() === termLower || shortname.includes(termLower);
            });
            if (match) {
                resolvedTicker = String(match.symbol).trim().toUpperCase();
                entityStatus = 'public_listed';
            }
            for (const n of Array.isArray(searchJson?.news) ? searchJson.news.slice(0, 4) : []) {
                const title = String(n.title ?? '').trim();
                if (!title) continue;
                news.push({
                    title,
                    publisher: String(n.publisher ?? 'Actualité'),
                    publishedAt: n.providerPublishTime
                        ? new Date(Number(n.providerPublishTime) * 1000).toISOString().slice(0, 10)
                        : '',
                    url: isStrictHttpUrl(n.link) ? String(n.link) : null,
                });
            }
        }
    }

    // Catalogue local Valoria (non bloquant, import dynamique pour éviter de gonfler les chunks boot)
    if (!privateEntry && resolvedTicker) {
        try {
            const { resolveFinanceAISymbol } = await import('../valoria/financeAiBridge');
            const valoriaMatch = resolveFinanceAISymbol(resolvedTicker, resolvedTicker, extracted.subject);
            if (valoriaMatch) {
                resolvedTicker = valoriaMatch.ticker || resolvedTicker;
                entityStatus = 'public_listed';
            }
        } catch {
            // Optionnel : ne bloque jamais l'analyse
        }
    }

    if (entityStatus === 'public_listed' && resolvedTicker && canFetch && fetchFn) {
        const [quoteJson, newsJson] = await Promise.all([
            fetchJsonWithTimeout(
                fetchFn,
                `/api/market/quote?symbol=${encodeURIComponent(resolvedTicker)}`,
                params.signal,
            ) as Promise<{
                liveAvailable?: boolean;
                registration?: {
                    ticker?: string;
                    name?: string;
                    spotCad?: number;
                    nativeCurrency?: string;
                    fxToCad?: number;
                    volatilityPct?: number;
                    category?: string;
                    monthlyHistoryCad?: Record<string, number>;
                };
            } | null>,
            fetchJsonWithTimeout(
                fetchFn,
                `/api/news/intelligence?tickers=${encodeURIComponent(resolvedTicker)}`,
                params.signal,
            ) as Promise<{
                articles?: Array<{ title?: string; publisher?: string; publishedAt?: string; url?: string }>;
            } | null>,
        ]);

        if (quoteJson?.liveAvailable && quoteJson.registration) {
            const reg = quoteJson.registration;
            const spotCad = typeof reg.spotCad === 'number' && Number.isFinite(reg.spotCad) ? reg.spotCad : null;
            const fx = typeof reg.fxToCad === 'number' && Number.isFinite(reg.fxToCad) && reg.fxToCad > 0 ? reg.fxToCad : null;
            const nativePrice = spotCad !== null && fx !== null ? Number((spotCad / fx).toFixed(2)) : null;

            let trailing1YReturnPct: number | null = null;
            if (reg.monthlyHistoryCad && typeof reg.monthlyHistoryCad === 'object') {
                const entries = Object.entries(reg.monthlyHistoryCad)
                    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
                    .sort(([a], [b]) => a.localeCompare(b));
                if (entries.length >= 13) {
                    const last = entries[entries.length - 1]![1];
                    const prevYear = entries[entries.length - 13]![1];
                    if (prevYear > 0) {
                        trailing1YReturnPct = Number((((last - prevYear) / prevYear) * 100).toFixed(1));
                    }
                }
            }

            liveQuote = {
                symbol: String(reg.ticker || resolvedTicker),
                name: String(reg.name || extracted.subject),
                priceCad: spotCad,
                nativePrice,
                currency: reg.nativeCurrency ? String(reg.nativeCurrency) : null,
                volatilityPct:
                    typeof reg.volatilityPct === 'number' && Number.isFinite(reg.volatilityPct)
                        ? reg.volatilityPct
                        : null,
                trailing1YReturnPct,
                categoryLabel: reg.category ? String(reg.category) : null,
            };
        }

        if (Array.isArray(newsJson?.articles)) {
            for (const a of newsJson.articles.slice(0, 5)) {
                const title = String(a.title ?? '').trim();
                if (!title) continue;
                news.push({
                    title,
                    publisher: String(a.publisher ?? 'Actualité financière'),
                    publishedAt: String(a.publishedAt ?? ''),
                    url: isStrictHttpUrl(a.url) ? String(a.url) : null,
                });
            }
        }
    }

    const portfolio = anonymizePortfolioForCommittee(params.state, resolvedTicker, extracted.subject);
    const targetAmountCad =
        typeof params.targetAmountCad === 'number' &&
        Number.isFinite(params.targetAmountCad) &&
        params.targetAmountCad > 0
            ? Math.round(params.targetAmountCad)
            : null;

    return {
        question: params.question.trim(),
        subject: extracted.subject,
        entityStatus,
        resolvedTicker,
        privateEntry,
        liveQuote,
        news,
        portfolio,
        targetAmountCad,
    };
}

// ── Client Gemini paresseux avec Google Search Grounding ───────────────────────

const estErreurCleOuAuth = (err: unknown): boolean => {
    const status = (err as { status?: unknown } | null)?.status;
    const msg = String((err as { message?: unknown } | null)?.message ?? '');
    return status === 401 || /API_KEY_INVALID|API key not valid/i.test(msg);
};

const estAbortError = (err: unknown): boolean =>
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');

function extractGroundingSources(rep: unknown): CommitteeSourceLink[] {
    const candidates = (rep as { candidates?: Array<{ groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> } }> } | null)?.candidates;
    const chunks = candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const collected: CommitteeSourceLink[] = [];
    for (const c of chunks) {
        const uri = c?.web?.uri;
        if (!isStrictHttpUrl(uri)) continue;
        collected.push({
            title: String(c?.web?.title ?? '').trim() || domainOfUrl(uri) || 'Source web',
            url: uri.trim(),
            domain: domainOfUrl(uri),
        });
    }
    return mergeSources(collected);
}

export function createGeminiCommitteeRunner(apiKey: string): CommitteeAgentRunner {
    const cleanKey = apiKey.replace(/^["'\s]+|["'\s]+$/g, '');
    if (!cleanKey) {
        throw new Error('Clé API Google Gemini manquante.');
    }
    let sdkPromise: Promise<typeof import('@google/genai')> | null = null;

    return async (req: CommitteeAgentCallRequest): Promise<CommitteeAgentCallResponse> => {
        if (req.signal?.aborted) {
            throw req.signal.reason ?? new DOMException('Aborted', 'AbortError');
        }
        sdkPromise ??= import('@google/genai');
        const { GoogleGenAI } = await sdkPromise;
        const ai = new GoogleGenAI({ apiKey: cleanKey });

        const invokeOnce = async (withSearch: boolean): Promise<CommitteeAgentCallResponse> => {
            const rep = await ai.models.generateContent({
                model: req.model,
                contents: req.prompt,
                config: {
                    systemInstruction: req.systemInstruction,
                    tools: withSearch ? [{ googleSearch: {} }] : undefined,
                    temperature: 0.25,
                    maxOutputTokens: 2048,
                    abortSignal: req.signal,
                },
            });

            const usage = rep.usageMetadata;
            signalerUsageIa(
                req.model,
                usage
                    ? {
                          input_tokens: usage.promptTokenCount ?? null,
                          output_tokens: usage.candidatesTokenCount ?? null,
                      }
                    : null,
            );

            return {
                text: rep.text ?? '',
                sources: withSearch ? extractGroundingSources(rep) : [],
                usedWebSearch: withSearch,
                modelUsed: req.model,
            };
        };

        try {
            return await invokeOnce(req.useWebSearch);
        } catch (err) {
            if (estAbortError(err) || estErreurCleOuAuth(err)) throw err;
            if (req.useWebSearch) {
                return await invokeOnce(false);
            }
            throw err;
        }
    };
}

// ── Parsing JSON tolérant + Schémas Zod ────────────────────────────────────────

const specialistOutputSchema = z.object({
    stance: z.enum(['FAVORABLE', 'PRUDENT', 'DEFAVORABLE', 'INDIRECT', 'NEUTRE']),
    confidence: z.number().min(0).max(100).nullable().optional(),
    summary: z.string().min(5).max(900),
    keyPoints: z.array(z.string().min(2).max(260)).max(6).default([]),
    risks: z.array(z.string().min(2).max(260)).max(6).default([]),
});

const chairOutputSchema = z.object({
    entityStatus: z.enum(['public_listed', 'private_unlisted', 'sector_or_theme', 'portfolio_question']).optional(),
    resolvedTicker: z.string().max(24).nullable().optional(),
    verdict: z.enum(['ACHETER', 'ACCUMULER', 'EXPOSITION_INDIRECTE', 'ATTENDRE', 'EVITER', 'CONSERVER']),
    conviction: z.number().min(0).max(100).nullable().optional(),
    executiveSummary: z.string().min(10).max(1200),
    consensus: z.array(z.string().min(2).max(260)).max(6).default([]),
    disagreements: z.array(z.string().min(2).max(260)).max(6).default([]),
    actionPlan: z.array(z.string().min(2).max(260)).max(6).default([]),
    indirectProxies: z
        .array(
            z.object({
                symbol: z.string().min(1).max(20),
                name: z.string().min(1).max(80),
                rationale: z.string().min(2).max(260),
            }),
        )
        .max(5)
        .default([]),
    invalidationConditions: z.array(z.string().min(2).max(260)).max(5).default([]),
    recommendedWrapper: z.string().max(120).nullable().optional(),
});

function extractJsonObject(raw: string): unknown | null {
    if (!raw || typeof raw !== 'string') return null;
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
        return JSON.parse(cleaned.slice(first, last + 1));
    } catch {
        return null;
    }
}

// ── Meta des 4 spécialistes & Génération des prompts ───────────────────────────

const SPECIALIST_META: Record<
    CommitteeSpecialistAgentId,
    { title: string; role: string; useWebSearch: boolean }
> = {
    market_news: {
        title: 'Agent Marché & Actus Web',
        role: 'Cotations, actualités récentes et catalyseurs',
        useWebSearch: true,
    },
    fundamentals: {
        title: 'Agent Fondamentaux & Valorisation',
        role: 'Modèle d’affaires, croissance, multiples ou accès privé',
        useWebSearch: true,
    },
    risk_bear: {
        title: 'Agent Risques & Avocat du diable',
        role: 'Contre-thèse critique, illiquidité et risques majeurs',
        useWebSearch: true,
    },
    portfolio_qc_tax: {
        title: 'Agent Portefeuille & Fiscalité QC',
        role: 'Chevauchement réel, taille de position, CELI/REER/Non-enreg.',
        useWebSearch: false,
    },
};

function buildPromptDataBlock(ctx: CommitteeCollectedContext): string {
    const safeQuestion = sanitizePromptText(ctx.question, 320);
    const safeSubject = sanitizePromptText(ctx.subject, 80);
    const newsLines = ctx.news.slice(0, 5).map((n) => ({
        titre: sanitizePromptText(n.title, 120),
        source: sanitizePromptText(n.publisher, 40),
        date: n.publishedAt,
    }));

    return wrapUserData(
        JSON.stringify(
            {
                dateDuJour: new Date().toISOString().slice(0, 10),
                question: safeQuestion,
                sujetDetecte: safeSubject,
                statutInitial: ctx.entityStatus,
                symboleResolu: ctx.resolvedTicker,
                societePriveeConnue: ctx.privateEntry
                    ? {
                          nom: ctx.privateEntry.name,
                          secteur: ctx.privateEntry.sector,
                          note: ctx.privateEntry.note,
                          proxiesIndirectsCotés: ctx.privateEntry.proxies,
                      }
                    : null,
                cotationReelle: ctx.liveQuote,
                actualitesCollectees: newsLines,
                montantCibleCad: ctx.targetAmountCad,
                portefeuilleAnonymise: ctx.portfolio,
            },
            null,
            2,
        ),
    );
}

function buildSpecialistSystemPrompt(
    agentId: CommitteeSpecialistAgentId,
    isTestMode: boolean | undefined,
): string {
    const directives: Record<CommitteeSpecialistAgentId, string> = {
        market_news:
            'Tu es l’Agent Marché & Actualités Web d’un comité d’investissement institutionnel canadien. Vérifie sur le Web si l’actif est coté publiquement ou société privée non cotée (ex. Anthropic, OpenAI, SpaceX), sa valorisation ou actualité récente et les catalyseurs vérifiables. N’invente aucun cours ni chiffre absent.',
        fundamentals:
            'Tu es l’Agent Fondamentaux & Valorisation. Analyse le modèle d’affaires, l’avantage concurrentiel, la rentabilité ou — pour une entreprise privée non cotée — les rondes de financement connues, l’éventuel horizon d’IPO sans certitude fabriquée et les meilleurs vecteurs d’exposition indirecte cotés.',
        risk_bear:
            'Tu es l’Agent Risques & Avocat du diable. Ta mission est de contredire l’enthousiasme : pointe les risques de valorisation, concurrence, dilution, illiquidité (marché secondaire privé vs bourse), risque réglementaire ou biais comportemental. Sois franc et nuancé.',
        portfolio_qc_tax:
            'Tu es l’Agent Portefeuille & Fiscalité Québec/Canada. Analyse l’ajustement au portefeuille anonymisé (ACTIF_01..12), le chevauchement sectoriel/technologique, la taille de position prudente, et l’enveloppe fiscale canadienne optimale (CELI vs REER vs CELIAPP vs Non-enregistré, en tenant compte de la retenue US 15 % sur dividendes US en CELI vs exemption en REER selon le traité Canada-US).',
    };

    const base = [
        directives[agentId],
        'RÈGLE STRICTE NO-FAKE-DATA : si un chiffre exact (PER, valorisation, chiffre d’affaires, cours) est inconnu ou non confirmé, dis-le explicitement ou mets confidence: null — n’invente JAMAIS de montant ou de multiple.',
        'Réponds UNIQUEMENT en JSON valide (sans texte hors JSON) respectant exactement ce schéma :',
        '{"stance":"FAVORABLE|PRUDENT|DEFAVORABLE|INDIRECT|NEUTRE","confidence":0-100|null,"summary":"2-3 phrases directes en français","keyPoints":["..."],"risks":["..."]}',
        PROMPT_DATA_ISOLATION_NOTE,
    ].join('\n');

    return marquerSystemFictif(base, Boolean(isTestMode)) ?? base;
}

function buildChairSystemPrompt(isTestMode: boolean | undefined): string {
    const base = [
        'Tu es le Président du Comité d’Investissement de FinanceAI (Québec / Canada). Tu viens de lire les rapports de tes 4 agents indépendants.',
        'Rends un verdict final clair, nuancé et actionnable en français.',
        'RÈGLES CRITIQUES :',
        '1) Si la cible est une entreprise PRIVÉE non cotée (ex. Anthropic, OpenAI, SpaceX), utilise entityStatus="private_unlisted" et verdict="EXPOSITION_INDIRECTE" ou "ATTENDRE" : explique honnêtement qu’un particulier ne peut pas acheter l’action directement en CELI/REER, explique la piste des fonds privés accrédités/marché secondaire (frais/illiquidité), et propose des véhicules d’exposition indirecte cotés réalistes.',
        '2) Souligne explicitement les ACCORDS (consensus) ET les DÉSACCORDS (disagreements) entre tes 4 agents.',
        '3) Fixe 2 à 3 conditions concrètes qui changeraient ton verdict (invalidationConditions).',
        '4) NO-FAKE-DATA : aucune donnée inventée.',
        'Réponds UNIQUEMENT en JSON valide respectant exactement ce schéma :',
        '{"entityStatus":"public_listed|private_unlisted|sector_or_theme|portfolio_question","resolvedTicker":"SYMBOLE|null","verdict":"ACHETER|ACCUMULER|EXPOSITION_INDIRECTE|ATTENDRE|EVITER|CONSERVER","conviction":0-100|null,"executiveSummary":"3-4 phrases directes commençant par la conclusion honnête","consensus":["..."],"disagreements":["..."],"actionPlan":["..."],"indirectProxies":[{"symbol":"...","name":"...","rationale":"..."}],"invalidationConditions":["..."],"recommendedWrapper":"CELI|REER|CELIAPP|Non-enregistré|Non applicable (privé)|null"}',
        PROMPT_DATA_ISOLATION_NOTE,
    ].join('\n');

    return marquerSystemFictif(base, Boolean(isTestMode)) ?? base;
}

// ── Repli déterministe honnête sans fabrication de chiffres ───────────────────

function buildDeterministicSpecialistReport(
    agentId: CommitteeSpecialistAgentId,
    ctx: CommitteeCollectedContext,
): CommitteeAgentReport {
    const meta = SPECIALIST_META[agentId];
    const newsSources: CommitteeSourceLink[] = ctx.news
        .filter((n) => n.url)
        .map((n) => ({ title: n.title, url: n.url!, domain: domainOfUrl(n.url!) }));

    if (ctx.entityStatus === 'private_unlisted') {
        const privName = ctx.privateEntry?.name ?? ctx.subject;
        const proxies = [...(ctx.privateEntry?.proxies ?? [])];
        if (agentId === 'market_news') {
            return {
                id: agentId,
                title: meta.title,
                role: meta.role,
                stance: 'INDIRECT',
                confidence: null,
                summary: `${privName} est une société privée non cotée en bourse : aucune cotation publique temps réel n’existe sur TSX ou NASDAQ.`,
                keyPoints: [
                    ctx.privateEntry?.note ?? 'Statut privé non coté : achat direct impossible via un courtier grand public.',
                    'Active la clé API Google Gemini pour rechercher les dernières rondes de financement et valorisations sur le Web.',
                ],
                risks: ['Aucune cotation continue permettant de vérifier un prix de marché journalier.'],
                sources: [],
                sourceMode: 'fallback',
            };
        }
        if (agentId === 'fundamentals') {
            return {
                id: agentId,
                title: meta.title,
                role: meta.role,
                stance: proxies.length > 0 ? 'INDIRECT' : 'PRUDENT',
                confidence: null,
                summary:
                    proxies.length > 0
                        ? `L’accès boursier à ${privName} passe uniquement par des sociétés ou FNB cotés partenaires (${proxies.map((p) => p.symbol).join(', ')}).`
                        : `Sans états financiers publics vérifiables ni recherche Web active, les fondamentaux de ${privName} ne peuvent être chiffrés.`,
                keyPoints:
                    proxies.length > 0
                        ? proxies.map((p) => `${p.symbol} (${p.name}) : ${p.rationale}`)
                        : ['Comparer avec des leaders publics du même secteur pour évaluer la cherté relative.'],
                risks: ['L’exposition via un actionnaire coté reste diluée dans son activité principale.'],
                sources: [],
                sourceMode: 'fallback',
            };
        }
        if (agentId === 'risk_bear') {
            return {
                id: agentId,
                title: meta.title,
                role: meta.role,
                stance: 'DEFAVORABLE',
                confidence: null,
                summary: `Investir dans une société privée non cotée implique illiquidité prolongée, dilution potentielle avant IPO et absence de transparence trimestrielle.`,
                keyPoints: [
                    'Inadmissible directement dans un CELI, REER ou CELIAPP auprès d’un courtier détail.',
                    'Risque d’écart important entre valorisation privée tardive et prix d’introduction en bourse.',
                ],
                risks: [
                    'Plateformes secondaires réservées aux investisseurs qualifiés avec frais élevés et blocage du capital.',
                    'Concurrence intense et besoins de capitaux élevés dans l’IA de pointe.',
                ],
                sources: [],
                sourceMode: 'fallback',
            };
        }
        // portfolio_qc_tax
        const techWeight = ctx.portfolio.topSectorsPct.find((s) => /tech/i.test(s.sector))?.weightPct ?? null;
        return {
            id: agentId,
            title: meta.title,
            role: meta.role,
            stance: 'PRUDENT',
            confidence: null,
            summary: `Une société non cotée américaine n’est pas admissible en CELI/REER standard ; une exposition indirecte cotée (ou FNB mondial) reste fiscalement propre.`,
            keyPoints: [
                ctx.portfolio.totalValueCad !== null
                    ? `Portefeuille suivi : ${ctx.portfolio.holdingCount} position(s) active(s)${techWeight !== null ? `, dont ${techWeight.toFixed(1)} % déjà en Technologie` : ''}.`
                    : 'Aucune position détenue enregistrée actuellement : commencer par un socle diversifié (ex. FNB mondial) avant tout pari thématique.',
                ctx.portfolio.marginalTaxRatePct !== null
                    ? `Taux marginal estimé QC : ${ctx.portfolio.marginalTaxRatePct.toFixed(1)} % — privilégier CELI ou REER pour tout véhicule coté à fort potentiel.`
                    : 'Pour des titres américains cotés à dividendes faibles, le CELI protège le gain en capital ; pour des dividendes US élevés, le REER évite la retenue de 15 %.',
            ],
            risks: ['Éviter de dépasser 5 % à 10 % du portefeuille sur un thème technologique unique.'],
            sources: [],
            sourceMode: 'fallback',
        };
    }

    // Titre coté ou portefeuille global (mode fallback déterministe strict no-fake-data)
    const label = ctx.liveQuote ? `${ctx.liveQuote.name} (${ctx.liveQuote.symbol})` : ctx.subject;
    if (agentId === 'market_news') {
        return {
            id: agentId,
            title: meta.title,
            role: meta.role,
            stance: 'NEUTRE',
            confidence: null,
            summary: ctx.liveQuote
                ? `${label} dispose d’une cotation relevée en temps réel (${ctx.liveQuote.priceCad !== null ? formatCAD(ctx.liveQuote.priceCad) : 'cours indisponible'}).`
                : `Analyse locale sans accès au moteur Gemini Web pour ${label}.`,
            keyPoints:
                ctx.news.length > 0
                    ? ctx.news.slice(0, 3).map((n) => `${n.title} (${n.publisher})`)
                    : ['Aucune dépêche récente récupérée localement pour ce sujet.'],
            risks: ['Analyse qualitative Web indisponible tant que la clé Google Gemini n’est pas activée.'],
            sources: newsSources,
            sourceMode: 'fallback',
        };
    }
    if (agentId === 'fundamentals') {
        return {
            id: agentId,
            title: meta.title,
            role: meta.role,
            stance: 'PRUDENT',
            confidence: null,
            summary: ctx.liveQuote
                ? `Paramètres observés pour ${label} : volatilité annualisée estimée ${ctx.liveQuote.volatilityPct !== null ? `${ctx.liveQuote.volatilityPct.toFixed(1)} %` : '—'}${ctx.liveQuote.trailing1YReturnPct !== null ? `, rendement 12 mois ${ctx.liveQuote.trailing1YReturnPct > 0 ? '+' : ''}${ctx.liveQuote.trailing1YReturnPct.toFixed(1)} %` : ''}.`
                : `Les ratios fondamentaux détaillés (PER, flux de trésorerie, marges) ne sont pas fabriqués hors-ligne.`,
            keyPoints: [
                ctx.liveQuote?.categoryLabel
                    ? `Catégorie de marché identifiée : ${ctx.liveQuote.categoryLabel}.`
                    : 'Utiliser la recherche Web Gemini pour extraire les derniers résultats trimestriels.',
            ],
            risks: ['Vérifier le ratio valorisation / croissance des bénéfices avant d’engager un montant forfaitaire.'],
            sources: newsSources,
            sourceMode: 'fallback',
        };
    }
    if (agentId === 'risk_bear') {
        return {
            id: agentId,
            title: meta.title,
            role: meta.role,
            stance: 'PRUDENT',
            confidence: null,
            summary: `En l’absence de revue fondamentale Web approfondie, privilégier le fractionnement des achats (DCA) plutôt qu’une entrée en bloc.`,
            keyPoints: [
                ctx.liveQuote?.volatilityPct !== null && ctx.liveQuote?.volatilityPct !== undefined && ctx.liveQuote.volatilityPct > 28
                    ? `Volatilité observée élevée (${ctx.liveQuote.volatilityPct.toFixed(1)} %) : prévoir des variations marquées.`
                    : 'Contrôler le risque spécifique et le risque de change USD/CAD si le titre est coté aux États-Unis.',
            ],
            risks: ['Risque de concentration si la ligne dépasse 10 % du portefeuille total.'],
            sources: [],
            sourceMode: 'fallback',
        };
    }
    return {
        id: agentId,
        title: meta.title,
        role: meta.role,
        stance: ctx.portfolio.alreadyHeldPct !== null && ctx.portfolio.alreadyHeldPct > 15 ? 'PRUDENT' : 'NEUTRE',
        confidence: null,
        summary:
            ctx.portfolio.alreadyHeldPct !== null
                ? `Ce titre pèse déjà ${ctx.portfolio.alreadyHeldPct.toFixed(1)} % de ton portefeuille (${ctx.portfolio.alreadyHeldAccounts.join(', ')}).`
                : `Impact vérifié sur tes ${ctx.portfolio.holdingCount} position(s) actuelle(s) et tes enveloppes QC/CA.`,
        keyPoints: [
            ctx.resolvedTicker?.endsWith('.TO') || ctx.liveQuote?.currency === 'CAD'
                ? 'Titre coté en CAD : adapté au CELI, REER ou CELIAPP sans conversion de devise.'
                : 'Titre étranger : le REER bénéficie de l’exemption de retenue US 15 % sur dividendes américains (sous traité), le CELI optimise surtout le gain en capital.',
        ],
        risks: ['Équilibrer avec le coussin de liquidités et l’horizon de retraite avant d’investir.'],
        sources: [],
        sourceMode: 'fallback',
    };
}

function buildFallbackReport(params: {
    ctx: CommitteeCollectedContext;
    agents: CommitteeAgentReport[];
    startedAt: number;
    fallbackNotice: string;
}): CommitteeAnalysisReport {
    const { ctx, agents, startedAt, fallbackNotice } = params;
    const isPrivate = ctx.entityStatus === 'private_unlisted';
    const verdict: CommitteeVerdict = isPrivate
        ? 'EXPOSITION_INDIRECTE'
        : ctx.portfolio.alreadyHeldPct !== null && ctx.portfolio.alreadyHeldPct > 15
          ? 'CONSERVER'
          : 'ATTENDRE';

    const proxies = [...(ctx.privateEntry?.proxies ?? [])];
    const recommendedWrapper = isPrivate
        ? 'Non applicable directement (entreprise privée — CELI/REER possible via proxies cotés)'
        : ctx.resolvedTicker?.endsWith('.TO') || ctx.liveQuote?.currency === 'CAD'
          ? 'CELI ou CELIAPP en priorité'
          : 'REER (dividendes US exemptés 15 %) ou CELI (gain en capital)';

    const executiveSummary = isPrivate
        ? `${ctx.privateEntry?.name ?? ctx.subject} est une société privée non cotée en bourse : il est impossible d’acheter ses actions directement dans un courtier standard (CELI/REER). Pour capter une part de ce thème tout en gardant liquidité et transparence, le comité local suggère d’étudier des vecteurs cotés indirects (${proxies.map((p) => p.symbol).join(', ') || 'FNB sectoriels/mondiaux'}).`
        : ctx.liveQuote
          ? `${ctx.liveQuote.name} (${ctx.liveQuote.symbol}) cote actuellement autour de ${ctx.liveQuote.priceCad !== null ? formatCAD(ctx.liveQuote.priceCad) : '—'}. Le diagnostic local vérifie votre exposition portefeuille (${ctx.portfolio.holdingCount} position(s)) et la fiscalité QC/CA ; ajoute une clé Google Gemini pour obtenir la recherche Web approfondie et le débat complet des 4 agents.`
          : `Analyse locale préparée pour « ${ctx.subject} » sans appel Gemini Web. Les faits collectés vérifient votre portefeuille réel et la fiscalité QC/CA sans aucun chiffre estimé ou fabriqué.`;

    return {
        id: `committee-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date().toISOString(),
        question: ctx.question,
        subject: ctx.subject,
        entityStatus: ctx.entityStatus,
        resolvedTicker: ctx.resolvedTicker,
        liveQuote: ctx.liveQuote,
        verdict,
        verdictLabel: VERDICT_LABELS[verdict],
        conviction: null,
        executiveSummary,
        consensus: isPrivate
            ? [
                  'Impossibilité d’achat direct au détail sur les places boursières publiques.',
                  'L’exposition indirecte via des partenaires cotés évite l’illiquidité totale.',
              ]
            : ['Privilégier la diversification, le fractionnement (DCA) et l’enveloppe fiscale adaptée au Québec.'],
        disagreements: [
            'L’Agent Fondamentaux explore l’exposition indirecte ou sectorielle, tandis que l’Agent Risques met en garde contre la concentration et le manque de visibilité sans recherche Web Gemini.',
        ],
        actionPlan: isPrivate
            ? [
                  proxies.length > 0
                      ? `Analyser les vecteurs cotés indirects (${proxies.map((p) => p.symbol).join(', ')}) avant d’allouer du capital.`
                      : 'Vérifier s’il existe un FNB ou concurrent coté couvrant ce thème.',
                  'Limiter tout pari thématique concentré à une fraction raisonnable du portefeuille total.',
              ]
            : [
                  'Configurer une clé Google Gemini dans Réglages pour lancer l’analyse Web temps réel des 4 agents.',
                  'Vérifier la capacité de cotisation CELI / REER disponible avant tout achat.',
              ],
        indirectProxies: proxies,
        invalidationConditions: isPrivate
            ? [
                  `Dépôt d’un prospectus officiel d’IPO (S-1 / F-1) rendant ${ctx.privateEntry?.name ?? ctx.subject} cotée en bourse.`,
                  'Baisse majeure de valorisation des grands acteurs publics déjà exposés au même écosystème.',
              ]
            : [
                  'Lancement de l’analyse Web complète avec clé Google Gemini.',
                  'Publication de nouveaux résultats trimestriels modifiant la thèse de croissance.',
              ],
        recommendedWrapper,
        agents,
        sources: mergeSources(
            ctx.news.filter((n) => n.url).map((n) => ({ title: n.title, url: n.url!, domain: domainOfUrl(n.url!) })),
            ...agents.map((a) => a.sources),
        ),
        source: 'fallback',
        fallbackNotice,
        durationMs: Math.max(1, Date.now() - startedAt),
        modelUsed: null,
    };
}

// ── Orchestrateur Principal ────────────────────────────────────────────────────

export interface RunMultiAgentCommitteeOptions {
    question: string;
    state: AppState;
    apiKey: string;
    isPrivacyMode?: boolean;
    isTestMode?: boolean;
    targetAmountCad?: number;
    signal?: AbortSignal;
    onProgress?: (event: CommitteeProgressEvent) => void;
    fetchFn?: typeof fetch;
    agentRunner?: CommitteeAgentRunner;
    model?: string;
}

export async function runMultiAgentCommittee(
    options: RunMultiAgentCommitteeOptions,
): Promise<CommitteeAnalysisReport> {
    const isPrivacy = options.isPrivacyMode ?? Boolean((options.state as AppState & { isPrivacyMode?: boolean }).isPrivacyMode);
    const isTestMode = options.isTestMode ?? Boolean((options.state as AppState & { isTestMode?: boolean }).isTestMode);
    if (isPrivacy) {
        throw new Error(MESSAGE_IA_MODE_DISCRET);
    }
    const q = options.question.trim();
    if (!q) {
        throw new Error('Pose une question ou saisis un titre à analyser.');
    }

    const startedAt = Date.now();
    const agentStates: Record<CommitteeAgentId, CommitteeAgentStatus> = {
        market_news: 'pending',
        fundamentals: 'pending',
        risk_bear: 'pending',
        portfolio_qc_tax: 'pending',
        chair_synthesis: 'pending',
    };

    const emit = (phase: CommitteeProgressEvent['phase'], message: string) => {
        options.onProgress?.({
            phase,
            agentStates: { ...agentStates },
            message,
        });
    };

    emit('gathering', 'Collecte du statut marché, des actualités et du portefeuille anonymisé…');

    const ctx = await collectCommitteeContext({
        question: q,
        state: options.state,
        isPrivacyMode: isPrivacy,
        targetAmountCad: options.targetAmountCad,
        signal: options.signal,
        fetchFn: options.fetchFn,
    });

    if (options.signal?.aborted) {
        throw options.signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    const cleanKey = (options.apiKey || '').replace(/^["'\s]+|["'\s]+$/g, '');
    const runner = options.agentRunner ?? (cleanKey ? createGeminiCommitteeRunner(cleanKey) : null);

    if (!runner) {
        const agents: CommitteeAgentReport[] = (
            ['market_news', 'fundamentals', 'risk_bear', 'portfolio_qc_tax'] as const
        ).map((id) => {
            agentStates[id] = 'fallback';
            return buildDeterministicSpecialistReport(id, ctx);
        });
        agentStates.chair_synthesis = 'fallback';
        emit('done', 'Diagnostic local complété (clé Gemini absente).');
        return buildFallbackReport({
            ctx,
            agents,
            startedAt,
            fallbackNotice:
                'Clé API Google Gemini absente : synthèse produite localement sans recherche Web en direct ni notation chiffrée des 5 agents.',
        });
    }

    const model = options.model ?? DEFAULT_COMMITTEE_MODEL;
    const dataBlock = buildPromptDataBlock(ctx);
    const specialistIds: CommitteeSpecialistAgentId[] = [
        'market_news',
        'fundamentals',
        'risk_bear',
        'portfolio_qc_tax',
    ];

    for (const id of specialistIds) {
        agentStates[id] = 'running';
    }
    emit('agents', 'Les 4 agents spécialistes analysent le dossier en parallèle…');

    let anyAuthError: unknown = null;
    let usedWebAnywhere = false;
    let modelUsed: string | null = model;

    const specialistReports: CommitteeAgentReport[] = await Promise.all(
        specialistIds.map(async (id) => {
            const meta = SPECIALIST_META[id];
            try {
                const resp = await runner({
                    agentId: id,
                    model,
                    systemInstruction: buildSpecialistSystemPrompt(id, isTestMode),
                    prompt: `Analyse cette demande d'investissement selon ton rôle spécialisé :\n\n${dataBlock}`,
                    useWebSearch: meta.useWebSearch,
                    signal: options.signal,
                });
                if (resp.usedWebSearch) usedWebAnywhere = true;
                modelUsed = resp.modelUsed || modelUsed;

                const parsedJson = extractJsonObject(resp.text);
                const validated = specialistOutputSchema.safeParse(parsedJson);
                if (!validated.success) {
                    agentStates[id] = 'fallback';
                    emit('agents', `${meta.title} en repli déterministe (format incomplet).`);
                    return buildDeterministicSpecialistReport(id, ctx);
                }

                agentStates[id] = 'done';
                emit('agents', `${meta.title} a rendu son rapport.`);
                return {
                    id,
                    title: meta.title,
                    role: meta.role,
                    stance: validated.data.stance as CommitteeAgentStance,
                    confidence:
                        validated.data.confidence !== undefined && validated.data.confidence !== null
                            ? Math.round(validated.data.confidence)
                            : null,
                    summary: validated.data.summary.trim(),
                    keyPoints: validated.data.keyPoints.map((p) => p.trim()).filter(Boolean),
                    risks: validated.data.risks.map((r) => r.trim()).filter(Boolean),
                    sources: resp.sources,
                    sourceMode: resp.usedWebSearch ? 'gemini_web' : 'gemini',
                };
            } catch (err) {
                if (estAbortError(err)) throw err;
                if (estErreurCleOuAuth(err)) {
                    anyAuthError = err;
                }
                agentStates[id] = 'fallback';
                emit('agents', `${meta.title} bascule en mode local.`);
                return buildDeterministicSpecialistReport(id, ctx);
            }
        }),
    );

    if (anyAuthError && specialistReports.every((r) => r.sourceMode === 'fallback')) {
        throw anyAuthError;
    }

    if (specialistReports.every((r) => r.sourceMode === 'fallback')) {
        agentStates.chair_synthesis = 'fallback';
        emit('done', 'Comité terminé en repli local (service IA indisponible).');
        return buildFallbackReport({
            ctx,
            agents: specialistReports,
            startedAt,
            fallbackNotice:
                'Google Gemini n’a pas pu répondre (réseau ou quota). Le verdict ci-dessous repose uniquement sur les faits locaux vérifiés.',
        });
    }

    agentStates.chair_synthesis = 'running';
    emit('synthesis', 'Le Président du comité confronte les 4 rapports et rédige le verdict…');

    const reportsForChair = wrapUserData(
        JSON.stringify(
            {
                contexte: {
                    question: sanitizePromptText(ctx.question, 300),
                    sujet: sanitizePromptText(ctx.subject, 80),
                    statutInitial: ctx.entityStatus,
                    symboleResolu: ctx.resolvedTicker,
                    cotationReelle: ctx.liveQuote,
                    societePriveeConnue: ctx.privateEntry
                        ? { nom: ctx.privateEntry.name, proxies: ctx.privateEntry.proxies }
                        : null,
                    portefeuilleAnonymise: ctx.portfolio,
                },
                rapportsDes4Agents: specialistReports.map((r) => ({
                    agent: r.title,
                    position: r.stance,
                    confiance: r.confidence,
                    synthese: r.summary,
                    pointsCles: r.keyPoints,
                    risques: r.risks,
                })),
            },
            null,
            2,
        ),
    );

    try {
        const chairResp = await runner({
            agentId: 'chair_synthesis',
            model,
            systemInstruction: buildChairSystemPrompt(isTestMode),
            prompt: `Synthétise ces 4 rapports indépendants et tranche pour l’utilisateur :\n\n${reportsForChair}`,
            useWebSearch: false,
            signal: options.signal,
        });

        const parsedChair = chairOutputSchema.safeParse(extractJsonObject(chairResp.text));
        if (!parsedChair.success) {
            agentStates.chair_synthesis = 'fallback';
            emit('done', 'Synthèse locale complétée à partir des rapports d’agents.');
            return buildFallbackReport({
                ctx,
                agents: specialistReports,
                startedAt,
                fallbackNotice:
                    'Les 4 agents ont répondu mais la synthèse structurée a basculé sur le résumé local.',
            });
        }

        const c = parsedChair.data;
        const finalStatus: CommitteeEntityStatus = ctx.privateEntry
            ? 'private_unlisted'
            : (c.entityStatus ?? ctx.entityStatus);
        const finalVerdict: CommitteeVerdict =
            finalStatus === 'private_unlisted' && (c.verdict === 'ACHETER' || c.verdict === 'ACCUMULER')
                ? 'EXPOSITION_INDIRECTE'
                : (c.verdict as CommitteeVerdict);
        const finalTicker =
            finalStatus === 'private_unlisted'
                ? null
                : (c.resolvedTicker?.trim().toUpperCase() || ctx.resolvedTicker);

        const proxies: CommitteeIndirectProxy[] =
            c.indirectProxies.length > 0
                ? c.indirectProxies
                : finalStatus === 'private_unlisted'
                  ? [...(ctx.privateEntry?.proxies ?? [])]
                  : [];

        const sources = mergeSources(
            ...specialistReports.map((a) => a.sources),
            chairResp.sources,
            ctx.news
                .filter((n) => n.url)
                .map((n) => ({ title: n.title, url: n.url!, domain: domainOfUrl(n.url!) })),
        );

        agentStates.chair_synthesis = 'done';
        emit('done', 'Analyse multi-agents complétée.');

        return {
            id: `committee-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            createdAt: new Date().toISOString(),
            question: ctx.question,
            subject: ctx.subject,
            entityStatus: finalStatus,
            resolvedTicker: finalTicker,
            liveQuote: finalStatus === 'private_unlisted' ? null : ctx.liveQuote,
            verdict: finalVerdict,
            verdictLabel: VERDICT_LABELS[finalVerdict],
            conviction:
                c.conviction !== undefined && c.conviction !== null ? Math.round(c.conviction) : null,
            executiveSummary: c.executiveSummary.trim(),
            consensus: c.consensus.map((x) => x.trim()).filter(Boolean),
            disagreements: c.disagreements.map((x) => x.trim()).filter(Boolean),
            actionPlan: c.actionPlan.map((x) => x.trim()).filter(Boolean),
            indirectProxies: proxies,
            invalidationConditions: c.invalidationConditions.map((x) => x.trim()).filter(Boolean),
            recommendedWrapper: c.recommendedWrapper?.trim() || null,
            agents: specialistReports,
            sources,
            source: usedWebAnywhere ? 'gemini_web' : 'gemini',
            fallbackNotice: null,
            durationMs: Math.max(1, Date.now() - startedAt),
            modelUsed: chairResp.modelUsed || modelUsed,
        };
    } catch (err) {
        if (estAbortError(err)) throw err;
        agentStates.chair_synthesis = 'fallback';
        emit('done', 'Synthèse locale complétée.');
        return buildFallbackReport({
            ctx,
            agents: specialistReports,
            startedAt,
            fallbackNotice:
                'La synthèse présidentielle IA a échoué ; les 4 rapports d’agents reçus sont présentés avec un résumé local.',
        });
    }
}

/**
 * Construit un bloc Tableau conforme à `blocRicheSchema` résumant les 4 rapports d'agents
 * pour affichage riche dans le fil de l'assistant LIA.
 */
export function buildCommitteeTableauBloc(report: CommitteeAnalysisReport): BlocTableau {
    const conv = report.conviction !== null ? ` · Conviction ${report.conviction}/100` : '';
    const rawTitre = `Comité IA — ${report.subject} : ${report.verdictLabel}${conv}`;
    const titre = rawTitre.length > 118 ? `${rawTitre.slice(0, 117)}…` : rawTitre;
    return {
        type: 'tableau',
        titre,
        colonnes: [
            { cle: 'agent', libelle: 'Agent', unite: 'texte' },
            { cle: 'position', libelle: 'Position', unite: 'texte' },
            { cle: 'synthese', libelle: 'Analyse clé', unite: 'texte' },
        ],
        lignes: report.agents.map((a) => ({
            agent: a.title.slice(0, 196),
            position: a.stance.slice(0, 196),
            synthese: (a.summary || a.keyPoints[0] || '—').slice(0, 196),
        })),
    };
}
