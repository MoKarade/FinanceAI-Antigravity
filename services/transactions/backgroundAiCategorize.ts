// services/transactions/backgroundAiCategorize.ts
// Déclenchement paresseux et sécurisé de la catégorisation Google Gemini en arrière-plan
// sur les transactions restées inconnues ou douteuses après la passe déterministe.
// Pur de tout import du store : l'accès au store est injecté par l'appelant (`BackgroundAiStorePort`).

import type { AppState, CategorizationRule, Transaction } from '../../types';
import { sanitizePromptText } from '../../utils/promptSafety';
import { isUncategorizedCategory, RULE_CATEGORIES } from '../import/categoryRules';
import { resolveToBudgetCategory } from './budgetCategoryResolver';
import { buildMerchantProfiles, merchantKey } from './merchantProfile';
import { isTransactionNeedsReview } from './smartCategorize';

interface FewShotExample {
    merchant: string;
    category: string;
    sign: 'debit' | 'credit';
}

interface BackgroundAiCategorizeOutcome {
    ran: boolean;
    classifiedCount: number;
    needsReviewCount: number;
}

export interface BackgroundAiStorePort {
    getState: () => Pick<AppState, 'apiKeys' | 'transactions' | 'budgetItems' | 'categorizationRules'>;
    setAppState: (patch: Partial<AppState>) => void;
    isTestModeNow: () => boolean;
}

let _aiInFlight = false;

/** Construit une liste bornée d'exemples confirmés (règles perso + corrections manuelles) sans montants. */
export function buildFewShotExamples(
    transactions: readonly Transaction[],
    categorizationRules: readonly CategorizationRule[] = [],
    maxExamples = 25,
): FewShotExample[] {
    const out: FewShotExample[] = [];
    const seen = new Set<string>();

    const push = (rawMerchant: string, category: string, sign: 'debit' | 'credit') => {
        if (out.length >= maxExamples) return;
        const clean = sanitizePromptText(rawMerchant).trim();
        if (!clean || !category || isUncategorizedCategory(category)) return;
        const mKey = merchantKey(clean) || clean.toLowerCase();
        const sig = `${mKey}|${sign}`;
        if (seen.has(sig)) return;
        seen.add(sig);
        out.push({ merchant: clean, category, sign });
    };

    for (const rule of categorizationRules) {
        push(rule.pattern, rule.category, 'debit');
    }
    for (let i = transactions.length - 1; i >= 0 && out.length < maxExamples; i--) {
        const t = transactions[i];
        if (t.status !== 'manual' || t.isDuplicate || t.isTransfer) continue;
        push(t.payee, t.category, t.amount > 0 ? 'credit' : 'debit');
    }

    return out;
}

/**
 * Classe automatiquement par IA (import paresseux) un sous-ensemble de nouvelles transactions
 * restées à vérifier, en respectant les corrections manuelles et le mode démo.
 */
export async function scheduleBackgroundAiCategorization(
    targetIds: readonly number[],
    storePort: BackgroundAiStorePort,
): Promise<BackgroundAiCategorizeOutcome> {
    if (_aiInFlight || targetIds.length === 0) {
        return { ran: false, classifiedCount: 0, needsReviewCount: 0 };
    }
    if (storePort.isTestModeNow()) {
        return { ran: false, classifiedCount: 0, needsReviewCount: 0 };
    }

    const st = storePort.getState();
    const apiKey = typeof st.apiKeys?.gemini === 'string' ? st.apiKeys.gemini.trim() : '';
    if (!apiKey) {
        return { ran: false, classifiedCount: 0, needsReviewCount: 0 };
    }

    const targetSet = new Set(targetIds);
    const candidates = (st.transactions ?? []).filter((t) =>
        targetSet.has(t.id)
        && !t.isDuplicate
        && !t.isTransfer
        && t.status !== 'manual'
        && !t.isAiProcessed
        && isTransactionNeedsReview(t),
    );
    if (candidates.length === 0) {
        return { ran: false, classifiedCount: 0, needsReviewCount: 0 };
    }

    _aiInFlight = true;
    try {
        const merchantProfiles = buildMerchantProfiles(
            (st.transactions ?? [])
                .filter((t) => !t.isDuplicate && !t.isTransfer)
                .map((t) => ({ payee: t.payee, amount: t.amount, date: t.date })),
        );
        const budgetCategoryNames = (st.budgetItems ?? [])
            .map((b) => b.name)
            .filter((n): n is string => Boolean(n && n.trim()));
        const allowedCategories = Array.from(new Set([
            ...budgetCategoryNames,
            ...RULE_CATEGORIES,
            'Investissement',
            'Salaire',
            'Autre',
            'Transfert',
            'Remboursement',
        ]));
        const fewShotExamples = buildFewShotExamples(st.transactions ?? [], st.categorizationRules ?? []);

        const { categorizeBatch } = await import('../gemini');
        const processed = await categorizeBatch(
            candidates,
            apiKey,
            allowedCategories,
            undefined,
            {
                context: {
                    fewShotExamples,
                    merchantProfiles,
                    budgetCategoryNames,
                    groupByMerchant: true,
                },
            },
        );

        // Relit l'état frais après le réseau (mode test / éditions manuelles concurrentes)
        if (storePort.isTestModeNow()) {
            return { ran: false, classifiedCount: 0, needsReviewCount: 0 };
        }
        const fresh = storePort.getState();
        const budgetItems = fresh.budgetItems ?? [];
        const byId = new Map<number, Transaction>(
            processed.map((tx) => {
                const alignedCat = tx.isTransfer
                    ? 'Transfert'
                    : resolveToBudgetCategory(tx.category, budgetItems);
                return [tx.id, { ...tx, category: alignedCat }];
            }),
        );

        let anyApplied = false;
        let classifiedCount = 0;
        let needsReviewCount = 0;

        const nextTransactions = (fresh.transactions ?? []).map((cur) => {
            const aiTx = byId.get(cur.id);
            if (!aiTx || cur.status === 'manual' || cur.isDuplicate) return cur;
            const changed = cur.category !== aiTx.category
                || Boolean(cur.isTransfer) !== Boolean(aiTx.isTransfer)
                || cur.confidence !== aiTx.confidence
                || cur.isAiProcessed !== aiTx.isAiProcessed;
            if (changed) anyApplied = true;
            if (aiTx.isAiProcessed) {
                if (isTransactionNeedsReview(aiTx)) needsReviewCount++;
                else classifiedCount++;
            }
            return aiTx;
        });

        if (anyApplied) {
            storePort.setAppState({ transactions: nextTransactions, lastUpdate: Date.now() });
        }
        return { ran: true, classifiedCount, needsReviewCount };
    } catch {
        return { ran: false, classifiedCount: 0, needsReviewCount: 0 };
    } finally {
        _aiInFlight = false;
    }
}
