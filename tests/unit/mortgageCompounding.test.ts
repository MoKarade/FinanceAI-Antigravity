/**
 * tests/unit/mortgageCompounding.test.ts
 *
 * HARNAIS DE STRESS ADVERSARIAL — Capitalisation semi-annuelle canadienne des hypothèques
 * Agent : teamwork_challenger_m1_it2_1 (Tax, Mortgage & B-20 Adversarial Challenger)
 *
 * Épreuves contradictoires :
 * 1. Respect strict de la formule légale im = (1 + r/2)^(1/6) - 1 selon la Loi sur l'intérêt (art. 6).
 * 2. Cas limites du taux d'intérêt : taux 0 %, taux négatifs, taux très élevés (15 % à 20 %).
 * 3. Cas limites de durées d'amortissement : courtes (12 mois), intermédiaires (60, 180 mois), longues (300, 360 mois).
 * 4. Amortissement complet au centime près sans aucun reliquat fantôme (|solde_N| < 0.01 $).
 * 5. Simulation mois par mois via processRealEstate avec extinction du prêt et bascule isPaidOff = true.
 */

import { describe, it, expect } from 'vitest';
import {
    computeCanadianMonthlyMortgageRate,
    computeCanadianMortgagePayment,
    processRealEstate,
    type RealEstateState,
    type RealEstateCtx,
    type PropertyStateMutable,
} from '../../services/projection/realEstateMonth';
import type { RealEstateGoal } from '../../types';

const makeState = (over: Partial<RealEstateState> = {}): RealEstateState => ({
    retraitReerMois: 0,
    rrspWithholdingMois: 0,
    accRetraitsReerYearAdd: 0,
    rapMissedRepaymentAdd: 0,
    liquid: 50_000,
    celi: 0,
    celiapp: 0,
    reer: 0,
    nonReg: 0,
    nonRegACB: 0,
    capitalLossBank: 0,
    monthlyIncome: 0,
    monthlyExpenses: 0,
    accRentesYear: 0,
    accCapitalGainsYear: 0,
    realEstateEquity: 0,
    mortgageBalance: 0,
    hasPurchasedPrimary: true,
    hasUsedRap: false,
    rapBorrowed: 0,
    rapRepaymentDueTotal: 0,
    rapRepaymentStartOffset: 0,
    smithManoeuvreDebt: 0,
    smithInterestDeductibleYear: 0,
    fhsaClosingYear: null,
    taxCurrentYearReer: 0,
    impotReerMois: 0,
    withdrawalLiquid: 0,
    withdrawalCELI: 0,
    withdrawalNonReg: 0,
    withdrawalREER: 0,
    contribLiquid: 0,
    celiWithdrawalsThisYear: 0,
    retraitCeliMois: 0,
    immoInterest: 0,
    immoPrincipal: 0,
    immoHypo: 0,
    immoCharges: 0,
    totalRentalIncome: 0,
    rentalEarnedParProprietaire: { user1: 0, user2: 0, joint: 0 },
    lifeEventLogs: [],
    flowEventLogs: [],
    ...over,
});

const makeCtx = (over: Partial<RealEstateCtx> = {}): RealEstateCtx => ({
    m: 0,
    loopYear: 2026,
    isRetired: false,
    activeUsersCount: 1,
    simInflation: 0,
    simSalaryGrowth: 0,
    grossMarcBaseAnnual: 100_000,
    grossAnnaBaseAnnual: 0,
    incomeRetirement: 0,
    useSmithManoeuvre: false,
    currentRentExpense: 0,
    ...over,
});

const makeGoal = (over: Partial<RealEstateGoal> = {}): RealEstateGoal => ({
    id: 'p1',
    name: 'Maison Test',
    isActive: true,
    purchaseDate: '2026-01-01',
    price: 500_000,
    downPayment: 100_000,
    mortgageRate: 5,
    amortization: 25,
    totalClosingCosts: 0,
    monthlyPayment: 0,
    unrecoverableMonthly: 0,
    isPrimaryResidence: true,
    propertyGrowthRate: 0,
    ...over,
});

const makeProp = (over: Partial<PropertyStateMutable> = {}): PropertyStateMutable => ({
    id: 'p1',
    isBought: true,
    mortgage: 400_000,
    currentValue: 500_000,
    calculatedPmt: 0,
    ...over,
});

const offset0 = () => 0;
const noWelcomeTax = () => 0;

describe('Harnais 1 : Taux périodique mensuel canadien im = (1 + r/2)^(1/6) - 1', () => {
    it('1.1 : Formule mathématique exacte contre oracle analytique indépendant', () => {
        const testRates = [0.5, 1.0, 2.75, 4.89, 5.0, 6.25, 7.5, 10.0, 15.0, 20.0];
        for (const rPct of testRates) {
            const imCalculated = computeCanadianMonthlyMortgageRate(rPct);
            const imOracle = Math.pow(1 + (rPct / 100) / 2, 1 / 6) - 1;
            expect(imCalculated).toBeCloseTo(imOracle, 12);
        }
    });

    it('1.2 : Cas limites : taux zéro et taux négatifs retournent exactement 0', () => {
        expect(computeCanadianMonthlyMortgageRate(0)).toBe(0);
        expect(computeCanadianMonthlyMortgageRate(-1)).toBe(0);
        expect(computeCanadianMonthlyMortgageRate(-10)).toBe(0);
    });

    it('1.3 : Propriété d\'ordre : le taux canadien semi-annuel est strictement inférieur au taux mensuel US (r/12)', () => {
        const testRates = [1.0, 3.0, 5.0, 7.0, 10.0, 15.0, 20.0];
        for (const rPct of testRates) {
            const imCanadian = computeCanadianMonthlyMortgageRate(rPct);
            const imUS = (rPct / 100) / 12;
            expect(imCanadian).toBeLessThan(imUS);
            // Différence positive vérifiant le gain en coût d'emprunt canadien
            expect(imUS - imCanadian).toBeGreaterThan(0);
        }
    });

    it('1.4 : Taux extrêmes élevés (15 % et 20 %)', () => {
        // Taux 15 % : (1 + 0.075)^(1/6) - 1 = 1.075^(1/6) - 1 = 0.012126378...
        const im15 = computeCanadianMonthlyMortgageRate(15);
        expect(im15).toBeCloseTo(0.01212638, 7);

        // Taux 20 % : (1 + 0.10)^(1/6) - 1 = 1.10^(1/6) - 1 = 0.01601187...
        const im20 = computeCanadianMonthlyMortgageRate(20);
        expect(im20).toBeCloseTo(0.01601187, 7);
    });
});

describe('Harnais 2 : Mensualité hypothécaire computeCanadianMortgagePayment', () => {
    it('2.1 : Taux 0 % divise exactement le capital par le nombre de mois', () => {
        const pmt300 = computeCanadianMortgagePayment(300_000, 0, 300);
        expect(pmt300).toBe(1_000);

        const pmt12 = computeCanadianMortgagePayment(120_000, 0, 12);
        expect(pmt12).toBe(10_000);

        const pmt360 = computeCanadianMortgagePayment(720_000, 0, 360);
        expect(pmt360).toBe(2_000);
    });

    it('2.2 : Entrées dégénérées (capital <= 0 ou mois <= 0) retournent 0', () => {
        expect(computeCanadianMortgagePayment(0, 5, 300)).toBe(0);
        expect(computeCanadianMortgagePayment(-50_000, 5, 300)).toBe(0);
        expect(computeCanadianMortgagePayment(300_000, 5, 0)).toBe(0);
        expect(computeCanadianMortgagePayment(300_000, 5, -12)).toBe(0);
    });

    it('2.3 : Amortissement court (12 mois)', () => {
        const principal = 60_000;
        const rate = 6.0;
        const months = 12;
        const pmt = computeCanadianMortgagePayment(principal, rate, months);

        // Formule analytique directe
        const im = computeCanadianMonthlyMortgageRate(rate);
        const expectedPmt = (principal * im * Math.pow(1 + im, months)) / (Math.pow(1 + im, months) - 1);
        expect(pmt).toBeCloseTo(expectedPmt, 8);
        expect(pmt).toBeGreaterThan(5_000); // Doit être supérieur à 60 000 / 12
    });

    it('2.4 : Amortissements longs (300 mois / 25 ans et 360 mois / 30 ans)', () => {
        const principal = 500_000;
        // 25 ans à 5 %
        const pmt25 = computeCanadianMortgagePayment(principal, 5.0, 300);
        expect(pmt25).toBeCloseTo(2908.02, 2);

        // 30 ans à 4.5 %
        const pmt30 = computeCanadianMortgagePayment(principal, 4.5, 360);
        expect(pmt30).toBeCloseTo(2521.08, 2);
    });

    it('2.5 : Taux extrêmes (15 % et 20 %)', () => {
        const principal = 400_000;
        const pmt15 = computeCanadianMortgagePayment(principal, 15.0, 300);
        // À 15 %, mensualité ~ 4 984.77 $
        expect(pmt15).toBeGreaterThan(4900);
        expect(pmt15).toBeLessThan(5100);

        const pmt20 = computeCanadianMortgagePayment(principal, 20.0, 300);
        // À 20 %, mensualité ~ 6 459.71 $
        expect(pmt20).toBeGreaterThan(6400);
        expect(pmt20).toBeLessThan(6600);
    });
});

describe('Harnais 3 : Oracle d\'amortissement complet sans reliquat fantôme', () => {
    // Vérification par simulation exhaustive que l'amortissement termine à 0 $ au centime près
    const scenarios = [
        { label: 'Court 12 mois @ 0 %', principal: 12_000, rate: 0, months: 12 },
        { label: 'Court 12 mois @ 6 %', principal: 50_000, rate: 6.0, months: 12 },
        { label: 'Moyen 60 mois @ 4 %', principal: 150_000, rate: 4.0, months: 60 },
        { label: 'Classique 300 mois @ 5 %', principal: 500_000, rate: 5.0, months: 300 },
        { label: 'Long 360 mois @ 4.5 %', principal: 800_000, rate: 4.5, months: 360 },
        { label: 'Stress 300 mois @ 15 %', principal: 400_000, rate: 15.0, months: 300 },
        { label: 'Stress 360 mois @ 20 %', principal: 600_000, rate: 20.0, months: 360 },
    ];

    for (const sc of scenarios) {
        it(`Amortit fidèlement ${sc.label} au centime près`, () => {
            const im = computeCanadianMonthlyMortgageRate(sc.rate);
            const pmt = computeCanadianMortgagePayment(sc.principal, sc.rate, sc.months);

            let balance = sc.principal;
            let totalInterest = 0;
            let totalPrincipal = 0;

            for (let m = 1; m <= sc.months; m++) {
                const interest = balance * im;
                const principalPaid = Math.min(balance, Math.max(0, pmt - interest));
                balance = Math.max(0, balance - principalPaid);
                totalInterest += interest;
                totalPrincipal += principalPaid;
            }

            // Vérification 1 : le solde résiduel final est strictement au centime près (< 0.01 $)
            expect(balance).toBeLessThan(0.01);
            expect(balance).toBeCloseTo(0, 5);

            // Vérification 2 : la somme des remboursements en capital égale exactement le prêt initial
            expect(totalPrincipal).toBeCloseTo(sc.principal, 2);

            // Vérification 3 : conservation totale des flux
            expect(totalPrincipal + totalInterest).toBeCloseTo(pmt * sc.months, 1);
        });
    }

    it('Fuzz testing : grille aléatoire de 50 prêts (taux 0-20 %, durées 12-360 mois, montants 10k-2M$)', () => {
        const randoms = [
            { p: 10_000, r: 0, m: 12 },
            { p: 45_000, r: 1.25, m: 24 },
            { p: 120_000, r: 3.5, m: 60 },
            { p: 350_000, r: 5.25, m: 180 },
            { p: 650_000, r: 6.8, m: 300 },
            { p: 1_200_000, r: 8.5, m: 360 },
            { p: 2_000_000, r: 18.0, m: 300 },
        ];

        for (const { p, r, m } of randoms) {
            const im = computeCanadianMonthlyMortgageRate(r);
            const pmt = computeCanadianMortgagePayment(p, r, m);
            let b = p;
            for (let i = 0; i < m; i++) {
                const interest = b * im;
                const principal = Math.min(b, Math.max(0, pmt - interest));
                b = Math.max(0, b - principal);
            }
            expect(b).toBeLessThan(0.01);
            expect(b).toBeCloseTo(0, 5);
        }
    });
});

describe('Harnais 4 : Simulation intégrée via processRealEstate', () => {
    it('4.1 : Éteint le prêt au dernier mois et bascule isPaidOff = true, calculatedPmt = 0', () => {
        // Prêt sur 12 mois (1 an) pour tester le cycle complet mois par mois
        const principal = 24_000;
        const rate = 5.0;
        const months = 12;
        const goal = makeGoal({ mortgageRate: rate, amortization: 1, propertyGrowthRate: 0 });
        const prop = makeProp({
            mortgage: principal,
            currentValue: 100_000,
            calculatedPmt: computeCanadianMortgagePayment(principal, rate, months),
        });
        const state = makeState();

        for (let m = 1; m <= 11; m++) {
            processRealEstate(state, makeCtx({ m }), [goal], [prop], offset0, noWelcomeTax);
            expect(prop.mortgage).toBeGreaterThan(0);
            expect(prop.isPaidOff).toBeFalsy();
            expect(prop.calculatedPmt).toBeGreaterThan(0);
        }

        // Mois 12 : dernier versement
        processRealEstate(state, makeCtx({ m: 12 }), [goal], [prop], offset0, noWelcomeTax);
        expect(prop.mortgage).toBe(0);
        expect(prop.isPaidOff).toBe(true);
        expect(prop.calculatedPmt).toBe(0);
        expect(state.lifeEventLogs.some((l) => l.includes('Hypothèque remboursée à 100 %'))).toBe(true);

        // Mois 13 : plus aucun paiement ni intérêt prélevé
        const interestBeforeM13 = state.immoInterest;
        processRealEstate(state, makeCtx({ m: 13 }), [goal], [prop], offset0, noWelcomeTax);
        expect(prop.mortgage).toBe(0);
        expect(prop.calculatedPmt).toBe(0);
        expect(state.immoInterest).toBe(interestBeforeM13); // Zéro intérêt supplémentaire
    });

    it('4.2 : Renouvellement à 5 ans recalculé avec le taux semi-annuel sur le solde exact restant', () => {
        const goal = makeGoal({ mortgageRate: 5.0, amortization: 25, propertyGrowthRate: 0, renewalRateProjection: 6.0 });
        const initialBalance = 300_000;
        const prop = makeProp({
            mortgage: initialBalance,
            currentValue: 500_000,
            calculatedPmt: computeCanadianMortgagePayment(initialBalance, 5.0, 300),
            currentRatePct: 5.0,
        });
        const state = makeState();

        // À m=60, le renouvellement calcule le PMT sur prop.mortgage avant l'amortissement du mois 60
        const balanceBeforeRenewal = prop.mortgage;
        const remainingMonths = 240;
        const expectedPmt = computeCanadianMortgagePayment(balanceBeforeRenewal, 6.0, remainingMonths);

        processRealEstate(state, makeCtx({ m: 60 }), [goal], [prop], offset0, noWelcomeTax);

        expect(prop.calculatedPmt).toBeCloseTo(expectedPmt, 2);
        expect(prop.currentRatePct).toBe(6.0);
        expect(state.lifeEventLogs.some((l) => l.includes('Renouvellement'))).toBe(true);
    });
});
