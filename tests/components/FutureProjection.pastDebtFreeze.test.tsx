// [FUTUR-PAST-DEBT-FREEZE] Le segment PASSÉ reste exact :
//   1. `currentDebtNonImmo` est lu sur `liveResults` (DettesNonImmo LIVE), jamais sur une courbe verrouillée.
//   2. [PASSE-REEL-DETTE-1] Une dette dont `startDate` est postérieure à un mois passé n'est PAS
//      soustraite de ce mois (pas de dette inventée avant sa date de début).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup, waitFor, within } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../../services/testFixtures';
import type { ProjectionResult, ProjectionChartPoint } from '../../services/projection/types';
import type { Transaction } from '../../types';

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
const logErrorMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/errorLogger', () => ({ logError: logErrorMock, logErrorThrottled: vi.fn() }));
vi.mock('../../services/deepForecastStore', () => ({
    loadAppliedDeepForecast: vi.fn(async () => ({ status: 'empty' as const })),
    saveAppliedDeepForecast: vi.fn(async () => true),
    clearAppliedDeepForecast: vi.fn(async () => true),
}));

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

function pastTransaction(): Transaction {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
    return { id: 1, date: iso, payee: 'Dépôt initial', amount: 200_000, category: 'Revenus divers', status: 'processed' };
}

function resultWithDebt(strategyName: string, debtNonImmo: number, netWorth?: number): ProjectionResult {
    const chartData = [
        {
            monthIndex: 0,
            DettesNonImmo: debtNonImmo,
            ...(netWorth === undefined ? {} : { NetWorth: netWorth }),
        } as unknown as ProjectionChartPoint,
    ];
    return {
        chartData,
        fireNumber: 500_000,
        allResults: [{ chartData, fireNumber: 500_000, allResults: [], strategyName } as unknown as ProjectionResult],
    };
}

describe('FutureProjection — segment PASSÉ reste réel et suit DettesNonImmo LIVE (FUTUR-PAST-DEBT-FREEZE)', () => {
    beforeEach(() => {
        logErrorMock.mockClear();
        const data = getPersonaOrDefault(DEFAULT_PERSONA_ID).build();
        act(() => {
            useFinanceStore.setState({
                ...data,
                assets: [], realEstateGoals: [], transactions: [pastTransaction()], debts: [],
                isTestMode: false, activeTestPersonaId: null, realDataSnapshot: null,
                projectionRunMC: false, lastProjection: resultWithDebt('STRAT-A', 0), projectionStatus: 'idle',
                isProjectionLocked: false, lockedProjection: null,
            });
        });
    });
    afterEach(() => cleanup());

    it('courbe verrouillée présente + dette LIVE augmentée → le NetWorth du passé BAISSE, jamais figé à la courbe verrouillée', async () => {
        act(() => {
            useFinanceStore.setState({
                isProjectionLocked: true,
                lockedProjection: resultWithDebt('STRAT-LOCKED', 0, 200_000),
            });
        });
        render(<Harness />);
        await waitFor(() => expect(screen.getByText(/Courbe verrouillée/i)).toBeInTheDocument());

        const netWorthCell = () => {
            const table = document.querySelector('table.sr-only') as HTMLTableElement;
            const firstDataRow = within(table).getAllByRole('row')[1];
            return within(firstDataRow).getAllByRole('rowheader').concat(within(firstDataRow).getAllByRole('cell'));
        };
        const netWorthBefore = netWorthCell()[1].textContent;
        expect(netWorthBefore).toBeTruthy();
        expect(netWorthBefore).not.toMatch(/^—$/);

        // La dette LIVE augmente de 10 M$ tandis que lockedProjection reste à 0.
        act(() => {
            useFinanceStore.setState({
                lastProjection: resultWithDebt('STRAT-B', 10_000_000),
            });
        });

        expect(screen.getByText(/Courbe verrouillée/i)).toBeInTheDocument();
        const netWorthAfter = netWorthCell()[1].textContent;
        expect(netWorthAfter).not.toBe(netWorthBefore);
        expect(netWorthAfter).toMatch(/-\s?\d/);
    });

    it('[PASSE-REEL-DETTE-1] une dette PAS ENCORE COMMENCÉE au mois du 1er point passé n\'est PAS soustraite, malgré un total « aujourd\'hui » qui l\'inclut', async () => {
        const now = new Date();
        const debutApres = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const isoDebutApres = `${debutApres.getFullYear()}-${String(debutApres.getMonth() + 1).padStart(2, '0')}-01`;
        const debutAvant = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        const isoDebutAvant = `${debutAvant.getFullYear()}-${String(debutAvant.getMonth() + 1).padStart(2, '0')}-01`;
        const dateLabelMoins2 = (() => {
            const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();

        act(() => {
            useFinanceStore.setState({
                debts: [{ id: 'd1', name: 'Prêt récent', balance: 30_000, interestRate: 0, minimumPayment: 0, category: 'Other', startDate: isoDebutApres }],
                lastProjection: resultWithDebt('STRAT-GATING', 30_000),
            });
        });
        render(<Harness />);
        await waitFor(() => expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument());

        const rowCellsOf = (dateLabel: string) => {
            const table = document.querySelector('table.sr-only') as HTMLTableElement;
            const header = within(table).getByRole('rowheader', { name: dateLabel });
            const row = header.closest('tr') as HTMLElement;
            const cells = within(row).getAllByRole('rowheader').concat(within(row).getAllByRole('cell'));
            return {
                netWorth: cells[1].textContent,
                dettes: cells[14].textContent,
            };
        };

        const avantDebut = rowCellsOf(dateLabelMoins2);
        expect(avantDebut.netWorth).not.toMatch(/-\s?\d/);
        expect(avantDebut.dettes).toMatch(/^0\s?\$$/);

        // Discriminant : si la même dette avait déjà commencé avant le 1er point passé,
        // le mois -2 inclurait ces 30 000 $ de dette et son NetWorth serait 30 000 $ plus bas.
        act(() => {
            useFinanceStore.setState({
                debts: [{ id: 'd1', name: 'Prêt récent', balance: 30_000, interestRate: 0, minimumPayment: 0, category: 'Other', startDate: isoDebutAvant }],
            });
        });

        const apresDebut = rowCellsOf(dateLabelMoins2);
        expect(apresDebut.netWorth).not.toBe(avantDebut.netWorth);
        expect(apresDebut.dettes).toContain('30');
    });

    it('DettesNonImmo non fini (NaN) journalise l’anomalie sans émettre NaN dans la table passée', async () => {
        act(() => {
            useFinanceStore.setState({
                lastProjection: resultWithDebt('STRAT-NAN', Number.NaN),
            });
        });
        render(<Harness />);
        await waitFor(() => expect(logErrorMock).toHaveBeenCalled());

        const table = document.querySelector('table.sr-only') as HTMLTableElement;
        expect(table.textContent).not.toContain('NaN');
    });
});
