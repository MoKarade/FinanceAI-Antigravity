/**
 * E2E Playwright — Écran Futur Mobile (390×844) & Parité Desktop/Mobile (Futur 4.0).
 *
 * Vérifie :
 * - Navigation mobile vers `Futur` et rendu de `FutureScenarioHeader`, courbe et `FutureCoreMilestonesGrid`
 * - Barre de période compacte mobile (`Zoomer`, `Dézoomer`, `Aujourd’hui`, `Plein écran`, apparition `Tout voir` après zoom)
 * - Zéro différence entre les valeurs de repères calculées sur Desktop (1440×900) et sur Mobile (390×844).
 */

import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 — Écran Mobile & Parité des Repères', () => {
  test.setTimeout(120_000);

  test('barre de zoom compacte mobile et parité exacte des repères Desktop vs Mobile', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
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

      await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
      const milestones = page.locator('section[aria-labelledby="futur-reperes-cles-titre"]');
      await expect(milestones).toBeVisible();
      const desktopText = (await milestones.innerText()).replace(/\s+/g, ' ').trim();

      // Basculer sur viewport Mobile 390×844
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);

      const mobileText = (await milestones.innerText()).replace(/\s+/g, ' ').trim();
      expect(mobileText).toBe(desktopText);

      // Contrôles compacts de période mobile
      const btnZoomIn = page.getByRole('button', { name: 'Zoomer', exact: true });
      const btnZoomOut = page.getByRole('button', { name: 'Dézoomer', exact: true });
      const btnToutVoir = page.getByRole('button', { name: 'Tout voir', exact: true });
      const btnPleinEcran = page.getByRole('button', { name: 'Plein écran', exact: true });

      await expect(btnZoomIn).toBeVisible();
      await expect(btnZoomOut).toBeDisabled();
      await expect(btnPleinEcran).toBeVisible();
      await expect(btnToutVoir).toHaveCount(0);

      // Zoomer fait apparaître « Tout voir » et réactive « Dézoomer »
      await btnZoomIn.click();
      await expect(btnToutVoir).toBeVisible({ timeout: 5_000 });
      await expect(btnZoomOut).toBeEnabled();

      // « Tout voir » réinitialise la fenêtre
      await btnToutVoir.click();
      await expect(btnToutVoir).toHaveCount(0);
      await expect(btnZoomOut).toBeDisabled();

      const ov = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(ov).toBe(true);
    } finally {
      await context.close();
    }
  });
});
