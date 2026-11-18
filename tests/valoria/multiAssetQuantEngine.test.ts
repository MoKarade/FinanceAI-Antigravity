import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  MARKET_REGIMES,
  getLatestPrices,
  registerDynamicMarketAsset,
} from '../../services/valoria/marketData';
import {
  analyzeFullMarketUniverse,
  computeConcretePortfolioXRay,
} from '../../services/valoria/multiAssetQuantEngine';

test('analyzeFullMarketUniverse covers 110+ global assets across TSX, US, Europe, Crypto, ETFs, Bonds, Commodities & REITs in $ CAD', () => {
  const livePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const summary = analyzeFullMarketUniverse({
    livePrices,
    macro,
    riskProfile: 'dynamique',
  });

  assert.ok(
    summary.totalAssets >= 110,
    `Expected >= 110 assets in global catalog, got ${summary.totalAssets}`
  );
  assert.ok(summary.countsBySubClass.action_ca >= 25, 'Should include >= 25 Canadian TSX stocks');
  assert.ok(summary.countsBySubClass.action_us >= 35, 'Should include >= 35 US stocks');
  assert.ok(summary.countsBySubClass.crypto_l1_defi >= 15, 'Should include >= 15 Crypto/DeFi assets');
  assert.ok(summary.countsBySubClass.etf_indice >= 10, 'Should include >= 10 ETFs');
  assert.ok(summary.countsBySubClass.obligation_taux >= 5, 'Should include >= 5 Bond/Cash funds');
  assert.ok(summary.countsBySubClass.matiere_premiere >= 4, 'Should include >= 4 Commodity assets');
  assert.ok(summary.countsBySubClass.immobilier_reit >= 3, 'Should include >= 3 REITs');

  // Verify TSX Stock (RY.TO), Crypto (SOL-CAD & DOGE-CAD), Bond (TLT), Commodity (HURA.TO)
  const rbc = summary.byId.get('RY');
  assert.ok(rbc, 'RBC (RY.TO) should exist');
  assert.equal(rbc.subClass, 'action_ca');
  assert.ok(rbc.concreteRatios.length >= 24, 'Stocks should expose >= 24 concrete analyst ratios');
  assert.ok(rbc.fairValueCad > 0 && rbc.stopLossCad > 0);

  const sol = summary.byId.get('SOL');
  const doge = summary.byId.get('DOGE');
  assert.ok(sol && doge, 'SOL and DOGE cryptos should exist');
  assert.ok(sol.cryptoDetails && doge.cryptoDetails);
  assert.ok(
    sol.quantScore > doge.quantScore,
    `High-utility PoS network SOL (${sol.quantScore}) should outscore inflationary meme DOGE (${doge.quantScore})`
  );
  assert.ok(
    doge.signal === 'VENDRE' || doge.signal === 'ALLÉGER',
    `DOGE should be flagged VENDRE or ALLÉGER, got ${doge.signal}`
  );

  const tlt = summary.byId.get('TLT');
  assert.ok(tlt && tlt.fundDetails);
  assert.ok(tlt.fundDetails.effectiveDurationYears > 14, 'TLT should expose long duration > 14y');
  assert.equal(tlt.optimalCanadianWrapper, 'REER');
});

test('registerDynamicMarketAsset adds any custom/live global ticker into $ CAD series and screener', () => {
  const custom = registerDynamicMarketAsset({
    ticker: 'IONQ',
    name: 'IonQ Inc. (Informatique Quantique)',
    spotCad: 46.8,
    category: 'actions',
    subClass: 'action_us',
    sector: 'Tech & Semi-Conducteurs',
    volatilityPct: 62,
    beta: 1.9,
  });

  assert.equal(custom.ticker, 'IONQ');
  const livePrices = getLatestPrices();
  assert.equal(livePrices[custom.id], 46.8);

  const summary = analyzeFullMarketUniverse({
    livePrices,
    macro: MARKET_REGIMES[0].indicators,
  });
  const analyzed = summary.byId.get(custom.id);
  assert.ok(analyzed, 'Dynamically registered ticker must appear in analyzeFullMarketUniverse');
  assert.equal(analyzed.spotPriceCad, 46.8);
});

test('computeConcretePortfolioXRay computes 4 stress-tests, passive income, currency exposure and CELI/REER tax rules', () => {
  const livePrices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;
  const beforeLots = [
    { id: '1', assetId: 'PAYX', investedAmount: 25000, purchaseYearMonth: '2025-06' },
    { id: '2', assetId: 'DOGE', investedAmount: 15000, purchaseYearMonth: '2025-06' },
  ];
  const afterLots = [
    { id: '3', assetId: 'RY', investedAmount: 15000, purchaseYearMonth: '2026-11' },
    { id: '4', assetId: 'XBB', investedAmount: 15000, purchaseYearMonth: '2026-11' },
    { id: '5', assetId: 'ZAG', investedAmount: 10000, purchaseYearMonth: '2026-11' },
  ];

  const xray = computeConcretePortfolioXRay({
    lots: beforeLots,
    afterLots,
    livePrices,
    macro,
  });

  assert.equal(xray.stressScenarios.length, 4);
  const aiBust = xray.stressScenarios.find((s) => s.id === 'ai_crypto_bust');
  assert.ok(aiBust);
  assert.ok(
    aiBust.impactAfterPct > aiBust.impactBeforePct,
    `Balanced post-arbitrage portfolio (${aiBust.impactAfterPct}%) must suffer far less in AI/Crypto bust than PAYX+DOGE (${aiBust.impactBeforePct}%)`
  );
  assert.ok(aiBust.capitalProtectedCad > 4000);
  assert.ok(
    xray.incomeAndFees.grossAnnualIncomeAfterCad > xray.incomeAndFees.grossAnnualIncomeBeforeCad,
    'RY + XBB + ZAG should generate higher annual passive income in $ CAD than PAYX + DOGE'
  );
  assert.ok(xray.taxWrapperLines.length === 3);
});
