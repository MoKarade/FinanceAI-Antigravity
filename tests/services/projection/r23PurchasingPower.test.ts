import { describe, it, expect } from 'vitest';
import {
    __runScenarioForTests as runScenario,
    runGrandCalculShard,
    mergeGrandCalculShards,
    computeGrandCalculDeterministicBaseline,
    type SimulationParams,
} from '../../../services/projection';
import type { ProjectionConfig, BudgetConfig, RetirementGoal } from '../../../types';

const makeRetParams = (overrides: {
    age?: number;
    targetAge?: number;
    years?: number;
    lifeExpectancy?: number;
    celi?: number;
    reer?: number;
    nonReg?: number;
    cash?: number;
    targetMonthlyIncome?: number;
    govPension?: number;
    useStochasticMortality?: boolean;
    returnRate?: number;
} = {}): SimulationParams => {
    const r = overrides.returnRate ?? 6.0;
    const projection: ProjectionConfig = {
        years: overrides.years ?? 25,
        returnRate: r,
        inflationRate: 2.0,
        savingsMode: 'manual',
        manualContribution: 0,
        usePortfolioRate: false,
        returnRates: { celi: r, reer: r, nonReg: r, crypto: 0, cash: 2 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.0,
        propertyGrowthRate: 3,
        useStochasticMortality: overrides.useStochasticMortality ?? false,
    };
    const age = overrides.age ?? 65;
    const config: BudgetConfig = {
        users: [
            {
                name: 'RetraiteTest',
                grossSalary: age < (overrides.targetAge ?? 65) ? 6000 : 0,
                netSalary: age < (overrides.targetAge ?? 65) ? 4200 : 0,
                color: '#10b981',
                age,
                birthYear: 2026 - age,
                canadaArrivalYear: 1985,
                hasOwnedPropertyLast4Years: true,
                celiContributed: 0,
                rrspContributed: 0,
            },
        ],
        splitMode: '50/50',
    } as unknown as BudgetConfig;
    const retirementGoal: RetirementGoal = {
        targetAge: overrides.targetAge ?? 65,
        targetMonthlyIncome: overrides.targetMonthlyIncome ?? 4500,
        governmentPension: overrides.govPension ?? 1400,
        lifeExpectancy: overrides.lifeExpectancy ?? 90,
    };
    return {
        projection,
        calculatedStartingCash: overrides.cash ?? 20_000,
        liveCSVBalances: {
            CELI: overrides.celi ?? 300_000,
            CELIAPP: 0,
            REER: overrides.reer ?? 400_000,
            NON_ENREG: overrides.nonReg ?? 100_000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal,
        config,
        baseGrossAnnual: age < (overrides.targetAge ?? 65) ? 72_000 : 0,
        baseNetAnnual: age < (overrides.targetAge ?? 65) ? 50_400 : 0,
        currentRentExpense: 1600,
        baseMonthlyExpenses: 3500,
        startYear: 2026,
        startMonth: 0,
        financialGoals: [],
    };
};

describe('R2.3 — Pouvoir d’achat réel mensuel net garanti (P95 / P90 / P50)', () => {
    it('garantit la polarité P95 <= P90 <= P50 en mode Grand Calcul sur une cohorte avec retraite', () => {
        const params = makeRetParams({ age: 55, targetAge: 65, years: 30 });
        const shard = runGrandCalculShard(
            params,
            { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: true, seed: 21 },
            0,
            80,
        );
        const baseline = computeGrandCalculDeterministicBaseline(params);
        const merged = mergeGrandCalculShards([shard], {
            paramsSig: 'r23-polarity',
            durationMs: 10,
            regimesEnabled: true,
            historicalCrisesEnabled: true,
            startYear: params.startYear,
            currentAge: 55,
            ...baseline,
        });

        const gp = merged.guaranteedPurchasingPower;
        expect(gp.retirementMonthsEvaluated).toBeGreaterThan(0);
        expect(gp.p95SecurityMonthlyNetReal).not.toBeNull();
        expect(gp.p90SecurityMonthlyNetReal).not.toBeNull();
        expect(gp.p50SecurityMonthlyNetReal).not.toBeNull();
        expect(gp.p95SecurityMonthlyNetReal!).toBeGreaterThan(0);
        expect(gp.p95SecurityMonthlyNetReal!).toBeLessThanOrEqual(gp.p90SecurityMonthlyNetReal!);
        expect(gp.p90SecurityMonthlyNetReal!).toBeLessThanOrEqual(gp.p50SecurityMonthlyNetReal!);
    });

    it('retourne null (no-fake-data) si aucun mois de retraite n’est atteint dans l’horizon', () => {
        const params = makeRetParams({ age: 30, targetAge: 65, years: 20 });
        const det = runScenario(params, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(det.retirementMonthsEvaluated).toBe(0);
        expect(det.sustainableMonthlyNetReal).toBeNull();

        const shard = runGrandCalculShard(
            params,
            { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false },
            0,
            20,
        );
        const merged = mergeGrandCalculShards([shard], {
            paramsSig: 'r23-preret',
            durationMs: 5,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: params.startYear,
            currentAge: 30,
        });
        expect(merged.guaranteedPurchasingPower).toEqual({
            p95SecurityMonthlyNetReal: null,
            p90SecurityMonthlyNetReal: null,
            p50SecurityMonthlyNetReal: null,
            retirementMonthsEvaluated: 0,
        });
    });

    it('reste borné en scénario d’insolvabilité (ruine) sans gonflement par liquidDebt', () => {
        const ruinParams = makeRetParams({
            age: 65,
            targetAge: 65,
            years: 25,
            celi: 0,
            reer: 0,
            nonReg: 0,
            cash: 5_000,
            targetMonthlyIncome: 8_000,
            govPension: 1_200,
            returnRate: 0,
        });
        const res = runScenario(ruinParams, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(res.retirementMonthsEvaluated).toBeGreaterThan(0);
        expect(res.sustainableMonthlyNetReal).not.toBeNull();
        expect(res.sustainableMonthlyNetReal!).toBeLessThan(ruinParams.retirementGoal.targetMonthlyIncome);
        expect(res.sustainableMonthlyNetReal!).toBeGreaterThanOrEqual(0);
    });

    it('amortit le surplus sur plannedRetMonths en cas de décès précoce (pas de division par 1–2 ans)', () => {
        const earlyDeathParams = makeRetParams({
            age: 88,
            targetAge: 65,
            years: 10,
            lifeExpectancy: 98,
            celi: 1_000_000,
            reer: 0,
            nonReg: 0,
            cash: 50_000,
            useStochasticMortality: true,
            returnRate: 4,
        });
        // Cherche une itération avec décès précoce (< 10 ans)
        let foundEarly = false;
        for (let k = 0; k < 25; k++) {
            const res = runScenario(earlyDeathParams, 'AUTO_MARGINAL', true, false, k, 'BASE', {});
            if ((res.projectedDeathAge ?? 98) < 95 && res.retirementMonthsEvaluated > 0) {
                foundEarly = true;
                // 1M$ amorti sur >= plannedRetMonths (au moins 120 mois), donc < 15 000 $/mois (jamais 80k$/mois)
                expect(res.sustainableMonthlyNetReal).not.toBeNull();
                expect(res.sustainableMonthlyNetReal!).toBeLessThan(15_000);
                break;
            }
        }
        expect(foundEarly).toBe(true);
    });

    it('reflète la charge fiscale ARC/RQ : CELI > REER à solde brut identique', () => {
        const celiOnly = makeRetParams({
            age: 65,
            targetAge: 65,
            years: 25,
            celi: 800_000,
            reer: 0,
            nonReg: 0,
            cash: 20_000,
            targetMonthlyIncome: 4_500,
        });
        const reerOnly = makeRetParams({
            age: 65,
            targetAge: 65,
            years: 25,
            celi: 0,
            reer: 800_000,
            nonReg: 0,
            cash: 20_000,
            targetMonthlyIncome: 4_500,
        });

        const resCeli = runScenario(celiOnly, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        const resReer = runScenario(reerOnly, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(resCeli.sustainableMonthlyNetReal).not.toBeNull();
        expect(resReer.sustainableMonthlyNetReal).not.toBeNull();
        expect(resCeli.sustainableMonthlyNetReal!).toBeGreaterThan(resReer.sustainableMonthlyNetReal!);
    });

    it('protège retFundedRealSum si retirementGoal.targetMonthlyIncome est NaN ou undefined', () => {
        const nanTargetParams = makeRetParams({ age: 65, targetAge: 65, years: 20 });
        nanTargetParams.retirementGoal.targetMonthlyIncome = Number.NaN;
        const resNan = runScenario(nanTargetParams, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(resNan.retirementMonthsEvaluated).toBeGreaterThan(0);
        expect(resNan.sustainableMonthlyNetReal).not.toBeNull();
        expect(Number.isFinite(resNan.sustainableMonthlyNetReal!)).toBe(true);

        const undefTargetParams = makeRetParams({ age: 65, targetAge: 65, years: 20 });
        undefTargetParams.retirementGoal.targetMonthlyIncome = undefined as unknown as number;
        const resUndef = runScenario(undefTargetParams, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(resUndef.retirementMonthsEvaluated).toBeGreaterThan(0);
        expect(resUndef.sustainableMonthlyNetReal).not.toBeNull();
        expect(Number.isFinite(resUndef.sustainableMonthlyNetReal!)).toBe(true);
    });
});
