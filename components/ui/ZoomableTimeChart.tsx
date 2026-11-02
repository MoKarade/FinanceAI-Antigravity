import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { GF_CROSSHAIR_CURSOR, GF_ACTIVE_DOT } from '../../utils/chartTooltip';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceDot, ReferenceArea } from 'recharts';
import { formatCompactCAD, formatVariationPct } from '../../utils/format';
import { PrivateAmount } from './PrivateAmount';
import { useTimeChartZoom } from '../../hooks/useTimeChartZoom';
import { ChartDataTable, type ChartDataColumn } from './ChartDataTable';
import { MASKED_AMOUNT_LABEL } from '../../utils/privacyAria';
import { maskedTick } from '../../utils/chartPrivacy';
import { useFinanceStore } from '../../store/useFinanceStore';

/**
 * Phase D.2 — graphique temporel avec zoom molette + pan-on-drag.
 *
 * L'interaction (molette / pan / reset) vit désormais dans le hook réutilisable
 * `useTimeChartZoom` (cf. G4), partagé avec le graphique Futur. Ce composant ne
 * garde que le rendu Recharts générique (aires empilées ou lignes overlay).
 *
 *   - **Molette** : zoom in/out centré sur la position du curseur
 *   - **Drag** : pan latéral (gauche/droite) en gardant l'échelle de zoom
 *   - **Double-clic** : reset à la vue complète
 *
 * Multi-échelle : le `tickFormatter` adapte la précision selon le span visible
 * (heure, jour, mois, année).
 */

export interface ZoomableSeries {
    key: string;
    color: string;
    name?: string;
    stackId?: string;
    /** Type de rendu : 'area' (stacked par défaut) ou 'line' (overlay non empilé) */
    type?: 'area' | 'line';
    /** Épaisseur de la ligne pour type='line' (défaut 2) */
    strokeWidth?: number;
}

interface ZoomableTimeChartProps {
    data: Array<Record<string, unknown>>;
    /** Clé du timestamp (string ISO ou Date) */
    xKey: string;
    series: ZoomableSeries[];
    /** Hauteur du chart (défaut 450, parent doit avoir une hauteur définie pour ResponsiveContainer) */
    height?: number | string;
    /** Mode privacy : masque les valeurs Y et tooltip */
    privacyMode?: boolean;
    /** Stacked area chart (défaut true) */
    stacked?: boolean;
    /** Formatteur custom pour les valeurs Y (par défaut : compact k$/M$) */
    yFormatter?: (val: number) => string;
    /** Affiche la barre de contrôles (périodes + plein écran). Défaut true. */
    showControls?: boolean;
    /**
     * [FUTUR-AXE-Y-MINIMAL, FinanceAI#1144] Masque l'axe Y numérique (55 px récupérés pour le tracé)
     * et le remplace par un badge portant la valeur du DERNIER point visible. Fourni par l'appelant,
     * défaut `false` : les autres usages (StockChart, comparateur de titres) gardent leur axe.
     * Le badge n'existe qu'en mode empilé (le haut de la pile = la somme des séries) et seulement
     * si chaque série empilée a une valeur finie au dernier point — jamais un total partiel.
     */
    axeYMinimal?: boolean;
}

// Présélections de période (lookback depuis la dernière date). On n'affiche que
// celles plus courtes que l'étendue réelle des données (sinon le bouton ne zoome pas).
const PERIOD_PRESETS: ReadonlyArray<{ label: string; days: number }> = [
    { label: '1M', days: 30 },
    { label: '3M', days: 91 },
    { label: '6M', days: 182 },
    { label: '1A', days: 365 },
    { label: '5A', days: 365 * 5 },
];

function formatTick(timestamp: string | number, spanDays: number): string {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '';
    if (spanDays < 2) {
        return d.toLocaleString('fr-CA', { hour: '2-digit', minute: '2-digit' });
    }
    if (spanDays < 90) {
        return d.toLocaleDateString('fr-CA', { month: 'short', day: 'numeric' });
    }
    if (spanDays < 365 * 2) {
        return d.toLocaleDateString('fr-CA', { month: 'short', year: '2-digit' });
    }
    return d.toLocaleDateString('fr-CA', { year: 'numeric' });
}

// MONTANT-MASQUE-AILLEURS — formateur par DÉFAUT, jamais appelé directement : les trois points de
// rendu de ce fichier (tickFormatter, infobulle, table sr-only) le passent tous par
// `privacyMode ? MASKED_AMOUNT_LABEL : yFormatter(val)`.
// [FORMAT-EXPLAINS-TOLOCALESTRING] Trois seuils composés à la main, remplacés par la source unique.
// ⚠️ Un seul changement de rendu, MESURÉ : les millions passent de UNE à DEUX décimales
// (« 2,3 M$ » → « 2,35 M$ »). C'est une étiquette d'AXE, donc un peu plus large ; le reste est
// identique au caractère près. À signaler à Marc plutôt qu'à exempter — une exemption sur l'axe du
// graphique principal serait le plus gros trou de la garde qui accompagne ce lot.
const defaultYFormatter = (val: number) => formatCompactCAD(val); // MONTANT-MASQUE-AILLEURS

/**
 * Valeur du TOOLTIP (exporté pour test — findings panel #495) :
 *  - un point `null` (trou HONNÊTE d'une série éparse, ex. titre pas encore acheté en Base 100)
 *    rend « — », jamais un 0 fabriqué (`val || 0` affichait « +0,00 % » sur l'absence de donnée) ;
 *  - la valeur passe par `yFormatter` (avant : `formatCAD` EN DUR → « 10 $ » affiché en mode
 *    Base 100 au lieu de « +10 % » — devenu visible partout avec l'auto-défaut Base 100).
 */
export function tooltipValue(
    val: number | null | undefined,
    privacyMode: boolean,
    yFormatter: (v: number) => string,
): string {
    if (val == null || !Number.isFinite(val)) return '—';
    return privacyMode ? MASKED_AMOUNT_LABEL : yFormatter(val);
}

/**
 * Total EMPILÉ du dernier point visible (haut de la pile d'aires = ce que le badge ancre). `null`
 * si la valeur n'est pas honnêtement calculable : aucune aire, une série absente/non finie au
 * dernier point (un trou n'est pas un 0 — le total serait partiel). Les séries `line` (ex. la
 * ligne « Total » superposée) ne s'empilent pas : exclues.
 */
export function totalEmpileDernierPoint(
    visibleData: ReadonlyArray<Record<string, unknown>>,
    series: ReadonlyArray<ZoomableSeries>,
): number | null {
    const last = visibleData[visibleData.length - 1];
    const aires = series.filter((s) => s.type !== 'line');
    if (!last || aires.length === 0) return null;
    let total = 0;
    for (const s of aires) {
        const v = last[s.key];
        if (typeof v !== 'number' || !Number.isFinite(v)) return null;
        total += v;
    }
    return total;
}

/**
 * Forme du badge « valeur du dernier point » (`ReferenceDot`, recharts y injecte `cx`/`cy`).
 * Le dernier point colle au bord droit du graphe : la pastille se pose à sa GAUCHE (contrairement
 * à `TodayValueBadge`, ancrée à droite d'un point central) et reste dans la zone visible.
 */
export const BadgeValeurFinale = (props: { cx?: number; cy?: number; value?: string }) => {
    const { cx, cy, value } = props;
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !value) return null;
    const h = 22;
    const w = Math.round(value.length * 12 * 0.58 + 20);
    const x = Math.max(2, (cx as number) - w - 8);
    const y = Math.max(2, (cy as number) - h - 8);
    return (
        <g aria-hidden="true" style={{ pointerEvents: 'none' }}>
            <circle cx={cx} cy={cy} r={4} fill="#ffffff" stroke="#0B0E14" strokeWidth={1.5} />
            <rect x={x} y={y} width={w} height={h} rx={11} fill="#0B0E14" fillOpacity={0.92} stroke="#ffffff" strokeOpacity={0.55} />
            <text x={x + w / 2} y={y + h / 2 + 0.5} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize={12} fontWeight="bold">{value}</text>
        </g>
    );
};

export const ZoomableTimeChart: React.FC<ZoomableTimeChartProps> = ({
    data,
    xKey,
    series,
    height = 450,
    privacyMode = false,
    stacked = true,
    yFormatter = defaultYFormatter,
    showControls = true,
    axeYMinimal = false,
}) => {
    const activeTab = useFinanceStore((s) => s.activeTab);
    const { containerRef, containerEl, visibleData, isZoomed, isPanning, handlers, reset, showRange, zoomIn, zoomOut, panByRatio, windowRatio } = useTimeChartZoom(data);

    const spanDays = useMemo(() => {
        if (visibleData.length < 2) return 0;
        const first = new Date(visibleData[0][xKey] as string).getTime();
        const last = new Date(visibleData[visibleData.length - 1][xKey] as string).getTime();
        return (last - first) / (1000 * 60 * 60 * 24);
    }, [visibleData, xKey]);

    // Étendue totale des données (pour ne proposer que les périodes pertinentes).
    const totalSpanDays = useMemo(() => {
        if (data.length < 2) return 0;
        const first = new Date(data[0][xKey] as string).getTime();
        const last = new Date(data[data.length - 1][xKey] as string).getTime();
        return (last - first) / (1000 * 60 * 60 * 24);
    }, [data, xKey]);

    const availablePeriods = useMemo(
        () => PERIOD_PRESETS.filter((p) => p.days < totalSpanDays),
        [totalSpanDays],
    );

    // Affiche les `days` derniers jours : 1er indice dont la date >= (dernière date − days).
    const showPeriod = useCallback((days: number) => {
        if (data.length < 2) return;
        const lastTs = new Date(data[data.length - 1][xKey] as string).getTime();
        const fromTs = lastTs - days * 86_400_000;
        let fromIdx = data.findIndex((d) => new Date(d[xKey] as string).getTime() >= fromTs);
        if (fromIdx < 0) fromIdx = 0;
        showRange(fromIdx, data.length - 1);
    }, [data, xKey, showRange]);

    // Plein écran natif sur le conteneur du graphe (Fullscreen API).
    const [isFullscreen, setIsFullscreen] = useState(false);
    useEffect(() => {
        const onFsChange = () => setIsFullscreen(document.fullscreenElement === containerEl.current);
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, [containerEl]);
    const toggleFullscreen = useCallback(() => {
        const el = containerEl.current;
        if (!el) return;
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
        else el.requestFullscreen?.().catch(() => {});
    }, [containerEl]);

    // [FUTUR-AXE-Y-MINIMAL] Valeur du badge : calculée seulement quand l'axe est masqué ET empilé,
    // formatée comme l'axe (`yFormatter`) et masquée en mode discret (`maskedTick`, source du « *** »).
    const badgeFinal = useMemo(() => {
        if (!axeYMinimal || !stacked || visibleData.length === 0) return null;
        const total = totalEmpileDernierPoint(visibleData, series);
        if (total === null) return null;
        return {
            x: visibleData[visibleData.length - 1][xKey] as string | number,
            y: total,
            texte: maskedTick(privacyMode, yFormatter)(total),
        };
    }, [axeYMinimal, stacked, visibleData, series, xKey, privacyMode, yFormatter]);

    // [A11Y-CHARTS] colonnes de la table de données sr-only (alternative texte au graphe Recharts,
    // opaque aux lecteurs d'écran). Le mode privé masque les valeurs (parité avec l'axe/tooltip).
    const dataColumns = useMemo<ChartDataColumn[]>(() => [
        { key: xKey, label: 'Date', format: (v) => { const d = new Date(v as string); return isNaN(d.getTime()) ? String(v ?? '') : d.toLocaleDateString('fr-CA'); } },
        ...series.map((s) => ({
            key: s.key,
            label: s.name ?? s.key,
            format: (v: unknown) => privacyMode ? MASKED_AMOUNT_LABEL : yFormatter(Number(v) || 0),
        })),
    ], [xKey, series, privacyMode, yFormatter]);

    const startPct = Math.round((windowRatio?.start ?? 0) * 100);
    const widthPct = Math.max(4, Math.round(((windowRatio?.end ?? 1) - (windowRatio?.start ?? 0)) * 100));

    // Comparaison par glisser-déposer (click-and-drag) entre deux dates visibles
    const [compIndices, setCompIndices] = useState<[number, number] | null>(null);
    const dragCompRef = useRef<{ startIdx: number; startX: number; active: boolean } | null>(null);

    const resolveIdx = useCallback((clientX: number, host: HTMLElement): number | null => {
        if (visibleData.length < 2) return null;
        const gridEl = host.querySelector('.recharts-cartesian-grid') ?? host.querySelector('.recharts-surface') ?? host;
        const rect = gridEl.getBoundingClientRect();
        if (rect.width <= 0) return null;
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(ratio * (visibleData.length - 1));
    }, [visibleData.length]);

    const handlePointerDownCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (isZoomed || e.button !== 0 || e.pointerType === 'touch') return;
        const target = e.target as HTMLElement | null;
        if (target?.closest('button, a, input, select')) return;
        const idx = resolveIdx(e.clientX, e.currentTarget);
        if (idx === null) return;
        dragCompRef.current = { startIdx: idx, startX: e.clientX, active: false };
    }, [isZoomed, resolveIdx]);

    const handlePointerMoveCapture = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        const st = dragCompRef.current;
        if (!st) return;
        if (!st.active && Math.abs(e.clientX - st.startX) < 10) return;
        st.active = true;
        const idx = resolveIdx(e.clientX, e.currentTarget);
        if (idx === null) return;
        setCompIndices([Math.min(st.startIdx, idx), Math.max(st.startIdx, idx)]);
    }, [resolveIdx]);

    const handlePointerUpCapture = useCallback(() => {
        dragCompRef.current = null;
    }, []);

    const rowValue = useCallback((row: Record<string, unknown>): number | null => {
        if (!row) return null;
        if (stacked) {
            const aires = series.filter((s) => s.type !== 'line');
            if (aires.length > 0) {
                let sum = 0;
                for (const s of aires) {
                    const v = Number(row[s.key]);
                    if (Number.isFinite(v)) sum += v;
                }
                return sum;
            }
        }
        for (const s of series) {
            const v = Number(row[s.key]);
            if (Number.isFinite(v)) return v;
        }
        return null;
    }, [series, stacked]);

    const compStats = useMemo(() => {
        if (!compIndices || visibleData.length < 2) return null;
        const [lo, hi] = compIndices;
        if (lo === hi || !visibleData[lo] || !visibleData[hi]) return null;
        const valA = rowValue(visibleData[lo]);
        const valB = rowValue(visibleData[hi]);
        if (valA === null || valB === null) return null;
        const delta = valB - valA;
        const pct = Math.abs(valA) > 0 ? (delta / Math.abs(valA)) * 100 : null;
        const xA = visibleData[lo][xKey] as string | number;
        const xB = visibleData[hi][xKey] as string | number;
        return {
            xA,
            xB,
            labelA: formatTick(xA, spanDays),
            labelB: formatTick(xB, spanDays),
            delta,
            pct,
        };
    }, [compIndices, visibleData, rowValue, xKey, spanDays]);

    return (
        <>
        <div
            ref={containerRef}
            data-testid="zoomable-chart-entrance"
            data-active-tab={activeTab}
            className={`relative w-full h-full select-none gf-chart-enter ${isZoomed && isPanning ? 'cursor-grabbing' : (isZoomed ? 'cursor-grab' : 'cursor-crosshair')} ${isFullscreen ? 'bg-surface p-4' : ''}`}
            {...handlers}
            onPointerDownCapture={handlePointerDownCapture}
            onPointerMoveCapture={handlePointerMoveCapture}
            onPointerUpCapture={handlePointerUpCapture}
            onPointerCancelCapture={handlePointerUpCapture}
            style={{ height: isFullscreen ? '100vh' : height }}
            role="img"
            aria-label="Graphique temporel — glisser pour comparer deux dates, molette ou pincement pour zoomer, double-clic pour réinitialiser"
        >
            {/* Barre de contrôles : périodes (gauche) + zoom/pan/plein écran (droite). */}
            {showControls && (
                <div className="absolute top-1.5 sm:top-2 left-1.5 sm:left-2 max-w-[calc(100%-7.5rem)] sm:max-w-none overflow-x-auto no-scrollbar z-10 flex items-center gap-1 sm:flex-wrap">
                    {availablePeriods.map((p) => (
                        <button
                            key={p.label}
                            type="button"
                            onClick={() => showPeriod(p.days)}
                            className="shrink-0 px-2 py-0.5 text-tiny font-bold rounded-card bg-white/10 hover:bg-white/20 border border-white/15 text-ink-200 transition-colors focus-ring"
                            title={`Afficher les ${p.label} derniers`}
                        >
                            {p.label}
                        </button>
                    ))}
                    {availablePeriods.length > 0 && (
                        <button
                            type="button"
                            onClick={reset}
                            className={`shrink-0 px-2 py-0.5 text-tiny font-bold rounded-card border transition-colors focus-ring ${isZoomed ? 'bg-white/10 hover:bg-white/20 border-white/15 text-ink-200' : 'bg-indigo-500/25 border-indigo-400/40 text-white'}`}
                            title="Vue complète"
                        >
                            Tout
                        </button>
                    )}
                    {compStats && (
                        <div className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-card bg-surface border border-repere/40 text-tiny font-mono shadow-lg">
                            <span className="text-ink-200 font-semibold">
                                {compStats.labelA} → {compStats.labelB}
                            </span>
                            <span className={`px-1.5 py-0.5 rounded-xs font-bold ${compStats.delta >= 0 ? 'gf-delta-up' : 'gf-delta-down'}`}>
                                <PrivateAmount>{compStats.delta >= 0 ? '+' : ''}{yFormatter(compStats.delta)}</PrivateAmount>
                                {compStats.pct !== null && (
                                    <> (<PrivateAmount>{formatVariationPct(compStats.pct, 1)}</PrivateAmount>)</>
                                )}
                            </span>
                            <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setCompIndices(null); }}
                                className="touch-target inline-flex items-center justify-center px-1 text-ink-400 hover:text-ink-50 focus-ring rounded-xs"
                                aria-label="Effacer la plage comparée"
                                title="Effacer la comparaison"
                            >
                                ×
                            </button>
                        </div>
                    )}
                </div>
            )}
            {showControls && (
                <div className="absolute top-1.5 sm:top-2 right-1.5 sm:right-2 z-10 flex items-center gap-1 sm:gap-1.5">
                    {data.length > 2 && (
                        <div className="gf-chart-toolbar">
                            {isZoomed && (
                                <>
                                    <button
                                        type="button"
                                        onClick={() => panByRatio(-0.35)}
                                        className="touch-target gf-chart-ctrl-btn focus-ring"
                                        title="Déplacer vers la gauche"
                                        aria-label="Déplacer vers la gauche"
                                    >
                                        ‹
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => panByRatio(0.35)}
                                        className="touch-target gf-chart-ctrl-btn focus-ring"
                                        title="Déplacer vers la droite"
                                        aria-label="Déplacer vers la droite"
                                    >
                                        ›
                                    </button>
                                </>
                            )}
                            <button
                                type="button"
                                onClick={zoomOut}
                                disabled={!isZoomed}
                                className="touch-target gf-chart-ctrl-btn focus-ring"
                                title="Dézoomer"
                                aria-label="Dézoomer"
                            >
                                −
                            </button>
                            <button
                                type="button"
                                onClick={zoomIn}
                                disabled={false}
                                className="touch-target gf-chart-ctrl-btn focus-ring"
                                title="Zoomer"
                                aria-label="Zoomer"
                            >
                                +
                            </button>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="px-2 py-0.5 text-tiny font-bold rounded-card bg-white/10 hover:bg-white/20 border border-white/15 text-ink-200 transition-colors focus-ring"
                        title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                        aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                    >
                        {isFullscreen ? 'Réduire' : 'Plein écran'}
                    </button>
                </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={visibleData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                        {series.map((s, idx) => (
                            <linearGradient key={s.key} id={`ztc-grad-${idx}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={s.color} stopOpacity={0.22} />
                                <stop offset="92%" stopColor={s.color} stopOpacity={0.01} />
                            </linearGradient>
                        ))}
                    </defs>
                    <CartesianGrid strokeDasharray="2 3" stroke="#2a2a2a" vertical={false} />
                    <XAxis
                        dataKey={xKey}
                        stroke="#555"
                        tickLine={false}
                        axisLine={false}
                        tick={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                        minTickGap={40}
                        tickFormatter={(str) => formatTick(str, spanDays)}
                    />
                    {axeYMinimal ? (
                        // Axe masqué (domaine identique) : le tracé récupère la gouttière de 55 px.
                        <YAxis hide domain={['auto', 'auto']} />
                    ) : (
                        <YAxis
                            stroke="#555"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}
                            width={55}
                            domain={['auto', 'auto']}
                            tickFormatter={(val) => privacyMode ? '***' : yFormatter(val)}
                        />
                    )}
                    <Tooltip
                        cursor={GF_CROSSHAIR_CURSOR}
                        isAnimationActive={true}
                        animationDuration={90}
                        content={
                            <ZoomableChartTooltip
                                series={series}
                                stacked={stacked}
                                privacyMode={privacyMode}
                                yFormatter={yFormatter}
                            />
                        }
                    />
                    <Legend verticalAlign="top" iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                    {compStats && (
                        <ReferenceArea
                            x1={compStats.xA}
                            x2={compStats.xB}
                            fill="var(--repere)"
                            fillOpacity={0.14}
                            stroke="var(--repere)"
                            strokeOpacity={0.45}
                        />
                    )}
                    {series.map((s, idx) =>
                        s.type === 'line' ? (
                            <Line
                                key={s.key}
                                type="monotone"
                                dataKey={s.key}
                                stroke={s.color}
                                strokeWidth={s.strokeWidth ?? 1.65}
                                dot={false}
                                activeDot={GF_ACTIVE_DOT}
                                name={s.name ?? s.key}
                                isAnimationActive={!isPanning}
                                animationBegin={idx * 45}
                                animationDuration={480}
                                animationEasing="ease-out"
                            />
                        ) : (
                            <Area
                                key={s.key}
                                type="monotone"
                                dataKey={s.key}
                                stackId={stacked ? (s.stackId ?? '1') : undefined}
                                stroke={s.color}
                                strokeWidth={s.strokeWidth ?? 1.45}
                                fill={`url(#ztc-grad-${idx})`}
                                activeDot={GF_ACTIVE_DOT}
                                name={s.name ?? s.key}
                                isAnimationActive={!isPanning}
                                animationBegin={idx * 45}
                                animationDuration={480}
                                animationEasing="ease-out"
                            />
                        ),
                    )}
                    {badgeFinal && (
                        <ReferenceDot
                            x={badgeFinal.x}
                            y={badgeFinal.y}
                            r={0}
                            ifOverflow="extendDomain"
                            shape={<BadgeValeurFinale value={badgeFinal.texte} />}
                        />
                    )}
                </ComposedChart>
            </ResponsiveContainer>

            {/* Reset autonome quand la barre de contrôles est masquée (sinon « Tout » l'assure). */}
            {isZoomed && !showControls && (
                <button
                    type="button"
                    onClick={reset}
                    className="absolute top-2 right-2 px-2 py-1 text-tiny bg-white/10 hover:bg-white/20 border border-white/15 rounded-card text-ink-200 font-medium transition-colors focus-ring"
                    title="Réinitialiser la vue (double-clic aussi)"
                >
                    ↺ Vue complète
                </button>
            )}
            {isZoomed && data.length > 1 ? (
                <div className="gf-chart-minimap bg-black/30" aria-hidden="true">
                    <div
                        className="gf-chart-minimap-thumb"
                        style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                    />
                </div>
            ) : (
                <span className="sr-only">Molette ou pincement = zoom · double-clic = réinitialiser</span>
            )}
        </div>
        <ChartDataTable caption="Graphique d'évolution dans le temps" columns={dataColumns} rows={data} />
        </>
    );
};

interface ZoomableChartTooltipProps {
    active?: boolean;
    label?: string | number;
    payload?: Array<{ dataKey?: string | number; name?: string; value?: number | null; color?: string }>;
    series: ReadonlyArray<ZoomableSeries>;
    stacked: boolean;
    privacyMode: boolean;
    yFormatter: (v: number) => string;
}

const ZoomableChartTooltip: React.FC<ZoomableChartTooltipProps> = ({
    active,
    label,
    payload,
    series,
    stacked,
    privacyMode,
    yFormatter,
}) => {
    if (!active || !payload || payload.length === 0) return null;

    const dateFormatted = (() => {
        if (typeof label === 'string' || typeof label === 'number') {
            const d = new Date(label);
            if (!isNaN(d.getTime())) {
                return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'short', day: 'numeric' });
            }
        }
        return String(label ?? '');
    })();

    const rows = payload
        .map((p) => {
            const key = String(p.dataKey ?? p.name ?? '');
            const def = series.find((s) => s.key === key);
            const val = typeof p.value === 'number' && Number.isFinite(p.value) ? p.value : null;
            return {
                key,
                name: def?.name ?? String(p.name ?? key),
                color: def?.color ?? p.color ?? 'var(--gf-bleu)',
                type: def?.type ?? 'area',
                val,
            };
        })
        .filter((r) => r.val !== null);

    if (rows.length === 0) return null;

    const stackedRows = rows.filter((r) => r.type !== 'line');
    const totalEmpile = stacked && stackedRows.length > 1
        ? stackedRows.reduce((acc, r) => acc + (r.val ?? 0), 0)
        : null;

    return (
        <div className="gf-tooltip-card">
            <div className="gf-tooltip-header">
                <span className="text-xs font-semibold text-ink-50">{dateFormatted}</span>
                <div className="flex items-center gap-1.5">
                    {totalEmpile !== null && (
                        <span className="sm:hidden font-mono text-xs font-bold text-ink-50 tabular-nums">
                            {tooltipValue(totalEmpile, privacyMode, yFormatter)}
                        </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-neutral">
                        {stacked ? 'Empilé' : 'Comparé'}
                    </span>
                </div>
            </div>

            {totalEmpile !== null && (
                <div className="hidden sm:flex gf-tooltip-hero">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-ink-400">Total</span>
                    <span className="font-mono text-sm font-bold text-ink-50 tabular-nums">
                        {tooltipValue(totalEmpile, privacyMode, yFormatter)}
                    </span>
                </div>
            )}

            <div className={rows.length > 1 ? 'grid grid-cols-2 gap-x-3 gap-y-0.5 sm:block sm:space-y-1' : 'space-y-1'}>
                {rows.map((r) => (
                    <div key={r.key} className="gf-tooltip-row min-w-0">
                        <span className="flex items-center gap-1.5 text-ink-200 truncate">
                            <span className="gf-tooltip-dot" style={{ backgroundColor: r.color }} aria-hidden="true" />
                            <span className="truncate">{r.name}</span>
                        </span>
                        <span className="font-mono font-semibold text-ink-50 tabular-nums shrink-0">
                            {tooltipValue(r.val, privacyMode, yFormatter)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

