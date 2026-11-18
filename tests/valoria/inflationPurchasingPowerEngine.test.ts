import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  INFLATION_SCENARIO_PRESETS,
  computeFisherRealRatePct,
  simulateInflationPurchasingPower,
} from '../../services/valoria/inflationPurchasingPowerEngine';

test('simulateInflationPurchasingPower quantifies historical 2016-2026 Canadian CPI erosion and Fisher real purchasing power', () => {
  const sim = simulateInflationPurchasingPower({
    capitalCad: 100000,
    horizonYears: 10,
    projectedInflationPct: 2.6,
    currentNominalReturnPct: 5.5,
    recommendedNominalReturnPct: 8.8,
  });

  // 2016-2026 Canadian CPI eroded ~24% of idle cash purchasing power
  assert.ok(
    sim.historicalDecadeCashLossPct > 20 && sim.historicalDecadeCashLossPct < 30,
    `Expected ~24% historical decade loss, got ${sim.historicalDecadeCashLossPct}%`
  );

  // Timeline covers 2016..2036 inclusive (21 points)
  assert.equal(sim.timeline.length, 21);
  const anchor2026 = sim.timeline.find((p) => p.year === 2026);
  assert.ok(anchor2026);
  assert.equal(anchor2026.cashRealCad, 100000);
  assert.equal(anchor2026.recommendedPortfolioRealCad, 100000);

  // Idle cash loses purchasing power by 2036, while recommended portfolio gains in real $ CAD
  assert.ok(sim.projectedCashRealEndCad < 80000);
  assert.equal(sim.projectedCashLossCad, 100000 - sim.projectedCashRealEndCad);
  assert.ok(sim.recommendedRealEndCad > sim.currentRealEndCad);
  assert.ok(sim.recommendedNominalEndCad > sim.recommendedRealEndCad);
  assert.ok(sim.nominalIllusionGapCad > 20000);
});

test('Higher inflation scenarios (stagflation 6.5%) erode cash and real returns strictly more than BoC 2.0% target', () => {
  const boc = simulateInflationPurchasingPower({
    capitalCad: 71428,
    horizonYears: 10,
    projectedInflationPct: INFLATION_SCENARIO_PRESETS[0].annualInflationPct, // 2.0%
    currentNominalReturnPct: 6.0,
    recommendedNominalReturnPct: 8.5,
  });

  const stag = simulateInflationPurchasingPower({
    capitalCad: 71428,
    horizonYears: 10,
    projectedInflationPct: INFLATION_SCENARIO_PRESETS[3].annualInflationPct, // 6.5%
    currentNominalReturnPct: 6.0,
    recommendedNominalReturnPct: 8.5,
  });

  assert.ok(stag.projectedCashLossCad > boc.projectedCashLossCad);
  assert.ok(stag.projectedCashRealEndCad < boc.projectedCashRealEndCad);
  assert.ok(stag.recommendedRealEndCad < boc.recommendedRealEndCad);
  assert.ok(
    computeFisherRealRatePct(8.5, 6.5) < computeFisherRealRatePct(8.5, 2.0)
  );
});

test('Zero or invalid capital gracefully falls back to finite 50 000 $ CAD simulation baseline', () => {
  const emptyPortfolioSim = simulateInflationPurchasingPower({
    capitalCad: 0,
    horizonYears: 5,
    projectedInflationPct: 3.0,
    currentNominalReturnPct: 5.0,
    recommendedNominalReturnPct: 7.5,
  });

  assert.equal(emptyPortfolioSim.baseCapitalCad, 50000);
  assert.ok(
    emptyPortfolioSim.timeline.every(
      (pt) =>
        Number.isFinite(pt.cashRealCad) &&
        Number.isFinite(pt.recommendedPortfolioRealCad) &&
        Number.isFinite(pt.recommendedNominalCad)
    )
  );
});
