// services/projection/marketShocks.ts
// Cycle 27 split: chocs de marché mensuels (MC gaussien + bootstrap historique
// + override stress test inflation).
// Pattern: Pure Function. L'ordre exact des appels gaussianRandom(rng) est
// préservé pour garantir la reproductibilité des séquences PRNG seedées.

import { gaussianRandom, applyShock } from './helpers';
import { canadianInflationFor, type YearReturn } from './historicalReturns';
import type { BaseRates } from './glidepathRates';
import { stepAndComputeRegimeRates, type MacroRegimeState } from './macroRegimes';
import type { SimulationPastCurveCalibration } from './pastCurveCalibration';
import type { ValoriaEngineSchedule } from './types';

const INV_12 = 1 / 12;

export interface StressTestConfig {
    enabled: boolean;
    year: number;
    recoveryMonths: number;
    inflationShock: number;
}

interface MarketRatesResult {
    mcCeliRate: number;
    mcReerRate: number;
    mcNonRegRate: number;
    mcCryptoRate: number;
    mcCashRate: number;
    currentInflation: number;
}

/**
 * Calcule les taux de marché effectifs pour le mois m.
 * En MC, applique 6 chocs gaussiens corrélés (ordre fixe = déterminisme PRNG),
 * ou délègue au modèle de régimes macroéconomiques si macroState est actif.
 * Le bootstrap historique ou replay override les taux MC si présent.
 * Le stress test ajoute un choc d'inflation supplémentaire.
 */
export function computeMonthlyMarketRates(
    m: number,
    enableMonteCarlo: boolean,
    baseRates: Readonly<BaseRates>,
    simInflation: number,
    historicalSequence: YearReturn[] | null,
    stressTest: Readonly<StressTestConfig> | null,
    rng: () => number,
    macroState?: MacroRegimeState | null,
    valoriaSchedule?: Readonly<ValoriaEngineSchedule> | null,
    pastCurveCalibration?: Readonly<SimulationPastCurveCalibration> | null,
): MarketRatesResult {
    if (enableMonteCarlo && macroState && !historicalSequence) {
        const pastTilt = pastCurveCalibration
            ? pastCurveCalibration.calibratedReturnTiltPp * Math.exp(-m / 60)
            : 0;
        const effectiveBaseRates =
            pastTilt !== 0
                ? {
                      ...baseRates,
                      celi: baseRates.celi + pastTilt,
                      reer: baseRates.reer + pastTilt,
                      nonReg: baseRates.nonReg + pastTilt,
                  }
                : baseRates;
        const regRates = stepAndComputeRegimeRates(m, effectiveBaseRates, simInflation, macroState, rng);
        if (stressTest?.enabled) {
            const crashStartMonth = stressTest.year * 12;
            if (m >= crashStartMonth && m <= crashStartMonth + stressTest.recoveryMonths) {
                return { ...regRates, currentInflation: regRates.currentInflation + stressTest.inflationShock };
            }
        }
        return regRates;
    }

    let mcCeliRate = baseRates.celi;
    let mcReerRate = baseRates.reer;
    let mcNonRegRate = baseRates.nonReg;
    let mcCryptoRate = baseRates.crypto;
    let mcCashRate = baseRates.cash;
    let currentInflation = simInflation;

    if (enableMonteCarlo) {
        // Chocs corrélés — l'ordre des appels rng est intentionnel et figé.
        const Z_market = gaussianRandom(rng, 0, 1);
        const Z_macro = gaussianRandom(rng, 0, 1);
        const Z_stocks = (Z_market * 0.8 + gaussianRandom(rng, 0, 1) * 0.6);
        const Z_crypto = (Z_market * 1.2 + gaussianRandom(rng, 0, 1) * 0.8);
        const Z_inflation_shock = (-Z_market * 0.4 + Z_macro * 0.6 + gaussianRandom(rng, 0, 1) * 0.5);
        const Z_cash = (Z_inflation_shock * 0.5 + gaussianRandom(rng, 0, 1) * 0.5);

        const pastTilt = pastCurveCalibration
            ? pastCurveCalibration.calibratedReturnTiltPp * Math.exp(-m / 60)
            : 0;
        const blendEquityVol = (priorVol: number): number =>
            pastCurveCalibration
                ? valoriaSchedule
                    ? 0.6 * priorVol + 0.4 * pastCurveCalibration.calibratedVolatilityPct
                    : pastCurveCalibration.calibratedVolatilityPct
                : priorVol;

        const volCeli = blendEquityVol(valoriaSchedule?.annualVolatilityPct.celi ?? 15);
        const volReer = blendEquityVol(valoriaSchedule?.annualVolatilityPct.reer ?? 15);
        const volNonReg = blendEquityVol(valoriaSchedule?.annualVolatilityPct.nonReg ?? 15);
        const volCrypto = valoriaSchedule?.annualVolatilityPct.crypto ?? 45;

        const baseCeli = baseRates.celi + pastTilt;
        const baseReer = baseRates.reer + pastTilt;
        const baseNonReg = baseRates.nonReg + pastTilt;

        mcCeliRate = applyShock(baseCeli, volCeli, Z_stocks);
        mcReerRate = !valoriaSchedule && baseReer === baseCeli && volReer === volCeli
            ? mcCeliRate
            : applyShock(baseReer, volReer, Z_stocks);
        mcNonRegRate = !valoriaSchedule && baseNonReg === baseCeli && volNonReg === volCeli
            ? mcCeliRate
            : !valoriaSchedule && baseNonReg === baseReer && volNonReg === volReer
                ? mcReerRate
                : applyShock(baseNonReg, volNonReg, Z_stocks);
        mcCryptoRate = applyShock(baseRates.crypto, volCrypto, Z_crypto);
        mcCashRate = applyShock(baseRates.cash, 2, Z_cash);
        currentInflation = applyShock(simInflation, 1.5, Z_inflation_shock);

        // Sauts Merton Jump-Diffusion (uniquement lorsque valoriaSchedule est fourni)
        const mj = valoriaSchedule?.mertonJump;
        if (mj && mj.annualLambda > 0 && !historicalSequence) {
            const uJump = rng();
            const lambdaMonth = mj.annualLambda / 12;
            const pJump = 1 - Math.exp(-lambdaMonth);
            const kappa = Math.exp(mj.meanJumpPct + 0.5 * mj.jumpVolPct * mj.jumpVolPct) - 1;
            const driftComp = lambdaMonth * kappa;
            let jumpDec = -driftComp;
            if (uJump < pJump) {
                const zJump = gaussianRandom(rng, 0, 1);
                jumpDec = Math.exp(mj.meanJumpPct + mj.jumpVolPct * zJump) - 1 - driftComp;
            }
            const applyMonthlyJumpToAnnualRate = (annualPct: number, scale: number): number => {
                const mRate = Math.pow(Math.max(0.08, 1 + annualPct / 100), INV_12) - 1 + jumpDec * scale;
                const gross = Math.max(0.12, Math.min(3.5, 1 + mRate));
                return (Math.pow(gross, 12) - 1) * 100;
            };
            mcCeliRate = applyMonthlyJumpToAnnualRate(mcCeliRate, 1.0);
            mcReerRate = applyMonthlyJumpToAnnualRate(mcReerRate, 1.0);
            mcNonRegRate = applyMonthlyJumpToAnnualRate(mcNonRegRate, 1.0);
            mcCryptoRate = applyMonthlyJumpToAnnualRate(mcCryptoRate, 1.35);
        }
    }

    // W1.2 + W4.5: Override avec rendements historiques (bootstrap MC ou replay déterministe).
    // FIX D2.x: utilise CPI Canada (StatCan v41690973) si disponible.
    if (historicalSequence) {
        const histYear = historicalSequence[Math.floor(m / 12)];
        if (histYear) {
            mcCeliRate = histYear.sp500TotalReturn;
            mcReerRate = histYear.sp500TotalReturn;
            mcNonRegRate = histYear.sp500TotalReturn;
            mcCashRate = histYear.bondReturn;
            currentInflation = canadianInflationFor(histYear.year, histYear.inflationRate);
        }
    }

    // V36: Crisis Dashboard 2.0 — Inflation Shock (stress test).
    if (stressTest?.enabled) {
        const crashStartMonth = stressTest.year * 12;
        if (m >= crashStartMonth && m <= crashStartMonth + stressTest.recoveryMonths) {
            currentInflation += stressTest.inflationShock;
        }
    }

    return { mcCeliRate, mcReerRate, mcNonRegRate, mcCryptoRate, mcCashRate, currentInflation };
}
