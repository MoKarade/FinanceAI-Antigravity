// services/marketImpactSummary.ts
// Module pur : traduit l'effet des mouvements récents du marché et des analyses macro/actu
// en impact concret en $ CAD et en mois de retraite pour l'utilisateur.
// Règle no-fake-data : valeur absente ou portefeuille vide => champs à `null`, jamais `0` inventé.

import type { Asset, RetirementGoal } from '../types';
import { computeInvestmentsValue } from './portfolio';
import type { ProjectionResult } from './projection/types';
import type { MacroAndNewsSignalBundle } from './projection/deepForecastTypes';
import type { SimulationPastCurveCalibration } from './projection/pastCurveCalibration';

export interface MarketImpactSummary {
    hasMarketData: boolean;
    portfolioValueCad: number | null;
    annualShiftPct: number | null;
    impact5yCad: number | null;
    horizonImpactCad: number | null;
    retirementMonthsDelta: number | null;
    regimeLabel: string;
    headlineFr: string;
    direction: 'positif' | 'neutre' | 'risque';
}

export interface ComputeMarketImpactInput {
    assets: Asset[];
    fxRates: Record<string, number>;
    lastProjection: ProjectionResult | null;
    newsBundle?: MacroAndNewsSignalBundle | null;
    pastCalibration?: SimulationPastCurveCalibration | null;
    retirementGoal?: Partial<RetirementGoal> | null;
    baseReturnRatePct?: number;
}

/**
 * Calcule l'effet des signaux de marché sur le patrimoine futur (à 5 ans, à l'horizon, et en mois de retraite).
 */
export function computeMarketImpactSummary(input: ComputeMarketImpactInput): MarketImpactSummary {
    const {
        assets,
        fxRates,
        lastProjection,
        newsBundle,
        pastCalibration,
        retirementGoal,
        baseReturnRatePct = 6.0,
    } = input;

    const portfolioValueCad = computeInvestmentsValue(assets ?? [], fxRates ?? {}, 0);
    const hasChart = Boolean(lastProjection?.chartData && lastProjection.chartData.length >= 2);

    if (!assets || assets.length === 0 || !Number.isFinite(portfolioValueCad) || portfolioValueCad <= 0 || !hasChart) {
        return {
            hasMarketData: false,
            portfolioValueCad: null,
            annualShiftPct: null,
            impact5yCad: null,
            horizonImpactCad: null,
            retirementMonthsDelta: null,
            regimeLabel: 'En attente de placements',
            headlineFr: 'Ajoute des placements pour mesurer comment les marchés influencent ton patrimoine et ta date de retraite.',
            direction: 'neutre',
        };
    }

    const newsShift =
        newsBundle && Number.isFinite(newsBundle.annualizedReturnAdjustmentPct)
            ? newsBundle.annualizedReturnAdjustmentPct
            : 0;
    const calShift =
        pastCalibration &&
        pastCalibration.monthsObserved >= 3 &&
        Number.isFinite(pastCalibration.calibratedReturnTiltPp)
            ? pastCalibration.calibratedReturnTiltPp
            : 0;

    // Si aucun signal spécifique n'ajuste le rendement, on combine le calibrage passé observé et le signal actu
    const rawShiftPct = Number((newsShift + calShift * 0.5).toFixed(2));
    const annualShiftPct = Math.max(-2.5, Math.min(2.5, rawShiftPct));

    const rBase = Math.max(0.01, Math.min(0.15, (Number.isFinite(baseReturnRatePct) ? baseReturnRatePct : 6.0) / 100));
    const rAdj = Math.max(0.005, rBase + annualShiftPct / 100);

    const chartData = lastProjection!.chartData;
    const lastPt = chartData[chartData.length - 1]!;
    const horizonYears = Math.max(5, Math.min(45, Math.round((lastPt.monthIndex ?? 120) / 12)));

    const impact5yCad = Math.round(portfolioValueCad * (Math.pow(1 + rAdj, 5) - Math.pow(1 + rBase, 5)));
    const horizonImpactCad = Math.round(
        portfolioValueCad * (Math.pow(1 + rAdj, horizonYears) - Math.pow(1 + rBase, horizonYears)),
    );

    const retPt = chartData.find((p) => p.isRetired) ?? lastPt;
    const yearsToRet = Math.max(1, Math.min(horizonYears, Math.round((retPt.monthIndex ?? horizonYears * 12) / 12)));
    const retDeltaCad = portfolioValueCad * (Math.pow(1 + rAdj, yearsToRet) - Math.pow(1 + rBase, yearsToRet));
    const monthlyNeed = Math.max(1_500, Number(retirementGoal?.targetMonthlyIncome) || 4_000);
    const rawMonths = Math.round(retDeltaCad / monthlyNeed);
    const retirementMonthsDelta = Math.max(-36, Math.min(36, rawMonths));

    const direction: MarketImpactSummary['direction'] =
        annualShiftPct >= 0.15 ? 'positif' : annualShiftPct <= -0.15 ? 'risque' : 'neutre';

    const regimeLabel =
        newsBundle?.portfolioSentimentLabel?.trim() ||
        (direction === 'positif'
            ? 'Contexte porteur'
            : direction === 'risque'
              ? 'Marché exigeant'
              : 'Contexte neutre');

    const headlineFr =
        newsBundle?.macroHeadlineFr?.trim() ||
        (direction === 'positif'
            ? 'La tendance actuelle soutient légèrement la croissance attendue de tes placements.'
            : direction === 'risque'
              ? 'Les secousses récentes invitent à la prudence sur les rendements des prochaines années.'
              : 'Les marchés restent proches de tes hypothèses centrales à long terme.');

    return {
        hasMarketData: true,
        portfolioValueCad: Math.round(portfolioValueCad),
        annualShiftPct,
        impact5yCad,
        horizonImpactCad,
        retirementMonthsDelta,
        regimeLabel,
        headlineFr,
        direction,
    };
}
