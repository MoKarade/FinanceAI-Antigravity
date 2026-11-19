import { describe, it, expect } from 'vitest';
import type { BudgetCategory, CategorizationRule, Transaction } from '../../types';
import {
    buildManualHistoryMap,
    extractRulePattern,
    isTransactionNeedsReview,
    matchUserCategorizationRule,
    smartCategorizeTransactions,
} from '../../services/transactions/smartCategorize';
import { resolveToBudgetCategory } from '../../services/transactions/budgetCategoryResolver';

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
    id: 1,
    date: '2026-10-15',
    payee: 'IGA EXTRA',
    amount: -50,
    category: 'Non catégorisé',
    status: 'processed',
    ...overrides,
});

const BUDGET_ITEMS: BudgetCategory[] = [
    { id: 'b1', name: 'Épicerie & Alimentation', target: 700, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
    { id: 'b2', name: 'Logement & Énergie', target: 1650, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
    { id: 'b3', name: 'Transport auto', target: 400, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
    { id: 'b4', name: 'Sport & Santé', target: 120, frequency: 'Monthly', type: 'Perso 1', nature: 'Envie' },
    { id: 'b5', name: 'Épargne libre', target: 500, frequency: 'Monthly', type: 'Perso 1', nature: 'Epargne' },
];

describe('budgetCategoryResolver — alignement budget sans faux positifs', () => {
    it('résout vers le nom exact du poste budget (mot entier / synonyme) sans confondre Sport ⊂ Transport', () => {
        expect(resolveToBudgetCategory('Épicerie', BUDGET_ITEMS)).toBe('Épicerie & Alimentation');
        expect(resolveToBudgetCategory('Logement', BUDGET_ITEMS)).toBe('Logement & Énergie');
        expect(resolveToBudgetCategory('Transport', BUDGET_ITEMS)).toBe('Transport auto');
        expect(resolveToBudgetCategory('Transport', [{ id: 's1', name: 'Sport', target: 100, frequency: 'Monthly', type: 'Commun', nature: 'Envie' }])).toBe('Transport');
        // Catégories système préservées telles quelles
        expect(resolveToBudgetCategory('Remboursement', BUDGET_ITEMS)).toBe('Remboursement');
        expect(resolveToBudgetCategory('Transfert', BUDGET_ITEMS)).toBe('Transfert');
    });
});

describe('smartCategorizeTransactions — règles perso, historique, retours, Interac, mixtes & budget', () => {
    it('priorise les règles personnelles (motif le plus précis + sans accents) avec garde crédit retour', () => {
        const rules: CategorizationRule[] = [
            { id: 'r1', pattern: 'uber', category: 'Transport', createdAt: '2026-01-01' },
            { id: 'r2', pattern: 'uber eats', category: 'Restaurants', createdAt: '2026-01-01' },
            { id: 'r3', pattern: 'épicerie fine', category: 'Épicerie', createdAt: '2026-01-01' },
        ];
        expect(matchUserCategorizationRule('UBER EATS MTL', rules)?.category).toBe('Restaurants');

        const res = smartCategorizeTransactions({
            transactions: [
                makeTx({ id: 1, payee: 'EPICERIE FINE ST-DENIS', amount: -45 }),
                makeTx({ id: 2, payee: 'EPICERIE FINE ST-DENIS', amount: 45 }),
            ],
            categorizationRules: rules,
            budgetItems: BUDGET_ITEMS,
        });

        expect(res.transactions[0].category).toBe('Épicerie & Alimentation');
        expect(res.transactions[0].confidence).toBe(100);
        // Retour positif chez un commerçant de dépense → Remboursement (jamais un revenu)
        expect(res.transactions[1].category).toBe('Remboursement');
        expect(res.transactions[1].confidence).toBe(92);
    });

    it('apprend du consensus historique manuel hors Interac et hors marchands mixtes, sans écraser status=manual', () => {
        const res = smartCategorizeTransactions({
            transactions: [
                makeTx({ id: 1, payee: 'CLINIQUE ALPHA #10', amount: -80, category: 'Sport & Santé', status: 'manual' }),
                makeTx({ id: 2, payee: 'CLINIQUE ALPHA #24', amount: -95, category: 'Uncategorized' }),
                makeTx({ id: 3, payee: 'AMZN MKTP CA*111', amount: -40, category: 'Loisirs', status: 'manual' }),
                makeTx({ id: 4, payee: 'AMZN MKTP CA*222', amount: -60, category: 'Non catégorisé' }),
                makeTx({ id: 5, payee: 'IGA EXTRA', amount: -30, category: 'Restaurants', status: 'manual' }),
            ],
            budgetItems: BUDGET_ITEMS,
        });

        // Consensus manuel propagé sur le même marchand non mixte
        expect(res.transactions[1].category).toBe('Sport & Santé');
        expect(res.transactions[1].confidence).toBe(92);
        // Amazon est mixte : la correction manuelle Loisirs ne force pas l'achat suivant
        expect(res.transactions[3].category).toBe('Magasinage');
        // Verrou manuel respecté
        expect(res.transactions[4].category).toBe('Restaurants');
        expect(buildManualHistoryMap([
            makeTx({ id: 1, payee: 'Virement Interac à / PAUL', amount: -50, category: 'Logement', status: 'manual' }),
        ]).size).toBe(0);
    });

    it('gère les retours/crédits, Interac, transferts, marchands mixtes, abonnements et indices Fintable EN', () => {
        const res = smartCategorizeTransactions({
            transactions: [
                makeTx({ id: 10, payee: 'DOLLARAMA # 120', amount: 18.5 }),
                makeTx({ id: 11, payee: 'Virement Interac de / MARIE', amount: 75 }),
                makeTx({ id: 12, payee: 'Virement Interac à / JEAN', amount: -100 }),
                makeTx({ id: 13, payee: 'Virement envoyé à / PROP /Loyer', amount: -1200 }),
                makeTx({ id: 14, payee: 'COSTCO WHOLESALE #512', amount: -480 }),
                makeTx({ id: 15, payee: 'APPLE.COM/BILL', amount: -299, date: '2026-10-01' }),
                makeTx({ id: 16, payee: 'MARCHAND INCONNU XYZ', amount: -32, originalCategory: 'Groceries' }),
                makeTx({ id: 17, payee: 'MARCHAND MYSTERE ABC', amount: -44 }),
            ],
            budgetItems: BUDGET_ITEMS,
            externalHintsById: new Map([[16, 'Groceries']]),
        });

        const byId = new Map(res.transactions.map(t => [t.id, t]));
        // Retour carte → Remboursement
        expect(byId.get(10)?.category).toBe('Remboursement');
        // Interac reçu → Remboursement ; Interac /Loyer → poste budget Logement
        expect(byId.get(11)?.category).toBe('Remboursement');
        expect(byId.get(13)?.category).toBe('Logement & Énergie');
        // Interac sortant générique → Autre avec confiance faible (< 75) marqué À vérifier
        expect(byId.get(12)?.category).toBe('Autre');
        expect(byId.get(12)?.confidence).toBe(45);
        expect(isTransactionNeedsReview(byId.get(12)!)).toBe(true);
        // Gros Costco mixte >= 350 $ → Épicerie & Alimentation mais À vérifier (confidence 65)
        expect(byId.get(14)?.category).toBe('Épicerie & Alimentation');
        expect(isTransactionNeedsReview(byId.get(14)!)).toBe(true);
        // Achat unique Apple → Loisirs (aligné sur le poste budget synonyme Sport & Santé ; sans budget = Loisirs)
        expect(byId.get(15)?.category).toBe('Sport & Santé');
        expect(isTransactionNeedsReview(byId.get(15)!)).toBe(false);
        const noBudgetApple = smartCategorizeTransactions({
            transactions: [makeTx({ id: 25, payee: 'APPLE.COM/BILL', amount: -299 })],
            budgetItems: [],
        });
        expect(noBudgetApple.transactions[0].category).toBe('Loisirs');
        // Indice externe Fintable traduit vers poste budget avec confiance 68 → affinable par IA
        expect(byId.get(16)?.category).toBe('Épicerie & Alimentation');
        expect(byId.get(16)?.confidence).toBe(68);
        expect(res.remainingForAiIds).toEqual(expect.arrayContaining([12, 14, 16, 17]));
    });

    it('extractRulePattern nettoie les préfixes bancaires et numéros de succursale', () => {
        expect(extractRulePattern('ACHAT / TIM HORTONS #4521 MONTREAL QC')).toBe('TIM HORTONS');
        expect(extractRulePattern('Paiement facture - AccèsD Internet / HYDRO-QUEBEC')).toBe('HYDRO-QUEBEC');
        expect(extractRulePattern('SQ *CAFE DU COIN')).toBe('CAFE DU COIN');
    });
});
