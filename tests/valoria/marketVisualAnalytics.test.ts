import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MARKET_REGIMES,
  VERIFIED_BOC_FX_TO_CAD,
  getLatestPrices,
} from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime, PortfolioLot } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';
import {
  buildSectorHeatmapHierarchy,
  computeWatchlistSentimentConsensus,
  HeatmapMetricMode,
} from '../../services/valoria/marketVisualAnalytics';
import {
  BASE_CURRENCY_CODE,
  BASE_CURRENCY_LABEL,
  formatCad,
  formatCompactCad,
  formatCompactEur,
  formatEur,
  formatPct,
  formatPriceCad,
  formatPriceEur,
  formatSignedCad,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import {
  VALORIA_HEATMAP_SCALE,
  VALORIA_ORBITAL_SLICE_COLORS,
  VALORIA_PALETTE,
  VALORIA_RISK_SERIES_COLORS,
  getValoriaToneColor,
} from '../../services/valoria/valoriaPalettes';

const sampleLots: PortfolioLot[] = [
  { id: '1', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2024-01' },
  { id: '2', assetId: 'ADP', investedAmount: 9500, purchaseYearMonth: '2025-01' },
  { id: '3', assetId: 'GOLD', investedAmount: 16500, purchaseYearMonth: '2024-06' },
  { id: '4', assetId: 'PAYX', investedAmount: 7200, purchaseYearMonth: '2025-06' },
  { id: '5', assetId: 'INTC', investedAmount: 5800, purchaseYearMonth: '2024-03' },
];

test('Verified market data eliminates over-optimistic green bias with real breadth & balanced signals', () => {
  assert.ok(VERIFIED_BOC_FX_TO_CAD.USD > 1.3 && VERIFIED_BOC_FX_TO_CAD.USD < 1.6);
  assert.ok(VERIFIED_BOC_FX_TO_CAD.EUR > 1.45 && VERIFIED_BOC_FX_TO_CAD.EUR < 1.75);

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

  assert.ok(universe.totalAssets >= 225, `All 225+ market assets must be analyzed, got ${universe.totalAssets}`);

  const buyRatio =
    (universe.countsBySignal['ACHAT FORT'] + universe.countsBySignal.ACHETER) /
    universe.totalAssets;
  const sellOrTrimRatio =
    (universe.countsBySignal.VENDRE + universe.countsBySignal.ALLÉGER) /
    universe.totalAssets;

  // Must NOT be a sea of green (>50% Buy); institutional Buy discipline should keep Buys < 42%
  assert.ok(
    buyRatio < 0.42 && buyRatio >= 0.14,
    `Expected realistic Buy ratio (14%-42%), got ${(buyRatio * 100).toFixed(1)}%`
  );
  assert.ok(
    sellOrTrimRatio >= 0.22,
    `Expected meaningful Sell/Trim dispersion (>=22%), got ${(sellOrTrimRatio * 100).toFixed(1)}%`
  );

  // Verified 1M market breadth (Nov 2026) and DCF upside reflect real two-sided market dispersion (no artificial sea of green)
  const heatmap1d = buildSectorHeatmapHierarchy(universe.allAnalyses, '1d');
  assert.equal(heatmap1d.totalAssets, universe.totalAssets);
  assert.ok(
    heatmap1d.decliners >= Math.floor(universe.totalAssets * 0.44) &&
      heatmap1d.advancers <= Math.ceil(universe.totalAssets * 0.50),
    `Expected realistic 1D pullback breadth (got ${heatmap1d.advancers} advancers vs ${heatmap1d.decliners} decliners on ${universe.totalAssets} assets)`
  );

  const heatmap1m = buildSectorHeatmapHierarchy(universe.allAnalyses, '1m');
  assert.equal(heatmap1m.totalAssets, universe.totalAssets);
  assert.ok(
    heatmap1m.decliners >= Math.floor(universe.totalAssets * 0.34) &&
      heatmap1m.advancers <= Math.ceil(universe.totalAssets * 0.62),
    `Expected realistic two-sided 1M breadth (got ${heatmap1m.advancers} advancers vs ${heatmap1m.decliners} decliners on ${universe.totalAssets} assets)`
  );

  const heatmapDcf = buildSectorHeatmapHierarchy(universe.allAnalyses, 'dcf');
  assert.ok(
    heatmapDcf.decliners >= 52,
    `Expected >= 52 overvalued/negative-DCF assets across 225+ catalog, got ${heatmapDcf.decliners}`
  );
});

test('Watchlist Sentiment Dials compute bounded D3 needle angles from institutional CAR & fundamentals', () => {
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
  const advisory = buildProAnalystAdvisory({
    lots: sampleLots,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 0,
  });

  const watchlistIds = ['LLY', 'RY', 'NOVO', 'GOOGL', 'INTC', 'DOGE'];
  const consensus = computeWatchlistSentimentConsensus({
    watchlistIds,
    multiAgent: advisory.multiAgent,
    universe,
  });

  assert.equal(consensus.dials.length, watchlistIds.length);
  for (const dial of consensus.dials) {
    assert.ok(dial.sentimentScore >= -100 && dial.sentimentScore <= 100);
    assert.ok(dial.needleAngleDeg >= -110 && dial.needleAngleDeg <= 110);
    assert.ok(dial.credibilityPct >= 88 && dial.credibilityPct <= 99);
  }

  const lly = consensus.dials.find((d) => d.assetId === 'LLY')!;
  const ry = consensus.dials.find((d) => d.assetId === 'RY')!;
  const intc = consensus.dials.find((d) => d.assetId === 'INTC')!;
  const doge = consensus.dials.find((d) => d.assetId === 'DOGE')!;

  assert.ok(
    lly.sentimentScore > intc.sentimentScore + 45,
    `Expected LLY (${lly.sentimentScore}) > INTC (${intc.sentimentScore}) + 45`
  );
  assert.ok(
    ry.sentimentScore >= 15,
    `Expected RY (${ry.sentimentScore}) >= 15`
  );
  assert.ok(consensus.bullishCount >= 2, `Expected >= 2 bullish dials, got ${consensus.bullishCount}`);
  assert.ok(consensus.bearishCount >= 2, `Expected >= 2 bearish dials, got ${consensus.bearishCount}`);
  assert.ok(intc.sentimentScore <= -25, `Expected INTC sentiment <= -25, got ${intc.sentimentScore}`);
  assert.ok(doge.sentimentScore <= -14, `Expected DOGE sentiment <= -14, got ${doge.sentimentScore}`);
});

test('Sector Heatmap Hierarchy groups all assets into accurate domain sectors across all 6 horizon modes', () => {
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

  const modes: HeatmapMetricMode[] = ['1d', '1m', '3m', '6m', '12m', 'dcf'];
  for (const mode of modes) {
    const root = buildSectorHeatmapHierarchy(universe.allAnalyses, mode);
    const leafCount = root.children.reduce((s, g) => s + g.children.length, 0);
    assert.equal(leafCount, universe.totalAssets);
    assert.ok(root.children.length >= 8 && root.children.length <= 12);
    for (let i = 1; i < root.children.length; i++) {
      assert.ok(root.children[i - 1].meanPerfPct >= root.children[i].meanPerfPct);
    }
  }

  // Verify strict sector accuracy (no pharma/energy leakage into Semi-Conducteurs or Logiciels)
  const root1m = buildSectorHeatmapHierarchy(universe.allAnalyses, '1m');
  const findGroupOf = (id: string) =>
    root1m.children.find((g) => g.children.some((l) => l.assetId === id))?.name;

  assert.equal(findGroupOf('ADP'), 'Semi-Conducteurs & Matériel IA');
  assert.equal(findGroupOf('ASML'), 'Semi-Conducteurs & Matériel IA');
  assert.equal(findGroupOf('ABBV'), 'Santé, Pharma & MedTech');
  assert.equal(findGroupOf('NOVO'), 'Santé, Pharma & MedTech');
  assert.equal(findGroupOf('SAN'), 'Santé, Pharma & MedTech');
  assert.equal(findGroupOf('CNQ'), 'Énergie, Mines & Services Publics');
  assert.equal(findGroupOf('XOM'), 'Énergie, Mines & Services Publics');
  assert.equal(findGroupOf('RY'), 'Banques, Assurance & Immobilier');
});

test('valoriaFormatters enforces $ CAD parity, compatibility aliases, and honest non-finite fallback while valoriaPalettes exports valid SVG hexes', () => {
  assert.equal(BASE_CURRENCY_CODE, 'CAD');
  assert.equal(BASE_CURRENCY_LABEL, '$ CAD');
  assert.equal(formatCad(1234.56, 2), formatEur(1234.56, 2));
  assert.ok(formatCad(1234).includes('$'));
  assert.equal(formatCad(Number.NaN), '—');
  assert.equal(formatSignedCad(Number.POSITIVE_INFINITY), '—');
  assert.equal(formatPct(Number.NaN), '—');
  assert.equal(formatSignedPct(12.5, 1), formatSignedPct(12.5, 1));
  assert.equal(formatSignedCad(500, 0), formatSignedEur(500, 0));
  assert.equal(formatCompactCad(1_500_000), formatCompactEur(1_500_000));
  assert.equal(formatPriceCad(4.321), formatPriceEur(4.321));
  assert.ok(formatCompactCad(12_000).includes('k$'));

  const hexRe = /^#[0-9a-f]{6}$/i;
  for (const hex of Object.values(VALORIA_PALETTE)) {
    assert.match(hex, hexRe);
  }
  for (const hex of Object.values(VALORIA_ORBITAL_SLICE_COLORS)) {
    assert.match(hex, hexRe);
  }
  for (const hex of Object.values(VALORIA_HEATMAP_SCALE)) {
    assert.match(hex, hexRe);
  }
  assert.ok(VALORIA_RISK_SERIES_COLORS.length >= 4);
  assert.equal(getValoriaToneColor('positive'), VALORIA_PALETTE.emerald);
  assert.equal(getValoriaToneColor('negative'), VALORIA_PALETTE.rose);
  assert.equal(getValoriaToneColor('neutral'), VALORIA_PALETTE.mutedZinc);
});
