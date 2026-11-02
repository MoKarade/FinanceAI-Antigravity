import React from 'react';
import { GF_CROSSHAIR_CURSOR, GF_ACTIVE_DOT } from '../../utils/chartTooltip';
import { Card } from '../ui/Card';
import { RealEstateGoal } from '../../types';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { useTimeChartZoom } from '../../hooks/useTimeChartZoom';
import { ZoomContainer } from '../ui/ZoomContainer';
import { ChartDataTable, type ChartDataColumn } from '../ui/ChartDataTable';
import { MASKED_AMOUNT_LABEL } from '../../utils/privacyAria';
import { maskedTick } from '../../utils/chartPrivacy';
import { useFinanceStore } from '../../store/useFinanceStore';
import { formatCAD } from '../../utils/format';

const PROP_COLORS = ['#4f9d86', '#5b82bf', '#c2974f', '#9277bd', '#bd7d9c', '#5093a8'];

interface MultiPropertyComparisonProps {
    goals: RealEstateGoal[];
}

export const MultiPropertyComparison: React.FC<MultiPropertyComparisonProps> = ({ goals }) => {
    // [A11Y-CHARTS] (LOT 3) — mode discret : masque les montants ($) de la table de données sr-only.
    // Appelé AVANT tout early return (règle des Hooks).
    const isPrivacyMode = useFinanceStore(s => s.isPrivacyMode);
    const allSeries = goals.map((goal, gi) => {
        const p = goal.price || 450000;
        const dp = goal.downPayment || (p * 0.2);
        const r = (goal.mortgageRate || 4.5) / 100 / 12;
        const amort = goal.amortization || 25;
        const mort = p - dp;
        // Défaut = taux ACTUEL (décision Marc 2026-09-04, aligné sur le moteur — `||` voulu : ≤ 0 = absence).
        const renewR = (goal.renewalRateProjection || (goal.mortgageRate || 4.5)) / 100 / 12;
        const growth = (goal.propertyGrowthRate ?? 3.0) / 100;
        const numPmt = amort * 12;
        let monthlyPmt = r > 0
            ? (r * mort * Math.pow(1 + r, numPmt)) / (Math.pow(1 + r, numPmt) - 1)
            : mort / numPmt;
        let balance = mort;
        let propVal = p + (goal.initialRenovations || 0);
        let currentR = r;

        const points: { year: number; equity: number }[] = [];
        for (let year = 1; year <= amort; year++) {
            if (year > 1 && (year - 1) % 5 === 0) {
                currentR = renewR;
                const rem = (amort - year + 1) * 12;
                if (currentR > 0)
                    monthlyPmt = (currentR * balance * Math.pow(1 + currentR, rem)) / (Math.pow(1 + currentR, rem) - 1);
            }
            for (let m = 0; m < 12; m++) {
                if (balance <= 0) break;
                const interest = balance * currentR;
                balance -= (monthlyPmt - interest);
            }
            propVal *= (1 + growth);
            points.push({ year, equity: Math.max(0, Math.round(propVal - Math.max(0, balance))) });
        }
        return { name: goal.name || `Prop. ${gi + 1}`, points, color: PROP_COLORS[gi % PROP_COLORS.length] };
    });

    const maxLen = allSeries.length > 0 ? Math.max(...allSeries.map(s => s.points.length)) : 0;
    const chartData: Record<string, number | string>[] = [];
    for (let yr = 1; yr <= maxLen; yr++) {
        const row: Record<string, number | string> = { year: yr };
        allSeries.forEach(s => {
            const pt = s.points.find(p => p.year === yr);
            if (pt) row[s.name] = pt.equity;
        });
        chartData.push(row);
    }

    // G7b — zoom molette / pan sur la comparaison multi-propriétés (x = année).
    const zoom = useTimeChartZoom(chartData);

    // [A11Y-CHARTS] (LOT 3) — colonnes de la table sr-only (alternative texte à l'AreaChart multi-
    // propriétés, opaque aux lecteurs d'écran). Année (axe X, visible) + une colonne d'équité ($) par
    // propriété (= dataKey de chaque <Area>). Mode privé masque les MONTANTS (pas l'année).
    const money = (v: unknown) => isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(v);
    const comparisonColumns: ChartDataColumn[] = [
        { key: 'year', label: 'Année', format: (v) => v != null ? `An ${v}` : '' },
        ...allSeries.map(s => ({ key: s.name, label: s.name, format: money })),
    ];

    if (goals.length < 2) return null;

    return (
        <Card
            title={`Comparaison des ${goals.length} Propriétés — Équité Projectée`}
            className="mt-4"
        >
            <div className="flex gap-4 mb-4 flex-wrap">
                {allSeries.map(s => (
                    <div key={s.name} className="flex items-center gap-2 text-meta font-bold" style={{ color: s.color }}>
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.name}
                    </div>
                ))}
            </div>
            <div
                role="img"
                aria-label={`Comparaison de l'équité projetée de ${goals.length} propriétés, année par année jusqu'à la fin de l'amortissement.`}
            >
            <ZoomContainer zoom={zoom} className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={zoom.visibleData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                        <XAxis dataKey="year" stroke="#555" tick={{ fontSize: 10 }} tickFormatter={v => `An ${v}`} />
                        <YAxis stroke="#555" tick={{ fontSize: 10 }} tickFormatter={maskedTick(isPrivacyMode, (v: number) => `${(v / 1000).toFixed(0)}k`)} width={50} />
                        <Tooltip
                            cursor={GF_CROSSHAIR_CURSOR}
                            isAnimationActive={true}
                            animationDuration={90}
                            content={<MultiPropTooltip isPrivacyMode={isPrivacyMode} />}
                        />
                        <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                        {allSeries.map(s => (
                            <Area
                                key={s.name}
                                type="monotone"
                                dataKey={s.name}
                                stroke={s.color}
                                fill={s.color + '15'}
                                strokeWidth={1.6}
                                dot={false}
                                activeDot={GF_ACTIVE_DOT}
                                isAnimationActive={!zoom.isPanning}
                                animationDuration={320}
                                animationEasing="ease-out"
                            />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </ZoomContainer>
            </div>
            {/* [A11Y-CHARTS] (LOT 3) — alternative TEXTUELLE (sr-only) à l'AreaChart multi-propriétés :
                équité projetée de chaque propriété par année en table accessible. */}
            <ChartDataTable
                caption={`Équité projetée par année pour ${goals.length} propriétés`}
                columns={comparisonColumns}
                rows={chartData}
            />
        </Card>
    );
};

interface MultiPropTooltipProps {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number; color?: string }>;
    label?: string | number;
    isPrivacyMode: boolean;
}

const MultiPropTooltip: React.FC<MultiPropTooltipProps> = ({ active, payload, label, isPrivacyMode }) => {
    if (!active || !payload?.length) return null;
    const totalEquity = payload.reduce((acc, item) => acc + (Number(item.value) || 0), 0);
    const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

    return (
        <div className="gf-tooltip-card min-w-[230px]">
            <div className="gf-tooltip-header">
                <span className="font-mono text-[11px] font-bold text-ink-50">Année {label}</span>
                <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-up">
                    {payload.length} biens
                </span>
            </div>
            <div className="mb-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-400">Équité combinée</div>
                <div className="gf-tooltip-hero">
                    {isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(totalEquity)}
                </div>
            </div>
            <div className="gf-tooltip-divider" />
            <div className="space-y-1.5">
                {sorted.map((item) => {
                    const val = Number(item.value) || 0;
                    const share = totalEquity > 0 ? Math.round((val / totalEquity) * 100) : 0;
                    return (
                        <div key={String(item.name)} className="gf-tooltip-row">
                            <span className="text-ink-300 flex items-center gap-1.5 truncate max-w-[130px]">
                                <span className="gf-tooltip-dot" style={{ background: item.color }} />
                                {item.name}
                            </span>
                            <span className="flex items-center gap-2 font-mono">
                                {!isPrivacyMode && <span className="text-[10px] text-ink-400">{share}%</span>}
                                <span className="font-semibold text-ink-50">
                                    {isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(val)}
                                </span>
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
