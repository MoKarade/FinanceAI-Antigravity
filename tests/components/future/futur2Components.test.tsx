// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FutureUnifiedInsightsPanel } from '../../../components/future/FutureUnifiedInsightsPanel';
import { FutureYearAnatomyModal } from '../../../components/future/FutureYearAnatomyModal';
import { useFinanceStore } from '../../../store/useFinanceStore';
import { Tab } from '../../../types';
import type { ProjectionChartPoint } from '../../../services/projection/types';
import type { DeepForecastReport, DeepScenarioOutput } from '../../../services/projection/deepForecastTypes';

function makeScenario(): DeepScenarioOutput {
    return {
        id: 'real_trajectory',
        label: 'Trajectoire réelle',
        shortDescription: 'Ancrée sur tes flux observés et la fiscalité ARC/RQ.',
        assumptionsSummaryFr: 'Rendement neutre 6,1 %',
        points: [],
        milestones: {
            fiAge: 58,
            fiProbabilityPct: 84,
            sustainableMonthlyNetRetirementCad: 4_200,
            sustainableMonthlyNetP90Cad: 3_400,
            goalsSummary: [],
            finalNetWorthP50: 1_450_000,
            estateNetWorthP50: 1_250_000,
            estateTaxP50: 200_000,
            ruinProbabilityPct: 3,
        },
        turningPoints: [
            {
                id: 'tp-fire',
                monthIndex: 144,
                year: 2038,
                age: 54,
                title: 'Atteinte du seuil FIRE',
                summaryFr: 'Le capital projeté couvre durablement le train de vie net.',
                proofDetailsFr: [
                    'Épargne observée maintenue à 35 % sur 12 mois.',
                    'Gain fiscal annuel de 2 400 $ via localisation CELI/REER.',
                ],
                impactCad: 120_000,
                kind: 'milestone',
            },
        ],
        appliedOptimizationsFr: [],
    };
}

function makeReport(overrides: Partial<DeepForecastReport> = {}): DeepForecastReport {
    const scenario = makeScenario();
    return {
        version: 1,
        inputsSig: 'df1:insights:1',
        createdAt: '2026-11-18T12:00:00.000Z',
        durationMs: 900,
        trajectoriesRun: 100_000,
        isDeepRun: true,
        pastDiagnostic: {
            transactionsAnalyzed: 184,
            monthsCovered: 12,
            firstTransactionDate: '2025-11-01',
            lastTransactionDate: '2026-10-31',
            observedMonthlyIncomeCad: 6_500,
            observedMonthlyExpensesCad: 4_120,
            budgetedMonthlyExpensesCad: 4_000,
            monthlySpendingGapCad: 120,
            observedSavingsRatePct: 36.6,
            lifestyleCreepAnnualPct: 1.4,
            fixedExpensesSharePct: 62,
            discretionarySharePct: 38,
            peakSpendingMonthLabel: 'Décembre',
            lowSpendingMonthLabel: 'Février',
            weightedMerPct: 0.24,
            estimatedAnnualFeeAndTaxDragCad: 380,
            expenseVolatilityPct: 7.2,
            findingsFr: ['Dépenses de décembre +18 % au-dessus de la moyenne.'],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T12:00:00.000Z',
            liveArticlesUsed: 4,
            offlineFallbackUsed: false,
            portfolioSentimentScore: 0.35,
            portfolioSentimentLabel: 'Modérément porteur',
            annualizedReturnAdjustmentPct: 0.3,
            volatilityMultiplier: 0.96,
            macroHeadlineFr: 'Baisse graduelle des taux directeurs attendue au Canada.',
            keySignals: [
                {
                    id: 'sig-1',
                    title: 'Taux directeur BoC',
                    category: 'Macro',
                    impactLabel: '+0,3 %/an',
                    plainFrench: 'Soutient les obligations et réduit la charge hypothécaire au renouvellement.',
                    direction: 'positif',
                    isLive: true,
                },
            ],
            aiSynthesisFr: 'Positionnement équilibré entre actions mondiales et liquidités.',
            usedGemini: true,
        },
        valoriaSummary: {
            consensus100: 78,
            consensusTitle: 'Constructif',
            evaluatedAssetsCount: 6,
            regimeName: 'Expansion modérée',
            shortTermRatePct: 5.8,
            longTermRatePct: 6.4,
        },
        scenarios: {
            real_trajectory: scenario,
            prudent_stress: scenario,
            ai_optimized: scenario,
            favorable_tailwinds: scenario,
        },
        concreteActions: [
            {
                id: 'act-celi',
                title: 'Maximiser les cotisations CELI avant le non-enregistré',
                plainFrenchWhy: 'Évite l’imposition annuelle des dividendes et gains en capital.',
                gainCad: 42_000,
                freedomMonthsGained: 9,
                targetTab: Tab.INVESTMENTS,
                appliesAiScenario: true,
            },
        ],
        ...overrides,
    };
}

describe('Futur 4.0 — FutureUnifiedInsightsPanel & FutureYearAnatomyModal', () => {
    beforeEach(() => {
        useFinanceStore.setState({ isPrivacyMode: false });
    });

    it('FutureUnifiedInsightsPanel affiche passé réel, actualités, tournants dépliables avec focus courbe et actions chiffrées', () => {
        const onFocusMonth = vi.fn();
        const onSelectScenario = vi.fn();
        const onNavigateTab = vi.fn();
        const report = makeReport();
        const scenario = report.scenarios.real_trajectory;

        render(
            <FutureUnifiedInsightsPanel
                report={report}
                scenario={scenario}
                onFocusMonth={onFocusMonth}
                onSelectScenario={onSelectScenario}
                onNavigateTab={onNavigateTab}
            />,
        );

        // Partie A : Passé réel + actualités en direct + consensus Valoria
        expect(screen.getByText(/Diagnostic de ton passé réel/i)).toBeInTheDocument();
        expect(screen.getByText(/184 opérations · 12 mois/)).toBeInTheDocument();
        expect(screen.getByText(/36,6\s*%/)).toBeInTheDocument();
        expect(screen.getByText(/En direct \(4 articles\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Synthèse Gemini/i)).toBeInTheDocument();
        expect(screen.getByText(/Valoria : Constructif \(Expansion modérée\)/i)).toBeInTheDocument();

        // Partie B : Tournants majeurs + preuves dépliables + focus courbe
        expect(screen.getByText(/Atteinte du seuil FIRE/i)).toBeInTheDocument();
        expect(screen.queryByText(/Gain fiscal annuel de 2 400/)).not.toBeInTheDocument();

        const toggleBtn = screen.getByRole('button', { name: /Voir les chiffres/i });
        expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(toggleBtn);
        expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText(/Gain fiscal annuel de 2 400/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Voir sur la courbe/i }));
        expect(onFocusMonth).toHaveBeenCalledWith(144);

        // Partie C : Actions concrètes -> bascule Optimisé IA + navigation onglet cible
        fireEvent.click(screen.getByRole('button', { name: /Appliquer dans Optimisé IA/i }));
        expect(onSelectScenario).toHaveBeenCalledWith('ai_optimized');

        fireEvent.click(screen.getByRole('button', { name: /Ouvrir Placements/i }));
        expect(onNavigateTab).toHaveBeenCalledWith(Tab.INVESTMENTS);
    });

    it('FutureUnifiedInsightsPanel respecte no-fake-data et masque tout en mode discret', () => {
        const emptyReport = makeReport({
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
                portfolioSentimentLabel: 'Hors ligne',
                annualizedReturnAdjustmentPct: 0,
                volatilityMultiplier: 1,
                macroHeadlineFr: 'Mode hors-ligne',
                keySignals: [],
                aiSynthesisFr: null,
                usedGemini: false,
            },
            valoriaSummary: null,
            concreteActions: [],
        });
        const emptyScenario: DeepScenarioOutput = {
            ...makeScenario(),
            turningPoints: [],
        };

        const { rerender, container } = render(
            <FutureUnifiedInsightsPanel
                report={emptyReport}
                scenario={emptyScenario}
                onFocusMonth={vi.fn()}
                onSelectScenario={vi.fn()}
            />,
        );

        expect(screen.getByText(/Historique non mesuré/i)).toBeInTheDocument();
        expect(screen.getByText(/Repli hors-ligne/i)).toBeInTheDocument();
        expect(screen.getByText(/Aucun point d'inflexion majeur détecté/i)).toBeInTheDocument();
        expect(screen.getByText(/Aucune action prioritaire supplémentaire identifiée/i)).toBeInTheDocument();
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(4);

        // Mode discret sur le rapport peuplé
        const richReport = makeReport();
        useFinanceStore.setState({ isPrivacyMode: true });
        rerender(
            <FutureUnifiedInsightsPanel
                report={richReport}
                scenario={richReport.scenarios.real_trajectory}
                onFocusMonth={vi.fn()}
                onSelectScenario={vi.fn()}
            />,
        );
        const txt = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(txt).not.toContain('36,6');
        expect(txt).not.toContain('42');
        expect(txt).not.toContain('380');
        expect(txt).not.toContain('54 ans');
        expect(txt).not.toContain('$');
    });

    it('FutureYearAnatomyModal agrège les 4 panneaux, respecte No-Fake-Data (—) et masque les montants en mode discret', () => {
        const onClose = vi.fn();
        const points: ProjectionChartPoint[] = Array.from({ length: 12 }, (_, m) => ({
            monthIndex: m,
            year: 2027,
            age: 40 + m / 12,
            NetWorth: 250000 + m * 1000,
            realNetWorth: 245000 + m * 950,
            Liquidites: 15000,
            CELI: 80000,
            CELIMax: 95000,
            REER: 140000,
            REERMax: 180000,
            NonReg: 15000,
            IncomeMarc: 6000,
            Income: 6000,
            Expenses: 3800,
            Savings: 2200,
        } as ProjectionChartPoint));

        const { rerender } = render(
            <FutureYearAnatomyModal
                isOpen={true}
                onClose={onClose}
                chartData={points}
                initialYear={2027}
                userName1="Alex"
            />,
        );

        const dialog = screen.getByRole('dialog');
        expect(dialog).toBeTruthy();
        expect(screen.getByText(/1\. Revenus & Rentes/i)).toBeTruthy();
        expect(screen.getByText(/2\. Impôts & Cotisations/i)).toBeTruthy();
        expect(screen.getByText(/3\. Dépenses & Famille/i)).toBeTruthy();
        expect(screen.getByText(/4\. Bilan & Portefeuille/i)).toBeTruthy();
        expect(screen.getAllByText('—').length).toBeGreaterThan(0);

        useFinanceStore.setState({ isPrivacyMode: true });
        rerender(
            <FutureYearAnatomyModal
                isOpen={true}
                onClose={onClose}
                chartData={points}
                initialYear={2027}
                userName1="Alex"
            />,
        );
        expect(dialog.textContent).not.toContain('72 000');

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });
});
