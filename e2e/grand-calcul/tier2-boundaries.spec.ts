/**
 * Suite E2E Grand Calcul — Tier 2 : Limites, cas limites et conformité (54 tests Desktop Chrome).
 *
 * Complète `grandCalculMobile.spec.ts` (6 tests limites mobiles F10–F12) pour atteindre
 * exactement 60 tests Tier 2 (5 par fonctionnalité F1–F12).
 */
import { test, expect } from '@playwright/test';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { ecarterLeRail } from '../helpers/setup';
import {
  attacherCollecteursErreurs,
  auditerAbsenceHoverTransform,
  badgeParametresModifies,
  barreProgressionGrandCalcul,
  boutonAnnulerGrandCalcul,
  boutonLancerGrandCalcul,
  cartePredictionR2,
  changerPersona,
  configurerGrandCalcul,
  corrompreEnregistrementGrandCalculIDB,
  estBasculeGrandCalculActive,
  extraireAges,
  extraireNombresCAD,
  extrairePourcentages,
  lancerGrandCalcul,
  lancerGrandCalculEtAttendre,
  lireLocalStoragePrincipal,
  modifierParametresRetraiteDansProfil,
  ouvrirDossierLocalSansModeTest,
  ouvrirFuturAvecPersona,
  revelerCourbeProjection,
  supprimerClesAppareilIDB,
  toggleModeDiscret,
  verifierTexteSansValeursInvalides,
  zoneExplications,
  zoneGrandCalcul,
  zonePredictions,
} from './helpers';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.describe('Grand Calcul — Tier 2 : Cas limites et robustesse (Desktop)', () => {
  test.setTimeout(150_000);

  // =========================================================================
  // F1 — Bornes du moteur MC lourd (50k–100k)
  // =========================================================================
  test('T2-F1-01 : saisir moins de 50 000 trajectoires est borné à >= 50 000', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    const champ = panel.getByRole('spinbutton', { name: /trajectoires|itérations|simulations/i }).first();
    await expect(champ).toBeVisible({ timeout: 10_000 });
    await expect(champ).toBeEnabled({ timeout: 5_000 });
    await champ.fill('1000');
    await champ.blur();
    await expect(champ).toHaveValue('50000');
    await lancerGrandCalculEtAttendre(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    const texte = await panel.innerText();
    expect(texte).not.toMatch(/\b1[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(texte).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
  });

  test('T2-F1-02 : saisir plus de 100 000 trajectoires est borné à <= 100 000 sans plantage', async ({ page }) => {
    test.setTimeout(180_000);
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    const champ = panel.getByRole('spinbutton', { name: /trajectoires|itérations|simulations/i }).first();
    await expect(champ).toBeVisible({ timeout: 10_000 });
    await expect(champ).toBeEnabled({ timeout: 5_000 });
    await champ.fill('500000');
    await champ.blur();
    await expect(champ).toHaveValue('100000');
    await lancerGrandCalculEtAttendre(page, { timeoutMs: 160_000 });
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).not.toMatch(/\b500[\s\u00a0\u202f]?000\b/);
    expect(texte).toMatch(/\b100[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(pageErrors).toEqual([]);
  });

  test('T2-F1-03 : une entrée non numérique dans le sélecteur retombe sur une borne valide sans erreur', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    const champ = panel.getByRole('spinbutton', { name: /trajectoires|itérations|simulations/i }).first();
    await expect(champ).toBeVisible({ timeout: 10_000 });
    await expect(champ).toBeEnabled({ timeout: 5_000 });
    await champ.fill('');
    await champ.blur();
    await expect(champ).toHaveValue('50000');
    await lancerGrandCalculEtAttendre(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(pageErrors).toEqual([]);
  });

  test('T2-F1-04 : exécuter 100 000 trajectoires produit zéro erreur console ou pageerror', async ({ page }) => {
    test.setTimeout(180_000);
    const { pageErrors, consoleErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 100_000, timeoutMs: 160_000 });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/\b100[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('T2-F1-05 : basculer de couple-confort vers lea-fauchee invalide l\'ancien résultat Grand Calcul', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await changerPersona(page, 'lea-fauchee');
    await expect(zonePredictions(page)).not.toContainText(/Fond urgence 6 mois/i, { timeout: 10_000 });
    await expect(zonePredictions(page).getByRole('status')).toContainText(/En attente du Grand Calcul/i, {
      timeout: 10_000,
    });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('button', { name: /^Lancer le Grand Calcul$/i })).toBeVisible();
    expect(await panel.innerText()).not.toMatch(/\d+\s+simulations/i);
  });

  // =========================================================================
  // F2 — Limites régimes macroéconomiques & crises historiques
  // =========================================================================
  test('T2-F2-01 : crises historiques activées sans régimes macro s\'exécutent sans NaN', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: false,
      crisesHistoriques: true,
    });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(1);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extrairePourcentages(texte).length).toBeGreaterThan(0);
  });

  test('T2-F2-02 : dossier endetté (couple-dettes) avec régimes + crises gère la ruine sans Infinity ni NaN', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-dettes');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);
    const texteMain = await page.locator('main').innerText();
    verifierTexteSansValeursInvalides(texteMain);
    const textePanel = await panel.innerText();
    expect(textePanel).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extrairePourcentages(textePanel).length).toBeGreaterThan(0);
  });

  test('T2-F2-03 : horizon court (gilles-actif-decaisse, 71->92 ans) avec régimes termine sans débordement', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    const textePred = await zonePredictions(page).innerText();
    verifierTexteSansValeursInvalides(textePred);
    expect(extrairePourcentages(textePred).length).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('T2-F2-04 : modifier la bascule des régimes après un calcul signale que le résultat n\'est plus à jour', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: false,
    });
    await configurerGrandCalcul(page, { regimesMacro: false });
    const panel = zoneGrandCalcul(page);
    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 10_000 });
    await expect(zonePredictions(page).getByRole('status')).toContainText(/Paramètres modifiés/i);
  });

  test('T2-F2-05 : bascules rapides répétées avant lancement exécutent la configuration finale choisie', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await configurerGrandCalcul(page, { regimesMacro: false, crisesHistoriques: false });
    await configurerGrandCalcul(page, { regimesMacro: true, crisesHistoriques: true });
    await configurerGrandCalcul(page, { regimesMacro: false, crisesHistoriques: false });
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(1);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(1);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(await estBasculeGrandCalculActive(panel, /régimes macro/i)).toBe(false);
    expect(await estBasculeGrandCalculActive(panel, /crises historiques/i)).toBe(false);
  });

  // =========================================================================
  // F3 — Limites âge d'indépendance financière
  // =========================================================================
  test('T2-F3-01 : FI inatteignable (couple-dettes avec revenus réduits) affiche — (Pas de donnée), jamais 0 ou 999', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-dettes', { revelerCourbe: false });
    await page.goto('/?nogate=1#PROFILE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.locator('[data-testid="tab-transition-container"][data-active-tab="PROFILE"]')).toBeVisible({
      timeout: 10_000,
    });
    const ongletRevenus = page.getByRole('tab', { name: /^Revenus$/i });
    await expect(ongletRevenus).toBeVisible({ timeout: 10_000 });
    await ongletRevenus.click();

    await page.locator('#ucf-gross-0').fill('6000');
    await page.locator('#ucf-gross-0').blur();
    await page.locator('#ucf-net-0').fill('500');
    await page.locator('#ucf-net-0').blur();
    await page.locator('#ucf-gross-1').fill('0');
    await page.locator('#ucf-gross-1').blur();
    await page.locator('#ucf-net-1').fill('0');
    await page.locator('#ucf-net-1').blur();

    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const texte = await blocFi.innerText();
    const corpsQuantiles = texte.replace(/Horizon simulé[\s\S]*$/i, '');
    expect(corpsQuantiles).toContain('—');
    expect(extraireAges(corpsQuantiles)).toEqual([]);
    expect(texte).not.toMatch(/\b999\s*ans\b/);
    expect(texte).not.toMatch(/\b0\s*ans\b/);
    expect(texte).toMatch(/Horizon simulé\s*:\s*90\s*ans/i);
    await expect(blocFi.getByText('Pas de donnée', { exact: true })).toHaveCount(3);
  });

  test('T2-F3-02 : profil déjà proche/à l\'indépendance (pre-retraite-riche) reste >= âge actuel (58 ans)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const texte = await blocFi.innerText();
    const corpsQuantiles = texte.replace(/Horizon simulé[\s\S]*$/i, '');
    const ages = extraireAges(corpsQuantiles);
    expect(ages.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < ages.length; i++) {
      expect(ages[i]).toBeGreaterThanOrEqual(58);
      expect(ages[i]).toBeLessThanOrEqual(94);
      if (i > 0) {
        expect(ages[i - 1]).toBeLessThanOrEqual(ages[i]);
      }
    }
    expect(texte).toMatch(/Horizon simulé\s*:\s*94\s*ans/i);
  });

  test('T2-F3-03 : censure à droite sur atteinte partielle (pas d\'extrapolation artificielle au-delà de l\'horizon)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'lea-fauchee');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const texte = await blocFi.innerText();
    verifierTexteSansValeursInvalides(texte);
    const corpsQuantiles = texte.replace(/Horizon simulé[\s\S]*$/i, '');
    const ages = extraireAges(corpsQuantiles);
    expect(ages.length).toBe(2);
    expect(ages[0]).toBeGreaterThanOrEqual(24);
    expect(ages[0]).toBeLessThanOrEqual(ages[1]);
    expect(ages[1]).toBeLessThanOrEqual(92);
    await expect(blocFi.getByText('Pas de donnée', { exact: true })).toHaveCount(1);
    expect(texte).toMatch(/Horizon simulé\s*:\s*92\s*ans/i);
  });

  test('T2-F3-04 : horizon court (espérance de vie 80 ans sur gilles-actif-decaisse) borne l\'âge FI <= 80', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await modifierParametresRetraiteDansProfil(page, { lifeExpectancy: 80 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const texte = await blocFi.innerText();
    const corpsQuantiles = texte.replace(/Horizon simulé[\s\S]*$/i, '');
    const ages = extraireAges(corpsQuantiles);
    expect(ages.length).toBe(3);
    for (let i = 0; i < ages.length; i++) {
      expect(ages[i]).toBeGreaterThanOrEqual(71);
      expect(ages[i]).toBeLessThanOrEqual(80);
      if (i > 0) {
        expect(ages[i - 1]).toBeLessThanOrEqual(ages[i]);
      }
    }
    expect(texte).toMatch(/Horizon simulé\s*:\s*80\s*ans/i);
  });

  test('T2-F3-05 : avant exécution du Grand Calcul, l\'âge FI affiche — (no-fake-data)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByRole('status')).toContainText(/En attente du Grand Calcul/i);
    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const texte = await blocFi.innerText();
    expect(texte).toContain('—');
    expect(extraireAges(texte)).toEqual([]);
    expect(extrairePourcentages(texte)).toEqual([]);
    await expect(blocFi.getByText('Pas de donnée', { exact: true })).toHaveCount(5);
    verifierTexteSansValeursInvalides(texte);
  });

  // =========================================================================
  // F4 — Limites probabilités datées par objectif financier
  // =========================================================================
  test('T2-F4-01 : objectif au-delà de l\'horizon (2055 avec espérance de vie 80) affiche — (hors horizon)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await modifierParametresRetraiteDansProfil(page, { lifeExpectancy: 80 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /Léguer 500/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    expect(texte).toMatch(/Léguer 500/i);
    expect(texte).toMatch(/Hors horizon/);
    expect(texte).toContain('—');
    expect(extrairePourcentages(texte)).toEqual([]);
    expect(extraireNombresCAD(texte).length).toBe(1);
    await expect(blocObj.getByText('Pas de donnée', { exact: true })).toHaveCount(2);
  });

  test('T2-F4-02 : objectif financé (couple-confort, Fond urgence 6 mois) affiche atteinte >= 95 % et déficit médian 0 $', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /Fond urgence 6 mois/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    const pcts = extrairePourcentages(texte);
    expect(pcts.length).toBe(1);
    expect(pcts[0]).toBeGreaterThanOrEqual(95);
    expect(texte).toMatch(/Déficit médian\s*:\s*0\s*\$/i);
  });

  test('T2-F4-03 : aucun objectif configuré affiche un état vide propre sans crash', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const cleared = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { state?: Record<string, unknown> };
      if (!parsed.state) return false;
      parsed.state.financialGoals = [];
      localStorage.setItem(key, JSON.stringify(parsed));
      return true;
    }, STORAGE_KEYS.persistStore);
    expect(cleared).toBe(true);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible();
    await expect(blocObj.locator('article')).toHaveCount(0);
    await expect(blocObj.getByText(/Aucun objectif financier actif configuré/i)).toBeVisible();
    await expect(blocObj.getByText('Pas de donnée', { exact: true })).toHaveCount(1);
    const texte = await blocObj.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(extrairePourcentages(texte)).toEqual([]);
    expect(extraireNombresCAD(texte)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test('T2-F4-04 : échéance tendue (autonome-monoparentale, REER autonome 100 k$) produit un déficit médian positif cohérent', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'autonome-monoparentale');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /REER autonome 100/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    verifierTexteSansValeursInvalides(texte);
    const pcts = extrairePourcentages(texte);
    expect(pcts.length).toBe(1);
    expect(pcts[0]).toBeLessThan(80);
    const matchDeficit = texte.match(/Déficit médian\s*:\s*(-?\d[\d\s\u00a0\u202f]*)\s*\$/i);
    expect(matchDeficit).not.toBeNull();
    const deficit = Number((matchDeficit?.[1] ?? '0').replace(/[\s\u00a0\u202f]/g, ''));
    expect(deficit).toBeGreaterThan(0);
  });

  test('T2-F4-05 : avant le Grand Calcul, la probabilité des objectifs affiche — et non 0 % simulé', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible({ timeout: 15_000 });
    await expect(blocObj.getByText(/Lancez le Grand Calcul pour évaluer vos objectifs financiers/i)).toBeVisible();
    await expect(blocObj.getByText('Pas de donnée', { exact: true })).toHaveCount(1);
    const texte = await blocObj.innerText();
    expect(texte).toContain('—');
    expect(extrairePourcentages(texte)).toEqual([]);
    expect(extraireNombresCAD(texte)).toEqual([]);
  });

  // =========================================================================
  // F5 — Limites pouvoir d'achat réel mensuel net garanti
  // =========================================================================
  test('T2-F5-01 : zéro mois de retraite évalués (targetAge 95, lifeExpectancy 90) affiche — (Pas de donnée) sans montant fantôme', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort', { revelerCourbe: false });
    await modifierParametresRetraiteDansProfil(page, { targetAge: 95, lifeExpectancy: 90 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toContain('—');
    expect(extraireNombresCAD(texte)).toEqual([]);
    await expect(blocPouvoir.getByText('Pas de donnée', { exact: true })).toHaveCount(4);
  });

  test('T2-F5-02 : fenêtre de retraite minimale (targetAge 75, lifeExpectancy 80) calcule sans division par zéro', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await modifierParametresRetraiteDansProfil(page, { targetAge: 75, lifeExpectancy: 80 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    verifierTexteSansValeursInvalides(texte);
    const cads = extraireNombresCAD(texte);
    expect(cads.length).toBeGreaterThanOrEqual(3);
    expect(cads[0]).toBeGreaterThan(0);
    expect(cads[0]).toBeLessThanOrEqual(cads[1]);
    expect(cads[1]).toBeLessThanOrEqual(cads[2]);
    expect(texte).toMatch(/Mois de retraite évalués\s*:\s*[1-9]\d*\s*mois/i);
  });

  test('T2-F5-03 : profil gilles-actif-decaisse (71 ans) produit des seuils P95 <= P90 <= P50 finis et > 0', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    verifierTexteSansValeursInvalides(texte);
    const cads = extraireNombresCAD(texte);
    expect(cads.length).toBeGreaterThanOrEqual(3);
    expect(cads[0]).toBeGreaterThan(0);
    expect(cads[0]).toBeLessThanOrEqual(cads[1]);
    expect(cads[1]).toBeLessThanOrEqual(cads[2]);
  });

  test('T2-F5-04 : le libellé distingue explicitement les dollars constants du nominal', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    expect(texte).toMatch(/constant|réel/i);
    const cads = extraireNombresCAD(texte);
    expect(cads.length).toBeGreaterThanOrEqual(3);
    expect(cads[0]).toBeGreaterThan(0);
    expect(cads[0]).toBeLessThanOrEqual(cads[1]);
    expect(cads[1]).toBeLessThanOrEqual(cads[2]);
  });

  test('T2-F5-05 : avant le Grand Calcul, les centiles P95/P90/P50 affichent —', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible({ timeout: 15_000 });
    const texte = await blocPouvoir.innerText();
    expect(texte).toContain('—');
    expect(extraireNombresCAD(texte)).toEqual([]);
    await expect(blocPouvoir.getByText('Pas de donnée', { exact: true })).toHaveCount(4);
  });

  // =========================================================================
  // F6 — Limites impôt successoral latent (ARC & Revenu Québec)
  // =========================================================================
  test('T2-F6-01 : patrimoine épuisé (couple-dettes) ne produit jamais d\'impôt successoral négatif', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-dettes');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    verifierTexteSansValeursInvalides(texte);
    const cads = extraireNombresCAD(texte);
    expect(cads.length).toBeGreaterThanOrEqual(10);
    expect(texte).toMatch(/Total\s*\(projection de base\)[^\n]*\b0\s*\$/i);
    for (const val of cads) {
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });

  test('T2-F6-02 : dossier modeste CELI (lea-fauchee) affiche 0 $ pour gain en capital et récupération DPA', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'lea-fauchee');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    verifierTexteSansValeursInvalides(texte);
    const cads = extraireNombresCAD(texte);
    expect(cads.length).toBe(10);
    expect(texte).toMatch(/Gain en capital imposable[^\n]*\b0\s*\$/i);
    expect(texte).toMatch(/Récupération DPA\s*\(locatif\)[^\n]*\b0\s*\$/i);
  });

  test('T2-F6-03 : mortalité précoce (espérance de vie 80 sur gilles-actif-decaisse) met à jour l\'âge au décès', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await modifierParametresRetraiteDansProfil(page, { lifeExpectancy: 80 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    expect(texte).toMatch(/80\s*ans/i);
    const cads = extraireNombresCAD(texte);
    expect(cads.length).toBe(10);
    const matchTotal = texte.match(/Total\s*\(projection de base\)[^\n]*?(-?\d[\d\s\u00a0\u202f]*)\s*\$/i);
    expect(matchTotal).not.toBeNull();
    const total = Number((matchTotal?.[1] ?? '0').replace(/[\s\u00a0\u202f]/g, ''));
    expect(total).toBeGreaterThan(0);
  });

  test('T2-F6-04 : fort REER + locatif (pre-retraite-riche) remplit ARC, RQ, REER/FERR, gain en capital et DPA > 0', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche', { revelerCourbe: false });
    await page.goto('/?nogate=1#SETTINGS');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.locator('[data-testid="tab-transition-container"][data-active-tab="SETTINGS"]')).toBeVisible({
      timeout: 10_000,
    });
    const ongletPatrimoine = page.getByRole('tab', { name: /Patrimoine/i });
    await expect(ongletPatrimoine).toBeVisible({ timeout: 10_000 });
    await ongletPatrimoine.click();

    const btnAjouter = page.getByRole('button', { name: /\+ Ajouter un immeuble locatif/i });
    await expect(btnAjouter).toBeVisible({ timeout: 10_000 });
    await btnAjouter.click();

    const summaryLocatif = page.locator('details summary', { hasText: /Nouveau locatif/i }).first();
    await expect(summaryLocatif).toBeVisible({ timeout: 5_000 });
    await summaryLocatif.click();

    await page.getByLabel("Prix d'achat (dollars)").fill('350000');
    await page.getByLabel('Valeur actuelle (dollars)').fill('550000');
    await page.getByLabel('Loyer mensuel (dollars)').fill('2800');
    await page.getByLabel('Charges mensuelles (dollars)').fill('700');
    await page.getByLabel('DPA cumulée (dollars)').fill('25000');
    await page.getByLabel('DPA cumulée (dollars)').blur();

    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    for (const labelRe of [
      /^ARC \(fédéral\)$/i,
      /^Revenu Québec$/i,
      /^REER \/ FERR$/i,
      /^Gain en capital imposable$/i,
      /^Récupération DPA \(locatif\)$/i,
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
  });

  test('T2-F6-05 : avant le Grand Calcul, les quantiles MC successoraux affichent —', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible({ timeout: 15_000 });
    const texte = await blocSuccession.innerText();
    expect(texte).toContain('—');
    expect(extraireNombresCAD(texte)).toEqual([]);
    expect(extraireAges(texte)).toEqual([]);
    await expect(blocSuccession.getByText('Pas de donnée', { exact: true })).toHaveCount(11);
  });

  // =========================================================================
  // F7 — Limites Web Worker, progression & annulation
  // =========================================================================
  test('T2-F7-01 : double clic rapide sur Lancer ne lance pas deux exécutions concurrentes corrompues', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    const btn = boutonLancerGrandCalcul(panel);
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toBeEnabled({ timeout: 10_000 });
    await btn.click();
    await btn.click({ force: true, timeout: 500 }).catch(() => {});

    await expect(btn).toBeDisabled();
    const progress = barreProgressionGrandCalcul(panel);
    await expect(progress).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByRole('progressbar')).toHaveCount(1);
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(1);
    const rawVal = await progress.getAttribute('aria-valuenow');
    expect(rawVal).not.toBeNull();
    const val = Number(rawVal);
    expect(Number.isFinite(val) && val >= 0 && val <= 100).toBe(true);
    await boutonAnnulerGrandCalcul(panel).click().catch(() => {});
    await expect(progress).toHaveCount(0, { timeout: 10_000 });
  });

  test('T2-F7-02 : annuler puis relancer immédiatement repart proprement et se termine', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    const panel = zoneGrandCalcul(page);
    const cancelBtn = boutonAnnulerGrandCalcul(panel);
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();
    await expect(cancelBtn).toHaveCount(0, { timeout: 10_000 });
    await expect(panel.getByRole('status').filter({ hasText: /Calcul annulé/i })).toBeVisible();

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(panel.getByRole('status').filter({ hasText: /Calcul annulé/i })).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extraireNombresCAD(await zonePredictions(page).innerText()).length).toBeGreaterThan(0);
  });

  test('T2-F7-03 : quitter vers #PROFILE pendant le Worker puis revenir sur #FUTURE ne plante pas l\'application', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    await page.goto('/?nogate=1#PROFILE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.locator('[data-testid="tab-transition-container"][data-active-tab="PROFILE"]')).toBeVisible({
      timeout: 10_000,
    });

    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.getByRole('heading', { name: 'Projection', level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(zoneGrandCalcul(page)).toBeVisible({ timeout: 15_000 });
    await boutonAnnulerGrandCalcul(zoneGrandCalcul(page)).click().catch(() => {});
    await expect(barreProgressionGrandCalcul(zoneGrandCalcul(page))).toHaveCount(0, { timeout: 10_000 });
    verifierTexteSansValeursInvalides(await page.locator('main').innerText());
    expect(pageErrors).toEqual([]);
  });

  test('T2-F7-04 : échec réseau du script Worker affiche un message d\'erreur français sans spinner infini', async ({ page }) => {
    await page.context().route('**/*projection.worker*', (route) => route.abort());

    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });

    await lancerGrandCalcul(page, { iterations: 50_000 });

    const errLoc = panel.getByRole('alert').filter({
      hasText: /erreur|impossible|échec|interrompu/i,
    });
    await expect(errLoc.first()).toBeVisible({ timeout: 15_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonLancerGrandCalcul(panel)).toBeEnabled({ timeout: 10_000 });
  });

  test('T2-F7-05 : annuler un recalcul conserve un état UI sain sans valeurs NaN', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await lancerGrandCalcul(page, { iterations: 100_000 });
    const panel = zoneGrandCalcul(page);
    const cancelBtn = boutonAnnulerGrandCalcul(panel);
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();
    await expect(cancelBtn).toHaveCount(0, { timeout: 10_000 });

    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel.getByRole('status').filter({ hasText: /Calcul annulé/i })).toBeVisible();
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extraireNombresCAD(await zonePredictions(page).innerText()).length).toBeGreaterThan(0);
    verifierTexteSansValeursInvalides(await page.locator('main').innerText());
  });

  // =========================================================================
  // F8 — Limites persistance IndexedDB & Store
  // =========================================================================
  test('T2-F8-01 : enregistrement IndexedDB corrompu géré avec repli honnête et relance possible', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const corrompu = await corrompreEnregistrementGrandCalculIDB(page);
    expect(corrompu).toBe(true);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole('alert')).toContainText(/Donnée illisible/i, { timeout: 10_000 });
    await expect(panel).toContainText('Aucun calcul enregistré');
    await expect(panel).toContainText('—');
    const btnLancer = panel.getByRole('button', { name: 'Lancer le Grand Calcul', exact: true });
    await expect(btnLancer).toBeVisible();
    await expect(btnLancer).toBeEnabled();

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByRole('status')).toContainText(/Sauvegarde locale illisible/i);

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(panel.getByRole('alert')).toHaveCount(0);
    await expect(pred.getByRole('status')).toHaveCount(0);
    expect(await panel.innerText()).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  test('T2-F8-02 : clé de chiffrement appareil absente déclenche un repli gracieux sans écran blanc', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const supprime = await supprimerClesAppareilIDB(page);
    expect(supprime).toBe(true);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByRole('alert')).toContainText(/Donnée illisible/i, { timeout: 10_000 });
    await expect(panel).toContainText('Aucun calcul enregistré');
    await expect(panel).toContainText('—');
    await expect(panel.getByRole('button', { name: 'Lancer le Grand Calcul', exact: true })).toBeEnabled();

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByRole('status')).toContainText(/Sauvegarde locale illisible/i);
    verifierTexteSansValeursInvalides(await page.locator('main').innerText());
    expect(pageErrors).toEqual([]);
  });

  test('T2-F8-03 : recharger pendant une exécution récupère proprement sans bloquer sur état actif', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });
    await expect(barreProgressionGrandCalcul(zoneGrandCalcul(page))).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonLancerGrandCalcul(panel)).toBeEnabled();
    verifierTexteSansValeursInvalides(await panel.innerText());
  });

  test('T2-F8-04 : quitter le mode test ne fuit pas le Grand Calcul du persona vers le dossier réel', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await page.goto('/?nogate=1#SETTINGS');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    const btnQuitter = page.getByRole('button', { name: /Quitter le mode test|Désactiver le mode test/i }).first();
    await expect(btnQuitter).toBeVisible({ timeout: 8_000 });
    await btnQuitter.click();
    const btnOui = page.getByRole('button', { name: 'Oui', exact: true });
    await expect(btnOui).toBeVisible({ timeout: 5_000 });
    await btnOui.click();
    await expect(page.getByRole('status', { name: 'Mode test activé' })).toHaveCount(0, { timeout: 8_000 });

    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.locator('[data-testid="tab-transition-container"][data-active-tab="FUTURE"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('heading', { name: 'Projection', level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('main')).toContainText(
      /Renseigne ton profil|Ta projection se recharge|Compose tes leviers|Grand Calcul|Projection nécessaire/i,
      { timeout: 10_000 },
    );
    const panel = zoneGrandCalcul(page);
    if ((await panel.count()) > 0) {
      await expect(panel.getByText(/Restauration de la sauvegarde locale/)).toHaveCount(0, { timeout: 15_000 });
    }
    expect(await page.locator('main').innerText()).not.toMatch(/Léguer 500/i);
    await expect(zonePredictions(page)).toHaveCount(0);
    expect((await lireLocalStoragePrincipal(page)) ?? '').not.toMatch(/Léguer 500/i);
  });

  test('T2-F8-05 : deux rechargements consécutifs préservent les résultats restaurés depuis IndexedDB', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const ref = await zoneGrandCalcul(page).innerText();

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    const pred = zonePredictions(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const apres = await panel.innerText();
    expect(apres).toMatch(/\b50[\s\u00a0\u202f]?000\s+simulations\b/i);
    expect(apres).not.toContain('Aucun calcul enregistré');
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);
    expect(ref.length).toBeGreaterThan(0);
  });

  // =========================================================================
  // F9 — Limites détecteur d'inflexions & explications 2 niveaux
  // =========================================================================
  test('T2-F9-01 : dossier sans projection calculée affiche un état honnête sans récit simulé', async ({ page }) => {
    await ouvrirDossierLocalSansModeTest(page, '#FUTURE');
    await expect(page.getByRole('heading', { name: 'Projection', level: 1 })).toBeVisible({ timeout: 15_000 });
    const texte = await page.locator('main').innerText();
    expect(texte).toMatch(/Renseigne ton profil|Ta projection se recharge|Projection nécessaire|Donnée illisible/i);
    await expect(zoneExplications(page)).toHaveCount(0);
    verifierTexteSansValeursInvalides(texte);

    await page.goto('/?nogate=1#RETIREMENT');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.getByText(/Projection nécessaire|Donnée illisible/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test('T2-F9-02 : horizon court (gilles-actif-decaisse, 71->80) couvre FERR et retraite sans phrase vide', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await modifierParametresRetraiteDansProfil(page, { lifeExpectancy: 80 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    const cardsText = await exp.locator('ol').innerText();
    expect(cardsText.length).toBeGreaterThan(40);
    expect(cardsText).toMatch(/FERR/i);
    expect(cardsText).toMatch(/retraite/i);
    verifierTexteSansValeursInvalides(cardsText);
  });

  test('T2-F9-03 : jeune locataire sans maison ni FERR (lea-fauchee) n\'hallucine pas d\'inflexion FERR/hypothèque', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'lea-fauchee');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    expect(await exp.locator('ol li').count()).toBeGreaterThan(0);
    const texte = await exp.innerText();
    expect(texte).not.toMatch(/hypothèque/i);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T2-F9-04 : dossier insolvable (couple-dettes) explique l\'épuisement sans NaN ni Infinity', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-dettes');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const toggle = exp.locator('button[aria-expanded]').first();
    await expect(toggle).toBeVisible({ timeout: 15_000 });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const regionId = await toggle.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    await expect(page.locator(`#${regionId}`)).toBeVisible();
    const texte = await exp.innerText();
    expect(texte).toMatch(/épuisement|Patrimoine net négatif|Découvert|épuisés/i);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T2-F9-05 : les sous-champs fiscaux non applicables dans niveau 2 affichent — ou 0 $, jamais undefined', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'lea-fauchee');
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
    expect(regionTexte).toMatch(/Fiscalité/i);
    expect(regionTexte).toMatch(/—|\b0\s*\$/);
    verifierTexteSansValeursInvalides(regionTexte);
    verifierTexteSansValeursInvalides(await exp.innerText());
  });

  // =========================================================================
  // F10 — Limites interface Grand Calcul (3 desktop ; 2 mobile dans grandCalculMobile.spec.ts)
  // =========================================================================
  test('T2-F10-03 : zéro animation hover scale/translateY dans le panneau Grand Calcul', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await auditerAbsenceHoverTransform(panel);
  });

  test('T2-F10-04 : pendant l\'exécution, le bouton Lancer est désactivé ou remplacé par Annuler', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });
    const panel = zoneGrandCalcul(page);
    const cancel = boutonAnnulerGrandCalcul(panel);
    await expect(cancel).toBeVisible({ timeout: 10_000 });

    const lancer = boutonLancerGrandCalcul(panel);
    await expect(lancer).toBeVisible();
    await expect(lancer).toBeDisabled();
    await cancel.click().catch(() => {});
    await expect(cancel).toHaveCount(0, { timeout: 10_000 });
  });

  test('T2-F10-05 : le badge Paramètres modifiés persiste après rechargement de la page', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await modifierParametresRetraiteDansProfil(page, { targetAge: 64 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 10_000 });
  });

  // =========================================================================
  // F11 — Limites interface R2 (3 desktop ; 2 mobile dans grandCalculMobile.spec.ts)
  // =========================================================================
  test('T2-F11-03 : avant calcul, aucun 0 $ factice n\'est affiché à la place de — dans R2', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByRole('status')).toContainText('En attente du Grand Calcul');

    const blocPouvoir = cartePredictionR2(page, /Pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible({ timeout: 15_000 });
    const textePouvoir = await blocPouvoir.innerText();
    expect(textePouvoir).toContain('—');
    expect(extraireNombresCAD(textePouvoir)).toEqual([]);
    expect(await blocPouvoir.getByText('Pas de donnée').count()).toBeGreaterThanOrEqual(3);

    const texteGlobal = await pred.innerText();
    expect(extraireNombresCAD(texteGlobal)).toEqual([]);
    expect(extraireAges(texteGlobal)).toEqual([]);
    expect(texteGlobal).not.toMatch(/\b0(?:[,.]0)?\s*%/);
  });

  test('T2-F11-04 : parité bureau 1440×900 -> mobile 390×844 sur la même page sans divergence de calcul', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
    const bureau = extraireNombresCAD(await pred.innerText());
    expect(bureau.length).toBeGreaterThan(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(async () => extraireNombresCAD(await pred.innerText()), { timeout: 10_000 })
      .toEqual(bureau);
  });

  test('T2-F11-05 : audit fuite DOM en mode discret (zéro $ non masqué dans les prédictions R2)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 15_000 });
    await toggleModeDiscret(page, true);
    const texte = await pred.innerText();
    expect(extraireNombresCAD(texte)).toEqual([]);
    expect(texte).toContain('•••');
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();
  });

  // =========================================================================
  // F12 — Limites interface R3 (3 desktop ; 2 mobile dans grandCalculMobile.spec.ts)
  // =========================================================================
  test('T2-F12-03 : déplier plusieurs volets niveau 2 simultanément reste indépendant et stable', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const toggles = exp.locator('button[aria-expanded]');
    await expect(toggles.first()).toBeVisible({ timeout: 15_000 });
    const n = Math.min(3, await toggles.count());
    expect(n).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < n; i++) {
      const toggle = toggles.nth(i);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const regionId = await toggle.getAttribute('aria-controls');
      expect(regionId).toBeTruthy();
      await expect(page.locator(`#${regionId}`)).toBeVisible();
    }
    for (let i = 0; i < n; i++) {
      await expect(toggles.nth(i)).toHaveAttribute('aria-expanded', 'true');
    }
    await expect(exp.locator('button[aria-expanded="true"]')).toHaveCount(n);
  });

  test('T2-F12-04 : activer le mode discret avec un volet niveau 2 ouvert masque aussitôt tous les montants', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
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

    await toggleModeDiscret(page, true);
    const texte = await exp.innerText();
    expect(extraireNombresCAD(texte)).toEqual([]);
    await expect(region.getByText('•••').first()).toBeVisible();
    await expect(region.getByText('Montant masqué').first()).toBeAttached();
  });

  test('T2-F12-05 : zéro hover scale/translateY et zéro NaN dans les explications R3', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
    await auditerAbsenceHoverTransform(exp);
    verifierTexteSansValeursInvalides(await exp.innerText());
  });
});
