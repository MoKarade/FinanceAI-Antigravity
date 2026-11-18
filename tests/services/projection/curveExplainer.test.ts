import { describe, it, expect, vi } from 'vitest';
import {
    buildCurveExplanations,
    explainPointAtMonth,
    type CurveExplanationBreakdown,
    type CurveInflectionExplanation,
    type ExplanationSegment,
} from '../../../services/projection/curveExplainer';
import { __runScenarioForTests as runScenario, type SimulationParams } from '../../../services/projection';
import { buildDailyLedger } from '../../../services/projection/dailyLedger';
import type { GrandCalculResult, ProjectionChartPoint } from '../../../services/projection/types';
import * as errorLogger from '../../../services/errorLogger';
import type { BudgetConfig, ProjectionConfig, RetirementGoal } from '../../../types';

const makeFullPoint = (
    overrides: Partial<ProjectionChartPoint> & { monthIndex: number },
): ProjectionChartPoint => ({
    year: 2026 + Math.floor(overrides.monthIndex / 12),
    age: 45 + Math.floor(overrides.monthIndex / 12),
    dateLabel: 'Jan 2026',
    NetWorth: 250_000,
    diffNW: 1500,
    isRetired: false,
    IncomeMarc: 4000,
    IncomeAnna: 3000,
    Income: 7000,
    IncomeRetirement: 0,
    RentalIncome: 0,
    childBenefits: 0,
    ReeePayout: 0,
    Expenses: 4500,
    ContribCELI: 500,
    ContribREER: 600,
    ContribNonReg: 200,
    ReeeContrib: 0,
    NetTransferCELIAPP: 0,
    NetTransferCELI: 500,
    NetTransferNonReg: 200,
    NetTransferCrypto: 0,
    MarketGrowthCELI: 300,
    MarketGrowthREER: 400,
    MarketGrowthNonReg: 100,
    MarketGrowthCrypto: 0,
    MarketGrowthLiquid: 20,
    MarketGrowthCELIAPP: 0,
    MarketGrowthREEE: 0,
    RetraitREER: 0,
    RetraitCELI: 0,
    pensionRRQ: 0,
    pensionPSV: 0,
    pensionPrivee: 0,
    FluxImpots: 0,
    ImpotRetraitREER: 0,
    ImpotSalaireMois: 0,
    ImpotGainsCap: 0,
    ImpotDivers: 0,
    marginalTaxRate: 37.1,
    effectiveTaxRate: 24.5,
    ImpotLatent: -32_000,
    CELI: 80_000,
    REER: 120_000,
    NonReg: 30_000,
    Crypto: 0,
    CELIAPP: 0,
    Liquidites: 20_000,
    DetteTotale: 0,
    DettesNonImmo: 0,
    LiquidDebt: 0,
    Immobilier: 0,
    FireTarget: 1_200_000,
    WithheldTaxRrif: 0,
    lifeEvents: [],
    flowEvents: [],
    ...overrides,
});

const makeGrandCalcul = (overrides: Partial<GrandCalculResult> = {}): GrandCalculResult => ({
    version: 1,
    paramsSig: 'sig-test-m3',
    createdAt: '2026-11-17T00:00:00.000Z',
    durationMs: 1200,
    iterationsRun: 50_000,
    regimesEnabled: true,
    historicalCrisesEnabled: true,
    survivalRatePct: 94.5,
    cvar95: 45_000,
    monthlyBands: [
        { monthIndex: 0, year: 2026, age: 45, p5: 200_000, p10: 215_000, p25: 230_000, p50: 250_000, p75: 270_000, p90: 290_000, p95: 305_000 },
        { monthIndex: 12, year: 2027, age: 46, p5: 220_000, p10: 235_000, p25: 255_000, p50: 280_000, p75: 305_000, p90: 330_000, p95: 350_000 },
    ],
    fiAge: {
        reachedPct: 88,
        p5Age: 53,
        p50Age: 58,
        p95Age: 64,
        horizonAge: 90,
    },
    goalProbabilities: [
        {
            goalId: 'g1',
            name: 'Mise de fonds',
            deadline: '2028-06',
            targetAmount: 60_000,
            probabilityPct: 84,
            medianShortfall: 3500,
            status: 'evaluated',
        },
    ],
    guaranteedPurchasingPower: {
        p95SecurityMonthlyNetReal: 4100,
        p90SecurityMonthlyNetReal: 4450,
        p50SecurityMonthlyNetReal: 5200,
        retirementMonthsEvaluated: 300,
    },
    estateTax: {
        deterministicTotal: 78_000,
        deterministicFed: 34_000,
        deterministicQc: 44_000,
        mcTotalP5: 42_000,
        mcTotalP50: 82_500,
        mcTotalP95: 135_000,
        mcFedP50: 36_000,
        mcQcP50: 46_500,
        mcRealTotalP50: 54_000,
        taxableBreakdown: {
            rrspRrif: 180_000,
            capitalGainsTaxable: 45_000,
            rentalRecapture: 0,
        },
        projectedDeathAge: 90,
    },
    ...overrides,
});

function assertPrivacyAndSegmentInvariants(items: ReadonlyArray<CurveInflectionExplanation>): void {
    for (const item of items) {
        expect(item.id).toBeTruthy();
        expect(item.titleFr.trim().length).toBeGreaterThan(0);
        expect(item.level1Segments.length).toBeGreaterThan(0);

        const fullText = item.level1Segments
            .filter((s): s is Extract<ExplanationSegment, { kind: 'text' }> => s.kind === 'text')
            .map((s) => s.text)
            .join('');
        expect(fullText.trim().endsWith('.')).toBe(true);

        for (const seg of item.level1Segments) {
            if (seg.kind === 'text') {
                expect(seg.text).not.toContain('$');
                expect(seg.text).not.toContain('%');
            } else {
                expect(seg.value).not.toBeNull();
                expect(Number.isFinite(seg.value)).toBe(true);
            }
        }

        for (const line of item.level2.fiscalDetails.rationaleFr) {
            expect(line).not.toContain('$');
        }
    }
}

describe('curveExplainer — cas limites, no-fake-data et points MC allégés', () => {
    it('retourne [] / null pour chartData vide, null, undefined, non fini ou uniquement passé', () => {
        expect(buildCurveExplanations(undefined)).toEqual([]);
        expect(buildCurveExplanations(null)).toEqual([]);
        expect(buildCurveExplanations([])).toEqual([]);
        expect(buildCurveExplanations([{ monthIndex: -3, NetWorth: 50_000 }])).toEqual([]);
        expect(buildCurveExplanations([{ monthIndex: 0, NetWorth: 50_000, dayIsReal: true }])).toEqual([]);
        expect(buildCurveExplanations([{ monthIndex: Number.NaN, NetWorth: 50_000 }])).toEqual([]);
        expect(buildCurveExplanations([{ monthIndex: 0, NetWorth: Number.POSITIVE_INFINITY }])).toEqual([]);

        expect(explainPointAtMonth(undefined, 0)).toBeNull();
        expect(explainPointAtMonth(null, 0)).toBeNull();
        expect(explainPointAtMonth([], 0)).toBeNull();
        expect(explainPointAtMonth([{ monthIndex: -1, NetWorth: 1000 }], -1)).toBeNull();
        expect(explainPointAtMonth([{ monthIndex: 0, NetWorth: 1000 }], Number.NaN)).toBeNull();
        expect(explainPointAtMonth([{ monthIndex: 0, NetWorth: 1000 }], 5)).toBeNull();
    });

    it('gère les points MC allégés ({ monthIndex, NetWorth }) sans inventer de 0 ni planter', () => {
        const mcPoints: ProjectionChartPoint[] = [
            { monthIndex: 0, NetWorth: 250_000 },
            { monthIndex: 6, NetWorth: 265_000 },
            { monthIndex: 12, NetWorth: 200_000 }, // choc -24.5% -> événement
            { monthIndex: 24, NetWorth: 240_000 },
        ];

        const logSpy = vi.spyOn(errorLogger, 'logErrorThrottled');
        const res = buildCurveExplanations(mcPoints);
        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();

        expect(res.length).toBeGreaterThanOrEqual(2);
        assertPrivacyAndSegmentInvariants(res);

        const first = res[0];
        const b: CurveExplanationBreakdown = first.level2;
        expect(b.accumulationFlows.employmentAndBusinessNet).toBeNull();
        expect(b.accumulationFlows.contributionsTotal).toBeNull();
        expect(b.accumulationFlows.investmentGrowth).toBeNull();
        expect(b.decaissementFlows.livingExpenses).toBeNull();
        expect(b.decaissementFlows.pensionsGross).toBeNull();
        expect(b.decaissementFlows.withdrawalsTotal).toBeNull();
        expect(b.fiscalDetails.incomeTaxTotal).toBeNull();
        expect(b.fiscalDetails.marginalTaxRatePct).toBeNull();
        expect(b.fiscalDetails.effectiveTaxRatePct).toBeNull();
        expect(b.fiscalDetails.oasClawback).toBeNull();
        expect(b.fiscalDetails.rrifMinimumRatePct).toBeNull();
        expect(b.fiscalDetails.latentTaxTotal).toBeNull();

        // Enrichissement year/age depuis grandCalcul.monthlyBands sans inventer les flux
        const enriched = explainPointAtMonth(mcPoints, 12, makeGrandCalcul());
        expect(enriched).not.toBeNull();
        expect(enriched!.year).toBe(2027);
        expect(enriched!.age).toBe(46);
        expect(enriched!.category).toBe('evenement');
        expect(enriched!.level2.accumulationFlows.contributionsTotal).toBeNull();
    });
});

describe('curveExplainer — mapping exact Niveau 2 et gardes fiscaux', () => {
    it('évite le double-comptage FluxImpots en avril et normalise ImpotLatent négatif en positif', () => {
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({
                monthIndex: 0,
                IncomeMarc: 4000,
                IncomeAnna: 3000,
                Income: 7800, // +800 revenu entreprise/W5 actif
                RentalIncome: 0,
                ContribCELI: 500,
                ContribREER: 600,
                ContribNonReg: 200,
                ReeeContrib: 100,
                NetTransferCELIAPP: 250,
                FluxImpots: 0,
                ImpotRetraitREER: 300,
                ImpotSalaireMois: 0,
                ImpotGainsCap: 50,
                ImpotDivers: 0,
                ImpotLatent: -45_678.9,
            }),
            makeFullPoint({
                monthIndex: 3, // avril
                FluxImpots: 8400,
                ImpotRetraitREER: 1400,
                ImpotGainsCap: 1000,
                TaxPaidREER: 1400,
                TaxPaidGains: 1000,
                ImpotLatent: -46_000,
            }),
            makeFullPoint({ monthIndex: 4 }),
        ];

        const m0 = explainPointAtMonth(cd, 0)!;
        expect(m0.level2.accumulationFlows.employmentAndBusinessNet).toBe(7800);
        expect(m0.level2.accumulationFlows.contributionsTotal).toBe(1650);
        expect(m0.level2.accumulationFlows.investmentGrowth).toBe(820);
        expect(m0.level2.fiscalDetails.incomeTaxTotal).toBe(350);
        expect(m0.level2.fiscalDetails.latentTaxTotal).toBe(45_678.9);
        expect(m0.level2.fiscalDetails.marginalTaxRatePct).toBe(37.1);
        expect(m0.level2.fiscalDetails.effectiveTaxRatePct).toBe(24.5);

        const april = explainPointAtMonth(cd, 3)!;
        // Doit valoir 8400 (FluxImpots) et JAMAIS 8400 + 1400 + 1000
        expect(april.level2.fiscalDetails.incomeTaxTotal).toBe(8400);
        expect(april.category).toBe('evenement');
    });

    it('calcule oasClawback sans faux positif de bruit d’arrondi et retourne null si un champ manque', () => {
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({
                monthIndex: 0,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1200,
                pensionPSV: 750,
                pensionPrivee: 1500,
                IncomeRetirement: 3449.97, // bruit d'arrondi 0.03 <= 0.05 -> 0
            }),
            makeFullPoint({
                monthIndex: 1,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1200,
                pensionPSV: 750,
                pensionPrivee: 2500,
                IncomeRetirement: 4150, // clawback mensuel = 4450 - 4150 = 300
            }),
            makeFullPoint({
                monthIndex: 2,
                isRetired: true,
                pensionRRQ: 1200,
                pensionPSV: undefined,
                pensionPrivee: 1500,
                IncomeRetirement: 2700,
            }),
        ];

        const p0 = explainPointAtMonth(cd, 0)!;
        expect(p0.level2.decaissementFlows.pensionsGross).toBe(3450);
        expect(p0.level2.fiscalDetails.oasClawback).toBe(0);

        const p1 = explainPointAtMonth(cd, 1)!;
        expect(p1.category).toBe('pension');
        expect(p1.level2.fiscalDetails.oasClawback).toBe(300);

        const p2 = explainPointAtMonth(cd, 2)!;
        expect(p2.level2.fiscalDetails.oasClawback).toBeNull();
    });

    it('retrait CELI/NonReg/Crypto via max(RetraitCELI, -NetTransferCELI) et parts négatives', () => {
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({
                monthIndex: 0,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                RetraitREER: 1500,
                RetraitCELI: 200,
                NetTransferCELI: -600, // retrait objectif CELI
                NetTransferNonReg: -400,
                NetTransferCrypto: -150,
            }),
            makeFullPoint({ monthIndex: 1, isRetired: true, IncomeMarc: 0, IncomeAnna: 0 }),
        ];

        const p0 = explainPointAtMonth(cd, 0)!;
        expect(p0.level2.accumulationFlows.employmentAndBusinessNet).toBe(0);
        expect(p0.level2.decaissementFlows.withdrawalsTotal).toBe(2650);
    });
});

describe('curveExplainer — couverture des 8 catégories et sous-cas', () => {
    it('détecte accumulation (départ + extinction de dette) et retraite (avec garde déjà-actif)', () => {
        const cdActive: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, age: 58, isRetired: false, DetteTotale: 15_000 }),
            makeFullPoint({ monthIndex: 12, age: 59, isRetired: false, DetteTotale: 0 }),
            makeFullPoint({
                monthIndex: 24,
                age: 60,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                IncomeRetirement: 2800,
                pensionRRQ: 1100,
                pensionPSV: 0,
                pensionPrivee: 1700,
                RetraitREER: 1200,
                lifeEvents: ['📍 Début Retraite'],
            }),
            makeFullPoint({
                monthIndex: 36,
                age: 61,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                IncomeRetirement: 2800,
                pensionRRQ: 1100,
                pensionPrivee: 1700,
            }),
        ];

        const exps = buildCurveExplanations(cdActive, makeGrandCalcul());
        assertPrivacyAndSegmentInvariants(exps);

        expect(exps.map((e) => e.category)).toEqual(['accumulation', 'accumulation', 'retraite', 'succession']);
        expect(exps[1].titleFr).toContain('dettes');
        expect(exps[2].monthIndex).toBe(24);
        // Rente démarrée au même mois que la retraite consolidée (pas de doublon au mois 24)
        expect(exps.filter((e) => e.monthIndex === 24)).toHaveLength(1);

        // Garde déjà-actif : déjà retraité + RRQ + RetraitREER dès le mois 0
        const alreadyRetired: ProjectionChartPoint[] = [
            makeFullPoint({
                monthIndex: 0,
                age: 67,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1200,
                pensionPSV: 700,
                IncomeRetirement: 1900,
                RetraitREER: 1500,
            }),
            makeFullPoint({
                monthIndex: 12,
                age: 68,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1200,
                pensionPSV: 700,
                IncomeRetirement: 1900,
                RetraitREER: 1500,
            }),
        ];
        const retExps = buildCurveExplanations(alreadyRetired);
        expect(retExps[0].category).toBe('retraite');
        expect(retExps.some((e) => e.category === 'pension')).toBe(false);
    });

    it('détecte pension (RRQ, PSV, bonification 75 ans), ferr (71 conversion vs 72 retrait obligatoire) et succession', () => {
        const logSpy = vi.spyOn(errorLogger, 'logErrorThrottled');
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, age: 64, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, REER: 300_000 }),
            makeFullPoint({ monthIndex: 12, age: 65, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, pensionRRQ: 1200, IncomeRetirement: 1200, REER: 300_000 }),
            makeFullPoint({ monthIndex: 60, age: 69, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, pensionRRQ: 1200, pensionPSV: 850, IncomeRetirement: 2050, REER: 290_000 }),
            makeFullPoint({ monthIndex: 84, age: 71, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, pensionRRQ: 1200, pensionPSV: 850, IncomeRetirement: 2050, REER: 280_000 }),
            makeFullPoint({ monthIndex: 96, age: 72, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, pensionRRQ: 1200, pensionPSV: 850, IncomeRetirement: 2050, REER: 265_000, RetraitREER: 1200, WithheldTaxRrif: 250 }),
            makeFullPoint({ monthIndex: 132, age: 75, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, pensionRRQ: 1250, pensionPSV: 940, IncomeRetirement: 2190, REER: 210_000, RetraitREER: 1250 }),
            makeFullPoint({ monthIndex: 312, age: 90, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, pensionRRQ: 1400, pensionPSV: 1050, IncomeRetirement: 2450, REER: 40_000, ImpotLatent: -22_000 }),
        ];

        const exps = buildCurveExplanations(cd, makeGrandCalcul());
        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
        assertPrivacyAndSegmentInvariants(exps);

        const rrq = exps.find((e) => e.monthIndex === 12)!;
        expect(rrq.category).toBe('pension');

        const psv = exps.find((e) => e.monthIndex === 60)!;
        expect(psv.category).toBe('pension');

        const ferr71 = exps.find((e) => e.monthIndex === 84)!;
        expect(ferr71.category).toBe('ferr');
        expect(ferr71.level2.fiscalDetails.rrifMinimumRatePct).toBeNull();

        const ferr72 = exps.find((e) => e.monthIndex === 96)!;
        expect(ferr72.category).toBe('ferr');
        expect(ferr72.level2.fiscalDetails.rrifMinimumRatePct).toBe(5.4);

        const psv75 = exps.find((e) => e.monthIndex === 132)!;
        expect(psv75.category).toBe('pension');
        expect(psv75.titleFr).toContain('75');

        const succ = exps.find((e) => e.monthIndex === 312)!;
        expect(succ.category).toBe('succession');
        expect(succ.level2.fiscalDetails.latentTaxTotal).toBe(82_500);

        // Sans grandCalcul, repli sur Math.abs(ImpotLatent)
        const expsNoGc = buildCurveExplanations(cd);
        const succNoGc = expsNoGc.find((e) => e.monthIndex === 312)!;
        expect(succNoGc.level2.fiscalDetails.latentTaxTotal).toBe(22_000);
    });

    it('détecte objectif FIRE structurel sans faux positif « Fire pit reno », jalon objectif, événement et épuisement', () => {
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, NetWorth: 300_000, FireTarget: 900_000 }),
            makeFullPoint({
                monthIndex: 6,
                NetWorth: 310_000,
                FireTarget: 900_000,
                lifeEvents: ['Fire pit reno'],
            }),
            makeFullPoint({
                monthIndex: 12,
                NetWorth: 350_000,
                FireTarget: 910_000,
                Immobilier: 120_000,
                lifeEvents: ['🏠 Achat Condo : -60 000 $'],
            }),
            makeFullPoint({
                monthIndex: 24,
                year: 2028,
                NetWorth: 420_000,
                FireTarget: 920_000,
                flowEvents: ['🏆 But financier (Mise de fonds): -60 000 $'],
            }),
            makeFullPoint({
                monthIndex: 36,
                NetWorth: 960_000,
                FireTarget: 940_000,
            }),
            makeFullPoint({
                monthIndex: 48,
                isRetired: false,
                NetWorth: 650_000,
                FireTarget: 960_000,
                lifeEvents: ['📉 Choc Marché -25%'],
            }),
            makeFullPoint({
                monthIndex: 84,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                NetWorth: -12_000,
                LiquidDebt: 12_000,
                CELI: 0,
                REER: 0,
                NonReg: 0,
                Liquidites: 0,
            }),
            makeFullPoint({
                monthIndex: 120,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                NetWorth: -25_000,
                LiquidDebt: 25_000,
            }),
        ];

        const exps = buildCurveExplanations(cd, makeGrandCalcul());
        assertPrivacyAndSegmentInvariants(exps);

        // "Fire pit reno" ne déclenche ni FIRE ni faux événement
        expect(exps.find((e) => e.monthIndex === 6)).toBeUndefined();

        const immo = exps.find((e) => e.monthIndex === 12)!;
        expect(immo.category).toBe('evenement');

        const goal = exps.find((e) => e.monthIndex === 24)!;
        expect(goal.category).toBe('objectif');
        expect(goal.level1Segments.some((s) => s.kind === 'pct' && s.value === 84)).toBe(true);

        const fire = exps.find((e) => e.monthIndex === 36)!;
        expect(fire.category).toBe('objectif');
        expect(fire.level1Segments.some((s) => s.kind === 'age' && s.value === 58)).toBe(true);

        const krach = exps.find((e) => e.monthIndex === 48)!;
        expect(krach.category).toBe('evenement');

        const epuisement = exps.find((e) => e.monthIndex === 84)!;
        expect(epuisement.category).toBe('epuisement');

        const succ = exps.find((e) => e.monthIndex === 120)!;
        expect(succ.category).toBe('succession');
    });
});

describe('curveExplainer — déduplication quotidienne, points intermédiaires et intégration moteur', () => {
    it('déduplique les points quotidiens (préfère le point mensuel ou le dernier jour) et répond sur mois intermédiaires', () => {
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, NetWorth: 100_000 }),
            makeFullPoint({
                monthIndex: 1.5,
                hostMonthIndex: 1,
                isDailyPoint: true,
                dayIso: '2026-02-15',
                NetWorth: 101_000,
            }),
            makeFullPoint({
                monthIndex: 1,
                isDailyPoint: false,
                NetWorth: 102_000,
                ContribCELI: 700,
            }),
            makeFullPoint({
                monthIndex: 2.2,
                hostMonthIndex: 2,
                isDailyPoint: true,
                dayIso: '2026-03-07',
                NetWorth: 103_000,
            }),
            makeFullPoint({
                monthIndex: 2.8,
                hostMonthIndex: 2,
                isDailyPoint: true,
                dayIso: '2026-03-25',
                NetWorth: 104_500,
            }),
        ];

        const m1 = explainPointAtMonth(cd, 1)!;
        expect(m1.level2.accumulationFlows.contributionsTotal).toBe(1500);
        // Point intermédiaire non-inflexion -> synthétisé
        expect(m1.id).toBe('point-accumulation-1');

        // Mois 2 n'a que des points quotidiens -> préfère le dernier (NetWorth 104_500) et déduplique
        const exps = buildCurveExplanations(cd);
        expect(exps.filter((e) => e.monthIndex === 2)).toHaveLength(1);
        const m2 = explainPointAtMonth(cd, 2)!;
        expect(m2.category).toBe('succession');
        expect(m2.level1Segments.some((s) => s.kind === 'cad' && s.value === 104_500)).toBe(true);

        // Accès exact au point fractionnaire
        const m1Daily = explainPointAtMonth(cd, 1.5)!;
        expect(m1Daily.monthIndex).toBe(1.5);
    });

    it('intégration avec __runScenarioForTests sur une projection déterministe complète', () => {
        const projection: ProjectionConfig = {
            years: 25,
            returnRate: 6.5,
            inflationRate: 2.0,
            savingsMode: 'manual',
            manualContribution: 1500,
            usePortfolioRate: false,
            returnRates: { celi: 6.5, reer: 6.5, nonReg: 6.5, crypto: 0, cash: 2.5 },
            emergencyFundMonths: 3,
            salaryGrowth: 2.0,
            propertyGrowthRate: 3.0,
        };
        const config: BudgetConfig = {
            users: [
                {
                    name: 'ProfilTest',
                    grossSalary: 7500,
                    netSalary: 5000,
                    color: '#10b981',
                    age: 50,
                    birthYear: 1976,
                    canadaArrivalYear: 1976,
                    hasOwnedPropertyLast4Years: true,
                    celiContributed: 0,
                    rrspContributed: 0,
                },
            ],
            splitMode: '50/50',
        } as unknown as BudgetConfig;
        const retirementGoal: RetirementGoal = {
            targetAge: 65,
            targetMonthlyIncome: 4000,
            governmentPension: 1500,
            lifeExpectancy: 90,
        };
        const params: SimulationParams = {
            projection,
            calculatedStartingCash: 25_000,
            liveCSVBalances: { CELI: 90_000, CELIAPP: 0, REER: 220_000, NON_ENREG: 40_000, CRYPTO: 0, REEE: 0 },
            realEstateGoals: [],
            debts: [],
            childGoals: [],
            travelGoals: [],
            lifeEvents: [],
            retirementGoal,
            config,
            baseGrossAnnual: 90_000,
            baseNetAnnual: 60_000,
            currentRentExpense: 1500,
            baseMonthlyExpenses: 3200,
            startYear: 2026,
            startMonth: 0,
        };

        const sim = runScenario(params, 'AUTO_MARGINAL', false, false, 0, 'BASE');
        expect(sim.chartData.length).toBeGreaterThan(200);

        const explanations = buildCurveExplanations(sim.chartData);
        assertPrivacyAndSegmentInvariants(explanations);

        const categories = new Set(explanations.map((e) => e.category));
        expect(categories.has('accumulation')).toBe(true);
        expect(categories.has('retraite')).toBe(true);
        expect(categories.has('ferr')).toBe(true);
        expect(categories.has('succession')).toBe(true);

        // Ordre chronologique strict sans doublon sur un même monthIndex
        for (let i = 1; i < explanations.length; i++) {
            expect(explanations[i].monthIndex).toBeGreaterThan(explanations[i - 1].monthIndex);
        }

        // Vérification sur un mois intermédiaire quelconque du moteur
        const midPoint = explainPointAtMonth(sim.chartData, 60);
        expect(midPoint).not.toBeNull();
        expect(midPoint!.monthIndex).toBe(60);
        expect(midPoint!.level2.accumulationFlows.employmentAndBusinessNet).not.toBeNull();
    });

    it('protège rrifRateForAge contre âge NaN/Infinity et couvre le plateau FERR à 95 ans + clôture CELIAPP', () => {
        const logSpy = vi.spyOn(errorLogger, 'logErrorThrottled');
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, age: 70, REER: 100_000, isRetired: true, IncomeMarc: 0, IncomeAnna: 0 }),
            makeFullPoint({
                monthIndex: 6,
                age: Number.NaN,
                REER: 100_000,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                flowEvents: ['🏛️ CELIAPP: 71 ans atteint. Transfert vers REER.'],
            }),
            makeFullPoint({ monthIndex: 24, age: 95, REER: 50_000, RetraitREER: 800, isRetired: true, IncomeMarc: 0, IncomeAnna: 0 }),
            makeFullPoint({ monthIndex: 36, age: 96, REER: 40_000, isRetired: true, IncomeMarc: 0, IncomeAnna: 0 }),
        ];

        const exps = buildCurveExplanations(cd);
        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
        assertPrivacyAndSegmentInvariants(exps);

        const celiappEvt = explainPointAtMonth(cd, 6)!;
        expect(celiappEvt.category).toBe('evenement');
        expect(celiappEvt.level2.fiscalDetails.rrifMinimumRatePct).toBeNull();

        const plateau95 = exps.find((e) => e.monthIndex === 24)!;
        expect(plateau95.category).toBe('ferr');
        expect(plateau95.level2.fiscalDetails.rrifMinimumRatePct).toBe(20);
    });
});

describe('curveExplainer — régressions Itération 2 (quotidien, FERR, anti-spam, null-holes, phrasé)', () => {
    it('agrège les points quotidiens non triés (préserve événements jour 1, somme les flux, garde stocks du dernier jour, cohérence fractionnaire)', () => {
        const m0 = makeFullPoint({ monthIndex: 0, NetWorth: 100_000, Immobilier: 0, lifeEvents: [], flowEvents: [] });
        const m1 = makeFullPoint({
            monthIndex: 1,
            NetWorth: 180_000,
            Immobilier: 80_000,
            IncomeMarc: 4000,
            IncomeAnna: 3000,
            Income: 7000,
            Expenses: 3600,
            ContribCELI: 500,
            ContribREER: 600,
            ContribNonReg: 200,
            lifeEvents: ['🏠 Achat Premier Condo : -40 000 $'],
            flowEvents: [],
        });
        const m2 = makeFullPoint({
            monthIndex: 2,
            NetWorth: 185_000,
            Immobilier: 80_500,
            IncomeMarc: 4000,
            IncomeAnna: 3000,
            Income: 7000,
            Expenses: 3600,
            ContribCELI: 500,
            ContribREER: 600,
            ContribNonReg: 200,
            lifeEvents: [],
            flowEvents: [],
        });

        const dailyPoints = buildDailyLedger({
            months: [m0, m1, m2],
            startYear: 2026,
            startMonth: 0,
            dated: { recurring: [], monthlyNetSalary: 7000, monthlyDebtPayment: 0 },
        }).map((d) => ({
            ...d,
            monthIndex: d.hostMonthIndex + (d.dayOfMonth - 1) / 31,
        })) as ProjectionChartPoint[];

        // Inverser l'ordre dans le mois pour tester la résistance au tri
        const scrambled: ProjectionChartPoint[] = [
            m0,
            ...dailyPoints.slice().reverse(),
        ];

        const exps = buildCurveExplanations(scrambled);
        assertPrivacyAndSegmentInvariants(exps);

        // L'événement jour 1 '🏠 Achat Premier Condo' est préservé au mois 1 malgré l'ordre inversé
        const immo = exps.find((e) => e.monthIndex === 1)!;
        expect(immo.category).toBe('evenement');
        expect(immo.titleFr).toBe('Acquisition immobilière');
        expect(immo.level2.decaissementFlows.livingExpenses).toBe(3600);
        expect(immo.level2.accumulationFlows.contributionsTotal).toBe(1300);
        expect(immo.level1Segments.some((s) => s.kind === 'cad' && s.value === 80_000)).toBe(true);

        // explainPointAtMonth sur l'entier 1 agrège tout le mois 1 (identique au mensuel)
        const month1 = explainPointAtMonth(scrambled, 1)!;
        expect(month1.level2.decaissementFlows.livingExpenses).toBe(3600);
        expect(month1.level2.accumulationFlows.employmentAndBusinessNet).toBe(7000);

        // Points quotidiens non triés avec absent/undefined -> préserve null (jamais 0) et garde le dernier jour
        const unsortedWithMissing: ProjectionChartPoint[] = [
            { monthIndex: 0, NetWorth: 50_000 },
            { monthIndex: 2.8, hostMonthIndex: 2, isDailyPoint: true, NetWorth: 65_000, ContribCELI: 300 },
            { monthIndex: 2.2, hostMonthIndex: 2, isDailyPoint: true, NetWorth: 61_000, ContribCELI: 200 },
        ];
        const m2Agg = explainPointAtMonth(unsortedWithMissing, 2)!;
        expect(m2Agg.level1Segments.some((s) => s.kind === 'cad' && s.value === 65_000)).toBe(true);
        expect(m2Agg.level2.accumulationFlows.contributionsTotal).toBe(500);
        expect(m2Agg.level2.decaissementFlows.livingExpenses).toBeNull();
    });

    it('garantit la cohérence exacte Niveau 1 / Niveau 2 sur un point quotidien fractionnaire et sur les doublons mensuels', () => {
        // Point mensuel d'inflexion retraite au mois 1 + point quotidien fractionnaire 1.45 au même mois
        const cd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, isRetired: false, NetWorth: 300_000 }),
            makeFullPoint({
                monthIndex: 1.45,
                hostMonthIndex: 1,
                isDailyPoint: true,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 40,
                pensionPSV: 25,
                IncomeRetirement: 65,
                RetraitREER: 80,
                Expenses: 145,
                NetWorth: 301_000,
                lifeEvents: ['📍 Début Retraite'],
            }),
            makeFullPoint({
                monthIndex: 1.9,
                hostMonthIndex: 1,
                isDailyPoint: true,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1160,
                pensionPSV: 675,
                IncomeRetirement: 1835,
                RetraitREER: 1920,
                Expenses: 2855,
                NetWorth: 302_000,
                lifeEvents: [],
            }),
            makeFullPoint({
                monthIndex: 5,
                NetWorth: 110_000,
                ContribCELI: 500,
                ContribREER: 0,
                ContribNonReg: 0,
            }),
            makeFullPoint({
                monthIndex: 5,
                NetWorth: 999_999,
                ContribCELI: 9000,
                ContribREER: 0,
                ContribNonReg: 0,
            }),
        ];

        const dailyRet = explainPointAtMonth(cd, 1.45)!;
        expect(dailyRet.monthIndex).toBe(1.45);
        expect(dailyRet.category).toBe('retraite');
        // Les segments Niveau 1 doivent refléter rawExact (65, 80, 145) et JAMAIS les totaux mensuels (1900, 2000, 3000)
        const cads = dailyRet.level1Segments
            .filter((s): s is Extract<ExplanationSegment, { kind: 'cad' }> => s.kind === 'cad')
            .map((s) => s.value);
        expect(cads).toEqual([65, 80, 145]);
        expect(dailyRet.level2.decaissementFlows.pensionsGross).toBe(65);
        expect(dailyRet.level2.decaissementFlows.withdrawalsTotal).toBe(80);
        expect(dailyRet.level2.decaissementFlows.livingExpenses).toBe(145);

        // Doublon non-quotidien au mois 5 : buildCurveExplanations et explainPointAtMonth sélectionnent le même gagnant (999_999 / 9000)
        const exps = buildCurveExplanations(cd);
        const succ = exps.find((e) => e.monthIndex === 5)!;
        const at5 = explainPointAtMonth(cd, 5)!;
        expect(succ.level2.accumulationFlows.contributionsTotal).toBe(9000);
        expect(at5.level2.accumulationFlows.contributionsTotal).toBe(9000);
        expect(at5.level1Segments).toEqual(succ.level1Segments);
    });

    it('gère FERR en couple avec écart d’âge, REER épuisé à 72 ans, startMonth de juillet et repli age via monthlyBands', () => {
        // 1. Couple à écart d'âge (User0=52, User1=57, REER 900k) via le vrai moteur
        const paramsCouple: SimulationParams = {
            projection: {
                years: 25,
                returnRate: 6.0,
                inflationRate: 2.0,
                savingsMode: 'manual',
                manualContribution: 1000,
                usePortfolioRate: false,
                returnRates: { celi: 6.0, reer: 6.0, nonReg: 6.0, crypto: 0, cash: 2.0 },
                emergencyFundMonths: 3,
                salaryGrowth: 2.0,
                propertyGrowthRate: 3.0,
            },
            calculatedStartingCash: 20_000,
            liveCSVBalances: { CELI: 60_000, CELIAPP: 0, REER: 900_000, NON_ENREG: 20_000, CRYPTO: 0, REEE: 0 },
            realEstateGoals: [],
            debts: [],
            childGoals: [],
            travelGoals: [],
            lifeEvents: [],
            retirementGoal: { targetAge: 65, targetMonthlyIncome: 4500, governmentPension: 1500, lifeExpectancy: 90 },
            config: {
                users: [
                    { name: 'UserA', grossSalary: 7000, netSalary: 4800, color: '#10b981', age: 52, birthYear: 1974, canadaArrivalYear: 1974, hasOwnedPropertyLast4Years: true, celiContributed: 0, rrspContributed: 0 },
                    { name: 'UserB', grossSalary: 6000, netSalary: 4200, color: '#3b82f6', age: 57, birthYear: 1969, canadaArrivalYear: 1969, hasOwnedPropertyLast4Years: true, celiContributed: 0, rrspContributed: 0 },
                ],
                splitMode: '50/50',
            } as unknown as BudgetConfig,
            baseGrossAnnual: 156_000,
            baseNetAnnual: 108_000,
            currentRentExpense: 1500,
            baseMonthlyExpenses: 3500,
            startYear: 2026,
            startMonth: 0,
        };
        const simCouple = runScenario(paramsCouple, 'AUTO_MARGINAL', false, false, 0, 'BASE');
        const expsCouple = buildCurveExplanations(simCouple.chartData);
        assertPrivacyAndSegmentInvariants(expsCouple);

        const ferrEvents = expsCouple.filter((e) => e.category === 'ferr');
        expect(ferrEvents.some((e) => e.titleFr === 'Retrait minimum FERR du conjoint')).toBe(true);
        expect(ferrEvents.some((e) => e.titleFr === 'Conversion obligatoire REER vers FERR' && e.age === 71)).toBe(true);
        expect(ferrEvents.some((e) => e.titleFr === 'Premier retrait minimum FERR obligatoire' && e.age === 72)).toBe(true);

        // 2. REER épuisé à 72 ans avec log 'Brut 0,00 $' -> aucun FERR émis et rrifMinimumRatePct = null
        const depletedAt72: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, age: 71, isRetired: true, REER: 0, RetraitREER: 0, WithheldTaxRrif: 0 }),
            makeFullPoint({
                monthIndex: 12,
                age: 72,
                isRetired: true,
                REER: 0,
                RetraitREER: 0,
                WithheldTaxRrif: 0,
                flowEvents: ['🏦 FERR (per-conjoint): Brut 0,00 $ → Net 0,00 $ → Liquidités'],
            }),
            makeFullPoint({ monthIndex: 24, age: 73, isRetired: true, REER: 0, RetraitREER: 0, WithheldTaxRrif: 0 }),
        ];
        const expsDepleted = buildCurveExplanations(depletedAt72);
        assertPrivacyAndSegmentInvariants(expsDepleted);
        expect(expsDepleted.some((e) => e.category === 'ferr')).toBe(false);
        expect(explainPointAtMonth(depletedAt72, 12)!.level2.fiscalDetails.rrifMinimumRatePct).toBeNull();

        // 3. startMonth = 6 (juillet, âge 70) via le vrai moteur -> FERR en janv. 2029 (m=30), jamais en juill. 2028 (m=24)
        const paramsJuly: SimulationParams = {
            ...paramsCouple,
            projection: { ...paramsCouple.projection, years: 6 },
            liveCSVBalances: { CELI: 50_000, CELIAPP: 0, REER: 400_000, NON_ENREG: 10_000, CRYPTO: 0, REEE: 0 },
            retirementGoal: { targetAge: 65, targetMonthlyIncome: 3800, governmentPension: 1500, lifeExpectancy: 90 },
            config: {
                users: [
                    { name: 'UserSolo', grossSalary: 0, netSalary: 0, color: '#10b981', age: 70, birthYear: 1956, canadaArrivalYear: 1956, hasOwnedPropertyLast4Years: true, celiContributed: 0, rrspContributed: 0 },
                ],
                splitMode: '50/50',
            } as unknown as BudgetConfig,
            baseGrossAnnual: 0,
            baseNetAnnual: 0,
            startYear: 2026,
            startMonth: 6,
        };
        const simJuly = runScenario(paramsJuly, 'AUTO_MARGINAL', false, false, 0, 'BASE');
        const expsJuly = buildCurveExplanations(simJuly.chartData);
        assertPrivacyAndSegmentInvariants(expsJuly);
        const ferrJuly = expsJuly.find((e) => e.category === 'ferr' && e.titleFr.includes('retrait minimum'));
        expect(ferrJuly).toBeDefined();
        expect(ferrJuly!.monthIndex).toBe(30);

        // 4. Repli age depuis grandCalcul.monthlyBands pilote FERR et rrifMinimumRatePct
        const bandsOnlyPoints: ProjectionChartPoint[] = [
            { monthIndex: 0, NetWorth: 200_000, REER: 100_000 },
            { monthIndex: 12, NetWorth: 205_000, REER: 98_000 },
            { monthIndex: 24, NetWorth: 210_000, REER: 95_000, RetraitREER: 500 },
            { monthIndex: 36, NetWorth: 215_000, REER: 90_000 },
        ];
        const gcBands = makeGrandCalcul({
            monthlyBands: [
                { monthIndex: 0, year: 2026, age: 70, p5: 180_000, p10: 185_000, p25: 190_000, p50: 200_000, p75: 210_000, p90: 220_000, p95: 230_000 },
                { monthIndex: 12, year: 2027, age: 71, p5: 185_000, p10: 190_000, p25: 195_000, p50: 205_000, p75: 215_000, p90: 225_000, p95: 235_000 },
                { monthIndex: 24, year: 2028, age: 72, p5: 190_000, p10: 195_000, p25: 200_000, p50: 210_000, p75: 220_000, p90: 230_000, p95: 240_000 },
                { monthIndex: 36, year: 2029, age: 73, p5: 195_000, p10: 200_000, p25: 205_000, p50: 215_000, p75: 225_000, p90: 235_000, p95: 245_000 },
            ],
        });
        const expsBands = buildCurveExplanations(bandsOnlyPoints, gcBands);
        assertPrivacyAndSegmentInvariants(expsBands);
        const band71 = expsBands.find((e) => e.monthIndex === 12)!;
        const band72 = expsBands.find((e) => e.monthIndex === 24)!;
        expect(band71.category).toBe('ferr');
        expect(band71.titleFr).toContain('Conversion');
        expect(band72.category).toBe('ferr');
        expect(band72.level2.fiscalDetails.rrifMinimumRatePct).toBe(5.4);
        expect(explainPointAtMonth(bandsOnlyPoints, 24, gcBands)!.level2.fiscalDetails.rrifMinimumRatePct).toBe(5.4);
    });

    it('interdit tout segment value:null dans level1Segments, corrige oasClawback=0 si PSV=0 et garde les triplets estateTax atomiques', () => {
        // Points partiels : WithheldTaxRrif sans âge, soins avec Expenses=NaN, achat avec Immobilier=NaN
        const partialTriggers: ProjectionChartPoint[] = [
            { monthIndex: 0, NetWorth: 200_000 },
            { monthIndex: 1, NetWorth: 210_000, WithheldTaxRrif: 200, RetraitREER: 0 },
            { monthIndex: 2, NetWorth: 205_000, Expenses: Number.NaN, lifeEvents: ['🏥 Soins de longue durée déclenchés'] },
            { monthIndex: 3, NetWorth: 215_000, Immobilier: Number.NaN, lifeEvents: ['🏠 Achat Condo : -30 000 $'] },
            { monthIndex: 4, NetWorth: 220_000 },
        ];
        const partialExps = buildCurveExplanations(partialTriggers);
        assertPrivacyAndSegmentInvariants(partialExps);
        expect(partialExps.some((e) => e.monthIndex === 1 && e.category === 'ferr')).toBe(true);
        expect(partialExps.some((e) => e.monthIndex === 2 && e.category === 'evenement')).toBe(true);
        expect(partialExps.some((e) => e.monthIndex === 3 && e.category === 'evenement')).toBe(true);

        // oasClawback = 0 lorsque pensionPSV <= 0
        const noPsvPoints: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, isRetired: true, pensionRRQ: 1200, pensionPSV: 0, pensionPrivee: 2000, IncomeRetirement: 3000 }),
            makeFullPoint({ monthIndex: 1, isRetired: true, pensionRRQ: 1200, pensionPSV: 0, pensionPrivee: 2000, IncomeRetirement: 3000 }),
            makeFullPoint({ monthIndex: 2, isRetired: true, pensionRRQ: 1200, pensionPSV: undefined, pensionPrivee: 2000, IncomeRetirement: 3000 }),
        ];
        expect(explainPointAtMonth(noPsvPoints, 1)!.level2.fiscalDetails.oasClawback).toBe(0);
        expect(explainPointAtMonth(noPsvPoints, 2)!.level2.fiscalDetails.oasClawback).toBeNull();
        expect(buildCurveExplanations(noPsvPoints).some((e) => e.titleFr.includes('Récupération de la PSV'))).toBe(false);

        // Triplets estateTax atomiques (pas de mélange mcTotalP50=90_000 avec deterministicFed=22_000 + deterministicQc=28_000)
        const mixedGc = makeGrandCalcul({
            estateTax: {
                deterministicTotal: null,
                deterministicFed: 22_000,
                deterministicQc: 28_000,
                mcTotalP5: 50_000,
                mcTotalP50: 90_000,
                mcTotalP95: 140_000,
                mcFedP50: null,
                mcQcP50: null,
                mcRealTotalP50: 60_000,
                taxableBreakdown: { rrspRrif: 100_000, capitalGainsTaxable: 20_000, rentalRecapture: 0 },
                projectedDeathAge: 88,
            },
        });
        const succMixed = buildCurveExplanations(
            [
                makeFullPoint({ monthIndex: 0 }),
                makeFullPoint({ monthIndex: 6 }),
                makeFullPoint({ monthIndex: 12, age: 88 }),
            ],
            mixedGc,
        ).find((e) => e.category === 'succession')!;
        expect(succMixed).toBeDefined();
        assertPrivacyAndSegmentInvariants([succMixed]);
        const cadsMixed = succMixed.level1Segments
            .filter((s): s is Extract<ExplanationSegment, { kind: 'cad' }> => s.kind === 'cad')
            .map((s) => s.value);
        expect(cadsMixed).toContain(90_000);
        expect(cadsMixed).not.toContain(22_000);
        expect(cadsMixed).not.toContain(28_000);
    });

    it('supprime le spam biennal (PSV clawback continu, impôt avril routinier, bruit trimestriel, découvert persistant) et détecte l’épuisement graduel', () => {
        // 1. Trajectoire 120 mois : clawback continu + bruit trimestriel +5500 + impôt avril routinier 2500
        const noisy: ProjectionChartPoint[] = [];
        for (let m = 0; m < 120; m++) {
            const inRet = m >= 48;
            noisy.push(
                makeFullPoint({
                    monthIndex: m,
                    age: 58 + Math.floor(m / 12),
                    isRetired: inRet,
                    IncomeMarc: inRet ? 0 : 4000,
                    IncomeAnna: inRet ? 0 : 3000,
                    NetWorth: 300_000 + m * 1000,
                    diffNW: !inRet && m % 3 === 0 && m > 0 ? 5500 : 1000,
                    pensionRRQ: inRet ? 1200 : 0,
                    pensionPSV: inRet ? 750 : 0,
                    pensionPrivee: inRet ? 2500 : 0,
                    IncomeRetirement: inRet ? 4150 : 0, // clawback 300/mois continu
                    FluxImpots: m % 12 === 3 ? 2500 : 0, // < max(5000, 0.03*NW) -> routinier
                }),
            );
        }
        const expsNoisy = buildCurveExplanations(noisy);
        assertPrivacyAndSegmentInvariants(expsNoisy);
        expect(expsNoisy.filter((e) => e.titleFr === 'Récupération de la PSV déclenchée')).toHaveLength(1);
        expect(expsNoisy.filter((e) => e.titleFr === 'Accélération de l’accumulation')).toHaveLength(0);
        expect(expsNoisy.filter((e) => e.titleFr.includes('Régularisation fiscale'))).toHaveLength(0);

        // 2. Remboursement d'impôt matériel négatif -> libellé "remboursement d’impôt" et montant positif
        const refundCd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, NetWorth: 250_000, FluxImpots: 0 }),
            makeFullPoint({ monthIndex: 3, NetWorth: 255_000, FluxImpots: -15_000 }),
            makeFullPoint({ monthIndex: 15, NetWorth: 265_000, FluxImpots: -15_200 }), // répétition routinière -> ignorée
            makeFullPoint({ monthIndex: 27, NetWorth: 275_000, FluxImpots: -15_400 }), // répétition routinière -> ignorée
            makeFullPoint({ monthIndex: 28, NetWorth: 276_000, FluxImpots: 0 }),
        ];
        const refundExps = buildCurveExplanations(refundCd);
        assertPrivacyAndSegmentInvariants(refundExps);
        const refundEvts = refundExps.filter((e) => e.category === 'evenement');
        expect(refundEvts).toHaveLength(1);
        const refundText = refundEvts[0].level1Segments
            .filter((s): s is Extract<ExplanationSegment, { kind: 'text' }> => s.kind === 'text')
            .map((s) => s.text)
            .join('');
        expect(refundText).toContain('remboursement d’impôt');
        expect(refundEvts[0].level1Segments.some((s) => s.kind === 'cad' && s.value === 15_000)).toBe(true);

        // 3. Changement de palier soutenu (3 mois >= 5000 vs 1000) -> déclenche 'Accélération de l’accumulation'
        const stepJump: ProjectionChartPoint[] = [];
        for (let m = 0; m < 18; m++) {
            stepJump.push(
                makeFullPoint({
                    monthIndex: m,
                    isRetired: false,
                    NetWorth: 200_000 + m * 1000,
                    diffNW: m >= 12 && m <= 15 ? 6000 : 1000,
                }),
            );
        }
        const jumpExps = buildCurveExplanations(stepJump);
        expect(jumpExps.filter((e) => e.titleFr === 'Accélération de l’accumulation')).toHaveLength(1);

        // 4. Épuisement graduel 2000 -> 1400 -> 800 -> 0 avec Immobilier 300k + découvert persistant non répété
        const gradualCd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, NetWorth: 302_000, Immobilier: 300_000, CELI: 2000, REER: 0, NonReg: 0, Liquidites: 0 }),
            makeFullPoint({ monthIndex: 1, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, NetWorth: 301_400, Immobilier: 300_000, CELI: 1400, REER: 0, NonReg: 0, Liquidites: 0 }),
            makeFullPoint({ monthIndex: 2, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, NetWorth: 300_800, Immobilier: 300_000, CELI: 800, REER: 0, NonReg: 0, Liquidites: 0 }),
            makeFullPoint({ monthIndex: 3, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, NetWorth: 300_000, Immobilier: 300_000, CELI: 0, REER: 0, NonReg: 0, Liquidites: 0 }),
            makeFullPoint({ monthIndex: 4, isRetired: true, IncomeMarc: 0, IncomeAnna: 0, NetWorth: 300_000, Immobilier: 300_000, CELI: 0, REER: 0, NonReg: 0, Liquidites: 0 }),
        ];
        const gradualExps = buildCurveExplanations(gradualCd);
        assertPrivacyAndSegmentInvariants(gradualExps);
        expect(gradualExps.filter((e) => e.category === 'epuisement')).toHaveLength(1);
        expect(gradualExps.find((e) => e.monthIndex === 3)!.category).toBe('epuisement');

        const sustainedDeficitCd: ProjectionChartPoint[] = Array.from({ length: 80 }, (_, m) =>
            makeFullPoint({
                monthIndex: m,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                NetWorth: m >= 5 ? -5000 - m * 200 : 10_000,
                LiquidDebt: m >= 5 ? 5000 + m * 200 : 0,
                CELI: m >= 5 ? 0 : 10_000,
                REER: 0,
                NonReg: 0,
                Liquidites: 0,
                flowEvents: m >= 5 ? ['⚠️ Découvert NON couvert / comptes de décaissement épuisés'] : [],
            }),
        );
        const deficitExps = buildCurveExplanations(sustainedDeficitCd);
        assertPrivacyAndSegmentInvariants(deficitExps);
        expect(deficitExps.filter((e) => e.category === 'epuisement')).toHaveLength(1);

        // 5. Vrai moteur 481 mois (profil revenu élevé DB + REER avec clawback PSV continu) : zéro spam biennal
        const paramsHighDb: SimulationParams = {
            projection: {
                years: 40,
                returnRate: 6.0,
                inflationRate: 2.0,
                savingsMode: 'manual',
                manualContribution: 1500,
                usePortfolioRate: false,
                returnRates: { celi: 6.0, reer: 6.0, nonReg: 6.0, crypto: 0, cash: 2.0 },
                emergencyFundMonths: 3,
                salaryGrowth: 2.0,
                propertyGrowthRate: 3.0,
            },
            calculatedStartingCash: 30_000,
            liveCSVBalances: { CELI: 120_000, CELIAPP: 0, REER: 650_000, NON_ENREG: 100_000, CRYPTO: 0, REEE: 0 },
            realEstateGoals: [],
            debts: [],
            childGoals: [],
            travelGoals: [],
            lifeEvents: [],
            retirementGoal: {
                targetAge: 60,
                targetMonthlyIncome: 6500,
                governmentPension: 1800,
                dbPensionMonthly: 5000,
                lifeExpectancy: 90,
            },
            config: {
                users: [
                    { name: 'ProfilDB', grossSalary: 14_000, netSalary: 8500, color: '#10b981', age: 50, birthYear: 1976, canadaArrivalYear: 1976, hasOwnedPropertyLast4Years: true, celiContributed: 0, rrspContributed: 0 },
                ],
                splitMode: '50/50',
            } as unknown as BudgetConfig,
            baseGrossAnnual: 168_000,
            baseNetAnnual: 102_000,
            currentRentExpense: 1800,
            baseMonthlyExpenses: 4000,
            startYear: 2026,
            startMonth: 0,
        };
        const simHighDb = runScenario(paramsHighDb, 'AUTO_MARGINAL', false, false, 0, 'BASE');
        const expsHighDb = buildCurveExplanations(simHighDb.chartData);
        assertPrivacyAndSegmentInvariants(expsHighDb);
        expect(expsHighDb.filter((e) => e.titleFr === 'Récupération de la PSV déclenchée').length).toBeLessThanOrEqual(1);
        expect(expsHighDb.filter((e) => e.titleFr.includes('Régularisation fiscale') || e.titleFr.includes('Remboursement fiscal')).length).toBeLessThanOrEqual(3);
    });

    it('corrige TPS/TVQ non-héritage, parenthèses imbriquées d’objectif, courbe 1 point et phrasé succession/retraite active', () => {
        // 1. TPS/TVQ, Retrait CELIAPP et Surplus ne déclenchent PAS 'Apport d’héritage'
        const nonHeritageCd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0 }),
            makeFullPoint({ monthIndex: 1, lifeEvents: ['💰 Rembours. TPS/TVQ neuve §6.7 (re1): -3 000 $'] }),
            makeFullPoint({ monthIndex: 2, flowEvents: ['💰 Retrait CELIAPP (FHSA) pour l\'achat : +5 000 $'] }),
            makeFullPoint({ monthIndex: 3, flowEvents: ['💰 ↳ Surplus placé dans le CELI : +500 $'] }),
            makeFullPoint({ monthIndex: 4 }),
        ];
        const nonHeritageExps = buildCurveExplanations(nonHeritageCd);
        expect(nonHeritageExps.some((e) => e.titleFr.includes('héritage'))).toBe(false);

        // 2. Parenthèses imbriquées 'Voyage (Europe)' matchent le bon objectif même à la même année
        const gcGoals = makeGrandCalcul({
            goalProbabilities: [
                { goalId: 'g-other', name: 'Rénovation', deadline: '2028-02', targetAmount: 20_000, probabilityPct: 22, medianShortfall: 5000, status: 'evaluated' },
                { goalId: 'g-eu', name: 'Voyage (Europe)', deadline: '2028-09', targetAmount: 15_000, probabilityPct: 88, medianShortfall: 0, status: 'evaluated' },
            ],
        });
        const goalCd: ProjectionChartPoint[] = [
            makeFullPoint({ monthIndex: 0 }),
            makeFullPoint({
                monthIndex: 24,
                year: 2028,
                flowEvents: ['🏆 But financier (Voyage (Europe)): -5 000 $ depuis CELI (visé 15 000 $ — fonds insuffisants)'],
            }),
            makeFullPoint({ monthIndex: 36, year: 2029 }),
        ];
        const goalExp = buildCurveExplanations(goalCd, gcGoals).find((e) => e.monthIndex === 24)!;
        expect(goalExp.category).toBe('objectif');
        expect(goalExp.level1Segments.some((s) => s.kind === 'pct' && s.value === 88)).toBe(true);

        // 3. Courbe 1 point à monthIndex: 0 -> reste 'accumulation', pas 'succession'
        const singlePt = buildCurveExplanations([makeFullPoint({ monthIndex: 0, ImpotLatent: -32_000 })], makeGrandCalcul());
        assertPrivacyAndSegmentInvariants(singlePt);
        expect(singlePt).toHaveLength(1);
        expect(singlePt[0].category).toBe('accumulation');

        // 4. Phrasé succession "À l’horizon de <age>" (sans "À l’horizon à") et "La phase de retraite active"
        const twoPtsRet: ProjectionChartPoint[] = [
            makeFullPoint({
                monthIndex: 0,
                age: 67,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1200,
                IncomeRetirement: 1200,
                RetraitREER: 1000,
            }),
            makeFullPoint({
                monthIndex: 12,
                age: 68,
                isRetired: true,
                IncomeMarc: 0,
                IncomeAnna: 0,
                pensionRRQ: 1200,
                IncomeRetirement: 1200,
                RetraitREER: 1000,
                ImpotLatent: -10_000,
            }),
        ];
        const retAndSucc = buildCurveExplanations(twoPtsRet, makeGrandCalcul());
        assertPrivacyAndSegmentInvariants(retAndSucc);
        const retText = retAndSucc[0].level1Segments
            .filter((s): s is Extract<ExplanationSegment, { kind: 'text' }> => s.kind === 'text')
            .map((s) => s.text)
            .join('');
        expect(retText).toContain('La phase de retraite active');

        const succText = retAndSucc[1].level1Segments
            .filter((s): s is Extract<ExplanationSegment, { kind: 'text' }> => s.kind === 'text')
            .map((s) => s.text)
            .join('');
        expect(succText).toContain('À l’horizon de ');
        expect(succText).not.toContain('À l’horizon à');
    });

    it('filtre la capitalisation immobilière routinière (~3 %/an sur > 2,5 M$) et applique le cooldown de 24 mois sur Variation immobilière majeure', () => {
        // 1. Croissance composée routinière (~3 %/an ≈ 0,247 %/mois) sur une propriété de 2,5 M$..3,0 M$ :
        //    le delta mensuel dépasse 5 000 $/mois (> 6 175 $/mois), mais le saut relatif reste < 2 % -> 0 carte immo_general.
        const monthlyRate3Pct = Math.pow(1.03, 1 / 12) - 1;
        const routineImmoCd: ProjectionChartPoint[] = [];
        let immo = 2_500_000;
        for (let m = 0; m < 48; m++) {
            if (m > 0) immo *= 1 + monthlyRate3Pct;
            routineImmoCd.push(
                makeFullPoint({
                    monthIndex: m,
                    NetWorth: immo + 250_000,
                    Immobilier: Math.round(immo),
                }),
            );
        }
        const routineExps = buildCurveExplanations(routineImmoCd);
        assertPrivacyAndSegmentInvariants(routineExps);
        expect(routineExps.filter((e) => e.titleFr === 'Variation immobilière majeure')).toHaveLength(0);

        // 2. Saut immobilier non journalisé >= 2 % ET >= 5 000 $ -> 1 carte immo_general,
        //    avec suppression d'un second saut dans la fenêtre de cooldown de 24 mois, puis réactivation après >= 24 mois.
        const jumpImmoCd: ProjectionChartPoint[] = Array.from({ length: 42 }, (_, m) => {
            let imm = 300_000;
            if (m >= 5 && m < 15) imm = 320_000; // +6,67 % (>= 2 % et >= 5 000 $) à m=5
            else if (m >= 15 && m < 30) imm = 350_000; // +9,38 % à m=15 (< 24 mois après m=5 -> cooldown)
            else if (m >= 30) imm = 380_000; // +8,57 % à m=30 (>= 24 mois après m=5 -> réémet)
            return makeFullPoint({
                monthIndex: m,
                NetWorth: imm + 250_000,
                Immobilier: imm,
            });
        });
        const jumpExps = buildCurveExplanations(jumpImmoCd);
        assertPrivacyAndSegmentInvariants(jumpExps);
        const immoEvts = jumpExps.filter((e) => e.titleFr === 'Variation immobilière majeure');
        expect(immoEvts.map((e) => e.monthIndex)).toEqual([5, 30]);
    });
});
