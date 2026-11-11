/**
 * tests/projection/adversarial_tax_jalon1.test.ts
 *
 * HARNAIS DE STRESS ADVERSARIAL — Jalon 1 (Fiscalité québécoise et canadienne 100 % sourcée)
 * Agent : teamwork_challenger_m1_1
 *
 * Ce fichier soumet le code de production à des épreuves contradictoires et indépendantes :
 * 1. Dégressivité du BPA fédéral LIR 118(1.1) (frontières exactes, bornes min/max, indexation, valeurs aberrantes)
 * 2. Cotisations travailleur autonome RRQ & RQAP (double part 12,60 % et 8,00 %, MGA/MGAS, mixte salaire + autonome)
 * 3. Bipalier RQAP 70/55 (bascule mois 5/6, plafonnement strict MRA 103k, absence totale de cotisations sur prestation)
 * 4. Frais de garde Annexe C QC & T778 Ligne 21400 (couples asymétriques, 2/3 des revenus gagnés, grille 67-78 %)
 */

import { describe, it, expect } from 'vitest';
import {
    computeFederalBpa,
    computeFederalTax,
    calculateFiscalReport,
    BASIC_PERSONAL_AMOUNT_FED,
    BASIC_PERSONAL_AMOUNT_FED_MIN,
    FED_BPA_PHASEOUT_START,
    FED_BPA_PHASEOUT_END,
    FED_NONREFUNDABLE_RATE,
    RRQ_MPE,
    RRQ_YAMPE,
    RQAP_MAX_INCOME,
} from '../../utils/tax';
import {
    computeRqapBenefits,
    computeQuebecChildcareCreditRate,
    computeFederalChildcareDeduction,
    computeChildcareSupport,
    RQAP_TIER1_RATE,
    RQAP_TIER2_RATE,
} from '../../services/projection/childrenReee';

describe('Épreuve Adversariale 1 : Dégressivité du BPA fédéral (LIR 118(1.1))', () => {
    it('1.1 : Maintient strictement le BPA maximal (16 452 $) sous la borne basse de 181 440 $', () => {
        expect(computeFederalBpa(0)).toBe(16452);
        expect(computeFederalBpa(50000)).toBe(16452);
        expect(computeFederalBpa(100000)).toBe(16452);
        expect(computeFederalBpa(181439)).toBe(16452);
        expect(computeFederalBpa(181439.99)).toBeCloseTo(16452, 2);
    });

    it('1.2 : À la frontière exacte de 181 440 $, le BPA est exactement égal au maximum de 16 452 $', () => {
        expect(computeFederalBpa(FED_BPA_PHASEOUT_START)).toBe(16452);
        expect(computeFederalBpa(181440)).toBe(BASIC_PERSONAL_AMOUNT_FED);
    });

    it('1.3 : Au point d\'épreuve spécifique de 220 000 $, calcule la réduction linéaire exacte', () => {
        // Formule légale : 16 452 - 1 623 * (220 000 - 181 440) / (258 482 - 181 440)
        // 220 000 - 181 440 = 38 560
        // 258 482 - 181 440 = 77 042
        // Fraction = 38 560 / 77 042 ≈ 0.5005062173879183
        // Réduction = 1 623 * 0.5005062173879183 ≈ 812.3215908205914
        // BPA attendu = 16 452 - 812.3215908205914 ≈ 15 639.678409179409
        const bpa220k = computeFederalBpa(220000);
        expect(bpa220k).toBeCloseTo(15639.68, 2);
        expect(bpa220k).toBeGreaterThan(14829);
        expect(bpa220k).toBeLessThan(16452);
    });

    it('1.4 : À la frontière exacte de 258 482 $, le BPA atteint exactement le plancher de 14 829 $', () => {
        expect(computeFederalBpa(FED_BPA_PHASEOUT_END)).toBe(14829);
        expect(computeFederalBpa(258482)).toBe(BASIC_PERSONAL_AMOUNT_FED_MIN);
    });

    it('1.5 : Au-delà de 258 482 $, le BPA ne descend JAMAIS sous le plancher légal de 14 829 $', () => {
        expect(computeFederalBpa(258482.01)).toBe(14829);
        expect(computeFederalBpa(258483)).toBe(14829);
        expect(computeFederalBpa(300000)).toBe(14829);
        expect(computeFederalBpa(1000000)).toBe(14829);
        expect(computeFederalBpa(10000000)).toBe(14829);
    });

    it('1.6 : En présence de valeurs limites ou aberrantes (négatif, NaN, infini), le BPA reste borné dans [14 829 $, 16 452 $]', () => {
        expect(computeFederalBpa(-50000)).toBe(16452);
        expect(computeFederalBpa(Number.NaN)).toBe(16452);
        expect(computeFederalBpa(Infinity)).toBe(14829);
    });

    it('1.7 : L\'indexation de l\'inflation redimensionne proportionnellement les seuils et les montants BPA', () => {
        const inflationFactor = 1.05; // Inflation de 5 %
        const bpaUnderIndexed = computeFederalBpa(181440 * inflationFactor - 1, inflationFactor);
        const bpaAtLow = computeFederalBpa(181440 * inflationFactor, inflationFactor);
        const bpaAtHigh = computeFederalBpa(258482 * inflationFactor, inflationFactor);
        const bpaOverIndexed = computeFederalBpa(258482 * inflationFactor + 100, inflationFactor);

        expect(bpaUnderIndexed).toBeCloseTo(16452 * 1.05, 2);
        expect(bpaAtLow).toBeCloseTo(16452 * 1.05, 2);
        expect(bpaAtHigh).toBeCloseTo(14829 * 1.05, 2);
        expect(bpaOverIndexed).toBeCloseTo(14829 * 1.05, 2);
    });

    it('1.8 : Vérifie l\'impact du BPA dégressif sur l\'impôt fédéral brut dans computeFederalTax', () => {
        // À 180 000 $ (BPA plein 16 452 $ -> crédit 16 452 * 15 % = 2 467.80 $)
        const tax180k = computeFederalTax(180000);
        expect(tax180k).toBeGreaterThan(0);
        // À 260 000 $ (BPA plancher 14 829 $ -> crédit 14 829 * 15 % = 2 224.35 $)
        const tax260k = computeFederalTax(260000);

        // Si le BPA n'était pas dégressif, le crédit serait de 2 467.80 $, donc l'impôt serait plus bas de 243.45 $
        const tax260kWithFullBpa = computeFederalTax(260000, 16452);
        const diffCred = tax260k - tax260kWithFullBpa;
        expect(diffCred).toBeCloseTo((16452 - 14829) * FED_NONREFUNDABLE_RATE, 2); // 243.45 $
    });
});

describe('Épreuve Adversariale 2 : Cotisations sociales travailleur autonome (Double part RRQ 12,60 % & 8,00 %)', () => {
    // Calculateur de référence autonome pur (employmentIncome = 0)
    function getSelfEmployedReport(income: number) {
        return calculateFiscalReport(
            income,
            0,
            0,
            2026,
            false,
            undefined,
            0, // employmentIncome = 0
            1, // realDeflator = 1
            income, // selfEmploymentIncome = income
        );
    }

    it('2.1 : Revenu autonome de 0 $ produit exactement 0 $ de cotisations RRQ', () => {
        const report = getSelfEmployedReport(0);
        expect(report.rrqVolet1).toBe(0);
        expect(report.rrqVolet2).toBe(0);
        expect(report.rrq).toBe(0);
        expect(report.rqap).toBe(0);
    });

    it('2.2 : Revenu autonome de 50 000 $ applique la double part de base (12,60 %) sur (50 000 - 3 500) = 46 500 $', () => {
        const report = getSelfEmployedReport(50000);
        // Base cotisable = 50 000 - 3 500 = 46 500 $
        // Double part RRQ = 46 500 * (6.30 % * 2) = 46 500 * 12.60 % = 5 859.00 $
        const expectedVolet1 = 46500 * 0.126;
        expect(report.rrqVolet1).toBeCloseTo(expectedVolet1, 2);
        expect(report.rrqVolet2).toBe(0);
        expect(report.rrq).toBeCloseTo(5859.00, 2);
    });

    it('2.3 : Revenu autonome au MGA (74 600 $) maximise le Volet 1 à exactement 8 958,60 $ avec Volet 2 nul', () => {
        const report = getSelfEmployedReport(RRQ_MPE);
        // Base cotisable = 74 600 - 3 500 = 71 100 $
        // Volet 1 = 71 100 * 12.60 % = 8 958.60 $
        const expectedVolet1 = (74600 - 3500) * 0.126;
        expect(report.rrqVolet1).toBeCloseTo(expectedVolet1, 2);
        expect(report.rrqVolet1).toBeCloseTo(8958.60, 2);
        expect(report.rrqVolet2).toBe(0);
        expect(report.rrq).toBeCloseTo(8958.60, 2);
    });

    it('2.4 : Revenu autonome au MGAS (85 000 $) maximise le Volet 1 (8 958,60 $) ET le Volet 2 (832,00 $), total 9 790,60 $', () => {
        const report = getSelfEmployedReport(RRQ_YAMPE);
        // Volet 1 = 8 958.60 $
        // Volet 2 = (85 000 - 74 600) * (4.00 % * 2) = 10 400 * 8.00 % = 832.00 $
        const expectedVolet1 = (74600 - 3500) * 0.126;
        const expectedVolet2 = (85000 - 74600) * 0.08;
        expect(report.rrqVolet1).toBeCloseTo(expectedVolet1, 2);
        expect(report.rrqVolet2).toBeCloseTo(expectedVolet2, 2);
        expect(report.rrqVolet2).toBeCloseTo(832.00, 2);
        expect(report.rrq).toBeCloseTo(9790.60, 2);
    });

    it('2.5 : Revenu autonome de 200 000 $ plafonne strictement à 9 790,60 $ (aucun dépassement)', () => {
        const report = getSelfEmployedReport(200000);
        expect(report.rrqVolet1).toBeCloseTo(8958.60, 2);
        expect(report.rrqVolet2).toBeCloseTo(832.00, 2);
        expect(report.rrq).toBeCloseTo(9790.60, 2);
    });

    it('2.6 : Cas mixte — Salarié 50 000 $ + Side income 40 000 $ (Total 90 000 $ > MGAS 85 000 $)', () => {
        const salary = 50000;
        const side = 40000;
        const total = salary + side;
        const report = calculateFiscalReport(
            total,
            0,
            0,
            2026,
            false,
            undefined,
            salary, // employmentIncome
            1,
            side,   // selfEmploymentIncome
        );

        // Salarié paye sur 50 000 $ :
        // Base employé = 50 000 - 3 500 = 46 500 $ @ 6.30 % = 2 929.50 $
        // Travailleur autonome complète le MGA (74 600 - 50 000 = 24 600 $) @ 12.60 % = 3 099.60 $
        // Total Volet 1 = 2 929.50 + 3 099.60 = 6 029.10 $
        expect(report.rrqVolet1).toBeCloseTo(6029.10, 2);

        // Volet 2 :
        // MGA à MGAS = 85 000 - 74 600 = 10 400 $ absorbé entièrement par le side income
        // Double part Volet 2 = 10 400 * 8.00 % = 832.00 $
        expect(report.rrqVolet2).toBeCloseTo(832.00, 2);

        // Total RRQ = 6 029.10 + 832.00 = 6 861.10 $
        expect(report.rrq).toBeCloseTo(6861.10, 2);
    });
});

describe('Épreuve Adversariale 3 : Bipalier RQAP 70/55 & Exemption de cotisations', () => {
    it('3.1 : Semaines 0 à 25 (mois 0 à 5) appliquent strictement le taux de 70 %', () => {
        const salary = 72000; // 6 000 $/mois
        for (let m = 0; m < 6; m++) {
            const benefit = computeRqapBenefits(salary, m, 'base');
            expect(benefit.replacementRate).toBe(RQAP_TIER1_RATE);
            expect(benefit.replacementRate).toBe(0.70);
            expect(benefit.grossMonthlyBenefit).toBeCloseTo((72000 * 0.70) / 12, 2); // 4 200.00 $
        }
    });

    it('3.2 : Semaines 26 à 51 (mois 6 à 11) appliquent strictement le taux de 55 %', () => {
        const salary = 72000;
        for (let m = 6; m < 12; m++) {
            const benefit = computeRqapBenefits(salary, m, 'base');
            expect(benefit.replacementRate).toBe(RQAP_TIER2_RATE);
            expect(benefit.replacementRate).toBe(0.55);
            expect(benefit.grossMonthlyBenefit).toBeCloseTo((72000 * 0.55) / 12, 2); // 3 300.00 $
        }
    });

    it('3.3 : Plafonnement strict au MRA de 103 000 $ pour un salaire très élevé (180 000 $)', () => {
        const highSalary = 180000;
        const bMonth3 = computeRqapBenefits(highSalary, 3, 'base');
        const bMonth8 = computeRqapBenefits(highSalary, 8, 'base');

        const expectedMaxP1 = (RQAP_MAX_INCOME * 0.70) / 12; // 6 008.33 $
        const expectedMaxP2 = (RQAP_MAX_INCOME * 0.55) / 12; // 4 720.83 $

        expect(bMonth3.grossMonthlyBenefit).toBeCloseTo(expectedMaxP1, 2);
        expect(bMonth8.grossMonthlyBenefit).toBeCloseTo(expectedMaxP2, 2);
        expect(bMonth3.grossMonthlyBenefit).toBeCloseTo(6008.33, 2);
        expect(bMonth8.grossMonthlyBenefit).toBeCloseTo(4720.83, 2);
    });

    it('3.4 : Absence TOTALE de cotisations sociales (RRQ, RQAP, AE) sur la prestation RQAP', () => {
        const rqapAnnualGross = 6008.33 * 6 + 4720.83 * 6; // ~64 375 $
        const report = calculateFiscalReport(
            rqapAnnualGross,
            0,
            0,
            2026,
            false,
            undefined,
            0, // employmentIncome: 0 (exemption officielle de cotisations sociales)
        );

        // Zéro cotisation sociale
        expect(report.rrq).toBe(0);
        expect(report.rrqVolet1).toBe(0);
        expect(report.rrqVolet2).toBe(0);
        expect(report.rqap).toBe(0);
        expect(report.ae).toBe(0);
        expect(report.deductionsSource).toBe(0);

        // Mais la prestation demeure pleinement imposable
        expect(report.fedTax).toBeGreaterThan(0);
        expect(report.qcTax).toBeGreaterThan(0);
        expect(report.totalTax).toBeGreaterThan(0);
        expect(report.netIncome).toBe(rqapAnnualGross - report.totalTax);
    });
});

describe('Épreuve Adversariale 4 : Frais de garde Annexe C (QC) & Ligne 21400 / T778 (Fédéral)', () => {
    it('4.1 : Couple avec revenus asymétriques (120 000 $ et 30 000 $) — déduction T778 imputée sur le conjoint à 30 000 $', () => {
        const lowerIncome = 30000;
        const expenseEnfant4 = 10000; // Enfant de 4 ans
        const expenseEnfant8 = 8000;  // Enfant de 8 ans

        // Déduction enfant < 7 ans plafonnée à 8 000 $
        const ded4 = computeFederalChildcareDeduction(expenseEnfant4, 4, lowerIncome);
        expect(ded4).toBe(8000);

        // Déduction enfant 7-16 ans plafonnée à 5 000 $
        const ded8 = computeFederalChildcareDeduction(expenseEnfant8, 8, lowerIncome);
        expect(ded8).toBe(5000);
    });

    it('4.2 : Plafond des 2/3 des revenus gagnés quand le salaire du conjoint le plus bas est faible', () => {
        const lowIncome = 9000; // 2/3 = 6 000 $
        const expense = 8000; // Enfant de 3 ans (plafond d'âge 8 000 $)

        const ded = computeFederalChildcareDeduction(expense, 3, lowIncome);
        // Plafonné par 2/3 * 9 000 = 6 000 $
        expect(ded).toBe(6000);

        // Si revenu gagné = 0 $, déduction = 0 $
        expect(computeFederalChildcareDeduction(expense, 3, 0)).toBe(0);
    });

    it('4.3 : Grille québécoise Annexe C de 78 % à 67 % selon le revenu familial net', () => {
        // Borne inférieure : <= 41 885 $ -> 78 %
        expect(computeQuebecChildcareCreditRate(20000)).toBe(0.78);
        expect(computeQuebecChildcareCreditRate(41885)).toBe(0.78);

        // Borne supérieure : >= 123 000 $ -> 67 %
        expect(computeQuebecChildcareCreditRate(123000)).toBe(0.67);
        expect(computeQuebecChildcareCreditRate(150000)).toBe(0.67);
        expect(computeQuebecChildcareCreditRate(200000)).toBe(0.67);

        // Point médian : (41 885 + 123 000) / 2 = 82 442.50 $ -> 72.50 %
        const midIncome = (41885 + 123000) / 2;
        expect(computeQuebecChildcareCreditRate(midIncome)).toBeCloseTo(0.725, 4);

        // Couple asymétrique 120k + 30k = 150k -> applique 67 %
        expect(computeQuebecChildcareCreditRate(150000)).toBe(0.67);
    });

    it('4.4 : computeChildcareSupport intègre crédit remboursable QC et allègement fédéral', () => {
        const careCost = 12000;
        const familyIncome = 150000; // 120k + 30k
        const lowerIncome = 30000;

        const support = computeChildcareSupport(
            careCost,
            familyIncome,
            1,
            [4], // Enfant de 4 ans (< 7 ans : cap QC 11 965 $, cap Fed 8 000 $)
            lowerIncome,
        );

        // QC eligible = min(12000, 11965) = 11965
        // Taux QC pour 150k = 67 %
        // Crédit QC = 11 965 * 0.67 = 8 016.55 $
        expect(support.qcRefundableCredit).toBeCloseTo(11965 * 0.67, 2);

        // Fédéral : déduction = min(12000, 8000, 2/3 * 30000) = 8000 $
        // Allègement fédéral = 8000 * 0.15 * (1 - 0.165) = 8000 * 0.12525 = 1 002.00 $
        expect(support.fedTaxRelief).toBeCloseTo(8000 * 0.15 * (1 - 0.165), 2);

        // Total aide
        expect(support.totalSupport).toBeCloseTo(support.qcRefundableCredit + support.fedTaxRelief, 2);
        // Coût net annuel
        expect(support.netCostAnnual).toBeCloseTo(careCost - support.totalSupport, 2);
        // Coût net mensuel
        expect(support.netCostMonthly).toBeCloseTo(support.netCostAnnual / 12, 2);
    });
});
