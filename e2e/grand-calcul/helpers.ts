/**
 * Helpers partagés pour la suite E2E Futur 4.0 (`e2e/grand-calcul/**`).
 *
 * Contrats Futur 4.0 alignés avec :
 * - `components/future/FutureScenarioHeader.tsx`
 * - `components/future/FutureRichTooltip.tsx`
 * - `components/future/FutureCoreMilestonesGrid.tsx`
 * - `components/future/FutureUnifiedInsightsPanel.tsx`
 * - `components/FutureProjection.tsx`
 * - `services/deepForecastStore.ts` (IndexedDB `financeai-deep-forecast` / store `applied_reports`)
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from '../helpers/setup';

export type PersonaId =
  | 'couple-confort'
  | 'couple-dettes'
  | 'pre-retraite-riche'
  | 'lea-fauchee'
  | 'karim-immigre'
  | 'gilles-actif-decaisse'
  | 'jeune-couple-dink'
  | 'autonome-monoparentale';

export type ScenarioLabel =
  | 'Trajectoire réelle'
  | 'Prudent / Stress'
  | 'Optimisé IA'
  | 'Favorable';

export interface ErrorCollector {
  consoleErrors: string[];
  pageErrors: string[];
  serverErrors: string[];
  assertClean: () => void;
}

/**
 * Attache des écouteurs console / pageerror / HTTP >= 500 sur la page Playwright.
 */
export function attacherCapteurErreurs(page: Page): ErrorCollector {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const serverErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      serverErrors.push(`${res.status()} ${res.url()}`);
    }
  });

  return {
    consoleErrors,
    pageErrors,
    serverErrors,
    assertClean: () => {
      expect(consoleErrors, `Erreurs console inattendues : ${consoleErrors.join(' | ')}`).toEqual([]);
      expect(pageErrors, `Erreurs non interceptées : ${pageErrors.join(' | ')}`).toEqual([]);
      expect(serverErrors, `Erreurs HTTP >= 500 : ${serverErrors.join(' | ')}`).toEqual([]);
    },
  };
}

/**
 * Passe l'écran local / offline gate si présent, puis attend que le DOM principal soit prêt.
 */
export async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page
    .getByRole('button', {
      name: /Accéder directement à mon dossier local|Continuer en mode local|Continuer sans compte/i,
    })
    .first();
  await btnLocal.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => {});
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
}

/**
 * Ferme les toasts encore visibles pour éviter qu'ils n'interceptent un clic dans le bas du graphe.
 */
export async function fermerToastsSiPresents(page: Page): Promise<void> {
  const zone = page.getByRole('region', { name: 'Notifications' });
  const fermer = zone.getByRole('button', { name: 'Fermer la notification' });
  for (let i = 0; i < 4 && (await fermer.count()) > 0; i++) {
    await fermer.first().click({ timeout: 1_000 }).catch(() => {});
  }
}

/**
 * Prépare la page sur `#FUTURE` avec le persona demandé injecté dans `localStorage`.
 */
export async function preparerFuturAvecPersona(
  page: Page,
  personaId: PersonaId = 'couple-confort',
): Promise<void> {
  await page.addInitScript(scriptBypassOnboarding());
  await page.goto('/?nogate=1');
  await page.waitForLoadState('domcontentloaded');
  await passerGardeLocale(page);
  await activateTestMode(page, personaId);
  await naviguerVersFutur(page);
}

/**
 * Navigue vers `#FUTURE` et attend que la courbe et le Bloc 1 soient visibles.
 */
export async function naviguerVersFutur(page: Page): Promise<void> {
  await page.goto('/#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  await fermerToastsSiPresents(page);
  await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
  await expect(zoneScenarios(page)).toBeVisible({ timeout: 15_000 });
}

/* -------------------------------------------------------------------------- */
/* Sélecteurs canoniques Futur 4.0                                            */
/* -------------------------------------------------------------------------- */

export function zoneScenarios(page: Page): Locator {
  return page.locator('main section[aria-label="Scénarios de trajectoire future"]').first();
}

export function zoneReperesCles(page: Page): Locator {
  return page.locator('main section[aria-labelledby="futur-reperes-cles-titre"]').first();
}

export function zoneAnalyseUnifiee(page: Page): Locator {
  return page.locator('main section[aria-labelledby="futur-insights-unifies-titre"]').first();
}

export async function ouvrirOngletFutur(
  page: Page,
  onglet: 'Courbe' | 'Quoi faire' | 'Détails',
): Promise<void> {
  const tab = page
    .getByRole('tablist', { name: 'Sections du Futur' })
    .getByRole('tab', { name: new RegExp(onglet, 'i') })
    .first();
  await expect(tab).toBeVisible({ timeout: 10_000 });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

export function infobulleRiche(page: Page): Locator {
  return page.locator('[data-testid="future-rich-tooltip"]');
}

export function boutonScenario(page: Page, label: ScenarioLabel): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return zoneScenarios(page).getByRole('button', { name: new RegExp(escaped, 'i') }).first();
}

export function boutonLancerAnalyseProfonde(page: Page): Locator {
  return zoneScenarios(page)
    .getByRole('button', { name: /^(Lancer|Relancer) l[’']analyse profonde/i })
    .first();
}

export function boutonAnnulerAnalyseProfonde(page: Page): Locator {
  return zoneScenarios(page).getByRole('button', { name: /^Annuler$/i }).first();
}

export function barreProgressionAnalyseProfonde(page: Page): Locator {
  return zoneScenarios(page).getByRole('progressbar', { name: /Progression de l[’']analyse profonde/i }).first();
}

export function boutonAppliquerAnalyseProfonde(page: Page): Locator {
  return zoneScenarios(page).getByRole('button', { name: /^Appliquer et mémoriser$/i }).first();
}

export function boutonIgnorerAnalyseProfonde(page: Page): Locator {
  return zoneScenarios(page).getByRole('button', { name: /^Ignorer$/i }).first();
}

/**
 * Exécute l'analyse profonde à 100 000 trajectoires, attend l'état `staged` (`Appliquer et mémoriser`),
 * puis l'applique et vérifie le passage en mémoire (`Analyse profonde en mémoire` + `100 000 trajectoires`).
 */
export async function executerEtAppliquerAnalyseProfonde(
  page: Page,
  options: { timeoutMs?: number; appliquer?: boolean } = {},
): Promise<void> {
  const { timeoutMs = 130_000, appliquer = true } = options;
  const btnLancer = boutonLancerAnalyseProfonde(page);
  await expect(btnLancer).toBeVisible({ timeout: 10_000 });
  await btnLancer.click();

  const btnAppliquer = boutonAppliquerAnalyseProfonde(page);
  await expect(btnAppliquer).toBeVisible({ timeout: timeoutMs });
  await expect(zoneScenarios(page).getByText(/Nouvelle analyse prête/i)).toBeVisible();
  await expect(zoneScenarios(page).getByText(/100[\s\u00a0\u202f]?000\s+trajectoires/i)).toBeVisible();

  if (appliquer) {
    await btnAppliquer.click();
    await expect(zoneScenarios(page).getByText(/Analyse profonde en mémoire/i)).toBeVisible({ timeout: 15_000 });
    await expect(zoneScenarios(page).getByText(/100[\s\u00a0\u202f]?000\s+trajectoires/i)).toBeVisible();
    await expect(
      zoneScenarios(page).getByRole('button', { name: /^Relancer l[’']analyse profonde$/i }),
    ).toBeVisible();
  }
}

/* -------------------------------------------------------------------------- */
/* Inspection & corruption IndexedDB (`financeai-deep-forecast`)              */
/* -------------------------------------------------------------------------- */

export interface DeepForecastIdbInspectResult {
  dbFound: boolean;
  recordCount: number;
  keys: string[];
  allEncryptedAndCiphertextOnly: boolean;
  localStorageHasReportLeak: boolean;
}

/**
 * Inspecte la base IndexedDB `financeai-deep-forecast` (store `applied_reports`)
 * et vérifie l'absence totale de fuite du rapport profond dans `localStorage`.
 */
export async function inspecterPayloadIDBDeepForecast(page: Page): Promise<DeepForecastIdbInspectResult> {
  return page.evaluate(async () => {
    const localStorageHasReportLeak = Object.keys(localStorage).some((k) => {
      const v = localStorage.getItem(k) ?? '';
      return (
        k.includes('deep-forecast') ||
        k.includes('deepForecast') ||
        v.includes('real_trajectory') ||
        v.includes('prudent_stress') ||
        v.includes('favorable_tailwinds')
      );
    });

    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    const found = dbs.some((d) => d.name === 'financeai-deep-forecast');
    if (!found) {
      return {
        dbFound: false,
        recordCount: 0,
        keys: [],
        allEncryptedAndCiphertextOnly: false,
        localStorageHasReportLeak,
      };
    }

    const records = await new Promise<Array<{ id?: unknown; encrypted?: unknown; payload?: unknown }>>((resolve) => {
      const req = indexedDB.open('financeai-deep-forecast');
      req.onerror = () => resolve([]);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('applied_reports')) {
          db.close();
          resolve([]);
          return;
        }
        const tx = db.transaction('applied_reports', 'readonly');
        const store = tx.objectStore('applied_reports');
        const getAllReq = store.getAll();
        getAllReq.onsuccess = () => {
          db.close();
          resolve((getAllReq.result as Array<{ id?: unknown; encrypted?: unknown; payload?: unknown }>) ?? []);
        };
        getAllReq.onerror = () => {
          db.close();
          resolve([]);
        };
      };
    });

    const keys = records.map((r) => String(r.id ?? ''));
    const allEncryptedAndCiphertextOnly =
      records.length > 0 &&
      records.every((r) => {
        if (r.encrypted !== true || typeof r.payload !== 'string' || r.payload.length < 16) return false;
        return (
          !r.payload.trimStart().startsWith('{') &&
          !r.payload.includes('"real_trajectory"') &&
          !r.payload.includes('"p50"')
        );
      });

    return {
      dbFound: true,
      recordCount: records.length,
      keys,
      allEncryptedAndCiphertextOnly,
      localStorageHasReportLeak,
    };
  });
}

/**
 * Corrompt tous les enregistrements `applied_reports` dans `financeai-deep-forecast`.
 */
export async function corrompreEnregistrementDeepForecastIDB(page: Page): Promise<number> {
  return page.evaluate(async () => {
    return new Promise<number>((resolve) => {
      const req = indexedDB.open('financeai-deep-forecast');
      req.onerror = () => resolve(0);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('applied_reports')) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction('applied_reports', 'readwrite');
        const store = tx.objectStore('applied_reports');
        const keysReq = store.getAllKeys();
        keysReq.onsuccess = () => {
          const keys = keysReq.result ?? [];
          for (const k of keys) {
            store.put({
              id: k,
              payload: 'corrupted-ciphertext-e2e',
              encrypted: true,
              timestamp: Date.now(),
            });
          }
          tx.oncomplete = () => {
            db.close();
            resolve(keys.length);
          };
          tx.onerror = () => {
            db.close();
            resolve(0);
          };
        };
        keysReq.onerror = () => {
          db.close();
          resolve(0);
        };
      };
    });
  });
}

/**
 * Supprime la base de clé locale `financeai-secure` (simule perte de clé d'appareil).
 */
export async function supprimerClesAppareilIDB(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('financeai-secure');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Infobulle riche, Ruban P10–P90, Audit tactiles, Débordement & Mode Discret */
/* -------------------------------------------------------------------------- */

/**
 * Épingle le `FutureRichTooltip` en cliquant au centre-droit du graphe (hors icônes d'événement).
 */
export async function epinglerInfobulleSurCourbe(page: Page, xRatio = 0.62, yRatio = 0.55): Promise<Locator> {
  await fermerToastsSiPresents(page);
  const svgSurface = page.locator('.recharts-wrapper svg.recharts-surface').first();
  await expect(svgSurface).toBeVisible({ timeout: 10_000 });
  await svgSurface.scrollIntoViewIfNeeded();
  const box = await svgSurface.boundingBox();
  if (!box) throw new Error('Surface SVG de la courbe introuvable');

  await page.mouse.click(box.x + box.width * xRatio, box.y + box.height * yRatio);

  // Si un clic malchanceux a touché un marqueur d'événement ouvrant la modale directement, la fermer et réessayer
  const modalDirect = page.getByRole('dialog', { name: /Détail du mois/i });
  if (await modalDirect.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(modalDirect).toBeHidden();
    await page.mouse.click(box.x + box.width * Math.min(0.85, xRatio + 0.08), box.y + box.height * 0.48);
  }

  const tooltip = page.locator('[data-testid="future-rich-tooltip"][data-pinned="true"]');
  await expect(tooltip).toBeVisible({ timeout: 8_000 });
  return tooltip;
}

/**
 * Audite le ruban SVG `[P10, P90]` unique de Futur 4.0 :
 * - exactement 1 path `fill="url(#gfConfidenceRibbonGrad)"` non vide
 * - aucun path/bande `P5`/`P25`/`P75`/`P95`
 * - la borne inférieure du ruban n'est pas écrasée à la ligne de base Y=0 lorsque les données sont > 0.
 */
export async function auditerRubanP10P90Svg(page: Page): Promise<void> {
  const ribbonStats = await page.evaluate(() => {
    const ribbonPaths = Array.from(document.querySelectorAll('path.recharts-area-area[fill*="gfConfidenceRibbonGrad"]'));
    if (ribbonPaths.length !== 1) {
      return {
        count: ribbonPaths.length,
        d: '',
        boxHeight: 0,
        lowerEdgeSpreadPx: 0,
      };
    }
    const ribbonPath = ribbonPaths[0];
    const pathRect = ribbonPath.getBoundingClientRect();
    const d = ribbonPath.getAttribute('d') ?? '';
    // Recharts Area range trace d'abord le bord supérieur (gauche -> droite) puis le bord inférieur (droite -> gauche)
    // avec `M` puis `L` (linéaire) ou `C x1,y1,x2,y2,x,y` (courbe monotone).
    const coordPairs: Array<{ x: number; y: number }> = [];
    const cmdRe =
      /([ML])\s*(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)|C\s*-?\d+(?:\.\d+)?[,\s]+-?\d+(?:\.\d+)?[,\s]+-?\d+(?:\.\d+)?[,\s]+-?\d+(?:\.\d+)?[,\s]+(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)/g;
    for (const m of d.matchAll(cmdRe)) {
      const x = Number(m[1] ? m[2] : m[4]);
      const y = Number(m[1] ? m[3] : m[5]);
      if (Number.isFinite(x) && Number.isFinite(y)) coordPairs.push({ x, y });
    }
    const half = Math.floor(coordPairs.length / 2);
    const lowerYs = coordPairs.slice(half).map((p) => p.y).filter(Number.isFinite);
    const lowerEdgeSpreadPx =
      lowerYs.length >= 2 ? Math.max(...lowerYs) - Math.min(...lowerYs) : 0;
    return {
      count: ribbonPaths.length,
      d,
      boxHeight: pathRect.height,
      lowerEdgeSpreadPx,
    };
  });

  expect(ribbonStats.count).toBe(1);
  expect(ribbonStats.d.length).toBeGreaterThan(20);
  expect(ribbonStats.boxHeight).toBeGreaterThan(8);
  // Vérifie que la borne inférieure du ruban suit réellement P10 (non écrasée à une ligne plate Y=0)
  expect(ribbonStats.lowerEdgeSpreadPx).toBeGreaterThan(4);

  // Aucune mention P5/P25/P75/P95 dans le ChartDataTable
  const tableHeaders = await page.locator('table.sr-only thead th').allInnerTexts().catch(() => []);
  for (const th of tableHeaders) {
    expect(th).not.toMatch(/\bP5\b|\bP25\b|\bP75\b|\bP95\b/i);
  }
}

/**
 * Vérifie que toutes les cibles tactiles visibles d'un conteneur font >= 44 px de hauteur.
 */
export async function auditerCiblesTactilesConteneur(container: Locator): Promise<void> {
  const boutons = container.locator('button:visible');
  const count = await boutons.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const btn = boutons.nth(i);
    const box = await btn.boundingBox();
    if (box && box.width > 0 && box.height > 0) {
      expect(box.height, `Bouton trop petit (${await btn.innerText()}): ${box.height}px`).toBeGreaterThanOrEqual(43.5);
    }
  }
}

/**
 * Vérifie l'absence de débordement horizontal sur le viewport courant.
 */
export async function verifierZeroDebordementHorizontal(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

/**
 * Bascule le mode discret (Desktop via sidebar, Mobile via « Plus » si bouton non visible directement).
 */
export async function basculerModeDiscret(page: Page): Promise<void> {
  const btnDirect = page.getByRole('button', { name: /Mode discret/i }).first();
  if (await btnDirect.isVisible().catch(() => false)) {
    await btnDirect.click();
    return;
  }

  const mobileNav = page.getByRole('navigation', { name: 'Navigation mobile' });
  await expect(mobileNav).toBeVisible({ timeout: 8_000 });
  await mobileNav.getByRole('button', { name: /Plus/i }).click();
  const btnDrawer = page.getByRole('button', { name: /Mode discret/i }).first();
  await expect(btnDrawer).toBeVisible({ timeout: 6_000 });
  await btnDrawer.click();
  await page.keyboard.press('Escape');
}

/**
 * Vérifie qu'en mode discret aucun montant CAD ni chiffre sensible ne fuite dans les 4 blocs de Futur.
 */
export async function verifierModeDiscretFutur4(page: Page): Promise<void> {
  await expect(page.getByText('•••').first()).toBeVisible({ timeout: 8_000 });

  await ouvrirOngletFutur(page, 'Détails');
  for (const section of [zoneReperesCles(page), zoneAnalyseUnifiee(page)]) {
    const text = await section.innerText();
    expect(text).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);
    expect(text).toContain('•••');
  }

  await ouvrirOngletFutur(page, 'Quoi faire');
  const actionsText = await zoneAnalyseUnifiee(page).innerText();
  expect(actionsText).not.toMatch(/\d[\d\s\u00a0\u202f,.]*\s*\$/);
  expect(actionsText).toContain('•••');

  await ouvrirOngletFutur(page, 'Courbe');

  // En-têtes ou cellules du tableau accessible .sr-only masquées en mode discret
  const srOnlyText = await page.locator('main .sr-only').allInnerTexts();
  expect(srOnlyText.join(' ')).toContain('Montant masqué');
}
