// @vitest-environment node
// Proxys Yahoo / Fintable : méthodes, liste blanche de paramètres, débit par IP. Fetch mocké : aucun réseau.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { proxyYahooHistorique, proxyYahooRecherche, proxyFintable } from '../../api/_lib/proxies';
import { reinitialiserLimites } from '../../api/_lib/garde';

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
    reinitialiserLimites();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('proxys Yahoo / Fintable', () => {
    const get = (url: string, headers: Record<string, string> = {}) => new Request(`http://localhost${url}`, { method: 'GET', headers });

    it.each([
        ['historique', (r: Request) => proxyYahooHistorique(r), '/api/yahoo/history?symbol=AAPL&range=1d&interval=1d'],
        ['recherche', (r: Request) => proxyYahooRecherche(r), '/api/yahoo/search?q=apple'],
        ['fintable', (r: Request) => proxyFintable(r), '/api/proxy/fintable?path=accounts'],
    ])('%s : GET valide → 200 + no-store', async (_n, f, url) => {
        const res = await f(get(url));
        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('méthode autre que GET : 405', async () => {
        const r = await proxyYahooRecherche(new Request('http://localhost/api/yahoo/search?q=a', { method: 'POST' }));
        expect(r.status).toBe(405);
    });

    it('Yahoo : hôte amont fixe, symbole encodé, paramètres relayés', async () => {
        await proxyYahooHistorique(get('/api/yahoo/history?symbol=BRK.B&period1=100&period2=200&interval=1d'));
        const u = new URL(String(fetchSpy.mock.calls[0][0]));
        expect(u.origin).toBe('https://query1.finance.yahoo.com');
        expect(u.pathname).toBe('/v8/finance/chart/BRK.B');
        expect(u.searchParams.get('period1')).toBe('100');
    });

    it.each([
        '/api/yahoo/history?symbol=..%2F..%2Fetc',
        '/api/yahoo/history?symbol=AAPL%3Fx%3D1',
        '/api/yahoo/history?symbol=',
        '/api/yahoo/history?symbol=AAPL&range=99x',
        '/api/yahoo/history?symbol=AAPL&period1=abc',
    ])('Yahoo : entrée invalide refusée en 400 sans appel amont : %s', async (url) => {
        const r = await proxyYahooHistorique(get(url));
        expect(r.status).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Yahoo recherche : terme vide ou trop long refusé', async () => {
        expect((await proxyYahooRecherche(get('/api/yahoo/search?q='))).status).toBe(400);
        expect((await proxyYahooRecherche(get(`/api/yahoo/search?q=${'a'.repeat(101)}`))).status).toBe(400);
    });

    it('Fintable : chemin sous /api/v2, jeton Fintable relayé, autres paramètres conservés', async () => {
        await proxyFintable(get('/api/proxy/fintable?path=accounts/12/transactions&limit=50', { authorization: 'Bearer ft-test' }));
        const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://fintable.io/api/v2/accounts/12/transactions?limit=50');
        expect(new Headers(init.headers).get('authorization')).toBe('Bearer ft-test');
        expect([...new Headers(init.headers).keys()].filter((k) => k.startsWith('cf-'))).toEqual([]);
    });

    it.each(['../admin', 'a/../../b', './x', '/x', 'a//b', 'a?b=1', 'a#b', 'a b', '%2e%2e/x', ''])(
        'Fintable : chemin hostile refusé (%j)', async (chemin) => {
            const r = await proxyFintable(get(`/api/proxy/fintable?path=${encodeURIComponent(chemin)}`));
            expect(r.status).toBe(400);
            expect(fetchSpy).not.toHaveBeenCalled();
        });

    it('amont en panne : 502 sans détail', async () => {
        fetchSpy.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED 10.0.0.1'));
        const r = await proxyYahooRecherche(get('/api/yahoo/search?q=a'));
        expect(r.status).toBe(502);
        expect(await r.text()).not.toContain('10.0.0.1');
    });

    it('débit par IP : au-delà de 120/min → 429', async () => {
        const h = { 'x-vercel-forwarded-for': '203.0.113.77' };
        let dernier = 200;
        for (let i = 0; i < 121; i++) dernier = (await proxyYahooRecherche(get('/api/yahoo/search?q=a', h))).status;
        expect(dernier).toBe(429);
    });
});

describe('proxys : la réécriture Vercel peut livrer l\'URL réécrite OU l\'URL d\'origine', () => {
    const get = (url: string, headers: Record<string, string> = {}) => new Request(`http://localhost${url}`, { method: 'GET', headers });

    it('Yahoo : symbole lu depuis le chemin d\'origine (^GSPC, CAD=X décodés UNE fois) et paramètres d\'origine conservés', async () => {
        await proxyYahooHistorique(get('/api/history/yahoo/%5EGSPC?range=1d&interval=1d'));
        await proxyYahooHistorique(get('/api/history/yahoo/CAD%3DX?range=5d&interval=1d'));
        const urls = fetchSpy.mock.calls.map((c) => new URL(String(c[0])));
        expect(urls[0].pathname).toBe('/v8/finance/chart/%5EGSPC');
        expect(urls[0].searchParams.get('range')).toBe('1d');
        expect(urls[1].pathname).toBe('/v8/finance/chart/CAD%3DX');
    });
    it('Yahoo : symbole de la requête réécrite décodé une seule fois', async () => {
        await proxyYahooHistorique(get('/api/yahoo/history?symbol=%5EGSPC&range=1d'));
        expect(new URL(String(fetchSpy.mock.calls[0][0])).pathname).toBe('/v8/finance/chart/%5EGSPC');
    });
    it('Fintable : chemin multi-segments lu depuis l\'URL d\'origine, requête d\'origine conservée', async () => {
        await proxyFintable(get('/api/fintable/accounts/12/transactions?limit=50&cursor=abc'));
        expect(String(fetchSpy.mock.calls[0][0])).toBe('https://fintable.io/api/v2/accounts/12/transactions?limit=50&cursor=abc');
    });
    it('paramètre répété (`?symbol=` ou `?path=` ajouté par l\'appelant) : refusé, jamais « le premier gagne »', async () => {
        expect((await proxyYahooHistorique(get('/api/yahoo/history?symbol=AAPL&symbol=MSFT'))).status).toBe(400);
        expect((await proxyFintable(get('/api/proxy/fintable?path=accounts&path=me'))).status).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    it('symbole composé de points refusé (« .. » sortirait du chemin /chart/)', async () => {
        expect((await proxyYahooHistorique(get('/api/yahoo/history?symbol=..'))).status).toBe(400);
        expect((await proxyYahooHistorique(get('/api/yahoo/history?symbol=.'))).status).toBe(400);
    });
    it('nosniff sur les réponses relayées', async () => {
        const ok = await proxyYahooRecherche(get('/api/yahoo/search?q=a'));
        expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    });
});

describe('paramètre répété : refus, jamais de repli silencieux sur le chemin d\'origine', () => {
    it('URL d\'origine avec `?symbol=` ajouté par l\'appelant', async () => {
        const r = await proxyYahooHistorique(new Request('http://localhost/api/history/yahoo/AAPL?symbol=MSFT&symbol=X'));
        expect(r.status).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
    it('URL d\'origine Fintable avec `?path=` répété', async () => {
        const r = await proxyFintable(new Request('http://localhost/api/fintable/accounts?path=a&path=b'));
        expect(r.status).toBe(400);
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
