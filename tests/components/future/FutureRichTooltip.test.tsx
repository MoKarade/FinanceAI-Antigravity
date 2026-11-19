/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { toHaveNoViolations } from 'vitest-axe/dist/matchers';
import {
    FutureRichTooltip,
    type FutureRichTooltipProps,
} from '../../../components/future/FutureRichTooltip';
import { PANNEAU_SECTIONS, PANNEAU_SECTION_IDS } from '../../../components/future/panneauSections';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { PointJour } from '../../../components/projection/panneauJour/sections';

declare module 'vitest' {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
        toHaveNoViolations(): R;
    }
}

expect.extend({ toHaveNoViolations });

function makePoint(overrides: Partial<PointJour> = {}): PointJour {
    return {
        monthIndex: 24,
        year: 2028,
        age: 42,
        dateLabel: '18 novembre 2028',
        NetWorth: 540_000,
        diffNW: 1_850,
        P10: 460_000,
        P50: 540_000,
        P90: 635_000,
        IncomeMarc: 4_800,
        Expenses: 3_100,
        Liquidites: 35_000,
        CELI: 145_000,
        REER: 360_000,
        isDailyPoint: true,
        dayIsReal: false,
        dayIsDated: true,
        dayLabels: ['Épicerie Boréale'],
        dayMovements: [
            { payee: 'Pharmacie Exemple', amount: -84 },
            { payee: 'Employeur Demo', amount: 2_400 },
        ],
        dayMovementsTotal: 2,
        ...overrides,
    };
}

function makeProps(overrides: Partial<FutureRichTooltipProps> = {}): FutureRichTooltipProps {
    return {
        point: makePoint(),
        isOpen: true,
        isPinned: false,
        origine: 'survol',
        anchorXRatio: 0.25,
        scenarioLabel: 'Trajectoire réelle',
        turningPointHint: null,
        userName1: 'Conjoint A',
        userName2: 'Conjoint B',
        onOpenDetail: vi.fn(),
        onStep: vi.fn(),
        pas: 'jour',
        onPasChange: vi.fn(),
        canStepPrev: true,
        canStepNext: true,
        onUnpin: vi.fn(),
        ...overrides,
    };
}

function assertButtonsTouchTargets(container: HTMLElement): void {
    const buttons = container.querySelectorAll('button');
    for (const btn of buttons) {
        const cls = btn.getAttribute('class') ?? '';
        expect(
            cls.includes('min-h-11') || cls.includes('touch-target'),
            `Bouton sans cible >= 44px : ${btn.textContent?.trim()}`,
        ).toBe(true);
    }
}

const initialStore = useFinanceStore.getState();

describe('FutureRichTooltip (Infobulle riche intégrée au graphique)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('retourne null au repos (!isOpen), si point null, ou si NetWorth est non fini', () => {
        const { container, rerender } = render(
            <FutureRichTooltip {...makeProps({ isOpen: false })} />,
        );
        expect(container.firstChild).toBeNull();
        expect(screen.queryByTestId('future-rich-tooltip')).toBeNull();

        rerender(<FutureRichTooltip {...makeProps({ isOpen: true, point: null })} />);
        expect(container.firstChild).toBeNull();

        rerender(
            <FutureRichTooltip
                {...makeProps({
                    isOpen: true,
                    point: makePoint({ NetWorth: Number.NaN }),
                })}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('rend l’aperçu au survol (data-pinned="false", pointer-events-none) positionné gauche/droite selon anchorXRatio', () => {
        const { rerender } = render(
            <FutureRichTooltip {...makeProps({ isPinned: false, anchorXRatio: 0.2 })} />,
        );

        const tooltip = screen.getByTestId('future-rich-tooltip');
        expect(tooltip).toHaveAttribute('data-pinned', 'false');
        expect(tooltip.className).toContain('pointer-events-none');
        expect(tooltip.className).toContain('sm:right-3');
        expect(tooltip.className).not.toContain('fixed');

        expect(tooltip.textContent).toContain('18 novembre 2028');
        expect(tooltip.textContent).toContain('Âge 42');
        expect(tooltip.textContent).toContain('Trajectoire réelle');
        expect(tooltip.textContent).toContain('Fourchette [P10, P90]');
        expect(tooltip.textContent).toContain('Cliquer pour épingler ce jour');

        rerender(<FutureRichTooltip {...makeProps({ isPinned: false, anchorXRatio: 0.8 })} />);
        expect(screen.getByTestId('future-rich-tooltip').className).toContain('sm:left-3');
    });

    it('rend le mode épinglé (data-pinned="true") avec les 4 sections de PANNEAU_SECTIONS dans l’ordre canonique', () => {
        const onStep = vi.fn();
        const onPasChange = vi.fn();
        const onOpenDetail = vi.fn();
        const onUnpin = vi.fn();

        const { container } = render(
            <FutureRichTooltip
                {...makeProps({
                    isPinned: true,
                    origine: 'epingle',
                    turningPointHint: 'Transition retraite prévue : activation RRQ et décaissement.',
                    onStep,
                    onPasChange,
                    onOpenDetail,
                    onUnpin,
                })}
            />,
        );

        const tooltip = screen.getByTestId('future-rich-tooltip');
        expect(tooltip).toHaveAttribute('data-pinned', 'true');
        expect(tooltip.className).toContain('pointer-events-auto');
        expect(tooltip.className).not.toContain('fixed');

        expect(screen.getByText('Jour épinglé')).toBeInTheDocument();
        expect(screen.getByText(/Point tournant/i)).toBeInTheDocument();
        expect(
            screen.getByText(/Transition retraite prévue : activation RRQ et décaissement/i),
        ).toBeInTheDocument();

        // Vérifie les 4 onglets dans l'ordre canonique de PANNEAU_SECTIONS
        expect(PANNEAU_SECTION_IDS).toEqual(['valeur', 'flux', 'comptes', 'mouvements']);
        const tabs = screen.getAllByRole('tab');
        expect(tabs.map((t) => t.textContent?.trim())).toEqual(
            PANNEAU_SECTIONS.map((s) => s.label),
        );

        // Par défaut : section Valeur nette active
        expect(screen.getByRole('tabpanel')).toHaveTextContent(/540\s000\s*\$/);

        // Navigation entre les 4 sections
        fireEvent.click(tabs[1]); // Entrées / sorties
        expect(screen.getByRole('tabpanel')).toHaveTextContent(/Paye Conjoint A/);

        fireEvent.click(tabs[2]); // Par compte
        expect(screen.getByRole('tabpanel')).toHaveTextContent(/REER/);

        fireEvent.click(tabs[3]); // Ce jour-là
        expect(screen.getByRole('tabpanel')).toHaveTextContent(/Pharmacie Exemple/);

        // Navigation Veille / Lendemain + pas + Détail complet + Fermer + Échap
        fireEvent.click(screen.getByRole('button', { name: /Veille/i }));
        expect(onStep).toHaveBeenCalledWith(-1, 'jour');

        fireEvent.click(screen.getByRole('button', { name: /Lendemain/i }));
        expect(onStep).toHaveBeenCalledWith(1, 'jour');

        fireEvent.click(screen.getByRole('button', { name: 'Mois' }));
        expect(onPasChange).toHaveBeenCalledWith('mois');

        fireEvent.click(screen.getByRole('button', { name: /Détail complet/i }));
        expect(onOpenDetail).toHaveBeenCalledTimes(1);

        fireEvent.keyDown(tooltip, { key: 'Escape' });
        expect(onUnpin).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /Fermer/i }));
        expect(onUnpin).toHaveBeenCalledTimes(2);

        assertButtonsTouchTargets(container);
    });

    it('masque la fourchette P10–P90, les montants, l’âge, les marchands (PrivateText) et le point tournant en mode discret', () => {
        useFinanceStore.setState({ isPrivacyMode: true });

        const { container } = render(
            <FutureRichTooltip
                {...makeProps({
                    isPinned: true,
                    origine: 'epingle',
                    turningPointHint: 'Retrait REER estimé à 25 000 $ cette année',
                })}
            />,
        );

        const textInitial = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(textInitial).not.toContain('460');
        expect(textInitial).not.toContain('635');
        expect(textInitial).not.toContain('540');
        expect(textInitial).not.toContain('Âge 42');
        expect(textInitial).not.toContain('25 000');
        expect(textInitial).not.toContain('$');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(3);
        expect(screen.getByText('Valeur masquée')).toBeInTheDocument();

        // Onglet Ce jour-là : les noms de marchands sont masqués via PrivateText
        fireEvent.click(screen.getByRole('tab', { name: 'Ce jour-là' }));
        const textMovements = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(textMovements).not.toContain('Pharmacie Exemple');
        expect(textMovements).not.toContain('Employeur Demo');
        expect(textMovements).not.toContain('84');
        expect(textMovements).not.toContain('2 400');
        expect(screen.getAllByText('Marchand masqué').length).toBeGreaterThanOrEqual(2);
    });

    it('n’invente jamais « 0 $ » pour les données absentes ou non finies (P10/P90, âge, flux, comptes)', () => {
        const sparsePoint = makePoint({
            age: Number.NaN,
            P10: undefined,
            P90: null,
            diffNW: undefined,
            IncomeMarc: undefined,
            Expenses: undefined,
            Liquidites: undefined,
            CELI: undefined,
            REER: undefined,
            dayMovements: undefined,
            dayLabels: undefined,
            dayIsDated: false,
            isDailyPoint: false,
        });

        const { container } = render(
            <FutureRichTooltip
                {...makeProps({
                    point: sparsePoint,
                    isPinned: true,
                    origine: 'epingle',
                })}
            />,
        );

        const text = (container.textContent || '').replace(/\u00a0/g, ' ');
        expect(text).not.toContain('Fourchette [P10, P90]');
        expect(text).not.toMatch(/\b0\s*\$/);
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(1);
    });

    it('passe l’audit d’accessibilité vitest-axe en mode survol et en mode épinglé sur tous les onglets', async () => {
        const { container, rerender } = render(
            <FutureRichTooltip {...makeProps({ isPinned: false })} />,
        );
        expect(await axe(container)).toHaveNoViolations();

        rerender(
            <FutureRichTooltip
                {...makeProps({
                    isPinned: true,
                    origine: 'epingle',
                    turningPointHint: 'Jalon d’indépendance financière atteint.',
                })}
            />,
        );
        expect(await axe(container)).toHaveNoViolations();

        const tabs = screen.getAllByRole('tab');
        for (const tab of tabs) {
            fireEvent.click(tab);
            expect(await axe(container)).toHaveNoViolations();
        }
    });
});
