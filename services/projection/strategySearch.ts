// services/projection/strategySearch.ts
// G21 C5 commit 4 — recherche exhaustive : lance un Monte Carlo sur CHAQUE
// StrategyConfig de l'espace de recherche et collecte les métriques par config.
//
// PUR (hors RNG) : runScenario injecté en argument (comme monteCarlo.ts)
// → pas de dépendance circulaire avec projection.ts, et
// testable en Node avec un faux runScenario. Le sharding multi-worker est géré
// en amont (runAsync.ts) : ce module reçoit un sous-ensemble de configs et le
// traite séquentiellement.
//
// Deux sources de métriques par config :
//  - Monte Carlo (runMonteCarlo) → métriques de RISQUE (taux de succès, P10/P50/
//    P90, FVI, risque de séquence) : varie le monde par seed sur N itérations.
//  - Run DÉTERMINISTE (enableMonteCarlo=false) → chartData complet → impôt à vie
//    et âge FIRE du « chemin attendu ». En mode MC le chartData est allégé
//    (monthlyOutput.ts l.144 : {NetWorth, monthIndex} seulement), ces deux
//    métriques n'y sont donc pas disponibles.

import type { SimulationParams, AllocationStrategy, FutureScenarioType } from './types';
import { LEVER_LIBRARY, leverLabel, type EngineOverrides, type StrategyConfig } from './strategyConfig';
import { configToEngine } from './strategySpace';
import { lifetimeTaxTotal } from './lifetimeTax';
import { runMonteCarlo, MC_DEEP_ITERATIONS_MAX } from './monteCarlo';

export type RunScenarioFn = (
    params: SimulationParams,
    strategy: AllocationStrategy,
    enableMonteCarlo: boolean,
    delayPensions: boolean,
    mcIterationIndex: number,
    scenarioType?: FutureScenarioType,
    overrides?: EngineOverrides,
) => {
    chartData: { NetWorth: number; monthIndex?: number; age?: number; FluxImpots?: number; FireTarget?: number }[];
    finalNetWorth: number;
    estateNetWorth: number;
    totalTaxesPaid: number;
    /** [ENG-TTP-UNSETTLED-HORIZON] dette fiscale réconciliée non réglée à l'horizon (signée). */
    unsettledTaxAtHorizon?: number;
    /** [ENG-RANKTAX-ESTATE] impôt de liquidation successorale (décision Marc A4 : il entre
     *  dans l'objectif « impôt minimum » via lifetimeTaxTotal). */
    totalEstateTax?: number;
    totalGrowth: number;
    totalExpenses: number;
    minNetWorth: number;
    shortfallRate: number;
};

/** Métriques complètes d'une StrategyConfig évaluée par Monte Carlo + run déterministe. */
export interface ConfigResult {
    config: StrategyConfig;
    /** % des simulations MC où le patrimoine final reste > 0 (critère de survie). */
    successRate: number;
    /** Financial Vitality Index 0-100 (survie + sécurité + efficience + legs). */
    fvi: number;
    /** Patrimoine net final — centiles P5, P10, P25, P50, P75, P90, P95 et CVaR95. */
    finalNWp5?: number;
    finalNWp10: number;
    finalNWp25?: number;
    finalNWp50: number;
    finalNWp75?: number;
    finalNWp90: number;
    finalNWp95?: number;
    cvar95?: number;
    /** Impôt TOTAL du scénario (réglé du vivant + dette à l'horizon + successoral — A4). */
    lifetimeTax: number;
    /** Âge auquel l'indépendance financière (FIRE) est atteinte, ou null si jamais. */
    fireAge: number | null;
    /** % des runs fragilisés dans la décennie critique autour de la retraite. */
    sequenceRiskPct: number;
}

export interface StrategySearchResult {
    results: ConfigResult[];
    iterations: number;
    shapleyAttribution?: ShapleyAttributionItem[];
    roundsSummary?: TournamentRoundSummary[];
}

export interface RunStrategySearchOptions {
    /** Itérations MC par config. Borné [50, 1000] par défaut (ou [50, 10000] si allowDeepIterations=true). Défaut 1000. */
    iterations?: number;
    /** Autorise jusqu'à 10 000 itérations en mode Deep Compute / Tournoi. */
    allowDeepIterations?: boolean;
    /**
     * Appelé après chaque config évaluée : done = nb terminées, total = nb total.
     * Permet barre de progression + watchdog basé sur la progression (worker).
     */
    onProgress?: (done: number, total: number) => void;
}

const DEFAULT_ITERATIONS = 1000;
const MIN_ITERATIONS = 50;
const MAX_ITERATIONS = 1000;

const lastFinalNW = (trajectory: number[]): number =>
    trajectory.length ? trajectory[trajectory.length - 1] : 0;

/**
 * Âge FIRE depuis un chartData déterministe complet : 1er point où NetWorth
 * atteint la cible FIRE (déjà inflation-ajustée dans le moteur). null si jamais.
 */
function findFireAge(chartData: Array<{ NetWorth?: number; FireTarget?: number; age?: number }>): number | null {
    for (const point of chartData) {
        const target = point.FireTarget ?? 0;
        const netWorth = point.NetWorth ?? 0;
        if (target > 0 && netWorth >= target) return point.age ?? null;
    }
    return null;
}

/**
 * Évalue un sous-ensemble de StrategyConfig. Pour chaque config : clone params +
 * overrides (configToEngine), lance le MC (risque) + un run déterministe (impôt à
 * vie + âge FIRE). Déterministe car la RNG du moteur est seedée par
 * (scenarioType, strategy, iterationIndex).
 */
export function runStrategySearch(
    runScenario: RunScenarioFn,
    baseParams: SimulationParams,
    configs: ReadonlyArray<StrategyConfig>,
    opts: RunStrategySearchOptions = {},
): StrategySearchResult {
    const maxBound = opts.allowDeepIterations ? MC_DEEP_ITERATIONS_MAX : MAX_ITERATIONS;
    const iterations = Math.max(MIN_ITERATIONS, Math.min(maxBound, opts.iterations ?? DEFAULT_ITERATIONS));
    const total = configs.length;

    const results: ConfigResult[] = configs.map((config, idx) => {
        const { params, strategy, delayPensions, overrides } = configToEngine(config, baseParams);

        // Progression fractionnaire : config terminée = idx, + fraction du MC en cours.
        // Garantit un heartbeat régulier (sinon une config à 1000 sims = silence long
        // → le watchdog multi-worker tue le worker, cf. bug « sans progrès depuis 60s »).
        const heartbeat = (done: number, iterTotal: number) =>
            opts.onProgress?.(idx + done / iterTotal, total);

        const mc = runMonteCarlo(runScenario, params, strategy, delayPensions, iterations, overrides, heartbeat);
        const baseline = runScenario(params, strategy, false, delayPensions, 0, 'BASE', overrides);

        opts.onProgress?.(idx + 1, total);
        return {
            config,
            successRate: mc.successRate,
            fvi: mc.fvi,
            finalNWp5: mc.p5Data ? lastFinalNW(mc.p5Data) : undefined,
            finalNWp10: lastFinalNW(mc.p10Data),
            finalNWp25: mc.p25Data ? lastFinalNW(mc.p25Data) : undefined,
            finalNWp50: lastFinalNW(mc.p50Data),
            finalNWp75: mc.p75Data ? lastFinalNW(mc.p75Data) : undefined,
            finalNWp90: lastFinalNW(mc.p90Data),
            finalNWp95: mc.p95Data ? lastFinalNW(mc.p95Data) : undefined,
            cvar95: mc.cvar95 ?? undefined,
            // [ENG-TTP-UNSETTLED-HORIZON] + dette non réglée à l'horizon (un horizon court
            // sous-affichait : 8,6 % à 10 ans, 100 % à 1 an). [ENG-RANKTAX-ESTATE] + impôt
            // SUCCESSORAL (A4 : « impôt minimum » ne récompense plus le report — PRIO_CELI
            // 1er avec 1,3 M$ d'estate tax ignoré, panel #554). Source unique lifetimeTaxTotal.
            lifetimeTax: lifetimeTaxTotal(baseline),
            fireAge: findFireAge(baseline?.chartData ?? []),
            sequenceRiskPct: mc.expertMetrics.sequenceRiskPct,
        };
    });

    return { results, iterations };
}

// ============================================================================
// F19 & F20 — TOURNOI SUCCESSIVE HALVING AVEC CRN & ATTRIBUTION DE SHAPLEY
// ============================================================================

export interface ShapleyLeverInput {
    key: string;
    label: string;
    marginalValue: number;
}

export interface ShapleyAttributionItem {
    key: string;
    lever: string;
    label: string;
    gainDollars: number;
    percent: number;
    percentContribution: number;
    gainMonthsFreedom: number;
}

/**
 * F20 — Attribution marginale de Shapley normalisée (axiome d'efficacité + axiome du joueur nul).
 * Décompose l'écart exact (optimalValue - baseValue) entre les leviers actifs proportionnellement
 * à leur contribution marginale, et convertit chaque gain en mois d'indépendance financière (FIRE).
 */
export function computeShapleyAttribution(
    baseValue: number,
    optimalValue: number,
    levers: readonly ShapleyLeverInput[],
    monthlyExpenses: number = 4000,
): ShapleyAttributionItem[] {
    if (!levers || levers.length === 0) return [];
    const totalGain = optimalValue - baseValue;
    const safeMonthlyExpenses = Math.max(1, Number.isFinite(monthlyExpenses) && monthlyExpenses > 0 ? monthlyExpenses : 4000);

    const activeLevers = levers.filter(l => Math.abs(l.marginalValue) > 1e-9);
    if (activeLevers.length === 0 || Math.abs(totalGain) < 1e-9) {
        return levers.map(l => ({
            key: l.key,
            lever: l.key,
            label: l.label,
            gainDollars: 0,
            percent: 0,
            percentContribution: 0,
            gainMonthsFreedom: 0,
        }));
    }

    const rawAbsSum = levers.reduce((sum, l) => sum + Math.max(0, l.marginalValue), 0);
    const fallbackSum = levers.reduce((sum, l) => sum + l.marginalValue, 0);

    return levers.map(l => {
        if (Math.abs(l.marginalValue) <= 1e-9) {
            return {
                key: l.key,
                lever: l.key,
                label: l.label,
                gainDollars: 0,
                percent: 0,
                percentContribution: 0,
                gainMonthsFreedom: 0,
            };
        }
        let share: number;
        if (rawAbsSum > 0 && totalGain >= 0) {
            share = Math.max(0, l.marginalValue) / rawAbsSum;
        } else if (Math.abs(fallbackSum) > 1e-9) {
            share = l.marginalValue / fallbackSum;
        } else {
            share = 1 / activeLevers.length;
        }
        const gainDollars = totalGain * share;
        const percent = Math.abs(totalGain) > 1e-9 ? (gainDollars / totalGain) * 100 : 0;
        const gainMonthsFreedom = Math.round(gainDollars / safeMonthlyExpenses);
        return {
            key: l.key,
            lever: l.key,
            label: l.label,
            gainDollars,
            percent,
            percentContribution: percent,
            gainMonthsFreedom,
        };
    });
}

/**
 * Évalue la cascade de Shapley exacte entre une configuration de référence (`baselineConfig`)
 * et la configuration gagnante (`winnerConfig`) en isolant chaque levier modifié.
 */
export function evaluateShapleyForWinner(
    runScenario: RunScenarioFn,
    baseParams: SimulationParams,
    baselineConfig: StrategyConfig,
    winnerConfig: StrategyConfig,
    monthlyExpenses?: number,
): ShapleyAttributionItem[] {
    const evalDeterministic = (cfg: StrategyConfig): number => {
        const { params, strategy, delayPensions, overrides } = configToEngine(cfg, baseParams);
        const res = runScenario(params, strategy, false, delayPensions, 0, 'BASE', overrides);
        return res.estateNetWorth ?? res.finalNetWorth ?? 0;
    };

    const baseVal = evalDeterministic(baselineConfig);
    const optVal = evalDeterministic(winnerConfig);
    const diffLevers: ShapleyLeverInput[] = [];

    for (const leverDef of LEVER_LIBRARY) {
        const k = leverDef.key;
        if (baselineConfig[k] !== winnerConfig[k]) {
            const singleChanged: StrategyConfig = { ...baselineConfig, [k]: winnerConfig[k] };
            const withLeverVal = evalDeterministic(singleChanged);
            const withoutInWinner: StrategyConfig = { ...winnerConfig, [k]: baselineConfig[k] };
            const withoutLeverVal = evalDeterministic(withoutInWinner);
            const marginal = 0.5 * ((withLeverVal - baseVal) + (optVal - withoutLeverVal));
            diffLevers.push({
                key: String(k),
                label: leverLabel(k),
                marginalValue: marginal,
            });
        }
    }

    const effExpenses = monthlyExpenses ?? (baseParams.baseMonthlyExpenses > 0 ? baseParams.baseMonthlyExpenses : 4000);
    return computeShapleyAttribution(baseVal, optVal, diffLevers, effExpenses)
        .sort((a, b) => b.gainDollars - a.gainDollars);
}

interface TournamentRoundSummary {
    round: 1 | 2 | 3;
    candidatesIn: number;
    candidatesOut: number;
    iterationsPerCandidate: number;
}

export interface TournamentSearchOptions {
    round1Iterations?: number;
    round2Iterations?: number;
    round3Iterations?: number;
    round2TopK?: number;
    round3TopK?: number;
    crnBaseSeed?: number;
    baselineConfig?: StrategyConfig;
    onProgress?: (done: number, total: number, simPerSec?: number) => void;
}

export function computeTournamentCompositeScore(
    candidate: Pick<ConfigResult, 'successRate' | 'cvar95' | 'finalNWp10' | 'finalNWp50'>,
    maxP50: number,
    maxCvar: number,
): number {
    const survivalNorm = Math.max(0, Math.min(1, candidate.successRate / 100));
    const cvarVal = candidate.cvar95 ?? candidate.finalNWp10;
    const cvarNorm = maxCvar > 0 ? Math.max(-1, Math.min(1, cvarVal / maxCvar)) : 0;
    const p50Norm = maxP50 > 0 ? Math.max(-1, Math.min(1, candidate.finalNWp50 / maxP50)) : 0;
    return survivalNorm * 0.50 + cvarNorm * 0.30 + p50Norm * 0.20;
}

/**
 * F19 — Algorithme de Tournoi Multi-Phases (Successive Halving en 3 manches + Common Random Numbers).
 */
export function runTournamentStrategySearch(
    runScenario: RunScenarioFn,
    baseParams: SimulationParams,
    configs: ReadonlyArray<StrategyConfig>,
    opts: TournamentSearchOptions = {},
): StrategySearchResult {
    if (configs.length === 0) {
        return { results: [], iterations: 0, shapleyAttribution: [], roundsSummary: [] };
    }

    const r1Iters = Math.max(MIN_ITERATIONS, Math.min(MC_DEEP_ITERATIONS_MAX, opts.round1Iterations ?? 100));
    const r2Iters = Math.max(r1Iters, Math.min(MC_DEEP_ITERATIONS_MAX, opts.round2Iterations ?? 1000));
    const r3Iters = Math.max(r2Iters, Math.min(MC_DEEP_ITERATIONS_MAX, opts.round3Iterations ?? 5000));
    const top2K = Math.max(1, opts.round2TopK ?? 120);
    const top3K = Math.max(1, Math.min(top2K, opts.round3TopK ?? 20));
    const crnSeed = opts.crnBaseSeed ?? 0;

    const crnRunScenario: RunScenarioFn = (p, s, mc, d, iterIdx, st, ov) =>
        runScenario(p, s, mc, d, mc ? crnSeed + iterIdx : iterIdx, st, ov);

    const n1 = configs.length;
    const estN2 = Math.min(n1, top2K);
    const estN3 = Math.min(estN2, top3K);
    const totalSimBudget = n1 * r1Iters + estN2 * r2Iters + estN3 * r3Iters;
    let simsCompleted = 0;
    const startTimeMs = Date.now();

    const reportSimProgress = (extraSims: number) => {
        if (!opts.onProgress) return;
        const elapsedSec = Math.max(0.001, (Date.now() - startTimeMs) / 1000);
        const currentDone = Math.min(totalSimBudget, simsCompleted + extraSims);
        const simPerSec = Math.round(currentDone / elapsedSec);
        opts.onProgress(currentDone, totalSimBudget, simPerSec);
    };

    const rankAndSelect = (pool: ConfigResult[], keepCount: number): ConfigResult[] => {
        const survivors = pool.filter(c => c.successRate > 0);
        const eligible = survivors.length > 0 ? survivors : pool;
        const maxP50 = Math.max(1, ...eligible.map(c => Math.max(0, c.finalNWp50)));
        const maxCvar = Math.max(1, ...eligible.map(c => Math.max(0, c.cvar95 ?? c.finalNWp10)));
        return [...eligible]
            .sort((a, b) => computeTournamentCompositeScore(b, maxP50, maxCvar) - computeTournamentCompositeScore(a, maxP50, maxCvar))
            .slice(0, keepCount);
    };

    const roundsSummary: TournamentRoundSummary[] = [];

    const round1Res = runStrategySearch(crnRunScenario, baseParams, configs, {
        iterations: r1Iters,
        allowDeepIterations: true,
        onProgress: (doneCfg) => reportSimProgress(doneCfg * r1Iters),
    });
    simsCompleted += n1 * r1Iters;
    const qualifiedR2 = rankAndSelect(round1Res.results, top2K);
    roundsSummary.push({
        round: 1,
        candidatesIn: n1,
        candidatesOut: qualifiedR2.length,
        iterationsPerCandidate: r1Iters,
    });

    if (qualifiedR2.length === 0) {
        return { results: round1Res.results, iterations: r1Iters, shapleyAttribution: [], roundsSummary };
    }

    const round2Configs = qualifiedR2.map(r => r.config);
    const round2Res = runStrategySearch(crnRunScenario, baseParams, round2Configs, {
        iterations: r2Iters,
        allowDeepIterations: true,
        onProgress: (doneCfg) => reportSimProgress(doneCfg * r2Iters),
    });
    simsCompleted += round2Configs.length * r2Iters;
    const qualifiedR3 = rankAndSelect(round2Res.results, top3K);
    roundsSummary.push({
        round: 2,
        candidatesIn: round2Configs.length,
        candidatesOut: qualifiedR3.length,
        iterationsPerCandidate: r2Iters,
    });

    const round3Configs = qualifiedR3.map(r => r.config);
    const round3Res = runStrategySearch(crnRunScenario, baseParams, round3Configs, {
        iterations: r3Iters,
        allowDeepIterations: true,
        onProgress: (doneCfg) => reportSimProgress(doneCfg * r3Iters),
    });
    simsCompleted += round3Configs.length * r3Iters;
    const finalRanked = rankAndSelect(round3Res.results, round3Configs.length);
    roundsSummary.push({
        round: 3,
        candidatesIn: round3Configs.length,
        candidatesOut: finalRanked.length,
        iterationsPerCandidate: r3Iters,
    });

    reportSimProgress(0);

    const defaultBaseline: StrategyConfig = opts.baselineConfig ?? (Object.fromEntries(
        LEVER_LIBRARY.map(l => [l.key, l.default]),
    ) as unknown as StrategyConfig);
    const winnerCfg = finalRanked[0]?.config;
    const shapleyAttribution = winnerCfg
        ? evaluateShapleyForWinner(runScenario, baseParams, defaultBaseline, winnerCfg)
        : [];

    return {
        results: finalRanked,
        iterations: r3Iters,
        shapleyAttribution,
        roundsSummary,
    };
}
