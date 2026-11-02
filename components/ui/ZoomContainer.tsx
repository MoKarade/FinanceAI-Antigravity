import React, { useState, useRef, useCallback } from 'react';
import type { TimeChartZoom } from '../../hooks/useTimeChartZoom';
import { PrivateAmount } from './PrivateAmount';
import { formatCompactCAD, formatVariationPct } from '../../utils/format';

/**
 * G7 — enveloppe « Google Finance » réutilisable pour n'importe quel graphique
 * recharts. Pose le ref + les handlers de `useTimeChartZoom` sur le conteneur,
 * gère le curseur (grab/grabbing), la comparaison par glisser-déposer (click-and-drag),
 * le bouton « Vue complète » quand on est zoomé et les contrôles de zoom.
 */
interface ZoomContainerProps {
    zoom: TimeChartZoom<unknown>;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
    /** Affiche le hint « Molette = zoom » en vue complète (défaut true). */
    hint?: boolean;
}

function extrairePointComparaison(row: Record<string, unknown>): {
    xLabel: string;
    yVal: number | null;
    isPercentSeries: boolean;
} {
    const xRaw = row.date ?? row.age ?? row.year ?? row.month ?? '';
    let xLabel = String(xRaw);
    if (typeof row.age === 'number') xLabel = `${row.age} ans`;
    else if (typeof row.month === 'number') xLabel = row.month === 0 ? "auj." : `${row.month} m`;
    else if (typeof row.year === 'number') xLabel = `An ${row.year}`;
    else if (typeof row.date === 'string' && row.date.length >= 7) xLabel = row.date.slice(0, 10);

    const isPercentSeries = 'TOTAL' in row && !('NetWorth' in row) && !('balance' in row);
    const candidateKeys = ['TOTAL', 'NetWorth', 'TotalCapital', 'balance', 'PatrimoineAchat', 'Total', 'Income'];
    for (const k of candidateKeys) {
        const v = row[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
            return { xLabel, yVal: v, isPercentSeries };
        }
    }
    for (const [k, v] of Object.entries(row)) {
        if (k !== 'date' && k !== 'age' && k !== 'year' && k !== 'month' && typeof v === 'number' && Number.isFinite(v)) {
            return { xLabel, yVal: v, isPercentSeries };
        }
    }
    return { xLabel, yVal: null, isPercentSeries: false };
}

export const ZoomContainer: React.FC<ZoomContainerProps> = ({ zoom, className = '', style, children, hint = true }) => {
    const cursor = zoom.isZoomed && zoom.isPanning ? 'cursor-grabbing' : zoom.isZoomed ? 'cursor-grab' : 'cursor-crosshair';
    const startPct = Math.round((zoom.windowRatio?.start ?? 0) * 100);
    const widthPct = Math.max(4, Math.round(((zoom.windowRatio?.end ?? 1) - (zoom.windowRatio?.start ?? 0)) * 100));

    const [dragRange, setDragRange] = useState<{
        startIdx: number;
        endIdx: number;
        leftPct: number;
        widthPct: number;
    } | null>(null);
    const dragRef = useRef<{ startIdx: number; startPct: number; startX: number; active: boolean } | null>(null);

    const resolvePosition = useCallback((clientX: number, host: HTMLElement) => {
        const rows = zoom.visibleData as Array<Record<string, unknown>>;
        if (!rows || rows.length < 2) return null;
        const gridEl = host.querySelector('.recharts-cartesian-grid') ?? host.querySelector('.recharts-surface') ?? host;
        const rect = gridEl.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        if (rect.width <= 0 || hostRect.width <= 0) return null;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const hostPct = Math.max(0, Math.min(100, ((clientX - hostRect.left) / hostRect.width) * 100));
        const idx = Math.round(ratio * (rows.length - 1));
        return { idx, hostPct };
    }, [zoom.visibleData]);

    const handlePointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (zoom.isZoomed || e.button !== 0) return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, input, select')) return;
        const pos = resolvePosition(e.clientX, e.currentTarget);
        if (!pos) return;
        dragRef.current = { startIdx: pos.idx, startPct: pos.hostPct, startX: e.clientX, active: false };
    }, [zoom.isZoomed, resolvePosition]);

    const handlePointerMoveCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const st = dragRef.current;
        if (!st) return;
        if (!st.active && Math.abs(e.clientX - st.startX) < 10) return;
        st.active = true;
        const pos = resolvePosition(e.clientX, e.currentTarget);
        if (!pos) return;
        const left = Math.min(st.startPct, pos.hostPct);
        const w = Math.max(1, Math.abs(pos.hostPct - st.startPct));
        setDragRange({
            startIdx: Math.min(st.startIdx, pos.idx),
            endIdx: Math.max(st.startIdx, pos.idx),
            leftPct: left,
            widthPct: w,
        });
    }, [resolvePosition]);

    const handlePointerUpOrCancel = useCallback(() => {
        dragRef.current = null;
    }, []);

    const rows = zoom.visibleData as Array<Record<string, unknown>>;
    const compStats = (() => {
        if (!dragRange || !rows || rows.length < 2) return null;
        const rowA = rows[dragRange.startIdx];
        const rowB = rows[dragRange.endIdx];
        if (!rowA || !rowB || dragRange.startIdx === dragRange.endIdx) return null;
        const ptA = extrairePointComparaison(rowA);
        const ptB = extrairePointComparaison(rowB);
        if (ptA.yVal === null || ptB.yVal === null) return null;
        const delta = ptB.yVal - ptA.yVal;
        const deltaPct = !ptA.isPercentSeries && Math.abs(ptA.yVal) > 0 ? (delta / Math.abs(ptA.yVal)) * 100 : null;
        return {
            labelA: ptA.xLabel,
            labelB: ptB.xLabel,
            delta,
            deltaPct,
            isPercentSeries: ptA.isPercentSeries,
        };
    })();

    return (
        <div
            ref={zoom.containerRef}
            {...zoom.handlers}
            onPointerDownCapture={handlePointerDownCapture}
            onPointerMoveCapture={handlePointerMoveCapture}
            onPointerUpCapture={handlePointerUpOrCancel}
            onPointerCancelCapture={handlePointerUpOrCancel}
            style={style}
            className={`relative select-none group/gfzoom ${cursor} ${className}`}
        >
            {children}
            {dragRange && compStats && (
                <>
                    <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-2 z-10 bg-repere/10 border-x border-repere/50 rounded-xs"
                        style={{ left: `${dragRange.leftPct}%`, width: `${dragRange.widthPct}%` }}
                    />
                    <div className="absolute top-1 left-1 z-20 inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-surface border border-repere/40 text-tiny font-mono shadow-lg">
                        <span className="text-ink-200 font-semibold">
                            {compStats.labelA} → {compStats.labelB}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded-sm font-bold ${compStats.delta >= 0 ? 'gf-delta-up' : 'gf-delta-down'}`}>
                            <PrivateAmount>
                                {compStats.isPercentSeries
                                    ? formatVariationPct(compStats.delta, 2)
                                    : `${compStats.delta >= 0 ? '+' : ''}${formatCompactCAD(compStats.delta)}`}
                            </PrivateAmount>
                            {compStats.deltaPct !== null && (
                                <> (<PrivateAmount>{formatVariationPct(compStats.deltaPct, 1)}</PrivateAmount>)</>
                            )}
                        </span>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setDragRange(null); }}
                            className="touch-target inline-flex items-center justify-center px-1.5 text-ink-400 hover:text-ink-50 focus-ring rounded-xs"
                            aria-label="Effacer la plage comparée"
                            title="Effacer la comparaison"
                        >
                            ×
                        </button>
                    </div>
                </>
            )}
            <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
                <div className="gf-chart-toolbar opacity-85 group-hover/gfzoom:opacity-100 focus-within:opacity-100 transition-opacity">
                    {zoom.isZoomed && (
                        <>
                            <button
                                type="button"
                                onClick={() => zoom.panByRatio(-0.35)}
                                className="touch-target gf-chart-ctrl-btn focus-ring"
                                title="Déplacer la courbe vers la gauche"
                                aria-label="Déplacer la courbe vers la gauche"
                            >
                                ‹
                            </button>
                            <button
                                type="button"
                                onClick={() => zoom.panByRatio(0.35)}
                                className="touch-target gf-chart-ctrl-btn focus-ring"
                                title="Déplacer la courbe vers la droite"
                                aria-label="Déplacer la courbe vers la droite"
                            >
                                ›
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={zoom.zoomOut}
                        disabled={!zoom.isZoomed}
                        className="touch-target gf-chart-ctrl-btn focus-ring"
                        title="Dézoomer la courbe"
                        aria-label="Dézoomer la courbe"
                    >
                        −
                    </button>
                    <button
                        type="button"
                        onClick={zoom.zoomIn}
                        className="touch-target gf-chart-ctrl-btn focus-ring"
                        title="Zoomer sur la courbe"
                        aria-label="Zoomer sur la courbe"
                    >
                        +
                    </button>
                </div>
                {zoom.isZoomed && (
                    <button
                        type="button"
                        onClick={zoom.reset}
                        className="px-2 py-0.5 text-tiny bg-white/10 hover:bg-white/20 border border-white/15 rounded-sm text-ink-200 font-medium transition-colors focus-ring"
                        title="Réinitialiser la vue (double-clic aussi)"
                    >
                        ↺ Vue complète
                    </button>
                )}
            </div>
            {zoom.isZoomed ? (
                <div className="gf-chart-minimap" aria-hidden="true">
                    <div
                        className="gf-chart-minimap-thumb"
                        style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                    />
                </div>
            ) : hint ? (
                <div className="absolute bottom-1 right-1 text-tiny text-ink-400 pointer-events-none bg-black/30 px-1.5 py-0.5 rounded-sm">
                    Glisser = comparer · Molette = zoom
                </div>
            ) : null}
        </div>
    );
};
