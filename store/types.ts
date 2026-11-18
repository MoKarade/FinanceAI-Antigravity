// store/types.ts
// Types partagés du store Zustand pour éviter les imports circulaires
// entre useFinanceStore.ts et ses sous-modules (actionsModeTest, migrationsPersistees, optionsPersistance).

import type { AppState, Tab } from '../types';
import type { GrandCalculResult, ProjectionResult } from '../services/projection/types';
import type { GrandCalculProgress } from '../services/projection/runAsync';
import type { EcritureFx } from '../services/fx/ecritureFx';

export interface PendingFocus {
    tab: Tab;
    section: string | null;
    expiresAt: number;
}

export type ProjectionStatus = 'idle' | 'computing' | 'error';

export type GrandCalculStatus = 'idle' | 'restoring' | 'running' | 'ready' | 'cancelled' | 'error';

export interface FinanceState extends AppState {
    activeTab: Tab;
    isPrivacyMode: boolean;
    lastProjection: ProjectionResult | null;
    projectionRunMC: boolean;
    projectionStatus: ProjectionStatus;
    projectionRefus: string | null;
    lockedProjection: ProjectionResult | null;
    isProjectionLocked: boolean;
    revealedProjectionSig: string | null;
    grandCalculResult: GrandCalculResult | null;
    grandCalculStatus: GrandCalculStatus;
    grandCalculProgress: GrandCalculProgress | null;
    grandCalculError: string | null;
    pendingFocus: PendingFocus | null;
    isTestMode: boolean;
    realDataSnapshot: Partial<Omit<AppState, 'apiKeys'>> | null;
    activeTestPersonaId: string | null;
    setActiveTab: (tab: Tab) => void;
    setPrivacyMode: (v: boolean) => void;
    togglePrivacyMode: () => void;
    setAppState: (state: Partial<AppState>) => void;
    setLastProjection: (r: ProjectionResult | null) => void;
    setProjectionRunMC: (v: boolean) => void;
    setProjectionStatus: (s: ProjectionStatus) => void;
    setProjectionRefus: (m: string | null) => void;
    lockProjection: (r: ProjectionResult) => void;
    unlockProjection: () => void;
    setLockedProjection: (r: ProjectionResult | null) => void;
    setRevealedProjectionSig: (sig: string | null) => void;
    setGrandCalculResult: (r: GrandCalculResult | null) => void;
    setGrandCalculStatus: (s: GrandCalculStatus) => void;
    setGrandCalculProgress: (p: GrandCalculProgress | null) => void;
    setGrandCalculError: (err: string | null) => void;
    resetGrandCalcul: () => void;
    navigateWithFocus: (tab: Tab, section?: string) => void;
    clearPendingFocus: () => void;
    updateFxRates: (rates: EcritureFx) => void;
    updateApiKeys: (keys: { gemini?: string; anthropic?: string; finnhub?: string; fintable?: string }) => void;
    updateLastUpdate: () => void;
    resetState: () => void;
    enableTestMode: (fixtures: Partial<AppState>, personaId?: string | null) => void;
    disableTestMode: () => void;
    purgePersonaArtifacts: () => number;
}
