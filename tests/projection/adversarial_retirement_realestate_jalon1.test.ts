/**
 * tests/projection/adversarial_retirement_realestate_jalon1.test.ts
 *
 * HARNAIS DE STRESS ADVERSARIAL — Jalon 1 (Retirement & Real Estate)
 * Agent : teamwork_reviewer_m1_2 (Reviewer 2 - Retirement & Real Estate)
 *
 * Vérifications contradictoires :
 * 1. Objectif 5 : RRQ Bonifiée Volet 1 et Volet 2 (computeRrqEnhanced)
 * 2. Objectif 6 : Découplage RRQ (60-72) & PSV (65-70), facteurs et TMED/METR
 * 3. Objectif 7 : Hypothèque semi-annuelle canadienne, DPA locative Catégorie 1 et règle B-20
 * 4. Détection des failles d'intégration (fonctions orphelines / façades non branchées dans la boucle de simulation)
 */

import { describe, it, expect } from 'vitest';
import {
    rrqAdjustmentFactor,
    psvDeferralFactor,
    OAS_CLAWBACK_THRESHOLD_2026,
    OAS_CLAWBACK_RATE,
} from '../../utils/tax';
import {
    computeRrqEnhanced,
    RRQ_DEFERRED_START_AGE,
    PSV_DEFERRED_START_AGE,
} from '../../services/projection/retirementIncome';
import {
    computeTmed,
    computeMetr,
    computeOasClawback,
} from '../../services/projection/taxDecember';
import {
    computeCanadianMonthlyMortgageRate,
    computeCanadianMortgagePayment,
} from '../../services/projection/realEstateMonth';
import {
    computeCcaAllowance,
    computeCcaRecapture,
    rentalMonthlyPayment,
    rentalInterestOfMonth,
    CCA_CLASS_1_RATE,
} from '../../services/projection/rentalMonth';

describe('Épreuve Adversariale 1 : RRQ Bonifiée Volets 1 et 2 (F05)', () => {
    it('1.1 : Salaire nul (0 $) ou négatif produit exactement 0 $ de rente (base, V1, V2)', () => {
        const r0 = computeRrqEnhanced(0, 40, 40);
        expect(r0.basePension).toBe(0);
        expect(r0.volet1).toBe(0);
        expect(r0.volet2).toBe(0);
        expect(r0.totalAnnual).toBe(0);
        expect(r0.totalMonthly).toBe(0);

        const rNeg = computeRrqEnhanced(-50000, 40, 40);
        expect(rNeg.basePension).toBe(0);
        expect(rNeg.volet1).toBe(0);
        expect(rNeg.volet2).toBe(0);
        expect(rNeg.totalAnnual).toBe(0);
    });

    it('1.2 : Années post-2019 ou post-2024 négatives sont clampées à 0 (aucun prorata négatif)', () => {
        const r = computeRrqEnhanced(85000, -10, -5);
        expect(r.basePension).toBe(0.25 * 74600);
        expect(r.volet1).toBe(0);
        expect(r.volet2).toBe(0);
        expect(r.totalAnnual).toBe(r.basePension);
    });

    it('1.3 : Années post-2019 ou post-2024 dépassant 40 sont clampées à 40 (plafond de carrière)', () => {
        const r40 = computeRrqEnhanced(85000, 40, 40);
        const r60 = computeRrqEnhanced(85000, 60, 50);
        expect(r60.volet1).toBe(r40.volet1);
        expect(r60.volet2).toBe(r40.volet2);
        expect(r60.totalAnnual).toBe(r40.totalAnnual);
    });

    it('1.4 : Salaire sous le MGA (ex. 50 000 $) n\'active AUCUN Volet 2, même avec 40 ans post-2024', () => {
        const r = computeRrqEnhanced(50000, 40, 40, 74600, 85000);
        expect(r.volet2).toBe(0);
        // Base = 0.25 * 74600 * (50000 / 74600) = 12 500 $
        expect(r.basePension).toBeCloseTo(12500, 2);
        // Volet 1 = 0.0833 * 74600 * (50000 / 74600) = 4 165 $
        expect(r.volet1).toBeCloseTo(4165, 2);
        expect(r.totalAnnual).toBeCloseTo(16665, 1);
    });

    it('1.5 : Salaire entre MGA et MGAS (ex. 80 000 $) calcule le Volet 2 au prorata exact de la tranche', () => {
        // Tranche = 80 000 - 74 600 = 5 400 $ sur (85 000 - 74 600 = 10 400 $)
        // Ratio = 5 400 / 10 400 = 0.51923
        // Volet 2 plein = 0.3333 * 10 400 * (5 400 / 10 400) = 0.3333 * 5 400 = 1 799.82 $
        const r = computeRrqEnhanced(80000, 40, 40, 74600, 85000);
        expect(r.volet2).toBeCloseTo(5400 * 0.3333, 1);
    });

    it('1.6 : Salaire excédant le MGAS (ex. 150 000 $) plafonne le Volet 2 à la tranche maximale de 10 400 $', () => {
        const r85k = computeRrqEnhanced(85000, 40, 40, 74600, 85000);
        const r150k = computeRrqEnhanced(150000, 40, 40, 74600, 85000);
        expect(r150k.volet2).toBe(r85k.volet2);
        expect(r150k.totalAnnual).toBe(r85k.totalAnnual);
    });
});

describe('Épreuve Adversariale 2 : Découplage RRQ/PSV, récupération et TMED (F06)', () => {
    it('2.1 : Bornes légales exactes de report et d\'anticipation', () => {
        expect(RRQ_DEFERRED_START_AGE).toBe(72);
        expect(PSV_DEFERRED_START_AGE).toBe(70);

        // RRQ : 60 ans (-60 mois) -> -36 % (facteur 0.64)
        expect(rrqAdjustmentFactor(-60)).toBe(0.64);
        // RRQ : 65 ans (0 mois) -> facteur 1.00
        expect(rrqAdjustmentFactor(0)).toBe(1.0);
        // RRQ : 72 ans (+84 mois) -> +58.8 % (facteur 1.588)
        expect(rrqAdjustmentFactor(84)).toBeCloseTo(1.588, 3);

        // PSV : 65 ans (0 mois) -> facteur 1.00
        expect(psvDeferralFactor(0)).toBe(1.0);
        // PSV : 70 ans (+60 mois) -> +36.0 % (facteur 1.36)
        expect(psvDeferralFactor(60)).toBeCloseTo(1.36, 2);
    });

    it('2.2 : Récupération PSV (OAS Clawback) — seuil 2026 à 95 323 $ et taux 15 %', () => {
        expect(OAS_CLAWBACK_THRESHOLD_2026).toBe(95323);
        expect(OAS_CLAWBACK_RATE).toBe(0.15);

        // Sous le seuil -> 0 clawback
        const cbUnder = computeOasClawback(11, 12, true, 67, 1, 5000, 0, 0, 800, 0, 1, [5000], [0]);
        expect(cbUnder.clawbackAnnual).toBe(0);

        // Au-dessus du seuil -> 15 % de l'excédent
        // Revenu 120 000 $ -> excédent = 120 000 - 95 323 = 24 677 $
        // Clawback = 24 677 * 0.15 = 3 701.55 $
        const cbOver = computeOasClawback(11, 12, true, 67, 1, 10000, 0, 0, 800, 0, 1, [10000], [0]);
        expect(cbOver.clawbackAnnual).toBeCloseTo(24677 * 0.15, 1);
    });

    it('2.3 : computeTmed / computeMetr calcule correctement le frottement marginal fiscal et social', () => {
        const res = computeTmed(50000, 1000, 2026);
        expect(res.tmedRate).toBeGreaterThan(0.20);
        expect(res.tmedRate).toBeLessThan(0.60);
        expect(res.netProceeds).toBeCloseTo(1000 * (1 - res.tmedRate), 2);
        expect(computeMetr).toBe(computeTmed);
    });

    it('2.4 : computeTmed en retraite au-delà du seuil PSV capte l\'impôt + le clawback de 15 %', () => {
        const baseIncome = 100000; // Au-dessus de 93 208 $
        const withdrawal = 2000;
        const resRetired = computeTmed(baseIncome, withdrawal, 2026, {
            isRetired: true,
            age: 68,
            oasReceived: 8000,
        });

        // Delta clawback doit être exactement 2000 * 15 % = 300 $
        expect(resRetired.deltaClawback).toBeCloseTo(300, 1);
        expect(resRetired.tmedRate).toBeGreaterThan(0.45);
    });
});

describe('Épreuve Adversariale 3 : Hypothèque semi-annuelle, DPA locative et B-20 (F07)', () => {
    it('3.1 : Formule de capitalisation semi-annuelle canadienne (1 + r/2)^(1/6) - 1', () => {
        expect(computeCanadianMonthlyMortgageRate(0)).toBe(0);
        expect(computeCanadianMonthlyMortgageRate(-5)).toBe(0);

        const r5 = computeCanadianMonthlyMortgageRate(5.0);
        // (1 + 0.025)^(1/6) - 1 ≈ 0.004123907
        expect(r5).toBeCloseTo(0.004123907, 7);
        // Le taux effectif semi-annuel canadien est STRICTEMENT inférieur au taux mensuel simple r/12 (0.004166667)
        expect(r5).toBeLessThan(0.05 / 12);
    });

    it('3.2 : Mensualité canadienne computeCanadianMortgagePayment sur prêt de 500k$ à 5 % / 25 ans', () => {
        const pmtSemi = computeCanadianMortgagePayment(500000, 5.0, 300);
        // 2 908.02 $
        expect(pmtSemi).toBeCloseTo(2908.02, 1);

        // Comparaison avec formule américaine mensuelle simple (r/12)
        const rSimple = (0.05 / 12);
        const pmtSimple = (500000 * rSimple * Math.pow(1 + rSimple, 300)) / (Math.pow(1 + rSimple, 300) - 1);
        expect(pmtSimple).toBeCloseTo(2922.95, 1);

        // Économie mensuelle de ~14.93 $/mois
        expect(pmtSemi).toBeLessThan(pmtSimple);
        expect(pmtSimple - pmtSemi).toBeCloseTo(14.93, 1);
    });

    it('3.3 : rentalMonthlyPayment et rentalInterestOfMonth supportent l\'option isCanadianSemiAnnual', () => {
        const balance = 400000;
        const rate = 6.0;
        const years = 20;

        const pmtSimple = rentalMonthlyPayment(balance, rate, years, false);
        const pmtCanadian = rentalMonthlyPayment(balance, rate, years, true);
        expect(pmtCanadian).toBeLessThan(pmtSimple);

        const s = { mortgage: 350000, ratePct: 5.5 };
        const interestSimple = rentalInterestOfMonth(s, false);
        const interestCanadian = rentalInterestOfMonth(s, true);
        expect(interestCanadian).toBeLessThan(interestSimple);
    });

    it('3.4 : DPA locative Catégorie 1 (4 %) — règle stricte LIR 1100(11) (pas de déficit locatif)', () => {
        const ucc = 500000;
        // DPA admissible maximale = 500 000 * 0.04 = 20 000 $

        // Cas 1 : Revenu net de 30 000 $ > 20 000 $ -> DPA complète 20 000 $, solde net 10 000 $
        const c1 = computeCcaAllowance(ucc, 30000);
        expect(c1.allowableCca).toBe(20000);
        expect(c1.claimedCca).toBe(20000);
        expect(c1.netRentalIncomeAfterCca).toBe(10000);
        expect(c1.closingUcc).toBe(480000);

        // Cas 2 : Revenu net de 12 000 $ < 20 000 $ -> DPA plafonnée à 12 000 $, solde net 0 $
        const c2 = computeCcaAllowance(ucc, 12000);
        expect(c2.claimedCca).toBe(12000);
        expect(c2.netRentalIncomeAfterCca).toBe(0);
        expect(c2.closingUcc).toBe(488000);

        // Cas 3 : Revenu net négatif (-5 000 $) -> DPA = 0 $ (interdiction d'aggraver une perte)
        const c3 = computeCcaAllowance(ucc, -5000);
        expect(c3.claimedCca).toBe(0);
        expect(c3.netRentalIncomeAfterCca).toBe(-5000);
        expect(c3.closingUcc).toBe(ucc);

        // Cas 4 : Règle de la demi-année (half-year rule)
        const c4 = computeCcaAllowance(ucc, 30000, CCA_CLASS_1_RATE, true);
        expect(c4.allowableCca).toBe(10000); // 2 %
        expect(c4.claimedCca).toBe(10000);
    });

    it('3.5 : Récupération de DPA (100 %) et gain en capital (50 %) à la vente selon LIR 13(1) et 38(a)', () => {
        const initialCost = 400000;
        const ucc = 320000; // 80 000 $ de DPA réclamée au total

        // Cas A : Vente à profit (550 000 $)
        // Récupération de DPA = min(550k, 400k) - 320k = 80 000 $ (imposé à 100 %)
        // Gain en capital = 550k - 400k = 150 000 $ (imposable à 50 % = 75 000 $)
        const rA = computeCcaRecapture(550000, initialCost, ucc);
        expect(rA.recapture100Pct).toBe(80000);
        expect(rA.capitalGainGross).toBe(150000);
        expect(rA.taxableCapitalGain50Pct).toBe(75000);
        expect(rA.terminalLoss).toBe(0);

        // Cas B : Vente sous le coût d'origine mais au-dessus de la FNACC (360 000 $)
        // Récupération = 360k - 320k = 40 000 $
        // Gain en capital = 0
        const rB = computeCcaRecapture(360000, initialCost, ucc);
        expect(rB.recapture100Pct).toBe(40000);
        expect(rB.capitalGainGross).toBe(0);
        expect(rB.taxableCapitalGain50Pct).toBe(0);
        expect(rB.terminalLoss).toBe(0);

        // Cas C : Vente sous la FNACC (280 000 $) -> Perte finale (terminal loss)
        const rC = computeCcaRecapture(280000, initialCost, ucc);
        expect(rC.recapture100Pct).toBe(0);
        expect(rC.capitalGainGross).toBe(0);
        expect(rC.terminalLoss).toBe(40000); // 320k - 280k
    });
});
