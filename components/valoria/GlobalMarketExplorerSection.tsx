import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { motion } from 'framer-motion';
import { Globe, Plus, Search, SlidersHorizontal } from 'lucide-react';
import {
  AssetCategory,
  DynamicMarketAssetRegistration,
} from '../../services/valoria/marketData';
import { MarketAssetSubClass } from '../../services/valoria/globalMarketCatalog';
import {
  MultiAssetUniverseSummary,
  UniversalAssetAnalysis,
} from '../../services/valoria/multiAssetQuantEngine';
import { buildAssetTechnicalAnalysis } from '../../services/valoria/dailyTechnicalIndicators';
import { D3PriceSparkline30d } from './D3PriceSparkline30d';
import { D3SectorMarketHeatmap } from './D3SectorMarketHeatmap';
import { VisualStockXRaySpotlightSection } from './VisualStockXRaySpotlightSection';
import {
  formatEur,
  formatPct,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface GlobalMarketExplorerSectionProps {
  universe: MultiAssetUniverseSummary;
  watchlistIds: string[];
  onInspectAsset: (assetId: string) => void;
  onQuickInvestCad: (assetId: string, amountCad: number) => void;
  onAddWatchlist: (assetId: string) => void;
  onRegisterCustomOrLiveAsset: (spec: DynamicMarketAssetRegistration) => string;
  isRefreshingVerified?: boolean;
  verifiedFeedStatus?: string | null;
  onRefreshVerifiedPrices?: () => void;
}

type AssetTabFilter =
  | 'all'
  | 'action_ca'
  | 'action_us'
  | 'action_eu_asia'
  | 'crypto_l1_defi'
  | 'etf_indice'
  | 'obligation_taux'
  | 'real_assets';

type SignalFilter = 'all' | 'buys' | 'sells' | 'held';
type SortMode =
  | 'market_leaders'
  | 'score_desc'
  | 'upside_desc'
  | 'perf_1m_asc'
  | 'yield_desc'
  | 'vol_asc';

const BENCHMARK_LEADER_PRIORITY: Record<string, number> = {
  ADP: 100,
  INTC: 99,
  MSFT: 98,
  RY: 97,
  GOOGL: 96,
  AAPL: 95,
  LLY: 94,
  VCN: 93,
  SHOP: 92,
  ASML: 91,
  BA: 90,
  GOLD: 89,
  BTC: 88,
  XEQT: 87,
  XBB: 86,
  MC: 85,
  TD: 84,
  AMZN: 83,
  META: 82,
  SOL: 81,
  NOVO: 80,
  CNQ: 79,
};

interface RemoteSearchMatch {
  symbol: string;
  assetId?: string;
  name: string;
  exchange: string;
  quoteType: string;
  isBuiltIn: boolean;
}

export const GlobalMarketExplorerSection: React.FC<
  GlobalMarketExplorerSectionProps
> = ({
  universe,
  watchlistIds,
  onInspectAsset,
  onQuickInvestCad,
  onAddWatchlist,
  onRegisterCustomOrLiveAsset,
  isRefreshingVerified = false,
  verifiedFeedStatus = null,
  onRefreshVerifiedPrices,
}) => {
  const [marketViewMode, setMarketViewMode] = useState<
    'explorer' | 'heatmap' | 'xray'
  >('explorer');
  const [tabFilter, setTabFilter] = useState<AssetTabFilter>('all');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('market_leaders');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(25);
  const [hoveredBubbleId, setHoveredBubbleId] = useState<string | null>(null);

  const [isSearchingLive, setIsSearchingLive] = useState<boolean>(false);
  const [liveMatches, setLiveMatches] = useState<RemoteSearchMatch[]>([]);
  const [liveStatusMsg, setLiveStatusMsg] = useState<string | null>(null);
  const [customFallbackTicker, setCustomFallbackTicker] = useState<string | null>(null);
  const [customSpotCadInput, setCustomSpotCadInput] = useState<string>('100');
  const [customClassSelect, setCustomClassSelect] =
    useState<MarketAssetSubClass>('action_us');

  const tabOptions: { id: AssetTabFilter; label: string; count: number }[] = [
    { id: 'all', label: 'Tout', count: universe.totalAssets },
    { id: 'action_ca', label: 'Canada TSX', count: universe.countsBySubClass.action_ca },
    { id: 'action_us', label: 'États-Unis', count: universe.countsBySubClass.action_us },
    { id: 'action_eu_asia', label: 'Europe/Asie', count: universe.countsBySubClass.action_eu_asia },
    { id: 'crypto_l1_defi', label: 'Crypto', count: universe.countsBySubClass.crypto_l1_defi },
    { id: 'etf_indice', label: 'ETF', count: universe.countsBySubClass.etf_indice },
    { id: 'obligation_taux', label: 'Obligations', count: universe.countsBySubClass.obligation_taux },
    {
      id: 'real_assets',
      label: 'Or & REIT',
      count:
        universe.countsBySubClass.matiere_premiere +
        universe.countsBySubClass.immobilier_reit,
    },
  ];

  const filteredAnalyses = useMemo(() => {
    const q = searchQuery.trim().toUpperCase();
    const list = universe.allAnalyses.filter((item) => {
      if (tabFilter === 'real_assets') {
        if (
          item.subClass !== 'matiere_premiere' &&
          item.subClass !== 'immobilier_reit'
        ) {
          return false;
        }
      } else if (tabFilter !== 'all' && item.subClass !== tabFilter) {
        return false;
      }

      if (
        signalFilter === 'buys' &&
        item.signal !== 'ACHAT FORT' &&
        item.signal !== 'ACHETER'
      ) {
        return false;
      }
      if (
        signalFilter === 'sells' &&
        item.signal !== 'VENDRE' &&
        item.signal !== 'ALLÉGER'
      ) {
        return false;
      }
      if (signalFilter === 'held' && !item.isHeld) {
        return false;
      }

      if (q) {
        const hay = `${item.asset.ticker} ${item.asset.id} ${item.asset.name} ${item.sector} ${item.subClassLabel}`.toUpperCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    list.sort((a, b) => {
      if (sortMode === 'market_leaders') {
        const pa = (a.isHeld ? 120 : 0) + (BENCHMARK_LEADER_PRIORITY[a.asset.id] ?? 0);
        const pb = (b.isHeld ? 120 : 0) + (BENCHMARK_LEADER_PRIORITY[b.asset.id] ?? 0);
        if (pb !== pa) return pb - pa;
        return Math.abs(b.momentum1mPct) - Math.abs(a.momentum1mPct);
      }
      if (sortMode === 'perf_1m_asc') return a.momentum1mPct - b.momentum1mPct;
      if (sortMode === 'upside_desc') return b.upsidePct - a.upsidePct;
      if (sortMode === 'yield_desc') return b.grossYieldPct - a.grossYieldPct;
      if (sortMode === 'vol_asc') return a.volatilityPct - b.volatilityPct;
      return b.quantScore - a.quantScore;
    });

    return list;
  }, [universe.allAnalyses, tabFilter, signalFilter, sortMode, searchQuery]);

  const handleGlobalLiveLookup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;

    setIsSearchingLive(true);
    setLiveStatusMsg(null);
    setCustomFallbackTicker(null);

    try {
      const resp = await fetch(`/api/market/search?q=${encodeURIComponent(q)}`);
      if (resp.ok) {
        const data = (await resp.json()) as { results?: RemoteSearchMatch[] };
        const remoteOnly = (data.results ?? []).filter((r) => !r.isBuiltIn);
        setLiveMatches(remoteOnly);
        if (remoteOnly.length === 0) {
          const sym = q.toUpperCase().replace(/\s+/g, '');
          setCustomFallbackTicker(sym);
          setLiveStatusMsg(`Symbole hors-catalogue : ${sym}`);
        }
      }
    } catch {
      const sym = q.toUpperCase().replace(/\s+/g, '');
      setCustomFallbackTicker(sym);
      setLiveStatusMsg(`Ajout personnalisé : ${sym}`);
    } finally {
      setIsSearchingLive(false);
    }
  };

  const handleImportLiveSymbol = async (symbol: string) => {
    setIsSearchingLive(true);
    setLiveStatusMsg(null);
    try {
      const resp = await fetch(
        `/api/market/quote?symbol=${encodeURIComponent(symbol)}`
      );
      const data = (await resp.json()) as {
        liveAvailable?: boolean;
        registration?: DynamicMarketAssetRegistration;
      };
      if (data.liveAvailable && data.registration) {
        const newId = onRegisterCustomOrLiveAsset(data.registration);
        setLiveMatches([]);
        setCustomFallbackTicker(null);
        setLiveStatusMsg(
          `Importé : ${data.registration.ticker} (${formatEur(data.registration.spotCad, 2)})`
        );
        onInspectAsset(newId);
      } else {
        setCustomFallbackTicker(symbol.toUpperCase());
      }
    } catch {
      setCustomFallbackTicker(symbol.toUpperCase());
    } finally {
      setIsSearchingLive(false);
    }
  };

  const handleConfirmManualTicker = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFallbackTicker) return;
    const spot = Number(customSpotCadInput.replace(',', '.'));
    if (!Number.isFinite(spot) || spot <= 0) return;

    const categoryMap: Record<MarketAssetSubClass, AssetCategory> = {
      action_ca: 'actions',
      action_us: 'actions',
      action_eu_asia: 'actions',
      immobilier_reit: 'actions',
      etf_indice: 'actions',
      crypto_l1_defi: 'crypto',
      obligation_taux: 'obligations',
      matiere_premiere: 'refuge',
    };

    const newId = onRegisterCustomOrLiveAsset({
      ticker: customFallbackTicker,
      name: `${customFallbackTicker} (Marché)`,
      spotCad: spot,
      category: categoryMap[customClassSelect],
      subClass: customClassSelect,
    });
    setCustomFallbackTicker(null);
    setLiveMatches([]);
    setLiveStatusMsg(`Ajouté : ${customFallbackTicker} (${formatEur(spot, 2)})`);
    onInspectAsset(newId);
  };

  const visibleRows = filteredAnalyses.slice(0, visibleLimit);
  const bubbleSlice = filteredAnalyses.slice(0, 46);
  const hoveredBubble =
    bubbleSlice.find((b) => b.asset.id === hoveredBubbleId) ?? bubbleSlice[0];

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Unboxed Editorial Header + Progressive View Switcher (1 Focal Anchor at a Time) */}
      <header className="pb-5 border-b border-bordure flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="space-y-1">
          <span className="text-xs text-texte-doux">
            Univers mondial multi-actifs · Valorisations en $ CAD
          </span>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-texte">
            Marché &amp; Opportunités ({universe.totalAssets} actifs)
          </h1>
        </div>

        <div
          role="group"
          aria-label="Perspective du marché"
          className="inline-flex items-center gap-1 p-1 bg-surface/60 border border-bordure rounded-xl overflow-x-auto no-scrollbar max-w-full"
        >
          {(
            [
              { id: 'explorer', label: 'Explorateur & Radar' },
              { id: 'heatmap', label: 'Carte Thermique D3' },
              { id: 'xray', label: 'Sélection X-Ray' },
            ] as const
          ).map((mode) => {
            const isSelected = marketViewMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setMarketViewMode(mode.id)}
                className={`relative min-h-11 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isSelected
                    ? 'text-sur-accent font-semibold'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {isSelected && (
                  <motion.span
                    layoutId="market-view-pill"
                    transition={{
                      type: 'spring',
                      stiffness: 420,
                      damping: 34,
                    }}
                    className="absolute inset-0 bg-accent rounded-lg"
                  />
                )}
                <span className="relative z-10">{mode.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <div>
        {marketViewMode === 'heatmap' && (
          <motion.div
            key="market-heatmap"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <D3SectorMarketHeatmap
              analyses={
                filteredAnalyses.length > 0 ? filteredAnalyses : universe.allAnalyses
              }
              onInspectAsset={onInspectAsset}
              isRefreshingVerified={isRefreshingVerified}
              verifiedFeedStatus={verifiedFeedStatus}
              onRefreshVerifiedPrices={onRefreshVerifiedPrices}
            />
          </motion.div>
        )}

        {marketViewMode === 'xray' && (
          <motion.div
            key="market-xray"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <VisualStockXRaySpotlightSection
              allAnalyses={universe.allAnalyses}
              onInspectAsset={onInspectAsset}
              defaultLimit={12}
            />
          </motion.div>
        )}

        {marketViewMode === 'explorer' && (
          <motion.div
            key="market-explorer"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6 sm:space-y-8"
          >
            {/* Interactive Market Opportunity Bubble Map (Aubaine vs Cher × Score /100) */}
            <div className="bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pb-3 border-b border-bordure">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="text-sm sm:text-base font-semibold text-texte">
                    Radar des Opportunités ({filteredAnalyses.length} actifs)
                  </h2>
                  {hoveredBubble && (
              <span className="font-mono tabular-nums text-xs text-texte">
                <strong className="text-texte">{hoveredBubble.asset.ticker}</strong> ·{' '}
                {formatEur(hoveredBubble.spotPriceCad, hoveredBubble.spotPriceCad < 2 ? 4 : 2)} ·{' '}
                <span
                  className={
                    hoveredBubble.upsidePct >= 5
                      ? 'text-succes-texte font-semibold'
                      : hoveredBubble.upsidePct <= -5
                        ? 'text-erreur-texte font-semibold'
                        : 'text-texte'
                  }
                >
                  {formatSignedPct(hoveredBubble.upsidePct, 1)}
                </span>{' '}
                ·{' '}
                {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                {hoveredBubble.quantScore}/100
              </span>
            )}
          </div>

          {/* Search & Global Ticker Onboarding */}
          <form
            onSubmit={handleGlobalLiveLookup}
            className="flex items-center gap-2 w-full lg:w-auto"
          >
            <div className="relative flex-1 lg:w-64 min-w-0">
              <Search className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-texte-doux absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <label htmlFor="global-market-search" className="sr-only">
                Rechercher un symbole ou actif
              </label>
              <input
                id="global-market-search"
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value.trim()) {
                    setLiveMatches([]);
                    setCustomFallbackTicker(null);
                  }
                }}
                placeholder="Ticker (ex: RY.TO, ADP, SOL…)"
                className="w-full min-h-11 sm:min-h-11 pl-9 sm:pl-8 pr-3 py-2 sm:py-1.5 text-base sm:text-xs bg-surface border border-bordure rounded-xl text-texte placeholder:text-texte-doux outline-hidden focus-ring focus:border-bordure-champ"
              />
            </div>
            <button
              type="submit"
              disabled={isSearchingLive || !searchQuery.trim()}
              className="min-w-11 inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-11 px-3 py-2 sm:py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-50 rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">
                {isSearchingLive ? 'Scan…' : '+ Symbole mondial'}
              </span>
              <span className="sm:hidden">{isSearchingLive ? 'Scan…' : '+ Global'}</span>
            </button>
          </form>
        </div>

        {/* Live Remote Search Results or Manual Custom Onboarding */}
        {(liveMatches.length > 0 || customFallbackTicker || liveStatusMsg) && (
          <div className="pb-3 border-b border-bordure space-y-2.5 text-xs">
            {liveStatusMsg && (
              <span className="font-mono text-succes-texte">{liveStatusMsg}</span>
            )}

            {liveMatches.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {liveMatches.map((m) => (
                  <button
                    key={m.symbol}
                    type="button"
                    onClick={() => handleImportLiveSymbol(m.symbol)}
                    className="min-h-11 px-3 py-1.5 bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl text-left transition-colors cursor-pointer"
                  >
                    <span className="font-mono font-semibold text-texte">
                      {m.symbol}
                    </span>{' '}
                    <span className="text-texte-doux">· {m.name}</span>
                  </button>
                ))}
              </div>
            )}

            {customFallbackTicker && (
              <form
                onSubmit={handleConfirmManualTicker}
                className="flex flex-wrap items-end gap-2.5"
              >
                <span className="min-h-11 inline-flex items-center px-2.5 py-1.5 font-mono font-semibold bg-surface border border-bordure rounded-xl text-texte">
                  {customFallbackTicker}
                </span>
                <label htmlFor="custom-asset-class" className="sr-only">
                  Classe d’actif
                </label>
                <select
                  id="custom-asset-class"
                  value={customClassSelect}
                  onChange={(e) =>
                    setCustomClassSelect(e.target.value as MarketAssetSubClass)
                  }
                  className="min-h-11 px-2.5 py-1.5 text-base sm:text-xs bg-surface border border-bordure rounded-xl text-texte"
                >
                  <option value="action_ca">Action Canada</option>
                  <option value="action_us">Action États-Unis</option>
                  <option value="action_eu_asia">Europe / Asie</option>
                  <option value="crypto_l1_defi">Crypto / Web3</option>
                  <option value="etf_indice">ETF Indiciel</option>
                  <option value="obligation_taux">Obligation</option>
                  <option value="matiere_premiere">Matière 1re</option>
                  <option value="immobilier_reit">REIT</option>
                </select>
                <label htmlFor="custom-spot-cad" className="sr-only">
                  Cours en $ CAD
                </label>
                <input
                  id="custom-spot-cad"
                  type="number"
                  min={0.0001}
                  step="any"
                  value={customSpotCadInput}
                  onChange={(e) => setCustomSpotCadInput(e.target.value)}
                  className="w-28 min-h-11 px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-surface border border-bordure rounded-xl text-texte"
                />
                <button
                  type="submit"
                  className="min-h-11 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
                >
                  Intégrer ($ CAD)
                </button>
              </form>
            )}
          </div>
        )}

        {/* Filter Bar */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
          <div className="flex items-center gap-1 p-1 bg-surface border border-bordure rounded-xl overflow-x-auto no-scrollbar max-w-full">
            {tabOptions.map((tab) => (
              <button aria-pressed={Boolean(tabFilter === tab.id)}
                key={tab.id}
                type="button"
                onClick={() => {
                  setTabFilter(tab.id);
                  setVisibleLimit(25);
                }}
                className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  tabFilter === tab.id
                    ? 'bg-accent text-sur-accent font-semibold'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {tab.label}{' '}
                <span className="font-mono text-[10px] opacity-75">
                  ({tab.count})
                </span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex items-center gap-2 text-xs">
            <label htmlFor="screener-signal-filter" className="sr-only">
              Filtrer par signal
            </label>
            <select
              id="screener-signal-filter"
              value={signalFilter}
              onChange={(e) => setSignalFilter(e.target.value as SignalFilter)}
              className="w-full xl:w-auto min-h-11 sm:min-h-11 px-2.5 py-1.5 text-base sm:text-xs bg-surface border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ"
            >
              <option value="all">Tous verdicts ({universe.totalAssets})</option>
              <option value="buys">
                ▲ À Acheter ({universe.countsBySignal['ACHAT FORT'] + universe.countsBySignal.ACHETER})
              </option>
              <option value="sells">
                ▼ À Vendre / Éviter ({universe.countsBySignal.ALLÉGER + universe.countsBySignal.VENDRE})
              </option>
              <option value="held">★ Dans mon portefeuille</option>
            </select>

            <label htmlFor="screener-sort-mode" className="sr-only">
              Trier les actifs
            </label>
            <select
              id="screener-sort-mode"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="w-full xl:w-auto min-h-11 sm:min-h-11 px-2.5 py-1.5 text-base sm:text-xs bg-surface border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ"
            >
              <option value="market_leaders">Tri : Leaders &amp; Alertes</option>
              <option value="score_desc">Tri : Meilleure Note (/100)</option>
              <option value="upside_desc">Tri : Plus forte Aubaine (%)</option>
              <option value="perf_1m_asc">Tri : Plus fortes Baisses 1M</option>
              <option value="yield_desc">Tri : Dividende / Revenu (%)</option>
              <option value="vol_asc">Tri : Plus calme (Risque bas)</option>
            </select>
          </div>
        </div>

        {/* SVG Quadrant Scatter Plot (Strictly Sober Zinc + Emerald/Rose) */}
        {bubbleSlice.length > 0 && (
          <div className="w-full overflow-x-auto no-scrollbar pt-1">
            <svg
              width="100%"
              viewBox="0 0 920 220"
              role="img"
              aria-label="Carte d’opportunités Aubaine vs Qualité"
              className="block select-none min-w-[560px]"
            >
              <rect x="48" y="14" width="844" height="176" fill={VALORIA_PALETTE.bgDeep} rx="8" stroke={VALORIA_PALETTE.gridZinc} />
              <line x1="418" y1="14" x2="418" y2="190" stroke={VALORIA_PALETTE.axisZinc} strokeDasharray="4 3" />
              <line x1="48" y1="88" x2="892" y2="88" stroke={VALORIA_PALETTE.axisZinc} strokeDasharray="4 3" />

              <text x="880" y="30" textAnchor="end" fill={VALORIA_PALETTE.emerald} fontSize="10" fontFamily="JetBrains Mono, monospace">
                ▲ ZONE ACHAT (Bon prix + Haute qualité)
              </text>
              <text x="60" y="30" fill={VALORIA_PALETTE.rose} fontSize="10" fontFamily="JetBrains Mono, monospace">
                ▼ ZONE SURÉVALUÉE (Prudence)
              </text>
              <text x="418" y="206" textAnchor="middle" fill={VALORIA_PALETTE.textZinc} fontSize="10" fontFamily="JetBrains Mono, monospace">
                Juste Prix (0 %)
              </text>
              <text x="12" y="28" fill={VALORIA_PALETTE.textZinc} fontSize="10" fontFamily="JetBrains Mono, monospace">
                95
              </text>
              <text x="12" y="92" fill={VALORIA_PALETTE.textZinc} fontSize="10" fontFamily="JetBrains Mono, monospace">
                65
              </text>
              <text x="12" y="186" fill={VALORIA_PALETTE.textZinc} fontSize="10" fontFamily="JetBrains Mono, monospace">
                25
              </text>

              {bubbleSlice.map((item) => {
                const clampedUp = Math.max(-35, Math.min(45, item.upsidePct));
                const cx = 48 + ((clampedUp + 35) / 80) * 844;
                const clampedScore = Math.max(22, Math.min(96, item.quantScore));
                const cy = 190 - ((clampedScore - 22) / 74) * 176;
                const r = item.isHeld ? 8.5 : 6.5;
                const fill =
                  item.signal === 'ACHAT FORT' || item.signal === 'ACHETER'
                    ? VALORIA_PALETTE.emerald
                    : item.signal === 'VENDRE' || item.signal === 'ALLÉGER'
                      ? VALORIA_PALETTE.rose
                      : VALORIA_PALETTE.textZinc;

                return (
                  <g
                    key={item.asset.id}
                    onClick={() => onInspectAsset(item.asset.id)}
                    onMouseEnter={() => setHoveredBubbleId(item.asset.id)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill={fill}
                      fillOpacity={hoveredBubbleId === item.asset.id ? 1 : 0.8}
                      stroke={item.isHeld ? VALORIA_PALETTE.textWhiteSoft : VALORIA_PALETTE.bgDeep}
                      strokeWidth={item.isHeld ? 2 : 1.2}
                    />
                    <text
                      x={cx}
                      y={cy - r - 3}
                      textAnchor="middle"
                      fill={VALORIA_PALETTE.lineZinc}
                      fontSize="9"
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {item.asset.ticker.split('.')[0]}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}
            </div>

            {/* Full Market Screener: Dedicated Mobile Tap Cards (< md) + Desktop Table (>= md) */}
            <div className="bg-surface/20 border border-bordure rounded-2xl p-4 sm:p-6">
              {filteredAnalyses.length === 0 ? (
          <div className="py-8 text-center space-y-3">
            <span className="block text-sm font-mono text-texte">
              0 résultat local pour « {searchQuery} »
            </span>
            {searchQuery.trim() && (
              <button
                type="button"
                onClick={() => handleGlobalLiveLookup()}
                className="min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
              >
                Importer « {searchQuery.trim().toUpperCase()} » ($ CAD)
              </button>
            )}
          </div>
        ) : (
          <div>
            {/* Mobile Tap Card List (< md): Zero Horizontal Scroll */}
            <div
              data-testid="mobile-market-cards"
              className="md:hidden divide-y divide-bordure"
            >
              {visibleRows.map((item: UniversalAssetAnalysis) => {
                const decimals = item.spotPriceCad < 2 ? 4 : 2;
                const sigStyle =
                  item.signal === 'ACHAT FORT' || item.signal === 'ACHETER'
                    ? 'text-succes-texte font-semibold'
                    : item.signal === 'VENDRE' || item.signal === 'ALLÉGER'
                      ? 'text-erreur-texte font-semibold'
                      : 'text-texte';

                return (
                  <div key={`m-row-${item.asset.id}`} className="py-3.5 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onInspectAsset(item.asset.id)}
                        className="min-h-11 text-left min-w-0 flex-1 cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="font-mono font-bold text-sm text-texte">
                            {item.asset.ticker}
                          </span>
                          <span className="text-xs text-texte-doux truncate">
                            · {item.asset.name.split(' (')[0]}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-texte-doux mt-0.5">
                          {item.optimalCanadianWrapper}
                          {item.isHeld ? ' · ★ Détenu' : ''}
                        </div>
                      </button>

                      <div className="flex items-center gap-2.5 shrink-0">
                        <D3PriceSparkline30d
                          assetId={item.asset.id}
                          spotPriceCad={item.spotPriceCad}
                          width={60}
                          height={22}
                        />
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-sm font-bold text-texte">
                            {formatEur(item.spotPriceCad, decimals)}
                          </div>
                          <div
                            className={`text-[11px] ${
                              item.momentum1dPct >= 0
                                ? 'text-succes-texte'
                                : 'text-erreur-texte'
                            }`}
                          >
                            1J {formatSignedPct(item.momentum1dPct, 1)}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs font-mono tabular-nums">
                        <span className={sigStyle}>{item.signal}</span>
                        <span className="text-texte-doux">·</span>
                        {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                        <span className="text-texte">{item.quantScore}/100</span>
                        <span className="text-texte-doux">·</span>
                        <span
                          className={
                            item.upsidePct >= 8
                              ? 'text-succes-texte font-semibold'
                              : item.upsidePct <= -5
                                ? 'text-erreur-texte font-semibold'
                                : 'text-texte-doux'
                          }
                        >
                          {formatSignedPct(item.upsidePct, 1)}
                        </span>
                      </div>

                      <div className="inline-flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onInspectAsset(item.asset.id)}
                          aria-label={`Ouvrir l’analyse technique de ${item.asset.ticker}`}
                          className="min-w-11 inline-flex items-center gap-1 min-h-11 px-2.5 py-1.5 text-xs font-medium text-texte bg-surface border border-bordure-champ rounded-lg cursor-pointer"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                          <span>Courbes</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => onQuickInvestCad(item.asset.id, 2500)}
                          aria-label={`Acheter 2 500 $ CAD de ${item.asset.ticker}`}
                          className="min-w-11 inline-flex items-center gap-0.5 min-h-11 px-2.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent rounded-lg cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>2,5k$</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop Full Screener Table (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-bordure text-texte-doux">
                    <th className="py-2 pr-2 font-medium">Actif · Compte</th>
                    <th className="py-2 px-1.5 font-medium">30J</th>
                    <th className="py-2 px-2 font-medium text-right">Prix ($ CAD)</th>
                    <th className="py-2 px-2 font-medium text-right">Juste Valeur</th>
                    <th className="py-2 px-2 font-medium">Note (/100)</th>
                    <th className="py-2 px-2 font-medium text-right">MM 200j · RSI</th>
                    <th className="py-2 px-2 font-medium">Verdict</th>
                    <th className="py-2 pl-2 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bordure">
                  {visibleRows.map((item: UniversalAssetAnalysis) => {
                    const isWatched = watchlistIds.includes(item.asset.id);
                    const decimals = item.spotPriceCad < 2 ? 4 : 2;
                    const tech = buildAssetTechnicalAnalysis(
                      item.asset.id,
                      item.spotPriceCad
                    );
                    const sigStyle =
                      item.signal === 'ACHAT FORT' || item.signal === 'ACHETER'
                        ? 'text-succes-texte font-semibold'
                        : item.signal === 'VENDRE' || item.signal === 'ALLÉGER'
                          ? 'text-erreur-texte font-semibold'
                          : 'text-texte';
                    const barFill =
                      item.quantScore >= 68
                        ? 'fill-succes-texte'
                        : item.quantScore <= 44
                          ? 'fill-erreur-texte'
                          : 'fill-texte';

                    return (
                      <tr
                        key={item.asset.id}
                        className="hover:bg-surface/60 transition-colors"
                      >
                        <td className="py-2.5 pr-2 max-w-[168px]">
                          <button
                            type="button"
                            onClick={() => onInspectAsset(item.asset.id)}
                            className="min-h-11 text-left group cursor-pointer"
                          >
                            <div className="font-semibold text-texte group-hover:text-texte transition-colors truncate max-w-[200px] lg:max-w-[280px] xl:max-w-[340px]">
                              <span className="font-mono">{item.asset.ticker}</span>{' '}
                              <span className="font-normal text-texte-doux">
                                · {item.asset.name.split(' (')[0]}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-texte-doux truncate max-w-[164px]">
                              {item.optimalCanadianWrapper}
                              {item.isHeld ? ' · ★ Détenu' : ''}
                            </div>
                          </button>
                        </td>

                        <td className="py-2.5 px-1.5">
                          <D3PriceSparkline30d
                            assetId={item.asset.id}
                            spotPriceCad={item.spotPriceCad}
                            width={64}
                            height={22}
                          />
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-texte whitespace-nowrap">
                          <div>{formatEur(item.spotPriceCad, decimals)}</div>
                          <div
                            className={`text-[11px] ${
                              item.momentum1dPct >= 0
                                ? 'text-succes-texte'
                                : 'text-erreur-texte'
                            }`}
                          >
                            1J {formatSignedPct(item.momentum1dPct, 1)}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-texte">
                            {formatEur(item.fairValueCad, decimals)}
                          </div>
                          <div
                            className={`text-[11px] font-semibold ${
                              item.upsidePct >= 8
                                ? 'text-succes-texte'
                                : item.upsidePct <= -5
                                  ? 'text-erreur-texte'
                                  : 'text-texte-doux'
                            }`}
                          >
                            {formatSignedPct(item.upsidePct, 1)}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 w-28 font-mono tabular-nums">
                          <div className="flex items-center gap-1.5">
                            <svg
                              viewBox="0 0 100 6"
                              preserveAspectRatio="none"
                              aria-hidden="true"
                              className="flex-1 h-1.5 rounded-full overflow-hidden block"
                            >
                              <rect width="100" height="6" rx="3" className="fill-surface-douce" />
                              <rect
                                width={Math.max(2, Math.min(100, item.quantScore))}
                                height="6"
                                rx="3"
                                className={barFill}
                              />
                            </svg>
                            <span className="text-texte w-6 text-right">
                              {item.quantScore}
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div
                            className={
                              tech.latest.gapVsSma200Pct >= 0
                                ? 'text-succes-texte'
                                : 'text-erreur-texte'
                            }
                          >
                            {tech.latest.gapVsSma200Pct >= 0 ? '▲' : '▼'}{' '}
                            {formatSignedPct(tech.latest.gapVsSma200Pct, 1)}
                          </div>
                          <div className="text-[11px] text-texte-doux">
                            RSI {tech.latest.rsi14.toFixed(0)} · Vol {formatPct(item.volatilityPct, 0)}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 whitespace-nowrap">
                          <span className={sigStyle}>{item.signal}</span>
                        </td>

                        <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onInspectAsset(item.asset.id)}
                              aria-label={`Ouvrir l’analyse technique MM 50/200, RSI et MACD de ${item.asset.ticker}`}
                              className="min-h-11 min-w-11 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-texte bg-surface hover:bg-accent hover:text-sur-accent border border-bordure-champ rounded-lg transition-colors cursor-pointer"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              <span>Courbes</span>
                            </button>
                            {!isWatched && (
                              <button
                                type="button"
                                onClick={() => onAddWatchlist(item.asset.id)}
                                aria-label={`Surveiller ${item.asset.ticker}`}
                                className="min-h-11 min-w-11 px-2 py-1 text-[11px] text-texte-doux hover:text-texte bg-surface hover:bg-surface-douce border border-bordure rounded-lg transition-colors cursor-pointer"
                              >
                                +Suivre
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onQuickInvestCad(item.asset.id, 2500)}
                              aria-label={`Acheter 2 500 $ CAD de ${item.asset.ticker}`}
                              className="min-h-11 min-w-11 inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-lg transition-colors cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                              <span>2,5k$</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {(filteredAnalyses.length > visibleLimit || visibleLimit > 35) && (
              <div className="pt-4 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 border-t border-bordure mt-3">
                <span className="font-mono tabular-nums text-xs text-texte-doux">
                  Affichés : <strong className="text-texte">{Math.min(visibleLimit, filteredAnalyses.length)}</strong> /{' '}
                  {filteredAnalyses.length} actifs
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  {filteredAnalyses.length > visibleLimit && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleLimit((prev) =>
                            Math.min(filteredAnalyses.length, prev + 35)
                          )
                        }
                        className="flex-1 sm:flex-none min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Afficher +35 ({filteredAnalyses.length - visibleLimit} restants)
                      </button>
                      {filteredAnalyses.length - visibleLimit > 35 && (
                        <button
                          type="button"
                          onClick={() => setVisibleLimit(filteredAnalyses.length)}
                          className="flex-1 sm:flex-none min-h-11 px-4 py-2 text-xs font-semibold text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Tout afficher ({filteredAnalyses.length})
                        </button>
                      )}
                    </>
                  )}

                  {visibleLimit > 35 && (
                    <button
                      type="button"
                      onClick={() => setVisibleLimit(35)}
                      className="min-h-11 px-3.5 py-2 text-xs font-medium text-texte-doux hover:text-texte bg-fond border border-bordure rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Réduire à 35
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
