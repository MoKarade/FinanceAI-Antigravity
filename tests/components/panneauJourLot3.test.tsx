// tests/components/panneauJourLot3.test.tsx
//
// [A11Y-PANNEAU-BOUTONS-FANTOMES] La BORDURE des boutons à contour de l'infobulle épinglée
// (`FutureRichTooltip`) atteint 3:1 contre les fonds sémantiques du socle visuel (WCAG 1.4.11).
// Les couleurs sémantiques sont lues directement depuis `index.css` (jamais recopiées en dur).
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderPanneauJour } from '../helpers/panneauJour';
import type { ProjectionChartPoint } from '../../services/projection/types';

type Rgb = [number, number, number];
const indexCss = fs.readFileSync(path.resolve(__dirname, '../../index.css'), 'utf8');
const cssVar = (nom: string): Rgb => {
    const matches = [...indexCss.matchAll(new RegExp(`${nom}\\s*:\\s*#([0-9a-fA-F]{6})\\s*;`, 'g'))];
    if (matches.length === 0) throw new Error(`variable ${nom} introuvable dans index.css`);
    const hex = matches[matches.length - 1][1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
};
const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contraste = (a: Rgb, b: Rgb) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const sur = (fg: Rgb, alpha: number, bg: Rgb): Rgb => fg.map((c, i) => c * alpha + bg[i] * (1 - alpha)) as Rgb;

const fonds = (): Rgb[] => [cssVar('--fond'), cssVar('--surface'), cssVar('--surface-douce')];

const jourCalme = {
    monthIndex: 60, dateLabel: '10 août 2031', age: 45, NetWorth: 0,
    isDailyPoint: true, dayIsReal: false,
} as unknown as ProjectionChartPoint;

describe('[A11Y-PANNEAU-BOUTONS-FANTOMES] bordures sémantiques >= 3:1 (mesuré)', () => {
    const boutons = ['← Veille', 'Lendemain →', 'Détail complet →', 'Fermer'];

    it.each(boutons)('« %s » : la bordure atteint 3:1 sur TOUS les fonds sémantiques du panneau', (nom) => {
        renderPanneauJour(jourCalme, { origine: 'epingle', onRelease: () => {} });
        const bouton = screen.getByText(nom).closest('button') as HTMLElement;
        expect(bouton).toBeTruthy();

        const hasChamp = /\bborder-bordure-champ\b/.test(bouton.className);
        const accentMatch = bouton.className.match(/(?:^|\s)border-accent\/(\d+)(?:\s|$)/);
        expect(
            hasChamp || Boolean(accentMatch),
            `aucune classe sémantique border-bordure-champ ou border-accent/<n> sur « ${nom} » (${bouton.className})`,
        ).toBe(true);

        for (const fond of fonds()) {
            const bordureRgb = hasChamp
                ? cssVar('--bordure-champ')
                : sur(cssVar('--accent'), Number(accentMatch![1]) / 100, fond);
            const r = contraste(bordureRgb, fond);
            expect(r, `${nom} : ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        }
    });

    it('le bouton Fermer désépingle bien le jour en mode épinglé', () => {
        const onRelease = vi.fn();
        renderPanneauJour(jourCalme, { origine: 'epingle', onRelease });
        fireEvent.click(screen.getByRole('button', { name: /Fermer/i }));
        expect(onRelease).toHaveBeenCalledTimes(1);
    });

    it('anti-vacuité : l’ancienne valeur (border-white/20) était SOUS 3:1 — la mesure sait échouer', () => {
        const r = Math.max(...fonds().map((f) => contraste(sur([255, 255, 255], 0.2, f), f)));
        expect(r).toBeLessThan(3);
    });
});
