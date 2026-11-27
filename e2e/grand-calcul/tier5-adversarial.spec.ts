/**
 * Tier 5 — Robustesse adversariale Futur 4.0.
 *
 * Couvre :
 * - T5-01 : Double-clic rapide sur `Lancer l’analyse profonde` (exécution unique), annulation -> relance immédiate
 * - T5-02 : Coupure / repli réseau sur `/api/news/*` & `/api/valoria/*` + navigation d'onglet en plein calcul Workers
 * - T5-03 : Coexistence `Courbe nette` <-> `Par compte` + légende interactive + `Verrouiller`/`Déverrouiller` + ruban P10–P90
 * - T5-04 : `couple-dettes` en mode discret : onglets `Ce jour-là` / `Par compte` du tooltip et `.sr-only` `ChartDataTable`.
 */

import { test, expect } from '@playwright/test';
import {
  attacherCapteurErreurs,
  auditerRubanP10P90Svg,
  barreProgressionAnalyseProfonde,
  basculerModeDiscret,
  boutonAnnulerAnalyseProfonde,
  boutonLancerAnalyseProfonde,
  boutonScenario,
  epinglerInfobulleSurCourbe,
  executerEtAppliquerAnalyseProfonde,
  naviguerVersFutur,
  preparerFuturAvecPersona,
  zoneAnalyseUnifiee,
  zoneScenarios,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 Tier 5 — Hardening & Cas Adversariaux', () => {
  test.setTimeout(150_000);

  test('T5-01 : Double-clic anti-concurrence, annulation en vol puis relance immédiate réussie', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    const btnLancer = boutonLancerAnalyseProfonde(page);
    await btnLancer.dblclick();

    await expect(barreProgressionAnalyseProfonde(page)).toHaveCount(1, { timeout: 15_000 });
    await expect(boutonAnnulerAnalyseProfonde(page)).toHaveCount(1);

    await boutonAnnulerAnalyseProfonde(page).click();
    await expect(zoneScenarios(page).getByText(/Calcul interrompu/i)).toBeVisible({ timeout: 10_000 });

    // Relance immédiate juste après l'annulation
    await executerEtAppliquerAnalyseProfonde(page);
    errors.assertClean();
  });

  test('T5-02 : Repli hors-ligne des endpoints news/valoria et changement de page pendant Workers', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await preparerFuturAvecPersona(page, 'couple-confort');
    await expect(zoneAnalyseUnifiee(page).getByText('Actualités & consensus Valoria')).toBeVisible({
      timeout: 10_000,
    });

    await page.route(/\/api\/(news|valoria)\//, (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'offline' }) }),
    );

    // Lancer puis naviguer vers Profil pendant le calcul, puis revenir à Futur
    await boutonLancerAnalyseProfonde(page).click();
    await expect(boutonAnnulerAnalyseProfonde(page)).toBeVisible({ timeout: 10_000 });
    await page.goto('/#PROFILE');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: /Profil/i }).first()).toBeVisible({ timeout: 10_000 });
    await naviguerVersFutur(page);

    // L'écran reste sain et le bouton de lancement reste actionnable sans verrou mort
    await expect(boutonLancerAnalyseProfonde(page)).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test('T5-03 : Coexistence Courbe nette / Par compte, séries de légende, Verrouiller et ruban P10–P90', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-confort');

    await auditerRubanP10P90Svg(page);

    // Verrouiller l'échelle puis changer de scénario
    const btnLock = page.getByRole('button', { name: /Verrouiller/i }).first();
    await btnLock.click();
    await expect(page.getByRole('button', { name: /Déverrouiller/i }).first()).toBeVisible();
    await boutonScenario(page, 'Favorable').click();
    await expect(boutonScenario(page, 'Favorable')).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Déverrouiller/i }).first().click();

    // Basculer Par compte -> masquer une série -> Tout afficher -> revenir Courbe nette
    await page.getByRole('button', { name: 'Par compte', exact: true }).click();
    const legende = page.getByRole('group', { name: 'Séries du graphique' });
    await expect(legende).toBeVisible();
    const firstChip = legende.locator('button[aria-pressed="true"]').first();
    await firstChip.click();
    const btnToutAfficher = legende.getByRole('button', { name: /Tout afficher/i });
    if (await btnToutAfficher.isVisible().catch(() => false)) {
      await btnToutAfficher.click();
    }

    await page.getByRole('button', { name: 'Courbe nette', exact: true }).click();
    await auditerRubanP10P90Svg(page);
    errors.assertClean();
  });

  test('T5-04 : couple-dettes en mode discret sur Ce jour-là, Par compte et ChartDataTable', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await preparerFuturAvecPersona(page, 'couple-dettes');
    await basculerModeDiscret(page);

    const tooltip = await epinglerInfobulleSurCourbe(page, 0.5, 0.5);
    await tooltip.getByRole('tab', { name: 'Ce jour-là' }).click();
    const dayTabText = await tooltip.innerText();
    expect(dayTabText).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);

    await tooltip.getByRole('tab', { name: 'Par compte' }).click();
    const accTabText = await tooltip.innerText();
    expect(accTabText).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);
    await page.keyboard.press('Escape');

    const srTableText = await page.locator('main .sr-only').allInnerTexts();
    expect(srTableText.join(' ')).toContain('Montant masqué');
    errors.assertClean();
  });
});
