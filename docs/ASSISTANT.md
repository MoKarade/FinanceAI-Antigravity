# Assistant Gemini connecté à l'app

L'assistant (panneau `components/aiChat/GeminiAssistantModal.tsx`) est un agent : il lit et modifie toutes les données du store par des **actions**, dans une boucle multi-tours.

## Architecture (`services/assistant/`)

| Module | Rôle |
|---|---|
| `actionRegistry.ts` | Registre **unique** des actions `{ nom, description, schéma Zod, type 'lecture' \| 'ecriture', tranches, exécuter(état, args) }` : specs partagées avec le serveur MCP (`services/aiTools/registry.ts`), actions génériques générées depuis `tranches.ts`, `naviguer_vers_onglet`, `lancer_projection`, `afficher_bloc`, `consulter_taux_change`. |
| `tranches.ts` | Table des tranches du store pilotables, plus les exclusions motivées (`TRANCHES_EXCLUES`). |
| `agentLoop.ts` | Boucle : historique + déclarations → Gemini → appels d'outils → résultats → … (8 itérations au plus, `AbortSignal`, mode discret respecté). Le client est injecté. |
| `clientGemini.ts` | Client réel : SDK `@google/genai` (`models.generateContent`), clé = `apiKeys.gemini` seulement. |
| `journalModifications.ts` | Instantané avant/après des tranches touchées par chaque écriture, bouton « Annuler » (refus si la tranche a changé depuis). Instantanés en mémoire, le temps de la session. |
| `conversations.ts` | Historique : Cloud Firestore `workspaces/{uid}/conversations/{id}` si l'utilisateur est connecté (hors mode test), sinon repli local. |
| `blocsRiches.ts` | Schéma des blocs `graphique`, `liste`, `tableau`, `cartes_chiffres` (valeur inconnue = `null`, jamais `0`). |

Accès au store : uniquement par `facadeStoreAssistant` (`services/aiTools/appStateProvider.ts`), qui ne lit ni n'écrit jamais `apiKeys`.

## Ajouter une donnée au store : la rendre pilotable

La garde `tests/assistant/couvertureStore.test.ts` échoue si une clé persistée du store n'a pas d'action de lecture **et** d'écriture. Pour un nouveau champ :

1. Ajoute une entrée à `TRANCHES` (`services/assistant/tranches.ts`) :
   - `genre: 'collection'` pour un tableau d'éléments (avec `identifiant: 'id'` s'ils ont un `id`), ce qui génère `lister_*`, `ajouter_*`, `modifier_*` et `supprimer_*` ;
   - `genre: 'objet'` pour un objet (`consulter_*`, `modifier_*`, plus `supprimer_*` si `supprimable`) ;
   - `genre: 'liste_texte'` pour une liste de chaînes.
   Type les champs connus dans `champs` (Zod) et liste les champs obligatoires à l'ajout dans `requis`.
2. Si le champ ne doit **pas** être piloté (secret, état d'interface, donnée écrite par une synchronisation), ajoute-le à `TRANCHES_EXCLUES` **avec sa raison**.
3. Lance `npx vitest run tests/assistant`.

Une action métier dédiée (calcul, import) s'ajoute directement au registre ; si elle doit aussi exister côté MCP, crée la spec dans `mcp/tools/` puis référence-la dans `services/aiTools/registry.ts`.

## Garde-fous

- Écritures appliquées directement, toujours vérifiées avant (`validateAppStateShape` + `verifierTypesRestaures`) : une écriture qui rendrait les données illisibles au prochain lancement est refusée.
- Mode discret : aucun appel au modèle, et le fil n'est pas affiché.
- Mode test : l'historique reste local (rien ne part en ligne) et le prompt est marqué comme portant sur des données fictives.
- Résultats d'outils nettoyés (`scrubMcpDeep`) et encadrés par la note d'isolation anti-injection.
