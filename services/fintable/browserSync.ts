// services/fintable/browserSync.ts
//
// [FINTABLE-7] Passe de synchronisation Fintable exécutée DANS LE NAVIGATEUR.
//
// Pourquoi ce chemin existe (décision 2026-07-30, demande Marc « je veux que tu fasses tout toi,
// sans que j'aie besoin de t'aider ») : le chemin serveur (`mcp/runFintableSync.ts`, Cloud Run +
// cron GitHub) exige IRRÉDUCTIBLEMENT des identifiants que seul Marc détient — 3 secrets Secret
// Manager, un redéploiement `gcloud`, un secret GitHub Actions. Mesuré : `gcloud` est absent de
// l'environnement d'exécution, il n'y a aucun identifiant GCP, et `fintable.io` y est bloqué (403
// au tunnel CONNECT). Ce chemin-ci ne demande qu'UNE chose : coller le jeton dans Réglages.
//
// Ce module ne DUPLIQUE aucune logique métier : lecteur (`readFintableSnapshot`), mapper pur
// (`mapFintableSnapshot`), persistance des soldes (`toPersistableBrokerBalances`) ET orchestration
// money-critical (`syncCore` : plafonnement de bascule + application isolée par payload) sont
// PARTAGÉS avec le cron serveur. Seuls changent le TRANSPORT (proxy same-origin) et le porteur de
// l'état (rendu à l'appelant, pas écrit au Drive via OCC).
// ⚠️ Le premier jet de ce module COPIAIT le plafonnement et la boucle d'isolation — deux correctifs
// de panel (PR #531) — et l'affirmait pourtant « aucune logique dupliquée » (finding code-reviewer,
// PR #535). Une affirmation de commentaire se vérifie : elle fabriquait le prochain faux négatif.
//
// ⚠️ TRANSPORT : `/api/fintable/*` est un rewrite same-origin (`vercel.json` en prod, `server.proxy`
// en dev) vers `https://fintable.io/api/v2/*`. C'est le patron déjà éprouvé pour Yahoo : la CSP
// (`connect-src 'self'`) couvre sans ajouter de domaine, et il n'y a pas de préflight CORS.
// ⚠️ DIFFÉRENCE avec le proxy Yahoo, à ne pas sous-estimer (finding security-privacy, PR #535) :
// celui-ci relaie un en-tête `Authorization` (Bearer), là où Yahoo ne sert que de la donnée publique
// non authentifiée. L'hôte et le schéma sont FIXES côté rewrite (donc pas de SSRF : un `../` dans le
// chemin ne peut qu'atterrir ailleurs sur fintable.io, joignable directement de toute façon), et
// aucun jeton n'est intégré côté serveur — le relais ne peut donc pas fuiter CELUI de Marc. Reste
// qu'il est ouvert et sans limite de débit : un tiers peut s'en servir pour masquer l'origine de son
// trafic vers fintable.io et consommer de la bande passante. Compromis ACCEPTÉ pour une app solo
// sans backend (ADR-002), consigné ici plutôt que découvert plus tard.
//
// ⚠️ COMPROMIS ASSUMÉ vs le cron serveur, à ne pas masquer : (a) le jeton vit dans le navigateur
// (chiffré comme les autres clés) et transite par l'edge Vercel, au lieu de rester dans Secret
// Manager — le scope LECTURE SEULE du jeton borne le risque ; (b) ça ne tourne pas application
// fermée. Le cron serveur reste en place et prioritaire si Marc monte un jour la config.

import type { AppState, FintableSyncReport, FintableAccountRoleConfig } from '../../types';
import { FintableClient, nettoyerJetonFintable } from './client';
import { readFintableSnapshot } from './readSnapshot';
import { comptesSansPositionsDuSnapshot } from './comptesSansPositions';
import type { FintableSnapshot } from './types';
import { mapFintableSnapshot, FINTABLE_TAX_REGIMES, type FintableAccountRole, type FintableTaxRegime } from './mapSnapshot';
import type { EchantillonCleInconnue } from './decode';
import { decideCutoverDate, requestDateFrom, bornesEffectivesParCompte, libellesRoutes, plancherNonAttribuable, applyPayloadsIsolated } from './syncCore';
import { cleCompte } from './deriveCutoverDate';
import { detectInternalTransfers } from './detectTransfers';
import { classerRattrapage, type ClassementRattrapage, type PaireIncertaine } from './backfillDedup';
import { referenceDeltaPatch } from './applyStatePatch';
import { toPersistableBrokerBalances } from './brokerBalances';
import { accumulerHistoriqueCourtier } from './brokerHistory';
import { lastProductiveAtSuivant } from './syncHealth';
import { FintableError } from './types';
import { logError } from '../errorLogger';
import { fxSourceEffective, fxFaitAutorite } from '../fx/provenance';
import { applyTransferDetection } from '../transactions/applyTransferDetection';
import { smartCategorizeTransactions } from '../transactions/smartCategorize';

/** Base same-origin. Le proxy réécrit vers `https://fintable.io/api/v2`. */
export const FINTABLE_BROWSER_BASE = '/api/fintable';

/** Fenêtre de lecture. 90 jours demandés, ~30 rendus en pratique — la borne réelle est la bascule. */
const LOOKBACK_DAYS = 90;

export interface BrowserSyncResult {
    /** Rapport identique à celui du cron serveur (même type, même carte de diagnostic). */
    report: FintableSyncReport;
    /**
     * Patch MINIMAL à écrire — déjà réduit aux clés réellement touchées, et calculé contre la base
     * sur laquelle les payloads ont été appliqués. `null` si la passe a échoué (rien ne doit être
     * écrit à moitié).
     *
     * ⚠️ [FINTABLE-SYNC-STALE-BASE] Ce champ a REMPLACÉ un `nextState: AppState | null` que
     * l'appelant devait lui-même diffuser via `referenceDeltaPatch(base, nextState)`. Le diff n'a de
     * sens que contre la base EXACTE de l'application ; l'exposer laissait à l'appelant le choix de
     * la base — et les deux appelants prenaient celle capturée AVANT le réseau. Le patch est donc
     * calculé ICI, où la base est connue sans ambiguïté : la faute n'est plus exprimable.
     */
    statePatch: Partial<AppState> | null;
    /**
     * [FINTABLE-RATTRAPAGE] Paires DOUTEUSES à faire trancher par Marc — vide hors rattrapage.
     *
     * ⚠️ Rendu à l'appelant plutôt que persisté : c'est une liste de TRAVAIL, pas de la donnée. La
     * persister créerait un second état à réconcilier (que faire d'une paire dont une des deux
     * transactions a été supprimée depuis ?) pour un gain nul — l'arbitrage se fait dans la foulée
     * de la passe, et les entrantes sont déjà neutralisées si Marc ne fait rien.
     */
    incertaines: PaireIncertaine[];
    /**
     * [FINTABLE-EXTERNAL-MEMO-PISTE-DEVISE] Échantillon des VALEURS des champs hors contrat.
     *
     * ⚠️⚠️ **JAMAIS persisté, JAMAIS dans `report`.** Le rapport est rendu sans gate de mode discret
     * ET `cat`é en clair dans les journaux GitHub Actions d'un dépôt PUBLIC ; un mémo bancaire peut
     * porter un nom ou une adresse. Ce champ voyage par le RETOUR de cette fonction — comme
     * `incertaines` juste au-dessus, et pour la même raison — et le chemin CRON ne le rend pas du
     * tout : de ce côté, la fuite est structurellement impossible plutôt qu'interdite par
     * convention. Décision de Marc (2026-09-16) : « oui, à l'écran seulement ».
     */
    echantillonsChampsInconnus: EchantillonCleInconnue[];
    /** Identifiants des nouvelles transactions ajoutées pendant cette passe (non persisté — déclenche l'IA arrière-plan). */
    newTransactionIds?: number[];
}

export interface BrowserSyncOptions {
    /** Injectable pour les tests (défaut : client réel sur le proxy same-origin). */
    client?: FintableClient;
    /** Injectable pour les tests (défaut : `Date.now()`). */
    now?: () => number;
    /**
     * [FINTABLE-SYNC-STALE-BASE] Relit l'état JUSTE AVANT d'appliquer les payloads.
     *
     * ⚠️ Le `state` reçu en argument est capturé AVANT le fetch réseau (plusieurs secondes). Une
     * saisie manuelle pendant cette fenêtre — une transaction ajoutée à la main, un solde corrigé —
     * atterrit dans le store mais PAS dans ce snapshot : les payloads bâtissaient alors leurs
     * tableaux à partir d'une base amputée, et le patch (qui touche justement `transactions` /
     * `initialBalances`) écrasait la saisie. Le verrou de sync (`acquireFintableSyncLock`) ne
     * protège QUE contre une autre passe, jamais contre l'utilisateur.
     *
     * Appliquer sur l'état FRAIS suffit à tout réconcilier : `applyDocument` déduplique les
     * transactions par clé CONTRE `state.transactions` au moment de l'application, et
     * `applyCashBalance` recalcule sa cible via `computeStartingCash(state)` — les deux voient donc
     * la saisie manuelle. La bascule anti-doublon (`cutoverDateUsed`), elle, reste dérivée de l'état
     * PRÉ-fetch à dessein : elle a déjà servi à borner la requête, et la déduplication à
     * l'application est la vraie protection (la re-dériver ne ferait que FILTRER des transactions
     * légitimes en plus, sans rien gagner).
     *
     * Défaut : `() => state` (comportement d'avant, pour les tests et tout appelant sans store).
     */
    getFreshState?: () => AppState;
    /**
     * [FINTABLE-RATTRAPAGE] Passe de RATTRAPAGE : rapatrie TOUT l'historique exposé par Fintable.
     *
     * ⚠️ Cette option RENONCE délibérément à la garantie centrale de la sync ordinaire — « pas de
     * recouvrement, donc pas de dépendance à la dédup ». Elle ne borne plus la requête à la bascule
     * et laisse le mapper accepter les dates antérieures (`transactionsAfter: null`). Le
     * recouvrement devient CERTAIN, et c'est `classerRattrapage` qui le traite : doublons évidents
     * neutralisés seuls, cas douteux listés pour arbitrage.
     *
     * Demande de Marc (2026-08-18) : « 0 transactions en plus » après avoir élargi son historique
     * chez Fintable — la sync en avant ne pouvait rien rapatrier, par construction.
     * ⚠️ Défaut `false` ⇒ la sync quotidienne est INCHANGÉE, bit pour bit.
     */
    backfill?: boolean;
    /**
     * Auto-route les comptes de carte de crédit non encore assignés en `{ kind: 'debt', debtName: '' }`
     * et récupère sans doublon (via `classerRattrapage`) les dépenses de carte bloquées par la bascule
     * ou les délais de comptabilisation des 30 derniers jours.
     */
    autoCreditCards?: boolean;
}

const DEBIT_OR_NON_CARD_RE = /\b(debit|d[eé]bit)\b/i;
const CREDIT_CARD_ACCOUNT_RE = /\b(credit[\s_-]*card|creditcard|carte\s+(?:de\s+)?cr[eé]dit|visa|mastercard|amex|american\s+express)\b/i;
const NON_CARD_CREDIT_LABEL_RE = /\b(line\s+of\s+credit|marge|loan|pr[eê]t|hypothe|mortgage)\b/i;
const CASH_ACCOUNT_RE = /\b(checking|chequing|savings?|ch[eè]ques?|compte\s+(?:courant|ch[eè]que|[eé]pargne)|epargne|[eé]pargne|eop|depository)\b/i;
const CREDIT_OR_LOAN_RE = /\b(credit|cr[eé]dit|visa|mastercard|amex|loan|pr[eê]t|hypothe|mortgage|marge|line\s+of\s+credit|debt|dette)\b/i;
const INVESTMENT_ACCOUNT_RE = /\b(investment|brokerage|celiapp|fhsa|celi|tfsa|reer|rrsp|reee|resp|disnat|wealthsimple|questrade|placement|courtage)\b/i;

/**
 * Détecte de façon conservatrice si un compte Fintable est une carte de crédit afin d'importer
 * automatiquement ses dépenses sans inventer ni écraser de solde de dette.
 */
export function isLikelyCreditCardAccount(
    account: Pick<FintableSnapshot['accounts'][number], 'rawType' | 'label'>,
): boolean {
    const rawType = (account.rawType ?? '').trim();
    const label = (account.label ?? '').trim();
    const combined = `${rawType} ${label}`;
    if (DEBIT_OR_NON_CARD_RE.test(combined)) return false;
    if (CREDIT_CARD_ACCOUNT_RE.test(combined)) return true;
    return rawType.toLowerCase() === 'credit' && !NON_CARD_CREDIT_LABEL_RE.test(label);
}

/**
 * Auto-détection conservatrice des rôles Fintable pour la synchronisation automatique
 * (carte de crédit sans écrasement de dette, compte chèque/épargne, compte de placement).
 */
export function inferAutoFintableRole(
    account: Pick<FintableSnapshot['accounts'][number], 'rawType' | 'label'>,
): FintableAccountRoleConfig | undefined {
    if (isLikelyCreditCardAccount(account)) {
        return { kind: 'debt', debtName: '' };
    }
    const rawType = (account.rawType ?? '').trim();
    const label = (account.label ?? '').trim();
    const combined = `${rawType} ${label}`;
    if (INVESTMENT_ACCOUNT_RE.test(combined)) {
        if (/\b(celi|tfsa)\b/i.test(combined) && !/\b(celiapp|fhsa)\b/i.test(combined)) {
            return { kind: 'investment', taxRegime: 'CELI' };
        }
        if (/\b(reer|rrsp)\b/i.test(combined)) {
            return { kind: 'investment', taxRegime: 'REER' };
        }
        if (/\b(non[\s_-]?enreg|cash|comptant|margin|marge)\b/i.test(combined)) {
            return { kind: 'investment', taxRegime: 'NON-ENREG' };
        }
        return { kind: 'investment' };
    }
    if (CASH_ACCOUNT_RE.test(combined) && !CREDIT_OR_LOAN_RE.test(combined)) {
        return { kind: 'cash' };
    }
    return undefined;
}

function describeError(err: unknown): string {
    if (err instanceof FintableError) return `[${err.code}] ${err.message}`;
    return err instanceof Error ? err.message : String(err);
}

/**
 * Les rôles persistés (`FintableAccountRoleConfig`, forme UI) sont structurellement identiques à
 * ceux du mapper. La conversion est une identité — mais explicite, pour que le typecheck casse si
 * les deux formes divergent un jour au lieu de laisser passer un rôle mal formé jusqu'au mapper.
 */
function toMapperRoles(
    roles: Readonly<Record<string, FintableAccountRoleConfig>> | undefined,
): Record<string, FintableAccountRole> {
    const out: Record<string, FintableAccountRole> = {};
    for (const [id, role] of Object.entries(roles ?? {})) {
        if (role?.kind === 'debt') {
            // ⚠️⚠️ [FINTABLE-CARTE-SANS-DETTE] Un rôle « Dette » SANS nom est ROUTÉ, pas jeté.
            //
            // Avant : l'entrée était omise de `out` — donc `roleOf` rendait `null` et le mapper
            // classait le compte « SANS RÔLE », jetant 100 % de ses transactions. MESURÉ sur le
            // vrai mapper : rôle Dette AVEC nom → 5/5 transactions importées ; rôle Dette SANS nom
            // → **0/5**, identique à « aucun rôle du tout ». Or l'écran de configuration, lui,
            // affichait bien « Dette (carte) » — Marc voyait un rôle posé pendant que le moteur
            // voyait un compte inconnu, et cherchait ses transactions manquantes ailleurs.
            // C'est la classe `UN-CHAMP-LU-PAR-LE-MOTEUR-ET-JAMAIS-SAISI-EST-UN-CHIFFRE-FAUX` vue
            // à l'envers : ici c'est un champ VIDE qui débranche un compte entier, en silence.
            //
            // Le nom vide a désormais un SENS explicite, et c'est la demande de Marc (2026-09-14 :
            // « ça me demande encore de mettre la dette de carte de crédit dans dette mais je veux
            // pas ») : **importer les transactions, ne toucher à aucun solde**. Les deux moitiés du
            // rôle `debt` sont indépendantes dans le mapper — les transactions passent par le
            // filtre du haut, le solde n'est écrit que s'il y a une dette à viser.
            out[id] = { kind: 'debt', debtName: typeof role.debtName === 'string' ? role.debtName.trim() : '' };
        } else if (role?.kind === 'cash' || role?.kind === 'ignore') {
            out[id] = { kind: role.kind };
        } else if (role?.kind === 'investment') {
            // ⚠️ Régime VALIDÉ contre la source unique, pas recopié (finding code-reviewer, PR #535) :
            // le parseur du chemin serveur (`rolesConfig`) rejette déjà une valeur invalide, mais ici
            // l'état vient du Drive et n'est validé par aucun schéma. Une valeur invalide non-undefined
            // passerait entre les mailles — le mapper ne teste que `=== undefined` pour signaler
            // « régime non déclaré » → ni ventilation, ni avertissement : le pire des deux mondes.
            const regime = (FINTABLE_TAX_REGIMES as readonly string[]).includes(role.taxRegime as string)
                ? (role.taxRegime as FintableTaxRegime)
                : undefined;
            out[id] = regime === undefined ? { kind: 'investment' } : { kind: 'investment', taxRegime: regime };
        }
    }
    return out;
}

/**
 * [FINTABLE-7] Liste les comptes pour l'ÉCRAN DE CONFIGURATION (« Tester la connexion »).
 *
 * Volontairement plus léger que `readFintableSnapshot` : celui-ci enchaîne aussi les positions de
 * CHAQUE compte et les transactions — inutile (et lent, et coûteux en quota) quand on veut juste
 * afficher la liste à Marc pour qu'il assigne les rôles. `skipHoldings` évite N appels superflus.
 *
 * Ne lève pas : rend un message d'erreur exploitable à l'écran. Un jeton refusé (401) doit dire
 * « jeton refusé », pas « quelque chose a échoué ».
 */
export async function listFintableAccountsForSetup(
    token: string,
    opts: { client?: FintableClient } = {},
): Promise<{ accounts: FintableSnapshot['accounts']; error: string | null }> {
    const cleanedToken = nettoyerJetonFintable(token);
    if (!cleanedToken) {
        return { accounts: [], error: 'Jeton Fintable absent.' };
    }
    try {
        const client = opts.client ?? new FintableClient({ token: cleanedToken, baseUrl: FINTABLE_BROWSER_BASE });
        const snapshot = await readFintableSnapshot(client, { skipHoldings: true, skipTransactions: true });
        return { accounts: snapshot.accounts, error: null };
    } catch (err) {
        return { accounts: [], error: describeError(err) };
    }
}

/**
 * Exécute une passe complète depuis le navigateur. Ne LÈVE jamais : toute panne devient un rapport
 * d'échec exploitable (`report.error`), pour que l'UI ait toujours quelque chose d'honnête à
 * afficher — même garantie « rapport toujours écrit » que le cron serveur.
 */
export async function runFintableBrowserSync(
    state: AppState,
    token: string,
    opts: BrowserSyncOptions = {},
): Promise<BrowserSyncResult> {
    const now = opts.now ?? (() => Date.now());
    const emptyReport = (cutoverDateUsed: string | null, error: string | null): FintableSyncReport => ({
        at: now(), cutoverDateUsed, accountsSeen: 0, accountsWithoutRole: 0,
        transactionsAdded: 0, transfersDetected: 0, cashUpdated: false, debtsUpdated: [],
        investmentReferenceCount: 0, warnings: [], error,
        // [FINTABLE-SOURCE-TAG] Un échec ne « dé-produit » pas : l'horodatage précédent est reporté.
        lastProductiveAt: lastProductiveAtSuivant(state.fintableSyncReport, 0, now()),
    });

    const cleanedToken = nettoyerJetonFintable(token);
    if (!cleanedToken) {
        return { report: emptyReport(null, 'Jeton Fintable absent — ajoute-le dans Réglages.'), statePatch: null, incertaines: [], echantillonsChampsInconnus: [] };
    }

    let cutoverDateUsed: string | null = null;
    const preflightWarnings: string[] = [];

    try {
        const todayStr = new Date(now()).toISOString().slice(0, 10);
        // Plafonnement PARTAGÉ avec le cron (`syncCore`) — même correctif des deux côtés, par
        // construction plutôt que par vigilance.
        const cutover = decideCutoverDate(state.transactions, todayStr);
        cutoverDateUsed = cutover.cutoverDateUsed;
        preflightWarnings.push(...cutover.warnings);

        const client = opts.client ?? new FintableClient({ token: cleanedToken, baseUrl: FINTABLE_BROWSER_BASE });
        // ⚠️ ÉCART ASSUMÉ avec le cron, qui laisse `dateFrom: undefined` (illimité) sur état vierge :
        // ici on borne à 90 jours. Ce n'est PAS une protection anti-doublon — celle-ci est la bascule
        // (`transactionsAfter`, appliquée strictement par le mapper) et elle vaut `null` seulement si
        // `state.transactions` est réellement vide, donc il n'y a rien à recouvrir. La borne sert à ne
        // pas rapatrier des mois de données dans un onglet au premier lancement (le cron, lui, tourne
        // sans utilisateur qui attend). Divergence documentée pour ne pas passer pour un oubli.
        // ⚠️ [FINTABLE-RATTRAPAGE] En rattrapage, `dateFrom` est VOLONTAIREMENT absent : Marc a
        // demandé « tout ce que Fintable a ». C'est cette borne qui l'empêchait de récupérer son
        // historique — la lever EST la demande, pas un effet de bord.
        // ⚠️ [FINTABLE-BASCULE-GLOBALE-JETTE-LE-COMPTE-LENT] Hors rattrapage, la borne est la plus
        // ANCIENNE des bornes par compte (`requestDateFrom`) et non la globale : sinon l'API ne rend
        // même pas les lignes du compte qui poste en retard, et le filtre par compte du mapper
        // n'aurait rien à laisser passer — correctif vert en test, mort en production.
        const autoCreditCards = opts.autoCreditCards === true;
        const thirtyDaysAgoStr = new Date(now() - 30 * 86_400_000).toISOString().slice(0, 10);
        const rawDateFrom = opts.backfill
            ? undefined
            : (requestDateFrom(cutover) ?? new Date(now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10));
        const dateFrom = !opts.backfill && autoCreditCards && rawDateFrom && rawDateFrom > thirtyDaysAgoStr
            ? thirtyDaysAgoStr
            : rawDateFrom;
        const snapshot = await readFintableSnapshot(client, { dateFrom, dateTo: todayStr });

        // Auto-routage conservateur des comptes sans rôle configuré (carte crédit, chèque/épargne, placement)
        const autoAssignedRoles: Record<string, FintableAccountRoleConfig> = {};
        if (autoCreditCards) {
            for (const acc of snapshot.accounts) {
                if (state.fintableRoles?.[acc.id] === undefined) {
                    const inferred = inferAutoFintableRole(acc);
                    if (inferred) autoAssignedRoles[acc.id] = inferred;
                }
            }
        }
        const effectiveRolesConfig: Record<string, FintableAccountRoleConfig> =
            Object.keys(autoAssignedRoles).length > 0
                ? { ...(state.fintableRoles ?? {}), ...autoAssignedRoles }
                : (state.fintableRoles ?? {});
        const mapperRoles = toMapperRoles(effectiveRolesConfig);

        // ⚠️ [revue #974] Le PLANCHER se calcule ici et pas plus tôt : il faut les libellés
        // RÉELLEMENT routés pour savoir quelles lignes du store ne sont rattachables à aucun compte
        // — et ce sont elles qui protégeaient avant ce lot (voir `plancherNonAttribuable`).
        const bornesEffectives = bornesEffectivesParCompte(
            cutover.cutoverByAccount,
            plancherNonAttribuable(state.transactions, libellesRoutes(snapshot.accounts.map((a) => a.label))),
        );

        // ⚠️ [finding code-reviewer, PR #566] Les RÔLES viennent de `state` (pré-fetch), pas de
        // l'état frais — écart ASSUMÉ et borné, nommé plutôt que laissé en résiduel silencieux :
        // réassigner un rôle de compte pendant les quelques secondes de réseau ferait classer ce
        // compte selon l'ANCIENNE config pour cette passe seulement, et la suivante le corrige.
        // Rien n'est écrasé (c'est une lecture de CONFIG, pas la base d'application), donc ça ne
        // relève pas de [FINTABLE-SYNC-STALE-BASE], qui visait la base d'ÉCRITURE.
        const { payloads, report: mapReport } = mapFintableSnapshot(snapshot, {
            roles: mapperRoles,
            // ⚠️ `null` en rattrapage : sans ça le mapper jetterait tout l'historique qu'on vient
            // justement d'aller chercher (`tx.date <= transactionsAfter`, filtre STRICT). Les deux
            // bornes — requête ET mapper — doivent tomber ENSEMBLE ; n'en lever qu'une donnerait un
            // rattrapage qui télécharge tout et n'en garde rien, en silence.
            transactionsAfter: opts.backfill ? null : cutoverDateUsed,
            // ⚠️ En RATTRAPAGE, les bornes par compte tombent avec la globale : `classerRattrapage`
            // devient l'arbitre du recouvrement. En laisser une seule filtrerait l'historique qu'on
            // vient justement d'aller chercher.
            ...(opts.backfill ? {} : { transactionsAfterByAccount: bornesEffectives }),
        });

        // [FINTABLE-SYNC-STALE-BASE] Base RELUE ici, après le réseau — voir `getFreshState`.
        const baseState = opts.getFreshState?.() ?? state;

        // Récupération sans doublon des transactions de cartes de crédit bloquées par la bascule
        // globale/compte lent ou en devise étrangère convertible sur les 30 derniers jours.
        let recoveredCardFromCutover = 0;
        const recoveredCardAccounts = new Set<string>();
        if (!opts.backfill && autoCreditCards) {
            const accountById = new Map(snapshot.accounts.map((a) => [a.id, a]));
            const { transferIds } = detectInternalTransfers(snapshot.transactions, mapperRoles);
            const existingBankPayload = payloads.find(
                (p): p is Extract<(typeof payloads)[number], { kind: 'bank_statement' }> => p.kind === 'bank_statement',
            );
            const alreadyMappedSigs = new Set(
                (existingBankPayload?.transactions ?? []).map(
                    (t) => `${t.date}|${Math.round(t.amount * 100)}|${t.accountName ?? ''}`,
                ),
            );
            const fxKnown = fxFaitAutorite(fxSourceEffective(baseState));
            const fxRates: Readonly<Record<string, number | undefined>> = {
                CAD: baseState.fxRates?.CAD,
                USD: baseState.fxRates?.USD,
                EUR: baseState.fxRates?.EUR,
            };

            interface CardRecoveryCandidate {
                date: string;
                payee: string;
                amount: number;
                category?: string;
                isTransfer?: boolean;
                accountName?: string;
                _fromCutover: boolean;
            }

            const cardCandidates: CardRecoveryCandidate[] = [];
            for (const tx of snapshot.transactions) {
                const role = mapperRoles[tx.accountId];
                if (!role || (role.kind !== 'debt' && role.kind !== 'cash')) continue;
                if (tx.date < thirtyDaysAgoStr || tx.date > todayStr) continue;

                const accountLabel = accountById.get(tx.accountId)?.label;
                const borneCompte = accountLabel !== undefined
                    ? bornesEffectives[cleCompte(accountLabel)]
                    : undefined;
                const borne = borneCompte ?? cutoverDateUsed;
                const isBeforeCutover = borne !== null && tx.date <= borne;
                const txCurrency = tx.currency.toUpperCase();
                const isForeignCurrency = txCurrency !== 'CAD';
                if (!isBeforeCutover && !isForeignCurrency) continue;

                let amountCad = tx.amount;
                if (isForeignCurrency) {
                    const rate = fxRates[txCurrency];
                    if (!fxKnown || typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
                        continue;
                    }
                    amountCad = Number((tx.amount * rate).toFixed(2));
                }

                const payee = tx.merchant?.trim() || tx.description.trim() || '(sans libellé)';
                const sig = `${tx.date}|${Math.round(amountCad * 100)}|${accountLabel ?? ''}`;
                if (alreadyMappedSigs.has(sig)) continue;
                alreadyMappedSigs.add(sig);

                cardCandidates.push({
                    date: tx.date,
                    payee,
                    amount: amountCad,
                    ...(tx.categoryName ? { category: tx.categoryName } : {}),
                    ...(transferIds.has(tx.id) ? { isTransfer: true } : {}),
                    ...(accountLabel ? { accountName: accountLabel } : {}),
                    _fromCutover: isBeforeCutover,
                });
            }

            if (cardCandidates.length > 0) {
                const classement = classerRattrapage(baseState.transactions ?? [], cardCandidates);
                if (classement.nouvelles.length > 0) {
                    const rescued = classement.nouvelles.map(({ _fromCutover, ...txData }) => {
                        if (_fromCutover) recoveredCardFromCutover += 1;
                        if (txData.accountName) recoveredCardAccounts.add(txData.accountName);
                        return txData;
                    });
                    // Respecte strictement l'ordre contractuel `bank_statement -> cash_balance -> debt` (`syncCore.ts`).
                    payloads.unshift({
                        kind: 'bank_statement',
                        callerClassified: true,
                        transactions: rescued,
                    });
                }
            }
        }

        // ⚠️ [FINTABLE-RATTRAPAGE] Le classement se fait ICI : après la relecture de la base (donc
        // contre les VRAIES transactions existantes, saisies manuelles comprises) et AVANT
        // l'application. Le faire plus tôt le baserait sur un état pré-réseau — exactement le défaut
        // corrigé par [FINTABLE-SYNC-STALE-BASE] ; plus tard, les doublons seraient déjà écrits.
        let rattrapage: ClassementRattrapage<{ date: string; payee: string; amount: number; isDuplicate?: boolean }> | null = null;
        if (opts.backfill) {
            for (const p of payloads) {
                if (p.kind !== 'bank_statement') continue;
                rattrapage = classerRattrapage(baseState.transactions ?? [], p.transactions);
                // Les incertaines sont neutralisées AUSSI : mieux vaut un doublon caché (récupérable
                // depuis la liste) qu'un doublon qui fausse le budget en silence.
                // L'appelant fait autorité : voir `callerClassified` (deux dédups qui se
                // contredisaient et supprimaient de vraies dépenses).
                p.callerClassified = true;
                p.transactions = [
                    ...rattrapage.nouvelles,
                    ...rattrapage.certaines,
                    ...rattrapage.incertaines.map((i) => i.entrante),
                ] as typeof p.transactions;
            }
        }
        // Indexe les catégories brutes reçues de Fintable avant application pour les réutiliser
        // dans le classement intelligent sur les transactions nouvellement ajoutées.
        const prevMaxId = (baseState.transactions ?? []).reduce((m, t) => Math.max(m, t.id || 0), 0);
        const rawHintQueues = new Map<string, string[]>();
        for (const p of payloads) {
            if (p.kind !== 'bank_statement') continue;
            for (const item of p.transactions ?? []) {
                const rawCat = typeof item.category === 'string' ? item.category.trim() : '';
                if (!rawCat) continue;
                const k = `${item.date}|${Math.round((item.amount || 0) * 100)}|${String(item.payee || '').trim().toLowerCase()}`;
                const q = rawHintQueues.get(k);
                if (q) q.push(rawCat);
                else rawHintQueues.set(k, [rawCat]);
            }
        }

        // Isolation PAR PAYLOAD : PARTAGÉE avec le cron (`syncCore`), voir son en-tête.
        const applied = applyPayloadsIsolated(baseState, payloads);
        const { nextState, transactionsAdded, cashUpdated, cashAnchorDelta, debtsUpdated, warnings: applyWarnings } = applied;

        let enrichedNextState = nextState;
        let newTransactionIds: number[] = [];
        if (transactionsAdded > 0) {
            const addedTxs = nextState.transactions.filter((t) => t.id > prevMaxId);
            newTransactionIds = addedTxs.map((t) => t.id);
            if (newTransactionIds.length > 0) {
                const externalHintsById = new Map<number, string>();
                for (const t of addedTxs) {
                    const k = `${t.date}|${Math.round((t.amount || 0) * 100)}|${String(t.payee || '').trim().toLowerCase()}`;
                    const q = rawHintQueues.get(k);
                    const hint = q?.shift();
                    if (hint) externalHintsById.set(t.id, hint);
                }
                const transferDet = applyTransferDetection(nextState.transactions);
                const smart = smartCategorizeTransactions({
                    transactions: transferDet.transactions,
                    targetIds: new Set(newTransactionIds),
                    categorizationRules: baseState.categorizationRules ?? [],
                    budgetItems: baseState.budgetItems ?? [],
                    externalHintsById,
                });
                enrichedNextState = { ...nextState, transactions: smart.transactions };
            }
        }

        const adjustedSkippedBeforeCutover = Math.max(
            0,
            mapReport.transactions.skippedBeforeCutover - recoveredCardFromCutover,
        );
        const filteredMapWarnings = recoveredCardAccounts.size === 0 && recoveredCardFromCutover === 0
            ? mapReport.warnings
            : mapReport.warnings.flatMap((warning) => {
                if (
                    recoveredCardFromCutover > 0 &&
                    warning.includes('plus ANCIENNES que la bascule')
                ) {
                    if (adjustedSkippedBeforeCutover === 0) return [];
                    return [
                        `${adjustedSkippedBeforeCutover} transaction(s) plus ANCIENNES que la bascule (${cutoverDateUsed}) `
                        + 'ont été ignorées : la synchronisation ne remonte jamais avant ta transaction la plus '
                        + 'récente. Utilise « Rattraper l\u2019historique » dans Réglages pour les récupérer.',
                    ];
                }
                if (recoveredCardAccounts.size > 0 && warning.startsWith('Compte(s) en retard de postage sans historique connu : ')) {
                    const rest = warning
                        .slice('Compte(s) en retard de postage sans historique connu : '.length)
                        .split('.')[0]
                        .split(',')
                        .map((s) => s.trim())
                        .filter((label) => label !== '' && !recoveredCardAccounts.has(label));
                    if (rest.length === 0) return [];
                    const suffix = warning.slice(warning.indexOf('.'));
                    return [`Compte(s) en retard de postage sans historique connu : ${rest.join(', ')}${suffix}`];
                }
                return [warning];
            });

        const report: FintableSyncReport = {
            at: now(),
            cutoverDateUsed,
            // ⚠️ La fin du « 0 transactions en plus » trompeur : le compteur existait dans le
            // rapport du mapper depuis toujours, mais ne sortait que dans le script de dry-run.
            skippedBeforeCutover: adjustedSkippedBeforeCutover,
            wasBackfill: opts.backfill === true,
            accountsSeen: snapshot.accounts.length,
            accountsWithoutRole: mapReport.accountsWithoutRole.length,
            transactionsAdded,
            // [FINTABLE-SOURCE-TAG] Fraîcheur du connecteur : horodatée si la passe a ÉCRIT,
            // reportée du rapport précédent sinon (source unique de la règle : syncHealth.ts).
            lastProductiveAt: lastProductiveAtSuivant(baseState.fintableSyncReport, transactionsAdded, now()),
            transfersDetected: mapReport.transferPairs.length,
            cashUpdated,
            cashAnchorDelta,
            debtsUpdated,
            investmentReferenceCount: mapReport.investmentBalances.length,
            // [FINTABLE-INVESTMENTS-MUET] La cause d'un écran de placements VIDE, jusqu'ici
            // mesurée puis jetée. Source unique partagée avec l'autre chemin de sync.
            comptesSansPositions: comptesSansPositionsDuSnapshot(snapshot),
            warnings: [...preflightWarnings, ...filteredMapWarnings, ...applyWarnings],
            error: null,
        };

        // [FINTABLE-DISNAT-USD-SOLDE-IGNORE] Les taux viennent de l'état : un compte en devise
        // étrangère est CONVERTI quand son taux est connu, et SIGNALÉ sinon (jamais replié 1:1).
        // ⚠️ [FX-TAUX-JAMAIS-ARRIVES] « Connu » ne veut plus dire « présent » : `DEFAULT_FX_RATES`
        // est TOUJOURS présent (`USD: 1.40`). C'est la PROVENANCE qui décide, et un repli en dur
        // n'a pas le droit d'écrire un total de compte.
        const soldesCourtier = toPersistableBrokerBalances(
            mapReport.investmentBalances, report.at, 'CAD',
            baseState.fxRates, !fxFaitAutorite(fxSourceEffective(baseState)),
        );

        const nextFintableRoles = Object.keys(autoAssignedRoles).length > 0
            ? { ...autoAssignedRoles, ...(baseState.fintableRoles ?? {}) }
            : enrichedNextState.fintableRoles;

        // Delta par IDENTITÉ DE RÉFÉRENCE contre `baseState` — la base RÉELLE de l'application.
        // Le helper porte le pourquoi du delta (`applyStatePatch.ts`) ; ce qui se joue ici est le
        // choix de la BASE, et c'est précisément ce que [FINTABLE-SYNC-STALE-BASE] corrige.
        return {
            report,
            incertaines: rattrapage?.incertaines ?? [],
            // ⚠️ Hors du `report` DÉLIBÉRÉMENT (cf. le champ du type) : à l'écran seulement.
            echantillonsChampsInconnus: snapshot.unknownTransactionSamples,
            newTransactionIds,
            statePatch: referenceDeltaPatch(baseState, {
                ...enrichedNextState,
                ...(nextFintableRoles !== undefined ? { fintableRoles: nextFintableRoles } : {}),
                fintableSyncReport: report,
                fintableBrokerBalances: soldesCourtier,
                // [FINTABLE-HISTORIQUE-COURTIER] La lecture du jour REJOINT l'historique au lieu de
                // l'écraser. Écrit ici, au même endroit que l'instantané, parce que les deux doivent
                // venir de la MÊME lecture : les dériver de deux appels laisserait l'un des deux en
                // retard d'une passe, sans que rien ne le signale.
                fintableBrokerHistory: accumulerHistoriqueCourtier(baseState.fintableBrokerHistory, soldesCourtier, report.at),
            }),
        };
    } catch (err) {
        logError({
            source: 'storage', severity: 'error',
            message: '[FINTABLE-7] Passe de sync (navigateur) ÉCHOUÉE.',
            error: err instanceof Error ? err : new Error(String(err)),
        });
        // Rapport d'échec RENDU (pas persisté ici) : c'est l'appelant qui décide d'écrire, pour ne
        // jamais laisser un état à moitié appliqué. `statePatch: null` = « n'écris rien du contenu ».
        // Sur ÉCHEC, pas d'échantillon : une passe qui n'a rien lu n'a rien observé. Publier une
        // liste vide ici est une MESURE (« rien vu »), pas un défaut de câblage.
        return { report: emptyReport(cutoverDateUsed, describeError(err)), statePatch: null, incertaines: [], echantillonsChampsInconnus: [] };
    }
}
