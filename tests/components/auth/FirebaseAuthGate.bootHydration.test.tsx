/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { User as FirebaseUser } from 'firebase/auth';
import type { FirebaseWorkspaceSyncStatus } from '../../../services/firebase/workspaceSync';

const mocks = vi.hoisted(() => {
    let authCallback: ((user: FirebaseUser | null) => void) | null = null;
    let statusListeners = new Set<(status: FirebaseWorkspaceSyncStatus) => void>();
    let currentSyncStatus: FirebaseWorkspaceSyncStatus = {
        state: 'idle',
        lastSyncedAt: null,
        errorMessage: null,
        initialSyncSettled: false,
    };

    const emitAuth = (user: FirebaseUser | null) => {
        authState.currentUser = user;
        authCallback?.(user);
    };

    const emitSyncStatus = (partial: Partial<FirebaseWorkspaceSyncStatus>) => {
        currentSyncStatus = { ...currentSyncStatus, ...partial };
        for (const listener of statusListeners) {
            listener(currentSyncStatus);
        }
    };

    const reset = () => {
        authCallback = null;
        statusListeners = new Set();
        authState.currentUser = null;
        currentSyncStatus = {
            state: 'idle',
            lastSyncedAt: null,
            errorMessage: null,
            initialSyncSettled: false,
        };
    };

    const authState: { currentUser: FirebaseUser | null } = { currentUser: null };

    return {
        authState,
        setAuthCallback: (cb: ((user: FirebaseUser | null) => void) | null) => {
            authCallback = cb;
        },
        subscribeStatus: (cb: (status: FirebaseWorkspaceSyncStatus) => void) => {
            statusListeners.add(cb);
            cb(currentSyncStatus);
            return () => {
                statusListeners.delete(cb);
            };
        },
        getSyncStatus: () => currentSyncStatus,
        emitAuth,
        emitSyncStatus,
        reset,
    };
});

vi.mock('firebase/auth', () => {
    class MockGoogleAuthProvider {
        addScope() {}
        static credentialFromResult() {
            return null;
        }
    }
    return {
        GoogleAuthProvider: MockGoogleAuthProvider,
        onAuthStateChanged: (_auth: unknown, cb: (user: FirebaseUser | null) => void) => {
            mocks.setAuthCallback(cb);
            return () => {};
        },
        signInWithPopup: vi.fn(),
        signInWithRedirect: vi.fn(),
        getRedirectResult: vi.fn().mockResolvedValue(null),
        signOut: vi.fn().mockResolvedValue(undefined),
    };
});

vi.mock('../../../services/firebase/firebaseClient', () => ({
    app: {},
    db: {},
    auth: mocks.authState,
    googleProvider: {},
    testFirestoreConnection: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../services/firebase/workspaceSync', () => ({
    upsertUserProfile: vi.fn().mockResolvedValue(undefined),
    startWorkspaceRealtimeSync: vi.fn(() => {
        mocks.emitSyncStatus({ state: 'connecting', initialSyncSettled: false });
        return () => {
            mocks.emitSyncStatus({ state: 'idle', initialSyncSettled: false });
        };
    }),
    pushWorkspaceToFirestore: vi.fn().mockResolvedValue(undefined),
    pullWorkspaceFromFirestoreNow: vi.fn().mockResolvedValue({ restored: false, netWorth: 0, assetsCount: 0, transactionsCount: 0 }),
    recoverOrEnsureInitialWorkspace: vi.fn().mockResolvedValue('kept'),
    subscribeFirebaseSyncStatus: mocks.subscribeStatus,
    getFirebaseSyncStatus: mocks.getSyncStatus,
}));

vi.mock('../../../services/dataRecovery', () => ({
    ensureDefaultGoogleAuthConfigured: vi.fn(),
    chercherEtRestaurerDepuisGoogleDrive: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../store/idbBootHydration', () => ({
    needsBlockingIdbHydration: vi.fn(() => false),
    hydrateStoreFromIdbOnce: vi.fn().mockResolvedValue(undefined),
    applyCachedFxRatesSyncIfNeeded: vi.fn(),
}));

import { FirebaseAuthGate } from '../../../components/auth/FirebaseAuthGate';
import { useFinanceStore } from '../../../store/useFinanceStore';

describe('FirebaseAuthGate — attente propre de la synchronisation avant premier affichage', () => {
    beforeEach(() => {
        vi.stubEnv('MODE', 'production');
        sessionStorage.clear();
        localStorage.clear();
        mocks.reset();
        useFinanceStore.getState().resetState();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllEnvs();
        sessionStorage.clear();
        localStorage.clear();
    });

    it('n’affiche jamais un solde local périmé avant que Cloud Firestore soit synchronisé', () => {
        useFinanceStore.setState({
            initialBalances: { 'Chèque': 100_000 },
        });
        const observedSums: number[] = [];

        const SumReader: React.FC = () => {
            const bal = useFinanceStore((s) => s.initialBalances['Chèque'] ?? 0);
            observedSums.push(bal);
            return <div data-testid="rendered-sum">{bal}</div>;
        };

        render(
            <FirebaseAuthGate>
                <SumReader />
            </FirebaseAuthGate>,
        );

        // 1. Avant onAuthStateChanged : squelette affiché, enfant non monté
        expect(screen.getByTestId('firebase-boot-hydrating')).toBeInTheDocument();
        expect(screen.queryByTestId('rendered-sum')).toBeNull();
        expect(observedSums).toEqual([]);

        // 2. Utilisateur authentifié, mais initialSyncSettled toujours false : ne flashe PAS 100 000 $
        act(() => {
            mocks.emitAuth({ uid: 'user-fictif-1' } as FirebaseUser);
        });
        expect(screen.getByTestId('firebase-boot-hydrating')).toBeInTheDocument();
        expect(screen.queryByTestId('rendered-sum')).toBeNull();
        expect(observedSums).toEqual([]);

        // 3. Cloud Firestore applique 250 000 $ et passe initialSyncSettled à true
        act(() => {
            useFinanceStore.setState({ initialBalances: { 'Chèque': 250_000 } });
            mocks.emitSyncStatus({ state: 'synced', lastSyncedAt: Date.now(), initialSyncSettled: true });
        });

        expect(screen.queryByTestId('firebase-boot-hydrating')).toBeNull();
        expect(screen.getByTestId('rendered-sum')).toHaveTextContent('250000');
        expect(observedSums).toEqual([250_000]);
    });

    it('débloque l’application après 2 200 ms si Firestore ne répond pas (filet anti-blocage)', () => {
        vi.useFakeTimers();
        useFinanceStore.setState({ initialBalances: { 'Chèque': 125_000 } });

        render(
            <FirebaseAuthGate>
                <div data-testid="child-app">OK</div>
            </FirebaseAuthGate>,
        );

        expect(screen.getByTestId('firebase-boot-hydrating')).toBeInTheDocument();
        expect(screen.queryByTestId('child-app')).toBeNull();

        act(() => {
            vi.advanceTimersByTime(2200);
        });

        expect(screen.queryByTestId('firebase-boot-hydrating')).toBeNull();
        expect(screen.getByTestId('child-app')).toHaveTextContent('OK');
    });

    it('contourne l’attente Cloud immédiatement lorsque financeai:offline_bypass vaut 1', () => {
        sessionStorage.setItem('financeai:offline_bypass', '1');

        render(
            <FirebaseAuthGate>
                <div data-testid="child-app">Direct</div>
            </FirebaseAuthGate>,
        );

        expect(screen.queryByTestId('firebase-boot-hydrating')).toBeNull();
        expect(screen.getByTestId('child-app')).toHaveTextContent('Direct');
    });
});
