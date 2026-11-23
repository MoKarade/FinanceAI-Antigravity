import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
    GoogleAuthProvider,
    onAuthStateChanged,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
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
    pullWorkspaceFromFirestoreNow,
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
import {
    needsBlockingIdbHydration,
    hydrateStoreFromIdbOnce,
    applyCachedFxRatesSyncIfNeeded,
} from '../../store/idbBootHydration';
import { isLocalMirrorCompacted } from '../../services/unlimitedStateStorage';
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
    initialSyncSettled: false,
};

const IDB_BOOT_MAX_WAIT_MS = 400;
const CLOUD_SYNC_BOOT_MAX_WAIT_MS = 2200;

function isBootSyncBypassed(isTestEnv: boolean, forceAuthGate: boolean): boolean {
    if (isTestEnv || forceAuthGate) return true;
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_AUDIT_HORS_RESEAU === '1') {
        return true;
    }
    try {
        if (
            typeof sessionStorage !== 'undefined' &&
            sessionStorage.getItem('financeai:offline_bypass') === '1'
        ) {
            return true;
        }
    } catch {
        /* sessionStorage inaccessible */
    }
    try {
        if (typeof window !== 'undefined' && window.location?.search) {
            const params = new URLSearchParams(window.location.search);
            if (params.has('nogate') || params.has('skipgate')) return true;
        }
    } catch {
        /* URL inaccessible */
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return true;
    }
    return false;
}

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
    const [idbReady, setIdbReady] = useState<boolean>(() => isTestEnv || !needsBlockingIdbHydration());
    const [syncBootTimedOut, setSyncBootTimedOut] = useState<boolean>(false);
    const bootSyncBypassed = isBootSyncBypassed(isTestEnv, forceAuthGate);

    useEffect(() => subscribeFirebaseSyncStatus(setSyncStatus), []);

    useEffect(() => {
        if (isTestEnv) return;
        applyCachedFxRatesSyncIfNeeded();
        if (!idbReady) {
            let cancelled = false;
            const done = () => {
                if (!cancelled) setIdbReady(true);
            };
            const timerId = setTimeout(done, IDB_BOOT_MAX_WAIT_MS);
            void hydrateStoreFromIdbOnce()
                .then(done)
                .catch(done)
                .finally(() => {
                    clearTimeout(timerId);
                });
            return () => {
                cancelled = true;
                clearTimeout(timerId);
            };
        }
        if (isLocalMirrorCompacted()) {
            void hydrateStoreFromIdbOnce();
        }
        return undefined;
    }, [isTestEnv, idbReady]);

    useEffect(() => {
        if (
            bootSyncBypassed ||
            syncBootTimedOut ||
            requireGateScreen ||
            !(!authReady || (user !== null && !syncStatus.initialSyncSettled))
        ) {
            return;
        }
        const timer = setTimeout(() => {
            setSyncBootTimedOut(true);
        }, CLOUD_SYNC_BOOT_MAX_WAIT_MS);
        return () => clearTimeout(timer);
    }, [bootSyncBypassed, syncBootTimedOut, requireGateScreen, authReady, user, syncStatus.initialSyncSettled]);

    useEffect(() => {
        if (isTestEnv) return;
        void testFirestoreConnection();

        if (typeof getRedirectResult === 'function') {
            void getRedirectResult(auth)
                .then((result) => {
                    if (result?.user) {
                        const oauthCred = GoogleAuthProvider.credentialFromResult(result);
                        if (oauthCred?.accessToken) {
                            cacheExternalGoogleToken(oauthCred.accessToken);
                        }
                        void pullWorkspaceFromFirestoreNow(result.user);
                    }
                })
                .catch(() => {
                    // Ignorer si aucun redirect en cours
                });
        }

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
                } else {
                    void recoverOrEnsureInitialWorkspace(false);
                    void chercherEtRestaurerDepuisGoogleDrive();
                    const bypassOffline =
                        typeof sessionStorage !== 'undefined' &&
                        sessionStorage.getItem('financeai:offline_bypass') === '1';
                    if (!bypassOffline) {
                        setRequireGateScreen(true);
                    }
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
        if (isTestEnv || !authReady || !user || !idbReady) return;

        void upsertUserProfile(user).catch(() => {
            // Déjà journalisé par handleFirestoreError
        });

        const stopSync = startWorkspaceRealtimeSync(user);
        return () => {
            stopSync();
        };
    }, [isTestEnv, authReady, user, idbReady]);

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
            }
            const firestoreRestored = await pullWorkspaceFromFirestoreNow(credential.user);
            if (firestoreRestored.restored) {
                showToast(
                    `Dossier Cloud Google synchronisé (${firestoreRestored.assetsCount} actifs · ${firestoreRestored.transactionsCount} transactions).`,
                    'success',
                );
                return;
            }
            if (oauthCred?.accessToken) {
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
                'Compte Google connecté · Synchronisation automatique PC & mobile active.',
                'success',
            );
        } catch (err: unknown) {
            const code = (err as { code?: string })?.code ?? '';
            if (
                (code === 'auth/popup-blocked' ||
                    code === 'auth/operation-not-supported-in-this-environment' ||
                    code === 'auth/cancelled-popup-request' ||
                    code === 'auth/web-storage-unsupported') &&
                typeof signInWithRedirect === 'function'
            ) {
                await signInWithRedirect(auth, googleProvider);
                return;
            }
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
            setSyncBootTimedOut(false);
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
        if (user) {
            const firestoreRestored = await pullWorkspaceFromFirestoreNow(user);
            if (firestoreRestored.restored) {
                showToast(
                    `Dossier Cloud Google restauré (${firestoreRestored.assetsCount} actifs · ${firestoreRestored.transactionsCount} transactions).`,
                    'success',
                );
                return;
            }
        }
        const driveRecovered = await chercherEtRestaurerDepuisGoogleDrive();
        if (driveRecovered?.restored) {
            if (user) {
                await pushWorkspaceToFirestore(user).catch(() => {});
            }
            showToast(`Dossier restauré depuis ${driveRecovered.sourceLabel}.`, 'success');
            return;
        }
        const result = await recoverOrEnsureInitialWorkspace(true);
        if (result === 'restored-idb' || result === 'restored-snapshot') {
            showToast('Vos données initiales ont été restaurées depuis votre archive.', 'success');
        } else {
            showToast('Votre dossier patrimonial initial a été restauré avec succès.', 'success');
        }
    }, [user]);

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

    const waitingForIdb = !isTestEnv && !idbReady;
    const waitingForCloudSync =
        !bootSyncBypassed &&
        !syncBootTimedOut &&
        !requireGateScreen &&
        (!authReady || (user !== null && !syncStatus.initialSyncSettled));
    const isBootHydrating = waitingForIdb || waitingForCloudSync;

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
                                <div>
                                    <p className="text-base font-bold text-ink-50 tracking-tight">
                                        Espace patrimonial sécurisé
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
                                        if (typeof sessionStorage !== 'undefined') {
                                            sessionStorage.setItem('financeai:offline_bypass', '1');
                                        }
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

    if (isBootHydrating) {
        return (
            <FirebaseAuthContext.Provider value={contextValue}>
                <main
                    data-testid="firebase-boot-hydrating"
                    role="status"
                    aria-busy="true"
                    aria-label="Chargement de votre patrimoine"
                    className="min-h-screen bg-fond text-ink-100 px-4 sm:px-8 py-8"
                >
                    <div className="max-w-[1440px] mx-auto rounded-2xl bg-surface border border-bordure p-6 sm:p-8 space-y-6">
                        <div className="flex items-center justify-between gap-4">
                            <div className="h-8 w-44 rounded-full skeleton-box" />
                            <div className="h-9 w-72 rounded-full skeleton-box hidden sm:block" />
                            <div className="h-8 w-32 rounded-full skeleton-box" />
                        </div>
                        <div className="space-y-3">
                            <div className="h-4 w-36 rounded-lg skeleton-box" />
                            <div className="h-11 w-64 rounded-xl skeleton-box" />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div className="h-20 rounded-xl border border-bordure bg-fond skeleton-box" />
                            <div className="h-20 rounded-xl border border-bordure bg-fond skeleton-box" />
                            <div className="h-20 rounded-xl border border-bordure bg-fond skeleton-box" />
                            <div className="h-20 rounded-xl border border-bordure bg-fond skeleton-box" />
                        </div>
                        <div className="h-[340px] sm:h-[400px] rounded-xl border border-bordure bg-fond skeleton-box" />
                        <p className="text-xs text-ink-400">Synchronisation de vos soldes…</p>
                    </div>
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
