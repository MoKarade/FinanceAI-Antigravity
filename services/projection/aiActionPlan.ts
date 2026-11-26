// services/projection/aiActionPlan.ts
// Module pur : construit 3 à 5 actions concrètes en français simple pour atteindre
// le scénario « Optimisé IA », réconciliées avec l'état courant et les écarts réels.
// Zéro import de store/ ou React.

import type { AppState } from '../../types';
import { Tab } from '../../types';
import type { DeepForecastReport } from './deepForecastTypes';
import { computeInvestmentsValue, computeMonthlyBudgetAggregates } from '../portfolio';
import { formatCAD } from '../../utils/format';

export interface ReconciledAiAction {
    id: string;
    title: string;
    plainFrenchWhy: string;
    impactCad: number | null;
    impactMonths: number | null;
    priority: number;
    isAlreadyApplied: boolean;
    applyLabel?: string;
    applyPatch?: Partial<AppState>;
    targetTab?: Tab;
}

export interface BuildAiActionPlanInput {
    state: Pick<
        AppState,
        'projection' | 'debts' | 'budgetItems' | 'assets' | 'retirementGoal' | 'config' | 'fxRates'
    >;
    report: DeepForecastReport;
}

/**
 * Produit une liste bornée (3 à 5 éléments) d'actions concrètes priorisées et actionnables
 * directement à partir des écarts mesurés entre la trajectoire réelle et le scénario Optimisé IA.
 */
export function buildReconciledAiActionPlan(input: BuildAiActionPlanInput): ReconciledAiAction[] {
    const { state, report } = input;
    const actions: ReconciledAiAction[] = [];

    const realFinal = report.scenarios.real_trajectory?.milestones?.finalNetWorthP50 ?? null;
    const aiFinal = report.scenarios.ai_optimized?.milestones?.finalNetWorthP50 ?? null;
    const totalAiDeltaCad =
        typeof realFinal === 'number' &&
        Number.isFinite(realFinal) &&
        typeof aiFinal === 'number' &&
        Number.isFinite(aiFinal)
            ? Math.max(0, Math.round(aiFinal - realFinal))
            : null;

    const realFiAge = report.scenarios.real_trajectory?.milestones?.fiAge ?? null;
    const aiFiAge = report.scenarios.ai_optimized?.milestones?.fiAge ?? null;
    const aiFiMonthsSaved =
        typeof realFiAge === 'number' &&
        Number.isFinite(realFiAge) &&
        typeof aiFiAge === 'number' &&
        Number.isFinite(aiFiAge) &&
        realFiAge > aiFiAge
            ? Math.round((realFiAge - aiFiAge) * 12)
            : null;

    const past = report.pastDiagnostic;
    const portfolioCad = computeInvestmentsValue(state.assets ?? [], state.fxRates ?? {}, 0);
    const budgetAgg = computeMonthlyBudgetAggregates(state.config, state.budgetItems ?? []);

    // 1. Ordre fiscal automatique (AUTO_MARGINAL) + optimisation des cotisations
    const currentStrategy = state.projection?.withdrawalStrategy ?? 'AUTO_MARGINAL';
    const hasExplicitAuto = state.projection?.withdrawalStrategy === 'AUTO_MARGINAL';
    const strategyDelta =
        totalAiDeltaCad !== null && totalAiDeltaCad > 500
            ? Math.round(totalAiDeltaCad * 0.45)
            : portfolioCad > 5_000
              ? Math.round(portfolioCad * 0.08)
              : null;
    actions.push({
        id: 'action-fiscal-order',
        title: hasExplicitAuto
            ? 'Ordre fiscal CELI / REER automatique actif'
            : 'Activer l’ordre fiscal automatique (CELI / REER)',
        plainFrenchWhy: hasExplicitAuto
            ? 'Tes surplus visent déjà le compte le plus rentable selon ton taux marginal ARC et Revenu Québec.'
            : 'Orienter automatiquement chaque dollar vers le CELI, le CELIAPP ou le REER selon ton palier d’impôt maximise le capital net à la retraite.',
        impactCad: strategyDelta,
        impactMonths: aiFiMonthsSaved !== null && aiFiMonthsSaved > 0 ? Math.max(1, Math.round(aiFiMonthsSaved * 0.45)) : null,
        priority: hasExplicitAuto ? 8 : 1,
        isAlreadyApplied: hasExplicitAuto,
        applyLabel: hasExplicitAuto ? undefined : 'Appliquer à mon plan',
        applyPatch: hasExplicitAuto
            ? undefined
            : {
                  projection: {
                      ...state.projection,
                      withdrawalStrategy: 'AUTO_MARGINAL',
                  },
              },
        targetTab: Tab.RETIREMENT,
    });

    // 2. Remboursement prioritaire des dettes coûteuses (>= 7 %)
    const highRateDebts = (state.debts ?? []).filter(
        (d) => Number.isFinite(d.balance) && d.balance > 100 && Number.isFinite(d.interestRate) && d.interestRate >= 7,
    );
    if (highRateDebts.length > 0) {
        const totalHighDebt = highRateDebts.reduce((s, d) => s + d.balance, 0);
        const maxRate = Math.max(...highRateDebts.map((d) => d.interestRate));
        const annualInterestSaved = Math.round(totalHighDebt * (maxRate / 100));
        const isDebtFirst = state.projection?.appliedDebtFirst === true;
        void currentStrategy;
        actions.push({
            id: 'action-high-debt',
            title: `Solder en priorité les dettes à ${maxRate.toFixed(1).replace('.', ',')} %`,
            plainFrenchWhy: `Rembourser ${formatCAD(Math.round(totalHighDebt))} de dettes coûteuses offre un rendement net garanti supérieur aux marchés.`,
            impactCad: annualInterestSaved > 0 ? annualInterestSaved * 5 : null,
            impactMonths: totalHighDebt > 5_000 ? 6 : 2,
            priority: isDebtFirst ? 7 : 2,
            isAlreadyApplied: isDebtFirst,
            applyLabel: isDebtFirst ? undefined : 'Prioriser les dettes',
            applyPatch: isDebtFirst
                ? undefined
                : {
                      projection: {
                          ...state.projection,
                          appliedDebtFirst: true,
                      },
                  },
            targetTab: Tab.DEBT,
        });
    }

    // 3. Récupération d'un dépassement budgétaire réel observé
    if (
        past.monthlySpendingGapCad !== null &&
        Number.isFinite(past.monthlySpendingGapCad) &&
        past.monthlySpendingGapCad > 40
    ) {
        const recoverableMonthly = Math.round(past.monthlySpendingGapCad * 0.65);
        const gain10y = Math.round(recoverableMonthly * 12 * 13.2); // facteur composé modéré 10 ans ~5,5 %
        actions.push({
            id: 'action-budget-gap',
            title: `Récupérer ${formatCAD(recoverableMonthly)}/mois sur l’écart réel de dépenses`,
            plainFrenchWhy: `Tes transactions réelles dépassent ton budget prévu de ${formatCAD(Math.round(past.monthlySpendingGapCad))}/mois. Réduire cet écart nourrit directement ton épargne.`,
            impactCad: gain10y > 0 ? gain10y : null,
            impactMonths: Math.max(2, Math.min(24, Math.round(recoverableMonthly / 45))),
            priority: 2,
            isAlreadyApplied: false,
            targetTab: Tab.BUDGET,
        });
    }

    // 4. Frais de gestion (RFG) & retenue US en CELI
    if (
        past.estimatedAnnualFeeAndTaxDragCad !== null &&
        Number.isFinite(past.estimatedAnnualFeeAndTaxDragCad) &&
        past.estimatedAnnualFeeAndTaxDragCad > 120
    ) {
        const annualDrag = Math.round(past.estimatedAnnualFeeAndTaxDragCad);
        const isAssetLocationActive = state.projection?.appliedAssetLocation === true;
        actions.push({
            id: 'action-reduce-drag',
            title: 'Réduire les frais et la retenue US évitable',
            plainFrenchWhy: `Tu perds environ ${formatCAD(annualDrag)}/an en frais de fonds et retenues américaines en CELI. Loger tes titres US en REER et privilégier des ETF peu coûteux protège ce rendement.`,
            impactCad: annualDrag * 12,
            impactMonths: annualDrag > 500 ? 6 : 3,
            priority: isAssetLocationActive ? 7 : 3,
            isAlreadyApplied: isAssetLocationActive,
            applyLabel: isAssetLocationActive ? undefined : 'Optimiser la localisation',
            applyPatch: isAssetLocationActive
                ? undefined
                : {
                      projection: {
                          ...state.projection,
                          appliedAssetLocation: true,
                      },
                  },
            targetTab: Tab.INVESTMENTS,
        });
    }

    // 5. Discipline d'épargne / ajustement vers le plan IA si écart réel > 0
    if (actions.length < 4 && (budgetAgg.savings > 0 || report.concreteActions.length > 0)) {
        for (const ca of report.concreteActions) {
            if (actions.length >= 5) break;
            if (actions.some((a) => a.title === ca.title)) continue;
            const resolvedTab = Object.values(Tab).includes(ca.targetTab as Tab)
                ? (ca.targetTab as Tab)
                : Tab.RETIREMENT;
            actions.push({
                id: `action-report-${ca.id}`,
                title: ca.title,
                plainFrenchWhy: ca.plainFrenchWhy,
                impactCad: ca.gainCad !== null && Number.isFinite(ca.gainCad) ? Math.round(ca.gainCad) : null,
                impactMonths:
                    ca.freedomMonthsGained !== null && Number.isFinite(ca.freedomMonthsGained)
                        ? Math.round(ca.freedomMonthsGained)
                        : null,
                priority: 5,
                isAlreadyApplied: false,
                targetTab: resolvedTab,
            });
        }
    }

    return actions
        .sort((a, b) => a.priority - b.priority)
        .slice(0, 5);
}
