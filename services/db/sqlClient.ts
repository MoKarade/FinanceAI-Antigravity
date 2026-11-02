import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from '../../src/db/schema.ts';

declare global {
    var _postgresPool: Pool | undefined;
}

export interface SqlConnectionConfig {
    host: string | undefined;
    user: string | undefined;
    password: string | undefined;
    database: string | undefined;
    max: number;
    connectionTimeoutMillis: number;
    idleTimeoutMillis: number;
    keepAlive: boolean;
}

export interface DatabaseConnectionVerificationResult {
    ok: boolean;
    reachable: boolean;
    hostConfigured: boolean;
    databaseConfigured: boolean;
    userConfigured: boolean;
    latencyMs: number;
    message: string;
}

/**
 * Construit la configuration du pool PostgreSQL Cloud SQL à partir des variables
 * d'environnement fournies par la plateforme (`SQL_HOST`, `SQL_USER`, `SQL_PASSWORD`, `SQL_DB_NAME`).
 */
export function getSqlConnectionConfig(
    env: Record<string, string | undefined> = typeof process !== 'undefined' && process.env
        ? process.env
        : {},
): SqlConnectionConfig {
    return {
        host: env.SQL_HOST?.trim() || undefined,
        user: env.SQL_USER?.trim() || undefined,
        password: env.SQL_PASSWORD || undefined,
        database: env.SQL_DB_NAME?.trim() || undefined,
        max: 10,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
    };
}

/**
 * Initialise ou récupère l'instance singleton du pool PostgreSQL Cloud SQL.
 * La connexion réelle est établie à la demande lors de l'exécution des requêtes.
 */
export function getSqlPool(): Pool {
    if (!globalThis._postgresPool) {
        const config = getSqlConnectionConfig();
        const poolConfig: PoolConfig = {
            host: config.host,
            user: config.user,
            password: config.password,
            database: config.database,
            max: config.max,
            connectionTimeoutMillis: config.connectionTimeoutMillis,
            idleTimeoutMillis: config.idleTimeoutMillis,
            keepAlive: config.keepAlive,
        };

        globalThis._postgresPool = new Pool(poolConfig);

        globalThis._postgresPool.on('error', (err: Error & { code?: string }) => {
            const msg = err?.message || '';
            if (
                msg.includes('Connection terminated unexpectedly') ||
                msg.includes('Connection terminated') ||
                err?.code === '57P01' ||
                err?.code === 'ECONNRESET' ||
                err?.code === 'ETIMEDOUT'
            ) {
                return;
            }
            console.warn('Avertissement sur un client SQL inactif du pool :', msg);
        });
    }
    return globalThis._postgresPool;
}

export const sqlPool = getSqlPool();

export const db = drizzle(sqlPool, { schema });

export interface VerifyDatabaseConnectionOptions {
    /** Sonde d'exécution injectable pour les tests unitaires. */
    queryProbe?: () => Promise<unknown>;
    /** Environnement injectable pour les tests unitaires. */
    env?: Record<string, string | undefined>;
}

/**
 * Vérifie à la demande l'état de la configuration et l'atteignabilité de l'instance Cloud SQL.
 */
export async function verifyDatabaseConnection(
    options: VerifyDatabaseConnectionOptions = {},
): Promise<DatabaseConnectionVerificationResult> {
    const startMs = Date.now();
    const config = getSqlConnectionConfig(options.env);
    const hostConfigured = Boolean(config.host);
    const databaseConfigured = Boolean(config.database);
    const userConfigured = Boolean(config.user);

    if (!options.queryProbe && (!hostConfigured || !databaseConfigured || !userConfigured)) {
        const missing: string[] = [];
        if (!hostConfigured) missing.push('SQL_HOST');
        if (!databaseConfigured) missing.push('SQL_DB_NAME');
        if (!userConfigured) missing.push('SQL_USER');
        const message = `[CloudSQLDiagnostic] Configuration SQL incomplète : ${missing.join(', ')}`;
        console.error(message);
        return {
            ok: false,
            reachable: false,
            hostConfigured,
            databaseConfigured,
            userConfigured,
            latencyMs: Math.max(0, Date.now() - startMs),
            message,
        };
    }

    try {
        if (options.queryProbe) {
            await options.queryProbe();
        } else {
            await db.select({ id: schema.users.id }).from(schema.users).limit(1);
        }
        const latencyMs = Math.max(0, Date.now() - startMs);
        const message = `[CloudSQLDiagnostic] Connexion Cloud SQL vérifiée avec succès (${config.database ?? 'base active'} en ${latencyMs} ms).`;
        // eslint-disable-next-line no-console
        console.info(message);
        return {
            ok: true,
            reachable: true,
            hostConfigured: true,
            databaseConfigured: true,
            userConfigured: true,
            latencyMs,
            message,
        };
    } catch (error) {
        const latencyMs = Math.max(0, Date.now() - startMs);
        const detail = error instanceof Error ? error.message : String(error);
        const message = `[CloudSQLDiagnostic] Instance Cloud SQL injoignable : ${detail}`;
        console.error(message);
        return {
            ok: false,
            reachable: false,
            hostConfigured,
            databaseConfigured,
            userConfigured,
            latencyMs,
            message,
        };
    }
}
