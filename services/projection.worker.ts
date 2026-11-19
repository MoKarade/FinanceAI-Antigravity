// services/projection.worker.ts
// W1.1 — Web Worker pour exécuter calculateFutureProjection hors du thread principal.
// Évite de figer l'UI pendant les 50-100 itérations Monte Carlo (jusqu'à 3s).
//
// G21 C5 — gère aussi le mode 'strategySearch' : Monte Carlo sur chaque config
// de l'espace de recherche (sharding côté main thread). Poste des messages de
// progression intermédiaires ({ __progress }) pour alimenter une barre de
// progression et un watchdog côté main thread.
//
// Usage côté main thread:
//   const worker = new Worker(new URL('./projection.worker.ts', import.meta.url), { type: 'module' });
//   worker.postMessage({ params, runMC, selectedIdx, onlyStratTypes? });
//   worker.onmessage = (e) => setResult(e.data);

import {
    calculateFutureProjection,
    calculateStrategySearch,
    calculateTournamentStrategySearch,
    runGrandCalculShard,
    GRAND_CALCUL_ITERATIONS_DEFAULT,
    type SimulationParams,
    type StrategyConfig,
    type TournamentSearchOptions,
} from './projection';
import type { GrandCalculConfig, GrandCalculShardResult, ProjectionResult } from './projection/types';
import type { StrategySearchResult } from './projection/strategySearch';
import {
    computeDeepScenarioShard,
    type DeepShardOutput,
    type DeepShardRequest,
} from './projection/deepScenarioEngine';

// Payload entrant du main thread vers le worker.
interface RunMessage {
    __requestId?: string | number;
    params?: SimulationParams;
    runMC?: boolean;
    selectedIdx?: number;
    // [UI-SCEN] — types de scénarios demandés explicitement (panneau stress-tests).
    onlyStratTypes?: string[];
    mode?: 'projection' | 'strategySearch' | 'tournamentSearch' | 'grandCalculShard' | 'deepForecastShard';
    // G21 C5 commit 4 — mode 'strategySearch' : ce worker traite SA part de configs
    // (sharding fait côté main thread). iterations = sims MC par config.
    configs?: StrategyConfig[];
    iterations?: number;
    allowDeepIterations?: boolean;
    tournamentOptions?: Omit<TournamentSearchOptions, 'onProgress'>;
    // Mode 'grandCalculShard' : tranche d'itérations pour le pool Grand Calcul.
    grandCalculConfig?: GrandCalculConfig;
    startIter?: number;
    count?: number;
    // Mode 'deepForecastShard' : tranche de trajectoires couplées Futur 4.0 (4 scénarios).
    deepShardRequest?: DeepShardRequest;
}

// Payloads sortants du worker vers le main thread.
interface WorkerProgressMessage {
    __requestId: string | number | undefined;
    __progress: { done: number; total: number; simPerSec?: number; current?: string };
}

interface WorkerResultMessage {
    __requestId: string | number | undefined;
    result: ProjectionResult | StrategySearchResult | GrandCalculShardResult | DeepShardOutput;
}

interface WorkerErrorMessage {
    __requestId: string | number | undefined;
    __error: string;
    // F3 (audit 2026-05-28) — stack du worker transmise séparément pour ne pas la
    // perdre à la frontière postMessage (le main thread la réattache à l'Error).
    __errorStack?: string;
}

type WorkerOutMessage = WorkerProgressMessage | WorkerResultMessage | WorkerErrorMessage;

const workerSelf = self as unknown as {
    postMessage: (msg: WorkerOutMessage, transfer?: Transferable[]) => void;
};

/**
 * Collecte les ArrayBuffers des TypedArrays d'un shard Grand Calcul pour transfert zero-copy.
 * Utilise un Set<ArrayBuffer> afin d'éviter tout doublon susceptible de lever DataCloneError.
 */
function collectShardTransferables(shard: GrandCalculShardResult): Transferable[] {
    const buffers = new Set<ArrayBuffer>();
    const addIfView = (candidate: unknown) => {
        if (ArrayBuffer.isView(candidate) && candidate.buffer instanceof ArrayBuffer) {
            buffers.add(candidate.buffer);
        }
    };
    const compact = shard.monthlyHistogramsOrSamples;
    if (compact) {
        addIfView(compact.counts);
        addIfView(compact.means);
        addIfView(compact.weights);
        addIfView(compact.exactFlags);
    }
    addIfView(shard.fiReachedAges);
    addIfView(shard.sustainableMonthlyNetReal);
    addIfView(shard.estateTotals);
    addIfView(shard.estateFeds);
    addIfView(shard.estateQcs);
    addIfView(shard.estateRealTotals);
    addIfView(shard.finalNetWorths);
    addIfView(shard.deathAges);
    return Array.from(buffers);
}

/**
 * Collecte les ArrayBuffers des TypedArrays d'un shard Futur 4.0 (4 scénarios) pour transfert zero-copy.
 */
function collectDeepShardTransferables(shard: DeepShardOutput): Transferable[] {
    const buffers = new Set<ArrayBuffer>();
    const addIfView = (candidate: unknown) => {
        if (ArrayBuffer.isView(candidate) && candidate.buffer instanceof ArrayBuffer) {
            buffers.add(candidate.buffer);
        }
    };
    for (const slice of Object.values(shard.scenarios)) {
        if (!slice) continue;
        if (slice.monthlyHistograms) {
            addIfView(slice.monthlyHistograms.counts);
            addIfView(slice.monthlyHistograms.means);
            addIfView(slice.monthlyHistograms.weights);
            addIfView(slice.monthlyHistograms.exactFlags);
        }
        addIfView(slice.fiReachedAges);
        addIfView(slice.sustainableMonthlyNet);
        addIfView(slice.estateTotals);
        addIfView(slice.estateTaxes);
        addIfView(slice.finalNetWorths);
        addIfView(slice.goalMetCounts);
    }
    return Array.from(buffers);
}

self.onmessage = (e: MessageEvent<RunMessage>) => {
    // FIX silent-failure cycle 2 (HIGH): requestId obligatoire pour corréler
    // chaque réponse à son appel — évite les résultats croisés entre appels concurrents.
    const requestId = e.data.__requestId;
    const {
        params,
        runMC = false,
        selectedIdx = 0,
        onlyStratTypes,
        mode = 'projection',
        configs,
        iterations,
        allowDeepIterations,
        tournamentOptions,
        grandCalculConfig,
        startIter = 0,
        count = 0,
        deepShardRequest,
    } = e.data;
    try {
        if (mode === 'deepForecastShard') {
            if (!deepShardRequest) {
                throw new Error('deepShardRequest manquant pour le mode deepForecastShard.');
            }
            const result = computeDeepScenarioShard(
                deepShardRequest,
                (done, total) =>
                    workerSelf.postMessage({ __requestId: requestId, __progress: { done, total } }),
            );
            const transferables = collectDeepShardTransferables(result);
            if (transferables.length > 0) {
                workerSelf.postMessage({ __requestId: requestId, result }, transferables);
            } else {
                workerSelf.postMessage({ __requestId: requestId, result });
            }
            return;
        }
        if (!params) {
            throw new Error('Paramètres de simulation manquants pour le worker.');
        }
        if (mode === 'grandCalculShard') {
            const gcConfig: GrandCalculConfig = grandCalculConfig ?? {
                iterations: GRAND_CALCUL_ITERATIONS_DEFAULT,
                enableMacroRegimes: false,
                includeHistoricalCrises: false,
            };
            const result = runGrandCalculShard(
                params,
                gcConfig,
                startIter,
                count,
                (done, total) =>
                    workerSelf.postMessage({ __requestId: requestId, __progress: { done, total } }),
            );
            const transferables = collectShardTransferables(result);
            if (transferables.length > 0) {
                workerSelf.postMessage({ __requestId: requestId, result }, transferables);
            } else {
                workerSelf.postMessage({ __requestId: requestId, result });
            }
        } else if (mode === 'tournamentSearch') {
            const result = calculateTournamentStrategySearch(params, configs ?? [], {
                ...tournamentOptions,
                onProgress: (done, total, simPerSec) =>
                    workerSelf.postMessage({ __requestId: requestId, __progress: { done, total, simPerSec } }),
            });
            workerSelf.postMessage({ __requestId: requestId, result });
        } else if (mode === 'strategySearch') {
            const result = calculateStrategySearch(params, configs ?? [], {
                iterations,
                allowDeepIterations,
                onProgress: (done, total) =>
                    workerSelf.postMessage({ __requestId: requestId, __progress: { done, total } }),
            });
            workerSelf.postMessage({ __requestId: requestId, result });
        } else {
            const result = calculateFutureProjection(params, runMC, selectedIdx, onlyStratTypes);
            workerSelf.postMessage({ __requestId: requestId, result });
        }
    } catch (err) {
        // F3 (audit 2026-05-28) — `String(err)` écrasait la stack (debug aveugle des
        // crashes worker). On transmet message + stack séparément ; runAsync.ts
        // reconstruit l'Error et lui réattache la stack d'origine.
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        workerSelf.postMessage({ __requestId: requestId, __error: message, __errorStack: stack });
    }
};
