import { describe, it, expect } from 'vitest';
import { evaluateRealEstateDecision } from '../../services/realEstateDecider';
import type { Debt, RealEstateGoal } from '../../types';
import type { ProjectionResult, ProjectionChartPoint } from '../../services/projection/types';

function makeGoal(overrides: Partial<RealEstateGoal> = {}): RealEstateGoal {
    return {
        id: 'proj-1',
        name: 'Duplex Visé',
        isActive: true,
        purchaseDate: '2028-06-01',
        price: 500_000,
        downPayment: 100_000,
        mortgageRate: 4.5,
        amortization: 25,
        totalClosingCosts: 8_000,
        monthlyPayment: 0,
        unrecoverableMonthly: 0,
        isPrimaryResidence: true,
        municipality: 'reste_qc',
        taxesYearly: 3_600,
        heatingMonthly: 150,
        ...overrides,
    };
}

function makeProjection(cashAtMonth18: number): ProjectionResult {
    const chartData: ProjectionChartPoint[] = [
        {
            name: '2026',
            monthIndex: 0,
            year: 2026,
            age: 35,
            NetWorth: 90_000,
            Liquidites: 50_000,
            CELIAPP: 16_000,
            CELI: 24_000,
            REER: 0,
            NonReg: 0,
            Immobilier: 0,
            DettesNonImmo: 0,
        },
        {
            name: '2028',
            monthIndex: 18,
            year: 2028,
            age: 37,
            NetWorth: cashAtMonth18,
            Liquidites: Math.round(cashAtMonth18 * 0.5),
            CELIAPP: Math.round(cashAtMonth18 * 0.2),
            CELI: Math.round(cashAtMonth18 * 0.3),
            REER: 0,
            NonReg: 0,
            Immobilier: 0,
            DettesNonImmo: 0,
        },
    ];
    return {
        scenarioId: 'base',
        scenarioName: 'Base',
        chartData,
        finalNetWorth: cashAtMonth18,
        fireNumber: 1_000_000,
        fireAge: 60,
        estateNetWorth: cashAtMonth18,
        estateTax: 0,
        finalLiquidAssets: cashAtMonth18,
    };
}

describe('evaluateRealEstateDecision', () => {
    it('rend Feu vert quand la trésorerie projetée à la date couvre largement les coûts et B-20 passe', () => {
        const res = evaluateRealEstateDecision({
            goal: makeGoal(),
            lastProjection: makeProjection(150_000),
            debts: [],
            monthlyGrossIncome: 11_000,
            currentDateIso: '2026-11-26',
            retirementGoal: { targetMonthlyIncome: 4_500 },
        });
        expect(res.verdict).toBe('feu_vert');
        expect(res.projectedCashAtDate).toBe(150_000);
        expect(res.cashGapAtDate).toBeGreaterThan(25_000);
        expect(res.b20Passes).toBe(true);
        expect(res.schlPremium).toBe(0);
    });

    it('rend Risqué si les dettes non hypothécaires font échouer le TDS OSFI B-20', () => {
        const debts: Debt[] = [
            {
                id: 'd-auto',
                name: 'Prêt auto',
                balance: 28_000,
                interestRate: 6.5,
                minimumPayment: 1_650,
                category: 'Car',
                kind: 'auto',
            },
        ];
        const res = evaluateRealEstateDecision({
            goal: makeGoal(),
            lastProjection: makeProjection(140_000),
            debts,
            monthlyGrossIncome: 8_200,
            currentDateIso: '2026-11-26',
        });
        expect(res.otherDebtMonthly).toBe(1_650);
        expect(res.b20Passes).toBe(false);
        expect(res.b20TdsPct).toBeGreaterThan(44);
        expect(res.verdict).toBe('risque');
    });

    it('respecte no-fake-data (null) si aucune projection n’existe encore ou si le revenu brut manque', () => {
        const res = evaluateRealEstateDecision({
            goal: makeGoal(),
            lastProjection: null,
            debts: [],
            monthlyGrossIncome: null,
            currentDateIso: '2026-11-26',
        });
        expect(res.projectedCashAtDate).toBeNull();
        expect(res.cashGapAtDate).toBeNull();
        expect(res.b20GdsPct).toBeNull();
        expect(res.b20TdsPct).toBeNull();
        expect(res.b20Passes).toBeNull();
        expect(res.retirementAgeDeltaYears).toBeNull();
        expect(res.verdict).toBe('tendu');
    });
});
