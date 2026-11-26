import { Tab, AppState, User } from '../../types';
import type { FinanceState } from '../../store/useFinanceStore';
import type { IconName } from '../ui/Icon';

/**
 * Registre CENTRAL des prérequis (source de vérité unique).
 *
 * Consommé par :
 *  - `PageSetupGate` (setup-first) — rend l'écran de setup (saisie + import).
 *  - `MissingDataBanner` / `MissingDataChecklist` — bannières « Configurer → ».
 *
 * Un même prérequis (ex. `salary`) est ainsi déclaré UNE fois et réutilisé par
 * plusieurs pages (Impôts + Retraite + Futur) — voir `requirementIds` dans
 * `PageSetupGate.PAGE_SETUP`.
 */

/** Documents importables (mappés vers un composant d'import dans PageSetupGate). */
export type ImportKind = 'payslip' | 'bankCsv' | 'broker';

export interface RequirementField {
    id: string;
    label: string;
    /** N'entre pas dans `isMet` ; juste proposé à la saisie. */
    optional?: boolean;
    unit?: string;
    placeholder?: string;
    get: (s: FinanceState) => number;
    /** Relit UNIQUEMENT le brouillon `draft` (déjà patché par les champs précédents). */
    toState: (draft: FinanceState, v: number) => Partial<AppState>;
}

export interface Requirement {
    id: string;
    label: string;
    /** [S5-REFONTE-REGLAGES] État manquant en quelques mots (liste de complétude des Réglages : « 0/1 · clé API manquante »). */
    manque: string;
    help?: string;
    icon?: IconName;
    isMet: (s: FinanceState) => boolean;
    /** Saisie manuelle inline (setup-first). */
    fields?: RequirementField[];
    /** Validation bloquante à l'enregistrement (message ou null). */
    validate?: (vals: Record<string, string>) => string | null;
    /** Import du document pertinent (alternative à la saisie). */
    importKind?: ImportKind;
    /** Cible de navigation pour les bannières « Configurer → ». */
    focus?: { tab: Tab; section: string };
}

const patchUser = (users: [User, User], idx: number, patch: Partial<User>): [User, User] =>
    users.map((u, i) => (i === idx ? { ...u, ...patch } : u)) as [User, User];

export type RequirementId =
    | 'salary'
    | 'retirementProfile'
    | 'assets'
    | 'realEstate'
    | 'children'
    | 'transactions'
    | 'debts'
    | 'lifeProjects'
    | 'geminiKey'
    | 'anthropicKey';

export const REQUIREMENTS: Record<RequirementId, Requirement> = {
    salary: {
        id: 'salary',
        label: 'Salaire — utilisateur principal',
        manque: 'salaire manquant',
        help: "Brut MENSUEL (le net est optionnel). Base du calcul d'impôt et des optimisations.",
        icon: 'tax',
        isMet: (s) => (s.config.users[0]?.grossSalary ?? 0) > 0,
        validate: (vals) => {
            const gross = Number(vals.gross) || 0;
            const net = Number(vals.net) || 0;
            if (gross <= 0) return 'Saisis un salaire brut mensuel (> 0).';
            if (net > gross) return 'Le salaire net ne peut pas dépasser le brut.';
            return null;
        },
        fields: [
            {
                id: 'gross', label: 'Salaire brut', unit: '$/mois', placeholder: 'ex. 5 000',
                get: (s) => s.config.users[0]?.grossSalary ?? 0,
                toState: (d, v) => ({ config: { ...d.config, users: patchUser(d.config.users, 0, { grossSalary: v }) } }),
            },
            {
                id: 'net', label: 'Salaire net (optionnel)', optional: true, unit: '$/mois', placeholder: 'ex. 3 500',
                get: (s) => s.config.users[0]?.netSalary ?? 0,
                toState: (d, v) => ({ config: { ...d.config, users: patchUser(d.config.users, 0, { netSalary: v }) } }),
            },
        ],
        importKind: 'payslip',
        focus: { tab: Tab.PROFILE, section: 'profile-user1-grossSalary' }, // [BANDEAUX-VERS-PROFIL]
    },

    retirementProfile: {
        id: 'retirementProfile',
        label: 'Profil retraite',
        manque: 'profil retraite à remplir',
        help: 'Âge de retraite cible et revenu mensuel visé (espérance de vie optionnelle).',
        icon: 'retirement',
        isMet: (s) => (s.retirementGoal?.targetAge ?? 0) > 0 && (s.retirementGoal?.targetMonthlyIncome ?? 0) > 0,
        validate: (vals) => {
            if ((Number(vals.targetAge) || 0) <= 0) return 'Indique un âge de retraite cible (> 0).';
            if ((Number(vals.income) || 0) <= 0) return 'Indique un revenu mensuel visé (> 0).';
            return null;
        },
        fields: [
            {
                id: 'targetAge', label: 'Âge de retraite cible', unit: 'ans', placeholder: 'ex. 60',
                get: (s) => s.retirementGoal?.targetAge ?? 0,
                toState: (d, v) => ({ retirementGoal: { ...d.retirementGoal, targetAge: v } }),
            },
            {
                id: 'lifeExpectancy', label: 'Espérance de vie (optionnel)', optional: true, unit: 'ans', placeholder: 'ex. 90',
                get: (s) => s.retirementGoal?.lifeExpectancy ?? 0,
                toState: (d, v) => ({ retirementGoal: { ...d.retirementGoal, lifeExpectancy: v } }),
            },
            {
                id: 'income', label: 'Revenu mensuel visé', unit: '$/mois', placeholder: 'ex. 4 000',
                get: (s) => s.retirementGoal?.targetMonthlyIncome ?? 0,
                toState: (d, v) => ({ retirementGoal: { ...d.retirementGoal, targetMonthlyIncome: v } }),
            },
        ],
        focus: { tab: Tab.PROFILE, section: 'profile-retirementAge' }, // [BANDEAUX-VERS-PROFIL]
    },

    // Prérequis « liste » (pas de saisie inline) : on crée via la page elle-même
    // (bouton « Créer » → forceShow dans le gate) ou on navigue (focus).
    assets: {
        id: 'assets',
        label: 'Placements / actifs',
        manque: 'aucun placement',
        help: 'Au moins un actif (action, ETF, crypto…) pour projeter la croissance.',
        icon: 'investments',
        isMet: (s) => (s.assets?.length ?? 0) > 0,
        focus: { tab: Tab.INVESTMENTS, section: '' },
    },
    realEstate: {
        id: 'realEstate',
        label: 'Projet immobilier',
        manque: 'aucun projet immobilier',
        help: 'Au moins un projet activé (achat, refinancement, comparaison louer/acheter).',
        icon: 'real-estate',
        // Le state pré-amorce un objectif placeholder (isActive:false, price:0) :
        // on gate sur « configuré », pas sur la simple présence.
        isMet: (s) => (s.realEstateGoals ?? []).some((g) => g.isActive || (g.price ?? 0) > 0),
    },
    children: {
        id: 'children',
        label: 'Planification enfant',
        manque: 'aucun enfant planifié',
        help: 'Au moins un objectif enfant activé (REEE, coûts de garde, etc.).',
        icon: 'child',
        // Idem : l'objectif par défaut a isActive:false → gate sur l'activation.
        isMet: (s) => (s.childGoals ?? []).length > 0, // [S5-REFONTE-ENFANTS] tout enfant planifié compte
    },
    transactions: {
        id: 'transactions',
        label: 'Transactions',
        manque: 'aucune transaction',
        help: 'Au moins une transaction (import de relevé CSV ou ajout manuel).',
        icon: 'transactions',
        isMet: (s) => (s.transactions?.length ?? 0) > 0,
    },
    debts: {
        id: 'debts',
        label: 'Dettes',
        manque: 'aucune dette renseignée',
        help: 'Au moins une dette (prêt, carte, marge…).',
        icon: 'debt',
        isMet: (s) => (s.debts?.length ?? 0) > 0,
    },
    lifeProjects: {
        id: 'lifeProjects',
        label: 'Projets de vie',
        manque: 'aucun projet',
        help: 'Au moins un projet ou voyage planifié.',
        icon: 'life-projects',
        isMet: (s) => (s.travelGoals?.length ?? 0) > 0 || (s.lifeEvents?.length ?? 0) > 0,
    },
    geminiKey: {
        id: 'geminiKey',
        label: 'Clé API Google Gemini (IA)',
        manque: 'clé API manquante',
        help: 'Nécessaire pour les fonctions IA Gemini. Se saisit dans Réglages · Clés API (jamais stockée dans les sauvegardes).',
        icon: 'sparkles',
        isMet: (s) => Boolean(s.apiKeys?.gemini?.trim()),
        focus: { tab: Tab.SETTINGS, section: 'apiKeys-gemini' },
    },
    anthropicKey: {
        id: 'anthropicKey',
        label: 'Clé API Google Gemini (IA)',
        manque: 'clé API manquante',
        help: 'Nécessaire pour les fonctions IA Gemini. Se saisit dans Réglages · Clés API (jamais stockée dans les sauvegardes).',
        icon: 'sparkles',
        isMet: (s) => Boolean(s.apiKeys?.gemini?.trim()),
        focus: { tab: Tab.SETTINGS, section: 'apiKeys-gemini' },
    },
};

export interface PageSetup {
    mode: 'hard' | 'soft';
    title: string;
    intro: string;
    requirementIds: RequirementId[];
    optOut?: { key: string; label: string };
    allowCreateInPage?: boolean;
}

export const PAGE_SETUP: Partial<Record<Tab, PageSetup>> = {
    [Tab.TAX]: {
        mode: 'hard',
        title: 'Impôts & Docs',
        intro: "Pour calculer ton impôt fédéral + Québec, il me faut au moins ton salaire brut.",
        requirementIds: ['salary'],
    },
    [Tab.RETIREMENT]: {
        mode: 'hard',
        title: 'Retraite',
        intro: "Pour projeter ta retraite, il me faut ton salaire et ton profil retraite.",
        requirementIds: ['salary', 'retirementProfile'],
    },
    [Tab.REAL_ESTATE]: {
        mode: 'hard',
        title: 'Immobilier',
        intro: "Cette page suit les biens immobiliers détenus.",
        requirementIds: ['realEstate'],
        optOut: { key: 'realEstate', label: "Je ne suis pas propriétaire et n'ai pas de projet immobilier" },
        allowCreateInPage: true,
    },
    [Tab.REAL_ESTATE_PROJECTS]: {
        mode: 'hard',
        title: 'Projets immo',
        intro: "Cette page planifie un projet immobilier futur.",
        requirementIds: ['realEstate'],
        optOut: { key: 'realEstate', label: "Je n'ai pas de projet immobilier" },
        allowCreateInPage: true,
    },
    [Tab.CHILD]: {
        mode: 'hard',
        title: 'Enfant',
        intro: "Cette page planifie les coûts d'un enfant.",
        requirementIds: ['children'],
        optOut: { key: 'children', label: 'Je ne suis pas concerné' },
        allowCreateInPage: true,
    },
    [Tab.FUTURE]: {
        mode: 'hard',
        title: 'Projection Future',
        intro: "Pour une projection fiable, il me faut ton salaire, tes placements et ton profil retraite.",
        requirementIds: ['salary', 'assets', 'retirementProfile'],
    },
    [Tab.TRANSACTIONS]: {
        mode: 'hard',
        title: 'Transactions',
        intro: 'Importe un relevé bancaire (CSV) ou ajoute une transaction pour démarrer.',
        requirementIds: ['transactions'],
        allowCreateInPage: true,
    },
    [Tab.BUDGET]: {
        mode: 'hard',
        title: 'Budget',
        intro: 'Pour bâtir ton budget, il me faut ton salaire.',
        requirementIds: ['salary'],
    },
    [Tab.INVESTMENTS]: {
        mode: 'hard',
        title: 'Placements',
        intro: 'Ajoute au moins un placement pour suivre et projeter ton portefeuille.',
        requirementIds: ['assets'],
        allowCreateInPage: true,
    },
    [Tab.DEBT]: {
        mode: 'hard',
        title: 'Dettes',
        intro: "Ajoute tes dettes pour planifier leur remboursement.",
        requirementIds: ['debts'],
        optOut: { key: 'debts', label: "Je n'ai pas de dettes" },
        allowCreateInPage: true,
    },
    [Tab.LIFE_PROJECTS]: {
        mode: 'hard',
        title: 'Projets de vie',
        intro: 'Planifie un projet ou un voyage.',
        requirementIds: ['lifeProjects'],
        optOut: { key: 'lifeProjects', label: "Aucun projet pour l'instant" },
        allowCreateInPage: true,
    },
};
