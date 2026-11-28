import React from 'react';
import {
    Area,
    CartesianGrid,
    ComposedChart,
    Line,
    ReferenceArea,
    ReferenceDot,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { Tab } from '../../types';
import type { ProjectionChartPoint } from '../../services/projection/types';
import { formatCAD, formatCompactCAD, formatPercent } from '../../utils/format';
import { maskedTick } from '../../utils/chartPrivacy';
import { GF_ACTIVE_DOT, GF_CROSSHAIR_CURSOR } from '../../utils/chartTooltip';
import { prefetchTab } from '../../utils/tabPrefetch';
import { RefLineLabel, TodayValueBadge } from '../projection/ProjectionTooltip';
import { AnimatedNetWorth } from '../ui/AnimatedNetWorth';
import { ChartDataTable, type ChartDataColumn } from '../ui/ChartDataTable';
import { FxEstimateBadge } from '../ui/FxEstimateBadge';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { couleurSerie } from '../future/seriesConfig';
import {
    COULEUR_DETTE,
    COULEUR_LEVIER,
    LIBELLE_LEVIER,
    detteLevierSousZero,
    detteSousZero,
} from '../future/detteSerie';
import { HORIZONS, X_AXIS_DOMAIN } from './accueilHelpers';
import type { HorizonCle, LentilleHero, ModeCourbe, PointTrajectoire } from './types';

interface TrajectoireTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: PointTrajectoire }>;
    patrimoineInitial: number;
    isPrivacyMode?: boolean;
    enrichPoint?: (pt: ProjectionChartPoint) => ProjectionChartPoint | null;
}

const COMPTES_TOOLTIP_ACCUEIL = [
    { key: 'CELI' as const, label: 'CELI' },
    { key: 'REER' as const, label: 'REER' },
    { key: 'CELIAPP' as const, label: 'CELIAPP' },
    { key: 'NonReg' as const, label: 'Non-enreg.' },
    { key: 'Liquidites' as const, label: 'Liquidités' },
    { key: 'Immobilier' as const, label: 'Équité immo' },
    { key: 'Crypto' as const, label: 'Crypto' },
    { key: 'REEE' as const, label: 'REEE' },
    { key: 'Entreprise' as const, label: 'Entreprise' },
];

const TrajectoireTooltip: React.FC<TrajectoireTooltipProps> = ({
    active,
    payload,
    patrimoineInitial,
    enrichPoint,
}) => {
    if (!active || !payload || payload.length === 0) return null;
    const itemAvecValeur = payload.find((p) => p?.payload && typeof p.payload.valeur === 'number');
    const brut = itemAvecValeur?.payload ?? payload[0]?.payload;
    if (!brut) return null;
    const enrichi = enrichPoint ? (enrichPoint(brut) ?? brut) : brut;

    const valeurAffichee = typeof brut.valeur === 'number' ? brut.valeur : enrichi.NetWorth;
    const ecart = typeof valeurAffichee === 'number' ? valeurAffichee - patrimoineInitial : 0;
    const pct =
        Math.abs(patrimoineInitial) > 100 && Number.isFinite(ecart)
            ? (ecart / Math.abs(patrimoineInitial)) * 100
            : null;
    const badgePeriode =
        brut.periode === 'present' || enrichi.isPast || enrichi.dayIsReal
            ? 'Passé réel'
            : brut.periode === 'transition'
              ? 'Aujourd’hui'
              : 'Projeté';

    const comptesActifs = COMPTES_TOOLTIP_ACCUEIL.map((c) => ({
        ...c,
        val: Number(enrichi[c.key]) || 0,
        color: couleurSerie(c.key),
    }))
        .filter((c) => Math.abs(c.val) >= 50)
        .sort((a, b) => b.val - a.val)
        .slice(0, 5);

    const dettesVal = Math.max(0, Math.round(Number(enrichi.DettesNonImmo) || 0));

    return (
        <div className="gf-tooltip-card text-xs sm:text-sm font-mono tabular-nums space-y-2 min-w-[260px]">
            <div className="gf-tooltip-header">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-ink-50">{enrichi.dateLabel || brut.annee}</span>
                    {typeof enrichi.age === 'number' && Number.isFinite(enrichi.age) && (
                        <span className="text-xs text-ink-300">
                            {/* NOMBRE-NON-MONETAIRE : âge au point survolé */}
                            {`· ${enrichi.age} ans`}
                        </span>
                    )}
                </div>
                <span className="text-xs text-ink-300">{badgePeriode}</span>
            </div>

            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Valeur nette</span>
                <span className="font-bold text-ink-50">
                    <PrivateAmount>{formatCAD(enrichi.NetWorth)}</PrivateAmount>
                </span>
            </div>

            {typeof brut.portefeuille === 'number' && brut.portefeuille > 0 && (
                <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-ink-400">Portefeuille investi</span>
                    <span className="font-semibold text-ink-200">
                        <PrivateAmount>{formatCAD(brut.portefeuille)}</PrivateAmount>
                    </span>
                </div>
            )}

            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Écart vs aujourd’hui</span>
                <span className={`font-semibold ${ecart >= 0 ? 'text-succes-texte' : 'text-erreur-texte'}`}>
                    <PrivateAmount>
                        {`${ecart >= 0 ? '+' : ''}${formatCompactCAD(ecart)}${
                            pct !== null ? ` (${ecart >= 0 ? '+' : ''}${formatPercent(pct)})` : ''
                        }`}
                    </PrivateAmount>
                </span>
            </div>

            {comptesActifs.length > 0 && (
                <div className="pt-2 border-t border-bordure space-y-1.5">
                    {comptesActifs.map((c) => (
                        <div key={c.key} className="flex items-center justify-between gap-3 text-xs">
                            <span className="inline-flex items-center gap-2 text-ink-300">
                                <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: c.color }}
                                    aria-hidden="true"
                                />
                                <span>{c.label}</span>
                            </span>
                            <span className="font-medium text-ink-100">
                                <PrivateAmount>{formatCompactCAD(c.val)}</PrivateAmount>
                            </span>
                        </div>
                    ))}
                    {dettesVal > 0 && (
                        <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="inline-flex items-center gap-2 text-erreur-texte">
                                <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: COULEUR_DETTE }}
                                    aria-hidden="true"
                                />
                                <span>Dettes</span>
                            </span>
                            <span className="font-medium text-erreur-texte">
                                <PrivateAmount>{`-${formatCompactCAD(dettesVal)}`}</PrivateAmount>
                            </span>
                        </div>
                    )}
                </div>
            )}

            {!enrichi.dayIsReal &&
                brut.periode !== 'present' &&
                typeof enrichi.P10 === 'number' &&
                typeof enrichi.P90 === 'number' &&
                Number.isFinite(enrichi.P10) &&
                Number.isFinite(enrichi.P90) && (
                    <div className="pt-1.5 border-t border-bordure flex items-center justify-between gap-3 text-xs text-ink-400">
                        <span>Fourchette possible</span>
                        <span>
                            <PrivateAmount>
                                {`${formatCompactCAD(enrichi.P10)} → ${formatCompactCAD(enrichi.P90)}`}
                            </PrivateAmount>
                        </span>
                    </div>
                )}
        </div>
    );
};

interface AccueilHeroTrajectoireProps {
    activeTab: Tab;
    setActiveTab: (tab: Tab) => void;
    isPrivacyMode: boolean;
    prenom: string;
    lentilleHero: LentilleHero;
    setLentilleHero: (l: LentilleHero) => void;
    lentilleCourante: { cle: LentilleHero; label: string; ticker: string };
    valeurHeroAffichee: number;
    patrimoineNet: number;
    portefeuillePlacements: number;
    liquidites: number;
    realEstateEquity: number;
    variation: { diff: number; pct: number | null } | null;
    gainHorizon: { diff: number; pct: number | null } | null;
    horizon: HorizonCle;
    setHorizon: (h: HorizonCle) => void;
    onBasculerHorizonSuivant: () => void;
    modeCourbe: ModeCourbe;
    setModeCourbe: (m: ModeCourbe) => void;
    tempsFortsActifs: boolean;
    setTempsFortsActifs: React.Dispatch<React.SetStateAction<boolean>>;
    runMC: boolean;
    setRunMC: (v: boolean) => void;
    isDailyCurve: boolean;
    pointInspecte: PointTrajectoire | null;
    pointEpingle: PointTrajectoire | null;
    setPointEpingle: React.Dispatch<React.SetStateAction<PointTrajectoire | null>>;
    setPointSurvole: React.Dispatch<React.SetStateAction<PointTrajectoire | null>>;
    resumeFenetre: { min: number; max: number; diff: number; pct: number | null } | null;
    hasMcSeries: boolean;
    projectionStatus: string;
    hasPastCurveCalibration: boolean;
    donneesTrajectoire: PointTrajectoire[];
    donneesTrajectoireAvecRuban: Array<Record<string, unknown>>;
    formatTickXAccueil: (idx: number) => string;
    echelleYTrajectoire: { ticks?: number[]; domaine: [number, number] };
    enrichDailyPoint: (p: ProjectionChartPoint | null) => ProjectionChartPoint | null;
    pastPrefixCount: number;
    pastStartIndex: number;
    xAuj: number;
    bornesHorizonMois: [number, number];
    fireNumber: number;
    jalonFire: ProjectionChartPoint | null;
    pointRetraite: ProjectionChartPoint | null;
    pointAncre: ProjectionChartPoint | null;
    extraireValeurLentillePoint: (p: ProjectionChartPoint) => number | null;
    pointsTempsForts: PointTrajectoire[];
    colonnesTrajectoire: ChartDataColumn[];
}

export const AccueilHeroTrajectoire: React.FC<AccueilHeroTrajectoireProps> = ({
    activeTab,
    setActiveTab,
    isPrivacyMode,
    prenom,
    lentilleHero,
    setLentilleHero,
    lentilleCourante,
    valeurHeroAffichee,
    patrimoineNet,
    portefeuillePlacements,
    liquidites,
    realEstateEquity,
    variation,
    gainHorizon,
    horizon,
    setHorizon,
    onBasculerHorizonSuivant,
    modeCourbe,
    setModeCourbe,
    tempsFortsActifs,
    setTempsFortsActifs,
    runMC,
    setRunMC,
    isDailyCurve,
    pointInspecte,
    pointEpingle,
    setPointEpingle,
    setPointSurvole,
    resumeFenetre,
    hasMcSeries,
    projectionStatus,
    hasPastCurveCalibration,
    donneesTrajectoire,
    donneesTrajectoireAvecRuban,
    formatTickXAccueil,
    echelleYTrajectoire,
    enrichDailyPoint,
    pastPrefixCount,
    pastStartIndex,
    xAuj,
    bornesHorizonMois,
    fireNumber,
    jalonFire,
    pointRetraite,
    pointAncre,
    extraireValeurLentillePoint,
    pointsTempsForts,
    colonnesTrajectoire,
}) => (
    <div aria-label="Trajectoire du patrimoine" className="p-3.5 sm:p-8 space-y-3 sm:space-y-6 bg-surface">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-3 xl:gap-6">
            {/* Gauche : Titre, Montant Héro animé et Variation */}
            <div className="space-y-1.5 sm:space-y-3">
                <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs sm:text-sm text-ink-300">
                    <span className="sr-only">Trajectoire</span>
                    <span className="gf-ticker-symbol">{lentilleCourante.ticker}</span>
                    <span aria-hidden="true" className="text-ink-400">·</span>
                    <h1 className="font-semibold text-ink-100 tracking-normal text-sm sm:text-lg">
                        {prenom ? `${prenom} · ${lentilleCourante.label}` : lentilleCourante.label}
                    </h1>
                    <FxEstimateBadge />
                </div>

                <div className="flex flex-wrap items-baseline gap-2.5 sm:gap-3.5">
                    <AnimatedNetWorth
                        value={valeurHeroAffichee}
                        as="div"
                        testId="animated-global-net-worth"
                        className="font-mono tabular-nums text-3xl sm:text-5xl font-bold tracking-normal text-ink-50 leading-none"
                    />

                    {variation && lentilleHero === 'net' ? (
                        <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm font-mono font-semibold tabular-nums ${
                                variation.diff >= 0 ? 'gf-delta-up' : 'gf-delta-down'
                            }`}
                        >
                            <span aria-hidden="true">{variation.diff >= 0 ? '↑' : '↓'}</span>
                            {variation.pct != null && (
                                <PrivateAmount>{`${variation.diff >= 0 ? '+' : ''}${formatPercent(variation.pct)}`}</PrivateAmount>
                            )}
                            <PrivateAmount>
                                {`(${variation.diff >= 0 ? '+' : ''}${formatCompactCAD(variation.diff)})`}
                            </PrivateAmount>
                        </span>
                    ) : (
                        gainHorizon && (
                            <span
                                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sm:text-sm font-mono font-semibold tabular-nums ${
                                    gainHorizon.diff >= 0 ? 'gf-delta-up' : 'gf-delta-down'
                                }`}
                            >
                                <span aria-hidden="true">{gainHorizon.diff >= 0 ? '↑' : '↓'}</span>
                                {gainHorizon.pct != null && (
                                    <PrivateAmount>{`${gainHorizon.diff >= 0 ? '+' : ''}${formatPercent(gainHorizon.pct)}`}</PrivateAmount>
                                )}
                                <PrivateAmount>
                                    {`(${gainHorizon.diff >= 0 ? '+' : ''}${formatCompactCAD(gainHorizon.diff)}) ${horizon}`}
                                </PrivateAmount>
                            </span>
                        )
                    )}
                </div>
            </div>

            {/* Droite : Sélecteur épuré des 4 lentilles avec montant direct */}
            <div
                role="group"
                aria-label="Lentille d'affichage du patrimoine"
                className="flex overflow-x-auto no-scrollbar snap-x gap-2 w-full sm:grid sm:grid-cols-4 sm:gap-2.5 xl:w-auto xl:min-w-[600px]"
            >
                {(
                    [
                        { cle: 'net' as const, label: 'Patrimoine net', ticker: 'BILAN:CAD', val: patrimoineNet, dotClass: 'gf-alloc-reer' },
                        { cle: 'portefeuille' as const, label: 'Portefeuille', ticker: 'PORT:CAD', val: portefeuillePlacements, dotClass: 'gf-alloc-celi' },
                        { cle: 'liquidites' as const, label: 'Liquidités', ticker: 'CASH:CAD', val: liquidites, dotClass: 'gf-alloc-cash' },
                        { cle: 'immobilier' as const, label: 'Immobilier', ticker: 'IMMO:CAD', val: realEstateEquity, dotClass: 'gf-alloc-immo' },
                    ] as const
                ).map((l) => {
                    const actif = lentilleHero === l.cle;
                    return (
                        <button
                            key={l.cle}
                            type="button"
                            aria-pressed={actif}
                            onClick={() => setLentilleHero(l.cle)}
                            className={`touch-target min-h-11 min-w-[132px] sm:min-w-0 shrink-0 snap-start rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-left border transition-all duration-150 flex flex-col justify-between gap-1 sm:gap-1.5 focus-ring ${
                                actif
                                    ? 'bg-surface-douce border-bordure-champ'
                                    : 'bg-fond border-bordure hover:bg-surface-douce hover:border-bordure-champ'
                            }`}
                        >
                            <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-ink-300">
                                <span className={`w-2 h-2 rounded-full shrink-0 ${l.dotClass}`} aria-hidden="true" />
                                <span className="truncate font-medium">{l.label}</span>
                                <span className="sr-only">{l.ticker}</span>
                            </div>
                            <div className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                <PrivateAmount>{formatCompactCAD(l.val)}</PrivateAmount>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>

        {/* Barre d'outils épurée de la courbe */}
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 pt-2.5 sm:pt-4 border-t border-bordure">
            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto min-w-0">
                <div
                    role="group"
                    aria-label="Horizon de la courbe"
                    className="inline-flex items-center p-1 rounded-full border border-bordure bg-fond gap-0.5 sm:gap-1 max-w-full overflow-x-auto no-scrollbar"
                >
                    {HORIZONS.map((h) => (
                        <button
                            key={h.cle}
                            type="button"
                            aria-pressed={horizon === h.cle}
                            onClick={() => setHorizon(h.cle)}
                            className={`touch-target min-h-11 shrink-0 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-mono font-semibold tabular-nums transition-colors duration-100 focus-ring ${
                                horizon === h.cle ? 'gf-subtab-pill-active' : 'text-ink-300 hover:text-ink-50'
                            }`}
                        >
                            {h.label}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-full sm:flex-wrap sm:flex-1 sm:justify-between">
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 sm:flex-wrap">
                        <div
                            role="group"
                            aria-label="Série affichée sur la courbe"
                            className="inline-flex items-center p-1 rounded-full border border-bordure bg-fond gap-1 shrink-0"
                        >
                            <button
                                type="button"
                                aria-pressed={modeCourbe === 'nette'}
                                onClick={() => setModeCourbe('nette')}
                                className={`touch-target min-h-11 px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors duration-100 focus-ring whitespace-nowrap shrink-0 ${
                                    modeCourbe === 'nette' ? 'gf-subtab-pill-active' : 'text-ink-300 hover:text-ink-50'
                                }`}
                            >
                                Valeur nette
                            </button>
                            <button
                                type="button"
                                aria-pressed={modeCourbe === 'complete'}
                                onClick={() => setModeCourbe('complete')}
                                className={`touch-target min-h-11 px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors duration-100 focus-ring whitespace-nowrap shrink-0 ${
                                    modeCourbe === 'complete' ? 'gf-subtab-pill-active' : 'text-ink-300 hover:text-ink-50'
                                }`}
                            >
                                Par compte<span className="hidden sm:inline"> · + Avoirs</span>
                            </button>
                        </div>

                        <button
                            type="button"
                            aria-pressed={tempsFortsActifs}
                            onClick={() => setTempsFortsActifs((v) => !v)}
                            className={`touch-target min-h-11 shrink-0 whitespace-nowrap px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 sm:gap-2 border transition-all duration-150 focus-ring ${
                                tempsFortsActifs
                                    ? 'gf-delta-amber'
                                    : 'bg-fond text-ink-300 border-bordure hover:text-ink-50'
                            }`}
                        >
                            <span className="gf-amber-dot shrink-0" aria-hidden="true" />
                            <span>Temps forts</span>
                        </button>

                        <button
                            type="button"
                            data-testid="accueil-toggle-mc"
                            aria-pressed={runMC}
                            onClick={() => {
                                const next = !runMC;
                                setRunMC(next);
                                if (next && lentilleHero !== 'net') setLentilleHero('net');
                            }}
                            title={runMC ? 'Masquer les courbes Monte Carlo (P10–P90)' : 'Afficher les courbes Monte Carlo (P10–P90)'}
                            className={`touch-target min-h-11 shrink-0 whitespace-nowrap px-3 sm:px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium inline-flex items-center gap-1.5 sm:gap-2 border transition-all duration-150 focus-ring ${
                                runMC
                                    ? 'gf-subtab-pill-active'
                                    : 'bg-fond text-ink-300 border-bordure hover:text-ink-50 hover:border-bordure-champ'
                            }`}
                        >
                            <span className="w-2 h-2 rounded-full gf-alloc-nonreg shrink-0" aria-hidden="true" />
                            <span>Monte Carlo</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 sm:ml-auto">
                        <button
                            type="button"
                            onClick={onBasculerHorizonSuivant}
                            aria-label="Choisir la durée Présent et Futur de la courbe"
                            className="touch-target min-h-11 shrink-0 whitespace-nowrap px-3 sm:px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-mono text-ink-300 hover:text-ink-50 inline-flex items-center gap-1.5 sm:gap-2 transition-colors duration-100 focus-ring"
                        >
                            <Icon name="refresh" size={13} aria-hidden="true" />
                            <span>
                                <span className="hidden sm:inline">{isDailyCurve ? 'Pas quotidien (' : 'Pas mensuel ('}</span>
                                {isDailyCurve ? '1 j' : '1 m'}
                                <span className="hidden sm:inline">)</span>
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab(Tab.FUTURE)}
                            onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                            className="touch-target min-h-11 shrink-0 whitespace-nowrap px-3 sm:px-4 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs sm:text-sm font-medium text-ink-100 inline-flex items-center gap-1 sm:gap-1.5 transition-colors duration-100 focus-ring"
                        >
                            <span>Simulateur</span>
                            <Icon name="chevron-right" size={14} aria-hidden="true" />
                        </button>
                    </div>
                </div>
            </div>
        </div>

        {/* Lecture directe de la fenêtre ou du point survolé / épinglé */}
        {(pointInspecte || resumeFenetre) && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 sm:px-3.5 sm:py-2 rounded-xl bg-fond border border-bordure text-[11px] sm:text-xs font-mono tabular-nums">
                {pointInspecte && typeof pointInspecte.valeur === 'number' ? (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold text-ink-50">
                            {pointInspecte.dateLabel || pointInspecte.annee}
                        </span>
                        <span className="font-bold text-ink-50">
                            <PrivateAmount>{formatCAD(pointInspecte.valeur)}</PrivateAmount>
                        </span>
                        <span
                            className={
                                pointInspecte.valeur - valeurHeroAffichee >= 0
                                    ? 'text-succes-texte font-semibold'
                                    : 'text-erreur-texte font-semibold'
                            }
                        >
                            <PrivateAmount>
                                {`${pointInspecte.valeur - valeurHeroAffichee >= 0 ? '+' : ''}${formatCompactCAD(pointInspecte.valeur - valeurHeroAffichee)} vs aujourd'hui`}
                            </PrivateAmount>
                        </span>
                        <span className="text-ink-400">
                            {pointEpingle ? 'Repère épinglé' : 'Cliquer pour épingler'}
                        </span>
                    </div>
                ) : (
                    resumeFenetre && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-ink-300">
                            <span>
                                Bas :{' '}
                                <strong className="text-ink-100">
                                    <PrivateAmount>{formatCompactCAD(resumeFenetre.min)}</PrivateAmount>
                                </strong>
                            </span>
                            <span>
                                Haut :{' '}
                                <strong className="text-ink-100">
                                    <PrivateAmount>{formatCompactCAD(resumeFenetre.max)}</PrivateAmount>
                                </strong>
                            </span>
                            <span className={resumeFenetre.diff >= 0 ? 'text-succes-texte font-semibold' : 'text-erreur-texte font-semibold'}>
                                <PrivateAmount>
                                    {`${resumeFenetre.diff >= 0 ? '+' : ''}${formatCompactCAD(resumeFenetre.diff)}${
                                        resumeFenetre.pct !== null ? ` (${resumeFenetre.diff >= 0 ? '+' : ''}${formatPercent(resumeFenetre.pct)})` : ''
                                    } sur ${horizon}`}
                                </PrivateAmount>
                            </span>
                        </div>
                    )
                )}
                {pointEpingle && (
                    <button
                        type="button"
                        onClick={() => setPointEpingle(null)}
                        className="touch-target px-3 py-1 rounded-full bg-surface-douce border border-bordure text-xs font-sans font-medium text-ink-200 hover:text-ink-50 focus-ring"
                    >
                        Effacer le repère
                    </button>
                )}
            </div>
        )}

        {lentilleHero === 'net' && (
            <div
                data-testid="accueil-mc-legend"
                className="flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 px-1 text-[11px] sm:text-xs text-ink-300"
            >
                <div className="flex items-center gap-x-3 sm:gap-x-4 overflow-x-auto no-scrollbar whitespace-nowrap sm:flex-wrap sm:gap-y-1 max-w-full">
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                        <span className="w-4 border-t-2" style={{ borderColor: 'var(--gf-bleu)' }} aria-hidden="true" />
                        <span>Passé réel</span>
                    </span>
                    <span className="inline-flex items-center gap-1.5 shrink-0">
                        <span className="w-4 border-t-2" style={{ borderColor: 'var(--gf-vert)' }} aria-hidden="true" />
                        <span>Projection</span>
                    </span>
                    {runMC && (
                        <>
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                                <span className="w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--gf-violet)' }} aria-hidden="true" />
                                <span>Favorable (P90)</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                                <span className="w-4 border-t-2 border-dotted" style={{ borderColor: 'var(--gf-bleu)' }} aria-hidden="true" />
                                <span>Médiane (P50)</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5 shrink-0">
                                <span className="w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--gf-rouge)' }} aria-hidden="true" />
                                <span>Prudent (P10)</span>
                            </span>
                        </>
                    )}
                </div>
                {runMC && (
                    <span className="text-ink-400">
                        {!hasMcSeries
                            ? projectionStatus === 'computing'
                                ? 'Calcul Monte Carlo en cours…'
                                : 'En attente de projection'
                            : hasPastCurveCalibration
                              ? 'Calibré depuis janv. 2025'
                              : 'Fourchette Monte Carlo active'}
                    </span>
                )}
            </div>
        )}

        {/* Courbe principale plein cadre */}
        <div
            data-testid="recharts-trajectory-entrance"
            data-active-tab={activeTab}
            data-chart-horizon={horizon}
            data-chart-mode={modeCourbe}
            data-chart-lens={lentilleHero}
            role="img"
            aria-label="Graphique combiné du présent et du futur projeté — valeurs détaillées dans le tableau de données."
            className="h-[235px] sm:h-[400px] w-full gf-chart-enter py-1 sm:py-2 cursor-crosshair"
        >
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                    data={donneesTrajectoireAvecRuban}
                    margin={{ top: 18, right: 12, left: 0, bottom: 4 }}
                    onMouseMove={(s) => {
                        const raw = (s as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex;
                        const idx = raw !== undefined && raw !== null ? Number(raw) : NaN;
                        const pt = Number.isInteger(idx) && idx >= 0 && idx < donneesTrajectoire.length
                            ? (donneesTrajectoire[idx] ?? null)
                            : null;
                        setPointSurvole(pt);
                    }}
                    onMouseLeave={() => setPointSurvole(null)}
                    onClick={(s) => {
                        const raw = (s as { activeTooltipIndex?: number | string | null } | null)?.activeTooltipIndex;
                        const idx = raw !== undefined && raw !== null ? Number(raw) : NaN;
                        const pt = Number.isInteger(idx) && idx >= 0 && idx < donneesTrajectoire.length
                            ? (donneesTrajectoire[idx] ?? null)
                            : null;
                        if (!pt) return;
                        setPointEpingle((prev) => (prev?.monthIndex === pt.monthIndex ? null : pt));
                    }}
                >
                    <defs>
                        <linearGradient id="accueilPresentGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--gf-bleu)" stopOpacity={0.38} />
                            <stop offset="70%" stopColor="var(--gf-bleu)" stopOpacity={0.1} />
                            <stop offset="100%" stopColor="var(--gf-bleu)" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="accueilFuturGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--gf-vert)" stopOpacity={0.34} />
                            <stop offset="70%" stopColor="var(--gf-vert)" stopOpacity={0.09} />
                            <stop offset="100%" stopColor="var(--gf-vert)" stopOpacity={0.0} />
                        </linearGradient>
                        <linearGradient id="accueilMcGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--gf-violet)" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="var(--gf-violet)" stopOpacity={0.08} />
                        </linearGradient>
                        {(
                            ['Liquidites', 'CELI', 'CELIAPP', 'REER', 'REEE', 'NonReg', 'Crypto', 'Immobilier', 'Entreprise'] as const
                        ).map((cle) => (
                            <linearGradient key={`acc-grad-${cle}`} id={`accGrad${cle}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={couleurSerie(cle)} stopOpacity={0.36} />
                                <stop offset="95%" stopColor={couleurSerie(cle)} stopOpacity={0.05} />
                            </linearGradient>
                        ))}
                        <linearGradient id="accGradDettes" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={COULEUR_DETTE} stopOpacity={0.08} />
                            <stop offset="95%" stopColor={COULEUR_DETTE} stopOpacity={0.32} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--bordure)" strokeOpacity={0.55} />
                    <XAxis
                        dataKey="monthIndex"
                        type="number"
                        domain={X_AXIS_DOMAIN}
                        allowDataOverflow
                        minTickGap={26}
                        tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                        axisLine={{ stroke: 'var(--bordure)' }}
                        tickLine={false}
                        tickFormatter={formatTickXAccueil}
                    />
                    <YAxis
                        orientation="left"
                        domain={echelleYTrajectoire.domaine}
                        ticks={echelleYTrajectoire.ticks}
                        allowDataOverflow
                        tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                        axisLine={false}
                        tickLine={false}
                        width={62}
                        tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v))}
                    />
                    <Tooltip
                        isAnimationActive={false}
                        cursor={GF_CROSSHAIR_CURSOR}
                        content={
                            <TrajectoireTooltip
                                patrimoineInitial={valeurHeroAffichee}
                                isPrivacyMode={isPrivacyMode}
                                enrichPoint={enrichDailyPoint}
                            />
                        }
                    />

                    {pastPrefixCount > 0 && pastStartIndex < xAuj && (
                        <ReferenceArea
                            x1={Math.max(bornesHorizonMois[0], pastStartIndex)}
                            x2={xAuj}
                            fill="var(--surface-douce)"
                            fillOpacity={0.28}
                            ifOverflow="hidden"
                        />
                    )}

                    {echelleYTrajectoire.domaine[0] <= 0 && echelleYTrajectoire.domaine[1] >= 0 && (
                        <ReferenceLine y={0} stroke="var(--bordure)" strokeWidth={1} />
                    )}

                    <ReferenceLine
                        x={xAuj}
                        stroke="var(--gf-ambre)"
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        ifOverflow="hidden"
                        label={<RefLineLabel value="Aujourd'hui" color="var(--gf-ambre)" />}
                    />

                    {tempsFortsActifs &&
                        lentilleHero === 'net' &&
                        fireNumber > 0 &&
                        fireNumber >= echelleYTrajectoire.domaine[0] &&
                        fireNumber <= echelleYTrajectoire.domaine[1] && (
                        <ReferenceLine
                            y={fireNumber}
                            stroke="var(--gf-ambre)"
                            strokeDasharray="5 5"
                            strokeOpacity={0.75}
                            ifOverflow="hidden"
                            label={<RefLineLabel value="Cible FIRE" color="var(--gf-ambre)" />}
                        />
                    )}
                    {tempsFortsActifs &&
                        jalonFire &&
                        jalonFire.monthIndex >= bornesHorizonMois[0] &&
                        jalonFire.monthIndex <= bornesHorizonMois[1] && (
                            <ReferenceLine
                                x={jalonFire.monthIndex}
                                stroke="var(--gf-ambre)"
                                strokeDasharray="3 3"
                                ifOverflow="hidden"
                                label={<RefLineLabel value={`FIRE (${jalonFire.year})`} color="var(--gf-ambre)" jalon />}
                            />
                        )}
                    {tempsFortsActifs &&
                        pointRetraite &&
                        pointRetraite.monthIndex >= bornesHorizonMois[0] &&
                        pointRetraite.monthIndex <= bornesHorizonMois[1] && (
                            <ReferenceLine
                                x={pointRetraite.monthIndex}
                                stroke="var(--gf-bleu)"
                                strokeDasharray="3 3"
                                ifOverflow="hidden"
                                label={
                                    <RefLineLabel
                                        // NOMBRE-NON-MONETAIRE : âge de la retraite sur le repère vertical
                                        value={`Retraite (${pointRetraite.age} ans)`}
                                        color="var(--gf-bleu)"
                                        jalon
                                    />
                                }
                            />
                        )}

                    {modeCourbe === 'complete' && lentilleHero === 'net' ? (
                        <>
                            {(
                                ['Liquidites', 'CELI', 'CELIAPP', 'REER', 'REEE', 'NonReg', 'Crypto', 'Immobilier', 'Entreprise'] as const
                            ).map((cle) => (
                                <Area
                                    key={`area-${cle}`}
                                    type="monotone"
                                    dataKey={cle}
                                    stackId="1"
                                    stroke={couleurSerie(cle)}
                                    strokeWidth={1.5}
                                    fill={`url(#accGrad${cle})`}
                                    fillOpacity={1}
                                    isAnimationActive={false}
                                />
                            ))}
                            <Area
                                type="monotone"
                                dataKey={detteSousZero}
                                name="Dettes (hors hypothèque)"
                                stroke={COULEUR_DETTE}
                                strokeWidth={1.5}
                                fill="url(#accGradDettes)"
                                fillOpacity={1}
                                baseValue={0}
                                isAnimationActive={false}
                            />
                            <Line type="monotone" dataKey={detteLevierSousZero} name={LIBELLE_LEVIER} stroke={COULEUR_LEVIER} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="ImpotLatent" name="Impôt latent" stroke={couleurSerie('ImpotLatent')} strokeWidth={1.5} strokeDasharray="5 5" dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="avoirs" name="Avoirs bruts" stroke="var(--gf-ambre)" strokeWidth={1.75} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="NetWorth" name="Valeur nette" stroke={couleurSerie('NetWorth')} strokeWidth={2.5} dot={false} activeDot={GF_ACTIVE_DOT} isAnimationActive={false} />
                            {runMC && (
                                <>
                                    <Line type="monotone" dataKey="mcP90" name="Scénario favorable (P90)" stroke="var(--gf-violet)" strokeWidth={1.85} strokeDasharray="5 4" strokeOpacity={0.95} connectNulls={false} dot={false} activeDot={false} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="mcP50" name="Médiane Monte Carlo (P50)" stroke="var(--gf-bleu)" strokeWidth={1.6} strokeDasharray="3 3" strokeOpacity={0.85} connectNulls={false} dot={false} activeDot={false} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="mcP10" name="Scénario prudent (P10)" stroke="var(--gf-rouge)" strokeWidth={1.85} strokeDasharray="5 4" strokeOpacity={0.9} connectNulls={false} dot={false} activeDot={false} isAnimationActive={false} />
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            {modeCourbe === 'complete' && (
                                <Line type="monotone" dataKey="avoirs" name="Avoirs bruts" stroke="var(--gf-ambre)" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                            )}
                            {lentilleHero === 'net' && runMC && (
                                <Area type="monotone" dataKey="mcRange" stroke="none" fill="url(#accueilMcGrad)" fillOpacity={1} connectNulls={false} dot={false} activeDot={false} name="Fourchette P10–P90" isAnimationActive={false} />
                            )}
                            {modeCourbe === 'complete' && lentilleHero === 'net' && (
                                <Area type="monotone" dataKey={detteSousZero} name="Dettes (hors hypothèque)" stroke={COULEUR_DETTE} strokeWidth={1.25} fill="url(#accGradDettes)" fillOpacity={0.85} baseValue={0} isAnimationActive={false} />
                            )}
                            <Area type="monotone" dataKey="valeurPresent" baseValue={echelleYTrajectoire.domaine[0]} stroke="none" fill="url(#accueilPresentGrad)" fillOpacity={1} connectNulls={false} isAnimationActive={false} />
                            <Line
                                type="monotone"
                                dataKey="valeurPresent"
                                stroke="var(--gf-bleu)"
                                strokeWidth={2.75}
                                connectNulls={false}
                                dot={false}
                                activeDot={(props: { cx?: number; cy?: number; value?: number | null }) => {
                                    if (
                                        props.value === null ||
                                        props.value === undefined ||
                                        !Number.isFinite(props.value) ||
                                        typeof props.cx !== 'number' ||
                                        typeof props.cy !== 'number'
                                    )
                                        return null;
                                    return <circle cx={props.cx} cy={props.cy} r={5} fill="var(--gf-bleu)" stroke="var(--fond)" strokeWidth={2} />;
                                }}
                                isAnimationActive={false}
                            />
                            <Area type="monotone" dataKey="valeurFutur" baseValue={echelleYTrajectoire.domaine[0]} stroke="none" fill="url(#accueilFuturGrad)" fillOpacity={1} connectNulls={false} isAnimationActive={false} />
                            <Line
                                type="monotone"
                                dataKey="valeurFutur"
                                stroke="var(--gf-vert)"
                                strokeWidth={2.6}
                                strokeDasharray={isDailyCurve ? undefined : '5 4'}
                                connectNulls={false}
                                dot={false}
                                activeDot={(props: { cx?: number; cy?: number; value?: number | null; payload?: PointTrajectoire }) => {
                                    if (
                                        props.value === null ||
                                        props.value === undefined ||
                                        !Number.isFinite(props.value) ||
                                        typeof props.cx !== 'number' ||
                                        typeof props.cy !== 'number'
                                    )
                                        return null;
                                    if (props.payload?.periode === 'transition') return null;
                                    return <circle cx={props.cx} cy={props.cy} r={5} fill="var(--gf-vert)" stroke="var(--fond)" strokeWidth={2} />;
                                }}
                                isAnimationActive={false}
                            />
                            {lentilleHero === 'net' && runMC && (
                                <>
                                    <Line type="monotone" dataKey="mcP90" name="Scénario favorable (P90)" stroke="var(--gf-violet)" strokeWidth={1.85} strokeDasharray="5 4" strokeOpacity={0.95} connectNulls={false} dot={false} activeDot={false} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="mcP50" name="Médiane Monte Carlo (P50)" stroke="var(--gf-bleu)" strokeWidth={1.6} strokeDasharray="3 3" strokeOpacity={0.85} connectNulls={false} dot={false} activeDot={false} isAnimationActive={false} />
                                    <Line type="monotone" dataKey="mcP10" name="Scénario prudent (P10)" stroke="var(--gf-rouge)" strokeWidth={1.85} strokeDasharray="5 4" strokeOpacity={0.9} connectNulls={false} dot={false} activeDot={false} isAnimationActive={false} />
                                </>
                            )}
                        </>
                    )}

                    {pointAncre && typeof extraireValeurLentillePoint(pointAncre) === 'number' && (
                        <ReferenceDot
                            x={pointAncre.monthIndex}
                            y={extraireValeurLentillePoint(pointAncre) ?? 0}
                            r={4.5}
                            fill="var(--gf-ambre)"
                            stroke="var(--fond)"
                            strokeWidth={2}
                            ifOverflow="hidden"
                            shape={
                                <TodayValueBadge
                                    value={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v))(
                                        extraireValeurLentillePoint(pointAncre) ?? 0,
                                    )}
                                />
                            }
                        />
                    )}

                    {pointsTempsForts.map((pt, idx) => (
                        <ReferenceDot
                            key={`tf-${pt.monthIndex}-${idx}`}
                            x={pt.monthIndex}
                            y={pt.valeur ?? undefined}
                            r={5}
                            fill="var(--gf-ambre)"
                            stroke="var(--fond)"
                            strokeWidth={2}
                            ifOverflow="hidden"
                        />
                    ))}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
        <ChartDataTable
            caption="Trajectoire projetée du patrimoine net sur l'horizon sélectionné"
            columns={colonnesTrajectoire}
            rows={donneesTrajectoire as unknown as ReadonlyArray<Record<string, unknown>>}
        />
    </div>
);
