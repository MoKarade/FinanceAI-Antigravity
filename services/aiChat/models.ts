// services/aiChat/models.ts
//
// [B3-CHAT-MODEL] Source UNIQUE des modèles Google Gemini offerts dans le chat (demande Marc : « choisir
// quel ia » par conversation). Module LÉGER (zéro import lourd — boot-safe). `services/gemini.ts`
// dérive ses constantes MODEL_SONNET/MODEL_HAIKU d'ici (jamais deux littéraux d'id qui divergent —
// classe « littéral dupliqué à côté de la source »).

import type { AiChatModelKey } from '../../types';
// `.js` : ce module est aussi chargé côté serveur (ESM natif du runtime Node).
import { PRICING_USD_PER_MTOK } from './pricing.js';

/** Ids API complets par clé de chat. ⚠️ Chaque id DOIT avoir une entrée dans PRICING_USD_PER_MTOK
 *  (services/aiChat/pricing) — parité verrouillée par tests/services/aiChatPricing.test.ts. */
export const MODEL_IDS: Record<AiChatModelKey, string> = {
    haiku: 'gemini-3.5-flash-lite',
    sonnet: 'gemini-3.8-flash',
    opus: 'gemini-4-argon',
};

/** Défaut historique du chat (choix Marc, AITOOLS-B) — utilisé quand `aiChatModel` est absent. */
export const DEFAULT_AI_CHAT_MODEL: AiChatModelKey = 'sonnet';

// [Finding ai-reviewer #489] Le ratio de coût affiché DÉRIVE du tarif réel (pricing.ts) — un texte
// en dur (« 5× ») avait déjà divergé de la table (5/3 ≈ 1,7×) dans le même diff.
const ratioVsSonnet = (key: AiChatModelKey): string => {
    const a = PRICING_USD_PER_MTOK[MODEL_IDS[key]]?.input;
    const b = PRICING_USD_PER_MTOK[MODEL_IDS.sonnet]?.input;
    return a && b ? `≈ ${(a / b).toFixed(1).replace('.', ',')}×` : '';
};

/** Options du sélecteur UI (ordre = du plus économique au plus capable). */
export const AI_CHAT_MODELS: Array<{ key: AiChatModelKey; label: string; description: string }> = [
    { key: 'haiku', label: '3.5 Flash-Lite', description: `Rapide et économique (${ratioVsSonnet('haiku')} le coût de Flash)` },
    { key: 'sonnet', label: '3.8 Flash', description: 'Équilibre qualité/coût (défaut)' },
    { key: 'opus', label: '4 Argon', description: `Raisonnement approfondi (${ratioVsSonnet('opus')} le coût de Flash)` },
];

/** Ceinture : une valeur inconnue (état synchronisé par une version future/corrompu) retombe sur le
 *  défaut — jamais un id de modèle invalide envoyé à l'API. */
export function resolveChatModelKey(value: unknown): AiChatModelKey {
    if (value === 'haiku' || value === 'sonnet' || value === 'opus') return value;
    if (value === 'flash-lite' || value === 'gemini-3.5-flash-lite' || value === 'gemini-2.5-flash-lite') return 'haiku';
    if (value === 'flash' || value === 'gemini-3.8-flash' || value === 'gemini-2.5-flash') return 'sonnet';
    if (value === 'pro' || value === 'argon' || value === 'gemini-4-argon' || value === 'gemini-2.5-pro') return 'opus';
    return DEFAULT_AI_CHAT_MODEL;
}

/**
 * [TX-STALE-MODEL-LABEL] Libellé LISIBLE d'un id de modèle, DÉRIVÉ de la table ci-dessus.
 * Pourquoi : une surface affichait un nom de modèle en dur pendant une opération — un libellé
 * recopié ne suit jamais le modèle qu'il prétend nommer (classe `DOC-METRIQUE-RECOPIEE` appliquée
 * à l'UI). Rendu ici plutôt qu'au site d'affichage pour que TOUTE surface qui nomme un modèle
 * lise la même source.
 * Un id inconnu rend l'id brut : honnête (on ne sait pas le traduire) plutôt qu'un faux nom.
 */
export function modelLabelFromId(id: string): string {
    if (id === 'gemini-3.5-flash-lite') return 'Gemini 3.5 Flash-Lite';
    if (id === 'gemini-3.8-flash') return 'Gemini 3.8 Flash';
    if (id === 'gemini-4-argon') return 'Gemini 4 Argon';
    if (id === 'gemini-2.5-flash-lite' || id === 'claude-haiku-5-5') return 'Gemini 2.5 Flash-Lite';
    if (id === 'gemini-2.5-flash' || id === 'claude-sonnet-5-5') return 'Gemini 2.5 Flash';
    if (id === 'gemini-2.5-pro' || id === 'claude-opus-5-5') return 'Gemini 2.5 Pro';
    const entry = AI_CHAT_MODELS.find((m) => MODEL_IDS[m.key] === id);
    return entry ? `Gemini ${entry.label}` : id;
}
