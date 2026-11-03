// Setup global pour tests Vitest (jest-dom matchers + cleanup React).
// Chargé via vitest.config.ts setupFiles.
// Partagé par les deux projets (node et jsdom) : la partie DOM ne se charge que si un `document`
// existe — un fichier `node` ne paie ni l'import de Testing Library ni celui de React DOM.
import { afterEach } from 'vitest';

if (typeof document !== 'undefined') {
    await import('@testing-library/jest-dom/vitest');
    const { cleanup } = await import('@testing-library/react');
    afterEach(() => {
        cleanup();
    });
}
