// services/realEstateDecider.ts
// Module pur d'aide à la décision immobilière (« Est-ce que ça vaut le coup à ce prix et à cette date ? »).
// Règle no-fake-data : jamais de montant ou ratio inventé — `null` si projection ou revenu manquant.

import type { Debt, RealEstateGoal, RetirementGoal } from '../types';
import type { ProjectionChartPoint, ProjectionResult } from './projection/types';
import { formatCAD, formatPercent } from '../utils/format';
import {
    calculateB20StressTest,
    calculateNewHomeRebateTotal,
    calculateSchlPremium,
    calculateWelcomeTax,
    computeCanadianMortgagePayment,
} from './realEstate';
import { isOwnedToday } from './realEstatePartition';

export type RealEstateVerdict = 'feu_vert' | 'tendu' | 'risque';

export interface EvaluateRealEstateDecisionInput {
    goal: RealEstateGoal;
    lastProjection: ProjectionResult | null;
    debts: readonly Debt[];
    monthlyGrossIncome: number | null;
    currentRentMonthly?: number;
    retirementGoal?: Partial<RetirementGoal> | null;
    currentDateIso?: string;
    notaryFees?: number;
    inspectionFees?: number;
}

export interface RealEstateDecisionResult {
    verdict: RealEstateVerdict;
    verdictLabel: string;
    reasonsFr: string[];
    purchaseDateIso: string;
    monthsUntilPurchase: number;
    isAlreadyOwned: boolean;
    projectedCashAtDate: number | null;
    totalCashNeeded: number;
    cashGapAtDate: number | null;
    welcomeTax: number;
    schlPremium: number;
    schlAvailable: boolean;
    newHomeRebate: number;
    totalMortgageWithSchl: number;
    monthlyMortgagePayment: number;
    monthlyHousingTotal: number;
    otherDebtMonthly: number;
    b20GdsPct: number | null;
    b20TdsPct: number | null;
    b20Passes: boolean | null;
    retirementAgeDeltaYears: number | null;
}

function parseIsoYearMonth(iso: string): { year: number; month: number } | null {
    const m = /^(\d{4})-(\d{2})/.exec((iso ?? '').trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) return null;
    return { year, month };
}

function readProjectedCashAtMonth(
    chartData: readonly ProjectionChartPoint[] | undefined,
    targetMonthOffset: number,
): number | null {
    if (!chartData || chartData.length === 0 || !Number.isFinite(targetMonthOffset)) return null;
    const clampedOffset = Math.max(0, Math.round(targetMonthOffset));
    const lastPt = chartData[chartData.length - 1];
    if (!lastPt || clampedOffset > (lastPt.monthIndex ?? 0) + 12) return null;

    let match = chartData.find((p) => Math.trunc(p.monthIndex) >= clampedOffset);
    if (!match) match = lastPt;

    const liq = typeof match.Liquidites === 'number' && Number.isFinite(match.Liquidites) ? match.Liquidites : 0;
    const celiapp = typeof match.CELIAPP === 'number' && Number.isFinite(match.CELIAPP) ? match.CELIAPP : 0;
    const celi = typeof match.CELI === 'number' && Number.isFinite(match.CELI) ? match.CELI : 0;
    const total = Math.round(liq + celiapp + celi);
    return Number.isFinite(total) ? total : null;
}

/**
 * Évalue la faisabilité financière et l'impact d'un projet immobilier à son prix et sa date visés.
 */
export function evaluateRealEstateDecision(input: EvaluateRealEstateDecisionInput): RealEstateDecisionResult {
    const {
        goal,
        lastProjection,
        debts,
        monthlyGrossIncome,
        currentRentMonthly = 0,
        retirementGoal,
        currentDateIso = new Date().toISOString().slice(0, 10),
        notaryFees = 1_500,
        inspectionFees = 800,
    } = input;

    const price = Math.max(0, Number.isFinite(goal.price) ? goal.price : 0);
    const downPayment = Math.max(0, Number.isFinite(goal.downPayment) ? goal.downPayment : 0);
    const rate = Math.max(0, Number.isFinite(goal.mortgageRate) ? goal.mortgageRate : 4.5);
    const amortization = Math.max(1, Math.min(35, Number.isFinite(goal.amortization) ? goal.amortization : 25));

    const purchaseDateIso = goal.purchaseDate || currentDateIso;
    const nowRef = parseIsoYearMonth(currentDateIso);
    const buyRef = parseIsoYearMonth(purchaseDateIso);
    const monthsUntilPurchase =
        nowRef && buyRef ? (buyRef.year - nowRef.year) * 12 + (buyRef.month - nowRef.month) : 0;

    const nowDate = nowRef ? new Date(nowRef.year, nowRef.month, 15) : new Date();
    const isAlreadyOwned = isOwnedToday(goal, nowDate);

    const welcomeTax = calculateWelcomeTax(price, goal.municipality);
    const schl = calculateSchlPremium({ price, downPayment, isFirstTimeBuyer: goal.isFirstTimeBuyer });
    const newHomeRebate = calculateNewHomeRebateTotal(price, Boolean(goal.isNewConstruction));
    const initialRenovations =
        typeof goal.initialRenovations === 'number' && Number.isFinite(goal.initialRenovations)
            ? Math.max(0, goal.initialRenovations)
            : 0;
    const totalCashNeeded = Math.max(
        0,
        Math.round(downPayment + welcomeTax + notaryFees + inspectionFees + initialRenovations - newHomeRebate),
    );

    const baseLoan = Math.max(0, price - downPayment);
    const totalMortgageWithSchl = Math.round(baseLoan + (schl.required ? schl.premium : 0));
    const monthlyMortgagePayment = computeCanadianMortgagePayment(
        totalMortgageWithSchl,
        rate,
        amortization * 12,
    );

    const taxesMonthly = Math.max(0, Number(goal.taxesYearly) || 0) / 12;
    const heatingMonthly = Math.max(0, Number(goal.heatingMonthly) || 0);
    const condoFees = Math.max(0, Number(goal.condoFees) || 0);
    const rentalIncome = goal.isRented ? Math.max(0, Number(goal.rentalIncomeMonthly) || 0) : 0;
    const maintenanceMonthly = (price * 0.01) / 12;
    const monthlyHousingTotal = Math.max(
        0,
        Math.round(monthlyMortgagePayment + taxesMonthly + heatingMonthly + condoFees + maintenanceMonthly - rentalIncome),
    );

    const otherDebtMonthly = Math.round(
        (debts ?? [])
            .filter((d) => Number.isFinite(d.balance) && d.balance > 0 && d.kind !== 'mortgage')
            .reduce((sum, d) => sum + Math.max(0, Number(d.minimumPayment) || 0), 0),
    );

    const hasIncome =
        monthlyGrossIncome !== null && Number.isFinite(monthlyGrossIncome) && monthlyGrossIncome > 0;
    let b20GdsPct: number | null = null;
    let b20TdsPct: number | null = null;
    let b20Passes: boolean | null = null;

    if (hasIncome && totalMortgageWithSchl > 0) {
        const monthlyHousingExcl = taxesMonthly + heatingMonthly + condoFees * 0.5;
        const b20 = calculateB20StressTest({
            contractRate: rate,
            loanAmount: totalMortgageWithSchl,
            amortization,
            monthlyHousingChargesExclMortgage: monthlyHousingExcl,
            monthlyGrossIncome: monthlyGrossIncome!,
            otherDebtMonthly,
        });
        b20GdsPct = Number((b20.gds * 100).toFixed(1));
        b20TdsPct = Number((b20.tds * 100).toFixed(1));
        b20Passes = b20.passes;
    }

    const projectedCashAtDate = isAlreadyOwned
        ? readProjectedCashAtMonth(lastProjection?.chartData, 0)
        : readProjectedCashAtMonth(lastProjection?.chartData, monthsUntilPurchase);
    const cashGapAtDate =
        projectedCashAtDate !== null ? Math.round(projectedCashAtDate - totalCashNeeded) : null;

    let retirementAgeDeltaYears: number | null = null;
    if (lastProjection?.chartData && lastProjection.chartData.length >= 2 && totalCashNeeded > 0) {
        const annualCarryDelta = (monthlyHousingTotal - Math.max(0, currentRentMonthly)) * 12;
        const opportunityAnnual = totalCashNeeded * 0.04;
        const annualBurden = annualCarryDelta + opportunityAnnual;
        const annualRetNeed = Math.max(24_000, (Number(retirementGoal?.targetMonthlyIncome) || 4_000) * 12);
        const rawDelta = Math.max(-4, Math.min(6, (annualBurden / annualRetNeed) * 1.5));
        retirementAgeDeltaYears = Number((Math.round(rawDelta * 2) / 2).toFixed(1));
    }

    const reasonsFr: string[] = [];
    let verdict: RealEstateVerdict = 'feu_vert';

    if (!schl.available) {
        verdict = 'risque';
        reasonsFr.push('La mise de fonds est sous le minimum requis ou le prix dépasse les limites assurables.');
    }
    if (!isAlreadyOwned && cashGapAtDate !== null) {
        if (cashGapAtDate < -5_000) {
            verdict = 'risque';
            reasonsFr.push(
                `Il manquerait environ ${formatCAD(Math.abs(cashGapAtDate))} à cette date pour couvrir la mise de fonds et les frais.`,
            );
        } else if (cashGapAtDate < 10_000) {
            if (verdict !== 'risque') verdict = 'tendu';
            reasonsFr.push(
                `Marge de sécurité serrée après l’achat : il resterait environ ${formatCAD(Math.max(0, cashGapAtDate))}.`,
            );
        } else {
            reasonsFr.push(
                `Ton épargne prévue à la date choisie couvre l’achat avec environ ${formatCAD(cashGapAtDate)} de réserve.`,
            );
        }
    } else if (!isAlreadyOwned) {
        if (verdict !== 'risque') verdict = 'tendu';
        reasonsFr.push('Lance la projection dans Futur pour vérifier le montant disponible à cette date.');
    }

    if (b20Passes === false && b20TdsPct !== null) {
        const severe = b20TdsPct > 48 || (b20GdsPct ?? 0) > 43;
        verdict = severe ? 'risque' : verdict === 'risque' ? 'risque' : 'tendu';
        reasonsFr.push(
            `Capacité d’emprunt serrée au test bancaire : ${formatPercent(b20TdsPct, 0)} du revenu brut (seuil usuel 44 %).`,
        );
    } else if (b20Passes === true && b20TdsPct !== null) {
        reasonsFr.push(
            `Le paiement passe le test bancaire canadien (${formatPercent(b20TdsPct, 0)} du revenu brut, dettes incluses).`,
        );
    }

    const verdictLabel =
        verdict === 'feu_vert' ? 'Feu vert' : verdict === 'tendu' ? 'Budget tendu' : 'Risqué à cette date';

    return {
        verdict,
        verdictLabel,
        reasonsFr: reasonsFr.slice(0, 3),
        purchaseDateIso,
        monthsUntilPurchase,
        isAlreadyOwned,
        projectedCashAtDate,
        totalCashNeeded,
        cashGapAtDate,
        welcomeTax: Math.round(welcomeTax),
        schlPremium: Math.round(schl.premium),
        schlAvailable: schl.available,
        newHomeRebate: Math.round(newHomeRebate),
        totalMortgageWithSchl,
        monthlyMortgagePayment: Math.round(monthlyMortgagePayment),
        monthlyHousingTotal,
        otherDebtMonthly,
        b20GdsPct,
        b20TdsPct,
        b20Passes,
        retirementAgeDeltaYears,
    };
}
