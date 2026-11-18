import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { UniversalAssetAnalysis } from '../../services/valoria/multiAssetQuantEngine';
import {
  buildAssetTechnicalAnalysis,
  computeBeginnerStockVisualXRay,
} from '../../services/valoria/dailyTechnicalIndicators';
import { D3PriceSparkline30d } from './D3PriceSparkline30d';
import {
  AnimatedMeterBar,
  HoverLiftCard,
  ScrollReveal,
  StaggerCard,
  StaggerGrid,
} from './MotionPrimitives';
import { formatPriceCad, formatSignedPct } from '../../services/valoria/valoriaFormatters';

type StockFilterPreset =
  | 'top_buys'
  | 'sell_traps'
  | 'canada_tsx'
  | 'us_leaders'
  | 'europe_asia'
  | 'all_stocks';

interface VisualStockXRaySpotlightSectionProps {
  allAnalyses: UniversalAssetAnalysis[];
  onInspectAsset: (assetId: string) => void;
  defaultLimit?: number;
}

const FILTER_TABS: { id: StockFilterPreset; label: string }[] = [
  { id: 'top_buys', label: '▲ Top Achats Verts' },
  { id: 'sell_traps', label: '▼ Pièges Rouges à Éviter' },
  { id: 'canada_tsx', label: 'Canada (TSX)' },
  { id: 'us_leaders', label: 'États-Unis' },
  { id: 'europe_asia', label: 'Europe & Asie' },
  { id: 'all_stocks', label: 'Toutes les Actions' },
];

export const VisualStockXRaySpotlightSection: React.FC<
  VisualStockXRaySpotlightSectionProps
> = ({ allAnalyses, onInspectAsset, defaultLimit = 12 }) => {
  const [preset, setPreset] = useState<StockFilterPreset>('top_buys');
  const [query, setQuery] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(defaultLimit);

  const stockUniverse = useMemo(
    () => allAnalyses.filter((a) => a.asset.isIndividualStock),
    [allAnalyses]
  );

  const buyStocksCount = useMemo(
    () =>
      stockUniverse.filter(
        (a) => a.signal === 'ACHAT FORT' || a.signal === 'ACHETER'
      ).length,
    [stockUniverse]
  );
  const sellStocksCount = useMemo(
    () =>
      stockUniverse.filter(
        (a) => a.signal === 'VENDRE' || a.signal === 'ALLÉGER'
      ).length,
    [stockUniverse]
  );

  const filteredStocks = useMemo(() => {
    const q = query.trim().toLowerCase();
    let base = stockUniverse;

    if (q.length > 0) {
      base = base.filter(
        (a) =>
          a.asset.ticker.toLowerCase().includes(q) ||
          a.asset.name.toLowerCase().includes(q) ||
          a.sector.toLowerCase().includes(q)
      );
    } else {
      switch (preset) {
        case 'top_buys':
          base = [...base]
            .filter((a) => a.signal === 'ACHAT FORT' || a.signal === 'ACHETER')
            .sort((a, b) => b.quantScore - a.quantScore);
          break;
        case 'sell_traps':
          base = [...base]
            .filter((a) => a.signal === 'VENDRE' || a.signal === 'ALLÉGER')
            .sort((a, b) => a.quantScore - b.quantScore);
          break;
        case 'canada_tsx':
          base = [...base]
            .filter((a) => a.subClass === 'action_ca')
            .sort((a, b) => b.quantScore - a.quantScore);
          break;
        case 'us_leaders':
          base = [...base]
            .filter((a) => a.subClass === 'action_us')
            .sort((a, b) => b.quantScore - a.quantScore);
          break;
        case 'europe_asia':
          base = [...base]
            .filter((a) => a.subClass === 'action_eu_asia')
            .sort((a, b) => b.quantScore - a.quantScore);
          break;
        case 'all_stocks':
          base = [...base].sort((a, b) => b.quantScore - a.quantScore);
          break;
      }
    }

    return base;
  }, [stockUniverse, preset, query]);

  const displayedStocks = filteredStocks.slice(0, visibleLimit);

  return (
    <ScrollReveal className="pt-4 border-t border-bordure space-y-5">
      {/* Clean Visual Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-texte-doux font-mono tabular-nums">
            <span>{stockUniverse.length} actions mondiales analysées en $ CAD</span>
            <span aria-hidden="true">·</span>
            <span className="text-succes-texte">▲ {buyStocksCount} opportunités</span>
            <span aria-hidden="true">·</span>
            <span className="text-erreur-texte">▼ {sellStocksCount} à éviter / alléger</span>
          </div>
          <h3 className="text-lg sm:text-xl font-bold text-texte">
            Analyses Visuelles d’Actions en 1 Coup d’Œil
          </h3>
          <p className="text-xs text-texte-doux">
            Cliquez sur une carte pour ouvrir ses courbes historiques MM 50/200 jours, RSI-14 et MACD.
          </p>
        </div>

        {/* Instant Search Input */}
        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-texte-doux absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <label htmlFor="stock-xray-search" className="sr-only">
            Rechercher une action par nom ou symbole
          </label>
          <input
            id="stock-xray-search"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleLimit(defaultLimit);
            }}
            placeholder="Chercher ADP, RY, ADBE, BABA…"
            className="min-h-11 w-full pl-9 pr-3 py-2 text-xs bg-surface border border-bordure rounded-xl text-texte placeholder:text-texte-doux outline-hidden focus-ring focus:border-bordure-champ transition-colors"
          />
        </div>
      </div>

      {/* Interactive Filter Bar + Live Count */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-surface/90 border border-bordure">
          {FILTER_TABS.map((tab) => {
            const active = query.trim().length === 0 && preset === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setQuery('');
                  setPreset(tab.id);
                  setVisibleLimit(defaultLimit);
                }}
                className={`min-h-11 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-accent text-sur-accent'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <span
          data-testid="stock-xray-count"
          className="font-mono tabular-nums text-xs text-texte-doux"
        >
          Affichées : <strong className="text-texte">{displayedStocks.length}</strong> /{' '}
          {filteredStocks.length} actions
        </span>
      </div>

      {/* Empty Search Fallback */}
      {displayedStocks.length === 0 ? (
        <div className="py-10 text-center space-y-2 border border-bordure rounded-xl bg-surface/40">
          <p className="text-sm text-texte">
            Aucune action trouvée pour « {query} ».
          </p>
          <button
            type="button"
            onClick={() => setQuery('')}
            className="min-h-11 px-3 py-1.5 text-xs font-semibold bg-accent text-sur-accent rounded-lg cursor-pointer"
          >
            Réinitialiser la recherche
          </button>
        </div>
      ) : (
        <StaggerGrid className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayedStocks.map((item, idx) => {
            const tech = buildAssetTechnicalAnalysis(
              item.asset.id,
              item.spotPriceCad
            );
            const xray = computeBeginnerStockVisualXRay(item, tech);
            const isPositiveVerdict = xray.verdictTone === 'positive';
            const isNegativeVerdict = xray.verdictTone === 'negative';

            const verdictTextClass = isPositiveVerdict
              ? 'text-succes-texte'
              : isNegativeVerdict
                ? 'text-erreur-texte'
                : 'text-texte';

            return (
              <StaggerCard key={item.asset.id} index={idx}>
                <HoverLiftCard className="h-full rounded-2xl border border-bordure hover:border-bordure-champ bg-surface/55 p-4 flex flex-col justify-between gap-3.5 transition-colors">
                  {/* Top Row: Ticker + Name + Clear Unboxed Verdict */}
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-[11px] text-texte-doux">
                          <span className="font-mono font-semibold text-texte">
                            {item.asset.ticker}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">{item.sector}</span>
                        </div>
                        <h4 className="text-sm font-semibold text-texte truncate mt-0.5">
                          {item.asset.name.split(' (')[0]}
                        </h4>
                      </div>

                      <div className="text-right shrink-0">
                        <span
                          className={`block text-xs font-bold whitespace-nowrap ${verdictTextClass}`}
                        >
                          {xray.verdictArrow} {xray.verdictWord}
                        </span>
                        <span className="block font-mono text-[10px] text-texte-doux tabular-nums">
                          {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                          {item.quantScore}/100
                        </span>
                      </div>
                    </div>

                    {/* Price + 30-Day D3 Sparkline */}
                    <div className="flex items-center justify-between gap-3 pt-1">
                      <div className="font-mono tabular-nums min-w-0">
                        <div className="text-base font-bold text-texte">
                          {formatPriceCad(item.spotPriceCad)}
                        </div>
                        <div className="text-[11px] text-texte-doux truncate">
                          Vraie valeur :{' '}
                          <span
                            className={
                              item.upsidePct >= 6
                                ? 'text-succes-texte font-semibold'
                                : item.upsidePct <= -6
                                  ? 'text-erreur-texte font-semibold'
                                  : 'text-texte'
                            }
                          >
                            {formatPriceCad(item.fairValueCad)} (
                            {formatSignedPct(item.upsidePct, 0)})
                          </span>
                        </div>
                      </div>

                      <D3PriceSparkline30d
                        assetId={item.asset.id}
                        spotPriceCad={item.spotPriceCad}
                        width={92}
                        height={28}
                      />
                    </div>
                  </div>

                  {/* Mini Valuation Thermometer (Pure SVG — zero inline styles) */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-texte-doux">
                      <span className="text-succes-texte">Aubaine</span>
                      <span className="text-texte font-medium">
                        {xray.thermometerLabel}
                      </span>
                      <span className="text-erreur-texte">Trop cher</span>
                    </div>
                    <svg
                      viewBox="0 0 240 12"
                      aria-hidden="true"
                      className="w-full h-3 overflow-visible block"
                    >
                      <defs>
                        <linearGradient
                          id={`thermo-${item.asset.id}`}
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="0%"
                        >
                          <stop offset="0%" stopColor={VALORIA_PALETTE.emerald} stopOpacity="0.78" />
                          <stop offset="50%" stopColor={VALORIA_PALETTE.strokeZinc} stopOpacity="0.55" />
                          <stop offset="100%" stopColor={VALORIA_PALETTE.rose} stopOpacity="0.78" />
                        </linearGradient>
                      </defs>
                      <rect
                        x="0"
                        y="2.5"
                        width="240"
                        height="7"
                        rx="3.5"
                        fill={`url(#thermo-${item.asset.id})`}
                      />
                      <circle
                        cx={
                          6 +
                          (Math.max(0, Math.min(100, xray.thermometerPositionPct)) /
                            100) *
                            228
                        }
                        cy="6"
                        r="5"
                        fill={VALORIA_PALETTE.textWhiteSoft}
                        stroke={VALORIA_PALETTE.bgDeep}
                        strokeWidth="2"
                      />
                    </svg>
                  </div>

                  {/* Inline Technical Strip: MM200 · RSI-14 · MACD */}
                  <div className="grid grid-cols-3 gap-1.5 text-center border-y border-bordure py-2 font-mono tabular-nums text-[11px]">
                    <div>
                      <span className="block font-sans text-[10px] text-texte-doux">
                        vs MM 200j
                      </span>
                      <span
                        className={
                          tech.latest.gapVsSma200Pct >= 0
                            ? 'text-succes-texte font-semibold'
                            : 'text-erreur-texte font-semibold'
                        }
                      >
                        {tech.latest.gapVsSma200Pct >= 0 ? '▲ +' : '▼ '}
                        {/* NOMBRE-NON-MONETAIRE : écart technique MM200 d'actif public */}
                        {tech.latest.gapVsSma200Pct.toFixed(1)}%
                      </span>
                    </div>
                    <div>
                      <span className="block font-sans text-[10px] text-texte-doux">
                        RSI (14j)
                      </span>
                      <span
                        className={
                          tech.latest.rsi14 <= 32
                            ? 'text-succes-texte font-semibold'
                            : tech.latest.rsi14 >= 70
                              ? 'text-erreur-texte font-semibold'
                              : 'text-texte font-semibold'
                        }
                      >
                        {tech.latest.rsi14.toFixed(0)}
                      </span>
                    </div>
                    <div>
                      <span className="block font-sans text-[10px] text-texte-doux">
                        MACD
                      </span>
                      <span
                        className={
                          tech.latest.histogram >= 0
                            ? 'text-succes-texte font-semibold'
                            : 'text-erreur-texte font-semibold'
                        }
                      >
                        {tech.latest.histogram >= 0 ? '▲ Haussier' : '▼ Baissier'}
                      </span>
                    </div>
                  </div>

                  {/* 4 Visual Progress Bars (No Jargon) */}
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    {xray.pillars.slice(0, 4).map((p) => (
                      <div key={p.id} className="space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-texte-doux truncate">{p.label.split(' (')[0]}</span>
                          <span className="font-mono text-texte tabular-nums">
                            {p.score}
                          </span>
                        </div>
                        <AnimatedMeterBar
                          pct={p.score}
                          tone={p.tone}
                          heightClass="h-1.5"
                          immediate
                        />
                      </div>
                    ))}
                  </div>

                  {/* 1-Click Open Technical Tear-Sheet Button */}
                  <button
                    type="button"
                    onClick={() => onInspectAsset(item.asset.id)}
                    className="min-h-11 w-full py-2 px-3 rounded-xl border border-bordure-champ bg-fond hover:bg-accent text-texte hover:text-sur-accent text-xs font-semibold flex items-center justify-center gap-2 transition-colors duration-150 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Courbes MM 50/200 · RSI · MACD</span>
                  </button>
                </HoverLiftCard>
              </StaggerCard>
            );
          })}
        </StaggerGrid>
      )}

      {/* Load More / Show All / Collapse Actions */}
      {(filteredStocks.length > visibleLimit || visibleLimit > defaultLimit) && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {filteredStocks.length > visibleLimit && (
            <>
              <button
                type="button"
                onClick={() =>
                  setVisibleLimit((prev) =>
                    Math.min(filteredStocks.length, prev + 18)
                  )
                }
                className="min-h-11 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Afficher plus d’actions (+
                {Math.min(18, filteredStocks.length - visibleLimit)} sur{' '}
                {filteredStocks.length - visibleLimit} restantes)
              </button>

              {filteredStocks.length - visibleLimit > 18 && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit(filteredStocks.length)}
                  className="min-h-11 px-4 py-2.5 rounded-xl border border-bordure-champ bg-surface hover:bg-surface-douce text-texte text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Tout afficher ({filteredStocks.length} actions)
                </button>
              )}
            </>
          )}

          {visibleLimit > defaultLimit && (
            <button
              type="button"
              onClick={() => setVisibleLimit(defaultLimit)}
              className="min-h-11 px-4 py-2.5 rounded-xl border border-bordure bg-fond hover:bg-surface text-texte-doux hover:text-texte text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Réduire à {defaultLimit} actions
            </button>
          )}
        </div>
      )}
    </ScrollReveal>
  );
};
