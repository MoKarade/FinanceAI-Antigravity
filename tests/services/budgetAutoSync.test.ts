import { describe, it, expect } from 'vitest';
import {
    computeBudgetSyncPatch,
    findDriftedManualItems,
    realignItemsToRealAverage,
} from '../../services/budgetAutoSync';
import type { BudgetCategory, Transaction } from '../../types';

const REF = new Date(2026, 8, 15);

const tx = (id: string, date: string, category: string, amount: number): Transaction =>
    ({ id, date, payee: category, category, amount } as unknown as Transaction);

describe('budgetAutoSync', () => {
    it('retire les postes Transfert/Virement et ajoute les catégories manquantes sans écraser les cibles manuelles', () => {
        const transactions: Transaction[] = [
            tx('1', '2026-07-10', 'Épicerie', -600),
            tx('2', '2026-08-10', 'Épicerie', -800),
            tx('3', '2026-08-12', 'Loisirs', -200),
        ];
        const existing: BudgetCategory[] = [
            { id: 'tr1', name: 'Virements', target: 500, frequency: 'Monthly', type: 'Commun', nature: 'Epargne' },
            { id: 'ep1', name: 'Épicerie', target: 950, frequency: 'Monthly', type: 'Commun', nature: 'Besoin', autoTarget: false },
            { id: 'old1', name: 'Ancien poste', target: 100, frequency: 'Monthly', type: 'Commun', nature: 'Envie' },
        ];

        const firstPass = computeBudgetSyncPatch(transactions, existing, { allowRemoval: true, refDate: REF });
        expect(firstPass.changed).toBe(true);
        expect(firstPass.removedTransfers).toBe(true);
        expect(firstPass.removed).toContain('Ancien poste');
        expect(firstPass.added).toContain('Loisirs');
        expect(firstPass.items.find((i) => i.name === 'Épicerie')?.target).toBe(950);
        expect(firstPass.items.find((i) => i.name === 'Loisirs')?.autoTarget).toBe(true);
    });

    it('en mode incrémental (allowRemoval: false), garde les postes manuels vides mais ajoute les nouvelles catégories', () => {
        const transactions: Transaction[] = [
            tx('1', '2026-08-10', 'Restaurants', -300),
        ];
        const existing: BudgetCategory[] = [
            { id: 'm1', name: 'Nouveau projet', target: 150, frequency: 'Monthly', type: 'Commun', nature: 'Envie' },
        ];

        const patch = computeBudgetSyncPatch(transactions, existing, { allowRemoval: false, refDate: REF });
        expect(patch.changed).toBe(true);
        expect(patch.removed).toEqual([]);
        expect(patch.items.map((i) => i.name)).toEqual(['Nouveau projet', 'Restaurants']);
    });

    it('détecte les postes manuels qui dérivent de la moyenne réelle (hors Épargne) et les réaligne en 1 clic', () => {
        const items: BudgetCategory[] = [
            { id: 'b1', name: 'Restaurants', target: 150, frequency: 'Monthly', type: 'Commun', nature: 'Envie', autoTarget: false },
            { id: 'b2', name: 'Épicerie', target: 610, frequency: 'Monthly', type: 'Commun', nature: 'Besoin', autoTarget: false },
            { id: 'b3', name: 'CELI', target: 500, frequency: 'Monthly', type: 'Commun', nature: 'Epargne', autoTarget: false },
            { id: 'b4', name: 'Transport', target: 200, frequency: 'Monthly', type: 'Commun', nature: 'Besoin', autoTarget: true },
        ];
        const avg12 = { Restaurants: 320, Épicerie: 600, CELI: 100, Transport: 400 };

        const drifted = findDriftedManualItems(items, avg12);
        expect(drifted).toHaveLength(1);
        expect(drifted[0]).toEqual({ id: 'b1', name: 'Restaurants', currentMonthly: 150, avgMonthly: 320 });

        const updated = realignItemsToRealAverage(items, drifted);
        const resto = updated.find((i) => i.id === 'b1');
        expect(resto?.target).toBe(320);
        expect(resto?.frequency).toBe('Monthly');
        expect(resto?.autoTarget).toBe(true);
        expect(updated.find((i) => i.id === 'b2')?.autoTarget).toBe(false);
    });
});
