// [SESSION-HUB] Gardes de FORME (lues comme donnée) : routage Vercel, service worker et points d'entrée des proxys.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const lit = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const vercel = JSON.parse(lit('vercel.json'));

describe('vercel.json', () => {
    const rewrites = vercel.rewrites as Array<{ source: string; destination: string }>;

    it('AUCUNE réécriture ne mène à un hôte externe : Yahoo et Fintable passent par des fonctions gardées', () => {
        const externes = rewrites.filter((r) => /^https?:\/\//.test(r.destination));
        expect(externes).toEqual([]);
    });

    it.each([
        ['/api/history/yahoo/:symbol', '/api/yahoo/history'],
        ['/api/search/yahoo', '/api/yahoo/search'],
        ['/api/fintable/:path*', '/api/proxy/fintable'],
    ])('%s → fonction %s (chemin STATIQUE : les attrape-tout ne sont pas routés), avant la réécriture SPA', (source, fonction) => {
        const i = rewrites.findIndex((r) => r.source === source);
        expect(i, source).toBeGreaterThanOrEqual(0);
        expect(rewrites[i].destination.split('?')[0]).toBe(fonction);
        expect(i).toBeLessThan(rewrites.findIndex((r) => r.source === '/(.*)'));
        expect(readFileSync(resolve(ROOT, `${fonction.slice(1)}.ts`), 'utf8')).toContain("runtime: 'nodejs'");
    });

    it('seule la branche main se déploie : toute autre branche est coupée', () => {
        const d = vercel.git.deploymentEnabled as Record<string, boolean>;
        expect(d.main).toBe(true);
        for (const motif of ['**', '*']) expect(d[motif]).toBe(false);
        expect(Object.keys(d).filter((k) => d[k] && k !== 'main')).toEqual([]);
    });
});

describe('service worker : jamais de réponse redirigée ou opaque en cache', () => {
    const sw = lit('public/sw.js');
    const source = /function cacheable\(res\) \{[\s\S]*?\n\}/.exec(sw)![0];
    const cacheable = new Function(`${source}; return cacheable;`)() as (r: unknown) => boolean;
    it('accepte UNIQUEMENT une réponse 200, de type basic, non redirigée', () => {
        expect(cacheable({ status: 200, type: 'basic', redirected: false })).toBe(true);
        expect(cacheable({ status: 200, type: 'basic', redirected: true })).toBe(false);
        expect(cacheable({ status: 200, type: 'opaque', redirected: false })).toBe(false);
        expect(cacheable({ status: 200, type: 'opaqueredirect', redirected: false })).toBe(false);
        expect(cacheable({ status: 200, type: 'cors', redirected: false })).toBe(false);
        expect(cacheable({ status: 0, type: 'opaqueredirect', redirected: false })).toBe(false);
        expect(cacheable({ status: 302, type: 'basic', redirected: false })).toBe(false);
        expect(cacheable({ status: 404, type: 'basic', redirected: false })).toBe(false);
        expect(cacheable(undefined)).toBe(false);
    });
    it('chaque écriture en cache est précédée du contrôle (aucun ancien test « status !== 200 » seul ne subsiste)', () => {
        expect((sw.match(/cache\.put\(/g) ?? []).length).toBe(3);
        expect((sw.match(/cacheable\(res\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
        expect(sw).not.toMatch(/if \(!res \|\| res\.status !== 200\) return res;/);
    });
    it('/api/* n\'est jamais servi ni mis en cache par le SW', () => {
        expect(sw).toMatch(/pathname\.startsWith\('\/api\/'\)\) return;/);
    });
    it('le nom du cache a changé (les caches de l\'ancienne version sont purgés à l\'activation)', () => {
        expect(sw).not.toContain("'financeai-v3'");
    });
});

describe('points d\'entrée des fonctions API', () => {
    it('chaque point d\'entrée appelle son gestionnaire avec la SEULE requête : aucune option ne passe', () => {
        const appels: Array<[string, RegExp]> = [
            ['api/yahoo/history.ts', /proxyYahooHistorique\(request\)/],
            ['api/yahoo/search.ts', /proxyYahooRecherche\(request\)/],
            ['api/proxy/fintable.ts', /proxyFintable\(request\)/],
        ];
        for (const [f, motif] of appels) {
            const src = lit(f);
            expect(src, f).toMatch(motif);
            expect(src.match(/proxy[A-Z]\w+\(/g) ?? [], f).toHaveLength(1);
            expect(src, f).not.toMatch(/headers\.get|searchParams|env\s*:/);
        }
    });
});
