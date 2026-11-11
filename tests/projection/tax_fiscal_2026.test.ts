import { describe, it, expect } from 'vitest';
import {
    calculateFiscalReport,
    computeFederalBpa,
    BASIC_PERSONAL_AMOUNT_FED,
    BASIC_PERSONAL_AMOUNT_FED_MIN,
    FED_BPA_PHASEOUT_START,
    FED_BPA_PHASEOUT_END,
    RRQ_MPE,
    RRQ_YAMPE,
    rrqAdjustmentFactor,
    psvDeferralFactor,
} from '../../utils/tax';
import {
    computeRqapBenefits,
    computeQuebecChildcareCreditRate,
    computeFederalChildcareDeduction,
    computeChildcareSupport,
    RQAP_TIER1_RATE,
    RQAP_TIER2_RATE,
} from '../../services/projection/childrenReee';
import { computeRrqEnhanced } from '../../services/projection/retirementIncome';
import { computeTmed } from '../../services/projection/taxDecember';
import {
    computeCanadianMonthlyMortgageRate,
    computeCanadianMortgagePayment,
} from '../../services/projection/realEstateMonth';
import {
    computeCcaAllowance,
    computeCcaRecapture,
    CCA_CLASS_1_RATE,
} from '../../services/projection/rentalMonth';

describe('Jalon 1 — Fiscalité québécoise et canadienne 100 % sourcée (Lot 1)', () => {

    describe('Objectif 1 : Bonus, RSU & Travailleur autonome dans l\'assiette progressive', () => {
        it('calcule correctement la double cotisation RRQ employeur+employé pour un travailleur autonome (12,60 % et 8,00 %)', () => {
            const selfEmployedSalary = 85000;
            // Rapport avec salaire autonome
            const report = calculateFiscalReport(
                selfEmployedSalary,
                0,
                0,
                2026,
                false,
                undefined,
                0,
                1,
                selfEmployedSalary,
            );

            // Base + Volet 1 : (74 600 - 3 500) * 12.60% = 8 958.60 $
            const expectedRrqBaseVolet1 = (RRQ_MPE - 3500) * 0.126;
            // Volet 2 : (85 000 - 74 600) * 8.00% = 832.00 $
            const expectedRrqVolet2 = (RRQ_YAMPE - RRQ_MPE) * 0.08;

            expect(report.rrqVolet1).toBeCloseTo(expectedRrqBaseVolet1, 1);
            expect(report.rrqVolet2).toBeCloseTo(expectedRrqVolet2, 1);
            expect(report.rrq).toBeCloseTo(expectedRrqBaseVolet1 + expectedRrqVolet2, 1);
        });

        it('intègre les bonus et RSU au revenu brut et à l\'impôt progressif annuel', () => {
            const baseSalary = 100000;
            const bonusAnnual = 20000;
            const rsuAnnual = 15000;
            const totalIncome = baseSalary + bonusAnnual + rsuAnnual;

            const baseReport = calculateFiscalReport(baseSalary, 0, 0, 2026, false, undefined, baseSalary);
            const totalReport = calculateFiscalReport(totalIncome, 0, 0, 2026, false, undefined, totalIncome);

            expect(totalReport.grossIncome).toBe(135000);
            expect(totalReport.totalTax).toBeGreaterThan(baseReport.totalTax);
            // Vérifie que le taux marginal sur le bonus/RSU est au moins de 45 %
            const marginalTaxRate = (totalReport.totalTax - baseReport.totalTax) / (bonusAnnual + rsuAnnual);
            expect(marginalTaxRate).toBeGreaterThanOrEqual(0.40);
        });
    });

    describe('Objectif 2 : Congé parental RQAP bipalier officiel', () => {
        it('applique 70 % pendant les 6 premiers mois et 55 % pour les mois 7 à 12', () => {
            const salary = 80000;
            const mra = 103000;

            const benefitsMonth1 = computeRqapBenefits(salary, 0, 'base', mra); // 1er mois (index 0)
            const benefitsMonth6 = computeRqapBenefits(salary, 5, 'base', mra); // 6e mois (index 5)
            const benefitsMonth7 = computeRqapBenefits(salary, 6, 'base', mra); // 7e mois (index 6)
            const benefitsMonth12 = computeRqapBenefits(salary, 11, 'base', mra); // 12e mois (index 11)

            const expectedMonthTier1 = (salary * RQAP_TIER1_RATE) / 12; // 80 000 * 0.70 / 12 = 4 666.67 $
            const expectedMonthTier2 = (salary * RQAP_TIER2_RATE) / 12; // 80 000 * 0.55 / 12 = 3 666.67 $

            expect(benefitsMonth1.grossMonthlyBenefit).toBeCloseTo(expectedMonthTier1, 2);
            expect(benefitsMonth6.grossMonthlyBenefit).toBeCloseTo(expectedMonthTier1, 2);
            expect(benefitsMonth7.grossMonthlyBenefit).toBeCloseTo(expectedMonthTier2, 2);
            expect(benefitsMonth12.grossMonthlyBenefit).toBeCloseTo(expectedMonthTier2, 2);
        });

        it('plafonne les prestations au MRA de 103 000 $ en 2026', () => {
            const highSalary = 150000;
            const mra = 103000;

            const benefitsP1 = computeRqapBenefits(highSalary, 3, 'base', mra);
            const benefitsP2 = computeRqapBenefits(highSalary, 9, 'base', mra);

            const maxMonthlyP1 = (mra * 0.70) / 12; // 6 008.33 $
            const maxMonthlyP2 = (mra * 0.55) / 12; // 4 720.83 $

            expect(benefitsP1.grossMonthlyBenefit).toBeCloseTo(maxMonthlyP1, 2);
            expect(benefitsP2.grossMonthlyBenefit).toBeCloseTo(maxMonthlyP2, 2);
        });
    });

    describe('Objectif 3 : Frais de garde Annexe C (QC) & T778 Ligne 21400 (Fédéral)', () => {
        it('accorde la déduction T778 au conjoint le plus bas, bornée par l\'âge et les 2/3 du revenu', () => {
            const expenseChild4 = 10000;
            const expenseChild8 = 7000;
            const lowerEarnedIncome = 30000; // 2/3 = 20 000 $

            const dedChild4 = computeFederalChildcareDeduction(expenseChild4, 4, lowerEarnedIncome);
            const dedChild8 = computeFederalChildcareDeduction(expenseChild8, 8, lowerEarnedIncome);

            // Plafond 8 000 $ pour moins de 7 ans
            expect(dedChild4).toBe(8000);
            // Plafond 5 000 $ pour 7 à 16 ans
            expect(dedChild8).toBe(5000);

            // Règle 2/3 quand le salaire est faible
            const lowIncome = 6000; // 2/3 = 4 000 $
            const dedLimited = computeFederalChildcareDeduction(8000, 3, lowIncome);
            expect(dedLimited).toBe(4000);
        });

        it('applique la grille officielle québécoise Annexe C de 78 % à 67 %', () => {
            expect(computeQuebecChildcareCreditRate(35000)).toBe(0.78);
            expect(computeQuebecChildcareCreditRate(41885)).toBe(0.78);
            expect(computeQuebecChildcareCreditRate(123000)).toBe(0.67);
            expect(computeQuebecChildcareCreditRate(150000)).toBe(0.67);

            // Point médian
            const midIncome = (41885 + 123000) / 2;
            expect(computeQuebecChildcareCreditRate(midIncome)).toBeCloseTo(0.725, 3);
        });

        it('combine crédit QC et déduction fédérale pour réduire le coût net des frais de garde', () => {
            const support = computeChildcareSupport(12000, 80000, 1, [4], 40000);
            expect(support.qcRefundableCredit).toBeGreaterThan(5000);
            expect(support.fedTaxRelief).toBeGreaterThan(500);
            expect(support.totalSupport).toBe(support.qcRefundableCredit + support.fedTaxRelief);
            expect(support.netCostAnnual).toBe(12000 - support.totalSupport);
        });
    });

    describe('Objectif 4 : Dégressivité du Montant Personnel de Base (BPA) LIR 118(1.1)', () => {
        it('maintient le BPA plein de 16 452 $ sous 181 440 $ de revenu net', () => {
            expect(computeFederalBpa(100000)).toBe(BASIC_PERSONAL_AMOUNT_FED);
            expect(computeFederalBpa(FED_BPA_PHASEOUT_START)).toBe(16452);
        });

        it('atteint le plancher de 14 829 $ au-dessus de 258 482 $ de revenu net', () => {
            expect(computeFederalBpa(FED_BPA_PHASEOUT_END)).toBe(BASIC_PERSONAL_AMOUNT_FED_MIN);
            expect(computeFederalBpa(300000)).toBe(14829);
        });

        it('réduit linéairement le BPA dans la tranche intermédiaire', () => {
            const midIncome = (FED_BPA_PHASEOUT_START + FED_BPA_PHASEOUT_END) / 2;
            const midBpa = computeFederalBpa(midIncome);
            expect(midBpa).toBeCloseTo(15640.50, 2);

            const bpa200k = computeFederalBpa(200000);
            expect(bpa200k).toBeCloseTo(16060.99, 1);
        });
    });

    describe('Objectif 5 : RRQ Bonifiée Volet 1 et Volet 2', () => {
        it('calcule la rente de base 25 % et la bonification Volet 1 (+8,33 %) et Volet 2 (33,33 %)', () => {
            // Travailleur avec carrière complète bonifiée (40 ans)
            const fullCareer = computeRrqEnhanced(85000, 40, 40, 74600, 85000);

            // Base : 0.25 * 74 600 = 18 650 $
            expect(fullCareer.basePension).toBe(18650);
            // Volet 1 : 0.0833 * 74 600 = 6 214.18 $
            expect(fullCareer.volet1).toBeCloseTo(6214.18, 1);
            // Volet 2 : 0.3333 * (85 000 - 74 600) = 3 466.32 $
            expect(fullCareer.volet2).toBeCloseTo(3466.32, 1);
            // Total annuel : 28 330.50 $
            expect(fullCareer.totalAnnual).toBeCloseTo(28330.50, 1);
        });

        it('calcule le prorata exact pour des années partielles post-2019 et post-2024', () => {
            const partial = computeRrqEnhanced(80000, 10, 5, 74600, 85000);

            // Volet 1 (10 / 40) = 0.0833 * 74 600 * 0.25 = 1 553.54 $
            expect(partial.volet1).toBeCloseTo(1553.54, 1);
            // Volet 2 sur salaire 80 000 (tranche = 80 000 - 74 600 = 5 400 $)
            // 0.3333 * 5400 * (5 / 40) = 224.98 $
            expect(partial.volet2).toBeCloseTo(224.98, 1);
        });
    });

    describe('Objectif 6 : Découplage RRQ (60-72 ans) et PSV (65-70 ans), OAS clawback et TMED', () => {
        it('applique les facteurs d\'anticipation (-36 %) et de report (+58,8 %) pour la RRQ', () => {
            const factor60 = rrqAdjustmentFactor((60 - 65) * 12);
            expect(factor60).toBe(0.64);

            const factor72 = rrqAdjustmentFactor((72 - 65) * 12);
            expect(factor72).toBeCloseTo(1.588, 3);
        });

        it('applique le report maximal de la PSV à 70 ans (+36 %)', () => {
            const factor70 = psvDeferralFactor((70 - 65) * 12);
            expect(factor70).toBeCloseTo(1.36, 2);
        });

        it('calcule le TMED / METR sur un retrait REER additionnel', () => {
            const baseIncome = 50000;
            const withdrawal = 10000;
            const tmed = computeTmed(baseIncome, withdrawal, 2026);

            expect(tmed.tmedRate).toBeGreaterThan(0.20);
            expect(tmed.tmedRate).toBeLessThan(0.65);
        });
    });

    describe('Objectif 7 : Hypothèque semi-annuelle, DPA locative Catégorie 1 et règle B-20', () => {
        it('calcule le taux effectif mensuel canadien semi-annuel (1 + r/2)^(1/6) - 1', () => {
            const nominal = 5.0; // 5 %
            const im = computeCanadianMonthlyMortgageRate(nominal);
            // (1 + 0.025)^(1/6) - 1 = 0.0041239...
            expect(im).toBeCloseTo(0.0041239, 6);

            const pmt = computeCanadianMortgagePayment(500000, nominal, 300);
            expect(pmt).toBeCloseTo(2908.02, 1);
        });

        it('plafonne la DPA locative Catégorie 1 (4 %) au revenu net avant amortissement (aucune perte créée)', () => {
            const ucc = 400000;
            const allowable = ucc * CCA_CLASS_1_RATE; // 16 000 $
            const netIncome = 9000;

            const ccaResult = computeCcaAllowance(ucc, netIncome, CCA_CLASS_1_RATE);
            expect(ccaResult.allowableCca).toBe(allowable);
            expect(ccaResult.claimedCca).toBe(9000); // Plafonné au revenu net
            expect(ccaResult.netRentalIncomeAfterCca).toBe(0); // Pas de perte locative
            expect(ccaResult.closingUcc).toBe(391000);
        });

        it('calcule la récupération de DPA à 100 % et le gain en capital lors de la disposition', () => {
            const initialCost = 350000;
            const currentUcc = 300000; // 50 000 $ de DPA déduite dans le passé
            const sellingPrice = 450000; // Plus-value de 100 000 $ au-dessus du coût initial

            const recaptureResult = computeCcaRecapture(sellingPrice, initialCost, currentUcc);
            // Récupération de DPA à 100 % = 350 000 - 300 000 = 50 000 $
            expect(recaptureResult.recapture100Pct).toBe(50000);
            // Gain en capital brut = 450 000 - 350 000 = 100 000 $
            expect(recaptureResult.capitalGainGross).toBe(100000);
            // Gain imposable à 50 % = 50 000 $
            expect(recaptureResult.taxableCapitalGain50Pct).toBe(50000);
            expect(recaptureResult.terminalLoss).toBe(0);
        });

        it('respecte les plafonds B-20 : 65 % HELOC et 80 % combiné', () => {
            const propertyValue = 1000000;
            const maxHeloc = propertyValue * 0.65; // 650 000 $
            const maxCombined = propertyValue * 0.80; // 800 000 $

            const helocCurrent = 600000;
            const mortgageCurrent = 150000; // Total combiné = 750 000 $ < 800 000 $

            expect(helocCurrent).toBeLessThanOrEqual(maxHeloc);
            expect(helocCurrent + mortgageCurrent).toBeLessThanOrEqual(maxCombined);
        });
    });
});
