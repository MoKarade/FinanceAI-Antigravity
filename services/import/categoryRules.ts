// services/import/categoryRules.ts
//
// [TX-CATEGORY-RULES] — catégorisation DÉTERMINISTE des transactions par règles sur le payee.
// Demande utilisateur (« les catégories des transactions sont très mal réglées ») : les
// règles couvrent ~88 % d'un corpus réel (mesuré sur environ 2 000 transactions de relevés
// bancaires) — gratuites, instantanées,
// reproductibles. L'IA (categorizeBatch, clé Google Gemini) ne sert QU'EN SECOURS sur le reste.
//
// PRIORITÉ : premières règles gagnent (spécifique avant générique — ex. « Virement envoyé à
// /Loyer » doit tomber en Logement AVANT la règle Interac générique). Matching sur payee
// NORMALISÉ (accents strippés, MAJUSCULES) → les regex sont écrites SANS accents.
// Pur, zéro dépendance — utilisable par l'app (import CSV, bouton Classer) ET le MCP.

/** Jeu de catégories canonique produit par les règles (le Budget s'aligne dessus — Lot C). */
export const RULE_CATEGORIES = [
    'Salaire',
    'Revenus divers',
    // [TX-INTERAC-REMBOURSEMENT] (décision Marc 2026-09-05, réponse 1a) Un Interac REÇU est un
    // CRÉDIT sur une dépense partagée, jamais un revenu : la catégorie existait (`CREDIT_BACK_CATEGORIES`
    // de `utils/spendRules.ts`, décision du 2026-07-31) mais AUCUNE règle ne l'écrivait — le
    // mécanisme était vert en test et inerte en prod. Canonique ici pour que l'IA, le MCP et le
    // menu de classement la proposent tous par la même source.
    'Remboursement',
    'Logement',
    'Transfert',
    'Assurances',
    'Frais bancaires',
    'Épicerie',
    'Restaurants',
    'Transport',
    'Abonnements',
    'Santé',
    'Loisirs',
    'Magasinage',
    'Voyages',
    'Impôts',
    'Autre',
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

// ─── [MCP-CATEGORY-ALLOWLIST] Allowlist canonique de catégories (partagée) ───
// Une catégorie CANDIDATE issue d'un texte LIBRE écrit par l'IA (tool MCP apply_bank_statement,
// categorizeBatch) ne doit JAMAIS entrer verbatim dans les données : hors du jeu canonique, le
// rapprochement fuzzy partagé (réel/moyenne/grand livre) peut l'absorber sous un poste au nom
// englobant (« Sport » ⊂ « Tran-sport ») sans trace (finding silent-failure-hunter PR #501/#502).
// Helpers PURS consommés par mcp/ingest/applyDocument.ts ET services/gemini.ts (une seule source,
// pas deux copies qui dérivent — leçon AITOOLS-SEC).

/** Clé de comparaison insensible casse/accents (« epicerie » ≡ « Épicerie »). */
export const categoryKey = (s: string): string =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * Map clé normalisée → forme CANONIQUE. En cas de collision de clé, le DERNIER nom fourni gagne
 * (l'appelant place ses noms prioritaires en fin de liste — ex. applyDocument met les postes de
 * budget APRÈS RULE_CATEGORIES : le poste, cible réelle de réconciliation, impose sa casse).
 */
export function buildCategoryCanonicalMap(names: readonly string[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const raw of names) {
        const name = raw?.trim();
        if (name) m.set(categoryKey(name), name);
    }
    return m;
}

/**
 * Résout une catégorie candidate vers l'allowlist : canonique → forme canonique ; hors liste ou
 * absente → règles déterministes sur le payee, sinon `fallback`. `remapped` n'est vrai que pour
 * une candidate FOURNIE et hors liste (une absence n'est pas un remap — l'appelant COMPTE les
 * remaps et les signale, jamais une re-catégorisation silencieuse).
 */
export function resolveCandidateCategory(
    candidate: string | undefined | null,
    allowed: ReadonlyMap<string, string>,
    payee: string,
    fallback: string,
): { category: string; remapped: boolean } {
    const canonical = candidate ? allowed.get(categoryKey(candidate)) : undefined;
    if (canonical) return { category: canonical, remapped: false };
    return { category: ruleCategorize(payee) ?? fallback, remapped: !!candidate };
}

const normalizePayee = (s: string): string =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();

/** Vérifie si un libellé de catégorie correspond à un statut non classé (« à vérifier / inconnue »). */
export function isUncategorizedCategory(category: string | undefined | null): boolean {
    const key = categoryKey(category ?? '');
    return key === '' || key === 'uncategorized' || key === 'non categorise' || key === 'autre' || key === 'inconnu' || key === 'unknown';
}

// Marchands polyvalents / agrégateurs où un achat peut relever de plusieurs catégories
// (éviter qu'une correction ponctuelle sur une ligne écrase tout le marchand sans nuance).
const MIXED_MERCHANT_RX = /AMAZON|\bAMZN\b|COSTCO WHOLESALE|WAL-?MART|\bPAYPAL\b|(?:^|\s)SQ \*|\bSQUARE\b|APPLE\.COM|ITUNES|GOOGLE \*|GOOGLE PLAY|MICROSOFT|\bXBOX\b|\bSTEAM\b|PLAYSTATION|NINTENDO/;

/** Vrai si le marchand est une enseigne mixte ou une plateforme multi-usages. */
export function isMixedMerchantPayee(payee: string): boolean {
    if (!payee) return false;
    return MIXED_MERCHANT_RX.test(normalizePayee(payee));
}

// (regex sur payee normalisé) → catégorie. Ordre = priorité.
const RULES: ReadonlyArray<readonly [RegExp, RuleCategory]> = [
    // — Revenus —
    [/\b(PAIE|PAYROLL|SALAIRE)\b|SERVICE DE PAIE/, 'Salaire'],
    // « INTERET SUR/INTEREST ON » (formes réelles des relevés : « Intérêt sur ET », « Interest
    // on TS ») — jamais le mot NU : « FRAIS DE PROVISION INTERET » est une CHARGE, pas un revenu
    // (finding panel ; les intérêts facturés carte = « FRAIS DE CRÉDIT » → Frais bancaires).
    [/RISTOURNE|INTERET SUR|INTEREST ON|CREDIT REMISES|DEPOT DIRECT|TRANSFERT DE FONDS RECU|ALLOCATION FAMILLE|ALLOCATION CANADIENNE|CANADA CHILD|RETRAITE QUEBEC|CREDIT TPS|CREDIT SOLIDARITE|DIVIDENDE/, 'Revenus divers'],
    // [TX-INTERAC-REMBOURSEMENT] Interac REÇU → « Remboursement » (crédit qui vient en déduction du
    // poste, `isCreditBack`), plus « Revenus divers » : classé revenu, un remboursement de dépense
    // partagée gonflait le revenu affiché ET laissait la dépense comptée en entier (double
    // comptage dans les deux sens — plusieurs centaines de $/mois mesurés sur le corpus réel, A_FAIRE_MOI). Les
    // autres motifs de la ligne du dessus (ristourne, intérêts, dépôt direct) restent du revenu.
    // « E-TRANSFER FROM » (graphie anglaise de l'Interac reçu, déjà reconnue par `isInteracPayee` et
    // par `isInternalTransferLabel`) rendait `null` faute de motif : même règle, même destination.
    [/VIREMENT INTERAC DE\b|E-TRANSFER.*(RECU|RECEIVED|FROM)/, 'Remboursement'],
    // — Logement (AVANT les virements génériques : « Virement envoyé à … /Loyer ») —
    [/LOYER|HYDRO-?QUEBEC|ENERGIR|\bBAIL\b/, 'Logement'],
    // — Transferts internes / placements (mouvements, pas des dépenses) —
    [/DESJARDINS (REMISES|CASH ?BACK) ?MASTERCAR?D?|PAIEMENT CAISSE|AVANCE D.ARGENT/, 'Transfert'],
    [/PAIEMENT (CARTE|VISA|MASTERCARD|AMEX)|PAYMENT THANK YOU|MERCI DE VOTRE PAIEMENT|\bBNCD\b|TANGERINE|EQ BANK|VIREMENT INTERNE|TRANSFERT ENTRE COMPTES|COTISATION (CELI|REER|CELIAPP|REEE)/, 'Transfert'],
    [/VIREMENT - ACCESD|VIREMENT DISNAT|WEALTHSIMPLE|QUESTRADE|PLACEMENT \/|RETRAIT EPARGNE|VIREMENT EPARGNE|\/ CONJOINT/, 'Transfert'],
    // — Assurances / frais / impôts —
    // SAAQ AVANT le mot générique ASSURANCE : « SAAQ — Société de l'ASSURANCE automobile… »
    // est de l'immatriculation/permis (Transport), pas une prime (finding panel, ordre prouvé).
    [/\bSAAQ\b/, 'Transport'],
    [/ASSURANCE|DESJARDINS ASS|INTACT|BENEVA|\bSSQ\b|LA PERSONNELLE|BELAIRDIRECT|TD ASSURANCE|AVIVA|MANUVIE|MANULIFE|SUN LIFE|INDUSTRIELLE ALLIANCE|IA GROUPE|PROMUTUEL|WAWANESA|CROIX BLEUE|BLUE CROSS|CANADA VIE|CANADA LIFE/, 'Assurances'],
    [/FRAIS FIXES|FRAIS DE CREDIT|FIXED SERVICE|FRAIS D.UTILISATION|FRAIS AU GA|FRAIS GUICHET|FRAIS INTERAC|FRAIS MENSUELS|FRAIS DE COMPTE|FRAIS ANNUELS|FRAIS DE DECOUVERT|\bNSF\b|OVERDRAFT|MONTHLY FEE|ANNUAL FEE/, 'Frais bancaires'],
    [/PAYEMENT IMPOT|IMPOT (FEDERAL|QUEBEC)|REVENU QUEBEC|AGENCE DU REVENU|\bARC\b|\bCRA\b|MINISTRE DU REVENU|RECEVEUR GENERAL|RECEIVER GENERAL|\bRQAP\b|\bRRQ\b/, 'Impôts'],
    // — Interac sortant vers une PERSONNE : AVANT les règles MARCHANDES (finding panel : un
    // destinataire nommé Bell/Wendy/Brunet/Simons/Normandin matcherait sinon une enseigne →
    // « Abonnements »/« Restaurants »… en silence). Les cas spécifiques /Loyer et /Conjoint
    // sont interceptés PLUS HAUT (Logement, Transfert) — ici le générique.
    [/VIREMENT INTERAC A\b|VIREMENT ENVOYE A/, 'Autre'],
    // — Logement (hypothèque, copropriété et taxes municipales après Interac sortant) —
    [/HYPOTHEQUE|MORTGAGE|FIRST NATIONAL|\bMCAP\b|SYNDICAT DE COPROPRIETE|TAXES? (MUNICIPALE|SCOLAIRE)|VILLE DE (MONTREAL|QUEBEC|LAVAL|LONGUEUIL|GATINEAU|SHERBROOKE|LEVIS|TERREBONNE|BROSSARD|TROIS-RIVIERES)/, 'Logement'],
    // — Stations d'essence Costco / Canadian Tire AVANT la règle Costco Épicerie / CT Magasinage —
    [/COSTCO (GAS|ESSENCE)|CANADIAN TIRE GAS/, 'Transport'],
    // — Épicerie —
    [/\bIGA\b|\bMAXI\b|\bMETRO\b|PROVIGO|SUPER C|COSTCO WHOLESALE|WAL-?MART|FRUITERIE|PROVISION STE|\bPROVISIONS\b|MARCHE |EPICERIE|\bSAQ\b|SAQ\d|DEPANNEUR|ACCOMMODATION|ADONIS|AVRIL SUPERMARCHE|\bAVRIL\b|RACHELLE.?BERY|INTERMARCHE|KIM PHAT|MARCHE PA\b|SUPERMARCHE|LOBLAWS|NO FRILLS|FARM BOY|BULK BARN|M&M FOOD|ALIMENTS M&M|BOUCHERIE|BOULANGERIE|PATISSERIE|\bLUFA\b|GOODFOOD|HELLOFRESH|COOK IT/, 'Épicerie'],
    // — Restaurants —
    [/TIM HORTONS|MCDONALD|UBEREATS|DOORDASH|SKIPTHEDISHES|BRASSERI|MICROBRASSERI|RESTO|SUSHI|SUBWAY|\bA&W\b|PIZZ|POUTINE|ST-HUBERT|BURGER|WENDY|\bKFC\b|\bPFK\b|DOMINO|VALENTINE|NORMANDIN|ASHTON|TACO|SHAWARMA|\bCAFE\b|\bBAR\b|BISTRO|\bPUB\b|TAVERNE|\bGRILL\b|CANTINE|CREMERIE|FROMAGERIE|STARBUCKS|SECOND CUP|THAI EXPRESS|\bAMIR\b|BOUSTAN|SCORES|LA CAGE|CORA DEJEUNER|\bBENNY\b|BELLE PROVINCE|HARVEY.?S|DAIRY QUEEN|KRISPY KREME|\bPOKE\b|RAMEN|CHIPOTLE|FIVE GUYS|COFFEE|ESPRESSO|VAN HOUTTE|PRESSE CAFE|CHOCOLATS FAVORIS|QUESADA/, 'Restaurants'],
    // — Transport —
    [/SONIC|PETRO-?CAN|\bESSO\b|SHELL|ULTRAMAR|COSTCO ESSENCE|COUCHE.?TARD|UBERTRIP|COMMUNAUTO|\bSTM\b|\bRTC\b|STATIONNEMENT|PARC INDIGO|PETROLES|AIR-SERV|\bCAA\b|GARAGE|PNEUS|IRVING|CIRCLE K|\bBIXI\b|\bEXO\b|\bSTL\b|\bRTL\b|\bOPUS\b|\bLYFT\b|P\$ SERVICE MOBILE|PAIEMENT MOBILE MTL|\bPEAGE\b|\bTOLL\b|LAVE-AUTO|CAR WASH|MECANIQUE|PARKING|CIRCUIT ELECTRIQUE|TESLA SUPERCHARGER/, 'Transport'],
    // — Abonnements (télécom + numériques) —
    // ⚠️ [TX-CATEGORIZE] Ne restent ici que les marchands dont un achat UNIQUE n'existe
    // pratiquement pas (un forfait Vidéotron, un abonnement Netflix). Les plateformes où l'on
    // achète aussi bien un jeu qu'un abonnement (Google Play, App Store, Microsoft, YouTube,
    // Twitch, Patreon) ont été DÉPLACÉES dans `AMBIGUOUS_SUBSCRIPTION_RULES` : décider
    // « Abonnements » sur leur seul libellé rangeait un accessoire Apple et un jeu Xbox parmi les
    // abonnements (bug Marc 2026-07-31, « ça met abonnement pour tout et n'importe quoi »).
    [/NETFLIX|CRUNCHYROLL|SPOTIFY|DISNEY|CAPCUT|BOOSTEROID|VIRGIN PLUS|VIDEOTRON|\bBELL\b|\bTELUS\b|\bFIZZ\b|ROGERS|\bFIDO\b|KOODO|PUBLIC MOBILE|CHATR|\bEBOX\b|\bOXIO\b|STARLINK|COGECO|HELIX|CRAVE|TOU\.TV|PARAMOUNT|AUDIBLE|CLAUDE\.AI|ANTHROPIC|OPENAI|CHATGPT|CURSOR|WINDSURF|NOTION|DROPBOX|1PASSWORD|NORDVPN|EXPRESSVPN|AMAZON PRIME|ADOBE|\bICLOUD\b|BUZZFIT|NAUTILUS PLUS|ENERGIE CARDIO/, 'Abonnements'],
    // — Santé —
    [/BRUNET|PHARMAPRIX|JEAN COUTU|UNIPRIX|FAMILIPRIX|PROXIM|PHARMACIE|PHARMACY|\bRAMQ\b|ECONOFITNESS|\bGYM\b|CLINIQUE|DENTAIRE|OPTOMETR|PHYSIO|MASSOTHERAP|OSTEOPATH|CHIROPRAT|PSYCHOLOG|OPHTALMO|BIRON|DYNACARE|BONLOOK/, 'Santé'],
    // — Loisirs —
    [/STEAM|PLAYSTATION|NINTENDO|CINEMA|CINEPLEX|VILLAGE VACANCES|VAPOSHOP|VAP BOUTIQUE|\bVAPE\b|SQDC|EMPORIUM|LIBRAIRIE|SPECTACLE|MUSEE|SEPAQ|PARC OMEGA|FESTIVAL|ARCADE|QUILLES|ESCALADE|GLISSADES|TICKETMASTER|EVENKO|PLACE DES ARTS|CENTRE BELL|LA RONDE|BIODOME|PLANETARIUM|JARDIN BOTANIQUE|TREMBLANT|BROMONT|STONEHAM|\bSTROM\b|BOTA BOTA|NORDIK|GAMESTOP/, 'Loisirs'],
    // — Magasinage —
    [/WINNERS|DOLLARAMA|CANADIAN TIRE|\bAMZN\b|AMAZON|BEST ?BUY|\bIKEA\b|SIMONS|SPORTS EXPERTS|DECATHLON|HOME DEPOT|\bRONA\b|BUREAU EN GROS|VILLAGE DES VALEURS|MICHAELS|FRIPERIE|RENAUD-BRAY|INDIGO|CHAPTERS|UNIQLO|\bZARA\b|\bH&M\b|OLD NAVY|\bGAP\b|LULULEMON|SEPHORA|COSTCO\.CA|\bTEMU\b|ALIEXPRESS|\bSHEIN\b|APPLE STORE|STAPLES|STRUCTUBE|LINEN CHEST|HOMESENSE|MARSHALLS|\bSAIL\b|\bMEC\b|LA CORDEE|RENO-DEPOT|PATRICK MORIN|\bBMR\b|CANAC|ARCHAMBAULT/, 'Magasinage'],
    // — Voyages —
    [/AIRBNB|AIR TRANSAT|AIR CANADA|WESTJET|SUNWING|AIR FRANCE|DELTA AIR|UNITED AIR|AMERICAN AIR|HOTEL|EXPEDIA|BOOKING|\bFLAIR\b|PORTER|VIA RAIL|MARRIOTT|HILTON|HYATT|FAIRMONT|HOLIDAY INN|\bVRBO\b|HOTELS\.COM|HERTZ|ENTERPRISE RENT|AVIS RENT|BUDGET RENT|\bTURO\b/, 'Voyages'],
];

// Formules sans ambiguïté d'abonnement chez des plateformes par ailleurs mixtes.
const UNAMBIGUOUS_SUBSCRIPTION_OVERRIDE_RULES: ReadonlyArray<readonly [RegExp, RuleCategory]> = [
    [/YOUTUBE PREMIUM|APPLE ONE|GOOGLE ONE|PLAYSTATION PLUS|XBOX GAME PASS|NINTENDO.*ONLINE|PRIME VIDEO|ICLOUD\+/, 'Abonnements'],
];

// ─── [TX-CATEGORIZE] Marchands AMBIGUS : plateforme d'achat ET d'abonnement ───────────────────
// Chez ces marchands, le libellé ne dit PAS s'il s'agit d'un achat unique (un jeu, une app, un
// accessoire) ou d'un abonnement. Décision Marc 2026-07-31 : « un achat unique chez un marchand
// d'abonnement va dans Loisirs ». Ils reçoivent donc leur catégorie NATURELLE par défaut, et ne
// sont promus « Abonnements » que si le PROFIL DE RÉCURRENCE du marchand le prouve (au moins 3
// occurrences, cadence reconnue, montant stable — cf. services/transactions/merchantProfile.ts).
//
// ⚠️ Ces motifs sont évalués AVANT `RULES` : sans ça, `AMAZON`/`\bBELL\b` et consorts les
// captureraient d'abord et l'ambiguïté serait perdue.
const AMBIGUOUS_SUBSCRIPTION_RULES: ReadonlyArray<readonly [RegExp, RuleCategory]> = [
    [/GOOGLE \*|GOOGLE PLAY/, 'Loisirs'],
    [/APPLE\.COM|ITUNES/, 'Loisirs'],
    [/MICROSOFT|\bXBOX\b/, 'Loisirs'],
    [/YOUTUBE|TWITCH|PATREON/, 'Loisirs'],
    [/\bSTEAM\b|PLAYSTATION|NINTENDO/, 'Loisirs'],
];

const EXTERNAL_CATEGORY_HINTS: ReadonlyArray<readonly [RegExp, RuleCategory]> = [
    [/^(GROCER|SUPERMARKET|EPICERIE|FOOD & GROCERIES)/, 'Épicerie'],
    [/^(RESTAURANT|DINING|FOOD|COFFEE|FAST FOOD|BAR|TAKEOUT)/, 'Restaurants'],
    [/^(GAS|FUEL|TRANSPORT|TRANSIT|AUTO|PARKING|TAXI|RIDESHARE)/, 'Transport'],
    [/^(UTILITIES|TELECOM|INTERNET|PHONE|CABLE|SUBSCRIPTION|STREAMING|ABONNEMENT)/, 'Abonnements'],
    [/^(RENT|MORTGAGE|HOUSING|HOME IMPROVEMENT|LOGEMENT|HYDRO)/, 'Logement'],
    [/^(SHOPPING|RETAIL|MERCHANDISE|CLOTHING|ELECTRONICS|MAGASINAGE)/, 'Magasinage'],
    [/^(HEALTH|MEDICAL|PHARMACY|DENTAL|FITNESS|GYM|WELLNESS|SANTE)/, 'Santé'],
    [/^(ENTERTAINMENT|RECREATION|GAMES|SPORTS|LOISIR)/, 'Loisirs'],
    [/^(TRAVEL|AIRLINE|HOTEL|LODGING|VACATION|VOYAGE)/, 'Voyages'],
    [/^(INSURANCE|ASSURANCE)/, 'Assurances'],
    [/^(BANK FEE|FEE|SERVICE CHARGE|INTEREST CHARGE|FRAIS)/, 'Frais bancaires'],
    [/^(TAX|GOVERNMENT|IMPOT)/, 'Impôts'],
    [/^(PAYROLL|SALARY|PAYCHECK|WAGES|SALAIRE)/, 'Salaire'],
    [/^(INCOME|INTEREST|DIVIDEND|CASHBACK|REWARD|REVENU)/, 'Revenus divers'],
    [/^(REFUND|REIMBURSEMENT|RETURN|REMBOURSEMENT)/, 'Remboursement'],
    [/^(TRANSFER|CREDIT CARD PAYMENT|PAYMENT|VIREMENT|TRANSFERT)/, 'Transfert'],
];

/** Traduit une catégorie brute fournie par une source externe (ex. Fintable EN/FR) en catégorie canonique. */
export function mapExternalCategoryHint(rawCategory: string | undefined | null): RuleCategory | null {
    if (!rawCategory) return null;
    const norm = normalizePayee(rawCategory).trim();
    if (!norm) return null;
    const canonical = buildCategoryCanonicalMap(RULE_CATEGORIES).get(categoryKey(rawCategory));
    if (canonical && canonical !== 'Autre') return canonical as RuleCategory;
    for (const [rx, cat] of EXTERNAL_CATEGORY_HINTS) {
        if (rx.test(norm)) return cat;
    }
    return null;
}

/** Résultat détaillé d'une catégorisation par règles. */
interface RuleCategorization {
    /** Catégorie déterministe, `null` si aucune règle ne matche. */
    category: RuleCategory | null;
    /**
     * Vrai quand le marchand est une plateforme où l'achat unique ET l'abonnement existent : la
     * catégorie rendue est un DÉFAUT, promouvable en « Abonnements » par le profil de récurrence.
     */
    subscriptionCandidate: boolean;
}

/**
 * Catégorise un payee par règles, en signalant les marchands AMBIGUS.
 * Déterministe et pur : même entrée, même sortie, zéro réseau.
 */
export function ruleCategorizeDetailed(payee: string): RuleCategorization {
    if (!payee) return { category: null, subscriptionCandidate: false };
    const p = normalizePayee(payee);
    for (const [rx, cat] of UNAMBIGUOUS_SUBSCRIPTION_OVERRIDE_RULES) {
        if (rx.test(p)) return { category: cat, subscriptionCandidate: false };
    }
    for (const [rx, cat] of AMBIGUOUS_SUBSCRIPTION_RULES) {
        if (rx.test(p)) return { category: cat, subscriptionCandidate: true };
    }
    for (const [rx, cat] of RULES) {
        if (rx.test(p)) return { category: cat, subscriptionCandidate: false };
    }
    return { category: null, subscriptionCandidate: false };
}

/**
 * Catégorise un payee par règles. `null` si aucune règle ne matche (→ candidat IA/`Uncategorized`).
 * Déterministe et pur : même entrée, même sortie, zéro réseau.
 *
 * ⚠️ Ne connaît pas l'historique : chez un marchand AMBIGU (Steam, App Store…) elle rend la
 * catégorie par défaut. La promotion en « Abonnements » exige le contexte —
 * `services/transactions/contextualCategorize.ts`.
 */
export function ruleCategorize(payee: string): RuleCategory | null {
    return ruleCategorizeDetailed(payee).category;
}
