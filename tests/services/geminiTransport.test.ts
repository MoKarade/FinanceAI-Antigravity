// [SEC-GEMINI-TRANSPORT] Transport direct vers l'API Google Gemini (`services/gemini.ts`).
// La clé API est transmise dans l'en-tête HTTP `x-goog-api-key`, JAMAIS en paramètre d'URL (`?key=`),
// pour éviter qu'elle n'apparaisse dans les journaux d'URL ou l'historique réseau.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chat } from '../../services/gemini';
import { testerCleApiGemini } from '../../services/geminiClientAdapter';

const geminiMessage = () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

let fetchSpy: ReturnType<typeof vi.fn>;
const targetOf = (call: unknown[]): string => {
    const first = call[0] as string | URL | Request;
    return typeof first === 'string' ? first : first instanceof URL ? first.href : first.url;
};
const headersOf = (call: unknown[]): Headers => {
    const [first, init] = call as [string | Request, RequestInit | undefined];
    if (first instanceof Request) return first.headers;
    return new Headers(init?.headers as HeadersInit | undefined);
};

beforeEach(() => {
    fetchSpy = vi.fn(async () => geminiMessage());
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('gemini.ts — transport Google Gemini', () => {
    it('chat() cible generativelanguage.googleapis.com avec x-goog-api-key en en-tête et sans clé dans l\'URL ni champs REST invalides', async () => {
        const out = await chat([{ role: 'user', content: 'salut' }], 'AIzaSy-test-perso');
        expect(out).toBe('ok');
        expect(fetchSpy).toHaveBeenCalled();
        const call = fetchSpy.mock.calls[0] as unknown[];
        const url = targetOf(call);
        expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
        expect(url).not.toContain('key=');
        expect(url).not.toContain('AIzaSy-test-perso');
        const h = headersOf(call);
        expect(h.get('x-goog-api-key')).toBe('AIzaSy-test-perso');
        const body = JSON.parse(String((call[1] as RequestInit | undefined)?.body ?? '{}'));
        expect(body).not.toHaveProperty('model');
        expect(body).not.toHaveProperty('max_tokens');
        expect(body).not.toHaveProperty('thinking');
        expect(body).not.toHaveProperty('output_config');
    });

    it('chat() bascule sur le modèle de repli si le modèle principal répond 404', async () => {
        fetchSpy = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'models/gemini-3.8-flash is not found' } }), { status: 404 }))
            .mockResolvedValueOnce(geminiMessage());
        vi.stubGlobal('fetch', fetchSpy);

        const out = await chat([{ role: 'user', content: 'salut' }], 'AIzaSy-test-perso');
        expect(out).toBe('ok');
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(targetOf(fetchSpy.mock.calls[1] as unknown[])).toContain('gemini-3.5-flash-lite:generateContent');
    });

    it('chat() échoue immédiatement sur 403 / API_KEY_INVALID sans boucle de repli inutile', async () => {
        fetchSpy = vi.fn().mockResolvedValueOnce(
            new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 }),
        );
        vi.stubGlobal('fetch', fetchSpy);

        await expect(chat([{ role: 'user', content: 'salut' }], 'AIzaSy-invalide')).rejects.toThrow(/API key not valid/i);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('testerCleApiGemini() valide une clé active via x-goog-api-key sans fuiter dans l\'URL', async () => {
        const res = await testerCleApiGemini(' "AIzaSy-valid-key" ');
        expect(res).toEqual({ ok: true, model: 'gemini-3.8-flash' });
        const call = fetchSpy.mock.calls[0] as unknown[];
        expect(targetOf(call)).not.toContain('key=');
        expect(headersOf(call).get('x-goog-api-key')).toBe('AIzaSy-valid-key');
    });
});
