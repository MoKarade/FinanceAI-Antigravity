// mcp/http/routesPlanifiees.ts
// [GODFILE-MCPHTTP] Routes hors-protocole du serveur HTTP MCP : les déclencheurs planifiés
// (POST /refresh, POST /fintable-sync, POST /market-store — secrets Bearer DISTINCTS, comparés en temps constant).
// Extraites telles quelles de `mcp/http.ts` ; le STORE d'état arrive en paramètre.

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResolvedState } from '../bootstrap';
import { runPriceRefresh } from '../refreshPrices';
import { runFintableSync } from '../runFintableSync';
import { FintableClient } from '../../services/fintable/client';
import type { FintableMappingConfig } from '../../services/fintable/mapSnapshot';
import { isStateConflictError } from '../state/stateErrors';
import { configureMarketDataProvider } from '../../services/marketData';
import type { LecteursMarche } from '../../services/marche/passeMagasin';
import { runPasseMarche } from '../marche/runMarche';
import { FichierMarcheIllisibleError, type StoreMarche } from '../marche/storeMarche';
import { HUB_NO_STORE, hubTokensMatch, sendJson } from './plomberie';

/** Le store d'état résolu (blob local ou Drive) — même objet que celui du serveur. */
type StoreEtat = ResolvedState['store'];

// [CODEQL-37] Codes d'erreur FIXES renvoyés à l'appelant. Le texte d'une exception (message
// Drive, chemin, état du coffre…) ne sort JAMAIS dans une réponse HTTP : il reste dans le
// journal du serveur (`console.error`). Défense en profondeur : ces routes sont déjà gardées
// par un secret, mais un détail interne n'a rien à faire chez l'appelant. Les workflows publics
// (refresh-prices.yml, fintable-sync.yml) ne lisent que `error != null` : `error` reste
// non nul, seul son contenu devient un code stable.
export const ERREUR_CONFLIT_ETAT = 'conflit-etat';
export const ERREUR_PANNE_ETAT = 'panne-etat';
const ERREUR_CLE_EODHD_ABSENTE = 'cle-eodhd-absente';
const ERREUR_STORE_MARCHE_ABSENT = 'store-marche-absent';
const ERREUR_FICHIER_MARCHE_ILLISIBLE = 'fichier-marche-illisible';

const detailErreur = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// POST /refresh — rafraîchit les prix de marché dans le blob Drive, sans
// ouvrir l'app. Déclenché par un job planifié EXTERNE (GitHub Actions), authentifié par un
// secret dédié (Authorization: Bearer). Réponses : 200 { ok:true, saved, refreshed[], skipped[] }
// au succès ; 200 { ok:false, conflict:true } si l'app a poussé entre-temps (transitoire, le
// prochain tick réessaie) ; 5xx sur panne RÉELLE (Drive KO, jeton révoqué, coffre chiffré) pour
// que le cron rougisse au lieu de rester vert sur des prix figés. Ne modifie QUE les cours.
export const handleRefresh = (req: IncomingMessage, res: ServerResponse, store: StoreEtat, refreshSecret: string, finnhubKey?: string): void => {
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST uniquement.' }, HUB_NO_STORE);
        return;
    }
    const header = req.headers.authorization;
    const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !hubTokensMatch(provided, refreshSecret)) {
        sendJson(res, 401, { error: 'Authorization: Bearer absent ou invalide.' }, HUB_NO_STORE);
        return;
    }
    if (finnhubKey) configureMarketDataProvider({ finnhubKey });
    runPriceRefresh(store)
        .then((outcome) => sendJson(res, 200, { ok: true, ...outcome }, HUB_NO_STORE))
        .catch((err: unknown) => {
            if (isStateConflictError(err)) {
                sendJson(res, 200, { ok: false, conflict: true, error: ERREUR_CONFLIT_ETAT }, HUB_NO_STORE);
                return;
            }
            console.error('[FinanceAI MCP http] /refresh : échec —', detailErreur(err));
            sendJson(res, 503, { ok: false, error: ERREUR_PANNE_ETAT }, HUB_NO_STORE);
        });
};

// [MARCHE-ROUTE] POST /market-store — met à jour le magasin de marché (clôtures EODHD, taux de la Banque du
// Canada) dans SON fichier Drive, séparé de l'état de l'app. Déclenché par un job planifié EXTERNE (GitHub
// Actions), authentifié par un secret DÉDIÉ (il autorise une écriture Drive et dépense le quota EODHD).
export const handleMarketStore = (
    req: IncomingMessage, res: ServerResponse, store: StoreMarche | null, secret: string,
    cleEodhd: string | undefined, live: boolean, lecteurs: (cle: string) => LecteursMarche,
    maintenant: () => Date = () => new Date(),
): void => {
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST uniquement.' }, HUB_NO_STORE);
        return;
    }
    const header = req.headers.authorization;
    const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !hubTokensMatch(provided, secret)) {
        sendJson(res, 401, { error: 'Authorization: Bearer absent ou invalide.' }, HUB_NO_STORE);
        return;
    }
    if (!cleEodhd) {
        sendJson(res, 503, { ok: false, error: ERREUR_CLE_EODHD_ABSENTE }, HUB_NO_STORE);
        return;
    }
    if (!store) {
        sendJson(res, 503, { ok: false, error: ERREUR_STORE_MARCHE_ABSENT }, HUB_NO_STORE);
        return;
    }
    runPasseMarche(store, lecteurs(cleEodhd), { maintenant: maintenant(), essaiABlanc: !live })
        .then((resultat) => sendJson(res, 200, { ok: true, essaiABlanc: !live, ...resultat }, HUB_NO_STORE))
        .catch((err: unknown) => {
            if (isStateConflictError(err)) {
                sendJson(res, 200, { ok: false, conflict: true, error: ERREUR_CONFLIT_ETAT }, HUB_NO_STORE);
                return;
            }
            const code = err instanceof FichierMarcheIllisibleError ? ERREUR_FICHIER_MARCHE_ILLISIBLE : ERREUR_PANNE_ETAT;
            console.error(`[FinanceAI MCP http] /market-store : échec — ${code}`);
            sendJson(res, 503, { ok: false, error: code }, HUB_NO_STORE);
        });
};

// [FINTABLE-3] POST /fintable-sync — synchronise transactions/soldes/dettes depuis Fintable dans
// le blob Drive, sans ouvrir l'app. Déclenché par un cron EXTERNE (Cloud Scheduler), authentifié
// par un secret DÉDIÉ (distinct de FINANCEAI_REFRESH_SECRET).
export const handleFintableSync = (
    req: IncomingMessage, res: ServerResponse, store: StoreEtat, syncSecret: string,
    fintableToken: string | undefined, fintableRoles: FintableMappingConfig['roles'] | undefined,
): void => {
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'POST uniquement.' }, HUB_NO_STORE);
        return;
    }
    const header = req.headers.authorization;
    const provided = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided || !hubTokensMatch(provided, syncSecret)) {
        sendJson(res, 401, { error: 'Authorization: Bearer absent ou invalide.' }, HUB_NO_STORE);
        return;
    }
    if (!fintableToken) {
        sendJson(res, 503, { ok: false, error: 'FINTABLE_TOKEN absent : sync impossible.' }, HUB_NO_STORE);
        return;
    }
    const client = new FintableClient({ token: fintableToken });
    runFintableSync(store, { token: fintableToken, roles: fintableRoles ?? {}, client })
        .then((report) => sendJson(res, 200, { ok: true, report }, HUB_NO_STORE))
        .catch((err: unknown) => {
            if (isStateConflictError(err)) {
                sendJson(res, 200, { ok: false, conflict: true, error: ERREUR_CONFLIT_ETAT }, HUB_NO_STORE);
                return;
            }
            console.error('[FinanceAI MCP http] /fintable-sync : échec —', detailErreur(err));
            sendJson(res, 503, { ok: false, error: ERREUR_PANNE_ETAT }, HUB_NO_STORE);
        });
};
