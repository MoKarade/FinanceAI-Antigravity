import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
      keepAlive: true,
    });

    global._postgresPool.on('error', (err: Error & { code?: string }) => {
      const msg = err?.message || '';
      if (
        msg.includes('Connection terminated unexpectedly') ||
        msg.includes('Connection terminated') ||
        err?.code === '57P01' ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT'
      ) {
        // Fermeture normale d'un client SQL inactif (scale-to-zero Cloud SQL) : le pool recrée la connexion à la demande.
        return;
      }
      console.warn('Avertissement sur un client SQL inactif du pool :', msg);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
