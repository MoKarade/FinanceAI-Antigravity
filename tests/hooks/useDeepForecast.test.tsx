/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
    DEEP_SCENARIO_IDS,
    type DeepForecastProgress,
    type DeepForecastReport,
    type DeepScenarioId,
    type DeepScenarioOutput,
} from '../../services/projection/deepForecastTypes';
import type { ProjectionResult, SimulationParams } from '../../services/projection/types';
import type { BudgetConfig, RetirementGoal } from '../../types';

// Mocks des contrats externes d'Agent 1 pour tester la machine d'état du hook indépendamment.
const mockComputeQuickFourScenarios = vi.fn();
const mockComputeDeepForecastInputsSig = vi.fn();
const mockRunDeepForecastAsync = vi.fn();

vi.mock('../../services/projection/deepScenarioEngine', () => ({
    computeQuickFourScenarios: (...args: unknown[]) => mockComputeQuickFourScenarios(...args),
}));

vi.mock('../../services/projection/runDeepForecastAsync', () => ({
    DEEP_FORECAST_CANCELLED: '__DEEP_FORECAST_CANCELLED__',
    computeDeepForecastInputsSig: (...args: unknown[]) => mockComputeDeepForecastInputsSig(...args),
    runDeepForecastAsync: (...args: unknown[]) => mockRunDeepForecastAsync(...args),
}));

import { useFinanceStore } from '../../store/useFinanceStore';
import { useDeepForecast } from '../../hooks/useDeepForecast';
import * as deepForecastStoreMod from '../../services/deepForecastStore';
import * as errorLoggerMod from '../../services/errorLogger';

const initialStore = useFinanceStore.getState();

function makeParams(targetAge = 65): SimulationParams {
    return {
        projection: {
            years: 30,
            returnRate: 6,
            inflationRate: 2,
            savingsMode: 'manual',
            manualContribution: 900,
            usePortfolioRate: false,
        },
        calculatedStartingCash: 20_000,
        liveCSVBalances: {
            CELI: 45_000,
            CELIAPP: 0,
            REER: 80_000,
            NON_ENREG: 12_000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal: {
            targetAge,
            targetMonthlyIncome: 3_800,
            governmentPension: 1_200,
        } as RetirementGoal,
        config: {
            users: [
                { name: 'ProfilA', age: 36, grossSalary: 7_000, netSalary: 5_000, color: '#10b981' },
                { name: '', age: 36, grossSalary: 0, netSalary: 0, color: '#3b82f6' },
            ],
            splitMode: '50/50',
        } as BudgetConfig,
        baseGrossAnnual: 84_000,
        baseNetAnnual: 60_000,
        currentRentExpense: 1_400,
        baseMonthlyExpenses: 2_900,
        startYear: 2026,
        startMonth: 0,
    };
}

function makeScenarioOutput(id: DeepScenarioId, netWorth = 150_000): DeepScenarioOutput {
    return {
        id,
        label: `Scénario ${id}`,
        shortDescription: 'Description fictive',
        assumptionsSummaryFr: 'Hypothèse test',
        points: [
            {
                monthIndex: 0,
                year: 2026,
                age: 36,
                netWorth,
                p10: netWorth - 15_000,
                p50: netWorth,
                p90: netWorth + 15_000,
                mcRange: [netWorth - 15_000, netWorth + 15_000],
            },
        ],
        milestones: {
            fiAge: 58,
            fiProbabilityPct: 85,
            sustainableMonthlyNetRetirementCad: 4_000,
            sustainableMonthlyNetP90Cad: 3_300,
            goalsSummary: [],
            finalNetWorthP50: netWorth * 5,
            estateNetWorthP50: netWorth * 4.5,
            estateTaxP50: netWorth * 0.5,
            ruinProbabilityPct: 2,
        },
        turningPoints: [],
        appliedOptimizationsFr: [],
    };
}

function makeReport(overrides: Partial<DeepForecastReport> = {}): DeepForecastReport {
    const netWorth = overrides.isDeepRun ? 220_000 : 150_000;
    const scenarios = Object.fromEntries(
        DEEP_SCENARIO_IDS.map((id) => [id, makeScenarioOutput(id, netWorth)]),
    ) as Record<DeepScenarioId, DeepScenarioOutput>;

    return {
        version: 1,
        inputsSig: 'df1:sig:65',
        createdAt: '2026-11-18T12:00:00.000Z',
        durationMs: overrides.isDeepRun ? 950 : 12,
        trajectoriesRun: overrides.isDeepRun ? 100_000 : 0,
        isDeepRun: false,
        pastDiagnostic: {
            transactionsAnalyzed: 12,
            monthsCovered: 6,
            firstTransactionDate: '2026-05-01',
            lastTransactionDate: '2026-10-31',
            observedMonthlyIncomeCad: 5_000,
            observedMonthlyExpensesCad: 3_100,
            budgetedMonthlyExpensesCad: 3_000,
            monthlySpendingGapCad: 100,
            observedSavingsRatePct: 38,
            lifestyleCreepAnnualPct: 1.2,
            fixedExpensesSharePct: 60,
            discretionarySharePct: 40,
            peakSpendingMonthLabel: 'Juillet',
            lowSpendingMonthLabel: 'Février',
            weightedMerPct: 0.2,
            estimatedAnnualFeeAndTaxDragCad: 300,
            expenseVolatilityPct: 7,
            findingsFr: ['Constat test'],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T12:00:00.000Z',
            liveArticlesUsed: 0,
            offlineFallbackUsed: true,
            portfolioSentimentScore: null,
            portfolioSentimentLabel: 'Hors ligne',
            annualizedReturnAdjustmentPct: 0,
            volatilityMultiplier: 1,
            macroHeadlineFr: 'Aperçu rapide',
            keySignals: [],
            aiSynthesisFr: null,
            usedGemini: false,
        },
        valoriaSummary: null,
        scenarios,
        concreteActions: [],
        ...overrides,
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('hooks/useDeepForecast — orchestration Futur 4.0', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useFinanceStore.setState(initialStore, true);

        mockComputeDeepForecastInputsSig.mockImplementation(
            (input: { params: SimulationParams }) => `df1:sig:${input.params.retirementGoal.targetAge}`,
        );
        mockComputeQuickFourScenarios.mockImplementation(
            (input: { inputsSig: string }) =>
                makeReport({ inputsSig: input.inputsSig, isDeepRun: false, trajectoriesRun: 0 }),
        );
        mockRunDeepForecastAsync.mockResolvedValue(
            makeReport({ inputsSig: 'df1:sig:65', isDeepRun: true, trajectoriesRun: 100_000 }),
        );

        vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValue({ status: 'empty' });
        vi.spyOn(deepForecastStoreMod, 'saveAppliedDeepForecast').mockResolvedValue(true);
        vi.spyOn(deepForecastStoreMod, 'clearAppliedDeepForecast').mockResolvedValue(true);
        vi.spyOn(errorLoggerMod, 'logError').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('expose immédiatement quickPreviewReport sans bloquer l’affichage et ne lance jamais runDeepForecastAsync au montage', async () => {
        const params = makeParams(65);
        const { result, rerender } = renderHook(({ p }) => useDeepForecast(p, null), {
            initialProps: { p: params },
        });

        // Immédiatement disponible avant même la fin de la restauration IDB
        expect(result.current.quickPreviewReport.isDeepRun).toBe(false);
        expect(result.current.activeReport).toEqual(result.current.quickPreviewReport);
        expect(result.current.selectedScenario).toBe('real_trajectory');
        expect(result.current.isMemorized).toBe(false);
        expect(result.current.hasPendingToApply).toBe(false);
        expect(result.current.isOutdated).toBe(false);

        await waitFor(() => expect(result.current.status).toBe('idle'));
        rerender({ p: makeParams(62) });

        expect(mockRunDeepForecastAsync).not.toHaveBeenCalled();
        expect(result.current.quickPreviewReport.inputsSig).toBe('df1:sig:62');

        act(() => {
            result.current.setSelectedScenario('ai_optimized');
        });
        expect(result.current.selectedScenario).toBe('ai_optimized');
    });

    it('restaure appliedReport depuis IndexedDB et détecte isOutdated quand les paramètres changent', async () => {
        const params = makeParams(65);
        const saved = makeReport({ inputsSig: 'df1:sig:65', isDeepRun: true, trajectoriesRun: 100_000 });
        const loadSpy = vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValue({
            status: 'ok',
            report: saved,
        });

        const { result, rerender } = renderHook(({ p }) => useDeepForecast(p, null), {
            initialProps: { p: params },
        });

        await waitFor(() => expect(result.current.status).toBe('idle'));
        expect(loadSpy).toHaveBeenCalledWith({ isTestMode: false, personaId: null });
        expect(result.current.appliedReport).toEqual(saved);
        expect(result.current.activeReport).toEqual(saved);
        expect(result.current.isMemorized).toBe(true);
        expect(result.current.isOutdated).toBe(false);
        expect(result.current.unreadableStorage).toBe(false);

        rerender({ p: makeParams(60) });
        expect(result.current.isOutdated).toBe(true);
        expect(result.current.appliedReport).toEqual(saved);
    });

    it('signale unreadableStorage si IndexedDB est corrompu tout en conservant quickPreviewReport comme activeReport', async () => {
        vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValue({ status: 'unreadable' });

        const { result } = renderHook(() => useDeepForecast(makeParams(65), null));

        await waitFor(() => expect(result.current.status).toBe('error'));
        expect(result.current.unreadableStorage).toBe(true);
        expect(result.current.appliedReport).toBeNull();
        expect(result.current.error).toMatch(/Donnée illisible/i);
        expect(result.current.activeReport).toEqual(result.current.quickPreviewReport);
    });

    it('lance le calcul profond dans pendingReport (status staged) SANS écraser appliedReport ni IndexedDB avant applyPendingReport', async () => {
        const params = makeParams(65);
        const priorSaved = makeReport({
            inputsSig: 'df1:sig:65',
            createdAt: '2026-11-10T00:00:00.000Z',
            isDeepRun: true,
            trajectoriesRun: 80_000,
        });
        const newDeep = makeReport({
            inputsSig: 'df1:sig:65',
            createdAt: '2026-11-18T18:00:00.000Z',
            isDeepRun: true,
            trajectoriesRun: 100_000,
        });

        vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValue({
            status: 'ok',
            report: priorSaved,
        });
        const saveSpy = vi.spyOn(deepForecastStoreMod, 'saveAppliedDeepForecast');

        const deferredRun = createDeferred<DeepForecastReport>();
        let capturedProgressCb: ((p: DeepForecastProgress) => void) | undefined;
        mockRunDeepForecastAsync.mockImplementationOnce((input, opts) => {
            expect(input.apiKey).toBe('test-gemini-key');
            expect(input.fxRates).toEqual({ USD: 1.38, EUR: 1.5, CAD: 1 });
            capturedProgressCb = opts?.onProgress;
            return deferredRun.promise;
        });

        useFinanceStore.setState({
            apiKeys: { gemini: 'test-gemini-key', finnhub: '' },
            fxRates: { USD: 1.38, EUR: 1.5, CAD: 1, lastFetched: 123456 },
            valoriaRiskProfile: 'dynamique',
        });

        const { result } = renderHook(() => useDeepForecast(params, { chartData: [] } as unknown as ProjectionResult));
        await waitFor(() => expect(result.current.status).toBe('idle'));
        expect(result.current.appliedReport).toEqual(priorSaved);

        let launchPromise!: Promise<void>;
        act(() => {
            launchPromise = result.current.launchDeepForecast();
        });

        expect(result.current.status).toBe('running');
        expect(result.current.appliedReport).toEqual(priorSaved);

        act(() => {
            capturedProgressCb?.({
                phase: 'monte_carlo_100k',
                phaseIndex: 3,
                phaseTotal: 4,
                phaseLabel: 'Monte Carlo 100k',
                percent: 65,
                trajectoriesDone: 65_000,
                trajectoriesTotal: 100_000,
                etaSeconds: 2,
            });
        });
        expect(result.current.progress?.percent).toBe(65);

        await act(async () => {
            deferredRun.resolve(newDeep);
            await launchPromise;
        });

        expect(result.current.status).toBe('staged');
        expect(result.current.pendingReport).toEqual(newDeep);
        expect(result.current.hasPendingToApply).toBe(true);
        // Priorité d'affichage : pendingReport > appliedReport > quickPreviewReport
        expect(result.current.activeReport).toEqual(newDeep);
        // CRITICAL : l'ancien rapport appliqué et IndexedDB n'ont PAS été écrasés !
        expect(result.current.appliedReport).toEqual(priorSaved);
        expect(saveSpy).not.toHaveBeenCalled();

        // Test d'échec de sauvegarde : pendingReport reste intact pour ne pas perdre le calcul
        const deferredSaveFail = createDeferred<boolean>();
        saveSpy.mockImplementationOnce(() => deferredSaveFail.promise);

        let applyFailPromise!: Promise<boolean>;
        act(() => {
            applyFailPromise = result.current.applyPendingReport();
        });
        expect(result.current.isApplying).toBe(true);

        let failedResult = true;
        await act(async () => {
            deferredSaveFail.resolve(false);
            failedResult = await applyFailPromise;
        });
        expect(failedResult).toBe(false);
        expect(result.current.isApplying).toBe(false);
        expect(result.current.status).toBe('error');
        expect(result.current.pendingReport).toEqual(newDeep);
        expect(result.current.appliedReport).toEqual(priorSaved);

        // Puis application réussie : persiste dans IndexedDB et promeut pendingReport -> appliedReport
        saveSpy.mockResolvedValueOnce(true);
        let appliedOk = false;
        await act(async () => {
            appliedOk = await result.current.applyPendingReport();
        });
        expect(appliedOk).toBe(true);
        expect(saveSpy).toHaveBeenLastCalledWith(newDeep, { isTestMode: false, personaId: null });
        expect(result.current.status).toBe('idle');
        expect(result.current.pendingReport).toBeNull();
        expect(result.current.hasPendingToApply).toBe(false);
        expect(result.current.appliedReport).toEqual(newDeep);
        expect(result.current.activeReport).toEqual(newDeep);
        expect(result.current.isMemorized).toBe(true);
    });

    it('rejette pendingReport avec discardPendingReport et efface appliedReport avec clearAppliedReport', async () => {
        const priorSaved = makeReport({ inputsSig: 'df1:sig:65', isDeepRun: true, trajectoriesRun: 90_000 });
        const stagedReport = makeReport({
            inputsSig: 'df1:sig:65',
            createdAt: '2026-11-18T20:00:00.000Z',
            isDeepRun: true,
            trajectoriesRun: 100_000,
        });

        vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValue({
            status: 'ok',
            report: priorSaved,
        });
        const clearSpy = vi.spyOn(deepForecastStoreMod, 'clearAppliedDeepForecast').mockResolvedValue(true);
        mockRunDeepForecastAsync.mockResolvedValueOnce(stagedReport);

        const { result } = renderHook(() => useDeepForecast(makeParams(65), null));
        await waitFor(() => expect(result.current.isMemorized).toBe(true));

        await act(async () => {
            await result.current.launchDeepForecast();
        });
        expect(result.current.status).toBe('staged');
        expect(result.current.activeReport).toEqual(stagedReport);

        act(() => {
            result.current.discardPendingReport();
        });
        expect(result.current.status).toBe('idle');
        expect(result.current.pendingReport).toBeNull();
        expect(result.current.appliedReport).toEqual(priorSaved);
        expect(result.current.activeReport).toEqual(priorSaved);

        await act(async () => {
            await result.current.clearAppliedReport();
        });
        expect(clearSpy).toHaveBeenCalledWith({ isTestMode: false, personaId: null });
        expect(result.current.appliedReport).toBeNull();
        expect(result.current.isMemorized).toBe(false);
        expect(result.current.activeReport).toEqual(result.current.quickPreviewReport);
    });

    it('annule proprement via cancelDeepForecast (AbortController) et conserve appliedReport intact', async () => {
        const priorSaved = makeReport({ inputsSig: 'df1:sig:65', isDeepRun: true, trajectoriesRun: 90_000 });
        vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValue({
            status: 'ok',
            report: priorSaved,
        });

        let capturedSignal: AbortSignal | undefined;
        mockRunDeepForecastAsync.mockImplementationOnce(
            (_input, opts) =>
                new Promise((_, reject) => {
                    capturedSignal = opts?.signal;
                    opts?.signal?.addEventListener('abort', () => {
                        reject(new Error('__DEEP_FORECAST_CANCELLED__'));
                    });
                }),
        );

        const { result } = renderHook(() => useDeepForecast(makeParams(65), null));
        await waitFor(() => expect(result.current.isMemorized).toBe(true));

        let launchPromise!: Promise<void>;
        act(() => {
            launchPromise = result.current.launchDeepForecast();
        });
        expect(result.current.status).toBe('running');

        act(() => {
            result.current.cancelDeepForecast();
        });

        await act(async () => {
            await launchPromise;
        });

        expect(capturedSignal?.aborted).toBe(true);
        expect(result.current.status).toBe('cancelled');
        expect(result.current.progress).toBeNull();
        expect(result.current.pendingReport).toBeNull();
        expect(result.current.appliedReport).toEqual(priorSaved);
        expect(result.current.activeReport).toEqual(priorSaved);
    });

    it('bloque launchDeepForecast si entreesRefusees est non vide et journalise une erreur réelle du moteur', async () => {
        const badParams: SimulationParams = {
            ...makeParams(65),
            entreesRefusees: [
                { role: 'cause', chemin: 'config.users[0].netSalary', libelle: 'le salaire net', valeur: Number.NaN },
            ],
        };
        const { result: rRefus } = renderHook(() => useDeepForecast(badParams, null));
        await waitFor(() => expect(rRefus.current.status).toBe('idle'));
        expect(rRefus.current.refusMessage).toBeTruthy();

        await act(async () => {
            await rRefus.current.launchDeepForecast();
        });
        expect(mockRunDeepForecastAsync).not.toHaveBeenCalled();
        expect(rRefus.current.status).toBe('error');
        expect(rRefus.current.error).toBe(rRefus.current.refusMessage);

        // Échec runtime du moteur : passe en erreur et préserve l'appliedReport existant
        const priorSaved = makeReport({ inputsSig: 'df1:sig:65', isDeepRun: true });
        vi.spyOn(deepForecastStoreMod, 'loadAppliedDeepForecast').mockResolvedValueOnce({
            status: 'ok',
            report: priorSaved,
        });
        mockRunDeepForecastAsync.mockRejectedValueOnce(new Error('Crash worker simulation'));

        const { result: rErr } = renderHook(() => useDeepForecast(makeParams(65), null));
        await waitFor(() => expect(rErr.current.isMemorized).toBe(true));

        await act(async () => {
            await rErr.current.launchDeepForecast();
        });
        expect(rErr.current.status).toBe('error');
        expect(rErr.current.error).toContain('Crash worker simulation');
        expect(rErr.current.appliedReport).toEqual(priorSaved);
        expect(errorLoggerMod.logError).toHaveBeenCalled();
    });
});
