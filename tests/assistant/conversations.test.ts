// tests/assistant/conversations.test.ts
//
// Persistance / reprise d'une conversation : fausse version de Firestore (contrat EXACT des règles :
// ownerId, title, messagesJson, messageCount, createdAt, updatedAt), repli local, troncature.

import { describe, it, expect } from 'vitest';
import {
    creerDepotFirestore,
    creerDepotLocal,
    serialiserMessages,
    nouvelleConversation,
    MAX_MESSAGES_JSON,
    type FirestoreMinimal,
} from '../../services/assistant/conversations';
import type { MessageConversation } from '../../services/assistant/types';

const HORLOGE = { toDate: () => new Date('2026-11-03T12:00:00Z') };

function fauxFirestore() {
    const docs = new Map<string, Record<string, unknown>>();
    const ecritures: Array<{ op: string; chemin: string; donnees?: Record<string, unknown> }> = [];
    const cle = (c: string[]) => c.join('/');
    const fs: FirestoreMinimal = {
        serverTimestamp: () => '__serverTimestamp__',
        async setDoc(c, d) {
            ecritures.push({ op: 'set', chemin: cle(c), donnees: d });
            docs.set(cle(c), { ...d, createdAt: HORLOGE, updatedAt: HORLOGE });
        },
        async updateDoc(c, d) {
            ecritures.push({ op: 'update', chemin: cle(c), donnees: d });
            const ex = docs.get(cle(c));
            if (!ex) throw new Error('not-found');
            docs.set(cle(c), { ...ex, ...d, updatedAt: HORLOGE });
        },
        async deleteDoc(c) { ecritures.push({ op: 'delete', chemin: cle(c) }); docs.delete(cle(c)); },
        async getDoc(c) { return docs.get(cle(c)) ?? null; },
        async listerParMiseAJour(c) {
            const prefixe = `${cle(c)}/`;
            return [...docs.entries()].filter(([k]) => k.startsWith(prefixe)).map(([k, data]) => ({ id: k.slice(prefixe.length), data }));
        },
    };
    return { fs, docs, ecritures };
}

const msg = (id: string, role: MessageConversation['role'], texte: string): MessageConversation => ({ id, role, texte, horodatage: '2026-11-03T12:00:00Z' });

describe('historique des conversations — Cloud Firestore (fausse version)', () => {
    it('création : EXACTEMENT les champs des règles, createdAt/updatedAt = serverTimestamp', async () => {
        const { fs, ecritures } = fauxFirestore();
        const depot = creerDepotFirestore('uid_fictif', fs);
        const c = { ...nouvelleConversation(), titre: 'Mon budget', messages: [msg('1', 'utilisateur', 'Bonjour'), msg('2', 'assistant', 'Salut')] };
        await depot.enregistrer(c);

        expect(ecritures).toHaveLength(1);
        expect(ecritures[0].op).toBe('set');
        expect(ecritures[0].chemin).toBe(`workspaces/uid_fictif/conversations/${c.id}`);
        expect(Object.keys(ecritures[0].donnees!).sort()).toEqual(['createdAt', 'messageCount', 'messagesJson', 'ownerId', 'title', 'updatedAt']);
        expect(ecritures[0].donnees).toMatchObject({ ownerId: 'uid_fictif', title: 'Mon budget', messageCount: 2, createdAt: '__serverTimestamp__', updatedAt: '__serverTimestamp__' });
        expect(c.id).toMatch(/^[a-zA-Z0-9_-]+$/);
    });

    it('mise à jour : updateDoc sans ownerId ni createdAt (immuables), puis reprise fidèle', async () => {
        const { fs, ecritures } = fauxFirestore();
        const depot = creerDepotFirestore('uid_fictif', fs);
        const c = { ...nouvelleConversation(), titre: 'Retraite', messages: [msg('1', 'utilisateur', 'Question')] };
        await depot.enregistrer(c);
        const suite = { ...c, persistee: true, messages: [...c.messages, msg('2', 'assistant', 'Réponse')] };
        await depot.enregistrer(suite);

        const maj = ecritures[1];
        expect(maj.op).toBe('update');
        expect(Object.keys(maj.donnees!).sort()).toEqual(['messageCount', 'messagesJson', 'title', 'updatedAt']);

        const repris = await depot.charger(c.id);
        expect(repris?.messages).toEqual(suite.messages);
        expect(repris?.titre).toBe('Retraite');
        expect(repris?.persistee).toBe(true);
        expect(repris?.misAJourLe).toBe('2026-11-03T12:00:00.000Z');
    });

    it('liste, renommage (borné à 200) et suppression', async () => {
        const { fs } = fauxFirestore();
        const depot = creerDepotFirestore('uid_fictif', fs);
        const c = { ...nouvelleConversation(), titre: 'A', messages: [msg('1', 'utilisateur', 'x')] };
        await depot.enregistrer(c);
        await depot.renommer(c.id, `  ${'é'.repeat(250)}  `);
        const [r] = await depot.lister();
        expect(r.titre).toHaveLength(200);
        expect(r.messageCount).toBe(1);
        await depot.renommer(c.id, '   ');
        expect((await depot.lister())[0].titre).toBe('Nouvelle conversation');
        await depot.supprimer(c.id);
        expect(await depot.lister()).toEqual([]);
    });
});

describe('troncature et repli local', () => {
    it('messagesJson ≤ 900 000 caractères : les plus vieux messages sont retirés', () => {
        const gros = 'x'.repeat(50_000);
        const messages = Array.from({ length: 30 }, (_, i) => msg(String(i), i % 2 ? 'assistant' : 'utilisateur', gros));
        const { messagesJson, messageCount } = serialiserMessages(messages);
        expect(messagesJson.length).toBeLessThanOrEqual(MAX_MESSAGES_JSON);
        expect(messageCount).toBeLessThan(30);
        const gardes = JSON.parse(messagesJson) as MessageConversation[];
        expect(gardes.at(-1)?.id).toBe('29'); // le plus récent est conservé
    });

    it('au plus 2000 messages', () => {
        const messages = Array.from({ length: 2100 }, (_, i) => msg(String(i), 'utilisateur', 'a'));
        expect(serialiserMessages(messages).messageCount).toBe(2000);
    });

    it('dépôt local : enregistrement, reprise, suppression', async () => {
        const memoire = new Map<string, string>();
        const depot = creerDepotLocal({ getItem: (k) => memoire.get(k) ?? null, setItem: (k, v) => { memoire.set(k, v); } });
        const c = { ...nouvelleConversation(), titre: 'Local', messages: [msg('1', 'utilisateur', 'Salut')] };
        await depot.enregistrer(c);
        expect((await depot.charger(c.id))?.messages).toEqual(c.messages);
        expect((await depot.lister())[0].titre).toBe('Local');
        await depot.supprimer(c.id);
        expect(await depot.charger(c.id)).toBeNull();
    });
});
