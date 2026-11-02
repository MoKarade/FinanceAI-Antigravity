// [DURCISSEMENT-RELAIS] Le jeton de relais ne doit JAMAIS se retrouver dans le code client ou les routes API.
//
// Pourquoi : tout ce qui est préfixé VITE_ est recopié en clair dans le JavaScript servi au public. Le vieux
// `VITE_PROXY_ACCESS_TOKEN` y était : n'importe qui le lisait (l'audit l'a classé HAUTE). Ce test vérifie que
// le scanneur détecte bien un canari et qu'aucun fichier source ou de configuration n'expose `VITE_PROXY_ACCESS_TOKEN`
// ni l'en-tête `x-financeai-proxy`.
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const RACINE = resolve(__dirname, '../..');
const CANARI = `canari-jeton-relais-${Math.random().toString(36).slice(2)}${Date.now()}`;
const dossiers: string[] = [];
afterAll(() => { for (const d of dossiers) rmSync(d, { recursive: true, force: true }); });

function fichiers(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? fichiers(p) : [p];
    });
}

/** Fichiers de `dir` contenant l'une des chaînes ; sans jamais renvoyer la chaîne trouvée. */
function fichiersContenant(dir: string, motifs: string[]): string[] {
    return fichiers(dir).filter((f) => {
        const t = readFileSync(f, 'latin1');
        return motifs.some((m) => t.includes(m));
    }).map((f) => f.slice(dir.length + 1));
}

describe('bundle construit : aucun jeton de relais', () => {
    it('le scanneur détecte bien un canari (témoin : sans lui, un test vert ne prouverait rien)', () => {
        const d = mkdtempSync(join(tmpdir(), 'financeai-scan-'));
        dossiers.push(d);
        writeFileSync(join(d, 'a.js'), `var t="${CANARI}";`);
        writeFileSync(join(d, 'b.js'), 'var propre=1;');
        expect(fichiersContenant(d, [CANARI])).toEqual(['a.js']);
    });

    it('aucune source client ou route API ne référence VITE_PROXY_ACCESS_TOKEN ni x-financeai-proxy', () => {
        const repertoires = ['api', 'components', 'hooks', 'services', 'store', 'utils'];
        const tousLesFichiers = [
            ...repertoires.flatMap((r) => fichiers(join(RACINE, r))),
            join(RACINE, 'vite.config.ts'),
            join(RACINE, 'index.html'),
        ].filter((f) => existsSync(f) && /\.(ts|tsx|js|mjs|html)$/.test(f));

        expect(tousLesFichiers.length).toBeGreaterThan(20);
        const fautifs = tousLesFichiers.filter((f) => {
            const t = readFileSync(f, 'utf8');
            return t.includes('VITE_PROXY_ACCESS_TOKEN') || t.includes('x-financeai-proxy');
        }).map((f) => f.slice(RACINE.length + 1));

        expect(fautifs).toEqual([]);
    });
});
