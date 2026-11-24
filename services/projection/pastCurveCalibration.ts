// services/projection/pastCurveCalibration.ts
// Calibrage quantitatif de Monte Carlo sur les courbes réelles depuis janvier 2025.
// Mesure pure (zéro dépendance Zustand, zéro réseau) :
//   1. Rendement mensuel TWR réel pondéré par la valeur fin de mois précédente
//      (strictement insensible aux dépôts / retraits / nouveaux achats du mois).
//   2. Volatilité annualisée réalisée et creux maximal observé (drawdown).
//   3. Évolution réelle du patrimoine net depuis janvier 2025 (placements + cash + immo - dettes).
//   4. Lissage bayésien prudent vers le prior long terme + retour à la moyenne sur 5 ans
//      (demi-vie exponentielle exp(-m / 60)) : évite d'extrapoler naïvement une année haussière ou
//      baissière sur 30 ans.
//
// Règle no-fake-data : toute mesure absente ou insuffisante (< 3 transitions mensuelles réelles ou
// historique de prix manquant) vaut `null`, jamais `0`.

import type { Asset, Debt, RealEstateGoal, Transaction } from '../../types';
import { getEffectivePurchases } from '../../utils/assetPurchases';
import { buildPastPrefix } from '../history/buildPastPrefix';
import { pastNetWorthAt } from '../history/pastNetWorth';
import { reconstructPortfolioHistory, type MinimalAsset } from '../history/reconstructPortfolioHistory';
import { reconstructRealEstateEquityByYear } from '../history/reconstructRealEstateEquity';
import { dettesAuSoldeDuJour } from './debtAmortization';
import { round2 } from './helpers';

export const MONTE_CARLO_PAST_ANCHOR_ISO = '2025-01-01';
export const MONTE_CARLO_PAST_ANCHOR_YM = '2025-01';

const FR_SHORT_MONTHS = [
    'janv.',
    'févr.',
    'mars',
    'avr.',
    'mai',
    'juin',
    'juil.',
    'août',
    'sept.',
    'oct.',
    'nov.',
    'déc.',
] as const;

export interface PastCurveMonthlyPoint {
    ym: string;
    yearDecimal: number;
    label: string;
    portfolioCad: number | null;
    netWorthCad: number | null;
    twrMonthlyReturnPct: number | null;
}

export interface PastCurveCalibration {
    windowStartIso: string;
    windowEndIso: string | null;
    portfolioMonthsObserved: number;
    netWorthMonthsObserved: number;
    realizedAnnualizedReturnPct: number | null;
    realizedAnnualizedVolatilityPct: number | null;
    realizedMaxDrawdownPct: number | null;
    realizedNetWorthStartCad: number | null;
    realizedNetWorthEndCad: number | null;
    realizedNetWorthDeltaCad: number | null;
    calibratedVolatilityPct: number | null;
    calibratedReturnTiltPp: number | null;
    mertonJumpScale: number;
    empiricalWeightPct: number;
    hasUsableCurve: boolean;
    monthlyPoints: PastCurveMonthlyPoint[];
}

/**
 * Paramètres strictement finis transmis dans `SimulationParams` au moteur classique.
 * Aucun champ nullable ici afin de rester compatible avec `verifierEntreesMoteur`.
 */
export interface SimulationPastCurveCalibration {
    windowStartIso: string;
    monthsObserved: number;
    calibratedVolatilityPct: number;
    calibratedReturnTiltPp: number;
    mertonJumpScale: number;
}

export interface ComputePastCurveCalibrationInput {
    assets?: readonly Asset[];
    fxRates?: Record<string, number>;
    transactions?: readonly Transaction[];
    debts?: readonly Debt[];
    realEstateGoals?: readonly RealEstateGoal[];
    calculatedStartingCash?: number;
    priorVolatilityPct?: number;
    priorReturnPct?: number;
    referenceDateIso?: string;
    anchorIso?: string;
}

interface NormalizedPricePoint {
    date: string;
    price: number;
}

interface QualifyingPortfolioAsset {
    asset: Asset;
    minimal: MinimalAsset;
    sortedHist: NormalizedPricePoint[];
    lastHistDate: string;
    fxCad: number;
}

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

function isIsoDate(raw: unknown): raw is string {
    return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.trim());
}

function cleanIsoDate(raw: string): string {
    return raw.trim().slice(0, 10);
}

function resolveFxToCad(currency: string | undefined, fxRates: Record<string, number> | undefined): number {
    const cur = (currency ?? 'CAD').trim().toUpperCase();
    if (!cur || cur === 'CAD') return 1;
    if (!fxRates) return 1;
    const direct = fxRates[currency ?? cur] ?? fxRates[cur];
    return typeof direct === 'number' && Number.isFinite(direct) && direct > 0 ? direct : 1;
}

function cleanFxMap(fxRates: Record<string, number> | undefined): Record<string, number> {
    const out: Record<string, number> = {};
    if (!fxRates) return out;
    for (const [k, v] of Object.entries(fxRates)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
            out[k] = v;
        }
    }
    return out;
}

function endOfMonthIso(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 0));
    return d.toISOString().slice(0, 10);
}

function nextYearMonth(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    const ny = m >= 12 ? y + 1 : y;
    const nm = m >= 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2, '0')}`;
}

function listYearMonths(startYm: string, endYm: string): string[] {
    if (startYm > endYm) return [];
    const out: string[] = [];
    let cur = startYm;
    let guard = 0;
    while (cur <= endYm && guard < 240) {
        out.push(cur);
        cur = nextYearMonth(cur);
        guard++;
    }
    return out;
}

function formatYmLabelFr(ym: string): string {
    const [y, m] = ym.split('-').map(Number);
    const label = FR_SHORT_MONTHS[((m || 1) - 1 + 12) % 12] ?? 'janv.';
    return `${label} ${y}`;
}

function ymToYearDecimal(ym: string): number {
    const [y, m] = ym.split('-').map(Number);
    return Number((y + ((m || 1) - 1) / 12).toFixed(4));
}

function stepLookupPoint(hist: readonly NormalizedPricePoint[], iso: string): NormalizedPricePoint | null {
    let lo = 0;
    let hi = hist.length - 1;
    let bestIdx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (hist[mid].date <= iso) {
            bestIdx = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return bestIdx >= 0 ? hist[bestIdx] : null;
}

function normalizePriceHistory(rawHistory: Asset['priceHistory']): NormalizedPricePoint[] {
    if (!Array.isArray(rawHistory) || rawHistory.length === 0) return [];
    const byDate = new Map<string, number>();
    for (const pt of rawHistory) {
        if (!pt || !isIsoDate(pt.date) || typeof pt.price !== 'number' || !Number.isFinite(pt.price) || pt.price <= 0) {
            continue;
        }
        byDate.set(cleanIsoDate(pt.date), pt.price);
    }
    return Array.from(byDate.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([date, price]) => ({ date, price }));
}

function holdingsQuantityAt(asset: Asset, purchases: ReturnType<typeof getEffectivePurchases>, iso: string): number {
    if (purchases.length > 0) {
        let sum = 0;
        for (const p of purchases) {
            if (isIsoDate(p.date) && cleanIsoDate(p.date) <= iso && Number.isFinite(p.quantity)) {
                sum += p.quantity;
            }
        }
        return Math.max(0, sum);
    }
    if (isIsoDate(asset.dateBought)) {
        return cleanIsoDate(asset.dateBought) <= iso ? Math.max(0, asset.quantity || 0) : 0;
    }
    return Math.max(0, asset.quantity || 0);
}

function resolveCapDateIso(
    referenceDateIso: string | undefined,
    qualifyingAssets: readonly QualifyingPortfolioAsset[],
    transactions: readonly Transaction[],
): string {
    if (isIsoDate(referenceDateIso)) {
        return cleanIsoDate(referenceDateIso);
    }
    let latestObserved = '';
    for (const qa of qualifyingAssets) {
        if (qa.lastHistDate > latestObserved) latestObserved = qa.lastHistDate;
    }
    for (const tx of transactions) {
        if (tx && !tx.isDuplicate && isIsoDate(tx.date)) {
            const d = cleanIsoDate(tx.date);
            if (d > latestObserved) latestObserved = d;
        }
    }
    return latestObserved || new Date().toISOString().slice(0, 10);
}

/**
 * Mesure les courbes réelles depuis `anchorIso` (par défaut `'2025-01-01'`)
 * et dérive un calibrage Monte Carlo borné et prudent.
 */
export function computePastCurveCalibration(
    input: ComputePastCurveCalibrationInput,
): PastCurveCalibration {
    const anchorIso = isIsoDate(input.anchorIso) ? cleanIsoDate(input.anchorIso) : MONTE_CARLO_PAST_ANCHOR_ISO;
    const anchorYm = anchorIso.slice(0, 7);
    const priorVol = Number.isFinite(input.priorVolatilityPct) ? clamp(input.priorVolatilityPct as number, 6, 35) : 14.5;
    const priorRet = Number.isFinite(input.priorReturnPct) ? clamp(input.priorReturnPct as number, -5, 25) : 6.5;

    const rawAssets = (input.assets ?? []).filter(
        (a): a is Asset => Boolean(a) && Number.isFinite(a.quantity),
    );
    const fxMap = cleanFxMap(input.fxRates);
    const rawTransactions = (input.transactions ?? []).filter(
        (t): t is Transaction => Boolean(t) && !t.isDuplicate && Number.isFinite(t.amount) && isIsoDate(t.date),
    );

    const minimalAssets: MinimalAsset[] = [];
    const qualifyingAssets: QualifyingPortfolioAsset[] = [];

    for (const asset of rawAssets) {
        const purchases = getEffectivePurchases(asset);
        const sortedHist = normalizePriceHistory(asset.priceHistory);
        const minimal: MinimalAsset = {
            symbol: asset.symbol,
            quantity: asset.quantity || 0,
            currency: asset.currency || 'CAD',
            currentPrice: asset.currentPrice || 0,
            accountType: asset.accountType,
            dateBought: asset.dateBought,
            purchases,
            priceHistory: sortedHist,
            priceUpdatedAt: asset.priceUpdatedAt,
        };
        if ((asset.quantity || 0) > 0 || purchases.length > 0) {
            minimalAssets.push(minimal);
        }
        if (sortedHist.length >= 2) {
            const lastHistDate = sortedHist[sortedHist.length - 1].date;
            if (lastHistDate >= anchorIso && ((asset.quantity || 0) > 0 || purchases.length > 0)) {
                qualifyingAssets.push({
                    asset,
                    minimal,
                    sortedHist,
                    lastHistDate,
                    fxCad: resolveFxToCad(asset.currency, fxMap),
                });
            }
        }
    }

    const capIso = resolveCapDateIso(input.referenceDateIso, qualifyingAssets, rawTransactions);
    const capYm = capIso.slice(0, 7);
    const allYms = capYm >= anchorYm ? listYearMonths(anchorYm, capYm) : [];

    // 1. Rendements mensuels TWR sans biais de dépôts (détentions fin de mois précédent × delta prix)
    const twrReturnsByYm = new Map<string, number>();
    const twrReturns: number[] = [];
    let lastTwrDate: string | null = null;

    for (let i = 1; i < allYms.length; i++) {
        const ymPrev = allYms[i - 1];
        const ymCurr = allYms[i];
        const isoPrev = endOfMonthIso(ymPrev);
        const monthEndCurr = endOfMonthIso(ymCurr);
        const isoCurr = ymCurr === capYm && capIso < monthEndCurr ? capIso : monthEndCurr;
        const monthStartCurr = `${ymCurr}-01`;

        let prevValCad = 0;
        let currSameHoldingsCad = 0;
        let anyUpdatedPrice = false;

        for (const qa of qualifyingAssets) {
            if (qa.lastHistDate < monthStartCurr) continue;
            const qPrev = holdingsQuantityAt(qa.asset, qa.minimal.purchases ?? [], isoPrev);
            if (qPrev <= 0) continue;

            const prevPt = stepLookupPoint(qa.sortedHist, isoPrev);
            const currPt = stepLookupPoint(qa.sortedHist, isoCurr);
            if (!prevPt || !currPt) continue;

            if (currPt.date > prevPt.date) {
                anyUpdatedPrice = true;
            }
            prevValCad += qPrev * prevPt.price * qa.fxCad;
            currSameHoldingsCad += qPrev * currPt.price * qa.fxCad;
        }

        if (anyUpdatedPrice && prevValCad > 0 && currSameHoldingsCad > 0) {
            const r = currSameHoldingsCad / prevValCad - 1;
            if (Number.isFinite(r) && r > -0.95 && r < 3.0) {
                twrReturns.push(r);
                twrReturnsByYm.set(ymCurr, r);
                lastTwrDate = isoCurr;
            }
        }
    }

    const n = twrReturns.length;
    const hasUsableCurve = n >= 3;

    let realizedAnnualizedReturnPct: number | null = null;
    let realizedAnnualizedVolatilityPct: number | null = null;
    let realizedMaxDrawdownPct: number | null = null;
    let calibratedVolatilityPct: number | null = null;
    let calibratedReturnTiltPp: number | null = null;
    let mertonJumpScale = 1.0;
    let empiricalWeightPct = 0;

    if (hasUsableCurve) {
        let cum = 1.0;
        let peak = 1.0;
        let maxDd = 0;
        const logRets: number[] = [];

        for (const r of twrReturns) {
            cum *= 1 + r;
            if (cum > peak) peak = cum;
            const dd = (cum - peak) / peak;
            if (dd < maxDd) maxDd = dd;
            logRets.push(Math.log(Math.max(1e-4, 1 + r)));
        }

        const meanLog = logRets.reduce((s, x) => s + x, 0) / n;
        const varianceLog =
            logRets.reduce((s, x) => s + (x - meanLog) * (x - meanLog), 0) / Math.max(1, n - 1);

        realizedAnnualizedReturnPct = round2(clamp((Math.pow(cum, 12 / n) - 1) * 100, -85, 200));
        realizedAnnualizedVolatilityPct = round2(clamp(Math.sqrt(varianceLog * 12) * 100, 0.5, 80));
        realizedMaxDrawdownPct = round2(Math.min(0, maxDd * 100));

        const wVol = clamp(n / (n + 12), 0, 0.65);
        calibratedVolatilityPct = round2(
            clamp((1 - wVol) * priorVol + wVol * realizedAnnualizedVolatilityPct, 6.0, 32.0),
        );

        const wRet = clamp(n / (n + 36), 0, 0.35);
        const rawDiff = clamp(realizedAnnualizedReturnPct - priorRet, -15, 15);
        calibratedReturnTiltPp = round2(clamp(wRet * rawDiff, -2.0, 2.0));

        if (realizedMaxDrawdownPct < -15) {
            mertonJumpScale = round2(clamp(1 + (Math.abs(realizedMaxDrawdownPct) - 15) / 50, 1.0, 1.35));
        }
        empiricalWeightPct = Math.round(wVol * 100);
    }

    // 2. Courbe mensuelle du portefeuille et du patrimoine net réel depuis janv. 2025
    const portfolioByYm = new Map<string, number>();
    const histRes =
        minimalAssets.length > 0 && capYm >= anchorYm
            ? reconstructPortfolioHistory(minimalAssets, fxMap, {
                  today: new Date(`${capIso}T12:00:00Z`),
              })
            : { points: [], coverage: 1, firstDate: null };

    for (const p of histRes.points) {
        const ym = p.date.slice(0, 7);
        if (ym >= anchorYm && ym <= capYm && Number.isFinite(p.InvestedValue)) {
            portfolioByYm.set(ym, round2(p.InvestedValue));
        }
    }

    const netWorthByYm = new Map<string, number>();
    const startYear = Number(capIso.slice(0, 4));
    const startMonth = Number(capIso.slice(5, 7)) - 1;
    const hasStartingCash =
        typeof input.calculatedStartingCash === 'number' && Number.isFinite(input.calculatedStartingCash);

    if (
        hasStartingCash &&
        rawTransactions.length > 0 &&
        Number.isFinite(startYear) &&
        Number.isFinite(startMonth) &&
        capYm >= anchorYm
    ) {
        const adjustedDebts = dettesAuSoldeDuJour(input.debts ?? [], capIso, rawTransactions);
        let currentDebtNonImmo = 0;
        for (const d of adjustedDebts) {
            if (!d) continue;
            if (isIsoDate(d.startDate) && cleanIsoDate(d.startDate) > capIso) continue;
            if (Number.isFinite(d.balance) && d.balance > 0) {
                currentDebtNonImmo += d.balance;
            }
        }

        const prefix = buildPastPrefix({
            pastHistoryPoints: histRes.points,
            transactions: rawTransactions,
            calculatedStartingCash: input.calculatedStartingCash as number,
            realEstateGoals: input.realEstateGoals ?? [],
            startYear,
            startMonth,
            todayIso: capIso,
            currentDebtNonImmo,
            debts: adjustedDebts,
        });

        for (const pt of prefix.points) {
            const ym = pt.dateLabel.slice(0, 7);
            if (ym >= anchorYm && ym <= capYm && typeof pt.NetWorth === 'number' && Number.isFinite(pt.NetWorth)) {
                netWorthByYm.set(ym, pt.NetWorth);
            }
        }

        // Point du mois courant (`capYm`) ancré exactement sur le cash actuel + placements courants + immo - dettes
        const equityByYear = reconstructRealEstateEquityByYear(input.realEstateGoals ?? [], startYear);
        const lastInvPt = histRes.points[histRes.points.length - 1];
        const immoNow = equityByYear.get(startYear) ?? 0;
        const nwNow = pastNetWorthAt(
            {
                CELI: lastInvPt?.CELI ?? 0,
                CELIAPP: lastInvPt?.CELIAPP ?? 0,
                REER: lastInvPt?.REER ?? 0,
                REEE: lastInvPt?.REEE ?? 0,
                NonReg: lastInvPt?.NonReg ?? 0,
                Crypto: lastInvPt?.Crypto ?? 0,
            },
            input.calculatedStartingCash as number,
            immoNow,
            currentDebtNonImmo,
        );
        if (Number.isFinite(nwNow)) {
            netWorthByYm.set(capYm, nwNow);
        }
    }

    const monthlyPoints: PastCurveMonthlyPoint[] = [];
    for (const ym of allYms) {
        const portVal = portfolioByYm.get(ym) ?? null;
        const nwVal = netWorthByYm.get(ym) ?? null;
        const twr = twrReturnsByYm.get(ym);
        if (portVal === null && nwVal === null && twr === undefined) continue;
        monthlyPoints.push({
            ym,
            yearDecimal: ymToYearDecimal(ym),
            label: formatYmLabelFr(ym),
            portfolioCad: portVal,
            netWorthCad: nwVal,
            twrMonthlyReturnPct: twr !== undefined ? round2(twr * 100) : null,
        });
    }

    const nwValues = monthlyPoints
        .map((p) => p.netWorthCad)
        .filter((v): v is number => v !== null && Number.isFinite(v));

    const realizedNetWorthStartCad = nwValues.length >= 2 ? nwValues[0] : null;
    const realizedNetWorthEndCad = nwValues.length >= 2 ? nwValues[nwValues.length - 1] : null;
    const realizedNetWorthDeltaCad =
        realizedNetWorthStartCad !== null && realizedNetWorthEndCad !== null
            ? round2(realizedNetWorthEndCad - realizedNetWorthStartCad)
            : null;

    const windowEndIso = lastTwrDate ?? (allYms.length > 0 && monthlyPoints.length > 0 ? capIso : null);

    return {
        windowStartIso: anchorIso,
        windowEndIso,
        portfolioMonthsObserved: n,
        netWorthMonthsObserved: nwValues.length,
        realizedAnnualizedReturnPct,
        realizedAnnualizedVolatilityPct,
        realizedMaxDrawdownPct,
        realizedNetWorthStartCad,
        realizedNetWorthEndCad,
        realizedNetWorthDeltaCad,
        calibratedVolatilityPct,
        calibratedReturnTiltPp,
        mertonJumpScale,
        empiricalWeightPct,
        hasUsableCurve,
        monthlyPoints,
    };
}

/**
 * Extrait un sous-contrat strictement fini pour `SimulationParams`.
 * Retourne `undefined` si la courbe depuis janv. 2025 est insuffisante (strict `no-fake-data`).
 */
export function toSimulationPastCurveCalibration(
    cal: PastCurveCalibration | null | undefined,
): SimulationPastCurveCalibration | undefined {
    if (!cal || !cal.hasUsableCurve) return undefined;
    if (
        typeof cal.calibratedVolatilityPct !== 'number' ||
        !Number.isFinite(cal.calibratedVolatilityPct) ||
        typeof cal.calibratedReturnTiltPp !== 'number' ||
        !Number.isFinite(cal.calibratedReturnTiltPp) ||
        !Number.isFinite(cal.mertonJumpScale) ||
        !Number.isFinite(cal.portfolioMonthsObserved) ||
        cal.portfolioMonthsObserved < 3
    ) {
        return undefined;
    }
    return {
        windowStartIso: cal.windowStartIso,
        monthsObserved: cal.portfolioMonthsObserved,
        calibratedVolatilityPct: cal.calibratedVolatilityPct,
        calibratedReturnTiltPp: cal.calibratedReturnTiltPp,
        mertonJumpScale: cal.mertonJumpScale,
    };
}
