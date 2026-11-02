// tests/services/geminiSdkRetryDefaut.test.ts
//
// [VISION-NO-RETRY] (lot 209, 2026-09-06) — le client que `makeClient` construit réessaie DE LUI-MÊME :
// `maxRetries` vaut 2 par défaut, sur 408 / 409 / 429 / 5xx et sur une panne de connexion, en honorant
// `retry-after` (backoff 0,5 s → 8 s sinon), et il s'arrête sans réessai sur un signal d'abandon.
// Cette garde ancre le FAIT (un 429 est réessayé, un 401 ne l'est pas, une exhaustion coûte exactement
// 1 + 2 appels) pour qu'un `maxRetries: 0` posé un jour dans `makeClient` rougisse ici.
//
// ⚠️ Rien n'est simulé sous `fetch` : c'est le contrat d'erreur du VRAI module qu'on mesure
// (`UNE-CAUSE-CLASSEE-PUIS-JETEE-EST-UNE-CAUSE-ABSENTE` — un faux module encode le contrat qu'on CROIT avoir).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chat, analyzeBankStatement, makeClient } from '../../services/gemini';

const ok = (text: string) => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
}), { status: 200, headers: { 'content-type': 'application/json' } });

const ko = (status: number, headers: Record<string, string> = {}) => new Response(
    JSON.stringify({ error: { code: status, message: `HTTP ${status}` } }),
    { status, headers: { 'content-type': 'application/json', ...headers } },
);

/** File de réponses : une `Response`, ou une `Error` à REJETER (panne de connexion). */
let queue: Array<Response | Error>;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
    queue = [];
    fetchSpy = vi.fn(async () => {
        const next = queue.shift();
        if (!next) throw new Error('file de réponses vide — le test attendait moins d\'appels');
        if (next instanceof Error) throw next;
        return next;
    });
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
});

describe('[VISION-NO-RETRY] le client Gemini réessaie les erreurs transitoires — mesuré sur le vrai client', () => {
    it('le client de makeClient part avec maxRetries = 2 (jamais forcé à 0)', async () => {
        const client = await makeClient('AIza-test');
        expect(client.maxRetries).toBe(2);
        const vision = await makeClient('AIza-test', 'vision');
        expect(vision.maxRetries).toBe(2);
    });

    it('chat() : un 429 avec retry-after est réessayé et la réponse suivante est rendue (2 appels réseau)', async () => {
        queue.push(ko(429, { 'retry-after': '0' }), ok('réponse'));
        await expect(chat([{ role: 'user', content: 'salut' }], 'AIza-test')).resolves.toBe('réponse');
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('analyzeBankStatement (Vision) : un 503 sur l\'upload du relevé est réessayé — aucun re-upload manuel', async () => {
        queue.push(
            ko(503, { 'retry-after': '0' }),
            ok('[{"date":"2026-06-05","description":"EPICERIE METRO","amount":-42.5}]'),
        );
        const file = new File(['%PDF-1.4 releve'], 'releve.pdf', { type: 'application/pdf' });
        const txns = await analyzeBankStatement(file, 'AIza-test');
        expect(txns).toHaveLength(1);
        expect(txns[0].amount).toBe(-42.5);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('une panne de connexion (fetch rejette) est réessayée après le backoff par défaut du client', async () => {
        vi.useFakeTimers();
        queue.push(new TypeError('fetch failed'), ok('après la panne'));
        const pending = chat([{ role: 'user', content: 'salut' }], 'AIza-test');
        // Le backoff par défaut (0,5 s × 2^n) est bien sous le timeout de 30 s de `chat`.
        await vi.advanceTimersByTimeAsync(5_000);
        await expect(pending).resolves.toBe('après la panne');
        expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('épuisement : trois 429 d\'affilée → l\'erreur remonte après EXACTEMENT 1 + maxRetries appels', async () => {
        queue.push(ko(429, { 'retry-after': '0' }), ko(429, { 'retry-after': '0' }), ko(429, { 'retry-after': '0' }));
        await expect(chat([{ role: 'user', content: 'salut' }], 'AIza-test')).rejects.toMatchObject({ status: 429 });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it('contrôle : un 401 (clé refusée) et un 400 (requête) ne sont PAS réessayés — un seul appel chacun', async () => {
        queue.push(ko(401));
        await expect(chat([{ role: 'user', content: 'salut' }], 'AIza-test')).rejects.toMatchObject({ status: 401 });
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        fetchSpy.mockClear();
        queue.push(ko(400));
        await expect(chat([{ role: 'user', content: 'salut' }], 'AIza-test')).rejects.toMatchObject({ status: 400 });
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('contrôle : un signal déjà abandonné (timeout / annulation) ne déclenche AUCUN appel ni réessai', async () => {
        const ctrl = new AbortController();
        ctrl.abort(new Error('annulé par l\'utilisateur'));
        await expect(chat([{ role: 'user', content: 'salut' }], 'AIza-test', { signal: ctrl.signal })).rejects.toThrow();
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
