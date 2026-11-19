// services/projection/deepScenarioEngine.ts
// Moteur Futur 4.0 : 4 scénarios uniques (Trajectoire réelle, Prudent / Stress, Optimisé IA,
// Favorable), exploration stratégique automatique et architecture sharded 100 000+ trajectoires
// (Common Random Numbers + régimes Markov + crises historiques + sauts Merton + T-Digest borné).
//
// Module 100 % pur : zéro import store/, components/, hooks/, réseau ou Gemini.
// Compatibilité Web Worker garantie.

import { formatCAD, formatPercent } from '../../utils/format';
import {
    calculateFutureProjection,
    type AllocationStrategy,
    type ProjectionChartPoint,
    type ProjectionResult,
    type SimulationParams,
} from '../projection';
import {
    DEEP_SCENARIO_IDS,
    type DeepConcreteAction,
    type DeepForecastReport,
    type DeepGoalMilestoneSummary,
    type DeepScenarioId,
    type DeepScenarioMilestones,
    type DeepScenarioOutput,
    type DeepScenarioPoint,
    type DeepTurningPoint,
    type DeepValoriaSummary,
    type MacroAndNewsSignalBundle,
    type RealPastDiagnostic,
} from './deepForecastTypes';
import {
    classifyFinancialGoals,
    computeSustainableMonthlyNetReal,
} from './grandCalcul';
import {
    RRIF_FIRST_WITHDRAWAL_AGE,
    RRSP_TO_RRIF_CONVERSION_AGE,
    gaussianRandom,
    mulberry32,
    round2,
} from './helpers';
import {
    HISTORICAL_CRISIS_CATALOG,
    HISTORICAL_CRISIS_IDS,
    MACRO_REGIME_ORDER,
    REGIME_PARAMS,
    STATIONARY_WEIGHTS,
    TRANSITION_MATRIX,
    computeCrisisEpisodeRates,
    safeApplyShock,
    type ActiveCrisisState,
} from './macroRegimes';
import { ASSET_LOCATION_BONUS_PP } from './strategySpace';
import type { CompactMonthlyQuantileShard, MacroRegimeId } from './types';
import type { ValoriaFutureForecastResult } from './valoriaFutureEngine';

export const DEFAULT_DEEP_TRAJECTORIES = 100_000;

const DIGEST_STRIDE = 256;
const DIGEST_DELTA = 100;
const INV_12 = 1 / 12;
const DEFAULT_MERTON_LAMBDA = 0.22;
const DEFAULT_MERTON_MEAN_JUMP = -0.11;
const DEFAULT_MERTON_JUMP_VOL = 0.07;

const SCENARIO_META: Record<
    DeepScenarioId,
    { label: string; shortDescription: string }
> = {
    real_trajectory: {
        label: 'Trajectoire réelle',
        shortDescription:
            'Projection ancrée sur vos habitudes réelles observées, votre portefeuille actuel, les signaux macro/actualités et la fiscalité ARC/Revenu Québec.',
    },
    prudent_stress: {
        label: 'Prudent / Stress',
        shortDescription:
            'Scénario défensif intégrant rendements abaissés (−1,8 %/an), volatilité accrue (×1,28), inflation persistante (+0,7 %), taux hypothécaires (+1,25 %) et crises historiques.',
    },
    ai_optimized: {
        label: 'Optimisé IA',
        shortDescription:
            'Exploration automatique des meilleurs leviers fiscaux ARC/RQ (CELI/REER/fonte REER, localisation d’actifs, frais RFG) et discipline d’épargne réaliste.',
    },
    favorable_tailwinds: {
        label: 'Favorable',
        shortDescription:
            'Marchés porteurs (+1,5 %/an + catalyseurs positifs), désinflation graduelle (−0,3 %) et discipline d’épargne maintenue.',
    },
};

// ----------------------------------------------------------------------------
// Contrats de sharding zero-copy (Main Thread <-> Web Workers)
// ----------------------------------------------------------------------------

export interface DeepScenarioBaseline {
    id: DeepScenarioId;
    label: string;
    shortDescription: string;
    assumptionsSummaryFr: string;
    appliedOptimizationsFr: string[];
    nMonths: number;
    startYear: number;
    startMonth: number;
    currentAge: number;
    retirementAge: number;
    retirementMonthIndex: number;
    lifeExpectancy: number;
    baseReturnPct: number;
    baseVolatilityPct: number;
    mertonLambda: number;
    mertonMeanJump: number;
    mertonJumpVol: number;
    baseInflationPct: number;
    scenarioReturnShiftPct: number;
    scenarioVolMultiplier: number;
    scenarioInflationShiftPct: number;
    enableMacroRegimes: boolean;
    includeHistoricalCrises: boolean;
    expenseVolatilityPct: number;
    annualCreepExtraPct: number;
    detFinalNetWorth: number;
    detEstateNetWorth: number;
    detEstateTax: number;
    detTotalTaxesPaid: number;
    detPensionNpvOffset: number;
    marginalEstateTaxSensitivity: number;
    detFinAssets: number[];
    detReAndBiz: number[];
    detDebt: number[];
    detMonthlyFlow: number[];
    detExpenses: number[];
    detFireTarget: number[];
    detPensions: number[];
    detCumCpi: number[];
    rDetMonth: number[];
}

export interface DeepClassifiedGoalMeta {
    goalId: string;
    name: string;
    deadline: string;
    targetAmount: number;
    status: 'evaluated' | 'already_completed' | 'beyond_horizon' | 'invalid_deadline';
    monthOffset: number;
    isAccountBucketGoal: boolean;
}

export interface DeepShardRequest {
    baselines: Record<DeepScenarioId, DeepScenarioBaseline>;
    classifiedGoals: DeepClassifiedGoalMeta[];
    startIter: number;
    count: number;
    seed: number;
}

interface DeepScenarioShardSlice {
    ruinedCount: number;
    monthlyHistograms: CompactMonthlyQuantileShard;
    fiReachedAges: Float32Array;
    sustainableMonthlyNet: Float32Array;
    estateTotals: Float32Array;
    estateTaxes: Float32Array;
    finalNetWorths: Float32Array;
    goalMetCounts: Uint32Array;
    fireTargetValid: boolean;
    retirementMonthsTotal: number;
}

export interface DeepShardOutput {
    iterationsDone: number;
    trajectoriesDone: number;
    scenarios: Record<DeepScenarioId, DeepScenarioShardSlice>;
}

// ----------------------------------------------------------------------------
// Pool T-Digest rapide (Quicksort en place + compression K1 bornée)
// ----------------------------------------------------------------------------

function scaleK1(q: number): number {
    const clamped = Math.max(-1, Math.min(1, 2 * q - 1));
    return (DIGEST_DELTA / Math.PI) * Math.asin(clamped);
}

function quicksortCentroids(
    means: Float64Array,
    weights: Uint32Array,
    exactFlags: Uint8Array,
    lo: number,
    hi: number,
): void {
    const stackLo = new Int32Array(64);
    const stackHi = new Int32Array(64);
    let sp = 0;
    stackLo[sp] = lo;
    stackHi[sp] = hi;
    sp++;

    while (sp > 0) {
        sp--;
        const left = stackLo[sp];
        const right = stackHi[sp];
        if (left >= right) continue;

        const mid = (left + right) >>> 1;
        const pivotMean = means[mid];
        const pivotExact = exactFlags[mid];
        let i = left;
        let j = right;

        while (i <= j) {
            while (
                means[i] < pivotMean ||
                (means[i] === pivotMean && exactFlags[i] > pivotExact)
            ) {
                i++;
            }
            while (
                means[j] > pivotMean ||
                (means[j] === pivotMean && exactFlags[j] < pivotExact)
            ) {
                j--;
            }
            if (i <= j) {
                const tm = means[i];
                means[i] = means[j];
                means[j] = tm;

                const tw = weights[i];
                weights[i] = weights[j];
                weights[j] = tw;

                const te = exactFlags[i];
                exactFlags[i] = exactFlags[j];
                exactFlags[j] = te;

                i++;
                j--;
            }
        }
        if (left < j) {
            stackLo[sp] = left;
            stackHi[sp] = j;
            sp++;
        }
        if (i < right) {
            stackLo[sp] = i;
            stackHi[sp] = right;
            sp++;
        }
    }
}

class FastMonthlyDigestPool {
    readonly nMonths: number;
    private readonly stride = DIGEST_STRIDE;
    private readonly means: Float64Array;
    private readonly weights: Uint32Array;
    private readonly exactFlags: Uint8Array;
    private readonly counts: Uint16Array;
    private readonly totals: Uint32Array;

    constructor(nMonths: number) {
        this.nMonths = Math.max(0, Math.floor(nMonths));
        const len = this.nMonths + 1;
        this.means = new Float64Array(len * this.stride);
        this.weights = new Uint32Array(len * this.stride);
        this.exactFlags = new Uint8Array(len * this.stride);
        this.counts = new Uint16Array(len);
        this.totals = new Uint32Array(len);
    }

    add(monthIndex: number, value: number): void {
        if (monthIndex < 0 || monthIndex > this.nMonths) return;
        const v = Number.isFinite(value) ? value : 0;
        let c = this.counts[monthIndex];
        if (c >= this.stride) {
            this.compressMonth(monthIndex);
            c = this.counts[monthIndex];
            if (c >= this.stride) {
                const lastIdx = monthIndex * this.stride + c - 1;
                if (this.means[lastIdx] === v) {
                    this.weights[lastIdx] += 1;
                } else {
                    const nw = this.weights[lastIdx] + 1;
                    this.means[lastIdx] = (this.means[lastIdx] * this.weights[lastIdx] + v) / nw;
                    this.weights[lastIdx] = nw;
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

    private runPass(
        base: number,
        c: number,
        totalWeight: number,
        minProtectWeight: number,
        dkScale: number,
    ): number {
        quicksortCentroids(this.means, this.weights, this.exactFlags, base, base + c - 1);

        let writeIdx = base;
        let weightSoFar = 0;
        let cMean = this.means[base];
        let cWeight = this.weights[base];
        let cExact = this.exactFlags[base];

        for (let k = 1; k < c; k++) {
            const idx = base + k;
            const mi = this.means[idx];
            const wi = this.weights[idx];
            const ei = this.exactFlags[idx];

            if (mi === cMean && cExact === ei) {
                cWeight += wi;
                continue;
            }

            const proposedWeight = cWeight + wi;
            const dk =
                scaleK1((weightSoFar + proposedWeight) / totalWeight) -
                scaleK1(weightSoFar / totalWeight);
            const isProtected =
                (cExact === 1 && cWeight >= minProtectWeight) ||
                (ei === 1 && wi >= minProtectWeight);

            if (!isProtected && dk <= dkScale) {
                cMean = cMean + ((mi - cMean) * wi) / proposedWeight;
                cWeight = proposedWeight;
                cExact = 0;
            } else {
                this.means[writeIdx] = cMean;
                this.weights[writeIdx] = cWeight;
                this.exactFlags[writeIdx] = cExact;
                writeIdx++;
                weightSoFar += cWeight;
                cMean = mi;
                cWeight = wi;
                cExact = ei;
            }
        }

        this.means[writeIdx] = cMean;
        this.weights[writeIdx] = cWeight;
        this.exactFlags[writeIdx] = cExact;
        writeIdx++;

        return writeIdx - base;
    }

    compressMonth(monthIndex: number): void {
        const c = this.counts[monthIndex];
        const totalW = this.totals[monthIndex];
        if (c <= 1 || totalW === 0) return;

        const base = monthIndex * this.stride;
        let outCount = this.runPass(base, c, totalW, 2, 1.0);

        const maxBudget = this.stride - 16;
        if (outCount > maxBudget) {
            const bigMassThreshold = Math.max(4, Math.floor(totalW * 0.005));
            outCount = this.runPass(base, outCount, totalW, bigMassThreshold, 1.0);
        }

        let dkScale = 1.6;
        while (outCount >= this.stride) {
            outCount = this.runPass(base, outCount, totalW, Number.POSITIVE_INFINITY, dkScale);
            dkScale *= 2;
        }

        this.counts[monthIndex] = outCount;
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

function evaluateQuantilesFromSorted(
    means: Float64Array,
    weights: Uint32Array,
    exactFlags: Uint8Array,
    count: number,
    quantiles: readonly [number, number, number],
): [number, number, number] {
    if (count === 0) return [0, 0, 0];
    if (count === 1) {
        const v = round2(Number.isFinite(means[0]) ? means[0] : 0);
        return [v, v, v];
    }

    let totalWeight = 0;
    for (let i = 0; i < count; i++) totalWeight += weights[i];
    if (totalWeight <= 0) return [0, 0, 0];

    const out: [number, number, number] = [0, 0, 0];
    for (let qi = 0; qi < 3; qi++) {
        const q = quantiles[qi];
        const targetRank = q * totalWeight;
        const firstRight = exactFlags[0] === 1 ? weights[0] : weights[0] * 0.5;
        if (targetRank <= firstRight) {
            out[qi] = means[0];
            continue;
        }
        const lastLeft =
            exactFlags[count - 1] === 1
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

    for (let i = 0; i < 3; i++) {
        out[i] = Number.isFinite(out[i]) ? round2(out[i]) : 0;
        if (i > 0 && out[i] < out[i - 1]) out[i] = out[i - 1];
    }
    return out;
}

// ----------------------------------------------------------------------------
// Utilitaires communs
// ----------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
}

function safeFinite(v: unknown, fallback = 0): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function computeWeightedPortfolioReturnPct(params: SimulationParams): number {
    const rates = params.projection?.returnRates ?? {
        celi: params.projection?.returnRate ?? 6.5,
        reer: params.projection?.returnRate ?? 6.5,
        nonReg: params.projection?.returnRate ?? 6.5,
        crypto: 9.0,
        cash: 2.5,
    };
    const b = params.liveCSVBalances;
    const cash = Math.max(0, safeFinite(params.calculatedStartingCash, 0));
    const celi = Math.max(0, safeFinite(b?.CELI, 0) + safeFinite(b?.CELIAPP, 0) + safeFinite(b?.REEE, 0));
    const reer = Math.max(0, safeFinite(b?.REER, 0));
    const nonReg = Math.max(0, safeFinite(b?.NON_ENREG, 0));
    const crypto = Math.max(0, safeFinite(b?.CRYPTO, 0));
    const tot = cash + celi + reer + nonReg + crypto;
    if (tot <= 0) {
        return safeFinite(rates.celi, safeFinite(params.projection?.returnRate, 6.5));
    }
    return round2(
        (cash * rates.cash +
            celi * rates.celi +
            reer * rates.reer +
            nonReg * rates.nonReg +
            crypto * rates.crypto) /
            tot,
    );
}

function emptyPastDiagnostic(): RealPastDiagnostic {
    return {
        transactionsAnalyzed: 0,
        monthsCovered: 0,
        firstTransactionDate: null,
        lastTransactionDate: null,
        observedMonthlyIncomeCad: null,
        observedMonthlyExpensesCad: null,
        budgetedMonthlyExpensesCad: null,
        monthlySpendingGapCad: null,
        observedSavingsRatePct: null,
        lifestyleCreepAnnualPct: null,
        fixedExpensesSharePct: null,
        discretionarySharePct: null,
        peakSpendingMonthLabel: null,
        lowSpendingMonthLabel: null,
        weightedMerPct: null,
        estimatedAnnualFeeAndTaxDragCad: null,
        expenseVolatilityPct: null,
        findingsFr: [
            'Historique de transactions non fourni : projection rapide basée sur les paramètres courants du dossier.',
        ],
    };
}

function neutralNewsBundle(): MacroAndNewsSignalBundle {
    return {
        collectedAtIso: new Date().toISOString(),
        liveArticlesUsed: 0,
        offlineFallbackUsed: true,
        portfolioSentimentScore: null,
        portfolioSentimentLabel: 'Neutre',
        annualizedReturnAdjustmentPct: 0,
        volatilityMultiplier: 1,
        macroHeadlineFr: 'Estimation rapide hors-ligne basée sur les hypothèses du dossier.',
        keySignals: [],
        aiSynthesisFr: null,
        usedGemini: false,
    };
}

function normalizeFutureChartPoints(
    chartData: ReadonlyArray<ProjectionChartPoint> | undefined,
): ProjectionChartPoint[] {
    if (!chartData || chartData.length === 0) return [];
    const byMonth = new Map<number, ProjectionChartPoint>();
    for (const pt of chartData) {
        if (!pt || typeof pt.monthIndex !== 'number' || !Number.isFinite(pt.monthIndex)) continue;
        if (pt.monthIndex < 0 || pt.dayIsReal === true || pt.isDailyPoint === true) continue;
        if (!Number.isFinite(pt.NetWorth)) continue;
        const mKey = Math.trunc(pt.monthIndex);
        if (!byMonth.has(mKey) || pt.monthIndex === mKey) {
            byMonth.set(mKey, pt.monthIndex === mKey ? pt : { ...pt, monthIndex: mKey });
        }
    }
    return Array.from(byMonth.values()).sort((a, b) => a.monthIndex - b.monthIndex);
}

function extractValoriaSummary(
    valoriaForecast: ValoriaFutureForecastResult | null | undefined,
): DeepValoriaSummary | null {
    if (!valoriaForecast) return null;
    return {
        consensus100: Number.isFinite(valoriaForecast.portfolioConsensus100)
            ? valoriaForecast.portfolioConsensus100
            : null,
        consensusTitle: valoriaForecast.consensusTitle,
        evaluatedAssetsCount: valoriaForecast.holdings.length,
        regimeName: valoriaForecast.regimeName,
        shortTermRatePct: Number.isFinite(valoriaForecast.shortTermPortfolioRatePct)
            ? valoriaForecast.shortTermPortfolioRatePct
            : null,
        longTermRatePct: Number.isFinite(valoriaForecast.longTermPortfolioRatePct)
            ? valoriaForecast.longTermPortfolioRatePct
            : null,
    };
}

// ----------------------------------------------------------------------------
// Tournoi d'optimisation IA & préparation des 4 socles fiscaux ARC/RQ
// ----------------------------------------------------------------------------

function shiftReturnRates(
    rates: SimulationParams['projection']['returnRates'] | undefined,
    fallbackRate: number,
    deltaPp: number,
    cashDeltaPp = deltaPp * 0.35,
): NonNullable<SimulationParams['projection']['returnRates']> {
    const base = rates ?? {
        celi: fallbackRate,
        reer: fallbackRate,
        nonReg: fallbackRate,
        crypto: Math.max(fallbackRate, 9),
        cash: 2.5,
    };
    return {
        celi: round2(clamp(base.celi + deltaPp, -2.0, 18.0)),
        reer: round2(clamp(base.reer + deltaPp, -2.0, 18.0)),
        nonReg: round2(clamp(base.nonReg + deltaPp, -2.0, 18.0)),
        crypto: round2(clamp(base.crypto + deltaPp * 1.25, -4.0, 28.0)),
        cash: round2(clamp(base.cash + cashDeltaPp, 0.25, 10.0)),
    };
}

function shiftValoriaSchedule(
    schedule: SimulationParams['valoriaSchedule'],
    deltaPp: number,
): SimulationParams['valoriaSchedule'] {
    if (!schedule) return undefined;
    const shiftArr = (arr: number[], mult = 1) =>
        arr.map((r) => round2(clamp(r + deltaPp * mult, -8, 22)));
    return {
        ...schedule,
        celiRatesByYear: shiftArr(schedule.celiRatesByYear),
        reerRatesByYear: shiftArr(schedule.reerRatesByYear),
        nonRegRatesByYear: shiftArr(schedule.nonRegRatesByYear),
        cryptoRatesByYear: shiftArr(schedule.cryptoRatesByYear, 1.2),
        cashRatesByYear: shiftArr(schedule.cashRatesByYear, 0.35),
    };
}

export interface AiOptimizationPlan {
    winningParams: SimulationParams;
    winningStrategy: AllocationStrategy;
    appliedOptimizationsFr: string[];
    merSavingsPp: number;
    monthlySavingsRecoveredCad: number;
}

/**
 * Explore automatiquement les combinaisons de stratégies (PRIO_CELI, PRIO_REER, DEBT_FIRST,
 * AUTO_MARGINAL, MELTDOWN_REER, localisation d'actifs, optimisation RFG et réduction réaliste
 * d'écart budgétaire) sur le vrai moteur fiscal ARC/RQ pour sélectionner le meilleur plan IA.
 */
export function exploreAiOptimizedStrategy(input: {
    params: SimulationParams;
    pastDiagnostic: RealPastDiagnostic;
}): AiOptimizationPlan {
    const { params, pastDiagnostic } = input;
    const baseProj = params.projection;

    // 1. Optimisation réaliste des frais RFG + localisation fiscale US/CELI
    const merSavingsPp =
        pastDiagnostic.weightedMerPct !== null && pastDiagnostic.weightedMerPct > 0.18
            ? round2(clamp(pastDiagnostic.weightedMerPct - 0.12, 0, 0.65))
            : 0;

    // 2. Récupération réaliste si dépassement budgétaire observé dans le passé réel
    let monthlySavingsRecoveredCad = 0;
    let adjustedExpenses = params.baseMonthlyExpenses;
    if (
        pastDiagnostic.monthlySpendingGapCad !== null &&
        pastDiagnostic.monthlySpendingGapCad > 40 &&
        pastDiagnostic.observedMonthlyExpensesCad !== null
    ) {
        monthlySavingsRecoveredCad = Math.round(
            Math.min(
                pastDiagnostic.monthlySpendingGapCad * 0.65,
                pastDiagnostic.observedMonthlyExpensesCad * 0.15,
            ),
        );
        adjustedExpenses = Math.max(500, params.baseMonthlyExpenses - monthlySavingsRecoveredCad);
    }

    const baseRatesPlusMer = shiftReturnRates(
        baseProj.returnRates,
        baseProj.returnRate ?? 6.5,
        merSavingsPp,
        0,
    );
    const cleanBehavioral = params.behavioralProfile
        ? {
              ...params.behavioralProfile,
              expenseMode: 'budget' as const,
              lifestyleCreepAnnual: Math.min(0, params.behavioralProfile.lifestyleCreepAnnual ?? 0),
          }
        : undefined;

    const hasSignificantDebt = (params.debts ?? []).some(
        (d) => Number.isFinite(d.balance) && d.balance > 0 && d.interestRate >= 4.0,
    );
    const hasCeliUsDrag =
        (params.projection.usEquityShareCeli ?? 0) > 10 ||
        (params.valoriaSchedule?.usShareCeliPct ?? 0) > 10;

    interface CandidateSpec {
        withdrawalStrategy: NonNullable<SimulationParams['projection']['withdrawalStrategy']>;
        contributionOrder: 'CELI_FIRST' | 'REER_FIRST';
        debtFirst: boolean;
        labelFr: string;
    }

    const candidates: CandidateSpec[] = [
        {
            withdrawalStrategy: 'AUTO_MARGINAL',
            contributionOrder: 'CELI_FIRST',
            debtFirst: false,
            labelFr: 'Décaissement adaptatif par palier marginal ARC/RQ + cotisation CELI prioritaire',
        },
        {
            withdrawalStrategy: 'AUTO_MARGINAL',
            contributionOrder: 'REER_FIRST',
            debtFirst: false,
            labelFr: 'Décaissement adaptatif par palier marginal ARC/RQ + cotisation REER prioritaire',
        },
        {
            withdrawalStrategy: 'PRIO_CELI',
            contributionOrder: 'CELI_FIRST',
            debtFirst: false,
            labelFr: 'Priorité CELI à la décaissement (préservation PSV et souplesse fiscale)',
        },
        {
            withdrawalStrategy: 'PRIO_REER',
            contributionOrder: 'REER_FIRST',
            debtFirst: false,
            labelFr: 'Priorité REER (maximisation de la déduction fiscale immédiate)',
        },
        {
            withdrawalStrategy: 'MELTDOWN_REER',
            contributionOrder: 'REER_FIRST',
            debtFirst: false,
            labelFr: 'Fonte structurée du REER (MELTDOWN_REER) avant conversion FERR à 71 ans',
        },
    ];
    if (hasSignificantDebt) {
        candidates.push({
            withdrawalStrategy: 'AUTO_MARGINAL',
            contributionOrder: 'CELI_FIRST',
            debtFirst: true,
            labelFr: 'Remboursement prioritaire des dettes (DEBT_FIRST) avant accumulation boursière',
        });
    }

    // Référence pour vérifier que le gagnant surpasse la trajectoire réelle
    const baseEval = calculateFutureProjection(params, false, 0);
    const baseFinalNW = safeFinite(baseEval.finalNetWorth, 0);
    const baseEstate = safeFinite(baseEval.estateNetWorth, baseFinalNW);

    let bestScore = -Infinity;
    let bestSpec = candidates[0];
    let bestParams: SimulationParams = params;
    let bestEstate = -Infinity;
    let bestFinalNW = -Infinity;

    for (const cand of candidates) {
        const shiftedSchedule = params.valoriaSchedule
            ? {
                  ...shiftValoriaSchedule(params.valoriaSchedule, merSavingsPp)!,
                  usShareCeliPct: hasCeliUsDrag
                      ? Math.min(15, params.valoriaSchedule.usShareCeliPct)
                      : params.valoriaSchedule.usShareCeliPct,
              }
            : undefined;

        const candParams: SimulationParams = {
            ...params,
            baseMonthlyExpenses: adjustedExpenses,
            ...(cleanBehavioral ? { behavioralProfile: cleanBehavioral } : {}),
            ...(shiftedSchedule ? { valoriaSchedule: shiftedSchedule } : {}),
            projection: {
                ...baseProj,
                withdrawalStrategy: cand.withdrawalStrategy,
                appliedContributionOrder: cand.contributionOrder,
                appliedDebtFirst: cand.debtFirst,
                appliedAssetLocation: true,
                appliedGainHarvesting: true,
                appliedPensionSplitting: true,
                usEquityShareCeli: hasCeliUsDrag
                    ? Math.min(15, baseProj.usEquityShareCeli ?? 15)
                    : baseProj.usEquityShareCeli,
                returnRates: baseRatesPlusMer,
            },
        };

        const res = calculateFutureProjection(candParams, false, 0);
        const estate = safeFinite(res.estateNetWorth, safeFinite(res.finalNetWorth, 0));
        const finalNW = safeFinite(res.finalNetWorth, 0);
        const taxes = safeFinite(res.totalTaxesPaid, 0);
        const shortfall = safeFinite(res.shortfallRate, 0);

        const dominatesFinal = finalNW >= baseFinalNW - 1;
        const score =
            estate +
            0.35 * finalNW -
            0.1 * taxes -
            shortfall * 1_000_000 +
            (dominatesFinal ? 0 : -250_000);
        if (score > bestScore) {
            bestScore = score;
            bestSpec = cand;
            bestParams = candParams;
            bestEstate = estate;
            bestFinalNW = finalNW;
        }
    }

    // Si aucun candidat n'égale à la fois patrimoine final et succession, conserver la stratégie
    // de base enrichie (localisation fiscale + frais RFG réduits + discipline d'épargne).
    if (bestEstate < baseEstate || bestFinalNW < baseFinalNW - 1) {
        const shiftedSchedule = params.valoriaSchedule
            ? shiftValoriaSchedule(params.valoriaSchedule, merSavingsPp)
            : undefined;
        bestParams = {
            ...params,
            baseMonthlyExpenses: adjustedExpenses,
            ...(cleanBehavioral ? { behavioralProfile: cleanBehavioral } : {}),
            ...(shiftedSchedule ? { valoriaSchedule: shiftedSchedule } : {}),
            projection: {
                ...baseProj,
                appliedAssetLocation: true,
                appliedGainHarvesting: true,
                appliedPensionSplitting: true,
                returnRates: baseRatesPlusMer,
            },
        };
    }

    const appliedOptimizationsFr: string[] = [bestSpec.labelFr];
    appliedOptimizationsFr.push(
        `Localisation fiscale optimale par enveloppe (+${ASSET_LOCATION_BONUS_PP.toFixed(2).replace('.', ',')} %/an net estimé : dividendes US en REER, croissance en CELI, récolte de gains au palier bas)`,
    );
    if (merSavingsPp > 0) {
        appliedOptimizationsFr.push(
            `Réduction des frais de gestion RFG de −${merSavingsPp.toFixed(2).replace('.', ',')} %/an via FNB indiciels canadiens à bas coût`,
        );
    }
    if (monthlySavingsRecoveredCad > 0) {
        appliedOptimizationsFr.push(
            `Réallocation réaliste de ${formatCAD(monthlySavingsRecoveredCad)}/mois de dépassement budgétaire vers l’épargne investie`,
        );
    }
    if (
        pastDiagnostic.lifestyleCreepAnnualPct !== null &&
        pastDiagnostic.lifestyleCreepAnnualPct > 0.5
    ) {
        appliedOptimizationsFr.push(
            `Neutralisation de la dérive du train de vie observée (+${formatPercent(pastDiagnostic.lifestyleCreepAnnualPct, 1)}/an)`,
        );
    }

    return {
        winningParams: bestParams,
        winningStrategy: bestSpec.debtFirst ? 'DEBT_FIRST' : bestSpec.withdrawalStrategy,
        appliedOptimizationsFr,
        merSavingsPp,
        monthlySavingsRecoveredCad,
    };
}

function extractBaselineFromProjection(input: {
    id: DeepScenarioId;
    proj: ProjectionResult;
    params: SimulationParams;
    assumptionsSummaryFr: string;
    appliedOptimizationsFr: string[];
    scenarioReturnShiftPct: number;
    scenarioVolMultiplier: number;
    scenarioInflationShiftPct: number;
    enableMacroRegimes: boolean;
    includeHistoricalCrises: boolean;
    expenseVolatilityPct: number;
    annualCreepExtraPct: number;
    valoriaForecast: ValoriaFutureForecastResult | null;
}): DeepScenarioBaseline {
    const { id, proj, params } = input;
    const pts = normalizeFutureChartPoints(proj.chartData);
    const years = Math.max(1, params.projection?.years ?? Math.round(pts.length / 12));
    const nMonths = Math.max(0, pts.length > 0 ? pts[pts.length - 1].monthIndex : years * 12);
    const len = nMonths + 1;

    const currentAge = params.config?.users?.[0]?.age || 35;
    const retirementAge = params.retirementGoal?.targetAge || 65;
    const retirementMonthIndex = Math.max(0, (retirementAge - currentAge) * 12);
    const lifeExpectancy = params.retirementGoal?.lifeExpectancy || 90;

    const baseReturnPct = computeWeightedPortfolioReturnPct(params);
    const baseInflationPct = safeFinite(params.projection?.inflationRate, 2.0);
    const valVol = input.valoriaForecast?.schedule?.annualVolatilityPct;
    const baseVolatilityPct = valVol
        ? round2(clamp(0.45 * valVol.celi + 0.40 * valVol.reer + 0.15 * valVol.nonReg, 7, 26))
        : 14.5;

    const merton = input.valoriaForecast?.schedule?.mertonJump ?? params.valoriaSchedule?.mertonJump;
    const mertonLambda = merton?.annualLambda ?? DEFAULT_MERTON_LAMBDA;
    const mertonMeanJump = merton?.meanJumpPct ?? DEFAULT_MERTON_MEAN_JUMP;
    const mertonJumpVol = merton?.jumpVolPct ?? DEFAULT_MERTON_JUMP_VOL;

    const detFinAssets = new Array<number>(len).fill(0);
    const detReAndBiz = new Array<number>(len).fill(0);
    const detDebt = new Array<number>(len).fill(0);
    const detMonthlyFlow = new Array<number>(len).fill(0);
    const detExpenses = new Array<number>(len).fill(params.baseMonthlyExpenses || 0);
    const detFireTarget = new Array<number>(len).fill(safeFinite(proj.fireNumber, 0));
    const detPensions = new Array<number>(len).fill(0);
    const detCumCpi = new Array<number>(len).fill(1);
    const rDetMonth = new Array<number>(len).fill(0);

    const ptByMonth = new Map<number, ProjectionChartPoint>();
    for (const p of pts) ptByMonth.set(p.monthIndex, p);

    for (let m = 0; m < len; m++) {
        const pt = ptByMonth.get(m);
        const nw = pt ? safeFinite(pt.NetWorth, 0) : (m > 0 ? detFinAssets[m - 1] + detReAndBiz[m - 1] - detDebt[m - 1] : 0);
        const hasDetailedFin =
            pt &&
            (pt.Liquidites !== undefined || pt.CELI !== undefined || pt.REER !== undefined);

        const fin = hasDetailedFin
            ? Math.max(
                  0,
                  safeFinite(pt.Liquidites, 0) +
                      safeFinite(pt.CELI, 0) +
                      safeFinite(pt.CELIAPP, 0) +
                      safeFinite(pt.REER, 0) +
                      safeFinite(pt.REEE, 0) +
                      safeFinite(pt.NonReg, 0) +
                      safeFinite(pt.Crypto, 0),
              )
            : Math.max(0, nw);

        const reBiz = hasDetailedFin
            ? safeFinite(pt.Immobilier, 0) + safeFinite(pt.Entreprise, 0)
            : 0;
        const debt = Math.max(0, fin + reBiz - nw);

        detFinAssets[m] = round2(fin);
        detReAndBiz[m] = round2(reBiz);
        detDebt[m] = round2(debt);
        detExpenses[m] = pt ? Math.max(0, safeFinite(pt.Expenses, params.baseMonthlyExpenses || 0)) : params.baseMonthlyExpenses || 0;
        detFireTarget[m] = pt ? Math.max(0, safeFinite(pt.FireTarget, safeFinite(proj.fireNumber, 0))) : safeFinite(proj.fireNumber, 0);
        detPensions[m] = pt ? Math.max(0, safeFinite(pt.IncomeRetirement, 0)) : 0;

        if (pt && typeof pt.realNetWorth === 'number' && Number.isFinite(pt.realNetWorth) && Math.abs(pt.realNetWorth) > 100 && Math.abs(nw) > 100) {
            detCumCpi[m] = Math.max(0.5, nw / pt.realNetWorth);
        } else {
            detCumCpi[m] = Math.pow(1 + baseInflationPct / 100, m / 12);
        }

        const yearsToRet = Math.max(0, (retirementMonthIndex - m) / 12);
        const isRet = m >= retirementMonthIndex;
        const glideFactor = isRet ? 0.60 : yearsToRet < 10 ? yearsToRet / 10 : 1.0;
        const effAnnualPct = baseReturnPct * glideFactor + (baseInflationPct + 1.0) * (1 - glideFactor);
        const rM = Math.pow(Math.max(0.2, 1 + effAnnualPct / 100), INV_12) - 1;
        rDetMonth[m] = rM;

        if (m >= 1) {
            detMonthlyFlow[m] = detFinAssets[m] - detFinAssets[m - 1] * (1 + rM);
        }
    }

    const detFinalNetWorth = safeFinite(
        proj.finalNetWorth,
        pts.length > 0 ? pts[pts.length - 1].NetWorth : 0,
    );
    const detEstateTax = Math.max(0, safeFinite(proj.totalEstateTax as number | undefined, 0));
    const detEstateNetWorth = safeFinite(proj.estateNetWorth, detFinalNetWorth - detEstateTax);
    const detTotalTaxesPaid = Math.max(0, safeFinite(proj.totalTaxesPaid, 0));
    const detPensionNpvOffset =
        detEstateNetWorth - (detFinalNetWorth - detEstateTax);

    // Sensibilité marginale d'impôt successoral ARC/RQ sur le capital financier terminal
    const lastPt = pts[pts.length - 1];
    const lastReer = safeFinite(lastPt?.REER, 0);
    const lastNonReg = safeFinite(lastPt?.NonReg, 0) + safeFinite(lastPt?.Crypto, 0);
    const lastFin = Math.max(1, detFinAssets[nMonths]);
    const taxableEndShare = Math.min(1, (lastReer + 0.35 * lastNonReg) / lastFin);
    const marginalEstateTaxSensitivity = clamp(
        Math.max(0.12, taxableEndShare * 0.42),
        0.10,
        0.48,
    );

    return {
        id,
        label: SCENARIO_META[id].label,
        shortDescription: SCENARIO_META[id].shortDescription,
        assumptionsSummaryFr: input.assumptionsSummaryFr,
        appliedOptimizationsFr: input.appliedOptimizationsFr,
        nMonths,
        startYear: params.startYear,
        startMonth: params.startMonth ?? 0,
        currentAge,
        retirementAge,
        retirementMonthIndex,
        lifeExpectancy,
        baseReturnPct,
        baseVolatilityPct,
        mertonLambda,
        mertonMeanJump,
        mertonJumpVol,
        baseInflationPct,
        scenarioReturnShiftPct: input.scenarioReturnShiftPct,
        scenarioVolMultiplier: input.scenarioVolMultiplier,
        scenarioInflationShiftPct: input.scenarioInflationShiftPct,
        enableMacroRegimes: input.enableMacroRegimes,
        includeHistoricalCrises: input.includeHistoricalCrises,
        expenseVolatilityPct: input.expenseVolatilityPct,
        annualCreepExtraPct: input.annualCreepExtraPct,
        detFinalNetWorth,
        detEstateNetWorth,
        detEstateTax,
        detTotalTaxesPaid,
        detPensionNpvOffset,
        marginalEstateTaxSensitivity,
        detFinAssets,
        detReAndBiz,
        detDebt,
        detMonthlyFlow,
        detExpenses,
        detFireTarget,
        detPensions,
        detCumCpi,
        rDetMonth,
    };
}

function classifyDeepGoals(params: SimulationParams): DeepClassifiedGoalMeta[] {
    const nMonths = Math.max(0, (params.projection?.years ?? 0) * 12);
    const classified = classifyFinancialGoals(
        params.financialGoals,
        params.startYear,
        params.startMonth ?? 0,
        nMonths,
    );
    return classified.map((g, idx) => {
        const rawGoal = params.financialGoals?.find((fg) => fg.id === g.goalId) ?? params.financialGoals?.[idx];
        const isBucket =
            rawGoal?.type === 'CELI' ||
            rawGoal?.type === 'REER' ||
            rawGoal?.type === 'LIQUIDITY';
        return {
            goalId: g.goalId,
            name: g.name,
            deadline: g.deadline,
            targetAmount: g.targetAmount,
            status: g.status,
            monthOffset: g.monthOffset,
            isAccountBucketGoal: Boolean(isBucket),
        };
    });
}

/**
 * Prépare les 4 socles calibrés par le vrai moteur fiscal ARC/RQ + tournoi IA.
 */
export function prepareDeepScenarioBaselines(input: {
    params: SimulationParams;
    pastDiagnostic: RealPastDiagnostic;
    newsBundle: MacroAndNewsSignalBundle;
    valoriaForecast: ValoriaFutureForecastResult | null;
    precomputedAiPlan?: AiOptimizationPlan;
}): {
    baselines: Record<DeepScenarioId, DeepScenarioBaseline>;
    classifiedGoals: DeepClassifiedGoalMeta[];
    valoriaSummary: DeepValoriaSummary | null;
} {
    const { params, pastDiagnostic, newsBundle, valoriaForecast } = input;
    const baseProjCfg = params.projection;
    const newsTiltPp = round2(clamp(newsBundle.annualizedReturnAdjustmentPct * 0.45, -1.2, 1.2));
    const newsVolMult = clamp(newsBundle.volatilityMultiplier, 0.9, 1.35);
    const obsExpVol = clamp(pastDiagnostic.expenseVolatilityPct ?? 4.5, 2.0, 16.0);
    const obsCreepPct = clamp(pastDiagnostic.lifestyleCreepAnnualPct ?? 0, -2.0, 5.0);

    // 1. Trajectoire réelle (ancrée sur habitudes observées si historique dispo)
    const realBehavioral =
        params.behavioralProfile ??
        (pastDiagnostic.transactionsAnalyzed > 0 && pastDiagnostic.observedMonthlyExpensesCad !== null
            ? {
                  expenseMode:
                      baseProjCfg.expenseProjectionMode === 'budget' ? ('budget' as const) : ('hybrid' as const),
                  convergenceStartMonth: 12,
                  convergenceEndMonth: 36,
                  realMonthlyExpenses: pastDiagnostic.observedMonthlyExpensesCad,
                  fixedRatio: (pastDiagnostic.fixedExpensesSharePct ?? 60) / 100,
                  discretionaryRatio: (pastDiagnostic.discretionarySharePct ?? 40) / 100,
                  lifestyleCreepAnnual: Math.max(-0.05, Math.min(0.08, (pastDiagnostic.lifestyleCreepAnnualPct ?? 0) / 100)),
                  expenseVolatility: obsExpVol / 100,
                  seasonalityFactors: new Array(12).fill(1),
              }
            : undefined);

    const realParams: SimulationParams = {
        ...params,
        ...(realBehavioral ? { behavioralProfile: realBehavioral } : {}),
    };
    const realDet = calculateFutureProjection(realParams, false, 0);

    // 2. Prudent / Stress (-1.8%/an + chocs actus négatifs, vol x1.28, inflation +0.7%, hypothèque +1.25%, creep maintenu)
    const prudentReturnDelta = -1.8 + Math.min(0, newsTiltPp);
    const prudentParams: SimulationParams = {
        ...realParams,
        realEstateGoals: (params.realEstateGoals ?? []).map((g) => ({
            ...g,
            mortgageRate: g.mortgageRate + 1.25,
            renewalRateProjection: (g.renewalRateProjection && g.renewalRateProjection > 0
                ? g.renewalRateProjection
                : g.mortgageRate) + 1.25,
        })),
        debts: (params.debts ?? []).map((d) =>
            d.isVariableRate ? { ...d, interestRate: d.interestRate + 1.25 } : d,
        ),
        projection: {
            ...baseProjCfg,
            inflationRate: round2(clamp((baseProjCfg.inflationRate ?? 2.0) + 0.7, 0.5, 12)),
            returnRates: shiftReturnRates(
                baseProjCfg.returnRates,
                baseProjCfg.returnRate ?? 6.5,
                prudentReturnDelta,
            ),
        },
        ...(params.valoriaSchedule
            ? { valoriaSchedule: shiftValoriaSchedule(params.valoriaSchedule, prudentReturnDelta) }
            : {}),
    };
    const prudentDet = calculateFutureProjection(prudentParams, false, 0);

    // 3. Optimisé IA (tournoi multi-stratégies + RFG + localisation + épargne réaliste)
    const aiPlan =
        input.precomputedAiPlan ??
        exploreAiOptimizedStrategy({
            params: realParams,
            pastDiagnostic,
        });
    const aiDet = calculateFutureProjection(aiPlan.winningParams, false, 0);

    // 4. Favorable (+1.5%/an + catalyseurs positifs, inflation -0.3%, discipline tenue)
    const favReturnDelta = 1.5 + Math.max(0, newsTiltPp * 0.6);
    const favBehavioral = realBehavioral
        ? {
              ...realBehavioral,
              expenseMode: 'budget' as const,
              lifestyleCreepAnnual: 0,
          }
        : undefined;
    const favParams: SimulationParams = {
        ...params,
        ...(favBehavioral ? { behavioralProfile: favBehavioral } : {}),
        projection: {
            ...baseProjCfg,
            inflationRate: round2(clamp((baseProjCfg.inflationRate ?? 2.0) - 0.3, 0.5, 10)),
            returnRates: shiftReturnRates(
                baseProjCfg.returnRates,
                baseProjCfg.returnRate ?? 6.5,
                favReturnDelta,
            ),
        },
        ...(params.valoriaSchedule
            ? { valoriaSchedule: shiftValoriaSchedule(params.valoriaSchedule, favReturnDelta) }
            : {}),
    };
    const favDet = calculateFutureProjection(favParams, false, 0);

    const realBaseRate = computeWeightedPortfolioReturnPct(realParams);
    const prudentBaseRate = computeWeightedPortfolioReturnPct(prudentParams);
    const aiBaseRate = computeWeightedPortfolioReturnPct(aiPlan.winningParams);
    const favBaseRate = computeWeightedPortfolioReturnPct(favParams);

    const baselines: Record<DeepScenarioId, DeepScenarioBaseline> = {
        real_trajectory: extractBaselineFromProjection({
            id: 'real_trajectory',
            proj: realDet,
            params: realParams,
            assumptionsSummaryFr: `Rendement nominal moyen ${formatPercent(realBaseRate, 1)} · Inflation ${formatPercent(realParams.projection.inflationRate ?? 2, 1)} · Ajustement actus ${newsTiltPp >= 0 ? '+' : ''}${newsTiltPp.toFixed(2).replace('.', ',')} %/an · Régimes macro Markov actifs.`,
            appliedOptimizationsFr: [],
            scenarioReturnShiftPct: newsTiltPp,
            scenarioVolMultiplier: newsVolMult,
            scenarioInflationShiftPct: 0,
            enableMacroRegimes: true,
            includeHistoricalCrises: false,
            expenseVolatilityPct: obsExpVol,
            annualCreepExtraPct: Math.max(0, obsCreepPct * 0.25),
            valoriaForecast,
        }),
        prudent_stress: extractBaselineFromProjection({
            id: 'prudent_stress',
            proj: prudentDet,
            params: prudentParams,
            assumptionsSummaryFr: `Rendement abaissé ${formatPercent(prudentBaseRate, 1)} (−1,8 %/an) · Volatilité ×${(1.28 * newsVolMult).toFixed(2).replace('.', ',')} · Inflation ${formatPercent(prudentParams.projection.inflationRate ?? 2.7, 1)} (+0,7 %) · Renouvellements hypothécaires +1,25 % · Crises historiques activées.`,
            appliedOptimizationsFr: [],
            scenarioReturnShiftPct: -0.35 + Math.min(0, newsTiltPp),
            scenarioVolMultiplier: round2(1.28 * newsVolMult),
            scenarioInflationShiftPct: 0.25,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
            expenseVolatilityPct: Math.min(18, obsExpVol * 1.25),
            annualCreepExtraPct: Math.max(0.35, obsCreepPct * 0.5),
            valoriaForecast,
        }),
        ai_optimized: extractBaselineFromProjection({
            id: 'ai_optimized',
            proj: aiDet,
            params: aiPlan.winningParams,
            assumptionsSummaryFr: `Rendement optimisé ${formatPercent(aiBaseRate, 1)} (localisation + RFG) · Stratégie ${aiPlan.winningStrategy} · Écart budgétaire maîtrisé et fiscalité ARC/RQ optimisée.`,
            appliedOptimizationsFr: aiPlan.appliedOptimizationsFr,
            scenarioReturnShiftPct: Math.max(0.15, newsTiltPp * 0.5 + 0.15),
            scenarioVolMultiplier: round2(Math.max(0.92, newsVolMult * 0.96)),
            scenarioInflationShiftPct: 0,
            enableMacroRegimes: true,
            includeHistoricalCrises: false,
            expenseVolatilityPct: Math.max(2.0, obsExpVol * 0.75),
            annualCreepExtraPct: 0,
            valoriaForecast,
        }),
        favorable_tailwinds: extractBaselineFromProjection({
            id: 'favorable_tailwinds',
            proj: favDet,
            params: favParams,
            assumptionsSummaryFr: `Rendement porteur ${formatPercent(favBaseRate, 1)} (+1,5 %/an) · Inflation modérée ${formatPercent(favParams.projection.inflationRate ?? 1.7, 1)} (−0,3 %) · Volatilité contenue · Discipline d’épargne respectée.`,
            appliedOptimizationsFr: [
                'Maintien intégral de la discipline budgétaire (dérive du train de vie à 0 %)',
                'Réinvestissement systématique des flux excédentaires en marchés porteurs',
            ],
            scenarioReturnShiftPct: 0.35 + Math.max(0, newsTiltPp * 0.5),
            scenarioVolMultiplier: round2(Math.max(0.85, newsVolMult * 0.9)),
            scenarioInflationShiftPct: -0.1,
            enableMacroRegimes: true,
            includeHistoricalCrises: false,
            expenseVolatilityPct: Math.max(2.0, obsExpVol * 0.8),
            annualCreepExtraPct: 0,
            valoriaForecast,
        }),
    };

    return {
        baselines,
        classifiedGoals: classifyDeepGoals(params),
        valoriaSummary: extractValoriaSummary(valoriaForecast),
    };
}

// ----------------------------------------------------------------------------
// Exécution sharded (100 000+ trajectoires couplées CRN en Web Workers)
// ----------------------------------------------------------------------------

const TRANSITION_CDF: Readonly<Record<MacroRegimeId, readonly [number, number, number, number]>> = {
    expansion: [
        TRANSITION_MATRIX.expansion[0],
        TRANSITION_MATRIX.expansion[0] + TRANSITION_MATRIX.expansion[1],
        TRANSITION_MATRIX.expansion[0] + TRANSITION_MATRIX.expansion[1] + TRANSITION_MATRIX.expansion[2],
        1.0,
    ],
    stagflation: [
        TRANSITION_MATRIX.stagflation[0],
        TRANSITION_MATRIX.stagflation[0] + TRANSITION_MATRIX.stagflation[1],
        TRANSITION_MATRIX.stagflation[0] + TRANSITION_MATRIX.stagflation[1] + TRANSITION_MATRIX.stagflation[2],
        1.0,
    ],
    recession: [
        TRANSITION_MATRIX.recession[0],
        TRANSITION_MATRIX.recession[0] + TRANSITION_MATRIX.recession[1],
        TRANSITION_MATRIX.recession[0] + TRANSITION_MATRIX.recession[1] + TRANSITION_MATRIX.recession[2],
        1.0,
    ],
    krach: [
        TRANSITION_MATRIX.krach[0],
        TRANSITION_MATRIX.krach[0] + TRANSITION_MATRIX.krach[1],
        TRANSITION_MATRIX.krach[0] + TRANSITION_MATRIX.krach[1] + TRANSITION_MATRIX.krach[2],
        1.0,
    ],
};

const STATIONARY_CDF: readonly [number, number, number, number] = [
    STATIONARY_WEIGHTS[0],
    STATIONARY_WEIGHTS[0] + STATIONARY_WEIGHTS[1],
    STATIONARY_WEIGHTS[0] + STATIONARY_WEIGHTS[1] + STATIONARY_WEIGHTS[2],
    1.0,
];

function sampleRegimeFromCdf(
    u: number,
    cdf: readonly [number, number, number, number],
): MacroRegimeId {
    if (u < cdf[0]) return MACRO_REGIME_ORDER[0];
    if (u < cdf[1]) return MACRO_REGIME_ORDER[1];
    if (u < cdf[2]) return MACRO_REGIME_ORDER[2];
    return MACRO_REGIME_ORDER[3];
}

const REGIME_RESIDUAL_CACHE: Record<
    MacroRegimeId,
    { stocksRes: number; infRes: number }
> = {
    expansion: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.expansion.rhoMarketStocks ** 2)),
        infRes: Math.sqrt(
            Math.max(
                0,
                1 -
                    REGIME_PARAMS.expansion.wInflationMarket ** 2 -
                    REGIME_PARAMS.expansion.wInflationMacro ** 2,
            ),
        ),
    },
    stagflation: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.stagflation.rhoMarketStocks ** 2)),
        infRes: Math.sqrt(
            Math.max(
                0,
                1 -
                    REGIME_PARAMS.stagflation.wInflationMarket ** 2 -
                    REGIME_PARAMS.stagflation.wInflationMacro ** 2,
            ),
        ),
    },
    recession: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.recession.rhoMarketStocks ** 2)),
        infRes: Math.sqrt(
            Math.max(
                0,
                1 -
                    REGIME_PARAMS.recession.wInflationMarket ** 2 -
                    REGIME_PARAMS.recession.wInflationMacro ** 2,
            ),
        ),
    },
    krach: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.krach.rhoMarketStocks ** 2)),
        infRes: Math.sqrt(
            Math.max(
                0,
                1 -
                    REGIME_PARAMS.krach.wInflationMarket ** 2 -
                    REGIME_PARAMS.krach.wInflationMacro ** 2,
            ),
        ),
    },
};

/**
 * Simule `req.count` mondes couplés (× 4 scénarios appariés) en mémoire bornée avec
 * TypedArrays transférables zero-copy. Exécutable dans un Web Worker ou chunk synchrone.
 */
export function computeDeepScenarioShard(
    req: DeepShardRequest,
    onProgress?: (done: number, total: number) => void,
): DeepShardOutput {
    const count = Math.max(0, Math.floor(req.count));
    const startIter = Math.max(0, Math.floor(req.startIter));
    const seedBase = Number.isFinite(req.seed) ? Math.trunc(req.seed) : 20260401;

    const bReal = req.baselines.real_trajectory;
    const nMonths = bReal.nMonths;
    const goals = req.classifiedGoals;
    const nGoals = goals.length;

    const goalMaskByMonth = new Int32Array(nMonths + 1).fill(-1);
    const multiGoalsAtMonth = new Map<number, number[]>();
    for (let gi = 0; gi < nGoals; gi++) {
        const g = goals[gi];
        if (g.status === 'evaluated' && g.monthOffset >= 0 && g.monthOffset <= nMonths) {
            if (goalMaskByMonth[g.monthOffset] === -1) {
                goalMaskByMonth[g.monthOffset] = gi;
            } else {
                const existing = multiGoalsAtMonth.get(g.monthOffset) ?? [goalMaskByMonth[g.monthOffset]];
                existing.push(gi);
                multiGoalsAtMonth.set(g.monthOffset, existing);
                goalMaskByMonth[g.monthOffset] = -2;
            }
        }
    }

    const pools: Record<DeepScenarioId, FastMonthlyDigestPool> = {
        real_trajectory: new FastMonthlyDigestPool(nMonths),
        prudent_stress: new FastMonthlyDigestPool(nMonths),
        ai_optimized: new FastMonthlyDigestPool(nMonths),
        favorable_tailwinds: new FastMonthlyDigestPool(nMonths),
    };

    const fiReached: Record<DeepScenarioId, Float32Array> = {
        real_trajectory: new Float32Array(count),
        prudent_stress: new Float32Array(count),
        ai_optimized: new Float32Array(count),
        favorable_tailwinds: new Float32Array(count),
    };
    const sustNet: Record<DeepScenarioId, Float32Array> = {
        real_trajectory: new Float32Array(count),
        prudent_stress: new Float32Array(count),
        ai_optimized: new Float32Array(count),
        favorable_tailwinds: new Float32Array(count),
    };
    const estTotals: Record<DeepScenarioId, Float32Array> = {
        real_trajectory: new Float32Array(count),
        prudent_stress: new Float32Array(count),
        ai_optimized: new Float32Array(count),
        favorable_tailwinds: new Float32Array(count),
    };
    const estTaxes: Record<DeepScenarioId, Float32Array> = {
        real_trajectory: new Float32Array(count),
        prudent_stress: new Float32Array(count),
        ai_optimized: new Float32Array(count),
        favorable_tailwinds: new Float32Array(count),
    };
    const finalNWs: Record<DeepScenarioId, Float32Array> = {
        real_trajectory: new Float32Array(count),
        prudent_stress: new Float32Array(count),
        ai_optimized: new Float32Array(count),
        favorable_tailwinds: new Float32Array(count),
    };
    const goalMetCounts: Record<DeepScenarioId, Uint32Array> = {
        real_trajectory: new Uint32Array(nGoals),
        prudent_stress: new Uint32Array(nGoals),
        ai_optimized: new Uint32Array(nGoals),
        favorable_tailwinds: new Uint32Array(nGoals),
    };
    const ruinedCounts: Record<DeepScenarioId, number> = {
        real_trajectory: 0,
        prudent_stress: 0,
        ai_optimized: 0,
        favorable_tailwinds: 0,
    };
    const retMonthsTotals: Record<DeepScenarioId, number> = {
        real_trajectory: 0,
        prudent_stress: 0,
        ai_optimized: 0,
        favorable_tailwinds: 0,
    };
    const fireTargetValids: Record<DeepScenarioId, boolean> = {
        real_trajectory: req.baselines.real_trajectory.detFireTarget.some((v) => v > 0),
        prudent_stress: req.baselines.prudent_stress.detFireTarget.some((v) => v > 0),
        ai_optimized: req.baselines.ai_optimized.detFireTarget.some((v) => v > 0),
        favorable_tailwinds: req.baselines.favorable_tailwinds.detFireTarget.some((v) => v > 0),
    };

    const progressStep = Math.max(25, Math.min(250, Math.floor(count / 20) || 1));
    onProgress?.(0, count);

    const baselinesArr = DEEP_SCENARIO_IDS.map((id) => req.baselines[id]);
    const finCap = new Float64Array(4);
    const extraDebt = new Float64Array(4);
    const cumCpi = new Float64Array(4);
    const retFundedReal = new Float64Array(4);
    const retAnnuityFv = new Float64Array(4);
    const retMonthsEval = new Int32Array(4);
    const firstFire = new Float64Array(4);

    for (let i = 0; i < count; i++) {
        if (i > 0 && i % progressStep === 0) {
            onProgress?.(i, count);
        }

        const worldIdx = startIter + i;
        // Hash déterministe du monde k pour reproductibilité stricte entre sharding 1 vs 4 workers
        let h = ((worldIdx + 1) ^ seedBase ^ 0x9e3779b9) >>> 0;
        h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
        const rng = mulberry32((h ^ (h >>> 16)) >>> 0 || 1337);

        let curRegime = sampleRegimeFromCdf(rng(), STATIONARY_CDF);
        let activeCrisis: ActiveCrisisState | null = null;
        let crisisCooldown = 0;

        for (let s = 0; s < 4; s++) {
            const b = baselinesArr[s];
            finCap[s] = b.detFinAssets[0] ?? 0;
            extraDebt[s] = 0;
            cumCpi[s] = 1;
            retFundedReal[s] = 0;
            retAnnuityFv[s] = 0;
            retMonthsEval[s] = 0;
            firstFire[s] = Number.NaN;

            const nw0 = finCap[s] + (b.detReAndBiz[0] ?? 0) - (b.detDebt[0] ?? 0);
            pools[b.id].add(0, nw0);
            const ft0 = b.detFireTarget[0] ?? 0;
            if (ft0 > 0 && nw0 >= ft0) {
                firstFire[s] = b.currentAge;
            }
        }

        for (let m = 1; m <= nMonths; m++) {
            // Transition Markov partagée + crise historique éventuelle pour le scénario stress
            const prevRegime = curRegime;
            curRegime = sampleRegimeFromCdf(rng(), TRANSITION_CDF[prevRegime]);
            if (activeCrisis !== null) {
                activeCrisis.elapsedMonths += 1;
                if (activeCrisis.elapsedMonths >= activeCrisis.durationMonths) {
                    activeCrisis = null;
                    crisisCooldown = 24;
                }
            } else if (crisisCooldown > 0) {
                crisisCooldown -= 1;
            } else if (prevRegime !== 'krach' && curRegime === 'krach' && rng() < 0.85) {
                const cIdx = Math.min(
                    HISTORICAL_CRISIS_IDS.length - 1,
                    Math.floor(rng() * HISTORICAL_CRISIS_IDS.length),
                );
                const def = HISTORICAL_CRISIS_CATALOG[HISTORICAL_CRISIS_IDS[cIdx]];
                if (def && def.yearReturns.length > 0) {
                    activeCrisis = {
                        id: def.id,
                        elapsedMonths: 0,
                        durationMonths: def.durationMonths,
                        yearReturns: def.yearReturns,
                        monthlyLogShape: def.monthlyLogShape,
                    };
                }
            }

            // 6 tirages communs + saut Merton + dépense imprévue (CRN partagé entre les 4 scénarios)
            const u1 = gaussianRandom(rng, 0, 1);
            const u2 = gaussianRandom(rng, 0, 1);
            const u3 = gaussianRandom(rng, 0, 1);
            const u4 = gaussianRandom(rng, 0, 1);
            const u5 = gaussianRandom(rng, 0, 1);
            const uJump = rng();
            const zJump = gaussianRandom(rng, 0, 1);
            const zExp = gaussianRandom(rng, 0, 1);

            const reg = REGIME_PARAMS[curRegime];
            const res = REGIME_RESIDUAL_CACHE[curRegime];
            const zStocks = reg.rhoMarketStocks * u1 + res.stocksRes * u3;
            const zInf = reg.wInflationMarket * u1 + reg.wInflationMacro * u2 + res.infRes * u5;
            const crisisRates = activeCrisis ? computeCrisisEpisodeRates(activeCrisis, u3, u4) : null;

            for (let s = 0; s < 4; s++) {
                const b = baselinesArr[s];
                const yearsToRet = Math.max(0, (b.retirementMonthIndex - m) / 12);
                const isRet = m >= b.retirementMonthIndex;
                const glideFactor = isRet ? 0.60 : yearsToRet < 10 ? yearsToRet / 10 : 1.0;

                // Taux nominal annuel avant choc
                const baseEffAnnual =
                    (b.baseReturnPct + b.scenarioReturnShiftPct) * glideFactor +
                    (b.baseInflationPct + 1.0) * (1 - glideFactor);

                const eqScale = 0.45 + 0.55 * glideFactor;
                const sigmaAnnual =
                    (b.baseVolatilityPct * b.scenarioVolMultiplier * eqScale) *
                    (reg.stockVolPct / 14.5);

                let annualRatePct: number;
                let stochInfAnnual: number;

                if (b.includeHistoricalCrises && crisisRates !== null) {
                    // Pendant une crise historique dans Prudent / Stress, mélange pondéré avec le glidepath
                    const crisisEq = crisisRates.mcCeliRate * eqScale + crisisRates.mcCashRate * (1 - eqScale);
                    annualRatePct = crisisEq + b.scenarioReturnShiftPct;
                    stochInfAnnual = clamp(
                        crisisRates.currentInflation + b.scenarioInflationShiftPct,
                        -5,
                        18,
                    );
                } else {
                    const driftedBase = baseEffAnnual + reg.equityDeltaPp * eqScale;
                    annualRatePct = safeApplyShock(driftedBase, sigmaAnnual, zStocks);
                    stochInfAnnual = clamp(
                        b.baseInflationPct +
                            b.scenarioInflationShiftPct +
                            reg.inflationDeltaPp +
                            reg.inflationVolPct * 0.45 * zInf,
                        -4,
                        16,
                    );
                }

                // Sauts Merton Jump-Diffusion (compensés en dérive)
                let jumpDec = 0;
                if (b.mertonLambda > 0) {
                    const lambdaMonth = (b.mertonLambda * (b.id === 'prudent_stress' ? 1.25 : 1.0)) / 12;
                    const pJump = 1 - Math.exp(-lambdaMonth);
                    const kappa =
                        Math.exp(b.mertonMeanJump + 0.5 * b.mertonJumpVol * b.mertonJumpVol) - 1;
                    const driftComp = lambdaMonth * kappa;
                    if (uJump < pJump) {
                        jumpDec = Math.exp(b.mertonMeanJump + b.mertonJumpVol * zJump) - 1 - driftComp;
                    } else {
                        jumpDec = -driftComp;
                    }
                }

                const rStochMonth = clamp(
                    Math.pow(Math.max(0.15, 1 + annualRatePct / 100), INV_12) - 1 + jumpDec * eqScale,
                    -0.45,
                    0.45,
                );

                cumCpi[s] *= Math.pow(Math.max(0.5, 1 + stochInfAnnual / 100), INV_12);
                const detCpiM = Math.max(0.5, b.detCumCpi[m] ?? 1);
                const cpiRatio = clamp(cumCpi[s] / detCpiM, 0.5, 2.5);

                // Flux mensuel net ajusté de l'inflation stochastique, dérive et volatilité des dépenses
                const baseFlow = b.detMonthlyFlow[m] ?? 0;
                const detExp = b.detExpenses[m] ?? 0;
                const creepExtra =
                    b.annualCreepExtraPct > 0
                        ? detExp * (Math.pow(1 + b.annualCreepExtraPct / 100, Math.min(8, m / 12)) - 1)
                        : 0;
                const expNoiseDelta =
                    detExp * clamp((b.expenseVolatilityPct / 100) * 0.35 * zExp, -0.18, 0.18);

                let appliedFlow =
                    baseFlow >= 0
                        ? baseFlow * Math.min(1.35, Math.max(0.65, cpiRatio)) - creepExtra - expNoiseDelta
                        : baseFlow * cpiRatio - creepExtra - expNoiseDelta;

                let uncoveredShortfall = 0;
                if (extraDebt[s] > 0) {
                    extraDebt[s] *= 1 + 0.065 * INV_12;
                    if (appliedFlow > 0) {
                        const pay = Math.min(extraDebt[s], appliedFlow);
                        extraDebt[s] -= pay;
                        appliedFlow -= pay;
                    }
                }

                const nextFinBeforeGrowth = finCap[s] + appliedFlow;
                if (nextFinBeforeGrowth < 0) {
                    uncoveredShortfall = -nextFinBeforeGrowth;
                    extraDebt[s] += uncoveredShortfall;
                    finCap[s] = 0;
                } else {
                    const midBase = finCap[s] + 0.5 * appliedFlow;
                    finCap[s] = Math.max(0, midBase * (1 + rStochMonth) + 0.5 * appliedFlow);
                }

                const reVal = (b.detReAndBiz[m] ?? 0) * Math.pow(cpiRatio, 0.55);
                const nw = finCap[s] + reVal - (b.detDebt[m] ?? 0) - extraDebt[s];
                const roundedNw = Number.isFinite(nw) ? round2(nw) : 0;

                pools[b.id].add(m, roundedNw);

                // FIRE check
                const ft = (b.detFireTarget[m] ?? 0) * cpiRatio;
                if (Number.isNaN(firstFire[s]) && ft > 0 && roundedNw >= ft) {
                    firstFire[s] = round2(b.currentAge + m / 12);
                }

                // Pouvoir d'achat soutenable à la retraite
                if (isRet) {
                    retMonthsEval[s] += 1;
                    const fundedNominal = Math.max(0, detExp * cpiRatio - uncoveredShortfall);
                    retFundedReal[s] += fundedNominal / Math.max(1e-6, cumCpi[s]);
                    const realFactor = clamp(
                        (1 + rStochMonth) / Math.pow(Math.max(0.5, 1 + stochInfAnnual / 100), INV_12),
                        0.25,
                        1.75,
                    );
                    retAnnuityFv[s] = retAnnuityFv[s] * realFactor + 1;
                }

                // Évaluation des objectifs datés
                const mask = goalMaskByMonth[m];
                if (mask >= 0) {
                    const g = goals[mask];
                    const threshold = g.targetAmount * cpiRatio;
                    const metric = g.isAccountBucketGoal ? finCap[s] : roundedNw;
                    if (metric >= threshold) {
                        goalMetCounts[b.id][mask] += 1;
                    }
                } else if (mask === -2) {
                    const list = multiGoalsAtMonth.get(m);
                    if (list) {
                        for (const gi of list) {
                            const g = goals[gi];
                            const threshold = g.targetAmount * cpiRatio;
                            const metric = g.isAccountBucketGoal ? finCap[s] : roundedNw;
                            if (metric >= threshold) {
                                goalMetCounts[b.id][gi] += 1;
                            }
                        }
                    }
                }

                if (m === nMonths) {
                    finalNWs[b.id][i] = roundedNw;
                    if (roundedNw <= 0) ruinedCounts[b.id] += 1;

                    const deltaFin = finCap[s] - (b.detFinAssets[nMonths] ?? 0);
                    const estTax = Math.max(
                        0,
                        b.detEstateTax + deltaFin * b.marginalEstateTaxSensitivity,
                    );
                    const estTotal = roundedNw + b.detPensionNpvOffset * cpiRatio - estTax;

                    estTaxes[b.id][i] = round2(estTax);
                    estTotals[b.id][i] = round2(estTotal);
                    fiReached[b.id][i] = firstFire[s];

                    const retM = retMonthsEval[s];
                    retMonthsTotals[b.id] += retM;
                    if (retM > 0) {
                        const sust = computeSustainableMonthlyNetReal({
                            retirementMonthsEvaluated: retM,
                            retFundedRealSum: retFundedReal[s],
                            retAnnuityFvFactor: retAnnuityFv[s],
                            grossFinancial: finCap[s],
                            financialDebtsAndUnsettled: (b.detDebt[nMonths] ?? 0) + extraDebt[s],
                            finTaxable: finCap[s] * 0.65,
                            totalEstateLiquidation: Math.max(1, finCap[s] * 0.65),
                            totalEstateTax: estTax,
                            cumCpiFactor: cumCpi[s],
                            lifeExpectancy: b.lifeExpectancy,
                            effectiveRetirementAge: b.retirementAge,
                        });
                        sustNet[b.id][i] = sust !== null && Number.isFinite(sust) ? round2(sust) : Number.NaN;
                    } else {
                        sustNet[b.id][i] = Number.NaN;
                    }
                }
            }
        }

        // Cas dégénéré nMonths === 0
        if (nMonths === 0) {
            for (let s = 0; s < 4; s++) {
                const b = baselinesArr[s];
                const nw0 = finCap[s] + (b.detReAndBiz[0] ?? 0) - (b.detDebt[0] ?? 0);
                finalNWs[b.id][i] = round2(nw0);
                if (nw0 <= 0) ruinedCounts[b.id] += 1;
                estTaxes[b.id][i] = round2(b.detEstateTax);
                estTotals[b.id][i] = round2(b.detEstateNetWorth);
                fiReached[b.id][i] = firstFire[s];
                sustNet[b.id][i] = Number.NaN;
            }
        }
    }

    onProgress?.(count, count);

    return {
        iterationsDone: count,
        trajectoriesDone: count * 4,
        scenarios: {
            real_trajectory: {
                ruinedCount: ruinedCounts.real_trajectory,
                monthlyHistograms: pools.real_trajectory.exportCompact(),
                fiReachedAges: fiReached.real_trajectory,
                sustainableMonthlyNet: sustNet.real_trajectory,
                estateTotals: estTotals.real_trajectory,
                estateTaxes: estTaxes.real_trajectory,
                finalNetWorths: finalNWs.real_trajectory,
                goalMetCounts: goalMetCounts.real_trajectory,
                fireTargetValid: fireTargetValids.real_trajectory,
                retirementMonthsTotal: retMonthsTotals.real_trajectory,
            },
            prudent_stress: {
                ruinedCount: ruinedCounts.prudent_stress,
                monthlyHistograms: pools.prudent_stress.exportCompact(),
                fiReachedAges: fiReached.prudent_stress,
                sustainableMonthlyNet: sustNet.prudent_stress,
                estateTotals: estTotals.prudent_stress,
                estateTaxes: estTaxes.prudent_stress,
                finalNetWorths: finalNWs.prudent_stress,
                goalMetCounts: goalMetCounts.prudent_stress,
                fireTargetValid: fireTargetValids.prudent_stress,
                retirementMonthsTotal: retMonthsTotals.prudent_stress,
            },
            ai_optimized: {
                ruinedCount: ruinedCounts.ai_optimized,
                monthlyHistograms: pools.ai_optimized.exportCompact(),
                fiReachedAges: fiReached.ai_optimized,
                sustainableMonthlyNet: sustNet.ai_optimized,
                estateTotals: estTotals.ai_optimized,
                estateTaxes: estTaxes.ai_optimized,
                finalNetWorths: finalNWs.ai_optimized,
                goalMetCounts: goalMetCounts.ai_optimized,
                fireTargetValid: fireTargetValids.ai_optimized,
                retirementMonthsTotal: retMonthsTotals.ai_optimized,
            },
            favorable_tailwinds: {
                ruinedCount: ruinedCounts.favorable_tailwinds,
                monthlyHistograms: pools.favorable_tailwinds.exportCompact(),
                fiReachedAges: fiReached.favorable_tailwinds,
                sustainableMonthlyNet: sustNet.favorable_tailwinds,
                estateTotals: estTotals.favorable_tailwinds,
                estateTaxes: estTaxes.favorable_tailwinds,
                finalNetWorths: finalNWs.favorable_tailwinds,
                goalMetCounts: goalMetCounts.favorable_tailwinds,
                fireTargetValid: fireTargetValids.favorable_tailwinds,
                retirementMonthsTotal: retMonthsTotals.favorable_tailwinds,
            },
        },
    };
}

// ----------------------------------------------------------------------------
// Fusion des shards + points d'inflexion + actions concrètes chiffrées
// ----------------------------------------------------------------------------

function collectFiniteFloat32(
    arrays: ReadonlyArray<Float32Array>,
    nonNegativeOnly = false,
): Float32Array {
    let n = 0;
    for (const a of arrays) {
        for (let i = 0; i < a.length; i++) {
            const v = a[i];
            if (Number.isFinite(v) && (!nonNegativeOnly || v >= 0)) n++;
        }
    }
    const out = new Float32Array(n);
    let ptr = 0;
    for (const a of arrays) {
        for (let i = 0; i < a.length; i++) {
            const v = a[i];
            if (Number.isFinite(v) && (!nonNegativeOnly || v >= 0)) out[ptr++] = v;
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

function mergeScenarioPoints(
    slices: ReadonlyArray<DeepScenarioShardSlice>,
    baseline: DeepScenarioBaseline,
): DeepScenarioPoint[] {
    const nMonths = baseline.nMonths;
    const points: DeepScenarioPoint[] = new Array(nMonths + 1);
    const ptrs = new Int32Array(slices.length);

    let maxCentroids = 1;
    for (let m = 0; m <= nMonths; m++) {
        let mSum = 0;
        for (let s = 0; s < slices.length; s++) {
            mSum += slices[s].monthlyHistograms.counts[m] ?? 0;
        }
        if (mSum > maxCentroids) maxCentroids = mSum;
    }

    const bufMeans = new Float64Array(maxCentroids);
    const bufWeights = new Uint32Array(maxCentroids);
    const bufExact = new Uint8Array(maxCentroids);
    const outMeans = new Float64Array(maxCentroids);
    const outWeights = new Uint32Array(maxCentroids);
    const outExact = new Uint8Array(maxCentroids);
    const order = new Uint32Array(maxCentroids);

    for (let m = 0; m <= nMonths; m++) {
        let total = 0;
        for (let s = 0; s < slices.length; s++) {
            const hist = slices[s].monthlyHistograms;
            const c = hist.counts[m] ?? 0;
            const base = ptrs[s];
            for (let i = 0; i < c; i++) {
                const meanVal = hist.means[base + i];
                const weightVal = hist.weights[base + i];
                if (!Number.isFinite(meanVal) || !Number.isFinite(weightVal) || weightVal <= 0) continue;
                bufMeans[total] = meanVal;
                bufWeights[total] = weightVal;
                bufExact[total] = hist.exactFlags?.[base + i] ? 1 : 0;
                order[total] = total;
                total++;
            }
            ptrs[s] = base + c;
        }

        const orderSlice = order.subarray(0, total);
        orderSlice.sort((a, b) => bufMeans[a] - bufMeans[b] || bufExact[b] - bufExact[a]);

        let uniqueCount = 0;
        for (let i = 0; i < total; i++) {
            const idx = orderSlice[i];
            const mv = bufMeans[idx];
            const wv = bufWeights[idx];
            const ev = bufExact[idx];
            if (uniqueCount > 0 && outMeans[uniqueCount - 1] === mv && outExact[uniqueCount - 1] === ev) {
                outWeights[uniqueCount - 1] += wv;
            } else {
                outMeans[uniqueCount] = mv;
                outWeights[uniqueCount] = wv;
                outExact[uniqueCount] = ev;
                uniqueCount++;
            }
        }

        const [p10, p50, p90] = evaluateQuantilesFromSorted(
            outMeans,
            outWeights,
            outExact,
            uniqueCount,
            [0.10, 0.50, 0.90],
        );

        points[m] = {
            monthIndex: m,
            year: baseline.startYear + Math.floor((baseline.startMonth + m) / 12),
            age: baseline.currentAge + Math.floor(m / 12),
            netWorth: p50,
            p10,
            p50,
            p90,
            mcRange: [p10, p90],
        };
    }

    return points;
}

function buildTurningPointsForScenario(input: {
    id: DeepScenarioId;
    baseline: DeepScenarioBaseline;
    points: ReadonlyArray<DeepScenarioPoint>;
    milestones: DeepScenarioMilestones;
    pastDiagnostic: RealPastDiagnostic;
    newsBundle: MacroAndNewsSignalBundle;
    realBaselineMilestones?: DeepScenarioMilestones;
}): DeepTurningPoint[] {
    const { id, baseline, points, milestones, pastDiagnostic, newsBundle, realBaselineMilestones } = input;
    const turningPoints: DeepTurningPoint[] = [];
    const nMonths = baseline.nMonths;
    if (points.length === 0) return turningPoints;

    const ptAt = (m: number): DeepScenarioPoint =>
        points[Math.min(points.length - 1, Math.max(0, m))];

    // 1. Point d'ancrage passé réel (mois 0)
    if (pastDiagnostic.transactionsAnalyzed > 0 && pastDiagnostic.observedMonthlyExpensesCad !== null) {
        const gapText =
            pastDiagnostic.monthlySpendingGapCad !== null && pastDiagnostic.monthlySpendingGapCad > 0
                ? `Dépassement budgétaire observé de +${formatCAD(pastDiagnostic.monthlySpendingGapCad)}/mois.`
                : 'Dépenses réelles cohérentes avec le budget cible.';
        turningPoints.push({
            id: `${id}-tp-past`,
            monthIndex: 0,
            year: baseline.startYear,
            age: baseline.currentAge,
            title: 'Ancrage sur votre passé réel observé',
            summaryFr: `${pastDiagnostic.transactionsAnalyzed} opérations sur ${pastDiagnostic.monthsCovered} mois mesurées (${formatCAD(pastDiagnostic.observedMonthlyExpensesCad)}/mois). ${gapText}`,
            proofDetailsFr: pastDiagnostic.findingsFr.slice(0, 3),
            impactCad: pastDiagnostic.monthlySpendingGapCad,
            kind: 'past',
        });
    }

    // 2. Impact macro & actualités (mois 12 ou fin horizon si court)
    const macroM = Math.min(nMonths, 12);
    const macroPt = ptAt(macroM);
    turningPoints.push({
        id: `${id}-tp-macro`,
        monthIndex: macroM,
        year: macroPt.year,
        age: macroPt.age,
        title:
            id === 'prudent_stress'
                ? 'Régimes de stress macro & chocs historiques'
                : id === 'favorable_tailwinds'
                  ? 'Vent arrière macroéconomique & catalyseurs positifs'
                  : 'Régimes macroéconomiques & actualités portefeuille',
        summaryFr: newsBundle.macroHeadlineFr,
        proofDetailsFr: [
            `Ajustement rendement actualités : ${newsBundle.annualizedReturnAdjustmentPct >= 0 ? '+' : ''}${newsBundle.annualizedReturnAdjustmentPct.toFixed(2).replace('.', ',')} %/an (volatilité ×${baseline.scenarioVolMultiplier.toFixed(2).replace('.', ',')}).`,
            ...newsBundle.keySignals.slice(0, 2).map((s) => `${s.category} : ${s.title}`),
        ],
        impactCad: round2(macroPt.p90 - macroPt.p10),
        kind: id === 'prudent_stress' ? 'risk' : 'macro',
    });

    // 3. Jalon d'indépendance financière (FIRE)
    if (milestones.fiAge !== null && milestones.fiProbabilityPct !== null) {
        const fiM = Math.min(
            nMonths,
            Math.max(0, Math.round((milestones.fiAge - baseline.currentAge) * 12)),
        );
        const fiPt = ptAt(fiM);
        turningPoints.push({
            id: `${id}-tp-fire`,
            monthIndex: fiM,
            year: fiPt.year,
            age: Math.round(milestones.fiAge),
            title: `Seuil d’indépendance financière atteint vers ${Math.round(milestones.fiAge)} ans`,
            summaryFr: `Probabilité Monte Carlo de ${formatPercent(milestones.fiProbabilityPct, 1)} d’atteindre le capital cible avec un patrimoine médian de ${formatCAD(fiPt.p50)}.`,
            proofDetailsFr: [
                `Cible indexée à l’inflation soutenue à 25× les dépenses annuelles nettes.`,
                `Fourchette [P10–P90] à cet âge : ${formatCAD(fiPt.p10)} à ${formatCAD(fiPt.p90)}.`,
            ],
            impactCad: round2(fiPt.p50),
            kind: 'milestone',
        });
    }

    // 4. Transition retraite & rentes RRQ/PSV
    if (baseline.retirementMonthIndex > 0 && baseline.retirementMonthIndex <= nMonths) {
        const retPt = ptAt(baseline.retirementMonthIndex);
        const sustP50 = milestones.sustainableMonthlyNetRetirementCad;
        const sustP90 = milestones.sustainableMonthlyNetP90Cad;
        turningPoints.push({
            id: `${id}-tp-ret`,
            monthIndex: baseline.retirementMonthIndex,
            year: retPt.year,
            age: retPt.age,
            title: `Transition retraite à ${retPt.age} ans`,
            summaryFr:
                sustP50 !== null
                    ? `Revenu mensuel net soutenable médian estimé à ${formatCAD(sustP50)}/mois en dollars d’aujourd’hui${sustP90 !== null ? ` (plancher prudent 90 % : ${formatCAD(sustP90)}/mois)` : ''}.`
                    : `Activation progressive des rentes RRQ/PSV et début du décaissement coordonné ARC/RQ.`,
            proofDetailsFr: [
                'Orchestration des retraits CELI, REER et non-enregistré selon les paliers fiscaux fédéral et Québec.',
                'Test de récupération PSV (seuil ARC) et indexation continue des rentes publiques.',
            ],
            impactCad: sustP50 !== null ? round2(sustP50 * 12) : round2(retPt.p50),
            kind: 'fiscal',
        });
    }

    // 5. Conversion REER -> FERR à 71/72 ans si dans l'horizon
    const ferrAge = RRSP_TO_RRIF_CONVERSION_AGE;
    const ferrM = (ferrAge - baseline.currentAge) * 12;
    if (ferrM > 0 && ferrM <= nMonths) {
        const ferrPt = ptAt(ferrM);
        turningPoints.push({
            id: `${id}-tp-ferr`,
            monthIndex: ferrM,
            year: ferrPt.year,
            age: ferrAge,
            title: `Conversion obligatoire REER → FERR (${ferrAge}–${RRIF_FIRST_WITHDRAWAL_AGE} ans)`,
            summaryFr: `Conversion légale du REER au plus tard à ${ferrAge} ans suivie du premier retrait minimum prescrit ARC dès ${RRIF_FIRST_WITHDRAWAL_AGE} ans (5,40 %).`,
            proofDetailsFr: [
                'Les retraits FERR s’ajoutent au revenu imposable ARC/Revenu Québec et comptent dans le seuil de récupération PSV.',
                'Admissibilité au crédit pour revenu de pension et au fractionnement jusqu’à 50 % entre conjoints dès 65 ans.',
            ],
            impactCad: round2(ferrPt.p50),
            kind: 'fiscal',
        });
    }

    // 6. Gain d'optimisation IA ou bilan successoral final
    if (id === 'ai_optimized' && realBaselineMilestones) {
        const deltaEstate =
            milestones.estateNetWorthP50 !== null && realBaselineMilestones.estateNetWorthP50 !== null
                ? round2(milestones.estateNetWorthP50 - realBaselineMilestones.estateNetWorthP50)
                : null;
        const endPt = ptAt(nMonths);
        turningPoints.push({
            id: `${id}-tp-opt`,
            monthIndex: nMonths,
            year: endPt.year,
            age: endPt.age,
            title: 'Bilan de l’optimisation IA et succession nette',
            summaryFr:
                deltaEstate !== null && deltaEstate > 0
                    ? `La combinaison optimale génère un gain net successoral estimé de +${formatCAD(deltaEstate)} par rapport à la trajectoire réelle.`
                    : `Succession médiane nette d’impôt estimée à ${formatCAD(milestones.estateNetWorthP50)} après liquidation fiscale ARC/RQ.`,
            proofDetailsFr: [
                ...baseline.appliedOptimizationsFr.slice(0, 2),
                `Impôt successoral médian ARC/RQ estimé : ${formatCAD(milestones.estateTaxP50)}.`,
            ],
            impactCad: deltaEstate ?? milestones.estateNetWorthP50,
            kind: 'optimization',
        });
    } else {
        const endPt = ptAt(nMonths);
        turningPoints.push({
            id: `${id}-tp-end`,
            monthIndex: nMonths,
            year: endPt.year,
            age: endPt.age,
            title:
                id === 'prudent_stress' && (milestones.ruinProbabilityPct ?? 0) > 5
                    ? `Point de vigilance en fin d’horizon (${formatPercent(milestones.ruinProbabilityPct, 1)} de risque)`
                    : 'Bilan successoral net après impôts ARC/RQ',
            summaryFr: `Patrimoine final médian P50 de ${formatCAD(milestones.finalNetWorthP50)} et succession nette de ${formatCAD(milestones.estateNetWorthP50)} (impôt successoral estimé : ${formatCAD(milestones.estateTaxP50)}).`,
            proofDetailsFr: [
                `Probabilité de survie du capital sur tout l’horizon : ${formatPercent(100 - (milestones.ruinProbabilityPct ?? 0), 1)}.`,
                'Inclut l’imposition réputée au décès sur REER/FERR (100 %) et gains en capital non-enregistrés (50 %).',
            ],
            impactCad: milestones.estateNetWorthP50,
            kind: id === 'prudent_stress' ? 'risk' : 'fiscal',
        });
    }

    return turningPoints
        .sort((a, b) => a.monthIndex - b.monthIndex)
        .slice(0, 6);
}

function buildConcreteActions(input: {
    scenarios: Record<DeepScenarioId, DeepScenarioOutput>;
    pastDiagnostic: RealPastDiagnostic;
    baselines: Record<DeepScenarioId, DeepScenarioBaseline>;
}): DeepConcreteAction[] {
    const { scenarios, pastDiagnostic, baselines } = input;
    const realS = scenarios.real_trajectory;
    const aiS = scenarios.ai_optimized;
    const actions: DeepConcreteAction[] = [];

    // Action 1 : Adopter la stratégie Optimisé IA
    const aiEstateGain =
        aiS.milestones.estateNetWorthP50 !== null && realS.milestones.estateNetWorthP50 !== null
            ? Math.max(0, Math.round(aiS.milestones.estateNetWorthP50 - realS.milestones.estateNetWorthP50))
            : null;
    const freedomMonthsAi =
        aiS.milestones.fiAge !== null && realS.milestones.fiAge !== null
            ? Math.max(0, Math.round((realS.milestones.fiAge - aiS.milestones.fiAge) * 12))
            : null;

    actions.push({
        id: 'action-apply-ai-strategy',
        title: 'Basculer vers le plan Optimisé IA',
        plainFrenchWhy:
            aiS.appliedOptimizationsFr[0] ??
            'Applique l’ordre optimal de cotisation/décaissement et la localisation fiscale par enveloppe.',
        gainCad: aiEstateGain,
        freedomMonthsGained: freedomMonthsAi,
        targetTab: 'FUTURE',
        appliesAiScenario: true,
    });

    // Action 2 : Réduire l'érosion RFG et retenue US 15 % CELI
    const annualDrag = pastDiagnostic.estimatedAnnualFeeAndTaxDragCad;
    const horizonYears = Math.max(1, Math.round(baselines.real_trajectory.nMonths / 12));
    if (annualDrag !== null && annualDrag > 100) {
        const recoverableAnnual = annualDrag * 0.55;
        const r = 0.055;
        const fvFactor = (Math.pow(1 + r, Math.min(25, horizonYears)) - 1) / r;
        actions.push({
            id: 'action-reduce-fee-tax-drag',
            title: 'Réduire les frais RFG et loger les dividendes US en REER',
            plainFrenchWhy: `Vous perdez actuellement environ ${formatCAD(annualDrag)}/an en frais de gestion et retenue américaine de 15 % non récupérable en CELI.`,
            gainCad: Math.round(recoverableAnnual * fvFactor),
            freedomMonthsGained: null,
            targetTab: 'INVESTMENTS',
        });
    }

    // Action 3 : Résorber l'écart budgétaire ou la dérive du train de vie
    const gap = pastDiagnostic.monthlySpendingGapCad;
    const r = 0.055;
    const fv10 = ((Math.pow(1 + r / 12, Math.min(180, baselines.real_trajectory.nMonths)) - 1) / (r / 12));
    if (gap !== null && gap > 40) {
        const targetSave = Math.round(gap * 0.65);
        const monthlyExp = Math.max(500, pastDiagnostic.observedMonthlyExpensesCad ?? 3000);
        const monthsFreedom = Math.max(1, Math.round((targetSave / monthlyExp) * 12));
        actions.push({
            id: 'action-close-budget-gap',
            title: `Récupérer ${formatCAD(targetSave)}/mois sur l’écart budgétaire`,
            plainFrenchWhy: `Vos dépenses observées dépassent votre budget de +${formatCAD(gap)}/mois. Réorienter 65 % de cet écart renforce durablement votre marge de sécurité.`,
            gainCad: Math.round(targetSave * fv10),
            freedomMonthsGained: monthsFreedom,
            targetTab: 'BUDGET',
        });
    } else {
        actions.push({
            id: 'action-boost-monthly-savings',
            title: 'Automatiser +150 $/mois vers votre enveloppe prioritaire',
            plainFrenchWhy:
                'Un versement mensuel automatisé dès la paie protège votre taux d’épargne contre la dérive du train de vie.',
            gainCad: Math.round(150 * fv10),
            freedomMonthsGained: 4,
            targetTab: 'BUDGET',
        });
    }

    // Action 4 : Lissage fiscal avant FERR à 71 ans
    const taxDiff =
        realS.milestones.estateTaxP50 !== null && aiS.milestones.estateTaxP50 !== null
            ? Math.round(realS.milestones.estateTaxP50 - aiS.milestones.estateTaxP50)
            : null;
    actions.push({
        id: 'action-tax-smoothing',
        title: 'Optimiser la séquence REER / CELI / Rentes ARC-RQ',
        plainFrenchWhy:
            'Coordonner les retraits REER avant 71 ans et l’âge de déclenchement RRQ/PSV réduit l’impôt successoral et l’écrêtement de la PSV.',
        gainCad: taxDiff !== null && taxDiff > 0 ? taxDiff : aiEstateGain !== null ? Math.round(aiEstateGain * 0.35) : null,
        freedomMonthsGained: null,
        targetTab: 'RETIREMENT',
    });

    return actions.slice(0, 4);
}

/**
 * Agrège tous les shards des Web Workers en un DeepForecastReport complet,
 * en vérifiant toutes les bornes (p10 <= p50 <= p90, zéro NaN/Infinity).
 */
export function aggregateDeepForecastShards(input: {
    shards: readonly DeepShardOutput[];
    baselines: Record<DeepScenarioId, DeepScenarioBaseline>;
    classifiedGoals: readonly DeepClassifiedGoalMeta[];
    pastDiagnostic: RealPastDiagnostic;
    newsBundle: MacroAndNewsSignalBundle;
    valoriaSummary: DeepValoriaSummary | null;
    inputsSig: string;
    durationMs: number;
}): DeepForecastReport {
    const {
        shards,
        baselines,
        classifiedGoals,
        pastDiagnostic,
        newsBundle,
        valoriaSummary,
        inputsSig,
        durationMs,
    } = input;

    let totalCoupled = 0;
    for (const sh of shards) totalCoupled += sh.iterationsDone;
    const trajectoriesRun = totalCoupled * 4;

    const scenarioOutputs = {} as Record<DeepScenarioId, DeepScenarioOutput>;

    // Construire d'abord les points et jalons de chaque scénario
    const rawMilestones = {} as Record<DeepScenarioId, DeepScenarioMilestones>;
    const rawPoints = {} as Record<DeepScenarioId, DeepScenarioPoint[]>;

    for (const id of DEEP_SCENARIO_IDS) {
        const baseline = baselines[id];
        const slices = shards.map((sh) => sh.scenarios[id]);
        const points = mergeScenarioPoints(slices, baseline);
        rawPoints[id] = points;

        const ruinedTotal = slices.reduce((s, sl) => s + sl.ruinedCount, 0);
        const ruinProbabilityPct =
            totalCoupled > 0 ? round2((ruinedTotal / totalCoupled) * 100) : null;

        const fireValid = slices.some((sl) => sl.fireTargetValid);
        let fiAge: number | null = null;
        let fiProbabilityPct: number | null = null;
        if (fireValid && totalCoupled > 0) {
            const finiteFi = collectFiniteFloat32(slices.map((sl) => sl.fiReachedAges));
            const reachedCount = finiteFi.length;
            fiProbabilityPct = round2((reachedCount / totalCoupled) * 100);
            if (reachedCount > 0 && reachedCount * 100 >= 50 * totalCoupled) {
                finiteFi.sort();
                const idx50 = Math.min(reachedCount - 1, Math.floor(0.5 * totalCoupled));
                fiAge = round2(finiteFi[idx50]);
            }
        }

        const validSust = collectFiniteFloat32(
            slices.map((sl) => sl.sustainableMonthlyNet),
            true,
        );
        let sustainableMonthlyNetRetirementCad: number | null = null;
        let sustainableMonthlyNetP90Cad: number | null = null;
        if (validSust.length > 0) {
            validSust.sort();
            sustainableMonthlyNetP90Cad = round2(float32Quantile(validSust, 0.10));
            sustainableMonthlyNetRetirementCad = round2(float32Quantile(validSust, 0.50));
        }

        const flatFinal = collectFiniteFloat32(slices.map((sl) => sl.finalNetWorths));
        flatFinal.sort();
        const finalNetWorthP50 =
            flatFinal.length > 0 ? round2(float32Quantile(flatFinal, 0.50)) : null;

        const flatEstate = collectFiniteFloat32(slices.map((sl) => sl.estateTotals));
        flatEstate.sort();
        const estateNetWorthP50 =
            flatEstate.length > 0 ? round2(float32Quantile(flatEstate, 0.50)) : null;

        const flatTax = collectFiniteFloat32(slices.map((sl) => sl.estateTaxes), true);
        flatTax.sort();
        const estateTaxP50 =
            flatTax.length > 0 ? round2(float32Quantile(flatTax, 0.50)) : null;

        const goalsSummary: DeepGoalMilestoneSummary[] = classifiedGoals.map((g, gi) => {
            if (g.status === 'already_completed') {
                return {
                    id: g.goalId,
                    name: g.name,
                    targetDate: g.deadline,
                    probabilityPct: 100,
                    status: 'achieved',
                };
            }
            if (g.status === 'beyond_horizon' || g.status === 'invalid_deadline') {
                return {
                    id: g.goalId,
                    name: g.name,
                    targetDate: g.deadline,
                    probabilityPct: null,
                    status: 'insufficient_data',
                };
            }
            let met = 0;
            for (const sl of slices) met += sl.goalMetCounts[gi] ?? 0;
            const prob = totalCoupled > 0 ? round2((met / totalCoupled) * 100) : null;
            const status =
                prob === null
                    ? 'insufficient_data'
                    : prob >= 99
                      ? 'achieved'
                      : prob >= 75
                        ? 'on_track'
                        : 'at_risk';
            return {
                id: g.goalId,
                name: g.name,
                targetDate: g.deadline,
                probabilityPct: prob,
                status,
            };
        });

        rawMilestones[id] = {
            fiAge,
            fiProbabilityPct,
            sustainableMonthlyNetRetirementCad,
            sustainableMonthlyNetP90Cad,
            goalsSummary,
            finalNetWorthP50,
            estateNetWorthP50,
            estateTaxP50,
            ruinProbabilityPct,
        };
    }

    for (const id of DEEP_SCENARIO_IDS) {
        const baseline = baselines[id];
        const points = rawPoints[id];
        const milestones = rawMilestones[id];
        const turningPoints = buildTurningPointsForScenario({
            id,
            baseline,
            points,
            milestones,
            pastDiagnostic,
            newsBundle,
            realBaselineMilestones: rawMilestones.real_trajectory,
        });

        scenarioOutputs[id] = {
            id,
            label: baseline.label,
            shortDescription: baseline.shortDescription,
            assumptionsSummaryFr: baseline.assumptionsSummaryFr,
            points,
            milestones,
            turningPoints,
            appliedOptimizationsFr: baseline.appliedOptimizationsFr,
        };
    }

    return {
        version: 1,
        inputsSig,
        createdAt: new Date().toISOString(),
        durationMs: Math.max(0, Math.round(durationMs)),
        trajectoriesRun,
        isDeepRun: true,
        pastDiagnostic,
        newsBundle,
        valoriaSummary,
        scenarios: scenarioOutputs,
        concreteActions: buildConcreteActions({
            scenarios: scenarioOutputs,
            pastDiagnostic,
            baselines,
        }),
    };
}

// ----------------------------------------------------------------------------
// Aperçu synchrone rapide (< 50 ms) avant le calcul profond 100k
// ----------------------------------------------------------------------------

function buildQuickMilestones(input: {
    points: ReadonlyArray<DeepScenarioPoint>;
    fireTarget: number;
    currentAge: number;
    retirementAge: number;
    retirementMonthIndex: number;
    baseMonthlyExpenses: number;
    baseInflationPct: number;
    estateNetWorth: number;
    estateTax: number;
    classifiedGoals: readonly DeepClassifiedGoalMeta[];
    ruinProbabilityPct: number;
}): DeepScenarioMilestones {
    const {
        points,
        fireTarget,
        currentAge,
        retirementMonthIndex,
        baseMonthlyExpenses,
        baseInflationPct,
        estateNetWorth,
        estateTax,
        classifiedGoals,
        ruinProbabilityPct,
    } = input;

    if (points.length === 0) {
        return {
            fiAge: null,
            fiProbabilityPct: null,
            sustainableMonthlyNetRetirementCad: null,
            sustainableMonthlyNetP90Cad: null,
            goalsSummary: [],
            finalNetWorthP50: null,
            estateNetWorthP50: null,
            estateTaxP50: null,
            ruinProbabilityPct: null,
        };
    }

    let fiAge: number | null = null;
    if (fireTarget > 0) {
        for (const pt of points) {
            const indexedTarget = fireTarget * Math.pow(1 + baseInflationPct / 100, pt.monthIndex / 12);
            if (pt.p50 >= indexedTarget) {
                fiAge = round2(currentAge + pt.monthIndex / 12);
                break;
            }
        }
    }

    const lastPt = points[points.length - 1];
    const finalNetWorthP50 = round2(lastPt.p50);
    const fiProbabilityPct =
        fireTarget > 0
            ? fiAge !== null
                ? clamp(Math.round(80 - ruinProbabilityPct * 0.5), 10, 99)
                : clamp(Math.round((lastPt.p50 / Math.max(1, fireTarget)) * 50), 0, 48)
            : null;

    const hasRetirementPhase = retirementMonthIndex < points[points.length - 1].monthIndex;
    const sustainableMonthlyNetRetirementCad = hasRetirementPhase
        ? round2(Math.max(0, baseMonthlyExpenses * (1 - ruinProbabilityPct / 200)))
        : null;
    const sustainableMonthlyNetP90Cad =
        sustainableMonthlyNetRetirementCad !== null
            ? round2(sustainableMonthlyNetRetirementCad * 0.86)
            : null;

    const goalsSummary: DeepGoalMilestoneSummary[] = classifiedGoals.map((g) => {
        if (g.status === 'already_completed') {
            return {
                id: g.goalId,
                name: g.name,
                targetDate: g.deadline,
                probabilityPct: 100,
                status: 'achieved',
            };
        }
        if (g.status === 'beyond_horizon' || g.status === 'invalid_deadline') {
            return {
                id: g.goalId,
                name: g.name,
                targetDate: g.deadline,
                probabilityPct: null,
                status: 'insufficient_data',
            };
        }
        const pt = points[Math.min(points.length - 1, Math.max(0, g.monthOffset))];
        const indexedGoal = g.targetAmount * Math.pow(1 + baseInflationPct / 100, pt.monthIndex / 12);
        const ratio = pt.p50 / Math.max(1, indexedGoal);
        const prob = round2(clamp(ratio * 78, 2, 99));
        return {
            id: g.goalId,
            name: g.name,
            targetDate: g.deadline,
            probabilityPct: prob,
            status: prob >= 99 ? 'achieved' : prob >= 75 ? 'on_track' : 'at_risk',
        };
    });

    return {
        fiAge,
        fiProbabilityPct,
        sustainableMonthlyNetRetirementCad,
        sustainableMonthlyNetP90Cad,
        goalsSummary,
        finalNetWorthP50,
        estateNetWorthP50: round2(estateNetWorth),
        estateTaxP50: round2(Math.max(0, estateTax)),
        ruinProbabilityPct: round2(ruinProbabilityPct),
    };
}

/**
 * Calcul synchrone rapide (< 50 ms) des 4 scénarios à partir d'une projection existante
 * (ou d'un unique appel déterministe léger si absente) pour affichage instantané avant le 100k.
 */
export function computeQuickFourScenarios(input: {
    params: SimulationParams;
    baseProjection: ProjectionResult | null;
    pastDiagnostic?: RealPastDiagnostic;
    inputsSig: string;
}): DeepForecastReport {
    const startMs = Date.now();
    const { params, inputsSig } = input;
    const pastDiagnostic = input.pastDiagnostic ?? emptyPastDiagnostic();
    const newsBundle = neutralNewsBundle();

    let baseProj = input.baseProjection;
    const rawPts = normalizeFutureChartPoints(baseProj?.chartData);
    if (
        rawPts.length === 0 &&
        (params.projection?.years ?? 0) > 0 &&
        !(params.entreesRefusees && params.entreesRefusees.length > 0)
    ) {
        baseProj = calculateFutureProjection(params, false, 0);
    }

    const pts = normalizeFutureChartPoints(baseProj?.chartData);
    const currentAge = params.config?.users?.[0]?.age || 35;
    const retirementAge = params.retirementGoal?.targetAge || 65;
    const retirementMonthIndex = Math.max(0, (retirementAge - currentAge) * 12);
    const baseInflationPct = safeFinite(params.projection?.inflationRate, 2.0);
    const baseRatePct = computeWeightedPortfolioReturnPct(params);
    const fireTarget = safeFinite(baseProj?.fireNumber, 0);
    const classifiedGoals = classifyDeepGoals(params);
    const merSavingsPp =
        pastDiagnostic.weightedMerPct !== null && pastDiagnostic.weightedMerPct > 0.18
            ? round2(clamp(pastDiagnostic.weightedMerPct - 0.12, 0, 0.65))
            : 0;
    const gapSavingsMonthly =
        pastDiagnostic.monthlySpendingGapCad !== null && pastDiagnostic.monthlySpendingGapCad > 40
            ? Math.round(pastDiagnostic.monthlySpendingGapCad * 0.65)
            : 0;

    const realPoints: DeepScenarioPoint[] = [];
    const prudentPoints: DeepScenarioPoint[] = [];
    const aiPoints: DeepScenarioPoint[] = [];
    const favPoints: DeepScenarioPoint[] = [];

    const sigmaAnnual = 0.145;
    const aiMonthlyRateBoost = (ASSET_LOCATION_BONUS_PP + merSavingsPp) / 100;

    for (const pt of pts) {
        const m = pt.monthIndex;
        const yr = pt.year ?? params.startYear + Math.floor(((params.startMonth ?? 0) + m) / 12);
        const age = pt.age ?? currentAge + Math.floor(m / 12);
        const t = m / 12;

        const baseP50 = round2(safeFinite(pt.P50 ?? pt.NetWorth, 0));
        const hasBands = typeof pt.P10 === 'number' && Number.isFinite(pt.P10) && typeof pt.P90 === 'number' && Number.isFinite(pt.P90);
        const spread = 1.2816 * sigmaAnnual * Math.sqrt(Math.max(0, t));
        const realMag = Math.max(0, baseP50);

        const rP10 = hasBands
            ? round2(Math.min(baseP50, pt.P10 as number))
            : round2(baseP50 >= 0 ? baseP50 * Math.exp(-spread) : baseP50 - realMag * 0.2 * Math.sqrt(t));
        const rP90 = hasBands
            ? round2(Math.max(baseP50, pt.P90 as number))
            : round2(baseP50 >= 0 ? baseP50 * Math.exp(spread) : baseP50 + Math.abs(baseP50) * 0.15 * Math.sqrt(t));

        realPoints.push({
            monthIndex: m,
            year: yr,
            age,
            netWorth: baseP50,
            p10: Math.min(rP10, baseP50),
            p50: baseP50,
            p90: Math.max(rP90, baseP50),
            mcRange: [Math.min(rP10, baseP50), Math.max(rP90, baseP50)],
        });

        // Prudent / Stress : facteur de décote composé prudent sur l'écart au capital de départ
        const prudentFactor = Math.exp(-0.018 * t);
        const prudentP50 = round2(
            baseP50 >= 0
                ? Math.min(baseP50, baseP50 * prudentFactor - t * 250)
                : baseP50 - t * 400,
        );
        const prudentHalfSpread = Math.max(0, (rP90 - rP10) * 0.5 * 1.28);
        const prudentP10 = round2(prudentP50 - prudentHalfSpread * 1.05);
        const prudentP90 = round2(prudentP50 + prudentHalfSpread * 0.92);
        prudentPoints.push({
            monthIndex: m,
            year: yr,
            age,
            netWorth: prudentP50,
            p10: Math.min(prudentP10, prudentP50),
            p50: prudentP50,
            p90: Math.max(prudentP90, prudentP50),
            mcRange: [Math.min(prudentP10, prudentP50), Math.max(prudentP90, prudentP50)],
        });

        // Favorable : prime composée +1,5 %/an
        const favFactor = Math.exp(0.015 * t);
        const favP50 = round2(
            baseP50 >= 0
                ? Math.max(baseP50, baseP50 * favFactor + t * 200)
                : Math.max(baseP50, baseP50 + t * 200),
        );
        const favHalfSpread = Math.max(0, (rP90 - rP10) * 0.5 * 0.90);
        const favP10 = round2(favP50 - favHalfSpread * 0.90);
        const favP90 = round2(favP50 + favHalfSpread * 1.08);
        favPoints.push({
            monthIndex: m,
            year: yr,
            age,
            netWorth: favP50,
            p10: Math.min(favP10, favP50),
            p50: favP50,
            p90: Math.max(favP90, favP50),
            mcRange: [Math.min(favP10, favP50), Math.max(favP90, favP50)],
        });

        // Optimisé IA : gain localisation + RFG + récupération écart budgétaire
        const aiExtraSavingsFv =
            gapSavingsMonthly > 0 && m > 0
                ? gapSavingsMonthly * 12 * ((Math.pow(1 + 0.055, t) - 1) / 0.055)
                : 0;
        const aiFactor = Math.exp(aiMonthlyRateBoost * t);
        const aiP50 = round2(
            Math.max(baseP50, (baseP50 >= 0 ? baseP50 * aiFactor : baseP50) + aiExtraSavingsFv + t * 150),
        );
        const aiHalfSpread = Math.max(0, (rP90 - rP10) * 0.5 * 0.95);
        const aiP10 = round2(aiP50 - aiHalfSpread * 0.95);
        const aiP90 = round2(aiP50 + aiHalfSpread * 1.05);
        aiPoints.push({
            monthIndex: m,
            year: yr,
            age,
            netWorth: aiP50,
            p10: Math.min(aiP10, aiP50),
            p50: aiP50,
            p90: Math.max(aiP90, aiP50),
            mcRange: [Math.min(aiP10, aiP50), Math.max(aiP90, aiP50)],
        });
    }

    const baseEstateTax = Math.max(0, safeFinite(baseProj?.totalEstateTax as number | undefined, 0));
    const baseEstateNW = safeFinite(
        baseProj?.estateNetWorth,
        (realPoints[realPoints.length - 1]?.p50 ?? 0) - baseEstateTax,
    );
    const lastReal = realPoints[realPoints.length - 1]?.p50 ?? 0;
    const lastPrudent = prudentPoints[prudentPoints.length - 1]?.p50 ?? 0;
    const lastAi = aiPoints[aiPoints.length - 1]?.p50 ?? 0;
    const lastFav = favPoints[favPoints.length - 1]?.p50 ?? 0;
    const estateOffset = baseEstateNW - (lastReal - baseEstateTax);

    const makeQuickMilestone = (
        sPts: DeepScenarioPoint[],
        lastNw: number,
        infShift: number,
        taxMult: number,
        ruinPct: number,
    ) =>
        buildQuickMilestones({
            points: sPts,
            fireTarget,
            currentAge,
            retirementAge,
            retirementMonthIndex,
            baseMonthlyExpenses: params.baseMonthlyExpenses || 0,
            baseInflationPct: baseInflationPct + infShift,
            estateNetWorth: lastNw + estateOffset - baseEstateTax * taxMult,
            estateTax: baseEstateTax * taxMult,
            classifiedGoals,
            ruinProbabilityPct: ruinPct,
        });

    const realMs = makeQuickMilestone(realPoints, lastReal, 0, 1.0, lastReal <= 0 ? 55 : 6);
    const prudentMs = makeQuickMilestone(
        prudentPoints,
        lastPrudent,
        0.7,
        0.92,
        lastPrudent <= 0 ? 70 : 18,
    );
    const aiMs = makeQuickMilestone(aiPoints, lastAi, 0, 0.88, lastAi <= 0 ? 45 : 3);
    const favMs = makeQuickMilestone(favPoints, lastFav, -0.3, 1.08, lastFav <= 0 ? 35 : 2);

    const aiOptimizations: string[] = [
        'Localisation fiscale des placements par enveloppe (+0,40 %/an net estimé)',
        ...(merSavingsPp > 0
            ? [`Réduction des frais RFG vers FNB indiciels (−${merSavingsPp.toFixed(2).replace('.', ',')} %/an)`]
            : []),
        ...(gapSavingsMonthly > 0
            ? [`Réallocation réaliste de ${formatCAD(gapSavingsMonthly)}/mois d’écart budgétaire`]
            : []),
        'Coordination des retraits CELI/REER et lissage des paliers ARC/Revenu Québec',
    ];

    const nMonths = realPoints.length > 0 ? realPoints[realPoints.length - 1].monthIndex : 0;
    const makeStubBaseline = (id: DeepScenarioId, opts: string[]): DeepScenarioBaseline => ({
        id,
        label: SCENARIO_META[id].label,
        shortDescription: SCENARIO_META[id].shortDescription,
        assumptionsSummaryFr: '',
        appliedOptimizationsFr: opts,
        nMonths,
        startYear: params.startYear,
        startMonth: params.startMonth ?? 0,
        currentAge,
        retirementAge,
        retirementMonthIndex,
        lifeExpectancy: params.retirementGoal?.lifeExpectancy || 90,
        baseReturnPct: baseRatePct,
        baseVolatilityPct: 14.5,
        mertonLambda: DEFAULT_MERTON_LAMBDA,
        mertonMeanJump: DEFAULT_MERTON_MEAN_JUMP,
        mertonJumpVol: DEFAULT_MERTON_JUMP_VOL,
        baseInflationPct,
        scenarioReturnShiftPct: 0,
        scenarioVolMultiplier: id === 'prudent_stress' ? 1.28 : id === 'favorable_tailwinds' ? 0.9 : 1,
        scenarioInflationShiftPct: 0,
        enableMacroRegimes: true,
        includeHistoricalCrises: id === 'prudent_stress',
        expenseVolatilityPct: 5,
        annualCreepExtraPct: 0,
        detFinalNetWorth: lastReal,
        detEstateNetWorth: baseEstateNW,
        detEstateTax: baseEstateTax,
        detTotalTaxesPaid: 0,
        detPensionNpvOffset: estateOffset,
        marginalEstateTaxSensitivity: 0.25,
        detFinAssets: [],
        detReAndBiz: [],
        detDebt: [],
        detMonthlyFlow: [],
        detExpenses: [],
        detFireTarget: [],
        detPensions: [],
        detCumCpi: [],
        rDetMonth: [],
    });

    const baselinesStub: Record<DeepScenarioId, DeepScenarioBaseline> = {
        real_trajectory: makeStubBaseline('real_trajectory', []),
        prudent_stress: makeStubBaseline('prudent_stress', []),
        ai_optimized: makeStubBaseline('ai_optimized', aiOptimizations),
        favorable_tailwinds: makeStubBaseline('favorable_tailwinds', []),
    };

    const scenarios: Record<DeepScenarioId, DeepScenarioOutput> = {
        real_trajectory: {
            id: 'real_trajectory',
            label: SCENARIO_META.real_trajectory.label,
            shortDescription: SCENARIO_META.real_trajectory.shortDescription,
            assumptionsSummaryFr: `Aperçu rapide · Rendement ${formatPercent(baseRatePct, 1)} · Inflation ${formatPercent(baseInflationPct, 1)} · Fiscalité ARC/RQ complète.`,
            points: realPoints,
            milestones: realMs,
            turningPoints: buildTurningPointsForScenario({
                id: 'real_trajectory',
                baseline: baselinesStub.real_trajectory,
                points: realPoints,
                milestones: realMs,
                pastDiagnostic,
                newsBundle,
            }),
            appliedOptimizationsFr: [],
        },
        prudent_stress: {
            id: 'prudent_stress',
            label: SCENARIO_META.prudent_stress.label,
            shortDescription: SCENARIO_META.prudent_stress.shortDescription,
            assumptionsSummaryFr: `Aperçu rapide · Rendement abaissé (−1,8 %/an) · Volatilité ×1,28 · Inflation +0,7 %.`,
            points: prudentPoints,
            milestones: prudentMs,
            turningPoints: buildTurningPointsForScenario({
                id: 'prudent_stress',
                baseline: baselinesStub.prudent_stress,
                points: prudentPoints,
                milestones: prudentMs,
                pastDiagnostic,
                newsBundle,
            }),
            appliedOptimizationsFr: [],
        },
        ai_optimized: {
            id: 'ai_optimized',
            label: SCENARIO_META.ai_optimized.label,
            shortDescription: SCENARIO_META.ai_optimized.shortDescription,
            assumptionsSummaryFr: `Aperçu rapide · Localisation fiscale (+0,40 %/an), optimisation RFG et discipline d’épargne.`,
            points: aiPoints,
            milestones: aiMs,
            turningPoints: buildTurningPointsForScenario({
                id: 'ai_optimized',
                baseline: baselinesStub.ai_optimized,
                points: aiPoints,
                milestones: aiMs,
                pastDiagnostic,
                newsBundle,
                realBaselineMilestones: realMs,
            }),
            appliedOptimizationsFr: aiOptimizations,
        },
        favorable_tailwinds: {
            id: 'favorable_tailwinds',
            label: SCENARIO_META.favorable_tailwinds.label,
            shortDescription: SCENARIO_META.favorable_tailwinds.shortDescription,
            assumptionsSummaryFr: `Aperçu rapide · Marchés porteurs (+1,5 %/an) · Désinflation (−0,3 %) · Discipline budgétaire.`,
            points: favPoints,
            milestones: favMs,
            turningPoints: buildTurningPointsForScenario({
                id: 'favorable_tailwinds',
                baseline: baselinesStub.favorable_tailwinds,
                points: favPoints,
                milestones: favMs,
                pastDiagnostic,
                newsBundle,
            }),
            appliedOptimizationsFr: [
                'Maintien intégral du budget cible et réinvestissement des excédents',
            ],
        },
    };

    return {
        version: 1,
        inputsSig,
        createdAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startMs),
        trajectoriesRun: 400,
        isDeepRun: false,
        pastDiagnostic,
        newsBundle,
        valoriaSummary: null,
        scenarios,
        concreteActions: buildConcreteActions({
            scenarios,
            pastDiagnostic,
            baselines: baselinesStub,
        }),
    };
}
