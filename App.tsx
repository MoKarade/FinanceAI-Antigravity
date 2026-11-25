import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { Layout } from './components/Layout';
import { recoverUser230kData, hasInflatedStarterProperty, saveProtectedDossierSnapshot } from './services/dataRecovery';
import { hasFirestoreSyncedThisSession } from './services/firebase/workspaceSync';
import { auth } from './services/firebase/firebaseClient';
import { scheduleIdleTabPrefetch } from './utils/tabPrefetch';
import { ToastContainer, showToast } from './components/ui/Toast';
import { PwaInstallBanner } from './components/PwaInstallBanner';
import { Tab, AppState } from './types';
import { INITIAL_CHILD_GOAL } from './constants';
import { useFinanceStore } from './store/useFinanceStore';
import { saveApiKeys } from './services/secureKeyStore';
import { useShallow } from 'zustand/shallow';
import { useDerivedFinancials } from './utils/useDerivedFinancials';
import { TabRouter } from './components/TabRouter';
import { useCommandPalette, makeNavigationActions, makeValoriaCommandActions } from './components/ui/commandPaletteActions';
import { useAppBootEffects } from './hooks/useAppBootEffects';
import { useTabNavigation } from './hooks/useTabNavigation';
import { useAssetDataHydration } from './hooks/useAssetDataHydration';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { useFirebaseAuth } from './components/auth/FirebaseAuthGate';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

const CommandPalette = lazyWithRetry(() => import('./components/ui/CommandPalette').then(m => ({ default: m.CommandPalette })), 'CommandPalette');
const ProjectionEngine = lazyWithRetry(() => import('./components/ProjectionEngine').then(m => ({ default: m.ProjectionEngine })), 'ProjectionEngine');

export const App: React.FC = () => {
    const state = useFinanceStore(useShallow(s => {
        const { lastProjection: _lp, projectionStatus: _ps, ...rest } = s;
        void _lp;
        void _ps;
        return rest;
    }));
    const setAppState = state.setAppState;
    const activeTab = state.activeTab;
    const setActiveTab = state.setActiveTab;
    const isPrivacyMode = state.isPrivacyMode;
    const togglePrivacyMode = state.togglePrivacyMode;

    const [isLoading] = useState(false);
    const isHydrated = useRef(false);

    useAppBootEffects();
    useTabNavigation(activeTab, setActiveTab);

    const handleSetTab = useCallback((tab: Tab) => {
        setActiveTab(tab);
    }, [setActiveTab]);

    const cmdK = useCommandPalette();
    const { authReady, user: firebaseUser, syncWorkspaceNow } = useFirebaseAuth();

    // Préchargement progressif de tous les onglets en tâche de fond après le premier rendu
    useEffect(() => scheduleIdleTabPrefetch(), []);

    const navigateWithFocus = state.navigateWithFocus;

    const cmdActions = useMemo(() => [
        ...makeNavigationActions(handleSetTab),
        ...makeValoriaCommandActions(navigateWithFocus, state.assets, state.valoriaWatchlist),
        {
            id: 'action:privacy',
            label: isPrivacyMode ? 'Désactiver le mode privé' : 'Activer le mode privé',
            group: 'Actions',
            icon: isPrivacyMode ? '👁️' : '🙈',
            keywords: ['privacy', 'masquer', 'cacher', 'discret'],
            onSelect: () => togglePrivacyMode(),
        },
        {
            id: 'action:sync',
            label: 'Synchroniser les données',
            group: 'Actions',
            icon: '🔄',
            keywords: ['sync', 'refresh', 'reload', 'sauvegarder', 'cloud', 'firestore'],
            onSelect: async () => {
                if (!firebaseUser) {
                    showToast("Connecte d'abord ton compte Google pour synchroniser sur Cloud Firestore.", 'info');
                    return;
                }
                await syncWorkspaceNow();
            },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [isPrivacyMode, handleSetTab, navigateWithFocus, state.assets, state.valoriaWatchlist, firebaseUser, syncWorkspaceNow]);

    useEffect(() => { isHydrated.current = true; }, []);

    const bootRecoveryRan = useRef(false);

    // Récupération automatique au démarrage si une sauvegarde locale existe,
    // sans injecter de données simulées en production (conformément à la règle No-fake-data).
    useEffect(() => {
        if (!authReady) return;
        const current = useFinanceStore.getState();
        if (!bootRecoveryRan.current) {
            if (hasFirestoreSyncedThisSession() || auth.currentUser || firebaseUser) {
                bootRecoveryRan.current = true;
                return;
            }
            if (hasInflatedStarterProperty(current)) {
                bootRecoveryRan.current = true;
                void recoverUser230kData(false);
                return;
            }
            if (typeof import.meta === 'undefined' || import.meta.env?.MODE !== 'test') {
                bootRecoveryRan.current = true;
                void recoverUser230kData(false);
            }
        }
    }, [authReady, firebaseUser]);

    // Bouclier zéro perte : chaque modification du dossier met à jour l'empreinte protégée.
    useEffect(() => {
        saveProtectedDossierSnapshot(state);
    }, [state, state.lastUpdate]);

    useEffect(() => {
        if (!state.childGoals || state.childGoals.length === 0) {
            if (state.childGoal) {
                setAppState({
                    childGoals: [{ ...state.childGoal, id: 'child_1', name: 'Enfant 1' }],
                    childGoal: undefined
                });
            } else {
                setAppState({
                    childGoals: [{ ...INITIAL_CHILD_GOAL, id: 'child_1', name: 'Enfant 1' }]
                });
            }
        }
    }, [state.childGoal, state.childGoals, setAppState]);

    useAssetDataHydration(state.assets, setAppState);

    const handleUpdateApiKeys = async (keys: AppState['apiKeys']) => {
        state.updateApiKeys(keys);
        try {
            await saveApiKeys(useFinanceStore.getState().apiKeys);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : '';
            showToast(
                msg
                    ? `Clés non sauvegardées (${msg}). Elles resteront valides jusqu'au rechargement.`
                    : "Clés non sauvegardées : coffre chiffré indisponible. Elles resteront valides jusqu'au rechargement.",
                'error'
            );
        }
    };

    const handleManualImport = async (rawData: string): Promise<void> => {
        const { importerReleveManuel } = await import('./components/app/importReleveManuel');
        return importerReleveManuel(rawData, {
            transactions: state.transactions,
            budgetItems: state.budgetItems,
            apiKeyAnthropic: state.apiKeys.gemini || state.apiKeys.anthropic,
            setAppState,
        });
    };

    const { globalNetWorth, avoirsHorsImmo, dettesHorsImmo, calculatedMonthlySavings, assetBreakdown, currentLiquidity } = useDerivedFinancials(state);

    return (
        <ErrorBoundary label="FinanceAI">
        <div>
            <Suspense fallback={null}>
                <ProjectionEngine calculatedMonthlySavings={calculatedMonthlySavings} />
            </Suspense>
            <Layout
                activeTab={activeTab}
                setActiveTab={handleSetTab}
                lastUpdate={state.lastUpdate}
                isLoading={isLoading}
                isPrivacyMode={isPrivacyMode}
                togglePrivacyMode={togglePrivacyMode}
                netWorth={globalNetWorth}
                monthlySavings={calculatedMonthlySavings}
                financialGoals={state.financialGoals}
                currentValues={{ celi: assetBreakdown.celi, reer: assetBreakdown.reer, liquidity: currentLiquidity }}
            >
                <TabRouter
                    activeTab={activeTab}
                    state={state}
                    setAppState={setAppState}
                    setActiveTab={handleSetTab}
                    isPrivacyMode={isPrivacyMode}
                    isLoading={isLoading}
                    globalNetWorth={globalNetWorth}
                    avoirsHorsImmo={avoirsHorsImmo}
                    dettesHorsImmo={dettesHorsImmo}
                    calculatedMonthlySavings={calculatedMonthlySavings}
                    assetBreakdown={assetBreakdown}
                    currentLiquidity={currentLiquidity}
                    onUpdateApiKeys={handleUpdateApiKeys}
                    onManualImport={handleManualImport}
                />
            </Layout>
            <ToastContainer />
            <PwaInstallBanner />
            {cmdK.isOpen && (
                <Suspense fallback={null}>
                    <CommandPalette open onClose={cmdK.close} actions={cmdActions} />
                </Suspense>
            )}
        </div>
        </ErrorBoundary>
    );
};
