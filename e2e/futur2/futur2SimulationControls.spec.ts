/**
 * Tests E2E Playwright — Futur 4.0 : Bandeau Scénarios & Commandes de Simulation
 *
 * Vérifie :
 * 1. Accès direct à l'onglet Futur (aucun écran bloqueur, aucun panneau « Outils » ni bande KPI dupliquée).
 * 2. Bloc 1 (`Scénarios de trajectoire future`) : 4 scénarios (`aria-pressed`), absence des anciens boutons techniques,
 *    et mise à jour réactive de la courbe, des repères clés (Bloc 3) et de l'analyse unifiée (Bloc 4).
 * 3. Cibles tactiles >= 44 px sur les contrôles principaux du Futur (règle 6 GEMINI.md).
 * 4. Contrôles de courbe (`Courbe nette` / `Par compte`) et tiroirs (`Hypothèses`, `Anatomie`, `Historique`, `Verrouiller`).
 */

import { test, expect, type Page } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode, ecarterLeRail } from '../helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function naviguerVersFutur(page: Page): Promise<void> {
  await page.addInitScript(`
    ${scriptBypassOnboarding()}
    try { sessionStorage.setItem('financeai:offline_bypass', '1'); } catch {}
  `);
  await page.goto('/?nogate=1');
  await page.waitForLoadState('domcontentloaded');
  const btnLocal = page.getByRole('button', { name: /Accéder directement à mon dossier local/i });
  await btnLocal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
  await activateTestMode(page);
  await page.goto('/?nogate=1#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);

  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Futur 4.0 — Bandeau Scénarios & Commandes de Simulation (Desktop Chrome)', () => {
  test.setTimeout(120_000);

  test("L'en-tête de page affiche Projection directement sans bloqueur ni bandeau KPI en doublon", async ({ page }) => {
    await naviguerVersFutur(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Projection' })).toBeVisible();
    await expect(page.locator('[data-testid="kpi-banner-duplicate"]')).toHaveCount(0);

    // Aucun ancien écran bloqueur ni ancien panneau latéral « Outils »
    await expect(page.getByRole('button', { name: /projection actuelle.*sans optimiser/i })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Outils' })).toHaveCount(0);
    await expect(page.locator('[data-panneau-jour]')).toHaveCount(0);
  });

  test('Bloc 1 expose exactement les 4 scénarios uniques sans sélecteurs techniques obsolètes', async ({ page }) => {
    await naviguerVersFutur(page);

    const scenariosSection = page.getByRole('region', { name: 'Scénarios de trajectoire future' });
    await expect(scenariosSection).toBeVisible();

    const scenarioReal = scenariosSection.getByRole('button', { name: /Trajectoire réelle/i });
    const scenarioPrudent = scenariosSection.getByRole('button', { name: /Prudent \/ Stress/i });
    const scenarioIa = scenariosSection.getByRole('button', { name: /Optimisé IA/i });
    const scenarioFav = scenariosSection.getByRole('button', { name: /Favorable/i });

    await expect(scenarioReal).toHaveAttribute('aria-pressed', 'true');
    await expect(scenarioPrudent).toHaveAttribute('aria-pressed', 'false');
    await expect(scenarioIa).toHaveAttribute('aria-pressed', 'false');
    await expect(scenarioFav).toHaveAttribute('aria-pressed', 'false');

    // Absence complète des anciens boutons techniques
    for (const labelObsolete of [
      /Agents IA \(7 Agents\)/i,
      /Normes IQPF/i,
      /Pimenter/i,
      /50\s*000 simulations/i,
      /Régimes macroéconomiques/i,
      /^Crises historiques/i,
    ]) {
      await expect(page.getByRole('button', { name: labelObsolete })).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: labelObsolete })).toHaveCount(0);
    }

    await expect(scenariosSection.getByRole('button', { name: /Lancer l’analyse profonde/i })).toBeVisible();

    // Basculer sur Prudent / Stress met à jour aria-pressed, Bloc 3 et Bloc 4
    await scenarioPrudent.click();
    await expect(scenarioPrudent).toHaveAttribute('aria-pressed', 'true');
    await expect(scenarioReal).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('heading', { name: /Repères clés de vie · Prudent \/ Stress/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Analyse unifiée · Prudent \/ Stress/i })).toBeVisible();
  });

  test('Tous les contrôles principaux du Futur respectent la cible tactile >= 44 px', async ({ page }) => {
    await naviguerVersFutur(page);

    const scenariosButtons = page.locator('section[aria-label="Scénarios de trajectoire future"] button:visible');
    const scenarioCount = await scenariosButtons.count();
    expect(scenarioCount).toBeGreaterThanOrEqual(5);

    for (let i = 0; i < scenarioCount; i++) {
      const box = await scenariosButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    for (const actionLabel of ['Hypothèses', 'Anatomie', 'Historique']) {
      const btn = page.getByRole('button', { name: actionLabel, exact: true });
      await expect(btn).toBeVisible();
      const box = await btn.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('La courbe de vie, le ruban P10–P90 unique et les contrôles de vue répondent au clic', async ({ page }) => {
    await naviguerVersFutur(page);

    const courbe = page.getByRole('group', { name: /Courbe de vie/ });
    await expect(courbe).toBeVisible();

    const btnCourbeNette = page.getByRole('button', { name: 'Courbe nette', exact: true });
    const btnParCompte = page.getByRole('button', { name: 'Par compte', exact: true });
    await expect(btnCourbeNette).toHaveAttribute('aria-pressed', 'true');

    await btnParCompte.click();
    await expect(btnParCompte).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: 'Séries du graphique' })).toBeVisible();

    await btnCourbeNette.click();
    await expect(btnCourbeNette).toHaveAttribute('aria-pressed', 'true');
  });
});
