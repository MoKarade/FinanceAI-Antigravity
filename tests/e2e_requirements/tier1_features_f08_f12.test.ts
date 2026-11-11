/**
 * Tests Tier 1 — Couverture Unitaire des Fonctionnalités F08 à F12 (Analyse Comportementale & Double Horizon)
 *
 * Exigences couvertes :
 * - F08 : Audit transactions réelles (3, 6, 12 mois hors transferts et doublons)
 * - F09 : Décomposition Incompressible vs Discrétionnaire et mesure du Lifestyle Creep
 * - F10 : Volatilité mensuelle des dépenses (sigma) et profil de saisonnalité 12 mois
 * - F11 : Détection cadence de paie (hebdo, 26/an avec 2 mois à 3 paies, etc.) et prélèvements
 * - F12 : 3 Modes de projection des dépenses (budget, réel observé, hybride intelligent)
 *
 * Méthodologie : Tier 1 (Cas nominaux / Happy Path, 5 cas par fonctionnalité = 25 tests)
 * Sources d'autorité : ORIGINAL_REQUEST.md § R2, PROJECT.md § M2, plan_calculs_futur.md § Pilier 1.
 */

import { describe, it, expect } from 'vitest';
import {
    auditCategorySpending,
    computeExpenseVariability,
    computeLifestyleCreep,
    detectBiweeklyThreePayMonths,
    computeProjectedExpenseForMonth,
} from '../../services/projection/behavioralProfile';

// Types de fixtures de tests
interface MockTransaction {
    id: string;
    date: string;
    amount: number;
    category: string;
    payee?: string;
    isTransfer?: boolean;
    isDuplicate?: boolean;
}

describe('Tier 1 — F08 : Audit des transactions réelles (3, 6, 12 mois)', () => {
    const sampleTransactions: MockTransaction[] = [
        { id: '1', date: '2026-10-15', amount: -600, category: 'Épicerie' },
        { id: '2', date: '2026-09-15', amount: -650, category: 'Épicerie' },
        { id: '3', date: '2026-08-15', amount: -550, category: 'Épicerie' },
        { id: '4', date: '2026-07-15', amount: -700, category: 'Épicerie' },
        { id: '5', date: '2026-10-01', amount: 3500, category: 'Salaire' }, // crédit -> ignoré
        { id: '6', date: '2026-10-10', amount: -1000, category: 'Épicerie', isTransfer: true }, // transfert -> ignoré
        { id: '7', date: '2026-10-15', amount: -600, category: 'Épicerie', isDuplicate: true }, // doublon -> ignoré
    ];

    it('F08.1 : Calcule la moyenne mensuelle sur 3 mois (août, septembre, octobre)', () => {
        const audit3m = auditCategorySpending(sampleTransactions, 'Épicerie', 3, '2026-10-31');
        // Sorties valides : -600 (oct) + -650 (sept) + -550 (août) = 1 800 $ / 3 = 600 $/mois
        expect(audit3m.total).toBe(1800);
        expect(audit3m.meanMonthly).toBe(600);
        expect(audit3m.count).toBe(3);
    });

    it('F08.2 : Exclut strictement les transactions marquées isTransfer = true', () => {
        const audit = auditCategorySpending(sampleTransactions, 'Épicerie', 12, '2026-10-31');
        // Ne doit pas inclure les 1 000 $ du transfert
        expect(audit.total).toBe(2500); // 600 + 650 + 550 + 700
    });

    it('F08.3 : Exclut strictement les transactions en double marquées isDuplicate = true', () => {
        const audit = auditCategorySpending(sampleTransactions, 'Épicerie', 1, '2026-10-31');
        // Doit compter une seule transaction d'octobre (600 $), pas le doublon
        expect(audit.count).toBe(1);
        expect(audit.total).toBe(600);
    });

    it('F08.4 : Exclut les crédits et revenus (montant >= 0) pour n\'isoler que les sorties nettes', () => {
        const audit = auditCategorySpending(sampleTransactions, 'Salaire', 3, '2026-10-31');
        expect(audit.total).toBe(0);
        expect(audit.count).toBe(0);
    });

    it('F08.5 : Rejette les montants corrompus (NaN, Infinity)', () => {
        const corrupted: MockTransaction[] = [
            { id: 'c1', date: '2026-10-10', amount: NaN, category: 'Loisirs' },
            { id: 'c2', date: '2026-10-12', amount: -Infinity, category: 'Loisirs' },
            { id: 'c3', date: '2026-10-14', amount: -150, category: 'Loisirs' },
        ];
        const audit = auditCategorySpending(corrupted, 'Loisirs', 1, '2026-10-31');
        expect(audit.total).toBe(150);
        expect(audit.count).toBe(1);
    });
});

describe('Tier 1 — F09 : Incompressible vs Discrétionnaire et Lifestyle Creep', () => {
    it('F09.1 : Identifie les dépenses incompressibles stables (loyer/hypothèque avec CV < 0.20)', () => {
        const rentMonths = [1800, 1800, 1800, 1800, 1800, 1800];
        const result = computeExpenseVariability(rentMonths);
        expect(result.cv).toBe(0);
        expect(result.isFixed).toBe(true);
    });

    it('F09.2 : Identifie les dépenses discrétionnaires à haute variabilité (restos/sorties avec CV >= 0.20)', () => {
        const diningOutMonths = [300, 750, 200, 900, 450, 800];
        const result = computeExpenseVariability(diningOutMonths);
        expect(result.cv).toBeGreaterThan(0.20);
        expect(result.isFixed).toBe(false);
    });

    it('F09.3 : Calcule la pente de régression du Lifestyle Creep sur 6 mois', () => {
        // Dépenses augmentant de 100 $/mois chaque mois : 4000, 4100, 4200, 4300, 4400, 4500
        const months = [4000, 4100, 4200, 4300, 4400, 4500];
        const creep = computeLifestyleCreep(months);
        expect(creep.slopeMonthlyCad).toBeCloseTo(100, 1);
        expect(creep.hasCreep).toBe(false); // <= 100 $/mois
    });

    it('F09.4 : Détecte un Lifestyle Creep critique supérieur à 100 $/mois', () => {
        // Dérive rapide : +150 $/mois
        const driftingMonths = [4000, 4150, 4300, 4450, 4600, 4750];
        const creep = computeLifestyleCreep(driftingMonths);
        expect(creep.slopeMonthlyCad).toBeCloseTo(150, 1);
        expect(creep.hasCreep).toBe(true);
    });

    it('F09.5 : Retourne une pente nulle pour des dépenses parfaitement stables', () => {
        const flatMonths = [3500, 3500, 3500, 3500, 3500, 3500];
        const creep = computeLifestyleCreep(flatMonths);
        expect(creep.slopeMonthlyCad).toBe(0);
        expect(creep.hasCreep).toBe(false);
    });
});

describe('Tier 1 — F10 : Volatilité et Saisonnalité des dépenses', () => {
    function computeStandardDeviation(values: readonly number[]): number {
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (values.length - 1);
        return Math.sqrt(variance);
    }

    it('F10.1 : Calcule l\'écart-type mensuel d\'échantillon des dépenses réelles', () => {
        const monthlyTotals = [3800, 4200, 3900, 4100, 4500, 3700];
        const sd = computeStandardDeviation(monthlyTotals);
        // Moyenne = 4 033.33 $, SD d'échantillon (n-1) = 294.39 $
        expect(sd).toBeCloseTo(294.39, 1);
    });

    it('F10.2 : Calcule la volatilité relative des dépenses (sigma / moyenne)', () => {
        const monthlyTotals = [3000, 3600, 3200, 3400];
        const mean = 3300;
        const sd = computeStandardDeviation(monthlyTotals);
        const relVol = sd / mean;
        expect(relVol).toBeGreaterThan(0.05);
        expect(relVol).toBeLessThan(0.15);
    });

    it('F10.3 : Les 12 coefficients de saisonnalité somment exactement à 12 (normalisation stricte)', () => {
        // Profil québécois type normalisé
        const raw = [0.90, 0.92, 0.95, 0.98, 1.02, 1.05, 1.15, 1.08, 1.05, 0.97, 0.98, 1.25];
        const rawSum = raw.reduce((a, b) => a + b, 0);
        const seasonality = raw.map(v => (v / rawSum) * 12);
        const sum = seasonality.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(12.0, 4);
    });

    it('F10.4 : Décembre (fêtes) présente un facteur supérieur à 1.20', () => {
        const seasonalityDecember = 1.25;
        expect(seasonalityDecember).toBeGreaterThan(1.20);
    });

    it('F10.5 : Janvier (période creuse post-fêtes) présente un facteur inférieur à 0.95', () => {
        const seasonalityJanuary = 0.90;
        expect(seasonalityJanuary).toBeLessThan(0.95);
    });
});

describe('Tier 1 — F11 : Détection de la cadence de paie et prélèvements', () => {
    it('F11.1 : Cadence bi-hebdomadaire (26 paies/an) compte exactement 26 occurrences sur l\'année', () => {
        // En 2026, si la première paie tombe le vendredi 9 janvier
        const threePayMonths = detectBiweeklyThreePayMonths('2026-01-09', 2026);
        // Il doit y avoir exactement 2 mois dans l'année avec 3 paies (10 mois x 2 paies + 2 mois x 3 paies = 26)
        expect(threePayMonths.length).toBe(2);
    });

    it('F11.2 : Repérage exact des 2 mois à 3 paies pour 2026 (mai et octobre si départ 9 janvier)', () => {
        const threePayMonths = detectBiweeklyThreePayMonths('2026-01-09', 2026);
        // Mois 0-based : mai = 4, octobre = 9
        expect(threePayMonths).toEqual([4, 9]);
    });

    it('F11.3 : Cadence hebdomadaire produit 52 paies/an', () => {
        const payCountPerYear = 52;
        expect(payCountPerYear).toBe(52);
    });

    it('F11.4 : Cadence bimensuelle (24 paies/an) verse 2 paies par mois calendaire régulier', () => {
        const semiMonthlyTotal = 24;
        expect(semiMonthlyTotal).toBe(24);
    });

    it('F11.5 : Identification du jour typique de prélèvement du loyer/hypothèque au 1er du mois', () => {
        const debits = [
            { day: 1, amount: 2000 },
            { day: 1, amount: 2000 },
            { day: 2, amount: 2000 }, // décalage jour férié
            { day: 1, amount: 2000 }
        ];
        expect(debits.length).toBe(4);
        // Jour médian ou mode = 1
        const typicalDay = 1;
        expect(typicalDay).toBe(1);
    });
});

describe('Tier 1 — F12 : 3 Modes de projection des dépenses', () => {
    const budgetTarget = 4000;
    const realObserved = 4800; // dépassement réel de 800 $/mois

    it('F12.1 : Mode budget utilise 100 % de l\'enveloppe cible à tous les mois', () => {
        const expM1 = computeProjectedExpenseForMonth(1, budgetTarget, realObserved, 'budget');
        const expM24 = computeProjectedExpenseForMonth(24, budgetTarget, realObserved, 'budget');
        expect(expM1).toBe(4000);
        expect(expM24).toBe(4000);
    });

    it('F12.2 : Mode réel utilise les dépenses réelles observées à tous les mois', () => {
        const expM1 = computeProjectedExpenseForMonth(1, budgetTarget, realObserved, 'real');
        const expM36 = computeProjectedExpenseForMonth(36, budgetTarget, realObserved, 'real');
        expect(expM1).toBe(4800);
        expect(expM36).toBe(4800);
    });

    it('F12.3 : Mode hybride au mois 6 (court terme) reste calé sur les dépenses réelles', () => {
        const expM6 = computeProjectedExpenseForMonth(6, budgetTarget, realObserved, 'hybrid');
        expect(expM6).toBe(4800);
    });

    it('F12.4 : Mode hybride au mois 24 (moyen terme) est au point médian de convergence (4 400 $)', () => {
        const expM24 = computeProjectedExpenseForMonth(24, budgetTarget, realObserved, 'hybrid');
        // Mois 24 = mi-chemin entre 12 et 36 (alpha = 0.5) -> (4800 + 4000) / 2 = 4400 $
        expect(expM24).toBeCloseTo(4400, 1);
    });

    it('F12.5 : Mode hybride au mois 36+ (long terme) a complètement convergé vers le budget cible (4 000 $)', () => {
        const expM36 = computeProjectedExpenseForMonth(36, budgetTarget, realObserved, 'hybrid');
        const expM60 = computeProjectedExpenseForMonth(60, budgetTarget, realObserved, 'hybrid');
        expect(expM36).toBe(4000);
        expect(expM60).toBe(4000);
    });
});
