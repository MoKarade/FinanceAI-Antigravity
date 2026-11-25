// Gardes du service worker (`public/sw.js`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const lit = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

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
