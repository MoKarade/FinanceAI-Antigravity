/**
 * [FUTUR-PANNEAU-FIXE] Les quatre sections de `FutureRichTooltip` : leur ORDRE, et le fait
 * qu'il n'y ait qu'UNE source (`PANNEAU_SECTIONS`) pour les onglets et le rendu des panneaux.
 */
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readCodeOnly } from '../../helpers/source';
import { PANNEAU_SECTIONS, PANNEAU_SECTION_IDS } from '../../../components/future/panneauSections';

const SOURCE_TOOLTIP = readCodeOnly(
    resolve(__dirname, '../../../components/future/FutureRichTooltip.tsx'),
    'PANNEAU_SECTIONS',
    0.35,
);

describe('[FUTUR-PANNEAU-FIXE] ordre et unicité des sections dans FutureRichTooltip', () => {
    it('les quatre sections sont là, dans l’ordre choisi par Marc', () => {
        expect(PANNEAU_SECTION_IDS).toEqual(['valeur', 'flux', 'comptes', 'mouvements']);
    });

    it('chaque section porte un libellé et une phrase d’aide non vides', () => {
        for (const s of PANNEAU_SECTIONS) {
            expect(s.label.trim().length, `libellé vide pour ${s.id}`).toBeGreaterThan(0);
            expect(s.aide.trim().length, `aide vide pour ${s.id}`).toBeGreaterThan(0);
        }
    });

    it('les onglets SubTabs et les TabPanel dérivent de la MÊME liste PANNEAU_SECTIONS', () => {
        const derivations = SOURCE_TOOLTIP.match(/PANNEAU_SECTIONS\.map\(/g) ?? [];
        expect(derivations.length, 'onglets et panneaux doivent mapper PANNEAU_SECTIONS').toBeGreaterThanOrEqual(2);
    });

    it('aucun identifiant de section n’est écrit À LA MAIN dans le rendu', () => {
        for (const id of PANNEAU_SECTION_IDS) {
            expect(SOURCE_TOOLTIP, `l'identifiant « ${id} » est écrit en dur dans le rendu`)
                .not.toMatch(new RegExp(`['"\`]${id}['"\`]\\s*[,:)\\]]`));
        }
    });

    it('le scan lit bien le code de FutureRichTooltip décommenté', () => {
        expect(SOURCE_TOOLTIP).toContain('RENDU_SECTION');
        expect(SOURCE_TOOLTIP).toContain('SubTabs');
        expect(SOURCE_TOOLTIP).not.toContain('Infobulle riche intégrée au conteneur');
    });

    it('chaque section de la liste a bien un rendu câblé dans RENDU_SECTION', () => {
        for (const id of PANNEAU_SECTION_IDS) {
            expect(SOURCE_TOOLTIP, `pas de rendu câblé pour la section « ${id} »`)
                .toMatch(new RegExp(`\\b${id}:\\s*\\(`));
        }
    });
});
