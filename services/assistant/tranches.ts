// services/assistant/tranches.ts
//
// Table des TRANCHES du store pilotables par l'assistant. Chaque tranche persistée du store
// (`useFinanceStore`, clés de `AppState`) est soit DÉCLARÉE ici (→ actions génériques de lecture ET
// d'écriture générées par `actionRegistry.ts`), soit EXCLUE avec sa raison (`TRANCHES_EXCLUES`).
// La garde `tests/assistant/couvertureStore.test.ts` rougit sur toute clé persistée qui n'est ni
// l'un ni l'autre : une donnée ajoutée au store devra être pilotable par l'assistant (marche à
// suivre : docs/ASSISTANT.md).
//
// Validation : les champs CONNUS de chaque élément sont typés (Zod) ; les autres champs passent par
// `jsonSur` (JSON fini, borné, sans clé prototype). La forme finale de l'état est revérifiée avant
// toute écriture (`validateAppStateShape` + `verifierTypesRestaures`, cf. actionRegistry).

import { z } from 'zod';
import type { AppState } from '../../types';

/** Valeur JSON sûre : nombres FINIS seulement (no-fake-data), chaînes et tableaux bornés. */
const CLES_INTERDITES = new Set(['__proto__', 'constructor', 'prototype']);
export const jsonSur: z.ZodType<unknown> = z.lazy(() =>
    z.union([
        z.string().max(4000),
        z.number().finite(),
        z.boolean(),
        z.null(),
        z.array(jsonSur).max(1000),
        z.record(z.string().max(80).refine((k) => !CLES_INTERDITES.has(k), 'clé interdite'), jsonSur),
    ]),
);

const texte = (max = 200) => z.string().max(max);
const nombre = () => z.number().finite();
const date = () => z.string().regex(/^\d{4}-\d{2}(-\d{2})?/, 'date AAAA-MM-JJ attendue');
const compte = z.enum(['CELI', 'CELIAPP', 'REER', 'NON-ENREG', 'CRYPTO', 'REEE', 'MARGE', 'AUTRE']);

/** Champs connus (tous facultatifs à la saisie — l'élément complet est revérifié après fusion). */
type Champs = Record<string, z.ZodTypeAny>;

export interface TrancheCollection {
    genre: 'collection';
    cle: keyof AppState;
    pluriel: string;
    singulier: string;
    description: string;
    /** Clé d'identité des éléments (`id`) ; absente → identification par index (`lister_*`). */
    identifiant?: 'id';
    /** Type de l'identifiant généré à l'ajout. */
    typeId?: 'string' | 'number';
    champs: Champs;
    /** Champs exigés à l'AJOUT (l'élément complet). */
    requis: string[];
}

export interface TrancheListeTexte {
    genre: 'liste_texte';
    cle: keyof AppState;
    pluriel: string;
    singulier: string;
    description: string;
}

export interface TrancheObjet {
    genre: 'objet';
    cle: keyof AppState;
    nom: string;
    description: string;
    champs: Champs;
    /** Objet facultatif du store (peut être retiré). */
    supprimable?: boolean;
}

export type Tranche = TrancheCollection | TrancheListeTexte | TrancheObjet;

export const TRANCHES: Tranche[] = [
    {
        genre: 'collection', cle: 'transactions', pluriel: 'transactions', singulier: 'transaction',
        description: 'Transactions bancaires (montant négatif = dépense, positif = revenu).',
        identifiant: 'id', typeId: 'number',
        champs: {
            date: date(), payee: texte(), amount: nombre(), category: texte(80),
            status: z.enum(['pending', 'processed', 'manual', 'error']), accountName: texte(120),
            isTransfer: z.boolean(), ownerId: z.union([z.literal(0), z.literal(1)]),
        },
        requis: ['date', 'payee', 'amount', 'category'],
    },
    {
        genre: 'collection', cle: 'assets', pluriel: 'placements', singulier: 'placement',
        description: 'Placements du portefeuille (titres, FNB, crypto) avec quantité et prix.',
        champs: {
            symbol: texte(30), name: texte(), quantity: nombre(), currentPrice: nombre(),
            currency: z.enum(['USD', 'CAD', 'EUR']), performance: nombre(), dateBought: date(),
            buyPrice: nombre(), accountType: compte, sector: texte(80), region: texte(80),
        },
        requis: ['symbol', 'name', 'quantity', 'currentPrice', 'currency'],
    },
    {
        genre: 'collection', cle: 'investmentTransactions', pluriel: 'operations_placement', singulier: 'operation_placement',
        description: 'Opérations de placement (achat, vente, dépôt, retrait).',
        identifiant: 'id', typeId: 'string',
        champs: {
            date: date(), type: z.enum(['BUY', 'SELL', 'DEPOSIT', 'WITHDRAW']), symbol: texte(30), name: texte(),
            quantity: nombre(), price: nombre(), amount: nombre(), currency: z.enum(['USD', 'CAD', 'EUR']),
            accountId: texte(80), fees: nombre(),
        },
        requis: ['date', 'type', 'amount', 'currency', 'accountId'],
    },
    {
        genre: 'collection', cle: 'investmentAccounts', pluriel: 'comptes_placement', singulier: 'compte_placement',
        description: 'Comptes de placement (CELI, REER, non enregistré…).',
        identifiant: 'id', typeId: 'string',
        champs: { userId: z.number().int(), name: texte(), type: compte },
        requis: ['userId', 'name', 'type'],
    },
    {
        genre: 'collection', cle: 'budgetItems', pluriel: 'postes_budget', singulier: 'poste_budget',
        description: 'Postes du budget (cible et fréquence).',
        identifiant: 'id', typeId: 'string',
        champs: {
            name: texte(120), target: nombre(), frequency: z.enum(['Monthly', 'Yearly', 'Weekly', 'Quarterly']),
            type: z.enum(['Commun', 'Perso 1', 'Perso 2']), nature: z.enum(['Besoin', 'Envie', 'Epargne']),
        },
        requis: ['name', 'target', 'frequency', 'type', 'nature'],
    },
    {
        genre: 'collection', cle: 'realEstateGoals', pluriel: 'biens_immobiliers', singulier: 'bien_immobilier',
        description: 'Biens immobiliers possédés et projets d\'achat.',
        identifiant: 'id', typeId: 'string',
        champs: {
            name: texte(), isActive: z.boolean(), isOwned: z.boolean(), purchaseDate: date(), price: nombre(),
            downPayment: nombre(), mortgageRate: nombre(), amortization: nombre(), totalClosingCosts: nombre(),
            monthlyPayment: nombre(), unrecoverableMonthly: nombre(), isPrimaryResidence: z.boolean(),
            currentValue: nombre(), mortgageBalance: nombre(),
        },
        requis: ['isActive', 'purchaseDate', 'price', 'downPayment', 'mortgageRate', 'amortization', 'isPrimaryResidence'],
    },
    {
        genre: 'collection', cle: 'childGoals', pluriel: 'projets_enfant', singulier: 'projet_enfant',
        description: 'Projets d\'enfant (coûts mensuels, prestations, REEE).',
        identifiant: 'id', typeId: 'string',
        champs: {
            name: texte(), isActive: z.boolean(), birthDate: date(), initialCost: nombre(), monthlyDiapers: nombre(),
            monthlyFood: nombre(), monthlyClothing: nombre(), monthlyDaycare: nombre(), governmentBenefits: nombre(),
            parentalLeaveIncomeDrop: nombre(), respContribution: nombre(),
        },
        requis: ['name', 'isActive', 'birthDate'],
    },
    {
        genre: 'collection', cle: 'subscriptions', pluriel: 'abonnements', singulier: 'abonnement',
        description: 'Abonnements et charges fixes épinglés.',
        champs: {
            payee: texte(), averageAmount: nombre(), dayOfMonth: z.number().int().min(1).max(31),
            category: texte(80), lastDate: date(), yearlyCost: nombre(),
        },
        requis: ['payee', 'averageAmount', 'dayOfMonth', 'category', 'lastDate', 'yearlyCost'],
    },
    {
        genre: 'liste_texte', cle: 'dismissedSubscriptions', pluriel: 'abonnements_ecartes', singulier: 'abonnement_ecarte',
        description: 'Marchands écartés de la détection d\'abonnements (« pas un abonnement »).',
    },
    {
        genre: 'collection', cle: 'debts', pluriel: 'dettes', singulier: 'dette',
        description: 'Dettes (cartes, auto, études, prêts, marge).',
        identifiant: 'id', typeId: 'string',
        champs: {
            name: texte(120), balance: nombre(), interestRate: nombre(), minimumPayment: nombre(),
            category: z.enum(['CreditCard', 'Car', 'Student', 'Personal', 'Other']), limit: nombre(),
            startDate: date(), balanceAsOf: date(), isVariableRate: z.boolean(),
        },
        requis: ['name', 'balance', 'interestRate', 'minimumPayment', 'category'],
    },
    {
        genre: 'collection', cle: 'travelGoals', pluriel: 'voyages', singulier: 'voyage',
        description: 'Projets de voyage.',
        identifiant: 'id', typeId: 'string',
        champs: { destination: texte(), date: date(), totalCost: nombre(), notes: texte(1000) },
        requis: ['destination', 'date', 'totalCost'],
    },
    {
        genre: 'collection', cle: 'lifeEvents', pluriel: 'evenements_vie', singulier: 'evenement_vie',
        description: 'Événements de vie (impact ponctuel ou durable sur les revenus/dépenses).',
        identifiant: 'id', typeId: 'string',
        champs: {
            type: z.enum(['KRACH', 'ACCIDENT', 'GROS_ACHAT', 'HERITAGE', 'PERTE_EMPLOI', 'MARIAGE', 'RENOVATION', 'AUTO', 'SABBATIQUE', 'BUSINESS']), name: texte(), date: date(), impactAmount: nombre(), impactPercent: nombre(),
            durationMonths: nombre(), incomeLossPercent: nombre(),
        },
        requis: ['type', 'name', 'date'],
    },
    {
        genre: 'collection', cle: 'financialGoals', pluriel: 'objectifs_financiers', singulier: 'objectif_financier',
        description: 'Objectifs financiers (montant cible, échéance).',
        identifiant: 'id', typeId: 'string',
        champs: {
            name: texte(), type: z.enum(['NET_WORTH', 'CELI', 'REER', 'LIQUIDITY', 'CUSTOM', 'EXPENSE_OPTIMIZATION', 'REBALANCING']), targetAmount: nombre(), deadline: date(), manualCurrentAmount: nombre(),
            completed: z.boolean(), status: z.enum(['active', 'suggestion', 'archived']),
        },
        requis: ['name', 'type', 'targetAmount', 'deadline'],
    },
    {
        genre: 'collection', cle: 'categorizationRules', pluriel: 'regles_categorisation', singulier: 'regle_categorisation',
        description: 'Règles de catégorisation automatique des transactions (motif → catégorie).',
        identifiant: 'id', typeId: 'string',
        champs: { pattern: texte(200), category: texte(80), createdAt: texte(40) },
        requis: ['pattern', 'category'],
    },
    {
        genre: 'collection', cle: 'insurancePolicies', pluriel: 'assurances', singulier: 'assurance',
        description: 'Polices d\'assurance (vie, invalidité…).',
        identifiant: 'id', typeId: 'string',
        champs: { kind: z.enum(['life-term', 'life-whole', 'life-universal', 'disability-st', 'disability-lt', 'critical-illness', 'long-term-care', 'travel', 'auto', 'home', 'liability']), insurer: texte(), faceAmount: nombre(), monthlyPremium: nombre(), expiryDate: date() },
        requis: ['kind', 'monthlyPremium'],
    },
    {
        genre: 'collection', cle: 'rentalProperties', pluriel: 'immeubles_locatifs', singulier: 'immeuble_locatif',
        description: 'Immeubles locatifs.',
        identifiant: 'id', typeId: 'string',
        champs: {
            name: texte(), purchasePrice: nombre(), currentValue: nombre(), mortgageBalance: nombre(), mortgageRate: nombre(),
            monthlyRent: nombre(), vacancyPct: nombre(), monthlyExpenses: nombre(),
        },
        requis: ['name', 'purchasePrice', 'currentValue', 'mortgageBalance', 'mortgageRate', 'monthlyRent', 'vacancyPct', 'monthlyExpenses'],
    },
    {
        genre: 'collection', cle: 'privateBusinesses', pluriel: 'entreprises_privees', singulier: 'entreprise_privee',
        description: 'Entreprises privées détenues.',
        identifiant: 'id', typeId: 'string',
        champs: { name: texte(), ownershipPct: nombre(), estimatedValue: nombre(), annualDividend: nombre() },
        requis: ['name', 'ownershipPct', 'estimatedValue'],
    },
    {
        genre: 'collection', cle: 'vehicleReplacements', pluriel: 'remplacements_vehicule', singulier: 'remplacement_vehicule',
        description: 'Cycles de remplacement de véhicule.',
        identifiant: 'id', typeId: 'string',
        champs: { cyclYears: nombre(), costEstimate: nombre(), isElectric: z.boolean() },
        requis: ['cyclYears', 'costEstimate'],
    },
    {
        genre: 'collection', cle: 'majorRenovations', pluriel: 'renovations_majeures', singulier: 'renovation_majeure',
        description: 'Rénovations majeures planifiées.',
        identifiant: 'id', typeId: 'string',
        champs: {},
        requis: [],
    },
    {
        genre: 'collection', cle: 'charitableGoals', pluriel: 'dons_planifies', singulier: 'don_planifie',
        description: 'Dons de bienfaisance planifiés.',
        identifiant: 'id', typeId: 'string',
        champs: { annualAmount: nombre(), startYear: z.number().int(), endYear: z.number().int() },
        requis: ['annualAmount'],
    },
    {
        genre: 'objet', cle: 'config', nom: 'configuration_menage',
        description: 'Configuration du ménage : `users` (2 personnes : name, age, grossSalary et netSalary MENSUELS…), splitMode. Pour modifier la 2e personne seulement : users: [{}, {…}].',
        champs: { splitMode: z.enum(['50/50', 'prorata', 'custom']), customSplit: nombre() },
    },
    {
        genre: 'objet', cle: 'projection', nom: 'parametres_projection',
        description: 'Paramètres de la projection (années, rendements, inflation, mode d\'épargne, scénarios).',
        champs: {
            years: z.number().int().min(1).max(80), returnRate: nombre(), inflationRate: nombre(),
            savingsMode: z.enum(['manual', 'budget', 'real']), manualContribution: nombre(), usePortfolioRate: z.boolean(),
        },
    },
    {
        genre: 'objet', cle: 'retirementGoal', nom: 'objectif_retraite',
        description: 'Objectif de retraite (âge cible, revenu mensuel visé, rentes).',
        champs: { targetAge: z.number().int().min(40).max(80), targetMonthlyIncome: nombre(), governmentPension: nombre(), lifeExpectancy: z.number().int().min(60).max(110) },
    },
    {
        genre: 'objet', cle: 'childGoal', nom: 'projet_enfant_principal', supprimable: true,
        description: 'Ancien projet d\'enfant unique (hérité ; préférer `projets_enfant`).',
        champs: {},
    },
    {
        genre: 'objet', cle: 'healthWeights', nom: 'ponderations_sante',
        description: 'Pondérations de l\'indicateur de santé financière.',
        champs: {
            savingsRate: nombre(), emergencyFund: nombre(), debtRatio: nombre(), fireProgress: nombre(),
            budgetParity: nombre(), subscriptionLoad: nombre(),
        },
    },
    {
        genre: 'objet', cle: 'initialBalances', nom: 'soldes_initiaux',
        description: 'Soldes de départ des comptes bancaires (clé = nom du compte, valeur = solde en CAD).',
        champs: {},
    },
    {
        genre: 'objet', cle: 'setupOptOut', nom: 'pages_non_concernees',
        description: 'Pages marquées « pas concerné » (clé = identifiant de page, valeur = booléen).',
        champs: {},
    },
    {
        genre: 'objet', cle: 'weddingGoal', nom: 'projet_mariage', supprimable: true,
        description: 'Projet de mariage (date, budget).',
        champs: { isActive: z.boolean(), date: date(), budget: nombre(), contributionFromParents: nombre() },
    },
];

/**
 * Clés persistées VOLONTAIREMENT non pilotées par les actions génériques, avec leur raison.
 * Toute entrée ici doit dire POURQUOI — la garde de couverture lit cette liste.
 */
export const TRANCHES_EXCLUES: Record<string, string> = {
    // Secrets : jamais lus ni écrits par l'assistant (IndexedDB chiffré, hors snapshot).
    apiKeys: 'secrets (clés API) — jamais exposés à l\'assistant',
    // Technique : horodatage posé automatiquement à chaque écriture.
    lastUpdate: 'horodatage technique, posé à chaque écriture',
    // Taux de change : provenance pilotée par services/fx (une écriture brute ferait mentir la source).
    fxRates: 'taux de change pilotés par services/fx avec leur provenance (lecture : consulter_taux_change)',
    fxRatesEstimated: 'provenance FX (services/fx)',
    fxRatesSource: 'provenance FX (services/fx)',
    fxLastAttemptAt: 'provenance FX (services/fx)',
    fxLastAttemptCause: 'provenance FX (services/fx)',
    fxObservationDate: 'provenance FX (services/fx)',
    // Historique de l'ancien chat (remplacé par les conversations de l'assistant, hors store).
    aiConversation: 'historique de l\'ancien chat',
    aiConversations: 'historique de l\'ancien chat',
    activeAiConversationId: 'historique de l\'ancien chat',
    aiChatCostUsdTotal: 'compteur de coût IA, écrit par le seul point de contact SDK',
    aiChatCostUsdByDay: 'répartition journalière du coût IA (YYYY-MM-DD, America/Toronto)',
    aiChatModel: 'réglage du modèle, piloté par le sélecteur du panneau de l\'assistant',
    // Documents : métadonnées de fichiers stockés à part (un ajout sans octets créerait une pièce fantôme).
    documents: 'métadonnées de pièces jointes dont les octets vivent ailleurs',
    // État de revue d'échantillon (graine persistée pour l'écran de revue).
    categoryReview: 'état d\'écran de la revue de catégorisation',
    // Fintable : écrits par la synchronisation serveur (services/fintable, hors périmètre).
    fintableSyncReport: 'rapport écrit par la synchronisation Fintable',
    fintableBrokerBalances: 'soldes écrits par la synchronisation Fintable',
    fintableBrokerHistory: 'historique écrit par la synchronisation Fintable',
    fintableRoles: 'rôles de comptes Fintable (Réglages, conséquences sur la sync serveur)',
    // Grand livre courtier : sémantique tri-état, importé par relevé (apply_broker_statement).
    brokerLedger: 'grand livre importé par relevé (tri-état undefined/[]), via apply_broker_statement',
    instruments: 'référentiel du grand livre (tri-état)',
    brokerAccountRegimes: 'régimes du grand livre (tri-état)',
    // États de projection et d'interface.
    projectionRunMC: 'bascule d\'interface (Monte Carlo), pilotée par lancer_projection',
    isProjectionLocked: 'verrou d\'interface de la projection',
    revealedProjectionSig: 'état d\'interface de la projection',
    // Valoria : préférences pilotées directement dans l'onglet Valoria.
    valoriaWatchlist: 'liste de suivi Valoria pilotée directement dans l onglet Valoria',
    valoriaRiskProfile: 'profil de risque Valoria piloté directement dans l onglet Valoria',
};
