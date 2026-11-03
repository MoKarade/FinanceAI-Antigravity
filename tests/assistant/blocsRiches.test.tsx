// tests/assistant/blocsRiches.test.tsx
//
// Rendu des blocs riches : montants formatés via formatCAD / formatPercent, valeur absente → « — »
// (jamais 0), mode discret respecté, graphique doté d'une alternative textuelle.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BlocRicheVue, formaterValeurBloc } from '../../components/aiChat/BlocRicheVue';
import { blocRicheSchema, type BlocRiche } from '../../services/assistant/blocsRiches';
import { useFinanceStore } from '../../store/useFinanceStore';
import { formatCAD, formatPercent } from '../../utils/format';

describe('blocs riches de l\'assistant', () => {
    beforeEach(() => { useFinanceStore.getState().setPrivacyMode(false); });

    it('cartes de chiffres : formatCAD et « — » pour une valeur inconnue', () => {
        const bloc: BlocRiche = { type: 'cartes_chiffres', cartes: [
            { libelle: 'Valeur nette', valeur: 12345, unite: 'cad', variationPct: 2.5 },
            { libelle: 'Épargne', valeur: null, unite: 'cad' },
        ] };
        render(<BlocRicheVue bloc={bloc} />);
        const zone = screen.getByTestId('assistant-bloc-cartes');
        expect(zone.textContent).toContain(formatCAD(12345));
        expect(zone.textContent).toContain(`+${formatPercent(2.5, 1)}`);
        expect(zone.textContent).not.toContain(formatCAD(0));
    });

    it('tableau : texte, montant, pourcentage, et cellule absente', () => {
        const bloc: BlocRiche = {
            type: 'tableau', titre: 'Comptes',
            colonnes: [{ cle: 'nom', libelle: 'Compte', unite: 'texte' }, { cle: 'solde', libelle: 'Solde', unite: 'cad' }, { cle: 'part', libelle: 'Part', unite: 'pourcent' }],
            lignes: [{ nom: 'CELI fictif', solde: 1000, part: 40 }, { nom: 'REER fictif', solde: null, part: null }],
        };
        render(<BlocRicheVue bloc={bloc} />);
        const zone = screen.getByTestId('assistant-bloc-tableau');
        expect(within(zone).getByText('CELI fictif')).toBeTruthy();
        expect(zone.textContent).toContain(formatCAD(1000));
        expect(zone.textContent).toContain(formatPercent(40, 1));
    });

    it('graphique : alternative textuelle (tableau) avec les valeurs formatées', () => {
        const bloc: BlocRiche = {
            type: 'graphique', titre: 'Patrimoine projeté', forme: 'ligne', unite: 'cad',
            series: [{ cle: 'net', libelle: 'Patrimoine net' }],
            points: [{ etiquette: '2030', valeurs: { net: 50000 } }, { etiquette: '2031', valeurs: { net: null } }],
        };
        render(<BlocRicheVue bloc={bloc} />);
        const fig = screen.getByTestId('assistant-bloc-graphique');
        expect(fig.getAttribute('aria-label')).toBe('Patrimoine projeté');
        expect(fig.textContent).toContain(formatCAD(50000));
        expect(within(fig).getAllByText('2030').length).toBeGreaterThan(0);
    });

    it('liste ordonnée', () => {
        render(<BlocRicheVue bloc={{ type: 'liste', ordonnee: true, elements: ['Cotiser au CELI', 'Rembourser la carte'] }} />);
        const zone = screen.getByTestId('assistant-bloc-liste');
        expect(zone.querySelector('ol')).toBeTruthy();
        expect(zone.querySelectorAll('li')).toHaveLength(2);
    });

    it('mode discret : aucun montant dans le DOM', () => {
        useFinanceStore.getState().setPrivacyMode(true);
        render(<BlocRicheVue bloc={{ type: 'cartes_chiffres', cartes: [{ libelle: 'Valeur nette', valeur: 98765, unite: 'cad' }] }} />);
        expect(screen.getByTestId('assistant-bloc-cartes').textContent).not.toContain(formatCAD(98765));
    });

    it('formatage : non fini → « — », jamais 0', () => {
        expect(formaterValeurBloc(Number.NaN, 'cad')).toBe('—');
        expect(formaterValeurBloc(null, 'pourcent')).toBe('—');
        expect(formaterValeurBloc(Infinity, 'nombre')).toBe('—');
    });

    it('schéma : NaN / Infinity refusés, null accepté', () => {
        const base = { type: 'cartes_chiffres', cartes: [{ libelle: 'x', unite: 'cad' }] };
        expect(blocRicheSchema.safeParse({ ...base, cartes: [{ ...base.cartes[0], valeur: Number.NaN }] }).success).toBe(false);
        expect(blocRicheSchema.safeParse({ ...base, cartes: [{ ...base.cartes[0], valeur: Infinity }] }).success).toBe(false);
        expect(blocRicheSchema.safeParse({ ...base, cartes: [{ ...base.cartes[0], valeur: null }] }).success).toBe(true);
    });
});
