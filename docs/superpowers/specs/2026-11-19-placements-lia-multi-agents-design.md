# Design validé — Refonte simplifiée de Placements & Comité Multi-Agents IA (Placements + LIA)

**Date** : 2026-11-19  
**Statut** : Approuvé (`ok 3` · `1` · `go`)

## Objectifs
1. **Simplifier drastiquement l’écran `Placements`** (`components/Investments.tsx`) :
   - Remplacer les 4 sous-onglets précédents (`Vue d'ensemble`, `Allocation et rééquilibrage`, `Détail`, `Conseiller & 7 Agents`) par **2 onglets principaux clairs** :
     - **`Mon portefeuille`** : KPI essentiels, enveloppes fiscales, courbe de performance comparée, tableau/liste des titres détenus (avec action directe *« Analyser IA »*), répartition par propriétaire, et **2 sections repliables fermées par défaut** (`Répartition & rééquilibrage` et `Détail des titres, DCA & dividendes`) pour préserver 100 % des fonctionnalités sans surcharge visuelle.
     - **`Analyse IA`** : interface conversationnelle et structurée dédiée au **Comité Multi-Agents**, permettant d’interroger librement l’IA sur n’importe quel titre coté, FNB, crypto ou entreprise privée non cotée (ex. *« Est-ce que ça vaut le coup d’acheter Anthropic ? »*).
   - Placer les 8 laboratoires quantitatifs / 7 Agents (`ValoriaWorkspace`) derrière **1 bouton discret d’en-tête `Outils experts`** (fermé par défaut), tout en conservant les passerelles directes depuis `Futur` (`Quant IA`) et `Tab.VALORIA`.

2. **Construire un véritable Comité d’Investissement à 5 Agents** (`services/investments/multiAgentCommittee.ts`) :
   - **Phase 1 — Collecte réelle** : extraction/classification du sujet (détection automatique **titre coté** vs **société privée non cotée** vs **thème/portefeuille**), requêtes live sans clé sur `/api/yahoo/search`, `/api/market/quote` et `/api/news/intelligence`, plus instantané **strictement anonymisé** du portefeuille réel (`ACTIF_01..12`, enveloppes CELI/REER/CELIAPP/Non-enreg./Crypto, profil de risque, aucune donnée personnelle nominative).
   - **Phase 2 — 4 agents spécialistes indépendants en parallèle (`Promise.all`)** via `@google/genai` (chargement paresseux) avec recherche Web Google Search (`tools: [{ googleSearch: {} }]` + repli propre sans outil si indisponible) et comptabilisation du coût (`signalerUsageIa`) :
     1. **Agent Marché & Actualités Web** (`market_news`) : faits récents sourcés, statut coté/privé, valorisation ou cours récent, catalyseurs et URLs vérifiées.
     2. **Agent Fondamentaux & Valorisation** (`fundamentals`) : modèle économique, marges/croissance, multiples ou — pour une société privée comme Anthropic — rondes de financement, calendrier d’IPO hypothétique et **véhicules d’exposition indirecte cotés** (`AMZN`, `GOOGL`, `NVDA`, `XEQT.TO`).
     3. **Agent Risques & Avocat du diable** (`risk_bear`) : thèse adverse indépendante (valorisation tendue, concurrence, illiquidité/dilution, risques réglementaires).
     4. **Agent Portefeuille & Fiscalité QC** (`portfolio_qc_tax`) : chevauchement réel avec les avoirs existants, risque de concentration et enveloppe optimale Québec/Canada (CELI vs REER vs CELIAPP vs Non-enreg., retenue US 15 %).
   - **Phase 3 — Agent 5 Président & Synthèse** (`chair_synthesis`) : confrontation des 4 rapports, mise en évidence explicite des **accords** et **désaccords**, verdict structuré (`ACHETER` / `ACCUMULER` / `EXPOSITION_INDIRECTE` / `ATTENDRE` / `EVITER` / `CONSERVER`), conviction `/100`, conditions d’invalidation et plan d’action concret.
   - **Mode repli honnête (`no-fake-data`)** : si la clé Gemini est absente ou échoue, diagnostic déterministe honnête basé uniquement sur les données collectées (`conviction: null`, zéro chiffre inventé).
   - **Mémoire chiffrée au repos** (`services/investments/committeeHistoryStore.ts`) : historique des 20 dernières analyses par portée (`real` vs `test:<personaId>`) stocké dans IndexedDB chiffré AES-256-GCM (réutilisation de `getOrCreateDeviceKey`, zéro `localStorage`).

3. **Unifier avec l’Assistant LIA global** (`GeminiAssistantModal.tsx`) :
   - Nouvel outil de lecture `analyser_opportunite_placement` dans `services/assistant/actionRegistry.ts` (`NOMS_OUTILS_ESSENTIELS` dans `clientGemini.ts`, directive dans `agentLoop.ts` + support dans `executerTourLocal`), retournant à la fois le rapport structuré au modèle et un `BlocTableau` comparant les 4 agents directement dans le fil LIA.

## Hors périmètre
- Aucun passage d’ordre courtier réel.
- Aucun nouveau service backend payant (utilisation exclusive des routes `/api/*` déjà déployées et de la clé Gemini chiffrée de l’utilisateur).
- Aucune modification des chemins protégés (`scripts/hooks/**`, `qualite/**`, `.github/**`, `api/**`, `mcp/**`, `vercel.json`, `vite.config.ts`, `index.html`, `firestore.rules`, `docs/COMPTE-RENDU.md`).
