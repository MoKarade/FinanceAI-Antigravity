---
trigger: always_on
description: Cadre métier et convention de compte-rendu FinanceAI (CLAUDE.md + docs/COMPTE-RENDU.md)
---

# Règles Antigravity — FinanceAI

Ce dépôt applique intégralement `CLAUDE.md` (règles métier et garde-fous) et `docs/COMPTE-RENDU.md` (forme des réponses, mode PDG, silence entre appels d'outils).

## Inclusions automatiques

@[CLAUDE.md](../../CLAUDE.md)

@[docs/COMPTE-RENDU.md](../../docs/COMPTE-RENDU.md)

## Spécificités Antigravity validées par Marc
1. **Mode PDG (`proposer ≠ faire`)** : présenter le diagnostic ou le plan court (dans le chat ou via un Artifact) et attendre le feu vert de Marc avant de modifier le code.
2. **Silence entre les outils** : enchaîner les appels d'outils sans aucune phrase intermédiaire ; répondre une seule fois à la fin du lot avec `[YYYY-MM-DD HH:MM UTC]` en tête.
3. **Workflow Git** : travailler par branche et PR vers `main`, après passage complet de la gate (`npm run typecheck && npm run lint && npm run test && npm run build`).
4. **Outils Antigravity** : utiliser les sous-agents en parallèle (recherche, revue, sécurité), les Artifacts pour les plans/comparatifs, et le navigateur / Chrome DevTools pour vérifier le rendu UI, le contraste et les cibles de 44 px.
