// hooks/useAppBootEffects.ts
//
// [GODFILE-APP] Effets de DÉMARRAGE de l'app, extraits tels quels d'App.tsx (le composant était une
// god-function de 910 lignes). Rien ne change au comportement : mêmes effets, mêmes dépendances,
// même ORDRE relatif — et l'ordre qui compte est documenté sur place (le provider marketData se
// configure AVANT tout consommateur ; ce hook est appelé avant useAssetDataHydration dans App).
// Aucun paramètre : tout se lit du store (sélecteurs identiques à ceux qu'App employait).

import { useEffect, useRef } from 'react';
import { showToast } from '../components/ui/Toast';
import { useFinanceStore, getMigrationStatus, getHydrationStatus } from '../store/useFinanceStore';
import { hydrateStoreFromIdbOnce } from '../store/idbBootHydration';
import { loadApiKeysDetailed, saveApiKeys } from '../services/secureKeyStore';
// [PERF-MARKETDATA-DYNIMPORT-INERTE] JAMAIS d'import statique de valeurs depuis
// services/marketData ici : ce hook est tiré par le chunk d'ENTRÉE (App), et un seul import
// statique annule la frontière asynchrone du module entier (~67 Ko). Tout passe par la promesse
// mémoïsée de lazy.ts, qui préserve aussi l'ordre configure→quote (voir son en-tête).
import { loadMarketData } from '../services/marketData/lazy';
import { installGlobalErrorHandlers, logError } from '../services/errorLogger';
import { hydrateProtectedDossierCacheFromIdb } from '../services/dataRecovery';
import { initAutoBackup, createBackupNow } from '../services/backupAuto';
import { sanitizePersonaArtifacts } from '../services/personaSanitizer';
import { loadLockedProjection } from '../services/lockedProjectionStore';
import { maybeRunDailyFintableSync } from '../services/fintable/autoSync';
import { fetchFxRates } from '../services/finance';
import { apresPremierAffichage } from '../utils/apresPremierAffichage';
import { requestPersistentStorage } from '../services/storagePersistence';
import { ecritureFxSelonLecture } from '../services/fx/ecritureFx';
import { surveillerSessionAccess } from '../utils/sessionAccess';
import { computeBudgetSyncPatch } from '../services/budgetAutoSync';
import { useTodayIsoLocal } from './useTodayIsoLocal';

/** Tous les effets de boot d'App : handlers d'erreur, courbe verrouillée, service worker, purge
 *  persona, filets migration/hydratation, provider marché, clés API chiffrées,
 *  sync bancaire auto, taux FX. Appelé UNE fois, en tête d'App. */
export function useAppBootEffects(): void {
    // P1 — installation des handlers d'erreur globaux au boot (une seule fois)
    const errorHandlersInstalled = useRef(false);
    useEffect(() => {
        if (errorHandlersInstalled.current) return;
        errorHandlersInstalled.current = true;
        installGlobalErrorHandlers();
        // PH2-d — restaure la courbe VERROUILLÉE depuis IndexedDB si un verrou était actif au dernier
        // reload (le booléen isProjectionLocked est persisté, le gros blob non → relu de l'IDB ici).
        // PH2-d-1 — 'empty' (rien/erreur d'accès) → silence ; 'unreadable' (entrée présente mais clé
        // disparue) → on AVERTIT l'utilisateur (jumeau de decrypt_failed des clés API).
        if (useFinanceStore.getState().isProjectionLocked) {
            // [PERF-BUNDLE] import STATIQUE : lockedProjectionStore est déjà dans le chunk de BOOT (importé
            // statiquement par le store) → le dynamic import ne créait aucun chunk séparé (INEFFECTIVE_DYNAMIC_IMPORT).
            loadLockedProjection()
                .then((res) => {
                    if (res.status === 'ok') {
                        useFinanceStore.getState().setLockedProjection(res.result);
                    } else {
                        useFinanceStore.getState().setLockedProjection(null);
                        if (res.status === 'unreadable') {
                            showToast('Ta courbe verrouillée n\'a pas pu être restaurée (clé de chiffrement introuvable) et a été retirée.', 'info');
                        }
                    }
                })
                .catch(() => { /* module/IDB HS : on reste déverrouillé en mémoire */ });
        }
        // PH1-a (revue) : le clear du flag « chunk reload attempted » au mount a été RETIRÉ —
        // il tournait AVANT la résolution des chunks lazy du boot et neutralisait la garde
        // anti-boucle (échec persistant ⇒ reload infini). La garde est désormais un timestamp
        // auto-expirant dans utils/lazyWithRetry (au plus 1 reload auto/min, aucun clear requis).
        // P1.3 — auto-backup quotidien dans IndexedDB (silent fail si indispo).
        // Léger debounce (2s) pour ne pas bloquer le 1er paint.
        // ARCHIVE : refusée si l'app tourne sur des données fictives (mode test / bac à sable).
        // Le prédicat est lu DANS le timer, pas à la pose : 2 s séparent les deux, et le mode
        // peut avoir basculé entre-temps.
        const timer = setTimeout(() => { initAutoBackup(false); }, 2000);

        // P2.9 — service worker en PROD seulement (Vite HMR en dev s'auto-gère).
        // Bug fix 2026-05-21 : ce useEffect tourne souvent APRÈS window.load
        // (mount React arrive après l'event), donc addEventListener('load') ne
        // déclenchait jamais le callback → SW jamais registered, cache vide.
        // Fix : register direct si le DOM est déjà loaded, sinon on attend l'event.
        if (import.meta.env.PROD && 'serviceWorker' in navigator) {
            const registerSW = () => {
                navigator.serviceWorker
                    .register('/sw.js', { updateViaCache: 'none' })
                    .then((reg) => {
                        void reg.update();
                    })
                    .catch((err) => {
                        // log explicite plutôt qu'un silent catch — utile en cas
                        // de régression future (anti-pattern silent-failure-hunter).
                        console.error('[SW] registration failed:', err);
                    });
            };
            if (document.readyState === 'complete') {
                registerSW();
            } else {
                window.addEventListener('load', registerSW, { once: true });
            }
        }

        // [CF-ACCESS] Session Cloudflare Access expirée (302 vers la page de connexion) → recharger pour se reconnecter.
        // Activé uniquement si explicitement requis par VITE_CF_ACCESS (évite tout rechargement intempestif au retour d'onglet sur Firebase Hosting).
        const stopSessionAccess = Boolean(import.meta.env.VITE_CF_ACCESS) ? surveillerSessionAccess() : () => {};

        // [PERSONA-PURGE] Self-heal AVANT l'init sync : si des artefacts de persona de test ont
        // fui dans les données réelles (incident 2026-07-15 : ~600 transactions « Karim » chez
        // Marc), on les retire par id déterministe — l'état guéri est ensuite persisté et poussé
        // vers Drive par le cycle normal. No-op en mode test et sur état propre.
        // Détection À SEC d'abord ; pollution détectée → backup IndexedDB de l'état PRÉ-purge
        // (finding panel sécurité : symétrie avec applyPulledPayload — toute mutation automatique
        // des vraies données a son filet), PUIS purge. Best-effort : backup HS ≠ rester pollué.
        void (async () => {
            const st = useFinanceStore.getState();
            const { report } = sanitizePersonaArtifacts(st as unknown as Parameters<typeof sanitizePersonaArtifacts>[0]);
            if (report.removedTotal === 0) return;
            try {
                // Depuis [BACKUP-PROMISE-CATCH], createBackupNow journalise EN INTERNE ses échecs
                // IndexedDB (rejet async tx.onerror → null) ; ici on trace juste que le filet est absent.
                const backup = await createBackupNow('auto', { intent: 'filet', donneesFictives: false });
                if (!backup.ok) {
                    logError({ source: 'storage', severity: 'warning', message: 'purgePersonaArtifacts : backup pré-purge indisponible (null) — purge SANS filet' });
                }
            } catch (e) {
                // Erreur SYNCHRONE en amont du backup (payload/crypto de chiffrement) — la purge procède
                // quand même (chirurgicale, ids déterministes), mais « filet absent » doit être visible.
                logError({ source: 'storage', severity: 'warning', message: 'purgePersonaArtifacts : backup pré-purge échoué (amont) — purge SANS filet', error: e instanceof Error ? e : new Error(String(e)) });
            }
            const purged = useFinanceStore.getState().purgePersonaArtifacts();
            if (purged > 0) {
                showToast(`${purged} donnée(s) de test (persona) retirée(s) de tes vraies données (backup pris avant).`, 'info');
            }
        })();

        // [STORAGE-PERSIST-REQUEST] Persistance du stockage : demandée UNE fois au boot, best-effort
        // (jamais de throw), état lisible dans Réglages › Système & diagnostics. Sans elle, le coffre
        // chiffré (IndexedDB + localStorage) est « best-effort » et évictable sous pression disque.
        void requestPersistentStorage();

        // Stockage illimité : réhydrate l'état complet depuis IndexedDB si le miroir localStorage
        // a été compacté, et charge l'empreinte protégée hors localStorage.
        void hydrateStoreFromIdbOnce();
        void hydrateProtectedDossierCacheFromIdb().catch(() => {});

        return () => {
            clearTimeout(timer);
            stopSessionAccess();
        };
    }, []);

    // Deux refs SÉPARÉS (finding panel silent-failure, lot audit 2026-07-17) : un ref partagé
    // ferait avaler le toast d'hydratation quand migration legacy ET réhydratation échouent
    // ENSEMBLE (localStorage inaccessible : les deux chemins tombent en même temps) — le pire
    // scénario perdrait précisément son avertissement « NE RIEN SAISIR ».
    const migrationWarningShown = useRef(false);
    const hydrationWarningShown = useRef(false);
    useEffect(() => {
        const status = getMigrationStatus();
        if (status.failed && !migrationWarningShown.current) {
            migrationWarningShown.current = true;
            const backupHint = status.backupKey
                ? `Backup sauvegarde sous la cle ${status.backupKey} (F12 -> Application -> Local Storage).`
                : 'Aucun backup recuperable.';
            showToast(
                `[CRITIQUE] Etat corrompu detecte au demarrage. ${backupHint} Vos donnees actuelles sont vides ou par defaut.`,
                'error'
            );
            console.error('[FinanceAI] Migration failure:', status);
        }
        // [STORE-REHYDRATE-SILENT, audit 2026-07-16] Chemin DISTINCT : la réhydratation ZUSTAND
        // (financeai-storage) a échoué → l'app affiche l'état par défaut alors que les données existent
        // encore (blob intact + Drive + backups). Avant ce filet : app vierge SANS AUCUN message →
        // risque de sur-réaction destructrice (re-onboarding par-dessus, pull écrasant).
        const hydration = getHydrationStatus();
        if (hydration.failed && !hydrationWarningShown.current) {
            hydrationWarningShown.current = true;
            showToast(
                '[CRITIQUE] Tes données n\'ont PAS pu être chargées (sauvegarde locale illisible). NE RIEN SAISIR : tes données existent encore — restaure un backup (Réglages → Sauvegarde) ou reconnecte ton compte Google (Cloud Firestore).',
                'error'
            );
            console.error('[FinanceAI] Hydration failure:', hydration);
        }
    }, []);

    // §7.F.5 — Configure le provider marketData (Finnhub) quand la clé change.
    // Async depuis le lot 133 (module paresseux) : l'ordre avec les cotations est préservé par la
    // promesse PARTAGÉE de loadMarketData — cet effet l'attend en premier (ce hook est appelé avant
    // tout consommateur dans App), ses continuations passent donc avant celles des quotes (FIFO).
    const finnhubKey = useFinanceStore((s) => s.apiKeys.finnhub);
    useEffect(() => {
        void loadMarketData().then((md) => md.configureMarketDataProvider({ finnhubKey }));
    }, [finnhubKey]);

    // Hydratation des clés API depuis le coffre chiffré (au boot, une fois).
    // C5 les avait rendues mémoire-seulement → elles disparaissaient à chaque
    // rechargement. Désormais : on les recharge tout seul au démarrage (donc
    // dès que le gate Google in-app t'a laissé charger l'app). Quand la clé est
    // posée dans le store, les effets réactifs (Finnhub, ci-dessus) partent
    // automatiquement. Best-effort : si le coffre est indisponible (vieux
    // navigateur, pas de Web Crypto), on ne casse pas le boot.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const result = await loadApiKeysDetailed();
                if (cancelled) return;
                if (result.status === 'decrypt_failed') {
                    // Blob chiffré présent mais clé IDB absente (ex: navigation privée
                    // entre sessions, IndexedDB vidé) → on prévient l'utilisateur.
                    showToast(
                        'Clés API non restaurées — la clé de chiffrement est introuvable. Re-saisissez vos clés dans Paramètres.',
                        'error'
                    );
                    return;
                }
                // ⚠️ [Finding silent-failure #545, ÉLEVÉ] `fintable` et `gemini` DOIVENT compter dans la garde :
                // un coffre qui ne contient QUE le jeton Fintable ou la clé Gemini (ni Anthropic ni Finnhub) n'était
                // JAMAIS restauré dans le store → jeton/clé perdu à chaque reload, sync auto ou assistant neutralisé
                // en silence (reason 'no-token' en boucle, zéro trace).
                if (result.status === 'ok' && (result.keys.gemini || result.keys.anthropic || result.keys.finnhub || result.keys.fintable)) {
                    useFinanceStore.getState().updateApiKeys(result.keys);
                    return;
                }
                // Migration : clés legacy encore lues en clair au boot (avant C5)
                // mais pas encore dans le coffre → on les chiffre maintenant.
                const current = useFinanceStore.getState().apiKeys;
                if (current.gemini || current.anthropic || current.finnhub || current.fintable) {
                    await saveApiKeys(current);
                }
            } catch (e) {
                // Règle « ne jamais avaler les erreurs » : un échec d'hydratation des clés (l'IA et
                // les cours d'actions ne fonctionneront pas) doit être visible dans les diagnostics.
                logError({ source: 'storage', severity: 'error', message: 'Hydratation des clés API chiffrées impossible', error: e });
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // [FINTABLE-7 + AUTO-CONTINUE] Sync bancaire AUTOMATIQUE à l'ouverture, toutes les 15 min,
    // au retour sur l'onglet (`focus` / `visibilitychange` / `online`) et dès que les rôles changent.
    const fintableToken = useFinanceStore((s) => s.apiKeys?.fintable ?? '');
    const fintableRoles = useFinanceStore((s) => s.fintableRoles);
    const initialBootReportChecked = useRef(false);
    const prevRolesRef = useRef(fintableRoles);
    useEffect(() => {
        if (!fintableToken) return;
        let cancelled = false;
        const FINTABLE_AUTO_MAX_AGE_MS = 15 * 60_000;
        const FINTABLE_AUTO_INTERVAL_MS = 15 * 60_000;
        const FINTABLE_AUTO_COOLDOWN_MS = 2 * 60_000;

        const triggerAutoSync = async (forceImmediate = false) => {
            if (cancelled) return;
            const prevReport = useFinanceStore.getState().fintableSyncReport;
            const needsInitialCatchup = !initialBootReportChecked.current && (
                (prevReport?.skippedBeforeCutover ?? 0) > 0 ||
                (prevReport?.accountsWithoutRole ?? 0) > 0 ||
                (prevReport?.warnings ?? []).some((w) => w.includes('retard de postage'))
            );
            initialBootReportChecked.current = true;
            const outcome = await maybeRunDailyFintableSync({
                maxAgeMs: forceImmediate || needsInitialCatchup ? 0 : FINTABLE_AUTO_MAX_AGE_MS,
                attemptCooldownMs: FINTABLE_AUTO_COOLDOWN_MS,
                ignoreCooldown: forceImmediate,
                autoCreditCards: true,
            });
            if (cancelled || !outcome.ran) return;
            if (outcome.report.error === null && outcome.report.transactionsAdded > 0) {
                showToast(`Sync bancaire : ${outcome.report.transactionsAdded} transaction(s) importée(s).`, 'success');
            }
        };

        // Debounce 2 s : évite les faux appels pendant la frappe du jeton tout en démarrant vite au boot.
        const bootTimer = setTimeout(() => { void triggerAutoSync(false); }, 2000);
        const intervalId = setInterval(() => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                void triggerAutoSync(false);
            }
        }, FINTABLE_AUTO_INTERVAL_MS);
        const onWake = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                void triggerAutoSync(false);
            }
        };
        const onOnline = () => {
            void triggerAutoSync(true);
        };
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onWake);
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', onWake);
            window.addEventListener('online', onOnline);
        }
        return () => {
            cancelled = true;
            clearTimeout(bootTimer);
            clearInterval(intervalId);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onWake);
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', onWake);
                window.removeEventListener('online', onOnline);
            }
        };
    }, [fintableToken]);

    // Déclenche une synchronisation immédiate lorsque l'utilisateur modifie ses rôles de comptes Fintable.
    useEffect(() => {
        if (prevRolesRef.current === fintableRoles) return;
        prevRolesRef.current = fintableRoles;
        if (!fintableToken) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                const outcome = await maybeRunDailyFintableSync({
                    maxAgeMs: 0,
                    ignoreCooldown: true,
                    autoCreditCards: true,
                });
                if (cancelled || !outcome.ran) return;
                if (outcome.report.error === null && outcome.report.transactionsAdded > 0) {
                    showToast(`Sync bancaire : ${outcome.report.transactionsAdded} transaction(s) importée(s).`, 'success');
                }
            })();
        }, 1500);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [fintableRoles, fintableToken]);

    // Taux FX au boot + rafraîchissement automatique au réveil (focus/visibility/online) et toutes les 6 h.
    // L'état FX est lu DANS `doUpdateFxRates` APRÈS `await fetchFxRates()` (`getState`), sans abonnement.
    const updateFxRates = useFinanceStore((s) => s.updateFxRates);
    useEffect(() => {
        let cancelled = false;
        let lastFxAttemptAt = 0;
        const FX_WAKE_COOLDOWN_MS = 30 * 60_000;
        const FX_INTERVAL_MS = 6 * 60 * 60_000;

        const doUpdateFxRates = async (fromWake = false) => {
            if (cancelled) return;
            const nowMs = Date.now();
            if (fromWake && nowMs - lastFxAttemptAt < FX_WAKE_COOLDOWN_MS) return;
            lastFxAttemptAt = nowMs;
            try {
                // ⚠️⚠️ `getState()` est relu APRÈS `await fetchFxRates()` (fxBootLectureApresAttente).
                const rates = await fetchFxRates();
                if (cancelled) return;
                const fxEtat = useFinanceStore.getState();
                const ecriture = ecritureFxSelonLecture(fxEtat, rates);
                if (ecriture) updateFxRates(ecriture);
            } catch (e) {
                logError({ source: 'network', severity: 'warning', message: 'Mise à jour des taux FX impossible (taux de repli utilisés)', error: e });
            }
        };
        const stopBoot = apresPremierAffichage(() => { void doUpdateFxRates(false); });
        const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
        if (isJsdom) return stopBoot;

        const onWake = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                void doUpdateFxRates(true);
            }
        };
        const onOnline = () => { void doUpdateFxRates(false); };
        const intervalId = typeof window !== 'undefined'
            ? window.setInterval(() => {
                  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                      void doUpdateFxRates(false);
                  }
              }, FX_INTERVAL_MS)
            : null;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onWake);
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', onWake);
            window.addEventListener('online', onOnline);
        }
        return () => {
            cancelled = true;
            stopBoot();
            if (intervalId !== null && typeof window !== 'undefined') window.clearInterval(intervalId);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onWake);
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', onWake);
                window.removeEventListener('online', onOnline);
            }
        };
    // Effet run-once : fetch FX rates au boot et sur réveil/périodique, sans re-run réactif sur state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Garder les postes Budget alignés sur les transactions réelles dès le boot, après sync
    // bancaire / import ou lors d'un changement de mois, sans attendre l'ouverture de Budget.
    const bootTransactions = useFinanceStore((s) => s.transactions);
    const todayIso = useTodayIsoLocal();
    const currentMonthKey = todayIso.slice(0, 7);
    const budgetInitialSyncDone = useRef(false);
    useEffect(() => {
        if (!bootTransactions || bootTransactions.length === 0) return;
        const [y, m, d] = todayIso.split('-').map(Number);
        const refDate = y && m && d ? new Date(y, m - 1, d) : new Date();
        const timer = setTimeout(() => {
            const st = useFinanceStore.getState();
            if (!st.transactions || st.transactions.length === 0) return;
            const allowRemoval = !budgetInitialSyncDone.current;
            const patch = computeBudgetSyncPatch(st.transactions, st.budgetItems, { allowRemoval, refDate });
            budgetInitialSyncDone.current = true;
            if (!patch.changed) return;
            st.setAppState({ budgetItems: patch.items });
            if (patch.added.length > 0 || patch.removed.length > 0 || patch.renamed.length > 0) {
                logError({
                    source: 'storage',
                    severity: 'info',
                    message: `Budget auto-aligné — +${patch.added.length}, ~${patch.renamed.length}, -${patch.removed.length}`,
                });
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [bootTransactions, currentMonthKey, todayIso]);
}
