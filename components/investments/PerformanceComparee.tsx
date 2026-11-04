// components/investments/PerformanceComparee.tsx
//
// [S5-REFONTE-PLACEMENTS] « Performance comparée » (maquettes E/M-placements) : variation en % depuis
// le début de la période (base 100) du total et de chaque compte ; période au choix (1, 3, 6 mois,
// tout) ; une étiquette par série, cliquable pour la masquer, qui porte sa variation. Les titres
// individuels (absents des maquettes) restent disponibles, repliés derrière « Titres (N) ».
// Le mode Prix ($) et la superposition de titres vivent dans Détail → Comparer (StockComparisonModal).
import React, { useMemo, useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { MarketDataPoint } from '../../services/finance';
import { GF_CROSSHAIR_CURSOR, GF_ACTIVE_DOT } from '../../utils/chartTooltip';
import { formatDate, formatVariationPct, formatCompactCAD } from '../../utils/format';
import { reperesRonds } from '../../utils/reperesRonds';
import { toPerformanceRows } from '../StockChart';
import { Skeleton } from '../ui/Skeleton';
import { ChartDataTable, type ChartDataColumn } from '../ui/ChartDataTable';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';
import { MASKED_AMOUNT_LABEL } from '../../utils/privacyAria';
import { useTimeChartZoom } from '../../hooks/useTimeChartZoom';
import { ZoomContainer } from '../ui/ZoomContainer';
import { priceAt } from '../../services/history/reconstructPortfolioHistory';
import { historyKeyMatchesSymbol } from '../../services/history/buildMarketData';

export type PeriodeGraphe = '1M' | '3M' | '6M' | 'ALL';
const PERIODES: ReadonlyArray<{ id: PeriodeGraphe; libelle: string }> = [
    { id: '1M', libelle: '1 mois' }, { id: '3M', libelle: '3 mois' }, { id: '6M', libelle: '6 mois' }, { id: 'ALL', libelle: 'Tout' },
];

/** Séries « compte » : libellé court et couleur des maquettes. */
const TOTAUX: Record<string, { libelle: string; couleur: string; ordre: number }> = {
    TOTAL: { libelle: 'Total', couleur: '#f8fafc', ordre: 0 },
    TOTAL_CELI: { libelle: 'CELI', couleur: '#34b39a', ordre: 1 },
    TOTAL_REER: { libelle: 'REER', couleur: '#7c93f2', ordre: 2 },
    'TOTAL_NON-ENREG': { libelle: 'Non-enregistré', couleur: '#d4a24c', ordre: 3 },
    TOTAL_CRYPTO: { libelle: 'Crypto', couleur: '#a78bfa', ordre: 4 },
    TOTAL_CELIAPP: { libelle: 'CELIAPP', couleur: '#7dd3c0', ordre: 5 },
};
const PALETTE_TITRES = ['#56b6d6', '#e0703a', '#f87171', '#c084fc', '#fbbf24', '#94a3b8', '#4ade80', '#f472b6'];

interface SerieDisponible { id: string; name: string }

interface Props {
    donnees: MarketDataPoint[];
    series: ReadonlyArray<SerieDisponible>;
    selection: ReadonlySet<string>;
    onSelection: (next: Set<string>) => void;
    periode: PeriodeGraphe;
    onPeriode: (p: PeriodeGraphe) => void;
    /** [PERF-STALE-TAIL-ZERO] (date, clé) raccordée au prix courant faute d'historique. */
    estSynthetique?: (date: string, cle: string) => boolean;
    chargement: boolean;
    etroit: boolean;
    children?: React.ReactNode;
}

/** « 2025-09-21 » → Date locale (jamais `new Date(iso)`, relu la veille dans un fuseau négatif). */
const jour = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };

/**
 * Variation (%) d'une série entre son premier et son dernier point valorisé de la fenêtre — le bout
 * de sa courbe base 100. `null` si moins de deux points, ou si les DEUX bornes sont synthétiques
 * (un 0 % figé n'est pas un marché plat — même règle que `seriesReturnPct`).
 */
export function variationFenetre(rows: MarketDataPoint[], cle: string, estSynthetique?: (date: string, cle: string) => boolean): number | null {
    let debut = -1;
    let fin = -1;
    rows.forEach((r, i) => {
        const v = Number(r[cle]);
        if (Number.isFinite(v) && v > 0) { if (debut < 0) debut = i; fin = i; }
    });
    if (debut < 0 || fin <= debut) return null;
    if (estSynthetique && estSynthetique(String(rows[debut].date), cle) && estSynthetique(String(rows[fin].date), cle)) return null;
    const a = Number(rows[debut][cle]);
    const b = Number(rows[fin][cle]);
    return ((b - a) / a) * 100;
}

interface PerfCompareeTooltipProps {
    active?: boolean;
    label?: string | number;
    payload?: Array<{ dataKey?: string | number; value?: number | null }>;
    decor: Map<string, { libelle: string; couleur: string; total: boolean; ordre: number }>;
    donneesParDate: Map<string, MarketDataPoint>;
    isPrivacyMode: boolean;
}

const PerfCompareeTooltip: React.FC<PerfCompareeTooltipProps> = ({
    active,
    label,
    payload,
    decor,
    donneesParDate,
    isPrivacyMode,
}) => {
    if (!active || !payload || payload.length === 0) return null;
    const dateIso = String(label ?? '');
    const brut = donneesParDate.get(dateIso);
    const items = payload
        .filter((p) => p.dataKey != null && typeof p.value === 'number' && Number.isFinite(p.value))
        .map((p) => {
            const id = String(p.dataKey);
            const info = decor.get(id) ?? { libelle: id, couleur: 'var(--gf-bleu)', total: false, ordre: 99 };
            const valPct = Number(p.value);
            const valCad = brut && Number.isFinite(Number(brut[id])) && Number(brut[id]) > 0 ? Number(brut[id]) : null;
            return { id, info, valPct, valCad };
        })
        .sort((a, b) => (a.id === 'TOTAL' ? -1 : b.id === 'TOTAL' ? 1 : b.valPct - a.valPct));

    if (items.length === 0) return null;

    return (
        <div className="gf-tooltip-card">
            <div className="gf-tooltip-header">
                <span className="text-xs font-semibold text-ink-50">
                    {dateIso ? formatDate(jour(dateIso), { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                </span>
                <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-neutral">
                    Base 100
                </span>
            </div>
            <div className={items.length > 1 ? 'grid grid-cols-2 gap-x-2.5 gap-y-0.5 sm:block sm:space-y-1.5' : 'space-y-1.5'}>
                {items.map(({ id, info, valPct, valCad }) => {
                    const textePct = isPrivacyMode && info.total
                        ? MASKED_AMOUNT_LABEL
                        : formatVariationPct(valPct, 2);
                    return (
                        <div key={id} className="gf-tooltip-row min-w-0">
                            <span className="flex items-center gap-1.5 text-ink-200 truncate">
                                <span className="gf-tooltip-dot" style={{ backgroundColor: info.couleur }} aria-hidden="true" />
                                <span className={`truncate ${id === 'TOTAL' ? 'font-bold text-ink-50' : ''}`}>{info.libelle}</span>
                            </span>
                            <span className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                                {valCad !== null && info.total && (
                                    <PrivateAmount className="hidden sm:inline font-mono text-[11px] text-ink-400 tabular-nums">
                                        {formatCompactCAD(valCad)}
                                    </PrivateAmount>
                                )}
                                <span className={`px-1 sm:px-1.5 py-0.5 rounded-sm font-mono text-[10px] sm:text-[11px] font-semibold tabular-nums ${valPct >= 0 ? 'gf-delta-up' : 'gf-delta-down'}`}>
                                    {textePct}
                                </span>
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export const PerformanceComparee: React.FC<Props> = ({ donnees, series, selection, onSelection, periode, onPeriode, estSynthetique, chargement, etroit, children }) => {
    const [titresOuverts, setTitresOuverts] = useState(true);
    const [modeFocus, setModeFocus] = useState<'focus' | 'superposer'>('focus');
    // [PRIVACY-RATIOS-DUREES-UNIFORMES] La variation du TOTAL et de chaque COMPTE est un ratio perso : masquée en
    // mode discret. Celle d'un TITRE est une variation de prix de marché (décision de Marc : laissée visible).
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const assets = useFinanceStore((s) => s.assets);
    const decor = useMemo(() => {
        let i = 0;
        return new Map(series.map((s) => {
            const t = TOTAUX[s.id];
            return [s.id, t ? { libelle: t.libelle, couleur: t.couleur, total: true, ordre: t.ordre } : { libelle: s.name, couleur: PALETTE_TITRES[i++ % PALETTE_TITRES.length], total: false, ordre: 99 }];
        }));
    }, [series]);
    const donneesParDate = useMemo(() => new Map(donnees.map((d) => [String(d.date), d])), [donnees]);
    const totaux = series.filter((s) => decor.get(s.id)?.total).sort((a, b) => (decor.get(a.id)!.ordre - decor.get(b.id)!.ordre));
    const titres = series.filter((s) => !decor.get(s.id)?.total);

    // [INVEST-PRIX-TITRES-EXACTS] Pour un titre individuel (action, ETF, crypto), la courbe et sa
    // variation doivent refléter la performance réelle de son cours de marché (insensible aux achats DCA).
    // Les totaux de comptes (TOTAL, CELI, REER...) conservent leur valeur de portefeuille en CAD.
    const donneesPerformance = useMemo(() => {
        if (!assets || assets.length === 0 || titres.length === 0) return donnees;
        const assetBySymbol = new Map<string, (typeof assets)[0]>();
        for (const a of assets) {
            if (a.symbol) assetBySymbol.set(a.symbol, a);
            if (a.historySymbol) assetBySymbol.set(a.historySymbol, a);
        }

        return donnees.map((row) => {
            const dateStr = String(row.date);
            const rowCopie = { ...row };
            for (const t of titres) {
                const asset = assetBySymbol.get(t.id)
                    || assets.find((a) => a.symbol === t.id || historyKeyMatchesSymbol(t.id, a.symbol) || (a.historySymbol && historyKeyMatchesSymbol(t.id, a.historySymbol)));
                if (asset?.priceHistory && asset.priceHistory.length > 0) {
                    const close = priceAt(asset, dateStr, 7);
                    if (typeof close === 'number' && Number.isFinite(close) && close > 0) {
                        rowCopie[t.id] = close;
                    } else {
                        rowCopie[t.id] = null as unknown as number;
                    }
                }
            }
            return rowCopie;
        });
    }, [donnees, assets, titres]);

    const lignes = useMemo(() => toPerformanceRows(donneesPerformance, new Set(series.map((s) => s.id))), [donneesPerformance, series]);
    const zoom = useTimeChartZoom(lignes);
    const lignesVisibles = zoom.visibleData;
    const variations = useMemo(() => new Map(series.map((s) => [s.id, variationFenetre(donneesPerformance, s.id, estSynthetique)])), [donneesPerformance, series, estSynthetique]);
    const visibles = series.filter((s) => selection.has(s.id));
    const estPerso = (id: string) => decor.get(id)?.total === true;
    const pctSerie = (id: string, v: unknown, decimales: 0 | 1 | 2 = 1) => (isPrivacyMode && estPerso(id) ? MASKED_AMOUNT_LABEL : formatVariationPct(v, decimales));
    const domaineY = useMemo<[number, number]>(() => {
        const vals = lignesVisibles
            .flatMap((l) => visibles.map((s) => l[s.id]))
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (vals.length === 0) return [-5, 5];
        const minV = Math.min(...vals);
        const maxV = Math.max(...vals);
        const span = Math.max(maxV - minV, 0.4);
        const pad = span * 0.08;
        return [Number((minV - pad).toFixed(2)), Number((maxV + pad).toFixed(2))];
    }, [lignesVisibles, visibles]);
    const reperes = useMemo(() => {
        const vals = lignesVisibles
            .flatMap((l) => visibles.map((s) => l[s.id]))
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        const r = reperesRonds(vals);
        if (!r) return undefined;
        const dansDomaine = r.filter((tick) => tick >= domaineY[0] && tick <= domaineY[1]);
        const retenus = etroit ? dansDomaine.filter((_, i) => i % 2 === 0) : dansDomaine;
        return retenus.length >= 2 ? retenus : undefined;
    }, [lignesVisibles, visibles, domaineY, etroit]);
    const dates = useMemo(() => {
        const n = lignesVisibles.length;
        if (n === 0) return [];
        const nb = Math.min(n, etroit ? 3 : 5);
        return Array.from(new Set(Array.from({ length: nb }, (_, k) => String(lignesVisibles[Math.round((k * (n - 1)) / Math.max(1, nb - 1))].date))));
    }, [lignesVisibles, etroit]);
    const decimalesAxeY: 0 | 1 = Math.abs(domaineY[1] - domaineY[0]) < 6 ? 1 : 0;
    const debut = donnees[0]?.date ? formatDate(jour(String(donnees[0].date)), { day: 'numeric', month: 'short', year: 'numeric' }) : null;

    const basculer = (id: string) => {
        if (modeFocus === 'focus') {
            if (selection.size === 1 && selection.has(id) && id !== 'TOTAL') {
                onSelection(new Set(['TOTAL']));
            } else {
                onSelection(new Set([id]));
            }
            return;
        }
        const next = new Set(selection);
        if (next.has(id)) {
            if (next.size > 1) next.delete(id);
        } else {
            next.add(id);
        }
        onSelection(next);
    };
    const etiquette = (s: SerieDisponible) => {
        const d = decor.get(s.id)!;
        const v = variations.get(s.id) ?? null;
        const actif = selection.has(s.id);
        return (
            <button
                key={s.id}
                type="button"
                onClick={() => basculer(s.id)}
                aria-pressed={actif}
                className={`min-h-11 px-3 rounded-full border flex items-center gap-2 text-[13px] transition-colors focus-ring ${actif ? 'border-bordure-champ bg-surfaceHighlight/60 text-ink-50' : 'border-bordure text-ink-400'}`}
            >
                <span className="w-3 h-[3px] rounded-sm" style={{ background: d.couleur, opacity: actif ? 1 : 0.4 }} aria-hidden="true" />
                {d.libelle}
                <span className={`font-mono text-meta ${v === null ? 'text-ink-400' : v >= 0 ? 'text-success-400' : 'text-danger-400'}`}>{d.total ? <PrivateAmount>{formatVariationPct(v)}</PrivateAmount> : formatVariationPct(v)}</span>
            </button>
        );
    };
    const TickDate = (props: { x?: number; y?: number; payload?: { value: string }; index?: number; visibleTicksCount?: number }) => {
        const { x = 0, y = 0, payload, index = 0, visibleTicksCount = 1 } = props;
        return (
            <text x={x} y={y + 12} textAnchor={index === 0 ? 'start' : index === visibleTicksCount - 1 ? 'end' : 'middle'} fill="#8896a8" fontSize={etroit ? 10 : 11} fontFamily="JetBrains Mono">
                {payload ? formatDate(jour(payload.value), { month: 'short', year: '2-digit' }) : ''}
            </text>
        );
    };
    const colonnes: ChartDataColumn[] = [
        { key: 'date', label: 'Date', format: (v) => formatDate(jour(String(v))) },
        ...visibles.map((s) => ({ key: s.id, label: decor.get(s.id)!.libelle, format: (v: unknown) => pctSerie(s.id, v, 2) })),
    ];

    return (
        <section aria-labelledby="perf-comparee-titre" className="rounded-2xl bg-surface border border-bordure p-4 sm:px-6 sm:py-5 flex flex-col gap-3.5 min-w-0">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 id="perf-comparee-titre" className="text-[17px] lg:text-[18px] font-semibold text-ink-50">Performance comparée</h2>
                    {debut && (
                        <span className="px-2 py-0.5 rounded-full text-tiny font-mono gf-delta-neutral">
                            Depuis {debut}
                        </span>
                    )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div role="group" aria-label="Mode de lecture des courbes" className="inline-flex p-0.5 rounded-xl bg-fond border border-bordure">
                        <button
                            type="button"
                            onClick={() => {
                                setModeFocus('focus');
                                if (selection.size > 1) {
                                    const premiere = [...selection][0] ?? 'TOTAL';
                                    onSelection(new Set([premiere]));
                                }
                            }}
                            aria-pressed={modeFocus === 'focus'}
                            className={`touch-target px-2.5 py-1 rounded-lg text-xs transition-colors focus-ring ${modeFocus === 'focus' ? 'bg-surfaceHighlight text-ink-50 font-semibold' : 'text-ink-400 hover:text-ink-200'}`}
                        >
                            Focus 1 courbe
                        </button>
                        <button
                            type="button"
                            onClick={() => setModeFocus('superposer')}
                            aria-pressed={modeFocus === 'superposer'}
                            className={`touch-target px-2.5 py-1 rounded-lg text-xs transition-colors focus-ring ${modeFocus === 'superposer' ? 'bg-surfaceHighlight text-ink-50 font-semibold' : 'text-ink-400 hover:text-ink-200'}`}
                        >
                            Superposer
                        </button>
                    </div>
                    <div role="group" aria-label="Période du graphe" className={etroit ? 'grid grid-cols-4 p-1 rounded-xl bg-dark border border-bordure w-full sm:w-auto' : 'flex gap-1 shrink-0'}>
                        {PERIODES.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => onPeriode(p.id)}
                                aria-pressed={periode === p.id}
                                className={`min-h-11 px-3 rounded-lg text-[13px] transition-colors focus-ring ${periode === p.id ? (etroit ? 'bg-ink-50 text-dark font-semibold' : 'bg-surfaceHighlight text-ink-50 font-semibold') : 'text-ink-300 hover:bg-surface-douce'}`}
                            >
                                {p.libelle}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ width: '100%', height: etroit ? 250 : 340 }}>
                {chargement ? (
                    <Skeleton variant="chart" className="h-full!" />
                ) : lignes.length > 1 ? (
                    <div role="img" aria-label="Variation en pourcentage du portefeuille et de chaque compte sur la période — détail chiffré dans le tableau de données." className="w-full h-full">
                        <ZoomContainer zoom={zoom} hint={false} className="w-full h-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={lignesVisibles} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                                    <defs>
                                        {visibles.map((s) => {
                                            const d = decor.get(s.id)!;
                                            return (
                                                <linearGradient key={s.id} id={`perf-grad-${s.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`} x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={d.couleur} stopOpacity={0.26} />
                                                    <stop offset="95%" stopColor={d.couleur} stopOpacity={0.01} />
                                                </linearGradient>
                                            );
                                        })}
                                    </defs>
                                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                                    {domaineY[0] <= 0 && domaineY[1] >= 0 && (
                                        <ReferenceLine y={0} stroke="var(--bordure-champ)" strokeDasharray="3 3" strokeWidth={1} />
                                    )}
                                    <XAxis dataKey="date" ticks={dates} interval={0} tick={<TickDate />} tickLine={false} axisLine={false} />
                                    <YAxis /* AXE-NON-MONETAIRE : variation en %, jamais un montant */
                                        orientation={etroit ? 'left' : 'right'} mirror={etroit} ticks={reperes} domain={domaineY} allowDataOverflow={false}
                                        stroke="#8896a8" tick={{ fontSize: etroit ? 10 : 11, fontFamily: 'JetBrains Mono', dy: etroit ? -8 : 0 }}
                                        tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => (isPrivacyMode ? '' : formatVariationPct(v, decimalesAxeY))}
                                    />
                                    <Tooltip
                                        cursor={GF_CROSSHAIR_CURSOR}
                                        isAnimationActive={true}
                                        animationDuration={90}
                                        content={
                                            <PerfCompareeTooltip
                                                decor={decor}
                                                donneesParDate={donneesParDate}
                                                isPrivacyMode={isPrivacyMode}
                                            />
                                        }
                                    />
                                    {visibles.length === 1 && visibles.map((s) => (
                                        <Area
                                            key={`area-${s.id}`}
                                            type="monotone"
                                            dataKey={s.id}
                                            baseValue="dataMin"
                                            stroke="none"
                                            fill={`url(#perf-grad-${s.id.replace(/[^a-zA-Z0-9_-]/g, '_')})`}
                                            connectNulls
                                            isAnimationActive={false}
                                        />
                                    ))}
                                    {visibles.map((s) => {
                                        const d = decor.get(s.id)!;
                                        return <Line key={s.id} type="monotone" dataKey={s.id} stroke={d.couleur} strokeWidth={visibles.length === 1 ? 2.4 : s.id === 'TOTAL' ? 2.1 : 1.75} dot={false} activeDot={GF_ACTIVE_DOT} connectNulls isAnimationActive={!zoom.isPanning} animationDuration={320} />;
                                    })}
                                </ComposedChart>
                            </ResponsiveContainer>
                        </ZoomContainer>
                    </div>
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-body text-ink-400 rounded-xl bg-surface-douce">Aucune donnée disponible pour cette période.</div>
                )}
            </div>
            <ChartDataTable caption="Variation en % de chaque série affichée, par date" columns={colonnes} rows={lignes} />

            <div className="flex flex-wrap gap-2">
                {totaux.map(etiquette)}
                {titres.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setTitresOuverts((o) => !o)}
                        aria-expanded={titresOuverts}
                        className="min-h-11 px-3 rounded-full border border-dashed border-bordure-champ text-[13px] text-ink-300 hover:text-ink-50 focus-ring"
                    >
                        Titres ({titres.length}) {titresOuverts ? '−' : '+'}
                    </button>
                )}
            </div>
            {titresOuverts && titres.length > 0 && <div className="flex flex-wrap gap-2">{titres.map(etiquette)}</div>}
            {children}
        </section>
    );
};
