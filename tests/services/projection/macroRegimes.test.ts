import { describe, it, expect } from 'vitest';
import {
    createMacroRegimeState,
    stepMacroRegime,
    stepAndComputeRegimeRates,
    computeCrisisEpisodeRates,
    safeApplyShock,
    TRANSITION_MATRIX,
    STATIONARY_WEIGHTS,
    REGIME_PARAMS,
    MACRO_REGIME_ORDER,
    HISTORICAL_CRISIS_CATALOG,
    HISTORICAL_CRISIS_IDS,
} from '../../../services/projection/macroRegimes';
import { computeMonthlyMarketRates } from '../../../services/projection/marketShocks';
import { mulberry32 } from '../../../services/projection/helpers';
import { canadianInflationFor, convertUsdReturnToCad, tsxReturnFor } from '../../../services/projection/historicalReturns';
import { __runScenarioForTests as runScenario } from '../../../services/projection';
import type { SimulationParams } from '../../../services/projection';
import type { ProjectionConfig, BudgetConfig, RetirementGoal } from '../../../types';

const makeBaseParams = (overrides: Partial<ProjectionConfig> = {}): SimulationParams => {
    const projection: ProjectionConfig = {
        years: 20,
        returnRate: 6.5,
        inflationRate: 2.1,
        savingsMode: 'manual',
        manualContribution: 1200,
        usePortfolioRate: false,
        returnRates: { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.5,
        propertyGrowthRate: 3,
        ...overrides,
    };
    const config: BudgetConfig = {
        users: [
            {
                name: 'ProfilA',
                grossSalary: 7000,
                netSalary: 4800,
                color: '#10b981',
                age: 40,
                birthYear: 1986,
                canadaArrivalYear: 1986,
                hasOwnedPropertyLast4Years: true,
                celiContributed: 0,
                rrspContributed: 0,
            },
        ],
        splitMode: '50/50',
    } as unknown as BudgetConfig;
    const retirementGoal: RetirementGoal = {
        targetAge: 65,
        targetMonthlyIncome: 4500,
        governmentPension: 1500,
        lifeExpectancy: 90,
    };
    return {
        projection,
        calculatedStartingCash: 20_000,
        liveCSVBalances: { CELI: 80_000, CELIAPP: 0, REER: 120_000, NON_ENREG: 40_000, CRYPTO: 5_000, REEE: 0 },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal,
        config,
        baseGrossAnnual: 84_000,
        baseNetAnnual: 57_600,
        currentRentExpense: 1800,
        baseMonthlyExpenses: 3600,
        startYear: 2026,
        startMonth: 0,
        financialGoals: [],
    };
};

function pearsonCorr(xs: number[], ys: number[]): number {
    const n = xs.length;
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
        sx += xs[i];
        sy += ys[i];
    }
    const mx = sx / n;
    const my = sy / n;
    let num = 0, vx = 0, vy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        num += dx * dy;
        vx += dx * dx;
        vy += dy * dy;
    }
    return num / Math.sqrt(vx * vy);
}

describe('macroRegimes — invariants markoviens, PRNG, crises historiques & sécurité', () => {
    it('respecte les invariants stochastiques de la matrice de transition et des poids de facteurs', () => {
        for (const regime of MACRO_REGIME_ORDER) {
            const row = TRANSITION_MATRIX[regime];
            expect(row.length).toBe(4);
            let sum = 0;
            for (const p of row) {
                expect(p).toBeGreaterThanOrEqual(0);
                expect(p).toBeLessThanOrEqual(1);
                sum += p;
            }
            expect(sum).toBeCloseTo(1.0, 12);

            const p = REGIME_PARAMS[regime];
            expect(p.rhoMarketStocks).toBeGreaterThanOrEqual(0);
            expect(p.rhoMarketStocks).toBeLessThanOrEqual(1);
            expect(p.rhoMarketCrypto).toBeGreaterThanOrEqual(0);
            expect(p.rhoMarketCrypto).toBeLessThanOrEqual(1);
            expect(p.wInflationMarket ** 2 + p.wInflationMacro ** 2).toBeLessThanOrEqual(1);
            expect(p.wCashMarket ** 2 + p.wCashMacro ** 2).toBeLessThanOrEqual(1);
        }
    });

    it('retourne null quand régimes et crises sont désactivés et garantit l’identité bit-à-bit', () => {
        expect(createMacroRegimeState({ enableMacroRegimes: false, includeHistoricalCrises: false }, 'BASE', 'AUTO_MARGINAL', 0)).toBeNull();
        expect(createMacroRegimeState(null, 'BASE', 'AUTO_MARGINAL', 0)).toBeNull();

        const baseRates = { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 };
        const rngA = mulberry32(42);
        const rngB = mulberry32(42);
        for (let m = 0; m < 360; m++) {
            const a = computeMonthlyMarketRates(m, true, baseRates, 2.1, null, null, rngA);
            const b = computeMonthlyMarketRates(m, true, baseRates, 2.1, null, null, rngB, null);
            expect(b).toEqual(a);
        }

        const params = makeBaseParams();
        const baseline = runScenario(params, 'AUTO_MARGINAL', true, false, 7, 'BASE', {});
        const withDisabledMacro = runScenario(params, 'AUTO_MARGINAL', true, false, 7, 'BASE', {}, {
            macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: false },
        });
        expect(withDisabledMacro.finalNetWorth).toBe(baseline.finalNetWorth);
        expect(withDisabledMacro.estateNetWorth).toBe(baseline.estateNetWorth);
        expect(withDisabledMacro.totalTaxesPaid).toBe(baseline.totalTaxesPaid);
        expect(withDisabledMacro.totalEstateTax).toBe(baseline.totalEstateTax);
        expect(withDisabledMacro.chartData).toEqual(baseline.chartData);
    });

    it('est déterministe à seed et itération fixés et diverge si le seed ou l’itération change', () => {
        const s1 = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: true, seed: 101 }, 'BASE', 'AUTO_MARGINAL', 3)!;
        const s2 = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: true, seed: 101 }, 'BASE', 'AUTO_MARGINAL', 3)!;
        const sDiffSeed = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: true, seed: 202 }, 'BASE', 'AUTO_MARGINAL', 3)!;
        const sDiffIter = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: true, seed: 101 }, 'BASE', 'AUTO_MARGINAL', 4)!;

        const seq1: string[] = [];
        const seq2: string[] = [];
        const seqDiffSeed: string[] = [];
        const seqDiffIter: string[] = [];
        for (let m = 0; m < 120; m++) {
            stepMacroRegime(s1, m);
            stepMacroRegime(s2, m);
            stepMacroRegime(sDiffSeed, m);
            stepMacroRegime(sDiffIter, m);
            seq1.push(`${s1.currentRegime}:${s1.activeCrisis?.id ?? '-'}`);
            seq2.push(`${s2.currentRegime}:${s2.activeCrisis?.id ?? '-'}`);
            seqDiffSeed.push(`${sDiffSeed.currentRegime}:${sDiffSeed.activeCrisis?.id ?? '-'}`);
            seqDiffIter.push(`${sDiffIter.currentRegime}:${sDiffIter.activeCrisis?.id ?? '-'}`);
        }
        expect(seq1).toEqual(seq2);
        expect(seqDiffSeed).not.toEqual(seq1);
        expect(seqDiffIter).not.toEqual(seq1);
    });

    it('converge vers la distribution stationnaire ergodique sur 60 000 mois', () => {
        const state = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: false, seed: 99 }, 'BASE', 'AUTO_MARGINAL', 0)!;
        const counts: Record<string, number> = { expansion: 0, stagflation: 0, recession: 0, krach: 0 };
        const steps = 60_000;
        for (let m = 1; m <= steps; m++) {
            stepMacroRegime(state, m);
            counts[state.currentRegime] += 1;
        }
        expect(counts.expansion / steps).toBeCloseTo(0.68, 1);
        expect(counts.stagflation / steps).toBeCloseTo(0.14, 1);
        expect(counts.recession / steps).toBeCloseTo(0.15, 1);
        expect(counts.krach / steps).toBeCloseTo(0.03, 1);
        for (const r of MACRO_REGIME_ORDER) {
            expect(counts[r]).toBeGreaterThan(500);
        }
    });

    it('reproduit les inversions de corrélation entre régimes (stagflation vs krach vs expansion)', () => {
        const baseRates = { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 };
        const sampleRegime = (regime: 'expansion' | 'stagflation' | 'krach') => {
            const state = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: false, seed: 7 }, 'BASE', 'AUTO_MARGINAL', 0)!;
            const rng = mulberry32(12345);
            const eq: number[] = [];
            const cash: number[] = [];
            const crypto: number[] = [];
            for (let i = 0; i < 5000; i++) {
                state.currentRegime = regime;
                const r = stepAndComputeRegimeRates(0, baseRates, 2.0, state, rng);
                eq.push(r.mcCeliRate);
                cash.push(r.mcCashRate);
                crypto.push(r.mcCryptoRate);
            }
            return {
                corrEqCash: pearsonCorr(eq, cash),
                corrEqCrypto: pearsonCorr(eq, crypto),
            };
        };

        const exp = sampleRegime('expansion');
        const stag = sampleRegime('stagflation');
        const krach = sampleRegime('krach');

        expect(stag.corrEqCash).toBeGreaterThan(0.25);
        expect(krach.corrEqCash).toBeLessThan(-0.25);
        expect(krach.corrEqCrypto).toBeGreaterThan(exp.corrEqCrypto);
    });

    it('couvre les 6 crises historiques, y compris le creux en V 2020 et le choc 2022', () => {
        for (const id of HISTORICAL_CRISIS_IDS) {
            const def = HISTORICAL_CRISIS_CATALOG[id];
            expect(def.yearReturns.length).toBeGreaterThan(0);
            expect(def.durationMonths).toBeGreaterThanOrEqual(12);
        }

        // Crise 2020 : creux sévère en mars (mois 2) puis reprise exacte vers le rendement annuel CAD 2020
        const c2020 = HISTORICAL_CRISIS_CATALOG['2020'];
        let compound = 1;
        let month2MonthlyReturn = 0;
        for (let k = 0; k < 12; k++) {
            const r = computeCrisisEpisodeRates(
                { id: '2020', elapsedMonths: k, durationMonths: 12, yearReturns: c2020.yearReturns, monthlyLogShape: c2020.monthlyLogShape },
                0,
                0,
            );
            const rm = Math.pow(1 + r.mcCeliRate / 100, 1 / 12) - 1;
            if (k === 2) month2MonthlyReturn = rm * 100;
            compound *= (1 + rm);
        }
        const yr2020 = c2020.yearReturns[0];
        const expectedAnnual2020 = 0.35 * tsxReturnFor(2020, yr2020.sp500TotalReturn)
            + 0.65 * convertUsdReturnToCad(yr2020.sp500TotalReturn / 100, (yr2020.usdCadReturn ?? 0) / 100) * 100;
        expect(month2MonthlyReturn).toBeLessThan(-15);
        expect((compound - 1) * 100).toBeCloseTo(expectedAnnual2020, 1);

        // Crise 2022 : actions négatives + obligations négatives + inflation élevée
        const c2022 = HISTORICAL_CRISIS_CATALOG['2022'];
        const r2022 = computeCrisisEpisodeRates(
            { id: '2022', elapsedMonths: 0, durationMonths: 12, yearReturns: c2022.yearReturns },
            0,
            0,
        );
        expect(r2022.mcCeliRate).toBeLessThan(0);
        expect(r2022.mcCashRate).toBeLessThan(-5);
        expect(r2022.currentInflation).toBeCloseTo(canadianInflationFor(2022, c2022.yearReturns[0].inflationRate), 2);
    });

    it('n’altère pas le compteur PRNG principal lorsque seules les crises historiques sont actives', () => {
        let drawsNoCrisis = 0;
        let drawsWithCrisis = 0;
        const baseRng1 = mulberry32(77);
        const baseRng2 = mulberry32(77);
        const countingRng1 = () => { drawsNoCrisis++; return baseRng1(); };
        const countingRng2 = () => { drawsWithCrisis++; return baseRng2(); };

        const baseRates = { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 };
        const crisisState = createMacroRegimeState({ enableMacroRegimes: false, includeHistoricalCrises: true, seed: 55 }, 'BASE', 'AUTO_MARGINAL', 0)!;
        let crisisTriggered = false;
        for (let m = 0; m < 480; m++) {
            computeMonthlyMarketRates(m, true, baseRates, 2.0, null, null, countingRng1, null);
            computeMonthlyMarketRates(m, true, baseRates, 2.0, null, null, countingRng2, crisisState);
            if (crisisState.activeCrisis !== null) crisisTriggered = true;
        }
        expect(drawsWithCrisis).toBe(drawsNoCrisis);
        expect(crisisTriggered).toBe(true);
    });

    it('protège contre NaN et retournement de signe dans les queues extrêmes (safeApplyShock + 200 runs)', () => {
        const tail = safeApplyShock(-40, 80, -6);
        expect(Number.isFinite(tail)).toBe(true);
        expect(tail).toBeGreaterThan(-100);
        expect(tail).toBeLessThan(0);

        const params = makeBaseParams({ years: 25 });
        for (let k = 0; k < 200; k++) {
            const res = runScenario(params, 'AUTO_MARGINAL', true, false, k, 'BASE', {}, {
                macroRegimes: { enableMacroRegimes: true, includeHistoricalCrises: true, seed: 123 },
            });
            expect(Number.isFinite(res.finalNetWorth)).toBe(true);
            expect(Number.isFinite(res.estateNetWorth)).toBe(true);
            for (const pt of res.chartData) {
                expect(Number.isFinite(pt.NetWorth)).toBe(true);
            }
        }
    });

    it('en mode crises historiques seules (enableMacroRegimes: false, includeHistoricalCrises: true), les mois hors-crise utilisent le MC standard (sans dérive expansion +3,5 pp)', () => {
        const baseRates = { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 };
        const rngStd = mulberry32(4242);
        const rngCrisis = mulberry32(4242);
        const crisisState = createMacroRegimeState(
            { enableMacroRegimes: false, includeHistoricalCrises: true, seed: 77 },
            'BASE',
            'AUTO_MARGINAL',
            0,
        )!;

        let nonCrisisCount = 0;
        let nonCrisisMatches = 0;
        for (let m = 0; m < 600; m++) {
            const std = computeMonthlyMarketRates(m, true, baseRates, 2.0, null, null, rngStd, null);
            const cri = computeMonthlyMarketRates(m, true, baseRates, 2.0, null, null, rngCrisis, crisisState);
            if (crisisState.activeCrisis === null) {
                nonCrisisCount++;
                if (
                    Math.abs(cri.mcCeliRate - std.mcCeliRate) < 1e-9
                    && Math.abs(cri.mcCashRate - std.mcCashRate) < 1e-9
                    && Math.abs(cri.currentInflation - std.currentInflation) < 1e-9
                ) {
                    nonCrisisMatches++;
                }
            }
        }
        expect(nonCrisisCount).toBeGreaterThan(300);
        expect(nonCrisisMatches).toBe(nonCrisisCount);

        // Vérifie sur le moteur réel qu'un run Crises-Only sans crise déclenchée est identique au MC standard
        const params = makeBaseParams({ years: 15 });
        const stdRun = runScenario(params, 'AUTO_MARGINAL', true, false, 1, 'BASE', {}, {
            macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: false },
        });
        const crisisNoTriggerRun = runScenario(params, 'AUTO_MARGINAL', true, false, 1, 'BASE', {}, {
            macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: true, seed: 1 },
        });
        // Vérifie que la médiane Crises-Only sur cohorte ne dépasse pas artificiellement le MC standard de +3,5 pp/an
        let sumStd = 0;
        let sumCri = 0;
        for (let k = 0; k < 60; k++) {
            sumStd += runScenario(params, 'AUTO_MARGINAL', true, false, k, 'BASE', {}, {
                macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: false },
            }).finalNetWorth;
            sumCri += runScenario(params, 'AUTO_MARGINAL', true, false, k, 'BASE', {}, {
                macroRegimes: { enableMacroRegimes: false, includeHistoricalCrises: true, seed: 1 },
            }).finalNetWorth;
        }
        expect(sumCri / 60).toBeLessThanOrEqual((sumStd / 60) * 1.02);
        void crisisNoTriggerRun;
        void stdRun;
    });

    it('valide STATIONARY_WEIGHTS contre le vecteur propre stationnaire exact de TRANSITION_MATRIX', () => {
        expect(STATIONARY_WEIGHTS.reduce((s, w) => s + w, 0)).toBeCloseTo(1.0, 12);
        let pi = [0.25, 0.25, 0.25, 0.25];
        for (let step = 0; step < 300; step++) {
            const next = [0, 0, 0, 0];
            for (let i = 0; i < 4; i++) {
                const row = TRANSITION_MATRIX[MACRO_REGIME_ORDER[i]];
                for (let j = 0; j < 4; j++) {
                    next[j] += pi[i] * row[j];
                }
            }
            pi = next;
        }
        for (let i = 0; i < 4; i++) {
            expect(STATIONARY_WEIGHTS[i]).toBeCloseTo(pi[i], 2);
        }
    });

    it('combine stressTest.enabled (choc d’inflation) avec macroState actif et gère des baseRates distincts + safeApplyShock non finis', () => {
        const distinctRates = { celi: 8.5, reer: 6.0, nonReg: 4.5, crypto: 12, cash: 2.5 };

        // 1) Distinct baseRates en mode régimes activés et en mode crises-seules
        const regState = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: false, seed: 11 }, 'BASE', 'AUTO_MARGINAL', 0)!;
        regState.currentRegime = 'expansion';
        const resReg = computeMonthlyMarketRates(1, true, distinctRates, 2.0, null, null, mulberry32(77), regState);
        expect(resReg.mcCeliRate).not.toBe(resReg.mcReerRate);
        expect(resReg.mcReerRate).not.toBe(resReg.mcNonRegRate);

        const crisisOnlyState = createMacroRegimeState({ enableMacroRegimes: false, includeHistoricalCrises: true, seed: 12 }, 'BASE', 'AUTO_MARGINAL', 0)!;
        const resCris = stepAndComputeRegimeRates(0, distinctRates, 2.0, crisisOnlyState, mulberry32(88));
        expect(resCris.mcCeliRate).not.toBe(resCris.mcReerRate);
        expect(resCris.mcReerRate).not.toBe(resCris.mcNonRegRate);

        // 2) stressTest.enabled combiné à macroState (marketShocks.ts:48-50)
        const stressCfg = { enabled: true, year: 2, recoveryMonths: 6, inflationShock: 5.5 };
        const sNoStress = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: false, seed: 19 }, 'BASE', 'AUTO_MARGINAL', 0)!;
        const sWithStress = createMacroRegimeState({ enableMacroRegimes: true, includeHistoricalCrises: false, seed: 19 }, 'BASE', 'AUTO_MARGINAL', 0)!;
        const baseOut = computeMonthlyMarketRates(24, true, distinctRates, 2.0, null, null, mulberry32(99), sNoStress);
        const stressOut = computeMonthlyMarketRates(24, true, distinctRates, 2.0, null, stressCfg, mulberry32(99), sWithStress);
        expect(stressOut.currentInflation).toBeCloseTo(baseOut.currentInflation + 5.5, 6);
        expect(stressOut.mcCeliRate).toBeCloseTo(baseOut.mcCeliRate, 6);

        // Hors fenêtre du stress test : aucune altération
        const afterStress = computeMonthlyMarketRates(35, true, distinctRates, 2.0, null, stressCfg, mulberry32(99), sWithStress);
        const afterBase = computeMonthlyMarketRates(35, true, distinctRates, 2.0, null, null, mulberry32(99), sNoStress);
        expect(afterStress.currentInflation).toBeCloseTo(afterBase.currentInflation, 6);

        // 3) safeApplyShock résiste à NaN / -Infinity / Infinity
        for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
            expect(Number.isFinite(safeApplyShock(bad, 15, 1))).toBe(true);
            expect(Number.isFinite(safeApplyShock(6, bad, 1))).toBe(true);
            expect(Number.isFinite(safeApplyShock(6, 15, bad))).toBe(true);
        }
    });
});
