import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, getAssetById, getLatestPrices } from '../../services/valoria/marketData';
import { PortfolioLot } from '../../services/valoria/engine';
import {
  buildProAnalystAdvisory,
  computeWatchlistHistoricalVolatility,
  crossVerifyRealTimePrice,
} from '../../services/valoria/proAnalystAdvisor';

test('buildProAnalystAdvisory flags distressed/overvalued holdings, funds high-ROIC undervalued buys, and validates 5-step CoT + real-time price cross-checks', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;

  const subOptimalLots: PortfolioLot[] = [
    { id: '1', assetId: 'INTC', investedAmount: 12000, purchaseYearMonth: '2025-06' },
    { id: '2', assetId: 'PAYX', investedAmount: 14000, purchaseYearMonth: '2025-12' },
    { id: '3', assetId: 'GOLD', investedAmount: 35000, purchaseYearMonth: '2025-12' },
    { id: '4', assetId: 'XBB', investedAmount: 25000, purchaseYearMonth: '2025-12' },
    { id: '5', assetId: 'ADP', investedAmount: 14000, purchaseYearMonth: '2025-12' },
  ];

  const report = buildProAnalystAdvisory({
    lots: subOptimalLots,
    livePrices: prices,
    macro,
    riskProfile: 'dynamique',
    availableCashCad: 2000,
    watchlistIds: ['GOOGL', 'SU', 'ASML', 'NOVO'],
  });

  assert.equal(
    report.verificationAudit.allDisplayedSignalsCrossVerified,
    true,
    'Every displayed signal must pass real-time price cross-verification and CoT'
  );

  assert.ok(
    report.sellRecommendations.length >= 3,
    `Expected >= 3 sell/trim recommendations (INTC, PAYX, overweight GOLD), got ${report.sellRecommendations.length}`
  );

  const intcSell = report.sellRecommendations.find((r) => r.assetId === 'INTC');
  const pltrSell = report.sellRecommendations.find((r) => r.assetId === 'PAYX');
  const goldTrim = report.sellRecommendations.find((r) => r.assetId === 'GOLD');

  assert.ok(intcSell && intcSell.actionLabel === 'VENDRE', 'INTC must be flagged VENDRE');
  assert.ok(pltrSell, 'PAYX (high P/E & negative DCF margin) must be flagged to sell/trim');
  assert.ok(goldTrim && goldTrim.actionLabel === 'ALLÉGER', '35% GOLD allocation must be trimmed');

  for (const rec of [...report.sellRecommendations, ...report.buyRecommendations]) {
    assert.equal(rec.pillars.length, 3, 'Every recommendation must provide 3 pro-analyst proof pillars');
    assert.equal(rec.chainOfThought.steps.length, 5, 'Every recommendation must carry a 5-step Chain-of-Thought');
    assert.equal(rec.chainOfThought.antiHallucinationPassed, true);
    assert.equal(rec.priceCrossCheck.isPriceValid, true);
    assert.equal(rec.priceCrossCheck.isSignalConsistentWithLivePrice, true);
    assert.equal(
      rec.spotPriceCad,
      Number(prices[rec.assetId].toFixed(2)),
      `Recommendation spotPriceCad for ${rec.assetId} must match exact real-time price`
    );
    if (rec.side === 'BUY') {
      if (rec.stopLossCad !== null) {
        assert.ok(
          rec.stopLossCad < rec.spotPriceCad,
          `BUY ${rec.ticker} stopLossCad (${rec.stopLossCad}) must be strictly below live spot (${rec.spotPriceCad})`
        );
      }
      if (rec.target12mCad !== null) {
        assert.ok(
          rec.target12mCad > rec.spotPriceCad,
          `BUY ${rec.ticker} target12mCad (${rec.target12mCad}) must be strictly above live spot (${rec.spotPriceCad})`
        );
      }
    }
    assert.ok(rec.headlineReason.length > 15);
    assert.ok(rec.estimatedShares > 0);
  }

  assert.ok(report.buyRecommendations.length >= 2, 'Should propose diversified buy candidates');
  const sumBuys = report.buyRecommendations.reduce((s, b) => s + b.deltaCad, 0);
  assert.ok(
    Math.abs(sumBuys - report.totalBuyBudgetCad) <= 5,
    `Buy allocations (${sumBuys}) should match totalBuyBudgetCad (${report.totalBuyBudgetCad})`
  );

  assert.ok(
    report.after.sharpeRatio > report.before.sharpeRatio,
    `Expected Sharpe to improve (${report.before.sharpeRatio} -> ${report.after.sharpeRatio})`
  );
  assert.ok(
    report.after.weightedDcfUpsidePct > report.before.weightedDcfUpsidePct,
    `Expected weighted DCF upside to improve (${report.before.weightedDcfUpsidePct}% -> ${report.after.weightedDcfUpsidePct}%)`
  );
  assert.ok(
    report.after.weightedRoicSpreadPct > report.before.weightedRoicSpreadPct,
    `Expected weighted ROIC-WACC spread to improve (${report.before.weightedRoicSpreadPct}% -> ${report.after.weightedRoicSpreadPct}%)`
  );
});

test('Real-time price cross-verification blocks BUY signal when live stock price surges above DCF fair value', () => {
  const basePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'XBB', investedAmount: 25000, purchaseYearMonth: '2025-06' },
  ];

  // Baseline check: find a stock recommended for BUY at normal verified prices
  const baselineReport = buildProAnalystAdvisory({
    lots,
    livePrices: basePrices,
    macro,
    riskProfile: 'dynamique',
    availableCashCad: 8000,
    watchlistIds: ['GOOGL', 'ASML', 'EMR'],
  });

  const stockBuy = baselineReport.buyRecommendations.find(
    (b) => getAssetById(b.assetId)?.isIndividualStock
  );
  assert.ok(stockBuy, 'Expected at least one individual stock BUY at baseline prices');

  // Surge that stock's real-time price by +55% (valid market move < 4.5x, but now above DCF fair value!)
  const surgedPrices = {
    ...basePrices,
    [stockBuy.assetId]: Number((basePrices[stockBuy.assetId] * 1.55).toFixed(2)),
  };

  const surgedReport = buildProAnalystAdvisory({
    lots,
    livePrices: surgedPrices,
    macro,
    riskProfile: 'dynamique',
    availableCashCad: 8000,
    watchlistIds: [stockBuy.assetId, 'GOOGL', 'ASML', 'EMR'],
  });

  const stillRecommended = surgedReport.buyRecommendations.find(
    (b) => b.assetId === stockBuy.assetId
  );
  assert.equal(
    stillRecommended,
    undefined,
    `Surged stock ${stockBuy.ticker} must be blocked from BUY recommendations after +55% live price jump`
  );

  const blockedRecord = surgedReport.verificationAudit.blockedSignals.find(
    (b) => b.assetId === stockBuy.assetId && b.attemptedSide === 'BUY'
  );
  assert.ok(
    blockedRecord,
    `Expected ${stockBuy.ticker} to be logged in verificationAudit.blockedSignals`
  );
});

test('Anti-hallucination Chain-of-Thought clamps fabricated bullish agent overrides on distressed/overvalued stocks', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'INTC', investedAmount: 10000, purchaseYearMonth: '2025-06' },
    { id: '2', assetId: 'XBB', investedAmount: 25000, purchaseYearMonth: '2025-06' },
  ];

  const report = buildProAnalystAdvisory({
    lots,
    livePrices: prices,
    macro,
    riskProfile: 'dynamique',
    availableCashCad: 5000,
    liveAgentOverrides: {
      // Simulate an extreme LLM hallucination claiming INTC is a 96/100 fortress compounder
      INTC: {
        ticker: 'INTC',
        assetId: 'INTC',
        accountingScore: 96,
        guidanceScore: 95,
        newsScore: 90,
        technicalScore: 92,
        positioningScore: 90,
        ecosystemScore: 90,
        riskShieldScore: 94,
        forwardReturnAdjustmentPct: 5.0,
        isGeminiLive: true,
      },
    },
  });

  assert.ok(
    report.verificationAudit.hallucinatedOverridesClampedCount >= 1,
    'Hallucinated INTC override must be detected and clamped'
  );

  const intcBuy = report.buyRecommendations.find((r) => r.assetId === 'INTC');
  assert.equal(intcBuy, undefined, 'INTC must NEVER be recommended as BUY despite hallucinated override');

  const intcSell = report.sellRecommendations.find((r) => r.assetId === 'INTC');
  assert.ok(intcSell && intcSell.actionLabel === 'VENDRE', 'INTC must still be flagged VENDRE');
  assert.equal(
    intcSell.priceCrossCheck.hallucinationGuardTriggered,
    true,
    'INTC priceCrossCheck must record hallucinationGuardTriggered = true'
  );
});

test('Corrupted or missing real-time prices (NaN, <= 0, 10x glitch, missing key) never emit unverified buy/sell signals and keep math NaN-free', () => {
  const corruptedPrices = { ...getLatestPrices() };
  corruptedPrices.INTC = Number.NaN;
  corruptedPrices.BCE = -42;
  corruptedPrices.DOGE = corruptedPrices.DOGE * 12; // 12x single-tick corruption glitch
  delete corruptedPrices.PAYX; // Missing real-time quote

  const macro = MARKET_REGIMES[0].indicators;
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'INTC', investedAmount: 8000, purchaseYearMonth: '2025-06' },
    { id: '2', assetId: 'BCE', investedAmount: 8000, purchaseYearMonth: '2025-06' },
    { id: '3', assetId: 'DOGE', investedAmount: 6000, purchaseYearMonth: '2025-06' },
    { id: '4', assetId: 'PAYX', investedAmount: 7000, purchaseYearMonth: '2025-06' },
    { id: '5', assetId: 'RY', investedAmount: 22000, purchaseYearMonth: '2025-06' },
  ];

  const report = buildProAnalystAdvisory({
    lots,
    livePrices: corruptedPrices,
    macro,
    riskProfile: 'equilibre',
    availableCashCad: 4000,
  });

  assert.ok(Number.isFinite(report.before.totalValueCad) && report.before.totalValueCad > 0);
  assert.ok(Number.isFinite(report.after.sharpeRatio));
  assert.ok(report.verificationAudit.corruptedOrMissingPricesCount >= 4);

  const unverifiedTickers = new Set(['INTC', 'BCE', 'DOGE', 'PAYX']);
  for (const rec of [...report.sellRecommendations, ...report.buyRecommendations]) {
    assert.equal(
      unverifiedTickers.has(rec.assetId),
      false,
      `Asset ${rec.assetId} with corrupted/missing real-time price must NEVER display a trade signal`
    );
  }
});

test('Real-time price pullback below intrinsic DCF value cancels valuation-only ALLÉGER signal', () => {
  const prices = { ...getLatestPrices() };
  const macro = MARKET_REGIMES[0].indicators;

  // Drop PAYX live price by -58% (100.81 $ vs 117.16 $ DCF fair value) so its former overvaluation turns into a genuine discount
  prices.PAYX = Number((prices.PAYX * 0.42).toFixed(2));

  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'PAYX', investedAmount: 6000, purchaseYearMonth: '2025-12' },
    { id: '2', assetId: 'XBB', investedAmount: 45000, purchaseYearMonth: '2025-12' },
    { id: '3', assetId: 'RY', investedAmount: 25000, purchaseYearMonth: '2025-12' },
  ];

  const report = buildProAnalystAdvisory({
    lots,
    livePrices: prices,
    macro,
    riskProfile: 'dynamique',
  });

  const pltrSell = report.sellRecommendations.find((r) => r.assetId === 'PAYX');
  assert.equal(
    pltrSell,
    undefined,
    'Valuation-only trim on PAYX must not fire when real-time price has pulled back below DCF fair value'
  );

  // Direct unit check on crossVerifyRealTimePrice for LIVE_DROP_RESOLVED_OVERVALUATION
  const pltrAsset = getAssetById('PAYX')!;
  const directCheck = crossVerifyRealTimePrice({
    asset: pltrAsset,
    livePrices: prices,
    fairValueCad: Number((prices.PAYX * 1.18).toFixed(2)),
    stopLossCad: Number((prices.PAYX * 0.85).toFixed(2)),
    target12mCad: Number((prices.PAYX * 1.25).toFixed(2)),
    attemptedSide: 'SELL',
    attemptedReasonType: 'valuation_overstretch',
    liveEffectivePeForward: 47,
  });
  assert.equal(directCheck.isSignalConsistentWithLivePrice, false);
  assert.equal(directCheck.blockedReasonCode, 'LIVE_DROP_RESOLVED_OVERVALUATION');
});

test('computeWatchlistHistoricalVolatility computes 12-month rolling volatility series (2016-2026), crisis peaks, and correlations', () => {
  const prices = getLatestPrices();
  const lots: PortfolioLot[] = [
    { id: '1', assetId: 'XBB', investedAmount: 20000, purchaseYearMonth: '2024-01' },
    { id: '2', assetId: 'ADP', investedAmount: 10000, purchaseYearMonth: '2024-01' },
  ];

  const volSummary = computeWatchlistHistoricalVolatility({
    watchlistIds: ['GOVT', 'XBB', 'GOOGL', 'ADP', 'BTC'],
    lots,
    livePrices: prices,
  });

  assert.equal(volSummary.assets.length, 5);
  assert.ok(
    volSummary.portfolioRolling12m.length >= 125,
    `Expected >= 125 monthly rolling points, got ${volSummary.portfolioRolling12m.length}`
  );

  const govt = volSummary.assets.find((a) => a.asset.id === 'GOVT')!;
  const xbb = volSummary.assets.find((a) => a.asset.id === 'XBB')!;
  const btc = volSummary.assets.find((a) => a.asset.id === 'BTC')!;

  assert.ok(govt.avgVol10yPct < xbb.avgVol10yPct, 'Bonds must have lower 10Y vol than MSCI World');
  assert.ok(xbb.avgVol10yPct < btc.avgVol10yPct, 'MSCI World must have lower 10Y vol than Bitcoin');

  for (const item of volSummary.assets) {
    assert.equal(item.rolling12m.length, volSummary.portfolioRolling12m.length);
    assert.ok(item.minVol12mPct <= item.currentVol12mPct);
    assert.ok(item.currentVol12mPct <= item.maxVol12mPct);
    assert.ok(item.corrWithPortfolio >= -1 && item.corrWithPortfolio <= 1);
  }
});

test('buildProAnalystAdvisory audits speculative cryptos (DOGE) and TSX yield traps (BCE.TO) with On-Chain & DCF pillars plus X-Ray stress tests', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;

  const cryptoAndTsxLots: PortfolioLot[] = [
    { id: 'c1', assetId: 'DOGE', investedAmount: 9000, purchaseYearMonth: '2025-06' },
    { id: 'c2', assetId: 'BCE', investedAmount: 11000, purchaseYearMonth: '2025-06' },
    { id: 'c3', assetId: 'RY', investedAmount: 20000, purchaseYearMonth: '2025-06' },
  ];

  const report = buildProAnalystAdvisory({
    lots: cryptoAndTsxLots,
    livePrices: prices,
    macro,
    riskProfile: 'equilibre',
  });

  const dogeSell = report.sellRecommendations.find((r) => r.assetId === 'DOGE');
  const bceSell = report.sellRecommendations.find((r) => r.assetId === 'BCE');

  assert.ok(dogeSell && dogeSell.actionLabel === 'VENDRE', 'DOGE must be flagged VENDRE via On-Chain NVT/Issuance');
  assert.ok(dogeSell.pillars[0].metricBadge.includes('NVT'), 'DOGE pillar must cite NVT ratio');
  assert.ok(bceSell && bceSell.actionLabel === 'VENDRE', 'BCE.TO yield trap must be flagged VENDRE');
  assert.equal(report.xray.stressScenarios.length, 4, 'Report must include 4 X-Ray stress scenarios');
});
