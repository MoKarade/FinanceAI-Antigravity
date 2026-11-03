import { collection, doc, getDocs, writeBatch, serverTimestamp } from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import { db, OperationType, handleFirestoreError } from './firebaseClient';
import { requireAuthenticatedUser } from './firestoreService';

/**
 * Stockage des transactions par mois dans Cloud Firestore :
 * `workspaces/{uid}/transactionMonths/{AAAA-MM}`.
 *
 * Le document principal `workspaces/{uid}` est plafonné à 1 Mo : y ranger tout l'historique
 * obligeait à couper les transactions les plus anciennes. Ici, chaque mois vit dans son propre
 * document, sans plafond global, et seuls les mois modifiés sont réécrits (empreinte par mois).
 *
 * Contrat des champs (aligné sur `firestore.rules`) : `ownerId` (= uid), `month` (= id du doc),
 * `count` (entier ≤ 5000), `jsonChunks` (1 à 20 chaînes ≤ 900 000 caractères),
 * `revisionId` (`^[a-zA-Z0-9_\-]+$`, ≤ 64), `updatedAt` (`serverTimestamp()`).
 */

export const TRANSACTION_MONTHS_COLLECTION = 'transactionMonths';
export const MAX_TRANSACTIONS_PER_MONTH_DOC = 5000;
export const MAX_MONTH_DOC_CHUNKS = 20;
/** Taille d'un bloc JSON (les règles acceptent jusqu'à 900 000 caractères par bloc). */
export const MONTH_CHUNK_CHAR_SIZE = 200_000;
/** Marge sous la limite Firestore de 1 Mio par document. */
export const MAX_MONTH_DOC_UTF8_BYTES = 900_000;
const MONTH_ID_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
/** Une écriture groupée Firestore accepte 500 opérations : on garde une marge. */
const MAX_BATCH_OPERATIONS = 450;
/** Une requête de validation Firestore est limitée à 10 Mio : on garde une marge. */
const MAX_BATCH_UTF8_BYTES = 8_000_000;

export interface LocalTransactionMonth {
    month: string;
    transactions: unknown[];
    json: string;
    count: number;
    fingerprint: string;
}

export interface TransactionMonthPartition {
    /** Mois rangeables dans la sous-collection, du plus récent au plus ancien. */
    months: LocalTransactionMonth[];
    /**
     * Transactions qui restent dans le document principal : date illisible, ou mois qui
     * dépasse le contrat (plus de 5 000 opérations ou plus de 900 Ko). Aucune n'est perdue.
     */
    leftovers: unknown[];
}

export interface RemoteTransactionMonth {
    month: string;
    transactions: unknown[];
    count: number;
    fingerprint: string;
    revisionId: string;
}

export interface TransactionMonthWritePlan {
    /** Mois à créer ou réécrire (empreinte différente ou absente du Cloud). */
    upserts: LocalTransactionMonth[];
    /** Mois présents dans le Cloud mais vides en local : document à supprimer. */
    deletes: string[];
    /** Empreintes du Cloud une fois le plan appliqué. */
    nextFingerprints: Map<string, string>;
}

function measureUtf8Bytes(str: string): number {
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str).byteLength;
    }
    return str.length * 3;
}

/** Retourne la clé `AAAA-MM` d'une transaction, ou `null` si sa date est illisible. */
export function monthKeyOfTransaction(tx: unknown): string | null {
    if (!tx || typeof tx !== 'object') return null;
    const date = (tx as { date?: unknown }).date;
    if (typeof date !== 'string' || date.length < 7) return null;
    const key = date.slice(0, 7);
    return MONTH_ID_REGEX.test(key) ? key : null;
}

/**
 * Empreinte courte et déterministe d'un mois sérialisé (hachage cyrb53 + longueur), pour ne
 * réécrire que les mois dont le contenu a réellement changé.
 */
export function fingerprintMonthJson(json: string): string {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < json.length; i++) {
        const ch = json.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
    return `${hash.toString(36)}_${json.length.toString(36)}`;
}

/** Découpe un mois sérialisé en blocs (au moins un bloc, même pour une chaîne vide). */
export function chunkMonthJson(json: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += MONTH_CHUNK_CHAR_SIZE) {
        chunks.push(json.slice(i, i + MONTH_CHUNK_CHAR_SIZE));
    }
    return chunks.length > 0 ? chunks : [''];
}

/**
 * Répartit les transactions par mois en conservant leur ordre relatif. Un mois qui dépasse le
 * contrat de la sous-collection reste entier dans `leftovers` (document principal) : rien n'est coupé.
 */
export function partitionTransactionsByMonth(transactions: readonly unknown[]): TransactionMonthPartition {
    const groups = new Map<string, unknown[]>();
    const unreadable = new Set<number>();
    transactions.forEach((tx, index) => {
        const key = monthKeyOfTransaction(tx);
        if (!key) {
            unreadable.add(index);
            return;
        }
        const list = groups.get(key);
        if (list) list.push(tx);
        else groups.set(key, [tx]);
    });

    const months: LocalTransactionMonth[] = [];
    const oversizedMonths = new Set<string>();
    for (const [month, list] of groups) {
        const json = JSON.stringify(list);
        const tooMany = list.length > MAX_TRANSACTIONS_PER_MONTH_DOC;
        const tooBig =
            measureUtf8Bytes(json) > MAX_MONTH_DOC_UTF8_BYTES ||
            Math.ceil(json.length / MONTH_CHUNK_CHAR_SIZE) > MAX_MONTH_DOC_CHUNKS;
        if (tooMany || tooBig) {
            oversizedMonths.add(month);
            continue;
        }
        months.push({ month, transactions: list, json, count: list.length, fingerprint: fingerprintMonthJson(json) });
    }
    months.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));

    const leftovers = transactions.filter((tx, index) => {
        if (unreadable.has(index)) return true;
        const key = monthKeyOfTransaction(tx);
        return key !== null && oversizedMonths.has(key);
    });

    return { months, leftovers };
}

/** Lit un document de mois ; lève une erreur si son contenu est illisible (jamais ignoré en silence). */
export function parseTransactionMonthDoc(id: string, data: Record<string, unknown>): RemoteTransactionMonth {
    const chunks = Array.isArray(data.jsonChunks) ? data.jsonChunks : null;
    if (!chunks || chunks.some((c) => typeof c !== 'string')) {
        throw new Error(`Mois de transactions ${id} illisible : blocs JSON absents ou invalides.`);
    }
    const json = (chunks as string[]).join('');
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        throw new Error(`Mois de transactions ${id} illisible : JSON corrompu.`);
    }
    if (!Array.isArray(parsed)) {
        throw new Error(`Mois de transactions ${id} illisible : liste attendue.`);
    }
    return {
        month: id,
        transactions: parsed,
        count: parsed.length,
        fingerprint: fingerprintMonthJson(json),
        revisionId: typeof data.revisionId === 'string' ? data.revisionId : '',
    };
}

/** Empreintes Cloud par mois, à partir des documents lus. */
export function fingerprintsOfRemoteMonths(months: readonly RemoteTransactionMonth[]): Map<string, string> {
    return new Map(months.map((m) => [m.month, m.fingerprint]));
}

function dateOf(tx: unknown): string {
    if (!tx || typeof tx !== 'object') return '';
    const date = (tx as { date?: unknown }).date;
    return typeof date === 'string' ? date : '';
}

/** Tri stable, plus récent d'abord (les dates illisibles finissent en bas). */
export function sortTransactionsNewestFirst<T>(list: readonly T[]): T[] {
    return list
        .map((tx, index) => ({ tx, index, date: dateOf(tx) }))
        .sort((a, b) => {
            if (a.date !== b.date) return a.date < b.date ? 1 : -1;
            return a.index - b.index;
        })
        .map((entry) => entry.tx);
}

function idKeyOf(tx: unknown): string | null {
    if (!tx || typeof tx !== 'object') return null;
    const id = (tx as { id?: unknown }).id;
    if (typeof id === 'number' && Number.isFinite(id)) return `n:${id}`;
    if (typeof id === 'string' && id.length > 0) return `s:${id}`;
    return null;
}

/**
 * Fusionne les transactions du document principal et celles des mois. Le document principal
 * l'emporte sur un même `id` (un ancien client a pu le réécrire après la migration) ; les
 * doublons internes d'une même source sont conservés tels quels.
 */
export function mergeTransactionSources(
    mainTransactions: readonly unknown[] | null | undefined,
    months: readonly RemoteTransactionMonth[],
): unknown[] {
    const main = Array.isArray(mainTransactions) ? mainTransactions : [];
    const mainIds = new Set<string>();
    for (const tx of main) {
        const key = idKeyOf(tx);
        if (key) mainIds.add(key);
    }
    const ordered = [...months].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0));
    const fromMonths: unknown[] = [];
    for (const month of ordered) {
        for (const tx of month.transactions) {
            const key = idKeyOf(tx);
            if (key && mainIds.has(key)) continue;
            fromMonths.push(tx);
        }
    }
    return sortTransactionsNewestFirst([...fromMonths, ...main]);
}

/** Ne réécrit que les mois dont l'empreinte diffère ; supprime les mois devenus vides. */
export function planTransactionMonthWrites(
    partition: TransactionMonthPartition,
    remoteFingerprints: ReadonlyMap<string, string>,
): TransactionMonthWritePlan {
    const upserts = partition.months.filter((m) => remoteFingerprints.get(m.month) !== m.fingerprint);
    const localMonths = new Set(partition.months.map((m) => m.month));
    const deletes = [...remoteFingerprints.keys()].filter((month) => !localMonths.has(month)).sort();
    const nextFingerprints = new Map(partition.months.map((m) => [m.month, m.fingerprint]));
    return { upserts, deletes, nextFingerprints };
}

interface AuthOptions {
    expectedUid: string;
    authenticatedUser: FirebaseUser;
}

/** Charge tous les mois de transactions du dossier `workspaces/{uid}`. */
export async function loadTransactionMonths(uid: string, user: FirebaseUser): Promise<RemoteTransactionMonth[]> {
    const path = `workspaces/${uid}/${TRANSACTION_MONTHS_COLLECTION}`;
    const authOpts: AuthOptions = { expectedUid: uid, authenticatedUser: user };
    requireAuthenticatedUser(OperationType.LIST, path, authOpts);
    let snap: Awaited<ReturnType<typeof getDocs>>;
    try {
        snap = await getDocs(collection(db, 'workspaces', uid, TRANSACTION_MONTHS_COLLECTION));
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, path);
    }
    const months: RemoteTransactionMonth[] = [];
    for (const docSnap of snap.docs) {
        if (!MONTH_ID_REGEX.test(docSnap.id)) continue;
        months.push(parseTransactionMonthDoc(docSnap.id, docSnap.data() as Record<string, unknown>));
    }
    return months;
}

export interface WorkspaceMainWrite {
    mode: 'create' | 'update';
    data: Record<string, unknown>;
}

/**
 * Applique le plan des mois puis écrit le document principal, en écritures groupées
 * (`writeBatch`). Le document principal part dans le DERNIER lot : un écouteur qui voit le
 * nouveau `revisionId` trouve donc tous les mois déjà validés.
 */
export async function commitWorkspaceWithTransactionMonths(params: {
    uid: string;
    user: FirebaseUser;
    revisionId: string;
    plan: TransactionMonthWritePlan;
    main: WorkspaceMainWrite;
}): Promise<void> {
    const { uid, user, revisionId, plan, main } = params;
    const path = `workspaces/${uid}`;
    const authOpts: AuthOptions = { expectedUid: uid, authenticatedUser: user };
    requireAuthenticatedUser(OperationType.WRITE, path, authOpts);

    type Operation =
        | { kind: 'set-month'; month: LocalTransactionMonth; bytes: number }
        | { kind: 'delete-month'; month: string; bytes: number };
    const operations: Operation[] = [
        ...plan.upserts.map((month) => ({
            kind: 'set-month' as const,
            month,
            bytes: measureUtf8Bytes(month.json) + 512,
        })),
        ...plan.deletes.map((month) => ({ kind: 'delete-month' as const, month, bytes: 128 })),
    ];

    const batches: Operation[][] = [[]];
    let currentBytes = 0;
    for (const op of operations) {
        const current = batches[batches.length - 1];
        if (current.length >= MAX_BATCH_OPERATIONS || (current.length > 0 && currentBytes + op.bytes > MAX_BATCH_UTF8_BYTES)) {
            batches.push([op]);
            currentBytes = op.bytes;
        } else {
            current.push(op);
            currentBytes += op.bytes;
        }
    }

    try {
        for (let index = 0; index < batches.length; index++) {
            const batch = writeBatch(db);
            for (const op of batches[index]) {
                if (op.kind === 'set-month') {
                    batch.set(doc(db, 'workspaces', uid, TRANSACTION_MONTHS_COLLECTION, op.month.month), {
                        ownerId: uid,
                        month: op.month.month,
                        count: op.month.count,
                        jsonChunks: chunkMonthJson(op.month.json),
                        revisionId,
                        updatedAt: serverTimestamp(),
                    });
                } else {
                    batch.delete(doc(db, 'workspaces', uid, TRANSACTION_MONTHS_COLLECTION, op.month));
                }
            }
            if (index === batches.length - 1) {
                const mainRef = doc(db, 'workspaces', uid);
                if (main.mode === 'create') batch.set(mainRef, main.data);
                else batch.update(mainRef, main.data);
            }
            await batch.commit();
        }
    } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
    }
}
