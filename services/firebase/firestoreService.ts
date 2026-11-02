import {
    doc,
    collection,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    type QueryConstraint,
    type DocumentData,
} from 'firebase/firestore';
import type { User as FirebaseUser } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import {
    app,
    db,
    auth,
    googleProvider,
    OperationType,
    handleFirestoreError,
    testFirestoreConnection,
} from './firebaseClient';

interface FirestoreCrudOptions {
    /** UID attendu du propriétaire du document pour appliquer le contrôle d'accès côté client */
    expectedUid?: string;
    /** Instance d'utilisateur Firebase déjà résolue par le garde d'authentification */
    authenticatedUser?: FirebaseUser | null;
}

interface FirestoreDocResult<T = DocumentData> {
    id: string;
    exists: boolean;
    data: T | null;
}

/**
 * Vérifie que la requête CRUD Firestore provient d'un utilisateur Firebase authentifié
 * et que l'identifiant correspond au propriétaire attendu (`expectedUid`).
 */
export function requireAuthenticatedUser(
    operationType: OperationType,
    path: string,
    options?: FirestoreCrudOptions,
): FirebaseUser {
    const activeUser = auth.currentUser ?? options?.authenticatedUser ?? null;

    if (!activeUser || !activeUser.uid) {
        handleFirestoreError(
            new Error('Authentification Firebase requise pour exécuter cette opération Firestore.'),
            operationType,
            path,
        );
    }

    if (
        auth.currentUser &&
        options?.authenticatedUser &&
        auth.currentUser.uid !== options.authenticatedUser.uid
    ) {
        handleFirestoreError(
            new Error('Conflit de session Firebase détecté entre l’utilisateur actif et la requête.'),
            operationType,
            path,
        );
    }

    if (options?.expectedUid && activeUser.uid !== options.expectedUid) {
        handleFirestoreError(
            new Error(
                `Accès refusé : l'utilisateur (${activeUser.uid}) ne correspond pas au propriétaire (${options.expectedUid}).`,
            ),
            operationType,
            path,
        );
    }

    return activeUser;
}

/**
 * Lit un document Firestore après vérification stricte de l'authentification.
 */
export async function getDocument<T = DocumentData>(
    collectionName: string,
    docId: string,
    options?: FirestoreCrudOptions,
): Promise<FirestoreDocResult<T>> {
    const path = `${collectionName}/${docId}`;
    requireAuthenticatedUser(OperationType.GET, path, options);

    try {
        const ref = doc(db, collectionName, docId);
        const snap = await getDoc(ref);
        return {
            id: snap.id,
            exists: snap.exists(),
            data: snap.exists() ? (snap.data() as T) : null,
        };
    } catch (error) {
        handleFirestoreError(error, OperationType.GET, path);
    }
}

/**
 * Crée un nouveau document Firestore après vérification stricte de l'authentification.
 */
export async function createDocument<T extends Record<string, unknown>>(
    collectionName: string,
    docId: string,
    data: T,
    options?: FirestoreCrudOptions,
): Promise<void> {
    const path = `${collectionName}/${docId}`;
    requireAuthenticatedUser(OperationType.CREATE, path, options);

    try {
        const ref = doc(db, collectionName, docId);
        await setDoc(ref, data);
    } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
    }
}

/**
 * Met à jour un document Firestore existant après vérification stricte de l'authentification.
 */
export async function updateDocument<T extends Record<string, unknown>>(
    collectionName: string,
    docId: string,
    data: T,
    options?: FirestoreCrudOptions,
): Promise<void> {
    const path = `${collectionName}/${docId}`;
    requireAuthenticatedUser(OperationType.UPDATE, path, options);

    try {
        const ref = doc(db, collectionName, docId);
        await updateDoc(ref, data);
    } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
    }
}

/**
 * Écrit ou fusionne un document Firestore après vérification stricte de l'authentification.
 */
async function setDocument<T extends Record<string, unknown>>(
    collectionName: string,
    docId: string,
    data: T,
    options?: FirestoreCrudOptions & { merge?: boolean },
): Promise<void> {
    const path = `${collectionName}/${docId}`;
    const opType = options?.merge ? OperationType.WRITE : OperationType.CREATE;
    requireAuthenticatedUser(opType, path, options);

    try {
        const ref = doc(db, collectionName, docId);
        if (options?.merge) {
            await setDoc(ref, data, { merge: true });
        } else {
            await setDoc(ref, data);
        }
    } catch (error) {
        handleFirestoreError(error, opType, path);
    }
}

/**
 * Supprime un document Firestore après vérification stricte de l'authentification.
 */
export async function deleteDocument(
    collectionName: string,
    docId: string,
    options?: FirestoreCrudOptions,
): Promise<void> {
    const path = `${collectionName}/${docId}`;
    requireAuthenticatedUser(OperationType.DELETE, path, options);

    try {
        const ref = doc(db, collectionName, docId);
        await deleteDoc(ref);
    } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
    }
}

/**
 * Liste les documents d'une collection Firestore après vérification stricte de l'authentification.
 */
async function listDocuments<T = DocumentData>(
    collectionName: string,
    constraints: QueryConstraint[] = [],
    options?: FirestoreCrudOptions,
): Promise<Array<{ id: string; data: T }>> {
    requireAuthenticatedUser(OperationType.LIST, collectionName, options);

    try {
        const colRef = collection(db, collectionName);
        const q = constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);
        const snap = await getDocs(q);
        return snap.docs.map((docSnap) => ({
            id: docSnap.id,
            data: docSnap.data() as T,
        }));
    } catch (error) {
        handleFirestoreError(error, OperationType.LIST, collectionName);
    }
}

/**
 * Abonne un écouteur temps réel (`onSnapshot`) sur un document Firestore après vérification
 * stricte de l'authentification.
 */
export function subscribeToDocument<T = DocumentData>(
    collectionName: string,
    docId: string,
    onNext: (result: FirestoreDocResult<T>) => void,
    onError?: (error: unknown) => void,
    options?: FirestoreCrudOptions,
): () => void {
    const path = `${collectionName}/${docId}`;
    requireAuthenticatedUser(OperationType.GET, path, options);

    const ref = doc(db, collectionName, docId);
    return onSnapshot(
        ref,
        (snapshot) => {
            onNext({
                id: snapshot.id,
                exists: snapshot.exists(),
                data: snapshot.exists() ? (snapshot.data() as T) : null,
            });
        },
        (error) => {
            if (onError) {
                onError(error);
            }
            try {
                handleFirestoreError(error, OperationType.GET, path);
            } catch {
                // Journalisé via handleFirestoreError tout en préservant le cycle de vie UI
            }
        },
    );
}

import {
    verifyFirestoreConnectionDiagnostic,
    validateFirebaseConfiguration,
} from './firestoreDiagnostics';

/**
 * Objet de service centralisé exposant la configuration, les instances Firebase et toutes les
 * opérations CRUD protégées par authentification.
 */
export const firestoreService = {
    config: firebaseConfig,
    app,
    db,
    auth,
    googleProvider,
    requireAuthenticatedUser,
    getDocument,
    createDocument,
    updateDocument,
    setDocument,
    deleteDocument,
    listDocuments,
    subscribeToDocument,
    testFirestoreConnection,
    verifyFirestoreConnectionDiagnostic,
    validateFirebaseConfiguration,
    handleFirestoreError,
};

export {
    verifyFirestoreConnectionDiagnostic,
    validateFirebaseConfiguration,
};
