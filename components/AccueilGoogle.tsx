import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ProjectionChartPoint } from '../services/projection/types';
import { useFinanceStore } from '../store/useFinanceStore';
import { useNetWorthVariation } from '../hooks/useNetWorthVariation';
import { useTodayIsoLocal } from '../hooks/useTodayIsoLocal';
import { usePastTrajectoryContext } from '../hooks/usePastTrajectoryContext';
import { apresPremierAffichage } from '../utils/apresPremierAffichage';
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
import { kpiPatrimoine } from './projection/kpiPatrimoine';
import { indexAujourdhui } from './future/panneauPas';
import { detteSousZero } from './future/detteSerie';
import { formatCAD } from '../utils/format';
import { MASKED_AMOUNT_LABEL } from '../utils/privacyAria';
import { type ChartDataColumn } from './ui/ChartDataTable';
import { HubConnexionsModal } from './future/HubConnexionsModal';
import { useFirebaseAuth } from './auth/FirebaseAuthGate';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import type { ValoriaQuickSignal } from '../services/valoria/valoriaIntegration';
import type {
    AccueilGoogleProps,
    HorizonCle,
    LentilleHero,
    ModeCourbe,
    PointTrajectoire,
} from './accueil/types';
import {
    EMPTY_CHART_POINTS,
    MOIS_COURTS,
    CURVE_FIELDS,
    HORIZONS,
    RENDER_MAX_POINTS,
    calculerEchelleNetteSerree,
} from './accueil/accueilHelpers';
import { useAccueilPresentFigures, useAccueilSecondaryPanels } from './accueil/useAccueilData';
import { AccueilOmniboxBar } from './accueil/AccueilOmniboxBar';
import { AccueilHeroTrajectoire } from './accueil/AccueilHeroTrajectoire';
import { AccueilRepereBandeau } from './accueil/AccueilRepereBandeau';
import { AccueilColonnesPatrimoine } from './accueil/AccueilColonnesPatrimoine';

const GeminiAssistantModal = lazyWithRetry(
    () => import('./aiChat/GeminiAssistantModal').then((m) => ({ default: m.GeminiAssistantModal })),
    'GeminiAssistantModal',
);

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
    const setRunMC = useFinanceStore((s) => s.setProjectionRunMC);
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
        const conn = typeof navigator !== 'undefined'
            ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
            : undefined;
        if (conn?.saveData === true) {
            return;
        }
        let cancelled = false;
        let timerId: ReturnType<typeof setTimeout> | null = null;
        const stopApres = apresPremierAffichage(() => {
            if (cancelled) return;
            timerId = setTimeout(() => {
                if (cancelled) return;
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
            }, 1800);
        });
        return () => {
            cancelled = true;
            stopApres();
            if (timerId !== null) clearTimeout(timerId);
        };
    }, [state.assets, state.valoriaWatchlist, state.fxRates, state.valoriaRiskProfile, state.projection?.appliedReturnProfile]);
    const todayIso = useTodayIsoLocal();
    const {
        pastHistory,
        calculatedStartingCash,
        startYear,
        startMonth,
        todayMonthIndex,
        pastCurveCalibration,
    } = usePastTrajectoryContext();
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

    const {
        realEstateEquity,
        realEstateValeur,
        totalDettes,
        patrimoineNet,
        epargneMensuelle,
        liquidites,
        portefeuillePlacements,
        valeurHeroAffichee,
        lentilleCourante,
        prenom,
        indicateursPouls,
    } = useAccueilPresentFigures({
        state,
        globalNetWorth,
        avoirsHorsImmo,
        dettesHorsImmo,
        calculatedMonthlySavings,
        assetBreakdown,
        currentLiquidity,
        lentilleHero,
    });

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
        if (horizon === '2025') {
            const idxJan2025 = (2025 - startYear) * 12 - startMonth;
            return [Math.max(minMois, idxJan2025), Math.min(maxMois, xAuj + 36)];
        }
        if (horizon === '10A') {
            return [Math.max(minMois, xAuj - 24), Math.min(maxMois, xAuj + 120)];
        }
        return [minMois, maxMois];
    }, [horizon, pastStartIndex, lastMonthIndex, xAuj, startYear, startMonth]);

    const minMonthWindow = Math.floor(bornesHorizonMois[0]) - 2;
    const maxMonthWindow = Math.ceil(bornesHorizonMois[1]) + 2;

    const dailyPastFrom = useMemo(() => {
        const first = dailyAnchors[0];
        if (!first) return null;
        const firstAnchorIso = isoDate(first.year, first.month, 1);
        const calWindowStart = calendarFromMonthIndex(startYear, startMonth, minMonthWindow);
        const windowStartIso = isoDate(calWindowStart.year, calWindowStart.month, 1);
        const boundedIso = firstAnchorIso > windowStartIso ? firstAnchorIso : windowStartIso;
        return boundedIso < todayIso ? boundedIso : null;
    }, [dailyAnchors, startYear, startMonth, minMonthWindow, todayIso]);

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
        const allAnchorMonths = displayData.filter((p) => keep.has(p.monthIndex));
        const windowedMonths = allAnchorMonths.filter(
            (p) => p.monthIndex >= minMonthWindow && p.monthIndex <= maxMonthWindow,
        );
        const months = windowedMonths.length >= 2 ? windowedMonths : allAnchorMonths;
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
    }, [dailyAnchors, displayData, minMonthWindow, maxMonthWindow, startYear, startMonth, dailyDated, dailyPastByDate, syncConfirmedUntilIso, todayIso]);

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
        const hasFutureMcBounds = (startIdx: number): boolean => {
            for (let j = startIdx + 1; j < Math.min(chartSeriesBrute.length, startIdx + 4); j++) {
                const cand = chartSeriesBrute[j];
                if (
                    cand &&
                    typeof cand.P10 === 'number' &&
                    Number.isFinite(cand.P10) &&
                    typeof cand.P90 === 'number' &&
                    Number.isFinite(cand.P90)
                ) {
                    return true;
                }
            }
            return false;
        };
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

            const p10Raw = pt.P10;
            const p50Raw = pt.P50;
            const p90Raw = pt.P90;
            const hasMcBounds =
                typeof p10Raw === 'number' &&
                Number.isFinite(p10Raw) &&
                typeof p90Raw === 'number' &&
                Number.isFinite(p90Raw);

            let mcP10: number | null = null;
            let mcP50: number | null = null;
            let mcP90: number | null = null;

            if (lentilleHero === 'net' && runMC && !estPassePt) {
                if (hasMcBounds) {
                    mcP10 = Math.min(p10Raw, p90Raw);
                    mcP90 = Math.max(p10Raw, p90Raw);
                    mcP50 = typeof p50Raw === 'number' && Number.isFinite(p50Raw) ? p50Raw : null;
                } else if (estTransitionPt && typeof valLentille === 'number' && hasFutureMcBounds(idx)) {
                    mcP10 = valLentille;
                    mcP50 = valLentille;
                    mcP90 = valLentille;
                }
            }

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
                mcP10,
                mcP50,
                mcP90,
            };
        });
    }, [chartSeriesBrute, extraireValeurLentillePoint, xAuj, startYear, startMonth, lentilleHero, runMC]);

    const donneesTrajectoireAvecRuban = useMemo<Array<Record<string, unknown>>>(() => {
        return donneesTrajectoire.map((pt) => {
            const mcRange: [number, number] | null =
                typeof pt.mcP10 === 'number' &&
                Number.isFinite(pt.mcP10) &&
                typeof pt.mcP90 === 'number' &&
                Number.isFinite(pt.mcP90)
                    ? [Math.min(pt.mcP10, pt.mcP90), Math.max(pt.mcP10, pt.mcP90)]
                    : null;
            return { ...pt, mcRange };
        });
    }, [donneesTrajectoire]);

    const hasMcSeries = useMemo(
        () => donneesTrajectoire.some((p) => p.mcP10 !== null && p.mcP90 !== null && p.periode === 'futur'),
        [donneesTrajectoire],
    );

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
                if (runMC) {
                    garder(p.mcP10);
                    garder(p.mcP50);
                    garder(p.mcP90);
                }
            } else {
                garder(p.valeur);
                if (modeCourbe === 'complete') garder(p.avoirs);
                if (lentilleHero === 'net' && runMC) {
                    garder(p.mcP10);
                    garder(p.mcP50);
                    garder(p.mcP90);
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

    const {
        partsRepartition,
        partSelectionnee,
        positionsSuivies,
        resultatsOmnibox,
        operationsRecentes,
        prioritesPlanAction,
        prochainsJalons,
    } = useAccueilSecondaryPanels({
        state,
        requete,
        todayIso,
        segmentActif,
        assetBreakdown,
        realEstateValeur,
        liquidites,
        portefeuillePlacements,
        dettesHorsImmo,
        totalDettes,
        patrimoineNet,
        epargneMensuelle,
        fireNumber,
        jalonFire,
        pointRetraite,
        indicateursPouls,
    });

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
                <AccueilOmniboxBar
                    syncState={syncStatus.state}
                    requete={requete}
                    setRequete={setRequete}
                    rechercheOuverte={rechercheOuverte}
                    setRechercheOuverte={setRechercheOuverte}
                    resultatsOmnibox={resultatsOmnibox}
                    fxRates={state.fxRates}
                    setActiveTab={setActiveTab}
                    onOpenConnexions={() => setShowConnexionsModal(true)}
                />

                <AccueilHeroTrajectoire
                    activeTab={activeTab}
                    setActiveTab={setActiveTab}
                    isPrivacyMode={isPrivacyMode}
                    prenom={prenom}
                    lentilleHero={lentilleHero}
                    setLentilleHero={setLentilleHero}
                    lentilleCourante={lentilleCourante}
                    valeurHeroAffichee={valeurHeroAffichee}
                    patrimoineNet={patrimoineNet}
                    portefeuillePlacements={portefeuillePlacements}
                    liquidites={liquidites}
                    realEstateEquity={realEstateEquity}
                    variation={variation}
                    gainHorizon={gainHorizon}
                    horizon={horizon}
                    setHorizon={setHorizon}
                    onBasculerHorizonSuivant={basculerHorizonSuivant}
                    modeCourbe={modeCourbe}
                    setModeCourbe={setModeCourbe}
                    tempsFortsActifs={tempsFortsActifs}
                    setTempsFortsActifs={setTempsFortsActifs}
                    runMC={runMC}
                    setRunMC={setRunMC}
                    isDailyCurve={isDailyCurve}
                    pointInspecte={pointInspecte}
                    pointEpingle={pointEpingle}
                    setPointEpingle={setPointEpingle}
                    setPointSurvole={setPointSurvole}
                    resumeFenetre={resumeFenetre}
                    hasMcSeries={hasMcSeries}
                    projectionStatus={projectionStatus}
                    hasPastCurveCalibration={Boolean(pastCurveCalibration)}
                    donneesTrajectoire={donneesTrajectoire}
                    donneesTrajectoireAvecRuban={donneesTrajectoireAvecRuban}
                    formatTickXAccueil={formatTickXAccueil}
                    echelleYTrajectoire={echelleYTrajectoire}
                    enrichDailyPoint={enrichDailyPoint}
                    pastPrefixCount={pastPrefixPoints.length}
                    pastStartIndex={pastStartIndex}
                    xAuj={xAuj}
                    bornesHorizonMois={bornesHorizonMois}
                    fireNumber={fireNumber}
                    jalonFire={jalonFire}
                    pointRetraite={pointRetraite}
                    pointAncre={pointAncre}
                    extraireValeurLentillePoint={extraireValeurLentillePoint}
                    pointsTempsForts={pointsTempsForts}
                    colonnesTrajectoire={colonnesTrajectoire}
                />

                <AccueilRepereBandeau
                    setActiveTab={setActiveTab}
                    patrimoineNet={patrimoineNet}
                    jalonFire={jalonFire}
                    fireNumber={fireNumber}
                    pctLiberte={indicateursPouls.pctLiberte}
                    pointRetraite={pointRetraite}
                    ageRetraite={indicateursPouls.ageRetraite}
                    lastProjectionPresent={Boolean(lastProjection)}
                    projectionStatus={projectionStatus}
                    dernierPoint={dernierPoint}
                    patrimoineKpiValue={patrimoineKpi?.value}
                />

                <AccueilColonnesPatrimoine
                    activeTab={activeTab}
                    lentilleHero={lentilleHero}
                    setActiveTab={setActiveTab}
                    navigateWithFocus={navigateWithFocus}
                    isPrivacyMode={isPrivacyMode}
                    positionsSuivies={positionsSuivies}
                    valoriaSignals={valoriaSignals}
                    valoriaWatchlist={state.valoriaWatchlist ?? []}
                    partsRepartition={partsRepartition}
                    partSelectionnee={partSelectionnee}
                    segmentActif={segmentActif}
                    setSegmentActif={setSegmentActif}
                    epargneMensuelle={epargneMensuelle}
                    prioritesPlanAction={prioritesPlanAction}
                    operationsRecentes={operationsRecentes}
                    prochainsJalons={prochainsJalons}
                    anneeActuelle={anneeActuelle}
                    onAskGemini={ouvrirQuestionGemini}
                    colonnesRepartition={colonnesRepartition}
                />
            </section>

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
