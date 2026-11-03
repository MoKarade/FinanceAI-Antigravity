// services/assistant/journalModifications.ts
//
// Journal des écritures de l'assistant : chaque écriture enregistre l'instantané AVANT / APRÈS des
// SEULES tranches du store qu'elle a touchées. Le bouton « Annuler » du fil restaure exactement ces
// tranches — et refuse si l'une d'elles a bougé depuis (une autre écriture, un autre onglet, une
// synchronisation) : restaurer par-dessus écraserait en silence un changement plus récent.
//
// ⚠️ Les instantanés vivent EN MÉMOIRE (session) : ils peuvent peser lourd (toutes les transactions)
// et n'ont pas leur place dans l'historique synchronisé (plafond Firestore de 900 000 caractères).
// Après un rechargement, l'annulation d'une ancienne modification n'est plus proposée (le fil le dit).
// `apiKeys` n'entre JAMAIS dans un instantané. Accès au store : uniquement par la façade
// `facadeStoreAssistant` (inventaire fermé des services qui lisent le store).

import type { AppState } from '../../types';
import { buildDefaultAppState } from '../../mcp/state/appStateDefaults';
import { facadeStoreAssistant } from '../aiTools/appStateProvider';
import { TRANCHES } from './tranches';

/** Une écriture appliquée par l'assistant (métadonnées sérialisables, conservées dans le fil). */
export interface EntreeJournal {
    id: string;
    action: string;
    resume: string;
    tranches: string[];
    horodatage: string;
}

interface Instantanes {
    avant: Record<string, unknown>;
    apres: Record<string, unknown>;
}

const instantanes = new Map<string, Instantanes>();

/** Clés jamais capturées ni restaurées. */
const CLES_IGNOREES = new Set<string>(['apiKeys', 'lastUpdate']);

let compteur = 0;
const nouvelId = (): string => {
    compteur += 1;
    const alea = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
    return `mod-${alea}-${compteur}`;
};

/** Clés de DONNÉES du store : liste canonique `buildDefaultAppState` + toutes les tranches pilotables
 *  (certaines sont facultatives et absentes des défauts, ex. `weddingGoal`). */
function clesDonnees(): Array<keyof AppState> {
    const cles = new Set<string>([...Object.keys(buildDefaultAppState()), ...TRANCHES.map((t) => String(t.cle))]);
    return [...cles].filter((k) => !CLES_IGNOREES.has(k)) as Array<keyof AppState>;
}

/** Copie profonde des données du store (sans fonctions, sans apiKeys). */
export function capturerDonnees(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const k of clesDonnees()) out[k] = facadeStoreAssistant.lire(k);
    return out;
}

const egal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Clés dont la valeur diffère entre deux captures. */
export function tranchesModifiees(avant: Record<string, unknown>, apres: Record<string, unknown>): string[] {
    const cles = new Set([...Object.keys(avant), ...Object.keys(apres)]);
    return [...cles].filter((k) => !CLES_IGNOREES.has(k) && !egal(avant[k], apres[k]));
}

/**
 * Exécute une mutation (qui rend son résumé lisible) et journalise les tranches réellement touchées.
 * Rend `null` si rien n'a changé (aucune entrée, aucun bouton Annuler).
 */
export async function journaliserEcriture(
    action: string,
    muter: () => Promise<string>,
): Promise<EntreeJournal | null> {
    const avant = capturerDonnees();
    const resume = await muter();
    const apres = capturerDonnees();
    const touchees = tranchesModifiees(avant, apres);
    if (touchees.length === 0) return null;
    const entree: EntreeJournal = {
        id: nouvelId(),
        action,
        resume,
        tranches: touchees,
        horodatage: new Date().toISOString(),
    };
    const pick = (src: Record<string, unknown>): Record<string, unknown> =>
        Object.fromEntries(touchees.map((k) => [k, structuredClone(src[k])]));
    instantanes.set(entree.id, { avant: pick(avant), apres: pick(apres) });
    return entree;
}

/** L'annulation de ces entrées est-elle encore possible dans cette session ? */
export function annulationDisponible(ids: string[]): boolean {
    return ids.length > 0 && ids.every((id) => instantanes.has(id));
}

export type ResultatAnnulation =
    | { ok: true; tranches: string[] }
    | { ok: false; raison: string };

/**
 * Annule un GROUPE d'écritures (un tour de l'assistant) : restaure, pour chaque tranche touchée,
 * l'état d'AVANT la première écriture du groupe — seulement si l'état courant est encore celui
 * d'APRÈS la dernière (sinon refus explicite, rien n'est écrit).
 */
export function annulerGroupe(ids: string[]): ResultatAnnulation {
    const entrees = ids.map((id) => instantanes.get(id));
    if (entrees.length === 0 || entrees.some((e) => !e)) {
        return { ok: false, raison: 'Annulation indisponible : l\'instantané de cette modification n\'existe plus (session précédente).' };
    }
    const avant: Record<string, unknown> = {};
    const apres: Record<string, unknown> = {};
    for (const e of entrees as Instantanes[]) {
        for (const [k, v] of Object.entries(e.avant)) if (!(k in avant)) avant[k] = v;
        for (const [k, v] of Object.entries(e.apres)) apres[k] = v;
    }
    const enConflit = Object.keys(apres).filter((k) => !egal(facadeStoreAssistant.lire(k as keyof AppState), apres[k]));
    if (enConflit.length > 0) {
        return {
            ok: false,
            raison: `Annulation refusée : ${enConflit.join(', ')} a changé depuis cette modification. Annule d'abord les modifications plus récentes.`,
        };
    }
    const patch = Object.fromEntries(Object.entries(avant).map(([k, v]) => [k, structuredClone(v)]));
    facadeStoreAssistant.ecrire(patch as Partial<AppState>);
    for (const id of ids) instantanes.delete(id);
    return { ok: true, tranches: Object.keys(avant) };
}

/** Tests uniquement : vide le journal. */
export function _viderJournal(): void {
    instantanes.clear();
}
