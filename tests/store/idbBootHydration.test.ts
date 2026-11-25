/**
 * @vitest-environment jsdom
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    writeIdbEntry,
    OVERFLOW_FLAG_KEY,
    PARTIAL_MIRROR_FLAG_KEY,
    _resetUnlimitedStateStorageForTests,
} from '../../services/unlimitedStateStorage';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { useFinanceStore } from '../../store/useFinanceStore';
import {
    hydrateStoreFromIdbOnce,
    applyCachedFxRatesSyncIfNeeded,
    needsBlockingIdbHydration,
    _resetIdbBootHydrationForTests,
} from '../../store/idbBootHydration';
import { computePresentTermes } from '../../services/portfolio';

const waitForIdbFlush = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

describe('idbBootHydration — réhydratation complète au boot sans flash de mauvaise somme', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        _resetUnlimitedStateStorageForTests();
        _resetIdbBootHydrationForTests();
        useFinanceStore.getState().resetState();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        localStorage.clear();
        _resetIdbBootHydrationForTests();
    });

    it('restaure tous les champs monétaires depuis IndexedDB quand le miroir localStorage est tronqué', async () => {
        const fullTransactions = [
            { id: 1, date: '2026-01-05', payee: 'Dépôt initial paie', amount: 50_000, category: 'Revenu', status: 'processed' as const },
            { id: 2, date: '2026-06-10', payee: 'Achat équipement', amount: -2_500, category: 'Équipement', status: 'processed' as const },
        ];
        const fullIdbState = {
            version: 7,
            state: {
                initialBalances: { 'Chèque': 25_000 },
                transactions: fullTransactions,
                assets: [
                    {
                        symbol: 'ETF_FICTIF',
                        name: 'FNB Fictif Global',
                        accountType: 'CELI',
                        quantity: 100,
                        buyPrice: 90,
                        currentPrice: 120,
                        performance: 33.3,
                        dateBought: '2025-01-10',
                        currency: 'CAD',
                    },
                ],
                debts: [
                    {
                        id: 'debt-1',
                        name: 'Prêt auto fictif',
                        category: 'Car',
                        balance: 4_500,
                        interestRate: 4.5,
                        minimumPayment: 300,
                    },
                ],
                realEstateGoals: [
                    {
                        id: 'prop-1',
                        name: 'Condo fictif',
                        isActive: true,
                        purchaseDate: '2024-01-01',
                        price: 300_000,
                        currentValue: 320_000,
                        downPayment: 60_000,
                        mortgageRate: 4.2,
                        amortization: 25,
                        totalClosingCosts: 4_000,
                        monthlyPayment: 1_300,
                        unrecoverableMonthly: 450,
                        isPrimaryResidence: true,
                        isRented: false,
                        maxValue: 0,
                    },
                ],
                fxRates: { USD: 1.37, EUR: 1.50, CAD: 1, lastFetched: Date.now() },
                fxRatesSource: 'api',
                fxRatesEstimated: false,
                lastUpdate: 1_700_000_000_000,
            },
        };

        // État local incomplet avant réhydratation IDB (ex: miroir tronqué écrit au cycle précédent)
        useFinanceStore.setState({
            initialBalances: { 'Chèque': 1_000 },
            transactions: [fullTransactions[1]],
            assets: [],
            debts: [],
            realEstateGoals: [],
            lastUpdate: 1_700_000_000_000,
        });
        await waitForIdbFlush();

        await writeIdbEntry(STORAGE_KEYS.persistStore, JSON.stringify(fullIdbState));
        await waitForIdbFlush();
        _resetUnlimitedStateStorageForTests();
        localStorage.setItem(OVERFLOW_FLAG_KEY, '1');
        localStorage.setItem(PARTIAL_MIRROR_FLAG_KEY, '1');

        expect(needsBlockingIdbHydration()).toBe(true);

        const wrongBefore = computePresentTermes(
            useFinanceStore.getState().initialBalances,
            useFinanceStore.getState().transactions,
            useFinanceStore.getState().assets,
            useFinanceStore.getState().fxRates,
            useFinanceStore.getState().debts,
            0,
            '2026-11-23',
        );
        expect(wrongBefore.avoirs - wrongBefore.dettes).toBe(-1_500);

        await hydrateStoreFromIdbOnce();

        const st = useFinanceStore.getState();
        expect(st.initialBalances).toEqual({ 'Chèque': 25_000 });
        expect(st.transactions).toHaveLength(2);
        expect(st.assets).toHaveLength(1);
        expect(st.debts).toHaveLength(1);
        expect(st.realEstateGoals).toHaveLength(1);

        const exactAfter = computePresentTermes(
            st.initialBalances,
            st.transactions,
            st.assets,
            st.fxRates,
            st.debts,
            0,
            '2026-11-23',
        );
        // 25 000 + 50 000 - 2 500 + (100 * 120) - 4 500 = 80 000
        expect(exactAfter.avoirs - exactAfter.dettes).toBe(80_000);
    });

    it('applyCachedFxRatesSyncIfNeeded hydrate les taux API en cache mais n’écrase jamais les taux manuels', () => {
        const now = Date.now();
        localStorage.setItem(
            'fx_rates_cache',
            JSON.stringify({
                USD: 1.36,
                EUR: 1.49,
                CAD: 1,
                lastFetched: now,
                estimated: false,
                source: 'api',
                cause: 'ok',
                attemptAt: now,
                observationDate: '2026-11-22',
            }),
        );

        useFinanceStore.setState({
            fxRates: { USD: 1.40, EUR: 1.47, CAD: 1, lastFetched: 0 },
            fxRatesEstimated: true,
            fxRatesSource: 'repli',
            fxLastAttemptCause: 'jamais-tente',
            fxLastAttemptAt: 0,
        });

        applyCachedFxRatesSyncIfNeeded();

        const afterApi = useFinanceStore.getState();
        expect(afterApi.fxRatesSource).toBe('api');
        expect(afterApi.fxRatesEstimated).toBe(false);
        expect(afterApi.fxRates.USD).toBe(1.36);

        // Un taux manuel doit rester strictement prioritaire
        useFinanceStore.setState({
            fxRates: { USD: 1.385, EUR: 1.51, CAD: 1, lastFetched: now },
            fxRatesEstimated: false,
            fxRatesSource: 'manuel',
            fxLastAttemptCause: 'manuel',
            fxLastAttemptAt: now,
        });

        applyCachedFxRatesSyncIfNeeded();
        expect(useFinanceStore.getState().fxRatesSource).toBe('manuel');
        expect(useFinanceStore.getState().fxRates.USD).toBe(1.385);
    });
});
