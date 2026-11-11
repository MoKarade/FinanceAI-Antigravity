// services/projection/childrenReee.ts
// Cycle 14: traitement mensuel d'un enfant — dépenses enfant, RQAP, REEE,
// études et fermeture REEE.
//
// Pattern: Pure Return — la fonction retourne tous les deltas, le caller
// les applique sur ses propres variables locales.
// Injection: calculateFiscalReport passé en argument — pour la TESTABILITÉ (stub/espion).

import { formatCAD } from '../../utils/format';
import type { ChildGoal } from '../../types';
import {
    RQAP_MAX_INCOME,
    QC_FEDERAL_ABATEMENT_RATE,
    FED_NONREFUNDABLE_RATE,
    BASIC_PERSONAL_AMOUNT_FED,
    BASIC_PERSONAL_AMOUNT_QC,
    FED_BRACKETS,
    QC_BRACKETS,
    type FiscalReport,
} from '../../utils/tax';

import {
    DAYCARE_INFO, SCHOOL_INFO, ACTIVITIES_INFO, UNI_INFO, CAR_INFO,
    type DaycareType, type SchoolType, type ActivitiesLevel,
    type UniversityType, type CarGift,
} from './childCosts';
import { projeterAuPatronMga } from './helpers';

// ── Constantes fiscales REEE — SCEE / IQEE ──────────────────────────────────────
// Source de vérité : docs/FISCAL_REFERENCE.md § « REEE — SCEE / IQEE » (FISC-REEE-CONST).
// SCEE (Subvention canadienne pour l'épargne-études, ARC) : 20 % de la cotisation,
// max 500 $/an (1 000 $/an en rattrapage), 7 200 $ à vie par bénéficiaire.
const SCEE_GRANT_RATE = 0.20;
const SCEE_ANNUAL_GRANT_BASIC = 500;
const SCEE_ANNUAL_GRANT_CATCHUP = 1000;
const SCEE_LIFETIME_GRANT_LIMIT = 7200;
// IQEE (Incitatif québécois à l'épargne-études, Revenu Québec) : 10 % de la cotisation,
// max 250 $/an (500 $/an en rattrapage), 3 600 $ à vie par bénéficiaire.
const IQEE_GRANT_RATE = 0.10;
const IQEE_ANNUAL_GRANT_BASIC = 250;
const IQEE_ANNUAL_GRANT_CATCHUP = 500;
const IQEE_LIFETIME_GRANT_LIMIT = 3600;
// Plafond de cotisation REEE à vie (ARC §6.9 / F13) + cotisations annuelles visées pour
// capter la pleine subvention (5 000 $/an en rattrapage tant que SCEE < max théorique).
const REEE_LIFETIME_LIMIT_PER_BENEFICIARY = 50000;
const REEE_TARGET_ANNUAL_CONTRIB_BASIC = 2500;
const REEE_TARGET_ANNUAL_CONTRIB_CATCHUP = 5000;
// Impôt sur le Paiement de Revenu Accumulé (PRA) à la fermeture du REEE : APPROXIMATION
// de modèle (~20 %), PAS un taux combiné officiel ARC/RQ — à raffiner (BACKLOG FISC-REEE-AIP-MODEL).
// Biais : frappe le solde TOTAL (cotisations + gains) → SUR-impose les cotisations remboursées
// sans impôt, et SOUS-impose si le taux marginal + la surtaxe PRA de 20 % dépasse 20 %.
const REEE_AIP_TAX_RATE = 0.20;

// ── RQAP — congé parental ───────────────────────────────────────────────────────
// Source de vérité du PLAFOND : `RQAP_MAX_INCOME` (`utils/tax.ts`, FISCAL_REFERENCE §2).
// Taux de remplacement officiel bipalier du Régime de base du RQAP (Loi sur l'assurance parentale) :
// - Palier 1 : 70 % pendant les 6 premiers mois (semaines 1 à 26)
// - Palier 2 : 55 % pour les 6 mois suivants (semaines 27 à 52)
export const RQAP_TIER1_RATE = 0.70;
export const RQAP_TIER2_RATE = 0.55;

export function computeRqapBenefits(
    baseAnnualSalary: number,
    monthOfLeave: number,
    regime: 'base' | 'particulier' = 'base',
    mra: number = RQAP_MAX_INCOME,
): { replacementRate: number; grossMonthlyBenefit: number } {
    const salary = Math.max(0, Number(baseAnnualSalary) || 0);
    const insurable = Math.min(salary, mra);
    let replacementRate = RQAP_TIER1_RATE;
    if (regime === 'particulier') {
        replacementRate = 0.75;
    } else {
        replacementRate = monthOfLeave < 6 ? RQAP_TIER1_RATE : RQAP_TIER2_RATE;
    }
    const grossMonthlyBenefit = (insurable * replacementRate) / 12;
    return { replacementRate, grossMonthlyBenefit };
}

export function computeQuebecChildcareCreditRate(familyNetIncome: number): number {
    const income = Math.max(0, Number(familyNetIncome) || 0);
    if (income <= 41885) return 0.78;
    if (income >= 123000) return 0.67;
    const slope = (0.67 - 0.78) / (123000 - 41885);
    return 0.78 + slope * (income - 41885);
}

export function computeFederalChildcareDeduction(
    expenses: number,
    childAge: number,
    lowerSpouseEarnedIncome: number,
): number {
    const annualCap = childAge < 7 ? 8000 : 5000;
    const twoThirdsLimit = (2 / 3) * Math.max(0, lowerSpouseEarnedIncome);
    return Math.max(0, Math.min(expenses, annualCap, twoThirdsLimit));
}

export function computeChildcareSupport(
    totalCareCostAnnual: number,
    familyNetIncome: number,
    numChildren: number = 1,
    ages: number[] = [3],
    lowerSpouseEarnedIncome?: number,
): {
    qcRefundableCredit: number;
    fedTaxRelief: number;
    totalSupport: number;
    netCostAnnual: number;
    netCostMonthly: number;
} {
    const careAnnual = Math.max(0, Number(totalCareCostAnnual) || 0);
    if (careAnnual <= 0) {
        return { qcRefundableCredit: 0, fedTaxRelief: 0, totalSupport: 0, netCostAnnual: 0, netCostMonthly: 0 };
    }

    const effectiveAges = ages.length > 0 ? ages : [3];
    const n = Math.max(1, numChildren || effectiveAges.length);
    const costPerChild = careAnnual / n;

    const qcRate = computeQuebecChildcareCreditRate(familyNetIncome);
    let qcEligibleTotal = 0;
    for (let i = 0; i < n; i++) {
        const age = effectiveAges[i] ?? effectiveAges[0] ?? 3;
        const qcCap = age < 7 ? 11965 : 5545;
        qcEligibleTotal += Math.min(costPerChild, qcCap);
    }
    const qcRefundableCredit = qcEligibleTotal * qcRate;

    const lowerIncome = lowerSpouseEarnedIncome !== undefined ? lowerSpouseEarnedIncome : Math.max(0, familyNetIncome / 2);
    let fedDeductionTotal = 0;
    for (let i = 0; i < n; i++) {
        const age = effectiveAges[i] ?? effectiveAges[0] ?? 3;
        fedDeductionTotal += computeFederalChildcareDeduction(costPerChild, age, lowerIncome / n);
    }
    const fedTaxRelief = fedDeductionTotal * (FED_NONREFUNDABLE_RATE * (1 - QC_FEDERAL_ABATEMENT_RATE));

    const totalSupport = Math.min(careAnnual, qcRefundableCredit + fedTaxRelief);
    const netCostAnnual = Math.max(0, careAnnual - totalSupport);
    const netCostMonthly = netCostAnnual / 12;

    return {
        qcRefundableCredit,
        fedTaxRelief,
        totalSupport,
        netCostAnnual,
        netCostMonthly,
    };
}

/**
 * Indexation du plafond de revenu assurable RQAP.
 *
 * ⚠️ C'était `98000 * expenseMultiplier`, et le multiplicateur était le MAUVAIS index — pas
 * seulement imprécis, structurellement faux :
 *   • `expenseMultiplier` compose l'inflation des DÉPENSES DU MÉNAGE, courbe du sourire de retraite
 *     comprise (`computeEffectiveExpenseInflation` dépend de `age` et `isRetired`) ;
 *   • et il est GELABLE par Guyton-Klinger. MESURÉ : à l'année 20, un gel de la règle de
 *     décaissement faisait passer l'assiette RQAP de 80 092 $ à 53 900 $. Aucune stratégie de
 *     portefeuille ne peut déplacer un plafond gouvernemental.
 *
 * ⚠️ [RQAP-INDEX-SOURCE] **NON SOURCÉ — hypothèse de travail, pas une règle établie.** Ce dépôt
 * SUPPOSE que le plafond RQAP est indexé sur la rémunération hebdomadaire moyenne au Québec, de la
 * même nature que le MGA de la RRQ, que ce dépôt projette DÉJÀ à `inflation + 0,5 %/an`
 * (`retirementIncome.ts`, FISCAL_REFERENCE §6) — d'où la réutilisation de ce patron plutôt que
 * l'invention d'un autre. Aucune disposition de la Loi sur l'assurance parentale n'est citée à
 * l'appui : c'est le RATIONNEL d'un choix de modèle, et il ne doit pas se lire comme du droit.
 * La citation reste le meilleur correctif ; elle n'a pas pu être établie depuis l'environnement de
 * développement (LégisQuébec et `rqap.gouv.qc.ca` sont bloqués par la politique réseau — tenté le
 * 2026-09-03). Inventer une référence serait fabriquer la source qu'on prétend citer.
 *
 * ⚠️ DEUX INDEX DIFFÉRENTS SUR LA MÊME BOUCLE, ET C'EST VOULU — ne pas « harmoniser ».
 * `annaGrossAnnual` juste au-dessus est indexé par `simSalaryGrowth`, pas par ce facteur-ci. C'est
 * OBLIGATOIRE : ce salaire est RETIRÉ du brut imposable par `accGrossDelta -= annaGrossMonthly`, et
 * il doit donc valoir exactement ce qu'`activeIncome.ts` avait crédité (même base, même exposant).
 * L'indexer autrement fabriquerait ou détruirait du brut à chaque mois de congé.
 * Le précédent B-AUDIT-4 (`retirementIncome.ts`) indexe salaire ET MGA par le MÊME facteur pour
 * une raison qui ne vaut PAS ici : la RRQ dépend d'un ratio gains/MGA moyen de CARRIÈRE, qu'on gèle
 * délibérément. Le RQAP, lui, compare le revenu assurable de l'ANNÉE au plafond de cette année-là.
 *
 * ⚠️ Le +0,5 pp est une HYPOTHÈSE calibrée SOUS l'indexation observée, pas une valeur sourcée : les
 * seuls points du dépôt donnent RQAP 98 000 → 103 000 $ (+5,10 %) et MGA 71 300 → 74 600 $
 * (+4,63 %), contre 2,5 %/an modélisé. Le biais est CONSERVATEUR (le plafond mord plus tôt, donc la
 * prestation est sous-estimée avec l'horizon) et hérité du patron MGA. Écart chiffré en §2.
 */
const rqapCapProjected = (simInflation: number, yearsElapsed: number): number =>
    projeterAuPatronMga(RQAP_MAX_INCOME, simInflation, yearsElapsed);

type FiscalReportFn = (
    grossIncome: number,
    rrspContrib: number,
    fhsaContrib: number,
    year: number,
    skipBreakdown: boolean,
    // [RQAP-PRESTATION-COTISATIONS] Les deux paramètres suivants de la vraie signature — le type
    // injecté doit les porter, sinon l'appel « prestation à assiette d'emploi NULLE » ne compile
    // pas et le défaut (assiette = grossIncome) redevient le seul chemin possible.
    ageOpts?: undefined,
    employmentIncome?: number,
) => FiscalReport;

export interface ChildProcessCtx {
    m: number;
    loopYear: number;
    simSalaryGrowth: number;
    simInflation: number;
    expenseMultiplier: number;
    isRetired: boolean;
    grossMarcBaseAnnual: number;
    grossAnnaBaseAnnual: number;
    incomeAnna: number;
    liquid: number;
    reee: number;
    householdGross: number;
    trackerScee: number;
    trackerIqee: number;
    /** Contributions REEE cumulées à vie pour CE bénéficiaire (audit §6.9 / F13).
     *  Le plafond ARC est 50 000$/enfant à vie — au-delà, plus de cotisations
     *  permises (mais la croissance continue). */
    trackerReeeContribLifetime: number;
    enableMonteCarlo: boolean;
    /** Solde PSE (capital souscripteur, non imposable). */
    pseBalance?: number;
    /** Solde PAE (subventions + rendements accumulés, imposable étudiant). */
    paeBalance?: number;
    /** Subventions fédérales SCEE restantes non encore décaissées. */
    remainingSceeGrants?: number;
    /** Subventions québécoises IQEE restantes non encore décaissées. */
    remainingIqeeGrants?: number;
    /** Droits de cotisation REER parentaux disponibles pour roulement AIP (LIR 204.94, max 50 000 $). */
    parentRrspRoom?: number;
    /** Taux marginal du parent pour calcul de l'impôt ordinaire AIP à la fermeture. */
    parentMarginalRate?: number;
    /**
     * [ENG-DIVORCE-REEE-COTISATIONS] Part des COTISATIONS REEE qui reste à la charge du déclarant.
     *
     * Décision Marc 2026-08-17 : les cotisations suivent le partage **PATRIMONIAL** (`keep`,
     * cumulé au fil des divorces), comme le SOLDE du régime — et NON la garde des enfants, qui
     * pilote les coûts. `docs/adr/0012-quatre-decisions-de-marc-2026-08-17.md` laissait la question ouverte ; Marc l'a tranchée.
     *
     * ⚠️ Optionnel à défaut NEUTRE (1) : hors divorce, la projection est BIT-IDENTIQUE, donc
     * aucun code de migration et aucune rétrocompat à écrire.
     */
    reeeContribShare?: number;
    /**
     * [ENG-DIVORCE-BENEFITS-FLUX] Part des ENFANTS qui reste à la charge du déclarant (garde).
     *
     * ⚠️ APPLIQUÉE ICI, À LA SOURCE, et plus par l'appelant. La première version multipliait
     * quelques champs du RÉSULTAT dans `projection.ts` — et c'était structurellement condamné :
     * chaque montant d'enfant alimente 3 à 5 registres (liquidités, dépenses du mois, coût brut,
     * coût mensuel, allocations, retrait REEE), et partager le résultat oblige à se souvenir de
     * TOUS. Deux ont été oubliés, mesurés par deux agents indépendants :
     *   • les ALLOCATIONS étaient encaissées à 100 % (`monthlyIncomeDelta` non partagé) mais
     *     publiées à 50 % — 332 $/mois encaissés contre 166 $ affichés, 75 957 $ d'écart sur le
     *     patrimoine final ;
     *   • le DÉCAISSEMENT REEE d'études restait entier face à une dépense à 50 % — +1 450 $/mois
     *     de trésorerie née de nulle part, et le régime de l'enfant vidé 2× trop vite.
     * En partageant le MONTANT plutôt que ses reflets, tout dérivé suit par construction. C'est la
     * classe maison « un flux alimente PLUSIEURS registres », traitée à la racine cette fois.
     *
     * ⚠️ Ne s'applique PAS au RQAP ni à l'économie de transport du congé parental : ceux-là
     * dépendent du congé de l'ex-conjoint, pas de la garde. Ni aux cotisations REEE, qui suivent
     * le partage patrimonial (`reeeContribShare`).
     * ⚠️ Optionnel à défaut NEUTRE (1) ⇒ hors divorce, projection BIT-IDENTIQUE.
     */
    childCustodyShare?: number;
}

export interface ChildTickResult {
    liquidDelta: number;
    /**
     * [ENG-DIVORCE-CHILDREN-REEE] `liquidDelta` VENTILÉ par CLÉ DE PARTAGE, parce que les deux
     * familles ne suivent PAS la même règle après un divorce :
     *   • `liquidDeltaCosts` — coûts d'enfants (frais de naissance, voiture) → suivent la GARDE ;
     *   • `liquidDeltaReee`  — flux REEE (cotisations, décaissement) → suivent le partage
     *     PATRIMONIAL `keep`, comme le SOLDE du régime (`reee *= keep`).
     * ⚠️ Invariant : `liquidDeltaCosts + liquidDeltaReee === liquidDelta`, sous test. Sans cette
     * séparation, appliquer une part au flux entier diviserait aussi les cotisations REEE — un faux
     * SILENCIEUX. C'est le motif « un flux alimente PLUSIEURS registres », déjà au dossier.
     */
    liquidDeltaCosts: number;
    liquidDeltaReee: number;
    monthlyExpenseDelta: number;
    monthlyIncomeDelta: number;
    newIncomeAnna: number | null;
    accGrossDelta: number;
    reeeNewBalance: number;
    newPseBalance: number;
    newPaeBalance: number;
    remainingSceeGrants: number;
    remainingIqeeGrants: number;
    withdrawalPseAdd: number;
    withdrawalPaeAdd: number;
    studentTaxAdd: number;
    taxDiversAdd: number;

    newTrackerScee: number;
    newTrackerIqee: number;
    /** Contributions REEE cumulées à vie après application du mois courant
     *  (clamped à 50 000$ par bénéficiaire). */
    newTrackerReeeContribLifetime: number;
    childId: string;

    childGrossCostAdd: number;
    childBenefitsAdd: number;
    childMonthlyCostAdd: number;
    reeeContribAdd: number;
    withdrawalLiquidAdd: number;
    withdrawalREEEAdd: number;
    reeePayoutAdd: number;
    contribREEEAdd: number;
    contribLiquidAdd: number;

    lifeEventLogs: string[];
    flowEventLogs: string[];
}


/**
 * Traite un enfant pour le mois courant.
 * @param isFirstMonth  true si m === birthOffset (événement naissance)
 * @param childAgeMonths  m − birthOffset
 */
export function processOneChild(
    child: ChildGoal,
    childIdx: number,
    isFirstMonth: boolean,
    childAgeMonths: number,
    ctx: ChildProcessCtx,
    calculateFiscalReport: FiscalReportFn,
): ChildTickResult {
    const {
        m, loopYear, simSalaryGrowth, simInflation, expenseMultiplier, isRetired,
        grossAnnaBaseAnnual, incomeAnna, liquid, reee,
        householdGross, trackerScee, trackerIqee,
        trackerReeeContribLifetime, enableMonteCarlo,
    } = ctx;
    // Défaut neutre : un `undefined` (appelant d'avant, test existant) vaut « part entière ».
    const reeeContribShare = Number.isFinite(ctx.reeeContribShare) ? Number(ctx.reeeContribShare) : 1;
    const custody = Number.isFinite(ctx.childCustodyShare) ? Number(ctx.childCustodyShare) : 1;

    const childId = child.id || `enfant_${childIdx}`;

    let liquidDelta = 0;
    let liquidDeltaCosts = 0;
    let liquidDeltaReee = 0;
    let monthlyExpenseDelta = 0;
    let monthlyIncomeDelta = 0;
    let newIncomeAnna: number | null = null;
    let accGrossDelta = 0;
    let reeeNewBalance = reee;
    let currentPse = ctx.pseBalance !== undefined ? Math.max(0, ctx.pseBalance) : 0;
    let currentPae = ctx.paeBalance !== undefined ? Math.max(0, ctx.paeBalance) : 0;
    if (ctx.pseBalance === undefined && ctx.paeBalance === undefined && reee > 0) {
        if (trackerReeeContribLifetime > 0) {
            currentPse = Math.min(reee, trackerReeeContribLifetime);
            currentPae = Math.max(0, reee - currentPse);
        } else {
            currentPse = reee;
            currentPae = 0;
        }
    }
    let remainingScee = ctx.remainingSceeGrants !== undefined ? Math.max(0, ctx.remainingSceeGrants) : trackerScee;
    let remainingIqee = ctx.remainingIqeeGrants !== undefined ? Math.max(0, ctx.remainingIqeeGrants) : trackerIqee;
    let withdrawalPseAdd = 0;
    let withdrawalPaeAdd = 0;
    let studentTaxAdd = 0;

    let taxDiversAdd = 0;
    let newTrackerScee = trackerScee;
    let newTrackerIqee = trackerIqee;
    let newTrackerReeeContribLifetime = trackerReeeContribLifetime;
    let childGrossCostAdd = 0;
    let childBenefitsAdd = 0;
    let childMonthlyCostAdd = 0;
    let reeeContribAdd = 0;
    let withdrawalLiquidAdd = 0;
    let withdrawalREEEAdd = 0;
    let reeePayoutAdd = 0;
    let contribREEEAdd = 0;
    let contribLiquidAdd = 0;
    const lifeEventLogs: string[] = [];
    const flowEventLogs: string[] = [];


    // Résolution des choix UI (defaults alignés avec ChildPlanning.tsx)
    const daycareType: DaycareType = (child.daycareType as DaycareType) || 'cpe';
    const schoolType: SchoolType = (child.schoolType as SchoolType) || 'publique';
    const activitiesLevel: ActivitiesLevel = (child.activitiesLevel as ActivitiesLevel) || 'legeres';
    const universityType: UniversityType = (child.universityType as UniversityType) || 'uni_local';
    const carGift: CarGift = (child.carGift as CarGift) || 'non';
    const daycareMonthlyUI = DAYCARE_INFO[daycareType].monthly;
    const schoolYearly = SCHOOL_INFO[schoolType].yearlyExtra;
    const activitiesYearly = ACTIVITIES_INFO[activitiesLevel].yearlyExtra;
    const uni = UNI_INFO[universityType];
    const carCost = CAR_INFO[carGift].cost;
    const parentAtHome = daycareType === 'parent_foyer';
    const childAgeYears = Math.floor(childAgeMonths / 12);

    if (isFirstMonth) {
        // ⚠️ Part de garde au MONTANT, pas à ses reflets — voir `childCustodyShare` dans le ctx.
        const fraisNaissance = (child.initialCost ?? 0) * custody;
        liquidDelta -= fraisNaissance;
        liquidDeltaCosts -= fraisNaissance;
        lifeEventLogs.push(`Naissance 👶 (${child.name || 'Enfant'})`);
    }

    if (childAgeMonths < 18 * 12) {
        // Mêmes tranches que ChildPlanning.tsx — voir services/projection/childCosts.ts.
        // On reconstruit ici les flux mensuels pour conserver l'intégration mois-à-mois
        // (RQAP, allocations, REEE) qui suit son propre cadencement.
        const diapers = child.monthlyDiapers ?? 0;
        const food = child.monthlyFood ?? 0;
        const clothing = child.monthlyClothing ?? 0;

        let cMonthly = 0; // dépenses essentielles mensuelles
        let careMonthly = 0; // garderie / école / activités, en mensuel

        if (childAgeYears === 0) {
            cMonthly = diapers + food + clothing;
            careMonthly = parentAtHome ? 0 : daycareMonthlyUI;
        } else if (childAgeYears >= 1 && childAgeYears <= 4) {
            cMonthly = diapers * 0.5 + food + clothing + 50;
            careMonthly = parentAtHome ? 0 : daycareMonthlyUI;
        } else if (childAgeYears >= 5 && childAgeYears <= 11) {
            cMonthly = food + clothing + 80;
            careMonthly = (schoolYearly + activitiesYearly) / 12;
        } else if (childAgeYears >= 12 && childAgeYears <= 17) {
            cMonthly = food * 1.2 + clothing * 1.5 + 150;
            careMonthly = (schoolYearly + activitiesYearly) / 12;
            // Achat 16 ans amorti sur l'année (500$/an = ~41.67$/mois cette année-là)
            if (childAgeYears === 16) cMonthly += 500 / 12;
        }

        // Congé parental « Anna » (2e parent) : UNIQUEMENT si un 2e parent existe
        // et a un salaire. Sans ce garde-fou, un PARENT SEUL (grossAnnaBaseAnnual=0)
        // recevait un RQAP fantôme : calculateFiscalReport(0) renvoie un net POSITIF
        // (crédits remboursables QC sur revenu nul) → newIncomeAnna > 0 = revenu d'un
        // 2e parent inexistant. (Le congé du parent seul n'est pas modélisé ici — à
        // faire séparément ; au minimum on ne fabrique plus de revenu.)
        // [REEE-CONGE-SANS-GARDE-SOLO] `!isRetired` : `grossAnnaBaseAnnual` est le salaire de BASE,
        // il reste non nul après la retraite (le moteur cesse simplement de le créditer, cf. la
        // branche `isRetired` de projection.ts). Sans cette porte, un ménage retraité avec un
        // nourrisson RETIRAIT un salaire qu'il ne touche plus (MESURÉ : −5 000 $/mois de brut) et
        // recevait une prestation RQAP impossible. Même convention que la cotisation REEE plus bas,
        // qui est déjà conditionnée à `!isRetired`.
        const annaIsOnMatLeave = childAgeMonths < 12 && grossAnnaBaseAnnual > 0 && !isRetired;
        if (annaIsOnMatLeave) {
            const yearsElapsed = Math.floor(m / 12);
            const annaGrossAnnual = grossAnnaBaseAnnual * Math.pow(1 + simSalaryGrowth / 100, yearsElapsed);
            const rqapCap = rqapCapProjected(simInflation, yearsElapsed);
            const eligibleSalary = Math.min(annaGrossAnnual, rqapCap);

            // [RQAP-PRESTATION-COTISATIONS] `employmentIncome: 0` — une prestation RQAP est du
            // revenu IMPOSABLE à assiette de cotisation NULLE (règle sourcée, décision Marc
            // 2026-08-20, FISCAL_REFERENCE §2 : les cotisations RRQ/RQAP/AE ne portent que sur la
            // rémunération de TRAVAIL, et aucun employeur ne verse cette prestation). Sans le 7e
            // argument, `calculateFiscalReport` retombe sur `grossIncome` et la prestation payait
            // RRQ + RQAP + AE : MESURÉ, 4 328,50 $/an de cotisations fantômes sur une prestation
            // au plafond (56 650 $ → net 42 366,76 au lieu de 46 695,26).
            const { replacementRate } = computeRqapBenefits(eligibleSalary, childAgeMonths, 'base', rqapCap);
            const rqapNetInfo = calculateFiscalReport(
                eligibleSalary * replacementRate, 0, 0, loopYear, enableMonteCarlo,
                undefined, 0);
            const rqapNetMonthly = rqapNetInfo.netIncome / 12;

            // Replace Anna's salary with RQAP in the income pool
            monthlyIncomeDelta += rqapNetMonthly - incomeAnna;
            newIncomeAnna = rqapNetMonthly;

            const annaGrossMonthly = annaGrossAnnual / 12;
            accGrossDelta -= annaGrossMonthly;

            monthlyExpenseDelta -= 350 * expenseMultiplier; // commuting savings
            // Pendant le congé parental : pas de frais garderie
            careMonthly = 0;
        }

        // Frais garderie nets : pour garde privée (> 400 $/mois, non CPE),
        // calcul exact du crédit remboursable Québec (Annexe C) et de la déduction fédérale T778 (ligne 21400)
        // CPE déjà subventionné (< 400 $/mois) reste à sa contribution de base sans réduction additionnelle.
        if (careMonthly > 400) {
            const annualCare = careMonthly * 12;
            const grossMarc = Math.max(0, householdGross - grossAnnaBaseAnnual);
            const lowerEarned = grossAnnaBaseAnnual > 0 ? Math.min(grossMarc, grossAnnaBaseAnnual) : grossMarc;
            const careSupport = computeChildcareSupport(annualCare, householdGross, 1, [childAgeYears], lowerEarned);
            careMonthly = careSupport.netCostMonthly;
        }

        // Total mensuel = essentiel + garderie/école/activités, indexé inflation
        const currentChildGrossCost = (cMonthly + careMonthly) * expenseMultiplier * custody;
        monthlyExpenseDelta += currentChildGrossCost;

        let adjustedBenefits = child.governmentBenefits ?? 0;
        // Ados 12-17 ans : réduction allocation (cohérence ChildPlanning)
        if (childAgeYears >= 12 && childAgeYears <= 17) {
            adjustedBenefits = Math.max(0, adjustedBenefits - 100);
        }
        if (householdGross > 150000) {
            const clawbackRatio = Math.max(0, 1 - ((householdGross - 150000) / 100000));
            adjustedBenefits *= clawbackRatio;
        }
        // ⚠️ LE défaut mesuré 2×. Partager `adjustedBenefits` ICI touche d'un coup
        // `monthlyIncomeDelta` (l'encaisse) ET `childBenefitsAdd` (le registre publié) : c'est
        // leur DIVERGENCE qui faisait encaisser 332 $/mois pendant que l'écran affichait 166 $.
        adjustedBenefits *= custody;
        monthlyIncomeDelta += adjustedBenefits;
        childGrossCostAdd += currentChildGrossCost;
        childBenefitsAdd += adjustedBenefits;
        childMonthlyCostAdd += currentChildGrossCost;

        // REEE contributions with SCEE/IQEE catch-up
        // +1 car SCEE calcule sur l'année civile EN COURS, pas l'âge révolu
        const childAgeYearsForGrant = childAgeYears + 1;
        const maxTheoreticalScee = Math.min(SCEE_LIFETIME_GRANT_LIMIT, childAgeYearsForGrant * SCEE_ANNUAL_GRANT_BASIC);

        let optimalReeeMonthly = REEE_TARGET_ANNUAL_CONTRIB_BASIC / 12;
        let sceeYearlyLimit = SCEE_ANNUAL_GRANT_BASIC;
        let iqeeYearlyLimit = IQEE_ANNUAL_GRANT_BASIC;

        if (newTrackerScee < maxTheoreticalScee) {
            optimalReeeMonthly = REEE_TARGET_ANNUAL_CONTRIB_CATCHUP / 12;
            sceeYearlyLimit = SCEE_ANNUAL_GRANT_CATCHUP;
            iqeeYearlyLimit = IQEE_ANNUAL_GRANT_CATCHUP;
        }

        // Audit §6.9 / F13: plafond REEE lifetime 50 000$/bénéficiaire (ARC).
        // Si on s'approche du plafond, on plafonne la cotisation du mois courant.
        // Au-delà du plafond → 0 cotisation (la croissance du REEE continue,
        // mais aucune nouvelle contribution n'est permise).
        const lifetimeContribRoomLeft = Math.max(0, REEE_LIFETIME_LIMIT_PER_BENEFICIARY - newTrackerReeeContribLifetime);
        if (optimalReeeMonthly > lifetimeContribRoomLeft) {
            optimalReeeMonthly = lifetimeContribRoomLeft;
        }

        // [ENG-DIVORCE-REEE-COTISATIONS] La part patrimoniale s'applique ICI, sur le MONTANT de
        // cotisation, avant tout usage.
        // ⚠️ POURQUOI ICI ET NULLE PART AILLEURS. Cette cotisation alimente CINQ registres à la
        // fois : la sortie de liquidités, le tracker à vie, les subventions SCEE/IQEE (calculées
        // EN PROPORTION de la cotisation), le nouveau solde du REEE et `contribREEE`. Mettre la
        // part en aval — sur `liquidDeltaReee` seul, comme la première version le laissait
        // croire — aurait CRÉÉ de l'argent : le solde REEE aurait crédité une cotisation que les
        // liquidités n'auraient pas payée, et la conservation aurait cassé sans qu'aucun test de
        // la garde 50/50 ne rougisse. Classe maison « un flux alimente PLUSIEURS registres ».
        // Appliquée APRÈS le plafond à vie : une cotisation réduite ne peut pas le dépasser.
        if (reeeContribShare !== 1) optimalReeeMonthly *= reeeContribShare;

        // Check against effective liquid (after birth cost if first month)
        if (optimalReeeMonthly > 0 && liquid + liquidDelta >= optimalReeeMonthly && !isRetired) {
            liquidDelta -= optimalReeeMonthly;
            liquidDeltaReee -= optimalReeeMonthly;
            withdrawalLiquidAdd += optimalReeeMonthly;
            reeeContribAdd += Math.round(optimalReeeMonthly);
            // Audit §6.9: tracker mis à jour pour bloquer les futurs mois
            newTrackerReeeContribLifetime += optimalReeeMonthly;

            const sceeGrant = Math.min(optimalReeeMonthly * SCEE_GRANT_RATE, sceeYearlyLimit / 12, SCEE_LIFETIME_GRANT_LIMIT - newTrackerScee);
            newTrackerScee += Math.max(0, sceeGrant);
            remainingScee += Math.max(0, sceeGrant);

            const iqeeGrant = Math.min(optimalReeeMonthly * IQEE_GRANT_RATE, iqeeYearlyLimit / 12, IQEE_LIFETIME_GRANT_LIMIT - newTrackerIqee);
            newTrackerIqee += Math.max(0, iqeeGrant);
            remainingIqee += Math.max(0, iqeeGrant);

            const totalGrant = Math.max(0, sceeGrant) + Math.max(0, iqeeGrant);
            currentPse += optimalReeeMonthly;
            currentPae += totalGrant;
            reeeNewBalance = currentPse + currentPae;
            contribREEEAdd += optimalReeeMonthly + totalGrant;
        }
    }

    // Achat voiture cadeau à 18 ans (premier mois de la 18e année)
    if (childAgeMonths === 18 * 12 && carCost > 0) {
        const carInflated = carCost * expenseMultiplier * custody;
        liquidDelta -= carInflated;
        liquidDeltaCosts -= carInflated;
        lifeEventLogs.push(`🚗 Cadeau voiture pour ${child.name || 'l\'enfant'} (18 ans) : -${formatCAD(Math.round(carInflated))}`);
        childGrossCostAdd += carInflated;
        childMonthlyCostAdd += carInflated;
    }

    // Études post-secondaires : durée et coût annuel selon universityType
    // (uni_local 5k$/an × 4 ans, uni_etranger 35k$/an × 4 ans, etc.).
    const uniStartMonths = 18 * 12;
    const uniEndMonths = uniStartMonths + uni.years * 12;
    if (uni.years > 0 && childAgeMonths >= uniStartMonths && childAgeMonths < uniEndMonths) {
        const studiesMonthly = (uni.yearlyCost / 12) * expenseMultiplier * custody;
        monthlyExpenseDelta += studiesMonthly;
        childGrossCostAdd += studiesMonthly;
        childMonthlyCostAdd += studiesMonthly;

        const totalReeeAvailable = currentPse + currentPae;
        const toWithdraw = Math.min(totalReeeAvailable, studiesMonthly);

        if (toWithdraw > 0) {
            // Décaissement prioritaire du PAE (subventions + rendements, imposable étudiant)
            const fromPae = Math.min(currentPae, toWithdraw);
            currentPae -= fromPae;
            withdrawalPaeAdd += fromPae;

            // Amortissement au prorata des subventions restantes dans la poche PAE
            const totalPaeBefore = currentPae + fromPae;
            if (totalPaeBefore > 0 && (remainingScee + remainingIqee) > 0) {
                const grantRatio = (remainingScee + remainingIqee) / totalPaeBefore;
                const totalGrantsAmortized = fromPae * grantRatio;
                const sceeRatio = (remainingScee + remainingIqee > 0) ? remainingScee / (remainingScee + remainingIqee) : 2 / 3;
                remainingScee = Math.max(0, remainingScee - totalGrantsAmortized * sceeRatio);
                remainingIqee = Math.max(0, remainingIqee - totalGrantsAmortized * (1 - sceeRatio));
            }

            const fromPse = Math.min(currentPse, toWithdraw - fromPae);
            currentPse -= fromPse;
            withdrawalPseAdd += fromPse;

            // Fiscalité étudiant sur la part PAE (neutralisée sous le BPA 16 452 $ fédéral / 18 952 $ QC)
            const annualPae = fromPae * 12;
            const fedTaxable = Math.max(0, annualPae - BASIC_PERSONAL_AMOUNT_FED);
            const studentFedTax = (fedTaxable * FED_BRACKETS[0].rate * (1 - QC_FEDERAL_ABATEMENT_RATE)) / 12;
            const qcTaxable = Math.max(0, annualPae - BASIC_PERSONAL_AMOUNT_QC);
            const studentQcTax = (qcTaxable * QC_BRACKETS[0].rate) / 12;
            studentTaxAdd += studentFedTax + studentQcTax;

            reeeNewBalance = currentPse + currentPae;
            withdrawalREEEAdd += toWithdraw;
            monthlyIncomeDelta += toWithdraw;
            reeePayoutAdd += toWithdraw;
            contribLiquidAdd += toWithdraw;
        }
    }

    if (childAgeMonths === 25 * 12 && reeeNewBalance > 0) {
        // 1. Restitution du capital souscripteur (PSE) aux liquidités 100 % franc d'impôt
        const refundPse = currentPse;
        liquidDelta += refundPse;
        liquidDeltaReee += refundPse;

        // 2. Remboursement obligatoire des subventions inutilisées aux gouvernements (ARC / RQ)
        const totalGrantsToRefund = Math.min(currentPae, remainingScee + remainingIqee);
        const accumulatedEarnings = Math.max(0, currentPae - totalGrantsToRefund);

        // 3. Traitement des rendements restants (Paiement de revenu accumulé / PRA / AIP)
        const rrspRoom = Math.max(0, ctx.parentRrspRoom ?? 0);
        const rrspRollover = Math.min(accumulatedEarnings, rrspRoom, 50000); // LIR 204.94
        const taxableAip = Math.max(0, accumulatedEarnings - rrspRollover);

        // Surtaxe légale de 20 % de l'ARC sur le PRA non roulé au REER
        const aipPenalty = taxableAip * REEE_AIP_TAX_RATE;
        taxDiversAdd += aipPenalty;

        // Solde net de PRA versé aux liquidités
        const aipNetCash = taxableAip - aipPenalty;
        liquidDelta += aipNetCash;
        liquidDeltaReee += aipNetCash;

        flowEventLogs.push(
            `🎓 Fermeture du REEE de ${child.name || 'l\'enfant'} (25 ans) : ` +
            `+${formatCAD(Math.round(refundPse))} de capital (PSE 100 % franc d'impôt) restitués` +
            (totalGrantsToRefund > 0 ? `, ${formatCAD(Math.round(totalGrantsToRefund))} de subventions inutilisées remboursées à l'État` : '') +
            (taxableAip > 0 ? `, ${formatCAD(Math.round(aipNetCash))} de rendements nets versés (surtaxe AIP 20 % : ${formatCAD(Math.round(aipPenalty))})` : '')
        );

        reeeNewBalance = 0;
        currentPse = 0;
        currentPae = 0;
        remainingScee = 0;
        remainingIqee = 0;
    }

    return {
        liquidDelta,
        liquidDeltaCosts,
        liquidDeltaReee,
        monthlyExpenseDelta,
        monthlyIncomeDelta,
        newIncomeAnna,
        accGrossDelta,
        reeeNewBalance,
        newPseBalance: currentPse,
        newPaeBalance: currentPae,
        remainingSceeGrants: remainingScee,
        remainingIqeeGrants: remainingIqee,
        withdrawalPseAdd,
        withdrawalPaeAdd,
        studentTaxAdd,
        taxDiversAdd,
        newTrackerScee,
        newTrackerIqee,
        newTrackerReeeContribLifetime,
        childId,
        childGrossCostAdd,
        childBenefitsAdd,
        childMonthlyCostAdd,
        reeeContribAdd,
        withdrawalLiquidAdd,
        withdrawalREEEAdd,
        reeePayoutAdd,
        contribREEEAdd,
        contribLiquidAdd,
        lifeEventLogs,
        flowEventLogs,
    };

}
