// @vitest-environment jsdom
// tests/assistant/agentLoop.test.ts
//
// Boucle agentique avec un FAUX client Gemini : appel d'outil → exécution réelle par le registre
// (store Zustand vivant) → résultat renvoyé au modèle → réponse finale. Plus les garde-fous :
// mode discret, annulation, limite d'itérations, arguments invalides.

import { describe, it, expect, beforeEach } from 'vitest';
import type { Content } from '@google/genai';
import { useFinanceStore } from '../../store/useFinanceStore';
import { executerTour, executerTourLocal, instructionSysteme, type ClientGemini, type RequeteGemini } from '../../services/assistant/agentLoop';
import { decouperAvisHonnete } from '../../services/geminiAssistant';
import { MESSAGE_IA_MODE_DISCRET } from '../../services/messageErreurIa';
import { _viderJournal } from '../../services/assistant/journalModifications';

/** Faux client : rejoue une suite de réponses et garde chaque requête reçue. */
function fauxClient(reponses: Content[]): ClientGemini & { requetes: RequeteGemini[] } {
    const requetes: RequeteGemini[] = [];
    let i = 0;
    return {
        requetes,
        async generer(req) {
            requetes.push(structuredClone({ ...req, signal: undefined }));
            const contenu = reponses[Math.min(i, reponses.length - 1)];
            i += 1;
            return { contenu };
        },
    };
}

const appel = (name: string, args: Record<string, unknown>, id?: string): Content => ({
    role: 'model',
    parts: [{ functionCall: { name, args, ...(id ? { id } : {}) } }],
});
const texte = (t: string): Content => ({ role: 'model', parts: [{ text: t }] });

const DETTE_FICTIVE = { name: 'Carte fictive', balance: 1200, interestRate: 19.99, minimumPayment: 50, category: 'CreditCard' };

describe('executerTour — boucle agentique', () => {
    beforeEach(() => {
        _viderJournal();
        useFinanceStore.getState().setAppState({ debts: [], budgetItems: [] });
        useFinanceStore.getState().setPrivacyMode(false);
    });

    it('appel d\'outil → exécution → résultat renvoyé → réponse finale', async () => {
        const client = fauxClient([appel('ajouter_dette', { element: DETTE_FICTIVE }, 'appel-1'), texte('Dette ajoutée.')]);
        const res = await executerTour({ client, modele: 'gemini-2.5-flash', historique: [], question: 'Ajoute ma carte', isPrivacyMode: false, outils: [] });

        expect(res.texte).toBe('Dette ajoutée.');
        expect(res.etapes).toEqual(['ajouter_dette']);
        expect(res.iterations).toBe(2);
        // L'écriture est RÉELLE et journalisée.
        const dettes = useFinanceStore.getState().debts;
        expect(dettes).toHaveLength(1);
        expect(dettes[0]).toMatchObject(DETTE_FICTIVE);
        expect(typeof dettes[0].id).toBe('string');
        expect(res.modifications).toHaveLength(1);
        expect(res.modifications[0].tranches).toEqual(['debts']);

        // Le 2e appel au modèle porte l'appel ET sa réponse (même id, même nom).
        const second = client.requetes[1].contenus;
        const reponse = second[second.length - 1];
        expect(reponse.role).toBe('user');
        expect(reponse.parts?.[0].functionResponse).toMatchObject({ id: 'appel-1', name: 'ajouter_dette' });
        expect(JSON.stringify(reponse.parts?.[0].functionResponse?.response)).toContain('"applique":true');
    });

    it('arguments invalides : rien n\'est écrit, l\'erreur est renvoyée au modèle', async () => {
        const client = fauxClient([appel('ajouter_dette', { element: { ...DETTE_FICTIVE, balance: 'beaucoup' } }), texte('Désolé.')]);
        const res = await executerTour({ client, modele: 'gemini-2.5-flash', historique: [], question: 'x', isPrivacyMode: false, outils: [] });
        expect(useFinanceStore.getState().debts).toHaveLength(0);
        expect(res.modifications).toHaveLength(0);
        const rep = client.requetes[1].contenus.at(-1)?.parts?.[0].functionResponse?.response as Record<string, unknown>;
        expect(rep).toHaveProperty('error');
    });

    it('lecture : lister renvoie les vraies données au modèle', async () => {
        useFinanceStore.getState().setAppState({ debts: [{ id: 'd1', ...DETTE_FICTIVE } as never] });
        const client = fauxClient([appel('lister_dettes', {}), texte('Tu as une dette.')]);
        await executerTour({ client, modele: 'gemini-2.5-flash', historique: [], question: 'Mes dettes ?', isPrivacyMode: false, outils: [] });
        const rep = JSON.stringify(client.requetes[1].contenus.at(-1)?.parts?.[0].functionResponse?.response);
        expect(rep).toContain('"total":1');
        expect(rep).toContain('d1');
    });

    it('bloc riche : afficher_bloc ajoute un bloc validé au tour', async () => {
        const bloc = { type: 'cartes_chiffres', cartes: [{ libelle: 'Épargne', valeur: null, unite: 'cad' }] };
        const client = fauxClient([appel('afficher_bloc', { bloc }), texte('Voici.')]);
        const res = await executerTour({ client, modele: 'gemini-2.5-flash', historique: [], question: 'x', isPrivacyMode: false, outils: [] });
        expect(res.blocs).toEqual([bloc]);
    });

    it('mode discret : aucun appel au modèle', async () => {
        const client = fauxClient([texte('ne doit pas arriver')]);
        await expect(executerTour({ client, modele: 'm', historique: [], question: 'x', isPrivacyMode: true, outils: [] }))
            .rejects.toThrow(MESSAGE_IA_MODE_DISCRET);
        expect(client.requetes).toHaveLength(0);
    });

    it('annulation : un signal coupé arrête la boucle avant tout appel', async () => {
        const client = fauxClient([texte('x')]);
        const ctrl = new AbortController();
        ctrl.abort();
        await expect(executerTour({ client, modele: 'm', historique: [], question: 'x', isPrivacyMode: false, signal: ctrl.signal, outils: [] }))
            .rejects.toBeTruthy();
        expect(client.requetes).toHaveLength(0);
    });

    it('limite d\'itérations : réponse honnête, jamais une boucle infinie', async () => {
        const client = fauxClient([appel('lister_dettes', {})]);
        const res = await executerTour({ client, modele: 'm', historique: [], question: 'x', isPrivacyMode: false, maxIterations: 3, outils: [] });
        expect(client.requetes).toHaveLength(3);
        expect(res.limiteAtteinte).toBe(true);
        expect(res.texte).toContain('limite de 3 étapes');
    });

    it('historique : les tours passés sont envoyés en texte, avec leurs modifications résumées', async () => {
        const client = fauxClient([texte('ok')]);
        await executerTour({
            client, modele: 'm', isPrivacyMode: false, outils: [], question: 'Et maintenant ?',
            historique: [
                { id: 'a', role: 'utilisateur', texte: 'Ajoute une dette', horodatage: '2026-01-01T00:00:00Z' },
                { id: 'b', role: 'assistant', texte: 'Fait.', horodatage: '2026-01-01T00:00:01Z', annulee: true,
                    modifications: [{ id: 'm1', action: 'ajouter_dette', resume: 'dette ajoutée', tranches: ['debts'], horodatage: '' }] },
            ],
        });
        const c = client.requetes[0].contenus;
        expect(c.map((x) => x.role)).toEqual(['user', 'model', 'user']);
        expect(c[1].parts?.[0].text).toContain('ANNULÉES');
    });

    it('avis honnête rapide : exigé dans l\'instruction système et extrait en tête avant le détail', async () => {
        expect(instructionSysteme('2026-11-03')).toContain('AVIS HONNÊTE :');
        const local = await executerTourLocal('Fais un bilan express', false);
        const decoupe = decouperAvisHonnete(local.texte);
        expect(decoupe.avis).toBeTruthy();
        expect(decoupe.detail).toBeTruthy();
        expect(decoupe.avis).not.toEqual(decoupe.detail);
    });
});
