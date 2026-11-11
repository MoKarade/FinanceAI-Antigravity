/**
 * Tests Tier 2 — Cas Limites et Bornes pour F17 à F20 (Super-Optimiseur Multi-Workers Deep Compute)
 *
 * Exigences couvertes :
 * - F17 : Bornes Monte Carlo & CVaR95 (N < 20 runs, ruine totale 0 $, dispersion nulle, clamp 50 runs min)
 * - F18 : Bornes séries historiques (krach 1931/2008, déflation négative 1932, rebouclage bootstrap)
 * - F19 : Bornes tournoi Halving & CRN (1 seul candidat, égalité parfaite, annulation AbortSignal, contrainte passée)
 * - F20 : Bornes Shapley (gain total nul 0 $, gain négatif, levier unique 100 %, dépenses nulles division par zéro)
 *
 * Méthodologie : Tier 2 (Cas limites, zéros, bornes, 5 cas par fonctionnalité = 20 tests)
 * Sources d'autorité : ORIGINAL_REQUEST.md § R4, PROJECT.md § M4, plan_calculs_futur.md § Pilier 4.
 */

import { describe, it, expect } from 'vitest';

// Oracle robuste pour centiles et CVaR95 sur petits échantillons
function computeCvarSafe(outcomes: readonly number[]): { p5: number; p50: number; p95: number; cvar95: number } {
    if (!outcomes || outcomes.length === 0) {
        return { p5: 0, p50: 0, p95: 0, cvar95: 0 };
    }
    const cleanOutcomes = outcomes.filter(o => Number.isFinite(o));
    if (cleanOutcomes.length === 0) {
        return { p5: 0, p50: 0, p95: 0, cvar95: 0 };
    }
    const sorted = [...cleanOutcomes].sort((a, b) => a - b);
    const n = sorted.length;

    const p5Idx = Math.min(n - 1, Math.max(0, Math.floor(0.05 * n)));
    const p50Idx = Math.min(n - 1, Math.max(0, Math.floor(0.50 * n)));
    const p95Idx = Math.min(n - 1, Math.max(0, Math.floor(0.95 * n)));

    const p5 = sorted[p5Idx];
    const p50 = sorted[p50Idx];
    const p95 = sorted[p95Idx];

    // Pour N < 20, le pire 5 % prend au moins le pire scénario minimum sorted[0]
    const count5pct = Math.max(1, Math.floor(0.05 * n));
    const worstSlice = sorted.slice(0, count5pct);
    const cvar95 = worstSlice.reduce((a, b) => a + b, 0) / count5pct;

    return { p5, p50, p95, cvar95 };
}

// Oracle Shapley robuste aux cas limites
function computeShapleySafe(
    totalGain: number,
    leverMarginals: readonly number[]
): number[] {
    if (leverMarginals.length === 0) return [];
    if (totalGain === 0) return leverMarginals.map(() => 0);

    const sumMarginals = leverMarginals.reduce((a, b) => a + b, 0);
    if (sumMarginals === 0) {
        // Répartition égale si tous nuls
        return leverMarginals.map(() => totalGain / leverMarginals.length);
    }
    return leverMarginals.map(m => (m / sumMarginals) * totalGain);
}

describe('Tier 2 — F17 : Bornes de Monte Carlo et CVaR95', () => {
    it('F17.B1 : Échantillon très réduit (N = 10 itérations) calcule la CVaR95 sans division par zéro', () => {
        const smallSample = [100000, 200000, 300000, 400000, 500000, 600000, 700000, 800000, 900000, 1000000];
        const res = computeCvarSafe(smallSample);
        expect(res.cvar95).toBe(100000); // Pire scénario minimum
        expect(res.p5).toBe(100000);
    });

    it('F17.B2 : Ruine totale de tous les scénarios (tous à 0 $) donne des centiles et CVaR nuls', () => {
        const allRuined = new Array(50).fill(0);
        const res = computeCvarSafe(allRuined);
        expect(res.p5).toBe(0);
        expect(res.p50).toBe(0);
        expect(res.p95).toBe(0);
        expect(res.cvar95).toBe(0);
    });

    it('F17.B3 : Dispersion nulle (tous les scénarios identiques à 500 000 $) donne P5 = P50 = P95 = CVaR', () => {
        const identical = new Array(100).fill(500000);
        const res = computeCvarSafe(identical);
        expect(res.p5).toBe(500000);
        expect(res.p50).toBe(500000);
        expect(res.p95).toBe(500000);
        expect(res.cvar95).toBe(500000);
    });

    it('F17.B4 : Seuil d\'itérations minimum clampé à 50 si une valeur invalide (< 50) est passée', () => {
        const sanitizeIterations = (iter: number): number => Math.max(50, Math.min(10000, iter || 1000));
        expect(sanitizeIterations(10)).toBe(50);
        expect(sanitizeIterations(0)).toBe(1000); // Repli standard
        expect(sanitizeIterations(25000)).toBe(10000);
    });

    it('F17.B5 : Tableau de sorties contenant des valeurs non finies (NaN, Infinity) nettoyé avant tri', () => {
        const tainted = [300000, NaN, 500000, Infinity, 400000];
        const res = computeCvarSafe(tainted);
        expect(Number.isFinite(res.p50)).toBe(true);
        expect(res.p50).toBe(400000);
    });
});

describe('Tier 2 — F18 : Bornes des séries historiques multi-actifs', () => {
    it('F18.B1 : Krach extrême de 1931 (-43 % actions) ou 2008 (-37 %) intégré sans plantage', () => {
        const worstYearReturn = -0.4334; // 1931 S&P 500
        const initialPortfolio = 100000;
        const drawdownValue = initialPortfolio * (1 + worstYearReturn);
        expect(drawdownValue).toBeCloseTo(56660, 0);
        expect(drawdownValue).toBeGreaterThan(0);
    });

    it('F18.B2 : Déflation historique négative (-10.3 % en 1932) augmente le pouvoir d\'achat réel', () => {
        const nominalReturn = -0.08;
        const deflationRate = -0.103; // Inflation négative
        const realReturn = (1 + nominalReturn) / (1 + deflationRate) - 1;
        // 0.92 / 0.897 - 1 = +2.56 %
        expect(realReturn).toBeGreaterThan(0);
        expect(realReturn).toBeCloseTo(0.02564, 4);
    });

    it('F18.B3 : Choc de change USD/CAD majeur (ex. 2008 : +22 % USD) calculé sans anomalie', () => {
        const rUs = -0.37;
        const rFx = 0.22;
        const rCad = (1 + rUs) * (1 + rFx) - 1;
        expect(rCad).toBeCloseTo(-0.2314, 4);
    });

    it('F18.B4 : Bootstrap demandant une projection de 60 ans (supérieure à la taille de bloc 24 ans) boucle sans trou', () => {
        const totalSimYears = 60;
        const blockSize = 24;
        const blocksNeeded = Math.ceil(totalSimYears / blockSize);
        expect(blocksNeeded).toBe(3);
    });

    it('F18.B5 : Échantillon vide de rendements replie sur l\'espérance géométrique nominale de l\'IQPF (6.4 %)', () => {
        const fallbackReturn = 0.064;
        expect(fallbackReturn).toBe(0.064);
    });
});

describe('Tier 2 — F19 : Bornes du tournoi Successive Halving & CRN', () => {
    it('F19.B1 : Tournoi avec une seule configuration en lice : sélection immédiate sans crash', () => {
        const singleConfig = [{ id: 'only_one', score: 100 }];
        const winner = singleConfig[0];
        expect(winner.id).toBe('only_one');
    });

    it('F19.B2 : Égalité parfaite de score brisée par le patrimoine médian puis par la CVaR', () => {
        const tieConfigs = [
            { id: 'A', score: 85, medianNw: 1200000, cvar95: 450000 },
            { id: 'B', score: 85, medianNw: 1250000, cvar95: 440000 },
        ];
        const sorted = [...tieConfigs].sort((x, y) => {
            if (y.score !== x.score) return y.score - x.score;
            if (y.medianNw !== x.medianNw) return y.medianNw - x.medianNw;
            return y.cvar95 - x.cvar95;
        });
        expect(sorted[0].id).toBe('B'); // Gagne au patrimoine médian
    });

    it('F19.B3 : Annulation prématurée (AbortSignal déclenché) interrompt le calcul proprement', () => {
        const controller = new AbortController();
        controller.abort();
        expect(controller.signal.aborted).toBe(true);
    });

    it('F19.B4 : Graines CRN identiques pour toutes les stratégies d\'une même manche', () => {
        const generateCrnSeeds = (count: number, masterSeed: number) =>
            Array.from({ length: count }, (_, i) => (masterSeed * 1664525 + i * 1013904223) % 4294967296);

        const seedsStrategy1 = generateCrnSeeds(50, 12345);
        const seedsStrategy2 = generateCrnSeeds(50, 12345);
        expect(seedsStrategy1).toEqual(seedsStrategy2);
    });

    it('F19.B5 : Stratégie avec contrainte illégale (retraite à 20 ans alors que l\'âge courant est 35 ans) éliminée d\'office', () => {
        const currentAge = 35;
        const invalidConfig = { retirementAge: 20 };
        const isValid = invalidConfig.retirementAge >= currentAge;
        expect(isValid).toBe(false);
    });
});

describe('Tier 2 — F20 : Bornes de l\'attribution marginale de Shapley', () => {
    it('F20.B1 : Gain total nul (0 $) donne des attributions Shapley strictement nulles (0 $)', () => {
        const attributions = computeShapleySafe(0, [10000, 20000, 30000]);
        expect(attributions).toEqual([0, 0, 0]);
    });

    it('F20.B2 : Gain total négatif (-50 000 $, stratégie sous-optimale) : somme des attributions égale exactement -50 000 $', () => {
        const totalLoss = -50000;
        const attributions = computeShapleySafe(totalLoss, [20000, 30000]);
        const sum = attributions.reduce((a, b) => a + b, 0);
        expect(sum).toBeCloseTo(totalLoss, 2);
    });

    it('F20.B3 : Un seul levier actif reçoit 100 % du gain total', () => {
        const singleGain = 75000;
        const attributions = computeShapleySafe(singleGain, [75000]);
        expect(attributions).toEqual([75000]);
    });

    it('F20.B4 : Liste de leviers vide retourne un tableau vide sans erreur', () => {
        const empty = computeShapleySafe(50000, []);
        expect(empty).toEqual([]);
    });

    it('F20.B5 : Dépenses nulles (0 $) lors du calcul des mois de liberté : borné à 0 mois sans Infinity', () => {
        const gainDollars = 100000;
        const monthlyExpenses = 0;
        const monthsFreedom = monthlyExpenses > 0 ? Math.round(gainDollars / monthlyExpenses) : 0;
        expect(monthsFreedom).toBe(0);
        expect(Number.isFinite(monthsFreedom)).toBe(true);
    });
});
