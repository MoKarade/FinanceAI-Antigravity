import { test } from 'vitest';
import assert from 'node:assert/strict';
import { MARKET_REGIMES, getLatestPrices } from '../../services/valoria/marketData';
import { evaluatePortfolioRealTime } from '../../services/valoria/engine';
import { computePortfolioRiskMetrics } from '../../services/valoria/quantAnalytics';
import { analyzeEquityUniverse } from '../../services/valoria/equityQuantEngine';
import {
  SAMPLE_FINANCEAI_JSON,
  buildCompactFinanceAIExportJson,
  buildFinanceAICsvExport,
  buildFinanceAIExportPayload,
  parseFinanceAIPayload,
} from '../../services/valoria/financeAiBridge';

test('analyzeEquityUniverse computes 22+ coherent metrics across individual stocks and separates strong buys from sells', () => {
  const prices = getLatestPrices();
  const macro = MARKET_REGIMES[0].indicators;

  const summary = analyzeEquityUniverse({
    livePrices: prices,
    macro,
    riskProfile: 'dynamique',
  });

  assert.ok(
    summary.totalStocks >= 42,
    `Expected >= 42 individual stocks, got ${summary.totalStocks}`
  );
  assert.ok(summary.strongBuyCount + summary.buyCount >= 8, 'Should surface clear buy candidates');
  assert.ok(summary.sellCount + summary.trimCount >= 5, 'Should surface clear sell/trim candidates');

  for (const eq of summary.allAnalyses) {
    assert.ok(eq.spotPrice > 0);
    assert.ok(eq.intrinsicValueDcfEur > 0);
    assert.ok(eq.rsi14 >= 0 && eq.rsi14 <= 100);
    assert.ok(eq.piotroskiFScore >= 0 && eq.piotroskiFScore <= 9);
    assert.ok(eq.quantScore >= 0 && eq.quantScore <= 100);
    assert.ok(eq.stopLossEur < eq.spotPrice);
    assert.equal(eq.sparkline24m.length, 24);
  }

  // GOOGL / ASML / EMR should strongly outscore distressed INTC / BA / TEP
  const googl = summary.allAnalyses.find((a) => a.asset.id === 'GOOGL')!;
  const asml = summary.allAnalyses.find((a) => a.asset.id === 'ASML')!;
  const emr = summary.allAnalyses.find((a) => a.asset.id === 'EMR')!;
  const intc = summary.allAnalyses.find((a) => a.asset.id === 'INTC')!;
  const ba = summary.allAnalyses.find((a) => a.asset.id === 'BA')!;
  const tep = summary.allAnalyses.find((a) => a.asset.id === 'TEP')!;

  assert.ok(googl.quantScore > intc.quantScore + 25);
  assert.ok(asml.quantScore > ba.quantScore + 25);
  assert.ok(emr.quantScore > intc.quantScore + 20);
  assert.ok(intc.signal === 'VENDRE' || intc.signal === 'ALLÉGER');
  assert.ok(ba.signal === 'VENDRE' || ba.signal === 'ALLÉGER');
  assert.ok(tep.signal === 'VENDRE' || tep.signal === 'ALLÉGER');
});

test('analyzeEquityUniverse adapts DCF upside and scores when BCE interest rates and VIX spike', () => {
  const prices = getLatestPrices();
  const rateCuts = MARKET_REGIMES.find((r) => r.id === 'rate_cuts_recovery')!.indicators;
  const stagflation = MARKET_REGIMES.find((r) => r.id === 'stagflation')!.indicators;

  const cutAnalysis = analyzeEquityUniverse({ livePrices: prices, macro: rateCuts });
  const stagAnalysis = analyzeEquityUniverse({ livePrices: prices, macro: stagflation });

  const asmlCut = cutAnalysis.allAnalyses.find((a) => a.asset.id === 'ASML')!;
  const asmlStag = stagAnalysis.allAnalyses.find((a) => a.asset.id === 'ASML')!;
  assert.ok(
    asmlCut.upsideDcfPct > asmlStag.upsideDcfPct,
    'Lower discount rates should increase DCF upside for high-duration growth equities'
  );

  const tteStag = stagAnalysis.allAnalyses.find((a) => a.asset.id === 'TTE')!;
  const tslaStag = stagAnalysis.allAnalyses.find((a) => a.asset.id === 'TSLA')!;
  assert.ok(
    tteStag.quantScore > tslaStag.quantScore,
    'TotalEnergies (FCF + inflation beta) should outscore Tesla during stagflation'
  );
});

test('FinanceAI bridge parses sample JSON, CSV, and quick-line payloads in $ CAD and flags held sell alerts', () => {
  const parsedJson = parseFinanceAIPayload(SAMPLE_FINANCEAI_JSON);
  assert.equal(parsedJson.sourceFormat, 'financeai_json');
  assert.equal(parsedJson.importedLots.length, 7);
  assert.equal(parsedJson.budgetSync?.monthlySavingsCapacityEur, 2600);
  assert.equal(parsedJson.detectedRiskProfile, 'dynamique');

  const prices = getLatestPrices();
  const lotsWithIds = parsedJson.importedLots.map((l, idx) => ({
    ...l,
    id: `imp-${idx}`,
  }));
  const portSummary = evaluatePortfolioRealTime(lotsWithIds, prices);
  const riskMetrics = computePortfolioRiskMetrics(lotsWithIds, prices);
  const eqSummary = analyzeEquityUniverse({
    livePrices: prices,
    macro: MARKET_REGIMES[0].indicators,
    evaluatedLots: portSummary.lots,
    totalPortfolioValue: portSummary.totalCurrentValue,
  });

  // Imported FinanceAI portfolio holds TEP and INTC -> should automatically trigger heldSellAlerts
  assert.ok(
    eqSummary.heldSellAlerts.length >= 2,
    `Expected >= 2 held sell alerts on imported FinanceAI portfolio, got ${eqSummary.heldSellAlerts.length}`
  );

  const exportBundle = buildFinanceAIExportPayload({
    portfolioSummary: portSummary,
    riskMetrics,
    equitySummary: eqSummary,
    riskProfile: 'dynamique',
    monthlySavingsCapacityEur: 2600,
  });
  assert.equal(exportBundle.schema, 'FinanceAI-Valoria-Bridge/v1.3-CAD');
  assert.equal(exportBundle.currency, 'CAD');
  assert.ok(exportBundle.tacticalSignals.buyNow.length >= 4);
  assert.ok(exportBundle.tacticalSignals.sellOrTrimNow.length >= 4);

  const compactExport = buildCompactFinanceAIExportJson(exportBundle);
  assert.ok(compactExport.length < 1500, 'Ultra-compact export must stay under 1.5 KB');
  assert.equal(JSON.parse(compactExport).s, 'Valoria->FinanceAI/v1.3-CAD-lite');

  const csvText = buildFinanceAICsvExport(exportBundle);
  assert.ok(csvText.includes('Valeur_ou_Spot_CAD;'));
  assert.ok(csvText.includes('SIGNAL_ACHAT;'));
  assert.ok(csvText.includes('SIGNAL_VENTE;'));

  const parsedCsv = parseFinanceAIPayload(
    'Ticker;Montant;Date\nSU.PA;3200;2023-04\nGOOGL;2100;2024-02'
  );
  assert.equal(parsedCsv.sourceFormat, 'csv');
  assert.equal(parsedCsv.importedLots.length, 2);
});

test('FinanceAI bridge compacts multi-megabyte v4.0 Zustand store backups, converts USD/EUR -> CAD via fxRates, and preserves dailyHistoryCad', () => {
  const heavyTransactions = Array.from({ length: 12000 }, (_, i) => ({
    id: i + 1,
    date: `2026-0${(i % 9) + 1}-15`,
    payee: i % 5 === 0 ? 'Salary Deposit' : 'Grocery Store Purchase — Everyday Account (6465)',
    amount: i % 5 === 0 ? 2800 : -190,
    category: i % 5 === 0 ? 'Revenu' : 'Épicerie',
    isTransfer: false,
  }));

  const dailyHistory = Array.from({ length: 230 }, (_, d) => {
    const month = Math.min(11, Math.floor(d / 21) + 1);
    const day = (d % 28) + 1;
    return {
      date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      price: 170 + d * 0.1,
    };
  });

  const v4Backup = JSON.stringify({
    version: '4.0',
    timestamp: 1794500831755,
    store: {
      state: {
        transactions: heavyTransactions,
        fxRates: { USD: 1.4181, EUR: 1.5839, CAD: 1 },
        initialBalances: { LIQUIDITE: 2552.08 },
        projection: {
          years: 40,
          theoreticalIncome: 5800,
          theoreticalExpenses: 1500,
          useTheoretical: false,
          appliedReturnProfile: 'aggressive',
        },
        budgetItems: [
          { name: 'Logement', target: 1600, frequency: 'Monthly' },
          { name: 'Transport', target: 300, frequency: 'Weekly' },
        ],
        assets: [
          { symbol: 'VCN', name: 'ZCN INC', quantity: 25, buyPrice: 360.48, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'ADP', name: 'SNPS CORP', quantity: 90, buyPrice: 175.29, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'EMR', name: 'TAIWAN SEMICONDUCTOR-SP ADR', quantity: 20, buyPrice: 292.46, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'DHR.TG', historySymbol: 'DHR.DE', name: 'DHR CORP', quantity: 60, buyPrice: 103, currency: 'EUR', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'ZEQT', historySymbol: 'AASU.SW', name: 'AMUNDI MSCI EM ASIA UCITS', quantity: 180, buyPrice: 52.43, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'ECL', name: 'SPACE EXPLORATION TECHN-CL A', quantity: 19.44, buyPrice: 172.8, currency: 'USD', dateBought: '2026-06-15', priceHistory: dailyHistory },
          { symbol: 'PAYX', name: 'CTAS TECHNOLOGIES INC-A', quantity: 55, buyPrice: 183.86, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'XBB.PA', name: 'AM MSCI WORLD SP ETF EUR ACC', quantity: 42, buyPrice: 601.42, currency: 'EUR', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'QQQM', name: 'ZLB AEROSPACE INC', quantity: 38, buyPrice: 198.62, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'VISA.TO', historySymbol: 'V', name: 'VISA INC - CDR', quantity: 21, buyPrice: 348.37, currency: 'USD', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'ZWB.PA', historySymbol: 'ZWB.MI', name: 'GOLD BULLION SECURITIES LTD', quantity: 115, buyPrice: 334.61, currency: 'EUR', dateBought: '2025-12-12', priceHistory: dailyHistory },
          { symbol: 'ODFL.PA', name: 'ROK SA', quantity: 20, buyPrice: 291.3, currency: 'EUR', dateBought: '2025-12-12', priceHistory: dailyHistory },
        ],
      },
    },
  });

  assert.ok(v4Backup.length > 900_000, 'Synthetic v4.0 backup should exceed ~1 MB');

  const res = parseFinanceAIPayload(v4Backup);
  assert.equal(res.importedLots.length, 12, 'All 12 FinanceAI v4.0 holdings should map cleanly');
  assert.equal(res.unmatchedSymbols.length, 0, 'Zero unmatched symbols expected');
  assert.equal(res.detectedRiskProfile, 'offensif');
  assert.ok(res.compactionStats?.wasCompacted);
  assert.equal(res.compactionStats?.strippedTransactionsCount, 12000);
  assert.ok(
    (res.compactionStats?.compactBytes ?? 999999) < 8000,
    'Compacted preview JSON should shrink under 8 KB'
  );
  assert.ok((res.budgetSync?.monthlySavingsCapacityEur ?? 0) > 0);

  // Verify USD -> CAD conversion via fxRates (25 * 360.48 USD * 1.4181 ≈ 12,779.92 $ CAD)
  const avgoLot = res.importedLots.find((l) => l.assetId === 'VCN')!;
  assert.equal(avgoLot.quantity, 25);
  assert.ok(
    Math.abs(avgoLot.investedAmount - 12779.92) < 1,
    `Expected VCN USD->CAD conversion ~12779.92 $ CAD, got ${avgoLot.investedAmount}`
  );
  assert.ok(
    (avgoLot.dailyHistoryCad?.length ?? 0) >= 200,
    'Should preserve compact dailyHistoryCad points for FinanceAI daily curve'
  );

  // Verify EUR -> CAD conversion via fxRates (42 * 601.42 EUR * 1.5839 ≈ 40,008.74 $ CAD)
  const cw8Lot = res.importedLots.find((l) => l.assetId === 'XBB')!;
  assert.ok(
    Math.abs(cw8Lot.investedAmount - 40008.74) < 1,
    `Expected XBB EUR->CAD conversion ~40008.74 $ CAD, got ${cw8Lot.investedAmount}`
  );

  // Verify truncated clipboard paste at 64 KB raises clear guidance
  const truncated64k = v4Backup.slice(0, 65536);
  assert.throws(
    () => parseFinanceAIPayload(truncated64k),
    /tronqué.*fichier \.json/i
  );
});

