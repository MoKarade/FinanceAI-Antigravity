/**
 * [FUTUR-PANNEAU-FIXE] L'ancienne infobulle flottante (`createPortal` / `position: 'fixed'` /
 * `useChartTooltipPosition`) et `<PanneauJour` ont disparu de `FutureProjection.tsx`, remplacés par
 * `<FutureRichTooltip` intégré au conteneur du graphique via `useSelectionJour` et `choisirJourAffiche`.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readCodeOnly } from '../../helpers/source';

const SOURCE = readCodeOnly(
    resolve(__dirname, '../../../components/FutureProjection.tsx'),
    'RENDER_MAX_POINTS',
    0.35,
);

describe('[FUTUR-PANNEAU-FIXE] FutureRichTooltip intégré remplace PanneauJour et l’ancienne infobulle flottante', () => {
    it('aucun portail ni ancienne mécanique flottante ou PanneauJour', () => {
        expect(SOURCE).not.toContain('createPortal');
        expect(SOURCE).not.toContain('<PanneauJour');
        expect(SOURCE).not.toMatch(/position:\s*'fixed'/);
        expect(SOURCE).not.toContain('useChartTooltipPosition');
        expect(SOURCE).not.toContain('tooltipIsSheet');
    });

    it('FutureRichTooltip et choisirJourAffiche sont bien rendus par cet écran', () => {
        expect(SOURCE).toContain('<FutureRichTooltip');
        expect(SOURCE).toContain('choisirJourAffiche');
    });

    it('la sélection passe par la machine d’état partagée useSelectionJour', () => {
        expect(SOURCE).toContain('useSelectionJour');
        expect(SOURCE).toContain('selection.onHoverPoint');
        expect(SOURCE).toContain('selection.onChartLeave');
    });

    it('le scan lit bien du code décommenté', () => {
        expect(SOURCE).toContain('ResponsiveContainer');
        expect(SOURCE).not.toContain('Cast borné à 2 occurrences');
    });
});
