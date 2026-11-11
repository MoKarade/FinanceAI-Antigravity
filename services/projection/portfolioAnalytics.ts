// services/projection/portfolioAnalytics.ts
//
// F14 & F16 — Qualification fiscale des dividendes, Retenue IRS 15 %,
// Initialisation du PBR réel (ACB), Asset Location optimale et REEE PSE vs PAE.
//
// Sources :
// - Convention fiscale Canada–États-Unis (Art. X(2)(b) et Art. XXI)
// - Loi de l'impôt sur le revenu (LIR art. 146.1 pour le REEE, art. 38/54 pour l'ACB)
// - docs/FISCAL_REFERENCE.md §3 et §7
// - Normes IQPF 2026

import type { AssetFundamental, AssetClassIQPF } from '../assetFundamentals';
import {
    CAPITAL_GAINS_INCLUSION_STANDARD,
    US_DIVIDEND_WITHHOLDING_RATE,
    QC_FEDERAL_ABATEMENT_RATE,
    BASIC_PERSONAL_AMOUNT_FED,
    BASIC_PERSONAL_AMOUNT_QC,
} from '../../utils/tax';

export interface AssetPurchaseInput {
    date?: string;
    shares?: number;
    quantity?: number;
    price?: number;
    currency?: string;
    exchangeRateToCad?: number;
}

/**
 * Calcule l'ACB (PBR réel) initial à partir des achats historiques.
 * En l'absence totale d'achats documentés, repli sans données simulées sur le solde du compte.
 */
export function computeInitialACB(
    purchases: ReadonlyArray<AssetPurchaseInput> | undefined,
    fallbackBalance: number = 0,
): number {
    if (!purchases || purchases.length === 0) {
        return Math.max(0, Number(fallbackBalance) || 0);
    }

    return purchases.reduce((sum, p) => {
        const count = Math.max(0, Number(p.shares ?? p.quantity) || 0);
        const unitPrice = Math.max(0, Number(p.price) || 0);
        const curr = (p.currency || 'CAD').toUpperCase();
        const rate = curr === 'USD' ? Math.max(0.5, Number(p.exchangeRateToCad) || 1.35) : 1.0;
        return sum + count * unitPrice * rate;
    }, 0);
}

/** Alias de compatibilité pour tests Tier 1 */
export const computeInitialAcbCad = computeInitialACB;

export interface AssetTaxDragInput {
    symbol?: string;
    accountType?: string;
    currentValueCad: number;
    dividendYield: number;
    usForeignDivFraction: number;
    eligibleCanadianDivFraction?: number;
    mer?: number;
}

export interface AnnualTaxDragResult {
    irsWithholdingCad: number;
    netDividendCad: number;
    netYield: number;
    taxDragRate: number;
}

/**
 * Calcule le frottement fiscal annuel lié à la retenue à la source IRS de 15 %
 * selon le régime de détention (Convention fiscale Canada-US art. XXI) :
 * - REER, CRI, FERR : Exemption totale de 0 %
 * - CELI, REEE, CELIAPP : Perte sèche non récupérable de 15 %
 * - Non-Enregistré : Retenue de 15 % récupérable via le Crédit pour Impôt Étranger (CIE)
 */
export function computeAnnualTaxDrag(asset: AssetTaxDragInput): AnnualTaxDragResult {
    const val = Math.max(0, Number(asset.currentValueCad) || 0);
    const y = Math.max(0, Number(asset.dividendYield) || 0);
    const usFrac = Math.min(1, Math.max(0, Number(asset.usForeignDivFraction) || 0));
    const annualDiv = val * y;
    let irsWithholdingCad = 0;

    const acct = (asset.accountType || '').toUpperCase();
    if (usFrac > 0) {
        const usDiv = annualDiv * usFrac;
        // En REER / CRI / FERR : exonéré
        // En CELI et REEE : perte sèche non récupérable de 15 %
        if (acct === 'CELI' || acct === 'REEE' || acct === 'CELIAPP') {
            irsWithholdingCad = usDiv * US_DIVIDEND_WITHHOLDING_RATE;
        }
    }

    const netDividendCad = annualDiv - irsWithholdingCad;
    const netYield = val > 0 ? netDividendCad / val : 0;
    const taxDragRate = val > 0 ? irsWithholdingCad / val : 0;

    return {
        irsWithholdingCad,
        netDividendCad,
        netYield,
        taxDragRate,
    };
}

/**
 * Calcule le coût annuel d'inefficience fiscale (Tax Drag) d'un actif logé dans un compte donné.
 */
export function computeAssetLocationTaxDrag(
    accountType: string,
    asset: AssetFundamental,
    marginalRate: number,
    turnoverRate: number = 0.05,
): number {
    const acct = (accountType || '').toUpperCase();
    const marg = Math.max(0, Number(marginalRate) || 0);
    const y = Math.max(0, asset.dividendYield || 0);

    // 1. REER / CRI / FERR : zéro impôt durant l'accumulation
    if (acct === 'REER' || acct === 'CRI' || acct === 'FERR') {
        return 0;
    }

    // 2. CELI / CELIAPP : perte sèche de 15 % sur dividendes US
    if (acct === 'CELI' || acct === 'CELIAPP') {
        return y * (asset.usForeignDivFraction || 0) * US_DIVIDEND_WITHHOLDING_RATE;
    }

    // 3. REEE : idem CELI (perte sèche 15 % US)
    if (acct === 'REEE') {
        return y * (asset.usForeignDivFraction || 0) * US_DIVIDEND_WITHHOLDING_RATE;
    }

    // 4. Non-Enregistré : imposition courante
    if (acct === 'NON-ENREG' || acct === 'NONREG') {
        // Intérêts taxés à 100 % au taux marginal
        const intDrag = y * (asset.interestFraction || 0) * marg;
        // Dividendes US taxés au marginal (CIE neutralise la retenue 15 %)
        const usDrag = y * (asset.usForeignDivFraction || 0) * marg;
        // Dividendes CA admissibles : majoration de 38 % et crédit combiné effectif (~24,24 % du majoré)
        const effectiveDivTaxRate = Math.max(0, 1.38 * marg - 0.334533);
        const cadDivDrag = y * (asset.eligibleCanadianDivFraction || 0) * effectiveDivTaxRate;
        // Gains en capital réalisés via rotation annuelle (turnover)
        const growthPart = Math.max(0, asset.expectedReturn - y);
        const capGainsDrag = growthPart * turnoverRate * (CAPITAL_GAINS_INCLUSION_STANDARD * marg);

        return intDrag + usDrag + cadDivDrag + capGainsDrag;
    }

    return 0;
}

export interface AssetLocationRecommendation {
    recommendedAccount: 'REER' | 'CELI' | 'NON-ENREG';
    priorityOrder: Array<'REER' | 'CELI' | 'NON-ENREG'>;
    rationale: string;
}

/**
 * Recommande le compte optimal pour détenir une classe d'actifs donnée.
 */
export function recommendOptimalAssetLocation(assetClass: AssetClassIQPF | string): AssetLocationRecommendation {
    const c = (assetClass || '').toUpperCase();
    if (c === 'CAN_BOND' || c === 'BONDS' || c === 'CASH') {
        return {
            recommendedAccount: 'REER',
            priorityOrder: ['REER', 'CELI', 'NON-ENREG'],
            rationale: "Les obligations et revenus d'intérêt sont imposés à 100 % au taux marginal en compte non-enregistré. Le REER élimine cette imposition sans sacrifier d'abri pour de la forte croissance.",
        };
    }
    if (c === 'US_EQUITY' || c === 'US-EQUITY') {
        return {
            recommendedAccount: 'REER',
            priorityOrder: ['REER', 'NON-ENREG', 'CELI'],
            rationale: "En vertu de l'article XXI de la convention fiscale Canada-US, le REER est exempté de la retenue IRS de 15 % à la source. Le CELI subit une perte fiscale sèche non récupérable.",
        };
    }
    if (c === 'CAN_EQUITY' || c === 'CA-EQUITY') {
        return {
            recommendedAccount: 'CELI',
            priorityOrder: ['CELI', 'NON-ENREG', 'REER'],
            rationale: "Les actions canadiennes bénéficient du crédit d'impôt pour dividendes (CID) hors abri. Les loger dans un REER transforme les dividendes en revenu ordinaire 100 % imposable au retrait.",
        };
    }
    return {
        recommendedAccount: 'CELI',
        priorityOrder: ['CELI', 'REER', 'NON-ENREG'],
        rationale: "Les actions de croissance maximisent la valeur dollar de l'exonération perpétuelle d'impôt en CELI.",
    };
}

// ── REEE COMPARTIMENTÉ PSE vs PAE ─────────────────────────────────────────────

export interface ReeeBalances {
    pseBalance: number; // Capital souscripteur (100 % franc d'impôt)
    paeBalance: number; // Subventions SCEE/IQEE + rendements accumulés (imposable étudiant)
    total: number;
}

/**
 * Initialise ou recalcule la ventilation PSE vs PAE d'un REEE.
 */
export function computeReeeBalances(
    parentalContributions: number,
    totalGrants: number,
    accumulatedEarnings: number,
): ReeeBalances {
    const pse = Math.max(0, Number(parentalContributions) || 0);
    const grants = Math.max(0, Number(totalGrants) || 0);
    const earnings = Math.max(0, Number(accumulatedEarnings) || 0);
    const pae = grants + earnings;
    return {
        pseBalance: pse,
        paeBalance: pae,
        total: pse + pae,
    };
}

export interface ReeeWithdrawalResult {
    withdrawalPae: number;
    withdrawalPse: number;
    totalWithdrawn: number;
    newPseBalance: number;
    newPaeBalance: number;
}

/**
 * Exécute un retrait d'études avec priorité légale et fiscale au PAE
 * (épuisement prioritaire des subventions et rendements tant que l'enfant a un statut d'étudiant à faible revenu).
 */
export function computeReeeWithdrawal(
    requestedAmount: number,
    pseBalance: number,
    paeBalance: number,
): ReeeWithdrawalResult {
    const req = Math.max(0, Number(requestedAmount) || 0);
    let curPse = Math.max(0, Number(pseBalance) || 0);
    let curPae = Math.max(0, Number(paeBalance) || 0);

    const withdrawalPae = Math.min(curPae, req);
    curPae -= withdrawalPae;

    const remainingReq = req - withdrawalPae;
    const withdrawalPse = Math.min(curPse, remainingReq);
    curPse -= withdrawalPse;

    const totalWithdrawn = withdrawalPae + withdrawalPse;

    return {
        withdrawalPae,
        withdrawalPse,
        totalWithdrawn,
        newPseBalance: curPse,
        newPaeBalance: curPae,
    };
}

export interface ReeeStudentTaxResult {
    taxableIncome: number;
    studentFedTax: number;
    studentQcTax: number;
    studentTotalTax: number;
}

/**
 * Calcule l'impôt payable par l'étudiant sur ses retraits PAE annuels.
 * Généralement nul si le montant reste inférieur au Montant personnel de base (BPA).
 */
export function computeReeeStudentTax(
    annualWithdrawalPae: number,
    studentOtherIncome: number = 0,
    fedBpa: number = BASIC_PERSONAL_AMOUNT_FED,
    qcBpa: number = BASIC_PERSONAL_AMOUNT_QC,
): ReeeStudentTaxResult {
    const pae = Math.max(0, Number(annualWithdrawalPae) || 0);
    const other = Math.max(0, Number(studentOtherIncome) || 0);
    const totalIncome = pae + other;

    const fedTaxable = Math.max(0, totalIncome - fedBpa);
    const studentFedTax = fedTaxable * 0.14 * (1 - QC_FEDERAL_ABATEMENT_RATE);

    const qcTaxable = Math.max(0, totalIncome - qcBpa);
    const studentQcTax = qcTaxable * 0.14;

    return {
        taxableIncome: totalIncome,
        studentFedTax,
        studentQcTax,
        studentTotalTax: studentFedTax + studentQcTax,
    };
}

export interface ReeeClosingSettlementResult {
    pseRefundToParent: number;
    grantsRefundToGovernment: number;
    rrspRollover: number;
    taxableAip: number;
    aipPenaltyTax: number;
    aipOrdinaryTax: number;
    aipNetCashToParent: number;
    totalCashToParent: number;
}

/**
 * Règle la fermeture d'un REEE à 25 ans (LIR art. 146.1) :
 * 1. Capital PSE restitué sans impôt au souscripteur (parent)
 * 2. Subventions inutilisées remboursées aux gouvernements (ARC et Revenu Québec)
 * 3. Rendements restants (PRA / AIP) : transférés au REER du parent (jusqu'à 50 000 $ si droits disponibles)
 *    ou soumis au taux marginal + surtaxe légale de 20 %
 */
export function computeReeeClosingSettlement(
    pseBalance: number,
    paeBalance: number,
    remainingGrants: number,
    parentRrspRoom: number = 0,
    parentMarginalRate: number = 0.40,
): ReeeClosingSettlementResult {
    const pse = Math.max(0, Number(pseBalance) || 0);
    const pae = Math.max(0, Number(paeBalance) || 0);
    const grants = Math.min(pae, Math.max(0, Number(remainingGrants) || 0));

    // 1. Capital cotisé par les parents retourné 100 % franc d'impôt
    const pseRefundToParent = pse;

    // 2. Subventions retournées intégralement aux gouvernements
    const grantsRefundToGovernment = grants;

    // 3. Rendements accumulés restants (PRA / AIP)
    const accumulatedEarnings = Math.max(0, pae - grants);

    // 4. Roulement vers le REER du parent si droits disponibles (LIR 204.94, max 50 000 $)
    const rrspRollover = Math.min(accumulatedEarnings, Math.max(0, Number(parentRrspRoom) || 0), 50000);

    // 5. Encaissement du solde taxable avec surtaxe punitive de 20 %
    const taxableAip = Math.max(0, accumulatedEarnings - rrspRollover);
    const aipPenaltyTax = taxableAip * 0.20;
    const aipOrdinaryTax = taxableAip * Math.max(0, Number(parentMarginalRate) || 0);
    const aipNetCashToParent = taxableAip - aipPenaltyTax - aipOrdinaryTax;

    const totalCashToParent = pseRefundToParent + Math.max(0, aipNetCashToParent);

    return {
        pseRefundToParent,
        grantsRefundToGovernment,
        rrspRollover,
        taxableAip,
        aipPenaltyTax,
        aipOrdinaryTax,
        aipNetCashToParent: Math.max(0, aipNetCashToParent),
        totalCashToParent,
    };
}
