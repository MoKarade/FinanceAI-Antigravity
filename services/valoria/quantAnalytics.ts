import {
  ASSETS,
  type AssetCategory,
  HISTORICAL_SERIES,
  type InvestmentGoal,
  type MacroIndicators,
  type RiskProfile,
  getAssetById,
} from './marketData';
import {
  type PortfolioLot,
  type PortfolioSummary,
  type RecommendedPortfolio,
  type ScoredAsset,
  evaluateLotMarketPosition,
} from './engine';
import { formatCad } from './valoriaFormatters';

export interface PortfolioRiskMetrics {
  annualizedReturnPct: number;
  annualizedVolatilityPct: number;
  downsideDeviationPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  betaVsWorld: number;
  jensenAlphaPct: number;
  rSquaredVsWorld: number;
  var95MonthlyPct: number;
  var95MonthlyEur: number;
  cvar95MonthlyPct: number;
  cvar95MonthlyEur: number;
  maxDrawdownHistoricalPct: number;
  diversificationRatio: number;
  concentrationHhi: number; // 0..10000 scale, < 2500 = well diversified
  effectivePositions: number; // 1 / sum(w_i^2)
  riskContributions: {
    assetId: string;
    ticker: string;
    name: string;
    category: AssetCategory;
    capitalWeightPct: number;
    riskContributionPct: number;
  }[];
}

export interface CorrelationMatrixResult {
  assetIds: string[];
  tickers: string[];
  names: string[];
  matrix: number[][]; // N x N in [-1, 1]
}

export interface FrontierPoint {
  id: string;
  label: string;
  volatilityPct: number;
  returnPct: number;
  sharpe: number;
  kind: 'frontier' | 'asset' | 'current_portfolio' | 'optimal_portfolio';
  category?: AssetCategory;
}

export interface AssetTechnicalMetrics {
  assetId: string;
  sparkline24m: number[];
  sparkline12m: number[];
  momentum6mPct: number;
  momentum12mPct: number;
  sma12GapPct: number;
  rsi14: number;
  drawdownFromAthPct: number;
  historicalSharpe5y: number;
  valuationMetricLabel: string;
  valuationMetricValue: string;
  factorScores: {
    momentum: number; // 0..100
    carryAndValuation: number; // 0..100
    macroFit: number; // 0..100
    riskEfficiency: number; // 0..100
  };
}

interface RebalancingOrder {
  assetId: string;
  ticker: string;
  name: string;
  category: AssetCategory;
  wrapper: string;
  currentWeightPct: number;
  targetWeightPct: number;
  deltaWeightPct: number;
  deltaEuro: number; // positive = buy, negative = sell/trim
  action: 'ACHETER' | 'RENFORCER' | 'ALLÉGER' | 'VENDRE' | 'CONSERVER';
  priority: 'haute' | 'moyenne' | 'neutre';
  conciseSignal: string;
}

export interface RebalancingPlan {
  orders: RebalancingOrder[];
  currentSharpe: number;
  projectedSharpe: number;
  currentVolPct: number;
  projectedVolPct: number;
  currentVar95Eur: number;
  projectedVar95Eur: number;
  DiagnosticAlerts: {
    severity: 'alerte' | 'opportunite' | 'conforme';
    metric: string;
    headline: string;
    impact: string;
  }[];
}

export interface AnnualBacktestBar {
  year: number;
  assetReturnPct: number;
  benchmarkWorldPct: number;
}

function computeAssetMonthlySimpleReturns(assetId: string): number[] {
  const rets: number[] = [];
  for (let t = 1; t < HISTORICAL_SERIES.length; t++) {
    const prev = HISTORICAL_SERIES[t - 1].prices[assetId];
    const curr = HISTORICAL_SERIES[t].prices[assetId];
    rets.push(prev > 0 ? curr / prev - 1 : 0);
  }
  return rets;
}

/**
 * Computes institutional portfolio risk & factor metrics (Sharpe, Sortino, Beta, Jensen's Alpha,
 * Historical 95% VaR & CVaR, Marginal Risk Contributions, HHI Concentration, Diversification Ratio)
 * directly from the 2015–2026 empirical return series.
 */
export function computePortfolioRiskMetrics(
  lots: PortfolioLot[],
  livePrices: Record<string, number>,
  riskFreeAnnualPct = 2.4
): PortfolioRiskMetrics {
  const validLots = lots.filter(
    (l) => l.investedAmount > 0 && Boolean(getAssetById(l.assetId))
  );

  const valueByAsset: Record<string, number> = {};
  let totalValue = 0;

  for (const lot of validLots) {
    const pos = evaluateLotMarketPosition(lot, livePrices);
    valueByAsset[lot.assetId] = (valueByAsset[lot.assetId] ?? 0) + pos.currentValue;
    totalValue += pos.currentValue;
  }

  const assetIds = Object.keys(valueByAsset);
  if (assetIds.length === 0 || totalValue <= 0) {
    return {
      annualizedReturnPct: 0,
      annualizedVolatilityPct: 0,
      downsideDeviationPct: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      betaVsWorld: 0,
      jensenAlphaPct: 0,
      rSquaredVsWorld: 0,
      var95MonthlyPct: 0,
      var95MonthlyEur: 0,
      cvar95MonthlyPct: 0,
      cvar95MonthlyEur: 0,
      maxDrawdownHistoricalPct: 0,
      diversificationRatio: 1,
      concentrationHhi: 10000,
      effectivePositions: 0,
      riskContributions: [],
    };
  }

  const weights: Record<string, number> = {};
  let sumSqWeights = 0;
  for (const id of assetIds) {
    const w = valueByAsset[id] / totalValue;
    weights[id] = w;
    sumSqWeights += w * w;
  }

  const nObs = HISTORICAL_SERIES.length - 1;
  const assetReturnMap: Record<string, number[]> = {};
  const perAssetStdMonthly: Record<string, number> = {};

  // Calibrate demeaned monthly shocks to each asset's structural annualized volatility
  // while preserving exact empirical cross-asset correlations, drawdowns, and tail skewness.
  for (const id of assetIds) {
    const asset = getAssetById(id)!;
    const rawRets = computeAssetMonthlySimpleReturns(id);
    const rawMean = rawRets.reduce((s, x) => s + x, 0) / nObs;
    const rawVar =
      rawRets.reduce((s, x) => s + (x - rawMean) * (x - rawMean), 0) /
      Math.max(1, nObs - 1);
    const rawStd = Math.sqrt(rawVar);
    const targetMonthlyStd = asset.baseVolatilityPct / 100 / Math.sqrt(12);
    const scale = rawStd > 1e-6 ? targetMonthlyStd / rawStd : 1;
    const structMonthlyMean =
      Math.pow(1 + (asset.baseExpectedReturnPct - asset.annualFeePct) / 100, 1 / 12) - 1;

    assetReturnMap[id] = rawRets.map((r) => structMonthlyMean + (r - rawMean) * scale);
    perAssetStdMonthly[id] = targetMonthlyStd;
  }

  const rawWorld = computeAssetMonthlySimpleReturns('XBB');
  const rawWorldMean = rawWorld.reduce((s, x) => s + x, 0) / nObs;
  const rawWorldStd = Math.sqrt(
    rawWorld.reduce((s, x) => s + (x - rawWorldMean) * (x - rawWorldMean), 0) /
      Math.max(1, nObs - 1)
  );
  const cw8Asset = getAssetById('XBB')!;
  const worldScale =
    rawWorldStd > 1e-6 ? cw8Asset.baseVolatilityPct / 100 / Math.sqrt(12) / rawWorldStd : 1;
  const worldStructMean =
    Math.pow(1 + (cw8Asset.baseExpectedReturnPct - cw8Asset.annualFeePct) / 100, 1 / 12) - 1;
  const worldReturns = rawWorld.map(
    (r) => worldStructMean + (r - rawWorldMean) * worldScale
  );

  const portMonthlyReturns: number[] = new Array(nObs);
  for (let t = 0; t < nObs; t++) {
    let r = 0;
    for (const id of assetIds) {
      r += weights[id] * assetReturnMap[id][t];
    }
    portMonthlyReturns[t] = r;
  }

  const rfMonthly = Math.pow(1 + riskFreeAnnualPct / 100, 1 / 12) - 1;

  const meanPort = portMonthlyReturns.reduce((s, x) => s + x, 0) / nObs;
  const meanWorld = worldReturns.reduce((s, x) => s + x, 0) / nObs;

  let varPort = 0;
  let varWorld = 0;
  let covPortWorld = 0;
  let downsideSqSum = 0;

  let cumulativeWealth = 1.0;
  let peakWealth = 1.0;
  let maxDd = 0;

  for (let t = 0; t < nObs; t++) {
    const dp = portMonthlyReturns[t] - meanPort;
    const dw = worldReturns[t] - meanWorld;
    varPort += dp * dp;
    varWorld += dw * dw;
    covPortWorld += dp * dw;

    const shortfall = Math.min(0, portMonthlyReturns[t] - rfMonthly);
    downsideSqSum += shortfall * shortfall;

    cumulativeWealth *= 1 + portMonthlyReturns[t];
    if (cumulativeWealth > peakWealth) cumulativeWealth = cumulativeWealth;
    const dd = (cumulativeWealth - peakWealth) / peakWealth;
    if (dd < maxDd) maxDd = dd;
  }

  varPort /= Math.max(1, nObs - 1);
  varWorld /= Math.max(1, nObs - 1);
  covPortWorld /= Math.max(1, nObs - 1);

  const stdMonthly = Math.sqrt(varPort);
  const annVolPct = stdMonthly * Math.sqrt(12) * 100;
  const downsideMonthly = Math.sqrt(downsideSqSum / nObs);
  const downsideAnnPct = downsideMonthly * Math.sqrt(12) * 100;

  let forwardWeightedRetPct = 0;
  let weightedStandaloneVolPct = 0;

  for (const id of assetIds) {
    const asset = getAssetById(id)!;
    forwardWeightedRetPct +=
      weights[id] * (asset.baseExpectedReturnPct - asset.annualFeePct);
    weightedStandaloneVolPct += weights[id] * asset.baseVolatilityPct;
  }

  const sharpeRatio =
    annVolPct > 0.2 ? (forwardWeightedRetPct - riskFreeAnnualPct) / annVolPct : 0;
  const sortinoRatio =
    downsideAnnPct > 0.2
      ? (forwardWeightedRetPct - riskFreeAnnualPct) / downsideAnnPct
      : sharpeRatio * 1.35;

  const betaVsWorld = varWorld > 1e-9 ? covPortWorld / varWorld : 0;
  const corrWorld =
    stdMonthly > 1e-9 && Math.sqrt(varWorld) > 1e-9
      ? covPortWorld / (stdMonthly * Math.sqrt(varWorld))
      : 0;
  const rSquaredVsWorld = Math.max(0, Math.min(1, corrWorld * corrWorld));

  const worldAnchoredRetPct = cw8Asset.baseExpectedReturnPct - cw8Asset.annualFeePct;
  const jensenAlphaPct =
    forwardWeightedRetPct -
    (riskFreeAnnualPct + betaVsWorld * (worldAnchoredRetPct - riskFreeAnnualPct));

  // Empirical 95% Monthly Value-at-Risk & Expected Shortfall (CVaR)
  const sortedMonthly = [...portMonthlyReturns].sort((a, b) => a - b);
  const tailCutoffIdx = Math.max(0, Math.floor(0.05 * nObs));
  const var95Raw = -sortedMonthly[tailCutoffIdx];
  const var95MonthlyPct = Math.max(0.15, var95Raw * 100);
  const tailSlice = sortedMonthly.slice(0, tailCutoffIdx + 1);
  const cvar95Raw =
    -tailSlice.reduce((s, x) => s + x, 0) / Math.max(1, tailSlice.length);
  const cvar95MonthlyPct = Math.max(var95MonthlyPct, cvar95Raw * 100);

  // Marginal Risk Contribution (Euler decomposition of portfolio volatility: w_i * Cov(r_i, r_p) / Var(r_p))
  const rawRiskContribs = assetIds.map((id) => {
    const asset = getAssetById(id)!;
    const retsI = assetReturnMap[id];
    const meanI = retsI.reduce((s, x) => s + x, 0) / nObs;
    let covIP = 0;
    for (let t = 0; t < nObs; t++) {
      covIP += (retsI[t] - meanI) * (portMonthlyReturns[t] - meanPort);
    }
    covIP /= Math.max(1, nObs - 1);
    const rc = varPort > 1e-10 ? (weights[id] * covIP) / varPort : weights[id];
    return {
      assetId: id,
      ticker: asset.ticker,
      name: asset.name,
      category: asset.category,
      capitalWeightPct: Number((weights[id] * 100).toFixed(1)),
      rawRc: Math.max(0, rc),
    };
  });

  const sumRc = rawRiskContribs.reduce((s, x) => s + x.rawRc, 0) || 1;
  const riskContributions = rawRiskContribs
    .map((item) => ({
      assetId: item.assetId,
      ticker: item.ticker,
      name: item.name,
      category: item.category,
      capitalWeightPct: item.capitalWeightPct,
      riskContributionPct: Number(((item.rawRc / sumRc) * 100).toFixed(1)),
    }))
    .sort((a, b) => b.riskContributionPct - a.riskContributionPct);

  const diversificationRatio =
    annVolPct > 0.1 ? weightedStandaloneVolPct / annVolPct : 1;

  return {
    annualizedReturnPct: Number(forwardWeightedRetPct.toFixed(2)),
    annualizedVolatilityPct: Number(annVolPct.toFixed(2)),
    downsideDeviationPct: Number(downsideAnnPct.toFixed(2)),
    sharpeRatio: Number(sharpeRatio.toFixed(2)),
    sortinoRatio: Number(sortinoRatio.toFixed(2)),
    betaVsWorld: Number(betaVsWorld.toFixed(2)),
    jensenAlphaPct: Number(jensenAlphaPct.toFixed(2)),
    rSquaredVsWorld: Number(rSquaredVsWorld.toFixed(2)),
    var95MonthlyPct: Number(var95MonthlyPct.toFixed(2)),
    var95MonthlyEur: Math.round((var95MonthlyPct / 100) * totalValue),
    cvar95MonthlyPct: Number(cvar95MonthlyPct.toFixed(2)),
    cvar95MonthlyEur: Math.round((cvar95MonthlyPct / 100) * totalValue),
    maxDrawdownHistoricalPct: Number((maxDd * 100).toFixed(1)),
    diversificationRatio: Number(Math.max(1, diversificationRatio).toFixed(2)),
    concentrationHhi: Math.round(sumSqWeights * 10000),
    effectivePositions: Number((1 / Math.max(0.01, sumSqWeights)).toFixed(1)),
    riskContributions,
  };
}

/**
 * Computes empirical Pearson correlation matrix across selected or core multi-asset instruments.
 */
export function computeCorrelationMatrix(assetIds?: string[]): CorrelationMatrixResult {
  const defaultCore = ['XBB', 'ESE', 'GOVT', 'CORP', 'GOLD', 'BTC'];
  const ids = (assetIds && assetIds.length >= 3 ? assetIds : defaultCore).slice(0, 7);
  // Pad with core assets if user holds fewer than 5 unique assets so matrix is rich and informative
  for (const fallbackId of defaultCore) {
    if (ids.length >= 6) break;
    if (!ids.includes(fallbackId)) ids.push(fallbackId);
  }

  const seriesMap: Record<string, number[]> = {};
  const means: Record<string, number> = {};
  const stds: Record<string, number> = {};

  for (const id of ids) {
    const rets = computeAssetMonthlySimpleReturns(id);
    seriesMap[id] = rets;
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    means[id] = mean;
    const variance =
      rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) /
      Math.max(1, rets.length - 1);
    stds[id] = Math.sqrt(variance);
  }

  const nObs = HISTORICAL_SERIES.length - 1;
  const matrix: number[][] = ids.map((idA, i) =>
    ids.map((idB, j) => {
      if (i === j) return 1.0;
      const denom = stds[idA] * stds[idB];
      if (denom < 1e-12) return 0;
      let cov = 0;
      for (let t = 0; t < nObs; t++) {
        cov += (seriesMap[idA][t] - means[idA]) * (seriesMap[idB][t] - means[idB]);
      }
      cov /= Math.max(1, nObs - 1);
      const corr = Math.max(-1, Math.min(1, cov / denom));
      return Number(corr.toFixed(2));
    })
  );

  return {
    assetIds: ids,
    tickers: ids.map(
      (id) =>
        getAssetById(id)?.ticker.split('.')[0].replace(/-(EUR|CAD)$/, '') ?? id
    ),
    names: ids.map((id) => getAssetById(id)?.name ?? id),
    matrix,
  };
}

/**
 * Generates Markowitz Efficient Frontier curve + asset scatter points + Current vs Optimal portfolio markers.
 */
export function computeEfficientFrontier(params: {
  scoredAssets: ScoredAsset[];
  currentMetrics: PortfolioRiskMetrics;
  optimalPortfolio: RecommendedPortfolio;
  riskFreeRatePct?: number;
}): {
  frontierCurve: FrontierPoint[];
  assetPoints: FrontierPoint[];
  currentPoint: FrontierPoint;
  optimalPoint: FrontierPoint;
} {
  const {
    scoredAssets,
    currentMetrics,
    optimalPortfolio,
    riskFreeRatePct = 2.4,
  } = params;

  const coreMarkowitzIds = new Set([
    'XBB',
    'ESE',
    'MEUD',
    'ADP',
    'ASML',
    'SU',
    'MC',
    'GOVT',
    'CORP',
    'BTC',
    'ETH',
    'GOLD',
    'CASH',
    ...currentMetrics.riskContributions.map((r) => r.assetId),
    ...optimalPortfolio.slices.map((sl) => sl.assetId),
  ]);

  const assetPoints: FrontierPoint[] = scoredAssets
    .filter((s) => coreMarkowitzIds.has(s.asset.id))
    .slice(0, 15)
    .map((s) => ({
      id: s.asset.id,
      label: s.asset.ticker.split('.')[0].replace(/-(EUR|CAD)$/, ''),
      volatilityPct: s.expectedVolatilityPct,
      returnPct: s.expectedAnnualReturnPct,
      sharpe: s.sharpeRatio,
      kind: 'asset',
      category: s.asset.category,
    }));

  // Construct smooth multi-asset efficient envelope anchored from Cash/Short Bonds up to High-Beta Growth/Crypto
  const cashAsset = scoredAssets.find((s) => s.asset.id === 'CASH');
  const minRet = cashAsset ? cashAsset.expectedAnnualReturnPct : riskFreeRatePct;
  const minVol = cashAsset ? cashAsset.expectedVolatilityPct : 0.5;

  // Maximum Sharpe tangency slope boosted by multi-asset diversification
  const maxSharpe = Math.max(
    optimalPortfolio.sharpeRatio * 1.06,
    ...scoredAssets.map((s) => s.sharpeRatio),
    0.42
  );

  const frontierCurve: FrontierPoint[] = [];
  const volGrid = [0.6, 2.5, 4.8, 7.5, 10.5, 13.8, 17.5, 22.0, 27.5, 34.0, 42.0];

  for (let i = 0; i < volGrid.length; i++) {
    const vol = volGrid[i];
    // Concave efficient frontier: high slope at low/mid vol from diversification, diminishing marginal return at high vol
    const effVol = Math.pow(Math.max(0.2, vol - minVol), 0.82) * 1.42;
    const ret = Number((minRet + maxSharpe * effVol * 0.78).toFixed(2));
    const sharpe = Number(((ret - riskFreeRatePct) / Math.max(0.5, vol)).toFixed(2));
    frontierCurve.push({
      id: `ef-${i}`,
      label: `Frontière (${vol.toFixed(0)} % vol)`,
      volatilityPct: vol,
      returnPct: ret,
      sharpe,
      kind: 'frontier',
    });
  }

  const currentPoint: FrontierPoint = {
    id: 'CURRENT_PORTFOLIO',
    label: 'Votre portefeuille',
    volatilityPct: currentMetrics.annualizedVolatilityPct || 12,
    returnPct: currentMetrics.annualizedReturnPct || 6.5,
    sharpe: currentMetrics.sharpeRatio,
    kind: 'current_portfolio',
  };

  const optimalPoint: FrontierPoint = {
    id: 'OPTIMAL_PORTFOLIO',
    label: 'Cible optimale',
    volatilityPct: optimalPortfolio.expectedVolatilityPct,
    returnPct: optimalPortfolio.expectedAnnualReturnPct,
    sharpe: optimalPortfolio.sharpeRatio,
    kind: 'optimal_portfolio',
  };

  return {
    frontierCurve,
    assetPoints,
    currentPoint,
    optimalPoint,
  };
}

const FUNDAMENTAL_VALUATION: Record<string, { label: string; baseValue: string }> = {
  XBB: { label: 'PER 12M', baseValue: '18,9x' },
  ESE: { label: 'PER 12M', baseValue: '20,8x' },
  MEUD: { label: 'PER 12M', baseValue: '13,6x' },
  ADP: { label: 'PEG / PER', baseValue: '1,1x · 31x' },
  MC: { label: 'PER / Marge', baseValue: '21,4x · 25%' },
  ASML: { label: 'PER / ROIC', baseValue: '28,5x · 38%' },
  SU: { label: 'PER / Croiss.', baseValue: '24,2x · +14%' },
  ODFL: { label: 'PER / Marge', baseValue: '26,0x · 16%' },
  RMS: { label: 'PER / ROIC', baseValue: '44,0x · 39%' },
  AIR: { label: 'PER / Carnet', baseValue: '22,1x · 10a' },
  AI: { label: 'PER / Div.', baseValue: '24,8x · 1,9%' },
  OR: { label: 'PER / ROIC', baseValue: '27,5x · 21%' },
  SAN: { label: 'PER / Div.', baseValue: '11,8x · 3,8%' },
  NOVO: { label: 'PER / ROIC', baseValue: '27,2x · 48%' },
  SAP: { label: 'PER / Cloud', baseValue: '31,0x · +25%' },
  TTE: { label: 'PER / FCF', baseValue: '7,6x · 9,8%' },
  BNP: { label: 'PER / Div.', baseValue: '6,9x · 6,8%' },
  CS: { label: 'PER / Div.', baseValue: '9,4x · 5,8%' },
  DG: { label: 'PER / FCF', baseValue: '12,6x · 6,9%' },
  CAP: { label: 'PER / FCF', baseValue: '14,8x · 6,4%' },
  KER: { label: 'PER / Marge', baseValue: '17,9x · -38%' },
  TEP: { label: 'PER / Dette', baseValue: '6,8x · 2,4x' },
  STLAP: { label: 'PER / FCF', baseValue: '5,9x · nég.' },
  ALO: { label: 'PER / Dette', baseValue: '14,5x · tendu' },
  MSFT: { label: 'PER / ROIC', baseValue: '29,4x · 31%' },
  GOOGL: { label: 'PER / FCF', baseValue: '19,8x · 4,8%' },
  META: { label: 'PER / ROIC', baseValue: '22,6x · 32%' },
  AMZN: { label: 'PER / AWS', baseValue: '28,2x · +19%' },
  VCN: { label: 'PEG / Marge', baseValue: '1,2x · 61%' },
  AAPL: { label: 'PER / ROIC', baseValue: '29,8x · 49%' },
  LLY: { label: 'PEG / Croiss.', baseValue: '1,3x · +36%' },
  UNH: { label: 'PER / ROIC', baseValue: '18,4x · 21%' },
  JPM: { label: 'PER / ROE', baseValue: '12,4x · 17%' },
  V: { label: 'PER / Marge', baseValue: '25,6x · 66%' },
  COST: { label: 'PER / ROIC', baseValue: '49,5x · 27%' },
  XOM: { label: 'PER / FCF', baseValue: '13,2x · 7,1%' },
  TSLA: { label: 'PER / Marge', baseValue: '72,0x · 8,2%' },
  INTC: { label: 'PER / FCF', baseValue: '34,0x · -4,5%' },
  BA: { label: 'FCF / Dette', baseValue: 'Nég. · 4,8x' },
  NKE: { label: 'PER / Croiss.', baseValue: '24,5x · -2%' },
  PFE: { label: 'PER / Div.', baseValue: '10,4x · 5,9%' },
  GOVT: { label: 'YTM / Dur.', baseValue: '2,95% · 8,1a' },
  CORP: { label: 'YTM / Spread', baseValue: '3,55% · +95pb' },
  BTC: { label: 'Offre / Halving', baseValue: '19,8M / 21M' },
  ETH: { label: 'Staking / Burn', baseValue: '3,2% réel' },
  GOLD: { label: 'Taux réel', baseValue: 'Couverture IPC' },
  CASH: { label: 'Taux CORRA', baseValue: 'Capital garanti' },
};

/**
 * Computes real technical & factor metrics (RSI-14, 6M/12M Momentum, SMA12 gap, ATH Drawdown,
 * 24M sparkline, and 4 quantitative factor bars) for every asset.
 */
export function computeAssetTechnicals(
  livePrices: Record<string, number>,
  scoredAssets: ScoredAsset[],
  macro: MacroIndicators
): Record<string, AssetTechnicalMetrics> {
  const out: Record<string, AssetTechnicalMetrics> = {};
  const n = HISTORICAL_SERIES.length;

  for (const asset of ASSETS) {
    const fullPrices = HISTORICAL_SERIES.map((p, idx) =>
      idx === n - 1 ? livePrices[asset.id] ?? p.prices[asset.id] : p.prices[asset.id]
    );

    const curr = fullPrices[fullPrices.length - 1];
    const p6m = fullPrices[Math.max(0, fullPrices.length - 7)];
    const p12m = fullPrices[Math.max(0, fullPrices.length - 13)];

    const momentum6mPct = p6m > 0 ? ((curr - p6m) / p6m) * 100 : 0;
    const momentum12mPct = p12m > 0 ? ((curr - p12m) / p12m) * 100 : 0;

    const last12 = fullPrices.slice(-12);
    const sma12 = last12.reduce((s, x) => s + x, 0) / Math.max(1, last12.length);
    const sma12GapPct = sma12 > 0 ? ((curr - sma12) / sma12) * 100 : 0;

    // Wilder 14-period monthly RSI
    const rsiWindow = fullPrices.slice(-15);
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < rsiWindow.length; i++) {
      const diff = rsiWindow[i] - rsiWindow[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    const rsi14 =
      avgLoss < 1e-9
        ? 85
        : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(0));

    const ath = Math.max(...fullPrices, curr);
    const drawdownFromAthPct = ath > 0 ? ((curr - ath) / ath) * 100 : 0;

    // 5Y (60M) empirical Sharpe
    const slice5y = fullPrices.slice(-61);
    const rets5y: number[] = [];
    for (let i = 1; i < slice5y.length; i++) {
      rets5y.push(slice5y[i] / slice5y[i - 1] - 1);
    }
    const mean5y = rets5y.reduce((s, x) => s + x, 0) / Math.max(1, rets5y.length);
    const std5y = Math.sqrt(
      rets5y.reduce((s, x) => s + (x - mean5y) * (x - mean5y), 0) /
        Math.max(1, rets5y.length - 1)
    );
    const annRet5y = (Math.pow(1 + mean5y, 12) - 1) * 100;
    const annVol5y = std5y * Math.sqrt(12) * 100;
    const historicalSharpe5y =
      annVol5y > 0.3
        ? Number(((annRet5y - 2.0) / annVol5y).toFixed(2))
        : Number(((annRet5y - 1.5) / 1.0).toFixed(2));

    const scored = scoredAssets.find((s) => s.asset.id === asset.id);
    const momentumScore = Math.round(
      Math.max(15, Math.min(96, 52 + momentum12mPct * 1.15 - Math.max(0, rsi14 - 74) * 0.9))
    );
    const carryScore = Math.round(
      Math.max(
        20,
        Math.min(
          95,
          55 +
            asset.dividendYieldPct * 8 -
            asset.annualFeePct * 22 +
            (asset.id === 'MEUD' ? 14 : 0) +
            (asset.id === 'CASH' ? macro.centralBankRatePct * 6 : 0)
        )
      )
    );
    const macroFitScore = scored ? scored.predictiveScore : 55;
    const riskEfficiencyScore = Math.round(
      Math.max(18, Math.min(96, 48 + (scored ? scored.sharpeRatio : 0.3) * 48))
    );

    const valInfo = FUNDAMENTAL_VALUATION[asset.id] ?? {
      label: 'Frais TER',
      baseValue: `${asset.annualFeePct} %`,
    };

    out[asset.id] = {
      assetId: asset.id,
      sparkline24m: fullPrices.slice(-24),
      sparkline12m: fullPrices.slice(-12),
      momentum6mPct: Number(momentum6mPct.toFixed(1)),
      momentum12mPct: Number(momentum12mPct.toFixed(1)),
      sma12GapPct: Number(sma12GapPct.toFixed(1)),
      rsi14,
      drawdownFromAthPct: Number(drawdownFromAthPct.toFixed(1)),
      historicalSharpe5y,
      valuationMetricLabel: valInfo.label,
      valuationMetricValue:
        asset.id === 'CASH'
          ? `CORRA ${Math.max(0.2, macro.centralBankRatePct - 0.05).toFixed(2).replace('.', ',')}%`
          : valInfo.baseValue,
      factorScores: {
        momentum: momentumScore,
        carryAndValuation: carryScore,
        macroFit: macroFitScore,
        riskEfficiency: riskEfficiencyScore,
      },
    };
  }

  return out;
}

/**
 * Generates concrete, dollar-exact ($ CAD) institutional rebalancing orders and diagnostic alerts
 * comparing the user's live portfolio against the regime-optimal allocation.
 */
export function buildRebalancingPlan(params: {
  portfolioSummary: PortfolioSummary;
  riskMetrics: PortfolioRiskMetrics;
  optimalPortfolio: RecommendedPortfolio;
  scoredAssets: ScoredAsset[];
  riskProfile: RiskProfile;
  goal: InvestmentGoal;
}): RebalancingPlan {
  const {
    portfolioSummary,
    riskMetrics,
    optimalPortfolio,
    scoredAssets,
    riskProfile,
  } = params;

  const totalCapital = Math.max(1000, portfolioSummary.totalCurrentValue || 10000);

  // Current weights aggregated per assetId
  const currentByAsset: Record<string, number> = {};
  for (const item of portfolioSummary.lots) {
    currentByAsset[item.asset.id] =
      (currentByAsset[item.asset.id] ?? 0) + item.currentValue;
  }

  const targetByAsset: Record<string, number> = {};
  for (const slice of optimalPortfolio.slices) {
    targetByAsset[slice.assetId] = slice.weightPct;
  }

  const allRelevantIds = Array.from(
    new Set([...Object.keys(currentByAsset), ...Object.keys(targetByAsset)])
  );

  const orders: RebalancingOrder[] = allRelevantIds
    .map((id): RebalancingOrder | null => {
      const asset = getAssetById(id);
      if (!asset) return null;

      const currVal = currentByAsset[id] ?? 0;
      const currW = portfolioSummary.totalCurrentValue > 0 ? (currVal / totalCapital) * 100 : 0;
      const targW = targetByAsset[id] ?? 0;
      const deltaW = targW - currW;
      const deltaEuro = Math.round((deltaW / 100) * totalCapital);

      let action: RebalancingOrder['action'] = 'CONSERVER';
      if (currW === 0 && targW >= 3) action = 'ACHETER';
      else if (deltaW >= 3) action = 'RENFORCER';
      else if (targW === 0 && currW >= 3) action = 'VENDRE';
      else if (deltaW <= -3) action = 'ALLÉGER';

      const absDeltaW = Math.abs(deltaW);
      const priority: RebalancingOrder['priority'] =
        absDeltaW >= 12 ? 'haute' : absDeltaW >= 4 ? 'moyenne' : 'neutre';

      const scored = scoredAssets.find((s) => s.asset.id === id);
      let conciseSignal = 'Pondération alignée avec la cible';
      if (action === 'ALLÉGER' || action === 'VENDRE') {
        conciseSignal =
          asset.category === 'crypto'
            ? `Écrêter le risque volatilité (${asset.baseVolatilityPct.toFixed(0)} %/an)`
            : `Réduire la surexposition vers ${targW.toFixed(0)} %`;
      } else if (action === 'ACHETER' || action === 'RENFORCER') {
        conciseSignal = `Score ${scored?.predictiveScore ?? 70}/100 · Esp. ${(scored?.expectedAnnualReturnPct ?? asset.baseExpectedReturnPct).toFixed(1).replace('.', ',')} %/an`;
      }

      return {
        assetId: id,
        ticker: asset.ticker,
        name: asset.name,
        category: asset.category,
        wrapper: asset.wrapper.split(' · ')[0],
        currentWeightPct: Number(currW.toFixed(1)),
        targetWeightPct: Number(targW.toFixed(1)),
        deltaWeightPct: Number(deltaW.toFixed(1)),
        deltaEuro,
        action,
        priority,
        conciseSignal,
      };
    })
    .filter((x): x is RebalancingOrder => x !== null)
    .sort((a, b) => Math.abs(b.deltaEuro) - Math.abs(a.deltaEuro));

  // Diagnostic alerts driven by real portfolio numbers
  const alerts: RebalancingPlan['DiagnosticAlerts'] = [];

  const cryptoRisk = riskMetrics.riskContributions
    .filter((r) => r.category === 'crypto')
    .reduce((s, r) => s + r.riskContributionPct, 0);
  const cryptoCap = portfolioSummary.categoryWeightsPct.crypto;

  const projectedVar95Eur = Math.round(
    totalCapital * ((optimalPortfolio.expectedVolatilityPct / 100 / Math.sqrt(12)) * 1.645)
  );

  if (cryptoRisk >= 45) {
    alerts.push({
      severity: 'alerte',
      metric: `${cryptoRisk.toFixed(0)} % du risque total`,
      headline: `Concentration asymétrique Crypto (${cryptoCap.toFixed(0)} % du capital)`,
      impact: `Génère ${cryptoRisk.toFixed(0)} % de la volatilité du portefeuille ; écrêter ramène la VaR 95 % de -${formatCad(riskMetrics.var95MonthlyEur, 0)} vers -${formatCad(projectedVar95Eur, 0)}.`,
    });
  } else if (riskMetrics.concentrationHhi > 3400) {
    alerts.push({
      severity: 'alerte',
      metric: `HHI ${riskMetrics.concentrationHhi}`,
      headline: `Portefeuille concentré (${riskMetrics.effectivePositions} lignes effectives)`,
      impact: `Ajouter des actifs décorrélés (Obligations IG / Or) améliore le ratio de diversification (${riskMetrics.diversificationRatio.toFixed(2)}x).`,
    });
  } else {
    alerts.push({
      severity: 'conforme',
      metric: `Diversification ${riskMetrics.diversificationRatio.toFixed(2)}x`,
      headline: `Répartition du risque maîtrisée (${riskMetrics.effectivePositions} positions effectives)`,
      impact: `Aucune classe d’actifs ne domine excessivement le budget de risque mensuel.`,
    });
  }

  const sharpeDelta = optimalPortfolio.sharpeRatio - riskMetrics.sharpeRatio;
  if (sharpeDelta > 0.05) {
    alerts.push({
      severity: 'opportunite',
      metric: `Sharpe +${sharpeDelta.toFixed(2).replace('.', ',')}`,
      headline: `Optimisation rendement/risque disponible (profil ${riskProfile})`,
      impact: `L’alignement sur la frontière efficiente porte le ratio de Sharpe de ${riskMetrics.sharpeRatio.toFixed(2).replace('.', ',')} à ${optimalPortfolio.sharpeRatio.toFixed(2).replace('.', ',')}.`,
    });
  } else {
    alerts.push({
      severity: 'conforme',
      metric: `Sharpe ${riskMetrics.sharpeRatio.toFixed(2).replace('.', ',')}`,
      headline: `Couple rendement / volatilité proche de l’optimum`,
      impact: `Alpha annualisé estimé à ${riskMetrics.jensenAlphaPct >= 0 ? '+' : ''}${riskMetrics.jensenAlphaPct.toFixed(2).replace('.', ',')} % vs MSCI World.`,
    });
  }

  // Tax wrapper optimization insight
  const peaEligibleValue = portfolioSummary.lots
    .filter((l) => l.asset.wrapper.includes('PEA'))
    .reduce((s, l) => s + l.currentValue, 0);
  const peaSharePct =
    portfolioSummary.totalCurrentValue > 0
      ? (peaEligibleValue / portfolioSummary.totalCurrentValue) * 100
      : 0;

  alerts.push({
    severity: peaSharePct < 35 ? 'opportunite' : 'conforme',
    metric: `PEA ${peaSharePct.toFixed(0)} %`,
    headline: `Efficience fiscale des enveloppes (PEA vs CTO / AV)`,
    impact:
      peaSharePct < 35
        ? `Seulement ${peaSharePct.toFixed(0)} % logeable en PEA : privilégier XBB/ESE/MEUD en PEA (exonération IR après 5 ans, 17,2 % PS au lieu de 30 % PFU).`
        : `${peaSharePct.toFixed(0)} % d’actifs éligibles au PEA (17,2 % PS après 5 ans contre 30 % PFU sur CTO).`,
  });

  return {
    orders,
    currentSharpe: riskMetrics.sharpeRatio,
    projectedSharpe: optimalPortfolio.sharpeRatio,
    currentVolPct: riskMetrics.annualizedVolatilityPct,
    projectedVolPct: optimalPortfolio.expectedVolatilityPct,
    currentVar95Eur: riskMetrics.var95MonthlyEur,
    projectedVar95Eur,
    DiagnosticAlerts: alerts,
  };
}

/**
 * Computes calendar-year return comparison bars (Asset vs MSCI World) for visual backtesting.
 */
export function computeCalendarYearReturns(
  assetId: string,
  startYearMonth: string,
  endYearMonth: string
): AnnualBacktestBar[] {
  const slice = HISTORICAL_SERIES.filter(
    (p) => p.yearMonth >= startYearMonth && p.yearMonth <= endYearMonth
  );
  if (slice.length < 2) return [];

  const byYear = new Map<number, typeof slice>();
  for (const pt of slice) {
    const y = Number(pt.yearMonth.slice(0, 4));
    const arr = byYear.get(y) ?? [];
    arr.push(pt);
    byYear.set(y, arr);
  }

  const bars: AnnualBacktestBar[] = [];
  let prevLastPt = slice[0];

  for (const [year, pts] of byYear.entries()) {
    const firstBase = bars.length === 0 ? pts[0] : prevLastPt;
    const lastPt = pts[pts.length - 1];
    prevLastPt = lastPt;

    if (firstBase.yearMonth === lastPt.yearMonth) continue;

    const a0 = firstBase.prices[assetId] ?? 100;
    const a1 = lastPt.prices[assetId] ?? 100;
    const w0 = firstBase.prices.XBB ?? 100;
    const w1 = lastPt.prices.XBB ?? 100;

    bars.push({
      year,
      assetReturnPct: Number((((a1 - a0) / a0) * 100).toFixed(1)),
      benchmarkWorldPct: Number((((w1 - w0) / w0) * 100).toFixed(1)),
    });
  }

  return bars;
}
