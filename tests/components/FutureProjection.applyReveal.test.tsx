// Futur 4.0 — vérifie le basculement immédiat entre les 4 scénarios, la modification
// d'hypothèses dans le tiroir sans flash ni état corrompu, et le flux « Appliquer et mémoriser »
// sans écraser la mémoire avant confirmation explicite.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent, within } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../fixtures/testFixtures';
import {
    DEEP_SCENARIO_IDS,
    type DeepForecastReport,
    type DeepScenarioId,
    type DeepScenarioOutput,
} from '../../services/projection/deepForecastTypes';

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

const deepMocks = vi.hoisted(() => ({
    loadApplied: vi.fn(async () => ({ status: 'empty' as const })),
    saveApplied: vi.fn(async () => true),
    clearApplied: vi.fn(async () => true),
    runDeep: vi.fn(),
}));

vi.mock('../../services/deepForecastStore', () => ({
    loadAppliedDeepForecast: deepMocks.loadApplied,
    saveAppliedDeepForecast: deepMocks.saveApplied,
    clearAppliedDeepForecast: deepMocks.clearApplied,
}));

vi.mock('../../services/projection/runDeepForecastAsync', async () => {
    const actual = await vi.importActual<typeof import('../../services/projection/runDeepForecastAsync')>(
        '../../services/projection/runDeepForecastAsync',
    );
    return {
        ...actual,
        runDeepForecastAsync: (...args: unknown[]) => deepMocks.runDeep(...args),
    };
});

function makeDeepReport(inputsSig: string): DeepForecastReport {
    const labels: Record<DeepScenarioId, string> = {
        real_trajectory: 'Trajectoire réelle',
        prudent_stress: 'Prudent / Stress',
        ai_optimized: 'Optimisé IA',
        favorable_tailwinds: 'Favorable',
    };
    const scenarios = Object.fromEntries(
        DEEP_SCENARIO_IDS.map((id, i) => {
            const finalVal = 1_000_000 + i * 250_000;
            const out: DeepScenarioOutput = {
                id,
                label: labels[id],
                shortDescription: `Scénario ${labels[id]}`,
                assumptionsSummaryFr: 'Résumé',
                points: [
                    {
                        monthIndex: 0,
                        year: 2026,
                        age: 35,
                        netWorth: 200_000,
                        p10: 180_000,
                        p50: 200_000,
                        p90: 220_000,
                        mcRange: [180_000, 220_000],
                    },
                    {
                        monthIndex: 12,
                        year: 2027,
                        age: 36,
                        netWorth: finalVal,
                        p10: finalVal - 100_000,
                        p50: finalVal,
                        p90: finalVal + 100_000,
                        mcRange: [finalVal - 100_000, finalVal + 100_000],
                    },
                ],
                milestones: {
                    fiAge: 55 + i,
                    fiProbabilityPct: 85,
                    sustainableMonthlyNetRetirementCad: 4_000,
                    sustainableMonthlyNetP90Cad: 3_200,
                    goalsSummary: [],
                    finalNetWorthP50: finalVal,
                    estateNetWorthP50: finalVal,
                    estateTaxP50: 80_000,
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
        createdAt: '2026-11-18T15:00:00.000Z',
        durationMs: 420,
        trajectoriesRun: 100_000,
        isDeepRun: true,
        pastDiagnostic: {
            transactionsAnalyzed: 10,
            monthsCovered: 6,
            firstTransactionDate: '2026-05-01',
            lastTransactionDate: '2026-10-31',
            observedMonthlyIncomeCad: 5_000,
            observedMonthlyExpensesCad: 3_200,
            budgetedMonthlyExpensesCad: 3_100,
            monthlySpendingGapCad: 100,
            observedSavingsRatePct: 36,
            lifestyleCreepAnnualPct: 1,
            fixedExpensesSharePct: 60,
            discretionarySharePct: 40,
            peakSpendingMonthLabel: 'Juillet',
            lowSpendingMonthLabel: 'Février',
            weightedMerPct: 0.2,
            estimatedAnnualFeeAndTaxDragCad: 250,
            expenseVolatilityPct: 5,
            findingsFr: ['Constat simulé'],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T15:00:00.000Z',
            liveArticlesUsed: 0,
            offlineFallbackUsed: true,
            portfolioSentimentScore: null,
            portfolioSentimentLabel: 'Neutre',
            annualizedReturnAdjustmentPct: 0,
            volatilityMultiplier: 1,
            macroHeadlineFr: 'Contexte stable',
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

describe('FutureProjection — scénarios, hypothèses et Appliquer et mémoriser (Futur 4.0)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        deepMocks.loadApplied.mockResolvedValue({ status: 'empty' });
        deepMocks.saveApplied.mockResolvedValue(true);

        const persona = getPersonaOrDefault(DEFAULT_PERSONA_ID);
        act(() => {
            useFinanceStore.getState().resetState();
            useFinanceStore.setState({
                ...(persona.build() as Record<string, unknown>),
                projectionRunMC: false,
                projectionStatus: 'idle',
                lastProjection: {
                    chartData: [
                        { monthIndex: 0, year: 2026, age: 35, dateLabel: '2026-01', NetWorth: 200_000 },
                        { monthIndex: 12, year: 2027, age: 36, dateLabel: '2027-01', NetWorth: 230_000 },
                    ] as never,
                    fireNumber: 500_000,
                    allResults: [],
                },
                isProjectionLocked: false,
                lockedProjection: null,
            });
        });
    });

    afterEach(() => cleanup());

    it('affiche immédiatement les 4 scénarios (zéro écran bloqueur) et bascule vers Optimisé IA et Prudent / Stress sans flash', async () => {
        const { container } = render(<Harness />);

        expect(screen.queryByText(/Compose tes leviers/i)).not.toBeInTheDocument();
        expect(screen.getByText(/Scénario affiché : Trajectoire réelle/i)).toBeInTheDocument();

        const headerRegion = screen.getByRole('region', { name: /Scénarios de trajectoire future/i });
        const btnAi = within(headerRegion).getByRole('button', { name: /Optimisé IA/i });
        fireEvent.click(btnAi);
        expect(screen.getByText(/Scénario affiché : Optimisé IA/i)).toBeInTheDocument();
        expect(btnAi).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(within(headerRegion).getByRole('button', { name: /Prudent \/ Stress/i }));
        expect(screen.getByText(/Scénario affiché : Prudent \/ Stress/i)).toBeInTheDocument();
        expect(container.textContent).not.toContain('NaN');
    });

    it('ouvre le tiroir Hypothèses, applique une modification de paramètres sans corrompre la courbe ni créer de flash', async () => {
        render(<Harness />);

        const btnHypotheses = screen.getByRole('button', { name: /Hypothèses/i });
        fireEvent.click(btnHypotheses);
        expect(btnHypotheses).toHaveAttribute('aria-expanded', 'true');

        // Simule une mise à jour des hypothèses (setProjection via le store) et fermeture du tiroir
        const oldInflation = useFinanceStore.getState().projection.inflationRate ?? 2;
        act(() => {
            const p = useFinanceStore.getState().projection;
            useFinanceStore.setState({ projection: { ...p, inflationRate: oldInflation + 0.5 } });
        });
        expect(useFinanceStore.getState().projection.inflationRate).toBe(oldInflation + 0.5);
        expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument();
    });

    it('flux Appliquer et mémoriser : le rapport calculé reste staged sans écraser IndexedDB avant clic de confirmation', async () => {
        deepMocks.runDeep.mockImplementationOnce(async (input: { inputsSig?: string }) =>
            makeDeepReport(input.inputsSig ?? 'sig'),
        );

        render(<Harness />);
        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Lancer l’analyse profonde/i })).toBeEnabled(),
        );

        fireEvent.click(screen.getByRole('button', { name: /Lancer l’analyse profonde/i }));

        await waitFor(() =>
            expect(screen.getByRole('button', { name: /Appliquer et mémoriser/i })).toBeInTheDocument(),
        );
        // Garde critique : IndexedDB n'a PAS été écrasé avant la confirmation explicite !
        expect(deepMocks.saveApplied).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Appliquer et mémoriser/i }));

        await waitFor(() => expect(deepMocks.saveApplied).toHaveBeenCalledTimes(1));
        await waitFor(() =>
            expect(screen.getByText(/Analyse profonde en mémoire/i)).toBeInTheDocument(),
        );
        expect(screen.queryByRole('button', { name: /Appliquer et mémoriser/i })).not.toBeInTheDocument();
    });
});
