import { getAssetById } from './marketData';
import { buildAssetTechnicalAnalysis } from './dailyTechnicalIndicators';

export interface Sparkline30dPoint {
  dayIndex: number;
  dateISO: string;
  labelShort: string;
  closeCad: number;
}

export interface Asset30DaySparklineData {
  assetId: string;
  ticker: string;
  points: Sparkline30dPoint[];
  startPriceCad: number;
  endPriceCad: number;
  minPriceCad: number;
  maxPriceCad: number;
  change30dCad: number;
  change30dPct: number;
  isPositive30d: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoUtcMs(dateISO: string): number {
  const parts = dateISO.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return NaN;
  }
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Extracts a clean 30-calendar-day daily close trajectory (~22 trading sessions)
 * in $ CAD anchored to the asset's verified spot price and 1-month return.
 */
export function buildAsset30DaySparklineSeries(
  assetId: string,
  liveSpotOverrideCad?: number,
  customDailyHistoryCad?: { date: string; valueCad: number }[]
): Asset30DaySparklineData {
  const asset = getAssetById(assetId);
  const ticker = asset?.ticker ?? assetId;

  if (customDailyHistoryCad && customDailyHistoryCad.length >= 2) {
    const valid = customDailyHistoryCad.filter(
      (pt) => Number.isFinite(pt.valueCad) && pt.valueCad > 0
    );
    if (valid.length >= 2) {
      const lastMs = parseIsoUtcMs(valid[valid.length - 1].date);
      const cutoffMs = Number.isFinite(lastMs) ? lastMs - 30 * MS_PER_DAY : NaN;
      const within30d = Number.isFinite(cutoffMs)
        ? valid.filter((pt) => {
            const ms = parseIsoUtcMs(pt.date);
            return Number.isFinite(ms) && ms >= cutoffMs;
          })
        : valid.slice(-30);

      const slice = within30d.length >= 2 ? within30d : valid.slice(-22);
      const points: Sparkline30dPoint[] = slice.map((pt, idx) => ({
        dayIndex: idx,
        dateISO: pt.date,
        labelShort: pt.date,
        closeCad: Number(pt.valueCad.toFixed(4)),
      }));
      return summarize30dPoints(assetId, ticker, points);
    }
  }

  const tech = buildAssetTechnicalAnalysis(assetId, liveSpotOverrideCad);
  const bars = tech.bars2Y;

  if (bars.length === 0) {
    const fallbackSpot =
      liveSpotOverrideCad && liveSpotOverrideCad > 0 ? liveSpotOverrideCad : 100;
    const flatPoints: Sparkline30dPoint[] = [
      {
        dayIndex: 0,
        dateISO: '2026-10-07',
        labelShort: '7 oct. 26',
        closeCad: fallbackSpot,
      },
      {
        dayIndex: 1,
        dateISO: '2026-11-06',
        labelShort: '6 nov. 26',
        closeCad: fallbackSpot,
      },
    ];
    return summarize30dPoints(assetId, ticker, flatPoints);
  }

  const endMs = parseIsoUtcMs(bars[bars.length - 1].dateISO);
  const cutoff30dMs = Number.isFinite(endMs) ? endMs - 30 * MS_PER_DAY : NaN;

  const filteredBars = Number.isFinite(cutoff30dMs)
    ? bars.filter((b) => {
        const ms = parseIsoUtcMs(b.dateISO);
        return Number.isFinite(ms) && ms >= cutoff30dMs;
      })
    : bars.slice(-22);

  const effectiveBars =
    filteredBars.length >= 5 ? filteredBars : bars.slice(-Math.min(22, bars.length));

  const points: Sparkline30dPoint[] = effectiveBars.map((b, idx) => ({
    dayIndex: idx,
    dateISO: b.dateISO,
    labelShort: b.labelShort,
    closeCad: b.closeCad,
  }));

  return summarize30dPoints(assetId, ticker, points);
}

function summarize30dPoints(
  assetId: string,
  ticker: string,
  points: Sparkline30dPoint[]
): Asset30DaySparklineData {
  const startPriceCad = points[0]?.closeCad ?? 100;
  const endPriceCad = points[points.length - 1]?.closeCad ?? startPriceCad;
  let minPriceCad = Infinity;
  let maxPriceCad = -Infinity;

  for (const pt of points) {
    if (pt.closeCad < minPriceCad) minPriceCad = pt.closeCad;
    if (pt.closeCad > maxPriceCad) maxPriceCad = pt.closeCad;
  }

  if (!Number.isFinite(minPriceCad)) minPriceCad = endPriceCad;
  if (!Number.isFinite(maxPriceCad)) maxPriceCad = endPriceCad;

  const change30dCad = Number((endPriceCad - startPriceCad).toFixed(4));
  const change30dPct =
    startPriceCad > 0
      ? Number((((endPriceCad - startPriceCad) / startPriceCad) * 100).toFixed(2))
      : 0;

  return {
    assetId,
    ticker,
    points,
    startPriceCad,
    endPriceCad,
    minPriceCad,
    maxPriceCad,
    change30dCad,
    change30dPct,
    isPositive30d: change30dCad >= -1e-6,
  };
}
