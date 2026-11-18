import { describe, it, expect, vi } from 'vitest';
import {
    clampGrandCalculIterations,
    GRAND_CALCUL_ITERATIONS_DEFAULT,
    GRAND_CALCUL_ITERATIONS_MAX,
    GRAND_CALCUL_ITERATIONS_MIN,
    MonthlyTDigestPool,
    mergeGrandCalculShards,
    runGrandCalculShardWithRunner,
    type GrandCalculRunScenarioFn,
} from '../../../services/projection/grandCalcul';
import {
    runGrandCalculShard,
    computeGrandCalculDeterministicBaseline,
    type SimulationParams,
} from '../../../services/projection';
import type { ProjectionConfig, BudgetConfig, RetirementGoal, FinancialGoal } from '../../../types';
import * as errorLogger from '../../../services/errorLogger';

const makeTestParams = (years = 15, goals: FinancialGoal[] = []): SimulationParams => {
    const projection: ProjectionConfig = {
        years,
        returnRate: 6.5,
        inflationRate: 2.0,
        savingsMode: 'manual',
        manualContribution: 1200,
        usePortfolioRate: false,
        returnRates: { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.5,
        propertyGrowthRate: 3,
    };
    const config: BudgetConfig = {
        users: [
            {
                name: 'ProfilTest',
                grossSalary: 7500,
                netSalary: 5000,
                color: '#10b981',
                age: 45,
                birthYear: 1981,
                canadaArrivalYear: 1981,
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
        calculatedStartingCash: 25_000,
        liveCSVBalances: { CELI: 80_000, CELIAPP: 0, REER: 150_000, NON_ENREG: 45_000, CRYPTO: 0, REEE: 0 },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal,
        config,
        baseGrossAnnual: 90_000,
        baseNetAnnual: 60_000,
        currentRentExpense: 1700,
        baseMonthlyExpenses: 3500,
        startYear: 2026,
        startMonth: 0,
        financialGoals: goals,
    };
};

describe('grandCalcul — bornage, T-Digest mémoire bornée, parité de shards et échelle 50k–100k', () => {
    it('borne les itérations dans [50_000, 100_000] et journalise les entrées non finies', () => {
        const logSpy = vi.spyOn(errorLogger, 'logErrorThrottled');
        expect(clampGrandCalculIterations(undefined)).toBe(GRAND_CALCUL_ITERATIONS_DEFAULT);
        expect(clampGrandCalculIterations(10)).toBe(GRAND_CALCUL_ITERATIONS_MIN);
        expect(clampGrandCalculIterations(49_999)).toBe(GRAND_CALCUL_ITERATIONS_MIN);
        expect(clampGrandCalculIterations(75_000.4)).toBe(75_000);
        expect(clampGrandCalculIterations(250_000)).toBe(GRAND_CALCUL_ITERATIONS_MAX);
        expect(clampGrandCalculIterations(Number.NaN)).toBe(GRAND_CALCUL_ITERATIONS_DEFAULT);
        expect(clampGrandCalculIterations(Number.POSITIVE_INFINITY)).toBe(GRAND_CALCUL_ITERATIONS_DEFAULT);
        expect(logSpy).toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it('émet la progression de manière monotone du début (0) à la fin (count) avec cadence <= 250', () => {
        const params = makeTestParams(5);
        const progressCalls: Array<{ done: number; total: number }> = [];
        const stubRunner: GrandCalculRunScenarioFn = (_p, _s, _mc, _dp, i) => ({
            chartData: Array.from({ length: 61 }, (_v, m) => ({ NetWorth: 100_000 + m * 500 + i })),
            finalNetWorth: 130_000 + i,
            estateNetWorth: 120_000 + i,
            totalTaxesPaid: 5000,
            totalEstateTax: 10_000,
            fedEstateTax: 4500,
            qcEstateTax: 5500,
            projectedDeathAge: 50,
            fireNumber: 1_000_000,
            firstFireAge: null,
            cumCpiFactorAtEnd: 1.1,
            sustainableMonthlyNetReal: null,
            retirementMonthsEvaluated: 0,
        });

        runGrandCalculShardWithRunner(
            stubRunner,
            params,
            { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false },
            0,
            600,
            (done, total) => progressCalls.push({ done, total }),
        );

        expect(progressCalls[0]).toEqual({ done: 0, total: 600 });
        expect(progressCalls[progressCalls.length - 1]).toEqual({ done: 600, total: 600 });
        for (let k = 1; k < progressCalls.length; k++) {
            expect(progressCalls[k].done).toBeGreaterThanOrEqual(progressCalls[k - 1].done);
            expect(progressCalls[k].done - progressCalls[k - 1].done).toBeLessThanOrEqual(250);
        }
    });

    it('préserve l’exactitude du T-Digest (< 0,5 % d’erreur vs tri exact) et la monotonie P5..P95 + masse ponctuelle m=0', () => {
        const nMonths = 120;
        const nSamples = 10_000;
        const shardCount = 4;
        const perShard = nSamples / shardCount;
        const exactByMonth: Float32Array[] = Array.from({ length: nMonths + 1 }, () => new Float32Array(nSamples));

        const shards = Array.from({ length: shardCount }, (_s, sIdx) => {
            const pool = new MonthlyTDigestPool(nMonths);
            for (let i = 0; i < perShard; i++) {
                const gIdx = sIdx * perShard + i;
                for (let m = 0; m <= nMonths; m++) {
                    // m=0 : masse ponctuelle exacte ; m>0 : mélange bimodal asymétrique incluant des négatifs
                    const val = m === 0
                        ? 250_000
                        : ((gIdx % 5 === 0 ? -40_000 : 120_000) + ((gIdx * 7919 + m * 101) % 300_000) * (1 + m * 0.02));
                    pool.add(m, val);
                    exactByMonth[m][gIdx] = val;
                }
            }
            return {
                iterationsDone: perShard,
                ruinedCount: 0,
                monthlyHistogramsOrSamples: pool.exportCompact(),
                fiReachedAges: new Float32Array(perShard).fill(Number.NaN),
                goalResults: {},
                sustainableMonthlyNetReal: new Float32Array(perShard).fill(Number.NaN),
                estateTotals: new Float32Array(perShard).fill(0),
                estateFeds: new Float32Array(perShard).fill(0),
                estateQcs: new Float32Array(perShard).fill(0),
                estateRealTotals: new Float32Array(perShard).fill(0),
                finalNetWorths: exactByMonth[nMonths].subarray(sIdx * perShard, (sIdx + 1) * perShard),
            };
        });

        const merged = mergeGrandCalculShards(shards, {
            paramsSig: 'tdigest-test',
            durationMs: 10,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 40,
            nMonths,
        });

        expect(merged.monthlyBands.length).toBe(nMonths + 1);
        // Masse ponctuelle exacte à m = 0
        expect(merged.monthlyBands[0].p5).toBe(250_000);
        expect(merged.monthlyBands[0].p50).toBe(250_000);
        expect(merged.monthlyBands[0].p95).toBe(250_000);

        for (let m = 1; m <= nMonths; m++) {
            const b = merged.monthlyBands[m];
            expect(b.p5).toBeLessThanOrEqual(b.p10);
            expect(b.p10).toBeLessThanOrEqual(b.p25);
            expect(b.p25).toBeLessThanOrEqual(b.p50);
            expect(b.p50).toBeLessThanOrEqual(b.p75);
            expect(b.p75).toBeLessThanOrEqual(b.p90);
            expect(b.p90).toBeLessThanOrEqual(b.p95);

            if (m % 20 === 0) {
                const sorted = exactByMonth[m].sort();
                const span = Math.max(1, sorted[nSamples - 1] - sorted[0]);
                const checkQ = (q: number, est: number) => {
                    const exact = sorted[Math.floor(q * nSamples)];
                    const spanErr = Math.abs(est - exact) / span;
                    expect(spanErr).toBeLessThan(0.005);
                    // Erreur de rang (précision empirique du quantile T-Digest < 0,5 %)
                    let lo = 0;
                    let hi = nSamples;
                    while (lo < hi) {
                        const mid = (lo + hi) >>> 1;
                        if (sorted[mid] <= est) lo = mid + 1;
                        else hi = mid;
                    }
                    const rankErr = Math.abs(lo / nSamples - q);
                    expect(rankErr).toBeLessThan(0.005);
                };
                checkQ(0.05, b.p5);
                checkQ(0.50, b.p50);
                checkQ(0.95, b.p95);
            }
        }
    });

    it('borne la taille mémoire sérialisée du shard sur 840 mois (< 3 Mo)', () => {
        const nMonths = 840;
        const pool = new MonthlyTDigestPool(nMonths);
        for (let i = 0; i < 1000; i++) {
            for (let m = 0; m <= nMonths; m++) {
                pool.add(m, 50_000 + ((i * 131 + m * 17) % 500_000));
            }
        }
        const compact = pool.exportCompact();
        const totalBytes = compact.counts.byteLength + compact.means.byteLength + compact.weights.byteLength;
        expect(compact.counts.length).toBe(nMonths + 1);
        expect(totalBytes).toBeLessThan(3_000_000);
    });

    it('garantit la parité exacte entre 4 shards et un run unique sur le vrai moteur', () => {
        const params = makeTestParams(10, [
            {
                id: 'g1',
                name: 'Cible patrimoine',
                type: 'NET_WORTH',
                targetAmount: 350_000,
                deadline: '2032-06',
                status: 'active',
                completed: false,
            },
        ]);
        const config = {
            iterations: 50_000,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
            seed: 42,
        };
        const baseline = computeGrandCalculDeterministicBaseline(params);

        const singleShard = runGrandCalculShard(params, config, 0, 80);
        const splitShards = [
            runGrandCalculShard(params, config, 0, 20),
            runGrandCalculShard(params, config, 20, 20),
            runGrandCalculShard(params, config, 40, 20),
            runGrandCalculShard(params, config, 60, 20),
        ];

        const meta = {
            paramsSig: 'parity-sig',
            createdAt: '2026-11-17T00:00:00.000Z',
            durationMs: 50,
            regimesEnabled: true,
            historicalCrisesEnabled: true,
            startYear: params.startYear,
            startMonth: params.startMonth ?? 0,
            currentAge: params.config.users[0]?.age ?? 30,
            financialGoals: params.financialGoals,
            ...baseline,
        };

        const resSingle = mergeGrandCalculShards([singleShard], meta);
        const resSplit = mergeGrandCalculShards(splitShards, meta);

        expect(resSplit.iterationsRun).toBe(80);
        expect(resSplit.survivalRatePct).toBe(resSingle.survivalRatePct);
        expect(resSplit.cvar95).toBe(resSingle.cvar95);
        expect(resSplit.fiAge).toEqual(resSingle.fiAge);
        expect(resSplit.goalProbabilities).toEqual(resSingle.goalProbabilities);
        expect(resSplit.guaranteedPurchasingPower).toEqual(resSingle.guaranteedPurchasingPower);
        expect(resSplit.estateTax).toEqual(resSingle.estateTax);
        expect(resSplit.monthlyBands.length).toBe(resSingle.monthlyBands.length);
        for (let m = 0; m < resSingle.monthlyBands.length; m += 12) {
            expect(resSplit.monthlyBands[m].p50).toBeCloseTo(resSingle.monthlyBands[m].p50, 0);
        }
    });

    it('supporte 50 000 trajectoires réparties en 4 shards avec fusion bornée complète', () => {
        const params = makeTestParams(30, [
            {
                id: 'goal-50k',
                name: 'Jalons 50k',
                type: 'NET_WORTH',
                targetAmount: 600_000,
                deadline: '2040-01',
                status: 'active',
                completed: false,
            },
        ]);
        const config = { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: false, seed: 7 };
        const nMonths = 360;
        const chartStub = Array.from({ length: nMonths + 1 }, (_v, m) => ({ NetWorth: 100_000 + m * 1000 }));
        const syntheticRunner: GrandCalculRunScenarioFn = (_p, _s, _mc, _dp, idx) => {
            const delta = (idx % 100) * 1500;
            return {
                chartData: chartStub,
                finalNetWorth: 350_000 + delta,
                estateNetWorth: 320_000 + delta,
                totalTaxesPaid: 20_000,
                totalEstateTax: 18_000 + (idx % 50) * 100,
                fedEstateTax: 8_000 + (idx % 50) * 45,
                qcEstateTax: 10_000 + (idx % 50) * 55,
                projectedDeathAge: 75,
                fireNumber: 900_000,
                firstFireAge: idx % 4 === 0 ? Number.NaN : 58 + (idx % 12),
                goalOutcomes: { __idx_0: { met: idx % 3 !== 0, shortfallReal: idx % 3 === 0 ? 25_000 : 0, shortfallNominal: 30_000 } },
                cumCpiFactorAtEnd: 1.8,
                sustainableMonthlyNetReal: 4200 + (idx % 200) * 5,
                retirementMonthsEvaluated: 120,
            };
        };

        const shardSize = 12_500;
        const shards = [0, 1, 2, 3].map((k) =>
            runGrandCalculShardWithRunner(syntheticRunner, params, config, k * shardSize, shardSize),
        );
        const merged = mergeGrandCalculShards(shards, {
            paramsSig: '50k-stress',
            durationMs: 100,
            regimesEnabled: true,
            historicalCrisesEnabled: false,
            startYear: params.startYear,
            currentAge: 45,
            nMonths,
            financialGoals: params.financialGoals,
        });

        expect(merged.iterationsRun).toBe(50_000);
        expect(merged.survivalRatePct).toBe(100);
        expect(merged.fiAge.reachedPct).toBeCloseTo(75, 1);
        expect(merged.fiAge.p5Age).not.toBeNull();
        expect(merged.fiAge.p50Age).not.toBeNull();
        expect(merged.fiAge.p95Age).toBeNull();
        expect(merged.goalProbabilities[0].probabilityPct).toBeCloseTo(66.67, 1);
        expect(merged.guaranteedPurchasingPower.p95SecurityMonthlyNetReal).toBeLessThanOrEqual(
            merged.guaranteedPurchasingPower.p90SecurityMonthlyNetReal!,
        );
        expect(merged.guaranteedPurchasingPower.p90SecurityMonthlyNetReal!).toBeLessThanOrEqual(
            merged.guaranteedPurchasingPower.p50SecurityMonthlyNetReal!,
        );
    });

    it('retourne null (no-fake-data) lorsque la liste de shards est vide', () => {
        const empty = mergeGrandCalculShards([], {
            paramsSig: 'empty',
            durationMs: 0,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 40,
            nMonths: 120,
        });
        expect(empty.iterationsRun).toBe(0);
        expect(empty.survivalRatePct).toBeNull();
        expect(empty.cvar95).toBeNull();
        expect(empty.fiAge.reachedPct).toBeNull();
        expect(empty.fiAge.p50Age).toBeNull();
        expect(empty.guaranteedPurchasingPower.p95SecurityMonthlyNetReal).toBeNull();
        expect(empty.estateTax.mcTotalP50).toBeNull();
    });

    it('préserve exactement les masses ponctuelles discrètes (96 % zéro + 4 % positif et mortalité précoce >= 95 % zéro)', () => {
        // 1) Distribution synthétique 96 % exact 0 + 4 % uniforme [100k, 1M] sur 4 shards
        const perShard = 5_000;
        const shards = Array.from({ length: 4 }, (_s, sIdx) => {
            const pool = new MonthlyTDigestPool(1);
            const finalNw = new Float32Array(perShard);
            for (let i = 0; i < perShard; i++) {
                const gIdx = sIdx * perShard + i;
                const val = gIdx < 19_200 ? 0 : 100_000 + ((gIdx - 19_200) / 800) * 900_000;
                pool.add(0, val);
                pool.add(1, val);
                finalNw[i] = val;
            }
            return {
                iterationsDone: perShard,
                ruinedCount: 0,
                monthlyHistogramsOrSamples: pool.exportCompact(),
                fiReachedAges: new Float32Array(perShard).fill(Number.NaN),
                goalResults: {},
                sustainableMonthlyNetReal: new Float32Array(perShard).fill(Number.NaN),
                estateTotals: new Float32Array(perShard).fill(0),
                estateFeds: new Float32Array(perShard).fill(0),
                estateQcs: new Float32Array(perShard).fill(0),
                estateRealTotals: new Float32Array(perShard).fill(0),
                finalNetWorths: finalNw,
            };
        });
        const merged = mergeGrandCalculShards(shards, {
            paramsSig: 'spike-96-zero',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 40,
            nMonths: 1,
        });
        const b = merged.monthlyBands[1];
        expect(b.p5).toBe(0);
        expect(b.p10).toBe(0);
        expect(b.p25).toBe(0);
        expect(b.p50).toBe(0);
        expect(b.p75).toBe(0);
        expect(b.p90).toBe(0);
        expect(b.p95).toBe(0);

        // 2) Moteur réel : personne âgée (85 ans, horizon 20 ans, mortalité stochastique) -> >= 95 % à 0 au mois 240
        const elderlyParams = makeTestParams(20);
        elderlyParams.config.users[0].age = 85;
        elderlyParams.projection.useStochasticMortality = true;
        const eShards = [
            runGrandCalculShard(elderlyParams, { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false, seed: 7 }, 0, 100),
            runGrandCalculShard(elderlyParams, { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false, seed: 7 }, 100, 100),
        ];
        const eMerged = mergeGrandCalculShards(eShards, {
            paramsSig: 'elderly-zero',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 85,
            nMonths: 240,
        });
        const bEnd = eMerged.monthlyBands[240];
        expect(bEnd.p50).toBe(0);
        expect(bEnd.p90).toBe(0);
        expect(bEnd.p95).toBe(0);
        expect(bEnd.p5).toBeLessThanOrEqual(bEnd.p50);
        expect(bEnd.p50).toBeLessThanOrEqual(bEnd.p95);

        // 3) Budget extrême (> 484 valeurs discrètes répétées) : jamais de dépassement ni NaN
        const stressPool = new MonthlyTDigestPool(0);
        for (let i = 0; i < 2000; i++) {
            stressPool.add(0, (i % 650) * 1000);
        }
        const stressCompact = stressPool.exportCompact();
        expect(stressCompact.counts[0]).toBeLessThan(500);
    });

    it('filtre les centroïdes NaN / Infinity / poids <= 0 lors de la fusion sans propager NaN', () => {
        const pool = new MonthlyTDigestPool(1);
        for (let i = 0; i < 10; i++) {
            pool.add(0, 100 + i * 10);
            pool.add(1, 200 + i * 10);
        }
        const compact = pool.exportCompact();
        // Corrompt le premier centroïde du mois 0 et le deuxième du mois 1
        compact.means[0] = Number.NaN;
        compact.weights[1] = 0;
        compact.means[compact.counts[0]] = Number.POSITIVE_INFINITY;

        const merged = mergeGrandCalculShards([{
            iterationsDone: 10,
            ruinedCount: 0,
            monthlyHistogramsOrSamples: compact,
            fiReachedAges: new Float32Array(10).fill(Number.NaN),
            goalResults: {},
            sustainableMonthlyNetReal: new Float32Array(10).fill(Number.NaN),
            estateTotals: new Float32Array(10).fill(0),
            estateFeds: new Float32Array(10).fill(0),
            estateQcs: new Float32Array(10).fill(0),
            estateRealTotals: new Float32Array(10).fill(0),
        }], {
            paramsSig: 'nan-guard',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 40,
            nMonths: 1,
        });
        for (const band of merged.monthlyBands) {
            expect(Number.isFinite(band.p5)).toBe(true);
            expect(Number.isFinite(band.p50)).toBe(true);
            expect(Number.isFinite(band.p95)).toBe(true);
        }
    });

    it('applique les seuils de censure FI sans arrondi préalable (4 996 / 49 996 / 94 996 sur 100 000 => null)', () => {
        const checkThreshold = (reached: number, total: number) => {
            const arr = new Float32Array(total);
            arr.fill(Number.NaN);
            for (let i = 0; i < reached; i++) arr[i] = 45 + (i % 15);
            return mergeGrandCalculShards([{
                iterationsDone: total,
                ruinedCount: 0,
                monthlyHistogramsOrSamples: new MonthlyTDigestPool(0).exportCompact(),
                fiReachedAges: arr,
                goalResults: {},
                sustainableMonthlyNetReal: new Float32Array(0),
                estateTotals: new Float32Array(0),
                estateFeds: new Float32Array(0),
                estateQcs: new Float32Array(0),
                estateRealTotals: new Float32Array(0),
            }], {
                paramsSig: `censor-${reached}`,
                durationMs: 1,
                regimesEnabled: false,
                historicalCrisesEnabled: false,
                startYear: 2026,
                currentAge: 40,
                nMonths: 0,
            }).fiAge;
        };

        const below5 = checkThreshold(4_996, 100_000);
        expect(below5.p5Age).toBeNull();
        expect(below5.p50Age).toBeNull();
        expect(below5.p95Age).toBeNull();

        const below50 = checkThreshold(49_996, 100_000);
        expect(below50.p5Age).not.toBeNull();
        expect(below50.p50Age).toBeNull();
        expect(below50.p95Age).toBeNull();

        const below95 = checkThreshold(94_996, 100_000);
        expect(below95.p5Age).not.toBeNull();
        expect(below95.p50Age).not.toBeNull();
        expect(below95.p95Age).toBeNull();

        const exact95 = checkThreshold(95_000, 100_000);
        expect(exact95.p95Age).not.toBeNull();
    });

    it('calcule une médiane de déficit non biaisée (Murmur3 + pondération par failCount sur shards inégaux)', () => {
        const params = makeTestParams(5, [{
            id: 'g-sf',
            name: 'Déficit',
            type: 'NET_WORTH',
            targetAmount: 500_000,
            deadline: '2028-06',
            status: 'active',
            completed: false,
        }]);
        const chartStub = Array.from({ length: 61 }, () => ({ NetWorth: 0 }));
        const runner: GrandCalculRunScenarioFn = (_p, _s, _mc, _dp, idx) => ({
            chartData: chartStub,
            finalNetWorth: 0,
            estateNetWorth: 0,
            totalTaxesPaid: 0,
            fireNumber: 0,
            goalOutcomes: { __idx_0: { met: false, shortfallReal: idx + 1, shortfallNominal: idx + 1 } },
        });
        const cfg = { iterations: 50_000, enableMacroRegimes: false, includeHistoricalCrises: false };
        const meta = {
            paramsSig: 'shortfall-weight',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 45,
            nMonths: 60,
            financialGoals: params.financialGoals,
        };

        // 1) Shard unique de 20 000 échecs monotones 1..20_000 (vraie médiane = 10 000.5)
        const sSingle = runGrandCalculShardWithRunner(runner, params, cfg, 0, 20_000);
        const mSingle = mergeGrandCalculShards([sSingle], meta).goalProbabilities[0].medianShortfall!;
        expect(Math.abs(mSingle - 10_000.5) / 10_000.5).toBeLessThan(0.03);

        // 2) Shards très inégaux : 4 096 + 15 904 (ancien code donnait 4 097, -59 % d'erreur)
        const sU1 = runGrandCalculShardWithRunner(runner, params, cfg, 0, 4_096);
        const sU2 = runGrandCalculShardWithRunner(runner, params, cfg, 4_096, 15_904);
        const mUnequal = mergeGrandCalculShards([sU1, sU2], meta).goalProbabilities[0].medianShortfall!;
        expect(Math.abs(mUnequal - 10_000.5) / 10_000.5).toBeLessThan(0.03);
    });

    it('préserve les masses ponctuelles négatives (-100 000) et les distributions très asymétriques (98 % 0 / 2 % 1e9) dans MonthlyTDigestPool', () => {
        const perShard = 2_500;
        const shards = Array.from({ length: 4 }, (_s, sIdx) => {
            const pool = new MonthlyTDigestPool(1);
            const finalNw = new Float32Array(perShard);
            for (let i = 0; i < perShard; i++) {
                const gIdx = sIdx * perShard + i;
                pool.add(0, -100_000);
                const valM1 = gIdx < 9_800 ? 0 : 1_000_000_000;
                pool.add(1, valM1);
                finalNw[i] = valM1;
            }
            return {
                iterationsDone: perShard,
                ruinedCount: 0,
                monthlyHistogramsOrSamples: pool.exportCompact(),
                fiReachedAges: new Float32Array(perShard).fill(Number.NaN),
                goalResults: {},
                sustainableMonthlyNetReal: new Float32Array(perShard).fill(Number.NaN),
                estateTotals: new Float32Array(perShard).fill(0),
                estateFeds: new Float32Array(perShard).fill(0),
                estateQcs: new Float32Array(perShard).fill(0),
                estateRealTotals: new Float32Array(perShard).fill(0),
                finalNetWorths: finalNw,
            };
        });

        const merged = mergeGrandCalculShards(shards, {
            paramsSig: 'neg-skew-tdigest',
            durationMs: 1,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
            startYear: 2026,
            currentAge: 40,
            nMonths: 1,
        });

        expect(merged.monthlyBands[0].p5).toBe(-100_000);
        expect(merged.monthlyBands[0].p50).toBe(-100_000);
        expect(merged.monthlyBands[0].p95).toBe(-100_000);

        expect(merged.monthlyBands[1].p5).toBe(0);
        expect(merged.monthlyBands[1].p50).toBe(0);
        expect(merged.monthlyBands[1].p95).toBe(0);
    });
});
