// services/projection/deepForecastTypes.ts
// Contrats TypeScript stricts pour Futur 4.0 : 4 scénarios uniques, audit du passé réel,
// signaux d'actualités & fondamentaux, simulation profonde (100 000+ trajectoires) et
// mémoire persistante chiffrée IndexedDB.
// Règle no-fake-data : toute mesure absente ou non calculable vaut `null`, jamais `0`.

import type { PastCurveCalibration } from './pastCurveCalibration';

export type DeepScenarioId =
    | 'real_trajectory'
    | 'prudent_stress'
    | 'ai_optimized'
    | 'favorable_tailwinds';

export const DEEP_SCENARIO_IDS: readonly DeepScenarioId[] = [
    'real_trajectory',
    'prudent_stress',
    'ai_optimized',
    'favorable_tailwinds',
] as const;

export type DeepForecastPhase =
    | 'past_audit'
    | 'news_and_fundamentals'
    | 'monte_carlo_100k'
    | 'ai_optimization'
    | 'done';

export interface DeepForecastProgress {
    phase: DeepForecastPhase;
    /** Indice de phase humain (1 à 4). */
    phaseIndex: number;
    phaseTotal: number;
    phaseLabel: string;
    percent: number;
    trajectoriesDone: number;
    trajectoriesTotal: number;
    etaSeconds: number | null;
}

export interface RealPastDiagnostic {
    /** Nombre réel de transactions analysées (>= 0). */
    transactionsAnalyzed: number;
    /** Nombre de mois distincts couverts par l'historique observé. */
    monthsCovered: number;
    /** Date ISO de la transaction la plus ancienne / plus récente, ou null si aucune. */
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
    /** Revenus mensuels moyens observés en $ CAD, ou null si non mesurable. */
    observedMonthlyIncomeCad: number | null;
    /** Dépenses mensuelles moyennes observées en $ CAD, ou null si non mesurable. */
    observedMonthlyExpensesCad: number | null;
    /** Dépenses mensuelles prévues au budget en $ CAD, ou null si absentes. */
    budgetedMonthlyExpensesCad: number | null;
    /** Écart observé vs budget en $ CAD (+ = dépassement, - = économie), ou null. */
    monthlySpendingGapCad: number | null;
    /** Taux d'épargne réel observé (%), ou null. */
    observedSavingsRatePct: number | null;
    /** Dérive annuelle réelle du train de vie (%), ou null si historique insuffisant. */
    lifestyleCreepAnnualPct: number | null;
    /** Part des dépenses incompressibles (%) et discrétionnaires (%), ou null. */
    fixedExpensesSharePct: number | null;
    discretionarySharePct: number | null;
    /** Mois historiquement le plus coûteux / le plus léger (ex. "Décembre", "Février"), ou null. */
    peakSpendingMonthLabel: string | null;
    lowSpendingMonthLabel: string | null;
    /** Frais de gestion moyens pondérés (RFG %) sur le portefeuille, ou null si vide. */
    weightedMerPct: number | null;
    /** Fuite fiscale estimée par an (retenue US 15 % CELI + frais), en $ CAD, ou null. */
    estimatedAnnualFeeAndTaxDragCad: number | null;
    /** Volatilité mensuelle observée des dépenses (%), ou null. */
    expenseVolatilityPct: number | null;
    /** Calibrage réel des courbes placements + patrimoine net depuis janv. 2025. */
    pastCurveCalibration?: PastCurveCalibration | null;
    /** Résumés en français clair directement issus des constats réels. */
    findingsFr: string[];
}

export interface MacroNewsSignalItem {
    id: string;
    title: string;
    category: string;
    impactLabel: string;
    plainFrench: string;
    direction: 'positif' | 'neutre' | 'risque';
    isLive: boolean;
}

export interface MacroAndNewsSignalBundle {
    collectedAtIso: string;
    liveArticlesUsed: number;
    offlineFallbackUsed: boolean;
    portfolioSentimentScore: number | null;
    portfolioSentimentLabel: string;
    annualizedReturnAdjustmentPct: number;
    volatilityMultiplier: number;
    macroHeadlineFr: string;
    keySignals: MacroNewsSignalItem[];
    aiSynthesisFr: string | null;
    usedGemini: boolean;
}

export interface DeepScenarioPoint {
    monthIndex: number;
    year: number;
    age: number;
    /** Valeur nette médiane / attendue en $ CAD. */
    netWorth: number;
    p10: number;
    p25?: number;
    p50: number;
    p75?: number;
    p90: number;
    /** Tuple borné [p10, p90] pour tracer le ruban large dans Recharts. */
    mcRange: [number, number] | null;
    /** Tuple borné [p25, p75] pour tracer la zone centrale la plus probable (1 chance sur 2). */
    mcCoreRange?: [number, number] | null;
}

export interface DeepGoalMilestoneSummary {
    id: string;
    name: string;
    targetDate: string;
    probabilityPct: number | null;
    status: 'on_track' | 'at_risk' | 'achieved' | 'insufficient_data';
}

export interface DeepScenarioMilestones {
    fiAge: number | null;
    fiProbabilityPct: number | null;
    /** Revenu mensuel net soutenable à la retraite en $ CAD constants (pouvoir d'achat actuel). */
    sustainableMonthlyNetRetirementCad: number | null;
    /** Plancher prudent (P90 de sécurité) en $ CAD constants. */
    sustainableMonthlyNetP90Cad: number | null;
    goalsSummary: DeepGoalMilestoneSummary[];
    finalNetWorthP50: number | null;
    estateNetWorthP50: number | null;
    estateTaxP50: number | null;
    ruinProbabilityPct: number | null;
}

export type DeepTurningPointKind =
    | 'past'
    | 'macro'
    | 'fiscal'
    | 'milestone'
    | 'risk'
    | 'optimization';

export interface DeepTurningPoint {
    id: string;
    monthIndex: number;
    year: number;
    age: number;
    title: string;
    summaryFr: string;
    proofDetailsFr: string[];
    impactCad: number | null;
    kind: DeepTurningPointKind;
}

export interface DeepConcreteAction {
    id: string;
    title: string;
    plainFrenchWhy: string;
    gainCad: number | null;
    freedomMonthsGained: number | null;
    targetTab?: string;
    appliesAiScenario?: boolean;
}

export interface DeepScenarioOutput {
    id: DeepScenarioId;
    label: string;
    shortDescription: string;
    assumptionsSummaryFr: string;
    points: DeepScenarioPoint[];
    milestones: DeepScenarioMilestones;
    turningPoints: DeepTurningPoint[];
    appliedOptimizationsFr: string[];
}

export interface DeepValoriaSummary {
    consensus100: number | null;
    consensusTitle: string;
    evaluatedAssetsCount: number;
    regimeName: string;
    shortTermRatePct: number | null;
    longTermRatePct: number | null;
}

export interface DeepForecastReport {
    version: 1;
    inputsSig: string;
    createdAt: string;
    durationMs: number;
    trajectoriesRun: number;
    isDeepRun: boolean;
    pastDiagnostic: RealPastDiagnostic;
    newsBundle: MacroAndNewsSignalBundle;
    valoriaSummary: DeepValoriaSummary | null;
    scenarios: Record<DeepScenarioId, DeepScenarioOutput>;
    concreteActions: DeepConcreteAction[];
}
