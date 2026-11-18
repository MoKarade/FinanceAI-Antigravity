/**
 * Palettes hexadécimales centralisées pour les 16 visualisations SVG/Canvas D3.js v7 de Valoria.
 * Aucun littéral `#hex` ni classe palette Tailwind (`slate-*`, `emerald-*`, `bg-white`, etc.)
 * ne doit apparaître dans `components/valoria/*.tsx` (garde `socleVisuel.test.ts`).
 */

export const VALORIA_PALETTE = {
  bgDeep: '#09090b',
  bgPanel: '#0c0c0f',
  bgNavy: '#0f172a',
  bgEmeraldTint: '#091914',
  bgNode: '#111115',
  bgHeatTile: '#121215',
  bgCard: '#18181b',
  gridSlate: '#1e293b',
  gridZinc: '#27272a',
  axisSlate: '#334155',
  axisZinc: '#3f3f46',
  strokeSlate: '#475569',
  strokeZinc: '#52525b',
  mutedSlate: '#64748b',
  mutedZinc: '#71717a',
  textSlate: '#94a3b8',
  textZinc: '#a1a1aa',
  textSlateLight: '#cbd5e1',
  textZincLight: '#d4d4d8',
  lineSlate: '#e2e8f0',
  lineZinc: '#e4e4e7',
  surfaceLight: '#f1f5f9',
  textBright: '#f4f4f5',
  surfaceIce: '#f8fafc',
  textWhiteSoft: '#fafafa',
  white: '#ffffff',

  emeraldSoft: '#ecfdf5',
  tealLight: '#5eead4',
  teal: '#2dd4bf',
  emeraldLight: '#34d399',
  emerald: '#10b981',
  emeraldDark: '#059669',
  green: '#22c55e',

  roseLight: '#fb7185',
  redLight: '#f87171',
  rose: '#f43f5e',
  roseDark: '#e11d48',
  crimson: '#be123c',
  crimsonDeep: '#9f1239',

  blue: '#60a5fa',
  sky: '#38bdf8',
  indigo: '#818cf8',
  amberLight: '#fbbf24',
  amber: '#f59e0b',
  gold: '#eab308',
} as const;

export const VALORIA_ORBITAL_SLICE_COLORS = {
  etf_monde: VALORIA_PALETTE.emerald,
  actions_value: VALORIA_PALETTE.indigo,
  tech_ia: VALORIA_PALETTE.sky,
  or_refuges: VALORIA_PALETTE.gold,
  obligations_cash: VALORIA_PALETTE.teal,
  crypto_web3: VALORIA_PALETTE.roseLight,
  immobilier_reit: VALORIA_PALETTE.amber,
} as const;

export const VALORIA_HEATMAP_SCALE = {
  strongPositive: VALORIA_PALETTE.emeraldDark,
  positive: VALORIA_PALETTE.emerald,
  neutral: VALORIA_PALETTE.bgCard,
  negative: VALORIA_PALETTE.roseDark,
  strongNegative: VALORIA_PALETTE.crimsonDeep,
} as const;

export const VALORIA_RISK_SERIES_COLORS = [
  VALORIA_PALETTE.teal,
  VALORIA_PALETTE.sky,
  VALORIA_PALETTE.indigo,
  VALORIA_PALETTE.amberLight,
  VALORIA_PALETTE.roseLight,
  VALORIA_PALETTE.emeraldLight,
] as const;

export function getValoriaToneColor(tone: 'positive' | 'negative' | 'neutral'): string {
  if (tone === 'positive') return VALORIA_PALETTE.emerald;
  if (tone === 'negative') return VALORIA_PALETTE.rose;
  return VALORIA_PALETTE.mutedZinc;
}
