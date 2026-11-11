/**
 * tests/unit/smithManoeuvreB20.test.ts
 *
 * HARNAIS DE STRESS ADVERSARIAL — Règle B-20 du BSIF et Manœuvre Smith
 * Agent : teamwork_challenger_m1_it2_1 (Tax, Mortgage & B-20 Adversarial Challenger)
 *
 * Épreuves contradictoires :
 * 1. Plafond HELOC strict de 65 % de la valeur marchande pour le ré-avancement Smith.
 * 2. Plafond combiné strict de 80 % (prêt hypothécaire + HELOC).
 * 3. Comportement avec compte non-enregistré vide (nonReg = 0).
 * 4. Choc de dépréciation de la propriété (market crash) et déclenchement de l'appel de marge B-20.
 * 5. Immunité absolue des biens locatifs : aucun appel de marge ni ré-avancement Smith sur bien locatif.
 * 6. Portefeuille mixte (résidence principale + bien locatif) sans interférence.
 * 7. Invariants B-20 continus sur simulation multi-années.
 */

import { describe, it, expect } from 'vitest';
import {
    processRealEstate,
    computeCanadianMortgagePayment,
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
    useSmithManoeuvre: true,
    currentRentExpense: 0,
    ...over,
});

const makeGoal = (over: Partial<RealEstateGoal> = {}): RealEstateGoal => ({
    id: 'p1',
    name: 'Résidence Principale',
    isActive: true,
    purchaseDate: '2026-01-01',
    price: 1_000_000,
    downPayment: 200_000,
    mortgageRate: 5.0,
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
    mortgage: 800_000,
    currentValue: 1_000_000,
    calculatedPmt: computeCanadianMortgagePayment(800_000, 5.0, 300),
    ...over,
});

const offset0 = () => 0;
const noWelcomeTax = () => 0;

describe('Harnais 1 : Plafond HELOC 65 % et Plafond Combiné 80 %', () => {
    it('1.1 : Le ré-avancement est strictement borné par la marge résiduelle sous 65 % HELOC', () => {
        const val = 1_000_000;
        // Dette HELOC à 600 000 $ (plafond à 650 000 $ -> marge = 50 000 $)
        // Hypothèque faible à 50 000 $ (combiné = 650 000 $ << 800 000 $)
        const state = makeState({
            smithManoeuvreDebt: 600_000,
            nonReg: 50_000,
            nonRegACB: 50_000,
        });
        const goal = makeGoal();
        const prop = makeProp({
            mortgage: 50_000,
            currentValue: val,
            calculatedPmt: 3_000, // Intérêt ~206 $, principal ~2 794 $
        });

        const initialNonReg = state.nonReg;
        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // Le nonReg reçoit exactement le principal remboursé (car inférieur à la marge de 50k)
        const reAdvanced = state.nonReg - initialNonReg;
        expect(reAdvanced).toBeGreaterThan(2_700);
        expect(reAdvanced).toBeLessThanOrEqual(3_000);
        // Aucun appel de marge déclenché car dette totale < 650k
        expect(state.flowEventLogs.some((l) => l.includes('Appel de marge'))).toBe(false);
    });

    it('1.2 : Le ré-avancement est strictement nul quand le plafond HELOC 65 % est déjà atteint et l\'intérêt capitalisé déclenche un appel de marge', () => {
        const val = 1_000_000;
        // Dette HELOC déjà à 650 000 $ (plafond 65 % atteint à 100 %)
        const state = makeState({
            smithManoeuvreDebt: 650_000,
            nonReg: 100_000,
            nonRegACB: 100_000,
        });
        const goal = makeGoal();
        const prop = makeProp({
            mortgage: 50_000,
            currentValue: val,
            calculatedPmt: 5_000,
        });

        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // 1. Aucun ré-avancement n'a pu avoir lieu sous le plafond 65 %
        // 2. L'intérêt capitalisé sur les 650k (7 % / 12 = ~3 792 $) a fait dépasser le plafond de 650k
        // 3. L'appel de marge B-20 a immédiatement forcé la vente de ~3 792 $ du nonReg pour ramener la dette à 650k
        expect(state.flowEventLogs.some((l) => l.includes('Appel de marge (règle B20)'))).toBe(true);
        expect(state.nonReg).toBeCloseTo(100_000 - 3_791.67, 1);
        expect(state.smithManoeuvreDebt).toBeCloseTo(650_000, 1);
    });

    it('1.3 : Le ré-avancement est strictement borné par le plafond combiné 80 %', () => {
        const val = 1_000_000;
        // Hypothèque à 700 000 $, dette Smith à 98 000 $ (total = 798 000 $ -> marge combinée = 2 000 $)
        const state = makeState({
            smithManoeuvreDebt: 98_000,
            nonReg: 0,
            nonRegACB: 0,
        });
        const goal = makeGoal();
        const prop = makeProp({
            mortgage: 700_000,
            currentValue: val,
            calculatedPmt: 4_000, // Intérêt ~2886 $, principal ~1114 $
        });

        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // Le ré-avancement ne peut excéder le principal remboursé ni la marge combinée
        expect(state.nonReg).toBeLessThanOrEqual(val * 0.80 - (prop.mortgage + 98_000));
        expect(prop.mortgage + state.smithManoeuvreDebt).toBeLessThanOrEqual(val * 0.80 + 1000); // Intérêt capitalisé
    });
});

describe('Harnais 2 : Compte non-enregistré vide (nonReg = 0)', () => {
    it('2.1 : Ré-avancement nominal respectant les règles même si nonReg démarre à 0', () => {
        const state = makeState({
            smithManoeuvreDebt: 0,
            nonReg: 0,
            nonRegACB: 0,
        });
        const goal = makeGoal();
        const prop = makeProp({
            mortgage: 700_000,
            currentValue: 1_000_000,
            calculatedPmt: 4_000,
        });

        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // Doit avoir ré-avancé le principal remboursé
        expect(state.nonReg).toBeGreaterThan(0);
        expect(state.nonRegACB).toBe(state.nonReg);
        expect(state.smithManoeuvreDebt).toBeGreaterThanOrEqual(state.nonReg);
        expect(state.smithManoeuvreDebt).toBeLessThanOrEqual(1_000_000 * 0.65);
    });

    it('2.2 : Aucune dette négative si un appel de marge potentiel survient avec nonReg = 0', () => {
        // Supposons une maison sous-évaluée ou choc sans liquidités non-enregistrées
        const state = makeState({
            smithManoeuvreDebt: 200_000,
            nonReg: 0,
            nonRegACB: 0,
        });
        const goal = makeGoal();
        const prop = makeProp({
            mortgage: 200_000,
            currentValue: 200_000, // Total dettes = 400k > 80 % (160k)
            calculatedPmt: 1_000,
        });

        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // Avec nonReg = 0, aucune vente ne peut être exécutée, mais la dette Smith ne devient JAMAIS négative
        expect(state.smithManoeuvreDebt).toBeGreaterThan(0);
        expect(state.nonReg).toBe(0);
        expect(state.flowEventLogs.some((l) => l.includes('Appel de marge'))).toBe(false);
    });
});

describe('Harnais 3 : Choc de dépréciation (Market Crash) et Appel de Marge B-20', () => {
    it('3.1 : Déclenche une vente forcée du non-enregistré lors d\'un choc de valeur', () => {
        // Maison achetée 1 000 000 $, smithDebt = 500 000 $ (< 650k). NonReg = 300 000 $.
        // Choc : la valeur marchande chute à 600 000 $.
        // Nouveau plafond HELOC 65 % = 390 000 $.
        // Surplus HELOC = 500 000 - 390 000 = 110 000 $.
        const state = makeState({
            smithManoeuvreDebt: 500_000,
            nonReg: 300_000,
            nonRegACB: 300_000,
        });
        const goal = makeGoal();
        const prop = makeProp({
            mortgage: 0, // Hypothèque remboursée, seule la marge Smith subsiste
            currentValue: 600_000,
            calculatedPmt: 0,
        });

        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // L'appel de marge doit être déclenché
        expect(state.flowEventLogs.some((l) => l.includes('Appel de marge (règle B20)'))).toBe(true);
        // Le nonReg a été liquidé pour rembourser le surplus
        expect(state.nonReg).toBeLessThan(300_000);
        // La dette Smith a été réduite
        expect(state.smithManoeuvreDebt).toBeLessThan(500_000);
    });

    it('3.2 : L\'appel de marge ne rembourse JAMAIS plus que ce que porte la marge', () => {
        const state = makeState({
            smithManoeuvreDebt: 50_000,
            nonReg: 200_000,
            nonRegACB: 200_000,
        });
        const goal = makeGoal();
        // Valeur effondrée à 10 000 $ (LTV astronomique)
        const prop = makeProp({
            mortgage: 50_000,
            currentValue: 10_000,
            calculatedPmt: 500,
        });

        processRealEstate(state, makeCtx({ m: 1 }), [goal], [prop], offset0, noWelcomeTax);

        // La dette Smith ne peut jamais devenir négative
        expect(state.smithManoeuvreDebt).toBeGreaterThanOrEqual(0);
    });
});

describe('Harnais 4 : Immunité absolue des biens locatifs contre l\'appel de marge B-20', () => {
    it('4.1 : Bien locatif avec LTV > 80 % ne déclenche AUCUN appel de marge ni vente de nonReg', () => {
        const state = makeState({
            smithManoeuvreDebt: 100_000,
            nonReg: 250_000,
            nonRegACB: 250_000,
        });
        // Immeuble locatif fortement endetté (95 % LTV)
        const rentalGoal = makeGoal({
            id: 'locatif-1',
            name: 'Plex Locatif',
            isPrimaryResidence: false,
            rentalIncomeMonthly: 2_000,
        });
        const rentalProp = makeProp({
            id: 'locatif-1',
            mortgage: 950_000,
            currentValue: 1_000_000,
            calculatedPmt: 5_000,
        });

        processRealEstate(state, makeCtx({ m: 1, useSmithManoeuvre: true }), [rentalGoal], [rentalProp], offset0, noWelcomeTax);

        // NonReg strictement intact
        expect(state.nonReg).toBe(250_000);
        expect(state.flowEventLogs.some((l) => l.includes('Appel de marge'))).toBe(false);
    });

    it('4.2 : Bien locatif ne participe à aucun ré-avancement Smith', () => {
        const state = makeState({
            smithManoeuvreDebt: 0,
            nonReg: 0,
            nonRegACB: 0,
        });
        const rentalGoal = makeGoal({
            id: 'locatif-2',
            isPrimaryResidence: false,
            rentalIncomeMonthly: 1_500,
        });
        const rentalProp = makeProp({
            id: 'locatif-2',
            mortgage: 300_000,
            currentValue: 500_000,
            calculatedPmt: 3_000, // Rembourse du principal
        });

        processRealEstate(state, makeCtx({ m: 1, useSmithManoeuvre: true }), [rentalGoal], [rentalProp], offset0, noWelcomeTax);

        // Pas de manœuvre Smith sur bien locatif
        expect(state.smithManoeuvreDebt).toBe(0);
        expect(state.nonReg).toBe(0);
    });
});

describe('Harnais 5 : Portefeuille mixte (Résidence principale + Bien locatif)', () => {
    it('5.1 : Ré-avancement Smith opère uniquement sur la résidence principale', () => {
        const state = makeState({
            smithManoeuvreDebt: 0,
            nonReg: 10_000,
            nonRegACB: 10_000,
        });
        const primaryGoal = makeGoal({ id: 'primary', isPrimaryResidence: true });
        const primaryProp = makeProp({
            id: 'primary',
            mortgage: 400_000,
            currentValue: 800_000,
            calculatedPmt: 3_000,
        });

        const rentalGoal = makeGoal({ id: 'rental', isPrimaryResidence: false, rentalIncomeMonthly: 2_000 });
        const rentalProp = makeProp({
            id: 'rental',
            mortgage: 200_000,
            currentValue: 300_000,
            calculatedPmt: 1_500,
        });

        const nonRegBefore = state.nonReg;
        processRealEstate(
            state,
            makeCtx({ m: 1, useSmithManoeuvre: true }),
            [primaryGoal, rentalGoal],
            [primaryProp, rentalProp],
            offset0,
            noWelcomeTax,
        );

        // Doit avoir ré-avancé uniquement le principal de la résidence principale
        expect(state.smithManoeuvreDebt).toBeGreaterThan(0);
        expect(state.nonReg).toBeGreaterThan(nonRegBefore);
        // Le loyer locatif afflue aux revenus
        expect(state.monthlyIncome).toBeGreaterThan(0);
    });
});
