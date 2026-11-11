// tests/projection/challenger_m1_it2_stress.test.ts
//
// TEST DE RÉSISTANCE EMPIRIQUE & ORACLES CONTRADICTOIRES — ITÉRATION 2 (JALON 1)
// Agent : teamwork_challenger_m1_it2_2 (Rental CCA & Enhanced RRQ Challenger)
//
// Objectifs contradictoires :
// 1. DPA locative Catégorie 1 (4 %) et suivi de la FNACC (rentalMonth.ts & w5Effects.ts) :
//    - Respect strict de la règle anti-déficit LIR 1100(11) (NOI négatif, NOI inférieur à DPA max, plafonnement au centime).
//    - Décroissance géométrique exacte de la FNACC (UCC_t = UCC_{t-1} - DPA_t) sur 300 mois.
//    - Double protection dans w5Effects (base imposable nette, aucune création de perte).
// 2. Bonification RRQ Volets 1 et 2 (Loi 149 / R-9, retirementIncome.ts) :
//    - Matrice complète des durées de carrière (0, 5, 10, 25, 40, 50 ans post-2019 / post-2024).
//    - Matrice complète des salaires (0 $, 20k, 50k, 74.6k, 80k, 85k, 100k, 250k $).
//    - Vérification empirique du ratio individuel rrqRatioUser et intégration par conjoint.

import { describe, it, expect } from 'vitest';
import {
    computeCcaAllowance,
    computeCcaRecapture,
    rentalCcaParImmeuble,
    processRentalMonth,
    initRentalStates,
    rentalInterestOfMonth,
    CCA_CLASS_1_RATE,
    type RentalState,
} from '../../services/projection/rentalMonth';
import {
    applyW5Effects,
    RENTAL_NOI_TAX_PROXY,
    type W5Context,
    type W5Mutator,
    type W5Containers,
} from '../../services/projection/w5Effects';
import {
    computeRrqEnhanced,
    computeRetirementIncome,
    type RetirementIncomeCtx,
} from '../../services/projection/retirementIncome';
import { RRQ_MPE, RRQ_YAMPE } from '../../utils/tax';
import type { RentalProperty, RetirementGoal, User } from '../../types';

describe('CHALLENGER STRESS — DPA Locative Catégorie 1 (4 %) & Suivi FNACC', () => {

    const MOCK_PROPERTY: RentalProperty = {
        id: 'rental-1',
        name: 'Triplex Plateau',
        purchasePrice: 600_000,
        currentValue: 600_000,
        mortgageBalance: 400_000,
        mortgageRate: 5.0,
        monthlyRent: 3_500,
        vacancyPct: 5,
        monthlyExpenses: 800,
        amortizationYears: 25,
        propertyGrowthRate: 0, // 0 % pour isoler la dépréciation FNACC pure
    };

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 1.1 : LIR 1100(11) — Respect strict de l'interdiction de perte locative
    // ─────────────────────────────────────────────────────────────────────────
    describe('1.1 Respect strict de la LIR 1100(11) (Anti-perte locative)', () => {
        const ucc = 500_000;
        const maxAnnualCca = ucc * CCA_CLASS_1_RATE; // 20 000 $
        const maxMonthlyCca = maxAnnualCca / 12;      // 1 666.6667 $

        it('1.1.1 : NOI net strictement négatif (-1 500 $) -> DPA = 0.00 $ et closing UCC intact', () => {
            const res = computeCcaAllowance(ucc, -1500, CCA_CLASS_1_RATE);
            expect(res.claimedCca).toBe(0);
            expect(res.netRentalIncomeAfterCca).toBe(-1500);
            expect(res.closingUcc).toBe(ucc);
            expect(res.allowableCca).toBe(maxAnnualCca);
        });

        it('1.1.2 : NOI net exactement nul (0.00 $) -> DPA = 0.00 $ et closing UCC intact', () => {
            const res = computeCcaAllowance(ucc, 0, CCA_CLASS_1_RATE);
            expect(res.claimedCca).toBe(0);
            expect(res.netRentalIncomeAfterCca).toBe(0);
            expect(res.closingUcc).toBe(ucc);
        });

        it('1.1.3 : NOI net inférieur à la DPA maximale (ex. 432.18 $ < 1 666.67 $) -> DPA = 432.18 $ au centime près', () => {
            const netBeforeCca = 432.18;
            const res = computeCcaAllowance(ucc, netBeforeCca, CCA_CLASS_1_RATE / 12);
            expect(res.claimedCca).toBeCloseTo(432.18, 2);
            expect(res.netRentalIncomeAfterCca).toBeCloseTo(0.00, 2);
            expect(res.closingUcc).toBeCloseTo(ucc - 432.18, 2);
        });

        it('1.1.4 : NOI net supérieur à la DPA maximale (ex. 5 000 $) -> DPA = 1 666.67 $ et revenu résiduel imposable', () => {
            const netBeforeCca = 5000.00;
            const res = computeCcaAllowance(ucc, netBeforeCca, CCA_CLASS_1_RATE / 12);
            expect(res.claimedCca).toBeCloseTo(maxMonthlyCca, 2);
            expect(res.netRentalIncomeAfterCca).toBeCloseTo(5000 - maxMonthlyCca, 2);
            expect(res.closingUcc).toBeCloseTo(ucc - maxMonthlyCca, 2);
        });

        it('1.1.5 : Cas limite UCC = 0 ou négatif -> DPA = 0', () => {
            const resZero = computeCcaAllowance(0, 5000, CCA_CLASS_1_RATE);
            expect(resZero.claimedCca).toBe(0);
            expect(resZero.closingUcc).toBe(0);

            const resNeg = computeCcaAllowance(-10000, 5000, CCA_CLASS_1_RATE);
            expect(resNeg.claimedCca).toBe(0);
            expect(resNeg.closingUcc).toBe(0);
        });

        it('1.1.6 : rentalCcaParImmeuble calculé depuis un RentalState initialisé', () => {
            const states = initRentalStates([MOCK_PROPERTY]);
            const ccaMap = rentalCcaParImmeuble(states);
            expect(ccaMap['rental-1']).toBeGreaterThan(0);
            expect(ccaMap['rental-1']).toBeLessThanOrEqual((600_000 * 0.04) / 12);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 1.2 : Décroissance géométrique exacte sur 300 mois (25 ans)
    // ─────────────────────────────────────────────────────────────────────────
    describe('1.2 Décroissance géométrique exacte de la FNACC et cumul DPA', () => {
        it('1.2.1 : Décroissance géométrique UCC_t = UCC_{t-1} - DPA_t sur 300 mois avec NOI suffisant', () => {
            const initialCost = 500_000;
            const rateMonthly = 0.04 / 12;
            let currentUcc = initialCost;
            let cumulativeClaimed = 0;

            const states: RentalState[] = [{
                id: 'r-geom',
                currentValue: initialCost,
                mortgage: 0, // Sans dette pour isoler la DPA
                monthlyPayment: 0,
                ratePct: 0,
                growthRatePct: 0,
                isPaidOff: true,
                ucc: initialCost,
                initialCost: initialCost,
                totalCcaClaimed: 0,
                monthlyNoi: 10_000, // Suffisant pour absorber la DPA max chaque mois
            }];

            for (let month = 1; month <= 300; month++) {
                const expectedDpaMonth = currentUcc * rateMonthly;
                const expectedClosingUcc = currentUcc - expectedDpaMonth;
                cumulativeClaimed += expectedDpaMonth;

                const res = processRentalMonth(states, ['Triplex']);

                // Invariant 1 : DPA du mois correspond exactement à rateMonthly * openingUCC
                expect(res.ccaClaimed).toBeCloseTo(expectedDpaMonth, 4);

                // Invariant 2 : closing UCC correspond au calcul géométrique
                expect(states[0].ucc).toBeCloseTo(expectedClosingUcc, 4);

                // Invariant 3 : Formule fermée géométrique UCC_m = UCC_0 * (1 - r)^m
                const closedFormUcc = initialCost * Math.pow(1 - rateMonthly, month);
                expect(states[0].ucc).toBeCloseTo(closedFormUcc, 3);

                // Invariant 4 : Conservation parfaite : UCC_t + totalCcaClaimed = UCC_0
                expect(states[0].ucc + states[0].totalCcaClaimed).toBeCloseTo(initialCost, 3);
                expect(states[0].totalCcaClaimed).toBeCloseTo(cumulativeClaimed, 3);

                currentUcc = states[0].ucc;
            }

            // Vérification finale au mois 300 :
            // (1 - 0.04/12)^300 = (1 - 0.00333333)^300 ≈ 0.36726545577
            // UCC à 25 ans = 500 000 * 0.36726545577 = 183 632.73 $
            const finalExpectedUcc = initialCost * Math.pow(1 - rateMonthly, 300);
            expect(states[0].ucc).toBeCloseTo(finalExpectedUcc, 2);
            expect(states[0].ucc).toBeCloseTo(183632.73, 1);
            expect(states[0].totalCcaClaimed).toBeCloseTo(initialCost - 183632.73, 1);
        });

        it('1.2.2 : Récupération de DPA et gain en capital suite à la dépréciation géométrique sur 25 ans', () => {
            const initialCost = 500_000;
            const closingUccAfter25y = 183549.38;
            const totalCcaTaken = initialCost - closingUccAfter25y; // 316 450.62 $

            // Cas de vente à 800 000 $ après 25 ans :
            const salePrice = 800_000;
            const recap = computeCcaRecapture(salePrice, initialCost, closingUccAfter25y);

            // 1. Récupération à 100 % de toute la DPA prise
            expect(recap.recapture100Pct).toBeCloseTo(totalCcaTaken, 2);
            // 2. Gain en capital brut = 800 000 - 500 000 = 300 000 $
            expect(recap.capitalGainGross).toBe(300_000);
            // 3. Gain imposable à 50 % = 150 000 $
            expect(recap.taxableCapitalGain50Pct).toBe(150_000);
            expect(recap.terminalLoss).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 1.3 : Intégration fiscale et double-garde dans w5Effects.ts
    // ─────────────────────────────────────────────────────────────────────────
    describe('1.3 Intégration fiscale w5Effects & robustesse des barèmes', () => {
        const makeW5Mutator = () => {
            let taxDivers = 0;
            let income = 0;
            let expenses = 0;
            return {
                mutator: {
                    addExpense: (amt: number) => { expenses += amt; },
                    addIncome: (amt: number) => { income += amt; },
                    subtractLiquid: () => {},
                    addTaxRevenu: () => {},
                    addTaxGains: () => {},
                    addTaxDivers: (amt: number) => { taxDivers += amt; },
                    addDonationCredit: () => {},
                    logFlow: () => {},
                    logLife: () => {},
                } as W5Mutator,
                getTaxDivers: () => taxDivers,
                getIncome: () => income,
                getExpenses: () => expenses,
            };
        };

        const makeContainers = (rpList: RentalProperty[]): W5Containers => ({
            insurancePolicies: [],
            vehicleReplacements: [],
            majorRenovations: [],
            charitableGoals: [],
            rentalProperties: rpList,
            privateBusinesses: [],
        });

        it('1.3.1 : w5Effects applique la DPA pour réduire la base imposable locative sans créer de perte', () => {
            const rp: RentalProperty = {
                id: 'r1',
                name: 'Plex',
                purchasePrice: 300_000,
                currentValue: 300_000,
                vacancyPct: 0,
                monthlyRent: 3000,
                monthlyExpenses: 500, // NOI brut = 2500 $/mois
                mortgageBalance: 200000,
                mortgageRate: 5.0,
            };
            const interest = rentalInterestOfMonth({ mortgage: 200000, ratePct: 5.0 }, true);
            const netBeforeCca = 2500 - interest; // ≈ 2 500 - 824.78 = 1 675.22 $

            const { mutator, getTaxDivers, getIncome } = makeW5Mutator();
            const ctx: W5Context = {
                m: 0,
                currentMonthIndex: 0,
                currentLoopDate: new Date('2026-01-01'),
                startYear: 2026,
                startMonth: 0,
                expenseMultiplier: 1.0,
                rentalInterestMensuelParImmeuble: { r1: interest },
                rentalCcaMensuelParImmeuble: { r1: 1000 }, // DPA demandée = 1000 $
            };

            applyW5Effects(ctx, makeContainers([rp]), mutator);

            // Revenu encaissé brut = 2 500 $
            expect(getIncome()).toBeCloseTo(2500, 2);

            // Base imposable = netBeforeCca - 1000 $ = 1 675.22 - 1000 = 675.22 $
            // Impôt divers = baseImposable * 0.45
            const expectedTax = (netBeforeCca - 1000) * RENTAL_NOI_TAX_PROXY;
            expect(getTaxDivers()).toBeCloseTo(expectedTax, 2);
        });

        it('1.3.2 : Double-garde : si rentalCcaMensuelParImmeuble demande plus que netBeforeCca, w5Effects bride au net', () => {
            const rp: RentalProperty = {
                id: 'r1',
                name: 'Plex',
                purchasePrice: 300_000,
                currentValue: 300_000,
                vacancyPct: 0,
                monthlyRent: 1500,
                monthlyExpenses: 500, // NOI brut = 1000 $/mois
                mortgageBalance: 200000,
                mortgageRate: 5.0,
            };
            const interest = rentalInterestOfMonth({ mortgage: 200000, ratePct: 5.0 }, true);
            const netBeforeCca = 1000 - interest; // ≈ 1000 - 824.78 = 175.22 $
            expect(netBeforeCca).toBeGreaterThan(0);

            const { mutator, getTaxDivers } = makeW5Mutator();
            const ctx: W5Context = {
                m: 0,
                currentMonthIndex: 0,
                currentLoopDate: new Date('2026-01-01'),
                startYear: 2026,
                startMonth: 0,
                expenseMultiplier: 1.0,
                rentalInterestMensuelParImmeuble: { r1: interest },
                rentalCcaMensuelParImmeuble: { r1: 999999 }, // DPA exagérée
            };

            applyW5Effects(ctx, makeContainers([rp]), mutator);

            // actualCca est bridé à netBeforeCca (175.22 $) -> base imposable = 0.00 $
            expect(getTaxDivers()).toBeCloseTo(0.00, 2);
        });

        it('1.3.3 : Si netBeforeCca est négatif, la DPA est nulle et la perte nette d exploitation est préservée', () => {
            const rp: RentalProperty = {
                id: 'r-loss',
                name: 'Plex Déficitaire',
                purchasePrice: 300_000,
                currentValue: 300_000,
                vacancyPct: 0,
                monthlyRent: 500,
                monthlyExpenses: 800, // NOI brut = -300 $/mois
                mortgageBalance: 200000,
                mortgageRate: 5.0,
            };
            const interest = rentalInterestOfMonth({ mortgage: 200000, ratePct: 5.0 }, true); // ≈ 824.78 $
            const netBeforeCca = -300 - interest; // ≈ -1 124.78 $

            const { mutator, getTaxDivers } = makeW5Mutator();
            const ctx: W5Context = {
                m: 0,
                currentMonthIndex: 0,
                currentLoopDate: new Date('2026-01-01'),
                startYear: 2026,
                startMonth: 0,
                expenseMultiplier: 1.0,
                rentalInterestMensuelParImmeuble: { 'r-loss': interest },
                rentalCcaMensuelParImmeuble: { 'r-loss': 1000 },
            };

            applyW5Effects(ctx, makeContainers([rp]), mutator);

            // La perte d'exploitation est de -1 124.78 $, NON aggravée par la DPA (DPA = 0)
            const expectedTax = netBeforeCca * RENTAL_NOI_TAX_PROXY;
            expect(getTaxDivers()).toBeCloseTo(expectedTax, 2);
        });
    });
});

describe('CHALLENGER STRESS — Bonification RRQ Volets 1 et 2 (Loi 149 / R-9)', () => {

    // ─────────────────────────────────────────────────────────────────────────
    // ORACLE INDÉPENDANT DE CALCUL RRQ (R-9)
    // ─────────────────────────────────────────────────────────────────────────
    const oracleRrq = (
        salary: number,
        yearsPost2019: number,
        yearsPost2024: number,
        mga: number = 74600,
        mgas: number = 85000,
    ) => {
        const s = Math.max(0, salary);
        const y19 = Math.min(40, Math.max(0, yearsPost2019));
        const y24 = Math.min(40, Math.max(0, yearsPost2024));

        const baseRatio = Math.min(1, s / mga);
        const basePension = 0.25 * mga * baseRatio;

        const volet1Prorata = y19 / 40;
        const volet1 = 0.0833 * mga * baseRatio * volet1Prorata;

        const band2Ratio = (s > mga && mgas > mga)
            ? Math.min(1, (s - mga) / (mgas - mga))
            : 0;
        const volet2Prorata = y24 / 40;
        const volet2 = 0.3333 * (mgas - mga) * band2Ratio * volet2Prorata;

        const totalAnnual = basePension + volet1 + volet2;
        const rrqRatio = totalAnnual / (0.25 * mga);

        return { basePension, volet1, volet2, totalAnnual, rrqRatio };
    };

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 2.1 : Matrice exhaustive Carrières x Salaires
    // ─────────────────────────────────────────────────────────────────────────
    describe('2.1 Matrice de stress 48 combinaisons (Carrière x Salaire) vs Oracle Loi 149', () => {
        const testCareers = [
            { label: '0 an post-2019, 0 an post-2024 (retraite <= 2019)', y19: 0, y24: 0 },
            { label: '5 ans post-2019, 0 an post-2024 (retraite 2024)', y19: 5, y24: 0 },
            { label: '10 ans post-2019, 5 ans post-2024 (retraite 2029)', y19: 10, y24: 5 },
            { label: '25 ans post-2019, 20 ans post-2024 (retraite 2044)', y19: 25, y24: 20 },
            { label: '40 ans post-2019, 40 ans post-2024 (carrière pleine)', y19: 40, y24: 40 },
            { label: '55 ans post-2019, 50 ans post-2024 (test de saturation)', y19: 55, y24: 50 },
        ];

        const testSalaries = [
            0,
            20_000,
            50_000,
            74_600, // Exactement MGA 2026
            79_800, // Point milieu tranche MGAS (5 200 $ / 10 400 $ = 50 %)
            85_000, // Exactement MGAS 2026
            100_000,
            250_000,
        ];

        testCareers.forEach((career) => {
            describe(`Carrière : ${career.label}`, () => {
                testSalaries.forEach((sal) => {
                    it(`Salaire ${sal.toLocaleString('fr-CA')} $ correspond à l'oracle au centime près`, () => {
                        const actual = computeRrqEnhanced(sal, career.y19, career.y24, RRQ_MPE, RRQ_YAMPE);
                        const expected = oracleRrq(sal, career.y19, career.y24, RRQ_MPE, RRQ_YAMPE);

                        expect(actual.basePension).toBeCloseTo(expected.basePension, 2);
                        expect(actual.volet1).toBeCloseTo(expected.volet1, 2);
                        expect(actual.volet2).toBeCloseTo(expected.volet2, 2);
                        expect(actual.totalAnnual).toBeCloseTo(expected.totalAnnual, 2);
                        expect(actual.totalMonthly).toBeCloseTo(expected.totalAnnual / 12, 2);

                        // Dérivation du ratio individuel rrqRatioUser
                        const actualRatio = actual.totalAnnual / (0.25 * RRQ_MPE);
                        expect(actualRatio).toBeCloseTo(expected.rrqRatio, 5);

                        // Vérification des propriétés fondamentales de la Loi 149 :
                        if (sal <= RRQ_MPE) {
                            expect(actual.volet2).toBe(0); // Jamais de Volet 2 sous le MGA
                        }
                        if (career.y19 === 0) {
                            expect(actual.volet1).toBe(0); // Jamais de Volet 1 sans cotisation post-2019
                        }
                        if (career.y24 === 0) {
                            expect(actual.volet2).toBe(0); // Jamais de Volet 2 sans cotisation post-2024
                        }
                        if (sal >= RRQ_YAMPE && career.y19 >= 40 && career.y24 >= 40) {
                            // Carrière pleine au MGAS : ratio ≈ 1.51906, rente = 28 330.50 $
                            expect(actual.totalAnnual).toBeCloseTo(28330.50, 2);
                            expect(actualRatio).toBeCloseTo(1.51906, 4);
                        }
                    });
                });
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 2.2 : Robustesse de l'intégration dans computeRetirementIncome
    // ─────────────────────────────────────────────────────────────────────────
    describe('2.2 Intégration dans computeRetirementIncome & Cas Asymétriques', () => {
        const goal: RetirementGoal = {
            targetAge: 65,
            targetMonthlyIncome: 4000,
            governmentPension: 20000, // Split 65 % RRQ = 13 000 $ ménage de base
            lifeExpectancy: 90,
        };

        const ctxTemplate: RetirementIncomeCtx = {
            m: 0,
            age: 65,
            simInflation: 0,
            activeUsersCount: 2,
            baseGrossAnnual: 120000,
            delayPensions: false,
            survivorMode: false,
            monthlyOasReduction: 0,
            dbSurvivorPct: 0.6,
            rrqSurvivorPct: 0.6,
            psvResidencyYears: [40, 40],
            startYear: 2026,
        };

        it('2.2.1 : Couple asymétrique — l\'un au salaire minimum (25k$), l\'autre au-dessus du MGAS (120k$)', () => {
            const userLow: User = {
                name: 'LowEarner',
                grossSalary: 25000 / 12,
                birthYear: 1961, // Retraite en 2026 -> 7 ans post-2019, 2 ans post-2024
                canadaArrivalYear: 1961,
                isImmigrant: false,
            } as unknown as User;

            const userHigh: User = {
                name: 'HighEarner',
                grossSalary: 120000 / 12,
                birthYear: 1961,
                canadaArrivalYear: 1961,
                isImmigrant: false,
            } as unknown as User;

            const income = computeRetirementIncome(ctxTemplate, goal, [userLow, userHigh]);

            // Vérifications perUser :
            expect(income.perUser.length).toBe(2);
            const rrqLow = income.perUser[0].rrq;
            const rrqHigh = income.perUser[1].rrq;

            // Le haut salarié doit toucher une RRQ nettement supérieure
            expect(rrqHigh).toBeGreaterThan(rrqLow * 2.5);

            // Invariant de conservation du ménage : somme des perUser == total ménage
            expect(rrqLow + rrqHigh).toBeCloseTo(income.rrq, 2);
            expect(income.perUser[0].total + income.perUser[1].total).toBeCloseTo(income.total, 2);
        });

        it('2.2.2 : Immigrant avec arrivée tardive (2022) — calcul exact du point de départ contributif', () => {
            // Immigrant né en 1985, arrivé en 2022 à l'âge de 37 ans.
            // Retraite à 65 ans en 2050.
            // Années post-2019 = 2050 - max(2019, 2022) = 28 ans.
            // Années post-2024 = 2050 - max(2024, 2022) = 26 ans.
            // Résidence RRQ = min(1, (65 - 37) / 39) = 28 / 39 ≈ 0.7179.
            const userImm: User = {
                name: 'ImmigrantUser',
                grossSalary: 85000 / 12,
                birthYear: 1985,
                canadaArrivalYear: 2022,
                isImmigrant: true,
            } as unknown as User;

            const singleCtx: RetirementIncomeCtx = {
                ...ctxTemplate,
                activeUsersCount: 1,
                psvResidencyYears: [28],
            };

            const immIncome = computeRetirementIncome(singleCtx, goal, [userImm]);

            // Calcul attendu :
            const rrqEnh = computeRrqEnhanced(85000, 28, 26, RRQ_MPE, RRQ_YAMPE);
            const rrqRatio = rrqEnh.totalAnnual / (0.25 * RRQ_MPE);
            const rrqResidenceProrata = 28 / 39;
            const expectedWeight = rrqRatio * rrqResidenceProrata;

            const rrqBaseFamily = 20000 * 0.65; // 13 000 $/mois (governmentPension est mensuel)
            const expectedMonthly = rrqBaseFamily * expectedWeight;

            expect(immIncome.rrq).toBeCloseTo(expectedMonthly, 1);
        });

        it('2.2.3 : Découplage de la demande de RRQ (rrqStartAge 60, 65, 72 ans) sur la rente bonifiée', () => {
            const user: User = {
                name: 'Worker',
                grossSalary: 85000 / 12,
                birthYear: 1961,
                canadaArrivalYear: 1961,
                isImmigrant: false,
            } as unknown as User;

            // Découplage pur : même âge d'arrêt de travail (targetAge = 65), mais demande de rente devancée ou reportée
            const goalStart60: RetirementGoal = { ...goal, targetAge: 65, rrqStartAge: 60 };
            const ctx60: RetirementIncomeCtx = { ...ctxTemplate, activeUsersCount: 1, age: 65 };
            const incomeStart60 = computeRetirementIncome(ctx60, goalStart60, [user]);

            const goalStart65: RetirementGoal = { ...goal, targetAge: 65, rrqStartAge: 65 };
            const ctx65: RetirementIncomeCtx = { ...ctxTemplate, activeUsersCount: 1, age: 65 };
            const incomeStart65 = computeRetirementIncome(ctx65, goalStart65, [user]);

            const goalStart72: RetirementGoal = { ...goal, targetAge: 65, rrqStartAge: 72 };
            const ctx72: RetirementIncomeCtx = { ...ctxTemplate, activeUsersCount: 1, age: 72 };
            const incomeStart72 = computeRetirementIncome(ctx72, goalStart72, [user]);

            // Facteur à 60 ans = 0.64 (-36 %)
            expect(incomeStart60.rrq).toBeCloseTo(incomeStart65.rrq * 0.64, 2);

            // Facteur à 72 ans = 1.588 (+58.8 %)
            expect(incomeStart72.rrq).toBeCloseTo(incomeStart65.rrq * 1.588, 2);
        });

        it('2.2.4 : Mode survivant (survivorMode) préserve le prorata bonifié et applique le facteur de survie', () => {
            const user: User = {
                name: 'Survivor',
                grossSalary: 85000 / 12,
                birthYear: 1961,
                canadaArrivalYear: 1961,
                isImmigrant: false,
            } as unknown as User;

            const ctxNormal: RetirementIncomeCtx = { ...ctxTemplate, activeUsersCount: 1, survivorMode: false };
            const ctxSurvivor: RetirementIncomeCtx = { ...ctxTemplate, activeUsersCount: 1, survivorMode: true, rrqSurvivorPct: 0.6 };

            const incNormal = computeRetirementIncome(ctxNormal, goal, [user]);
            const incSurvivor = computeRetirementIncome(ctxSurvivor, goal, [user]);

            // survivorRrqFactor = 1 - 0.5 + 0.5 * 0.6 = 0.80
            expect(incSurvivor.rrq).toBeCloseTo(incNormal.rrq * 0.80, 1);
        });
    });
});

