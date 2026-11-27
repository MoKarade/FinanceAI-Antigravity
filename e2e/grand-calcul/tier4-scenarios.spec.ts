/**
 * Tier 4 — Parcours complets par personas québécois réalistes (Futur 4.0).
 *
 * Couvre :
 * - T4-01 : `couple-confort` (analyse profonde 100k + mémorisation + reload + infobulle + Bloc 3/4)
 * - T4-02 : `pre-retraite-riche` (objectif legs 500 k$, analyse profonde 100k, Anatomie d'une année FERR)
 * - T4-03 : `gilles-actif-decaisse` (71 ans décaissement, 4 scénarios, revenu net retraite positif)
 * - T4-04 : `couple-dettes` (situation endettée, 4 scénarios et Bloc 3/4 sans NaN ni blocage)
 * - T4-05 : `karim-immigre` (34 ans, prorata pensions, objectif FIRE, 4 scénarios & infobulle riche).
 */

import { test, expect } from '@playwright/test';
import {
  attacherCapteurErreurs,
  boutonScenario,
  epinglerInfobulleSurCourbe,
  executerEtAppliquerAnalyseProfonde,
  preparerFuturAvecPersona,
  verifierZeroDebordementHorizontal,
  zoneAnalyseUnifiee,
  zoneReperesCles,
  zoneScenarios,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 Tier 4 — Parcours Personas Québec', () => {
  test.setTimeout(150_000);

  test('T4-01 : Persona couple-confort — parcours complet 100k + reload + infobulle', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    await executerEtAppliquerAnalyseProfonde(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible({ timeout: 15_000 });

    const tooltip = await epinglerInfobulleSurCourbe(page, 0.65, 0.5);
    await tooltip.getByRole('tab', { name: 'Par compte' }).click();
    await expect(tooltip.getByText(/REER|CELI/i).first()).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(zoneReperesCles(page).getByText(/\$/).first()).toBeVisible();
    await expect(zoneAnalyseUnifiee(page).getByText('Pourquoi ta courbe évolue ainsi')).toBeVisible();
    await verifierZeroDebordementHorizontal(page);
    errors.assertClean();
  });

  test('T4-02 : Persona pre-retraite-riche — legs 500 k$, 100k profonde & Anatomie FERR', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'pre-retraite-riche');

    await expect(zoneReperesCles(page).getByText(/Léguer\s*500/i).first()).toBeVisible();
    await executerEtAppliquerAnalyseProfonde(page);

    // Ouvrir Anatomie d'une année et inspecter la structure fiscale sans NaN
    await page.getByRole('button', { name: 'Anatomie', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 8_000 });
    const modalText = await modal.innerText();
    expect(modalText).not.toMatch(/\bNaN\b|\bundefined\b/);
    expect(modalText).toContain('Impôts & Cotisations');
    await page.keyboard.press('Escape');

    errors.assertClean();
  });

  test('T4-03 : Persona gilles-actif-decaisse — décaissement 71 ans & revenu net retraite', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'gilles-actif-decaisse');

    await expect(zoneReperesCles(page).getByText('Revenu mensuel net retraite')).toBeVisible();
    for (const label of ['Prudent / Stress', 'Optimisé IA', 'Favorable', 'Trajectoire réelle'] as const) {
      await boutonScenario(page, label).click();
      await expect(boutonScenario(page, label)).toHaveAttribute('aria-pressed', 'true');
    }

    const mainText = await page.locator('main').innerText();
    expect(mainText).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
    errors.assertClean();
  });

  test('T4-04 : Persona couple-dettes — résilience des 4 scénarios et recommandations prioritaires', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-dettes');

    for (const label of ['Prudent / Stress', 'Optimisé IA', 'Favorable', 'Trajectoire réelle'] as const) {
      await boutonScenario(page, label).click();
      await expect(boutonScenario(page, label)).toHaveAttribute('aria-pressed', 'true');
    }

    await expect(zoneAnalyseUnifiee(page).getByText(/Ce qu[’']il faut faire pour atteindre la trajectoire IA/i)).toBeVisible();
    const mainText = await page.locator('main').innerText();
    expect(mainText).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
    errors.assertClean();
  });

  test('T4-05 : Persona karim-immigre — prorata, horizon FIRE et infobulle riche', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'karim-immigre');

    await expect(zoneReperesCles(page).getByText('Indépendance financière', { exact: true })).toBeVisible();
    const tooltip = await epinglerInfobulleSurCourbe(page, 0.55, 0.5);
    await expect(tooltip.getByText(/Fourchette possible/i)).toBeVisible();
    await page.keyboard.press('Escape');

    const mainText = await page.locator('main').innerText();
    expect(mainText).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
    errors.assertClean();
  });
});
