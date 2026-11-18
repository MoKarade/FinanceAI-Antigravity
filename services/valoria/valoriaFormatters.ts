import { formatCAD, formatCompactCAD, formatPercent } from '../../utils/format';

export const BASE_CURRENCY_CODE = 'CAD';
export const BASE_CURRENCY_LABEL = '$ CAD';

const FMT_NUM_3 = new Intl.NumberFormat('fr-CA', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/**
 * Formate un montant en dollars canadiens ($ CAD), ex. « 232 642 $ » ou « 246,37 $ ».
 * Retourne « — » pour toute valeur non finie (règle no-fake-data).
 * Alias `formatEur` conservé pour rétrocompatibilité des composants Valoria.
 */
export function formatCad(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  if (decimals === 0 || decimals === 2) {
    return formatCAD(value, { decimals });
  }
  const safeDecimals = Math.max(0, Math.min(6, Math.round(decimals)));
  if (safeDecimals === 3) {
    return `${FMT_NUM_3.format(value)}\u00A0$`;
  }
  return `${new Intl.NumberFormat('fr-CA', {
    minimumFractionDigits: safeDecimals,
    maximumFractionDigits: safeDecimals,
  }).format(value)}\u00A0$`;
}

export function formatEur(value: number, decimals = 0): string {
  return formatCad(value, decimals);
}

export function formatSignedCad(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  const formatted = formatCad(Math.abs(value), decimals);
  if (value > 0.005) return `+${formatted}`;
  if (value < -0.005) return `-${formatted}`;
  return formatCad(0, decimals);
}

export function formatSignedEur(value: number, decimals = 0): string {
  return formatSignedCad(value, decimals);
}

export function formatPct(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return formatPercent(value, decimals);
}

export function formatSignedPct(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const abs = formatPercent(Math.abs(value), decimals);
  if (value > 0.005) return `+${abs}`;
  if (value < -0.005) return `-${abs}`;
  return formatPercent(0, decimals);
}

export function formatCompactCad(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  return formatCompactCAD(value, { precis: abs >= 1_000 && abs < 10_000 });
}

export function formatCompactEur(value: number): string {
  return formatCompactCad(value);
}

export function formatPriceCad(price: number): string {
  if (!Number.isFinite(price)) return '—';
  if (price >= 1000) {
    return formatCad(price, 0);
  }
  if (price >= 10) {
    return formatCad(price, 2);
  }
  return formatCad(price, 3);
}

export function formatPriceEur(price: number): string {
  return formatPriceCad(price);
}
