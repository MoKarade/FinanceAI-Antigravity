// ============================================================================
// Historical & Projected Inflation Purchasing Power Erosion Engine ($ CAD)
// Historical CPI Source: Statistique Canada / Banque du Canada (IPC global annuel)
// ============================================================================

export type InflationScenarioId =
  | 'boc_target'
  | 'historical_decade'
  | 'inflation_wave'
  | 'stagflation'
  | 'custom';

export interface InflationScenarioPreset {
  id: Exclude<InflationScenarioId, 'custom'>;
  shortLabel: string;
  annualInflationPct: number;
  tag: string;
}

export const INFLATION_SCENARIO_PRESETS: InflationScenarioPreset[] = [
  {
    id: 'boc_target',
    shortLabel: 'Cible BdC 2,0 %',
    annualInflationPct: 2.0,
    tag: 'Stabilité des prix',
  },
  {
    id: 'historical_decade',
    shortLabel: 'Moyenne 10A 2,6 %',
    annualInflationPct: 2.6,
    tag: 'Rythme 2016–2026',
  },
  {
    id: 'inflation_wave',
    shortLabel: 'Vague 4,8 %',
    annualInflationPct: 4.8,
    tag: 'Choc type 2022',
  },
  {
    id: 'stagflation',
    shortLabel: 'Sévère 6,5 %',
    annualInflationPct: 6.5,
    tag: 'Érosion rapide',
  },
];

/**
 * Verified annual Canadian CPI inflation rates (%) — 2016 to 2026
 * Reflects the post-2020 inflation surge (3.4% in 2021, 6.8% peak in 2022, 3.9% in 2023)
 * and gradual disinflation toward the Bank of Canada target band.
 */
const HISTORICAL_CANADA_CPI_ANNUAL_PCT: ReadonlyArray<{
  year: number;
  cpiPct: number;
}> = [
  { year: 2017, cpiPct: 1.6 },
  { year: 2018, cpiPct: 2.3 },
  { year: 2019, cpiPct: 1.9 },
  { year: 2020, cpiPct: 0.7 },
  { year: 2021, cpiPct: 3.4 },
  { year: 2022, cpiPct: 6.8 },
  { year: 2023, cpiPct: 3.9 },
  { year: 2024, cpiPct: 2.4 },
  { year: 2025, cpiPct: 2.1 },
  { year: 2026, cpiPct: 2.1 },
];

interface PurchasingPowerTimelinePoint {
  year: number;
  era: 'historical' | 'anchor' | 'projected';
  annualInflationPct: number;
  /** Value of idle uninvested cash in constant 2026 $ CAD purchasing power */
  cashRealCad: number;
  /** Cumulative purchasing power lost on idle cash vs anchor capital ($ CAD) */
  cashErodedCad: number;
  /** Real inflation-adjusted purchasing power of current portfolio ($ CAD constants 2026) */
  currentPortfolioRealCad: number;
  /** Real inflation-adjusted purchasing power of recommended portfolio ($ CAD constants 2026) */
  recommendedPortfolioRealCad: number;
  /** Nominal (unadjusted bank statement) value of recommended portfolio ($ CAD courants) */
  recommendedNominalCad: number;
}

export interface PurchasingPowerSimulationResult {
  anchorYear: number;
  endYear: number;
  horizonYears: number;
  baseCapitalCad: number;
  projectedInflationPct: number;
  historicalAvgCpi10yPct: number;
  /** % of purchasing power lost on idle cash over the 2016–2026 historical decade */
  historicalDecadeCashLossPct: number;
  /** Purchasing power of today's baseCapitalCad if left in 0% cash until endYear */
  projectedCashRealEndCad: number;
  /** Purchasing power eroded in $ CAD on idle cash between 2026 and endYear */
  projectedCashLossCad: number;
  /** % of purchasing power lost on idle cash between 2026 and endYear */
  projectedCashLossPct: number;
  /** Real purchasing power at endYear with current portfolio ($ CAD constants 2026) */
  currentRealEndCad: number;
  /** Real purchasing power at endYear with recommended portfolio ($ CAD constants 2026) */
  recommendedRealEndCad: number;
  /** Nominal bank-statement value at endYear with recommended portfolio ($ CAD courants) */
  recommendedNominalEndCad: number;
  /** Inflation illusion gap = Nominal value minus Real purchasing power at endYear */
  nominalIllusionGapCad: number;
  /** Extra real purchasing power protected vs idle cash ($ CAD constants 2026) */
  realGainVsCashCad: number;
  /** Real annualized Fisher return of recommended portfolio (%) */
  realAnnualReturnRecommendedPct: number;
  timeline: PurchasingPowerTimelinePoint[];
}

export interface SimulatePurchasingPowerInput {
  capitalCad: number;
  horizonYears: number;
  projectedInflationPct: number;
  currentNominalReturnPct: number;
  recommendedNominalReturnPct: number;
}

function clampFinite(val: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, val));
}

/**
 * Exact Fisher real annual rate: ((1 + r_nom) / (1 + pi)) - 1
 */
export function computeFisherRealRatePct(
  nominalRatePct: number,
  inflationRatePct: number
): number {
  const rNom = clampFinite(nominalRatePct, 6.0, -40, 60) / 100;
  const pi = clampFinite(inflationRatePct, 2.2, -5, 35) / 100;
  return (((1 + rNom) / Math.max(0.2, 1 + pi)) - 1) * 100;
}

export function simulateInflationPurchasingPower(
  input: SimulatePurchasingPowerInput
): PurchasingPowerSimulationResult {
  const baseCapitalCad =
    Number.isFinite(input.capitalCad) && input.capitalCad >= 100
      ? Math.round(input.capitalCad)
      : 50000;

  const horizonYears = Math.round(
    clampFinite(input.horizonYears, 10, 3, 30)
  );
  const projectedInflationPct = Number(
    clampFinite(input.projectedInflationPct, 2.6, 0, 15).toFixed(2)
  );
  const rCurrentNom =
    clampFinite(input.currentNominalReturnPct, 5.8, -20, 35) / 100;
  const rRecNom =
    clampFinite(input.recommendedNominalReturnPct, 8.6, -20, 35) / 100;
  const piFuture = projectedInflationPct / 100;

  // 1. Historical 2016 -> 2026 Canadian CPI cumulative factor
  // Express everything in constant 2026 purchasing power anchored at baseCapitalCad in 2026,
  // while showing how baseCapitalCad held in 2016 eroded down to 2026 in constant 2016->2026 terms.
  let histCumulativeCpi = 1;
  const histFactorsByYear = new Map<number, { cpiPct: number; cumFactorFrom2016: number }>();
  histFactorsByYear.set(2016, { cpiPct: 1.4, cumFactorFrom2016: 1 });

  for (const row of HISTORICAL_CANADA_CPI_ANNUAL_PCT) {
    histCumulativeCpi *= 1 + row.cpiPct / 100;
    histFactorsByYear.set(row.year, {
      cpiPct: row.cpiPct,
      cumFactorFrom2016: histCumulativeCpi,
    });
  }

  const historicalDecadeCashLossPct = Number(
    ((1 - 1 / histCumulativeCpi) * 100).toFixed(1)
  );
  const historicalAvgCpi10yPct = Number(
    ((Math.pow(histCumulativeCpi, 1 / 10) - 1) * 100).toFixed(2)
  );

  const timeline: PurchasingPowerTimelinePoint[] = [];

  // Historical segment (2016 -> 2025): normalized so that at 2026 the portfolio anchor is baseCapitalCad,
  // and on the historical cash curve we show what baseCapitalCad of 2016 purchasing power decayed to by each year!
  const realFisherCurrentHist = (1 + rCurrentNom) / Math.pow(histCumulativeCpi, 1 / 10);
  const realFisherRecHist = (1 + rRecNom) / Math.pow(histCumulativeCpi, 1 / 10);

  for (let year = 2016; year <= 2025; year++) {
    const info = histFactorsByYear.get(year)!;
    const yearsTo2026 = 2026 - year;
    // Cash held idle since 2016: starts at baseCapitalCad in 2016 and erodes with actual Canadian CPI
    const cashRealFrom2016 = baseCapitalCad / info.cumFactorFrom2016;
    const currentReal = baseCapitalCad / Math.pow(Math.max(0.7, realFisherCurrentHist), yearsTo2026);
    const recReal = baseCapitalCad / Math.pow(Math.max(0.7, realFisherRecHist), yearsTo2026);
    const priceLevelRatioTo2026 = info.cumFactorFrom2016 / histCumulativeCpi;

    timeline.push({
      year,
      era: 'historical',
      annualInflationPct: info.cpiPct,
      cashRealCad: Math.round(cashRealFrom2016),
      cashErodedCad: Math.round(baseCapitalCad - cashRealFrom2016),
      currentPortfolioRealCad: Math.round(currentReal),
      recommendedPortfolioRealCad: Math.round(recReal),
      recommendedNominalCad: Math.round(recReal * priceLevelRatioTo2026),
    });
  }

  // Anchor Year (2026 Today): all three future paths start cleanly at baseCapitalCad!
  timeline.push({
    year: 2026,
    era: 'anchor',
    annualInflationPct: 2.1,
    cashRealCad: baseCapitalCad,
    cashErodedCad: 0,
    currentPortfolioRealCad: baseCapitalCad,
    recommendedPortfolioRealCad: baseCapitalCad,
    recommendedNominalCad: baseCapitalCad,
  });

  // Projected Segment (2027 -> 2026 + horizonYears)
  for (let t = 1; t <= horizonYears; t++) {
    const year = 2026 + t;
    const cpiFactor = Math.pow(1 + piFuture, t);
    const cashReal = baseCapitalCad / cpiFactor;
    const currentNom = baseCapitalCad * Math.pow(1 + rCurrentNom, t);
    const recNom = baseCapitalCad * Math.pow(1 + rRecNom, t);

    const currentReal = currentNom / cpiFactor;
    const recReal = recNom / cpiFactor;

    timeline.push({
      year,
      era: 'projected',
      annualInflationPct: projectedInflationPct,
      cashRealCad: Math.round(cashReal),
      cashErodedCad: Math.round(baseCapitalCad - cashReal),
      currentPortfolioRealCad: Math.round(currentReal),
      recommendedPortfolioRealCad: Math.round(recReal),
      recommendedNominalCad: Math.round(recNom),
    });
  }

  const endPt = timeline[timeline.length - 1];
  const projectedCashLossCad = Math.max(0, baseCapitalCad - endPt.cashRealCad);
  const projectedCashLossPct = Number(
    ((projectedCashLossCad / Math.max(1, baseCapitalCad)) * 100).toFixed(1)
  );
  const realAnnualReturnRecommendedPct = Number(
    computeFisherRealRatePct(input.recommendedNominalReturnPct, projectedInflationPct).toFixed(2)
  );

  return {
    anchorYear: 2026,
    endYear: 2026 + horizonYears,
    horizonYears,
    baseCapitalCad,
    projectedInflationPct,
    historicalAvgCpi10yPct,
    historicalDecadeCashLossPct,
    projectedCashRealEndCad: endPt.cashRealCad,
    projectedCashLossCad,
    projectedCashLossPct,
    currentRealEndCad: endPt.currentPortfolioRealCad,
    recommendedRealEndCad: endPt.recommendedPortfolioRealCad,
    recommendedNominalEndCad: endPt.recommendedNominalCad,
    nominalIllusionGapCad: Math.max(
      0,
      endPt.recommendedNominalCad - endPt.recommendedPortfolioRealCad
    ),
    realGainVsCashCad: endPt.recommendedPortfolioRealCad - endPt.cashRealCad,
    realAnnualReturnRecommendedPct,
    timeline,
  };
}
