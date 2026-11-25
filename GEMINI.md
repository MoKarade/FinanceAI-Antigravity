# GEMINI.md — FinanceAI (Source unique des consignes)

Application personnelle de planification financière québécoise et canadienne : fiscalité ARC + Revenu Québec, Monte Carlo retraite, assistant **Google Gemini**, synchronisation **Cloud Firestore**, authentification **Firebase Auth / Google Sign-In**, interface **Google Finance**.
100 % navigateur : React 19 + Vite 8 + TS 5.9 (`strict: true`) + Tailwind 4 (Design System Google Finance / Material 3), Zustand 5 (persist), Zod, Recharts, Vitest 5.
Écosystème Google : `@google/genai` (`services/gemini.ts`, `gemini-3.8-flash` / `gemini-4-argon` / `gemini-3.5-flash-lite`), Firebase Web SDK v12 (`Auth`, `Firestore`). Tout en français.
Structure plate (pas de `src/`) : `components/ hooks/ services/ store/ utils/ server/ cloudrun/ tests/ docs/`. Moteur : `services/projection/`.

## Index documentaire
- État et reprise : `HANDOVER.md` · Architecture détaillée : `docs/ARCHITECTURE.md`
- Valeurs fiscales sourcées : `docs/FISCAL_REFERENCE.md` · Moteur de projection : `docs/PROJECTION.md` (`docs/PROJECTION_OUTPUT_SCHEMA.md`)
- Conventions & leçons : `docs/CONVENTIONS.md` (note : `docs/COMPTE-RENDU.md` reste intact pour la CI, mais le style de réponse ci-dessous prime dans le chat)
- Conformité (Loi 25, RGPD, ARC/RQ) : `docs/compliance.md`
- Tâches : issues du dépôt (`BACKLOG.md` n'est qu'un renvoi ; humaines : `docs/A_FAIRE_MOI.md`) · Décisions : `docs/adr/`

## Commandes & Gate
`npm run dev` · `test` · `test:watch` · `test:e2e` · `typecheck` · `lint` · `build` (prebuild = lint) · `knip` · `check-contrast` · `acc`.
**Gate obligatoire avant chaque commit** : `npm run typecheck && npm run lint && npm run test && npm run build`. Jamais `npx tsc` ni `--no-verify`.

## Règles NON NÉGOCIABLES
1. **No-fake-data** : aucune donnée simulée en prod ; projection absente → `<ProjectionRequired>` ; valeur non finie/absente → « — » ou `null`, jamais `0` (y compris dans un prompt Gemini).
2. **Secrets** : jamais en clair (code, dépôt, chat). Clés API Gemini (`apiKeys.gemini`) et Finnhub (`apiKeys.finnhub`) stockées en IndexedDB chiffré (`AES-256-GCM`), exclues de `localStorage`, des sauvegardes et des synchronisations Cloud Firestore.
3. **Confidentialité (dépôt public)** : aucune donnée personnelle réelle de Marc (jamais de NIV, adresse, téléphone, n° de contrat, symbole détenu ni montant réel dans le code, les tests, la doc ou un journal CI).
4. **Sources uniques** : futur = `lastProjection.chartData` (grep le moteur avant tout calcul UI) ; patrimoine net = `computeRawNetWorth` et `computePresentTermes`.
5. **Fiscalité** : toute constante vient de `docs/FISCAL_REFERENCE.md` (datée et sourcée ARC / Revenu Québec). Salaires MENSUELS (`×12`).
6. **Formatage, Thème & Sobriété UI** : `formatCAD` / `formatPercent` (`utils/format.ts`) uniquement ; devises natives → `assetValueCad`. Couleurs en variables sémantiques Google Finance (`--fond`, `--surface`, `--surface-douce`, `--bordure`, `--texte`) et cibles tactiles ≥ 44 px (`touch-target` / `min-h-11`). Zéro bandeau KPI en doublon sous `PageHeader`, zéro `translateY`/`scale` au `:hover` (anti-flicker au scroll), navigation sur `onClick` (jamais `onMouseDown`), et vérification visuelle Playwright sur dossier peuplé (port `3010`, `?nogate=1`).
7. **Chemins sensibles** (`scripts/hooks/**`, `qualite/**`, `.github/**`, `vite.config.ts`, `index.html`, `firestore.rules`) : protégés. Ne jamais désactiver ou affaiblir un test, un seuil ou un contrôle.
8. **Store & Synchronisation** : champ additif optionnel = pas de bump de version. Synchronisation multi-appareils via Cloud Firestore (`users/{uid}/workspaces/main` ou `/workspaces/main`).
9. **Français** : code, commentaires, docs, commits et PR en français sans abîmer les accents existants.

## Style de réponse (prioritaire sur `docs/COMPTE-RENDU.md`)
- **5 à 8 lignes max en puces** : résultat concret en premier, puis points à surveiller s'il y en a.
- **Langage simple, zéro jargon** : explique comme à un non-développeur ; pas de noms de fonctions, commandes, diffs ni blabla sauf si Marc demande « détaille ».
- **Silence entre les outils** : enchaîne les actions sans raconter chaque étape, puis réponds une seule fois à la fin.
- **Questions simples** : si un choix produit/design s'impose, recommande une option claire en premier. Pas d'horodatage UTC en tête.
