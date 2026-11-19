/**
 * Mobile Tactile (390×844, hasTouch: true) — Futur 4.0 & Analyse profonde 100 000 trajectoires.
 *
 * Couvre :
 * - GM-01 : Navigation mobile -> `Futur`, layout 390×844 sans débordement horizontal,
 *           cibles tactiles >= 44 px (Bloc 1, Bloc 4, boutons courbe, infobulle épinglée), zéro hover transform
 * - GM-02 : Exécution 100 000 trajectoires sur mobile, `running` + `staged` + `Appliquer et mémoriser`,
 *           restauration instantanée après `page.reload()`, `Mode discret` via `Plus`
 * - GM-03 : Parité Desktop (1440×900) -> Mobile (390×844) sur la même session (scénario et repères identiques).
 */

import { test, expect } from '@playwright/test';
import {
  attacherCapteurErreurs,
  auditerCiblesTactilesConteneur,
  basculerModeDiscret,
  boutonAnnulerAnalyseProfonde,
  boutonLancerAnalyseProfonde,
  boutonScenario,
  epinglerInfobulleSurCourbe,
  executerEtAppliquerAnalyseProfonde,
  fermerToastsSiPresents,
  passerGardeLocale,
  preparerFuturAvecPersona,
  verifierModeDiscretFutur4,
  verifierZeroDebordementHorizontal,
  zoneAnalyseUnifiee,
  zoneReperesCles,
  zoneScenarios,
} from './helpers';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from '../helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 Mobile Tactile (390×844)', () => {
  test.setTimeout(150_000);

  test('GM-01 : Mobile 390×844 sans débordement, cibles tactiles >= 44 px, infobulle épinglée et 100k + IDB + Mode discret', async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = attacherCapteurErreurs(page);

    try {
      await page.addInitScript(scriptBypassOnboarding());
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
      await passerGardeLocale(page);
      await activateTestMode(page);
      await ecarterLeRail(page);

      // Navigation via la barre mobile vers Futur
      const navMobile = page.getByRole('navigation', { name: 'Navigation mobile' });
      await expect(navMobile).toBeVisible({ timeout: 10_000 });
      await navMobile.getByRole('button', { name: /Futur/i }).click();
      await fermerToastsSiPresents(page);

      await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
      await expect(zoneScenarios(page)).toBeVisible({ timeout: 10_000 });

      // Zéro hover transform sur mobile & zéro débordement initial
      await expect(page.locator('.hover\\:scale-105, .hover\\:-translate-y-1')).toHaveCount(0);
      await verifierZeroDebordementHorizontal(page);

      // Cibles tactiles >= 44 px sur Bloc 1 & Bloc 4
      await auditerCiblesTactilesConteneur(zoneScenarios(page));
      await auditerCiblesTactilesConteneur(zoneAnalyseUnifiee(page));

      // Déplier « Voir les chiffres » et épingler l'infobulle riche sur mobile -> zéro débordement
      const btnChiffres = zoneAnalyseUnifiee(page).getByRole('button', { name: /Voir les chiffres/i }).first();
      if (await btnChiffres.isVisible().catch(() => false)) {
        await btnChiffres.click();
        await verifierZeroDebordementHorizontal(page);
      }

      const tooltip = await epinglerInfobulleSurCourbe(page, 0.55, 0.5);
      const boxFermer = await tooltip.getByRole('button', { name: 'Fermer le détail épinglé' }).boundingBox();
      expect(boxFermer?.height ?? 0).toBeGreaterThanOrEqual(44);
      await verifierZeroDebordementHorizontal(page);
      await page.keyboard.press('Escape');

      // Exécuter 100 000 trajectoires sur mobile -> vérifier pas de débordement pendant running/staged
      await boutonLancerAnalyseProfonde(page).click();
      await expect(boutonAnnulerAnalyseProfonde(page)).toBeVisible({ timeout: 15_000 });
      await verifierZeroDebordementHorizontal(page);

      const btnAppliquer = zoneScenarios(page).getByRole('button', { name: /^Appliquer et mémoriser$/i });
      await expect(btnAppliquer).toBeVisible({ timeout: 130_000 });
      await verifierZeroDebordementHorizontal(page);
      await btnAppliquer.click();

      await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible({ timeout: 15_000 });
      await verifierZeroDebordementHorizontal(page);

      // Rechargement : restauration instantanée depuis IndexedDB sur mobile
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible({ timeout: 15_000 });
      await verifierZeroDebordementHorizontal(page);

      // Activer le Mode discret via « Plus » -> vérifier masquage complet sans débordement
      await basculerModeDiscret(page);
      await verifierModeDiscretFutur4(page);
      await verifierZeroDebordementHorizontal(page);

      errors.assertClean();
    } finally {
      await context.close();
    }
  });

  test('GM-02 : Parité des repères et scénarios entre Desktop (1440×900) et Mobile (390×844)', async ({ page }) => {
    const errors = attacherCapteurErreurs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparerFuturAvecPersona(page, 'couple-confort');
    await executerEtAppliquerAnalyseProfonde(page);

    await boutonScenario(page, 'Optimisé IA').click();
    await expect(boutonScenario(page, 'Optimisé IA')).toHaveAttribute('aria-pressed', 'true');
    const desktopMilestones = await zoneReperesCles(page).innerText();

    // Redimensionner vers Mobile 390×844 sur la même instance
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    await expect(boutonScenario(page, 'Optimisé IA')).toHaveAttribute('aria-pressed', 'true');
    const mobileMilestones = await zoneReperesCles(page).innerText();
    expect(mobileMilestones.replace(/\s+/g, ' ').trim()).toBe(desktopMilestones.replace(/\s+/g, ' ').trim());
    await verifierZeroDebordementHorizontal(page);

    errors.assertClean();
  });
});
