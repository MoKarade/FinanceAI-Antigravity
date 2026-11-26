/**
 * Tests E2E — Parcours quotidiens téléphone 390×844 (project: mobile-chrome).
 * Vérifie 0 erreur JS/console et 0 débordement horizontal sur Accueil, Futur, Transactions,
 * Budget, menu Plus, Planification et Réglages.
 */
import { test, expect } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode } from './helpers/setup';

const assertZeroOverflow = async (page: import('@playwright/test').Page, ecran: string) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, `Débordement horizontal mobile détecté sur ${ecran}`).toBe(false);
};

test.describe('Parcours quotidiens Mobile 390×844', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await activateTestMode(page);
  });

  test('navigation tactile, écrans quotidiens, Plus → Planification et Réglages sans débordement ni erreur', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });

    // 1. Accueil mobile
    await page.goto('/#DASHBOARD');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('animated-global-net-worth')).toBeVisible({ timeout: 10_000 });
    const mobileBar = page.getByRole('navigation', { name: 'Navigation mobile' });
    await expect(mobileBar.getByRole('button')).toHaveCount(5);
    await assertZeroOverflow(page, 'Accueil mobile');

    // 2. Futur mobile
    await mobileBar.getByRole('button', { name: 'Futur' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Projection/i);
    await assertZeroOverflow(page, 'Futur mobile');

    // 3. Transactions mobile
    await mobileBar.getByRole('button', { name: 'Transactions' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Transactions/i);
    await assertZeroOverflow(page, 'Transactions mobile');

    // 4. Budget mobile
    await mobileBar.getByRole('button', { name: 'Budget' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Budget/i);
    await assertZeroOverflow(page, 'Budget mobile');

    // 5. Menu Plus → Retraite (Planification) → Impôts
    await mobileBar.getByRole('button', { name: "Plus d'options" }).click();
    const drawer = page.getByRole('navigation', { name: 'Autres destinations' });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: /Retraite/ }).click();
    await expect(drawer).toBeHidden();
    const planNav = page.getByRole('navigation', { name: 'Espace Planification' });
    await expect(planNav).toBeVisible();
    await planNav.getByRole('button', { name: 'Impôts' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Impôts/i);
    await assertZeroOverflow(page, 'Planification mobile');

    // 6. Réglages mobile (4 besoins + Profil)
    await mobileBar.getByRole('button', { name: "Plus d'options" }).click();
    await page.getByRole('navigation', { name: 'Autres destinations' }).getByRole('button', { name: /Réglages/ }).click();
    const settingsNav = page.getByRole('navigation', { name: 'Sections des réglages' });
    await expect(settingsNav).toBeVisible();
    await expect(settingsNav.getByRole('button')).toHaveCount(5);
    await assertZeroOverflow(page, 'Réglages mobile');

    expect(errors, `Erreurs mobile détectées: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
