import React, { useRef, useCallback } from 'react';
import { Tab } from '../../types';
import { ProjectionChartPoint } from '../../services/projection/types';
import { PrivateAmount } from '../ui/PrivateAmount';
import { formatCompactCAD, formatSigned } from '../../utils/format';
import { prefetchTab } from '../../utils/tabPrefetch';
import type { TimeChartZoom } from '../../hooks/useTimeChartZoom';

export type ModeAffichageCourbe = 'nette' | 'empilee';

export interface JalonCourbeRapide {
    cle: string;
    libelle: string;
    annee: number | null;
    point: ProjectionChartPoint | null;
    index: number;
    tabCible: Tab;
    libelleCible: string;
    ton?: 'default' | 'fire' | 'retraite' | 'immo';
}

interface FutureCurveToolbarProps {
    modeCourbe: ModeAffichageCourbe;
    onChangeModeCourbe: (mode: ModeAffichageCourbe) => void;
    modeComparaison?: boolean;
    onToggleComparaison?: () => void;
    pointComparaisonA: ProjectionChartPoint | null;
    pointComparaisonB: ProjectionChartPoint | null;
    onClearComparaison: () => void;
    jalonsRapides?: JalonCourbeRapide[];
    onFocusJalon?: (jalon: JalonCourbeRapide) => void;
    onNaviguerTab?: (tab: Tab) => void;
    runMC?: boolean;
    onToggleMC?: () => void;
    mcLabel?: string;
}

const BTN_SEG_BASE = 'touch-target inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-tiny font-semibold transition-colors cursor-pointer focus-ring';
const BTN_SEG_ACTIF = 'bg-primary/20 text-primary border border-primary/40';
const BTN_SEG_INACTIF = 'text-ink-300 hover:text-ink-50 border border-transparent';

const PILL_JALON = 'inline-flex items-center gap-1 rounded-lg border border-bordure bg-surfaceHighlight/25 px-2 py-0.5 text-tiny transition-colors hover:border-primary/60';

export const FutureCurveToolbar: React.FC<FutureCurveToolbarProps> = ({
    modeCourbe,
    onChangeModeCourbe,
    modeComparaison = false,
    onToggleComparaison,
    pointComparaisonA,
    pointComparaisonB,
    onClearComparaison,
    jalonsRapides = [],
    onFocusJalon,
    onNaviguerTab,
    mcLabel,
}) => {
    const compOrdonnee = React.useMemo(() => {
        if (!pointComparaisonA || !pointComparaisonB) return null;
        const [debut, fin] = pointComparaisonA.monthIndex <= pointComparaisonB.monthIndex
            ? [pointComparaisonA, pointComparaisonB]
            : [pointComparaisonB, pointComparaisonA];
        const valDebut = Number(debut.NetWorth) || 0;
        const valFin = Number(fin.NetWorth) || 0;
        const deltaDollar = valFin - valDebut;
        const deltaPct = Math.abs(valDebut) > 1 ? ((valFin - valDebut) / Math.abs(valDebut)) * 100 : null;
        const ecartMois = Math.max(1, Math.round(fin.monthIndex - debut.monthIndex));
        const ecartAnnees = Math.round((ecartMois / 12) * 10) / 10;
        return { debut, fin, valDebut, valFin, deltaDollar, deltaPct, ecartMois, ecartAnnees };
    }, [pointComparaisonA, pointComparaisonB]);

    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <div
                    role="group"
                    aria-label="Mode d'affichage de la courbe"
                    title={mcLabel}
                    className="inline-flex items-center gap-1 rounded-lg bg-surfaceHighlight/35 p-0.5 border border-bordure"
                >
                    <button
                        type="button"
                        aria-pressed={modeCourbe === 'nette'}
                        onClick={() => onChangeModeCourbe('nette')}
                        className={`${BTN_SEG_BASE} ${modeCourbe === 'nette' ? BTN_SEG_ACTIF : BTN_SEG_INACTIF}`}
                        title="Vue épurée : courbe de valeur nette unique avec dégradé"
                    >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M1.5 12.5L5.5 8.5L9 10.5L14.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Courbe nette</span>
                    </button>
                    <button
                        type="button"
                        aria-pressed={modeCourbe === 'empilee'}
                        onClick={() => onChangeModeCourbe('empilee')}
                        className={`${BTN_SEG_BASE} ${modeCourbe === 'empilee' ? BTN_SEG_ACTIF : BTN_SEG_INACTIF}`}
                        title="Vue détaillée : aires empilées par compte"
                    >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="M1.5 13.5H14.5M1.5 10L6 7L10 8.5L14.5 4M1.5 6.5L6 4L10 5.5L14.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Par compte</span>
                    </button>
                    {onToggleComparaison && (
                        <button
                            type="button"
                            aria-pressed={modeComparaison}
                            onClick={onToggleComparaison}
                            className={`${BTN_SEG_BASE} sm:hidden ${modeComparaison ? BTN_SEG_ACTIF : BTN_SEG_INACTIF}`}
                            title="Comparer deux dates en glissant le doigt sur la courbe"
                        >
                            <span>A ↔ B</span>
                        </button>
                    )}
                </div>

                {compOrdonnee && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1 text-tiny animate-fade-in"
                    >
                        <span className="font-semibold text-ink-100">
                            {compOrdonnee.debut.dateLabel || compOrdonnee.debut.year}
                        </span>
                        <span className="text-ink-400" aria-hidden="true">→</span>
                        <span className="font-semibold text-ink-100">
                            {compOrdonnee.fin.dateLabel || compOrdonnee.fin.year}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-sm bg-surface/60 text-ink-300 font-mono">
                            {compOrdonnee.ecartAnnees >= 1 ? `${compOrdonnee.ecartAnnees}a` : `${compOrdonnee.ecartMois}m`}
                        </span>
                        <span className={`px-2 py-0.5 rounded-sm font-mono font-bold ${compOrdonnee.deltaDollar >= 0 ? 'gf-delta-up' : 'gf-delta-down'}`}>
                            <PrivateAmount>{formatSigned(compOrdonnee.deltaDollar, { withCurrency: true })}</PrivateAmount>
                            {compOrdonnee.deltaPct !== null && Number.isFinite(compOrdonnee.deltaPct) && (
                                <>
                                    {' · '}
                                    <PrivateAmount>{`${compOrdonnee.deltaPct >= 0 ? '+' : ''}${compOrdonnee.deltaPct.toFixed(1)} %`}</PrivateAmount>
                                </>
                            )}
                        </span>
                        <button
                            type="button"
                            onClick={onClearComparaison}
                            aria-label="Effacer la comparaison"
                            title="Effacer la plage comparée"
                            className="touch-target px-1.5 py-0.5 rounded-md text-ink-300 hover:text-ink-50 font-bold cursor-pointer focus-ring"
                        >
                            ×
                        </button>
                    </div>
                )}
            </div>

            {jalonsRapides.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Jalons interactifs de la courbe">
                    {jalonsRapides.map((j) => (
                        <div key={j.cle} className={PILL_JALON}>
                            <button
                                type="button"
                                onClick={() => onFocusJalon?.(j)}
                                className="touch-target inline-flex items-center gap-1 text-ink-200 hover:text-ink-50 cursor-pointer focus-ring rounded-xs"
                                title={`Centrer la courbe sur ${j.libelle}`}
                            >
                                <span className={j.ton === 'fire' ? 'text-warning-400 font-semibold' : 'font-medium'}>
                                    {j.libelle}
                                </span>
                                {j.annee != null && (
                                    <span className="font-mono text-ink-400">
                                        · <PrivateAmount>{j.annee}</PrivateAmount>
                                    </span>
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => onNaviguerTab?.(j.tabCible)}
                                onMouseEnter={() => prefetchTab(j.tabCible)}
                                className="touch-target text-primary hover:underline font-semibold pl-1 border-l border-bordure cursor-pointer focus-ring rounded-xs"
                                title={`Ouvrir ${j.libelleCible}`}
                                aria-label={`Ouvrir ${j.libelleCible} depuis le jalon ${j.libelle}`}
                            >
                                ↗
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

interface FutureTimelineBrushProps {
    zoom: TimeChartZoom<ProjectionChartPoint>;
    totalPoints: number;
    anneeDebut: number;
    anneeFin: number;
    anneeAujourdhui: number;
    ratioAujourdhui: number;
}

export const FutureTimelineBrush: React.FC<FutureTimelineBrushProps> = ({
    zoom,
    totalPoints,
    anneeDebut,
    anneeFin,
    ratioAujourdhui,
}) => {
    const trackRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<{
        mode: 'pan' | 'left' | 'right';
        startX: number;
        initialStartIdx: number;
        initialEndIdx: number;
    } | null>(null);

    const startRatio = zoom.windowRatio.start;
    const endRatio = zoom.windowRatio.end;
    const spanRatio = Math.max(0.03, endRatio - startRatio);

    const indexFromClientX = useCallback((clientX: number): number => {
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || totalPoints <= 1) return 0;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(ratio * (totalPoints - 1));
    }, [totalPoints]);

    const handleTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (totalPoints <= 6) return;
        const target = e.target as HTMLElement;
        const handleRole = target.getAttribute('data-brush-role');
        const currentStart = zoom.range ? zoom.range[0] : 0;
        const currentEnd = zoom.range ? zoom.range[1] : totalPoints - 1;

        if (handleRole === 'left' || handleRole === 'right' || handleRole === 'thumb') {
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            dragStateRef.current = {
                mode: handleRole === 'thumb' ? 'pan' : handleRole,
                startX: e.clientX,
                initialStartIdx: currentStart,
                initialEndIdx: currentEnd,
            };
            return;
        }

        const clickedIdx = indexFromClientX(e.clientX);
        const currentSpan = zoom.isZoomed
            ? Math.max(6, currentEnd - currentStart)
            : Math.max(12, Math.round(totalPoints * 0.35));
        const half = Math.round(currentSpan / 2);
        const newStart = Math.max(0, Math.min(totalPoints - 1 - currentSpan, clickedIdx - half));
        const newEnd = Math.min(totalPoints - 1, newStart + currentSpan);
        zoom.showRange(newStart, newEnd);
    };

    const handleTrackPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragStateRef.current;
        if (!drag || totalPoints <= 6) return;
        const rect = trackRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        const deltaRatio = (e.clientX - drag.startX) / rect.width;
        const deltaIdx = Math.round(deltaRatio * (totalPoints - 1));
        const minSpan = 6;

        if (drag.mode === 'pan') {
            const span = drag.initialEndIdx - drag.initialStartIdx;
            const nextStart = Math.max(0, Math.min(totalPoints - 1 - span, drag.initialStartIdx + deltaIdx));
            zoom.showRange(nextStart, nextStart + span);
        } else if (drag.mode === 'left') {
            const nextStart = Math.max(0, Math.min(drag.initialEndIdx - minSpan, drag.initialStartIdx + deltaIdx));
            zoom.showRange(nextStart, drag.initialEndIdx);
        } else if (drag.mode === 'right') {
            const nextEnd = Math.min(totalPoints - 1, Math.max(drag.initialStartIdx + minSpan, drag.initialEndIdx + deltaIdx));
            zoom.showRange(drag.initialStartIdx, nextEnd);
        }
    };

    const handleTrackPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
        if (dragStateRef.current) {
            dragStateRef.current = null;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
        }
    };

    if (totalPoints <= 6) return null;

    return (
        <div className="flex items-center gap-2 pt-0.5 select-none" aria-label="Mini-navigateur temporel de la courbe">
            <span className="text-[10px] font-mono text-ink-400">{anneeDebut}</span>
            <div
                ref={trackRef}
                onPointerDown={handleTrackPointerDown}
                onPointerMove={handleTrackPointerMove}
                onPointerUp={handleTrackPointerUp}
                onDoubleClick={() => zoom.reset()}
                title="Glisser pour naviguer dans le temps, étirer les bords pour zoomer, double-cliquer pour réinitialiser"
                className="relative h-4 flex-1 rounded-full bg-surfaceHighlight/40 border border-bordure overflow-hidden cursor-pointer"
            >
                {ratioAujourdhui > 0 && ratioAujourdhui < 1 && (
                    <div
                        aria-hidden="true"
                        className="absolute top-0 bottom-0 w-0.5 bg-cyan-400/60 pointer-events-none"
                        style={{ left: `${ratioAujourdhui * 100}%` }}
                    />
                )}
                <div
                    data-brush-role="thumb"
                    className="absolute top-0 bottom-0 rounded-full bg-primary/25 border border-primary/60 cursor-grab active:cursor-grabbing flex items-center justify-between"
                    style={{
                        left: `${startRatio * 100}%`,
                        width: `${spanRatio * 100}%`,
                    }}
                >
                    <span
                        data-brush-role="left"
                        className="h-full w-2 bg-primary/50 hover:bg-primary cursor-ew-resize rounded-l-full"
                        aria-hidden="true"
                    />
                    <span className="h-1.5 w-3 rounded-full bg-primary/50 pointer-events-none" aria-hidden="true" />
                    <span
                        data-brush-role="right"
                        className="h-full w-2 bg-primary/50 hover:bg-primary cursor-ew-resize rounded-r-full"
                        aria-hidden="true"
                    />
                </div>
            </div>
            <span className="text-[10px] font-mono text-ink-400"><PrivateAmount>{anneeFin}</PrivateAmount></span>
        </div>
    );
};
