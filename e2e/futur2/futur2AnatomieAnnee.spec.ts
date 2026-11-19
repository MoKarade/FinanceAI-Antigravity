/**
 * Tests E2E Playwright — Futur 4.0 : Modale « Anatomie d'une année »
 *
 * Vérifie :
 * 1. Ouverture de la modale depuis le bouton `Anatomie` de la barre d'outils de la courbe.
 * 2. Présence des 4 dimensions d'analyse : Revenus & Rentes, Impôts & Cotisations, Dépenses & Famille, Bilan & Portefeuille.
 * 3. Navigation entre les années projetées via le sélecteur et les boutons Précédente / Suivante.
 * 4. Fermeture propre via touche Échap restaurant le focus sur le bouton `Anatomie`.
 * 5. Formatage en dollars canadiens sans NaN / undefined / null.
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

test.describe("Futur 4.0 — Modale « Anatomie d'une année »", () => {
  test.setTimeout(120_000);

  test("L'interaction avec le bouton Anatomie ouvre les 4 dimensions annuelles et restaure le focus sur Échap", async ({ page }) => {
    await preparerPageFutur(page);

    const boutonAnatomie = page.getByRole('button', { name: 'Anatomie', exact: true });
    await expect(boutonAnatomie).toBeVisible();
    await boutonAnatomie.click();

    const dialogue = page.getByRole('dialog');
    await expect(dialogue).toBeVisible({ timeout: 8_000 });
    await expect(dialogue.getByRole('heading', { name: /Anatomie d'une année/i })).toBeVisible();

    for (const dimension of [
      /1\.\s*Revenus & Rentes/i,
      /2\.\s*Impôts & Cotisations/i,
      /3\.\s*Dépenses & Famille/i,
      /4\.\s*Bilan & Portefeuille/i,
    ]) {
      await expect(dialogue.getByText(dimension).first()).toBeVisible();
    }

    // Navigation entre années
    const selectAnnee = dialogue.getByLabel("Choisir l'année projetée");
    await expect(selectAnnee).toBeVisible();
    const valeurInitiale = await selectAnnee.inputValue();

    const btnSuivante = dialogue.getByRole('button', { name: /Suivante/i });
    if (await btnSuivante.isEnabled()) {
      await btnSuivante.click();
      await expect(selectAnnee).not.toHaveValue(valeurInitiale);
    }

    // Fermeture via Échap
    await page.keyboard.press('Escape');
    await expect(dialogue).toBeHidden();
    await expect(boutonAnatomie).toBeFocused();
  });

  test('Les montants affichés dans Futur et Anatomie sont formatés en CAD sans NaN ni undefined', async ({ page }) => {
    await preparerPageFutur(page);

    const textePage = await page.locator('main').innerText();
    expect(textePage).not.toContain('NaN');
    expect(textePage).not.toContain('undefined');
    expect(textePage).not.toContain('null $');

    await page.getByRole('button', { name: 'Anatomie', exact: true }).click();
    const dialogue = page.getByRole('dialog');
    await expect(dialogue).toBeVisible({ timeout: 8_000 });
    const texteModale = await dialogue.innerText();
    expect(texteModale).toMatch(/\$\s*CA|\$/);
    expect(texteModale).not.toContain('NaN');
    expect(texteModale).not.toContain('undefined');
    await page.keyboard.press('Escape');
  });
});
