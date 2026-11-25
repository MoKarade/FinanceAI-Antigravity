import { describe, it, expect } from 'vitest';
import {
    calculerEchelleNetteSerree,
    classePastilleValoria,
    construireSerie1Mois,
    construireSparklineReelle,
} from '../../../components/accueil/accueilHelpers';

describe('accueilHelpers', () => {
    it('classePastilleValoria associe chaque signal à sa classe sémantique GF', () => {
        expect(classePastilleValoria('RENFORCER')).toBe('gf-delta-up');
        expect(classePastilleValoria('ALLEGER')).toBe('gf-delta-down');
        expect(classePastilleValoria('CONSERVER')).toBe('gf-delta-neutral');
    });

    it('calculerEchelleNetteSerree cadre proprement une série positive et un cas plat', () => {
        const plat = calculerEchelleNetteSerree([100_000, 100_000]);
        expect(plat.domaine[0]).toBeLessThan(100_000);
        expect(plat.domaine[1]).toBeGreaterThan(100_000);
        expect(plat.ticks.length).toBeGreaterThanOrEqual(3);

        const dynamique = calculerEchelleNetteSerree([110_000, 145_000, 180_000]);
        expect(dynamique.domaine[0]).toBeLessThanOrEqual(110_000);
        expect(dynamique.domaine[1]).toBeGreaterThanOrEqual(180_000);
        expect(dynamique.ticks[0]).toBe(dynamique.domaine[0]);
    });

    it('construireSparklineReelle et construireSerie1Mois gèrent séries vides et interpolées', () => {
        expect(construireSparklineReelle([])).toBe('0,11 48,11');
        expect(construireSparklineReelle([100, 120, 140]).split(' ')).toHaveLength(3);

        const serie = construireSerie1Mois(10_000, [9_500, 10_000], 500);
        expect(serie).toHaveLength(30);
        expect(serie[0]).toBe(9_500);
        expect(serie[29]).toBe(10_000);
        expect(construireSerie1Mois(0, [], 0)).toEqual([]);
    });
});
