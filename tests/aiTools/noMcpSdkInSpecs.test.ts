// tests/aiTools/noMcpSdkInSpecs.test.ts
//
// [ARCH-AITOOLS-SPLIT] Garde de la FRONTIÈRE browser-safe (ADR-1, plan Claude-in-app 2026-07-21) :
// les `mcp/tools/*.spec.ts` (logique pure des tools, consommée par l'app) et `services/aiTools/**`
// ne doivent JAMAIS importer le SDK serveur MCP (qui tire express/cors/hono — Node-only) ni un
// module natif Node. Sans cette garde, un import ajouté « pour dépanner » casserait le bundle
// navigateur ou le gonflerait en silence. Volume PROUVÉ avant le scan (leçon FISC-CONST-LINT :
// un scan qui rend 0 fichier protège zéro).

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Motifs d'IMPORT (pas de simple mention : un commentaire qui NOMME le SDK pour expliquer la
// frontière est légitime — seul un import/require le viole).
const FORBIDDEN = [
    "from '@modelcontextprotocol/",
    'require(\'@modelcontextprotocol/',
    "from 'express'",
    "from 'cors'",
    "from '@hono/",
    "from 'node:",
    'require(\'node:',
];

describe('[ARCH-AITOOLS-SPLIT] frontière browser-safe des specs de tools', () => {
    it('aucun *.spec.ts (services/aiTools/specs) ni fichier de services/aiTools n\'importe le SDK MCP / du Node-only', () => {
        const specDir = resolve(process.cwd(), 'services/aiTools/specs');
        const specNames = readdirSync(specDir).filter((f) => f.endsWith('.spec.ts'));
        // Volume : 19 specs attendus. Un fan-out incomplet = rouge.
        expect(specNames.length).toBeGreaterThanOrEqual(19);

        const files = specNames.map((f) => resolve(specDir, f));
        // Les fondations partagées par les specs doivent AUSSI rester browser-safe.
        files.push(resolve(specDir, '_toolSpec.ts'), resolve(specDir, '_dataAware.ts'), resolve(specDir, 'scrubWriteResult.ts'));
        files.push(resolve(process.cwd(), 'services/aiTools/appStateDefaults.ts'));
        const aiToolsDir = resolve(process.cwd(), 'services/aiTools');
        if (existsSync(aiToolsDir)) {
            for (const f of readdirSync(aiToolsDir)) {
                if (f.endsWith('.ts')) files.push(resolve(aiToolsDir, f));
            }
        }

        expect(files.length).toBeGreaterThanOrEqual(22); // 19 specs + 3 fondations
        for (const file of files) {
            const src = readFileSync(file, 'utf-8');
            for (const bad of FORBIDDEN) {
                expect(src.includes(bad), `${file} contient « ${bad} » (frontière browser-safe violée)`).toBe(false);
            }
        }
    });

    it('[AITOOLS-ENGINE-WORKER] aucun spec n\'appelle le moteur en DIRECT (calculateFutureProjection) — toujours runProjectionAsync', () => {
        const specDir = resolve(process.cwd(), 'services/aiTools/specs');
        const specNames = readdirSync(specDir).filter((f) => f.endsWith('.spec.ts'));
        expect(specNames.length).toBeGreaterThanOrEqual(19);
        for (const f of specNames) {
            const src = readFileSync(resolve(specDir, f), 'utf-8');
            expect(src.includes('calculateFutureProjection('), `${f} : appel moteur DIRECT (gèle l'UI)`).toBe(false);
        }
    });

    it('[chokepoint jsonContent] aucun spec ne construit sa sortie JSON à la main (text: JSON.stringify)', () => {
        const specDir = resolve(process.cwd(), 'services/aiTools/specs');
        const specNames = readdirSync(specDir).filter((f) => f.endsWith('.spec.ts'));
        expect(specNames.length).toBeGreaterThanOrEqual(19);
        for (const f of specNames) {
            const src = readFileSync(resolve(specDir, f), 'utf-8');
            expect(src.includes('text: JSON.stringify'), `${f} : sortie JSON hors chokepoint jsonContent`).toBe(false);
        }
    });
});
