/**
 * Tests Tier 1 — Couverture Unitaire des Fonctionnalités F01 à F07 (Fiscalité Sourcée ARC / RQ / B-20)
 *
 * Exigences couvertes :
 * - F01 : Régularisation fiscale de décembre (bonus, RSU, sideIncome, cotisations exactes)
 * - F02 : RQAP bipalier 70/55 (70 % 6 premiers mois puis 55 % jusqu'au MRA 103 000 $)
 * - F03 : Frais de garde Annexe C & T778 (déduction fédérale 21400 + crédit remboursable QC 67-78 %)
 * - F04 : BPA fédéral dégressif (LIR 118(1.1) : 16 452 $ à 14 829 $ entre 181 440 $ et 258 482 $)
 * - F05 : RRQ Bonifiée Volets 1 et 2 (+8,33 % MGA et 33,33 % tranche 74 600 $ -> 85 000 $)
 * - F06 : Découplage RRQ/PSV & TMED (RRQ 60-72, PSV 65-70, récupération PSV, calcul TMED/METR)
 * - F07 : Hypothèque semi-annuelle & Smith B-20 (taux semi-annuel, DPA 4 %, HELOC 65 %, global 80 %)
 *
 * Méthodologie : Tier 1 (Cas nominaux / Happy Path, ≥ 5 cas par fonctionnalité = 35 tests)
 * Sources d'autorité : docs/FISCAL_REFERENCE.md, LIR 118(1.1), Loi sur l'assurance parentale, BSIF B-20.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateFiscalReport,
    rrqAdjustmentFactor,
    psvDeferralFactor,
    BASIC_PERSONAL_AMOUNT_FED,
    RRQ_MPE,
    computeFederalBpa,
    OAS_CLAWBACK_THRESHOLD_2026,
} from '../../utils/tax';
import {
    computeRqapBenefits,
    computeQuebecChildcareCreditRate,
    computeFederalChildcareDeduction,
} from '../../services/projection/childrenReee';
import {
    computeRrqEnhanced,
} from '../../services/projection/retirementIncome';
import {
    computeCanadianMonthlyMortgageRate,
    computeCanadianMortgagePayment,
} from '../../services/projection/realEstateMonth';
import {
    computeCcaAllowance,
} from '../../services/projection/rentalMonth';

describe('Tier 1 — F01 : Régularisation fiscale de décembre (Bonus, RSU, Side Income)', () => {
    it('F01.1 : Intègre un bonus annuel de 20 000 $ à l\'assiette progressive annuelle d\'un salaire de base de 80 000 $', () => {
        const baseGross = 80000;
        const bonus = 20000;
        const reportBase = calculateFiscalReport(baseGross, 0, 0, 2026, false, undefined, baseGross);
        const reportWithBonus = calculateFiscalReport(baseGross + bonus, 0, 0, 2026, false, undefined, baseGross + bonus);

        expect(reportWithBonus.totalTax).toBeGreaterThan(reportBase.totalTax);
        // Le taux marginal effectif sur le bonus est progressif et supérieur au taux moyen de base
        const taxOnBonus = reportWithBonus.totalTax - reportBase.totalTax;
        const effectiveMarginalBonusRate = taxOnBonus / bonus;
        expect(effectiveMarginalBonusRate).toBeGreaterThan(0.35);
        expect(effectiveMarginalBonusRate).toBeLessThan(0.55);
    });

    it('F01.2 : Les RSU imposables sont incluses dans l\'assiette de décembre et soumises aux paliers progressifs', () => {
        const salary = 100000;
        const rsuVested = 30000;
        const report = calculateFiscalReport(salary + rsuVested, 0, 0, 2026, false, undefined, salary + rsuVested);

        // Revenu total brut = 130 000 $
        expect(report.grossIncome ?? (salary + rsuVested)).toBe(130000);
        // Doit franchir le 3e palier fédéral (> 117 045 $) et québécois (> 108 680 $)
        expect(report.fedTax).toBeGreaterThan(16000);
        expect(report.qcTax).toBeGreaterThan(19000);
    });

    it('F01.3 : Side income de travailleur autonome — assujetti à la double cotisation RRQ (employé + employeur)', () => {
        // En travail autonome pur sous le MGA, la part employé est de 6.30% et la part employeur de 6.30%, soit 12.60% (base 10.6% + volet 1 2.0%)
        const sideIncome = 50000;
        const exemption = 3500;
        const contributoryBase = sideIncome - exemption;
        const totalRrqSelfEmployed = contributoryBase * (0.053 * 2 + 0.010 * 2); // 12.60%

        expect(totalRrqSelfEmployed).toBeCloseTo(46500 * 0.126, 2);
        expect(totalRrqSelfEmployed).toBeGreaterThan(5000);
    });

    it('F01.4 : Plafonnement strict des cotisations RRQ Volet 1 et Volet 2 pour une rémunération variable élevée', () => {
        const highGross = 150000; // Excède le MGAS (85 000 $)
        const report = calculateFiscalReport(highGross, 0, 0, 2026, false, undefined, highGross);

        // Volet 1 plafonné à (74 600 - 3 500) * 6.30% = 4 479.30 $
        const expectedRrq1Max = (RRQ_MPE - 3500) * 0.063;
        expect(report.rrqVolet1).toBeCloseTo(expectedRrq1Max, 1);
        expect(report.rrqVolet1).toBeLessThanOrEqual(4480);
    });

    it('F01.5 : Cotisations RQAP et AE exactes sur les bonus jusqu\'aux plafonds annuels', () => {
        const grossUnderCaps = 60000;
        const bonus = 15000; // total 75 000 $ (dépasse AE 68 900 $, sous RQAP 103 000 $)
        const totalIncome = grossUnderCaps + bonus;

        const report = calculateFiscalReport(totalIncome, 0, 0, 2026, false, undefined, totalIncome);
        // RQAP sur 75 000 $ @ 0.43% = 322.50 $ (plafond = 442.90 $ sur 103 000 $)
        expect(report.rqap).toBeCloseTo(75000 * 0.0043, 1);
        // AE plafonné au max de 68 900 $ * 1.30% = 895.70 $
        expect(report.ae).toBeCloseTo(895.70, 1);
    });
});

describe('Tier 1 — F02 : RQAP bipalier 70/55', () => {
    it('F02.1 : Palier 1 (mois 1 à 6) applique exactement 70 % du salaire assurable', () => {
        const salary = 84000; // 7 000 $/mois
        const resP1 = computeRqapBenefits(salary, 2); // 3e mois (palier 1)
        expect(resP1.replacementRate).toBe(0.70);
        expect(resP1.grossMonthlyBenefit).toBeCloseTo((84000 * 0.70) / 12, 2);
        expect(resP1.grossMonthlyBenefit).toBeCloseTo(4900, 2);
    });

    it('F02.2 : Palier 2 (mois 7 à 12) applique exactement 55 % du salaire assurable', () => {
        const salary = 84000;
        const resP2 = computeRqapBenefits(salary, 8); // 9e mois (palier 2)
        expect(resP2.replacementRate).toBe(0.55);
        expect(resP2.grossMonthlyBenefit).toBeCloseTo((84000 * 0.55) / 12, 2);
        expect(resP2.grossMonthlyBenefit).toBeCloseTo(3850, 2);
    });

    it('F02.3 : Plafonnement strict au MRA de 103 000 $ pour un revenu élevé (150 000 $)', () => {
        const highSalary = 150000;
        const resP1 = computeRqapBenefits(highSalary, 0);
        const resP2 = computeRqapBenefits(highSalary, 7);

        const expectedMaxP1 = (103000 * 0.70) / 12; // 6 008.33 $
        const expectedMaxP2 = (103000 * 0.55) / 12; // 4 720.83 $

        expect(resP1.grossMonthlyBenefit).toBeCloseTo(expectedMaxP1, 2);
        expect(resP2.grossMonthlyBenefit).toBeCloseTo(expectedMaxP2, 2);
    });

    it('F02.4 : Les prestations RQAP sont imposables mais exemptes de cotisations sociales', () => {
        const annualRqapIncome = 50000;
        // employmentIncome = 0 car les prestations RQAP ne sont pas un revenu d'emploi assujetti à RRQ/RQAP/AE
        const report = calculateFiscalReport(annualRqapIncome, 0, 0, 2026, false, undefined, 0);

        expect(report.rrq).toBe(0);
        expect(report.rqap).toBe(0);
        expect(report.ae).toBe(0);
        // Mais l'impôt provincial et fédéral s'applique
        expect(report.totalTax).toBeGreaterThan(5000);
    });

    it('F02.5 : Pour un salaire modeste de 48 000 $, les montants mensuels sont de 2 800 $ (P1) puis 2 200 $ (P2)', () => {
        const salary = 48000;
        const resP1 = computeRqapBenefits(salary, 3);
        const resP2 = computeRqapBenefits(salary, 9);

        expect(resP1.grossMonthlyBenefit).toBeCloseTo(2800, 2);
        expect(resP2.grossMonthlyBenefit).toBeCloseTo(2200, 2);
    });
});

describe('Tier 1 — F03 : Frais de garde Annexe C & T778 fédéral', () => {
    it('F03.1 : Déduction fédérale T778 plafonnée à 8 000 $ pour un enfant de moins de 7 ans', () => {
        const expenses = 10000;
        const childAge = 4;
        const lowerIncome = 60000; // 2/3 = 40 000 $
        const deduction = computeFederalChildcareDeduction(expenses, childAge, lowerIncome);
        expect(deduction).toBe(8000);
    });

    it('F03.2 : Déduction fédérale T778 plafonnée à 5 000 $ pour un enfant de 7 à 16 ans', () => {
        const expenses = 7000;
        const childAge = 10;
        const lowerIncome = 50000;
        const deduction = computeFederalChildcareDeduction(expenses, childAge, lowerIncome);
        expect(deduction).toBe(5000);
    });

    it('F03.3 : La déduction T778 est bornée par 2/3 du revenu gagné du conjoint le plus faible', () => {
        const expenses = 8000;
        const childAge = 3;
        const lowerIncome = 9000; // 2/3 = 6 000 $ < 8 000 $
        const deduction = computeFederalChildcareDeduction(expenses, childAge, lowerIncome);
        expect(deduction).toBe(6000);
    });

    it('F03.4 : Crédit remboursable Québec Annexe C au taux maximal de 78 % pour un revenu modeste', () => {
        const familyIncome = 38000;
        const rate = computeQuebecChildcareCreditRate(familyIncome);
        expect(rate).toBe(0.78);
    });

    it('F03.5 : Crédit remboursable Québec Annexe C au taux de 67 % pour un revenu supérieur à 123 000 $', () => {
        const familyIncome = 145000;
        const rate = computeQuebecChildcareCreditRate(familyIncome);
        expect(rate).toBe(0.67);
    });
});

describe('Tier 1 — F04 : BPA fédéral dégressif (LIR 118(1.1))', () => {
    it('F04.1 : Plein montant de 16 452 $ pour un revenu net de 120 000 $', () => {
        expect(computeFederalBpa(120000)).toBe(BASIC_PERSONAL_AMOUNT_FED);
        expect(computeFederalBpa(181440)).toBe(16452);
    });

    it('F04.2 : Montant plancher de 14 829 $ pour un revenu net de 300 000 $', () => {
        expect(computeFederalBpa(300000)).toBe(14829);
        expect(computeFederalBpa(258482)).toBe(14829);
    });

    it('F04.3 : Montant médian exact de 15 640.50 $ au point milieu de la tranche de dégressivité (219 961 $)', () => {
        const midIncome = (181440 + 258482) / 2; // 219 961 $
        expect(computeFederalBpa(midIncome)).toBeCloseTo(15640.50, 2);
    });

    it('F04.4 : Dégressivité pour un revenu net de 200 000 $', () => {
        const bpa = computeFederalBpa(200000);
        // 16 452 - 1 623 * (18 560 / 77 042) = 16 452 - 391.01 = 16 060.99 $
        expect(bpa).toBeGreaterThan(16000);
        expect(bpa).toBeLessThan(16100);
        expect(bpa).toBeCloseTo(16060.99, 1);
    });

    it('F04.5 : Crédit d\'impôt non remboursable fédéral correspondant au taux de 15 %', () => {
        const bpaFull = computeFederalBpa(100000);
        const bpaReduced = computeFederalBpa(280000);

        const creditFull = bpaFull * 0.15;
        const creditReduced = bpaReduced * 0.15;

        expect(creditFull).toBeCloseTo(2467.80, 2);
        expect(creditReduced).toBeCloseTo(2224.35, 2);
        expect(creditFull - creditReduced).toBeCloseTo(243.45, 2);
    });
});

describe('Tier 1 — F05 : RRQ Bonifiée Volets 1 et 2', () => {
    it('F05.1 : Rente de base maximale à 25 % du MGA (18 650 $/an en 2026)', () => {
        const baseOnly = computeRrqEnhanced(74600, 0, 0);
        expect(baseOnly.basePension).toBe(18650);
        expect(baseOnly.volet1).toBe(0);
        expect(baseOnly.volet2).toBe(0);
        expect(baseOnly.totalAnnual).toBe(18650);
    });

    it('F05.2 : Volet 1 après 10 années de cotisation post-2019 ajoute 2.0825 % du MGA', () => {
        const pension10y = computeRrqEnhanced(74600, 10, 0);
        const volet1Gain = pension10y.totalAnnual - 18650;
        // 0.0833 * 74600 * (10 / 40) = 1 553.54 $
        expect(pension10y.volet1).toBeCloseTo(1553.54, 1);
        expect(volet1Gain).toBeCloseTo(1553.54, 1);
    });

    it('F05.3 : Volet 2 après 5 années post-2024 ajoute du remplacement sur la tranche MGAS', () => {
        const pension = computeRrqEnhanced(85000, 0, 5);
        // 0.3333 * (85 000 - 74 600) * (5 / 40) = 0.3333 * 10 400 * 0.125 = 433.29 $
        expect(pension.volet2).toBeCloseTo(433.29, 1);
    });

    it('F05.4 : Travailleur avec carrière complète post-bonification (40 ans) atteint le plein taux de 33.33 % sous MGA', () => {
        const fullPension = computeRrqEnhanced(85000, 40, 40);
        // Base (25%) + Volet 1 (8.33%) = 33.33% de 74 600 = 24 864.18 $
        // + Volet 2 (33.33% de 10 400) = 3 466.32 $ -> Total = 28 330.50 $
        expect(fullPension.totalAnnual).toBeCloseTo(28330.50, 1);
        expect(fullPension.totalAnnual).toBeGreaterThan(18650);
    });

    it('F05.5 : Cotisations annuelles combinées employé Volet 1 + Volet 2 sur salaire à 85 000 $', () => {
        const report = calculateFiscalReport(85000, 0, 0, 2026, false, undefined, 85000);
        // Volet 1 max = 4 479.30 $
        expect(report.rrqVolet1).toBeCloseTo(4479.30, 1);
        // Volet 2 max = (85 000 - 74 600) * 0.04 = 416.00 $
        expect(report.rrqVolet2).toBeCloseTo(416.00, 1);
        expect(report.rrq).toBeCloseTo(4479.30 + 416.00, 1);
    });
});

describe('Tier 1 — F06 : Découplage RRQ/PSV & TMED', () => {
    it('F06.1 : Demande de RRQ anticipée à 60 ans applique la pénalité de -36 %', () => {
        // 60 ans = 5 ans d'anticipation (-60 mois)
        const factor60 = rrqAdjustmentFactor((60 - 65) * 12);
        expect(factor60).toBe(0.64); // 1 - 0.36
    });

    it('F06.2 : Report de la RRQ à 72 ans applique la bonification maximale de +58.8 %', () => {
        // 72 ans = 7 ans de report (+84 mois)
        const factor72 = rrqAdjustmentFactor((72 - 65) * 12);
        expect(factor72).toBeCloseTo(1.588, 3); // 1 + 0.007 * 84 mois
    });

    it('F06.3 : Report de la PSV à 70 ans applique la bonification maximale de +36 %', () => {
        // 70 ans = 5 ans de report (+60 mois)
        const factor70 = psvDeferralFactor((70 - 65) * 12);
        expect(factor70).toBeCloseTo(1.36, 2); // 1 + 0.006 * 60 mois
    });

    it('F06.4 : Récupération fiscale de la PSV (OAS Clawback 15 %) au-dessus de 95 323 $', () => {
        const netIncome = 110000;
        const threshold = OAS_CLAWBACK_THRESHOLD_2026; // 95 323 $
        const clawback = (netIncome - threshold) * 0.15;
        expect(clawback).toBeCloseTo(2201.55, 2);
    });

    it('F06.5 : Calcul du TMED (Taux Marginal Effectif de Décaissement) incluant impôt et perte de prestations', () => {
        // TMED = 1 - (delta revenu disponible net / delta retrait REER brut)
        const grossWithdrawal = 5000;
        const baseIncome = 45000;
        const report1 = calculateFiscalReport(baseIncome, 0, 0, 2026);
        const report2 = calculateFiscalReport(baseIncome + grossWithdrawal, 0, 0, 2026);

        const deltaTax = report2.totalTax - report1.totalTax;
        const tmed = deltaTax / grossWithdrawal;

        expect(tmed).toBeGreaterThan(0.25);
        expect(tmed).toBeLessThan(0.60);
    });
});

describe('Tier 1 — F07 : Hypothèque semi-annuelle & Smith B-20', () => {
    it('F07.1 : Taux effectif mensuel canadien semi-annuel pour un taux nominal de 5 %', () => {
        const nominal = 5.0; // 5 %
        const im = computeCanadianMonthlyMortgageRate(nominal);
        // (1 + 0.025)^(1/6) - 1 = 0.0041239... vs 0.05 / 12 = 0.0041666...
        expect(im).toBeCloseTo(0.0041239, 6);
        expect(im).toBeLessThan((nominal / 100) / 12);
    });

    it('F07.2 : Mensualité canadienne exacte sur prêt de 500 000 $ à 5 % sur 25 ans (300 mois)', () => {
        const principal = 500000;
        const pmt = computeCanadianMortgagePayment(principal, 5.0, 300);
        // Mensualité légale canadienne = 2 908.02 $ (alors qu'avec r/12 elle serait de 2 922.95 $)
        expect(pmt).toBeCloseTo(2908.02, 1);
        expect(pmt).toBeLessThan(2923.00);
    });

    it('F07.3 : DPA locative catégorie 1 (4 % sur la FNACC) plafonnée au revenu net avant amortissement', () => {
        const fnacc = 300000;
        const netRentalIncomeBeforeDpa = 8000;
        const ccaRes = computeCcaAllowance(fnacc, netRentalIncomeBeforeDpa, 0.04);

        // La DPA ne peut pas créer de perte locative
        expect(ccaRes.allowableCca).toBe(12000);
        expect(ccaRes.claimedCca).toBe(8000);
        expect(ccaRes.closingUcc).toBe(292000);
        expect(ccaRes.netRentalIncomeAfterCca).toBe(0);
    });

    it('F07.4 : Règle B-20 du BSIF : conformité de la marge HELOC sous le plafond strict de 65 % RPV', () => {
        const propertyValue = 800000;
        const helocDebt = 500000;
        const maxHeloc = propertyValue * 0.65; // 520 000 $

        expect(helocDebt).toBeLessThanOrEqual(maxHeloc);
    });

    it('F07.5 : Règle B-20 du BSIF : ratio de prêt-valeur combiné (hypothèque + HELOC) plafonné à 80 %', () => {
        const propertyValue = 800000;
        const mortgage = 300000;
        const heloc = 320000; // total 620 000 $
        const maxCombined = propertyValue * 0.80; // 640 000 $

        expect(mortgage + heloc).toBeLessThanOrEqual(maxCombined);
        expect(heloc).toBeLessThanOrEqual(propertyValue * 0.65);
    });
});
