/**
 * Suite E2E Grand Calcul — Tier 5 : Durcissement adversarial (Desktop Chrome).
 *
 * Approche boîte noire stricte : aucun import interne M1–M4, uniquement les
 * helpers boîte noire de `e2e/grand-calcul/helpers.ts` et `e2e/helpers/setup.ts`.
 */
import { test, expect, type Locator } from '@playwright/test';
import { ecarterLeRail } from '../helpers/setup';
import {
  attacherCollecteursErreurs,
  boutonAnnulerGrandCalcul,
  corrompreEnregistrementGrandCalculIDB,
  extraireAges,
  extraireNombresCAD,
  lancerGrandCalcul,
  lancerGrandCalculEtAttendre,
  ouvrirFuturAvecPersona,
  revelerCourbeProjection,
  toggleModeDiscret,
  verifierRestaurationGrandCalculIDB,
  verifierTexteSansValeursInvalides,
  zoneExplications,
  zoneGrandCalcul,
  zonePredictions,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Grand Calcul — Tier 5 : Durcissement adversarial', () => {
  test.setTimeout(180_000);

  test('T5-01 : basculer "Afficher les bandes P5–P95 sur la courbe" OFF puis ON retire puis restaure P5/P50/P95 dans ChartDataTable', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    const btnBandes = panel.getByRole('button', { name: /Afficher les bandes P5–P95 sur la courbe/i });
    await expect(btnBandes).toBeVisible();
    await expect(btnBandes).toHaveAttribute('aria-pressed', 'true');

    const tableCourbe = page.locator('main table').filter({ hasText: /Projection du patrimoine net/i }).first();
    await expect(tableCourbe).toBeAttached();

    const entetesInit = (await tableCourbe.locator('thead th').allInnerTexts()).join(' | ');
    expect(entetesInit).toMatch(/\bP5\b/i);
    expect(entetesInit).toMatch(/\bP50\b/i);
    expect(entetesInit).toMatch(/\bP95\b/i);

    // Bascule OFF
    await btnBandes.click();
    await expect(btnBandes).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => (await tableCourbe.locator('thead th').allInnerTexts()).join(' | '))
      .not.toMatch(/\bP50\b/i);
    const entetesOff = (await tableCourbe.locator('thead th').allInnerTexts()).join(' | ');
    expect(entetesOff).not.toMatch(/\bP5\b/i);
    expect(entetesOff).not.toMatch(/\bP95\b/i);

    // Bascule ON
    await btnBandes.click();
    await expect(btnBandes).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => (await tableCourbe.locator('thead th').allInnerTexts()).join(' | '))
      .toMatch(/\bP50\b/i);
    const entetesOn = (await tableCourbe.locator('thead th').allInnerTexts()).join(' | ');
    expect(entetesOn).toMatch(/\bP5\b/i);
    expect(entetesOn).toMatch(/\bP95\b/i);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T5-02 : cliquer "Voir sur la courbe" sur une carte R3 épingle le point correspondant dans PanneauJour', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });

    const cartes = exp.locator('ol li article');
    await expect(cartes.first()).toBeVisible({ timeout: 15_000 });
    const nbCartes = await cartes.count();
    const carteCible = nbCartes > 1 ? cartes.nth(1) : cartes.first();
    const btnVoir = carteCible.getByRole('button', { name: /Voir sur la courbe/i });
    await expect(btnVoir).toBeVisible({ timeout: 10_000 });
    await btnVoir.click();

    const panneauEpingle = page.locator('[data-panneau-jour][data-jour-epingle]');
    await expect(panneauEpingle).toBeVisible({ timeout: 10_000 });
    await expect(panneauEpingle.getByRole('status')).toContainText(/Jour épinglé/i);
    await expect(exp.getByText('Point inspecté sur la courbe')).toBeVisible({ timeout: 10_000 });
    await expect(exp.getByText('Épinglé', { exact: true })).toBeVisible({ timeout: 10_000 });
    verifierTexteSansValeursInvalides(await panneauEpingle.innerText());

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T5-03 : flowEvents Jour 1 (couple-dettes) + Mode Discret masquent montants CAD, âges et texte brut dans PanneauJour', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-dettes');

    const allerAuJour1AvecEvenement = async (): Promise<Locator> => {
      const panneau = page.locator('[data-panneau-jour]');
      await expect(panneau).toBeVisible({ timeout: 10_000 });
      await panneau.getByRole('button', { name: 'Mois', exact: true }).click();
      await panneau.getByRole('button', { name: /Lendemain/i }).click();
      await panneau.getByRole('button', { name: 'Jour', exact: true }).click();

      const veilleBtn = panneau.getByRole('button', { name: /Veille/i });
      for (let step = 0; step < 35; step++) {
        const txt = await panneau.innerText();
        if (/\b01\/\d{2}\/\d{4}/.test(txt) && /Événement/i.test(txt)) {
          break;
        }
        if (!(await veilleBtn.isEnabled())) break;
        await veilleBtn.click();
      }
      const epingle = page.locator('[data-panneau-jour][data-jour-epingle]');
      await expect(epingle).toBeVisible({ timeout: 10_000 });
      return epingle;
    };

    // 1) Anti-vacuité hors mode discret : Jour 1 porte bien le flowEvent RAMQ avec montant CAD et âge
    const panneauAvant = await allerAuJour1AvecEvenement();
    const avantDiscret = await panneauAvant.innerText();
    expect(avantDiscret).toMatch(/\b01\/\d{2}\/\d{4}/);
    expect(extraireNombresCAD(avantDiscret).length).toBeGreaterThan(0);
    expect(avantDiscret).toMatch(/Âge\s+\d+/i);
    expect(avantDiscret).toMatch(/Événement/i);
    expect(avantDiscret).toMatch(/RAMQ/i);

    // 2) Mode discret actif (cliquer dans la barre latérale relâche l'épingle, donc on revient sur Jour 1)
    await toggleModeDiscret(page, true);
    const panneauApres = await allerAuJour1AvecEvenement();
    const apresDiscret = await panneauApres.innerText();
    verifierTexteSansValeursInvalides(apresDiscret);
    expect(apresDiscret).toMatch(/\b01\/\d{2}\/\d{4}/);
    expect(extraireNombresCAD(apresDiscret)).toEqual([]);
    expect(extraireAges(apresDiscret)).toEqual([]);
    expect(apresDiscret).not.toMatch(/Âge\s+\d+/i);
    expect(apresDiscret).not.toMatch(/RAMQ/i);
    expect(apresDiscret).toMatch(/événement\s+masqué/i);
    await expect(panneauApres.getByText('•••').first()).toBeVisible();
    await expect(panneauApres.getByText('Montant masqué').first()).toBeAttached();

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T5-04 : IDB corrompu -> avertissement illisible persiste après lancement + annulation -> effacé après recalcul complet', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    expect(await corrompreEnregistrementGrandCalculIDB(page)).toBe(true);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const pred = zonePredictions(page);
    const panel = zoneGrandCalcul(page);
    await expect(pred.getByRole('status')).toContainText(/Sauvegarde locale illisible/i, { timeout: 15_000 });
    await expect(panel.getByRole('alert')).toContainText(/Donnée illisible/i, { timeout: 15_000 });

    // Lancer avec 100 000 itérations et annuler avant complétion -> l'avertissement illisible doit rester
    await lancerGrandCalcul(page, { iterations: 100_000 });
    const cancel = boutonAnnulerGrandCalcul(panel);
    await expect(cancel).toBeVisible({ timeout: 10_000 });
    await cancel.click();
    await expect(cancel).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByRole('status')).toContainText(/Calcul annulé/i);
    await expect(pred.getByRole('status')).toContainText(/Sauvegarde locale illisible/i);

    // Relance complète -> efface l'avertissement et persiste proprement
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(pred.getByText(/Sauvegarde locale illisible/i)).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await verifierRestaurationGrandCalculIDB(page, 50_000);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
