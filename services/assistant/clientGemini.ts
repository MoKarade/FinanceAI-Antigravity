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
import {
    buildGeminiModelCandidates,
    cleanGeminiApiKey,
    createLazyGoogleGenAI,
    isGeminiAuthError,
} from '../aiChat/geminiCore';
import type { ClientGemini, RequeteGemini, ReponseGemini } from './agentLoop';
import type { DeclarationOutil } from './actionRegistry';

const NOMS_OUTILS_ESSENTIELS = new Set<string>([
    'afficher_bloc',
    'naviguer_vers_onglet',
    'lancer_projection',
    'get_financial_summary',
    'get_projection',
    'list_assets',
    'list_transactions',
    'list_debts',
    'get_budget',
    'lister_transactions',
    'lister_placements',
    'lister_postes_budget',
    'lister_dettes',
    'consulter_diagnostic_valoria',
    'analyser_opportunite_placement',
    'ajouter_transaction',
    'ajouter_dette',
    'modifier_poste_budget',
    'modifier_objectif_retraite',
    'modifier_configuration_menage',
]);

export function creerClientGemini(apiKey: string): ClientGemini {
    const cle = cleanGeminiApiKey(apiKey);
    if (!cle) throw new Error('Clé API Google Gemini manquante.');
    return {
        async generer(req: RequeteGemini): Promise<ReponseGemini> {
            const ai = await createLazyGoogleGenAI(cle);

            const appeler = async (modele: string, outils: DeclarationOutil[]): Promise<ReponseGemini> => {
                const rep = await ai.models.generateContent({
                    model: modele,
                    contents: req.contenus as Content[],
                    config: {
                        systemInstruction: req.instructionSysteme,
                        tools: outils.length > 0 ? [{ functionDeclarations: outils }] : undefined,
                        automaticFunctionCalling: { disable: true },
                        maxOutputTokens: 8192,
                        abortSignal: req.signal,
                    },
                });
                const usage = rep.usageMetadata;
                signalerUsageIa(modele, usage
                    ? { input_tokens: usage.promptTokenCount ?? null, output_tokens: usage.candidatesTokenCount ?? null }
                    : null);
                const candidat = rep.candidates?.[0];
                return { contenu: (candidat?.content as ReponseGemini['contenu']) ?? null, raisonFin: candidat?.finishReason ?? null };
            };

            const outilsEssentiels = req.outils.filter((o) => NOMS_OUTILS_ESSENTIELS.has(o.name));
            const modeles = buildGeminiModelCandidates(req.modele);
            let derniereErreur: unknown;

            try {
                return await appeler(req.modele, req.outils);
            } catch (err) {
                if (req.signal?.aborted || isGeminiAuthError(err)) throw err;
                derniereErreur = err;
            }

            for (const modele of modeles) {
                try {
                    return await appeler(modele, outilsEssentiels);
                } catch (err) {
                    if (req.signal?.aborted || isGeminiAuthError(err)) throw err;
                    derniereErreur = err;
                }
            }

            for (const modele of modeles) {
                try {
                    return await appeler(modele, []);
                } catch (err) {
                    if (req.signal?.aborted || isGeminiAuthError(err)) throw err;
                    derniereErreur = err;
                }
            }

            throw derniereErreur;
        },
    };
}
