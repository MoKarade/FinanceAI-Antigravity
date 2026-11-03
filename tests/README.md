# Tests — mode d'emploi

Vitest 5, deux **projets** déclarés dans `vitest.config.ts` (un par environnement). Les fichiers
tournent en parallèle (un fil par cœur). `npm run test` lance tout ; c'est la seule commande de la gate.

## Arborescence

| Dossier | Contenu |
|---|---|
| `tests/components/` | Rendu des écrans et composants React (`*.test.tsx`), sous-dossiers par domaine |
| `tests/hooks/` | Hooks React |
| `tests/services/` | Moteur de projection, fiscalité, synchronisation, Gemini… (calcul pur, en majorité) |
| `tests/store/` | Store Zustand : persistance, migrations, hydratation |
| `tests/utils/` | Fonctions utilitaires |
| `tests/guards/` | **Gardes et cliquets** : scans du dépôt qui empêchent une régression de revenir. Ne jamais affaiblir |
| `tests/a11y/` | Accessibilité (axe, piège de focus) |
| `tests/aiTools/`, `tests/mcp/`, `tests/api/` | Outils IA, serveur MCP, routes `api/` |
| `tests/helpers/` | Aides partagées (pas de tests ici) |
| `tests/fixtures/` | Données fictives figées (JSON) |

Un test à la racine de `tests/` est accepté pour l'existant ; un nouveau test va dans le dossier du code qu'il couvre.

## Quel environnement ?

- `*.test.tsx` → **jsdom** (rendu React, `document`, `localStorage`).
- `*.test.ts` → **node** (plus rapide : pas de faux navigateur à monter).
- Un `.ts` qui a besoin du navigateur (`localStorage`, `window`, `FileReader`, store persistant…) :
  ajouter en **première ligne** `// @vitest-environment jsdom`. Ce commentaire l'emporte toujours.
- `tests/environnementJsdom.ts` liste les `.ts` existants qui exigent jsdom (mesuré le 2026-11-03).
  Ne pas l'allonger : préférer le commentaire ci-dessus.

Symptôme d'un mauvais environnement : `ReferenceError: localStorage is not defined` (ou `document`, `window`).

## Aides partagées (`tests/helpers/`)

| Aide | Rôle |
|---|---|
| `etatFictif.ts` | `etatFictif(surcharges)` : `AppState` complet et neuf, sans aucune donnée personnelle |
| `storeFictif.ts` | `reinitialiserStore()`, `etatInitialStore()`, `renduAvecStore(ui, surcharges)` pour les composants branchés sur `useFinanceStore` |
| `fauxRecharts.ts` | Fausse version de `recharts` : `vi.mock('recharts', async () => (await import('…/helpers/fauxRecharts')).fauxRecharts())` |
| `source.ts`, `toPosix.ts` | Lecture de source décommentée et chemins `/` pour les gardes qui scannent le dépôt |
| `donneesPerso.ts` | Fonctions du verrou « aucune donnée personnelle dans le dépôt » |
| `menageProprietaire.ts`, `futureSource.ts`, `panneauJour.tsx` | Fixtures et lecteurs propres à certains écrans |

Gemini : les tests remplacent la fonction précise de `services/gemini` qu'ils exercent
(`vi.mock('../../services/gemini', () => ({ analyzePayslip: vi.fn() }))`) — aucun motif recopié à factoriser.
Firestore : aucune fausse version partagée pour l'instant ; la créer ici (`fauxFirestore.ts`) au
premier besoin plutôt que dans un test.

## Règles

- Données **fictives** seulement (dépôt public) : jamais de montant, nom, adresse ou symbole réel.
- Jamais `skip`, `only`, `todo`, ni seuil relâché pour faire passer un test. Un test lent se corrige, il ne se coupe pas.
- Un test sensible à l'heure fige l'horloge (`vi.useFakeTimers()` / `vi.setSystemTime`) : la suite tourne en parallèle.
- Un global remplacé par `vi.stubGlobal` est restauré automatiquement (`unstubGlobals: true`).

## Commandes

- `npm run test` — toute la suite (gate obligatoire avant commit).
- `npm run test:rapide` — boucle locale : uniquement le projet `node` (moteur, fiscalité, gardes), sans rendu React. Ne remplace jamais la gate.
- `npx vitest run tests/services/tax.test.ts` — un fichier.
- `npx vitest run --project jsdom` — seulement les tests de rendu.
