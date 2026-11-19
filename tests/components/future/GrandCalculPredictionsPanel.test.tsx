/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { FutureCoreMilestonesGrid } from '../../../components/future/FutureCoreMilestonesGrid';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type {
    DeepForecastReport,
    DeepGoalMilestoneSummary,
    DeepScenarioOutput,
} from '../../../services/projection/deepForecastTypes';

function makeScenario(
    overrides: Partial<DeepScenarioOutput['milestones']> = {},
): DeepScenarioOutput {
    return {
        id: 'real_trajectory',
        label: 'Trajectoire réelle',
        shortDescription: 'Trajectoire de référence',
        assumptionsSummaryFr: 'Hypothèses réelles',
        points: [],
        milestones: {
            fiAge: 58,
            fiProbabilityPct: 86.5,
            sustainableMonthlyNetRetirementCad: 4_350,
            sustainableMonthlyNetP90Cad: 3_420,
            goalsSummary: [
                {
                    id: 'g-achieved',
                    name: 'Fonds urgence',
                    targetDate: '2027-06-01',
                    probabilityPct: 100,
                    status: 'achieved',
                },
                {
                    id: 'g-next',
                    name: 'Voyage Japon',
                    targetDate: '2029-09-15',
                    probabilityPct: 78.4,
                    status: 'on_track',
                },
                {
                    id: 'g-later',
                    name: 'Chalet',
                    targetDate: '2035-05-01',
                    probabilityPct: 48.2,
                    status: 'at_risk',
                },
            ],
            finalNetWorthP50: 1_650_000,
            estateNetWorthP50: 1_420_000,
            estateTaxP50: 230_000,
            ruinProbabilityPct: 3.1,
            ...overrides,
        },
        turningPoints: [],
        appliedOptimizationsFr: [],
    };
}

function makeReport(scenario: DeepScenarioOutput, isDeepRun = true): DeepForecastReport {
    return {
        version: 1,
        inputsSig: 'df1:milestones:1',
        createdAt: '2026-11-18T12:00:00.000Z',
        durationMs: 1_500,
        trajectoriesRun: isDeepRun ? 100_000 : 0,
        isDeepRun,
        pastDiagnostic: {
            transactionsAnalyzed: 0,
            monthsCovered: 0,
            firstTransactionDate: null,
            lastTransactionDate: null,
            observedMonthlyIncomeCad: null,
            observedMonthlyExpensesCad: null,
            budgetedMonthlyExpensesCad: null,
            monthlySpendingGapCad: null,
            observedSavingsRatePct: null,
            lifestyleCreepAnnualPct: null,
            fixedExpensesSharePct: null,
            discretionarySharePct: null,
            peakSpendingMonthLabel: null,
            lowSpendingMonthLabel: null,
            weightedMerPct: null,
            estimatedAnnualFeeAndTaxDragCad: null,
            expenseVolatilityPct: null,
            findingsFr: [],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T12:00:00.000Z',
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
            real_trajectory: scenario,
            prudent_stress: scenario,
            ai_optimized: scenario,
            favorable_tailwinds: scenario,
        },
        concreteActions: [],
    };
}

const initialStore = useFinanceStore.getState();

describe('FutureCoreMilestonesGrid (remplace GrandCalculPredictionsPanel — Futur 4.0)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('affiche les 4 cartes repères dans l’ordre avec valeurs cohérentes et libellé de profondeur', () => {
        const scenario = makeScenario();
        const report = makeReport(scenario, true);
        render(<FutureCoreMilestonesGrid report={report} scenario={scenario} />);

        const region = screen.getByRole('region', { name: /Repères clés de vie/i });
        expect(region).toBeInTheDocument();
        expect(screen.getByText(/Simulation Monte Carlo profonde/i)).toBeInTheDocument();

        const articles = within(region).getAllByRole('article');
        expect(articles).toHaveLength(4);
        expect(articles[0]).toHaveTextContent(/Indépendance financière/i);
        expect(articles[0]).toHaveTextContent(/58 ans/);
        expect(articles[0]).toHaveTextContent(/86,5\s*%/);

        expect(articles[1]).toHaveTextContent(/Revenu mensuel net retraite/i);
        expect(articles[1]).toHaveTextContent(/4[\s\u00a0\u202f]350\s*\$/);
        expect(articles[1]).toHaveTextContent(/3[\s\u00a0\u202f]420\s*\$/);

        expect(articles[2]).toHaveTextContent(/Objectifs datés/i);
        expect(articles[2]).toHaveTextContent(/2 \/ 3/);
        // Priorité au prochain objectif non encore atteint le plus proche dans le temps (Voyage Japon)
        expect(articles[2]).toHaveTextContent(/Voyage Japon/);
        expect(articles[2]).toHaveTextContent(/Sur la cible/);

        expect(articles[3]).toHaveTextContent(/Patrimoine final & Succession/i);
        expect(articles[3]).toHaveTextContent(/1,65/);
        expect(articles[3]).toHaveTextContent(/1,42/);
        expect(articles[3]).toHaveTextContent(/230/);
    });

    it('respecte no-fake-data (« — » jamais 0 $) lorsque les mesures sont absentes ou non finies', () => {
        const emptyScenario = makeScenario({
            fiAge: null,
            fiProbabilityPct: Number.NaN,
            sustainableMonthlyNetRetirementCad: null,
            sustainableMonthlyNetP90Cad: Number.POSITIVE_INFINITY,
            goalsSummary: [],
            finalNetWorthP50: null,
            estateNetWorthP50: null,
            estateTaxP50: Number.NaN,
        });
        const report = makeReport(emptyScenario, false);

        const { container } = render(
            <FutureCoreMilestonesGrid report={report} scenario={emptyScenario} />,
        );

        expect(screen.getByText(/Aperçu rapide instantané/i)).toBeInTheDocument();
        expect(screen.getByText(/Aucun objectif daté configuré/i)).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/\b0\s*\$/);
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(7);
    });

    it('gère tous les statuts d’objectifs (Atteint, À surveiller, Hors horizon) et date vide', () => {
        const cases: Array<{ goal: DeepGoalMilestoneSummary; badge: string }> = [
            {
                goal: { id: 'g1', name: 'Cible A', targetDate: '2026-08-01', probabilityPct: 100, status: 'achieved' },
                badge: 'Atteint',
            },
            {
                goal: { id: 'g2', name: 'Cible B', targetDate: '2030-01', probabilityPct: 42, status: 'at_risk' },
                badge: 'À surveiller',
            },
            {
                goal: { id: 'g3', name: 'Cible C', targetDate: '', probabilityPct: null, status: 'insufficient_data' },
                badge: 'Hors horizon',
            },
        ];

        for (const { goal, badge } of cases) {
            const scenario = makeScenario({ goalsSummary: [goal] });
            const { unmount } = render(
                <FutureCoreMilestonesGrid report={makeReport(scenario)} scenario={scenario} />,
            );
            expect(screen.getByText(badge)).toBeInTheDocument();
            expect(screen.getByText(goal.name)).toBeInTheDocument();
            unmount();
        }
    });

    it('masque intégralement montants, âges, pourcentages et noms d’objectifs en mode discret', () => {
        useFinanceStore.setState({ isPrivacyMode: true });
        const scenario = makeScenario({
            goalsSummary: [
                {
                    id: 'g-priv',
                    name: 'Objectif secret 500 k$',
                    targetDate: '2031-05-01',
                    probabilityPct: 81.2,
                    status: 'on_track',
                },
            ],
        });
        const { container } = render(
            <FutureCoreMilestonesGrid report={makeReport(scenario)} scenario={scenario} />,
        );

        const txt = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(txt).not.toContain('$');
        expect(txt).not.toContain('58 ans');
        expect(txt).not.toContain('86,5');
        expect(txt).not.toContain('4 350');
        expect(txt).not.toContain('Objectif secret 500 k$');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(8);
        expect(screen.getAllByText('Valeur masquée').length).toBeGreaterThanOrEqual(1);
    });
});
