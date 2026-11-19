/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    FutureScenarioHeader,
    type FutureScenarioHeaderProps,
} from '../../../components/future/FutureScenarioHeader';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type {
    DeepForecastReport,
    DeepScenarioId,
    DeepScenarioOutput,
} from '../../../services/projection/deepForecastTypes';

function makeScenario(
    id: DeepScenarioId,
    label: string,
    shortDescription: string,
    finalNetWorthP50: number | null,
    fiAge: number | null,
): DeepScenarioOutput {
    return {
        id,
        label,
        shortDescription,
        assumptionsSummaryFr: 'Hypothèses simulées',
        points: [
            {
                monthIndex: 0,
                year: 2026,
                age: 38,
                netWorth: 250_000,
                p10: 220_000,
                p50: 250_000,
                p90: 280_000,
                mcRange: [220_000, 280_000],
            },
        ],
        milestones: {
            fiAge,
            fiProbabilityPct: fiAge !== null ? 86 : null,
            sustainableMonthlyNetRetirementCad: 4_100,
            sustainableMonthlyNetP90Cad: 3_350,
            goalsSummary: [],
            finalNetWorthP50,
            estateNetWorthP50: finalNetWorthP50,
            estateTaxP50: 75_000,
            ruinProbabilityPct: 3.5,
        },
        turningPoints: [],
        appliedOptimizationsFr: [],
    };
}

function makeReport(overrides: Partial<DeepForecastReport> = {}): DeepForecastReport {
    return {
        version: 1,
        inputsSig: 'df1:scenario-header:1',
        createdAt: '2026-11-18T14:00:00.000Z',
        durationMs: 1_800,
        trajectoriesRun: 100_000,
        isDeepRun: true,
        pastDiagnostic: {
            transactionsAnalyzed: 12,
            monthsCovered: 6,
            firstTransactionDate: '2026-05-01',
            lastTransactionDate: '2026-10-31',
            observedMonthlyIncomeCad: 5_200,
            observedMonthlyExpensesCad: 3_200,
            budgetedMonthlyExpensesCad: 3_100,
            monthlySpendingGapCad: 100,
            observedSavingsRatePct: 38.5,
            lifestyleCreepAnnualPct: 1.1,
            fixedExpensesSharePct: 60,
            discretionarySharePct: 40,
            peakSpendingMonthLabel: 'Décembre',
            lowSpendingMonthLabel: 'Février',
            weightedMerPct: 0.2,
            estimatedAnnualFeeAndTaxDragCad: 250,
            expenseVolatilityPct: 6.5,
            findingsFr: ['Épargne observée stable'],
        },
        newsBundle: {
            collectedAtIso: '2026-11-18T14:00:00.000Z',
            liveArticlesUsed: 0,
            offlineFallbackUsed: true,
            portfolioSentimentScore: null,
            portfolioSentimentLabel: 'Neutre',
            annualizedReturnAdjustmentPct: 0,
            volatilityMultiplier: 1,
            macroHeadlineFr: 'Contexte macro neutre',
            keySignals: [],
            aiSynthesisFr: null,
            usedGemini: false,
        },
        valoriaSummary: null,
        scenarios: {
            real_trajectory: makeScenario(
                'real_trajectory',
                'Trajectoire réelle',
                'Projection ancrée sur ton budget, tes comptes et la fiscalité réelle.',
                1_320_000,
                59,
            ),
            prudent_stress: makeScenario(
                'prudent_stress',
                'Prudent / Stress',
                'Scénario défensif testant marchés difficiles, inflation et hausse de taux.',
                890_000,
                65,
            ),
            ai_optimized: makeScenario(
                'ai_optimized',
                'Optimisé IA',
                'Pistes concrètes de placement fiscal, frais réduits et épargne réaliste.',
                1_580_000,
                56,
            ),
            favorable_tailwinds: makeScenario(
                'favorable_tailwinds',
                'Favorable',
                'Marchés porteurs, inflation maîtrisée et discipline budgétaire maintenue.',
                1_820_000,
                53,
            ),
        },
        concreteActions: [],
        ...overrides,
    };
}

function makeProps(overrides: Partial<FutureScenarioHeaderProps> = {}): FutureScenarioHeaderProps {
    return {
        report: makeReport(),
        appliedReport: null,
        pendingReport: null,
        selectedScenario: 'real_trajectory',
        onSelectScenario: vi.fn(),
        status: 'idle',
        isApplying: false,
        progress: null,
        error: null,
        unreadableStorage: false,
        isOutdated: false,
        hasPendingToApply: false,
        refusMessage: null,
        onLaunch: vi.fn(),
        onCancel: vi.fn(),
        onApplyPending: vi.fn(),
        onDiscardPending: vi.fn(),
        ...overrides,
    };
}

const initialStore = useFinanceStore.getState();

describe('FutureScenarioHeader (remplace GrandCalculPanel — Futur 4.0)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('affiche les 4 scénarios uniques, sélectionne chacun et conserve l’état idle sans calcul en cours', () => {
        const onSelectScenario = vi.fn();
        const onLaunch = vi.fn();
        const { container } = render(
            <FutureScenarioHeader {...makeProps({ onSelectScenario, onLaunch })} />,
        );

        expect(screen.getByRole('region', { name: /Scénarios de trajectoire future/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Trajectoire réelle/i })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: /Prudent \/ Stress/i })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: /Optimisé IA/i })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: /Favorable/i })).toHaveAttribute('aria-pressed', 'false');

        // Gain Optimisé IA : 1 580 000 - 1 320 000 = +260 k$
        expect(screen.getByRole('button', { name: /Optimisé IA/i }).textContent).toContain('260');
        expect(container.textContent).not.toMatch(/survie/i);

        fireEvent.click(screen.getByRole('button', { name: /Favorable/i }));
        expect(onSelectScenario).toHaveBeenCalledWith('favorable_tailwinds');

        const launchBtn = screen.getByRole('button', { name: /Lancer l’analyse profonde/i });
        expect(launchBtn).toBeEnabled();
        fireEvent.click(launchBtn);
        expect(onLaunch).toHaveBeenCalledTimes(1);
    });

    it('désactive le bouton Lancer pendant status="restoring" ou si refusMessage est défini', () => {
        const { rerender } = render(<FutureScenarioHeader {...makeProps({ status: 'restoring' })} />);
        expect(screen.getByRole('button', { name: /Lancer l’analyse profonde/i })).toBeDisabled();

        rerender(<FutureScenarioHeader {...makeProps({ refusMessage: 'Salaire net invalide' })} />);
        expect(screen.getByRole('button', { name: /Lancer l’analyse profonde/i })).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent(/Salaire net invalide/);
    });

    it('affiche la progression multi-phases avec ETA (minutes/secondes), borne NaN %, et annule via onCancel', () => {
        const onCancel = vi.fn();
        const { rerender } = render(
            <FutureScenarioHeader
                {...makeProps({
                    status: 'running',
                    progress: {
                        phase: 'monte_carlo_100k',
                        phaseIndex: 3,
                        phaseTotal: 4,
                        phaseLabel: 'Simulation profonde multi-régimes',
                        percent: 62.6,
                        trajectoriesDone: 62_600,
                        trajectoriesTotal: 100_000,
                        etaSeconds: 95,
                    },
                    onCancel,
                })}
            />,
        );

        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '63');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(screen.getByRole('status')).toHaveTextContent(/Phase 3\/4 — Simulation profonde multi-régimes/);
        expect(document.body.textContent).toContain('ETA ~1 min 35 s');

        fireEvent.click(screen.getByRole('button', { name: /Annuler/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);

        // Percent NaN borné à 0 % (jamais aria-valuenow="NaN")
        rerender(
            <FutureScenarioHeader
                {...makeProps({
                    status: 'running',
                    progress: {
                        phase: 'past_audit',
                        phaseIndex: 1,
                        phaseTotal: 4,
                        phaseLabel: 'Audit du passé réel',
                        percent: Number.NaN,
                        trajectoriesDone: 0,
                        trajectoriesTotal: 100_000,
                        etaSeconds: null,
                    },
                })}
            />,
        );
        const nanBar = screen.getByRole('progressbar');
        expect(nanBar).toHaveAttribute('aria-valuenow', '0');
        expect(nanBar.firstElementChild).toHaveStyle({ width: '0%' });
        expect(document.body.textContent).not.toContain('NaN');
    });

    it('gère l’état staged (Appliquer et mémoriser / Ignorer) et désactive pendant isApplying', () => {
        const onApplyPending = vi.fn();
        const onDiscardPending = vi.fn();
        const pendingReport = makeReport({ trajectoriesRun: 100_000, isDeepRun: true });

        const { rerender } = render(
            <FutureScenarioHeader
                {...makeProps({
                    report: pendingReport,
                    pendingReport,
                    status: 'staged',
                    hasPendingToApply: true,
                    onApplyPending,
                    onDiscardPending,
                })}
            />,
        );

        const applyBtn = screen.getByRole('button', { name: /Appliquer et mémoriser/i });
        const discardBtn = screen.getByRole('button', { name: /Ignorer/i });
        expect(applyBtn).toBeEnabled();
        expect(discardBtn).toBeEnabled();

        fireEvent.click(applyBtn);
        expect(onApplyPending).toHaveBeenCalledTimes(1);

        fireEvent.click(discardBtn);
        expect(onDiscardPending).toHaveBeenCalledTimes(1);

        rerender(
            <FutureScenarioHeader
                {...makeProps({
                    report: pendingReport,
                    pendingReport,
                    status: 'staged',
                    hasPendingToApply: true,
                    isApplying: true,
                })}
            />,
        );
        const busyBtn = screen.getByRole('button', { name: /Appliquer et mémoriser/i });
        expect(busyBtn).toBeDisabled();
        expect(busyBtn).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: /Ignorer/i })).toBeDisabled();
    });

    it('affiche la mémoire chiffrée, le badge isOutdated, le repli cancelled et les erreurs/stockage illisible', () => {
        const appliedReport = makeReport();
        const { rerender } = render(
            <FutureScenarioHeader
                {...makeProps({
                    report: appliedReport,
                    appliedReport,
                    isOutdated: true,
                })}
            />,
        );

        expect(screen.getByText(/Analyse profonde en mémoire/i)).toBeInTheDocument();
        expect(screen.getByText(/Données modifiées — tu peux relancer quand tu veux/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Relancer l’analyse profonde/i })).toBeInTheDocument();

        rerender(<FutureScenarioHeader {...makeProps({ status: 'cancelled' })} />);
        expect(screen.getByText(/Calcul interrompu — l’état précédent reste conservé/i)).toBeInTheDocument();

        rerender(
            <FutureScenarioHeader
                {...makeProps({
                    status: 'error',
                    error: 'Erreur simulation worker',
                    unreadableStorage: true,
                })}
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent(/Erreur simulation worker/);
    });

    it('masque les montants/âges en mode discret et n’invente jamais 0 $ si données absentes', () => {
        useFinanceStore.setState({ isPrivacyMode: true });
        const { rerender, container } = render(<FutureScenarioHeader {...makeProps()} />);

        const txtPriv = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(txtPriv).not.toContain('1,32');
        expect(txtPriv).not.toContain('59 ans');
        expect(txtPriv).not.toContain('$');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(8);

        useFinanceStore.setState({ isPrivacyMode: false });
        const emptyReport = makeReport({
            scenarios: {
                real_trajectory: makeScenario('real_trajectory', 'Trajectoire réelle', 'Desc', null, null),
                prudent_stress: makeScenario('prudent_stress', 'Prudent / Stress', 'Desc', Number.NaN, null),
                ai_optimized: makeScenario('ai_optimized', 'Optimisé IA', 'Desc', null, null),
                favorable_tailwinds: makeScenario('favorable_tailwinds', 'Favorable', 'Desc', null, null),
            },
        });
        rerender(<FutureScenarioHeader {...makeProps({ report: emptyReport })} />);
        expect(container.textContent).not.toMatch(/\b0\s*\$/);
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(8);
    });
});
