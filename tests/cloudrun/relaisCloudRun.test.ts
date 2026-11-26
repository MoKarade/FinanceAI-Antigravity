// @vitest-environment node
// tests/cloudrun/relaisCloudRun.test.ts — relais Cloud Run `/api/**` (cloudrun/proxy/relais.mjs) : liste blanche des chemins,
// garde d'origine, jeton Fintable relayé sans être conservé. Aucun appel réseau : `fetchImpl` injecté.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reinitialiserLimites, traiter } from '../../cloudrun/proxy/relais.mjs';

const PROD_FIREBASE_ID = ['financeai', '497', '112'].join('-').replace('-112', '112');
const JETON_FICTIF = 'Bearer jeton-fictif-123';

function faux() {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
}

function get(chemin: string, headers: Record<string, string> = {}): Request {
    return new Request(`http://relais.local${chemin}`, { headers });
}

describe('relais Cloud Run', () => {
    beforeEach(() => reinitialiserLimites());

    it('relaie /api/fintable/<chemin> vers fintable.io/api/v2 avec le jeton du navigateur', async () => {
        const f = faux();
        const r = await traiter(get('/api/fintable/accounts?page=2', { authorization: JETON_FICTIF }), { fetchImpl: f });
        expect(r.status).toBe(200);
        expect(f).toHaveBeenCalledTimes(1);
        const [url, init] = f.mock.calls[0];
        expect(url).toBe('https://fintable.io/api/v2/accounts?page=2');
        expect((init?.headers as Record<string, string>).authorization).toBe(JETON_FICTIF);
        expect(init?.redirect).toBe('error');
    });

    it('refuse un appel Fintable sans jeton par une erreur JSON (jamais du HTML), sans appel amont', async () => {
        const f = faux();
        const r = await traiter(get('/api/fintable/accounts'), { fetchImpl: f });
        expect(r.status).toBe(401);
        expect(r.headers.get('content-type')).toBe('application/json');
        expect(await r.json()).toEqual({ error: { type: 'unauthorized', message: 'Jeton Fintable manquant.' } });
        expect(f).not.toHaveBeenCalled();
    });

    it.each([
        '/api/fintable/..%2Fadmin',
        '/api/fintable/a%2F.%2Fb',
        '/api/fintable/accounts%3Fx%3D1',
        '/api/proxy/fintable?path=a&path=b',
    ])('refuse le chemin Fintable hors liste blanche %s', async (chemin) => {
        const f = faux();
        const r = await traiter(get(chemin, { authorization: JETON_FICTIF }), { fetchImpl: f });
        expect(r.status).toBe(400);
        expect(f).not.toHaveBeenCalled();
    });

    it('répond 404 JSON sur une route inconnue', async () => {
        const f = faux();
        const r = await traiter(get('/api/autre/chose'), { fetchImpl: f });
        expect(r.status).toBe(404);
        expect(f).not.toHaveBeenCalled();
    });

    it('relaie les routes Yahoo (historique et recherche) vers query1.finance.yahoo.com', async () => {
        const f = faux();
        await traiter(get('/api/history/yahoo/%5EGSPC?range=1d&interval=1d'), { fetchImpl: f });
        await traiter(get('/api/yahoo/history?symbol=CAD%3DX&range=5d'), { fetchImpl: f });
        await traiter(get('/api/search/yahoo?q=vfv&quotesCount=8&newsCount=0&listsCount=0'), { fetchImpl: f });
        expect(f.mock.calls.map((c) => c[0])).toEqual([
            'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?range=1d&interval=1d',
            'https://query1.finance.yahoo.com/v8/finance/chart/CAD%3DX?range=5d',
            'https://query1.finance.yahoo.com/v1/finance/search?q=vfv&quotesCount=8&newsCount=0&listsCount=0',
        ]);
    });

    it.each([
        'https://finance.hubperso.com',
        'https://financeai-f5382.web.app',
        'https://financeai-f5382.firebaseapp.com',
        `https://${PROD_FIREBASE_ID}.web.app`,
        `https://${PROD_FIREBASE_ID}--pr1-abc.web.app`,
        'https://financeai-demo-public.web.app',
        'http://localhost:5173',
    ])('accepte l\'origine %s', async (origin) => {
        const r = await traiter(get('/api/yahoo/search?q=a', { origin }), { fetchImpl: faux() });
        expect(r.status).toBe(200);
    });

    it.each([
        [{ origin: 'https://evil.example' }],
        [{ origin: 'https://finance.hubperso.com.evil.example' }],
        [{ origin: 'https://financeai-evil.web.app' }],
        [{ origin: 'https://financeai-attacker123.firebaseapp.com' }],
        [{ 'sec-fetch-site': 'cross-site' }],
    ])('refuse une origine étrangère %o', async (headers) => {
        const f = faux();
        const r = await traiter(get('/api/fintable/accounts', { ...headers, authorization: JETON_FICTIF }), { fetchImpl: f });
        expect(r.status).toBe(403);
        expect(f).not.toHaveBeenCalled();
    });

    it('autorise uniquement le projet configuré via opts.financeaiProjectId (et refuse toute injection regex) + en-tête nosniff sur /api/sante', async () => {
        const rOk = await traiter(get('/api/yahoo/search?q=a', { origin: 'https://financeai-custom99--preview-1.web.app' }), {
            fetchImpl: faux(),
            financeaiProjectId: 'financeai-custom99',
        });
        expect(rOk.status).toBe(200);

        const rBadPid = await traiter(get('/api/yahoo/search?q=a', { origin: 'https://financeai-evil.web.app' }), {
            fetchImpl: faux(),
            financeaiProjectId: 'financeai-.*',
        });
        expect(rBadPid.status).toBe(403);

        const rHealth = await traiter(get('/api/sante'), { fetchImpl: faux() });
        expect(rHealth.status).toBe(200);
        expect(rHealth.headers.get('x-content-type-options')).toBe('nosniff');
        expect(rHealth.headers.get('cache-control')).toBe('no-store');
    });

    it('refuse toute méthode autre que GET', async () => {
        const f = faux();
        const r = await traiter(new Request('http://relais.local/api/fintable/accounts', { method: 'POST', headers: { authorization: JETON_FICTIF } }), { fetchImpl: f });
        expect(r.status).toBe(405);
        expect(f).not.toHaveBeenCalled();
    });

    it('ne conserve pas le jeton : l\'appel suivant sans jeton est refusé et le code ne lit aucun secret', async () => {
        const f = faux();
        await traiter(get('/api/fintable/accounts', { authorization: JETON_FICTIF }), { fetchImpl: f });
        const r = await traiter(get('/api/fintable/accounts'), { fetchImpl: f });
        expect(r.status).toBe(401);
        expect(f).toHaveBeenCalledTimes(1);
        const source = readFileSync('cloudrun/proxy/relais.mjs', 'utf8');
        expect(source).not.toMatch(/process\.env/);
        expect(source).not.toMatch(/console\.\w+\([^)]*auth/i);
    });

    it('ferme définitivement /api/financeai/bridge en 410 Gone sans appel amont', async () => {
        const f = faux();
        const rGet = await traiter(get('/api/financeai/bridge'), { fetchImpl: f });
        expect(rGet.status).toBe(410);
        const rPost = await traiter(
            new Request('http://relais.local/api/financeai/bridge', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ remoteUrl: 'https://example.com/secret.json' }),
            }),
            { fetchImpl: f },
        );
        expect(rPost.status).toBe(410);
        expect(f).not.toHaveBeenCalled();
    });
});
