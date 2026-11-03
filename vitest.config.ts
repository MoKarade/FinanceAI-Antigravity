import { defineConfig } from 'vitest/config';
import { FICHIERS_TS_JSDOM } from './tests/environnementJsdom.ts';

// Deux projets Vitest, un par environnement (refonte de la suite, 2026-11-03).
// Historique : vitest ^4 a retiré `environmentMatchGlobs` ; on était passé à « jsdom partout ».
// Mesure du 2026-11-02 : 64 % des 22 min 30 s de `npm run test` servaient à recréer jsdom à chaque
// fichier, alors que la majorité des fichiers (moteur, fiscalité, gardes) n'en a pas besoin.
// Règle (voir `tests/README.md`) :
//   - `*.test.tsx` → jsdom (rendu React) ;
//   - `*.test.ts`  → node, sauf ceux listés dans `tests/environnementJsdom.ts` (localStorage, window…) ;
//   - un commentaire `@vitest-environment jsdom|node` en tête de fichier l'emporte toujours.

// NB : `include` et `setupFiles` vivent dans chaque projet, PAS ici — avec `extends: true`, Vitest
// CONCATÈNE les tableaux hérités, et chaque fichier tournait deux fois (une fois par environnement).
const partage = {
  // Restaure les globaux stubés (vi.stubGlobal) AVANT chaque test → empêche la pollution
  // inter-fichiers (audit projection-validator 2026-06 : `finance.test.ts` stubbe `fetch`
  // sans le nettoyer → flake ~1/3 sur des tests purs selon l'ordre d'exécution). Filet global,
  // rend le gate/CI déterministe sans dépendre du nettoyage manuel de chaque fichier.
  unstubGlobals: true,
  // Fichiers EN PARALLÈLE (défaut Vitest, un fil par cœur) depuis la refonte du 2026-11-03.
  // Historique : `fileParallelism: false` avait été posé parce que des tests sensibles au timing
  // (événements de vie stochastiques W3.x, personas générés via `new Date()` sur 24 mois) échouaient
  // ~50 % du temps sous forte contention. Le vrai bug que ce flou cachait (RQAP fantôme parent seul)
  // a été corrigé depuis ; la suite complète repassée plusieurs fois en parallèle le 2026-11-03 est
  // restée verte. Si un test redevient intermittent : le corriger (horloge figée, graine fixe),
  // ou en dernier recours `npx vitest run --no-file-parallelism` pour confirmer le diagnostic.
  // Délai par test relevé à 30 s : sous contention, les gardes qui scannent tout le dépôt
  // (ex. `storageKeysRegistreGuard`, ~2,4 s seule) dépassaient les 5 s par défaut. Un délai
  // n'est pas une assertion : rien n'est affaibli, on cesse seulement de couper un test lent.
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  // Phase A.4 — les constantes globales définies dans vite.config.ts (build)
  // doivent aussi exister en environnement de test sinon ReferenceError.
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __GIT_SHA__: JSON.stringify('test'),
    __BUILD_DATE__: JSON.stringify('1970-01-01'),
  },
  test: {
    ...partage,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          setupFiles: ['./tests/setup.ts'],
          exclude: [...FICHIERS_TS_JSDOM, 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/**/*.test.tsx', ...FICHIERS_TS_JSDOM],
          setupFiles: ['./tests/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['services/**/*.ts', 'utils/**/*.ts', 'hooks/**/*.ts'],
      exclude: [
        'services/test*.ts',
        'services/*.worker.ts',
        'node_modules/**',
      ],
    },
  },
});
