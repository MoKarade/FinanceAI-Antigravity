/**
 * [FUTUR-PANNEAU-FIXE] « Les chiffres ne se recomposent pas entre eux » — irritant coché par Marc.
 *
 * Vérifie que la section « Par compte » de `FutureRichTooltip` recompose exactement
 * `Σ comptes − NetWorth` et refuse honnêtement les valeurs non finies (`NaN` / `Infinity`).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { renderPanneauJour } from '../../helpers/panneauJour';
import {
    SectionComptes,
    SectionValeurNette,
    type PointJour,
} from '../../../components/projection/panneauJour/sections';

/** Montants ronds et distincts : un écart s'y lit à l'œil dans le message d'échec. */
const COMPTES = { Liquidites: 12_000, CELI: 90_000, REER: 210_000, NonReg: 45_000 } as const;
const SOMME_ACTIFS = 357_000; // 12 000 + 90 000 + 210 000 + 45 000
const DETTE = 47_000;

const point = (over: Partial<PointJour> = {}): PointJour => ({
    monthIndex: 3,
    dateLabel: '18 sept. 2026',
    age: 41,
    NetWorth: SOMME_ACTIFS - DETTE,
    ...COMPTES,
    ...over,
} as PointJour);

/** Normalise les espaces : `formatCAD` sépare les milliers par une INSÉCABLE (U+00A0). */
const texte = () => (document.body.textContent || '').replace(/\u00a0|\s+/g, ' ');

describe('[FUTUR-PANNEAU-FIXE] la colonne « Par compte » recompose la valeur nette', () => {
    it('la ligne de dette vaut exactement Σ comptes − valeur nette', () => {
        renderPanneauJour(point(), { defaultSection: 'comptes' });
        expect(screen.getByText(/Dettes \(hors hypothèque\)/)).toBeInTheDocument();
        // 357 000 − 310 000 = 47 000. Le signe « − » est rendu avant le montant.
        expect(texte()).toContain('47 000');
    });

    it('baisser la valeur nette de 10 000 monte la dette de 10 000', () => {
        const { unmount } = renderPanneauJour(
            point({ NetWorth: SOMME_ACTIFS - DETTE - 10_000 }),
            { defaultSection: 'comptes' },
        );
        expect(texte()).toContain('57 000');
        unmount();
    });

    it('aucune dette : la ligne ne se rend pas du tout (pas un « 0 $ » décoratif)', () => {
        renderPanneauJour(point({ NetWorth: SOMME_ACTIFS }), { defaultSection: 'comptes' });
        expect(screen.queryByText(/Dettes \(hors hypothèque\)/)).toBeNull();
    });

    it('un COMPTE non fini refuse aussi — une somme amputée fausse la soustraction', () => {
        renderPanneauJour(point({ REER: Number.POSITIVE_INFINITY }), { defaultSection: 'comptes' });
        expect(screen.getByText(/Dette non calculable/)).toBeInTheDocument();
        expect(texte()).not.toContain('257 000');
    });

    it('un compte ABSENT reste légitime (pas de compte ≠ donnée perdue)', () => {
        const { NonReg: _retire, ...sansNonReg } = COMPTES;
        renderPanneauJour(
            {
                monthIndex: 3, dateLabel: '18 sept. 2026', age: 41,
                NetWorth: SOMME_ACTIFS - 45_000 - DETTE,
                ...sansNonReg,
            } as PointJour,
            { defaultSection: 'comptes' },
        );
        expect(screen.getByText(/Dettes \(hors hypothèque\)/)).toBeInTheDocument();
        expect(texte()).toContain('47 000');
    });

    it('valeur nette NON FINIE : FutureRichTooltip n’affiche rien et SectionComptes refuse la dette', () => {
        // 1) FutureRichTooltip refuse complètement d'ouvrir sur un NetWorth non fini (aucun « 0 $ » ni « 357 000 »).
        const tip = renderPanneauJour(point({ NetWorth: Number.NaN }), { defaultSection: 'comptes' });
        expect(tip.container.firstChild).toBeNull();
        expect(texte()).not.toContain('357 000');
        tip.unmount();

        // 2) SectionComptes appelée directement refuse aussi de fabriquer une dette à 357 000 $.
        render(<SectionComptes data={point({ NetWorth: Number.NaN })} />);
        expect(screen.getByText(/Dette non calculable/)).toBeInTheDocument();
        expect(texte()).not.toContain('357 000');
        expect(screen.queryByText(/Dettes \(hors hypothèque\)/)).toBeNull();
    });

    it('valeur nette NON FINIE : SectionValeurNette n’annonce PAS « 0 $ » — « — », pas un zéro crédible', () => {
        render(<SectionValeurNette data={point({ NetWorth: Number.NaN })} />);
        const t = texte();
        const i = t.indexOf('Valeur nette');
        expect(i, 'libellé « Valeur nette » introuvable — le test serait vacueux').toBeGreaterThanOrEqual(0);
        expect(t.slice(i, i + 80)).toContain('—');
        expect(t.slice(i, i + 80)).not.toMatch(/\b0 \$/);
    });
});
