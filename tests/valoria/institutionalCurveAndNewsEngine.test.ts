import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MARKET_REGIMES,
  getLatestPrices,
} from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime, PortfolioLot } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import {
  analyzeDeepCurveStructure,
  analyzeSovereignYieldCurve,
  computeInstitutionalNewsMarketCorrelation,
} from '../../services/valoria/institutionalCurveAndNewsEngine';

const sampleLots: PortfolioLot[] = [
  { id: '1', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2024-01' },
  { id: '2', assetId: 'ADP', investedAmount: 9500, purchaseYearMonth: '2025-01' },
  { id: '3', assetId: 'RY', investedAmount: 12000, purchaseYearMonth: '2024-06' },
  { id: '4', assetId: 'PAYX', investedAmount: 7200, purchaseYearMonth: '2025-06' },
  { id: '5', assetId: 'INTC', investedAmount: 5800, purchaseYearMonth: '2026-08' },
];

test('Institutional News ↔ Market Correlation computes CAR %, Z-Score, and source credibility tiers', () => {
  const livePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const summary = evaluatePortfolioRealTime(sampleLots, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });

  const corrSummary = computeInstitutionalNewsMarketCorrelation({
    universe,
    livePrices,
    heldAssetIds: ['XBB', 'ADP', 'RY', 'PAYX', 'INTC'],
    watchlistIds: ['ADP', 'GOOGL', 'INTC', 'RY', 'LLY', 'BA'],
  });

  assert.equal(corrSummary.byAssetId.size, universe.totalAssets);
  assert.ok(corrSummary.globalFeed.length >= 8, 'Global feed must expose verified institutional events');
  assert.ok(corrSummary.avgCredibilityPct >= 90 && corrSummary.avgCredibilityPct <= 99);

  const intc = corrSummary.byAssetId.get('INTC')!;
  const ry = corrSummary.byAssetId.get('RY')!;
  const lly = corrSummary.byAssetId.get('LLY')!;
  const adp = corrSummary.byAssetId.get('ADP')!;

  assert.ok(intc.events.length >= 2);
  assert.equal(intc.events[0].sourceTier, 'REGULATOR_FILING');
  assert.equal(intc.events[0].credibilityScorePct, 99);
  assert.ok(
    intc.events[0].abnormalReturnCarPct < -15,
    `Expected negative CAR for INTC 10-Q selloff, got ${intc.events[0].abnormalReturnCarPct}%`
  );
  assert.ok(
    intc.institutionalScore <= -30,
    `Expected strongly negative institutional conviction for INTC, got ${intc.institutionalScore}`
  );
  assert.ok(
    adp.institutionalScore < 0,
    `Expected negative institutional reaction score for ADP during 1M pullback, got ${adp.institutionalScore}`
  );
  assert.ok(
    ry.institutionalScore >= 18,
    `Expected positive institutional conviction for RY.TO, got ${ry.institutionalScore}`
  );
  assert.ok(
    lly.institutionalScore >= 35,
    `Expected strong positive institutional conviction for LLY 10-Q beat, got ${lly.institutionalScore}`
  );

  for (const [, profile] of corrSummary.byAssetId) {
    assert.equal(profile.curve24m.length, 24);
    assert.ok(profile.newsToPricePearsonR >= -1 && profile.newsToPricePearsonR <= 1);
    assert.ok(profile.explainedVarianceR2Pct >= 0 && profile.explainedVarianceR2Pct <= 100);
    for (const ev of profile.events) {
      assert.ok(ev.curvePointIndex >= 0 && ev.curvePointIndex < 24);
      assert.ok(ev.credibilityScorePct >= 88 && ev.credibilityScorePct <= 99);
    }
  }
});

test('Deep Curve Structure Engine computes OLS log-linear channels, Bollinger squeeze, Ulcer Index, Hurst, and derivatives', () => {
  const livePrices = getLatestPrices();

  for (const horizon of [1, 3, 5, 10] as const) {
    const portCurve = analyzeDeepCurveStructure({
      subjectId: 'PORTFOLIO_BEFORE',
      horizonYears: horizon,
      lots: sampleLots,
      livePrices,
      riskFreeRatePct: 3.2,
    });

    assert.ok(portCurve.points.length >= 12);
    assert.ok(portCurve.trendLinearityR2 >= 0 && portCurve.trendLinearityR2 <= 1);
    assert.ok(portCurve.maxDrawdownPct <= 0);
    assert.ok(portCurve.currentDrawdownPct <= 0);
    assert.ok(portCurve.ulcerIndex >= 0);
    assert.ok(portCurve.hurstExponent >= 0.22 && portCurve.hurstExponent <= 0.84);

    for (const pt of portCurve.points) {
      assert.ok(pt.regLower2SigmaCad < pt.regLower1SigmaCad);
      assert.ok(pt.regLower1SigmaCad < pt.regMidCad);
      assert.ok(pt.regMidCad < pt.regUpper1SigmaCad);
      assert.ok(pt.regUpper1SigmaCad < pt.regUpper2SigmaCad);
      assert.ok(pt.bollingerLowerCad <= pt.bollingerUpperCad);
      assert.ok(pt.drawdownPct <= 0.001);
      assert.ok(pt.benchmarkDrawdownPct <= 0.001);
    }
  }

  const intcCurve = analyzeDeepCurveStructure({
    subjectId: 'INTC',
    horizonYears: 3,
    livePrices,
  });
  const ryCurve = analyzeDeepCurveStructure({
    subjectId: 'RY',
    horizonYears: 3,
    livePrices,
  });

  assert.ok(
    intcCurve.maxDrawdownPct < -35,
    `Expected deep drawdown on INTC 3Y curve, got ${intcCurve.maxDrawdownPct}%`
  );
  assert.ok(
    ryCurve.cagrPct > intcCurve.cagrPct + 15,
    `Expected RY 3Y CAGR (${ryCurve.cagrPct}%) >> INTC 3Y CAGR (${intcCurve.cagrPct}%)`
  );
  assert.ok(intcCurve.inflections.length >= 2, 'Should detect key peak/trough inflection markers');
});

test('Sovereign Yield Curve Diagnostics exposes official Bank of Canada and US Treasury term structures', () => {
  const yc = analyzeSovereignYieldCurve(2.1);
  assert.equal(yc.canadaBoC.length, 6);
  assert.equal(yc.usTreasury.length, 6);
  assert.ok(yc.boc10yPct > 2.5 && yc.boc10yPct < 5.5);
  assert.ok(yc.ust10yPct > 3.5 && yc.ust10yPct < 6.5);
  assert.equal(
    yc.bocSpread10y2yBps,
    Math.round((yc.boc10yPct - yc.boc2yPct) * 100)
  );
  assert.ok(yc.usCa10ySpreadBps > 50, 'US 10Y yield exceeds GoC 10Y yield in Nov 2026');
});
