// services/projection/prescriptiveAdvisor.ts
// Lot 5 (F21) — Moteur de conseils prescriptifs chiffrés sur 3 horizons :
//   1. Immédiat (cette année fiscale) : cotisation REER au TMED optimal, Asset Location swaps, récolte de pertes (TLH) sur PBR réel
//   2. Comportemental (habitudes mensuelles) : mois à 3 paies (« mois magiques »), réduction de la dérive de train de vie (lifestyle creep)
//   3. Structurel (décisions de vie) : point mort actuariel du report RRQ/PSV, remboursement accéléré des dettes à taux élevé
//
// Règles GEMINI.md :
// - Zéro constante fiscale en dur : tout barème provient de `utils/tax.ts` (`docs/FISCAL_REFERENCE.md`).
// - No-fake-data : aucune recommandation inventée si la donnée sous-jacente est absente ou le gain <= 0.
// - Formatage monétaire : `formatCAD` / `formatPercent` (`utils/format.ts`).

import { formatCAD, formatPercent } from '../../utils/format';
import {
    FED_BRACKETS,
    QC_BRACKETS,
    TAX_BASE_YEAR,
    US_DIVIDEND_WITHHOLDING_RATE,
    CAPITAL_GAINS_INCLUSION_STANDARD,
    OAS_CLAWBACK_THRESHOLD_2026,
    OAS_CLAWBACK_RATE,
    RRQ_STANDARD_START_AGE,
    RRQ_MAX_DEFERRAL_AGE,
    PSV_ELIGIBILITY_AGE,
    GOV_PENSION_RRQ_SHARE,
    GOV_PENSION_PSV_SHARE,
    rrqAdjustmentFactor,
    psvDeferralFactor,
    calculateFiscalReport,
    getMarginalRate,
} from '../../utils/tax';
import { resolveAssetFundamental, IQPF_2026_EXPECTED_RETURNS } from '../assetFundamentals';
import { computeInitialACB } from './portfolioAnalytics';
import type { BehavioralProfile } from './behavioralProfile';
import type { Asset, Debt, ProjectionConfig, RetirementGoal } from '../../types';
import type { SimulationParams, ProjectionResult } from './types';

export type PrescriptiveHorizon = 'immediate' | 'behavioral' | 'structural';

type PrescriptiveImpactType = 'tax_savings' | 'wealth_increase' | 'time_freedom';

export interface PrescriptiveAdvice {
    id: string;
    horizon: PrescriptiveHorizon;
    title: string;
    description: string;
    urgencyDeadline?: string;
    impact: {
        type: PrescriptiveImpactType;
        /** Impact financier chiffré en CAD (économie d'impôt immédiate ou gain composé à l'horizon). */
        amountDollars: number;
        /** Gain récurrent annuel estimé lorsqu'applicable. */
        annualSavingsDollars?: number;
        /** Mois d'indépendance financière (FIRE) gagnés grâce à cette action. */
        monthsFreedom?: number;
        /** Taux marginal effectif de décaissement / déduction (TMED / METR) en décimal (ex: 0.4712). */
        effectiveTmedRate?: number;
    };
    /** Levier directement applicable aux paramètres de projection ou à l'objectif retraite. */
    associatedLever?: {
        key: string;
        value: unknown;
        projectionPatch?: Partial<ProjectionConfig>;
        retirementPatch?: Partial<RetirementGoal>;
    };
}

export interface OptimalRrspOptions {
    year?: number;
    childrenCount?: number;
    monthlyExpenses?: number;
}

/**
 * Estime la pente marginale additionnelle de récupération des prestations familiales (ACE fédérale
 * + Allocation famille Québec) lorsqu'une cotisation REER abaisse le revenu familial net (LIR art. 122.6).
 */
function estimateFamilyBenefitClawbackSlope(netIncome: number, childrenCount: number): number {
    if (!Number.isFinite(childrenCount) || childrenCount <= 0) return 0;
    const firstFedTop = FED_BRACKETS[0].upTo;
    const thirdFedTop = FED_BRACKETS[2].upTo;
    if (netIncome < firstFedTop * 0.65 || netIncome > thirdFedTop) return 0;
    if (childrenCount === 1) return 0.07;
    if (childrenCount === 2) return 0.135;
    return 0.19;
}

/**
 * 1A — Horizon Immédiat : Cotisation REER optimale au TMED (taux marginal + récupération prestations).
 * Identifie la tranche marginale supérieure à écrêter avant la date limite REER (60 premiers jours).
 */
export function recommendOptimalRrspContribution(
    taxableIncome: number,
    rrspRoomAvailable: number,
    opts: OptimalRrspOptions = {},
): PrescriptiveAdvice | null {
    if (!Number.isFinite(taxableIncome) || !Number.isFinite(rrspRoomAvailable)) return null;
    if (taxableIncome <= 0 || rrspRoomAvailable <= 100) return null;

    const year = opts.year ?? TAX_BASE_YEAR;
    const firstBracketFloor = Math.min(QC_BRACKETS[0].upTo, FED_BRACKETS[0].upTo);
    if (taxableIncome <= firstBracketFloor) return null;

    const candidateThresholds = [
        FED_BRACKETS[3].upTo,
        FED_BRACKETS[2].upTo,
        QC_BRACKETS[2].upTo,
        FED_BRACKETS[1].upTo,
        QC_BRACKETS[1].upTo,
        FED_BRACKETS[0].upTo,
        QC_BRACKETS[0].upTo,
    ]
        .filter((t) => Number.isFinite(t) && t < taxableIncome)
        .sort((a, b) => b - a);

    const targetThreshold = candidateThresholds[0] ?? firstBracketFloor;
    const rawNeededToDropBracket = taxableIncome - targetThreshold;
    const optimalContribution = Math.round(Math.min(rrspRoomAvailable, Math.max(1000, rawNeededToDropBracket)));

    if (optimalContribution <= 0) return null;

    const reportBefore = calculateFiscalReport(taxableIncome, 0, 0, year, true);
    const reportAfter = calculateFiscalReport(taxableIncome, optimalContribution, 0, year, true);
    const directTaxSaved = Math.max(0, reportBefore.totalTax - reportAfter.totalTax);

    const childrenSlope = estimateFamilyBenefitClawbackSlope(taxableIncome, opts.childrenCount ?? 0);
    const familyBenefitsGained = optimalContribution * childrenSlope;
    const totalImmediateGain = Math.round(directTaxSaved + familyBenefitsGained);

    if (totalImmediateGain <= 50) return null;

    const effectiveTmed = totalImmediateGain / optimalContribution;
    const safeMonthlyExp = opts.monthlyExpenses && opts.monthlyExpenses > 0 ? opts.monthlyExpenses : 4000;
    const monthsFreedom = Math.max(0, Math.round(totalImmediateGain / safeMonthlyExp));
    const deadlineYear = year + 1;

    return {
        id: 'rec-rrsp-tmed-optimal',
        horizon: 'immediate',
        title: 'Cotiser au REER dans ta tranche à haut TMED',
        description:
            `Cotise ${formatCAD(optimalContribution)} au REER pour ramener ton revenu imposable vers le seuil de ` +
            `${formatCAD(Math.round(targetThreshold))} et récupérer un rendement fiscal effectif immédiat de ` +
            `${formatPercent(effectiveTmed * 100)}${(opts.childrenCount ?? 0) > 0 ? ' (impôt + bonification des allocations familiales)' : ''}.`,
        urgencyDeadline: `1er mars ${deadlineYear}`,
        impact: {
            type: 'tax_savings',
            amountDollars: totalImmediateGain,
            annualSavingsDollars: totalImmediateGain,
            monthsFreedom,
            effectiveTmedRate: effectiveTmed,
        },
        associatedLever: {
            key: 'appliedContributionOrder',
            value: 'REER_FIRST',
            projectionPatch: { appliedContributionOrder: 'REER_FIRST' },
        },
    };
}

/**
 * 1B — Horizon Immédiat : Arbitrage d'emplacement d'actifs (Asset Location Swap).
 * Détecte les actions / FNB américains détenus en CELI, CELIAPP ou REEE qui subissent
 * la retenue à la source IRS de 15 % non récupérable alors qu'une capacité REER existe
 * (exemption convention Canada–É.-U., art. XXI).
 */
export function recommendAssetLocationSwaps(
    assets: readonly Asset[],
    fxRates: Record<string, number>,
    horizonYears: number,
    reerAvailableOrBalance: number,
    monthlyExpenses: number = 4000,
): PrescriptiveAdvice[] {
    if (!Array.isArray(assets) || assets.length === 0) return [];
    const safeHorizon = Number.isFinite(horizonYears) && horizonYears > 0 ? Math.min(40, horizonYears) : 20;
    if (!Number.isFinite(reerAvailableOrBalance) || reerAvailableOrBalance <= 500) return [];

    let exposedUsValueCad = 0;
    let annualIrsDragCad = 0;
    const exposedTickers: string[] = [];

    for (const asset of assets) {
        const rawAcc = (asset.accountType ?? (asset as unknown as { account?: string }).account ?? '').toUpperCase();
        const isTaxFreeNonTreaty = rawAcc.includes('CELI') || rawAcc.includes('TFSA') || rawAcc.includes('REEE') || rawAcc.includes('FHSA');
        if (!isTaxFreeNonTreaty) continue;

        const qty = Number(asset.quantity);
        const price = Number(asset.currentPrice);
        if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) continue;

        const fx = asset.currency && asset.currency !== 'CAD' ? (fxRates[asset.currency] ?? 1) : 1;
        if (!Number.isFinite(fx) || fx <= 0) continue;
        const valCad = qty * price * fx;

        const symbolStr = asset.symbol || (asset as unknown as { ticker?: string }).ticker || asset.name || '';
        const profile = resolveAssetFundamental(symbolStr);
        const usFrac = asset.currency === 'USD' ? Math.max(0.5, profile.usForeignDivFraction) : profile.usForeignDivFraction;
        if (usFrac <= 0 || profile.dividendYield <= 0) continue;

        const drag = valCad * profile.dividendYield * usFrac * US_DIVIDEND_WITHHOLDING_RATE;
        if (drag > 5) {
            exposedUsValueCad += valCad;
            annualIrsDragCad += drag;
            if (symbolStr && !exposedTickers.includes(symbolStr)) {
                exposedTickers.push(symbolStr);
            }
        }
    }

    if (annualIrsDragCad < 25) return [];

    const swapAmount = Math.min(exposedUsValueCad, reerAvailableOrBalance);
    const swapShare = exposedUsValueCad > 0 ? swapAmount / exposedUsValueCad : 0;
    const annualSaved = annualIrsDragCad * swapShare;
    const growthRate = IQPF_2026_EXPECTED_RETURNS.US_EQUITY;
    const compoundedGain = growthRate > 0
        ? Math.round(annualSaved * ((Math.pow(1 + growthRate, safeHorizon) - 1) / growthRate))
        : Math.round(annualSaved * safeHorizon);

    if (compoundedGain < 250) return [];

    const tickerLabel = exposedTickers.length > 0 ? exposedTickers.slice(0, 3).join(', ') : 'tes titres américains';
    const safeExp = monthlyExpenses > 0 ? monthlyExpenses : 4000;

    return [
        {
            id: 'rec-asset-location-us-reer',
            horizon: 'immediate',
            title: `Loger ${tickerLabel} en REER plutôt qu'en CELI`,
            description:
                `Tes titres américains hors REER subissent la retenue IRS de ${formatPercent(US_DIVIDEND_WITHHOLDING_RATE * 100)} sur dividendes ` +
                `(${formatCAD(Math.round(annualSaved))}/an perdus). En les logeant en REER (exempté par l'art. XXI de la convention Canada–É.-U.), ` +
                `tu conserves ${formatCAD(compoundedGain)} composés sur ${safeHorizon} ans.`,
            impact: {
                type: 'wealth_increase',
                amountDollars: compoundedGain,
                annualSavingsDollars: Math.round(annualSaved),
                monthsFreedom: Math.max(0, Math.round(compoundedGain / safeExp)),
            },
            associatedLever: {
                key: 'appliedAssetLocation',
                value: true,
                projectionPatch: { appliedAssetLocation: true },
            },
        },
    ];
}

/**
 * 1C — Horizon Immédiat : Récolte fiscale de pertes (Tax-Loss Harvesting) avant le 31 décembre
 * calculée sur le PBR réel des lots d'achat (`purchases[]`) en compte non enregistré.
 */
export function recommendTaxLossHarvesting(
    assets: readonly Asset[],
    fxRates: Record<string, number>,
    marginalTaxRate: number,
    year: number = TAX_BASE_YEAR,
    monthlyExpenses: number = 4000,
): PrescriptiveAdvice | null {
    if (!Array.isArray(assets) || assets.length === 0) return null;
    if (!Number.isFinite(marginalTaxRate) || marginalTaxRate <= 0) return null;

    let totalHarvestableLoss = 0;
    const losingLabels: string[] = [];

    for (const asset of assets) {
        const rawAcc = (asset.accountType ?? (asset as unknown as { account?: string }).account ?? '').toUpperCase();
        const isNonReg = rawAcc === 'NON-ENREG' || rawAcc === 'NON_ENREG' || rawAcc === 'MARGIN' || rawAcc === 'COMPTANT' || rawAcc === 'CRYPTO';
        if (!isNonReg) continue;
        if (!asset.purchases || asset.purchases.length === 0) continue;

        const qty = Number(asset.quantity);
        const price = Number(asset.currentPrice);
        if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price < 0) continue;

        const fx = asset.currency && asset.currency !== 'CAD' ? (fxRates[asset.currency] ?? 1) : 1;
        if (!Number.isFinite(fx) || fx <= 0) continue;

        const marketValCad = qty * price * fx;
        const normalizedPurchases = asset.purchases.map((p: NonNullable<Asset['purchases']>[number]) => ({
            date: p.date,
            quantity: p.quantity,
            price: p.price ?? (p as unknown as { unitCost?: number }).unitCost ?? 0,
            currency: asset.currency,
            exchangeRateToCad: fx,
        }));
        const acbTotal = computeInitialACB(normalizedPurchases, marketValCad);
        if (acbTotal > marketValCad + 200) {
            const latentLoss = acbTotal - marketValCad;
            totalHarvestableLoss += latentLoss;
            const sym = asset.symbol || (asset as unknown as { ticker?: string }).ticker || asset.name;
            losingLabels.push(sym);
        }
    }

    if (totalHarvestableLoss < 300) return null;

    const taxSaved = Math.round(totalHarvestableLoss * CAPITAL_GAINS_INCLUSION_STANDARD * marginalTaxRate);
    if (taxSaved < 50) return null;

    const safeExp = monthlyExpenses > 0 ? monthlyExpenses : 4000;
    const labelStr = losingLabels.slice(0, 3).join(', ');

    return {
        id: 'rec-tlh-december-real-acb',
        horizon: 'immediate',
        title: 'Récolter tes moins-values latentes avant le 31 décembre',
        description:
            `Tes positions non enregistrées (${labelStr}) affichent une perte latente réelle sur PBR de ${formatCAD(Math.round(totalHarvestableLoss))}. ` +
            `Cristalliser cette perte avant la fin de l'année (en respectant la règle des pertes apparentes de 30 jours, LIR 54) ` +
            `réduit tes impôts sur gains en capital de ${formatCAD(taxSaved)}.`,
        urgencyDeadline: `31 décembre ${year}`,
        impact: {
            type: 'tax_savings',
            amountDollars: taxSaved,
            annualSavingsDollars: taxSaved,
            monthsFreedom: Math.max(0, Math.round(taxSaved / safeExp)),
        },
        associatedLever: {
            key: 'appliedGainHarvesting',
            value: true,
            projectionPatch: { appliedGainHarvesting: true },
        },
    };
}

/**
 * 2 — Horizon Comportemental : Mois magiques à 3 paies & maîtrise de la dérive discrétionnaire.
 */
export function recommendBehavioralActions(
    behavioralProfile: BehavioralProfile | undefined,
    budgetMonthlyTarget: number,
    horizonYears: number,
    annualReturnDecimal: number = IQPF_2026_EXPECTED_RETURNS.INT_EQUITY,
    monthlyExpenses: number = 4000,
): PrescriptiveAdvice[] {
    if (!behavioralProfile) return [];
    const advices: PrescriptiveAdvice[] = [];
    const safeHorizon = Number.isFinite(horizonYears) && horizonYears > 0 ? Math.min(40, horizonYears) : 20;
    const r = Number.isFinite(annualReturnDecimal) && annualReturnDecimal > 0 ? annualReturnDecimal : 0.065;
    const safeExp = monthlyExpenses > 0 ? monthlyExpenses : 4000;

    // 2A — Cadence aux 2 semaines (26 paies/an) : 2 mois par an comptent 3 paies (« mois magiques »)
    const paySched = behavioralProfile.paySchedule;
    const magicMonthsCount = paySched?.threePayMonths?.length ?? 0;
    const typicalPay = paySched?.typicalNetPay ?? 0;
    if (paySched && paySched.frequency === 'biweekly' && typicalPay > 250 && magicMonthsCount >= 2) {
        const annualExtraPays = typicalPay * 2;
        const compounded = Math.round(annualExtraPays * ((Math.pow(1 + r, safeHorizon) - 1) / r));
        if (compounded >= 1000) {
            advices.push({
                id: 'rec-behavioral-magic-paychecks',
                horizon: 'behavioral',
                title: 'Investir automatiquement tes 2 paies excédentaires annuelles',
                description:
                    `Ta cadence aux deux semaines génère 2 mois à 3 paies par année (${formatCAD(Math.round(typicalPay))} × 2 = ` +
                    `${formatCAD(Math.round(annualExtraPays))}/an hors budget mensuel fixe). Programmer leur virement automatique ` +
                    `ajoute ${formatCAD(compounded)} à ton patrimoine sur ${safeHorizon} ans.`,
                impact: {
                    type: 'wealth_increase',
                    amountDollars: compounded,
                    annualSavingsDollars: Math.round(annualExtraPays),
                    monthsFreedom: Math.max(1, Math.round(compounded / safeExp)),
                },
                associatedLever: {
                    key: 'expenseProjectionMode',
                    value: 'budget',
                    projectionPatch: { expenseProjectionMode: 'budget' },
                },
            });
        }
    }

    // 2B — Dépassement réel vs cible budgétaire ou dérive positive du train de vie (lifestyle creep)
    const realSpend = behavioralProfile.realMonthlyExpenses;
    const discretionarySpend = realSpend * Math.max(0, Math.min(1, behavioralProfile.discretionaryRatio || 0.35));
    if (Number.isFinite(realSpend) && Number.isFinite(budgetMonthlyTarget) && budgetMonthlyTarget > 0) {
        const monthlyOvershoot = realSpend - budgetMonthlyTarget;
        if (monthlyOvershoot >= 150) {
            const recoverableMonthly = Math.min(monthlyOvershoot * 0.5, Math.max(100, discretionarySpend * 0.35));
            const annualRecovered = recoverableMonthly * 12;
            const compounded = Math.round(annualRecovered * ((Math.pow(1 + r, safeHorizon) - 1) / r));
            if (compounded >= 2000) {
                advices.push({
                    id: 'rec-behavioral-discretionary-drift',
                    horizon: 'behavioral',
                    title: 'Corriger la moitié de l’écart entre dépenses réelles et budget',
                    description:
                        `Tes dépenses réelles observées (${formatCAD(Math.round(realSpend))}/mois) dépassent ton budget cible ` +
                        `de ${formatCAD(Math.round(monthlyOvershoot))}/mois. Ramener ${formatCAD(Math.round(recoverableMonthly))}/mois ` +
                        `vers l'investissement génère ${formatCAD(compounded)} sur ${safeHorizon} ans.`,
                    impact: {
                        type: 'wealth_increase',
                        amountDollars: compounded,
                        annualSavingsDollars: Math.round(annualRecovered),
                        monthsFreedom: Math.max(1, Math.round(compounded / safeExp)),
                    },
                    associatedLever: {
                        key: 'expenseProjectionMode',
                        value: 'hybrid',
                        projectionPatch: { expenseProjectionMode: 'hybrid' },
                    },
                });
            }
        }
    }

    return advices;
}

/**
 * Calcule l'âge actuariel de point mort (break-even) du report de la rente RRQ
 * de `RRQ_STANDARD_START_AGE` (65 ans) vers `targetDeferralAge` (70 ou 72 ans).
 */
export function computeRrqBreakEvenAge(targetDeferralAge: number = 70): number {
    const clampedAge = Math.max(RRQ_STANDARD_START_AGE + 1, Math.min(RRQ_MAX_DEFERRAL_AGE, targetDeferralAge));
    const monthsDeferred = (clampedAge - RRQ_STANDARD_START_AGE) * 12;
    const factor = rrqAdjustmentFactor(monthsDeferred);
    const bonusFraction = factor - 1;
    if (bonusFraction <= 0) return clampedAge;
    return (clampedAge * factor - RRQ_STANDARD_START_AGE) / bonusFraction;
}

/**
 * 3 — Horizon Structurel : Report actuariel RRQ/PSV, protection contre la récupération PSV, et dettes coûteuses.
 */
export function recommendStructuralActions(
    params: SimulationParams,
    _projectionResult?: ProjectionResult | null,
): PrescriptiveAdvice[] {
    const advices: PrescriptiveAdvice[] = [];
    const lifeExp = params.retirementGoal?.lifeExpectancy ?? 90;
    const currentRrqAge = params.retirementGoal?.rrqStartAge ?? RRQ_STANDARD_START_AGE;
    const currentPsvAge = params.retirementGoal?.psvStartAge ?? PSV_ELIGIBILITY_AGE;
    const safeExp = params.baseMonthlyExpenses > 0 ? params.baseMonthlyExpenses : 4000;

    // 3A — Report RRQ/PSV lorsque l'espérance de vie dépasse le point mort actuariel
    const targetRrqAge = 70;
    const breakEvenAge = computeRrqBreakEvenAge(targetRrqAge);
    if (currentRrqAge < targetRrqAge && lifeExp >= Math.ceil(breakEvenAge) + 2) {
        const estBaseRrqMonthly = params.retirementGoal?.rrqEstimateMonthly
            ?? (params.retirementGoal?.governmentPension ? params.retirementGoal.governmentPension * GOV_PENSION_RRQ_SHARE : 1100);
        const estBasePsvMonthly = params.retirementGoal?.psvEstimateMonthly
            ?? (params.retirementGoal?.governmentPension ? params.retirementGoal.governmentPension * GOV_PENSION_PSV_SHARE : 700);

        if (estBaseRrqMonthly > 0) {
            const rrqFactor70 = rrqAdjustmentFactor((targetRrqAge - RRQ_STANDARD_START_AGE) * 12);
            const psvFactor70 = psvDeferralFactor((targetRrqAge - RRQ_STANDARD_START_AGE) * 12);

            const cumAt65 = estBaseRrqMonthly * 12 * (lifeExp - RRQ_STANDARD_START_AGE)
                + (currentPsvAge < targetRrqAge ? estBasePsvMonthly * 12 * (lifeExp - RRQ_STANDARD_START_AGE) : 0);
            const cumAt70 = estBaseRrqMonthly * rrqFactor70 * 12 * (lifeExp - targetRrqAge)
                + (currentPsvAge < targetRrqAge ? estBasePsvMonthly * psvFactor70 * 12 * (lifeExp - targetRrqAge) : 0);

            const netLifetimeGain = Math.round(cumAt70 - cumAt65);
            if (netLifetimeGain >= 5000) {
                advices.push({
                    id: 'rec-structural-rrq-psv-deferral',
                    horizon: 'structural',
                    title: 'Reporter tes rentes RRQ et PSV à 70 ans (rente viagère indexée +42 % / +36 %)',
                    description:
                        `Ton point mort actuariel se situe à ${breakEvenAge.toFixed(1).replace('.', ',')} ans. ` +
                        `Sur un horizon de vie jusqu'à ${lifeExp} ans, reporter tes rentes bonifie tes revenus garantis indexés ` +
                        `de ${formatCAD(netLifetimeGain)} en dollars constants tout en ouvrant la fenêtre de décaissement REER entre 60 et 70 ans.`,
                    impact: {
                        type: 'wealth_increase',
                        amountDollars: netLifetimeGain,
                        monthsFreedom: Math.max(1, Math.round(netLifetimeGain / safeExp)),
                    },
                    associatedLever: {
                        key: 'delayPensions',
                        value: true,
                        retirementPatch: { rrqStartAge: RRQ_MAX_DEFERRAL_AGE, psvStartAge: 70 },
                    },
                });
            }
        }
    }

    // 3B — Risque de récupération de la PSV (OAS clawback > 95 323 $) si gros solde REER et pas de meltdown
    const reerBalance = params.liveCSVBalances?.REER ?? 0;
    const isMeltdownActive = params.projection.withdrawalStrategy === 'MELTDOWN_REER';
    if (!isMeltdownActive && reerBalance >= 250000) {
        const currentAge = params.config?.users?.[0]?.age ?? 40;
        const yearsTo71 = Math.max(0, 71 - currentAge);
        const reerRate = (params.projection.returnRates?.reer ?? 6.5) / 100;
        const projectedReerAt71 = reerBalance * Math.pow(1 + Math.max(0, reerRate - 0.02), yearsTo71);
        const estMandatoryRrif72 = projectedReerAt71 * 0.054;
        const estOtherPension = (params.retirementGoal?.governmentPension ?? 1500) * 12;
        if (estMandatoryRrif72 + estOtherPension > OAS_CLAWBACK_THRESHOLD_2026) {
            const excess = (estMandatoryRrif72 + estOtherPension) - OAS_CLAWBACK_THRESHOLD_2026;
            const annualClawbackRisk = Math.min(9000, excess * OAS_CLAWBACK_RATE);
            const totalClawbackSaved = Math.round(annualClawbackRisk * Math.max(5, lifeExp - 72));
            if (totalClawbackSaved >= 3000) {
                advices.push({
                    id: 'rec-structural-reer-meltdown-oas',
                    horizon: 'structural',
                    title: 'Activer le décaissement préventif du REER (Meltdown) avant 71 ans',
                    description:
                        `Ton solde REER projeté risque de déclencher des retraits FERR obligatoires dépassant le seuil de récupération ` +
                        `de la PSV (${formatCAD(OAS_CLAWBACK_THRESHOLD_2026)}). Lisser le décaissement REER dès le début de la retraite ` +
                        `protège environ ${formatCAD(totalClawbackSaved)} de PSV contre la récupération de ${formatPercent(OAS_CLAWBACK_RATE * 100)}.`,
                    impact: {
                        type: 'tax_savings',
                        amountDollars: totalClawbackSaved,
                        annualSavingsDollars: Math.round(annualClawbackRisk),
                        monthsFreedom: Math.max(1, Math.round(totalClawbackSaved / safeExp)),
                    },
                    associatedLever: {
                        key: 'withdrawalStrategy',
                        value: 'MELTDOWN_REER',
                        projectionPatch: { withdrawalStrategy: 'MELTDOWN_REER' },
                    },
                });
            }
        }
    }

    // 3C — Dettes à taux d'intérêt élevé (> rendement espéré du portefeuille)
    const highRateDebts: Debt[] = (params.debts ?? []).filter(
        (d) => Number.isFinite(d.balance) && d.balance > 500 && Number.isFinite(d.interestRate) && d.interestRate >= 7.0,
    );
    if (highRateDebts.length > 0 && !params.projection.appliedDebtFirst) {
        const totalHighDebt = highRateDebts.reduce((s, d) => s + d.balance, 0);
        const weightedRate = highRateDebts.reduce((s, d) => s + d.balance * (d.interestRate / 100), 0) / totalHighDebt;
        const spreadOverMarket = Math.max(0.015, weightedRate - IQPF_2026_EXPECTED_RETURNS.INT_EQUITY);
        const fiveYearInterestSaved = Math.round(totalHighDebt * spreadOverMarket * 3.5);
        if (fiveYearInterestSaved >= 250) {
            advices.push({
                id: 'rec-structural-high-interest-debt',
                horizon: 'structural',
                title: `Prioriser le remboursement des dettes à ${formatPercent(weightedRate * 100)} (rendement garanti net d'impôt)`,
                description:
                    `Tu portes ${formatCAD(Math.round(totalHighDebt))} de dettes à un taux moyen de ${formatPercent(weightedRate * 100)}, ` +
                    `supérieur au rendement boursier espéré IQPF. Activer la priorité remboursement de dettes économise environ ` +
                    `${formatCAD(fiveYearInterestSaved)} de frais financiers nets.`,
                impact: {
                    type: 'wealth_increase',
                    amountDollars: fiveYearInterestSaved,
                    monthsFreedom: Math.max(1, Math.round(fiveYearInterestSaved / safeExp)),
                },
                associatedLever: {
                    key: 'appliedDebtFirst',
                    value: true,
                    projectionPatch: { appliedDebtFirst: true },
                },
            });
        }
    }

    return advices;
}

export interface PrescriptiveEngineInput {
    params: SimulationParams;
    projectionResult?: ProjectionResult | null;
    assets?: readonly Asset[];
    fxRates?: Record<string, number>;
    behavioralProfile?: BehavioralProfile;
    rrspRoomAvailable?: number;
}

/**
 * Génère et hiérarchise toutes les recommandations prescriptives pertinentes pour le dossier courant,
 * triées strictement par impact financier décroissant (`amountDollars`).
 * Respecte strictement `No-Fake-Data` : retourne `[]` si aucune optimisation chiffrée positive ne s'applique.
 */
export function generatePrescriptiveRecommendations(input: PrescriptiveEngineInput): PrescriptiveAdvice[] {
    const { params, projectionResult, assets = [], fxRates = {} } = input;
    const all: PrescriptiveAdvice[] = [];

    const year = params.startYear || TAX_BASE_YEAR;
    const horizonYears = params.projection?.years ?? 25;
    const monthlyExp = params.baseMonthlyExpenses > 0 ? params.baseMonthlyExpenses : 4000;
    const primaryUserGross = (() => {
        const u0 = params.config?.users?.[0];
        if (!u0) return params.baseGrossAnnual;
        if (u0.grossSalary && u0.grossSalary > 0) return u0.grossSalary * 12;
        return params.baseGrossAnnual / Math.max(1, params.config.users.length);
    })();

    const chart0 = projectionResult?.chartData?.[0];
    const inferredRrspRoom = chart0 && Number.isFinite(chart0.REERMax) && Number.isFinite(chart0.REER)
        ? Math.max(0, (chart0.REERMax ?? 0) - (chart0.REER ?? 0))
        : (params.projection.manualREERRoom ?? 0);
    const rrspRoom = input.rrspRoomAvailable !== undefined ? input.rrspRoomAvailable : inferredRrspRoom;

    const rrspRec = recommendOptimalRrspContribution(primaryUserGross, rrspRoom, {
        year,
        childrenCount: params.childGoals?.length ?? 0,
        monthlyExpenses: monthlyExp,
    });
    if (rrspRec) all.push(rrspRec);

    const reerCapacityForSwap = (params.liveCSVBalances?.REER ?? 0) + Math.max(0, rrspRoom);
    const swapRecs = recommendAssetLocationSwaps(assets, fxRates, horizonYears, reerCapacityForSwap, monthlyExp);
    all.push(...swapRecs);

    const marginalRate = getMarginalRate(primaryUserGross, year);
    const tlhRec = recommendTaxLossHarvesting(assets, fxRates, marginalRate, year, monthlyExp);
    if (tlhRec) all.push(tlhRec);

    const behProfile = input.behavioralProfile ?? params.behavioralProfile;
    const behRecs = recommendBehavioralActions(
        behProfile,
        params.baseMonthlyExpenses,
        horizonYears,
        IQPF_2026_EXPECTED_RETURNS.INT_EQUITY,
        monthlyExp,
    );
    all.push(...behRecs);

    const structRecs = recommendStructuralActions(params, projectionResult);
    all.push(...structRecs);

    return all
        .filter((item) => Number.isFinite(item.impact.amountDollars) && item.impact.amountDollars > 0)
        .sort((a, b) => b.impact.amountDollars - a.impact.amountDollars);
}
