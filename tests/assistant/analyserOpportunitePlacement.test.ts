import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACTIONS, declarationsOutils, executerAction } from '../../services/assistant/actionRegistry';
import { executerTourLocal, instructionSysteme } from '../../services/assistant/agentLoop';
import { blocRicheSchema } from '../../services/assistant/blocsRiches';
import { buildDefaultAppState } from '../../mcp/state/appStateDefaults';
import { useFinanceStore } from '../../store/useFinanceStore';
import { MESSAGE_IA_MODE_DISCRET } from '../../services/messageErreurIa';

describe('Assistant LIA — action analyser_opportunite_placement', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', undefined);
        useFinanceStore.setState({
            ...buildDefaultAppState(),
            isPrivacyMode: false,
            apiKeys: { gemini: '', finnhub: '' },
        } as never);
    });

    it('est enregistrée dans ACTIONS, declarationsOutils et NOMS_OUTILS_ESSENTIELS avec un schéma strict', () => {
        const action = ACTIONS.find((a) => a.nom === 'analyser_opportunite_placement');
        expect(action).toBeDefined();
        expect(action?.type).toBe('lecture');
        expect(action?.tranches).toEqual([]);

        const decl = declarationsOutils().find((d) => d.name === 'analyser_opportunite_placement');
        expect(decl).toBeDefined();
        expect(decl?.parametersJsonSchema.type).toBe('object');

        // Validation Zod stricte
        expect(action?.schema.safeParse({ question: 'Acheter Anthropic ?', unknownKey: 1 }).success).toBe(false);
        expect(action?.schema.safeParse({ question: 'ab' }).success).toBe(false);
        expect(action?.schema.safeParse({ question: 'Acheter Anthropic ?', montantCibleCad: 5000 }).success).toBe(true);

        const clientSrc = readFileSync(resolve(process.cwd(), 'services/assistant/clientGemini.ts'), 'utf8');
        expect(clientSrc).toContain("'analyser_opportunite_placement'");
        expect(instructionSysteme('2026-11-19')).toContain('analyser_opportunite_placement');
    });

    it('bloque en mode discret sans exécuter d’analyse et ne fuite jamais apiKeys', async () => {
        useFinanceStore.setState({
            isPrivacyMode: true,
            apiKeys: { gemini: 'SECRET_TEST_KEY', finnhub: '' },
        } as never);
        const res = await executerAction('analyser_opportunite_placement', {
            question: "Est-ce que ça vaut le coup d'acheter Anthropic ?",
        });
        expect(res.erreur).toBe(true);
        expect(JSON.stringify(res.resultat.pourModele)).toContain(MESSAGE_IA_MODE_DISCRET);
        expect(JSON.stringify(res.resultat.pourModele)).not.toContain('SECRET_TEST_KEY');
    });

    it('retourne un diagnostic structuré et un BlocTableau valide sur Anthropic (même sans clé Gemini)', async () => {
        const res = await executerAction('analyser_opportunite_placement', {
            question: "Est-ce que ça vaut le coup d'acheter Anthropic ?",
        });
        expect(res.erreur).toBe(false);
        const payload = res.resultat.pourModele as { donnees?: { statutEntite?: string; verdict?: string; proxiesIndirects?: Array<{ symbol: string }> } };
        expect(payload.donnees?.statutEntite).toBe('private_unlisted');
        expect(payload.donnees?.verdict).toBe('EXPOSITION_INDIRECTE');
        expect(payload.donnees?.proxiesIndirects?.map((p) => p.symbol)).toContain('AMZN');

        expect(res.resultat.bloc).toBeDefined();
        const checkBloc = blocRicheSchema.safeParse(res.resultat.bloc);
        expect(checkBloc.success).toBe(true);
    });

    it('executerTourLocal détecte une question Anthropic et rend tableau des 4 agents + avis honnête', async () => {
        const tour = await executerTourLocal(
            "Est-ce que ça vaut le coup d'acheter Anthropic ?",
            false,
            buildDefaultAppState(),
        );
        expect(tour.texte).toMatch(/^AVIS HONNÊTE :/);
        expect(tour.texte).toMatch(/privée non cotée/i);
        expect(tour.blocs.some((b) => b.type === 'tableau')).toBe(true);
        expect(tour.etapes).toContain('analyser_opportunite_placement');
    });
});
