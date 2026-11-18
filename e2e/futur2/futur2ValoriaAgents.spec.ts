import { test, expect, type Page } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode, ecarterLeRail } from '../helpers/setup';

async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page
    .getByRole('button', { name: /Continuer en mode local|Continuer sans compte/i })
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

test.describe('Futur × 7 Agents Valoria + déblocage chargement hors test mode', () => {
  test.setTimeout(90_000);

  test('Futur sans prérequis ni mode test ne reste jamais bloqué sur un spinner et /assets inexistant répond 404', async ({ page }) => {
    const errors = attacherGardeErreurs(page);
    await page.addInitScript(scriptBypassOnboarding());

    const assetMissing = await page.request.get('/assets/chunk-inexistant-test.js');
    expect([404, 400]).toContain(assetMissing.status());

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
      page.getByText(/Complète d[’']abord ton profil|Projection retraite|Futur/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    expect(errors.pageErrors).toEqual([]);
    expect(errors.serverErrors).toEqual([]);
  });

  test('Mode test : Agents IA (7 Agents) calcule Futur et affiche le panneau Placements × 7 Agents', async ({ page }) => {
    const errors = attacherGardeErreurs(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('button', { name: /^Futur$/i }).click();

    const optionAgents = page.getByRole('button', { name: /Agents IA\s*\(7 Agents\)/i });
    await expect(optionAgents).toBeVisible({ timeout: 20_000 });

    const boxBtn = await optionAgents.boundingBox();
    expect(boxBtn?.height ?? 0).toBeGreaterThanOrEqual(44);
    await optionAgents.click();

    const sectionPanel = page.getByRole('region', {
      name: /Prévisions des placements par les 7 agents Valoria/i,
    });
    await expect(sectionPanel).toBeVisible({ timeout: 15_000 });

    const activeStateBtn = sectionPanel.getByRole('button', {
      name: /Actif sur la courbe Futur|Propulser la courbe Futur par les 7 Agents/i,
    });
    await expect(activeStateBtn).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    await expect(sectionPanel.getByText(/Médiane à 5 ans/i)).toBeVisible();
    await expect(sectionPanel.getByText(/Médiane à 10 ans/i)).toBeVisible();

    const rayonXBtn = sectionPanel.getByRole('button', { name: /Explorer .* dans le Rayon-X/i }).first();
    if (await rayonXBtn.isVisible().catch(() => false)) {
      const boxRayon = await rayonXBtn.boundingBox();
      expect(boxRayon?.height ?? 0).toBeGreaterThanOrEqual(44);
    }

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.serverErrors).toEqual([]);
  });
});
