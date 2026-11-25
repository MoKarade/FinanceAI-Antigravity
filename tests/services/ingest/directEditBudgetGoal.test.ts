// tests/services/ingest/directEditBudgetGoal.test.ts
import { formatCAD } from '../../../utils/format';
import { describe, it, expect } from 'vitest';
import { applyDocument, type BudgetItemPayload } from '../../../services/ingest/applyDocument';
import { buildDefaultAppState } from '../../../services/aiTools/appStateDefaults';
import type { AppState, BudgetCategory } from '../../../types';

const baseState = (): AppState => buildDefaultAppState();

function withBudget(): AppState {
    const s = baseState();
    s.budgetItems = [
        { id: 'cat_1700000000000', name: 'Épicerie', target: 550, frequency: 'Monthly', type: 'Commun', nature: 'Besoin', autoTarget: true },
        { id: 'cat_1700000000001', name: 'Loisirs', target: 200, frequency: 'Monthly', type: 'Commun', nature: 'Envie' },
    ] satisfies BudgetCategory[];
    return s;
}

const budgetDoc = (over: Partial<BudgetItemPayload> = {}): BudgetItemPayload =>
    ({ kind: 'budget_item', name: 'Épicerie', ...over });

describe('[HEALTH-RATIOS-NAN-ABSORBE-EN-AMONT] aucune fuite de « NaN » dans le diff montré à l\'utilisateur', () => {
    const corrompu = (): AppState => {
        const s = withBudget();
        (s.budgetItems[0] as { target: number }).target = NaN;
        return s;
    };

    it('une cible EXISTANTE illisible rend « — », jamais « NaN »', () => {
        const { changes } = applyDocument(corrompu(), budgetDoc({ frequency: 'Yearly' }));
        const texte = JSON.stringify(changes);
        expect(texte).not.toContain('NaN');
        expect(texte).toContain('non exploitable');
    });

    it('anti-vacuité : sur une cible SAINE, la note porte bien un montant chiffré', () => {
        const { changes } = applyDocument(withBudget(), budgetDoc({ frequency: 'Yearly' }));
        const note = String(changes.find((c) => c.field.includes('fréquence'))?.note ?? '');
        expect(note).toContain(formatCAD(550));
        expect(note).toContain(formatCAD(46));
        expect(note).not.toContain('non exploitable');
    });
});

describe('applyBudgetItem — mise à jour PAR NOM (partielle, idempotente)', () => {
    it('édite la CIBLE d\'un poste auto-géré → target changé ET autoTarget décroché (false)', () => {
        const { nextState, changes } = applyDocument(withBudget(), budgetDoc({ targetCad: 600 }));
        const b = nextState.budgetItems.find((x) => x.name === 'Épicerie')!;
        expect(b.target).toBe(600);
        expect(b.autoTarget).toBe(false);
        expect(changes).toHaveLength(1);
        expect(changes[0].note).toMatch(/auto-gérée décrochée/);
        expect(b.frequency).toBe('Monthly');
        expect(b.nature).toBe('Besoin');
    });

    it('matche le nom SANS casse ni accents (« epicerie » → poste « Épicerie », pas de doublon)', () => {
        const { nextState } = applyDocument(withBudget(), budgetDoc({ name: '  epicerie ', targetCad: 700 }));
        expect(nextState.budgetItems).toHaveLength(2);
        expect(nextState.budgetItems.find((x) => x.name === 'Épicerie')!.target).toBe(700);
    });

    it('retry identique → 0 changement (idempotent), autoTarget NON décroché par un no-op', () => {
        const first = applyDocument(withBudget(), budgetDoc({ targetCad: 600 }));
        const second = applyDocument(first.nextState, budgetDoc({ targetCad: 600 }));
        expect(second.changes).toHaveLength(0);
        const noop = applyDocument(withBudget(), budgetDoc({ targetCad: 550 }));
        expect(noop.changes).toHaveLength(0);
        expect(noop.nextState.budgetItems.find((x) => x.name === 'Épicerie')!.autoTarget).toBe(true);
    });

    it('met à jour nature/type SANS toucher la cible (autoTarget PRÉSERVÉ)', () => {
        const { nextState, changes } = applyDocument(withBudget(), budgetDoc({ nature: 'Envie' }));
        const b = nextState.budgetItems.find((x) => x.name === 'Épicerie')!;
        expect(b.nature).toBe('Envie');
        expect(b.target).toBe(550);
        expect(b.autoTarget).toBe(true);
        expect(changes).toHaveLength(1);
    });

    it('éditer la FRÉQUENCE seule DÉCROCHE autoTarget (parité Budget.tsx — finding ÉLEVÉ panel)', () => {
        const { nextState, changes } = applyDocument(withBudget(), budgetDoc({ frequency: 'Yearly' }));
        const b = nextState.budgetItems.find((x) => x.name === 'Épicerie')!;
        expect(b.frequency).toBe('Yearly');
        expect(b.autoTarget).toBe(false);
        expect(b.target).toBe(550);
        expect(String(changes[0].note)).toContain(`${formatCAD(550)} à ${formatCAD(46)}`);
    });

    it('AJOUT : cible requise ; défauts Monthly/Commun/Besoin, autoTarget false, id horodaté cat_', () => {
        expect(() => applyDocument(baseState(), budgetDoc({ name: 'Nouveau poste' })))
            .toThrow(/introuvable.*requis/s);
        const { nextState, changes } = applyDocument(baseState(), budgetDoc({ name: 'Resto', targetCad: 250 }));
        const b = nextState.budgetItems.find((x) => x.name === 'Resto')!;
        expect(b.target).toBe(250);
        expect(b.frequency).toBe('Monthly');
        expect(b.type).toBe('Commun');
        expect(b.nature).toBe('Besoin');
        expect(b.autoTarget).toBe(false);
        expect(b.id).toMatch(/^cat_\d+_[a-z0-9]+$/);
        expect(changes).toHaveLength(1);
    });

    it('AJOUT d\'un poste SANS catégorie de transactions observée → avertit qu\'il sera RETIRÉ au prochain sync', () => {
        const s = withBudget();
        const { changes, summary } = applyDocument(s, budgetDoc({ name: 'Cadeaux Noël', targetCad: 1200, frequency: 'Yearly' }));
        expect(String(changes[0].note)).toMatch(/RETIRÉ au prochain chargement/);
        expect(summary).toMatch(/RETIRÉ au prochain chargement/);
    });

    it('AJOUT d\'un poste dont le nom rapproche une catégorie OBSERVÉE (fuzzy budgetSync) → pas d\'avertissement', () => {
        const s = withBudget();
        s.transactions = [{ id: 9, date: '2026-01-05', amount: -80, category: 'Restaurants', payee: 'Bistro', status: 'processed' }] as AppState['transactions'];
        const { changes } = applyDocument(s, budgetDoc({ name: 'Restaurant', targetCad: 300 }));
        expect(String(changes[0].note ?? '')).not.toMatch(/RETIRÉ/);
    });

    it('REJETTE (throw, rien écrit) : cible négative / non finie / aberrante ; nom vide', () => {
        for (const t of [-1, Infinity, NaN, 2_000_000]) {
            expect(() => applyDocument(withBudget(), budgetDoc({ targetCad: t }))).toThrow(/invalide|aberrant/i);
        }
        expect(() => applyDocument(withBudget(), budgetDoc({ name: '  ' }))).toThrow(/requis/);
        const s = withBudget();
        try { applyDocument(s, budgetDoc({ targetCad: Infinity })); } catch { /* attendu */ }
        expect(s.budgetItems.find((x) => x.name === 'Épicerie')!.target).toBe(550);
    });
});

describe('applyBudgetItem — garde ménage solo (Perso 2)', () => {
    it("rejette « Perso 2 » quand aucun 2ᵉ conjoint n'est NOMMÉ (contenu, pas longueur du tuple)", () => {
        const solo = withBudget();
        if (solo.config?.users?.[1]) solo.config.users[1].name = '';
        expect(() => applyDocument(solo, budgetDoc({ type: 'Perso 2' }))).toThrow(/2ᵉ conjoint|Perso 2/);
    });

    it('accepte « Perso 2 » quand le 2ᵉ conjoint est nommé', () => {
        const duo = withBudget();
        if (duo.config?.users?.[1]) duo.config.users[1].name = 'Sophie';
        const { nextState } = applyDocument(duo, budgetDoc({ type: 'Perso 2' }));
        expect(nextState.budgetItems.find((x) => x.name === 'Épicerie')!.type).toBe('Perso 2');
    });
});
