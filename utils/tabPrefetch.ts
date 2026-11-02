import { Tab } from '../types';
import { NAV_GROUPS, PROFILE_TAB } from '../components/navDestinations';
import { apresPremierAffichage } from './apresPremierAffichage';

const prefetchedTabs = new Set<Tab>();

const TAB_LOADERS: Partial<Record<Tab, () => Promise<unknown>>> = {
    [Tab.DASHBOARD]: () => import('../components/AccueilGoogle'),
    [Tab.FUTURE]: () => Promise.all([
        import('../components/FutureProjection'),
        import('../components/FutureKpiStrip'),
    ]),
    [Tab.TRANSACTIONS]: () => import('../components/Transactions'),
    [Tab.BUDGET]: () => import('../components/budget/BudgetWorkspace'),
    [Tab.DEBT]: () => import('../components/DebtManager'),
    [Tab.INVESTMENTS]: () => import('../components/Investments'),
    [Tab.RETIREMENT]: () => import('../components/Retirement'),
    [Tab.REAL_ESTATE]: () => import('../components/RealEstate'),
    [Tab.REAL_ESTATE_PROJECTS]: () => import('../components/life/RealEstateProjects'),
    [Tab.CHILD]: () => import('../components/ChildPlanning'),
    [Tab.LIFE_PROJECTS]: () => import('../components/LifeProjects'),
    [Tab.TAX]: () => import('../components/TaxCenter'),
    [Tab.SETTINGS]: () => import('../components/Settings'),
    [Tab.PROFILE]: () => import('../components/Profile'),
};

/**
 * Précharge immédiatement le module d'un onglet (au survol ou au focus d'un bouton de navigation)
 * afin d'éliminer tout délai de chargement lors du clic.
 */
export function prefetchTab(tab: Tab): void {
    if (prefetchedTabs.has(tab)) return;
    prefetchedTabs.add(tab);
    const loader = TAB_LOADERS[tab];
    if (loader) {
        void loader().catch(() => {
            prefetchedTabs.delete(tab);
        });
    }
}

/** Liste ordonnée des onglets principaux de la barre latérale + Profil. */
export const ORDERED_NAV_TABS: Tab[] = [
    ...NAV_GROUPS.flatMap((g) => g.items.map((it) => it.tab)),
    PROFILE_TAB,
];

/** Retourne l'onglet précédent et l'onglet suivant dans l'ordre logique de navigation. */
export function getAdjacentTabs(activeTab: Tab): { prev: Tab; next: Tab } {
    const normalized = activeTab === Tab.REAL_ESTATE_PROJECTS ? Tab.REAL_ESTATE : activeTab;
    const idx = ORDERED_NAV_TABS.indexOf(normalized);
    if (idx === -1) {
        return { prev: Tab.SETTINGS, next: Tab.TRANSACTIONS };
    }
    const prev = ORDERED_NAV_TABS[(idx - 1 + ORDERED_NAV_TABS.length) % ORDERED_NAV_TABS.length]!;
    const next = ORDERED_NAV_TABS[(idx + 1) % ORDERED_NAV_TABS.length]!;
    return { prev, next };
}

/**
 * Précharge progressivement tous les onglets en tâche de fond après le premier rendu
 * pour garantir une navigation instantanée (0 ms d'attente) dans toute l'application.
 */
export function scheduleIdleTabPrefetch(): () => void {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const stopApres = apresPremierAffichage(() => {
        if (cancelled) return;
        ORDERED_NAV_TABS.forEach((tab, index) => {
            const t = setTimeout(() => {
                if (!cancelled) prefetchTab(tab);
            }, 120 + index * 90);
            timers.push(t);
        });
    });

    return () => {
        cancelled = true;
        stopApres();
        timers.forEach(clearTimeout);
    };
}
