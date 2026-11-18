/**
 * Suite E2E Grand Calcul — Tier 4 : Parcours complets de planification retraite au Québec (6 tests Desktop Chrome).
 *
 * Complète `grandCalculMobile.spec.ts` (T4-07 et T4-08) pour atteindre 8 parcours réels.
 */
import { test, expect } from '@playwright/test';
import { ecarterLeRail } from '../helpers/setup';
import {
  attacherCollecteursErreurs,
  attendreFinGrandCalcul,
  badgeParametresModifies,
  barreProgressionGrandCalcul,
  boutonLancerGrandCalcul,
  cartePredictionR2,
  changerPersona,
  deplierEtVerifierExplicationR3,
  extraireAges,
  extraireNombresCAD,
  extrairePourcentages,
  lancerGrandCalcul,
  lancerGrandCalculEtAttendre,
  lireLigneSuccessionCAD,
  modifierParametresRetraiteDansProfil,
  ouvrirFuturAvecPersona,
  revelerCourbeProjection,
  toggleModeDiscret,
  verifierModeDiscretGrandCalcul,
  verifierRestaurationGrandCalculIDB,
  verifierTexteSansValeursInvalides,
  zoneExplications,
  zoneGrandCalcul,
  zonePredictions,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Grand Calcul — Tier 4 : Parcours réels québécois (Desktop)', () => {
  test.setTimeout(180_000);

  test('T4-01 : Couple mi-carrière (couple-confort) — Grand Calcul 50k + régimes/crises + tiroir en vol + R2 + R3', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');

    await lancerGrandCalcul(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });
    const panel = zoneGrandCalcul(page);
    const progress = barreProgressionGrandCalcul(panel);
    await expect(progress).toBeVisible({ timeout: 10_000 });

    // Parcourir le tiroir Historique sans bloquer le Worker
    await page.getByRole('button', { name: 'Historique', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Historique' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(progress).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(progress).toBeVisible();

    await attendreFinGrandCalcul(page, 140_000);

    // R1 : badges régimes + crises actifs, 50 000 simulations et zéro état vide
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    const panelTexte = await panel.innerText();
    expect(panelTexte).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extraireNombresCAD(panelTexte).length).toBeGreaterThan(0);

    // R2 : aucune attente + valeurs numériques réelles dans les 4 cartes
    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);

    // Carte 1 : Âge FI (P5 <= P50 <= P95, horizon 92 ans)
    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const fiTexte = await blocFi.innerText();
    const fiPct = extrairePourcentages(fiTexte);
    expect(fiPct.length).toBe(1);
    expect(fiPct[0]).toBeGreaterThan(0);
    expect(fiPct[0]).toBeLessThanOrEqual(100);
    const agesFi = extraireAges(fiTexte.replace(/Horizon simulé[\s\S]*$/i, ''));
    expect(agesFi.length).toBe(3);
    expect(agesFi[0]).toBeGreaterThanOrEqual(35);
    expect(agesFi[0]).toBeLessThanOrEqual(agesFi[1]);
    expect(agesFi[1]).toBeLessThanOrEqual(agesFi[2]);
    expect(agesFi[2]).toBeLessThanOrEqual(92);
    expect(fiTexte).toMatch(/Horizon simulé\s*:\s*92\s*ans/i);

    // Carte 2 : Objectif Fond urgence 6 mois
    const articleUrgence = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Fond urgence 6 mois/i })
      .first();
    await expect(articleUrgence).toBeVisible();
    await expect(articleUrgence).toContainText('Évalué');
    const objTexte = await articleUrgence.innerText();
    const objPct = extrairePourcentages(objTexte);
    expect(objPct.length).toBe(1);
    expect(objPct[0]).toBeGreaterThan(0);
    expect(objPct[0]).toBeLessThanOrEqual(100);
    const objCads = extraireNombresCAD(objTexte);
    expect(objCads.length).toBe(2);
    expect(objCads[0]).toBe(30_000);

    // Carte 3 : Pouvoir d'achat réel mensuel net garanti (P95 <= P90 <= P50)
    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const pouvoirTexte = await blocPouvoir.innerText();
    const gpCads = extraireNombresCAD(pouvoirTexte);
    expect(gpCads.length).toBe(3);
    expect(gpCads[0]).toBeGreaterThan(0);
    expect(gpCads[0]).toBeLessThanOrEqual(gpCads[1]);
    expect(gpCads[1]).toBeLessThanOrEqual(gpCads[2]);
    expect(pouvoirTexte).toMatch(/Mois de retraite évalués\s*:\s*[1-9]\d*\s*mois/i);

    // Carte 4 : Impôt successoral latent ARC + RQ
    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const total = await lireLigneSuccessionCAD(page, blocSuccession, /^Total \(projection de base\)$/i);
    const arc = await lireLigneSuccessionCAD(page, blocSuccession, /^ARC \(fédéral\)$/i);
    const rq = await lireLigneSuccessionCAD(page, blocSuccession, /^Revenu Québec$/i);
    const mcP5 = await lireLigneSuccessionCAD(page, blocSuccession, /^P5$/i);
    const mcP50 = await lireLigneSuccessionCAD(page, blocSuccession, /^P50$/i);
    const mcP95 = await lireLigneSuccessionCAD(page, blocSuccession, /^P95$/i);
    expect(total).toBeGreaterThan(0);
    expect(arc).toBeGreaterThan(0);
    expect(rq).toBeGreaterThan(0);
    expect(Math.abs(arc + rq - total)).toBeLessThanOrEqual(5);
    expect(mcP5).toBeGreaterThanOrEqual(0);
    expect(mcP5).toBeLessThanOrEqual(mcP50);
    expect(mcP50).toBeLessThanOrEqual(mcP95);
    expect(mcP50).toBeGreaterThan(0);

    // R3 : attente Suspense + transition aria-expanded false -> true + région niveau 2 chiffrée
    const { regionTexte } = await deplierEtVerifierExplicationR3(page);
    expect(regionTexte).toMatch(/Accumulation/i);
    expect(regionTexte).toMatch(/Décaissement/i);
    expect(regionTexte).toMatch(/Fiscalité/i);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T4-02 : Épargnant FIRE précoce (karim-immigre) — report âge retraite 50 -> 55 et recalcul', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'karim-immigre');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predAvant = await pred.innerText();
    verifierTexteSansValeursInvalides(predAvant);

    const fiAvantTexte = await cartePredictionR2(page, /indépendance financière/i).innerText();
    const fiPctAvant = extrairePourcentages(fiAvantTexte);
    expect(fiPctAvant.length).toBe(1);
    expect(fiPctAvant[0]).toBeGreaterThan(0);
    expect(fiPctAvant[0]).toBeLessThan(100);
    const agesFiAvant = extraireAges(fiAvantTexte.replace(/Horizon simulé[\s\S]*$/i, ''));
    expect(agesFiAvant.length).toBeGreaterThanOrEqual(1);
    expect(agesFiAvant[0]).toBeGreaterThanOrEqual(34);
    expect(agesFiAvant[0]).toBeLessThanOrEqual(92);

    const objAvant = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Indépendance financière \(1 M\$\)/i })
      .first();
    await expect(objAvant).toBeVisible();
    await expect(objAvant).toContainText('Évalué');
    const objAvantTexte = await objAvant.innerText();
    const objPctAvant = extrairePourcentages(objAvantTexte);
    expect(objPctAvant.length).toBe(1);
    expect(objPctAvant[0]).toBeGreaterThan(0);
    expect(objPctAvant[0]).toBeLessThan(100);
    const objCadsAvant = extraireNombresCAD(objAvantTexte);
    expect(objCadsAvant.length).toBe(2);
    expect(objCadsAvant[0]).toBe(1_000_000);
    expect(objCadsAvant[1]).toBeGreaterThan(0);

    const pouvoirAvant = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());
    expect(pouvoirAvant.length).toBe(3);
    expect(pouvoirAvant[0]).toBeGreaterThan(0);
    expect(pouvoirAvant[0]).toBeLessThanOrEqual(pouvoirAvant[1]);
    expect(pouvoirAvant[1]).toBeLessThanOrEqual(pouvoirAvant[2]);

    await modifierParametresRetraiteDansProfil(page, { targetAge: 55 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 10_000 });
    await expect(pred.getByRole('status')).toContainText(/Paramètres modifiés/i);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await expect(badgeParametresModifies(panel)).toHaveCount(0);
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    await expect(pred.getByText(/Paramètres modifiés/i)).toHaveCount(0);
    const predApres = await pred.innerText();
    verifierTexteSansValeursInvalides(predApres);
    expect(predApres).not.toBe(predAvant);

    const fiApresTexte = await cartePredictionR2(page, /indépendance financière/i).innerText();
    const fiPctApres = extrairePourcentages(fiApresTexte);
    expect(fiPctApres.length).toBe(1);
    expect(fiPctApres[0]).toBeGreaterThan(fiPctAvant[0]);
    const agesFiApres = extraireAges(fiApresTexte.replace(/Horizon simulé[\s\S]*$/i, ''));
    expect(agesFiApres.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < agesFiApres.length; i++) {
      expect(agesFiApres[i]).toBeGreaterThanOrEqual(34);
      expect(agesFiApres[i]).toBeLessThanOrEqual(92);
      if (i > 0) expect(agesFiApres[i - 1]).toBeLessThanOrEqual(agesFiApres[i]);
    }

    const objApres = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Indépendance financière \(1 M\$\)/i })
      .first();
    await expect(objApres).toBeVisible();
    await expect(objApres).toContainText('Évalué');
    const objApresTexte = await objApres.innerText();
    const objPctApres = extrairePourcentages(objApresTexte);
    expect(objPctApres.length).toBe(1);
    expect(objPctApres[0]).toBeGreaterThan(0);
    expect(objPctApres[0]).toBeLessThan(100);
    const objCadsApres = extraireNombresCAD(objApresTexte);
    expect(objCadsApres.length).toBe(2);
    expect(objCadsApres[0]).toBe(1_000_000);
    expect(objCadsApres[1]).toBeGreaterThan(0);

    const pouvoirApres = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());
    expect(pouvoirApres.length).toBe(3);
    expect(pouvoirApres[0]).toBeGreaterThan(0);
    expect(pouvoirApres[0]).toBeLessThanOrEqual(pouvoirApres[1]);
    expect(pouvoirApres[1]).toBeLessThanOrEqual(pouvoirApres[2]);
    expect(pouvoirApres).not.toEqual(pouvoirAvant);
    expect(pouvoirApres[2]).toBeGreaterThan(pouvoirAvant[2]);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T4-03 : Pré-retraite fortunée & succession (pre-retraite-riche) — ARC/RQ + FERR/PSV + discret + reload', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    verifierTexteSansValeursInvalides(await pred.innerText());

    // Objectif Léguer 500 k$ aux enfants
    const articleLeguer = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Léguer 500/i })
      .first();
    await expect(articleLeguer).toBeVisible();
    await expect(articleLeguer).toContainText('Évalué');
    const leguerTexte = await articleLeguer.innerText();
    const leguerPct = extrairePourcentages(leguerTexte);
    expect(leguerPct.length).toBe(1);
    expect(leguerPct[0]).toBeGreaterThan(0);
    expect(leguerPct[0]).toBeLessThanOrEqual(100);
    const leguerCads = extraireNombresCAD(leguerTexte);
    expect(leguerCads.length).toBe(2);
    expect(leguerCads[0]).toBe(500_000);

    // Impôt successoral latent au décès (Total, ARC, RQ, P5 <= P50 <= P95, ARC + RQ ≈ Total)
    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const total = await lireLigneSuccessionCAD(page, blocSuccession, /^Total \(projection de base\)$/i);
    const arc = await lireLigneSuccessionCAD(page, blocSuccession, /^ARC \(fédéral\)$/i);
    const rq = await lireLigneSuccessionCAD(page, blocSuccession, /^Revenu Québec$/i);
    const mcP5 = await lireLigneSuccessionCAD(page, blocSuccession, /^P5$/i);
    const mcP50 = await lireLigneSuccessionCAD(page, blocSuccession, /^P50$/i);
    const mcP95 = await lireLigneSuccessionCAD(page, blocSuccession, /^P95$/i);
    const reerFerr = await lireLigneSuccessionCAD(page, blocSuccession, /^REER \/ FERR$/i);
    expect(total).toBeGreaterThan(0);
    expect(arc).toBeGreaterThan(0);
    expect(rq).toBeGreaterThan(0);
    expect(Math.abs(arc + rq - total)).toBeLessThanOrEqual(5);
    expect(mcP5).toBeGreaterThanOrEqual(0);
    expect(mcP5).toBeLessThanOrEqual(mcP50);
    expect(mcP50).toBeLessThanOrEqual(mcP95);
    expect(mcP50).toBeGreaterThan(0);
    expect(reerFerr).toBeGreaterThan(0);
    expect(await blocSuccession.innerText()).toMatch(/Âge projeté au décès\s*:\s*94\s*ans/i);

    // R3 : ciblage explicite des cartes PSV, FERR et Succession
    const psv = await deplierEtVerifierExplicationR3(page, /Début de la PSV/i);
    expect(psv.regionTexte).toMatch(/PSV\s*\(Service Canada\)/i);

    const ferr = await deplierEtVerifierExplicationR3(page, /Premier retrait minimum FERR obligatoire/i);
    expect(ferr.regionTexte).toMatch(/Taux minimum FERR/i);
    const tauxFerr = extrairePourcentages(ferr.regionTexte);
    expect(tauxFerr.length).toBeGreaterThan(0);
    expect(tauxFerr.some((p) => p > 0)).toBe(true);

    const successionR3 = await deplierEtVerifierExplicationR3(page, /Bilan terminal et impôt successoral/i);
    expect(successionR3.regionTexte).toMatch(/ARC et Revenu Québec/i);
    const ligneImpotLatent = successionR3.region
      .locator('div.flex', { hasText: /Impôt latent \/ successoral/i })
      .first();
    const cadsImpotLatentR3 = extraireNombresCAD(await ligneImpotLatent.innerText());
    expect(cadsImpotLatentR3.length).toBe(1);
    expect(cadsImpotLatentR3[0]).toBe(mcP50);

    // Masquage pré-rechargement
    await toggleModeDiscret(page, true);
    await verifierModeDiscretGrandCalcul(page);

    // Rechargement -> preuve de restauration IDB AVANT réactivation du mode discret
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await verifierRestaurationGrandCalculIDB(page, 50_000);

    await expect(page.getByRole('button', { name: 'Activer le mode discret' })).toBeVisible();
    await toggleModeDiscret(page, true);
    await verifierModeDiscretGrandCalcul(page);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T4-04 : Aîné en décaissement actif (gilles-actif-decaisse) — FERR 72 ans, Coussin santé et horizon 92 ans', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible();
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    await expect(blocFi.getByText('Pas de donnée', { exact: true })).toHaveCount(0);
    const fiTexte = await blocFi.innerText();
    const fiPct = extrairePourcentages(fiTexte);
    expect(fiPct.length).toBe(1);
    expect(fiPct[0]).toBeGreaterThan(0);
    expect(fiPct[0]).toBeLessThanOrEqual(100);
    const corpsFi = fiTexte.replace(/Horizon simulé[\s\S]*$/i, '');
    const agesFi = extraireAges(corpsFi);
    expect(agesFi.length).toBe(3);
    for (let i = 0; i < agesFi.length; i++) {
      expect(agesFi[i]).toBeGreaterThanOrEqual(71);
      expect(agesFi[i]).toBeLessThanOrEqual(92);
      if (i > 0) expect(agesFi[i - 1]).toBeLessThanOrEqual(agesFi[i]);
    }
    expect(fiTexte).toMatch(/Horizon simulé\s*:\s*92\s*ans/i);

    const articleCoussin = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Coussin santé/i })
      .first();
    await expect(articleCoussin).toBeVisible();
    await expect(articleCoussin).toContainText('Évalué');
    const coussinTexte = await articleCoussin.innerText();
    expect(coussinTexte).toMatch(/2030/);
    const coussinPct = extrairePourcentages(coussinTexte);
    expect(coussinPct.length).toBe(1);
    expect(coussinPct[0]).toBeGreaterThan(0);
    expect(coussinPct[0]).toBeLessThanOrEqual(100);
    const coussinCads = extraireNombresCAD(coussinTexte);
    expect(coussinCads.length).toBe(2);
    expect(coussinCads[0]).toBe(40_000);

    const gpCads = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());
    expect(gpCads.length).toBe(3);
    expect(gpCads[0]).toBeGreaterThan(0);
    expect(gpCads[0]).toBeLessThanOrEqual(gpCads[1]);
    expect(gpCads[1]).toBeLessThanOrEqual(gpCads[2]);
    await expect(cartePredictionR2(page, /impôt successoral/i)).toContainText(/Âge projeté au décès\s*:\s*92\s*ans/i);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    const carteFerr = exp
      .locator('ol li article')
      .filter({ hasText: /Premier retrait minimum FERR obligatoire/i })
      .first();
    await expect(carteFerr).toBeVisible({ timeout: 10_000 });
    expect(await carteFerr.innerText()).toMatch(/\b72\s*ans\b/i);
    const toggleFerr = carteFerr.locator('button[aria-expanded]').first();
    await expect(toggleFerr).toBeVisible({ timeout: 10_000 });
    await expect(toggleFerr).toHaveAttribute('aria-expanded', 'false');
    await toggleFerr.click();
    await expect(toggleFerr).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggleFerr.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();
    const regionTexte = await region.innerText();
    verifierTexteSansValeursInvalides(regionTexte);
    expect(regionTexte).toContain('Taux minimum FERR');
    const pctsFerr = extrairePourcentages(regionTexte);
    expect(pctsFerr.length).toBeGreaterThan(0);
    expect(pctsFerr.some((p) => p > 0)).toBe(true);
    expect(extraireNombresCAD(regionTexte).length).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T4-05 : Dossier endetté (couple-dettes) — P95 FI — (Pas de donnée), objectif carte et épuisement R3', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-dettes');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const fiTexte = await blocFi.innerText();
    const fiPct = extrairePourcentages(fiTexte);
    expect(fiPct.length).toBe(1);
    expect(fiPct[0]).toBeGreaterThan(0);
    expect(fiPct[0]).toBeLessThan(95);
    const corpsFi = fiTexte.replace(/Horizon simulé[\s\S]*$/i, '');
    const agesFi = extraireAges(corpsFi);
    expect(agesFi.length).toBe(2);
    expect(agesFi[0]).toBeGreaterThanOrEqual(35);
    expect(agesFi[0]).toBeLessThanOrEqual(agesFi[1]);
    expect(agesFi[1]).toBeLessThanOrEqual(90);
    expect(fiTexte).toMatch(/Horizon simulé\s*:\s*90\s*ans/i);

    const celluleP95 = blocFi.getByText('P95 (prudent)', { exact: true }).locator('..');
    await expect(celluleP95).toBeVisible();
    expect(await celluleP95.innerText()).toContain('—');
    expect(extraireAges(await celluleP95.innerText())).toEqual([]);
    await expect(celluleP95.getByText('Pas de donnée', { exact: true })).toHaveCount(1);

    const articleDette = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Éteindre la carte de crédit/i })
      .first();
    await expect(articleDette).toBeVisible();
    await expect(articleDette).toContainText('Évalué');
    const detteTexte = await articleDette.innerText();
    expect(detteTexte).toMatch(/2027/);
    const dettePct = extrairePourcentages(detteTexte);
    expect(dettePct.length).toBe(1);
    expect(dettePct[0]).toBeGreaterThan(0);
    expect(dettePct[0]).toBeLessThanOrEqual(100);
    const detteCads = extraireNombresCAD(detteTexte);
    expect(detteCads.length).toBe(2);
    expect(detteCads[0]).toBe(9_000);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    const carteEpuisement = exp
      .locator('ol li article')
      .filter({ hasText: /Patrimoine net négatif|Épuisement du patrimoine net|Épuisement des liquidités/i })
      .first();
    await expect(carteEpuisement).toBeVisible({ timeout: 10_000 });
    await expect(carteEpuisement).toContainText('Épuisement');
    const toggleEp = carteEpuisement.locator('button[aria-expanded]').first();
    await expect(toggleEp).toBeVisible({ timeout: 10_000 });
    await expect(toggleEp).toHaveAttribute('aria-expanded', 'false');
    await toggleEp.click();
    await expect(toggleEp).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggleEp.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();
    const regionTexte = await region.innerText();
    verifierTexteSansValeursInvalides(regionTexte);
    expect(regionTexte).toContain('Justifications fiscales (ARC / Revenu Québec)');
    expect(extraireNombresCAD(regionTexte).length).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T4-06 : Jeunes acheteurs (jeune-couple-dink) -> bascule persona vers lea-fauchee et recalcul propre', async ({ page }) => {
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'jeune-couple-dink');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    const pred = zonePredictions(page);
    const exp = zoneExplications(page);

    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const articleMaison = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Mise de fonds maison/i })
      .first();
    await expect(articleMaison).toBeVisible();
    await expect(articleMaison).toContainText('Évalué');
    const maisonTexte = await articleMaison.innerText();
    expect(maisonTexte).toMatch(/2030/);
    const maisonPct = extrairePourcentages(maisonTexte);
    expect(maisonPct.length).toBe(1);
    expect(maisonPct[0]).toBeGreaterThan(0);
    expect(maisonPct[0]).toBeLessThanOrEqual(100);
    const maisonCads = extraireNombresCAD(maisonTexte);
    expect(maisonCads.length).toBe(2);
    expect(maisonCads[0]).toBe(96_000);

    await changerPersona(page, 'lea-fauchee');
    await expect(pred).not.toContainText(/Mise de fonds maison/i, { timeout: 10_000 });
    await expect(boutonLancerGrandCalcul(panel)).toHaveText('Lancer le Grand Calcul', { timeout: 10_000 });
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(badgeParametresModifies(panel)).toHaveCount(0);
    await expect(pred.getByText('En attente du Grand Calcul')).toBeVisible({ timeout: 10_000 });
    expect(extraireNombresCAD(await pred.innerText())).toEqual([]);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible();
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    await expect(badgeParametresModifies(panel)).toHaveCount(0);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });

    const texteLea = await pred.innerText();
    verifierTexteSansValeursInvalides(texteLea);
    expect(texteLea).not.toMatch(/Mise de fonds maison/i);
    const articleUrgence = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Fonds urgence 3 mois/i })
      .first();
    await expect(articleUrgence).toBeVisible();
    await expect(articleUrgence).toContainText('Évalué');
    const urgenceTexte = await articleUrgence.innerText();
    expect(urgenceTexte).toMatch(/2028/);
    const urgencePct = extrairePourcentages(urgenceTexte);
    expect(urgencePct.length).toBe(1);
    expect(urgencePct[0]).toBeGreaterThanOrEqual(0);
    expect(urgencePct[0]).toBeLessThanOrEqual(100);
    const urgenceCads = extraireNombresCAD(urgenceTexte);
    expect(urgenceCads.length).toBe(2);
    expect(urgenceCads[0]).toBe(6_000);
    expect(urgenceCads[1]).toBeGreaterThan(0);

    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    const expLeaTexte = await exp.locator('ol').innerText();
    verifierTexteSansValeursInvalides(expLeaTexte);
    expect(expLeaTexte).not.toMatch(/Acquisition immobilière|hypothèque/i);
    const toggleLea = exp.locator('button[aria-expanded]').first();
    await expect(toggleLea).toHaveAttribute('aria-expanded', 'false');
    await toggleLea.click();
    await expect(toggleLea).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggleLea.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();
    expect(extraireNombresCAD(await region.innerText()).length).toBeGreaterThan(0);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    await expect(badgeParametresModifies(panel)).toHaveCount(0);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    await expect(pred).toContainText(/Fonds urgence 3 mois/i);
    await expect(pred).not.toContainText(/Mise de fonds maison/i);
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });
});
