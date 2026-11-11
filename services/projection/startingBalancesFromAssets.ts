// services/projection/startingBalancesFromAssets.ts
//
// [FINTABLE-AUTORITE-PARTOUT étape 3] Soldes de placement de départ dérivés PUREMENT des avoirs.
//
// ⚠️ POURQUOI CE FICHIER EXISTE SÉPARÉMENT. Cette fonction vivait dans `buildSimulationParams.ts`,
// et c'était sans conséquence tant que ses seuls appelants étaient le moteur et le MCP. L'étape 3
// lui donne un appelant de plus — la vue d'ensemble, qui alimente l'ACCUEIL. Or importer
// `buildSimulationParams.ts` tire avec lui `verifierEntreesMoteur`, les barèmes fiscaux
// (`utils/tax`) et les types du moteur : tout ça serait entré dans le bundle de BOOT pour trois
// lignes de dérivation (règle §2 du `CLAUDE.md` — hoister un import au niveau App tire ses deps).
//
// Le module ne dépend donc que de ce que la dérivation utilise VRAIMENT : la reconstruction du
// passé et son lecteur de dernier point. `buildSimulationParams.ts` la RÉ-EXPORTE, pour qu'aucun
// appelant existant n'ait à changer et qu'il n'existe toujours qu'UNE définition.

import type { Asset } from '../../types';
import type { LiveCSVBalances } from '../projection';
import {
    reconstructPortfolioHistory,
    type MinimalAsset,
} from '../history/reconstructPortfolioHistory';
import { deriveStartingBalancesFromHistory } from '../history/startingBalancesFromHistory';
import { getEffectivePurchases } from '../../utils/assetPurchases';
import { assetValueCad, toCurrencyFactor } from '../portfolio';

export interface PortfolioStartingACBs {
    nonRegACB: number;
    cryptoACB: number;
}

/**
 * Dérive les soldes de placement de départ (`liveCSVBalances`) PUREMENT depuis
 * les avoirs, en réutilisant EXACTEMENT la même chaîne que le composant via le
 * hook `usePastPortfolioHistory` : `reconstructPortfolioHistory` (passé réel
 * des comptes) → `deriveStartingBalancesFromHistory` (dernier point = solde
 * actuel). En contexte hors-DOM (MCP), aucun enrichissement réseau (Finnhub)
 * n'a lieu : la reconstruction part du `priceHistory` présent dans les avoirs,
 * comme en mode test du composant.
 */
export function derivePortfolioStartingBalances(
    assets: readonly Asset[],
    fxRates: Record<string, number>,
): LiveCSVBalances {
    const minimal: MinimalAsset[] = (assets ?? []).map((a) => ({
        symbol: a.symbol,
        quantity: a.quantity || 0,
        currency: a.currency || 'CAD',
        currentPrice: a.currentPrice || 0,
        accountType: a.accountType,
        dateBought: a.dateBought,
        purchases: getEffectivePurchases(a),
        // [FUTUR-MOIS0-CLOTURE-SANS-AGE] Cf. le mapper jumeau de `usePastPortfolioHistory` : deux
        // chemins vers la même reconstruction, donc DEUX mappers à compléter. N'en faire qu'un
        // laisserait le moteur (et le MCP) sur l'ancien comportement, en silence.
        priceUpdatedAt: a.priceUpdatedAt,
        priceHistory: (a.priceHistory || []).map((p) => ({ date: p.date, price: p.price })),
    }));
    const history = reconstructPortfolioHistory(minimal, fxRates ?? {});
    return deriveStartingBalancesFromHistory(history.points);
}

/**
 * F15 — Dérive les prix de base rajustés (PBR / ACB) initiaux des comptes imposables
 * (Non-Enregistré et Crypto) au mois zéro depuis l'historique d'achats `Asset.purchases[]`.
 * En l'absence totale d'achats documentés, repli No-fake-data sur le solde du compte.
 */
export function derivePortfolioStartingACBs(
    assets: readonly Asset[],
    fxRates: Record<string, number>,
    startingBalances?: { nonReg?: number; crypto?: number },
): PortfolioStartingACBs {
    let nonRegAcbSum = 0;
    let nonRegValueSum = 0;
    let cryptoAcbSum = 0;
    let cryptoValueSum = 0;

    for (const a of assets ?? []) {
        const type = (a.accountType || '').toUpperCase();
        if (type !== 'NON-ENREG' && type !== 'CRYPTO') continue;

        const valCad = assetValueCad(a, fxRates);
        const purchases = getEffectivePurchases(a);
        const fxFactor = toCurrencyFactor(fxRates, a.currency || 'CAD');

        let acbCad = valCad; // Fallback no-fake-data si aucun achat
        if (purchases && purchases.length > 0) {
            const costNative = purchases.reduce((sum, p) => sum + (Math.max(0, p.quantity) * Math.max(0, p.price)), 0);
            acbCad = costNative * fxFactor;
        }

        if (type === 'CRYPTO') {
            cryptoAcbSum += acbCad;
            cryptoValueSum += valCad;
        } else {
            nonRegAcbSum += acbCad;
            nonRegValueSum += valCad;
        }
    }

    // Gestion de l'encaisse ou du reliquat non alloué en compte
    const nonRegTarget = startingBalances?.nonReg ?? nonRegValueSum;
    const cryptoTarget = startingBalances?.crypto ?? cryptoValueSum;

    const nonRegUnallocated = Math.max(0, nonRegTarget - nonRegValueSum);
    const cryptoUnallocated = Math.max(0, cryptoTarget - cryptoValueSum);

    return {
        nonRegACB: nonRegAcbSum + nonRegUnallocated,
        cryptoACB: cryptoAcbSum + cryptoUnallocated,
    };
}

