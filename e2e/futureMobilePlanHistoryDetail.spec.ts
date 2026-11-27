/**
 * E2E Playwright — Mobile (390×844) : Bloc 4 Actions prescriptives, Historique & Détail du mois.
 *
 * Couvre dans Futur 4.0 :
 * - Bloc 4 (`Analyse unifiée`) : `Voir les chiffres` (`aria-expanded`), `Appliquer dans Optimisé IA` (>= 44 px)
 * - Tiroir `Historique` sur mobile (ouverture, zéro débordement horizontal, fermeture)
 * - Feuille `Détail du mois` ouverte depuis `FutureRichTooltip` épinglé -> `Détail complet →`.
 */

import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 Mobile — Actions IA, Historique & Détail du mois', () => {
  test.setTimeout(120_000);

  test('Bloc 4 Optimisé IA, tiroir Historique et modale Détail du mois sur mobile 390×844', async ({ browser }) => {
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

      // 1. Bloc 4 Actions concrètes : cibles >= 44 px & bascule sur Optimisé IA
      const panel = page.locator('section[aria-labelledby="futur-insights-unifies-titre"]');
      await expect(panel).toBeVisible();

      const btnChiffres = panel.getByRole('button', { name: /Voir les chiffres/i }).first();
      if (await btnChiffres.isVisible().catch(() => false)) {
        expect((await btnChiffres.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await btnChiffres.click();
        await expect(panel.getByRole('button', { name: /Masquer les chiffres/i }).first()).toHaveAttribute(
          'aria-expanded',
          'true',
        );
      }

      const btnAppliquerIa = panel
        .getByRole('button', {
          name: /Appliquer à mon plan|Prioriser les dettes|Optimiser la localisation|Appliquer dans Optimisé IA/i,
        })
        .first();
      if (await btnAppliquerIa.isVisible().catch(() => false)) {
        expect((await btnAppliquerIa.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await btnAppliquerIa.click();
      }
      const btnScenarioIa = page
        .getByRole('region', { name: 'Scénarios de trajectoire future' })
        .getByRole('button', { name: /Optimisé IA/i });
      expect((await btnScenarioIa.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await btnScenarioIa.click();
      await expect(btnScenarioIa).toHaveAttribute('aria-pressed', 'true');

      // 2. Tiroir Historique
      await page.getByRole('button', { name: 'Historique', exact: true }).click();
      const histTitle = page.getByRole('heading', { name: /^Historique$/i }).first();
      await expect(histTitle).toBeVisible({ timeout: 6_000 });
      const ovHist = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(ovHist).toBe(true);
      await page.keyboard.press('Escape');
      await expect(histTitle).toBeHidden({ timeout: 6_000 });

      // 3. Épingler la courbe -> Détail complet -> modale Détail du mois
      const svg = page.locator('.recharts-wrapper svg.recharts-surface').first();
      await svg.scrollIntoViewIfNeeded();
      const box = (await svg.boundingBox())!;
      await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.52);

      const modal = page.getByRole('dialog', { name: /Détail du mois/i });
      if (!(await modal.isVisible().catch(() => false))) {
        const pinned = page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]');
        await expect(pinned).toBeVisible({ timeout: 8_000 });
        const btnDetail = pinned.getByRole('button', { name: /Détail complet/i });
        expect((await btnDetail.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await btnDetail.click();
        await expect(modal).toBeVisible({ timeout: 8_000 });
      }

      const ovDetail = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(ovDetail).toBe(true);
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
    } finally {
      await context.close();
    }
  });
});
