// services/projection/runDeepForecastAsync.ts
// Orchestrateur asynchrone Futur 4.0 :
// 1. Audit du passé réel + pré-calcul des socles fiscaux ARC/RQ + plan d'optimisation IA
// 2. Collecte actualités / macro & fondamentaux Valoria (+ synthèse Gemini anonymisée si clé fournie)
// 3. Simulation Monte Carlo 100 000+ trajectoires couplées sur pool de 4 Web Workers zero-copy (ou fallback chunké JS)
// 4. Agrégation des 4 scénarios, points tournants chiffrés et actions concrètes

import type {
    Asset,
    Transaction,
    ValoriaRiskProfile,
} from '../../types';
import type { ProjectionResult, SimulationParams } from '../projection';
import {
    aggregateDeepForecastShards,
    computeDeepScenarioShard,
    DEFAULT_DEEP_TRAJECTORIES,
    exploreAiOptimizedStrategy,
    prepareDeepScenarioBaselines,
    type DeepShardOutput,
    type DeepShardRequest,
} from './deepScenarioEngine';
import type {
    DeepForecastPhase,
    DeepForecastProgress,
    DeepForecastReport,
} from './deepForecastTypes';
import {
    analyzeRealPastDossier,
    collectLiveNewsAndFundamentals,
    type RealPastAnalyzerInput,
} from './realPastAndNewsAnalyzer';
import { reconstructWorkerError, shardIterationRanges } from './runAsync';
import { messageDeRefus } from './verifierEntreesMoteur';
import { formatNumber } from '../../utils/format';

/** Erreur sentinelle : l'exécution Futur 4.0 a été annulée par l'appelant (pas un échec). */
export const DEEP_FORECAST_CANCELLED = '__DEEP_FORECAST_CANCELLED__';

const MAX_DEFAULT_WORKERS = 4;
const WORKER_IDLE_TIMEOUT_MS = 15 * 60_000;

export interface DeepForecastRunInput extends RealPastAnalyzerInput {
    params: SimulationParams;
    baseProjection?: ProjectionResult | null;
    valoriaRiskProfile?: ValoriaRiskProfile;
    apiKey?: string | null;
    inputsSig?: string;
}

export interface DeepForecastRunOptions {
    signal?: AbortSignal;
    onProgress?: (p: DeepForecastProgress) => void;
    trajectoriesOverride?: number;
    skipNetwork?: boolean;
    maxWorkers?: number;
    seed?: number;
}

function canonicalizeForSig(
    value: unknown,
    ancestors: WeakSet<object>,
    skipKeys?: ReadonlySet<string>,
): unknown {
    if (value === null) return null;
    switch (typeof value) {
        case 'boolean':
        case 'string':
            return value;
        case 'number':
            if (Number.isNaN(value)) return '__NaN__';
            if (value === Infinity) return '__Inf__';
            if (value === -Infinity) return '__-Inf__';
            return Object.is(value, -0) ? 0 : value;
        case 'bigint':
            return `${value.toString()}n`;
        case 'undefined':
        case 'function':
        case 'symbol':
            return '__undef__';
        case 'object': {
            const obj = value as object;
            if (ancestors.has(obj)) return '[Circular]';
            ancestors.add(obj);
            try {
                if (obj instanceof Date) {
                    return Number.isNaN(obj.getTime()) ? '__InvalidDate__' : obj.toISOString();
                }
                if (Array.isArray(obj)) {
                    return obj.map((item) => canonicalizeForSig(item, ancestors, skipKeys));
                }
                if (ArrayBuffer.isView(obj)) {
                    const view = obj instanceof DataView
                        ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
                        : (obj as unknown as ArrayLike<number | bigint>);
                    return Array.from(view, (item) => canonicalizeForSig(item, ancestors, skipKeys));
                }
                if (obj instanceof Set) {
                    return Array.from(obj, (item) => canonicalizeForSig(item, ancestors, skipKeys));
                }
                if (obj instanceof Map) {
                    return Array.from(obj.entries()).map(([k, v]) => [
                        canonicalizeForSig(k, ancestors, skipKeys),
                        canonicalizeForSig(v, ancestors, skipKeys),
                    ]);
                }
                const out: Record<string, unknown> = {};
                const record = obj as Record<string, unknown>;
                const keys = Object.keys(record).sort();
                for (const key of keys) {
                    if (skipKeys?.has(key)) continue;
                    const prop = record[key];
                    if (prop === undefined || typeof prop === 'function' || typeof prop === 'symbol') {
                        continue;
                    }
                    out[key] = canonicalizeForSig(prop, ancestors, skipKeys);
                }
                return out;
            } finally {
                ancestors.delete(obj);
            }
        }
        default:
            return '__undef__';
    }
}

function doubleFnv1a32(text: string): [number, number] {
    let h1 = 0x811c9dc5;
    let h2 = 0x050c5d1f;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 ^= code;
        h1 = Math.imul(h1, 0x01000193);
        h2 ^= code + (i & 0xff);
        h2 = Math.imul(h2, 0x01000193);
    }
    return [h1 >>> 0, h2 >>> 0];
}

/**
 * Calcule une signature déterministe des entrées Futur 4.0 (paramètres projection,
 * historique réel des transactions, portefeuille et profil Valoria).
 * Ignore `params.entreesRefusees`, normalise `-0` en `0`, distingue `NaN`/`Infinity`/`-Infinity`,
 * reste insensible à l'ordre des clés ou aux propriétés `undefined` et tolère les cycles.
 */
export function computeDeepForecastInputsSig(input: {
    params: SimulationParams;
    transactions?: readonly Transaction[];
    assets?: readonly Asset[];
    valoriaRiskProfile?: ValoriaRiskProfile;
}): string {
    try {
        const canonicalPayload = {
            params: canonicalizeForSig(
                input.params,
                new WeakSet<object>(),
                new Set(['entreesRefusees']),
            ),
            transactions: canonicalizeForSig(input.transactions ?? [], new WeakSet<object>()),
            assets: canonicalizeForSig(input.assets ?? [], new WeakSet<object>()),
            valoriaRiskProfile: canonicalizeForSig(
                input.valoriaRiskProfile ?? null,
                new WeakSet<object>(),
            ),
        };
        const json = JSON.stringify(canonicalPayload) ?? '';
        const [h1, h2] = doubleFnv1a32(json);
        return `df1:${h1.toString(36)}:${h2.toString(36)}:${json.length.toString(36)}`;
    } catch {
        return 'df1:invalid';
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new Error(DEEP_FORECAST_CANCELLED);
    }
}

function deriveSeedFromSig(sig: string, override?: number): number {
    if (typeof override === 'number' && Number.isFinite(override)) {
        return Math.trunc(override);
    }
    const [h1] = doubleFnv1a32(sig);
    return (h1 & 0x7fffffff) || 20260401;
}

function emitProgressSafe(
    onProgress: ((p: DeepForecastProgress) => void) | undefined,
    payload: {
        phase: DeepForecastPhase;
        phaseIndex: number;
        phaseLabel: string;
        percent: number;
        trajectoriesDone: number;
        trajectoriesTotal: number;
        etaSeconds: number | null;
    },
): void {
    if (!onProgress) return;
    onProgress({
        phase: payload.phase,
        phaseIndex: payload.phaseIndex,
        phaseTotal: 4,
        phaseLabel: payload.phaseLabel,
        percent: Math.max(0, Math.min(100, Math.round(payload.percent * 10) / 10)),
        trajectoriesDone: Math.max(0, Math.round(payload.trajectoriesDone)),
        trajectoriesTotal: Math.max(0, Math.round(payload.trajectoriesTotal)),
        etaSeconds: payload.etaSeconds,
    });
}

async function runChunkedFallbackShards(
    coupledCount: number,
    seed: number,
    baselines: DeepShardRequest['baselines'],
    classifiedGoals: DeepShardRequest['classifiedGoals'],
    trajectoriesTotal: number,
    opts: {
        signal?: AbortSignal;
        onProgress?: (p: DeepForecastProgress) => void;
        mcStartMs: number;
    },
): Promise<DeepShardOutput[]> {
    const targetChunks = Math.max(4, Math.min(20, Math.ceil(coupledCount / 1250)));
    const ranges = shardIterationRanges(coupledCount, Math.min(targetChunks, coupledCount));
    const shards: DeepShardOutput[] = [];
    let completedBefore = 0;

    const emitMcProgress = (localDone: number) => {
        const doneCoupled = Math.min(coupledCount, Math.max(0, completedBefore + localDone));
        const ratio = coupledCount > 0 ? doneCoupled / coupledCount : 1;
        const elapsedSec = Math.max(0.05, (Date.now() - opts.mcStartMs) / 1000);
        const etaSeconds =
            doneCoupled > 0
                ? doneCoupled >= coupledCount
                    ? 0
                    : Math.max(0, Math.round((elapsedSec * (coupledCount - doneCoupled)) / doneCoupled))
                : null;
        emitProgressSafe(opts.onProgress, {
            phase: 'monte_carlo_100k',
            phaseIndex: 3,
            phaseLabel: `Simulation profonde multi-régimes (${formatNumber(doneCoupled * 4)} / ${formatNumber(trajectoriesTotal)} trajectoires)…`,
            percent: 30 + ratio * 62,
            trajectoriesDone: doneCoupled * 4,
            trajectoriesTotal,
            etaSeconds,
        });
    };

    for (let idx = 0; idx < ranges.length; idx++) {
        throwIfAborted(opts.signal);
        const range = ranges[idx];
        const req: DeepShardRequest = {
            baselines,
            classifiedGoals,
            startIter: range.startIter,
            count: range.count,
            seed,
        };
        const shard = computeDeepScenarioShard(req, (done) => {
            emitMcProgress(done);
        });
        shards.push(shard);
        completedBefore += range.count;
        emitMcProgress(0);

        if (idx < ranges.length - 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            throwIfAborted(opts.signal);
        }
    }

    return shards;
}

async function runWorkerPoolShards(
    coupledCount: number,
    seed: number,
    baselines: DeepShardRequest['baselines'],
    classifiedGoals: DeepShardRequest['classifiedGoals'],
    trajectoriesTotal: number,
    opts: {
        signal?: AbortSignal;
        onProgress?: (p: DeepForecastProgress) => void;
        maxWorkers?: number;
        mcStartMs: number;
    },
): Promise<DeepShardOutput[]> {
    const hardware =
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency
            ? Math.min(navigator.hardwareConcurrency, MAX_DEFAULT_WORKERS)
            : MAX_DEFAULT_WORKERS;
    const requested =
        typeof opts.maxWorkers === 'number' && Number.isFinite(opts.maxWorkers)
            ? Math.max(1, Math.floor(opts.maxWorkers))
            : hardware;
    const nWorkers = Math.max(1, Math.min(requested, MAX_DEFAULT_WORKERS, coupledCount));
    const ranges = shardIterationRanges(coupledCount, nWorkers);

    const workers: Worker[] = [];
    const watchdogs: Array<ReturnType<typeof setTimeout> | undefined> = new Array(ranges.length).fill(
        undefined,
    );
    const perShardDone = new Array<number>(ranges.length).fill(0);
    const shardResults: Array<DeepShardOutput | null> = new Array(ranges.length).fill(null);

    const emitPoolProgress = () => {
        const doneCoupled = Math.min(
            coupledCount,
            perShardDone.reduce((sum, val) => sum + val, 0),
        );
        const ratio = coupledCount > 0 ? doneCoupled / coupledCount : 1;
        const elapsedSec = Math.max(0.05, (Date.now() - opts.mcStartMs) / 1000);
        const etaSeconds =
            doneCoupled > 0
                ? doneCoupled >= coupledCount
                    ? 0
                    : Math.max(0, Math.round((elapsedSec * (coupledCount - doneCoupled)) / doneCoupled))
                : null;
        emitProgressSafe(opts.onProgress, {
            phase: 'monte_carlo_100k',
            phaseIndex: 3,
            phaseLabel: `Simulation profonde Web Workers (${formatNumber(doneCoupled * 4)} / ${formatNumber(trajectoriesTotal)} trajectoires)…`,
            percent: 30 + ratio * 62,
            trajectoriesDone: doneCoupled * 4,
            trajectoriesTotal,
            etaSeconds,
        });
    };

    return new Promise<DeepShardOutput[]>((resolve, reject) => {
        let settled = false;

        const cleanupAll = () => {
            for (let i = 0; i < watchdogs.length; i++) {
                if (watchdogs[i] !== undefined) {
                    clearTimeout(watchdogs[i]);
                    watchdogs[i] = undefined;
                }
            }
            for (const w of workers) {
                try {
                    w.terminate();
                } catch {
                    /* ignore worker termination errors */
                }
            }
            opts.signal?.removeEventListener('abort', onAbort);
        };

        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanupAll();
            reject(err);
        };

        function onAbort() {
            fail(new Error(DEEP_FORECAST_CANCELLED));
        }

        if (opts.signal) {
            if (opts.signal.aborted) {
                fail(new Error(DEEP_FORECAST_CANCELLED));
                return;
            }
            opts.signal.addEventListener('abort', onAbort, { once: true });
        }

        const tryResolve = () => {
            if (settled) return;
            if (shardResults.some((r) => r === null)) return;
            settled = true;
            cleanupAll();
            resolve(shardResults as DeepShardOutput[]);
        };

        for (let k = 0; k < ranges.length; k++) {
            if (settled) break;
            const range = ranges[k];
            let worker: Worker;
            try {
                worker = new Worker(new URL('../projection.worker.ts', import.meta.url), {
                    type: 'module',
                });
            } catch (err) {
                fail(new Error('Pool worker Futur 4.0 indisponible : ' + String(err)));
                break;
            }
            workers.push(worker);

            const armWatchdog = () => {
                if (settled) return;
                if (watchdogs[k] !== undefined) clearTimeout(watchdogs[k]);
                watchdogs[k] = setTimeout(
                    () =>
                        fail(
                            new Error(
                                `Futur 4.0 : worker ${k} inactif depuis ${WORKER_IDLE_TIMEOUT_MS}ms`,
                            ),
                        ),
                    WORKER_IDLE_TIMEOUT_MS,
                );
            };

            const onMessage = (e: MessageEvent) => {
                if (settled || !e.data || e.data.__requestId !== k) return;
                if (e.data.__progress) {
                    const rawDone = Number(e.data.__progress.done);
                    perShardDone[k] = Math.min(
                        range.count,
                        Math.max(0, Number.isFinite(rawDone) ? rawDone : 0),
                    );
                    try {
                        emitPoolProgress();
                    } catch (err) {
                        fail(err instanceof Error ? err : new Error(String(err)));
                        return;
                    }
                    if (!settled) armWatchdog();
                    return;
                }
                if (e.data.__error) {
                    fail(reconstructWorkerError(e.data, `Worker Futur 4.0 ${k}: `));
                    return;
                }
                if (watchdogs[k] !== undefined) {
                    clearTimeout(watchdogs[k]);
                    watchdogs[k] = undefined;
                }
                shardResults[k] = e.data.result as DeepShardOutput;
                perShardDone[k] = range.count;
                try {
                    emitPoolProgress();
                } catch (err) {
                    fail(err instanceof Error ? err : new Error(String(err)));
                    return;
                }
                tryResolve();
            };

            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', (ev) =>
                fail(new Error(`Worker Futur 4.0 ${k} error: ${ev.message}`)),
            );
            worker.addEventListener('messageerror', () =>
                fail(new Error(`Worker Futur 4.0 ${k} messageerror`)),
            );

            armWatchdog();
            const deepShardRequest: DeepShardRequest = {
                baselines,
                classifiedGoals,
                startIter: range.startIter,
                count: range.count,
                seed,
            };
            try {
                worker.postMessage({
                    __requestId: k,
                    mode: 'deepForecastShard',
                    deepShardRequest,
                });
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
                break;
            }
        }
    });
}

/**
 * Exécute le moteur complet Futur 4.0 :
 * 1. Audit du passé réel et pré-sélection du plan d'optimisation IA ARC/RQ
 * 2. Collecte actualités / macro & Valoria (+ synthèse Gemini 100 % anonymisée si disponible)
 * 3. Simulation 100 000+ trajectoires couplées sur 4 Web Workers zero-copy (ou fallback chunké JS)
 * 4. Agrégation des 4 scénarios, jalons, points tournants chiffrés et actions concrètes.
 */
export async function runDeepForecastAsync(
    input: DeepForecastRunInput,
    opts: DeepForecastRunOptions = {},
): Promise<DeepForecastReport> {
    const { signal, onProgress } = opts;
    throwIfAborted(signal);

    if (input.params.entreesRefusees && input.params.entreesRefusees.length > 0) {
        throw new Error(messageDeRefus(input.params.entreesRefusees));
    }

    const runStartMs = Date.now();
    const rawOverride = opts.trajectoriesOverride;
    const requestedTotal =
        typeof rawOverride === 'number' && Number.isFinite(rawOverride) && rawOverride > 0
            ? Math.round(rawOverride)
            : DEFAULT_DEEP_TRAJECTORIES;
    const coupledCount = Math.max(1, Math.round(requestedTotal / 4));
    const trajectoriesTotal = coupledCount * 4;

    const inputsSig =
        input.inputsSig ||
        computeDeepForecastInputsSig({
            params: input.params,
            transactions: input.transactions,
            assets: input.assets,
            valoriaRiskProfile: input.valoriaRiskProfile,
        });
    const seed = deriveSeedFromSig(inputsSig, opts.seed);

    // Phase 1 : Audit du passé réel & exploration stratégique ARC/RQ
    emitProgressSafe(onProgress, {
        phase: 'past_audit',
        phaseIndex: 1,
        phaseLabel: 'Audit de l’historique réel et calibrage fiscal ARC/Revenu Québec…',
        percent: 5,
        trajectoriesDone: 0,
        trajectoriesTotal,
        etaSeconds: null,
    });

    const pastDiagnostic = analyzeRealPastDossier({
        transactions: input.transactions,
        assets: input.assets,
        fxRates: input.fxRates,
        debts: input.debts ?? input.params.debts,
        budgetItems: input.budgetItems,
        realEstateGoals: input.realEstateGoals ?? input.params.realEstateGoals,
        config: input.config ?? input.params.config,
        projection: input.projection ?? input.params.projection,
        retirementGoal: input.retirementGoal ?? input.params.retirementGoal,
        calculatedStartingCash: input.params.calculatedStartingCash,
        referenceDateIso: input.referenceDateIso,
    });
    throwIfAborted(signal);

    const precomputedAiPlan = exploreAiOptimizedStrategy({
        params: input.params,
        pastDiagnostic,
    });
    throwIfAborted(signal);

    emitProgressSafe(onProgress, {
        phase: 'past_audit',
        phaseIndex: 1,
        phaseLabel: 'Historique réel audité — passage aux signaux macro et actualités…',
        percent: 16,
        trajectoriesDone: 0,
        trajectoriesTotal,
        etaSeconds: null,
    });

    // Phase 2 : Actualités, macro, fondamentaux Valoria (+ Gemini anonymisé optionnel)
    emitProgressSafe(onProgress, {
        phase: 'news_and_fundamentals',
        phaseIndex: 2,
        phaseLabel: 'Analyse des actualités de marché, fondamentaux et frais RFG…',
        percent: 20,
        trajectoriesDone: 0,
        trajectoriesTotal,
        etaSeconds: null,
    });

    const { newsBundle, valoriaForecast } = await collectLiveNewsAndFundamentals({
        params: input.params,
        assets: input.assets ? [...input.assets] : undefined,
        fxRates: input.fxRates,
        valoriaRiskProfile: input.valoriaRiskProfile,
        apiKey: input.apiKey,
        signal,
        skipNetwork: opts.skipNetwork,
    });
    throwIfAborted(signal);

    const { baselines, classifiedGoals, valoriaSummary } = prepareDeepScenarioBaselines({
        params: input.params,
        pastDiagnostic,
        newsBundle,
        valoriaForecast,
        precomputedAiPlan,
    });
    throwIfAborted(signal);

    emitProgressSafe(onProgress, {
        phase: 'news_and_fundamentals',
        phaseIndex: 2,
        phaseLabel: 'Socles fiscaux prêts — lancement du moteur Monte Carlo…',
        percent: 30,
        trajectoriesDone: 0,
        trajectoriesTotal,
        etaSeconds: null,
    });

    // Phase 3 : Simulation Monte Carlo 100 000+ trajectoires (Web Workers ou fallback chunké)
    const mcStartMs = Date.now();
    const shards =
        typeof Worker === 'undefined'
            ? await runChunkedFallbackShards(
                  coupledCount,
                  seed,
                  baselines,
                  classifiedGoals,
                  trajectoriesTotal,
                  { signal, onProgress, mcStartMs },
              )
            : await runWorkerPoolShards(
                  coupledCount,
                  seed,
                  baselines,
                  classifiedGoals,
                  trajectoriesTotal,
                  { signal, onProgress, maxWorkers: opts.maxWorkers, mcStartMs },
              );
    throwIfAborted(signal);

    // Phase 4 : Agrégation finale, points tournants et actions concrètes
    emitProgressSafe(onProgress, {
        phase: 'ai_optimization',
        phaseIndex: 4,
        phaseLabel: 'Synthèse des 4 scénarios, tournants clés et actions chiffrées…',
        percent: 95,
        trajectoriesDone: trajectoriesTotal,
        trajectoriesTotal,
        etaSeconds: 0,
    });

    const durationMs = Math.max(1, Date.now() - runStartMs);
    const report = aggregateDeepForecastShards({
        shards,
        baselines,
        classifiedGoals,
        pastDiagnostic,
        newsBundle,
        valoriaSummary,
        inputsSig,
        durationMs,
    });
    throwIfAborted(signal);

    emitProgressSafe(onProgress, {
        phase: 'done',
        phaseIndex: 4,
        phaseLabel: `Simulation terminée (${formatNumber(report.trajectoriesRun)} trajectoires).`,
        percent: 100,
        trajectoriesDone: report.trajectoriesRun,
        trajectoriesTotal: report.trajectoriesRun,
        etaSeconds: 0,
    });

    return report;
}
