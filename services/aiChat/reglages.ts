// services/aiChat/reglages.ts
//
// Réglages d'appel par génération de modèle. Module PUR et léger (zéro import — boot-safe).
//
// POURQUOI : les modèles de raisonnement pensent par défaut, et la pensée compte dans `max_tokens`.
// Un appel d'extraction plafonné à 512 jetons (fiche de paie) serait mangé par la pensée avant la
// réponse. Et le déterminisme se tient par le prompt et par la validation Zod de la sortie.
// Un id inconnu ne reçoit AUCUN réglage : mieux vaut le comportement par défaut qu'un 400.

type Effort = 'low' | 'medium' | 'high';

export interface ReglagesAppel {
    thinking?: { type: 'disabled' } | { type: 'between_tools' };
    output_config?: { effort: Effort };
}

/**
 * Lecture / extraction / catégorisation : on ne veut pas de réflexion superflue, on veut le JSON.
 * Flash-Lite : pensée coupée, effort bas. Flash : pensée minimale (`between_tools`), effort moyen
 * (documents financiers : la qualité prime sur le coût). Pro : effort bas.
 */
export function reglagesLecture(modelId: string): ReglagesAppel {
    if (
        modelId.startsWith('gemini-3.5-flash-lite')
        || modelId.startsWith('gemini-2.5-flash-lite')
        || modelId.startsWith('claude-haiku-5-5')
    ) {
        return { thinking: { type: 'disabled' }, output_config: { effort: 'low' } };
    }
    if (
        modelId.startsWith('gemini-3.8-flash')
        || modelId.startsWith('gemini-2.5-flash')
        || modelId.startsWith('claude-sonnet-5-5')
    ) {
        return { thinking: { type: 'between_tools' }, output_config: { effort: 'medium' } };
    }
    if (
        modelId.startsWith('gemini-4-argon')
        || modelId.startsWith('gemini-2.5-pro')
        || modelId.startsWith('claude-opus-5-5')
    ) {
        return { output_config: { effort: 'low' } };
    }
    return {};
}

/** Conversation (une seule réponse, sans outils) : pensée adaptative conservée, effort moyen. */
export function reglagesConversation(modelId: string): ReglagesAppel {
    if (
        /^gemini-(3\.5-flash-lite|3\.8-flash|4-argon|2\.5-(flash-lite|flash|pro))/.test(modelId)
        || /^claude-(haiku|sonnet|opus)-5-5/.test(modelId)
    ) {
        return { output_config: { effort: 'medium' } };
    }
    return {};
}
