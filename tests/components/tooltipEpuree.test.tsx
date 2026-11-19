/**
 * [FUTUR-INFOBULLE-EPUREE] « Un peu plus grande, et quasiment pas de texte » (Marc, 2026-08-17).
 *
 * Vérifie dans `FutureRichTooltip` (survol + tous les onglets du mode épinglé) :
 *   1. PLAFOND DE PROSE — aucun nœud de texte visible ne dépasse 45 caractères.
 *   2. AUCUNE RÉSERVE PERDUE — chaque réserve garde un marqueur VISIBLE, `title` ET `.sr-only`.
 */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderPanneauJour } from '../helpers/panneauJour';
import { PANNEAU_SECTION_IDS } from '../../components/future/panneauSections';
import type { ProjectionChartPoint } from '../../services/projection/types';

type DailyExtras = {
    isDailyPoint?: boolean; dayIsReal?: boolean; dayIsDated?: boolean; dayLabels?: string[];
    hasEstimatedPrice?: boolean; priceAgeMaxDays?: number; daySyncUnconfirmed?: boolean;
    dayMovements?: Array<{ payee: string; amount: number }>; dayMovementsTotal?: number;
};

const jour = (extras: DailyExtras = {}): ProjectionChartPoint => ({
    monthIndex: 12, dateLabel: '10 août 2026', age: 41, NetWorth: 812_345, diffNW: -1_240,
    P10: 710_000, P90: 920_000,
    IncomeMarc: 3_200, IncomeRetirement: 900, Expenses: 2_450, RetraitREER: 500,
    FluxImpots: 1_200, ImpotLatent: -60_000,
    Liquidites: 12_000, CELI: 90_000, REER: 210_000, NonReg: 45_000,
    MarketGrowthCELI: 300, NetTransferCELI: 500,
    isDailyPoint: true, dayIsReal: true, dayIsDated: false, dayLabels: [],
    ...extras,
} as unknown as ProjectionChartPoint);

const noeudsDeTexte = (): string[] => {
    const out: string[] = [];
    const walk = (n: Node) => {
        if (n.nodeType === 3) {
            const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
            if (t) out.push(t);
            return;
        }
        if (n.nodeType === 1 && (n as Element).classList?.contains('sr-only')) return;
        n.childNodes.forEach(walk);
    };
    walk(document.body);
    return out;
};

const PLAFOND = 45;

describe('[FUTUR-INFOBULLE-EPUREE] plafond de prose', () => {
    it.each([
        ['jour réel épinglé', { origine: 'epingle' as const }],
        ['jour réel survolé', { origine: 'survol' as const }],
        ['jour réel au repos', { origine: 'ancre' as const }],
    ])('%s : aucun nœud de texte ne dépasse le plafond sur aucun onglet', (_nom, opts) => {
        if (opts.origine === 'survol') {
            renderPanneauJour(jour(), { userName1: 'Marc', origine: opts.origine });
            const trop = noeudsDeTexte().filter((t) => t.length > PLAFOND);
            expect(trop, `phrases trop longues rendues : ${JSON.stringify(trop)}`).toEqual([]);
            return;
        }

        for (const section of PANNEAU_SECTION_IDS) {
            const { unmount } = renderPanneauJour(jour(), {
                userName1: 'Marc',
                origine: opts.origine,
                defaultSection: section,
            });
            const trop = noeudsDeTexte().filter((t) => t.length > PLAFOND);
            expect(trop, `section ${section} — phrases trop longues : ${JSON.stringify(trop)}`).toEqual([]);
            unmount();
        }
    });

    it('jour PROJETÉ sans mouvement : idem (c’est là que vivait la plus longue phrase)', () => {
        for (const section of PANNEAU_SECTION_IDS) {
            const { unmount } = renderPanneauJour(jour({ dayIsReal: false }), { defaultSection: section });
            expect(noeudsDeTexte().filter((t) => t.length > PLAFOND)).toEqual([]);
            unmount();
        }
    });

    it('l’infobulle dit toujours l’essentiel (valeur, variation, comptes, impôts)', () => {
        const rValeur = renderPanneauJour(jour(), { defaultSection: 'valeur' });
        const txtValeur = (document.body.textContent || '').replace(/\s+/g, '');
        expect(txtValeur).toContain('Valeurnette');
        expect(txtValeur).toContain('Variation');
        expect(txtValeur).toContain('Parcompte');
        rValeur.unmount();

        const rFlux = renderPanneauJour(jour(), { defaultSection: 'flux' });
        const txtFlux = (document.body.textContent || '').replace(/\s+/g, '');
        expect(txtFlux).toContain('Impôts');
        expect(txtFlux).toContain('Dépenses');
        rFlux.unmount();
    });
});

describe('[FUTUR-INFOBULLE-EPUREE] aucune réserve perdue', () => {
    const verifieReserve = (labelVisible: string | RegExp, phrase: RegExp) => {
        const pastille = [...document.querySelectorAll('span[title]')]
            .find((e) => phrase.test(e.getAttribute('title') || ''));
        expect(pastille, `aucune pastille dont le title corresponde à ${phrase}`).toBeTruthy();
        const visible = [...pastille!.childNodes]
            .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        expect(visible).toMatch(labelVisible instanceof RegExp ? labelVisible : new RegExp(labelVisible.replace(/[.*+?^${}()|[\]\\~]/g, '\\$&')));
        expect(pastille!.getAttribute('title')).toMatch(phrase);
        const sr = pastille!.querySelector('.sr-only');
        expect(sr, 'la phrase doit exister hors du seul attribut `title`').not.toBeNull();
        expect(sr!.textContent).toMatch(phrase);
    };

    it('prix ESTIMÉ : pastille visible + phrase complète (survol ET lecteur d’écran)', () => {
        renderPanneauJour(jour({ hasEstimatedPrice: true }), { defaultSection: 'mouvements' });
        verifieReserve('~ prix estimé', /prix ACTUEL/);
    });

    it('prix PÉRIMÉ : la pastille porte l’âge réel, pas un vague « ancien »', () => {
        renderPanneauJour(jour({ priceAgeMaxDays: 34 }), { defaultSection: 'mouvements' });
        expect(screen.getByText(/prix J−34/)).toBeInTheDocument();
        verifieReserve(/prix J−34/, /plateau de reconstruction/);
    });

    it('sync NON CONFIRMÉE : pastille visible + phrase complète (survol ET lecteur d’écran)', () => {
        renderPanneauJour(jour({ daySyncUnconfirmed: true }), { defaultSection: 'mouvements' });
        verifieReserve(/sync incomplète/, /transactions de ce jour peuvent manquer/);
    });

    it('aucune réserve → aucune pastille (pas d’avertissement décoratif)', () => {
        renderPanneauJour(jour(), { defaultSection: 'mouvements' });
        expect(screen.queryByText('~ prix estimé')).toBeNull();
        expect(screen.queryByText(/prix J−/)).toBeNull();
        expect(screen.queryByText(/sync incomplète/)).toBeNull();
    });

    it('un prix de 7 jours ou moins n’est PAS une réserve (seuil inchangé)', () => {
        renderPanneauJour(jour({ priceAgeMaxDays: 7 }), { defaultSection: 'mouvements' });
        expect(screen.queryByText(/prix J−/)).toBeNull();
    });

    it('le badge Réel / Projeté garde sa justification (survol ET lecteur d’écran)', () => {
        const { unmount } = renderPanneauJour(jour(), { defaultSection: 'mouvements' });
        verifieReserve('Réel', /pas une moyenne du mois/);
        unmount();
        renderPanneauJour(jour({ dayIsReal: false }), { defaultSection: 'mouvements' });
        verifieReserve('Projeté', /pas une mesure/);
    });

    it('la troncature des mouvements reste annoncée', () => {
        renderPanneauJour(
            jour({
                dayIsDated: true,
                dayMovements: [{ payee: 'Metro', amount: -42 }],
                dayMovementsTotal: 5,
            }),
            { defaultSection: 'mouvements' },
        );
        const reste = screen.getByText('+4 autres');
        expect(reste.getAttribute('title')).toMatch(/Détail complet/);
    });

    it('le compte survit quand AUCUN mouvement n’est décrit (branche de repli)', () => {
        renderPanneauJour(
            jour({
                dayIsDated: true, dayMovements: [], dayMovementsTotal: 3,
            }),
            { defaultSection: 'mouvements' },
        );
        expect(screen.getByText('Mouvement à date connue')).toBeInTheDocument();
        expect(screen.getByText('+3 autres')).toBeInTheDocument();
    });

    it('rien à annoncer quand la liste est complète (pas de « +0 autres »)', () => {
        renderPanneauJour(
            jour({
                dayIsDated: true,
                dayMovements: [{ payee: 'Metro', amount: -42 }],
                dayMovementsTotal: 1,
            }),
            { defaultSection: 'mouvements' },
        );
        expect(screen.queryByText(/autres?$/)).toBeNull();
    });
});
