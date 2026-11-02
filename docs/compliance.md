# Conformité — checklist aux jalons

> Revue aux **JALONS** (release majeur, changement de périmètre des données, période d'impôts), PAS à chaque
> commit. Le détail vit dans le code (`services/consent.ts`, `services/secureKeyStore.ts`,
> `docs/FISCAL_REFERENCE.md`) ; ce document est la checklist de revue. Agent : `security-privacy` (+ `financial-integrity` pour le fiscal).

## Vie privée — Loi 25 (Québec) + RGPD
- [ ] **Minimisation** : on ne collecte que le strict nécessaire au calcul financier.
- [ ] **Consentement** : `services/consent.ts` couvre toute nouvelle collecte/usage.
- [ ] **Local-first & Cloud isolé** : les données ne quittent pas l'appareil sauf synchronisation authentifiée de l'utilisateur (**Cloud Firestore** `users/{uid}/workspaces/main` protégé par `firestore.rules` et sauvegarde chiffrée **Google Drive** `appDataFolder`).
- [ ] **Chiffrement au repos** : AES-256-GCM, IndexedDB non-extractible, PBKDF2 600k. Clés API (`apiKeys.gemini`, `apiKeys.finnhub`) exclues de `localStorage`, des exports et des synchronisations.
- [ ] **Droits** : effacement et export des données utilisateur possibles.
- [ ] **Pas de fuite PII** : `errorLogger` scrub montants + secrets ; aucun montant/clé en clair dans un log ou une URL.

## Exactitude fiscale (ARC + Revenu Québec)
- [ ] Toute constante fiscale vient de `docs/FISCAL_REFERENCE.md` (datée + sourcée). Aucun chiffre en dur non sourcé.
- [ ] Valeurs revues au moins **1×/période d'impôts** (indexation, plafonds, taux, crédits).
- [ ] Conservation de l'argent prouvée (`/audit-financier` : forme-bilan `ΔNW == ΔΣactifs − ΔΣdettes`).

## Intégrité produit
- [ ] **No-fake-data** : aucune donnée simulée en prod ; projection non calculée → `<ProjectionRequired>` ; aucune valeur non finie/absente affichée comme `0` (y compris dans un prompt **Google Gemini**).
- [ ] **Source unique** : tout calcul long-terme dérive de `lastProjection.chartData` ; patrimoine net via `computeRawNetWorth` et `computePresentTermes`.

## Sécurité applicative
- [ ] Aucun secret versionné ; CSP stricte (`vercel.json` + `index.html`) ; injection de prompt Gemini neutralisée (`utils/promptSafety.ts`).
- [ ] `npm audit` = 0 vulnérabilité critique/haute.
