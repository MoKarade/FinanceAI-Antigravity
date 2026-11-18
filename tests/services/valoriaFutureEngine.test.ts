import { describe, expect, it } from 'vitest';
import { normalizeAppState } from '../../mcp/state/loadAppState';
import { calculateFutureProjection } from '../../services/projection';
import { buildSimulationParamsFromState } from '../../services/projection/buildSimulationParams';
import { computeGlidepathRates } from '../../services/projection/glidepathRates';
import { computeValoriaFutureForecast } from '../../services/projection/valoriaFutureEngine';
import { TEST_PERSONAS } from '../../services/testPersonas';
import type { Asset } from '../../types';

const FX_TEST: Record<string, number> = { CAD: 1, USD: 1.4181, EUR: 1.5839 };

const SAMPLE_ASSETS: Asset[] = [
    {
        symbol: 'XEQT',
        name: 'iShares Core Equity ETF Portfolio',
        quantity: 600,
        buyPrice: 28,
        currentPrice: 36,
        currency: 'CAD',
        accountType: 'CELI',
        sector: 'FNB Mondial',
        performance: 14.5,
        dateBought: '2024-02-01',
    },
    {
        symbol: 'VFV',
        name: 'Vanguard S&P 500 Index ETF',
        quantity: 250,
        buyPrice: 105,
        currentPrice: 145,
        currency: 'CAD',
        accountType: 'CELI',
        sector: 'Actions US',
        performance: 18.2,
        dateBought: '2024-03-01',
    },
    {
        symbol: 'MSFT',
        name: 'Microsoft Corp',
        quantity: 80,
        buyPrice: 340,
        currentPrice: 430,
        currency: 'USD',
        accountType: 'REER',
        sector: 'Technologie',
        performance: 21.0,
        dateBought: '2024-01-15',
    },
    {
        symbol: 'RY.TO',
        name: 'Banque Royale du Canada',
        quantity: 140,
        buyPrice: 130,
        currentPrice: 175,
        currency: 'CAD',
        accountType: 'NON-ENREG',
        sector: 'Finance',
        performance: 12.1,
        dateBought: '2023-11-10',
    },
    {
        symbol: 'XBB',
        name: 'iShares Core Canadian Universe Bond',
        quantity: 500,
        buyPrice: 27,
        currentPrice: 28.5,
        currency: 'CAD',
        accountType: 'REER',
        sector: 'Obligations',
        performance: 4.1,
        dateBought: '2024-05-01',
    },
    {
        symbol: 'BTC',
        name: 'Bitcoin',
        quantity: 0.25,
        buyPrice: 60000,
        currentPrice: 120000,
        currency: 'CAD',
        accountType: 'CRYPTO',
        sector: 'Crypto',
        performance: 45.0,
        dateBought: '2024-04-01',
    },
];

describe('valoriaFutureEngine — prévisions multi-horizon & intégration Futur', () => {
    it('produit des nombres strictement finis sur portefeuille vide, mono-titre USD et multi-enveloppes', () => {
        const emptyRes = computeValoriaFutureForecast({
            assets: [],
            fxRates: FX_TEST,
            horizonYears: 30,
        });
        expect(emptyRes.totalEvaluatedCad).toBe(0);
        expect(emptyRes.holdings).toHaveLength(0);
        expect(emptyRes.schedule.celiRatesByYear.every(Number.isFinite)).toBe(true);

        const singleUsd = computeValoriaFutureForecast({
            assets: [SAMPLE_ASSETS[2]],
            fxRates: FX_TEST,
            horizonYears: 25,
        });
        expect(singleUsd.totalEvaluatedCad).toBeGreaterThan(0);
        expect(singleUsd.holdings).toHaveLength(1);
        expect(Number.isFinite(singleUsd.projectedPortfolioCad.y10.p50)).toBe(true);

        const multi = computeValoriaFutureForecast({
            assets: SAMPLE_ASSETS,
            fxRates: FX_TEST,
            horizonYears: 30,
        });
        expect(multi.holdings).toHaveLength(SAMPLE_ASSETS.length);
        expect(multi.projectedPortfolioCad.y5.p10).toBeLessThanOrEqual(multi.projectedPortfolioCad.y5.p50);
        expect(multi.projectedPortfolioCad.y5.p50).toBeLessThanOrEqual(multi.projectedPortfolioCad.y5.p90);
        expect(multi.projectedPortfolioCad.y10.p10).toBeLessThanOrEqual(multi.projectedPortfolioCad.y10.p50);
        expect(multi.projectedPortfolioCad.y10.p50).toBeLessThanOrEqual(multi.projectedPortfolioCad.y10.p90);
        for (const r of multi.schedule.celiRatesByYear) expect(Number.isFinite(r)).toBe(true);
        for (const r of multi.schedule.reerRatesByYear) expect(Number.isFinite(r)).toBe(true);
        for (const r of multi.schedule.nonRegRatesByYear) expect(Number.isFinite(r)).toBe(true);
        for (const r of multi.schedule.cryptoRatesByYear) expect(Number.isFinite(r)).toBe(true);
    });

    it('applique la convergence exponentielle anti-bulle (écart an 20 vs an 0 vers l’équilibre)', () => {
        const res = computeValoriaFutureForecast({
            assets: SAMPLE_ASSETS,
            fxRates: FX_TEST,
            horizonYears: 30,
        });
        // Aux années 20+, l'alpha court terme a pratiquement disparu (exp(-0.38*20) < 0.001)
        const celiY0 = res.schedule.celiRatesByYear[0];
        const celiY20 = res.schedule.celiRatesByYear[20];
        const celiY30 = res.schedule.celiRatesByYear[30];
        expect(Math.abs(celiY30 - celiY20)).toBeLessThanOrEqual(0.05);
        expect(celiY20).toBeLessThanOrEqual(9.5);
        expect(celiY0).toBeGreaterThanOrEqual(-8.0);
        // Sans explosion à 30 ans : an 20 est strictement plus proche de l'an 30 que l'an 0 ne l'est
        expect(Math.abs(celiY20 - celiY30)).toBeLessThanOrEqual(Math.abs(celiY0 - celiY30) + 1e-6);
    });

    it('applique la retenue US 15 % exactement 1 fois en CELI et 0 % en REER via computeGlidepathRates', () => {
        const vfvCeliOnly: Asset = { ...SAMPLE_ASSETS[1], accountType: 'CELI' };
        const vfvReerOnly: Asset = { ...SAMPLE_ASSETS[1], accountType: 'REER' };

        const celiForecast = computeValoriaFutureForecast({ assets: [vfvCeliOnly], fxRates: FX_TEST, horizonYears: 20 });
        const reerForecast = computeValoriaFutureForecast({ assets: [vfvReerOnly], fxRates: FX_TEST, horizonYears: 20 });

        expect(celiForecast.schedule.usShareCeliPct).toBeCloseTo(100, 1);
        expect(celiForecast.schedule.usDivYieldCeliPct).toBeGreaterThan(0);
        expect(reerForecast.schedule.usShareCeliPct).toBe(0);

        const base = {
            celi: celiForecast.schedule.celiRatesByYear[0],
            reer: celiForecast.schedule.celiRatesByYear[0],
            nonReg: 6.4,
            crypto: 7.7,
            cash: 2.7,
        };
        const glideWithDrag = computeGlidepathRates({
            m: 0,
            retirementMonthIndex: 300,
            isRetired: false,
            simInflation: 2.1,
            enableMonteCarlo: false,
            mcCeliRate: base.celi,
            mcReerRate: base.reer,
            mcNonRegRate: base.nonReg,
            mcCryptoRate: base.crypto,
            mcCashRate: base.cash,
            baseRates: base,
            usEquityShareCeli: celiForecast.schedule.usShareCeliPct,
            usEquityDividendYield: celiForecast.schedule.usDivYieldCeliPct,
        });
        const glideNoDrag = computeGlidepathRates({
            m: 0,
            retirementMonthIndex: 300,
            isRetired: false,
            simInflation: 2.1,
            enableMonteCarlo: false,
            mcCeliRate: base.celi,
            mcReerRate: base.reer,
            mcNonRegRate: base.nonReg,
            mcCryptoRate: base.crypto,
            mcCashRate: base.cash,
            baseRates: base,
            usEquityShareCeli: 0,
            usEquityDividendYield: celiForecast.schedule.usDivYieldCeliPct,
        });

        expect(glideWithDrag.effectiveCeliRate).toBeLessThan(glideNoDrag.effectiveCeliRate);
        expect(glideNoDrag.effectiveCeliRate - glideWithDrag.effectiveCeliRate).toBeCloseTo(
            (celiForecast.schedule.usDivYieldCeliPct * 0.15),
            2,
        );
    });

    it('exécute calculateFutureProjection en mode valoria_agents (déterministe + Monte Carlo) sans refus ni NaN', () => {
        const persona = normalizeAppState(TEST_PERSONAS.find((p) => p.id === 'couple-confort')!.build());
        const stateWithValoria = {
            ...persona,
            assets: SAMPLE_ASSETS,
            projection: {
                ...persona.projection,
                returnAssumptionsMode: 'valoria_agents' as const,
            },
        };

        const params = buildSimulationParamsFromState(stateWithValoria, { startYear: 2026, startMonth: 0 });
        expect(params.valoriaSchedule).toBeDefined();
        expect(params.entreesRefusees ?? []).toHaveLength(0);

        const detRes = calculateFutureProjection(params, false, 0);
        expect(detRes.chartData.length).toBeGreaterThan(100);
        for (const pt of detRes.chartData) {
            expect(Number.isFinite(pt.NetWorth)).toBe(true);
        }

        const mcRes = calculateFutureProjection(params, true, 0);
        expect(mcRes.chartData.length).toBeGreaterThan(100);
        for (const pt of mcRes.chartData) {
            expect(Number.isFinite(pt.NetWorth)).toBe(true);
        }
    });

    it('préserve la parité exacte en omettant valoriaSchedule pour custom, iqpf et real_holdings', () => {
        const persona = normalizeAppState(TEST_PERSONAS.find((p) => p.id === 'couple-confort')!.build());
        for (const mode of ['custom', 'iqpf', 'real_holdings'] as const) {
            const p = buildSimulationParamsFromState(
                { ...persona, projection: { ...persona.projection, returnAssumptionsMode: mode } },
                { startYear: 2026, startMonth: 0 },
            );
            expect('valoriaSchedule' in p).toBe(false);
        }
    });
});
