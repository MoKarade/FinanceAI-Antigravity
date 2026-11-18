import { HISTORICAL_SERIES, getAssetById } from './marketData';
import { PortfolioLot, evaluateLotMarketPosition } from './engine';

export interface BenchmarkSeriesPoint {
  date: Date;
  yearMonth: string; // 'YYYY-MM' or 'YYYY-MM-DD'
  label: string;
  portfolioCumPct: number;
  benchmarkCumPct: number;
  alphaPct: number;
  portfolioValueEur: number; // Stored in $ CAD
  benchmarkValueEur: number; // Stored in $ CAD
  investedCumulativeEur: number; // Stored in $ CAD
}

export type BenchmarkPeriod =
  | '1M'
  | '3M'
  | '6M'
  | 'ALL_HOLDING'
  | '1Y'
  | '3Y'
  | '5Y'
  | 'MAX';

export interface PortfolioHistoricalStats {
  annualizedReturnPct: number;
  annualizedVolatilityPct: number;
  monthlyMeanLogReturn: number;
  monthlyStdLogReturn: number;
  observationsCount: number;
  assetVolatilities: {
    assetId: string;
    name: string;
    weightPct: number;
    historicalVolatilityPct: number;
    historicalReturnPct: number;
  }[];
}

export interface MonteCarlo10kYearPoint {
  year: number;
  calendarYear: number;
  totalInvested: number;
  p5: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  mean: number;
}

export interface MonteCarlo10kResult {
  scenarioCount: number;
  horizonYears: number;
  initialCapital: number;
  monthlyContribution: number;
  historicalStats: PortfolioHistoricalStats;
  yearlyQuantiles: MonteCarlo10kYearPoint[];
  samplePaths: number[][]; // 24 representative trajectories of length (horizonYears + 1)
  finalDistributionBins: {
    minEur: number;
    maxEur: number;
    count: number;
    sharePct: number;
  }[];
  probabilityOfGainPct: number;
  probabilityOfDoublingInvestedPct: number;
}

const FR_SHORT_MONTHS_LOWER = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
];

function parseYearMonthToDate(ym: string): Date {
  const parts = ym.split('-').map(Number);
  const y = parts[0] || 2026;
  const m = parts[1] || 1;
  const d = parts[2] || 1;
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDailyLabelFr(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  if (parts.length < 3) return isoDate;
  const [y, m, d] = parts;
  return `${d} ${FR_SHORT_MONTHS_LOWER[(m || 1) - 1]} ${y}`;
}

function addDaysIso(isoDate: string, deltaDays: number): string {
  const dt = parseYearMonthToDate(isoDate);
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function lookupStepPriceOnOrBefore(
  history: [string, number][],
  isoDate: string
): number {
  let lo = 0;
  let hi = history.length - 1;
  let best = history[0][1];
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midDate = history[mid][0];
    if (midDate === isoDate) return history[mid][1];
    if (midDate < isoDate) {
      best = history[mid][1];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function interpolateMonthlySeriesPriceAtIso(
  assetOrBenchId: string,
  isoDate: string
): number {
  const ym = isoDate.slice(0, 7);
  const day = Math.max(1, Math.min(31, Number(isoDate.slice(8, 10)) || 1));
  const idx = HISTORICAL_SERIES.findIndex((p) => p.yearMonth === ym);

  const readVal = (ptIdx: number): number => {
    const pt =
      HISTORICAL_SERIES[
        Math.max(0, Math.min(HISTORICAL_SERIES.length - 1, ptIdx))
      ];
    if (assetOrBenchId === 'LIVRET_A') return pt.livretIndex;
    return pt.prices[assetOrBenchId] ?? pt.prices.XBB ?? 100;
  };

  if (idx === -1) {
    return isoDate < HISTORICAL_SERIES[0].yearMonth
      ? readVal(0)
      : readVal(HISTORICAL_SERIES.length - 1);
  }

  const v0 = readVal(idx);
  if (idx + 1 >= HISTORICAL_SERIES.length) return v0;
  const v1 = readVal(idx + 1);
  const frac = (day - 1) / 30;
  return v0 * Math.pow(Math.max(1e-6, v1 / Math.max(1e-6, v0)), frac);
}

interface RawWindowPoint {
  date: Date;
  isoOrYm: string;
  label: string;
  portVal: number;
  benchIndex: number;
  invCum: number;
}

function normalizeWindowPoints(rawPoints: RawWindowPoint[]): BenchmarkSeriesPoint[] {
  if (rawPoints.length < 2) return [];
  const p0 = Math.max(1e-6, rawPoints[0].portVal);
  const b0 = Math.max(1e-6, rawPoints[0].benchIndex);

  return rawPoints.map((pt, idx) => {
    const isLast = idx === rawPoints.length - 1;
    const portCumPct = idx === 0 ? 0 : (pt.portVal / p0 - 1) * 100;
    const benchCumPct = idx === 0 ? 0 : (pt.benchIndex / b0 - 1) * 100;
    const benchVal = p0 * (pt.benchIndex / b0);

    const roundedPort = Number(portCumPct.toFixed(2));
    const roundedBench = Number(benchCumPct.toFixed(2));

    return {
      date: pt.date,
      yearMonth: pt.isoOrYm,
      label: isLast ? `${pt.label} (Spot)` : pt.label,
      portfolioCumPct: roundedPort,
      benchmarkCumPct: roundedBench,
      alphaPct: Number((roundedPort - roundedBench).toFixed(2)),
      portfolioValueEur: Number(pt.portVal.toFixed(2)),
      benchmarkValueEur: Number(benchVal.toFixed(2)),
      investedCumulativeEur: Number(pt.invCum.toFixed(2)),
    };
  });
}

function getTargetMonthsForPeriod(period: BenchmarkPeriod, totalLen: number): number {
  switch (period) {
    case '1M':
      return 2;
    case '3M':
      return 4;
    case '6M':
      return 7;
    case '1Y':
      return 13;
    case '3Y':
      return 37;
    case '5Y':
      return 61;
    case 'MAX':
      return totalLen;
    case 'ALL_HOLDING':
    default:
      return totalLen;
  }
}

/**
 * Computes cumulative performance (%) and $ CAD value comparison of the user's portfolio
 * vs a chosen benchmark index across 1M, 3M, 6M, ALL_HOLDING (Depuis achat), 1Y, 3Y, 5Y, or MAX.
 *
 * - Honors exact FinanceAI daily price histories (`dailyHistoryCad`) when available so the daily curve
 *   matches FinanceAI's `Performance comparée` (peaks, drawdowns, and ending % return).
 * - Never freezes on `1Y / 3Y / 5Y / MAX` when holdings were bought recently: backfills pre-purchase
 *   months using the exact historical value of the current portfolio's asset bundle and rebases to 0%
 *   at the start of every selected period.
 */
export function buildBenchmarkComparisonSeries(params: {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  benchmarkAssetId: string;
  period: BenchmarkPeriod;
}): BenchmarkSeriesPoint[] {
  const { lots, livePrices, benchmarkAssetId, period } = params;
  const validLots = lots.filter(
    (l) => l.investedAmount > 0 && Boolean(getAssetById(l.assetId))
  );

  const totalLen = HISTORICAL_SERIES.length;
  if (validLots.length === 0 || totalLen < 2) {
    return [];
  }

  const latestSeriesPrices = HISTORICAL_SERIES[totalLen - 1].prices;
  const getTickMult = (assetId: string): number => {
    const base = latestSeriesPrices[assetId] ?? 0;
    const live = livePrices[assetId];
    return base > 0 && live !== undefined ? live / base : 1;
  };

  // Current portfolio weights by asset (used for pre-purchase historical backcasting on 1Y/3Y/5Y/MAX)
  const currentValueByAsset: Record<string, number> = {};
  let totalCurrentPortfolioVal = 0;
  for (const l of validLots) {
    const pos = evaluateLotMarketPosition(l, livePrices);
    currentValueByAsset[l.assetId] =
      (currentValueByAsset[l.assetId] ?? 0) + pos.currentValue;
    totalCurrentPortfolioVal += pos.currentValue;
  }
  const assetWeights: Record<string, number> = {};
  for (const [id, v] of Object.entries(currentValueByAsset)) {
    assetWeights[id] =
      totalCurrentPortfolioVal > 0 ? v / totalCurrentPortfolioVal : 0;
  }

  // Check if any lots carry daily FinanceAI price history
  const lotsWithDaily = validLots.filter(
    (l) => l.dailyHistoryCad && l.dailyHistoryCad.length >= 2
  );

  if (lotsWithDaily.length > 0) {
    const dateSet = new Set<string>();
    for (const l of lotsWithDaily) {
      for (const [dt] of l.dailyHistoryCad!) {
        dateSet.add(dt);
      }
    }
    const sortedDates = Array.from(dateSet).sort();

    if (sortedDates.length >= 2) {
      const firstDailyIso = sortedDates[0];
      const lastDailyIso = sortedDates[sortedDates.length - 1];

      // If the selected benchmark itself exists among daily lots (e.g. XBB or GOLD in FinanceAI),
      // use its authentic daily history!
      const benchDailyLot = lotsWithDaily.find(
        (l) =>
          l.assetId === benchmarkAssetId &&
          l.dailyHistoryCad &&
          l.dailyHistoryCad.length >= 2 &&
          l.dailyHistoryCad[0][0] <= firstDailyIso
      );

      const dailyRaw: RawWindowPoint[] = sortedDates.map((dt, dIdx) => {
        const isLastDay = dIdx === sortedDates.length - 1;
        let portVal = 0;
        let invCum = 0;

        for (const l of validLots) {
          const actDate =
            l.purchaseDate ?? l.dailyHistoryCad?.[0]?.[0] ?? firstDailyIso;
          if (dt < actDate && dt > firstDailyIso) {
            continue;
          }
          if (dt < actDate && actDate > firstDailyIso) {
            continue;
          }

          if (l.dailyHistoryCad && l.dailyHistoryCad.length >= 2 && l.quantity && l.quantity > 0) {
            const basePx = lookupStepPriceOnOrBefore(l.dailyHistoryCad, dt);
            const px = isLastDay ? basePx * getTickMult(l.assetId) : basePx;
            portVal += l.quantity * px;
            invCum += l.investedAmount;
          } else {
            const buyYm = l.purchaseYearMonth;
            const buyPx =
              HISTORICAL_SERIES.find((p) => p.yearMonth === buyYm)?.prices[
                l.assetId
              ] ?? interpolateMonthlySeriesPriceAtIso(l.assetId, actDate);
            const nowPx = isLastDay
              ? livePrices[l.assetId] ??
                interpolateMonthlySeriesPriceAtIso(l.assetId, dt)
              : interpolateMonthlySeriesPriceAtIso(l.assetId, dt);
            portVal += buyPx > 0 ? (l.investedAmount / buyPx) * nowPx : l.investedAmount;
            invCum += l.investedAmount;
          }
        }

        const benchIndex = benchDailyLot?.dailyHistoryCad
          ? lookupStepPriceOnOrBefore(benchDailyLot.dailyHistoryCad, dt) *
            (isLastDay ? getTickMult(benchmarkAssetId) : 1)
          : interpolateMonthlySeriesPriceAtIso(benchmarkAssetId, dt) *
            (isLastDay && benchmarkAssetId !== 'LIVRET_A'
              ? getTickMult(benchmarkAssetId)
              : 1);

        return {
          date: parseYearMonthToDate(dt),
          isoOrYm: dt,
          label: formatDailyLabelFr(dt),
          portVal,
          benchIndex,
          invCum,
        };
      });

      // Short / holding windows slice the authentic daily series directly
      if (
        period === '1M' ||
        period === '3M' ||
        period === '6M' ||
        period === 'ALL_HOLDING'
      ) {
        if (period === 'ALL_HOLDING') {
          return normalizeWindowPoints(dailyRaw);
        }
        const lookbackDays = period === '1M' ? -31 : period === '3M' ? -92 : -183;
        const cutoffIso = addDaysIso(lastDailyIso, lookbackDays);
        let sliced = dailyRaw.filter((p) => p.isoOrYm >= cutoffIso);
        if (sliced.length < 2) {
          sliced = dailyRaw.slice(-Math.min(dailyRaw.length, 5));
        }
        return normalizeWindowPoints(sliced);
      }

      // Multi-year windows (1Y, 3Y, 5Y, MAX): check if daily history already covers the span;
      // if not, backfill pre-purchase monthly points seamlessly before `firstDailyIso`!
      const targetMonths = getTargetMonthsForPeriod(period, totalLen);
      const startIdx = Math.max(0, totalLen - targetMonths);
      const targetStartYm = HISTORICAL_SERIES[startIdx].yearMonth;
      const firstDailyYm = firstDailyIso.slice(0, 7);

      if (firstDailyYm <= targetStartYm) {
        const cutoffIso = `${targetStartYm}-01`;
        const sliced = dailyRaw.filter((p) => p.isoOrYm >= cutoffIso);
        return normalizeWindowPoints(sliced.length >= 2 ? sliced : dailyRaw);
      }

      // Backcast pre-`firstDailyYm` months using the exact share-bundle identity:
      // V(m) = V(firstDaily) * sum_i( w_i * P_i(m) / P_i(anchorMonth) )
      const anchorDaily = dailyRaw[0];
      const anchorMonthIdx = Math.max(
        0,
        HISTORICAL_SERIES.findIndex((p) => p.yearMonth === firstDailyYm)
      );
      const anchorMonthPt = HISTORICAL_SERIES[anchorMonthIdx];
      const anchorMonthlyBench = interpolateMonthlySeriesPriceAtIso(
        benchmarkAssetId,
        firstDailyIso
      );
      const benchScaleToDaily =
        anchorMonthlyBench > 0 ? anchorDaily.benchIndex / anchorMonthlyBench : 1;

      const backfilledMonthly: RawWindowPoint[] = [];
      for (let mIdx = startIdx; mIdx < anchorMonthIdx; mIdx++) {
        const mPt = HISTORICAL_SERIES[mIdx];
        let relBundle = 0;
        for (const [id, w] of Object.entries(assetWeights)) {
          const pAnchor = anchorMonthPt.prices[id] ?? 100;
          const pMonth = mPt.prices[id] ?? pAnchor;
          relBundle += w * (pAnchor > 0 ? pMonth / pAnchor : 1);
        }
        const mBenchRaw =
          benchmarkAssetId === 'LIVRET_A'
            ? mPt.livretIndex
            : mPt.prices[benchmarkAssetId] ?? mPt.prices.XBB;

        backfilledMonthly.push({
          date: parseYearMonthToDate(`${mPt.yearMonth}-01`),
          isoOrYm: mPt.yearMonth,
          label: mPt.label,
          portVal: anchorDaily.portVal * Math.max(0.02, relBundle),
          benchIndex: mBenchRaw * benchScaleToDaily,
          invCum: anchorDaily.invCum,
        });
      }

      return normalizeWindowPoints([...backfilledMonthly, ...dailyRaw]);
    }
  }

  // Monthly portfolio path (standard Valoria simulated lots without daily FinanceAI history)
  const earliestLotIdx = Math.min(
    ...validLots.map((l) => {
      const idx = HISTORICAL_SERIES.findIndex(
        (p) => p.yearMonth === l.purchaseYearMonth
      );
      return idx === -1 ? totalLen - 1 : idx;
    })
  );

  const startIdx =
    period === 'ALL_HOLDING'
      ? Math.min(earliestLotIdx, totalLen - 2)
      : Math.max(0, totalLen - getTargetMonthsForPeriod(period, totalLen));

  const windowSlice = HISTORICAL_SERIES.slice(startIdx);
  if (windowSlice.length < 2) return [];

  // Precompute lot units for post-earliestLotIdx TWR tracking
  const lotUnits = validLots.map((l) => {
    const buyPt =
      HISTORICAL_SERIES.find((p) => p.yearMonth === l.purchaseYearMonth) ??
      HISTORICAL_SERIES[totalLen - 1];
    const assetPx = buyPt.prices[l.assetId] ?? 100;
    const benchPx =
      benchmarkAssetId === 'LIVRET_A'
        ? buyPt.livretIndex
        : buyPt.prices[benchmarkAssetId] ?? buyPt.prices.XBB;
    return {
      lot: l,
      units: l.investedAmount / assetPx,
      benchUnits: l.investedAmount / benchPx,
    };
  });

  // Build synthetic TWR index across the entire `windowSlice`:
  // - Before `earliestLotIdx` (or when all lots are at latest month): evolve via current portfolio weights
  // - From `earliestLotIdx` onward: evolve via TWR of held lots so cashflow additions don't distort %
  const anchorPt = HISTORICAL_SERIES[earliestLotIdx];
  const initialTotalInv = validLots.reduce((s, l) => s + l.investedAmount, 0);

  let twrPort = 1.0;
  let twrBench = 1.0;
  let prevHeldPortVal = 0;
  let prevHeldBenchVal = 0;

  const rawMonthly: RawWindowPoint[] = windowSlice.map((pt, i) => {
    const globalIdx = startIdx + i;
    const isLast = i === windowSlice.length - 1;
    const prevSlicePt = i > 0 ? windowSlice[i - 1] : null;

    const getAssetPx = (id: string, mPt = pt, lastFlag = isLast) =>
      lastFlag ? livePrices[id] ?? mPt.prices[id] : mPt.prices[id];

    const getBenchPx = (mPt = pt, lastFlag = isLast) =>
      benchmarkAssetId === 'LIVRET_A'
        ? mPt.livretIndex
        : lastFlag
          ? livePrices[benchmarkAssetId] ?? mPt.prices[benchmarkAssetId]
          : mPt.prices[benchmarkAssetId] ?? mPt.prices.XBB;

    if (globalIdx <= earliestLotIdx || earliestLotIdx >= totalLen - 1) {
      if (i > 0 && prevSlicePt) {
        let stepPort = 0;
        for (const [id, w] of Object.entries(assetWeights)) {
          const pPrev = prevSlicePt.prices[id] ?? 100;
          const pNow = getAssetPx(id, pt, isLast);
          stepPort += w * (pPrev > 0 ? pNow / pPrev : 1);
        }
        const bPrev = getBenchPx(prevSlicePt, false);
        const bNow = getBenchPx(pt, isLast);
        twrPort *= Math.max(0.05, stepPort);
        twrBench *= Math.max(0.05, bPrev > 0 ? bNow / bPrev : 1);
      }

      // Initialize held values when hitting `earliestLotIdx` so post-purchase steps chain smoothly
      if (globalIdx === earliestLotIdx) {
        let initPort = 0;
        let initBench = 0;
        const bPx = getBenchPx(anchorPt, isLast);
        for (const item of lotUnits) {
          if (item.lot.purchaseYearMonth <= pt.yearMonth) {
            initPort += item.units * getAssetPx(item.lot.assetId, pt, isLast);
            initBench += item.benchUnits * bPx;
          }
        }
        prevHeldPortVal = initPort;
        prevHeldBenchVal = initBench;
      }

      return {
        date: parseYearMonthToDate(`${pt.yearMonth}-01`),
        isoOrYm: pt.yearMonth,
        label: pt.label,
        portVal: initialTotalInv * twrPort,
        benchIndex: twrBench,
        invCum: initialTotalInv,
      };
    }

    // Post-earliestLotIdx TWR step
    let portVal = 0;
    let benchVal = 0;
    let invCum = 0;
    let cashFlowAdded = 0;
    const benchPx = getBenchPx(pt, isLast);

    for (const item of lotUnits) {
      if (item.lot.purchaseYearMonth <= pt.yearMonth) {
        const px = getAssetPx(item.lot.assetId, pt, isLast);
        portVal += item.units * px;
        benchVal += item.benchUnits * benchPx;
        invCum += item.lot.investedAmount;
        if (prevSlicePt && item.lot.purchaseYearMonth === pt.yearMonth) {
          cashFlowAdded += item.lot.investedAmount;
        }
      }
    }

    if (prevHeldPortVal > 0 && prevHeldBenchVal > 0) {
      const stepPortRet = (portVal - cashFlowAdded) / prevHeldPortVal;
      const stepBenchRet = (benchVal - cashFlowAdded) / prevHeldBenchVal;
      twrPort *= Math.max(0.05, stepPortRet);
      twrBench *= Math.max(0.05, stepBenchRet);
    }

    prevHeldPortVal = portVal;
    prevHeldBenchVal = benchVal;

    return {
      date: parseYearMonthToDate(`${pt.yearMonth}-01`),
      isoOrYm: pt.yearMonth,
      label: pt.label,
      portVal: startIdx < earliestLotIdx ? initialTotalInv * twrPort : portVal,
      benchIndex: twrBench,
      invCum: startIdx < earliestLotIdx ? initialTotalInv : invCum,
    };
  });

  // Note: when `startIdx >= earliestLotIdx` and multiple lots were added over time,
  // `twrPort` tracks exact time-weighted % while `portVal` holds actual $ CAD value.
  const b0 = Math.max(1e-6, rawMonthly[0].benchIndex);
  const t0 = Math.max(1e-6, startIdx < earliestLotIdx ? rawMonthly[0].portVal : 1);

  if (startIdx >= earliestLotIdx && earliestLotIdx < totalLen - 1) {
    // Recompute explicit TWR from rawMonthly while preserving actual $ CAD portfolioValueEur
    let cumTwrP = 1.0;
    let pPrev = 0;
    return windowSlice.map((pt, i) => {
      const isLast = i === windowSlice.length - 1;
      const prevYm = i > 0 ? windowSlice[i - 1].yearMonth : null;
      let pVal = 0;
      let bVal = 0;
      let inv = 0;
      let added = 0;
      const bPx =
        benchmarkAssetId === 'LIVRET_A'
          ? pt.livretIndex
          : isLast
            ? livePrices[benchmarkAssetId] ?? pt.prices[benchmarkAssetId]
            : pt.prices[benchmarkAssetId] ?? pt.prices.XBB;

      for (const item of lotUnits) {
        if (item.lot.purchaseYearMonth <= pt.yearMonth) {
          const px = isLast
            ? livePrices[item.lot.assetId] ?? pt.prices[item.lot.assetId]
            : pt.prices[item.lot.assetId];
          pVal += item.units * px;
          bVal += item.benchUnits * bPx;
          inv += item.lot.investedAmount;
          if (prevYm !== null && item.lot.purchaseYearMonth === pt.yearMonth) {
            added += item.lot.investedAmount;
          }
        }
      }
      if (i > 0 && pPrev > 0) {
        cumTwrP *= Math.max(0.05, (pVal - added) / pPrev);
      }
      pPrev = pVal;

      const portCumPct = i === 0 ? 0 : (cumTwrP - 1) * 100;
      const benchCumPct =
        i === 0 ? 0 : (rawMonthly[i].benchIndex / b0 - 1) * 100;
      const roundedPort = Number(portCumPct.toFixed(2));
      const roundedBench = Number(benchCumPct.toFixed(2));

      return {
        date: rawMonthly[i].date,
        yearMonth: pt.yearMonth,
        label: isLast ? `${pt.label} (Spot)` : pt.label,
        portfolioCumPct: roundedPort,
        benchmarkCumPct: roundedBench,
        alphaPct: Number((roundedPort - roundedBench).toFixed(2)),
        portfolioValueEur: Number(pVal.toFixed(2)),
        benchmarkValueEur: Number(bVal.toFixed(2)),
        investedCumulativeEur: Number(inv.toFixed(2)),
      };
    });
  }

  void t0;
  return normalizeWindowPoints(rawMonthly);
}

/**
 * Computes empirical historical annualized volatility & return from the 2015-2026 monthly series
 * for the user's exact selected asset weights (accounting for real historical cross-asset co-movements).
 */
export function computeHistoricalPortfolioStats(
  lots: PortfolioLot[],
  livePrices: Record<string, number>
): PortfolioHistoricalStats {
  const validLots = lots.filter(
    (l) => l.investedAmount > 0 && Boolean(getAssetById(l.assetId))
  );

  const valueByAsset: Record<string, number> = {};
  let totalValue = 0;

  for (const l of validLots) {
    const pos = evaluateLotMarketPosition(l, livePrices);
    valueByAsset[l.assetId] = (valueByAsset[l.assetId] ?? 0) + pos.currentValue;
    totalValue += pos.currentValue;
  }

  const assetIds = Object.keys(valueByAsset);
  if (assetIds.length === 0 || totalValue <= 0) {
    return {
      annualizedReturnPct: 6.5,
      annualizedVolatilityPct: 12.0,
      monthlyMeanLogReturn: 0.065 / 12,
      monthlyStdLogReturn: 0.12 / Math.sqrt(12),
      observationsCount: HISTORICAL_SERIES.length - 1,
      assetVolatilities: [],
    };
  }

  const weights: Record<string, number> = {};
  for (const id of assetIds) {
    weights[id] = valueByAsset[id] / totalValue;
  }

  const nObs = HISTORICAL_SERIES.length - 1;
  const portfolioMonthlyLogReturns: number[] = new Array(nObs);

  const assetVolatilities = assetIds
    .map((id) => {
      const asset = getAssetById(id)!;
      const logRets: number[] = [];
      for (let t = 1; t < HISTORICAL_SERIES.length; t++) {
        const pPrev = HISTORICAL_SERIES[t - 1].prices[id];
        const pCurr = HISTORICAL_SERIES[t].prices[id];
        logRets.push(Math.log(pCurr / pPrev));
      }
      const mean = logRets.reduce((s, x) => s + x, 0) / logRets.length;
      const variance =
        logRets.reduce((s, x) => s + (x - mean) * (x - mean), 0) /
        Math.max(1, logRets.length - 1);
      const annVol = Math.sqrt(variance * 12) * 100;
      const pureHistAnnRet = (Math.exp(mean * 12) - 1) * 100;
      const anchoredRet =
        0.45 * Math.min(26, pureHistAnnRet) +
        0.55 * (asset.baseExpectedReturnPct - asset.annualFeePct);

      return {
        assetId: id,
        name: asset.name,
        weightPct: Number((weights[id] * 100).toFixed(1)),
        historicalVolatilityPct: Number(annVol.toFixed(2)),
        historicalReturnPct: Number(anchoredRet.toFixed(2)),
      };
    })
    .sort((a, b) => b.weightPct - a.weightPct);

  for (let t = 1; t < HISTORICAL_SERIES.length; t++) {
    let portSimpleRet = 0;
    for (const id of assetIds) {
      const pPrev = HISTORICAL_SERIES[t - 1].prices[id];
      const pCurr = HISTORICAL_SERIES[t].prices[id];
      portSimpleRet += weights[id] * (pCurr / pPrev - 1);
    }
    portfolioMonthlyLogReturns[t - 1] = Math.log(Math.max(0.1, 1 + portSimpleRet));
  }

  const rawMeanMonthly =
    portfolioMonthlyLogReturns.reduce((s, x) => s + x, 0) / nObs;
  const varianceMonthly =
    portfolioMonthlyLogReturns.reduce(
      (s, x) => s + (x - rawMeanMonthly) * (x - rawMeanMonthly),
      0
    ) / Math.max(1, nObs - 1);

  const stdMonthly = Math.sqrt(varianceMonthly);
  const annVolPct = stdMonthly * Math.sqrt(12) * 100;

  const weightedAnchoredAnnualRetPct = assetVolatilities.reduce(
    (s, item) => s + (item.weightPct / 100) * item.historicalReturnPct,
    0
  );
  const effectiveMonthlyDrift =
    Math.log(1 + weightedAnchoredAnnualRetPct / 100) / 12;

  return {
    annualizedReturnPct: Number(weightedAnchoredAnnualRetPct.toFixed(2)),
    annualizedVolatilityPct: Number(Math.max(0.4, annVolPct).toFixed(2)),
    monthlyMeanLogReturn: effectiveMonthlyDrift,
    monthlyStdLogReturn: stdMonthly,
    observationsCount: nObs,
    assetVolatilities,
  };
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantileSorted(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (base + 1 < sorted.length) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Executes 10,000 genuine stochastic Monte Carlo trajectories in $ CAD based on the historical
 * volatility and return structure of the user's selected portfolio assets.
 */
export function runPortfolioMonteCarlo10k(params: {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  initialCapitalOverride?: number;
  monthlyContribution: number;
  horizonYears: number;
  scenarioCount?: number;
  seed?: number;
  baseYear?: number;
}): MonteCarlo10kResult {
  const {
    lots,
    livePrices,
    initialCapitalOverride,
    monthlyContribution,
    horizonYears,
    scenarioCount = 10000,
    seed = 20261112,
    baseYear = 2026,
  } = params;

  const stats = computeHistoricalPortfolioStats(lots, livePrices);

  let computedCap = 0;
  for (const l of lots) {
    if (l.investedAmount <= 0 || !getAssetById(l.assetId)) continue;
    computedCap += evaluateLotMarketPosition(l, livePrices).currentValue;
  }

  const initialCapital = Math.max(
    100,
    Math.round(initialCapitalOverride ?? (computedCap > 0 ? computedCap : 10000))
  );
  const pmtAnnual = Math.max(0, monthlyContribution) * 12;
  const years = Math.max(1, Math.min(30, Math.round(horizonYears)));
  const N = Math.max(100, scenarioCount);

  const sigmaAnnual = stats.annualizedVolatilityPct / 100;
  const muAnnual = stats.annualizedReturnPct / 100;
  const annualDrift =
    Math.log(Math.max(0.2, 1 + muAnnual)) - 0.5 * sigmaAnnual * sigmaAnnual;

  const rand = createMulberry32(seed);

  const currentWealth = new Float64Array(N);
  currentWealth.fill(initialCapital);
  const sortBuffer = new Float64Array(N);

  const sampleCount = Math.min(24, N);
  const sampleStride = Math.max(1, Math.floor(N / sampleCount));
  const samplePaths: number[][]= Array.from({ length: sampleCount }, () => [
    initialCapital,
  ]);

  const yearlyQuantiles: MonteCarlo10kYearPoint[] = [
    {
      year: 0,
      calendarYear: baseYear,
      totalInvested: initialCapital,
      p5: initialCapital,
      p10: initialCapital,
      p25: initialCapital,
      p50: initialCapital,
      p75: initialCapital,
      p90: initialCapital,
      p95: initialCapital,
      mean: initialCapital,
    },
  ];

  for (let y = 1; y <= years; y++) {
    let sumWealth = 0;

    for (let i = 0; i < N; i += 2) {
      const u1 = Math.max(1e-12, rand());
      const u2 = rand();
      const mag = Math.sqrt(-2.0 * Math.log(u1));
      const z0 = mag * Math.cos(2.0 * Math.PI * u2);
      const z1 = mag * Math.sin(2.0 * Math.PI * u2);

      const g0 = Math.exp(annualDrift + sigmaAnnual * z0);
      const g1 = Math.exp(annualDrift + sigmaAnnual * z1);

      const midGrowth0 = Math.sqrt(g0);
      const w0 = currentWealth[i] * g0 + pmtAnnual * midGrowth0;
      currentWealth[i] = w0;
      sortBuffer[i] = w0;
      sumWealth += w0;

      if (i + 1 < N) {
        const midGrowth1 = Math.sqrt(g1);
        const w1 = currentWealth[i + 1] * g1 + pmtAnnual * midGrowth1;
        currentWealth[i + 1] = w1;
        sortBuffer[i + 1] = w1;
        sumWealth += w1;
      }
    }

    for (let s = 0; s < sampleCount; s++) {
      const idx = Math.min(N - 1, s * sampleStride);
      samplePaths[s].push(Math.round(currentWealth[idx]));
    }

    sortBuffer.sort();
    const totalInvested = Math.round(initialCapital + pmtAnnual * y);

    yearlyQuantiles.push({
      year: y,
      calendarYear: baseYear + y,
      totalInvested,
      p5: Math.round(quantileSorted(sortBuffer, 0.05)),
      p10: Math.round(quantileSorted(sortBuffer, 0.1)),
      p25: Math.round(quantileSorted(sortBuffer, 0.25)),
      p50: Math.round(quantileSorted(sortBuffer, 0.5)),
      p75: Math.round(quantileSorted(sortBuffer, 0.75)),
      p90: Math.round(quantileSorted(sortBuffer, 0.9)),
      p95: Math.round(quantileSorted(sortBuffer, 0.95)),
      mean: Math.round(sumWealth / N),
    });
  }

  const finalTotalInvested = initialCapital + pmtAnnual * years;
  let aboveInvestedCount = 0;
  let doubledInvestedCount = 0;
  for (let i = 0; i < N; i++) {
    if (sortBuffer[i] >= finalTotalInvested) aboveInvestedCount++;
    if (sortBuffer[i] >= finalTotalInvested * 2) doubledInvestedCount++;
  }

  const histMin = quantileSorted(sortBuffer, 0.02);
  const histMax = Math.max(histMin + 100, quantileSorted(sortBuffer, 0.98));
  const binCount = 10;
  const binWidth = (histMax - histMin) / binCount;
  const bins = Array.from({ length: binCount }, (_, b) => ({
    minEur: Math.round(histMin + b * binWidth),
    maxEur: Math.round(histMin + (b + 1) * binWidth),
    count: 0,
    sharePct: 0,
  }));

  for (let i = 0; i < N; i++) {
    const val = sortBuffer[i];
    if (val < histMin || val > histMax) continue;
    const bIdx = Math.min(binCount - 1, Math.max(0, Math.floor((val - histMin) / binWidth)));
    bins[bIdx].count++;
  }
  for (const bin of bins) {
    bin.sharePct = Number(((bin.count / N) * 100).toFixed(1));
  }

  return {
    scenarioCount: N,
    horizonYears: years,
    initialCapital,
    monthlyContribution,
    historicalStats: stats,
    yearlyQuantiles,
    samplePaths,
    finalDistributionBins: bins,
    probabilityOfGainPct: Number(((aboveInvestedCount / N) * 100).toFixed(1)),
    probabilityOfDoublingInvestedPct: Number(
      ((doubledInvestedCount / N) * 100).toFixed(1)
    ),
  };
}
