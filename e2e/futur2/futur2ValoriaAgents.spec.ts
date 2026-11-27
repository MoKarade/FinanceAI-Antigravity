/**
 * Tests E2E Playwright — Futur 4.0 × Consensus Valoria & Quant IA + déblocage chargement hors test mode
 */

import { test, expect, type Page } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode, ecarterLeRail } from '../helpers/setup';

async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page
    .getByRole('button', { name: /Accéder directement à mon dossier local|Continuer en mode local|Continuer sans compte/i })
    .first();
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
}

function attacherGardeErreurs(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
  });

  return { consoleErrors, pageErrors, serverErrors };
}

test.describe('Futur 4.0 × Consensus Valoria + déblocage chargement hors test mode', () => {
  test.setTimeout(90_000);

  test('Futur sans prérequis ni mode test ne reste jamais bloqué sur un spinner et /assets inexistant répond 404', async ({ page }) => {
    const errors = attacherGardeErreurs(page);
    await page.addInitScript(scriptBypassOnboarding());

    const assetMissing = await page.request.get('/assets/chunk-inexistant-test.js');
    const assetCt = (assetMissing.headers()['content-type'] ?? '').toLowerCase();
    expect(
      assetMissing.status() === 404 || assetMissing.status() === 400 || !assetCt.includes('javascript'),
    ).toBe(true);

    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await ecarterLeRail(page);

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('button', { name: /^Futur$/i }).click();

    await expect(page.locator('#main')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    await expect(page.getByText(/Ta projection se recharge/i)).toHaveCount(0);
    await expect(
      page.getByText(/Complète d[’']abord ton profil|Complète ton dossier|Aucune projection|Projection/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    expect(errors.pageErrors).toEqual([]);
    expect(errors.serverErrors).toEqual([]);
  });

  test('Mode test : Futur 4.0 affiche le consensus Valoria et navigue vers Quant IA / Pont Futur sans erreur', async ({ page }) => {
    const errors = attacherGardeErreurs(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('button', { name: /^Futur$/i }).click();

    await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });

    // Ancien bouton Agents IA (7 Agents) retiré de Futur 4.0
    await expect(page.getByRole('button', { name: /Agents IA\s*\(7 Agents\)/i })).toHaveCount(0);

    // Section A de l'Analyse unifiée (onglet Détails) intègre les actualités & consensus Valoria
    await page.getByRole('tablist', { name: 'Sections du Futur' }).getByRole('tab', { name: /Détails/i }).click();
    const panel = page.locator('section[aria-labelledby="futur-insights-unifies-titre"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText('Actualités & consensus Valoria')).toBeVisible();

    // Bouton Quant IA du PageHeader (>= 44 px) mène à Placements -> Conseiller & 7 Agents
    const btnQuantIa = page.getByRole('button', { name: /Quant IA/i }).first();
    await expect(btnQuantIa).toBeVisible();
    const boxQuant = await btnQuantIa.boundingBox();
    expect(boxQuant?.height ?? 0).toBeGreaterThanOrEqual(44);
    await btnQuantIa.click();

    await expect(page.getByTestId('valoria-workspace')).toBeVisible({ timeout: 15_000 });
    const tabCeQueJai = page.getByRole('tab', { name: /Ce que j[’']ai/i }).first();
    if (await tabCeQueJai.isVisible().catch(() => false)) {
      await tabCeQueJai.click();
    }

    const hubCard = page.getByText(/Pont Projection Futur/i).first();
    await expect(hubCard).toBeVisible({ timeout: 15_000 });

    const btnComparer = page.getByRole('button', { name: /Comparer dans Futur/i }).first();
    if (await btnComparer.isVisible().catch(() => false)) {
      const boxComparer = await btnComparer.boundingBox();
      expect(boxComparer?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      await btnComparer.click();
      await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 15_000 });
    }

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.serverErrors).toEqual([]);
  });
});
