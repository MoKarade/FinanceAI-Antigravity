import React, { useMemo, useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { Skeleton } from './ui/Skeleton';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { resolveDaySeriesIndex } from '../utils/daySeriesIndex';
import { hasForeignCurrencyAssets } from '../services/portfolio';

const FutureHistorySection = lazyWithRetry(() => import('./future/FutureHistorySection'), 'FutureHistorySection');

import { FutureHealthSummary } from './future/FutureHealthSummary';
import { FutureLegendDrawer } from './future/FutureLegendDrawer';
import { useHiddenSeries } from '../hooks/useHiddenSeries';
import { FuturePeriodSelector } from './future/FuturePeriodSelector';
import { GoogleFinanceHero } from './future/GoogleFinanceHero';
import { HubConnexionsModal } from './future/HubConnexionsModal';
import { FutureYearAnatomyModal } from './future/FutureYearAnatomyModal';
import { FutureScenarioHeader } from './future/FutureScenarioHeader';
import { FutureRichTooltip } from './future/FutureRichTooltip';
import { FutureCoreMilestonesGrid } from './future/FutureCoreMilestonesGrid';
import { FutureUnifiedInsightsPanel } from './future/FutureUnifiedInsightsPanel';
import { MarketImpactCard } from './future/MarketImpactCard';
import { showToast } from './ui/Toast';
import {
    buildReconciledAiActionPlan,
    type ReconciledAiAction,
} from '../services/projection/aiActionPlan';
import { computeMarketImpactSummary } from '../services/marketImpactSummary';
import { prefetchTab } from '../utils/tabPrefetch';
import { PageHeader } from './ui/PageHeader';
import { FUTURE_REQ_IDS } from './ProjectionEngine';
import { REQUIREMENTS } from './setup/requirements';
import { Drawer } from './ui/Drawer';
import { type FutureDrawerId, tiroirDomId } from './future/OutilsProjection';
import { couleurSerie } from './future/seriesConfig';
import type { VarianteBandeau } from './FutureKpiStrip';
import { Badge } from './ui/Badge';
import { Icon } from './ui/Icon';
import { PrivateAmount } from './ui/PrivateAmount';
import {
    Area,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
    CartesianGrid,
    ReferenceLine,
    ReferenceArea,
    Line,
    ComposedChart,
    Bar,
    ReferenceDot,
} from 'recharts';
import { GF_CROSSHAIR_CURSOR, GF_ACTIVE_DOT } from '../utils/chartTooltip';
import { Tab, BudgetConfig, BudgetCategory, RealEstateGoal, RetirementGoal, Transaction, ProjectionConfig } from '../types';
import { ProjectionResult, ProjectionChartPoint } from '../services/projection/types';
import type { DeepScenarioPoint, DeepTurningPoint } from '../services/projection/deepForecastTypes';
import { useFinanceStore } from '../store/useFinanceStore';
import { useDeepForecast } from '../hooks/useDeepForecast';
import { logError } from '../services/errorLogger';
import { usePendingFocus } from '../utils/usePendingFocus';
import { buildLockedByMonth } from '../utils/lockedCurveOverlay';
import { computeForecastAccuracy } from '../services/projection/forecastAccuracy';
import { ForecastAccuracyBadge } from './projection/ForecastAccuracyBadge';
import { findInsolvencyPoint } from '../utils/insolvency';
import { construireAlerteObjectifsManques } from './projection/alerteObjectifsManques';
import { kpiPatrimoine } from './projection/kpiPatrimoine';
import { mcSublabel } from '../services/projection/monteCarlo';
import { esperanceDeVieEffective } from '../services/projection/horizon';
import { sampleEvenly } from '../utils/sampleEvenly';
import { assignStackIndex } from '../utils/stackEventIcons';
import { FutureCurveToolbar, FutureTimelineBrush, type ModeAffichageCourbe } from './future/FutureCurveControls';
import { Tab as TabEnum } from '../types';
import { ClickableEventIcon, RefLineLabel, TodayValueBadge } from './projection/ProjectionTooltip';
import { detteSousZero, COULEUR_DETTE, detteLevierSousZero, COULEUR_LEVIER, LIBELLE_LEVIER } from './future/detteSerie';
import { NotesGraphe, notesGraphe } from './future/notesGraphe';
import { estGesteSelectionJourClavier } from '../utils/chartKeyboardSelect';
import { FutureDetailModal } from './projection/FutureDetailModal';
import { useTimeChartZoom } from '../hooks/useTimeChartZoom';
import { useSelectionJour } from '../hooks/useSelectionJour';
import { choisirJourAffiche } from './future/jourAffiche';
import { indexAujourdhui, indexApresPas, PAS_PAR_DEFAUT, type PasNavigation } from './future/panneauPas';
import { resolvePointByX } from '../utils/chartTooltip';
import { ProjectionControls } from './projection/ProjectionControls';
import { useSimulationParams, useTodayIsoLocal } from '../hooks/useSimulationParams';
import { buildPastPrefix } from '../services/history/buildPastPrefix';
import { computePrivateBusinessValue } from '../services/projection/privateBusinessValue';
import { mentionDettesPasse } from '../services/history/pastDebtNotice';
import { mentionRaccord } from '../services/history/raccordNotice';
import { deriveMilestoneIcons } from '../services/projection/milestoneIcons';
import { ChartDataTable, type ChartDataColumn } from './ui/ChartDataTable';
import { isoDate, finiteAnchorRun, calendarFromMonthIndex, axisXForIso, axisXAtDay, centeredWindowRange } from '../services/projection/dailyRefine';
import { useViewportBelowSm } from '../hooks/useViewportBelowSm';
import { useViewportBelowLg } from '../hooks/useViewportBelowLg';
import { mergeDailyRealPoint, sliceDailyRangeByX, decimateForRender, realOnlyMonthPoints, buildEnrichedMonth } from '../services/projection/dailyCurve';
import { buildDailyLedger, NET_WORTH_DAILY_ASSETS } from '../services/projection/dailyLedger';
import { buildDailyPastLedger } from '../services/history/dailyPastLedger';
import { reconstructRealEstateEquityByYear } from '../services/history/reconstructRealEstateEquity';
import { MASKED_AMOUNT_LABEL } from '../utils/privacyAria';
import { formatCAD, formatCompactCAD } from '../utils/format';
import { maskedTick } from '../utils/chartPrivacy';
import { reperesRonds } from '../utils/reperesRonds';
import { NO_DATA_LABEL } from './ui/emptyAware';
import { dayVariation } from '../services/history/dayVariation';
import { addDay } from '../services/history/reconstructCashHistory';

const EMPTY_ARRAY: never[] = [];
type FinanceStoreState = ReturnType<typeof useFinanceStore.getState>;
const EMPTY_ASSETS: FinanceStoreState['assets'] = [];
const EMPTY_RECURRING: NonNullable<FinanceStoreState['subscriptions']> = [];
const EMPTY_FX: Record<string, number> = {};
const EMPTY_DEBTS: NonNullable<FinanceStoreState['debts']> = [];
const EMPTY_ACTION_IDS: string[] = [];

const X_AXIS_DOMAIN: ['dataMin', 'dataMax'] = ['dataMin', 'dataMax'];
const RENDER_MAX_POINTS = 700;

// Champs ventilés pour la série quotidienne de la courbe et le ruban [P10, P90].
const CURVE_FIELDS: ReadonlySet<string> = new Set([
    'Liquidites',
    'CELI',
    'CELIAPP',
    'REER',
    'REEE',
    'NonReg',
    'Crypto',
    'Immobilier',
    'Entreprise',
    'ImpotLatent',
    'FluxImpots',
    'P5',
    'P10',
    'P25',
    'P50',
    'P75',
    'P90',
    'P95',
    'NetWorth',
    'lockedNetWorth',
    'mcRange',
    'mcCoreRange',
    'DettesNonImmo',
    'DetteLevierSmith',
    'year',
    'age',
    'isPast',
]);

interface FutureProjectionProps {
    initialBalances: Record<string, number>;
    transactions: Transaction[];
    budgetItems: BudgetCategory[];
    config: BudgetConfig;
    realEstateGoals: RealEstateGoal[];
    setRealEstateGoals?: (g: RealEstateGoal[]) => void;
    retirementGoal: RetirementGoal;
    setRetirementGoal?: (g: RetirementGoal) => void;
    calculatedMonthlySavings: number;
    projection: ProjectionConfig;
    setProjection: (p: ProjectionConfig) => void;
    isPrivacyMode?: boolean;
    autoReveal?: boolean;
    bandeauKpi?: (variante: VarianteBandeau) => React.ReactNode;
}

type DisplayPointInput = {
    monthIndex: number;
    NetWorth?: number;
    DettesNonImmo?: number;
    year?: number;
    age?: number;
    dateLabel?: string;
    isPast?: boolean;
    [key: string]: unknown;
};

type EnrichedDisplayPoint = DisplayPointInput & {
    lockedNetWorth?: number;
};

function mergeScenarioIntoChartPoint(
    basePoint: DisplayPointInput,
    scenPt: DeepScenarioPoint | undefined,
    lockedVal: number | undefined,
    scaleAccounts: boolean,
): EnrichedDisplayPoint {
    const next: EnrichedDisplayPoint = { ...basePoint };
    if (lockedVal !== undefined) {
        next.lockedNetWorth = lockedVal;
    }
    if (!scenPt) return next;

    next.P10 = scenPt.p10;
    if (typeof scenPt.p25 === 'number' && Number.isFinite(scenPt.p25)) {
        next.P25 = scenPt.p25;
    }
    next.P50 = scenPt.p50;
    if (typeof scenPt.p75 === 'number' && Number.isFinite(scenPt.p75)) {
        next.P75 = scenPt.p75;
    }
    next.P90 = scenPt.p90;
    next.NetWorth = scenPt.p50;

    if (scaleAccounts || Math.abs((basePoint.NetWorth ?? scenPt.p50) - scenPt.p50) > 1) {
        const debtVal =
            typeof basePoint.DettesNonImmo === 'number' && Number.isFinite(basePoint.DettesNonImmo)
                ? basePoint.DettesNonImmo
                : 0;
        const targetAssetsSum = scenPt.p50 + debtVal;
        let origAssetsSum = 0;
        const presentKeys: string[] = [];

        for (const key of NET_WORTH_DAILY_ASSETS) {
            const raw = basePoint[key];
            if (typeof raw === 'number' && Number.isFinite(raw)) {
                origAssetsSum += raw;
                presentKeys.push(key);
            }
        }

        if (targetAssetsSum >= 0 && origAssetsSum > 1) {
            const ratio = targetAssetsSum / origAssetsSum;
            for (const key of presentKeys) {
                next[key] = Number(basePoint[key]) * ratio;
            }
        } else if (targetAssetsSum >= 0) {
            for (const key of presentKeys) {
                next[key] = 0;
            }
            next.Liquidites = targetAssetsSum;
        } else {
            for (const key of presentKeys) {
                next[key] = 0;
            }
            next.DettesNonImmo = -scenPt.p50;
        }
    }

    return next;
}

export const FutureProjection: React.FC<FutureProjectionProps> = ({
    initialBalances = {},
    transactions = [],
    budgetItems = [],
    config,
    realEstateGoals = [],
    setRealEstateGoals,
    retirementGoal,
    calculatedMonthlySavings,
    projection,
    setProjection,
    isPrivacyMode = false,
    bandeauKpi,
}) => {
    const updateProj = <K extends keyof ProjectionConfig>(key: K, val: ProjectionConfig[K]) => {
        setProjection({ ...projection, [key]: val });
    };

    const updateReturnRate = (key: string, val: number) => {
        setProjection({
            ...projection,
            returnRates: { ...(projection.returnRates || { celi: 7, reer: 6.5, nonReg: 6.5, crypto: 10, cash: 3 }), [key]: val },
        });
    };

    const {
        params,
        pastHistory,
        liveCSVBalances,
        calculatedStartingCash,
        startYear,
        startMonth,
        todayMonthIndex,
        mentionAutoriteCourtier,
        pastCurveCalibration,
    } = useSimulationParams(calculatedMonthlySavings);

    const applyHistoricalRate = () => {
        if (liveCSVBalances.historicalRate > 0) {
            const rate = Number(liveCSVBalances.historicalRate.toFixed(1));
            setProjection({
                ...projection,
                returnRates: { ...projection.returnRates, celi: rate, reer: rate, nonReg: rate, crypto: rate, cash: 3 },
            });
        }
    };

    const runMC = useFinanceStore((s) => s.projectionRunMC);
    const setRunMC = useFinanceStore((s) => s.setProjectionRunMC);

    usePendingFocus(TabEnum.FUTURE);

    const projectionStatus = useFinanceStore((s) => s.projectionStatus);
    const isComputing = projectionStatus === 'computing';
    const hasError = projectionStatus === 'error';
    const reqsMet = useFinanceStore((s) => FUTURE_REQ_IDS.every((id) => REQUIREMENTS[id].isMet(s)));
    const projectionRefus = useFinanceStore((s) => s.projectionRefus);
    const liveResults = useFinanceStore((s) => s.lastProjection);
    const hasForeignHoldings = useFinanceStore((s) => hasForeignCurrencyAssets(s.assets));

    const results = liveResults;
    const curveVisible = results !== null;

    const [restoringTimedOut, setRestoringTimedOut] = useState(false);
    useEffect(() => {
        if (!reqsMet || hasError || results !== null || projectionStatus === 'computing') {
            setRestoringTimedOut(false);
            return;
        }
        const timer = window.setTimeout(() => {
            setRestoringTimedOut(true);
        }, 4000);
        return () => window.clearTimeout(timer);
    }, [reqsMet, hasError, results, projectionStatus]);

    const curveRestoring =
        reqsMet && !hasError && !restoringTimedOut && results === null;

    const {
        chartData = [] as ProjectionChartPoint[],
        fireNumber = 0,
        allResults = [] as ProjectionResult[],
    } = results ?? {};

    // Orchestration Futur 4.0 : 4 scénarios uniques + mémoire chiffrée + calcul profond 100k+.
    const deepForecast = useDeepForecast(params, allResults[0] ?? results);
    const activeScenarioOutput =
        deepForecast.activeReport.scenarios[deepForecast.selectedScenario] ??
        deepForecast.activeReport.scenarios.real_trajectory;

    const activeScenarioByMonth = useMemo(() => {
        const map = new Map<number, DeepScenarioPoint>();
        for (const pt of activeScenarioOutput.points) {
            map.set(Math.trunc(pt.monthIndex), pt);
        }
        return map;
    }, [activeScenarioOutput.points]);

    const insolvency = useMemo(() => findInsolvencyPoint(chartData), [chartData]);
    const alerteObjectifs = useMemo(
        () => construireAlerteObjectifsManques(allResults[0]?.goalShortfalls),
        [allResults],
    );

    const lockedProjection = useFinanceStore((s) => s.lockedProjection);
    const isProjectionLocked = useFinanceStore((s) => s.isProjectionLocked);
    const lockProjection = useFinanceStore((s) => s.lockProjection);
    const unlockProjection = useFinanceStore((s) => s.unlockProjection);

    const effectiveChartData = liveResults?.chartData?.length ? liveResults.chartData : chartData;
    const rawDebtNonImmo = effectiveChartData?.[0]?.DettesNonImmo;
    const currentDebtNonImmo = Number(rawDebtNonImmo) || 0;
    const debtAnomaly = (effectiveChartData?.length ?? 0) > 0 && !Number.isFinite(Number(rawDebtNonImmo));
    const storeDebts = useFinanceStore((s) => s.debts) ?? EMPTY_DEBTS;
    const storePrivateBusinesses = useFinanceStore((s) => s.privateBusinesses);
    const privateBusinessValue = useMemo(
        () => computePrivateBusinessValue(storePrivateBusinesses),
        [storePrivateBusinesses],
    );

    useEffect(() => {
        if (debtAnomaly) {
            logError({
                source: 'ui',
                severity: 'warning',
                message: 'FutureProjection : DettesNonImmo non fini — dette du passé rabattue à 0',
                context: { rawDebtNonImmo },
            });
        }
    }, [debtAnomaly, rawDebtNonImmo]);

    const todayIso = useTodayIsoLocal();

    const pastPrefix = useMemo(() => {
        const built = buildPastPrefix({
            pastHistoryPoints: pastHistory.points,
            transactions,
            calculatedStartingCash,
            realEstateGoals,
            startYear,
            startMonth,
            todayIso,
            currentDebtNonImmo,
            debts: storeDebts,
            privateBusinessValue,
        });
        return {
            points: built.points.length ? built.points : EMPTY_ARRAY,
            fluxPeriodeAnnulee: built.fluxPeriodeAnnulee,
        };
    }, [
        pastHistory.points,
        startYear,
        startMonth,
        todayIso,
        transactions,
        calculatedStartingCash,
        realEstateGoals,
        currentDebtNonImmo,
        storeDebts,
        privateBusinessValue,
    ]);
    const pastPrefixPoints = pastPrefix.points;

    const mentionDettes = useMemo(
        () => mentionDettesPasse(storeDebts, startYear * 12 + startMonth, currentDebtNonImmo, todayIso, transactions),
        [storeDebts, startYear, startMonth, currentDebtNonImmo, todayIso, transactions],
    );

    const lockedByMonth = useMemo(
        () => buildLockedByMonth(lockedProjection, isProjectionLocked, (p) => p.NetWorth ?? NaN),
        [isProjectionLocked, lockedProjection],
    );

    const displayData = useMemo(() => {
        const base = pastPrefixPoints.length ? [...pastPrefixPoints, ...chartData] : chartData;
        const scaleAccounts = deepForecast.selectedScenario !== 'real_trajectory';
        return base.map((d) => {
            const mKey = Math.trunc(d.monthIndex);
            const scenPt = d.monthIndex >= todayMonthIndex ? activeScenarioByMonth.get(mKey) : undefined;
            const lockedVal = lockedByMonth ? lockedByMonth.get(d.monthIndex) : undefined;
            if (!scenPt && lockedVal === undefined) return d;
            return mergeScenarioIntoChartPoint(d, scenPt, lockedVal, scaleAccounts);
        });
    }, [
        pastPrefixPoints,
        chartData,
        deepForecast.selectedScenario,
        todayMonthIndex,
        activeScenarioByMonth,
        lockedByMonth,
    ]);
    const pastStartIndex = pastPrefixPoints.length ? pastPrefixPoints[0].monthIndex : 0;

    const { lifeChartEvents, flowChartEvents } = useMemo(() => {
        type ChartEvent = {
            monthIndex: number;
            year: number | undefined;
            age: number | undefined;
            dateLabel: string | undefined;
            val: number | undefined;
            netWorth: number | undefined;
            label: string;
            subIdx: number;
            index: number;
            kind: 'life' | 'flow';
            color?: string;
            pinned?: boolean;
            x?: number;
        };
        const lifes: ChartEvent[] = [];
        const flows: ChartEvent[] = [];
        const DEDUP_GAP = 3;
        const lastLife: Record<string, number> = {};
        const lastFlow: Record<string, number> = {};
        const FIRE_RE = /\bfire\b/i;

        chartData.forEach((d: ProjectionChartPoint) => {
            const scenPt = d.monthIndex >= todayMonthIndex ? activeScenarioByMonth.get(Math.trunc(d.monthIndex)) : undefined;
            const nw = scenPt ? scenPt.p50 : d.NetWorth;
            const meta = {
                monthIndex: d.monthIndex,
                year: d.year,
                age: d.age,
                dateLabel: d.dateLabel,
                val: nw,
                netWorth: nw,
            };
            const cal = calendarFromMonthIndex(startYear, startMonth, d.monthIndex);
            const dayXOf = (label: string): number | undefined => {
                const day = (d.eventDays ?? {})[label];
                if (!Number.isFinite(day)) return undefined;
                return axisXAtDay(d.monthIndex, day, cal.year, cal.month);
            };
            (d.lifeEvents || []).forEach((label: string) => {
                if (lastLife[label] != null && d.monthIndex - lastLife[label] <= DEDUP_GAP) return;
                lastLife[label] = d.monthIndex;
                const isFire = FIRE_RE.test(label);
                lifes.push({
                    ...meta,
                    label,
                    subIdx: 0,
                    index: 0,
                    kind: 'life',
                    x: dayXOf(label),
                    ...(isFire ? { color: 'var(--repere)', pinned: true } : null),
                });
            });
            (d.flowEvents || []).forEach((label: string) => {
                const dedupKey = label.replace(/\d[\d\s.,]*/g, '#');
                if (lastFlow[dedupKey] != null && d.monthIndex - lastFlow[dedupKey] <= DEDUP_GAP) return;
                lastFlow[dedupKey] = d.monthIndex;
                flows.push({ ...meta, label, subIdx: 0, index: 0, kind: 'flow', x: dayXOf(label) });
            });
        });

        const milestones = deriveMilestoneIcons(chartData).map((m) => {
            const scenPt = m.monthIndex >= todayMonthIndex ? activeScenarioByMonth.get(Math.trunc(m.monthIndex)) : undefined;
            return {
                ...m,
                val: scenPt ? scenPt.p50 : m.val,
                netWorth: scenPt ? scenPt.p50 : m.netWorth,
                subIdx: 0,
                index: 0,
                pinned: true,
            };
        });
        lifes.push(...milestones);

        const finalize = (arr: ChartEvent[]): ChartEvent[] => {
            const sorted = [...arr].sort((a, b) => a.monthIndex - b.monthIndex);
            return sorted.map((e, i) => ({ ...e, subIdx: 0, index: i }));
        };
        return { lifeChartEvents: finalize(lifes), flowChartEvents: finalize(flows) };
    }, [chartData, startYear, startMonth, todayMonthIndex, activeScenarioByMonth]);

    const lifeMarkers = useMemo(() => {
        const markers: { monthIndex: number; label: string; color: string; jalon?: boolean }[] = [];
        let retDone = false;
        const accounts: Array<[keyof ProjectionChartPoint, string]> = [
            ['REER', 'REER'],
            ['CELI', 'CELI'],
            ['NonReg', 'Non-enr.'],
            ['CELIAPP', 'CELIAPP'],
        ];
        const sig: Record<string, boolean> = {};
        const dep: Record<string, boolean> = {};
        for (const d of chartData as ProjectionChartPoint[]) {
            if (d.monthIndex < 0) continue;
            // NOMBRE-NON-MONETAIRE : âge de retraite saisi, masqué en mode discret
            if (!retDone && d.isRetired) {
                markers.push({
                    monthIndex: d.monthIndex,
                    label: `Retraite${!isPrivacyMode && d.age ? ` · ${Math.floor(d.age)} ans` : ''}`,
                    color: 'var(--accent)',
                    jalon: true,
                });
                retDone = true;
            }
            for (const [key, short] of accounts) {
                const v = (d[key] as number | undefined) ?? 0;
                if (v > 5000) sig[key as string] = true;
                if (sig[key as string] && !dep[key as string] && v < 1000) {
                    markers.push({ monthIndex: d.monthIndex, label: `${short} ⌀`, color: 'var(--erreur-texte)' });
                    dep[key as string] = true;
                }
            }
        }
        return markers;
    }, [chartData, isPrivacyMode]);

    const jalonFire = useMemo(
        () => lifeChartEvents.find((e) => e.kind === 'life' && /\bfire\b/i.test(e.label)) ?? null,
        [lifeChartEvents],
    );

    const [tiroirOuvert, setTiroirOuvert] = useState<FutureDrawerId | null>(null);
    const [showConnexionsModal, setShowConnexionsModal] = useState(false);
    const [anatomyOpen, setAnatomyOpen] = useState(false);
    const [modeCourbe, setModeCourbe] = useState<ModeAffichageCourbe>('nette');
    const [modeComparaison, setModeComparaison] = useState(false);
    const [comparaisonPoints, setComparaisonPoints] = useState<{
        a: ProjectionChartPoint | null;
        b: ProjectionChartPoint | null;
    }>({ a: null, b: null });
    const dragStartPointRef = useRef<ProjectionChartPoint | null>(null);
    const [hoverXRatio, setHoverXRatio] = useState<number | null>(null);
    const [pendingFocusMonth, setPendingFocusMonth] = useState<number | null>(null);

    const revealedRef = useRef<HTMLDivElement>(null);
    const prevCurveVisibleRef = useRef(curveVisible);
    useEffect(() => {
        const was = prevCurveVisibleRef.current;
        prevCurveVisibleRef.current = curveVisible;
        if (!was && curveVisible) revealedRef.current?.focus();
    }, [curveVisible]);

    const monthIndexToYear = useMemo(() => {
        const map = new Map<number, number>();
        for (const d of displayData as ProjectionChartPoint[]) {
            if (d.year !== undefined) map.set(d.monthIndex, d.year);
        }
        return map;
    }, [displayData]);

    const zoom = useTimeChartZoom<ProjectionChartPoint>(displayData as ProjectionChartPoint[], { minPoints: 1 });

    const dailyAnchors = useMemo(
        () => finiteAnchorRun(displayData as ProjectionChartPoint[], startYear, startMonth),
        [displayData, startYear, startMonth],
    );
    const todayAxisX = useMemo(
        () => axisXForIso(startYear, startMonth, todayIso),
        [startYear, startMonth, todayIso],
    );

    const storeAssets = useFinanceStore((s) => s.assets) ?? EMPTY_ASSETS;
    const fintableSyncAt = useFinanceStore((s) => s.fintableSyncReport?.at);
    const syncConfirmedUntilIso = useMemo(() => {
        if (!Number.isFinite(fintableSyncAt)) return null;
        const d = new Date(fintableSyncAt as number);
        return isoDate(d.getFullYear(), d.getMonth(), d.getDate());
    }, [fintableSyncAt]);
    const fxRates = useFinanceStore((s) => s.fxRates) ?? EMPTY_FX;
    const completedAiActionIds = useFinanceStore((s) => s.completedAiActionIds) ?? EMPTY_ACTION_IDS;

    const reconciledActions = useMemo(
        () =>
            buildReconciledAiActionPlan({
                state: {
                    projection,
                    debts: storeDebts,
                    budgetItems,
                    assets: storeAssets,
                    retirementGoal,
                    config,
                    fxRates,
                },
                report: deepForecast.activeReport,
            }),
        [
            projection,
            storeDebts,
            budgetItems,
            storeAssets,
            retirementGoal,
            config,
            fxRates,
            deepForecast.activeReport,
        ],
    );

    const marketImpact = useMemo(
        () =>
            computeMarketImpactSummary({
                assets: storeAssets,
                fxRates,
                lastProjection: results,
                newsBundle: deepForecast.activeReport.newsBundle,
                pastCalibration: pastCurveCalibration,
                retirementGoal,
                baseReturnRatePct: projection?.returnRate,
            }),
        [
            storeAssets,
            fxRates,
            results,
            deepForecast.activeReport.newsBundle,
            pastCurveCalibration,
            retirementGoal,
            projection?.returnRate,
        ],
    );

    const handleToggleActionCompleted = useCallback((actionId: string) => {
        const cur = useFinanceStore.getState().completedAiActionIds ?? [];
        const exists = cur.includes(actionId);
        const next = exists ? cur.filter((id) => id !== actionId) : [...cur, actionId];
        useFinanceStore.getState().setAppState({ completedAiActionIds: next });
    }, []);

    const handleApplyActionPatch = useCallback((action: ReconciledAiAction) => {
        if (!action.applyPatch) return;
        const cur = useFinanceStore.getState();
        cur.setAppState({
            ...action.applyPatch,
            completedAiActionIds: cur.completedAiActionIds?.includes(action.id)
                ? cur.completedAiActionIds
                : [...(cur.completedAiActionIds ?? []), action.id],
        });
        showToast(`Appliqué à ton plan : ${action.title}`, 'success');
    }, []);
    const storeRecurring = useFinanceStore((s) => s.subscriptions) ?? EMPTY_RECURRING;
    const dailyMonthlyNet = (config?.users ?? []).reduce((s, u) => s + (Number(u?.netSalary) || 0), 0);
    const dailyMonthlyDebt = useFinanceStore(
        (s) => (s.debts ?? []).reduce((acc, d) => acc + (Number(d?.minimumPayment) || 0), 0),
    );

    // Colonnes de la table accessible sr-only (alignées sur la légende et le ruban [P10, P50, P90]).
    const dataColumns = useMemo<ChartDataColumn[]>(() => {
        const money = (v: unknown) => {
            if (v === undefined || v === null || !Number.isFinite(Number(v))) return NO_DATA_LABEL;
            return isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCompactCAD(Number(v));
        };
        return [
            {
                key: 'dateLabel',
                label: 'Date',
                format: (_v, row) => {
                    const r = row as { dateLabel?: string; year?: number };
                    return r.dateLabel ?? (r.year !== undefined ? String(r.year) : '');
                },
            },
            { key: 'NetWorth', label: 'Valeur nette', format: money },
            { key: 'P10', label: 'Scénario prudent', format: money },
            { key: 'P50', label: 'Scénario central', format: money },
            { key: 'P90', label: 'Scénario favorable', format: money },
            { key: 'Liquidites', label: 'Cash', format: money },
            { key: 'CELI', label: 'CELI', format: money },
            { key: 'CELIAPP', label: 'CELIAPP (FHSA)', format: money },
            { key: 'REER', label: 'REER', format: money },
            { key: 'REEE', label: 'REEE', format: money },
            { key: 'NonReg', label: 'Non-Enreg', format: money },
            { key: 'Crypto', label: 'Crypto', format: money },
            { key: 'Immobilier', label: 'Équité Immo', format: money },
            { key: 'Entreprise', label: 'Entreprise privée', format: money },
            { key: 'DettesNonImmo', label: 'Dettes (hors hypothèque)', format: money },
            { key: 'DetteLevierSmith', label: LIBELLE_LEVIER, format: money },
        ];
    }, [isPrivacyMode]);

    const [detailPoint, setDetailPoint] = useState<ProjectionChartPoint | null>(null);
    const [detailDayIso, setDetailDayIso] = useState<string | null>(null);
    const [detailAnchorIso, setDetailAnchorIso] = useState<string | null>(null);
    const [detailMonthIso, setDetailMonthIso] = useState<string | null>(null);

    const { hiddenSeries, isVisible, toggleSeries, showAllSeries } = useHiddenSeries();

    const lastHoverPointRef = useRef<ProjectionChartPoint | null>(null);
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);

    const isBelowSidebarBreakpoint = useViewportBelowLg();
    const isNarrowViewport = useViewportBelowSm();
    const etroit = isBelowSidebarBreakpoint;
    // [PRIVACY-RATIOS-DUREES-UNIFORMES] Année et âge FIRE = dérivés du dossier : absents en mode discret.
    const libelleJalonFire =
        !isPrivacyMode && jalonFire?.year != null
            ? `FIRE ≈ ${jalonFire.year}${!etroit && jalonFire.age != null ? ` · ${Math.floor(jalonFire.age)} ans` : ''}`
            : 'FIRE';

    const selection = useSelectionJour<ProjectionChartPoint>({
        getKey: (p) => p.monthIndex,
        containerRef: zoom.containerEl,
    });

    const dailyPastFrom = useMemo(() => {
        const first = dailyAnchors[0];
        if (!first) return null;
        const firstIso = isoDate(first.year, first.month, 1);
        return firstIso < todayIso ? firstIso : null;
    }, [dailyAnchors, todayIso]);

    const dailyPast = useMemo(() => {
        if (!dailyPastFrom) return null;
        const built = buildDailyPastLedger({
            from: dailyPastFrom,
            to: todayIso,
            today: todayIso,
            transactions,
            currentCash: calculatedStartingCash || 0,
            assets: storeAssets,
            fx: fxRates,
            equityByYear: reconstructRealEstateEquityByYear(realEstateGoals, startYear),
            currentDebtNonImmo,
            debts: storeDebts,
            privateBusinessValue,
        });
        return {
            byDate: built.rows.length ? new Map(built.rows.map((r) => [r.date, r])) : null,
            undatedTotal: built.undatedTotal,
            flowsAfterNowDate: built.flowsAfterNowDate,
            truncatedFrom: built.truncatedFrom,
            fluxPeriodeAnnulee: built.fluxPeriodeAnnulee,
        };
    }, [
        dailyPastFrom,
        todayIso,
        transactions,
        calculatedStartingCash,
        storeAssets,
        fxRates,
        realEstateGoals,
        startYear,
        currentDebtNonImmo,
        storeDebts,
        privateBusinessValue,
    ]);
    const dailyPastByDate = dailyPast?.byDate ?? null;

    const mentionRaccordJour = useMemo(
        () => (dailyPast === null ? '' : mentionRaccord(dailyPast.fluxPeriodeAnnulee)),
        [dailyPast],
    );
    const mentionRaccordMois = useMemo(
        () => (dailyPast !== null ? '' : mentionRaccord(pastPrefix.fluxPeriodeAnnulee)),
        [dailyPast, pastPrefix],
    );

    const variationDuJour = useMemo(() => {
        if (!detailDayIso || !dailyPastByDate) return null;
        const jour = dailyPastByDate.get(detailDayIso);
        if (!jour) return null;
        const veilleIso = addDay(detailDayIso, -1);
        return dayVariation(jour, dailyPastByDate.get(veilleIso));
    }, [detailDayIso, dailyPastByDate]);

    const dailyDated = useMemo(
        () => ({
            recurring: storeRecurring,
            monthlyNetSalary: dailyMonthlyNet,
            monthlyDebtPayment: dailyMonthlyDebt,
        }),
        [storeRecurring, dailyMonthlyNet, dailyMonthlyDebt],
    );

    const dailyAll = useMemo<ProjectionChartPoint[]>(() => {
        if (dailyAnchors.length < 2) return [];
        const keep = new Set(dailyAnchors.map((a) => a.monthIndex));
        const months = (displayData as ProjectionChartPoint[]).filter((p) => keep.has(p.monthIndex));
        if (months.length < 2) return [];

        const days = buildDailyLedger({
            months,
            startYear,
            startMonth,
            dated: dailyDated,
            fields: CURVE_FIELDS,
        });
        if (days.length === 0) return [];

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
        if (points.length === 0) return [];

        for (const p of points) {
            const v = (p as Record<string, unknown>).FluxImpots;
            if (typeof v === 'number' && Math.abs(v) < 0.005) {
                delete (p as Record<string, unknown>).FluxImpots;
            }
        }

        const anchorHost = months[0].monthIndex;
        const anchorDays = realOnlyMonthPoints(
            anchorHost,
            startYear,
            startMonth,
            dailyPastByDate,
            CURVE_FIELDS,
            syncConfirmedUntilIso,
        );
        if (anchorDays.length > 0) return [...anchorDays, ...points];
        const { FluxImpots: _anchorFlux, ...anchorRest } = months[0] as ProjectionChartPoint & {
            FluxImpots?: number;
        };
        return [anchorRest as ProjectionChartPoint, ...points];
    }, [dailyAnchors, displayData, startYear, startMonth, dailyDated, dailyPastByDate, syncConfirmedUntilIso, todayIso]);

    const forecastAccuracy = useMemo(
        () => computeForecastAccuracy(dailyAll, lockedByMonth),
        [dailyAll, lockedByMonth],
    );

    const enrichCache = useMemo(
        () => ({
            byHost: new Map<number, Map<string, ProjectionChartPoint>>(),
            failLogged: new Set<number>(),
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
                displayData as ProjectionChartPoint[],
                host,
                startYear,
                startMonth,
                dailyPastByDate,
                dailyDated,
                buildDailyLedger as never,
                syncConfirmedUntilIso,
                todayIso,
            );
            if (byIso === null) {
                if (!enrichCache.failLogged.has(host)) {
                    enrichCache.failLogged.add(host);
                    logError({
                        source: 'ui',
                        severity: 'warning',
                        message: 'FUTUR-DAILY-NATIVE : enrichissement du mois impossible, infobulle en champs réduits',
                        context: { host },
                    });
                }
                return p;
            }
            enrichCache.byHost.set(host, byIso);
            return byIso.get(iso) ?? p;
        },
        [displayData, startYear, startMonth, dailyDated, dailyPastByDate, enrichCache, syncConfirmedUntilIso, todayIso],
    );

    const detailPointFor = useCallback(
        (p: ProjectionChartPoint | null): ProjectionChartPoint | null => {
            if (!p) return null;
            const host = p.hostMonthIndex;
            if (typeof host !== 'number') return p;
            return (displayData as ProjectionChartPoint[]).find((d) => d.monthIndex === host) ?? null;
        },
        [displayData],
    );

    const visLoMonth = zoom.visibleData[0]?.monthIndex;
    const visHiMonth = zoom.visibleData[zoom.visibleData.length - 1]?.monthIndex;
    const dailyWindowRange = useMemo<[number, number]>(() => {
        if (dailyAll.length === 0 || visLoMonth === undefined || visHiMonth === undefined) return [0, 0];
        return sliceDailyRangeByX(dailyAll, visLoMonth, visHiMonth);
    }, [dailyAll, visLoMonth, visHiMonth]);
    const daysInWindow = useMemo<ProjectionChartPoint[]>(
        () => dailyAll.slice(dailyWindowRange[0], dailyWindowRange[1]),
        [dailyAll, dailyWindowRange],
    );
    const isDailyCurve = daysInWindow.length >= 2;

    const chartSeries = useMemo<ProjectionChartPoint[]>(() => {
        if (!isDailyCurve) return zoom.visibleData as ProjectionChartPoint[];
        return decimateForRender(daysInWindow, dailyWindowRange[0], RENDER_MAX_POINTS);
    }, [isDailyCurve, daysInWindow, dailyWindowRange, zoom.visibleData]);

    const chartSeriesWithRibbon = useMemo<Array<Record<string, unknown>>>(() => {
        const hasPointBounds = (p: ProjectionChartPoint | undefined): boolean =>
            Boolean(
                p &&
                    typeof p.P10 === 'number' &&
                    Number.isFinite(p.P10) &&
                    typeof p.P90 === 'number' &&
                    Number.isFinite(p.P90),
            );
        return chartSeries.map((pt, idx) => {
            const p10 = pt.P10;
            const p90 = pt.P90;
            const p25 = pt.P25;
            const p75 = pt.P75;
            if (
                typeof p10 === 'number' &&
                Number.isFinite(p10) &&
                typeof p90 === 'number' &&
                Number.isFinite(p90)
            ) {
                const lo = Math.min(p10, p90);
                const hi = Math.max(p10, p90);
                const hasCore =
                    typeof p25 === 'number' &&
                    Number.isFinite(p25) &&
                    typeof p75 === 'number' &&
                    Number.isFinite(p75);
                const coreLo = hasCore ? Math.min(p25, p75) : undefined;
                const coreHi = hasCore ? Math.max(p25, p75) : undefined;
                return {
                    ...pt,
                    P10: lo,
                    P90: hi,
                    mcRange: [lo, hi] as [number, number],
                    ...(hasCore
                        ? { P25: coreLo, P75: coreHi, mcCoreRange: [coreLo!, coreHi!] as [number, number] }
                        : { mcCoreRange: null }),
                };
            }
            // Ancrage visuel uniquement : ouvre le cône et les courbes d'incertitude sans coupure depuis Aujourd'hui.
            const next = chartSeries[idx + 1];
            const prev = idx > 0 ? chartSeries[idx - 1] : undefined;
            const anchorsCone =
                (hasPointBounds(next) || hasPointBounds(prev)) &&
                typeof pt.NetWorth === 'number' &&
                Number.isFinite(pt.NetWorth);
            if (anchorsCone) {
                const nw = pt.NetWorth;
                return {
                    ...pt,
                    P10: nw,
                    P25: nw,
                    P50: nw,
                    P75: nw,
                    P90: nw,
                    mcRange: [nw, nw] as [number, number],
                    mcCoreRange: [nw, nw] as [number, number],
                };
            }
            return { ...pt, mcRange: null, mcCoreRange: null };
        });
    }, [chartSeries]);

    // L'échelle Y inclut toujours P10 et P90 quand le ruban est visible pour éviter tout rognage.
    const echelleY = useMemo(() => {
        const vue = (k: string) => !hiddenSeries.has(k);
        const empilees =
            modeCourbe === 'empilee'
                ? (
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
                  ).filter((k) => vue(k))
                : [];
        const lignes: Array<'NetWorth' | 'P10' | 'P50' | 'P90' | 'ImpotLatent'> = [];
        if (vue('NetWorth') || modeCourbe === 'nette') lignes.push('NetWorth');
        if (vue('montecarlo')) {
            lignes.push('P10', 'P90');
        }
        if (vue('ImpotLatent') && modeCourbe === 'empilee') lignes.push('ImpotLatent');
        const valeurs: number[] = [];
        const garder = (v: unknown) => {
            if (typeof v === 'number' && Number.isFinite(v)) valeurs.push(v);
        };
        for (const p of chartSeries) {
            if (empilees.length > 0) {
                let pile = 0;
                for (const k of empilees) {
                    const v = p[k];
                    if (typeof v === 'number' && Number.isFinite(v)) pile += v;
                }
                valeurs.push(pile);
            }
            for (const k of lignes) garder(p[k]);
            if (vue('DettesNonImmo')) garder(detteSousZero(p));
            garder((p as { lockedNetWorth?: number }).lockedNetWorth);
        }
        if (vue('fire')) garder(fireNumber);
        const ticks = reperesRonds(valeurs);
        if (!ticks || valeurs.length === 0) return null;
        const bas = Math.min(0, ...valeurs, ticks[0]);
        const haut = Math.max(...valeurs, ticks[ticks.length - 1]);
        return { ticks, domaine: [bas, haut] as [number, number] };
    }, [chartSeries, hiddenSeries, fireNumber, modeCourbe]);

    const selectSeries = isDailyCurve ? daysInWindow : (zoom.visibleData as ProjectionChartPoint[]);

    const xAncre = isDailyCurve && todayAxisX !== null ? todayAxisX : todayMonthIndex;
    const idxAncre = useMemo(() => indexAujourdhui(selectSeries, xAncre), [selectSeries, xAncre]);
    const pointAncre = useMemo(() => {
        const brut = idxAncre === -1 ? null : selectSeries[idxAncre];
        return brut ? (enrichDailyPoint(brut) ?? brut) : null;
    }, [idxAncre, selectSeries, enrichDailyPoint]);

    const jourAffiche = useMemo(
        () => choisirJourAffiche(selection.mode, selection.point, pointAncre),
        [selection.mode, selection.point, pointAncre],
    );

    const [pasNavigation, setPasNavigation] = useState<PasNavigation>(PAS_PAR_DEFAUT);
    const idxAffiche = useMemo(() => {
        if (!jourAffiche) return -1;
        const x = jourAffiche.point.monthIndex;
        return selectSeries.findIndex((d) => d.monthIndex === x);
    }, [jourAffiche, selectSeries]);

    const bornesPas = useMemo(
        () => ({
            prev: idxAffiche !== -1 && indexApresPas(selectSeries, idxAffiche, -1, pasNavigation) !== -1,
            next: idxAffiche !== -1 && indexApresPas(selectSeries, idxAffiche, 1, pasNavigation) !== -1,
        }),
        [idxAffiche, selectSeries, pasNavigation],
    );

    const stepJour = useCallback(
        (dir: -1 | 1, pas: PasNavigation) => {
            if (idxAffiche === -1) return;
            const suivant = indexApresPas(selectSeries, idxAffiche, dir, pas);
            if (suivant === -1) return;
            const pt = selectSeries[suivant];
            selection.freezeOn(enrichDailyPoint(pt) ?? pt);
        },
        [idxAffiche, selectSeries, selection, enrichDailyPoint],
    );

    const focusMonthPointNow = useCallback(
        (monthIdx: number) => {
            const matchesMonth = (d: ProjectionChartPoint) =>
                (typeof d.hostMonthIndex === 'number'
                    ? Math.trunc(d.hostMonthIndex)
                    : Math.trunc(d.monthIndex)) === monthIdx;
            const target =
                selectSeries.find((d) => matchesMonth(d) && d.dayIsReal !== true) ??
                selectSeries.find(matchesMonth) ??
                (displayData as ProjectionChartPoint[]).find((d) => Math.trunc(d.monthIndex) === monthIdx);
            if (target) {
                selection.freezeOn(enrichDailyPoint(target) ?? target);
            }
        },
        [selectSeries, displayData, selection, enrichDailyPoint],
    );

    useEffect(() => {
        if (pendingFocusMonth === null) return;
        const target = pendingFocusMonth;
        setPendingFocusMonth(null);
        focusMonthPointNow(target);
    }, [pendingFocusMonth, selectSeries, focusMonthPointNow]);

    const handleSelectExplanationMonth = useCallback(
        (monthIdx: number) => {
            const lo = zoom.visibleData[0]?.monthIndex ?? Number.NEGATIVE_INFINITY;
            const hi = zoom.visibleData[zoom.visibleData.length - 1]?.monthIndex ?? Number.POSITIVE_INFINITY;
            if (zoom.isZoomed && (monthIdx < lo || monthIdx > hi)) {
                zoom.reset();
                setPendingFocusMonth(monthIdx);
            } else {
                focusMonthPointNow(monthIdx);
            }
            zoom.containerEl.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
        },
        [zoom, focusMonthPointNow],
    );

    const activeTurningPointHint = useMemo(() => {
        const pt = jourAffiche?.point;
        if (!pt || activeScenarioOutput.turningPoints.length === 0) return null;
        const ptMonth = typeof pt.hostMonthIndex === 'number' ? pt.hostMonthIndex : Math.trunc(pt.monthIndex);
        if (ptMonth < 0) return null;
        let best: DeepTurningPoint | null = null;
        let bestDist = Infinity;
        for (const tp of activeScenarioOutput.turningPoints) {
            const dist = Math.abs(tp.monthIndex - ptMonth);
            if (dist <= 6 && dist < bestDist) {
                best = tp;
                bestDist = dist;
            }
        }
        return best ? `${best.title} — ${best.summaryFr}` : null;
    }, [jourAffiche?.point, activeScenarioOutput.turningPoints]);

    const pointAnchorXRatio = useMemo(() => {
        const pt = jourAffiche?.point;
        if (!pt || chartSeries.length < 2) return hoverXRatio;
        const lo = chartSeries[0].monthIndex;
        const hi = chartSeries[chartSeries.length - 1].monthIndex;
        if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return hoverXRatio;
        return Math.max(0, Math.min(1, (pt.monthIndex - lo) / (hi - lo)));
    }, [jourAffiche?.point, chartSeries, hoverXRatio]);

    const resolvedAnchorXRatio =
        selection.mode === 'hovering' && hoverXRatio !== null ? hoverXRatio : pointAnchorXRatio;

    const computeAnchorRatioFromClientX = useCallback(
        (clientX: number): number | null => {
            const grid = zoom.containerEl.current?.querySelector('.recharts-cartesian-grid');
            const rect = grid?.getBoundingClientRect() ?? zoom.containerEl.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0) return null;
            return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        },
        [zoom.containerEl],
    );

    const ouvrirDetailSur = useCallback(
        (pt: ProjectionChartPoint | null | undefined) => {
            if (!pt) return;
            const p = pt as ProjectionChartPoint & { dayIso?: string; dayIsReal?: boolean };
            const cal = calendarFromMonthIndex(startYear, startMonth, Math.floor(p.monthIndex ?? 0));
            const moisIso = `${cal.year}-${String(cal.month + 1).padStart(2, '0')}`;
            setDetailMonthIso(moisIso <= todayIso.slice(0, 7) ? moisIso : null);
            setDetailDayIso(p.dayIsReal ? (p.dayIso ?? null) : null);
            setDetailAnchorIso(p.dayIso ?? null);
            setDetailPoint(detailPointFor(pt));
        },
        [startYear, startMonth, todayIso, detailPointFor],
    );

    const detailSeriesIdx = useMemo(
        () => resolveDaySeriesIndex(selectSeries, detailAnchorIso, detailPoint?.monthIndex),
        [detailAnchorIso, detailPoint, selectSeries],
    );

    const stepDetailDay = useCallback(
        (dir: -1 | 1) => {
            if (detailSeriesIdx === -1) return;
            const next = selectSeries[detailSeriesIdx + dir];
            if (next) ouvrirDetailSur(enrichDailyPoint(next) ?? next);
        },
        [detailSeriesIdx, selectSeries, enrichDailyPoint, ouvrirDetailSur],
    );

    const isInsideTooltip = (target: EventTarget | null): boolean =>
        Boolean(selection.panneauRef.current && target instanceof Node && selection.panneauRef.current.contains(target));

    const resoudrePointClientX = (clientX: number): ProjectionChartPoint | null => {
        const grid = zoom.containerEl.current?.querySelector('.recharts-cartesian-grid');
        const rect = grid?.getBoundingClientRect();
        const pt =
            resolvePointByX(
                clientX,
                rect ? { left: rect.left, width: rect.width } : null,
                selectSeries,
                (p) => p.monthIndex,
            ) ?? lastHoverPointRef.current;
        return pt ? (enrichDailyPoint(pt) ?? pt) : null;
    };

    const handleChartContainerClick = (e: React.PointerEvent<HTMLDivElement>) => {
        const down = pointerDownPosRef.current;
        pointerDownPosRef.current = null;
        dragStartPointRef.current = null;
        if (zoom.isPinchActive()) return;
        if (isInsideTooltip(e.target)) return;
        if (e.pointerType === 'touch' && !modeComparaison) {
            if (down && Math.abs(e.clientY - down.y) > 24) return;
        } else {
            const driftTol = selectSeries.length <= 190 ? 14 : 6;
            if (down && (Math.abs(e.clientX - down.x) > driftTol || Math.abs(e.clientY - down.y) > driftTol)) return;
        }
        if ((e.target as Element | null)?.closest?.('button, a, [role="button"]')) return;
        const complet = resoudrePointClientX(e.clientX);
        if (complet) {
            if (comparaisonPoints.a && comparaisonPoints.b) {
                setComparaisonPoints({ a: null, b: null });
            }
            const ratio = computeAnchorRatioFromClientX(e.clientX);
            if (ratio !== null) setHoverXRatio(ratio);
            selection.freezeOn(complet);
        }
    };

    const figerAuClavier = useCallback(() => {
        if (selectSeries.length === 0) return;
        const point = pointAncre ?? selectSeries[selectSeries.length - 1];
        if (point) selection.freezeOn(enrichDailyPoint(point) ?? point, { parClavier: true });
    }, [pointAncre, selectSeries, selection, enrichDailyPoint]);

    const handleChartKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (e.target !== e.currentTarget) return;
        if (!estGesteSelectionJourClavier(e.key)) return;
        e.preventDefault();
        figerAuClavier();
    };

    if (!budgetItems || !projection || !config || !initialBalances) {
        logError({
            source: 'ui',
            severity: 'error',
            message: 'FutureProjection : données d’initialisation critiques manquantes',
            context: {
                hasBudget: !!budgetItems,
                hasProjection: !!projection,
                hasConfig: !!config,
                hasBalances: !!initialBalances,
            },
        });
        return (
            <div className="p-8 text-center text-erreur-texte font-bold bg-surface/50 rounded-2xl border border-erreur-texte/20">
                Données d&apos;initialisation manquantes. Veuillez vérifier vos comptes et votre budget.
            </div>
        );
    }

    if (hasError) {
        return (
            <div className="p-8 text-center bg-surface/50 rounded-2xl border border-erreur-texte/20 space-y-2">
                <div className="text-2xl" aria-hidden="true">⚠</div>
                <div className="text-erreur-texte font-bold">
                    {projectionRefus ? 'Donnée illisible' : 'Le calcul de la projection a échoué.'}
                </div>
                <div className="text-sm text-texte-doux max-w-md mx-auto">
                    {projectionRefus ?? (
                        <>
                            Vérifie tes paramètres (revenus, dépenses, comptes, objectifs). L&apos;erreur a été
                            journalisée.{runMC ? ' Tu peux aussi désactiver le mode Monte-Carlo et réessayer.' : ''}
                        </>
                    )}
                </div>
            </div>
        );
    }

    const visMinMonth = zoom.visibleData[0]?.monthIndex ?? Number.NEGATIVE_INFINITY;
    const visMaxMonth = zoom.visibleData[zoom.visibleData.length - 1]?.monthIndex ?? Number.POSITIVE_INFINITY;
    const visibleLifeEvents = lifeChartEvents.filter((e) => e.monthIndex >= visMinMonth && e.monthIndex <= visMaxMonth);
    const visibleFlowEvents = flowChartEvents.filter((e) => e.monthIndex >= visMinMonth && e.monthIndex <= visMaxMonth);
    const thinEvents = sampleEvenly;
    const MAX_LIFE_ICONS = 24;
    const MAX_FLOW_ICONS = 16;
    const shownLifeEvents = assignStackIndex([
        ...thinEvents(visibleLifeEvents.filter((e) => !e.pinned), MAX_LIFE_ICONS),
        ...visibleLifeEvents.filter((e) => e.pinned),
    ]);
    const shownFlowEvents = assignStackIndex(thinEvents(visibleFlowEvents, MAX_FLOW_ICONS));
    const lastMonthIndex = chartData.length > 0 ? chartData[chartData.length - 1].monthIndex : 0;

    const idxForYears = (yrs: number) => {
        const i = (displayData as ProjectionChartPoint[]).findIndex((d) => d.monthIndex >= yrs * 12);
        return i === -1 ? displayData.length - 1 : i;
    };
    const todayArrayIndex = (() => {
        const i = (displayData as ProjectionChartPoint[]).findIndex((d) => d.monthIndex >= todayMonthIndex);
        return i === -1 ? displayData.length - 1 : i;
    })();
    const todayPresetRange = centeredWindowRange(displayData.length, todayArrayIndex, 7);
    const since2025PresetRange: [number, number] | null = (() => {
        const idx2025 = (displayData as ProjectionChartPoint[]).findIndex(
            (d) => calendarFromMonthIndex(startYear, startMonth, d.monthIndex).year >= 2025,
        );
        if (idx2025 < 0 || idx2025 >= todayArrayIndex) return null;
        const idx3Y = (displayData as ProjectionChartPoint[]).findIndex((d) => d.monthIndex >= 3 * 12);
        const endIdx =
            idx3Y === -1
                ? displayData.length - 1
                : Math.min(displayData.length - 1, Math.max(todayArrayIndex + 12, idx3Y));
        return endIdx > idx2025 ? [idx2025, endIdx] : null;
    })();

    const finScenarioP50 = activeScenarioOutput.milestones.finalNetWorthP50;
    const resultsScenarioPatrimoine =
        typeof finScenarioP50 === 'number' && Number.isFinite(finScenarioP50)
            ? {
                  finalNetWorth: finScenarioP50,
                  estateNetWorth: activeScenarioOutput.milestones.estateNetWorthP50 ?? results?.estateNetWorth,
                  fireNumber,
              }
            : results;
    const patrimoineKpi = kpiPatrimoine(resultsScenarioPatrimoine, isPrivacyMode);
    const libelleMC = mcSublabel(runMC, results?.mcIterationsRun);
    const anneeDe = (monthIndex: number) => calendarFromMonthIndex(startYear, startMonth, monthIndex).year;
    const dernierPoint = chartData.length > 0 ? (chartData[chartData.length - 1] as ProjectionChartPoint) : null;
    const anneesHorizon = dernierPoint
        ? Math.max(0, Math.round((dernierPoint.monthIndex - todayMonthIndex) / 12))
        : null;
    const naviguerVers = (tab: Tab) => useFinanceStore.getState().setActiveTab(tab);

    const cellCourbe =
        'touch-target min-h-11 gf-quote-cell inline-flex items-center gap-2 rounded-xl border border-bordure hover:border-repere bg-surface-douce px-3 py-1.5 text-tiny cursor-pointer transition-colors focus-ring shrink-0';
    const statsCourbe = (
        <div className="flex items-center gap-2 shrink-0">
            <button
                type="button"
                title="Objectif FIRE — Ouvrir Placements"
                onClick={() => naviguerVers(Tab.INVESTMENTS)}
                onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                className={cellCourbe}
            >
                <span className="text-texte-doux font-medium">Objectif FIRE</span>
                <PrivateAmount className="font-mono font-bold text-texte">{formatCompactCAD(fireNumber)}</PrivateAmount>
                {jalonFire?.year != null && (
                    <span className="px-1.5 py-0.5 rounded-full font-mono font-semibold gf-delta-amber">
                        · <PrivateAmount>{jalonFire.year}</PrivateAmount>
                    </span>
                )}
                <span className="text-repere font-semibold" aria-hidden="true">↗</span>
            </button>
            <button
                type="button"
                title={patrimoineKpi.tooltip}
                onClick={() => naviguerVers(Tab.INVESTMENTS)}
                onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                className={cellCourbe}
            >
                {/* NOMBRE-NON-MONETAIRE : horizon = espérance de vie configurée */}
                <span className="text-texte-doux font-medium" title={`Jusqu'à ${esperanceDeVieEffective(retirementGoal)} ans`}>
                    À l&apos;horizon{anneesHorizon != null ? ` (${anneesHorizon} ans)` : ''}
                </span>
                <span className="px-1.5 py-0.5 rounded-full font-mono font-bold gf-delta-up">
                    <PrivateAmount>{patrimoineKpi.value}</PrivateAmount>
                </span>
                <span className="text-repere font-semibold" aria-hidden="true">↗</span>
            </button>
        </div>
    );

    const insolvencyBadge = insolvency ? (
        <div role="status">
            <Badge variant="danger" size="md">
                {insolvency.age != null ? (
                    <>Plan insoutenable — capital épuisé vers <PrivateAmount>{insolvency.age}</PrivateAmount> ans</>
                ) : (
                    'Plan insoutenable — capital épuisé'
                )}
            </Badge>
        </div>
    ) : undefined;

    const actionsCourbe = (
        <div className="flex items-center gap-1.5 shrink-0">
            <button
                type="button"
                onClick={() => setTiroirOuvert('hypotheses')}
                aria-haspopup="dialog"
                aria-expanded={tiroirOuvert === 'hypotheses'}
                aria-controls={tiroirDomId('hypotheses')}
                className="touch-target min-h-11 px-3 rounded-lg text-[13px] font-semibold text-texte-doux hover:text-texte hover:bg-surface-douce border border-bordure transition-colors focus-ring"
                title="Modifier les hypothèses de simulation"
            >
                <span aria-hidden="true">⚙</span> <span className="max-lg:sr-only">Hypothèses</span>
            </button>
            <button
                type="button"
                onClick={() => setAnatomyOpen(true)}
                className="touch-target min-h-11 px-3 rounded-lg text-[13px] font-semibold text-texte-doux hover:text-texte hover:bg-surface-douce border border-bordure transition-colors focus-ring"
                title="Anatomie détaillée d'une année"
            >
                <span aria-hidden="true">📋</span> <span className="max-lg:sr-only">Anatomie</span>
            </button>
            <button
                type="button"
                onClick={() => setTiroirOuvert('historique')}
                aria-haspopup="dialog"
                aria-expanded={tiroirOuvert === 'historique'}
                aria-controls={tiroirDomId('historique')}
                className="touch-target min-h-11 px-3 rounded-lg text-[13px] font-semibold text-texte-doux hover:text-texte hover:bg-surface-douce border border-bordure transition-colors focus-ring"
                title="Historique passé par compte"
            >
                <span aria-hidden="true">📊</span> <span className="max-lg:sr-only">Historique</span>
            </button>
            {isProjectionLocked ? (
                <button
                    type="button"
                    onClick={unlockProjection}
                    className="touch-target min-h-11 min-w-11 lg:min-w-0 px-3 rounded-lg text-[13px] font-semibold text-alerte-texte hover:text-texte bg-alerte-fond hover:bg-surface-douce border border-alerte-texte/30 transition-colors focus-ring"
                    title="Déverrouiller : revenir à la courbe live seule"
                >
                    <span aria-hidden="true">🔓</span> <span className="max-lg:sr-only">Déverrouiller</span>
                </button>
            ) : (
                <button
                    type="button"
                    onClick={() => { if (results) lockProjection(results); }}
                    disabled={!results || isComputing}
                    className="touch-target min-h-11 min-w-11 lg:min-w-0 px-3 rounded-lg text-[13px] text-texte-doux hover:text-texte hover:bg-surface-douce border border-bordure transition-colors focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Verrouiller cette courbe comme référence (persistée jusqu'au déverrouillage)"
                >
                    <span aria-hidden="true">🔒</span> <span className="max-lg:sr-only">Verrouiller</span>
                </button>
            )}
            {!etroit && (
                <button
                    type="button"
                    onClick={() => zoom.containerEl.current?.requestFullscreen?.()}
                    className="touch-target sr-only min-h-11"
                    title="Plein écran (Échap pour quitter)"
                >
                    Plein écran
                </button>
            )}
        </div>
    );

    return (
        <div className="space-y-4 lg:space-y-6 pb-24">
            <PageHeader
                title="Projection"
                badge={insolvencyBadge}
                actions={
                    <span className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => useFinanceStore.getState().navigateWithFocus(Tab.INVESTMENTS, 'tab:intelligence')}
                            onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                            className="touch-target min-h-11 px-3 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-semibold text-texte inline-flex items-center gap-1.5 whitespace-nowrap focus-ring"
                        >
                            <Icon name="sparkles" size={14} aria-hidden="true" />
                            <span>Quant IA</span>
                        </button>
                        <FutureHealthSummary />
                    </span>
                }
            />

            {bandeauKpi?.(etroit ? 'mobile-tete' : 'bureau')}

            {curveRestoring && (
                <section className="gf-terminal-card rounded-2xl bg-surface border border-bordure text-center">
                    <div className="py-10 flex flex-col items-center gap-3 text-texte-doux" role="status" aria-live="polite">
                        <svg className="animate-spin h-8 w-8 text-alerte-texte" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="40" strokeDashoffset="20" opacity="0.5" />
                        </svg>
                        <span className="text-meta">Ta projection se recharge…</span>
                    </div>
                </section>
            )}

            {!curveVisible && !curveRestoring && (
                <div className="space-y-4">
                    {!reqsMet ? (
                        <section aria-label="Données requises pour la projection" className="gf-terminal-card rounded-2xl bg-surface border border-bordure p-5 space-y-3">
                            <div className="space-y-1">
                                <h2 className="text-base font-bold text-texte">Complète ton dossier pour calculer ta trajectoire</h2>
                                <p className="text-meta text-texte-doux">
                                    Aucune projection fictive n&apos;est affichée tant que ces données de base manquent :
                                </p>
                            </div>
                            <ul className="flex flex-wrap gap-2 text-xs text-texte">
                                {FUTURE_REQ_IDS.filter((id) => !REQUIREMENTS[id].isMet(useFinanceStore.getState())).map((id) => (
                                    <li key={id} className="px-2.5 py-1 rounded-full bg-surface-douce border border-bordure font-medium">
                                        {REQUIREMENTS[id].label}
                                    </li>
                                ))}
                            </ul>
                            <div className="flex flex-wrap gap-2 pt-1">
                                <button
                                    type="button"
                                    onClick={() => naviguerVers(Tab.PROFILE)}
                                    className="touch-target min-h-11 px-4 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-xs font-semibold focus-ring"
                                >
                                    Compléter Profil &amp; Retraite
                                </button>
                                <button
                                    type="button"
                                    onClick={() => naviguerVers(Tab.INVESTMENTS)}
                                    className="touch-target min-h-11 px-4 py-2 rounded-xl border border-bordure-champ bg-fond hover:bg-surface-douce text-texte text-xs font-semibold focus-ring"
                                >
                                    Ajouter mes Placements
                                </button>
                            </div>
                        </section>
                    ) : (
                        <section aria-label="Projection en attente" className="gf-terminal-card rounded-2xl bg-surface border border-bordure p-6 text-center space-y-2">
                            <h2 className="text-base font-bold text-texte">Aucune projection calculée pour l&apos;instant</h2>
                            <p className="text-meta text-texte-doux">
                                Vérifie tes paramètres de profil ou ouvre les hypothèses pour ajuster ta simulation.
                            </p>
                            <div className="pt-2">
                                <button
                                    type="button"
                                    onClick={() => setTiroirOuvert('hypotheses')}
                                    className="touch-target min-h-11 px-4 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-xs font-semibold focus-ring"
                                >
                                    Modifier les hypothèses
                                </button>
                            </div>
                        </section>
                    )}
                </div>
            )}

            {curveVisible && (
                <div ref={revealedRef} tabIndex={-1} className="outline-hidden space-y-4 lg:space-y-6" role="region" aria-label="Projection affichée">
                    {alerteObjectifs && (
                        <div className="flex flex-wrap items-center gap-3 rounded-card border border-alerte-texte/40 bg-alerte-fond px-4 py-2.5">
                            <span aria-hidden="true">🎯</span>
                            <span className="text-meta text-texte font-bold">{alerteObjectifs.libelle}</span>
                            <span className="text-tiny text-texte-doux">
                                Il a manqué <PrivateAmount>{formatCAD(alerteObjectifs.montant)}</PrivateAmount> au
                                fil de la projection — avance la date de l&apos;objectif, réduis son montant ou
                                libère de l&apos;épargne.
                            </span>
                        </div>
                    )}

                    {/* Bloc 1 : 4 scénarios uniques + mémoire + barre de calcul profond */}
                    <FutureScenarioHeader
                        report={deepForecast.activeReport}
                        appliedReport={deepForecast.appliedReport}
                        pendingReport={deepForecast.pendingReport}
                        selectedScenario={deepForecast.selectedScenario}
                        onSelectScenario={deepForecast.setSelectedScenario}
                        status={deepForecast.status}
                        isApplying={deepForecast.isApplying}
                        progress={deepForecast.progress}
                        error={deepForecast.error}
                        unreadableStorage={deepForecast.unreadableStorage}
                        isOutdated={deepForecast.isOutdated}
                        hasPendingToApply={deepForecast.hasPendingToApply}
                        refusMessage={deepForecast.refusMessage}
                        onLaunch={() => { void deepForecast.launchDeepForecast(); }}
                        onCancel={deepForecast.cancelDeepForecast}
                        onApplyPending={() => { void deepForecast.applyPendingReport(); }}
                        onDiscardPending={deepForecast.discardPendingReport}
                    />

                    {/* Bloc 2 : Carte graphique épurée + ruban [P10, P90] unique + FutureRichTooltip */}
                    <section aria-labelledby="courbe-vie-titre" className="gf-terminal-card rounded-2xl bg-surface border border-bordure px-3 py-3.5 sm:px-5 sm:py-4 lg:px-6 lg:pt-5 lg:pb-6 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-bordure-champ bg-surface-douce px-3 py-1 text-tiny font-bold text-texte">
                                <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                                Scénario affiché : {activeScenarioOutput.label}
                            </span>
                            <button
                                type="button"
                                data-testid="futur-toggle-mc"
                                aria-pressed={isVisible('montecarlo')}
                                onClick={() => toggleSeries('montecarlo')}
                                title={isVisible('montecarlo') ? 'Masquer la zone d’incertitude' : 'Afficher la zone d’incertitude'}
                                className={`touch-target min-h-11 inline-flex flex-wrap items-center gap-2 rounded-full border px-3 py-1 text-tiny transition-colors focus-ring ${
                                    isVisible('montecarlo')
                                        ? 'border-bordure-champ bg-surface-douce text-texte'
                                        : 'border-bordure bg-fond text-texte-doux'
                                }`}
                            >
                                <span className="inline-flex items-center gap-1" aria-hidden="true">
                                    <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: couleurSerie('montecarlo') }} />
                                    <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: 'var(--gf-rouge)' }} />
                                </span>
                                <span className="font-semibold">
                                    {deepForecast.activeReport.isDeepRun ? 'Fourchette possible approfondie' : 'Fourchette possible estimée'}
                                </span>
                                <span className="text-texte-doux">
                                    Favorable · Central · Prudent
                                    {deepForecast.activeReport.pastDiagnostic.pastCurveCalibration?.hasUsableCurve
                                        ? ' · calibrée depuis janv. 2025'
                                        : ''}
                                </span>
                            </button>
                        </div>

                        <GoogleFinanceHero
                            jourAffiche={jourAffiche?.point ?? null}
                            pointAncre={pointAncre}
                            estFige={selection.mode === 'frozen'}
                            onLibererJour={selection.release}
                            isZoomed={zoom.isZoomed}
                            onResetZoom={zoom.reset}
                            onFocusToday={() => {
                                if (todayPresetRange) {
                                    zoom.showRange(todayPresetRange[0], todayPresetRange[1]);
                                } else {
                                    zoom.reset();
                                }
                            }}
                            onOpenConnections={() => setShowConnexionsModal(true)}
                        />
                        <h2 id="courbe-vie-titre" className="sr-only">La courbe de vie</h2>

                        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-2 border-b border-bordure">
                            <div className="flex items-center gap-2 min-w-max">
                                <FutureCurveToolbar
                                    modeCourbe={modeCourbe}
                                    onChangeModeCourbe={setModeCourbe}
                                    modeComparaison={modeComparaison}
                                    onToggleComparaison={() => setModeComparaison((v) => !v)}
                                    pointComparaisonA={comparaisonPoints.a}
                                    pointComparaisonB={comparaisonPoints.b}
                                    onClearComparaison={() => setComparaisonPoints({ a: null, b: null })}
                                    mcLabel={libelleMC}
                                />
                                {statsCourbe}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                                {isComputing && (
                                    <span className="flex items-center gap-1.5 text-tiny text-alerte-texte" role="status" aria-live="polite">
                                        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="40" strokeDashoffset="20" opacity="0.5" />
                                        </svg>
                                        <span className="sr-only">Recalcul en cours…</span>
                                    </span>
                                )}
                                <FuturePeriodSelector
                                    variant={etroit ? 'compact' : 'buttons'}
                                    zoom={zoom}
                                    todayPresetRange={todayPresetRange}
                                    since2025PresetRange={since2025PresetRange}
                                    idxForYears={idxForYears}
                                    lastMonthIndex={lastMonthIndex}
                                    onFullscreen={() => zoom.containerEl.current?.requestFullscreen?.()}
                                />
                                {actionsCourbe}
                            </div>
                        </div>

                        {pastPrefixPoints.length > 0 && (
                            <div className="sr-only">
                                <span>
                                    Patrimoine net réel{pastHistory.firstDate ? ` depuis ${pastHistory.firstDate.slice(0, 7)}` : ''}
                                    {mentionDettes ? ` · ${mentionDettes}` : ''}
                                    {hasForeignHoldings ? ' · titres étrangers au change du jour' : ''}
                                    {pastHistory.isLoading ? ' · chargement des prix…' : (pastHistory.coverage < 0.99 ? ' · partiellement estimé aux prix actuels' : '')}
                                </span>
                            </div>
                        )}
                        {lockedByMonth && (
                            <div className="text-tiny text-texte-doux flex items-center gap-1.5 flex-wrap">
                                <span aria-hidden="true" className="inline-block w-5 border-t-2 border-dashed border-repere" />
                                <span className="px-1.5 py-0.5 rounded-full font-mono font-semibold gf-delta-neutral">Courbe verrouillée</span>
                            </div>
                        )}
                        <ForecastAccuracyBadge accuracy={forecastAccuracy} />

                        <div
                            ref={zoom.containerRef}
                            onDoubleClick={(e) => {
                                if (isInsideTooltip(e.target)) return;
                                zoom.handlers.onDoubleClick();
                            }}
                            onPointerDownCapture={(e) => {
                                if (isInsideTooltip(e.target)) return;
                                pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
                                if ((e.target as Element | null)?.closest?.('button, a, [role="button"]')) {
                                    dragStartPointRef.current = null;
                                    return;
                                }
                                const ratio = computeAnchorRatioFromClientX(e.clientX);
                                if (ratio !== null) setHoverXRatio(ratio);
                                const pt = resoudrePointClientX(e.clientX);
                                if (e.pointerType === 'touch' && !modeComparaison) {
                                    dragStartPointRef.current = null;
                                    if (pt) {
                                        lastHoverPointRef.current = pt;
                                        selection.onHoverPoint(pt);
                                    }
                                    return;
                                }
                                dragStartPointRef.current = pt;
                            }}
                            onPointerMove={(e) => {
                                if (zoom.isPinchActive() || isInsideTooltip(e.target)) return;
                                if (selection.mode !== 'frozen') {
                                    const ratio = computeAnchorRatioFromClientX(e.clientX);
                                    if (ratio !== null) setHoverXRatio(ratio);
                                }
                                if (e.pointerType === 'touch' && !modeComparaison) {
                                    const down = pointerDownPosRef.current;
                                    if (down && Math.abs(e.clientY - down.y) > Math.abs(e.clientX - down.x) && Math.abs(e.clientY - down.y) > 18) {
                                        return;
                                    }
                                    const currentPt = resoudrePointClientX(e.clientX);
                                    if (currentPt) {
                                        lastHoverPointRef.current = currentPt;
                                        selection.onHoverPoint(currentPt);
                                    }
                                    return;
                                }
                                const down = pointerDownPosRef.current;
                                const startPt = dragStartPointRef.current;
                                if (!down || !startPt) {
                                    if (selection.mode !== 'frozen') {
                                        const grid = zoom.containerEl.current?.querySelector('.recharts-cartesian-grid');
                                        const rect = grid?.getBoundingClientRect();
                                        const inGrid =
                                            !rect ||
                                            (e.clientX >= rect.left &&
                                                e.clientX <= rect.right &&
                                                e.clientY >= rect.top &&
                                                e.clientY <= rect.bottom);
                                        if (inGrid) {
                                            const currentPt = resoudrePointClientX(e.clientX);
                                            if (currentPt) {
                                                lastHoverPointRef.current = currentPt;
                                                selection.onHoverPoint(currentPt);
                                            }
                                        }
                                    }
                                    return;
                                }
                                if (Math.abs(e.clientX - down.x) > 10) {
                                    const currentPt = resoudrePointClientX(e.clientX);
                                    if (currentPt && currentPt.monthIndex !== startPt.monthIndex) {
                                        setComparaisonPoints({ a: startPt, b: currentPt });
                                    }
                                }
                            }}
                            onPointerUp={handleChartContainerClick}
                            onPointerLeave={() => {
                                pointerDownPosRef.current = null;
                                dragStartPointRef.current = null;
                                selection.onChartLeave();
                            }}
                            tabIndex={0}
                            onKeyDown={handleChartKeyDown}
                            className="chart-fullscreen relative w-full select-none focus-ring rounded-lg cursor-crosshair gf-chart-enter"
                            role="group"
                            aria-roledescription="graphique"
                            aria-label="Courbe de vie — évolution projetée du patrimoine net et de chaque compte dans le temps. Le détail du jour visé est affiché dans l'infobulle sur la courbe ; les mêmes données sont aussi lisibles sous forme de tableau et de liste de jalons. À la souris : survol = aperçu, clic = épingle l'infobulle, glisser = comparer deux dates, molette = zoom. Au clavier : Entrée ou flèches = épingle le jour d'aujourd'hui, Échap = relâche."
                        >
                            <div className="w-full h-[280px] min-h-[260px] sm:h-[500px] sm:min-h-0 lg:h-[650px]">
                                {isComputing ? (
                                    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-texte-doux" role="status" aria-live="polite">
                                        <svg className="animate-spin h-8 w-8 text-alerte-texte" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="40" strokeDashoffset="20" opacity="0.5" />
                                        </svg>
                                        <span className="text-meta">Calcul de ta projection…</span>
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ComposedChart
                                            data={chartSeriesWithRibbon}
                                            margin={{ top: etroit ? 26 : 34, right: 2, left: 2, bottom: 4 }}
                                            onMouseMove={((s: { activePayload?: Array<{ payload: ProjectionChartPoint }> }) => {
                                                // [DETTE-CAST-DAILYCURVE] Cast borné à 2 occurrences (handlers recharts v3).
                                                const p = s?.activePayload?.[0]?.payload;
                                                if (p) {
                                                    const full = enrichDailyPoint(p) ?? p;
                                                    lastHoverPointRef.current = full;
                                                    selection.onHoverPoint(full);
                                                }
                                            }) as unknown as (nextState: unknown, event: unknown) => void}
                                            onMouseLeave={(() => selection.onChartLeave()) as unknown as () => void}
                                        >
                                            <defs>
                                                <linearGradient id="gfNetWorthGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={couleurSerie('NetWorth')} stopOpacity={0.14} />
                                                    <stop offset="100%" stopColor={couleurSerie('NetWorth')} stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="gfConfidenceRibbonGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={couleurSerie('montecarlo')} stopOpacity={0.28} />
                                                    <stop offset="100%" stopColor={couleurSerie('montecarlo')} stopOpacity={0.09} />
                                                </linearGradient>
                                                <linearGradient id="gfConfidenceCoreGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={couleurSerie('montecarlo')} stopOpacity={0.42} />
                                                    <stop offset="100%" stopColor={couleurSerie('montecarlo')} stopOpacity={0.18} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid stroke="var(--bordure)" strokeOpacity={0.6} vertical={false} />

                                            <XAxis
                                                dataKey="monthIndex"
                                                type="number"
                                                domain={X_AXIS_DOMAIN}
                                                stroke="var(--texte-doux)"
                                                axisLine={false}
                                                tickLine={false}
                                                tick={{ fontSize: etroit ? 10 : 11, fill: 'var(--texte-doux)', fontFamily: 'var(--font-mono, monospace)' }}
                                                minTickGap={etroit ? 32 : 50}
                                                tickFormatter={(val: number) => {
                                                    const year =
                                                        monthIndexToYear.get(val) ??
                                                        calendarFromMonthIndex(startYear, startMonth, Math.floor(val)).year;
                                                    return `${year}`;
                                                }}
                                            />

                                            <YAxis
                                                orientation="right"
                                                mirror
                                                domain={echelleY?.domaine ?? ['auto', 'auto']}
                                                ticks={echelleY?.ticks}
                                                tickCount={4}
                                                axisLine={false}
                                                tickLine={false}
                                                width={etroit ? 46 : 64}
                                                tick={{ fontSize: etroit ? 10 : 11, fill: 'var(--texte-doux)', fontFamily: 'var(--font-mono, monospace)' }}
                                                tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v, { repere: true }))}
                                            />

                                            {pastPrefixPoints.length > 0 && (
                                                <ReferenceArea
                                                    x1={isDailyCurve && dailyAll.length > 0 ? Math.max(pastStartIndex, dailyAll[0].monthIndex) : pastStartIndex}
                                                    x2={isDailyCurve && todayAxisX !== null ? todayAxisX : 0}
                                                    fill="var(--repere)"
                                                    fillOpacity={0.05}
                                                    stroke="none"
                                                />
                                            )}
                                            {comparaisonPoints.a && comparaisonPoints.b && (
                                                <ReferenceArea
                                                    x1={Math.min(comparaisonPoints.a.monthIndex, comparaisonPoints.b.monthIndex)}
                                                    x2={Math.max(comparaisonPoints.a.monthIndex, comparaisonPoints.b.monthIndex)}
                                                    fill="var(--succes-texte)"
                                                    fillOpacity={0.14}
                                                    stroke="var(--succes-texte)"
                                                    strokeOpacity={0.45}
                                                />
                                            )}
                                            {comparaisonPoints.a && (
                                                <ReferenceLine
                                                    x={comparaisonPoints.a.monthIndex}
                                                    stroke="var(--repere)"
                                                    strokeWidth={1.5}
                                                    strokeDasharray="3 3"
                                                    label={<RefLineLabel value="Point A" color="var(--repere)" />}
                                                />
                                            )}
                                            {comparaisonPoints.b && (
                                                <ReferenceLine
                                                    x={comparaisonPoints.b.monthIndex}
                                                    stroke="var(--succes-texte)"
                                                    strokeWidth={1.5}
                                                    strokeDasharray="3 3"
                                                    label={<RefLineLabel value="Point B" color="var(--succes-texte)" />}
                                                />
                                            )}
                                            {pastPrefixPoints.length > 0 && !isDailyCurve && (
                                                <ReferenceLine
                                                    x={0}
                                                    stroke="var(--repere)"
                                                    strokeOpacity={0.5}
                                                    strokeDasharray="3 3"
                                                    label={<RefLineLabel value="Passé réel ⟵" color="var(--repere)" />}
                                                />
                                            )}
                                            <ReferenceLine y={0} stroke="var(--bordure-champ)" strokeOpacity={0.45} strokeWidth={1} />
                                            {isVisible('aujourdhui') && (
                                                <ReferenceLine
                                                    x={isDailyCurve && todayAxisX !== null ? todayAxisX : todayMonthIndex}
                                                    stroke="var(--texte)"
                                                    strokeOpacity={0.55}
                                                    strokeDasharray="5 5"
                                                    label={<RefLineLabel value="Aujourd'hui" color="var(--texte)" />}
                                                />
                                            )}

                                            <Tooltip content={() => null} cursor={GF_CROSSHAIR_CURSOR} isAnimationActive={false} />

                                            {isVisible('fire') && (
                                                <ReferenceLine y={fireNumber} stroke={couleurSerie('fire')} strokeOpacity={0.8} strokeDasharray="5 5" />
                                            )}
                                            {isVisible('fire') && jalonFire && (
                                                <ReferenceLine
                                                    x={jalonFire.x ?? jalonFire.monthIndex}
                                                    stroke={couleurSerie('fire')}
                                                    strokeOpacity={0.45}
                                                    strokeDasharray="2 4"
                                                    label={<RefLineLabel value={libelleJalonFire} color={couleurSerie('fire')} jalon />}
                                                />
                                            )}

                                            {isVisible('events') &&
                                                lifeMarkers.map((mk, i) => (
                                                    <ReferenceLine
                                                        key={`lifemark-${i}`}
                                                        x={mk.monthIndex}
                                                        stroke={mk.color}
                                                        strokeOpacity={0.5}
                                                        strokeDasharray="2 4"
                                                        label={etroit && mk.jalon ? undefined : <RefLineLabel value={mk.label} color={mk.color} jalon={mk.jalon} />}
                                                    />
                                                ))}

                                            {modeCourbe === 'empilee' && (
                                                <>
                                                    {isVisible('Liquidites') && <Area type="monotone" dataKey="Liquidites" stackId="1" stroke={couleurSerie('Liquidites')} strokeWidth={1.3} fill={couleurSerie('Liquidites')} fillOpacity={0.26} name="Cash" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('CELI') && <Area type="monotone" dataKey="CELI" stackId="1" stroke={couleurSerie('CELI')} strokeWidth={1.3} fill={couleurSerie('CELI')} fillOpacity={0.28} name="CELI" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('CELIAPP') && <Area type="monotone" dataKey="CELIAPP" stackId="1" stroke={couleurSerie('CELIAPP')} strokeWidth={1.3} fill={couleurSerie('CELIAPP')} fillOpacity={0.28} name="CELIAPP" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('REER') && <Area type="monotone" dataKey="REER" stackId="1" stroke={couleurSerie('REER')} strokeWidth={1.3} fill={couleurSerie('REER')} fillOpacity={0.28} name="REER" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('REEE') && <Area type="monotone" dataKey="REEE" stackId="1" stroke={couleurSerie('REEE')} strokeWidth={1.3} fill={couleurSerie('REEE')} fillOpacity={0.28} name="REEE" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('NonReg') && <Area type="monotone" dataKey="NonReg" stackId="1" stroke={couleurSerie('NonReg')} strokeWidth={1.3} fill={couleurSerie('NonReg')} fillOpacity={0.28} name="Non-enregistré" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('Crypto') && <Area type="monotone" dataKey="Crypto" stackId="1" stroke={couleurSerie('Crypto')} strokeWidth={1.3} fill={couleurSerie('Crypto')} fillOpacity={0.28} name="Crypto" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('Immobilier') && <Area type="monotone" dataKey="Immobilier" stackId="1" stroke={couleurSerie('Immobilier')} strokeWidth={1.25} fill={couleurSerie('Immobilier')} fillOpacity={0.2} name="Équité immo" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                    {isVisible('Entreprise') && <Area type="monotone" dataKey="Entreprise" stackId="1" stroke={couleurSerie('Entreprise')} strokeWidth={1.25} fill={couleurSerie('Entreprise')} fillOpacity={0.2} name="Entreprise" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />}
                                                </>
                                            )}

                                            {modeCourbe === 'nette' && (
                                                <>
                                                    {isVisible('montecarlo') && (
                                                        <>
                                                            <Area
                                                                type="monotone"
                                                                dataKey="mcRange"
                                                                stroke="none"
                                                                fill="url(#gfConfidenceRibbonGrad)"
                                                                fillOpacity={1}
                                                                connectNulls={false}
                                                                dot={false}
                                                                activeDot={false}
                                                                name="Fourchette possible"
                                                                isAnimationActive={!zoom.isPanning}
                                                                animationDuration={280}
                                                            />
                                                            <Area
                                                                type="monotone"
                                                                dataKey="mcCoreRange"
                                                                stroke="none"
                                                                fill="url(#gfConfidenceCoreGrad)"
                                                                fillOpacity={1}
                                                                connectNulls={false}
                                                                dot={false}
                                                                activeDot={false}
                                                                name="Zone la plus probable (1 chance sur 2)"
                                                                isAnimationActive={!zoom.isPanning}
                                                                animationDuration={280}
                                                            />
                                                        </>
                                                    )}
                                                    <Area
                                                        type="monotone"
                                                        dataKey="NetWorth"
                                                        stroke={couleurSerie('NetWorth')}
                                                        strokeWidth={2.5}
                                                        fill="url(#gfNetWorthGrad)"
                                                        fillOpacity={1}
                                                        dot={false}
                                                        activeDot={GF_ACTIVE_DOT}
                                                        name="Valeur Nette Totale"
                                                        isAnimationActive={!zoom.isPanning}
                                                        animationDuration={300}
                                                        animationEasing="ease-out"
                                                    />
                                                    {isVisible('montecarlo') && (
                                                        <>
                                                            <Line
                                                                type="monotone"
                                                                dataKey="P90"
                                                                stroke={couleurSerie('montecarlo')}
                                                                strokeWidth={1.85}
                                                                strokeDasharray="5 4"
                                                                strokeOpacity={0.95}
                                                                connectNulls={false}
                                                                dot={false}
                                                                activeDot={false}
                                                                name="Scénario favorable"
                                                                isAnimationActive={!zoom.isPanning}
                                                                animationDuration={280}
                                                            />
                                                            <Line
                                                                type="monotone"
                                                                dataKey="P10"
                                                                stroke="var(--gf-rouge)"
                                                                strokeWidth={1.85}
                                                                strokeDasharray="5 4"
                                                                strokeOpacity={0.9}
                                                                connectNulls={false}
                                                                dot={false}
                                                                activeDot={false}
                                                                name="Scénario prudent"
                                                                isAnimationActive={!zoom.isPanning}
                                                                animationDuration={280}
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            )}

                                            {isVisible('DettesNonImmo') && (
                                                <Area type="monotone" dataKey={detteSousZero} stroke={COULEUR_DETTE} strokeWidth={1.35} fill={COULEUR_DETTE} fillOpacity={0.24} name="Dettes (hors hypothèque)" connectNulls={false} isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />
                                            )}
                                            {isVisible('DetteLevierSmith') && (
                                                <Line type="monotone" dataKey={detteLevierSousZero} stroke={COULEUR_LEVIER} strokeWidth={1.6} strokeDasharray="6 3" dot={false} name={LIBELLE_LEVIER} connectNulls={false} isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />
                                            )}
                                            {modeCourbe === 'empilee' && isVisible('ImpotLatent') && (
                                                <Area type="monotone" dataKey="ImpotLatent" stroke={couleurSerie('ImpotLatent')} strokeWidth={1.25} fill={couleurSerie('ImpotLatent')} fillOpacity={0.16} strokeDasharray="3 3" name="Impôt latent" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />
                                            )}
                                            {modeCourbe === 'empilee' && isVisible('FluxImpots') && (
                                                <Bar dataKey="FluxImpots" fill={couleurSerie('FluxImpots')} fillOpacity={0.8} name="Paiement impôts" barSize={4} isAnimationActive={false} />
                                            )}
                                            {modeCourbe === 'empilee' && isVisible('NetWorth') && (
                                                <Line type="monotone" dataKey="NetWorth" stroke={couleurSerie('NetWorth')} strokeWidth={1.85} dot={false} activeDot={GF_ACTIVE_DOT} name="Valeur Nette Totale" isAnimationActive={!zoom.isPanning} animationDuration={320} animationEasing="ease-out" />
                                            )}
                                            {modeCourbe === 'empilee' && isVisible('montecarlo') && (
                                                <>
                                                    <Line
                                                        type="monotone"
                                                        dataKey="P90"
                                                        stroke={couleurSerie('montecarlo')}
                                                        strokeWidth={1.85}
                                                        strokeDasharray="5 4"
                                                        strokeOpacity={0.95}
                                                        connectNulls={false}
                                                        dot={false}
                                                        activeDot={false}
                                                        name="Scénario favorable"
                                                        isAnimationActive={!zoom.isPanning}
                                                        animationDuration={280}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="P50"
                                                        stroke={couleurSerie('montecarlo')}
                                                        strokeWidth={1.5}
                                                        strokeDasharray="3 3"
                                                        strokeOpacity={0.75}
                                                        connectNulls={false}
                                                        dot={false}
                                                        activeDot={false}
                                                        name="Scénario central"
                                                        isAnimationActive={!zoom.isPanning}
                                                        animationDuration={280}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey="P10"
                                                        stroke="var(--gf-rouge)"
                                                        strokeWidth={1.85}
                                                        strokeDasharray="5 4"
                                                        strokeOpacity={0.9}
                                                        connectNulls={false}
                                                        dot={false}
                                                        activeDot={false}
                                                        name="Scénario prudent"
                                                        isAnimationActive={!zoom.isPanning}
                                                        animationDuration={280}
                                                    />
                                                </>
                                            )}
                                            {lockedByMonth && (
                                                <Line type="monotone" dataKey="lockedNetWorth" stroke="var(--repere)" strokeWidth={1.6} strokeDasharray="6 3" dot={false} name="Courbe verrouillée" isAnimationActive={!zoom.isPanning} animationDuration={320} />
                                            )}

                                            {isVisible('aujourdhui') && pointAncre && Number.isFinite(pointAncre.NetWorth) && (
                                                <ReferenceDot
                                                    x={isDailyCurve && todayAxisX !== null ? todayAxisX : todayMonthIndex}
                                                    y={pointAncre.NetWorth}
                                                    r={0}
                                                    shape={<TodayValueBadge value={maskedTick(isPrivacyMode, formatCompactCAD)(pointAncre.NetWorth)} />}
                                                />
                                            )}

                                            {isVisible('events') &&
                                                [
                                                    ...shownLifeEvents.map((evt, i) => ({ evt, kind: 'life' as const, key: `life-${i}` })),
                                                    ...shownFlowEvents.map((evt, i) => ({ evt, kind: 'flow' as const, key: `flow-${i}` })),
                                                ]
                                                    .sort((a, b) => (a.evt.x ?? a.evt.monthIndex) - (b.evt.x ?? b.evt.monthIndex))
                                                    .map(({ evt, kind, key }) => (
                                                        <ReferenceDot
                                                            key={key}
                                                            x={evt.x ?? evt.monthIndex}
                                                            y={evt.val}
                                                            r={kind === 'life' ? 3 : 2}
                                                            shape={
                                                                <ClickableEventIcon
                                                                    kind={kind}
                                                                    payload={evt}
                                                                    onSelect={() => {
                                                                        const found = chartData.find((d: ProjectionChartPoint) => d.monthIndex === evt.monthIndex);
                                                                        if (found) {
                                                                            setDetailDayIso(null);
                                                                            setDetailAnchorIso(null);
                                                                            setDetailMonthIso(null);
                                                                            setDetailPoint(found);
                                                                        }
                                                                    }}
                                                                />
                                                            }
                                                        />
                                                    ))}
                                        </ComposedChart>
                                    </ResponsiveContainer>
                                )}
                            </div>

                            <FutureRichTooltip
                                point={jourAffiche?.point ?? null}
                                isOpen={selection.mode !== 'idle'}
                                isPinned={selection.mode === 'frozen'}
                                origine={jourAffiche?.origine ?? 'ancre'}
                                anchorXRatio={resolvedAnchorXRatio}
                                scenarioLabel={activeScenarioOutput.label}
                                turningPointHint={activeTurningPointHint}
                                userName1={config.users[0]?.name}
                                userName2={config.users[1]?.name}
                                onOpenDetail={() => ouvrirDetailSur(jourAffiche?.point ?? null)}
                                onStep={stepJour}
                                pas={pasNavigation}
                                onPasChange={setPasNavigation}
                                canStepPrev={bornesPas.prev}
                                canStepNext={bornesPas.next}
                                onUnpin={selection.release}
                                tooltipRef={selection.panneauRef}
                            />
                        </div>

                        <FutureTimelineBrush
                            zoom={zoom}
                            totalPoints={displayData.length}
                            anneeDebut={anneeDe((displayData[0] as ProjectionChartPoint | undefined)?.monthIndex ?? 0)}
                            anneeFin={anneeDe(lastMonthIndex)}
                            anneeAujourdhui={anneeDe(todayMonthIndex)}
                            ratioAujourdhui={displayData.length > 1 ? todayArrayIndex / (displayData.length - 1) : 0}
                        />

                        <div className={modeCourbe === 'nette' ? 'sr-only' : ''}>
                            <FutureLegendDrawer
                                runMC={true}
                                hiddenSeries={hiddenSeries}
                                isVisible={isVisible}
                                toggleSeries={toggleSeries}
                                showAllSeries={showAllSeries}
                            />
                        </div>

                        <NotesGraphe
                            notes={notesGraphe({
                                courbeAuJour: isDailyCurve,
                                mentionAutoriteCourtier,
                                impotLatentVisible: isVisible('ImpotLatent'),
                            })}
                        />

                        {!isDailyCurve && (
                            <p role="status" className="mt-2 rounded-card border border-alerte-texte/30 bg-alerte-fond px-3 py-2 text-tiny text-texte-doux">
                                <strong className="text-alerte-texte">Courbe au mois (repli)</strong> — la valeur nette
                                mensuelle est inconnue sur presque toute la période (données passées incomplètes),
                                donc les jours ne peuvent pas être reconstruits honnêtement.
                            </p>
                        )}

                        {(mentionRaccordJour ||
                            mentionRaccordMois ||
                            (dailyPast !== null && Math.abs(dailyPast.undatedTotal) > 0.5) ||
                            Boolean(dailyPast?.truncatedFrom) ||
                            (dailyPast !== null && Math.abs(dailyPast.flowsAfterNowDate) > 0.5)) && (
                            <p role="status" className="mt-2 rounded-card border border-bordure-champ bg-surface-douce px-3 py-2 text-tiny text-texte-doux">
                                {dailyPast !== null && Math.abs(dailyPast.undatedTotal) > 0.5 && (
                                    <span className="block text-alerte-texte">
                                        ⚠ <PrivateAmount>{formatCAD(Math.abs(dailyPast.undatedTotal))}</PrivateAmount> de transactions datées au mois
                                        seul (sans jour) ne peuvent pas être placées : le niveau des jours passés peut
                                        être décalé d&apos;autant.
                                    </span>
                                )}
                                {dailyPast?.truncatedFrom && (
                                    <span className="mt-1 block text-alerte-texte">
                                        ⚠ Le premier jour non reconstruit est le {dailyPast.truncatedFrom} : à
                                        partir de là, la courbe passée s&apos;interrompt (limite de volume) et les
                                        journées ne sont ni tracées ni sélectionnables.
                                    </span>
                                )}
                                {dailyPast !== null && Math.abs(dailyPast.flowsAfterNowDate) > 0.5 && (
                                    <span className="mt-1 block text-alerte-texte">
                                        ⚠ <PrivateAmount>{formatCAD(Math.abs(dailyPast.flowsAfterNowDate))}</PrivateAmount> de transactions datées
                                        après aujourd&apos;hui sont déjà dans ton solde actuel mais pas encore dans les
                                        jours passés.
                                    </span>
                                )}
                                {mentionRaccordJour && <span className="mt-1 block">{mentionRaccordJour}</span>}
                                {mentionRaccordMois && <span className="mt-1 block">{mentionRaccordMois}</span>}
                            </p>
                        )}

                        <ChartDataTable
                            caption={
                                isDailyCurve
                                    ? 'Projection du patrimoine net et des comptes, jour par jour'
                                    : 'Projection du patrimoine net et des comptes par mois (repli)'
                            }
                            columns={dataColumns}
                            rows={selectSeries}
                        />

                        {(shownLifeEvents.length > 0 || shownFlowEvents.length > 0) &&
                            (isPrivacyMode ? (
                                <p className="sr-only">
                                    {shownLifeEvents.length + shownFlowEvents.length} jalons masqués en mode discret.
                                </p>
                            ) : (
                                <ul className="sr-only">
                                    <li>Jalons de la projection :</li>
                                    {[...shownLifeEvents, ...shownFlowEvents]
                                        .slice()
                                        .sort((a, b) => a.monthIndex - b.monthIndex)
                                        .map((e, i) => (
                                            <li key={`ms-sr-${i}`}>
                                                {e.dateLabel ? `${e.dateLabel} : ` : ''}
                                                {e.label}
                                            </li>
                                        ))}
                                </ul>
                            ))}

                        {detailPoint && (
                            <FutureDetailModal
                                point={detailPoint}
                                chartData={chartData}
                                transactions={transactions}
                                dayIso={detailDayIso}
                                variation={variationDuJour}
                                monthIso={detailMonthIso}
                                userName1={config.users[0]?.name}
                                userName2={config.users[1]?.name}
                                isPrivacyMode={isPrivacyMode}
                                onStepDay={stepDetailDay}
                                canStepPrev={detailSeriesIdx > 0}
                                canStepNext={detailSeriesIdx !== -1 && detailSeriesIdx < selectSeries.length - 1}
                                onClose={() => {
                                    setDetailPoint(null);
                                    setDetailDayIso(null);
                                    setDetailAnchorIso(null);
                                    setDetailMonthIso(null);
                                }}
                            />
                        )}
                    </section>

                    {etroit && bandeauKpi && (
                        <div className="grid grid-cols-2 gap-2.5">{bandeauKpi('mobile-pied')}</div>
                    )}

                    {/* Effet des marchés et analyses sur ton patrimoine */}
                    <MarketImpactCard
                        summary={marketImpact}
                        onOpenMarkets={() => naviguerVers(TabEnum.INVESTMENTS)}
                    />

                    {/* Bloc 3 : 4 repères clés pleine largeur */}
                    <FutureCoreMilestonesGrid
                        report={deepForecast.activeReport}
                        scenario={activeScenarioOutput}
                    />

                    {/* Bloc 4 : Panneau unifié (Passé & actualités + Pourquoi la courbe évolue ainsi + Actions concrètes) */}
                    <FutureUnifiedInsightsPanel
                        report={deepForecast.activeReport}
                        scenario={activeScenarioOutput}
                        reconciledActions={reconciledActions}
                        completedActionIds={completedAiActionIds}
                        onToggleActionCompleted={handleToggleActionCompleted}
                        onApplyActionPatch={handleApplyActionPatch}
                        onFocusMonth={handleSelectExplanationMonth}
                        onSelectScenario={deepForecast.setSelectedScenario}
                        onNavigateTab={naviguerVers}
                    />

                    <FutureYearAnatomyModal
                        isOpen={anatomyOpen}
                        onClose={() => setAnatomyOpen(false)}
                        chartData={chartData}
                        initialYear={jourAffiche?.point?.year ?? startYear}
                        userName1={config.users[0]?.name}
                        userName2={config.users[1]?.name}
                    />
                </div>
            )}

            <Drawer
                id={tiroirDomId('hypotheses')}
                isOpen={tiroirOuvert === 'hypotheses'}
                onClose={() => setTiroirOuvert(null)}
                variant={isBelowSidebarBreakpoint ? 'feuille' : 'lateral'}
                title="Modifier les hypothèses"
            >
                <ProjectionControls
                    projection={projection}
                    updateProj={updateProj}
                    updateReturnRate={updateReturnRate}
                    runMC={runMC}
                    setRunMC={setRunMC}
                    isComputing={isComputing}
                    fireNumber={fireNumber}
                    liveCSVBalances={liveCSVBalances}
                    applyHistoricalRate={applyHistoricalRate}
                    realEstateGoals={realEstateGoals}
                    setRealEstateGoals={setRealEstateGoals}
                    config={config}
                    isLateralDrawer={!isBelowSidebarBreakpoint}
                />
                {isNarrowViewport && (
                    <div className="sticky bottom-0 -mx-5 px-5 py-2.5 mt-3 border-t border-bordure bg-fond/95 backdrop-blur-xs">
                        <button
                            type="button"
                            onClick={() => setTiroirOuvert(null)}
                            className="touch-target w-full min-h-11 rounded-card bg-accent text-sur-accent font-bold text-body focus-ring"
                        >
                            Appliquer et fermer
                        </button>
                    </div>
                )}
            </Drawer>

            <Drawer
                id={tiroirDomId('historique')}
                isOpen={tiroirOuvert === 'historique'}
                onClose={() => setTiroirOuvert(null)}
                variant={isBelowSidebarBreakpoint ? 'feuille' : 'lateral'}
                title="Historique"
            >
                <Suspense fallback={<Skeleton variant="chart" />}>
                    <FutureHistorySection />
                </Suspense>
            </Drawer>

            <HubConnexionsModal isOpen={showConnexionsModal} onClose={() => setShowConnexionsModal(false)} />
        </div>
    );
};
