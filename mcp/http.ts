#!/usr/bin/env node
// mcp/http.ts
//
// [MCP-CLOUDRUN-HTTP] — entrée Streamable HTTP du serveur MCP FinanceAI.
// Lancement : npm run mcp:http (local, 127.0.0.1:8080) ; sur Cloud Run, $PORT
// est défini par la plateforme → écoute 0.0.0.0:$PORT (exigence Cloud Run).
// Le mode stdio (mcp/stdio.ts, npm run mcp:dev) reste inchangé pour le local.
//
// [GODFILE-MCPHTTP] Découpé pour l'auditabilité sécurité : la plomberie transport
// (readBody plafonné, réponses JSON, comparaison en temps constant) vit dans
// `http/plomberie.ts`, le flux OAuth 2.1 dans `http/oauth.ts`, les routes
// planifiées (/refresh, /fintable-sync, /market-store) dans
// `http/routesPlanifiees.ts`. Ce fichier reste l'ENTRÉE : options, sessions MCP,
// routeur, refus de démarrage (main).
//
// Endpoints :
//   - POST/GET/DELETE /mcp : protocole MCP Streamable HTTP (sessions à ID,
//     réponses JSON directes — enableJsonResponse) ;
//   - GET /health          : 200 {"status":"ok"} (sonde Cloud Run).

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createServer as createMcpServer } from './server';
import { MCP_SERVER_VERSION, buildSha, resolveState, type ResolvedState } from './bootstrap';
import { makeOAuthProvider, OAuthError, type OAuthProvider } from './auth/oauthProvider';
import { makeAddressAttemptLimiter, type AddressAttemptLimiter } from './auth/rateLimit';
import { makeRouteGuard, adresseClient, type LimitedRoute, type RouteGuard } from './auth/routeRateLimit';
import type { FintableMappingConfig } from '../services/fintable/mapSnapshot';
import { parseRolesJson } from '../services/fintable/rolesConfig';
import { BodyTooLargeError, hubTokensMatch, readBody, sendJson, sendRpcError } from './http/plomberie';
import { handleOAuth } from './http/oauth';
import { handleFintableSync, handleMarketStore, handleRefresh } from './http/routesPlanifiees';
import { creerLecteursReseau } from './marche/lecteursReseau';
import type { LecteursMarche } from '../services/marche/passeMagasin';

/** Délai de grâce de l'arrêt : au-delà, fermeture FORCÉE des connexions. */
const CLOSE_GRACE_MS = 5_000;

interface SessionEntry {
    transport: StreamableHTTPServerTransport;
    lastSeen: number;
}

export interface HttpServerOptions {
    port: number;
    host: string;
    state: ResolvedState;
    /** Protection anti-DNS-rebinding Host+Origin (activer en LOCAL ; inutile derrière le proxy Cloud Run). */
    dnsRebindingProtection?: boolean;
    /** Durée d'inactivité avant fermeture d'une session (défaut 1 h) — injectable pour les tests. */
    sessionIdleMs?: number;
    /** Période du balayage des sessions inactives (défaut 10 min) — injectable pour les tests. */
    sweepIntervalMs?: number;
    /** Garde-fou mémoire : refus (503) au-delà (défaut 32 — app solo, jamais atteint en usage normal). */
    maxSessions?: number;
    /** [MCP-CLOUDRUN-B] fournisseur OAuth 2.1 : si présent, /mcp exige un Bearer valide
     *  et les endpoints /oauth/* + /.well-known/* sont exposés. */
    auth?: OAuthProvider;
    /** [Refresh planifié] secret du déclencheur planifié : si présent, POST /refresh est exposé
     *  (header Authorization: Bearer, 401 sinon). Absent = route désactivée. */
    refreshSecret?: string;
    /** Clé Finnhub (env) : configure le provider marché avant /refresh, pour
     *  rafraîchir aussi les ACTIONS (la crypto CoinGecko marche sans clé). Absente = actions skippées. */
    finnhubKey?: string;
    /** [FINTABLE-3] secret du déclencheur planifié (cron quotidien) : si présent, POST /fintable-sync
     *  est exposé (header Authorization: Bearer, 401 sinon). Absent = route désactivée. */
    fintableSyncSecret?: string;
    /** [FINTABLE-3] jeton Fintable (API V2) + config des rôles de comptes. */
    fintableToken?: string;
    fintableRoles?: FintableMappingConfig['roles'];
    /** [MARCHE-ROUTE] secret du déclencheur planifié du magasin de marché : si présent, POST /market-store est
     *  exposé (Authorization: Bearer, 401 sinon). Absent = route désactivée (404). */
    marketSecret?: string;
    /** [MARCHE-ROUTE] clé EODHD (Secret Manager). Absente : la route répond 503, rien n'est appelé. */
    eodhdKey?: string;
    /** [MARCHE-ROUTE] false (défaut) = ESSAI À BLANC : le plan est calculé, rien n'est appelé ni écrit. */
    marketLive?: boolean;
    /** [MARCHE-ROUTE] lectures réseau (injectables pour les tests ; défaut : EODHD + Banque du Canada). */
    marketLecteurs?: (cleEodhd: string) => LecteursMarche;
    /** [MARCHE-ROUTE] horloge de la route (injectable pour les tests). */
    marketMaintenant?: () => Date;
    /** [MCP-RATE-LIMIT] Garde de débit des routes (injectable pour les tests ; défaut : plafonds de `routeRateLimit.ts`). */
    rateGuard?: RouteGuard;
    /** [MCP-RATE-LIMIT] Limiteur d'échecs de /oauth/authorize (injectable pour les tests ; défaut : 8 par adresse, 200 global). */
    authorizeLimiter?: AddressAttemptLimiter;
    /** [MCP-ACCESS-KEY-MIN] La clé d'accès est faible (< 32 car.) : exposé par l'outil `ping` (derrière l'OAuth), jamais sur /health. */
    cleAccesFaible?: boolean;
    /** [MCP-ACCESS-KEY-MIN] STRICT + clé faible : `/oauth/authorize` répond 503 ; le reste du serveur continue. */
    autorisationBloquee?: boolean;
}

/** [MCP-ACCESS-KEY-MIN] Longueur minimale de FINANCEAI_ACCESS_KEY (refus de démarrer en dessous). */
export const MIN_ACCESS_KEY_LENGTH = 32;
export const cleAccesTropCourte = (cle: string | undefined): boolean => cle !== undefined && cle.length < MIN_ACCESS_KEY_LENGTH;

export const alerteCleAcces = (v: { faible: boolean; refuser: boolean }): string | null => {
    if (v.refuser) return "[FinanceAI MCP http] ⚠️ STRICT : clé d'accès faible — /oauth/authorize répond 503 tant qu'elle n'est pas régénérée.";
    if (v.faible) return "[FinanceAI MCP http] ⚠️ ALERTE : clé d'accès faible. Régénère-la (64 caractères hex) puis active FINANCEAI_ACCESS_KEY_STRICT=1 (docs/A_FAIRE_MOI.md).";
    return null;
};

export const evaluerCleAcces = (cle: string | undefined, strict: string | undefined): { faible: boolean; refuser: boolean } => {
    const faible = cleAccesTropCourte(cle);
    return { faible, refuser: faible && strict === '1' };
};

export interface RunningHttpServer {
    server: Server;
    port: number;
    close: () => Promise<void>;
}

/**
 * Démarre le serveur HTTP MCP. Exporté (au lieu d'un simple main) pour être
 * testable : les tests l'instancient sur un port éphémère avec un état fixture.
 */
export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
    const { state } = options;
    const sessionIdleMs = options.sessionIdleMs ?? 60 * 60 * 1000;
    const sweepIntervalMs = options.sweepIntervalMs ?? 10 * 60 * 1000;
    const maxSessions = options.maxSessions ?? 32;
    const sessions = new Map<string, SessionEntry>();
    let boundPort = options.port;

    const closeSession = async (id: string): Promise<void> => {
        const entry = sessions.get(id);
        sessions.delete(id);
        if (entry) {
            await entry.transport.close().catch((err: unknown) => {
                console.error(`[FinanceAI MCP http] Échec de fermeture de la session ${id.slice(0, 8)}… :`, err);
            });
        }
    };

    const sweeper = setInterval(() => {
        const cutoff = Date.now() - sessionIdleMs;
        for (const [id, entry] of sessions) {
            if (entry.lastSeen < cutoff) {
                void closeSession(id);
                console.error(`[FinanceAI MCP http] Session inactive fermée : ${id.slice(0, 8)}…`);
            }
        }
    }, sweepIntervalMs);
    sweeper.unref();

    const handleMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        const sessionId = req.headers['mcp-session-id'];
        if (Array.isArray(sessionId)) {
            sendRpcError(res, 400, -32000, 'En-tête mcp-session-id multiple.');
            return;
        }

        if (sessionId) {
            const entry = sessions.get(sessionId);
            if (!entry) {
                sendRpcError(res, 404, -32001, 'Session inconnue ou expirée — ré-initialise la connexion.');
                return;
            }
            entry.lastSeen = Date.now();
            const raw = req.method === 'POST' ? await readBody(req) : undefined;
            let parsed: unknown;
            if (raw != null) {
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    sendRpcError(res, 400, -32700, 'Corps JSON invalide.');
                    return;
                }
            }
            await entry.transport.handleRequest(req, res, parsed);
            return;
        }

        if (req.method !== 'POST') {
            sendRpcError(res, 400, -32000, 'Session requise (en-tête mcp-session-id) — envoie `initialize` d’abord.');
            return;
        }
        const raw = await readBody(req);
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            sendRpcError(res, 400, -32700, 'Corps JSON invalide.');
            return;
        }
        if (!isInitializeRequest(parsed)) {
            sendRpcError(res, 400, -32000, 'Requête sans session : seul `initialize` est accepté.');
            return;
        }
        if (sessions.size >= maxSessions) {
            sendRpcError(res, 503, -32000, 'Trop de sessions actives — réessaie plus tard.');
            return;
        }

        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            enableDnsRebindingProtection: options.dnsRebindingProtection ?? false,
            allowedHosts: options.dnsRebindingProtection
                ? [`127.0.0.1:${boundPort}`, `localhost:${boundPort}`]
                : undefined,
            allowedOrigins: options.dnsRebindingProtection
                ? [`http://127.0.0.1:${boundPort}`, `http://localhost:${boundPort}`]
                : undefined,
            onsessioninitialized: (id: string) => {
                sessions.set(id, { transport, lastSeen: Date.now() });
            },
            onsessionclosed: (id: string) => {
                sessions.delete(id);
            },
        });
        transport.onerror = (err: Error) => {
            console.error('[FinanceAI MCP http] Erreur transport SDK :', err.message);
        };
        const mcpServer = createMcpServer({ getState: state.store.get, store: state.store, cleAccesFaible: options.cleAccesFaible });
        try {
            await mcpServer.connect(transport);
            await transport.handleRequest(req, res, parsed);
        } catch (err) {
            const id = transport.sessionId;
            if (id) sessions.delete(id);
            throw err;
        }
    };

    const authorizeLimiter = options.authorizeLimiter ?? makeAddressAttemptLimiter({ globalMax: options.cleAccesFaible ? undefined : null });
    const rateGuard = options.rateGuard ?? makeRouteGuard();

    const secretValide = (route: LimitedRoute, req: IncomingMessage): boolean => {
        const h = req.headers.authorization;
        const bearer = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7) : '';
        const egal = (fourni: string, attendu: string | undefined): boolean =>
            fourni !== '' && attendu !== undefined && hubTokensMatch(fourni, attendu);
        switch (route) {
            case '/mcp': {
                if (!options.auth) return true;
                try { options.auth.verifyAccessToken(h); return true; } catch { return false; }
            }
            case '/refresh': return egal(bearer, options.refreshSecret);
            case '/fintable-sync': return egal(bearer, options.fintableSyncSecret);
            case '/market-store': return egal(bearer, options.marketSecret);
            default: return false;
        }
    };

    const knownEndpoints = [
        '/mcp',
        '/health',
        ...(options.refreshSecret ? ['/refresh'] : []),
        ...(options.fintableSyncSecret ? ['/fintable-sync'] : []),
        ...(options.marketSecret ? ['/market-store'] : []),
    ];

    const server = createHttpServer((req, res) => {
        const url = (req.url ?? '/').split('?')[0];
        if (url === '/health') {
            sendJson(res, 200, { status: 'ok', version: MCP_SERVER_VERSION, sha: buildSha(), isDrive: state.isDrive });
            return;
        }
        const routeLimitee: LimitedRoute | null =
            url === '/mcp' || (url === '/refresh' && options.refreshSecret)
            || (url === '/fintable-sync' && options.fintableSyncSecret)
            || (url === '/market-store' && options.marketSecret)
                ? (url as LimitedRoute) : null;
        if (routeLimitee) {
            const entree = rateGuard.enter(routeLimitee, {
                authentifie: secretValide(routeLimitee, req),
                adresse: adresseClient(req.headers['x-forwarded-for'], req.socket.remoteAddress),
            });
            if (!entree.ok) {
                console.error(`[FinanceAI MCP http] ${routeLimitee} : 429 (${entree.reason === 'echecs' ? 'echecs authentification repetes' : 'plafond de debit'}).`);
                res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(entree.retryAfterSeconds), 'Cache-Control': 'no-store' });
                res.end(JSON.stringify({ error: 'Trop de requêtes.' }));
                return;
            }
            res.once('finish', () => entree.done(res.statusCode));
        }
        if (url === '/refresh' && options.refreshSecret) {
            handleRefresh(req, res, state.store, options.refreshSecret, options.finnhubKey);
            return;
        }
        if (url === '/fintable-sync' && options.fintableSyncSecret) {
            handleFintableSync(req, res, state.store, options.fintableSyncSecret, options.fintableToken, options.fintableRoles);
            return;
        }
        if (url === '/market-store' && options.marketSecret) {
            handleMarketStore(
                req, res, state.marche ?? null, options.marketSecret, options.eodhdKey, options.marketLive === true,
                options.marketLecteurs ?? ((cle) => creerLecteursReseau(cle)), options.marketMaintenant,
            );
            return;
        }
        if (options.autorisationBloquee && url === '/oauth/authorize') {
            console.error("[FinanceAI MCP http] /oauth/authorize : 503, clé d'accès non conforme (FINANCEAI_ACCESS_KEY_STRICT=1).");
            sendJson(res, 503, { error: 'server_error', error_description: "Clé d'accès non conforme : autorisation indisponible." });
            return;
        }
        if (options.auth && (url.startsWith('/oauth/') || url.startsWith('/.well-known/'))) {
            const auth = options.auth;
            handleOAuth(auth, authorizeLimiter, url, req, res)
                .then((handled) => {
                    if (!handled) sendJson(res, 404, { error: 'introuvable' });
                })
                .catch((err: unknown) => {
                    if (err instanceof OAuthError) {
                        sendJson(res, err.status, { error: err.code, error_description: err.message });
                    } else {
                        console.error('[FinanceAI MCP http] Erreur OAuth :', err);
                        if (!res.headersSent) sendJson(res, 500, { error: 'server_error' });
                        else res.end();
                    }
                });
            return;
        }
        if (url === '/mcp') {
            if (options.auth) {
                try {
                    options.auth.verifyAccessToken(req.headers.authorization);
                } catch (err) {
                    const metaUrl = options.auth.resourceMetadataUrl();
                    res.writeHead(401, {
                        'Content-Type': 'application/json',
                        'WWW-Authenticate': `Bearer resource_metadata="${metaUrl}"`,
                    });
                    res.end(JSON.stringify({
                        jsonrpc: '2.0', id: null,
                        error: { code: -32001, message: err instanceof OAuthError ? err.message : 'Authentification requise.' },
                    }));
                    return;
                }
            }
            handleMcp(req, res).catch((err: unknown) => {
                console.error('[FinanceAI MCP http] Erreur de requête :', err);
                if (!res.headersSent) {
                    if (err instanceof BodyTooLargeError) {
                        sendRpcError(res, 413, -32000, err.message);
                    } else {
                        sendRpcError(res, 500, -32603, 'Erreur interne du serveur MCP.');
                    }
                } else {
                    res.end();
                }
            });
            return;
        }
        sendJson(res, 404, { error: 'introuvable', endpoints: knownEndpoints });
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port, options.host, resolve);
    });
    const address = server.address();
    boundPort = typeof address === 'object' && address ? address.port : options.port;

    const close = async (): Promise<void> => {
        clearInterval(sweeper);
        await Promise.all([...sessions.keys()].map(closeSession));
        server.closeIdleConnections?.();
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                console.error(`[FinanceAI MCP http] Arrêt : connexions encore ouvertes après ${CLOSE_GRACE_MS} ms — fermeture forcée.`);
                server.closeAllConnections?.();
            }, CLOSE_GRACE_MS);
            timer.unref();
            server.close(() => {
                clearTimeout(timer);
                resolve();
            });
        });
    };

    return { server, port: boundPort, close };
}

const isDirectRun = process.argv[1]?.endsWith('http.ts') || process.argv[1]?.endsWith('http.js');

if (isDirectRun) {
    const main = async (): Promise<void> => {
        const cloudPort = process.env.PORT;
        const port = Number(cloudPort ?? process.env.MCP_HTTP_PORT ?? 8080);
        const host = process.env.MCP_HTTP_HOST ?? (cloudPort ? '0.0.0.0' : '127.0.0.1');
        const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';

        const signingKey = process.env.FINANCEAI_OAUTH_SIGNING_KEY;
        const accessKey = process.env.FINANCEAI_ACCESS_KEY;
        const publicUrl = process.env.FINANCEAI_PUBLIC_URL?.replace(/\/$/, '');
        let auth: OAuthProvider | undefined;
        const cleAcces = evaluerCleAcces(accessKey, process.env.FINANCEAI_ACCESS_KEY_STRICT);
        const alerteCle = alerteCleAcces(cleAcces);
        if (alerteCle) console.error(alerteCle);
        if (signingKey && accessKey) {
            auth = makeOAuthProvider({
                signingKey, accessKey,
                issuer: publicUrl ?? `http://127.0.0.1:${port}`,
            });
        } else if (signingKey || accessKey) {
            console.error('[FinanceAI MCP http] REFUS de démarrer : FINANCEAI_OAUTH_SIGNING_KEY et FINANCEAI_ACCESS_KEY vont ENSEMBLE (l’un sans l’autre = config incohérente).');
            process.exit(1);
        }
        if (auth && !isLoopback && !publicUrl) {
            console.error('[FinanceAI MCP http] REFUS de démarrer : FINANCEAI_PUBLIC_URL requis quand l’auth est active sur un hôte exposé.');
            process.exit(1);
        }

        const refreshSecret = process.env.FINANCEAI_REFRESH_SECRET;
        if (refreshSecret !== undefined && refreshSecret.length < 16) {
            console.error('[FinanceAI MCP http] REFUS de démarrer : FINANCEAI_REFRESH_SECRET trop court (< 16 caractères).');
            process.exit(1);
        }
        const finnhubKey = process.env.FINANCEAI_FINNHUB_KEY;

        const fintableSyncSecret = process.env.FINANCEAI_FINTABLE_SYNC_SECRET;
        if (fintableSyncSecret !== undefined && fintableSyncSecret.length < 16) {
            console.error('[FinanceAI MCP http] REFUS de démarrer : FINANCEAI_FINTABLE_SYNC_SECRET trop court (< 16 caractères).');
            process.exit(1);
        }

        const marketSecret = process.env.FINANCEAI_MARKET_SECRET;
        if (marketSecret !== undefined && marketSecret.length < 16) {
            console.error('[FinanceAI MCP http] REFUS de démarrer : FINANCEAI_MARKET_SECRET trop court (< 16 caractères).');
            process.exit(1);
        }
        const eodhdKey = process.env.FINANCEAI_EODHD_KEY;
        const marketLive = process.env.FINANCEAI_MARKET_LIVE === '1';

        const fintableToken = process.env.FINTABLE_TOKEN;
        let fintableRoles: FintableMappingConfig['roles'] | undefined;
        if (fintableSyncSecret) {
            const rawRoles = process.env.FINTABLE_ROLES_JSON;
            if (rawRoles) {
                try {
                    fintableRoles = parseRolesJson(rawRoles);
                } catch (err) {
                    console.error(
                        '[FinanceAI MCP http] REFUS de démarrer : FINTABLE_ROLES_JSON invalide —',
                        err instanceof Error ? err.message : String(err),
                    );
                    process.exit(1);
                }
            }
        }

        if (!isLoopback && !auth && process.env.MCP_HTTP_ALLOW_EXPOSED !== '1') {
            console.error(
                `[FinanceAI MCP http] REFUS de démarrer : hôte non-loopback (${host}) SANS authentification — ` +
                'tes données financières seraient lisibles ET modifiables par le réseau. Configure l’OAuth ' +
                '(FINANCEAI_OAUTH_SIGNING_KEY + FINANCEAI_ACCESS_KEY + FINANCEAI_PUBLIC_URL) ou, pour un test ' +
                'en connaissance de cause : MCP_HTTP_ALLOW_EXPOSED=1.',
            );
            process.exit(1);
        }

        const state = await resolveState(process.argv[2]);
        const running = await startHttpServer({
            port, host, state, dnsRebindingProtection: isLoopback, auth, refreshSecret, finnhubKey,
            fintableSyncSecret, fintableToken, fintableRoles, marketSecret, eodhdKey, marketLive,
            cleAccesFaible: cleAcces.faible, autorisationBloquee: cleAcces.refuser,
        });

        console.error(`[FinanceAI MCP http] v${MCP_SERVER_VERSION} — écoute http://${host}:${running.port}/mcp (santé : /health)`);
        console.error(`[FinanceAI MCP http] Source d'état : ${state.describe()}`);
        console.error(auth
            ? `[FinanceAI MCP http] Auth OAuth 2.1 ACTIVE (issuer : ${publicUrl ?? 'loopback'}) — /mcp exige un Bearer.`
            : '[FinanceAI MCP http] Auth DÉSACTIVÉE (variables OAuth absentes).');
        console.error(refreshSecret
            ? `[FinanceAI MCP http] Refresh planifié : POST /refresh ACTIF (Bearer exigé)${finnhubKey ? '' : ' — SANS clé Finnhub : seule la crypto sera rafraîchie'}.`
            : '[FinanceAI MCP http] Refresh planifié : /refresh désactivé (FINANCEAI_REFRESH_SECRET absent).');
        console.error(fintableSyncSecret
            ? `[FinanceAI MCP http] Sync Fintable planifiée : POST /fintable-sync ACTIF (Bearer exigé)${fintableToken ? '' : ' — SANS FINTABLE_TOKEN : chaque appel échouera 503'}${fintableRoles ? '' : ' — SANS rôles de comptes (FINTABLE_ROLES_JSON absent) : aucun compte ne sera reconnu'}.`
            : '[FinanceAI MCP http] Sync Fintable planifiée : /fintable-sync désactivé (FINANCEAI_FINTABLE_SYNC_SECRET absent).');
        console.error(marketSecret
            ? `[FinanceAI MCP http] Magasin de marché : POST /market-store ACTIF (Bearer exigé) — ${marketLive ? 'ÉCRITURE réelle' : 'ESSAI À BLANC (FINANCEAI_MARKET_LIVE absent)'}${eodhdKey ? '' : ' — SANS clé EODHD : chaque appel répondra 503'}.`
            : '[FinanceAI MCP http] Magasin de marché : /market-store désactivé (FINANCEAI_MARKET_SECRET absent).');
        if (isLoopback) {
            console.error('[FinanceAI MCP http] Mode LOCAL : loopback seulement, anti-DNS-rebinding actif.');
        } else if (!auth) {
            console.error(`[FinanceAI MCP http] ⚠️⚠️ EXPOSÉ sur ${host} SANS AUTHENTIFICATION — données financières accessibles au réseau. Réservé aux tests.`);
        }

        const shutdown = (signal: string): void => {
            console.error(`[FinanceAI MCP http] ${signal} reçu — arrêt propre…`);
            running.close().then(() => process.exit(0)).catch(() => process.exit(1));
        };
        process.on('SIGTERM', () => shutdown('SIGTERM')); // Cloud Run
        process.on('SIGINT', () => shutdown('SIGINT'));
    };

    main().catch((err) => {
        console.error('[FinanceAI MCP http] Erreur fatale :', err);
        process.exit(1);
    });
}
