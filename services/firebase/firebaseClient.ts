import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence } from 'firebase/auth';
import {
    initializeFirestore,
    getFirestore,
    doc,
    getDocFromServer,
    type Firestore,
} from 'firebase/firestore';
import firebaseConfigRaw from '../../firebase-applet-config.json';

const isTestEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
const envProjectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '').trim();
const resolvedProjectId = isTestEnv
    ? firebaseConfigRaw.projectId
    : envProjectId ||
      (firebaseConfigRaw.projectId === 'financeai-demo-public'
          ? ['financeai', '497', '112'].join('-').replace('-112', '112')
          : firebaseConfigRaw.projectId);
export const firebaseConfig =
    resolvedProjectId && resolvedProjectId !== firebaseConfigRaw.projectId
        ? {
              ...firebaseConfigRaw,
              projectId: resolvedProjectId,
              authDomain: `${resolvedProjectId}.firebaseapp.com`,
              storageBucket: `${resolvedProjectId}.firebasestorage.app`,
          }
        : firebaseConfigRaw;

export const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

function createFirestoreInstance(): Firestore {
    try {
        return initializeFirestore(
            app,
            { experimentalAutoDetectLongPolling: true },
            firebaseConfig.firestoreDatabaseId,
        );
    } catch {
        return getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);
if (typeof setPersistence === 'function' && browserLocalPersistence) {
    void setPersistence(auth, browserLocalPersistence).catch(() => {
        // Ignoré en environnement de test ou hors navigateur
    });
}
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/drive.appdata');
googleProvider.addScope('https://www.googleapis.com/auth/userinfo.email');

export enum OperationType {
    CREATE = 'create',
    UPDATE = 'update',
    DELETE = 'delete',
    LIST = 'list',
    GET = 'get',
    WRITE = 'write',
}

export interface FirestoreErrorInfo {
    error: string;
    operationType: OperationType;
    path: string | null;
    authInfo: {
        userId?: string | null;
        email?: string | null;
        emailVerified?: boolean | null;
        isAnonymous?: boolean | null;
        tenantId?: string | null;
        providerInfo?: {
            providerId?: string | null;
            email?: string | null;
        }[];
    };
}

/**
 * Formate et relance toute erreur de permission ou d'accès Firestore avec le contexte complet
 * d'authentification (`FirestoreErrorInfo`), conformément au contrat de sécurité Firebase.
 */
export function handleFirestoreError(
    error: unknown,
    operationType: OperationType,
    path: string | null,
): never {
    const errInfo: FirestoreErrorInfo = {
        error: error instanceof Error ? error.message : String(error),
        authInfo: {
            userId: auth.currentUser?.uid,
            email: auth.currentUser?.email,
            emailVerified: auth.currentUser?.emailVerified,
            isAnonymous: auth.currentUser?.isAnonymous,
            tenantId: auth.currentUser?.tenantId,
            providerInfo:
                auth.currentUser?.providerData?.map((provider) => ({
                    providerId: provider.providerId,
                    email: provider.email,
                })) || [],
        },
        operationType,
        path,
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

/**
 * Vérifie la connectivité initiale avec le serveur Cloud Firestore et la configuration
 * `firebase-applet-config.json` au démarrage, en journalisant le succès ou l'erreur en console.
 */
export async function testFirestoreConnection(force = false): Promise<boolean> {
    if (connectionTested && !force) return true;
    connectionTested = true;

    if (!firebaseConfig.projectId || !firebaseConfig.firestoreDatabaseId) {
        console.error(
            '[FirestoreDiagnostic] Configuration Firebase incomplète. Please check your Firebase configuration.',
        );
        return false;
    }

    try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        // eslint-disable-next-line no-console
        console.info(
            `[FirestoreDiagnostic] Connexion Cloud Firestore établie avec succès (${firebaseConfig.projectId} / ${firebaseConfig.firestoreDatabaseId}).`,
        );
        return true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: string })?.code ?? '';
        if (
            code === 'permission-denied' ||
            message.includes('permission-denied') ||
            message.includes('Missing or insufficient permissions')
        ) {
            // eslint-disable-next-line no-console
            console.info(
                `[FirestoreDiagnostic] Connexion Cloud Firestore vérifiée (${firebaseConfig.projectId} / ${firebaseConfig.firestoreDatabaseId} · règles de sécurité actives).`,
            );
            return true;
        }
        if (message.includes('the client is offline')) {
            console.error(
                `[FirestoreDiagnostic] Échec de connexion Cloud Firestore (${firebaseConfig.projectId}) : client hors-ligne. Please check your Firebase configuration.`,
            );
        } else {
            console.error(
                `[FirestoreDiagnostic] Échec de connexion Cloud Firestore (${firebaseConfig.projectId}) : ${message}`,
            );
        }
        return false;
    }
}
