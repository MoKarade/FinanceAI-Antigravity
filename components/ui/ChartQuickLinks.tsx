import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { Tab } from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { prefetchTab } from '../../utils/tabPrefetch';

interface ChartQuickLinkItem {
    label: string;
    tab: Tab;
    section?: string;
    detail?: string;
}

interface ChartQuickLinksProps {
    links: ReadonlyArray<ChartQuickLinkItem>;
    label?: string;
    className?: string;
}

/**
 * Barre d'actions rapides style Google Finance sous un graphique ou une section.
 * Permet de sauter en un clic vers la page source des données affichées.
 */
export const ChartQuickLinks: React.FC<ChartQuickLinksProps> = ({
    links,
    label = 'Explorer la source',
    className = '',
}) => {
    const setActiveTab = useFinanceStore((s) => s.setActiveTab);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);

    if (links.length === 0) return null;

    const handleNavigate = (item: ChartQuickLinkItem) => {
        if (item.section) {
            navigateWithFocus(item.tab, item.section);
        } else {
            setActiveTab(item.tab);
        }
    };

    return (
        <nav
            aria-label={label}
            className={`flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--border-subtle)] ${className}`.trim()}
        >
            <span className="text-[11px] font-medium text-tx-muted mr-1">
                {label} :
            </span>
            {links.map((item) => (
                <button
                    key={`${item.tab}-${item.label}`}
                    type="button"
                    onClick={() => handleNavigate(item)}
                    onMouseEnter={() => prefetchTab(item.tab)}
                    onFocus={() => prefetchTab(item.tab)}
                    className="gf-subtab-pill inline-flex items-center gap-1.5 text-xs"
                >
                    <span>{item.label}</span>
                    {item.detail ? (
                        <span className="text-[11px] text-tx-muted font-normal">
                            · {item.detail}
                        </span>
                    ) : null}
                    <ArrowUpRight className="w-3.5 h-3.5 text-accent-primary shrink-0" aria-hidden="true" />
                </button>
            ))}
        </nav>
    );
};
