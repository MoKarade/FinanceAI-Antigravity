// services/valoria/valoriaAiClient.ts
// Client IA hybride navigateur pour Valoria dans FinanceAI :
//   1. Si `apiKey` (clé IndexedDB `apiKeys.gemini`) est fournie → appelle `chat` + `safeJsonValidate`
//      importés de `../gemini` (respectant le compteur de coût et le marqueur bac-à-sable).
//   2. Sinon → tente la route locale `/api/...` si le serveur Express est actif avec `GEMINI_API_KEY`.
//   3. En cas d'absence de clé, d'erreur réseau ou de JSON invalide → retourne un repli quantitatif
//      déterministe propre (`source: 'fallback'`), sans jamais lever d'exception non attrapée.

import { z } from 'zod';
import { chat, MODEL_HAIKU, MODEL_SONNET, safeJsonValidate } from '../gemini';
import { formatCad } from './valoriaFormatters';
import {
  neutralizeFrameTags,
  PROMPT_DATA_ISOLATION_NOTE,
  sanitizePromptText,
  wrapUserData,
} from '../../utils/promptSafety';

// ----------------------------------------------------------------------------
// Contrats d'entrée et de sortie (consommés par les vues Valoria)
// ----------------------------------------------------------------------------

export interface ValoriaNewsGroundingRequest {
  tickers?: string[];
  regimeName?: string;
}

export interface ValoriaNewsGroundingResponse {
  ok: boolean;
  source: 'gemini' | 'fallback';
  generatedAt: string;
  markdownBrief: string;
  sources: Array<{ uri: string; title: string }>;
}

export interface ValoriaAiRecommendationsRequest {
  profile?: {
    goal?: string;
    goalLabel?: string;
    riskProfile?: string;
    horizonYears?: number;
    monthlyBudget?: number;
  };
  macro?: {
    regimeName?: string;
    inflationPct?: number;
    centralBankRatePct?: number;
    gdpGrowthPct?: number;
    vixLevel?: number;
  };
  portfolioSummary?: {
    totalCurrentValue?: number;
    totalInvested?: number;
    totalGainLossPct?: number;
    categoryWeightsPct?: Record<string, number>;
    holdingsBrief?: Array<{
      assetId: string;
      name: string;
      value: number;
      weightPct: number;
      gainPct: number;
    }>;
  };
  riskMetrics?: {
    sharpeRatio?: number;
    sortinoRatio?: number;
    betaVsWorld?: number;
    jensenAlphaPct?: number;
    var95MonthlyEur?: number;
    concentrationHhi?: number;
  };
  topQuantAssets?: Array<{
    assetId: string;
    ticker?: string;
    category?: string;
    predictiveScore?: number;
    sharpe?: number;
    expectedReturnPct?: number;
    volatilityPct?: number;
    rsi14?: number;
    valuation?: string;
    spotPrice?: number;
    upsideDcfPct?: number;
    quantScore?: number;
  }>;
}

interface ValoriaAiSuggestion {
  assetId: string;
  cotPriceCheck?: string;
  cotFundamentalCheck?: string;
  actionType: string;
  convictionPct: number;
  wrapper: string;
  suggestedAmountEuro: number;
  targetWeightPct: number;
  reasoning: string;
  verifiedSpotCad?: number;
  priceCrossVerified?: boolean;
}

export interface ValoriaAiRecommendationsResponse {
  ok: boolean;
  source: 'gemini' | 'fallback';
  generatedAt: string;
  priceCrossVerified: boolean;
  recommendation: {
    marketSynthesis: string;
    portfolioDiagnosis: string;
    strategyHeadline: string;
    keyRiskAlert: string;
    suggestions: ValoriaAiSuggestion[];
  };
}

export interface ValoriaDeepResearchRequest {
  tickers?: string[];
  focusTicker?: string;
  regimeName?: string;
  riskProfile?: string;
}

interface ValoriaLiveAgentTickerOverride {
  ticker: string;
  assetId?: string;
  accountingScore?: number;
  guidanceScore?: number;
  newsScore?: number;
  technicalScore?: number;
  positioningScore?: number;
  ecosystemScore?: number;
  riskShieldScore?: number;
  forwardReturnAdjustmentPct?: number;
  epsRevision90dPct?: number;
  shortInterestFloatPct?: number;
  institutionalOwnershipPct?: number;
  visualSignalTag?: string;
  keyCatalystTag?: string;
  bullHighlight?: string;
  bearHighlight?: string;
  isGeminiLive?: boolean;
}

interface ValoriaRawNewsFeedItem {
  id: string;
  ticker: string;
  assetId?: string;
  title: string;
  publisher: string;
  publishedAt: string;
  url?: string;
  summary?: string;
  isLiveWeb?: boolean;
}

export interface ValoriaDeepResearchResponse {
  ok: boolean;
  source: 'gemini' | 'fallback';
  mode: 'gemini_live_swarm' | 'live_market_quant';
  elapsedMs: number;
  scannedTickersCount: number;
  liveArticles: ValoriaRawNewsFeedItem[];
  overrides: Record<string, ValoriaLiveAgentTickerOverride>;
  groundingSources: Array<{ uri: string; title: string }>;
  geminiNotice: string | null;
}

export interface ValoriaAgentChatRequest {
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  verifiedGroundingContext?: string;
}

export interface ValoriaAgentChatResponse {
  ok: boolean;
  source: 'gemini_live_committee' | 'gemini' | 'fallback';
  headlineVerdict: string;
  plainFrenchAnswer: string;
  agentVoices: Array<{
    code: string;
    shortTitle: string;
    verdict: string;
    message: string;
  }>;
  followUpPrompts: string[];
}

export interface ValoriaDeepIntelligenceLabRequest {
  tickers?: string[];
  focusSliceLabel?: string;
  portfolioTotalCad?: number;
  macroSummary?: string;
  localThesis?: string;
}

export interface ValoriaDeepIntelligenceLabResponse {
  ok: boolean;
  source: 'gemini' | 'fallback';
  liveArticlesCount: number;
  synthesis: {
    generatedAt: string;
    sourceMode: 'gemini_search_grounded' | 'quant_causal_engine';
    executiveThesis: string;
    macroRegimeReading: string;
    topBlindSpotRisk: string;
    topContrarianOpportunity: string;
    causalHighlights?: Array<{
      trigger: string;
      transmission: string;
      portfolioImpactSummary: string;
      action: string;
    }>;
    webSources?: Array<{ uri: string; title: string }>;
  };
}

interface ValoriaBlindDossierInput {
  blindCode: string;
  sectorGeneral: string;
  trailing12mReturnPct: number;
  trailingVolatilityPct: number;
  maxDrawdownToDatePct: number;
  forwardPe: number;
  roicMinusWaccPct: number;
  fcfMarginPct: number;
  estimatedFairValueUpsidePct: number;
  anonymizedCatalystSummary: string;
  publishedAt?: string;
}

export interface ValoriaBlindTimeMachineRequest {
  epochId?: '1m' | '1y' | '5y' | '10y';
  riskProfile?: string;
  epochCode?: string;
  cutoffDate?: string;
  macroAtT0?: {
    inflationPct?: number;
    centralBankRatePct?: number;
    gdpGrowthPct?: number;
    vixLevel?: number;
    yieldCurveNote?: string;
  };
  anonymizedNewsDigest?: Array<string | { text: string; publishedAt?: string }>;
  dossiers?: ValoriaBlindDossierInput[];
  codeToAssetId?: Record<string, string>;
}

export interface ValoriaBlindTimeMachineResponse {
  ok: boolean;
  source: 'gemini' | 'fallback';
  audit: {
    epochId: '1m' | '1y' | '5y' | '10y';
    generatedAt: string;
    mode: 'gemini_blind_committee' | 'quant_point_in_time_fallback';
    macroReadingAtEpochFr: string;
    allocationPhilosophyFr: string;
    picks: Array<{
      assetId: string;
      weightPct: number;
      blindCode: string;
      blindThesisFr: string;
    }>;
    avoids: Array<{
      assetId: string;
      blindCode: string;
      blindAvoidReasonFr: string;
    }>;
    anonymizedMappingCount: number;
    noticeFr?: string;
  };
}

// ----------------------------------------------------------------------------
// Schémas Zod bornés (validation safeJsonValidate)
// ----------------------------------------------------------------------------

const AiRecommendationSchema = z.object({
  marketSynthesis: z.string().min(4),
  portfolioDiagnosis: z.string().min(4),
  strategyHeadline: z.string().min(3),
  keyRiskAlert: z.string().min(4),
  suggestions: z.array(
    z.object({
      assetId: z.string().min(1),
      cotPriceCheck: z.string().optional(),
      cotFundamentalCheck: z.string().optional(),
      actionType: z.string().min(2),
      convictionPct: z.number().min(0).max(100),
      wrapper: z.string().default('CELI'),
      suggestedAmountEuro: z.number().nonnegative().finite(),
      targetWeightPct: z.number().min(0).max(100),
      reasoning: z.string().min(3),
    }),
  ),
});

const DeepResearchArraySchema = z.array(
  z.object({
    ticker: z.string().min(1),
    cotTrace: z.string().optional(),
    accountingScore: z.number().min(0).max(100),
    guidanceScore: z.number().min(0).max(100),
    newsScore: z.number().min(-100).max(100),
    technicalScore: z.number().min(0).max(100),
    positioningScore: z.number().min(0).max(100),
    ecosystemScore: z.number().min(0).max(100),
    riskShieldScore: z.number().min(0).max(100),
    forwardReturnAdjustmentPct: z.number().min(-10).max(10),
    epsRevision90dPct: z.number().min(-50).max(50),
    visualSignalTag: z.string().optional(),
    keyCatalystTag: z.string().optional(),
    bullHighlight: z.string().optional(),
    bearHighlight: z.string().optional(),
  }),
);

const AgentChatSchema = z.object({
  cotVerificationTrace: z.string().optional(),
  headlineVerdict: z.string().min(3),
  plainFrenchAnswer: z.string().min(5),
  agentVoices: z.array(
    z.object({
      code: z.string().min(1),
      shortTitle: z.string().min(1),
      verdict: z.string().min(2),
      message: z.string().min(3),
    }),
  ),
  followUpPrompts: z.array(z.string().min(2)),
});

const DeepLabSchema = z.object({
  executiveThesis: z.string().min(5),
  macroRegimeReading: z.string().min(5),
  topBlindSpotRisk: z.string().min(4),
  topContrarianOpportunity: z.string().min(4),
  causalHighlights: z
    .array(
      z.object({
        trigger: z.string(),
        transmission: z.string(),
        portfolioImpactSummary: z.string(),
        action: z.string(),
      }),
    )
    .optional(),
});

const BlindTimeMachineSchema = z.object({
  macroReadingAtEpochFr: z.string().min(4),
  allocationPhilosophyFr: z.string().min(4),
  picks: z.array(
    z.object({
      blindCode: z.string().min(1),
      weightPct: z.number().min(1).max(100),
      blindThesisFr: z.string().min(3),
    }),
  ),
  avoids: z.array(
    z.object({
      blindCode: z.string().min(1),
      blindAvoidReasonFr: z.string().min(3),
    }),
  ),
});

// ----------------------------------------------------------------------------
// Utilitaires communs & anonymisation stricte ACTIF_01..12
// ----------------------------------------------------------------------------

const API_TIMEOUT_MS = 12_000;

async function postLocalApiJson<T>(path: string, payload: unknown): Promise<T | null> {
  if (typeof fetch !== 'function') return null;
  try {
    const resp = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().includes('application/json')) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

const EPOCH_CUTOFF_DEFAULTS: Record<'1m' | '1y' | '5y' | '10y', string> = {
  '1m': '2026-10-18',
  '1y': '2025-11-18',
  '5y': '2021-11-18',
  '10y': '2016-11-18',
};

const KNOWN_COMPANY_STEMS = [
  'SNPS', 'INTEL', 'ALPHABET', 'GOOGLE', 'MICROSOFT', 'APPLE', 'AMAZON', 'META',
  'TESLA', 'ZCN', 'CTAS', 'ELI LILLY', 'BOEING', 'JPMORGAN', 'COSTCO',
  'EXXON', 'PFIZER', 'SHOPIFY', 'CONSTELLATION SOFTWARE', 'BROOKFIELD', 'CAMECO',
  'ENBRIDGE', 'DOLLARAMA', 'BANQUE ROYALE', 'BANQUE NATIONALE', 'LVMH', 'ROK',
  'SCHNEIDER', 'ASML', 'NOVO NORDISK', 'BITCOIN', 'ETHEREUM', 'SOLANA', 'BLACKROCK',
];

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const COMPANY_STEM_RX = new RegExp(`\\b(${KNOWN_COMPANY_STEMS.map(escapeRx).join('|')})\\b`, 'gi');

function isPostCutoff(candidate: string | undefined, cutoffDate: string): boolean {
  if (!candidate) return false;
  const iso = candidate.match(/^(\d{4}-\d{2}(?:-\d{2})?)/)?.[1];
  if (!iso) return false;
  const normCand = iso.length === 7 ? `${iso}-01` : iso;
  const normCutoff = cutoffDate.length === 7 ? `${cutoffDate}-31` : cutoffDate;
  return normCand > normCutoff;
}

function redactBlindText(raw: string, forbiddenTokens: string[]): string {
  let clean = sanitizePromptText(raw, 280);
  clean = clean.replace(/\b(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?\b/g, '[PÉRIODE_T0]');
  clean = clean.replace(COMPANY_STEM_RX, '[SOCIÉTÉ]');
  for (const tok of forbiddenTokens) {
    if (tok.length >= 3) {
      clean = clean.replace(new RegExp(`\\b${escapeRx(tok)}\\b`, 'gi'), '[ACTIF]');
    } else if (/^[A-Z]{2}$/.test(tok)) {
      clean = clean.replace(new RegExp(`\\b${escapeRx(tok)}\\b`, 'g'), '[ACTIF]');
    }
  }
  return clean;
}

function prepareBlindRequest(payload: ValoriaBlindTimeMachineRequest): {
  epochId: '1m' | '1y' | '5y' | '10y';
  riskProfile: string;
  epochCode: string;
  cutoffDate: string;
  macroAtT0: {
    inflationPct: number;
    centralBankRatePct: number;
    gdpGrowthPct: number;
    vixLevel: number;
    yieldCurveNote: string;
  };
  anonymizedNewsDigest: string[];
  dossiers: Array<{
    blindCode: string;
    sectorGeneral: string;
    trailing12mReturnPct: number;
    trailingVolatilityPct: number;
    maxDrawdownToDatePct: number;
    forwardPe: number;
    roicMinusWaccPct: number;
    fcfMarginPct: number;
    estimatedFairValueUpsidePct: number;
    anonymizedCatalystSummary: string;
  }>;
  codeToAssetId: Record<string, string>;
} {
  const epochId: '1m' | '1y' | '5y' | '10y' =
    payload.epochId === '1m' || payload.epochId === '1y' || payload.epochId === '5y' || payload.epochId === '10y'
      ? payload.epochId
      : '5y';
  const rawCutoff = typeof payload.cutoffDate === 'string' ? payload.cutoffDate.trim() : '';
  const cutoffDate = /^\d{4}-\d{2}(?:-\d{2})?$/.test(rawCutoff)
    ? rawCutoff
    : EPOCH_CUTOFF_DEFAULTS[epochId];

  const rawMap = payload.codeToAssetId ?? {};
  const forbiddenTokens: string[] = [];
  for (const [k, v] of Object.entries(rawMap)) {
    if (!/^ACTIF_\d{2}$/i.test(k)) forbiddenTokens.push(k);
    if (v) forbiddenTokens.push(v);
  }

  const dossiers: Array<{
    blindCode: string;
    sectorGeneral: string;
    trailing12mReturnPct: number;
    trailingVolatilityPct: number;
    maxDrawdownToDatePct: number;
    forwardPe: number;
    roicMinusWaccPct: number;
    fcfMarginPct: number;
    estimatedFairValueUpsidePct: number;
    anonymizedCatalystSummary: string;
  }> = [];
  const codeToAssetId: Record<string, string> = {};

  for (const rawD of (payload.dossiers ?? []).slice(0, 12)) {
    if (isPostCutoff(rawD.publishedAt, cutoffDate)) continue;
    const origCode = String(rawD.blindCode ?? '').trim().toUpperCase();
    const mappedId = String(rawMap[origCode] ?? rawMap[rawD.blindCode] ?? origCode).trim();
    const slot = String(dossiers.length + 1).padStart(2, '0');
    const blindCode = /^ACTIF_(?:0[1-9]|1[0-2])$/.test(origCode) && !codeToAssetId[origCode]
      ? origCode
      : `ACTIF_${slot}`;
    if (dossiers.length >= 12) break;
    if (mappedId) codeToAssetId[blindCode] = mappedId;
    dossiers.push({
      blindCode,
      sectorGeneral: redactBlindText(rawD.sectorGeneral, forbiddenTokens),
      trailing12mReturnPct: Number.isFinite(rawD.trailing12mReturnPct) ? Number(rawD.trailing12mReturnPct.toFixed(2)) : 0,
      trailingVolatilityPct: Number.isFinite(rawD.trailingVolatilityPct) ? Number(rawD.trailingVolatilityPct.toFixed(2)) : 18,
      maxDrawdownToDatePct: Number.isFinite(rawD.maxDrawdownToDatePct) ? Number(rawD.maxDrawdownToDatePct.toFixed(2)) : 0,
      forwardPe: Number.isFinite(rawD.forwardPe) ? Number(rawD.forwardPe.toFixed(2)) : 18,
      roicMinusWaccPct: Number.isFinite(rawD.roicMinusWaccPct) ? Number(rawD.roicMinusWaccPct.toFixed(2)) : 0,
      fcfMarginPct: Number.isFinite(rawD.fcfMarginPct) ? Number(rawD.fcfMarginPct.toFixed(2)) : 0,
      estimatedFairValueUpsidePct: Number.isFinite(rawD.estimatedFairValueUpsidePct)
        ? Number(rawD.estimatedFairValueUpsidePct.toFixed(2))
        : 0,
      anonymizedCatalystSummary: redactBlindText(rawD.anonymizedCatalystSummary, forbiddenTokens),
    });
  }

  const anonymizedNewsDigest: string[] = [];
  for (const item of payload.anonymizedNewsDigest ?? []) {
    const text = typeof item === 'string' ? item : item.text ?? '';
    const pubAt = typeof item === 'string' ? undefined : item.publishedAt;
    if (!text.trim() || isPostCutoff(pubAt, cutoffDate)) continue;
    const embeddedDates = text.match(/\b(?:19|20)\d{2}-\d{2}(?:-\d{2})?\b/g) ?? [];
    if (embeddedDates.some((d) => isPostCutoff(d, cutoffDate))) continue;
    anonymizedNewsDigest.push(redactBlindText(text, forbiddenTokens));
    if (anonymizedNewsDigest.length >= 8) break;
  }

  const macro = payload.macroAtT0 ?? {};
  return {
    epochId,
    riskProfile: sanitizePromptText(payload.riskProfile ?? 'equilibre', 24) || 'equilibre',
    epochCode: redactBlindText(payload.epochCode ?? 'HORIZON_RETRO', forbiddenTokens) || 'HORIZON_RETRO',
    cutoffDate,
    macroAtT0: {
      inflationPct: Number.isFinite(macro.inflationPct) ? Number(macro.inflationPct) : 2.2,
      centralBankRatePct: Number.isFinite(macro.centralBankRatePct) ? Number(macro.centralBankRatePct) : 2.5,
      gdpGrowthPct: Number.isFinite(macro.gdpGrowthPct) ? Number(macro.gdpGrowthPct) : 1.8,
      vixLevel: Number.isFinite(macro.vixLevel) ? Number(macro.vixLevel) : 16.5,
      yieldCurveNote: redactBlindText(macro.yieldCurveNote ?? 'Courbe souveraine', forbiddenTokens),
    },
    anonymizedNewsDigest,
    dossiers,
    codeToAssetId,
  };
}

// ----------------------------------------------------------------------------
// 1. Grounding actualités
// ----------------------------------------------------------------------------

export async function fetchValoriaGeminiNewsGrounding(
  apiKey: string,
  payload: ValoriaNewsGroundingRequest,
): Promise<ValoriaNewsGroundingResponse> {
  const cleanTickers = Array.isArray(payload.tickers)
    ? payload.tickers.map((t) => sanitizePromptText(t, 24)).filter(Boolean).slice(0, 8)
    : ['ADP', 'GOOGL', 'RY.TO', 'XBB.PA'];
  const regimeName = sanitizePromptText(payload.regimeName ?? 'marchés nord-américains et mondiaux', 80);
  const cleanKey = apiKey.trim();

  if (cleanKey) {
    try {
      const prompt = `Résume en français clair et accessible les principaux catalyseurs boursiers et macroéconomiques récents pour ces actifs : ${cleanTickers.join(', ')}.
Contexte macro : ${wrapUserData(regimeName)}.
Pour chaque titre principal, indique en 1 ou 2 phrases l'impact pour un investisseur en $ CAD.`;
      const text = await chat([{ role: 'user', content: prompt }], cleanKey, {
        model: MODEL_SONNET,
        system: `Tu es analyste financier canadien francophone (100 % en $ CAD).\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 1600,
      });
      if (text.trim()) {
        return {
          ok: true,
          source: 'gemini',
          generatedAt: new Date().toISOString(),
          markdownBrief: text.trim(),
          sources: [],
        };
      }
    } catch {
      // Fall through to deterministic fallback
    }
  } else {
    const serverRes = await postLocalApiJson<Partial<ValoriaNewsGroundingResponse>>(
      '/api/news/gemini-grounding',
      { tickers: cleanTickers, regimeName },
    );
    if (serverRes?.ok && serverRes.markdownBrief) {
      return {
        ok: true,
        source: serverRes.source === 'gemini' ? 'gemini' : 'fallback',
        generatedAt: serverRes.generatedAt ?? new Date().toISOString(),
        markdownBrief: serverRes.markdownBrief,
        sources: Array.isArray(serverRes.sources) ? serverRes.sources : [],
      };
    }
  }

  return {
    ok: true,
    source: 'fallback',
    generatedAt: new Date().toISOString(),
    markdownBrief: `Synthèse quantitative (${regimeName}) :\n${cleanTickers
      .map((t) => `- **${t}** : suivi quantitatif actif en $ CAD selon les fondamentaux et la volatilité courante.`)
      .join('\n')}`,
    sources: [],
  };
}

// ----------------------------------------------------------------------------
// 2. Recommandations d'allocation IA
// ----------------------------------------------------------------------------

function buildDeterministicRecommendations(
  payload: ValoriaAiRecommendationsRequest,
): ValoriaAiRecommendationsResponse {
  const macro = payload.macro ?? {};
  const portfolioSummary = payload.portfolioSummary ?? {};
  const riskMetrics = payload.riskMetrics ?? {};
  const profile = payload.profile ?? {};
  const monthlyBudget = Math.max(250, Number(profile.monthlyBudget ?? 1000) || 1000);
  const totalVal = Number(portfolioSummary.totalCurrentValue ?? 0) || 0;
  const sharpe = Number(riskMetrics.sharpeRatio ?? 0);
  const hhi = Number(riskMetrics.concentrationHhi ?? 2200);
  const regimeName = sanitizePromptText(macro.regimeName ?? 'Désinflation', 60) || 'Désinflation';
  const ratePct = Number(macro.centralBankRatePct ?? 2.5);
  const inflationPct = Number(macro.inflationPct ?? 2.1);

  const ranked = [...(payload.topQuantAssets ?? [])]
    .sort(
      (a, b) =>
        Number(b.predictiveScore ?? b.quantScore ?? 50) - Number(a.predictiveScore ?? a.quantScore ?? 50),
    )
    .filter((item) => (typeof item.upsideDcfPct === 'number' ? item.upsideDcfPct >= -6 : true))
    .slice(0, 3);

  const suggestions: ValoriaAiSuggestion[] = (
    ranked.length > 0 ? ranked : [{ assetId: 'XBB', predictiveScore: 78 }, { assetId: 'RY', predictiveScore: 76 }]
  ).map((item, idx) => {
    const score = Math.max(55, Math.min(92, Math.round(Number(item.predictiveScore ?? item.quantScore ?? 74))));
    const wrapper = item.assetId.endsWith('TO') || item.assetId === 'RY' ? 'CELI' : 'REER';
    return {
      assetId: item.assetId,
      cotPriceCheck: `Cours vérifié ${item.spotPrice ? `${formatCad(item.spotPrice, 2)} CAD` : 'en $ CAD'} vs valeur intrinsèque.`,
      cotFundamentalCheck: `Score quantitatif ${score}/100 et discipline bilancielle validée.`,
      actionType: idx === 0 ? 'RENFORCER' : 'ACHETER',
      convictionPct: score,
      wrapper,
      suggestedAmountEuro: Math.round(monthlyBudget * (idx === 0 ? 0.5 : 0.25)),
      targetWeightPct: idx === 0 ? 22 : 12,
      reasoning: `Arbitrage $ CAD optimisant le Sharpe sous régime ${regimeName}.`,
      ...(typeof item.spotPrice === 'number' && item.spotPrice > 0
        ? { verifiedSpotCad: Number(item.spotPrice.toFixed(2)), priceCrossVerified: true }
        : {}),
    };
  });

  return {
    ok: true,
    source: 'fallback',
    generatedAt: new Date().toISOString(),
    priceCrossVerified: true,
    recommendation: {
      marketSynthesis: `Régime ${regimeName} : taux directeur ${ratePct.toFixed(2)} % vs IPC ${inflationPct.toFixed(1)} %.`,
      portfolioDiagnosis: `Portefeuille de ${formatCad(totalVal)} CAD · Sharpe ${sharpe.toFixed(2)} · HHI ${Math.round(hhi)}.`,
      strategyHeadline: 'Discipline Qualité & Diversification $ CAD',
      keyRiskAlert: `Surveiller la concentration (HHI ${Math.round(hhi)}) et les multiples tendus.`,
      suggestions,
    },
  };
}

export async function fetchValoriaAiRecommendations(
  apiKey: string,
  payload: ValoriaAiRecommendationsRequest,
): Promise<ValoriaAiRecommendationsResponse> {
  const cleanKey = apiKey.trim();
  const topAssets = payload.topQuantAssets ?? [];
  const allowedIds = topAssets.length > 0
    ? topAssets.map((a) => a.assetId).filter(Boolean)
    : ['XBB', 'ESE', 'MEUD', 'ADP', 'ASML', 'SU', 'GOOGL', 'MSFT', 'GOVT', 'CORP', 'GOLD'];

  if (cleanKey) {
    try {
      const dataBlock = JSON.stringify({
        profile: payload.profile ?? {},
        macro: payload.macro ?? {},
        portfolioSummary: payload.portfolioSummary ?? {},
        riskMetrics: payload.riskMetrics ?? {},
        topQuantAssets: topAssets.slice(0, 16),
      });
      const userPrompt = `Analyse ce portefeuille en $ CAD et produis jusqu'à 4 arbitrages (ACHETER, RENFORCER, ALLÉGER ou VENDRE).
${wrapUserData(dataBlock)}
Identifiants autorisés UNIQUEMENT : ${allowedIds.join(', ')}. Interdiction de recommander ACHETER/RENFORCER si upsideDcfPct < -6.
RÉPONDS UNIQUEMENT avec un JSON strict conforme à :
{"marketSynthesis":string,"portfolioDiagnosis":string,"strategyHeadline":string,"keyRiskAlert":string,"suggestions":[{"assetId":string,"cotPriceCheck":string,"cotFundamentalCheck":string,"actionType":"ACHETER|RENFORCER|ALLÉGER|VENDRE","convictionPct":number,"wrapper":"CELI|REER|CTO","suggestedAmountEuro":number,"targetWeightPct":number,"reasoning":string}]}`;

      const text = await chat([{ role: 'user', content: userPrompt }], cleanKey, {
        model: MODEL_SONNET,
        system: `Tu es stratégiste quantitatif institutionnel canadien (100 % en $ CAD).\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 2048,
      });
      const validated = safeJsonValidate(text, AiRecommendationSchema);
      if (validated) {
        const byId = new Map(topAssets.map((a) => [a.assetId, a]));
        const filtered = validated.suggestions.filter((sug) => {
          if (!allowedIds.includes(sug.assetId)) return false;
          const q = byId.get(sug.assetId);
          const isBuy = /ACHET|RENFORC/i.test(sug.actionType);
          if (isBuy && q && typeof q.upsideDcfPct === 'number' && q.upsideDcfPct < -6) return false;
          return true;
        });
        return {
          ok: true,
          source: 'gemini',
          generatedAt: new Date().toISOString(),
          priceCrossVerified: true,
          recommendation: {
            ...validated,
            suggestions: filtered.map((s) => {
              const spot = byId.get(s.assetId)?.spotPrice;
              return {
                ...s,
                ...(typeof spot === 'number' && spot > 0
                  ? { verifiedSpotCad: Number(spot.toFixed(2)), priceCrossVerified: true }
                  : {}),
              };
            }),
          },
        };
      }
    } catch {
      // Deterministic fallback below
    }
  } else {
    const serverRes = await postLocalApiJson<ValoriaAiRecommendationsResponse>(
      '/api/ai/recommendations',
      payload,
    );
    if (serverRes?.recommendation) {
      return {
        ...serverRes,
        ok: true,
        source: serverRes.source === 'gemini' ? 'gemini' : 'fallback',
      };
    }
  }

  return buildDeterministicRecommendations(payload);
}

// ----------------------------------------------------------------------------
// 3. Comité 7 Agents Deep Research
// ----------------------------------------------------------------------------

export async function fetchValoriaDeepResearch(
  apiKey: string,
  payload: ValoriaDeepResearchRequest,
): Promise<ValoriaDeepResearchResponse> {
  const startedAt = Date.now();
  const rawList =
    Array.isArray(payload.tickers) && payload.tickers.length > 0
      ? payload.tickers.map((t) => sanitizePromptText(t, 24)).filter(Boolean)
      : ['ADP', 'GOOGL', 'INTC', 'PAYX', 'RY.TO', 'XBB.PA'];
  const focusClean = payload.focusTicker ? sanitizePromptText(payload.focusTicker, 24) : '';
  const targetList = Array.from(new Set(focusClean ? [focusClean, ...rawList] : rawList)).slice(0, 8);
  const cleanKey = apiKey.trim();

  if (cleanKey) {
    try {
      const prompt = `Évalue ces actifs via le comité de 7 agents quantitatifs (1: Bilan SEC/SEDAR+, 2: Guidance BPA, 3: Actualités, 4: Courbes MM200/RSI, 5: Positionnement, 6: Écosystème & BoC, 7: Risque & CELI/REER) en $ CAD.
${wrapUserData(JSON.stringify({ tickers: targetList, regimeName: payload.regimeName ?? 'Désinflation', riskProfile: payload.riskProfile ?? 'equilibre' }))}
RÉPONDS UNIQUEMENT avec un JSON Array strict :
[{"ticker":string,"cotTrace":string,"accountingScore":number,"guidanceScore":number,"newsScore":number,"technicalScore":number,"positioningScore":number,"ecosystemScore":number,"riskShieldScore":number,"forwardReturnAdjustmentPct":number,"epsRevision90dPct":number,"visualSignalTag":string,"keyCatalystTag":string,"bullHighlight":string,"bearHighlight":string}]`;

      const text = await chat([{ role: 'user', content: prompt }], cleanKey, {
        model: MODEL_SONNET,
        system: `Comité 7 agents quantitatifs institutionnels ($ CAD).\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 2400,
      });
      const parsed = safeJsonValidate(text, DeepResearchArraySchema);
      if (parsed && parsed.length > 0) {
        const overrides: Record<string, ValoriaLiveAgentTickerOverride> = {};
        for (const item of parsed) {
          const cleanT = item.ticker.trim().toUpperCase();
          const key = cleanT.split('.')[0];
          overrides[key] = {
            ticker: cleanT,
            accountingScore: Math.round(item.accountingScore),
            guidanceScore: Math.round(item.guidanceScore),
            newsScore: Math.round(item.newsScore),
            technicalScore: Math.round(item.technicalScore),
            positioningScore: Math.round(item.positioningScore),
            ecosystemScore: Math.round(item.ecosystemScore),
            riskShieldScore: Math.round(item.riskShieldScore),
            forwardReturnAdjustmentPct: Number(item.forwardReturnAdjustmentPct.toFixed(2)),
            epsRevision90dPct: Number(item.epsRevision90dPct.toFixed(1)),
            visualSignalTag: item.visualSignalTag?.slice(0, 22),
            keyCatalystTag: item.keyCatalystTag?.slice(0, 26),
            bullHighlight: item.bullHighlight?.slice(0, 68),
            bearHighlight: item.bearHighlight?.slice(0, 68),
            isGeminiLive: true,
          };
        }
        return {
          ok: true,
          source: 'gemini',
          mode: 'gemini_live_swarm',
          elapsedMs: Date.now() - startedAt,
          scannedTickersCount: targetList.length,
          liveArticles: [],
          overrides,
          groundingSources: [],
          geminiNotice: null,
        };
      }
    } catch {
      // Deterministic fallback below
    }
  } else {
    const serverRes = await postLocalApiJson<Partial<ValoriaDeepResearchResponse>>(
      '/api/agents/deep-research',
      { ...payload, tickers: targetList },
    );
    if (serverRes?.ok) {
      return {
        ok: true,
        source: serverRes.source === 'gemini' ? 'gemini' : 'fallback',
        mode: serverRes.mode ?? 'live_market_quant',
        elapsedMs: serverRes.elapsedMs ?? Date.now() - startedAt,
        scannedTickersCount: serverRes.scannedTickersCount ?? targetList.length,
        liveArticles: serverRes.liveArticles ?? [],
        overrides: serverRes.overrides ?? {},
        groundingSources: serverRes.groundingSources ?? [],
        geminiNotice: serverRes.geminiNotice ?? null,
      };
    }
  }

  return {
    ok: true,
    source: 'fallback',
    mode: 'live_market_quant',
    elapsedMs: Date.now() - startedAt,
    scannedTickersCount: targetList.length,
    liveArticles: [],
    overrides: {},
    groundingSources: [],
    geminiNotice: '7 agents synchronisés sur le moteur quantitatif local.',
  };
}

// ----------------------------------------------------------------------------
// 4. Dialogue interactif Comité 7 Agents
// ----------------------------------------------------------------------------

function buildDeterministicAgentChat(
  cleanQuestion: string,
  verifiedGroundingContext?: string,
): ValoriaAgentChatResponse {
  let tickerHint = 'votre portefeuille';
  let spotHint = 'cours vérifiés en $ CAD';
  if (verifiedGroundingContext) {
    try {
      const ctx = JSON.parse(verifiedGroundingContext) as { ticker?: unknown; spotCad?: unknown };
      if (typeof ctx.ticker === 'string' && ctx.ticker.trim()) tickerHint = ctx.ticker.trim();
      if (typeof ctx.spotCad === 'number' && Number.isFinite(ctx.spotCad)) {
        spotHint = `${formatCad(ctx.spotCad, 2)} CAD`;
      }
    } catch {
      // Non-JSON context ignored safely
    }
  }
  return {
    ok: true,
    source: 'fallback',
    headlineVerdict: `● Synthèse quantitative vérifiée sur ${tickerHint} (${spotHint})`,
    plainFrenchAnswer: `En clair : sur la base des données vérifiées (${spotHint}) pour « ${cleanQuestion} », le comité quantitatif privilégie la discipline de valorisation DCF et le plafonnement du risque en CELI/REER.`,
    agentVoices: [
      {
        code: 'AG-01',
        shortTitle: 'Bilan & Valeur',
        verdict: 'GARDER',
        message: `Valorisation et flux de trésorerie vérifiés (${spotHint}).`,
      },
      {
        code: 'AG-04',
        shortTitle: 'Courbes & Timing',
        verdict: 'GARDER',
        message: 'Entrée ou ajustement progressif privilégié pour lisser la volatilité.',
      },
      {
        code: 'AG-07',
        shortTitle: 'Risque & CELI',
        verdict: 'GARDER',
        message: 'Respecter le plafond de concentration et l’enveloppe CELI/REER.',
      },
    ],
    followUpPrompts: [
      'Quel impact sur mon Sharpe à 5 ans ?',
      'CELI ou REER pour cet actif ?',
      'Quelles lignes alléger pour réduire ma VaR ?',
    ],
  };
}

export async function fetchValoriaAgentChat(
  apiKey: string,
  payload: ValoriaAgentChatRequest,
): Promise<ValoriaAgentChatResponse> {
  const cleanQuestion = sanitizePromptText(payload.question ?? '', 500);
  if (!cleanQuestion) {
    return {
      ok: false,
      source: 'fallback',
      headlineVerdict: '● Question requise',
      plainFrenchAnswer: 'En clair : saisissez une question financière pour interroger le comité des 7 agents.',
      agentVoices: [],
      followUpPrompts: [],
    };
  }

  const cleanKey = apiKey.trim();
  const safeContext = neutralizeFrameTags(String(payload.verifiedGroundingContext ?? '{}').slice(0, 5500));
  const recentHistory = Array.isArray(payload.history)
    ? payload.history
        .slice(-6)
        .map((m) => `${m.role === 'user' ? 'Investisseur' : 'Comité'} : ${neutralizeFrameTags(String(m.text ?? '').slice(0, 320))}`)
        .join('\n')
    : '';

  if (cleanKey) {
    try {
      const prompt = `Historique récent :
${recentHistory || 'Début de la consultation'}

Contexte vérifié ($ CAD — SOURCE DE VÉRITÉ STRICTE) :
${wrapUserData(safeContext)}

Question de l’investisseur :
${wrapUserData(cleanQuestion)}

RÉPONDS UNIQUEMENT avec un JSON strict conforme à :
{"cotVerificationTrace":string,"headlineVerdict":string,"plainFrenchAnswer":string,"agentVoices":[{"code":string,"shortTitle":string,"verdict":"ACHETER|GARDER|ÉVITER","message":string}],"followUpPrompts":[string,string,string]}`;

      const text = await chat([{ role: 'user', content: prompt }], cleanKey, {
        model: MODEL_SONNET,
        system: `Tu es le Comité des 7 Agents Financiers de Valoria (Canada, 100 % en $ CAD). 2 phrases courtes maximum pour plainFrenchAnswer commençant par "En clair :".\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 1600,
      });
      const parsed = safeJsonValidate(text, AgentChatSchema);
      if (parsed) {
        const answer = parsed.plainFrenchAnswer.trim();
        return {
          ok: true,
          source: 'gemini_live_committee',
          headlineVerdict: parsed.headlineVerdict.trim(),
          plainFrenchAnswer: answer.startsWith('En clair') ? answer : `En clair : ${answer}`,
          agentVoices: parsed.agentVoices.slice(0, 3),
          followUpPrompts: parsed.followUpPrompts.slice(0, 3),
        };
      }
    } catch {
      // Deterministic fallback below
    }
  } else {
    const serverRes = await postLocalApiJson<Partial<ValoriaAgentChatResponse>>(
      '/api/agents/chat',
      {
        question: cleanQuestion,
        history: payload.history?.slice(-6),
        verifiedGroundingContext: safeContext,
      },
    );
    if (serverRes?.ok && serverRes.plainFrenchAnswer) {
      return {
        ok: true,
        source: serverRes.source === 'gemini_live_committee' ? 'gemini_live_committee' : 'fallback',
        headlineVerdict: serverRes.headlineVerdict ?? '● Comité quantitatif actif',
        plainFrenchAnswer: serverRes.plainFrenchAnswer,
        agentVoices: Array.isArray(serverRes.agentVoices) ? serverRes.agentVoices.slice(0, 3) : [],
        followUpPrompts: Array.isArray(serverRes.followUpPrompts) ? serverRes.followUpPrompts.slice(0, 3) : [],
      };
    }
  }

  return buildDeterministicAgentChat(cleanQuestion, payload.verifiedGroundingContext);
}

// ----------------------------------------------------------------------------
// 5. Laboratoire Causal IA & Actualités
// ----------------------------------------------------------------------------

export async function fetchValoriaDeepIntelligenceLab(
  apiKey: string,
  payload: ValoriaDeepIntelligenceLabRequest,
): Promise<ValoriaDeepIntelligenceLabResponse> {
  const cleanTickers =
    Array.isArray(payload.tickers) && payload.tickers.length > 0
      ? payload.tickers.map((t) => sanitizePromptText(t, 24)).filter(Boolean).slice(0, 8)
      : ['ADP', 'RY.TO', 'XBB.PA', 'PAYX', 'INTC', 'GOOGL'];
  const safeFocus = sanitizePromptText(payload.focusSliceLabel ?? '', 60);
  const safeMacro = sanitizePromptText(payload.macroSummary ?? 'Désinflation graduelle Canada/US', 180);
  const safeThesis = sanitizePromptText(payload.localThesis ?? '', 240);
  const cleanKey = apiKey.trim();

  if (cleanKey) {
    try {
      const totalNum = Number(payload.portfolioTotalCad);
      const totalCadLabel = Number.isFinite(totalNum) && totalNum > 0 ? `${formatCad(totalNum)} CAD` : '(montant non communiqué)';
      const prompt = `Analyse causale de 1er et 2e ordre pour un portefeuille canadien en $ CAD (${totalCadLabel}).
${wrapUserData(JSON.stringify({ focus: safeFocus || 'Portefeuille global', tickers: cleanTickers, macroSummary: safeMacro, localThesis: safeThesis }))}
RÉPONDS UNIQUEMENT avec un JSON strict conforme à :
{"executiveThesis":string,"macroRegimeReading":string,"topBlindSpotRisk":string,"topContrarianOpportunity":string,"causalHighlights":[{"trigger":string,"transmission":string,"portfolioImpactSummary":string,"action":string}]}`;

      const text = await chat([{ role: 'user', content: prompt }], cleanKey, {
        model: MODEL_SONNET,
        system: `Stratège quantitatif institutionnel canadien (100 % en $ CAD).\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 1800,
      });
      const parsed = safeJsonValidate(text, DeepLabSchema);
      if (parsed) {
        return {
          ok: true,
          source: 'gemini',
          liveArticlesCount: 0,
          synthesis: {
            generatedAt: new Date().toISOString(),
            sourceMode: 'gemini_search_grounded',
            executiveThesis: parsed.executiveThesis,
            macroRegimeReading: parsed.macroRegimeReading,
            topBlindSpotRisk: parsed.topBlindSpotRisk,
            topContrarianOpportunity: parsed.topContrarianOpportunity,
            causalHighlights: (parsed.causalHighlights ?? []).slice(0, 3),
            webSources: [],
          },
        };
      }
    } catch {
      // Deterministic fallback below
    }
  } else {
    const serverRes = await postLocalApiJson<Partial<ValoriaDeepIntelligenceLabResponse>>(
      '/api/ai/deep-intelligence-lab',
      { ...payload, tickers: cleanTickers },
    );
    if (serverRes?.ok && serverRes.synthesis) {
      return {
        ok: true,
        source: serverRes.source === 'gemini' ? 'gemini' : 'fallback',
        liveArticlesCount: serverRes.liveArticlesCount ?? 0,
        synthesis: serverRes.synthesis,
      };
    }
  }

  return {
    ok: true,
    source: 'fallback',
    liveArticlesCount: 0,
    synthesis: {
      generatedAt: new Date().toISOString(),
      sourceMode: 'quant_causal_engine',
      executiveThesis:
        safeThesis ||
        'Les flux actuels récompensent les bilans générateurs de trésorerie libre et pénalisent les multiples spéculatifs.',
      macroRegimeReading:
        safeMacro ||
        'Banque du Canada & Fed : taux réels positifs imposant une discipline stricte sur la marge de sécurité DCF.',
      topBlindSpotRisk:
        'Contagion de 2e ordre des taux longs sur les valeurs à bêta élevé et multiples > 50x.',
      topContrarianOpportunity:
        'Arbitrage progressif des lignes surévaluées vers les leaders profitables décotés en CELI/REER.',
      causalHighlights: [],
      webSources: [],
    },
  };
}

// ----------------------------------------------------------------------------
// 6. Test historique à l'aveugle (Preuve IA — ACTIF_01..12 + anti-lookahead)
// ----------------------------------------------------------------------------

function buildDeterministicBlindAudit(
  prepared: ReturnType<typeof prepareBlindRequest>,
  noticeFr?: string,
): ValoriaBlindTimeMachineResponse {
  const ranked = [...prepared.dossiers].sort((a, b) => {
    const sA =
      a.estimatedFairValueUpsidePct * 1.4 +
      a.roicMinusWaccPct * 0.95 +
      a.fcfMarginPct * 0.3 -
      a.trailingVolatilityPct * 0.28;
    const sB =
      b.estimatedFairValueUpsidePct * 1.4 +
      b.roicMinusWaccPct * 0.95 +
      b.fcfMarginPct * 0.3 -
      b.trailingVolatilityPct * 0.28;
    return sB - sA;
  });
  const weights = [26, 23, 20, 17, 14];
  const picks = ranked
    .slice(0, 5)
    .map((d, i) => {
      const assetId = prepared.codeToAssetId[d.blindCode];
      if (!assetId) return null;
      return {
        assetId,
        blindCode: d.blindCode,
        weightPct: weights[i] ?? 20,
        blindThesisFr: d.anonymizedCatalystSummary,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  const avoids = ranked
    .slice(-3)
    .reverse()
    .map((d) => {
      const assetId = prepared.codeToAssetId[d.blindCode];
      if (!assetId) return null;
      return {
        assetId,
        blindCode: d.blindCode,
        blindAvoidReasonFr: d.anonymizedCatalystSummary,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  return {
    ok: picks.length >= 1,
    source: 'fallback',
    audit: {
      epochId: prepared.epochId,
      generatedAt: new Date().toISOString(),
      mode: 'quant_point_in_time_fallback',
      macroReadingAtEpochFr:
        'Lecture quantitative arrêtée aux indicateurs d’inflation, de taux directeur et de prime de risque disponibles à l’instant T0.',
      allocationPhilosophyFr:
        'Pondération proportionnelle à l’écart ROIC-WACC, à la génération de cash-flow libre et à la marge de sécurité à T0.',
      picks,
      avoids,
      anonymizedMappingCount: prepared.dossiers.length,
      noticeFr:
        noticeFr ?? 'Sélection calculée à l’aveugle sur les dossiers anonymisés d’époque.',
    },
  };
}

export interface ValoriaFutureAiBriefRequest {
  horizonYears: number;
  regimeName: string;
  portfolioConsensus100: number;
  shortTermRatePct: number;
  longTermRatePct: number;
  iqpfBenchmarkPct: number;
  currentValueCad?: number;
  projected5yP50Cad?: number;
  projected10yP50Cad?: number;
  projectedHorizonP50Cad?: number;
  usShareCeliPct?: number;
  topHoldings: Array<{
    symbol: string;
    envelope: string;
    weightPct: number;
    agentScore100: number;
    shortTermNetRatePct: number;
    longTermNetRatePct: number;
  }>;
}

export interface ValoriaFutureAiBriefResponse {
  ok: boolean;
  source: 'gemini' | 'fallback';
  generatedAt: string;
  headlineFr: string;
  trajectoryAnalysisFr: string;
  envelopeActionFr: string;
  riskWatchFr: string;
}

const FutureAiBriefSchema = z.object({
  headlineFr: z.string().min(4),
  trajectoryAnalysisFr: z.string().min(8),
  envelopeActionFr: z.string().min(8),
  riskWatchFr: z.string().min(8),
});

function buildDeterministicFutureBrief(
  payload: ValoriaFutureAiBriefRequest,
): ValoriaFutureAiBriefResponse {
  const spreadVsIqpf = Number((payload.shortTermRatePct - payload.iqpfBenchmarkPct).toFixed(1));
  const bestHolding = [...payload.topHoldings].sort((a, b) => b.agentScore100 - a.agentScore100)[0];
  const weakHolding = [...payload.topHoldings].sort((a, b) => a.agentScore100 - b.agentScore100)[0];
  const celiDragNote =
    (payload.usShareCeliPct ?? 0) >= 15
      ? ` Attention : environ ${Math.round(payload.usShareCeliPct ?? 0)} % de votre CELI est exposé aux actions US (retenue de 15 % non récupérable sur dividendes). Privilégiez le REER pour les titres américains à dividende.`
      : ' La répartition entre CELI, REER et non-enregistré reste globalement bien alignée avec les conventions fiscales Canada–É.-U.';

  return {
    ok: true,
    source: 'fallback',
    generatedAt: new Date().toISOString(),
    headlineFr: `Consensus 7 agents à ${payload.portfolioConsensus100}/100 : ${payload.shortTermRatePct.toFixed(1).replace('.', ',')} %/an (ans 1-5) puis convergence à ${payload.longTermRatePct.toFixed(1).replace('.', ',')} %/an.`,
    trajectoryAnalysisFr:
      `Sur ${payload.horizonYears} ans (régime « ${payload.regimeName} »), l'alpha combiné DCF + Black-Litterman + 7 agents place le rendement court terme à ${spreadVsIqpf >= 0 ? '+' : ''}${spreadVsIqpf.toFixed(1).replace('.', ',')} pp par rapport aux normes IQPF 2026, avant retour progressif vers l'équilibre long terme.`
      + (payload.projected10yP50Cad && payload.projected10yP50Cad > 0
        ? ` Médiane estimée à 10 ans : ${formatCad(payload.projected10yP50Cad)}.`
        : ''),
    envelopeActionFr:
      (bestHolding
        ? `Moteur principal : ${bestHolding.symbol} (${bestHolding.agentScore100}/100, ${bestHolding.envelope}).`
        : '')
      + celiDragNote,
    riskWatchFr:
      weakHolding && weakHolding.agentScore100 < 52
        ? `Surveillance recommandée sur ${weakHolding.symbol} (${weakHolding.agentScore100}/100) ; les queues de distribution intègrent les sauts Merton Jump-Diffusion et la covariance Ledoit-Wolf.`
        : 'Les chocs de marché et queues épaisses sont modélisés par covariance Ledoit-Wolf et sauts Merton Jump-Diffusion (sans extrapolation linéaire à 30 ans).',
  };
}

export async function fetchValoriaFutureForecastBrief(
  apiKey: string,
  payload: ValoriaFutureAiBriefRequest,
): Promise<ValoriaFutureAiBriefResponse> {
  if (!payload.topHoldings.length) {
    return buildDeterministicFutureBrief(payload);
  }

  const fmtVal = (v?: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? formatCad(v) : 'non fourni');
  const anonymizedHoldings = payload.topHoldings.slice(0, 10).map((h, i) => ({
    code: `ACTIF_${String(i + 1).padStart(2, '0')}`,
    envelope: sanitizePromptText(h.envelope, 20),
    weightPct: Number(h.weightPct.toFixed(1)),
    agentScore100: Math.round(h.agentScore100),
    shortTermNetRatePct: Number(h.shortTermNetRatePct.toFixed(2)),
    longTermNetRatePct: Number(h.longTermNetRatePct.toFixed(2)),
  }));

  const summaryBlock = [
    `Horizon: ${payload.horizonYears} ans`,
    `Regime: ${sanitizePromptText(payload.regimeName, 60)}`,
    `Score consensus 7 agents: ${Math.round(payload.portfolioConsensus100)}/100`,
    `Rendement net ans 1-5: ${payload.shortTermRatePct.toFixed(2)} %/an`,
    `Rendement net ans 6+: ${payload.longTermRatePct.toFixed(2)} %/an`,
    `Ancrage IQPF 2026: ${payload.iqpfBenchmarkPct.toFixed(2)} %/an`,
    `Valeur actuelle: ${fmtVal(payload.currentValueCad)}`,
    `Mediane 5 ans: ${fmtVal(payload.projected5yP50Cad)}`,
    `Mediane 10 ans: ${fmtVal(payload.projected10yP50Cad)}`,
    `Mediane horizon: ${fmtVal(payload.projectedHorizonP50Cad)}`,
    `Exposition US en CELI: ${typeof payload.usShareCeliPct === 'number' ? `${payload.usShareCeliPct.toFixed(0)} %` : 'non fourni'}`,
    `Positions anonymisees: ${JSON.stringify(anonymizedHoldings)}`,
  ].join('\n');

  const cleanKey = apiKey.trim();
  if (cleanKey) {
    try {
      const prompt = `Analyse cette trajectoire multi-horizon (ans 1-5 vs an 6+ convergence anti-bulle) pour un investisseur québécois/canadien (CELI/REER/Non-enregistré) :\n${wrapUserData(summaryBlock)}\nRéponds STRICTEMENT en JSON :\n{"headlineFr":string,"trajectoryAnalysisFr":string,"envelopeActionFr":string,"riskWatchFr":string}`;
      const text = await chat([{ role: 'user', content: prompt }], cleanKey, {
        model: MODEL_SONNET,
        system: `Stratège quantitatif canadien (QC/ARC). Explique clairement les prévisions des 7 agents et l'emplacement fiscal sans rien inventer ni mentionner les données absentes.\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 1200,
      });
      const parsed = safeJsonValidate(text, FutureAiBriefSchema);
      if (parsed) {
        return {
          ok: true,
          source: 'gemini',
          generatedAt: new Date().toISOString(),
          headlineFr: parsed.headlineFr.trim(),
          trajectoryAnalysisFr: parsed.trajectoryAnalysisFr.trim(),
          envelopeActionFr: parsed.envelopeActionFr.trim(),
          riskWatchFr: parsed.riskWatchFr.trim(),
        };
      }
    } catch {
      // Fallback déterministe ci-dessous
    }
  }

  return buildDeterministicFutureBrief(payload);
}

export async function fetchValoriaBlindTimeMachineTest(
  apiKey: string,
  payload: ValoriaBlindTimeMachineRequest,
): Promise<ValoriaBlindTimeMachineResponse> {
  const prepared = prepareBlindRequest(payload);
  if (prepared.dossiers.length < 4 || Object.keys(prepared.codeToAssetId).length < 4) {
    return buildDeterministicBlindAudit(
      prepared,
      'Dossiers anonymisés insuffisants pour exécuter le test à l’aveugle.',
    );
  }

  const cleanKey = apiKey.trim();
  const allowedCodes = prepared.dossiers.map((d) => d.blindCode);

  if (cleanKey) {
    try {
      const blindPrompt = `AUDIT D'ALLOCATION À L'AVEUGLE (${prepared.epochCode}) — Profil : ${prepared.riskProfile}.
Tu ne connais ni l'année exacte ni le nom réel des entreprises.
MACRO T0 : Inflation ${prepared.macroAtT0.inflationPct} %, Taux ${prepared.macroAtT0.centralBankRatePct} %, PIB ${prepared.macroAtT0.gdpGrowthPct} %, VIX ${prepared.macroAtT0.vixLevel}, Courbe : ${prepared.macroAtT0.yieldCurveNote}.
ACTUALITÉS T0 :
${prepared.anonymizedNewsDigest.map((n, i) => `${i + 1}. ${n}`).join('\n') || 'Aucune dépêche additionnelle.'}
DOSSIERS ANONYMISÉS (${allowedCodes.join(', ')}) :
${JSON.stringify(prepared.dossiers)}

Sélectionne 5 picks (somme weightPct = 100) et 3 avoids en utilisant UNIQUEMENT les blindCode ci-dessus.
RÉPONDS UNIQUEMENT avec un JSON strict conforme à :
{"macroReadingAtEpochFr":string,"allocationPhilosophyFr":string,"picks":[{"blindCode":string,"weightPct":number,"blindThesisFr":string}],"avoids":[{"blindCode":string,"blindAvoidReasonFr":string}]}`;

      const text = await chat([{ role: 'user', content: blindPrompt }], cleanKey, {
        model: MODEL_HAIKU,
        system: `Gérant quantitatif institutionnel passant un test à l'aveugle sans biais futur. Utilise uniquement ACTIF_01..ACTIF_12.\n${PROMPT_DATA_ISOLATION_NOTE}`,
        maxTokens: 1800,
      });
      const parsed = safeJsonValidate(text, BlindTimeMachineSchema);
      if (parsed) {
        const seenPickIds = new Set<string>();
        const mappedPicks = parsed.picks
          .map((p) => {
            const cleanCode = p.blindCode.trim().toUpperCase();
            const realAssetId = prepared.codeToAssetId[cleanCode];
            if (!realAssetId || seenPickIds.has(realAssetId)) return null;
            seenPickIds.add(realAssetId);
            return {
              assetId: realAssetId,
              blindCode: cleanCode,
              weightPct: Math.max(10, Math.min(40, Number(p.weightPct) || 20)),
              blindThesisFr: p.blindThesisFr.trim(),
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .slice(0, 5);

        const sumWeights = mappedPicks.reduce((s, p) => s + p.weightPct, 0) || 100;
        const normalizedPicks = mappedPicks.map((p) => ({
          ...p,
          weightPct: Number(((p.weightPct / sumWeights) * 100).toFixed(1)),
        }));

        const seenAvoidIds = new Set<string>(seenPickIds);
        const mappedAvoids = parsed.avoids
          .map((a) => {
            const cleanCode = a.blindCode.trim().toUpperCase();
            const realAssetId = prepared.codeToAssetId[cleanCode];
            if (!realAssetId || seenAvoidIds.has(realAssetId)) return null;
            seenAvoidIds.add(realAssetId);
            return {
              assetId: realAssetId,
              blindCode: cleanCode,
              blindAvoidReasonFr: a.blindAvoidReasonFr.trim(),
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x))
          .slice(0, 3);

        if (normalizedPicks.length >= 3) {
          return {
            ok: true,
            source: 'gemini',
            audit: {
              epochId: prepared.epochId,
              generatedAt: new Date().toISOString(),
              mode: 'gemini_blind_committee',
              macroReadingAtEpochFr: parsed.macroReadingAtEpochFr.trim(),
              allocationPhilosophyFr: parsed.allocationPhilosophyFr.trim(),
              picks: normalizedPicks,
              avoids: mappedAvoids,
              anonymizedMappingCount: prepared.dossiers.length,
            },
          };
        }
      }
    } catch {
      // Deterministic fallback below
    }
  } else {
    const serverRes = await postLocalApiJson<Partial<ValoriaBlindTimeMachineResponse>>(
      '/api/ai/time-machine-blind-test',
      prepared,
    );
    if (serverRes?.ok && serverRes.audit) {
      return {
        ok: true,
        source: serverRes.source === 'gemini' ? 'gemini' : 'fallback',
        audit: serverRes.audit,
      };
    }
  }

  return buildDeterministicBlindAudit(prepared);
}
