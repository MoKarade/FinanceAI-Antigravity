// services/assetFundamentals.ts
//
// F13 — Base de référence des actifs et FNB calibrée sur les normes d'hypothèses
// de projection de l'Institut québécois de planification financière (IQPF) et de
// FP Canada (édition 2026).
//
// Sources de vérité :
// - Normes d'hypothèses de projection IQPF / FP Canada 2026
// - docs/FISCAL_REFERENCE.md § « Normes de projection IQPF 2026 »
// - Formule de Fisher du rendement réel : (1 + r_nominal) / (1 + inflation) - 1

import type { Asset, ProjectionConfig } from '../types';

export type AssetClassIQPF =
    | 'CAN_EQUITY' // Actions canadiennes
    | 'US_EQUITY'  // Actions américaines
    | 'INT_EQUITY' // Actions internationales marchés développés
    | 'EM_EQUITY'  // Actions marchés émergents
    | 'CAN_BOND'   // Obligations canadiennes
    | 'CASH';      // Liquidités / Marché monétaire

/**
 * Inflation annuelle de référence selon les normes IQPF / FP Canada 2026 : 2,00 %.
 */
export const IQPF_2026_INFLATION = 0.020;

/**
 * Rendements nominaux espérés géométriques long terme par classe d'actifs (IQPF / FP Canada 2026).
 */
export const IQPF_2026_EXPECTED_RETURNS: Record<AssetClassIQPF, number> = {
    CAN_EQUITY: 0.064, // 6,40 %
    US_EQUITY: 0.065,  // 6,50 %
    INT_EQUITY: 0.066, // 6,60 %
    EM_EQUITY: 0.077,  // 7,70 %
    CAN_BOND: 0.039,   // 3,90 %
    CASH: 0.027,       // 2,70 %
};

/**
 * Volatilité annuelle (écart-type σ) par classe d'actifs calibrée IQPF 2026.
 */
export const IQPF_2026_VOLATILITY: Record<AssetClassIQPF, number> = {
    CASH: 0.015,       // 1,50 %
    CAN_BOND: 0.065,   // 6,50 %
    CAN_EQUITY: 0.145, // 14,50 %
    US_EQUITY: 0.152,  // 15,20 %
    INT_EQUITY: 0.165, // 16,50 %
    EM_EQUITY: 0.210,  // 21,00 %
};

/**
 * Fondamentaux d'un actif ou FNB.
 */
export interface AssetFundamental {
    symbol: string;
    name: string;
    assetClass: AssetClassIQPF;
    expectedReturn: number;
    volatility: number;
    mer: number; // Ratio de frais de gestion (Management Expense Ratio)
    dividendYield: number;
    eligibleCanadianDivFraction: number; // Fraction des distributions admissibles au crédit canadien (0 à 1)
    usForeignDivFraction: number;        // Fraction des distributions d'origine américaine soumises à retenue (0 à 1)
    interestFraction: number;            // Fraction des distributions taxées comme intérêts à 100 % (0 à 1)
}

/**
 * Formule de Fisher exacte du rendement réel net d'inflation :
 * (1 + nominal) / (1 + inflation) - 1.
 */
export function computeRealReturn(nominalReturn: number, inflation: number = IQPF_2026_INFLATION): number {
    if (!Number.isFinite(nominalReturn)) return 0;
    if (nominalReturn <= -1) return -1;
    const safeInflation = Number.isFinite(inflation) && inflation > -1 ? inflation : IQPF_2026_INFLATION;
    return (1 + nominalReturn) / (1 + safeInflation) - 1;
}

/**
 * Rendement net après déduction du ratio de frais de gestion (RFG / MER).
 */
export function computeNetReturn(grossReturn: number, mer: number): number {
    if (!Number.isFinite(grossReturn)) return 0;
    const safeMer = Number.isFinite(mer) && mer > 0 ? mer : 0;
    return grossReturn - safeMer;
}

/**
 * Calcule le rendement pondéré d'un portefeuille multi-actifs.
 * Si le solde total est nul ou négatif, retourne 0 sans division par zéro ni NaN.
 */
export function computePortfolioWeightedReturn(
    holdings: ReadonlyArray<{ balance: number; expectedReturn: number }>,
): number {
    if (!holdings || holdings.length === 0) return 0;
    let totalBalance = 0;
    let weightedSum = 0;

    for (const h of holdings) {
        const bal = Math.max(0, Number(h.balance) || 0);
        const ret = Number(h.expectedReturn) || 0;
        totalBalance += bal;
        weightedSum += bal * ret;
    }

    if (totalBalance <= 0) return 0;
    return weightedSum / totalBalance;
}

/**
 * Table de référence des principaux FNB canadiens et américains majeurs.
 */
export const CANADIAN_US_BENCHMARK_ETFS: Record<string, AssetFundamental> = {
    // Actions canadiennes
    XIC: {
        symbol: 'XIC',
        name: 'iShares Core S&P/TSX Capped Composite Index ETF',
        assetClass: 'CAN_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY,
        volatility: IQPF_2026_VOLATILITY.CAN_EQUITY,
        mer: 0.0006, // 0,06 %
        dividendYield: 0.028,
        eligibleCanadianDivFraction: 1.0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },
    VCN: {
        symbol: 'VCN',
        name: 'Vanguard FTSE Canada All Cap Index ETF',
        assetClass: 'CAN_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY,
        volatility: IQPF_2026_VOLATILITY.CAN_EQUITY,
        mer: 0.0005, // 0,05 %
        dividendYield: 0.028,
        eligibleCanadianDivFraction: 1.0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },
    XIU: {
        symbol: 'XIU',
        name: 'iShares S&P/TSX 60 Index ETF',
        assetClass: 'CAN_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY,
        volatility: IQPF_2026_VOLATILITY.CAN_EQUITY,
        mer: 0.0018, // 0,18 %
        dividendYield: 0.029,
        eligibleCanadianDivFraction: 1.0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },

    // Actions américaines (USD direct & CAD enveloppé)
    VOO: {
        symbol: 'VOO',
        name: 'Vanguard S&P 500 ETF (USD direct)',
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0003, // 0,03 %
        dividendYield: 0.015,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    },
    SPY: {
        symbol: 'SPY',
        name: 'SPDR S&P 500 ETF Trust (USD direct)',
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0009, // 0,09 %
        dividendYield: 0.015,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    },
    VFV: {
        symbol: 'VFV',
        name: 'Vanguard S&P 500 Index ETF (CAD wrapper)',
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0009, // 0,09 %
        dividendYield: 0.014,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    },
    XUS: {
        symbol: 'XUS',
        name: 'iShares Core S&P 500 Index ETF (CAD wrapper)',
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0010, // 0,10 %
        dividendYield: 0.014,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    },
    ZSP: {
        symbol: 'ZSP',
        name: 'BMO S&P 500 Index ETF (CAD wrapper)',
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0009, // 0,09 %
        dividendYield: 0.014,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    },
    QQQ: {
        symbol: 'QQQ',
        name: 'Invesco QQQ Trust (USD direct)',
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0020, // 0,20 %
        dividendYield: 0.006,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    },

    // Actions internationales développées
    XEF: {
        symbol: 'XEF',
        name: 'iShares Core MSCI EAFE IMI Index ETF',
        assetClass: 'INT_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.INT_EQUITY,
        volatility: IQPF_2026_VOLATILITY.INT_EQUITY,
        mer: 0.0022, // 0,22 %
        dividendYield: 0.027,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },
    VIU: {
        symbol: 'VIU',
        name: 'Vanguard FTSE Developed All Cap ex North America Index ETF',
        assetClass: 'INT_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.INT_EQUITY,
        volatility: IQPF_2026_VOLATILITY.INT_EQUITY,
        mer: 0.0023, // 0,23 %
        dividendYield: 0.027,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },
    VXUS: {
        symbol: 'VXUS',
        name: 'Vanguard Total International Stock ETF (USD direct)',
        assetClass: 'INT_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.INT_EQUITY,
        volatility: IQPF_2026_VOLATILITY.INT_EQUITY,
        mer: 0.0008, // 0,08 %
        dividendYield: 0.030,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },

    // Actions marchés émergents
    XEC: {
        symbol: 'XEC',
        name: 'iShares Core MSCI Emerging Markets IMI Index ETF',
        assetClass: 'EM_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.EM_EQUITY,
        volatility: IQPF_2026_VOLATILITY.EM_EQUITY,
        mer: 0.0028, // 0,28 %
        dividendYield: 0.025,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },
    VEE: {
        symbol: 'VEE',
        name: 'Vanguard FTSE Emerging Markets All Cap Index ETF',
        assetClass: 'EM_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.EM_EQUITY,
        volatility: IQPF_2026_VOLATILITY.EM_EQUITY,
        mer: 0.0024, // 0,24 %
        dividendYield: 0.026,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 0,
    },

    // Portefeuilles tout-en-un (Asset Allocation ETFs)
    XEQT: {
        symbol: 'XEQT',
        name: 'iShares Core Equity ETF Portfolio (100% Equity)',
        assetClass: 'INT_EQUITY', // Mix mondial dominé par l'équité
        expectedReturn: 0.066,
        volatility: 0.155,
        mer: 0.0020, // 0,20 %
        dividendYield: 0.020,
        eligibleCanadianDivFraction: 0.25,
        usForeignDivFraction: 0.45,
        interestFraction: 0,
    },
    VEQT: {
        symbol: 'VEQT',
        name: 'Vanguard All-Equity ETF Portfolio (100% Equity)',
        assetClass: 'INT_EQUITY',
        expectedReturn: 0.066,
        volatility: 0.155,
        mer: 0.0024, // 0,24 %
        dividendYield: 0.019,
        eligibleCanadianDivFraction: 0.30,
        usForeignDivFraction: 0.43,
        interestFraction: 0,
    },
    XGRO: {
        symbol: 'XGRO',
        name: 'iShares Core Growth ETF Portfolio (80/20)',
        assetClass: 'CAN_EQUITY',
        expectedReturn: 0.059,
        volatility: 0.130,
        mer: 0.0020, // 0,20 %
        dividendYield: 0.023,
        eligibleCanadianDivFraction: 0.20,
        usForeignDivFraction: 0.38,
        interestFraction: 0.20,
    },
    VGRO: {
        symbol: 'VGRO',
        name: 'Vanguard Growth ETF Portfolio (80/20)',
        assetClass: 'CAN_EQUITY',
        expectedReturn: 0.059,
        volatility: 0.130,
        mer: 0.0024, // 0,24 %
        dividendYield: 0.023,
        eligibleCanadianDivFraction: 0.24,
        usForeignDivFraction: 0.35,
        interestFraction: 0.20,
    },
    XBAL: {
        symbol: 'XBAL',
        name: 'iShares Core Balanced ETF Portfolio (60/40)',
        assetClass: 'CAN_EQUITY',
        expectedReturn: 0.054,
        volatility: 0.105,
        mer: 0.0020, // 0,20 %
        dividendYield: 0.028,
        eligibleCanadianDivFraction: 0.15,
        usForeignDivFraction: 0.30,
        interestFraction: 0.40,
    },
    VBAL: {
        symbol: 'VBAL',
        name: 'Vanguard Balanced ETF Portfolio (60/40)',
        assetClass: 'CAN_EQUITY',
        expectedReturn: 0.054,
        volatility: 0.105,
        mer: 0.0024, // 0,24 %
        dividendYield: 0.028,
        eligibleCanadianDivFraction: 0.18,
        usForeignDivFraction: 0.27,
        interestFraction: 0.40,
    },

    // Obligations canadiennes
    XBB: {
        symbol: 'XBB',
        name: 'iShares Core Canadian Universe Bond Index ETF',
        assetClass: 'CAN_BOND',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_BOND,
        volatility: IQPF_2026_VOLATILITY.CAN_BOND,
        mer: 0.0010, // 0,10 %
        dividendYield: 0.038,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 1.0,
    },
    ZAG: {
        symbol: 'ZAG',
        name: 'BMO Aggregate Bond Index ETF',
        assetClass: 'CAN_BOND',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_BOND,
        volatility: IQPF_2026_VOLATILITY.CAN_BOND,
        mer: 0.0009, // 0,09 %
        dividendYield: 0.039,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 1.0,
    },
    VAB: {
        symbol: 'VAB',
        name: 'Vanguard Canadian Aggregate Bond Index ETF',
        assetClass: 'CAN_BOND',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_BOND,
        volatility: IQPF_2026_VOLATILITY.CAN_BOND,
        mer: 0.0009, // 0,09 %
        dividendYield: 0.038,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 1.0,
    },

    // Liquidités / Marché monétaire
    CASH: {
        symbol: 'CASH',
        name: 'Global X High Interest Savings ETF',
        assetClass: 'CASH',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CASH,
        volatility: IQPF_2026_VOLATILITY.CASH,
        mer: 0.0011, // 0,11 %
        dividendYield: 0.038,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 1.0,
    },
    'CASH.TO': {
        symbol: 'CASH.TO',
        name: 'Global X High Interest Savings ETF',
        assetClass: 'CASH',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CASH,
        volatility: IQPF_2026_VOLATILITY.CASH,
        mer: 0.0011,
        dividendYield: 0.038,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 1.0,
    },
    CBIL: {
        symbol: 'CBIL',
        name: 'Horizons 0-3 Month T-Bill ETF',
        assetClass: 'CASH',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.CASH,
        volatility: IQPF_2026_VOLATILITY.CASH,
        mer: 0.0010,
        dividendYield: 0.036,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 0,
        interestFraction: 1.0,
    },
};

/**
 * Résout les fondamentaux d'un actif par symbole ou déduit une valeur par défaut
 * calibrée IQPF 2026 si le symbole n'est pas dans la table de référence.
 */
export function resolveAssetFundamental(symbol: string): AssetFundamental {
    const cleanSymbol = (symbol || '').trim().toUpperCase();
    if (CANADIAN_US_BENCHMARK_ETFS[cleanSymbol]) {
        return CANADIAN_US_BENCHMARK_ETFS[cleanSymbol];
    }
    const withoutSuffix = cleanSymbol.replace(/\.(TO|NE|TRT)$/, '');
    if (CANADIAN_US_BENCHMARK_ETFS[withoutSuffix]) {
        return CANADIAN_US_BENCHMARK_ETFS[withoutSuffix];
    }

    // Heuristique de détection par défaut
    if (cleanSymbol.includes('BOND') || cleanSymbol.includes('ZAG') || cleanSymbol.includes('VAB')) {
        return {
            symbol: cleanSymbol,
            name: `${cleanSymbol} (Obligations)`,
            assetClass: 'CAN_BOND',
            expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_BOND,
            volatility: IQPF_2026_VOLATILITY.CAN_BOND,
            mer: 0.0015,
            dividendYield: 0.038,
            eligibleCanadianDivFraction: 0,
            usForeignDivFraction: 0,
            interestFraction: 1.0,
        };
    }

    if (cleanSymbol.endsWith('.TO') || cleanSymbol.endsWith('.NE')) {
        return {
            symbol: cleanSymbol,
            name: `${cleanSymbol} (Action canadienne)`,
            assetClass: 'CAN_EQUITY',
            expectedReturn: IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY,
            volatility: IQPF_2026_VOLATILITY.CAN_EQUITY,
            mer: 0.0010,
            dividendYield: 0.025,
            eligibleCanadianDivFraction: 1.0,
            usForeignDivFraction: 0,
            interestFraction: 0,
        };
    }

    // Par défaut : Action américaine
    return {
        symbol: cleanSymbol,
        name: `${cleanSymbol} (Action américaine / globale)`,
        assetClass: 'US_EQUITY',
        expectedReturn: IQPF_2026_EXPECTED_RETURNS.US_EQUITY,
        volatility: IQPF_2026_VOLATILITY.US_EQUITY,
        mer: 0.0010,
        dividendYield: 0.015,
        eligibleCanadianDivFraction: 0,
        usForeignDivFraction: 1.0,
        interestFraction: 0,
    };
}

/**
 * Calcule les taux de rendement nominaux annuels par enveloppe (en %, ex: 6.5 pour 6,5 %)
 * selon le mode d'hypothèses sélectionné dans `Futur 2.0` :
 * - `'custom'` / `undefined` : conserve `currentRates` intact (parité bit-à-bit).
 * - `'iqpf'` : applique les normes IQPF / FP Canada 2026 par enveloppe type.
 * - `'real_holdings'` : pondère les rendements espérés nets de RFG (MER) des titres réellement détenus
 *   dans chaque enveloppe (`CELI`/`CELIAPP`, `REER`, `NON_ENREG`, `CRYPTO`), avec repli IQPF 2026 si vide.
 */
export function computeAccountReturnRatesForMode(
    mode: 'custom' | 'iqpf' | 'real_holdings' | undefined,
    currentRates: ProjectionConfig['returnRates'],
    assets: readonly Asset[] = [],
    fxRates: Record<string, number> = {},
): ProjectionConfig['returnRates'] {
    if (!mode || mode === 'custom') return currentRates;

    // Équilibré 75 % actions mondiales / 25 % obligations canadiennes pour REER par défaut IQPF 2026
    const iqpfBalancedReerPct = Number(
        ((0.25 * IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY
            + 0.30 * IQPF_2026_EXPECTED_RETURNS.US_EQUITY
            + 0.20 * IQPF_2026_EXPECTED_RETURNS.INT_EQUITY
            + 0.25 * IQPF_2026_EXPECTED_RETURNS.CAN_BOND) * 100).toFixed(2),
    );
    const iqpfEquityGrowthPct = Number(
        ((0.30 * IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY
            + 0.45 * IQPF_2026_EXPECTED_RETURNS.US_EQUITY
            + 0.25 * IQPF_2026_EXPECTED_RETURNS.INT_EQUITY) * 100).toFixed(2),
    );
    const iqpfNonRegPct = Number((IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY * 100).toFixed(2));
    const iqpfAltPct = Number((IQPF_2026_EXPECTED_RETURNS.EM_EQUITY * 100).toFixed(2));
    const iqpfCashPct = Number((IQPF_2026_EXPECTED_RETURNS.CASH * 100).toFixed(2));

    const iqpfDefaults = {
        celi: iqpfEquityGrowthPct,
        reer: iqpfBalancedReerPct,
        nonReg: iqpfNonRegPct,
        crypto: iqpfAltPct,
        cash: iqpfCashPct,
    };

    if (mode === 'iqpf') {
        return iqpfDefaults;
    }

    const buckets: Record<'celi' | 'reer' | 'nonReg' | 'crypto', Array<{ balance: number; expectedReturn: number }>> = {
        celi: [],
        reer: [],
        nonReg: [],
        crypto: [],
    };

    for (const a of assets) {
        const qty = Number(a.quantity);
        const price = Number(a.currentPrice);
        if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) continue;
        const fx = a.currency && a.currency !== 'CAD' ? (fxRates[a.currency] ?? 1) : 1;
        if (!Number.isFinite(fx) || fx <= 0) continue;
        const valCad = qty * price * fx;
        const fund = resolveAssetFundamental(a.symbol);
        const netRetPct = computeNetReturn(fund.expectedReturn, fund.mer) * 100;

        const acc = a.accountType ?? 'NON_ENREG';
        if (acc === 'CELI' || acc === 'CELIAPP' || acc === 'REEE') {
            buckets.celi.push({ balance: valCad, expectedReturn: netRetPct });
        } else if (acc === 'REER') {
            buckets.reer.push({ balance: valCad, expectedReturn: netRetPct });
        } else if (acc === 'CRYPTO') {
            buckets.crypto.push({ balance: valCad, expectedReturn: netRetPct });
        } else {
            buckets.nonReg.push({ balance: valCad, expectedReturn: netRetPct });
        }
    }

    return {
        celi: buckets.celi.length > 0 ? Number(computePortfolioWeightedReturn(buckets.celi).toFixed(2)) : iqpfDefaults.celi,
        reer: buckets.reer.length > 0 ? Number(computePortfolioWeightedReturn(buckets.reer).toFixed(2)) : iqpfDefaults.reer,
        nonReg: buckets.nonReg.length > 0 ? Number(computePortfolioWeightedReturn(buckets.nonReg).toFixed(2)) : iqpfDefaults.nonReg,
        crypto: buckets.crypto.length > 0 ? Number(computePortfolioWeightedReturn(buckets.crypto).toFixed(2)) : iqpfDefaults.crypto,
        cash: currentRates?.cash ?? iqpfDefaults.cash,
    };
}
