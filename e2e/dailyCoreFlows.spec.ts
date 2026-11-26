/**
 * Tests E2E — Parcours quotidiens ordinateur (Accueil, Futur, Transactions, Budget, Planification, Réglages).
 * Vérifie 0 erreur JS/console et 0 débordement horizontal sur Desktop 1440×900.
 */
import { test, expect } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode } from './helpers/setup';

const assertZeroOverflow = async (page: import('@playwright/test').Page, ecran: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, `Débordement horizontal détecté sur ${ecran}`).toBe(false);
};

test.describe('Parcours quotidiens Desktop (Accueil, Futur, Transactions, Budget)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await activateTestMode(page);
  });

  test('Accueil, Futur, Transactions, Budget, Planification et Réglages fonctionnent sans erreur ni débordement', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    // 1. Accueil
    await page.goto('/#DASHBOARD');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('animated-global-net-worth')).toBeVisible({ timeout: 10_000 });
    const navButtons = page.locator('aside nav button');
    await expect(navButtons).toHaveCount(8);
    await expect(page.getByRole('button', { name: '2025→' })).toBeVisible();
    await page.getByRole('button', { name: '2025→' }).click();
    await assertZeroOverflow(page, 'Accueil');

    // 2. Futur
    await page.goto('/#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#main h1').first()).toContainText(/Projection/i);
    await expect(page.locator('#main svg').first()).toBeVisible({ timeout: 10_000 });
    await assertZeroOverflow(page, 'Futur');

    // 3. Transactions
    await page.goto('/#TRANSACTIONS');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#main h1').first()).toContainText(/Transactions/i);
    const searchInput = page.locator('#main input[type="search"], #main input[placeholder*="Rechercher"]').first();
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill('test');
      await searchInput.fill('');
    }
    await assertZeroOverflow(page, 'Transactions');

    // 4. Budget
    await page.goto('/#BUDGET');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#main h1').first()).toContainText(/Budget/i);
    await page.getByRole('tab', { name: 'Santé', exact: true }).click();
    await expect(page.locator('#main').getByText('Santé financière').first()).toBeVisible({ timeout: 8_000 });
    await assertZeroOverflow(page, 'Budget');

    // 5. Espace Planification -> Retraite -> Impôts
    await page.getByRole('button', { name: 'Planification' }).click();
    const planNav = page.getByRole('navigation', { name: 'Espace Planification' });
    await expect(planNav).toBeVisible({ timeout: 8_000 });
    await expect(planNav.getByRole('button')).toHaveCount(5);
    await planNav.getByRole('button', { name: 'Impôts' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Impôts/i);
    await assertZeroOverflow(page, 'Planification');

    // 6. Réglages (4 besoins)
    await page.goto('/#SETTINGS');
    await page.waitForLoadState('domcontentloaded');
    const settingsTablist = page.getByRole('tablist', { name: 'Sections des réglages' });
    await expect(settingsTablist.getByRole('tab')).toHaveCount(4);
    await settingsTablist.getByRole('tab', { name: /Banque auto/ }).click();
    await expect(page.getByLabel(/Jeton Fintable/i)).toBeVisible();
    await assertZeroOverflow(page, 'Réglages');

    expect(errors, `Erreurs navigateur détectées: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
