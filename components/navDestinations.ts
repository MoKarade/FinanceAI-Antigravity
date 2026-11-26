import { Tab } from '../types';
import type { IconName } from './ui/Icon';

/**
 * [ETAPE-4] Menu ultra-court : 6 écrans essentiels + 1 espace Planification (Retraite,
 * Immobilier, Enfants, Projets de vie, Impôts) + Réglages, sans perdre aucun écran routé.
 */
export interface NavItem {
    tab: Tab;
    /** Libellé COURT de la nav — le titre de page vit dans TAB_LABELS. */
    label: string;
    icon: IconName;
    /** Autres onglets pour lesquels cet item est « la page courante ». */
    alsoActiveFor?: Tab[];
}

export interface NavGroup {
    id: 'ESSENTIEL' | 'PLUS';
    label: string;
    items: NavItem[];
}

export const PLANNING_SUBTABS: ReadonlyArray<NavItem> = [
    { tab: Tab.RETIREMENT, label: 'Retraite', icon: 'retirement' },
    { tab: Tab.REAL_ESTATE, label: 'Immobilier', icon: 'real-estate', alsoActiveFor: [Tab.REAL_ESTATE_PROJECTS] },
    { tab: Tab.CHILD, label: 'Enfants', icon: 'child' },
    { tab: Tab.LIFE_PROJECTS, label: 'Projets de vie', icon: 'life-projects' },
    { tab: Tab.TAX, label: 'Impôts', icon: 'tax' },
];

export const isPlanningTab = (tab: Tab): boolean =>
    PLANNING_SUBTABS.some((it) => it.tab === tab || it.alsoActiveFor?.includes(tab));

export const NAV_GROUPS: NavGroup[] = [
    {
        id: 'ESSENTIEL',
        label: 'Essentiel',
        items: [
            { tab: Tab.DASHBOARD, label: 'Accueil', icon: 'dashboard' },
            { tab: Tab.FUTURE, label: 'Futur', icon: 'future' },
            { tab: Tab.TRANSACTIONS, label: 'Transactions', icon: 'transactions' },
            { tab: Tab.BUDGET, label: 'Budget', icon: 'budget' },
            { tab: Tab.DEBT, label: 'Dettes', icon: 'debt' },
            { tab: Tab.INVESTMENTS, label: 'Placements', icon: 'investments', alsoActiveFor: [Tab.VALORIA] },
        ],
    },
    {
        id: 'PLUS',
        label: 'Plus',
        items: [
            {
                tab: Tab.RETIREMENT,
                label: 'Planification',
                icon: 'retirement',
                alsoActiveFor: [Tab.REAL_ESTATE, Tab.REAL_ESTATE_PROJECTS, Tab.CHILD, Tab.LIFE_PROJECTS, Tab.TAX],
            },
            { tab: Tab.SETTINGS, label: 'Réglages', icon: 'settings' },
        ],
    },
];

/** Le Profil s'ouvre depuis la carte en pied de barre (bureau) ou en tête du menu « Plus » (mobile). */
export const PROFILE_TAB = Tab.PROFILE;

/** Onglets épinglés dans la barre mobile (le reste passe par « Plus »). */
export const MOBILE_BAR_TABS: Tab[] = [Tab.DASHBOARD, Tab.FUTURE, Tab.TRANSACTIONS, Tab.BUDGET];

/** Destinations groupées pour le menu mobile « Plus » (accès direct en 1 touche). */
export const MOBILE_PLUS_GROUPS: ReadonlyArray<{ id: string; label: string; items: ReadonlyArray<NavItem> }> = [
    {
        id: 'ESSENTIEL',
        label: 'Essentiel',
        items: [
            { tab: Tab.DEBT, label: 'Dettes', icon: 'debt' },
            { tab: Tab.INVESTMENTS, label: 'Placements', icon: 'investments', alsoActiveFor: [Tab.VALORIA] },
        ],
    },
    {
        id: 'PLANIFICATION',
        label: 'Planification',
        items: PLANNING_SUBTABS,
    },
    {
        id: 'OUTILS',
        label: 'Outils',
        items: [
            { tab: Tab.SETTINGS, label: 'Réglages', icon: 'settings' },
        ],
    },
];

/** Index complet pour la recherche rapide de la barre supérieure. */
export const SEARCHABLE_NAV_ITEMS: ReadonlyArray<{ tab: Tab; label: string; group: string; icon: IconName }> = [
    ...NAV_GROUPS[0].items.map((it) => ({ tab: it.tab, label: it.label, group: 'Essentiel', icon: it.icon })),
    ...PLANNING_SUBTABS.map((it) => ({ tab: it.tab, label: it.label, group: 'Planification', icon: it.icon })),
    { tab: Tab.SETTINGS, label: 'Réglages', group: 'Outils', icon: 'settings' },
    { tab: PROFILE_TAB, label: 'Profil', group: 'Dossier', icon: 'users' },
];

/** L'item de nav qui représente cet onglet (y compris les onglets rattachés, ex. Planification). */
export const navItemOfTab = (tab: Tab): NavItem | undefined =>
    NAV_GROUPS.flatMap((g) => g.items).find((it) => it.tab === tab || it.alsoActiveFor?.includes(tab));

/** Tous les onglets atteignables depuis la nav (items, onglets rattachés, Profil). */
export const NAV_TABS_ATTEIGNABLES: Tab[] = [
    ...NAV_GROUPS.flatMap((g) => g.items.flatMap((it) => [it.tab, ...(it.alsoActiveFor ?? [])])),
    PROFILE_TAB,
];
