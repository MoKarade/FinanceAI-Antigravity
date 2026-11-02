// tests/services/geminiReglagesRequete.test.ts
//
// Ce que les appels de `services/gemini.ts` ENVOIENT réellement à l'API Google Gemini.
// `aiChatReglages.test.ts` éprouve les fonctions de réglage isolément ; ici on lit l'URL et le
// corps de la requête construit par chaque appel sur le vrai client (seul `fetch` est simulé) :
// modèle résolu, plafond `maxOutputTokens` transmis à `generationConfig`, et absence de `temperature`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chat, analyzeBankStatement, analyzePayslip, MODEL_HAIKU, MODEL_SONNET } from '../../services/gemini';

const ok = (text: string) => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

let appels: Array<{ url: string; body: Record<string, unknown> }>;

beforeEach(() => {
    appels = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
        appels.push({
            url: String(url),
            body: JSON.parse(String(init?.body ?? '{}')),
        });
        return ok('[]');
    }));
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('requêtes vers Google Gemini', () => {
    it('chat() par défaut (Gemini 2.5 Flash) : cible gemini-2.5-flash, plafond 4096, jamais de temperature', async () => {
        await chat([{ role: 'user', content: 'salut' }], 'AIza-test');
        expect(appels).toHaveLength(1);
        expect(appels[0].url).toContain(`models/${MODEL_SONNET}:generateContent`);
        expect(appels[0].body.generationConfig).toEqual({ maxOutputTokens: 4096 });
        expect(appels[0].body).not.toHaveProperty('temperature');
    });

    it('chat() sur Gemini 2.5 Flash-Lite : cible gemini-2.5-flash-lite, plafond 4096, pensée désactivée (thinkingBudget: 0)', async () => {
        await chat([{ role: 'user', content: 'salut' }], 'AIza-test', { model: MODEL_HAIKU });
        expect(appels).toHaveLength(1);
        expect(appels[0].url).toContain(`models/${MODEL_HAIKU}:generateContent`);
        expect(appels[0].body.generationConfig).toEqual({
            maxOutputTokens: 4096,
            thinkingConfig: { thinkingBudget: 0 },
        });
    });

    it('analyzeBankStatement : cible Gemini 2.5 Flash, plafond 16000, sans temperature', async () => {
        const file = new File(['%PDF-1.4 releve'], 'releve.pdf', { type: 'application/pdf' });
        await analyzeBankStatement(file, 'AIza-test').catch(() => undefined);
        expect(appels.length).toBeGreaterThan(0);
        for (const a of appels) {
            expect(a.url).toContain(`models/${MODEL_SONNET}:generateContent`);
            expect(a.body.generationConfig).toEqual({ maxOutputTokens: 16000 });
            expect(a.body).not.toHaveProperty('temperature');
        }
    });

    it('analyzePayslip : cible Gemini 2.5 Flash, plafond 1024, sans temperature', async () => {
        const file = new File(['%PDF-1.4 paie'], 'paie.pdf', { type: 'application/pdf' });
        await analyzePayslip(file, 'AIza-test').catch(() => undefined);
        expect(appels.length).toBeGreaterThan(0);
        expect(appels[0].url).toContain(`models/${MODEL_SONNET}:generateContent`);
        expect(appels[0].body.generationConfig).toEqual({ maxOutputTokens: 1024 });
        expect(appels[0].body).not.toHaveProperty('temperature');
    });
});
