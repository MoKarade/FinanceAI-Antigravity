/**
 * Tests E2E — Assertions KPI ciblées sur Accueil, Futur et Budget (mode test).
 */
import { test, expect } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode } from './helpers/setup';

test.describe('KPI quotidiens — Accueil, Futur et Budget', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await activateTestMode(page);
  });

  test('patrimoine net > 0 affiché sur Accueil (#DASHBOARD)', async ({ page }) => {
    await page.goto('/#DASHBOARD');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#main h1').first()).toBeVisible({ timeout: 10_000 });

    const valeurPatrimoine = page.getByTestId('animated-global-net-worth');
    await expect(valeurPatrimoine).toBeVisible({ timeout: 8_000 });

    const texteValeur = await valeurPatrimoine.innerText();
    const nombre = parseFloat(texteValeur.replace(/[\s$,\u00a0]/g, '').replace(',', '.'));
    expect(nombre, `Patrimoine net Accueil doit être > 0, reçu: "${texteValeur}"`).toBeGreaterThan(0);
  });

  test('patrimoine net > 0 affiché sur le Futur (#FUTURE)', async ({ page }) => {
    await page.goto('/#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('#main h1').first()).toBeVisible({ timeout: 10_000 });

    const patrimoineStat = page.locator('#main').getByText(/Patrimoine central/i).first();
    await expect(patrimoineStat).toBeVisible({ timeout: 8_000 });

    const valeurPatrimoine = page.locator('#main').getByText(/[\d\s,]+\s*\$/).first();
    await expect(valeurPatrimoine).toBeVisible({ timeout: 5_000 });

    const texteValeur = await valeurPatrimoine.innerText();
    const nombre = parseFloat(texteValeur.replace(/[\s$,\u00a0]/g, '').replace(',', '.'));
    expect(nombre, `Patrimoine Futur doit être > 0, reçu: "${texteValeur}"`).toBeGreaterThan(0);
  });

  test("coussin d'urgence affiche un nombre de mois > 0 dans Budget → Santé", async ({ page }) => {
    await page.goto('/#BUDGET');
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('tab', { name: 'Santé', exact: true }).click();

    const titreHealth = page.locator('#main').getByText('Santé financière').first();
    await expect(titreHealth).toBeVisible({ timeout: 10_000 });

    const labelCoussin = page.locator('#main').getByText(/coussin/i).first();
    await expect(labelCoussin).toBeVisible({ timeout: 5_000 });

    const valeurMois = page.locator('#main').getByText(/\d+[.,]\d+\s*mois/i).first();
    await expect(valeurMois).toBeVisible({ timeout: 5_000 });

    const texte = await valeurMois.innerText();
    const moisMatch = texte.match(/(\d+[.,]\d+)/);
    expect(moisMatch, `Format inattendu pour les mois: "${texte}"`).not.toBeNull();
    const mois = parseFloat((moisMatch![1] ?? '0').replace(',', '.'));
    expect(mois, `Coussin d'urgence doit être > 0 mois, reçu: "${texte}"`).toBeGreaterThan(0);
  });
});
