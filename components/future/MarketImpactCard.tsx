// components/future/MarketImpactCard.tsx
// Carte visuelle compacte traduisant l'effet des analyses et mouvements de marché en $ CAD et en mois de retraite.

import React from 'react';
import type { MarketImpactSummary } from '../../services/marketImpactSummary';
import { formatCAD, formatCompactCAD, formatPercent } from '../../utils/format';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';

export interface MarketImpactCardProps {
    summary: MarketImpactSummary;
    onOpenMarkets?: () => void;
    compact?: boolean;
}

export const MarketImpactCard: React.FC<MarketImpactCardProps> = ({
    summary,
    onOpenMarkets,
    compact = false,
}) => {
    const toneClass =
        summary.direction === 'positif'
            ? 'border-succes-texte/30 bg-succes-fond text-succes-texte'
            : summary.direction === 'risque'
              ? 'border-erreur-texte/30 bg-erreur-fond text-erreur-texte'
              : 'border-bordure-champ bg-surface-douce text-texte-doux';

    const renderSignedCompactCad = (val: number | null): React.ReactNode => {
        if (val === null || !Number.isFinite(val)) return '—';
        if (val === 0) return <PrivateAmount>{formatCAD(0)}</PrivateAmount>;
        return (
            <PrivateAmount>
                {val > 0 ? `+${formatCompactCAD(val)}` : `−${formatCompactCAD(Math.abs(val))}`}
            </PrivateAmount>
        );
    };

    const renderMonthsDelta = (months: number | null): React.ReactNode => {
        if (months === null || !Number.isFinite(months)) return '—';
        if (months === 0) return 'Stable (0 mois)';
        return (
            <PrivateAmount>
                {months > 0 ? `+${months} mois de liberté` : `${months} mois à l’horizon`}
            </PrivateAmount>
        );
    };

    return (
        <section
            data-testid="market-impact-card"
            aria-label="Effet des analyses de marché sur ton patrimoine"
            className="rounded-2xl border border-bordure bg-surface p-4 sm:p-5 space-y-3"
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <Icon name="globe" size={18} className="text-repere shrink-0" />
                    <h3 className="text-body font-bold text-texte">
                        Effet du marché
                    </h3>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span className={`px-2.5 py-1 rounded-full border text-tiny font-semibold ${toneClass}`}>
                        {summary.regimeLabel}
                        {summary.annualShiftPct !== null && Number.isFinite(summary.annualShiftPct) && summary.annualShiftPct !== 0 ? (
                            <>
                                {' · '}
                                <PrivateAmount>
                                    {`${summary.annualShiftPct > 0 ? '+' : ''}${formatPercent(summary.annualShiftPct, 2)}/an`}
                                </PrivateAmount>
                            </>
                        ) : null}
                    </span>
                    {onOpenMarkets && (
                        <button
                            type="button"
                            onClick={onOpenMarkets}
                            className="touch-target min-h-11 px-3 py-2 rounded-xl border border-bordure-champ bg-surface-douce hover:bg-fond text-tiny font-semibold text-texte transition-colors focus-ring whitespace-nowrap"
                        >
                            Voir les marchés ↗
                        </button>
                    )}
                </div>
            </div>

            {summary.hasMarketData && (
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="rounded-xl border border-bordure bg-surface-douce p-2.5 sm:p-3 min-w-0">
                        <div className="text-[11px] sm:text-tiny text-texte-doux truncate">Sur 5 ans</div>
                        <div
                            className={`text-meta sm:text-body font-mono font-bold tabular-nums mt-0.5 truncate ${
                                (summary.impact5yCad ?? 0) > 0
                                    ? 'text-succes-texte'
                                    : (summary.impact5yCad ?? 0) < 0
                                      ? 'text-erreur-texte'
                                      : 'text-texte'
                            }`}
                        >
                            {renderSignedCompactCad(summary.impact5yCad)}
                        </div>
                    </div>

                    <div className="rounded-xl border border-bordure bg-surface-douce p-2.5 sm:p-3 min-w-0">
                        <div className="text-[11px] sm:text-tiny text-texte-doux truncate">À la retraite</div>
                        <div
                            className={`text-meta sm:text-body font-mono font-bold tabular-nums mt-0.5 truncate ${
                                (summary.horizonImpactCad ?? 0) > 0
                                    ? 'text-succes-texte'
                                    : (summary.horizonImpactCad ?? 0) < 0
                                      ? 'text-erreur-texte'
                                      : 'text-texte'
                            }`}
                        >
                            {renderSignedCompactCad(summary.horizonImpactCad)}
                        </div>
                    </div>

                    <div className="rounded-xl border border-bordure bg-surface-douce p-2.5 sm:p-3 min-w-0">
                        <div className="text-[11px] sm:text-tiny text-texte-doux truncate">Date retraite</div>
                        <div className="text-meta sm:text-body font-mono font-bold text-texte tabular-nums mt-0.5 truncate">
                            {renderMonthsDelta(summary.retirementMonthsDelta)}
                        </div>
                    </div>
                </div>
            )}

            {!compact && summary.headlineFr && (
                <details className="text-tiny text-texte-doux">
                    <summary className="cursor-pointer select-none hover:text-texte">
                        Détails du marché
                    </summary>
                    <p className="mt-1.5 text-texte-doux">{summary.headlineFr}</p>
                </details>
            )}
        </section>
    );
};
