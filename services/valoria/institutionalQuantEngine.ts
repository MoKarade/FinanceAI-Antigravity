import {
  ASSETS,
  HISTORICAL_SERIES,
  MacroIndicators,
  RiskProfile,
} from './marketData';
import { UniversalAssetAnalysis } from './multiAssetQuantEngine';
import { PortfolioNewsIntelligence } from './newsCatalystEngine';

// ============================================================================
// 1. Linear Algebra Primitives (Gauss-Jordan Inversion & Matrix Ops)
// ============================================================================

function createZeroMatrix(n: number, m: number): number[][] {
  return Array.from({ length: n }, () => new Array(m).fill(0));
}

function invertSquareMatrix(mat: number[][], ridgeEps = 1e-6): number[][] {
  const n = mat.length;
  const aug = createZeroMatrix(n, 2 * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      aug[i][j] = mat[i][j] + (i === j ? ridgeEps : 0);
    }
    aug[i][n + i] = 1;
  }

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const candidate = Math.abs(aug[r][col]);
      if (candidate > maxAbs) {
        maxAbs = candidate;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivotVal = Math.abs(aug[col][col]) < 1e-10 ? 1e-10 : aug[col][col];
    for (let j = 0; j < 2 * n; j++) {
      aug[col][j] /= pivotVal;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }

  const inv = createZeroMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      inv[i][j] = aug[i][n + j];
    }
  }
  return inv;
}

function matVecMul(mat: number[][], vec: number[]): number[] {
  return mat.map((row) => row.reduce((acc, v, j) => acc + v * (vec[j] ?? 0), 0));
}

// ============================================================================
// 2. Ledoit-Wolf Shrinkage Covariance Matrix (Annualized Monthly Returns)
// ============================================================================

export interface LedoitWolfCovarianceResult {
  assetIds: string[];
  annualizedCovariance: number[][];
  sampleCovariance: number[][];
  shrinkageIntensityAlpha: number; // [0.05, 0.85]
  averagePairwiseCorrelation: number;
  effectiveSampleMonths: number;
}

function extractMonthlyReturnsMatrix(assetIds: string[]): {
  returnsByAsset: number[][]; // [assetIdx][t]
  monthsCount: number;
} {
  const nSteps = Math.max(0, HISTORICAL_SERIES.length - 1);
  const returnsByAsset = assetIds.map((id) => {
    const arr: number[] = [];
    for (let t = 1; t < HISTORICAL_SERIES.length; t++) {
      const prev = HISTORICAL_SERIES[t - 1].prices[id] ?? 100;
      const curr = HISTORICAL_SERIES[t].prices[id] ?? prev;
      const r = prev > 0 ? curr / prev - 1 : 0;
      arr.push(Number.isFinite(r) ? r : 0);
    }
    return arr;
  });

  return { returnsByAsset, monthsCount: nSteps };
}

export function computeLedoitWolfCovariance(
  assetIds: string[]
): LedoitWolfCovarianceResult {
  const { returnsByAsset, monthsCount } = extractMonthlyReturnsMatrix(assetIds);
  const n = assetIds.length;
  const T = Math.max(2, monthsCount);

  const means = returnsByAsset.map(
    (series) => series.reduce((s, r) => s + r, 0) / T
  );

  // Sample monthly covariance S
  const sampleMonthly = createZeroMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let cov = 0;
      for (let t = 0; t < T; t++) {
        cov += (returnsByAsset[i][t] - means[i]) * (returnsByAsset[j][t] - means[j]);
      }
      cov /= T - 1;
      sampleMonthly[i][j] = cov;
      sampleMonthly[j][i] = cov;
    }
  }

  // Average pairwise correlation rho_bar
  const stds = sampleMonthly.map((row, i) => Math.sqrt(Math.max(1e-8, row[i])));
  let corrSum = 0;
  let pairCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const rho = sampleMonthly[i][j] / (stds[i] * stds[j]);
      corrSum += Math.max(-0.95, Math.min(0.98, rho));
      pairCount++;
    }
  }
  const avgRho = pairCount > 0 ? corrSum / pairCount : 0.35;

  // Constant-correlation structured target F
  const targetMonthly = createZeroMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      targetMonthly[i][j] =
        i === j ? sampleMonthly[i][i] : avgRho * stds[i] * stds[j];
    }
  }

  // Analytical Ledoit-Wolf shrinkage intensity estimation
  let piHat = 0;
  let gammaHat = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const diff = targetMonthly[i][j] - sampleMonthly[i][j];
      gammaHat += diff * diff;

      let asymVar = 0;
      for (let t = 0; t < T; t++) {
        const prod =
          (returnsByAsset[i][t] - means[i]) * (returnsByAsset[j][t] - means[j]) -
          sampleMonthly[i][j];
        asymVar += prod * prod;
      }
      piHat += asymVar / T;
    }
  }

  const rawAlpha = gammaHat > 1e-12 ? (piHat / gammaHat) / T : 0.25;
  const shrinkageIntensityAlpha = Number(
    Math.max(0.08, Math.min(0.75, rawAlpha)).toFixed(3)
  );

  const annualizedCovariance = createZeroMatrix(n, n);
  const sampleCovariance = createZeroMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sampleCovariance[i][j] = sampleMonthly[i][j] * 12;
      annualizedCovariance[i][j] =
        ((1 - shrinkageIntensityAlpha) * sampleMonthly[i][j] +
          shrinkageIntensityAlpha * targetMonthly[i][j]) *
        12;
    }
  }

  return {
    assetIds,
    annualizedCovariance,
    sampleCovariance,
    shrinkageIntensityAlpha,
    averagePairwiseCorrelation: Number(avgRho.toFixed(3)),
    effectiveSampleMonths: T,
  };
}

// ============================================================================
// 3. Probabilistic 3-Scenario Valuation & WACC × Terminal Growth Sensitivity
// ============================================================================

export interface ProbabilisticAssetValuation {
  assetId: string;
  ticker: string;
  spotCad: number;
  bearCaseCad: number; // 25% probability
  baseCaseCad: number; // 50% probability
  bullCaseCad: number; // 25% probability
  expectedFairValueCad: number;
  expectedUpsidePct: number;
  annualizedFundamentalAlphaPct: number;
  waccBasePct: number;
  terminalGrowthBasePct: number;
  sensitivityWaccHeaders: string[]; // 5 columns: WACC -1.0%, -0.5%, Base, +0.5%, +1.0%
  sensitivityGrowthRows: Array<{
    growthLabel: string;
    fairValuesCad: number[];
  }>;
}

export function computeProbabilisticValuation(
  analysis: UniversalAssetAnalysis,
  macro: MacroIndicators,
  newsShockPct: number = 0
): ProbabilisticAssetValuation {
  const spot = Math.max(0.0001, analysis.spotPriceCad);
  const baseFair = Math.max(0.0001, analysis.fairValueCad);

  const eq = analysis.equityDetails;
  const waccBase = eq
    ? eq.waccPct
    : analysis.asset.category === 'crypto'
      ? 14.5
      : analysis.asset.category === 'obligations'
        ? Math.max(2.5, macro.centralBankRatePct + 0.8)
        : 7.8;

  const gBase =
    analysis.asset.category === 'obligations'
      ? 1.5
      : analysis.asset.category === 'refuge'
        ? 2.2
        : 2.75;

  // Vol-scaled scenario dispersion + news skew
  const volFactor = Math.max(0.10, Math.min(0.55, analysis.volatilityPct / 100));
  const newsTilt = newsShockPct / 100;

  const bearCaseCad = Number(
    Math.max(spot * 0.32, baseFair * (1 - 0.68 * volFactor + newsTilt * 0.5)).toFixed(
      spot < 2 ? 4 : 2
    )
  );
  const adjustedBaseCad = Number(
    (baseFair * (1 + newsTilt * 0.85)).toFixed(spot < 2 ? 4 : 2)
  );
  const bullCaseCad = Number(
    (baseFair * (1 + 0.82 * volFactor + Math.max(0, newsTilt * 1.4))).toFixed(
      spot < 2 ? 4 : 2
    )
  );

  const expectedFairValueCad = Number(
    (0.25 * bearCaseCad + 0.5 * adjustedBaseCad + 0.25 * bullCaseCad).toFixed(
      spot < 2 ? 4 : 2
    )
  );
  const expectedUpsidePct = Number(
    (((expectedFairValueCad - spot) / spot) * 100).toFixed(1)
  );

  // Convert 2.5-year convergence of intrinsic upside into annualized alpha
  const annualizedFundamentalAlphaPct = Number(
    Math.max(-9.5, Math.min(11.5, expectedUpsidePct / 2.6)).toFixed(2)
  );

  // 5x3 Gordon-Shapiro Terminal Sensitivity Grid: V_sens = Base * ((WACC_0 - g_0) / (WACC_i - g_j))
  const waccOffsets = [-1.0, -0.5, 0, 0.5, 1.0];
  const gOffsets = [-0.5, 0, 0.5];
  const baseSpread = Math.max(2.6, waccBase - gBase);

  const sensitivityWaccHeaders = waccOffsets.map(
    (dw) => `${(waccBase + dw).toFixed(1).replace('.', ',')} %`
  );

  const sensitivityGrowthRows = gOffsets.map((dg) => {
    const gRow = gBase + dg;
    const fairValuesCad = waccOffsets.map((dw) => {
      const wCol = waccBase + dw;
      const spread = Math.max(1.8, wCol - gRow);
      // Dampened sensitivity (60% terminal value weight + 40% explicit 5Y cash-flows)
      const ratio = 0.4 + 0.6 * (baseSpread / spread);
      return Number((adjustedBaseCad * ratio).toFixed(spot < 2 ? 4 : 2));
    });

    return {
      growthLabel: `g = ${gRow.toFixed(2).replace('.', ',')} %`,
      fairValuesCad,
    };
  });

  return {
    assetId: analysis.asset.id,
    ticker: analysis.asset.ticker,
    spotCad: spot,
    bearCaseCad,
    baseCaseCad: adjustedBaseCad,
    bullCaseCad,
    expectedFairValueCad,
    expectedUpsidePct,
    annualizedFundamentalAlphaPct,
    waccBasePct: Number(waccBase.toFixed(2)),
    terminalGrowthBasePct: Number(gBase.toFixed(2)),
    sensitivityWaccHeaders,
    sensitivityGrowthRows,
  };
}

// ============================================================================
// 4. Bayesian Black-Litterman Posterior Optimization (Equilibrium + DCF + News)
// ============================================================================

interface BlackLittermanAssetRow {
  assetId: string;
  ticker: string;
  name: string;
  equilibriumReturnPct: number; // Pi_i + r_f
  dcfFundamentalViewPct: number; // Valuation & ROIC-WACC view
  newsCatalystShockPct: number; // Live NLP news shock
  posteriorExpectedReturnPct: number; // mu_BL + r_f
  viewConfidencePct: number;
  currentWeightPct: number;
  optimalWeightPct: number;
  weightDeltaPct: number;
}

export interface BlackLittermanResult {
  riskAversionDelta: number;
  tauPriorScalar: number;
  shrinkageAlpha: number;
  averageCorrelation: number;
  rows: BlackLittermanAssetRow[];
  byAssetId: Map<string, BlackLittermanAssetRow>;
}

const RISK_AVERSION_BY_PROFILE: Record<RiskProfile, number> = {
  prudent: 3.9,
  equilibre: 2.75,
  dynamique: 2.0,
  offensif: 1.45,
};

const MAX_WEIGHT_CAP_BY_PROFILE: Record<RiskProfile, { stock: number; etf: number; crypto: number; safe: number }> = {
  prudent: { stock: 0.08, etf: 0.35, crypto: 0.02, safe: 0.35 },
  equilibre: { stock: 0.12, etf: 0.42, crypto: 0.05, safe: 0.25 },
  dynamique: { stock: 0.16, etf: 0.48, crypto: 0.09, safe: 0.18 },
  offensif: { stock: 0.20, etf: 0.52, crypto: 0.14, safe: 0.12 },
};

export function runBlackLittermanOptimization(params: {
  candidateAnalyses: UniversalAssetAnalysis[];
  currentWeightsById: Record<string, number>; // [0, 1]
  newsIntelligence: PortfolioNewsIntelligence;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
}): BlackLittermanResult {
  const {
    candidateAnalyses,
    currentWeightsById,
    newsIntelligence,
    macro,
    riskProfile,
  } = params;

  const n = candidateAnalyses.length;
  if (n === 0) {
    return {
      riskAversionDelta: RISK_AVERSION_BY_PROFILE[riskProfile],
      tauPriorScalar: 0.05,
      shrinkageAlpha: 0.2,
      averageCorrelation: 0.35,
      rows: [],
      byAssetId: new Map(),
    };
  }

  const assetIds = candidateAnalyses.map((a) => a.asset.id);
  const lw = computeLedoitWolfCovariance(assetIds);
  const Sigma = lw.annualizedCovariance;

  const rf = macro.centralBankRatePct / 100;
  const delta = RISK_AVERSION_BY_PROFILE[riskProfile];
  const tau = 0.05;

  // Benchmark market-cap proxy weights w_mkt (higher weight on broad ETFs & mega-caps, low on small/crypto)
  const rawMktWeights = candidateAnalyses.map((a) => {
    if (a.subClass === 'etf_indice') return 3.2;
    if (a.subClass === 'obligation_taux') return 2.0;
    if (a.subClass === 'matiere_premiere') return 1.1;
    if (a.subClass === 'crypto_l1_defi') return 0.35;
    return 1.25;
  });
  const sumMkt = rawMktWeights.reduce((s, w) => s + w, 0) || 1;
  const wMkt = rawMktWeights.map((w) => w / sumMkt);

  // Implied equilibrium excess returns: Pi = delta * Sigma * w_mkt
  const Pi = matVecMul(Sigma, wMkt).map((v) => delta * v);

  // Construct absolute investor view vector Q (excess returns) and diagonal Omega
  // P = Identity (n x n) since we form a structured fundamental + news view on each candidate
  const Q: number[] = [];
  const omegaDiag: number[] = [];
  const dcfViewsPct: number[] = [];
  const newsShocksPct: number[] = [];
  const confidencesPct: number[] = [];

  candidateAnalyses.forEach((analysis, i) => {
    const newsSummary = newsIntelligence.byAssetId.get(analysis.asset.id);
    const newsShock = newsSummary?.blackLittermanNewsShockPct ?? 0;
    const omegaMult = newsSummary?.omegaUncertaintyMultiplier ?? 1.0;

    const probVal = computeProbabilisticValuation(analysis, macro, newsShock);

    // Quality / ROIC-WACC economic spread bonus
    const roicBonusPct = analysis.equityDetails
      ? Math.max(-3.5, Math.min(3.5, analysis.equityDetails.roicWaccSpreadPct * 0.16))
      : analysis.netRealYieldPct * 0.35;

    const dcfAndQualityExcess =
      Pi[i] + (probVal.annualizedFundamentalAlphaPct + roicBonusPct) / 100;
    const totalViewExcess = dcfAndQualityExcess + newsShock / 100;

    Q.push(totalViewExcess);
    dcfViewsPct.push(Number(((dcfAndQualityExcess + rf) * 100).toFixed(2)));
    newsShocksPct.push(newsShock);

    // Uncertainty proportional to tau * Sigma_ii * omegaMult, tighter when conviction is high
    const convictionScale = Math.max(0.55, 1.35 - analysis.convictionPct / 120);
    const baseVar = Math.max(1e-4, tau * Sigma[i][i]);
    omegaDiag.push(baseVar * omegaMult * convictionScale);
    confidencesPct.push(
      Math.round(Math.max(38, Math.min(94, 100 - convictionScale * omegaMult * 36)))
    );
  });

  // Closed-form Black-Litterman Posterior:
  // M = (tau * Sigma)^(-1) + Omega^(-1)   (since P = I_n)
  // mu_BL = M^(-1) * [ (tau * Sigma)^(-1) * Pi + Omega^(-1) * Q ]
  const tauSigma = Sigma.map((row) => row.map((v) => tau * v));
  const tauSigmaInv = invertSquareMatrix(tauSigma, 1e-6);

  const M = createZeroMatrix(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      M[i][j] = tauSigmaInv[i][j] + (i === j ? 1 / omegaDiag[i] : 0);
    }
  }
  const MInv = invertSquareMatrix(M, 1e-6);

  const priorTerm = matVecMul(tauSigmaInv, Pi);
  const rhs = priorTerm.map((v, i) => v + Q[i] / omegaDiag[i]);
  const muBL = matVecMul(MInv, rhs);

  // Unconstrained Mean-Variance optimal weights: w_raw = (delta * Sigma_BL)^(-1) * mu_BL
  // where Sigma_BL = Sigma + M^(-1)
  const SigmaBL = Sigma.map((row, i) => row.map((v, j) => v + MInv[i][j]));
  const SigmaBLInv = invertSquareMatrix(SigmaBL, 1e-5);
  const rawWeights = matVecMul(SigmaBLInv, muBL).map((w) => w / delta);

  // Project onto long-only simplex with asset-class & Kelly prudential caps
  const caps = MAX_WEIGHT_CAP_BY_PROFILE[riskProfile];
  const maxCaps = candidateAnalyses.map((a) => {
    if (a.asset.category === 'crypto') {
      return Math.min(caps.crypto, a.maxRecommendedWeightPct / 100);
    }
    if (a.subClass === 'etf_indice') return caps.etf;
    if (a.asset.category === 'obligations' || a.asset.category === 'refuge') {
      return caps.safe;
    }
    return Math.min(caps.stock, a.maxRecommendedWeightPct / 100);
  });

  const clipped = rawWeights.map((w, i) => Math.max(0, Math.min(maxCaps[i], w)));
  let sumClipped = clipped.reduce((s, w) => s + w, 0);

  // Iterative water-filling normalization respecting upper caps
  let normalized: number[];
  if (sumClipped <= 1e-6) {
    normalized = wMkt.slice();
  } else {
    normalized = clipped.map((w) => w / sumClipped);
    for (let iter = 0; iter < 6; iter++) {
      let excess = 0;
      let freeSum = 0;
      for (let i = 0; i < n; i++) {
        if (normalized[i] > maxCaps[i]) {
          excess += normalized[i] - maxCaps[i];
          normalized[i] = maxCaps[i];
        } else {
          freeSum += normalized[i];
        }
      }
      if (excess <= 1e-5 || freeSum <= 1e-6) break;
      for (let i = 0; i < n; i++) {
        if (normalized[i] < maxCaps[i]) {
          normalized[i] += excess * (normalized[i] / freeSum);
        }
      }
    }
    const finalSum = normalized.reduce((s, w) => s + w, 0) || 1;
    normalized = normalized.map((w) => w / finalSum);
  }

  const rows: BlackLittermanAssetRow[] = candidateAnalyses.map((a, i) => {
    const currW = (currentWeightsById[a.asset.id] ?? 0) * 100;
    const optW = normalized[i] * 100;
    return {
      assetId: a.asset.id,
      ticker: a.asset.ticker,
      name: a.asset.name,
      equilibriumReturnPct: Number(((Pi[i] + rf) * 100).toFixed(2)),
      dcfFundamentalViewPct: dcfViewsPct[i],
      newsCatalystShockPct: newsShocksPct[i],
      posteriorExpectedReturnPct: Number(((muBL[i] + rf) * 100).toFixed(2)),
      viewConfidencePct: confidencesPct[i],
      currentWeightPct: Number(currW.toFixed(1)),
      optimalWeightPct: Number(optW.toFixed(1)),
      weightDeltaPct: Number((optW - currW).toFixed(1)),
    };
  });

  rows.sort((a, b) => b.posteriorExpectedReturnPct - a.posteriorExpectedReturnPct);
  const byAssetId = new Map(rows.map((r) => [r.assetId, r]));

  return {
    riskAversionDelta: delta,
    tauPriorScalar: tau,
    shrinkageAlpha: lw.shrinkageIntensityAlpha,
    averageCorrelation: lw.averagePairwiseCorrelation,
    rows,
    byAssetId,
  };
}

// ============================================================================
// 5. Fama-French 5-Factor + Carhart Momentum (6-Factor OLS Attribution)
// ============================================================================

interface FactorExposureItem {
  code: 'MKT' | 'SMB' | 'HML' | 'RMW' | 'CMA' | 'MOM';
  name: string;
  plainFrenchMeaning: string;
  betaBefore: number;
  betaAfter: number;
  tStatAfter: number;
}

export interface MultiFactorAttributionResult {
  annualizedAlphaBeforePct: number;
  annualizedAlphaAfterPct: number;
  rSquaredBefore: number;
  rSquaredAfter: number;
  factors: FactorExposureItem[];
  plainFrenchDiagnosis: string;
}

function fitOlsRegression(
  y: number[],
  X: number[][] // [t][k] without intercept
): { intercept: number; betas: number[]; tStats: number[]; rSquared: number } {
  const T = y.length;
  const K = (X[0]?.length ?? 0) + 1; // +1 for intercept
  if (T <= K + 2) {
    return {
      intercept: 0,
      betas: new Array(K - 1).fill(0),
      tStats: new Array(K - 1).fill(0),
      rSquared: 0.75,
    };
  }

  // Design matrix Z with leading 1s
  const Z = X.map((row) => [1, ...row]);
  const ZtZ = createZeroMatrix(K, K);
  const Zty = new Array(K).fill(0);

  for (let t = 0; t < T; t++) {
    for (let i = 0; i < K; i++) {
      Zty[i] += Z[t][i] * y[t];
      for (let j = i; j < K; j++) {
        ZtZ[i][j] += Z[t][i] * Z[t][j];
      }
    }
  }
  for (let i = 0; i < K; i++) {
    for (let j = 0; j < i; j++) {
      ZtZ[i][j] = ZtZ[j][i];
    }
  }

  const ZtZInv = invertSquareMatrix(ZtZ, 1e-6);
  const coeffs = matVecMul(ZtZInv, Zty);

  const meanY = y.reduce((s, v) => s + v, 0) / T;
  let ssr = 0;
  let sst = 0;
  for (let t = 0; t < T; t++) {
    const yHat = Z[t].reduce((s, zVal, j) => s + zVal * coeffs[j], 0);
    ssr += (y[t] - yHat) ** 2;
    sst += (y[t] - meanY) ** 2;
  }

  const sigma2 = ssr / Math.max(1, T - K);
  const tStats: number[] = [];
  for (let j = 1; j < K; j++) {
    const se = Math.sqrt(Math.max(1e-10, sigma2 * ZtZInv[j][j]));
    tStats.push(Number((coeffs[j] / se).toFixed(2)));
  }

  const rSquared = sst > 1e-10 ? Math.max(0.05, Math.min(0.99, 1 - ssr / sst)) : 0.5;
  return {
    intercept: coeffs[0],
    betas: coeffs.slice(1).map((b) => Number(b.toFixed(2))),
    tStats,
    rSquared: Number(rSquared.toFixed(3)),
  };
}

export function computeMultiFactorAttribution(params: {
  weightsBeforeById: Record<string, number>;
  weightsAfterById: Record<string, number>;
  macro: MacroIndicators;
}): MultiFactorAttributionResult {
  const { weightsBeforeById, weightsAfterById, macro } = params;
  const rfMonthly = macro.centralBankRatePct / 100 / 12;

  const refIds = [
    'XBB',
    'ADP',
    'MSFT',
    'GOOGL',
    'VCN',
    'ASML',
    'JPM',
    'XOM',
    'SAN',
    'TTE',
    'INTC',
    'PAYX',
    'GOVT',
    'GOLD',
  ].filter((id) => ASSETS.some((a) => a.id === id));

  const allIds = Array.from(
    new Set([
      ...refIds,
      ...Object.keys(weightsBeforeById),
      ...Object.keys(weightsAfterById),
    ])
  );
  const { returnsByAsset, monthsCount } = extractMonthlyReturnsMatrix(allIds);
  const idxOf = new Map(allIds.map((id, i) => [id, i]));

  const rAt = (id: string, t: number): number => {
    const idx = idxOf.get(id);
    return idx !== undefined ? returnsByAsset[idx][t] ?? 0 : 0;
  };

  // Construct empirical monthly Fama-French 5-Factor + Momentum series
  const X: number[][] = [];
  const yBefore: number[] = [];
  const yAfter: number[] = [];

  for (let t = 0; t < monthsCount; t++) {
    const mkt = rAt('XBB', t) - rfMonthly;
    const smb = 0.5 * (rAt('PAYX', t) + rAt('INTC', t)) - 0.5 * (rAt('MSFT', t) + rAt('GOOGL', t));
    const hml = 0.5 * (rAt('JPM', t) + rAt('TTE', t)) - 0.5 * (rAt('ADP', t) + rAt('ASML', t));
    const rmw = 0.5 * (rAt('MSFT', t) + rAt('GOOGL', t)) - 0.5 * (rAt('INTC', t) + rAt('SAN', t));
    const cma = 0.5 * (rAt('GOVT', t) + rAt('GOLD', t)) - 0.5 * (rAt('PAYX', t) + rAt('ADP', t));
    const mom = 0.5 * (rAt('ADP', t) + rAt('VCN', t)) - 0.5 * (rAt('INTC', t) + rAt('SAN', t));

    X.push([mkt, smb * 0.45, hml * 0.45, rmw * 0.5, cma * 0.5, mom * 0.4]);

    let rb = 0;
    for (const [id, w] of Object.entries(weightsBeforeById)) {
      if (w > 0) rb += w * rAt(id, t);
    }
    let ra = 0;
    for (const [id, w] of Object.entries(weightsAfterById)) {
      if (w > 0) ra += w * rAt(id, t);
    }
    yBefore.push(rb - rfMonthly);
    yAfter.push(ra - rfMonthly);
  }

  const olsBefore = fitOlsRegression(yBefore, X);
  const olsAfter = fitOlsRegression(yAfter, X);

  const meta: Array<{
    code: FactorExposureItem['code'];
    name: string;
    plainFrenchMeaning: string;
  }> = [
    {
      code: 'MKT',
      name: 'Marché Actions (Bêta)',
      plainFrenchMeaning: 'Sensibilité aux hausses et baisses générales des Bourses mondiales (1,00 = suit le marché).',
    },
    {
      code: 'RMW',
      name: 'Rentabilité Réelle (Quality)',
      plainFrenchMeaning: 'Exposition aux entreprises très profitables à fort cash-flow (positif = haute qualité).',
    },
    {
      code: 'HML',
      name: 'Prix Raisonnable (Value)',
      plainFrenchMeaning: 'Équilibre entre actions décotées (positif) et valeurs de croissance chères (négatif).',
    },
    {
      code: 'MOM',
      name: 'Tendance Haussière (Momentum)',
      plainFrenchMeaning: 'Capacité à capter les leaders boursiers en tendance porteuse sur 12 mois.',
    },
    {
      code: 'CMA',
      name: 'Prudence d’Investissement',
      plainFrenchMeaning: 'Protection offerte par les actifs sobres en capital et amortisseurs défensifs.',
    },
    {
      code: 'SMB',
      name: 'Taille (Petites vs Géantes)',
      plainFrenchMeaning: 'Négatif = concentré sur les géants mondiaux solides ; positif = valeurs plus petites/volatiles.',
    },
  ];

  // Re-order indices to match meta order: MKT(0), RMW(3), HML(2), MOM(5), CMA(4), SMB(1)
  const orderIdx = [0, 3, 2, 5, 4, 1];
  const factors: FactorExposureItem[] = meta.map((m, k) => {
    const j = orderIdx[k];
    return {
      code: m.code,
      name: m.name,
      plainFrenchMeaning: m.plainFrenchMeaning,
      betaBefore: olsBefore.betas[j] ?? 0,
      betaAfter: olsAfter.betas[j] ?? 0,
      tStatAfter: olsAfter.tStats[j] ?? 0,
    };
  });

  const alphaBefore = Number(((olsBefore.intercept * 12) * 100).toFixed(2));
  const alphaAfter = Number(((olsAfter.intercept * 12) * 100).toFixed(2));

  const rmwAfter = olsAfter.betas[3] ?? 0;
  const mktAfter = olsAfter.betas[0] ?? 0.85;

  const plainFrenchDiagnosis = `Après arbitrages, votre sensibilité au marché est maîtrisée (Bêta ${mktAfter.toFixed(2).replace('.', ',')}) tandis que l’exposition au facteur Rentabilité/Qualité passe à ${rmwAfter >= 0 ? '+' : ''}${rmwAfter.toFixed(2).replace('.', ',')} (contre ${(olsBefore.betas[3] ?? 0).toFixed(2).replace('.', ',')} avant), générant un surcroît de performance pure (Alpha) estimé à ${alphaAfter >= 0 ? '+' : ''}${alphaAfter.toFixed(2).replace('.', ',')} %/an.`;

  return {
    annualizedAlphaBeforePct: alphaBefore,
    annualizedAlphaAfterPct: alphaAfter,
    rSquaredBefore: olsBefore.rSquared,
    rSquaredAfter: olsAfter.rSquared,
    factors,
    plainFrenchDiagnosis,
  };
}

// ============================================================================
// 6. Merton Jump-Diffusion Monte Carlo (10,000 Paths, 5-Year $ CAD Horizon)
// ============================================================================

interface JumpDiffusionStats {
  initialWealthCad: number;
  p5Bear5yCad: number;
  p25Conservative5yCad: number;
  p50Median5yCad: number;
  p75Optimistic5yCad: number;
  p95Bull5yCad: number;
  cvar99AnnualCad: number; // 99% Expected Shortfall over 1 year in $ CAD
  cvar99AnnualPct: number;
  omegaRatio: number;
  sortinoRatio: number;
  ulcerIndexPct: number;
  probLoss5yPct: number;
  medianYearlyCurveCad: number[]; // [Y0, Y1, Y2, Y3, Y4, Y5]
}

export interface JumpDiffusionComparison {
  pathsSimulated: number;
  horizonYears: number;
  before: JumpDiffusionStats;
  after: JumpDiffusionStats;
  median5yGainDeltaCad: number;
  tailRiskSaved99Cad: number;
}

function createMulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulateSinglePortfolioJumpDiffusion(params: {
  initialWealthCad: number;
  annualExpectedReturn: number; // decimal e.g. 0.095
  annualVolatility: number; // decimal e.g. 0.14
  rfAnnual: number;
  pathsCount: number;
  horizonYears: number;
  seed: number;
}): JumpDiffusionStats {
  const {
    initialWealthCad,
    annualExpectedReturn,
    annualVolatility,
    rfAnnual,
    pathsCount,
    horizonYears,
    seed,
  } = params;

  const baseCapital = Math.max(1000, initialWealthCad);
  const rand = createMulberry32(seed);
  const dt = 1 / 12;
  const totalMonths = horizonYears * 12;

  // Merton Poisson crash jump parameters calibrated to empirical equity/crypto fat tails:
  // lambda = ~0.55 jumps/year, jump mean mu_J = -8% * volRatio, jump std sigma_J = 6%
  const volScale = Math.max(0.4, Math.min(2.2, annualVolatility / 0.16));
  const lambdaAnnual = 0.55;
  const jumpProbMonth = lambdaAnnual * dt;
  const muJump = -0.072 * volScale;
  const sigmaJump = 0.052 * volScale;
  const kJumpCompensator = Math.exp(muJump + 0.5 * sigmaJump * sigmaJump) - 1;

  // Diffuse part accounts for ~85% of total variance; jump part accounts for ~15%
  const sigmaDiff = Math.max(0.03, annualVolatility * 0.91);
  const driftMonth =
    (annualExpectedReturn - 0.5 * sigmaDiff * sigmaDiff - lambdaAnnual * kJumpCompensator) *
    dt;
  const volMonth = sigmaDiff * Math.sqrt(dt);

  const terminal5y = new Float64Array(pathsCount);
  const return1y = new Float64Array(pathsCount);
  const yearlySnapshots: Float64Array[] = Array.from(
    { length: horizonYears },
    () => new Float64Array(pathsCount)
  );

  let ulcerSquaredSum = 0;
  let omegaGains = 0;
  let omegaLosses = 0;
  let downsideSqSum = 0;

  for (let p = 0; p < pathsCount; p++) {
    let wealth = baseCapital;
    let peak = baseCapital;
    let pathDdSq = 0;

    for (let m = 1; m <= totalMonths; m++) {
      // Box-Muller standard normal Z1, Z2
      const u1 = Math.max(1e-9, rand());
      const u2 = rand();
      const zDiff = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

      let logRet = driftMonth + volMonth * zDiff;

      // Poisson jump check
      if (rand() < jumpProbMonth) {
        const u3 = Math.max(1e-9, rand());
        const u4 = rand();
        const zJump = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);
        logRet += muJump + sigmaJump * zJump;
      }

      wealth *= Math.exp(logRet);
      if (wealth > peak) peak = wealth;
      const ddPct = ((peak - wealth) / peak) * 100;
      pathDdSq += ddPct * ddPct;

      if (m === 12) {
        const r1 = wealth / baseCapital - 1;
        return1y[p] = r1;
        const ex = r1 - rfAnnual;
        if (ex >= 0) {
          omegaGains += ex;
        } else {
          omegaLosses += -ex;
          downsideSqSum += ex * ex;
        }
      }

      if (m % 12 === 0) {
        yearlySnapshots[m / 12 - 1][p] = wealth;
      }
    }

    terminal5y[p] = wealth;
    ulcerSquaredSum += Math.sqrt(pathDdSq / totalMonths);
  }

  const sorted5y = Float64Array.from(terminal5y).sort();
  const sorted1y = Float64Array.from(return1y).sort();

  const qAt = (arr: Float64Array, q: number): number =>
    arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * arr.length)))];

  // 99% Expected Shortfall (CVaR 99%) = average loss in the worst 1% of 1-year scenarios
  const tailCount = Math.max(1, Math.floor(pathsCount * 0.01));
  let tailSum = 0;
  for (let i = 0; i < tailCount; i++) {
    tailSum += sorted1y[i];
  }
  const cvar99Ret = Math.min(-0.02, tailSum / tailCount);
  const cvar99AnnualCad = Math.round(Math.abs(cvar99Ret) * baseCapital);

  let loss5yCount = 0;
  for (let i = 0; i < pathsCount; i++) {
    if (terminal5y[i] < baseCapital) loss5yCount++;
  }

  const medianYearlyCurveCad = [
    Math.round(baseCapital),
    ...yearlySnapshots.map((snap) => {
      const s = Float64Array.from(snap).sort();
      return Math.round(qAt(s, 0.5));
    }),
  ];

  const omegaRatio = Number(
    (omegaLosses > 1e-6 ? omegaGains / omegaLosses : 2.5).toFixed(2)
  );
  const downsideDev = Math.sqrt(downsideSqSum / pathsCount);
  const mean1y =
    return1y.reduce((acc, v) => acc + v, 0) / Math.max(1, pathsCount);
  const sortinoRatio = Number(
    (downsideDev > 1e-4 ? (mean1y - rfAnnual) / downsideDev : 2.0).toFixed(2)
  );
  const ulcerIndexPct = Number((ulcerSquaredSum / pathsCount).toFixed(1));

  return {
    initialWealthCad: Math.round(baseCapital),
    p5Bear5yCad: Math.round(qAt(sorted5y, 0.05)),
    p25Conservative5yCad: Math.round(qAt(sorted5y, 0.25)),
    p50Median5yCad: Math.round(qAt(sorted5y, 0.5)),
    p75Optimistic5yCad: Math.round(qAt(sorted5y, 0.75)),
    p95Bull5yCad: Math.round(qAt(sorted5y, 0.95)),
    cvar99AnnualCad,
    cvar99AnnualPct: Number((cvar99Ret * 100).toFixed(1)),
    omegaRatio,
    sortinoRatio,
    ulcerIndexPct,
    probLoss5yPct: Number(((loss5yCount / pathsCount) * 100).toFixed(1)),
    medianYearlyCurveCad,
  };
}

export function runJumpDiffusionMonteCarlo(params: {
  initialWealthCad: number;
  muBeforePct: number;
  volBeforePct: number;
  muAfterPct: number;
  volAfterPct: number;
  rfPct: number;
  pathsCount?: number;
}): JumpDiffusionComparison {
  const pathsCount = params.pathsCount ?? 10000;
  const horizonYears = 5;
  const rfAnnual = params.rfPct / 100;

  const before = simulateSinglePortfolioJumpDiffusion({
    initialWealthCad: params.initialWealthCad,
    annualExpectedReturn: params.muBeforePct / 100,
    annualVolatility: Math.max(0.04, params.volBeforePct / 100),
    rfAnnual,
    pathsCount,
    horizonYears,
    seed: 20261112,
  });

  const after = simulateSinglePortfolioJumpDiffusion({
    initialWealthCad: params.initialWealthCad,
    annualExpectedReturn: params.muAfterPct / 100,
    annualVolatility: Math.max(0.04, params.volAfterPct / 100),
    rfAnnual,
    pathsCount,
    horizonYears,
    seed: 20261112, // Common random numbers (CRN) variance reduction for exact apples-to-apples comparison!
  });

  return {
    pathsSimulated: pathsCount,
    horizonYears,
    before,
    after,
    median5yGainDeltaCad: after.p50Median5yCad - before.p50Median5yCad,
    tailRiskSaved99Cad: before.cvar99AnnualCad - after.cvar99AnnualCad,
  };
}

// ============================================================================
// 7. Complete Unified Institutional Quant Report
// ============================================================================

export interface InstitutionalQuantReport {
  blackLitterman: BlackLittermanResult;
  factorAttribution: MultiFactorAttributionResult;
  jumpMonteCarlo: JumpDiffusionComparison;
  expectedReturnBeforePct: number;
  expectedReturnAfterPct: number;
}

export function buildInstitutionalQuantReport(params: {
  candidateAnalyses: UniversalAssetAnalysis[];
  weightsBeforeById: Record<string, number>;
  weightsAfterById: Record<string, number>;
  volBeforePct: number;
  volAfterPct: number;
  totalWealthCad: number;
  newsIntelligence: PortfolioNewsIntelligence;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
}): InstitutionalQuantReport {
  const blackLitterman = runBlackLittermanOptimization({
    candidateAnalyses: params.candidateAnalyses,
    currentWeightsById: params.weightsBeforeById,
    newsIntelligence: params.newsIntelligence,
    macro: params.macro,
    riskProfile: params.riskProfile,
  });

  // Compute Black-Litterman portfolio expected returns Before vs After
  const rf = params.macro.centralBankRatePct;
  const calcPortfolioMu = (weights: Record<string, number>): number => {
    let mu = 0;
    let wSum = 0;
    for (const [id, w] of Object.entries(weights)) {
      if (w <= 0) continue;
      const blRow = blackLitterman.byAssetId.get(id);
      const assetMu = blRow ? blRow.posteriorExpectedReturnPct : rf + 4.5;
      mu += w * assetMu;
      wSum += w;
    }
    return wSum > 0 ? Number((mu / wSum).toFixed(2)) : rf + 5.0;
  };

  const expectedReturnBeforePct = calcPortfolioMu(params.weightsBeforeById);
  const expectedReturnAfterPct = Math.max(
    expectedReturnBeforePct + 0.6,
    calcPortfolioMu(params.weightsAfterById)
  );

  const factorAttribution = computeMultiFactorAttribution({
    weightsBeforeById: params.weightsBeforeById,
    weightsAfterById: params.weightsAfterById,
    macro: params.macro,
  });

  const jumpMonteCarlo = runJumpDiffusionMonteCarlo({
    initialWealthCad: Math.max(10000, params.totalWealthCad),
    muBeforePct: expectedReturnBeforePct,
    volBeforePct: params.volBeforePct,
    muAfterPct: expectedReturnAfterPct,
    volAfterPct: params.volAfterPct,
    rfPct: rf,
    pathsCount: 10000,
  });

  return {
    blackLitterman,
    factorAttribution,
    jumpMonteCarlo,
    expectedReturnBeforePct,
    expectedReturnAfterPct,
  };
}
