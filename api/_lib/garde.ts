// api/_lib/garde.ts
// [DURCISSEMENT-GARDE] Freins de débit et plafond de corps en code pur Web-standard.

/** Plafond du corps de requête (petits JSON texte). */
export const CORPS_MAX_OCTETS = 200 * 1024;

export const LIMITES_PAR_DEFAUT = {
    /** Requêtes par minute et par IP (tous appels). */
    parIp: 120,
    /** Requêtes par minute et par empreinte de clé. */
    parCle: 60,
    /** Vérifications de clé par minute et par IP. */
    verifParIp: 10,
} as const;
export type Limites = { parIp: number; parCle: number; verifParIp: number };

const FENETRE_MS = 60_000;
const COMPTEURS_MAX = 2_000;

// ─── Débit : fenêtre fixe, mémoire bornée, éviction par ancienneté ────────────────────────────────────

const compteurs = new Map<string, { debut: number; n: number }>();

/** Tests uniquement. */
export function reinitialiserLimites(): void {
    compteurs.clear();
}

/** Insère en gardant l'ordre d'ancienneté (Map = ordre d'insertion) et la taille bornée. */
function poser(cle: string, valeur: { debut: number; n: number }, maintenant: number): void {
    compteurs.delete(cle);
    if (compteurs.size >= COMPTEURS_MAX) {
        for (const [k, v] of compteurs) if (v.debut + FENETRE_MS <= maintenant) compteurs.delete(k);
        while (compteurs.size >= COMPTEURS_MAX) {
            const plusAncien = compteurs.keys().next().value;
            if (plusAncien === undefined) break;
            compteurs.delete(plusAncien);
        }
    }
    compteurs.set(cle, valeur);
}

/** Compte un passage ; `ok:false` + délai avant nouvel essai si le plafond de la fenêtre est atteint. */
export function essayerDebit(cle: string, max: number, maintenant = Date.now()): { ok: true } | { ok: false; retryApresSec: number } {
    const c = compteurs.get(cle);
    if (!c || c.debut + FENETRE_MS <= maintenant) {
        poser(cle, { debut: maintenant, n: 1 }, maintenant);
        return { ok: true };
    }
    if (c.n >= max) return { ok: false, retryApresSec: Math.max(1, Math.ceil((c.debut + FENETRE_MS - maintenant) / 1000)) };
    c.n += 1;
    return { ok: true };
}

/** Nombre de compteurs en mémoire (tests : borne). */
export function tailleCompteurs(): number {
    return compteurs.size;
}

// ─── Client ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * IP du client. Ordre de confiance : `x-vercel-forwarded-for` puis `x-real-ip` (posés par la plateforme, non
 * falsifiables par l'appelant), enfin le PREMIER saut de `x-forwarded-for` (Vercel l'écrase par l'IP réelle ; hors
 * Vercel — dev, autre hébergeur — il est falsifiable, d'où sa place en dernier). Absente → 'inconnue'.
 */
export function ipClient(headers: Headers): string {
    const candidats = [
        headers.get('x-vercel-forwarded-for'),
        headers.get('x-real-ip'),
        headers.get('x-forwarded-for')?.split(',')[0],
    ];
    const ip = candidats.map((c) => c?.trim()).find((c) => c);
    return (ip || 'inconnue').slice(0, 64);
}

// ─── Corps borné ──────────────────────────────────────────────────────────────────────────────────────

export class CorpsTropGros extends Error {}

/** Lit le corps SANS dépasser `max` octets (annule la lecture au dépassement : jamais de corps géant en mémoire). */
export async function lireCorpsBorne(request: Request, max = CORPS_MAX_OCTETS): Promise<string> {
    const annonce = Number(request.headers.get('content-length'));
    if (Number.isFinite(annonce) && annonce > max) throw new CorpsTropGros();
    if (!request.body) return '';
    const lecteur = request.body.getReader();
    const morceaux: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await lecteur.cancel().catch(() => undefined);
            throw new CorpsTropGros();
        }
        morceaux.push(value);
    }
    const tout = new Uint8Array(total);
    let pos = 0;
    for (const m of morceaux) { tout.set(m, pos); pos += m.byteLength; }
    return new TextDecoder().decode(tout);
}
