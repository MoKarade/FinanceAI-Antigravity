// services/assistant/clientGemini.ts
//
// Client RÉEL de la boucle agentique : SDK officiel `@google/genai` (`models.generateContent`,
// appel d'outils manuel — `automaticFunctionCalling` désactivé, c'est la boucle qui exécute).
// Chargé paresseusement : le SDK n'entre dans le bundle qu'à la première question.
// Sécurité : la clé vient UNIQUEMENT de `apiKeys.gemini` (IndexedDB chiffré), passée par l'appelant ;
// aucun repli sur une variable d'environnement (elle finirait dans le bundle public).
// Coût : chaque réponse payée est signalée au compteur unique (`signalerUsageIa`).

import type { Content } from '@google/genai';
import { signalerUsageIa } from '../aiChat/coutIa';
import type { ClientGemini, RequeteGemini, ReponseGemini } from './agentLoop';

export function creerClientGemini(apiKey: string): ClientGemini {
    const cle = apiKey.trim();
    if (!cle) throw new Error('Clé API Google Gemini manquante.');
    let sdk: Promise<typeof import('@google/genai')> | null = null;
    return {
        async generer(req: RequeteGemini): Promise<ReponseGemini> {
            sdk ??= import('@google/genai');
            const { GoogleGenAI } = await sdk;
            const ai = new GoogleGenAI({ apiKey: cle });
            const rep = await ai.models.generateContent({
                model: req.modele,
                contents: req.contenus as Content[],
                config: {
                    systemInstruction: req.instructionSysteme,
                    tools: req.outils.length > 0 ? [{ functionDeclarations: req.outils }] : undefined,
                    automaticFunctionCalling: { disable: true },
                    maxOutputTokens: 8192,
                    abortSignal: req.signal,
                },
            });
            const usage = rep.usageMetadata;
            signalerUsageIa(req.modele, usage
                ? { input_tokens: usage.promptTokenCount ?? null, output_tokens: usage.candidatesTokenCount ?? null }
                : null);
            const candidat = rep.candidates?.[0];
            return { contenu: (candidat?.content as ReponseGemini['contenu']) ?? null, raisonFin: candidat?.finishReason ?? null };
        },
    };
}
