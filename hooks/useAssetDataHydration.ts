// hooks/useAssetDataHydration.ts
//
// [GODFILE-APP] Hydratation des DONNÉES DE MARCHÉ des actifs (historiques de cours, prix live,
// profils secteur/région), extraite telle quelle d'App.tsx. Comportement inchangé : même clé de
// re-déclenchement (ensemble des symboles), mêmes gardes mode test, même chaînage séquentiel.
// ⚠️ Ce hook doit être appelé APRÈS useAppBootEffects dans App : la configuration du provider
// marketData (clé Finnhub) doit partir AVANT les consommateurs (ordre FIFO de la promesse
// partagée de loadMarketData).

import { useEffect, useMemo, useRef } from 'react';
import type { AppState } from '../types';
import { useFinanceStore } from '../store/useFinanceStore';
// [PERF-MARKETDATA-DYNIMPORT-INERTE] Voir useAppBootEffects : jamais d'import statique de valeurs
// depuis services/marketData dans le graphe de boot — tout passe par la promesse mémoïsée.
import { loadMarketData } from '../services/marketData/lazy';
import { refreshAssetPrices, applyPricePatches } from '../services/priceRefresh';
import { logError } from '../services/errorLogger';
import { coursPerime, dateDernierCours } from '../services/history/fraicheurCours';
import { todayIsoLocal } from '../services/projection/dailyRefine';

export function useAssetDataHydration(
    assets: AppState['assets'],
    setAppState: (patch: Partial<AppState>) => void,
): void {
    // [HIST-SESSION-HYDRATE] Clé stable = ENSEMBLE des symboles (tri + join) : un actif AJOUTÉ en cours
    // de session redéclenche l'hydratation (avant : useEffect [] = boot seulement → pas de courbe ni de
    // part au TOTAL avant le prochain reload, sans message). Pas de boucle : les patchs (priceHistory/
    // currentPrice/secteur) ne changent PAS les symboles ; une re-passe est bon marché (fraîcheur 24 h
    // par actif + mutex module `_hydrateQueue` + mutex/intervalle min de priceRefresh).
    const finnhubKey = useFinanceStore((s) => s.apiKeys?.finnhub ?? '');
    const assetSymbolsKey = useMemo(
        () => (assets ?? []).map(a => a?.symbol || '').filter(Boolean).sort().join(','),
        [assets],
    );
    const lastRunAtRef = useRef(0);

    useEffect(() => {
        let cancelled = false;
        let inFlight = false;
        const MARKET_AUTO_INTERVAL_MS = 15 * 60_000;
        const MARKET_WAKE_COOLDOWN_MS = 2 * 60_000;

        // [PORTFOLIO-HISTORY] Hydrate priceHistory (clôtures natives datées) DEPUIS LE 1ER ACHAT via
        // la chaîne marketData (Finnhub → repli Yahoo proxy → CoinGecko crypto) — remplace l'ancien
        // stub CSV mort (priceHistory jamais rempli → graphes de cours vides, bug Marc 2026-07-22).
        // Sauté en mode test (les fixtures persona portent leur propre priceHistory).
        const hydrateAssets = async (): Promise<boolean> => {
            const s = useFinanceStore.getState();
            const current = s.assets ?? [];
            if (current.length === 0) return false;
            const today = todayIsoLocal();
            let hasStale = false;
            try {
                const { hydrateAssetHistories, applyHistoryPatches, isSyntheticPriceHistory } = await import('../services/history/hydrateAssetHistories');
                const { getHistoryDetaille, hasHistoryProvider } = await loadMarketData();
                const { searchYahooSymbols } = await import('../services/marketData/providers/yahooProxy');
                const { clearMarketDataCache } = await import('../services/marketData/cache');
                const { clearNegativeCache } = await import('../services/marketData/negativeCache');
                // Si des actifs détenus ont un historique squelettique (< 5 points), synthétique ou
                // dont le dernier cours connu est périmé (> 4 jours), purger les caches quote/history
                // et cibler ces actifs en accéléré pour guérir immédiatement courbes et prix.
                const isBrokenOrStaleHistory = (a: (typeof current)[0]) => {
                    if (!a.symbol || (a.quantity || 0) <= 0) return false;
                    if (!a.priceHistory || a.priceHistory.length < 5 || isSyntheticPriceHistory(a.priceHistory)) return true;
                    return coursPerime(dateDernierCours(a.priceHistory), today);
                };
                hasStale = current.some(isBrokenOrStaleHistory);
                if (hasStale) {
                    clearMarketDataCache('history');
                    clearMarketDataCache('quote');
                    clearNegativeCache();
                }
                const targetAssets = hasStale
                    ? current.map((a) => (isBrokenOrStaleHistory(a) ? { ...a, lastHistorySync: 0 } : a))
                    : current;
                const res = await hydrateAssetHistories(
                    targetAssets,
                    {
                        getHistory: getHistoryDetaille,
                        hasProvider: hasHistoryProvider,
                        searchSymbols: async (q) => (await searchYahooSymbols(q)) ?? [],
                        ...(hasStale ? { delayMs: 400 } : {}),
                    },
                );
                if (cancelled) return hasStale;
                // [HIST-MULTI-PROVIDER] Publier le rapport MÊME sans patch (c'est justement quand
                // rien n'a pu être hydraté que le diagnostic par titre est utile à l'écran).
                const { setHistorySyncReport } = await import('../services/history/syncDiagnostics');
                setHistorySyncReport({ at: Date.now(), skipped: res.skipped, patchedCount: res.patches.size });
                if (res.patches.size === 0) return hasStale;
                // Anti-course : patch par symbole sur l'état FRAIS (un pull Drive pendant l'hydratation
                // n'est pas écrasé) — même patron qu'applyPricePatches.
                const fresh = useFinanceStore.getState().assets ?? [];
                setAppState({ assets: applyHistoryPatches(fresh, res.patches) });
            } catch (e) {
                logError({ source: 'network', severity: 'warning', message: 'Hydratation des historiques de cours échouée (graphes partiels).', error: e });
            }
            return hasStale;
        };
        // [PRICE-REFRESH-LIVE] — après l'hydratation d'historique, rafraîchit les currentPrice
        // depuis les quotes live (séquentiel 2 500 ms, cf services/priceRefresh). Sans ça, un prix
        // reste FIGÉ à sa valeur d'ajout pour toujours (dérive mesurée vs courtier).
        // Anti-course : lit l'état FRAIS du store au lancement ET à l'application (fusion par
        // symbole) — un pull Drive pendant le refresh n'est pas écrasé. Sauté en mode test
        // (ne pas réécrire les prix des fixtures persona).
        const refreshPricesAtBoot = async (forceRefresh = false): Promise<void> => {
            const s = useFinanceStore.getState();
            const current = s.assets ?? [];
            if (current.filter(a => a?.symbol && (a.quantity || 0) > 0).length === 0) return;
            try {
                const { getQuote, canAttemptQuote, hasQuoteProvider } = await loadMarketData();
                if (forceRefresh) {
                    const { clearMarketDataCache } = await import('../services/marketData/cache');
                    const { clearNegativeCache } = await import('../services/marketData/negativeCache');
                    clearMarketDataCache('quote');
                    clearNegativeCache();
                }
                const res = await refreshAssetPrices(
                    current,
                    { getQuote, hasProvider: forceRefresh ? hasQuoteProvider : canAttemptQuote, ...(forceRefresh ? { delayMs: 500 } : {}) },
                    forceRefresh ? { force: true } : undefined,
                );
                if (res.skipped.length > 0) {
                    logError({
                        source: 'network', severity: 'warning',
                        message: `Cours non rafraîchis au boot pour ${res.skipped.length} titre(s) : ${res.skipped.map(s => s.symbol).slice(0, 6).join(', ')}${res.skipped.length > 6 ? '…' : ''} — bouton « Actualiser les cours » pour forcer un nouvel essai.`,
                    });
                }
                const { updateQuoteSkips } = await import('../services/history/syncDiagnostics');
                updateQuoteSkips(res.skipped);
                if (cancelled || res.patches.size === 0) return;
                const fresh = useFinanceStore.getState().assets ?? [];
                setAppState({ assets: applyPricePatches(fresh, res.patches) });
            } catch (e) {
                logError({ source: 'network', severity: 'warning', message: 'Rafraîchissement des cours au boot échoué (prix existants conservés)', error: e });
            }
        };
        const hydrateProfilesAtBoot = async (): Promise<void> => {
            const s = useFinanceStore.getState();
            const current = s.assets ?? [];
            if (current.length === 0) return;
            try {
                const { hydrateAssetProfiles, applyProfilePatches } = await import('../services/assetProfileSync');
                const { getProfile, canAttemptProfile } = await loadMarketData();
                const res = await hydrateAssetProfiles(current, { getProfile, hasProvider: canAttemptProfile });
                if (cancelled || res.size === 0) return;
                const fresh = useFinanceStore.getState().assets ?? [];
                setAppState({ assets: applyProfilePatches(fresh, res) });
            } catch (e) {
                logError({ source: 'network', severity: 'warning', message: 'Auto-remplissage secteur/région échoué (répartitions inchangées).', error: e });
            }
        };

        const runPass = async (opts?: { fromWake?: boolean; force?: boolean }) => {
            if (cancelled || inFlight) return;
            const currentAssets = useFinanceStore.getState().assets ?? [];
            if (currentAssets.length === 0) return;
            const today = todayIsoLocal();
            const hasStaleNow = currentAssets.some(
                (a) => a.symbol && (a.quantity || 0) > 0 && coursPerime(dateDernierCours(a.priceHistory), today),
            );
            const nowMs = Date.now();
            if (opts?.fromWake && nowMs - lastRunAtRef.current < MARKET_WAKE_COOLDOWN_MS) {
                return;
            }
            inFlight = true;
            lastRunAtRef.current = nowMs;
            try {
                // 1. Cours en direct D'ABORD dès le lancement (complète aussi priceHistory périmé)
                await refreshPricesAtBoot(Boolean(opts?.force || hasStaleNow));
                // 2. Historiques détaillés ensuite (sans bloquer la mise à jour immédiate des prix)
                if (!cancelled) {
                    await hydrateAssets();
                }
                // 3. Profils secteur/région en dernier
                if (!cancelled) {
                    await hydrateProfilesAtBoot();
                }
            } finally {
                inFlight = false;
            }
        };

        void runPass({ force: true });

        const isJsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
        if (isJsdom) {
            return () => { cancelled = true; };
        }

        const onWake = () => {
            if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                void runPass({ fromWake: true });
            }
        };
        const onOnline = () => {
            void runPass({ force: true });
        };
        const intervalId = typeof window !== 'undefined'
            ? window.setInterval(() => {
                  if (typeof document === 'undefined' || document.visibilityState === 'visible') {
                      void runPass({ force: true });
                  }
              }, MARKET_AUTO_INTERVAL_MS)
            : null;
        if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onWake);
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', onWake);
            window.addEventListener('online', onOnline);
        }

        return () => {
            cancelled = true;
            if (intervalId !== null && typeof window !== 'undefined') window.clearInterval(intervalId);
            if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onWake);
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', onWake);
                window.removeEventListener('online', onOnline);
            }
        };
    // [HIST-SESSION-HYDRATE] Re-run quand l'ENSEMBLE des symboles change (ajout/retrait d'actif en
    // session) — jamais sur un simple patch de prix/historique (la clé ne bouge pas). setAppState et
    // assets restent volontairement omis (une dep sur l'objet assets re-fetcherait en boucle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assetSymbolsKey, finnhubKey]);
}
