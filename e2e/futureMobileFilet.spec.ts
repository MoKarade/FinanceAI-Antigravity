/**
 * E2E Playwright — Filet Mobile Tactile & Audit des tiroirs Futur 4.0 (390×844, hasTouch: true).
 *
 * Vérifie :
 * 1. Aucun débordement horizontal sur Futur au repos ni à l'ouverture des tiroirs/modales
 *    (`Hypothèses`, `Anatomie`, `Historique`).
 * 2. Cibles tactiles >= 44 px sur tous les boutons de la barre d'outils courbe, de `FuturePeriodSelector`
 *    compact, du Bloc 1 (`FutureScenarioHeader`) et du Bloc 4 (`FutureUnifiedInsightsPanel`).
 * 3. Audit global du reste de `<main>` sous un plafond strict (zéro régression).
 */

import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

const PLAFOND_CIBLES_TROP_PETITES = 10;

test.describe('Futur 4.0 — Filet mobile tactile (390×844)', () => {
  test.setTimeout(120_000);

  test('cibles tactiles >= 44 px sur contrôles Futur 4.0 et zéro débordement dans Hypothèses, Anatomie, Historique', async ({
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

      // 0. Zéro débordement horizontal à 390 px
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

      // 1. Contrôles critiques Futur 4.0 : 100 % >= 44 px
      for (const selector of [
        'section[aria-label="Scénarios de trajectoire future"] button:visible',
        'section[aria-labelledby="futur-insights-unifies-titre"] button:visible',
      ]) {
        const btns = page.locator(selector);
        const count = await btns.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
          const box = await btns.nth(i).boundingBox();
          expect(box).not.toBeNull();
          expect(box!.height).toBeGreaterThanOrEqual(43.5);
        }
      }

      for (const actionLabel of ['Hypothèses', 'Anatomie', 'Historique']) {
        const btn = page.getByRole('button', { name: actionLabel, exact: true });
        const box = await btn.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      // 2. Plafond strict sur tout autre contrôle visible dans <main>
      const tropPetits = await page.evaluate(() => {
        const out: string[] = [];
        for (const btn of Array.from(document.querySelectorAll('main button'))) {
          const r = btn.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.height < 43.5) {
            out.push(`${(btn.textContent || btn.getAttribute('aria-label') || '').trim()} (${Math.round(r.height)}px)`);
          }
        }
        return out;
      });
      expect(tropPetits.length, `Boutons < 44 px : ${tropPetits.join(', ')}`).toBeLessThanOrEqual(
        PLAFOND_CIBLES_TROP_PETITES,
      );

      // 3. Ouvrir et fermer Hypothèses, Anatomie et Historique sans débordement
      for (const { bouton, titre } of [
        { bouton: 'Hypothèses', titre: /Modifier les hypothèses/i },
        { bouton: 'Anatomie', titre: /Anatomie d'une année/i },
        { bouton: 'Historique', titre: /^Historique$/i },
      ]) {
        await page.getByRole('button', { name: bouton, exact: true }).click();
        await expect(page.getByRole('heading', { name: titre }).first()).toBeVisible({ timeout: 6_000 });
        const ov = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
        expect(ov).toBe(true);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('heading', { name: titre }).first()).toBeHidden({ timeout: 6_000 });
      }
    } finally {
      await context.close();
    }
  });
});
