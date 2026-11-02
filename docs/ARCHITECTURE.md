# FinanceAI — Architecture (audit & métriques 2026-08-12)

> Vue d'ensemble destinée aux nouveaux contributeurs (humains ou agents).
> Pour le détail du moteur de projection, voir [PROJECTION.md](PROJECTION.md).
> Pour les wirings inter-onglets, voir [WIRING_NOTES.md](WIRING_NOTES.md).
> Pour la flotte d'agents de revue et le workflow, voir [agents.md](agents.md) + [workflow.md](workflow.md).
> Pour les décisions d'architecture (ADR), voir [`docs/adr/`](adr/).

---

## 1. Stack technique

| Couche | Technologie | Notes |
|---|---|---|
| UI | React 19 + TypeScript (strict) | `"strict": true` (depuis le 17/10/2026, FinanceAI#1198) ; `noImplicitAny`, `strictNullChecks`, `useUnknownInCatchVariables` restent écrits en clair |
| Bundler | Vite 8 (Rolldown) | esbuild en dev, Rollup pour le bundle prod, source-maps activées |
| Styling | Tailwind CSS + index.css | Design System **Google Finance** (Material 3, couleurs sémantiques, Google Sans / Roboto Mono) |
| State | Zustand 5 + `persist` middleware | Schema versionné (v1 → v7), migrations en code |
| Charts | Recharts 3 | Bundle dédié `recharts-*.js`, lazy-chargé |
| IA | `@google/genai` (`services/gemini.ts`) | **Google Gemini** (`gemini-2.5-flash` et `gemini-2.5-pro`) |
| Storage sécurisé | AES-256-GCM IndexedDB | services/secureKeyStore.ts (clé device non-extractible) |
| Import données | CSV universel + Finnhub + CoinGecko | parseBankCsv.ts (100% local) |
| Crypto pricing | CoinGecko REST | Gratuit, sans clé, CORS-friendly |
| Stock/ETF pricing | Finnhub REST | Clé gratuite optionnelle |
| Tests | Vitest + React Testing Library | compte à jour dans `GEMINI.md` (source unique) |
| Auth & Sync Cloud | **Firebase Auth** + **Cloud Firestore** + **Google Drive** | Google Sign-In, `users/{uid}/workspaces/main`, `appDataFolder` chiffré |
| Hébergement | **Firebase Hosting** (`firebase.json`, `.github/workflows/deploy-hosting.yml`) | Déploiement continu OIDC sur chaque push vers `main` |

L'application fonctionne à 100 % côté navigateur dans l'écosystème Google, persiste localement via `persist`
(chiffré en AES-256-GCM dans IndexedDB pour les clés API `apiKeys.gemini` et `apiKeys.finnhub`), synchronise
les espaces de travail via **Cloud Firestore** (`services/firebase/workspaceSync.ts`) et **Google Drive**
(`appDataFolder`), et appelle **Google Gemini** (`@google/genai`), Finnhub et CoinGecko depuis le client.

---

## 2. Topologie du code

```
FinanceAI/
├── App.tsx                  Point d'entrée React (Layout + TabRouter)
├── components/              UI React, 1 composant ≈ 1 onglet/page
│   ├── ui/                  Primitives (Button, Card, KPIStat, …)
│   ├── projection/          Sous-composants FutureProjection
│   ├── dashboard/           sous-composants Dashboard
│   ├── investments/         DividendPanel
│   ├── budget/              BudgetGroupTable, BudgetAiModal
│   ├── realestate/          PropertyConfigurator, MultiPropertyComparison
│   ├── settings/            BackupPanel, ImportBankStatement
│   └── retirement/          AssetLocationCard, GoalSeekerCard
├── services/                Logique métier pure (testable, sans React)
│   ├── projection.ts        Orchestrateur (2 806 lignes, mesuré 2026-09-07)
│   ├── projection/          57 sous-modules (split Phase 3, mesuré 2026-09-07)
│   ├── projection.worker.ts Worker MC
│   ├── gemini.ts            Wrapper Google Gemini SDK (@google/genai)
│   ├── geminiAssistant.ts   Orchestrateur conversationnel et analytique Gemini
│   ├── firebase/            Firebase Auth + Cloud Firestore (firebaseClient, firestoreService, workspaceSync)
│   ├── secureKeyStore.ts    AES-256-GCM + IndexedDB (clé device)
│   ├── tax.ts               Calcul impôt QC/Fed
│   ├── import/              parseBankCsv.ts (CSV universel)
│   ├── marketData/          providers/ coingecko.ts, finnhub.ts (pricing)
│   ├── portfolio.ts         Historique CSV portfolio
│   ├── realEstate.ts        Amortissement hypothèque
│   └── …                    finance, macroApi, pdfReport, cloudBackup
├── store/
│   └── useFinanceStore.ts   Zustand store unique (schema v7, persist)
├── utils/
│   ├── tax.ts               Constantes fiscales (paliers, plafonds)
│   ├── safeNumber.ts        Helper anti-NaN
│   ├── useDebouncedMemo.ts  Hook debounce + memoize
│   ├── useDerivedFinancials.ts Calculs dérivés réutilisables
│   ├── usePendingFocus.ts   Hook deep-link cross-tab (Phase B2)
│   └── transactionParser.ts CSV parser
├── tests/                   Vitest specs
└── docs/                    Plans, audits, architecture
```

Règles structurelles :
- **`services/`** ne **JAMAIS** importer de `components/`. Sens unique
  (`components/ → services/`).
- **`services/projection/*.ts`** ne **JAMAIS** importer de `services/projection.ts`
  (sinon import circulaire). Les types partagés vivent dans
  `services/projection/types.ts`.
- **Composants UI** ne **JAMAIS** appeler une API tierce directement —
  passer par un service.
- **Frontière store ↔ services** (`[SVC-STORE-COUPLING]`, 2026-09-04, mis à jour 2026-11-02) : le **moteur**
  (`services/projection.ts`, `services/projection/`, `projection.worker.ts`) est **PUR** — zéro
  import du store, tout entre par arguments (c'est ce qui rend chaque calcul testable par
  fixture). Les services d'**orchestration/IO** (sync Cloud Firestore, sync Google Drive, sync Fintable,
  restauration de données, outils IA Gemini/MCP, rapport PDF) LISENT le store via `useFinanceStore.getState()` —
  c'est assumé et **inventorié** dans `tests/services/storeCouplingBoundary.test.ts`.
  Liste exacte des services autorisés à coupler au store :
  - `services/aiTools/appStateProvider.ts` (lecture de l'état pour les outils IA / MCP)
  - `services/aiTools/writeExecutor.ts` (application des écritures confirmées sur le store)
  - `services/gemini.ts` (`[SANDBOX-PROMPTS-MARQUER-CONTEXTE]` : lit `modeDonneesFictives()` au point de contact SDK `@google/genai` pour marquer le prompt système quand les données sont un scénario hypothétique)
  - `services/dataRecovery.ts` (diagnostic et récupération locale/infonuagique des données)
  - `services/fintable/autoSync.ts` (synchronisation automatique courtier)
  - `services/firebase/workspaceSync.ts` (synchronisation temps réel avec Cloud Firestore `users/{uid}/workspaces/main`)
  - `services/pdfReport.ts` (génération du bilan PDF)
  - `services/sync/syncPull.ts`, `services/sync/syncPush.ts`, `services/sync/syncSnapshot.ts` (synchronisation Google Drive `appDataFolder`)
  Tout nouvel importeur du store dans `services/` est une décision d'architecture (à documenter ici, puis à ajouter à l'inventaire).
  ⚠️ Jamais de `getState() as unknown as …` : `FinanceState extends AppState`, l'assignation
  directe est déjà typée — un cast désactive tsc exactement là où l'IA écrit (garde dédiée).

---

## 3. Modèle de données (store unique)

`store/useFinanceStore.ts` expose **un seul state global** persisté en
`localStorage` :

```ts
{
  config: BudgetConfig;          // utilisateurs, devises, locale
  apiKeys: {                     // chiffrées en IndexedDB (AES-256-GCM) hors persist localStorage
    gemini: string;
    finnhub: string;
  };
  assets: Asset[];
  budgetItems: BudgetCategory[];
  initialBalances: Record<string, number>;
  realEstateGoals, childGoals, travelGoals, lifeEvents, financialGoals,
  debts, retirementGoal, projection, …
  // Wirings W5.x
  insurancePolicies, vehicleReplacements, majorRenovations,
  charitableGoals, rentalProperties, privateBusinesses,
  // Bridge cross-tabs
  lastProjection: ProjectionResult | null;  // exclu de persist
  pendingFocus: PendingFocus | null;
}
```

### Migrations
- **v1 → v3** : structuration initiale de `apiKeys` (clés API isolées du `localStorage` en IndexedDB chiffré)
- **v3 → v4** : ajout `apiKeys.finnhub` (Phase 7.F.5)
- **v4 → v5** : ajout `retirementGoal.lifeExpectancy` (default 90, Phase C.3)
- **v5 → v6** : conversion `dateBought + buyPrice + quantity` → `purchases[]` DCA multi-achat (Phase E.8)
- **v6 → v7** : le mode test n'est plus persisté (bug 2026-05-29 : l'auto-push Drive envoyait les fixtures de test dans le Drive de l'utilisateur) ; `apiKeys.gemini` est la clé IA unique de l'architecture 100 % Google (`[FULL-GOOGLE-MIGRATION]`)

### Onglets (Tab enum, 18 entries)

Argent : DASHBOARD, TRANSACTIONS, BUDGET, PLANNING, DEBT
Investissement : INVESTMENTS
Plan futur : FUTURE, RETIREMENT
Objectifs : REAL_ESTATE, CHILD, LIFE_PROJECTS (fusion de TRAVEL + LIFE_EVENTS depuis Phase F.12 — les 2 enums anciens forwardent)
Outils : TAX, DOCUMENTS (Phase G.1), DEBT, PLANNING
Système : DATA, SETTINGS (label "Configuration"), SYSTEM, ASSISTANT

### Cross-tab data flow
1. `FutureProjection.tsx` calcule la projection et écrit dans `lastProjection`.
2. Les autres onglets lisent `lastProjection` via `useFinanceStore(s => s.lastProjection)`.
3. Si `lastProjection === null`, chaque consumer fallback sur un calcul local
   simplifié (l'utilisateur n'a pas encore ouvert l'onglet Future dans la
   session).
4. Les badges 🔗 utilisent `navigateWithFocus(tab, section)` qui pose un
   `pendingFocus` consommé au mount du tab cible.

---

## 4. Le moteur de projection (vue topologique)

```
calculateFutureProjection(params)
  │
  ├─ Itère SCENARIO_DEFINITIONS[]                   ← 7 scénarios (Phase 4 #4)
  │    pour chacun :
  │      runScenario(params, strategy, …, stratType)
  │        ├─ setupSimulation.ts                    helpers initialisation
  │        ├─ pour m = 0 .. years*12:
  │        │    └─ 9 phases mensuelles (cf PROJECTION.md §2)
  │        │       ├─ Phase 1: Croissance + chocs
  │        │       ├─ Phase 2: Income + retraite
  │        │       ├─ Phase 3: Évolution immo
  │        │       ├─ Phase 4: Événements stochastiques
  │        │       ├─ Phase 5: Surcoûts conjoncturels
  │        │       ├─ Phase 6: Cash-flow allocation
  │        │       ├─ Phase 7: Impôts mensuels (janvier/avril/décembre)
  │        │       ├─ Phase 8: Latent tax
  │        │       └─ Phase 9: Output mensuel
  │        └─ Retourne ProjectionResult (chartData + métriques)
  │
  ├─ Si runMC=true sur scénario sélectionné :
  │    runMonteCarlo(params, scenarioIdx, 100 iter.)
  │      ├─ Bandes percentiles P10/P50/P90
  │      ├─ Taux de succès (% non zéro à la fin)
  │      ├─ FVI : Indice Vitalité Financière (split 30/30/20/20)
  │      └─ Sequence Risk Metric
  │
  └─ Retourne ProjectionResult avec allResults: ProjectionResult[]
```

Pour les MC longs (3s+ en mode 30 ans × 100 itér.), un **Worker** dédié
(`services/projection.worker.ts`) libère le main thread. Le wrapper
`runProjectionAsync` (`services/projection/runAsync.ts`) gère le cycle de
vie du worker (création, terminaison, replay).

---

## 5. Sourcing des données — pipeline uniformisé

```
Transactions bancaires
  ├─ Import CSV (parseBankCsv.ts) — 100% local, universel
  └─► Zustand + localStorage (chiffré AES-256)

Crypto prices (BTC, ETH, SOL, …)
  ├─ CoinGecko (services/marketData/providers/coingecko.ts)
  ├─ Gratuit, sans clé, CORS-friendly
  └─► Portfolio + Investissements

Stock/ETF prices (AAPL, VOO, …)
  ├─ Finnhub (services/marketData/providers/finnhub.ts)
  ├─ Clé gratuite optionnelle
  └─► Portfolio + Investissements

API keys (Google Gemini, Finnhub)
  ├─ Chiffrées AES-256-GCM (services/secureKeyStore.ts)
  ├─ Clé device IndexedDB (non-extractible)
  └─► Zustand (en mémoire) + IndexedDB chiffré (exclues de localStorage, Firestore et Drive)

Historique de portefeuille / Courbes de cours
  ├─ **Chaîne multi-providers** : 
  │    Finnhub (stock/ETF US) → fallback Yahoo Finance (Euronext/CAD via proxy rewrite Vercel)
  │    + CoinGecko (crypto) + CSV legacy importé
  ├─ Pipeline hydratation :
  │    hydrateAssetHistories (boot, pacing 2,5s) 
  │      → `getHistory(symbol, asset.currency)` par titre + devise
  │      → resolve variantes suffixes (Asset.historySymbol, ex. ABC.TO vs ABC)
  │      → **HistorySyncDoctor** : diagnostic par titre (symbole cotation inline, recherche
  │         `/api/search/yahoo` par NOM de titre sans historique, interface UI Investissements)
  │      → stocké IDB + cache 24h (contrat : [] = vide valide cacheable ; null = erreur jamais cachée)
  │      → buildMarketData (pur, colonnes AGRÉGÉES multi-comptes, TOTAL + repli valeur actuelle)
  ├─ Quotes fraîches :
  │    Bouton « Actualiser les cours » = purge cache history + hydratation forcée
  │    + quotes en temps réel via `priceRefresh` (Finnhub brut ou Yahoo chart `meta.regularMarketPrice`)
  ├─ Repli no-fake-data : titres sans historique → valeur actuelle signalée
  │    (`noHistorySymbols` + HistoryCoverageNote sur Investissements / Futur)
  ├─ Persistance : Asset.historySymbol (additif, par titre) pour resolver variantes durables
  └─► Investissements (piles, chips TOTAL), Futur (poids/gains + historique)

Classification des actifs — Répartitions géo/secteur
  ├─ **Champs additifs optionnels** : Asset.sector, Asset.region (zéro migration)
  ├─ **resolveAssetMeta** (`services/assetMeta.ts`) — pipeline de classification :
  │    1. Champs éditables inline (secteur/région saisis manuellement)
  │    2. Seed normalisé (lookups ASSET_META : normalisation champ > suffixe/préfixe)
  │    3. Fallback crypto : `isCryptocurrency()` → « Crypto »
  │    4. Défaut : « Autre »
  ├─ **assetProfileSync** (`services/assetProfileSync.ts`) — auto-remplissage au boot :
  │    hydrateAssetProfiles() appelle Finnhub `company()` (/company/profile) pour les assets
  │    SANS secteur/région → remplit les champs (Finnhub renvoie sector, industry, …)
  │    Repli gracieux si provider indisponible → reste « Autre »
  ├─ Sélecteurs éditables : **Investissements → Allocation → Région/Secteur** (inline, sauvegardes immédiates)
  └─► Donuts (Investissements) — répartitions visualisées par région (geo-pie) et secteur (sector-pie)
```

## 6. IA — pipeline Google Gemini

```
User input / Analyses ──► services/gemini.ts (@google/genai)
                             │
                             ├─► gemini-2.5-flash (chat rapide, catégorisation, vision, conseils ciblés)
                             └─► gemini-2.5-pro   (analyses approfondies, stratégies complexes)
```

Dans l'architecture **100 % Google** (`[FULL-GOOGLE-MIGRATION]`, 2026-11-02), toutes les fonctionnalités d'intelligence
artificielle passent par **Google Gemini** (`services/gemini.ts` et `services/geminiAssistant.ts` via le SDK officiel
`@google/genai`). Les appels utilisent la clé `apiKeys.gemini` de l'utilisateur (stockée en IndexedDB chiffré) et
marquent automatiquement le prompt système lorsque le mode données fictives est actif (`modeDonneesFictives()`).

**Séparation des modèles Google Gemini** (`services/aiChat/models.ts` et `services/aiChat/reglages.ts`) :
- `gemini-2.5-flash` — analyses budget, suggestions Planning, catégorisation batch transactions (volume + vitesse), vision fiches de paie et relevés bancaires, justifications rééquilibrage, optimisation fiscale couple, conseils Immobilier
- `gemini-2.5-pro` — analyses financières approfondies et raisonnement multi-étapes

**Services IA exposés** (`services/gemini.ts`, tous avec clé utilisateur `apiKeys.gemini`) :
- `chat()` / `chatStream()` — one-shot et streaming Gemini
- `categorizeBatch()` — catégorisation transactions par lot (`gemini-2.5-flash`)
- `analyzePayslip()` / `analyzeBankStatement()` — **Gemini Vision** sur fiches de paie et relevés bancaires PDF/images
- `detectSubscriptionsAI()` — détection abonnements récurrents (`gemini-2.5-flash`)
- `computeFinancialSignals` (`mcp/financialSignals.ts`, pur, partagé avec le serveur MCP) — signaux financiers déterministes
- `getRebalanceJustifications()` — Phase E.7, justifications de rééquilibrage Investments (`gemini-2.5-flash`)
- `getCoupleOptimizationStrategies()` — Phase G.4, REER de conjoint / fractionnement de pension (`gemini-2.5-flash`)
- `getRealEstateAdvice()` — Phase F.8, 5 catégories cost/timing/leverage/tax/risk (`gemini-2.5-flash`)

**Frontière spec/register des tools MCP** (ADR-1) :
chaque tool est scindé en `mcp/tools/<x>.spec.ts` (logique métier PURE, browser-safe : nom,
description, schéma zod, handler/toDocument — types dans `_toolSpec.ts`) et `mcp/tools/<x>.tool.ts`
(enregistrement serveur MINCE, seul autorisé à importer `@modelcontextprotocol/sdk`). Le
consommateur des specs est le serveur MCP (`server.tool(...)`). Exclus de la parité :
`ping` (trivial) et `connect_drive` (OAuth loopback Node, sans équivalent dans l'app).
Gardes : `tests/aiTools/noMcpSdkInSpecs.test.ts` (frontière + tools minces, volume prouvé) ;
parité mesurée par capture d'enregistrement (16 tools identiques).

---

## 7. Tests

```
tests/
├── components/
│   ├── ui/                Tests des primitives (Button, Modal, KPIStat, …)
│   ├── future/            Tests du Futur (FutureHistorySection remplace Dashboard)
│   ├── Budget.test.tsx
│   ├── GuideModal.test.tsx
│   └── Settings.test.tsx
├── services/
│   ├── projection.test.ts          (47 tests scénarios)
│   ├── projection.helpers.test.ts  (28 tests helpers purs)
│   ├── tax.test.ts
│   └── …
└── store/
    └── useFinanceStore.test.ts
```

**Compte de tests : voir `GEMINI.md`** — source unique, re-mesurée à chaque push. Ne pas le
recopier ici : ce document a porté trois chiffres contradictoires (1 440 / 3 887 / 339 fichiers)
avant le nettoyage du 2026-08-19. Tous les scénarios MC, les helpers de projection, les primitives UI, les migrations de store, la fiscalité (dont `taxDecember`/`taxJanuary`) et les moteurs de synchronisation Cloud Firestore et Google Drive sont couverts.

---

## 8. Décisions clés (voir aussi `docs/adr/`)

La liste à jour et les titres exacts sont dans [`docs/adr/README.md`](adr/README.md) (numérotation 0001 et suivantes ; une ADR est un récit daté qui ne se réécrit pas). Ne pas recopier la liste ici : l'ancienne numérotation « ADR-001…009 » de ce paragraphe ne correspondait plus aux fichiers.

Couches serveur et infonuagiques, en plus du client : **Firebase Auth** + **Cloud Firestore** (`firestore.rules` strictes par propriétaire `request.auth.uid == userId`), **Google Drive** (`appDataFolder`), `api/` (fonctions serverless Vercel : proxys Yahoo Finance et Fintable, santé) et `mcp/` (serveur MCP sur Google Cloud Run).
Suivi des erreurs (FinanceAI#1171, 18/10/2026) : les fonctions `api/` signalent leurs exceptions imprévues à Sentry (`api/_lib/sentry.ts`, projet `financeai`, organisation `mokarade`) quand la variable serveur `SENTRY_DSN` est définie ; sans elle rien ne part et le SDK n'est pas chargé. Aucune donnée perso : ni requête (le symbole est dans l'adresse), ni IP, ni message d'erreur (`api/_lib/sentryConfig.ts`, verrou `tests/api/sentryConfig.test.ts`). Le navigateur et le serveur MCP (Cloud Run) n'envoient RIEN pour l'instant. Preuve de la chaîne : workflow manuel « Essai Sentry » (`npm run sentry:essai`).

---

## 9. Workflow contributeur

```bash
npm install
npm run dev        # localhost:3000
npm run typecheck  # tsc --noEmit, doit rester clean
npm test           # vitest, doit rester vert (compte dans GEMINI.md)
npm run build      # vérifie le bundle prod (vite build --mode production)
```

Toutes les PR doivent passer **typecheck + lint + tests + build**. Le pipeline CI
(`.github/workflows/`) tourne automatiquement à chaque push.

---

## 10. Pour aller plus loin

- [../HANDOVER.md](../HANDOVER.md) — état courant + reprise rapide (lire EN PREMIER)
- [PROJECTION.md](PROJECTION.md) — détail du moteur de projection (9 phases mensuelles, scénarios, MC)
- [WIRING_NOTES.md](WIRING_NOTES.md) — wirings inter-onglets, `lastProjection`, deep-links
- [../BACKLOG.md](../BACKLOG.md) — renvoi vers les issues ouvertes du dépôt
- [adr/](adr/) — Architecture Decision Records (décisions structurantes)
