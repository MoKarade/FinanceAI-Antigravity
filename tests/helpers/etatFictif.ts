// tests/helpers/etatFictif.ts
//
// Fabrique d'ÉTAT FICTIF complet (`AppState`) pour les tests de services, d'outils et du serveur MCP.
// Base = l'état par défaut de l'application (`buildDefaultAppState`, la même source que le serveur
// MCP au premier lancement) : aucun montant, aucune donnée personnelle. Chaque appel rend un objet
// NEUF — un test peut le muter sans contaminer le suivant.
//
// Usage : `const s = etatFictif({ initialBalances: { REER: 1000 } });`
import { buildDefaultAppState } from '../../services/aiTools/appStateDefaults';
import type { AppState } from '../../types';

export function etatFictif(surcharges: Partial<AppState> = {}): AppState {
    return { ...buildDefaultAppState(), ...surcharges };
}
