/**
 * Suite E2E Valoria · Quant IA — Mobile (`390×844` tactile, projet `mobile-chrome`).
 *
 * Vérifie :
 * - Ouverture de Valoria depuis le menu « Plus » mobile
 * - Navigation entre les 6 onglets principaux et sous-vues sur viewport `390×844`
 * - Zéro débordement horizontal (`document.documentElement.scrollWidth <= window.innerWidth`)
 * - Cibles tactiles >= 44 px sur les contrôles interactifs visibles
 * - Mode Discret via le menu « Plus »
 * - Zéro `console.error`, zéro `pageerror`, zéro réponse HTTP >= 500 sur `/api/*`
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  activateTestMode,
  ecarterLeRail,
  scriptBypassOnboarding,
} from '../helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

interface CollecteurErreursMobile {
  consoleErrors: string[];
  pageErrors: string[];
  apiServerErrors: string[];
}

async function attacherCollecteursEtRepliMobile(page: Page): Promise<CollecteurErreursMobile> {
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

function verifierAucuneErreurMobile(collecteur: CollecteurErreursMobile): void {
  expect(collecteur.pageErrors, 'Erreurs JS non gérées (pageerror)').toEqual([]);
  expect(collecteur.consoleErrors, 'Erreurs console navigateur').toEqual([]);
  expect(collecteur.apiServerErrors, 'Réponses HTTP >= 500 sur /api/*').toEqual([]);
}

async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page.getByRole('button', { name: /Accéder directement à mon dossier local/i });
  await btnLocal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
}

async function ouvrirValoriaDepuisMenuPlusMobile(page: Page): Promise<Locator> {
  const plusBtn = page.getByRole('button', { name: "Plus d'options" });
  await expect(plusBtn).toBeVisible({ timeout: 10_000 });
  if ((await plusBtn.getAttribute('aria-expanded')) !== 'true') {
    await plusBtn.click();
  }

  const navAutres = page.getByRole('navigation', { name: 'Autres destinations' });
  await expect(navAutres).toBeVisible({ timeout: 10_000 });
  await expect(navAutres.getByRole('button', { name: /Valoria\s*·\s*Quant IA/i })).toHaveCount(0);

  const btnPlacements = navAutres.getByRole('button', { name: /^Placements$/i });
  await expect(btnPlacements).toBeVisible({ timeout: 10_000 });
  await btnPlacements.click();

  const btnOutilsExperts = page.getByRole('button', { name: /Outils experts|Quant IA/i }).first();
  await expect(btnOutilsExperts).toBeVisible({ timeout: 10_000 });
  await btnOutilsExperts.click();

  const workspace = page.getByTestId('valoria-workspace');
  await expect(workspace).toBeVisible({ timeout: 15_000 });
  return workspace;
}

async function verifierAbsenceDebordementHorizontal(page: Page, contexte: string): Promise<void> {
  const mesures = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    mesures.scrollWidth,
    `Débordement horizontal détecté sur ${contexte} (${mesures.scrollWidth}px > ${mesures.innerWidth}px)`,
  ).toBeLessThanOrEqual(mesures.innerWidth);
}

async function auditerCiblesTactilesMin44Px(conteneur: Locator): Promise<string[]> {
  return conteneur.evaluate((root) => {
    const selControls =
      'button, a[href], input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), select, textarea, [role="tab"], [role="button"], [role="switch"]';
    const anomalies: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selControls))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.classList.contains('sr-only')) continue;
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (r.width < 43.5 || r.height < 43.5) {
        const nom = (el.getAttribute('aria-label') || el.textContent || el.tagName)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40);
        anomalies.push(`${el.tagName.toLowerCase()} « ${nom} » ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return anomalies;
  });
}

async function cliquerSousOngletMobile(workspace: Locator, labelRegex: RegExp): Promise<void> {
  const barrePrincipale = workspace.getByRole('tablist').first();
  const dansTablist = barrePrincipale.getByRole('tab', { name: labelRegex }).first();
  if ((await dansTablist.count()) > 0 && (await dansTablist.isVisible().catch(() => false))) {
    await dansTablist.click();
    return;
  }

  const cible = workspace
    .getByRole('tab', { name: labelRegex })
    .or(workspace.getByRole('button', { name: labelRegex }))
    .or(workspace.getByRole('link', { name: labelRegex }))
    .first();
  await expect(cible).toBeVisible({ timeout: 10_000 });
  await cible.click();
}

test.describe('Valoria · Quant IA — Mobile 390×844 tactile', () => {
  test.setTimeout(120_000);

  test('Menu « Plus » -> Valoria, navigation des onglets, zéro débordement horizontal et cibles >= 44 px', async ({ page }) => {
    const collecteur = await attacherCollecteursEtRepliMobile(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const workspace = await ouvrirValoriaDepuisMenuPlusMobile(page);
    await expect(page.getByTestId('valoria-simulation-banner')).toBeVisible({ timeout: 10_000 });
    await verifierAbsenceDebordementHorizontal(page, 'Valoria · Ce que j’ai');

    const ciblesInitiales = await auditerCiblesTactilesMin44Px(workspace);
    expect(ciblesInitiales, 'Cibles tactiles < 44 px sur Ce que j’ai mobile').toEqual([]);

    const onglets: Array<{ label: RegExp; nom: string }> = [
      { label: /Ce que j[’']ai/i, nom: 'Ce que j’ai' },
      { label: /\bRecommandé\b/i, nom: 'Recommandé' },
      { label: /Preuve IA/i, nom: 'Preuve IA' },
      { label: /Discuter IA/i, nom: 'Discuter IA' },
      { label: /\bMarché\b/i, nom: 'Marché' },
      { label: /Agents\s*&\s*Futur/i, nom: 'Agents & Futur' },
    ];

    for (const onglet of onglets) {
      await cliquerSousOngletMobile(workspace, onglet.label);
      await verifierAbsenceDebordementHorizontal(page, `Valoria · ${onglet.nom}`);
      const cibles = await auditerCiblesTactilesMin44Px(workspace);
      expect(cibles, `Cibles tactiles < 44 px sur ${onglet.nom} mobile`).toEqual([]);
    }

    verifierAucuneErreurMobile(collecteur);
  });

  test('Mode Discret sur mobile via « Plus » masque les montants dans Valoria sans débordement', async ({ page }) => {
    const collecteur = await attacherCollecteursEtRepliMobile(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const workspace = await ouvrirValoriaDepuisMenuPlusMobile(page);

    const plusBtn = page.getByRole('button', { name: "Plus d'options" });
    await plusBtn.click();
    await page.getByRole('button', { name: 'Activer le mode discret' }).click();
    await plusBtn.click();

    await expect(workspace.getByText('•••').first()).toBeVisible({ timeout: 10_000 });
    await expect(workspace.getByText('Montant masqué').first()).toBeAttached();
    await verifierAbsenceDebordementHorizontal(page, 'Valoria · Mode Discret mobile');

    verifierAucuneErreurMobile(collecteur);
  });
});
