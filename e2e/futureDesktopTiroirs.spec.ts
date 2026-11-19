/**
 * E2E Playwright — Tiroirs & Modales Desktop Futur 4.0 (Hypothèses, Anatomie, Historique).
 *
 * Vérifie sur Desktop (1440×900) que l'ancien panneau latéral « Outils » et le tiroir
 * « Plan d'action » n'existent plus, et que les 3 outils actuels (`Hypothèses`, `Anatomie`,
 * `Historique`) s'ouvrent et se ferment proprement via Échap.
 */

import { test, expect, type Page } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function openFutureDesktop(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(scriptBypassOnboarding());
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await activateTestMode(page);
  await page.goto('/#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Futur 4.0 — Tiroirs & Modales Desktop', () => {
  test.setTimeout(120_000);

  test('les actions Hypothèses, Anatomie et Historique s’ouvrent et se ferment sans panneau Outils', async ({
    page,
  }) => {
    await openFutureDesktop(page);

    // Ancien panneau latéral Outils et ancien Plan d'action supprimés dans Futur 4.0
    await expect(page.getByRole('region', { name: 'Outils' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Plan d['’]action/i })).toHaveCount(0);

    // 1. Tiroir Hypothèses
    const btnHypotheses = page.getByRole('button', { name: 'Hypothèses', exact: true });
    await expect(btnHypotheses).toBeVisible();
    await btnHypotheses.click();
    await expect(page.getByRole('heading', { name: /Modifier les hypothèses/i })).toBeVisible({ timeout: 6_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /Modifier les hypothèses/i })).toBeHidden({ timeout: 6_000 });

    // 2. Modale Anatomie
    const btnAnatomie = page.getByRole('button', { name: 'Anatomie', exact: true });
    await expect(btnAnatomie).toBeVisible();
    await btnAnatomie.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 6_000 });
    await expect(modal.getByRole('heading', { name: /Anatomie d'une année/i })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();

    // 3. Tiroir Historique
    const btnHistorique = page.getByRole('button', { name: 'Historique', exact: true });
    await expect(btnHistorique).toBeVisible();
    await btnHistorique.click();
    await expect(page.getByRole('heading', { name: /^Historique$/i })).toBeVisible({ timeout: 6_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('heading', { name: /^Historique$/i })).toBeHidden({ timeout: 6_000 });
  });
});
