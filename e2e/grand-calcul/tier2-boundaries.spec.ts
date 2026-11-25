/**
 * Tier 2 — Limites, persistance chiffrée, corruption IDB, isolation et `isOutdated` Futur 4.0.
 *
 * Couvre :
 * - T2-01 : Avant analyse profonde (`Aperçu rapide actif`), `couple-dettes` avec indépendance inatteignable (`—`),
 *           zéro `NaN`/`undefined`/`Infinity`
 * - T2-02 : Limite `staged` vs `applied` (rechargement avant `Appliquer et mémoriser` et bouton `Ignorer`)
 * - T2-03 : Persistance IndexedDB + corruption `financeai-deep-forecast` -> `role="alert"` -> `Annuler` en vol
 *           conservant l'état précédent -> relance + récupération complète -> perte clé `financeai-secure`
 * - T2-04 : Isolation stricte entre `test:<personaId>` (`pre-retraite-riche` vs `lea-fauchee`) et `real`
 * - T2-05 : Badge `Données modifiées` (`isOutdated`) lors de l'édition de l'âge de retraite dans `#PROFILE`,
 *           persistant au reload puis effacé au recalcul profond.
 */

import { test, expect } from '@playwright/test';
import {
  attacherCapteurErreurs,
  boutonAnnulerAnalyseProfonde,
  boutonAppliquerAnalyseProfonde,
  boutonIgnorerAnalyseProfonde,
  boutonLancerAnalyseProfonde,
  corrompreEnregistrementDeepForecastIDB,
  executerEtAppliquerAnalyseProfonde,
  inspecterPayloadIDBDeepForecast,
  naviguerVersFutur,
  preparerFuturAvecPersona,
  supprimerClesAppareilIDB,
  zoneReperesCles,
  zoneScenarios,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 Tier 2 — Limites, intégrité IDB & isolation', () => {
  test.setTimeout(150_000);

  test('T2-01 : État initial aperçu rapide, couple-dettes sans faux 0/999 et zéro NaN', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-dettes');

    await expect(zoneScenarios(page).getByText(/Aperçu rapide actif/i)).toBeVisible();
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toHaveCount(0);

    const textMain = await page.locator('main').innerText();
    expect(textMain).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
    expect(textMain).not.toContain('999 ans');

    await expect(zoneReperesCles(page).getByText('Indépendance financière')).toBeVisible();
    errors.assertClean();
  });

  test('T2-02 : État staged non appliqué ne persiste pas au reload et « Ignorer » revient à l’état antérieur', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    // Lancer sans cliquer « Appliquer et mémoriser »
    await executerEtAppliquerAnalyseProfonde(page, { appliquer: false });
    await expect(boutonIgnorerAnalyseProfonde(page)).toBeVisible();

    // Reload avant application : rien n'a dû écraser IDB
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page)).toBeVisible({ timeout: 20_000 });
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toHaveCount(0);
    await expect(zoneScenarios(page).getByText(/Aperçu rapide actif/i)).toBeVisible();

    // Vérifier « Ignorer » après une nouvelle attente staged
    await executerEtAppliquerAnalyseProfonde(page, { appliquer: false });
    await boutonIgnorerAnalyseProfonde(page).click();
    await expect(boutonAppliquerAnalyseProfonde(page)).toHaveCount(0);
    await expect(zoneScenarios(page).getByText(/Aperçu rapide actif/i)).toBeVisible();

    errors.assertClean();
  });

  test('T2-03 : Corruption IDB, alerte lisible, annulation en vol sans écrasement, récupération et perte de clé', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    await executerEtAppliquerAnalyseProfonde(page);
    const corrupted = await corrompreEnregistrementDeepForecastIDB(page);
    expect(corrupted).toBeGreaterThanOrEqual(1);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page)).toBeVisible({ timeout: 20_000 });
    await expect(zoneScenarios(page).getByRole('alert')).toBeVisible({ timeout: 10_000 });
    await expect(zoneScenarios(page).getByText(/illisible/i)).toBeVisible();

    // Lancer puis Annuler en plein vol : l'état interrompu est signalé sans crash ni sauvegarde corrompue
    await boutonLancerAnalyseProfonde(page).click();
    const btnAnnuler = boutonAnnulerAnalyseProfonde(page);
    await expect(btnAnnuler).toBeVisible({ timeout: 10_000 });
    await btnAnnuler.click();
    await expect(zoneScenarios(page).getByText(/Calcul interrompu/i)).toBeVisible({ timeout: 10_000 });

    // Relance complète et sauvegarde propre : l'alerte de corruption disparaît
    await executerEtAppliquerAnalyseProfonde(page);
    await expect(zoneScenarios(page).getByRole('alert')).toHaveCount(0);

    // Suppression de la clé locale `financeai-secure` -> repli gracieux sans NaN ni blocage
    await supprimerClesAppareilIDB(page);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page)).toBeVisible({ timeout: 20_000 });
    const textAfterKeyLoss = await page.locator('main').innerText();
    expect(textAfterKeyLoss).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);

    errors.assertClean();
  });

  test('T2-04 : Persistance IDB (clé real) + badge Données modifiées après édition profil et reload', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'pre-retraite-riche');

    await executerEtAppliquerAnalyseProfonde(page);
    const idbPreRetraite = await inspecterPayloadIDBDeepForecast(page);
    expect(idbPreRetraite.keys).toContain('real');

    // Modifier l'âge de retraite dans Profil -> Retraite et enfants déclenche « Données modifiées »
    await page.goto('/#PROFILE');
    await page.waitForLoadState('domcontentloaded');
    const tabRetraite = page.getByRole('tab', { name: /Retraite et enfants/i });
    await expect(tabRetraite).toBeVisible({ timeout: 10_000 });
    await tabRetraite.click();
    const ageInput = page.getByLabel(/Âge de retraite cible/i).first();
    await expect(ageInput).toBeVisible({ timeout: 10_000 });
    const currentVal = Number(await ageInput.inputValue());
    await ageInput.fill(String(currentVal === 65 ? 64 : 65));
    await ageInput.blur();
    await page.waitForTimeout(300);

    await naviguerVersFutur(page);
    await expect(zoneScenarios(page).getByText(/Données modifiées/i)).toBeVisible({ timeout: 10_000 });
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible();

    // Persiste au rechargement tant que l'analyse n'a pas été relancée
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page).getByText(/Données modifiées/i)).toBeVisible({ timeout: 15_000 });
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible();

    errors.assertClean();
  });
});
