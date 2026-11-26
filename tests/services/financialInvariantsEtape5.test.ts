import { describe, it, expect } from 'vitest';
import { DEFAULT_PERSONA_ID, getPersonaOrDefault } from '../fixtures/testFixtures';
import { normalizeAppState } from '../../services/aiTools/appStateDefaults';
import { assetValueCad, computePresentNetWorth, computePresentTermes } from '../../services/portfolio';
import {
    calculateCeliRoom,
    calculateFiscalReport,
    calculateGrossFromNet,
} from '../../utils/tax';
import { buildSimulationParamsFromState } from '../../services/projection/buildSimulationParams';
import { calculateFutureProjection } from '../../services/projection';
import { computePastCurveCalibration } from '../../services/projection/pastCurveCalibration';
import type { AppState, Asset, Debt } from '../../types';

describe('[ETAPE-5] Invariants stricts des moteurs financiers', () => {
    it('identite comptable patrimoine net present (avoirs - dettes) et robustesse NaN/FX', () => {
        const state = normalizeAppState(getPersonaOrDefault(DEFAULT_PERSONA_ID).build());
        const fx = state.fxRates ?? { CAD: 1, USD: 1.37, EUR: 1.47 };
        const todayIso = '2026-11-26';

        const termes = computePresentTermes(
            state.initialBalances,
            state.transactions,
            state.assets,
            fx,
            state.debts,
            0,
            todayIso,
        );
        const nw = computePresentNetWorth(
            state.initialBalances,
            state.transactions,
            state.assets,
            fx,
            state.debts,
            0,
            todayIso,
        );

        expect(Number.isFinite(termes.avoirs)).toBe(true);
        expect(Number.isFinite(termes.dettes)).toBe(true);
        expect(Number.isFinite(nw)).toBe(true);
        expect(nw).toBeCloseTo(termes.avoirs - termes.dettes, 6);

        // Robustesse face aux entrées corrompues (zéro propagation NaN/Infinity)
        const corruptedAssets: Asset[] = [
            { symbol: 'BAD1', name: 'Bad 1', quantity: Number.NaN, currentPrice: 100, currency: 'CAD', performance: 0, dateBought: '2025-01-01' },
            { symbol: 'BAD2', name: 'Bad 2', quantity: 5, currentPrice: Number.POSITIVE_INFINITY, currency: 'USD', performance: 0, dateBought: '2025-01-01' },
        ];
        const corruptedDebts: Debt[] = [
            { id: 'd1', name: 'Dette NaN', balance: Number.NaN, interestRate: 5, minimumPayment: 100, category: 'Personal' },
        ];
        const corruptedNw = computePresentNetWorth({}, [], corruptedAssets, fx, corruptedDebts, 0, todayIso);
        expect(Number.isFinite(corruptedNw)).toBe(true);

        // Homogénéité FX : doubler USD double uniquement la valeur CAD des actifs USD
        const usdAsset: Asset = { symbol: 'AAPL', name: 'Apple', quantity: 2, currentPrice: 100, currency: 'USD', performance: 0, dateBought: '2025-01-01' };
        const cadAsset: Asset = { symbol: 'VFV.TO', name: 'Vanguard', quantity: 2, currentPrice: 100, currency: 'CAD', performance: 0, dateBought: '2025-01-01' };
        const valUsd1 = assetValueCad(usdAsset, { USD: 1.25 });
        const valUsd2 = assetValueCad(usdAsset, { USD: 2.5 });
        expect(valUsd2).toBeCloseTo(valUsd1 * 2, 6);
        expect(assetValueCad(cadAsset, { USD: 1.25 })).toBe(assetValueCad(cadAsset, { USD: 2.5 }));
    });

    it('monotonie et coherence fiscale QC/CA 2026 (impot croissant, REER/CELIAPP, aller-retour net<->brut, CELI)', () => {
        let prevTax = -1;
        for (let gross = 0; gross <= 300_000; gross += 5_000) {
            const rep = calculateFiscalReport(gross, 0, 0, 2026);
            expect(Number.isFinite(rep.totalTax)).toBe(true);
            expect(Number.isFinite(rep.netIncome)).toBe(true);
            expect(rep.netIncome).toBeGreaterThanOrEqual(0);
            expect(rep.averageRate).toBeGreaterThanOrEqual(0);
            expect(rep.averageRate).toBeLessThanOrEqual(55);
            expect(rep.totalTax).toBeGreaterThanOrEqual(prevTax - 1e-6);
            prevTax = rep.totalTax;
        }

        // Déduction REER + CELIAPP réduit strictement l'impôt pour un revenu imposable significatif
        const sansDeduction = calculateFiscalReport(110_000, 0, 0, 2026);
        const avecReerCeliapp = calculateFiscalReport(110_000, 10_000, 8_000, 2026);
        expect(avecReerCeliapp.totalTax).toBeLessThan(sansDeduction.totalTax);

        // Aller-retour calculateGrossFromNet ↔ calculateFiscalReport
        for (const targetNet of [40_000, 75_000, 120_000]) {
            const gross = calculateGrossFromNet(targetNet, 2026);
            const rep = calculateFiscalReport(gross, 0, 0, 2026);
            expect(Math.abs(rep.netIncome - targetNet)).toBeLessThan(25);
        }

        // Droits CELI croissants selon l'ancienneté au Canada
        const celiRecent = calculateCeliRoom(1990, 2023, 2026);
        const celiAncien = calculateCeliRoom(1990, 2012, 2026);
        expect(celiAncien).toBeGreaterThan(celiRecent);
    });

    it('invariants projection & Monte Carlo : P10 <= P50 <= P90, valeurs finies et dossier vide sans crash', () => {
        const state = normalizeAppState(getPersonaOrDefault(DEFAULT_PERSONA_ID).build());
        const params = buildSimulationParamsFromState(state, { startYear: 2026, startMonth: 10, now: new Date('2026-11-26T12:00:00Z') });
        params.projection = { ...params.projection, monteCarloIterations: 100 };

        const res = calculateFutureProjection(params, true);
        expect(res.chartData.length).toBeGreaterThan(10);

        for (const pt of res.chartData) {
            expect(Number.isFinite(pt.NetWorth)).toBe(true);
            if (typeof pt.P10 === 'number' && typeof pt.P50 === 'number' && typeof pt.P90 === 'number') {
                expect(pt.P10).toBeLessThanOrEqual(pt.P50 + 1e-6);
                expect(pt.P50).toBeLessThanOrEqual(pt.P90 + 1e-6);
            }
        }

        // Dossier complètement vide → zéro exception et zéro NaN
        const emptyState: AppState = {
            ...state,
            transactions: [],
            assets: [],
            debts: [],
            realEstateGoals: [],
            childGoals: [],
            travelGoals: [],
            lifeEvents: [],
            initialBalances: {},
            budgetItems: [],
            config: {
                ...state.config,
                users: [
                    { ...state.config.users[0], grossSalary: 0, netSalary: 0, age: 35 },
                ] as unknown as AppState['config']['users'],
            },
        };
        const emptyParams = buildSimulationParamsFromState(emptyState, { startYear: 2026, startMonth: 10 });
        const emptyRes = calculateFutureProjection(emptyParams, false);
        expect(emptyRes.chartData.length).toBeGreaterThan(0);
        for (const pt of emptyRes.chartData) {
            expect(Number.isFinite(pt.NetWorth)).toBe(true);
        }
    });

    it('calibrage passe depuis janvier 2025 : null honnete sans historique reel (zero fausse donnee)', () => {
        const res = computePastCurveCalibration({
            assets: [],
            transactions: [],
            debts: [],
            realEstateGoals: [],
            fxRates: { CAD: 1, USD: 1.37 },
            referenceDateIso: '2026-11-26',
        });

        expect(res.hasUsableCurve).toBe(false);
        expect(res.realizedAnnualizedReturnPct).toBeNull();
        expect(res.realizedAnnualizedVolatilityPct).toBeNull();
    });
});
