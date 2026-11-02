# Spécification de Sécurité Firestore (Phase 0 — Payload-First Security TDD)

## 1. Invariants de Données

1. **Isolation stricte par propriétaire (`userId == request.auth.uid`)** : Aucun document dans `/users/{userId}` ni dans `/workspaces/{userId}` ne peut être lu, créé, modifié ou supprimé par un utilisateur autre que le propriétaire authentifié dont l'adresse courriel est vérifiée (`request.auth.token.email_verified == true`).
2. **Protection contre l'empoisonnement d'identifiant (`isValidId`)** : Tout identifiant de chemin `{userId}` et tout champ d'identifiant (`uid`, `ownerId`, `revisionId`) doit respecter l'expression régulière `^[a-zA-Z0-9_\-]+$` et les plafonds de taille définis dans `firebase-blueprint.json`.
3. **Intégrité des clés et prévention des champs fantômes (`hasAll` / `hasOnly`)** : Toute création ou mise à jour doit déclarer explicitement les clés requises et autorisées. Aucun champ non déclaré (ex. `isAdmin`, `role`, `apiKeys`) n'est accepté.
4. **Immuabilité des champs fondateurs** : Lors d'une mise à jour (`update`), `uid`, `ownerId` et `createdAt` doivent rester strictement identiques aux valeurs existantes (`incoming().ownerId == existing().ownerId` et `incoming().createdAt == existing().createdAt`).
5. **Intégrité temporelle serveur (`request.time`)** : `createdAt` (à la création) et `updatedAt` (à la création et à la mise à jour) doivent être strictement égaux à `request.time`.

## 2. Les 12 Charges Utiles Adverses (« Dirty Dozen »)

1. **Usurpation d'identité sur création de dossier (`ownerId` tiers)** :
   `{"ownerId": "user_victim_99", "schemaVersion": 1, "revisionId": "rev_1", "statePayload": {}, "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME"}`
2. **Injection de champ fantôme d'élévation de privilège (`Shadow Update`)** :
   `{"ownerId": "user_1", "schemaVersion": 1, "revisionId": "rev_2", "statePayload": {}, "isAdmin": true, "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME"}`
3. **Écriture avec courriel non vérifié (`email_verified == false`)** :
   Tentative d'écriture sur `/users/user_1` avec un jeton où `email_verified` vaut `false`.
4. **Lecture transversale de données personnelles (`PII Blanket Read`)** :
   Requête `get` par `user_2` sur `/users/user_1`.
5. **Modification du champ immuable `createdAt` lors d'un `update`** :
   Mise à jour de `/workspaces/user_1` modifiant `createdAt` vers `request.time`.
6. **Modification du propriétaire `ownerId` lors d'un `update`** :
   Mise à jour de `/workspaces/user_1` remplaçant `ownerId` par `"user_2"`.
7. **Horodatage `updatedAt` forgé par le client (dans le passé ou le futur)** :
   Mise à jour de `/workspaces/user_1` avec `updatedAt != request.time`.
8. **Dépassement de taille sur `displayName` ($> 120$ caractères)** :
   Création sur `/users/user_1` avec `displayName` de 500 caractères.
9. **Empoisonnement du format de `revisionId` (caractères spéciaux invalides)** :
   Création sur `/workspaces/user_1` avec `revisionId: "rev/../../script"`.
10. **Corruption de type sur `statePayload` (chaîne JSON au lieu d'une Map native)** :
    Mise à jour de `/workspaces/user_1` avec `statePayload: "{}"`.
11. **Corruption de type sur `schemaVersion` (chaîne ou nombre négatif)** :
    Création sur `/workspaces/user_1` avec `schemaVersion: -1`.
12. **Fuite de secrets `apiKeys` dans la racine ou dans `statePayload`** :
    Rejet de toute clé `apiKeys` à la racine du document ou à l'intérieur de `statePayload`.
