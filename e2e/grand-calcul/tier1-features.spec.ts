/**
 * Suite E2E Grand Calcul — Tier 1 : Couverture fonctionnelle F1–F12 (60 tests Desktop Chrome).
 *
 * Approche boîte noire stricte : locators WAI-ARIA, assertions sur invariants métier
 * québécois/canadiens, formatage CAD/%, règle no-fake-data et Mode Discret.
 */
import { test, expect } from '@playwright/test';
import { ecarterLeRail } from '../helpers/setup';
import {
  attacherCollecteursErreurs,
  auditerAbsenceHoverTransform,
  auditerCiblesTactilesConteneur,
  badgeParametresModifies,
  barreProgressionGrandCalcul,
  boutonAnnulerGrandCalcul,
  boutonLancerGrandCalcul,
  cartePredictionR2,
  changerPersona,
  configurerGrandCalcul,
  extraireAges,
  extraireCVaR95,
  extraireNombresCAD,
  extrairePourcentages,
  extraireTauxSurvie,
  inspecterPayloadIndexedDBGrandCalcul,
  lancerGrandCalcul,
  lancerGrandCalculEtAttendre,
  lireLocalStoragePrincipal,
  listerBasesIndexedDB,
  modifierParametresRetraiteDansProfil,
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

test.describe('Grand Calcul — Tier 1 : Couverture F1–F12', () => {
  test.setTimeout(150_000);

  // =========================================================================
  // F1 — Moteur Monte Carlo lourd (50k–100k)
  // =========================================================================
  test('T1-F1-01 : lancer 50 000 trajectoires affiche 50 000 simulations exécutées', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/50[\s\u00a0\u202f]?000\s+simulations/i);
  });

  test('T1-F1-02 : lancer 100 000 trajectoires s\'exécute au complet et affiche 100 000', async ({ page }) => {
    test.setTimeout(180_000);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 100_000, timeoutMs: 160_000 });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText(/Aucun calcul enregistré/i)).toHaveCount(0);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/100[\s\u00a0\u202f]?000\s+simulations/i);
  });

  test('T1-F1-03 : le résultat affiche un taux de survie (%) et une CVaR95 ($) formatés', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const texte = await zoneGrandCalcul(page).innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/survie/i);
    expect(texte).toMatch(/CVaR/i);
    const pcts = extrairePourcentages(texte);
    const cads = extraireNombresCAD(texte);
    expect(pcts.some((p) => p >= 0 && p <= 100)).toBe(true);
    expect(cads.length).toBeGreaterThan(0);
  });

  test('T1-F1-04 : les bandes centiles (P5, P50, P95) sont accessibles après le Grand Calcul', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    const btnBandes = panel.getByRole('button', { name: /Afficher les bandes P5–P95 sur la courbe/i });
    await expect(btnBandes).toBeVisible();
    await expect(btnBandes).toHaveAttribute('aria-pressed', 'true');

    const tableCourbe = page.locator('main table').filter({ hasText: /Projection du patrimoine net/i }).first();
    await expect(tableCourbe).toBeAttached();
    const entetes = await tableCourbe.locator('thead th').allInnerTexts();
    const entetesTexte = entetes.join(' | ');
    expect(entetesTexte).toMatch(/P5\b/i);
    expect(entetesTexte).toMatch(/P50\b/i);
    expect(entetesTexte).toMatch(/P95\b/i);

    const cellules = await tableCourbe.locator('tbody tr').last().innerText();
    expect(cellules).toMatch(/\$|Montant masqué/);
    verifierTexteSansValeursInvalides(cellules);
  });

  test('T1-F1-05 : deux lancements identiques produisent des métriques cohérentes et reproductibles', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000, regimesMacro: true, crisesHistoriques: true });
    const premier = extraireTauxSurvie(await zoneGrandCalcul(page).innerText());

    await lancerGrandCalculEtAttendre(page, { iterations: 50_000, regimesMacro: true, crisesHistoriques: true });
    const second = extraireTauxSurvie(await zoneGrandCalcul(page).innerText());

    expect(premier).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Math.abs((premier ?? 0) - (second ?? 0))).toBeLessThanOrEqual(3);
  });

  // =========================================================================
  // F2 — Régimes macroéconomiques & crises historiques
  // =========================================================================
  test('T1-F2-01 : activer les régimes macroéconomiques est reflété dans le résumé complété', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000, regimesMacro: true });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    const texte = await panel.innerText();
    expect(texte).toMatch(/50[\s\u00a0\u202f]?000\s+simulations/i);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T1-F2-02 : activer les crises historiques avec les régimes s\'exécute jusqu\'au bout', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(2);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(2);
    const texte = await panel.innerText();
    expect(texte).toMatch(/50[\s\u00a0\u202f]?000\s+simulations/i);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T1-F2-03 : les régimes + crises produisent une queue défavorable distincte d\'une base sans régimes', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: false,
      crisesHistoriques: false,
    });
    const baseTexte = await zoneGrandCalcul(page).innerText();
    const baseSurvie = extraireTauxSurvie(baseTexte);
    const baseCvar = extraireCVaR95(baseTexte);

    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: true,
      crisesHistoriques: true,
    });
    const crisesTexte = await zoneGrandCalcul(page).innerText();
    const crisesSurvie = extraireTauxSurvie(crisesTexte);
    const crisesCvar = extraireCVaR95(crisesTexte);

    expect(baseSurvie).not.toBeNull();
    expect(crisesSurvie).not.toBeNull();
    expect(baseCvar).not.toBeNull();
    expect(crisesCvar).not.toBeNull();
    expect(crisesCvar !== baseCvar || crisesSurvie !== baseSurvie).toBe(true);
    verifierTexteSansValeursInvalides(crisesTexte);
  });

  test('T1-F2-04 : désactiver les régimes macroéconomiques fonctionne proprement', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, {
      iterations: 50_000,
      regimesMacro: false,
      crisesHistoriques: false,
    });

    const panel = zoneGrandCalcul(page);
    await expect(panel.getByText('Régimes macroéconomiques', { exact: true })).toHaveCount(1);
    await expect(panel.getByText('Crises historiques', { exact: true })).toHaveCount(1);
    const texte = await panel.innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(texte).toMatch(/50[\s\u00a0\u202f]?000\s+simulations/i);
  });

  test('T1-F2-05 : les libellés des régimes et crises sont rédigés en français clair', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const texte = await panel.innerText();
    expect(texte).toMatch(/régimes/i);
    expect(texte).toMatch(/crises historiques/i);
    verifierTexteSansValeursInvalides(texte);
  });

  // =========================================================================
  // F3 — Âge d'indépendance financière (P5, P50, P95)
  // =========================================================================
  test('T1-F3-01 : sur couple-confort, la carte FI affiche le taux d\'atteinte, P5, Médiane et P95', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible();
    const blocFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(blocFi).toBeVisible();
    const texte = await blocFi.innerText();
    expect(texte).toMatch(/indépendance financière/i);
    expect(texte).toMatch(/P5\b/i);
    expect(texte).toMatch(/P50\b|médian/i);
    expect(texte).toMatch(/P95\b/i);
    expect(texte).not.toMatch(/—|Pas de donnée/i);
    expect(extrairePourcentages(texte).length).toBeGreaterThan(0);
    const corpsQuantiles = texte.replace(/Horizon simulé[\s\S]*$/i, '');
    expect(extraireAges(corpsQuantiles).length).toBe(3);
  });

  test('T1-F3-02 : les centiles d\'âge FI respectent l\'ordre monotone P5 <= P50 <= P95', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const sectionFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(sectionFi).toBeVisible();
    const texte = await sectionFi.innerText();
    const corpsQuantiles = texte.replace(/Horizon simulé[\s\S]*$/i, '');
    const ages = extraireAges(corpsQuantiles).filter((a) => a >= 18 && a <= 92);
    expect(ages.length).toBe(3);
    expect(ages[0]).toBeGreaterThanOrEqual(18);
    expect(ages[0]).toBeLessThanOrEqual(ages[1]);
    expect(ages[1]).toBeLessThanOrEqual(ages[2]);
    expect(ages[2]).toBeLessThanOrEqual(92);
  });

  test('T1-F3-03 : les âges FI affichés restent bornés dans [âge actuel, horizon]', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'karim-immigre');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const sectionFi = cartePredictionR2(page, /indépendance financière/i);
    await expect(sectionFi).toBeVisible();
    const ages = extraireAges(await sectionFi.innerText());
    expect(ages.length).toBeGreaterThan(0);
    for (const age of ages) {
      expect(age).toBeGreaterThanOrEqual(34);
      expect(age).toBeLessThanOrEqual(92);
    }
  });

  test('T1-F3-04 : sur couple-confort, le bloc FI précise le contexte d\'horizon', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const texte = await zonePredictions(page).innerText();
    expect(texte).toMatch(/indépendance financière/i);
    expect(texte).toMatch(/horizon|92\s*ans|atteinte/i);
  });

  test('T1-F3-05 : le mode discret masque les âges et pourcentages FI dans le DOM', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'karim-immigre');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await toggleModeDiscret(page, true);
    const pred = zonePredictions(page);
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();
    await expect(pred.getByText('•••').first()).toBeVisible();
  });

  // =========================================================================
  // F4 — Probabilités datées par objectif financier
  // =========================================================================
  test('T1-F4-01 : sur couple-confort, l\'objectif Fond urgence 6 mois affiche échéance 2027 et %', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    expect(texte).toMatch(/Fond urgence 6 mois/i);
    expect(texte).toMatch(/2027/);
    expect(texte).not.toMatch(/Échéance invalide/i);
    expect(texte).toMatch(/Probabilité\s*:\s*\d+(?:[,.]\d+)?\s*%/i);
    expect(extrairePourcentages(texte).length).toBeGreaterThan(0);
  });

  test('T1-F4-02 : sur pre-retraite-riche, Léguer 500 k$ affiche son montant cible CAD et sa probabilité', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    expect(texte).toMatch(/Léguer 500/i);
    expect(texte).toMatch(/2055/);
    expect(texte).toMatch(/Cible\s*:\s*500[\s\u00a0\u202f]?000\s*\$/i);
    expect(texte).not.toMatch(/Échéance invalide/i);
    expect(texte).toMatch(/Probabilité\s*:\s*\d+(?:[,.]\d+)?\s*%/i);
  });

  test('T1-F4-03 : sur gilles-actif-decaisse, Coussin santé (2030, 40 000 $) est évalué', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'gilles-actif-decaisse');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    expect(texte).toMatch(/Coussin santé/i);
    expect(texte).toMatch(/2030/);
    expect(texte).toMatch(/Cible\s*:\s*40[\s\u00a0\u202f]?000\s*\$/i);
    expect(texte).not.toMatch(/Échéance invalide/i);
    expect(texte).toMatch(/Probabilité\s*:\s*\d+(?:[,.]\d+)?\s*%/i);
  });

  test('T1-F4-04 : sur autonome-monoparentale, REER autonome 100 k$ (2040) est affiché avec probabilité', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'autonome-monoparentale');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    expect(texte).toMatch(/REER autonome 100/i);
    expect(texte).toMatch(/2040/);
    expect(texte).toMatch(/Cible\s*:\s*100[\s\u00a0\u202f]?000\s*\$/i);
    expect(texte).not.toMatch(/Échéance invalide/i);
    expect(texte).toMatch(/Probabilité\s*:\s*\d+(?:[,.]\d+)?\s*%/i);
  });

  test('T1-F4-05 : un objectif partiellement atteint affiche un écart/déficit formaté sans valeur brute invalide', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'karim-immigre');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocObj = cartePredictionR2(page, /probabilités par objectif/i);
    await expect(blocObj).toBeVisible();
    const texte = await blocObj.innerText();
    expect(texte).toMatch(/Indépendance financière \(1 M\$\)/i);
    expect(texte).not.toMatch(/Échéance invalide/i);
    verifierTexteSansValeursInvalides(texte);
    const mProb = texte.match(/Probabilité\s*:\s*(\d+(?:[,.]\d+)?)\s*%/i);
    expect(mProb).not.toBeNull();
    const prob = Number((mProb?.[1] ?? '0').replace(',', '.'));
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(100);
    const mDeficit = texte.match(/Déficit médian\s*:\s*(\d[\d\s\u00a0\u202f]*)\s*\$/i);
    expect(mDeficit).not.toBeNull();
    const deficit = Number((mDeficit?.[1] ?? '0').replace(/[\s\u00a0\u202f]/g, ''));
    expect(deficit).toBeGreaterThan(0);
  });

  // =========================================================================
  // F5 — Pouvoir d'achat réel mensuel net garanti (P95/P90/P50)
  // =========================================================================
  test('T1-F5-01 : les trois paliers P95, P90 et P50 en dollars constants mensuels sont affichés', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    expect(texte).toMatch(/pouvoir d'achat/i);
    expect(texte).toMatch(/P95\b/i);
    expect(texte).toMatch(/P90\b/i);
    expect(texte).toMatch(/P50\b/i);
    expect(texte).toMatch(/mois|mensuel/i);
    expect(extraireNombresCAD(texte).length).toBeGreaterThanOrEqual(3);
  });

  test('T1-F5-02 : la polarité de sécurité est respectée : P95 <= P90 <= P50', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const cads = extraireNombresCAD(await blocPouvoir.innerText()).filter((n) => n >= 0);
    expect(cads.length).toBeGreaterThanOrEqual(3);
    expect(cads[0]).toBeLessThanOrEqual(cads[1]);
    expect(cads[1]).toBeLessThanOrEqual(cads[2]);
  });

  test('T1-F5-03 : sur pre-retraite-riche, les trois montants mensuels garantis sont strictement positifs', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const cads = extraireNombresCAD(await blocPouvoir.innerText());
    expect(cads.length).toBeGreaterThanOrEqual(3);
    expect(cads[0]).toBeGreaterThan(0);
    expect(cads[1]).toBeGreaterThan(0);
    expect(cads[2]).toBeGreaterThan(0);
  });

  test('T1-F5-04 : la carte précise la portée de retraite évaluée (mois ou phase de retraite)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    expect(texte).toMatch(/Mois de retraite évalués\s*:\s*[1-9]\d*\s*mois/i);
  });

  test('T1-F5-05 : le mode discret masque les trois montants mensuels sans laisser de $ en clair', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await toggleModeDiscret(page, true);
    const blocPouvoir = cartePredictionR2(page, /pouvoir d'achat/i);
    await expect(blocPouvoir).toBeVisible();
    const texte = await blocPouvoir.innerText();
    expect(extraireNombresCAD(texte)).toEqual([]);
    await expect(blocPouvoir.getByText('•••').first()).toBeVisible();
  });

  // =========================================================================
  // F6 — Impôt successoral latent au décès (ARC & Revenu Québec)
  // =========================================================================
  test('T1-F6-01 : sur pre-retraite-riche, la succession affiche total, ARC et Revenu Québec', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    expect(texte).toMatch(/impôt successoral|succession/i);
    expect(texte).toMatch(/ARC|Fédéral/i);
    expect(texte).toMatch(/Revenu Québec|Québec/i);
    expect(extraireNombresCAD(texte).length).toBeGreaterThanOrEqual(3);
  });

  test('T1-F6-02 : la somme ARC + Revenu Québec est cohérente avec le total affiché', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    const matchArc = texte.match(/ARC[^$\n]*?(\d[\d\s\u00a0\u202f]*)\s*\$/i);
    const matchRq = texte.match(/Revenu Québec[^$\n]*?(\d[\d\s\u00a0\u202f]*)\s*\$/i);
    const matchTotal = texte.match(/Total[^$\n]*?(\d[\d\s\u00a0\u202f]*)\s*\$/i);

    expect(matchArc).not.toBeNull();
    expect(matchRq).not.toBeNull();
    expect(matchTotal).not.toBeNull();
    if (matchArc && matchRq && matchTotal) {
      const arc = Number(matchArc[1].replace(/[\s\u00a0\u202f]/g, ''));
      const rq = Number(matchRq[1].replace(/[\s\u00a0\u202f]/g, ''));
      const total = Number(matchTotal[1].replace(/[\s\u00a0\u202f]/g, ''));
      expect(Math.abs(arc + rq - total)).toBeLessThanOrEqual(5);
    }
  });

  test('T1-F6-03 : la ventilation par type d\'actif (REER/FERR, gain en capital, locatif/DPA) est affichée', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    expect(texte).toMatch(/REER\s*\/\s*FERR[^\n]*\d[\d\s\u00a0\u202f]*\$/i);
    expect(texte).toMatch(/Gain en capital imposable[^\n]*\d[\d\s\u00a0\u202f]*\$/i);
    expect(texte).toMatch(/Récupération DPA\s*\(locatif\)[^\n]*\d[\d\s\u00a0\u202f]*\$/i);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T1-F6-04 : les quantiles MC de l\'impôt successoral suivent P5 <= P50 <= P95', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    const mP5 = texte.match(/P5\b[^$\n]*?(\d[\d\s\u00a0\u202f]*)\s*\$/i);
    const mP50 = texte.match(/P50\b[^$\n]*?(\d[\d\s\u00a0\u202f]*)\s*\$/i);
    const mP95 = texte.match(/P95\b[^$\n]*?(\d[\d\s\u00a0\u202f]*)\s*\$/i);
    expect(mP5 && mP50 && mP95).toBeTruthy();
    if (mP5 && mP50 && mP95) {
      const p5 = Number(mP5[1].replace(/[\s\u00a0\u202f]/g, ''));
      const p50 = Number(mP50[1].replace(/[\s\u00a0\u202f]/g, ''));
      const p95 = Number(mP95[1].replace(/[\s\u00a0\u202f]/g, ''));
      expect(p5).toBeLessThanOrEqual(p50);
      expect(p50).toBeLessThanOrEqual(p95);
    }
  });

  test('T1-F6-05 : l\'âge projeté au décès correspond à l\'espérance de vie du persona (94 ans)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const blocSuccession = cartePredictionR2(page, /impôt successoral|succession/i);
    await expect(blocSuccession).toBeVisible();
    const texte = await blocSuccession.innerText();
    expect(texte).toMatch(/94\s*ans/i);
  });

  // =========================================================================
  // F7 — Exécution Web Worker en arrière-plan + progression + annulation
  // =========================================================================
  test('T1-F7-01 : le lancement affiche une barre de progression WAI-ARIA avec aria-valuenow', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    const panel = zoneGrandCalcul(page);
    const progress = barreProgressionGrandCalcul(panel);
    await expect(progress).toBeVisible({ timeout: 10_000 });
    const val = Number(await progress.getAttribute('aria-valuenow'));
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(100);
    await boutonAnnulerGrandCalcul(panel).click().catch(() => {});
  });

  test('T1-F7-02 : la télémétrie en direct affiche avancement, cadence ou temps restant', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    const panel = zoneGrandCalcul(page);
    const statut = panel.getByRole('status').first();
    await expect(statut).toBeVisible({ timeout: 10_000 });
    const texte = await statut.innerText();
    expect(texte).toMatch(/%|sim\/s|\/s|ETA|restant/i);
    await boutonAnnulerGrandCalcul(panel).click().catch(() => {});
  });

  test('T1-F7-03 : l\'interface reste fluide pendant l\'exécution du Web Worker (ouverture de tiroir réactive)', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    const t0 = Date.now();
    await page.getByRole('button', { name: 'Historique', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Historique' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    expect(Date.now() - t0).toBeLessThan(4_000);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await boutonAnnulerGrandCalcul(zoneGrandCalcul(page)).click().catch(() => {});
  });

  test('T1-F7-04 : cliquer Annuler interrompt proprement le calcul en arrière-plan', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalcul(page, { iterations: 100_000 });

    const panel = zoneGrandCalcul(page);
    const cancelBtn = boutonAnnulerGrandCalcul(panel);
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();

    await expect(cancelBtn).toHaveCount(0, { timeout: 10_000 });
    await expect(boutonLancerGrandCalcul(panel)).toBeEnabled({ timeout: 10_000 });
    await expect(panel).toContainText(/Calcul annulé/i);
  });

  test('T1-F7-05 : une fois terminé, aucun indicateur actif résiduel ne persiste', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const panel = zoneGrandCalcul(page);
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonLancerGrandCalcul(panel)).toBeEnabled();
  });

  // =========================================================================
  // F8 — Persistance durable IndexedDB & état Store
  // =========================================================================
  test('T1-F8-01 : recharger la page restaure instantanément le Grand Calcul depuis IndexedDB sans relancer', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const avant = await zonePredictions(page).innerText();
    const cadsAvant = extraireNombresCAD(avant);
    expect(cadsAvant.length).toBeGreaterThan(0);

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await revelerCourbeProjection(page);

    const panel = zoneGrandCalcul(page);
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel).toContainText(/50[\s\u00a0\u202f]?000\s+simulations/i, { timeout: 10_000 });
    await expect(boutonLancerGrandCalcul(panel)).toContainText(/Relancer/i);
    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0);
    const apres = await pred.innerText();
    expect(apres).toMatch(/indépendance financière/i);
    expect(extraireNombresCAD(apres)).toEqual(cadsAvant);
  });

  test('T1-F8-02 : naviguer vers Profil puis revenir à Futur conserve le résultat sans recalculer', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    const avant = await zonePredictions(page).innerText();
    const cadsAvant = extraireNombresCAD(avant);
    expect(cadsAvant.length).toBeGreaterThan(0);

    await page.goto('/?nogate=1#PROFILE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);

    const panel = zoneGrandCalcul(page);
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(panel).toContainText(/50[\s\u00a0\u202f]?000\s+simulations/i, { timeout: 10_000 });
    await expect(boutonLancerGrandCalcul(panel)).toContainText(/Relancer/i);
    const pred = zonePredictions(page);
    await expect(pred).toBeVisible({ timeout: 10_000 });
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0);
    expect(extraireNombresCAD(await pred.innerText())).toEqual(cadsAvant);
  });

  test('T1-F8-03 : localStorage principal ne stocke pas la charge lourde des bandes mensuelles', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const brut = await lireLocalStoragePrincipal(page);
    expect(brut).not.toBeNull();
    expect(brut ?? '').not.toContain('"monthlyBands"');
    expect((brut ?? '').length).toBeLessThan(200_000);
  });

  test('T1-F8-04 : IndexedDB contient une base dédiée chiffrée sans séries mensuelles en clair', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const bases = await listerBasesIndexedDB(page);
    expect(bases.some((b) => /grand.?calcul/i.test(b))).toBe(true);

    const inspection = await inspecterPayloadIndexedDBGrandCalcul(page);
    expect(inspection.dbFound).not.toBeNull();
    expect(inspection.recordCount).toBeGreaterThanOrEqual(1);
    expect(inspection.hasPlaintextMonthlySeries).toBe(false);
  });

  test('T1-F8-05 : effacer/réinitialiser le Grand Calcul restaure l\'état initial proprement', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(zonePredictions(page)).toContainText(/Léguer 500/i);

    const panel = zoneGrandCalcul(page);
    const btnEffacer = panel.getByRole('button', { name: /effacer|réinitialiser|vider/i }).first();
    if (await btnEffacer.isVisible().catch(() => false)) {
      await btnEffacer.click();
      await expect(panel).toBeVisible();
      await expect(boutonLancerGrandCalcul(panel)).toBeEnabled();
      const textePanelReset = await panel.innerText();
      expect(textePanelReset).toMatch(/Lancer|Calculer|—/i);
      expect(textePanelReset).not.toMatch(/survie/i);
    } else {
      await changerPersona(page, 'lea-fauchee');
      await page.goto('/?nogate=1#FUTURE');
      await page.waitForLoadState('domcontentloaded');
      await ecarterLeRail(page);
      await revelerCourbeProjection(page);
      await expect(zonePredictions(page)).not.toContainText(/Léguer 500/i, { timeout: 10_000 });
      expect(await zoneGrandCalcul(page).innerText()).toMatch(/paramètres modifiés|pas à jour|lancer|calculer/i);
    }

    const predZone = zonePredictions(page);
    await expect(predZone.getByText('En attente du Grand Calcul')).toBeVisible();
    const predApres = await predZone.innerText();
    const panelApres = await zoneGrandCalcul(page).innerText();
    verifierTexteSansValeursInvalides(predApres);
    verifierTexteSansValeursInvalides(panelApres);
    expect(predApres).toContain('—');
    expect(extraireNombresCAD(predApres)).toEqual([]);
  });

  // =========================================================================
  // F9 — Détecteur d'inflexions & générateur d'explications 2 niveaux
  // =========================================================================
  test('T1-F9-01 : les explications listent chronologiquement les inflexions clés de la vie financière', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });

    const texte = await exp.innerText();
    expect(texte).toMatch(/20\d{2}/);
    expect(texte).toMatch(/retraite|accumulation|maison|pension|RRQ|PSV/i);
  });

  test('T1-F9-02 : chaque inflexion affiche une synthèse causale niveau 1 claire en français', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });

    const firstSummary = exp.locator('ol li article p').first();
    await expect(firstSummary).toBeVisible({ timeout: 15_000 });
    expect((await firstSummary.innerText()).trim().length).toBeGreaterThan(20);
    const texte = await exp.innerText();
    expect(texte).toMatch(/Pourquoi la courbe|inflexion|étape/i);
    expect(texte.length).toBeGreaterThan(60);
    verifierTexteSansValeursInvalides(texte);
  });

  test('T1-F9-03 : déplier le niveau 2 révèle Accumulation, Décaissement et Fiscalité chiffrés', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    const declencheur = exp.locator('button[aria-expanded]').first();
    await expect(declencheur).toBeVisible({ timeout: 15_000 });
    await expect(declencheur).toHaveAttribute('aria-expanded', 'false');
    await declencheur.click();

    await expect(declencheur).toHaveAttribute('aria-expanded', 'true');
    const idPanneau = await declencheur.getAttribute('aria-controls');
    expect(idPanneau).toBeTruthy();
    const panneau = page.locator(`#${idPanneau}`);
    await expect(panneau).toBeVisible();

    const detail = await panneau.innerText();
    expect(detail).toMatch(/accumulation/i);
    expect(detail).toMatch(/décaissement/i);
    expect(detail).toMatch(/fiscal/i);
    verifierTexteSansValeursInvalides(detail);
  });

  test('T1-F9-04 : sur pre-retraite-riche, le niveau 2 mentionne la logique FERR/PSV et les justifications fiscales', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const boutons = exp.locator('button[aria-expanded]');
    await expect(boutons.first()).toBeVisible({ timeout: 15_000 });
    expect(await boutons.count()).toBeGreaterThan(0);

    const carteFerr = exp.locator('article').filter({ hasText: /FERR/i }).first();
    await expect(carteFerr).toBeVisible();
    const btnFerr = carteFerr.locator('button[aria-expanded]').first();
    if ((await btnFerr.getAttribute('aria-expanded')) === 'false') {
      await btnFerr.click();
    }
    await expect(btnFerr).toHaveAttribute('aria-expanded', 'true');
    const regionId = await btnFerr.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const panneau = page.locator(`#${regionId}`);
    await expect(panneau).toBeVisible();
    await expect(panneau).toContainText(/Justifications fiscales/i);
    const justifications = await panneau.locator('ul li').allInnerTexts();
    const texteJustif = justifications.join(' ');
    expect(texteJustif).toMatch(/FERR/i);
    expect(texteJustif).toMatch(/ARC|PSV/i);
  });

  test('T1-F9-05 : sélectionner une étape sur la courbe met à jour le panneau du jour sans résidu', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const demain = page.getByRole('button', { name: /Lendemain/i }).first();
    await expect(demain).toBeVisible({ timeout: 10_000 });
    await demain.click();

    const panneauJour = page.locator('[data-panneau-jour][data-jour-epingle]');
    await expect(panneauJour).toBeVisible({ timeout: 10_000 });
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    await expect(exp).toContainText(/Point inspecté sur la courbe/i);
    await expect(exp).toContainText(/Épinglé/);
    verifierTexteSansValeursInvalides(await exp.innerText());
  });

  // =========================================================================
  // F10 — Interface Grand Calcul à la demande
  // =========================================================================
  test('T1-F10-01 : ouvrir /#FUTURE ne déclenche jamais le Grand Calcul automatiquement', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(0);
  });

  test('T1-F10-02 : modifier un contrôle rapide (Budget cible / Normes IQPF) ne lance pas le Grand Calcul', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const iqpf = page.getByRole('button', { name: /Normes IQPF 2026/i }).first();
    await expect(iqpf).toBeVisible({ timeout: 10_000 });
    await iqpf.click();

    const panel = zoneGrandCalcul(page);
    await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
    await expect(boutonAnnulerGrandCalcul(panel)).toHaveCount(0);
  });

  test('T1-F10-03 : le sélecteur de trajectoires propose l\'intervalle 50 000–100 000', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await configurerGrandCalcul(page, { iterations: 75_000 });
    const panel = zoneGrandCalcul(page);
    await expect(panel).toBeVisible();
    const spin = panel.getByRole('spinbutton').first();
    await expect(spin).toHaveAttribute('min', '50000');
    await expect(spin).toHaveAttribute('max', '100000');
    await expect(spin).toHaveValue('75000');
    await expect(boutonLancerGrandCalcul(panel)).toBeEnabled();
  });

  test('T1-F10-04 : modifier un paramètre après le calcul affiche un badge Paramètres modifiés sans effacer les résultats', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await modifierParametresRetraiteDansProfil(page, { targetAge: 64 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);

    const panel = zoneGrandCalcul(page);
    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 15_000 });
    const pred = zonePredictions(page);
    await expect(pred).toBeVisible();
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0);
    expect(extraireNombresCAD(await pred.innerText()).length).toBeGreaterThan(0);
  });

  test('T1-F10-05 : relancer après modification des paramètres efface le badge obsolète', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await modifierParametresRetraiteDansProfil(page, { targetAge: 65 });
    await page.goto('/?nogate=1#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);

    const panel = zoneGrandCalcul(page);
    await expect(badgeParametresModifies(panel)).toBeVisible({ timeout: 10_000 });
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });
    await expect(badgeParametresModifies(panel)).toHaveCount(0);
  });

  // =========================================================================
  // F11 — Interface Nouvelles Prédictions R2
  // =========================================================================
  test('T1-F11-01 : le panneau R2 réunit les quatre blocs de prédictions attendus', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0);
    const texte = await pred.innerText();
    expect(texte).toMatch(/indépendance financière/i);
    expect(texte).toMatch(/objectif/i);
    expect(texte).toMatch(/pouvoir d'achat/i);
    expect(texte).toMatch(/impôt successoral|succession/i);
  });

  test('T1-F11-02 : les montants et pourcentages R2 respectent formatCAD/formatPercent sans NaN ni undefined', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const texte = await zonePredictions(page).innerText();
    verifierTexteSansValeursInvalides(texte);
    expect(extraireNombresCAD(texte).length).toBeGreaterThan(0);
    expect(extrairePourcentages(texte).length).toBeGreaterThan(0);
  });

  test('T1-F11-03 : activer le mode discret masque toutes les valeurs financières R2', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'pre-retraite-riche');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await toggleModeDiscret(page, true);
    const pred = zonePredictions(page);
    const texte = await pred.innerText();
    expect(extraireNombresCAD(texte)).toEqual([]);
    await expect(pred.getByText('Montant masqué').first()).toBeAttached();
  });

  test('T1-F11-04 : conformité visuelle R2 sans bandeau KPI dupliqué ni scale/translateY au survol', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    await expect(page.locator('[data-testid="kpi-banner-duplicate"]')).toHaveCount(0);
    await auditerAbsenceHoverTransform(zonePredictions(page));
  });

  test('T1-F11-05 : les contrôles interactifs du panneau R2 respectent la cible >= 44 px', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    await lancerGrandCalculEtAttendre(page, { iterations: 50_000 });

    const pred = zonePredictions(page);
    await expect(pred).toBeVisible();
    const boutons = pred.locator('button:visible');
    const nb = await boutons.count();
    for (let i = 0; i < nb; i++) {
      const box = await boutons.nth(i).boundingBox();
      if (box && box.height > 0) {
        expect(box.height).toBeGreaterThanOrEqual(43.5);
      }
    }
    expect(await auditerCiblesTactilesConteneur(zoneGrandCalcul(page))).toEqual([]);
  });

  // =========================================================================
  // F12 — Interface Explications à Double Niveau R3
  // =========================================================================
  test('T1-F12-01 : les synthèses niveau 1 sont lisibles d\'emblée et les volets niveau 2 fermés par défaut', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });

    const boutons = exp.locator('button[aria-expanded]');
    const count = await boutons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(boutons.nth(i)).toHaveAttribute('aria-expanded', 'false');
    }
  });

  test('T1-F12-02 : cliquer un volet niveau 2 l\'ouvre puis le referme proprement', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    const btn = exp.locator('button[aria-expanded]').first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const regionId = await btn.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    await expect(page.locator(`#${regionId}`)).toBeVisible();

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(`#${regionId}`)).toHaveCount(0);
  });

  test('T1-F12-03 : accessibilité clavier (Enter / Space) sur les volets niveau 2', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    const btn = exp.locator('button[aria-expanded]').first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    await btn.focus();
    await expect(btn).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Space');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('T1-F12-04 : le mode discret masque les montants dans les niveaux 1 et 2 des explications', async ({ page }) => {
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });
    const btn = exp.locator('button[aria-expanded]').first();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    expect(extraireNombresCAD(await exp.innerText()).length).toBeGreaterThan(0);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    const regionId = await btn.getAttribute('aria-controls');
    expect(regionId).toBeTruthy();
    const region = page.locator(`#${regionId}`);
    await expect(region).toBeVisible();

    await toggleModeDiscret(page, true);
    const texte = await exp.innerText();
    expect(extraireNombresCAD(texte)).toEqual([]);
    await expect(exp.getByText('•••').first()).toBeVisible();
    await expect(region.getByText('•••').first()).toBeVisible();
  });

  test('T1-F12-05 : zéro hover scale/translateY et cibles >= 44 px dans la section Explications', async ({ page }) => {
    const { pageErrors } = attacherCollecteursErreurs(page);
    await ouvrirFuturAvecPersona(page, 'couple-confort');
    const exp = zoneExplications(page);
    await expect(exp).toBeVisible({ timeout: 15_000 });

    await auditerAbsenceHoverTransform(exp);
    const tropPetites = await auditerCiblesTactilesConteneur(exp);
    expect(tropPetites).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
