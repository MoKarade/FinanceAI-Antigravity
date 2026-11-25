# CONVENTIONS — FinanceAI (version détaillée)

> **Référence opérationnelle actuelle : [`GEMINI.md`](../GEMINI.md)** (architecture 100 % Google — `[FULL-GOOGLE-MIGRATION]`, 2026-11-02).
> Ce fichier conserve l'historique intégral des conventions et leçons d'ingénierie accumulées sur le dépôt.
>
> **Pourquoi ce découpage.** Le fichier racine (`GEMINI.md`, qui remplace l'ancien `CLAUDE.md` déplacé ici le 2026-07-31)
> se charge à CHAQUE session et reste volontairement court (≤ 60 lignes / ≤ 10 Ko).
>
> **Ce qui vit dans `GEMINI.md`** : l'architecture 100 % Google (**Google Gemini** via `services/gemini.ts`,
> **Firebase Auth**, **Cloud Firestore**, **Design System Google Finance**), les commandes, la gate
> avant commit et les règles métier NON NÉGOCIABLES.
>
> **Ce fichier reste la référence de détail des leçons.** Chaque leçon ci-dessous a été payée par un vrai
> bug. Quand une tâche touche un domaine sensible, LIRE la section correspondante ici AVANT de coder —
> c'est le mode d'emploi prévu, pas une archive morte. Là où un détail historique ci-dessous diverge de
> `GEMINI.md` (ex. migration d'Anthropic/Claude vers Google Gemini `@google/genai`), **c'est `GEMINI.md` qui fait foi**.
> - **Leçon 2026-11-02 (`[SW-NAVIGATE-NO-STORE]`)** : dans `public/sw.js`, ne jamais appeler `fetch(req, { cache: 'no-store' })` lorsque `req` est un objet `Request` de navigation (`req.mode === 'navigate'`). Sous Chromium, construire une requête à partir d'un `Request` en mode `navigate` avec un `RequestInit` non vide lève `TypeError`, ce qui déclenchait le `.catch()` et servait l'ancien `index.html` du cache `financeai-v5`. Toujours passer l'URL (`fetch(req.url, { cache: 'no-store' })`), incrémenter `CACHE_NAME` et recharger les fenêtres clientes (`client.navigate`) lors de la purge d'un ancien cache dans `activate`.
> - **Leçon 2026-11-05 (`[GF-SOBRIETE-NAV-SCROLL]`)** : 1) **Un seul résumé par page** : ne jamais empiler un bandeau `.gf-quote-strip` redondant sous `PageHeader` lorsque le sous-titre ou la section principale affiche déjà ces métriques. Toujours vérifier le rendu sur un **dossier peuplé** (ex. persona « Couple à l'aise ») et pas uniquement sur un store vide. 2) **Synchronisation Hash ↔ Onglet** : dans `hooks/useTabNavigation.ts`, `applyHash()` écoute `hashchange` et le montage initial via `activeTabRef` (jamais `activeTab` dans les `deps` du `useEffect`), et ramène `hash === ''` vers `Tab.DASHBOARD` pour que le bouton `Précédent` du navigateur fonctionne jusqu'à l'URL racine. 3) **Zéro clignotement au scroll** : un seul conteneur de défilement (`window`), remise à `scrollY = 0` au changement d'onglet, aucune cascade `opacity: 0` double entre `TabRouter` et les pages, et aucune transformation géométrique (`translateY`/`scale`) sur `:hover`. Navigation sur `onClick` uniquement (jamais `onMouseDown` qui déclenche une navigation au toucher avant un scroll mobile).

---

## Archive des leçons historiques (juin – octobre 2026)
Toutes les leçons antérieures à la bascule Google (`2026-11-02`) sont conservées intégralement dans `docs/CONVENTIONS_ARCHIVE.md`. Rechercher par mot-clé/tag plutôt que lire le fichier entier.
