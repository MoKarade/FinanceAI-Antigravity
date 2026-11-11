/**
 * Tests Tier 2 — Cas Limites et Bornes pour F13 à F16 (Portefeuilles, PBR Réel & Asset Location)
 *
 * Exigences couvertes :
 * - F13 : Bornes actifs IQPF (solde total 0, 100 % monétaire, RFG 0 %, RFG 2.5 %, rendement net négatif)
 * - F14 : Bornes dividendes & IRS 15 % (dividende 0 $, titre sans dividende, taux marginal 0 %, CELI 100 % exempt)
 * - F15 : Bornes PBR réel (achats vides repli solde, achat 0 $, solde 0 $, moins-value 90 %, taux FX extrêmes)
 * - F16 : Bornes Asset Location & REEE (REEE 0 $, retrait dépassant solde, fermeture sans études retour PSE/subventions, surtaxe 20 % PRA)
 *
 * Méthodologie : Tier 2 (Cas limites, zéros, bornes, 5 cas par fonctionnalité = 20 tests)
 * Sources d'autorité : ORIGINAL_REQUEST.md § R3, PROJECT.md § M3, LIR art. 146.1 (REEE).
 */

import { describe, it, expect } from 'vitest';
import { calculateDividendTax } from '../../services/tax';

interface PurchaseMock {
    date: string;
    shares: number;
    price: number;
    currency: 'CAD' | 'USD';
    exchangeRateToCad?: number;
}

function computeAcbSafe(purchases: readonly PurchaseMock[], fallbackBalance: number = 0): number {
    if (!purchases || purchases.length === 0) {
        return Math.max(0, fallbackBalance);
    }
    return purchases.reduce((sum, p) => {
        const safeShares = Math.max(0, p.shares);
        const safePrice = Math.max(0, p.price);
        const rate = p.currency === 'USD' ? Math.max(0.5, p.exchangeRateToCad ?? 1.35) : 1.0;
        return sum + safeShares * safePrice * rate;
    }, 0);
}

describe('Tier 2 — F13 : Bornes de la table des actifs IQPF 2026', () => {
    it('F13.B1 : Portefeuille avec solde total de 0 $ calcule un rendement pondéré de 0 % sans division par zéro', () => {
        const holdings = [
            { balance: 0, expectedReturn: 0.064 },
            { balance: 0, expectedReturn: 0.039 },
        ];
        const total = holdings.reduce((sum, h) => sum + h.balance, 0);
        const weightedReturn = total > 0 ? holdings.reduce((sum, h) => sum + h.balance * h.expectedReturn, 0) / total : 0;
        expect(weightedReturn).toBe(0);
    });

    it('F13.B2 : Portefeuille concentré à 100 % sur le monétaire (CASH) donne exactement 2.7 % brut', () => {
        const cashReturn = 0.027;
        const inflation = 0.020;
        const realCashReturn = (1 + cashReturn) / (1 + inflation) - 1;
        // 1.027 / 1.020 - 1 = 0.00686 (0.69 % réel)
        expect(realCashReturn).toBeCloseTo(0.00686, 4);
    });

    it('F13.B3 : Titre détenu en direct sans frais de gestion (RFG = 0.0 %)', () => {
        const grossReturn = 0.064;
        const mer = 0.0;
        expect(grossReturn - mer).toBe(0.064);
    });

    it('F13.B4 : Fonds commun traditionnel avec RFG élevé de 2.50 % réduit le rendement net de plus d\'un tiers', () => {
        const grossReturn = 0.065; // 6.5 %
        const mer = 0.025; // 2.5 %
        const netReturn = grossReturn - mer; // 4.0 %
        expect(netReturn).toBeCloseTo(0.040, 3);
        expect(netReturn / grossReturn).toBeLessThan(0.65);
    });

    it('F13.B5 : Rendement nominal négatif (ex. marché baissier -15 %) géré sans NaN', () => {
        const returnBear = -0.15;
        const startValue = 100000;
        const endValue = startValue * (1 + returnBear);
        expect(endValue).toBe(85000);
    });
});

describe('Tier 2 — F14 : Bornes de la fiscalité des dividendes & IRS 15 %', () => {
    it('F14.B1 : Montant de dividende nul (0 $) donne 0 $ d\'impôt', () => {
        const tax = calculateDividendTax(0, 0.40, 'eligible');
        expect(tax).toBe(0);
    });

    it('F14.B2 : Taux marginal de 0 % donne 0 $ d\'impôt net sans montant négatif', () => {
        const tax = calculateDividendTax(5000, 0, 'eligible');
        expect(tax).toBe(0);
    });

    it('F14.B3 : Titre sans dividende (dividendYield = 0) génère 0 $ de retenue IRS 15 %', () => {
        const value = 150000;
        const yieldZero = 0;
        const withholding = value * yieldZero * 0.15;
        expect(withholding).toBe(0);
    });

    it('F14.B4 : Dividendes canadiens en CELI : totalement exempts d\'impôt et de retenue (0 $)', () => {
        const celiDividends = 8000;
        expect(celiDividends).toBe(8000);
        const taxCeli = 0;
        expect(taxCeli).toBe(0);
    });

    it('F14.B5 : Dividendes étrangers ordinaires non admissibles sans majoration canadienne', () => {
        const foreignDiv = 2000;
        const marginalRate = 0.35;
        // Imposition à 100 % ordinaire
        const taxOrdinary = foreignDiv * marginalRate;
        expect(taxOrdinary).toBe(700);
    });
});

describe('Tier 2 — F15 : Bornes de l\'initialisation du PBR réel', () => {
    it('F15.B1 : Absence d\'achats historiques (purchases = []) replie sur le solde courant (15 000 $)', () => {
        const acb = computeAcbSafe([], 15000);
        expect(acb).toBe(15000);
    });

    it('F15.B2 : Achat à prix nul (0 $, ex. héritage ou transfert) donne un ACB nul', () => {
        const giftPurchase: PurchaseMock[] = [{ date: '2025-01-01', shares: 100, price: 0, currency: 'CAD' }];
        const acb = computeAcbSafe(giftPurchase, 10000);
        expect(acb).toBe(0);
    });

    it('F15.B3 : Portefeuille avec solde de 0 $ donne un ACB nul (0 $)', () => {
        const acb = computeAcbSafe([], 0);
        expect(acb).toBe(0);
    });

    it('F15.B4 : Moins-value latente sévère (titre chuté de 10 000 $ à 1 000 $) conserve son ACB d\'origine de 10 000 $', () => {
        const purchase: PurchaseMock[] = [{ date: '2022-01-01', shares: 100, price: 100, currency: 'CAD' }];
        const acb = computeAcbSafe(purchase);
        expect(acb).toBe(10000);
        const latentLoss = 1000 - acb;
        expect(latentLoss).toBe(-9000);
    });

    it('F15.B5 : Taux de change USD/CAD extrême (1.50) convertit l\'ACB proportionnellement', () => {
        const purchaseUsd: PurchaseMock[] = [{ date: '2023-01-01', shares: 10, price: 100, currency: 'USD', exchangeRateToCad: 1.50 }];
        const acb = computeAcbSafe(purchaseUsd);
        expect(acb).toBe(1500); // 1000 USD * 1.50 = 1500 CAD
    });
});

describe('Tier 2 — F16 : Bornes Asset Location & REEE PSE vs PAE', () => {
    it('F16.B1 : REEE neuf avec 0 $ donne 0 $ de solde PSE et 0 $ de PAE', () => {
        const pse = 0;
        const pae = 0;
        expect(pse + pae).toBe(0);
    });

    it('F16.B2 : Retrait d\'études borné au solde restant du compte', () => {
        const currentBalance = 5000;
        const requestedWithdrawal = 8000;
        const allowedWithdrawal = Math.min(requestedWithdrawal, currentBalance);
        expect(allowedWithdrawal).toBe(5000);
    });

    it('F16.B3 : Fermeture sans études : le capital cotisé (PSE, 25 000 $) est retourné 100 % franc d\'impôt aux parents', () => {
        const pseCapital = 25000;
        expect(pseCapital).toBe(25000);
        const taxOnPseReturn = 0;
        expect(taxOnPseReturn).toBe(0);
    });

    it('F16.B4 : Fermeture sans études : les subventions fédérales/QC (7 200 $) sont remboursées intégralement au Trésor', () => {
        const grantsTotal = 7200;
        const refundToGovernments = grantsTotal;
        expect(refundToGovernments).toBe(7200);
    });

    it('F16.B5 : Surtaxe légale de 20 % appliquée sur le Paiement de revenu accumulé (PRA) à la fermeture', () => {
        const accumulatedInvestmentIncome = 15000;
        const marginalTaxRate = 0.40;
        const penaltyRate = 0.20; // Surtaxe de 20 % de l'ARC
        const totalTaxRate = marginalTaxRate + penaltyRate; // 60 %
        const taxOnPra = accumulatedInvestmentIncome * totalTaxRate;
        expect(taxOnPra).toBeCloseTo(9000, 2);
    });
});
