import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import * as d3 from 'd3';
import {
  ArrowUpDown,
  Check,
  History,
  Link2,
  Search,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  MacroIndicators,
  MARKET_REGIMES,
  RegimeId,
  RiskProfile,
} from '../../services/valoria/marketData';
import { PortfolioLot, PortfolioSummary } from '../../services/valoria/engine';
import {
  analyzeEquityUniverse,
  EquityActionSignal,
  EquityQuantAnalysis,
} from '../../services/valoria/equityQuantEngine';
import { MiniSparkline } from './MiniSparkline';
import {
  formatEur,
  formatPct,
  formatPriceEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';

interface EquitySignalsViewProps {
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  regimeId: RegimeId;
  riskProfile: RiskProfile;
  portfolioSummary: PortfolioSummary;
  watchlistIds: string[];
  onSelectRegime: (id: RegimeId) => void;
  onAddLot: (lot: Omit<PortfolioLot, 'id'>) => void;
  onExecuteRebalanceOrder: (assetId: string, deltaEuro: number) => void;
  onOpenBacktestForAsset: (assetId: string, purchaseYm: string, amount: number) => void;
  onOpenFinanceAIBridge: () => void;
}

type SignalFilter = 'all' | 'buy_only' | 'hold_only' | 'sell_only' | 'held' | 'watchlist';
type RegionFilter = 'all' | 'PEA' | 'CTO';
type SortField =
  | 'quantScore'
  | 'upsideDcfPct'
  | 'rewardRiskRatio'
  | 'roicPct'
  | 'peForwardAsc'
  | 'fcfYieldPct'
  | 'momentum6mPct'
  | 'rsi14Asc';

const SIGNAL_STYLES: Record<
  EquityActionSignal,
  { text: string; dotHex: string; glyph: string; btnClass: string }
> = {
  'ACHAT FORT': {
    text: 'text-succes-texte',
    dotHex: VALORIA_PALETTE.emerald,
    glyph: '▲▲',
    btnClass:
      'text-succes-texte bg-succes-fond border-succes-texte/40 hover:bg-succes-fond',
  },
  ACHETER: {
    text: 'text-succes-texte',
    dotHex: VALORIA_PALETTE.teal,
    glyph: '▲',
    btnClass: 'text-succes-texte bg-succes-fond border-succes-texte/40 hover:bg-succes-fond',
  },
  CONSERVER: {
    text: 'text-texte',
    dotHex: VALORIA_PALETTE.textSlate,
    glyph: '◆',
    btnClass: 'text-texte bg-surface-douce border-bordure-champ hover:bg-surface-douce',
  },
  ALLÉGER: {
    text: 'text-alerte-texte',
    dotHex: VALORIA_PALETTE.amberLight,
    glyph: '▼',
    btnClass: 'text-alerte-texte bg-alerte-fond border-alerte-texte/40 hover:bg-alerte-fond',
  },
  VENDRE: {
    text: 'text-erreur-texte',
    dotHex: VALORIA_PALETTE.rose,
    glyph: '▼▼',
    btnClass: 'text-erreur-texte bg-erreur-fond border-erreur-texte/40 hover:bg-erreur-fond',
  },
};

const SECTORS = [
  'Tous',
  'Tech & Semi-Conducteurs',
  'Industrie & Défense',
  'Luxe & Consommation',
  'Santé & Pharma',
  'Finance & Paiements',
  'Énergie & Matériaux',
] as const;

export const EquitySignalsView: React.FC<EquitySignalsViewProps> = ({
  livePrices,
  macro,
  regimeId,
  riskProfile,
  portfolioSummary,
  watchlistIds,
  onSelectRegime,
  onAddLot,
  onExecuteRebalanceOrder,
  onOpenBacktestForAsset,
  onOpenFinanceAIBridge,
}) => {
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [regionFilter, setRegionFilter] = useState<RegionFilter>('all');
  const [sectorFilter, setSectorFilter] = useState<string>('Tous');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('quantScore');
  const [orderAmountEur, setOrderAmountEur] = useState<number>(1000);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const universe = useMemo(
    () =>
      analyzeEquityUniverse({
        livePrices,
        macro,
        riskProfile,
        evaluatedLots: portfolioSummary.lots,
        totalPortfolioValue: portfolioSummary.totalCurrentValue,
      }),
    [livePrices, macro, riskProfile, portfolioSummary]
  );

  const [selectedStockId, setSelectedStockId] = useState<string>('GOOGL');

  const selectedStock: EquityQuantAnalysis = useMemo(() => {
    return (
      universe.allAnalyses.find((a) => a.asset.id === selectedStockId) ??
      universe.allAnalyses[0]
    );
  }, [universe.allAnalyses, selectedStockId]);

  const filteredStocks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = universe.allAnalyses.filter((item) => {
      if (signalFilter === 'buy_only' && item.signal !== 'ACHAT FORT' && item.signal !== 'ACHETER') {
        return false;
      }
      if (signalFilter === 'hold_only' && item.signal !== 'CONSERVER') {
        return false;
      }
      if (signalFilter === 'sell_only' && item.signal !== 'VENDRE' && item.signal !== 'ALLÉGER') {
        return false;
      }
      if (signalFilter === 'held' && !item.isHeld) {
        return false;
      }
      if (signalFilter === 'watchlist' && !watchlistIds.includes(item.asset.id)) {
        return false;
      }
      if (regionFilter !== 'all' && item.wrapperShort !== regionFilter) {
        return false;
      }
      if (sectorFilter !== 'Tous' && item.sector !== sectorFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.asset.ticker.toLowerCase().includes(q) ||
        item.asset.name.toLowerCase().includes(q) ||
        item.sector.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      switch (sortField) {
        case 'upsideDcfPct':
          return b.upsideDcfPct - a.upsideDcfPct;
        case 'rewardRiskRatio':
          return b.rewardRiskRatio - a.rewardRiskRatio;
        case 'roicPct':
          return b.roicPct - a.roicPct;
        case 'peForwardAsc':
          return a.peForward - b.peForward;
        case 'fcfYieldPct':
          return b.fcfYieldPct - a.fcfYieldPct;
        case 'momentum6mPct':
          return b.momentum6mPct - a.momentum6mPct;
        case 'rsi14Asc':
          return a.rsi14 - b.rsi14;
        case 'quantScore':
        default:
          return b.quantScore - a.quantScore;
      }
    });

    return list;
  }, [
    universe.allAnalyses,
    signalFilter,
    regionFilter,
    sectorFilter,
    searchQuery,
    sortField,
    watchlistIds,
  ]);

  // D3 Quadrant Matrix: X = Technical Timing Score (0..100), Y = DCF Valuation Upside (-35%..+35%)
  const quadrantSvgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svgEl = quadrantSvgRef.current;
    if (!svgEl) return;

    const width = 620;
    const height = 340;
    const margin = { top: 22, right: 24, bottom: 36, left: 48 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const x = d3.scaleLinear().domain([10, 95]).range([0, innerW]);
    const y = d3.scaleLinear().domain([-34, 32]).range([innerH, 0]);
    const rScale = d3.scaleLinear().domain([0, 50]).range([4.2, 8.5]).clamp(true);

    const g = svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Subtle Quadrant Tints
    const midX = x(52);
    const zeroY = y(0);

    // Top-Right: Strong Buy Quadrant (Undervalued + Positive Technicals)
    g.append('rect')
      .attr('x', midX)
      .attr('y', 0)
      .attr('width', innerW - midX)
      .attr('height', zeroY)
      .attr('fill', VALORIA_PALETTE.emerald)
      .attr('fill-opacity', 0.05);

    // Bottom-Left: Sell / Value Trap Quadrant (Overvalued + Bearish Technicals)
    g.append('rect')
      .attr('x', 0)
      .attr('y', zeroY)
      .attr('width', midX)
      .attr('height', innerH - zeroY)
      .attr('fill', VALORIA_PALETTE.rose)
      .attr('fill-opacity', 0.05);

    // Grid lines
    const yTicks = [-30, -15, 0, 15, 30];
    g.append('g')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerW)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', (d) => (d === 0 ? VALORIA_PALETTE.strokeSlate : VALORIA_PALETTE.gridSlate))
      .attr('stroke-width', (d) => (d === 0 ? 1.3 : 1))
      .attr('stroke-dasharray', (d) => (d === 0 ? '' : '3,3'));

    g.append('line')
      .attr('x1', midX)
      .attr('x2', midX)
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', VALORIA_PALETTE.axisSlate)
      .attr('stroke-dasharray', '4,3');

    // Quadrant Labels
    g.append('text')
      .attr('x', innerW - 6)
      .attr('y', 14)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.emeraldLight)
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .text('ZONE ACHAT FORT (Décote DCF + Momentum)');

    g.append('text')
      .attr('x', 6)
      .attr('y', innerH - 8)
      .attr('text-anchor', 'start')
      .attr('fill', VALORIA_PALETTE.roseLight)
      .attr('font-size', '9.5px')
      .attr('font-weight', '600')
      .text('ZONE VENTE / PIÈGE (Surcote + Baisse)');

    // Axes
    g.append('g')
      .selectAll('text')
      .data(yTicks)
      .join('text')
      .attr('x', -8)
      .attr('y', (d) => y(d) + 3.5)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-size', '9.5px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      .text((d) => `${d > 0 ? '+' : ''}${d}%`);

    const xTicks = [20, 40, 60, 80];
    g.append('g')
      .attr('transform', `translate(0,${innerH})`)
      .selectAll('text')
      .data(xTicks)
      .join('text')
      .attr('x', (d) => x(d))
      .attr('y', 16)
      .attr('text-anchor', 'middle')
      .attr('fill', VALORIA_PALETTE.textSlate)
      .attr('font-size', '9.5px')
      .attr('font-family', 'IBM Plex Mono, monospace')
      // NOMBRE-NON-MONETAIRE : graduation axe X score technique 0-100
      .text((d) => `${d}/100`);

    g.append('text')
      .attr('x', innerW)
      .attr('y', innerH + 30)
      .attr('text-anchor', 'end')
      .attr('fill', VALORIA_PALETTE.mutedSlate)
      .attr('font-size', '9.5px')
      .text('Score Timing Technique (RSI · MACD · MM12) →');

    // Selective non-overlapping ticker labels for extreme/selected/held stocks
    const placed: { px: number; py: number }[] = [];
    const labelSet = new Set<string>([
      selectedStock.asset.id,
      ...universe.topBuysNow.slice(0, 6).map((b) => b.asset.id),
      ...universe.topSellsNow.slice(0, 5).map((s) => s.asset.id),
      ...universe.allAnalyses.filter((a) => a.isHeld).map((a) => a.asset.id),
    ]);

    const nodes = g
      .append('g')
      .selectAll('g')
      .data(universe.allAnalyses)
      .join('g')
      .attr('transform', (d) => {
        const cx = x(Math.max(12, Math.min(93, d.pillars.technicals)));
        const cy = y(Math.max(-32, Math.min(30, d.upsideDcfPct)));
        return `translate(${cx},${cy})`;
      })
      .style('cursor', 'pointer')
      .on('click', (_e, d) => setSelectedStockId(d.asset.id));

    nodes
      .append('circle')
      .attr('r', (d) =>
        d.asset.id === selectedStock.asset.id
          ? rScale(d.roicPct) + 2.5
          : rScale(d.roicPct)
      )
      .attr('fill', (d) => SIGNAL_STYLES[d.signal].dotHex)
      .attr('fill-opacity', (d) =>
        d.asset.id === selectedStock.asset.id ? 0.98 : 0.78
      )
      .attr('stroke', (d) =>
        d.asset.id === selectedStock.asset.id
          ? VALORIA_PALETTE.surfaceIce
          : d.isHeld
            ? VALORIA_PALETTE.amberLight
            : VALORIA_PALETTE.bgNavy
      )
      .attr('stroke-width', (d) =>
        d.asset.id === selectedStock.asset.id ? 2.2 : d.isHeld ? 1.8 : 1
      );

    nodes.each(function (d) {
      if (!labelSet.has(d.asset.id)) return;
      const cx = x(Math.max(12, Math.min(93, d.pillars.technicals)));
      const cy = y(Math.max(-32, Math.min(30, d.upsideDcfPct)));
      const shortTicker = d.asset.ticker.split('.')[0];

      const offsets = [
        { dx: 10, dy: 3, anchor: 'start' },
        { dx: -10, dy: 3, anchor: 'end' },
        { dx: 10, dy: -8, anchor: 'start' },
        { dx: -10, dy: -8, anchor: 'end' },
        { dx: 0, dy: -11, anchor: 'middle' },
        { dx: 10, dy: 12, anchor: 'start' },
      ];
      let pick = offsets[0];
      let fits = false;
      for (const cand of offsets) {
        const lx =
          cx +
          (cand.anchor === 'end'
            ? -22
            : cand.anchor === 'middle'
              ? 0
              : 22);
        const ly = cy + cand.dy - 3;
        const hitsLabel = placed.some(
          (p) => Math.abs(p.px - lx) < 34 && Math.abs(p.py - ly) < 11
        );
        const hitsCircle = universe.allAnalyses.some((other) => {
          if (other.asset.id === d.asset.id) return false;
          const ox = x(Math.max(12, Math.min(93, other.pillars.technicals)));
          const oy = y(Math.max(-32, Math.min(30, other.upsideDcfPct)));
          const or = rScale(other.roicPct);
          return Math.abs(ox - lx) < or + 14 && Math.abs(oy - ly) < or + 5;
        });
        if (
          !hitsLabel &&
          !hitsCircle &&
          lx >= 14 &&
          lx <= innerW - 12 &&
          ly >= 8 &&
          ly <= innerH - 6
        ) {
          pick = cand;
          fits = true;
          break;
        }
      }
      if (!fits && d.asset.id !== selectedStock.asset.id) return;
      placed.push({
        px:
          cx +
          (pick.anchor === 'end'
            ? -22
            : pick.anchor === 'middle'
              ? 0
              : 22),
        py: cy + pick.dy - 3,
      });

      d3.select(this)
        .append('text')
        .attr('x', pick.dx)
        .attr('y', pick.dy)
        .attr('text-anchor', pick.anchor)
        .attr('fill', d.asset.id === selectedStock.asset.id ? VALORIA_PALETTE.white : VALORIA_PALETTE.textSlateLight)
        .attr('font-size', d.asset.id === selectedStock.asset.id ? '10px' : '9px')
        .attr('font-weight', d.asset.id === selectedStock.asset.id ? '700' : '500')
        .attr('font-family', 'IBM Plex Mono, monospace')
        .text(shortTicker);
    });
  }, [universe, selectedStock]);

  const handleQuickBuy = (stock: EquityQuantAnalysis, amount = orderAmountEur) => {
    onAddLot({
      assetId: stock.asset.id,
      investedAmount: amount,
      purchaseYearMonth: '2026-11',
    });
    setFeedbackMsg(
      `Ordre d’achat exécuté : ${stock.asset.ticker} (+${formatEur(amount, 0)} au spot ${formatPriceEur(stock.spotPrice)}).`
    );
  };

  const handleQuickSellOrTrim = (stock: EquityQuantAnalysis, fullExit = false) => {
    if (!stock.isHeld || stock.heldValueEur <= 0) return;
    const sellAmt = fullExit
      ? stock.heldValueEur
      : Math.max(100, Math.round(stock.heldValueEur * 0.5));
    onExecuteRebalanceOrder(stock.asset.id, -sellAmt);
    setFeedbackMsg(
      `Ordre de vente exécuté : ${stock.asset.ticker} (-${formatEur(sellAmt, 0)}).`
    );
  };

  const selStyle = SIGNAL_STYLES[selectedStock.signal];

  return (
    <div className="space-y-6">
      {/* Toolbar Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-4 border-b border-bordure">
        <div>
          <p className="text-xs font-medium text-texte-doux mb-0.5">
            {universe.totalStocks} actions cotées (TSX Canada · S&amp;P 500 / Nasdaq · Europe CELI) · 22 calculs fondamentaux &amp; techniques en direct
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-texte">
            Scanner Quantitatif d’Actions — Acheter ou Vendre Maintenant
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-bordure rounded-md text-xs">
            <SlidersHorizontal className="w-3.5 h-3.5 text-texte-doux" />
            <label htmlFor="equity-regime-select" className="text-texte-doux">
              Régime :
            </label>
            <select
              id="equity-regime-select"
              value={regimeId}
              onChange={(e) => onSelectRegime(e.target.value as RegimeId)}
              className="min-h-11 bg-transparent text-texte font-medium outline-hidden focus-ring cursor-pointer"
            >
              {MARKET_REGIMES.map((r) => (
                <option key={r.id} value={r.id} className="bg-surface">
                  {r.shortLabel}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={onOpenFinanceAIBridge}
            className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Combiner avec FinanceAI</span>
          </button>
        </div>
      </div>

      {/* 5-Column Quantitative Universe Summary Strip */}
      <section
        aria-label="Synthèse des signaux actions"
        className="bg-surface border border-bordure rounded-lg grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 sm:divide-x divide-bordure"
      >
        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">Univers analysé en direct</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-texte">
            {universe.totalStocks} actions
          </div>
          <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-1">
            {universe.allAnalyses.filter((a) => a.wrapperShort === 'PEA').length} Admissibles CELI/EU ·{' '}
            {universe.allAnalyses.filter((a) => a.wrapperShort === 'CTO').length} REER Global/US
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">À prendre maintenant</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-succes-texte">
            ▲ {universe.strongBuyCount + universe.buyCount} titres
          </div>
          <div className="text-[11px] text-texte font-mono tabular-nums mt-1">
            {universe.strongBuyCount} Achat Fort · {universe.buyCount} Acheter
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">À vendre / éviter maintenant</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-erreur-texte">
            ▼ {universe.sellCount + universe.trimCount} titres
          </div>
          <div className="text-[11px] text-texte font-mono tabular-nums mt-1">
            {universe.sellCount} Vendre · {universe.trimCount} Alléger
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] text-texte-doux mb-1">Potentiel moyen Top Achats</div>
          <div className="text-xl font-semibold font-mono tabular-nums text-succes-texte">
            {formatSignedPct(universe.avgTopBuyUpsidePct, 1)}
          </div>
          <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-1 whitespace-nowrap">
            WACC ajusté ({formatPct(macro.centralBankRatePct, 2)} BdC/Fed)
          </div>
        </div>

        <div className="p-4 col-span-2 lg:col-span-1">
          <div className="text-[11px] text-texte-doux mb-1">Audit actions en portefeuille</div>
          <div
            className={`text-xl font-semibold font-mono tabular-nums ${
              universe.heldSellAlerts.length > 0 ? 'text-alerte-texte' : 'text-succes-texte'
            }`}
          >
            {universe.heldSellAlerts.length > 0
              ? `▼ ${universe.heldSellAlerts.length} à vendre`
              : '▲ 0 alerte vente'}
          </div>
          <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-1">
            Ticket rapide :{' '}
            <select
              aria-label="Montant par ordre rapide"
              value={orderAmountEur}
              onChange={(e) => setOrderAmountEur(Number(e.target.value))}
              className="min-h-11 bg-fond border border-bordure-champ rounded-sm px-1.5 py-0.5 text-texte"
            >
              <option value={500}>500 $</option>
              <option value={1000}>1 000 $</option>
              <option value={2500}>2 500 $</option>
              <option value={5000}>5 000 $</option>
            </select>
          </div>
        </div>
      </section>

      {feedbackMsg && (
        <div
          role="status"
          className="flex items-center justify-between gap-2 px-4 py-2.5 text-xs font-medium text-succes-texte bg-succes-fond border border-succes-texte/40 rounded-md"
        >
          <span className="inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-succes-texte shrink-0" />
            {feedbackMsg}
          </span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="min-h-11 text-texte-doux hover:text-texte cursor-pointer"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Held-Portfolio Urgent Sell Alert Strip (Triggered automatically if portfolio holds weak stocks) */}
      {universe.heldSellAlerts.length > 0 && (
        <section
          aria-label="Alertes de vente sur actions détenues"
          className="bg-erreur-fond border border-erreur-texte/40 rounded-lg p-4 space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-erreur-texte">
              ▼ Audit Portefeuille / FinanceAI : {universe.heldSellAlerts.length} action(s) détenue(s) présentent un signal de sortie immédiat
            </span>
            <span className="text-texte-doux font-mono">
              ROIC &lt; WACC, F-Score dégradé ou surcote DCF
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {universe.heldSellAlerts.map((st) => (
              <div
                key={st.asset.id}
                className="bg-fond/90 border border-bordure rounded-sm p-3 flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-texte truncate">
                    {st.asset.ticker} · {st.asset.name.split(' (')[0]}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-texte-doux mt-0.5">
                    {/* NOMBRE-NON-MONETAIRE : score quantitatif et décote DCF d'actif public */}
                    Score {st.quantScore}/100 · DCF {formatSignedPct(st.upsideDcfPct, 1)} · Détenu{' '}
                    <PrivateAmount>{formatEur(st.heldValueEur, 0)}</PrivateAmount>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleQuickSellOrTrim(st, st.signal === 'VENDRE')}
                  className="min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-mono font-semibold text-erreur-texte bg-erreur-fond border border-erreur-texte/40 hover:bg-erreur-fond rounded-sm whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {st.signal === 'VENDRE'
                    ? `Vendre -${formatEur(st.heldValueEur, 0)}`
                    : `Alléger 50 %`}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Immediate Action Radar: Top 5 BUY NOW vs Top 5 SELL NOW */}
      <section
        aria-label="Radar tactique achats et ventes immédiats"
        className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch"
      >
        {/* Left: Top 5 Actions à Prendre Maintenant */}
        <div className="bg-surface border border-bordure rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-bordure">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="w-4 h-4 text-succes-texte shrink-0" />
              <h2 className="text-sm font-semibold text-texte truncate">
                Top Convictions — Actions à Prendre
              </h2>
            </div>
            <span className="text-[11px] font-mono text-succes-texte whitespace-nowrap shrink-0">
              Décote DCF · ROIC · Momentum
            </span>
          </div>

          <div className="divide-y divide-bordure">
            {universe.topBuysNow.slice(0, 5).map((st) => (
              <div
                key={st.asset.id}
                className="py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setSelectedStockId(st.asset.id)}
                  className="min-h-11 text-left min-w-0 flex-1 group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-succes-texte">
                      {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                      {st.quantScore}/100
                    </span>
                    <span className="font-semibold text-texte group-hover:text-succes-texte truncate">
                      {st.asset.ticker} · {st.asset.name.split(' (')[0]}
                    </span>
                    <span className="text-[11px] text-texte-doux shrink-0">
                      · {st.wrapperShort}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-texte-doux mt-0.5 truncate">
                    {formatPriceEur(st.spotPrice)} →{' '}
                    <strong className="text-texte">
                      {formatPriceEur(st.targetPrice12mEur)}
                    </strong>{' '}
                    ({formatSignedPct(st.targetReturn12mPct, 1)}) · PER {st.peForward}x · R/R{' '}
                    {st.rewardRiskRatio}x
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => handleQuickBuy(st)}
                  className="min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-mono tabular-nums font-semibold text-succes-texte bg-succes-fond border border-succes-texte/40 hover:bg-succes-fond rounded-sm whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Acheter +{formatEur(orderAmountEur, 0)}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Top 5 Actions à Vendre ou Éviter Maintenant */}
        <div className="bg-surface border border-bordure rounded-lg p-5 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-bordure">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingDown className="w-4 h-4 text-erreur-texte shrink-0" />
              <h2 className="text-sm font-semibold text-texte truncate">
                Signaux de Sortie — Actions à Vendre
              </h2>
            </div>
            <span className="text-[11px] font-mono text-erreur-texte whitespace-nowrap shrink-0">
              Surcote DCF · FCF &lt; 0 · Baissier
            </span>
          </div>

          <div className="divide-y divide-bordure">
            {universe.topSellsNow.slice(0, 5).map((st) => (
              <div
                key={st.asset.id}
                className="py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <button
                  type="button"
                  onClick={() => setSelectedStockId(st.asset.id)}
                  className="min-h-11 text-left min-w-0 flex-1 group cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-erreur-texte">
                      {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                      {st.quantScore}/100
                    </span>
                    <span className="font-semibold text-texte group-hover:text-erreur-texte truncate">
                      {st.asset.ticker} · {st.asset.name.split(' (')[0]}
                    </span>
                    <span className="text-[11px] text-texte-doux shrink-0">
                      · F-Score {st.piotroskiFScore}/9
                    </span>
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-texte-doux mt-0.5 truncate">
                    Spot {formatPriceEur(st.spotPrice)} vs DCF{' '}
                    <strong className="text-erreur-texte">
                      {formatPriceEur(st.intrinsicValueDcfEur)}
                    </strong>{' '}
                    ({formatSignedPct(st.upsideDcfPct, 1)}) · Dette {st.netDebtToEbitda}x ·{' '}
                    {st.trendRegime}
                  </div>
                </button>

                {st.isHeld ? (
                  <button
                    type="button"
                    onClick={() => handleQuickSellOrTrim(st, true)}
                    className="min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-mono tabular-nums font-semibold text-erreur-texte bg-erreur-fond border border-erreur-texte/40 hover:bg-erreur-fond rounded-sm whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Vendre -{formatEur(st.heldValueEur, 0)}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSelectedStockId(st.asset.id)}
                    className="min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-mono text-erreur-texte bg-fond border border-bordure hover:border-erreur-texte/60 rounded-sm whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {st.signal}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Analytical Core: Left D3 Quadrant (7 cols) + Right 22-Metric Deep Stock Sheet (5 cols) */}
      <section
        aria-label="Matrice D3 et fiche quantitative détaillée"
        className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
      >
        {/* Left: D3 Valuation vs Technical Timing Matrix */}
        <div className="lg:col-span-7 bg-surface border border-bordure rounded-lg p-5 flex flex-col justify-between space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-texte">
                Matrice Multi-Facteurs D3.js (Décote DCF × Timing Technique)
              </h2>
              <p className="text-xs text-texte-doux">
                Cliquez sur une bulle pour ouvrir ses 22 ratios · Taille = ROIC · Cercle ambre = détenu en portefeuille
              </p>
            </div>
            <span className="text-xs font-mono text-succes-texte">
              {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif sélectionné */}
              Sélection : {selectedStock.asset.ticker} ({selectedStock.quantScore}/100)
            </span>
          </div>

          <div className="w-full">
            <svg
              ref={quadrantSvgRef}
              className="w-full h-auto"
              role="img"
              aria-label={`Matrice D3 croisant la décote DCF et le score technique des ${universe.totalStocks} actions`}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-bordure text-[11px] text-texte-doux">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-succes-texte" />
                Achat Fort
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent" />
                Acheter
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-texte-doux" />
                Conserver
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-alerte-texte" />
                Alléger
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-erreur-texte" />
                Vendre
              </span>
            </div>
            <span className="font-mono tabular-nums text-texte">
              WACC moyen : {formatPct(selectedStock.waccPct, 1)}
            </span>
          </div>
        </div>

        {/* Right: 22-Metric Deep Institutional Stock Inspector */}
        <aside
          aria-label="Fiche quantitative détaillée de l'action sélectionnée"
          className="lg:col-span-5 bg-surface border border-bordure rounded-lg p-5 flex flex-col justify-between space-y-4"
        >
          <div className="space-y-3">
            {/* Stock Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-bordure">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className={`font-bold ${selStyle.text}`}>
                    {/* NOMBRE-NON-MONETAIRE : signal et score quantitatif d'actif public */}
                    {selStyle.glyph} {selectedStock.signal} · {selectedStock.quantScore}/100
                  </span>
                  <span className="text-texte-doux">·</span>
                  <span className="text-texte">{selectedStock.wrapperShort}</span>
                </div>
                <h2 className="text-base font-bold text-texte mt-0.5 truncate">
                  {selectedStock.asset.ticker} — {selectedStock.asset.name.split(' (')[0]}
                </h2>
                <p className="text-[11px] text-texte-doux mt-0.5">
                  {selectedStock.catalystHeadline}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-bold font-mono tabular-nums text-texte">
                  {formatPriceEur(selectedStock.spotPrice)}
                </div>
                <MiniSparkline
                  values={selectedStock.sparkline24m}
                  width={84}
                  height={24}
                />
              </div>
            </div>

            {/* Trade Execution Price Ladder */}
            <div className="p-3 bg-fond border border-bordure rounded-sm grid grid-cols-4 gap-2 text-[11px] font-mono tabular-nums">
              <div>
                <span className="text-texte-doux block font-sans">Stop (2×ATR)</span>
                <span className="text-erreur-texte font-semibold">
                  {formatPriceEur(selectedStock.stopLossEur)}
                </span>
                <span className="block text-[10px] text-texte-doux">
                  {formatSignedPct(selectedStock.stopDistancePct, 1)}
                </span>
              </div>
              <div>
                <span className="text-texte-doux block font-sans">Zone entrée</span>
                <span className="text-texte font-semibold">
                  {formatPriceEur(selectedStock.entryZoneLowEur)}
                </span>
                <span className="block text-[10px] text-texte-doux">Spot -2,5%</span>
              </div>
              <div>
                <span className="text-texte-doux block font-sans">Cible 12M</span>
                <span
                  className={`font-semibold ${
                    selectedStock.targetReturn12mPct >= 0
                      ? 'text-succes-texte'
                      : 'text-erreur-texte'
                  }`}
                >
                  {formatPriceEur(selectedStock.targetPrice12mEur)}
                </span>
                <span className="block text-[10px] text-texte-doux">
                  {formatSignedPct(selectedStock.targetReturn12mPct, 1)}
                </span>
              </div>
              <div>
                <span className="text-texte-doux block font-sans">Gain / Risque</span>
                <span className="text-succes-texte font-semibold">
                  {selectedStock.rewardRiskRatio.toFixed(2).replace('.', ',')}x
                </span>
                <span className="block text-[10px] text-texte-doux">
                  Conv. {selectedStock.convictionPct}%
                </span>
              </div>
            </div>

            {/* 5-Pillar Horizontal Bars */}
            <div className="grid grid-cols-5 gap-2 text-[10px] font-mono tabular-nums">
              {(
                [
                  { label: 'Valeur', val: selectedStock.pillars.valuation },
                  { label: 'Qualité', val: selectedStock.pillars.quality },
                  { label: 'Croiss.', val: selectedStock.pillars.growth },
                  { label: 'Timing', val: selectedStock.pillars.technicals },
                  { label: 'Macro', val: selectedStock.pillars.macroFit },
                ] as const
              ).map((p) => (
                <div key={p.label} className="space-y-1">
                  <div className="flex justify-between text-texte-doux">
                    <span>{p.label}</span>
                    <span className="text-texte">{p.val}</span>
                  </div>
                  <div className="h-1.5 bg-fond rounded-sm overflow-hidden">
                    {/* NOMBRE-NON-MONETAIRE : jauge de pilier fondamental d'actif public */}
                    <div
                      style={{ width: `${p.val}%` }}
                      className={
                        p.val >= 68
                          ? 'h-full bg-accent'
                          : p.val >= 48
                            ? 'h-full bg-accent'
                            : 'h-full bg-erreur-texte'
                      }
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* 18-Metric Dense Institutional Matrix */}
            <div className="grid grid-cols-3 gap-2 text-[10.5px] font-mono tabular-nums pt-1">
              <div className="p-2 bg-fond/80 border border-bordure rounded-sm space-y-1">
                <div className="font-sans text-[10px] font-semibold text-texte-doux pb-0.5 border-b border-bordure">
                  Valorisation
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">DCF</span>
                  <span className="text-texte">
                    {formatPriceEur(selectedStock.intrinsicValueDcfEur)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">Marge</span>
                  <span
                    className={
                      selectedStock.upsideDcfPct >= 0
                        ? 'text-succes-texte'
                        : 'text-erreur-texte'
                    }
                  >
                    {formatSignedPct(selectedStock.upsideDcfPct, 1)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">PER 12M</span>
                  <span className="text-texte">{selectedStock.peForward}x</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">PEG</span>
                  <span className="text-texte">{selectedStock.pegRatio}x</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">EV/EBIT.</span>
                  <span className="text-texte">{selectedStock.evEbitda}x</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">FCF Yld</span>
                  <span
                    className={
                      selectedStock.fcfYieldPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                    }
                  >
                    {formatPct(selectedStock.fcfYieldPct, 1)}
                  </span>
                </div>
              </div>

              <div className="p-2 bg-fond/80 border border-bordure rounded-sm space-y-1">
                <div className="font-sans text-[10px] font-semibold text-texte-doux pb-0.5 border-b border-bordure">
                  Qualité &amp; Bilan
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">ROIC</span>
                  <span className="text-texte">{formatPct(selectedStock.roicPct, 1)}</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">Écart K</span>
                  <span
                    className={
                      selectedStock.roicWaccSpreadPct >= 0
                        ? 'text-succes-texte'
                        : 'text-erreur-texte'
                    }
                  >
                    {formatSignedPct(selectedStock.roicWaccSpreadPct, 1)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">Mg EBIT</span>
                  <span className="text-texte">
                    {formatPct(selectedStock.operatingMarginPct, 1)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">BPA N+1</span>
                  <span
                    className={
                      selectedStock.epsGrowthNextYrPct >= 0
                        ? 'text-succes-texte'
                        : 'text-erreur-texte'
                    }
                  >
                    {formatSignedPct(selectedStock.epsGrowthNextYrPct, 1)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">Dette/EB</span>
                  <span className="text-texte">{selectedStock.netDebtToEbitda}x</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">F-Sc / Z</span>
                  <span className="text-succes-texte">
                    {selectedStock.piotroskiFScore}/9 · {selectedStock.altmanZScore}
                  </span>
                </div>
              </div>

              <div className="p-2 bg-fond/80 border border-bordure rounded-sm space-y-1">
                <div className="font-sans text-[10px] font-semibold text-texte-doux pb-0.5 border-b border-bordure">
                  Timing &amp; Risque
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">RSI-14</span>
                  <span className="text-texte">{selectedStock.rsi14}</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">MACD H.</span>
                  <span
                    className={
                      selectedStock.macdHistogram >= 0
                        ? 'text-succes-texte'
                        : 'text-erreur-texte'
                    }
                  >
                    {selectedStock.macdHistogram >= 0 ? '+' : ''}
                    {selectedStock.macdHistogram}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">Boll %B</span>
                  <span className="text-texte">{selectedStock.bollingerPctB}%</span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">Éc. MM12</span>
                  <span className="text-texte">
                    {formatSignedPct(selectedStock.sma12GapPct, 1)}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">β / Sh.</span>
                  <span className="text-texte">
                    {selectedStock.betaVsWorld} · {selectedStock.sharpeRatio}
                  </span>
                </div>
                <div className="flex justify-between gap-1 whitespace-nowrap">
                  <span className="text-texte-doux">VaR 95%</span>
                  <span className="text-erreur-texte">
                    -{formatPct(selectedStock.monthlyVar95Pct, 1)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Direct Execution Bar */}
          <div className="flex items-center gap-2 pt-2 border-t border-bordure">
            <button
              type="button"
              onClick={() => handleQuickBuy(selectedStock)}
              className="min-h-11 flex-1 py-2 px-3 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              Acheter +{formatEur(orderAmountEur, 0)}
            </button>
            {selectedStock.isHeld && (
              <button
                type="button"
                onClick={() => handleQuickSellOrTrim(selectedStock, false)}
                className="min-h-11 py-2 px-3 text-xs font-semibold text-erreur-texte bg-erreur-fond border border-erreur-texte/40 hover:bg-erreur-fond rounded-md transition-colors whitespace-nowrap cursor-pointer"
              >
                Alléger / Vendre
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onOpenBacktestForAsset(selectedStock.asset.id, '2020-01', orderAmountEur)
              }
              className="min-h-11 py-2 px-3 text-xs font-medium text-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-md transition-colors whitespace-nowrap cursor-pointer"
            >
              Backtest
            </button>
          </div>
        </aside>
      </section>

      {/* Full Quantitative Screener Table */}
      <section
        aria-label={`Tableau complet des ${universe.totalStocks} actions et signaux quantitatifs`}
        className="bg-surface border border-bordure rounded-lg overflow-hidden"
      >
        <div className="p-4 border-b border-bordure space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            {/* Signal Filter Tabs */}
            <div
              role="group"
              aria-label="Filtrer par signal d'action"
              className="flex flex-wrap items-center gap-1 p-1 bg-fond border border-bordure rounded-md"
            >
              {(
                [
                  { id: 'all', label: `Toutes (${universe.totalStocks})` },
                  {
                    id: 'buy_only',
                    label: `À Acheter (${universe.strongBuyCount + universe.buyCount})`,
                  },
                  { id: 'hold_only', label: `Conserver (${universe.holdCount})` },
                  {
                    id: 'sell_only',
                    label: `À Vendre / Alléger (${universe.sellCount + universe.trimCount})`,
                  },
                  {
                    id: 'held',
                    label: `Détenues (${universe.allAnalyses.filter((a) => a.isHeld).length})`,
                  },
                  ...(watchlistIds.length > 0
                    ? [{ id: 'watchlist' as const, label: `Watchlist FinanceAI (${watchlistIds.length})` }]
                    : []),
                ] as const
              ).map((t) => (
                <button aria-pressed={Boolean(signalFilter === t.id)}
                  key={t.id}
                  type="button"
                  onClick={() => setSignalFilter(t.id)}
                  className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    signalFilter === t.id
                      ? 'bg-surface-douce text-texte'
                      : 'text-texte-doux hover:text-texte'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Search + Region + Sort */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="group"
                aria-label="Filtrer par enveloppe CELI ou REER"
                className="inline-flex p-0.5 bg-fond border border-bordure rounded-md text-xs"
              >
                {(['all', 'PEA', 'CTO'] as const).map((reg) => (
                  <button
                    key={reg}
                    type="button"
                    aria-pressed={regionFilter === reg}
                    onClick={() => setRegionFilter(reg)}
                    className={`min-w-11 min-h-11 px-2.5 py-1 rounded-sm font-medium cursor-pointer ${
                      regionFilter === reg
                        ? 'bg-surface-douce text-succes-texte'
                        : 'text-texte-doux hover:text-texte'
                    }`}
                  >
                    {reg === 'all' ? 'CELI + REER' : reg === 'PEA' ? 'CELI / EU' : 'REER / Global'}
                  </button>
                ))}
              </div>

              <select
                aria-label="Filtrer par secteur"
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="min-h-11 px-2.5 py-1.5 text-xs bg-fond border border-bordure rounded-md text-texte"
              >
                {SECTORS.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec === 'Tous' ? 'Tous secteurs' : sec}
                  </option>
                ))}
              </select>

              <div className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-fond border border-bordure rounded-md text-xs">
                <ArrowUpDown className="w-3.5 h-3.5 text-texte-doux" />
                <select
                  aria-label="Trier les actions"
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as SortField)}
                  className="min-h-11 bg-transparent text-texte outline-hidden focus-ring cursor-pointer"
                >
                  <option value="quantScore" className="bg-surface">
                    Tri : Score Quant (/100)
                  </option>
                  <option value="upsideDcfPct" className="bg-surface">
                    Tri : Décote DCF (%)
                  </option>
                  <option value="rewardRiskRatio" className="bg-surface">
                    Tri : Ratio Gain/Risque
                  </option>
                  <option value="roicPct" className="bg-surface">
                    Tri : ROIC (%)
                  </option>
                  <option value="peForwardAsc" className="bg-surface">
                    Tri : PER le plus bas
                  </option>
                  <option value="fcfYieldPct" className="bg-surface">
                    Tri : FCF Yield (%)
                  </option>
                  <option value="momentum6mPct" className="bg-surface">
                    Tri : Momentum 6M
                  </option>
                  <option value="rsi14Asc" className="bg-surface">
                    Tri : RSI-14 survendu
                  </option>
                </select>
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-texte-doux absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  aria-label="Rechercher un ticker ou une société"
                  placeholder="Ticker, nom, secteur..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="min-h-11 pl-8 pr-3 py-1.5 text-xs bg-fond border border-bordure rounded-md text-texte placeholder:text-texte-doux w-44 outline-hidden focus-ring focus:border-accent"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-bordure bg-fond/60 text-[11px] font-semibold text-texte-doux">
                <th className="py-2.5 px-3">Action &amp; Enveloppe</th>
                <th className="py-2.5 px-2">Signal</th>
                <th className="py-2.5 px-1.5">24M</th>
                <th className="py-2.5 px-2.5 text-right">Spot → DCF</th>
                <th className="py-2.5 px-2.5 text-right">PER · PEG · FCF</th>
                <th className="py-2.5 px-2.5 text-right">ROIC · Bilan</th>
                <th className="py-2.5 px-2.5 text-right">RSI · MACD · 6M</th>
                <th className="py-2.5 px-2.5 text-right">Stop / R:R</th>
                <th className="py-2.5 px-3 text-right">Ordre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bordure text-[11.5px]">
              {filteredStocks.map((st) => {
                const sig = SIGNAL_STYLES[st.signal];
                const isSelected = st.asset.id === selectedStock.asset.id;
                return (
                  <tr
                    key={st.asset.id}
                    onClick={() => setSelectedStockId(st.asset.id)}
                    className={`transition-colors cursor-pointer ${
                      isSelected ? 'bg-surface-douce/70' : 'hover:bg-surface-douce/40'
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-texte truncate max-w-[185px]">
                        {st.asset.name.split(' (')[0]}
                      </div>
                      <div className="text-[10.5px] text-texte-doux flex items-center gap-1 mt-0.5 whitespace-nowrap">
                        <span className="font-mono text-texte">{st.asset.ticker}</span>
                        <span aria-hidden="true">·</span>
                        <span>{st.wrapperShort}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[92px]">{st.sector}</span>
                        {st.isHeld && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-alerte-texte font-mono">
                              {formatEur(st.heldValueEur, 0)}
                            </span>
                          </>
                        )}
                      </div>
                    </td>

                    <td className="py-2.5 px-2 whitespace-nowrap font-mono tabular-nums">
                      <div className={`font-bold ${sig.text}`}>
                        {sig.glyph} {st.signal}
                      </div>
                      <div className="text-[10.5px] text-texte-doux">
                        {/* NOMBRE-NON-MONETAIRE : score quantitatif dans le tableau public */}
                        Score <strong className="text-texte">{st.quantScore}</strong>/100
                      </div>
                    </td>

                    <td className="py-2.5 px-1.5">
                      <MiniSparkline values={st.sparkline24m} width={58} height={20} />
                    </td>

                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-texte">
                        {formatPriceEur(st.spotPrice)} →{' '}
                        <strong>{formatPriceEur(st.intrinsicValueDcfEur)}</strong>
                      </div>
                      <div
                        className={
                          st.upsideDcfPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                        }
                      >
                        DCF {formatSignedPct(st.upsideDcfPct, 1)}
                      </div>
                    </td>

                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-texte">
                        {st.peForward}x · PEG {st.pegRatio}x
                      </div>
                      <div className="text-[10.5px] text-texte-doux">
                        FCF {formatPct(st.fcfYieldPct, 1)} · Div {formatPct(st.dividendYieldPct, 1)}
                      </div>
                    </td>

                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <div
                        className={
                          st.roicWaccSpreadPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                        }
                      >
                        ROIC {formatPct(st.roicPct, 1)}
                      </div>
                      <div className="text-[10.5px] text-texte-doux">
                        F {st.piotroskiFScore}/9 · Dette {st.netDebtToEbitda}x
                      </div>
                    </td>

                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-texte">
                        RSI {st.rsi14} · {st.macdLabel}
                      </div>
                      <div
                        className={`text-[10.5px] ${
                          st.momentum6mPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                        }`}
                      >
                        6M {formatSignedPct(st.momentum6mPct, 1)}
                      </div>
                    </td>

                    <td className="py-2.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <div className="text-succes-texte font-semibold">
                        R/R {st.rewardRiskRatio.toFixed(1).replace('.', ',')}x
                      </div>
                      <div className="text-[10.5px] text-texte-doux">
                        Stop {formatPriceEur(st.stopLossEur)}
                      </div>
                    </td>

                    <td
                      className="py-2.5 px-3 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="inline-flex items-center gap-1">
                        {st.isHeld && (st.signal === 'VENDRE' || st.signal === 'ALLÉGER') ? (
                          <button
                            type="button"
                            onClick={() => handleQuickSellOrTrim(st, st.signal === 'VENDRE')}
                            className={`min-h-11 min-w-11 px-2 py-1 text-[10.5px] font-mono font-semibold rounded-sm border cursor-pointer ${sig.btnClass}`}
                          >
                            Vendre
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleQuickBuy(st)}
                            className="min-h-11 min-w-11 px-2 py-1 text-[10.5px] font-mono font-semibold text-succes-texte bg-succes-fond border border-succes-texte/40 hover:bg-succes-fond rounded-sm cursor-pointer"
                          >
                            +{formatEur(orderAmountEur, 0)}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            onOpenBacktestForAsset(st.asset.id, '2020-01', orderAmountEur)
                          }
                          aria-label={`Backtest ${st.asset.ticker}`}
                          className="min-h-11 min-w-11 p-1 text-texte-doux hover:text-succes-texte hover:bg-surface-douce rounded-sm cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredStocks.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-texte-doux">
                    Aucune action ne correspond à ce filtre.{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setSignalFilter('all');
                        setRegionFilter('all');
                        setSectorFilter('Tous');
                        setSearchQuery('');
                      }}
                      className="min-h-11 text-succes-texte hover:underline cursor-pointer"
                    >
                      Réinitialiser les filtres
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
