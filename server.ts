import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { getWorkspaceBackupByUid, upsertWorkspaceBackup } from './src/db/users.ts';
import { verifyDatabaseConnection } from './services/db/sqlClient.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/sql/health', async (_req, res) => {
    try {
      const status = await verifyDatabaseConnection();
      res.status(status.ok ? 200 : 503).json({
        ok: status.ok,
        service: 'cloudsql-postgres',
        reachable: status.reachable,
        latencyMs: status.latencyMs,
      });
    } catch {
      res.status(503).json({ ok: false, service: 'cloudsql-postgres', reachable: false });
    }
  });

  app.get('/api/sql/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Utilisateur non authentifié' });
      }
      const backup = await getWorkspaceBackupByUid(uid);
      if (!backup) {
        return res.json({ exists: false, backup: null });
      }
      let parsedState: Record<string, unknown> | null = null;
      try {
        parsedState = JSON.parse(backup.stateJson) as Record<string, unknown>;
      } catch {
        parsedState = null;
      }
      return res.json({
        exists: true,
        backup: {
          uid: backup.uid,
          netWorthCad: backup.netWorthCad,
          transactionsCount: backup.transactionsCount,
          assetsCount: backup.assetsCount,
          debtsCount: backup.debtsCount,
          updatedAt: backup.updatedAt,
          statePayload: parsedState,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur Cloud SQL';
      console.error('Failed to fetch Cloud SQL workspace:', error);
      return res.status(500).json({ error: message });
    }
  });

  app.post('/api/sql/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ error: 'Utilisateur non authentifié' });
      }
      const email = req.user?.email || 'utilisateur@example.com';
      const displayName = typeof req.body?.displayName === 'string' ? req.body.displayName.slice(0, 120) : '';
      const statePayload = req.body?.statePayload;
      if (!statePayload || typeof statePayload !== 'object' || Array.isArray(statePayload)) {
        return res.status(400).json({ error: 'statePayload invalide' });
      }

      const cleanPayload = { ...(statePayload as Record<string, unknown>) };
      delete cleanPayload.apiKeys;

      const netWorthCad = Number.isFinite(Number(req.body?.netWorthCad))
        ? Math.round(Number(req.body.netWorthCad))
        : 0;
      const transactionsCount = Array.isArray(cleanPayload.transactions)
        ? cleanPayload.transactions.length
        : 0;
      const assetsCount = Array.isArray(cleanPayload.assets) ? cleanPayload.assets.length : 0;
      const debtsCount = Array.isArray(cleanPayload.debts) ? cleanPayload.debts.length : 0;

      const saved = await upsertWorkspaceBackup({
        uid,
        email,
        displayName,
        netWorthCad,
        transactionsCount,
        assetsCount,
        debtsCount,
        stateJson: JSON.stringify(cleanPayload),
      });

      return res.json({ ok: true, backup: saved });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Erreur Cloud SQL';
      console.error('Failed to save Cloud SQL workspace:', error);
      return res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    app.get('/@react-refresh-preamble.js', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(
        'import { injectIntoGlobalHook } from "/@react-refresh";\n' +
          'injectIntoGlobalHook(window);\n' +
          'window.$RefreshReg$ = () => {};\n' +
          'window.$RefreshSig$ = () => (type) => type;\n' +
          'window.__vite_plugin_react_preamble_installed__ = true;\n',
      );
    });
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.warn(`Server running on http://localhost:${PORT}`);
  });
}

void startServer();
