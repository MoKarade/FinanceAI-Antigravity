/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GrandCalculPanel, type GrandCalculPanelProps } from '../../../components/future/GrandCalculPanel';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { GrandCalculResult } from '../../../services/projection/types';

const sampleResult: GrandCalculResult = {
    version: 1,
    paramsSig: 'gc1:abc:def:10',
    createdAt: '2026-11-17T00:00:00Z',
    durationMs: 2_500,
    iterationsRun: 75_000,
    regimesEnabled: true,
    historicalCrisesEnabled: false,
    survivalRatePct: 91.5,
    cvar95: 140_000,
    monthlyBands: [
        { monthIndex: 0, year: 2026, age: 35, p5: 100_000, p10: 110_000, p25: 125_000, p50: 140_000, p75: 155_000, p90: 170_000, p95: 185_000 },
    ],
    fiAge: { reachedPct: 85, p5Age: 52, p50Age: 58, p95Age: 66, horizonAge: 90 },
    goalProbabilities: [],
    guaranteedPurchasingPower: {
        p95SecurityMonthlyNetReal: 3_000,
        p90SecurityMonthlyNetReal: 3_400,
        p50SecurityMonthlyNetReal: 4_200,
        retirementMonthsEvaluated: 240,
    },
    estateTax: {
        deterministicTotal: 60_000,
        deterministicFed: 25_000,
        deterministicQc: 35_000,
        mcTotalP5: 30_000,
        mcTotalP50: 62_000,
        mcTotalP95: 110_000,
        mcFedP50: 26_000,
        mcQcP50: 36_000,
        mcRealTotalP50: 42_000,
        taxableBreakdown: { rrspRrif: 150_000, capitalGainsTaxable: 20_000, rentalRecapture: 0 },
        projectedDeathAge: 90,
    },
};

function makeProps(overrides: Partial<GrandCalculPanelProps> = {}): GrandCalculPanelProps {
    return {
        result: null,
        status: 'idle',
        progress: null,
        error: null,
        config: {
            iterations: 50_000,
            enableMacroRegimes: true,
            includeHistoricalCrises: true,
        },
        onUpdateConfig: vi.fn(),
        isStale: false,
        showBands: true,
        onToggleBands: vi.fn(),
        onLaunch: vi.fn(),
        onCancel: vi.fn(),
        onClear: vi.fn(),
        isRunning: false,
        isRestoring: false,
        refusMessage: null,
        ...overrides,
    };
}

const initialStore = useFinanceStore.getState();

describe('GrandCalculPanel (R1)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('rend une région sémantique avec valeurs « — » avant tout calcul (no-fake-data) et sans « survie »', () => {
        const { container } = render(<GrandCalculPanel {...makeProps()} />);

        expect(screen.getByRole('region', { name: /Grand Calcul/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Lancer le Grand Calcul/i })).toBeEnabled();
        expect(screen.queryByRole('button', { name: /Annuler/i })).not.toBeInTheDocument();
        expect(screen.queryByText(/0\s*%/)).not.toBeInTheDocument();
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(2);
        expect(container.textContent).not.toMatch(/survie/i);
    });

    it('expose des interrupteurs role="switch" >= 44px pour les régimes macroéconomiques et crises historiques', () => {
        const onUpdateConfig = vi.fn();
        render(<GrandCalculPanel {...makeProps({ onUpdateConfig })} />);

        const switchRegimes = screen.getByRole('switch', { name: /Régimes macroéconomiques/i });
        const switchCrises = screen.getByRole('switch', { name: /Crises historiques/i });

        expect(switchRegimes).toHaveAttribute('aria-checked', 'true');
        expect(switchCrises).toHaveAttribute('aria-checked', 'true');
        expect(switchRegimes.className).toContain('touch-target');
        expect(switchRegimes.className).toContain('min-h-11');
        expect(switchCrises.className).toContain('touch-target');
        expect(switchCrises.className).toContain('min-h-11');

        fireEvent.click(switchRegimes);
        expect(onUpdateConfig).toHaveBeenCalledWith({ enableMacroRegimes: false });

        fireEvent.click(switchCrises);
        expect(onUpdateConfig).toHaveBeenCalledWith({ includeHistoricalCrises: false });
    });

    it('borne les trajectoires entre 50 000 et 100 000 au blur et supporte les préréglages', () => {
        const onUpdateConfig = vi.fn();
        render(
            <GrandCalculPanel
                {...makeProps({
                    config: {
                        iterations: 75_000,
                        enableMacroRegimes: true,
                        includeHistoricalCrises: true,
                    },
                    onUpdateConfig,
                })}
            />,
        );

        const input = screen.getByRole('spinbutton', { name: /Nombre de trajectoires/i }) as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1000' } });
        fireEvent.blur(input);
        expect(input.value).toBe('50000');
        expect(onUpdateConfig).toHaveBeenCalledWith({ iterations: 50_000 });

        fireEvent.change(input, { target: { value: '500000' } });
        fireEvent.blur(input);
        expect(input.value).toBe('100000');
        expect(onUpdateConfig).toHaveBeenCalledWith({ iterations: 100_000 });

        fireEvent.change(input, { target: { value: '' } });
        fireEvent.blur(input);
        expect(input.value).toBe('50000');
        expect(onUpdateConfig).toHaveBeenCalledWith({ iterations: 50_000 });

        fireEvent.click(screen.getByRole('button', { name: /100\s*000/ }));
        expect(onUpdateConfig).toHaveBeenCalledWith({ iterations: 100_000 });
    });

    it('n’affiche pas « régimes activés » ni « crises activées » lorsque désactivés', () => {
        const disabledResult: GrandCalculResult = {
            ...sampleResult,
            regimesEnabled: false,
            historicalCrisesEnabled: false,
        };
        const { container } = render(
            <GrandCalculPanel
                {...makeProps({
                    result: disabledResult,
                    status: 'ready',
                    config: {
                        iterations: 75_000,
                        enableMacroRegimes: false,
                        includeHistoricalCrises: false,
                    },
                })}
            />,
        );

        expect(container.textContent).not.toMatch(/régimes activés|crises activées/i);
    });

    it('affiche la barre de progression et la télémétrie en cours d’exécution et masque le lancement', () => {
        const onCancel = vi.fn();
        render(
            <GrandCalculPanel
                {...makeProps({
                    isRunning: true,
                    status: 'running',
                    progress: { done: 30_000, total: 50_000, pct: 60, simPerSec: 15_000, etaMs: 2_000 },
                    onCancel,
                })}
            />,
        );

        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '60');
        expect(bar).toHaveAttribute('aria-valuemin', '0');
        expect(bar).toHaveAttribute('aria-valuemax', '100');
        expect(screen.getByRole('status')).toHaveTextContent(/60\s*%.*sim\/s.*ETA/i);
        expect(screen.getByRole('button', { name: /Lancer le Grand Calcul/i })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: /Annuler/i }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('affiche le badge obsolète et masque les montants en mode discret', () => {
        useFinanceStore.setState({ isPrivacyMode: true });
        const { container } = render(
            <GrandCalculPanel
                {...makeProps({
                    result: sampleResult,
                    status: 'ready',
                    isStale: true,
                })}
            />,
        );

        expect(screen.getByRole('status')).toHaveTextContent(/Paramètres modifiés/i);
        expect(container.textContent).not.toContain('91,5');
        expect(container.textContent).not.toContain('140');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(2);
    });

    it('affiche les erreurs dans role="alert"', () => {
        render(
            <GrandCalculPanel
                {...makeProps({
                    status: 'error',
                    error: 'Erreur lors du Grand Calcul : Worker indisponible',
                })}
            />,
        );

        expect(screen.getByRole('alert')).toHaveTextContent(/Worker indisponible/i);
    });

    it('désactive Relancer et Effacer et annonce la sauvegarde locale pendant isSaving', () => {
        render(
            <GrandCalculPanel
                {...makeProps({
                    result: sampleResult,
                    status: 'ready',
                    isSaving: true,
                })}
            />,
        );

        expect(screen.getByRole('button', { name: /Relancer le Grand Calcul/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Effacer les résultats/i })).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent(/Sauvegarde locale en cours/i);
    });

    it('borne progress.pct non fini (NaN) sans émettre NaN % ni aria-valuenow="NaN"', () => {
        render(
            <GrandCalculPanel
                {...makeProps({
                    isRunning: true,
                    status: 'running',
                    progress: { done: 0, total: 50_000, pct: Number.NaN, simPerSec: null, etaMs: null },
                })}
            />,
        );

        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '0');
        const fill = bar.firstElementChild as HTMLElement;
        expect(fill.style.width).toBe('0%');
        expect(screen.getByRole('status')).toHaveTextContent(/^0\s*%/);
        expect(screen.getByRole('status').textContent).not.toContain('NaN');
    });

    it('borne et transmet iterDraft sale au clic sur Lancer sans blur préalable, gère refusMessage, onClear et onToggleBands', () => {
        const onUpdateConfig = vi.fn();
        const onLaunch = vi.fn();
        const onClear = vi.fn();
        const onToggleBands = vi.fn();

        const { rerender } = render(
            <GrandCalculPanel
                {...makeProps({
                    config: { iterations: 75_000, enableMacroRegimes: true, includeHistoricalCrises: true },
                    onUpdateConfig,
                    onLaunch,
                })}
            />,
        );

        // Saisie hors-plage sans blur -> clic direct sur Lancer borne à 50_000
        const input = screen.getByRole('spinbutton', { name: /Nombre de trajectoires/i }) as HTMLInputElement;
        fireEvent.change(input, { target: { value: '1000' } });
        fireEvent.click(screen.getByRole('button', { name: /Lancer le Grand Calcul/i }));
        expect(input.value).toBe('50000');
        expect(onUpdateConfig).toHaveBeenCalledWith({ iterations: 50_000 });
        expect(onLaunch).toHaveBeenCalledWith({ iterations: 50_000 });

        // Saisie > max sans blur -> clic direct sur Lancer borne à 100_000
        fireEvent.change(input, { target: { value: '500000' } });
        fireEvent.click(screen.getByRole('button', { name: /Lancer le Grand Calcul/i }));
        expect(input.value).toBe('100000');
        expect(onLaunch).toHaveBeenLastCalledWith({ iterations: 100_000 });

        // refusMessage désactive le bouton Lancer
        rerender(<GrandCalculPanel {...makeProps({ refusMessage: 'Salaire net invalide' })} />);
        expect(screen.getByRole('button', { name: /Lancer le Grand Calcul/i })).toBeDisabled();

        // onClear et onToggleBands déclenchent leurs callbacks
        rerender(
            <GrandCalculPanel
                {...makeProps({
                    result: sampleResult,
                    status: 'ready',
                    showBands: true,
                    onClear,
                    onToggleBands,
                })}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Afficher les bandes P5–P95 sur la courbe/i }));
        expect(onToggleBands).toHaveBeenCalledWith(false);
        fireEvent.click(screen.getByRole('button', { name: /Effacer les résultats/i }));
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('formate correctement les bornes formatEta et formatDurationMs', () => {
        const { rerender } = render(
            <GrandCalculPanel
                {...makeProps({
                    isRunning: true,
                    status: 'running',
                    progress: { done: 10_000, total: 50_000, pct: 20, simPerSec: 1_000, etaMs: 95_000 },
                })}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(/ETA ~1 min 35 s/);

        rerender(
            <GrandCalculPanel
                {...makeProps({
                    isRunning: true,
                    status: 'running',
                    progress: { done: 10_000, total: 50_000, pct: 20, simPerSec: null, etaMs: -1 },
                })}
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(/ETA —/);

        rerender(
            <GrandCalculPanel
                {...makeProps({
                    result: { ...sampleResult, durationMs: 450 },
                    status: 'ready',
                })}
            />,
        );
        expect(screen.getByText(/Durée : 450 ms/)).toBeInTheDocument();

        rerender(
            <GrandCalculPanel
                {...makeProps({
                    result: { ...sampleResult, durationMs: 125_000 },
                    status: 'ready',
                })}
            />,
        );
        expect(screen.getByText(/Durée : 2 min 5 s/)).toBeInTheDocument();

        rerender(
            <GrandCalculPanel
                {...makeProps({
                    result: { ...sampleResult, durationMs: Number.NaN },
                    status: 'ready',
                })}
            />,
        );
        expect(screen.getByText(/Durée : —/)).toBeInTheDocument();
    });
});
