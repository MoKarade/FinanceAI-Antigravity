import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  ASSETS,
  MARKET_REGIMES,
  getLatestPrices,
} from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import {
  buildAssetTechnicalAnalysis,
  computeBeginnerStockVisualXRay,
  computeMacdSeries,
  computeSmaSeries,
  computeWilderRsiSeries,
  sliceTechnicalBarsByTimeframe,
} from '../../services/valoria/dailyTechnicalIndicators';

test('SMA 50/200, Wilder RSI-14, and MACD (12,26,9) satisfy exact mathematical invariants', () => {
  const linearUp = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5);
  const sma50 = computeSmaSeries(linearUp, 50);
  const sma200 = computeSmaSeries(linearUp, 200);

  assert.equal(sma50[48], null);
  assert.ok(sma50[49] !== null);
  assert.equal(sma200[198], null);
  assert.ok(sma200[199] !== null);
  // Arithmetic series mean of [100..124.5] = 112.25
  assert.equal(sma50[49], 112.25);

  const rsiUp = computeWilderRsiSeries(linearUp, 14);
  assert.equal(rsiUp[13], null);
  assert.equal(rsiUp[14], 100);
  assert.equal(rsiUp[259], 100);

  const oscillating = Array.from({ length: 120 }, (_, i) =>
    100 + Math.sin(i * 0.35) * 8 + i * 0.12
  );
  const rsiOsc = computeWilderRsiSeries(oscillating, 14);
  for (let i = 14; i < rsiOsc.length; i++) {
    const val = rsiOsc[i]!;
    assert.ok(val >= 0 && val <= 100, `RSI out of [0,100]: ${val}`);
  }

  const macd = computeMacdSeries(oscillating, 12, 26, 9);
  for (let i = 34; i < oscillating.length; i++) {
    assert.ok(macd.macdLine[i] !== null);
    assert.ok(macd.signalLine[i] !== null);
    assert.ok(macd.histogram[i] !== null);
    const diff = Math.abs(
      macd.histogram[i]! - (macd.macdLine[i]! - macd.signalLine[i]!)
    );
    assert.ok(diff < 0.001, `MACD histogram mismatch: ${diff}`);
  }
});

test('buildAssetTechnicalAnalysis delivers warmed-up MM50, MM200, RSI, and MACD across 6M, 1A, and 2A for expanded catalog', () => {
  assert.ok(
    ASSETS.length >= 225,
    `Expected >= 225 global assets in $ CAD, got ${ASSETS.length}`
  );
  const individualStocks = ASSETS.filter((a) => a.isIndividualStock);
  assert.ok(
    individualStocks.length >= 180,
    `Expected >= 180 individual stocks analyzed, got ${individualStocks.length}`
  );

  const sampleIds = ['ADP', 'RY', 'ADBE', 'POW', 'BABA', 'SMCI', 'XBB', 'BTC'];
  for (const id of sampleIds) {
    const tech = buildAssetTechnicalAnalysis(id);
    assert.ok(tech.bars2Y.length >= 480, `Expected >= 480 2Y bars for ${id}`);

    // Every single visible bar in 2A must already have warmed-up SMA50, SMA200, RSI14, and MACD!
    for (const bar of tech.bars2Y) {
      assert.ok(bar.closeCad > 0);
      assert.ok(bar.sma50 !== null && bar.sma50 > 0, `Null sma50 on ${id}`);
      assert.ok(bar.sma200 !== null && bar.sma200 > 0, `Null sma200 on ${id}`);
      assert.ok(
        bar.rsi14 !== null && bar.rsi14 >= 0 && bar.rsi14 <= 100,
        `Invalid rsi14 on ${id}`
      );
      assert.ok(bar.macdLine !== null, `Null macdLine on ${id}`);
      assert.ok(bar.signalLine !== null, `Null signalLine on ${id}`);
      assert.ok(bar.histogram !== null, `Null histogram on ${id}`);
    }

    const slice6m = sliceTechnicalBarsByTimeframe(tech, '6M');
    const slice1y = sliceTechnicalBarsByTimeframe(tech, '1A');
    const slice2y = sliceTechnicalBarsByTimeframe(tech, '2A');
    assert.equal(slice6m.bars.length, 126);
    assert.equal(slice1y.bars.length, 252);
    assert.equal(slice2y.bars.length, tech.bars2Y.length);
  }
});

test('computeBeginnerStockVisualXRay produces clear 6-pillar visual bars and sober green/neutral/red verdicts across 225+ assets', () => {
  const livePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const summary = evaluatePortfolioRealTime(
    [{ id: '1', assetId: 'XBB', investedAmount: 15000, purchaseYearMonth: '2024-01' }],
    livePrices
  );
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });

  const ry = universe.allAnalyses.find((a) => a.asset.id === 'RY');
  const aqn = universe.allAnalyses.find((a) => a.asset.id === 'AQN');
  const adbe = universe.allAnalyses.find((a) => a.asset.id === 'ADBE');
  assert.ok(ry && aqn && adbe, 'Expected RY, AQN, and ADBE in analyzed universe');

  const xrayRy = computeBeginnerStockVisualXRay(ry);
  const xrayAqn = computeBeginnerStockVisualXRay(aqn);
  assert.equal(xrayRy.pillars.length, 6);
  assert.equal(xrayAqn.verdictWord, 'VENDRE');
  assert.equal(xrayAqn.verdictTone, 'negative');
  assert.ok(xrayAqn.thermometerPositionPct > 65);
  assert.ok(xrayRy.piotroskiSegments >= 7);
  assert.ok(xrayAqn.piotroskiSegments <= 4);
});
