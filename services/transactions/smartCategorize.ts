// services/transactions/smartCategorize.ts
// Moteur unifié de classement déterministe des transactions (sans réseau) :
//   1. Virements internes déjà prouvés ou libellés de transfert stricts
//   2. Règles personnelles de l'utilisateur (`categorizationRules`, avec garde retour crédit)
//   3. Consensus historique des corrections manuelles (`status === 'manual'`)
//   4. Règles contextuelles QC/CA + retours/crédits + Interac + marchands mixtes + récurrence
//   5. Traduction d'indice externe (Fintable / CSV) à confiance modérée (affinable par l'IA)
//   + Alignement prioritaire sur les noms exacts des postes du budget de l'utilisateur.

import type { BudgetCategory, CategorizationRule, Transaction } from '../../types';
import { isInternalTransferLabel } from '../../utils/transactionParser';
import {
    categoryKey,
    isMixedMerchantPayee,
    isUncategorizedCategory,
    mapExternalCategoryHint,
    ruleCategorize,
} from '../import/categoryRules';
import { resolveToBudgetCategory } from './budgetCategoryResolver';
import { contextualCategorize } from './contextualCategorize';
import { isInteracPayee } from './detectTransfers';
import { buildMerchantProfiles, merchantKey, profileForPayee } from './merchantProfile';

/** Seuil sous lequel une transaction classée reste marquée « À vérifier ». */
const REVIEW_CONFIDENCE_THRESHOLD = 75;

const NON_EXPENSE_CATEGORIES = new Set([
    'salaire',
    'revenus divers',
    'remboursement',
    'transfert',
    'investissement',
    'impots',
    'autre',
]);

function normalizeText(s: string): string {
    return (s ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeUpper(s: string): string {
    return (s ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toUpperCase();
}

/** Vrai si la transaction demande une vérification ou une catégorisation (inconnue ou douteuse). */
export function isTransactionNeedsReview(t: Transaction): boolean {
    if (t.isDuplicate || t.isTransfer) return false;
    if (isUncategorizedCategory(t.category)) return true;
    if (t.isVerified || t.status === 'manual') return false;
    return typeof t.confidence === 'number' && t.confidence > 0 && t.confidence < REVIEW_CONFIDENCE_THRESHOLD;
}

/**
 * Extrait un motif lisible de marchand depuis un libellé bancaire brut pour pré-remplir
 * la création d'une règle permanente.
 */
export function extractRulePattern(payee: string): string {
    let s = (payee ?? '').trim();
    if (!s) return '';

    s = s
        .replace(/^(?:paiement facture\s*-\s*acc[eè]sd internet\s*\/\s*|paiement facture\s*\/\s*|achat pr[eé]autoris[eé]\s*\/\s*|achat autoris[eé]\s*\/\s*|achat\s*\/\s*)/i, '')
        .replace(/^(?:sq\s*\*|paypal\s*\*)/i, '')
        .replace(/\*[a-z0-9-]+$/i, '')
        .replace(/#\s*[0-9]+/g, ' ')
        .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, ' ')
        .replace(/\b\d{4,}\b/g, ' ')
        .replace(/\s*\/\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/(?:\s+\b(?:qc|on|ca|montreal|quebec|laval|longueuil)\b)+$/i, '')
        .trim();

    if (!s) return (payee ?? '').trim();
    const words = s.split(' ').filter((w) => w.length > 0 && !/^\d+$/.test(w));
    if (words.length === 0) return s;
    return words.slice(0, 3).join(' ');
}

/** Trouve la règle personnelle la plus spécifique correspondant à un libellé marchand. */
export function matchUserCategorizationRule(
    payee: string,
    rules: readonly CategorizationRule[],
): CategorizationRule | null {
    if (!payee || rules.length === 0) return null;
    const normPayee = normalizeText(payee);
    const pMerchantKey = merchantKey(payee);

    const sortedRules = [...rules]
        .filter((r) => (r.pattern ?? '').trim().length > 0 && (r.category ?? '').trim().length > 0)
        .sort((a, b) => normalizeText(b.pattern).length - normalizeText(a.pattern).length);

    for (const rule of sortedRules) {
        const normPattern = normalizeText(rule.pattern);
        if (!normPattern) continue;
        if (normPayee.includes(normPattern)) return rule;
        if (normPattern.length >= 3) {
            const ruleMKey = merchantKey(rule.pattern);
            if (pMerchantKey && ruleMKey && pMerchantKey === ruleMKey) return rule;
        }
    }
    return null;
}

/**
 * Construit un consensus strict depuis les transactions corrigées manuellement (`status === 'manual'`),
 * séparé par signe (débit vs crédit) et excluant les Interac ainsi que les marchands mixtes.
 */
export function buildManualHistoryMap(transactions: readonly Transaction[]): Map<string, string> {
    const grouped = new Map<string, Set<string>>();

    for (const t of transactions) {
        if (t.status !== 'manual' || t.isDuplicate || t.isTransfer) continue;
        if (isUncategorizedCategory(t.category)) continue;
        if (!t.payee || isInteracPayee(t.payee) || isMixedMerchantPayee(t.payee)) continue;

        const mKey = merchantKey(t.payee);
        if (!mKey) continue;

        const key = `${mKey}|${t.amount > 0 ? 'credit' : 'debit'}`;
        let cats = grouped.get(key);
        if (!cats) {
            cats = new Set<string>();
            grouped.set(key, cats);
        }
        cats.add(t.category);
    }

    const consensus = new Map<string, string>();
    for (const [key, cats] of grouped) {
        if (cats.size === 1) {
            const [cat] = cats;
            consensus.set(key, cat);
        }
    }
    return consensus;
}

function isExpenseCategory(category: string): boolean {
    return !NON_EXPENSE_CATEGORIES.has(categoryKey(category));
}

export interface SmartCategorizeParams {
    transactions: readonly Transaction[];
    /** Si omis, traite toutes les transactions non doublons (hors manuelles). */
    targetIds?: ReadonlySet<number>;
    categorizationRules?: readonly CategorizationRule[];
    budgetItems?: readonly BudgetCategory[];
    externalHintsById?: ReadonlyMap<number, string>;
}

interface SmartCategorizeStats {
    totalConsidered: number;
    transfersMarked: number;
    byUserRule: number;
    byHistory: number;
    byRefund: number;
    byRules: number;
    byRecurrence: number;
    byMixedHeuristics: number;
    byExternalHint: number;
    manualPreserved: number;
    needsReviewCount: number;
}

export interface SmartCategorizeResult {
    transactions: Transaction[];
    changedIds: number[];
    remainingForAiIds: number[];
    stats: SmartCategorizeStats;
}

/** Applique toutes les couches déterministes de classement aux transactions ciblées. */
export function smartCategorizeTransactions(params: SmartCategorizeParams): SmartCategorizeResult {
    const {
        transactions,
        targetIds,
        categorizationRules = [],
        budgetItems = [],
        externalHintsById,
    } = params;

    const profiles = buildMerchantProfiles(
        transactions
            .filter((t) => !t.isDuplicate && !t.isTransfer)
            .map((t) => ({ payee: t.payee, amount: t.amount, date: t.date })),
    );
    const manualMap = buildManualHistoryMap(transactions);

    const stats: SmartCategorizeStats = {
        totalConsidered: 0,
        transfersMarked: 0,
        byUserRule: 0,
        byHistory: 0,
        byRefund: 0,
        byRules: 0,
        byRecurrence: 0,
        byMixedHeuristics: 0,
        byExternalHint: 0,
        manualPreserved: 0,
        needsReviewCount: 0,
    };

    const changedIds: number[] = [];
    const remainingForAiIds: number[] = [];

    const updated = transactions.map((t): Transaction => {
        if (t.isDuplicate) return t;
        const isTarget = targetIds ? targetIds.has(t.id) : true;
        if (!isTarget) return t;

        if (t.status === 'manual') {
            stats.manualPreserved++;
            return t;
        }

        stats.totalConsidered++;

        const finish = (
            nextCat: string,
            confidence: number,
            opts: { isTransfer?: boolean; isAiProcessed?: boolean } = {},
        ): Transaction => {
            const isTransfer = Boolean(opts.isTransfer || nextCat === 'Transfert');
            const alignedCat = isTransfer ? 'Transfert' : resolveToBudgetCategory(nextCat, budgetItems);
            const changed =
                t.category !== alignedCat
                || Boolean(t.isTransfer) !== isTransfer
                || t.confidence !== confidence;

            const nextTx: Transaction = {
                ...t,
                category: alignedCat,
                status: 'processed',
                isTransfer,
                confidence,
                isAiProcessed: opts.isAiProcessed ?? false,
            };

            if (changed) changedIds.push(t.id);
            if (!isTransfer && isTransactionNeedsReview(nextTx)) {
                stats.needsReviewCount++;
                remainingForAiIds.push(t.id);
            }
            return nextTx;
        };

        // 1. Transferts prouvés ou libellé explicite de virement interne (sans masquer /Loyer ou /Conjoint)
        const ruledPayeePreCheck = ruleCategorize(t.payee);
        if (t.isTransfer || (isInternalTransferLabel(t.payee) && (ruledPayeePreCheck === null || ruledPayeePreCheck === 'Transfert'))) {
            stats.transfersMarked++;
            return finish('Transfert', 100, { isTransfer: true });
        }

        // 2. Règles personnelles de l'utilisateur (priorité maximale)
        const userRule = matchUserCategorizationRule(t.payee, categorizationRules);
        if (userRule) {
            if (t.amount > 0 && isExpenseCategory(userRule.category)) {
                stats.byRefund++;
                return finish('Remboursement', 92);
            }
            stats.byUserRule++;
            return finish(userRule.category, 100, { isTransfer: userRule.category === 'Transfert' });
        }

        // 3. Consensus historique des corrections manuelles sur le même marchand et signe
        const mKey = merchantKey(t.payee);
        if (mKey && !isInteracPayee(t.payee) && !isMixedMerchantPayee(t.payee)) {
            const historyCat = manualMap.get(`${mKey}|${t.amount > 0 ? 'credit' : 'debit'}`);
            if (historyCat) {
                stats.byHistory++;
                return finish(historyCat, 92, { isTransfer: historyCat === 'Transfert' });
            }
        }

        const upperPayee = normalizeUpper(t.payee);

        // 4a. Crédits / retours marchands positifs
        if (t.amount > 0) {
            if (/\b(REMBOURSEMENT|REFUND|RETOUR|CREDIT MARCHAND|RETURN CREDIT)\b/.test(upperPayee)) {
                stats.byRefund++;
                return finish('Remboursement', 92);
            }
            const ruledOnCredit = ruleCategorize(t.payee);
            if (ruledOnCredit && isExpenseCategory(ruledOnCredit)) {
                stats.byRefund++;
                return finish('Remboursement', 92);
            }
            if (isInteracPayee(t.payee) && ruledOnCredit === null) {
                stats.byRefund++;
                return finish('Remboursement', 88);
            }
        }

        // 4b. Interac sortant vers une personne (cas /Loyer et /Conjoint déjà captés par ruleCategorize)
        if (isInteracPayee(t.payee)) {
            const ruled = ruleCategorize(t.payee);
            if (ruled === 'Autre' || (ruled === null && t.amount < 0)) {
                stats.byRules++;
                return finish('Autre', 45);
            }
        }

        // 4c. Intermédiaires de paiement (PayPal / Square) : si aucune enseigne connue ne matche
        if (/\bPAYPAL\b|(?:^|\s)SQ \*/.test(upperPayee)) {
            const contextual = contextualCategorize(t.payee, profiles);
            if (contextual.category && !isUncategorizedCategory(contextual.category)) {
                if (contextual.source === 'recurrence') {
                    stats.byRecurrence++;
                    return finish(contextual.category, 88);
                }
                stats.byRules++;
                return finish(contextual.category, 78);
            }
            const prof = profileForPayee(profiles, t.payee);
            if (prof?.isRecurring) {
                stats.byRecurrence++;
                return finish('Abonnements', 86);
            }
            // PayPal/Square inconnu : laissé pour l'IA ou revue manuelle
            stats.needsReviewCount++;
            remainingForAiIds.push(t.id);
            return t;
        }

        // 4d. Enseignes mixtes (Costco, Walmart, Amazon) selon montant et récurrence
        if (/COSTCO WHOLESALE/.test(upperPayee)) {
            stats.byMixedHeuristics++;
            const conf = Math.abs(t.amount) >= 350 ? 65 : 86;
            return finish('Épicerie', conf);
        }
        if (/WAL-?MART/.test(upperPayee)) {
            stats.byMixedHeuristics++;
            if (Math.abs(t.amount) >= 200) return finish('Magasinage', 68);
            return finish('Épicerie', 80);
        }
        if ((/AMAZON|\bAMZN\b/.test(upperPayee)) && !/AMAZON PRIME|PRIME VIDEO/.test(upperPayee)) {
            stats.byMixedHeuristics++;
            const prof = profileForPayee(profiles, t.payee);
            if (prof?.isRecurring) return finish('Abonnements', 86);
            return finish('Magasinage', 78);
        }

        // 4e. Règles contextuelles QC/CA + plateformes ambiguës (App Store, Google Play, Steam, Xbox…)
        const contextual = contextualCategorize(t.payee, profiles);
        if (contextual.category) {
            if (contextual.source === 'recurrence') {
                stats.byRecurrence++;
                return finish(contextual.category, 90);
            }
            stats.byRules++;
            const ruleConf = contextual.profile !== undefined ? 78 : (contextual.category === 'Autre' ? 50 : 95);
            return finish(contextual.category, ruleConf, { isTransfer: contextual.category === 'Transfert' });
        }

        // 5. Indice externe de la banque / CSV (traduit vers le jeu canonique, confiance modérée → affinable IA)
        const rawHint = externalHintsById?.get(t.id) ?? t.originalCategory;
        const mappedHint = mapExternalCategoryHint(rawHint);
        if (mappedHint) {
            stats.byExternalHint++;
            return finish(mappedHint, 68, { isTransfer: mappedHint === 'Transfert' });
        }

        // Reste inconnu → candidat pour l'IA / revue utilisateur
        stats.needsReviewCount++;
        remainingForAiIds.push(t.id);
        return t;
    });

    return { transactions: updated, changedIds, remainingForAiIds, stats };
}
