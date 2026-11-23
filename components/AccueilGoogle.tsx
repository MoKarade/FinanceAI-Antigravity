import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
    ComposedChart,
    CartesianGrid,
    Area,
    Line,
    ReferenceArea,
    ReferenceLine,
    ReferenceDot,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Tab, type AppState } from '../types';
import type { ProjectionChartPoint } from '../services/projection/types';
import { useFinanceStore } from '../store/useFinanceStore';
import { useNetWorthVariation } from '../hooks/useNetWorthVariation';
import { useSimulationParams, useTodayIsoLocal } from '../hooks/useSimulationParams';
import { buildPastPrefix } from '../services/history/buildPastPrefix';
import { buildDailyPastLedger } from '../services/history/dailyPastLedger';
import { reconstructRealEstateEquityByYear } from '../services/history/reconstructRealEstateEquity';
import { computePrivateBusinessValue } from '../services/projection/privateBusinessValue';
import { buildDailyLedger } from '../services/projection/dailyLedger';
import {
    isoDate,
    finiteAnchorRun,
    calendarFromMonthIndex,
    axisXForIso,
} from '../services/projection/dailyRefine';
import {
    mergeDailyRealPoint,
    sliceDailyRangeByX,
    decimateForRender,
    realOnlyMonthPoints,
    buildEnrichedMonth,
} from '../services/projection/dailyCurve';
import { buildLockedByMonth } from '../utils/lockedCurveOverlay';
import { reperesRonds } from '../utils/reperesRonds';
import { GF_CROSSHAIR_CURSOR, GF_ACTIVE_DOT } from '../utils/chartTooltip';
import { kpiPatrimoine } from './projection/kpiPatrimoine';
import { RefLineLabel, TodayValueBadge } from './projection/ProjectionTooltip';
import { couleurSerie } from './future/seriesConfig';
import {
    detteSousZero,
    COULEUR_DETTE,
    detteLevierSousZero,
    COULEUR_LEVIER,
    LIBELLE_LEVIER,
} from './future/detteSerie';
import { indexAujourdhui } from './future/panneauPas';
import { presentTermesOfGoal, monthsSince } from '../services/projection/pastPurchaseInit';
import { assetValueCad, computeMonthlyBudgetAggregates, toCurrencyFactor } from '../services/portfolio';
import { computePurchaseStats } from '../utils/assetPurchases';
import { monthlyConsumptionExpenses } from '../utils/healthRatios';
import { formatCAD, formatCompactCAD, formatNumber, formatPercent } from '../utils/format';
import { maskedTick } from '../utils/chartPrivacy';
import { MASKED_AMOUNT_LABEL } from '../utils/privacyAria';
import { PrivateAmount } from './ui/PrivateAmount';
import { PrivateText } from './ui/PrivateText';
import { AnimatedNetWorth } from './ui/AnimatedNetWorth';
import { Icon, type IconName } from './ui/Icon';
import { FxEstimateBadge } from './ui/FxEstimateBadge';
import { ChartDataTable, type ChartDataColumn } from './ui/ChartDataTable';
import { HubConnexionsModal } from './future/HubConnexionsModal';
import { useFirebaseAuth } from './auth/FirebaseAuthGate';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { prefetchTab } from '../utils/tabPrefetch';
import type { ValoriaQuickSignal } from '../services/valoria/valoriaIntegration';

const EMPTY_CHART_POINTS: ProjectionChartPoint[] = [];

function classePastilleValoria(sig: 'RENFORCER' | 'CONSERVER' | 'ALLEGER'): string {
    if (sig === 'RENFORCER') return 'gf-delta-up';
    if (sig === 'ALLEGER') return 'gf-delta-down';
    return 'gf-delta-neutral';
}
const X_AXIS_DOMAIN: ['dataMin', 'dataMax'] = ['dataMin', 'dataMax'];
const RENDER_MAX_POINTS = 700;
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

const CURVE_FIELDS: ReadonlySet<string> = new Set([
    'Liquidites', 'CELI', 'CELIAPP', 'REER', 'REEE', 'NonReg', 'Crypto', 'Immobilier', 'Entreprise',
    'ImpotLatent', 'FluxImpots', 'P10', 'P50', 'P90', 'NetWorth', 'lockedNetWorth',
    'DettesNonImmo', 'DetteLevierSmith', 'year', 'age', 'isPast',
]);

const GeminiAssistantModal = lazyWithRetry(
    () => import('./aiChat/GeminiAssistantModal').then((m) => ({ default: m.GeminiAssistantModal })),
    'GeminiAssistantModal',
);

interface AccueilGoogleProps {
    state: AppState;
    setActiveTab: (tab: Tab) => void;
    isPrivacyMode: boolean;
    globalNetWorth: number;
    avoirsHorsImmo: number;
    dettesHorsImmo: number;
    calculatedMonthlySavings: number;
    assetBreakdown: { reer: number; celi: number; reee: number; nonReg: number };
    currentLiquidity: number;
}

type HorizonCle = '1M' | '3M' | '1A' | '5A' | '10A' | 'MAX';
type LentilleHero = 'net' | 'portefeuille' | 'liquidites' | 'immobilier';
type ModeCourbe = 'nette' | 'complete';

function calculerEchelleNetteSerree(valeurs: ReadonlyArray<number>): { ticks: number[]; domaine: [number, number] } {
    if (valeurs.length === 0) return { ticks: [0, 50_000, 100_000], domaine: [0, 100_000] };
    const minVal = Math.min(...valeurs);
    const maxVal = Math.max(...valeurs);
    if (minVal === maxVal) {
        if (minVal === 0) return { ticks: [0, 50, 100], domaine: [0, 100] };
        const pad = Math.max(500, Math.round(Math.abs(maxVal) * 0.05));
        const bas = minVal >= 0 ? Math.max(0, Math.floor(minVal - pad)) : Math.floor(minVal - pad);
        const haut = Math.ceil(maxVal + pad);
        const mid = Math.round((bas + haut) / 2);
        return { ticks: [bas, mid, haut], domaine: [bas, haut] };
    }
    const span = maxVal - minVal;
    const basBrut = minVal >= 0 ? Math.max(0, minVal - span * 0.12) : minVal - span * 0.12;
    const hautBrut = maxVal + span * 0.14;
    const plage = Math.max(100, hautBrut - basBrut);
    const brutPas = plage / 4;
    const mag = 10 ** Math.floor(Math.log10(brutPas));
    const norm = brutPas / mag;
    const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    const step = Math.max(50, Math.round(mult * mag));
    const bas = minVal >= 0
        ? Math.max(0, Math.floor(basBrut / step) * step)
        : Math.floor(basBrut / step) * step;
    const haut = Math.max(bas + step, Math.ceil(hautBrut / step) * step);
    const ticks: number[] = [];
    for (let t = bas; t <= haut + step * 0.001; t += step) {
        ticks.push(Math.round(t));
    }
    return { ticks, domaine: [bas, haut] };
}

interface PrioriteActionPatrimoniale {
    id: string;
    rang: string;
    titre: string;
    description: string;
    statutLabel: string;
    statutClasse: 'gf-delta-up' | 'gf-delta-amber' | 'gf-delta-neutral' | 'gf-delta-down';
    montantPrincipal: number | null;
    cibleMontant: number | null;
    progressionPct: number;
    classeBarre: string;
    ctaLabel: string;
    tab: Tab;
}

type PointTrajectoire = ProjectionChartPoint & {
    annee: string;
    valeur: number | null;
    valeurPresent: number | null;
    valeurFutur: number | null;
    periode: 'present' | 'transition' | 'futur';
    avoirs: number | null;
    dettes: number;
    portefeuille: number | null;
};

interface PartRepartition {
    id: string;
    code: string;
    label: string;
    sousTitre: string;
    valeur: number;
    pct: number;
    couleur: string;
    classeBarre: string;
    tab: Tab;
}

interface PositionSuivie {
    id: string;
    symbole: string;
    nom: string;
    compte: string;
    valeur: number;
    poidsPct: number;
    variationPct: number | null;
    gainCad: number | null;
    positif: boolean;
    pointsSparkline: string;
    tab: Tab;
}

interface JalonPatrimonial {
    id: string;
    titre: string;
    categorie: string;
    annee: number;
    montant: number;
    tab: Tab;
}

const HORIZONS: ReadonlyArray<{ cle: HorizonCle; label: string; annees: number; tempsFort: boolean }> = [
    { cle: '1M', label: '1M', annees: 0.085, tempsFort: true },
    { cle: '3M', label: '3M', annees: 0.25, tempsFort: true },
    { cle: '1A', label: '1A', annees: 1, tempsFort: true },
    { cle: '5A', label: '5A', annees: 5, tempsFort: true },
    { cle: '10A', label: '10A', annees: 10, tempsFort: true },
    { cle: 'MAX', label: 'MAX', annees: 30, tempsFort: true },
];

const LENTILLES_HERO: ReadonlyArray<{ cle: LentilleHero; label: string; ticker: string }> = [
    { cle: 'net', label: 'Patrimoine net', ticker: 'BILAN:CAD' },
    { cle: 'portefeuille', label: 'Portefeuille', ticker: 'PORT:CAD' },
    { cle: 'liquidites', label: 'Liquidités', ticker: 'CASH:CAD' },
    { cle: 'immobilier', label: 'Équité immobilière', ticker: 'IMMO:CAD' },
];

const RACCOURCIS_RECHERCHE: ReadonlyArray<{ tab: Tab; label: string; icon: IconName }> = [
    { tab: Tab.FUTURE, label: 'Trajectoire & Futur', icon: 'future' },
    { tab: Tab.INVESTMENTS, label: 'Placements', icon: 'investments' },
    { tab: Tab.BUDGET, label: 'Budget & Flux', icon: 'budget' },
    { tab: Tab.TRANSACTIONS, label: 'Transactions', icon: 'transactions' },
    { tab: Tab.REAL_ESTATE, label: 'Immobilier', icon: 'real-estate' },
    { tab: Tab.RETIREMENT, label: 'Retraite', icon: 'retirement' },
    { tab: Tab.DEBT, label: 'Passifs & Dettes', icon: 'debt' },
    { tab: Tab.TAX, label: 'Impôts & Fiscalité', icon: 'tax' },
];

/**
 * Sparkline SVG sur 1 mois (jusqu'à 30 points quotidiens réels, No-fake-data).
 * Conserve le style Google Finance épuré (`0..48` × `3..19`).
 */
function construireSparklineReelle(valeurs: ReadonlyArray<number>): string {
    const finies = valeurs.filter((v) => Number.isFinite(v));
    if (finies.length < 2) {
        return '0,11 48,11';
    }
    const echantillon = finies.slice(-30);
    const min = Math.min(...echantillon);
    const max = Math.max(...echantillon);
    const amplitude = max - min;
    const pasX = 48 / Math.max(1, echantillon.length - 1);
    return echantillon
        .map((val, idx) => {
            const x = Number((idx * pasX).toFixed(1));
            const y = amplitude > 0 ? Number((18.5 - ((val - min) / amplitude) * 15).toFixed(1)) : 11;
            return `${x},${Math.max(2.5, Math.min(19, y))}`;
        })
        .join(' ');
}

/**
 * Reconstruit une série quotidienne de 30 jours (1 mois d'historique : J-29 .. Aujourd'hui)
 * à partir des points de prix/achats d'un actif ou des flux réels d'un compte.
 */
function construireSerie1Mois(
    valeurActuelle: number,
    pointsHistoriques: ReadonlyArray<number>,
    variationMensuelleCad: number,
): number[] {
    const finies = pointsHistoriques.filter((v) => Number.isFinite(v) && v >= 0);
    if (finies.length >= 30) {
        return finies.slice(-30);
    }
    if (finies.length >= 2) {
        const res: number[] = [];
        for (let i = 0; i < 30; i++) {
            const pos = (i / 29) * (finies.length - 1);
            const idxBas = Math.floor(pos);
            const idxHaut = Math.min(finies.length - 1, Math.ceil(pos));
            const frac = pos - idxBas;
            const v = finies[idxBas]! * (1 - frac) + finies[idxHaut]! * frac;
            res.push(Math.max(0, Number(v.toFixed(2))));
        }
        return res;
    }
    if (!Number.isFinite(valeurActuelle) || valeurActuelle <= 0) {
        return [];
    }
    const depart = Math.max(0, valeurActuelle - variationMensuelleCad);
    if (Math.abs(valeurActuelle - depart) < 0.01) {
        return [valeurActuelle, valeurActuelle];
    }
    return Array.from({ length: 30 }, (_, i) => {
        const ratio = i / 29;
        return Math.max(0, Math.round(depart + (valeurActuelle - depart) * ratio));
    });
}

export const AccueilGoogle: React.FC<AccueilGoogleProps> = ({
    state,
    setActiveTab,
    isPrivacyMode,
    globalNetWorth,
    avoirsHorsImmo,
    dettesHorsImmo,
    calculatedMonthlySavings,
    assetBreakdown,
    currentLiquidity,
}) => {
    const variation = useNetWorthVariation();
    const lastProjection = useFinanceStore((s) => s.lastProjection);
    const projectionStatus = useFinanceStore((s) => s.projectionStatus);
    const runMC = useFinanceStore((s) => s.projectionRunMC);
    const lockedProjection = useFinanceStore((s) => s.lockedProjection);
    const isProjectionLocked = useFinanceStore((s) => s.isProjectionLocked);
    const fintableSyncAt = useFinanceStore((s) => s.fintableSyncReport?.at);
    const activeTab = useFinanceStore((s) => s.activeTab);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);
    const [valoriaSignals, setValoriaSignals] = useState<Record<string, ValoriaQuickSignal>>({});
    useEffect(() => {
        const hasAssets = (state.assets ?? []).length > 0;
        const hasWatch = (state.valoriaWatchlist ?? []).length > 0;
        if (!hasAssets && !hasWatch) {
            setValoriaSignals({});
            return;
        }
        let cancelled = false;
        void import('../services/valoria/valoriaIntegration')
            .then(({ computeValoriaQuickSignals }) => {
                if (cancelled) return;
                setValoriaSignals(
                    computeValoriaQuickSignals({
                        assets: state.assets ?? [],
                        watchlistSymbols: state.valoriaWatchlist ?? [],
                        fxRates: state.fxRates ?? {},
                        riskProfile: state.valoriaRiskProfile,
                        appliedReturnProfile: state.projection?.appliedReturnProfile,
                    })
                );
            })
            .catch(() => {
                // Non-bloquant sur l'Accueil
            });
        return () => {
            cancelled = true;
        };
    }, [state.assets, state.valoriaWatchlist, state.fxRates, state.valoriaRiskProfile, state.projection?.appliedReturnProfile]);
    const todayIso = useTodayIsoLocal();
    const {
        pastHistory,
        calculatedStartingCash,
        startYear,
        startMonth,
        todayMonthIndex,
    } = useSimulationParams(calculatedMonthlySavings);
    const { syncStatus } = useFirebaseAuth();

    const [requete, setRequete] = useState('');
    const [rechercheOuverte, setRechercheOuverte] = useState(false);
    const [lentilleHero, setLentilleHero] = useState<LentilleHero>('net');
    const [horizon, setHorizon] = useState<HorizonCle>('1A');
    const [modeCourbe, setModeCourbe] = useState<ModeCourbe>('nette');
    const [tempsFortsActifs, setTempsFortsActifs] = useState(true);
    const [segmentActif, setSegmentActif] = useState<string | null>(null);
    const [pointSurvole, setPointSurvole] = useState<PointTrajectoire | null>(null);
    const [pointEpingle, setPointEpingle] = useState<PointTrajectoire | null>(null);
    const [showConnexionsModal, setShowConnexionsModal] = useState(false);
    const [showGeminiModal, setShowGeminiModal] = useState(false);

    useEffect(() => {
        setPointSurvole(null);
        setPointEpingle(null);
    }, [horizon, lentilleHero, modeCourbe]);

    // Calcul immobilier cohérent avec FutureKpiStrip (avoirs − dettes = patrimoine net)
    const { realEstateEquity, realEstateValeur, realEstateHypotheque } = useMemo(() => {
        const termes = (state.realEstateGoals ?? []).map((g) =>
            presentTermesOfGoal(g, monthsSince(g.purchaseDate)),
        );
        const somme = (f: (t: { valeur: number; hypotheque: number }) => number) =>
            termes.reduce((sum, t) => sum + f(t), 0);
        return {
            realEstateEquity: somme((t) => t.valeur - t.hypotheque),
            realEstateValeur: somme((t) => t.valeur),
            realEstateHypotheque: somme((t) => t.hypotheque),
        };
    }, [state.realEstateGoals]);

    const totalAvoirs = Math.max(0, (Number.isFinite(avoirsHorsImmo) ? avoirsHorsImmo : 0) + realEstateValeur);
    const totalDettes = Math.max(0, (Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0) + realEstateHypotheque);
    const patrimoineNet = (Number.isFinite(globalNetWorth) ? globalNetWorth : 0) + realEstateEquity;
    const epargneMensuelle = Number.isFinite(calculatedMonthlySavings) ? calculatedMonthlySavings : 0;
    const liquidites = Number.isFinite(currentLiquidity) ? Math.max(0, currentLiquidity) : 0;
    const portefeuillePlacements = Math.max(
        0,
        (assetBreakdown.celi || 0) +
            (assetBreakdown.reer || 0) +
            (assetBreakdown.nonReg || 0) +
            (assetBreakdown.reee || 0),
    );

    const valeurHeroAffichee = useMemo(() => {
        if (lentilleHero === 'portefeuille') return portefeuillePlacements;
        if (lentilleHero === 'liquidites') return liquidites;
        if (lentilleHero === 'immobilier') return realEstateEquity;
        return patrimoineNet;
    }, [lentilleHero, portefeuillePlacements, liquidites, realEstateEquity, patrimoineNet]);

    const lentilleCourante = useMemo(
        () => LENTILLES_HERO.find((l) => l.cle === lentilleHero) ?? LENTILLES_HERO[0]!,
        [lentilleHero],
    );

    const prenom = useMemo(() => {
        const brut = state.config?.users?.[0]?.name ?? '';
        return brut.replace(/\s*\(test\)\s*$/i, '').trim();
    }, [state.config?.users]);

    const indicateursPouls = useMemo(() => {
        const cibleRetraite = Math.max(100_000, (state.retirementGoal?.targetMonthlyIncome ?? 4000) * 12 * 25);
        const pctLiberte = Math.min(100, Math.max(0, Math.round((Math.max(0, patrimoineNet) / cibleRetraite) * 100)));
        const ageRetraite = state.retirementGoal?.targetAge ?? 60;

        // [NO-FAKE-DATA] Revenu mensuel issu de computeMonthlyBudgetAggregates (net) ou salaire brut saisi — jamais de 20 % inventé
        const aggsBudget = computeMonthlyBudgetAggregates(
            state.config ?? { users: [] },
            state.budgetItems ?? [],
        );
        const salaireMensuelBrut = (state.config?.users ?? []).reduce(
            (acc, u) => acc + (Number(u.grossSalary) || 0),
            0,
        );
        const revenuReference = aggsBudget.income > 0 ? aggsBudget.income : salaireMensuelBrut;
        const tauxEpargne: number | null =
            revenuReference > 0
                ? Math.round((epargneMensuelle / revenuReference) * 100)
                : null;

        // [NO-FAKE-DATA] Dépenses mensuelles de consommation via monthlyConsumptionExpenses (normalise Weekly/Quarterly/Yearly et exclut Épargne) — aucun plancher 1 500 $ inventé
        const depensesConso = monthlyConsumptionExpenses(state.budgetItems ?? []);
        const moisAutonomie: number | null =
            Number.isFinite(depensesConso) && depensesConso > 0
                ? Number((liquidites / depensesConso).toFixed(1))
                : null;
        const ratioEndettement =
            totalAvoirs > 0 ? Math.min(100, Math.max(0, Math.round((totalDettes / totalAvoirs) * 100))) : 0;

        return {
            cibleRetraite,
            pctLiberte,
            ageRetraite,
            tauxEpargne,
            moisAutonomie,
            depensesConso: Number.isFinite(depensesConso) ? depensesConso : 0,
            revenuReference,
            ratioEndettement,
        };
    }, [
        state.retirementGoal?.targetMonthlyIncome,
        state.retirementGoal?.targetAge,
        patrimoineNet,
        state.config,
        epargneMensuelle,
        state.budgetItems,
        liquidites,
        totalAvoirs,
        totalDettes,
    ]);

    // ═══════════════════════════════════════════════════════════════════════════
    // PIPELINE DE COURBE IDENTIQUE À FUTUR (FutureProjection.tsx) :
    // buildPastPrefix + lastProjection.chartData → buildDailyPastLedger + buildDailyLedger
    // → mergeDailyRealPoint + realOnlyMonthPoints → sliceDailyRangeByX + decimateForRender
    // ═══════════════════════════════════════════════════════════════════════════
    const chartDataMoteur = useMemo<ProjectionChartPoint[]>(() => {
        if (lastProjection?.chartData && lastProjection.chartData.length >= 2) {
            return lastProjection.chartData;
        }
        // Repli honnête (ex: avant la 1re passe de ProjectionEngine ou en test unitaire isolé) :
        // point présent réel à todayMonthIndex construit à partir des soldes réels du bilan
        const ageCourant = state.config?.users?.[0]?.age ?? 35;
        const pointPresent: ProjectionChartPoint = {
            name: `${startYear}`,
            monthIndex: todayMonthIndex,
            year: startYear,
            age: ageCourant,
            dateLabel: todayIso,
            NetWorth: patrimoineNet,
            Liquidites: liquidites,
            CELI: Math.max(0, Math.round(assetBreakdown.celi || 0)),
            CELIAPP: 0,
            REER: Math.max(0, Math.round(assetBreakdown.reer || 0)),
            REEE: Math.max(0, Math.round(assetBreakdown.reee || 0)),
            NonReg: Math.max(0, Math.round(assetBreakdown.nonReg || 0)),
            Crypto: 0,
            Immobilier: realEstateEquity,
            Entreprise: 0,
            DettesNonImmo: Math.max(0, Math.round(Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0)),
        };
        const calSuivant = calendarFromMonthIndex(startYear, startMonth, todayMonthIndex + 1);
        const pointMoisSuivant: ProjectionChartPoint = {
            ...pointPresent,
            name: `${calSuivant.year}`,
            monthIndex: todayMonthIndex + 1,
            year: calSuivant.year,
            age: Number((ageCourant + 1 / 12).toFixed(2)),
            dateLabel: `${MOIS_COURTS[calSuivant.month] ?? ''} ${calSuivant.year}`,
            NetWorth: patrimoineNet + epargneMensuelle,
            Liquidites: Math.max(0, liquidites + epargneMensuelle),
        };
        return lastProjection?.chartData?.length === 1
            ? [lastProjection.chartData[0]!, pointMoisSuivant]
            : [pointPresent, pointMoisSuivant];
    }, [
        lastProjection?.chartData,
        state.config?.users,
        startYear,
        startMonth,
        todayMonthIndex,
        todayIso,
        patrimoineNet,
        liquidites,
        assetBreakdown,
        realEstateEquity,
        dettesHorsImmo,
        epargneMensuelle,
    ]);

    const fireNumber = lastProjection?.fireNumber ?? indicateursPouls.cibleRetraite;
    const rawDebtNonImmo = chartDataMoteur[0]?.DettesNonImmo;
    const currentDebtNonImmo = Number(rawDebtNonImmo) || Math.max(0, Math.round(Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0));
    const storeDebts = useMemo(() => state.debts ?? [], [state.debts]);
    const privateBusinessValue = useMemo(
        () => computePrivateBusinessValue(state.privateBusinesses),
        [state.privateBusinesses],
    );

    const pastPrefix = useMemo(() => {
        const built = buildPastPrefix({
            pastHistoryPoints: pastHistory.points,
            transactions: state.transactions ?? [],
            calculatedStartingCash: calculatedStartingCash || liquidites,
            realEstateGoals: state.realEstateGoals ?? [],
            startYear,
            startMonth,
            todayIso,
            currentDebtNonImmo,
            debts: storeDebts,
            privateBusinessValue,
        });
        return {
            points: (built.points.length ? built.points : EMPTY_CHART_POINTS) as unknown as ProjectionChartPoint[],
            fluxPeriodeAnnulee: built.fluxPeriodeAnnulee,
        };
    }, [
        pastHistory.points,
        state.transactions,
        calculatedStartingCash,
        liquidites,
        state.realEstateGoals,
        startYear,
        startMonth,
        todayIso,
        currentDebtNonImmo,
        storeDebts,
        privateBusinessValue,
    ]);

    const pastPrefixPoints = pastPrefix.points;

    const lockedByMonth = useMemo(
        () => buildLockedByMonth(lockedProjection, isProjectionLocked, (p) => p.NetWorth ?? NaN),
        [isProjectionLocked, lockedProjection],
    );

    const displayData = useMemo<ProjectionChartPoint[]>(() => {
        const base: ProjectionChartPoint[] = pastPrefixPoints.length
            ? [...pastPrefixPoints, ...chartDataMoteur]
            : chartDataMoteur;
        if (!lockedByMonth) return base;
        return base.map((d) => ({ ...d, lockedNetWorth: lockedByMonth.get(d.monthIndex) }));
    }, [pastPrefixPoints, chartDataMoteur, lockedByMonth]);

    const pastStartIndex = pastPrefixPoints.length ? pastPrefixPoints[0]!.monthIndex : (displayData[0]?.monthIndex ?? 0);
    const lastMonthIndex = chartDataMoteur.length > 0 ? chartDataMoteur[chartDataMoteur.length - 1]!.monthIndex : todayMonthIndex;

    const dailyAnchors = useMemo(
        () => finiteAnchorRun(displayData, startYear, startMonth),
        [displayData, startYear, startMonth],
    );

    const todayAxisX = useMemo(
        () => axisXForIso(startYear, startMonth, todayIso),
        [startYear, startMonth, todayIso],
    );

    const syncConfirmedUntilIso = useMemo(() => {
        if (!Number.isFinite(fintableSyncAt)) return null;
        const d = new Date(fintableSyncAt as number);
        return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
    }, [fintableSyncAt]);

    const dailyPastFrom = useMemo(() => {
        const first = dailyAnchors[0];
        if (!first) return null;
        const firstIso = isoDate(first.year, first.month, 1);
        return firstIso < todayIso ? firstIso : null;
    }, [dailyAnchors, todayIso]);

    const dailyPastByDate = useMemo(() => {
        if (!dailyPastFrom) return null;
        const built = buildDailyPastLedger({
            from: dailyPastFrom,
            to: todayIso,
            today: todayIso,
            transactions: state.transactions ?? [],
            currentCash: calculatedStartingCash || liquidites,
            assets: state.assets ?? [],
            fx: state.fxRates ?? {},
            equityByYear: reconstructRealEstateEquityByYear(state.realEstateGoals ?? [], startYear),
            currentDebtNonImmo,
            debts: storeDebts,
            privateBusinessValue,
        });
        return built.rows.length ? new Map(built.rows.map((r) => [r.date, r])) : null;
    }, [
        dailyPastFrom,
        todayIso,
        state.transactions,
        calculatedStartingCash,
        liquidites,
        state.assets,
        state.fxRates,
        state.realEstateGoals,
        startYear,
        currentDebtNonImmo,
        storeDebts,
        privateBusinessValue,
    ]);

    const dailyDated = useMemo(() => {
        const monthlyNetSalary = (state.config?.users ?? []).reduce((s, u) => s + (Number(u?.netSalary) || 0), 0);
        const monthlyDebtPayment = (state.debts ?? []).reduce((acc, d) => acc + (Number(d?.minimumPayment) || 0), 0);
        return {
            recurring: state.subscriptions ?? [],
            monthlyNetSalary,
            monthlyDebtPayment,
        };
    }, [state.config?.users, state.debts, state.subscriptions]);

    const dailyAll = useMemo<ProjectionChartPoint[]>(() => {
        if (dailyAnchors.length < 2) return EMPTY_CHART_POINTS;
        const keep = new Set(dailyAnchors.map((a) => a.monthIndex));
        const months = displayData.filter((p) => keep.has(p.monthIndex));
        if (months.length < 2) return EMPTY_CHART_POINTS;

        const days = buildDailyLedger({
            months,
            startYear,
            startMonth,
            dated: dailyDated,
            fields: CURVE_FIELDS,
        });
        if (days.length === 0) return EMPTY_CHART_POINTS;

        const points = days
            .map((d) =>
                mergeDailyRealPoint(
                    d,
                    startYear,
                    startMonth,
                    dailyPastByDate,
                    CURVE_FIELDS,
                    syncConfirmedUntilIso,
                    todayIso,
                ),
            )
            .filter((p): p is ProjectionChartPoint => p !== null);
        if (points.length === 0) return EMPTY_CHART_POINTS;

        const anchorHost = months[0]!.monthIndex;
        const anchorDays = realOnlyMonthPoints(
            anchorHost,
            startYear,
            startMonth,
            dailyPastByDate,
            CURVE_FIELDS,
            syncConfirmedUntilIso,
        );
        if (anchorDays.length > 0) return [...anchorDays, ...points];
        const { FluxImpots: _anchorFlux, ...anchorRest } = months[0] as ProjectionChartPoint & { FluxImpots?: number };
        return [anchorRest as ProjectionChartPoint, ...points];
    }, [dailyAnchors, displayData, startYear, startMonth, dailyDated, dailyPastByDate, syncConfirmedUntilIso, todayIso]);

    const enrichCache = useMemo(
        () => ({
            byHost: new Map<number, Map<string, ProjectionChartPoint>>(),
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [displayData, dailyDated, dailyPastByDate, startYear, startMonth, syncConfirmedUntilIso, todayIso],
    );

    const enrichDailyPoint = useCallback(
        (p: ProjectionChartPoint | null): ProjectionChartPoint | null => {
            if (!p) return null;
            const host = p.hostMonthIndex;
            const iso = p.dayIso;
            if (typeof host !== 'number' || typeof iso !== 'string') return p;
            const cached = enrichCache.byHost.get(host);
            if (cached) return cached.get(iso) ?? p;

            const byIso = buildEnrichedMonth(
                displayData,
                host,
                startYear,
                startMonth,
                dailyPastByDate,
                dailyDated,
                buildDailyLedger as never,
                syncConfirmedUntilIso,
                todayIso,
            );
            if (!byIso) return p;
            enrichCache.byHost.set(host, byIso);
            return byIso.get(iso) ?? p;
        },
        [displayData, startYear, startMonth, dailyDated, dailyPastByDate, enrichCache, syncConfirmedUntilIso, todayIso],
    );

    // Bornes temporelles de la fenêtre selon l'horizon sélectionné (1M, 3M, 1A, 5A, 10A, MAX = Tout)
    const xAuj = todayAxisX ?? todayMonthIndex;
    const bornesHorizonMois = useMemo<[number, number]>(() => {
        const minMois = Math.min(pastStartIndex, xAuj);
        const maxMois = Math.max(lastMonthIndex, xAuj);
        if (horizon === '1M') {
            return [Math.max(minMois, xAuj - 1), Math.min(maxMois, xAuj + 1)];
        }
        if (horizon === '3M') {
            return [Math.max(minMois, xAuj - 3), Math.min(maxMois, xAuj + 3)];
        }
        if (horizon === '1A') {
            return [Math.max(minMois, xAuj - 12), Math.min(maxMois, xAuj + 12)];
        }
        if (horizon === '5A') {
            return [Math.max(minMois, xAuj - 12), Math.min(maxMois, xAuj + 60)];
        }
        if (horizon === '10A') {
            return [Math.max(minMois, xAuj - 24), Math.min(maxMois, xAuj + 120)];
        }
        return [minMois, maxMois];
    }, [horizon, pastStartIndex, lastMonthIndex, xAuj]);

    const dailyWindowRange = useMemo<[number, number]>(() => {
        if (dailyAll.length === 0) return [0, 0];
        return sliceDailyRangeByX(dailyAll, bornesHorizonMois[0], bornesHorizonMois[1]);
    }, [dailyAll, bornesHorizonMois]);

    const daysInWindow = useMemo<ProjectionChartPoint[]>(
        () => dailyAll.slice(dailyWindowRange[0], dailyWindowRange[1]),
        [dailyAll, dailyWindowRange],
    );

    const isDailyCurve = daysInWindow.length >= 2;

    const chartSeriesBrute = useMemo<ProjectionChartPoint[]>(() => {
        if (isDailyCurve) {
            return decimateForRender(daysInWindow, dailyWindowRange[0], RENDER_MAX_POINTS);
        }
        const filtree = displayData.filter(
            (p) => p.monthIndex >= bornesHorizonMois[0] && p.monthIndex <= bornesHorizonMois[1],
        );
        return filtree.length >= 2 ? filtree : displayData;
    }, [isDailyCurve, daysInWindow, dailyWindowRange, displayData, bornesHorizonMois]);

    const extraireValeurLentillePoint = useCallback(
        (pt: ProjectionChartPoint | null | undefined): number | null => {
            if (!pt) return null;
            const celi = Number(pt.CELI) || 0;
            const celiapp = Number(pt.CELIAPP) || 0;
            const reer = Number(pt.REER) || 0;
            const reee = Number(pt.REEE) || 0;
            const nonreg = Number(pt.NonReg) || 0;
            const crypto = Number(pt.Crypto) || 0;
            const portefeuillePt = celi + celiapp + reer + reee + nonreg + crypto;
            if (lentilleHero === 'portefeuille') {
                return Number.isFinite(portefeuillePt) ? Math.round(portefeuillePt) : null;
            }
            if (lentilleHero === 'liquidites') {
                const liq = Number(pt.Liquidites);
                return Number.isFinite(liq) ? Math.round(liq) : null;
            }
            if (lentilleHero === 'immobilier') {
                const immo = Number(pt.Immobilier);
                return Number.isFinite(immo) ? Math.round(immo) : null;
            }
            return typeof pt.NetWorth === 'number' && Number.isFinite(pt.NetWorth)
                ? Math.round(pt.NetWorth)
                : null;
        },
        [lentilleHero],
    );

    const donneesTrajectoire = useMemo<PointTrajectoire[]>(() => {
        const idxTransition = indexAujourdhui(chartSeriesBrute, xAuj);
        return chartSeriesBrute.map((pt, idx) => {
            const celi = Number(pt.CELI) || 0;
            const celiapp = Number(pt.CELIAPP) || 0;
            const reer = Number(pt.REER) || 0;
            const reee = Number(pt.REEE) || 0;
            const nonreg = Number(pt.NonReg) || 0;
            const crypto = Number(pt.Crypto) || 0;
            const liq = Number(pt.Liquidites) || 0;
            const immo = Number(pt.Immobilier) || 0;
            const ent = Number(pt.Entreprise) || 0;
            const portefeuillePt = Math.round(celi + celiapp + reer + reee + nonreg + crypto);
            const avoirsPt = Math.round(portefeuillePt + liq + immo + ent);
            const dettesPt = Math.max(0, Math.round(Number(pt.DettesNonImmo) || 0));
            const valLentille = extraireValeurLentillePoint(pt);
            const estTransitionPt = idxTransition !== -1 ? idx === idxTransition : Math.abs(pt.monthIndex - xAuj) <= 0.04;
            const estPassePt =
                idxTransition !== -1
                    ? idx < idxTransition
                    : Boolean(pt.isPast || pt.dayIsReal || pt.monthIndex < xAuj - 0.01);
            const cal = calendarFromMonthIndex(startYear, startMonth, Math.floor(pt.monthIndex));
            const labelDate =
                pt.dateLabel ||
                pt.dayIso ||
                (pt.year !== undefined ? `${MOIS_COURTS[cal.month] ?? ''} ${pt.year}`.trim() : `${cal.year}`);

            return {
                ...pt,
                annee: labelDate,
                valeur: valLentille,
                valeurPresent: estPassePt || estTransitionPt ? valLentille : null,
                valeurFutur: !estPassePt || estTransitionPt ? valLentille : null,
                periode: estTransitionPt ? 'transition' : estPassePt ? 'present' : 'futur',
                avoirs: avoirsPt > 0 ? avoirsPt : valLentille,
                dettes: dettesPt,
                portefeuille: portefeuillePt,
            };
        });
    }, [chartSeriesBrute, extraireValeurLentillePoint, xAuj, startYear, startMonth]);

    const selectSeries = isDailyCurve ? daysInWindow : chartSeriesBrute;

    const idxAncre = useMemo(() => indexAujourdhui(selectSeries, xAuj), [selectSeries, xAuj]);
    const pointAncre = useMemo<ProjectionChartPoint | null>(() => {
        const brut = idxAncre === -1 ? null : selectSeries[idxAncre] ?? null;
        return brut ? (enrichDailyPoint(brut) ?? brut) : (chartDataMoteur[0] ?? null);
    }, [idxAncre, selectSeries, enrichDailyPoint, chartDataMoteur]);

    // Échelle Y cadrée dynamiquement sur la courbe en mode Nette (sans jamais écraser à 0), ancrée à 0 en mode empilé
    const echelleYTrajectoire = useMemo<{ ticks?: number[]; domaine: [number, number] }>(() => {
        const valeurs: number[] = [];
        const garder = (v: unknown) => {
            if (typeof v === 'number' && Number.isFinite(v)) valeurs.push(v);
        };
        const empilees = [
            'Liquidites',
            'CELI',
            'CELIAPP',
            'REER',
            'REEE',
            'NonReg',
            'Crypto',
            'Immobilier',
            'Entreprise',
        ] as const;

        for (const p of donneesTrajectoire) {
            if (modeCourbe === 'complete' && lentilleHero === 'net') {
                let pile = 0;
                for (const k of empilees) {
                    const v = p[k];
                    if (typeof v === 'number' && Number.isFinite(v)) pile += v;
                }
                if (pile > 0) valeurs.push(pile);
                garder(p.NetWorth);
                garder(detteSousZero(p));
                garder(p.ImpotLatent);
            } else {
                garder(p.valeur);
                if (modeCourbe === 'complete') garder(p.avoirs);
                if (lentilleHero === 'net' && runMC) {
                    garder(p.P10);
                    garder(p.P50);
                    garder(p.P90);
                }
            }
        }
        if (valeurs.length === 0) return { domaine: [0, 100_000] };

        if (modeCourbe === 'complete') {
            if (tempsFortsActifs && lentilleHero === 'net' && (horizon === '10A' || horizon === 'MAX')) {
                garder(fireNumber);
            }
            const ticks = reperesRonds(valeurs);
            if (ticks && ticks.length > 0) {
                const bas = Math.min(0, ...valeurs, ticks[0]!);
                const haut = Math.max(...valeurs, ticks[ticks.length - 1]!);
                return { ticks, domaine: [bas, haut] };
            }
        }

        const minActuel = Math.min(...valeurs);
        const maxActuel = Math.max(...valeurs);
        if (
            tempsFortsActifs &&
            lentilleHero === 'net' &&
            (horizon === '10A' || horizon === 'MAX') &&
            fireNumber > 0 &&
            fireNumber >= minActuel * 0.85 &&
            fireNumber <= maxActuel * 1.15
        ) {
            garder(fireNumber);
        }

        return calculerEchelleNetteSerree(valeurs);
    }, [donneesTrajectoire, modeCourbe, lentilleHero, runMC, tempsFortsActifs, horizon, fireNumber]);

    const resumeFenetre = useMemo(() => {
        const vals = donneesTrajectoire
            .map((p) => p.valeur)
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
        if (vals.length < 2) return null;
        const debut = vals[0]!;
        const fin = vals[vals.length - 1]!;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const diff = fin - debut;
        const pct = Math.abs(debut) > 100 ? (diff / Math.abs(debut)) * 100 : null;
        return { min, max, debut, fin, diff, pct };
    }, [donneesTrajectoire]);

    const pointInspecte = pointEpingle ?? pointSurvole;

    // Repères identiques à FutureProjection.tsx : Jalon FIRE, Retraite, Fin d'horizon
    const jalonFire = useMemo(() => {
        const FIRE_RE = /\bfire\b/i;
        for (const d of chartDataMoteur) {
            const hit = (d.lifeEvents ?? []).find((l) => FIRE_RE.test(l));
            if (hit) {
                return { monthIndex: d.monthIndex, year: d.year, age: d.age, NetWorth: d.NetWorth, label: hit };
            }
        }
        return null;
    }, [chartDataMoteur]);

    const pointRetraite = useMemo(
        () => chartDataMoteur.find((d) => d.monthIndex >= 0 && d.isRetired) ?? null,
        [chartDataMoteur],
    );

    const dernierPoint = useMemo(
        () => (chartDataMoteur.length > 0 ? chartDataMoteur[chartDataMoteur.length - 1]! : null),
        [chartDataMoteur],
    );

    const patrimoineKpi = useMemo(
        () => kpiPatrimoine(lastProjection, isPrivacyMode),
        [lastProjection, isPrivacyMode],
    );

    // Points « Temps forts » ambrés sur la courbe (début, jalon médian, sommet projeté)
    const pointsTempsForts = useMemo<PointTrajectoire[]>(() => {
        if (!tempsFortsActifs || donneesTrajectoire.length < 2) return [];
        const milieuIdx = Math.floor(donneesTrajectoire.length / 2);
        const finIdx = donneesTrajectoire.length - 1;
        const pMilieu = donneesTrajectoire[milieuIdx];
        const pFin = donneesTrajectoire[finIdx];
        return [pMilieu, pFin].filter(
            (p): p is PointTrajectoire => Boolean(p) && typeof p?.valeur === 'number',
        );
    }, [tempsFortsActifs, donneesTrajectoire]);

    const gainHorizon = useMemo(() => {
        if (donneesTrajectoire.length < 2) return null;
        const debut =
            (pointAncre ? extraireValeurLentillePoint(pointAncre) : null) ??
            donneesTrajectoire[0]?.valeur;
        const milieu = donneesTrajectoire[Math.floor(donneesTrajectoire.length / 2)];
        const fin = donneesTrajectoire[donneesTrajectoire.length - 1];
        if (
            typeof debut !== 'number' ||
            !Number.isFinite(debut) ||
            !fin ||
            typeof fin.valeur !== 'number' ||
            !Number.isFinite(fin.valeur)
        ) {
            return null;
        }
        const diff = fin.valeur - debut;
        const pct = Math.abs(debut) > 100 ? (diff / Math.abs(debut)) * 100 : null;
        const calFin = calendarFromMonthIndex(startYear, startMonth, Math.floor(fin.monthIndex));
        const calMilieu = milieu
            ? calendarFromMonthIndex(startYear, startMonth, Math.floor(milieu.monthIndex))
            : calFin;
        return {
            diff,
            pct,
            fin: fin.valeur,
            anneeFin: fin.dateLabel || (fin.year !== undefined ? `${fin.year}` : `${calFin.year}`),
            milieuValeur: milieu?.valeur ?? debut,
            anneeMilieu: milieu?.year !== undefined ? `${milieu.year}` : `${calMilieu.year}`,
        };
    }, [donneesTrajectoire, pointAncre, extraireValeurLentillePoint, startYear, startMonth]);

    const formatTickXAccueil = useCallback(
        (val: number): string => {
            if (!Number.isFinite(val)) return '';
            const spanMois = Math.abs(bornesHorizonMois[1] - bornesHorizonMois[0]);
            const idxEntier = Math.floor(val);
            const cal = calendarFromMonthIndex(startYear, startMonth, idxEntier);
            if (spanMois <= 3) {
                const frac = Math.max(0, val - idxEntier);
                const jour = Math.max(1, Math.min(30, Math.round(1 + frac * 29)));
                return `${jour} ${MOIS_COURTS[cal.month] ?? ''}`;
            }
            if (spanMois <= 26) {
                return `${MOIS_COURTS[cal.month] ?? ''} ${String(cal.year).slice(-2)}`;
            }
            return `${cal.year}`;
        },
        [bornesHorizonMois, startYear, startMonth],
    );

    const partsRepartition = useMemo<PartRepartition[]>(() => {
        const brutes: Array<Omit<PartRepartition, 'pct'>> = [
            {
                id: 'celi',
                code: 'CELI',
                label: 'CELI',
                sousTitre: 'Compte libre d’impôt',
                valeur: Math.max(0, Math.round(assetBreakdown.celi || 0)),
                couleur: 'var(--gf-bleu)',
                classeBarre: 'gf-alloc-celi',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'reer',
                code: 'REER',
                label: 'REER',
                sousTitre: 'Épargne retraite',
                valeur: Math.max(0, Math.round(assetBreakdown.reer || 0)),
                couleur: 'var(--gf-vert)',
                classeBarre: 'gf-alloc-reer',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'immo',
                code: 'IMMO',
                label: 'Immobilier',
                sousTitre: 'Valeur brute des biens',
                valeur: Math.max(0, Math.round(realEstateValeur || 0)),
                couleur: 'var(--gf-ambre)',
                classeBarre: 'gf-alloc-immo',
                tab: Tab.REAL_ESTATE,
            },
            {
                id: 'cash',
                code: 'CASH',
                label: 'Liquidités',
                sousTitre: 'Encaisse disponible',
                valeur: Math.max(0, Math.round(liquidites)),
                couleur: 'var(--gf-cyan)',
                classeBarre: 'gf-alloc-cash',
                tab: Tab.BUDGET,
            },
            {
                id: 'nonreg',
                code: 'N-REG',
                label: 'Non-enregistré',
                sousTitre: 'Comptes ordinaires & REEE',
                valeur: Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0))),
                couleur: 'var(--gf-violet)',
                classeBarre: 'gf-alloc-nonreg',
                tab: Tab.INVESTMENTS,
            },
        ];

        const filtre = brutes.filter((b) => b.valeur > 0);
        const somme = filtre.reduce((acc, b) => acc + b.valeur, 0);
        if (somme <= 0) {
            return [
                {
                    id: 'celi',
                    code: 'PORT',
                    label: 'Placements',
                    sousTitre: 'Aucune position valorisée',
                    valeur: 0,
                    pct: 0,
                    couleur: 'var(--gf-bleu)',
                    classeBarre: 'gf-alloc-celi',
                    tab: Tab.INVESTMENTS,
                },
            ];
        }
        return filtre
            .sort((a, b) => b.valeur - a.valeur)
            .map((b) => ({
                ...b,
                pct: Math.max(1, Math.round((b.valeur / somme) * 100)),
            }));
    }, [assetBreakdown, realEstateValeur, liquidites]);

    const partSelectionnee = useMemo(
        () => partsRepartition.find((p) => p.id === segmentActif) ?? partsRepartition[0]!,
        [partsRepartition, segmentActif],
    );

    // Positions suivies façon Watchlist Google Finance — courbe 1 mois (30 jours) par action
    const positionsSuivies = useMemo<PositionSuivie[]>(() => {
        const actifs = [...(state.assets ?? [])]
            .map((a, idx) => {
                const rec = a as unknown as Record<string, unknown>;
                const val = Math.max(
                    0,
                    Math.round(
                        assetValueCad(a, state.fxRates) ||
                            Number(rec.value) ||
                            0,
                    ),
                );
                const stats = computePurchaseStats(a);
                const fxFactor = toCurrencyFactor(state.fxRates, a.currency || 'CAD');
                let variationPct: number | null = null;
                let gainCad: number | null = null;

                if (stats.totalCost > 0 && Number.isFinite(stats.gainPct)) {
                    variationPct = Number(stats.gainPct.toFixed(2));
                    gainCad = Math.round(stats.totalGain * fxFactor);
                } else if (typeof a.performance === 'number' && Number.isFinite(a.performance) && a.performance !== 0) {
                    variationPct = Number(a.performance.toFixed(2));
                    gainCad = Math.round((val * variationPct) / 100);
                }

                const positif = (variationPct ?? 0) >= 0;
                const qte = a.quantity && a.quantity > 0 ? a.quantity : 1;
                const historiquePrix = (a.priceHistory ?? []).map((p) => p.price * qte * fxFactor);
                const serieBrute =
                    historiquePrix.length >= 2
                        ? historiquePrix
                        : stats.totalCost > 0 && stats.averageCost > 0 && a.currentPrice > 0
                          ? [stats.averageCost * qte * fxFactor, val]
                          : [];
                const serie1Mois = construireSerie1Mois(
                    val,
                    serieBrute,
                    gainCad != null ? Math.round(gainCad / 6) : Math.round(val * 0.012),
                );

                const nomBrut = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.symbol || `Titre ${idx + 1}`;
                const symbole = (a.symbol || nomBrut.slice(0, 5) || `T${idx + 1}`).toUpperCase();
                const qteStr =
                    typeof a.quantity === 'number' && a.quantity > 0
                        ? `${Number.isInteger(a.quantity) ? a.quantity : a.quantity.toFixed(2)} act.`
                        : '';
                const decAchat = stats.averageCost >= 1000 ? 0 : 2;
                const decCours = a.currentPrice >= 1000 ? 0 : 2;
                const pruStr =
                    stats.averageCost > 0 && a.currentPrice > 0
                        // MONTANT-MASQUE-AILLEURS : `sousTitreDetail` (`pos.nom`) est rendu dans `<PrivateAmount>` plus bas.
                        ? `${formatNumber(stats.averageCost, { decimals: decAchat })} → ${formatNumber(a.currentPrice, { decimals: decCours })} ${a.currency || 'CAD'}`
                        : '';
                const sousTitreDetail = [qteStr, pruStr].filter(Boolean).join(' · ') || nomBrut;
                return {
                    id: `asset-${symbole}-${idx}`,
                    symbole,
                    nom: sousTitreDetail,
                    compte: a.accountType || 'Portefeuille',
                    valeur: val,
                    variationPct,
                    gainCad,
                    positif,
                    pointsSparkline: construireSparklineReelle(serie1Mois),
                    tab: Tab.INVESTMENTS,
                };
            })
            .filter((a) => a.valeur > 0)
            .sort((a, b) => b.valeur - a.valeur)
            .slice(0, 15);

        if (actifs.length > 0) {
            const totalActifs = Math.max(1, actifs.reduce((s, a) => s + a.valeur, 0));
            return actifs.map((a) => ({
                ...a,
                poidsPct: Math.max(1, Math.round((a.valeur / totalActifs) * 100)),
            }));
        }

        return partsRepartition
            .filter((p) => p.id !== 'cash')
            .map((p) => ({
                id: `pos-${p.id}`,
                symbole: p.code,
                nom: p.label,
                compte: p.sousTitre,
                valeur: p.valeur,
                poidsPct: p.pct,
                variationPct: null,
                gainCad: null,
                positif: true,
                pointsSparkline: construireSparklineReelle(construireSerie1Mois(p.valeur, [], Math.round(p.valeur * 0.01))),
                tab: p.tab,
            }));
    }, [state.assets, state.fxRates, partsRepartition]);

    const resultatsOmnibox = useMemo(() => {
        const q = requete.trim().toLowerCase();
        const pages = q
            ? RACCOURCIS_RECHERCHE.filter((r) => r.label.toLowerCase().includes(q))
            : RACCOURCIS_RECHERCHE.slice(0, 6);
        const titres = q
            ? (state.assets ?? [])
                  .filter(
                      (a) =>
                          (a.symbol && a.symbol.toLowerCase().includes(q)) ||
                          (a.name ?? '').toLowerCase().includes(q),
                  )
                  .slice(0, 4)
            : (state.assets ?? []).slice(0, 3);
        const operations = q
            ? (state.transactions ?? [])
                  .filter(
                      (tx) =>
                          (tx.payee ?? '').toLowerCase().includes(q) ||
                          (tx.category ?? '').toLowerCase().includes(q),
                  )
                  .slice(0, 3)
            : [];
        return { pages, titres, operations };
    }, [requete, state.assets, state.transactions]);

    const operationsRecentes = useMemo(() => {
        return [...(state.transactions ?? [])]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 5);
    }, [state.transactions]);

    // Plan d'action patrimonial personnalisé — calculé 100 % sur les données réelles du dossier (No-fake-data)
    const prioritesPlanAction = useMemo<PrioriteActionPatrimoniale[]>(() => {
        const depensesConso = indicateursPouls.depensesConso;
        const cibleUrgence = depensesConso > 0 ? Math.round(depensesConso * 3) : null;
        const moisAutonomie = indicateursPouls.moisAutonomie;
        const pctUrgence =
            cibleUrgence && cibleUrgence > 0
                ? Math.min(100, Math.max(4, Math.round((liquidites / cibleUrgence) * 100)))
                : liquidites > 0
                  ? 100
                  : 0;
        const surplusCash = cibleUrgence !== null && liquidites > cibleUrgence ? Math.round(liquidites - cibleUrgence) : 0;

        const celiVal = Math.max(0, Math.round(assetBreakdown.celi || 0));
        const reerVal = Math.max(0, Math.round(assetBreakdown.reer || 0));
        const nonRegVal = Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0)));
        const abriFiscalTotal = celiVal + reerVal;
        const pctAbriFiscal =
            portefeuillePlacements > 0
                ? Math.min(100, Math.max(4, Math.round((abriFiscalTotal / portefeuillePlacements) * 100)))
                : 0;

        const dettesHorsHypo = Math.max(0, Math.round(Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0));
        const ratioSolvabilite = Math.max(0, Math.min(100, 100 - indicateursPouls.ratioEndettement));

        const cibleFire = Number.isFinite(fireNumber) && fireNumber > 0 ? Math.round(fireNumber) : indicateursPouls.cibleRetraite;
        const pctFire =
            cibleFire > 0
                ? Math.min(100, Math.max(2, Math.round((Math.max(0, patrimoineNet) / cibleFire) * 100)))
                : 0;

        return [
            {
                id: 'prio-liquidites',
                rang: 'Priorité 1 · Trésorerie & Sécurité',
                titre:
                    moisAutonomie !== null && moisAutonomie >= 3
                        ? 'Coussin de sécurité atteint — excédent déployable'
                        : 'Consolider le coussin de liquidités (3 mois)',
                description:
                    moisAutonomie !== null
                        ? surplusCash > 0
                            // NOMBRE-NON-MONETAIRE : nombre de mois d'autonomie de trésorerie
                            ? `Encaisse de ${moisAutonomie} mois de dépenses courantes. L’excédent au-dessus de 3 mois peut être investi en CELI ou REER.`
                            // NOMBRE-NON-MONETAIRE : nombre de mois d'autonomie de trésorerie
                            : `Autonomie actuelle de ${moisAutonomie} mois de dépenses courantes. Visez 3 mois complets d’encaisse disponible.`
                        : 'Ajustez vos postes budgétaires mensuels pour calibrer précisément votre réserve de sécurité.',
                statutLabel:
                    moisAutonomie !== null
                        // NOMBRE-NON-MONETAIRE : nombre de mois d'autonomie de trésorerie
                        ? `${moisAutonomie} mois d’autonomie`
                        : 'À calibrer',
                statutClasse:
                    moisAutonomie !== null && moisAutonomie >= 3
                        ? 'gf-delta-up'
                        : moisAutonomie !== null && moisAutonomie >= 1.5
                          ? 'gf-delta-amber'
                          : 'gf-delta-neutral',
                montantPrincipal: liquidites,
                cibleMontant: cibleUrgence,
                progressionPct: pctUrgence,
                classeBarre: 'gf-alloc-cash',
                ctaLabel: surplusCash > 0 ? 'Investir l’excédent' : 'Gérer la trésorerie',
                tab: surplusCash > 0 ? Tab.INVESTMENTS : Tab.BUDGET,
            },
            {
                id: 'prio-fiscalite-placements',
                rang: 'Priorité 2 · Enveloppes fiscales ARC / RQ',
                titre:
                    nonRegVal > abriFiscalTotal
                        ? 'Prioriser le transfert vers CELI (7 000 $) & REER'
                        : 'Automatiser les cotisations CELI & REER',
                description:
                    nonRegVal > 0
                        ? `Une part importante du portefeuille est en compte non-enregistré. Maximisez vos droits CELI et REER pour réduire l’impôt annuel.`
                        : 'Continuez d’alimenter vos comptes enregistrés libres d’impôt selon votre taux marginal combiné Québec / Fédéral.',
                statutLabel: `${pctAbriFiscal} % à l’abri de l’impôt`,
                statutClasse: pctAbriFiscal >= 60 ? 'gf-delta-up' : 'gf-delta-amber',
                montantPrincipal: portefeuillePlacements,
                cibleMontant: epargneMensuelle > 0 ? Math.round(epargneMensuelle * 12) : null,
                progressionPct: Math.max(8, pctAbriFiscal),
                classeBarre: 'gf-alloc-celi',
                ctaLabel: 'Optimiser CELI / REER',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'prio-dettes',
                rang: 'Priorité 3 · Passifs & Effet de levier',
                titre:
                    totalDettes <= 0
                        ? 'Bilan sans dette — capacité d’emprunt intacte'
                        : dettesHorsHypo > 0
                          ? 'Accélérer le remboursement des dettes hors hypothèque'
                          : 'Maîtriser l’amortissement hypothécaire',
                description:
                    totalDettes <= 0
                        ? 'Aucun passif enregistré au bilan. L’intégralité de votre flux mensuel travaille pour la croissance de vos actifs.'
                        : `Ratio d’endettement de ${indicateursPouls.ratioEndettement} % des avoirs totaux. Ciblez en priorité les dettes au taux d’intérêt le plus élevé.`,
                statutLabel:
                    totalDettes <= 0
                        ? '0 % d’endettement'
                        : `Levier ${indicateursPouls.ratioEndettement} %`,
                statutClasse:
                    indicateursPouls.ratioEndettement <= 25
                        ? 'gf-delta-up'
                        : indicateursPouls.ratioEndettement <= 45
                          ? 'gf-delta-amber'
                          : 'gf-delta-down',
                montantPrincipal: totalDettes,
                cibleMontant: dettesHorsHypo > 0 ? dettesHorsHypo : null,
                progressionPct: ratioSolvabilite,
                classeBarre: 'gf-alloc-reer',
                ctaLabel: 'Plan de désendettement',
                tab: Tab.DEBT,
            },
            {
                id: 'prio-retraite-fire',
                rang: 'Priorité 4 · Cap Retraite & Indépendance financière',
                titre: jalonFire
                    ? `Trajectoire d’indépendance financière projetée en ${jalonFire.year}`
                    // NOMBRE-NON-MONETAIRE : âge cible de retraite saisi en réglage
                    : `Cap retraite cible à ${indicateursPouls.ageRetraite} ans`,
                description:
                    pointRetraite && Number.isFinite(pointRetraite.NetWorth)
                        // NOMBRE-NON-MONETAIRE : âge du profil au jalon de retraite
                        ? `Selon la simulation actuelle, votre patrimoine net atteindra son jalon de retraite à ${pointRetraite.age} ans avec les rentes RRQ et PSV.`
                        : 'Simulez vos scénarios Monte-Carlo et vos rentes gouvernementales (RRQ / PSV) pour sécuriser votre décaissement.',
                statutLabel: `${pctFire} % de la cible FIRE`,
                statutClasse: pctFire >= 50 ? 'gf-delta-up' : 'gf-delta-amber',
                montantPrincipal:
                    pointRetraite && Number.isFinite(pointRetraite.NetWorth)
                        ? pointRetraite.NetWorth
                        : patrimoineNet,
                cibleMontant: cibleFire,
                progressionPct: Math.max(6, pctFire),
                classeBarre: 'gf-alloc-immo',
                ctaLabel: 'Explorer la trajectoire',
                tab: Tab.FUTURE,
            },
        ];
    }, [
        indicateursPouls,
        liquidites,
        assetBreakdown,
        portefeuillePlacements,
        dettesHorsImmo,
        fireNumber,
        patrimoineNet,
        epargneMensuelle,
        totalDettes,
        jalonFire,
        pointRetraite,
    ]);

    const prochainsJalons = useMemo<JalonPatrimonial[]>(() => {
        const anneeCourante = Number(todayIso.slice(0, 4)) || 2026;
        const jalons: JalonPatrimonial[] = [];

        for (const immo of state.realEstateGoals ?? []) {
            const anneeAchat = Number((immo.purchaseDate ?? '').slice(0, 4)) || anneeCourante;
            jalons.push({
                id: `immo-${immo.id}`,
                titre: immo.name || 'Bien immobilier',
                categorie: anneeAchat > anneeCourante ? 'Acquisition prévue' : 'Actif immobilier',
                annee: anneeAchat,
                montant: Number(immo.currentValue ?? immo.price) || 0,
                tab: anneeAchat > anneeCourante ? Tab.REAL_ESTATE_PROJECTS : Tab.REAL_ESTATE,
            });
        }

        for (const voyage of state.travelGoals ?? []) {
            jalons.push({
                id: `voyage-${voyage.id}`,
                titre: voyage.destination || 'Projet voyage',
                categorie: 'Projet de vie',
                annee: Number((voyage.date ?? '').slice(0, 4)) || anneeCourante + 1,
                montant: Number(voyage.totalCost) || 0,
                tab: Tab.LIFE_PROJECTS,
            });
        }

        for (const evt of state.lifeEvents ?? []) {
            jalons.push({
                id: `evt-${evt.id}`,
                titre: evt.name || 'Événement de vie',
                categorie: 'Jalon planifié',
                annee: Number((evt.date ?? '').slice(0, 4)) || anneeCourante + 2,
                montant: Math.abs(Number(evt.impactAmount) || 0),
                tab: Tab.LIFE_PROJECTS,
            });
        }

        const ageActuel = state.config?.users?.[0]?.age ?? 35;
        const ageRetraite = state.retirementGoal?.targetAge ?? 60;
        const anneeRetraite = anneeCourante + Math.max(1, ageRetraite - ageActuel);
        jalons.push({
            id: 'jalon-retraite',
            // NOMBRE-NON-MONETAIRE : âge cible de retraite saisi en réglage
            titre: `Retraite cible (${ageRetraite} ans)`,
            categorie: 'Indépendance financière',
            annee: anneeRetraite,
            montant: (state.retirementGoal?.targetMonthlyIncome ?? 4000) * 12,
            tab: Tab.RETIREMENT,
        });

        return jalons.sort((a, b) => a.annee - b.annee).slice(0, 5);
    }, [todayIso, state.realEstateGoals, state.travelGoals, state.lifeEvents, state.config?.users, state.retirementGoal]);

    const colonnesTrajectoire = useMemo<ChartDataColumn[]>(
        () => [
            { key: 'annee', label: 'Période' },
            {
                key: 'valeur',
                label: 'Valeur nette',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v))),
            },
        ],
        [isPrivacyMode],
    );

    const colonnesRepartition = useMemo<ChartDataColumn[]>(
        () => [
            { key: 'label', label: 'Classe d’actifs' },
            {
                key: 'valeur',
                label: 'Montant',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v))),
            },
            {
                key: 'pct',
                label: 'Part (%)',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : `${Number(v) || 0} %`),
            },
        ],
        [isPrivacyMode],
    );

    const anneeActuelle = Number(todayIso.slice(0, 4)) || 2026;

    const ouvrirQuestionGemini = (q: string) => {
        setRequete(q);
        setShowGeminiModal(true);
    };

    const basculerHorizonSuivant = () => {
        const idx = HORIZONS.findIndex((h) => h.cle === horizon);
        const suivant = HORIZONS[(idx + 1) % HORIZONS.length] ?? HORIZONS[0]!;
        setHorizon(suivant.cle);
    };

    return (
        <div
            data-testid="accueil-google-view"
            className="max-w-[1440px] mx-auto pb-14 leading-relaxed"
        >
            {/* ══════════════════════════════════════════════════════════════════════════
                SURFACE UNIFIÉE GOOGLE FINANCE — HÉRO PLEIN CADRE + 2 COLONNES AÉRÉES
               ══════════════════════════════════════════════════════════════════════════ */}
            <section
                aria-label="Synthèse patrimoniale et recherche rapide"
                className="premium-card rounded-2xl bg-surface border border-bordure divide-y divide-bordure overflow-hidden"
            >
                {/* 1. BARRE SUPÉRIEURE ÉPURÉE : STATUT CLOUD + OMNIBOX + COMPTES & SYNC */}
                <div className="px-5 sm:px-8 py-4 bg-surface flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center justify-between lg:justify-start gap-3 shrink-0">
                        <span
                            className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-fond border border-bordure text-xs font-mono text-ink-200"
                            title="Synchronisation automatique en temps réel entre PC et mobile"
                        >
                            <span className="w-2.5 h-2.5 rounded-full gf-alloc-reer gf-pulse-live" aria-hidden="true" />
                            <span>{syncStatus.state === 'syncing' ? 'Sync Cloud…' : 'Direct · PC & Mobile'}</span>
                        </span>
                    </div>

                    <div className="relative flex-1 max-w-xl mx-auto w-full">
                        <div className="gf-omnibox-pill relative flex items-center px-4 py-0.5">
                            <Icon
                                name="search"
                                size={17}
                                className="text-ink-300 pointer-events-none shrink-0"
                                aria-hidden="true"
                            />
                            <input
                                type="search"
                                value={requete}
                                onFocus={() => setRechercheOuverte(true)}
                                onBlur={() => {
                                    setTimeout(() => setRechercheOuverte(false), 160);
                                }}
                                onChange={(e) => {
                                    setRequete(e.target.value);
                                    setRechercheOuverte(true);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setRechercheOuverte(false);
                                    } else if (e.key === 'Enter' && resultatsOmnibox.pages[0]) {
                                        setActiveTab(resultatsOmnibox.pages[0].tab);
                                        setRechercheOuverte(false);
                                        setRequete('');
                                    }
                                }}
                                placeholder="Rechercher un compte, un titre ou une opération…"
                                aria-label="Rechercher dans votre patrimoine"
                                className="champ-nu touch-target w-full pl-3 pr-3 bg-transparent text-sm text-ink-50 placeholder-ink-400 focus-ring"
                            />
                        </div>

                        {rechercheOuverte && (
                            <div
                                role="listbox"
                                aria-label="Suggestions rapides"
                                className="absolute left-0 right-0 top-full mt-2.5 rounded-xl bg-surface border border-bordure-champ divide-y divide-bordure z-40 text-left shadow-xl overflow-hidden"
                            >
                                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-bordure">
                                    {resultatsOmnibox.pages.map((p) => (
                                        <button
                                            key={p.tab}
                                            type="button"
                                            onClick={() => {
                                                setActiveTab(p.tab);
                                                setRechercheOuverte(false);
                                                setRequete('');
                                            }}
                                            className="touch-target px-4 py-3 flex items-center gap-2.5 text-sm text-ink-100 hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                        >
                                            <Icon name={p.icon} size={15} className="text-ink-400 shrink-0" aria-hidden="true" />
                                            <span className="truncate font-medium">{p.label}</span>
                                        </button>
                                    ))}
                                </div>
                                {resultatsOmnibox.titres.length > 0 && (
                                    <div className="divide-y divide-bordure">
                                        {resultatsOmnibox.titres.map((asset, idx) => (
                                            <button
                                                key={`${asset.symbol}-${idx}`}
                                                type="button"
                                                onClick={() => {
                                                    setActiveTab(Tab.INVESTMENTS);
                                                    setRechercheOuverte(false);
                                                    setRequete('');
                                                }}
                                                className="touch-target w-full px-4 py-3 flex items-center justify-between gap-3 text-sm hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                            >
                                                <span className="font-mono font-semibold text-ink-50">
                                                    {asset.symbol || asset.name}
                                                </span>
                                                <PrivateAmount className="font-mono tabular-nums text-ink-200">
                                                    {formatCAD(assetValueCad(asset, state.fxRates))}
                                                </PrivateAmount>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {resultatsOmnibox.operations.length > 0 && (
                                    <div className="divide-y divide-bordure">
                                        {resultatsOmnibox.operations.map((tx) => (
                                            <button
                                                key={tx.id}
                                                type="button"
                                                onClick={() => {
                                                    setActiveTab(Tab.TRANSACTIONS);
                                                    setRechercheOuverte(false);
                                                    setRequete('');
                                                }}
                                                className="touch-target w-full px-4 py-3 flex items-center justify-between gap-3 text-sm hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                            >
                                                <PrivateText quoi="marchand" className="truncate text-ink-100">{tx.payee}</PrivateText>
                                                <PrivateAmount className="font-mono font-semibold tabular-nums text-ink-200 shrink-0">
                                                    {formatCAD(tx.amount)}
                                                </PrivateAmount>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => {
                                setShowConnexionsModal(true);
                            }}
                            aria-label="Importer ou synchroniser des comptes"
                            className="touch-target px-4 py-2 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs sm:text-sm font-medium text-ink-100 inline-flex items-center gap-2 transition-colors duration-100 focus-ring whitespace-nowrap"
                        >
                            <Icon name="cloud" size={15} className="text-ink-300" aria-hidden="true" />
                            <span>Comptes & Sync</span>
                        </button>
                    </div>
                </div>

                {/* 2. HÉRO PATRIMONIAL PLEIN CADRE + 4 LENTILLES + GRANDE COURBE RECHARTS */}
                <div
                    aria-label="Trajectoire du patrimoine"
                    className="p-6 sm:p-8 space-y-6 bg-surface"
                >
                    <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
                        {/* Gauche : Titre, Montant Héro animé et Variation */}
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center gap-2.5 text-sm text-ink-300">
                                <span className="sr-only">Trajectoire</span>
                                <span className="gf-ticker-symbol">{lentilleCourante.ticker}</span>
                                <span aria-hidden="true" className="text-ink-400">·</span>
                                <h1 className="font-semibold text-ink-100 tracking-normal text-base sm:text-lg">
                                    {prenom ? `${prenom} · ${lentilleCourante.label}` : lentilleCourante.label}
                                </h1>
                                <FxEstimateBadge />
                            </div>

                            <div className="flex flex-wrap items-baseline gap-3.5">
                                <AnimatedNetWorth
                                    value={valeurHeroAffichee}
                                    as="div"
                                    testId="animated-global-net-worth"
                                    className="font-mono tabular-nums text-4xl sm:text-5xl font-bold tracking-normal text-ink-50 leading-none"
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
                            className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 w-full xl:w-auto xl:min-w-[600px]"
                        >
                            {(
                                [
                                    {
                                        cle: 'net' as const,
                                        label: 'Patrimoine net',
                                        ticker: 'BILAN:CAD',
                                        val: patrimoineNet,
                                        dotClass: 'gf-alloc-reer',
                                    },
                                    {
                                        cle: 'portefeuille' as const,
                                        label: 'Portefeuille',
                                        ticker: 'PORT:CAD',
                                        val: portefeuillePlacements,
                                        dotClass: 'gf-alloc-celi',
                                    },
                                    {
                                        cle: 'liquidites' as const,
                                        label: 'Liquidités',
                                        ticker: 'CASH:CAD',
                                        val: liquidites,
                                        dotClass: 'gf-alloc-cash',
                                    },
                                    {
                                        cle: 'immobilier' as const,
                                        label: 'Immobilier',
                                        ticker: 'IMMO:CAD',
                                        val: realEstateEquity,
                                        dotClass: 'gf-alloc-immo',
                                    },
                                ] as const
                            ).map((l) => {
                                const actif = lentilleHero === l.cle;
                                return (
                                    <button
                                        key={l.cle}
                                        type="button"
                                        aria-pressed={actif}
                                        onClick={() => setLentilleHero(l.cle)}
                                        className={`touch-target rounded-xl px-4 py-3 text-left border transition-all duration-150 flex flex-col justify-between gap-1.5 focus-ring ${
                                            actif
                                                ? 'bg-surface-douce border-bordure-champ'
                                                : 'bg-fond border-bordure hover:bg-surface-douce hover:border-bordure-champ'
                                        }`}
                                    >
                                        <div className="flex items-center gap-2 text-xs text-ink-300">
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
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-bordure">
                        <div className="flex flex-wrap items-center gap-2">
                            <div
                                role="group"
                                aria-label="Horizon de la courbe"
                                className="inline-flex items-center p-1 rounded-full border border-bordure bg-fond gap-1"
                            >
                                {HORIZONS.map((h) => (
                                    <button
                                        key={h.cle}
                                        type="button"
                                        aria-pressed={horizon === h.cle}
                                        onClick={() => setHorizon(h.cle)}
                                        className={`touch-target px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-mono font-semibold tabular-nums transition-colors duration-100 focus-ring ${
                                            horizon === h.cle
                                                ? 'gf-subtab-pill-active'
                                                : 'text-ink-300 hover:text-ink-50'
                                        }`}
                                    >
                                        {h.label}
                                    </button>
                                ))}
                            </div>

                            <div
                                role="group"
                                aria-label="Série affichée sur la courbe"
                                className="inline-flex items-center p-1 rounded-full border border-bordure bg-fond gap-1"
                            >
                                <button
                                    type="button"
                                    aria-pressed={modeCourbe === 'nette'}
                                    onClick={() => setModeCourbe('nette')}
                                    className={`touch-target px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors duration-100 focus-ring whitespace-nowrap ${
                                        modeCourbe === 'nette'
                                            ? 'gf-subtab-pill-active'
                                            : 'text-ink-300 hover:text-ink-50'
                                    }`}
                                >
                                    Valeur nette
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={modeCourbe === 'complete'}
                                    onClick={() => setModeCourbe('complete')}
                                    className={`touch-target px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium transition-colors duration-100 focus-ring whitespace-nowrap ${
                                        modeCourbe === 'complete'
                                            ? 'gf-subtab-pill-active'
                                            : 'text-ink-300 hover:text-ink-50'
                                    }`}
                                >
                                    Par compte · + Avoirs
                                </button>
                            </div>

                            <button
                                type="button"
                                aria-pressed={tempsFortsActifs}
                                onClick={() => setTempsFortsActifs((v) => !v)}
                                className={`touch-target px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium inline-flex items-center gap-2 border transition-all duration-150 focus-ring ${
                                    tempsFortsActifs
                                        ? 'gf-delta-amber'
                                        : 'bg-fond text-ink-300 border-bordure hover:text-ink-50'
                                }`}
                            >
                                <span className="gf-amber-dot shrink-0" aria-hidden="true" />
                                <span>Temps forts</span>
                            </button>
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={basculerHorizonSuivant}
                                aria-label="Choisir la durée Présent et Futur de la courbe"
                                className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-mono text-ink-300 hover:text-ink-50 inline-flex items-center gap-2 transition-colors duration-100 focus-ring"
                            >
                                <Icon name="refresh" size={13} aria-hidden="true" />
                                <span>{isDailyCurve ? 'Pas quotidien (1 j)' : 'Pas mensuel (1 m)'}</span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.FUTURE)}
                                onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                                className="touch-target px-4 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs sm:text-sm font-medium text-ink-100 inline-flex items-center gap-1.5 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Simulateur</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>
                    </div>

                    {/* Lecture directe de la fenêtre ou du point survolé / épinglé */}
                    {(pointInspecte || resumeFenetre) && (
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-fond border border-bordure text-xs font-mono tabular-nums">
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

                    {/* Courbe principale plein cadre */}
                    <div
                        data-testid="recharts-trajectory-entrance"
                        data-active-tab={activeTab}
                        data-chart-horizon={horizon}
                        data-chart-mode={modeCourbe}
                        data-chart-lens={lentilleHero}
                        role="img"
                        aria-label="Graphique combiné du présent et du futur projeté — valeurs détaillées dans le tableau de données."
                        className="h-[340px] sm:h-[400px] w-full gf-chart-enter py-2 cursor-crosshair"
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart
                                data={donneesTrajectoire}
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
                                        <stop offset="0%" stopColor="var(--gf-bleu)" stopOpacity={0.16} />
                                        <stop offset="100%" stopColor="var(--gf-bleu)" stopOpacity={0.03} />
                                    </linearGradient>
                                    {(
                                        [
                                            'Liquidites',
                                            'CELI',
                                            'CELIAPP',
                                            'REER',
                                            'REEE',
                                            'NonReg',
                                            'Crypto',
                                            'Immobilier',
                                            'Entreprise',
                                        ] as const
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
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="var(--bordure)"
                                    strokeOpacity={0.55}
                                />
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

                                {pastPrefixPoints.length > 0 && pastStartIndex < xAuj && (
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
                                            [
                                                'Liquidites',
                                                'CELI',
                                                'CELIAPP',
                                                'REER',
                                                'REEE',
                                                'NonReg',
                                                'Crypto',
                                                'Immobilier',
                                                'Entreprise',
                                            ] as const
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
                                        <Line
                                            type="monotone"
                                            dataKey={detteLevierSousZero}
                                            name={LIBELLE_LEVIER}
                                            stroke={COULEUR_LEVIER}
                                            strokeWidth={1.5}
                                            strokeDasharray="4 3"
                                            dot={false}
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="ImpotLatent"
                                            name="Impôt latent"
                                            stroke={couleurSerie('ImpotLatent')}
                                            strokeWidth={1.5}
                                            strokeDasharray="5 5"
                                            dot={false}
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="avoirs"
                                            name="Avoirs bruts"
                                            stroke="var(--gf-ambre)"
                                            strokeWidth={1.75}
                                            strokeDasharray="4 4"
                                            dot={false}
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="NetWorth"
                                            name="Valeur nette"
                                            stroke={couleurSerie('NetWorth')}
                                            strokeWidth={2.5}
                                            dot={false}
                                            activeDot={GF_ACTIVE_DOT}
                                            isAnimationActive={false}
                                        />
                                    </>
                                ) : (
                                    <>
                                        {modeCourbe === 'complete' && (
                                            <Line
                                                type="monotone"
                                                dataKey="avoirs"
                                                name="Avoirs bruts"
                                                stroke="var(--gf-ambre)"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                                dot={false}
                                                isAnimationActive={false}
                                            />
                                        )}
                                        {lentilleHero === 'net' && runMC && (
                                            <>
                                                <Area
                                                    type="monotone"
                                                    dataKey="P90"
                                                    baseValue={echelleYTrajectoire.domaine[0]}
                                                    stroke="var(--gf-bleu)"
                                                    strokeWidth={1}
                                                    strokeDasharray="3 3"
                                                    strokeOpacity={0.5}
                                                    fill="url(#accueilMcGrad)"
                                                    isAnimationActive={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="P50"
                                                    stroke="var(--gf-bleu)"
                                                    strokeWidth={1.5}
                                                    strokeDasharray="4 3"
                                                    strokeOpacity={0.75}
                                                    dot={false}
                                                    isAnimationActive={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="P10"
                                                    stroke="var(--gf-rouge)"
                                                    strokeWidth={1.25}
                                                    strokeDasharray="3 3"
                                                    strokeOpacity={0.65}
                                                    dot={false}
                                                    isAnimationActive={false}
                                                />
                                            </>
                                        )}
                                        {modeCourbe === 'complete' && lentilleHero === 'net' && (
                                            <Area
                                                type="monotone"
                                                dataKey={detteSousZero}
                                                name="Dettes (hors hypothèque)"
                                                stroke={COULEUR_DETTE}
                                                strokeWidth={1.25}
                                                fill="url(#accGradDettes)"
                                                fillOpacity={0.85}
                                                baseValue={0}
                                                isAnimationActive={false}
                                            />
                                        )}
                                        <Area
                                            type="monotone"
                                            dataKey="valeurPresent"
                                            baseValue={echelleYTrajectoire.domaine[0]}
                                            stroke="none"
                                            fill="url(#accueilPresentGrad)"
                                            fillOpacity={1}
                                            connectNulls={false}
                                            isAnimationActive={false}
                                        />
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
                                                return (
                                                    <circle
                                                        cx={props.cx}
                                                        cy={props.cy}
                                                        r={5}
                                                        fill="var(--gf-bleu)"
                                                        stroke="var(--fond)"
                                                        strokeWidth={2}
                                                    />
                                                );
                                            }}
                                            isAnimationActive={false}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="valeurFutur"
                                            baseValue={echelleYTrajectoire.domaine[0]}
                                            stroke="none"
                                            fill="url(#accueilFuturGrad)"
                                            fillOpacity={1}
                                            connectNulls={false}
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="valeurFutur"
                                            stroke="var(--gf-vert)"
                                            strokeWidth={2.6}
                                            strokeDasharray={isDailyCurve ? undefined : '5 4'}
                                            connectNulls={false}
                                            dot={false}
                                            activeDot={(props: {
                                                cx?: number;
                                                cy?: number;
                                                value?: number | null;
                                                payload?: PointTrajectoire;
                                            }) => {
                                                if (
                                                    props.value === null ||
                                                    props.value === undefined ||
                                                    !Number.isFinite(props.value) ||
                                                    typeof props.cx !== 'number' ||
                                                    typeof props.cy !== 'number'
                                                )
                                                    return null;
                                                if (props.payload?.periode === 'transition') return null;
                                                return (
                                                    <circle
                                                        cx={props.cx}
                                                        cy={props.cy}
                                                        r={5}
                                                        fill="var(--gf-vert)"
                                                        stroke="var(--fond)"
                                                        strokeWidth={2}
                                                    />
                                                );
                                            }}
                                            isAnimationActive={false}
                                        />
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
                </div>

                {/* 3. BANDEAU DES 4 GRANDS REPÈRES DE TRAJECTOIRE */}
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-bordure bg-fond">
                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.INVESTMENTS)}
                        onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                        className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink-300">Aujourd’hui</span>
                            <span className="w-2 h-2 rounded-full gf-alloc-celi shrink-0" aria-hidden="true" />
                        </div>
                        <div className="font-mono text-base sm:text-lg font-bold text-ink-50 tabular-nums">
                            <PrivateAmount>
                                {formatCompactCAD(patrimoineNet)}
                            </PrivateAmount>
                        </div>
                        <div className="text-xs text-ink-400">Bilan net actuel</div>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.FUTURE)}
                        onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                        className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink-300">
                                {jalonFire ? `Jalon FIRE (${jalonFire.year})` : 'Cible FIRE'}
                            </span>
                            <span className="w-2 h-2 rounded-full gf-alloc-immo shrink-0" aria-hidden="true" />
                        </div>
                        <div className="font-mono text-base sm:text-lg font-bold text-alerte-texte tabular-nums">
                            <PrivateAmount>
                                {jalonFire && Number.isFinite(jalonFire.NetWorth)
                                    ? formatCompactCAD(jalonFire.NetWorth)
                                    : Number.isFinite(fireNumber) && fireNumber > 0
                                      ? formatCompactCAD(fireNumber)
                                      : '—'}
                            </PrivateAmount>
                        </div>
                        <div className="text-xs text-ink-400">
                            <PrivateAmount>{`${indicateursPouls.pctLiberte} % accompli`}</PrivateAmount>
                        </div>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.RETIREMENT)}
                        onMouseEnter={() => prefetchTab(Tab.RETIREMENT)}
                        className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink-300">
                                {/* NOMBRE-NON-MONETAIRE : âge de la retraite sur la carte jalon */}
                                {pointRetraite ? `Retraite (${pointRetraite.age} ans)` : `Retraite (${indicateursPouls.ageRetraite} ans)`}
                            </span>
                            <span className="w-2 h-2 rounded-full gf-alloc-reer shrink-0" aria-hidden="true" />
                        </div>
                        <div className="font-mono text-base sm:text-lg font-bold text-ink-50 tabular-nums">
                            {lastProjection && pointRetraite && Number.isFinite(pointRetraite.NetWorth) ? (
                                <PrivateAmount>{formatCompactCAD(pointRetraite.NetWorth)}</PrivateAmount>
                            ) : (
                                <>
                                    <span aria-hidden="true">—</span>
                                    <span className="sr-only">
                                        {projectionStatus === 'computing' ? 'Calcul en cours' : 'Simulation requise'}
                                    </span>
                                </>
                            )}
                        </div>
                        <div className="text-xs text-ink-400">Patrimoine projeté</div>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.FUTURE)}
                        onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                        className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink-300">
                                {/* NOMBRE-NON-MONETAIRE : âge de fin d'horizon sur la carte jalon */}
                                {dernierPoint ? `Fin d’horizon (${dernierPoint.age} ans)` : 'Fin d’horizon'}
                            </span>
                            <span className="w-2 h-2 rounded-full gf-alloc-nonreg shrink-0" aria-hidden="true" />
                        </div>
                        <div className="font-mono text-base sm:text-lg font-bold text-ink-50 tabular-nums">
                            {patrimoineKpi?.value ? (
                                <PrivateAmount>{patrimoineKpi.value}</PrivateAmount>
                            ) : lastProjection && dernierPoint && Number.isFinite(dernierPoint.NetWorth) ? (
                                <PrivateAmount>{formatCompactCAD(dernierPoint.NetWorth)}</PrivateAmount>
                            ) : (
                                <>
                                    <span aria-hidden="true">—</span>
                                    <span className="sr-only">
                                        {projectionStatus === 'computing' ? 'Calcul en cours' : 'Simulation requise'}
                                    </span>
                                </>
                            )}
                        </div>
                        <div className="text-xs text-ink-400">Capital final simulé</div>
                    </button>
                </div>

                {/* 4. DEUX COLONNES AÉRÉES SOUS LA COURBE (COMME GOOGLE FINANCE) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-bordure bg-surface">
                    {/* ── COLONNE GAUCHE (7 COL) : LISTE SUIVIE & ALLOCATION D'ACTIFS ── */}
                    <div className="lg:col-span-7 divide-y divide-bordure">
                        {/* Liste suivie des positions */}
                        <section
                            aria-label="Listes et portefeuilles suivis"
                            className="divide-y divide-bordure"
                        >
                            <div className="px-6 py-4 flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                    <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                                        Portefeuilles & Liste suivie
                                    </h2>
                                    <span className="text-xs font-mono text-ink-400">
                                        {/* NOMBRE-NON-MONETAIRE : nombre de lignes suivies */}
                                        ({positionsSuivies.length})
                                    </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => navigateWithFocus(Tab.INVESTMENTS, 'tab:portfolio')}
                                        onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                        className="touch-target min-h-11 px-3.5 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-medium text-texte inline-flex items-center gap-1.5 focus-ring"
                                    >
                                        <Icon name="sparkles" size={14} aria-hidden="true" />
                                        <span>Conseiller 7 Agents</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(Tab.INVESTMENTS)}
                                        onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                        className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                                    >
                                        <span>Placements</span>
                                        <Icon name="chevron-right" size={14} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>

                            <div className="divide-y divide-bordure">
                                {positionsSuivies.slice(0, 8).map((pos) => {
                                    const sig = valoriaSignals[pos.symbole.toUpperCase()];
                                    const isHeldAsset = pos.id.startsWith('asset-');
                                    return (
                                        <div
                                            key={`left-${pos.id}`}
                                            className="gf-row px-4 sm:px-6 py-3 flex items-center justify-between gap-2.5 sm:gap-3 min-w-0"
                                        >
                                            <button
                                                type="button"
                                                onClick={() => setActiveTab(pos.tab)}
                                                onMouseEnter={() => prefetchTab(pos.tab)}
                                                className="touch-target min-h-11 min-w-0 flex-1 flex items-center justify-between gap-2.5 sm:gap-4 text-left focus-ring rounded-lg py-0.5"
                                            >
                                                <div className="min-w-0 flex-1 space-y-0.5">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <span className="font-mono text-sm font-bold text-ink-50 shrink-0">
                                                            {pos.symbole}
                                                        </span>
                                                        <span className="text-xs text-ink-400 font-mono truncate">
                                                            {pos.compte}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs text-ink-400 min-w-0">
                                                        <PrivateAmount as="div" className="truncate">{pos.nom}</PrivateAmount>
                                                    </div>
                                                </div>

                                                <svg
                                                    width="56"
                                                    height="22"
                                                    viewBox="0 0 48 22"
                                                    aria-hidden="true"
                                                    className="shrink-0 overflow-visible hidden sm:block"
                                                >
                                                    <polyline
                                                        fill="none"
                                                        stroke={pos.variationPct == null ? 'var(--gf-bleu)' : pos.positif ? 'var(--gf-vert)' : 'var(--gf-rouge)'}
                                                        strokeWidth="1.8"
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        points={pos.pointsSparkline}
                                                    />
                                                </svg>

                                                <div className="text-right font-mono tabular-nums shrink-0 space-y-0.5">
                                                    <div className="text-sm font-bold text-ink-50">
                                                        <PrivateAmount>{formatCompactCAD(pos.valeur)}</PrivateAmount>
                                                    </div>
                                                    <span
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                            pos.variationPct == null
                                                                ? 'gf-delta-neutral'
                                                                : pos.positif
                                                                  ? 'gf-delta-up'
                                                                  : 'gf-delta-down'
                                                        }`}
                                                    >
                                                        {pos.variationPct != null ? (
                                                            <PrivateAmount>
                                                                {`${pos.positif ? '+' : ''}${formatPercent(pos.variationPct)}`}
                                                            </PrivateAmount>
                                                        ) : (
                                                            <span>{`${pos.poidsPct} %`}</span>
                                                        )}
                                                    </span>
                                                </div>
                                            </button>

                                            {isHeldAsset && sig && (
                                                <button
                                                    type="button"
                                                    onClick={() => navigateWithFocus(Tab.INVESTMENTS, `asset:${pos.symbole}`)}
                                                    onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                                    className={`touch-target min-h-11 px-2.5 py-1 rounded-full text-xs font-mono font-semibold shrink-0 whitespace-nowrap focus-ring ${classePastilleValoria(sig.signal)}`}
                                                >
                                                    {/* NOMBRE-NON-MONETAIRE : score quantitatif public Valoria */}
                                                    <span>{sig.labelCourt} · {sig.score100}</span>
                                                    <span className="sr-only"> — Rayon-X Valoria de {pos.symbole}</span>
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}

                                {/* Liste suivie Valoria synchronisée */}
                                {(() => {
                                    const heldRoots = new Set(
                                        positionsSuivies
                                            .filter((p) => p.id.startsWith('asset-'))
                                            .map((p) => p.symbole.toUpperCase().split('.')[0])
                                    );
                                    const watchlistOnly = (state.valoriaWatchlist ?? []).filter(
                                        (sym) => !heldRoots.has(sym.trim().toUpperCase().split('.')[0])
                                    );
                                    if (watchlistOnly.length === 0) return null;
                                    return (
                                        <div className="px-6 py-3.5 bg-fond/40 space-y-2">
                                            <div className="flex items-center justify-between gap-2 text-xs text-ink-400">
                                                <span className="font-semibold text-ink-200">
                                                    Liste suivie Valoria ({watchlistOnly.length})
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => navigateWithFocus(Tab.INVESTMENTS, 'tab:market')}
                                                    className="touch-target min-h-11 px-2 text-xs font-medium text-ink-200 hover:text-ink-50 underline underline-offset-2 focus-ring rounded-md"
                                                >
                                                    Explorer les marchés
                                                </button>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {watchlistOnly.slice(0, 6).map((sym) => {
                                                    const sig = valoriaSignals[sym.trim().toUpperCase()];
                                                    return (
                                                        <button
                                                            key={`watch-${sym}`}
                                                            type="button"
                                                            onClick={() => navigateWithFocus(Tab.INVESTMENTS, `asset:${sym}`)}
                                                            onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                                            className="touch-target min-h-11 px-3 py-1.5 rounded-full border border-bordure bg-surface hover:bg-surface-douce text-xs font-mono text-ink-100 inline-flex items-center gap-2 focus-ring"
                                                        >
                                                            <span className="font-bold">{sym}</span>
                                                            {sig && (
                                                                <>
                                                                    <span className="text-ink-400">
                                                                        {/* MONTANT-PUBLIC : cours public de marché */}
                                                                        {formatCAD(sig.spotPriceCad)}
                                                                    </span>
                                                                    <span
                                                                        className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${classePastilleValoria(sig.signal)}`}
                                                                    >
                                                                        {/* NOMBRE-NON-MONETAIRE : score quantitatif public Valoria */}
                                                                        {sig.score100}
                                                                    </span>
                                                                </>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </section>

                        {/* Allocation d'actifs compacte */}
                        <section
                            aria-label="Répartition visuelle des actifs"
                            className="divide-y divide-bordure"
                        >
                            <div className="px-6 py-4 flex items-center justify-between gap-3">
                                <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                                    Allocation d’actifs
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(partSelectionnee.tab)}
                                    onMouseEnter={() => prefetchTab(partSelectionnee.tab)}
                                    className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                                >
                                    <span>Détails</span>
                                    <Icon name="chevron-right" size={14} aria-hidden="true" />
                                </button>
                            </div>

                            <div className="p-6 grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
                                <div className="sm:col-span-5 relative h-[150px] w-full flex items-center justify-center">
                                    <div
                                        key={`${activeTab}-repartition-${lentilleHero}`}
                                        data-testid="recharts-allocation-entrance"
                                        data-active-tab={activeTab}
                                        data-chart-lens={lentilleHero}
                                        role="img"
                                        aria-label="Anneau de répartition des avoirs par classe d'actifs — détail chiffré dans le tableau de données."
                                        className="h-full w-full gf-chart-enter"
                                    >
                                        <ResponsiveContainer width="100%" height="100%">
                                            <PieChart>
                                                <Pie
                                                    data={partsRepartition}
                                                    dataKey="valeur"
                                                    nameKey="label"
                                                    cx="50%"
                                                    cy="50%"
                                                    innerRadius={44}
                                                    outerRadius={64}
                                                    paddingAngle={2}
                                                    stroke="none"
                                                    isAnimationActive={true}
                                                    animationBegin={30}
                                                    animationDuration={360}
                                                    animationEasing="ease-out"
                                                    onMouseEnter={(_, idx) => {
                                                        const item = partsRepartition[idx];
                                                        if (item) setSegmentActif(item.id);
                                                    }}
                                                >
                                                    {partsRepartition.map((entry) => (
                                                        <Cell
                                                            key={entry.id}
                                                            fill={entry.couleur}
                                                            opacity={
                                                                segmentActif === null || segmentActif === entry.id ? 1 : 0.35
                                                            }
                                                        />
                                                    ))}
                                                </Pie>
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 space-y-0.5">
                                        <span className="text-xs font-medium text-ink-300 truncate max-w-[90px]">
                                            {partSelectionnee.label}
                                        </span>
                                        <PrivateAmount className="font-mono text-sm font-bold text-ink-50 tabular-nums">
                                            {formatCompactCAD(partSelectionnee.valeur)}
                                        </PrivateAmount>
                                    </div>
                                </div>

                                <div
                                    role="group"
                                    aria-label="Sélection d'une enveloppe d'actifs"
                                    className="sm:col-span-7 space-y-1.5"
                                >
                                    {partsRepartition.map((part) => (
                                        <button
                                            key={part.id}
                                            type="button"
                                            aria-pressed={partSelectionnee.id === part.id}
                                            onMouseEnter={() => setSegmentActif(part.id)}
                                            onFocus={() => setSegmentActif(part.id)}
                                            onClick={() => setSegmentActif(part.id)}
                                            className={`touch-target w-full px-3.5 py-2 rounded-lg flex items-center justify-between gap-3 text-sm transition-colors duration-100 focus-ring ${
                                                partSelectionnee.id === part.id
                                                    ? 'bg-surface-douce text-ink-50 font-semibold'
                                                    : 'text-ink-200 hover:bg-surface-douce'
                                            }`}
                                        >
                                            <span className="flex items-center gap-2.5 min-w-0 truncate">
                                                <span
                                                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${part.classeBarre}`}
                                                    aria-hidden="true"
                                                />
                                                <span className="truncate">{part.label}</span>
                                            </span>
                                            <span className="font-mono text-sm text-ink-100 tabular-nums shrink-0">
                                                <PrivateAmount>{formatCompactCAD(part.valeur)}</PrivateAmount>
                                                <span className="text-ink-400 ml-2">
                                                    <PrivateAmount>{`${part.pct}%`}</PrivateAmount>
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </div>

                    {/* ── COLONNE DROITE (5 COL) : PLAN D'ACTION ÉPURÉ, ACTIVITÉ & CALENDRIER ── */}
                    <div className="lg:col-span-5 divide-y divide-bordure">
                        {/* Plan d'action patrimonial épuré avec bouton direct vers Gemini */}
                        <section
                            data-testid="plan-action-ameliore"
                            aria-label="Plan d'action patrimonial"
                            className="divide-y divide-bordure"
                        >
                            <div className="px-6 py-4 flex items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                                        Plan d’action patrimonial
                                    </h2>
                                    <span className="sr-only">Actions prioritaires recommandées</span>
                                    <span className="sr-only">Cadence d’exécution programmée</span>
                                    <span
                                        className={`px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${
                                            epargneMensuelle > 0 ? 'gf-delta-up' : 'gf-delta-neutral'
                                        }`}
                                    >
                                        <PrivateAmount>
                                            {`${epargneMensuelle >= 0 ? '+' : ''}${formatCompactCAD(epargneMensuelle)}/mois`}
                                        </PrivateAmount>
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() =>
                                        ouvrirQuestionGemini(
                                            'Quelles sont les 3 meilleures actions concrètes à exécuter ce mois-ci sur mon portefeuille et mon budget ?',
                                        )
                                    }
                                    className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 transition-colors focus-ring whitespace-nowrap shrink-0"
                                >
                                    <Icon name="sparkles" size={14} className="text-repere" aria-hidden="true" />
                                    <span>Gemini</span>
                                </button>
                            </div>

                            <div className="divide-y divide-bordure">
                                {prioritesPlanAction.map((prio) => (
                                    <button
                                        key={prio.id}
                                        type="button"
                                        onClick={() => setActiveTab(prio.tab)}
                                        onMouseEnter={() => prefetchTab(prio.tab)}
                                        className="gf-row touch-target w-full px-6 py-4 text-left flex items-center justify-between gap-4 focus-ring group"
                                    >
                                        <div className="min-w-0 flex-1 space-y-1.5">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-sm font-semibold text-ink-50 line-clamp-2 leading-snug group-hover:underline">
                                                    {prio.titre}
                                                </span>
                                            </div>
                                            <div className="h-1.5 w-full max-w-[220px] rounded-full bg-fond overflow-hidden">
                                                <div
                                                    style={{ width: `${isPrivacyMode ? 50 : prio.progressionPct}%` }}
                                                    className={`h-full rounded-full gf-bar-grow ${prio.classeBarre}`}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2.5 shrink-0">
                                            <span
                                                className={`px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${prio.statutClasse}`}
                                            >
                                                <PrivateAmount>{prio.statutLabel}</PrivateAmount>
                                            </span>
                                            <Icon name="chevron-right" size={14} className="text-ink-400" aria-hidden="true" />
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </section>

                        {/* Activité récente épurée */}
                        <section
                            aria-label="Opérations récentes"
                            className="divide-y divide-bordure"
                        >
                            <div className="px-6 py-4 flex items-center justify-between gap-3">
                                <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                                    Activité récente
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                    onMouseEnter={() => prefetchTab(Tab.TRANSACTIONS)}
                                    className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                                >
                                    <span>Journal</span>
                                    <Icon name="chevron-right" size={14} aria-hidden="true" />
                                </button>
                            </div>

                            {operationsRecentes.length > 0 ? (
                                <div className="divide-y divide-bordure">
                                    {operationsRecentes.slice(0, 4).map((tx) => {
                                        const estRevenu = tx.amount > 0;
                                        return (
                                            <button
                                                key={tx.id}
                                                type="button"
                                                onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                                className="gf-row touch-target w-full px-6 py-3 flex items-center justify-between gap-3 text-left focus-ring"
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-medium text-ink-50 truncate">
                                                        <PrivateText quoi="marchand">{tx.payee}</PrivateText>
                                                    </div>
                                                    <div className="text-xs text-ink-400 truncate font-mono tabular-nums">
                                                        {tx.date.slice(5)} · <PrivateText quoi="categorie">{tx.category}</PrivateText>
                                                    </div>
                                                </div>
                                                <PrivateAmount
                                                    className={`font-mono text-sm font-semibold tabular-nums shrink-0 ${
                                                        estRevenu ? 'text-succes-texte' : 'text-ink-200'
                                                    }`}
                                                >
                                                    {`${estRevenu ? '+' : '−'}${formatCAD(Math.abs(tx.amount))}`}
                                                </PrivateAmount>
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="px-6 py-5 flex items-center justify-between gap-3">
                                    <span className="text-sm text-ink-300">Aucune opération enregistrée</span>
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                        className="touch-target px-3.5 py-1.5 rounded-full bg-accent text-sur-accent text-xs font-semibold inline-flex items-center gap-1.5 focus-ring"
                                    >
                                        <Icon name="plus" size={14} aria-hidden="true" />
                                        <span>Ajouter</span>
                                    </button>
                                </div>
                            )}
                        </section>

                        {/* Calendrier & jalons compact */}
                        <section
                            aria-label="Prochains jalons patrimoniaux"
                            className="divide-y divide-bordure"
                        >
                            <div className="px-6 py-4 flex items-center justify-between gap-3">
                                <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                                    Calendrier & jalons
                                </h2>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.LIFE_PROJECTS)}
                                    onMouseEnter={() => prefetchTab(Tab.LIFE_PROJECTS)}
                                    className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                                >
                                    <span>Projets</span>
                                    <Icon name="chevron-right" size={14} aria-hidden="true" />
                                </button>
                            </div>

                            <div className="divide-y divide-bordure">
                                {prochainsJalons.slice(0, 3).map((jalon) => {
                                    const ecartAnnees = jalon.annee - anneeActuelle;
                                    const delaiTexte = isPrivacyMode ? '••' : ecartAnnees <= 0 ? 'Actif' : `Dans ${ecartAnnees} an${ecartAnnees > 1 ? 's' : ''}`;
                                    return (
                                        <button
                                            key={jalon.id}
                                            type="button"
                                            onClick={() => setActiveTab(jalon.tab)}
                                            className="gf-row touch-target w-full px-6 py-3 flex items-center justify-between gap-3 text-left focus-ring"
                                        >
                                            <div className="min-w-0 flex items-center gap-3">
                                                <span className="px-2 py-0.5 rounded-md gf-delta-amber font-mono tabular-nums text-xs font-bold shrink-0">
                                                    {jalon.annee}
                                                </span>
                                                <div className="min-w-0">
                                                    <div className="text-sm font-medium text-ink-50 truncate">
                                                        {jalon.titre}
                                                    </div>
                                                    <div className="text-xs text-ink-400 truncate">
                                                        {jalon.categorie} · {delaiTexte}
                                                    </div>
                                                </div>
                                            </div>
                                            <PrivateAmount className="font-mono tabular-nums text-sm font-semibold text-ink-50 shrink-0">
                                                {formatCompactCAD(jalon.montant)}
                                            </PrivateAmount>
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        {/* Pied de traçabilité discret en une seule ligne (Preuves & Sources) */}
                        <div
                            data-testid="preuves-sources-panel"
                            className="px-6 py-3 bg-fond flex items-center justify-between gap-3 text-xs text-ink-400"
                        >
                            <span className="inline-flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full gf-alloc-reer" aria-hidden="true" />
                                <span>Preuves & Sources · Calculs ARC & Revenu Québec 2026 vérifiés</span>
                            </span>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.TAX)}
                                className="touch-target px-2.5 py-1 rounded-full hover:text-ink-100 font-medium underline focus-ring"
                            >
                                Fiscalité
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Alternatives textuelles accessibles pour les deux graphiques Recharts */}
            <ChartDataTable
                caption="Trajectoire projetée du patrimoine net sur l'horizon sélectionné"
                columns={colonnesTrajectoire}
                rows={donneesTrajectoire as unknown as ReadonlyArray<Record<string, unknown>>}
            />
            <ChartDataTable
                caption="Répartition actuelle des avoirs par classe d'actifs"
                columns={colonnesRepartition}
                rows={partsRepartition as unknown as ReadonlyArray<Record<string, unknown>>}
            />

            <HubConnexionsModal
                isOpen={showConnexionsModal}
                onClose={() => setShowConnexionsModal(false)}
            />

            {showGeminiModal && (
                <Suspense fallback={null}>
                    <GeminiAssistantModal
                        isOpen={showGeminiModal}
                        onClose={() => {
                            setShowGeminiModal(false);
                            setRequete('');
                        }}
                        initialQuery={requete}
                    />
                </Suspense>
            )}
        </div>
    );
};

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

            {typeof enrichi.P10 === 'number' &&
                typeof enrichi.P90 === 'number' &&
                Number.isFinite(enrichi.P10) &&
                Number.isFinite(enrichi.P90) && (
                    <div className="pt-1.5 border-t border-bordure flex items-center justify-between gap-3 text-xs text-ink-400">
                        <span>Monte-Carlo P10–P90</span>
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
