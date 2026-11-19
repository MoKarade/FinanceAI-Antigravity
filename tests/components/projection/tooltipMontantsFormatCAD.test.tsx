/**
 * [FMT-TOLOCALESTRING-MONEY] Lot 102 — le « $ » de l'infobulle Futur vient du FORMATEUR, plus du JSX.
 *
 * Vérifie dans `FutureRichTooltip` (onglets `valeur`, `flux` et `comptes`) que les montants passent
 * par `formatCAD` (un seul « $ », zéro « $$ ») tandis que le gain par compte reste un nombre nu
 * via `formatNumber`.
 */
import { describe, it, expect } from 'vitest';
import { renderPanneauJour } from '../../helpers/panneauJour';
import { formatCAD, formatNumber } from '../../../utils/format';
import type { ProjectionChartPoint } from '../../../services/projection/types';
import type { SectionPanneauId } from '../../../components/future/panneauSections';

const pt = (over: Partial<ProjectionChartPoint>): ProjectionChartPoint => ({
    monthIndex: 0, dateLabel: 'janv. 2030', age: 40, NetWorth: 500000, ...over,
} as ProjectionChartPoint);

const rendu = (over: Partial<ProjectionChartPoint> = {}, defaultSection: SectionPanneauId = 'valeur'): string => {
    const { container, unmount } = renderPanneauJour(pt(over), { defaultSection });
    const txt = container.textContent ?? '';
    unmount();
    return txt;
};

describe('[FMT] les montants de l\'infobulle passent par la source unique', () => {
    it('le gros chiffre porte UN seul « $ », posé par formatCAD', () => {
        const txt = rendu({ NetWorth: 1234567 }, 'valeur');
        expect(txt).toContain(formatCAD(1234567));
        expect(txt).not.toContain('$$');
    });

    it('aucun « $ » orphelin dans valeur ni flux : autant de symboles que de montants formatés', () => {
        const over = { NetWorth: 500000, Expenses: 3000, IncomeMarc: 7000, FluxImpots: 1200 };
        const txtValeur = rendu(over, 'valeur');
        const txtFlux = rendu(over, 'flux');
        expect(txtValeur).not.toMatch(/\$\s*\$/);
        expect(txtFlux).not.toMatch(/\$\s*\$/);
        expect((txtValeur + txtFlux).match(/\$/g)?.length ?? 0).toBeGreaterThan(3);
    });

    it('le gain par compte reste un nombre NU — formatCAD y ajouterait un « $ » jamais eu', () => {
        const over = {
            CELI: 100000, MarketGrowthCELI: 1500, REER: 80000, MarketGrowthREER: 700,
        } as Partial<ProjectionChartPoint>;

        // Onglet « Par compte » : valeur avec devise, gain par compte nu (formatNumber sans $)
        const txtComptes = rendu(over, 'comptes');
        expect(txtComptes).toContain(formatNumber(1500));
        expect(txtComptes).not.toContain(formatCAD(1500));
        expect(txtComptes).toContain(formatCAD(100000));

        // Onglet « Valeur nette » : le TOTAL des rendements (1 500 + 700) porte bien le sien
        const txtValeur = rendu(over, 'valeur');
        expect(txtValeur).toContain(formatCAD(2200));
    });
});
