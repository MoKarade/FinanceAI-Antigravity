// services/projection/grandCalcul.ts
// Moteur Monte Carlo lourd (« Grand Calcul », 50 000–100 000 trajectoires) par shards
// à mémoire bornée : T-Digest fusionnable par mois (delta = 200) + tableaux typés Float32Array
// pour les scalaires R2 (âge FI, objectifs datés, pouvoir d'achat net P95/P90/P50, succession).
// Zéro import store/ ou UI ; runScenario est injecté pour éviter toute dépendance circulaire.

import type { FinancialGoal } from '../../types';
import { logErrorThrottled } from '../errorLogger';
import { round2 } from './helpers';
import { DEFAULT_LIFE_EXPECTANCY } from './modelAssumptions';
import type { MacroRegimeRunConfig } from './macroRegimes';
import type { EngineOverrides } from './strategyConfig';
import type {
    AllocationStrategy,
    CompactMonthlyQuantileShard,
    EstateTaxSummary,
    FiAgeDistribution,
    FutureScenarioType,
    GoalProbabilityResult,
    GrandCalculConfig,
    GrandCalculMonthlyBand,
    GrandCalculResult,
    GrandCalculShardResult,
    GuaranteedPurchasingPower,
    SimulationParams,
} from './types';

export const GRAND_CALCUL_ITERATIONS_MIN = 50_000;
export const GRAND_CALCUL_ITERATIONS_MAX = 100_000;
export const GRAND_CALCUL_ITERATIONS_DEFAULT = 50_000;

const TDIGEST_DELTA = 200;
const TDIGEST_BUFFER_CAP = 500;
const MAX_GOAL_SHORTFALL_SAMPLES = 4096;
const BAND_QUANTILES = [0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95] as const;

interface GrandCalculScenarioOutput {
    chartData: Array<{ NetWorth: number }>;
    /** Tampon réutilisable optionnel (mode allégé sans allocation d'objets par mois). */
    netWorthSeries?: Float64Array;
    netWorthSeriesLen?: number;
    finalNetWorth: number;
    estateNetWorth: number;
    totalTaxesPaid: number;
    totalEstateTax?: number;
    fedEstateTax?: number | null;
    qcEstateTax?: number | null;
    projectedDeathAge?: number;
    fireNumber?: number;
    firstFireAge?: number | null;
    firstFireMonthIndex?: number | null;
    goalOutcomes?: Record<string, { met: boolean; shortfallReal: number; shortfallNominal: number }>;
    cumCpiFactorAtEnd?: number;
    sustainableMonthlyNetReal?: number | null;
    retirementMonthsEvaluated?: number;
}

export type GrandCalculRunScenarioFn = (
    params: SimulationParams,
    strategy: AllocationStrategy,
    enableMonteCarlo: boolean,
    delayPensions: boolean,
    mcIterationIndex: number,
    scenarioType: FutureScenarioType,
    overrides: EngineOverrides,
    macroRegimes?: MacroRegimeRunConfig,
) => GrandCalculScenarioOutput;

/** Borne le nombre d'itérations du Grand Calcul dans [50_000, 100_000]. */
export function clampGrandCalculIterations(requested?: number): number {
    if (requested === undefined) return GRAND_CALCUL_ITERATIONS_DEFAULT;
    if (typeof requested !== 'number' || !Number.isFinite(requested)) {
        logErrorThrottled('grandCalcul:iterations:non-finite', {
            source: 'projection',
            severity: 'warning',
            message: `Itérations Grand Calcul non finies — repli sur ${GRAND_CALCUL_ITERATIONS_DEFAULT}`,
            context: { requested: String(requested) },
        });
        return GRAND_CALCUL_ITERATIONS_DEFAULT;
    }
    return Math.max(
        GRAND_CALCUL_ITERATIONS_MIN,
        Math.min(GRAND_CALCUL_ITERATIONS_MAX, Math.round(requested)),
    );
}

/** Calcule le facteur de rendement mensuel réel des actifs investissables pendant la retraite (R2.3). */
export function computeRetirementRealReturnFactor(
    finGrowth: number,
    finBase: number,
    currentInflationPct: number,
): number {
    if (!Number.isFinite(finBase) || finBase <= 1 || !Number.isFinite(finGrowth)) {
        return 1;
    }
    const nomR = Math.max(-0.5, Math.min(0.5, finGrowth / finBase));
    const safeInf = Number.isFinite(currentInflationPct) ? currentInflationPct : 0;
    const infFactor = Math.pow(Math.max(1e-6, 1 + safeInf / 100), 1 / 12);
    const real = (1 + nomR) / Math.max(1e-6, infFactor);
    return Number.isFinite(real) ? Math.max(0.25, Math.min(1.75, real)) : 1;
}

/**
 * Calcule le pouvoir d'achat mensuel net réel soutenable (CAD constants) pour une trajectoire (R2.3).
 * Retourne null si aucun mois de retraite n'a été évalué (strict no-fake-data).
 */
export function computeSustainableMonthlyNetReal(input: {
    retirementMonthsEvaluated: number;
    retFundedRealSum: number;
    retAnnuityFvFactor: number;
    grossFinancial: number;
    financialDebtsAndUnsettled: number;
    finTaxable: number;
    totalEstateLiquidation: number;
    totalEstateTax: number;
    cumCpiFactor: number;
    lifeExpectancy?: number;
    effectiveRetirementAge: number;
}): number | null {
    if (input.retirementMonthsEvaluated <= 0) return null;
    const lifeExp = Number.isFinite(input.lifeExpectancy) && (input.lifeExpectancy as number) > 0
        ? (input.lifeExpectancy as number)
        : DEFAULT_LIFE_EXPECTANCY;
    const plannedRetMonths = Math.max(
        input.retirementMonthsEvaluated,
        Math.round(Math.max(0, lifeExp - input.effectiveRetirementAge) * 12),
    );
    const remainingPlanned = Math.max(0, plannedRetMonths - input.retirementMonthsEvaluated);
    const effectiveFvDenom = Math.max(
        input.retAnnuityFvFactor + remainingPlanned,
        plannedRetMonths,
        1,
    );
    const financialLatentTax = input.totalEstateLiquidation > 0
        ? Math.max(0, input.totalEstateTax) * Math.min(1, Math.max(0, input.finTaxable) / input.totalEstateLiquidation)
        : 0;
    const terminalSurplusNominal = Math.max(
        0,
        input.grossFinancial - input.financialDebtsAndUnsettled - financialLatentTax,
    );
    const terminalSurplusReal = terminalSurplusNominal / Math.max(1e-9, input.cumCpiFactor);
    const val = (input.retFundedRealSum / input.retirementMonthsEvaluated)
        + (terminalSurplusReal / effectiveFvDenom);
    return Number.isFinite(val) ? Math.max(0, val) : null;
}

// ── Merging T-Digest par mois (mémoire bornée en tableaux typés) ─────────────

function scaleK1(q: number): number {
    const clamped = Math.max(-1, Math.min(1, 2 * q - 1));
    return (TDIGEST_DELTA / Math.PI) * Math.asin(clamped);
}

/** Pool de T-Digests mensuels adossés à des tableaux typés plats (zéro allocation par trajectoire). */
export class MonthlyTDigestPool {
    readonly nMonths: number;
    private readonly stride = TDIGEST_BUFFER_CAP;
    private readonly means: Float64Array;
    private readonly weights: Uint32Array;
    private readonly exactFlags: Uint8Array;
    private readonly counts: Uint16Array;
    private readonly totals: Uint32Array;
    private readonly scratchOrder: Uint16Array;
    private readonly scratchMeans: Float64Array;
    private readonly scratchWeights: Uint32Array;
    private readonly scratchExact: Uint8Array;

    constructor(nMonths: number) {
        this.nMonths = Math.max(0, Math.floor(nMonths));
        const len = this.nMonths + 1;
        this.means = new Float64Array(len * this.stride);
        this.weights = new Uint32Array(len * this.stride);
        this.exactFlags = new Uint8Array(len * this.stride);
        this.counts = new Uint16Array(len);
        this.totals = new Uint32Array(len);
        this.scratchOrder = new Uint16Array(this.stride);
        this.scratchMeans = new Float64Array(this.stride);
        this.scratchWeights = new Uint32Array(this.stride);
        this.scratchExact = new Uint8Array(this.stride);
    }

    add(monthIndex: number, value: number): void {
        if (monthIndex < 0 || monthIndex > this.nMonths) return;
        const v = Number.isFinite(value) ? value : 0;
        let c = this.counts[monthIndex];
        if (c >= this.stride) {
            this.compressMonth(monthIndex);
            c = this.counts[monthIndex];
            // Garde défensive : en théorie c < stride après compression, mais on protège l'écriture
            if (c >= this.stride) {
                const lastIdx = monthIndex * this.stride + c - 1;
                if (this.means[lastIdx] === v) {
                    this.weights[lastIdx] += 1;
                } else {
                    this.means[lastIdx] = (this.means[lastIdx] * this.weights[lastIdx] + v) / (this.weights[lastIdx] + 1);
                    this.weights[lastIdx] += 1;
                    this.exactFlags[lastIdx] = 0;
                }
                this.totals[monthIndex] += 1;
                return;
            }
        }
        const offset = monthIndex * this.stride + c;
        this.means[offset] = v;
        this.weights[offset] = 1;
        this.exactFlags[offset] = 1;
        this.counts[monthIndex] = c + 1;
        this.totals[monthIndex] += 1;
    }

    private runCompressPass(
        base: number,
        c: number,
        W: number,
        minProtectWeight: number,
        dkScale: number,
    ): number {
        const order = this.scratchOrder;
        const tmpMeans = this.scratchMeans;
        const tmpWeights = this.scratchWeights;
        const tmpExact = this.scratchExact;

        for (let i = 0; i < c; i++) {
            order[i] = i;
        }
        // Tri par insertion sur les indices (moyenne croissante, puis exact=1 avant exact=0)
        for (let i = 1; i < c; i++) {
            const key = order[i];
            const keyMean = tmpMeans[key];
            const keyExact = tmpExact[key];
            let j = i - 1;
            while (
                j >= 0
                && (tmpMeans[order[j]] > keyMean
                    || (tmpMeans[order[j]] === keyMean && tmpExact[order[j]] < keyExact))
            ) {
                order[j + 1] = order[j];
                j--;
            }
            order[j + 1] = key;
        }

        let outIdx = 0;
        let weightSoFar = 0;
        let cMean = tmpMeans[order[0]];
        let cWeight = tmpWeights[order[0]];
        let cExact = tmpExact[order[0]];

        for (let i = 1; i < c; i++) {
            const idx = order[i];
            const mi = tmpMeans[idx];
            const wi = tmpWeights[idx];
            const ei = tmpExact[idx];

            if (mi === cMean && cExact === ei) {
                // Coalescence sans perte des masses identiques (ex. 96 % de 0 exact)
                cWeight += wi;
                continue;
            }

            const proposedWeight = cWeight + wi;
            const dk = scaleK1((weightSoFar + proposedWeight) / W) - scaleK1(weightSoFar / W);
            const isProtected = (cExact === 1 && cWeight >= minProtectWeight)
                || (ei === 1 && wi >= minProtectWeight);

            if (!isProtected && dk <= dkScale) {
                cMean = cMean + ((mi - cMean) * wi) / proposedWeight;
                cWeight = proposedWeight;
                cExact = 0;
            } else {
                this.means[base + outIdx] = cMean;
                this.weights[base + outIdx] = cWeight;
                this.exactFlags[base + outIdx] = cExact;
                outIdx++;
                weightSoFar += cWeight;
                cMean = mi;
                cWeight = wi;
                cExact = ei;
            }
        }
        this.means[base + outIdx] = cMean;
        this.weights[base + outIdx] = cWeight;
        this.exactFlags[base + outIdx] = cExact;
        outIdx++;
        return outIdx;
    }

    compressMonth(monthIndex: number): void {
        const c = this.counts[monthIndex];
        const W = this.totals[monthIndex];
        if (c <= 1 || W === 0) return;

        const base = monthIndex * this.stride;
        for (let i = 0; i < c; i++) {
            this.scratchMeans[i] = this.means[base + i];
            this.scratchWeights[i] = this.weights[base + i];
            this.scratchExact[i] = this.exactFlags[base + i];
        }

        // Passe 1 : protège toute masse ponctuelle exacte de poids >= 2
        let outIdx = this.runCompressPass(base, c, W, 2, 1);

        // Si le budget de centroïdes force une réduction, on ne relâche d'abord que les petites masses (< 0,5 % de W)
        const maxBudget = this.stride - 16;
        if (outIdx > maxBudget) {
            for (let i = 0; i < outIdx; i++) {
                this.scratchMeans[i] = this.means[base + i];
                this.scratchWeights[i] = this.weights[base + i];
                this.scratchExact[i] = this.exactFlags[base + i];
            }
            const bigMassThreshold = Math.max(4, Math.floor(W * 0.005));
            outIdx = this.runCompressPass(base, outIdx, W, bigMassThreshold, 1);
        }

        // Ultime repli si plus de 484 masses distinctes dépassent toutes le seuil
        let dkScale = 1.5;
        while (outIdx >= this.stride) {
            for (let i = 0; i < outIdx; i++) {
                this.scratchMeans[i] = this.means[base + i];
                this.scratchWeights[i] = this.weights[base + i];
                this.scratchExact[i] = this.exactFlags[base + i];
            }
            outIdx = this.runCompressPass(base, outIdx, W, Number.POSITIVE_INFINITY, dkScale);
            dkScale *= 2;
        }

        this.counts[monthIndex] = outIdx;
    }

    exportCompact(): CompactMonthlyQuantileShard {
        const len = this.nMonths + 1;
        let totalCentroids = 0;
        for (let m = 0; m < len; m++) {
            this.compressMonth(m);
            totalCentroids += this.counts[m];
        }
        const counts = new Uint16Array(len);
        const means = new Float64Array(totalCentroids);
        const weights = new Uint32Array(totalCentroids);
        const exactFlags = new Uint8Array(totalCentroids);

        let writePtr = 0;
        for (let m = 0; m < len; m++) {
            const c = this.counts[m];
            counts[m] = c;
            const base = m * this.stride;
            for (let i = 0; i < c; i++) {
                means[writePtr] = this.means[base + i];
                weights[writePtr] = this.weights[base + i];
                exactFlags[writePtr] = this.exactFlags[base + i];
                writePtr++;
            }
        }
        return { nMonths: this.nMonths, counts, means, weights, exactFlags };
    }
}

function evaluateQuantilesFromSortedCentroids(
    means: Float64Array,
    weights: Uint32Array,
    exactFlags: Uint8Array,
    count: number,
    quantiles: readonly number[],
): number[] {
    if (count === 0) return quantiles.map(() => 0);
    if (count === 1) {
        const v = round2(means[0]);
        return quantiles.map(() => v);
    }

    let totalWeight = 0;
    for (let i = 0; i < count; i++) totalWeight += weights[i];
    if (totalWeight <= 0) return quantiles.map(() => 0);

    const out: number[] = new Array(quantiles.length);
    for (let qi = 0; qi < quantiles.length; qi++) {
        const q = quantiles[qi];
        const targetRank = q * totalWeight;
        const firstRight = exactFlags[0] === 1 ? weights[0] : weights[0] * 0.5;
        if (targetRank <= firstRight) {
            out[qi] = means[0];
            continue;
        }
        const lastLeft = exactFlags[count - 1] === 1
            ? totalWeight - weights[count - 1]
            : totalWeight - weights[count - 1] * 0.5;
        if (targetRank >= lastLeft) {
            out[qi] = means[count - 1];
            continue;
        }

        let cum = 0;
        let resolved = means[count - 1];
        for (let i = 0; i < count; i++) {
            const wi = weights[i];
            const end = cum + wi;
            // Si le rang cible tombe dans une masse ponctuelle exacte [cum, end], on retourne sa valeur exacte sans étalement
            if (exactFlags[i] === 1 && targetRank <= end) {
                resolved = means[i];
                break;
            }
            if (i < count - 1) {
                const rAnchor = exactFlags[i] === 1 ? end : cum + wi * 0.5;
                const lNext = exactFlags[i + 1] === 1 ? end : end + weights[i + 1] * 0.5;
                if (targetRank <= lNext) {
                    const span = lNext - rAnchor;
                    const t = span > 0 ? (targetRank - rAnchor) / span : 0;
                    resolved = means[i] + t * (means[i + 1] - means[i]);
                    break;
                }
            }
            cum = end;
        }
        out[qi] = resolved;
    }

    for (let i = 0; i < out.length; i++) {
        out[i] = round2(out[i]);
        if (i > 0 && out[i] < out[i - 1]) out[i] = out[i - 1];
    }
    return out;
}

// ── Pré-classification des objectifs financiers ──────────────────────────────

interface ClassifiedGoal {
    goalKey: string;
    goalId: string;
    name: string;
    deadline: string;
    targetAmount: number;
    status: GoalProbabilityResult['status'];
    monthOffset: number;
}

export function classifyFinancialGoals(
    financialGoals: readonly FinancialGoal[] | undefined,
    startYear: number,
    startMonth: number,
    nMonths: number,
): ClassifiedGoal[] {
    if (!financialGoals || financialGoals.length === 0) return [];
    const out: ClassifiedGoal[] = [];

    for (let i = 0; i < financialGoals.length; i++) {
        const g = financialGoals[i];
        if (!g || g.status === 'archived') continue;
        const goalKey = `__idx_${i}`;
        const goalId = g.id || `goal-${i}`;
        const name = g.name || 'Objectif';
        const deadline = typeof g.deadline === 'string' ? g.deadline.trim() : '';
        const targetAmount = Number.isFinite(g.targetAmount) ? g.targetAmount : 0;

        if (
            g.completed === true
            || (g.type !== 'NET_WORTH' && targetAmount > 0 && Number.isFinite(g.manualCurrentAmount) && (g.manualCurrentAmount as number) >= targetAmount)
        ) {
            out.push({ goalKey, goalId, name, deadline, targetAmount, status: 'already_completed', monthOffset: 0 });
            continue;
        }

        const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(deadline.trim());
        if (!match || targetAmount <= 0) {
            out.push({ goalKey, goalId, name, deadline, targetAmount, status: 'invalid_deadline', monthOffset: -1 });
            continue;
        }
        const year = Number(match[1]);
        const month = Number(match[2]);
        if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
            out.push({ goalKey, goalId, name, deadline, targetAmount, status: 'invalid_deadline', monthOffset: -1 });
            continue;
        }

        const offset = (year - startYear) * 12 + (month - 1 - startMonth);
        if (offset < 0 || offset > nMonths) {
            out.push({ goalKey, goalId, name, deadline, targetAmount, status: 'beyond_horizon', monthOffset: offset });
            continue;
        }

        out.push({ goalKey, goalId, name, deadline, targetAmount, status: 'evaluated', monthOffset: offset });
    }
    return out;
}

function recordBoundedShortfall(
    shortfalls: number[],
    failCountSoFar: number,
    shortfallValue: number,
    cap: number,
): void {
    const clean = Number.isFinite(shortfallValue) ? Math.max(0, shortfallValue) : 0;
    if (shortfalls.length < cap) {
        shortfalls.push(clean);
        return;
    }
    // Échantillonnage déterministe de réservoir (Knuth R) avec mix Murmur3 32 bits complet
    let h = (failCountSoFar ^ 0x9e3779b9) >>> 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    const slot = (h >>> 0) % failCountSoFar;
    if (slot < cap) {
        shortfalls[slot] = clean;
    }
}

// ── Exécution d'un shard ─────────────────────────────────────────────────────

export interface GrandCalculStrategyContext {
    effectiveParams: SimulationParams;
    strategy: AllocationStrategy;
    delayPensions: boolean;
    scenarioType: FutureScenarioType;
    overrides: EngineOverrides;
}

export function runGrandCalculShardWithRunner(
    runScenario: GrandCalculRunScenarioFn,
    params: SimulationParams,
    config: GrandCalculConfig,
    startIter: number,
    count: number,
    onProgress?: (done: number, total: number) => void,
    strategyCtx?: GrandCalculStrategyContext,
): GrandCalculShardResult {
    const effectiveCount = Math.max(0, Math.min(GRAND_CALCUL_ITERATIONS_MAX, Math.floor(count)));
    const effectiveParams = strategyCtx?.effectiveParams ?? params;
    const strategy: AllocationStrategy = strategyCtx?.strategy ?? 'AUTO_MARGINAL';
    const delayPensions = strategyCtx?.delayPensions ?? false;
    const scenarioType: FutureScenarioType = strategyCtx?.scenarioType ?? 'BASE';
    const overrides: EngineOverrides = strategyCtx?.overrides ?? {};

    const nMonths = Math.max(0, (effectiveParams.projection?.years ?? 0) * 12);
    const startYear = effectiveParams.startYear;
    const startMonth = effectiveParams.startMonth ?? 0;
    const currentAge = effectiveParams.config?.users?.[0]?.age || 30;
    const horizonAge = currentAge + (effectiveParams.projection?.years ?? 0);

    const classifiedGoals = classifyFinancialGoals(
        effectiveParams.financialGoals,
        startYear,
        startMonth,
        nMonths,
    );
    const goalResults: GrandCalculShardResult['goalResults'] = {};
    for (const g of classifiedGoals) {
        goalResults[g.goalKey] = { metCount: 0, failCount: 0, shortfalls: [], status: g.status };
    }

    const digestPool = new MonthlyTDigestPool(nMonths);
    const fiReachedAges = new Float32Array(effectiveCount);
    const sustainableMonthlyNetReal = new Float32Array(effectiveCount);
    const estateTotals = new Float32Array(effectiveCount);
    const estateFeds = new Float32Array(effectiveCount);
    const estateQcs = new Float32Array(effectiveCount);
    const estateRealTotals = new Float32Array(effectiveCount);
    const finalNetWorths = new Float32Array(effectiveCount);
    const deathAges = new Float32Array(effectiveCount);

    const seedOffset = Number.isFinite(config.seed) ? Math.trunc(config.seed as number) : 0;
    const macroConfig: MacroRegimeRunConfig = {
        enableMacroRegimes: Boolean(config.enableMacroRegimes),
        includeHistoricalCrises: Boolean(config.includeHistoricalCrises),
        seed: config.seed,
    };

    let ruinedCount = 0;
    let retirementMonthsTotal = 0;
    let fireTargetValid = true;
    const progressStep = Math.max(25, Math.min(250, Math.floor(effectiveCount / 50) || 1));

    onProgress?.(0, effectiveCount);

    for (let i = 0; i < effectiveCount; i++) {
        if (i > 0 && i % progressStep === 0) {
            onProgress?.(i, effectiveCount);
        }
        const mcIterIndex = startIter + i + seedOffset;
        const res = runScenario(
            effectiveParams,
            strategy,
            true,
            delayPensions,
            mcIterIndex,
            scenarioType,
            overrides,
            macroConfig,
        );

        if (res.netWorthSeries) {
            const len = res.netWorthSeriesLen ?? res.netWorthSeries.length;
            const series = res.netWorthSeries;
            for (let m = 0; m <= nMonths; m++) {
                digestPool.add(m, m < len ? series[m] : 0);
            }
        } else {
            const len = res.chartData.length;
            for (let m = 0; m <= nMonths; m++) {
                const nw = m < len ? res.chartData[m].NetWorth : 0;
                digestPool.add(m, nw);
            }
        }

        const finalNW = Number.isFinite(res.finalNetWorth) ? res.finalNetWorth : 0;
        finalNetWorths[i] = finalNW;
        if (finalNW <= 0) ruinedCount++;

        if ((res.fireNumber ?? 0) <= 0) fireTargetValid = false;
        fiReachedAges[i] = res.firstFireAge !== null && res.firstFireAge !== undefined && Number.isFinite(res.firstFireAge)
            ? res.firstFireAge
            : Number.NaN;

        const retMonths = res.retirementMonthsEvaluated ?? 0;
        retirementMonthsTotal += retMonths;
        sustainableMonthlyNetReal[i] = res.sustainableMonthlyNetReal !== null
            && res.sustainableMonthlyNetReal !== undefined
            && Number.isFinite(res.sustainableMonthlyNetReal)
            ? res.sustainableMonthlyNetReal
            : Number.NaN;

        const estTotal = Number.isFinite(res.totalEstateTax) ? (res.totalEstateTax as number) : Number.NaN;
        estateTotals[i] = estTotal;
        estateFeds[i] = res.fedEstateTax !== null && res.fedEstateTax !== undefined && Number.isFinite(res.fedEstateTax)
            ? res.fedEstateTax
            : Number.NaN;
        estateQcs[i] = res.qcEstateTax !== null && res.qcEstateTax !== undefined && Number.isFinite(res.qcEstateTax)
            ? res.qcEstateTax
            : Number.NaN;
        const cpiEnd = Math.max(1e-9, res.cumCpiFactorAtEnd ?? 1);
        estateRealTotals[i] = Number.isFinite(estTotal) ? estTotal / cpiEnd : Number.NaN;
        deathAges[i] = Number.isFinite(res.projectedDeathAge) ? (res.projectedDeathAge as number) : horizonAge;

        for (const g of classifiedGoals) {
            if (g.status !== 'evaluated') continue;
            const slot = goalResults[g.goalKey];
            const outcome = res.goalOutcomes?.[g.goalKey];
            if (outcome?.met) {
                slot.metCount += 1;
            } else {
                const nextFail = (slot.failCount ?? 0) + 1;
                slot.failCount = nextFail;
                const sf = outcome ? outcome.shortfallReal : g.targetAmount;
                recordBoundedShortfall(slot.shortfalls, nextFail, sf, MAX_GOAL_SHORTFALL_SAMPLES);
            }
        }
    }

    onProgress?.(effectiveCount, effectiveCount);

    return {
        iterationsDone: effectiveCount,
        ruinedCount,
        monthlyHistogramsOrSamples: digestPool.exportCompact(),
        fiReachedAges,
        goalResults,
        sustainableMonthlyNetReal,
        estateTotals,
        estateFeds,
        estateQcs,
        estateRealTotals,
        finalNetWorths,
        deathAges,
        fireTargetValid,
        horizonAge,
        retirementMonthsTotal,
    };
}

// ── Fusion des shards ────────────────────────────────────────────────────────

export interface MergeGrandCalculMeta {
    paramsSig: string;
    createdAt?: string;
    durationMs: number;
    regimesEnabled: boolean;
    historicalCrisesEnabled: boolean;
    startYear: number;
    startMonth?: number;
    currentAge: number;
    nMonths?: number;
    financialGoals?: readonly FinancialGoal[];
    deterministicEstate?: {
        total: number | null;
        fed: number | null;
        qc: number | null;
        taxableBreakdown: {
            rrspRrif: number | null;
            capitalGainsTaxable: number | null;
            rentalRecapture: number | null;
        };
        projectedDeathAge: number | null;
    };
}

function collectFiniteFloat32(
    arrays: ReadonlyArray<Float32Array | number[] | undefined>,
    requireNonNegative = false,
): Float32Array {
    let count = 0;
    for (const arr of arrays) {
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (Number.isFinite(v) && (!requireNonNegative || v >= 0)) count++;
        }
    }
    const out = new Float32Array(count);
    let ptr = 0;
    for (const arr of arrays) {
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
            const v = arr[i];
            if (Number.isFinite(v) && (!requireNonNegative || v >= 0)) out[ptr++] = v;
        }
    }
    return out;
}

function float32Quantile(sorted: Float32Array, q: number): number {
    const n = sorted.length;
    if (n === 0) return 0;
    const idx = Math.min(n - 1, Math.max(0, Math.floor(q * n)));
    return sorted[idx];
}

function computeCvar95FromFloat32(sorted: Float32Array): number | null {
    const n = sorted.length;
    if (n === 0) return null;
    const p5 = float32Quantile(sorted, 0.05);
    const count5pct = Math.max(1, Math.floor(0.05 * n));
    let sum = 0;
    for (let i = 0; i < count5pct; i++) sum += sorted[i];
    return round2(Math.min(p5, sum / count5pct));
}

function buildMonthlyBandsFromShards(
    shards: readonly GrandCalculShardResult[],
    startYear: number,
    startMonth: number,
    currentAge: number,
    nMonths: number,
): GrandCalculMonthlyBand[] {
    if (shards.length === 0) return [];

    // Pré-calcul des curseurs d'offset par shard pour lecture O(1) par mois
    const ptrs = new Int32Array(shards.length);
    let maxCentroidsPerMonth = 0;
    for (let m = 0; m <= nMonths; m++) {
        let mSum = 0;
        for (let s = 0; s < shards.length; s++) {
            mSum += shards[s].monthlyHistogramsOrSamples.counts[m] ?? 0;
        }
        if (mSum > maxCentroidsPerMonth) maxCentroidsPerMonth = mSum;
    }

    const bufMeans = new Float64Array(Math.max(1, maxCentroidsPerMonth));
    const bufWeights = new Uint32Array(Math.max(1, maxCentroidsPerMonth));
    const bufExact = new Uint8Array(Math.max(1, maxCentroidsPerMonth));
    const outMeans = new Float64Array(Math.max(1, maxCentroidsPerMonth));
    const outWeights = new Uint32Array(Math.max(1, maxCentroidsPerMonth));
    const outExact = new Uint8Array(Math.max(1, maxCentroidsPerMonth));
    const order = new Uint32Array(Math.max(1, maxCentroidsPerMonth));

    const bands: GrandCalculMonthlyBand[] = new Array(nMonths + 1);

    for (let m = 0; m <= nMonths; m++) {
        let total = 0;
        for (let s = 0; s < shards.length; s++) {
            const digest = shards[s].monthlyHistogramsOrSamples;
            const c = digest.counts[m] ?? 0;
            const base = ptrs[s];
            for (let i = 0; i < c; i++) {
                const meanRaw = digest.means[base + i];
                const weightRaw = digest.weights[base + i];
                // Garde contre tout shard corrompu (NaN/Infinity ou poids nul)
                if (!Number.isFinite(meanRaw) || !Number.isFinite(weightRaw) || weightRaw <= 0) {
                    continue;
                }
                bufMeans[total] = meanRaw;
                bufWeights[total] = weightRaw;
                bufExact[total] = digest.exactFlags ? (digest.exactFlags[base + i] ? 1 : 0) : (weightRaw === 1 ? 1 : 0);
                order[total] = total;
                total++;
            }
            ptrs[s] = base + c;
        }

        // Trie les indices des centroïdes fusionnés par moyenne croissante (puis exact=1 en premier)
        const orderSlice = order.subarray(0, total);
        orderSlice.sort((a, b) => (bufMeans[a] - bufMeans[b]) || (bufExact[b] - bufExact[a]));

        // Fusionne les centroïdes de moyenne et exactitude identiques (préserve les masses ponctuelles exactes)
        let uniqueCount = 0;
        for (let i = 0; i < total; i++) {
            const idx = orderSlice[i];
            const meanVal = bufMeans[idx];
            const weightVal = bufWeights[idx];
            const exactVal = bufExact[idx];
            if (uniqueCount > 0 && outMeans[uniqueCount - 1] === meanVal && outExact[uniqueCount - 1] === exactVal) {
                outWeights[uniqueCount - 1] += weightVal;
            } else {
                outMeans[uniqueCount] = meanVal;
                outWeights[uniqueCount] = weightVal;
                outExact[uniqueCount] = exactVal;
                uniqueCount++;
            }
        }

        const [p5, p10, p25, p50, p75, p90, p95] = evaluateQuantilesFromSortedCentroids(
            outMeans,
            outWeights,
            outExact,
            uniqueCount,
            BAND_QUANTILES,
        );

        bands[m] = {
            monthIndex: m,
            year: startYear + Math.floor((startMonth + m) / 12),
            age: currentAge + Math.floor(m / 12),
            p5,
            p10,
            p25,
            p50,
            p75,
            p90,
            p95,
        };
    }

    return bands;
}

/** Agrège plusieurs shards Grand Calcul en un GrandCalculResult consolidé. */
export function mergeGrandCalculShards(
    shards: readonly GrandCalculShardResult[],
    meta: MergeGrandCalculMeta,
): GrandCalculResult {
    const startMonth = meta.startMonth ?? 0;
    let totalIterations = 0;
    let totalRuined = 0;
    let totalRetMonths = 0;
    let fireTargetValid = true;
    let horizonAge = meta.currentAge;

    for (const s of shards) {
        totalIterations += s.iterationsDone;
        totalRuined += s.ruinedCount;
        totalRetMonths += s.retirementMonthsTotal ?? 0;
        if (s.fireTargetValid === false) fireTargetValid = false;
        if (s.horizonAge !== undefined && Number.isFinite(s.horizonAge)) {
            horizonAge = s.horizonAge;
        }
    }

    const nMonths = meta.nMonths ?? (shards[0]?.monthlyHistogramsOrSamples?.nMonths ?? 0);
    if (meta.nMonths === undefined && shards.length > 0) {
        horizonAge = shards[0].horizonAge ?? (meta.currentAge + Math.round(nMonths / 12));
    } else if (shards.length === 0) {
        horizonAge = meta.currentAge + Math.round(nMonths / 12);
    }

    if (shards.length === 0 || totalIterations === 0) {
        return {
            version: 1,
            paramsSig: meta.paramsSig,
            createdAt: meta.createdAt ?? new Date().toISOString(),
            durationMs: Math.max(0, meta.durationMs),
            iterationsRun: 0,
            regimesEnabled: meta.regimesEnabled,
            historicalCrisesEnabled: meta.historicalCrisesEnabled,
            survivalRatePct: null,
            cvar95: null,
            monthlyBands: [],
            fiAge: {
                reachedPct: null,
                p5Age: null,
                p50Age: null,
                p95Age: null,
                horizonAge,
            },
            goalProbabilities: [],
            guaranteedPurchasingPower: {
                p95SecurityMonthlyNetReal: null,
                p90SecurityMonthlyNetReal: null,
                p50SecurityMonthlyNetReal: null,
                retirementMonthsEvaluated: 0,
            },
            estateTax: {
                deterministicTotal: meta.deterministicEstate?.total ?? null,
                deterministicFed: meta.deterministicEstate?.fed ?? null,
                deterministicQc: meta.deterministicEstate?.qc ?? null,
                mcTotalP5: null,
                mcTotalP50: null,
                mcTotalP95: null,
                mcFedP50: null,
                mcQcP50: null,
                mcRealTotalP50: null,
                taxableBreakdown: meta.deterministicEstate?.taxableBreakdown ?? {
                    rrspRrif: null,
                    capitalGainsTaxable: null,
                    rentalRecapture: null,
                },
                projectedDeathAge: meta.deterministicEstate?.projectedDeathAge ?? null,
            },
        };
    }

    const monthlyBands = buildMonthlyBandsFromShards(shards, meta.startYear, startMonth, meta.currentAge, nMonths);
    const survivalRatePct = round2(((totalIterations - totalRuined) / totalIterations) * 100);

    // CVaR95 exact depuis finalNetWorths (ou repli sur dernier mois P5 si shards synthétiques sans finalNetWorths)
    const finalNwFlat = collectFiniteFloat32(shards.map((s) => s.finalNetWorths));
    let cvar95: number | null = null;
    if (finalNwFlat.length > 0) {
        finalNwFlat.sort();
        cvar95 = computeCvar95FromFloat32(finalNwFlat);
    } else if (monthlyBands.length > 0) {
        cvar95 = monthlyBands[monthlyBands.length - 1].p5;
    }

    // R2.1 — Distribution censurée à droite de l'âge d'atteinte FI
    let fiAge: FiAgeDistribution;
    if (!fireTargetValid) {
        fiAge = { reachedPct: null, p5Age: null, p50Age: null, p95Age: null, horizonAge };
    } else {
        const finiteFi = collectFiniteFloat32(shards.map((s) => s.fiReachedAges));
        const reachedCount = finiteFi.length;
        const reachedPct = round2((reachedCount / totalIterations) * 100);
        finiteFi.sort();

        const censoredAge = (thresholdPct: number): number | null => {
            if (reachedCount === 0 || (reachedCount * 100) < (thresholdPct * totalIterations)) return null;
            const idx = Math.min(reachedCount - 1, Math.max(0, Math.floor((thresholdPct / 100) * totalIterations)));
            return round2(finiteFi[idx]);
        };

        fiAge = {
            reachedPct,
            p5Age: censoredAge(5),
            p50Age: censoredAge(50),
            p95Age: censoredAge(95),
            horizonAge,
        };
    }

    // R2.2 — Probabilités datées par objectif financier
    const goalProbabilities: GoalProbabilityResult[] = [];
    const goalDefs = meta.financialGoals
        ? classifyFinancialGoals(meta.financialGoals, meta.startYear, startMonth, nMonths)
        : Object.keys(shards[0].goalResults ?? {}).map((key) => ({
            goalKey: key,
            goalId: key,
            name: key,
            deadline: '',
            targetAmount: 0,
            status: shards[0].goalResults[key].status,
            monthOffset: 0,
        }));

    for (const g of goalDefs) {
        const firstStatus = shards[0].goalResults?.[g.goalKey]?.status ?? g.status;
        if (firstStatus === 'already_completed') {
            goalProbabilities.push({
                goalId: g.goalId,
                name: g.name,
                deadline: g.deadline,
                targetAmount: g.targetAmount,
                probabilityPct: 100,
                medianShortfall: 0,
                status: 'already_completed',
            });
            continue;
        }
        if (firstStatus === 'beyond_horizon' || firstStatus === 'invalid_deadline') {
            goalProbabilities.push({
                goalId: g.goalId,
                name: g.name,
                deadline: g.deadline,
                targetAmount: g.targetAmount,
                probabilityPct: null,
                medianShortfall: null,
                status: firstStatus,
            });
            continue;
        }

        let metSum = 0;
        let totalFailWeight = 0;
        const weightedShortfalls: Array<{ value: number; weight: number }> = [];
        for (const s of shards) {
            const gr = s.goalResults?.[g.goalKey];
            if (!gr) continue;
            metSum += gr.metCount;
            const len = gr.shortfalls.length;
            if (len > 0) {
                const shardFailCount = gr.failCount !== undefined && gr.failCount > 0
                    ? gr.failCount
                    : Math.max(len, s.iterationsDone - gr.metCount);
                const sampleWeight = shardFailCount / len;
                totalFailWeight += shardFailCount;
                for (let k = 0; k < len; k++) {
                    weightedShortfalls.push({ value: gr.shortfalls[k], weight: sampleWeight });
                }
            }
        }
        const probabilityPct = round2((metSum / totalIterations) * 100);
        let medianShortfall = 0;
        if (weightedShortfalls.length > 0 && totalFailWeight > 0 && metSum < totalIterations) {
            weightedShortfalls.sort((a, b) => a.value - b.value);
            const halfWeight = totalFailWeight * 0.5;
            let cumWeight = 0;
            medianShortfall = round2(weightedShortfalls[weightedShortfalls.length - 1].value);
            for (let k = 0; k < weightedShortfalls.length; k++) {
                cumWeight += weightedShortfalls[k].weight;
                if (cumWeight > halfWeight) {
                    medianShortfall = round2(weightedShortfalls[k].value);
                    break;
                }
            }
        }
        goalProbabilities.push({
            goalId: g.goalId,
            name: g.name,
            deadline: g.deadline,
            targetAmount: g.targetAmount,
            probabilityPct,
            medianShortfall,
            status: 'evaluated',
        });
    }

    // R2.3 — Pouvoir d'achat réel mensuel net garanti (P95, P90, P50)
    const validPurch = collectFiniteFloat32(shards.map((s) => s.sustainableMonthlyNetReal), true);
    let guaranteedPurchasingPower: GuaranteedPurchasingPower;
    if (validPurch.length === 0) {
        guaranteedPurchasingPower = {
            p95SecurityMonthlyNetReal: null,
            p90SecurityMonthlyNetReal: null,
            p50SecurityMonthlyNetReal: null,
            retirementMonthsEvaluated: 0,
        };
    } else {
        validPurch.sort();
        const avgRetMonths = totalRetMonths > 0
            ? Math.max(1, Math.round(totalRetMonths / validPurch.length))
            : 1;
        guaranteedPurchasingPower = {
            p95SecurityMonthlyNetReal: round2(float32Quantile(validPurch, 0.05)),
            p90SecurityMonthlyNetReal: round2(float32Quantile(validPurch, 0.10)),
            p50SecurityMonthlyNetReal: round2(float32Quantile(validPurch, 0.50)),
            retirementMonthsEvaluated: avgRetMonths,
        };
    }

    // R2.4 — Impôt successoral latent (ARC & RQ)
    const estateTotalsFlat = collectFiniteFloat32(shards.map((s) => s.estateTotals), true);
    const estateFedsFlat = collectFiniteFloat32(shards.map((s) => s.estateFeds), true);
    const estateQcsFlat = collectFiniteFloat32(shards.map((s) => s.estateQcs), true);
    const estateRealFlat = collectFiniteFloat32(shards.map((s) => s.estateRealTotals), true);
    const deathAgesFlat = collectFiniteFloat32(shards.map((s) => s.deathAges), true);

    estateTotalsFlat.sort();
    estateFedsFlat.sort();
    estateQcsFlat.sort();
    estateRealFlat.sort();
    deathAgesFlat.sort();

    const estateTax: EstateTaxSummary = {
        deterministicTotal: meta.deterministicEstate?.total ?? null,
        deterministicFed: meta.deterministicEstate?.fed ?? null,
        deterministicQc: meta.deterministicEstate?.qc ?? null,
        mcTotalP5: estateTotalsFlat.length > 0 ? round2(float32Quantile(estateTotalsFlat, 0.05)) : null,
        mcTotalP50: estateTotalsFlat.length > 0 ? round2(float32Quantile(estateTotalsFlat, 0.50)) : null,
        mcTotalP95: estateTotalsFlat.length > 0 ? round2(float32Quantile(estateTotalsFlat, 0.95)) : null,
        mcFedP50: estateFedsFlat.length > 0 ? round2(float32Quantile(estateFedsFlat, 0.50)) : null,
        mcQcP50: estateQcsFlat.length > 0 ? round2(float32Quantile(estateQcsFlat, 0.50)) : null,
        mcRealTotalP50: estateRealFlat.length > 0 ? round2(float32Quantile(estateRealFlat, 0.50)) : null,
        taxableBreakdown: meta.deterministicEstate?.taxableBreakdown ?? {
            rrspRrif: null,
            capitalGainsTaxable: null,
            rentalRecapture: null,
        },
        projectedDeathAge: deathAgesFlat.length > 0
            ? round2(float32Quantile(deathAgesFlat, 0.50))
            : (meta.deterministicEstate?.projectedDeathAge ?? null),
    };

    return {
        version: 1,
        paramsSig: meta.paramsSig,
        createdAt: meta.createdAt ?? new Date().toISOString(),
        durationMs: Math.max(0, meta.durationMs),
        iterationsRun: totalIterations,
        regimesEnabled: meta.regimesEnabled,
        historicalCrisesEnabled: meta.historicalCrisesEnabled,
        survivalRatePct,
        cvar95,
        monthlyBands,
        fiAge,
        goalProbabilities,
        guaranteedPurchasingPower,
        estateTax,
    };
}
