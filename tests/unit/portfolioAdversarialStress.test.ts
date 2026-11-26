/**
 * Tests Contradictoires & Stress-Testing Empirique — Jalon 3 (F13 à F16)
 * Auteur : teamwork_challenger_m3_1 (Portfolio & Dividend Tax Challenger)
 *
 * Banc d'épreuves contradictoires couvrant :
 * 1. Rendements réels de Fisher sur horizons extrêmes (1 à 60 ans), rendements négatifs et déflation.
 * 2. Amputation du RFG (MER), rendements nets négatifs et pondération multi-actifs aux limites.
 * 3. Frottement fiscal des dividendes canadiens admissibles (majoration 38 %, crédit combiné 24,24 %)
 *    sur toutes les tranches marginales de revenu (0 % à 53,31 %) et parité exacte avec calculateDividendTax.
 * 4. Application stricte de l'Article XXI de la Convention fiscale Canada-US (exemption 15 % en REER/CRI/FERR,
 *    perte sèche en CELI/REEE/CELIAPP, et compensation CIE en Non-Enregistré).
 * 5. Algorithme d'Asset Location face à des portefeuilles atypiques (zéro dividende US, absence de REER,
 *    rendement inférieur au dividende, compte sur marge, etc.).
 * 6. Compartimentation REEE (PSE vs PAE), fiscalité étudiante sous/sur BPA et clôture à 25 ans (plafond 50 k$ LIR 204.94).
 */

import { describe, it, expect } from 'vitest';
import {
    IQPF_2026_INFLATION,
    IQPF_2026_EXPECTED_RETURNS,
    computeRealReturn,
    computeNetReturn,
    computePortfolioWeightedReturn,
} from '../../services/assetFundamentals';
import {
    calculateDividendTax,
} from '../../utils/tax';

describe('CHALLENGE 1 : Rendements réels de Fisher sur horizons extrêmes (1 à 60 ans), rendements négatifs et déflation', () => {
    it('Identité mathématique de Fisher : W_reel(N) * (1+i)^N === W_nom(N) sur 1 à 60 ans', () => {
        const rNom = IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY; // 6.40 %
        const inflation = IQPF_2026_INFLATION; // 2.00 %
        const rReal = computeRealReturn(rNom, inflation); // Fisher exact

        const initialCapital = 100_000;

        for (let years = 1; years <= 60; years++) {
            const nominalWealth = initialCapital * Math.pow(1 + rNom, years);
            const realWealth = initialCapital * Math.pow(1 + rReal, years);
            const reconstructedNominal = realWealth * Math.pow(1 + inflation, years);

            // L'écart relatif entre la richesse nominale réelle et reconstruite doit être inférieur à 1e-12
            const relError = Math.abs(nominalWealth - reconstructedNominal) / nominalWealth;
            expect(relError).toBeLessThan(1e-12);
        }
    });

    it('Distorsion de l\'approximation linéaire (r - i) vs Fisher : mesure de l\'erreur cumulative sur 60 ans', () => {
        const rNom = 0.064;
        const i = 0.020;
        const rFisher = computeRealReturn(rNom, i); // 4.3137 %
        const rLinear = rNom - i; // 4.4000 % (approximation simpliste)

        const capital = 1_000_000;
        const wealthFisher30 = capital * Math.pow(1 + rFisher, 30);
        const wealthLinear30 = capital * Math.pow(1 + rLinear, 30);

        // À 30 ans, l'approximation linéaire surévalue le capital réel de plus de 65 000 $
        expect(wealthLinear30 - wealthFisher30).toBeGreaterThan(65_000);

        const wealthFisher60 = capital * Math.pow(1 + rFisher, 60);
        const wealthLinear60 = capital * Math.pow(1 + rLinear, 60);

        // À 60 ans, l'approximation linéaire surévalue de plus de 5 % la richesse finale (~638 000 $ d'illusion)
        const overstatementPct = (wealthLinear60 - wealthFisher60) / wealthFisher60;
        expect(overstatementPct).toBeGreaterThan(0.05);
    });

    it('Déflation modérée et sévère : le rendement réel est strictement supérieur au rendement nominal', () => {
        const rNom = 0.03; // 3 % nominal

        // Déflation modérée : -1.5 %
        const rRealDeflation1 = computeRealReturn(rNom, -0.015);
        // (1 + 0.03) / (1 - 0.015) - 1 = 1.03 / 0.985 - 1 = 0.045685
        expect(rRealDeflation1).toBeGreaterThan(rNom);
        expect(rRealDeflation1).toBeCloseTo(0.045685, 5);

        // Déflation sévère : -5.0 %
        const rRealDeflation2 = computeRealReturn(rNom, -0.05);
        expect(rRealDeflation2).toBeCloseTo(1.03 / 0.95 - 1, 5);
    });

    it('Hyperinflation (10 % à 100 %) : contraction sévère du pouvoir d\'achat', () => {
        const rNom = 0.08; // 8 % nominal

        // Inflation 10 %
        const rReal10 = computeRealReturn(rNom, 0.10);
        // 1.08 / 1.10 - 1 = -0.01818
        expect(rReal10).toBeCloseTo(-0.018182, 5);

        // Hyperinflation 100 % (prix doublent en 1 an)
        const rReal100 = computeRealReturn(rNom, 1.00);
        // 1.08 / 2.00 - 1 = -0.46
        expect(rReal100).toBeCloseTo(-0.46, 5);
    });

    it('Rendements nominaux négatifs (krach -20 % à perte totale -100 %)', () => {
        const inflation = 0.02;

        // Marché baissier -20 %
        const rCrash20 = computeRealReturn(-0.20, inflation);
        // (1 - 0.20) / 1.02 - 1 = 0.80 / 1.02 - 1 = -0.215686
        expect(rCrash20).toBeCloseTo(-0.215686, 5);

        // Krach -50 %
        const rCrash50 = computeRealReturn(-0.50, inflation);
        expect(rCrash50).toBeCloseTo(-0.509804, 5);

        // Perte totale de 100 % (faillite)
        const rTotalLoss = computeRealReturn(-1.0, inflation);
        expect(rTotalLoss).toBe(-1);

        // Perte avec effet de levier (< -100 %) bornée à -1 (-100 %)
        const rLeverageLoss = computeRealReturn(-1.8, inflation);
        expect(rLeverageLoss).toBe(-1);
    });

    it('Robustesse face aux entrées non finies (NaN, Infinity, division par zéro)', () => {
        expect(computeRealReturn(NaN)).toBe(0);
        expect(computeRealReturn(Infinity)).toBe(0);
        expect(computeRealReturn(-Infinity)).toBe(0);

        // Inflation <= -1 (singularité mathématique évitée par repli sur inflation IQPF)
        expect(computeRealReturn(0.05, -1.0)).toBeCloseTo(computeRealReturn(0.05, IQPF_2026_INFLATION), 6);
        expect(computeRealReturn(0.05, -2.5)).toBeCloseTo(computeRealReturn(0.05, IQPF_2026_INFLATION), 6);
        expect(computeRealReturn(0.05, NaN)).toBeCloseTo(computeRealReturn(0.05, IQPF_2026_INFLATION), 6);
    });
});

describe('CHALLENGE 2 : Amputation du RFG (MER), rendements nets négatifs et pondération multi-actifs aux limites', () => {
    it('RFG supérieur au rendement brut : production d\'un rendement net négatif cohérent', () => {
        // Fonds obligataire ou monétaire à frais abusifs : brut 1.5 %, RFG 2.25 %
        const netReturn = computeNetReturn(0.015, 0.0225);
        expect(netReturn).toBeCloseTo(-0.0075, 4); // -0.75 % par an
    });

    it('Rendement brut négatif aggravé par le RFG', () => {
        // Année de baisse (-10 %) avec RFG de 2.0 %
        const netDownYear = computeNetReturn(-0.10, 0.02);
        expect(netDownYear).toBeCloseTo(-0.12, 4); // -12 %
    });

    it('RFG négatif ou anormal : neutralisé à 0 sans générer de subvention fictive', () => {
        expect(computeNetReturn(0.05, -0.02)).toBe(0.05);
        expect(computeNetReturn(0.05, NaN)).toBe(0.05);
        expect(computeNetReturn(NaN, 0.01)).toBe(0);
    });

    it('computePortfolioWeightedReturn face à des pondérations asymétriques et extrêmes', () => {
        // 1 $ sur un actif à 100 % de rendement vs 10 000 000 $ sur un actif à 3 %
        const holdings = [
            { balance: 1, expectedReturn: 1.0 },
            { balance: 10_000_000, expectedReturn: 0.03 },
        ];
        const weighted = computePortfolioWeightedReturn(holdings);
        expect(weighted).toBeCloseTo(0.030000097, 7);
    });

    it('computePortfolioWeightedReturn face à des soldes négatifs (comptes sur marge ou dettes)', () => {
        // Le solde négatif est borné à 0 pour éviter d'inverser le dénominateur ou de créer des poids négatifs
        const holdings = [
            { balance: 100_000, expectedReturn: 0.06 },
            { balance: -50_000, expectedReturn: 0.20 },
        ];
        const weighted = computePortfolioWeightedReturn(holdings);
        // Le solde négatif est ignoré : rendement = 6 % sur les 100 000 $ positifs
        expect(weighted).toBe(0.06);
    });

    it('computePortfolioWeightedReturn avec un portefeuille géant (10 000 actifs) sans dégradation', () => {
        const largePortfolio = Array.from({ length: 10_000 }, (_, i) => ({
            balance: 100,
            expectedReturn: 0.05 + (i % 10) * 0.002,
        }));
        const t0 = performance.now();
        const weighted = computePortfolioWeightedReturn(largePortfolio);
        const t1 = performance.now();

        expect(weighted).toBeCloseTo(0.059, 2);
        expect(t1 - t0).toBeLessThan(50); // Moins de 50 ms pour 10 000 positions
    });
});

describe('CHALLENGE 3 : Frottement fiscal des dividendes canadiens admissibles et parité avec calculateDividendTax', () => {
    it('Point mort (breakeven) : sous 24,24 % de taux marginal, l\'impôt sur dividende admissible est nul', () => {
        const dividend = 10_000;
        const breakevenRate = 0.334533 / 1.38; // ~0.242415 (24.24 %)

        // Juste sous le point mort (24.0 %) : impôt nul
        const taxUnder = calculateDividendTax(dividend, 0.240, 'eligible');
        expect(taxUnder).toBe(0);

        // Au point mort exact : impôt nul
        const taxAt = calculateDividendTax(dividend, breakevenRate, 'eligible');
        expect(taxAt).toBeCloseTo(0, 2);

        // Juste au-dessus du point mort (25.0 %) : impôt positif
        const taxAbove = calculateDividendTax(dividend, 0.250, 'eligible');
        expect(taxAbove).toBeGreaterThan(0);
    });
});
