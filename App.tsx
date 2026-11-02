import React, { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { Layout } from './components/Layout';
import { hasMeaningfulData } from './utils/onboarding';
import { buildStarterState } from './utils/starterData';
import { recoverUser230kData, hasInflatedStarterProperty, saveProtectedDossierSnapshot } from './services/dataRecovery';
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
import { useCommandPalette, makeNavigationActions } from './components/ui/commandPaletteActions';
import { useAppBootEffects } from './hooks/useAppBootEffects';
import { useTabNavigation } from './hooks/useTabNavigation';
import { useAssetDataHydration } from './hooks/useAssetDataHydration';
import { lazyWithRetry } from './utils/lazyWithRetry';
import { pushNow, subscribeSyncStatus, getSyncStatus, hasConnectedBefore, type SyncStatus } from './services/sync/syncOrchestrator';
import { PassphraseGate } from './components/auth/PassphraseGate';
import { SyncStatusBanner } from './components/sync/SyncStatusBanner';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { STORAGE_KEYS } from './utils/storageKeys';
import NavApps from './components/NavApps';

const CommandPalette = lazyWithRetry(() => import('./components/ui/CommandPalette').then(m => ({ default: m.CommandPalette })), 'CommandPalette');
const SyncConflictModal = lazyWithRetry(() => import('./components/sync/SyncConflictModal').then(m => ({ default: m.SyncConflictModal })), 'SyncConflictModal');
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

    const handleSetTab = (tab: Tab) => {
        setActiveTab(tab);
        window.location.hash = tab;
    };

    const cmdK = useCommandPalette();

    // Préchargement progressif de tous les onglets en tâche de fond après le premier rendu
    useEffect(() => scheduleIdleTabPrefetch(), []);

    const cmdActions = useMemo(() => [
        ...makeNavigationActions(handleSetTab),
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
            keywords: ['sync', 'refresh', 'reload', 'sauvegarder', 'drive'],
            onSelect: async () => {
                const result = await pushNow();
                if (result === 'pushed') showToast('Données synchronisées vers Google Drive.', 'success');
                else if (result === 'not-configured') showToast("Connecte d'abord Google Drive (Réglages → Sauvegarde).", 'info');
                else if (result === 'skipped-empty') showToast('Rien à synchroniser : aucune donnée sur cet appareil.', 'info');
                else if (result === 'skipped-testmode') showToast('Mode test actif — synchronisation désactivée.', 'info');
                else if (result === 'error') showToast('Échec de la synchronisation (voir Réglages → Système).', 'error');
            },
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [isPrivacyMode, handleSetTab]);

    const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus);
    useEffect(() => subscribeSyncStatus(setSyncStatus), []);

    useEffect(() => { isHydrated.current = true; }, []);

    const bootRecoveryRan = useRef(false);

    // Démarrage instantané sans assistant d'introduction ni blocage : si le dossier local est vierge
    // et qu'aucune synchronisation Drive n'est active, on initialise un dossier patrimonial complet.
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEYS.onboardingDone, 'true');
        } catch { /* ignore */ }

        const current = useFinanceStore.getState();
        if (!bootRecoveryRan.current) {
            if (hasInflatedStarterProperty(current) || current.realDataSnapshot) {
                bootRecoveryRan.current = true;
                void recoverUser230kData(false);
                return;
            }
            if (typeof import.meta === 'undefined' || import.meta.env?.MODE !== 'test') {
                bootRecoveryRan.current = true;
                void recoverUser230kData(false);
            }
        }

        if (syncStatus.connected || syncStatus.busy || syncStatus.needsPassphrase || hasConnectedBefore()) {
            return;
        }
        if (!hasMeaningfulData(useFinanceStore.getState())) {
            setAppState(buildStarterState());
        }
    }, [syncStatus.connected, syncStatus.busy, syncStatus.needsPassphrase, setAppState]);

    // Bouclier zéro perte : chaque modification du dossier réel (hors mode test) met à jour l'empreinte protégée.
    useEffect(() => {
        if (state.isTestMode) return;
        saveProtectedDossierSnapshot(state);
    }, [state, state.isTestMode, state.lastUpdate]);

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
            apiKeyAnthropic: state.apiKeys.anthropic,
            setAppState,
        });
    };

    const { globalNetWorth, avoirsHorsImmo, dettesHorsImmo, ecartCourtier, calculatedMonthlySavings, assetBreakdown, currentLiquidity } = useDerivedFinancials(state);

    if (syncStatus.needsPassphrase) {
        return <PassphraseGate status={syncStatus} />;
    }

    return (
        <ErrorBoundary label="FinanceAI">
        <div>
            <SyncStatusBanner />
            <Suspense fallback={null}>
                <ProjectionEngine calculatedMonthlySavings={calculatedMonthlySavings} />
            </Suspense>
            <NavApps courant="financeai" />
            <Layout
                activeTab={activeTab}
                setActiveTab={handleSetTab}
                lastUpdate={state.lastUpdate}
                isLoading={isLoading}
                isPrivacyMode={isPrivacyMode}
                togglePrivacyMode={togglePrivacyMode}
                netWorth={globalNetWorth}
                onGeneratePDF={() => void import('./components/app/exportPdfEcran').then(({ genererRapportPdfEcran }) => genererRapportPdfEcran({
                    state, globalNetWorth, dettesHorsImmo, ecartCourtier, calculatedMonthlySavings, assetBreakdown, currentLiquidity,
                }))}
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
            {syncStatus.conflict && (
                <Suspense fallback={null}>
                    <SyncConflictModal />
                </Suspense>
            )}
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
