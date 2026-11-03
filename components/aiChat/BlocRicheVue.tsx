// components/aiChat/BlocRicheVue.tsx
//
// Rendu des blocs riches de l'assistant (`services/assistant/blocsRiches.ts`) : graphique Recharts
// (jetons de couleur Google Finance), liste, tableau, cartes de chiffres.
// Montants : `formatCAD` / `formatPercent` dans `<PrivateAmount>` (mode discret) ; valeur absente ou
// non finie → « — », jamais 0. Chaque graphique porte une alternative textuelle (tableau sr-only).

import React from 'react';
import {
    ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
    XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import { PrivateAmount } from '../ui/PrivateAmount';
import { ChartDataTable } from '../ui/ChartDataTable';
import { formatCAD, formatPercent, formatNumber, formatCompactCAD } from '../../utils/format';
import { maskedTick } from '../../utils/chartPrivacy';
import { CHART_TOOLTIP_STYLE, CHART_TOOLTIP_ITEM_STYLE } from '../../utils/chartTooltip';
import { useFinanceStore } from '../../store/useFinanceStore';
import type { BlocRiche, BlocGraphique, BlocTableau, BlocCartes, BlocListe } from '../../services/assistant/blocsRiches';

const COULEURS = ['var(--gf-bleu)', 'var(--gf-vert)', 'var(--gf-ambre)', 'var(--gf-violet)', 'var(--gf-cyan)', 'var(--gf-rouge)'];

type Unite = 'cad' | 'pourcent' | 'nombre' | 'texte';

/** Formatage unique des valeurs d'un bloc : non fini → « — » (jamais 0). */
export function formaterValeurBloc(v: unknown, unite: Unite): string {
    if (unite === 'texte') return typeof v === 'string' && v.trim() ? v : '—';
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    // MONTANT-MASQUE-AILLEURS : chaque appelant enveloppe ce texte dans <PrivateAmount> ou maskedTick.
    if (unite === 'cad') return formatCAD(v);
    // MONTANT-MASQUE-AILLEURS : chaque appelant enveloppe ce texte dans <PrivateAmount> ou maskedTick.
    if (unite === 'pourcent') return formatPercent(v, 1);
    return formatNumber(v);
}

const Titre: React.FC<{ texte?: string }> = ({ texte }) =>
    texte ? <h4 className="text-xs font-semibold text-ink-100 mb-2">{texte}</h4> : null;

const VueGraphique: React.FC<{ bloc: BlocGraphique }> = ({ bloc }) => {
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const donnees = bloc.points.map((p) => {
        const ligne: Record<string, string | number | null> = { etiquette: p.etiquette };
        for (const s of bloc.series) {
            const v = p.valeurs[s.cle];
            ligne[s.cle] = typeof v === 'number' && Number.isFinite(v) ? v : null;
        }
        return ligne;
    });
    const formatAxe = (v: number) => (bloc.unite === 'cad' ? formatCompactCAD(v) : formaterValeurBloc(v, bloc.unite));
    const formatInfobulle = (v: unknown) => (isPrivacyMode ? '•••' : formaterValeurBloc(v, bloc.unite));
    const axes = (
        <>
            <CartesianGrid stroke="var(--bordure)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="etiquette" tick={{ fill: 'var(--texte-doux)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis
                tick={{ fill: 'var(--texte-doux)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={64}
                tickFormatter={maskedTick(isPrivacyMode, formatAxe)}
            />
            <Tooltip formatter={(v: unknown) => formatInfobulle(v)} contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
            {bloc.series.length > 1 && <Legend />}
        </>
    );
    const colonnesA11y = [
        { key: 'etiquette', label: 'Point', format: (v: unknown) => String(v ?? '—') },
        ...bloc.series.map((s) => ({
            key: s.cle,
            label: s.libelle,
            format: (v: unknown) => (isPrivacyMode ? 'Montant masqué' : formaterValeurBloc(v, bloc.unite)),
        })),
    ];
    let graphique: React.ReactElement;
    if (bloc.forme === 'secteurs') {
        const serie = bloc.series[0];
        const parts = donnees.filter((d) => typeof d[serie.cle] === 'number').map((d) => ({ nom: String(d.etiquette), valeur: d[serie.cle] as number }));
        graphique = (
            <ResponsiveContainer width="100%" height="100%" aria-hidden="true">
                <PieChart>
                    <Pie data={parts} dataKey="valeur" nameKey="nom" innerRadius="45%" outerRadius="80%" isAnimationActive={false}>
                        {parts.map((p, i) => <Cell key={p.nom} fill={COULEURS[i % COULEURS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: unknown) => formatInfobulle(v)} contentStyle={CHART_TOOLTIP_STYLE} itemStyle={CHART_TOOLTIP_ITEM_STYLE} />
                    <Legend />
                </PieChart>
            </ResponsiveContainer>
        );
    } else if (bloc.forme === 'barres') {
        graphique = (
            <ResponsiveContainer width="100%" height="100%" aria-hidden="true">
                <BarChart data={donnees}>
                    {axes}
                    {bloc.series.map((s, i) => <Bar key={s.cle} dataKey={s.cle} name={s.libelle} fill={COULEURS[i % COULEURS.length]} radius={[3, 3, 0, 0]} isAnimationActive={false} />)}
                </BarChart>
            </ResponsiveContainer>
        );
    } else if (bloc.forme === 'aire') {
        graphique = (
            <ResponsiveContainer width="100%" height="100%" aria-hidden="true">
                <AreaChart data={donnees}>
                    {axes}
                    {bloc.series.map((s, i) => <Area key={s.cle} type="monotone" dataKey={s.cle} name={s.libelle} stroke={COULEURS[i % COULEURS.length]} fill={COULEURS[i % COULEURS.length]} fillOpacity={0.15} connectNulls={false} isAnimationActive={false} />)}
                </AreaChart>
            </ResponsiveContainer>
        );
    } else {
        graphique = (
            <ResponsiveContainer width="100%" height="100%" aria-hidden="true">
                <LineChart data={donnees}>
                    {axes}
                    {bloc.series.map((s, i) => <Line key={s.cle} type="monotone" dataKey={s.cle} name={s.libelle} stroke={COULEURS[i % COULEURS.length]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
                </LineChart>
            </ResponsiveContainer>
        );
    }
    return (
        <figure role="img" data-testid="assistant-bloc-graphique" aria-label={bloc.titre}>
            <Titre texte={bloc.titre} />
            <div className="h-56 w-full" aria-hidden="true">
                {graphique}
            </div>
            <ChartDataTable caption={bloc.titre} columns={colonnesA11y} rows={donnees} />
        </figure>
    );
};

const VueListe: React.FC<{ bloc: BlocListe }> = ({ bloc }) => {
    const Balise = bloc.ordonnee ? 'ol' : 'ul';
    return (
        <div data-testid="assistant-bloc-liste">
            <Titre texte={bloc.titre} />
            <Balise className={`space-y-1 pl-5 text-xs text-ink-200 ${bloc.ordonnee ? 'list-decimal' : 'list-disc'}`}>
                {bloc.elements.map((e, i) => <li key={`${i}-${e.slice(0, 12)}`}>{e}</li>)}
            </Balise>
        </div>
    );
};

const VueTableau: React.FC<{ bloc: BlocTableau }> = ({ bloc }) => (
    <div data-testid="assistant-bloc-tableau" className="overflow-x-auto">
        <Titre texte={bloc.titre} />
        <table className="w-full text-xs">
            <thead>
                <tr className="border-b border-bordure">
                    {bloc.colonnes.map((c) => (
                        <th key={c.cle} scope="col" className={`py-1.5 px-2 font-semibold text-ink-300 ${c.unite === 'texte' ? 'text-left' : 'text-right'}`}>{c.libelle}</th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {bloc.lignes.map((l, i) => (
                    <tr key={i} className="border-b border-bordure last:border-0">
                        {bloc.colonnes.map((c) => (
                            <td key={c.cle} className={`py-1.5 px-2 text-ink-100 ${c.unite === 'texte' ? 'text-left' : 'text-right font-mono'}`}>
                                {c.unite === 'texte'
                                    ? formaterValeurBloc(l[c.cle], 'texte')
                                    : <PrivateAmount>{formaterValeurBloc(l[c.cle], c.unite)}</PrivateAmount>}
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    </div>
);

const VueCartes: React.FC<{ bloc: BlocCartes }> = ({ bloc }) => (
    <div data-testid="assistant-bloc-cartes">
        <Titre texte={bloc.titre} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {bloc.cartes.map((c, i) => {
                const variation = typeof c.variationPct === 'number' && Number.isFinite(c.variationPct) ? c.variationPct : null;
                return (
                    <div key={`${c.libelle}-${i}`} className="rounded-xl bg-surface-douce border border-bordure p-2.5">
                        <div className="text-[11px] text-ink-300">{c.libelle}</div>
                        <PrivateAmount as="div" className="text-sm font-semibold text-ink-50 font-mono">{formaterValeurBloc(c.valeur, c.unite)}</PrivateAmount>
                        {variation !== null && (
                            <PrivateAmount as="div" className={`text-[11px] font-mono ${variation >= 0 ? 'text-succes-texte' : 'text-erreur-texte'}`}>
                                {`${variation >= 0 ? '+' : ''}${formatPercent(variation, 1)}`}
                            </PrivateAmount>
                        )}
                    </div>
                );
            })}
        </div>
    </div>
);

export const BlocRicheVue: React.FC<{ bloc: BlocRiche }> = ({ bloc }) => {
    switch (bloc.type) {
        case 'graphique': return <VueGraphique bloc={bloc} />;
        case 'liste': return <VueListe bloc={bloc} />;
        case 'tableau': return <VueTableau bloc={bloc} />;
        case 'cartes_chiffres': return <VueCartes bloc={bloc} />;
        default: return null;
    }
};
