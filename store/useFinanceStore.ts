import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Tab, type AppState } from '../types';
import { INITIAL_CHILD_GOAL } from '../constants';
import { unlimitedStateStorage } from '../services/unlimitedStateStorage';
import { saveLockedProjection, clearLockedProjection } from '../services/lockedProjectionStore';
import { logError } from '../services/errorLogger';
import { sanitizePersonaArtifacts } from '../services/personaSanitizer';
import { STORAGE_KEYS } from '../utils/storageKeys';
import { initialState } from './etatParDefaut';
import { migratePersistedState } from './migrationsPersistees';
import { fusionnerEtatPersiste, surRehydratation, extrairePersistable } from './optionsPersistance';
import { champsFxApres } from '../services/fx/ecritureFx';
import { brancherCoutIa } from '../services/aiChat/coutIa';
import type { FinanceState } from './types';
export type { FinanceState, PendingFocus, ProjectionStatus, GrandCalculStatus } from './types';


// [GODFILE-STORE] Ré-exports de compatibilité : les consommateurs (composants, services, tests)
// importent ces symboles depuis CE module depuis toujours — la façade les garde adressables.
export { getInitialStateWithMigration, getMigrationStatus } from './etatParDefaut';
export { migratePersistedState } from './migrationsPersistees';
export { getHydrationStatus } from './optionsPersistance';

export const useFinanceStore = create<FinanceState>()(
    persist(
        (set, get) => ({
            ...initialState,
            // L'application s'ouvre sur la page d'Accueil plein visuel style Google.
            activeTab: Tab.DASHBOARD,
            isPrivacyMode: false,
            lastProjection: null,
            projectionRunMC: true,
            projectionStatus: 'idle',
            projectionRefus: null,
            lockedProjection: null,
            isProjectionLocked: false,
            revealedProjectionSig: null,
            grandCalculResult: null,
            grandCalculStatus: 'idle',
            grandCalculProgress: null,
            grandCalculError: null,
            pendingFocus: null,

            // Navigation : on synchronise window.location.hash AVANT le set.
            // Sinon l'effet applyHash (App.tsx, deps [activeTab]) se relance au
            // changement d'activeTab, lit le hash resté périmé et revert vers
            // l'onglet courant → les boutons navigateWithFocus semblent « morts ».
            // Cf. BACKLOG G1 (2026-05-22).
            setActiveTab: (tab) => {
                if (typeof window !== 'undefined' && window.location.hash.replace('#', '') !== tab) {
                    window.location.hash = tab;
                }
                set({ activeTab: tab });
            },
            setPrivacyMode: (v) => set({ isPrivacyMode: v }),
            togglePrivacyMode: () => set((prev) => ({ isPrivacyMode: !prev.isPrivacyMode })),
            setAppState: (state) => set((prev) => ({ ...prev, ...state })),
            setLastProjection: (r) => set({ lastProjection: r }),
            setProjectionRunMC: (v) => set({ projectionRunMC: v }),
            setProjectionStatus: (s) => set({ projectionStatus: s }),
            setProjectionRefus: (m) => set({ projectionRefus: m }),
            // PH2-d — verrou : état sync (source de vérité = Zustand) + persistance IndexedDB best-effort.
            // Fire-and-forget VOULU : le set d'UI ne doit pas attendre une écriture disque, et une écriture
            // ratée n'invalide pas le verrou en mémoire (l'IDB n'est qu'un cache de RESTAURATION au reload).
            // Le module logue ses propres échecs et ne lève jamais.
            lockProjection: (r) => { set({ lockedProjection: r, isProjectionLocked: true }); void saveLockedProjection(r); },
            unlockProjection: () => { set({ lockedProjection: null, isProjectionLocked: false }); void clearLockedProjection(); },
            // Boot uniquement : pose le blob restauré depuis l'IDB (réconcilie le booléen persisté
            // avec le contenu réel — si l'IDB est vide/illisible, r=null → on retombe déverrouillé).
            setLockedProjection: (r) => set({ lockedProjection: r, isProjectionLocked: r !== null }),
            setRevealedProjectionSig: (sig) => set({ revealedProjectionSig: sig }),
            setGrandCalculResult: (r) => set({ grandCalculResult: r }),
            setGrandCalculStatus: (s) => set({ grandCalculStatus: s }),
            setGrandCalculProgress: (p) => set({ grandCalculProgress: p }),
            setGrandCalculError: (err) => set({ grandCalculError: err }),
            resetGrandCalcul: () => set({
                grandCalculResult: null,
                grandCalculStatus: 'idle',
                grandCalculProgress: null,
                grandCalculError: null,
            }),
            navigateWithFocus: (tab, section) => {
                if (typeof window !== 'undefined' && window.location.hash.replace('#', '') !== tab) {
                    window.location.hash = tab;
                }
                set({
                    activeTab: tab,
                    pendingFocus: { tab, section: section ?? null, expiresAt: Date.now() + 5000 },
                });
            },
            clearPendingFocus: () => set({ pendingFocus: null }),
            // [FX-SERVEUR-JAMAIS-RAFRAICHI] Le corps vit dans `services/fx/ecritureFx.ts`, source unique
            // partagée avec le rafraîchissement SERVEUR (qui ne peut pas importer le store).
            updateFxRates: (ecriture) => set((prev) => champsFxApres(prev, ecriture)),
            updateApiKeys: (keys) => set((prev) => {
                const next = { ...prev.apiKeys, ...keys };
                if (keys.gemini === undefined && typeof keys.anthropic === 'string' && !next.gemini) {
                    next.gemini = keys.anthropic;
                }
                return { apiKeys: next };
            }),
            updateLastUpdate: () => set({ lastUpdate: Date.now() }),
            resetState: () => set({
                ...initialState,
                grandCalculResult: null,
                grandCalculStatus: 'idle',
                grandCalculProgress: null,
                grandCalculError: null,
            }),

            // [PERSONA-PURGE] Self-heal au démarrage : purge par id déterministe
            // (registre personaArtifactIds) si des résidus legacy persistent.
            purgePersonaArtifacts: () => {
                const prev = get();
                const { state: cleaned, report } = sanitizePersonaArtifacts(prev as unknown as Partial<AppState>);
                if (report.removedTotal === 0) return 0;
                logError({
                    source: 'storage', severity: 'warning',
                    message: `purgePersonaArtifacts : ${report.removedTotal} artefact(s) de persona de test retirés des données réelles (${Object.entries(report.bySlice).map(([k, v]) => `${k}:${v}`).join(', ')})`,
                });
                const patch: Partial<FinanceState> = { lastUpdate: Date.now() };
                for (const slice of Object.keys(report.bySlice)) {
                    if (slice === 'childGoal') {
                        patch.childGoal = structuredClone(INITIAL_CHILD_GOAL);
                    } else {
                        (patch as Record<string, unknown>)[slice] = (cleaned as Record<string, unknown>)[slice];
                    }
                }
                set(patch);
                return report.removedTotal;
            },
        }),
        {
            name: STORAGE_KEYS.persistStore,
            storage: createJSONStorage(() => unlimitedStateStorage),
            // Schema versioning: incrémenter à chaque changement non-rétrocompatible
            // de la forme du state, et ajouter une étape dans `migrate`.
            // Sans version, toute évolution casse silencieusement le boot des
            // utilisateurs existants (cf audit 2026-05 §State management).
            // Le strip <7 (cf migrate) reste pour nettoyer les blobs de l'ère buggée (≤ v6).
            version: 7,
            migrate: migratePersistedState,
            // Les trois portes (fusion typée, filet d'échec, sélection des clés) vivent dans
            // `optionsPersistance.ts` — corps extraits tels quels au lot 158 ; la CONFIG
            // (name/version/storage/migrate) reste ICI, à côté du create().
            merge: fusionnerEtatPersiste,
            onRehydrateStorage: surRehydratation,
            partialize: extrairePersistable,
        }
    )
);

const TORONTO_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

// [COUT-IA-MESURE] Seul écrivain du cumul à vie + journalier du coût IA (FinanceAI#50) : chaque réponse payée,
// mesurée au point de contact SDK (`services/gemini.ts`), s'ajoute ici. Le bloc `usage` et Hubperso le lisent.
brancherCoutIa((coutUsd) => {
    const s = useFinanceStore.getState();
    const parts = TORONTO_DATE_FMT.formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    const todayKey = `${y}-${m}-${d}`;
    const prevByDay = s.aiChatCostUsdByDay ?? {};
    const nextByDay: Record<string, number> = {
        ...prevByDay,
        [todayKey]: Number(((prevByDay[todayKey] ?? 0) + coutUsd).toFixed(6)),
    };
    const keys = Object.keys(nextByDay).sort();
    if (keys.length > 400) {
        for (const k of keys.slice(0, keys.length - 400)) {
            delete nextByDay[k];
        }
    }
    s.setAppState({
        aiChatCostUsdTotal: (s.aiChatCostUsdTotal ?? 0) + coutUsd,
        aiChatCostUsdByDay: nextByDay,
    });
});
