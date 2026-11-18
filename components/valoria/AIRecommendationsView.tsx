import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import {
  RefreshCw,
  Plus,
  History,
  Check,
  Search,
  SlidersHorizontal,
  ArrowRight,
} from 'lucide-react';
import {
  AssetCategory,
  GOAL_LABELS,
  InvestmentGoal,
  MARKET_REGIMES,
  MacroIndicators,
  RegimeId,
  RiskProfile,
  getAssetById,
} from '../../services/valoria/marketData';
import {
  PortfolioLot,
  PortfolioSummary,
  computeOptimalAllocation,
  runMonteCarloProjection,
  scoreAssetsForMacro,
} from '../../services/valoria/engine';
import {
  buildRebalancingPlan,
  computeAssetTechnicals,
  computePortfolioRiskMetrics,
} from '../../services/valoria/quantAnalytics';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';
import { MiniSparkline } from './MiniSparkline';
import { fetchValoriaAiRecommendations } from '../../services/valoria/valoriaAiClient';

interface AISuggestion {
  assetId: string;
  actionType: string;
  convictionPct?: number;
  wrapper?: string;
  suggestedAmountEuro: number;
  targetWeightPct: number;
  reasoning: string;
}

interface AIRecommendationPayload {
  marketSynthesis: string;
  portfolioDiagnosis: string;
  strategyHeadline: string;
  keyRiskAlert: string;
  suggestions: AISuggestion[];
}

interface AIRecommendationsViewProps {
  regimeId: RegimeId;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
  goal: InvestmentGoal;
  livePrices: Record<string, number>;
  portfolioSummary: PortfolioSummary;
  syncedMonthlySavings?: number;
  geminiApiKey?: string;
  onSelectRegime: (id: RegimeId) => void;
  onUpdateMacro: (next: MacroIndicators) => void;
  onSelectRiskProfile: (profile: RiskProfile) => void;
  onSelectGoal: (goal: InvestmentGoal) => void;
  onAddLot: (lot: Omit<PortfolioLot, 'id'>) => void;
  onExecuteRebalanceOrder: (assetId: string, deltaEuro: number) => void;
  onApplyRecommendedAllocation: (
    totalBudget: number,
    slices: { assetId: string; weightPct: number }[]
  ) => void;
  onOpenBacktestForAsset: (assetId: string, purchaseYm: string, amount: number) => void;
}

const CAT_COLOR: Record<AssetCategory, string> = {
  actions: 'bg-accent',
  obligations: 'bg-accent',
  crypto: 'bg-accent',
  refuge: 'bg-alerte-texte',
};

export const AIRecommendationsView: React.FC<AIRecommendationsViewProps> = ({
  regimeId,
  macro,
  riskProfile,
  goal,
  livePrices,
  portfolioSummary,
  syncedMonthlySavings,
  geminiApiKey = '',
  onSelectRegime,
  onUpdateMacro,
  onSelectRiskProfile,
  onSelectGoal,
  onAddLot,
  onExecuteRebalanceOrder,
  onApplyRecommendedAllocation,
  onOpenBacktestForAsset,
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const [horizonYears, setHorizonYears] = useState<number>(12);
  const [monthlyBudget, setMonthlyBudget] = useState<number>(
    syncedMonthlySavings && syncedMonthlySavings > 0 ? syncedMonthlySavings : 350
  );

  React.useEffect(() => {
    if (syncedMonthlySavings && syncedMonthlySavings > 0) {
      setMonthlyBudget(Math.min(5000, syncedMonthlySavings));
    }
  }, [syncedMonthlySavings]);
  const [showCustomMacro, setShowCustomMacro] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [screenerCategory, setScreenerCategory] = useState<'all' | AssetCategory>('all');
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);

  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AIRecommendationPayload | null>(null);

  const activeRegime = useMemo(
    () => MARKET_REGIMES.find((r) => r.id === regimeId) ?? MARKET_REGIMES[0],
    [regimeId]
  );

  const scoredAssets = useMemo(
    () => scoreAssetsForMacro(macro, riskProfile, goal),
    [macro, riskProfile, goal]
  );

  const optimalPortfolio = useMemo(
    () => computeOptimalAllocation(scoredAssets, riskProfile, goal),
    [scoredAssets, riskProfile, goal]
  );

  const lotsFromSummary = useMemo(
    () => portfolioSummary.lots.map((l) => l.lot),
    [portfolioSummary.lots]
  );

  const riskMetrics = useMemo(
    () => computePortfolioRiskMetrics(lotsFromSummary, livePrices, macro.centralBankRatePct),
    [lotsFromSummary, livePrices, macro.centralBankRatePct]
  );

  const technicals = useMemo(
    () => computeAssetTechnicals(livePrices, scoredAssets, macro),
    [livePrices, scoredAssets, macro]
  );

  const rebalancingPlan = useMemo(
    () =>
      buildRebalancingPlan({
        portfolioSummary,
        riskMetrics,
        optimalPortfolio,
        scoredAssets,
        riskProfile,
        goal,
      }),
    [portfolioSummary, riskMetrics, optimalPortfolio, scoredAssets, riskProfile, goal]
  );

  const projection = useMemo(
    () =>
      runMonteCarloProjection({
        initialCapital: Math.max(1000, Math.round(portfolioSummary.totalCurrentValue || 10000)),
        monthlyContribution: monthlyBudget,
        horizonYears,
        expectedReturnPct: optimalPortfolio.expectedAnnualReturnPct,
        annualVolatilityPct: optimalPortfolio.expectedVolatilityPct,
      }),
    [
      portfolioSummary.totalCurrentValue,
      monthlyBudget,
      horizonYears,
      optimalPortfolio.expectedAnnualReturnPct,
      optimalPortfolio.expectedVolatilityPct,
    ]
  );

  const filteredScreener = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return scoredAssets.filter((item) => {
      if (screenerCategory !== 'all' && item.asset.category !== screenerCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.asset.name.toLowerCase().includes(q) ||
        item.asset.ticker.toLowerCase().includes(q) ||
        item.asset.categoryLabel.toLowerCase().includes(q)
      );
    });
  }, [scoredAssets, screenerCategory, searchQuery]);

  const handleGenerateAI = async () => {
    setAiLoading(true);
    setAiError(null);

    try {
      const data = await fetchValoriaAiRecommendations(geminiApiKey, {
        profile: {
          goal,
          goalLabel: GOAL_LABELS[goal].label,
          riskProfile,
          horizonYears,
          monthlyBudget,
        },
        macro: {
          regimeName: activeRegime.name,
          ...macro,
        },
        portfolioSummary: {
          totalCurrentValue: portfolioSummary.totalCurrentValue,
          totalInvested: portfolioSummary.totalInvested,
          totalGainLossPct: portfolioSummary.totalGainLossPct,
          categoryWeightsPct: portfolioSummary.categoryWeightsPct,
          holdingsBrief: portfolioSummary.lots.map((l) => ({
            assetId: l.asset.id,
            name: l.asset.name,
            value: l.currentValue,
            weightPct: l.weightPct,
            gainPct: l.gainLossPct,
          })),
        },
        riskMetrics: {
          sharpeRatio: riskMetrics.sharpeRatio,
          sortinoRatio: riskMetrics.sortinoRatio,
          betaVsWorld: riskMetrics.betaVsWorld,
          jensenAlphaPct: riskMetrics.jensenAlphaPct,
          var95MonthlyEur: riskMetrics.var95MonthlyEur,
          concentrationHhi: riskMetrics.concentrationHhi,
        },
        topQuantAssets: scoredAssets
          .filter(
            (_s, idx) =>
              idx < 16 ||
              portfolioSummary.lots.some((l) => l.asset.id === _s.asset.id)
          )
          .map((s) => ({
            assetId: s.asset.id,
            ticker: s.asset.ticker,
            category: s.asset.category,
            predictiveScore: s.predictiveScore,
            sharpe: s.sharpeRatio,
            expectedReturnPct: s.expectedAnnualReturnPct,
            volatilityPct: s.expectedVolatilityPct,
            rsi14: technicals[s.asset.id]?.rsi14 ?? 50,
            valuation: technicals[s.asset.id]?.valuationMetricValue ?? '',
          })),
      });

      if (!data.ok || !data.recommendation) {
        throw new Error('Impossible de contacter le moteur IA pour le moment.');
      }

      setAiResult(data.recommendation as AIRecommendationPayload);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Erreur réseau lors de l’analyse IA.';
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  };

  // Cone SVG Geometry
  const mcW = 640;
  const mcH = 215;
  const pL = 54;
  const pR = 16;
  const pT = 14;
  const pB = 26;
  const wPlot = mcW - pL - pR;
  const hPlot = mcH - pT - pB;

  const maxMc = useMemo(() => {
    return Math.max(...projection.map((p) => p.p90), 1000) * 1.06;
  }, [projection]);

  const xMc = React.useCallback(
    (i: number) =>
      projection.length <= 1 ? pL : pL + (i / (projection.length - 1)) * wPlot,
    [projection.length, pL, wPlot]
  );
  const yMc = React.useCallback(
    (v: number) =>
      pT + hPlot - (Math.min(maxMc, Math.max(0, v)) / maxMc) * hPlot,
    [pT, hPlot, maxMc]
  );

  const bandOuter = useMemo(() => {
    const upper = projection.map((p, i) => `${xMc(i).toFixed(1)},${yMc(p.p90).toFixed(1)}`);
    const lower = [...projection]
      .reverse()
      .map((p, revIdx) => {
        const i = projection.length - 1 - revIdx;
        return `${xMc(i).toFixed(1)},${yMc(p.p10).toFixed(1)}`;
      });
    return `M${upper.join(' L')} L${lower.join(' L')} Z`;
  }, [projection, xMc, yMc]);

  const lineOf = (key: 'p50' | 'p90' | 'p10' | 'totalInvested') =>
    projection
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xMc(i).toFixed(1)},${yMc(p[key]).toFixed(1)}`)
      .join(' ');

  const finalYear = projection[projection.length - 1];
  const realRatePct = Number((macro.centralBankRatePct - macro.inflationPct).toFixed(2));

  return (
    <div className="space-y-6">
      {/* Compact Institutional Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-4 border-b border-bordure">
        <div>
          <p className="text-xs font-medium text-texte-doux mb-0.5">
            Allocation Black-Litterman / Markowitz · Arbitrages dollar par dollar ($ CAD) · Comité IA Gemini · Screener Multi-Facteurs
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-texte">
            Conseil Quantitatif &amp; Arbitrages de Marché
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomMacro((prev) => !prev)}
            className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-surface border border-bordure-champ rounded-md hover:bg-surface-douce transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>{showCustomMacro ? 'Fermer stress-test' : 'Stress-test macro'}</span>
          </button>

          <button
            type="button"
            onClick={handleGenerateAI}
            disabled={aiLoading}
            className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${aiLoading ? 'animate-spin' : ''}`} />
            <span>{aiLoading ? 'Calcul comité IA...' : 'Lancer Comité IA'}</span>
          </button>
        </div>
      </div>

      {/* Compact Visual Macro Gauges & Investor Profile Deck */}
      <section className="bg-surface border border-bordure rounded-lg p-5 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
          {/* Regime Selector + 4 Visual Macro Gauges */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-texte">
                Régime macroéconomique
              </span>
              <span className="text-[11px] font-mono tabular-nums text-texte-doux">
                Taux réel BdC :{' '}
                <strong className={realRatePct >= 0 ? 'text-succes-texte' : 'text-alerte-texte'}>
                  {formatSignedPct(realRatePct, 2)}
                </strong>{' '}
                · {activeRegime.historicalAnalogy}
              </span>
            </div>

            <div
              role="group"
              aria-label="Sélectionner un régime de marché"
              className="flex flex-wrap gap-1.5"
            >
              {MARKET_REGIMES.map((r) => (
                <button aria-pressed={Boolean(regimeId === r.id)}
                  key={r.id}
                  type="button"
                  onClick={() => onSelectRegime(r.id)}
                  className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    regimeId === r.id
                      ? 'bg-accent text-sur-accent border-accent font-semibold'
                      : 'bg-fond text-texte border-bordure hover:bg-surface-douce'
                  }`}
                >
                  {r.shortLabel}
                </button>
              ))}
            </div>

            {/* 4 Mini Visual Macro Gauges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              {[
                {
                  label: 'IPC Inflation',
                  val: formatPct(macro.inflationPct, 1),
                  pct: (macro.inflationPct / 7) * 100,
                  color: macro.inflationPct > 3 ? 'bg-erreur-texte' : 'bg-accent',
                },
                {
                  label: 'Taux BdC / Fed',
                  val: formatPct(macro.centralBankRatePct, 2),
                  pct: (macro.centralBankRatePct / 5.5) * 100,
                  color: 'bg-accent',
                },
                {
                  label: 'PIB Canada/US',
                  val: formatSignedPct(macro.gdpGrowthPct, 1),
                  pct: ((macro.gdpGrowthPct + 2) / 6) * 100,
                  color: macro.gdpGrowthPct >= 0 ? 'bg-accent' : 'bg-erreur-texte',
                },
                {
                  label: 'Indice VIX',
                  val: macro.vixLevel.toFixed(1),
                  pct: ((macro.vixLevel - 10) / 30) * 100,
                  color: macro.vixLevel >= 24 ? 'bg-alerte-texte' : 'bg-accent',
                },
              ].map((g) => (
                <div
                  key={g.label}
                  className="px-2.5 py-2 bg-fond border border-bordure rounded-sm space-y-1.5"
                >
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-texte-doux">{g.label}</span>
                    <span className="font-mono tabular-nums font-semibold text-texte">
                      {g.val}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-douce rounded-sm overflow-hidden">
                    {/* NOMBRE-NON-MONETAIRE : jauge macroéconomique publique */}
                    <div
                      style={{ width: `${Math.max(6, Math.min(100, g.pct))}%` }}
                      className={`h-full ${g.color}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Investor Risk & Objective */}
          <div className="lg:col-span-5 space-y-3 lg:border-l lg:border-bordure lg:pl-5">
            <div>
              <span className="block text-xs font-semibold text-texte mb-1.5">
                Budget de risque investisseur
              </span>
              <div
                role="group"
                aria-label="Tolérance au risque"
                className="grid grid-cols-4 gap-1 p-1 bg-fond border border-bordure rounded-md"
              >
                {(
                  [
                    { id: 'prudent', label: 'Prudent' },
                    { id: 'equilibre', label: 'Équilibré' },
                    { id: 'dynamique', label: 'Dynamique' },
                    { id: 'offensif', label: 'Offensif' },
                  ] as const
                ).map((p) => (
                  <button aria-pressed={Boolean(riskProfile === p.id)}
                    key={p.id}
                    type="button"
                    onClick={() => onSelectRiskProfile(p.id)}
                    className={`min-h-11 min-w-11 py-1.5 px-2 text-xs font-medium rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
                      riskProfile === p.id
                        ? 'bg-surface-douce text-texte'
                        : 'text-texte-doux hover:text-texte'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="investor-goal-select"
                className="block text-xs font-semibold text-texte mb-1.5"
              >
                Mandat de gestion
              </label>
              <select
                id="investor-goal-select"
                value={goal}
                onChange={(e) => onSelectGoal(e.target.value as InvestmentGoal)}
                className="min-h-11 w-full px-3 py-2 text-xs bg-fond border border-bordure-champ rounded-md text-texte outline-hidden focus-ring focus:ring-2 focus:ring-accent"
              >
                {(Object.keys(GOAL_LABELS) as InvestmentGoal[]).map((gKey) => (
                  <option key={gKey} value={gKey}>
                    {GOAL_LABELS[gKey].label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {showCustomMacro && (
          <div className="pt-4 border-t border-bordure grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="macro-inflation"
                className="flex justify-between text-xs font-medium text-texte mb-1"
              >
                <span>Inflation IPC</span>
                <span className="font-mono tabular-nums">{formatPct(macro.inflationPct, 1)}</span>
              </label>
              <input
                id="macro-inflation"
                type="range"
                min="0"
                max="8"
                step="0.2"
                value={macro.inflationPct}
                onChange={(e) =>
                  onUpdateMacro({ ...macro, inflationPct: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>

            <div>
              <label
                htmlFor="macro-rate"
                className="flex justify-between text-xs font-medium text-texte mb-1"
              >
                <span>Taux BdC / Fed</span>
                <span className="font-mono tabular-nums">
                  {formatPct(macro.centralBankRatePct, 2)}
                </span>
              </label>
              <input
                id="macro-rate"
                type="range"
                min="0"
                max="6"
                step="0.25"
                value={macro.centralBankRatePct}
                onChange={(e) =>
                  onUpdateMacro({ ...macro, centralBankRatePct: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>

            <div>
              <label
                htmlFor="macro-gdp"
                className="flex justify-between text-xs font-medium text-texte mb-1"
              >
                <span>Croissance PIB</span>
                <span className="font-mono tabular-nums">
                  {formatSignedPct(macro.gdpGrowthPct, 1)}
                </span>
              </label>
              <input
                id="macro-gdp"
                type="range"
                min="-3"
                max="5"
                step="0.2"
                value={macro.gdpGrowthPct}
                onChange={(e) =>
                  onUpdateMacro({ ...macro, gdpGrowthPct: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>

            <div>
              <label
                htmlFor="macro-vix"
                className="flex justify-between text-xs font-medium text-texte mb-1"
              >
                <span>Volatilité VIX</span>
                <span className="font-mono tabular-nums">{macro.vixLevel.toFixed(1)}</span>
              </label>
              <input
                id="macro-vix"
                type="range"
                min="11"
                max="42"
                step="0.5"
                value={macro.vixLevel}
                onChange={(e) =>
                  onUpdateMacro({ ...macro, vixLevel: Number(e.target.value) })
                }
                className="w-full"
              />
            </div>
          </div>
        )}
      </section>

      {/* 3-Column Real Quantitative Diagnostic Strip (Always Active, Zero Click Needed) */}
      <section
        aria-label="Constats d'audit quantitatif"
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {rebalancingPlan.DiagnosticAlerts.map((diag, i) => {
          const glyph =
            diag.severity === 'alerte'
              ? '▼ '
              : diag.severity === 'opportunite'
                ? '◆ '
                : '▲ ';
          const tone =
            diag.severity === 'alerte'
              ? 'text-alerte-texte'
              : diag.severity === 'opportunite'
                ? 'text-succes-texte'
                : 'text-succes-texte';

          return (
            <div
              key={i}
              className="bg-surface border border-bordure rounded-lg p-4 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={`font-mono tabular-nums font-semibold ${tone}`}>
                  {glyph}
                  {diag.metric}
                </span>
                <span className="text-[11px] text-texte-doux">Audit réel</span>
              </div>
              <div className="text-xs font-semibold text-texte">{diag.headline}</div>
              <p className="text-[11px] text-texte-doux leading-snug">{diag.impact}</p>
            </div>
          );
        })}
      </section>

      {appliedBanner && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-succes-texte bg-succes-fond border border-succes-texte/40 rounded-md"
        >
          <Check className="w-4 h-4 text-succes-texte shrink-0" />
          <span>{appliedBanner}</span>
        </div>
      )}

      {/* Gemini AI Signal Cards (Rendered cleanly when triggered or loading) */}
      {(aiLoading || aiError || aiResult) && (
        <section className="bg-surface border border-bordure rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-bordure pb-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-texte">
                Signaux du Comité d’Investissement IA (Gemini)
              </h2>
              {aiResult && (
                <span className="text-xs font-mono text-succes-texte">
                  · {aiResult.strategyHeadline}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleGenerateAI}
              disabled={aiLoading}
              className="min-h-11 text-xs font-medium text-texte hover:text-texte cursor-pointer"
            >
              Actualiser ↻
            </button>
          </div>

          {aiError && (
            <div
              role="alert"
              className="p-3 text-xs text-erreur-texte bg-erreur-fond border border-erreur-texte/40 rounded-md"
            >
              {aiError}
            </div>
          )}

          {aiLoading && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3" aria-busy="true">
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  className="p-3.5 border border-bordure bg-fond rounded-sm space-y-2 animate-pulse"
                >
                  <div className="h-3 bg-surface-douce rounded-sm w-1/2" />
                  <div className="h-5 bg-surface-douce/80 rounded-sm w-2/3" />
                  <div className="h-2.5 bg-surface-douce/60 rounded-sm w-full" />
                </div>
              ))}
            </div>
          )}

          {!aiLoading && aiResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-fond border border-bordure rounded-sm">
                  <span className="text-texte-doux block mb-0.5">Lecture Taux &amp; Macro</span>
                  <span className="text-texte">{aiResult.marketSynthesis}</span>
                </div>
                <div className="p-3 bg-fond border border-bordure rounded-sm">
                  <span className="text-texte-doux block mb-0.5">Bilan Portefeuille</span>
                  <span className="text-texte">{aiResult.portfolioDiagnosis}</span>
                </div>
                <div className="p-3 bg-fond border border-bordure rounded-sm">
                  <span className="text-alerte-texte block mb-0.5">Point de Vigilance VaR</span>
                  <span className="text-texte">{aiResult.keyRiskAlert}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {aiResult.suggestions.map((sug, idx) => {
                  const matchedAsset = getAssetById(sug.assetId);
                  const amount = Math.max(100, Math.round(sug.suggestedAmountEuro || 1000));
                  const isTrim =
                    sug.actionType.toUpperCase().includes('ALL') ||
                    sug.actionType.toUpperCase().includes('VEND');
                  const conviction = Math.min(98, Math.max(50, sug.convictionPct ?? 82));

                  return (
                    <div
                      key={`${sug.assetId}-${idx}`}
                      className="p-3.5 bg-fond border border-bordure rounded-sm flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span
                            className={`font-semibold ${
                              isTrim ? 'text-alerte-texte' : 'text-succes-texte'
                            }`}
                          >
                            {isTrim ? '▼ ' : '▲ '}
                            {sug.actionType}
                          </span>
                          <span className="text-texte-doux">
                            {sug.wrapper || matchedAsset?.wrapper.split(' · ')[0]}
                          </span>
                        </div>

                        <div>
                          <div className="text-xs font-semibold text-texte truncate">
                            {matchedAsset ? matchedAsset.name : sug.assetId}
                          </div>
                          <div className="text-xs font-mono tabular-nums text-succes-texte mt-0.5">
                            Cible {sug.targetWeightPct} % · {formatEur(amount, 0)}
                          </div>
                        </div>

                        {/* Conviction bar */}
                        <div className="space-y-1">
                          <div className="flex justify-between text-[10px] text-texte-doux font-mono">
                            <span>Conviction quant.</span>
                            <span>{conviction} %</span>
                          </div>
                          <div className="h-1 bg-surface-douce rounded-sm overflow-hidden">
                            {/* NOMBRE-NON-MONETAIRE : conviction quantitative d'un titre suggéré */}
                            <div
                              style={{ width: `${conviction}%` }}
                              className="h-full bg-accent"
                            />
                          </div>
                        </div>

                        <p className="text-[11px] text-texte leading-snug">
                          {sug.reasoning}
                        </p>
                      </div>

                      {matchedAsset && (
                        <button
                          type="button"
                          onClick={() => {
                            onExecuteRebalanceOrder(
                              matchedAsset.id,
                              isTrim ? -amount : amount
                            );
                            setAppliedBanner(
                              `Ordre IA exécuté : ${sug.actionType} ${matchedAsset.ticker} (${formatEur(amount, 0)}).`
                            );
                          }}
                          className="min-h-11 w-full py-1.5 px-2.5 text-xs font-medium text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-sm transition-colors cursor-pointer"
                        >
                          Exécuter ({isTrim ? '-' : '+'}
                          {formatEur(amount, 0)})
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Main Split: Left (Visual Rebalancing Plan Actuel vs Cible) | Right (Target Monte Carlo Cone) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-6 bg-surface border border-bordure rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-texte">
                Plan d’Arbitrage Chiffré (Actuel → Cible Optimale)
              </h2>
              <p className="text-xs text-texte-doux">
                Sharpe {rebalancingPlan.currentSharpe.toFixed(2).replace('.', ',')} →{' '}
                <strong className="text-succes-texte font-mono">
                  {rebalancingPlan.projectedSharpe.toFixed(2).replace('.', ',')}
                </strong>{' '}
                · VaR 95 % -{formatEur(rebalancingPlan.currentVar95Eur, 0)} → -
                {formatEur(rebalancingPlan.projectedVar95Eur, 0)}
              </p>
            </div>

            <div className="text-right font-mono tabular-nums shrink-0">
              <div className="text-sm font-semibold text-succes-texte">
                {formatPct(optimalPortfolio.expectedAnnualReturnPct, 1)}/an
              </div>
              <div className="text-[11px] text-texte-doux">
                σ {formatPct(optimalPortfolio.expectedVolatilityPct, 1)}
              </div>
            </div>
          </div>

          {/* Target Class Bar */}
          <div className="space-y-1.5">
            <div className="h-2.5 w-full rounded-sm overflow-hidden flex bg-fond">
              {(['actions', 'obligations', 'crypto', 'refuge'] as AssetCategory[]).map(
                (cat) => (
                  <div
                    key={cat}
                    style={{ width: isPrivacyMode ? '25%' : `${optimalPortfolio.categoryTotals[cat]}%` }}
                    className={CAT_COLOR[cat]}
                  />
                )
              )}
            </div>
            <PrivateAmount className="flex justify-between text-[11px] text-texte-doux font-mono tabular-nums">
              <span>Actions {optimalPortfolio.categoryTotals.actions}%</span>
              <span>Oblig. {optimalPortfolio.categoryTotals.obligations}%</span>
              <span>Crypto {optimalPortfolio.categoryTotals.crypto}%</span>
              <span>Refuge {optimalPortfolio.categoryTotals.refuge}%</span>
            </PrivateAmount>
          </div>

          {/* Line-by-Line Visual Delta Bars & 1-Click Orders */}
          <div className="divide-y divide-bordure border-t border-b border-bordure max-h-[340px] overflow-y-auto pr-1">
            {rebalancingPlan.orders.map((ord) => {
              const isBuy = ord.deltaEuro > 0;
              const isNeutral = ord.action === 'CONSERVER' || Math.abs(ord.deltaEuro) < 100;

              return (
                <div key={ord.assetId} className="py-2.5 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate">
                      <span className="font-semibold text-texte">{ord.ticker}</span>
                      <span className="text-texte-doux"> · {ord.name}</span>
                      <span className="text-texte-doux"> · {ord.wrapper}</span>
                    </div>

                    {isNeutral ? (
                      <PrivateAmount className="font-mono text-[11px] text-texte-doux shrink-0">
                        ◆ Cible {ord.targetWeightPct.toFixed(0)} %
                      </PrivateAmount>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onExecuteRebalanceOrder(ord.assetId, ord.deltaEuro);
                          setAppliedBanner(
                            `Ordre exécuté : ${ord.action} ${ord.ticker} (${formatSignedEur(ord.deltaEuro, 0)}).`
                          );
                        }}
                        className={`min-h-11 min-w-11 px-2 py-0.5 text-[11px] font-mono tabular-nums font-semibold rounded-sm border shrink-0 cursor-pointer transition-colors ${
                          isBuy
                            ? 'text-succes-texte bg-succes-fond border-succes-texte/40 hover:bg-succes-fond'
                            : 'text-alerte-texte bg-alerte-fond border-alerte-texte/40 hover:bg-alerte-fond'
                        }`}
                      >
                        {ord.action} {formatSignedEur(ord.deltaEuro, 0)}
                      </button>
                    )}
                  </div>

                  {/* Dual Visual Weight Bar: Current (slate) vs Target (teal) */}
                  <div className="grid grid-cols-12 items-center gap-2 text-[10px] font-mono tabular-nums text-texte-doux">
                    <PrivateAmount className="col-span-3 whitespace-nowrap">
                      Act. {ord.currentWeightPct.toFixed(0)}% <ArrowRight className="inline w-2.5 h-2.5" />{' '}
                      <strong className="text-texte">{ord.targetWeightPct.toFixed(0)}%</strong>
                    </PrivateAmount>
                    <div className="col-span-4 h-2 bg-fond rounded-sm overflow-hidden relative">
                      <div
                        style={{ width: isPrivacyMode ? '0%' : `${Math.min(100, ord.currentWeightPct)}%` }}
                        className="h-1 bg-bordure-champ"
                      />
                      <div
                        style={{ width: isPrivacyMode ? '0%' : `${Math.min(100, ord.targetWeightPct)}%` }}
                        className="h-1 bg-accent"
                      />
                    </div>
                    <span className="col-span-5 text-right truncate">{ord.conciseSignal}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              const budget = Math.max(
                10000,
                Math.round(portfolioSummary.totalCurrentValue || 10000)
              );
              onApplyRecommendedAllocation(
                budget,
                optimalPortfolio.slices.map((s) => ({
                  assetId: s.assetId,
                  weightPct: s.weightPct,
                }))
              );
              setAppliedBanner(
                `Portefeuille intégralement rééquilibré sur l’allocation optimale (${formatEur(budget, 0)}).`
              );
            }}
            className="min-h-11 w-full py-2.5 px-4 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-md transition-colors cursor-pointer"
          >
            Aligner tout le portefeuille sur la cible (100 %)
          </button>
        </section>

        {/* Right: Target Allocation Cone */}
        <section className="lg:col-span-6 bg-surface border border-bordure rounded-lg p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-texte">
                {/* NOMBRE-NON-MONETAIRE : horizon temporel du curseur */}
                Trajectoire Patrimoniale Cible ({horizonYears} ans)
              </h2>
              <p className="text-xs text-texte-doux">
                Quantiles analytiques P10 / P50 / P90 · Max Drawdown estimé{' '}
                {formatPct(optimalPortfolio.estimatedMaxDrawdownPct, 1)}
              </p>
            </div>
            <div className="text-right font-mono tabular-nums shrink-0">
              <div className="text-[11px] text-texte-doux">Médiane {finalYear.calendarYear}</div>
              <div className="text-base font-semibold text-succes-texte">
                <PrivateAmount>{formatEur(finalYear.p50, 0)}</PrivateAmount>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="mc-horizon"
                className="flex justify-between text-xs font-medium text-texte mb-1"
              >
                <span>Horizon</span>
                {/* NOMBRE-NON-MONETAIRE : valeur du curseur d'horizon */}
                <span className="font-mono tabular-nums">{horizonYears} ans</span>
              </label>
              <input
                id="mc-horizon"
                type="range"
                min="3"
                max="25"
                step="1"
                value={horizonYears}
                onChange={(e) => setHorizonYears(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label
                htmlFor="mc-monthly"
                className="flex justify-between text-xs font-medium text-texte mb-1"
              >
                <span>DCA mensuel</span>
                <span className="font-mono tabular-nums">{formatEur(monthlyBudget, 0)}/mois</span>
              </label>
              <input
                id="mc-monthly"
                type="range"
                min="0"
                max="2000"
                step="50"
                value={monthlyBudget}
                onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          <div className="w-full overflow-x-auto">
            <svg
              viewBox={`0 0 ${mcW} ${mcH}`}
              className="w-full h-auto"
              role="img"
              aria-label="Cône de projection prédictive Monte Carlo"
            >
              {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                const v = maxMc * r;
                const y = yMc(v);
                return (
                  <g key={r}>
                    <line
                      x1={pL}
                      y1={y}
                      x2={mcW - pR}
                      y2={y}
                      stroke={VALORIA_PALETTE.gridSlate}
                      strokeDasharray={r === 0 ? undefined : '3 3'}
                    />
                    <text
                      x={pL - 8}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-texte-doux text-[10px] font-mono"
                    >
                      {formatCompactEur(v)}
                    </text>
                  </g>
                );
              })}

              <path d={bandOuter} fill={VALORIA_PALETTE.teal} fillOpacity="0.14" />
              <path
                d={lineOf('p90')}
                fill="none"
                stroke={VALORIA_PALETTE.tealLight}
                strokeWidth="1.2"
                strokeDasharray="3 3"
              />
              <path
                d={lineOf('p10')}
                fill="none"
                stroke={VALORIA_PALETTE.redLight}
                strokeWidth="1.3"
                strokeDasharray="3 3"
              />
              <path
                d={lineOf('totalInvested')}
                fill="none"
                stroke={VALORIA_PALETTE.textSlate}
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
              <path d={lineOf('p50')} fill="none" stroke={VALORIA_PALETTE.teal} strokeWidth="2.5" />

              {projection
                .filter(
                  (_, i) =>
                    i === 0 ||
                    i === projection.length - 1 ||
                    i % Math.max(1, Math.floor(projection.length / 5)) === 0
                )
                .map((pt) => (
                  <text
                    key={pt.year}
                    x={xMc(pt.year)}
                    y={mcH - 6}
                    textAnchor="middle"
                    className="fill-texte-doux text-[10px] font-mono"
                  >
                    {pt.calendarYear}
                  </text>
                ))}
            </svg>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-bordure text-xs font-mono tabular-nums">
            <div>
              <div className="font-sans text-[11px] text-texte-doux">Décile P10 (stress)</div>
              <div className="font-semibold text-texte">{formatEur(finalYear.p10, 0)}</div>
            </div>
            <div>
              <div className="font-sans text-[11px] text-texte-doux">Capital cumulé versé</div>
              <div className="font-semibold text-texte">
                {formatEur(finalYear.totalInvested, 0)}
              </div>
            </div>
            <div className="text-right">
              <div className="font-sans text-[11px] text-texte-doux">Décile P90 (porteur)</div>
              <div className="font-semibold text-succes-texte">
                {formatEur(finalYear.p90, 0)}
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Institutional Multi-Factor Asset Screener */}
      <section className="bg-surface border border-bordure rounded-lg overflow-hidden">
        <div className="p-4 border-b border-bordure flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-texte">
              Screener Quantitatif Multi-Facteurs
            </h2>
            <p className="text-xs text-texte-doux">
              Valorisation fondamentale · RSI-14 &amp; Momentum 12M · Ratio de Sharpe · Pertinence régime
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-texte-doux absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Rechercher un placement"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrer ticker, ETF..."
                className="min-h-11 pl-8 pr-3 py-1.5 text-xs bg-fond border border-bordure-champ rounded-md text-texte placeholder:text-texte-doux outline-hidden focus-ring focus:ring-2 focus:ring-accent"
              />
            </div>

            <div className="flex items-center gap-0.5 p-1 bg-fond border border-bordure rounded-md overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'Tous' },
                  { id: 'actions', label: 'Actions' },
                  { id: 'obligations', label: 'Oblig.' },
                  { id: 'crypto', label: 'Crypto' },
                  { id: 'refuge', label: 'Refuge' },
                ] as const
              ).map((c) => (
                <button aria-pressed={Boolean(screenerCategory === c.id)}
                  key={c.id}
                  type="button"
                  onClick={() => setScreenerCategory(c.id)}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    screenerCategory === c.id
                      ? 'bg-surface-douce text-texte'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-bordure bg-fond/60 text-[11px] font-semibold text-texte-doux">
                <th className="py-2.5 px-4">Instrument &amp; Valorisation</th>
                <th className="py-2.5 px-2">24 Mois</th>
                <th className="py-2.5 px-3">Signal</th>
                <th className="py-2.5 px-3">Facteurs (Macro · Mom · Sharpe)</th>
                <th className="py-2.5 px-3 text-right">RSI / Mom 12M</th>
                <th className="py-2.5 px-3 text-right">Esp. / Vol.</th>
                <th className="py-2.5 px-4 text-right">Exécution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bordure text-sm">
              {filteredScreener.map((item) => {
                const tech = technicals[item.asset.id];
                return (
                  <tr key={item.asset.id} className="hover:bg-surface-douce/40 transition-colors">
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-texte text-xs sm:text-sm">
                        {item.asset.name}
                      </div>
                      <div className="text-[11px] text-texte-doux font-mono">
                        <span className="text-texte">{item.asset.ticker}</span>
                        {' · '}
                        <span>{item.asset.wrapper.split(' · ')[0]}</span>
                        {' · '}
                        <span className="text-succes-texte">
                          {tech?.valuationMetricLabel} {tech?.valuationMetricValue}
                        </span>
                      </div>
                    </td>

                    <td className="py-2.5 px-2">
                      <MiniSparkline
                        values={tech?.sparkline24m ?? []}
                        width={76}
                        height={24}
                      />
                    </td>

                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div
                        className={`text-xs font-semibold ${
                          item.stance === 'favorable'
                            ? 'text-succes-texte'
                            : item.stance === 'prudent'
                              ? 'text-erreur-texte'
                              : 'text-alerte-texte'
                        }`}
                      >
                        {item.stanceLabel}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-texte-doux">
                        {/* NOMBRE-NON-MONETAIRE : score quantitatif et Sharpe d'actif public */}
                        Score {item.predictiveScore}/100 · Sh{' '}
                        {item.sharpeRatio.toFixed(2).replace('.', ',')}
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="w-36 space-y-1">
                        {[
                          { k: 'Macro', v: tech?.factorScores.macroFit ?? 50, c: 'bg-accent' },
                          { k: 'Mom.', v: tech?.factorScores.momentum ?? 50, c: 'bg-accent' },
                          {
                            k: 'Sharpe',
                            v: tech?.factorScores.riskEfficiency ?? 50,
                            c: 'bg-accent',
                          },
                        ].map((f) => (
                          <div
                            key={f.k}
                            className="flex items-center gap-1.5 text-[10px] font-mono text-texte-doux"
                          >
                            <span className="w-11 shrink-0">{f.k}</span>
                            <div className="flex-1 h-1.5 bg-fond rounded-sm overflow-hidden">
                              {/* NOMBRE-NON-MONETAIRE : sous-score factoriel d'actif public */}
                              <div
                                style={{ width: `${f.v}%` }}
                                className={`h-full ${f.c}`}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs whitespace-nowrap">
                      <div
                        className={
                          (tech?.rsi14 ?? 50) >= 72
                            ? 'text-alerte-texte'
                            : (tech?.rsi14 ?? 50) <= 32
                              ? 'text-succes-texte'
                              : 'text-texte'
                        }
                      >
                        RSI {tech?.rsi14 ?? 50}
                      </div>
                      <div
                        className={`text-[11px] ${
                          (tech?.momentum12mPct ?? 0) >= 0
                            ? 'text-succes-texte'
                            : 'text-erreur-texte'
                        }`}
                      >
                        {formatSignedPct(tech?.momentum12mPct ?? 0, 1)}
                      </div>
                    </td>

                    <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-xs font-semibold text-texte">
                        {formatSignedPct(item.expectedAnnualReturnPct, 1)}/an
                      </div>
                      <div className="text-[11px] text-texte-doux">
                        σ {formatPct(item.expectedVolatilityPct, 1)}
                      </div>
                    </td>

                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onOpenBacktestForAsset(item.asset.id, '2020-01', 2000)
                          }
                          aria-label={`Tester l'historique de ${item.asset.name}`}
                          className="min-h-11 min-w-11 p-1.5 text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-sm transition-colors cursor-pointer"
                          title="Backtest historique"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onAddLot({
                              assetId: item.asset.id,
                              investedAmount: 1500,
                              purchaseYearMonth: '2026-11',
                            });
                            setAppliedBanner(
                              `${item.asset.ticker} (+1 500 $ CAD) ajouté au portefeuille.`
                            );
                          }}
                          className="min-h-11 min-w-11 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-sm transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Acheter</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
