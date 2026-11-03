// services/assistant/conversations.ts
//
// Historique des conversations de l'assistant.
//  - Connecté (Firebase Auth) : Cloud Firestore `workspaces/{uid}/conversations/{conversationId}`
//    avec EXACTEMENT les champs exigés par `firestore.rules` : ownerId (= uid), title (1..200),
//    messagesJson (≤ 900 000 caractères — les plus vieux messages sont retirés au besoin),
//    messageCount (entier ≤ 2000), createdAt (serverTimestamp à la création, inchangé ensuite),
//    updatedAt (serverTimestamp).
//  - Non connecté, ou en mode test (données fictives : rien ne part en ligne) : repli local
//    (localStorage), même format.
// Le dépôt est une interface (`DepotConversations`) : les tests injectent une fausse version.

import type { Conversation, MessageConversation, ResumeConversation } from './types';

export const MAX_MESSAGES_JSON = 900_000;
export const MAX_MESSAGES = 2000;
export const MAX_TITRE = 200;

export interface DepotConversations {
    readonly genre: 'firestore' | 'local';
    lister(): Promise<ResumeConversation[]>;
    charger(id: string): Promise<Conversation | null>;
    /** Crée (si `!conversation.persistee`) ou met à jour. */
    enregistrer(conversation: Conversation): Promise<void>;
    renommer(id: string, titre: string): Promise<void>;
    supprimer(id: string): Promise<void>;
}

/** Identifiant compatible avec la règle `isValidId` (^[a-zA-Z0-9_-]+$). */
export function nouvelIdConversation(): string {
    const alea = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `conv-${alea}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Titre borné 1..200 (jamais vide). */
export function normaliserTitre(brut: string): string {
    const t = brut.replace(/\s+/g, ' ').trim().slice(0, MAX_TITRE);
    return t || 'Nouvelle conversation';
}

/** Titre par défaut : la première question, raccourcie. */
export function titreDepuisQuestion(question: string): string {
    const t = question.replace(/\s+/g, ' ').trim();
    return normaliserTitre(t.length > 60 ? `${t.slice(0, 57)}…` : t);
}

export function nouvelleConversation(): Conversation {
    return { id: nouvelIdConversation(), titre: 'Nouvelle conversation', messages: [], misAJourLe: new Date().toISOString(), persistee: false };
}

/**
 * Sérialise les messages en respectant les plafonds des règles : au plus 2000 messages et
 * 900 000 caractères — les PLUS VIEUX messages sont retirés en premier.
 */
export function serialiserMessages(messages: MessageConversation[]): { messagesJson: string; messageCount: number } {
    let garde = messages.slice(-MAX_MESSAGES);
    let json = JSON.stringify(garde);
    while (json.length > MAX_MESSAGES_JSON && garde.length > 0) {
        // Retrait proportionnel (au moins un) pour converger vite sur un très long fil.
        const surplus = json.length - MAX_MESSAGES_JSON;
        const aRetirer = Math.max(1, Math.floor((surplus / json.length) * garde.length));
        garde = garde.slice(aRetirer);
        json = JSON.stringify(garde);
    }
    return { messagesJson: json, messageCount: garde.length };
}

/** Désérialise sans jamais lever : un contenu illisible donne un fil vide. */
export function deserialiserMessages(json: unknown): MessageConversation[] {
    if (typeof json !== 'string') return [];
    try {
        const v: unknown = JSON.parse(json);
        if (!Array.isArray(v)) return [];
        return v.filter((m): m is MessageConversation =>
            !!m && typeof m === 'object'
            && typeof (m as MessageConversation).id === 'string'
            && ((m as MessageConversation).role === 'utilisateur' || (m as MessageConversation).role === 'assistant')
            && typeof (m as MessageConversation).texte === 'string');
    } catch {
        return [];
    }
}

// ── Repli local ────────────────────────────────────────────────────────────

const CLE_LOCALE = 'financeai-assistant-conversations';

interface EnregistrementLocal {
    id: string;
    title: string;
    messagesJson: string;
    messageCount: number;
    updatedAt: string;
}

export function creerDepotLocal(stockage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): DepotConversations {
    const lire = (): EnregistrementLocal[] => {
        try {
            const v: unknown = JSON.parse(stockage?.getItem(CLE_LOCALE) ?? '[]');
            return Array.isArray(v) ? (v as EnregistrementLocal[]) : [];
        } catch {
            return [];
        }
    };
    const ecrire = (liste: EnregistrementLocal[]): void => {
        stockage?.setItem(CLE_LOCALE, JSON.stringify(liste.slice(0, 50)));
    };
    return {
        genre: 'local',
        async lister() {
            return lire()
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .map((e) => ({ id: e.id, titre: e.title, misAJourLe: e.updatedAt, messageCount: e.messageCount }));
        },
        async charger(id) {
            const e = lire().find((x) => x.id === id);
            return e ? { id: e.id, titre: e.title, messages: deserialiserMessages(e.messagesJson), misAJourLe: e.updatedAt, persistee: true } : null;
        },
        async enregistrer(c) {
            const { messagesJson, messageCount } = serialiserMessages(c.messages);
            const liste = lire().filter((x) => x.id !== c.id);
            ecrire([{ id: c.id, title: normaliserTitre(c.titre), messagesJson, messageCount, updatedAt: new Date().toISOString() }, ...liste]);
        },
        async renommer(id, titre) {
            ecrire(lire().map((x) => (x.id === id ? { ...x, title: normaliserTitre(titre), updatedAt: new Date().toISOString() } : x)));
        },
        async supprimer(id) {
            ecrire(lire().filter((x) => x.id !== id));
        },
    };
}

// ── Cloud Firestore ────────────────────────────────────────────────────────

/** Sous-ensemble du SDK Firestore utilisé (injectable pour les tests). */
export interface FirestoreMinimal {
    serverTimestamp(): unknown;
    setDoc(chemin: string[], donnees: Record<string, unknown>): Promise<void>;
    updateDoc(chemin: string[], donnees: Record<string, unknown>): Promise<void>;
    deleteDoc(chemin: string[]): Promise<void>;
    getDoc(chemin: string[]): Promise<Record<string, unknown> | null>;
    listerParMiseAJour(chemin: string[], limite: number): Promise<Array<{ id: string; data: Record<string, unknown> }>>;
}

const versIso = (v: unknown): string => {
    if (v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function') {
        return ((v as { toDate: () => Date }).toDate()).toISOString();
    }
    return typeof v === 'string' ? v : new Date().toISOString();
};

export function creerDepotFirestore(uid: string, fs: FirestoreMinimal): DepotConversations {
    const collection = ['workspaces', uid, 'conversations'];
    const chemin = (id: string): string[] => [...collection, id];
    return {
        genre: 'firestore',
        async lister() {
            const docs = await fs.listerParMiseAJour(collection, 30);
            return docs.map((d) => ({
                id: d.id,
                titre: typeof d.data.title === 'string' ? d.data.title : 'Conversation',
                misAJourLe: versIso(d.data.updatedAt),
                messageCount: typeof d.data.messageCount === 'number' ? d.data.messageCount : 0,
            }));
        },
        async charger(id) {
            const d = await fs.getDoc(chemin(id));
            if (!d) return null;
            return {
                id,
                titre: typeof d.title === 'string' ? d.title : 'Conversation',
                messages: deserialiserMessages(d.messagesJson),
                misAJourLe: versIso(d.updatedAt),
                persistee: true,
            };
        },
        async enregistrer(c) {
            const { messagesJson, messageCount } = serialiserMessages(c.messages);
            const title = normaliserTitre(c.titre);
            if (!c.persistee) {
                await fs.setDoc(chemin(c.id), {
                    ownerId: uid,
                    title,
                    messagesJson,
                    messageCount,
                    createdAt: fs.serverTimestamp(),
                    updatedAt: fs.serverTimestamp(),
                });
            } else {
                // updateDoc : `createdAt` et `ownerId` restent ceux du document (règle d'immuabilité).
                await fs.updateDoc(chemin(c.id), { title, messagesJson, messageCount, updatedAt: fs.serverTimestamp() });
            }
        },
        async renommer(id, titre) {
            await fs.updateDoc(chemin(id), { title: normaliserTitre(titre), updatedAt: fs.serverTimestamp() });
        },
        async supprimer(id) {
            await fs.deleteDoc(chemin(id));
        },
    };
}

/** Adaptateur du vrai SDK Firestore (chargé paresseusement). */
async function firestoreReel(): Promise<{ uid: string | null; fs: FirestoreMinimal }> {
    const [{ db, auth }, { doc, serverTimestamp, setDoc, updateDoc, deleteDoc, getDoc, query, collection, orderBy, limit: bornerLimite, getDocs }] = await Promise.all([
        import('../firebase/firebaseClient'),
        import('firebase/firestore'),
    ]);
    const ref = (c: string[]) => doc(db, c[0], ...c.slice(1));
    return {
        uid: auth.currentUser?.uid ?? null,
        fs: {
            serverTimestamp: () => serverTimestamp(),
            setDoc: async (c, d) => { await setDoc(ref(c), d); },
            updateDoc: async (c, d) => { await updateDoc(ref(c), d); },
            deleteDoc: async (c) => { await deleteDoc(ref(c)); },
            getDoc: async (c) => {
                const s = await getDoc(ref(c));
                return s.exists() ? (s.data() as Record<string, unknown>) : null;
            },
            listerParMiseAJour: async (c, limite) => {
                const q = query(collection(db, c[0], ...c.slice(1)), orderBy('updatedAt', 'desc'), bornerLimite(limite));
                const snap = await getDocs(q);
                return snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
            },
        },
    };
}

/**
 * Choisit le dépôt : Firestore si un utilisateur est connecté (et hors mode test), sinon local.
 * Un échec de chargement du SDK retombe sur le local (jamais d'historique perdu en silence).
 */
export async function choisirDepot(opts: { donneesFictives: boolean }): Promise<DepotConversations> {
    if (opts.donneesFictives) return creerDepotLocal();
    try {
        const { uid, fs } = await firestoreReel();
        if (uid) return creerDepotFirestore(uid, fs);
    } catch {
        // SDK ou configuration indisponible : repli local.
    }
    return creerDepotLocal();
}
