import { describe, expect, it } from 'vitest';
import {
    MONTE_CARLO_PAST_ANCHOR_ISO,
    computePastCurveCalibration,
    toSimulationPastCurveCalibration,
} from '../../services/projection/pastCurveCalibration';
import type { Asset, Transaction } from '../../types';

function makeMonthlyPrices(pricesByMonth: number[]): Array<{ date: string; price: number }> {
    return pricesByMonth.map((price, idx) => {
        const year = 2025 + Math.floor(idx / 12);
        const month = (idx % 12) + 1;
        const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
        return {
            date: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
            price,
        };
    });
}

describe('computePastCurveCalibration — calibrage Monte Carlo depuis janv. 2025', () => {
    it('respecte strictement no-fake-data quand le dossier est vide ou sans historique de prix', () => {
        const empty = computePastCurveCalibration({
            assets: [],
            fxRates: {},
            transactions: [],
            referenceDateIso: '2026-10-31',
        });

        expect(empty.windowStartIso).toBe(MONTE_CARLO_PAST_ANCHOR_ISO);
        expect(empty.hasUsableCurve).toBe(false);
        expect(empty.portfolioMonthsObserved).toBe(0);
        expect(empty.realizedAnnualizedReturnPct).toBeNull();
        expect(empty.realizedAnnualizedVolatilityPct).toBeNull();
        expect(empty.realizedMaxDrawdownPct).toBeNull();
        expect(empty.realizedNetWorthDeltaCad).toBeNull();
        expect(empty.calibratedVolatilityPct).toBeNull();
        expect(empty.calibratedReturnTiltPp).toBeNull();
        expect(empty.mertonJumpScale).toBe(1);
        expect(toSimulationPastCurveCalibration(empty)).toBeUndefined();

        const noHistAsset: Asset = {
            symbol: 'SYNTH_FLAT',
            name: 'Titre sans historique',
            quantity: 100,
            currentPrice: 50,
            performance: 0,
            dateBought: '2025-01-15',
            accountType: 'CELI',
            currency: 'CAD',
        };
        const withoutHistory = computePastCurveCalibration({
            assets: [noHistAsset],
            fxRates: {},
            referenceDateIso: '2026-10-31',
        });
        expect(withoutHistory.hasUsableCurve).toBe(false);
        expect(withoutHistory.calibratedVolatilityPct).toBeNull();
        expect(toSimulationPastCurveCalibration(withoutHistory)).toBeUndefined();
    });

    it('calcule un rendement TWR insensible aux dépôts et achats mensuels depuis janv. 2025', () => {
        const prices = Array.from({ length: 22 }, () => 100);
        const purchases = Array.from({ length: 22 }, (_, idx) => {
            const year = 2025 + Math.floor(idx / 12);
            const month = (idx % 12) + 1;
            return {
                date: `${year}-${String(month).padStart(2, '0')}-15`,
                quantity: 10,
                price: 100,
            };
        });

        const asset: Asset = {
            symbol: 'SYNTH_STABLE',
            name: 'FNB stable de test',
            quantity: 220,
            currentPrice: 100,
            performance: 0,
            accountType: 'CELI',
            currency: 'CAD',
            dateBought: '2025-01-15',
            purchases,
            priceHistory: makeMonthlyPrices(prices),
        };

        const cal = computePastCurveCalibration({
            assets: [asset],
            fxRates: {},
            referenceDateIso: '2026-10-31',
        });

        expect(cal.hasUsableCurve).toBe(true);
        expect(cal.portfolioMonthsObserved).toBe(21);
        expect(Math.abs(cal.realizedAnnualizedReturnPct ?? 99)).toBeLessThan(0.1);
        expect(cal.realizedMaxDrawdownPct).toBe(0);
    });

    it('mesure la volatilité, le creux > 15 % (sauts Merton) et la courbe nette sur 22 mois volatils', () => {
        // Baisse marquée au printemps 2025 (-22 %) puis rebond progressif jusqu'en oct. 2026
        const prices = [
            100, 96, 86, 78, 84, 92, 95, 102, 108, 104, 112, 118,
            110, 115, 121, 117, 124, 129, 126, 132, 136, 140,
        ];
        const volatileAsset: Asset = {
            symbol: 'SYNTH_GROWTH',
            name: 'FNB croissance test',
            quantity: 100,
            currentPrice: 140,
            performance: 14,
            accountType: 'REER',
            currency: 'USD',
            dateBought: '2025-01-05',
            purchases: [{ date: '2025-01-05', quantity: 100, price: 100 }],
            priceHistory: makeMonthlyPrices(prices),
        };

        const txs: Transaction[] = [];
        for (let idx = 0; idx < 22; idx++) {
            const year = 2025 + Math.floor(idx / 12);
            const month = (idx % 12) + 1;
            const ym = `${year}-${String(month).padStart(2, '0')}`;
            txs.push(
                {
                    id: idx * 2 + 1,
                    date: `${ym}-01`,
                    payee: 'PaieSynth',
                    amount: 5000,
                    category: 'Revenu',
                    status: 'processed',
                },
                {
                    id: idx * 2 + 2,
                    date: `${ym}-05`,
                    payee: 'LoyerSynth',
                    amount: -3200,
                    category: 'Logement',
                    status: 'processed',
                },
            );
        }

        const cal = computePastCurveCalibration({
            assets: [volatileAsset],
            fxRates: { USD: 1.35 },
            transactions: txs,
            calculatedStartingCash: 42_000,
            priorVolatilityPct: 14.5,
            priorReturnPct: 6.5,
            referenceDateIso: '2026-10-31',
        });

        expect(cal.hasUsableCurve).toBe(true);
        expect(cal.portfolioMonthsObserved).toBe(21);
        expect(cal.realizedMaxDrawdownPct).not.toBeNull();
        expect(cal.realizedMaxDrawdownPct!).toBeLessThan(-15);
        expect(cal.mertonJumpScale).toBeGreaterThan(1);
        expect(cal.mertonJumpScale).toBeLessThanOrEqual(1.35);
        expect(cal.calibratedVolatilityPct).not.toBeNull();
        expect(cal.calibratedVolatilityPct!).toBeGreaterThanOrEqual(6);
        expect(cal.calibratedVolatilityPct!).toBeLessThanOrEqual(32);
        expect(cal.calibratedReturnTiltPp).not.toBeNull();
        expect(cal.calibratedReturnTiltPp!).toBeGreaterThanOrEqual(-2);
        expect(cal.calibratedReturnTiltPp!).toBeLessThanOrEqual(2);
        expect(cal.realizedNetWorthDeltaCad).not.toBeNull();
        expect(cal.monthlyPoints.length).toBe(22);
        expect(cal.monthlyPoints[0].ym).toBe('2025-01');

        const simCal = toSimulationPastCurveCalibration(cal);
        expect(simCal).toBeDefined();
        expect(simCal!.monthsObserved).toBe(21);
        expect(Number.isFinite(simCal!.calibratedVolatilityPct)).toBe(true);
        expect(Number.isFinite(simCal!.calibratedReturnTiltPp)).toBe(true);
        expect(Number.isFinite(simCal!.mertonJumpScale)).toBe(true);
    });
});
