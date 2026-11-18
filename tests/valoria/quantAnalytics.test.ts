import { test } from 'vitest';
import assert from 'node:assert/strict';
import { getLatestPrices, MARKET_REGIMES } from '../../services/valoria/marketData';
import {
  computeOptimalAllocation,
  evaluatePortfolioRealTime,
  PortfolioLot,
  scoreAssetsForMacro,
} from '../../services/valoria/engine';
import {
  buildRebalancingPlan,
  computeAssetTechnicals,
  computeCalendarYearReturns,
  computeCorrelationMatrix,
  computeEfficientFrontier,
  computePortfolioRiskMetrics,
} from '../../services/valoria/quantAnalytics';

test('computePortfolioRiskMetrics computes coherent Sharpe, Sortino, Beta, VaR 95%, and Euler risk contributions', () => {
  const prices = getLatestPrices();
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'XBB', investedAmount: 5000, purchaseYearMonth: '2020-01' },
    { id: '2', assetId: 'GOVT', investedAmount: 2500, purchaseYearMonth: '2023-01' },
    { id: '3', assetId: 'BTC', investedAmount: 1200, purchaseYearMonth: '2020-04' },
    { id: '4', assetId: 'GOLD', investedAmount: 1800, purchaseYearMonth: '2021-06' },
  ];

  const m = computePortfolioRiskMetrics(lots, prices);
  assert.ok(m.annualizedVolatilityPct > 5 && m.annualizedVolatilityPct < 45);
  assert.ok(m.cvar95MonthlyEur >= m.var95MonthlyEur && m.var95MonthlyEur > 0);
  assert.ok(m.diversificationRatio >= 1.0);
  assert.ok(m.betaVsWorld > 0.2);

  const rcSum = m.riskContributions.reduce((s, r) => s + r.riskContributionPct, 0);
  assert.ok(Math.abs(rcSum - 100) <= 0.5);

  // BTC should contribute disproportionately more risk than GOVT
  const btcRc = m.riskContributions.find((r) => r.assetId === 'BTC');
  const govtRc = m.riskContributions.find((r) => r.assetId === 'GOVT');
  assert.ok(btcRc && govtRc && btcRc.riskContributionPct > govtRc.riskContributionPct);
});

test('computeCorrelationMatrix produces symmetric Pearson matrix with unit diagonal', () => {
  const corr = computeCorrelationMatrix(['XBB', 'ESE', 'GOVT', 'GOLD', 'BTC']);
  const n = corr.assetIds.length;
  assert.ok(n >= 5);

  for (let i = 0; i < n; i++) {
    assert.equal(corr.matrix[i][i], 1);
    for (let j = 0; j < n; j++) {
      assert.equal(corr.matrix[i][j], corr.matrix[j][i]);
      assert.ok(corr.matrix[i][j] >= -1 && corr.matrix[i][j] <= 1);
    }
  }

  // XBB and ESE (US equities) must be strongly positively correlated
  const idxCw8 = corr.assetIds.indexOf('XBB');
  const idxEse = corr.assetIds.indexOf('ESE');
  assert.ok(corr.matrix[idxCw8][idxEse] > 0.75);
});

test('computeAssetTechnicals, computeEfficientFrontier, and buildRebalancingPlan generate valid institutional outputs', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const scored = scoreAssetsForMacro(macro, 'equilibre', 'croissance_long_terme');
  const optimal = computeOptimalAllocation(scored, 'equilibre', 'croissance_long_terme');

  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'BTC', investedAmount: 8000, purchaseYearMonth: '2023-01' },
    { id: '2', assetId: 'XBB', investedAmount: 2000, purchaseYearMonth: '2023-01' },
  ];
  const summary = evaluatePortfolioRealTime(lots, prices);
  const risk = computePortfolioRiskMetrics(lots, prices);

  const tech = computeAssetTechnicals(prices, scored, macro);
  for (const id of Object.keys(tech)) {
    assert.ok(tech[id].rsi14 >= 0 && tech[id].rsi14 <= 100);
    assert.equal(tech[id].sparkline24m.length, 24);
    assert.equal(tech[id].sparkline12m.length, 12);
  }

  const ef = computeEfficientFrontier({
    scoredAssets: scored,
    currentMetrics: risk,
    optimalPortfolio: optimal,
  });
  assert.ok(ef.frontierCurve.length >= 8);
  assert.ok(
    ef.frontierCurve[ef.frontierCurve.length - 1].returnPct >
      ef.frontierCurve[0].returnPct
  );

  const plan = buildRebalancingPlan({
    portfolioSummary: summary,
    riskMetrics: risk,
    optimalPortfolio: optimal,
    scoredAssets: scored,
    riskProfile: 'equilibre',
    goal: 'croissance_long_terme',
  });
  assert.ok(plan.orders.length >= 3);
  const btcOrder = plan.orders.find((o) => o.assetId === 'BTC');
  assert.ok(btcOrder && (btcOrder.action === 'ALLÉGER' || btcOrder.action === 'VENDRE'));

  const annualBars = computeCalendarYearReturns('XBB', '2018-01', '2026-10');
  assert.ok(annualBars.length >= 8);
});
