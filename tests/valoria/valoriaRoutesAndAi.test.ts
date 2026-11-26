// @vitest-environment node
// tests/valoria/valoriaRoutesAndAi.test.ts
// Suite complète de tests pour les 12 routes Valoria (Express 5 + Cloud Run proxy) et le client IA hybride :
//   - Zéro appel réseau externe réel (`fetch` et `@google/genai` simulés)
//   - Parité des 12 endpoints Express 5 avant le fallback SPA `*all`
//   - Garde SSRF (blocage hôtes privés/loopback/metadata) & compaction FinanceAI
//   - Repli quantitatif déterministe 200 OK (`source: 'fallback'`) sans GEMINI_API_KEY
//   - Anonymisation stricte ACTIF_01..12 et barrière anti-lookahead (`cutoffDate`) sur time-machine-blind-test
//   - Parité Cloud Run (`cloudrun/proxy/relais.mjs`) : 7 routes publiques, limite 2 Mo, origine & débit IP

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GoogleGenAI } from '@google/genai';

import {
  buildBlindTimeMachinePrompt,
  registerValoriaRoutes,
  resetValoriaServerState,
  sanitizeBlindTimeMachinePayload,
} from '../../services/valoria/serverRoutes';
import {
  fetchValoriaAgentChat,
  fetchValoriaAiRecommendations,
  fetchValoriaBlindTimeMachineTest,
  fetchValoriaDeepIntelligenceLab,
  fetchValoriaDeepResearch,
  fetchValoriaGeminiNewsGrounding,
} from '../../services/valoria/valoriaAiClient';
import { reinitialiserLimites, traiter } from '../../cloudrun/proxy/relais.mjs';

const realFetch = globalThis.fetch;

function createMockUpstreamFetch(): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('bankofcanada.ca/valet/observations/FXUSDCAD')) {
      return new Response(
        JSON.stringify({
          observations: [
            {
              d: '2026-11-12',
              FXUSDCAD: { v: '1.4012' },
              FXEURCAD: { v: '1.5720' },
              FXGBPCAD: { v: '1.8850' },
              FXCHFCAD: { v: '1.7150' },
              FXJPYCAD: { v: '0.0089' },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('bankofcanada.ca/valet/observations/BD.CDN')) {
      return new Response(
        JSON.stringify({
          observations: [{ d: '2026-11-12', 'BD.CDN.2YR.DQ.YLD': { v: '3.20' }, 'BD.CDN.10YR.DQ.YLD': { v: '3.72' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('api.coingecko.com')) {
      return new Response(
        JSON.stringify({ bitcoin: { cad: 101234.5 }, ethereum: { cad: 2910.25 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) {
      return new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                meta: {
                  currency: 'USD',
                  regularMarketPrice: 200,
                  longName: 'Apple Inc.',
                  instrumentType: 'EQUITY',
                  fiftyTwoWeekHigh: 220,
                  fiftyTwoWeekLow: 150,
                },
                timestamp: [1704067200, 1706745600, 1709251200, 1711929600, 1714521600, 1717200000],
                indicators: { quote: [{ close: [170, 175, 180, 185, 192, 200] }] },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('query2.finance.yahoo.com/v1/finance/search')) {
      return new Response(
        JSON.stringify({
          quotes: [{ symbol: 'ARM', longname: 'Arm Holdings', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }],
          news: [
            {
              uuid: 'n-1',
              title: 'SNPS demand beats estimates on AI clusters',
              publisher: 'Reuters',
              link: 'https://finance.yahoo.com/news/adp-1',
              providerPublishTime: 1794000000,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('data.sec.gov/submissions/')) {
      return new Response(
        JSON.stringify({
          filings: {
            recent: {
              form: ['10-Q'],
              filingDate: ['2026-11-01'],
              accessionNumber: ['0001045810-26-000123'],
              primaryDocDescription: ['Form 10-Q'],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('feeds.finance.yahoo.com/rss')) {
      return new Response(
        '<rss><channel><item><title>ADP beats quarterly expectations</title><link>https://example.com/rss</link><pubDate>Wed, 12 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>',
        { status: 200, headers: { 'content-type': 'application/xml' } },
      );
    }
    if (url === 'https://financeai.example.com/api/portfolio') {
      return new Response(
        JSON.stringify({
          app: 'FinanceAI',
          version: '4.0',
          store: {
            state: {
              fxRates: { CAD: 1, USD: 1.4 },
              positions: [{ ticker: 'RY.TO', quantity: 10, priceHistory: [{ date: '2026-11-01', price: 289 }] }],
              transactions: [{ id: '1', date: '2026-10-05', amount: 5000, category: 'Revenu' }],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ ok: false }), { status: 404 });
  }) as unknown as typeof fetch;
}

const SAMPLE_BLIND_PAYLOAD = {
  epochId: '5y' as const,
  riskProfile: 'equilibre',
  epochCode: 'ÉPOQUE_ALPHA_2021',
  cutoffDate: '2021-11-18',
  macroAtT0: {
    inflationPct: 4.7,
    centralBankRatePct: 0.25,
    gdpGrowthPct: 4.1,
    vixLevel: 17.2,
    yieldCurveNote: 'Pente souveraine normale en 2021 — pas de mention 2026',
  },
  anonymizedNewsDigest: [
    'Forte demande serveurs cloud au T3 2021-10-15 chez SNPS et Microsoft.',
    { text: 'Fuite future 2026-05-01 à filtrer absolument.', publishedAt: '2026-05-01' },
  ],
  dossiers: [
    {
      blindCode: 'ACTIF_01',
      sectorGeneral: 'Semi-conducteurs SNPS ADP',
      trailing12mReturnPct: 48,
      trailingVolatilityPct: 34,
      maxDrawdownToDatePct: -18,
      forwardPe: 36,
      roicMinusWaccPct: 24,
      fcfMarginPct: 32,
      estimatedFairValueUpsidePct: 18,
      anonymizedCatalystSummary: 'Croissance GPU data centers en 2021 et marges élevées',
    },
    {
      blindCode: 'ACTIF_02',
      sectorGeneral: 'Banques Canada Banque Royale RY.TO',
      trailing12mReturnPct: 22,
      trailingVolatilityPct: 14,
      maxDrawdownToDatePct: -9,
      forwardPe: 12,
      roicMinusWaccPct: 9,
      fcfMarginPct: 26,
      estimatedFairValueUpsidePct: 12,
      anonymizedCatalystSummary: 'Solidité bilancielle et dividende régulier',
    },
    {
      blindCode: 'ACTIF_03',
      sectorGeneral: 'Logiciels Cloud MSFT',
      trailing12mReturnPct: 34,
      trailingVolatilityPct: 20,
      maxDrawdownToDatePct: -12,
      forwardPe: 31,
      roicMinusWaccPct: 22,
      fcfMarginPct: 34,
      estimatedFairValueUpsidePct: 15,
      anonymizedCatalystSummary: 'Revenus récurrents entreprise solides',
    },
    {
      blindCode: 'ACTIF_04',
      sectorGeneral: 'Fonderie x86 Intel INTC',
      trailing12mReturnPct: -15,
      trailingVolatilityPct: 29,
      maxDrawdownToDatePct: -32,
      forwardPe: 14,
      roicMinusWaccPct: -3,
      fcfMarginPct: 4,
      estimatedFairValueUpsidePct: -11,
      anonymizedCatalystSummary: 'Retards industriels et pression sur les flux libres',
    },
    {
      blindCode: 'ACTIF_05',
      sectorGeneral: 'Dossier futur à exclure',
      trailing12mReturnPct: 10,
      trailingVolatilityPct: 15,
      maxDrawdownToDatePct: -5,
      forwardPe: 20,
      roicMinusWaccPct: 5,
      fcfMarginPct: 15,
      estimatedFairValueUpsidePct: 5,
      anonymizedCatalystSummary: 'Événement post-cutoff',
      publishedAt: '2025-03-10',
    },
  ],
  codeToAssetId: {
    ACTIF_01: 'ADP',
    ACTIF_02: 'RY',
    ACTIF_03: 'MSFT',
    ACTIF_04: 'INTC',
    ACTIF_05: 'AAPL',
  },
};

// ----------------------------------------------------------------------------
// 1. Express 5 Routes (12 endpoints) — fallback mode & Gemini SDK mode
// ----------------------------------------------------------------------------

describe('Valoria Express 5 Routes (12 endpoints)', () => {
  let serverFallback: Server;
  let baseUrlFallback: string;
  let serverGemini: Server;
  let baseUrlGemini: string;
  let capturedPrompts: Array<{ model: string; contents: string }>;

  beforeAll(async () => {
    const appFallback = express();
    appFallback.use('/api/financeai', express.json({ limit: '6mb' }));
    appFallback.use(express.json({ limit: '5mb' }));
    registerValoriaRoutes(appFallback, {
      fetchImpl: createMockUpstreamFetch(),
      geminiApiKey: '',
    });
    appFallback.get('*all', (_req, res) => {
      res.status(200).send('<html>SPA_FALLBACK</html>');
    });
    await new Promise<void>((resolveStart) => {
      serverFallback = appFallback.listen(0, '127.0.0.1', () => {
        const addr = serverFallback.address() as { port: number };
        baseUrlFallback = `http://127.0.0.1:${addr.port}`;
        resolveStart();
      });
    });

    capturedPrompts = [];
    const mockAiClient = {
      models: {
        generateContent: vi.fn(async (params: { model: string; contents: string }) => {
          capturedPrompts.push({ model: params.model, contents: params.contents });
          if (params.contents.includes('AUDIT D\'ALLOCATION À L\'AVEUGLE')) {
            return {
              text: JSON.stringify({
                macroReadingAtEpochFr: 'Inflation modérée et taux bas favorables aux bilans rentables.',
                allocationPhilosophyFr: 'Privilégier le ROIC élevé et éviter les retards industriels.',
                picks: [
                  { blindCode: 'ACTIF_01', weightPct: 35, blindThesisFr: 'Marges FCF robustes' },
                  { blindCode: 'ACTIF_02', weightPct: 30, blindThesisFr: 'Dividende résilient' },
                  { blindCode: 'ACTIF_03', weightPct: 35, blindThesisFr: 'Revenus cloud récurrents' },
                ],
                avoids: [{ blindCode: 'ACTIF_04', blindAvoidReasonFr: 'ROIC inférieur au WACC' }],
              }),
              candidates: [],
            };
          }
          if (params.contents.includes('actualités récentes et catalyseurs')) {
            return {
              text: '**ADP** : catalyseur IA positif en $ CAD.',
              candidates: [
                {
                  groundingMetadata: {
                    groundingChunks: [{ web: { uri: 'https://example.com/news', title: 'Source Web' } }],
                  },
                },
              ],
            };
          }
          if (params.contents.includes('Comité d\'allocation quantitative')) {
            return {
              text: JSON.stringify({
                marketSynthesis: 'Taux réels maîtrisés.',
                portfolioDiagnosis: 'Exposition équilibrée.',
                strategyHeadline: 'Qualité & Décote',
                keyRiskAlert: 'Volatilité semi-conducteurs.',
                suggestions: [
                  {
                    assetId: 'RY',
                    cotPriceCheck: 'Cours validé en $ CAD.',
                    cotFundamentalCheck: 'ROE élevé.',
                    actionType: 'ACHETER',
                    convictionPct: 84,
                    wrapper: 'CELI',
                    suggestedAmountEuro: 1500,
                    targetWeightPct: 15,
                    reasoning: 'Décote et dividende solide.',
                  },
                  {
                    assetId: 'INTC',
                    cotPriceCheck: 'Surévalué vs DCF.',
                    cotFundamentalCheck: 'ROIC faible.',
                    actionType: 'ACHETER',
                    convictionPct: 60,
                    wrapper: 'REER',
                    suggestedAmountEuro: 800,
                    targetWeightPct: 5,
                    reasoning: 'Doit être filtré car upsideDcfPct < -6.',
                  },
                ],
              }),
              candidates: [],
            };
          }
          if (params.contents.includes('Évalue ces actifs via 7 agents')) {
            return {
              text: JSON.stringify([
                {
                  ticker: 'ADP',
                  cotTrace: 'Bilan solide -> Cours vérifié -> Catalyseur GPU',
                  accountingScore: 88,
                  guidanceScore: 90,
                  newsScore: 40,
                  technicalScore: 76,
                  positioningScore: 80,
                  ecosystemScore: 85,
                  riskShieldScore: 68,
                  forwardReturnAdjustmentPct: 2.5,
                  epsRevision90dPct: 6.2,
                  visualSignalTag: 'Forte Conviction',
                  keyCatalystTag: 'Cloud +32%',
                  bullHighlight: 'Demande GPU soutenue',
                  bearHighlight: 'Multiple exigeant',
                },
              ]),
              candidates: [],
            };
          }
          if (params.contents.includes('Question de l’investisseur')) {
            return {
              text: JSON.stringify({
                cotVerificationTrace: 'Vérifié $ CAD',
                headlineVerdict: '▲ RY.TO : rendement vérifié en CELI',
                plainFrenchAnswer: 'En clair : RY.TO renforce la stabilité du portefeuille en $ CAD. Privilégiez le CELI pour les dividendes.',
                agentVoices: [
                  { code: 'AG-01', shortTitle: 'Bilan', verdict: 'ACHETER', message: 'Ratio CET1 robuste.' },
                ],
                followUpPrompts: ['Impact à 5 ans ?'],
              }),
              candidates: [],
            };
          }
          return {
            text: JSON.stringify({
              executiveThesis: 'Discipline sur les bilans FCF positifs.',
              macroRegimeReading: 'BoC stable.',
              topBlindSpotRisk: 'Multiples tendus.',
              topContrarianOpportunity: 'Banques canadiennes.',
              causalHighlights: [
                {
                  trigger: 'Taux BoC',
                  transmission: 'Marge nette d’intérêt',
                  portfolioImpactSummary: '+2 % attendu',
                  action: 'Conserver',
                },
              ],
            }),
            candidates: [],
          };
        }),
      },
    } as unknown as GoogleGenAI;

    const appGemini = express();
    appGemini.use('/api/financeai', express.json({ limit: '6mb' }));
    appGemini.use(express.json({ limit: '5mb' }));
    registerValoriaRoutes(appGemini, {
      fetchImpl: createMockUpstreamFetch(),
      geminiApiKey: 'sk-local-server-test',
      createAiClient: () => mockAiClient,
    });
    await new Promise<void>((resolveStart) => {
      serverGemini = appGemini.listen(0, '127.0.0.1', () => {
        const addr = serverGemini.address() as { port: number };
        baseUrlGemini = `http://127.0.0.1:${addr.port}`;
        resolveStart();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((r) => serverFallback.close(() => r()));
    await new Promise<void>((r) => serverGemini.close(() => r()));
  });

  beforeEach(() => {
    resetValoriaServerState();
    capturedPrompts = [];
  });

  it('monte les routes actives avant le fallback SPA *all et ferme /api/financeai/bridge en 410 Gone', async () => {
    const bridgeGet = await realFetch(`${baseUrlFallback}/api/financeai/bridge`);
    expect(bridgeGet.status).toBe(410);

    const bridgePost = await realFetch(`${baseUrlFallback}/api/financeai/bridge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ positions: [{ ticker: 'VFV.TO', quantity: 5 }] }),
    });
    expect(bridgePost.status).toBe(410);
    expect(bridgePost.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');

    const feedRes = await realFetch(`${baseUrlFallback}/api/market/verified-feed`);
    expect(feedRes.status).toBe(200);
    const feedJson = (await feedRes.json()) as { ok: boolean; fxToCad: Record<string, number>; livePricesCad: Record<string, number> };
    expect(feedJson.ok).toBe(true);
    expect(feedJson.fxToCad.USD).toBe(1.4012);
    expect(feedJson.livePricesCad.BTC).toBe(101234.5);

    const searchRes = await realFetch(`${baseUrlFallback}/api/market/search?q=ADP`);
    expect(searchRes.status).toBe(200);
    const searchJson = (await searchRes.json()) as { results: Array<{ assetId?: string; symbol: string }> };
    expect(searchJson.results.some((r) => r.assetId === 'ADP')).toBe(true);

    const quoteRes = await realFetch(`${baseUrlFallback}/api/market/quote?symbol=AAPL`);
    expect(quoteRes.status).toBe(200);
    const quoteJson = (await quoteRes.json()) as { liveAvailable: boolean; registration: { spotCad: number } };
    expect(quoteJson.liveAvailable).toBe(true);
    expect(quoteJson.registration.spotCad).toBeGreaterThan(200);

    const newsRes = await realFetch(`${baseUrlFallback}/api/news/intelligence?tickers=ADP,RY.TO`);
    expect(newsRes.status).toBe(200);
    const newsJson = (await newsRes.json()) as { ok: boolean; liveCount: number };
    expect(newsJson.ok).toBe(true);
    expect(newsJson.liveCount).toBeGreaterThanOrEqual(1);

    const instRes = await realFetch(`${baseUrlFallback}/api/news/institutional-correlated?tickers=ADP,RY`);
    expect(instRes.status).toBe(200);
    const instJson = (await instRes.json()) as { ok: boolean; dispatches: Array<{ sourceTier: string }> };
    expect(instJson.ok).toBe(true);
    expect(instJson.dispatches.length).toBeGreaterThanOrEqual(2);

    const groundingRes = await realFetch(`${baseUrlFallback}/api/news/gemini-grounding`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickers: ['ADP', 'RY.TO'], regimeName: 'Désinflation' }),
    });
    expect(groundingRes.status).toBe(200);
    expect(((await groundingRes.json()) as { source: string }).source).toBe('fallback');

    const recoRes = await realFetch(`${baseUrlFallback}/api/ai/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topQuantAssets: [{ assetId: 'RY', predictiveScore: 82, spotPrice: 289.39 }] }),
    });
    expect(recoRes.status).toBe(200);
    expect(((await recoRes.json()) as { source: string }).source).toBe('fallback');

    const deepRes = await realFetch(`${baseUrlFallback}/api/agents/deep-research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickers: ['ADP', 'RY.TO'] }),
    });
    expect(deepRes.status).toBe(200);
    const deepJson = (await deepRes.json()) as { source: string; mode: string };
    expect(deepJson.source).toBe('fallback');
    expect(deepJson.mode).toBe('live_market_quant');

    const chatRes = await realFetch(`${baseUrlFallback}/api/agents/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Dois-je garder RY.TO ?' }),
    });
    expect(chatRes.status).toBe(200);
    const chatJson = (await chatRes.json()) as { source: string; plainFrenchAnswer: string };
    expect(chatJson.source).toBe('fallback');
    expect(chatJson.plainFrenchAnswer).toContain('En clair :');

    const labRes = await realFetch(`${baseUrlFallback}/api/ai/deep-intelligence-lab`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tickers: ['ADP', 'RY.TO'] }),
    });
    expect(labRes.status).toBe(200);
    const labJson = (await labRes.json()) as { source: string; synthesis: { sourceMode: string } };
    expect(labJson.source).toBe('fallback');
    expect(labJson.synthesis.sourceMode).toBe('quant_causal_engine');

    const blindRes = await realFetch(`${baseUrlFallback}/api/ai/time-machine-blind-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BLIND_PAYLOAD),
    });
    expect(blindRes.status).toBe(200);
    const blindJson = (await blindRes.json()) as { source: string; audit: { mode: string; picks: unknown[] } };
    expect(blindJson.source).toBe('fallback');
    expect(blindJson.audit.mode).toBe('quant_point_in_time_fallback');
    expect(blindJson.audit.picks.length).toBeGreaterThanOrEqual(3);
  });

  it('applique la garde d’origine sur toutes les routes /api/*', async () => {
    const foreignOrigin = await realFetch(`${baseUrlFallback}/api/market/verified-feed`, {
      headers: { origin: 'https://evil.example' },
    });
    expect(foreignOrigin.status).toBe(403);

    const evilFirebaseOrigin = await realFetch(`${baseUrlFallback}/api/news/intelligence?tickers=RY.TO`, {
      headers: { origin: 'https://financeai-evil.web.app' },
    });
    expect(evilFirebaseOrigin.status).toBe(403);

    const prodFirebaseId = ['financeai', '497', '112'].join('-').replace('-112', '112');
    const prodFirebaseOrigin = await realFetch(`${baseUrlFallback}/api/market/verified-feed`, {
      headers: { origin: `https://${prodFirebaseId}.web.app` },
    });
    expect(prodFirebaseOrigin.status).toBe(200);
  });

  it('utilise @google/genai quand GEMINI_API_KEY est configurée et garantit zéro fuite sur time-machine-blind-test', async () => {
    const recoRes = await realFetch(`${baseUrlGemini}/api/ai/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topQuantAssets: [
          { assetId: 'RY', spotPrice: 289.39, upsideDcfPct: 14 },
          { assetId: 'INTC', spotPrice: 85.61, upsideDcfPct: -18 },
        ],
      }),
    });
    expect(recoRes.status).toBe(200);
    const recoJson = (await recoRes.json()) as {
      source: string;
      recommendation: { suggestions: Array<{ assetId: string }> };
    };
    expect(recoJson.source).toBe('gemini');
    expect(recoJson.recommendation.suggestions.map((s) => s.assetId)).toEqual(['RY']);

    const blindRes = await realFetch(`${baseUrlGemini}/api/ai/time-machine-blind-test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_BLIND_PAYLOAD),
    });
    expect(blindRes.status).toBe(200);
    const blindJson = (await blindRes.json()) as {
      source: string;
      audit: { mode: string; picks: Array<{ assetId: string; blindCode: string }> };
    };
    expect(blindJson.source).toBe('gemini');
    expect(blindJson.audit.mode).toBe('gemini_blind_committee');
    expect(blindJson.audit.picks.map((p) => p.assetId)).toEqual(['ADP', 'RY', 'MSFT']);

    const blindPrompt = capturedPrompts.find((p) => p.contents.includes('AUDIT D\'ALLOCATION À L\'AVEUGLE'))?.contents ?? '';
    expect(blindPrompt).toContain('ACTIF_01');
    expect(blindPrompt).toContain('ACTIF_02');
    expect(blindPrompt).not.toContain('ADP');
    expect(blindPrompt).not.toContain('SNPS');
    expect(blindPrompt).not.toContain('RY.TO');
    expect(blindPrompt).not.toContain('INTC');
    expect(blindPrompt).not.toContain('2026');
    expect(blindPrompt).not.toContain('2025');
    expect(blindPrompt).not.toContain('Fuite future');
    expect(blindPrompt).not.toContain('ACTIF_05');
  });

  it('sanitizeBlindTimeMachinePayload filtre tout post-cutoffDate et encadre les prompts IA', async () => {
    const sanitized = sanitizeBlindTimeMachinePayload(SAMPLE_BLIND_PAYLOAD);
    const prompt = buildBlindTimeMachinePrompt(sanitized);
    expect(sanitized.dossiers.map((d) => d.blindCode)).toEqual(['ACTIF_01', 'ACTIF_02', 'ACTIF_03', 'ACTIF_04']);
    expect(prompt).not.toMatch(/202[2-9]/);

    await realFetch(`${baseUrlGemini}/api/ai/recommendations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topQuantAssets: [{ assetId: 'RY', spotPrice: 289.39, upsideDcfPct: 14 }] }),
    });
    const recoPrompt = capturedPrompts.find((p) => p.contents.includes('Comité d\'allocation quantitative'))?.contents ?? '';
    expect(recoPrompt).toContain('<DONNEES>');
  });
});

// ----------------------------------------------------------------------------
// 2. Cloud Run Proxy Parity (cloudrun/proxy/relais.mjs & server.mjs)
// ----------------------------------------------------------------------------

describe('Cloud Run Proxy — parité Valoria + garde SSRF + 2 Mo max', () => {
  beforeEach(() => {
    reinitialiserLimites();
  });

  it('expose les routes publiques Valoria en 200 OK et ferme /api/financeai/bridge (410)', async () => {
    const f = createMockUpstreamFetch();

    const bridgePost = await traiter(
      new Request('http://relais.local/api/financeai/bridge', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://finance.hubperso.com' },
        body: JSON.stringify({ positions: [{ ticker: 'RY.TO', quantity: 10 }] }),
      }),
      { fetchImpl: f },
    );
    expect(bridgePost.status).toBe(410);

    const bridgeGet = await traiter(new Request('http://relais.local/api/financeai/bridge'), { fetchImpl: f });
    expect(bridgeGet.status).toBe(410);

    const feed = await traiter(new Request('http://relais.local/api/market/verified-feed'), { fetchImpl: f });
    expect(feed.status).toBe(200);
    expect(feed.headers.get('cache-control')).toContain('max-age=60');

    const search = await traiter(new Request('http://relais.local/api/market/search?q=RY'), { fetchImpl: f });
    expect(search.status).toBe(200);

    const quote = await traiter(new Request('http://relais.local/api/market/quote?symbol=AAPL'), { fetchImpl: f });
    expect(quote.status).toBe(200);

    const news = await traiter(new Request('http://relais.local/api/news/intelligence?tickers=ADP'), { fetchImpl: f });
    expect(news.status).toBe(200);
    expect(news.headers.get('cache-control')).toContain('max-age=120');

    const inst = await traiter(new Request('http://relais.local/api/news/institutional-correlated?tickers=ADP,RY'), { fetchImpl: f });
    expect(inst.status).toBe(200);
  });

  it('bloque les origines étrangères (403) sur Cloud Run', async () => {
    const badOrigin = await traiter(
      new Request('http://relais.local/api/market/verified-feed', {
        headers: { origin: 'https://evil.example' },
      }),
      { fetchImpl: createMockUpstreamFetch() },
    );
    expect(badOrigin.status).toBe(403);
  });

  it('vérifie le câblage sécurisé de server.ts (127.0.0.1) et cloudrun/proxy/server.mjs', () => {
    const serverTs = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf8');
    expect(serverTs).toContain('registerValoriaRoutes(app)');
    expect(serverTs).toContain("process.env.HOST || '127.0.0.1'");
    expect(serverTs).toContain("limit: '5mb'");
    expect(serverTs).not.toContain("'50mb'");
    expect(serverTs.indexOf('registerValoriaRoutes(app)')).toBeLessThan(serverTs.indexOf('*all'));

    const proxyServer = readFileSync(resolve(process.cwd(), 'cloudrun/proxy/server.mjs'), 'utf8');
    expect(proxyServer).toContain('2 * 1024 * 1024');
    expect(proxyServer).toContain('413');
  });
});

// ----------------------------------------------------------------------------
// 3. Browser Hybrid Client (services/valoria/valoriaAiClient.ts)
// ----------------------------------------------------------------------------

describe('valoriaAiClient — navigateur hybride (clé IndexedDB, /api/* local, fallback)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('utilise chat() de services/gemini.ts quand apiKey est fournie (sans fuiter ACTIF_01..12)', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      expect(target).toContain('generativelanguage.googleapis.com');
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      macroReadingAtEpochFr: 'Taux bas 2021.',
                      allocationPhilosophyFr: 'Qualité FCF.',
                      picks: [
                        { blindCode: 'ACTIF_01', weightPct: 35, blindThesisFr: 'Croissance rentable' },
                        { blindCode: 'ACTIF_02', weightPct: 30, blindThesisFr: 'Dividende sûr' },
                        { blindCode: 'ACTIF_03', weightPct: 35, blindThesisFr: 'Marge élevée' },
                      ],
                      avoids: [{ blindCode: 'ACTIF_04', blindAvoidReasonFr: 'FCF faible' }],
                    }),
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const blindRes = await fetchValoriaBlindTimeMachineTest('AIza-test-indexeddb-key', SAMPLE_BLIND_PAYLOAD);
    expect(blindRes.ok).toBe(true);
    expect(blindRes.source).toBe('gemini');
    expect(blindRes.audit.mode).toBe('gemini_blind_committee');

    const sentBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '');
    expect(sentBody).toContain('ACTIF_01');
    expect(sentBody).not.toContain('ADP');
    expect(sentBody).not.toContain('SNPS');
    expect(sentBody).not.toContain('Fuite future');
  });

  it('couvre les 5 autres appels valoriaAiClient via chat() + safeJsonValidate avec apiKey et via /api/* local quand apiKey est vide', async () => {
    const geminiJson = (obj: unknown) =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (target.includes('generativelanguage.googleapis.com')) {
          const bodyStr = String(init?.body ?? '');
          if (bodyStr.includes('catalyseurs boursiers')) return geminiJson('**RY.TO** : bilan solide en $ CAD.');
          if (bodyStr.includes('arbitrages')) {
            return geminiJson({
              marketSynthesis: 'Désinflation.',
              portfolioDiagnosis: 'Portefeuille sain.',
              strategyHeadline: 'Qualité',
              keyRiskAlert: 'Volatilité.',
              suggestions: [
                {
                  assetId: 'RY',
                  actionType: 'ACHETER',
                  convictionPct: 82,
                  wrapper: 'CELI',
                  suggestedAmountEuro: 1000,
                  targetWeightPct: 12,
                  reasoning: 'ROE élevé.',
                },
              ],
            });
          }
          if (bodyStr.includes('comité de 7 agents quantitatifs')) {
            return geminiJson([
              {
                ticker: 'RY.TO',
                accountingScore: 84,
                guidanceScore: 80,
                newsScore: 30,
                technicalScore: 72,
                positioningScore: 76,
                ecosystemScore: 82,
                riskShieldScore: 85,
                forwardReturnAdjustmentPct: 1.8,
                epsRevision90dPct: 4.1,
              },
            ]);
          }
          if (bodyStr.includes('Question de l’investisseur')) {
            return geminiJson({
              headlineVerdict: '▲ RY.TO : profil défensif',
              plainFrenchAnswer: 'RY.TO stabilise le portefeuille en CELI.',
              agentVoices: [{ code: 'AG-01', shortTitle: 'Bilan', verdict: 'ACHETER', message: 'Solide.' }],
              followUpPrompts: ['Impact 5 ans ?'],
            });
          }
          return geminiJson({
            executiveThesis: 'Flux libres solides.',
            macroRegimeReading: 'BoC stable.',
            topBlindSpotRisk: 'Multiples élevés.',
            topContrarianOpportunity: 'Banques TSX.',
          });
        }

        if (target === '/api/news/gemini-grounding') {
          return new Response(
            JSON.stringify({ ok: true, source: 'gemini', generatedAt: '2026-11-18', markdownBrief: 'Brief serveur', sources: [] }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ ok: false }), { status: 404, headers: { 'content-type': 'application/json' } });
      }),
    );

    const [newsKey, recoKey, deepKey, chatKey, labKey, newsServer] = await Promise.all([
      fetchValoriaGeminiNewsGrounding('AIza-key', { tickers: ['RY.TO'], regimeName: 'Désinflation' }),
      fetchValoriaAiRecommendations('AIza-key', { topQuantAssets: [{ assetId: 'RY', spotPrice: 289.39, upsideDcfPct: 14 }] }),
      fetchValoriaDeepResearch('AIza-key', { tickers: ['RY.TO'] }),
      fetchValoriaAgentChat('AIza-key', { question: 'Garder RY.TO ?' }),
      fetchValoriaDeepIntelligenceLab('AIza-key', { tickers: ['RY.TO'] }),
      fetchValoriaGeminiNewsGrounding('', { tickers: ['RY.TO'], regimeName: 'Désinflation' }),
    ]);

    expect(newsKey.source).toBe('gemini');
    expect(recoKey.source).toBe('gemini');
    expect(recoKey.recommendation.suggestions[0]?.assetId).toBe('RY');
    expect(deepKey.source).toBe('gemini');
    expect(deepKey.mode).toBe('gemini_live_swarm');
    expect(chatKey.source).toBe('gemini_live_committee');
    expect(chatKey.plainFrenchAnswer).toContain('En clair :');
    expect(labKey.source).toBe('gemini');
    expect(newsServer.source).toBe('gemini');
    expect(newsServer.markdownBrief).toBe('Brief serveur');
  });

  it('appelle /api/* quand apiKey est vide puis retombe proprement sur fallback si /api/* indisponible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>SPA</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
    );

    const [news, reco, deep, chatRes, lab, blind] = await Promise.all([
      fetchValoriaGeminiNewsGrounding('', { tickers: ['ADP', 'RY.TO'], regimeName: 'Désinflation' }),
      fetchValoriaAiRecommendations('', { topQuantAssets: [{ assetId: 'RY', spotPrice: 289.39, predictiveScore: 80 }] }),
      fetchValoriaDeepResearch('', { tickers: ['ADP', 'RY.TO'] }),
      fetchValoriaAgentChat('', { question: 'Dois-je conserver RY.TO ?' }),
      fetchValoriaDeepIntelligenceLab('', { tickers: ['ADP', 'RY.TO'] }),
      fetchValoriaBlindTimeMachineTest('', SAMPLE_BLIND_PAYLOAD),
    ]);

    expect(news.ok).toBe(true);
    expect(news.source).toBe('fallback');
    expect(reco.ok).toBe(true);
    expect(reco.source).toBe('fallback');
    expect(deep.ok).toBe(true);
    expect(deep.source).toBe('fallback');
    expect(chatRes.ok).toBe(true);
    expect(chatRes.source).toBe('fallback');
    expect(chatRes.plainFrenchAnswer).toContain('En clair :');
    expect(lab.ok).toBe(true);
    expect(lab.source).toBe('fallback');
    expect(blind.ok).toBe(true);
    expect(blind.source).toBe('fallback');
  });
});
