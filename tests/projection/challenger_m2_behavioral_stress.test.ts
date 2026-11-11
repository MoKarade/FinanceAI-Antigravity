// tests/projection/challenger_m2_behavioral_stress.test.ts
//
// HARNAIS INDÉPENDANT DE STRESS-TESTING ET VALIDATION CONTRADICTOIRE
// Jalon 2 / Lot 2 : Analyse Comportementale Réelle & Double Horizon (F08 à F12)
//
// Auteur : teamwork_challenger_m2_1 (critic, specialist)
// Objectif : Épreuves contradictoires empiriques, oracles analytiques, fuzz testing et cas dégénérés.

import { describe, it, expect } from 'vitest';
import {
    filterSpendingTransactions,
    auditCategorySpending,
    auditSpendingWindow,
    classifyIncompressibleVsDiscretionary,
    computeLifestyleCreep,
    computeVolatilitySafe,
    computeVolatilityAndSeasonality,
    detectBiweeklyThreePayMonths,
    getCanadianBankHolidays,
    detectRecurringPrelevements,
    computeExpenseConvergenceWeight,
    computeProjectedExpenseForMonth,
    computeProjectedExpenses,
    createDefaultBehavioralProfile,
    QUEBEC_SEASONALITY_FALLBACK_RAW,
} from '../../services/projection/behavioralProfile';
import type { Transaction } from '../../types';

describe('Adversarial Challenger M2 — Harnais de Stress Testing Comportemental', () => {

    // =========================================================================
    // ÉPREUVE 1 : FILTRAGE ADVERSARIAL ET AUDIT DE FENÊTRE (F08)
    // =========================================================================
    describe('Épreuve 1 (F08) : Cas limites de filtrage et intégrité de l\'audit', () => {

        it('1.1 : Transactions à 0.00 $ strictement neutralisées (ni dépense, ni crédit)', () => {
            const txWithZeros: Transaction[] = [
                { id: 1, date: '2026-10-01', amount: 0, category: 'Épicerie', payee: 'Frais nuls', status: 'processed' },
                { id: 2, date: '2026-10-02', amount: -0.00, category: 'Épicerie', payee: 'Frais nuls 2', status: 'processed' },
                { id: 3, date: '2026-10-03', amount: 0.0, category: 'Remboursement', payee: 'Remboursement nul', status: 'processed' },
                { id: 4, date: '2026-10-04', amount: -150.50, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
            ];
            const filtered = filterSpendingTransactions(txWithZeros, '2026-10-01', '2026-10-31');
            expect(filtered.length).toBe(1);
            expect(filtered[0].id).toBe(4);
            expect(filtered[0].amount).toBe(-150.50);
        });

        it('1.2 : Montants fractionnaires au centième et sous-centième préservés exactement', () => {
            const fractionalTx: Transaction[] = [
                { id: 1, date: '2026-10-10', amount: -0.01, category: 'Loisirs', payee: 'Micro-frais', status: 'processed' },
                { id: 2, date: '2026-10-11', amount: -12.3456, category: 'Loisirs', payee: 'Taxe précise', status: 'processed' },
                { id: 3, date: '2026-10-12', amount: -99.99, category: 'Loisirs', payee: 'Achat net', status: 'processed' },
            ];
            const audit = auditCategorySpending(fractionalTx, 'Loisirs', 1, '2026-10-31');
            const expectedTotal = 0.01 + 12.3456 + 99.99;
            expect(audit.total).toBeCloseTo(expectedTotal, 4);
            expect(audit.meanMonthly).toBeCloseTo(expectedTotal, 4);
            expect(audit.count).toBe(3);
        });

        it('1.3 : Déduplication robuste face à des doublons multiples d\'une même transaction', () => {
            const originalTx: Transaction = { id: 10, date: '2026-10-05', amount: -450, category: 'Épicerie', payee: 'Costco', status: 'processed' };
            const duplicates: Transaction[] = [
                originalTx,
                { ...originalTx, id: 11, isDuplicate: true },
                { ...originalTx, id: 12, isDuplicate: true },
                { ...originalTx, id: 13, isDuplicate: true },
                { ...originalTx, id: 14, isDuplicate: true },
            ];
            const filtered = filterSpendingTransactions(duplicates);
            expect(filtered.length).toBe(1);
            expect(filtered[0].id).toBe(10);

            const audit = auditCategorySpending(duplicates, 'Épicerie', 1, '2026-10-31');
            expect(audit.count).toBe(1);
            expect(audit.total).toBe(450);
        });

        it('1.4 : Exclusion totale des transferts sous toutes leurs formes canoniques', () => {
            const transferTx: Transaction[] = [
                { id: 1, date: '2026-10-01', amount: -500, category: 'Transfert', payee: 'Épargne CELI', status: 'processed' },
                { id: 2, date: '2026-10-02', amount: -1000, category: 'Virement', payee: 'Virement externe', status: 'processed' },
                { id: 3, date: '2026-10-03', amount: -750, category: 'Virements', payee: 'Virements multiples', status: 'processed' },
                { id: 4, date: '2026-10-04', amount: -2000, category: 'Épargne', payee: 'Compte REER', status: 'processed' },
                { id: 5, date: '2026-10-05', amount: -3000, category: 'Investissement', payee: 'Courtage Disnat', status: 'processed' },
                { id: 6, date: '2026-10-06', amount: -1500, category: 'Loisirs', payee: 'Virement ami', isTransfer: true, status: 'processed' },
                { id: 7, date: '2026-10-07', amount: -250, category: 'Loisirs', payee: 'Cinéma', status: 'processed' }, // Vraie dépense
            ];
            const filtered = filterSpendingTransactions(transferTx);
            expect(filtered.length).toBe(1);
            expect(filtered[0].id).toBe(7);
            expect(filtered[0].amount).toBe(-250);
        });

        it('1.5 : Remboursement partiel supérieur à la dépense initiale : non-négativité garantie', () => {
            // Scénario : dépense initiale de -50 $ en Restos, mais remboursement de +150 $ (ex. partage de note de groupe)
            const transactions: Transaction[] = [
                { id: 1, date: '2026-10-10', amount: -50, category: 'Restaurants', payee: 'Bistro', status: 'processed' },
                { id: 2, date: '2026-10-12', amount: 150, category: 'Remboursement', payee: 'Amis Interac', status: 'processed' },
            ];
            const audit = auditSpendingWindow(transactions, 3, '2026-10-31');
            expect(audit.totalSpendingCad).toBeGreaterThanOrEqual(0);
            expect(audit.meanMonthlySpendingCad).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(audit.totalSpendingCad)).toBe(true);
            expect(Number.isFinite(audit.fixedRatio)).toBe(true);
            expect(Number.isFinite(audit.discretionaryRatio)).toBe(true);
        });

        it('1.6 : Corruption de dates et entrées dégénérées dans auditSpendingWindow', () => {
            const corruptedTx: Transaction[] = [
                { id: 1, date: '', amount: -100, category: 'Épicerie', payee: 'Inconnu', status: 'error' },
                { id: 2, date: 'date-invalide', amount: -200, category: 'Épicerie', payee: 'Inconnu', status: 'error' },
                { id: 3, date: '2026-10-15', amount: NaN, category: 'Épicerie', payee: 'Inconnu', status: 'error' },
                { id: 4, date: '2026-10-16', amount: -Infinity, category: 'Épicerie', payee: 'Inconnu', status: 'error' },
            ];
            const audit = auditSpendingWindow(corruptedTx, 0, '2026-10-31');
            expect(audit.monthsCount).toBe(1); // Normalisé à >= 1
            expect(audit.totalSpendingCad).toBe(0);
            expect(audit.meanMonthlySpendingCad).toBe(0);
        });
    });

    // =========================================================================
    // ÉPREUVE 2 : RÉSISTANCE ADVERSARIALE DU LIFESTYLE CREEP OLS (F09)
    // =========================================================================
    describe('Épreuve 2 (F09) : Résistance du Lifestyle Creep OLS aux chocs extrêmes', () => {

        it('2.1 : Outlier colossal de 50 000 $ (achat auto) neutralisé par la médiane', () => {
            // Série de base à 4 000 $/mois avec croissance douce de +40 $/mois
            const monthlyExpenses = [4000, 4040, 50000, 4120, 4160, 4200];
            const creep = computeLifestyleCreep(monthlyExpenses);

            // La médiane ordonnée [4000, 4040, 4120, 4160, 4200, 50000] est index 3 => 4160 $
            // 2.5 * 4160 = 10 400 $, 50 000 $ est donc identifié et ramené à la médiane
            expect(creep.outliersNeutralizedCount).toBe(1);
            expect(creep.cleanedMonthlyExpenses[2]).toBe(4160);
            expect(creep.slopeMonthlyCad).toBeLessThan(100);
            expect(creep.hasCreep).toBe(false);
        });

        it('2.2 : Outlier extrême de 500 000 $ (achat immobilier ponctuel) neutralisé sans explosion', () => {
            const monthlyExpenses = [3500, 3550, 3600, 500000, 3700, 3750];
            const creep = computeLifestyleCreep(monthlyExpenses);

            expect(creep.outliersNeutralizedCount).toBe(1);
            expect(creep.slopeMonthlyCad).toBeLessThan(100);
            expect(creep.hasCreep).toBe(false);
            expect(Number.isFinite(creep.slopeMonthlyCad)).toBe(true);
        });

        it('2.3 : Séries courtes (< 3 mois) retournent obligatoirement pente = 0 et hasCreep = false', () => {
            expect(computeLifestyleCreep([]).slopeMonthlyCad).toBe(0);
            expect(computeLifestyleCreep([]).hasCreep).toBe(false);

            expect(computeLifestyleCreep([5000]).slopeMonthlyCad).toBe(0);
            expect(computeLifestyleCreep([5000]).hasCreep).toBe(false);

            expect(computeLifestyleCreep([4000, 4800]).slopeMonthlyCad).toBe(0);
            expect(computeLifestyleCreep([4000, 4800]).hasCreep).toBe(false);
        });

        it('2.4 : Série violemment décroissante clampée strictement à la borne basse de -500 $/mois', () => {
            // Effondrement des dépenses de 2 000 $/mois par mois
            const collapsingExpenses = [15000, 13000, 11000, 9000, 7000, 5000];
            const creep = computeLifestyleCreep(collapsingExpenses);

            expect(creep.slopeMonthlyCad).toBe(-500);
            expect(creep.slope).toBe(-500);
            expect(creep.annualSlopeCad).toBe(-6000);
            expect(creep.hasCreep).toBe(false);
        });

        it('2.5 : Série explosive en hyper-dépense clampée strictement à la borne haute de +500 $/mois', () => {
            // Explosion de 2 000 $/mois chaque mois (sans dépasser 2.5x médiane individuellement)
            const explodingExpenses = [2000, 3500, 5000, 6500, 8000, 9500];
            const creep = computeLifestyleCreep(explodingExpenses);

            expect(creep.slopeMonthlyCad).toBe(500);
            expect(creep.slope).toBe(500);
            expect(creep.annualSlopeCad).toBe(6000);
            expect(creep.hasCreep).toBe(true);
        });

        it('2.6 : Série entièrement nulle ou constante produit une pente de 0 $/mois sans NaN', () => {
            const allZeros = [0, 0, 0, 0, 0, 0];
            const creepZero = computeLifestyleCreep(allZeros);
            expect(creepZero.slopeMonthlyCad).toBe(0);
            expect(creepZero.hasCreep).toBe(false);

            const allConstant = [4200, 4200, 4200, 4200, 4200];
            const creepConst = computeLifestyleCreep(allConstant);
            expect(creepConst.slopeMonthlyCad).toBe(0);
            expect(creepConst.hasCreep).toBe(false);
        });
    });

    // =========================================================================
    // ÉPREUVE 3 : INVARIANCE ANALYTIQUE DE LA SAISONNALITÉ (F10)
    // =========================================================================
    describe('Épreuve 3 (F10) : Preuve analytique d\'invariance de la saisonnalité', () => {

        it('3.1 : La somme des 12 facteurs de saisonnalité vaut exactement 12.000000 (erreur < 1e-6)', () => {
            // Test sur profil brut québécois
            const rawSum = QUEBEC_SEASONALITY_FALLBACK_RAW.reduce((a, b) => a + b, 0);
            const normalized = QUEBEC_SEASONALITY_FALLBACK_RAW.map(v => (v / rawSum) * 12);
            const sumNormalized = normalized.reduce((a, b) => a + b, 0);

            expect(Math.abs(sumNormalized - 12.0)).toBeLessThan(1e-6);
        });

        it('3.2 : Fuzzing adversarial sur 100 séries aléatoires et dégénérées : somme toujours égale à 12.000000', () => {
            // Fuzzing avec différentes tailles, amplitudes et zéros
            for (let seed = 1; seed <= 100; seed++) {
                const length = 3 + (seed % 24); // de 3 à 26 mois
                const randomHistory: number[] = [];
                for (let j = 0; j < length; j++) {
                    const noise = Math.sin(seed * 997 + j * 31) * 2000;
                    randomHistory.push(Math.max(0, 3000 + noise));
                }

                const result = computeVolatilityAndSeasonality(randomHistory);
                expect(result.seasonalityFactors.length).toBe(12);

                const sum = result.seasonalityFactors.reduce((a, b) => a + b, 0);
                expect(Math.abs(sum - 12.0)).toBeLessThan(1e-6);

                // Chaque facteur doit respecter l'intervalle canonique [0.50, 2.00]
                for (let m = 0; m < 12; m++) {
                    expect(result.seasonalityFactors[m]).toBeGreaterThanOrEqual(0.50);
                    expect(result.seasonalityFactors[m]).toBeLessThanOrEqual(2.00);
                }
            }
        });

        it('3.3 : Activation du repli québécois si historique < 6 mois avec hiérarchie des saisons', () => {
            const shortHistory = [4000, 4200, 4100]; // 3 mois
            const result = computeVolatilityAndSeasonality(shortHistory);

            expect(result.isFallbackProfile).toBe(true);
            expect(result.seasonalityFactors.length).toBe(12);

            // Décembre (indice 11) doit être le mois le plus élevé (> 1.20)
            expect(result.seasonalityFactors[11]).toBeGreaterThan(1.20);
            // Janvier (indice 0) doit être un creux significatif (< 0.95)
            expect(result.seasonalityFactors[0]).toBeLessThan(0.95);
            // Juillet (indice 6 - vacances de la construction) doit dépasser 1.10
            expect(result.seasonalityFactors[6]).toBeGreaterThan(1.10);
            // Septembre (indice 8 - rentrée scolaire) doit dépasser 1.00
            expect(result.seasonalityFactors[8]).toBeGreaterThan(1.00);
        });

        it('3.4 : computeVolatilitySafe robuste face aux listes vides, singleton et valeurs non finies', () => {
            expect(computeVolatilitySafe([])).toBe(0.08);
            expect(computeVolatilitySafe([5000])).toBe(0.08);
            expect(computeVolatilitySafe([5000, 5200])).toBe(0.08);
            expect(computeVolatilitySafe([NaN, Infinity, -Infinity])).toBe(0.08);
            expect(computeVolatilitySafe([0, 0, 0, 0])).toBe(0);
        });
    });

    // =========================================================================
    // ÉPREUVE 4 : DÉTECTION DE PAIE, MAGIC MONTHS ET CALENDRIER CANADIEN (F11)
    // =========================================================================
    describe('Épreuve 4 (F11) : Invariance des cadences et calendrier bancaire ACCS', () => {

        it('4.1 : Invariance mathématique des Magic Months (exactement 2 mois à 3 paies en bi-hebdomadaire ordinaire)', () => {
            // Test sur plusieurs années civiles et dates de départ
            const testCases = [
                { startDate: '2025-01-03', year: 2025, expectedCount: 2 },
                { startDate: '2026-01-09', year: 2026, expectedCount: 2 },
                { startDate: '2027-01-08', year: 2027, expectedCount: 2 },
            ];

            for (const tc of testCases) {
                const magicMonths = detectBiweeklyThreePayMonths(tc.startDate, tc.year);
                expect(magicMonths.length).toBe(tc.expectedCount);
                // Chaque mois doit être un index valide entre 0 et 11
                magicMonths.forEach(m => {
                    expect(m).toBeGreaterThanOrEqual(0);
                    expect(m).toBeLessThanOrEqual(11);
                });
            }
        });

        it('4.2 : Conformité stricte des 11 jours fériés bancaires officiels au Québec et Canada en 2026', () => {
            const holidays2026 = getCanadianBankHolidays(2026);
            expect(holidays2026.size).toBe(11);

            // Jours fériés obligatoires
            expect(holidays2026.has('2026-01-01')).toBe(true); // Jour de l'An
            expect(holidays2026.has('2026-04-03')).toBe(true); // Vendredi Saint 2026
            expect(holidays2026.has('2026-05-18')).toBe(true); // Journée des Patriotes 2026
            expect(holidays2026.has('2026-06-24')).toBe(true); // Fête nationale du Québec
            expect(holidays2026.has('2026-07-01')).toBe(true); // Fête du Canada
            expect(holidays2026.has('2026-09-07')).toBe(true); // Fête du Travail 2026
            expect(holidays2026.has('2026-09-30')).toBe(true); // Vérité et Réconciliation
            expect(holidays2026.has('2026-10-12')).toBe(true); // Action de grâce 2026
            expect(holidays2026.has('2026-11-11')).toBe(true); // Jour du Souvenir
            expect(holidays2026.has('2026-12-25')).toBe(true); // Noël
            expect(holidays2026.has('2026-12-26')).toBe(true); // Lendemain de Noël (Boxing Day)
        });

        it('4.3 : Prélèvements récurrents : gestion correcte du shift et groupement par créancier', () => {
            const transactions: Transaction[] = [
                { id: 1, date: '2026-07-01', amount: -2100, category: 'Logement', payee: 'Hypothèque Banque Nationale', status: 'processed' },
                { id: 2, date: '2026-08-01', amount: -2100, category: 'Logement', payee: 'Hypothèque Banque Nationale', status: 'processed' },
                { id: 3, date: '2026-09-01', amount: -2100, category: 'Logement', payee: 'Hypothèque Banque Nationale', status: 'processed' },
                { id: 4, date: '2026-07-15', amount: -75.50, category: 'Services publics', payee: 'Hydro-Québec', status: 'processed' },
                { id: 5, date: '2026-08-15', amount: -82.20, category: 'Services publics', payee: 'Hydro-Québec', status: 'processed' },
                { id: 6, date: '2026-09-15', amount: -79.10, category: 'Services publics', payee: 'Hydro-Québec', status: 'processed' },
            ];
            const prelevements = detectRecurringPrelevements(transactions);
            expect(prelevements.length).toBe(2);

            const mortgage = prelevements.find(p => p.category === 'housing');
            expect(mortgage).toBeDefined();
            expect(mortgage?.averageAmount).toBe(2100);
            expect(mortgage?.yearlyCost).toBe(25200);

            const utility = prelevements.find(p => p.category === 'utility');
            expect(utility).toBeDefined();
            expect(utility?.averageAmount).toBeCloseTo(79.10, 1);
        });
    });

    // =========================================================================
    // ÉPREUVE 5 : INVARIANCE DES MODES DE PROJECTION ET CONVERGENCE (F12)
    // =========================================================================
    describe('Épreuve 5 (F12) : Monotonie, continuité et invariance des 3 modes de projection', () => {

        it('5.1 : Continuité et monotonie stricte du poids de convergence hybride w(m)', () => {
            // w(m) doit valoir 1 pour m <= 12, décroître continûment de 12 à 36, et valoir 0 pour m >= 36
            let prevW = 1.0;
            for (let m = 0; m <= 60; m++) {
                const w = computeExpenseConvergenceWeight(m, 12, 36);
                expect(w).toBeGreaterThanOrEqual(0.0);
                expect(w).toBeLessThanOrEqual(1.0);
                expect(w).toBeLessThanOrEqual(prevW); // Décroissance monotone

                if (m <= 12) expect(w).toBe(1.0);
                if (m === 24) expect(w).toBeCloseTo(0.5, 4);
                if (m >= 36) expect(w).toBe(0.0);

                prevW = w;
            }
        });

        it('5.2 : Projection hybride avec dépenses réelles inférieures au budget : convergence ascendante sans saut', () => {
            const budgetTarget = 5000;
            const realObserved = 3800;

            const m0 = computeProjectedExpenseForMonth(0, budgetTarget, realObserved, 'hybrid');
            const m12 = computeProjectedExpenseForMonth(12, budgetTarget, realObserved, 'hybrid');
            const m24 = computeProjectedExpenseForMonth(24, budgetTarget, realObserved, 'hybrid');
            const m36 = computeProjectedExpenseForMonth(36, budgetTarget, realObserved, 'hybrid');
            const m60 = computeProjectedExpenseForMonth(60, budgetTarget, realObserved, 'hybrid');

            expect(m0).toBe(3800);
            expect(m12).toBe(3800);
            expect(m24).toBe(4400); // Milieu entre 3800 et 5000
            expect(m36).toBe(5000);
            expect(m60).toBe(5000);
        });

        it('5.3 : Mode réel vs budget : imperméabilité absolue aux changements du paramètre inverse', () => {
            // En mode budget, une variation des dépenses réelles n'a aucun impact
            const b1 = computeProjectedExpenseForMonth(10, 4000, 2000, 'budget');
            const b2 = computeProjectedExpenseForMonth(10, 4000, 10000, 'budget');
            expect(b1).toBe(4000);
            expect(b2).toBe(4000);

            // En mode réel, une variation du budget cible n'a aucun impact
            const r1 = computeProjectedExpenseForMonth(10, 2000, 4500, 'real');
            const r2 = computeProjectedExpenseForMonth(10, 8000, 4500, 'real');
            expect(r1).toBe(4500);
            expect(r2).toBe(4500);
        });

        it('5.4 : computeProjectedExpenses avec saisonnalité et creep intégrés : cohérence multidimensionnelle', () => {
            const profile = createDefaultBehavioralProfile(4000, {
                expenseMode: 'real',
                realMonthlyExpenses: 4500,
                lifestyleCreepAnnual: 0.02, // 2 % / an
                seasonalityFactors: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.20],
            });

            // Mois 12 (calendarMonth 11 = Décembre)
            const resultDec12 = computeProjectedExpenses({
                monthIndex: 12,
                calendarMonth: 11,
                budgetTargetExpenses: 4000,
                profile,
                expenseMultiplier: 1.0,
            });

            expect(resultDec12.weightReal).toBe(1.0);
            expect(resultDec12.seasonalFactor).toBe(1.20);
            expect(resultDec12.creepMultiplier).toBeGreaterThanOrEqual(1.0);
            expect(resultDec12.projectedExpenses).toBeCloseTo(4500 * 1.20 * resultDec12.creepMultiplier, 1);
        });
    });

    // =========================================================================
    // ÉPREUVE 6 : RÉSISTANCE AUX ENTRÉES CHAOTIQUES ET MONTE CARLO (F10, F12)
    // =========================================================================
    describe('Épreuve 6 : Entrées chaotiques, Monte Carlo et robustesse extrême', () => {

        it('6.1 : Clamping strict du bruit stochastique Monte Carlo sur stochasticZ dans [-3, +3] et multiplicateur [0.70, 1.50]', () => {
            const profile = createDefaultBehavioralProfile(4000, {
                expenseMode: 'real',
                realMonthlyExpenses: 4000,
                expenseVolatility: 0.15, // 15 %
                seasonalityFactors: new Array(12).fill(1.0),
            });

            // Tirage extrême négatif z = -10 (doit être clampé à -3 => noise = 1 + 0.15 * -3 = 0.55 => clampé à 0.70)
            const resLow = computeProjectedExpenses({
                monthIndex: 1,
                calendarMonth: 0,
                budgetTargetExpenses: 4000,
                profile,
                expenseMultiplier: 1.0,
                enableMonteCarlo: true,
                stochasticZ: -10,
            });
            expect(resLow.projectedExpenses).toBe(4000 * 0.70);

            // Tirage extrême positif z = +10 (doit être clampé à +3 => noise = 1 + 0.15 * +3 = 1.45 => <= 1.50)
            const resHigh = computeProjectedExpenses({
                monthIndex: 1,
                calendarMonth: 0,
                budgetTargetExpenses: 4000,
                profile,
                expenseMultiplier: 1.0,
                enableMonteCarlo: true,
                stochasticZ: 10,
            });
            expect(resHigh.projectedExpenses).toBe(4000 * 1.45);
        });

        it('6.2 : Horodatages et index de mois extrêmes (-10, 0, 1200 mois / 100 ans) sans débordement ni régression', () => {
            const profile = createDefaultBehavioralProfile(3500);

            const resNegative = computeProjectedExpenses(-10, 3500, profile);
            expect(resNegative).toBe(3500);

            const resZero = computeProjectedExpenses(0, 3500, profile);
            expect(resZero).toBe(3500);

            // 100 ans dans le futur : le creep est plafonné à 5 ans pour éviter les singularités
            const profileCreep = createDefaultBehavioralProfile(3500, {
                expenseMode: 'real',
                realMonthlyExpenses: 3500,
                lifestyleCreepAnnual: 0.05,
                seasonalityFactors: new Array(12).fill(1.0),
            });
            const res100y = computeProjectedExpenses({
                monthIndex: 1200,
                calendarMonth: 0,
                budgetTargetExpenses: 3500,
                profile: profileCreep,
                expenseMultiplier: 1.0,
            });
            // 5 ans max de creep : 3500 * (1 + 0.05)^5 = 4466.985 $
            expect(res100y.projectedExpenses).toBeCloseTo(3500 * Math.pow(1.05, 5), 1);
        });

        it('6.3 : classifyIncompressibleVsDiscretionary avec séries dégénérées (vides, NaN, zéros)', () => {
            const degenerateCategories = {
                Vide: [],
                Zeros: [0, 0, 0],
                Corrompu: [NaN, Infinity, -Infinity],
            };
            const result = classifyIncompressibleVsDiscretionary(degenerateCategories);
            expect(result.fixedRatio).toBe(0.60); // Repli équilibré
            expect(result.discretionaryRatio).toBe(0.40);
        });
    });
});
