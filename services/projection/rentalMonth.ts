// services/projection/rentalMonth.ts
//
// [ENG-W5-RENTAL-OFFBALANCE] Un immeuble locatif (`RentalProperty`, W5.6) n'existait PAS au bilan.
// Seul son NOI (loyer − charges) affluait au revenu ; sa VALEUR, son HYPOTHÈQUE et le SERVICE de
// cette hypothèque étaient invisibles.
//
// MESURÉ sur le persona de référence : **300 k$ d'équité et 500 k$ de prêt introuvables** au
// patrimoine, et ≈2,9 k$/mois de service de dette jamais payé — soit ≈700 k$ de coût omis sur
// l'horizon. L'invariant de conservation restait VERT : tout était absent du `chartData`, donc rien
// à réconcilier. Un actif qu'on n'écrit nulle part ne casse aucun bilan — il ment simplement.
//
// ⚠️ POURQUOI LES TROIS VONT ENSEMBLE, et pas l'un sans l'autre. Mettre la valeur au bilan SANS
// servir la dette ferait un patrimoine +300 k$ dont l'hypothèque ne descendrait JAMAIS ; servir la
// dette sans mettre la valeur ferait payer un bien qui n'existe pas. Chaque moitié est pire que le
// statu quo — on livre le tout ou rien.
//
// ⚠️ CE QUE CE MODULE NE MODÉLISE PAS (et qui reste au BACKLOG) : la vente de l'immeuble, la
// récupération de DPA (`ccaTaken`) à la vente, et l'impôt latent sur le gain. Le revenu locatif reste
// imposé au proxy 0,45 de `w5Effects` (non sourcé — `[W5-PROXY-NON-SOURCE]`). On ne prétend pas le
// contraire : ces manques sont nommés ici plutôt que d'être découverts plus tard comme des défauts.

import type { RentalProperty } from '../../types';
import { CAPITAL_GAINS_INCLUSION_STANDARD } from '../../utils/tax';
import { computeCanadianMonthlyMortgageRate } from './realEstateMonth';

/**
 * Amortissement par DÉFAUT quand `RentalProperty.amortizationYears` est absent.
 *
 * ⚠️ C'est une HYPOTHÈSE, pas une valeur sourcée : 25 ans est l'amortissement standard d'un prêt
 * hypothécaire résidentiel canadien, et c'est déjà le défaut du chemin « but immobilier ». On la
 * pose ICI, nommée et documentée, plutôt que de la disperser en littéral — et l'UI devrait à terme
 * demander le champ (il existe déjà dans le type). Un immeuble dont l'amortissement est saisi
 * l'emporte toujours sur ce défaut.
 */
export const DEFAULT_RENTAL_AMORTIZATION_YEARS = 25;

/**
 * Croissance annuelle par DÉFAUT (%) quand `RentalProperty.propertyGrowthRate` est absent.
 *
 * ⚠️ HYPOTHÈSE de modèle, pas une valeur sourcée — même défaut (3 %) que le chemin des buts
 * immobiliers (`goal.propertyGrowthRate ?? 3`). [ENG-PROPGROWTH-PAR-IMMEUBLE] (décision Marc
 * 2026-09-04) : le taux vit PAR immeuble ; le réglage config (`projection.propertyGrowthRate`)
 * est RETIRÉ du chemin locatif — aucune UI ne l'a jamais écrit. Un 0 EXPLICITE saisi reste 0.
 */
export const DEFAULT_RENTAL_GROWTH_PCT = 3;

/** État MUTABLE d'un immeuble locatif au fil des mois (valeur et solde évoluent). */
export interface RentalState {
    id: string;
    /** Valeur marchande courante, croissant au taux immobilier. */
    currentValue: number;
    /** Solde hypothécaire restant. */
    mortgage: number;
    /** Mensualité calculée à l'initialisation (fixe, comme pour un but immobilier). */
    monthlyPayment: number;
    /** Taux annuel (%) — conservé DANS l'état : sans lui, le calcul d'intérêt devrait re-croiser
     *  l'immeuble d'origine à chaque mois, et un décalage d'index donnerait le taux d'un AUTRE bien. */
    ratePct: number;
    /** [ENG-PROPGROWTH-PAR-IMMEUBLE] Croissance annuelle (%) de CET immeuble — écrite au semis
     *  (défaut explicite, jamais l'absence : absent voudrait dire « je ne sais pas » et relancerait
     *  un repli), même raison d'être dans l'état que `ratePct`. */
    growthRatePct: number;
    isPaidOff: boolean;
    /** Fraction non amortie du coût en capital (FNACC / UCC) pour la DPA. */
    ucc: number;
    /** Coût en capital initial du bien. */
    initialCost: number;
    /** Cumul de la DPA déduite à ce jour. */
    totalCcaClaimed: number;
    /** Loyer mensuel brut. */
    monthlyRent?: number;
    /** Taux d'inoccupation (0-100). */
    vacancyPct?: number;
    /** Dépenses mensuelles d'exploitation (taxes, entretien, assurance, gestion). */
    monthlyExpenses?: number;
    /** NOI mensuel brut lissé = (Loyer * (1 - vacance/100) - dépenses). */
    monthlyNoi?: number;
}

const num = (v: unknown, fallback = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

/** Taux officiel DPA Catégorie 1 (immeubles résidentiels après 1987) : 4 % (Règlement de l'impôt sur le revenu art. 1100(1)(a)(i)). */
export const CCA_CLASS_1_RATE = 0.04;

export interface CcaRentalCalculation {
    /** FNACC avant amortissement de l'année. */
    openingUcc: number;
    /** Amortissement maximal théorique admissible (FNACC * taux). */
    allowableCca: number;
    /** Amortissement effectif déduit (plafonné pour ne pas créer de perte selon LIR 1100(11)). */
    claimedCca: number;
    /** Nouvelle FNACC après déduction. */
    closingUcc: number;
    /** Revenu net de location après DPA. */
    netRentalIncomeAfterCca: number;
}

/**
 * Calcule l'amortissement DPA admissible (Catégorie 1 - 4 %) selon la LIR paragraphe 1100(11).
 * La DPA ne peut jamais créer ni augmenter une perte locative.
 */
export function computeCcaAllowance(
    ucc: number,
    netRentalIncomeBeforeCca: number,
    rate: number = CCA_CLASS_1_RATE,
    applyHalfYearRule: boolean = false,
): CcaRentalCalculation {
    const openingUcc = Math.max(0, num(ucc));
    const effectiveRate = applyHalfYearRule ? rate / 2 : rate;
    const allowableCca = openingUcc * effectiveRate;
    // Règle LIR 1100(11) : plafonné au revenu net avant DPA (aucun déficit créé par DPA)
    const claimedCca = netRentalIncomeBeforeCca > 0
        ? Math.min(allowableCca, netRentalIncomeBeforeCca)
        : 0;
    const closingUcc = Math.max(0, openingUcc - claimedCca);
    const netRentalIncomeAfterCca = netRentalIncomeBeforeCca - claimedCca;

    return {
        openingUcc,
        allowableCca,
        claimedCca,
        closingUcc,
        netRentalIncomeAfterCca,
    };
}

export interface CcaRecaptureResult {
    /** Récupération de la DPA imposable à 100 % (LIR 13(1)). */
    recapture100Pct: number;
    /** Gain en capital brut (avant inclusion 50 %) pour le prix excédant le coût d'origine. */
    capitalGainGross: number;
    /** Gain en capital imposable (LIR 38(a) : 50 %). */
    taxableCapitalGain50Pct: number;
    /** Perte finale admissible (si vente sous la FNACC sans autre bien dans la catégorie). */
    terminalLoss: number;
}

/**
 * Calcule la récupération de DPA et le gain en capital lors de la disposition d'un bien locatif.
 */
export function computeCcaRecapture(
    sellingPrice: number,
    initialCost: number,
    currentUcc: number,
): CcaRecaptureResult {
    const price = Math.max(0, num(sellingPrice));
    const cost = Math.max(0, num(initialCost));
    const ucc = Math.max(0, num(currentUcc));

    // Si le produit de vente est inférieur à la FNACC
    if (price < ucc) {
        return {
            recapture100Pct: 0,
            capitalGainGross: 0,
            taxableCapitalGain50Pct: 0,
            terminalLoss: ucc - price,
        };
    }

    // Récupération de DPA = min(prix, coût) - FNACC
    const proceedsAttributedToCca = Math.min(price, cost);
    const recapture100Pct = Math.max(0, proceedsAttributedToCca - ucc);

    // Gain en capital = max(0, prix - coût)
    const capitalGainGross = Math.max(0, price - cost);
    const taxableCapitalGain50Pct = capitalGainGross * CAPITAL_GAINS_INCLUSION_STANDARD;

    return {
        recapture100Pct,
        capitalGainGross,
        taxableCapitalGain50Pct,
        terminalLoss: 0,
    };
}

/**
 * Mensualité d'un prêt à annuités constantes.
 * Supporte la capitalisation semi-annuelle canadienne im = (1 + r/2)^(1/6) - 1.
 */
export function rentalMonthlyPayment(
    balance: number,
    annualRatePct: number,
    years: number,
    isCanadianSemiAnnual: boolean = true,
): number {
    const b = Math.max(0, num(balance));
    if (b <= 0) return 0;
    const n = Math.max(1, Math.round(num(years, DEFAULT_RENTAL_AMORTIZATION_YEARS) * 12));
    const rPct = num(annualRatePct);
    if (rPct <= 0) return b / n;
    const r = isCanadianSemiAnnual
        ? computeCanadianMonthlyMortgageRate(rPct)
        : (rPct / 100) / 12;
    const f = Math.pow(1 + r, n);
    return (b * r * f) / (f - 1);
}

/** Identifiant d'état d'un immeuble (SOURCE UNIQUE du repli `'anon'` — `initRentalStates` et le
 *  consommateur W5 doivent former la même clé, sinon l'intérêt d'un immeuble sans `id` se perd). */
export const rentalStateId = (rp: Pick<RentalProperty, 'id'>): string => rp.id || 'anon';

/**
 * [W5-RENTAL-INTERET-DPA] Intérêt hypothécaire du MOIS d'un immeuble, sur le solde de DÉBUT de mois.
 * Supporte la composition semi-annuelle canadienne (par défaut true).
 */
export const rentalInterestOfMonth = (
    s: Pick<RentalState, 'mortgage' | 'ratePct'>,
    isCanadianSemiAnnual: boolean = true,
): number => {
    if (s.mortgage <= 0) return 0;
    const rate = isCanadianSemiAnnual
        ? computeCanadianMonthlyMortgageRate(s.ratePct)
        : (s.ratePct / 100 / 12);
    return s.mortgage * rate;
};

/**
 * [W5-RENTAL-INTERET-DPA] Intérêt du mois PAR immeuble (clé = `rentalStateId`), lu AVANT
 * `processRentalMonth` du même mois — l'ordre de la boucle appelle les effets W5 avant le mois
 * locatif, et l'intérêt se calcule sur le solde de début de mois dans les deux cas : la somme de cette
 * table vaut EXACTEMENT `processRentalMonth(...).interest` du même mois (garde de chaîne).
 */
export function rentalInterestParImmeuble(
    states: readonly RentalState[],
    isCanadianSemiAnnual: boolean = true,
): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of states) out[s.id] = (out[s.id] ?? 0) + rentalInterestOfMonth(s, isCanadianSemiAnnual);
    return out;
}

/**
 * [W5-RENTAL-INTERET-DPA] DPA admissible du MOIS par immeuble (clé = `rentalStateId`),
 * calculée sur la FNACC résiduelle via computeCcaAllowance(s.ucc, netBeforeCca, 0.04 / 12).
 * LIR 1100(11) : la DPA ne peut excéder le revenu net avant DPA (NOI mensuel - intérêt).
 */
export function rentalCcaParImmeuble(
    states: readonly RentalState[],
    isCanadianSemiAnnual: boolean = true,
): Record<string, number> {
    const out: Record<string, number> = {};
    const monthlyRate = CCA_CLASS_1_RATE / 12;
    for (const s of states) {
        const interest = rentalInterestOfMonth(s, isCanadianSemiAnnual);
        const netBeforeCca = (s.monthlyNoi ?? 0) - interest;
        const currentUcc = s.ucc ?? s.currentValue;
        const ccaRes = computeCcaAllowance(currentUcc, netBeforeCca, monthlyRate);
        out[s.id] = ccaRes.claimedCca;
    }
    return out;
}

/** État initial des immeubles locatifs, calculé UNE fois avant la boucle mensuelle. */
export function initRentalStates(rentals: readonly RentalProperty[] | undefined): RentalState[] {
    return (rentals ?? []).filter(Boolean).map((rp) => {
        const mortgage = Math.max(0, num(rp.mortgageBalance));
        const val = Math.max(0, num(rp.currentValue));
        const rent = Math.max(0, num(rp.monthlyRent));
        const vacancy = Math.max(0, Math.min(100, num(rp.vacancyPct)));
        const expenses = Math.max(0, num(rp.monthlyExpenses));
        const monthlyNoi = rent * (1 - vacancy / 100) - expenses;
        return {
            id: rentalStateId(rp),
            currentValue: val,
            mortgage,
            monthlyPayment: rentalMonthlyPayment(
                mortgage,
                num(rp.mortgageRate),
                num(rp.amortizationYears, DEFAULT_RENTAL_AMORTIZATION_YEARS),
                true,
            ),
            ratePct: num(rp.mortgageRate),
            growthRatePct: num(rp.propertyGrowthRate, DEFAULT_RENTAL_GROWTH_PCT),
            isPaidOff: mortgage <= 0,
            ucc: val,
            initialCost: val,
            totalCcaClaimed: 0,
            monthlyRent: rent,
            vacancyPct: vacancy,
            monthlyExpenses: expenses,
            monthlyNoi,
        };
    });
}

export interface RentalMonthResult {
    /** Équité TOTALE des immeubles locatifs (valeur − hypothèque), déjà NETTE. */
    equity: number;
    /** Solde hypothécaire TOTAL restant. */
    mortgageBalance: number;
    /** Service de dette du mois (à ajouter aux dépenses). */
    debtService: number;
    /** Part INTÉRÊT du service, pour l'affichage et la déductibilité. */
    interest: number;
    /** Part CAPITAL du service. */
    principal: number;
    /** DPA déduite ce mois-ci sur l'ensemble des immeubles. */
    ccaClaimed: number;
    /** FNACC résiduelle totale après amortissement du mois. */
    totalUcc: number;
    /** Messages à journaliser (hypothèque d'un immeuble remboursée). */
    logs: string[];
}

/**
 * Un mois de vie des immeubles locatifs : croissance de la valeur, amortissement de l'hypothèque,
 * service de dette, DPA et mise à jour de la FNACC. MUTE `states` (comme le chemin des buts immobiliers) et rend les agrégats.
 *
 * ⚠️ `equity` est NETTE d'hypothèque — même convention que `realEstateEquity` du moteur. Ne JAMAIS
 * re-soustraire `mortgageBalance` du patrimoine après avoir ajouté `equity` : c'est le double
 * comptage que la source unique `computeRawNetWorth` interdit.
 */
export function processRentalMonth(
    states: RentalState[],
    names: readonly string[],
): RentalMonthResult {
    let equity = 0;
    let mortgageBalance = 0;
    let debtService = 0;
    let interest = 0;
    let principal = 0;
    let ccaClaimed = 0;
    let totalUcc = 0;
    const logs: string[] = [];
    const monthlyRate = CCA_CLASS_1_RATE / 12;

    for (let i = 0; i < states.length; i++) {
        const s = states[i];
        // [ENG-PROPGROWTH-PAR-IMMEUBLE] La croissance est celle de CET immeuble (semée au state).
        const growth = Math.pow(1 + s.growthRatePct / 100, 1 / 12);
        s.currentValue = Math.max(0, s.currentValue * growth);

        // ⚠️ Le service ne dépasse JAMAIS ce qu'il reste à devoir (solde + intérêt du mois) : sans
        // ce plafond, le dernier versement rembourserait plus que la dette et créerait de l'argent.
        // Même garde que le chemin des buts immobiliers.
        const interestPaid = rentalInterestOfMonth(s);
        const payment = s.mortgage > 0 ? Math.min(s.monthlyPayment, s.mortgage + interestPaid) : 0;
        const principalPaid = Math.max(0, payment - interestPaid);

        if (payment > 0) {
            const before = s.mortgage;
            s.mortgage = Math.max(0, s.mortgage - principalPaid);
            debtService += payment;
            interest += interestPaid;
            principal += principalPaid;
            if (before > 0 && s.mortgage <= 0 && !s.isPaidOff) {
                s.isPaidOff = true;
                s.monthlyPayment = 0;
                logs.push(`🏘️ Hypothèque remboursée : ${names[i] || 'immeuble locatif'} t'appartient pleinement.`);
            }
        }

        // --- DPA / CCA mensuelle et mise à jour de la FNACC / UCC ---
        const netBeforeCca = (s.monthlyNoi ?? 0) - interestPaid;
        const currentUcc = s.ucc ?? s.currentValue;
        const ccaRes = computeCcaAllowance(currentUcc, netBeforeCca, monthlyRate);
        s.ucc = ccaRes.closingUcc;
        s.totalCcaClaimed = (s.totalCcaClaimed ?? 0) + ccaRes.claimedCca;
        ccaClaimed += ccaRes.claimedCca;
        totalUcc += s.ucc;

        equity += s.currentValue - s.mortgage;
        mortgageBalance += s.mortgage;
    }

    return { equity, mortgageBalance, debtService, interest, principal, ccaClaimed, totalUcc, logs };
}
