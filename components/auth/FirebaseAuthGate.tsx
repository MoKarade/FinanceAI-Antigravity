import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signOut,
    type User as FirebaseUser,
} from 'firebase/auth';
import {
    auth,
    googleProvider,
    testFirestoreConnection,
} from '../../services/firebase/firebaseClient';
import {
    upsertUserProfile,
    startWorkspaceRealtimeSync,
    pushWorkspaceToFirestore,
    recoverOrEnsureInitialWorkspace,
    subscribeFirebaseSyncStatus,
    getFirebaseSyncStatus,
    type FirebaseWorkspaceSyncStatus,
} from '../../services/firebase/workspaceSync';
import { cacheExternalGoogleToken } from '../../services/googleDrive/gisAuth';
import {
    ensureDefaultGoogleAuthConfigured,
    chercherEtRestaurerDepuisGoogleDrive,
} from '../../services/dataRecovery';
import { setStatus as setDriveSyncStatus } from '../../services/sync/syncStatusStore';
import { setGateAuthedThisSession } from '../../services/sync/authGate';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/Toast';

interface FirebaseAuthContextValue {
    user: FirebaseUser | null;
    authReady: boolean;
    syncStatus: FirebaseWorkspaceSyncStatus;
    authError: string | null;
    isSigningIn: boolean;
    signInWithGoogle: () => Promise<void>;
    signOutUser: () => Promise<void>;
    syncWorkspaceNow: () => Promise<void>;
    restoreInitialDataNow: () => Promise<void>;
}

const DEFAULT_SYNC_STATUS: FirebaseWorkspaceSyncStatus = {
    state: 'idle',
    lastSyncedAt: null,
    errorMessage: null,
};

const FirebaseAuthContext = createContext<FirebaseAuthContextValue>({
    user: null,
    authReady: false,
    syncStatus: DEFAULT_SYNC_STATUS,
    authError: null,
    isSigningIn: false,
    signInWithGoogle: async () => {},
    signOutUser: async () => {},
    syncWorkspaceNow: async () => {},
    restoreInitialDataNow: async () => {},
});

export function useFirebaseAuth(): FirebaseAuthContextValue {
    return useContext(FirebaseAuthContext);
}

interface FirebaseAuthGateProps {
    children: React.ReactNode;
    /** Force l'affichage du portail d'authentification même en environnement de test unitaire. */
    forceAuthGate?: boolean;
}

/**
 * Portail d'authentification Firebase et orchestrateur de la synchronisation temps réel
 * Cloud Firestore (`/workspaces/{uid}`) + Google Drive.
 */
export const FirebaseAuthGate: React.FC<FirebaseAuthGateProps> = ({
    children,
    forceAuthGate = false,
}) => {
    const isTestEnv =
        !forceAuthGate &&
        typeof import.meta !== 'undefined' &&
        import.meta.env?.MODE === 'test';

    const [user, setUser] = useState<FirebaseUser | null>(() => auth.currentUser);
    const [authReady, setAuthReady] = useState<boolean>(isTestEnv || forceAuthGate);
    const [isSigningIn, setIsSigningIn] = useState<boolean>(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [syncStatus, setSyncStatus] = useState<FirebaseWorkspaceSyncStatus>(getFirebaseSyncStatus);
    const [requireGateScreen, setRequireGateScreen] = useState<boolean>(forceAuthGate);

    useEffect(() => subscribeFirebaseSyncStatus(setSyncStatus), []);

    useEffect(() => {
        if (isTestEnv) return;
        void recoverOrEnsureInitialWorkspace(false);
        void chercherEtRestaurerDepuisGoogleDrive();
        void testFirestoreConnection();

        const unsubscribeAuth = onAuthStateChanged(
            auth,
            (nextUser) => {
                setUser(nextUser);
                if (nextUser) {
                    setRequireGateScreen(false);
                    setGateAuthedThisSession();
                    setDriveSyncStatus({
                        connected: true,
                        email: nextUser.email ?? null,
                        resumeSettled: true,
                        error: null,
                    });
                }
                setAuthReady(true);
                setAuthError(null);
            },
            (err) => {
                setAuthError(
                    err instanceof Error
                        ? err.message
                        : 'Impossible de vérifier la session Firebase.',
                );
                setAuthReady(true);
            },
        );

        return () => {
            unsubscribeAuth();
        };
    }, [isTestEnv]);

    useEffect(() => {
        if (isTestEnv || !authReady || !user) return;

        void upsertUserProfile(user).catch(() => {
            // Déjà journalisé par handleFirestoreError
        });

        const stopSync = startWorkspaceRealtimeSync(user);
        return () => {
            stopSync();
        };
    }, [isTestEnv, authReady, user]);

    const signInWithGoogle = useCallback(async () => {
        setIsSigningIn(true);
        setAuthError(null);
        try {
            ensureDefaultGoogleAuthConfigured();
            const credential = await signInWithPopup(auth, googleProvider);
            const oauthCred = GoogleAuthProvider.credentialFromResult(credential);
            setUser(credential.user);
            setRequireGateScreen(false);
            setGateAuthedThisSession();
            setDriveSyncStatus({
                connected: true,
                email: credential.user.email ?? null,
                resumeSettled: true,
                error: null,
            });
            if (oauthCred?.accessToken) {
                cacheExternalGoogleToken(oauthCred.accessToken);
                const driveRecovered = await chercherEtRestaurerDepuisGoogleDrive();
                if (driveRecovered?.restored) {
                    await pushWorkspaceToFirestore(credential.user);
                    showToast(
                        `Dossier retrouvé (${driveRecovered.sourceLabel}) et synchronisé.`,
                        'success',
                    );
                    return;
                }
            }
            showToast(
                'Compte Google connecté de façon permanente · Cloud Firestore synchronisé.',
                'success',
            );
        } catch (err: unknown) {
            const msg =
                err instanceof Error
                    ? err.message
                    : 'La connexion Google a été interrompue ou bloquée.';
            setAuthError(msg);
        } finally {
            setIsSigningIn(false);
        }
    }, []);

    const signOutUser = useCallback(async () => {
        try {
            await signOut(auth);
            setUser(null);
            setRequireGateScreen(true);
            showToast('Session Google déconnectée.', 'info');
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Échec de la déconnexion.';
            setAuthError(msg);
        }
    }, []);

    const syncWorkspaceNow = useCallback(async () => {
        if (!user) return;
        try {
            await pushWorkspaceToFirestore(user);
            showToast('Dossier synchronisé dans Cloud Firestore.', 'success');
        } catch {
            showToast('Échec de la synchronisation Cloud.', 'error');
        }
    }, [user]);

    const restoreInitialDataNow = useCallback(async () => {
        const result = await recoverOrEnsureInitialWorkspace(true);
        if (result === 'restored-idb' || result === 'restored-snapshot') {
            showToast('Vos données initiales ont été restaurées depuis votre archive locale.', 'success');
        } else {
            showToast('Votre dossier patrimonial initial a été restauré avec succès.', 'success');
        }
    }, []);

    const contextValue: FirebaseAuthContextValue = {
        user,
        authReady,
        syncStatus,
        authError,
        isSigningIn,
        signInWithGoogle,
        signOutUser,
        syncWorkspaceNow,
        restoreInitialDataNow,
    };

    if (isTestEnv) {
        return (
            <FirebaseAuthContext.Provider value={contextValue}>
                {children}
            </FirebaseAuthContext.Provider>
        );
    }

    if (!user && requireGateScreen) {
        return (
            <FirebaseAuthContext.Provider value={contextValue}>
                <main
                    data-testid="firebase-auth-gate"
                    className="min-h-screen bg-fond text-ink-100 flex items-center justify-center px-4 py-12"
                >
                    <section
                        aria-labelledby="firebase-auth-title"
                        className="w-full max-w-lg rounded-3xl bg-surface border border-bordure p-6 sm:p-10 space-y-6"
                    >
                        <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-3">
                                <img
                                    src="/icon.svg"
                                    alt=""
                                    width={36}
                                    height={36}
                                    className="w-9 h-9 rounded-xl shrink-0"
                                    aria-hidden="true"
                                />
                                <div>
                                    <p className="text-base font-bold text-ink-50 tracking-tight">
                                        FinanceAI
                                    </p>
                                    <p className="text-xs text-ink-400">
                                        Firebase Authentication · Cloud Firestore
                                    </p>
                                </div>
                            </div>
                            <span
                                className="inline-flex items-center gap-1.5"
                                aria-hidden="true"
                            >
                                <span className="w-2.5 h-2.5 rounded-full bg-repere" />
                                <span className="w-2.5 h-2.5 rounded-full bg-erreur-texte" />
                                <span className="w-2.5 h-2.5 rounded-full bg-alerte-texte" />
                                <span className="w-2.5 h-2.5 rounded-full bg-succes-texte" />
                            </span>
                        </div>

                        <div className="space-y-2">
                            <h1
                                id="firebase-auth-title"
                                className="text-2xl sm:text-3xl font-bold text-ink-50 tracking-tight"
                            >
                                Connectez votre dossier patrimonial
                            </h1>
                            <p className="text-sm text-ink-300 leading-relaxed">
                                Identifiez-vous avec votre compte Google pour accéder à votre tableau
                                de bord et synchroniser automatiquement l’ensemble de votre patrimoine
                                en temps réel sur Cloud Firestore.
                            </p>
                        </div>

                        <div className="rounded-2xl bg-fond border border-bordure p-4 space-y-2.5 text-xs text-ink-300">
                            <div className="flex items-start gap-2.5">
                                <Icon
                                    name="cloud"
                                    size={15}
                                    className="text-repere shrink-0 mt-0.5"
                                    aria-hidden="true"
                                />
                                <p>
                                    <strong className="font-semibold text-ink-100">
                                        Synchronisation temps réel
                                    </strong>{' '}
                                    · Vos comptes, budgets, placements, dettes et projections sont
                                    sauvegardés instantanément sous votre identifiant unique.
                                </p>
                            </div>
                            <div className="flex items-start gap-2.5">
                                <Icon
                                    name="lock"
                                    size={15}
                                    className="text-succes-texte shrink-0 mt-0.5"
                                    aria-hidden="true"
                                />
                                <p>
                                    <strong className="font-semibold text-ink-100">
                                        Isolation Zero-Trust &amp; clés locales
                                    </strong>{' '}
                                    · Vos données sont protégées par les règles de sécurité Firestore et
                                    vos clés API restent exclusivement sur votre appareil.
                                </p>
                            </div>
                        </div>

                        {authError && (
                            <div
                                role="alert"
                                className="rounded-2xl bg-erreur-fond border border-bordure px-4 py-3 text-xs text-erreur-texte"
                            >
                                {authError}
                            </div>
                        )}

                        <div className="space-y-2.5">
                            <button
                                type="button"
                                onClick={() => void signInWithGoogle()}
                                disabled={isSigningIn}
                                className="touch-target w-full py-3 px-5 rounded-full bg-repere-fond text-repere border border-bordure-lien font-semibold text-sm flex items-center justify-center gap-2.5 hover:opacity-90 transition-opacity focus-ring disabled:opacity-50"
                            >
                                <Icon name="users" size={16} aria-hidden="true" />
                                <span>
                                    {isSigningIn
                                        ? 'Connexion Google en cours…'
                                        : 'Continuer avec Google'}
                                </span>
                            </button>

                            {!forceAuthGate && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        void recoverOrEnsureInitialWorkspace(false);
                                        setRequireGateScreen(false);
                                    }}
                                    className="touch-target w-full py-2.5 px-5 rounded-full bg-fond border border-bordure text-xs font-semibold text-ink-300 hover:text-ink-50 hover:bg-surface-douce transition-colors focus-ring"
                                >
                                    Accéder directement à mon dossier local
                                </button>
                            )}
                        </div>
                    </section>
                </main>
            </FirebaseAuthContext.Provider>
        );
    }

    return (
        <FirebaseAuthContext.Provider value={contextValue}>
            {children}
        </FirebaseAuthContext.Provider>
    );
};
