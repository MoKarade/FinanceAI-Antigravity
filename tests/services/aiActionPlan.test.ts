import { describe, it, expect } from 'vitest';
import { buildReconciledAiActionPlan } from '../../services/projection/aiActionPlan';
import { Tab } from '../../types';
import { DEFAULT_APP_STATE } from '../../store/etatParDefaut';
import type { DeepForecastReport, DeepScenarioOutput } from '../../services/projection/deepForecastTypes';

function makeScenario(id: DeepScenarioOutput['id'], finalNw: number, fiAge: number | null): DeepScenarioOutput {
    return {
        id,
        label: id,
        shortDescription: '',
        assumptionsSummaryFr: '',
        points: [
            {
                monthIndex: 0,
                year: 2026,
                age: 35,
                netWorth: 100_000,
                p10: 80_000,
                p25: 90_000,
                p50: 100_000,
                p75: 110_000,
                p90: 120_000,
                mcRange: [80_000, 120_000],
                mcCoreRange: [90_000, 110_000],
            },
        ],
        milestones: {
            fiAge,
            fiProbabilityPct: 80,
            sustainableMonthlyNetRetirementCad: 4_000,
            sustainableMonthlyNetP90Cad: 3_200,
            goalsSummary: [],
            finalNetWorthP50: finalNw,
            estateNetWorthP50: finalNw * 0.85,
            estateTaxP50: finalNw * 0.15,
            ruinProbabilityPct: 5,
        },
        turningPoints: [],
        appliedOptimizationsFr: [],
    };
}

function makeReport(): DeepForecastReport {
    return {
        version: 1,
        inputsSig: 'test:sig',
        createdAt: '2026-11-26T12:00:00.000Z',
        durationMs: 100,
        trajectoriesRun: 1000,
        isDeepRun: true,
        pastDiagnostic: {
            transactionsAnalyzed: 50,
            monthsCovered: 6,
            firstTransactionDate: '2026-05-01',
            lastTransactionDate: '2026-10-31',
            observedMonthlyIncomeCad: 7_000,
            observedMonthlyExpensesCad: 4_400,
            budgetedMonthlyExpensesCad: 4_100,
            monthlySpendingGapCad: 300,
            observedSavingsRatePct: 37,
            lifestyleCreepAnnualPct: 1,
            fixedExpensesSharePct: 60,
            discretionarySharePct: 40,
            peakSpendingMonthLabel: 'Juillet',
            lowSpendingMonthLabel: 'Février',
            weightedMerPct: 0.35,
            estimatedAnnualFeeAndTaxDragCad: 450,
            expenseVolatilityPct: 6,
            findingsFr: [],
        },
        newsBundle: {
            collectedAtIso: '2026-11-26T12:00:00.000Z',
            liveArticlesUsed: 0,
            offlineFallbackUsed: true,
            portfolioSentimentScore: null,
            portfolioSentimentLabel: 'Neutre',
            annualizedReturnAdjustmentPct: 0,
            volatilityMultiplier: 1,
            macroHeadlineFr: 'Neutre',
            keySignals: [],
            aiSynthesisFr: null,
            usedGemini: false,
        },
        valoriaSummary: null,
        scenarios: {
            real_trajectory: makeScenario('real_trajectory', 1_200_000, 60),
            prudent_stress: makeScenario('prudent_stress', 900_000, 64),
            ai_optimized: makeScenario('ai_optimized', 1_420_000, 57),
            favorable_tailwinds: makeScenario('favorable_tailwinds', 1_800_000, 55),
        },
        concreteActions: [
            {
                id: 'extra-action',
                title: 'Automatiser le virement le jour de paie',
                plainFrenchWhy: 'Évite les dépenses impulsives en début de mois.',
                gainCad: 18_000,
                freedomMonthsGained: 4,
                targetTab: Tab.BUDGET,
                appliesAiScenario: true,
            },
        ],
    };
}

describe('buildReconciledAiActionPlan', () => {
    it('génère entre 3 et 5 actions priorisées avec patchs réels et écarts chiffrés', () => {
        const actions = buildReconciledAiActionPlan({
            state: {
                projection: {
                    ...DEFAULT_APP_STATE.projection,
                    withdrawalStrategy: 'PRIO_REER',
                    appliedDebtFirst: false,
                    appliedAssetLocation: false,
                },
                debts: [
                    {
                        id: 'd-cc',
                        name: 'Carte Visa',
                        balance: 6_000,
                        interestRate: 19.9,
                        minimumPayment: 180,
                        category: 'CreditCard',
                        kind: 'credit-card',
                    },
                ],
                budgetItems: [],
                assets: [
                    {
                        name: 'VFV',
                        symbol: 'VFV.TO',
                        accountType: 'CELI',
                        quantity: 100,
                        currentPrice: 140,
                        performance: 10,
                        dateBought: '2025-01-01',
                        currency: 'CAD',
                    },
                ],
                retirementGoal: DEFAULT_APP_STATE.retirementGoal,
                config: DEFAULT_APP_STATE.config,
                fxRates: { USD: 1.38, EUR: 1.5, CAD: 1 },
            },
            report: makeReport(),
        });

        expect(actions.length).toBeGreaterThanOrEqual(3);
        expect(actions.length).toBeLessThanOrEqual(5);

        const fiscal = actions.find((a) => a.id === 'action-fiscal-order');
        expect(fiscal?.isAlreadyApplied).toBe(false);
        expect(fiscal?.applyPatch?.projection?.withdrawalStrategy).toBe('AUTO_MARGINAL');
        expect(fiscal?.impactCad).toBe(Math.round(220_000 * 0.45));

        const debt = actions.find((a) => a.id === 'action-high-debt');
        expect(debt?.applyPatch?.projection?.appliedDebtFirst).toBe(true);
        expect(debt?.targetTab).toBe(Tab.DEBT);

        const drag = actions.find((a) => a.id === 'action-reduce-drag');
        expect(drag?.applyPatch?.projection?.appliedAssetLocation).toBe(true);
        expect(drag?.impactCad).toBe(450 * 12);
    });

    it('marque les optimisations déjà actives comme appliquées sans patch redondant', () => {
        const actions = buildReconciledAiActionPlan({
            state: {
                projection: {
                    ...DEFAULT_APP_STATE.projection,
                    withdrawalStrategy: 'AUTO_MARGINAL',
                    appliedDebtFirst: true,
                    appliedAssetLocation: true,
                },
                debts: [
                    {
                        id: 'd-cc',
                        name: 'Carte',
                        balance: 3_000,
                        interestRate: 18,
                        minimumPayment: 90,
                        category: 'CreditCard',
                        kind: 'credit-card',
                    },
                ],
                budgetItems: [],
                assets: [],
                retirementGoal: DEFAULT_APP_STATE.retirementGoal,
                config: DEFAULT_APP_STATE.config,
                fxRates: { USD: 1.38, EUR: 1.5, CAD: 1 },
            },
            report: makeReport(),
        });

        const fiscal = actions.find((a) => a.id === 'action-fiscal-order');
        const debt = actions.find((a) => a.id === 'action-high-debt');
        const drag = actions.find((a) => a.id === 'action-reduce-drag');
        expect(fiscal?.isAlreadyApplied).toBe(true);
        expect(fiscal?.applyPatch).toBeUndefined();
        expect(debt?.isAlreadyApplied).toBe(true);
        expect(drag?.isAlreadyApplied).toBe(true);
    });
});
