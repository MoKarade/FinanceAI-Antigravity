import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAdjacentTabs, ORDERED_NAV_TABS, scheduleIdleTabPrefetch } from '../../utils/tabPrefetch';
import { Tab } from '../../types';

describe('tabPrefetch', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'connection');

    afterEach(() => {
        vi.useRealTimers();
        if (originalDescriptor) {
            Object.defineProperty(navigator, 'connection', originalDescriptor);
        } else {
            delete (navigator as Navigator & { connection?: unknown }).connection;
        }
    });

    it('n execute aucun prechargement automatique quand navigator.connection.saveData est actif', () => {
        vi.useFakeTimers();
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        Object.defineProperty(navigator, 'connection', {
            configurable: true,
            value: { saveData: true, effectiveType: '4g' },
        });

        const stop = scheduleIdleTabPrefetch();
        expect(setTimeoutSpy).not.toHaveBeenCalled();
        stop();
        setTimeoutSpy.mockRestore();
    });

    it('retourne les onglets adjacents coherents sans inclure d onglets secondaires hors menu', () => {
        const adj = getAdjacentTabs(Tab.VALORIA);
        const idxInvest = ORDERED_NAV_TABS.indexOf(Tab.INVESTMENTS);
        expect(idxInvest).toBeGreaterThan(-1);
        expect(adj.prev).toBe(ORDERED_NAV_TABS[(idxInvest - 1 + ORDERED_NAV_TABS.length) % ORDERED_NAV_TABS.length]);
        expect(adj.next).toBe(ORDERED_NAV_TABS[(idxInvest + 1) % ORDERED_NAV_TABS.length]);
    });
});
