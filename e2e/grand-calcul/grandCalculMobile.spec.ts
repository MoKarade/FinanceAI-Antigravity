/**
 * Suite E2E Grand Calcul — Mobile `390×844` tactile (`mobile-chrome` via `/Mobile/` dans le nom).
 *
 * 10 tests mobiles :
 * - 6 tests Tier 2 limites mobiles (2 × F10, 2 × F11, 2 × F12)
 * - 2 tests Tier 3 combinaisons mobiles (T3-13, T3-14)
 * - 2 tests Tier 4 parcours réels mobiles (T4-07, T4-08)
 */
import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail } from '../helpers/setup';
import {
  attacherCollecteursErreurs,
  auditerAbsenceHoverTransform,
  auditerCiblesTactilesConteneur,
  barreProgressionGrandCalcul,
  boutonAnnulerGrandCalcul,
  cartePredictionR2,
  extraireNombresCAD,
  extrairePourcentages,
  lancerGrandCalcul,
  lancerGrandCalculEtAttendre,
  largeurDefilable,
  ouvrirFuturAvecPersona,
  passerGardeLocale,
  revelerCourbeProjection,
  scriptBypassGates,
  toggleModeDiscret,
  verifierTexteSansValeursInvalides,
  zoneExplications,
  zoneGrandCalcul,
  zonePredictions,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

const LARGEUR_MOBILE = 390;

test.describe('Grand Calcul — Mobile 390×844 tactile (Tiers 2, 3 & 4)', () => {
  test.setTimeout(180_000);

  // =========================================================================
  // Tier 2 — Limites mobiles F10, F11, F12 (6 tests)
  // =========================================================================
  test('T2-F10-01 : panneau Grand Calcul sans débordement horizontal sur 390×844 (repos et exécution)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);

    await lancerGrandCalcul(page, { iterations: 100_000 });
    await expect(barreProgressionGrandCalcul(panel)).toBeVisible({ timeout: 10_000 });
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
    await boutonAnnulerGrandCalcul(panel).click().catch(() => {});
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0, { timeout: 10_000 }).catch(() => {});
  });

  test('T2-F10-02 : tous les contrôles visibles du panneau Grand Calcul mesurent >= 44 px par axe sur mobile', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const tropPetits = await auditerCiblesTactilesConteneur(panel);
    expect(tropPetits).toEqual([]);
  });

  test('T2-F11-01 : cartes R2 empilées sans débordement horizontal sur 390×844', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const texte = await pred.innerText();
    expect(extraireNombresCAD(texte).length).toBeGreaterThan(0);
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T2-F11-02 : contrôles interactifs R2 >= 44 px sur mobile et zéro hover transform', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    const tropPetits = await auditerCiblesTactilesConteneur(pred);
    expect(tropPetits).toEqual([]);
    await auditerAbsenceHoverTransform(pred);
  });

  test('T2-F12-01 : explications niveau 1 et niveau 2 déplié sans débordement horizontal sur 390×844', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const toggle = exp.locator('button[aria-expanded]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    await expect(page.locator(`#${regionId}`)).toBeVisible();
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
  });

  test('T2-F12-02 : déclencheurs accordéon niveau 2 mesurent >= 44 px par axe sur mobile', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });

    const tropPetits = await auditerCiblesTactilesConteneur(exp);
    expect(tropPetits).toEqual([]);
  });

  // =========================================================================
  // Tier 3 — Combinaisons mobiles (2 tests : T3-13, T3-14)
  // =========================================================================
  test('T3-13 (Mobile F10 + F11 + F12) : Grand Calcul + cartes R2 + accordéon R3 à 390×844', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible();
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const toggle = exp.locator('button[aria-expanded]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();
    expect(extraireNombresCAD(await region.innerText()).length).toBeGreaterThan(0);
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toHaveCount(0);

    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
  });

  test('T3-14 (Mobile F8 + Mode Discret + Reload) : persistance IDB sur mobile et masquage via Plus', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);

    await toggleModeDiscret(page, true);
    expect(extraireNombresCAD(await pred.innerText())).toEqual([]);
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await revelerCourbeProjection(page);

    // Vérifier d'abord que IndexedDB a réellement restauré le résultat avant de réactiver le mode discret
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.getByText('Aucun calcul enregistré')).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    expect(extraireNombresCAD(await exp.innerText()).length).toBeGreaterThan(0);

    await toggleModeDiscret(page, true);
    expect(extraireNombresCAD(await pred.innerText())).toEqual([]);
    await expect(pred.getByText('•••').first()).toBeVisible();
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();

    expect(extraireNombresCAD(await exp.innerText())).toEqual([]);
    await expect(exp.getByText('•••').first()).toBeVisible();
    await expect(exp.getByText('Montant masqué').first()).toBeAttached();

    expect(extraireNombresCAD(await panel.innerText())).toEqual([]);
    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
  });

  // =========================================================================
  // Tier 4 — Parcours réels mobiles (2 tests : T4-07, T4-08)
  // =========================================================================
  test('T4-07 : Parcours mobile rapide couple-confort — nav basse Futur + Grand Calcul + R2/R3 + cibles >= 44 px', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await page.addInitScript(scriptBypassGates());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);

    const navFutur = page.getByRole('navigation', { name: 'Navigation mobile' }).getByRole('button', { name: 'Futur' });
    await expect(navFutur).toBeVisible({ timeout: 10_000 });
    await navFutur.click();
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible();
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);

    const articleUrgence = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Fond urgence 6 mois/i })
      .first();
    await expect(articleUrgence).toBeVisible();
    await expect(articleUrgence).toContainText('Évalué');
    expect(extrairePourcentages(await articleUrgence.innerText()).length).toBe(1);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const toggle = exp.locator('button[aria-expanded]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();
    const regionTexte = await region.innerText();
    verifierTexteSansValeursInvalides(regionTexte);
    expect(extraireNombresCAD(regionTexte).length).toBeGreaterThan(0);

    expect(await auditerCiblesTactilesConteneur(panel)).toEqual([]);
    expect(await auditerCiblesTactilesConteneur(pred)).toEqual([]);
    expect(await auditerCiblesTactilesConteneur(exp)).toEqual([]);
    await auditerAbsenceHoverTransform(panel);
    await auditerAbsenceHoverTransform(pred);
    await auditerAbsenceHoverTransform(exp);

    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T4-08 : Parcours complet mobile pre-retraite-riche — succession ARC/RQ + IDB + discret + zéro débordement', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);

    const articleLeguer = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Léguer 500/i })
      .first();
    await expect(articleLeguer).toBeVisible();
    await expect(articleLeguer).toContainText('Évalué');
    expect(extrairePourcentages(await articleLeguer.innerText()).length).toBe(1);

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const lireMontantSuccession = async (labelRe: RegExp): Promise<number> => {
      const row = blocSuccession
        .locator('tr')
        .filter({ has: page.locator('th', { hasText: labelRe }) })
        .first();
      await expect(row).toBeVisible();
      const nums = extraireNombresCAD(await row.locator('td').first().innerText());
      expect(nums.length).toBe(1);
      return nums[0];
    };
    const arcAvant = await lireMontantSuccession(/^ARC \(fédéral\)$/i);
    const rqAvant = await lireMontantSuccession(/^Revenu Québec$/i);
    const mcP50Avant = await lireMontantSuccession(/^P50$/i);
    expect(arcAvant).toBeGreaterThan(0);
    expect(rqAvant).toBeGreaterThan(0);
    expect(mcP50Avant).toBeGreaterThan(0);

    await toggleModeDiscret(page, true);
    expect(extraireNombresCAD(await pred.innerText())).toEqual([]);
    await expect(pred.getByText('•••').first()).toBeVisible();
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await revelerCourbeProjection(page);

    // Prouver d'abord la restauration IndexedDB complète avant de réactiver le mode discret
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predReloadTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predReloadTexte);
    expect(extraireNombresCAD(predReloadTexte).length).toBeGreaterThan(0);
    expect(await lireMontantSuccession(/^ARC \(fédéral\)$/i)).toBe(arcAvant);
    expect(await lireMontantSuccession(/^Revenu Québec$/i)).toBe(rqAvant);
    expect(await lireMontantSuccession(/^P50$/i)).toBe(mcP50Avant);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    expect(extraireNombresCAD(await exp.innerText()).length).toBeGreaterThan(0);

    await toggleModeDiscret(page, true);
    expect(extraireNombresCAD(await pred.innerText())).toEqual([]);
    await expect(pred.getByText('•••').first()).toBeVisible();
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();

    expect(extraireNombresCAD(await exp.innerText())).toEqual([]);
    await expect(exp.getByText('•••').first()).toBeVisible();
    await expect(exp.getByText('Montant masqué').first()).toBeAttached();

    expect(extraireNombresCAD(await panel.innerText())).toEqual([]);
    await expect(panel.getByText('•••').first()).toBeVisible();
    await expect(panel.getByText('Montant masqué').first()).toBeAttached();

    expect(await largeurDefilable(page)).toBeLessThanOrEqual(LARGEUR_MOBILE);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
