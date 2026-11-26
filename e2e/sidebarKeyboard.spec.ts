/**
 * Tests E2E — la barre latérale au CLAVIER, en moteur de rendu RÉEL (menu court Étape 4).
 *
 * Vérifie :
 *   1. Chaque item du menu court (Essentiel + Plus) puis Assistant, Sync et Profil est
 *      atteignable au Tab dans l'ordre affiché ;
 *   2. Entrée sur un item ouvre la page correspondante et active `aria-current="page"`.
 */
import { test, expect } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

const ORDRE = ['Accueil', 'Futur', 'Transactions', 'Budget', 'Dettes', 'Placements', 'Planification', 'Réglages'];

test.describe('Barre latérale — pilotage clavier (menu court)', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await activateTestMode(page);
  });

  test('Tab parcourt les 8 items courts puis Assistant, Sync et Profil ; Entrée ouvre la page', async ({ page }) => {
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('button', { name: 'Accueil' }).focus();
    const vus: string[] = [];
    for (let i = 0; i < ORDRE.length; i++) {
      vus.push(((await page.evaluate(() => document.activeElement?.textContent)) ?? '').trim());
      await page.keyboard.press('Tab');
    }
    expect(vus).toEqual(ORDRE);

    // Après « Réglages », Tab traverse Assistant, + Importer / Sync puis la carte Profil.
    expect((await page.evaluate(() => document.activeElement?.textContent)) ?? '').toContain('Assistant');
    await page.keyboard.press('Tab');
    expect((await page.evaluate(() => document.activeElement?.textContent)) ?? '').toContain('Importer / Sync');
    await page.keyboard.press('Tab');
    expect((await page.evaluate(() => document.activeElement?.textContent)) ?? '').toContain('Profil');

    await nav.getByRole('button', { name: 'Budget' }).focus();
    await page.keyboard.press('Enter');
    await expect(nav.getByRole('button', { name: 'Budget' })).toHaveAttribute('aria-current', 'page');
  });
});
