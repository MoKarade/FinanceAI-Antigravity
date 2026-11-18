import {
  HISTORICAL_SERIES,
  VERIFIED_TRAILING_RETURNS_CAD_2026_11,
  getAssetById,
} from './marketData';
import type { UniversalAssetAnalysis } from './multiAssetQuantEngine';

export type TechnicalTimeframe = '6M' | '1A' | '2A';

export type SemanticTone = 'positive' | 'neutral' | 'negative';

export interface DailyTechnicalBar {
  index: number;
  dateISO: string;
  labelShort: string;
  closeCad: number;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
}

export interface MovingAverageCrossEvent {
  barIndex: number;
  dateISO: string;
  labelShort: string;
  type: 'golden_cross' | 'death_cross';
  priceCad: number;
  sma200Cad: number;
  shortLabel: string;
}

interface BeginnerIndicatorBadge {
  title: string;
  valueLabel: string;
  plainVerdict: string;
  microHint: string;
  tone: SemanticTone;
  meterPct: number; // 0..100 visual bar position
}

export interface AssetDailyTechnicalAnalysis {
  assetId: string;
  spotCad: number;
  bars2Y: DailyTechnicalBar[]; // 504 trading days with warmed-up SMA50, SMA200, RSI14, MACD
  crossEvents2Y: MovingAverageCrossEvent[];
  latest: {
    closeCad: number;
    sma50Cad: number;
    sma200Cad: number;
    gapVsSma50Pct: number;
    gapVsSma200Pct: number;
    sma50AboveSma200: boolean;
    rsi14: number;
    macdLine: number;
    signalLine: number;
    histogram: number;
  };
  overallTechnicalScore: number; // 0..100
  overallTone: SemanticTone;
  overallVerdictShort: string;
  beginnerBadges: {
    movingAverages: BeginnerIndicatorBadge;
    rsi: BeginnerIndicatorBadge;
    macd: BeginnerIndicatorBadge;
  };
}

interface VisualXRayPillar {
  id: string;
  label: string;
  score: number; // 0..100
  valueBadge: string;
  plainMeaning: string;
  tone: SemanticTone;
}

export interface BeginnerStockVisualXRay {
  verdictTone: SemanticTone;
  verdictWord: 'ACHETER' | 'GARDER' | 'VENDRE';
  verdictArrow: '▲' | '●' | '▼';
  beginnerOneLiner: string;
  fairPriceCad: number;
  spotPriceCad: number;
  upsidePct: number;
  thermometerPositionPct: number; // 0 = bargain (green), 50 = fair, 100 = overpriced (red)
  thermometerLabel: string;
  low52wCad: number;
  high52wCad: number;
  range52wPct: number; // 0..100 where current price sits between 52w low and high
  piotroskiSegments: number; // 0..9 lit blocks
  piotroskiMax: 9;
  pillars: VisualXRayPillar[];
}

const MONTHS_SHORT_FR = [
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

function hashAssetSeed(assetId: string): number {
  let h = 2166136261;
  for (let i = 0; i < assetId.length; i++) {
    h ^= assetId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pseudoNormal(step: number, seed: number): number {
  const a = Math.sin(step * 12.9898 + seed * 0.137) * 43758.5453;
  const u1 = Math.max(1e-6, Math.min(0.999999, a - Math.floor(a)));
  const b = Math.cos(step * 78.233 + seed * 0.293) * 29431.8192;
  const u2 = Math.max(1e-6, Math.min(0.999999, b - Math.floor(b)));
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function buildTradingDatesEndingAt(
  endYear: number,
  endMonth: number,
  endDay: number,
  totalTradingDays: number
): { dateISO: string; labelShort: string }[] {
  const cursor = new Date(Date.UTC(endYear, endMonth - 1, endDay));
  const reversed: { dateISO: string; labelShort: string }[] = [];

  while (reversed.length < totalTradingDays) {
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getUTCFullYear();
      const m = cursor.getUTCMonth();
      const d = cursor.getUTCDate();
      const dateISO = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const labelShort = `${d} ${MONTHS_SHORT_FR[m]} ${String(y).slice(2)}`;
      reversed.push({ dateISO, labelShort });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return reversed.reverse();
}

function interpolateLogBridge(
  startVal: number,
  endVal: number,
  steps: number,
  dailySigma: number,
  seed: number,
  offsetStep: number
): number[] {
  if (steps <= 1) return [endVal];
  const logStart = Math.log(Math.max(0.0001, startVal));
  const logEnd = Math.log(Math.max(0.0001, endVal));

  // Raw cumulative walk in log space
  const rawWalk: number[] = [0];
  let acc = 0;
  for (let i = 1; i <= steps; i++) {
    acc += pseudoNormal(offsetStep + i, seed) * dailySigma;
    rawWalk.push(acc);
  }

  // Brownian bridge pins exact start (i=0) and exact end (i=steps)
  const out: number[] = [];
  const terminalDrift = rawWalk[steps];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const bridgedNoise = rawWalk[i] - t * terminalDrift;
    const logPrice = logStart + t * (logEnd - logStart) + bridgedNoise * 0.72;
    out.push(Math.exp(logPrice));
  }
  return out;
}

function buildDailyClosesCad(
  assetId: string,
  liveSpotOverrideCad?: number
): { dates: { dateISO: string; labelShort: string }[]; closes: number[] } {
  const asset = getAssetById(assetId);
  const totalMonthsToUse = Math.min(36, HISTORICAL_SERIES.length);
  const recentMonths = HISTORICAL_SERIES.slice(-totalMonthsToUse);
  const baseLastSpot =
    recentMonths[recentMonths.length - 1]?.prices[assetId] ?? 100;
  const spotCad =
    liveSpotOverrideCad && liveSpotOverrideCad > 0
      ? liveSpotOverrideCad
      : baseLastSpot;
  const scale = baseLastSpot > 0 ? spotCad / baseLastSpot : 1;

  const annualVolPct =
    assetId === 'CASH' ? 0.35 : Math.max(5, asset?.baseVolatilityPct ?? 22);
  const dailySigma = (annualVolPct / 100) / Math.sqrt(252);
  const seed = hashAssetSeed(assetId);

  // Build knot sequence (index -> exact $ CAD price) across 735 trading days (35 intervals * 21d)
  const tradingDaysPerMonth = 21;
  const totalIntervals = recentMonths.length - 1;
  const totalBars = totalIntervals * tradingDaysPerMonth + 1;
  const knotMap = new Map<number, number>();

  for (let m = 0; m < recentMonths.length; m++) {
    const rawPrice = recentMonths[m].prices[assetId] ?? baseLastSpot;
    knotMap.set(m * tradingDaysPerMonth, Math.max(0.01, rawPrice * scale));
  }

  // Anchor final 252 trading days to verified 12M / 6M / 3M / 1M / 5D / 1D trailing returns
  const trailing = VERIFIED_TRAILING_RETURNS_CAD_2026_11[assetId];
  const lastIdx = totalBars - 1;
  knotMap.set(lastIdx, spotCad);

  if (trailing && assetId !== 'CASH') {
    const pinFromPct = (daysBack: number, pct: number) => {
      const idx = lastIdx - daysBack;
      if (idx > 0 && Number.isFinite(pct) && pct > -95) {
        const impliedPast = spotCad / (1 + pct / 100);
        if (impliedPast > 0) {
          knotMap.set(idx, impliedPast);
        }
      }
    };
    pinFromPct(252, trailing.r12mPct);
    pinFromPct(126, trailing.r6mPct);
    pinFromPct(63, trailing.r3mPct);
    pinFromPct(21, trailing.r1mPct);
    pinFromPct(5, trailing.r5dPct);
    pinFromPct(1, trailing.r1dPct);
  }

  const sortedKnots = Array.from(knotMap.entries()).sort((a, b) => a[0] - b[0]);
  const closes: number[] = [sortedKnots[0][1]];

  for (let k = 0; k < sortedKnots.length - 1; k++) {
    const [idxA, valA] = sortedKnots[k];
    const [idxB, valB] = sortedKnots[k + 1];
    const steps = idxB - idxA;
    if (steps <= 0) continue;
    const segment = interpolateLogBridge(
      valA,
      valB,
      steps,
      dailySigma,
      seed + k * 17,
      idxA
    );
    for (const p of segment) {
      closes.push(Number(p.toFixed(4)));
    }
  }

  closes[closes.length - 1] = Number(spotCad.toFixed(4));
  const dates = buildTradingDatesEndingAt(2026, 11, 6, closes.length);
  return { dates, closes };
}

export function computeSmaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;

  let rollingSum = 0;
  for (let i = 0; i < values.length; i++) {
    rollingSum += values[i];
    if (i >= period) {
      rollingSum -= values[i - period];
    }
    if (i >= period - 1) {
      out[i] = Number((rollingSum / period).toFixed(4));
    }
  }
  return out;
}

export function computeWilderRsiSeries(
  values: number[],
  period = 14
): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += -diff;
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const toRsi = (g: number, l: number) => {
    if (l <= 1e-10 && g <= 1e-10) return 50;
    if (l <= 1e-10) return 100;
    const rs = g / l;
    return Math.max(0, Math.min(100, 100 - 100 / (1 + rs)));
  };

  out[period] = Number(toRsi(avgGain, avgLoss).toFixed(2));

  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = Number(toRsi(avgGain, avgLoss).toFixed(2));
  }

  return out;
}

function computeEmaFull(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export function computeMacdSeries(
  values: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const n = values.length;
  const macdOut: (number | null)[] = new Array(n).fill(null);
  const sigOut: (number | null)[] = new Array(n).fill(null);
  const histOut: (number | null)[] = new Array(n).fill(null);
  if (n < slowPeriod + signalPeriod) {
    return { macdLine: macdOut, signalLine: sigOut, histogram: histOut };
  }

  const emaFast = computeEmaFull(values, fastPeriod);
  const emaSlow = computeEmaFull(values, slowPeriod);
  const rawMacd = emaFast.map((f, idx) => f - emaSlow[idx]);
  const rawSignal = computeEmaFull(rawMacd, signalPeriod);

  const warmupIdx = slowPeriod - 1;
  for (let i = warmupIdx; i < n; i++) {
    const m = Number(rawMacd[i].toFixed(4));
    macdOut[i] = m;
    if (i >= warmupIdx + signalPeriod - 1) {
      const s = Number(rawSignal[i].toFixed(4));
      sigOut[i] = s;
      histOut[i] = Number((m - s).toFixed(4));
    }
  }

  return { macdLine: macdOut, signalLine: sigOut, histogram: histOut };
}

const TECHNICAL_CACHE = new Map<string, AssetDailyTechnicalAnalysis>();

export function buildAssetTechnicalAnalysis(
  assetId: string,
  liveSpotOverrideCad?: number
): AssetDailyTechnicalAnalysis {
  const roundedOverride =
    liveSpotOverrideCad && liveSpotOverrideCad > 0
      ? Number(liveSpotOverrideCad.toFixed(2))
      : 0;
  const cacheKey = `${assetId}:${roundedOverride}`;
  const cached = TECHNICAL_CACHE.get(cacheKey);
  if (cached) return cached;

  const { dates, closes } = buildDailyClosesCad(assetId, liveSpotOverrideCad);
  const sma50Arr = computeSmaSeries(closes, 50);
  const sma200Arr = computeSmaSeries(closes, 200);
  const rsi14Arr = computeWilderRsiSeries(closes, 14);
  const macdObj = computeMacdSeries(closes, 12, 26, 9);

  const allBars: DailyTechnicalBar[] = closes.map((closeCad, i) => ({
    index: i,
    dateISO: dates[i].dateISO,
    labelShort: dates[i].labelShort,
    closeCad,
    sma50: sma50Arr[i],
    sma200: sma200Arr[i],
    rsi14: rsi14Arr[i],
    macdLine: macdObj.macdLine[i],
    signalLine: macdObj.signalLine[i],
    histogram: macdObj.histogram[i],
  }));

  // Keep last 504 trading days (~2 full years) where SMA200 is 100% warmed up
  const visibleCount = Math.min(504, Math.max(120, allBars.length - 200));
  const bars2Y = allBars
    .slice(-visibleCount)
    .map((b, idx) => ({ ...b, index: idx }));

  const crossEvents2Y: MovingAverageCrossEvent[] = [];
  for (let i = 1; i < bars2Y.length; i++) {
    const prev50 = bars2Y[i - 1].sma50;
    const prev200 = bars2Y[i - 1].sma200;
    const curr50 = bars2Y[i].sma50;
    const curr200 = bars2Y[i].sma200;
    if (
      prev50 !== null &&
      prev200 !== null &&
      curr50 !== null &&
      curr200 !== null
    ) {
      if (prev50 <= prev200 && curr50 > curr200) {
        crossEvents2Y.push({
          barIndex: i,
          dateISO: bars2Y[i].dateISO,
          labelShort: bars2Y[i].labelShort,
          type: 'golden_cross',
          priceCad: bars2Y[i].closeCad,
          sma200Cad: curr200,
          shortLabel: 'Croisement Doré ↑',
        });
      } else if (prev50 >= prev200 && curr50 < curr200) {
        crossEvents2Y.push({
          barIndex: i,
          dateISO: bars2Y[i].dateISO,
          labelShort: bars2Y[i].labelShort,
          type: 'death_cross',
          priceCad: bars2Y[i].closeCad,
          sma200Cad: curr200,
          shortLabel: 'Croisement Baissier ↓',
        });
      }
    }
  }

  const lastBar = bars2Y[bars2Y.length - 1];
  const closeCad = lastBar.closeCad;
  const sma50Cad = lastBar.sma50 ?? closeCad;
  const sma200Cad = lastBar.sma200 ?? closeCad;
  const rsi14 = lastBar.rsi14 ?? 50;
  const macdLine = lastBar.macdLine ?? 0;
  const signalLine = lastBar.signalLine ?? 0;
  const histogram = lastBar.histogram ?? 0;

  const gapVsSma50Pct =
    sma50Cad > 0 ? Number((((closeCad - sma50Cad) / sma50Cad) * 100).toFixed(1)) : 0;
  const gapVsSma200Pct =
    sma200Cad > 0
      ? Number((((closeCad - sma200Cad) / sma200Cad) * 100).toFixed(1))
      : 0;
  const sma50AboveSma200 = sma50Cad >= sma200Cad;

  // 1) Moving Average Beginner Badge
  let maTone: SemanticTone = 'neutral';
  let maVerdict = 'Zone d’équilibre';
  let maHint = 'Prix proche de sa moyenne 200 jours';
  let maScore = 52;
  if (closeCad > sma200Cad && sma50AboveSma200) {
    maTone = 'positive';
    maVerdict = 'Tendance haussière saine';
    maHint = 'Prix au-dessus des moyennes 50 et 200j';
    maScore = Math.min(94, Math.round(68 + Math.min(24, Math.max(0, gapVsSma200Pct))));
  } else if (closeCad < sma200Cad && !sma50AboveSma200) {
    maTone = 'negative';
    maVerdict = 'Tendance de fond fragile';
    maHint = 'Prix sous les moyennes 50 et 200j';
    maScore = Math.max(12, Math.round(36 + Math.max(-24, gapVsSma200Pct)));
  } else if (closeCad > sma200Cad) {
    maTone = 'positive';
    maVerdict = 'Reprise long terme';
    maHint = 'Au-dessus de la moyenne 200 jours';
    maScore = 64;
  } else {
    maTone = 'negative';
    maVerdict = 'Repli sous moyenne 200j';
    maHint = 'Attend un retour au-dessus de MM200';
    maScore = 38;
  }

  // 2) RSI-14 Beginner Badge
  let rsiTone: SemanticTone = 'neutral';
  let rsiVerdict = 'Température normale';
  let rsiHint = 'Ni trop acheté ni bradé (30–70)';
  let rsiContrib = 55;
  if (rsi14 <= 32) {
    rsiTone = 'positive';
    rsiVerdict = 'Survendu · Rebonds possibles';
    rsiHint = 'Ventes excessives (< 32), prix comprimé';
    rsiContrib = 76;
  } else if (rsi14 >= 70) {
    rsiTone = 'negative';
    rsiVerdict = 'Surchauffe · Attention';
    rsiHint = 'Hausse rapide (> 70), risque de pause';
    rsiContrib = 28;
  } else if (rsi14 >= 52 && rsi14 < 68) {
    rsiTone = 'positive';
    rsiVerdict = 'Force acheteuse saine';
    rsiHint = 'Acheteurs présents sans excès';
    rsiContrib = 70;
  } else if (rsi14 < 44) {
    rsiTone = 'negative';
    rsiVerdict = 'Pression vendeuse';
    rsiHint = 'Les vendeurs dominent à court terme';
    rsiContrib = 38;
  }

  // 3) MACD Beginner Badge
  const prevHist = bars2Y[Math.max(0, bars2Y.length - 2)]?.histogram ?? histogram;
  const histRising = histogram >= prevHist;
  let macdTone: SemanticTone = 'neutral';
  let macdVerdict = 'Élan stable';
  let macdHint = 'Acheteurs et vendeurs s’équilibrent';
  let macdScore = 50;
  if (histogram > 0 && histRising) {
    macdTone = 'positive';
    macdVerdict = 'Élan acheteur en hausse';
    macdHint = 'Barres vertes croissantes (accélération)';
    macdScore = 82;
  } else if (histogram > 0) {
    macdTone = 'positive';
    macdVerdict = 'Élan positif modéré';
    macdHint = 'MACD au-dessus de sa ligne signal';
    macdScore = 66;
  } else if (histogram < 0 && !histRising) {
    macdTone = 'negative';
    macdVerdict = 'Élan vendeur marqué';
    macdHint = 'Barres rouges creusées (baisse active)';
    macdScore = 24;
  } else if (histogram < 0 && histRising) {
    macdTone = 'neutral';
    macdVerdict = 'Baisse qui ralentit';
    macdHint = 'Barres rouges qui diminuent';
    macdScore = 46;
  }

  const overallTechnicalScore = Math.max(
    8,
    Math.min(96, Math.round(maScore * 0.45 + rsiContrib * 0.25 + macdScore * 0.3))
  );
  const overallTone: SemanticTone =
    overallTechnicalScore >= 62
      ? 'positive'
      : overallTechnicalScore <= 42
        ? 'negative'
        : 'neutral';
  const overallVerdictShort =
    overallTone === 'positive'
      ? 'Courbe bien orientée'
      : overallTone === 'negative'
        ? 'Courbe sous pression'
        : 'Courbe en attente';

  const result: AssetDailyTechnicalAnalysis = {
    assetId,
    spotCad: closeCad,
    bars2Y,
    crossEvents2Y,
    latest: {
      closeCad,
      sma50Cad,
      sma200Cad,
      gapVsSma50Pct,
      gapVsSma200Pct,
      sma50AboveSma200,
      rsi14,
      macdLine,
      signalLine,
      histogram,
    },
    overallTechnicalScore,
    overallTone,
    overallVerdictShort,
    beginnerBadges: {
      movingAverages: {
        title: 'Moyennes 50 & 200 jours',
        valueLabel: `${gapVsSma200Pct >= 0 ? '+' : ''}${gapVsSma200Pct.toFixed(1)} % vs 200j`,
        plainVerdict: maVerdict,
        microHint: maHint,
        tone: maTone,
        meterPct: maScore,
      },
      rsi: {
        title: 'RSI (14 jours)',
        valueLabel: `${rsi14.toFixed(0)} / 100`,
        plainVerdict: rsiVerdict,
        microHint: rsiHint,
        tone: rsiTone,
        meterPct: Math.round(rsi14),
      },
      macd: {
        title: 'MACD (12 · 26 · 9)',
        valueLabel: `${histogram >= 0 ? '+' : ''}${histogram.toFixed(2)}`,
        plainVerdict: macdVerdict,
        microHint: macdHint,
        tone: macdTone,
        meterPct: macdScore,
      },
    },
  };

  if (TECHNICAL_CACHE.size > 600) {
    TECHNICAL_CACHE.clear();
  }
  TECHNICAL_CACHE.set(cacheKey, result);
  return result;
}

export function sliceTechnicalBarsByTimeframe(
  analysis: AssetDailyTechnicalAnalysis,
  timeframe: TechnicalTimeframe
): {
  bars: DailyTechnicalBar[];
  crosses: MovingAverageCrossEvent[];
} {
  const count =
    timeframe === '6M' ? 126 : timeframe === '1A' ? 252 : analysis.bars2Y.length;
  const startOffset = Math.max(0, analysis.bars2Y.length - count);
  const bars = analysis.bars2Y
    .slice(startOffset)
    .map((b, idx) => ({ ...b, index: idx }));
  const crosses = analysis.crossEvents2Y
    .filter((c) => c.barIndex >= startOffset)
    .map((c) => ({ ...c, barIndex: c.barIndex - startOffset }));
  return { bars, crosses };
}

export function computeBeginnerStockVisualXRay(
  analysis: UniversalAssetAnalysis,
  techOverride?: AssetDailyTechnicalAnalysis
): BeginnerStockVisualXRay {
  const tech =
    techOverride ??
    buildAssetTechnicalAnalysis(analysis.asset.id, analysis.spotPriceCad);

  const isBuy =
    analysis.signal === 'ACHAT FORT' || analysis.signal === 'ACHETER';
  const isSell =
    analysis.signal === 'VENDRE' || analysis.signal === 'ALLÉGER';

  const verdictTone: SemanticTone = isBuy
    ? 'positive'
    : isSell
      ? 'negative'
      : 'neutral';
  const verdictWord: 'ACHETER' | 'GARDER' | 'VENDRE' = isBuy
    ? 'ACHETER'
    : isSell
      ? 'VENDRE'
      : 'GARDER';
  const verdictArrow: '▲' | '●' | '▼' = isBuy ? '▲' : isSell ? '▼' : '●';

  const upsidePct = analysis.upsidePct;
  const fairPriceCad = analysis.fairValueCad;
  const spotPriceCad = analysis.spotPriceCad;

  // Thermometer: 0% = deep bargain (+30% upside), 50% = fair value (0%), 100% = expensive (-25% upside)
  const thermometerPositionPct = Math.max(
    4,
    Math.min(96, Math.round(50 - upsidePct * 1.65))
  );
  const thermometerLabel =
    upsidePct >= 10
      ? `Prix attractif (${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(0)} % de marge)`
      : upsidePct <= -8
        ? `Trop cher (${upsidePct.toFixed(0)} % sous le prix actuel)`
        : 'Proche de sa vraie valeur';

  // 52W range
  const trailing = VERIFIED_TRAILING_RETURNS_CAD_2026_11[analysis.asset.id];
  const min2Y = Math.min(...tech.bars2Y.slice(-252).map((b) => b.closeCad));
  const max2Y = Math.max(...tech.bars2Y.slice(-252).map((b) => b.closeCad));
  const low52wCad = Math.min(
    spotPriceCad,
    trailing?.low52wCad && trailing.low52wCad > 0 ? trailing.low52wCad : min2Y
  );
  const high52wCad = Math.max(
    spotPriceCad,
    trailing?.high52wCad && trailing.high52wCad > 0 ? trailing.high52wCad : max2Y
  );
  const span52w = Math.max(0.01, high52wCad - low52wCad);
  const range52wPct = Math.max(
    2,
    Math.min(98, Math.round(((spotPriceCad - low52wCad) / span52w) * 100))
  );

  const eq = analysis.equityDetails;
  const piotroskiSegments = eq
    ? Math.max(1, Math.min(9, Math.round(eq.piotroskiFScore)))
    : Math.max(2, Math.min(9, Math.round(analysis.pillars.quality / 11)));

  // 6 visual X-Ray bars in plain everyday French
  const valueScore = Math.max(8, Math.min(96, Math.round(analysis.pillars.valuation)));
  const qualityScore = Math.max(8, Math.min(96, Math.round(analysis.pillars.quality)));
  const profitScore = eq
    ? Math.max(
        10,
        Math.min(
          96,
          Math.round(
            Math.min(45, Math.max(0, eq.roicPct * 1.8)) +
              Math.min(30, Math.max(0, eq.operatingMarginPct * 0.9)) +
              Math.min(25, Math.max(0, eq.epsGrowthNextYrPct * 1.1))
          )
        )
      )
    : Math.max(15, Math.min(92, Math.round(analysis.pillars.growthOrCarry)));

  const calmScore = Math.max(
    10,
    Math.min(96, Math.round(100 - Math.min(85, analysis.volatilityPct * 1.45)))
  );
  const incomeYield = analysis.netRealYieldPct;
  const incomeScore = Math.max(
    12,
    Math.min(95, Math.round(18 + Math.max(0, incomeYield) * 13))
  );

  const toneOf = (s: number): SemanticTone =>
    s >= 63 ? 'positive' : s <= 40 ? 'negative' : 'neutral';

  const pillars: VisualXRayPillar[] = [
    {
      id: 'prix',
      label: 'Prix vs Vraie Valeur',
      score: valueScore,
      valueBadge: `${upsidePct >= 0 ? '+' : ''}${upsidePct.toFixed(1)} %`,
      plainMeaning:
        upsidePct >= 8
          ? 'Sous son vrai prix estimé'
          : upsidePct <= -6
            ? 'Payé cher aujourd’hui'
            : 'Prix cohérent',
      tone: upsidePct >= 8 ? 'positive' : upsidePct <= -6 ? 'negative' : 'neutral',
    },
    {
      id: 'solidite',
      label: 'Solidité Financière',
      score: qualityScore,
      valueBadge: `${piotroskiSegments} / 9`,
      plainMeaning:
        qualityScore >= 68
          ? 'Bilan rassurant, peu de dettes'
          : qualityScore <= 42
            ? 'Dette lourde ou bilan tendu'
            : 'Solidité correcte',
      tone: toneOf(qualityScore),
    },
    {
      id: 'profits',
      label: 'Force des Profits',
      score: profitScore,
      valueBadge: eq ? `Marge ${eq.operatingMarginPct.toFixed(0)} %` : `${profitScore}/100`,
      plainMeaning:
        profitScore >= 65
          ? 'Gagne beaucoup d’argent'
          : profitScore <= 40
            ? 'Rentabilité fragile'
            : 'Profits réguliers',
      tone: toneOf(profitScore),
    },
    {
      id: 'courbe',
      label: 'Tendance Courbe (MM/RSI)',
      score: tech.overallTechnicalScore,
      valueBadge: `RSI ${tech.latest.rsi14.toFixed(0)}`,
      plainMeaning: tech.overallVerdictShort,
      tone: tech.overallTone,
    },
    {
      id: 'calme',
      label: 'Stabilité en Krach',
      score: calmScore,
      valueBadge: `±${analysis.volatilityPct.toFixed(0)} %/an`,
      plainMeaning:
        calmScore >= 68
          ? 'Bouge peu, rassurant'
          : calmScore <= 40
            ? 'Fortes secousses possibles'
            : 'Variations normales',
      tone: toneOf(calmScore),
    },
    {
      id: 'revenu',
      label: 'Revenu Versé / An',
      score: incomeScore,
      valueBadge:
        incomeYield > 0.1 ? `${incomeYield.toFixed(1)} % / an` : '0 % · Croissance',
      plainMeaning:
        incomeYield >= 3.2
          ? 'Verse un bon revenu régulier'
          : incomeYield > 0.2
            ? 'Petit dividende + croissance'
            : 'Réinvestit tout pour grandir',
      tone: incomeYield >= 3.2 ? 'positive' : 'neutral',
    },
  ];

  // Ultra-clear 1-sentence beginner explanation (zero technical jargon)
  let beginnerOneLiner = '';
  if (isBuy) {
    if (upsidePct >= 10 && qualityScore >= 65) {
      beginnerOneLiner = `Entreprise très solide vendue ${upsidePct.toFixed(0)} % sous sa vraie valeur estimée.`;
    } else {
      beginnerOneLiner = `Bon potentiel de hausse en $ CAD avec des finances saines.`;
    }
  } else if (isSell) {
    if (upsidePct <= -8 && qualityScore <= 45) {
      beginnerOneLiner = `Action trop chère et bilan fragile : mieux vaut sécuriser ailleurs.`;
    } else if (upsidePct <= -8) {
      beginnerOneLiner = `Belle entreprise mais prix monté trop haut (${upsidePct.toFixed(0)} % au-dessus du juste prix).`;
    } else {
      beginnerOneLiner = `Risque élevé par rapport au gain attendu : alléger est plus prudent.`;
    }
  } else {
    beginnerOneLiner = `Bon actif à son prix normal : à garder tranquillement sans se presser.`;
  }

  return {
    verdictTone,
    verdictWord,
    verdictArrow,
    beginnerOneLiner,
    fairPriceCad,
    spotPriceCad,
    upsidePct,
    thermometerPositionPct,
    thermometerLabel,
    low52wCad,
    high52wCad,
    range52wPct,
    piotroskiSegments,
    piotroskiMax: 9,
    pillars,
  };
}
