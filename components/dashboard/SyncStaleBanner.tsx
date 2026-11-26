// components/dashboard/SyncStaleBanner.tsx
//
// [FINTABLE-STALE-ALERT] Bannière « import bancaire gelé » sur l'Accueil.
//
// Née d'un incident RÉEL : l'import était figé depuis plusieurs jours et rien ne le
// disait — la seule surface qui portait l'information (la carte Fintable des Réglages) est un
// écran qu'on ne visite JAMAIS quand tout va bien. Une alerte doit se trouver là où l'utilisateur
// regarde par défaut, sinon elle n'existe pas.
//
// ⚠️ Le statut vient de `computeSyncHealth` — la MÊME fonction que le connecteur MCP. Deux
// implémentations divergeraient (leçon MCP-NETINCOME-MISLEADING, même journée) et l'app finirait
// par dire « à jour » pendant que le connecteur dit « gelé ».

import React, { useEffect, useMemo, useState } from 'react';
import { useFinanceStore } from '../../store/useFinanceStore';
import { computeSyncHealth } from '../../services/fintable/syncHealth';
import {
    getFirebaseSyncStatus,
    resolveSyncConflict,
    subscribeFirebaseSyncStatus,
    type FirebaseWorkspaceSyncStatus,
} from '../../services/firebase/workspaceSync';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/Toast';
import { Tab } from '../../types';

/** Le mode démo est EXCLU : les données de persona sont figées par nature, crier au gel n'aurait
 *  aucun sens et entraînerait l'utilisateur à ignorer la bannière quand elle sera vraie. */
export const SyncStaleBanner: React.FC = () => {
    const transactions = useFinanceStore((s) => s.transactions);
    const report = useFinanceStore((s) => s.fintableSyncReport);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);
    const [syncStatus, setSyncStatus] = useState<FirebaseWorkspaceSyncStatus>(() => getFirebaseSyncStatus());
    const [resolvingConflict, setResolvingConflict] = useState(false);

    useEffect(() => subscribeFirebaseSyncStatus(setSyncStatus), []);

    // `Date.now()` capturé au rendu : la fraîcheur n'a pas besoin d'être réactive à la seconde,
    // et un timer ferait re-rendre l'Accueil en permanence pour un gain nul.
    const health = useMemo(
        () => computeSyncHealth(transactions, report, Date.now()),
        [transactions, report],
    );

    // `never` est SILENCIEUX : un utilisateur qui n'a jamais branché l'import n'a pas de problème
    // à signaler — l'onboarding s'en charge. On alerte sur une CHUTE, pas sur une absence.
    const isProdEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE !== 'test';
    const silent = isProdEnv || health.status === 'ok' || health.status === 'never';
    const isError = health.status === 'error';
    const conflict = syncStatus.conflictAlert ?? null;

    const handleConflictChoice = async (choice: 'keep_remote' | 'restore_local_backup') => {
        setResolvingConflict(true);
        try {
            const ok = await resolveSyncConflict(choice);
            if (ok) {
                showToast(
                    choice === 'restore_local_backup'
                        ? 'Tes saisies locales ont été restaurées et synchronisées.'
                        : 'La version Cloud a été conservée.',
                    'success',
                );
            }
        } finally {
            setResolvingConflict(false);
        }
    };

    // ⚠️ Région live montée en PERMANENCE, seul le CONTENU change (CONVENTIONS.md, revue #245,
    // WCAG 4.1.3) : une région insérée AVEC son texte n'est pas annoncée de façon fiable par les
    // lecteurs d'écran — l'alerte serait muette précisément au moment où elle compte. Le premier
    // jet faisait `return null` et violait cette règle pourtant maison (panel #561) ;
    // `ProjectionStaleBanner`, sur la MÊME page, appliquait déjà le bon patron.
    return (
        <>
            <div role="alert" aria-label="Conflit de synchronisation hors ligne">
                {conflict && (
                    <div className="flex flex-col gap-2 rounded-card border border-alerte-texte/40 bg-alerte-fond p-3.5 mb-4 text-alerte-texte">
                        <div className="flex items-start gap-2.5">
                            <Icon name="alert" size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                            <div className="min-w-0 space-y-1">
                                <p className="text-body font-semibold text-texte">
                                    Conflit hors ligne détecté entre deux appareils
                                </p>
                                <p className="text-meta leading-snug text-texte-doux">
                                    La version plus récente de ton autre appareil a été appliquée. Une sauvegarde automatique de tes saisies locales a été conservée.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 pl-7">
                            <button
                                type="button"
                                disabled={resolvingConflict}
                                onClick={() => void handleConflictChoice('restore_local_backup')}
                                className="touch-target min-h-11 px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-xs font-semibold transition-colors focus-ring disabled:opacity-50"
                            >
                                Restaurer mes saisies locales
                            </button>
                            <button
                                type="button"
                                disabled={resolvingConflict}
                                onClick={() => void handleConflictChoice('keep_remote')}
                                className="touch-target min-h-11 px-3.5 py-2 rounded-xl border border-bordure bg-fond hover:bg-surface text-texte text-xs font-semibold transition-colors focus-ring disabled:opacity-50"
                            >
                                Garder la version Cloud
                            </button>
                        </div>
                    </div>
                )}
            </div>
            <div role="alert" aria-label="Fraîcheur de l'import bancaire">
            {!silent && (
                <div
                    // `mb-4` sur le CONTENU (pas la région live, toujours montée) : l'espace
                    // n'existe que quand l'alerte parle — l'hôte (Futur) n'a pas de `space-y`.
                    className={`flex items-start gap-3 rounded-card border p-3 mb-4 ${isError
                        ? 'text-danger-400 bg-danger-500/10 border-danger-500/20'
                        : 'text-warning-400 bg-warning-500/10 border-warning-500/20'}`}
                >
                    <Icon name="alert" size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0 space-y-1">
                        <p className="text-body font-semibold">
                            {isError ? 'Synchronisation bancaire en échec' : 'Import bancaire figé'}
                        </p>
                        {/* `reason` nomme déjà la cause probable (abonnement, ré-autorisation) : on ne
                            la reformule pas ici, sinon les deux textes divergeraient au prochain
                            changement. */}
                        <p className="text-meta leading-snug">{health.reason}</p>
                        <button
                            type="button"
                            onClick={() => navigateWithFocus(Tab.SETTINGS, 'fintable-sync')}
                            // `min-h-[44px]` (cible tactile) : forme utilisée ailleurs dans le repo —
                            // `min-h-touch` n'existe PAS dans tailwind.config.js (no-op silencieux).
                            className="inline-flex items-center min-h-[44px] text-meta underline underline-offset-2 hover:no-underline focus-ring"
                        >
                            Ouvrir les réglages de synchronisation →
                        </button>
                    </div>
                </div>
            )}
            </div>
        </>
    );
};
