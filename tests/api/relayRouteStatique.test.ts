// Les fonctions Vercel de api/ doivent vivre à des chemins STATIQUES exacts et utiliser des extensions .js explicites.
import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');

function fichiers(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? fichiers(join(dir, e.name)) : [join(dir, e.name)]);
}

describe('routes statiques de api/', () => {
    it('les fonctions attendues existent aux chemins statiques exacts', () => {
        expect(existsSync(join(ROOT, 'api', 'sante.ts'))).toBe(true);
        expect(existsSync(join(ROOT, 'api', 'yahoo', 'history.ts'))).toBe(true);
        expect(existsSync(join(ROOT, 'api', 'yahoo', 'search.ts'))).toBe(true);
        expect(existsSync(join(ROOT, 'api', 'proxy', 'fintable.ts'))).toBe(true);
    });

    it('aucun fichier « attrape-tout » [...x] sous api/ (non routé par Vercel hors Next.js)', () => {
        const attrapeTout = fichiers(join(ROOT, 'api')).filter((f) => f.includes('[...'));
        expect(attrapeTout).toEqual([]);
    });

    it('imports relatifs exécutés côté serveur : extension .js explicite (ESM natif du runtime Node)', () => {
        const serveur = fichiers(join(ROOT, 'api')).filter((f) => f.endsWith('.ts'));
        const fautifs = serveur.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gm)]
            .map((m) => m[1]).filter((spec) => !spec.endsWith('.js')).map((spec) => `${f.slice(ROOT.length + 1)} → ${spec}`));
        expect(fautifs).toEqual([]);
    });
});
