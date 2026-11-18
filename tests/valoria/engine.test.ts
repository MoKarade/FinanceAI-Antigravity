import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, getLatestPrices } from '../../services/valoria/marketData';
import {
  scoreAssetsForMacro,
  computeOptimalAllocation,
  runMonteCarloProjection,
  runHistoricalBacktest,
  evaluatePortfolioRealTime,
  applyLiveMarketTick,
  simulateFeeImpact,
} from '../../services/valoria/engine';

test('scoreAssetsForMacro adapts asset rankings across equities, bonds, crypto, and safe havens', () => {
  const rateCuts = MARKET_REGIMES.find((r) => r.id === 'rate_cuts_recovery')!.indicators;
  const stagflation = MARKET_REGIMES.find((r) => r.id === 'stagflation')!.indicators;

  const bullScores = scoreAssetsForMacro(rateCuts, 'offensif', 'croissance_long_terme');
  const stagScores = scoreAssetsForMacro(stagflation, 'prudent', 'projet_moyen_terme');

  const goldInStag = stagScores.find((s) => s.asset.id === 'GOLD')!;
  const btcInStag = stagScores.find((s) => s.asset.id === 'BTC')!;
  assert.ok(
    goldInStag.predictiveScore > btcInStag.predictiveScore,
    'Gold should outscore Bitcoin for a prudent investor during stagflation'
  );

  const btcInBull = bullScores.find((s) => s.asset.id === 'BTC')!;
  const cashInBull = bullScores.find((s) => s.asset.id === 'CASH')!;
  assert.ok(
    btcInBull.expectedAnnualReturnPct > cashInBull.expectedAnnualReturnPct,
    'Crypto/Equities should have higher expected return than cash in rate-cut recovery'
  );
});

test('computeOptimalAllocation weights always sum to exact 100% across all profiles, goals, and regimes', () => {
  const profiles = ['prudent', 'equilibre', 'dynamique', 'offensif'] as const;
  const goals = [
    'croissance_long_terme',
    'retraite',
    'revenu_complementaire',
    'projet_moyen_terme',
  ] as const;

  for (const regime of MARKET_REGIMES) {
    for (const profile of profiles) {
      for (const goal of goals) {
        const scored = scoreAssetsForMacro(regime.indicators, profile, goal);
        const portfolio = computeOptimalAllocation(scored, profile, goal);
        const sum = portfolio.slices.reduce((acc, s) => acc + s.weightPct, 0);
        assert.equal(
          sum,
          100,
          `Expected weights to sum to 100 for ${regime.id}/${profile}/${goal}, got ${sum}`
        );
      }
    }
  }
});

test('evaluatePortfolioRealTime computes real-time P&L, category weights, and historical curve from purchase dates', () => {
  const basePrices = getLatestPrices();
  const tickedPrices = applyLiveMarketTick(
    basePrices,
    3,
    MARKET_REGIMES[0].indicators
  );

  const summary = evaluatePortfolioRealTime(
    [
      { id: '1', assetId: 'XBB', investedAmount: 4000, purchaseYearMonth: '2020-01' },
      { id: '2', assetId: 'GOVT', investedAmount: 2000, purchaseYearMonth: '2023-01' },
      { id: '3', assetId: 'BTC', investedAmount: 1000, purchaseYearMonth: '2020-04' },
    ],
    tickedPrices
  );

  assert.equal(summary.totalInvested, 7000);
  assert.equal(summary.lots.length, 3);
  assert.ok(summary.totalCurrentValue > 7000, 'Diversified 2020-2023 portfolio should show positive value');
  assert.ok(summary.history.length > 50, 'Should reconstruct monthly history since 2020-01');
  const weightSum = summary.lots.reduce((acc, l) => acc + l.weightPct, 0);
  assert.ok(Math.abs(weightSum - 100) <= 0.5);
});

test('runMonteCarloProjection and runHistoricalBacktest validate and compute accurately', () => {
  const projection = runMonteCarloProjection({
    initialCapital: 10000,
    monthlyContribution: 300,
    horizonYears: 12,
    expectedReturnPct: 7.5,
    annualVolatilityPct: 14.0,
  });
  assert.equal(projection.length, 13);
  assert.ok(projection[12].p10 <= projection[12].p50 && projection[12].p50 <= projection[12].p90);

  const btcBacktest = runHistoricalBacktest({
    assetId: 'BTC',
    startYearMonth: '2020-03',
    endYearMonth: '2025-12',
    mode: 'dca',
    amount: 100,
  });
  assert.equal(btcBacktest.totalInvested, 7000);
  assert.ok(btcBacktest.finalValue > btcBacktest.totalInvested);

  assert.throws(() =>
    runHistoricalBacktest({
      assetId: 'XBB',
      startYearMonth: '2020-01',
      endYearMonth: '2024-01',
      mode: 'lump_sum',
      amount: -50,
    })
  );

  const fees = simulateFeeImpact({
    initialCapital: 10000,
    monthlyContribution: 250,
    years: 20,
    grossReturnPct: 7.5,
    etfFeePct: 0.2,
    activeFundFeePct: 1.9,
  });
  assert.ok(fees[20].feesLost > 15000);
});
