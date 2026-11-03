# GEMINI.md — FinanceAI (Architecture 100 % Google)

Application personnelle de planification financière québécoise et canadienne : fiscalité ARC + Revenu Québec, Monte Carlo retraite, assistant **Google Gemini**, synchronisation **Cloud Firestore** & **Google Drive**, authentification **Firebase Auth / Google Sign-In**, interface **Google Finance**.
100 % navigateur : React 19 + Vite 8 + TS 5.9 (`strict: true`) + Tailwind 4 (Design System Google Finance / Material 3), Zustand 5 (persist), Zod, Recharts, Vitest 5.
Écosystème Google : `@google/genai` (`services/gemini.ts`, `gemini-3.8-flash` / `gemini-4-argon` / `gemini-3.5-flash-lite`), Firebase Web SDK v12 (`Auth`, `Firestore`), Google Identity Services (`Google Drive appDataFolder`). Tout en français.
Structure plate (pas de `src/`) : `components/ hooks/ services/ store/ utils/ mcp/ api/ tests/ docs/`. Moteur : `services/projection/`.
Compte de tests (source unique, MESURÉ 2026-11-02) : voir la sortie de la gate CI (`npm run test`).

## Index documentaire (ce fichier reste ≤ 60 lignes / ≤ 10 Ko)
- État et reprise : `HANDOVER.md` · Architecture détaillée : `docs/ARCHITECTURE.md`
- Valeurs fiscales sourcées : `docs/FISCAL_REFERENCE.md` · Moteur de projection : `docs/PROJECTION.md` (`docs/PROJECTION_OUTPUT_SCHEMA.md`)
- Conventions & leçons : `docs/CONVENTIONS.md` · Forme des réponses et mode PDG : `docs/COMPTE-RENDU.md`
- Conformité (Loi 25, RGPD, ARC/RQ) : `docs/compliance.md` · Configuration Google Drive : `docs/GOOGLE_DRIVE_SETUP.md`
- Tâches : issues du dépôt (`BACKLOG.md` n'est qu'un renvoi ; humaines : `docs/A_FAIRE_MOI.md`) · Décisions : `docs/adr/`
- Graphe de code : `scripts/graphe.sh query|affected|path|explain` avant de grepper (`graphify-out/wiki/index.md`)

## Commandes
`npm run dev` · `test` · `test:watch` · `test:e2e` · `typecheck` · `lint` · `build` (prebuild = lint) · `knip` · `check-contrast` · `mcp:dev|auth|connect|pack`.
**Gate avant CHAQUE commit** : `npm run typecheck && npm run lint && npm run test && npm run build`. Jamais `npx tsc`.

## Règles NON NÉGOCIABLES
1. **No-fake-data** : aucune donnée simulée en prod ; projection absente → `<ProjectionRequired>` ; valeur non finie/absente → « — » ou `null`, jamais `0` (y compris dans un prompt Gemini).
2. **Secrets** : jamais en clair (code, dépôt, chat). Clés API Gemini (`apiKeys.gemini`) et Finnhub (`apiKeys.finnhub`) stockées en IndexedDB chiffré (`AES-256-GCM`), exclues de `localStorage`, des sauvegardes et des synchronisations Cloud Firestore / Google Drive.
3. **Confidentialité (dépôt public)** : aucune donnée personnelle réelle dans le dépôt (jamais de NIV, adresse, téléphone, n° de contrat, symbole détenu ni montant réel dans le code, les tests, la doc ou un journal CI).
4. **Sources uniques** : futur = `lastProjection.chartData` (grep le moteur avant tout calcul UI) ; patrimoine net = `computeRawNetWorth` et `computePresentTermes`.
5. **Fiscalité** : toute constante vient de `docs/FISCAL_REFERENCE.md` (datée et sourcée ARC / Revenu Québec) ; chiffre non sourcé = suspect. Salaires MENSUELS (`×12`).
6. **Formatage** : `formatCAD` / `formatPercent` (`utils/format.ts`) uniquement ; devises natives → `assetValueCad`.
7. **Gate avant commit** : `npm run typecheck && npm run lint && npm run test && npm run build` obligatoire avant tout commit. Jamais `--no-verify`.
8. **Chemins sensibles** (`scripts/hooks/**`, `.github/**`, `api/**`, `mcp/**`, `vercel.json`, `vite.config.ts`, `index.html`, `firestore.rules`) : protégés par le contrôle « Garde-fou ».
9. **Store & Synchronisation** : champ additif optionnel = pas de bump de version ; bump seulement pour restructurer. Synchronisation multi-appareils via Cloud Firestore (`users/{uid}/workspaces/main`, `firestore.rules` strictes par `request.auth.uid == userId`) et Google Drive (`appDataFolder` chiffré).
10. **Tenue docs** : même PR : `HANDOVER.md`, `CHANGELOG.md`, `README.md` et `docs/ARCHITECTURE.md` touchés ; leçon → `docs/CONVENTIONS.md`, sinon « push sans leçon ».

## Conduite (Google Antigravity & Gemini)
Mode PDG (`proposer ≠ faire`) ; silence absolu entre deux appels d'outils ; `[YYYY-MM-DD HH:MM UTC]` en tête de chaque réponse (`docs/COMPTE-RENDU.md`). Qualité d'abord, coût tokens non contraint.
