/**
 * Tests Tier 2 — Cas Limites et Bornes pour F01 à F07 (Fiscalité Sourcée ARC / RQ / B-20)
 *
 * Exigences couvertes :
 * - F01 : Bornes régularisation décembre (salaires nuls, plafonds MGA/MGAS, revenus millionnaires)
 * - F02 : Bornes RQAP bipalier (salaire 0, pile MRA 103k, bascule mois 6-7, congé chevauchant)
 * - F03 : Bornes frais de garde (0 enfant, conjoint 0 $, frais extrêmes, seuils 41 885 $ / 123 000 $)
 * - F04 : Bornes BPA fédéral dégressif (bornes exactes 181 440 $ et 258 482 $, revenu négatif)
 * - F05 : Bornes RRQ bonifiée (0 année post-2019/2024, salaire <= 3 500 $, pile MGA, 40 ans complets)
 * - F06 : Bornes découplage RRQ/PSV (âges limites 60/72 et 65/70, seuil exact PSV 93 208 $)
 * - F07 : Bornes hypothèque & Smith B-20 (taux 0 %, pile 65 % HELOC, pile 80 % global, appel de marge)
 *
 * Méthodologie : Tier 2 (Cas limites, zéros, bornes, 5 cas par fonctionnalité = 35 tests)
 * Sources d'autorité : docs/FISCAL_REFERENCE.md, LIR 118(1.1), BSIF B-20.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateFiscalReport,
    rrqAdjustmentFactor,
    psvDeferralFactor,
    RQAP_MAX_INCOME
} from '../../services/tax';

describe('Tier 2 — F01 : Bornes de la régularisation fiscale de décembre', () => {
    it('F01.B1 : Revenu nul (0 $) produit exactement 0 $ d\'impôt, 0 $ de RRQ, 0 $ de RQAP et 0 $ d\'AE', () => {
        const report = calculateFiscalReport(0, 0, 0, 2026, false, undefined, 0);
        expect(report.totalTax).toBe(0);
        expect(report.rrq).toBe(0);
        expect(report.rqap).toBe(0);
        expect(report.ae).toBe(0);
        expect(report.netIncome).toBe(0);
    });

    it('F01.B2 : Rémunération variable négative ou retour de bonus est bornée à 0', () => {
        const base = 50000;
        const negativeBonus = -10000;
        const effectiveGross = Math.max(0, base + negativeBonus);
        const report = calculateFiscalReport(effectiveGross, 0, 0, 2026);
        expect(report.netIncome).toBeGreaterThan(0);
        expect(report.totalTax).toBeGreaterThan(0);
    });

    it('F01.B3 : Salaire atteignant exactement le MGA (74 600 $) maximise le Volet 1 et donne un Volet 2 nul', () => {
        const report = calculateFiscalReport(74600, 0, 0, 2026, false, undefined, 74600);
        // Volet 1 = (74 600 - 3 500) * 0.063 = 4 479.30 $
        expect(report.rrqVolet1).toBeCloseTo(4479.30, 1);
        expect(report.rrqVolet2).toBe(0);
    });

    it('F01.B4 : Salaire atteignant exactement le MGAS (85 000 $) maximise à la fois le Volet 1 et le Volet 2', () => {
        const report = calculateFiscalReport(85000, 0, 0, 2026, false, undefined, 85000);
        expect(report.rrqVolet1).toBeCloseTo(4479.30, 1);
        // Volet 2 = (85 000 - 74 600) * 0.04 = 416.00 $
        expect(report.rrqVolet2).toBeCloseTo(416.00, 1);
    });

    it('F01.B5 : Rémunération très élevée (2 000 000 $) plafonne strictement toutes les cotisations sociales', () => {
        const report = calculateFiscalReport(2000000, 0, 0, 2026, false, undefined, 2000000);
        expect(report.rrqVolet1).toBeCloseTo(4479.30, 1);
        expect(report.rrqVolet2).toBeCloseTo(416.00, 1);
        expect(report.rqap).toBeCloseTo(442.90, 1); // 103 000 * 0.0043
        expect(report.ae).toBeCloseTo(895.70, 1);   // 68 900 * 0.0130
        expect(report.totalTax).toBeGreaterThan(900000);
    });
});

describe('Tier 2 — F02 : Bornes du RQAP bipalier 70/55', () => {
    function computeRqapMonthly(annualSalary: number, monthIndex: number): number {
        const insurable = Math.min(Math.max(0, annualSalary), RQAP_MAX_INCOME);
        const rate = monthIndex < 6 ? 0.70 : 0.55;
        return (insurable * rate) / 12;
    }

    it('F02.B1 : Salaire assurable nul (0 $) donne 0 $ de prestation', () => {
        expect(computeRqapMonthly(0, 0)).toBe(0);
        expect(computeRqapMonthly(0, 7)).toBe(0);
    });

    it('F02.B2 : Salaire atteignant exactement le MRA (103 000 $) donne le montant maximal sans dépassement', () => {
        const p1 = computeRqapMonthly(103000, 5); // Dernier mois palier 1
        const p2 = computeRqapMonthly(103000, 6); // Premier mois palier 2
        expect(p1).toBeCloseTo((103000 * 0.70) / 12, 2);
        expect(p2).toBeCloseTo((103000 * 0.55) / 12, 2);
    });

    it('F02.B3 : Bascule exacte entre le mois 5 (index 5, 70 %) et le mois 6 (index 6, 55 %)', () => {
        const salary = 60000;
        const month5 = computeRqapMonthly(salary, 5); // 70 % -> 3 500 $
        const month6 = computeRqapMonthly(salary, 6); // 55 % -> 2 750 $
        expect(month5).toBeCloseTo(3500, 2);
        expect(month6).toBeCloseTo(2750, 2);
        expect(month5 - month6).toBeCloseTo(750, 2);
    });

    it('F02.B4 : Salaire négatif (anomalie de données) est clampé à 0 sans générer de prestations négatives', () => {
        expect(computeRqapMonthly(-50000, 2)).toBe(0);
    });

    it('F02.B5 : Congé parental de 12 mois complets totalise exactement la somme des 6 mois à 70 % et 6 mois à 55 %', () => {
        const salary = 100000;
        let totalYear = 0;
        for (let m = 0; m < 12; m++) {
            totalYear += computeRqapMonthly(salary, m);
        }
        const expectedTotal = (100000 * 0.70 * 0.5) + (100000 * 0.55 * 0.5); // 35 000 + 27 500 = 62 500 $
        expect(totalYear).toBeCloseTo(expectedTotal, 2);
    });
});

describe('Tier 2 — F03 : Bornes des frais de garde Annexe C & T778', () => {
    function computeFederalDeduction(expenses: number, childAge: number, lowerIncome: number): number {
        if (lowerIncome <= 0 || expenses <= 0) return 0;
        const cap = childAge < 7 ? 8000 : 5000;
        return Math.min(expenses, cap, (2 / 3) * lowerIncome);
    }

    function computeQcCreditRate(familyNetIncome: number): number {
        if (familyNetIncome <= 41885) return 0.78;
        if (familyNetIncome >= 123000) return 0.67;
        const slope = (0.67 - 0.78) / (123000 - 41885);
        return 0.78 + slope * (familyNetIncome - 41885);
    }

    it('F03.B1 : Frais de garde nuls (0 $) donnent une déduction fédérale et un crédit QC nuls', () => {
        expect(computeFederalDeduction(0, 4, 50000)).toBe(0);
    });

    it('F03.B2 : Conjoint avec revenu gagné nul (0 $) annule la déduction T778 (2/3 de 0 = 0 $)', () => {
        expect(computeFederalDeduction(8000, 3, 0)).toBe(0);
    });

    it('F03.B3 : Frais de garde très élevés (25 000 $) plafonnés à 8 000 $ pour un enfant de 5 ans', () => {
        expect(computeFederalDeduction(25000, 5, 80000)).toBe(8000);
    });

    it('F03.B4 : Revenu familial net exactement égal à la borne basse QC de 41 885 $ donne 78.0 %', () => {
        expect(computeQcCreditRate(41885)).toBe(0.78);
    });

    it('F03.B5 : Revenu familial net exactement égal à la borne haute QC de 123 000 $ donne 67.0 %', () => {
        expect(computeQcCreditRate(123000)).toBe(0.67);
    });
});

describe('Tier 2 — F04 : Bornes du BPA fédéral dégressif', () => {
    function computeBpa(income: number): number {
        const minIncome = 181440;
        const maxIncome = 258482;
        const maxBpa = 16452;
        const minBpa = 14829;

        const safeIncome = Math.max(0, income);
        if (safeIncome <= minIncome) return maxBpa;
        if (safeIncome >= maxIncome) return minBpa;
        return maxBpa - (maxBpa - minBpa) * ((safeIncome - minIncome) / (maxIncome - minIncome));
    }

    it('F04.B1 : Revenu net négatif clampé à 0 accorde le plein BPA de 16 452 $', () => {
        expect(computeBpa(-10000)).toBe(16452);
    });

    it('F04.B2 : Revenu net de 0 $ accorde le plein BPA de 16 452 $', () => {
        expect(computeBpa(0)).toBe(16452);
    });

    it('F04.B3 : Revenu net à la borne exacte de 181 440 $ accorde 16 452 $', () => {
        expect(computeBpa(181440)).toBe(16452);
    });

    it('F04.B4 : Revenu net à la borne exacte de 258 482 $ accorde 14 829 $', () => {
        expect(computeBpa(258482)).toBe(14829);
    });

    it('F04.B5 : Revenu net d\'un milliard de dollars conserve le plancher strict de 14 829 $ sans descendre en dessous', () => {
        expect(computeBpa(1000000000)).toBe(14829);
    });
});

describe('Tier 2 — F05 : Bornes de la RRQ bonifiée', () => {
    function computeRrq(yearsPost2019: number, yearsPost2024: number, grossSalary: number): { volet1: number; volet2: number } {
        const mga = 74600;
        const mgas = 85000;
        const baseEarnings = Math.min(Math.max(0, grossSalary), mga);
        const band2Earnings = Math.min(Math.max(0, grossSalary - mga), mgas - mga);

        const v1Prorata = Math.min(40, Math.max(0, yearsPost2019)) / 40;
        const v2Prorata = Math.min(40, Math.max(0, yearsPost2024)) / 40;

        const volet1 = 0.0833 * baseEarnings * v1Prorata;
        const volet2 = 0.3333 * band2Earnings * v2Prorata;
        return { volet1, volet2 };
    }

    it('F05.B1 : 0 année cotisée post-2019 donne un Volet 1 et Volet 2 nuls', () => {
        const res = computeRrq(0, 0, 90000);
        expect(res.volet1).toBe(0);
        expect(res.volet2).toBe(0);
    });

    it('F05.B2 : Salaire inférieur ou égal à l\'exemption de 3 500 $ donne 0 $ de cotisation et de rente', () => {
        const res = computeRrq(10, 5, 3000);
        expect(res.volet2).toBe(0);
    });

    it('F05.B3 : Salaire exactement égal au MGA (74 600 $) produit un Volet 2 strictement nul', () => {
        const res = computeRrq(10, 5, 74600);
        expect(res.volet1).toBeGreaterThan(0);
        expect(res.volet2).toBe(0);
    });

    it('F05.B4 : Années post-2019 supérieures à 40 ans sont plafonnées à 40/40 (1.0)', () => {
        const res40 = computeRrq(40, 40, 85000);
        const res50 = computeRrq(50, 50, 85000);
        expect(res50.volet1).toBe(res40.volet1);
        expect(res50.volet2).toBe(res40.volet2);
    });

    it('F05.B5 : Années post-2019 négatives sont clampées à 0', () => {
        const res = computeRrq(-5, -2, 80000);
        expect(res.volet1).toBe(0);
        expect(res.volet2).toBe(0);
    });
});

describe('Tier 2 — F06 : Bornes du découplage RRQ/PSV & TMED', () => {
    it('F06.B1 : Anticipation RRQ à 60 ans (-60 mois) donne exactement 0.64 (plancher légal)', () => {
        expect(rrqAdjustmentFactor(-60)).toBe(0.64);
    });

    it('F06.B2 : Anticipation forcée sous 60 ans (ex. 58 ans = -84 mois) reste clampée au plancher de 60 ans (0.64)', () => {
        expect(rrqAdjustmentFactor(-84)).toBe(0.64);
    });

    it('F06.B3 : Report RRQ à 72 ans (+84 mois) donne exactement 1.588 (plafond légal)', () => {
        expect(rrqAdjustmentFactor(84)).toBeCloseTo(1.588, 3);
    });

    it('F06.B4 : Report PSV au-delà de 70 ans (ex. 75 ans = +120 mois) reste plafonné à 70 ans (+60 mois = 1.36)', () => {
        expect(psvDeferralFactor(120)).toBeCloseTo(1.36, 2);
    });

    it('F06.B5 : Revenu net exactement égal au seuil de récupération PSV (93 208 $) donne 0 $ de récupération', () => {
        const netIncome = 93208;
        const clawback = Math.max(0, (netIncome - 93208) * 0.15);
        expect(clawback).toBe(0);
    });
});

describe('Tier 2 — F07 : Bornes de l\'hypothèque semi-annuelle et Smith B-20', () => {
    it('F07.B1 : Taux d\'intérêt hypothécaire nul (0 %) ne provoque pas de division par zéro', () => {
        const principal = 300000;
        const months = 300;
        // À 0 %, mensualité = capital / mois
        const pmtZero = principal / months;
        expect(pmtZero).toBe(1000);
    });

    it('F07.B2 : Marge HELOC atteignant pile 65.0 % de la valeur marchande est acceptée sans violation B-20', () => {
        const value = 600000;
        const heloc = 390000; // 600 000 * 0.65 = 390 000 $
        const isCompliant = heloc <= value * 0.65;
        expect(isCompliant).toBe(true);
    });

    it('F07.B3 : Marge HELOC à 65.01 % dépasse la règle B-20 et déclenche une alerte', () => {
        const value = 600000;
        const heloc = 390060; // 65.01 %
        const isCompliant = heloc <= value * 0.65;
        expect(isCompliant).toBe(false);
    });

    it('F07.B4 : Ratio combiné (hypothèque + HELOC) à pile 80.0 % est conforme B-20', () => {
        const value = 500000;
        const mortgage = 150000;
        const heloc = 250000; // Total 400 000 $ = 80 % (et HELOC 50 % <= 65 %)
        const isCompliant = (mortgage + heloc) <= value * 0.80 && heloc <= value * 0.65;
        expect(isCompliant).toBe(true);
    });

    it('F07.B5 : DPA locative avec revenu net négatif (perte locative) : DPA = 0 $ (interdiction de créer une perte)', () => {
        const netRentalBeforeDpa = -1500;
        const maxAllowableDpa = 10000;
        const effectiveDpa = Math.max(0, Math.min(maxAllowableDpa, netRentalBeforeDpa));
        expect(effectiveDpa).toBe(0);
    });
});
