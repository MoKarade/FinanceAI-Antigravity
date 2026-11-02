import { doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { app, db, auth } from './firebaseClient';
import { firestoreService } from './firestoreService';
import { logError } from '../errorLogger';

export interface FirebaseConfigValidationResult {
    valid: boolean;
    missingOrInvalidFields: string[];
    projectId: string;
    firestoreDatabaseId: string;
}

export interface FirestoreDiagnosticReport {
    ok: boolean;
    timestamp: string;
    projectId: string;
    firestoreDatabaseId: string;
    configValid: boolean;
    serviceAligned: boolean;
    authInitialized: boolean;
    currentUserUid: string | null;
    serverReachable: boolean;
    latencyMs: number;
    message: string;
    error?: string;
}

export interface VerifyFirestoreDiagnosticOptions {
    /** Sonde serveur injectable pour les tests unitaires déterministes */
    serverProbe?: () => Promise<void>;
    /** Configuration injectable pour tester les cas de configuration invalide */
    configOverride?: Partial<typeof firebaseConfig>;
}

const REQUIRED_CONFIG_KEYS: Array<keyof typeof firebaseConfig> = [
    'projectId',
    'appId',
    'apiKey',
    'authDomain',
    'firestoreDatabaseId',
];

/**
 * Vérifie que la configuration `firebase-applet-config.json` contient toutes les clés requises
 * et qu'aucune valeur n'est vide ou égale au marqueur de remix (`remixed-project-id`).
 */
export function validateFirebaseConfiguration(
    config: Partial<typeof firebaseConfig> = firebaseConfig,
): FirebaseConfigValidationResult {
    const missingOrInvalidFields: string[] = [];

    for (const key of REQUIRED_CONFIG_KEYS) {
        const val = config[key];
        if (typeof val !== 'string' || val.trim().length === 0 || val === 'remixed-project-id') {
            missingOrInvalidFields.push(key);
        }
    }

    return {
        valid: missingOrInvalidFields.length === 0,
        missingOrInvalidFields,
        projectId: typeof config.projectId === 'string' ? config.projectId : '',
        firestoreDatabaseId:
            typeof config.firestoreDatabaseId === 'string' ? config.firestoreDatabaseId : '',
    };
}

/**
 * Indique si une erreur renvoyée par `getDocFromServer` prouve néanmoins que le serveur
 * Cloud Firestore a bien été joint (ex. `permission-denied` renvoyé par `firestore.rules`
 * sur le document sonde `/test/connection`).
 */
function isServerRespondedPermissionDenied(error: unknown): boolean {
    if (!error) return false;
    const code = (error as { code?: string }).code ?? '';
    const message = error instanceof Error ? error.message : String(error);
    return (
        code === 'permission-denied' ||
        message.includes('permission-denied') ||
        message.includes('Missing or insufficient permissions')
    );
}

/**
 * Utilitaire de diagnostic vérifiant la liaison entre le service Firestore centralisé
 * (`firestoreService`), la configuration Firebase (`firebase-applet-config.json`) et la
 * connectivité avec le serveur Cloud Firestore, en journalisant le résultat dans la console.
 */
export async function verifyFirestoreConnectionDiagnostic(
    options?: VerifyFirestoreDiagnosticOptions,
): Promise<FirestoreDiagnosticReport> {
    const startedAt = Date.now();
    const targetConfig = options?.configOverride ?? firestoreService.config ?? firebaseConfig;
    const configCheck = validateFirebaseConfiguration(targetConfig);

    const appOptions = firestoreService.app?.options ?? app.options;
    const serviceAligned =
        configCheck.valid &&
        firestoreService.db === db &&
        firestoreService.auth === auth &&
        appOptions.projectId === targetConfig.projectId &&
        appOptions.appId === targetConfig.appId;

    const authInitialized = Boolean(firestoreService.auth);
    const currentUserUid = firestoreService.auth?.currentUser?.uid ?? null;

    if (!configCheck.valid || !serviceAligned) {
        const latencyMs = Math.max(0, Date.now() - startedAt);
        const reason = !configCheck.valid
            ? `Champs Firebase manquants ou invalides : ${configCheck.missingOrInvalidFields.join(', ')}`
            : 'Désalignement entre firestoreService et firebase-applet-config.json.';
        const errorMessage = `[FirestoreDiagnostic] Échec de vérification de la configuration Firebase (${reason}). Please check your Firebase configuration.`;

        console.error(errorMessage, {
            projectId: configCheck.projectId,
            firestoreDatabaseId: configCheck.firestoreDatabaseId,
            missingOrInvalidFields: configCheck.missingOrInvalidFields,
            serviceAligned,
        });
        logError({
            source: 'network',
            severity: 'error',
            message: errorMessage,
            context: {
                projectId: configCheck.projectId,
                firestoreDatabaseId: configCheck.firestoreDatabaseId,
                serviceAligned,
            },
        });

        return {
            ok: false,
            timestamp: new Date().toISOString(),
            projectId: configCheck.projectId,
            firestoreDatabaseId: configCheck.firestoreDatabaseId,
            configValid: configCheck.valid,
            serviceAligned,
            authInitialized,
            currentUserUid,
            serverReachable: false,
            latencyMs,
            message: errorMessage,
            error: reason,
        };
    }

    const probe =
        options?.serverProbe ??
        (async () => {
            await getDocFromServer(doc(firestoreService.db, 'test', 'connection'));
        });

    try {
        await probe();
    } catch (error) {
        if (!isServerRespondedPermissionDenied(error)) {
            const latencyMs = Math.max(0, Date.now() - startedAt);
            const rawError = error instanceof Error ? error.message : String(error);
            const offlineHint = rawError.includes('the client is offline')
                ? ' Please check your Firebase configuration.'
                : '';
            const errorMessage = `[FirestoreDiagnostic] Échec de connexion au serveur Cloud Firestore (${configCheck.projectId} / ${configCheck.firestoreDatabaseId}) : ${rawError}.${offlineHint}`;

            console.error(errorMessage, {
                projectId: configCheck.projectId,
                firestoreDatabaseId: configCheck.firestoreDatabaseId,
                latencyMs,
                error: rawError,
            });
            logError({
                source: 'network',
                severity: 'error',
                message: errorMessage,
                context: {
                    projectId: configCheck.projectId,
                    firestoreDatabaseId: configCheck.firestoreDatabaseId,
                    latencyMs,
                },
            });

            return {
                ok: false,
                timestamp: new Date().toISOString(),
                projectId: configCheck.projectId,
                firestoreDatabaseId: configCheck.firestoreDatabaseId,
                configValid: true,
                serviceAligned: true,
                authInitialized,
                currentUserUid,
                serverReachable: false,
                latencyMs,
                message: errorMessage,
                error: rawError,
            };
        }
    }

    const latencyMs = Math.max(0, Date.now() - startedAt);
    const successMessage = `[FirestoreDiagnostic] Connexion vérifiée avec succès entre firestoreService et Cloud Firestore (projet : ${configCheck.projectId}, base : ${configCheck.firestoreDatabaseId}, latence : ${latencyMs} ms).`;

    // eslint-disable-next-line no-console
    console.info(successMessage, {
        projectId: configCheck.projectId,
        firestoreDatabaseId: configCheck.firestoreDatabaseId,
        authInitialized,
        currentUserUid,
        latencyMs,
    });
    logError({
        source: 'network',
        severity: 'info',
        message: successMessage,
        context: {
            projectId: configCheck.projectId,
            firestoreDatabaseId: configCheck.firestoreDatabaseId,
            authInitialized,
            latencyMs,
        },
    });

    return {
        ok: true,
        timestamp: new Date().toISOString(),
        projectId: configCheck.projectId,
        firestoreDatabaseId: configCheck.firestoreDatabaseId,
        configValid: true,
        serviceAligned: true,
        authInitialized,
        currentUserUid,
        serverReachable: true,
        latencyMs,
        message: successMessage,
    };
}
