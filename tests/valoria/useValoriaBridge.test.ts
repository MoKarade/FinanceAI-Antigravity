// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useValoriaBridge, DEMO_PORTFOLIO_LOTS } from '../../hooks/useValoriaBridge';
import { useFinanceStore } from '../../store/useFinanceStore';
import { INITIAL_CONFIG } from '../../constants';
import { Tab, type Asset, type Transaction } from '../../types';
import { assetValueCad } from '../../services/portfolio';
import { verifierTypesRestaures } from '../../services/verifierTypesRestaures';
import { ASSETS } from '../../services/valoria/marketData';
import { parseFinanceAIPayload, SAMPLE_FINANCEAI_JSON } from '../../services/valoria/financeAiBridge';
import type { AnalystTradeRecommendation } from '../../services/valoria/proAnalystAdvisor';

function makeSyntheticAssets(): Asset[] {
  return [
    {
      symbol: 'MSFT',
      name: 'Microsoft Corp',
      quantity: 10,
      currency: 'USD',
      currentPrice: 430,
      performance: 20,
      dateBought: '2025-02-15',
      buyPrice: 360,
      purchases: [{ date: '2025-02-15', quantity: 10, price: 360 }],
      priceHistory: [
        { date: '2025-02-15', price: 360 },
        { date: '2026-10-15', price: 430 },
      ],
      accountType: 'CELI',
    },
    {
      symbol: 'ESE.PA',
      name: 'ETF S&P 500',
      quantity: 50,
      currency: 'EUR',
      currentPrice: 30,
      performance: 15,
      dateBought: '2024-05-10',
      buyPrice: 25,
      accountType: 'REER',
    },
    {
      symbol: 'RY.TO',
      name: 'Royal Bank of Canada',
      quantity: 20,
      currency: 'CAD',
      currentPrice: 160,
      performance: 10,
      dateBought: '2024-08-01',
      buyPrice: 140,
      accountType: 'NON-ENREG',
    },
  ];
}

describe('hooks/useValoriaBridge', () => {
  beforeEach(() => {
    useFinanceStore.getState().resetState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('respecte no-fake-data : lorsque store.assets est vide, realAssetsEmpty=true et lots=[] (jamais DEMO_PORTFOLIO_LOTS)', () => {
    const { result } = renderHook(() => useValoriaBridge());

    expect(result.current.realAssetsEmpty).toBe(true);
    expect(result.current.lots).toEqual([]);
    expect(result.current.realLots).toEqual([]);
    expect(result.current.lots).not.toEqual(DEMO_PORTFOLIO_LOTS);
    expect(result.current.isSimulationModified).toBe(false);
    expect(result.current.availableCashCad).toBe(0);
    expect(result.current.portfolioSummary.totalCurrentValue).toBe(0);
  });

  it('convertit strictement assets en $ CAD via fxRates, purchases[0], resolveFinanceAISymbol et registerDynamicMarketAsset', () => {
    const customAssets: Asset[] = [
      ...makeSyntheticAssets(),
      {
        symbol: 'XYZTEST.TO',
        name: 'Société Synthétique Test',
        quantity: 40,
        currency: 'CAD',
        currentPrice: 50,
        performance: 25,
        dateBought: '2025-01-20',
        purchases: [{ date: '2025-01-20', quantity: 40, price: 40 }],
        accountType: 'CELI',
      },
    ];

    const fxRates = { USD: 1.4, EUR: 1.6, CAD: 1, lastFetched: 1 };
    useFinanceStore.getState().setAppState({
      assets: customAssets,
      fxRates,
    });

    const { result } = renderHook(() => useValoriaBridge());

    expect(result.current.realAssetsEmpty).toBe(false);
    expect(result.current.lots).toHaveLength(4);

    // Parité exacte en $ CAD pour MSFT (USD -> CAD via 1.4) + dailyHistoryCad
    const msftLot = result.current.lots.find((l) => l.assetId === 'MSFT');
    expect(msftLot).toBeDefined();
    expect(msftLot?.entryPriceCad).toBeCloseTo(360 * 1.4, 2);
    expect(msftLot?.baseSpotPriceCad).toBeCloseTo(430 * 1.4, 2);
    expect(msftLot?.investedAmount).toBeCloseTo(10 * 360 * 1.4, 2);
    expect(msftLot?.purchaseDate).toBe('2025-02-15');
    expect(msftLot?.dailyHistoryCad).toEqual([
      ['2025-02-15', Number((360 * 1.4).toFixed(4))],
      ['2026-10-15', Number((430 * 1.4).toFixed(4))],
    ]);

    // Parité exacte en $ CAD pour ESE.PA (EUR -> CAD via 1.6)
    const eseLot = result.current.lots.find((l) => l.assetId === 'ESE');
    expect(eseLot).toBeDefined();
    expect(eseLot?.investedAmount).toBeCloseTo(50 * 25 * 1.6, 2);

    // Enregistrement dynamique d'un ticker absent du catalogue statique
    const dynLot = result.current.lots.find((l) => l.assetId === 'XYZTEST');
    expect(dynLot).toBeDefined();
    expect(dynLot?.investedAmount).toBeCloseTo(1600, 2);
    expect(ASSETS.some((a) => a.id === 'XYZTEST')).toBe(true);
    expect(result.current.livePrices.XYZTEST).toBeGreaterThan(0);

    // Total portefeuille Valoria === somme exacte assetValueCad FinanceAI
    const expectedTotalCad = customAssets.reduce(
      (sum, a) => sum + assetValueCad(a, fxRates),
      0
    );
    expect(result.current.portfolioSummary.totalCurrentValue).toBeCloseTo(
      expectedTotalCad,
      1
    );

    // Réactivité temps réel lors d'une variation de fxRates
    act(() => {
      useFinanceStore.getState().setAppState({
        fxRates: { USD: 1.5, EUR: 1.6, CAD: 1, lastFetched: 2 },
      });
    });

    const updatedMsftLot = result.current.lots.find((l) => l.assetId === 'MSFT');
    expect(updatedMsftLot?.investedAmount).toBeCloseTo(10 * 360 * 1.5, 2);
  });

  it('calcule et mémoïse budgetSync sur 10 500 transactions sans jamais cloner ni tronquer state.transactions', () => {
    const heavyTx: Transaction[] = Array.from({ length: 10500 }, (_, i) => {
      const month = (i % 6) + 1;
      return {
        id: i + 1,
        date: `2026-0${month}-15`,
        payee: i % 10 === 0 ? 'Paie employeur' : 'Épicerie Locale',
        amount: i % 10 === 0 ? 500 : -30,
        category: i % 10 === 0 ? 'Revenu' : 'Épicerie',
        status: 'processed',
        isTransfer: false,
      };
    });

    useFinanceStore.getState().setAppState({
      transactions: heavyTx,
      initialBalances: { LIQUIDITE: 22000 },
      config: {
        ...INITIAL_CONFIG,
        users: [
          { ...INITIAL_CONFIG.users[0], netSalary: 6500, grossSalary: 9000 },
          { ...INITIAL_CONFIG.users[1], netSalary: 0, grossSalary: 0 },
        ],
      },
      budgetItems: [
        { id: 'b1', name: 'Logement', target: 1800, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
        { id: 'b2', name: 'Assurances', target: 1200, frequency: 'Yearly', type: 'Commun', nature: 'Besoin' },
        { id: 'b3', name: 'CELI Auto', target: 500, frequency: 'Monthly', type: 'Perso 1', nature: 'Epargne' },
      ],
    });

    const { result } = renderHook(() => useValoriaBridge());

    const firstBudgetSyncRef = result.current.budgetSync;
    expect(firstBudgetSyncRef.monthlyIncomeEur).toBe(6500);
    // 1800 + (1200 / 12) = 1900 (épargne exclue des dépenses)
    expect(firstBudgetSyncRef.monthlyExpensesEur).toBe(1900);
    expect(firstBudgetSyncRef.monthlySavingsCapacityEur).toBe(4600);
    expect(firstBudgetSyncRef.emergencyFundEur).toBeGreaterThan(22000);

    // Référence exacte & intégrité de transactions préservées
    expect(useFinanceStore.getState().transactions).toBe(heavyTx);
    expect(useFinanceStore.getState().transactions).toHaveLength(10500);

    // Une tranche hors périmètre (activeTab / projectionStatus) ne doit pas invalider le mémo
    act(() => {
      useFinanceStore.getState().setActiveTab(Tab.BUDGET);
      useFinanceStore.getState().setProjectionStatus('computing');
    });
    expect(result.current.budgetSync).toBe(firstBudgetSyncRef);

    // Fallback transactions si salaires = 0 et budgetItems = []
    act(() => {
      useFinanceStore.getState().setAppState({
        config: INITIAL_CONFIG,
        budgetItems: [],
      });
    });
    expect(result.current.budgetSync.monthlyIncomeEur).toBeGreaterThan(0);
    expect(result.current.budgetSync.monthlyExpensesEur).toBeGreaterThan(0);
    expect(useFinanceStore.getState().transactions).toHaveLength(10500);
  });

  it('synchronise bidirectionnellement valoriaWatchlist, valoriaRiskProfile, isPrivacyMode et geminiApiKey', () => {
    useFinanceStore.getState().updateApiKeys({ gemini: 'cle-test-synthetique' });

    const { result } = renderHook(() => useValoriaBridge());

    expect(result.current.riskProfile).toBe('equilibre');
    expect(result.current.watchlistIds).toEqual([]);
    expect(result.current.geminiApiKey).toBe('cle-test-synthetique');
    expect(result.current.isPrivacyMode).toBe(false);

    act(() => {
      result.current.setRiskProfile('offensif');
      result.current.toggleWatchlistAsset('MSFT');
      result.current.toggleWatchlistAsset('RY');
    });

    expect(useFinanceStore.getState().valoriaRiskProfile).toBe('offensif');
    expect(useFinanceStore.getState().valoriaWatchlist).toEqual(['MSFT', 'RY']);
    expect(result.current.riskProfile).toBe('offensif');
    expect(result.current.watchlistIds).toEqual(['MSFT', 'RY']);

    // La garde de réhydratation doit accepter ces champs persistés sans aucun refus
    expect(verifierTypesRestaures(useFinanceStore.getState())).toEqual([]);

    act(() => {
      result.current.toggleWatchlistAsset('MSFT');
      useFinanceStore.getState().setPrivacyMode(true);
    });
    expect(useFinanceStore.getState().valoriaWatchlist).toEqual(['RY']);
    expect(result.current.isPrivacyMode).toBe(true);

    // Mise à jour externe dans le store reflétée côté hook
    act(() => {
      useFinanceStore.getState().setAppState({
        valoriaRiskProfile: 'prudent',
        valoriaWatchlist: ['XEQT', 'GOOGL'],
      });
    });
    expect(result.current.riskProfile).toBe('prudent');
    expect(result.current.watchlistIds).toEqual(['XEQT', 'GOOGL']);

    act(() => {
      result.current.setWatchlistIds(['ASML', 'AAPL']);
    });
    expect(useFinanceStore.getState().valoriaWatchlist).toEqual(['ASML', 'AAPL']);
  });

  it('prouve formellement ADR-V3 : aucune action de simulation ne modifie store.assets, transactions ou initialBalances', () => {
    const initialAssets = makeSyntheticAssets();
    const initialTx: Transaction[] = [
      {
        id: 1,
        date: '2026-03-01',
        payee: 'Paie',
        amount: 4000,
        category: 'Revenu',
        status: 'processed',
      },
    ];
    const initialBalances = { LIQUIDITE: 12000 };

    useFinanceStore.getState().setAppState({
      assets: initialAssets,
      transactions: initialTx,
      initialBalances,
      brokerLedger: [],
    });

    const snapAssets = JSON.stringify(useFinanceStore.getState().assets);
    const snapTx = JSON.stringify(useFinanceStore.getState().transactions);
    const snapBal = JSON.stringify(useFinanceStore.getState().initialBalances);
    const snapLedger = JSON.stringify(useFinanceStore.getState().brokerLedger);

    const assertStoreIntact = () => {
      const st = useFinanceStore.getState();
      expect(st.assets).toBe(initialAssets);
      expect(st.transactions).toBe(initialTx);
      expect(JSON.stringify(st.assets)).toBe(snapAssets);
      expect(JSON.stringify(st.transactions)).toBe(snapTx);
      expect(JSON.stringify(st.initialBalances)).toBe(snapBal);
      expect(JSON.stringify(st.brokerLedger)).toBe(snapLedger);
    };

    const { result } = renderHook(() => useValoriaBridge());
    expect(result.current.lots).toHaveLength(3);
    expect(result.current.isSimulationModified).toBe(false);

    // 1. Ajout de lot simulé
    act(() => {
      result.current.setAvailableCashCad(5000);
      result.current.addSimLot({
        assetId: 'AAPL',
        investedAmount: 4500,
        purchaseYearMonth: '2026-03',
      });
    });
    expect(result.current.isSimulationModified).toBe(true);
    expect(result.current.lots).toHaveLength(4);
    expect(result.current.simCashCad).toBe(5000);
    assertStoreIntact();

    // 2. Ordres unitaires achat & allègement simulés + suppression de ligne
    act(() => {
      result.current.executeSimSingleOrder('GOOGL', 2500);
      result.current.executeSimSingleOrder('MSFT', -1000);
      result.current.removeSimAssetHoldings('RY');
    });
    expect(result.current.lots.some((l) => l.assetId === 'GOOGL')).toBe(true);
    expect(result.current.lots.some((l) => l.assetId === 'RY')).toBe(false);
    assertStoreIntact();

    // 3. Plan d'arbitrage complet simulé
    const mockSell = { assetId: 'ESE', deltaCad: -2000 } as unknown as AnalystTradeRecommendation;
    const mockBuy = { assetId: 'GOLD', deltaCad: 2000 } as unknown as AnalystTradeRecommendation;
    act(() => {
      result.current.applySimFullAdvisoryPlan([mockSell], [mockBuy]);
    });
    expect(result.current.lots.some((l) => l.assetId === 'GOLD')).toBe(true);
    expect(result.current.availableCashCad).toBe(0);
    assertStoreIntact();

    // 4. Chargement démo explicite, import externe et vidage simulé
    act(() => {
      result.current.loadDemoSimPortfolio();
    });
    expect(result.current.lots).toHaveLength(DEMO_PORTFOLIO_LOTS.length);
    assertStoreIntact();

    act(() => {
      result.current.importExternalLotsToSim({
        lots: [{ assetId: 'XEQT', investedAmount: 3000, purchaseYearMonth: '2025-05' }],
        mode: 'replace',
      });
    });
    expect(result.current.lots).toHaveLength(1);
    expect(result.current.lots[0].assetId).toBe('XEQT');
    assertStoreIntact();

    act(() => {
      result.current.clearSimPortfolio();
    });
    expect(result.current.lots).toEqual([]);
    assertStoreIntact();

    // 5. Réinitialisation vers les vrais placements du store
    act(() => {
      result.current.resetSimToRealPortfolio();
    });
    expect(result.current.isSimulationModified).toBe(false);
    expect(result.current.lots).toHaveLength(3);
    assertStoreIntact();
  });

  it('expose brokerAuthority depuis fintableBrokerBalances et parse SAMPLE_FINANCEAI_JSON synthétique en $ CAD', () => {
    useFinanceStore.getState().setAppState({
      assets: makeSyntheticAssets(),
      fxRates: { USD: 1.4, EUR: 1.6, CAD: 1, lastFetched: 1 },
      fintableBrokerBalances: [
        {
          accountId: 'acc_test_celi',
          label: 'CELI Synthétique',
          balanceCad: 8000,
          taxRegime: 'CELI',
          at: Date.now(),
        },
      ],
    });

    const { result } = renderHook(() => useValoriaBridge());
    expect(result.current.brokerAuthority.regimesAppliques).toContain('CELI');
    expect(result.current.brokerAuthority.valeur).toBeGreaterThan(0);

    const parsedSample = parseFinanceAIPayload(SAMPLE_FINANCEAI_JSON);
    expect(parsedSample.sourceFormat).toBe('financeai_json');
    expect(parsedSample.importedLots).toHaveLength(7);
    expect(parsedSample.detectedRiskProfile).toBe('dynamique');
  });

  it('couvre add/removeWatchlistAsset, selectRegime, registerCustomOrLiveAsset, refreshVerifiedPrices et merge import', async () => {
    useFinanceStore.getState().setAppState({
      assets: [
        {
          symbol: 'NEWDYN.TO',
          name: 'Action Dynamique Test',
          quantity: 10,
          currency: 'CAD',
          currentPrice: 25,
          performance: 5,
          dateBought: '2010-99',
          buyPrice: 20,
          priceHistory: [
            { date: '2025-01-05', price: 20 },
            { date: 'invalid-date', price: -5 },
            { date: '2026-10-05', price: 25 },
          ],
        },
        {
          symbol: 'ETH-CAD',
          name: 'Ethereum CAD',
          quantity: 2,
          currency: 'CAD',
          currentPrice: 3000,
          performance: 10,
          dateBought: '2026-10-01',
          buyPrice: 2800,
          type: 'Crypto',
        } as unknown as Asset,
      ],
    });

    const { result } = renderHook(() => useValoriaBridge());

    act(() => {
      result.current.setWatchlistIds([]);
      result.current.addWatchlistAsset('   ');
      result.current.toggleWatchlistAsset('   ');
      result.current.removeWatchlistAsset('   ');
      result.current.addWatchlistAsset('RY');
      result.current.addWatchlistAsset('RY');
      result.current.addWatchlistAsset('MSFT');
      result.current.removeWatchlistAsset('RY');
    });
    expect(result.current.watchlistIds).toEqual(['MSFT']);

    act(() => {
      result.current.selectRegime('stagflation');
      result.current.selectRegime('regime_inconnu' as unknown as Parameters<typeof result.current.selectRegime>[0]);
    });
    expect(result.current.regimeId).toBe('regime_inconnu');

    act(() => {
      result.current.registerCustomOrLiveAsset({
        ticker: 'DYNVAL.TO',
        name: 'Fonds Synthétique Test',
        spotCad: 42.5,
        category: 'obligations',
        subClass: 'obligation_taux',
      });
      result.current.registerCustomOrLiveAsset({
        ticker: 'DYNZERO.TO',
        name: 'Fonds Zéro Spot',
        spotCad: 0,
        category: 'actions',
        subClass: 'action_ca',
      });
    });
    expect(result.current.livePrices.DYNVAL).toBeCloseTo(42.5, 2);

    act(() => {
      result.current.importExternalLotsToSim(
        [{ assetId: 'GOOGL', investedAmount: 2200, purchaseYearMonth: '2026-02' }],
        'merge'
      );
      result.current.importExternalLotsToSim({
        lots: [{ assetId: 'RY', investedAmount: 3100, purchaseYearMonth: '2025-11' }],
        mode: 'merge',
        budgetSync: {
          monthlyIncomeEur: 8000,
          monthlyExpensesEur: 4500,
          monthlySavingsCapacityEur: 3500,
          emergencyFundEur: 15000,
        },
      });
    });
    expect(result.current.budgetSync.monthlyIncomeEur).toBe(8000);
    expect(result.current.lots.some((l) => l.assetId === 'RY')).toBe(true);

    act(() => {
      result.current.setAvailableCashCad(-10);
      result.current.addSimLot({ assetId: 'RY', investedAmount: 0, purchaseYearMonth: '2026-01' });
      result.current.executeSimSingleOrder('RY', 10);
      result.current.executeSimSingleOrder('INEXISTANT', -500);
      result.current.executeSimSingleOrder('RY', -500);
      result.current.executeSimSingleOrder('RY', -999999);
    });
    expect(result.current.lots.some((l) => l.assetId === 'RY')).toBe(false);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            asOfDate: '2026-11-18',
            updatedCount: 2,
            livePricesCad: { CASH: 1, RY: 295.5, MSFT: 615.0 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    );
    await act(async () => {
      await result.current.refreshVerifiedPrices();
    });
    expect(result.current.verifiedFeedStatus).toContain('2 cours vérifiés');
    expect(result.current.livePrices.RY).toBeCloseTo(295.5, 2);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    await act(async () => {
      await result.current.refreshVerifiedPrices();
    });
    expect(result.current.verifiedFeedStatus).toBe('Clôtures certifiées actives');
  });
});
