import { describe, it, expect } from 'vitest';
import {
    classifyFinancialGoals,
    mergeGrandCalculShards,
    runGrandCalculShardWithRunner,
    type GrandCalculRunScenarioFn,
} from '../../../services/projection/grandCalcul';
import {
    __runScenarioForTests as runScenario,
    runGrandCalculShard,
    computeGrandCalculDeterministicBaseline,
    type SimulationParams,
} from '../../../services/projection';
import { applyFinancialGoalDeadlines } from '../../../services/projection/monthlyEvents';
import type { ProjectionConfig, BudgetConfig, RetirementGoal, FinancialGoal } from '../../../types';

const makeParams = (overrides: {
    years?: number;
    baseMonthlyExpenses?: number;
    celi?: number;
    reer?: number;
    nonReg?: number;
    cash?: number;
    goals?: FinancialGoal[];
    inflationRate?: number;
    salary?: number;
} = {}): SimulationParams => {
    const projection: ProjectionConfig = {
        years: overrides.years ?? 25,
        returnRate: 6.5,
        inflationRate: overrides.inflationRate ?? 2.0,
        savingsMode: 'manual',
        manualContribution: 1200,
        usePortfolioRate: false,
        returnRates: { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.0,
        propertyGrowthRate: 3,
    };
    const sal = overrides.salary ?? 6000;
    const config: BudgetConfig = {
        users: [
            {
                name: 'ProfilFI',
                grossSalary: sal,
                netSalary: Math.round(sal * 0.7),
                color: '#10b981',
                age: 35,
                birthYear: 1991,
                canadaArrivalYear: 1991,
                hasOwnedPropertyLast4Years: true,
                celiContributed: 0,
                rrspContributed: 0,
            },
        ],
        splitMode: '50/50',
    } as unknown as BudgetConfig;
    const retirementGoal: RetirementGoal = {
        targetAge: 65,
        targetMonthlyIncome: 4000,
        governmentPension: 1400,
        lifeExpectancy: 90,
    };
    return {
        projection,
        calculatedStartingCash: overrides.cash ?? 20_000,
        liveCSVBalances: {
            CELI: overrides.celi ?? 100_000,
            CELIAPP: 0,
            REER: overrides.reer ?? 120_000,
            NON_ENREG: overrides.nonReg ?? 40_000,
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
        baseGrossAnnual: sal * 12,
        baseNetAnnual: Math.round(sal * 0.7) * 12,
        currentRentExpense: 1500,
        baseMonthlyExpenses: overrides.baseMonthlyExpenses ?? 3200,
        startYear: 2026,
        startMonth: 0,
        financialGoals: overrides.goals ?? [],
    };
};

function runSyntheticFiCohort(reachedMask: boolean[], fireNumber = 900_000) {
    const params = makeParams({ years: 20 });
    const n = reachedMask.length;
    const chartStub = Array.from({ length: 241 }, (_v, m) => ({ NetWorth: 100_000 + m * 1000 }));
    const runner: GrandCalculRunScenarioFn = (_p, _s, _mc, _dp, idx) => ({
        chartData: chartStub,
        finalNetWorth: 500_000,
        estateNetWorth: 450_000,
        totalTaxesPaid: 10_000,
        totalEstateTax: 5_000,
        fedEstateTax: 2_200,
        qcEstateTax: 2_800,
        projectedDeathAge: 55,
        fireNumber,
        firstFireAge: reachedMask[idx] ? 42 + (idx % 12) : null,
        cumCpiFactorAtEnd: 1.5,
        sustainableMonthlyNetReal: null,
        retirementMonthsEvaluated: 0,
    });
    const shard = runGrandCalculShardWithRunner(
        runner,
        params,
        { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false },
        0,
        n,
    );
    return mergeGrandCalculShards([shard], {
        paramsSig: 'fi-cohort',
        durationMs: 1,
        regimesEnabled: false,
        historicalCrisesEnabled: false,
        startYear: 2026,
        currentAge: 35,
        nMonths: 240,
    }).fiAge;
}

describe('R2.1 & R2.2 — Distribution d’âge FI et probabilités datées par objectif', () => {
    it('gère la censure à droite de l’âge FI (0 %, 30 %, 75 %, 100 %) et le garde cible <= 0', () => {
        const noneReached = runSyntheticFiCohort(Array.from({ length: 100 }, () => false));
        expect(noneReached.reachedPct).toBe(0);
        expect(noneReached.p5Age).toBeNull();
        expect(noneReached.p50Age).toBeNull();
        expect(noneReached.p95Age).toBeNull();

        const pct30 = runSyntheticFiCohort(Array.from({ length: 100 }, (_, i) => i < 30));
        expect(pct30.reachedPct).toBe(30);
        expect(pct30.p5Age).not.toBeNull();
        expect(pct30.p50Age).toBeNull();
        expect(pct30.p95Age).toBeNull();

        const pct75 = runSyntheticFiCohort(Array.from({ length: 100 }, (_, i) => i < 75));
        expect(pct75.reachedPct).toBe(75);
        expect(pct75.p5Age).not.toBeNull();
        expect(pct75.p50Age).not.toBeNull();
        expect(pct75.p95Age).toBeNull();
        expect(pct75.p5Age!).toBeLessThanOrEqual(pct75.p50Age!);

        const pct100 = runSyntheticFiCohort(Array.from({ length: 100 }, () => true));
        expect(pct100.reachedPct).toBe(100);
        expect(pct100.p5Age).not.toBeNull();
        expect(pct100.p50Age).not.toBeNull();
        expect(pct100.p95Age).not.toBeNull();
        expect(pct100.p5Age!).toBeLessThanOrEqual(pct100.p50Age!);
        expect(pct100.p50Age!).toBeLessThanOrEqual(pct100.p95Age!);
        expect(pct100.p95Age!).toBeLessThanOrEqual(pct100.horizonAge);

        // No-fake-data : dépenses de base <= 0 ⇒ cible FI invalide ⇒ tous null
        const zeroTargetParams = makeParams({ baseMonthlyExpenses: 0, years: 10 });
        const shardZero = runGrandCalculShard(
            zeroTargetParams,
            { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false },
            0,
            20,
        );
        const mergedZero = mergeGrandCalculShards([shardZero], {
            paramsSig: 'zero-fire',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 35,
        });
        expect(mergedZero.fiAge.reachedPct).toBeNull();
        expect(mergedZero.fiAge.p5Age).toBeNull();
        expect(mergedZero.fiAge.p50Age).toBeNull();
        expect(mergedZero.fiAge.p95Age).toBeNull();
    });

    it('aligne la cible FI future sur l’inflation stochastique cumulée sous régimes/MC tout en préservant le déterministe', () => {
        const params = makeParams({ years: 20, inflationRate: 2.0, celi: 300_000, reer: 200_000, baseMonthlyExpenses: 3000 });
        const det = runScenario(params, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        // En déterministe, FireTarget au mois m utilise exactement simInflation (2%)
        const lastPt = det.chartData[det.chartData.length - 1];
        expect(lastPt.FireTarget).toBeCloseTo((det.fireNumber as number) * Math.pow(1.02, 20), 0);

        // En mode régimes macro + stress inflation, l'inflation cumulée diverge du 2 % statique
        const stressed = makeParams({
            years: 20,
            inflationRate: 2.0,
            celi: 250_000,
            reer: 250_000,
            baseMonthlyExpenses: 3000,
        });
        stressed.projection.stressTestEnabled = true;
        stressed.projection.stressTestYear = 1;
        stressed.projection.stressTestRecoveryMonths = 120;
        stressed.projection.stressTestInflationShock = 6; // +6 %/an pendant 10 ans

        const mcStressed = runScenario(stressed, 'AUTO_MARGINAL', true, false, 0, 'BASE', {}, {
            macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: false },
        });
        const staticFactor = Math.pow(1.02, 20);
        expect(mcStressed.cumCpiFactorAtEnd).toBeGreaterThan(staticFactor * 1.4);
        // Si FI est atteint, c'est face au seuil réellement indexé par l'inflation cumulée (donc plus tardif ou non atteint)
        const mcUnstressed = runScenario(params, 'AUTO_MARGINAL', true, false, 0, 'BASE', {}, {
            macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: false },
        });
        if (mcStressed.firstFireAge !== null && mcUnstressed.firstFireAge !== null) {
            expect(mcStressed.firstFireAge).toBeGreaterThanOrEqual(mcUnstressed.firstFireAge);
        }
    });

    it('classifie les 4 statuts d’objectifs financiers et évalue NET_WORTH sans retrait destructif', () => {
        const goals: FinancialGoal[] = [
            {
                id: 'g-done',
                name: 'Objectif déjà complété',
                type: 'CUSTOM',
                targetAmount: 10_000,
                manualCurrentAmount: 0,
                deadline: '2029-06',
                status: 'active',
                completed: true,
            },
            {
                id: 'g-past',
                name: 'Date passée',
                type: 'NET_WORTH',
                targetAmount: 200_000,
                deadline: '2020-01',
                status: 'active',
                completed: false,
            },
            {
                id: 'g-future',
                name: 'Au-delà de l’horizon',
                type: 'NET_WORTH',
                targetAmount: 2_000_000,
                deadline: '2060-01',
                status: 'active',
                completed: false,
            },
            {
                id: 'g-invalid',
                name: 'Date invalide',
                type: 'CUSTOM',
                targetAmount: 50_000,
                deadline: '2030-13',
                status: 'active',
                completed: false,
            },
            {
                id: 'g-nw',
                name: 'Jalon patrimoine 400k',
                type: 'NET_WORTH',
                targetAmount: 400_000,
                deadline: '2031-06',
                status: 'active',
                completed: false,
            },
            {
                id: 'g-partial',
                name: 'Achat exigeant',
                type: 'CUSTOM',
                targetAmount: 800_000,
                manualCurrentAmount: 0,
                deadline: '2030-06',
                targetAccount: 'NON-ENREG',
                status: 'active',
                completed: false,
            },
        ];

        const paramsWithNwOnly = makeParams({
            years: 10,
            goals: [goals[4]],
        });
        const paramsWithoutGoals = makeParams({
            years: 10,
            goals: [],
        });

        // Vérifie que l'objectif NET_WORTH ne retire RIEN du portefeuille (patrimoine final bit-identique)
        const runWithNw = runScenario(paramsWithNwOnly, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        const runWithout = runScenario(paramsWithoutGoals, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(runWithNw.finalNetWorth).toBe(runWithout.finalNetWorth);
        expect(runWithNw.goalOutcomes['__idx_0']).toBeDefined();

        // Vérifie tous les statuts et agrégations dans Grand Calcul
        const allParams = makeParams({ years: 10, goals });
        const shard = runGrandCalculShard(
            allParams,
            { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: false, seed: 11 },
            0,
            40,
        );
        const baseline = computeGrandCalculDeterministicBaseline(allParams);
        const merged = mergeGrandCalculShards([shard], {
            paramsSig: 'goals-all',
            durationMs: 10,
            regimesEnabled: true,
            historicalCrisesEnabled: false,
            startYear: allParams.startYear,
            startMonth: allParams.startMonth ?? 0,
            currentAge: 35,
            financialGoals: goals,
            ...baseline,
        });

        const byId = new Map(merged.goalProbabilities.map((g) => [g.goalId, g]));
        expect(byId.get('g-done')).toMatchObject({ status: 'already_completed', probabilityPct: 100, medianShortfall: 0 });
        expect(byId.get('g-past')).toMatchObject({ status: 'beyond_horizon', probabilityPct: null, medianShortfall: null });
        expect(byId.get('g-future')).toMatchObject({ status: 'beyond_horizon', probabilityPct: null, medianShortfall: null });
        expect(byId.get('g-invalid')).toMatchObject({ status: 'invalid_deadline', probabilityPct: null, medianShortfall: null });

        const gNw = byId.get('g-nw')!;
        expect(gNw.status).toBe('evaluated');
        expect(gNw.probabilityPct).not.toBeNull();
        expect(gNw.probabilityPct!).toBeGreaterThanOrEqual(0);
        expect(gNw.probabilityPct!).toBeLessThanOrEqual(100);

        const gPartial = byId.get('g-partial')!;
        expect(gPartial.status).toBe('evaluated');
        expect(gPartial.probabilityPct!).toBeLessThan(100);
        expect(gPartial.medianShortfall).not.toBeNull();
        expect(gPartial.medianShortfall!).toBeGreaterThan(0);
    });

    it('synchronise les deadlines avec espaces, les id vides (goal-i) et le dernier mois sans décalage UTC', () => {
        const goals: FinancialGoal[] = [
            {
                id: 'g-archived',
                name: 'Archivé',
                type: 'NET_WORTH',
                targetAmount: 10_000,
                deadline: '2027-01',
                status: 'archived',
                completed: false,
            },
            {
                id: '',
                name: 'Sans ID',
                type: 'NET_WORTH',
                targetAmount: 50_000,
                deadline: '2028-06',
                status: 'active',
                completed: false,
            },
            {
                id: 'g-ws',
                name: 'Espaces autour de la date',
                type: 'NET_WORTH',
                targetAmount: 50_000,
                deadline: ' 2028-06 ',
                status: 'active',
                completed: false,
            },
            {
                id: 'g-last-month',
                name: 'Dernier mois exact (2036-01)',
                type: 'NET_WORTH',
                targetAmount: 50_000,
                deadline: '2036-01',
                status: 'active',
                completed: false,
            },
        ];
        const params = makeParams({ years: 10, celi: 500_000, goals });
        const shard = runGrandCalculShard(
            params,
            { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false, seed: 5 },
            0,
            10,
        );
        const baseline = computeGrandCalculDeterministicBaseline(params);
        const merged = mergeGrandCalculShards([shard], {
            paramsSig: 'goal-sync',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: params.startYear,
            startMonth: params.startMonth ?? 0,
            currentAge: 35,
            financialGoals: goals,
            ...baseline,
        });

        const byId = new Map(merged.goalProbabilities.map((g) => [g.goalId, g]));
        expect(byId.get('goal-1')).toMatchObject({ status: 'evaluated', probabilityPct: 100, medianShortfall: 0 });
        expect(byId.get('g-ws')).toMatchObject({ status: 'evaluated', probabilityPct: 100, medianShortfall: 0 });
        expect(byId.get('g-last-month')).toMatchObject({ status: 'evaluated', probabilityPct: 100, medianShortfall: 0 });

        // Test unitaire direct de applyFinancialGoalDeadlines (clé interne __idx_i + deadline trimmée)
        const evaluated: Array<{ id: string; met: boolean }> = [];
        applyFinancialGoalDeadlines(goals, '2028-06', 1.0, {
            withdrawFromAccount: (_acct, amount) => amount,
            addExpense: () => {},
            logFlow: () => {},
            getNetWorth: () => 500_000,
            onGoalEvaluated: (goalKey, met) => { evaluated.push({ id: goalKey, met }); },
        });
        expect(evaluated).toEqual([
            { id: '__idx_1', met: true },
            { id: '__idx_2', met: true },
        ]);
    });

    it('désambiguïse les collisions d’ID d’objectifs (goal-1 explicite + id vide ou doublon) sans dépasser 100 %', () => {
        const collidingGoals: FinancialGoal[] = [
            {
                id: 'goal-1',
                name: 'Cible hors de portée',
                type: 'NET_WORTH',
                targetAmount: 50_000_000,
                deadline: '2028-06',
                status: 'active',
                completed: false,
            },
            {
                id: '',
                name: 'Index 1 sans ID (cible garantie)',
                type: 'NET_WORTH',
                targetAmount: 10_000,
                deadline: '2029-06',
                status: 'active',
                completed: false,
            },
            {
                id: 'goal-1',
                name: 'Doublon explicite goal-1 (garanti)',
                type: 'NET_WORTH',
                targetAmount: 15_000,
                deadline: '2030-06',
                status: 'active',
                completed: false,
            },
        ];
        const params = makeParams({ years: 10, celi: 500_000, goals: collidingGoals });
        const shard = runGrandCalculShard(
            params,
            { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false, seed: 3 },
            0,
            10,
        );
        const baseline = computeGrandCalculDeterministicBaseline(params);
        const merged = mergeGrandCalculShards([shard], {
            paramsSig: 'goal-collision',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: params.startYear,
            startMonth: params.startMonth ?? 0,
            currentAge: 35,
            financialGoals: collidingGoals,
            ...baseline,
        });

        expect(merged.goalProbabilities).toHaveLength(3);
        expect(merged.goalProbabilities[0]).toMatchObject({
            goalId: 'goal-1',
            name: 'Cible hors de portée',
            status: 'evaluated',
            probabilityPct: 0,
        });
        expect(merged.goalProbabilities[1]).toMatchObject({
            goalId: 'goal-1',
            name: 'Index 1 sans ID (cible garantie)',
            status: 'evaluated',
            probabilityPct: 100,
            medianShortfall: 0,
        });
        expect(merged.goalProbabilities[2]).toMatchObject({
            goalId: 'goal-1',
            name: 'Doublon explicite goal-1 (garanti)',
            status: 'evaluated',
            probabilityPct: 100,
            medianShortfall: 0,
        });
        for (const gp of merged.goalProbabilities) {
            expect(gp.probabilityPct).not.toBeNull();
            expect(gp.probabilityPct!).toBeGreaterThanOrEqual(0);
            expect(gp.probabilityPct!).toBeLessThanOrEqual(100);
        }
    });

    it('classifyFinancialGoals couvre toutes les branches (vide, archivé, NET_WORTH déjà atteint, format invalide, cible <= 0) et mergeGrandCalculShards sans meta.financialGoals', () => {
        expect(classifyFinancialGoals(undefined, 2026, 0, 120)).toEqual([]);
        expect(classifyFinancialGoals([], 2026, 0, 120)).toEqual([]);

        const goals: FinancialGoal[] = [
            { id: 'arch', name: 'Archivé', type: 'CUSTOM', targetAmount: 10_000, deadline: '2028-01', status: 'archived', completed: false },
            { id: 'nw-manual-high', name: 'NW manuel élevé', type: 'NET_WORTH', targetAmount: 50_000, manualCurrentAmount: 80_000, deadline: '2029-01', status: 'active', completed: false },
            { id: 'custom-manual-high', name: 'Custom financé', type: 'CUSTOM', targetAmount: 50_000, manualCurrentAmount: 60_000, deadline: '2029-01', status: 'active', completed: false },
            { id: 'bad-fmt', name: 'Mauvais format', type: 'CUSTOM', targetAmount: 20_000, deadline: 'bad-date', status: 'active', completed: false },
            { id: 'zero-target', name: 'Cible nulle', type: 'CUSTOM', targetAmount: 0, deadline: '2029-01', status: 'active', completed: false },
            { id: 'bad-month', name: 'Mois 00', type: 'CUSTOM', targetAmount: 15_000, deadline: '2029-00', status: 'active', completed: false },
        ];
        const classified = classifyFinancialGoals(goals, 2026, 0, 120);
        const byId = new Map(classified.map((c) => [c.goalId, c]));

        expect(byId.has('arch')).toBe(false);
        expect(byId.get('nw-manual-high')?.status).toBe('evaluated');
        expect(byId.get('custom-manual-high')?.status).toBe('already_completed');
        expect(byId.get('bad-fmt')?.status).toBe('invalid_deadline');
        expect(byId.get('zero-target')?.status).toBe('invalid_deadline');
        expect(byId.get('bad-month')?.status).toBe('invalid_deadline');

        // Repli mergeGrandCalculShards sans meta.financialGoals (grandCalcul.ts:953-961)
        const params = makeParams({ years: 5, goals: [goals[1]] });
        const shard = runGrandCalculShard(params, { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false }, 0, 5);
        const mergedNoMetaGoals = mergeGrandCalculShards([shard], {
            paramsSig: 'no-meta-goals',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: params.startYear,
            currentAge: 35,
        });
        expect(mergedNoMetaGoals.goalProbabilities).toHaveLength(1);
        expect(mergedNoMetaGoals.goalProbabilities[0].goalId).toBe('__idx_0');
        expect(mergedNoMetaGoals.goalProbabilities[0].status).toBe('evaluated');
    });
});
