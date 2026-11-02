// tests/appDeepLinkActions.test.ts
//
// Les deep-links `#ACTIONS` (fusionné dans l'Assistant) et `#ASSISTANT` (retiré le 28/10/2026, tout
// passe par LIA) doivent REDIRIGER vers FUTURE — jamais un 404 silencieux (ni l'un ni l'autre
// n'existe plus dans l'enum). App.tsx n'est pas rendable en test (providers lourds) → verrou par TEST-SCAN
// du source, volume prouvé (convention FISC-CONST-LINT / leçon « App non-rendable »).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Tab } from '../types';

// [GODFILE-APP] La logique de hash a déménagé d'App.tsx vers hooks/useTabNavigation.ts (extraction
// telle quelle) — la garde suit le code, le FAIT défendu ne change pas.
const src = readFileSync(resolve(process.cwd(), 'hooks/useTabNavigation.ts'), 'utf8');

describe('deep-links #ACTIONS et #ASSISTANT → FUTURE (useTabNavigation, scan du source)', () => {
    it('volume prouvé : le fichier scanné est bien le hook de navigation entier', () => {
        // Mesuré 2026-09-04 : ~4 100 caractères (le hook est plus petit qu'App.tsx entier).
        expect(src.length).toBeGreaterThan(2500);
        expect(src).toContain('applyHash');
    });

    it('le redirect explicite existe AVANT le check générique (hash ACTIONS ou ASSISTANT → Tab.FUTURE + URL réécrite)', () => {
        const redirectIdx = src.indexOf("hash === 'ACTIONS' || hash === 'ASSISTANT'");
        const genericIdx = src.indexOf('Object.values(Tab).includes(hash');
        expect(redirectIdx).toBeGreaterThan(-1);
        expect(genericIdx).toBeGreaterThan(-1);
        expect(redirectIdx).toBeLessThan(genericIdx); // sinon le check générique rejette ACTIONS en silence
        const redirectBlock = src.slice(redirectIdx, redirectIdx + 400);
        expect(redirectBlock).toContain('setActiveTab(Tab.FUTURE)');
        expect(redirectBlock).toContain("replaceState(null, '', '#FUTURE')");
    });

    it('ACTIONS et ASSISTANT ont bien disparu de l\'enum Tab (le redirect est le SEUL chemin restant)', () => {
        expect(Object.values(Tab)).not.toContain('ACTIONS');
        expect(Object.values(Tab)).not.toContain('ASSISTANT');
    });
});

describe('deep-link #DASHBOARD → DASHBOARD (useTabNavigation et TabRouter, scan du source)', () => {
    it('la route #DASHBOARD existe AVANT le check générique et active Tab.DASHBOARD', () => {
        const redirectIdx = src.indexOf("hash === 'DASHBOARD'");
        const genericIdx = src.indexOf('Object.values(Tab).includes(hash');
        expect(redirectIdx).toBeGreaterThan(-1);
        expect(genericIdx).toBeGreaterThan(-1);
        expect(redirectIdx).toBeLessThan(genericIdx);
        const redirectBlock = src.slice(redirectIdx, redirectIdx + 400);
        expect(redirectBlock).toContain('setActiveTab(Tab.DASHBOARD)');
        expect(redirectBlock).toContain("replaceState(null, '', '#DASHBOARD')");
    });

    it('la route DASHBOARD est rendue dans TabRouter via AccueilGoogle', () => {
        const router = readFileSync(resolve(process.cwd(), 'components/TabRouter.tsx'), 'utf8');
        expect(router.length).toBeGreaterThan(3000);
        expect(router).toContain('activeTab === Tab.DASHBOARD');
        expect(router).toContain('AccueilGoogle');
    });
});
