// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FutureSimulationControls } from '../../../components/future/FutureSimulationControls';
import { FutureYearAnatomyModal } from '../../../components/future/FutureYearAnatomyModal';
import { FuturePrescriptiveAdvisorCard } from '../../../components/future/FuturePrescriptiveAdvisorCard';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { ProjectionConfig, RetirementGoal, Asset } from '../../../types';
import type { ProjectionChartPoint, SimulationParams } from '../../../services/projection/types';

function baseProjection(): ProjectionConfig {
    return {
        years: 25,
        returnRate: 6.5,
        inflationRate: 2.0,
        savingsMode: 'budget',
        manualContribution: 0,
        usePortfolioRate: false,
        returnRates: { celi: 6.5, reer: 6.5, nonReg: 6.5, crypto: 8.0, cash: 2.5 },
        manualREERRoom: 25000,
    };
}

function baseRetirement(): RetirementGoal {
    return {
        targetAge: 62,
        lifeExpectancy: 92,
        targetMonthlyIncome: 4000,
        governmentPension: 1800,
    };
}

describe('Lot 6 — Composants UI Futur 2.0 (F22, F23, F24)', () => {
    beforeEach(() => {
        useFinanceStore.setState({ isPrivacyMode: false });
    });

    it('FutureSimulationControls bascule les 3 modes (dépenses, rendements, puissance MC) et ouvre Anatomie', () => {
        const onUpdate = vi.fn();
        const setRunMC = vi.fn();
        const onOpenAnatomy = vi.fn();
        const proj = baseProjection();

        render(
            <FutureSimulationControls
                projection={proj}
                runMC={false}
                setRunMC={setRunMC}
                onUpdateProjection={onUpdate}
                onOpenYearAnatomy={onOpenAnatomy}
                selectedYear={2028}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Comportement réel' }));
        expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ expenseProjectionMode: 'real' }));

        fireEvent.click(screen.getByRole('button', { name: 'Normes IQPF 2026' }));
        expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ returnAssumptionsMode: 'iqpf' }));

        const mcSelect = screen.getByRole('combobox', { name: /Puissance Monte Carlo/i });
        fireEvent.change(mcSelect, { target: { value: 'deep_search' } });
        expect(setRunMC).toHaveBeenCalledWith(true);
        expect(onUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ mcPowerTier: 'deep_search', monteCarloIterations: 10000 }),
        );

        fireEvent.change(mcSelect, { target: { value: 'off' } });
        expect(setRunMC).toHaveBeenCalledWith(false);

        fireEvent.click(screen.getByRole('button', { name: /Anatomie d'une année/i }));
        expect(onOpenAnatomy).toHaveBeenCalledTimes(1);
    });

    it('FutureYearAnatomyModal agrège les 4 panneaux, respecte No-Fake-Data (—) et masque les montants en mode discret', () => {
        const onClose = vi.fn();
        const points: ProjectionChartPoint[] = Array.from({ length: 12 }, (_, m) => ({
            monthIndex: m,
            year: 2027,
            age: 40 + m / 12,
            NetWorth: 250000 + m * 1000,
            realNetWorth: 245000 + m * 950,
            Liquidites: 15000,
            CELI: 80000,
            CELIMax: 95000,
            REER: 140000,
            REERMax: 180000,
            NonReg: 15000,
            IncomeMarc: 6000,
            Income: 6000,
            Expenses: 3800,
            Savings: 2200,
        } as ProjectionChartPoint));

        const { rerender } = render(
            <FutureYearAnatomyModal
                isOpen={true}
                onClose={onClose}
                chartData={points}
                initialYear={2027}
                userName1="Alex"
            />,
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(screen.getByText(/1\. Revenus & Rentes/i)).toBeTruthy();
        expect(screen.getByText(/2\. Impôts & Cotisations/i)).toBeTruthy();
        expect(screen.getByText(/3\. Dépenses & Famille/i)).toBeTruthy();
        expect(screen.getByText(/4\. Bilan & Portefeuille/i)).toBeTruthy();
        // Champ absent (ex: Revenus locatifs nets) -> tiret cadratin, pas un faux 0 $
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);

        useFinanceStore.setState({ isPrivacyMode: true });
        rerender(
            <FutureYearAnatomyModal
                isOpen={true}
                onClose={onClose}
                chartData={points}
                initialYear={2027}
                userName1="Alex"
            />,
        );
        expect(dialog.textContent).not.toContain('72 000');

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('FuturePrescriptiveAdvisorCard affiche les actions chiffrées par impact et permet de simuler un levier', () => {
        const onApplyLever = vi.fn();
        const proj = baseProjection();
        const ret = baseRetirement();
        const params: SimulationParams = {
            projection: proj,
            calculatedStartingCash: 10000,
            liveCSVBalances: { CELI: 70000, CELIAPP: 0, REER: 200000, NON_ENREG: 30000, CRYPTO: 0, REEE: 0 },
            realEstateGoals: [],
            debts: [{ id: 'd1', name: 'Carte', balance: 6000, interestRate: 19.9, minimumPayment: 200, category: 'CreditCard' }],
            childGoals: [],
            travelGoals: [],
            lifeEvents: [],
            retirementGoal: ret,
            config: {
                users: [
                    { name: 'Alex', netSalary: 6500, grossSalary: 11250, color: '#3b82f6', age: 39 },
                    { name: 'Sam', netSalary: 0, grossSalary: 0, color: '#10b981', age: 39 },
                ],
                splitMode: '50/50',
            },
            baseGrossAnnual: 135000,
            baseNetAnnual: 78000,
            currentRentExpense: 1600,
            baseMonthlyExpenses: 4000,
            startYear: 2026,
            startMonth: 0,
        };
        const assets: Asset[] = [
            {
                symbol: 'VOO',
                name: 'S&P 500 ETF',
                accountType: 'CELI',
                quantity: 100,
                currentPrice: 500,
                currency: 'USD',
                performance: 0,
                dateBought: '2024-02-01',
            },
        ];

        render(
            <FuturePrescriptiveAdvisorCard
                params={params}
                assets={assets}
                fxRates={{ USD: 1.38 }}
                projection={proj}
                retirementGoal={ret}
                onApplyLever={onApplyLever}
            />,
        );

        expect(screen.getByText(/Plan d'action prescriptif chiffré/i)).toBeTruthy();
        const simButtons = screen.getAllByRole('button', { name: /Simuler ce levier/i });
        expect(simButtons.length).toBeGreaterThan(0);
        fireEvent.click(simButtons[0]);
        expect(onApplyLever).toHaveBeenCalledTimes(1);
    });
});
