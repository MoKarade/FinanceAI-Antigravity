/**
 * [FUTUR-PANNEAU-FIXE] Garde de largeur et de placement de `FutureRichTooltip`.
 *
 * Vérifie que `FutureRichTooltip` borne sa largeur de manière responsive (`w-[min(...,calc(100%-1.5rem))]`)
 * sans déborder sur mobile ni recourir à un portail ou un `position: 'fixed'` piloté par le curseur.
 */
import { describe, it, expect } from 'vitest';
import { readCodeOnly } from '../helpers/source';
import { resolve } from 'node:path';

const SOURCE_TOOLTIP = readCodeOnly(
    resolve(__dirname, '../../components/future/FutureRichTooltip.tsx'),
    'PANNEAU_SECTIONS',
    0.35,
);

describe('[FUTUR-PANNEAU-FIXE] FutureRichTooltip a une largeur bornée responsive sans débordement', () => {
    it('utilise des largeurs bornées responsive `w-[min(...,calc(100%-1.5rem))]`', () => {
        const matches = SOURCE_TOOLTIP.match(/w-\[min\(\d+px,calc\(100%-1\.5rem\)\)\]/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('aucune position FIXE ni portail : intégré dans le conteneur relative du graphe', () => {
        expect(SOURCE_TOOLTIP).not.toContain('createPortal');
        expect(SOURCE_TOOLTIP).not.toMatch(/position:\s*'fixed'/);
    });

    it('le scan lit bien FutureRichTooltip décommenté (témoin anti-vacuité)', () => {
        expect(SOURCE_TOOLTIP).toContain('future-rich-tooltip');
        expect(SOURCE_TOOLTIP).toContain('PANNEAU_SECTIONS');
        expect(SOURCE_TOOLTIP).not.toContain('Zéro `position: fixed`');
    });
});
