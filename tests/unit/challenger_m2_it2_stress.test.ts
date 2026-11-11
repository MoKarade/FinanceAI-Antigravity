// tests/unit/challenger_m2_it2_stress.test.ts
//
// HARNAIS D'ÉPREUVES CONTRADICTOIRES EMPIRIQUES — JALON 2 / ITÉRATION 2
// Auteur : teamwork_challenger_m2_it2_1 (Empirical Challenger)
// Rôles : critic, specialist
//
// Objectif contradictoire :
// 1. Stress-testing poussé de detectRecurringPrelevements sur des flux bancaires mixtes et adversariaux :
//    - Rentrées positives massives (10k$ salaire, 25k$ bonus, 50k$ rentrée, remboursements partiels/totaux)
//    - Virements et transferts internes mensuels (épargne automatique, CELI, REER, virements conjointe)
//    - Détection infaillible de toutes les catégories de charges fixes (loyer, hydro, télécom, assurance, dette, abonnements)
// 2. Détection bimensuelle (semi-monthly) avec variations de fins de semaine et jours fériés :
//    - Paies le 15 et 30/31 sur l'année 2026 complète (avec décalages ouvrables)
//    - Paies le 1er et 15 sur l'année 2026 complète
//    - Règle stricte des 24 paies annuelles (* 24) et exclusion absolue de Magic Months (threePayMonths = [])
// 3. Robustesse face aux anomalies numériques et valeurs corrompues

import { describe, it, expect } from 'vitest';
import {
    detectRecurringPrelevements,
    detectCadenceSafe,
    detectPayCadence,
    buildBehavioralProfileFromTransactions,
} from '../../services/projection/behavioralProfile';
import type { Transaction } from '../../types';

describe('Banc de Stress Testing Contradictoire Empirique — Jalon 2 / Itération 2', () => {

    // =========================================================================
    // SECTION 1 : STRESS TESTING DE detectRecurringPrelevements EN FLUX MIXTES
    // =========================================================================
    describe('1. detectRecurringPrelevements : Flux Mixtes Complexes & Filtrage de Transferts', () => {

        it('1.1 : Rentrées positives massives et bonus n\'altèrent pas la détection des charges récurrentes', () => {
            const complexStream: Transaction[] = [
                // Rentrée positive massive : Bonus annuel de fin d'année
                { id: 1, date: '2026-01-05', amount: 25000, category: 'Salaire', payee: 'Acme Mega Corp - Bonus', status: 'processed' },
                // Rentrée positive massive : Paie mensuelle de 12 500 $
                { id: 2, date: '2026-01-15', amount: 12500, category: 'Salaire', payee: 'Acme Mega Corp', status: 'processed' },
                // Rentrée positive massive : Remboursement fiscal d'impôt
                { id: 3, date: '2026-01-20', amount: 4850, category: 'Remboursement', payee: 'ARC / Revenu Québec', status: 'processed' },
                // Charge fixe 1 : Loyer au 1er du mois
                { id: 4, date: '2026-01-01', amount: -2200, category: 'Logement', payee: 'Gestion Immobilière Montréal', status: 'processed' },
                { id: 5, date: '2026-02-01', amount: -2200, category: 'Logement', payee: 'Gestion Immobilière Montréal', status: 'processed' },
                { id: 6, date: '2026-03-01', amount: -2200, category: 'Logement', payee: 'Gestion Immobilière Montréal', status: 'processed' },
                // Charge fixe 2 : Hydro-Québec au 18 du mois
                { id: 7, date: '2026-01-18', amount: -145.20, category: 'Services publics', payee: 'Hydro-Québec', status: 'processed' },
                { id: 8, date: '2026-02-18', amount: -152.80, category: 'Services publics', payee: 'Hydro-Québec', status: 'processed' },
                { id: 9, date: '2026-03-18', amount: -148.50, category: 'Services publics', payee: 'Hydro-Québec', status: 'processed' },
                // Remboursements partiels positifs intercalés
                { id: 10, date: '2026-02-05', amount: 120.00, category: 'Remboursement', payee: 'Interac Ami Souper', status: 'processed' },
                { id: 11, date: '2026-02-15', amount: 12500, category: 'Salaire', payee: 'Acme Mega Corp', status: 'processed' },
                { id: 12, date: '2026-03-15', amount: 12500, category: 'Salaire', payee: 'Acme Mega Corp', status: 'processed' },
                // Dépenses variables éparses (non récurrentes)
                { id: 13, date: '2026-01-10', amount: -85.00, category: 'Restaurants', payee: 'Bistro du Coin', status: 'processed' },
                { id: 14, date: '2026-02-14', amount: -190.00, category: 'Restaurants', payee: 'Chic Resto St-Valentin', status: 'processed' },
                { id: 15, date: '2026-03-22', amount: -320.00, category: 'Magasinage', payee: 'Boutique Électronique', status: 'processed' },
            ];

            const prelevements = detectRecurringPrelevements(complexStream);

            // Seuls le Loyer et Hydro-Québec doivent ressortir
            expect(prelevements.length).toBe(2);

            const rent = prelevements.find(p => p.category === 'housing');
            expect(rent).toBeDefined();
            expect(rent?.payee).toBe('GESTION IMMOBILIÈRE MONTRÉAL');
            expect(rent?.averageAmount).toBe(2200);
            expect(rent?.targetDayOfMonth).toBe(1);
            expect(rent?.yearlyCost).toBe(2200 * 12);
            expect(rent?.confidence).toBe('high');
            expect(rent?.historyCount).toBe(3);

            const hydro = prelevements.find(p => p.category === 'utility');
            expect(hydro).toBeDefined();
            expect(hydro?.payee).toBe('HYDRO-QUÉBEC');
            // Médiane de [145.20, 148.50, 152.80] = 148.50
            expect(hydro?.averageAmount).toBe(148.50);
            expect(hydro?.targetDayOfMonth).toBe(18);
            expect(hydro?.confidence).toBe('high');
        });

        it('1.2 : Transferts et virements internes récurrents (ex: épargne mensuelle automatique de 1000$) sont rigoureusement ignorés', () => {
            const streamWithTransfers: Transaction[] = [
                // Virement automatique récurrent de 1000$/mois vers le CELI le 1er du mois
                { id: 101, date: '2026-01-01', amount: -1000, category: 'Transfert', payee: 'Virement Épargne CELI', status: 'processed' },
                { id: 102, date: '2026-02-01', amount: -1000, category: 'Transfert', payee: 'Virement Épargne CELI', status: 'processed' },
                { id: 103, date: '2026-03-01', amount: -1000, category: 'Transfert', payee: 'Virement Épargne CELI', status: 'processed' },
                // Virement récurrent vers compte conjoint avec flag isTransfer
                { id: 104, date: '2026-01-15', amount: -750, category: 'Logement', payee: 'Virement Conjoint Loyer', isTransfer: true, status: 'processed' },
                { id: 105, date: '2026-02-15', amount: -750, category: 'Logement', payee: 'Virement Conjoint Loyer', isTransfer: true, status: 'processed' },
                // Épargne / Investissement récurrent vers courtage
                { id: 106, date: '2026-01-20', amount: -500, category: 'Investissement', payee: 'Disnat Courtage Direct', status: 'processed' },
                { id: 107, date: '2026-02-20', amount: -500, category: 'Épargne', payee: 'Disnat Courtage Direct', status: 'processed' },
                { id: 108, date: '2026-03-20', amount: -500, category: 'Investissement', payee: 'Disnat Courtage Direct', status: 'processed' },
                // Catégorie Virement / Virements
                { id: 109, date: '2026-01-10', amount: -300, category: 'Virement', payee: 'Virement Interac Frère', status: 'processed' },
                { id: 110, date: '2026-02-10', amount: -300, category: 'Virements', payee: 'Virement Interac Frère', status: 'processed' },
                // Vraie charge fixe : Vidéotron Internet
                { id: 111, date: '2026-01-25', amount: -78.99, category: 'Abonnements', payee: 'Vidéotron Ltée', status: 'processed' },
                { id: 112, date: '2026-02-25', amount: -78.99, category: 'Abonnements', payee: 'Vidéotron Ltée', status: 'processed' },
                { id: 113, date: '2026-03-25', amount: -78.99, category: 'Abonnements', payee: 'Vidéotron Ltée', status: 'processed' },
            ];

            const prelevements = detectRecurringPrelevements(streamWithTransfers);

            // Strictement aucun transfert ou virement ne doit figurer dans les charges fixes
            expect(prelevements.length).toBe(1);
            expect(prelevements[0].payee).toBe('VIDÉOTRON LTÉE');
            expect(prelevements[0].category).toBe('telecom');
            expect(prelevements[0].averageAmount).toBe(78.99);
            expect(prelevements[0].targetDayOfMonth).toBe(25);
        });

        it('1.3 : Détection exhaustive des 6 catégories canoniques de charges fixes régulières', () => {
            const allCategoriesStream: Transaction[] = [
                // 1. housing : Hypothèque Desjardins
                { id: 201, date: '2026-01-01', amount: -1850, category: 'Logement', payee: 'Hypothèque Desjardins', status: 'processed' },
                { id: 202, date: '2026-02-01', amount: -1850, category: 'Logement', payee: 'Hypothèque Desjardins', status: 'processed' },

                // 2. debt : Prêt Personnel Banque Nationale
                { id: 203, date: '2026-01-08', amount: -320, category: 'Dépense', payee: 'Prêt Auto Banque Nationale', status: 'processed' },
                { id: 204, date: '2026-02-08', amount: -320, category: 'Dépense', payee: 'Prêt Auto Banque Nationale', status: 'processed' },

                // 3. insurance : Beneva Assurances
                { id: 205, date: '2026-01-12', amount: -115, category: 'Assurances', payee: 'Beneva Assurances Auto/Habitation', status: 'processed' },
                { id: 206, date: '2026-02-12', amount: -115, category: 'Assurances', payee: 'Beneva Assurances Auto/Habitation', status: 'processed' },

                // 4. utility : Gaz Métro / Énergir Gaz
                { id: 207, date: '2026-01-16', amount: -95, category: 'Services publics', payee: 'Gaz Métro Chauffage', status: 'processed' },
                { id: 208, date: '2026-02-16', amount: -95, category: 'Services publics', payee: 'Gaz Métro Chauffage', status: 'processed' },

                // 5. telecom : Bell Mobilité
                { id: 209, date: '2026-01-22', amount: -65, category: 'Abonnements', payee: 'Bell Mobilité', status: 'processed' },
                { id: 210, date: '2026-02-22', amount: -65, category: 'Abonnements', payee: 'Bell Mobilité', status: 'processed' },

                // 6. subscription : Netflix
                { id: 211, date: '2026-01-27', amount: -22.99, category: 'Loisirs', payee: 'Netflix.com', status: 'processed' },
                { id: 212, date: '2026-02-27', amount: -22.99, category: 'Loisirs', payee: 'Netflix.com', status: 'processed' },
            ];

            const prelevements = detectRecurringPrelevements(allCategoriesStream);
            expect(prelevements.length).toBe(6);

            const mapCat = Object.fromEntries(prelevements.map(p => [p.category, p]));
            expect(mapCat.housing).toBeDefined();
            expect(mapCat.housing.payee).toContain('HYPOTHÈQUE');
            expect(mapCat.debt).toBeDefined();
            expect(mapCat.debt.payee).toContain('PRÊT AUTO');
            expect(mapCat.insurance).toBeDefined();
            expect(mapCat.insurance.payee).toContain('BENEVA');
            expect(mapCat.utility).toBeDefined();
            expect(mapCat.utility.payee).toContain('GAZ MÉTRO');
            expect(mapCat.telecom).toBeDefined();
            expect(mapCat.telecom.payee).toContain('BELL');
            expect(mapCat.subscription).toBeDefined();
            expect(mapCat.subscription.payee).toContain('NETFLIX');
        });

        it('1.4 : Prélèvement de fin de mois avec décalage de fin de semaine : targetDayOfMonth et isEndOfMonth corrects', () => {
            // Un prélèvement au 31 du mois :
            // Janvier : 31 janvier 2026 = Samedi -> débité le 30 janvier (vendredi) ou 2 février (lundi)
            // Février : 28 février 2026 = Samedi -> débité le 27 février
            // Mars : 31 mars 2026 = Mardi -> débité le 31 mars
            const endOfMonthTx: Transaction[] = [
                { id: 301, date: '2026-01-30', amount: -89.99, category: 'Abonnements', payee: 'Gym Énergie Cardio', status: 'processed' },
                { id: 302, date: '2026-02-27', amount: -89.99, category: 'Abonnements', payee: 'Gym Énergie Cardio', status: 'processed' },
                { id: 303, date: '2026-03-31', amount: -89.99, category: 'Abonnements', payee: 'Gym Énergie Cardio', status: 'processed' },
                { id: 304, date: '2026-04-30', amount: -89.99, category: 'Abonnements', payee: 'Gym Énergie Cardio', status: 'processed' },
            ];

            const prelevements = detectRecurringPrelevements(endOfMonthTx);
            expect(prelevements.length).toBe(1);
            const gym = prelevements[0];
            expect(gym.payee).toBe('GYM ÉNERGIE CARDIO');
            expect(gym.isEndOfMonth).toBe(true);
            expect(gym.targetDayOfMonth).toBeGreaterThanOrEqual(27);
            expect(gym.averageAmount).toBe(89.99);
        });

        it('1.5 : Données corrompues, doublons et montants atypiques ne font pas crasher l\'algorithme', () => {
            const dirtyStream: Transaction[] = [
                { id: 401, date: '2026-01-01', amount: NaN, category: 'Logement', payee: 'Loyer Corrompu', status: 'processed' },
                { id: 402, date: '2026-01-02', amount: Infinity, category: 'Salaire', payee: 'Infini', status: 'processed' },
                { id: 403, date: '2026-01-03', amount: -Infinity, category: 'Autre', payee: 'Moins Infini', status: 'processed' },
                { id: 404, date: '2026-01-04', amount: 0, category: 'Logement', payee: 'Loyer Nul', status: 'processed' },
                // Vraie récurrence avec un doublon intercalé
                { id: 405, date: '2026-01-15', amount: -50, category: 'Abonnements', payee: 'Spotify', status: 'processed' },
                { id: 406, date: '2026-01-15', amount: -50, category: 'Abonnements', payee: 'Spotify', isDuplicate: true, status: 'processed' },
                { id: 407, date: '2026-02-15', amount: -50, category: 'Abonnements', payee: 'Spotify', status: 'processed' },
            ];

            const prelevements = detectRecurringPrelevements(dirtyStream);
            expect(prelevements.length).toBe(1);
            expect(prelevements[0].payee).toBe('SPOTIFY');
            expect(prelevements[0].averageAmount).toBe(50);
            expect(prelevements[0].historyCount).toBe(2); // Le doublon a été ignoré
        });

        it('1.6 : Analyse contradictoire de la robustesse diacritique sur Énergir / Électricité', () => {
            // Épreuve contradictoire : la regex /hydro|gaz|electricité|énergie|energir/
            // matche 'Hydro' et 'Gaz Métro' mais échoue sur 'Énergir' isolé (car 'e' != 'é' et 'ie' != 'ir').
            // La transaction est néanmoins correctement retenue comme charge récurrente (dans 'other').
            const energirTx: Transaction[] = [
                { id: 450, date: '2026-01-15', amount: -110, category: 'Services publics', payee: 'Énergir', status: 'processed' },
                { id: 451, date: '2026-02-15', amount: -110, category: 'Services publics', payee: 'Énergir', status: 'processed' },
            ];
            const prelevements = detectRecurringPrelevements(energirTx);
            expect(prelevements.length).toBe(1);
            expect(prelevements[0].payee).toBe('ÉNERGIR');
            expect(prelevements[0].averageAmount).toBe(110);
            // Constat empirique contradictoire : catégorisé en 'other' par absence de pliage diacritique é -> e
            expect(prelevements[0].category).toBe('other');
        });
    });

    // =========================================================================
    // SECTION 2 : STRESS TESTING CADENCE BIMENSUELLE (SEMI-MONTHLY) ET ANNUALISATION
    // =========================================================================
    describe('2. Détection Bimensuelle (semi-monthly) & Règle Stricte des 24 Paies', () => {

        /**
         * Oracle pour construire une série de paies bimensuelles réalistes en tenant compte
         * des week-ends (décalage au jour ouvrable bancaire précédent ou suivant).
         */
        function buildRealisticSemiMonthlySchedule(
            year: number,
            mode: '15_and_end' | '1_and_15',
            amount: number = 3000,
            convention: 'preceding' | 'following' = 'preceding'
        ): Transaction[] {
            const pad = (n: number) => String(n).padStart(2, '0');
            const tx: Transaction[] = [];
            let id = 1000;

            for (let m = 0; m < 12; m++) {
                let day1: number;
                let day2: number;

                if (mode === '15_and_end') {
                    day1 = 15;
                    // Dernier jour du mois (28/29 en fév, 30 ou 31)
                    day2 = new Date(year, m + 1, 0).getDate();
                } else {
                    day1 = 1;
                    day2 = 15;
                }

                for (const d of [day1, day2]) {
                    const dateObj = new Date(Date.UTC(year, m, d, 12, 0, 0));
                    // Décalage de weekend si samedi (6) ou dimanche (0)
                    const dayOfWeek = dateObj.getUTCDay();
                    if (dayOfWeek === 6) { // Samedi
                        dateObj.setUTCDate(dateObj.getUTCDate() + (convention === 'preceding' ? -1 : 2));
                    } else if (dayOfWeek === 0) { // Dimanche
                        dateObj.setUTCDate(dateObj.getUTCDate() + (convention === 'preceding' ? -2 : 1));
                    }

                    const iso = `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth() + 1)}-${pad(dateObj.getUTCDate())}`;
                    tx.push({
                        id: ++id,
                        date: iso,
                        amount,
                        category: 'Salaire',
                        payee: 'Gouvernement du Québec',
                        status: 'processed',
                    });
                }
            }

            // Tri chronologique
            return tx.sort((a, b) => a.date.localeCompare(b.date));
        }

        it('2.1 : Relevé réel complet 2026 aux 15 et dernier jour du mois (24 paies avec weekends décalés)', () => {
            const tx2026 = buildRealisticSemiMonthlySchedule(2026, '15_and_end', 3200, 'preceding');

            // 12 mois * 2 = exactement 24 paies
            expect(tx2026.length).toBe(24);

            // Vérification des intervalles :
            const intervals: number[] = [];
            for (let i = 1; i < tx2026.length; i++) {
                const d1 = new Date(tx2026[i - 1].date + 'T12:00:00');
                const d2 = new Date(tx2026[i].date + 'T12:00:00');
                intervals.push(Math.round((d2.getTime() - d1.getTime()) / 86400000));
            }
            const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
            // Intervalle moyen sur l'année : 355/23 = 15.43 jours (centré sur 15.2 jours)
            expect(meanInterval).toBeGreaterThanOrEqual(14.6);
            expect(meanInterval).toBeLessThanOrEqual(17.0);

            // Classification par detectCadenceSafe
            expect(detectCadenceSafe(intervals)).toBe('semi-monthly');

            // Exécution de detectPayCadence
            const schedule = detectPayCadence(tx2026);

            // 1. Fréquence
            expect(schedule.frequency).toBe('semi-monthly');

            // 2. Annualisation nette STRICTEMENT égale à 24 * typicalNetPay
            expect(schedule.typicalNetPay).toBe(3200);
            expect(schedule.annualizedNetIncome).toBe(3200 * 24);
            expect(schedule.annualizedNetIncome).not.toBe(3200 * 26); // Ne doit JAMAIS appliquer 26 !

            // 3. Absence totale de Magic Month (threePayMonths = [])
            expect(schedule.threePayMonths).toEqual([]);
            expect(schedule.threePayMonths.length).toBe(0);

            // 4. Confiance
            expect(schedule.confidence).toBe('high');
        });

        it('2.2 : Relevé réel 2026 aux 1er et 15 du mois (24 paies avec convention following)', () => {
            const tx2026 = buildRealisticSemiMonthlySchedule(2026, '1_and_15', 2850, 'following');
            expect(tx2026.length).toBe(24);

            const schedule = detectPayCadence(tx2026);
            expect(schedule.frequency).toBe('semi-monthly');
            expect(schedule.typicalNetPay).toBe(2850);
            expect(schedule.annualizedNetIncome).toBe(2850 * 24);
            expect(schedule.threePayMonths).toEqual([]);
        });

        it('2.3 : Comparaison contradictoire stricte : biweekly vs semi-monthly sur un an', () => {
            // Série bihebdomadaire (26 paies de 2500$)
            const biweeklyTx: Transaction[] = [];
            const dBi = new Date(Date.UTC(2026, 0, 9, 12, 0, 0));
            for (let i = 0; i < 26; i++) {
                biweeklyTx.push({
                    id: 2000 + i,
                    date: dBi.toISOString().slice(0, 10),
                    amount: 2500,
                    category: 'Salaire',
                    payee: 'Entreprise Bihebdo',
                    status: 'processed',
                });
                dBi.setUTCDate(dBi.getUTCDate() + 14);
            }

            // Série bimensuelle (24 paies de 2500$)
            const semiMonthlyTx = buildRealisticSemiMonthlySchedule(2026, '15_and_end', 2500);

            const biSchedule = detectPayCadence(biweeklyTx);
            const semiSchedule = detectPayCadence(semiMonthlyTx);

            // Comparaison des fréquences
            expect(biSchedule.frequency).toBe('biweekly');
            expect(semiSchedule.frequency).toBe('semi-monthly');

            // Comparaison des annualisations
            expect(biSchedule.annualizedNetIncome).toBe(2500 * 26); // 65 000 $
            expect(semiSchedule.annualizedNetIncome).toBe(2500 * 24); // 60 000 $
            const diffAnnual = (biSchedule.annualizedNetIncome ?? 0) - (semiSchedule.annualizedNetIncome ?? 0);
            expect(diffAnnual).toBe(5000); // Écart structurel de 2 paies complètes

            // Comparaison des Magic Months
            expect(biSchedule.threePayMonths.length).toBe(2); // Exactement 2 mois à 3 paies
            expect(semiSchedule.threePayMonths.length).toBe(0); // Strictement aucun mois à 3 paies
        });

        it('2.4 : Frontière fine mathématique entre biweekly ([11, 14.6[) et semi-monthly ([14.6, 17.0])', () => {
            // Moyenne à 14.5 jours -> biweekly
            expect(detectCadenceSafe([14.5, 14.5, 14.5, 14.5])).toBe('biweekly');

            // Moyenne à 14.6 jours -> semi-monthly
            expect(detectCadenceSafe([14.6, 14.6, 14.6, 14.6])).toBe('semi-monthly');

            // Moyenne à 15.2 jours -> semi-monthly
            expect(detectCadenceSafe([15.2, 15.2, 15.2, 15.2])).toBe('semi-monthly');

            // Moyenne à 17.0 jours -> semi-monthly
            expect(detectCadenceSafe([17.0, 17.0, 17.0, 17.0])).toBe('semi-monthly');

            // Moyenne à 17.1 jours -> irregular
            expect(detectCadenceSafe([17.1, 17.1, 17.1, 17.1])).toBe('irregular');
        });

        it('2.5 : Intégration complète via buildBehavioralProfileFromTransactions avec profil bimensuel', () => {
            const mixedFullStatement: Transaction[] = [
                ...buildRealisticSemiMonthlySchedule(2026, '15_and_end', 3500),
                // Loyer récurrent
                { id: 501, date: '2026-01-01', amount: -1600, category: 'Logement', payee: 'Loyer Ville-Marie', status: 'processed' },
                { id: 502, date: '2026-02-01', amount: -1600, category: 'Logement', payee: 'Loyer Ville-Marie', status: 'processed' },
                { id: 503, date: '2026-03-01', amount: -1600, category: 'Logement', payee: 'Loyer Ville-Marie', status: 'processed' },
                // Virement interne CELI récurrent (doit être ignoré dans les prélèvements récurrents)
                { id: 504, date: '2026-01-02', amount: -500, category: 'Transfert', payee: 'Épargne Automatique', status: 'processed' },
                { id: 505, date: '2026-02-02', amount: -500, category: 'Transfert', payee: 'Épargne Automatique', status: 'processed' },
            ];

            const profile = buildBehavioralProfileFromTransactions(mixedFullStatement, 4000, '2026-12-31', 'hybrid');

            // Cadence de paie
            expect(profile.paySchedule).toBeDefined();
            expect(profile.paySchedule?.frequency).toBe('semi-monthly');
            expect(profile.paySchedule?.typicalNetPay).toBe(3500);
            expect(profile.paySchedule?.annualizedNetIncome).toBe(3500 * 24);
            expect(profile.paySchedule?.threePayMonths).toEqual([]);

            // Prélèvements récurrents
            expect(profile.recurringPrelevements).toBeDefined();
            expect(profile.recurringPrelevements?.length).toBe(1);
            expect(profile.recurringPrelevements?.[0].payee).toBe('LOYER VILLE-MARIE');
            expect(profile.recurringPrelevements?.[0].averageAmount).toBe(1600);
        });
    });
});
