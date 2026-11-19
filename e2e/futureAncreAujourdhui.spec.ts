/**
 * E2E Playwright — Ancre « Aujourd'hui » au repos et au clavier (Futur 4.0).
 *
 * Vérifie qu'à l'horloge fixée au 12 août 2026 (`2026-08-12`), l'état au repos dans
 * `[data-testid="google-finance-hero"]` ainsi que l'épinglage clavier (`Enter` sur la courbe)
 * affichent bien le jour exact `12/08/2026` et JAMAIS le 1er du mois (`01/08/2026`).
 */

import { test, expect, type Page } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

function scriptFixerDate12Aout2026(): string {
  return `
    (function() {
      const RealDate = Date;
      const targetMs = new RealDate('2026-08-12T15:00:00Z').getTime();
      const bootRealMs = RealDate.now();
      class MockDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(targetMs + (RealDate.now() - bootRealMs));
          } else {
            super(...args);
          }
        }
        static now() {
          return targetMs + (RealDate.now() - bootRealMs);
        }
      }
      window.Date = MockDate;
    })();
  `;
}

async function openFutureWithFixedClock(page: Page): Promise<void> {
  await page.addInitScript(scriptBypassOnboarding());
  await page.addInitScript(scriptFixerDate12Aout2026());
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await activateTestMode(page);
  await page.goto('/#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Futur 4.0 — Ancre Aujourd’hui exacte au repos et au clavier', () => {
  test.setTimeout(120_000);

  test('affiche 12/08/2026 dans GoogleFinanceHero et dans l’infobulle épinglée par Entrée', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFutureWithFixedClock(page);

    const hero = page.getByTestId('google-finance-hero');
    await expect(hero).toBeVisible();
    await expect(hero).toContainText(/Aujourd[’']hui/);
    await expect(hero).toContainText(/12\/08\/2026/);
    await expect(hero).not.toContainText(/01\/08\/2026/);

    // L'appui sur Entrée sur le conteneur de la courbe épingle le point du jour courant
    const courbe = page.getByRole('group', { name: /Courbe de vie/ });
    await courbe.focus();
    await page.keyboard.press('Enter');

    const tooltip = page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]');
    await expect(tooltip).toBeVisible({ timeout: 8_000 });
    await expect(tooltip).toContainText(/12\/08\/2026/);
    await expect(tooltip).not.toContainText(/01\/08\/2026/);
  });
});
