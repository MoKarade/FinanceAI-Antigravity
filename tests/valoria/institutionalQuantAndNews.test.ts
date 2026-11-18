import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, getLatestPrices } from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime, PortfolioLot } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import {
  buildPortfolioNewsIntelligence,
  scoreHeadlineSentiment,
} from '../../services/valoria/newsCatalystEngine';
import {
  computeLedoitWolfCovariance,
  computeMultiFactorAttribution,
  computeProbabilisticValuation,
  runBlackLittermanOptimization,
  runJumpDiffusionMonteCarlo,
} from '../../services/valoria/institutionalQuantEngine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';

test('scoreHeadlineSentiment accurately classifies bullish vs bearish catalysts and return shocks', () => {
  const bullish = scoreHeadlineSentiment(
    'Alphabet dépasse les attentes avec une hausse record du cloud IA et un rachat d’actions',
    'Forte expansion des marges opérationnelles et flux de trésorerie record.',
    'GOOGL'
  );
  assert.ok(bullish.sentimentScore > 25);
  assert.ok(bullish.expectedReturnShockPct > 1.0);
  assert.equal(bullish.sentimentLabel === 'Très Haussier' || bullish.sentimentLabel === 'Haussier', true);

  const bearish = scoreHeadlineSentiment(
    'Intel plonge après un profit warning, des pertes lourdes et un retard en fonderie',
    'Abaissement des prévisions et compression des marges.',
    'INTC'
  );
  assert.ok(bearish.sentimentScore < -30);
  assert.ok(bearish.expectedReturnShockPct < -1.2);
  assert.equal(bearish.sentimentLabel, 'Baissier');
});

test('computeLedoitWolfCovariance produces symmetric positive-diagonal matrix with valid shrinkage alpha', () => {
  const ids = ['XBB', 'ADP', 'GOOGL', 'RY', 'GOVT', 'GOLD', 'BTC'];
  const lw = computeLedoitWolfCovariance(ids);
  assert.equal(lw.annualizedCovariance.length, ids.length);
  assert.ok(lw.shrinkageIntensityAlpha >= 0.08 && lw.shrinkageIntensityAlpha <= 0.75);

  for (let i = 0; i < ids.length; i++) {
    assert.ok(lw.annualizedCovariance[i][i] > 0);
    for (let j = 0; j < ids.length; j++) {
      assert.ok(
        Math.abs(lw.annualizedCovariance[i][j] - lw.annualizedCovariance[j][i]) < 1e-9
      );
    }
  }
});

test('runBlackLittermanOptimization shifts posterior expected returns with live news shocks and normalizes weights to 100%', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'XBB', investedAmount: 20000, purchaseYearMonth: '2024-01' },
    { id: '2', assetId: 'INTC', investedAmount: 8000, purchaseYearMonth: '2024-03' },
  ];
  const summary = evaluatePortfolioRealTime(lots, prices);
  const universe = analyzeFullMarketUniverse({
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });

  const candidates = ['XBB', 'GOOGL', 'MSFT', 'RY', 'GOVT', 'GOLD', 'INTC']
    .map((id) => universe.byId.get(id)!)
    .filter(Boolean);

  const newsBaseline = buildPortfolioNewsIntelligence({
    heldWeightsByAssetId: { XBB: 0.7, INTC: 0.3 },
    candidateAssetIds: candidates.map((c) => c.asset.id),
    macro,
  });

  const blBase = runBlackLittermanOptimization({
    candidateAnalyses: candidates,
    currentWeightsById: { XBB: 0.7, INTC: 0.3 },
    newsIntelligence: newsBaseline,
    macro,
    riskProfile: 'equilibre',
  });

  const sumWeights = blBase.rows.reduce((s, r) => s + r.optimalWeightPct, 0);
  assert.ok(Math.abs(sumWeights - 100) < 0.8, `Expected ~100%, got ${sumWeights}`);

  const googlRow = blBase.byAssetId.get('GOOGL')!;
  const intcRow = blBase.byAssetId.get('INTC')!;
  assert.ok(
    googlRow.posteriorExpectedReturnPct > intcRow.posteriorExpectedReturnPct,
    'Quality undervalued GOOGL with positive news should beat distressed INTC in Black-Litterman posterior'
  );
});

test('computeMultiFactorAttribution and runJumpDiffusionMonteCarlo produce rigorous institutional metrics', () => {
  const macro = MARKET_REGIMES[0].indicators;
  const factors = computeMultiFactorAttribution({
    weightsBeforeById: { INTC: 0.5, PAYX: 0.5 },
    weightsAfterById: { XBB: 0.45, GOOGL: 0.3, GOVT: 0.25 },
    macro,
  });
  assert.equal(factors.factors.length, 6);
  assert.ok(factors.rSquaredAfter > 0 && factors.rSquaredAfter <= 1);

  const mc = runJumpDiffusionMonteCarlo({
    initialWealthCad: 100000,
    muBeforePct: 6.5,
    volBeforePct: 19.0,
    muAfterPct: 9.8,
    volAfterPct: 13.5,
    rfPct: 2.5,
    pathsCount: 5000,
  });

  assert.ok(mc.after.p5Bear5yCad < mc.after.p25Conservative5yCad);
  assert.ok(mc.after.p25Conservative5yCad < mc.after.p50Median5yCad);
  assert.ok(mc.after.p50Median5yCad < mc.after.p75Optimistic5yCad);
  assert.ok(mc.after.p75Optimistic5yCad < mc.after.p95Bull5yCad);
  assert.ok(mc.median5yGainDeltaCad > 5000);
  assert.ok(mc.after.cvar99AnnualCad < mc.before.cvar99AnnualCad);
  assert.ok(mc.after.omegaRatio > mc.before.omegaRatio);
});

test('computeProbabilisticValuation and buildProAnalystAdvisory produce Bear/Base/Bull sensitivity & plain-French explanations', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2024-01' },
    { id: '2', assetId: 'ADP', investedAmount: 12000, purchaseYearMonth: '2025-01' },
    { id: '3', assetId: 'INTC', investedAmount: 6000, purchaseYearMonth: '2024-03' },
  ];
  const summary = evaluatePortfolioRealTime(lots, prices);
  const universe = analyzeFullMarketUniverse({
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });

  const googl = universe.byId.get('GOOGL')!;
  const probVal = computeProbabilisticValuation(googl, macro, 1.5);
  assert.ok(probVal.bearCaseCad < probVal.baseCaseCad);
  assert.ok(probVal.baseCaseCad < probVal.bullCaseCad);
  assert.equal(probVal.sensitivityWaccHeaders.length, 5);
  assert.equal(probVal.sensitivityGrowthRows.length, 3);

  const report = buildProAnalystAdvisory({
    lots,
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
  });
  assert.ok(report.plainFrenchExecutiveSummary.startsWith('En clair :'));
  assert.ok(report.sellRecommendations.length > 0);
  assert.ok(report.buyRecommendations.length > 0);
  assert.ok(report.sellRecommendations[0].plainFrenchWhy.length > 25);
  assert.ok(report.buyRecommendations[0].plainFrenchWhy.length > 25);
  assert.ok(report.institutionalQuant.blackLitterman.rows.length >= 5);
});
