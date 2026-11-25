// [PROJECTION-PERSIST] Futur 4.0 :
//   1. Affichage immédiat dès qu'un résultat `lastProjection` est présent (zéro écran bloqueur).
//   2. [no-fake-data] Lorsque `results === null`, état honnête de rechargement (`curveRestoring`),
//      jamais de KPI fictif à 0 $.
//   3. Mémoire chiffrée IndexedDB (`deepForecastStore`) + badge `isOutdated` lorsque les paramètres
//      changent + isolation stricte entre dossier réel et mode test (persona).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, renderHook, screen, act, cleanup, waitFor } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../fixtures/testFixtures';
import { computeDeepForecastInputsSig } from '../../services/projection/runDeepForecastAsync';
import { useSimulationParams } from '../../hooks/useSimulationParams';
import {
    DEEP_SCENARIO_IDS,
    type DeepForecastReport,
    type DeepScenarioId,
    type DeepScenarioOutput,
} from '../../services/projection/deepForecastTypes';
import type { ProjectionResult } from '../../services/projection/types';

vi.mock('recharts', async () => {
    const React = await import('react');
    const P = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
    return {
        ResponsiveContainer: P, PieChart: P, BarChart: P, LineChart: P, AreaChart: P, ComposedChart: P,
        Pie: () => null, Bar: () => null, Area: () => null, Line: () => null, Cell: () => null,
        Legend: () => null, ReferenceLine: () => null, ReferenceArea: () => null, ReferenceDot: () => null,
        XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
    };
});
vi.mock('../../services/errorLogger', () => ({ logError: vi.fn(), logErrorThrottled: vi.fn(), onLogEntry: vi.fn(() => () => {}), __resetErrorThrottle: vi.fn(), }));

const idbMocks = vi.hoisted(() => ({
    loadApplied: vi.fn(),
    saveApplied: vi.fn(async () => true),
    clearApplied: vi.fn(async () => true),
}));

vi.mock('../../services/deepForecastStore', () => ({
    loadAppliedDeepForecast: idbMocks.loadApplied,
    saveAppliedDeepForecast: idbMocks.saveApplied,
    clearAppliedDeepForecast: idbMocks.clearApplied,
}));

const RESULT_A: ProjectionResult = {
    chartData: [
        { monthIndex: 0, year: 2026, age: 35, dateLabel: '2026-01', NetWorth: 210_000 } as never,
    ],
    fireNumber: 500_000,
    allResults: [
        { chartData: [], fireNumber: 500_000, allResults: [], strategyName: 'STRAT-A' } as unknown as ProjectionResult,
    ],
};

function makeSavedDeepReport(inputsSig: string, trajectoriesRun = 100_000): DeepForecastReport {
    const scenarios = Object.fromEntries(
        DEEP_SCENARIO_IDS.map((id) => {
            const out: DeepScenarioOutput = {
                id: id as DeepScenarioId,
                label: id === 'real_trajectory' ? 'Trajectoire réelle' : id,
                shortDescription: 'Rapport restauré',
                assumptionsSummaryFr: 'Résumé',
                points: [{ monthIndex: 0, year: 2026, age: 35, netWorth: 210_000, p10: 190_000, p50: 210_000, p90: 230_000, mcRange: [190_000, 230_000] }],
                milestones: {
                    fiAge: 58,
                    fiProbabilityPct: 84,
                    sustainableMonthlyNetRetirementCad: 4_100,
                    sustainableMonthlyNetP90Cad: 3_300,
                    goalsSummary: [],
                    finalNetWorthP50: 1_400_000,
                    estateNetWorthP50: 1_250_000,
                    estateTaxP50: 150_000,
                    ruinProbabilityPct: 3,
                },
                turningPoints: [],
                appliedOptimizationsFr: [],
            };
            return [id, out];
        }),
    ) as Record<DeepScenarioId, DeepScenarioOutput>;

    return {
        version: 1,
        inputsSig,
        createdAt: '2026-11-18T10:00:00.000Z',
        durationMs: 1_500,
        trajectoriesRun,
        isDeepRun: true,
        pastDiagnostic: {
            transactionsAnalyzed: 0,
            monthsCovered: 0,
            firstTransactionDate: null,
            lastTransactionDate: null,
            observedMonthlyIncomeCad: null,
            observedMonthlyExpensesCad: null,
            budgetedMonthlyExpensesCad: null,
            monthlySpendingGapCad: null,
            observedSavingsRatePct: null,
            lifestyleCreepAnnualPct: null,
            fixedExpensesSharePct: null,
            discretionarySharePct: null,
            peakSpendingMonthLabel: null,
            lowSpendingMonthLabel: null,
            weightedMerPct: null,
            estimatedAnnualFeeAndTaxDragCad: null,
            expenseVolatilityPct: null,
            findingsFr: [],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T10:00:00.000Z',
            liveArticlesUsed: 0,
            offlineFallbackUsed: true,
            portfolioSentimentScore: null,
            portfolioSentimentLabel: 'Neutre',
            annualizedReturnAdjustmentPct: 0,
            volatilityMultiplier: 1,
            macroHeadlineFr: 'Neutre',
            keySignals: [],
            aiSynthesisFr: null,
            usedGemini: false,
        },
        valoriaSummary: null,
        scenarios,
        concreteActions: [],
    };
}

function Harness() {
    const projection = useFinanceStore((s) => s.projection);
    const config = useFinanceStore((s) => s.config);
    const retirementGoal = useFinanceStore((s) => s.retirementGoal);
    const realEstateGoals = useFinanceStore((s) => s.realEstateGoals ?? []);
    const transactions = useFinanceStore((s) => s.transactions ?? []);
    const budgetItems = useFinanceStore((s) => s.budgetItems ?? []);
    const initialBalances = useFinanceStore((s) => s.initialBalances ?? {});
    return (
        <FutureProjection
            initialBalances={initialBalances}
            transactions={transactions}
            budgetItems={budgetItems}
            config={config}
            realEstateGoals={realEstateGoals}
            retirementGoal={retirementGoal}
            setRetirementGoal={(g) => act(() => { useFinanceStore.setState({ retirementGoal: g }); })}
            calculatedMonthlySavings={2000}
            projection={projection}
            setProjection={(p) => act(() => { useFinanceStore.setState({ projection: p }); })}
        />
    );
}

describe('FutureProjection — affichage immédiat, mémoire chiffrée IDB et isolation mode test (PROJECTION-PERSIST)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        idbMocks.loadApplied.mockResolvedValue({ status: 'empty' });
        const data = getPersonaOrDefault(DEFAULT_PERSONA_ID).build();
        act(() => {
            useFinanceStore.setState({
                ...data,
                projectionRunMC: false,
                lastProjection: RESULT_A,
                projectionStatus: 'idle',
                isProjectionLocked: false,
                lockedProjection: null,
            });
        });
    });

    afterEach(() => cleanup());

    it('affiche immédiatement la courbe et les 4 scénarios quand lastProjection est présent (plus d’écran bloqueur)', async () => {
        render(<Harness />);
        expect(screen.queryByText(/Compose tes leviers/i)).not.toBeInTheDocument();
        expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Trajectoire réelle/i })).toBeInTheDocument();
        await waitFor(() => expect(idbMocks.loadApplied).toHaveBeenCalledWith({ isTestMode: false, personaId: null }));
    });

    it('[no-fake-data] lorsque lastProjection === null → « Ta projection se recharge… », JAMAIS de KPIs fictifs à 0 $', async () => {
        act(() => {
            useFinanceStore.setState({ lastProjection: null });
        });
        render(<Harness />);

        expect(screen.getByText(/Ta projection se recharge/i)).toBeInTheDocument();
        expect(screen.queryByText(/Objectif FIRE/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/Compose tes leviers/i)).not.toBeInTheDocument();

        act(() => {
            useFinanceStore.setState({ lastProjection: RESULT_A });
        });
        await waitFor(() => expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument());
        expect(screen.queryByText(/se recharge/i)).not.toBeInTheDocument();
    });

    it('restaure le badge « Analyse profonde en mémoire » depuis IndexedDB et signale isOutdated si les paramètres changent', async () => {
        const state = useFinanceStore.getState();
        const { result: simHook, unmount: unmountHook } = renderHook(() => useSimulationParams(2000));
        const sig = computeDeepForecastInputsSig({
            params: simHook.current.params,
            transactions: state.transactions,
            assets: state.assets,
            valoriaRiskProfile: state.valoriaRiskProfile,
        });
        unmountHook();
        idbMocks.loadApplied.mockResolvedValue({
            status: 'ok',
            report: makeSavedDeepReport(sig, 100_000),
        });

        render(<Harness />);
        await waitFor(() => expect(screen.getByText(/Analyse profonde en mémoire/i)).toBeInTheDocument());
        expect(screen.queryByText(/Données modifiées/i)).not.toBeInTheDocument();

        // Changement d'un paramètre -> isOutdated passe à vrai tout en conservant le rapport restauré
        act(() => {
            const p = useFinanceStore.getState().projection;
            useFinanceStore.setState({
                projection: { ...p, inflationRate: (p.inflationRate ?? 2) + 1 },
            });
        });

        await waitFor(() =>
            expect(screen.getByText(/Données modifiées — tu peux relancer quand tu veux/i)).toBeInTheDocument(),
        );
        expect(screen.getByText(/Analyse profonde en mémoire/i)).toBeInTheDocument();
    });

    it('[a11y] montage déjà-visible → le focus n’est PAS volé ; transition rechargement → visible place le focus sur la courbe', async () => {
        render(<Harness />);
        const region = screen.getByRole('region', { name: /Projection affichée/i });
        expect(document.activeElement).not.toBe(region);
        cleanup();

        act(() => {
            useFinanceStore.setState({ lastProjection: null });
        });
        render(<Harness />);
        expect(screen.getByText(/Ta projection se recharge/i)).toBeInTheDocument();

        act(() => {
            useFinanceStore.setState({ lastProjection: RESULT_A });
        });
        await waitFor(() =>
            expect(document.activeElement).toBe(screen.getByRole('region', { name: /Projection affichée/i })),
        );
    });
});
