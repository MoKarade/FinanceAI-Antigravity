// services/projection/runAsync.ts
// W1.1 — Wrapper async qui exécute calculateFutureProjection dans un Web Worker
// si supporté, sinon fallback synchrone (utile pour Node/tests).
//
// FIX silent-failure (HIGH, cycle 2):
//  - requestId par appel: évite que 2 appels rapides reçoivent leurs résultats
//    croisés (le worker répondait FIFO sans corrélation).
//  - terminate() + recréation au prochain appel si le worker crash.

import { messageDeRefus } from './verifierEntreesMoteur';
import type {
    SimulationParams,
    ProjectionResult,
    StrategyConfig,
    StrategySearchResult,
    ConfigResult,
} from '../projection';
import type {
    GrandCalculConfig,
    GrandCalculResult,
    GrandCalculShardResult,
} from './types';
import { logError } from '../errorLogger';

let _worker: Worker | null = null;
let _nextRequestId = 1;
let _workerDead = false;
let _workerInitialized = false;

function getWorker(): Worker | null {
    if (_worker && !_workerDead) return _worker;
    if (typeof Worker === 'undefined') return null;
    try {
        _worker = new Worker(new URL('../projection.worker.ts', import.meta.url), { type: 'module' });
        _workerDead = false;
        _workerInitialized = false;
        _worker.addEventListener('error', (e) => {
            logError({ source: 'projection', severity: 'warning', message: `Worker projection en erreur (recréation au prochain appel): ${e.message}` });
            _workerDead = true;
        });
        return _worker;
    } catch (err) {
        logError({ source: 'projection', severity: 'warning', message: 'Worker projection indisponible (CSP/MIME?), fallback synchrone', error: err });
        return null;
    }
}

interface WorkerRequest {
    __requestId: number;
    params: SimulationParams;
    runMC: boolean;
    selectedIdx: number;
    // [UI-SCEN] — types de scénarios demandés explicitement (panneau stress-tests).
    onlyStratTypes?: string[];
}

/**
 * F3 (audit 2026-05-28) — reconstruit une Error depuis le payload d'erreur du worker
 * en réattachant la stack d'origine. Sans ça, `new Error(__error)` repart d'une stack
 * pointant ici (runAsync) au lieu du vrai site du crash dans le worker → debug aveugle.
 */
export function reconstructWorkerError(
    data: { __error?: string; __errorStack?: string },
    prefix = '',
): Error {
    const err = new Error(prefix + (data.__error ?? 'Worker error'));
    if (data.__errorStack) err.stack = data.__errorStack;
    return err;
}

/**
 * Exécute calculateFutureProjection de manière asynchrone via Web Worker
 * si disponible. Fallback synchrone autrement (Node, tests).
 *
 * Chaque appel reçoit un requestId unique; le listener ne résout la Promise
 * que sur le message correspondant — évite la confusion lors d'appels rapides
 * concurrents (toggle MC, debounce, params qui changent).
 */
// PH2-b (clé de voûte) — dédup des requêtes IDENTIQUES en vol. Si on quitte l'onglet Futur
// pendant un calcul MC puis on revient (remount → re-requête des MÊMES params), on RE-RACCROCHE
// à la promesse déjà en vol au lieu d'en relancer une seconde : la projection « reprend où elle
// en était » (un seul calcul worker, résultat dispo plus tôt). La clé EFFECTIVE combine la
// signature de contenu fournie par l'appelant (dedupKey) ET les discriminants du calcul
// (runMC/selectedIdx/onlyStratTypes) → deux appels ne se raccrochent que s'ils calculent VRAIMENT
// la même chose. L'entrée est vidée à la résolution. Sans dedupKey (appels hors-UI : MCP, tests),
// comportement strictement inchangé.
const _inflight = new Map<string, Promise<ProjectionResult>>();

// NON-async VOLONTAIREMENT : on doit retourner la MÊME référence de promesse pour la dédup
// (un `async function` envelopperait `return existing` dans une nouvelle promesse → identité
// perdue → re-raccrochage cassé). Le corps n'a aucun `await`, il relaie la promesse de
// computeProjectionAsync.
/** Erreur sentinelle : la projection a été annulée par l'appelant (pas un échec). */
export const PROJECTION_CANCELLED = '__PROJECTION_CANCELLED__';

/**
 * Erreur levée quand une ENTRÉE du moteur est illisible : le calcul n'a pas été lancé.
 *
 * ⚠️ Une CLASSE, pas un préfixe de chaîne. Le premier jet posait une sentinelle
 * `__PROJECTION_ENTREE_REFUSEE__` en tête du message en écrivant qu'il « est destiné à être montré
 * tel quel » — or aucun appelant ne la découpait, donc le marqueur technique arrivait intact sous
 * les yeux de Marc ET dans la réponse servie au LLM. Un contrat qui exige un traitement chez
 * l'appelant doit lui donner de quoi le faire : ici `motif`, déjà prêt à afficher.
 */
class ProjectionEntreeRefuseeError extends Error {
    constructor(public readonly motif: string) {
        super(motif);
        this.name = 'ProjectionEntreeRefuseeError';
    }
}

export function runProjectionAsync(
    params: SimulationParams,
    runMC: boolean = false,
    selectedIdx: number = 0,
    onlyStratTypes?: string[],
    dedupKey?: string,
    opts?: { signal?: AbortSignal },
): Promise<ProjectionResult> {
    // [HARDEN-SNAPSHOT-RACE] Abort sur le chemin « projection simple », parité avec la recherche de
    // stratégies (qui a son AbortSignal depuis toujours). Déjà annulé à l'entrée ⇒ on ne lance RIEN
    // et on ne touche pas à la dédup : une requête identique déjà en vol pour d'autres appelants vit
    // sa vie, et un appel légitime suivant recréera la sienne.
    const signal = opts?.signal;
    if (signal?.aborted) return Promise.reject(new Error(PROJECTION_CANCELLED));
    // [ENG-INFINITY-NON-GARDE-A-LA-FRONTIERE] Le refus s'applique ICI, au point d'entrée COMMUN du
    // moteur, et pas seulement dans `ProjectionEngine`.
    //
    // ⚠️ Pourquoi : `ProjectionEngine` n'est qu'UN des cinq appelants. Les trois outils MCP
    // (`get_projection`, `get_retirement_outlook`, `simulate_what_if`) et `StressTestPanel`
    // passaient outre — mesuré sur `get_projection` avec un salaire net `NaN` : patrimoine final
    // annoncé à **−96 %**, sans un mot d'avertissement. Un chiffre faux servi à un LLM hérite de
    // l'autorité de la source unique, et `no-fake-data` l'interdit « y compris dans un prompt IA ».
    //
    // La garde est ici plutôt que recopiée : c'est le point commun des CINQ appelants ASYNCHRONES.
    // ⚠️ Le moteur en compte sept : `goalSeek` et `drawdownOptimizer` appellent `calculateFutureProjection`
    // en DIRECT. Ils sont protégés autrement — leur seule surface (`GoalSeekerCard`) est montée par
    // `Retirement`, qui rend `<ProjectionRequired>` tant que `lastProjection` est nul, et un refus
    // met justement `lastProjection` à nul. C'est une protection par GATE, pas par cette garde : le
    // dire, plutôt que d'écrire « tous » et de laisser croire à une couverture qu'on n'a pas
    // (la leçon « compter les appelants avant d'écrire unique » vient de ce lot — autant l'appliquer).
    // Sur le chemin nominal le champ est ABSENT, donc ce test ne coûte rien et ne change rien.
    if (params.entreesRefusees && params.entreesRefusees.length > 0) {
        return Promise.reject(new ProjectionEntreeRefuseeError(messageDeRefus(params.entreesRefusees)));
    }
    // Clé EFFECTIVE = dedupKey (signature de contenu de l'appelant) + TOUT ce qui distingue le
    // calcul. Sans ça, un futur appelant réutilisant la même dedupKey avec un runMC/selectedIdx
    // différent recevrait SILENCIEUSEMENT la projection de l'autre mode (re-raccrochage à la
    // mauvaise promesse). On encode donc le mode dans la clé, côté wrapper → aucun appelant à blinder.
    const key = dedupKey
        ? `${dedupKey}|mc=${runMC}|idx=${selectedIdx}|st=${onlyStratTypes ? onlyStratTypes.join(',') : ''}`
        : undefined;
    if (key) {
        const existing = _inflight.get(key);
        if (existing) return existing;
    }
    const promise = computeProjectionAsync(params, runMC, selectedIdx, onlyStratTypes);
    if (key) {
        _inflight.set(key, promise);
        // Vide l'entrée à la résolution (succès OU échec), sans écraser une requête plus récente.
        // `.then(clear, clear)` (PAS `.finally().catch()`) : le 2e handler ABSORBE le rejet de cette
        // branche interne → aucun « unhandled rejection » (le rejet user-facing reste géré par l'appelant).
        const clearInflight = () => { if (_inflight.get(key) === promise) _inflight.delete(key); };
        promise.then(clearInflight, clearInflight);
    }
    if (!signal) return promise;

    // ⚠️ L'abort s'applique à une promesse DÉRIVÉE, jamais à la promesse PARTAGÉE de `_inflight` :
    // deux appelants peuvent être raccrochés au même calcul (dédup PH2-b) — celui qui annule ne doit
    // pas rejeter la promesse de l'autre. Le calcul lui-même n'est PAS interrompu : le worker
    // singleton est un canal partagé (le terminer tuerait les requêtes des autres) ; son message
    // tardif est simplement ignoré (filtre par requestId). Annuler = se DÉTACHER, comme un
    // `removeEventListener` — pas tirer sur le canal.
    return new Promise<ProjectionResult>((resolve, reject) => {
        const onAbort = () => reject(new Error(PROJECTION_CANCELLED));
        signal.addEventListener('abort', onAbort, { once: true });
        // `then(resolve, reject)` garde la promesse sous-jacente HANDLED même après un abort : un
        // rejet tardif (timeout worker) atterrit dans un `reject` déjà réglé — no-op, pas
        // d'« unhandled rejection ». Le listener est retiré au règlement (signal potentiellement
        // long-vécu côté appelant : ne pas y accumuler un listener par requête).
        const settle = () => signal.removeEventListener('abort', onAbort);
        promise.then(
            (v) => { settle(); resolve(v); },
            (e) => { settle(); reject(e); },
        );
    });
}

async function computeProjectionAsync(
    params: SimulationParams,
    runMC: boolean = false,
    selectedIdx: number = 0,
    onlyStratTypes?: string[],
): Promise<ProjectionResult> {
    const worker = getWorker();
    if (!worker) {
        const { calculateFutureProjection } = await import('../projection');
        return calculateFutureProjection(params, runMC, selectedIdx, onlyStratTypes);
    }
    const id = _nextRequestId++;
    return new Promise((resolve, reject) => {
        // FIX cycle 3 silent-failure (MEDIUM): timeout + messageerror.
        // Sans timeout, un worker qui hang ou poste un message sans __requestId
        // laisse la Promise pendante indéfiniment.
        const isDeepTier = params.projection?.mcPowerTier === 'approfondi' || params.projection?.mcPowerTier === 'deep_search';
        const TIMEOUT_MS = isDeepTier ? 300_000 : 30_000;
        const cleanup = () => {
            worker.removeEventListener('message', onMessage);
            worker.removeEventListener('error', onError);
            worker.removeEventListener('messageerror', onMessageError);
            clearTimeout(timeoutHandle);
        };
        const onMessage = (e: MessageEvent) => {
            // Ne réagir qu'au message correspondant à ce requestId
            if (!e.data || e.data.__requestId !== id) return;
            _workerInitialized = true;
            cleanup();
            if (e.data.__error) reject(reconstructWorkerError(e.data));
            else resolve(e.data.result);
        };
        const onError = (e: ErrorEvent) => {
            cleanup();
            _workerDead = true; // forcera la recréation
            if (!_workerInitialized) {
                // Si le script Worker n'a jamais pu démarrer (réseau/CSP/module), repli synchrone
                // pour la projection légère plutôt que de laisser la vue Futur sans courbe.
                import('../projection')
                    .then(({ calculateFutureProjection }) =>
                        resolve(calculateFutureProjection(params, runMC, selectedIdx, onlyStratTypes)),
                    )
                    .catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
                return;
            }
            reject(new Error(e.message || 'Worker error'));
        };
        const onMessageError = (e: MessageEvent) => {
            cleanup();
            _workerDead = true;
            reject(new Error('Worker messageerror (payload non-clonable): ' + String(e.data ?? '')));
        };
        const timeoutHandle = setTimeout(() => {
            cleanup();
            _workerDead = true; // recréation au prochain appel
            reject(new Error(`Worker timeout après ${TIMEOUT_MS}ms (requestId=${id})`));
        }, TIMEOUT_MS);
        worker.addEventListener('message', onMessage);
        worker.addEventListener('error', onError);
        worker.addEventListener('messageerror', onMessageError);
        const req: WorkerRequest = { __requestId: id, params, runMC, selectedIdx, onlyStratTypes };
        worker.postMessage(req);
    });
}

export interface StrategySearchProgress {
    done: number;
    total: number;
    simPerSec?: number;
}

/** Découpe `items` en `n` tranches contiguës aussi équilibrées que possible. Exporté pour test. */
export function shardContiguous<T>(items: ReadonlyArray<T>, n: number): T[][] {
    const shards: T[][] = [];
    const base = Math.floor(items.length / n);
    const remainder = items.length % n;
    let offset = 0;
    for (let i = 0; i < n; i++) {
        const size = base + (i < remainder ? 1 : 0); // les 1ers shards prennent +1
        shards.push(items.slice(offset, offset + size));
        offset += size;
    }
    return shards;
}

/**
 * G21 C5 commit 4 — recherche exhaustive de la meilleure stratégie : lance un
 * Monte Carlo sur CHAQUE StrategyConfig de l'espace de recherche, réparti sur un
 * POOL de Web Workers (un par cœur logique). Chaque worker traite sa tranche de
 * configs et rapporte sa progression locale ; on agrège la progression globale.
 *
 * Pool dédié (PAS le singleton `_worker` réservé à la projection) : on
 * crée les workers à la volée et on les termine à la fin de la recherche — c'est
 * une opération lourde et ponctuelle, pas un canal réutilisé.
 *
 * Fallback synchrone (Node/tests/CSP) : `calculateStrategySearch` sur toutes les
 * configs, ordre préservé.
 *
 * L'ordre des résultats agrégés suit l'ordre d'entrée de `configs` (tranches
 * contiguës réassemblées par index de worker) → déterministe et testable.
 */
/** Erreur sentinelle : la recherche a été annulée par l'utilisateur (pas un échec). */
export const SEARCH_CANCELLED = '__SEARCH_CANCELLED__';

export async function runStrategySearchAsync(
    params: SimulationParams,
    configs: ReadonlyArray<StrategyConfig>,
    opts: {
        iterations?: number;
        allowDeepIterations?: boolean;
        maxWorkers?: number;
        onProgress?: (p: StrategySearchProgress) => void;
        /** Annulation : terminer les workers et rejeter avec SEARCH_CANCELLED. */
        signal?: AbortSignal;
    } = {},
): Promise<StrategySearchResult> {
    const { signal } = opts;
    const total = configs.length;
    const startMs = Date.now();
    const effIters = opts.iterations ?? 1000;

    // Détermine le parallélisme effectif (borné par le nb de configs).
    // Plafonné à 4 workers dans Chromium : au-delà (6–8+), les Web Workers d'un même onglet
    // saturent le processus Renderer, gèlent le thread principal (14–47 s) et divisent le débit par 2.
    const GRAND_CALCUL_MAX_DEFAULT_WORKERS = 4;
    const hardware = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? Math.min(navigator.hardwareConcurrency, GRAND_CALCUL_MAX_DEFAULT_WORKERS)
        : 4;
    const requested = opts.maxWorkers ?? hardware;
    const nWorkers = Math.max(1, Math.min(requested, total || 1));

    if (signal?.aborted) throw new Error(SEARCH_CANCELLED);

    const canUseWorkers = typeof Worker !== 'undefined' && total > 0;
    if (!canUseWorkers) {
        const { calculateStrategySearch } = await import('../projection');
        return calculateStrategySearch(params, configs, {
            iterations: opts.iterations,
            allowDeepIterations: opts.allowDeepIterations,
            onProgress: (done) => {
                const elapsedSec = Math.max(0.001, (Date.now() - startMs) / 1000);
                const simPerSec = Math.round((done * effIters) / elapsedSec);
                opts.onProgress?.({ done, total, simPerSec });
            },
        });
    }

    const shards = shardContiguous(configs, nWorkers).filter((s) => s.length > 0);
    const workers: Worker[] = [];
    const perShardDone = new Array(shards.length).fill(0);
    const perShardResults: (ConfigResult[] | null)[] = new Array(shards.length).fill(null);
    let resolvedIterations = opts.iterations ?? 1000;

    const emitProgress = () => {
        const done = perShardDone.reduce((s, d) => s + d, 0);
        const elapsedSec = Math.max(0.001, (Date.now() - startMs) / 1000);
        const simPerSec = Math.round((done * effIters) / elapsedSec);
        opts.onProgress?.({ done, total, simPerSec });
    };

    return new Promise<StrategySearchResult>((resolve, reject) => {
        // Watchdog = écart MAX sans progrès (réarmé à chaque heartbeat), pas la durée
        // totale. Le heartbeat tire tous les ~5% d'itérations (sub-seconde en nominal),
        // donc 15 min est une marge de sécurité : ne coupe jamais une recherche longue
        // ni un onglet mis en arrière-plan (timers throttlés par le navigateur).
        const IDLE_MS = 15 * 60_000; // 15 min sans aucun progrès = vrai hang
        let settled = false;
        const watchdogs: ReturnType<typeof setTimeout>[] = [];

        const cleanupAll = () => {
            for (const w of watchdogs) clearTimeout(w);
            for (const w of workers) w.terminate();
            signal?.removeEventListener('abort', onAbort);
        };
        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanupAll();
            reject(err);
        };
        // Annulation utilisateur : termine immédiatement tous les workers du pool.
        function onAbort() { fail(new Error(SEARCH_CANCELLED)); }
        if (signal) {
            if (signal.aborted) { fail(new Error(SEARCH_CANCELLED)); return; }
            signal.addEventListener('abort', onAbort);
        }
        const tryResolve = () => {
            if (settled) return;
            if (perShardResults.some((r) => r === null)) return;
            settled = true;
            cleanupAll();
            const results = perShardResults.flatMap((r) => r ?? []);
            resolve({ results, iterations: resolvedIterations });
        };

        shards.forEach((shard, k) => {
            if (settled) return;
            let worker: Worker;
            try {
                worker = new Worker(new URL('../projection.worker.ts', import.meta.url), { type: 'module' });
            } catch (err) {
                fail(new Error('Pool worker indisponible: ' + String(err)));
                return;
            }
            workers.push(worker);

            const armWatchdog = () => {
                if (settled) return;
                clearTimeout(watchdogs[k]);
                watchdogs[k] = setTimeout(
                    () => fail(new Error(`Recherche: worker ${k} sans progrès depuis ${IDLE_MS}ms`)),
                    IDLE_MS,
                );
            };
            const onMessage = (e: MessageEvent) => {
                if (settled || !e.data || e.data.__requestId !== k) return;
                if (e.data.__progress) {
                    perShardDone[k] = e.data.__progress.done;
                    emitProgress();
                    if (settled) return;
                    armWatchdog();
                    return;
                }
                if (e.data.__error) {
                    fail(reconstructWorkerError(e.data, `Worker ${k}: `));
                    return;
                }
                const shardResult = e.data.result as StrategySearchResult;
                perShardResults[k] = shardResult.results;
                resolvedIterations = shardResult.iterations;
                perShardDone[k] = shard.length;
                emitProgress();
                tryResolve();
            };
            worker.addEventListener('message', onMessage);
            worker.addEventListener('error', (e) => fail(new Error(`Worker ${k} error: ${e.message}`)));
            worker.addEventListener('messageerror', () => fail(new Error(`Worker ${k} messageerror`)));
            armWatchdog();
            worker.postMessage({
                __requestId: k,
                params,
                mode: 'strategySearch',
                configs: shard,
                iterations: opts.iterations,
                allowDeepIterations: opts.allowDeepIterations,
            });
        });
    });
}

/**
 * Exécute le Tournoi Multi-Phases (Successive Halving + CRN + Attribution de Shapley)
 * sur un pool de Web Workers en parallélisant chacune des 3 manches.
 */
export async function runTournamentStrategySearchAsync(
    params: SimulationParams,
    configs: ReadonlyArray<StrategyConfig>,
    opts: {
        round1Iterations?: number;
        round2Iterations?: number;
        round3Iterations?: number;
        round2TopK?: number;
        round3TopK?: number;
        maxWorkers?: number;
        baselineConfig?: StrategyConfig;
        onProgress?: (p: StrategySearchProgress & { round?: 1 | 2 | 3 }) => void;
        signal?: AbortSignal;
    } = {},
): Promise<StrategySearchResult> {
    if (configs.length === 0) {
        return { results: [], iterations: 0, shapleyAttribution: [], roundsSummary: [] };
    }
    const r1Iters = opts.round1Iterations ?? 100;
    const r2Iters = opts.round2Iterations ?? 1000;
    const r3Iters = opts.round3Iterations ?? 5000;
    const top2K = Math.max(1, opts.round2TopK ?? 120);
    const top3K = Math.max(1, Math.min(top2K, opts.round3TopK ?? 20));

    const { computeTournamentCompositeScore } = await import('./strategySearch');
    const rankPool = (pool: ConfigResult[], keepCount: number): ConfigResult[] => {
        const survivors = pool.filter(c => c.successRate > 0);
        const eligible = survivors.length > 0 ? survivors : pool;
        const maxP50 = Math.max(1, ...eligible.map(c => Math.max(0, c.finalNWp50)));
        const maxCvar = Math.max(1, ...eligible.map(c => Math.max(0, c.cvar95 ?? c.finalNWp10)));
        return [...eligible]
            .sort((a, b) => computeTournamentCompositeScore(b, maxP50, maxCvar) - computeTournamentCompositeScore(a, maxP50, maxCvar))
            .slice(0, keepCount);
    };

    const n1 = configs.length;
    const estN2 = Math.min(n1, top2K);
    const estN3 = Math.min(estN2, top3K);
    const totalBudget = n1 * r1Iters + estN2 * r2Iters + estN3 * r3Iters;
    const startMs = Date.now();
    let accSims = 0;

    const makeRoundProgress = (round: 1 | 2 | 3, iters: number) => (p: StrategySearchProgress) => {
        const doneSims = Math.min(totalBudget, accSims + p.done * iters);
        const elapsedSec = Math.max(0.001, (Date.now() - startMs) / 1000);
        opts.onProgress?.({
            done: doneSims,
            total: totalBudget,
            simPerSec: Math.round(doneSims / elapsedSec),
            round,
        });
    };

    // Manche 1
    const r1 = await runStrategySearchAsync(params, configs, {
        iterations: r1Iters,
        allowDeepIterations: true,
        maxWorkers: opts.maxWorkers,
        signal: opts.signal,
        onProgress: makeRoundProgress(1, r1Iters),
    });
    accSims += n1 * r1Iters;
    const q2 = rankPool(r1.results, top2K);

    // Manche 2
    const r2Configs = q2.map(x => x.config);
    const r2 = await runStrategySearchAsync(params, r2Configs, {
        iterations: r2Iters,
        allowDeepIterations: true,
        maxWorkers: opts.maxWorkers,
        signal: opts.signal,
        onProgress: makeRoundProgress(2, r2Iters),
    });
    accSims += r2Configs.length * r2Iters;
    const q3 = rankPool(r2.results, top3K);

    // Manche 3
    const r3Configs = q3.map(x => x.config);
    const r3 = await runStrategySearchAsync(params, r3Configs, {
        iterations: r3Iters,
        allowDeepIterations: true,
        maxWorkers: opts.maxWorkers,
        signal: opts.signal,
        onProgress: makeRoundProgress(3, r3Iters),
    });
    const finalRanked = rankPool(r3.results, r3Configs.length);

    const { calculateShapleyAttribution } = await import('../projection');
    const { LEVER_LIBRARY } = await import('./strategyConfig');
    const defaultBaseline = opts.baselineConfig ?? (Object.fromEntries(
        LEVER_LIBRARY.map(l => [l.key, l.default]),
    ) as unknown as StrategyConfig);
    const shapleyAttribution = finalRanked[0]
        ? calculateShapleyAttribution(params, defaultBaseline, finalRanked[0].config)
        : [];

    return {
        results: finalRanked,
        iterations: r3Iters,
        shapleyAttribution,
        roundsSummary: [
            { round: 1, candidatesIn: n1, candidatesOut: q2.length, iterationsPerCandidate: r1Iters },
            { round: 2, candidatesIn: r2Configs.length, candidatesOut: q3.length, iterationsPerCandidate: r2Iters },
            { round: 3, candidatesIn: r3Configs.length, candidatesOut: finalRanked.length, iterationsPerCandidate: r3Iters },
        ],
    };
}

// ── Grand Calcul (50 000–100 000 trajectoires sur pool de Web Workers) ────────

/** Erreur sentinelle : le Grand Calcul a été annulé par l'appelant (pas un échec). */
export const GRAND_CALCUL_CANCELLED = '__GRAND_CALCUL_CANCELLED__';

export interface GrandCalculProgress {
    done: number;
    total: number;
    pct: number;
    simPerSec: number | null;
    etaMs: number | null;
}

export interface IterationShard {
    startIter: number;
    count: number;
}

/**
 * Découpe un intervalle `[0, totalCount)` en `n` plages d'itérations contiguës et équilibrées,
 * sans allouer de tableau intermédiaire (les premiers shards absorbent le reste).
 */
export function shardIterationRanges(totalCount: number, n: number): IterationShard[] {
    if (!Number.isFinite(totalCount) || totalCount <= 0) return [];
    const total = Math.floor(totalCount);
    const workers = Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
    const base = Math.floor(total / workers);
    const remainder = total % workers;
    const ranges: IterationShard[] = [];
    let offset = 0;
    for (let i = 0; i < workers; i++) {
        const count = base + (i < remainder ? 1 : 0);
        if (count > 0) {
            ranges.push({ startIter: offset, count });
            offset += count;
        }
    }
    return ranges;
}

function canonicalizeForSig(
    value: unknown,
    ancestors: WeakSet<object>,
    skipKeys?: ReadonlySet<string>,
): unknown {
    if (value === null) return null;
    switch (typeof value) {
        case 'string':
        case 'boolean':
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
                    return obj.map((item) => canonicalizeForSig(item, ancestors));
                }
                if (ArrayBuffer.isView(obj)) {
                    const view = obj instanceof DataView
                        ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
                        : (obj as unknown as ArrayLike<number | bigint>);
                    return Array.from(view, (item) => canonicalizeForSig(item, ancestors));
                }
                if (obj instanceof Set) {
                    return Array.from(obj, (item) => canonicalizeForSig(item, ancestors));
                }
                if (obj instanceof Map) {
                    return Array.from(obj.entries()).map(([k, v]) => [
                        canonicalizeForSig(k, ancestors),
                        canonicalizeForSig(v, ancestors),
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
                    out[key] = canonicalizeForSig(prop, ancestors);
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

/**
 * Calcule une signature déterministe des paramètres et de la configuration du Grand Calcul.
 * Ignore `params.entreesRefusees`, normalise `-0`, distingue `NaN`/`Infinity`/`-Infinity`,
 * reste insensible à l'ordre des clés ou aux propriétés `undefined`, et tolère les cycles.
 */
export function computeGrandCalculParamsSig(
    params: SimulationParams,
    config: Pick<GrandCalculConfig, 'iterations' | 'enableMacroRegimes' | 'includeHistoricalCrises' | 'seed'>,
): string {
    try {
        const rawIters = config?.iterations;
        const normalizedIters = typeof rawIters === 'number' && Number.isFinite(rawIters)
            ? Math.max(50_000, Math.min(100_000, Math.round(rawIters)))
            : 50_000;
        const normalizedConfig: Record<string, unknown> = {
            iterations: normalizedIters,
            enableMacroRegimes: Boolean(config?.enableMacroRegimes),
            includeHistoricalCrises: Boolean(config?.includeHistoricalCrises),
        };
        if (typeof config?.seed === 'number' && Number.isFinite(config.seed)) {
            normalizedConfig.seed = Math.trunc(config.seed);
        }

        const canonicalPayload = {
            params: canonicalizeForSig(params, new WeakSet<object>(), new Set(['entreesRefusees'])),
            config: canonicalizeForSig(normalizedConfig, new WeakSet<object>()),
        };
        const json = JSON.stringify(canonicalPayload) ?? '';

        // Double FNV-1a 32 bits pour minimiser le risque de collision tout en restant 100% synchrone.
        let h1 = 0x811c9dc5;
        let h2 = 0x050c5d1f;
        for (let i = 0; i < json.length; i++) {
            const code = json.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code + (i & 0xff);
            h2 = Math.imul(h2, 0x01000193);
        }
        return `gc1:${(h1 >>> 0).toString(36)}:${(h2 >>> 0).toString(36)}:${json.length.toString(36)}`;
    } catch {
        return 'gc1:invalid';
    }
}

function buildGrandCalculProgress(done: number, total: number, startMs: number): GrandCalculProgress {
    const safeTotal = Math.max(0, total);
    const clampedDone = Math.max(0, Math.min(safeTotal, Math.round(done)));
    const pct = safeTotal > 0 ? Math.min(100, Math.round((clampedDone / safeTotal) * 1000) / 10) : 0;
    const elapsedMs = Math.max(1, Date.now() - startMs);
    const simPerSec = clampedDone > 0 ? Math.round(clampedDone / (elapsedMs / 1000)) : null;
    const etaMs = clampedDone > 0
        ? (clampedDone >= safeTotal ? 0 : Math.max(0, Math.round((elapsedMs * (safeTotal - clampedDone)) / clampedDone)))
        : null;
    return {
        done: clampedDone,
        total: safeTotal,
        pct,
        simPerSec,
        etaMs,
    };
}

/**
 * Exécute le « Grand Calcul » (50 000 à 100 000 trajectoires Monte Carlo) sur un pool
 * dédié de Web Workers avec transfert zero-copy, progression temps réel, watchdog par cœur
 * et annulation propre via `AbortSignal`. Fallback chunké en JS pur si `Worker` est absent.
 */
export async function runGrandCalculAsync(
    params: SimulationParams,
    config: GrandCalculConfig,
    opts: {
        paramsSig: string;
        signal?: AbortSignal;
        onProgress?: (p: GrandCalculProgress) => void;
        maxWorkers?: number;
    },
): Promise<GrandCalculResult> {
    const { signal } = opts;
    if (signal?.aborted) {
        throw new Error(GRAND_CALCUL_CANCELLED);
    }
    if (params.entreesRefusees && params.entreesRefusees.length > 0) {
        throw new ProjectionEntreeRefuseeError(messageDeRefus(params.entreesRefusees));
    }

    const {
        clampGrandCalculIterations,
        mergeGrandCalculShards,
        computeGrandCalculDeterministicBaseline,
        runGrandCalculShard,
    } = await import('../projection');

    if (signal?.aborted) {
        throw new Error(GRAND_CALCUL_CANCELLED);
    }

    const totalIterations = clampGrandCalculIterations(config.iterations);
    const normalizedConfig: GrandCalculConfig = {
        iterations: totalIterations,
        enableMacroRegimes: Boolean(config.enableMacroRegimes),
        includeHistoricalCrises: Boolean(config.includeHistoricalCrises),
        ...(config.seed !== undefined ? { seed: config.seed } : {}),
    };

    const startMs = Date.now();
    const { deterministicEstate } = computeGrandCalculDeterministicBaseline(params);

    const buildMergeMeta = () => ({
        paramsSig: opts.paramsSig,
        durationMs: Math.max(0, Date.now() - startMs),
        regimesEnabled: normalizedConfig.enableMacroRegimes,
        historicalCrisesEnabled: normalizedConfig.includeHistoricalCrises,
        startYear: params.startYear,
        startMonth: params.startMonth,
        currentAge: params.config?.users?.[0]?.age || 30,
        nMonths: Math.max(0, (params.projection?.years ?? 0) * 12),
        financialGoals: params.financialGoals,
        deterministicEstate,
    });

    if (typeof Worker === 'undefined') {
        const targetChunks = Math.max(4, Math.min(20, Math.ceil(totalIterations / 2500)));
        const chunks = shardIterationRanges(totalIterations, Math.min(targetChunks, totalIterations));
        const shards: GrandCalculShardResult[] = [];
        let completedBefore = 0;

        for (let idx = 0; idx < chunks.length; idx++) {
            if (signal?.aborted) {
                throw new Error(GRAND_CALCUL_CANCELLED);
            }
            const chunk = chunks[idx];
            const shard = runGrandCalculShard(
                params,
                normalizedConfig,
                chunk.startIter,
                chunk.count,
                (done) => {
                    opts.onProgress?.(buildGrandCalculProgress(completedBefore + done, totalIterations, startMs));
                },
            );
            shards.push(shard);
            completedBefore += chunk.count;
            opts.onProgress?.(buildGrandCalculProgress(completedBefore, totalIterations, startMs));

            if (idx < chunks.length - 1) {
                await new Promise<void>((r) => setTimeout(r, 0));
                if (signal?.aborted) {
                    throw new Error(GRAND_CALCUL_CANCELLED);
                }
            }
        }

        return mergeGrandCalculShards(shards, buildMergeMeta());
    }

    // Plafonné à 4 workers dans Chromium : au-delà (6–8+), les Web Workers d'un même onglet
    // saturent le processus Renderer, gèlent le thread principal (14–47 s) et divisent le débit par 2.
    const GRAND_CALCUL_MAX_DEFAULT_WORKERS = 4;
    const hardware = typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? Math.min(navigator.hardwareConcurrency, GRAND_CALCUL_MAX_DEFAULT_WORKERS)
        : 4;
    const requestedWorkers = typeof opts.maxWorkers === 'number' && Number.isFinite(opts.maxWorkers)
        ? Math.max(1, Math.floor(opts.maxWorkers))
        : hardware;
    const nWorkers = Math.max(1, Math.min(requestedWorkers, totalIterations));
    const ranges = shardIterationRanges(totalIterations, nWorkers);

    const workers: Worker[] = [];
    const watchdogs: Array<ReturnType<typeof setTimeout> | undefined> = new Array(ranges.length).fill(undefined);
    const perShardDone = new Array<number>(ranges.length).fill(0);
    const shardResults: Array<GrandCalculShardResult | null> = new Array(ranges.length).fill(null);

    const emitPoolProgress = () => {
        const done = perShardDone.reduce((sum, val) => sum + val, 0);
        opts.onProgress?.(buildGrandCalculProgress(done, totalIterations, startMs));
    };

    return new Promise<GrandCalculResult>((resolve, reject) => {
        const IDLE_MS = 15 * 60_000;
        let settled = false;

        const cleanupAll = () => {
            for (let i = 0; i < watchdogs.length; i++) {
                if (watchdogs[i] !== undefined) {
                    clearTimeout(watchdogs[i]);
                    watchdogs[i] = undefined;
                }
            }
            for (const w of workers) {
                w.terminate();
            }
            signal?.removeEventListener('abort', onAbort);
        };

        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            cleanupAll();
            reject(err);
        };

        function onAbort() {
            fail(new Error(GRAND_CALCUL_CANCELLED));
        }

        if (signal) {
            if (signal.aborted) {
                fail(new Error(GRAND_CALCUL_CANCELLED));
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        const tryResolve = () => {
            if (settled) return;
            if (shardResults.some((r) => r === null)) return;
            settled = true;
            cleanupAll();
            try {
                resolve(mergeGrandCalculShards(shardResults as GrandCalculShardResult[], buildMergeMeta()));
            } catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        };

        for (let k = 0; k < ranges.length; k++) {
            if (settled) break;
            const range = ranges[k];
            let worker: Worker;
            try {
                worker = new Worker(new URL('../projection.worker.ts', import.meta.url), { type: 'module' });
            } catch (err) {
                fail(new Error('Pool worker Grand Calcul indisponible: ' + String(err)));
                break;
            }
            workers.push(worker);

            const armWatchdog = () => {
                if (settled) return;
                if (watchdogs[k] !== undefined) clearTimeout(watchdogs[k]);
                watchdogs[k] = setTimeout(
                    () => fail(new Error(`Grand Calcul : worker ${k} sans progrès depuis ${IDLE_MS}ms`)),
                    IDLE_MS,
                );
            };

            const onMessage = (e: MessageEvent) => {
                if (settled || !e.data || e.data.__requestId !== k) return;
                if (e.data.__progress) {
                    const rawDone = Number(e.data.__progress.done);
                    perShardDone[k] = Math.min(range.count, Math.max(0, Number.isFinite(rawDone) ? rawDone : 0));
                    try {
                        emitPoolProgress();
                    } catch (err) {
                        fail(err instanceof Error ? err : new Error(String(err)));
                        return;
                    }
                    if (settled) return;
                    armWatchdog();
                    return;
                }
                if (e.data.__error) {
                    fail(reconstructWorkerError(e.data, `Worker ${k}: `));
                    return;
                }
                if (watchdogs[k] !== undefined) {
                    clearTimeout(watchdogs[k]);
                    watchdogs[k] = undefined;
                }
                shardResults[k] = e.data.result as GrandCalculShardResult;
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
            worker.addEventListener('error', (e) => fail(new Error(`Worker ${k} error: ${e.message}`)));
            worker.addEventListener('messageerror', () => fail(new Error(`Worker ${k} messageerror`)));

            armWatchdog();
            try {
                worker.postMessage({
                    __requestId: k,
                    params,
                    mode: 'grandCalculShard',
                    grandCalculConfig: normalizedConfig,
                    startIter: range.startIter,
                    count: range.count,
                });
            } catch (err) {
                fail(err instanceof Error ? err : new Error(String(err)));
                break;
            }
        }
    });
}
