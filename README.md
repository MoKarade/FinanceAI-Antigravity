<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# FinanceAI

Application personnelle de planification financière complète (architecture 100 % Google) : suivi en temps réel, projections fiscales canadiennes et québécoises (ARC + Revenu Québec), simulation Monte Carlo de la retraite, plan d'action opérationnel en 5 horizons (jour, semaine, mois, année, décennie), assistant IA **Google Gemini** (`gemini-3.8-flash` & `gemini-4-argon`), synchronisation **Cloud Firestore** & **Google Drive**, authentification **Firebase Auth / Google Sign-In**, interface **Google Finance Beta** (3 colonnes équilibrées : Listes & Portefeuilles, Courbe & Avoirs, Recherche Gemini).

## 🚀 Lancer localement

**Prérequis** : Node.js 24.x (champ `engines` de `package.json`)

```bash
npm install
# Clé API Google Gemini (apiKeys.gemini) saisie dans l'interface (chiffrée AES-256-GCM en IndexedDB)
# Variables Firebase optionnelles (VITE_FIREBASE_*) dans .env.local pour Firebase Auth + Cloud Firestore
npm run dev
```

Build de production :
```bash
npm run build
npm run preview
```

## Lancer les tests

```bash
npm run test          # Vitest (projets node + jsdom en parallèle) — le compte fait foi dans la CI
npm run test:rapide   # Vitest (projet node seul — moteur, services, gardes)
npm run typecheck     # TypeScript strict mode (clean)
npm run build         # Vite 8 (--mode production)
```

Tests manuels : ~195 cas couvrant les onglets actifs — voir
[`docs/HISTORIQUE.md`](docs/HISTORIQUE.md).

*(Le nombre de tests était écrit ici, daté du 2026-08-17, pendant que le `GEMINI.md` en portait
un autre daté du 2026-08-20. Deux chiffres, deux dates, une seule vérité : celui qui n'est pas
relu ment en silence. Un compteur se lit dans la CI.)*

## 🎓 Conventions clés

- **Future = source unique** : tout calcul long-terme (FIRE, capital
  retraite, coût enfant lifetime…) vient de `lastProjection.chartData`.
  Voir [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md)
  et [`docs/PROJECTION_OUTPUT_SCHEMA.md`](docs/PROJECTION_OUTPUT_SCHEMA.md).
- **Mode strict** : si la projection n'est pas calculée, les onglets
  affichent `<ProjectionRequired>` au lieu d'inventer des valeurs.
- **No-fake data** : aucune donnée simulée en production. En mode test,
  CSV historique Yahoo Finance réel (104 points hebdo sur 2 ans).
- **Mode test** : bouton dans Configuration → snapshot des vraies données
  + bascule sur fixtures Alex/Sam. Restauration safe au désactivement.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Alt+1` | Futur (page d'ouverture) |
| `Alt+2` | Transactions |
| `Alt+3` | Budget (inclut Planification et Abonnements) |
| `Alt+4` | Assistant |
| `Alt+5` | Profil |
| `Alt+6` | Investissements |
| `Alt+7` | Retraite |
| `Alt+8` | Impôts |
| `Alt+9` | Réglages |

## 📚 Documentation

| Fichier | Contenu |
|---|---|
| **[Issues du dépôt](https://github.com/MoKarade/FinanceAI/issues)** | **Source de vérité du restant à faire** ([`BACKLOG.md`](BACKLOG.md) n'est qu'un renvoi ; ancienne liste : [`docs/BACKLOG_AVANT_ISSUES_2026-10-15.md`](docs/BACKLOG_AVANT_ISSUES_2026-10-15.md)) |
| [`HANDOVER.md`](HANDOVER.md) | Reprise rapide — état actuel + recommandations |
| [`docs/HISTORIQUE.md`](docs/HISTORIQUE.md) | Archive consolidée : snapshots, audits, designs livrés, ADRs, 131 tests manuels par onglet |
| [`docs/PROJECTION_OUTPUT_SCHEMA.md`](docs/PROJECTION_OUTPUT_SCHEMA.md) | Schéma exhaustif `chartData[i]` (~50 champs) |
| [`docs/PROJECTION.md`](docs/PROJECTION.md) | Moteur de projection (9 phases, 7 scénarios, MC) |
| [`docs/FISCAL_REFERENCE.md`](docs/FISCAL_REFERENCE.md) | Valeurs fiscales sourcées — RRQ, PSV, SRG, paliers, crédits |
| [`CHANGELOG.md`](CHANGELOG.md) | Historique des changements |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Stack détaillée, topologie, store, pipeline IA |
| [`mcp/README.md`](mcp/README.md) | Documentation du serveur MCP (intégration agents IA) |

## Architecture (vue rapide)

L'architecture détaillée est maintenue dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Résumé :

- L'app adopte une architecture **100 % Google** côté navigateur et persiste localement (`localStorage` + IndexedDB chiffré `AES-256-GCM`), avec synchronisation infonuagique via **Cloud Firestore** (`services/firebase/workspaceSync.ts`, isolée par `users/{uid}/workspaces/main`) et **Google Drive** (`appDataFolder` chiffré). L'authentification repose sur **Firebase Auth** (Google Sign-In) et Google Identity Services (OAuth 2.0 PKCE).
- Les fonctions d'intelligence artificielle passent par **Google Gemini** (`services/gemini.ts` et `services/geminiAssistant.ts` via le SDK officiel `@google/genai`, clé utilisateur `apiKeys.gemini` chiffrée en IndexedDB). Le serveur MCP (`mcp/`) expose les outils financiers typés.
- Le moteur de projection (`services/projection.ts` + `services/projection/` — une soixantaine de fichiers) est le coeur de l'app. Voir [`docs/PROJECTION.md`](docs/PROJECTION.md) pour les détails.
- Le state global est Zustand v5 + persist (schema v7 avec migrations v1→v7).
- L'interface applique le **Design System Google Finance** (thèmes clair et sombre Material 3, typographie Google Sans / Roboto Mono, variables CSS sémantiques).

## 🔐 Sécurité

- ✅ **Pas de secret hardcodé**. Clés via UI seulement (jamais dans `.env` versionné).
- ✅ **apiKeys excluses du localStorage** et des deux formats de backup (JSON clair + chiffré).
- ✅ **Backup chiffré** AES-256-GCM avec PBKDF2 600 000 itérations.
- ✅ **CSP stricte** (`vercel.json` headers + `<meta>` défense-en-profondeur) — aucun domaine LLM tiers résiduel.
- ✅ **Validation Zod** des réponses LLM (anti-prompt injection).
- ✅ **Pas de Google Sheet** — le proxy Sheet legacy a été supprimé (cycle 14). `services/finance.ts` ne fait plus de fetch CSV vers docs.google.com.
- ✅ **No-fake-data** : refus catégorique de mockups en prod.

## 🛠️ Stack

- **Frontend** : React 19.2 + Vite 8 (Rolldown) + TypeScript 5.9 strict + Tailwind CSS (Design System **Google Finance** / Material 3)
- **State** : Zustand 5 (avec `persist` + `partialize`, schema v7 + migrations v1→v7)
- **Tests** : Vitest + @testing-library/react + axe-core (compte : voir `GEMINI.md`, source unique)
- **Validation** : Zod 3
- **Charts** : Recharts 3 (lazy-loaded)
- **Auth & Cloud** : **Firebase Auth** (Google Sign-In) + **Cloud Firestore** (`users/{uid}/workspaces/main`) + déploiement **Vercel** (`vercel.json`)
- **LLM** : **Google Gemini** (`gemini-2.5-flash` + `gemini-2.5-pro` via `@google/genai` — `services/gemini.ts`, réglages dans `services/aiChat/reglages.ts`)
- **Vision** : **Gemini Vision** (`gemini-2.5-flash`) pour OCR relevés bancaires et talons de paie PDF/images
- **Data marché** : Finnhub REST API (cours actions + ETF, cache 1h) ; CoinGecko (crypto)
- **Sync** : **Cloud Firestore** (temps réel multi-appareils) + **Google Drive** (`appDataFolder`, chiffrement optionnel par passphrase, AES-256-GCM)
- **MCP** : Model Context Protocol server (Node.js)

## 📈 Fonctionnalités clés

### Suivi en temps réel
- Import CSV universel et synchronisation des transactions
- Import OCR relevés/paies PDF (**Gemini Vision**) — extraction montants, dates, catégories
- Reconnaissance auto des catégories (règles locales + **Google Gemini**)
- Détection d'abonnements récurrents
- Sync **Cloud Firestore** et **Google Drive** bidirectionnelle (données chiffrées optionnellement)

### Budget et goals
- Budget v2 : règle 50/30/20 (Besoins/Envies/Épargne) réel vs théorique
- Mode couple : propriété d'abonnements par personne
- Abonnements épinglés (alertes dépassement)
- Catégories budgétaires hiérarchiques
- Goals SMART avec suggestion LLM
- Visualisation de la marge mensuelle

### Investissements
- Import CSV portefeuille (Finnhub + import CSV local)
- Rebalancing target (Index/Tech/Industrie/Or/Liquidités)
- ACB suivi pour NonReg
- Cours en temps réel via Finnhub

### **Projection future (★ feature flagship)**
- 7 scénarios pré-calibrés : BASE, LIBERTE_55, HYPER_INFLATION, WINDFALL, ECONOMIC_WINTER, COMPOUND_STRESS, LATE_INHERITANCE
- Monte Carlo 100 itérations (déterministe via PRNG seedé)
- Retraite per-conjoint : FERR, PSV, RRQ par âge et prénom de chaque conjoint
- Pension DB + RRQ/PSV + SRG avec prorata résidence
- Crédit dons par paliers fédéraux et québécois
- Smile Curve dépenses retraite
- Soins longue durée stochastiques
- Mortalité stochastique
- Perte d'emploi stochastique
- Inflation par poste (panier CPI)
- Withholding tax US sur CELI
- Sequence risk metric
- FVI (Indice de Vitalité Financière)

→ Détails complets dans [`docs/PROJECTION.md`](docs/PROJECTION.md).

### Confidentialité et vie privée
- Mode discret : masquage DOM de tous les montants (toggle dans paramètres)
- Chiffrement local au repos (AES-256-GCM, PBKDF2 600k itérations)
- Clés API exclues des sauvegardes et du localStorage
- Zéro transmission de PII — toutes les données restent dans le navigateur

### Assistant IA (Google Gemini)
- **Google Gemini** (`services/gemini.ts` et `services/geminiAssistant.ts` via `@google/genai`) propulse toutes les fonctions d'intelligence artificielle de l'application avec la clé utilisateur `apiKeys.gemini` chiffrée en IndexedDB
- Connecteur MCP `financeAImcp` : lecture des indicateurs financiers et écriture avec confirmation à deux temps (aperçu puis jeton, rien n'est écrit sans accord)
- Dans l'app : diagnostic budget (streamé, annulable), suggestions Planning, catégorisation par lot (`gemini-2.5-flash`), lecture de talon de paie et de relevés bancaires (**Gemini Vision**) ; les écritures d'Impôts et du talon de paie passent par le modal « Appliquer » (diff avant → après)
- Modèles : `gemini-2.5-flash` (défaut rapide, catégorisation, vision) et `gemini-2.5-pro` (analyses approfondies et stratégies complexes)
- Mode discret : aucun montant n'est envoyé à Gemini ; aucune PII envoyée ; contexte fictif explicitement marqué en mode test (`[SANDBOX-PROMPTS-MARQUER-CONTEXTE]`)

### Accessibilité
- Contraste WCAG AA vérifié (script `scripts/check-contrast.ts`)
- Tests axe-core automatisés (29 cas)
- Command Palette (Cmd+K) pour navigation clavier
- Skeleton loaders pour les états de chargement

## 📜 Licence

Personnel — usage privé. Pas de redistribution.
