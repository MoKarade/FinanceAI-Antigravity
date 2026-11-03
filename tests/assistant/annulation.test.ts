// @vitest-environment jsdom
// tests/assistant/annulation.test.ts
//
// Annulation EXACTE d'une écriture de l'assistant : seules les tranches touchées sont restaurées,
// à l'identique ; refus si l'état a bougé depuis ; `apiKeys` jamais touché.

import { describe, it, expect, beforeEach } from 'vitest';
import { useFinanceStore } from '../../store/useFinanceStore';
import { executerAction } from '../../services/assistant/actionRegistry';
import { annulerGroupe, annulationDisponible, _viderJournal } from '../../services/assistant/journalModifications';

const POSTE = { id: 'b1', name: 'Épicerie fictive', target: 500, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' };

describe('journal des modifications — bouton Annuler', () => {
    beforeEach(() => {
        _viderJournal();
        useFinanceStore.getState().setAppState({ budgetItems: [POSTE as never], debts: [] });
    });

    it('une modification annulée restaure EXACTEMENT la tranche, sans toucher le reste', async () => {
        const avantBudget = structuredClone(useFinanceStore.getState().budgetItems);
        const avantDettes = structuredClone(useFinanceStore.getState().debts);
        const cles = useFinanceStore.getState().apiKeys;

        const r = await executerAction('modifier_poste_budget', { id: 'b1', champs: { target: 650 } });
        expect(r.erreur).toBe(false);
        expect(useFinanceStore.getState().budgetItems[0].target).toBe(650);
        expect(r.entree?.tranches).toEqual(['budgetItems']);
        expect(annulationDisponible([r.entree!.id])).toBe(true);

        const res = annulerGroupe([r.entree!.id]);
        expect(res).toEqual({ ok: true, tranches: ['budgetItems'] });
        expect(useFinanceStore.getState().budgetItems).toEqual(avantBudget);
        expect(useFinanceStore.getState().debts).toEqual(avantDettes);
        expect(useFinanceStore.getState().apiKeys).toBe(cles);
        expect(annulationDisponible([r.entree!.id])).toBe(false);
    });

    it('un groupe (plusieurs écritures d\'un tour) revient à l\'état d\'avant la PREMIÈRE', async () => {
        const avant = structuredClone(useFinanceStore.getState().budgetItems);
        const a = await executerAction('modifier_poste_budget', { id: 'b1', champs: { target: 700 } });
        const b = await executerAction('ajouter_poste_budget', { element: { name: 'Loisirs fictifs', target: 100, frequency: 'Monthly', type: 'Commun', nature: 'Envie' } });
        expect(useFinanceStore.getState().budgetItems).toHaveLength(2);
        const res = annulerGroupe([a.entree!.id, b.entree!.id]);
        expect(res.ok).toBe(true);
        expect(useFinanceStore.getState().budgetItems).toEqual(avant);
    });

    it('refus si la tranche a changé depuis (pas d\'écrasement silencieux)', async () => {
        const r = await executerAction('supprimer_poste_budget', { id: 'b1' });
        expect(useFinanceStore.getState().budgetItems).toHaveLength(0);
        useFinanceStore.getState().setAppState({ budgetItems: [{ ...POSTE, id: 'b2' } as never] });
        const res = annulerGroupe([r.entree!.id]);
        expect(res.ok).toBe(false);
        expect(useFinanceStore.getState().budgetItems.map((b) => b.id)).toEqual(['b2']);
    });

    it('une écriture qui ne change rien ne crée pas d\'entrée', async () => {
        const r = await executerAction('modifier_poste_budget', { id: 'b1', champs: { target: 500 } });
        expect(r.entree).toBeNull();
    });

    it('une écriture qui casserait les types persistés est refusée et rien n\'est écrit', async () => {
        const avant = structuredClone(useFinanceStore.getState().initialBalances);
        const r = await executerAction('modifier_soldes_initiaux', { champs: { Cheques: 'mille' } });
        expect(r.erreur).toBe(true);
        expect(r.entree).toBeNull();
        expect(useFinanceStore.getState().initialBalances).toEqual(avant);
    });

    it('instantané expiré (session précédente) : annulation refusée proprement', () => {
        const res = annulerGroupe(['mod-inconnu']);
        expect(res.ok).toBe(false);
    });
});
