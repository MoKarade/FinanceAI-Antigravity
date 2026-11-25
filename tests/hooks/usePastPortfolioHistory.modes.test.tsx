// [CA-10] usePastPortfolioHistory — chemins NON couverts par le test de dédup (PH2-c-1) :
//  - mode TEST : reconstruction DIRECTE depuis priceHistory de la fixture, sans aucun fetch réseau ;
//  - anti-fuite réel→test (revue #245, M3) : en mode test, le cache Finnhub MODULE est IGNORÉ
//    (un fetch réel résolu avant la bascule ne doit pas polluer la fixture d'un symbole partagé) ;
//  - gardes : aucun actif, ou mode réel sans clé → résultat sans fetch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

vi.mock('../../services/marketData', () => ({
    getHistory: vi.fn().mockResolvedValue([{ date: '2025-01-02', close: 100 }]),
    configureMarketDataProvider: vi.fn(),
}));
vi.mock('../../services/errorLogger', () => ({ logError: vi.fn(), logErrorThrottled: vi.fn(), onLogEntry: vi.fn(() => () => {}), __resetErrorThrottle: vi.fn(), }));

import { usePastPortfolioHistory, _resetPastHistoryFetchCache } from '../../hooks/usePastPortfolioHistory';
import { getHistory } from '../../services/marketData';
import { useFinanceStore } from '../../store/useFinanceStore';
import type { Asset } from '../../types';

// Actif CELI : sa valeur retombe dans le bucket `CELI` des points reconstruits.
const celiAsset = (priceHistory?: Array<{ date: string; price: number }>) => ({
    symbol: 'XEQT', quantity: 10, currency: 'CAD', currentPrice: 30,
    accountType: 'CELI', dateBought: '2025-01-01', priceHistory,
} as unknown as Asset);

describe('[CA-10] usePastPortfolioHistory — gardes sans fetch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _resetPastHistoryFetchCache();
        act(() => {
            useFinanceStore.setState({ assets: [], fxRates: { USD: 1.35, EUR: 1.5, CAD: 1 }, apiKeys: { gemini: '', anthropic: '', finnhub: '' } });
        });
    });

    it('garde : aucun actif → résultat vide, isLoading faux, aucun fetch', async () => {
        act(() => { useFinanceStore.setState({ assets: [], apiKeys: { gemini: '', anthropic: '', finnhub: 'k' } }); });
        const { result } = renderHook(() => usePastPortfolioHistory());

        // Laisse passer un tick : aucun effet de fetch ne doit partir.
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.points).toEqual([]);
        expect(result.current.coverage).toBe(1);
        expect(result.current.isLoading).toBe(false);
        expect(getHistory).not.toHaveBeenCalled();
    });

    it('mode réel SANS clé finnhub → pas de fetch, reconstruction de ce qu\'on a (no-fake)', async () => {
        act(() => {
            useFinanceStore.setState({
                apiKeys: { gemini: '', anthropic: '', finnhub: '' }, // pas de clé
                assets: [celiAsset([{ date: '2025-01-01', price: 20 }, { date: '2025-06-01', price: 20 }])],
            });
        });
        const { result } = renderHook(() => usePastPortfolioHistory());

        await waitFor(() => expect(result.current.points.length).toBeGreaterThan(0));
        expect(getHistory).not.toHaveBeenCalled();          // pas de clé → pas de réseau
        expect(result.current.isLoading).toBe(false);
    });
});
