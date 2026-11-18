import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, VERIFIED_SPOT_CAD_2026_11 } from '../../services/valoria/marketData';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { evaluatePortfolioRealTime, type PortfolioLot } from '../../services/valoria/engine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';
import { computeInstitutionalNewsMarketCorrelation } from '../../services/valoria/institutionalCurveAndNewsEngine';
import {
  buildDeepAiNewsIntelligenceLab,
  buildPortfolioDonutAllocation,
  classifyAssetAllocationSlice,
  filterHoldingsBySlice,
} from '../../services/valoria/portfolioOrbitalIntelligence';

const SAMPLE_LOTS: PortfolioLot[] = [
  { id: '1', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2021-03' },
  { id: '2', assetId: 'GOLD', investedAmount: 12000, purchaseYearMonth: '2022-06' },
  { id: '3', assetId: 'ADP', investedAmount: 9500, purchaseYearMonth: '2025-11' },
  { id: '4', assetId: 'RY', investedAmount: 11500, purchaseYearMonth: '2020-09' },
  { id: '5', assetId: 'PAYX', investedAmount: 5200, purchaseYearMonth: '2025-09' },
  { id: '6', assetId: 'INTC', investedAmount: 6400, purchaseYearMonth: '2024-04' },
];

test('classifyAssetAllocationSlice and buildPortfolioDonutAllocation partition portfolio into ETF, Or, Tech & IA, and Actions with 100% weight sum', () => {
  assert.equal(classifyAssetAllocationSlice('ADP'), 'tech_ia');
  assert.equal(classifyAssetAllocationSlice('PAYX'), 'tech_ia');
  assert.equal(classifyAssetAllocationSlice('GOLD'), 'or_refuges');
  assert.equal(classifyAssetAllocationSlice('XBB'), 'etf_monde');
  assert.equal(classifyAssetAllocationSlice('RY'), 'actions_value');
  assert.equal(classifyAssetAllocationSlice('BTC'), 'crypto_web3');
  assert.equal(classifyAssetAllocationSlice('ZAG'), 'obligations_cash');

  const macro = MARKET_REGIMES[0].indicators;
  const livePrices = { ...VERIFIED_SPOT_CAD_2026_11 };
  const summary = evaluatePortfolioRealTime(SAMPLE_LOTS, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: SAMPLE_LOTS,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 0,
    watchlistIds: ['GOOGL', 'LLY'],
  });
  const institutionalNews = computeInstitutionalNewsMarketCorrelation({
    universe,
    livePrices,
    heldAssetIds: advisory.heldLines.map((h) => h.assetId),
    watchlistIds: ['GOOGL', 'LLY'],
  });

  const donut = buildPortfolioDonutAllocation({
    advisory,
    institutionalNews,
    availableCashCad: 0,
  });

  assert.equal(donut.slices.length, 4);
  const weightSum = Number(
    donut.slices.reduce((s, x) => s + x.weightPct, 0).toFixed(1)
  );
  assert.equal(weightSum, 100);
  assert.ok(donut.totalValueCad > 50000);

  const techHoldings = filterHoldingsBySlice(advisory.heldLines, 'tech_ia');
  assert.equal(techHoldings.length, 3); // ADP, PAYX, INTC
});

test('buildDeepAiNewsIntelligenceLab builds 2nd-order causal chains and Bayesian narrative-price divergences', () => {
  const macro = MARKET_REGIMES[0].indicators;
  const livePrices = { ...VERIFIED_SPOT_CAD_2026_11 };
  const summary = evaluatePortfolioRealTime(SAMPLE_LOTS, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: SAMPLE_LOTS,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 0,
    watchlistIds: ['GOOGL', 'LLY'],
  });
  const institutionalNews = computeInstitutionalNewsMarketCorrelation({
    universe,
    livePrices,
    heldAssetIds: advisory.heldLines.map((h) => h.assetId),
    watchlistIds: ['GOOGL', 'LLY'],
  });

  const lab = buildDeepAiNewsIntelligenceLab({
    advisory,
    institutionalNews,
    universe,
    macro,
  });

  assert.ok(lab.causalChains.length >= 3);
  assert.ok(lab.divergenceRows.length >= 6);
  assert.ok(
    lab.bayesianPortfolioConfidencePct >= 5 &&
      lab.bayesianPortfolioConfidencePct <= 99
  );

  for (const chain of lab.causalChains) {
    assert.ok(Number.isFinite(chain.estimatedShockCad));
    assert.ok(chain.firstOrderChannel.includes('1er ordre'));
    assert.ok(chain.secondOrderContagion.includes('2e ordre'));
  }

  const intcRow = lab.divergenceRows.find((r) => r.assetId === 'INTC');
  assert.ok(intcRow, 'INTC should be analyzed in divergence matrix');
  assert.equal(intcRow.regimeCode, 'PIEGE_FONDAMENTAL');

  const pltrRow = lab.divergenceRows.find((r) => r.assetId === 'PAYX');
  assert.ok(pltrRow, 'PAYX should be analyzed in divergence matrix');
  assert.ok(
    pltrRow.regimeCode === 'EUPHORIE_PRICEE' ||
      pltrRow.regimeCode === 'PIEGE_FONDAMENTAL'
  );
});
