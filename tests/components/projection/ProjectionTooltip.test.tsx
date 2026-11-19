// Bloc « Impôts », navigation quotidienne, accessibilité clavier et dette réductrice
// dans `FutureRichTooltip` + `ClickableEventIcon`.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderPanneauJour, type OptionsPanneauJour } from '../../helpers/panneauJour';
import type { ProjectionChartPoint } from '../../../services/projection/types';
import { ClickableEventIcon } from '../../../components/projection/ProjectionTooltip';

const pt = (over: Partial<ProjectionChartPoint>): ProjectionChartPoint => ({
    monthIndex: 0,
    dateLabel: 'janv. 2030',
    age: 40,
    NetWorth: 500000,
    ...over,
} as ProjectionChartPoint);

const renderTip = (over: Partial<ProjectionChartPoint>, opts: OptionsPanneauJour = {}) =>
    renderPanneauJour(pt(over), opts);

describe('FutureRichTooltip — bloc Impôts (impôt dormant + régularisation)', () => {
    it("affiche l'impôt dormant en valeur ABSOLUE (ImpotLatent est négatif dans le moteur)", () => {
        renderTip({ ImpotLatent: -50000 }, { defaultSection: 'flux' });
        expect(screen.getByText('Impôts')).toBeInTheDocument();
        const row = screen.getByText(/Impôt dormant/).parentElement;
        expect(row).toBeTruthy();
        expect(row?.textContent).not.toContain('-');
        expect(row?.textContent).toContain('50');
    });

    it('régularisation positive = solde à payer (libellé « avril », signe −)', () => {
        renderTip({ FluxImpots: 1200 }, { defaultSection: 'flux' });
        const row = screen.getByText(/Solde d'impôt \(avril\)/).parentElement;
        expect(row?.textContent).toContain('-');
        expect(screen.queryByText(/Remboursement d'impôt/)).toBeNull();
    });

    it('régularisation négative = remboursement (signe +)', () => {
        renderTip({ FluxImpots: -800 }, { defaultSection: 'flux' });
        const row = screen.getByText(/Remboursement d'impôt/).parentElement;
        expect(row?.textContent).toContain('+');
        expect(screen.queryByText(/Solde d'impôt/)).toBeNull();
    });

    it('aucun bloc Impôts quand dormant et régularisation sont nuls/absents', () => {
        renderTip({ ImpotLatent: 0, FluxImpots: 0 }, { defaultSection: 'flux' });
        expect(screen.queryByText('Impôts')).toBeNull();
    });

    it('les deux lignes coexistent (dormant + régularisation au même point)', () => {
        renderTip({ ImpotLatent: -120000, FluxImpots: 3400 }, { defaultSection: 'flux' });
        expect(screen.getByText(/Impôt dormant/)).toBeInTheDocument();
        expect(screen.getByText(/Solde d'impôt \(avril\)/)).toBeInTheDocument();
    });
});

const dayPoint = (over: Partial<ProjectionChartPoint> & {
    isDailyPoint?: boolean; dayLabels?: string[]; dayIsDated?: boolean;
}) => pt(over as Partial<ProjectionChartPoint>);

describe('FutureRichTooltip — point QUOTIDIEN sélectionné (onglet « Ce jour-là »)', () => {
    it('nomme les mouvements du jour visé', () => {
        renderPanneauJour(
            dayPoint({ isDailyPoint: true, dayIsDated: true, dayLabels: ['Paie', 'Loyer'] }),
            { defaultSection: 'mouvements' },
        );
        expect(screen.getByText('Ce jour')).toBeInTheDocument();
        expect(screen.getByText('Paie, Loyer')).toBeInTheDocument();
    });

    it("dit explicitement qu'un jour SANS mouvement daté n'est que de l'étalement", () => {
        renderPanneauJour(
            dayPoint({ isDailyPoint: true, dayIsDated: false, dayLabels: [] }),
            { defaultSection: 'mouvements' },
        );
        const ligne = screen.getByText(/croissance étalée/);
        expect(ligne).toBeInTheDocument();
        expect(ligne.getAttribute('title')).toMatch(/croissance, répartie sur le mois/);
        expect(screen.queryByText('Ce jour')).toBeNull();
    });

    it("un jour DATÉ sans libellé le dit quand même (un DatedDelta peut n'avoir aucun label)", () => {
        renderPanneauJour(
            dayPoint({ isDailyPoint: true, dayIsDated: true, dayLabels: [] }),
            { defaultSection: 'mouvements' },
        );
        expect(screen.getByText('Ce jour')).toBeInTheDocument();
        expect(screen.getByText('Mouvement à date connue')).toBeInTheDocument();
    });

    it("aucun bloc « jour » sur un point MENSUEL (l'immense majorité des survols)", () => {
        renderTip({}, { defaultSection: 'mouvements' });
        expect(screen.queryByText('Ce jour')).toBeNull();
        expect(screen.queryByText(/croissance étalée/)).toBeNull();
    });
});

describe('FutureRichTooltip — états Aperçu / Jour épinglé / Fermé', () => {
    it('au SURVOL : affiche « Aperçu » (pointer-events-none) et invite à cliquer pour épingler', () => {
        renderTip({}, { origine: 'survol' });
        const tooltip = screen.getByTestId('future-rich-tooltip');
        expect(tooltip).toHaveAttribute('data-pinned', 'false');
        expect(tooltip.className).toContain('pointer-events-none');
        expect(screen.getByText('Aperçu')).toBeInTheDocument();
        expect(screen.getByText('Cliquer pour épingler ce jour')).toBeInTheDocument();
    });

    it('ÉPINGLÉ : affiche « Jour épinglé », « Détail complet » et « Fermer » pour désépingler', () => {
        const onOpenDetail = vi.fn();
        const onRelease = vi.fn();
        renderTip({}, { origine: 'epingle', onOpenDetail, onRelease });

        expect(screen.getByText('Jour épinglé')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Détail complet/ }));
        expect(onOpenDetail).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /Fermer/ }));
        expect(onRelease).toHaveBeenCalledTimes(1);
    });

    it('AU REPOS (!isOpen) : rien n’est rendu (pas de bouton Fermer ni d’infobulle superposée)', () => {
        const { container } = renderTip({}, { isOpen: false });
        expect(container.firstChild).toBeNull();
        expect(screen.queryByRole('button', { name: /Fermer/ })).toBeNull();
    });
});

describe('FutureRichTooltip — badge « Variation » : une absence n’est pas un zéro', () => {
    it('MASQUE le badge quand la variation est inconnue', () => {
        renderTip({ diffNW: undefined }, { defaultSection: 'valeur' });
        expect(screen.queryByText(/Variation/)).toBeNull();
    });

    it('affiche un vrai zéro quand la variation VAUT zéro', () => {
        renderTip({ diffNW: 0 }, { defaultSection: 'valeur' });
        expect(screen.getByText(/Variation/)).toBeInTheDocument();
    });

    it('affiche la variation du JOUR sur un point quotidien qui en porte une', () => {
        renderTip({ diffNW: -1250 }, { defaultSection: 'valeur' });
        const badge = screen.getByText(/Variation/);
        expect(badge.textContent).toContain('-1');
        expect(badge.className).toContain('text-erreur-texte');
    });
});

describe('FutureRichTooltip — navigation d’un jour à l’autre', () => {
    it('le bouton « Voir ce mois jour par jour » n\'existe PLUS (courbe au jour native)', () => {
        renderTip({});
        expect(screen.queryByRole('button', { name: /Voir ce mois jour par jour/ })).toBeNull();
    });

    it('les flèches Veille / Lendemain transmettent la direction et le pas courant', () => {
        const onStep = vi.fn();
        renderPanneauJour(dayPoint({ isDailyPoint: true }), { origine: 'epingle', onStep });
        fireEvent.click(screen.getByRole('button', { name: /Veille/ }));
        fireEvent.click(screen.getByRole('button', { name: /Lendemain/ }));
        expect(onStep).toHaveBeenNthCalledWith(1, -1, 'jour');
        expect(onStep).toHaveBeenNthCalledWith(2, 1, 'jour');
    });

    it('le PAS choisi est transmis aux flèches (jour / mois / année)', () => {
        const onStep = vi.fn();
        renderPanneauJour(dayPoint({ isDailyPoint: true }), { onStep, pas: 'annee' });
        fireEvent.click(screen.getByRole('button', { name: /Lendemain/ }));
        expect(onStep).toHaveBeenCalledWith(1, 'annee');
    });

    it('changer de pas remonte le choix au parent', () => {
        const onPasChange = vi.fn();
        renderPanneauJour(dayPoint({ isDailyPoint: true }), { onPasChange });
        fireEvent.click(screen.getByRole('button', { name: 'Mois' }));
        expect(onPasChange).toHaveBeenCalledWith('mois');
    });

    it('borne atteinte = bouton DÉSACTIVÉ (pas absent)', () => {
        renderPanneauJour(dayPoint({ isDailyPoint: true }), { canStepPrev: false, canStepNext: true });
        expect(screen.getByRole('button', { name: /Veille/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: /Lendemain/ })).toBeEnabled();
    });
});

describe('FutureRichTooltip — barre d’actions fixe en haut, corps défilant en dessous', () => {
    it('le bloc d’actions [data-tooltip-actions] ne borne pas sa hauteur (zéro max-h- ni overflow-y-auto)', () => {
        const { container } = renderTip({}, { origine: 'epingle' });
        const actions = container.querySelector('[data-tooltip-actions]');
        expect(actions).not.toBeNull();
        expect(actions!.className).not.toMatch(/max-h-/);
        expect(actions!.className).not.toMatch(/overflow-y-auto/);
        expect(actions!.className).toContain('shrink-0');

        const racine = screen.getByTestId('future-rich-tooltip');
        expect(racine.className).toContain('flex-col');
        expect(racine.className).not.toContain('overflow-y-auto');
    });

    it('les actions sont rendues en mode épinglé et le corps des onglets porte flex-1 min-h-0 overflow-y-auto', () => {
        const { container } = renderTip({}, { origine: 'epingle' });
        expect(screen.getByRole('button', { name: /Détail complet/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Fermer/ })).toBeInTheDocument();
        const scrollableBody = container.querySelector('.flex-1.min-h-0.overflow-y-auto');
        expect(scrollableBody).not.toBeNull();
    });
});

describe('ClickableEventIcon — clavier (A11Y-FUTUR-MILESTONES-KEYBOARD)', () => {
    const renderIcon = (onSelect = vi.fn()) => {
        const { container } = render(
            <svg>
                <ClickableEventIcon
                    cx={100} cy={50}
                    payload={{ label: '✈️ Voyage (Rome): -4 000$', subIdx: 0, dateLabel: 'sept. 2031' }}
                    onSelect={onSelect}
                    kind="life"
                />
            </svg>,
        );
        const g = container.querySelector('g[role="button"]')!;
        return { g, onSelect };
    };

    it('est FOCUSABLE (tabIndex 0) avec un aria-label DATÉ', () => {
        const { g } = renderIcon();
        expect(g.getAttribute('tabindex')).toBe('0');
        expect(g.getAttribute('aria-label')).toBe('Événement : ✈️ Voyage (Rome): -4 000$ — sept. 2031');
    });

    it('Entrée et Espace déclenchent onSelect (même action que le clic), pas les autres touches', () => {
        const { g, onSelect } = renderIcon();
        fireEvent.keyDown(g, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledTimes(1);
        fireEvent.keyDown(g, { key: ' ' });
        expect(onSelect).toHaveBeenCalledTimes(2);
        fireEvent.keyDown(g, { key: 'Tab' });
        fireEvent.keyDown(g, { key: 'Escape' });
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('porte l’anneau de focus SVG (cercle .event-focus-ring, opacité 0 au repos)', () => {
        const { g } = renderIcon();
        const ring = g.querySelector('.event-focus-ring')!;
        expect(ring).toBeTruthy();
        expect(ring.getAttribute('opacity')).toBe('0');
    });

    it('sans dateLabel (payload restauré/ancien) : label honnête sans tiret pendouillant', () => {
        const { container } = render(
            <svg>
                <ClickableEventIcon cx={10} cy={10} payload={{ label: 'Jalon' }} onSelect={vi.fn()} />
            </svg>,
        );
        expect(container.querySelector('g[role="button"]')!.getAttribute('aria-label')).toBe('Événement : Jalon');
    });
});

describe('[DETTE-INVISIBLE-INFOBULLE] la dette qui manquait à la répartition', () => {
    const SON_POINT = {
        Liquidites: 21_350, CELI: 12_480, REER: 16_220, NonReg: 162_730,
        NetWorth: 175_410,
    } as Partial<ProjectionChartPoint>;
    const sansEspaces = (t: string | null | undefined) => (t ?? '').replace(/\u00a0/g, ' ');

    it('affiche la dette, signée, et les chiffres se recomposent enfin', () => {
        renderTip(SON_POINT, { defaultSection: 'comptes' });
        const ligne = screen.getByText(/Dettes \(hors hypothèque\)/).closest('div')?.parentElement;
        expect(ligne).toBeTruthy();
        expect(sansEspaces(ligne?.textContent)).toContain('37 370');
        expect(sansEspaces(ligne?.textContent)).toContain('−');
    });

    it('CONTRÔLE NÉGATIF : sans dette, aucune ligne inventée', () => {
        renderTip({ Liquidites: 10_000, NetWorth: 10_000 }, { defaultSection: 'comptes' });
        expect(screen.queryByText(/Dettes \(hors hypothèque\)/)).toBeNull();
    });

    it("l'hypothèque n'est PAS recomptée : Immobilier est déjà l'équité nette", () => {
        renderTip({ Liquidites: 10_000, Immobilier: 100_000, NetWorth: 110_000 }, { defaultSection: 'comptes' });
        expect(screen.queryByText(/Dettes \(hors hypothèque\)/)).toBeNull();
    });
});
