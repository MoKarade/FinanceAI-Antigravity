import React from 'react';
import type { PointJour } from '../projection/panneauJour/sections';
import { formatCAD, formatCompactCAD, formatPercent } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';
import { Icon } from '../ui/Icon';
import { useAnimatedNumber } from '../../hooks/useAnimatedNumber';
import { useFinanceStore } from '../../store/useFinanceStore';
import { couleurSerie } from './seriesConfig';

interface GoogleFinanceHeroProps {
    /** Point actuellement inspecté au survol ou figé au clic (ou Aujourd'hui par défaut). */
    jourAffiche: PointJour | null;
    /** Point d'ancrage « Aujourd'hui » (frontière entre le passé réel et la projection future). */
    pointAncre: PointJour | null;
    /** Vrai si l'utilisateur a cliqué sur la courbe pour figer un jour précis. */
    estFige: boolean;
    /** Libère le jour figé pour revenir au suivi fluide du curseur. */
    onLibererJour: () => void;
    /** Vrai si le zoom fluide est actif sur la courbe. */
    isZoomed: boolean;
    /** Réinitialise le zoom fluide à la vue complète Passé + Futur. */
    onResetZoom: () => void;
    /** Centre ou sélectionne le point « Aujourd'hui ». */
    onFocusToday: () => void;
    /** Ouvre le centre unifié de connexions et d'import rapide. */
    onOpenConnections?: () => void;
}

const TIRET = '—';

const SEGMENTS_VISUELS = [
    { cle: 'CELI', label: 'CELI' },
    { cle: 'REER', label: 'REER' },
    { cle: 'CELIAPP', label: 'CELIAPP' },
    { cle: 'Immobilier', label: 'Immo' },
    { cle: 'NonReg', label: 'Non-enreg.' },
    { cle: 'Liquidites', label: 'Cash' },
    { cle: 'Crypto', label: 'Crypto' },
] as const;

function estFini(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * En-tête héroïque de style Google Finance au-dessus de la courbe unifiée Passé + Aujourd'hui + Futur.
 * Affiche le patrimoine net en grands chiffres tabulaires animés, la pastille de variation ($ et %)
 * et une jauge visuelle de répartition des actifs mise à jour en direct au survol.
 */
export const GoogleFinanceHero: React.FC<GoogleFinanceHeroProps> = ({
    jourAffiche,
    pointAncre,
    estFige,
    onLibererJour,
    isZoomed,
    onResetZoom,
    onOpenConnections,
}) => {
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const pointActif = jourAffiche ?? pointAncre;
    const valeurActive = estFini(pointActif?.NetWorth) ? pointActif.NetWorth : null;
    const valeurAncre = estFini(pointAncre?.NetWorth) ? pointAncre.NetWorth : null;
    const valeurAnimee = useAnimatedNumber(valeurActive, 220);

    const memePointQuAncre = Boolean(
        pointActif &&
            pointAncre &&
            ((pointActif.dayIso && pointAncre.dayIso && pointActif.dayIso === pointAncre.dayIso) ||
                (!pointActif.dayIso && pointActif.monthIndex === pointAncre.monthIndex)),
    );
    const estPasse = Boolean(
        !memePointQuAncre &&
            pointActif &&
            pointAncre &&
            pointActif.monthIndex < pointAncre.monthIndex,
    );
    const estAujourdhui = memePointQuAncre;

    const ecartDollar =
        valeurActive !== null && valeurAncre !== null && !estAujourdhui
            ? valeurActive - valeurAncre
            : null;
    const ecartPct =
        ecartDollar !== null && valeurAncre !== null && Math.abs(valeurAncre) > 0.01
            ? (ecartDollar / Math.abs(valeurAncre)) * 100
            : null;

    const libellePeriode = estAujourdhui
        ? 'Aujourd’hui'
        : estPasse
            ? 'Passé reconstitué'
            : 'Projection future';

    const classeBadgePeriode = estAujourdhui
        ? 'gf-delta-amber'
        : estPasse
            ? 'gf-delta-neutral'
            : 'gf-delta-up';

    const signeDelta = ecartDollar !== null ? (ecartDollar > 0 ? '+' : '') : '';
    const classeDelta =
        ecartDollar === null || Math.abs(ecartDollar) < 1
            ? 'gf-delta-neutral'
            : ecartDollar > 0
                ? 'gf-delta-up'
                : 'gf-delta-down';

    const repartition = React.useMemo(() => {
        if (!pointActif) return [];
        const items = SEGMENTS_VISUELS.map((s) => {
            const val = Number(pointActif[s.cle as keyof PointJour]);
            return { ...s, val: Number.isFinite(val) && val > 0 ? val : 0, color: couleurSerie(s.cle) };
        }).filter((s) => s.val > 100);
        const total = items.reduce((acc, s) => acc + s.val, 0);
        if (total <= 0) return [];
        return items.map((s) => ({
            ...s,
            pct: Math.max(3, Math.round((s.val / total) * 100)),
        }));
    }, [pointActif]);

    return (
        <div
            data-testid="google-finance-hero"
            className="pb-2 sm:pb-2.5 border-b border-bordure flex flex-col gap-1.5 sm:gap-2 gf-chart-enter"
        >
            <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
                <div className="flex flex-wrap items-baseline gap-2 sm:gap-3 min-w-0">
                    <div className="text-2xl sm:text-4xl font-bold tracking-tight text-ink-50 font-mono tabular-nums transition-transform duration-150">
                        {valeurAnimee !== null ? (
                            <PrivateAmount>{formatCAD(Math.round(valeurAnimee))}</PrivateAmount>
                        ) : (
                            <span>{TIRET}</span>
                        )}
                    </div>

                    {ecartDollar !== null && Math.abs(ecartDollar) >= 1 && (
                        <span className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-0.5 rounded-full text-[11px] sm:text-sm font-semibold font-mono tabular-nums transition-colors duration-200 ${classeDelta}`}>
                            <span aria-hidden="true">{ecartDollar >= 0 ? '↑' : '↓'}</span>
                            <PrivateAmount>{`${signeDelta}${formatCompactCAD(ecartDollar)}${ecartPct !== null ? ` (${signeDelta}${formatPercent(ecartPct, 1)})` : ''}`}</PrivateAmount>
                        </span>
                    )}

                    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] sm:text-[11px] font-semibold transition-colors duration-200 ${classeBadgePeriode}`}>
                        <span className="w-1.5 h-1.5 rounded-full bg-current gf-pulse-live" aria-hidden="true" />
                        {libellePeriode}
                    </span>

                    {estFige && (
                        <button
                            type="button"
                            onClick={onLibererJour}
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-surfaceHighlight text-ink-100 border border-bordure hover:border-bordure-champ transition-colors touch-target"
                            title="Libérer le jour figé et reprendre la lecture au survol"
                        >
                            <Icon name="lock" size={12} aria-hidden="true" />
                            <span className="text-ink-300 underline">Libérer</span>
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    {pointActif && (
                        <div className="flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-lg bg-surfaceHighlight/30 border border-bordure text-[11px] sm:text-xs text-ink-200 font-mono tabular-nums">
                            <span className="font-semibold text-ink-50">
                                {String(pointActif.dateLabel || pointActif.name || '')}
                            </span>
                            {estFini(pointActif.age) && pointActif.age > 0 && (
                                <span className="text-ink-300">
                                    · <PrivateAmount>{`${Math.round(pointActif.age)} ans`}</PrivateAmount>
                                </span>
                            )}
                        </div>
                    )}

                    {isZoomed && (
                        <button
                            type="button"
                            onClick={onResetZoom}
                            title="Réinitialiser le zoom"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold gf-delta-neutral hover:opacity-90 transition-opacity touch-target"
                        >
                            <Icon name="refresh" size={13} />
                            <span className="sr-only">Réinitialiser le zoom</span>
                        </button>
                    )}

                    {onOpenConnections && (
                        <button
                            type="button"
                            onClick={onOpenConnections}
                            title="Connexions et synchronisation"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold gf-delta-neutral hover:opacity-90 transition-opacity touch-target"
                        >
                            <Icon name="cloud" size={14} />
                            <span className="hidden sm:inline">Connexions</span>
                        </button>
                    )}
                </div>
            </div>

            {repartition.length > 0 && (
                <div className="space-y-1 pt-0.5" aria-label="Répartition visuelle des actifs au jour affiché">
                    <div className="flex h-1.5 sm:h-2 w-full rounded-full overflow-hidden bg-surfaceHighlight/50 gap-0.5 gf-bar-grow">
                        {repartition.map((s) => (
                            <div
                                key={s.cle}
                                style={{ width: `${isPrivacyMode ? 20 : s.pct}%`, backgroundColor: s.color }}
                                className="h-full transition-all duration-200 first:rounded-l-full last:rounded-r-full"
                                title={s.label}
                            />
                        ))}
                    </div>
                    <div className="hidden sm:flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-mono text-ink-300">
                        {repartition.slice(0, 5).map((s) => (
                            <span key={s.cle} className="inline-flex items-center gap-1 shrink-0">
                                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                                <span className="text-ink-400 font-sans">{s.label}</span>
                                <PrivateAmount className="text-ink-100 font-semibold">{formatCompactCAD(s.val)}</PrivateAmount>
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
