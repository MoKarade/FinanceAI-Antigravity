import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, VERIFIED_SPOT_CAD_2026_11 } from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime, type PortfolioLot } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';
import {
  buildFocusedAssetSnapshot,
  buildPortfolioOrbitalGraph,
  computePairwiseAssetCorrelation,
} from '../../services/valoria/orbitalFocusEngine';

const DEMO_LOTS: PortfolioLot[] = [
  { id: 'lot-xbb', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2025-01' },
  { id: 'lot-ry', assetId: 'RY', investedAmount: 11500, purchaseYearMonth: '2025-03' },
  { id: 'lot-adp', assetId: 'ADP', investedAmount: 9500, purchaseYearMonth: '2026-08' },
  { id: 'lot-gold', assetId: 'GOLD', investedAmount: 12000, purchaseYearMonth: '2026-07' },
  { id: 'lot-payx', assetId: 'PAYX', investedAmount: 6500, purchaseYearMonth: '2026-08' },
  { id: 'lot-intc', assetId: 'INTC', investedAmount: 5800, purchaseYearMonth: '2026-08' },
];

test('buildPortfolioOrbitalGraph places principal asset at (0,0) and orbits holdings, cash, and buy recommendations by correlation & weight', () => {
  const macro = MARKET_REGIMES[0].indicators;
  const livePrices = { ...VERIFIED_SPOT_CAD_2026_11 };
  const summary = evaluatePortfolioRealTime(DEMO_LOTS, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: DEMO_LOTS,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 3500,
    watchlistIds: ['GOOGL', 'LLY'],
  });

  const graphRadial = buildPortfolioOrbitalGraph({
    advisory,
    universe,
    availableCashCad: 3500,
    layoutMode: 'radial',
  });

  assert.ok(graphRadial.coreNode, 'Core node must exist');
  assert.equal(graphRadial.coreNode.id, 'XBB');
  assert.equal(graphRadial.coreNode.x, 0);
  assert.equal(graphRadial.coreNode.y, 0);
  assert.equal(graphRadial.cashReserveCad, 3500);

  const cashNode = graphRadial.nodes.find((n) => n.id === 'CASH');
  assert.ok(cashNode, 'CASH liquidity node must orbit in the graph');
  assert.equal(cashNode.kind, 'cash_reserve');
  assert.ok(Math.hypot(cashNode.x, cashNode.y) > 100);

  const buyRecNodes = graphRadial.nodes.filter(
    (n) => n.kind === 'buy_recommendation'
  );
  assert.ok(
    buyRecNodes.length >= 1,
    'Recommended buy candidates must appear in outer orbit'
  );

  // Higher correlation equity should target a closer orbit than Gold diversifier
  const corrGold = computePairwiseAssetCorrelation('GOLD', 'XBB');
  const corrNvda = computePairwiseAssetCorrelation('ADP', 'XBB');
  assert.ok(corrNvda > corrGold, 'ADP should correlate more strongly with XBB than GOLD');

  const goldNode = graphRadial.nodes.find((n) => n.id === 'GOLD');
  const nvdaNode = graphRadial.nodes.find((n) => n.id === 'ADP');
  assert.ok(goldNode && nvdaNode);
  assert.ok(
    goldNode.targetOrbitRadius >= nvdaNode.targetOrbitRadius,
    'Diversifier GOLD should target an equal or wider orbit than higher-correlation ADP'
  );

  // Force-directed mode also settles cleanly without NaN coordinates
  const graphForce = buildPortfolioOrbitalGraph({
    advisory,
    universe,
    availableCashCad: 3500,
    layoutMode: 'force',
  });
  for (const node of graphForce.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
  }
});

test('orbital transitions preserve stable node IDs and promote a reinforced asset to center when it becomes #1', () => {
  const macro = MARKET_REGIMES[0].indicators;
  const livePrices = { ...VERIFIED_SPOT_CAD_2026_11 };

  // Reinforce ADP with +25,000 $ CAD so it surpasses XBB
  const reinforcedLots: PortfolioLot[] = [
    ...DEMO_LOTS,
    { id: 'lot-adp-boost', assetId: 'ADP', investedAmount: 25000, purchaseYearMonth: '2026-11' },
  ];
  const summary = evaluatePortfolioRealTime(reinforcedLots, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: reinforcedLots,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 0,
    watchlistIds: ['GOOGL'],
  });

  const graph = buildPortfolioOrbitalGraph({
    advisory,
    universe,
    availableCashCad: 0,
  });

  assert.equal(graph.coreNode?.id, 'ADP');
  const cw8InOrbit = graph.nodes.find((n) => n.id === 'XBB');
  assert.ok(cw8InOrbit);
  assert.equal(cw8InOrbit.kind, 'orbit_holding');
  assert.ok(Math.hypot(cw8InOrbit.x, cw8InOrbit.y) > 40);
});

test('buildFocusedAssetSnapshot isolates Monte Carlo 10k trajectories and buy/sell signals for held and recommended assets', () => {
  const macro = MARKET_REGIMES[0].indicators;
  const livePrices = { ...VERIFIED_SPOT_CAD_2026_11 };
  const summary = evaluatePortfolioRealTime(DEMO_LOTS, livePrices);
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: summary.lots,
    totalPortfolioValue: summary.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: DEMO_LOTS,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 2000,
    watchlistIds: ['GOOGL', 'LLY'],
  });

  const focusIntc = buildFocusedAssetSnapshot({
    assetId: 'INTC',
    lots: DEMO_LOTS,
    livePrices,
    availableCashCad: 2000,
    advisory,
    universe,
    horizonYears: 10,
  });

  assert.ok(focusIntc);
  assert.equal(focusIntc.isHeld, true);
  assert.equal(focusIntc.monteCarlo.scenarioCount, 10000);
  assert.equal(focusIntc.monteCarlo.yearlyQuantiles.length, 11);
  assert.ok(
    focusIntc.signalAction === 'VENDRE' || focusIntc.signalAction === 'ALLÉGER'
  );

  const firstBuyId = advisory.buyRecommendations[0]?.assetId ?? 'GOOGL';
  const focusBuy = buildFocusedAssetSnapshot({
    assetId: firstBuyId,
    lots: DEMO_LOTS,
    livePrices,
    availableCashCad: 2000,
    advisory,
    universe,
    horizonYears: 5,
  });

  assert.ok(focusBuy);
  assert.equal(focusBuy.monteCarlo.yearlyQuantiles.length, 6);
  assert.ok(
    focusBuy.signalAction === 'ACHETER' || focusBuy.signalAction === 'RENFORCER'
  );
});
