// store/idbBootHydration.ts
// Hydratation unique et dédupliquée depuis IndexedDB au démarrage, ainsi que ré-application
// synchrone du cache FX (24 h) avant le premier rendu du tableau de bord.

import { useFinanceStore } from './useFinanceStore';
import {
    readFullStateFromIdb,
    isLocalMirrorCompacted,
    isLocalMirrorBalanceTruncated,
    markIdbBootHydrationComplete,
} from '../services/unlimitedStateStorage';
import { verifierTypesRestaures } from '../services/verifierTypesRestaures';
import { hasMeaningfulData } from '../utils/onboarding';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { readCachedFxRatesSync } from '../services/finance';
import { fxSourceEffective, fxFaitAutorite } from '../services/fx/provenance';
import { ecritureFxSelonLecture } from '../services/fx/ecritureFx';
import type { AppState, Asset } from '../types';

const TRANSIENT_OR_SECRET_KEYS = new Set<string>([
    'apiKeys',
    'activeTab',
    'isPrivacyMode',
    'lastProjection',
    'projectionStatus',
    'projectionRefus',
    'lockedProjection',
    'pendingFocus',
    'isTestMode',
    'realDataSnapshot',
    'activeTestPersonaId',
    'grandCalculResult',
    'grandCalculStatus',
    'grandCalculProgress',
    'grandCalculError',
]);

let _hydrationPromise: Promise<void> | null = null;

/** Test-only : réinitialise la promesse dédupliquée d'hydratation IndexedDB. */
export function _resetIdbBootHydrationForTests(): void {
    _hydrationPromise = null;
}

/**
 * Indique s'il faut attendre l'hydratation complète IndexedDB avant de révéler les montants
 * (miroir localStorage amputé des transactions, écriture localStorage échouée, ou clé absente
 * avec drapeau de débordement actif).
 */
export function needsBlockingIdbHydration(): boolean {
    if (isLocalMirrorBalanceTruncated()) return true;
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem(STORAGE_KEYS.persistStore) === null && isLocalMirrorCompacted();
        }
    } catch {
        /* localStorage inaccessible */
    }
    return false;
}

/**
 * Applique de façon synchrone le dernier taux de change en cache (valide 24 h, provenance `'api'`)
 * lorsque le store démarre encore sur des taux de repli, afin d'éviter un refus transitoire des
 * comptes courtiers USD sur le premier affichage.
 */
export function applyCachedFxRatesSyncIfNeeded(): void {
    const current = useFinanceStore.getState();
    if (fxFaitAutorite(fxSourceEffective(current))) return;

    const cached = readCachedFxRatesSync();
    if (!cached || !fxFaitAutorite(cached.source)) return;

    const ecriture = ecritureFxSelonLecture(current, cached);
    if (ecriture) {
        current.updateFxRates(ecriture);
    }
}

function assetMatchKey(asset: unknown): string {
    if (!asset || typeof asset !== 'object') return '';
    const rec = asset as { symbol?: unknown; accountType?: unknown };
    const sym = typeof rec.symbol === 'string' ? rec.symbol.trim().toUpperCase() : '';
    const acc = typeof rec.accountType === 'string' ? rec.accountType.trim().toUpperCase() : '';
    return sym ? `${sym}|${acc}` : '';
}

function mergeCompactAssetHistories(
    currentAssets: readonly Asset[],
    idbAssets: readonly unknown[],
): { changed: boolean; merged: Asset[] } {
    const byKey = new Map<string, Array<{ asset: Record<string, unknown>; used: boolean }>>();
    for (const raw of idbAssets) {
        if (!raw || typeof raw !== 'object') continue;
        const key = assetMatchKey(raw);
        if (!key) continue;
        const list = byKey.get(key) ?? [];
        list.push({ asset: raw as Record<string, unknown>, used: false });
        byKey.set(key, list);
    }

    let changed = false;
    const merged = currentAssets.map((cur, idx) => {
        const key = assetMatchKey(cur);
        let idbRec: Record<string, unknown> | undefined;
        if (key) {
            const bucket = byKey.get(key);
            const unused = bucket?.find((entry) => !entry.used);
            if (unused) {
                unused.used = true;
                idbRec = unused.asset;
            }
        }
        if (!idbRec) {
            const fallback = idbAssets[idx];
            if (fallback && typeof fallback === 'object') {
                const fbRec = fallback as Record<string, unknown>;
                const fbSym = typeof fbRec.symbol === 'string' ? fbRec.symbol.trim().toUpperCase() : '';
                const curSym = (cur.symbol || '').trim().toUpperCase();
                if (!curSym || fbSym === curSym) {
                    idbRec = fbRec;
                }
            }
        }
        if (!idbRec) return cur;

        const idbPriceHist = Array.isArray(idbRec.priceHistory) ? idbRec.priceHistory : [];
        const curPriceHist = Array.isArray(cur.priceHistory) ? cur.priceHistory : [];
        const curRecord = cur as unknown as Record<string, unknown>;
        const idbHist = Array.isArray(idbRec.history) ? idbRec.history : [];
        const curHist = Array.isArray(curRecord.history) ? curRecord.history : [];

        const takePriceHist = idbPriceHist.length > curPriceHist.length;
        const takeHist = idbHist.length > curHist.length;
        if (!takePriceHist && !takeHist) return cur;

        changed = true;
        const next: Record<string, unknown> = { ...curRecord };
        if (takePriceHist) next.priceHistory = idbPriceHist;
        if (takeHist) next.history = idbHist;
        return next as unknown as Asset;
    });

    return { changed, merged };
}

function countAiConversationMessages(convs: unknown): number {
    if (!Array.isArray(convs)) return 0;
    let total = 0;
    for (const c of convs) {
        if (c && typeof c === 'object' && Array.isArray((c as { messages?: unknown }).messages)) {
            total += (c as { messages: unknown[] }).messages.length;
        }
    }
    return total;
}

async function runIdbBootHydration(): Promise<void> {
    try {
        const balanceTruncated = isLocalMirrorBalanceTruncated();
        const compacted = isLocalMirrorCompacted();
        const fullJson = await readFullStateFromIdb(STORAGE_KEYS.persistStore);
        markIdbBootHydrationComplete();

        if (!fullJson) return;

        const parsed = JSON.parse(fullJson) as { state?: Record<string, unknown> } | null;
        const idbState = parsed?.state;
        if (!idbState || typeof idbState !== 'object' || Array.isArray(idbState)) return;
        if (verifierTypesRestaures(idbState).length > 0) return;

        const current = useFinanceStore.getState();
        const idbLastUpdate =
            typeof idbState.lastUpdate === 'number' && Number.isFinite(idbState.lastUpdate)
                ? idbState.lastUpdate
                : 0;
        const curLastUpdate =
            typeof current.lastUpdate === 'number' && Number.isFinite(current.lastUpdate)
                ? current.lastUpdate
                : 0;
        const shouldFullRestore =
            balanceTruncated ||
            idbLastUpdate > curLastUpdate ||
            (!hasMeaningfulData(current) && hasMeaningfulData(idbState as Partial<AppState>));

        if (shouldFullRestore) {
            const patch: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(idbState)) {
                if (TRANSIENT_OR_SECRET_KEYS.has(key) || typeof val === 'function') continue;
                patch[key] = val;
            }
            if (Object.keys(patch).length > 0) {
                useFinanceStore.getState().setAppState(patch as Partial<AppState>);
                applyCachedFxRatesSyncIfNeeded();
            }
            return;
        }

        // Miroir compacté sans troncature des soldes : on ne restaure que les historiques et pièces volumineuses retirés.
        const patch: Partial<AppState> = {};
        const idbTx = Array.isArray(idbState.transactions) ? idbState.transactions : null;
        const idbLedger = Array.isArray(idbState.brokerLedger) ? idbState.brokerLedger : null;
        const idbHistory = Array.isArray(idbState.fintableBrokerHistory) ? idbState.fintableBrokerHistory : null;
        const idbInvTx = Array.isArray(idbState.investmentTransactions) ? idbState.investmentTransactions : null;
        const idbDocs = Array.isArray(idbState.documents) ? idbState.documents : null;
        const idbAiConv = Array.isArray(idbState.aiConversation) ? idbState.aiConversation : null;
        const idbAiConvs = Array.isArray(idbState.aiConversations) ? idbState.aiConversations : null;
        const idbAssets = Array.isArray(idbState.assets) ? idbState.assets : null;

        if (idbTx !== null && idbTx.length > current.transactions.length) {
            patch.transactions = idbTx as AppState['transactions'];
        }
        if (idbLedger !== null && idbLedger.length > (current.brokerLedger?.length ?? 0)) {
            patch.brokerLedger = idbLedger as AppState['brokerLedger'];
        }
        if (idbHistory !== null && idbHistory.length > (current.fintableBrokerHistory?.length ?? 0)) {
            patch.fintableBrokerHistory = idbHistory as AppState['fintableBrokerHistory'];
        }
        if (idbInvTx !== null && idbInvTx.length > (current.investmentTransactions?.length ?? 0)) {
            patch.investmentTransactions = idbInvTx as AppState['investmentTransactions'];
        }
        if (idbDocs !== null && idbDocs.length > (current.documents?.length ?? 0)) {
            patch.documents = idbDocs as AppState['documents'];
        }
        if (idbAiConv !== null && idbAiConv.length > (current.aiConversation?.length ?? 0)) {
            patch.aiConversation = idbAiConv as AppState['aiConversation'];
        }
        if (
            idbAiConvs !== null &&
            (countAiConversationMessages(idbAiConvs) > countAiConversationMessages(current.aiConversations) ||
                idbAiConvs.length > (current.aiConversations?.length ?? 0))
        ) {
            patch.aiConversations = idbAiConvs as AppState['aiConversations'];
        }
        if (idbAssets !== null) {
            const { changed, merged } = mergeCompactAssetHistories(current.assets ?? [], idbAssets);
            if (changed) {
                patch.assets = merged;
            }
        }

        if (compacted || Object.keys(patch).length > 0) {
            if (Object.keys(patch).length > 0) {
                useFinanceStore.getState().setAppState(patch);
            }
        }
    } catch {
        /* best-effort : le miroir synchrone localStorage reste disponible */
    } finally {
        markIdbBootHydrationComplete();
    }
}

/**
 * Exécute (au plus une fois par session/cycle de boot) l'hydratation complète depuis IndexedDB
 * et synchronise immédiatement le cache FX valide en mémoire/localStorage.
 */
export function hydrateStoreFromIdbOnce(): Promise<void> {
    applyCachedFxRatesSyncIfNeeded();
    if (_hydrationPromise) return _hydrationPromise;
    _hydrationPromise = runIdbBootHydration();
    return _hydrationPromise;
}
