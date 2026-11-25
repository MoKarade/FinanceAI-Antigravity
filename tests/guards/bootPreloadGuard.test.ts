import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

describe('Garde de legerete du demarrage (Etape 2)', () => {
    it('utils/useDerivedFinancials et AccueilGoogle n importent pas useSimulationParams', () => {
        const derivedSrc = readFileSync(resolve(root, 'utils/useDerivedFinancials.ts'), 'utf8');
        const accueilSrc = readFileSync(resolve(root, 'components/AccueilGoogle.tsx'), 'utf8');

        expect(derivedSrc).not.toMatch(/useSimulationParams/);
        expect(accueilSrc).not.toMatch(/useSimulationParams/);
    });

    it('le coeur applicatif (hooks/ui hors Valoria) ne tire pas framer-motion ni i18next', () => {
        const animHookSrc = readFileSync(resolve(root, 'hooks/useAnimatedNumber.ts'), 'utf8');
        const animNetSrc = readFileSync(resolve(root, 'components/ui/AnimatedNetWorth.tsx'), 'utf8');
        const layoutSrc = readFileSync(resolve(root, 'components/Layout.tsx'), 'utf8');
        const navHookSrc = readFileSync(resolve(root, 'hooks/useTabNavigation.ts'), 'utf8');
        const indexSrc = readFileSync(resolve(root, 'index.tsx'), 'utf8');

        expect(animHookSrc).not.toMatch(/framer-motion/);
        expect(animNetSrc).not.toMatch(/framer-motion/);
        expect(layoutSrc).not.toMatch(/react-i18next/);
        expect(navHookSrc).not.toMatch(/react-i18next/);
        expect(indexSrc).not.toMatch(/i18n/);
        expect(indexSrc).not.toMatch(/latin-300/);
    });

    it('tabPrefetch n utilise plus import.meta.glob sur components/valoria', () => {
        const prefetchSrc = readFileSync(resolve(root, 'utils/tabPrefetch.ts'), 'utf8');
        expect(prefetchSrc).not.toMatch(/import\.meta\.glob/);
        expect(prefetchSrc).not.toMatch(/components\/valoria/);
    });

    it('App.tsx ne fait plus de snapshot protege declenche directement par l objet state complet', () => {
        const appSrc = readFileSync(resolve(root, 'App.tsx'), 'utf8');
        expect(appSrc).not.toMatch(/saveProtectedDossierSnapshot\(state\);\s*\}, \[state/);
    });
});
