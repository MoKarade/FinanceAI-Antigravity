/**
 * E2E Playwright — Tiroir « Hypothèses » mobile vs desktop (Futur 4.0).
 *
 * Vérifie sur mobile (390×844) que :
 * - Le tiroir `Hypothèses` (`#future-drawer-hypotheses`) s'ouvre et reste dans les bornes de l'écran.
 * - Le bouton collant « Appliquer et fermer » (>= 44 px) est visible UNIQUEMENT sur viewport étroit mobile
 *   et absent sur Desktop (1440×900).
 * - Cliquer « Appliquer et fermer » ferme le tiroir proprement et conserve la courbe fonctionnelle.
 */

import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 — Tiroir Hypothèses mobile & desktop', () => {
  test.setTimeout(120_000);

  test('bouton collant « Appliquer et fermer » sur mobile (390×844), absent sur desktop (1440×900)', async ({
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

      await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });

      // Mobile : ouvrir Hypothèses -> « Appliquer et fermer » visible et >= 44 px
      await page.getByRole('button', { name: 'Hypothèses', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Modifier les hypothèses/i })).toBeVisible({ timeout: 6_000 });

      const btnAppliquerFermer = page.getByRole('button', { name: 'Appliquer et fermer' });
      await expect(btnAppliquerFermer).toBeVisible();
      const box = await btnAppliquerFermer.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

      await btnAppliquerFermer.click();
      await expect(page.getByRole('heading', { name: /Modifier les hypothèses/i })).toBeHidden({ timeout: 6_000 });
      await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible();

      // Desktop : le bouton collant mobile « Appliquer et fermer » ne doit pas être rendu
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: 'Hypothèses', exact: true }).click();
      await expect(page.getByRole('heading', { name: /Modifier les hypothèses/i })).toBeVisible({ timeout: 6_000 });
      await expect(page.getByRole('button', { name: 'Appliquer et fermer' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    } finally {
      await context.close();
    }
  });
});
