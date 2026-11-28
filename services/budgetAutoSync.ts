// services/budgetAutoSync.ts
//
// Logique pure partagée pour garder le Budget automatiquement aligné sur les transactions
// réelles, détecter les postes manuels qui ont dérivé de la moyenne réelle et les réaligner en 1 clic.

import type { BudgetCategory, Transaction } from '../types';
import { syncBudgetWithTransactionCategories } from '../utils/budgetSync';
import { isSavingsNature } from '../utils/budget';

const EXCLUDED_TRANSFER_NAMES = new Set(['Transfert', 'Virement', 'Virements']);

export interface BudgetSyncPatchResult {
    changed: boolean;
    items: BudgetCategory[];
    added: string[];
    removed: string[];
    renamed: string[];
    refreshedCount: number;
    removedTransfers: boolean;
}

/**
 * Calcule les postes de budget mis à jour à partir des transactions courantes.
 * - Retire d'emblée tout poste fantôme « Transfert » / « Virement ».
 * - Lorsque `allowRemoval` est vrai (premier passage au chargement), applique ajouts,
 *   renommages flous et retraits des postes absents de l'historique.
 * - Ensuite (`allowRemoval: false`), ajoute les nouvelles catégories apparues et recalcule
 *   les cibles des postes `autoTarget: true` sans supprimer les postes créés à la main.
 */
export function computeBudgetSyncPatch(
    transactions: readonly Transaction[],
    rawBudgetItems: readonly BudgetCategory[],
    options: { allowRemoval: boolean; refDate?: Date },
): BudgetSyncPatchResult {
    const cleaned = rawBudgetItems.filter((i) => !EXCLUDED_TRANSFER_NAMES.has((i.name ?? '').trim()));
    const removedTransfers = cleaned.length !== rawBudgetItems.length;

    if (transactions.length === 0) {
        return {
            changed: removedTransfers,
            items: removedTransfers ? cleaned : (rawBudgetItems as BudgetCategory[]),
            added: [],
            removed: [],
            renamed: [],
            refreshedCount: 0,
            removedTransfers,
        };
    }

    const sync = syncBudgetWithTransactionCategories(
        transactions as Transaction[],
        cleaned,
        options.refDate,
        false,
    );

    if (!sync.changed) {
        return {
            changed: removedTransfers,
            items: removedTransfers ? cleaned : (rawBudgetItems as BudgetCategory[]),
            added: [],
            removed: [],
            renamed: [],
            refreshedCount: 0,
            removedTransfers,
        };
    }

    if (options.allowRemoval) {
        return {
            changed: true,
            items: sync.items,
            added: sync.added,
            removed: sync.removed,
            renamed: sync.renamed,
            refreshedCount: sync.refreshedCount,
            removedTransfers,
        };
    }

    const addedSet = new Set(sync.added);
    const items: BudgetCategory[] = [
        ...cleaned.map((b) => {
            const refreshed = sync.items.find((i) => i.id === b.id && i.name === b.name);
            return b.autoTarget === true && refreshed ? refreshed : b;
        }),
        ...sync.items.filter((i) => addedSet.has(i.name)),
    ];

    const changed = removedTransfers || sync.added.length > 0 || sync.refreshedCount > 0;
    return {
        changed,
        items: changed ? items : (rawBudgetItems as BudgetCategory[]),
        added: sync.added,
        removed: [],
        renamed: [],
        refreshedCount: sync.refreshedCount,
        removedTransfers,
    };
}

export interface DriftedBudgetItem {
    id: string;
    name: string;
    currentMonthly: number;
    avgMonthly: number;
}

function toMonthlyAmount(item: BudgetCategory): number {
    if (item.frequency === 'Yearly') return item.target / 12;
    if (item.frequency === 'Weekly') return item.target * 4.33;
    if (item.frequency === 'Quarterly') return item.target / 3;
    return item.target;
}

/**
 * Repère les postes manuels (hors épargne) dont la cible s'écarte nettement de la moyenne
 * réelle sur les 12 derniers mois pleins (écart relatif >= 20 % ET >= 25 $/mois).
 */
export function findDriftedManualItems(
    budgetItems: readonly BudgetCategory[],
    avg12ByItem: Readonly<Record<string, number | null | undefined>>,
    thresholdRatio = 0.2,
    minDeltaCad = 25,
): DriftedBudgetItem[] {
    const out: DriftedBudgetItem[] = [];
    for (const item of budgetItems) {
        if (!item.id || item.autoTarget === true || isSavingsNature(item.nature)) continue;
        const avg = avg12ByItem[item.name];
        if (typeof avg !== 'number' || !Number.isFinite(avg) || avg <= 0) continue;
        const currentMonthly = toMonthlyAmount(item);
        const diff = Math.abs(currentMonthly - avg);
        if (diff >= minDeltaCad && diff / avg >= thresholdRatio) {
            out.push({
                id: item.id,
                name: item.name,
                currentMonthly: Math.round(currentMonthly),
                avgMonthly: Math.round(avg),
            });
        }
    }
    return out;
}

/**
 * Aligne les postes dérivés sur leur moyenne réelle mensuelle et active le suivi automatique.
 */
export function realignItemsToRealAverage(
    budgetItems: readonly BudgetCategory[],
    driftedItems: readonly DriftedBudgetItem[],
): BudgetCategory[] {
    if (driftedItems.length === 0) return budgetItems as BudgetCategory[];
    const byId = new Map(driftedItems.map((d) => [d.id, d.avgMonthly]));
    return budgetItems.map((item) => {
        const avg = item.id ? byId.get(item.id) : undefined;
        if (avg === undefined || !Number.isFinite(avg)) return item;
        return {
            ...item,
            target: Math.max(0, Math.round(avg)),
            frequency: 'Monthly',
            autoTarget: true,
        };
    });
}
