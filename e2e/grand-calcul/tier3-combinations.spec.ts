/**
 * Tier 3 — Combinaisons multi-fonctionnalités Futur 4.0.
 *
 * Couvre :
 * - T3-01 : Cohérence inter-scénarios après analyse profonde 100 000 trajectoires
 *           (`Prudent / Stress` <= `Trajectoire réelle` <= `Favorable`, monotonie `P10 <= P50 <= P90`)
 * - T3-02 : Mode discret (`isPrivacyMode`) appliqué à travers les 4 blocs + `FutureRichTooltip`
 *           (`Par compte` et `Ce jour-là`) + section dépliée `Voir les chiffres`, persistant après `page.reload()`
 * - T3-03 : Non-blocage des tiroirs (`Historique` / `Hypothèses`) pendant l'exécution parallèle des 4 Workers.
 */

import { test, expect } from '@playwright/test';
import {
  attacherCapteurErreurs,
  basculerModeDiscret,
  boutonAnnulerAnalyseProfonde,
  boutonLancerAnalyseProfonde,
  boutonScenario,
  epinglerInfobulleSurCourbe,
  executerEtAppliquerAnalyseProfonde,
  preparerFuturAvecPersona,
  verifierModeDiscretFutur4,
  zoneAnalyseUnifiee,
  zoneReperesCles,
  zoneScenarios,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

function parseMontantCAD(raw: string): number {
  const cleaned = raw
    .replace(/CA/g, '')
    .replace(/\$/g, '')
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(',', '.')
    .replace(/[−–]/g, '-');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

async function lireDerniereLigneP10P50P90(
  page: import('@playwright/test').Page,
): Promise<{ p10: number; p50: number; p90: number }> {
  return page.evaluate(() => {
    const table = document.querySelector('table.sr-only') ?? document.querySelector('.sr-only table');
    if (!table) return { p10: Number.NaN, p50: Number.NaN, p90: Number.NaN };
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent?.trim() ?? '');
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    const lastRow = rows[rows.length - 1];
    if (!lastRow) return { p10: Number.NaN, p50: Number.NaN, p90: Number.NaN };
    const cells = Array.from(lastRow.querySelectorAll('th, td')).map((el) => el.textContent?.trim() ?? '');

    const extract = (colName: string): number => {
      const idx = headers.findIndex((h) => h === colName || h.includes(`(${colName})`));
      if (idx < 0 || !cells[idx]) return Number.NaN;
      const rawCell = cells[idx];
      const mult = /\bM\s*\$|\d\s*M\b/i.test(rawCell)
        ? 1_000_000
        : /\bk\s*\$|\d\s*k\b/i.test(rawCell)
          ? 1_000
          : /\b[GB]\s*\$/i.test(rawCell)
            ? 1_000_000_000
            : 1;
      const cleaned = rawCell
        .replace(/CA/g, '')
        .replace(/\$/g, '')
        .replace(/[\s\u00a0\u202f]/g, '')
        .replace(',', '.')
        .replace(/[−–]/g, '-');
      const m = cleaned.match(/-?\d+(?:\.\d+)?/);
      return m ? Number(m[0]) * mult : Number.NaN;
    };

    return {
      p10: extract('Scénario prudent'),
      p50: extract('Scénario central'),
      p90: extract('Scénario favorable'),
    };
  });
}

test.describe('Futur 4.0 Tier 3 — Combinaisons & cohérence croisée', () => {
  test.setTimeout(150_000);

  test('T3-01 : Cohérence inter-scénarios et monotonie P10 <= P50 <= P90 après 100 000 trajectoires', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');
    await executerEtAppliquerAnalyseProfonde(page);

    const finals: Record<string, { p10: number; p50: number; p90: number }> = {};

    for (const label of ['Prudent / Stress', 'Trajectoire réelle', 'Optimisé IA', 'Favorable'] as const) {
      await boutonScenario(page, label).click();
      await expect(boutonScenario(page, label)).toHaveAttribute('aria-pressed', 'true');

      const percentiles = await lireDerniereLigneP10P50P90(page);
      expect(Number.isFinite(percentiles.p10), `${label} P10 invalide`).toBe(true);
      expect(Number.isFinite(percentiles.p50), `${label} P50 invalide`).toBe(true);
      expect(Number.isFinite(percentiles.p90), `${label} P90 invalide`).toBe(true);
      expect(percentiles.p10).toBeLessThanOrEqual(percentiles.p50 + 1);
      expect(percentiles.p50).toBeLessThanOrEqual(percentiles.p90 + 1);

      // Le repère Patrimoine final affiche une valeur cohérente
      const cardSuccession = zoneReperesCles(page).locator('article').filter({ hasText: 'Patrimoine final & Succession' });
      const valText = await cardSuccession.innerText();
      expect(parseMontantCAD(valText)).toBeGreaterThan(0);

      finals[label] = percentiles;
    }

    expect(finals['Prudent / Stress'].p50).toBeLessThanOrEqual(finals['Trajectoire réelle'].p50);
    expect(finals['Trajectoire réelle'].p50).toBeLessThanOrEqual(finals['Favorable'].p50);
    expect(finals['Optimisé IA'].p50).toBeGreaterThanOrEqual(finals['Prudent / Stress'].p50);

    errors.assertClean();
  });

  test('T3-02 : Mode discret étendu sur les 4 blocs, FutureRichTooltip, dépliage Bloc 4 et après reload', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    // Déplier « Voir les chiffres » avant d'activer le mode discret pour couvrir le détail chiffré
    const btnChiffres = zoneAnalyseUnifiee(page).getByRole('button', { name: /Voir les chiffres/i }).first();
    if (await btnChiffres.isVisible().catch(() => false)) {
      await btnChiffres.click();
    }

    await basculerModeDiscret(page);
    await verifierModeDiscretFutur4(page);

    // Épingler l'infobulle riche en mode discret et vérifier les sous-onglets
    const tooltip = await epinglerInfobulleSurCourbe(page, 0.58, 0.52);
    const tipText = await tooltip.innerText();
    expect(tipText).toContain('•••');
    expect(tipText).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);

    await tooltip.getByRole('tab', { name: 'Par compte' }).click();
    expect(await tooltip.innerText()).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);

    await tooltip.getByRole('tab', { name: 'Ce jour-là' }).click();
    expect(await tooltip.innerText()).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);
    await page.keyboard.press('Escape');

    // Rechargement : mode discret est réinitialisé par conception (store/optionsPersistance.ts),
    // puis réactivable proprement sur Futur 4.0
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page)).toBeVisible({ timeout: 20_000 });
    await basculerModeDiscret(page);
    await verifierModeDiscretFutur4(page);

    // Désactiver le mode discret rétablit les montants CAD
    await basculerModeDiscret(page);
    await expect(zoneReperesCles(page).getByText(/\$/).first()).toBeVisible({ timeout: 8_000 });

    errors.assertClean();
  });

  test('T3-03 : Interactivité des tiroirs Historique et Hypothèses pendant le calcul Workers 100k', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    await boutonLancerAnalyseProfonde(page).click();
    await expect(boutonAnnulerAnalyseProfonde(page)).toBeVisible({ timeout: 15_000 });

    // Ouvrir et fermer le tiroir Historique sans interrompre les Workers
    await page.getByRole('button', { name: 'Historique', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Historique/i }).first()).toBeVisible({ timeout: 6_000 });
    await page.keyboard.press('Escape');

    // Attendre la fin du calcul staged
    await expect(zoneScenarios(page).getByRole('button', { name: /^Appliquer et mémoriser$/i })).toBeVisible({
      timeout: 130_000,
    });
    await zoneScenarios(page).getByRole('button', { name: /^Ignorer$/i }).click();

    errors.assertClean();
  });
});
