import React from 'react';
import { Tab } from '../types';
import { PLANNING_SUBTABS } from './navDestinations';
import { Icon } from './ui/Icon';
import { prefetchTab } from '../utils/tabPrefetch';

interface PlanningHubBarProps {
    activeTab: Tab;
    onSelectTab: (tab: Tab) => void;
}

/**
 * Barre compacte de l'espace Planification reliant Retraite, Immobilier,
 * Enfants, Projets de vie et Impôts sans encombrer le menu latéral.
 */
export const PlanningHubBar: React.FC<PlanningHubBarProps> = ({ activeTab, onSelectTab }) => (
    <nav
        aria-label="Espace Planification"
        className="gf-subtab-bar flex flex-wrap items-center gap-1.5 p-1.5 rounded-2xl bg-surface border border-bordure"
    >
        {PLANNING_SUBTABS.map((it) => {
            const actif = it.tab === activeTab || Boolean(it.alsoActiveFor?.includes(activeTab));
            return (
                <button
                    key={it.tab}
                    type="button"
                    aria-current={actif ? 'page' : undefined}
                    onClick={() => onSelectTab(it.tab)}
                    onMouseEnter={() => prefetchTab(it.tab)}
                    onFocus={() => prefetchTab(it.tab)}
                    className={`touch-target min-h-11 px-3.5 rounded-xl flex items-center gap-2 text-xs whitespace-nowrap shrink-0 transition-colors focus-ring ${
                        actif
                            ? 'gf-subtab-pill-active bg-surface-douce text-ink-50 font-semibold border border-bordure-champ'
                            : 'text-ink-300 hover:bg-surface-douce hover:text-ink-50 border border-transparent'
                    }`}
                >
                    <Icon name={it.icon} size={15} className={actif ? 'text-repere' : 'text-ink-400'} aria-hidden="true" />
                    <span>{it.label}</span>
                </button>
            );
        })}
    </nav>
);
