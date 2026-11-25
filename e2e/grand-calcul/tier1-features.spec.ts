/**
 * Tier 1 — Fonctionnalités maîtresses Futur 4.0 (Desktop Chrome 1440×900 & 1280×800).
 *
 * Couvre :
 * - 4 scénarios uniques (`Trajectoire réelle`, `Prudent / Stress`, `Optimisé IA`, `Favorable`)
 *   avec réactivité immédiate sur Bloc 1, Bloc 2, Bloc 3 (`FutureCoreMilestonesGrid`) et Bloc 4 (`FutureUnifiedInsightsPanel`)
 * - Absence complète des anciens sélecteurs techniques et de `[data-panneau-jour]`
 * - Ruban `[P10, P90]` unique borné + colonnes `ChartDataTable`
 * - `FutureRichTooltip` (survol non épinglé, clic / Entrée épinglé, 4 sous-onglets, `Détail complet →`, `Escape`)
 * - Interactivité Bloc 4 (`Voir les chiffres`, `Voir sur la courbe`, `Appliquer dans Optimisé IA`)
 * - Exécution réelle de l'analyse profonde à 100 000 trajectoires, `Appliquer et mémoriser`,
 *   persistance chiffrée dans IndexedDB `financeai-deep-forecast` après `page.reload()`, zéro fuite `localStorage`,
 *   zéro débordement horizontal et zéro erreur console / JS / 5xx.
 */

import { test, expect } from '@playwright/test';
import {
  attacherCapteurErreurs,
  auditerCiblesTactilesConteneur,
  auditerRubanP10P90Svg,
  barreProgressionAnalyseProfonde,
  boutonAnnulerAnalyseProfonde,
  boutonLancerAnalyseProfonde,
  boutonScenario,
  epinglerInfobulleSurCourbe,
  infobulleRiche,
  inspecterPayloadIDBDeepForecast,
  preparerFuturAvecPersona,
  verifierZeroDebordementHorizontal,
  zoneAnalyseUnifiee,
  zoneReperesCles,
  zoneScenarios,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Futur 4.0 Tier 1 — Fonctionnalités principales Desktop', () => {
  test.setTimeout(150_000);

  test('T1-01 : 4 scénarios uniques, absence des contrôles obsolètes et ruban [P10, P90] borné (1440×900 & 1280×800)', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparerFuturAvecPersona(page, 'couple-confort');

    // Absence des anciens écrans bloqueurs, tiroirs et sélecteurs techniques
    await expect(page.getByRole('button', { name: /projection actuelle.*sans optimiser/i })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Outils' })).toHaveCount(0);
    await expect(page.locator('[data-panneau-jour]')).toHaveCount(0);
    for (const legacy of [
      /Agents IA \(7 Agents\)/i,
      /Normes IQPF/i,
      /Pimenter/i,
      /50\s*000 simulations/i,
      /75\s*000 simulations/i,
      /Régimes macroéconomiques/i,
      /^Crises historiques/i,
    ]) {
      await expect(page.getByRole('button', { name: legacy })).toHaveCount(0);
      await expect(page.getByRole('checkbox', { name: legacy })).toHaveCount(0);
    }
    await expect(page.getByRole('checkbox', { name: /Crises historiques/i })).toHaveCount(0);

    // 4 scénarios uniques + basculement synchrone Bloc 1 / Bloc 3 / Bloc 4
    await expect(boutonScenario(page, 'Trajectoire réelle')).toHaveAttribute('aria-pressed', 'true');
    for (const label of ['Prudent / Stress', 'Optimisé IA', 'Favorable', 'Trajectoire réelle'] as const) {
      const btn = boutonScenario(page, label);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await expect(zoneReperesCles(page).getByRole('heading', { name: new RegExp(label.replace('/', '\\/'), 'i') })).toBeVisible();
      await expect(zoneAnalyseUnifiee(page).locator('h2')).toContainText(new RegExp(label.replace('/', '\\/'), 'i'));
    }

    // Audit ruban [P10, P90] unique borné + ChartDataTable
    await auditerRubanP10P90Svg(page);
    const headersText = (await page.locator('table.sr-only thead th').allInnerTexts()).join(' | ');
    expect(headersText).toContain('Valeur nette');
    expect(headersText).toContain('P10');
    expect(headersText).toContain('P50');
    expect(headersText).toContain('P90');
    expect(headersText).toContain('Dettes (hors hypothèque)');
    expect(headersText).toContain('dont levier Smith');

    // Audit cibles tactiles >= 44 px & zéro débordement à 1440×900 puis 1280×800
    await auditerCiblesTactilesConteneur(zoneScenarios(page));
    await auditerCiblesTactilesConteneur(zoneAnalyseUnifiee(page));
    await verifierZeroDebordementHorizontal(page);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    await verifierZeroDebordementHorizontal(page);

    errors.assertClean();
  });

  test('T1-02 : FutureRichTooltip (survol, épinglage clic + Entrée, onglets, Détail complet, Escape) & Bloc 3/4', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparerFuturAvecPersona(page, 'couple-confort');

    // À l'arrêt, aucune infobulle riche affichée
    await expect(infobulleRiche(page)).toHaveCount(0);

    // Survol -> data-pinned="false"
    const svg = page.locator('.recharts-wrapper svg.recharts-surface').first();
    await svg.scrollIntoViewIfNeeded();
    const box = await svg.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.52);
    const hoveredTooltip = page.locator('[data-testid="future-rich-tooltip"][data-pinned="false"]');
    await expect(hoveredTooltip).toBeVisible({ timeout: 8_000 });
    await expect(hoveredTooltip.getByText(/Fourchette \[P10, P90\]/i)).toBeVisible();

    // Clic -> data-pinned="true" + 4 sous-onglets + navigation veille/lendemain
    const pinnedTooltip = await epinglerInfobulleSurCourbe(page, 0.55, 0.52);
    await expect(pinnedTooltip.getByText('Jour épinglé')).toBeVisible();
    await expect(pinnedTooltip.getByRole('button', { name: 'Fermer le détail épinglé' })).toBeVisible();
    await expect(pinnedTooltip.getByRole('group', { name: 'Pas des flèches' })).toBeVisible();

    await pinnedTooltip.getByRole('tab', { name: 'Par compte' }).click();
    await expect(pinnedTooltip.getByRole('tab', { name: 'Par compte' })).toHaveAttribute('aria-selected', 'true');
    await pinnedTooltip.getByRole('tab', { name: 'Ce jour-là' }).click();
    await expect(pinnedTooltip.getByRole('tab', { name: 'Ce jour-là' })).toHaveAttribute('aria-selected', 'true');

    // Détail complet -> modale Détail du mois -> Escape ferme modale puis Escape désépingle infobulle
    await pinnedTooltip.getByRole('button', { name: /Détail complet/i }).click();
    const modal = page.getByRole('dialog', { name: /Détail du mois/i });
    await expect(modal).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(infobulleRiche(page)).toHaveCount(0);

    // Épinglage clavier via Entrée sur le conteneur de la courbe
    const courbe = page.getByRole('group', { name: /Courbe de vie/ });
    await courbe.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]')).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');
    await expect(infobulleRiche(page)).toHaveCount(0);

    // Bloc 3 : 4 repères clés visibles
    const rep = zoneReperesCles(page);
    for (const titreRepere of [
      'Indépendance financière',
      'Revenu mensuel net retraite',
      'Objectifs datés',
      'Patrimoine final & Succession',
    ]) {
      await expect(rep.getByText(titreRepere).first()).toBeVisible();
    }

    // Bloc 4 : diagnostic passé, consensus Valoria, Voir les chiffres, Voir sur la courbe, Appliquer dans Optimisé IA
    const insights = zoneAnalyseUnifiee(page);
    await expect(insights.getByText('Diagnostic de ton passé réel')).toBeVisible();
    await expect(insights.getByText('Actualités & consensus Valoria')).toBeVisible();

    const btnVoirChiffres = insights.getByRole('button', { name: /Voir les chiffres/i }).first();
    await expect(btnVoirChiffres).toHaveAttribute('aria-expanded', 'false');
    await btnVoirChiffres.click();
    await expect(insights.getByRole('button', { name: /Masquer les chiffres/i }).first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const btnVoirCourbe = insights.getByRole('button', { name: /Voir sur la courbe/i }).first();
    await btnVoirCourbe.click();
    await expect(page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]')).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press('Escape');

    const btnAppliquerIa = insights.getByRole('button', { name: /Appliquer dans Optimisé IA/i }).first();
    await btnAppliquerIa.click();
    await expect(boutonScenario(page, 'Optimisé IA')).toHaveAttribute('aria-pressed', 'true');

    errors.assertClean();
  });

  test('T1-03 : Analyse profonde 100 000 trajectoires, barre progression, Appliquer & persistance IDB chiffrée après reload', async ({
    page,
  }) => {
    const errors = attacherCapteurErreurs(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await preparerFuturAvecPersona(page, 'couple-confort');

    // Démarre l'analyse profonde et observe l'état running (progressbar + Annuler)
    await boutonLancerAnalyseProfonde(page).click();
    await expect(barreProgressionAnalyseProfonde(page)).toBeVisible({ timeout: 15_000 });
    await expect(boutonAnnulerAnalyseProfonde(page)).toBeVisible();

    // Attend l'état staged puis applique et mémorise dans IndexedDB
    const btnAppliquer = zoneScenarios(page).getByRole('button', { name: /^Appliquer et mémoriser$/i });
    await expect(btnAppliquer).toBeVisible({ timeout: 130_000 });
    await expect(zoneScenarios(page).getByText(/Nouvelle analyse prête/i)).toBeVisible();
    await expect(zoneScenarios(page).getByText(/100[\s\u00a0\u202f]?000\s+trajectoires/i)).toBeVisible();
    await btnAppliquer.click();

    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible({ timeout: 15_000 });

    // Vérification IndexedDB (`financeai-deep-forecast`) + absence de fuite dans localStorage
    const idbBeforeReload = await inspecterPayloadIDBDeepForecast(page);
    expect(idbBeforeReload.dbFound).toBe(true);
    expect(idbBeforeReload.recordCount).toBeGreaterThanOrEqual(1);
    expect(idbBeforeReload.keys).toContain('real');
    expect(idbBeforeReload.allEncryptedAndCiphertextOnly).toBe(true);
    expect(idbBeforeReload.localStorageHasReportLeak).toBe(false);

    // Rechargement complet : restauration instantanée depuis IndexedDB sans relancer les Workers
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(zoneScenarios(page)).toBeVisible({ timeout: 20_000 });
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible({ timeout: 10_000 });
    await expect(zoneScenarios(page).getByText(/100[\s\u00a0\u202f]?000\s+trajectoires/i)).toBeVisible();

    // Basculer sur chaque scénario après restauration IDB
    for (const label of ['Prudent / Stress', 'Optimisé IA', 'Favorable', 'Trajectoire réelle'] as const) {
      await boutonScenario(page, label).click();
      await expect(boutonScenario(page, label)).toHaveAttribute('aria-pressed', 'true');
    }

    await verifierZeroDebordementHorizontal(page);
    errors.assertClean();
  });
});
