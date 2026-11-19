/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { toHaveNoViolations } from 'vitest-axe/dist/matchers';
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

declare module 'vitest' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
        toHaveNoViolations(): R;
    }
}

expect.extend({ toHaveNoViolations });

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
        assumptionsSummaryFr: 'Résumé synthétique',
        points: [
            {
                monthIndex: 0,
                year: 2026,
                age: 38,
                netWorth: 200_000,
                p10: 180_000,
                p50: 200_000,
                p90: 220_000,
                mcRange: [180_000, 220_000],
            },
        ],
        milestones: {
            fiAge,
            fiProbabilityPct: fiAge !== null ? 84 : null,
            sustainableMonthlyNetRetirementCad: 4_200,
            sustainableMonthlyNetP90Cad: 3_400,
            goalsSummary: [],
            finalNetWorthP50,
            estateNetWorthP50: finalNetWorthP50,
            estateTaxP50: 65_000,
            ruinProbabilityPct: 4,
        },
        turningPoints: [],
        appliedOptimizationsFr: [],
    };
}

function makeReport(overrides: Partial<DeepForecastReport> = {}): DeepForecastReport {
    return {
        version: 1,
        inputsSig: 'sig:test:1',
        createdAt: '2026-11-18T14:00:00.000Z',
        durationMs: 1_200,
        trajectoriesRun: 400,
        isDeepRun: false,
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
            collectedAtIso: '2026-11-18T14:00:00.000Z',
            liveArticlesUsed: 0,
            offlineFallbackUsed: true,
            portfolioSentimentScore: null,
            portfolioSentimentLabel: 'Neutre',
            annualizedReturnAdjustmentPct: 0,
            volatilityMultiplier: 1,
            macroHeadlineFr: 'Contexte neutre',
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
                1_250_000,
                58,
            ),
            prudent_stress: makeScenario(
                'prudent_stress',
                'Prudent / Stress',
                'Scénario défensif testant marchés difficiles et inflation persistante.',
                820_000,
                64,
            ),
            ai_optimized: makeScenario(
                'ai_optimized',
                'Optimisé IA',
                'Pistes concrètes de placement fiscal, frais réduits et épargne réaliste.',
                1_490_000,
                55,
            ),
            favorable_tailwinds: makeScenario(
                'favorable_tailwinds',
                'Favorable',
                'Marchés porteurs et discipline budgétaire maintenue.',
                1_710_000,
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

function assertButtonsTouchTargets(container: HTMLElement): void {
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const btn of buttons) {
        const cls = btn.getAttribute('class') ?? '';
        expect(
            cls.includes('min-h-11') || cls.includes('touch-target'),
            `Bouton sans cible >= 44px : ${btn.textContent?.trim()}`,
        ).toBe(true);
    }
}

const initialStore = useFinanceStore.getState();

describe('FutureScenarioHeader (Bloc 1 Futur 4.0)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('affiche les 4 scénarios uniques avec aria-pressed, sélection interactive et zéro vieux contrôle technique', () => {
        const onSelectScenario = vi.fn();
        const { container } = render(
            <FutureScenarioHeader
                {...makeProps({
                    selectedScenario: 'ai_optimized',
                    onSelectScenario,
                })}
            />,
        );

        expect(
            screen.getByRole('region', { name: /Scénarios de trajectoire future/i }),
        ).toBeInTheDocument();

        const btnReal = screen.getByRole('button', { name: /Trajectoire réelle/i });
        const btnPrudent = screen.getByRole('button', { name: /Prudent \/ Stress/i });
        const btnAi = screen.getByRole('button', { name: /Optimisé IA/i });
        const btnFav = screen.getByRole('button', { name: /Favorable/i });

        expect(btnReal).toHaveAttribute('aria-pressed', 'false');
        expect(btnPrudent).toHaveAttribute('aria-pressed', 'false');
        expect(btnAi).toHaveAttribute('aria-pressed', 'true');
        expect(btnFav).toHaveAttribute('aria-pressed', 'false');

        // Gain affiché sur Optimisé IA (1 490 000 - 1 250 000 = +240 k$)
        expect(btnAi.textContent).toContain('240');
        // Badge Défaut sur Trajectoire réelle
        expect(btnReal.textContent).toContain('Défaut');

        // Clic déclenche onSelectScenario
        fireEvent.click(btnPrudent);
        expect(onSelectScenario).toHaveBeenCalledWith('prudent_stress');

        // Aucun vieux contrôle technique exposé dans l'en-tête
        expect(container.textContent).not.toMatch(/IQPF|Hybride|Pimenter|Grand Calcul/i);
        expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

        // Toutes les cibles >= 44 px
        assertButtonsTouchTargets(container);
    });

    it('affiche la barre de progression en mode running et permet d’annuler', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <FutureScenarioHeader
                {...makeProps({
                    status: 'running',
                    progress: {
                        phase: 'monte_carlo_100k',
                        phaseIndex: 3,
                        phaseTotal: 4,
                        phaseLabel: 'Simulation Monte Carlo',
                        percent: 64.4,
                        trajectoriesDone: 64_400,
                        trajectoriesTotal: 100_000,
                        etaSeconds: 12,
                    },
                    onCancel,
                })}
            />,
        );

        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(bar).toHaveAttribute('aria-valuenow', '64');
        expect(screen.getByRole('status')).toHaveTextContent(/Phase 3\/4 — Simulation Monte Carlo/);
        expect(container.textContent).toContain('ETA ~12 s');

        const cancelBtn = screen.getByRole('button', { name: /Annuler/i });
        fireEvent.click(cancelBtn);
        expect(onCancel).toHaveBeenCalledTimes(1);
        assertButtonsTouchTargets(container);
    });

    it('gère l’état staged (Appliquer et mémoriser / Ignorer) sans écraser avant confirmation', () => {
        const onApplyPending = vi.fn();
        const onDiscardPending = vi.fn();
        const pendingReport = makeReport({
            trajectoriesRun: 100_000,
            isDeepRun: true,
        });

        const { container } = render(
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

        expect(screen.getByText(/Nouvelle analyse prête/i)).toBeInTheDocument();
        expect(container.textContent).toMatch(/100\s000 trajectoires/);

        const applyBtn = screen.getByRole('button', { name: /Appliquer et mémoriser/i });
        const discardBtn = screen.getByRole('button', { name: /Ignorer/i });

        fireEvent.click(applyBtn);
        expect(onApplyPending).toHaveBeenCalledTimes(1);

        fireEvent.click(discardBtn);
        expect(onDiscardPending).toHaveBeenCalledTimes(1);
        assertButtonsTouchTargets(container);
    });

    it('affiche l’analyse en mémoire, le badge isOutdated et le bouton Relancer', () => {
        const onLaunch = vi.fn();
        const appliedReport = makeReport({
            trajectoriesRun: 100_000,
            isDeepRun: true,
        });

        render(
            <FutureScenarioHeader
                {...makeProps({
                    report: appliedReport,
                    appliedReport,
                    isOutdated: true,
                    onLaunch,
                })}
            />,
        );

        expect(screen.getByText(/Analyse profonde en mémoire/i)).toBeInTheDocument();
        expect(
            screen.getByText(/Données modifiées — tu peux relancer quand tu veux/i),
        ).toBeInTheDocument();

        const relaunchBtn = screen.getByRole('button', { name: /Relancer l’analyse profonde/i });
        fireEvent.click(relaunchBtn);
        expect(onLaunch).toHaveBeenCalledTimes(1);
    });

    it('affiche « — » (jamais 0 $) lorsque finalNetWorthP50 ou fiAge est absent/non fini, et gère error/unreadableStorage', () => {
        const incompleteReport = makeReport({
            scenarios: {
                real_trajectory: makeScenario('real_trajectory', 'Trajectoire réelle', 'Desc', null, null),
                prudent_stress: makeScenario('prudent_stress', 'Prudent / Stress', 'Desc', Number.NaN, Number.NaN),
                ai_optimized: makeScenario('ai_optimized', 'Optimisé IA', 'Desc', null, 56),
                favorable_tailwinds: makeScenario('favorable_tailwinds', 'Favorable', 'Desc', 900_000, null),
            },
        });

        const { container } = render(
            <FutureScenarioHeader
                {...makeProps({
                    report: incompleteReport,
                    unreadableStorage: true,
                    refusMessage: 'Salaire net invalide',
                })}
            />,
        );

        expect(container.textContent).not.toMatch(/\b0\s*\$/);
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(5);
        expect(screen.getByRole('alert')).toHaveTextContent(/Salaire net invalide/);
        expect(screen.getByRole('alert')).toHaveTextContent(/Sauvegarde locale chiffrée illisible/);
        expect(screen.getByRole('button', { name: /Lancer l’analyse profonde/i })).toBeDisabled();
    });

    it('masque tous les montants et âges en mode discret (isPrivacyMode = true)', () => {
        useFinanceStore.setState({ isPrivacyMode: true });
        const { container } = render(<FutureScenarioHeader {...makeProps()} />);

        const txt = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(txt).not.toContain('1,25');
        expect(txt).not.toContain('820');
        expect(txt).not.toContain('1,49');
        expect(txt).not.toContain('1,71');
        expect(txt).not.toContain('240');
        expect(txt).not.toContain('58 ans');
        expect(txt).not.toContain('55 ans');
        expect(txt).not.toContain('$');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(8);
    });

    it('passe l’audit d’accessibilité vitest-axe dans tous ses états (idle, running, staged, error)', async () => {
        const base = makeProps();
        const { container, rerender } = render(<FutureScenarioHeader {...base} />);
        expect(await axe(container)).toHaveNoViolations();

        rerender(
            <FutureScenarioHeader
                {...makeProps({
                    status: 'running',
                    progress: {
                        phase: 'past_audit',
                        phaseIndex: 1,
                        phaseTotal: 4,
                        phaseLabel: 'Audit du passé réel',
                        percent: 25,
                        trajectoriesDone: 0,
                        trajectoriesTotal: 100_000,
                        etaSeconds: 18,
                    },
                })}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();

        const pendingReport = makeReport({ trajectoriesRun: 100_000, isDeepRun: true });
        rerender(
            <FutureScenarioHeader
                {...makeProps({
                    report: pendingReport,
                    pendingReport,
                    status: 'staged',
                    hasPendingToApply: true,
                })}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();

        rerender(
            <FutureScenarioHeader
                {...makeProps({
                    status: 'error',
                    error: 'Calcul interrompu par manque de mémoire.',
                })}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();
    });
});
