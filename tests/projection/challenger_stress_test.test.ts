// tests/projection/challenger_stress_test.test.ts
// Test empirique indépendant — Adversarial Challenger 2 (Retirement & Real Estate)
// Vérification empirique des 5 épreuves de stress Jalon 1

import { describe, it, expect } from 'vitest';
import {
    computeCanadianMonthlyMortgageRate,
    computeCanadianMortgagePayment,
    processRealEstate,
    type RealEstateState,
    type RealEstateCtx,
    type PropertyStateMutable,
} from '../../services/projection/realEstateMonth';
import {
    computeCcaAllowance,
    computeCcaRecapture,
    CCA_CLASS_1_RATE,
} from '../../services/projection/rentalMonth';
import {
    computeRrqEnhanced,
    computeRetirementIncome,
    type RetirementIncomeCtx,
} from '../../services/projection/retirementIncome';
import {
    computeOasClawback,
    computeTmed,
} from '../../services/projection/taxDecember';
import {
    rrqAdjustmentFactor,
    psvDeferralFactor,
    OAS_CLAWBACK_THRESHOLD_2026,
    OAS_CLAWBACK_RATE,
} from '../../utils/tax';
import type { RealEstateGoal, RetirementGoal, User } from '../../types';

describe('Adversarial Challenger 2 — Épreuves de stress Jalon 1', () => {

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 1 : RRQ Bonifiée
    // ─────────────────────────────────────────────────────────────────────────
    describe('Épreuve 1 : RRQ bonifiée (10 ans post-2019, 5 ans post-2024, salaire > MGAS 85k$)', () => {
        it('1.1 : Calcul exact de computeRrqEnhanced pour 10 ans post-2019 et 5 ans post-2024', () => {
            const salary = 85000;
            const res = computeRrqEnhanced(salary, 10, 5, 74600, 85000);

            // Rente de base : 25 % du MGA (74 600 $) = 18 650.00 $
            expect(res.basePension).toBe(18650);

            // Volet 1 : 8.33 % * MGA * (10 / 40) = 1 553.545 $
            expect(res.volet1).toBeCloseTo(1553.545, 2);

            // Volet 2 : 33.33 % * (85 000 - 74 600) * (5 / 40) = 0.3333 * 10 400 * 0.125 = 433.29 $
            expect(res.volet2).toBeCloseTo(433.29, 2);

            // Total annuel = 18 650 + 1 553.545 + 433.29 = 20 636.835 $
            expect(res.totalAnnual).toBeCloseTo(20636.835, 2);
            expect(res.totalMonthly).toBeCloseTo(20636.835 / 12, 2); // 1 719.74 $/mois
        });

        it('1.2 : Plafonnement strict au MGAS pour un revenu de 120 000 $', () => {
            const res85k = computeRrqEnhanced(85000, 10, 5, 74600, 85000);
            const res120k = computeRrqEnhanced(120000, 10, 5, 74600, 85000);

            // Aucun droit supplémentaire au-delà du MGAS de 85 000 $
            expect(res120k.totalAnnual).toBe(res85k.totalAnnual);
            expect(res120k.volet2).toBe(res85k.volet2);
        });

        it('1.3 : Vérification critique de lintégration dans computeRetirementIncome', () => {
            // Adversarial check : est-ce que computeRetirementIncome reflète le volet 2 ?
            const goal: RetirementGoal = {
                targetAge: 65,
                targetMonthlyIncome: 3000,
                governmentPension: 20000,
                lifeExpectancy: 90,
            };
            const userMpe: User = {
                name: 'MpeUser',
                grossSalary: 74600 / 12,
                netSalary: 50000 / 12,
                color: '#000000',
                age: 65,
                isImmigrant: false,
            };
            const userYampe: User = {
                name: 'YampeUser',
                grossSalary: 85000 / 12,
                netSalary: 55000 / 12,
                color: '#111111',
                age: 65,
                isImmigrant: false,
            };

            const ctxBase: RetirementIncomeCtx = {
                m: 0,
                age: 65,
                simInflation: 0,
                activeUsersCount: 1,
                baseGrossAnnual: 74600,
                delayPensions: false,
                survivorMode: false,
                monthlyOasReduction: 0,
                dbSurvivorPct: 0.6,
                rrqSurvivorPct: 0.6,
                psvResidencyYears: [40],
                startYear: 2026,
            };

            const resMpe = computeRetirementIncome(ctxBase, goal, [userMpe]);
            const resYampe = computeRetirementIncome({ ...ctxBase, baseGrossAnnual: 85000 }, goal, [userYampe]);

            // Intégration RRQ Volet 2 (Loi 149) : le salaire au MGAS (85 000 $)
            // génère une rente RRQ supérieure au salaire au MGA (74 600 $).
            expect(resYampe.rrq).toBeGreaterThan(resMpe.rrq);
            expect(resYampe.rrq).toBeCloseTo(13878.84, 1);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 2 : Découplage RRQ / PSV et Récupération PSV
    // ─────────────────────────────────────────────────────────────────────────
    describe('Épreuve 2 : Découplage RRQ (60-72 ans), PSV (65-70 ans) et OAS Clawback', () => {
        it('2.1 : Facteurs de report et anticipation aux bornes légales exactes', () => {
            // RRQ à 60 ans : -36 % (facteur 0.64)
            const rrqFactor60 = rrqAdjustmentFactor((60 - 65) * 12);
            expect(rrqFactor60).toBe(0.64);

            // RRQ à 72 ans : +58.8 % (facteur 1.588)
            const rrqFactor72 = rrqAdjustmentFactor((72 - 65) * 12);
            expect(rrqFactor72).toBeCloseTo(1.588, 3);

            // PSV à 65 ans : 0 % (facteur 1.00)
            const psvFactor65 = psvDeferralFactor((65 - 65) * 12);
            expect(psvFactor65).toBe(1.0);

            // PSV à 70 ans : +36 % (facteur 1.36)
            const psvFactor70 = psvDeferralFactor((70 - 65) * 12);
            expect(psvFactor70).toBeCloseTo(1.36, 2);
        });

        it('2.2 : Récupération PSV (15 %) avec gain en capital massif de 1 000 000 $ en décembre', () => {
            const massiveCapitalGain = 1000000;
            const psvMonthlyActual = 800; // 9 600 $/an perçus
            const activeUsersCount = 1;

            const res = computeOasClawback(
                11, // Décembre
                12, // Mois 12
                true, // Retraité
                68, // Âge 68
                1.0,
                2000, // Revenu retraite mensuel (24k$/an)
                0,
                0,
                psvMonthlyActual,
                0, // Inflation 0
                activeUsersCount,
                undefined,
                undefined,
                massiveCapitalGain, // 1M$ de gain brut -> 500k$ imposable
                psvMonthlyActual,
                0,
            );

            // Le revenu net de clawback est ~ 24 000 $ + 500 000 $ = 524 000 $
            // Excédent = 524 000 - 95 323 = 428 677 $
            // 15 % de l'excédent = 64 301.55 $
            // Plafond strict = montant annuel réel perçu (800 * 12 = 9 600 $)
            expect(res.clawbackAnnual).toBe(9600);
            expect(res.clawbackAnnual).toBeLessThan(64301.55);
        });

        it('2.3 : Vérification du seuil 2026 (95 323 $) et du calcul TMED/METR', () => {
            // Seuil 2026 sourcé dans utils/tax.ts = 95 323 $
            expect(OAS_CLAWBACK_THRESHOLD_2026).toBe(95323);

            // Retrait de 10 000 $ sur un revenu déjà au-dessus du seuil (100 000 $)
            const tmed = computeTmed(100000, 10000, 2026, { isRetired: true, age: 67, oasReceived: 8000 });
            // Delta clawback sur la tranche entière = 10 000 * 0.15 = 1 500 $
            expect(tmed.deltaClawback).toBeCloseTo(10000 * OAS_CLAWBACK_RATE, 1);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 3 : Hypothèque semi-annuelle canadienne sur 300 mois à 5.5 %
    // ─────────────────────────────────────────────────────────────────────────
    describe('Épreuve 3 : Amortissement hypothécaire semi-annuel canadien (25 ans @ 5.5 %)', () => {
        it('3.1 : Vérification que le solde tombe exactement à zéro après 300 mois avec im canadien', () => {
            const principal = 400000;
            const annualNominalRate = 5.5; // 5.5 %
            const totalMonths = 300;

            const im = computeCanadianMonthlyMortgageRate(annualNominalRate);
            // im = (1 + 0.055 / 2)^(1/6) - 1
            expect(im).toBeCloseTo(0.004531682, 7);

            const pmt = computeCanadianMortgagePayment(principal, annualNominalRate, totalMonths);
            // Mensualité théorique exacte = 2 441.57 $
            expect(pmt).toBeCloseTo(2441.57, 1);

            // Simulation mois par mois du tableau d'amortissement
            let balance = principal;
            let totalInterest = 0;
            let totalPrincipal = 0;

            for (let month = 1; month <= totalMonths; month++) {
                const interestPayment = balance * im;
                const principalPayment = pmt - interestPayment;
                balance -= principalPayment;
                totalInterest += interestPayment;
                totalPrincipal += principalPayment;
            }

            // À la fin des 300 mois, balance = 0 et totalPrincipal = principal initial
            expect(balance).toBeCloseTo(0, 4);
            expect(totalPrincipal).toBeCloseTo(principal, 2);
            expect(totalInterest).toBeGreaterThan(0);
        });

        it('3.2 : Analyse de discordance dans processRealEstate (production)', () => {
            // CONSTAT ADVERSARIAL : Dans services/projection/realEstateMonth.ts :
            // Ligne 381 : const r = (goal.mortgageRate / 100) / 12;
            // Ligne 487 : const monthlyRate = ((pState.currentRatePct ?? goal.mortgageRate) / 100) / 12;
            // processRealEstate utilise la composition mensuelle US (r/12) au lieu de computeCanadianMonthlyMortgageRate !
            const nominal = 5.5;
            const rateUsMonthly = (nominal / 100) / 12;
            const rateCanSemiAnnual = computeCanadianMonthlyMortgageRate(nominal);

            expect(rateUsMonthly).toBeGreaterThan(rateCanSemiAnnual);
            // Écart mensuel : r/12 surestime le taux de 0.0516 points de base chaque mois
            const deltaMonthlyPct = (rateUsMonthly - rateCanSemiAnnual) * 100;
            expect(deltaMonthlyPct).toBeGreaterThan(0.005);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 4 : Immeuble locatif et DPA Catégorie 1 (4 %)
    // ─────────────────────────────────────────────────────────────────────────
    describe('Épreuve 4 : DPA locative (4 %), anti-perte, récupération 100 % et gain en capital 50 %', () => {
        it('4.1 : Simulation sur 10 ans avec interdiction de perte locative', () => {
            const initialCost = 400000;
            let ucc = initialCost;
            let totalCcaClaimed = 0;

            // Années 1 à 8 : Revenu net de 20 000 $/an
            for (let year = 1; year <= 8; year++) {
                const netIncome = 20000;
                const cca = computeCcaAllowance(ucc, netIncome, CCA_CLASS_1_RATE);
                expect(cca.claimedCca).toBeLessThanOrEqual(netIncome);
                expect(cca.netRentalIncomeAfterCca).toBeGreaterThanOrEqual(0);
                totalCcaClaimed += cca.claimedCca;
                ucc = cca.closingUcc;
            }

            // Année 9 : Revenu net très faible (3 000 $) -> DPA plafonnée à 3 000 $
            const netIncome9 = 3000;
            const cca9 = computeCcaAllowance(ucc, netIncome9, CCA_CLASS_1_RATE);
            expect(cca9.claimedCca).toBe(3000); // Plafonné au revenu net
            expect(cca9.netRentalIncomeAfterCca).toBe(0);
            totalCcaClaimed += cca9.claimedCca;
            ucc = cca9.closingUcc;

            // Année 10 : Année déficitaire (-5 000 $) -> DPA nulle
            const netIncome10 = -5000;
            const cca10 = computeCcaAllowance(ucc, netIncome10, CCA_CLASS_1_RATE);
            expect(cca10.claimedCca).toBe(0); // Règle anti-perte LIR 1100(11)
            expect(cca10.closingUcc).toBe(ucc);
            totalCcaClaimed += cca10.claimedCca;
            ucc = cca10.closingUcc;

            expect(ucc).toBeLessThan(initialCost);
            expect(totalCcaClaimed).toBeCloseTo(initialCost - ucc, 2);

            // Revente à 600 000 $
            const salePrice = 600000;
            const recapture = computeCcaRecapture(salePrice, initialCost, ucc);

            // 1. Récupération de 100 % de la DPA réclamée
            expect(recapture.recapture100Pct).toBeCloseTo(totalCcaClaimed, 2);

            // 2. Gain en capital brut = 600 000 - 400 000 = 200 000 $
            expect(recapture.capitalGainGross).toBe(200000);

            // 3. Gain en capital imposable à 50 % (LIR 38(a)) = 100 000 $
            expect(recapture.taxableCapitalGain50Pct).toBe(100000);
            expect(recapture.terminalLoss).toBe(0);
        });

        it('4.2 : Revente à perte en dessous de la FNACC (Perte finale / Terminal Loss)', () => {
            const initialCost = 400000;
            const ucc = 300000;
            const salePrice = 250000; // En dessous de la FNACC

            const recapture = computeCcaRecapture(salePrice, initialCost, ucc);
            expect(recapture.recapture100Pct).toBe(0);
            expect(recapture.capitalGainGross).toBe(0);
            expect(recapture.taxableCapitalGain50Pct).toBe(0);
            // Perte finale admissible à 100 % (LIR 20(16)) = 300 000 - 250 000 = 50 000 $
            expect(recapture.terminalLoss).toBe(50000);
        });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // ÉPREUVE 5 : Règle B-20 sur la manœuvre Smith
    // ─────────────────────────────────────────────────────────────────────────
    describe('Épreuve 5 : Règle B-20 (65 % HELOC, 80 % Combiné)', () => {
        it('5.1 : Déclenchement de lappel de marge quand le combiné dépasse 80 %', () => {
            const propertyValue = 500000;
            const mortgage = 350000;
            const smithDebt = 100000; // Combiné = 450 000 $ > 400 000 $ (80 %)

            const state: RealEstateState = {
                liquid: 10000,
                celi: 0,
                celiapp: 0,
                reer: 0,
                nonReg: 80000,
                nonRegACB: 80000,
                capitalLossBank: 0,
                monthlyIncome: 5000,
                monthlyExpenses: 3000,
                accRentesYear: 0,
                accCapitalGainsYear: 0,
                realEstateEquity: 0,
                mortgageBalance: 0,
                hasPurchasedPrimary: true,
                hasUsedRap: false,
                rapBorrowed: 0,
                rapRepaymentDueTotal: 0,
                rapRepaymentStartOffset: 0,
                smithManoeuvreDebt: smithDebt,
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
                retraitReerMois: 0,
                rrspWithholdingMois: 0,
                accRetraitsReerYearAdd: 0,
                rapMissedRepaymentAdd: 0,
                immoInterest: 0,
                immoPrincipal: 0,
                immoHypo: 0,
                immoCharges: 0,
                totalRentalIncome: 0,
                rentalEarnedParProprietaire: { user1: 0, user2: 0, joint: 0 },
                lifeEventLogs: [],
                flowEventLogs: [],
            };

            const pState: PropertyStateMutable = {
                id: 'p1',
                isBought: true,
                mortgage: mortgage,
                currentValue: propertyValue,
                calculatedPmt: 2000,
                currentRatePct: 5.0,
            };

            const goal: RealEstateGoal = {
                id: 'p1',
                name: 'Maison',
                price: propertyValue,
                downPayment: 100000,
                amortization: 25,
                mortgageRate: 5.0,
                monthlyPayment: 2000,
                unrecoverableMonthly: 0,
                purchaseDate: '2026-01',
                isPrimaryResidence: true,
                isActive: true,
                totalClosingCosts: 0,
                propertyGrowthRate: 0, // Pas de croissance ce mois-ci pour tester la borne 500k$ exacte
            };

            const ctx: RealEstateCtx = {
                m: 1,
                loopYear: 2026,
                isRetired: false,
                activeUsersCount: 1,
                simInflation: 0,
                simSalaryGrowth: 0,
                grossMarcBaseAnnual: 100000,
                grossAnnaBaseAnnual: 0,
                incomeRetirement: 0,
                useSmithManoeuvre: true,
                currentRentExpense: 0,
            };

            // Exécution du mois immobilier
            processRealEstate(state, ctx, [goal], [pState], () => 0, () => 0);

            // Surplus combiné = (100k + 350k - principalPaid) - 400k = ~50k
            // L'appel de marge B-20 doit vendre du nonReg pour réduire smithManoeuvreDebt sous les 80 %
            expect(state.smithManoeuvreDebt + pState.mortgage).toBeLessThanOrEqual(propertyValue * 0.80 + 1);
            expect(state.flowEventLogs.some(log => log.includes('Appel de marge (règle B20)'))).toBe(true);
        });

        it('5.2 : CONSTAT ADVERSARIAL — Absence de blocage en amont si nonReg est vide (0 $)', () => {
            // Si nonReg = 0, l'appel de marge ne peut pas s'exécuter.
            // Est-ce que le système bloque le ré-avancement du prêt ?
            const propertyValue = 500000;
            const mortgage = 350000;
            const smithDebt = 100000; // Déjà en infraction (> 80 %)

            const stateNoNonReg: RealEstateState = {
                liquid: 1000,
                celi: 0,
                celiapp: 0,
                reer: 0,
                nonReg: 0, // Zéro non-enregistré !
                nonRegACB: 0,
                capitalLossBank: 0,
                monthlyIncome: 5000,
                monthlyExpenses: 3000,
                accRentesYear: 0,
                accCapitalGainsYear: 0,
                realEstateEquity: 0,
                mortgageBalance: 0,
                hasPurchasedPrimary: true,
                hasUsedRap: false,
                rapBorrowed: 0,
                rapRepaymentDueTotal: 0,
                rapRepaymentStartOffset: 0,
                smithManoeuvreDebt: smithDebt,
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
                retraitReerMois: 0,
                rrspWithholdingMois: 0,
                accRetraitsReerYearAdd: 0,
                rapMissedRepaymentAdd: 0,
                immoInterest: 0,
                immoPrincipal: 0,
                immoHypo: 0,
                immoCharges: 0,
                totalRentalIncome: 0,
                rentalEarnedParProprietaire: { user1: 0, user2: 0, joint: 0 },
                lifeEventLogs: [],
                flowEventLogs: [],
            };

            const pState: PropertyStateMutable = {
                id: 'p1',
                isBought: true,
                mortgage: mortgage,
                currentValue: propertyValue,
                calculatedPmt: 2000,
                currentRatePct: 5.0,
            };

            const goal: RealEstateGoal = {
                id: 'p1',
                name: 'Maison',
                price: propertyValue,
                downPayment: 100000,
                amortization: 25,
                mortgageRate: 5.0,
                monthlyPayment: 2000,
                unrecoverableMonthly: 0,
                purchaseDate: '2026-01',
                isPrimaryResidence: true,
                isActive: true,
                totalClosingCosts: 0,
                propertyGrowthRate: 0,
            };

            const ctx: RealEstateCtx = {
                m: 1,
                loopYear: 2026,
                isRetired: false,
                activeUsersCount: 1,
                simInflation: 0,
                simSalaryGrowth: 0,
                grossMarcBaseAnnual: 100000,
                grossAnnaBaseAnnual: 0,
                incomeRetirement: 0,
                useSmithManoeuvre: true,
                currentRentExpense: 0,
            };

            processRealEstate(stateNoNonReg, ctx, [goal], [pState], () => 0, () => 0);

            // SÉVÈRE : Lorsque nonReg = 0, la dette Smith continue d'augmenter (intérêts capitalisés + principal)
            // et DÉPASSE les 80 % sans aucun blocage !
            const totalCombined = stateNoNonReg.smithManoeuvreDebt + pState.mortgage;
            expect(totalCombined).toBeGreaterThan(propertyValue * 0.80);
        });
    });
});
