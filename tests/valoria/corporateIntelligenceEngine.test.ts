import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, getLatestPrices } from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime } from '../../services/valoria/engine';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { buildPortfolioNewsIntelligence } from '../../services/valoria/newsCatalystEngine';
import {
  ResearchAgentId,
  buildAgentVoteMatrixRows,
  computeAssetCorporateIntelligence,
  getAgentSpecialistLeaderboard,
} from '../../services/valoria/corporateIntelligenceEngine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';

test('corporateIntelligenceEngine computes 7-agent committee consensus, curve timing, forensic & insider telemetry across all 236 assets', () => {
  const livePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const universe = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'equilibre',
    evaluatedLots: [],
    totalPortfolioValue: 50000,
  });
  const news = buildPortfolioNewsIntelligence({
    heldWeightsByAssetId: { ADP: 0.4, INTC: 0.3, RY: 0.3 },
    candidateAssetIds: ['GOOGL', 'BTC', 'GOVT'],
    macro,
  });

  const adp = computeAssetCorporateIntelligence({
    analysis: universe.byId.get('ADP')!,
    assetNews: news.byAssetId.get('ADP'),
    macro,
  });
  const intc = computeAssetCorporateIntelligence({
    analysis: universe.byId.get('INTC')!,
    assetNews: news.byAssetId.get('INTC'),
    macro,
  });
  const btc = computeAssetCorporateIntelligence({
    analysis: universe.byId.get('BTC')!,
    assetNews: news.byAssetId.get('BTC'),
    macro,
  });

  assert.equal(adp.quarterlyHistory.length, 8);
  assert.equal(adp.agentNodes.length, 7);
  assert.ok(adp.ecosystemLinks.length >= 4);
  assert.ok(adp.compositeAgentScore100 > intc.compositeAgentScore100);
  assert.ok(
    adp.committeeConsensus.buyVotes > intc.committeeConsensus.buyVotes,
    'ADP should receive more buy votes from the 7-agent committee than INTC'
  );
  assert.ok(adp.forensics.roicWaccSpreadPct > intc.forensics.roicWaccSpreadPct);
  assert.equal(adp.guidance.forwardCurveIndex.length, 5);
  assert.ok(
    adp.guidance.consensusLowCad <= adp.guidance.consensusMeanCad &&
      adp.guidance.consensusMeanCad <= adp.guidance.consensusHighCad
  );
  assert.ok(btc.positioning.institutionalOwnershipPct > 10);

  for (const item of universe.allAnalyses) {
    const intel = computeAssetCorporateIntelligence({
      analysis: item,
      assetNews: news.byAssetId.get(item.asset.id),
      macro,
    });
    assert.equal(intel.agentNodes.length, 7);
    assert.equal(
      intel.committeeConsensus.buyVotes +
        intel.committeeConsensus.neutralVotes +
        intel.committeeConsensus.sellVotes,
      7,
      `Vote sum must equal 7 for ${item.asset.id}`
    );
    assert.ok(intel.committeeConsensus.bullArguments.length >= 2);
    assert.ok(intel.committeeConsensus.bearArguments.length >= 2);
    assert.ok(
      Number.isFinite(intel.committeeConsensus.technicalSnapshot.rsi14),
      `Expected finite RSI14 for ${item.asset.id}`
    );
    assert.ok(
      Number.isFinite(intel.guidance.backlogOrRpoGrowthPct),
      `Expected finite RPO growth for ${item.asset.id}`
    );
    assert.ok(
      Number.isFinite(intel.quarterlyHistory[7].revenueGrowthYoYPct),
      `Expected finite YoY revenue growth for ${item.asset.id}`
    );
    assert.ok(
      !intel.keyCatalystTag.includes('NaN'),
      `Unexpected NaN in keyCatalystTag for ${item.asset.id}: ${intel.keyCatalystTag}`
    );
  }
});

test('buildProAnalystAdvisory integrates 7-agent specialist leaderboards, vote heatmap matrix, live overrides & 2027-2031 future cone', () => {
  const livePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const lots = [
    { id: '1', assetId: 'XBB', investedAmount: 18000, purchaseYearMonth: '2024-01' },
    { id: '2', assetId: 'ADP', investedAmount: 9500, purchaseYearMonth: '2025-01' },
    { id: '3', assetId: 'GOLD', investedAmount: 16500, purchaseYearMonth: '2024-06' },
    { id: '4', assetId: 'PAYX', investedAmount: 7200, purchaseYearMonth: '2025-06' },
    { id: '5', assetId: 'INTC', investedAmount: 5800, purchaseYearMonth: '2024-03' },
  ];

  const evalSummary = evaluatePortfolioRealTime(lots, livePrices);
  assert.ok(evalSummary.totalCurrentValue > 40000);

  const report = buildProAnalystAdvisory({
    lots,
    livePrices,
    macro,
    riskProfile: 'equilibre',
    liveAgentOverrides: {
      GOOGL: {
        ticker: 'GOOGL',
        assetId: 'GOOGL',
        accountingScore: 93,
        guidanceScore: 91,
        newsScore: 68,
        technicalScore: 87,
        positioningScore: 86,
        ecosystemScore: 90,
        riskShieldScore: 85,
        forwardReturnAdjustmentPct: 3.4,
        visualSignalTag: 'Leader IA',
        keyCatalystTag: 'Cloud +32 %',
        bullHighlight: 'Croissance Cloud +32% et marges solides',
        bearHighlight: 'Investissements serveurs IA élevés',
        isGeminiLive: true,
      },
    },
  });

  assert.equal(report.multiAgent.fleetNodes.length, 7);
  assert.equal(report.multiAgent.liveOverridesCount, 1);
  assert.ok(
    report.multiAgent.portfolioAgentScoreAfter100 >
      report.multiAgent.portfolioAgentScoreBefore100
  );

  const googlIntel = report.multiAgent.byAssetId.get('GOOGL')!;
  assert.equal(googlIntel.visualSignalTag, 'Leader IA');
  assert.equal(googlIntel.agentNodes[0].isLiveEnriched, true);
  assert.equal(
    googlIntel.committeeConsensus.bullArguments[0],
    'Croissance Cloud +32% et marges solides'
  );

  // Verify Specialist Leaderboards across all 7 agents
  const agentIds: ResearchAgentId[] = [
    'agent_filings',
    'agent_guidance',
    'agent_news',
    'agent_technicals',
    'agent_positioning',
    'agent_ecosystem',
    'agent_risk_shield',
  ];
  for (const agId of agentIds) {
    const board = getAgentSpecialistLeaderboard(report.multiAgent.byAssetId, agId, 4);
    assert.equal(board.topBuys.length, 4);
    assert.equal(board.topTraps.length, 4);
    assert.ok(
      board.topBuys[0].agentScore100 > board.topTraps[0].agentScore100,
      `Expected top buy score > top trap score for ${agId}`
    );
  }

  // Verify 7-Agent Vote Matrix builder across all 3 modes
  const consensusRows = buildAgentVoteMatrixRows({
    byAssetId: report.multiAgent.byAssetId,
    heldAssetIds: ['XBB', 'ADP', 'INTC'],
    recommendedBuyIds: ['GOOGL', 'RY'],
    mode: 'top_consensus',
    limit: 8,
  });
  const alertRows = buildAgentVoteMatrixRows({
    byAssetId: report.multiAgent.byAssetId,
    heldAssetIds: ['XBB', 'ADP', 'INTC'],
    recommendedBuyIds: ['GOOGL', 'RY'],
    mode: 'red_alerts',
    limit: 8,
  });

  assert.equal(consensusRows.length, 8);
  assert.equal(consensusRows[0].cells.length, 7);
  assert.ok(consensusRows[0].buyVotes >= alertRows[0].buyVotes);
  assert.ok(alertRows[0].sellVotes > consensusRows[0].sellVotes);

  const forecastPoints = report.multiAgent.futureConeSeries.filter((p) => p.isForecast);
  assert.equal(forecastPoints.length, 20); // 20 quarters = 5 years
  for (const pt of forecastPoints) {
    assert.ok(
      pt.afterP5Cad! < pt.afterP25Cad! &&
        pt.afterP25Cad! < pt.afterP50Cad! &&
        pt.afterP50Cad! < pt.afterP75Cad! &&
        pt.afterP75Cad! < pt.afterP95Cad!,
      `Expected strict quantile ordering at ${pt.label}`
    );
  }
  const endPt = forecastPoints[forecastPoints.length - 1];
  assert.ok(endPt.afterP50Cad! > endPt.beforeP50Cad!);
});
