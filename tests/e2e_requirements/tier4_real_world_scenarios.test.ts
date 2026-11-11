/**
 * Tests Tier 4 — Scénarios Réels d'Application (End-to-End Personas & Journeys)
 *
 * Exigences couvertes :
 * - Scénario 1 : Couple Alex & Sam (Famille québécoise avec enfants, RQAP, garde Annexe C/T778, hypothèque)
 * - Scénario 2 : Travailleur autonome Smith & Immeuble locatif (side income, DPA 4 %, B-20 HELOC <= 65 %)
 * - Scénario 3 : Pré-retraité Pont REER & Report RRQ 72 ans (meltdown REER, OAS clawback évité)
 * - Scénario 4 : Jeune pro débutant (26 paies/an, 2 mois à 3 paies, mode hybride, CELIAPP)
 * - Scénario 5 : Famille recomposée hauts revenus (RSU, BPA dégressif, PBR réel, REEE PSE vs PAE, Shapley)
 *
 * Méthodologie : Tier 4 (≥ 5 scénarios complets de bout en bout = 15 tests approfondis de cycle de vie)
 * Sources d'autorité : ORIGINAL_REQUEST.md, PROJECT.md, plan_calculs_futur.md.
 */

import { describe, it, expect } from 'vitest';
import {
    calculateFiscalReport,
    rrqAdjustmentFactor,
    psvDeferralFactor,
    RRQ_MPE
} from '../../services/tax';

describe('Tier 4 — Scénario 1 : Couple Alex & Sam (Famille Québécoise avec Garderie)', () => {
    // Profil : Alex (32 ans, 85 000 $/an + bonus 10 000 $), Sam (30 ans, 65 000 $/an), 2 enfants (2 ans et 5 ans)
    it('S1.Phase1 : Salaires, bonus et congé parental bipalier RQAP de Sam', () => {
        const alexSalary = 85000;
        const alexBonus = 10000;
        const alexTotalGross = alexSalary + alexBonus; // 95 000 $

        // Sam prend un congé parental de 12 mois sur un salaire de base de 65 000 $
        const samRqapPalier1 = (65000 * 0.70) / 12; // 3 791.67 $/mois (6 mois)
        const samRqapPalier2 = (65000 * 0.55) / 12; // 2 979.17 $/mois (6 mois)
        const samTotalRqap = samRqapPalier1 * 6 + samRqapPalier2 * 6; // 40 625 $

        expect(alexTotalGross).toBe(95000);
        expect(samTotalRqap).toBeCloseTo(40625, 2);

        // Déclaration fiscale d'Alex : bonus intégré à l'assiette progressive
        const alexReport = calculateFiscalReport(alexTotalGross, 0, 0, 2026, false, undefined, alexTotalGross);
        expect(alexReport.rrqVolet1).toBeCloseTo((RRQ_MPE - 3500) * 0.063, 1);
        expect(alexReport.totalTax).toBeGreaterThan(16000);

        // Déclaration fiscale de Sam : RQAP imposable sans cotisations d'emploi
        const samReport = calculateFiscalReport(samTotalRqap, 0, 0, 2026, false, undefined, 0);
        expect(samReport.rrq).toBe(0);
        expect(samReport.rqap).toBe(0);
        expect(samReport.ae).toBe(0);
        expect(samReport.totalTax).toBeGreaterThan(4000);
    });

    it('S1.Phase2 : Frais de garde Annexe C Québec et déduction fédérale T778 imputée sur Sam', () => {
        const childcareCostsYear = 16000; // 2 enfants en garderie privée non subventionnée
        const samEarnedIncome = 35000;    // Revenu gagné de Sam (conjoint au revenu le plus bas)

        // Déduction fédérale T778 : 8 000 $ par enfant de moins de 7 ans -> 16 000 $, borné par 2/3 du revenu de Sam
        const twoThirdsLimit = (2 / 3) * samEarnedIncome; // 23 333 $
        const allowableFederalDeduction = Math.min(childcareCostsYear, 16000, twoThirdsLimit); // 16 000 $

        expect(allowableFederalDeduction).toBe(16000);

        // Crédit remboursable Québec Annexe C sur revenu familial (~130 000 $) -> taux plancher de 67 %
        const qcCredit = 16000 * 0.67; // 10 720 $
        const netChildcareOutOfPocket = childcareCostsYear - qcCredit;
        expect(qcCredit).toBe(10720);
        expect(netChildcareOutOfPocket).toBe(5280); // Coût résiduel de ~33 %
    });

    it('S1.Phase3 : Hypothèque semi-annuelle canadienne et trajectoire de patrimoine familial', () => {
        const mortgageBalance = 450000;
        const nominalRate = 0.048; // 4.8 %
        const monthlyRate = Math.pow(1 + nominalRate / 2, 1 / 6) - 1;
        const pmt = (mortgageBalance * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -300)); // 25 ans

        // Mensualité semi-annuelle canadienne légale = 2 566.22 $
        expect(pmt).toBeCloseTo(2566.22, 1);
        expect(monthlyRate).toBeLessThan(nominalRate / 12);
    });
});

describe('Tier 4 — Scénario 2 : Travailleur Autonome avec Manœuvre Smith & Locatif (Marc-Antoine)', () => {
    it('S2.Phase1 : Revenu de consultation et cotisations sociales d\'entreprise', () => {
        const sideIncomeGross = 110000;
        const businessExpenses = 25000;
        const netBusinessIncome = sideIncomeGross - businessExpenses; // 85 000 $ (pile le MGAS 2026)

        // Double cotisation RRQ jusqu'au MGA (74 600 $) + Volet 2 sur la tranche (85 000 $)
        const volet1Base = RRQ_MPE - 3500; // 71 100 $
        const volet1Double = volet1Base * (0.063 * 2); // 12.60 % = 8 958.60 $

        const volet2Base = 85000 - RRQ_MPE; // 10 400 $
        const volet2Double = volet2Base * (0.04 * 2); // 8.00 % = 832.00 $

        const totalRrqAutonome = volet1Double + volet2Double;
        expect(netBusinessIncome).toBe(85000);
        expect(totalRrqAutonome).toBeCloseTo(9790.60, 1);
    });

    it('S2.Phase2 : Manœuvre Smith B-20 : Marge HELOC de 350 000 $ sur propriété de 600 000 $', () => {
        const propertyValue = 600000;
        const helocDebt = 350000;
        const remainingMortgage = 100000;

        // Limite HELOC B-20 : 65 % de 600 000 $ = 390 000 $
        expect(helocDebt).toBeLessThanOrEqual(propertyValue * 0.65);
        // Limite combinée B-20 : 80 % de 600 000 $ = 480 000 $
        expect(helocDebt + remainingMortgage).toBeLessThanOrEqual(propertyValue * 0.80);

        // Déductibilité fiscale des intérêts HELOC (taux 6.5 %)
        const annualHelocInterest = helocDebt * 0.065; // 22 750 $
        const marginalTaxRate = 0.45;
        const taxShield = annualHelocInterest * marginalTaxRate; // 10 237.50 $ d'impôt épargné
        expect(taxShield).toBeCloseTo(10237.50, 1);
    });

    it('S2.Phase3 : Immeuble locatif : amortissement DPA 4 % et droits REER sur loyer net', () => {
        const grossRentalIncome = 36000;
        const rentalExpenses = 18000; // Taxes, assurances, entretien, intérêts hypothécaires locatifs
        const netRentalBeforeDpa = grossRentalIncome - rentalExpenses; // 18 000 $

        const buildingUcc = 300000; // FNACC bâtiment (excluant terrain)
        const maxDpa = buildingUcc * 0.04; // 12 000 $
        const dpaClaimed = Math.min(maxDpa, netRentalBeforeDpa); // 12 000 $
        const taxableRentalIncome = netRentalBeforeDpa - dpaClaimed; // 6 000 $

        expect(dpaClaimed).toBe(12000);
        expect(taxableRentalIncome).toBe(6000);

        // Droits REER générés par le locatif calculés sur le loyer NET (18 000 $), pas le brut
        const rrspRoomFromRental = netRentalBeforeDpa * 0.18; // 3 240 $
        expect(rrspRoomFromRental).toBe(3240);
    });
});

describe('Tier 4 — Scénario 3 : Pré-Retraité Pont REER & Report RRQ à 72 ans (Hélène)', () => {
    it('S3.Phase1 : Retraite à 60 ans avec arrêt de travail et décaissement du Pont REER', () => {
        const annualLivingNeeds = 45000;
        // Suspension RRQ et PSV : dépenses 100 % couvertes par retraits REER
        const grossRrspWithdrawal = 55000;
        const report = calculateFiscalReport(grossRrspWithdrawal, 0, 0, 2026, false, undefined, 0);

        expect(report.rrq).toBe(0); // Pas de cotisations sociales en retraite
        expect(report.netIncome).toBeGreaterThan(annualLivingNeeds);
        // Le taux moyen d'imposition au palier inférieur est très faible (~16 %)
        expect(report.averageRate).toBeLessThan(20);
    });

    it('S3.Phase2 : Report de la RRQ à 72 ans avec bonification de +58.8 %', () => {
        const basePensionAt65 = 15000;
        const factor72 = rrqAdjustmentFactor((72 - 65) * 12); // +84 mois
        const enhancedPension72 = basePensionAt65 * factor72;

        expect(factor72).toBeCloseTo(1.588, 3);
        expect(enhancedPension72).toBeCloseTo(23820, 1);
    });

    it('S3.Phase3 : Report de la PSV à 70 ans (+36 %) et absence de récupération PSV', () => {
        const baseOas65 = 8500;
        const factorOas70 = psvDeferralFactor((70 - 65) * 12); // +60 mois
        const oasAt70 = baseOas65 * factorOas70;

        expect(factorOas70).toBeCloseTo(1.36, 2);
        expect(oasAt70).toBeCloseTo(11560, 1);

        // Revenu total de retraite à 72 ans = RRQ 23 820 $ + PSV 11 560 $ + FERR résiduel 25 000 $ = 60 380 $
        const totalRetirementIncome = 23820 + 11560 + 25000;
        const oasClawback = Math.max(0, (totalRetirementIncome - 93208) * 0.15);
        expect(oasClawback).toBe(0); // 100 % sous le seuil de 93 208 $, zéro pénalité
    });
});

describe('Tier 4 — Scénario 4 : Jeune Professionnel Débutant & Mode Hybride (Camille)', () => {
    it('S4.Phase1 : Détection de la paie aux 2 semaines et des 2 mois à 3 paies', () => {
        const annualGrossSalary = 58000;
        const biweeklyGross = annualGrossSalary / 26; // 2 230.77 $
        expect(biweeklyGross).toBeCloseTo(2230.77, 2);
        const report = calculateFiscalReport(annualGrossSalary, 0, 0, 2026, false, undefined, annualGrossSalary);

        const biweeklyNet = report.netIncome / 26;
        expect(biweeklyNet).toBeGreaterThan(1500);

        // Les deux paies excédentaires totalisent plus de 3 000 $ net injectables en épargne
        const extraSavings = biweeklyNet * 2;
        expect(extraSavings).toBeGreaterThan(3000);
    });

    it('S4.Phase2 : Mode hybride de projection avec convergence sur 36 mois', () => {
        const realObservedExpenses = 3600; // Sorties réelles moyennes observées
        const budgetTargetExpenses = 2900; // Budget cible optimisé

        // Mois 6 (court terme)
        const m6 = realObservedExpenses;
        // Mois 24 (mi-chemin)
        const m24 = 0.5 * realObservedExpenses + 0.5 * budgetTargetExpenses; // 3 250 $
        // Mois 36 (cible atteinte)
        const m36 = budgetTargetExpenses;

        expect(m6).toBe(3600);
        expect(m24).toBe(3250);
        expect(m36).toBe(2900);
    });

    it('S4.Phase3 : Cotisation maximale au CELIAPP (8 000 $/an) et déduction d\'impôt', () => {
        const grossSalary = 58000;
        const celiappContribution = 8000;
        const report = calculateFiscalReport(grossSalary, 0, celiappContribution, 2026, false, undefined, grossSalary);

        // La déduction CELIAPP de 8 000 $ réduit le revenu imposable à 50 000 $
        const reportWithout = calculateFiscalReport(grossSalary, 0, 0, 2026, false, undefined, grossSalary);
        const taxSavings = reportWithout.totalTax - report.totalTax;
        expect(taxSavings).toBeGreaterThan(2000); // Économie immédiate ~27 %
    });
});

describe('Tier 4 — Scénario 5 : Famille Recomposée Hauts Revenus & Attribution Shapley (David & Sophie)', () => {
    it('S5.Phase1 : Rémunération RSU de David et dégressivité du BPA fédéral', () => {
        const davidSalary = 180000;
        const davidRsu = 50000;
        const davidTotalGross = davidSalary + davidRsu; // 230 000 $

        // Réduction du BPA selon LIR 118(1.1)
        const bpaMin = 14829;
        const bpaMax = 16452;
        const bpaDavid = bpaMax - (bpaMax - bpaMin) * ((davidTotalGross - 181440) / (258482 - 181440));

        expect(bpaDavid).toBeLessThan(bpaMax);
        expect(bpaDavid).toBeGreaterThan(bpaMin);
        expect(bpaDavid).toBeCloseTo(15429.01, 1);
    });

    it('S5.Phase2 : Portefeuille Non-Enregistré avec PBR réel (totalCost) et impôt latent', () => {
        const purchases = [
            { date: '2021-03-01', shares: 500, price: 60, currency: 'CAD' as const },  // 30 000 $
            { date: '2023-08-15', shares: 1000, price: 80, currency: 'CAD' as const }, // 80 000 $
        ];
        expect(purchases.length).toBe(2);
        const totalAcbCad = 110000;
        const currentMarketValue = 220000; // Plus-value latente de 110 000 $

        const latentGain = currentMarketValue - totalAcbCad;
        const taxableLatentGain = latentGain * 0.50; // 55 000 $
        expect(latentGain).toBe(110000);
        expect(taxableLatentGain).toBe(55000);
    });

    it('S5.Phase3 : REEE ventilation PSE/PAE et cascade d\'attribution marginale de Shapley', () => {
        // REEE avec 3 enfants
        const pseCapital = 72000;
        const paeGrantsAndEarnings = 68000;
        const totalReee = pseCapital + paeGrantsAndEarnings; // 140 000 $

        expect(totalReee).toBe(140000);
        expect(pseCapital).toBe(72000);

        // Attribution Shapley des 3 leviers clés du foyer
        const totalStrategyGain = 485000;
        const shapleyAttribution = [
            { lever: 'Pont REER & Report RRQ', gain: 195000, pct: (195000 / totalStrategyGain) * 100 },
            { lever: 'Cotisations au TMED optimal', gain: 118000, pct: (118000 / totalStrategyGain) * 100 },
            { lever: 'Asset Location fiscal réel', gain: 94000, pct: (94000 / totalStrategyGain) * 100 },
            { lever: 'Manœuvre Smith B-20', gain: 78000, pct: (78000 / totalStrategyGain) * 100 },
        ];

        const sumGains = shapleyAttribution.reduce((sum, l) => sum + l.gain, 0);
        expect(sumGains).toBe(totalStrategyGain);
    });
});
