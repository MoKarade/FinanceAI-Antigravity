import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { Layout } from '../../components/Layout';
import { useFinanceStore } from '../../store/useFinanceStore';
import { Tab } from '../../types';
import { TAB_LABELS } from '../../constants';

const initialState = useFinanceStore.getState();

beforeEach(() => {
    useFinanceStore.setState(initialState, true);
});

const baseProps = {
    activeTab: Tab.FUTURE,
    setActiveTab: vi.fn(),
    lastUpdate: Date.now(),
    isLoading: false,
    isPrivacyMode: false,
    togglePrivacyMode: vi.fn(),
    netWorth: 100000,
    children: <main data-testid="content">child content</main>,
};

describe('Layout', () => {
    it('rend les children dans le main', () => {
        render(<Layout {...baseProps} />);
        expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('a11y §7.A.1 — skip link "Aller au contenu principal" présent', () => {
        render(<Layout {...baseProps} />);
        const skip = screen.getByText('Aller au contenu principal');
        expect(skip).toBeInTheDocument();
        expect(skip.getAttribute('href')).toBe('#main');
    });

    it('a11y — <main id="main"> avec tabIndex pour cible du skip link', () => {
        const { container } = render(<Layout {...baseProps} />);
        const main = container.querySelector('main#main');
        expect(main).not.toBeNull();
        expect(main?.getAttribute('tabIndex')).toBe('-1');
    });

    it('[A11Y-ROUTE-FOCUS] changer d\'onglet déplace le focus vers le contenu ET l\'annonce', () => {
        const { container, rerender } = render(<Layout {...baseProps} activeTab={Tab.FUTURE} />);
        const main = container.querySelector('main#main') as HTMLElement;
        const region = container.querySelector('[role="status"][aria-live="polite"]') as HTMLElement;

        expect(region).toBeTruthy();
        expect(region.textContent).toBe('');
        expect(document.activeElement).not.toBe(main);

        rerender(<Layout {...baseProps} activeTab={Tab.BUDGET} />);
        expect(document.activeElement).toBe(main);
        expect(region.textContent).toBe(TAB_LABELS[Tab.BUDGET]);

        const boutonNav = screen.getAllByRole('button')[0];
        boutonNav.focus();
        rerender(<Layout {...baseProps} activeTab={Tab.BUDGET} />);
        expect(document.activeElement).toBe(boutonNav);
    });

    it('a11y — le brand « FinanceAI » n\'est PAS un titre (le <h1> est réservé au titre de page)', () => {
        render(<Layout {...baseProps} />);
        expect(screen.getAllByText('FinanceAI').length).toBeGreaterThan(0);
        expect(screen.queryByRole('heading', { name: 'FinanceAI' })).toBeNull();
    });

    it('§B.4 — bouton Synchroniser retiré (doc directives §1)', () => {
        render(<Layout {...baseProps} />);
        expect(screen.queryByLabelText('Synchroniser')).toBeNull();
    });

    it('§B.4 — bouton info ℹ️ retiré (doc directives §1)', () => {
        render(<Layout {...baseProps} />);
        expect(screen.queryByLabelText('Guide du Pilote')).toBeNull();
    });

    it('bouton privacy mode toggle expose aria-pressed (desktop + mobile)', () => {
        const toggle = vi.fn();
        const { rerender } = render(<Layout {...baseProps} togglePrivacyMode={toggle} isPrivacyMode={false} />);
        const offButtons = screen.getAllByLabelText('Activer le mode discret');
        expect(offButtons.length).toBeGreaterThanOrEqual(1);
        offButtons.forEach(b => expect(b.getAttribute('aria-pressed')).toBe('false'));
        fireEvent.click(offButtons[0]);
        expect(toggle).toHaveBeenCalled();
        rerender(<Layout {...baseProps} togglePrivacyMode={toggle} isPrivacyMode={true} />);
        const onButtons = screen.getAllByLabelText('Quitter le mode discret');
        onButtons.forEach(b => expect(b.getAttribute('aria-pressed')).toBe('true'));
    });

    it('sidebar items utilisent aria-current="page" pour le tab actif', () => {
        render(<Layout {...baseProps} activeTab={Tab.FUTURE} />);
        const buttons = screen.getAllByRole('button');
        const activeButtons = buttons.filter(b => b.getAttribute('aria-current') === 'page');
        expect(activeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('navigation mobile expose aria-label "Navigation mobile"', () => {
        render(<Layout {...baseProps} />);
        expect(screen.getByRole('navigation', { name: 'Navigation mobile' })).toBeInTheDocument();
    });

    it('§B.1 (révisé audit #598) — l’aside n’a PLUS aria-expanded (non conforme au rôle complementary)', () => {
        const { container } = render(<Layout {...baseProps} />);
        const sidebar = container.querySelector('aside');
        expect(sidebar?.hasAttribute('aria-expanded')).toBe(false);
    });

    it('[ETAPE-4] barre latérale courte : 2 groupes (Essentiel / Plus) et 8 destinations claires', () => {
        const { container } = render(<Layout {...baseProps} />);
        const aside = container.querySelector('aside')!;
        expect(aside.className).toContain('w-[232px]');
        const nav = within(aside).getByRole('navigation', { name: 'Navigation principale' });
        const textes = within(nav).getAllByRole('button').map((b) => b.textContent?.trim());
        expect(textes).toEqual(['Accueil', 'Futur', 'Transactions', 'Budget', 'Dettes', 'Placements', 'Planification', 'Réglages']);
        for (const titre of ['Essentiel', 'Plus']) expect(within(nav).getByText(titre)).toBeInTheDocument();
        expect(within(nav).queryAllByRole('button').some((b) => b.hasAttribute('aria-expanded'))).toBe(false);
    });

    it('[ETAPE-4] tous les onglets Planification activent « Planification » dans le menu latéral', () => {
        const { container } = render(<Layout {...baseProps} activeTab={Tab.REAL_ESTATE_PROJECTS} />);
        const nav = within(container.querySelector('aside')!).getByRole('navigation', { name: 'Navigation principale' });
        expect(within(nav).getByText('Planification').getAttribute('aria-current')).toBe('page');
    });

    it('la carte Profil (pied de barre) ouvre le Profil', () => {
        const setActiveTab = vi.fn();
        const { container } = render(<Layout {...baseProps} setActiveTab={setActiveTab} />);
        const aside = container.querySelector('aside')!;
        fireEvent.click(within(aside).getByRole('button', { name: /Profil/ }));
        expect(setActiveTab).toHaveBeenCalledWith(Tab.PROFILE);
    });

    it('non-perte mobile : chaque onglet est atteignable via la barre OU le menu « Plus » — scoped AU menu', () => {
        const setActiveTab = vi.fn();
        render(<Layout {...baseProps} setActiveTab={setActiveTab} />);
        const mobileNav = screen.getByRole('navigation', { name: 'Navigation mobile' });
        for (const label of ['Accueil', 'Futur', 'Transactions', 'Budget']) {
            expect(within(mobileNav).getByText(label)).toBeInTheDocument();
        }
        fireEvent.click(within(mobileNav).getByRole('button', { name: "Plus d'options" }));
        const menu = screen.getByRole('navigation', { name: 'Autres destinations' });
        for (const label of ['Dettes', 'Placements', 'Retraite', 'Immobilier', 'Enfants', 'Projets de vie', 'Impôts', 'Réglages']) {
            const btns = within(menu).getAllByRole('button').filter(b => b.textContent?.replace('›', '').trim() === label);
            expect(btns.length, `« ${label} » = un bouton du menu`).toBe(1);
        }
        fireEvent.click(within(menu).getByText('Dettes'));
        expect(setActiveTab).toHaveBeenCalledWith(Tab.DEBT);
    });

    it('menu « Plus » : le Profil y est, Échap le referme', () => {
        const setActiveTab = vi.fn();
        render(<Layout {...baseProps} setActiveTab={setActiveTab} />);
        fireEvent.click(screen.getByRole('button', { name: "Plus d'options" }));
        expect(screen.getByRole('heading', { name: 'Plus' })).toBeInTheDocument();
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(screen.queryByRole('navigation', { name: 'Autres destinations' })).toBeNull();
    });

    it('mobile : les pages hors barre du bas remontent vers « Plus »', () => {
        const { rerender } = render(<Layout {...baseProps} activeTab={Tab.FUTURE} />);
        expect(screen.queryByText('‹ Plus')).toBeNull();
        rerender(<Layout {...baseProps} activeTab={Tab.DEBT} />);
        fireEvent.click(screen.getByText('‹ Plus'));
        expect(screen.getByRole('navigation', { name: 'Autres destinations' })).toBeInTheDocument();
    });

    it('l\'Accueil apparaît en tête de la navigation latérale et mobile', () => {
        const { container } = render(<Layout {...baseProps} />);
        const aside = container.querySelector('aside')!;
        expect(within(aside).getByRole('button', { name: 'Accueil' })).toBeInTheDocument();
        expect(screen.getAllByText('Accueil').length).toBeGreaterThanOrEqual(1);
    });

    it('[ETAPE-4] mode solo par défaut (badge couple masqué en solo, visible quand conjoint défini)', () => {
        useFinanceStore.setState({
            config: {
                ...initialState.config,
                users: [
                    { ...initialState.config.users[0], name: 'Marc' },
                    { ...initialState.config.users[1], name: '' },
                ],
            },
        });
        const { container, rerender } = render(<Layout {...baseProps} />);
        const aside = container.querySelector('aside')!;
        expect(within(aside).queryByLabelText(/Mode Couple actif/)).toBeNull();
        expect(within(aside).queryByLabelText(/Mode Individuel actif/)).toBeNull();

        useFinanceStore.setState({
            config: {
                ...initialState.config,
                users: [
                    { ...initialState.config.users[0], name: 'Marc' },
                    { ...initialState.config.users[1], name: 'Sam' },
                ],
            },
        });
        rerender(<Layout {...baseProps} />);
        expect(within(aside).getByLabelText('Mode Couple actif')).toBeInTheDocument();
    });
});
