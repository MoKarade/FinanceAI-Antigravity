// components/realestate/ScenariosAchatLocation.tsx
//
// [S5-REFONTE-IMMOBILIER] « Acheter ou louer ? N ans de scénarios » (maquettes E-immobilier /
// M-immobilier) : les CINQ trajectoires sur une même courbe — acheter, louer et investir le reste,
// locatif, bourse seule, valeur de la maison (pointillés) — légende chiffrée (valeur au bout), axe à
// droite, et une phrase de conclusion. Remplace ScenariosComparatifsCard (qui n'affichait que deux
// scénarios selon le type de bien) ; les hypothèses se règlent dans « Financement ».
import React, { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import { GF_CROSSHAIR_CURSOR, GF_ACTIVE_DOT } from '../../utils/chartTooltip';
import { formatCAD, formatCompactCAD, formatNumber } from '../../utils/format';
import { maskedTick } from '../../utils/chartPrivacy';
import { MASKED_AMOUNT_LABEL } from '../../utils/privacyAria';
import { reperesRonds } from '../../utils/reperesRonds';
import { useFinanceStore } from '../../store/useFinanceStore';
import { PrivateAmount } from '../ui/PrivateAmount';
import { ChartDataTable, type ChartDataColumn } from '../ui/ChartDataTable';
import { useTimeChartZoom } from '../../hooks/useTimeChartZoom';
import { ZoomContainer } from '../ui/ZoomContainer';
import type { LigneScenario } from './calculsImmoLocaux';

type Cle = 'Acheter (Résidence)' | 'Louer + Investir Reste' | 'Investissement Locatif (Équité+Loyer)' | 'Bourse (Placer Cash Initial)' | 'Valeur Propriété';

const SERIES: ReadonlyArray<{ cle: Cle; libelle: string; couleur: string; epaisseur: number; pointilles?: boolean }> = [
    { cle: 'Acheter (Résidence)', libelle: 'Acheter', couleur: '#f8fafc', epaisseur: 1.85 },
    { cle: 'Louer + Investir Reste', libelle: 'Louer et investir le reste', couleur: '#34b39a', epaisseur: 1.65 },
    { cle: 'Investissement Locatif (Équité+Loyer)', libelle: 'Locatif', couleur: '#d4a24c', epaisseur: 1.45 },
    { cle: 'Bourse (Placer Cash Initial)', libelle: 'Bourse seule', couleur: '#7c93f2', epaisseur: 1.45 },
    { cle: 'Valeur Propriété', libelle: 'Valeur de la maison', couleur: '#8896a8', epaisseur: 1.25, pointilles: true },
];

interface Props {
    donnees: LigneScenario[];
    annees: number;
    rendementBoursier: number;
    appreciation: number;
    /** Bien locatif (non habité) : la conclusion compare locatif et bourse seule. */
    locatif: boolean;
    etroit: boolean;
}

const pct = (v: number) => formatNumber(v, { decimals: Number.isInteger(v) ? 0 : 1 });

export const ScenariosAchatLocation: React.FC<Props> = ({ donnees, annees, rendementBoursier, appreciation, locatif, etroit }) => {
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const zoom = useTimeChartZoom(donnees);
    const donneesVisibles = zoom.visibleData;
    const fin = donnees[donnees.length - 1];
    const reperes = useMemo(() => {
        const r = reperesRonds(donneesVisibles.flatMap((l) => SERIES.map((s) => l[s.cle] as number)));
        // Mobile (maquette M-immobilier) : un repère sur deux (0, 500 k$, 1 M$).
        return etroit && r ? r.filter((_, i) => i % 2 === 0) : r;
    }, [donneesVisibles, etroit]);
    const reperesAnnees = useMemo(() => {
        const r = donneesVisibles.map((l) => l.year).filter((y) => y === 1 || y % 5 === 0);
        const dernier = donneesVisibles[donneesVisibles.length - 1]?.year;
        if (dernier !== undefined && !r.includes(dernier)) r.push(dernier);
        return etroit ? r.filter((y, i) => y === 1 || y === dernier || i % 2 === 0) : r;
    }, [donneesVisibles, etroit]);

    // Conclusion : l'écart au bout, entre les deux scénarios qui se comparent pour CE type de bien.
    const [a, b] = locatif
        ? [{ cle: 'Investissement Locatif (Équité+Loyer)' as Cle, nom: "l'investissement locatif" }, { cle: 'Bourse (Placer Cash Initial)' as Cle, nom: 'la bourse seule' }]
        : [{ cle: 'Louer + Investir Reste' as Cle, nom: 'louer et investir la différence' }, { cle: 'Acheter (Résidence)' as Cle, nom: "l'achat" }];
    const ecart = fin ? (fin[a.cle] as number) - (fin[b.cle] as number) : 0;
    const [devant, derriere] = ecart >= 0 ? [a.nom, b.nom] : [b.nom, a.nom];

    const colonnes: ChartDataColumn[] = [
        { key: 'year', label: 'Année', format: (v) => `An ${v}` },
        ...SERIES.map((s) => ({ key: s.cle, label: s.libelle, format: (v: unknown) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(v)) })),
    ];
    // Légende mobile : scénarios du plus haut au plus bas, la valeur de la maison (repère) en dernier.
    const tri = [...SERIES].sort((x, y) => Number(!!x.pointilles) - Number(!!y.pointilles) || ((fin?.[y.cle] as number) ?? 0) - ((fin?.[x.cle] as number) ?? 0));
    const TickAn = (props: { x?: number; y?: number; payload?: { value: number }; index?: number; visibleTicksCount?: number }) => {
        const { x = 0, y = 0, payload, index = 0, visibleTicksCount = 1 } = props;
        return (
            <text x={x} y={y + 12} textAnchor={index === 0 ? 'start' : index === visibleTicksCount - 1 ? 'end' : 'middle'} fill="#8896a8" fontSize={etroit ? 10 : 11} fontFamily="JetBrains Mono">
                an {payload?.value}
            </text>
        );
    };

    return (
        <section aria-labelledby="acheter-louer-titre" className="rounded-2xl bg-surface border border-white/6 p-4 sm:px-6 sm:py-5 flex flex-col gap-3.5 min-w-0">
            {/* NOMBRE-NON-MONETAIRE : réglage saisi (âge ou horizon choisi), pas une valeur dérivée du dossier (horizon du comparatif) */}
            <h2 id="acheter-louer-titre" className="text-[17px] lg:text-[18px] font-semibold text-ink-50">Acheter ou louer ? {annees} ans de scénarios</h2>
            {!etroit && (
                <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-meta text-ink-300" aria-hidden="true">
                    {SERIES.map((s) => (
                        <li key={s.cle} className="flex items-center gap-1.5">
                            <span className="w-3 h-[3px] rounded-sm" style={{ background: s.couleur }} />
                            {s.libelle}{!s.pointilles && fin && <> · <PrivateAmount>{formatCompactCAD(fin[s.cle] as number)}</PrivateAmount></>}
                        </li>
                    ))}
                </ul>
            )}
            {/* NOMBRE-NON-MONETAIRE : réglage saisi (âge ou horizon choisi), pas une valeur dérivée du dossier (horizon du comparatif) */}
            <div role="img" aria-label={`Sur ${annees} ans : ${SERIES.filter((s) => !s.pointilles).map((s) => s.libelle.toLowerCase()).join(', ')}, et la valeur de la maison — détail chiffré dans le tableau de données.`}>
                <ZoomContainer zoom={zoom} hint={false} style={{ width: '100%', height: etroit ? 220 : 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={donneesVisibles} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                            <XAxis dataKey="year" tick={<TickAn />} ticks={reperesAnnees} interval={0} tickLine={false} axisLine={false} />
                            <YAxis orientation={etroit ? 'left' : 'right'} mirror={etroit} ticks={reperes} domain={[0, 'dataMax']} stroke="#8896a8" tick={{ fontSize: etroit ? 10 : 11, fontFamily: 'JetBrains Mono', dy: etroit ? -8 : 0 }} tickLine={false} axisLine={false} width={etroit ? 60 : 52} tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v, { repere: true }))} />
                            <Tooltip
                                cursor={GF_CROSSHAIR_CURSOR}
                                isAnimationActive={true}
                                animationDuration={90}
                                content={<ScenariosImmoTooltip isPrivacyMode={isPrivacyMode} />}
                            />
                            {[...SERIES].reverse().map((s) => (
                                <Line key={s.cle} type="monotone" dataKey={s.cle} stroke={s.couleur} strokeWidth={s.epaisseur} strokeDasharray={s.pointilles ? '4 4' : undefined} dot={false} activeDot={GF_ACTIVE_DOT} isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                </ZoomContainer>
            </div>
            {/* NOMBRE-NON-MONETAIRE : réglage saisi (âge ou horizon choisi), pas une valeur dérivée du dossier (horizon du comparatif) */}
            <ChartDataTable caption={`Acheter ou louer : valeur de chaque scénario, année par année (${annees} ans)`} columns={colonnes} rows={donnees} />
            {etroit && fin && (
                <ul className="flex flex-col gap-1.5 text-[13px]">
                    {tri.map((s) => (
                        <li key={s.cle} className="flex items-center justify-between gap-3">
                            <span className="flex items-center gap-2 text-ink-200"><span className="w-3 h-[3px] rounded-sm" style={{ background: s.couleur }} aria-hidden="true" />{s.libelle}</span>
                            <PrivateAmount className={`font-mono ${s.pointilles ? 'text-ink-400' : 'font-bold text-ink-50'}`}>{formatCompactCAD(fin[s.cle] as number)}</PrivateAmount>
                        </li>
                    ))}
                </ul>
            )}
            {fin && (
                <p className="px-3.5 py-3 rounded-xl bg-dark/40 lg:bg-surface border border-white/6 text-[13px] leading-[19px] text-ink-200">
                    Avec ces hypothèses (bourse {pct(rendementBoursier)} %, immobilier {pct(appreciation)} %), {devant} finit{' '}
                    <PrivateAmount>{formatCompactCAD(Math.abs(ecart))}</PrivateAmount> devant {derriere} après {annees} ans.
                </p>
            )}
        </section>
    );
};

interface ScenariosImmoTooltipProps {
    active?: boolean;
    payload?: Array<{ payload?: LigneScenario }>;
    isPrivacyMode: boolean;
}

const ScenariosImmoTooltip: React.FC<ScenariosImmoTooltipProps> = ({ active, payload, isPrivacyMode }) => {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const row = payload[0].payload;
    const acheter = Number(row['Acheter (Résidence)']) || 0;
    const louer = Number(row['Louer + Investir Reste']) || 0;
    const diffAcheterLouer = acheter - louer;

    const sorted = [...SERIES].sort((a, b) => (Number(row[b.cle]) || 0) - (Number(row[a.cle]) || 0));
    const maxVal = Math.max(1, ...sorted.map((s) => Number(row[s.cle]) || 0));

    return (
        <div className="gf-tooltip-card min-w-[245px]">
            <div className="gf-tooltip-header">
                <span className="font-mono text-[11px] font-bold text-ink-50">Année {row.year}</span>
                <span className={`px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold ${diffAcheterLouer >= 0 ? 'gf-delta-up' : 'gf-delta-neutral'}`}>
                    {diffAcheterLouer >= 0 ? 'Acheter' : 'Louer'}
                </span>
            </div>
            <div className="space-y-1.5">
                {sorted.map((s) => {
                    const val = Number(row[s.cle]) || 0;
                    const pctLargeur = Math.min(100, Math.max(4, Math.round((Math.max(0, val) / maxVal) * 100)));
                    return (
                        <div key={s.cle} className="space-y-0.5">
                            <div className="gf-tooltip-row">
                                <span className="text-ink-300 flex items-center gap-1.5 truncate max-w-[140px]">
                                    <span className="gf-tooltip-dot" style={{ background: s.couleur }} />
                                    {s.libelle}
                                </span>
                                <span className={`font-mono ${s.pointilles ? 'text-ink-400' : 'font-semibold text-ink-50'}`}>
                                    {isPrivacyMode ? MASKED_AMOUNT_LABEL : <PrivateAmount>{formatCAD(val)}</PrivateAmount>}
                                </span>
                            </div>
                            {!isPrivacyMode && !s.pointilles && (
                                <div className="h-1 w-full rounded-full bg-surfaceHighlight overflow-hidden" aria-hidden="true">
                                    <div className="h-full rounded-full" style={{ width: `${pctLargeur}%`, backgroundColor: s.couleur }} />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <div className="gf-tooltip-divider" />
            <div className="gf-tooltip-row text-[11px]">
                <span className="text-ink-400">Écart</span>
                <span className={`font-mono font-semibold ${diffAcheterLouer >= 0 ? 'text-succes-texte' : 'text-alerte-texte'}`}>
                    {isPrivacyMode ? MASKED_AMOUNT_LABEL : <PrivateAmount>{diffAcheterLouer >= 0 ? '+' : ''}{formatCompactCAD(diffAcheterLouer)}</PrivateAmount>}
                </span>
            </div>
        </div>
    );
};
