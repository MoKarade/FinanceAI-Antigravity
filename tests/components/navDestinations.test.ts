import { describe, it, expect } from 'vitest';
import {
    NAV_GROUPS,
    PLANNING_SUBTABS,
    MOBILE_BAR_TABS,
    MOBILE_PLUS_GROUPS,
    NAV_TABS_ATTEIGNABLES,
    PROFILE_TAB,
    navItemOfTab,
    isPlanningTab,
} from '../../components/navDestinations';
import { Tab } from '../../types';

// Hors nav : TRAVEL et LIFE_EVENTS (alias legacy redirigés vers LIFE_PROJECTS par TabRouter).
const UNROUTED: Tab[] = [Tab.TRAVEL, Tab.LIFE_EVENTS];

describe('navDestinations — menu ultra-court sans perte', () => {
    it('la nav couvre EXACTEMENT tous les onglets routés, sans doublon', () => {
        expect(new Set(NAV_TABS_ATTEIGNABLES).size).toBe(NAV_TABS_ATTEIGNABLES.length);
        const expected = Object.values(Tab).filter((t) => !UNROUTED.includes(t));
        expect([...NAV_TABS_ATTEIGNABLES].sort()).toEqual([...expected].sort());
    });

    it('deux groupes Essentiel (6 écrans) / Plus (Planification + Réglages)', () => {
        expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Essentiel', 'Plus']);
        expect(NAV_GROUPS[0].items.map((i) => i.label)).toEqual([
            'Accueil',
            'Futur',
            'Transactions',
            'Budget',
            'Dettes',
            'Placements',
        ]);
        expect(NAV_GROUPS[1].items.map((i) => i.label)).toEqual(['Planification', 'Réglages']);
    });

    it('l’espace Planification regroupe Retraite, Immobilier, Enfants, Projets de vie et Impôts', () => {
        expect(PLANNING_SUBTABS.map((p) => p.label)).toEqual([
            'Retraite',
            'Immobilier',
            'Enfants',
            'Projets de vie',
            'Impôts',
        ]);
        for (const tab of [Tab.RETIREMENT, Tab.REAL_ESTATE, Tab.REAL_ESTATE_PROJECTS, Tab.CHILD, Tab.LIFE_PROJECTS, Tab.TAX]) {
            expect(isPlanningTab(tab)).toBe(true);
            expect(navItemOfTab(tab)?.label).toBe('Planification');
        }
        expect(isPlanningTab(Tab.DASHBOARD)).toBe(false);
        expect(isPlanningTab(Tab.SETTINGS)).toBe(false);
    });

    it('la barre mobile et le tiroir Plus donnent accès aux destinations clés', () => {
        for (const tab of MOBILE_BAR_TABS) expect(navItemOfTab(tab)?.tab).toBe(tab);
        const plusTabs = MOBILE_PLUS_GROUPS.flatMap((g) => g.items.map((i) => i.tab));
        expect(plusTabs).toEqual([
            Tab.DEBT,
            Tab.INVESTMENTS,
            Tab.RETIREMENT,
            Tab.REAL_ESTATE,
            Tab.CHILD,
            Tab.LIFE_PROJECTS,
            Tab.TAX,
            Tab.SETTINGS,
        ]);
    });

    it('Placements unifie le suivi et Valoria · Quant IA sans doubler la barre latérale', () => {
        expect(navItemOfTab(Tab.INVESTMENTS)?.label).toBe('Placements');
        expect(navItemOfTab(Tab.VALORIA)?.tab).toBe(Tab.INVESTMENTS);
        const allLabels = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label));
        expect(allLabels.filter((l) => l === 'Placements').length).toBe(1);
        expect(allLabels).not.toContain('Valoria · Quant IA');
    });

    it('le Profil passe par la carte, pas par un groupe', () => {
        expect(navItemOfTab(PROFILE_TAB)).toBeUndefined();
        expect(NAV_TABS_ATTEIGNABLES).toContain(PROFILE_TAB);
        expect(navItemOfTab(Tab.DASHBOARD)?.label).toBe('Accueil');
    });
});
