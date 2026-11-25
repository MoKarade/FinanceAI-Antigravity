import { describe, it, expect, beforeEach } from 'vitest';
import { useFinanceStore } from '../../store/useFinanceStore';
import { Tab } from '../../types';

describe('useFinanceStore', () => {
    beforeEach(() => {
        // Reset state entre tests (localStorage est partagé en jsdom).
        useFinanceStore.getState().resetState();
        localStorage.clear();
    });

    it('expose un activeTab initial = DASHBOARD (l\'Accueil plein visuel style Google est la page d\'ouverture)', () => {
        const { activeTab } = useFinanceStore.getState();
        expect(activeTab).toBe(Tab.DASHBOARD);
    });

    it('setActiveTab change l\'onglet courant', () => {
        useFinanceStore.getState().setActiveTab(Tab.INVESTMENTS);
        expect(useFinanceStore.getState().activeTab).toBe(Tab.INVESTMENTS);
    });

    it('setAppState merge sans écraser les champs non touchés', () => {
        const prev = useFinanceStore.getState();
        useFinanceStore.getState().setAppState({ lastUpdate: 12345 });
        const next = useFinanceStore.getState();
        expect(next.lastUpdate).toBe(12345);
        // config, assets, etc. doivent rester (merge superficiel).
        expect(next.config).toEqual(prev.config);
        expect(next.assets).toEqual(prev.assets);
    });

    it('updateApiKeys merge clé par clé sans écraser les autres', () => {
        useFinanceStore.getState().updateApiKeys({ anthropic: 'key1', finnhub: '' });
        useFinanceStore.getState().updateApiKeys({ anthropic: 'key2' });
        const { apiKeys } = useFinanceStore.getState();
        expect(apiKeys.anthropic).toBe('key2');
        expect(apiKeys.finnhub).toBe('');
    });

    it('persiste le state mais EXCLUT apiKeys du localStorage (audit 2026-05)', () => {
        useFinanceStore.getState().updateApiKeys({ anthropic: 'SECRET123', finnhub: 'FINNHUB456' });
        // Force trigger persist (Zustand persiste sur set)
        useFinanceStore.getState().setActiveTab(Tab.SETTINGS);
        const raw = localStorage.getItem('financeai-storage');
        expect(raw).toBeTruthy();
        // Les clés ne doivent JAMAIS être persistées en clair.
        expect(raw).not.toContain('SECRET123');
        expect(raw).not.toContain('FINNHUB456');
        expect(raw).not.toContain('apiKeys');
    });

    it('a une version persist = 7', () => {
        useFinanceStore.getState().setActiveTab(Tab.SETTINGS);
        const raw = localStorage.getItem('financeai-storage');
        if (!raw) throw new Error('Persist did not write');
        const parsed = JSON.parse(raw);
        expect(parsed.version).toBe(7);
    });

    it('fusionnerEtatPersiste purge un blob v7 legacy resté en mode test et restaure realDataSnapshot', async () => {
        localStorage.setItem('financeai-storage', JSON.stringify({
            version: 7,
            state: {
                isTestMode: true,
                activeTestPersonaId: 'couple-confort',
                realDataSnapshot: { transactions: [{ id: 'real1', date: '2026-01-01', amount: 100, payee: 'Test', category: 'Salaire' }] },
                transactions: [{ id: 'test-tx-1', date: '2026-01-01', amount: -50, payee: 'Fake', category: 'Épicerie' }],
            },
        }));
        await useFinanceStore.persist.rehydrate();
        const s = useFinanceStore.getState() as unknown as Record<string, unknown>;
        expect(s.isTestMode).toBeUndefined();
        expect(s.realDataSnapshot).toBeUndefined();
        expect(s.activeTestPersonaId).toBeUndefined();
        expect(useFinanceStore.getState().transactions.map((t) => t.id)).toEqual(['real1']);
    });

    it('retirementGoal.lifeExpectancy peut être mis à jour via setAppState (Phase C.3)', () => {
        const store = useFinanceStore.getState();
        const goal = store.retirementGoal;
        store.setAppState({ retirementGoal: { ...goal, lifeExpectancy: 95 } });
        expect(useFinanceStore.getState().retirementGoal.lifeExpectancy).toBe(95);
    });

    it('partialize EXCLUT les états UI transitoires du blob persisté (activeTab/isPrivacyMode/lastProjection/pendingFocus)', () => {
        const store = () => useFinanceStore.getState();
        // On pose des valeurs distinctes sur les 4 champs transitoires.
        store().setPrivacyMode(true);
        store().setLastProjection({ chartData: [{ marker: 'LEAK_PROJECTION' }] } as never);
        store().navigateWithFocus(Tab.SETTINGS, 'LEAK_SECTION'); // pose activeTab + pendingFocus, déclenche le persist
        const raw = localStorage.getItem('financeai-storage');
        if (!raw) throw new Error('Persist did not write');
        const parsed = JSON.parse(raw);
        // Ces 4 clés ne doivent JAMAIS atterrir dans le state persisté (cf partialize).
        // En particulier lastProjection : le persister fausserait la "source unique" au reload.
        expect(parsed.state).not.toHaveProperty('activeTab');
        expect(parsed.state).not.toHaveProperty('isPrivacyMode');
        expect(parsed.state).not.toHaveProperty('lastProjection');
        expect(parsed.state).not.toHaveProperty('pendingFocus');
        // Garde-fou complémentaire : leurs marqueurs sérialisés sont absents du blob.
        expect(raw).not.toContain('LEAK_PROJECTION');
        expect(raw).not.toContain('LEAK_SECTION');
        // Sanity : une tranche de DONNÉES, elle, est bien persistée.
        expect(parsed.state).toHaveProperty('transactions');
    });
});
