import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as dotenv from 'dotenv';
import { proxyFintable, proxyYahooHistorique, proxyYahooRecherche } from './server/proxies';
import { registerValoriaRoutes } from './services/valoria/serverRoutes';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function mountWebProxy(
  app: express.Express,
  route: string,
  handler: (request: Request) => Promise<Response>,
  port: number,
): void {
  app.all(route, async (req, res, next) => {
    try {
      const ac = new AbortController();
      res.on('close', () => {
        if (!res.writableEnded) ac.abort();
      });
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (typeof val === 'string') headers.set(key, val);
        else if (Array.isArray(val)) headers.set(key, val.join(', '));
      }
      if (!headers.has('x-forwarded-for') && req.ip) {
        headers.set('x-forwarded-for', req.ip);
      }
      const webReq = new Request(`http://localhost:${port}${req.originalUrl}`, {
        method: req.method,
        headers,
        signal: ac.signal,
      });
      const upstream = await handler(webReq);
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      res.send(body);
    } catch (err) {
      next(err);
    }
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });
  app.use('/api/financeai', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/sante', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });

  registerValoriaRoutes(app);

  // Relais Fintable & Yahoo Finance actifs en dev ET en production locale (évite que le fallback SPA ne renvoie HTML).
  mountWebProxy(app, '/api/fintable/*splat', proxyFintable, PORT);
  mountWebProxy(app, '/api/history/yahoo/*splat', proxyYahooHistorique, PORT);
  mountWebProxy(app, '/api/search/yahoo', proxyYahooRecherche, PORT);
  app.use('/api', (_req, res) => {
    res.status(404).setHeader('Cache-Control', 'no-store').json({
      error: { type: 'not_found', message: 'Route API introuvable.' },
    });
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
    app.use('/assets', (_req, res) => {
      res.status(404).setHeader('Cache-Control', 'no-store').type('text/plain').send('Chunk introuvable');
    });
    app.get('*all', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.warn(`Server running on http://localhost:${PORT}`);
  });
}

void startServer();
