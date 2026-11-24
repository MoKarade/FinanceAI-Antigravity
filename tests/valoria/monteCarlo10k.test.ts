import { test } from 'vitest';
import assert from 'node:assert/strict';
import { getLatestPrices } from '../../services/valoria/marketData';
import {
  buildBenchmarkComparisonSeries,
  computeHistoricalPortfolioStats,
  runPortfolioMonteCarlo10k,
} from '../../services/valoria/monteCarlo10k';

test('buildBenchmarkComparisonSeries computes cumulative return vs MSCI World across 1Y, 3Y, 5Y, and MAX', () => {
  const prices = getLatestPrices();
  const lots = [
    { id: '1', assetId: 'XBB', investedAmount: 4000, purchaseYearMonth: '2020-01' },
    { id: '2', assetId: 'BTC', investedAmount: 1000, purchaseYearMonth: '2020-04' },
    { id: '3', assetId: 'GOVT', investedAmount: 2000, purchaseYearMonth: '2022-06' },
  ];

  for (const period of ['1Y', '3Y', '5Y', 'MAX'] as const) {
    const series = buildBenchmarkComparisonSeries({
      lots,
      livePrices: prices,
      benchmarkAssetId: 'XBB',
      period,
    });

    assert.ok(series.length >= 12, `Expected >= 12 points for ${period}, got ${series.length}`);
    assert.equal(series[0].portfolioCumPct, 0, 'Start of period portfolio cumulative % must be 0');
    assert.equal(series[0].benchmarkCumPct, 0, 'Start of period benchmark cumulative % must be 0');
    const last = series[series.length - 1];
    assert.equal(
      Number((last.portfolioCumPct - last.benchmarkCumPct).toFixed(2)),
      last.alphaPct
    );
  }
});

test('buildBenchmarkComparisonSeries dynamically updates across 1M, 3M, 6M, ALL_HOLDING, 1Y, 3Y, 5Y, and MAX even for recent Dec 2025 FinanceAI lots', () => {
  const prices = getLatestPrices();
  const dailyDates: [string, number][] = [];
  for (let m = 1; m <= 11; m++) {
    for (const d of [2, 9, 16, 23]) {
      const dt = `2026-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (dt <= '2026-11-12') {
        dailyDates.push([dt, 200 + m * 4 + (d % 5)]);
      }
    }
  }
  const recentLots = [
    {
      id: 'adp-1',
      assetId: 'ADP',
      investedAmount: 22372,
      purchaseYearMonth: '2025-12',
      purchaseDate: '2025-12-12',
      quantity: 90,
      entryPriceCad: 248.58,
      baseSpotPriceCad: dailyDates[dailyDates.length - 1][1],
      dailyHistoryCad: [['2025-12-12', 248.58] as [string, number], ...dailyDates],
    },
    {
      id: 'xbb-1',
      assetId: 'XBB',
      investedAmount: 40008,
      purchaseYearMonth: '2025-12',
      purchaseDate: '2025-12-12',
      quantity: 42,
      entryPriceCad: 952.59,
      baseSpotPriceCad: 1123.1,
      dailyHistoryCad: [
        ['2025-12-12', 952.59] as [string, number],
        ...dailyDates.map(([dt], idx) => [dt, 955 + idx * 3.8] as [string, number]),
      ],
    },
  ];

  const s1m = buildBenchmarkComparisonSeries({ lots: recentLots, livePrices: prices, benchmarkAssetId: 'XBB', period: '1M' });
  const s6m = buildBenchmarkComparisonSeries({ lots: recentLots, livePrices: prices, benchmarkAssetId: 'XBB', period: '6M' });
  const sAll = buildBenchmarkComparisonSeries({ lots: recentLots, livePrices: prices, benchmarkAssetId: 'XBB', period: 'ALL_HOLDING' });
  const s3y = buildBenchmarkComparisonSeries({ lots: recentLots, livePrices: prices, benchmarkAssetId: 'XBB', period: '3Y' });
  const s5y = buildBenchmarkComparisonSeries({ lots: recentLots, livePrices: prices, benchmarkAssetId: 'XBB', period: '5Y' });
  const sMax = buildBenchmarkComparisonSeries({ lots: recentLots, livePrices: prices, benchmarkAssetId: 'XBB', period: 'MAX' });

  assert.ok(s1m.length < s6m.length && s6m.length < sAll.length, 'Daily windows 1M < 6M < ALL_HOLDING must have distinct lengths');
  assert.ok(s3y[0].yearMonth < '2024-01', `3Y series must start before 2024-01, got ${s3y[0].yearMonth}`);
  assert.ok(s5y[0].yearMonth < s3y[0].yearMonth, `5Y series (${s5y[0].yearMonth}) must start earlier than 3Y (${s3y[0].yearMonth})`);
  assert.ok(sMax[0].yearMonth < s5y[0].yearMonth, `MAX series (${sMax[0].yearMonth}) must start earlier than 5Y (${s5y[0].yearMonth})`);

  for (const s of [s1m, s6m, sAll, s3y, s5y, sMax]) {
    assert.equal(s[0].portfolioCumPct, 0, 'Every window must rebase portfolioCumPct to 0% at index 0');
    assert.equal(s[0].benchmarkCumPct, 0, 'Every window must rebase benchmarkCumPct to 0% at index 0');
  }
});

test('computeHistoricalPortfolioStats reflects empirical volatility hierarchy of selected assets', () => {
  const prices = getLatestPrices();
  const lowVolStats = computeHistoricalPortfolioStats(
    [{ id: 'c', assetId: 'CASH', investedAmount: 5000, purchaseYearMonth: '2022-01' }],
    prices
  );
  const eqVolStats = computeHistoricalPortfolioStats(
    [{ id: 'w', assetId: 'XBB', investedAmount: 5000, purchaseYearMonth: '2022-01' }],
    prices
  );
  const cryptoVolStats = computeHistoricalPortfolioStats(
    [{ id: 'b', assetId: 'BTC', investedAmount: 5000, purchaseYearMonth: '2022-01' }],
    prices
  );

  assert.ok(
    lowVolStats.annualizedVolatilityPct < eqVolStats.annualizedVolatilityPct,
    'Cash volatility must be strictly lower than MSCI World historical volatility'
  );
  assert.ok(
    eqVolStats.annualizedVolatilityPct < cryptoVolStats.annualizedVolatilityPct,
    'MSCI World volatility must be strictly lower than Bitcoin historical volatility'
  );
});

test('runPortfolioMonteCarlo10k generates 10,000 scenarios rapidly with strict quantile ordering', () => {
  const prices = getLatestPrices();
  const lots = [
    { id: '1', assetId: 'XBB', investedAmount: 6000, purchaseYearMonth: '2021-01' },
    { id: '2', assetId: 'GOVT', investedAmount: 3000, purchaseYearMonth: '2022-01' },
    { id: '3', assetId: 'BTC', investedAmount: 1000, purchaseYearMonth: '2023-01' },
  ];

  const t0 = Date.now();
  const mc = runPortfolioMonteCarlo10k({
    lots,
    livePrices: prices,
    monthlyContribution: 300,
    horizonYears: 15,
    scenarioCount: 10000,
    seed: 42,
  });
  const elapsedMs = Date.now() - t0;

  assert.equal(mc.scenarioCount, 10000);
  assert.equal(mc.yearlyQuantiles.length, 16);
  assert.equal(mc.samplePaths.length, 24);
  assert.ok(elapsedMs < 500, `10,000 scenarios should run well under 500ms, took ${elapsedMs}ms`);

  for (const pt of mc.yearlyQuantiles) {
    assert.ok(pt.p5 <= pt.p10, `p5 <= p10 at year ${pt.year}`);
    assert.ok(pt.p10 <= pt.p25, `p10 <= p25 at year ${pt.year}`);
    assert.ok(pt.p25 <= pt.p50, `p25 <= p50 at year ${pt.year}`);
    assert.ok(pt.p50 <= pt.p75, `p50 <= p75 at year ${pt.year}`);
    assert.ok(pt.p75 <= pt.p90, `p75 <= p90 at year ${pt.year}`);
    assert.ok(pt.p90 <= pt.p95, `p90 <= p95 at year ${pt.year}`);
  }

  assert.ok(mc.probabilityOfGainPct > 50 && mc.probabilityOfGainPct <= 100);
});

test('runPortfolioMonteCarlo10k raccord la courbe réelle depuis janv. 2025 et calibre sur dailyHistoryCad', () => {
  const prices = getLatestPrices();
  const baseSpot = prices.XBB ?? 100;

  const dailyCalm: [string, number][] = [];
  const dailyVolatile: [string, number][] = [];
  for (let i = 0; i < 23; i++) {
    const y = 2025 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    const dt = `${y}-${String(m).padStart(2, '0')}-20`;
    dailyCalm.push([dt, baseSpot * (0.96 + i * 0.002)]);
    dailyVolatile.push([dt, baseSpot * (i % 2 === 0 ? 1.18 : 0.79)]);
  }

  const mcCalm = runPortfolioMonteCarlo10k({
    lots: [
      {
        id: 'calm-lot',
        assetId: 'XBB',
        investedAmount: 50_000,
        purchaseYearMonth: '2025-01',
        purchaseDate: '2025-01-10',
        quantity: 500,
        baseSpotPriceCad: dailyCalm[dailyCalm.length - 1][1],
        dailyHistoryCad: dailyCalm,
      },
    ],
    livePrices: prices,
    monthlyContribution: 300,
    horizonYears: 10,
    scenarioCount: 10000,
    seed: 99,
  });

  const mcVol = runPortfolioMonteCarlo10k({
    lots: [
      {
        id: 'vol-lot',
        assetId: 'XBB',
        investedAmount: 50_000,
        purchaseYearMonth: '2025-01',
        purchaseDate: '2025-01-10',
        quantity: 500,
        baseSpotPriceCad: dailyVolatile[dailyVolatile.length - 1][1],
        dailyHistoryCad: dailyVolatile,
      },
    ],
    livePrices: prices,
    monthlyContribution: 300,
    horizonYears: 10,
    scenarioCount: 10000,
    seed: 99,
  });

  assert.equal(mcCalm.historicalStats.usedRealDailyCurveSince2025, true);
  assert.equal(mcVol.historicalStats.usedRealDailyCurveSince2025, true);
  assert.ok(
    mcVol.historicalStats.annualizedVolatilityPct >
      mcCalm.historicalStats.annualizedVolatilityPct
  );

  const histPts = mcCalm.historicalCurvePoints ?? [];
  assert.ok(histPts.length >= 12);
  assert.equal(histPts[0].yearMonth, '2025-01');
  for (let i = 1; i < histPts.length; i++) {
    assert.ok(histPts[i].yearDecimal > histPts[i - 1].yearDecimal);
  }
  assert.equal(histPts[histPts.length - 1].portfolioValueCad, mcCalm.initialCapital);
  assert.equal(histPts[histPts.length - 1].yearDecimal, mcCalm.anchorYearDecimal);
});
