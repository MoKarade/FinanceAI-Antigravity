# SESSION HANDOVER — FinanceAI (Google Antigravity & Gemini)

> **À lire EN PREMIER si tu reprends FinanceAI.** Pointeurs détaillés : `GEMINI.md`, `docs/ARCHITECTURE.md`.

## Session 2026-11-26 — Refonte complète en 5 étapes (SW `financeai-v48`)

1. **Sécurité & synchronisation (`fdd47e6`)** : durcissement du pont Valoria, garde SSRF sur les proxys locaux et Cloud Run, limitation loopback + rate-limit Express, restriction de la porte hors-ligne Firebase Auth, sauvegarde locale automatique avant résolution de conflit Cloud Firestore et court-circuit `O(1)` des écritures purement visuelles.
2. **Grand ménage & cohérence des calculs (`7e5f541`)** : retrait de 50 fichiers morts/obsolètes (`-29 998` lignes), `0` cycle sur `560` modules (`depcruise`), suppression des repli Anthropic, allègement de Valoria à 5 onglets et 4 laboratoires sans jargon, et unification des calculs (valeur nette, liquidités, `CELIAPP`, capitalisation hypothécaire semi-annuelle canadienne, FNB obligataires et devise native `USD`/`EUR`).
3. **Futur lisible, actions IA et effet marché (`6dda805`)** : libellés en français simple sans sigles cryptiques (`P10`/`P50`/`P90`), zone centrale la plus probable (`P25–P75`), jauge « X chances sur 100 » pour la retraite, 3 à 5 actions concrètes cochables avec application directe au plan et carte **Effet du marché sur ton patrimoine** en `$ CAD` et mois de retraite sur `Futur` et `Accueil`.
4. **Décideur immobilier interactif (`b88862c`)** : ouverture directe sur `Projets d'achat` quand aucun bien n'est encore détenu, édition rapide `Prix` et `Date d'achat` en tête de page, lecture de la trésorerie projetée dans `lastProjection.chartData`, intégration des autres dettes mensuelles actives au test bancaire B-20 et carte Verdict (`Feu vert` / `Budget tendu` / `Risqué`).
5. **Élagage visuel & ergonomie bureau/téléphone (`SW financeai-v48`)** : retrait du bandeau KPI en doublon (`FutureKpiStrip`) et des badges mono de `PageHeader` pour afficher la courbe `Futur` au-dessus de la ligne de flottaison, suppression des zooms `:hover`, barres de zoom placées hors axe Y, cibles tactiles ≥ 44 px, notifications relevées au-dessus de la barre mobile et vérification Playwright bureau (`1440×900`) et téléphone (`390×844`).

## À faire côté déploiement (action manuelle si souhaité)
- **Cloud Run proxy (`cloudrun/proxy/`)** : redéployer le relais si besoin pour embarquer les garde-fous SSRF de l'étape 1.
- **Firebase Hosting** : déployer `dist/` uniquement sur demande explicite (`npm run build` déjà validé).

## Commandes de vérification
- Gate obligatoire avant commit : `npm run typecheck && npm run lint && npm run test && npm run build`
- Qualité complémentaire : `npm run knip`, `npm run check-contrast`, `npm run test:e2e`
- Aperçu local sécurisé : `NODE_ENV=production PORT=3010 npx tsx server.ts` puis `?nogate=1`
