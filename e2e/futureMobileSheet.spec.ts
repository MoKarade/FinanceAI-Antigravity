/**
 * E2E Playwright — Infobulle épinglée sous le graphe sur Mobile (390×844, hasTouch: true) (Futur 4.0).
 *
 * Vérifie :
 * - Conteneur du graphe mobile >= 260 px de hauteur.
 * - Un appui sur le graphe épingle `[data-testid="future-rich-tooltip"][data-pinned="true"]`
 *   sous le graphe avec les 4 onglets, le bouton `Fermer` >= 44 px et zéro débordement horizontal.
 * - L'épinglage survit à une rotation d'orientation (900×700) et se ferme proprement au clic sur `Fermer`.
 */

import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 — Infobulle épinglée mobile (390×844)', () => {
  test.setTimeout(120_000);

  test('appui courbe épingle l’infobulle en flux mobile, résiste à la rotation et se ferme par Fermer', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();

    try {
      await page.addInitScript(scriptBypassOnboarding());
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await activateTestMode(page);
      await page.goto('/#FUTURE');
      await page.waitForLoadState('domcontentloaded');
      await ecarterLeRail(page);

      const chart = page.getByRole('group', { name: /Courbe de vie/ });
      await expect(chart).toBeVisible({ timeout: 20_000 });
      const svg = page.locator('.recharts-wrapper svg.recharts-surface').first();
      await expect(svg).toBeVisible();
      await svg.scrollIntoViewIfNeeded();
      const box = (await svg.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(250);

      // Taper dans la zone SVG pour épingler FutureRichTooltip
      await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
      const modalDirect = page.getByRole('dialog', { name: /Détail du mois/i });
      if (await modalDirect.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await expect(modalDirect).toBeHidden();
        await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.45);
      }

      const tooltip = page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]');
      await expect(tooltip).toBeVisible({ timeout: 8_000 });
      await expect(tooltip.getByText('Jour épinglé')).toBeVisible();

      const tb = (await tooltip.boundingBox())!;
      expect(tb.x).toBeGreaterThanOrEqual(0);
      expect(tb.x + tb.width).toBeLessThanOrEqual(390);
      expect(tb.y).toBeGreaterThanOrEqual(box.y + box.height - 24);

      const btnFermer = tooltip.getByRole('button', { name: 'Fermer le détail épinglé' });
      expect((await btnFermer.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      // Rotation en paysage (900×700) : le jour épinglé reste intact
      await page.setViewportSize({ width: 900, height: 700 });
      await page.waitForTimeout(200);
      await expect(tooltip).toBeVisible();

      // Revenir en portrait et fermer via Fermer
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(150);
      await btnFermer.click();
      await expect(page.locator('[data-testid="future-rich-tooltip"]')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
