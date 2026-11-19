/**
 * E2E Playwright — Infobulle riche unifiée Futur 4.0 (`FutureRichTooltip`).
 *
 * Vérifie :
 * - À l'arrêt : aucune infobulle affichée (`[data-testid="future-rich-tooltip"]` absent).
 * - Au survol : `[data-testid="future-rich-tooltip"][data-pinned="false"]` apparaît avec fourchette `[P10, P90]`.
 * - Au clic : bascule en `[data-pinned="true"]` (« Jour épinglé »), conserve sa date même si la souris bouge,
 *   permet de naviguer entre les 4 sous-onglets (`Valeur nette`, `Entrées / sorties`, `Par compte`, `Ce jour-là`),
 *   d'ouvrir `Détail complet →` puis de fermer proprement via `Escape` ou le bouton `Fermer`.
 */

import { test, expect, type Page } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function openFuturePage(page: Page): Promise<void> {
  await page.addInitScript(`
    ${scriptBypassOnboarding()}
    try { sessionStorage.setItem('financeai:offline_bypass', '1'); } catch {}
  `);
  await page.goto('/?nogate=1');
  await page.waitForLoadState('domcontentloaded');
  await activateTestMode(page);
  await page.goto('/?nogate=1#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Futur 4.0 — Infobulle riche unifiée (hover, pin, onglets, Détail complet)', () => {
  test.setTimeout(120_000);

  test('survol affiche l’infobulle non épinglée, clic l’épingle, onglets & Escape la ferment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openFuturePage(page);

    const tooltip = page.locator('[data-testid="future-rich-tooltip"]');
    await expect(tooltip).toHaveCount(0);
    await expect(page.locator('[data-panneau-jour]')).toHaveCount(0);

    const svgSurface = page.locator('.recharts-wrapper svg.recharts-surface').first();
    await expect(svgSurface).toBeVisible();
    await svgSurface.scrollIntoViewIfNeeded();
    const box = await svgSurface.boundingBox();
    expect(box).not.toBeNull();

    // 1. Survol -> data-pinned="false"
    await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.5);
    await expect(page.locator('[data-testid="future-rich-tooltip"][data-pinned="false"]')).toBeVisible({
      timeout: 8_000,
    });
    await expect(tooltip.getByText(/Fourchette \[P10, P90\]/i)).toBeVisible();

    // 2. Clic -> data-pinned="true"
    await page.mouse.click(box!.x + box!.width * 0.62, box!.y + box!.height * 0.5);
    const modalDirect = page.getByRole('dialog', { name: /Détail du mois/i });
    if (await modalDirect.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(modalDirect).toBeHidden();
      await page.mouse.click(box!.x + box!.width * 0.67, box!.y + box!.height * 0.48);
    }

    const pinned = page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]');
    await expect(pinned).toBeVisible({ timeout: 8_000 });
    await expect(pinned.getByText('Jour épinglé')).toBeVisible();

    const datePinned = (await pinned.innerText()).match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
    expect(datePinned).toBeTruthy();

    // Déplacer la souris ailleurs sur la courbe ne doit pas déranger le jour épinglé
    await page.mouse.move(box!.x + box!.width * 0.25, box!.y + box!.height * 0.5);
    await page.waitForTimeout(200);
    expect(await pinned.innerText()).toContain(datePinned!);

    // 3. Sous-onglets Par compte & Ce jour-là
    await pinned.getByRole('tab', { name: 'Par compte' }).click();
    await expect(pinned.getByRole('tab', { name: 'Par compte' })).toHaveAttribute('aria-selected', 'true');
    await pinned.getByRole('tab', { name: 'Ce jour-là' }).click();
    await expect(pinned.getByRole('tab', { name: 'Ce jour-là' })).toHaveAttribute('aria-selected', 'true');

    // 4. Détail complet -> modale -> Escape ferme modale puis 2e Escape ferme tooltip
    await pinned.getByRole('button', { name: /Détail complet/i }).click();
    await expect(modalDirect).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
    await expect(modalDirect).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
  });
});
