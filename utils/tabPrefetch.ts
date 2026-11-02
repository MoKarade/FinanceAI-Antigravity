import { Tab } from '../types';
import { NAV_GROUPS, PROFILE_TAB } from '../components/navDestinations';
import { apresPremierAffichage } from './apresPremierAffichage';

const prefetchedTabs = new Set<Tab>();

const COMPONENT_MODULES = import.meta.glob([
    '../components/*.tsx',
    '../components/budget/*.tsx',
    '../components/life/*.tsx',
]);

function loadComponentModule(path: string): Promise<unknown> {
    const loader = COMPONENT_MODULES[path];
    return loader ? loader() : Promise.resolve();
}

const TAB_LOADERS: Partial<Record<Tab, () => Promise<unknown>>> = {
    [Tab.DASHBOARD]: () => loadComponentModule('../components/AccueilGoogle.tsx'),
    [Tab.FUTURE]: () => Promise.all([
        loadComponentModule('../components/FutureProjection.tsx'),
        loadComponentModule('../components/FutureKpiStrip.tsx'),
    ]),
    [Tab.TRANSACTIONS]: () => loadComponentModule('../components/Transactions.tsx'),
    [Tab.BUDGET]: () => loadComponentModule('../components/budget/BudgetWorkspace.tsx'),
    [Tab.DEBT]: () => loadComponentModule('../components/DebtManager.tsx'),
    [Tab.INVESTMENTS]: () => loadComponentModule('../components/Investments.tsx'),
    [Tab.RETIREMENT]: () => loadComponentModule('../components/Retirement.tsx'),
    [Tab.REAL_ESTATE]: () => loadComponentModule('../components/RealEstate.tsx'),
    [Tab.REAL_ESTATE_PROJECTS]: () => loadComponentModule('../components/life/RealEstateProjects.tsx'),
    [Tab.CHILD]: () => loadComponentModule('../components/ChildPlanning.tsx'),
    [Tab.LIFE_PROJECTS]: () => loadComponentModule('../components/LifeProjects.tsx'),
    [Tab.TAX]: () => loadComponentModule('../components/TaxCenter.tsx'),
    [Tab.SETTINGS]: () => loadComponentModule('../components/Settings.tsx'),
    [Tab.PROFILE]: () => loadComponentModule('../components/Profile.tsx'),
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
