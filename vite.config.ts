import path from 'path';
import { execSync } from 'node:child_process';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// G22-F2 — version AUTO (plus de bump manuel). CalVer `AAAA.M.J` dérivée de la date
// de build : change à chaque déploiement, robuste même sur clone git shallow (Vercel)
// où un compteur de commits serait faux. `GIT_SHA` identifie le commit exact,
// `BUILD_DATE` (horodatage complet) trace l'instant du build.
const GIT_SHA = (() => {
    try {
        return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    } catch {
        return 'dev';
    }
})();
const _now = new Date();
const APP_VERSION = `${_now.getFullYear()}.${_now.getMonth() + 1}.${_now.getDate()}`;
const BUILD_DATE = _now.toISOString().slice(0, 16).replace('T', ' '); // 'AAAA-MM-JJ HH:MM' UTC

// [PORTFOLIO-HISTORY] Miroir LOCAL (dev + preview) du rewrite Vercel `/api/history/yahoo/:symbol` →
// query1.finance.yahoo.com (le repli d'historique passe par un proxy same-origin : CSP inchangée +
// pas de CORS). En prod c'est vercel.json qui fait ce travail. Partagé server/preview (source unique).
const yahooProxy = {
  '/api/history/yahoo': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/history\/yahoo/, '/v8/finance/chart'),
  },
  // [HIST-MULTI-PROVIDER] Recherche de titre par nom (diagnostic « Cours non synchronisés »).
  '/api/search/yahoo': {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/search\/yahoo/, '/v1/finance/search'),
  },
  // [FINTABLE-7] Sync Fintable DEPUIS LE NAVIGATEUR (décision 2026-07-30) : même patron same-origin
  // que Yahoo ci-dessus → `connect-src 'self'` couvre, AUCUN domaine ajouté à la CSP, pas de CORS.
  // Le jeton voyage dans l'en-tête `Authorization` que le proxy relaie tel quel ; il n'est jamais
  // dans l'URL (les URL finissent dans les logs — contrat explicite de `client.ts`).
  '/api/fintable': {
    target: 'https://fintable.io',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/fintable/, '/api/v2'),
  },
};

// [S5-REFONTE-PERF] Graphe STATIQUE de l'entrée (index.tsx) : les modules chargés au démarrage quoi
// qu'il arrive. Calculé une fois par build, au premier appel de `manualChunks`.
type InfoModule = { importedIds: readonly string[] } | null;
let grapheDemarrageCache: Set<string> | null = null;
function grapheDemarrage(getModuleInfo: (id: string) => InfoModule): Set<string> {
  if (grapheDemarrageCache) return grapheDemarrageCache;
  const entree = path.resolve(__dirname, 'index.tsx');
  const vus = new Set<string>();
  const pile = [entree];
  while (pile.length) {
    const id = pile.pop()!;
    if (vus.has(id)) continue;
    vus.add(id);
    for (const dep of getModuleInfo(id)?.importedIds ?? []) if (!vus.has(dep)) pile.push(dep);
  }
  grapheDemarrageCache = vus;
  return vus;
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: env.VITE_BASE_PATH || '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        proxy: yahooProxy,
      },
      // [HIST-PREVIEW-PROXY] `vite preview` a besoin du MÊME proxy que le dev server : sans lui, le
      // repli Yahoo tombe sur le fallback SPA (HTML → null honnête) → graphes vides en preview local.
      preview: {
        proxy: yahooProxy,
      },
      plugins: [react()],
      define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION),
        __GIT_SHA__: JSON.stringify(GIT_SHA),
        __BUILD_DATE__: JSON.stringify(BUILD_DATE),
      },
      optimizeDeps: {
        exclude: ['html2canvas'],
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        // Sprint 3 SH6 (sécurité) — `'hidden'` générait quand même les fichiers
        // .js.map déployés sur Vercel (accessibles publiquement à
        // domaine.com/assets/index-X.js.map → exposait tout le TS source).
        // `false` ne génère AUCUN sourcemap. Si on veut debug en prod, utiliser
        // un service de monitoring privé qui upload les sourcemaps séparément.
        sourcemap: false,
        chunkSizeWarningLimit: 800,
        // Phase 3E perf — désactive le polyfill modulepreload (économise ~2-4KB
        // sur le bundle initial). Tous les navigateurs modernes supportent
        // nativement modulepreload, le polyfill est inutile pour notre cible.
        modulePreload: { polyfill: false },
        rollupOptions: {
          // Vite 8 = Rolldown : `external` est une option de TOP-NIVEAU (plus sous `output`).
          external: ['html2canvas'],
          output: {
            // [S5-REFONTE-PERF] `codeSplitting` (API Rolldown) plutôt que `manualChunks` : les
            // groupes y ont une PRIORITÉ — React et recharts sont capturés AVANT le noyau, sans quoi
            // la capture récursive des dépendances du noyau y aspirait React (mesuré : un seul
            // chunk de 205 Ko gzip, React invalidé à chaque déploiement).
            codeSplitting: {
              groups: [
                { name: 'react-vendor', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/, priority: 3 },
                // [PERF-SDK-BOOT-PRELOAD] recharts n'est atteint que par des pages chargées à la
                // demande : son groupe reste hors du démarrage (vérifié sur dist/index.html).
                { name: 'recharts', test: /[\\/]node_modules[\\/](recharts|victory-vendor|d3-[^/]+|internmap)[\\/]/, priority: 2 },
                // Tout ce que l'entrée importe STATIQUEMENT (donc chargé au démarrage quoi qu'il
                // arrive) va dans UN chunk « noyau ».
                {
                  name: (id, ctx) => (!id.includes('node_modules/') && grapheDemarrage((m) => ctx.getModuleInfo(m)).has(id) ? 'noyau' : null),
                  priority: 1,
                },
              ],
            },
          },
        },
      },
    };
});
