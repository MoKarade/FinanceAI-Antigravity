import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, getLatestPrices } from '../../services/valoria/marketData';
import { PortfolioLot } from '../../services/valoria/engine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { evaluatePortfolioRealTime } from '../../services/valoria/engine';
import {
  buildConsultationTurnResponse,
  computeAssetProbableFuture,
  parseUserConsultationQuery,
  simulateTradeImpactOnPortfolio,
} from '../../services/valoria/agentAdvisorChatEngine';

const SAMPLE_LOTS: PortfolioLot[] = [
  { id: '1', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2025-01' },
  { id: '2', assetId: 'RY', investedAmount: 11500, purchaseYearMonth: '2025-03' },
  { id: '3', assetId: 'ADP', investedAmount: 9500, purchaseYearMonth: '2026-08' },
  { id: '4', assetId: 'GOLD', investedAmount: 12000, purchaseYearMonth: '2026-07' },
  { id: '5', assetId: 'PAYX', investedAmount: 6500, purchaseYearMonth: '2026-08' },
  { id: '6', assetId: 'INTC', investedAmount: 5800, purchaseYearMonth: '2026-08' },
];

test('parseUserConsultationQuery extracts French intents, tickers, aliases, and $ CAD amounts without stopword false-positives', () => {
  const q1 = parseUserConsultationQuery({
    question: "Qu'est-ce que ça engendre si j'investis 5 000 $ sur Google ?",
  });
  assert.equal(q1.intent, 'trade_impact');
  assert.ok(q1.mentionedAssetIds.includes('GOOGL'));
  assert.equal(q1.simulatedSide, 'BUY');
  assert.equal(q1.simulatedAmountCad, 5000);

  const q2 = parseUserConsultationQuery({
    question: 'Est-ce que je dois vendre INTC ou garder mes lignes actuelles ?',
  });
  assert.equal(q2.intent, 'sell_or_keep');
  assert.equal(q2.primaryAssetId, 'INTC');
  assert.equal(q2.simulatedSide, 'SELL');

  const q3 = parseUserConsultationQuery({
    question: "Quel est l'avenir probable de RY.TO sur 5 ans ?",
  });
  assert.equal(q3.intent, 'asset_future');
  assert.equal(q3.primaryAssetId, 'RY');

  const q4 = parseUserConsultationQuery({
    question: 'Quel serait un bon investissement en ce moment sur mon portefeuille ?',
  });
  assert.equal(q4.intent, 'best_investments');
  // Must NOT false-match French stopwords like "or" / "sur" / "en"
  assert.equal(q4.mentionedAssetIds.length, 0);
});

test('simulateTradeImpactOnPortfolio and computeAssetProbableFuture produce finite, real-time cross-verified $ CAD cones (P10 < P50 < P90)', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const evalSnap = evaluatePortfolioRealTime(SAMPLE_LOTS, prices);
  const universe = analyzeFullMarketUniverse({
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: evalSnap.lots,
    totalPortfolioValue: evalSnap.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: SAMPLE_LOTS,
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
  });

  const buyImpact = simulateTradeImpactOnPortfolio({
    lots: SAMPLE_LOTS,
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
    advisory,
    universe,
    assetId: 'GOOGL',
    side: 'BUY',
    amountCad: 5000,
  });

  assert.equal(buyImpact.actionType, 'BUY');
  assert.equal(buyImpact.deltaCad, 5000);
  assert.equal(buyImpact.isPriceCrossVerified, true);
  assert.ok(buyImpact.totalValueAfterCad > buyImpact.totalValueBeforeCad);
  assert.ok(buyImpact.weightAfterPct > buyImpact.weightBeforePct);
  assert.ok(buyImpact.var95MonthlyBeforeCad > 0);
  assert.ok(buyImpact.var95MonthlyAfterCad > 0);
  assert.ok(Number.isFinite(buyImpact.median5yDeltaCad));

  const futureGoogl = computeAssetProbableFuture({
    assetId: 'GOOGL',
    livePrices: prices,
    riskProfile: 'equilibre',
    advisory,
    universe,
  });

  assert.equal(futureGoogl.spotPriceCad, Number(prices.GOOGL.toFixed(2)));
  assert.equal(futureGoogl.horizonPoints.length, 6);
  for (let t = 1; t < futureGoogl.horizonPoints.length; t++) {
    const pt = futureGoogl.horizonPoints[t];
    assert.ok(
      pt.p10PessimisticCad < pt.p50ProbableCad &&
        pt.p50ProbableCad < pt.p90OptimisticCad,
      `Expected P10 < P50 < P90 at year +${t}, got ${pt.p10PessimisticCad} / ${pt.p50ProbableCad} / ${pt.p90OptimisticCad}`
    );
  }
  assert.equal(futureGoogl.chainOfThought.steps.length, 5);
});

test('buildConsultationTurnResponse answers best investment, sell/keep, impact, and future queries consistently with CoT advisory', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const evalSnap = evaluatePortfolioRealTime(SAMPLE_LOTS, prices);
  const universe = analyzeFullMarketUniverse({
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: evalSnap.lots,
    totalPortfolioValue: evalSnap.totalCurrentValue,
  });
  const advisory = buildProAnalystAdvisory({
    lots: SAMPLE_LOTS,
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
  });

  const turnSellKeep = buildConsultationTurnResponse({
    question: 'Que dois-je vendre ou garder dans mon portefeuille ?',
    lots: SAMPLE_LOTS,
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
    advisory,
    universe,
  });

  assert.equal(turnSellKeep.intent, 'sell_or_keep');
  assert.ok(
    turnSellKeep.sellVsKeep.toSellOrTrim.some((s) => s.assetId === 'INTC'),
    'INTC must appear in toSellOrTrim'
  );
  assert.ok(turnSellKeep.topBuyIdeas.length >= 2);
  assert.ok(turnSellKeep.agentVoices.length >= 1);
  assert.ok(turnSellKeep.plainFrenchAnswer.startsWith('En clair :'));
});
