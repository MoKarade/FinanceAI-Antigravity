import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Trash2,
  History,
  RotateCcw,
  Pause,
  Play,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  ASSETS,
  AssetCategory,
  HISTORICAL_SERIES,
  InvestmentGoal,
  MacroIndicators,
  RiskProfile,
  getAssetById,
  getPriceAtYearMonth,
} from '../../services/valoria/marketData';
import {
  PortfolioLot,
  PortfolioSummary,
  computeOptimalAllocation,
  scoreAssetsForMacro,
} from '../../services/valoria/engine';
import {
  buildRebalancingPlan,
  computeAssetTechnicals,
  computePortfolioRiskMetrics,
} from '../../services/valoria/quantAnalytics';
import {
  formatEur,
  formatPct,
  formatPriceEur,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { D3BenchmarkChart } from './D3BenchmarkChart';
import { D3MonteCarloModule } from './D3MonteCarloModule';
import { D3PortfolioRiskDiagnostic } from './D3PortfolioRiskDiagnostic';
import { MiniSparkline } from './MiniSparkline';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';

interface PortfolioSimulatorViewProps {
  lots: PortfolioLot[];
  summary: PortfolioSummary;
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
  goal: InvestmentGoal;
  isLiveStreaming: boolean;
  onToggleLiveStream: () => void;
  onStepMarketTick: () => void;
  onAddLot: (lot: Omit<PortfolioLot, 'id'>) => void;
  onRemoveLot: (lotId: string) => void;
  onExecuteRebalanceOrder: (assetId: string, deltaEuro: number) => void;
  onResetDemoLots: () => void;
  onOpenBacktestForAsset: (assetId: string, purchaseYearMonth: string, amount: number) => void;
  onNavigateToAI: () => void;
}

const QUICK_DATES = [
  { ym: '2018-01', label: 'Janv. 18' },
  { ym: '2020-03', label: 'COVID 20' },
  { ym: '2021-11', label: 'Pic 21' },
  { ym: '2023-01', label: 'Janv. 23' },
  { ym: '2026-11', label: 'Spot' },
];

const CAT_BG_CLASS: Record<AssetCategory, string> = {
  actions: 'bg-accent',
  obligations: 'bg-accent',
  crypto: 'bg-accent',
  refuge: 'bg-alerte-texte',
};

export const PortfolioSimulatorView: React.FC<PortfolioSimulatorViewProps> = ({
  lots,
  summary,
  livePrices,
  macro,
  riskProfile,
  goal,
  isLiveStreaming,
  onToggleLiveStream,
  onStepMarketTick,
  onAddLot,
  onRemoveLot,
  onExecuteRebalanceOrder,
  onResetDemoLots,
  onOpenBacktestForAsset,
  onNavigateToAI,
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('ETH');
  const [amountInput, setAmountInput] = useState<string>('1500');
  const [purchaseYm, setPurchaseYm] = useState<string>('2023-01');
  const [formError, setFormError] = useState<string | null>(null);
  const [addedFeedback, setAddedFeedback] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<'all' | AssetCategory>('all');

  const riskMetrics = useMemo(
    () => computePortfolioRiskMetrics(lots, livePrices, macro.centralBankRatePct),
    [lots, livePrices, macro.centralBankRatePct]
  );

  const scoredAssets = useMemo(
    () => scoreAssetsForMacro(macro, riskProfile, goal),
    [macro, riskProfile, goal]
  );

  const optimalPortfolio = useMemo(
    () => computeOptimalAllocation(scoredAssets, riskProfile, goal),
    [scoredAssets, riskProfile, goal]
  );

  const technicals = useMemo(
    () => computeAssetTechnicals(livePrices, scoredAssets, macro),
    [livePrices, scoredAssets, macro]
  );

  const rebalancingPlan = useMemo(
    () =>
      buildRebalancingPlan({
        portfolioSummary: summary,
        riskMetrics,
        optimalPortfolio,
        scoredAssets,
        riskProfile,
        goal,
      }),
    [summary, riskMetrics, optimalPortfolio, scoredAssets, riskProfile, goal]
  );

  const actionableOrders = useMemo(
    () =>
      rebalancingPlan.orders
        .filter((o) => o.action !== 'CONSERVER' && Math.abs(o.deltaEuro) >= 200)
        .slice(0, 3),
    [rebalancingPlan.orders]
  );

  const riskByCategory = useMemo(() => {
    const out: Record<AssetCategory, number> = {
      actions: 0,
      obligations: 0,
      crypto: 0,
      refuge: 0,
    };
    for (const rc of riskMetrics.riskContributions) {
      out[rc.category] += rc.riskContributionPct;
    }
    return out;
  }, [riskMetrics.riskContributions]);

  const selectedAsset = useMemo(
    () => getAssetById(selectedAssetId) ?? ASSETS[0],
    [selectedAssetId]
  );
  const selectedTech = technicals[selectedAsset.id];

  const previewEntryPrice = useMemo(
    () => getPriceAtYearMonth(selectedAsset.id, purchaseYm),
    [selectedAsset.id, purchaseYm]
  );
  const previewCurrentPrice = livePrices[selectedAsset.id] ?? previewEntryPrice;
  const previewGainPct =
    previewEntryPrice > 0
      ? ((previewCurrentPrice - previewEntryPrice) / previewEntryPrice) * 100
      : 0;

  const filteredLots = useMemo(() => {
    if (categoryFilter === 'all') return summary.lots;
    return summary.lots.filter((item) => item.asset.category === categoryFilter);
  }, [summary.lots, categoryFilter]);

  const heldAssetIds = useMemo(
    () => Array.from(new Set(summary.lots.map((l) => l.asset.id))),
    [summary.lots]
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amountInput.replace(',', '.'));
    if (!amountInput.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      setFormError('Montant requis (> 0 $ CAD).');
      setAddedFeedback(null);
      return;
    }
    if (parsed > 10_000_000) {
      setFormError('Plafond par ordre : 10 000 000 $ CAD.');
      setAddedFeedback(null);
      return;
    }

    setFormError(null);
    onAddLot({
      assetId: selectedAssetId,
      investedAmount: Number(parsed.toFixed(2)),
      purchaseYearMonth: purchaseYm,
    });
    setAddedFeedback(`${selectedAsset.ticker} (+${formatEur(parsed, 0)}) exécuté.`);
  };

  const isPositiveTotal = summary.totalGainLossEuro >= 0;

  return (
    <div className="space-y-6">
      {/* Compact Institutional Toolbar Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-4 border-b border-bordure">
        <div>
          <p className="text-xs font-medium text-texte-doux mb-0.5">
            Valorisation temps réel en $ CAD · Métriques Sharpe / VaR 95 % · Frontière de Markowitz · Monte Carlo 10k
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-texte">
            Poste de Gestion &amp; Risque Portefeuille ($ CAD)
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleLiveStream}
            className="min-h-11 min-w-11 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-texte bg-surface border border-bordure-champ rounded-md hover:bg-surface-douce transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isLiveStreaming ? (
              <>
                <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                <Pause className="w-3.5 h-3.5 text-texte-doux" />
                <span>Cotation live</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 text-texte-doux" />
                <span>Reprendre flux</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onStepMarketTick}
            className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-surface border border-bordure-champ rounded-md hover:bg-surface-douce transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Tick marché</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToAI}
            className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent rounded-md hover:bg-accent-fonce transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Arbitrages &amp; IA</span>
          </button>
        </div>
      </div>

      {/* 5-Column Institutional Quantitative KPI Strip */}
      <section
        aria-label="Indicateurs quantitatifs du portefeuille"
        className="bg-surface border border-bordure rounded-lg grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 sm:divide-x divide-bordure"
      >
        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">Actif net ($ CAD)</div>
          <div
            data-testid="portfolio-total-value"
            className="text-xl font-semibold font-mono tabular-nums text-texte"
          >
            {formatEur(summary.totalCurrentValue, 2)}
          </div>
          <div
            data-testid="portfolio-total-invested"
            className="text-[11px] text-texte-doux font-mono tabular-nums mt-1"
          >
            Investi {formatEur(summary.totalInvested, 0)} · {summary.lots.length} lignes
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">P&amp;L latent &amp; Alpha Jensen</div>
          <div
            className={`text-xl font-semibold font-mono tabular-nums flex items-center gap-1 ${
              isPositiveTotal ? 'text-succes-texte' : 'text-erreur-texte'
            }`}
          >
            {isPositiveTotal ? (
              <ArrowUpRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span>{formatSignedEur(summary.totalGainLossEuro, 0)}</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-texte mt-1">
            <span className={isPositiveTotal ? 'text-succes-texte' : 'text-erreur-texte'}>
              {isPositiveTotal ? '▲ ' : '▼ '}
              {formatSignedPct(summary.totalGainLossPct, 1)}
            </span>
            {' · '}α {formatSignedPct(riskMetrics.jensenAlphaPct, 2)}/an
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">Efficience (Sharpe / Sortino)</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-succes-texte">
            {riskMetrics.sharpeRatio.toFixed(2).replace('.', ',')}
            <span className="text-xs font-normal text-texte-doux">
              {' '}
              / {riskMetrics.sortinoRatio.toFixed(2).replace('.', ',')}
            </span>
          </div>
          <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-1">
            Esp. {formatPct(riskMetrics.annualizedReturnPct, 1)}/an · Cible{' '}
            {optimalPortfolio.sharpeRatio.toFixed(2).replace('.', ',')}
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">VaR 95 % &amp; CVaR (1 mois)</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-erreur-texte">
            -{formatEur(riskMetrics.var95MonthlyEur, 0)}
          </div>
          <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-1">
            -{formatPct(riskMetrics.var95MonthlyPct, 1)} · CVaR -{formatEur(riskMetrics.cvar95MonthlyEur, 0)}
          </div>
        </div>

        <div className="p-4 col-span-2 lg:col-span-1">
          <div className="text-[11px] text-texte-doux mb-1">Bêta MSCI World &amp; Volatilité</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-texte">
            β {riskMetrics.betaVsWorld.toFixed(2).replace('.', ',')}
            <span className="text-xs font-normal text-texte-doux">
              {' '}
              · σ {formatPct(riskMetrics.annualizedVolatilityPct, 1)}
            </span>
          </div>
          <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-1">
            Max DD {formatPct(riskMetrics.maxDrawdownHistoricalPct, 1)} · HHI {riskMetrics.concentrationHhi}
          </div>
        </div>
      </section>

      {/* Visual Capital Allocation vs Euler Risk Budget + 1-Click Rebalancing Strip */}
      {summary.lots.length > 0 && (
        <section
          aria-label="Décomposition visuelle du capital et du risque"
          className="bg-surface border border-bordure rounded-lg p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center"
        >
          {/* Dual Stacked Bar: Capital vs Risk Contribution */}
          <div className="lg:col-span-7 space-y-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="font-sans font-medium text-texte">
                  Allocation en capital
                </span>
                <span className="text-texte-doux">
                  Actions {formatPct(summary.categoryWeightsPct.actions, 0)} · Oblig.{' '}
                  {formatPct(summary.categoryWeightsPct.obligations, 0)} · Crypto{' '}
                  {formatPct(summary.categoryWeightsPct.crypto, 0)} · Refuge{' '}
                  {formatPct(summary.categoryWeightsPct.refuge, 0)}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-sm bg-fond overflow-hidden flex">
                {(['actions', 'obligations', 'crypto', 'refuge'] as AssetCategory[]).map(
                  (cat) => (
                    <div
                      key={`cap-${cat}`}
                      style={{ width: isPrivacyMode ? '25%' : `${summary.categoryWeightsPct[cat]}%` }}
                      className={CAT_BG_CLASS[cat]}
                    />
                  )
                )}
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                <span className="font-sans font-medium text-texte">
                  Contribution réelle au risque (Euler σ)
                </span>
                <span className="text-texte-doux">
                  Actions {formatPct(riskByCategory.actions, 0)} · Oblig.{' '}
                  {formatPct(riskByCategory.obligations, 0)} ·{' '}
                  <span
                    className={
                      riskByCategory.crypto >= 45 ? 'text-alerte-texte font-semibold' : ''
                    }
                  >
                    Crypto {formatPct(riskByCategory.crypto, 0)}
                  </span>{' '}
                  · Refuge {formatPct(riskByCategory.refuge, 0)}
                </span>
              </div>
              <div className="h-2.5 w-full rounded-sm bg-fond overflow-hidden flex">
                {(['actions', 'obligations', 'crypto', 'refuge'] as AssetCategory[]).map(
                  (cat) => (
                    <div
                      key={`risk-${cat}`}
                      style={{ width: isPrivacyMode ? '25%' : `${riskByCategory[cat]}%` }}
                      className={CAT_BG_CLASS[cat]}
                    />
                  )
                )}
              </div>
            </div>
          </div>

          {/* Instant Quantitative Counsel / Quick Rebalance Orders */}
          <div className="lg:col-span-5 lg:border-l lg:border-bordure lg:pl-5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-texte">
                Conseils d’arbitrage immédiats (profil {riskProfile})
              </span>
              <button
                type="button"
                onClick={onNavigateToAI}
                className="min-h-11 text-succes-texte hover:text-succes-texte font-medium cursor-pointer whitespace-nowrap"
              >
                Plan complet →
              </button>
            </div>

            {actionableOrders.length > 0 ? (
              <div className="space-y-1.5">
                {actionableOrders.map((ord) => {
                  const isBuy = ord.deltaEuro > 0;
                  return (
                    <div
                      key={ord.assetId}
                      className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-fond border border-bordure rounded-sm text-xs"
                    >
                      <div className="min-w-0 truncate">
                        <span
                          className={`font-mono font-semibold ${
                            isBuy ? 'text-succes-texte' : 'text-alerte-texte'
                          }`}
                        >
                          {ord.action}
                        </span>{' '}
                        <span className="text-texte font-medium">{ord.ticker}</span>
                        <PrivateAmount className="text-texte-doux font-mono">
                          {' '}
                          ({ord.currentWeightPct.toFixed(0)}%→{ord.targetWeightPct.toFixed(0)}%)
                        </PrivateAmount>
                      </div>
                      <button
                        type="button"
                        onClick={() => onExecuteRebalanceOrder(ord.assetId, ord.deltaEuro)}
                        className="min-h-11 min-w-11 px-2 py-0.5 text-[11px] font-mono tabular-nums font-medium text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-sm shrink-0 cursor-pointer"
                      >
                        {formatSignedEur(ord.deltaEuro, 0)}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-succes-texte font-mono py-2">
                ▲ Allocation alignée sur la frontière efficiente (Sharpe{' '}
                {riskMetrics.sharpeRatio.toFixed(2).replace('.', ',')}).
              </div>
            )}
          </div>
        </section>
      )}

      {/* Main 2-Column Workspace: Left (D3 Benchmark + High-Density Sparkline Holdings) | Right (Order Ticket) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-6">
          <D3BenchmarkChart lots={lots} livePrices={livePrices} />

          {/* High-Density Holdings Grid with 12M Sparklines & Weight Bars */}
          <section className="bg-surface border border-bordure rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-bordure flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-base font-semibold text-texte">
                  Positions en portefeuille
                </h2>
                <span className="text-xs font-mono tabular-nums text-texte-doux">
                  {filteredLots.length} ligne{filteredLots.length > 1 ? 's' : ''}
                </span>
              </div>

              <div
                role="group"
                aria-label="Filtrer par classe d'actifs"
                className="flex items-center gap-0.5 p-1 bg-fond border border-bordure rounded-md overflow-x-auto shrink-0"
              >
                {(
                  [
                    { id: 'all', label: 'Tous' },
                    { id: 'actions', label: 'Actions' },
                    { id: 'obligations', label: 'Oblig.' },
                    { id: 'crypto', label: 'Crypto' },
                    { id: 'refuge', label: 'Refuge' },
                  ] as const
                ).map((tab) => (
                  <button aria-pressed={Boolean(categoryFilter === tab.id)}
                    key={tab.id}
                    type="button"
                    onClick={() => setCategoryFilter(tab.id)}
                    className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      categoryFilter === tab.id
                        ? 'bg-surface-douce text-texte'
                        : 'text-texte-doux hover:text-texte'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredLots.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-bordure bg-fond/60 text-[11px] font-semibold text-texte-doux">
                      <th className="py-2.5 px-4">Instrument &amp; Poids</th>
                      <th className="py-2.5 px-2">Tendance 12M</th>
                      <th className="py-2.5 px-3 text-right">Entrée → Spot</th>
                      <th className="py-2.5 px-3 text-right">Valorisation</th>
                      <th className="py-2.5 px-3 text-right">P&amp;L Latent</th>
                      <th className="py-2.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bordure text-sm">
                    {filteredLots.map((item) => {
                      const pos = item.gainLossEuro >= 0;
                      const tech = technicals[item.asset.id];
                      const rcItem = riskMetrics.riskContributions.find(
                        (r) => r.assetId === item.asset.id
                      );
                      return (
                        <tr
                          key={item.lot.id}
                          className="hover:bg-surface-douce/40 transition-colors"
                        >
                          <td className="py-2.5 px-4">
                            <div className="font-medium text-texte text-xs sm:text-sm">
                              {item.asset.name}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-texte-doux mt-0.5">
                              <span className="font-mono text-texte">{item.asset.ticker}</span>
                              <span aria-hidden="true">·</span>
                              <span className="whitespace-nowrap">{item.purchaseLabel}</span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums whitespace-nowrap">
                                Cap {item.weightPct.toFixed(1).replace('.', ',')}{'\u00A0'}% / Risque{' '}
                                {(rcItem?.riskContributionPct ?? item.weightPct).toFixed(0)}
                                {'\u00A0'}%
                              </span>
                            </div>
                            <div className="w-28 h-1 bg-fond rounded-sm overflow-hidden mt-1">
                              <div
                                style={{ width: isPrivacyMode ? '0%' : `${Math.min(100, item.weightPct)}%` }}
                                className={`h-full ${CAT_BG_CLASS[item.asset.category]}`}
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-2 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-0.5">
                              <MiniSparkline
                                values={
                                  item.lot.dailyHistoryCad &&
                                  item.lot.dailyHistoryCad.length >= 4
                                    ? item.lot.dailyHistoryCad.map((p) => p[1])
                                    : (tech?.sparkline12m ?? [])
                                }
                                width={78}
                                height={24}
                              />
                              <span className="text-[10px] font-mono tabular-nums text-texte-doux whitespace-nowrap">
                                {item.periodReturnPct !== undefined
                                  ? `Période ${formatSignedPct(item.periodReturnPct, 1)}`
                                  : `RSI ${tech?.rsi14 ?? 50} · 12M ${formatSignedPct(tech?.momentum12mPct ?? 0, 0)}`}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs text-texte-doux whitespace-nowrap">
                            <div>
                              {item.lot.quantity
                                ? `${Number(item.lot.quantity.toFixed(2))} × ${formatPriceEur(item.entryPrice)}`
                                : formatPriceEur(item.entryPrice)}
                            </div>
                            <div className="text-texte font-medium">
                              → {formatPriceEur(item.currentPrice)}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-texte text-xs sm:text-sm">
                              {formatEur(item.currentValue, 0)}
                            </div>
                            <div className="text-[11px] text-texte-doux">
                              coût {formatEur(item.lot.investedAmount, 0)}
                            </div>
                          </td>
                          <td
                            className={`py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                              pos ? 'text-succes-texte' : 'text-erreur-texte'
                            }`}
                          >
                            <div className="font-medium text-xs sm:text-sm">
                              {formatSignedEur(item.gainLossEuro, 0)}
                            </div>
                            <div className="text-[11px]">
                              {pos ? '▲ ' : '▼ '}
                              {formatSignedPct(item.gainLossPct, 1)}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenBacktestForAsset(
                                    item.asset.id,
                                    item.lot.purchaseYearMonth === '2026-11'
                                      ? '2020-01'
                                      : item.lot.purchaseYearMonth,
                                    item.lot.investedAmount
                                  )
                                }
                                title="Backtest historique"
                                aria-label={`Analyser l'historique de ${item.asset.name}`}
                                className="min-h-11 min-w-11 p-1.5 text-texte-doux hover:text-succes-texte hover:bg-surface-douce rounded-sm transition-colors cursor-pointer"
                              >
                                <History className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onRemoveLot(item.lot.id)}
                                aria-label={`Supprimer ${item.asset.name} (${item.purchaseLabel})`}
                                className="min-h-11 min-w-11 p-1.5 text-texte-doux hover:text-erreur-texte hover:bg-erreur-fond rounded-sm transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm font-medium text-texte">
                  Aucune position active sur ce filtre.
                </p>
                {summary.lots.length === 0 && (
                  <button
                    type="button"
                    onClick={onResetDemoLots}
                    className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-md transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Restaurer portefeuille type</span>
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Right Column: Compact Institutional Order Ticket + Fundamental/Technical Snapshot */}
        <aside className="lg:col-span-4 bg-surface border border-bordure rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-bordure pb-3">
            <h2 className="text-base font-semibold text-texte">
              Ticket d’ordre virtuel
            </h2>
            <span className="text-[11px] font-mono text-texte-doux">
              {selectedAsset.wrapper.split(' · ')[0]}
            </span>
          </div>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label
                htmlFor="portfolio-asset-select"
                className="block text-xs font-medium text-texte mb-1"
              >
                Instrument coté
              </label>
              <select
                id="portfolio-asset-select"
                value={selectedAssetId}
                onChange={(e) => {
                  setSelectedAssetId(e.target.value);
                  setAddedFeedback(null);
                }}
                className="min-h-11 w-full px-3 py-2 text-xs sm:text-sm bg-fond border border-bordure-champ rounded-md text-texte outline-hidden focus-ring focus:ring-2 focus:ring-accent"
              >
                <optgroup label="Actions (ETF & Titres vifs)">
                  {ASSETS.filter((a) => a.category === 'actions').map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.ticker})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Obligations (Souveraines & IG)">
                  {ASSETS.filter((a) => a.category === 'obligations').map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.ticker})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Cryptomonnaies">
                  {ASSETS.filter((a) => a.category === 'crypto').map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.ticker})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Valeurs refuges & Monétaire">
                  {ASSETS.filter((a) => a.category === 'refuge').map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.ticker})
                    </option>
                  ))}
                </optgroup>
              </select>

              {/* Visual Quantitative Snapshot of Selected Asset */}
              {selectedTech && (
                <div className="mt-2.5 p-2.5 bg-fond border border-bordure rounded-sm grid grid-cols-3 gap-2 items-center text-[11px] font-mono tabular-nums">
                  <div>
                    <div className="font-sans text-texte-doux">
                      {selectedTech.valuationMetricLabel}
                    </div>
                    <div className="text-texte font-semibold">
                      {selectedTech.valuationMetricValue}
                    </div>
                  </div>
                  <div>
                    <div className="font-sans text-texte-doux">RSI 14 / ATH</div>
                    <div className="text-texte font-semibold">
                      {selectedTech.rsi14} · {formatPct(selectedTech.drawdownFromAthPct, 0)}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <MiniSparkline
                      values={selectedTech.sparkline24m}
                      width={72}
                      height={24}
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label
                htmlFor="portfolio-amount-input"
                className="block text-xs font-medium text-texte mb-1"
              >
                Montant de l’ordre ($ CAD)
              </label>
              <input
                id="portfolio-amount-input"
                type="number"
                min="1"
                step="50"
                value={amountInput}
                onChange={(e) => {
                  setAmountInput(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="1500"
                className="min-h-11 w-full px-3 py-2 text-sm font-mono tabular-nums bg-fond border border-bordure-champ rounded-md text-texte outline-hidden focus-ring focus:ring-2 focus:ring-accent"
              />
              <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                {[500, 1500, 3000, 10000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => {
                      setAmountInput(String(preset));
                      setFormError(null);
                    }}
                    className="min-h-11 py-1 text-xs font-mono tabular-nums text-texte bg-surface-douce hover:bg-surface-douce border border-bordure rounded-sm transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {formatEur(preset, 0)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="portfolio-date-select"
                className="block text-xs font-medium text-texte mb-1"
              >
                Date d’exécution
              </label>
              <select
                id="portfolio-date-select"
                value={purchaseYm}
                onChange={(e) => {
                  setPurchaseYm(e.target.value);
                  setAddedFeedback(null);
                }}
                className="min-h-11 w-full px-3 py-2 text-xs sm:text-sm bg-fond border border-bordure-champ rounded-md text-texte outline-hidden focus-ring focus:ring-2 focus:ring-accent"
              >
                {[...HISTORICAL_SERIES].reverse().map((pt) => (
                  <option key={pt.yearMonth} value={pt.yearMonth}>
                    {pt.label}
                    {pt.regimeNote ? ` — ${pt.regimeNote}` : ''}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-5 gap-1 mt-1.5">
                {QUICK_DATES.map((q) => (
                  <button aria-pressed={Boolean(purchaseYm === q.ym)}
                    key={q.ym}
                    type="button"
                    onClick={() => setPurchaseYm(q.ym)}
                    className={`min-h-11 py-1 text-[11px] rounded-sm transition-colors whitespace-nowrap cursor-pointer ${
                      purchaseYm === q.ym
                        ? 'bg-accent text-sur-accent font-semibold'
                        : 'bg-surface-douce text-texte hover:bg-surface-douce'
                    }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Execution Price & Performance Delta */}
            <div className="p-3 bg-fond border border-bordure rounded-sm space-y-1.5 text-xs font-mono tabular-nums">
              <div className="flex items-center justify-between">
                <span className="font-sans text-texte-doux">Cours entrée → Spot</span>
                <span className="text-texte">
                  {formatPriceEur(previewEntryPrice)} → {formatPriceEur(previewCurrentPrice)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-texte-doux">Écart latent</span>
                <span
                  className={`font-semibold ${
                    previewGainPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                  }`}
                >
                  {previewGainPct >= 0 ? '▲ ' : '▼ '}
                  {formatSignedPct(previewGainPct)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-sans text-texte-doux">Frais TER · Rendement dist.</span>
                <span className="text-texte">
                  {formatPct(selectedAsset.annualFeePct, 2)} ·{' '}
                  {formatPct(selectedAsset.dividendYieldPct, 1)}
                </span>
              </div>
            </div>

            {formError && (
              <p
                role="alert"
                className="text-xs font-medium text-erreur-texte bg-erreur-fond border border-erreur-texte/40 rounded-md px-3 py-2"
              >
                {formError}
              </p>
            )}

            {addedFeedback && !formError && (
              <p
                role="status"
                className="text-xs font-medium text-succes-texte bg-succes-fond border border-succes-texte/40 rounded-md px-3 py-2"
              >
                {addedFeedback}
              </p>
            )}

            <button
              type="submit"
              className="min-h-11 w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-md transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Exécuter l’ordre d’achat</span>
            </button>
          </form>
        </aside>
      </div>

      {/* Markowitz Efficient Frontier + Pearson Correlation Heatmap */}
      <D3PortfolioRiskDiagnostic
        heldAssetIds={heldAssetIds}
        riskMetrics={riskMetrics}
        scoredAssets={scoredAssets}
        optimalPortfolio={optimalPortfolio}
        onNavigateToAdvice={onNavigateToAI}
      />

      {/* 10,000-Scenario Historical-Volatility Monte Carlo Module */}
      <D3MonteCarloModule lots={lots} livePrices={livePrices} />
    </div>
  );
};
