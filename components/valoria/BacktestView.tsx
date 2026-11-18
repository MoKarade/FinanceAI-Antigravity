import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { BookmarkPlus, Trash2, Plus } from 'lucide-react';
import { ASSETS, HISTORICAL_SERIES } from '../../services/valoria/marketData';
import {
  BacktestResult,
  PortfolioLot,
  runHistoricalBacktest,
} from '../../services/valoria/engine';
import { computeCalendarYearReturns } from '../../services/valoria/quantAnalytics';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

export interface SavedScenario {
  id: string;
  assetId: string;
  assetName: string;
  mode: 'lump_sum' | 'dca';
  amount: number;
  startYearMonth: string;
  endYearMonth: string;
  periodLabel: string;
  totalInvested: number;
  finalValue: number;
  roiPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
}

interface BacktestViewProps {
  initialAssetId: string;
  initialStartYm: string;
  initialAmount: number;
  onAddLotToPortfolio: (lot: Omit<PortfolioLot, 'id'>) => void;
}

const INITIAL_SAVED: SavedScenario[] = [
  (() => {
    const r = runHistoricalBacktest({
      assetId: 'XEQT',
      startYearMonth: '2020-01',
      endYearMonth: '2026-11',
      mode: 'lump_sum',
      amount: 5000,
    });
    return {
      id: 'seed-1',
      assetId: 'XEQT',
      assetName: r.asset.name,
      mode: 'lump_sum',
      amount: 5000,
      startYearMonth: '2020-01',
      endYearMonth: '2026-11',
      periodLabel: `${r.startLabel} → ${r.endLabel}`,
      totalInvested: r.totalInvested,
      finalValue: r.finalValue,
      roiPct: r.roiPct,
      cagrPct: r.cagrPct,
      maxDrawdownPct: r.maxDrawdownPct,
    };
  })(),
  (() => {
    const r = runHistoricalBacktest({
      assetId: 'GOVT',
      startYearMonth: '2021-11',
      endYearMonth: '2026-11',
      mode: 'lump_sum',
      amount: 5000,
    });
    return {
      id: 'seed-2',
      assetId: 'GOVT',
      assetName: r.asset.name,
      mode: 'lump_sum',
      amount: 5000,
      startYearMonth: '2021-11',
      endYearMonth: '2026-11',
      periodLabel: `${r.startLabel} → ${r.endLabel}`,
      totalInvested: r.totalInvested,
      finalValue: r.finalValue,
      roiPct: r.roiPct,
      cagrPct: r.cagrPct,
      maxDrawdownPct: r.maxDrawdownPct,
    };
  })(),
];

export const BacktestView: React.FC<BacktestViewProps> = ({
  initialAssetId,
  initialStartYm,
  initialAmount,
  onAddLotToPortfolio,
}) => {
  const [assetId, setAssetId] = useState<string>(initialAssetId || 'XEQT');
  const [mode, setMode] = useState<'lump_sum' | 'dca'>('lump_sum');
  const [startYm, setStartYm] = useState<string>(initialStartYm || '2020-01');
  const [endYm, setEndYm] = useState<string>('2026-11');
  const [amountStr, setAmountStr] = useState<string>(String(initialAmount || 3000));
  const [chartTab, setChartTab] = useState<'equity' | 'annual' | 'drawdown'>('equity');
  const [savedScenarios, setSavedScenarios] = useState<SavedScenario[]>(INITIAL_SAVED);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  React.useEffect(() => {
    if (initialAssetId) setAssetId(initialAssetId);
    if (initialStartYm) setStartYm(initialStartYm);
    if (initialAmount > 0) setAmountStr(String(initialAmount));
  }, [initialAssetId, initialStartYm, initialAmount]);

  const simulationState = useMemo((): {
    result: BacktestResult | null;
    error: string | null;
  } => {
    const parsed = Number(amountStr.replace(',', '.'));
    if (!amountStr.trim() || !Number.isFinite(parsed) || parsed <= 0) {
      return {
        result: null,
        error: 'Montant requis (> 0 $ CAD).',
      };
    }
    try {
      const res = runHistoricalBacktest({
        assetId,
        startYearMonth: startYm,
        endYearMonth: endYm,
        mode,
        amount: parsed,
      });
      return { result: res, error: null };
    } catch (e: unknown) {
      return {
        result: null,
        error: e instanceof Error ? e.message : 'Paramètres invalides.',
      };
    }
  }, [assetId, startYm, endYm, mode, amountStr]);

  const { result, error } = simulationState;

  const annualBars = useMemo(
    () => computeCalendarYearReturns(assetId, startYm, endYm),
    [assetId, startYm, endYm]
  );

  const handleSaveScenario = () => {
    if (!result) return;
    const item: SavedScenario = {
      id: `sim-${Date.now()}`,
      assetId: result.asset.id,
      assetName: result.asset.name,
      mode: result.mode,
      amount: result.amount,
      startYearMonth: startYm,
      endYearMonth: endYm,
      periodLabel: `${result.startLabel} → ${result.endLabel}`,
      totalInvested: result.totalInvested,
      finalValue: result.finalValue,
      roiPct: result.roiPct,
      cagrPct: result.cagrPct,
      maxDrawdownPct: result.maxDrawdownPct,
    };
    setSavedScenarios((prev) => [item, ...prev]);
    setStatusMessage('Scénario ajouté au comparateur.');
  };

  const cW = 740;
  const cH = 245;
  const pL = 56;
  const pR = 18;
  const pT = 18;
  const pB = 28;
  const plotW = cW - pL - pR;
  const plotH = cH - pT - pB;

  const maxEquity = useMemo(() => {
    if (!result || result.series.length === 0) return 1000;
    return (
      Math.max(
        ...result.series.map((s) =>
          Math.max(s.portfolioValue, s.totalInvested, s.livretValue)
        )
      ) * 1.08
    );
  }, [result]);

  const xPos = (i: number, total: number) =>
    total <= 1 ? pL : pL + (i / (total - 1)) * plotW;
  const yEquity = (v: number) =>
    pT + plotH - (Math.min(maxEquity, Math.max(0, v)) / maxEquity) * plotH;
  const yDrawdown = (ddPct: number) => {
    const minDd = Math.min(-25, result ? result.maxDrawdownPct * 1.15 : -30);
    return pT + (Math.abs(ddPct) / Math.abs(minDd)) * plotH;
  };

  return (
    <div className="space-y-6">
      {/* Compact Institutional Header */}
      <div className="pb-4 border-b border-bordure">
        <p className="text-xs font-medium text-texte-doux mb-0.5">
          Backtest 2015–2026 · Versement unique vs DCA · Attribution annuelle · Drawdown &amp; Inflation IPC
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-texte">
          Backtest Quantitatif &amp; Attribution Historique
        </h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Configuration Ticket */}
        <section className="lg:col-span-4 bg-surface border border-bordure rounded-lg p-5 space-y-4">
          <h2 className="text-base font-semibold text-texte">
            Paramètres du backtest
          </h2>

          <div>
            <label
              htmlFor="bt-asset"
              className="block text-xs font-medium text-texte mb-1"
            >
              Instrument coté
            </label>
            <select
              id="bt-asset"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="min-h-11 w-full px-3 py-2 text-xs sm:text-sm bg-fond border border-bordure-champ rounded-md text-texte outline-hidden focus-ring focus:ring-2 focus:ring-accent"
            >
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.ticker})
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="block text-xs font-medium text-texte mb-1">
              Mode d’exécution
            </span>
            <div className="grid grid-cols-2 gap-1 p-1 bg-fond border border-bordure rounded-md">
              <button aria-pressed={Boolean(mode === 'lump_sum')}
                type="button"
                onClick={() => {
                  setMode('lump_sum');
                  if (Number(amountStr) < 500) setAmountStr('3000');
                }}
                className={`min-h-11 min-w-11 py-1.5 px-2 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
                  mode === 'lump_sum'
                    ? 'bg-surface-douce text-texte'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                Lump Sum (Unique)
              </button>
              <button aria-pressed={Boolean(mode === 'dca')}
                type="button"
                onClick={() => {
                  setMode('dca');
                  if (Number(amountStr) > 1000) setAmountStr('200');
                }}
                className={`min-h-11 min-w-11 py-1.5 px-2 text-xs font-medium rounded-sm transition-colors cursor-pointer ${
                  mode === 'dca'
                    ? 'bg-surface-douce text-texte'
                    : 'text-texte-doux hover:text-texte'
                }`}
              >
                DCA Mensuel
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="bt-amount"
              className="block text-xs font-medium text-texte mb-1"
            >
              {mode === 'lump_sum' ? 'Capital initial ($ CAD)' : 'Flux mensuel ($ CAD/mois)'}
            </label>
            <input
              id="bt-amount"
              type="number"
              min="1"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              className="min-h-11 w-full px-3 py-2 text-sm font-mono tabular-nums bg-fond border border-bordure-champ rounded-md text-texte outline-hidden focus-ring focus:ring-2 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label
                htmlFor="bt-start"
                className="block text-xs font-medium text-texte mb-1"
              >
                Entrée
              </label>
              <select
                id="bt-start"
                value={startYm}
                onChange={(e) => setStartYm(e.target.value)}
                className="min-h-11 w-full px-2.5 py-2 text-xs bg-fond border border-bordure-champ rounded-md text-texte"
              >
                {HISTORICAL_SERIES.slice(0, -1).map((pt) => (
                  <option key={pt.yearMonth} value={pt.yearMonth}>
                    {pt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="bt-end"
                className="block text-xs font-medium text-texte mb-1"
              >
                Sortie
              </label>
              <select
                id="bt-end"
                value={endYm}
                onChange={(e) => setEndYm(e.target.value)}
                className="min-h-11 w-full px-2.5 py-2 text-xs bg-fond border border-bordure-champ rounded-md text-texte"
              >
                {HISTORICAL_SERIES.slice(1).map((pt) => (
                  <option key={pt.yearMonth} value={pt.yearMonth}>
                    {pt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <span className="block text-[11px] font-medium text-texte-doux mb-1.5">
              Fenêtres de stress historiques
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: 'Décennie 16→26', s: '2016-11', e: '2026-11' },
                { label: 'Pré-COVID 2020', s: '2020-01', e: '2026-11' },
                { label: 'Sommet Nov. 21', s: '2021-11', e: '2026-11' },
                { label: 'Choc taux 2022', s: '2022-01', e: '2023-06' },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setStartYm(p.s);
                    setEndYm(p.e);
                  }}
                  className="min-h-11 min-w-11 px-2 py-1.5 text-[11px] bg-surface-douce hover:bg-surface-douce text-texte rounded-sm transition-colors cursor-pointer whitespace-nowrap"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="text-xs font-medium text-erreur-texte bg-erreur-fond border border-erreur-texte/40 rounded-md p-2.5"
            >
              {error}
            </p>
          )}

          {result && (
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={handleSaveScenario}
                className="min-h-11 w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-md transition-colors cursor-pointer"
              >
                <BookmarkPlus className="w-4 h-4" />
                <span>Épingler au comparateur</span>
              </button>

              {mode === 'lump_sum' && (
                <button
                  type="button"
                  onClick={() => {
                    onAddLotToPortfolio({
                      assetId: result.asset.id,
                      investedAmount: result.amount,
                      purchaseYearMonth: startYm,
                    });
                    setStatusMessage(
                      `${result.asset.ticker} (${result.startLabel}) intégré au portefeuille.`
                    );
                  }}
                  className="min-h-11 w-full inline-flex items-center justify-center gap-1.5 py-2 px-4 text-xs font-medium text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-md transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Intégrer au portefeuille réel</span>
                </button>
              )}
            </div>
          )}

          {statusMessage && (
            <p
              role="status"
              className="text-xs text-succes-texte bg-succes-fond border border-succes-texte/40 rounded-md px-3 py-2"
            >
              {statusMessage}
            </p>
          )}
        </section>

        {/* Visual Results & Attribution */}
        <div className="lg:col-span-8 space-y-6">
          {result ? (
            <>
              {/* 4-Metric KPI Strip */}
              <div className="bg-surface border border-bordure rounded-lg grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-bordure">
                <div className="p-4">
                  <div className="text-[11px] text-texte-doux">Valeur finale</div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-texte mt-0.5">
                    {formatEur(result.finalValue, 0)}
                  </div>
                  <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-0.5">
                    Versé {formatEur(result.totalInvested, 0)}
                  </div>
                </div>

                <div className="p-4">
                  <div className="text-[11px] text-texte-doux">Plus-value nette</div>
                  <div
                    className={`text-xl font-semibold font-mono tabular-nums mt-0.5 ${
                      result.netProfit >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                    }`}
                  >
                    {formatSignedEur(result.netProfit, 0)}
                  </div>
                  <div
                    className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                      result.netProfit >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                    }`}
                  >
                    {result.netProfit >= 0 ? '▲ ' : '▼ '}
                    {formatSignedPct(result.roiPct, 1)}
                  </div>
                </div>

                <div className="p-4">
                  <div className="text-[11px] text-texte-doux">TCAM (CAGR)</div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-succes-texte mt-0.5">
                    {formatSignedPct(result.cagrPct, 1)}/an
                  </div>
                  <div className="text-[11px] text-texte-doux font-mono tabular-nums mt-0.5">
                    Net IPC {formatSignedEur(result.realPurchasingPowerGain, 0)}
                  </div>
                </div>

                <div className="p-4">
                  <div className="text-[11px] text-texte-doux">Max Drawdown</div>
                  <div className="text-xl font-semibold font-mono tabular-nums text-erreur-texte mt-0.5">
                    {formatPct(result.maxDrawdownPct, 1)}
                  </div>
                  <div className="text-[11px] text-texte-doux mt-0.5">
                    Point bas {result.worstDrawdownDate}
                  </div>
                </div>
              </div>

              {/* Chart + Visual Benchmark Bar Comparison */}
              <section className="bg-surface border border-bordure rounded-lg p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-texte">
                      {result.asset.ticker} · {result.startLabel} → {result.endLabel} ({result.monthsCount}M)
                    </h2>
                  </div>

                  <div className="flex items-center gap-0.5 p-1 bg-fond border border-bordure rounded-md shrink-0">
                    {(
                      [
                        { id: 'equity', label: 'Courbe Capital' },
                        { id: 'annual', label: 'Par Année' },
                        { id: 'drawdown', label: 'Drawdown' },
                      ] as const
                    ).map((t) => (
                      <button aria-pressed={Boolean(chartTab === t.id)}
                        key={t.id}
                        type="button"
                        onClick={() => setChartTab(t.id)}
                        className={`min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-sm transition-colors cursor-pointer whitespace-nowrap ${
                          chartTab === t.id
                            ? 'bg-surface-douce text-texte'
                            : 'text-texte-doux hover:text-texte'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="w-full overflow-x-auto">
                  {chartTab === 'equity' && (
                    <svg
                      viewBox={`0 0 ${cW} ${cH}`}
                      className="w-full h-auto"
                      role="img"
                      aria-label="Courbe rétrospective du capital investi en $ CAD comparé au CPG garanti"
                    >
                      {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                        const v = maxEquity * r;
                        const y = yEquity(v);
                        return (
                          <g key={r}>
                            <line
                              x1={pL}
                              y1={y}
                              x2={cW - pR}
                              y2={y}
                              stroke={VALORIA_PALETTE.gridSlate}
                              strokeDasharray={r === 0 ? undefined : '3 3'}
                            />
                            <text
                              x={pL - 8}
                              y={y + 4}
                              textAnchor="end"
                              className="fill-texte-doux text-[10px] font-mono"
                            >
                              {formatCompactEur(v)}
                            </text>
                          </g>
                        );
                      })}

                      <path
                        d={result.series
                          .map(
                            (s, i) =>
                              `${i === 0 ? 'M' : 'L'}${xPos(i, result.series.length).toFixed(1)},${yEquity(s.livretValue).toFixed(1)}`
                          )
                          .join(' ')}
                        fill="none"
                        stroke={VALORIA_PALETTE.amberLight}
                        strokeWidth="1.6"
                        strokeDasharray="4 3"
                      />

                      <path
                        d={result.series
                          .map(
                            (s, i) =>
                              `${i === 0 ? 'M' : 'L'}${xPos(i, result.series.length).toFixed(1)},${yEquity(s.totalInvested).toFixed(1)}`
                          )
                          .join(' ')}
                        fill="none"
                        stroke={VALORIA_PALETTE.textSlate}
                        strokeWidth="1.5"
                        strokeDasharray="2 2"
                      />

                      <path
                        d={result.series
                          .map(
                            (s, i) =>
                              `${i === 0 ? 'M' : 'L'}${xPos(i, result.series.length).toFixed(1)},${yEquity(s.portfolioValue).toFixed(1)}`
                          )
                          .join(' ')}
                        fill="none"
                        stroke={VALORIA_PALETTE.teal}
                        strokeWidth="2.4"
                      />

                      {(() => {
                        const len = result.series.length;
                        const step = Math.max(1, Math.floor(len / 5));
                        return result.series
                          .filter(
                            (_, i) =>
                              i === 0 ||
                              i === len - 1 ||
                              (i % step === 0 && len - 1 - i >= Math.ceil(step * 0.65))
                          )
                          .map((s) => {
                            const idx = result.series.indexOf(s);
                            return (
                              <text
                                key={s.yearMonth}
                                x={xPos(idx, len)}
                                y={cH - 6}
                                textAnchor={
                                  idx === 0 ? 'start' : idx === len - 1 ? 'end' : 'middle'
                                }
                                className="fill-texte-doux text-[10px] font-mono"
                              >
                                {s.label}
                              </text>
                            );
                          });
                      })()}
                    </svg>
                  )}

                  {chartTab === 'annual' && (
                    <svg
                      viewBox={`0 0 ${cW} ${cH}`}
                      className="w-full h-auto"
                      role="img"
                      aria-label="Histogramme des rendements annuels comparés au MSCI World"
                    >
                      {(() => {
                        const maxAbs = Math.max(
                          25,
                          ...annualBars.map((b) =>
                            Math.max(Math.abs(b.assetReturnPct), Math.abs(b.benchmarkWorldPct))
                          )
                        );
                        const zeroY = pT + plotH * 0.52;
                        const scaleBar = (pct: number) =>
                          (pct / (maxAbs * 1.15)) * (plotH * 0.46);
                        const slotW = plotW / Math.max(1, annualBars.length);

                        return (
                          <>
                            {[-maxAbs * 0.75, 0, maxAbs * 0.75].map((lv, idx) => {
                              const y = zeroY - scaleBar(lv);
                              return (
                                <g key={idx}>
                                  <line
                                    x1={pL}
                                    y1={y}
                                    x2={cW - pR}
                                    y2={y}
                                    stroke={lv === 0 ? VALORIA_PALETTE.strokeSlate : VALORIA_PALETTE.gridSlate}
                                    strokeDasharray={lv === 0 ? undefined : '3 3'}
                                  />
                                  <text
                                    x={pL - 8}
                                    y={y + 3.5}
                                    textAnchor="end"
                                    className="fill-texte-doux text-[10px] font-mono"
                                  >
                                    {/* NOMBRE-NON-MONETAIRE : graduation rendement historique public */}
                                    {lv > 0 ? `+${lv.toFixed(0)}%` : `${lv.toFixed(0)}%`}
                                  </text>
                                </g>
                              );
                            })}

                            {annualBars.map((b, i) => {
                              const cx = pL + slotW * (i + 0.5);
                              const bw = Math.min(20, slotW * 0.34);
                              const hA = scaleBar(b.assetReturnPct);
                              const hW = scaleBar(b.benchmarkWorldPct);
                              return (
                                <g key={b.year}>
                                  <rect
                                    x={cx - bw - 1}
                                    y={hA >= 0 ? zeroY - hA : zeroY}
                                    width={bw}
                                    height={Math.max(2, Math.abs(hA))}
                                    rx={2}
                                    fill={b.assetReturnPct >= 0 ? VALORIA_PALETTE.teal : VALORIA_PALETTE.redLight}
                                  />
                                  <rect
                                    x={cx + 1}
                                    y={hW >= 0 ? zeroY - hW : zeroY}
                                    width={bw * 0.85}
                                    height={Math.max(2, Math.abs(hW))}
                                    rx={2}
                                    fill={VALORIA_PALETTE.mutedSlate}
                                    fillOpacity={0.75}
                                  />
                                  <text
                                    x={cx}
                                    y={cH - 6}
                                    textAnchor="middle"
                                    className="fill-texte-doux text-[10px] font-mono"
                                  >
                                    {b.year}
                                  </text>
                                </g>
                              );
                            })}
                          </>
                        );
                      })()}
                    </svg>
                  )}

                  {chartTab === 'drawdown' && (
                    <svg
                      viewBox={`0 0 ${cW} ${cH}`}
                      className="w-full h-auto"
                      role="img"
                      aria-label="Courbe des baisses temporaires maximales"
                    >
                      {[0, -10, -20, -35].map((dd) => {
                        const y = yDrawdown(dd);
                        if (y > cH - pB) return null;
                        return (
                          <g key={dd}>
                            <line
                              x1={pL}
                              y1={y}
                              x2={cW - pR}
                              y2={y}
                              stroke={VALORIA_PALETTE.gridSlate}
                              strokeDasharray={dd === 0 ? undefined : '3 3'}
                            />
                            <text
                              x={pL - 8}
                              y={y + 4}
                              textAnchor="end"
                              className="fill-texte-doux text-[10px] font-mono"
                            >
                              {dd} %
                            </text>
                          </g>
                        );
                      })}
                      <path
                        d={result.series
                          .map(
                            (s, i) =>
                              `${i === 0 ? 'M' : 'L'}${xPos(i, result.series.length).toFixed(1)},${yDrawdown(s.drawdownPct).toFixed(1)}`
                          )
                          .join(' ')}
                        fill="none"
                        stroke={VALORIA_PALETTE.redLight}
                        strokeWidth="2.2"
                      />
                    </svg>
                  )}
                </div>

                {/* Visual 4-Bar Strategy & Benchmark Comparison (Replaces Wordy Paragraph) */}
                {(() => {
                  const infEnd =
                    result.series[result.series.length - 1]?.inflationAdjustedCapital ??
                    result.totalInvested;
                  const rows = [
                    {
                      label:
                        result.mode === 'lump_sum'
                          ? 'Stratégie active (Lump Sum)'
                          : 'Stratégie active (DCA mensuel)',
                      val: result.finalValue,
                      pct: result.roiPct,
                      color: 'bg-accent',
                    },
                    {
                      label:
                        result.mode === 'lump_sum'
                          ? 'Alternative DCA équivalent'
                          : 'Alternative Lump Sum initial',
                      val: result.alternativeModeFinalValue,
                      pct: result.alternativeModeRoiPct,
                      color: 'bg-accent',
                    },
                    {
                      label: 'Épargne garantie (CPG)',
                      val: result.livretFinalValue,
                      pct:
                        ((result.livretFinalValue - result.totalInvested) /
                          result.totalInvested) *
                        100,
                      color: 'bg-alerte-texte',
                    },
                    {
                      label: 'Seuil maintien pouvoir d’achat (IPC)',
                      val: infEnd,
                      pct:
                        ((infEnd - result.totalInvested) / result.totalInvested) * 100,
                      color: 'bg-bordure-champ',
                    },
                  ];
                  const maxBar = Math.max(...rows.map((r) => r.val), 1);

                  return (
                    <div className="pt-3 border-t border-bordure space-y-2">
                      {rows.map((r) => (
                        <div
                          key={r.label}
                          className="grid grid-cols-12 items-center gap-3 text-xs font-mono tabular-nums"
                        >
                          <span className="col-span-5 sm:col-span-4 font-sans text-texte truncate">
                            {r.label}
                          </span>
                          <div className="col-span-4 sm:col-span-5 h-2 bg-fond rounded-sm overflow-hidden">
                            {/* NOMBRE-NON-MONETAIRE : barre comparative de scénario de backtest */}
                            <div
                              style={{ width: `${Math.max(4, (r.val / maxBar) * 100)}%` }}
                              className={`h-full ${r.color}`}
                            />
                          </div>
                          <span className="col-span-3 text-right text-texte whitespace-nowrap">
                            {formatEur(r.val, 0)}{' '}
                            <span className="text-texte-doux text-[11px]">
                              ({formatSignedPct(r.pct, 0)})
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </section>
            </>
          ) : (
            <div className="bg-surface border border-bordure rounded-lg p-8 text-center text-sm text-texte-doux">
              Ajustez le montant à gauche pour générer la simulation.
            </div>
          )}

          {/* Saved Comparative Ledger */}
          <section className="bg-surface border border-bordure rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-bordure flex items-center justify-between">
              <h2 className="text-base font-semibold text-texte">
                Matrice comparative des scénarios épinglés
              </h2>
              {savedScenarios.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSavedScenarios([])}
                  className="min-h-11 text-xs font-medium text-texte-doux hover:text-erreur-texte transition-colors cursor-pointer"
                >
                  Réinitialiser
                </button>
              )}
            </div>

            {savedScenarios.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-bordure bg-fond/60 text-[11px] font-semibold text-texte-doux">
                      <th className="py-2.5 px-4">Actif &amp; Fenêtre</th>
                      <th className="py-2.5 px-3">Exécution</th>
                      <th className="py-2.5 px-3 text-right">Versé</th>
                      <th className="py-2.5 px-3 text-right">Final</th>
                      <th className="py-2.5 px-3 text-right">ROI / TCAM</th>
                      <th className="py-2.5 px-3 text-right">Max DD</th>
                      <th className="py-2.5 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bordure">
                    {savedScenarios.map((sc) => (
                      <tr key={sc.id} className="hover:bg-surface-douce/40">
                        <td className="py-2.5 px-4">
                          <button
                            type="button"
                            onClick={() => {
                              setAssetId(sc.assetId);
                              setMode(sc.mode);
                              setAmountStr(String(sc.amount));
                              setStartYm(sc.startYearMonth);
                              setEndYm(sc.endYearMonth);
                            }}
                            className="min-h-11 text-left font-medium text-texte hover:text-succes-texte transition-colors cursor-pointer text-xs sm:text-sm"
                          >
                            {sc.assetName}
                          </button>
                          <div className="text-[11px] text-texte-doux font-mono">
                            {sc.periodLabel}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-texte whitespace-nowrap">
                          {sc.mode === 'lump_sum' ? 'Lump Sum' : 'DCA'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs text-texte">
                          {formatEur(sc.totalInvested, 0)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-texte text-xs sm:text-sm">
                          {formatEur(sc.finalValue, 0)}
                        </td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums text-xs font-medium ${
                            sc.roiPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                          }`}
                        >
                          <div>
                            {sc.roiPct >= 0 ? '▲ ' : '▼ '}
                            {formatSignedPct(sc.roiPct, 1)}
                          </div>
                          <div className="text-[11px] text-texte-doux">
                            {formatSignedPct(sc.cagrPct, 1)}/an
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-xs text-erreur-texte">
                          {formatPct(sc.maxDrawdownPct, 1)}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setSavedScenarios((prev) =>
                                prev.filter((item) => item.id !== sc.id)
                              )
                            }
                            aria-label={`Supprimer le scénario ${sc.assetName}`}
                            className="min-h-11 min-w-11 p-1.5 text-texte-doux hover:text-erreur-texte rounded-sm transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-texte-doux">
                Aucun scénario épinglé.
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
