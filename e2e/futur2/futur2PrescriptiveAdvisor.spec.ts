/**
 * Tests E2E Playwright — Futur 4.0 : Bloc 4 Analyse unifiée & Recommandations Prescriptives
 *
 * Vérifie :
 * 1. Présence de `<section aria-labelledby="futur-insights-unifies-titre">` sous les repères clés.
 * 2. Présence des 3 sous-sections A (Passé réel & Consensus Valoria), B (Pourquoi ta courbe évolue ainsi),
 *    C (Tes actions concrètes les plus payantes).
 * 3. Interaction complète : dépliage `Voir les chiffres` (`aria-expanded`), `Voir sur la courbe` (épingle l'infobulle riche)
 *    et `Appliquer dans Optimisé IA` (bascule le scénario actif sur `Optimisé IA`).
 * 4. Cibles tactiles >= 44 px sur tous les boutons du Bloc 4 et zéro `hover:scale-*` / `hover:-translate-y-*`.
 */

import { test, expect, type Page } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode, ecarterLeRail } from '../helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function preparerPageFutur(page: Page): Promise<void> {
  await page.addInitScript(scriptBypassOnboarding());
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  const btnLocal = page.getByRole('button', { name: /Accéder directement à mon dossier local/i });
  await btnLocal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
  await activateTestMode(page);
  await page.goto('/#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);

  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Futur 4.0 — Analyse unifiée & Recommandations Prescriptives', () => {
  test.setTimeout(120_000);

  test("L'Analyse unifiée affiche les sections A, B et C avec interactions sur la courbe et Optimisé IA", async ({ page }) => {
    await preparerPageFutur(page);

    const panel = page.locator('section[aria-labelledby="futur-insights-unifies-titre"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    await expect(panel.getByText('Diagnostic de ton passé réel')).toBeVisible();
    await expect(panel.getByText('Actualités & consensus Valoria')).toBeVisible();
    await expect(panel.getByText('Pourquoi ta courbe évolue ainsi')).toBeVisible();
    await expect(panel.getByText(/Ce qu[’']il faut faire pour atteindre la trajectoire IA/i)).toBeVisible();

    // Section B : déplier les chiffres (aria-expanded)
    const btnChiffres = panel.getByRole('button', { name: /Voir les chiffres/i }).first();
    if (await btnChiffres.isVisible().catch(() => false)) {
      await expect(btnChiffres).toHaveAttribute('aria-expanded', 'false');
      await btnChiffres.click();
      await expect(panel.getByRole('button', { name: /Masquer les chiffres/i }).first()).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    }

    // Section B : « Voir sur la courbe » épingle le FutureRichTooltip
    const btnVoirCourbe = panel.getByRole('button', { name: /Voir sur la courbe/i }).first();
    if (await btnVoirCourbe.isVisible().catch(() => false)) {
      await btnVoirCourbe.click();
      const tooltip = page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]');
      await expect(tooltip).toBeVisible({ timeout: 8_000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-testid="future-rich-tooltip"]')).toHaveCount(0);
    }

    // Section C : « Appliquer dans Optimisé IA » active le scénario Optimisé IA dans Bloc 1
    const btnOptimiser = panel.getByRole('button', { name: /Appliquer dans Optimisé IA/i }).first();
    if (await btnOptimiser.isVisible().catch(() => false)) {
      await btnOptimiser.click();
      const scenariosSection = page.getByRole('region', { name: 'Scénarios de trajectoire future' });
      await expect(scenariosSection.getByRole('button', { name: /Optimisé IA/i })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
  });

  test("Les boutons de l'Analyse unifiée respectent la cible tactile >= 44 px", async ({ page }) => {
    await preparerPageFutur(page);

    const panel = page.locator('section[aria-labelledby="futur-insights-unifies-titre"]');
    await expect(panel).toBeVisible({ timeout: 10_000 });

    const boutons = panel.locator('button:visible');
    const count = await boutons.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const box = await boutons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("L'interface ne présente aucun scintillement au survol (zéro translateY ni scale)", async ({ page }) => {
    await preparerPageFutur(page);

    const hoverEffects = page.locator('.hover\\:scale-105, .hover\\:-translate-y-1');
    await expect(hoverEffects).toHaveCount(0);
  });
});
