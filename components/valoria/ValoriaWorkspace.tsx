import React, { useEffect, useMemo, useState } from 'react';
import { RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { TAB_LABELS } from '../../constants';
import { Tab } from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { useValoriaBridge } from '../../hooks/useValoriaBridge';
import {
  MARKET_REGIMES,
  type InvestmentGoal,
  type MacroIndicators,
  type RegimeId,
  type RiskProfile,
} from '../../services/valoria/marketData';
import { applyLiveMarketTick } from '../../services/valoria/engine';
import { buildProAnalystAdvisory } from '../../services/valoria/proAnalystAdvisor';
import { analyzeFullMarketUniverse } from '../../services/valoria/multiAssetQuantEngine';
import { formatCad } from '../../services/valoria/valoriaFormatters';
import {
  computeSandboxDeltaOrders,
  parseValoriaFocusSection,
  type ValoriaApplyOrderCandidate,
} from '../../services/valoria/valoriaIntegration';
import { PageHeader } from '../ui/PageHeader';
import { SubTabs, TabPanel, type SubTabDef } from '../ui/SubTabs';
import { PrivateAmount } from '../ui/PrivateAmount';
import {
  ProAdvisorUnifiedView,
  type WorkspaceTabId,
} from './ProAdvisorUnifiedView';
import { BacktestView } from './BacktestView';
import { D3MonteCarloModule } from './D3MonteCarloModule';
import { PortfolioSimulatorView } from './PortfolioSimulatorView';
import { DeepQuantModelsView } from './DeepQuantModelsView';
import { EquitySignalsView } from './EquitySignalsView';
import { InteractiveAcademyView } from './InteractiveAcademyView';
import { LiveNewsCatalystView } from './LiveNewsCatalystView';
import { AIRecommendationsView } from './AIRecommendationsView';
import { FinanceAIBridgeModal } from './FinanceAIBridgeModal';
import { ApplyValoriaToPortfolioModal } from './ApplyValoriaToPortfolioModal';
import { AssetTearSheetModal } from './AssetTearSheetModal';

type ComplementaryLabId =
  | 'unified'
  | 'backtest'
  | 'montecarlo'
  | 'simulator'
  | 'quant_models'
  | 'equity_signals'
  | 'academy'
  | 'live_news'
  | 'ai_recs';

const MAIN_TABS: ReadonlyArray<SubTabDef<WorkspaceTabId>> = [
  { id: 'portfolio', label: 'Ce que j’ai', icon: 'portfolio' },
  { id: 'recommendations', label: 'Recommandés', icon: 'sparkles' },
  { id: 'ai_proof', label: 'Preuve IA', icon: 'clock' },
  { id: 'dialogue', label: 'Discuter IA', icon: 'users' },
  { id: 'market', label: 'Marchés', icon: 'globe' },
  { id: 'intelligence', label: 'Agents & Futur', icon: 'chart' },
];

const COMPLEMENTARY_LABS: ReadonlyArray<{
  id: ComplementaryLabId;
  label: string;
}> = [
  { id: 'unified', label: 'Vue Conseiller Unifiée (6 onglets)' },
  { id: 'backtest', label: 'Backtest historique ($ CAD)' },
  { id: 'montecarlo', label: 'Monte Carlo (10 000 scénarios)' },
  { id: 'simulator', label: 'Simulateur de portefeuille' },
  { id: 'quant_models', label: 'Modèles Quant (Black-Litterman)' },
  { id: 'equity_signals', label: 'Signaux Actions (22 ratios)' },
  { id: 'academy', label: 'Académie interactive' },
  { id: 'live_news', label: 'Actus & Catalyseurs en direct' },
  { id: 'ai_recs', label: 'Recommandations IA structurées' },
];

export interface ValoriaWorkspaceProps {
  embeddedInPlacements?: boolean;
  forcedSection?: 'advisor' | 'market' | 'labs';
}

export const ValoriaWorkspace: React.FC<ValoriaWorkspaceProps> = ({
  embeddedInPlacements = false,
  forcedSection,
}) => {
  const bridge = useValoriaBridge();
  const pendingFocus = useFinanceStore((s) => s.pendingFocus);
  const clearPendingFocus = useFinanceStore((s) => s.clearPendingFocus);

  const [activeMainTab, setActiveMainTab] = useState<WorkspaceTabId>(() => {
    if (forcedSection === 'market') return 'market';
    if (forcedSection === 'labs') return 'ai_proof';
    return 'portfolio';
  });
  const [activeLab, setActiveLab] = useState<ComplementaryLabId>('unified');
  const [isControlHubOpen, setIsControlHubOpen] = useState<boolean>(false);
  const [isBridgeModalOpen, setIsBridgeModalOpen] = useState<boolean>(false);
  const [focusedAssetId, setFocusedAssetId] = useState<string | null>(null);
  const [externalInspectedAssetId, setExternalInspectedAssetId] = useState<string | null>(null);
  const [applyRealOrders, setApplyRealOrders] = useState<ValoriaApplyOrderCandidate[] | null>(null);

  useEffect(() => {
    if (!forcedSection) return;
    if (pendingFocus && (pendingFocus.tab === Tab.VALORIA || pendingFocus.tab === Tab.INVESTMENTS) && Date.now() <= pendingFocus.expiresAt) {
      const target = parseValoriaFocusSection(pendingFocus.section);
      if (target.tab || target.lab || target.assetId) return;
    }
    if (forcedSection === 'market') {
      setActiveLab('unified');
      setActiveMainTab('market');
    } else if (forcedSection === 'labs') {
      setActiveMainTab((prev) => (prev === 'ai_proof' ? prev : 'ai_proof'));
    } else if (forcedSection === 'advisor') {
      setActiveLab('unified');
      setActiveMainTab((prev) => (prev === 'market' || prev === 'ai_proof' ? 'portfolio' : prev));
    }
  }, [forcedSection, pendingFocus]);

  useEffect(() => {
    if (!pendingFocus || (pendingFocus.tab !== Tab.VALORIA && pendingFocus.tab !== Tab.INVESTMENTS) || Date.now() > pendingFocus.expiresAt) {
      return;
    }
    const target = parseValoriaFocusSection(pendingFocus.section);
    if (!target.lab && !target.tab && !target.assetId) {
      return;
    }
    if (target.lab) {
      setActiveLab(target.lab);
    }
    if (target.tab) {
      setActiveMainTab(target.tab);
    }
    if (target.assetId) {
      setExternalInspectedAssetId(target.assetId);
    }
    clearPendingFocus();
  }, [pendingFocus, clearPendingFocus]);

  // États partagés avec les 8 laboratoires complémentaires
  const [backtestAssetId, setBacktestAssetId] = useState<string>('XEQT');
  const [backtestStartYm, setBacktestStartYm] = useState<string>('2020-01');
  const [backtestAmount, setBacktestAmount] = useState<number>(5000);
  const [simGoal, setSimGoal] = useState<InvestmentGoal>('croissance_long_terme');
  const [customMacro, setCustomMacro] = useState<MacroIndicators | null>(null);
  const [tickPricesOverlay, setTickPricesOverlay] = useState<Record<string, number> | null>(
    null
  );
  const [tickStep, setTickStep] = useState<number>(0);
  const [completedQuestionIds, setCompletedQuestionIds] = useState<string[]>([]);
  const [quickAddAssetId, setQuickAddAssetId] = useState<string>('XEQT');
  const [quickAddAmount, setQuickAddAmount] = useState<string>('5000');

  const activeMacro = customMacro ?? bridge.macro;
  const activeLivePrices = tickPricesOverlay ?? bridge.livePrices;

  const isEmptyPortfolio = bridge.lots.length === 0;

  const sandboxDeltaOrders = useMemo(
    () =>
      bridge.isSimulationModified
        ? computeSandboxDeltaOrders(bridge.realLots, bridge.lots, activeLivePrices)
        : [],
    [bridge.isSimulationModified, bridge.realLots, bridge.lots, activeLivePrices]
  );

  const emptyModeInspectedAnalysis = useMemo(() => {
    if (!isEmptyPortfolio || !externalInspectedAssetId) return null;
    const universe = analyzeFullMarketUniverse({
      livePrices: activeLivePrices,
      macro: activeMacro,
      riskProfile: bridge.riskProfile as RiskProfile,
      evaluatedLots: [],
      totalPortfolioValue: 0,
    });
    const upper = externalInspectedAssetId.trim().toUpperCase();
    return (
      universe.byId.get(externalInspectedAssetId) ??
      universe.allAnalyses.find(
        (u) =>
          u.asset.id.toUpperCase() === upper ||
          u.asset.ticker.toUpperCase() === upper ||
          u.asset.ticker.split('.')[0].toUpperCase() === upper
      ) ??
      null
    );
  }, [isEmptyPortfolio, externalInspectedAssetId, activeLivePrices, activeMacro, bridge.riskProfile]);

  // Données dérivées uniquement lorsqu'un des 8 laboratoires complémentaires en a besoin
  const labAdvisory = useMemo(() => {
    if (
      isEmptyPortfolio ||
      (activeLab !== 'quant_models' && activeLab !== 'live_news')
    ) {
      return null;
    }
    return buildProAnalystAdvisory({
      lots: bridge.lots,
      livePrices: activeLivePrices,
      macro: activeMacro,
      riskProfile: bridge.riskProfile as RiskProfile,
      availableCashCad: bridge.simCashCad,
      watchlistIds: bridge.watchlistIds,
    });
  }, [
    isEmptyPortfolio,
    activeLab,
    bridge.lots,
    activeLivePrices,
    activeMacro,
    bridge.riskProfile,
    bridge.simCashCad,
    bridge.watchlistIds,
  ]);

  const activeRegimeName =
    MARKET_REGIMES.find((r) => r.id === bridge.regimeId)?.name ??
    'Désinflation & Croissance';

  const handleOpenBacktestForAsset = (
    assetId: string,
    purchaseYearMonth: string,
    amount: number
  ) => {
    setBacktestAssetId(assetId);
    setBacktestStartYm(purchaseYearMonth);
    setBacktestAmount(Math.max(100, Math.round(amount)));
    setActiveLab('backtest');
  };

  const handleQuickEmptyAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(quickAddAmount.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 50) return;
    bridge.addSimLot({
      assetId: quickAddAssetId,
      investedAmount: Math.round(parsed),
      purchaseYearMonth: '2026-11',
    });
  };

  const actionControls = !isEmptyPortfolio ? (
    <div className="flex flex-wrap items-center gap-2">
      {activeLab !== 'unified' && (
        <button
          type="button"
          onClick={() => setActiveLab('unified')}
          className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap focus-ring cursor-pointer"
        >
          <span>← Retour vue unifiée</span>
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setActiveLab('unified');
          setIsControlHubOpen(true);
        }}
        className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap focus-ring cursor-pointer"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Gérer / Simuler</span>
      </button>
    </div>
  ) : undefined;

  return (
    <div data-testid="valoria-workspace" className="space-y-5 sm:space-y-6 pb-10">
      {!embeddedInPlacements && (
        <PageHeader
          title={TAB_LABELS[Tab.VALORIA]}
          nav={
            !isEmptyPortfolio ? (
              <SubTabs
                idPrefix="valoria-main"
                label="Sections Valoria"
                tabs={MAIN_TABS}
                active={activeMainTab}
                onSelect={(tabId) => {
                  setActiveLab('unified');
                  setActiveMainTab(tabId);
                }}
              />
            ) : undefined
          }
          actions={actionControls}
        />
      )}

      {/* ÉTAT VIDE HONNÊTE (règle no-fake-data — aucune position fictive auto-injectée) */}
      {isEmptyPortfolio ? (
        <section
          aria-label="Portefeuille Valoria vide"
          className="bg-surface border border-bordure rounded-2xl p-6 sm:p-8 space-y-6"
        >
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-douce border border-bordure text-xs font-medium text-texte-doux">
              <Sparkles className="w-3.5 h-3.5 text-repere" aria-hidden="true" />
              <span>Bac à sable isolé · Zéro écriture sur Placements</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-texte">
              {bridge.realAssetsEmpty
                ? 'Aucune position active dans votre portefeuille (Portefeuille vide)'
                : 'Aucun placement actif dans la simulation'}
            </h2>
            <p className="text-xs sm:text-sm text-texte-doux leading-relaxed">
              Conformément aux règles FinanceAI, aucune donnée fictive n’est chargée sans
              votre accord. Chargez un scénario d’exemple en simulation isolée ou saisissez
              votre première ligne en $ CAD ci-dessous.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={bridge.loadDemoSimPortfolio}
              className="min-w-11 min-h-11 inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors cursor-pointer"
            >
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              <span>Charger l’exemple Bac à sable</span>
            </button>

            {!bridge.realAssetsEmpty && (
              <button
                type="button"
                onClick={bridge.resetSimToRealPortfolio}
                className="min-w-11 min-h-11 inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-medium text-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" aria-hidden="true" />
                <span>Réinitialiser sur mes Placements réels</span>
              </button>
            )}
          </div>

          <form
            onSubmit={handleQuickEmptyAdd}
            className="pt-5 border-t border-bordure flex flex-col sm:flex-row sm:items-end gap-3"
          >
            <div className="flex-1 space-y-1">
              <label
                htmlFor="valoria-empty-asset"
                className="block text-xs font-medium text-texte-doux"
              >
                Ajouter un premier actif en simulation ($ CAD)
              </label>
              <select
                id="valoria-empty-asset"
                value={quickAddAssetId}
                onChange={(e) => setQuickAddAssetId(e.target.value)}
                className="min-h-11 w-full px-3 py-2 text-xs sm:text-sm bg-fond border border-bordure-champ rounded-xl text-texte outline-hidden focus-ring"
              >
                <option value="XEQT">XEQT — iShares Core Equity ETF ($ CAD)</option>
                <option value="VFV">VFV — Vanguard S&amp;P 500 Index ETF ($ CAD)</option>
                <option value="RY">RY.TO — Banque Royale du Canada ($ CAD)</option>
                <option value="XBB">XBB — iShares Canadian Universe Bond ($ CAD)</option>
                <option value="GOLD">GOLD — Or physique refuge ($ CAD)</option>
              </select>
            </div>

            <div className="w-full sm:w-44 space-y-1">
              <label
                htmlFor="valoria-empty-amount"
                className="block text-xs font-medium text-texte-doux"
              >
                Montant ($ CAD)
              </label>
              <input
                id="valoria-empty-amount"
                type="number"
                min={50}
                step={250}
                value={quickAddAmount}
                onChange={(e) => setQuickAddAmount(e.target.value)}
                className="min-h-11 w-full px-3 py-2 text-xs sm:text-sm font-mono tabular-nums bg-fond border border-bordure-champ rounded-xl text-texte outline-hidden focus-ring"
              />
            </div>

            <button
              type="submit"
              className="min-h-11 px-4 py-2 text-xs sm:text-sm font-semibold text-succes-texte bg-succes-fond hover:bg-surface-douce border border-succes-texte/40 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
            >
              Ajouter en simulation
            </button>
          </form>
        </section>
      ) : (
        <>
          {/* BARRE UNIFIÉE : ONGLETS QUANT IA + ISOLATION + SÉLECTEUR DE LABORATOIRES */}
          <div
            data-testid="valoria-simulation-banner"
            role="region"
            aria-label="Statut de la simulation isolée et laboratoires Valoria"
            className="bg-surface border border-bordure rounded-2xl p-3 sm:p-4 space-y-2.5"
          >
            {embeddedInPlacements && (
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-bordure">
                <div className="overflow-x-auto no-scrollbar max-w-full min-w-0">
                  <SubTabs
                    idPrefix="valoria-main"
                    label="Sections Valoria"
                    tabs={MAIN_TABS}
                    active={activeMainTab}
                    onSelect={(tabId) => {
                      setActiveLab('unified');
                      setActiveMainTab(tabId);
                    }}
                  />
                </div>
                {actionControls}
              </div>
            )}
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full font-semibold ${
                  bridge.isSimulationModified
                    ? 'bg-alerte-fond text-alerte-texte'
                    : 'bg-succes-fond text-succes-texte'
                }`}
              >
                {bridge.isSimulationModified
                  ? 'Bac à sable modifié'
                  : 'Miroir Placements réels'}
              </span>
              <span className="font-medium text-texte">
                Simulation isolée — FinanceAI intact
              </span>
              <span aria-hidden="true" className="text-texte-doux">·</span>
              <span className="font-mono tabular-nums text-texte-doux">
                Total simulé :{' '}
                <PrivateAmount className="font-semibold text-texte">
                  {formatCad(bridge.portfolioSummary.totalCurrentValue, 0)}
                </PrivateAmount>
              </span>
              <span aria-hidden="true" className="text-texte-doux">·</span>
              <span className="font-mono tabular-nums text-texte-doux">
                Liquidités :{' '}
                <PrivateAmount className="font-semibold text-texte">
                  {formatCad(bridge.simCashCad, 0)}
                </PrivateAmount>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {sandboxDeltaOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => setApplyRealOrders(sandboxDeltaOrders)}
                  className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap focus-ring cursor-pointer"
                >
                  <span>Appliquer à mes Placements réels ({sandboxDeltaOrders.length})</span>
                </button>
              )}
              {bridge.isSimulationModified && !bridge.realAssetsEmpty && (
                <button
                  type="button"
                  onClick={bridge.resetSimToRealPortfolio}
                  className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap focus-ring cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Réinitialiser sur mes Placements réels</span>
                </button>
              )}
              {bridge.realAssetsEmpty && bridge.isSimulationModified && (
                <button
                  type="button"
                  onClick={bridge.clearSimPortfolio}
                  className="min-w-11 min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap focus-ring cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Vider le bac à sable</span>
                </button>
              )}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label
                  htmlFor="valoria-labs-select"
                  className="text-xs font-medium text-texte-doux whitespace-nowrap"
                >
                  Laboratoires :
                </label>
                <select
                  id="valoria-labs-select"
                  aria-label="Laboratoires quantitatifs complémentaires"
                  value={activeLab}
                  onChange={(e) => setActiveLab(e.target.value as ComplementaryLabId)}
                  className="min-h-11 flex-1 sm:flex-none px-3 py-2 text-xs font-medium bg-fond border border-bordure-champ rounded-xl text-texte outline-hidden focus-ring max-w-full"
                >
                  {COMPLEMENTARY_LABS.map((lab) => (
                    <option key={lab.id} value={lab.id}>
                      {lab.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            </div>
          </div>

          {/* VUE UNIFIÉE (6 ONGLETS + 4 SOUS-VUES AGENTS & FUTUR) */}
          {activeLab === 'unified' ? (
            <TabPanel
              idPrefix="valoria-main"
              tab={activeMainTab}
              when={activeLab === 'unified'}
            >
              <ProAdvisorUnifiedView
                activeTab={activeMainTab}
                onSelectTab={setActiveMainTab}
                lots={bridge.lots}
                portfolioSummary={bridge.portfolioSummary}
                livePrices={bridge.livePrices}
                macro={bridge.macro}
                regimeId={bridge.regimeId}
                riskProfile={bridge.riskProfile as RiskProfile}
                watchlistIds={bridge.watchlistIds}
                availableCashCad={bridge.simCashCad}
                marketUniverseVersion={bridge.marketUniverseVersion}
                geminiApiKey={bridge.geminiApiKey}
                onChangeAvailableCashCad={bridge.setAvailableCashCad}
                onSelectRiskProfile={bridge.setRiskProfile}
                onSelectRegime={bridge.selectRegime}
                onAddLot={bridge.addSimLot}
                onRemoveAssetHoldings={bridge.removeSimAssetHoldings}
                onExecuteSingleOrder={bridge.executeSimSingleOrder}
                onApplyFullAdvisoryPlan={bridge.applySimFullAdvisoryPlan}
                onResetDemoPortfolio={bridge.loadDemoSimPortfolio}
                onClearPortfolio={bridge.clearSimPortfolio}
                isControlHubOpen={isControlHubOpen}
                onOpenControlHub={() => setIsControlHubOpen(true)}
                onCloseControlHub={() => setIsControlHubOpen(false)}
                onOpenFinanceAIBridge={() => setIsBridgeModalOpen(true)}
                onAddWatchlistAsset={bridge.addWatchlistAsset}
                onRemoveWatchlistAsset={bridge.removeWatchlistAsset}
                onRegisterCustomOrLiveAsset={bridge.registerCustomOrLiveAsset}
                isRefreshingVerified={bridge.isRefreshingVerified}
                verifiedFeedStatus={bridge.verifiedFeedStatus}
                onRefreshVerifiedPrices={bridge.refreshVerifiedPrices}
                focusedAssetId={focusedAssetId}
                onChangeFocusedAssetId={setFocusedAssetId}
                externalInspectedAssetId={externalInspectedAssetId}
                onClearExternalInspectedAsset={() => setExternalInspectedAssetId(null)}
                onRequestApplyRealOrder={(order) => setApplyRealOrders([order])}
              />
            </TabPanel>
          ) : (
            <section
              aria-label="Laboratoire quantitatif complémentaire"
              className="space-y-4"
            >
              {activeLab === 'backtest' && (
                <BacktestView
                  initialAssetId={backtestAssetId}
                  initialStartYm={backtestStartYm}
                  initialAmount={backtestAmount}
                  onAddLotToPortfolio={bridge.addSimLot}
                />
              )}

              {activeLab === 'montecarlo' && (
                <D3MonteCarloModule
                  lots={bridge.lots}
                  livePrices={activeLivePrices}
                />
              )}

              {activeLab === 'simulator' && (
                <PortfolioSimulatorView
                  lots={bridge.lots}
                  summary={bridge.portfolioSummary}
                  livePrices={activeLivePrices}
                  macro={activeMacro}
                  riskProfile={bridge.riskProfile as RiskProfile}
                  goal={simGoal}
                  isLiveStreaming={false}
                  onToggleLiveStream={() => {}}
                  onStepMarketTick={() => {
                    const nextStep = tickStep + 1;
                    setTickStep(nextStep);
                    setTickPricesOverlay(
                      applyLiveMarketTick(activeLivePrices, nextStep, activeMacro)
                    );
                  }}
                  onAddLot={bridge.addSimLot}
                  onRemoveLot={(lotId) => {
                    const lot = bridge.lots.find((l) => l.id === lotId);
                    if (lot) bridge.removeSimAssetHoldings(lot.assetId);
                  }}
                  onExecuteRebalanceOrder={bridge.executeSimSingleOrder}
                  onResetDemoLots={bridge.loadDemoSimPortfolio}
                  onOpenBacktestForAsset={handleOpenBacktestForAsset}
                  onNavigateToAI={() => setActiveLab('ai_recs')}
                />
              )}

              {activeLab === 'quant_models' && labAdvisory && (
                <DeepQuantModelsView
                  institutionalQuant={labAdvisory.institutionalQuant}
                  xray={labAdvisory.xray}
                  lots={bridge.lots}
                  portfolioSummary={bridge.portfolioSummary}
                  livePrices={activeLivePrices}
                  macro={activeMacro}
                  watchlistIds={bridge.watchlistIds}
                  marketUniverseVersion={bridge.marketUniverseVersion}
                  onAddWatchlistAsset={bridge.addWatchlistAsset}
                  onRemoveWatchlistAsset={bridge.removeWatchlistAsset}
                  onQuickInvestFromWatchlist={bridge.executeSimSingleOrder}
                  onInspectAsset={(id) => {
                    setActiveLab('unified');
                    setActiveMainTab('portfolio');
                    setFocusedAssetId(id);
                  }}
                />
              )}

              {activeLab === 'equity_signals' && (
                <EquitySignalsView
                  livePrices={activeLivePrices}
                  macro={activeMacro}
                  regimeId={bridge.regimeId}
                  riskProfile={bridge.riskProfile as RiskProfile}
                  portfolioSummary={bridge.portfolioSummary}
                  watchlistIds={bridge.watchlistIds}
                  onSelectRegime={(id: RegimeId) => {
                    setCustomMacro(null);
                    bridge.selectRegime(id);
                  }}
                  onAddLot={bridge.addSimLot}
                  onExecuteRebalanceOrder={bridge.executeSimSingleOrder}
                  onOpenBacktestForAsset={handleOpenBacktestForAsset}
                  onOpenFinanceAIBridge={() => setIsBridgeModalOpen(true)}
                />
              )}

              {activeLab === 'academy' && (
                <InteractiveAcademyView
                  completedQuestionIds={completedQuestionIds}
                  onMarkQuestionCompleted={(qId) =>
                    setCompletedQuestionIds((prev) =>
                      prev.includes(qId) ? prev : [...prev, qId]
                    )
                  }
                  onResetProgress={() => setCompletedQuestionIds([])}
                />
              )}

              {activeLab === 'live_news' && labAdvisory && (
                <LiveNewsCatalystView
                  newsIntelligence={labAdvisory.newsIntelligence}
                  heldLines={labAdvisory.heldLines}
                  buyRecommendations={labAdvisory.buyRecommendations}
                  regimeName={activeRegimeName}
                  isFetchingLiveNews={bridge.isRefreshingVerified}
                  geminiApiKey={bridge.geminiApiKey}
                  onRefreshLiveNews={bridge.refreshVerifiedPrices}
                  onInspectAsset={(id) => {
                    setActiveLab('unified');
                    setActiveMainTab('portfolio');
                    setFocusedAssetId(id);
                  }}
                />
              )}

              {activeLab === 'ai_recs' && (
                <AIRecommendationsView
                  regimeId={bridge.regimeId}
                  macro={activeMacro}
                  riskProfile={bridge.riskProfile as RiskProfile}
                  goal={simGoal}
                  livePrices={activeLivePrices}
                  portfolioSummary={bridge.portfolioSummary}
                  syncedMonthlySavings={bridge.budgetSync.monthlySavingsCapacityEur}
                  geminiApiKey={bridge.geminiApiKey}
                  onSelectRegime={(id: RegimeId) => {
                    setCustomMacro(null);
                    bridge.selectRegime(id);
                  }}
                  onUpdateMacro={(next) => setCustomMacro(next)}
                  onSelectRiskProfile={bridge.setRiskProfile}
                  onSelectGoal={setSimGoal}
                  onAddLot={bridge.addSimLot}
                  onExecuteRebalanceOrder={bridge.executeSimSingleOrder}
                  onApplyRecommendedAllocation={(totalBudget, slices) => {
                    for (const slice of slices) {
                      const amount = Math.round((totalBudget * slice.weightPct) / 100);
                      if (amount >= 25) {
                        bridge.addSimLot({
                          assetId: slice.assetId,
                          investedAmount: amount,
                          purchaseYearMonth: '2026-11',
                        });
                      }
                    }
                  }}
                  onOpenBacktestForAsset={handleOpenBacktestForAsset}
                />
              )}
            </section>
          )}
        </>
      )}

      {/* PONT JSON / CSV FINANCEAI (ISOLÉ EN SIMULATION) */}
      <FinanceAIBridgeModal
        isOpen={isBridgeModalOpen}
        onClose={() => setIsBridgeModalOpen(false)}
        portfolioSummary={bridge.portfolioSummary}
        livePrices={activeLivePrices}
        macro={activeMacro}
        riskProfile={bridge.riskProfile as RiskProfile}
        syncedBudget={bridge.budgetSync}
        onImportFinanceAI={({ lots, mode, budgetSync, detectedRiskProfile, watchlistAssetIds }) => {
          bridge.importExternalLotsToSim({ lots, mode, budgetSync });
          if (detectedRiskProfile) {
            bridge.setRiskProfile(detectedRiskProfile);
          }
          if (watchlistAssetIds.length > 0) {
            bridge.setWatchlistIds((prev) =>
              Array.from(new Set([...prev, ...watchlistAssetIds]))
            );
          }
        }}
        onNavigateToSignals={() => {
          setIsBridgeModalOpen(false);
          setActiveLab('equity_signals');
        }}
      />

      {/* MODALE DE CONFIRMATION VERS PLACEMENTS RÉELS (ZÉRO ÉCRITURE SANS VALIDATION) */}
      <ApplyValoriaToPortfolioModal
        isOpen={Boolean(applyRealOrders && applyRealOrders.length > 0)}
        onClose={() => setApplyRealOrders(null)}
        orders={applyRealOrders ?? []}
        onApplied={() => {
          bridge.resetSimToRealPortfolio();
        }}
      />

      {/* FICHE RAYON-X FALLBACK QUAND LE PORTEFEUILLE RÉEL EST VIDE (EX. LISTE SUIVIE / CTRL+K) */}
      <AssetTearSheetModal
        analysis={emptyModeInspectedAnalysis}
        macro={activeMacro}
        livePrices={activeLivePrices}
        isWatched={
          emptyModeInspectedAnalysis
            ? bridge.watchlistIds.includes(emptyModeInspectedAnalysis.asset.id)
            : false
        }
        onClose={() => setExternalInspectedAssetId(null)}
        onInvestCad={(assetId, amountCad) => {
          bridge.executeSimSingleOrder(assetId, amountCad);
          setExternalInspectedAssetId(null);
        }}
        onAddWatchlist={bridge.addWatchlistAsset}
      />
    </div>
  );
};
