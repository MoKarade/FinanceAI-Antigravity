/**
 * E2E Playwright — Granularité quotidienne & épinglage sur la courbe Futur 4.0.
 *
 * Vérifie :
 * - À l'arrêt, GoogleFinanceHero affiche la date d'aujourd'hui et aucune infobulle riche n'est épinglée.
 * - Un clic dans le graphe épingle `[data-testid="future-rich-tooltip"][data-pinned="true"]`.
 * - Les boutons `← Veille`, `Lendemain →` et le sélecteur `Pas des flèches` (`Jour`, `Mois`, `Année`) naviguent au jour près.
 * - Le survol en mode non épinglé déplace l'infobulle jour par jour le long de la courbe.
 * - Même zoomé (`5A`), l'infobulle épinglée reste au jour exact et la vue `Par compte` affiche les aires empilées.
 */

import { test, expect, type Page } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function openFuturePage(page: Page): Promise<void> {
  await page.addInitScript(scriptBypassOnboarding());
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await activateTestMode(page);
  await page.goto('/#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

async function lireDateTooltip(page: Page): Promise<string> {
  const txt = await page.locator('[data-testid="future-rich-tooltip"]').innerText();
  const match = txt.match(/\d{2}\/\d{2}\/\d{4}/);
  return match ? match[0] : '';
}

async function cliquerEtEpingler(page: Page, xRatio: number, yRatio: number): Promise<void> {
  const svgSurface = page.locator('.recharts-wrapper svg.recharts-surface').first();
  await expect(svgSurface).toBeVisible({ timeout: 10_000 });
  await svgSurface.scrollIntoViewIfNeeded();
  const box = await svgSurface.boundingBox();
  if (!box) throw new Error('Surface SVG introuvable');

  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);
  const modal = page.getByRole('dialog', { name: /Détail du mois/i });
  if (await modal.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await page.mouse.click(box.x + box.width * Math.min(0.86, xRatio + 0.06), box.y + box.height * 0.48);
  }
  await expect(page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]')).toBeVisible({
    timeout: 8_000,
  });
}

test.describe('Futur 4.0 — Sélection quotidienne & navigation pas à pas', () => {
  test.setTimeout(120_000);

  test('épinglage au clic, pas Jour/Mois/Année, navigation Veille/Lendemain et Escape', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFuturePage(page);

    // Au repos : GoogleFinanceHero affiche Aujourd’hui et aucun tooltip épinglé
    await expect(page.getByTestId('google-finance-hero')).toContainText(/Aujourd[’']hui/);
    await expect(page.locator('[data-testid="future-rich-tooltip"]')).toHaveCount(0);

    // Épinglage au clic sur la courbe
    await cliquerEtEpingler(page, 0.55, 0.52);
    const dateInitiale = await lireDateTooltip(page);
    expect(dateInitiale).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);

    // Le sélecteur Jour / Mois / Année est bien à l'intérieur du FutureRichTooltip
    await expect(page.locator('button:not([data-testid="future-rich-tooltip"] button)', { hasText: /^Jour$/ })).toHaveCount(0);
    const tooltip = page.locator('[data-testid="future-rich-tooltip"]');
    const groupePas = tooltip.getByRole('group', { name: 'Pas des flèches' });
    await expect(groupePas).toBeVisible();

    // Avancer de 1 jour avec Lendemain ->
    await groupePas.getByRole('button', { name: 'Jour', exact: true }).click();
    await tooltip.getByRole('button', { name: /Lendemain/i }).click();
    const dateLendemain = await lireDateTooltip(page);
    expect(dateLendemain).not.toBe(dateInitiale);

    // Revenir de 1 jour avec <- Veille
    await tooltip.getByRole('button', { name: /Veille/i }).click();
    expect(await lireDateTooltip(page)).toBe(dateInitiale);

    // Escape désépingle et ferme l'infobulle
    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
  });

  test('survol déplace la date sans épingler puis mode zoomé 5A + Par compte reste quotidien', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFuturePage(page);

    const svgSurface = page.locator('.recharts-wrapper svg.recharts-surface').first();
    await svgSurface.scrollIntoViewIfNeeded();
    const box = await svgSurface.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width * 0.35, box!.y + box!.height * 0.55);
    await expect(page.locator('[data-testid="future-rich-tooltip"][data-pinned="false"]')).toBeVisible({
      timeout: 8_000,
    });
    const d1 = await lireDateTooltip(page);

    await page.mouse.move(box!.x + box!.width * 0.75, box!.y + box!.height * 0.45);
    await page.waitForTimeout(150);
    const d2 = await lireDateTooltip(page);
    expect(d2).not.toBe(d1);

    // Zoom 5A + bascule Par compte : vérifier les aires empilées et le clic au jour
    await page.getByRole('button', { name: '5A', exact: true }).click();
    await page.getByRole('button', { name: 'Par compte', exact: true }).click();

    await expect(async () => {
      const areaCount = await page.locator('.recharts-area').count();
      expect(areaCount).toBeGreaterThan(1);
    }).toPass({ timeout: 8_000 });

    const barCount = await page.locator('.recharts-bar-rectangle').count();
    expect(barCount).toBeLessThan(80);

    await cliquerEtEpingler(page, 0.52, 0.5);
    expect(await lireDateTooltip(page)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
