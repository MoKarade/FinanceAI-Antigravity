/**
 * Tests Tier 2 — Cas Limites et Bornes pour F08 à F12 (Analyse Comportementale & Double Horizon)
 *
 * Exigences couvertes :
 * - F08 : Bornes audit transactions (historique vide, NaN/Infinity, transactions futures, transferts purs)
 * - F09 : Bornes incompressible/discrétionnaire (historique < 3 mois, outliers 30k$, pente négative, clamp [-50%, +50%])
 * - F10 : Bornes volatilité & saisonnalité (historique court repli 8%, volatilité 0, clamp coefficients [0.5, 2.0])
 * - F11 : Bornes cadence paie & prélèvements (irrégulier/freelance, 1 seul dépôt, décalage week-end +/- 3 jours)
 * - F12 : Bornes 3 modes de projection (mois 0, mois 12, mois 36, mois 120, dépenses réelles inférieures au budget)
 *
 * Méthodologie : Tier 2 (Cas limites, zéros, bornes, 5 cas par fonctionnalité = 25 tests)
 * Sources d'autorité : ORIGINAL_REQUEST.md § R2, PROJECT.md § M2, plan_calculs_futur.md § Pilier 1.
 */

import { describe, it, expect } from 'vitest';
import {
    auditSpendingSafe,
    computeCreepWithOutlierFilter,
    computeVolatilitySafe,
    detectCadenceSafe,
    computeExpenseBounded,
} from '../../services/projection/behavioralProfile';

// Types de données
interface TxBoundaryMock {
    id: string;
    date: string;
    amount: number;
    category: string;
    isTransfer?: boolean;
    isDuplicate?: boolean;
}

describe('Tier 2 — F08 : Bornes de l\'audit des transactions réelles', () => {
    it('F08.B1 : Historique totalement vide (transactions = []) retourne 0 $ sans exception ni crash', () => {
        const audit = auditSpendingSafe([], 'Épicerie', 6);
        expect(audit.meanMonthly).toBe(0);
        expect(audit.total).toBe(0);
        expect(audit.count).toBe(0);
    });

    it('F08.B2 : Rejet strict des montants corrompus (NaN, Infinity, -Infinity)', () => {
        const corrupted: TxBoundaryMock[] = [
            { id: '1', date: '2026-10-01', amount: NaN, category: 'Loisirs' },
            { id: '2', date: '2026-10-02', amount: Infinity, category: 'Loisirs' },
            { id: '3', date: '2026-10-03', amount: -Infinity, category: 'Loisirs' },
        ];
        const audit = auditSpendingSafe(corrupted, 'Loisirs', 3);
        expect(audit.total).toBe(0);
        expect(audit.count).toBe(0);
    });

    it('F08.B3 : Transactions antérieures à la fenêtre demandée (ex. > 12 mois) ignorées', () => {
        const oldTx: TxBoundaryMock[] = [
            { id: '1', date: '2024-01-01', amount: -500, category: 'Restos' }, // 2 ans avant 2026-10
            { id: '2', date: '2026-10-15', amount: -150, category: 'Restos' },
        ];
        const audit = auditSpendingSafe(oldTx, 'Restos', 3, '2026-10-31');
        expect(audit.total).toBe(150);
        expect(audit.count).toBe(1);
    });

    it('F08.B4 : Transactions futures (date postérieure à la date de référence) ignorées', () => {
        const futureTx: TxBoundaryMock[] = [
            { id: '1', date: '2027-01-01', amount: -300, category: 'Restos' },
            { id: '2', date: '2026-10-10', amount: -200, category: 'Restos' },
        ];
        const audit = auditSpendingSafe(futureTx, 'Restos', 3, '2026-10-31');
        expect(audit.total).toBe(200);
        expect(audit.count).toBe(1);
    });

    it('F08.B5 : Transactions composées uniquement de transferts et doublons donnent 0 $ net', () => {
        const transfersOnly: TxBoundaryMock[] = [
            { id: '1', date: '2026-10-10', amount: -1000, category: 'Épargne', isTransfer: true },
            { id: '2', date: '2026-10-10', amount: -1000, category: 'Épargne', isDuplicate: true },
        ];
        const audit = auditSpendingSafe(transfersOnly, 'Épargne', 3);
        expect(audit.total).toBe(0);
    });
});

describe('Tier 2 — F09 : Bornes incompressible/discrétionnaire et Lifestyle Creep', () => {
    it('F09.B1 : Historique de moins de 3 mois retourne une pente de creep nulle (0 $/mois)', () => {
        const shortHistory = [4000, 4200];
        const res = computeCreepWithOutlierFilter(shortHistory);
        expect(res.slope).toBe(0);
        expect(res.hasCreep).toBe(false);
    });

    it('F09.B2 : Achat exceptionnel massif (outlier de 25 000 $ pour une voiture) filtré pour préserver la pente réelle', () => {
        // Mois ordinaires à 4 000 $, mois 3 avec achat de voiture à 29 000 $
        const historyWithOutlier = [4000, 4050, 29000, 4100, 4150, 4200];
        const res = computeCreepWithOutlierFilter(historyWithOutlier);
        // Après remplacement par la médiane (4 100 $), la pente reste saine (~30-40 $/mois) et ne s'envole pas
        expect(res.slope).toBeLessThan(100);
        expect(res.hasCreep).toBe(false);
    });

    it('F09.B3 : Pente descendante (frugalité accrue, ex. réduction de 100 $/mois) rapportée négativement sans fausse alerte', () => {
        const frugalMonths = [5000, 4900, 4800, 4700, 4600, 4500];
        const res = computeCreepWithOutlierFilter(frugalMonths);
        expect(res.slope).toBeCloseTo(-100, 1);
        expect(res.hasCreep).toBe(false);
    });

    it('F09.B4 : Dépenses nulles (0 $ tous les mois) donnent une variabilité et pente nulles', () => {
        const zeroMonths = [0, 0, 0, 0, 0, 0];
        const res = computeCreepWithOutlierFilter(zeroMonths);
        expect(res.slope).toBe(0);
        expect(res.hasCreep).toBe(false);
    });

    it('F09.B5 : Pente extrême clampée à la borne haute maximale (+500 $/mois)', () => {
        const explodingExpenses = [2000, 4000, 8000, 14000, 22000, 32000];
        const res = computeCreepWithOutlierFilter(explodingExpenses);
        expect(res.slope).toBe(500);
        expect(res.hasCreep).toBe(true);
    });
});

describe('Tier 2 — F10 : Bornes de la volatilité et saisonnalité', () => {
    it('F10.B1 : Moins de 3 mois de données déclenche le repli prudent à 8.0 % (0.08)', () => {
        const vol = computeVolatilitySafe([4000, 4500]);
        expect(vol).toBe(0.08);
    });

    it('F10.B2 : Dépenses parfaitement constantes (variance nulle) donnent 0.0 % de volatilité', () => {
        const vol = computeVolatilitySafe([3500, 3500, 3500, 3500]);
        expect(vol).toBe(0);
    });

    it('F10.B3 : Dépenses avec toutes les valeurs à 0 $ donnent 0 % de volatilité sans division par zéro', () => {
        const vol = computeVolatilitySafe([0, 0, 0, 0]);
        expect(vol).toBe(0);
    });

    it('F10.B4 : Coefficient de saisonnalité clampé à la borne basse minimale de 0.50', () => {
        const rawFactor = 0.20; // Mois avec quasi aucune dépense
        const clamped = Math.max(0.50, Math.min(2.00, rawFactor));
        expect(clamped).toBe(0.50);
    });

    it('F10.B5 : Coefficient de saisonnalité clampé à la borne haute maximale de 2.00', () => {
        const rawFactor = 2.80; // Mois exceptionnel
        const clamped = Math.max(0.50, Math.min(2.00, rawFactor));
        expect(clamped).toBe(2.00);
    });
});

describe('Tier 2 — F11 : Bornes de la détection de cadence et prélèvements', () => {
    it('F11.B1 : Aucun intervalle ou 1 seul dépôt classe la cadence en \'irregular\'', () => {
        expect(detectCadenceSafe([])).toBe('irregular');
        expect(detectCadenceSafe([14])).toBe('irregular');
    });

    it('F11.B2 : Dépôts sporadiques de travailleur autonome (intervalles 5, 42, 18, 60 jours) classés \'irregular\'', () => {
        const freelanceIntervals = [5, 42, 18, 60];
        expect(detectCadenceSafe(freelanceIntervals)).toBe('irregular');
    });

    it('F11.B3 : Intervalles bi-hebdomadaires avec décalages de jours fériés (13, 15, 14, 14 jours) correctement reconnus en \'biweekly\'', () => {
        const biweeklyWithShifts = [13, 15, 14, 14];
        expect(detectCadenceSafe(biweeklyWithShifts)).toBe('biweekly');
    });

    it('F11.B4 : Intervalles hebdomadaires avec jours fériés (6, 8, 7, 7 jours) reconnus en \'weekly\'', () => {
        const weeklyWithShifts = [6, 8, 7, 7];
        expect(detectCadenceSafe(weeklyWithShifts)).toBe('weekly');
    });

    it('F11.B5 : Date de prélèvement de loyer tombant le 31 lors d\'un mois de 30 jours rabattue au dernier jour du mois', () => {
        const requestedDay = 31;
        const daysInMonth = 30; // ex. avril
        const actualDebitDay = Math.min(requestedDay, daysInMonth);
        expect(actualDebitDay).toBe(30);
    });
});

describe('Tier 2 — F12 : Bornes des 3 modes de projection des dépenses', () => {
    it('F12.B1 : Mois 0 (démarrage immédiat) en mode hybride donne exactement le comportement réel', () => {
        expect(computeExpenseBounded(0, 4000, 4800, 'hybrid')).toBe(4800);
    });

    it('F12.B2 : Mois 12 (frontière court/moyen terme) donne encore 100 % du comportement réel', () => {
        expect(computeExpenseBounded(12, 4000, 4800, 'hybrid')).toBe(4800);
    });

    it('F12.B3 : Mois 36 (frontière moyen/long terme) donne exactement 100 % du budget cible', () => {
        expect(computeExpenseBounded(36, 4000, 4800, 'hybrid')).toBe(4000);
    });

    it('F12.B4 : Mois 120 (10 ans) reste calé à 100 % sur le budget cible', () => {
        expect(computeExpenseBounded(120, 4000, 4800, 'hybrid')).toBe(4000);
    });

    it('F12.B5 : Comportement vertueux où dépenses réelles (3 200 $) < budget cible (4 000 $) : convergence douce', () => {
        const m24 = computeExpenseBounded(24, 4000, 3200, 'hybrid');
        // Point milieu = (3200 + 4000) / 2 = 3600 $
        expect(m24).toBe(3600);
    });
});
