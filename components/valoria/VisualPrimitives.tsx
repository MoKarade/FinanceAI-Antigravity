import React, { useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { motion } from 'framer-motion';
import {
  EcosystemNodeLink,
  QuarterlyCorporatePoint,
  SixAxisRadarVector,
} from '../../services/valoria/corporateIntelligenceEngine';
import { AnalystTradeRecommendation } from '../../services/valoria/proAnalystAdvisor';
import { formatCompactEur, formatEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';
import { useFinanceStore } from '../../store/useFinanceStore';

// ============================================================================
// 1. Dual Radial Arc Gauge (Before -> After or Single 0..100 Score)
// Sober Zinc + Semantic Green / Red
// ============================================================================
export const RadialBeforeAfterGauge: React.FC<{
  before100?: number;
  after100: number;
  label: string;
  subValue?: string;
  accentColor?: string;
}> = ({
  before100,
  after100,
  label,
  subValue,
  accentColor,
}) => {
  const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
  const clamp100 = (n: number) => Math.max(0, Math.min(100, n));
  const valAfter = clamp100(after100);
  const valBefore = before100 !== undefined ? clamp100(before100) : null;

  const semanticColor =
    accentColor ??
    (valAfter >= 62 ? VALORIA_PALETTE.emerald : valAfter <= 42 ? VALORIA_PALETTE.rose : VALORIA_PALETTE.textBright);

  const rOuter = 44;
  const rInner = 34;
  const cx = 56;
  const cy = 54;

  const arcPath = (r: number, pct: number) => {
    const startAngle = Math.PI;
    const endAngle = Math.PI + (Math.PI * pct) / 100;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    if (pct <= 0.5) return '';
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  return (
    <div className="flex items-center gap-2.5 w-full min-w-0">
      <svg
        width="92"
        height="58"
        viewBox="0 0 112 68"
        role="img"
        aria-label={`${label} : ${Math.round(valAfter)} sur 100`}
        className="shrink-0 overflow-visible"
      >
        {/* Outer Track */}
        <path
          d={arcPath(rOuter, 100)}
          fill="none"
          stroke={VALORIA_PALETTE.gridZinc}
          strokeWidth="7"
          strokeLinecap="round"
        />
        {/* Outer Progress (After / Current) */}
        <path
          d={arcPath(rOuter, valAfter)}
          fill="none"
          stroke={semanticColor}
          strokeWidth="7"
          strokeLinecap="round"
          pathLength={1}
          className="animate-curve-draw"
        />

        {/* Optional Inner Before Arc */}
        {valBefore !== null && (
          <>
            <path
              d={arcPath(rInner, 100)}
              fill="none"
              stroke={VALORIA_PALETTE.bgCard}
              strokeWidth="4"
              strokeLinecap="round"
            />
            <path
              d={arcPath(rInner, valBefore)}
              fill="none"
              stroke={VALORIA_PALETTE.mutedZinc}
              strokeWidth="4"
              strokeDasharray="3 2"
              strokeLinecap="round"
            />
          </>
        )}

        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill={VALORIA_PALETTE.textWhiteSoft}
          fontSize="17"
          fontWeight="700"
          fontFamily="IBM Plex Mono, monospace"
        >
          {Math.round(valAfter)}
        </text>
      </svg>

      <div className="min-w-0 space-y-0.5">
        <span className="block text-xs font-medium text-texte-doux truncate">
          {label}
        </span>
        {valBefore !== null ? (
          <div className="font-mono tabular-nums text-sm font-bold text-texte">
            <span className="text-texte-doux">{isPrivacyMode ? '•••' : Math.round(valBefore)}</span>
            <span className="text-texte-doux mx-1">→</span>
            <span
              className={
                valAfter >= valBefore ? 'text-succes-texte' : 'text-erreur-texte'
              }
            >
              {isPrivacyMode ? '•••' : `${Math.round(valAfter)}/100`}
            </span>
          </div>
        ) : (
          <div className="font-mono tabular-nums text-sm font-bold text-texte">
            {isPrivacyMode ? '•••' : `${Math.round(valAfter)}/100`}
          </div>
        )}
        {subValue && (
          <div className="font-mono tabular-nums text-[11px] text-succes-texte leading-tight truncate">
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// 2. 6-Axis Polygonal Radar Chart (Single or Before-vs-After Overlay)
// ============================================================================
const RADAR_AXES: Array<{ key: keyof SixAxisRadarVector; shortLabel: string }> = [
  { key: 'valuation', shortLabel: 'Juste Prix' },
  { key: 'accountingQuality', shortLabel: 'Solidité' },
  { key: 'guidanceMomentum', shortLabel: 'Croissance' },
  { key: 'newsCatalysts', shortLabel: 'Actualités' },
  { key: 'smartMoneyFlow', shortLabel: 'Initiés' },
  { key: 'tailResilience', shortLabel: 'Sécurité' },
];

export const RadarComparisonSvg: React.FC<{
  primary: SixAxisRadarVector;
  baseline?: SixAxisRadarVector;
  primaryLabel?: string;
  baselineLabel?: string;
  size?: number;
}> = ({
  primary,
  baseline,
  primaryLabel = 'Après conseils',
  baselineLabel = 'Actuel',
  size = 248,
}) => {
  const cx = size / 2;
  const cy = size / 2 + 4;
  const maxR = size * 0.32;

  const avgScore =
    RADAR_AXES.reduce((s, a) => s + primary[a.key], 0) / RADAR_AXES.length;
  const polyStroke = avgScore >= 56 ? VALORIA_PALETTE.emerald : avgScore <= 42 ? VALORIA_PALETTE.rose : VALORIA_PALETTE.lineZinc;

  const pointAt = (axisIdx: number, val100: number) => {
    const angle = -Math.PI / 2 + (axisIdx * 2 * Math.PI) / RADAR_AXES.length;
    const r = (Math.max(8, Math.min(100, val100)) / 100) * maxR;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      lx: cx + (maxR + 24) * Math.cos(angle),
      ly: cy + (maxR + 18) * Math.sin(angle),
    };
  };

  const buildPolygon = (vec: SixAxisRadarVector) =>
    RADAR_AXES.map((ax, i) => {
      const pt = pointAt(i, vec[ax.key]);
      return `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }).join(' ');

  return (
    <div className="flex flex-col items-center w-full overflow-hidden">
      <svg
        width="100%"
        viewBox={`0 0 ${size + 84} ${size + 8}`}
        role="img"
        aria-label="Radar visuel à 6 critères"
        className="max-w-[300px] sm:max-w-[320px] h-auto select-none"
      >
        <g transform="translate(42,4)">
          {[25, 50, 75, 100].map((ring) => {
            const pts = RADAR_AXES.map((_, i) => {
              const p = pointAt(i, ring);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            }).join(' ');
            return (
              <polygon
                key={ring}
                points={pts}
                fill="none"
                stroke={ring === 50 ? VALORIA_PALETTE.axisZinc : VALORIA_PALETTE.gridZinc}
                strokeWidth="1"
                strokeDasharray={ring === 50 ? '2 2' : undefined}
              />
            );
          })}

          {RADAR_AXES.map((ax, i) => {
            const outer = pointAt(i, 100);
            return (
              <line
                key={ax.key}
                x1={cx}
                y1={cy}
                x2={outer.x}
                y2={outer.y}
                stroke={VALORIA_PALETTE.gridZinc}
                strokeWidth="1"
              />
            );
          })}

          {baseline && (
            <polygon
              points={buildPolygon(baseline)}
              fill={VALORIA_PALETTE.mutedZinc}
              fillOpacity="0.14"
              stroke={VALORIA_PALETTE.textZinc}
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
          )}

          <polygon
            points={buildPolygon(primary)}
            fill={polyStroke}
            fillOpacity="0.18"
            stroke={polyStroke}
            strokeWidth="2.2"
          />

          {RADAR_AXES.map((ax, i) => {
            const pt = pointAt(i, primary[ax.key]);
            const outer = pointAt(i, 100);
            const anchor =
              Math.abs(outer.lx - cx) < 10
                ? 'middle'
                : outer.lx > cx
                  ? 'start'
                  : 'end';
            const deltaUp = baseline ? primary[ax.key] >= baseline[ax.key] : primary[ax.key] >= 55;
            return (
              <g key={ax.key}>
                <circle
                  cx={pt.x}
                  cy={pt.y}
                  r="3.4"
                  fill={polyStroke}
                  stroke={VALORIA_PALETTE.bgDeep}
                  strokeWidth="1.2"
                />
                <text
                  x={outer.lx}
                  y={outer.ly - 3}
                  textAnchor={anchor}
                  fill={VALORIA_PALETTE.textZincLight}
                  fontSize="10"
                  fontWeight="600"
                >
                  {ax.shortLabel}
                </text>
                <text
                  x={outer.lx}
                  y={outer.ly + 9}
                  textAnchor={anchor}
                  fill={deltaUp ? VALORIA_PALETTE.emeraldLight : VALORIA_PALETTE.lineZinc}
                  fontSize="10"
                  fontFamily="IBM Plex Mono, monospace"
                >
                  {baseline ? `${baseline[ax.key]}→${primary[ax.key]}` : `${primary[ax.key]}`}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {baseline && (
        <div className="flex items-center gap-4 text-[11px] text-texte-doux font-mono">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-bordure-champ inline-block" />
            <span>{baselineLabel}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-accent inline-block" />
            <span className="text-succes-texte">{primaryLabel}</span>
          </span>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 3. Inline Price vs DCF Fair Value & Stop/Target Visual Ruler
// ============================================================================
export const PriceTargetRangeBar: React.FC<{
  spotCad: number;
  fairCad: number | null;
  stopCad: number | null;
  targetCad: number | null;
}> = ({ spotCad, fairCad, stopCad, targetCad }) => {
  const vals = [
    spotCad,
    fairCad ?? spotCad,
    stopCad ?? spotCad * 0.88,
    targetCad ?? spotCad * 1.15,
  ].filter((x) => Number.isFinite(x) && x > 0);

  const minV = Math.min(...vals) * 0.94;
  const maxV = Math.max(...vals) * 1.06;
  const span = Math.max(0.0001, maxV - minV);
  const toX = (v: number) => Math.max(4, Math.min(96, ((v - minV) / span) * 100));

  const xSpot = toX(spotCad);
  const xFair = fairCad ? toX(fairCad) : null;
  const xStop = stopCad ? toX(stopCad) : null;
  const xTarget = targetCad ? toX(targetCad) : null;
  const decimals = spotCad < 2 ? 4 : 0;

  return (
    <div className="space-y-1">
      <svg
        width="100%"
        height="22"
        viewBox="0 0 200 22"
        preserveAspectRatio="none"
        aria-label="Position du prix actuel face à la vraie valeur estimée"
        className="block"
      >
        <line x1="6" y1="11" x2="194" y2="11" stroke={VALORIA_PALETTE.gridZinc} strokeWidth="4" strokeLinecap="round" />

        {xFair !== null && (
          <line
            x1={(Math.min(xSpot, xFair) / 100) * 200}
            y1="11"
            x2={(Math.max(xSpot, xFair) / 100) * 200}
            y2="11"
            stroke={xFair >= xSpot ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose}
            strokeWidth="4"
            strokeOpacity="0.72"
          />
        )}

        {xStop !== null && (
          <line
            x1={(xStop / 100) * 200}
            y1="5"
            x2={(xStop / 100) * 200}
            y2="17"
            stroke={VALORIA_PALETTE.rose}
            strokeWidth="2"
          />
        )}

        {xTarget !== null && (
          <line
            x1={(xTarget / 100) * 200}
            y1="5"
            x2={(xTarget / 100) * 200}
            y2="17"
            stroke={VALORIA_PALETTE.emerald}
            strokeWidth="2"
          />
        )}

        {xFair !== null && (
          <circle
            cx={(xFair / 100) * 200}
            cy="11"
            r="4.2"
            fill={xFair >= xSpot ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose}
            stroke={VALORIA_PALETTE.bgDeep}
            strokeWidth="1.3"
          />
        )}

        <circle
          cx={(xSpot / 100) * 200}
          cy="11"
          r="4.8"
          fill={VALORIA_PALETTE.textWhiteSoft}
          stroke={VALORIA_PALETTE.bgDeep}
          strokeWidth="1.5"
        />
      </svg>

      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-texte-doux">
        {stopCad ? (
          <span className="text-erreur-texte">Seuil {formatEur(stopCad, decimals)}</span>
        ) : (
          <span />
        )}
        <span className="text-texte">Actuel {formatEur(spotCad, decimals)}</span>
        {fairCad ? (
          <span className={fairCad >= spotCad ? 'text-succes-texte' : 'text-erreur-texte'}>
            Juste valeur {formatEur(fairCad, decimals)}
          </span>
        ) : targetCad ? (
          <span className="text-succes-texte">Cible {formatEur(targetCad, decimals)}</span>
        ) : null}
      </div>
    </div>
  );
};

// ============================================================================
// 4. Diverging Trade Butterfly Chart (SELL $ CAD Red Left vs BUY $ CAD Green Right)
// ============================================================================
export const DivergingTradeButterflyChart: React.FC<{
  sells: AnalystTradeRecommendation[];
  buys: AnalystTradeRecommendation[];
  onInspectAsset: (assetId: string) => void;
  onExecuteOrder: (assetId: string, deltaCad: number) => void;
}> = ({ sells, buys, onInspectAsset, onExecuteOrder }) => {
  const maxAbs = Math.max(
    1000,
    ...sells.map((s) => Math.abs(s.deltaCad)),
    ...buys.map((b) => Math.abs(b.deltaCad))
  );

  const rows = [
    ...sells.map((r) => ({ ...r, isSell: true })),
    ...buys.map((r) => ({ ...r, isSell: false })),
  ];

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center text-xs font-mono text-succes-texte">
        ▲ PORTEFEUILLE ÉQUILIBRÉ — AUCUNE VENTE NI ACHAT NÉCESSAIRE
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Desktop / Tablet 3-Column Butterfly Header */}
      <div className="hidden sm:grid sm:grid-cols-[128px_1fr_92px] items-center text-[11px] font-mono text-texte-doux pb-1.5 border-b border-bordure">
        <span className="whitespace-nowrap">ACTION · NOTE</span>
        <div className="grid grid-cols-2 text-center gap-2">
          <span className="text-erreur-texte font-semibold whitespace-nowrap truncate">
            ▼ À VENDRE ($ CAD)
          </span>
          <span className="text-succes-texte font-semibold whitespace-nowrap truncate">
            ▲ À ACHETER ($ CAD)
          </span>
        </div>
        <span className="text-right whitespace-nowrap">1 CLIC</span>
      </div>

      <div className="divide-y divide-bordure sm:divide-y-0 sm:space-y-2">
        {rows.map((rec, idx) => {
          const pctWidth = Math.max(
            14,
            Math.min(96, (Math.abs(rec.deltaCad) / maxAbs) * 94)
          );
          const amountLabel = rec.isSell
            ? `−${formatCompactEur(Math.abs(rec.deltaCad))}`
            : `+${formatCompactEur(rec.deltaCad)}`;

          return (
            <motion.div
              key={`${rec.side}-${rec.assetId}`}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.15 }}
              transition={{ duration: 0.25, delay: idx * 0.03 }}
              className="py-2.5 sm:py-1.5 first:pt-0 last:pb-0 sm:hover:bg-surface-douce/45 sm:rounded-lg sm:px-1.5 transition-colors"
            >
              {/* MOBILE STACKED LAYOUT (< sm) — Full-width readable bar & 38px touch target */}
              <div className="sm:hidden space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onInspectAsset(rec.assetId)}
                    className="min-h-11 text-left min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-sm text-texte">
                        {rec.ticker}
                      </span>
                      <span className="font-mono text-[11px] text-succes-texte tabular-nums whitespace-nowrap">
                        ✓ {rec.chainOfThought.passedStepsCount}/5
                      </span>
                      <span className="font-mono text-[11px] text-texte-doux tabular-nums truncate">
                        · {formatEur(rec.spotPriceCad, rec.spotPriceCad < 2 ? 3 : 0)}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onExecuteOrder(rec.assetId, rec.deltaCad)}
                    className={`min-h-11 px-3 py-1.5 text-xs font-mono tabular-nums font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      rec.isSell
                        ? 'text-erreur-texte bg-erreur-fond border border-erreur-texte/40'
                        : 'text-sur-accent bg-accent'
                    }`}
                  >
                    {rec.actionLabel} {amountLabel}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onInspectAsset(rec.assetId)}
                  aria-label={`${rec.actionLabel} ${rec.ticker} ${amountLabel}`}
                  className="min-h-11 w-full block cursor-pointer"
                >
                  <svg
                    viewBox="0 0 100 8"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="w-full h-2 rounded-full overflow-hidden bg-fond border border-bordure"
                  >
                    <rect
                      x="0"
                      y="0"
                      width={pctWidth}
                      height="8"
                      className={rec.isSell ? 'fill-erreur-texte' : 'fill-succes-texte'}
                    />
                  </svg>
                </button>
              </div>

              {/* DESKTOP 3-COLUMN BUTTERFLY LAYOUT (sm+) */}
              <div className="hidden sm:grid sm:grid-cols-[128px_1fr_92px] items-center gap-2">
                <button
                  type="button"
                  onClick={() => onInspectAsset(rec.assetId)}
                  className="min-h-11 text-left min-w-0 cursor-pointer group"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono font-bold text-xs text-texte group-hover:underline">
                      {rec.ticker}
                    </span>
                    <span className="font-mono text-[10px] text-succes-texte tabular-nums whitespace-nowrap">
                      ✓ {rec.chainOfThought.passedStepsCount}/5
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-texte-doux truncate tabular-nums">
                    {formatEur(rec.spotPriceCad, rec.spotPriceCad < 2 ? 3 : 0)} ·{' '}
                    {rec.optimalCanadianWrapper}
                  </div>
                </button>

                <div className="grid grid-cols-2 items-center h-7 relative">
                  {/* Left Half (SELL — Red) */}
                  <div className="flex items-center justify-end gap-1.5 pr-1.5 border-r border-bordure-champ h-full">
                    {rec.isSell && (
                      <>
                        <span className="font-mono tabular-nums text-[11px] font-semibold text-erreur-texte whitespace-nowrap">
                          {amountLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => onInspectAsset(rec.assetId)}
                          aria-label={`${rec.actionLabel} ${rec.ticker} ${amountLabel}`}
                          className="min-h-11 flex-1 max-w-[140px] h-5 flex items-center justify-end cursor-pointer"
                        >
                          <svg
                            viewBox="0 0 100 20"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                            className="w-full h-5"
                          >
                            <rect
                              x={100 - pctWidth}
                              y="0"
                              width={pctWidth}
                              height="20"
                              rx="3"
                              className="fill-erreur-texte hover:fill-erreur-texte transition-colors"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>

                  {/* Right Half (BUY — Green) */}
                  <div className="flex items-center justify-start gap-1.5 pl-1.5 h-full">
                    {!rec.isSell && (
                      <>
                        <button
                          type="button"
                          onClick={() => onInspectAsset(rec.assetId)}
                          aria-label={`${rec.actionLabel} ${rec.ticker} ${amountLabel}`}
                          className="min-h-11 flex-1 max-w-[140px] h-5 flex items-center justify-start cursor-pointer"
                        >
                          <svg
                            viewBox="0 0 100 20"
                            preserveAspectRatio="none"
                            aria-hidden="true"
                            className="w-full h-5"
                          >
                            <rect
                              x="0"
                              y="0"
                              width={pctWidth}
                              height="20"
                              rx="3"
                              className="fill-succes-texte hover:fill-succes-texte transition-colors"
                            />
                          </svg>
                        </button>
                        <span className="font-mono tabular-nums text-[11px] font-semibold text-succes-texte whitespace-nowrap">
                          {amountLabel}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <button
                    type="button"
                    onClick={() => onExecuteOrder(rec.assetId, rec.deltaCad)}
                    className={`min-h-11 min-w-11 px-2.5 py-1 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      rec.isSell
                        ? 'text-erreur-texte bg-erreur-fond hover:bg-erreur-fond border border-erreur-texte/40'
                        : 'text-sur-accent bg-accent hover:bg-accent-fonce'
                    }`}
                  >
                    {rec.actionLabel}
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

// ============================================================================
// 5. 8-Quarter EPS Surprise Bars + Operating/FCF Margin Curves (Sober Zinc + Green/Red)
// ============================================================================
export const QuarterlyBeatAndMarginSvg: React.FC<{
  quarters: QuarterlyCorporatePoint[];
}> = ({ quarters }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (quarters.length === 0) return null;

  const w = 460;
  const h = 186;
  const padL = 38;
  const padR = 36;
  const padT = 16;
  const padB = 26;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  const maxSurp = Math.max(8, ...quarters.map((q) => Math.abs(q.epsSurprisePct))) * 1.15;
  const minMargin = Math.min(-10, ...quarters.map((q) => Math.min(q.operatingMarginPct, q.fcfMarginPct)));
  const maxMargin = Math.max(35, ...quarters.map((q) => Math.max(q.operatingMarginPct, q.fcfMarginPct))) * 1.1;

  const xStep = innerW / quarters.length;
  const yZeroSurp = padT + innerH * 0.55;
  const surpScale = (innerH * 0.42) / maxSurp;

  const yMargin = (m: number) =>
    padT + innerH - ((m - minMargin) / Math.max(1, maxMargin - minMargin)) * innerH;

  const opLine = quarters
    .map((q, i) => `${(padL + i * xStep + xStep / 2).toFixed(1)},${yMargin(q.operatingMarginPct).toFixed(1)}`)
    .join(' ');
  const fcfLine = quarters
    .map((q, i) => `${(padL + i * xStep + xStep / 2).toFixed(1)},${yMargin(q.fcfMarginPct).toFixed(1)}`)
    .join(' ');

  const active = quarters[hoverIdx ?? quarters.length - 1];

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
        <span className="text-texte font-semibold">{active.quarter}</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className={active.epsSurprisePct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'}>
            Profits vs attentes {formatSignedPct(active.epsSurprisePct, 1)}
          </span>
          <span className="text-texte">
            {/* NOMBRE-NON-MONETAIRE : marge opérationnelle trimestrielle publique */}
            Marge Op. {active.operatingMarginPct.toFixed(1)}%
          </span>
          <span className="text-texte-doux">
            {/* NOMBRE-NON-MONETAIRE : marge de flux de trésorerie disponible publique */}
            Cash-flow {active.fcfMarginPct.toFixed(1)}%
          </span>
        </div>
      </div>

      <svg
        width="100%"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Historique 8 trimestres des résultats et marges"
        className="block select-none"
      >
        <line
          x1={padL}
          y1={yZeroSurp}
          x2={w - padR}
          y2={yZeroSurp}
          stroke={VALORIA_PALETTE.axisZinc}
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {quarters.map((q, i) => {
          const cx = padL + i * xStep + xStep / 2;
          const barH = Math.max(2, Math.abs(q.epsSurprisePct) * surpScale);
          const yTop = q.epsSurprisePct >= 0 ? yZeroSurp - barH : yZeroSurp;
          return (
            <g
              key={q.quarter}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
              className="cursor-pointer"
            >
              <rect
                x={cx - 11}
                y={yTop}
                width={22}
                height={barH}
                rx={2}
                fill={q.epsSurprisePct >= 0 ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.rose}
                fillOpacity={hoverIdx === i ? 0.95 : 0.72}
              />
              <text
                x={cx}
                y={h - 7}
                textAnchor="middle"
                fill={VALORIA_PALETTE.textZinc}
                fontSize="9.5"
                fontFamily="IBM Plex Mono, monospace"
              >
                {q.quarter}
              </text>
            </g>
          );
        })}

        {/* Operating Margin Line (crisp white) */}
        <polyline
          points={opLine}
          fill="none"
          stroke={VALORIA_PALETTE.textBright}
          strokeWidth="2"
        />
        {/* FCF Margin Line (sober zinc dashed) */}
        <polyline
          points={fcfLine}
          fill="none"
          stroke={VALORIA_PALETTE.textZinc}
          strokeWidth="1.7"
          strokeDasharray="4 2"
        />

        {quarters.map((q, i) => {
          const cx = padL + i * xStep + xStep / 2;
          return (
            <circle
              key={`pt-${q.quarter}`}
              cx={cx}
              cy={yMargin(q.operatingMarginPct)}
              r="2.8"
              fill={VALORIA_PALETTE.textWhiteSoft}
            />
          );
        })}

        <text x="4" y={padT + 8} fill={VALORIA_PALETTE.mutedZinc} fontSize="9" fontFamily="IBM Plex Mono, monospace">
          +{Math.round(maxSurp)}%
        </text>
        <text x="4" y={h - padB} fill={VALORIA_PALETTE.mutedZinc} fontSize="9" fontFamily="IBM Plex Mono, monospace">
          −{Math.round(maxSurp)}%
        </text>
        <text x={w - 4} y={padT + 8} textAnchor="end" fill={VALORIA_PALETTE.lineZinc} fontSize="9" fontFamily="IBM Plex Mono, monospace">
          {Math.round(maxMargin)}%
        </text>
      </svg>
    </div>
  );
};

// ============================================================================
// 6. 3-Column Supply-Chain & Ecosystem Dependency Node Graph (Sober Zinc + Green/Red)
// ============================================================================
export const SupplyChainGraphSvg: React.FC<{
  ticker: string;
  score100: number;
  links: EcosystemNodeLink[];
}> = ({ ticker, score100, links }) => {
  const suppliers = links.filter((l) => l.role === 'supplier');
  const customersAndPeers = links.filter((l) => l.role !== 'supplier');

  const w = 480;
  const h = 186;
  const centerX = w / 2;
  const centerY = h / 2;
  const fmtNodeLabel = (txt: string) =>
    txt.length > 21 ? `${txt.slice(0, 20).trimEnd()}…` : txt;
  const hubStroke = score100 >= 62 ? VALORIA_PALETTE.emerald : score100 <= 42 ? VALORIA_PALETTE.rose : VALORIA_PALETTE.lineZinc;

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Graphe chaîne d’approvisionnement et clients de ${ticker}`}
      className="block select-none"
    >
      {suppliers.map((node, idx) => {
        const y = 38 + idx * ((h - 76) / Math.max(1, suppliers.length - 1 || 1));
        const strokeW = Math.max(1.4, node.exposurePct / 16);
        return (
          <g key={`sup-${node.code}-${idx}`}>
            <path
              d={`M 140 ${y} C 174 ${y}, 182 ${centerY}, ${centerX - 40} ${centerY}`}
              fill="none"
              stroke={VALORIA_PALETTE.mutedZinc}
              strokeOpacity="0.55"
              strokeWidth={strokeW}
            />
            <rect
              x="6"
              y={y - 16}
              width="134"
              height="32"
              rx="6"
              fill={VALORIA_PALETTE.bgDeep}
              stroke={VALORIA_PALETTE.gridZinc}
            />
            <text x="13" y={y - 2} fill={VALORIA_PALETTE.textBright} fontSize="10" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
              {node.code} · {node.exposurePct}%
            </text>
            <text x="13" y={y + 10} fill={VALORIA_PALETTE.textZinc} fontSize="9">
              {fmtNodeLabel(node.label)}
            </text>
          </g>
        );
      })}

      {customersAndPeers.map((node, idx) => {
        const y =
          28 +
          idx * ((h - 56) / Math.max(1, customersAndPeers.length - 1 || 1));
        const strokeW = Math.max(1.4, node.exposurePct / 16);
        const color = node.role === 'customer' ? VALORIA_PALETTE.emerald : VALORIA_PALETTE.textZinc;
        return (
          <g key={`cust-${node.code}-${idx}`}>
            <path
              d={`M ${centerX + 40} ${centerY} C 298 ${centerY}, 306 ${y}, 340 ${y}`}
              fill="none"
              stroke={color}
              strokeOpacity="0.5"
              strokeWidth={strokeW}
            />
            <rect
              x="340"
              y={y - 16}
              width="134"
              height="32"
              rx="6"
              fill={VALORIA_PALETTE.bgDeep}
              stroke={VALORIA_PALETTE.gridZinc}
            />
            <text x="347" y={y - 2} fill={color} fontSize="10" fontWeight="700" fontFamily="IBM Plex Mono, monospace">
              {node.code} · {node.exposurePct}%
            </text>
            <text x="347" y={y + 10} fill={VALORIA_PALETTE.textZinc} fontSize="9">
              {fmtNodeLabel(node.label)}
            </text>
          </g>
        );
      })}

      <circle
        cx={centerX}
        cy={centerY}
        r="38"
        fill={VALORIA_PALETTE.bgCard}
        stroke={hubStroke}
        strokeWidth="2.2"
      />
      <text
        x={centerX}
        y={centerY - 4}
        textAnchor="middle"
        fill={VALORIA_PALETTE.textWhiteSoft}
        fontSize="12"
        fontWeight="700"
        fontFamily="IBM Plex Mono, monospace"
      >
        {ticker}
      </text>
      <text
        x={centerX}
        y={centerY + 12}
        textAnchor="middle"
        fill={hubStroke}
        fontSize="10"
        fontFamily="IBM Plex Mono, monospace"
      >
        {/* NOMBRE-NON-MONETAIRE : score quantitatif d'entreprise publique */}
        {score100}/100
      </text>
    </svg>
  );
};
