/**
 * Suite E2E Grand Calcul — Tier 3 : Combinaisons inter-fonctionnalités par paires (12 tests Desktop Chrome).
 *
 * Complète `grandCalculMobile.spec.ts` (T3-13 et T3-14) pour atteindre 14 tests Tier 3.
 */
import { test, expect } from '@playwright/test';
import { activateTestMode, ecarterLeRail } from '../helpers/setup';
import {
  attacherCollecteursErreurs,
  badgeParametresModifies,
  barreProgressionGrandCalcul,
  boutonAnnulerGrandCalcul,
  boutonLancerGrandCalcul,
  cartePredictionR2,
  extraireAges,
  extraireCVaR95,
  extraireNombresCAD,
  extrairePourcentages,
  extraireTauxSurvie,
  lancerGrandCalcul,
  lancerGrandCalculEtAttendre,
  modifierParametresRetraiteDansProfil,
  ouvrirDossierLocalSansModeTest,
  ouvrirFuturAvecPersona,
  revelerCourbeProjection,
  toggleModeDiscret,
  verifierTexteSansValeursInvalides,
  zoneExplications,
  zoneGrandCalcul,
  zonePredictions,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Grand Calcul — Tier 3 : Combinaisons par paires (Desktop)', () => {
  test.setTimeout(180_000);

  test('T3-01 (F1 + F2) : 50k MC + régimes/crises vs base sans régimes produit une queue et un pouvoir d\'achat distincts', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: false,
      crisesHistoriques: false,
    });
    const baseTexte = await zoneGrandCalcul(page).innerText();
    const baseSurvie = extraireTauxSurvie(baseTexte);
    const baseCvar = extraireCVaR95(baseTexte);
    const basePouvoir = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());

    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });

    const regimesTexte = await panel.innerText();
    const regimesSurvie = extraireTauxSurvie(regimesTexte);
    const regimesCvar = extraireCVaR95(regimesTexte);
    const regimesPouvoir = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());
    const predTexte = await pred.innerText();

    expect(baseSurvie).not.toBeNull();
    expect(baseSurvie!).toBeGreaterThanOrEqual(0);
    expect(baseSurvie!).toBeLessThanOrEqual(100);
    expect(regimesSurvie).not.toBeNull();
    expect(regimesSurvie!).toBeGreaterThanOrEqual(0);
    expect(regimesSurvie!).toBeLessThanOrEqual(100);
    expect(baseCvar).not.toBeNull();
    expect(regimesCvar).not.toBeNull();
    expect(basePouvoir.length).toBe(3);
    expect(regimesPouvoir.length).toBe(3);
    expect(regimesCvar).not.toBe(baseCvar);
    expect(JSON.stringify(regimesPouvoir)).not.toBe(JSON.stringify(basePouvoir));

    verifierTexteSansValeursInvalides(regimesTexte);
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);
  });

  test('T3-02 (F1 + F7 + F10) : lancement 75k -> annulation en vol -> ajustement 50k -> relance complète', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 75_000 });

    const panel = zoneGrandCalcul(page);
    await expect(barreProgressionGrandCalcul(panel)).toBeVisible({ timeout: 10_000 });
    await boutonAnnulerGrandCalcul(panel).click();
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(0, { timeout: 10_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel.getByRole('status').filter({ hasText: /Calcul annulé/i })).toBeVisible();
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toBeVisible();
    await expect(boutonLancerGrandCalcul(panel)).toBeEnabled();

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(panel.getByRole('status').filter({ hasText: /Calcul annulé/i })).toHaveCount(0);
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    const panelTexte = await panel.innerText();
    expect(panelTexte).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(panelTexte).not.toMatch(/\b75[\s\u00a0\u202f]?000\s+simulations\b/i);

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);
  });

  test('T3-03 (F8 + F10 + Mode Discret) : calcul -> mode discret -> reload -> restauration IDB instantanée -> réactivation discret', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await toggleModeDiscret(page, true);
    await expect(zonePredictions(page).getByText('Montant masqué').first()).toBeAttached();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    // IndexedDB restaure instantanément sans relancer le worker ; isPrivacyMode repart à false au rechargement
    const panel = zoneGrandCalcul(page);
    const pred = zonePredictions(page);
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Activer le mode discret' })).toBeVisible();

    await toggleModeDiscret(page, true);
    expect(extraireNombresCAD(await pred.innerText())).toEqual([]);
    expect(extraireNombresCAD(await panel.innerText())).toEqual([]);
    expect(extraireNombresCAD(await zoneExplications(page).innerText())).toEqual([]);
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();
    await expect(pred.getByText('•••').first()).toBeVisible();
  });

  test('T3-04 (F3 + F10 + Recalcul obsolète) : âge retraite 60 -> 65 -> badge obsolète -> relance rafraîchit R2', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pouvoirAvant = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());
    expect(pouvoirAvant.length).toBe(3);

    await modifierParametresRetraiteDansProfil(page, { targetAge: 65 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 10_000 });
    await expect(zonePredictions(page).getByRole('status')).toContainText(/Paramètres modifiés/i);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await expect(badgeParametresModifies(panel)).toHaveCount(0);
    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    await expect(pred.getByText(/Paramètres modifiés/i)).toHaveCount(0);

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const fiTexte = await blocFi.innerText();
    expect(extrairePourcentages(fiTexte).length).toBeGreaterThan(0);
    const corpsFi = fiTexte.replace(/Horizon simulé[\s\S]*$/i, '');
    const agesFi = extraireAges(corpsFi);
    expect(agesFi.length).toBe(3);
    expect(agesFi[0]).toBeGreaterThanOrEqual(35);
    expect(agesFi[0]).toBeLessThanOrEqual(agesFi[1]);
    expect(agesFi[1]).toBeLessThanOrEqual(agesFi[2]);
    expect(agesFi[2]).toBeLessThanOrEqual(92);
    expect(fiTexte).toMatch(/Horizon simulé\s*:\s*92\s*ans/i);

    const pouvoirApres = extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText());
    expect(pouvoirApres.length).toBe(3);
    expect(pouvoirApres).not.toEqual(pouvoirAvant);

    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);
    expect(extrairePourcentages(predTexte).length).toBeGreaterThan(0);
  });

  test('T3-05 (F4 + F5 + F6 + F11) : sur pre-retraite-riche, tous les blocs R2 restent mutuellement cohérents', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    verifierTexteSansValeursInvalides(await pred.innerText());

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const fiTexte = await blocFi.innerText();
    const fiPct = extrairePourcentages(fiTexte);
    expect(fiPct.length).toBe(1);
    expect(fiPct[0]).toBeGreaterThan(0);
    expect(fiPct[0]).toBeLessThanOrEqual(100);
    const agesFi = extraireAges(fiTexte.replace(/Horizon simulé[\s\S]*$/i, ''));
    expect(agesFi.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < agesFi.length; i++) {
      expect(agesFi[i]).toBeGreaterThanOrEqual(58);
      expect(agesFi[i]).toBeLessThanOrEqual(94);
      if (i > 0) expect(agesFi[i - 1]).toBeLessThanOrEqual(agesFi[i]);
    }
    expect(fiTexte).toMatch(/Horizon simulé\s*:\s*94\s*ans/i);

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article')
      .filter({ hasText: /Léguer 500/i })
      .first();
    await expect(blocObj).toBeVisible();
    await expect(blocObj).toContainText('Évalué');
    const objTexte = await blocObj.innerText();
    const objPct = extrairePourcentages(objTexte);
    expect(objPct.length).toBe(1);
    expect(objPct[0]).toBeGreaterThan(0);
    expect(objPct[0]).toBeLessThanOrEqual(100);
    expect(extraireNombresCAD(objTexte).length).toBe(2);

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const pouvoirTexte = await blocPouvoir.innerText();
    const gpCads = extraireNombresCAD(pouvoirTexte);
    expect(gpCads.length).toBe(3);
    expect(gpCads[0]).toBeGreaterThan(0);
    expect(gpCads[0]).toBeLessThanOrEqual(gpCads[1]);
    expect(gpCads[1]).toBeLessThanOrEqual(gpCads[2]);
    expect(pouvoirTexte).toMatch(/Mois de retraite évalués\s*:\s*[1-9]\d*\s*mois/i);

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const lireLigneSuccession = async (labelRe: RegExp): Promise<number> => {
      const row = blocSuccession
        .locator('tr')
        .filter({ has: page.locator('th', { hasText: labelRe }) })
        .first();
      await expect(row).toBeVisible();
      const nums = extraireNombresCAD(await row.locator('td').first().innerText());
      expect(nums.length).toBe(1);
      return nums[0];
    };

    const total = await lireLigneSuccession(/^Total \(projection de base\)$/i);
    const arc = await lireLigneSuccession(/^ARC \(fédéral\)$/i);
    const rq = await lireLigneSuccession(/^Revenu Québec$/i);
    const mcP5 = await lireLigneSuccession(/^P5$/i);
    const mcP50 = await lireLigneSuccession(/^P50$/i);
    const mcP95 = await lireLigneSuccession(/^P95$/i);
    const mcRealP50 = await lireLigneSuccession(/^Médiane réelle/i);
    const reerFerr = await lireLigneSuccession(/^REER \/ FERR$/i);
    const gainCap = await lireLigneSuccession(/^Gain en capital imposable$/i);
    const dpa = await lireLigneSuccession(/^Récupération DPA/i);

    expect(total).toBeGreaterThan(0);
    expect(arc).toBeGreaterThan(0);
    expect(rq).toBeGreaterThan(0);
    expect(Math.abs(arc + rq - total)).toBeLessThanOrEqual(5);
    expect(mcP5).toBeGreaterThanOrEqual(0);
    expect(mcP5).toBeLessThanOrEqual(mcP50);
    expect(mcP50).toBeLessThanOrEqual(mcP95);
    expect(mcP50).toBeGreaterThan(0);
    expect(mcRealP50).toBeGreaterThan(0);
    expect(mcRealP50).toBeLessThanOrEqual(mcP50);
    expect(reerFerr).toBeGreaterThan(0);
    expect(gainCap).toBeGreaterThanOrEqual(0);
    expect(dpa).toBe(0);
    expect(await blocSuccession.innerText()).toMatch(/Âge projeté au décès\s*:\s*94\s*ans/i);
  });

  test('T3-06 (F6 + F9 + F12) : explications niveau 2 sur pre-retraite-riche alignées avec la succession ARC/RQ', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });

    const cartesCibles = [
      { nom: 'PSV', filtre: /Début de la PSV/i },
      { nom: 'FERR', filtre: /Premier retrait minimum FERR obligatoire/i },
      { nom: 'Succession', filtre: /Bilan terminal et impôt successoral/i },
    ];

    const regions: Record<string, string> = {};
    for (const cible of cartesCibles) {
      const carte = exp.locator('ol li article').filter({ hasText: cible.filtre }).first();
      await expect(carte).toBeVisible({ timeout: 10_000 });
      const toggle = carte.locator('button[aria-expanded]').first();
      await expect(toggle).toBeVisible({ timeout: 10_000 });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const regionId = await toggle.getAttribute('aria-controls');
      expect(regionId).toBeTruthy();
      const region = page.locator(`#${regionId}`);
      await expect(region).toBeVisible();
      const regionTexte = await region.innerText();
      verifierTexteSansValeursInvalides(regionTexte);
      expect(regionTexte).toContain('Justifications fiscales (ARC / Revenu Québec)');
      expect(extraireNombresCAD(regionTexte).length).toBeGreaterThan(0);
      regions[cible.nom] = regionTexte;
    }

    expect(regions.PSV).toMatch(/PSV\s*\(Service Canada\)/i);
    expect(regions.FERR).toMatch(/Taux minimum FERR/i);
    expect(extrairePourcentages(regions.FERR).length).toBeGreaterThan(0);
    expect(regions.Succession).toMatch(/ARC et Revenu Québec/i);

    const carteSuccession = exp.locator('ol li article').filter({ hasText: /Bilan terminal et impôt successoral/i }).first();
    const ligneImpotLatent = carteSuccession
      .locator('div.flex', { hasText: /Impôt latent \/ successoral/i })
      .first();
    const cadsImpotLatentR3 = extraireNombresCAD(await ligneImpotLatent.innerText());
    expect(cadsImpotLatentR3.length).toBe(1);
    expect(cadsImpotLatentR3[0]).toBeGreaterThan(0);

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const blocSuccession = cartePredictionR2(page, /impôt successoral/i);
    await expect(blocSuccession).toBeVisible();
    for (const labelRe of [
      /^Total \(projection de base\)$/i,
      /^ARC \(fédéral\)$/i,
      /^Revenu Québec$/i,
      /^P50$/i,
      /^REER \/ FERR$/i,
    ]) {
      const row = blocSuccession
        .locator('tr')
        .filter({ has: page.locator('th', { hasText: labelRe }) })
        .first();
      await expect(row).toBeVisible();
      const cellText = await row.locator('td').first().innerText();
      const nums = extraireNombresCAD(cellText);
      expect(nums.length).toBe(1);
      expect(nums[0]).toBeGreaterThan(0);
    }

    const rowP50 = blocSuccession
      .locator('tr')
      .filter({ has: page.locator('th', { hasText: /^P50$/i }) })
      .first();
    const cadsP50R2 = extraireNombresCAD(await rowP50.locator('td').first().innerText());
    expect(cadsImpotLatentR3[0]).toBe(cadsP50R2[0]);
  });

  test('T3-07 (F2 + F5 + F9) : régimes + crises complétés cohabitent avec explications et pouvoir d\'achat constant', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const articles = exp.locator('ol li article');
    await expect(articles.first()).toBeVisible({ timeout: 15_000 });
    expect(await articles.count()).toBeGreaterThan(1);
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    const olTexte = await exp.locator('ol').innerText();
    verifierTexteSansValeursInvalides(olTexte);
    expect(extraireNombresCAD(olTexte).length).toBeGreaterThan(0);

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const pouvoirTexte = await blocPouvoir.innerText();
    verifierTexteSansValeursInvalides(pouvoirTexte);
    expect(pouvoirTexte).toMatch(/dollars constants/i);
    const cadsPouvoir = extraireNombresCAD(pouvoirTexte);
    expect(cadsPouvoir.length).toBeGreaterThanOrEqual(3);
    expect(cadsPouvoir[0]).toBeGreaterThan(0);
    expect(cadsPouvoir[0]).toBeLessThanOrEqual(cadsPouvoir[1]);
    expect(cadsPouvoir[1]).toBeLessThanOrEqual(cadsPouvoir[2]);
  });

  test('T3-08 (F4 + Changement d\'horizon + No-Fake-Data) : espérance de vie 94 -> 80 bascule Léguer 500 k$ (2055) à —', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const predAvant = zonePredictions(page);
    await expect(predAvant.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const articleAvant = cartePredictionR2(page, /probabilités par objectif/i)
      .locator('article', { hasText: /Léguer 500/i })
      .first();
    await expect(articleAvant).toContainText(/Évalué/);
    expect(extrairePourcentages(await articleAvant.innerText()).length).toBe(1);

    await modifierParametresRetraiteDansProfil(page, { lifeExpectancy: 80 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const panel = zoneGrandCalcul(page);
    await expect(badgeParametresModifies(panel)).toHaveCount(0);

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    verifierTexteSansValeursInvalides(await pred.innerText());

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    const articleLeguer = blocObj.locator('article', { hasText: /Léguer 500/i }).first();
    await expect(articleLeguer).toBeVisible();
    await expect(articleLeguer).toContainText(/Hors horizon/);
    await expect(articleLeguer.getByText('Pas de donnée', { exact: true })).toHaveCount(2);
    const articleTexte = await articleLeguer.innerText();
    expect(articleTexte).toContain('—');
    expect(extrairePourcentages(articleTexte)).toEqual([]);
    expect(extraireNombresCAD(articleTexte).length).toBe(1);

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    await expect(blocFi).toContainText(/Horizon simulé\s*:\s*80\s*ans/i);
  });

  test('T3-09 (F7 + Contrôles rapides + Navigation) : basculer IQPF et ouvrir Historique pendant le Worker sans blocage', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    const panel = zoneGrandCalcul(page);
    const progress = barreProgressionGrandCalcul(panel);
    await expect(progress).toBeVisible({ timeout: 10_000 });

    const btnHist = page.getByRole('button', { name: 'Historique', exact: true });
    await btnHist.click();
    const dialog = page.getByRole('dialog', { name: 'Historique' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(progress).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(progress).toBeVisible();

    const iqpf = page.getByRole('button', { name: /Normes IQPF 2026/i }).first();
    await expect(iqpf).toBeVisible({ timeout: 10_000 });
    await iqpf.click();
    await expect(iqpf).toHaveAttribute('aria-pressed', 'true');
    await expect(progress).toBeVisible();

    await boutonAnnulerGrandCalcul(panel).click();
    await expect(progress).toHaveCount(0, { timeout: 10_000 });
    expect(pageErrors).toEqual([]);
  });

  test('T3-10 (F8 + ProjectionRequired) : dossier vide -> activation mode test -> Grand Calcul -> persistance au rechargement', async ({ page }) => {
    await ouvrirDossierLocalSansModeTest(page, '#RETIREMENT');
    await expect(page.getByText(/Projection nécessaire|Donnée illisible/i).first()).toBeVisible({ timeout: 10_000 });

    await activateTestMode(page);
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    const pred = zonePredictions(page);
    const exp = zoneExplications(page);

    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);

    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);

    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    expect(await exp.locator('ol li article').count()).toBeGreaterThan(0);
    verifierTexteSansValeursInvalides(await exp.innerText());
  });

  test('T3-11 (F9 + F12 + PanneauJour + Mode Discret) : inspection jour futur + niveau 2 + bascule discret sans fuite', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const demain = page.getByRole('button', { name: /Lendemain/i }).first();
    await expect(demain).toBeVisible({ timeout: 10_000 });
    await demain.click();

    // Vérifier l'épingle et les montants en clair AVANT tout clic hors du panneau
    // (useSelectionJour relâche l'épingle sur pointerdown hors panneauRef/containerRef).
    const panneauEpingle = page.locator('[data-panneau-jour][data-jour-epingle]');
    await expect(panneauEpingle).toBeVisible({ timeout: 10_000 });
    const panneauAvant = await panneauEpingle.innerText();
    verifierTexteSansValeursInvalides(panneauAvant);
    expect(extraireNombresCAD(panneauAvant).length).toBeGreaterThan(0);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.getByText('Point inspecté sur la courbe')).toBeVisible({ timeout: 10_000 });
    await expect(exp.getByText('Épinglé', { exact: true })).toBeVisible({ timeout: 10_000 });

    const toggle = exp.locator('button[aria-expanded]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();
    const regionAvant = await region.innerText();
    verifierTexteSansValeursInvalides(regionAvant);
    expect(extraireNombresCAD(regionAvant).length).toBeGreaterThan(0);

    await toggleModeDiscret(page, true);
    const expApres = await exp.innerText();
    verifierTexteSansValeursInvalides(expApres);
    expect(extraireNombresCAD(expApres)).toEqual([]);
    await expect(region.getByText('•••').first()).toBeVisible();
    await expect(region.getByText('Montant masqué').first()).toBeAttached();

    const panneauJour = page.locator('[data-panneau-jour]');
    await expect(panneauJour).toBeVisible();
    const panneauApres = await panneauJour.innerText();
    verifierTexteSansValeursInvalides(panneauApres);
    expect(extraireNombresCAD(panneauApres)).toEqual([]);
    await expect(panneauJour.getByText('•••').first()).toBeVisible();
    await expect(panneauJour.getByText('Montant masqué').first()).toBeAttached();
  });

  test('T3-12 (F3 + F4 + F5 + BoutonsPimenterFutur) : levier rapide déclenche badge obsolète puis relance actualise R2', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });

    const levier = page.locator('[data-testid="boutons-pimenter-futur"] button').first();
    await expect(levier).toBeVisible({ timeout: 10_000 });
    await levier.click();
    await expect(levier).toHaveAttribute('aria-pressed', 'true');

    const panel = zoneGrandCalcul(page);
    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 10_000 });
    await expect(pred.getByRole('status')).toContainText(/Paramètres modifiés/i);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(badgeParametresModifies(panel)).toHaveCount(0);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0);
    await expect(pred.getByText(/Paramètres modifiés/i)).toHaveCount(0);

    const predTexte = await pred.innerText();
    verifierTexteSansValeursInvalides(predTexte);
    expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);
    expect(extraireNombresCAD(await cartePredictionR2(page, /pouvoir d'achat/i).innerText()).length).toBeGreaterThanOrEqual(3);
    await expect(cartePredictionR2(page, /probabilités par objectif/i)).toContainText(/Fond urgence 6 mois/i);
    await expect(cartePredictionR2(page, /indépendance financière/i)).toContainText(/%/);
  });
});
