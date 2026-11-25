// services/aiChat/geminiCore.ts
// Socle léger unifié pour les clients Google Gemini (@google/genai et fetch REST).
// Zéro import statique du SDK lourd `@google/genai` et zéro import du store Zustand.

import { MODEL_IDS } from './models';

export const GEMINI_FALLBACK_CASCADE: readonly string[] = [
    MODEL_IDS.sonnet,
    MODEL_IDS.haiku,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
] as const;

/** Nettoie les guillemets et espaces parasites autour d'une clé API Google Gemini. */
export function cleanGeminiApiKey(apiKey: string): string {
    return apiKey.replace(/^["'\s]+|["'\s]+$/g, '');
}

/** Construit la liste ordonnée des modèles candidats en plaçant `primaryModel` en tête sans doublon. */
export function buildGeminiModelCandidates(primaryModel: string): string[] {
    const out: string[] = [primaryModel];
    for (const model of GEMINI_FALLBACK_CASCADE) {
        if (!out.includes(model)) out.push(model);
    }
    return out;
}

/** Détermine si un statut + message HTTP correspond à une erreur d'authentification / clé refusée. */
export function isGeminiAuthHttpError(status: number, detail: string): boolean {
    if (status === 401 || status === 403) return true;
    return status === 400 && /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(detail);
}

/** Détermine si une erreur levée par `@google/genai` correspond à une clé invalide ou refusée. */
export function isGeminiAuthError(err: unknown): boolean {
    const status = Number((err as { status?: unknown } | null)?.status);
    const msg = String((err as { message?: unknown } | null)?.message ?? '');
    if (Number.isFinite(status) && isGeminiAuthHttpError(status, msg)) return true;
    return /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(msg);
}

/** Indique si l'erreur provient d'une annulation (`AbortError`). */
export function isAbortError(err: unknown): boolean {
    return (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message)))
    );
}

let cachedGenAiSdkPromise: Promise<typeof import('@google/genai')> | null = null;

/** Charge `@google/genai` paresseusement une seule fois et instancie `GoogleGenAI`. */
export async function createLazyGoogleGenAI(apiKey: string) {
    const cleanKey = cleanGeminiApiKey(apiKey);
    if (!cleanKey) {
        throw new Error('Clé API Google Gemini manquante.');
    }
    cachedGenAiSdkPromise ??= import('@google/genai');
    const { GoogleGenAI } = await cachedGenAiSdkPromise;
    return new GoogleGenAI({ apiKey: cleanKey });
}
