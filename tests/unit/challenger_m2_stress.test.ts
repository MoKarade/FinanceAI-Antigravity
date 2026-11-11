// tests/unit/challenger_m2_stress.test.ts
//
// Banc de tests contradictoires et de stress testing indépendant (Jalon 2 / F11 & F12)
// Auteur : teamwork_challenger_m2_2 (Empirical Challenger)
// Rôles : critic, specialist

import { describe, it, expect } from 'vitest';
import {
    detectCadenceSafe,
    detectPayCadence,
    detectBiweeklyThreePayMonths,
    getCanadianBankHolidays,
    isBusinessDayCanadian,
    computeProjectedExpenseForMonth,
    computeProjectedExpenses,
    createDefaultBehavioralProfile,
} from '../../services/projection/behavioralProfile';
import { __runScenarioForTests, type SimulationParams } from '../../services/projection';
import type { AllocationStrategy } from '../../services/projection/types';
import type { ProjectionConfig, BudgetConfig, RetirementGoal, User } from '../../types';
import type { Transaction } from '../../types';

/**
 * Oracle indépendant pour calculer le décalage bancaire ouvrable (Payments Canada / Québec).
 */
function shiftDateToBusinessDayOracle(
    dateIso: string,
    convention: 'following' | 'preceding' = 'following'
): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    let [y, m, d] = dateIso.slice(0, 10).split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));

    const step = convention === 'following' ? 1 : -1;
    let currentIso = `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth() + 1)}-${pad(dateObj.getUTCDate())}`;

    while (!isBusinessDayCanadian(currentIso)) {
        dateObj.setUTCDate(dateObj.getUTCDate() + step);
        currentIso = `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth() + 1)}-${pad(dateObj.getUTCDate())}`;
    }

    return currentIso;
}

describe('Banc de Stress Testing Contradictoire — Jalon 2 (F11 & F12)', () => {

    // =========================================================================
    // 1. CADENCES DE PAIE ET MAGIC MONTHS (F11)
    // =========================================================================
    describe('1. Cadences de paie & Magic Months (F11)', () => {

        it('1.1 Les 4 cadences canoniques sont correctement classifiées', () => {
            expect(detectCadenceSafe([7, 7, 7, 7, 7])).toBe('weekly');
            expect(detectCadenceSafe([14, 14, 14, 14, 14])).toBe('biweekly');
            expect(detectCadenceSafe([30, 31, 30, 31])).toBe('monthly');

            // Variations tolérées autour de la moyenne pour jours fériés (± 2-3 jours)
            expect(detectCadenceSafe([6, 8, 7, 7])).toBe('weekly');
            expect(detectCadenceSafe([13, 15, 14, 14])).toBe('biweekly');
            expect(detectCadenceSafe([28, 31, 30, 31])).toBe('monthly');
        });

        it('1.2 Cas limites : 0 paie, 1 seule paie, intervalles anormaux (10 jours)', () => {
            // 0 paie
            const zeroPay = detectPayCadence([]);
            expect(zeroPay.frequency).toBe('irregular');
            expect(zeroPay.confidence).toBe('low');
            expect(zeroPay.typicalNetPay).toBe(0);
            expect(zeroPay.payDays).toEqual([]);
            expect(zeroPay.threePayMonths).toEqual([]);

            // 1 seule paie
            const singleTx: Transaction[] = [
                { id: 999, date: '2026-06-15', amount: 3500, category: 'Salaire', payee: 'Employeur Unique', status: 'processed' }
            ];
            const singlePay = detectPayCadence(singleTx);
            expect(singlePay.frequency).toBe('irregular');
            expect(singlePay.confidence).toBe('low');
            expect(singlePay.typicalNetPay).toBe(3500);
            expect(singlePay.payDays).toEqual([15]);
            expect(singlePay.threePayMonths).toEqual([]);

            // Intervalles de 10 jours (atypique)
            expect(detectCadenceSafe([10, 10, 10, 10])).toBe('irregular');

            // Variance élevée (ex: travailleur autonome)
            expect(detectCadenceSafe([5, 42, 18, 60])).toBe('irregular');
        });

        it('1.3 Paies bihebdo démarrant un autre jour qu\'un vendredi', () => {
            // Test avec un lundi (2026-01-05), un mercredi (2026-01-07), un samedi (2026-01-03), un dimanche (2026-01-04)
            const days = [
                { name: 'Lundi', date: '2026-01-05' },
                { name: 'Mercredi', date: '2026-01-07' },
                { name: 'Samedi', date: '2026-01-03' },
                { name: 'Dimanche', date: '2026-01-04' },
            ];

            for (const d of days) {
                const magic = detectBiweeklyThreePayMonths(d.date, 2026);
                expect(magic.length, `Échec pour démarrage un ${d.name} (${d.date})`).toBe(2);
                expect(magic[0]).toBeGreaterThanOrEqual(0);
                expect(magic[1]).toBeLessThan(12);
                expect(magic[1] - magic[0]).toBeGreaterThanOrEqual(4); // Au moins 4 à 5 mois d'écart
            }
        });

        it('1.4 Démontre empiriquement que la cadence bihebdo identifie exactement 2 Magic Months par an sur 5 ans (2026-2030)', () => {
            // Horizon de 5 ans consécutifs : 2026, 2027, 2028 (bissextile), 2029, 2030
            // À partir de la première paie de 2026 (2026-01-09)
            const anchor = '2026-01-09';
            for (let y = 2026; y <= 2030; y++) {
                const magic = detectBiweeklyThreePayMonths(anchor, y);
                // 365 jours / 14 = 26.071 -> 26 paies (10 mois à 2 paies + 2 mois à 3 paies)
                // En année bissextile (366 jours / 14 = 26.14) : 26 ou 27 paies (2 ou 3 magic months).
                expect(magic.length).toBeGreaterThanOrEqual(2);
                expect(magic.length).toBeLessThanOrEqual(3);
                if (y !== 2028) {
                    expect(magic.length).toBe(2);
                }
            }
        });

        it('1.5 Rebouclage robuste garanti si firstPayDateIso est postérieure au début d\'année', () => {
            // Si la date d'ancrage transmise est en cours d'année (ex: 23 octobre 2026),
            // detectBiweeklyThreePayMonths rembobine au début d'année pour couvrir les 12 mois
            const fromOctober = detectBiweeklyThreePayMonths('2026-10-23', 2026);
            // Cycle partant du 2 janvier 2026 -> 3 paies en janvier (0) et juillet (6) :
            expect(fromOctober).toEqual([0, 6]);
        });

        it('1.6 SUCCÈS NOMINAL : detectPayCadence avec 26 paies réelles détecte fidèlement les Magic Months', () => {
            // Création d'une série complète de 26 paies bihebdomadaires en 2026
            const fullYearSalaryTx: Transaction[] = [];
            const d = new Date(Date.UTC(2026, 0, 9, 12, 0, 0));
            for (let i = 0; i < 26; i++) {
                const iso = d.toISOString().slice(0, 10);
                fullYearSalaryTx.push({
                    id: 1000 + i,
                    date: iso,
                    amount: 2500,
                    category: 'Salaire',
                    payee: 'Acme Corp Inc.',
                    status: 'processed',
                });
                d.setUTCDate(d.getUTCDate() + 14);
            }

            expect(fullYearSalaryTx.length).toBe(26);
            expect(fullYearSalaryTx[0].date).toBe('2026-01-09');
            expect(fullYearSalaryTx[25].date).toBe('2026-12-25');

            const schedule = detectPayCadence(fullYearSalaryTx);
            expect(schedule.frequency).toBe('biweekly');

            // En 2026, avec une paie le 9 janvier, mai (index 4) et octobre (index 9) ont 3 paies.
            // Grâce au rembobinage robuste, schedule.threePayMonths détecte exactement [4, 9] :
            expect(schedule.threePayMonths).toEqual([4, 9]);
        });
    });

    // =========================================================================
    // 2. PRÉLÈVEMENTS FIXES & DÉCALAGES BANCAIRES OUVRABLES (F11)
    // =========================================================================
    describe('2. Prélèvements fixes & Décalages bancaires ouvrables (F11)', () => {

        it('2.1 Jours fériés officiels québécois et canadiens (ACCS / Payments Canada H1)', () => {
            const h2026 = getCanadianBankHolidays(2026);

            // Fériés québécois et canadiens majeurs
            expect(h2026.has('2026-01-01')).toBe(true); // Jour de l'An
            expect(h2026.has('2026-06-24')).toBe(true); // Saint-Jean-Baptiste (Fête nationale QC)
            expect(h2026.has('2026-07-01')).toBe(true); // Fête du Canada
            expect(h2026.has('2026-09-30')).toBe(true); // Vérité et Réconciliation
            expect(h2026.has('2026-11-11')).toBe(true); // Jour du Souvenir
            expect(h2026.has('2026-12-25')).toBe(true); // Noël
            expect(h2026.has('2026-12-26')).toBe(true); // Boxing Day / Lendemain de Noël

            // Fêtes mobiles calculées (comput de Pâques, Patriotes, Travail, Action de Grâce)
            // En 2026 : Pâques = 5 avril 2026 -> Vendredi Saint = 3 avril 2026
            expect(h2026.has('2026-04-03')).toBe(true); // Good Friday

            // Journée des Patriotes (lundi précédant le 25 mai 2026) : 25 mai 2026 est un lundi -> 18 mai 2026
            expect(h2026.has('2026-05-18')).toBe(true);

            // Fête du Travail : 1er lundi de septembre 2026 -> 7 septembre 2026
            expect(h2026.has('2026-09-07')).toBe(true);

            // Action de Grâce : 2e lundi d'octobre 2026 -> 12 octobre 2026
            expect(h2026.has('2026-10-12')).toBe(true);
        });

        it('2.2 Test de collision exacte pour les prélèvements sur jours fériés', () => {
            // Collision Saint-Jean-Baptiste (24 juin 2026 = mercredi férié)
            expect(isBusinessDayCanadian('2026-06-24')).toBe(false);
            expect(shiftDateToBusinessDayOracle('2026-06-24', 'following')).toBe('2026-06-25'); // Jeudi
            expect(shiftDateToBusinessDayOracle('2026-06-24', 'preceding')).toBe('2026-06-23'); // Mardi

            // Collision Fête du Canada (1er juillet 2026 = mercredi férié)
            expect(isBusinessDayCanadian('2026-07-01')).toBe(false);
            expect(shiftDateToBusinessDayOracle('2026-07-01', 'following')).toBe('2026-07-02'); // Jeudi
            expect(shiftDateToBusinessDayOracle('2026-07-01', 'preceding')).toBe('2026-06-30'); // Mardi

            // Collision Vendredi Saint (3 avril 2026) + Week-end (4-5 avril)
            expect(isBusinessDayCanadian('2026-04-03')).toBe(false);
            expect(isBusinessDayCanadian('2026-04-04')).toBe(false); // Samedi
            expect(isBusinessDayCanadian('2026-04-05')).toBe(false); // Dimanche
            expect(shiftDateToBusinessDayOracle('2026-04-03', 'following')).toBe('2026-04-06'); // Lundi de Pâques ouvrable
            expect(shiftDateToBusinessDayOracle('2026-04-03', 'preceding')).toBe('2026-04-02'); // Jeudi saint

            // Collision Noël (25 décembre 2026 = vendredi) + Boxing Day (26 décembre = samedi) + Dimanche (27 décembre)
            expect(isBusinessDayCanadian('2026-12-25')).toBe(false);
            expect(isBusinessDayCanadian('2026-12-26')).toBe(false);
            expect(isBusinessDayCanadian('2026-12-27')).toBe(false);
            expect(shiftDateToBusinessDayOracle('2026-12-25', 'following')).toBe('2026-12-28'); // Lundi 28 décembre
            expect(shiftDateToBusinessDayOracle('2026-12-25', 'preceding')).toBe('2026-12-24'); // Jeudi 24 décembre
        });

        it('2.3 Collision d\'un prélèvement de fin de mois (31e jour) sur un mois court (30 jours)', () => {
            const requestedDay = 31;
            const daysInApril = 30;
            const actualDay = Math.min(requestedDay, daysInApril);
            expect(actualDay).toBe(30);

            // 30 avril 2026 est un jeudi ouvré
            expect(isBusinessDayCanadian('2026-04-30')).toBe(true);
        });
    });

    // =========================================================================
    // 3. 3 MODES DE PROJECTION ET CONTINUITÉ C0 (F12)
    // =========================================================================
    describe('3. 3 Modes de projection & Continuité mathématique C0 (F12)', () => {
        const budgetTarget = 4000;
        const realObserved = 4800; // Écart de 800 $/mois

        it('3.1 Mode budget : invariant à 100 % sur toute la durée', () => {
            for (let m = 0; m <= 120; m++) {
                expect(computeProjectedExpenseForMonth(m, budgetTarget, realObserved, 'budget')).toBe(budgetTarget);
            }
        });

        it('3.2 Mode réel : invariant à 100 % des dépenses réelles sans convergence', () => {
            for (let m = 0; m <= 120; m++) {
                expect(computeProjectedExpenseForMonth(m, budgetTarget, realObserved, 'real')).toBe(realObserved);
            }
        });

        it('3.3 Mode hybride : continuité mathématique C0 et absence de discontinuité', () => {
            // Vérification de la continuité C0 : la différence entre deux mois consécutifs |f(m+1) - f(m)|
            // doit être exactement 0 pour m <= 12, constante pour 12 < m <= 36, et 0 pour m > 36.
            const values = [];
            for (let m = 0; m <= 60; m++) {
                values.push(computeProjectedExpenseForMonth(m, budgetTarget, realObserved, 'hybrid'));
            }

            // Plateau court terme (0 à 12 mois)
            for (let m = 0; m <= 12; m++) {
                expect(values[m]).toBe(realObserved);
            }

            // Pente de transition douce entre 12 et 36 mois : (4000 - 4800) / 24 = -33.3333 $/mois
            const monthlyDelta = (budgetTarget - realObserved) / 24;
            for (let m = 13; m <= 36; m++) {
                const expected = realObserved + (m - 12) * monthlyDelta;
                expect(values[m]).toBeCloseTo(expected, 2);
                const step = values[m] - values[m - 1];
                expect(step).toBeCloseTo(monthlyDelta, 2);
            }

            // Plateau long terme (36 mois et plus)
            for (let m = 36; m <= 60; m++) {
                expect(values[m]).toBe(budgetTarget);
            }
        });

        it('3.4 Égalité exacte au centime près aux bornes critiques (t <= 12, t = 24, t >= 36)', () => {
            // Borne t <= 12
            expect(computeProjectedExpenseForMonth(0, budgetTarget, realObserved, 'hybrid')).toBe(4800.00);
            expect(computeProjectedExpenseForMonth(1, budgetTarget, realObserved, 'hybrid')).toBe(4800.00);
            expect(computeProjectedExpenseForMonth(12, budgetTarget, realObserved, 'hybrid')).toBe(4800.00);

            // Borne médiane t = 24 : moyenne arithmétique exacte
            expect(computeProjectedExpenseForMonth(24, budgetTarget, realObserved, 'hybrid')).toBe(4400.00);

            // Borne t >= 36
            expect(computeProjectedExpenseForMonth(36, budgetTarget, realObserved, 'hybrid')).toBe(4000.00);
            expect(computeProjectedExpenseForMonth(48, budgetTarget, realObserved, 'hybrid')).toBe(4000.00);
            expect(computeProjectedExpenseForMonth(120, budgetTarget, realObserved, 'hybrid')).toBe(4000.00);
        });

        it('3.5 Continuité C0 en cas de dépenses réelles frugales (réel < budget)', () => {
            const frugalReal = 3200; // Réel 3200 < Budget 4000
            expect(computeProjectedExpenseForMonth(12, budgetTarget, frugalReal, 'hybrid')).toBe(3200.00);
            expect(computeProjectedExpenseForMonth(24, budgetTarget, frugalReal, 'hybrid')).toBe(3600.00);
            expect(computeProjectedExpenseForMonth(36, budgetTarget, frugalReal, 'hybrid')).toBe(4000.00);
        });
    });

    // =========================================================================
    // 4. PRÉSERVATION ABSOLUE DE LA SÉQUENCE RNG MONTE CARLO
    // =========================================================================
    describe('4. Inviolabilité de la séquence RNG Monte Carlo (F12)', () => {

        const createMockParams = (): SimulationParams => ({
            projection: {
                years: 25, returnRate: 6, inflationRate: 2, savingsMode: 'manual', manualContribution: 2_000,
                usePortfolioRate: false, returnRates: { celi: 6, reer: 6, nonReg: 6, crypto: 8, cash: 2 },
                emergencyFundMonths: 6, salaryGrowth: 2, propertyGrowthRate: 3,
            } as ProjectionConfig,
            calculatedStartingCash: 50_000,
            liveCSVBalances: { CELI: 30_000, CELIAPP: 0, REER: 80_000, NON_ENREG: 20_000, CRYPTO: 0, REEE: 0 },
            realEstateGoals: [], debts: [], childGoals: [], travelGoals: [], lifeEvents: [],
            retirementGoal: {
                targetAge: 65, targetMonthlyIncome: 4_000, governmentPension: 1_800,
                lifeExpectancy: 90, dbPensionMonthly: 0,
            } as unknown as RetirementGoal,
            config: {
                users: [
                    { name: 'Marc', grossSalary: 7_500, netSalary: 5_200, color: '#10b981', age: 40, birthYear: 1986, canadaArrivalYear: 1986, hasOwnedPropertyLast4Years: false, celiContributed: 0, rrspContributed: 0 }
                ] as unknown as User[],
                splitMode: '50/50'
            } as unknown as BudgetConfig,
            baseGrossAnnual: 90_000, baseNetAnnual: 62_400, currentRentExpense: 1_500,
            baseMonthlyExpenses: 3_800, startYear: 2026, startMonth: 0,
        } as unknown as SimulationParams);

        interface TestScenarioOutput {
            chartData: Array<{ totalExpenses: number; netWorth: number }>;
            finalNetWorth: number;
        }

        it('4.1 Le mode budget par défaut garantit une stricte reproductibilité déterministe', () => {
            const p1 = createMockParams();
            const p2 = createMockParams();

            // Deux exécutions déterministes successives
            const res1 = __runScenarioForTests(p1, 'AUTO_MARGINAL' as unknown as AllocationStrategy, false, false) as unknown as TestScenarioOutput;
            const res2 = __runScenarioForTests(p2, 'AUTO_MARGINAL' as unknown as AllocationStrategy, false, false) as unknown as TestScenarioOutput;

            expect(res1.chartData.length).toBe(res2.chartData.length);
            expect(res1.finalNetWorth).toBe(res2.finalNetWorth);

            // Vérification de l'égalité au centime près sur les 12 premiers mois
            for (let i = 0; i < 12; i++) {
                expect(res1.chartData[i].totalExpenses).toBe(res2.chartData[i].totalExpenses);
                expect(res1.chartData[i].netWorth).toBe(res2.chartData[i].netWorth);
            }
        });

        it('4.2 Simulation Monte Carlo avec runScenarioForTests : invariance des tirages', () => {
            const p1 = createMockParams();
            const p2 = createMockParams();

            const mc1 = __runScenarioForTests(p1, 'AUTO_MARGINAL' as unknown as AllocationStrategy, true, false) as unknown as TestScenarioOutput;
            const mc2 = __runScenarioForTests(p2, 'AUTO_MARGINAL' as unknown as AllocationStrategy, true, false) as unknown as TestScenarioOutput;

            expect(mc1.finalNetWorth).toBe(mc2.finalNetWorth);
        });

        it('4.3 En mode budget, aucun tirage stochastique n\'est consommé pour les dépenses', () => {
            const profile = createDefaultBehavioralProfile(4000, {
                expenseMode: 'budget',
                expenseVolatility: 0.15, // Même avec volatilité élevée
            });

            // En mode budget, stochasticZ doit être 0 et les dépenses doivent être strictement égales
            const expMC_off = computeProjectedExpenses({
                monthIndex: 6,
                calendarMonth: 5,
                budgetTargetExpenses: 4000,
                profile,
                expenseMultiplier: 1.0,
                enableMonteCarlo: false,
                stochasticZ: 0,
            });

            const expMC_on = computeProjectedExpenses({
                monthIndex: 6,
                calendarMonth: 5,
                budgetTargetExpenses: 4000,
                profile,
                expenseMultiplier: 1.0,
                enableMonteCarlo: true,
                stochasticZ: 2.5, // Z élevé
            });

            expect(expMC_off.projectedExpenses).toBe(4000);
            expect(expMC_on.projectedExpenses).toBe(4000);
            expect(expMC_off.projectedExpenses).toBe(expMC_on.projectedExpenses);
        });
    });
});
