/**
 * Suite E2E Placements simplifiés × Comité Multi-Agents & LIA — Desktop (1440×900) et Mobile (390×844).
 *
 * Vérifie bout en bout :
 * - Exactement 2 onglets principaux dans Placements (« Mon portefeuille », « Analyse IA »)
 * - 2 sections repliables fermées par défaut (« Répartition & rééquilibrage », « Détail des titres, DCA & dividendes »)
 * - Ouverture / fermeture discrète des « Outils experts » (ValoriaWorkspace)
 * - Analyse multi-agents sur « Est-ce que ça vaut le coup d’acheter Anthropic ? » (statut privé non coté, verdict, proxies indirects, 4 agents)
 * - Demande similaire dans l’Assistant LIA global (« Analyser Anthropic / titre ») -> tableau multi-agents + avis honnête
 * - Zéro débordement horizontal en mobile 390×844, zéro erreur console / HTTP >= 500
 */
import { test, expect, type Page } from '@playwright/test';
import {
  activateTestMode,
  ecarterLeRail,
  scriptBypassOnboarding,
} from './helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

interface ErrorCollector {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
}

async function attachGuardsAndOfflineApiFallback(page: Page): Promise<ErrorCollector> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('response', (res) => {
    if (res.url().includes('/api/') && res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  await page.route('**/api/**', async (route) => {
    try {
      const response = await route.fetch();
      if (response.status() >= 500) {
        serverErrors.push(`${response.status()} ${route.request().url()}`);
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
            quotes: [],
            articles: [],
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
          quotes: [],
          articles: [],
          results: [],
        }),
      });
    }
  });

  return { consoleErrors, pageErrors, serverErrors };
}

async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page
    .getByRole('button', { name: /Accéder directement à mon dossier local|Continuer en mode local/i })
    .first();
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
}

test.describe('Placements simplifiés & Comité Multi-Agents IA (Placements + LIA)', () => {
  test.setTimeout(90_000);

  test('Desktop 1440×900 : 2 onglets Placements, Anthropic multi-agents dans Analyse IA et dans LIA, Outils experts', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = await attachGuardsAndOfflineApiFallback(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    const nav = page.getByRole('navigation', { name: 'Navigation principale' });
    await nav.getByRole('button', { name: /^Placements$/i }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Placements/i, { timeout: 10_000 });

    // Vérifie exactement 2 onglets principaux dans Vues Placements
    const tablist = page.getByRole('tablist', { name: 'Vues Placements' });
    await expect(tablist.getByRole('tab')).toHaveCount(2);
    await expect(tablist.getByRole('tab', { name: /Mon portefeuille/i })).toBeVisible();
    await expect(tablist.getByRole('tab', { name: /Analyse IA/i })).toBeVisible();

    // 2 sections repliables fermées par défaut
    const secAlloc = page.getByRole('button', { name: /Répartition & rééquilibrage/i });
    const secDetail = page.getByRole('button', { name: /Détail des titres, DCA & dividendes/i });
    await expect(secAlloc).toHaveAttribute('aria-expanded', 'false');
    await expect(secDetail).toHaveAttribute('aria-expanded', 'false');

    // Ouverture/fermeture Outils experts
    const btnOutilsExperts = page.getByRole('button', { name: /Outils experts/i });
    await btnOutilsExperts.click();
    await expect(page.getByTestId('valoria-workspace')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /Retour à Placements/i }).click();
    await expect(page.getByTestId('valoria-workspace')).toHaveCount(0);

    // Onglet Analyse IA -> question Anthropic
    await tablist.getByRole('tab', { name: /Analyse IA/i }).click();
    await expect(page.getByTestId('multi-agent-committee-view')).toBeVisible();
    await page.getByRole('button', { name: 'Acheter Anthropic ?' }).click();

    await expect(page.getByTestId('committee-report')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('committee-verdict-badge')).toContainText(/Exposition indirecte/i);
    await expect(page.getByText(/Société privée non cotée/i).first()).toBeVisible();
    await expect(page.getByTestId('agent-card-market_news')).toBeVisible();
    await expect(page.getByTestId('agent-card-fundamentals')).toBeVisible();
    await expect(page.getByTestId('agent-card-risk_bear')).toBeVisible();
    await expect(page.getByTestId('agent-card-portfolio_qc_tax')).toBeVisible();
    await expect(page.getByText('AMZN').first()).toBeVisible();

    // Assistant LIA global -> question Anthropic
    await page.getByRole('button', { name: /Ouvrir le conseiller financier Gemini/i }).click();
    const assistantComposeur = page.getByTestId('assistant-composeur');
    await expect(assistantComposeur).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Analyser Anthropic \/ titre/i }).click();

    await expect(page.getByText(/Comité IA — Anthropic/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Agent Marché & Actus Web/i).first()).toBeVisible();

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.serverErrors).toEqual([]);
  });

  test('Mobile 390×844 : zéro débordement horizontal sur Mon portefeuille et Analyse IA', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = await attachGuardsAndOfflineApiFallback(page);
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/?nogate=1');
    await page.waitForLoadState('domcontentloaded');
    await passerGardeLocale(page);
    await activateTestMode(page);
    await ecarterLeRail(page);

    await page.getByRole('navigation', { name: 'Navigation mobile' }).getByRole('button', { name: /^Placements$/i }).click();
    await expect(page.locator('#main h1').first()).toContainText(/Placements/i, { timeout: 10_000 });

    const scrollPortefeuille = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(scrollPortefeuille.w).toBeLessThanOrEqual(scrollPortefeuille.iw);

    await page.getByRole('tab', { name: /Analyse IA/i }).click();
    await page.getByRole('button', { name: 'Acheter Anthropic ?' }).click();
    await expect(page.getByTestId('committee-report')).toBeVisible({ timeout: 15_000 });

    const scrollAnalyse = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(scrollAnalyse.w).toBeLessThanOrEqual(scrollAnalyse.iw);

    expect(errors.consoleErrors).toEqual([]);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.serverErrors).toEqual([]);
  });
});
