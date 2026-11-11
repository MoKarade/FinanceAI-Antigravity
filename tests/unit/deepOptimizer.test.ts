import { describe, it, expect } from 'vitest';
import {
    computePercentilesAndCvar,
    effectiveDeepMcIterations,
    MC_POWER_TIERS,
    MC_DEEP_ITERATIONS_MAX,
} from '../../services/projection/monteCarlo';
import {
    tsxReturnFor,
    usdCadReturnFor,
    canadianBondReturnFor,
    convertUsdReturnToCad,
    computeRealReturnFromInflation,
    getHistoricalReturnsDataset,
} from '../../services/projection/historicalReturns';
import {
    runTournamentStrategySearch,
    computeShapleyAttribution,
    evaluateShapleyForWinner,
    computeTournamentCompositeScore,
    type RunScenarioFn,
} from '../../services/projection/strategySearch';
import { LEVER_LIBRARY, type StrategyConfig } from '../../services/projection/strategyConfig';
import type { SimulationParams } from '../../services/projection/types';

function makeMinimalParams(): SimulationParams {
    return {
        projection: {
            years: 25,
            returnRate: 6.5,
            inflationRate: 2.0,
            savingsMode: 'budget',
            manualContribution: 0,
            usePortfolioRate: false,
            returnRates: { celi: 6.5, reer: 6.5, nonReg: 6.5, crypto: 8, cash: 2.5 },
        },
        calculatedStartingCash: 15000,
        liveCSVBalances: {
            CELI: 60000,
            CELIAPP: 0,
            REER: 90000,
            NON_ENREG: 30000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal: {
            targetAge: 62,
            lifeExpectancy: 90,
            targetMonthlyIncome: 4000,
            governmentPension: 1800,
        },
        config: {
            users: [
                { name: 'Alex', netSalary: 5500, grossSalary: 8000, color: '#3b82f6', age: 35 },
                { name: 'Sam', netSalary: 0, grossSalary: 0, color: '#10b981', age: 35 },
            ],
            splitMode: '50/50',
        },
        baseGrossAnnual: 96000,
        baseNetAnnual: 66000,
        currentRentExpense: 1500,
        baseMonthlyExpenses: 4000,
        startYear: 2026,
        startMonth: 0,
    };
}

function defaultStrategyConfig(): StrategyConfig {
    return Object.fromEntries(LEVER_LIBRARY.map((l) => [l.key, l.default])) as unknown as StrategyConfig;
}

describe('Lot 4 — Deep Optimizer, Percentiles P5-P95, CVaR 95 %, Tournoi CRN & Shapley', () => {
    describe('F17 : Paliers Monte Carlo (250 à 10 000) et CVaR 95 %', () => {
        it('expose les 4 paliers de puissance exacts (250, 1 000, 5 000, 10 000)', () => {
            expect(MC_POWER_TIERS.eclair).toBe(250);
            expect(MC_POWER_TIERS.standard).toBe(1000);
            expect(MC_POWER_TIERS.approfondi).toBe(5000);
            expect(MC_POWER_TIERS.deep_search).toBe(10000);
            expect(MC_DEEP_ITERATIONS_MAX).toBe(10000);
        });

        it('effectiveDeepMcIterations applique le palier choisi et plafonne à 10 000', () => {
            expect(effectiveDeepMcIterations(undefined, 'eclair')).toBe(250);
            expect(effectiveDeepMcIterations(undefined, 'approfondi')).toBe(5000);
            expect(effectiveDeepMcIterations(undefined, 'deep_search')).toBe(10000);
            expect(effectiveDeepMcIterations(50000)).toBe(10000);
        });

        it('computePercentilesAndCvar ordonne strictement P5 <= P10 <= P25 <= P50 <= P75 <= P90 <= P95 et CVaR95 <= P5', () => {
            const sample = Array.from({ length: 200 }, (_, i) => (i - 20) * 10000);
            const stats = computePercentilesAndCvar(sample);

            expect(stats.p5).not.toBeNull();
            expect(stats.cvar95).not.toBeNull();
            expect(stats.cvar95!).toBeLessThanOrEqual(stats.p5!);
            expect(stats.p5!).toBeLessThanOrEqual(stats.p10!);
            expect(stats.p10!).toBeLessThanOrEqual(stats.p25!);
            expect(stats.p25!).toBeLessThanOrEqual(stats.p50!);
            expect(stats.p50!).toBeLessThanOrEqual(stats.p75!);
            expect(stats.p75!).toBeLessThanOrEqual(stats.p90!);
            expect(stats.p90!).toBeLessThanOrEqual(stats.p95!);
        });

        it('retourne null (No-Fake-Data) si aucune simulation valide n’est fournie', () => {
            const empty = computePercentilesAndCvar([NaN, Infinity]);
            expect(empty.p50).toBeNull();
            expect(empty.cvar95).toBeNull();
        });
    });

    describe('F18 : Séries historiques canadiennes 1928-2024 (S&P/TSX, Obligations CA, USD/CAD)', () => {
        it('couvre 97 années historiques (1928-2024) enrichies du TSX et du taux USD/CAD', () => {
            const dataset = getHistoricalReturnsDataset();
            expect(dataset.length).toBe(97);
            expect(dataset[0].year).toBe(1928);
            expect(dataset[dataset.length - 1].year).toBe(2024);

            const r2008Tsx = tsxReturnFor(2008, -36.55);
            const fx2008 = usdCadReturnFor(2008);
            const bond2008 = canadianBondReturnFor(2008, 20.1);
            expect(r2008Tsx).toBeCloseTo(-33.0, 1);
            expect(fx2008).toBeCloseTo(22.1, 1);
            expect(bond2008).toBeCloseTo(6.4, 1);

            const cadSp500 = convertUsdReturnToCad(-0.3655, 0.221);
            expect(cadSp500).toBeGreaterThan(-0.3655);
            expect(cadSp500).toBeCloseTo(-0.2253, 3);
        });

        it('calcule le rendement réel déflaté exact selon l’équation de Fisher', () => {
            const real = computeRealReturnFromInflation(0.08, 0.03);
            expect(real).toBeCloseTo((1.08 / 1.03) - 1, 6);
        });
    });

    describe('F19 : Tournoi Successive Halving en 3 manches avec Common Random Numbers (CRN)', () => {
        const mockRunner: RunScenarioFn = (params, _strategy, isMC, delayPensions, seedIdx = 0) => {
            const retAgeBonus = ((params.retirementGoal.targetAge ?? 62) - 60) * 80000;
            const delayBonus = delayPensions ? 110000 : 0;
            const noise = isMC ? (((seedIdx * 9301 + 49297) % 233280) / 233280 - 0.5) * 150000 : 0;
            const finalNW = retAgeBonus + delayBonus + noise;
            return {
                chartData: [
                    { monthIndex: 0, NetWorth: 180000, age: 35 },
                    { monthIndex: 300, NetWorth: finalNW, age: 60 },
                ],
                finalNetWorth: finalNW,
                estateNetWorth: finalNW,
                totalTaxesPaid: 45000,
                totalGrowth: 100000,
                totalExpenses: 200000,
                minNetWorth: Math.min(180000, finalNW),
                shortfallRate: finalNW <= 0 ? 10 : 0,
            };
        };

        it('exécute les 3 manches d’élagage progressif, élimine les configs perdantes et est 100 % déterministe sous CRN', () => {
            const base = defaultStrategyConfig();
            const configs: StrategyConfig[] = [
                { ...base, retirementAge: 55, delayPensions: false },
                { ...base, retirementAge: 58, delayPensions: false },
                { ...base, retirementAge: 60, delayPensions: false },
                { ...base, retirementAge: 60, delayPensions: true },
                { ...base, retirementAge: 65, delayPensions: false },
                { ...base, retirementAge: 65, delayPensions: true },
            ];

            const params = makeMinimalParams();
            const runA = runTournamentStrategySearch(mockRunner, params, configs, {
                round1Iterations: 50,
                round2Iterations: 100,
                round3Iterations: 200,
                round2TopK: 4,
                round3TopK: 2,
                crnBaseSeed: 777,
                baselineConfig: configs[2],
            });
            const runB = runTournamentStrategySearch(mockRunner, params, configs, {
                round1Iterations: 50,
                round2Iterations: 100,
                round3Iterations: 200,
                round2TopK: 4,
                round3TopK: 2,
                crnBaseSeed: 777,
                baselineConfig: configs[2],
            });

            expect(runA.roundsSummary?.length).toBe(3);
            expect(runA.roundsSummary?.[0]).toEqual({ round: 1, candidatesIn: 6, candidatesOut: 4, iterationsPerCandidate: 50 });
            expect(runA.roundsSummary?.[1]).toEqual({ round: 2, candidatesIn: 4, candidatesOut: 2, iterationsPerCandidate: 100 });
            expect(runA.roundsSummary?.[2]).toEqual({ round: 3, candidatesIn: 2, candidatesOut: 2, iterationsPerCandidate: 200 });

            expect(runA.results[0].config.retirementAge).toBe(65);
            expect(runA.results[0].config.delayPensions).toBe(true);

            expect(runA.results[0].finalNWp50).toBe(runB.results[0].finalNWp50);
            expect(runA.results[0].cvar95).toBe(runB.results[0].cvar95);
        });

        it('pondère survie (50 %), CVaR 95 % (30 %) et médiane P50 (20 %)', () => {
            const safeScore = computeTournamentCompositeScore(
                { successRate: 98, cvar95: 400000, finalNWp10: 450000, finalNWp50: 900000 },
                1000000,
                500000,
            );
            const riskyScore = computeTournamentCompositeScore(
                { successRate: 60, cvar95: -50000, finalNWp10: 0, finalNWp50: 1000000 },
                1000000,
                500000,
            );
            expect(safeScore).toBeGreaterThan(riskyScore);
        });
    });

    describe('F20 : Décomposition marginale de Shapley (Efficience + Joueur Nul)', () => {
        it('vérifie la propriété d’efficience exacte (Σ gains = V(N) - V(0)) et le joueur nul (0 $)', () => {
            const baseline = 850000;
            const optimized = 1250000;
            const attribution = computeShapleyAttribution(
                baseline,
                optimized,
                [
                    { key: 'delayPensions', label: 'Report RRQ/PSV', marginalValue: 220000 },
                    { key: 'contributionOrder', label: 'Ordre de cotisation', marginalValue: 180000 },
                    { key: 'smithManoeuvre', label: 'Smith Manoeuvre', marginalValue: 0 },
                ],
                4000,
            );

            const sumGains = attribution.reduce((acc, item) => acc + item.gainDollars, 0);
            expect(sumGains).toBeCloseTo(optimized - baseline, 2);

            const nullPlayer = attribution.find((a) => a.key === 'smithManoeuvre');
            expect(nullPlayer?.gainDollars).toBe(0);
            expect(nullPlayer?.gainMonthsFreedom).toBe(0);

            const topLever = attribution.find((a) => a.key === 'delayPensions');
            expect(topLever?.gainDollars).toBeCloseTo(220000, 2);
            expect(topLever?.gainMonthsFreedom).toBe(Math.round(220000 / 4000));
        });

        it('evaluateShapleyForWinner isole les leviers modifiés entre baseline et gagnant', () => {
            const params = makeMinimalParams();
            const base = { ...defaultStrategyConfig(), retirementAge: 62, delayPensions: false };
            const winner: StrategyConfig = { ...base, delayPensions: true, retirementAge: 65 };
            const runner: RunScenarioFn = (p, _s, _mc, delay) => {
                const nw = 500000 + ((p.retirementGoal.targetAge ?? 62) - 62) * 50000 + (delay ? 90000 : 0);
                return {
                    chartData: [],
                    finalNetWorth: nw,
                    estateNetWorth: nw,
                    totalTaxesPaid: 0,
                    totalGrowth: 0,
                    totalExpenses: 0,
                    minNetWorth: nw,
                    shortfallRate: 0,
                };
            };

            const waterfall = evaluateShapleyForWinner(runner, params, base, winner, 4000);
            expect(waterfall.length).toBe(2);
            const total = waterfall.reduce((s, x) => s + x.gainDollars, 0);
            expect(total).toBeCloseTo(240000, 2);
        });
    });
});
