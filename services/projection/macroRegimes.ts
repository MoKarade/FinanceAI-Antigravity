// services/projection/macroRegimes.ts
// Modèle de régimes macroéconomiques markoviens à 4 états (Expansion, Stagflation, Récession, Krach)
// et injection d'épisodes de crises historiques (1929, 1973-74, 2000-02, 2008, 2020, 2022).
// Pure Function : flux PRNG macro isolé (macroRng) pour préserver à l'octet près les séquences
// standard et la mortalité/divorce lorsque les régimes sont désactivés ou activés.

import { gaussianRandom, mulberry32 } from './helpers';
import {
    canadianBondReturnFor,
    canadianInflationFor,
    convertUsdReturnToCad,
    getHistoricalReturnsDataset,
    tsxReturnFor,
    type YearReturn,
} from './historicalReturns';
import type { BaseRates } from './glidepathRates';
import type { MacroRegimeId } from './types';

export type HistoricalCrisisId = '1929' | '1973-74' | '2000-02' | '2008' | '2020' | '2022';

export interface MacroRegimeRunConfig {
    enableMacroRegimes: boolean;
    includeHistoricalCrises: boolean;
    seed?: number;
}

export interface RegimeParameters {
    id: MacroRegimeId;
    labelFr: string;
    equityDeltaPp: number;
    cryptoDeltaPp: number;
    cashDeltaPp: number;
    inflationDeltaPp: number;
    stockVolPct: number;
    cryptoVolPct: number;
    cashVolPct: number;
    inflationVolPct: number;
    rhoMarketStocks: number;
    rhoMarketCrypto: number;
    wInflationMarket: number;
    wInflationMacro: number;
    wCashMarket: number;
    wCashMacro: number;
}

export interface ActiveCrisisState {
    id: HistoricalCrisisId;
    elapsedMonths: number;
    durationMonths: number;
    yearReturns: readonly YearReturn[];
    monthlyLogShape?: readonly number[];
}

export interface MacroRegimeState {
    enableMacroRegimes: boolean;
    includeHistoricalCrises: boolean;
    currentRegime: MacroRegimeId;
    monthsInRegime: number;
    activeCrisis: ActiveCrisisState | null;
    crisisCooldownMonths: number;
    macroRng: () => number;
}

export interface RegimeMarketRatesResult {
    mcCeliRate: number;
    mcReerRate: number;
    mcNonRegRate: number;
    mcCryptoRate: number;
    mcCashRate: number;
    currentInflation: number;
}

export const MACRO_REGIME_ORDER: readonly MacroRegimeId[] = [
    'expansion',
    'stagflation',
    'recession',
    'krach',
];

/** Matrice de transition mensuelle calibrée (chaque ligne somme exactement à 1.0). */
export const TRANSITION_MATRIX: Readonly<Record<MacroRegimeId, readonly [number, number, number, number]>> = {
    expansion: [0.975, 0.01, 0.012, 0.003],
    stagflation: [0.03, 0.935, 0.025, 0.01],
    recession: [0.075, 0.015, 0.895, 0.015],
    krach: [0.06, 0.01, 0.15, 0.78],
};

/** Distribution stationnaire approximative de la chaîne [expansion, stagflation, récession, krach]. */
export const STATIONARY_WEIGHTS: readonly [number, number, number, number] = [0.68, 0.14, 0.15, 0.03];

const TRANSITION_CDF: Readonly<Record<MacroRegimeId, readonly [number, number, number, number]>> = {
    expansion: [0.975, 0.985, 0.997, 1.0],
    stagflation: [0.03, 0.965, 0.99, 1.0],
    recession: [0.075, 0.09, 0.985, 1.0],
    krach: [0.06, 0.07, 0.22, 1.0],
};

const STATIONARY_CDF: readonly [number, number, number, number] = [0.68, 0.82, 0.97, 1.0];

/** Paramètres par régime macroéconomique (les poids w1² + w2² < 1 sont strictement valides). */
export const REGIME_PARAMS: Readonly<Record<MacroRegimeId, RegimeParameters>> = {
    expansion: {
        id: 'expansion',
        labelFr: 'Expansion',
        equityDeltaPp: 3.5,
        cryptoDeltaPp: 6,
        cashDeltaPp: 0.2,
        inflationDeltaPp: -0.3,
        stockVolPct: 12,
        cryptoVolPct: 40,
        cashVolPct: 1.8,
        inflationVolPct: 1.0,
        rhoMarketStocks: 0.8,
        rhoMarketCrypto: 0.7,
        wInflationMarket: -0.25,
        wInflationMacro: 0.5,
        wCashMarket: -0.2,
        wCashMacro: -0.25,
    },
    stagflation: {
        id: 'stagflation',
        labelFr: 'Stagflation',
        equityDeltaPp: -3.5,
        cryptoDeltaPp: -10,
        cashDeltaPp: -1.5,
        inflationDeltaPp: 3.5,
        stockVolPct: 20,
        cryptoVolPct: 55,
        cashVolPct: 4.5,
        inflationVolPct: 2.8,
        rhoMarketStocks: 0.85,
        rhoMarketCrypto: 0.75,
        wInflationMarket: -0.55,
        wInflationMacro: 0.6,
        // Corrélation positive actions-obligations en stagflation (comme 1973-74 et 2022)
        wCashMarket: 0.55,
        wCashMacro: -0.3,
    },
    recession: {
        id: 'recession',
        labelFr: 'Récession',
        equityDeltaPp: -8,
        cryptoDeltaPp: -18,
        cashDeltaPp: 1.0,
        inflationDeltaPp: -0.8,
        stockVolPct: 22,
        cryptoVolPct: 60,
        cashVolPct: 3.0,
        inflationVolPct: 1.6,
        rhoMarketStocks: 0.9,
        rhoMarketCrypto: 0.85,
        wInflationMarket: -0.2,
        wInflationMacro: 0.4,
        wCashMarket: -0.35,
        wCashMacro: 0.3,
    },
    krach: {
        id: 'krach',
        labelFr: 'Krach',
        equityDeltaPp: -30,
        cryptoDeltaPp: -45,
        cashDeltaPp: 1.5,
        inflationDeltaPp: -1.5,
        stockVolPct: 38,
        cryptoVolPct: 80,
        cashVolPct: 4.0,
        inflationVolPct: 2.2,
        rhoMarketStocks: 0.95,
        rhoMarketCrypto: 0.92,
        wInflationMarket: -0.1,
        wInflationMacro: 0.3,
        // Fuite vers la sécurité (corrélation négative actions-obligations) et contagion crypto
        wCashMarket: -0.45,
        wCashMacro: 0.4,
    },
};

export interface HistoricalCrisisDefinition {
    id: HistoricalCrisisId;
    labelFr: string;
    years: readonly number[];
    durationMonths: number;
    yearReturns: readonly YearReturn[];
    /** Forme intra-annuelle en log-rendement de somme exacte 0 (ex. creux V fév-mars 2020). */
    monthlyLogShape?: readonly number[];
}

const DATASET_BY_YEAR: ReadonlyMap<number, YearReturn> = new Map(
    getHistoricalReturnsDataset().map((yr) => [yr.year, yr]),
);

function pickYears(years: readonly number[]): readonly YearReturn[] {
    const out: YearReturn[] = [];
    for (const y of years) {
        const rec = DATASET_BY_YEAR.get(y);
        if (rec) out.push(rec);
    }
    return out;
}

export const HISTORICAL_CRISIS_IDS: readonly HistoricalCrisisId[] = [
    '1929',
    '1973-74',
    '2000-02',
    '2008',
    '2020',
    '2022',
];

export const HISTORICAL_CRISIS_CATALOG: Readonly<Record<HistoricalCrisisId, HistoricalCrisisDefinition>> = {
    '1929': {
        id: '1929',
        labelFr: 'Grande Dépression (1929-1932)',
        years: [1929, 1930, 1931, 1932],
        durationMonths: 48,
        yearReturns: pickYears([1929, 1930, 1931, 1932]),
    },
    '1973-74': {
        id: '1973-74',
        labelFr: 'Choc pétrolier & stagflation (1973-1974)',
        years: [1973, 1974],
        durationMonths: 24,
        yearReturns: pickYears([1973, 1974]),
    },
    '2000-02': {
        id: '2000-02',
        labelFr: 'Bulle technologique (2000-2002)',
        years: [2000, 2001, 2002],
        durationMonths: 36,
        yearReturns: pickYears([2000, 2001, 2002]),
    },
    '2008': {
        id: '2008',
        labelFr: 'Crise financière mondiale (2008)',
        years: [2008],
        durationMonths: 12,
        yearReturns: pickYears([2008]),
    },
    '2020': {
        id: '2020',
        labelFr: 'Krach éclair COVID-19 (2020)',
        years: [2020],
        durationMonths: 12,
        yearReturns: pickYears([2020]),
        // Somme exacte = 0.00 : creux sévère en mars (-0.22 log) suivi d'une reprise en V préservant le rendement annuel
        monthlyLogShape: [0.01, -0.09, -0.22, 0.07, 0.06, 0.04, 0.03, 0.03, 0.02, 0.02, 0.02, 0.01],
    },
    '2022': {
        id: '2022',
        labelFr: 'Choc taux & inflation (2022)',
        years: [2022],
        durationMonths: 12,
        yearReturns: pickYears([2022]),
    },
};

const CRISIS_COOLDOWN_MONTHS = 24;
const STANDALONE_CRISIS_MONTHLY_HAZARD = 0.004;
const KRACH_CRISIS_TRIGGER_PROB = 0.85;

/** PRNG déterministe isolé pour les transitions de régimes et crises historiques. */
function buildMacroRegimeRng(
    scenarioType: string,
    strategy: string,
    mcIterationIndex: number,
    seed?: number,
): () => number {
    const seedTag = Number.isFinite(seed) ? Math.trunc(seed as number) : 0;
    const baseSeedStr = `macro-${scenarioType}-${strategy}-${mcIterationIndex}-${seedTag}`;
    let hash = 0;
    for (let i = 0; i < baseSeedStr.length; i++) {
        hash = (hash << 5) - hash + baseSeedStr.charCodeAt(i);
        hash |= 0;
    }
    return mulberry32(Math.abs(hash) || 1337);
}

function sampleFromCdf(u: number, cdf: readonly [number, number, number, number]): MacroRegimeId {
    if (u < cdf[0]) return MACRO_REGIME_ORDER[0];
    if (u < cdf[1]) return MACRO_REGIME_ORDER[1];
    if (u < cdf[2]) return MACRO_REGIME_ORDER[2];
    return MACRO_REGIME_ORDER[3];
}

/**
 * Initialise l'état des régimes macroéconomiques.
 * Retourne null lorsque régimes et crises historiques sont tous deux désactivés,
 * garantissant zéro consommation PRNG et zéro divergence sur le moteur standard.
 */
export function createMacroRegimeState(
    config: Readonly<MacroRegimeRunConfig> | null | undefined,
    scenarioType: string,
    strategy: string,
    mcIterationIndex: number,
): MacroRegimeState | null {
    if (!config || (!config.enableMacroRegimes && !config.includeHistoricalCrises)) {
        return null;
    }
    const macroRng = buildMacroRegimeRng(scenarioType, strategy, mcIterationIndex, config.seed);
    const currentRegime: MacroRegimeId = config.enableMacroRegimes
        ? sampleFromCdf(macroRng(), STATIONARY_CDF)
        : 'expansion';

    return {
        enableMacroRegimes: Boolean(config.enableMacroRegimes),
        includeHistoricalCrises: Boolean(config.includeHistoricalCrises),
        currentRegime,
        monthsInRegime: 0,
        activeCrisis: null,
        crisisCooldownMonths: 0,
        macroRng,
    };
}

const INV_12 = 1 / 12;
const INV_SQRT12 = 1 / Math.sqrt(12);

const REGIME_RESIDUALS: Readonly<Record<MacroRegimeId, {
    stocksRes: number;
    cryptoRes: number;
    infRes: number;
    cashRes: number;
}>> = {
    expansion: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.expansion.rhoMarketStocks ** 2)),
        cryptoRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.expansion.rhoMarketCrypto ** 2)),
        infRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.expansion.wInflationMarket ** 2 - REGIME_PARAMS.expansion.wInflationMacro ** 2)),
        cashRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.expansion.wCashMarket ** 2 - REGIME_PARAMS.expansion.wCashMacro ** 2)),
    },
    stagflation: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.stagflation.rhoMarketStocks ** 2)),
        cryptoRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.stagflation.rhoMarketCrypto ** 2)),
        infRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.stagflation.wInflationMarket ** 2 - REGIME_PARAMS.stagflation.wInflationMacro ** 2)),
        cashRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.stagflation.wCashMarket ** 2 - REGIME_PARAMS.stagflation.wCashMacro ** 2)),
    },
    recession: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.recession.rhoMarketStocks ** 2)),
        cryptoRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.recession.rhoMarketCrypto ** 2)),
        infRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.recession.wInflationMarket ** 2 - REGIME_PARAMS.recession.wInflationMacro ** 2)),
        cashRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.recession.wCashMarket ** 2 - REGIME_PARAMS.recession.wCashMacro ** 2)),
    },
    krach: {
        stocksRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.krach.rhoMarketStocks ** 2)),
        cryptoRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.krach.rhoMarketCrypto ** 2)),
        infRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.krach.wInflationMarket ** 2 - REGIME_PARAMS.krach.wInflationMacro ** 2)),
        cashRes: Math.sqrt(Math.max(0, 1 - REGIME_PARAMS.krach.wCashMarket ** 2 - REGIME_PARAMS.krach.wCashMacro ** 2)),
    },
};

/**
 * Applique un choc gaussien de manière numériquement sûre :
 * borne le taux mensuel à >= -0.99 et le taux annuel résultant à > -100 %
 * afin d'éviter tout retournement de signe (pair^12) ou NaN dans applyMidMonthGrowth.
 */
export function safeApplyShock(baseRateAnnual: number, sigmaAnnual: number, shock: number): number {
    const safeBase = Number.isFinite(baseRateAnnual) ? Math.max(-99, baseRateAnnual) : 0;
    const safeSigma = Number.isFinite(sigmaAnnual) ? Math.max(0, sigmaAnnual) : 0;
    const safeShock = Number.isFinite(shock) ? shock : 0;
    const muMonthly = Math.pow(1 + safeBase / 100, INV_12) - 1;
    const sigmaMonthly = (safeSigma / 100) * INV_SQRT12;
    const monthlyRateWithShock = Math.max(-0.99, muMonthly + sigmaMonthly * safeShock);
    const annual = (Math.pow(1 + monthlyRateWithShock, 12) - 1) * 100;
    return Number.isFinite(annual) ? Math.max(-99.9, annual) : -99.9;
}

function triggerCrisisEpisode(state: MacroRegimeState): void {
    const idx = Math.min(
        HISTORICAL_CRISIS_IDS.length - 1,
        Math.floor(state.macroRng() * HISTORICAL_CRISIS_IDS.length),
    );
    const crisisId = HISTORICAL_CRISIS_IDS[idx];
    const def = HISTORICAL_CRISIS_CATALOG[crisisId];
    if (!def || def.yearReturns.length === 0) return;

    state.activeCrisis = {
        id: def.id,
        elapsedMonths: 0,
        durationMonths: def.durationMonths,
        yearReturns: def.yearReturns,
        monthlyLogShape: def.monthlyLogShape,
    };
    if (state.enableMacroRegimes && (def.id === '1973-74' || def.id === '2022')) {
        state.currentRegime = 'stagflation';
        state.monthsInRegime = 0;
    }
}

/** Fait progresser d'un mois l'état markovien et les crises historiques (en place, zéro allocation). */
export function stepMacroRegime(state: MacroRegimeState, m: number): void {
    if (m <= 0) return;

    if (state.activeCrisis !== null) {
        state.activeCrisis.elapsedMonths += 1;
        if (state.activeCrisis.elapsedMonths < state.activeCrisis.durationMonths) {
            return;
        }
        state.activeCrisis = null;
        state.crisisCooldownMonths = CRISIS_COOLDOWN_MONTHS;
    } else if (state.crisisCooldownMonths > 0) {
        state.crisisCooldownMonths -= 1;
    }

    const prevRegime = state.currentRegime;
    if (state.enableMacroRegimes) {
        const nextRegime = sampleFromCdf(state.macroRng(), TRANSITION_CDF[prevRegime]);
        if (nextRegime === prevRegime) {
            state.monthsInRegime += 1;
        } else {
            state.currentRegime = nextRegime;
            state.monthsInRegime = 0;
        }
    }

    if (state.includeHistoricalCrises && state.activeCrisis === null && state.crisisCooldownMonths === 0) {
        if (state.enableMacroRegimes) {
            if (prevRegime !== 'krach' && state.currentRegime === 'krach' && state.macroRng() < KRACH_CRISIS_TRIGGER_PROB) {
                triggerCrisisEpisode(state);
            }
        } else if (state.macroRng() < STANDALONE_CRISIS_MONTHLY_HAZARD) {
            triggerCrisisEpisode(state);
        }
    }
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

/** Calcule le rendement mensuel d'un épisode historique de crise (CAD, avec forme en V 2020). */
export function computeCrisisEpisodeRates(
    crisis: Readonly<ActiveCrisisState>,
    intraYearShock: number,
    cryptoShock: number,
): RegimeMarketRatesResult {
    const yearIdx = Math.min(
        crisis.yearReturns.length - 1,
        Math.max(0, Math.floor(crisis.elapsedMonths / 12)),
    );
    const yr = crisis.yearReturns[yearIdx];
    const tsxPct = tsxReturnFor(yr.year, yr.sp500TotalReturn);
    const sp500CadPct = convertUsdReturnToCad(yr.sp500TotalReturn / 100, (yr.usdCadReturn ?? 0) / 100) * 100;
    const equityAnnual = 0.35 * tsxPct + 0.65 * sp500CadPct;

    let equityRate: number;
    if (crisis.monthlyLogShape && crisis.monthlyLogShape.length > 0) {
        const shapeDelta = crisis.monthlyLogShape[crisis.elapsedMonths % crisis.monthlyLogShape.length] ?? 0;
        const annualFactor = Math.max(0.01, 1 + equityAnnual / 100);
        const rMonth = Math.exp(Math.log(annualFactor) / 12 + shapeDelta) - 1;
        const safeMonthly = Math.max(-0.99, rMonth);
        equityRate = Math.max(-99.9, (Math.pow(1 + safeMonthly, 12) - 1) * 100);
    } else {
        equityRate = safeApplyShock(equityAnnual, 8, intraYearShock * 0.4);
    }

    const bondRate = canadianBondReturnFor(yr.year, yr.bondReturn);
    const inflation = clamp(canadianInflationFor(yr.year, yr.inflationRate), -25, 30);
    const cryptoRate = safeApplyShock(Math.max(-65, equityRate * 1.5), 45, cryptoShock);

    return {
        mcCeliRate: equityRate,
        mcReerRate: equityRate,
        mcNonRegRate: equityRate,
        mcCryptoRate: cryptoRate,
        mcCashRate: bondRate,
        currentInflation: inflation,
    };
}

/**
 * Avance d'un mois les régimes macroéconomiques et produit les 6 taux corrélés du mois.
 * Consomme exactement 6 appels gaussianRandom(rng, 0, 1) afin de préserver la cadence du PRNG principal.
 */
export function stepAndComputeRegimeRates(
    m: number,
    baseRates: Readonly<BaseRates>,
    simInflation: number,
    state: MacroRegimeState,
    rng: () => number,
): RegimeMarketRatesResult {
    stepMacroRegime(state, m);

    // Conserve exactement les 6 tirages gaussiens de computeMonthlyMarketRates sur rng
    const u1 = gaussianRandom(rng, 0, 1);
    const u2 = gaussianRandom(rng, 0, 1);
    const u3 = gaussianRandom(rng, 0, 1);
    const u4 = gaussianRandom(rng, 0, 1);
    const u5 = gaussianRandom(rng, 0, 1);
    const u6 = gaussianRandom(rng, 0, 1);

    if (state.activeCrisis !== null) {
        return computeCrisisEpisodeRates(state.activeCrisis, u3, u4);
    }

    if (!state.enableMacroRegimes) {
        // Crises historiques seules : mois hors-crise alignés sur le MC standard (delta = 0)
        const zStocks = u1 * 0.8 + u3 * 0.6;
        const zCrypto = u1 * 1.2 + u4 * 0.8;
        const zInf = -u1 * 0.4 + u2 * 0.6 + u5 * 0.5;
        const zCash = zInf * 0.5 + u6 * 0.5;

        const mcCeliRate = safeApplyShock(baseRates.celi, 15, zStocks);
        const mcReerRate = baseRates.reer === baseRates.celi ? mcCeliRate : safeApplyShock(baseRates.reer, 15, zStocks);
        const mcNonRegRate = baseRates.nonReg === baseRates.celi
            ? mcCeliRate
            : baseRates.nonReg === baseRates.reer
                ? mcReerRate
                : safeApplyShock(baseRates.nonReg, 15, zStocks);
        return {
            mcCeliRate,
            mcReerRate,
            mcNonRegRate,
            mcCryptoRate: safeApplyShock(baseRates.crypto, 45, zCrypto),
            mcCashRate: safeApplyShock(baseRates.cash, 2, zCash),
            currentInflation: clamp(safeApplyShock(simInflation, 1.5, zInf), -25, 30),
        };
    }

    const reg = REGIME_PARAMS[state.currentRegime];
    const res = REGIME_RESIDUALS[state.currentRegime];
    const zStocks = reg.rhoMarketStocks * u1 + res.stocksRes * u3;
    const zCrypto = reg.rhoMarketCrypto * u1 + res.cryptoRes * u4;
    const zInf = reg.wInflationMarket * u1 + reg.wInflationMacro * u2 + res.infRes * u5;
    const zCash = reg.wCashMarket * u1 + reg.wCashMacro * u2 + res.cashRes * u6;

    const mcCeliRate = safeApplyShock(baseRates.celi + reg.equityDeltaPp, reg.stockVolPct, zStocks);
    const mcReerRate = baseRates.reer === baseRates.celi
        ? mcCeliRate
        : safeApplyShock(baseRates.reer + reg.equityDeltaPp, reg.stockVolPct, zStocks);
    const mcNonRegRate = baseRates.nonReg === baseRates.celi
        ? mcCeliRate
        : baseRates.nonReg === baseRates.reer
            ? mcReerRate
            : safeApplyShock(baseRates.nonReg + reg.equityDeltaPp, reg.stockVolPct, zStocks);
    const mcCryptoRate = safeApplyShock(baseRates.crypto + reg.cryptoDeltaPp, reg.cryptoVolPct, zCrypto);
    const mcCashRate = safeApplyShock(baseRates.cash + reg.cashDeltaPp, reg.cashVolPct, zCash);
    const rawInf = safeApplyShock(Math.max(-50, simInflation + reg.inflationDeltaPp), reg.inflationVolPct, zInf);
    const currentInflation = clamp(rawInf, -25, 30);

    return {
        mcCeliRate,
        mcReerRate,
        mcNonRegRate,
        mcCryptoRate,
        mcCashRate,
        currentInflation,
    };
}
