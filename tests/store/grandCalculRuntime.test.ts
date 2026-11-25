// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useFinanceStore } from '../../store/useFinanceStore';
import { extrairePersistable, getHydrationStatus } from '../../store/optionsPersistance';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import type { GrandCalculResult } from '../../services/projection/types';
import type { GrandCalculProgress } from '../../services/projection/runAsync';

function makeDummyGrandCalculResult(sig = 'gc1:store-test'): GrandCalculResult {
    return {
        version: 1,
        paramsSig: sig,
        createdAt: '2026-11-17T04:00:00.000Z',
        durationMs: 500,
        iterationsRun: 50_000,
        regimesEnabled: true,
        historicalCrisesEnabled: false,
        survivalRatePct: 92,
        cvar95: 35_000,
        monthlyBands: [],
        fiAge: { reachedPct: 80, p5Age: 54, p50Age: 60, p95Age: null, horizonAge: 85 },
        goalProbabilities: [],
        guaranteedPurchasingPower: {
            p95SecurityMonthlyNetReal: 3100,
            p90SecurityMonthlyNetReal: 3500,
            p50SecurityMonthlyNetReal: 4600,
            retirementMonthsEvaluated: 240,
        },
        estateTax: {
            deterministicTotal: 40_000,
            deterministicFed: 18_000,
            deterministicQc: 22_000,
            mcTotalP5: 12_000,
            mcTotalP50: 42_000,
            mcTotalP95: 85_000,
            mcFedP50: 19_000,
            mcQcP50: 23_000,
            mcRealTotalP50: 29_000,
            taxableBreakdown: { rrspRrif: 25_000, capitalGainsTaxable: 15_000, rentalRecapture: 0 },
            projectedDeathAge: 88,
        },
    };
}

describe('store — état runtime Grand Calcul (non persisté et isolé par dossier/persona)', () => {
    beforeEach(() => {
        useFinanceStore.getState().resetState();
        localStorage.clear();
    });

    it('initialise les 4 champs runtime et expose les 5 actions sans recalcul automatique', () => {
        const s0 = useFinanceStore.getState();
        expect(s0.grandCalculResult).toBeNull();
        expect(s0.grandCalculStatus).toBe('idle');
        expect(s0.grandCalculProgress).toBeNull();
        expect(s0.grandCalculError).toBeNull();

        const sample = makeDummyGrandCalculResult();
        const progress: GrandCalculProgress = { done: 25_000, total: 50_000, pct: 50, simPerSec: 12_000, etaMs: 2100 };

        s0.setGrandCalculStatus('running');
        s0.setGrandCalculProgress(progress);
        s0.setGrandCalculError('avertissement test');
        s0.setGrandCalculResult(sample);

        const s1 = useFinanceStore.getState();
        expect(s1.grandCalculStatus).toBe('running');
        expect(s1.grandCalculProgress).toEqual(progress);
        expect(s1.grandCalculError).toBe('avertissement test');
        expect(s1.grandCalculResult).toBe(sample);

        s1.resetGrandCalcul();
        const s2 = useFinanceStore.getState();
        expect(s2.grandCalculResult).toBeNull();
        expect(s2.grandCalculStatus).toBe('idle');
        expect(s2.grandCalculProgress).toBeNull();
        expect(s2.grandCalculError).toBeNull();
    });

    it('exclut strictement tous les champs grandCalcul* de extrairePersistable et localStorage (version === 7)', () => {
        const store = useFinanceStore.getState();
        store.setGrandCalculResult(makeDummyGrandCalculResult('gc1:must-not-persist'));
        store.setGrandCalculStatus('ready');
        store.setGrandCalculProgress({ done: 50_000, total: 50_000, pct: 100, simPerSec: 10_000, etaMs: 0 });
        store.setGrandCalculError('erreur transitoire');

        const persistable = extrairePersistable(useFinanceStore.getState()) as Record<string, unknown>;
        expect(persistable).not.toHaveProperty('grandCalculResult');
        expect(persistable).not.toHaveProperty('grandCalculStatus');
        expect(persistable).not.toHaveProperty('grandCalculProgress');
        expect(persistable).not.toHaveProperty('grandCalculError');

        // Force une écriture localStorage via un champ persisté
        store.updateLastUpdate();
        const raw = localStorage.getItem(STORAGE_KEYS.persistStore);
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw as string) as { version: number; state: Record<string, unknown> };
        expect(parsed.version).toBe(7);
        expect(parsed.state).not.toHaveProperty('grandCalculResult');
        expect(parsed.state).not.toHaveProperty('grandCalculStatus');
        expect(parsed.state).not.toHaveProperty('grandCalculProgress');
        expect(parsed.state).not.toHaveProperty('grandCalculError');
        expect(raw).not.toContain('gc1:must-not-persist');
    });

    it('réinitialise les champs grandCalcul* à persist.rehydrate() (pull Drive ou blob injecté)', async () => {
        const store = useFinanceStore.getState();
        store.updateLastUpdate();
        const raw = localStorage.getItem(STORAGE_KEYS.persistStore);
        expect(raw).toBeTruthy();

        // 1) État vivant pollué EN PREMIER (avant d'injecter dans localStorage, sinon set() réécrit localStorage sans grandCalcul*)
        store.setGrandCalculResult(makeDummyGrandCalculResult('gc1:stale-live'));
        store.setGrandCalculStatus('ready');
        store.setGrandCalculProgress({ done: 10, total: 50_000, pct: 0.1, simPerSec: 10, etaMs: 100 });
        store.setGrandCalculError('live err');

        // 2) Injecte ensuite un blob persisté contenant réellement grandCalculResult (avec champs texte/booléens)
        const parsed = JSON.parse(raw as string) as { version: number; state: Record<string, unknown> };
        const injectedResult = makeDummyGrandCalculResult('gc1:injected');
        injectedResult.goalProbabilities = [
            {
                goalId: 'g-1',
                name: 'Objectif test',
                deadline: '2035-01-01',
                targetAmount: 50_000,
                probabilityPct: 80,
                medianShortfall: 0,
                status: 'evaluated',
            },
        ];
        parsed.state.grandCalculStatus = 'running';
        parsed.state.grandCalculError = 'injecté';
        parsed.state.grandCalculProgress = { done: 5, total: 50_000, pct: 0.01, simPerSec: 5, etaMs: 50 };
        parsed.state.grandCalculResult = injectedResult;
        localStorage.setItem(STORAGE_KEYS.persistStore, JSON.stringify(parsed));

        expect(localStorage.getItem(STORAGE_KEYS.persistStore)).toContain('gc1:injected');

        await useFinanceStore.persist.rehydrate();

        expect(getHydrationStatus().failed).toBe(false);
        expect(getHydrationStatus().error).toBeNull();

        const after = useFinanceStore.getState();
        expect(after.grandCalculResult).toBeNull();
        expect(after.grandCalculStatus).toBe('idle');
        expect(after.grandCalculProgress).toBeNull();
        expect(after.grandCalculError).toBeNull();
    });

    it('préserve grandCalculResult lors de setAppState et réinitialise sur resetState', () => {
        const store = useFinanceStore.getState();
        const realResult = makeDummyGrandCalculResult('gc1:real-user');
        store.setGrandCalculResult(realResult);
        store.setGrandCalculStatus('ready');

        // setAppState ne doit pas effacer grandCalculResult (la détection de péremption passe par paramsSig)
        store.setAppState({ lastUpdate: 999_999 });
        expect(useFinanceStore.getState().grandCalculResult).toBe(realResult);
        expect(useFinanceStore.getState().grandCalculStatus).toBe('ready');

        // resetState réinitialise grandCalcul*
        useFinanceStore.getState().setGrandCalculResult(makeDummyGrandCalculResult('gc1:before-reset'));
        useFinanceStore.getState().setGrandCalculStatus('running');
        useFinanceStore.getState().resetState();
        expect(useFinanceStore.getState().grandCalculResult).toBeNull();
        expect(useFinanceStore.getState().grandCalculStatus).toBe('idle');
        expect(useFinanceStore.getState().grandCalculProgress).toBeNull();
        expect(useFinanceStore.getState().grandCalculError).toBeNull();
    });

    it('élimine des champs grandCalcul* de mauvais types injectés dans localStorage avant verifierTypesRestaures sans échec d’hydratation', async () => {
        const store = useFinanceStore.getState();
        store.updateLastUpdate();
        const raw = localStorage.getItem(STORAGE_KEYS.persistStore);
        expect(raw).toBeTruthy();

        const parsed = JSON.parse(raw as string) as { version: number; state: Record<string, unknown> };
        parsed.state.grandCalculStatus = 123;
        parsed.state.grandCalculProgress = false;
        parsed.state.grandCalculError = 999;
        parsed.state.grandCalculResult = 'corrompu';
        localStorage.setItem(STORAGE_KEYS.persistStore, JSON.stringify(parsed));

        await useFinanceStore.persist.rehydrate();

        expect(getHydrationStatus().failed).toBe(false);
        expect(getHydrationStatus().error).toBeNull();
        const after = useFinanceStore.getState();
        expect(after.grandCalculStatus).toBe('idle');
        expect(after.grandCalculProgress).toBeNull();
        expect(after.grandCalculError).toBeNull();
        expect(after.grandCalculResult).toBeNull();
    });
});
