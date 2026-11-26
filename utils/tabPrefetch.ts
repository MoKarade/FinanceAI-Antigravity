import { Tab } from '../types';
import { NAV_GROUPS, PLANNING_SUBTABS, PROFILE_TAB } from '../components/navDestinations';
import { apresPremierAffichage } from './apresPremierAffichage';

const prefetchedTabs = new Set<Tab>();

interface NetworkInformationLike {
    saveData?: boolean;
    effectiveType?: string;
}

const TAB_LOADERS: Partial<Record<Tab, () => Promise<unknown>>> = {};

/** Enregistre les chargeurs lazy depuis `TabRouter` afin d'éviter toute dépendance circulaire vers `components/`. */
export function registerTabLoaders(loaders: Partial<Record<Tab, () => Promise<unknown>>>): void {
    Object.assign(TAB_LOADERS, loaders);
}

const CORE_IDLE_PREFETCH_TABS: readonly Tab[] = [
    Tab.FUTURE,
    Tab.TRANSACTIONS,
    Tab.BUDGET,
    Tab.INVESTMENTS,
];

function shouldSkipAutoPrefetch(): boolean {
    if (typeof navigator === 'undefined') return false;
    const conn = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    if (!conn) return false;
    if (conn.saveData === true) return true;
    return conn.effectiveType === 'slow-2g' || conn.effectiveType === '2g';
}

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

/** Liste ordonnée des onglets principaux + Planification + Profil. */
export const ORDERED_NAV_TABS: Tab[] = [
    ...NAV_GROUPS[0].items.map((it) => it.tab),
    ...PLANNING_SUBTABS.map((it) => it.tab),
    ...NAV_GROUPS[1].items.filter((it) => it.tab !== Tab.RETIREMENT).map((it) => it.tab),
    PROFILE_TAB,
];

/** Retourne l'onglet précédent et l'onglet suivant dans l'ordre logique de navigation. */
export function getAdjacentTabs(activeTab: Tab): { prev: Tab; next: Tab } {
    const normalized = activeTab === Tab.REAL_ESTATE_PROJECTS
        ? Tab.REAL_ESTATE
        : activeTab === Tab.VALORIA
            ? Tab.INVESTMENTS
            : activeTab;
    const idx = ORDERED_NAV_TABS.indexOf(normalized);
    if (idx === -1) {
        return { prev: Tab.SETTINGS, next: Tab.TRANSACTIONS };
    }
    const prev = ORDERED_NAV_TABS[(idx - 1 + ORDERED_NAV_TABS.length) % ORDERED_NAV_TABS.length]!;
    const next = ORDERED_NAV_TABS[(idx + 1) % ORDERED_NAV_TABS.length]!;
    return { prev, next };
}

/**
 * Précharge en douceur les 4 onglets principaux en tâche de fond après le premier rendu,
 * tout en respectant le mode économie de données / connexions lentes (2G).
 */
export function scheduleIdleTabPrefetch(): () => void {
    if (shouldSkipAutoPrefetch()) {
        return () => {};
    }
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const idleIds: number[] = [];

    const stopApres = apresPremierAffichage(() => {
        if (cancelled || shouldSkipAutoPrefetch()) return;
        CORE_IDLE_PREFETCH_TABS.forEach((tab, index) => {
            const t = setTimeout(() => {
                if (cancelled || shouldSkipAutoPrefetch()) return;
                if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
                    const id = window.requestIdleCallback(() => {
                        if (!cancelled) prefetchTab(tab);
                    }, { timeout: 2000 });
                    idleIds.push(id);
                } else {
                    prefetchTab(tab);
                }
            }, 1200 + index * 1000);
            timers.push(t);
        });
    });

    return () => {
        cancelled = true;
        stopApres();
        timers.forEach(clearTimeout);
        if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
            idleIds.forEach((id) => window.cancelIdleCallback(id));
        }
    };
}
