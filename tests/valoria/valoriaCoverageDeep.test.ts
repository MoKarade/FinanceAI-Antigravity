// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import type { GoogleGenAI } from '@google/genai';

import {
  registerValoriaRoutes,
  resetValoriaServerState,
} from '../../services/valoria/serverRoutes';
import {
  fetchValoriaAgentChat,
  fetchValoriaAiRecommendations,
  fetchValoriaBlindTimeMachineTest,
  fetchValoriaDeepIntelligenceLab,
  fetchValoriaDeepResearch,
  fetchValoriaGeminiNewsGrounding,
} from '../../services/valoria/valoriaAiClient';
import {
  buildCompactFinanceAIExportJson,
  buildFinanceAICsvExport,
  buildFinanceAIExportPayload,
  parseFinanceAIPayload,
  resolveFinanceAISymbol,
} from '../../services/valoria/financeAiBridge';
import {
  ASSETS,
  HISTORICAL_SERIES,
  MARKET_REGIMES,
  getAssetById,
  getLatestPrices,
  getPriceAtYearMonth,
  registerDynamicMarketAsset,
} from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime, type PortfolioLot } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { analyzeEquityUniverse } from '../../services/valoria/equityQuantEngine';
import { computePortfolioRiskMetrics } from '../../services/valoria/quantAnalytics';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';
import {
  buildConsultationTurnResponse,
  computeAssetProbableFuture,
  parseUserConsultationQuery,
  simulateTradeImpactOnPortfolio,
} from '../../services/valoria/agentAdvisorChatEngine';
import { evaluateSingleEpochAudit } from '../../services/valoria/aiTimeMachineEngine';
import {
  buildFocusedAssetSnapshot,
  buildPortfolioOrbitalGraph,
  computePairwiseAssetCorrelation,
} from '../../services/valoria/orbitalFocusEngine';
import {
  analyzeDeepCurveStructure,
  analyzeSovereignYieldCurve,
  computeInstitutionalNewsMarketCorrelation,
} from '../../services/valoria/institutionalCurveAndNewsEngine';

const LOTS_FIXTURE: PortfolioLot[] = [
  { id: 'l1', assetId: 'RY', investedAmount: 12000, purchaseYearMonth: '2024-01' },
  { id: 'l2', assetId: 'MSFT', investedAmount: 9000, purchaseYearMonth: '2024-06' },
  { id: 'l3', assetId: 'INTC', investedAmount: 5000, purchaseYearMonth: '2024-04' },
  { id: 'l4', assetId: 'GOLD', investedAmount: 6000, purchaseYearMonth: '2025-02' },
  { id: 'l5', assetId: 'CASH', investedAmount: 4000, purchaseYearMonth: '2026-01' },
];

describe('Valoria Deep Coverage — serverRoutes gardes, variantes & replis', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetValoriaServerState();
  });

  it('couvre routes /api/* erreurs/replis, quote multi-devises, fermeture pont 410 et Gemini erreurs/validés', async () => {
    resetValoriaServerState();

    const failFetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const appFail = express();
    appFail.use(express.json({ limit: '6mb' }));
    registerValoriaRoutes(appFail, {
      fetchImpl: failFetch,
      geminiApiKey: 'test-gemini-key-synthetic',
      createAiClient: () =>
        ({
          models: {
            generateContent: async () => {
              throw new Error('gemini error');
            },
          },
        }) as unknown as GoogleGenAI,
    });

    const srvFail = await new Promise<Server>((resolve) => {
      const s = appFail.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const port = (srvFail.address() as { port: number }).port;
      const base = `http://127.0.0.1:${port}`;

      // OPTIONS CORS + origine non autorisée
      const optRes = await fetch(`${base}/api/financeai/bridge`, { method: 'OPTIONS' });
      expect(optRes.status).toBe(204);
      const badOrig = await fetch(`${base}/api/financeai/bridge`, {
        headers: { origin: 'https://evil-host.example.com' },
      });
      expect(badOrig.status).toBe(403);

      // Search q vide & q > 100
      const emptySearch = await fetch(`${base}/api/market/search`);
      expect((await emptySearch.json()).results).toEqual([]);
      const longSearch = await fetch(`${base}/api/market/search?q=${'X'.repeat(105)}`);
      expect(longSearch.status).toBe(400);

      // Quote invalide & offline fallback
      expect((await fetch(`${base}/api/market/quote?symbol=..`)).status).toBe(400);
      const quoteOff = await (await fetch(`${base}/api/market/quote?symbol=RY.TO`)).json();
      expect(quoteOff.liveAvailable).toBe(false);

      // Verified-feed cache + network throw fallback
      const feedOff = await (await fetch(`${base}/api/market/verified-feed`)).json();
      expect(feedOff.ok).toBe(true);
      const feedCached = await (await fetch(`${base}/api/market/verified-feed`)).json();
      expect(feedCached.ok).toBe(true);

      // News sans tickers & offline
      const newsOff = await (await fetch(`${base}/api/news/intelligence`)).json();
      expect(newsOff.ok).toBe(true);
      const instOff = await (await fetch(`${base}/api/news/institutional-correlated`)).json();
      expect(instOff.ok).toBe(true);

      // Routes Gemini en erreur -> fallback 200 OK + validation 400
      expect((await fetch(`${base}/api/agents/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: '   ' }),
      })).status).toBe(400);

      expect((await fetch(`${base}/api/ai/time-machine-blind-test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ epochId: '5y', dossiers: [{ blindCode: 'ACTIF_01' }], codeToAssetId: { ACTIF_01: 'RY' } }),
      })).status).toBe(400);

      const postPaths = [
        ['/api/news/gemini-grounding', { tickers: ['RY.TO'], regimeName: 'Désinflation' }],
        ['/api/ai/recommendations', { topQuantAssets: [{ assetId: 'RY', spotPrice: 280, upsideDcfPct: 12 }] }],
        ['/api/agents/deep-research', { tickers: ['RY.TO'], focusTicker: 'RY.TO' }],
        ['/api/agents/chat', { question: 'Garder RY.TO ?' }],
        ['/api/ai/deep-intelligence-lab', { tickers: ['RY.TO'], portfolioTotalCad: 50000 }],
        ['/api/ai/time-machine-blind-test', {
          epochId: '5y',
          dossiers: ['ACTIF_01', 'ACTIF_02', 'ACTIF_03', 'ACTIF_04'].map((c) => ({
            blindCode: c,
            sectorGeneral: 'Banque',
            trailing12mReturnPct: 10,
            trailingVolatilityPct: 14,
            maxDrawdownToDatePct: -8,
            forwardPe: 12,
            roicMinusWaccPct: 4,
            fcfMarginPct: 18,
            estimatedFairValueUpsidePct: 12,
            anonymizedCatalystSummary: 'Bilan solide',
          })),
          codeToAssetId: { ACTIF_01: 'RY', ACTIF_02: 'MSFT', ACTIF_03: 'GOOGL', ACTIF_04: 'GOLD' },
        }],
      ] as const;

      for (const [path, body] of postPaths) {
        const res = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(res.status, path).toBe(200);
        const json = (await res.json()) as { ok: boolean; source: string };
        expect(json.ok).toBe(true);
        expect(json.source).toBe('fallback');
      }
    } finally {
      await new Promise<void>((r) => srvFail.close(() => r()));
    }
  });

  it('couvre /api/market/quote pour devises .PA/.TO/.L/.SW/.CO/.T/.HK, XML RSS et remoteUrl 502/413/200', async () => {
    resetValoriaServerState();
    const multiFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('remote-ok.example.com')) {
        return new Response(JSON.stringify({ positions: [{ ticker: 'RY.TO', quantity: 5 }] }), { status: 200 });
      }
      if (url.includes('remote-bad.example.com')) {
        return new Response('err', { status: 503 });
      }
      if (url.includes('remote-huge.example.com')) {
        return new Response('x'.repeat(5 * 1024 * 1024 + 20), { status: 200 });
      }
      if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) {
        if (url.includes('HTTP500')) return new Response('err', { status: 500 });
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { longName: 'Test Asset', instrumentType: 'ETF' },
                  timestamp: [1704067200, 1706745600, 1709251200, 1711929600, 1714521600, 1717200000],
                  indicators: { quote: [{ close: [300, 310, 320, 330, 340, 350] }] },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('feeds.finance.yahoo.com')) {
        return new Response(
          '<rss><channel><item><title>Royal Bank surges on record earnings</title><link>https://yahoo.com/1</link><pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>',
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const app = express();
    app.use(express.json({ limit: '6mb' }));
    registerValoriaRoutes(app, { fetchImpl: multiFetch });

    const srv = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

      for (const sym of ['RY.TO', 'XBB.PA', 'TEST.L', 'NESN.SW', 'NOVO.CO', 'SONY.T', 'TENC.HK']) {
        const res = await fetch(`${base}/api/market/quote?symbol=${encodeURIComponent(sym)}`);
        const data = (await res.json()) as { liveAvailable: boolean };
        expect(data.liveAvailable).toBe(true);
      }

      const qFail = await (await fetch(`${base}/api/market/quote?symbol=HTTP500`)).json();
      expect(qFail.liveAvailable).toBe(false);

      const inst = await (await fetch(`${base}/api/news/institutional-correlated?tickers=RY.TO`)).json();
      expect(inst.ok).toBe(true);
      expect(Array.isArray(inst.dispatches)).toBe(true);

      const closedBridge = await fetch(`${base}/api/financeai/bridge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ remoteUrl: 'https://remote-ok.example.com/a.json' }),
      });
      expect(closedBridge.status).toBe(410);
      expect(multiFetch).not.toHaveBeenCalledWith('https://remote-ok.example.com/a.json', expect.anything());
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

describe('Valoria Deep Coverage — valoriaAiClient, financeAiBridge & Quant Engines', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('couvre les chemins proxy HTTP 200 et JSON malformés sur les 6 méthodes valoriaAiClient', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        if (target.includes('/api/')) {
          return new Response(
            JSON.stringify({
              ok: true,
              source: target.includes('/api/agents/chat') ? 'gemini_live_committee' : 'gemini',
              generatedAt: '2026-11-18',
              priceCrossVerified: true,
              mode: 'gemini_live_swarm',
              elapsedMs: 12,
              scannedTickersCount: 1,
              liveArticles: [],
              overrides: {},
              groundingSources: [],
              geminiNotice: null,
              headlineVerdict: 'OK',
              plainFrenchAnswer: 'En clair : OK',
              agentVoices: [],
              followUpPrompts: [],
              liveArticlesCount: 0,
              recommendation: {
                marketSynthesis: 'M',
                portfolioDiagnosis: 'D',
                strategyHeadline: 'H',
                keyRiskAlert: 'R',
                suggestions: [],
              },
              synthesis: {
                generatedAt: '2026-11-18',
                sourceMode: 'gemini_search_grounded',
                executiveThesis: 'T',
                macroRegimeReading: 'M',
                topBlindSpotRisk: 'B',
                topContrarianOpportunity: 'O',
                causalHighlights: [],
                webSources: [],
              },
              audit: {
                epochId: '5y',
                generatedAt: '2026-11-18',
                mode: 'gemini_blind_committee',
                macroReadingAtEpochFr: 'M',
                allocationPhilosophyFr: 'P',
                picks: [],
                avoids: [],
                anonymizedMappingCount: 4,
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        // JSON malformé retourné par Gemini -> déclenche repli déterministe propre
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '{non-json' }] }, finishReason: 'STOP' }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const [rProxy, dProxy, cProxy, lProxy, bProxy] = await Promise.all([
      fetchValoriaAiRecommendations('', {}),
      fetchValoriaDeepResearch('', {}),
      fetchValoriaAgentChat('', { question: 'Test' }),
      fetchValoriaDeepIntelligenceLab('', {}),
      fetchValoriaBlindTimeMachineTest('', {
        epochId: '5y',
        dossiers: ['ACTIF_01', 'ACTIF_02', 'ACTIF_03', 'ACTIF_04'].map((c) => ({
          blindCode: c,
          sectorGeneral: 'Banque',
          trailing12mReturnPct: 8,
          trailingVolatilityPct: 12,
          maxDrawdownToDatePct: -6,
          forwardPe: 11,
          roicMinusWaccPct: 4,
          fcfMarginPct: 20,
          estimatedFairValueUpsidePct: 10,
          anonymizedCatalystSummary: 'Solide',
        })),
        codeToAssetId: { ACTIF_01: 'RY', ACTIF_02: 'MSFT', ACTIF_03: 'GOOGL', ACTIF_04: 'GOLD' },
      }),
    ]);

    expect(rProxy.source).toBe('gemini');
    expect(dProxy.source).toBe('gemini');
    expect(cProxy.source).toBe('gemini_live_committee');
    expect(lProxy.source).toBe('gemini');
    expect(bProxy.source).toBe('gemini');

    // Chemins Gemini invalide -> fallback propre
    const [gBad, rBad, dBad, cBad, lBad, bBad] = await Promise.all([
      fetchValoriaGeminiNewsGrounding('AIza-test', { tickers: ['RY.TO'] }),
      fetchValoriaAiRecommendations('AIza-test', {}),
      fetchValoriaDeepResearch('AIza-test', {}),
      fetchValoriaAgentChat('AIza-test', { question: 'Test fallback', verifiedGroundingContext: JSON.stringify({ ticker: 'RY.TO', spotCad: 280 }) }),
      fetchValoriaDeepIntelligenceLab('AIza-test', {}),
      fetchValoriaBlindTimeMachineTest('AIza-test', {
        epochId: '5y',
        dossiers: ['ACTIF_01', 'ACTIF_02', 'ACTIF_03', 'ACTIF_04'].map((c) => ({
          blindCode: c,
          sectorGeneral: 'Tech',
          trailing12mReturnPct: 10,
          trailingVolatilityPct: 16,
          maxDrawdownToDatePct: -10,
          forwardPe: 20,
          roicMinusWaccPct: 5,
          fcfMarginPct: 15,
          estimatedFairValueUpsidePct: 8,
          anonymizedCatalystSummary: 'Solide',
          publishedAt: '2021-01-01',
        })),
        codeToAssetId: { ACTIF_01: 'RY', ACTIF_02: 'MSFT', ACTIF_03: 'GOOGL', ACTIF_04: 'GOLD' },
      }),
    ]);

    expect(gBad.source).toBe('gemini'); // texte brut accepté
    expect(rBad.source).toBe('fallback');
    expect(dBad.source).toBe('fallback');
    expect(cBad.source).toBe('fallback');
    expect(lBad.source).toBe('fallback');
    expect(bBad.source).toBe('fallback');
  });

  it('couvre parseFinanceAIPayload (CSV, erreurs, USD/EUR, fréquences budget, théorique, tickers dynamiques) & exports', () => {
    expect(() => parseFinanceAIPayload('   ')).toThrow();
    expect(() => parseFinanceAIPayload('{"truncated": ')).toThrow(/tronqué/i);
    expect(() => parseFinanceAIPayload('{bad}')).toThrow(/invalide/i);
    expect(() => parseFinanceAIPayload('TICKER_INEXISTANT;999;2025-01')).toThrow();
    expect(() => parseFinanceAIPayload('{}')).toThrow();

    const csvRes = parseFinanceAIPayload(
      'Ticker;Montant;Date\nRY.TO;3500€;2024-05\nMSFT;2000;2025-02-01\nINCONNU_XYZ;500;2025-01',
    );
    expect(csvRes.sourceFormat).toBe('csv');
    expect(csvRes.importedLots).toHaveLength(2);
    expect(csvRes.unmatchedSymbols).toEqual(['INCONNU_XYZ']);

    const complexJson = parseFinanceAIPayload(
      JSON.stringify({
        fxRates: { USD: 1, CAD: 0.72 },
        budgetItems: [
          { target: 200, frequency: 'Weekly' },
          { target: 400, frequency: 'Biweekly' },
          { target: 2400, frequency: 'Yearly' },
          { target: 1000, frequency: 'Monthly' },
        ],
        projection: { useTheoretical: true, theoreticalIncome: 7500, theoreticalExpenses: 3200, manualContribution: 1500, appliedReturnProfile: 'Prudent' },
        initialBalances: { LIQUIDITE: 14000 },
        watchlist: ['RY', 'MSFT', 'INCONNU_W'],
        positions: [
          { symbol: 'BRANDNEW1', name: 'Nouvelle Société', quantity: 10, buyPrice: 40, currentPrice: 55, currency: 'USD', priceHistory: [{ date: '2025-01-10', price: 40 }, { date: '2026-11-02', price: 55 }] },
          { symbol: 'NEWCRYP-USD', type: 'crypto', amountUsd: 1000, currentValueEur: 900, amountEur: 850 },
          { symbol: 'NEWBOND.TO', type: 'obligations', amountCad: 4000, purchaseYearMonth: '2025-06' },
        ],
      }),
    );
    expect(complexJson.importedLots.length).toBeGreaterThanOrEqual(2);
    expect(complexJson.detectedRiskProfile).toBe('prudent');
    expect(complexJson.watchlistAssetIds).toEqual(['RY', 'MSFT']);

    expect(resolveFinanceAISymbol('Banque Royale')?.id).toBe('RY');
    expect(resolveFinanceAISymbol('')).toBeUndefined();

    // Export payloads complète
    const live = getLatestPrices();
    const evalRes = evaluatePortfolioRealTime(LOTS_FIXTURE, live);
    const risk = computePortfolioRiskMetrics(LOTS_FIXTURE, live, 2.5);
    const universe = analyzeEquityUniverse({
      livePrices: live,
      macro: MARKET_REGIMES[0].indicators,
      riskProfile: 'dynamique',
      evaluatedLots: evalRes.lots,
      totalPortfolioValue: evalRes.totalCurrentValue,
    });
    const payload = buildFinanceAIExportPayload({
      portfolioSummary: evalRes,
      riskMetrics: risk,
      equitySummary: universe,
      riskProfile: 'dynamique',
      monthlySavingsCapacityEur: 2200,
    });
    expect(payload.schema).toBe('FinanceAI-Valoria-Bridge/v1.3-CAD');
    expect(buildCompactFinanceAIExportJson(payload).length).toBeGreaterThan(20);
    expect(buildFinanceAICsvExport(payload)).toContain('POSITION;');
  });

  it('couvre toutes les intentions et branches de agentAdvisorChatEngine, aiTimeMachine, marketData, orbitalFocus & curveEngine', () => {
    const live = getLatestPrices();
    const macro = MARKET_REGIMES[0].indicators;
    const evalRes = evaluatePortfolioRealTime(LOTS_FIXTURE, live);
    const universe = analyzeFullMarketUniverse({
      livePrices: live,
      macro,
      riskProfile: 'equilibre',
      evaluatedLots: evalRes.lots,
      totalPortfolioValue: evalRes.totalCurrentValue,
    });
    const advisory = buildProAnalystAdvisory({
      lots: LOTS_FIXTURE,
      livePrices: live,
      macro,
      riskProfile: 'equilibre',
      availableCashCad: 5000,
    });

    // agentAdvisorChatEngine : 5 intentions + aliases + montants k$ / $
    const queries = [
      'Quels sont les meilleurs investissements actuels ?',
      'Que dois-je vendre ou garder dans mon portefeuille ?',
      'Simule un achat de 2.5k$ sur Microsoft',
      'Vendre 3 000 $ sur Intel maintenant ?',
      'Quel est l’avenir probable du Bitcoin d’ici 2031 ?',
      'Analyse complète de Banque Royale et de l’or svp',
    ];
    for (const q of queries) {
      const parsed = parseUserConsultationQuery({ question: q });
      expect(parsed.intent).toBeTruthy();
      const resp = buildConsultationTurnResponse({
        question: q,
        lots: LOTS_FIXTURE,
        livePrices: live,
        macro,
        riskProfile: 'equilibre',
        advisory,
        universe,
      });
      expect(resp.plainFrenchAnswer.length).toBeGreaterThan(20);
    }

    const simSell = simulateTradeImpactOnPortfolio({
      lots: LOTS_FIXTURE,
      livePrices: live,
      macro,
      riskProfile: 'equilibre',
      advisory,
      universe,
      assetId: 'RY',
      side: 'SELL',
      amountCad: 4000,
    });
    expect(simSell.actionType).toBe('SELL');

    const simFull = simulateTradeImpactOnPortfolio({
      lots: LOTS_FIXTURE,
      livePrices: live,
      macro,
      riskProfile: 'equilibre',
      advisory,
      universe,
      assetId: 'GOLD',
      side: 'FULL_PLAN',
      amountCad: 3000,
    });
    expect(simFull.actionType).toBe('FULL_PLAN');

    for (const id of ['RY', 'GOLD', 'BTC', 'XBB', 'INCONNU']) {
      const fut = computeAssetProbableFuture({
        assetId: id,
        livePrices: live,
        riskProfile: 'equilibre',
        advisory,
        universe,
      });
      expect(fut.horizonPoints).toHaveLength(6);
    }

    // aiTimeMachineEngine avec blindOverride valide + partiel
    const baseEpoch = evaluateSingleEpochAudit({
      epochId: '5y',
      initialCapitalCad: 50000,
      lots: LOTS_FIXTURE,
      livePrices: live,
      riskProfile: 'dynamique',
    });
    const pickIds = baseEpoch.picks.slice(0, 3).map((c) => c.assetId);
    const avoidId = baseEpoch.avoids[0]?.assetId ?? 'INTC';
    const overridden = evaluateSingleEpochAudit({
      epochId: '5y',
      initialCapitalCad: 50000,
      lots: LOTS_FIXTURE,
      livePrices: live,
      riskProfile: 'dynamique',
      blindOverride: {
        epochId: '5y',
        generatedAt: '2026-11-18',
        mode: 'gemini_blind_committee',
        macroReadingAtEpochFr: 'Taux bas',
        allocationPhilosophyFr: 'Qualité',
        picks: pickIds.map((assetId, idx) => ({ assetId, blindCode: `ACTIF_0${idx + 1}`, weightPct: 33.3, blindThesisFr: 'Thèse T0' })),
        avoids: [{ assetId: avoidId, blindCode: 'ACTIF_04', blindAvoidReasonFr: 'Surcote' }],
        anonymizedMappingCount: 4,
      },
    });
    expect(overridden.picks).toHaveLength(3);

    // marketData helpers + registerDynamicMarketAsset
    expect(getAssetById('RY')?.id).toBe('RY');
    expect(getAssetById('DOES_NOT_EXIST')).toBeUndefined();
    expect(getPriceAtYearMonth('RY', '2025-01')).toBeGreaterThan(0);
    expect(getPriceAtYearMonth('RY', '1990-01')).toBeGreaterThan(0);
    const regRefuge = registerDynamicMarketAsset({
      ticker: 'SILVER.TEST',
      name: 'Silver Refuge Test',
      spotCad: 38.2,
      category: 'refuge',
      subClass: 'matiere_premiere',
      monthlyHistoryCad: { '2025-06': 32, '2026-06': 36 },
    });
    expect(ASSETS.some((a) => a.id === regRefuge.id)).toBe(true);
    expect(HISTORICAL_SERIES.length).toBeGreaterThan(24);

    // orbitalFocusEngine + institutionalCurveAndNewsEngine
    expect(computePairwiseAssetCorrelation('RY', 'MSFT')).toBeLessThanOrEqual(1);
    const orbital = buildPortfolioOrbitalGraph({
      availableCashCad: 5000,
      advisory,
      universe,
    });
    expect(orbital.nodes.length).toBeGreaterThan(0);
    expect(
      buildFocusedAssetSnapshot({
        assetId: 'RY',
        lots: LOTS_FIXTURE,
        livePrices: live,
        availableCashCad: 5000,
        advisory,
        universe,
      }),
    ).not.toBeNull();
    expect(
      buildFocusedAssetSnapshot({
        assetId: 'INCONNU_XYZ',
        lots: LOTS_FIXTURE,
        livePrices: live,
        availableCashCad: 5000,
        advisory,
        universe,
      }),
    ).toBeNull();

    const deepCurve = analyzeDeepCurveStructure({
      subjectId: 'PORTFOLIO_BEFORE',
      horizonYears: 5,
      lots: LOTS_FIXTURE,
      afterLots: LOTS_FIXTURE,
      livePrices: live,
      riskFreeRatePct: 2.5,
    });
    expect(deepCurve.points.length).toBeGreaterThan(10);
    const yc = analyzeSovereignYieldCurve(macro);
    expect(yc.boc10yPct).toBeGreaterThan(0);
    const corrNews = computeInstitutionalNewsMarketCorrelation({
      universe,
      livePrices: live,
      heldAssetIds: ['RY', 'MSFT', 'INTC', 'GOLD'],
      watchlistIds: ['XBB'],
    });
    expect(corrNews.byAssetId.size).toBeGreaterThan(0);

    // Profils prudent / offensif + portefeuille vide / concentré (proAnalystAdvisor & orbitalFocusEngine)
    for (const rp of ['prudent', 'offensif'] as const) {
      const adv = buildProAnalystAdvisory({
        lots: rp === 'prudent' ? [] : [{ id: 'big', assetId: 'RY', investedAmount: 80000, purchaseYearMonth: '2024-01' }],
        livePrices: live,
        macro: MARKET_REGIMES[2].indicators,
        riskProfile: rp,
        availableCashCad: 12000,
      });
      expect(adv.executiveDiagnosis.length).toBeGreaterThan(0);

      const orb = buildPortfolioOrbitalGraph({
        availableCashCad: 12000,
        advisory: adv,
        universe,
      });
      expect(orb.nodes.length).toBeGreaterThan(0);
    }

    const cashFocus = buildFocusedAssetSnapshot({
      assetId: 'CASH',
      lots: LOTS_FIXTURE,
      livePrices: live,
      availableCashCad: 5000,
      advisory,
      universe,
    });
    expect(cashFocus).not.toBeNull();

    // Quick lines & variantes financeAiBridge
    const quickRes = parseFinanceAIPayload('RY.TO: 3500\nMSFT: 2000\n# commentaire');
    expect(quickRes.sourceFormat).toBe('quick_lines');
    expect(quickRes.importedLots).toHaveLength(2);
  });

  it('couvre les filtres anti-hallucination DCF, groundingChunks & clamp 3M côté serverRoutes', async () => {
    resetValoriaServerState();
    const chartPlungeFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: { currency: 'CAD', regularMarketPrice: 70 },
                  indicators: { quote: [{ close: [100, 95, 90, 80, 70] }] },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    const app = express();
    app.use(express.json({ limit: '6mb' }));
    registerValoriaRoutes(app, {
      fetchImpl: chartPlungeFetch,
      geminiApiKey: 'test-gemini-key-synthetic',
      allowedOrigins: new Set(['https://allowed.example.com']),
      createAiClient: () =>
        ({
          models: {
            generateContent: async (args: { contents: string }) => {
              if (args.contents.includes('actualités financières')) {
                return {
                  text: 'Analyse causale',
                  candidates: [
                    {
                      groundingMetadata: {
                        groundingChunks: [{ web: { uri: 'https://sec.gov/10q', title: 'SEC 10-Q' } }],
                      },
                    },
                  ],
                };
              }
              if (args.contents.includes('arbitrages')) {
                return {
                  text: JSON.stringify({
                    marketSynthesis: 'Synthèse',
                    portfolioDiagnosis: 'Diag',
                    strategyHeadline: 'Stratégie',
                    keyRiskAlert: 'Risque',
                    suggestions: [
                      {
                        assetId: 'INTC',
                        cotPriceCheck: 'Cher',
                        cotFundamentalCheck: 'Faible',
                        actionType: 'ACHETER',
                        convictionPct: 70,
                        wrapper: 'REER',
                        suggestedAmountEuro: 1000,
                        targetWeightPct: 5,
                        reasoning: 'Doit être filtré par DCF < -6',
                      },
                      {
                        assetId: 'RY',
                        cotPriceCheck: 'Valide',
                        cotFundamentalCheck: 'Solide',
                        actionType: 'ACHETER',
                        convictionPct: 85,
                        wrapper: 'CELI',
                        suggestedAmountEuro: 1500,
                        targetWeightPct: 12,
                        reasoning: 'Décote confirmée',
                      },
                    ],
                  }),
                };
              }
              if (args.contents.includes('7 agents spécialisés')) {
                return {
                  text: JSON.stringify([
                    {
                      ticker: 'INTC',
                      technicalScore: 90,
                      forwardReturnAdjustmentPct: 4.5,
                      accountingScore: 50,
                      guidanceScore: 45,
                      newsScore: -20,
                      positioningScore: 50,
                      ecosystemScore: 55,
                      riskShieldScore: 48,
                      epsRevision90dPct: -5,
                    },
                  ]),
                };
              }
              return { text: JSON.stringify({ executiveThesis: 'Thèse', causalHighlights: [] }) };
            },
          },
        }) as unknown as GoogleGenAI,
    });

    const srv = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

      // Origine autorisée vs refusée sur les routes actives
      const okOrigin = await fetch(`${base}/api/market/search?q=RY`, {
        headers: { origin: 'https://allowed.example.com' },
      });
      expect(okOrigin.status).toBe(200);
      const koOrigin = await fetch(`${base}/api/market/search?q=RY`, {
        headers: { origin: 'https://blocked.example.com' },
      });
      expect(koOrigin.status).toBe(403);

      // Recommandations avec filtrage DCF anti-hallucination (-20 < -6 rejeté)
      const recRes = await fetch(`${base}/api/ai/recommendations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topQuantAssets: [
            { assetId: 'INTC', spotPrice: 70, upsideDcfPct: -20 },
            { assetId: 'RY', spotPrice: 280, upsideDcfPct: 15 },
          ],
        }),
      });
      const recJson = (await recRes.json()) as {
        recommendation: { suggestions: Array<{ assetId: string }> };
      };
      expect(recJson.recommendation.suggestions.map((s) => s.assetId)).toEqual(['RY']);

      // Deep research clamp 3M -30% -> rawTech ramené <= 46 & fwdAdj <= 0.5
      const deepRes = await fetch(`${base}/api/agents/deep-research`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tickers: ['INTC'] }),
      });
      const deepJson = (await deepRes.json()) as {
        overrides: Record<string, { technicalScore: number; forwardReturnAdjustmentPct: number }>;
      };
      expect(deepJson.overrides.INTC.technicalScore).toBeLessThanOrEqual(46);
      expect(deepJson.overrides.INTC.forwardReturnAdjustmentPct).toBeLessThanOrEqual(0.5);

      // Deep lab avec groundingChunks
      const labRes = await fetch(`${base}/api/ai/deep-intelligence-lab`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tickers: ['RY.TO'], portfolioTotalCad: 45000 }),
      });
      const labJson = (await labRes.json()) as { synthesis: { webSources: Array<{ uri: string }> } };
      expect(labJson.synthesis.webSources[0]?.uri).toBe('https://sec.gov/10q');
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });

  it('couvre verified-feed (BoC + CoinGecko + Yahoo sans meta.currency), SEC 10-K/8-K/4 & RSS négatif/neutre', async () => {
    resetValoriaServerState();
    const richFetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('bankofcanada.ca/valet/observations/FXUSDCAD')) {
        return new Response(
          JSON.stringify({
            observations: [
              {
                d: '2026-11-18',
                FXUSDCAD: { v: '1.40' },
                FXEURCAD: { v: '1.56' },
                FXGBPCAD: { v: '1.88' },
                FXCHFCAD: { v: '1.71' },
                FXJPYCAD: { v: '0.009' },
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('bankofcanada.ca/valet/observations/BD.CDN')) {
        return new Response(
          JSON.stringify({
            observations: [{ d: '2026-11-18', 'BD.CDN.2YR.DQ.YLD': { v: '3.90' }, 'BD.CDN.10YR.DQ.YLD': { v: '3.50' } }],
          }),
          { status: 200 },
        );
      }
      if (url.includes('api.coingecko.com')) {
        return new Response(JSON.stringify({ bitcoin: { cad: 102000 }, ethereum: { cad: 3100 } }), { status: 200 });
      }
      if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) {
        return new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {},
                  indicators: { quote: [{ close: [100, 108, 125, 132] }] },
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('query2.finance.yahoo.com/v1/finance/search')) {
        return new Response(
          JSON.stringify({
            quotes: [
              { symbol: 'RY.TO', quoteType: 'EQUITY' },
              { symbol: 'WEIRD', quoteType: 'FUTURE' },
              { symbol: 'NEWTEST', longname: 'New Test Equity', exchange: 'NASDAQ', quoteType: 'EQUITY' },
            ],
            news: [{ uuid: 'u1', title: 'Update', publisher: 'Newswire', link: 'https://example.com', providerPublishTime: 1794000000 }],
          }),
          { status: 200 },
        );
      }
      if (url.includes('data.sec.gov/submissions/')) {
        return new Response(
          JSON.stringify({
            filings: {
              recent: {
                form: ['10-K', '8-K', '4', '10-Q'],
                filingDate: ['2026-11-01', '2026-10-20', '2026-10-15', '2026-08-01'],
                accessionNumber: ['0001-26-01', '0001-26-02', '', '0001-26-04'],
                primaryDocDescription: ['Annual', 'Material', 'Insider', 'Quarter'],
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('feeds.finance.yahoo.com')) {
        return new Response(
          '<rss><channel>' +
            '<item><title>Intel stock drops after miss warning</title><link>https://yahoo.com/drop</link><pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate></item>' +
            '<item><title>Royal Bank holds investor day</title><link>https://yahoo.com/neutral</link><pubDate>invalid-date</pubDate></item>' +
          '</channel></rss>',
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const app = express();
    app.use(express.json({ limit: '6mb' }));
    registerValoriaRoutes(app, {
      fetchImpl: richFetch,
      geminiApiKey: 'test-gemini-key-synthetic',
      createAiClient: () =>
        ({
          models: {
            generateContent: async (args: { contents: string }) => {
              if (args.contents.includes('7 agents spécialisés')) {
                return {
                  text: JSON.stringify([
                    { ticker: 'INTC', technicalScore: 20, forwardReturnAdjustmentPct: 1.0 },
                    { ticker: 'INCONNU_SYM', technicalScore: 60 },
                  ]),
                };
              }
              if (args.contents.includes('arbitrages')) {
                return {
                  text: JSON.stringify({
                    marketSynthesis: 'M',
                    portfolioDiagnosis: 'D',
                    strategyHeadline: 'H',
                    keyRiskAlert: 'R',
                    suggestions: [
                      { assetId: 'NOT_ALLOWED', actionType: 'ACHETER' },
                      { assetId: 'RY', actionType: 'CONSERVER', convictionPct: 80 },
                    ],
                  }),
                };
              }
              return { text: '' };
            },
          },
        }) as unknown as GoogleGenAI,
    });

    const srv = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
      const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
      const [feedRes, searchRes, newsRes, invNewsRes, instRes, deepRes, recoRes] = await Promise.all([
        fetch(`${base}/api/market/verified-feed`),
        fetch(`${base}/api/market/search?q=RY`),
        fetch(`${base}/api/news/intelligence?tickers=ADP,RY.TO`),
        fetch(`${base}/api/news/intelligence?tickers=..`),
        fetch(`${base}/api/news/institutional-correlated?tickers=INTC,ADP,RY.TO,GOOGL`),
        fetch(`${base}/api/agents/deep-research`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tickers: ['INTC'] }),
        }),
        fetch(`${base}/api/ai/recommendations`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topQuantAssets: [{ assetId: 'RY', spotPrice: 280 }] }),
        }),
      ]);

      expect(feedRes.status).toBe(200);
      expect(searchRes.status).toBe(200);
      expect(newsRes.status).toBe(200);
      expect(invNewsRes.status).toBe(400);
      expect(instRes.status).toBe(200);
      expect(deepRes.status).toBe(200);
      expect(recoRes.status).toBe(200);

      const deepJson = (await deepRes.json()) as { overrides: Record<string, { technicalScore: number }> };
      expect(deepJson.overrides.INTC.technicalScore).toBeGreaterThanOrEqual(58);
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});
