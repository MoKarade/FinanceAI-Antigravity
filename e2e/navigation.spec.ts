/**
 * Tests E2E — Navigation et smoke par onglet (menu Étape 4)
 *
 * Pour chaque onglet principal, vérifie :
 * - Aucune erreur JavaScript non-gérée (pageerror)
 * - L'onglet affiche un titre visible correspondant à la page
 */
import { test, expect } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode } from './helpers/setup';

const ONGLETS: Array<{ hash: string; nomAttendu: string }> = [
  { hash: 'DASHBOARD',     nomAttendu: 'Patrimoine net' },
  { hash: 'FUTURE',        nomAttendu: 'Projection' },
  { hash: 'TRANSACTIONS',  nomAttendu: 'Transactions' },
  { hash: 'BUDGET',        nomAttendu: 'Budget' },
  { hash: 'DEBT',          nomAttendu: 'Dette' },
  { hash: 'INVESTMENTS',   nomAttendu: 'Placements' },
  { hash: 'RETIREMENT',    nomAttendu: 'Retraite' },
  { hash: 'LIFE_PROJECTS', nomAttendu: 'Projets de vie' },
  { hash: 'TAX',           nomAttendu: 'Impôts' },
  { hash: 'SETTINGS',      nomAttendu: 'Réglages' },
];

test.describe('Navigation — smoke par onglet (mode test)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await activateTestMode(page);
  });

  for (const { hash, nomAttendu } of ONGLETS) {
    test(`onglet ${hash} — aucune erreur, titre visible`, async ({ page }) => {
      const erreurs: string[] = [];
      page.on('pageerror', (err) => erreurs.push(err.message));

      await page.goto(`/#${hash}`);
      await page.waitForLoadState('domcontentloaded');

      const titre = page.locator('#main h1').first();
      await expect(titre).toBeVisible({ timeout: 10_000 });

      const texte = await titre.innerText();
      expect(texte.toLowerCase()).toContain(nomAttendu.toLowerCase());
      expect(erreurs, `Erreurs JS sur l'onglet ${hash}`).toHaveLength(0);
    });
  }
});
