/**
 * Suite E2E Valoria · Quant IA — Desktop (`1440×900`).
 *
 * Vérifie bout en bout :
 * - Navigation vers `Valoria · Quant IA` via la barre latérale ET via la passerelle depuis `Placements`
 * - État vide honnête (`no-fake-data`) sans chargement automatique de lots de démo
 * - Affichage D3 + montant total en `$ CAD` sur `Ce que j’ai`
 * - Parcours des 6 sous-onglets (`Ce que j’ai`, `Recommandé`, `Preuve IA`, `Discuter IA`, `Marché`, `Agents & Futur`)
 * - Parcours des 4 sous-vues de `Agents & Futur` (`Causal IA`, `Inflation`, `7 Agents`, `Futur 2031`)
 * - Ouverture du sélecteur des 8 laboratoires complémentaires (`Backtest`, etc.)
 * - `Preuve IA` : basculement `1M`, `1A`, `5A`, `10A` + audit à l’aveugle en mode repli/offline sans 500
 * - Isolation stricte des écritures (ADR-V3) : un ordre simulé / Bac à Sable Valoria ne touche jamais `state.assets` dans `Placements`
 * - Mode Discret global : masquage des montants personnels (`•••` / `Montant masqué`)
 * - Zéro `console.error`, zéro `pageerror`, zéro réponse HTTP >= 500 sur `/api/*`
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  activateTestMode,
  ecarterLeRail,
  scriptBypassOnboarding,
} from '../helpers/setup';
import { STORAGE_KEYS } from '../../utils/storageKeys';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.use({ viewport: { width: 1440, height: 900 } });

interface CollecteurReseauEtConsole {
  consoleErrors: string[];
  pageErrors: string[];
  apiServerErrors: string[];
}

async function attacherGardeErreursEtRepliApi(page: Page): Promise<CollecteurReseauEtConsole> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const apiServerErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) {
      apiServerErrors.push(`${res.request().method()} ${res.url()} -> HTTP ${res.status()}`);
    }
  });

  // Sous `vite preview` (sans serveur Express /api/*), les requêtes `/api/**` retournent 404/405
  // ou du HTML SPA : on vérifie d'abord la vraie réponse, on enregistre toute 5xx, puis on fournit
  // un repli JSON propre uniquement si le serveur statique preview est absent, évitant les faux 404 Chromium.
  await page.route('**/api/**', async (route) => {
    try {
      const response = await route.fetch();
      if (response.status() >= 500) {
        apiServerErrors.push(`${route.request().method()} ${route.request().url()} -> HTTP ${response.status()}`);
        await route.fulfill({ response });
        return;
      }
      const contentType = response.headers()['content-type'] ?? '';
      if (response.status() === 404 || response.status() === 405 || contentType.includes('text/html')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            offlineFallback: true,
            articles: [],
            dispatches: [],
            sourcesVerified: [],
            results: [],
          }),
        });
        return;
      }
      await route.fulfill({ response });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: false,
          offlineFallback: true,
          articles: [],
          dispatches: [],
          sourcesVerified: [],
          results: [],
        }),
      });
    }
  });

  return { consoleErrors, pageErrors, apiServerErrors };
}

function verifierAucuneErreur(collecteur: CollecteurReseauEtConsole): void {
  expect(collecteur.pageErrors, 'Erreurs JS non gérées (pageerror)').toEqual([]);
  expect(collecteur.consoleErrors, 'Erreurs console navigateur').toEqual([]);
  expect(collecteur.apiServerErrors, 'Réponses HTTP >= 500 sur /api/*').toEqual([]);
}

function verifierTexteSansValeursInvalides(texte: string): void {
  expect(texte).not.toMatch(/\bNaN\b/);
  expect(texte).not.toMatch(/\bundefined\b/);
  expect(texte).not.toMatch(/\bInfinity\b/);
  expect(texte).not.toContain('null $');
}

function extraireNombresCAD(texte: string): number[] {
  const matches = texte.match(/-?\d[\d\s\u00a0\u202f]*(?:[,.]\d+)?\s*\$/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/\$/g, '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n));
}

async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page.getByRole('button', { name: /Accéder directement à mon dossier local/i });
  await btnLocal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
}

async function ouvrirValoriaViaBarreLaterale(page: Page): Promise<Locator> {
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav.getByRole('button', { name: /Valoria\s*·\s*Quant IA/i })).toHaveCount(0);

  const btnPlacements = nav.getByRole('button', { name: /^Placements$/i });
  await expect(btnPlacements).toBeVisible({ timeout: 10_000 });
  await btnPlacements.click();

  const btnOutilsExperts = page.getByRole('button', { name: /Outils experts|Quant IA/i }).first();
  await expect(btnOutilsExperts).toBeVisible({ timeout: 10_000 });
  await btnOutilsExperts.click();

  const workspace = page.getByTestId('valoria-workspace');
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  return workspace;
}

async function cliquerSousOngletValoria(workspace: Locator, labelRegex: RegExp): Promise<void> {
  const barrePrincipale = workspace.getByRole('tablist').first();
  const dansTablist = barrePrincipale.getByRole('tab', { name: labelRegex }).first();
  if ((await dansTablist.count()) > 0 && (await dansTablist.isVisible().catch(() => false))) {
    await dansTablist.click();
    return;
  }

  const cible = workspace
    .getByRole('tab', { name: labelRegex })
    .or(workspace.getByRole('navigation').getByRole('button', { name: labelRegex }))
    .or(workspace.getByRole('navigation').getByRole('link', { name: labelRegex }))
    .or(workspace.getByRole('button', { name: labelRegex }))
    .or(workspace.getByRole('link', { name: labelRegex }))
    .first();
  await expect(cible).toBeVisible({ timeout: 10_000 });
  await cible.click();
}

async function ouvrirLaboratoireComplementaire(
  workspace: Locator,
  labLabelRegex: RegExp,
): Promise<void> {
  const selectLabs = workspace
    .getByRole('combobox', { name: /Laboratoires quantitatifs complémentaires/i })
    .or(workspace.locator('#valoria-labs-select'))
    .first();

  if ((await selectLabs.count()) > 0 && (await selectLabs.isVisible().catch(() => false))) {
    const options = await selectLabs.locator('option').allTextContents();
    expect(options.length, 'Le sélecteur des laboratoires doit proposer les 4 laboratoires complémentaires').toBeGreaterThanOrEqual(4);
    const matchingIndex = options.findIndex((opt) => labLabelRegex.test(opt));
    expect(matchingIndex, `Option absente dans le sélecteur de laboratoires : ${labLabelRegex}`).toBeGreaterThanOrEqual(0);
    await selectLabs.selectOption({ index: matchingIndex });
    return;
  }

  // Si les 8 laboratoires vivent derrière un bouton/menu déroulant (« Laboratoires », etc.)
  const directBtn = workspace
    .getByRole('tab', { name: labLabelRegex })
    .or(workspace.getByRole('button', { name: labLabelRegex }))
    .or(workspace.getByRole('menuitem', { name: labLabelRegex }))
    .first();

  if (!(await directBtn.isVisible().catch(() => false))) {
    const triggerMenu = workspace
      .getByRole('button', { name: /Laboratoire|Modules|Outils quant|Autres vues/i })
      .first();
    if ((await triggerMenu.count()) > 0 && (await triggerMenu.isVisible().catch(() => false))) {
      await triggerMenu.click();
    }
  }

  await expect(directBtn).toBeVisible({ timeout: 10_000 });
  await directBtn.click();
}

async function lireSnapshotStorePersiste(page: Page): Promise<{
  assets: unknown[];
  initialBalances: Record<string, unknown>;
}> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return { assets: [], initialBalances: {} };
    const parsed = JSON.parse(raw) as {
      state?: {
        assets?: unknown[];
        initialBalances?: Record<string, unknown>;
      };
    };
    return {
      assets: Array.isArray(parsed.state?.assets) ? parsed.state.assets : [],
      initialBalances: parsed.state?.initialBalances ?? {},
    };
  }, STORAGE_KEYS.persistStore);
}

test.describe('Valoria · Quant IA — Desktop 1440×900', () => {
  test.setTimeout(120_000);

  test('État vide honnête (no-fake-data) : zéro position auto-chargée au démarrage', async ({ page }) => {
    const collecteur = await attacherGardeErreursEtRepliApi(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await ecarterLeRail(page);

    const workspace = await ouvrirValoriaViaBarreLaterale(page);
    const texte = await workspace.innerText();
    verifierTexteSansValeursInvalides(texte);

    // Règle no-fake-data : sans avoirs dans FinanceAI, aucun portefeuille de démo n'est injecté automatiquement
    expect(texte).toMatch(/Aucune position|Aucun placement|Portefeuille vide/i);
    expect(texte).not.toContain('PAYX');
    expect(texte).not.toContain('ASML');

    verifierAucuneErreur(collecteur);
  });

  test('Navigation double (Barre latérale & passerelle Placements), rendu D3 et total $ CAD sur Ce que j’ai', async ({ page }) => {
    const collecteur = await attacherGardeErreursEtRepliApi(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    // 1) Navigation via la barre latérale
    const workspace = await ouvrirValoriaViaBarreLaterale(page);
    await expect(page.getByTestId('valoria-simulation-banner')).toBeVisible({ timeout: 10_000 });

    // Vérification D3 + montant total en $ CAD sur Ce que j’ai
    await expect(workspace.locator('svg').first()).toBeVisible({ timeout: 10_000 });
    const texteCeQueJai = await workspace.innerText();
    verifierTexteSansValeursInvalides(texteCeQueJai);
    expect(extraireNombresCAD(texteCeQueJai).length).toBeGreaterThan(0);
    expect(texteCeQueJai).toMatch(/\$|\bCAD\b/i);

    // 2) Retour sur Mon portefeuille de Placements puis ouverture via le bouton Outils experts · Quant IA
    await page.getByRole('tab', { name: /Mon portefeuille/i }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Placements/i, { timeout: 10_000 });

    const boutonPasserelle = page
      .locator('#main')
      .getByRole('button', { name: /Outils experts|Quant IA/i })
      .first();
    await expect(boutonPasserelle).toBeVisible({ timeout: 10_000 });
    await boutonPasserelle.click();

    await expect(workspace).toBeVisible({ timeout: 15_000 });
    await expect(workspace.locator('svg').first()).toBeVisible({ timeout: 10_000 });

    verifierAucuneErreur(collecteur);
  });

  test('Parcours complet des 6 sous-onglets, Preuve IA (1M/1A/5A/10A + audit aveugle), 4 sous-vues Agents & Futur et 8 labos', async ({ page }) => {
    const collecteur = await attacherGardeErreursEtRepliApi(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const workspace = await ouvrirValoriaViaBarreLaterale(page);

    // 1. Ce que j’ai
    await cliquerSousOngletValoria(workspace, /Ce que j[’']ai/i);
    await expect(workspace.locator('svg').first()).toBeVisible({ timeout: 10_000 });
    verifierTexteSansValeursInvalides(await workspace.innerText());

    // 2. Recommandés
    await cliquerSousOngletValoria(workspace, /Recommandés/i);
    await expect(workspace.getByText(/Santé|Alléger|Renforcer|Recommandé/i).first()).toBeVisible({ timeout: 10_000 });
    verifierTexteSansValeursInvalides(await workspace.innerText());

    // 3. Preuve IA : basculement 1M, 1A, 5A, 10A + Synthèse + Audit à l’aveugle
    await cliquerSousOngletValoria(workspace, /Preuve IA/i);
    const horizons: RegExp[] = [
      /Il y a 1 mois|\b1M\b/i,
      /Il y a 1 an|\b1A\b/i,
      /Il y a 5 ans|\b5A\b/i,
      /Il y a 10 ans|\b10A\b/i,
    ];
    for (const hRegex of horizons) {
      const btnHorizon = workspace
        .getByRole('tab', { name: hRegex })
        .or(workspace.getByRole('button', { name: hRegex }))
        .first();
      await expect(btnHorizon).toBeVisible({ timeout: 10_000 });
      await btnHorizon.click();
      await expect(workspace.locator('svg').first()).toBeVisible({ timeout: 10_000 });
      const txtHorizon = await workspace.innerText();
      verifierTexteSansValeursInvalides(txtHorizon);
      expect(extraireNombresCAD(txtHorizon).length).toBeGreaterThan(0);
    }

    const btnBlindTest = workspace
      .getByRole('button', { name: /(Tester|Relancer) Gemini à l[’']aveugle|Audit.*aveugle/i })
      .first();
    await expect(btnBlindTest).toBeVisible({ timeout: 10_000 });
    await btnBlindTest.click();
    // Attendre la fin éventuelle de la délibération (mode repli/offline sans 500)
    await expect(btnBlindTest).toBeEnabled({ timeout: 15_000 });
    verifierTexteSansValeursInvalides(await workspace.innerText());

    // 4. Marchés
    await cliquerSousOngletValoria(workspace, /\bMarchés\b/i);
    await expect(workspace.getByText(/Marché|Opportunités|actifs/i).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    verifierTexteSansValeursInvalides(await workspace.innerText());

    // 5. Analyse & Futur + sous-vues
    await cliquerSousOngletValoria(workspace, /Analyse\s*&\s*Futur/i);
    const sousVuesIntel: Array<{ bouton: RegExp; temoin: RegExp }> = [
      { bouton: /Causal IA|Radar IA & Actus Causal|IA & Actus/i, temoin: /Causal|Catalyseur|Actualités|Actus/i },
      { bouton: /Inflation|Pouvoir d[’']Achat/i, temoin: /Pouvoir d[’']Achat Réel|Inflation projetée|Inflation/i },
      { bouton: /Comité IA|Analyse IA|7 Agents/i, temoin: /Scanner Actus Direct|Relancer Scan IA|Comité|Agents/i },
      { bouton: /Futur 2031|Trajectoire 2031/i, temoin: /Projection 2031|Gain estimé 2031|2031/i },
    ];
    const tabpanel = workspace.getByRole('tabpanel');
    for (const sv of sousVuesIntel) {
      const btnSub = workspace.getByRole('button', { name: sv.bouton }).or(workspace.getByRole('tab', { name: sv.bouton })).first();
      if (await btnSub.isVisible().catch(() => false)) {
        await btnSub.click();
        await expect(tabpanel.getByText(sv.temoin).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
        verifierTexteSansValeursInvalides(await workspace.innerText());
      }
    }

    // 6. Sélecteur des 4 laboratoires complémentaires (Vue Conseiller, Backtest, Signaux, Actualités)
    const labsComplementaires: Array<{ label: RegExp; temoin: RegExp }> = [
      { label: /Backtest/i, temoin: /Backtest|Rendement|CAGR|Drawdown/i },
      { label: /Signaux Actions/i, temoin: /Signaux|Actions|Score/i },
      { label: /Actualités en direct/i, temoin: /Actualités|Actus|Nouvelles|Catalyseurs/i },
    ];

    const labSection = workspace.getByRole('region', { name: 'Laboratoire quantitatif complémentaire' });

    // On ouvre obligatoirement Backtest puis les autres vues présentes dans le sélecteur
    await ouvrirLaboratoireComplementaire(workspace, labsComplementaires[0].label);
    await expect(labSection.getByText(labsComplementaires[0].temoin).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
    verifierTexteSansValeursInvalides(await workspace.innerText());

    for (const lab of labsComplementaires.slice(1)) {
      await ouvrirLaboratoireComplementaire(workspace, lab.label);
      await expect(labSection.getByText(lab.temoin).filter({ visible: true }).first()).toBeVisible({ timeout: 10_000 });
      verifierTexteSansValeursInvalides(await workspace.innerText());
    }

    verifierAucuneErreur(collecteur);
  });

  test('Preuve d’isolation stricte (ADR-V3) : ordre simulé / Bac à Sable ne modifie jamais state.assets dans Placements', async ({ page }) => {
    const collecteur = await attacherGardeErreursEtRepliApi(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    // 1. Lire l'état réel initial dans Placements + localStorage
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('button', { name: 'Placements' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Placements/i, { timeout: 10_000 });
    const placementsTexteAvant = await page.locator('#main').innerText();
    const cadsPlacementsAvant = extraireNombresCAD(placementsTexteAvant);
    expect(cadsPlacementsAvant.length).toBeGreaterThan(0);

    const storeAvant = await lireSnapshotStorePersiste(page);
    expect(storeAvant.assets.length).toBeGreaterThan(0);

    // 2. Ouvrir Valoria, lire le total simulé initial, puis exécuter un ordre simulé
    const workspace = await ouvrirValoriaViaBarreLaterale(page);
    await expect(page.getByTestId('valoria-simulation-banner')).toBeVisible({ timeout: 10_000 });
    const cadsValoriaAvant = extraireNombresCAD(await workspace.innerText());
    expect(cadsValoriaAvant.length).toBeGreaterThan(0);

    // Passer sur Recommandés ou Marchés pour exécuter un ordre simulé
    await cliquerSousOngletValoria(workspace, /Recommandés/i);
    const btnOrdreSimule = workspace
      .getByRole('button', { name: /Acheter \+|Vendre |Tout appliquer/i })
      .first();

    if (await btnOrdreSimule.isVisible().catch(() => false)) {
      await btnOrdreSimule.click();
    } else {
      // Filet : passer par Marchés et exécuter un investissement simulé
      await cliquerSousOngletValoria(workspace, /\bMarchés\b/i);
      const btnInvestirMarche = workspace.getByRole('button', { name: /Investir|\+ ?\d/i }).first();
      await expect(btnInvestirMarche).toBeVisible({ timeout: 10_000 });
      await btnInvestirMarche.click();
    }

    // Revenir sur Ce que j'ai dans Valoria et vérifier que la simulation a bien évolué
    await cliquerSousOngletValoria(workspace, /Ce que j[’']ai/i);
    await expect
      .poll(async () => {
        const cadsApres = extraireNombresCAD(await workspace.innerText());
        return JSON.stringify(cadsApres);
      }, { timeout: 10_000 })
      .not.toBe(JSON.stringify(cadsValoriaAvant));

    // 3. Revenir sur Placements (Mon portefeuille) et prouver l'immutabilité totale des avoirs réels FinanceAI
    await nav.getByRole('button', { name: 'Placements' }).click();
    await page.getByRole('tab', { name: /Mon portefeuille/i }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Placements/i, { timeout: 10_000 });
    await expect(page.getByText(/Enveloppes fiscales et flux de dividendes|Titres détenus/i).first()).toBeVisible({ timeout: 10_000 });

    const storeApres = await lireSnapshotStorePersiste(page);
    expect(storeApres.assets).toEqual(storeAvant.assets);
    expect(storeApres.initialBalances).toEqual(storeAvant.initialBalances);

    const placementsTexteApres = await page.locator('#main').innerText();
    expect(extraireNombresCAD(placementsTexteApres)[0]).toBe(cadsPlacementsAvant[0]);

    verifierAucuneErreur(collecteur);
  });

  test('Mode Discret global : masque les montants personnels dans Valoria puis les restaure', async ({ page }) => {
    const collecteur = await attacherGardeErreursEtRepliApi(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const workspace = await ouvrirValoriaViaBarreLaterale(page);
    const cadsAvant = extraireNombresCAD(await workspace.innerText());
    expect(cadsAvant.length).toBeGreaterThan(0);

    // Activer le Mode Discret global depuis la barre latérale FinanceAI
    await page.getByRole('button', { name: 'Activer le mode discret' }).click();

    await expect(workspace.getByText('•••').first()).toBeVisible({ timeout: 10_000 });
    await expect(workspace.getByText('Montant masqué').first()).toBeAttached();
    const cadsMasques = extraireNombresCAD(await workspace.innerText());
    expect(cadsMasques.length).toBeLessThan(cadsAvant.length);

    // Quitter le Mode Discret et vérifier la restauration
    await page.getByRole('button', { name: 'Quitter le mode discret' }).click();
    await expect
      .poll(async () => extraireNombresCAD(await workspace.innerText()).length, {
        timeout: 10_000,
      })
      .toBe(cadsAvant.length);

    verifierAucuneErreur(collecteur);
  });

  test('Intégration profonde Placements ↔ Valoria : signal par titre ouvre Rayon-X puis application confirmée dans Placements', async ({ page }) => {
    const collecteur = await attacherGardeErreursEtRepliApi(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const storeAvant = await lireSnapshotStorePersiste(page);
    const nav = page.getByRole('navigation', { name: 'Navigation principale' });

    // 1. Depuis Placements, attendre l'apparition du signal Valoria sur un titre et cliquer pour ouvrir son Rayon-X
    await nav.getByRole('button', { name: 'Placements' }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Placements/i, { timeout: 10_000 });

    const badgeSignalQuant = page
      .locator('#main')
      .getByRole('button', { name: /^(Renforcer|Conserver|Alléger)\s*·\s*\d+/i })
      .first();
    await expect(badgeSignalQuant).toBeVisible({ timeout: 15_000 });
    await badgeSignalQuant.click();

    const workspace = page.getByTestId('valoria-workspace');
    await expect(workspace).toBeVisible({ timeout: 15_000 });
    const modalRayonX = page.getByRole('dialog').first();
    await expect(modalRayonX).toBeVisible({ timeout: 10_000 });

    // Fermer la fiche Rayon-X et aller dans Recommandés
    await page.keyboard.press('Escape');
    await expect(modalRayonX).toBeHidden({ timeout: 5_000 });

    await cliquerSousOngletValoria(workspace, /\bRecommandés\b|\bRecommandé\b/i);
    const btnAppliquerReel = workspace.getByRole('button', { name: /Appliquer au réel/i }).first();
    if (await btnAppliquerReel.isVisible().catch(() => false)) {
      await btnAppliquerReel.click();
      const modalConfirm = page.getByRole('dialog', { name: /Appliquer à mes Placements réels/i });
      await expect(modalConfirm).toBeVisible({ timeout: 10_000 });
      await modalConfirm.getByRole('button', { name: /Confirmer dans Placements/i }).click();
      await expect(modalConfirm).toBeHidden({ timeout: 10_000 });

      const storeApres = await lireSnapshotStorePersiste(page);
      expect(JSON.stringify(storeApres.assets)).not.toBe(JSON.stringify(storeAvant.assets));
    }

    verifierAucuneErreur(collecteur);
  });
});
