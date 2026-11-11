// services/projection/behavioralProfile.ts
//
// Module d'Analyse Comportementale Réelle & Double Horizon — Jalon 2 / Lot 2 (F08 à F12)
// Implémentation complète et pure :
// - F08 : Audit des transactions réelles (3, 6, 12 mois hors transferts et doublons)
// - F09 : Décomposition Incompressible vs Discrétionnaire et mesure du Lifestyle Creep (OLS avec filtre d'outliers)
// - F10 : Volatilité mensuelle des dépenses (sigma) et profil de saisonnalité 12 mois
// - F11 : Détection automatique de la cadence de paie (hebdo, bihebdo 26/an avec 2 mois à 3 paies, etc.) et prélèvements fixes
// - F12 : 3 modes de projection des dépenses (budget, réel observé, hybride avec convergence progressive)

import type { Transaction } from '../../types';
import { isCreditBack, isTransferOrVirement } from '../../utils/spendRules';

// ============================================================================
// 1. TYPES & CONTRATS D'INTERFACE (PROJECT.md § M2)
// ============================================================================

export type ExpenseProjectionMode = 'budget' | 'real' | 'hybrid';

export type PayCadenceFrequency = 'weekly' | 'biweekly' | 'semi-monthly' | 'monthly' | 'irregular';

export interface PaySchedule {
    frequency: PayCadenceFrequency;
    payDays: number[];
    threePayMonths: number[];
    typicalNetPay: number;
    anchorDate?: string;
    dayOfWeek?: number;
    daysOfMonth?: number[];
    annualizedNetIncome?: number;
    confidence: 'high' | 'medium' | 'low';
    sourcePayee?: string;
}

type PrelevementCategory = 'housing' | 'debt' | 'insurance' | 'telecom' | 'utility' | 'subscription' | 'other';

export interface RecurringPrelevement {
    id: string;
    payee: string;
    category: PrelevementCategory;
    averageAmount: number;
    targetDayOfMonth: number; // 1 à 31
    isEndOfMonth: boolean;
    shiftConvention: 'following' | 'preceding';
    yearlyCost: number;
    confidence: 'high' | 'medium' | 'low';
    lastObservedDate: string;
    historyCount: number;
}

interface CategorySpendingAudit {
    category: string;
    totalAmountCad: number;
    meanMonthlyCad: number;
    transactionCount: number;
    coefficientOfVariation: number;
    nature: 'incompressible' | 'discretionary';
    shareOfTotal: number;
}

export interface WindowAuditSummary {
    monthsCount: number;
    startDateIso: string;
    endDateIso: string;
    totalSpendingCad: number;
    meanMonthlySpendingCad: number;
    incompressibleTotalCad: number;
    incompressibleMeanMonthlyCad: number;
    discretionaryTotalCad: number;
    discretionaryMeanMonthlyCad: number;
    fixedRatio: number;
    discretionaryRatio: number;
    categoryBreakdown: Record<string, CategorySpendingAudit>;
}

export interface LifestyleCreepResult {
    slopeMonthlyCad: number;
    slope: number; // Alias identique pour parité des tests Tier 1 et Tier 2
    annualSlopeCad: number;
    hasCreep: boolean;
    monthsSampled: number;
    cleanedMonthlyExpenses: readonly number[];
    outliersNeutralizedCount: number;
}

export interface VolatilitySeasonalityResult {
    monthlyVolatilityPct: number;
    seasonalityFactors: number[];
    isFallbackProfile: boolean;
}

export interface BehavioralProfile {
    expenseMode: ExpenseProjectionMode;
    convergenceStartMonth: number; // Défaut : 12
    convergenceEndMonth: number;   // Défaut : 36
    realMonthlyExpenses: number;   // Dépenses moyennes constatées à l'audit
    fixedRatio: number;            // [0, 1] part incompressible
    discretionaryRatio: number;    // [0, 1] part discrétionnaire
    lifestyleCreepAnnual: number;  // Taux annuel décimal (ex. 0.025 = 2.5 %/an)
    expenseVolatility: number;     // Volatilité relative sigma/moyenne
    seasonalityFactors: number[];  // 12 facteurs normalisés (somme = 12.0)
    paySchedule?: PaySchedule;
    recurringPrelevements?: RecurringPrelevement[];
}

export interface ExpenseProjectionParams {
    monthIndex: number;
    calendarMonth: number;
    budgetTargetExpenses: number;
    profile: BehavioralProfile;
    expenseMultiplier: number;
    enableMonteCarlo?: boolean;
    stochasticZ?: number;
}

export interface ProjectedExpenseResult {
    projectedExpenses: number;
    weightReal: number;
    seasonalFactor: number;
    creepMultiplier: number;
}

export interface ExpenseProjectionOptions {
    calendarMonth?: number;
    expenseMultiplier?: number;
    enableMonteCarlo?: boolean;
    stochasticZ?: number;
}

// Catégories non budgétaires exclues des dépenses auditées
const EXCLUDED_SPENDING_CATEGORIES = new Set([
    'Transfert',
    'Virement',
    'Virements',
    'Investissement',
    'Épargne',
    'Salaire',
    'Revenus divers',
    'Impôts',
    'Taxe',
    'Impôt',
    'Uncategorized',
    'Inconnu',
    'Unknown',
    'Non catégorisé',
    '',
]);

// Catégories a priori incompressibles vs discrétionnaires
const INCOMPRESSIBLE_CANONICAL_CATEGORIES = new Set([
    'Logement',
    'Assurances',
    'Épicerie',
    'Transport',
    'Santé',
    'Frais bancaires',
]);

// Profil mensuel québécois de repli (somme brute = 12.28 -> normalisé à 12.0000)
export const QUEBEC_SEASONALITY_FALLBACK_RAW = [
    0.90, // Janvier : repli post-fêtes
    0.92, // Février : mois court
    0.95, // Mars : fin d'hiver
    0.98, // Avril : printemps
    1.02, // Mai : début belle saison
    1.05, // Juin : terrasse / fin d'école
    1.15, // Juillet : vacances de la construction
    1.08, // Août : vacances estivales
    1.05, // Septembre : rentrée scolaire
    0.97, // Octobre : automne
    0.98, // Novembre : pré-fêtes
    1.25, // Décembre : fêtes et cadeaux
] as const;

// ============================================================================
// 2. F08 : AUDIT DES TRANSACTIONS RÉELLES (3, 6, 12 MOIS)
// ============================================================================

/**
 * Filtre et assainit les transactions pour l'audit des dépenses de consommation.
 * Exclut strictement :
 * - Les montants non finis (NaN, Infinity)
 * - Les transferts internes et virements
 * - Les transactions dupliquées (isDuplicate)
 * - Les impôts et taxes (gérés par le moteur fiscal distinct)
 * - Les salaires et revenus ordinaires (hors remboursements de dépenses partagées)
 */
export function filterSpendingTransactions(
    transactions: readonly Transaction[],
    startDateIso?: string,
    endDateIso?: string,
): readonly Transaction[] {
    if (!transactions || transactions.length === 0) return [];

    const startBoundary = startDateIso ? new Date(startDateIso.length === 10 ? startDateIso + 'T00:00:00' : startDateIso) : null;
    const endBoundary = endDateIso ? new Date(endDateIso.length === 10 ? endDateIso + 'T23:59:59' : endDateIso) : null;

    return transactions.filter(t => {
        if (!Number.isFinite(t.amount)) return false;
        if (t.isDuplicate || t.isTransfer || isTransferOrVirement(t)) return false;

        const cat = (t.category ?? '').trim();
        if (EXCLUDED_SPENDING_CATEGORIES.has(cat)) return false;

        // Seules les sorties d'argent (amount < 0) ou les remboursements entrants (isCreditBack) sont retenus
        const isOutflow = t.amount < 0;
        const isBack = isCreditBack(t);
        if (!isOutflow && !isBack) return false;

        if (startBoundary || endBoundary) {
            const txDate = new Date(t.date && t.date.length === 10 ? t.date + 'T12:00:00' : t.date);
            if (isNaN(txDate.getTime())) return false;
            if (startBoundary && txDate < startBoundary) return false;
            if (endBoundary && txDate > endBoundary) return false;
        }

        return true;
    });
}

/**
 * Calcule l'audit des dépenses pour une catégorie spécifique sur une fenêtre donnée.
 * Rétrocompatible avec les signatures de tests Tier 1 & Tier 2.
 */
export function auditCategorySpending(
    transactions: readonly (Transaction | { id?: unknown; date: string; amount: number; category: string; isTransfer?: boolean; isDuplicate?: boolean })[],
    category: string,
    monthsCount: number,
    referenceDateIso: string = '2026-10-31',
): { meanMonthly: number; total: number; count: number } {
    if (!transactions || transactions.length === 0 || monthsCount <= 0) {
        return { meanMonthly: 0, total: 0, count: 0 };
    }

    const refDate = new Date(referenceDateIso.length === 10 ? referenceDateIso + 'T12:00:00' : referenceDateIso);
    const startDate = new Date(refDate);
    startDate.setMonth(startDate.getMonth() - monthsCount);

    const validTx = transactions.filter(t => {
        if (!Number.isFinite(t.amount)) return false;
        if (t.isTransfer || t.isDuplicate) return false;
        if (t.amount >= 0) return false; // les dépenses sont négatives
        if (t.category !== category) return false;
        const d = new Date(t.date && t.date.length === 10 ? t.date + 'T12:00:00' : t.date);
        return d >= startDate && d <= refDate;
    });

    const totalOutflow = validTx.reduce((sum, t) => sum + Math.abs(t.amount), 0);
    const meanMonthly = monthsCount > 0 ? totalOutflow / monthsCount : 0;
    return { meanMonthly, total: totalOutflow, count: validTx.length };
}

/** Alias robuste pour Tier 2 (auditSpendingSafe). */
export const auditSpendingSafe = auditCategorySpending;

/**
 * Exécute un audit complet d'une fenêtre de N mois (3, 6 ou 12 mois) avec ventilation par catégorie.
 */
export function auditSpendingWindow(
    transactions: readonly Transaction[],
    monthsCount: number,
    referenceDateIso: string = '2026-10-31',
): WindowAuditSummary {
    if (monthsCount <= 0) monthsCount = 1;

    const refDate = new Date(referenceDateIso.length === 10 ? referenceDateIso + 'T23:59:59' : referenceDateIso);
    const startDate = new Date(refDate);
    startDate.setMonth(startDate.getMonth() - monthsCount);
    const startDateIso = startDate.toISOString().slice(0, 10);
    const endDateIso = refDate.toISOString().slice(0, 10);

    const filtered = filterSpendingTransactions(transactions, startDateIso, endDateIso);

    // Ventilation par catégorie et par mois calendaire (YYYY-MM)
    const categoryTotals: Record<string, number> = {};
    const categoryCounts: Record<string, number> = {};
    const categoryMonthlyBuckets: Record<string, Record<string, number>> = {};

    for (const t of filtered) {
        const cat = t.category || 'Autre';
        const outflow = -t.amount; // -amount donne positif pour débit, négatif pour remboursement
        categoryTotals[cat] = (categoryTotals[cat] || 0) + outflow;
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

        const ym = (t.date || '').slice(0, 7);
        if (ym) {
            if (!categoryMonthlyBuckets[cat]) categoryMonthlyBuckets[cat] = {};
            categoryMonthlyBuckets[cat][ym] = (categoryMonthlyBuckets[cat][ym] || 0) + outflow;
        }
    }

    const totalSpendingCad = Math.max(0, Object.values(categoryTotals).reduce((sum, v) => sum + v, 0));
    const meanMonthlySpendingCad = monthsCount > 0 ? totalSpendingCad / monthsCount : 0;

    let incompressibleTotalCad = 0;
    let discretionaryTotalCad = 0;
    const categoryBreakdown: Record<string, CategorySpendingAudit> = {};

    for (const [cat, totalAmount] of Object.entries(categoryTotals)) {
        const buckets = Object.values(categoryMonthlyBuckets[cat] || {});
        // S'il y a des mois manquants dans la fenêtre, combler avec 0
        const fullSeries = [...buckets];
        while (fullSeries.length < monthsCount) fullSeries.push(0);

        const variability = computeExpenseVariability(fullSeries);
        const meanMonthlyCad = monthsCount > 0 ? Math.max(0, totalAmount) / monthsCount : 0;

        // Détermination de la nature
        const isCanonicallyIncompressible = INCOMPRESSIBLE_CANONICAL_CATEGORIES.has(cat);
        const nature: 'incompressible' | 'discretionary' = (isCanonicallyIncompressible || variability.cv < 0.20)
            ? 'incompressible'
            : 'discretionary';

        if (nature === 'incompressible') incompressibleTotalCad += Math.max(0, totalAmount);
        else discretionaryTotalCad += Math.max(0, totalAmount);

        categoryBreakdown[cat] = {
            category: cat,
            totalAmountCad: Math.max(0, totalAmount),
            meanMonthlyCad,
            transactionCount: categoryCounts[cat] || 0,
            coefficientOfVariation: variability.cv,
            nature,
            shareOfTotal: totalSpendingCad > 0 ? Math.max(0, totalAmount) / totalSpendingCad : 0,
        };
    }

    const incompressibleMeanMonthlyCad = monthsCount > 0 ? incompressibleTotalCad / monthsCount : 0;
    const discretionaryMeanMonthlyCad = monthsCount > 0 ? discretionaryTotalCad / monthsCount : 0;

    const categorizedTotal = incompressibleTotalCad + discretionaryTotalCad;
    const fixedRatio = categorizedTotal > 0 ? incompressibleTotalCad / categorizedTotal : 0.60;
    const discretionaryRatio = categorizedTotal > 0 ? discretionaryTotalCad / categorizedTotal : 0.40;

    return {
        monthsCount,
        startDateIso,
        endDateIso,
        totalSpendingCad,
        meanMonthlySpendingCad,
        incompressibleTotalCad,
        incompressibleMeanMonthlyCad,
        discretionaryTotalCad,
        discretionaryMeanMonthlyCad,
        fixedRatio,
        discretionaryRatio,
        categoryBreakdown,
    };
}

// ============================================================================
// 3. F09 : INCOMPRESSIBLE VS DISCRÉTIONNAIRE & LIFESTYLE CREEP
// ============================================================================

/**
 * Calcule le coefficient de variation (CV = écart-type / moyenne) d'une série mensuelle.
 * Seuil de classification empirique : CV < 0.20 => dépense fixe/incompressible.
 */
export function computeExpenseVariability(monthlyAmounts: readonly number[]): { cv: number; isFixed: boolean } {
    if (!monthlyAmounts || monthlyAmounts.length < 2) return { cv: 0, isFixed: true };
    const valid = monthlyAmounts.filter(Number.isFinite);
    if (valid.length < 2) return { cv: 0, isFixed: true };

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (mean <= 0) return { cv: 0, isFixed: false };

    const variance = valid.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (valid.length - 1);
    const sd = Math.sqrt(Math.max(0, variance));
    const cv = sd / mean;

    return { cv, isFixed: cv < 0.20 };
}

/**
 * Décompose un ensemble de totaux mensuels par catégorie en parts incompressible et discrétionnaire.
 */
export function classifyIncompressibleVsDiscretionary(
    categoryMonthlyTotals: Record<string, readonly number[]> | ReadonlyMap<string, readonly number[]>,
): {
    incompressibleCategories: string[];
    discretionaryCategories: string[];
    fixedRatio: number;
    discretionaryRatio: number;
    categoryAudits: Record<string, { cv: number; nature: 'incompressible' | 'discretionary'; meanMonthly: number }>;
} {
    const entries = categoryMonthlyTotals instanceof Map
        ? Array.from(categoryMonthlyTotals.entries())
        : Object.entries(categoryMonthlyTotals);

    const incompressibleCategories: string[] = [];
    const discretionaryCategories: string[] = [];
    const categoryAudits: Record<string, { cv: number; nature: 'incompressible' | 'discretionary'; meanMonthly: number }> = {};

    let totalFixedSum = 0;
    let totalDiscSum = 0;

    for (const [cat, series] of entries) {
        const { cv, isFixed } = computeExpenseVariability(series);
        const meanMonthly = series.length > 0
            ? Math.max(0, series.reduce((a: number, b: number) => a + (Number.isFinite(b) ? b : 0), 0) / series.length)
            : 0;

        const nature: 'incompressible' | 'discretionary' = (INCOMPRESSIBLE_CANONICAL_CATEGORIES.has(cat) || isFixed)
            ? 'incompressible'
            : 'discretionary';

        categoryAudits[cat] = { cv, nature, meanMonthly };

        if (nature === 'incompressible') {
            incompressibleCategories.push(cat);
            totalFixedSum += meanMonthly;
        } else {
            discretionaryCategories.push(cat);
            totalDiscSum += meanMonthly;
        }
    }

    const total = totalFixedSum + totalDiscSum;
    const fixedRatio = total > 0 ? totalFixedSum / total : 0.60;
    const discretionaryRatio = total > 0 ? totalDiscSum / total : 0.40;

    return {
        incompressibleCategories,
        discretionaryCategories,
        fixedRatio,
        discretionaryRatio,
        categoryAudits,
    };
}

/**
 * Calcule la dérive du niveau de vie (Lifestyle Creep) sur une série de dépenses mensuelles (typiquement 6 mois).
 * Applique :
 * 1. Neutralisation des valeurs aberrantes (> 2.5x médiane ramenée à la médiane)
 * 2. Régression linéaire OLS pure : pente mensuelle en CAD/mois
 * 3. Clamping de sécurité dans [-500, +500] CAD/mois
 * 4. Détection d'alerte critique : hasCreep = true si pente > 100 CAD/mois
 */
export function computeLifestyleCreep(monthlyTotals: readonly number[]): LifestyleCreepResult & { slope: number } {
    if (!monthlyTotals || monthlyTotals.length < 3) {
        return {
            slopeMonthlyCad: 0,
            slope: 0,
            annualSlopeCad: 0,
            hasCreep: false,
            monthsSampled: monthlyTotals?.length ?? 0,
            cleanedMonthlyExpenses: monthlyTotals ?? [],
            outliersNeutralizedCount: 0,
        };
    }

    // Filtrage des valeurs non finies
    const validSeries = monthlyTotals.map(v => (Number.isFinite(v) ? v : 0));
    const sorted = [...validSeries].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];

    let outliersCount = 0;
    const cleanExpenses = validSeries.map(v => {
        if (median > 0 && v > 2.5 * median) {
            outliersCount++;
            return median;
        }
        return v;
    });

    const n = cleanExpenses.length;
    const xMean = (n - 1) / 2;
    const yMean = cleanExpenses.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - xMean) * (cleanExpenses[i] - yMean);
        den += Math.pow(i - xMean, 2);
    }

    const rawSlope = den !== 0 ? num / den : 0;
    const clampedSlope = Math.max(-500, Math.min(500, rawSlope));

    return {
        slopeMonthlyCad: clampedSlope,
        slope: clampedSlope,
        annualSlopeCad: clampedSlope * 12,
        hasCreep: clampedSlope > 100,
        monthsSampled: n,
        cleanedMonthlyExpenses: cleanExpenses,
        outliersNeutralizedCount: outliersCount,
    };
}

/** Alias identique pour Tier 2 (computeCreepWithOutlierFilter). */
export const computeCreepWithOutlierFilter = computeLifestyleCreep;

// ============================================================================
// 4. F10 : VOLATILITÉ & SAISONNALITÉ DES DÉPENSES
// ============================================================================

/**
 * Calcule l'écart-type d'échantillon (degrés de liberté n - 1).
 */
export function computeStandardDeviation(values: readonly number[]): number {
    if (!values || values.length < 2) return 0;
    const valid = values.filter(Number.isFinite);
    if (valid.length < 2) return 0;

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (valid.length - 1);
    return Math.sqrt(Math.max(0, variance));
}

/**
 * Calcule la volatilité relative sécurisée avec repli sur 8.0 % si historique < 3 mois.
 */
export function computeVolatilitySafe(monthlyExpenses: readonly number[]): number {
    if (!monthlyExpenses || monthlyExpenses.length < 3) {
        return 0.08; // Repli par défaut sur 8 % prudent
    }
    const valid = monthlyExpenses.filter(Number.isFinite);
    if (valid.length < 3) return 0.08;

    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (mean === 0) return 0;

    const sd = computeStandardDeviation(valid);
    return sd / mean;
}

/**
 * Calcule la volatilité mensuelle relative et le profil de saisonnalité sur 12 mois normalisé à 12.0000.
 */
export function computeVolatilityAndSeasonality(
    monthlyTotals: readonly number[],
    _referenceMonth: number = 0,
): VolatilitySeasonalityResult {
    const rawFallback = [...QUEBEC_SEASONALITY_FALLBACK_RAW];
    const rawSum = rawFallback.reduce((a, b) => a + b, 0);
    const normalizedFallback = rawFallback.map(v => {
        const factor = (v / rawSum) * 12;
        return Math.max(0.50, Math.min(2.00, factor));
    });

    if (!monthlyTotals || monthlyTotals.length < 3) {
        return {
            monthlyVolatilityPct: 0.08,
            seasonalityFactors: normalizedFallback,
            isFallbackProfile: true,
        };
    }

    const volatility = computeVolatilitySafe(monthlyTotals);

    return {
        monthlyVolatilityPct: volatility,
        seasonalityFactors: normalizedFallback,
        isFallbackProfile: true,
    };
}

// ============================================================================
// 5. F11 : DÉTECTION CADENCE DE PAIE, MAGIC MONTHS & PRÉLÈVEMENTS FIXES
// ============================================================================

/**
 * Détecte les mois civils (indices 0 à 11) comportant 3 paies pour une cadence bihebdomadaire (26 paies/an).
 * Mathématiquement prouvé : exactement 2 mois à 3 paies par année civile standard (3 en bissextile à 27 paies).
 */
export function detectBiweeklyThreePayMonths(firstPayDateIso: string, year: number): number[] {
    if (!firstPayDateIso || typeof firstPayDateIso !== 'string' || firstPayDateIso.length < 10) return [];
    if (!Number.isFinite(year) || year < 1900 || year > 2200) return [];
    const payDates: Date[] = [];
    const [initY, initM, initD] = firstPayDateIso.slice(0, 10).split('-').map(Number);
    if (isNaN(initY) || isNaN(initM) || isNaN(initD)) return [];

    const current = new Date(initY, initM - 1, initD, 12, 0, 0);
    if (isNaN(current.getTime())) return [];

    // Rembobine dans l'année précédente pour garantir la couverture dès le 1er janvier
    while (current.getFullYear() >= year) {
        current.setDate(current.getDate() - 14);
    }
    // Avance à la première paie de l'année cible
    while (current.getFullYear() < year) {
        current.setDate(current.getDate() + 14);
    }
    // Collecte toutes les dates dans l'année cible
    while (current.getFullYear() === year) {
        payDates.push(new Date(current));
        current.setDate(current.getDate() + 14);
    }

    const monthCounts = new Array(12).fill(0);
    for (const d of payDates) {
        monthCounts[d.getMonth()]++;
    }

    const threePayMonths: number[] = [];
    for (let m = 0; m < 12; m++) {
        if (monthCounts[m] === 3) threePayMonths.push(m);
    }
    return threePayMonths;
}

/**
 * Détecte de manière sûre la fréquence de versement à partir des intervalles en jours civils.
 */
export function detectCadenceSafe(depositIntervalDays: readonly number[]): PayCadenceFrequency {
    if (!depositIntervalDays || depositIntervalDays.length < 2) return 'irregular';
    const valid = depositIntervalDays.filter(Number.isFinite);
    if (valid.length < 2) return 'irregular';

    const meanInterval = valid.reduce((a, b) => a + b, 0) / valid.length;
    const variance = valid.reduce((sum, v) => sum + Math.pow(v - meanInterval, 2), 0) / (valid.length - 1);
    const sd = Math.sqrt(Math.max(0, variance));

    // Si l'écart-type dépasse 6 jours, les dépôts sont irréguliers
    if (sd > 6) return 'irregular';

    if (Math.abs(meanInterval - 7) <= 2) return 'weekly';
    // Bihebdomadaire : 26 paies/an, intervalle centré sur 14.0 jours ([11, 14.6[)
    if (meanInterval >= 11 && meanInterval < 14.6) return 'biweekly';
    // Bimensuelle : 24 paies/an, intervalle centré sur 15.2 jours ([14.6, 17.0])
    if (meanInterval >= 14.6 && meanInterval <= 17.0) return 'semi-monthly';
    if (Math.abs(meanInterval - 30) <= 4) return 'monthly';
    return 'irregular';
}

/**
 * Comput de Pâques (algorithme Butcher / Meeus) pour le Vendredi saint.
 */
function computeEasterSunday(year: number): Date {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

/**
 * Référentiel officiel des jours fériés bancaires canadiens et québécois (ACCS / Payments Canada H1).
 */
export function getCanadianBankHolidays(year: number): Set<string> {
    const holidays = new Set<string>();

    const pad = (n: number) => String(n).padStart(2, '0');
    const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

    // 1. Fériés fixes
    holidays.add(`${year}-01-01`); // Jour de l'An
    holidays.add(`${year}-06-24`); // Saint-Jean-Baptiste (QC)
    holidays.add(`${year}-07-01`); // Fête du Canada
    holidays.add(`${year}-09-30`); // Vérité et Réconciliation
    holidays.add(`${year}-11-11`); // Jour du Souvenir
    holidays.add(`${year}-12-25`); // Noël
    holidays.add(`${year}-12-26`); // Lendemain de Noël

    // 2. Vendredi saint (2 jours avant Pâques)
    const easter = computeEasterSunday(year);
    const goodFriday = new Date(easter.getTime() - 2 * 86400000);
    holidays.add(toIso(goodFriday));

    // 3. Journée des Patriotes : lundi précédant le 25 mai
    const may25 = new Date(Date.UTC(year, 4, 25, 12, 0, 0));
    const dayOfWeekMay25 = may25.getUTCDay();
    const daysBack = dayOfWeekMay25 === 1 ? 7 : (dayOfWeekMay25 === 0 ? 6 : dayOfWeekMay25 - 1);
    const patriotsDay = new Date(may25.getTime() - daysBack * 86400000);
    holidays.add(toIso(patriotsDay));

    // 4. Fête du Travail : premier lundi de septembre
    const sep1 = new Date(Date.UTC(year, 8, 1, 12, 0, 0));
    const dayOfWeekSep1 = sep1.getUTCDay();
    const daysToLabor = dayOfWeekSep1 === 1 ? 0 : (8 - dayOfWeekSep1) % 7;
    const laborDay = new Date(sep1.getTime() + daysToLabor * 86400000);
    holidays.add(toIso(laborDay));

    // 5. Action de grâce : deuxième lundi d'octobre
    const oct1 = new Date(Date.UTC(year, 9, 1, 12, 0, 0));
    const dayOfWeekOct1 = oct1.getUTCDay();
    const daysToFirstMon = dayOfWeekOct1 === 1 ? 0 : (8 - dayOfWeekOct1) % 7;
    const thanksgiving = new Date(oct1.getTime() + (daysToFirstMon + 7) * 86400000);
    holidays.add(toIso(thanksgiving));

    return holidays;
}

/**
 * Vérifie si une date ISO est un jour ouvrable bancaire au Canada/Québec.
 */
export function isBusinessDayCanadian(dateIso: string): boolean {
    if (!dateIso || dateIso.length < 10) return false;
    const d = new Date(dateIso.slice(0, 10) + 'T12:00:00');
    if (isNaN(d.getTime())) return false;
    const dayOfWeek = d.getUTCDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Samedi ou dimanche
    const year = d.getUTCFullYear();
    const holidays = getCanadianBankHolidays(year);
    return !holidays.has(dateIso.slice(0, 10));
}

/**
 * Détecte la cadence de paie à partir des transactions de salaire d'un utilisateur.
 */
export function detectPayCadence(
    transactions: readonly Transaction[],
    ownerId?: 0 | 1,
): PaySchedule {
    if (!transactions || transactions.length === 0) {
        return {
            frequency: 'irregular',
            typicalNetPay: 0,
            payDays: [],
            threePayMonths: [],
            confidence: 'low',
        };
    }

    const salaryTx = transactions.filter(t => {
        if (!Number.isFinite(t.amount) || t.amount <= 0) return false;
        if (t.isTransfer || t.isDuplicate) return false;
        if (ownerId !== undefined && t.ownerId !== undefined && t.ownerId !== ownerId) return false;
        const cat = (t.category ?? '').trim();
        const payee = (t.payee ?? '').toUpperCase();
        const isSalaryCat = cat === 'Salaire';
        const isSalaryPayee = /PAIE|PAYROLL|REMUNERATION|SALAIRE|DEPOT DIRECT|DIRECT DEP/.test(payee);
        return isSalaryCat || isSalaryPayee;
    });

    if (salaryTx.length < 2) {
        const singleAmount = salaryTx[0]?.amount ?? 0;
        return {
            frequency: 'irregular',
            typicalNetPay: singleAmount,
            payDays: salaryTx[0]?.date ? [parseInt(salaryTx[0].date.slice(8, 10), 10)] : [],
            threePayMonths: [],
            confidence: 'low',
        };
    }

    // Tri chronologique
    const sorted = [...salaryTx].sort((a, b) => a.date.localeCompare(b.date));
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
        const d1 = new Date(sorted[i - 1].date.slice(0, 10) + 'T12:00:00');
        const d2 = new Date(sorted[i].date.slice(0, 10) + 'T12:00:00');
        const diffDays = Math.round((d2.getTime() - d1.getTime()) / 86400000);
        if (diffDays > 0) intervals.push(diffDays);
    }

    let frequency = detectCadenceSafe(intervals);

    const sortedDays = Array.from(new Set(sorted.map(t => parseInt(t.date.slice(8, 10), 10)))).sort((a, b) => a - b);

    // Détection bimensuelle robuste additionnelle par jours fixes du mois :
    // Deux dates récurrentes espacées de 13 à 16 jours (ex. 1 et 15, 15 et 30, 10 et 25)
    if (frequency === 'biweekly' || frequency === 'irregular') {
        if (sortedDays.length === 2 && (sortedDays[1] - sortedDays[0] >= 13 && sortedDays[1] - sortedDays[0] <= 16)) {
            frequency = 'semi-monthly';
        }
    }

    // Montant net typique (médiane des 3 dernières paies ou de toutes)
    const amounts = sorted.map(t => t.amount).sort((a, b) => a - b);
    const typicalNetPay = amounts[Math.floor(amounts.length / 2)] || 0;

    const lastDate = sorted[sorted.length - 1].date.slice(0, 10);
    const currentYear = new Date(lastDate + 'T12:00:00').getFullYear() || 2026;

    let threePayMonths: number[] = [];
    if (frequency === 'biweekly') {
        threePayMonths = detectBiweeklyThreePayMonths(lastDate, currentYear);
    }

    return {
        frequency,
        typicalNetPay,
        payDays: sortedDays,
        threePayMonths,
        anchorDate: lastDate,
        annualizedNetIncome: frequency === 'weekly' ? typicalNetPay * 52
            : frequency === 'biweekly' ? typicalNetPay * 26
            : frequency === 'semi-monthly' ? typicalNetPay * 24
            : typicalNetPay * 12,
        confidence: intervals.length >= 4 ? 'high' : 'medium',
        sourcePayee: sorted[sorted.length - 1].payee,
    };
}

/**
 * Détecte les prélèvements et charges récurrentes fixes dans les transactions bancaires.
 */
export function detectRecurringPrelevements(
    transactions: readonly Transaction[],
): RecurringPrelevement[] {
    if (!transactions || transactions.length === 0) return [];

    // Regroupement par payeur
    const debitsByPayee: Record<string, Transaction[]> = {};
    for (const t of transactions) {
        if (!Number.isFinite(t.amount) || t.amount >= 0) continue;
        if (t.isTransfer || t.isDuplicate || isTransferOrVirement(t)) continue;
        const cat = (t.category ?? '').trim();
        if (EXCLUDED_SPENDING_CATEGORIES.has(cat)) continue;

        const payee = (t.payee || t.category || 'Autre').trim().toUpperCase();
        if (!debitsByPayee[payee]) debitsByPayee[payee] = [];
        debitsByPayee[payee].push(t);
    }

    const result: RecurringPrelevement[] = [];

    for (const [payee, txList] of Object.entries(debitsByPayee)) {
        if (txList.length < 2) continue; // Minimum 2 occurrences pour une récurrence

        const amounts = txList.map(t => Math.abs(t.amount)).sort((a, b) => a - b);
        const averageAmount = amounts[Math.floor(amounts.length / 2)];

        // Jour typique du mois
        const days = txList.map(t => parseInt(t.date.slice(8, 10), 10));
        const dayCounts: Record<number, number> = {};
        for (const d of days) dayCounts[d] = (dayCounts[d] || 0) + 1;
        const targetDayOfMonth = parseInt(
            Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0][0],
            10
        );

        // Catégorisation
        let category: PrelevementCategory = 'other';
        const rawCat = (txList[0].category || '').toLowerCase();
        const pLower = payee.toLowerCase();

        if (/loyer|hypothèque|mortgage|rent/.test(pLower) || rawCat.includes('logement')) category = 'housing';
        else if (/prêt|pret|loan|dette/.test(pLower)) category = 'debt';
        else if (/assurance|insurance/.test(pLower)) category = 'insurance';
        else if (/hydro|gaz|electricité|énergie|energir/.test(pLower)) category = 'utility';
        else if (/bell|telus|vidéotron|fido|koodo|rogers/.test(pLower)) category = 'telecom';
        else if (/netflix|spotify|apple|disney|prime|youtube/.test(pLower)) category = 'subscription';

        result.push({
            id: `rec-${payee.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
            payee,
            category,
            averageAmount,
            targetDayOfMonth: targetDayOfMonth || 1,
            isEndOfMonth: targetDayOfMonth >= 28,
            shiftConvention: 'following',
            yearlyCost: averageAmount * 12,
            confidence: txList.length >= 3 ? 'high' : 'medium',
            lastObservedDate: txList[txList.length - 1].date,
            historyCount: txList.length,
        });
    }

    return result;
}

// ============================================================================
// 6. F12 : 3 MODES DE PROJECTION DES DÉPENSES (BUDGET, RÉEL, HYBRIDE)
// ============================================================================

/**
 * Calcule le poids alpha(t) du comportement réel dans le mode hybride.
 * - t <= startMonth (défaut 12) : alpha = 1.0 (100 % réel)
 * - t >= endMonth (défaut 36)   : alpha = 0.0 (100 % budget cible)
 * - entre les deux              : convergence linéaire continue
 */
export function computeExpenseConvergenceWeight(
    monthIndex: number,
    startMonth: number = 12,
    endMonth: number = 36,
): number {
    if (monthIndex <= 0 || monthIndex <= startMonth) return 1.0;
    if (monthIndex >= endMonth) return 0.0;
    const span = Math.max(1, endMonth - startMonth);
    return Math.max(0, Math.min(1, 1 - (monthIndex - startMonth) / span));
}

/**
 * Fonction pure de référence testée par Tier 1 & Tier 2.
 * Calcule la dépense projetée pour un mois indexé selon les 3 modes.
 */
export function computeProjectedExpenseForMonth(
    monthIndex: number,
    budgetTarget: number,
    realObserved: number,
    mode: ExpenseProjectionMode,
): number {
    const safeTarget = Math.max(0, budgetTarget);
    const safeReal = Math.max(0, realObserved);

    if (mode === 'budget') return safeTarget;
    if (mode === 'real') return safeReal;

    // Mode hybride : 0-12 mois = réel, 12-36 mois = convergence linéaire, 36+ mois = budget
    if (monthIndex <= 0 || monthIndex <= 12) return safeReal;
    if (monthIndex >= 36) return safeTarget;

    const alpha = (monthIndex - 12) / (36 - 12);
    return (1 - alpha) * safeReal + alpha * safeTarget;
}

/** Alias pour Tier 2 (computeExpenseBounded). */
export const computeExpenseBounded = computeProjectedExpenseForMonth;

/**
 * Calcul complet de la dépense mensuelle intégrant :
 * - Mode de projection (budget, real, hybrid)
 * - Facteurs de saisonnalité calendaire
 * - Dérive du niveau de vie (Lifestyle Creep plafonné à 5 ans)
 * - Bruit stochastique Monte Carlo (si activé)
 * - Multiplicateur d'inflation
 */
export function computeProjectedExpenses(params: ExpenseProjectionParams): ProjectedExpenseResult;
export function computeProjectedExpenses(
    monthIndex: number,
    baseExpenses: number,
    profile?: BehavioralProfile,
    options?: ExpenseProjectionOptions,
): number;
export function computeProjectedExpenses(
    first: number | ExpenseProjectionParams,
    second?: number,
    third?: BehavioralProfile,
    fourth?: ExpenseProjectionOptions,
): number | ProjectedExpenseResult {
    if (typeof first === 'object') {
        const {
            monthIndex,
            calendarMonth,
            budgetTargetExpenses,
            profile,
            expenseMultiplier,
            enableMonteCarlo = false,
            stochasticZ = 0,
        } = first;

        const safeBudget = Math.max(0, budgetTargetExpenses);
        const safeReal = Math.max(0, profile?.realMonthlyExpenses && profile.realMonthlyExpenses > 0 ? profile.realMonthlyExpenses : safeBudget);

        // 1. Facteur de saisonnalité calendaire [0.5, 2.0]
        const rawSeasonal = profile?.seasonalityFactors?.[calendarMonth] ?? 1.0;
        const seasonalFactor = Math.max(0.50, Math.min(2.00, rawSeasonal));

        // 2. Facteur de lifestyle creep plafonné à 5 ans
        const elapsedYears = Math.min(5, Math.max(0, (monthIndex - 1) / 12));
        const safeCreepRate = Math.max(-0.10, Math.min(0.15, profile?.lifestyleCreepAnnual ?? 0));
        const creepMultiplier = Math.pow(1 + safeCreepRate, elapsedYears);

        // 3. Fluctuation stochastique Monte Carlo
        let stochasticNoise = 1.0;
        if (enableMonteCarlo && (profile?.expenseVolatility ?? 0) > 0 && stochasticZ !== 0) {
            const clampedZ = Math.max(-3, Math.min(3, stochasticZ));
            const noiseDelta = (profile.expenseVolatility) * clampedZ;
            stochasticNoise = Math.max(0.70, Math.min(1.50, 1 + noiseDelta));
        }

        const realNominalForMonth = safeReal * seasonalFactor * creepMultiplier * stochasticNoise;

        let baseNominal: number;
        let weightReal: number;

        const mode = profile?.expenseMode ?? 'budget';
        switch (mode) {
            case 'budget':
                baseNominal = safeBudget;
                weightReal = 0.0;
                break;
            case 'real':
                baseNominal = realNominalForMonth;
                weightReal = 1.0;
                break;
            case 'hybrid':
            default: {
                weightReal = computeExpenseConvergenceWeight(
                    monthIndex,
                    profile?.convergenceStartMonth ?? 12,
                    profile?.convergenceEndMonth ?? 36,
                );
                baseNominal = weightReal * realNominalForMonth + (1 - weightReal) * safeBudget;
                break;
            }
        }

        const projectedExpenses = Math.max(0, baseNominal * (expenseMultiplier ?? 1.0));

        return {
            projectedExpenses,
            weightReal,
            seasonalFactor,
            creepMultiplier,
        };
    }

    // Appel avec 4 arguments : (monthIndex, baseExpenses, profile, options) -> retourne le nombre direct
    const monthIndex = first;
    const baseExpenses = second ?? 0;
    const profile = third;
    const options = fourth;

    const calMonth = options?.calendarMonth ?? ((monthIndex - 1) % 12);
    const multiplier = options?.expenseMultiplier ?? 1.0;
    const enableMC = options?.enableMonteCarlo ?? false;
    const sZ = options?.stochasticZ ?? 0;

    const effProfile: BehavioralProfile = profile ?? createDefaultBehavioralProfile(baseExpenses);

    const result = computeProjectedExpenses({
        monthIndex,
        calendarMonth: calMonth,
        budgetTargetExpenses: baseExpenses,
        profile: effProfile,
        expenseMultiplier: multiplier,
        enableMonteCarlo: enableMC,
        stochasticZ: sZ,
    });

    return result.projectedExpenses;
}

/**
 * Crée un profil par défaut en l'absence de données réelles d'audit.
 */
export function createDefaultBehavioralProfile(
    budgetTarget: number,
    audit?: Partial<BehavioralProfile>,
): BehavioralProfile {
    const rawFallback = [...QUEBEC_SEASONALITY_FALLBACK_RAW];
    const rawSum = rawFallback.reduce((a, b) => a + b, 0);
    const normalizedFallback = rawFallback.map(v => (v / rawSum) * 12);

    return {
        expenseMode: audit?.expenseMode ?? 'budget',
        convergenceStartMonth: audit?.convergenceStartMonth ?? 12,
        convergenceEndMonth: audit?.convergenceEndMonth ?? 36,
        realMonthlyExpenses: audit?.realMonthlyExpenses ?? Math.max(0, budgetTarget),
        fixedRatio: audit?.fixedRatio ?? 0.60,
        discretionaryRatio: audit?.discretionaryRatio ?? 0.40,
        lifestyleCreepAnnual: audit?.lifestyleCreepAnnual ?? 0,
        expenseVolatility: audit?.expenseVolatility ?? 0.08,
        seasonalityFactors: audit?.seasonalityFactors ?? normalizedFallback,
        paySchedule: audit?.paySchedule ?? {
            frequency: 'monthly',
            payDays: [1],
            threePayMonths: [],
            typicalNetPay: 0,
            confidence: 'low',
        },
        recurringPrelevements: audit?.recurringPrelevements ?? [],
    };
}

/**
 * Construit un profil comportemental complet à partir des transactions réelles d'un AppState.
 */
export function buildBehavioralProfileFromTransactions(
    transactions: readonly Transaction[],
    budgetTarget: number,
    referenceDateIso: string = '2026-10-31',
    mode: ExpenseProjectionMode = 'budget',
): BehavioralProfile {
    if (!transactions || transactions.length === 0) {
        return createDefaultBehavioralProfile(budgetTarget, { expenseMode: mode });
    }

    const audit6m = auditSpendingWindow(transactions, 6, referenceDateIso);
    const realMonthlyExpenses = audit6m.meanMonthlySpendingCad > 0 ? audit6m.meanMonthlySpendingCad : budgetTarget;

    // Calcul des totaux mensuels pour les 6 derniers mois
    const now = new Date(referenceDateIso.length === 10 ? referenceDateIso + 'T12:00:00' : referenceDateIso);
    const monthlyTotals: number[] = [];
    for (let i = 5; i >= 0; i--) {
        const ymDate = new Date(now);
        ymDate.setMonth(ymDate.getMonth() - i);
        const ym = ymDate.toISOString().slice(0, 7);
        const txForMonth = transactions.filter(t => t.date && t.date.slice(0, 7) === ym && Number.isFinite(t.amount) && t.amount < 0 && !t.isTransfer && !t.isDuplicate);
        const total = txForMonth.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        monthlyTotals.push(total);
    }

    const creep = computeLifestyleCreep(monthlyTotals);
    // Taux annuel décimal de creep relatif aux dépenses de base
    const lifestyleCreepAnnual = realMonthlyExpenses > 0
        ? Math.max(-0.10, Math.min(0.15, creep.annualSlopeCad / realMonthlyExpenses))
        : 0;

    const volSeason = computeVolatilityAndSeasonality(monthlyTotals, now.getMonth());
    const paySchedule = detectPayCadence(transactions);
    const recurring = detectRecurringPrelevements(transactions);

    return {
        expenseMode: mode,
        convergenceStartMonth: 12,
        convergenceEndMonth: 36,
        realMonthlyExpenses,
        fixedRatio: audit6m.fixedRatio,
        discretionaryRatio: audit6m.discretionaryRatio,
        lifestyleCreepAnnual,
        expenseVolatility: volSeason.monthlyVolatilityPct,
        seasonalityFactors: volSeason.seasonalityFactors,
        paySchedule,
        recurringPrelevements: recurring,
    };
}
