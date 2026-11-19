/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type * as AxeCore from 'axe-core';
import { FutureScenarioHeader } from '../../components/future/FutureScenarioHeader';
import { FutureRichTooltip } from '../../components/future/FutureRichTooltip';
import { FutureCoreMilestonesGrid } from '../../components/future/FutureCoreMilestonesGrid';
import { FutureUnifiedInsightsPanel } from '../../components/future/FutureUnifiedInsightsPanel';
import { useFinanceStore } from '../../store/useFinanceStore';
import { Tab } from '../../types';
import type { PointJour } from '../../components/projection/panneauJour/sections';
import type {
    DeepForecastReport,
    DeepScenarioId,
    DeepScenarioOutput,
} from '../../services/projection/deepForecastTypes';

async function expectNoSeriousViolations(container: HTMLElement) {
    const results = await axe(container);
    const serious = (results.violations || []).filter(
        (v: AxeCore.Result) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toHaveLength(0);
}

function assertTouchTargetClasses(container: HTMLElement) {
    const controls = container.querySelectorAll('button, input, select, textarea, [role="switch"], [role="tab"]');
    for (const el of controls) {
        const cls = el.getAttribute('class') ?? '';
        expect(
            cls.includes('touch-target') || cls.includes('min-h-11') || cls.includes('h-11'),
            `Contrôle sans classe 44px : ${el.tagName} "${el.textContent?.trim()}" (${cls})`,
        ).toBe(true);
    }
}

function makeScenario(id: DeepScenarioId, label: string, finalNetWorthP50: number): DeepScenarioOutput {
    return {
        id,
        label,
        shortDescription: `Description ${label}`,
        assumptionsSummaryFr: 'Hypothèses simulées',
        points: [
            {
                monthIndex: 0,
                year: 2026,
                age: 40,
                netWorth: 220_000,
                p10: 190_000,
                p50: 220_000,
                p90: 255_000,
                mcRange: [190_000, 255_000],
            },
        ],
        milestones: {
            fiAge: 58,
            fiProbabilityPct: 86,
            sustainableMonthlyNetRetirementCad: 4_100,
            sustainableMonthlyNetP90Cad: 3_300,
            goalsSummary: [
                {
                    id: 'g1',
                    name: 'Coussin',
                    targetDate: '2030-01-01',
                    probabilityPct: 95,
                    status: 'on_track',
                },
            ],
            finalNetWorthP50,
            estateNetWorthP50: finalNetWorthP50 - 80_000,
            estateTaxP50: 80_000,
            ruinProbabilityPct: 3,
        },
        turningPoints: [
            {
                id: 'tp-1',
                monthIndex: 120,
                year: 2036,
                age: 50,
                title: 'Atteinte du cap',
                summaryFr: 'Croissance accélérée par la discipline d’épargne.',
                proofDetailsFr: ['Cotisations CELI maximisées sur 10 ans.'],
                impactCad: 95_000,
                kind: 'milestone',
            },
        ],
        appliedOptimizationsFr: [],
    };
}

const sampleReport: DeepForecastReport = {
    version: 1,
    inputsSig: 'df1:axe:1',
    createdAt: '2026-11-18T12:00:00.000Z',
    durationMs: 1_200,
    trajectoriesRun: 100_000,
    isDeepRun: true,
    pastDiagnostic: {
        transactionsAnalyzed: 48,
        monthsCovered: 12,
        firstTransactionDate: '2025-11-01',
        lastTransactionDate: '2026-10-31',
        observedMonthlyIncomeCad: 6_000,
        observedMonthlyExpensesCad: 3_800,
        budgetedMonthlyExpensesCad: 3_750,
        monthlySpendingGapCad: 50,
        observedSavingsRatePct: 36.7,
        lifestyleCreepAnnualPct: 1.2,
        fixedExpensesSharePct: 60,
        discretionarySharePct: 40,
        peakSpendingMonthLabel: 'Décembre',
        lowSpendingMonthLabel: 'Février',
        weightedMerPct: 0.22,
        estimatedAnnualFeeAndTaxDragCad: 280,
        expenseVolatilityPct: 6.1,
        findingsFr: ['Historique stable'],
    },
    newsBundle: {
        collectedAtIso: '2026-11-18T12:00:00.000Z',
        liveArticlesUsed: 2,
        offlineFallbackUsed: false,
        portfolioSentimentScore: 0.2,
        portfolioSentimentLabel: 'Neutre',
        annualizedReturnAdjustmentPct: 0.1,
        volatilityMultiplier: 1,
        macroHeadlineFr: 'Taux stables à court terme.',
        keySignals: [
            {
                id: 's1',
                title: 'Signal taux',
                category: 'Macro',
                impactLabel: '+0,1 %',
                plainFrench: 'Impact modéré sur les obligations.',
                direction: 'neutre',
                isLive: true,
            },
        ],
        aiSynthesisFr: 'Trajectoire bien diversifiée.',
        usedGemini: false,
    },
    valoriaSummary: null,
    scenarios: {
        real_trajectory: makeScenario('real_trajectory', 'Trajectoire réelle', 1_250_000),
        prudent_stress: makeScenario('prudent_stress', 'Prudent / Stress', 880_000),
        ai_optimized: makeScenario('ai_optimized', 'Optimisé IA', 1_490_000),
        favorable_tailwinds: makeScenario('favorable_tailwinds', 'Favorable', 1_750_000),
    },
    concreteActions: [
        {
            id: 'a1',
            title: 'Prioriser le CELI',
            plainFrenchWhy: 'Économie d’impôt sur le rendement.',
            gainCad: 35_000,
            freedomMonthsGained: 6,
            targetTab: Tab.INVESTMENTS,
            appliesAiScenario: true,
        },
    ],
};

const samplePoint: PointJour = {
    monthIndex: 24,
    year: 2028,
    age: 42,
    dateLabel: '18 novembre 2028',
    NetWorth: 420_000,
    diffNW: 1_200,
    P10: 370_000,
    P50: 420_000,
    P90: 485_000,
    IncomeMarc: 4_800,
    Expenses: 3_100,
    Liquidites: 25_000,
    CELI: 135_000,
    REER: 260_000,
    isDailyPoint: true,
    dayIsReal: false,
    dayIsDated: true,
    dayMovements: [{ payee: 'Épicerie Exemple', amount: -95 }],
    dayMovementsTotal: 1,
};

const initialStore = useFinanceStore.getState();

describe('Accessibilité WCAG (vitest-axe) — Composants Futur 4.0', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('FutureScenarioHeader — états idle, running, staged, outdated et error sans violation ni cible < 44px', async () => {
        const baseProps = {
            report: sampleReport,
            appliedReport: null,
            pendingReport: null,
            selectedScenario: 'real_trajectory' as const,
            onSelectScenario: () => {},
            status: 'idle' as const,
            isApplying: false,
            progress: null,
            error: null,
            unreadableStorage: false,
            isOutdated: false,
            hasPendingToApply: false,
            refusMessage: null,
            onLaunch: () => {},
            onCancel: () => {},
            onApplyPending: () => {},
            onDiscardPending: () => {},
        };

        const { container, rerender } = render(<FutureScenarioHeader {...baseProps} />);
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        rerender(
            <FutureScenarioHeader
                {...baseProps}
                status="running"
                progress={{
                    phase: 'monte_carlo_100k',
                    phaseIndex: 3,
                    phaseTotal: 4,
                    phaseLabel: 'Simulation profonde',
                    percent: 55,
                    trajectoriesDone: 55_000,
                    trajectoriesTotal: 100_000,
                    etaSeconds: 12,
                }}
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        rerender(
            <FutureScenarioHeader
                {...baseProps}
                pendingReport={sampleReport}
                status="staged"
                hasPendingToApply
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        rerender(
            <FutureScenarioHeader
                {...baseProps}
                appliedReport={sampleReport}
                isOutdated
                status="error"
                error="Erreur temporaire"
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);
    });

    it('FutureRichTooltip — mode épinglé sans violation ni cible < 44px sur tous les onglets', async () => {
        const { container } = render(
            <FutureRichTooltip
                point={samplePoint}
                isOpen
                isPinned
                origine="epingle"
                anchorXRatio={0.25}
                scenarioLabel="Trajectoire réelle"
                turningPointHint="Atteinte du cap"
                userName1="Profil A"
                onOpenDetail={() => {}}
                onStep={() => {}}
                pas="jour"
                onPasChange={() => {}}
                canStepPrev
                canStepNext
                onUnpin={() => {}}
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        const tabs = container.querySelectorAll('[role="tab"]');
        for (const tab of tabs) {
            fireEvent.click(tab);
            await expectNoSeriousViolations(container);
            assertTouchTargetClasses(container);
        }
    });

    it('FutureCoreMilestonesGrid — peuplé et vide sans violation', async () => {
        const { container, rerender } = render(
            <FutureCoreMilestonesGrid
                report={sampleReport}
                scenario={sampleReport.scenarios.real_trajectory}
            />,
        );
        await expectNoSeriousViolations(container);

        const emptyScenario: DeepScenarioOutput = {
            ...sampleReport.scenarios.real_trajectory,
            milestones: {
                fiAge: null,
                fiProbabilityPct: null,
                sustainableMonthlyNetRetirementCad: null,
                sustainableMonthlyNetP90Cad: null,
                goalsSummary: [],
                finalNetWorthP50: null,
                estateNetWorthP50: null,
                estateTaxP50: null,
                ruinProbabilityPct: null,
            },
        };
        rerender(<FutureCoreMilestonesGrid report={sampleReport} scenario={emptyScenario} />);
        await expectNoSeriousViolations(container);
    });

    it('FutureUnifiedInsightsPanel — replié et déplié sans violation ni cible < 44px', async () => {
        const { container } = render(
            <FutureUnifiedInsightsPanel
                report={sampleReport}
                scenario={sampleReport.scenarios.real_trajectory}
                onFocusMonth={() => {}}
                onSelectScenario={() => {}}
                onNavigateTab={() => {}}
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        const firstAccordion = container.querySelector('button[aria-expanded="false"]');
        expect(firstAccordion).not.toBeNull();
        if (firstAccordion) fireEvent.click(firstAccordion);

        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);
    });
});
