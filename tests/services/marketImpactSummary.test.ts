import { describe, it, expect } from 'vitest';
import { computeMarketImpactSummary } from '../../services/marketImpactSummary';
import type { ProjectionResult, ProjectionChartPoint } from '../../services/projection/types';

function makeProjection(months = 240, retiredMonth = 180): ProjectionResult {
    const chartData: ProjectionChartPoint[] = [
        {
            name: '2026',
            monthIndex: 0,
            year: 2026,
            age: 40,
            NetWorth: 250_000,
            Liquidites: 20_000,
            CELI: 100_000,
            REER: 130_000,
            NonReg: 0,
            Immobilier: 0,
            DettesNonImmo: 0,
        },
        {
            name: '2041',
            monthIndex: retiredMonth,
            year: 2041,
            age: 55,
            isRetired: true,
            NetWorth: 900_000,
            Liquidites: 30_000,
            CELI: 350_000,
            REER: 520_000,
            NonReg: 0,
            Immobilier: 0,
            DettesNonImmo: 0,
        },
        {
            name: '2046',
            monthIndex: months,
            year: 2046,
            age: 60,
            NetWorth: 1_100_000,
            Liquidites: 30_000,
            CELI: 450_000,
            REER: 620_000,
            NonReg: 0,
            Immobilier: 0,
            DettesNonImmo: 0,
        },
    ];
    return {
        scenarioId: 'base',
        scenarioName: 'Trajectoire réelle',
        chartData,
        finalNetWorth: 1_100_000,
        fireNumber: 1_200_000,
        fireAge: 55,
        estateNetWorth: 950_000,
        estateTax: 150_000,
        finalLiquidAssets: 1_100_000,
    };
}

describe('computeMarketImpactSummary', () => {
    it('retourne null (no-fake-data) sans placements ou sans projection valide', () => {
        const empty = computeMarketImpactSummary({
            assets: [],
            fxRates: {},
            lastProjection: makeProjection(),
        });
        expect(empty.hasMarketData).toBe(false);
        expect(empty.impact5yCad).toBeNull();
        expect(empty.horizonImpactCad).toBeNull();
        expect(empty.retirementMonthsDelta).toBeNull();
        expect(empty.direction).toBe('neutre');

        const noProj = computeMarketImpactSummary({
            assets: [
                {
                    name: 'XEQT',
                    symbol: 'XEQT.TO',
                    accountType: 'CELI',
                    quantity: 1000,
                    currentPrice: 30,
                    performance: 6,
                    dateBought: '2025-01-01',
                    currency: 'CAD',
                },
            ],
            fxRates: {},
            lastProjection: null,
        });
        expect(noProj.hasMarketData).toBe(false);
        expect(noProj.impact5yCad).toBeNull();
    });

    it('calcule un impact positif sur 5 ans, horizon et mois de retraite quand les signaux sont porteurs', () => {
        const res = computeMarketImpactSummary({
            assets: [
                {
                    name: 'XEQT',
                    symbol: 'XEQT.TO',
                    accountType: 'CELI',
                    quantity: 2000,
                    currentPrice: 50,
                    performance: 8,
                    dateBought: '2025-01-01',
                    currency: 'CAD',
                },
            ],
            fxRates: {},
            lastProjection: makeProjection(),
            newsBundle: {
                collectedAtIso: '2026-11-26T12:00:00.000Z',
                liveArticlesUsed: 3,
                offlineFallbackUsed: false,
                portfolioSentimentScore: 0.4,
                portfolioSentimentLabel: 'Contexte porteur',
                annualizedReturnAdjustmentPct: 0.8,
                volatilityMultiplier: 0.95,
                macroHeadlineFr: 'Baisse graduelle des taux.',
                keySignals: [],
                aiSynthesisFr: null,
                usedGemini: false,
            },
            baseReturnRatePct: 6.0,
            retirementGoal: { targetMonthlyIncome: 4_000 },
        });

        expect(res.hasMarketData).toBe(true);
        expect(res.portfolioValueCad).toBe(100_000);
        expect(res.annualShiftPct).toBe(0.8);
        expect(res.direction).toBe('positif');
        expect(res.impact5yCad).toBeGreaterThan(0);
        expect(res.horizonImpactCad).toBeGreaterThan(res.impact5yCad!);
        expect(res.retirementMonthsDelta).toBeGreaterThan(0);
    });

    it('reflète un ajustement négatif en impact CAD négatif et direction risque', () => {
        const res = computeMarketImpactSummary({
            assets: [
                {
                    name: 'VFV',
                    symbol: 'VFV.TO',
                    accountType: 'REER',
                    quantity: 1000,
                    currentPrice: 120,
                    performance: 9,
                    dateBought: '2025-01-01',
                    currency: 'USD',
                },
            ],
            fxRates: { USD: 1.35 },
            lastProjection: makeProjection(),
            pastCalibration: {
                windowStartIso: '2025-01-01',
                monthsObserved: 12,
                calibratedVolatilityPct: 18,
                calibratedReturnTiltPp: -1.4,
                mertonJumpScale: 1.1,
            },
            baseReturnRatePct: 6.5,
            retirementGoal: { targetMonthlyIncome: 4_000 },
        });

        expect(res.hasMarketData).toBe(true);
        expect(res.direction).toBe('risque');
        expect(res.impact5yCad).toBeLessThan(0);
        expect(res.horizonImpactCad).toBeLessThan(0);
        expect(res.retirementMonthsDelta).toBeLessThan(0);
    });
});
