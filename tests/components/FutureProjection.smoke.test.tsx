// CA-04 — smoke test : FutureProjection (money-critical, ~1000 l, aucun test direct jusqu'ici).
// Sans projection révélée → écran d'amorçage « Calculer » (pas de crash).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../fixtures/testFixtures';
import type { ProjectionConfig, BudgetConfig, RetirementGoal, User } from '../../types';
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

const proj = {
    years: 30, returnRate: 6, inflationRate: 2, savingsMode: 'manual', manualContribution: 0,
    usePortfolioRate: false, returnRates: { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 },
    emergencyFundMonths: 6, salaryGrowth: 2, propertyGrowthRate: 3,
} as unknown as ProjectionConfig;
const config: BudgetConfig = {
    users: [
        { name: 'Marc', grossSalary: 7000, netSalary: 5000, color: '#10b981', age: 35, birthYear: 1991, canadaArrivalYear: 1991, hasOwnedPropertyLast4Years: false, celiContributed: 0, rrspContributed: 0 } as unknown as User,
        { name: 'Anna', grossSalary: 5500, netSalary: 4000, color: '#3b82f6', age: 33, birthYear: 1993, canadaArrivalYear: 1993, hasOwnedPropertyLast4Years: false, celiContributed: 0, rrspContributed: 0 } as unknown as User,
    ],
    splitMode: '50/50',
};
const retirementGoal = { targetAge: 65, targetMonthlyIncome: 5000, governmentPension: 1500 } as unknown as RetirementGoal;

describe('FutureProjection — smoke (CA-04)', () => {
    beforeEach(() => {
        localStorage.removeItem('future:hiddenSeries:v1');
    });

    afterEach(() => {
        act(() => {
            useFinanceStore.getState().setLastProjection(null);
        });
        localStorage.removeItem('future:hiddenSeries:v1');
        cleanup();
    });

    it('rend l\'écran d\'amorçage sans crash', () => {
        const { container } = render(
            <FutureProjection
                initialBalances={{}} transactions={[]} budgetItems={[]} config={config}
                realEstateGoals={[]} retirementGoal={retirementGoal} calculatedMonthlySavings={1000}
                projection={proj} setProjection={vi.fn()}
            />,
        );
        expect(container).toBeTruthy();
    });

    it('affiche le contrôle interactif Monte Carlo [P10, P90] en mode Courbe nette et bascule aria-pressed', () => {
        const persona = getPersonaOrDefault(DEFAULT_PERSONA_ID).build();
        const mockProjection: ProjectionResult = {
            chartData: [
                { monthIndex: 0, year: 2026, age: 35, dateLabel: '2026-11', NetWorth: 180_000, P10: 170_000, P50: 180_000, P90: 190_000 } as never,
                { monthIndex: 12, year: 2027, age: 36, dateLabel: '2027-11', NetWorth: 210_000, P10: 185_000, P50: 210_000, P90: 240_000 } as never,
            ],
            fireNumber: 650_000,
            allResults: [],
        };
        act(() => {
            useFinanceStore.getState().setLastProjection(mockProjection);
            useFinanceStore.getState().setProjectionStatus('idle');
        });

        render(
            <FutureProjection
                initialBalances={{}}
                transactions={persona.transactions ?? []}
                budgetItems={persona.budgetItems ?? []}
                config={persona.config ?? config}
                realEstateGoals={persona.realEstateGoals ?? []}
                retirementGoal={persona.retirementGoal ?? retirementGoal}
                calculatedMonthlySavings={1200}
                projection={persona.projection ?? proj}
                setProjection={vi.fn()}
            />,
        );

        const mcBtn = screen.getByTestId('futur-toggle-mc');
        expect(mcBtn).toHaveAttribute('aria-pressed', 'true');
        expect(mcBtn.textContent).toMatch(/Favorable.*Central.*Prudent/);

        fireEvent.click(mcBtn);
        expect(mcBtn).toHaveAttribute('aria-pressed', 'false');

        fireEvent.click(mcBtn);
        expect(mcBtn).toHaveAttribute('aria-pressed', 'true');
    });
});
