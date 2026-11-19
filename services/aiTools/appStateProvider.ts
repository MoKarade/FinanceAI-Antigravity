// services/aiTools/appStateProvider.ts
//
// [AITOOLS-B] Fournisseur d'état du chat in-app : un AppState PLAT (données seulement) dérivé du
// store Zustand vivant. Deux impératifs :
//  1. ÉCARTER les actions/fonctions du store (FinanceState étend AppState avec des méthodes) —
//     un handler qui clone l'état (structuredClone dans simulate_what_if) planterait sinon
//     (« could not be cloned », vu au test de parité) ;
//  2. passer par la MÊME `normalizeAppState` que le serveur MCP → parité « mêmes réponses que
//     claude.ai » par CONSTRUCTION (vérifiée par tests/aiTools/registryParity.test.ts).
// Le pick des clés vient de `buildDefaultAppState()` (la liste canonique des champs de données) —
// jamais de liste maintenue à la main (drift garanti sinon).

import type { AppState, Tab } from '../../types';
import { buildDefaultAppState, normalizeAppState } from '../../mcp/state/appStateDefaults';
import { validateAppStateShape } from '../../mcp/state/appStateSchema';
import { useFinanceStore } from '../../store/useFinanceStore';
import { extrairePersistable } from '../../store/optionsPersistance';
import { modeDonneesFictives } from '../../store/modeTestActif';

/**
 * Snapshot PLAT, VALIDÉ et CLONÉ de l'état courant. Trois protections (findings panel 2026-07-21) :
 *  - `apiKeys` EXCLU : aucun tool n'en a besoin — les vraies clés (Gemini/Finnhub) ne doivent
 *    jamais entrer dans un état que des handlers pourraient sérialiser vers un tool_result (même
 *    principe que l'Omit<'apiKeys'> de realDataSnapshot côté store) ;
 *  - `validateAppStateShape` AVANT normalisation : la MÊME étape que le chemin MCP (loadAppState) —
 *    un champ `null` corrompu doit LEVER une erreur claire, jamais être masqué en « absence
 *    légitime » par les `??` des handlers (chiffres à zéro plausibles sans trace) ;
 *  - `structuredClone` à la frontière : les handlers reçoivent une COPIE — même une mutation
 *    in-place accidentelle d'un handler futur ne peut pas toucher le vrai store (« aucune donnée
 *    changée » garanti structurellement ; coût mesuré ~1 ms sur ~700 tx, une fois par envoi).
 */
export function snapshotAppState(): AppState {
    // [SVC-STORE-COUPLING] Lecture TYPÉE : `FinanceState extends AppState`, donc `store[key]` avec
    // `key: keyof AppState` est vérifié par tsc (une clé fantôme casserait ici). Seule l'ÉCRITURE
    // garde son cast (limitation des types corrélés de TS sur `Partial<T>[K] = T[K]`).
    const store = useFinanceStore.getState();
    const dataOnly: Partial<AppState> = {};
    for (const key of Object.keys(buildDefaultAppState()) as Array<keyof AppState>) {
        if (key === 'apiKeys') continue; // jamais les vraies clés dans le snapshot (défaut vide via normalize)
        const value = store[key];
        if (value !== undefined) (dataOnly as Record<string, unknown>)[key] = value;
    }
    validateAppStateShape(dataOnly); // throw clair sur état corrompu — journalisé par l'appelant
    return normalizeAppState(structuredClone(dataOnly));
}

/** StateProvider (contrat des specs) — capturé UNE fois par appel (snapshot cohérent). */
export const appStateProvider = async (): Promise<AppState> => snapshotAppState();

/**
 * [ASSISTANT-AGENT] Façade ÉTROITE du store pour l'assistant agentique (`services/assistant/`).
 * Pourquoi ici : ce module est déjà inscrit à l'inventaire fermé des services qui lisent le store
 * (`tests/services/storeCouplingBoundary.test.ts`) — l'assistant passe par lui plutôt que d'ajouter
 * un nouvel importeur. Mêmes impératifs que le snapshot : `apiKeys` n'est JAMAIS lu ni écrit ici.
 */
export const facadeStoreAssistant = {
    /** Copie profonde d'une tranche du store vivant (`undefined` si absente). */
    lire(cle: keyof AppState): unknown {
        if (cle === 'apiKeys') return undefined;
        const valeur: unknown = useFinanceStore.getState()[cle];
        return valeur === undefined ? undefined : structuredClone(valeur);
    },
    /** Données persistées (forme du blob local), sans fonctions ni clés API. */
    persistables(): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(extrairePersistable(useFinanceStore.getState()))) {
            if (typeof v !== 'function') out[k] = v;
        }
        return out;
    },
    /** Écrit des tranches (jamais `apiKeys`) avec un `lastUpdate` frais. */
    ecrire(patch: Partial<AppState>): void {
        const { apiKeys: _ak, ...sur } = patch;
        void _ak;
        useFinanceStore.getState().setAppState({ ...sur, lastUpdate: Date.now() });
    },
    ouvrirOnglet(onglet: Tab): void {
        useFinanceStore.getState().setActiveTab(onglet);
    },
    activerMonteCarlo(actif: boolean): void {
        useFinanceStore.getState().setProjectionRunMC(actif);
    },
    /** Source unique du futur (`lastProjection.chartData`) et statut du moteur. */
    etatProjection(): { statut: string; refus: string | null; chartData: unknown[] | null } {
        const s = useFinanceStore.getState();
        const chart = s.lastProjection?.chartData;
        return { statut: s.projectionStatus, refus: s.projectionRefus ?? null, chartData: Array.isArray(chart) ? chart : null };
    },
    tauxChange(): { taux: unknown; source: string | null; estime: boolean | null } {
        const s = useFinanceStore.getState();
        return { taux: structuredClone(s.fxRates), source: s.fxRatesSource ?? null, estime: s.fxRatesEstimated ?? null };
    },
    donneesFictives(): boolean {
        return modeDonneesFictives();
    },
    porteeTest(): { isTestMode: boolean; personaId: string | null } {
        const s = useFinanceStore.getState();
        return {
            isTestMode: Boolean(s.isTestMode),
            personaId: s.isTestMode ? s.activeTestPersonaId : null,
        };
    },
    async lancerComitePlacement(
        etat: AppState,
        question: string,
        montantCibleCad?: number,
        signal?: AbortSignal,
    ) {
        const s = useFinanceStore.getState();
        if (s.isPrivacyMode) {
            const { MESSAGE_IA_MODE_DISCRET } = await import('../messageErreurIa');
            throw new Error(MESSAGE_IA_MODE_DISCRET);
        }
        const { cleGemini } = await import('../geminiAssistant');
        const { runMultiAgentCommittee } = await import('../investments/multiAgentCommittee');
        return runMultiAgentCommittee({
            question,
            state: etat,
            apiKey: cleGemini(s),
            isPrivacyMode: s.isPrivacyMode,
            isTestMode: Boolean(s.isTestMode),
            targetAmountCad: montantCibleCad,
            signal,
        });
    },
};
