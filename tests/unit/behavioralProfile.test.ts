// tests/unit/behavioralProfile.test.ts
//
// Tests unitaires exhaustifs pour services/projection/behavioralProfile.ts
// Jalon 2 / Lot 2 : F08 à F12

import { describe, it, expect } from 'vitest';
import {
    filterSpendingTransactions,
    auditCategorySpending,
    auditSpendingSafe,
    auditSpendingWindow,
    computeExpenseVariability,
    classifyIncompressibleVsDiscretionary,
    computeLifestyleCreep,
    computeCreepWithOutlierFilter,
    computeStandardDeviation,
    computeVolatilitySafe,
    computeVolatilityAndSeasonality,
    detectBiweeklyThreePayMonths,
    detectCadenceSafe,
    getCanadianBankHolidays,
    isBusinessDayCanadian,
    detectPayCadence,
    detectRecurringPrelevements,
    computeExpenseConvergenceWeight,
    computeProjectedExpenseForMonth,
    computeExpenseBounded,
    computeProjectedExpenses,
    createDefaultBehavioralProfile,
    buildBehavioralProfileFromTransactions,
    QUEBEC_SEASONALITY_FALLBACK_RAW,
} from '../../services/projection/behavioralProfile';
import type { Transaction } from '../../types';

describe('services/projection/behavioralProfile.ts — Tests Unitaires Exhaustifs', () => {

    // ------------------------------------------------------------------------
    // F08 : filterSpendingTransactions & auditCategorySpending & auditSpendingWindow
    // ------------------------------------------------------------------------
    describe('F08 : Filtrage & Audit de fenêtre des dépenses réelles', () => {
        const dummyTransactions: Transaction[] = [
            { id: 1, date: '2026-10-15', amount: -500, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
            { id: 2, date: '2026-09-10', amount: -600, category: 'Épicerie', payee: 'Metro', status: 'processed' },
            { id: 3, date: '2026-08-05', amount: -400, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
            { id: 4, date: '2026-10-01', amount: 3500, category: 'Salaire', payee: 'Employeur', status: 'processed' },
            { id: 5, date: '2026-10-12', amount: 150, category: 'Remboursement', payee: 'Ami Interac', status: 'processed' },
            { id: 6, date: '2026-10-14', amount: -1000, category: 'Transfert', payee: 'Virement interne', isTransfer: true, status: 'processed' },
            { id: 7, date: '2026-10-15', amount: -500, category: 'Épicerie', isDuplicate: true, payee: 'Maxi', status: 'processed' },
            { id: 8, date: '2026-10-20', amount: -200, category: 'Impôts', payee: 'Revenu Québec', status: 'processed' },
            { id: 9, date: '2026-10-22', amount: NaN, category: 'Épicerie', payee: 'Erreur', status: 'processed' },
        ];

        it('filterSpendingTransactions filtre correctement les transferts, doublons, impôts et montants corrompus', () => {
            const filtered = filterSpendingTransactions(dummyTransactions, '2026-08-01', '2026-10-31');
            expect(filtered.some(t => t.isTransfer)).toBe(false);
            expect(filtered.some(t => t.isDuplicate)).toBe(false);
            expect(filtered.some(t => t.category === 'Impôts')).toBe(false);
            expect(filtered.some(t => t.category === 'Salaire')).toBe(false);
            expect(filtered.some(t => !Number.isFinite(t.amount))).toBe(false);

            // Remboursement (+150 $) doit être conservé comme réduction de dépense
            expect(filtered.some(t => t.category === 'Remboursement')).toBe(true);
        });

        it('auditCategorySpending calcule la moyenne mensuelle et le total sur 3 mois', () => {
            const res = auditCategorySpending(dummyTransactions, 'Épicerie', 3, '2026-10-31');
            // 500 (oct) + 600 (sep) + 400 (août) = 1500 / 3 = 500
            expect(res.total).toBe(1500);
            expect(res.meanMonthly).toBe(500);
            expect(res.count).toBe(3);
        });

        it('auditSpendingSafe gère les listes vides et paramètres limites sans crash', () => {
            expect(auditSpendingSafe([], 'Épicerie', 6)).toEqual({ meanMonthly: 0, total: 0, count: 0 });
            expect(auditSpendingSafe(dummyTransactions, 'Inexistant', 6).count).toBe(0);
            expect(auditSpendingSafe(dummyTransactions, 'Épicerie', 0).meanMonthly).toBe(0);
        });

        it('auditSpendingWindow ventile par catégorie et calcule les ratios fixe vs discrétionnaire', () => {
            const windowAudit = auditSpendingWindow(dummyTransactions, 3, '2026-10-31');
            expect(windowAudit.monthsCount).toBe(3);
            expect(windowAudit.startDateIso).toBeDefined();
            expect(windowAudit.endDateIso).toBeDefined();
            expect(windowAudit.totalSpendingCad).toBeGreaterThan(0);
            expect(windowAudit.categoryBreakdown['Épicerie']).toBeDefined();
            expect(windowAudit.categoryBreakdown['Épicerie'].nature).toBe('incompressible');
            expect(windowAudit.fixedRatio + windowAudit.discretionaryRatio).toBeCloseTo(1.0, 4);
        });
    });

    // ------------------------------------------------------------------------
    // F09 : Variabilité, Incompressible vs Discrétionnaire & Lifestyle Creep
    // ------------------------------------------------------------------------
    describe('F09 : Variabilité, Incompressible vs Discrétionnaire & Lifestyle Creep', () => {
        it('computeExpenseVariability distingue le fixe (CV < 0.20) du variable (CV >= 0.20)', () => {
            const fixed = computeExpenseVariability([1500, 1500, 1500, 1500]);
            expect(fixed.cv).toBe(0);
            expect(fixed.isFixed).toBe(true);

            const variable = computeExpenseVariability([100, 500, 200, 800, 300]);
            expect(variable.cv).toBeGreaterThanOrEqual(0.20);
            expect(variable.isFixed).toBe(false);

            expect(computeExpenseVariability([500]).cv).toBe(0);
            expect(computeExpenseVariability([]).cv).toBe(0);
        });

        it('classifyIncompressibleVsDiscretionary classe selon les catégories et la variance', () => {
            const categoryData = {
                Logement: [2000, 2000, 2000, 2000],
                Restaurants: [200, 600, 300, 700],
                Assurances: [150, 150, 150, 150],
            };
            const classification = classifyIncompressibleVsDiscretionary(categoryData);
            expect(classification.incompressibleCategories).toContain('Logement');
            expect(classification.incompressibleCategories).toContain('Assurances');
            expect(classification.discretionaryCategories).toContain('Restaurants');
            expect(classification.fixedRatio).toBeGreaterThan(0.5);
            expect(classification.discretionaryRatio).toBeLessThan(0.5);
        });

        it('computeLifestyleCreep neutralise les outliers et calcule la pente OLS', () => {
            // Dérive saine de 50 $/mois
            const series = [3000, 3050, 3100, 3150, 3200, 3250];
            const creep = computeLifestyleCreep(series);
            expect(creep.slopeMonthlyCad).toBeCloseTo(50, 1);
            expect(creep.slope).toBeCloseTo(50, 1);
            expect(creep.annualSlopeCad).toBeCloseTo(600, 1);
            expect(creep.hasCreep).toBe(false);

            // Outlier massif
            const withOutlier = [3000, 3050, 25000, 3150, 3200, 3250];
            const creepOutlier = computeCreepWithOutlierFilter(withOutlier);
            expect(creepOutlier.outliersNeutralizedCount).toBe(1);
            expect(creepOutlier.slopeMonthlyCad).toBeLessThan(100);
            expect(creepOutlier.hasCreep).toBe(false);
        });

        it('computeLifestyleCreep clampe aux bornes [-500, +500] et gère les séries courtes', () => {
            expect(computeLifestyleCreep([3000, 3100]).slopeMonthlyCad).toBe(0);
            const extreme = [1000, 3000, 6000, 12000, 20000, 30000];
            expect(computeLifestyleCreep(extreme).slopeMonthlyCad).toBe(500);
            expect(computeLifestyleCreep(extreme).hasCreep).toBe(true);
        });
    });

    // ------------------------------------------------------------------------
    // F10 : Volatilité et Saisonnalité
    // ------------------------------------------------------------------------
    describe('F10 : Volatilité et Saisonnalité', () => {
        it('computeStandardDeviation calcule l\'écart-type d\'échantillon (n-1)', () => {
            const vals = [10, 12, 23, 23, 16, 23, 21, 16];
            const sd = computeStandardDeviation(vals);
            expect(sd).toBeCloseTo(5.24, 2);
            expect(computeStandardDeviation([5])).toBe(0);
            expect(computeStandardDeviation([])).toBe(0);
        });

        it('computeVolatilitySafe applique le repli prudent à 8% pour les séries courtes', () => {
            expect(computeVolatilitySafe([3000, 3500])).toBe(0.08);
            expect(computeVolatilitySafe([])).toBe(0.08);
            expect(computeVolatilitySafe([3000, 3000, 3000])).toBe(0);
        });

        it('computeVolatilityAndSeasonality normalise les 12 facteurs à une somme de 12.0000', () => {
            expect(QUEBEC_SEASONALITY_FALLBACK_RAW.length).toBe(12);
            const res = computeVolatilityAndSeasonality([4000, 4200, 4100, 4300, 4000, 4200]);
            expect(res.seasonalityFactors.length).toBe(12);
            const sum = res.seasonalityFactors.reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(12.0000, 3);
            expect(res.seasonalityFactors[11]).toBeGreaterThan(1.20); // Décembre élevé
            expect(res.seasonalityFactors[0]).toBeLessThan(0.95);  // Janvier creux
        });
    });

    // ------------------------------------------------------------------------
    // F11 : Cadence de paie, Magic Months, calendrier bancaire & prélèvements
    // ------------------------------------------------------------------------
    describe('F11 : Cadence de paie, Magic Months & Prélèvements fixes', () => {
        it('detectCadenceSafe identifie les cadences hebdomadaire, bihebdomadaire et mensuelle', () => {
            expect(detectCadenceSafe([7, 7, 7, 7])).toBe('weekly');
            expect(detectCadenceSafe([14, 14, 14, 14])).toBe('biweekly');
            expect(detectCadenceSafe([30, 31, 30, 31])).toBe('monthly');
            expect(detectCadenceSafe([5, 42, 18, 60])).toBe('irregular');
            expect(detectCadenceSafe([14])).toBe('irregular');
        });

        it('detectBiweeklyThreePayMonths calcule exactement 2 mois à 3 paies en 2026', () => {
            const threePayMonths = detectBiweeklyThreePayMonths('2026-01-09', 2026);
            expect(threePayMonths.length).toBe(2);
            expect(threePayMonths).toEqual([4, 9]); // Mai (4) et Octobre (9)
        });

        it('getCanadianBankHolidays et isBusinessDayCanadian modélisent fidèlement les jours ouvrés', () => {
            const holidays2026 = getCanadianBankHolidays(2026);
            expect(holidays2026.has('2026-01-01')).toBe(true); // Jour de l'An
            expect(holidays2026.has('2026-06-24')).toBe(true); // St-Jean-Baptiste
            expect(holidays2026.has('2026-07-01')).toBe(true); // Fête du Canada
            expect(holidays2026.has('2026-12-25')).toBe(true); // Noël

            expect(isBusinessDayCanadian('2026-01-01')).toBe(false); // Férié
            expect(isBusinessDayCanadian('2026-01-03')).toBe(false); // Samedi
            expect(isBusinessDayCanadian('2026-01-04')).toBe(false); // Dimanche
            expect(isBusinessDayCanadian('2026-01-05')).toBe(true);  // Lundi ouvré
        });

        it('detectPayCadence extrait le rythme de paie depuis des transactions de salaire', () => {
            const salaryTx: Transaction[] = [
                { id: 101, date: '2026-01-09', amount: 2200, category: 'Salaire', payee: 'Acme Corp', status: 'processed' },
                { id: 102, date: '2026-01-23', amount: 2200, category: 'Salaire', payee: 'Acme Corp', status: 'processed' },
                { id: 103, date: '2026-02-06', amount: 2200, category: 'Salaire', payee: 'Acme Corp', status: 'processed' },
                { id: 104, date: '2026-02-20', amount: 2200, category: 'Salaire', payee: 'Acme Corp', status: 'processed' },
            ];
            const cadence = detectPayCadence(salaryTx);
            expect(cadence.frequency).toBe('biweekly');
            expect(cadence.typicalNetPay).toBe(2200);
            expect(cadence.threePayMonths.length).toBe(2);
            expect(cadence.annualizedNetIncome).toBe(2200 * 26);
        });

        it('detectRecurringPrelevements extrait les débits stables', () => {
            const debitTx: Transaction[] = [
                { id: 201, date: '2026-08-01', amount: -1800, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                { id: 202, date: '2026-09-01', amount: -1800, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                { id: 203, date: '2026-10-01', amount: -1800, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                { id: 204, date: '2026-08-15', amount: -18.99, category: 'Abonnements', payee: 'Netflix', status: 'processed' },
                { id: 205, date: '2026-09-15', amount: -18.99, category: 'Abonnements', payee: 'Netflix', status: 'processed' },
            ];
            const prelevements = detectRecurringPrelevements(debitTx);
            expect(prelevements.length).toBe(2);
            const rent = prelevements.find(p => p.category === 'housing');
            expect(rent).toBeDefined();
            expect(rent?.averageAmount).toBe(1800);
            expect(rent?.targetDayOfMonth).toBe(1);
        });

        it('detectRecurringPrelevements ignore les crédits et conserve les débits récurrents sur des transactions mixtes', () => {
            const mixedTx: Transaction[] = [
                // Rentrée positive au tout début (doit être ignorée via continue sans interrompre la boucle)
                { id: 301, date: '2026-08-01', amount: 3200, category: 'Salaire', payee: 'Employeur Tech', status: 'processed' },
                // Débit récurrent 1 : Loyer
                { id: 302, date: '2026-08-01', amount: -1800, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                // Remboursement positif intercalé
                { id: 303, date: '2026-08-10', amount: 85, category: 'Remboursement', payee: 'Interac Ami', status: 'processed' },
                // Débit récurrent 2 : Vidéotron
                { id: 304, date: '2026-08-15', amount: -65.50, category: 'Abonnements', payee: 'Vidéotron', status: 'processed' },
                // Deuxième paie positive
                { id: 305, date: '2026-08-15', amount: 3200, category: 'Salaire', payee: 'Employeur Tech', status: 'processed' },
                // Deuxième occurrence Loyer
                { id: 306, date: '2026-09-01', amount: -1800, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                // Deuxième occurrence Vidéotron
                { id: 307, date: '2026-09-15', amount: -65.50, category: 'Abonnements', payee: 'Vidéotron', status: 'processed' },
                // Troisième occurrence Loyer
                { id: 308, date: '2026-10-01', amount: -1800, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                // Montant nul ou invalide (doit être ignoré sans rupture)
                { id: 309, date: '2026-10-02', amount: 0, category: 'Autre', payee: 'Test Zéro', status: 'processed' },
                { id: 310, date: '2026-10-03', amount: NaN, category: 'Autre', payee: 'Test NaN', status: 'processed' },
            ];

            const prelevements = detectRecurringPrelevements(mixedTx);

            // Doit extraire exactement 2 créanciers récurrents
            expect(prelevements.length).toBe(2);

            const rent = prelevements.find(p => p.payee === 'LOYER MONTRÉAL');
            expect(rent).toBeDefined();
            expect(rent?.category).toBe('housing');
            expect(rent?.averageAmount).toBe(1800);
            expect(rent?.targetDayOfMonth).toBe(1);
            expect(rent?.yearlyCost).toBe(1800 * 12);
            expect(rent?.confidence).toBe('high'); // 3 occurrences
            expect(rent?.historyCount).toBe(3);

            const telecom = prelevements.find(p => p.payee === 'VIDÉOTRON');
            expect(telecom).toBeDefined();
            expect(telecom?.category).toBe('telecom');
            expect(telecom?.averageAmount).toBe(65.50);
            expect(telecom?.targetDayOfMonth).toBe(15);
            expect(telecom?.confidence).toBe('medium'); // 2 occurrences
            expect(telecom?.historyCount).toBe(2);
        });

        it('buildBehavioralProfileFromTransactions extrait à la fois la paySchedule et les recurringPrelevements sur des données mixtes réelles', () => {
            const mixedStatement: Transaction[] = [
                // Paies régulières aux 14 jours
                { id: 401, date: '2026-08-07', amount: 2500, category: 'Salaire', payee: 'Employeur Tech', status: 'processed' },
                { id: 402, date: '2026-08-21', amount: 2500, category: 'Salaire', payee: 'Employeur Tech', status: 'processed' },
                { id: 403, date: '2026-09-04', amount: 2500, category: 'Salaire', payee: 'Employeur Tech', status: 'processed' },
                { id: 404, date: '2026-09-18', amount: 2500, category: 'Salaire', payee: 'Employeur Tech', status: 'processed' },
                // Loyer récurrent au 1er du mois
                { id: 405, date: '2026-08-01', amount: -1500, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                { id: 406, date: '2026-09-01', amount: -1500, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                { id: 407, date: '2026-10-01', amount: -1500, category: 'Logement', payee: 'Loyer Montréal', status: 'processed' },
                // Dépenses courantes
                { id: 408, date: '2026-08-10', amount: -120, category: 'Épicerie', payee: 'Provigo', status: 'processed' },
                { id: 409, date: '2026-09-12', amount: -140, category: 'Épicerie', payee: 'Provigo', status: 'processed' },
            ];

            const profile = buildBehavioralProfileFromTransactions(mixedStatement, 3500, '2026-10-31', 'hybrid');

            // 1. La cadence de paie doit être correctement détectée
            expect(profile.paySchedule).toBeDefined();
            expect(profile.paySchedule?.frequency).toBe('biweekly');
            expect(profile.paySchedule?.typicalNetPay).toBe(2500);

            // 2. Les prélèvements récurrents ne doivent pas être vides malgré la présence de salaires
            expect(profile.recurringPrelevements).toBeDefined();
            expect(profile.recurringPrelevements?.length).toBeGreaterThanOrEqual(1);

            const rent = profile.recurringPrelevements?.find(p => p.payee === 'LOYER MONTRÉAL');
            expect(rent).toBeDefined();
            expect(rent?.averageAmount).toBe(1500);
            expect(rent?.targetDayOfMonth).toBe(1);
        });

        it('detectCadenceSafe classifie correctement semi-monthly (intervalles de ~15 jours)', () => {
            expect(detectCadenceSafe([15, 15, 15, 15])).toBe('semi-monthly');
            expect(detectCadenceSafe([15, 16, 15, 16])).toBe('semi-monthly');
            expect(detectCadenceSafe([14, 16, 14, 16])).toBe('semi-monthly');
            expect(detectCadenceSafe([15, 15, 16, 15, 16])).toBe('semi-monthly');
            // Vérification de non-régression biweekly et weekly
            expect(detectCadenceSafe([14, 14, 14, 14])).toBe('biweekly');
            expect(detectCadenceSafe([13, 15, 14, 14])).toBe('biweekly');
            expect(detectCadenceSafe([7, 7, 7, 7])).toBe('weekly');
            expect(detectCadenceSafe([30, 31, 30, 31])).toBe('monthly');
        });

        it('detectPayCadence identifie semi-monthly, applique * 24 et aucun magic month', () => {
            // Paies les 15 et 30/31 du mois
            const semiMonthlyTx: Transaction[] = [
                { id: 301, date: '2026-01-15', amount: 2500, category: 'Salaire', payee: 'Employeur QC', status: 'processed' },
                { id: 302, date: '2026-01-30', amount: 2500, category: 'Salaire', payee: 'Employeur QC', status: 'processed' },
                { id: 303, date: '2026-02-15', amount: 2500, category: 'Salaire', payee: 'Employeur QC', status: 'processed' },
                { id: 304, date: '2026-02-28', amount: 2500, category: 'Salaire', payee: 'Employeur QC', status: 'processed' },
                { id: 305, date: '2026-03-15', amount: 2500, category: 'Salaire', payee: 'Employeur QC', status: 'processed' },
                { id: 306, date: '2026-03-31', amount: 2500, category: 'Salaire', payee: 'Employeur QC', status: 'processed' },
            ];
            const res = detectPayCadence(semiMonthlyTx);
            expect(res.frequency).toBe('semi-monthly');
            expect(res.typicalNetPay).toBe(2500);
            expect(res.threePayMonths).toEqual([]); // Strictement aucun magic month
            expect(res.annualizedNetIncome).toBe(2500 * 24); // Strictement 24 paies
            expect(res.payDays).toEqual([15, 28, 30, 31]);
        });

        it('detectPayCadence gère la cadence bimensuelle du 1er et 15 du mois', () => {
            const firstAndFifteenthTx: Transaction[] = [
                { id: 311, date: '2026-01-01', amount: 2400, category: 'Salaire', payee: 'Acme', status: 'processed' },
                { id: 312, date: '2026-01-15', amount: 2400, category: 'Salaire', payee: 'Acme', status: 'processed' },
                { id: 313, date: '2026-02-01', amount: 2400, category: 'Salaire', payee: 'Acme', status: 'processed' },
                { id: 314, date: '2026-02-15', amount: 2400, category: 'Salaire', payee: 'Acme', status: 'processed' },
            ];
            const res = detectPayCadence(firstAndFifteenthTx);
            expect(res.frequency).toBe('semi-monthly');
            expect(res.threePayMonths).toEqual([]);
            expect(res.annualizedNetIncome).toBe(2400 * 24);
            expect(res.payDays).toEqual([1, 15]);
        });

        it('computeExpenseVariability protège les séries à moyenne négative ou nulle', () => {
            const negativeSeries = computeExpenseVariability([-100, -200, -50]);
            expect(negativeSeries.cv).toBe(0);
            expect(negativeSeries.isFixed).toBe(false);

            const zeroSeries = computeExpenseVariability([0, 0, 0]);
            expect(zeroSeries.cv).toBe(0);
            expect(zeroSeries.isFixed).toBe(false);
        });
    });

    // ------------------------------------------------------------------------
    // F12 : 3 Modes de projection des dépenses
    // ------------------------------------------------------------------------
    describe('F12 : 3 Modes de projection des dépenses (budget, réel, hybride)', () => {
        const budgetTarget = 4000;
        const realObserved = 4800;

        it('computeExpenseConvergenceWeight garantit la continuité [1.0 -> 0.0]', () => {
            expect(computeExpenseConvergenceWeight(0)).toBe(1.0);
            expect(computeExpenseConvergenceWeight(12)).toBe(1.0);
            expect(computeExpenseConvergenceWeight(24)).toBeCloseTo(0.5, 3);
            expect(computeExpenseConvergenceWeight(36)).toBe(0.0);
            expect(computeExpenseConvergenceWeight(60)).toBe(0.0);
        });

        it('computeProjectedExpenseForMonth respecte les 3 modes', () => {
            expect(computeProjectedExpenseForMonth(1, budgetTarget, realObserved, 'budget')).toBe(4000);
            expect(computeExpenseBounded(1, budgetTarget, realObserved, 'budget')).toBe(4000);
            expect(computeProjectedExpenseForMonth(1, budgetTarget, realObserved, 'real')).toBe(4800);
            expect(computeProjectedExpenseForMonth(6, budgetTarget, realObserved, 'hybrid')).toBe(4800);
            expect(computeProjectedExpenseForMonth(24, budgetTarget, realObserved, 'hybrid')).toBe(4400);
            expect(computeProjectedExpenseForMonth(36, budgetTarget, realObserved, 'hybrid')).toBe(4000);
        });

        it('computeProjectedExpenses (forme détaillée) intègre saisonnalité et creep', () => {
            const profile = createDefaultBehavioralProfile(budgetTarget, {
                expenseMode: 'real',
                realMonthlyExpenses: realObserved,
                lifestyleCreepAnnual: 0.03, // 3 %/an
                seasonalityFactors: [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.25],
            });

            // Mois 12 (décembre, calendarMonth = 11) avec saisonnalité à 1.25
            const resDec = computeProjectedExpenses({
                monthIndex: 12,
                calendarMonth: 11,
                budgetTargetExpenses: budgetTarget,
                profile,
                expenseMultiplier: 1.0,
            });
            expect(resDec.seasonalFactor).toBe(1.25);
            expect(resDec.projectedExpenses).toBeGreaterThan(realObserved);

            // En mode 4 arguments scalaire :
            const scalar = computeProjectedExpenses(12, budgetTarget, profile, { calendarMonth: 11, expenseMultiplier: 1.0 });
            expect(scalar).toBe(resDec.projectedExpenses);
        });

        it('buildBehavioralProfileFromTransactions assemble un profil complet et valide à partir de transactions réelles', () => {
            const tx: Transaction[] = [
                { id: 1, date: '2026-05-15', amount: -2500, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
                { id: 2, date: '2026-06-15', amount: -2600, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
                { id: 3, date: '2026-07-15', amount: -2700, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
                { id: 4, date: '2026-08-15', amount: -2800, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
                { id: 5, date: '2026-09-15', amount: -2900, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
                { id: 6, date: '2026-10-15', amount: -3000, category: 'Épicerie', payee: 'Maxi', status: 'processed' },
            ];
            const profile = buildBehavioralProfileFromTransactions(tx, 3000, '2026-10-31', 'hybrid');
            expect(profile.expenseMode).toBe('hybrid');
            expect(profile.realMonthlyExpenses).toBeGreaterThan(0);
            expect(profile.seasonalityFactors.length).toBe(12);
            expect(Number.isFinite(profile.lifestyleCreepAnnual)).toBe(true);
            expect(Number.isFinite(profile.expenseVolatility)).toBe(true);
        });
    });
});
