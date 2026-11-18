/**
 * Helpers Playwright boîte noire partagés pour la suite E2E Grand Calcul (Tiers 1 à 4).
 *
 * Zéro couplage interne : aucune importation depuis `services/`, `store/` ou `components/`.
 * Seul `STORAGE_KEYS` (`utils/storageKeys.ts`) est importé pour respecter la garde du registre.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { activateTestMode, ecarterLeRail, scriptBypassOnboarding } from '../helpers/setup';
import { STORAGE_KEYS } from '../../utils/storageKeys';

export type PersonaTestId =
  | 'couple-confort'
  | 'lea-fauchee'
  | 'karim-immigre'
  | 'couple-dettes'
  | 'pre-retraite-riche'
  | 'jeune-couple-dink'
  | 'autonome-monoparentale'
  | 'gilles-actif-decaisse';

export interface OptionsLancementGrandCalcul {
  iterations?: number;
  regimesMacro?: boolean;
  crisesHistoriques?: boolean;
  timeoutMs?: number;
}

export interface CollecteurErreurs {
  pageErrors: string[];
  consoleErrors: string[];
}

export function scriptBypassGates(): string {
  return `
    ${scriptBypassOnboarding()}
    try {
      sessionStorage.setItem('financeai:offline_bypass', '1');
    } catch {
      // sessionStorage indisponible
    }
  `;
}

export function attacherCollecteursErreurs(page: Page): CollecteurErreurs {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  return { pageErrors, consoleErrors };
}

export async function passerGardeLocale(page: Page): Promise<void> {
  const btnLocal = page.getByRole('button', { name: /Accéder directement à mon dossier local/i });
  await btnLocal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  if (await btnLocal.isVisible().catch(() => false)) {
    await btnLocal.click();
  }
}

async function fermerToastsSiPresents(page: Page): Promise<void> {
  const zone = page.getByRole('region', { name: 'Notifications' });
  const fermer = zone.getByRole('button', { name: 'Fermer la notification' });
  for (let i = 0; i < 4 && (await fermer.count()) > 0; i++) {
    await fermer.first().click({ timeout: 1_000 }).catch(() => {});
  }
}

export async function ouvrirDossierLocalSansModeTest(page: Page, hash = '#FUTURE'): Promise<void> {
  await page.addInitScript(scriptBypassGates());
  await page.goto(`/?nogate=1${hash}`);
  await page.waitForLoadState('domcontentloaded');
  await passerGardeLocale(page);
  await ecarterLeRail(page);
}

export async function revelerCourbeProjection(page: Page): Promise<void> {
  const voirDirect = page.getByRole('button', { name: /projection actuelle.*sans optimiser/i });
  const courbe = page.getByRole('group', { name: /Courbe de vie/ });
  await expect(courbe.or(voirDirect)).toBeVisible({ timeout: 20_000 });
  if (await voirDirect.isVisible().catch(() => false)) {
    await voirDirect.click();
  }
  await expect(courbe).toBeVisible({ timeout: 20_000 });
}

export async function changerPersona(page: Page, personaId: PersonaTestId): Promise<void> {
  const selectBanner = page.getByLabel('Changer de persona de test');
  if (await selectBanner.isVisible().catch(() => false)) {
    await selectBanner.selectOption(personaId);
    await expect(selectBanner).toHaveValue(personaId);
    await fermerToastsSiPresents(page);
    return;
  }
  await page.goto('/?nogate=1#SETTINGS');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  const libelles: Record<PersonaTestId, RegExp> = {
    'couple-confort': /Couple à l'aise/i,
    'lea-fauchee': /Léa/i,
    'karim-immigre': /Karim/i,
    'couple-dettes': /Sophie/i,
    'pre-retraite-riche': /Diane/i,
    'jeune-couple-dink': /Maya/i,
    'autonome-monoparentale': /Nadia/i,
    'gilles-actif-decaisse': /Gilles/i,
  };
  await page.getByRole('group', { name: /persona/i }).getByRole('button', { name: libelles[personaId] }).click();
  await page.waitForFunction(() => document.body.innerText.includes('MODE TEST'), { timeout: 8_000 });
  await fermerToastsSiPresents(page);
}

export async function ouvrirFuturAvecPersona(
  page: Page,
  personaId: PersonaTestId = 'couple-confort',
  opts: { revelerCourbe?: boolean } = {},
): Promise<void> {
  await page.addInitScript(scriptBypassGates());
  await page.goto('/?nogate=1');
  await page.waitForLoadState('domcontentloaded');
  await passerGardeLocale(page);
  await activateTestMode(page);
  if (personaId !== 'couple-confort') {
    await changerPersona(page, personaId);
  }
  await page.goto('/?nogate=1#FUTURE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  if (opts.revelerCourbe !== false) {
    await revelerCourbeProjection(page);
  }
}

export function zoneGrandCalcul(page: Page): Locator {
  return page.locator('main').getByRole('region', { name: /Grand Calcul/i }).first();
}

export function zonePredictions(page: Page): Locator {
  return page.locator('main').getByRole('region', { name: /Prédictions|Jalons.*prédictions/i }).first();
}

export function cartePredictionR2(page: Page, titreRegex: RegExp): Locator {
  const pred = zonePredictions(page);
  return pred
    .getByRole('region', { name: titreRegex })
    .or(pred.locator('article').filter({ hasText: titreRegex }))
    .first();
}

export function zoneExplications(page: Page): Locator {
  return page.locator('main').getByRole('region', { name: /Explications|Pourquoi la courbe/i }).first();
}

export function boutonLancerGrandCalcul(panel: Locator): Locator {
  return panel.getByRole('button', {
    name: /Lancer.*Grand Calcul|Calculer.*Grand Calcul|Relancer|Mettre à jour/i,
  }).first();
}

export function boutonAnnulerGrandCalcul(panel: Locator): Locator {
  return panel.getByRole('button', { name: /Annuler/i }).first();
}

export function barreProgressionGrandCalcul(panel: Locator): Locator {
  return panel.getByRole('progressbar').first();
}

export function badgeParametresModifies(panel: Locator): Locator {
  return panel.getByRole('status').filter({ hasText: /paramètres modifiés|pas à jour|obsolète/i }).first();
}

async function reglerBascule(controle: Locator, actif: boolean): Promise<void> {
  const cible = controle.first();
  await expect(cible).toBeVisible({ timeout: 10_000 });
  await expect(cible).toBeEnabled({ timeout: 5_000 });
  const pressed = await cible.getAttribute('aria-pressed');
  const checked = await cible.getAttribute('aria-checked');
  let courant = false;
  if (pressed !== null) {
    courant = pressed === 'true';
  } else if (checked !== null) {
    courant = checked === 'true';
  } else {
    courant = await cible.isChecked().catch(() => false);
  }
  if (courant !== actif) {
    await cible.click();
  }
}

export async function estBasculeGrandCalculActive(panel: Locator, etiquette: RegExp): Promise<boolean> {
  const controle = panel
    .locator('button, input, [role="switch"], [role="checkbox"]')
    .filter({ hasText: etiquette })
    .or(panel.getByRole('checkbox', { name: etiquette }))
    .or(panel.getByRole('switch', { name: etiquette }))
    .first();
  await expect(controle).toBeVisible({ timeout: 10_000 });
  const pressed = await controle.getAttribute('aria-pressed');
  if (pressed !== null) return pressed === 'true';
  const checked = await controle.getAttribute('aria-checked');
  if (checked !== null) return checked === 'true';
  return controle.isChecked();
}

export async function configurerGrandCalcul(
  page: Page,
  opts: OptionsLancementGrandCalcul = {},
): Promise<void> {
  const panel = zoneGrandCalcul(page);
  await expect(panel).toBeVisible({ timeout: 15_000 });

  if (typeof opts.iterations === 'number') {
    const cible = opts.iterations;
    const champ = panel.getByRole('spinbutton', { name: /trajectoires|itérations|simulations/i }).first();
    const glissiere = panel.getByRole('slider', { name: /trajectoires|itérations|simulations/i }).first();
    const etiquettePreset = new RegExp(
      String(cible).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f]?'),
    );
    const boutonPreset = panel.getByRole('button', { name: etiquettePreset }).first();

    const presetVisible = (await boutonPreset.count()) > 0 && (await boutonPreset.isVisible().catch(() => false));
    const champVisible = (await champ.count()) > 0 && (await champ.isVisible().catch(() => false));
    const glissiereVisible = (await glissiere.count()) > 0 && (await glissiere.isVisible().catch(() => false));
    expect(presetVisible || champVisible || glissiereVisible).toBe(true);

    if (presetVisible) {
      await expect(boutonPreset).toBeEnabled({ timeout: 5_000 });
      await boutonPreset.click();
    } else if (champVisible) {
      await expect(champ).toBeEnabled({ timeout: 5_000 });
      await champ.fill(String(cible));
      await champ.blur();
    } else if (glissiereVisible) {
      await expect(glissiere).toBeEnabled({ timeout: 5_000 });
      await glissiere.fill(String(cible));
    }
  }

  if (typeof opts.regimesMacro === 'boolean') {
    const basculeRegimes = panel.locator('button, input, [role="switch"], [role="checkbox"]').filter({
      hasText: /régimes macro/i,
    }).or(panel.getByRole('checkbox', { name: /régimes macro/i }))
      .or(panel.getByRole('switch', { name: /régimes macro/i }));
    await reglerBascule(basculeRegimes, opts.regimesMacro);
  }

  if (typeof opts.crisesHistoriques === 'boolean') {
    const basculeCrises = panel.locator('button, input, [role="switch"], [role="checkbox"]').filter({
      hasText: /crises historiques/i,
    }).or(panel.getByRole('checkbox', { name: /crises historiques/i }))
      .or(panel.getByRole('switch', { name: /crises historiques/i }));
    await reglerBascule(basculeCrises, opts.crisesHistoriques);
  }
}

export async function lancerGrandCalcul(
  page: Page,
  opts: OptionsLancementGrandCalcul = {},
): Promise<void> {
  await configurerGrandCalcul(page, opts);
  const panel = zoneGrandCalcul(page);
  const btn = boutonLancerGrandCalcul(panel);
  await expect(btn).toBeVisible({ timeout: 10_000 });
  await expect(btn).toBeEnabled({ timeout: 10_000 });
  await btn.click();
}

export async function attendreFinGrandCalcul(page: Page, timeoutMs = 120_000): Promise<void> {
  const panel = zoneGrandCalcul(page);
  const cancel = boutonAnnulerGrandCalcul(panel);
  const progress = barreProgressionGrandCalcul(panel);
  await expect(cancel).toHaveCount(0, { timeout: timeoutMs });
  await expect
    .poll(
      async () => {
        const visible = await progress.isVisible().catch(() => false);
        if (!visible) return true;
        return (await progress.getAttribute('aria-valuenow')) === '100';
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await expect(boutonLancerGrandCalcul(panel)).toBeEnabled({ timeout: 10_000 });
}

export async function lancerGrandCalculEtAttendre(
  page: Page,
  opts: OptionsLancementGrandCalcul = {},
): Promise<void> {
  await lancerGrandCalcul(page, opts);
  await attendreFinGrandCalcul(page, opts.timeoutMs ?? 120_000);
}

export async function toggleModeDiscret(page: Page, enable: boolean): Promise<void> {
  const vp = page.viewportSize();
  const isMobile = (vp?.width ?? 1280) < 1024;
  const targetName = enable ? 'Activer le mode discret' : 'Quitter le mode discret';
  if (isMobile) {
    const plusBtn = page.getByRole('button', { name: "Plus d'options" });
    if ((await plusBtn.getAttribute('aria-expanded')) !== 'true') {
      await plusBtn.click();
    }
    await page.getByRole('button', { name: targetName }).click();
    if ((await plusBtn.getAttribute('aria-expanded')) === 'true') {
      await plusBtn.click();
    }
  } else {
    await page.getByRole('button', { name: targetName }).click();
  }
}

export async function modifierParametresRetraiteDansProfil(
  page: Page,
  modifs: { targetAge?: number; lifeExpectancy?: number },
): Promise<void> {
  await page.goto('/?nogate=1#PROFILE');
  await page.waitForLoadState('domcontentloaded');
  await ecarterLeRail(page);
  const ongletRetraite = page.getByRole('tab', { name: /Retraite et enfants/i });
  await expect(ongletRetraite).toBeVisible({ timeout: 10_000 });
  await ongletRetraite.click();

  if (typeof modifs.targetAge === 'number') {
    const champAge = page.getByLabel('Âge de retraite cible');
    await expect(champAge).toBeVisible({ timeout: 8_000 });
    await champAge.fill(String(modifs.targetAge));
    await champAge.blur();
  }

  if (typeof modifs.lifeExpectancy === 'number') {
    const champVie = page.getByLabel(/Espérance de vie/i);
    await expect(champVie).toBeVisible({ timeout: 8_000 });
    await champVie.fill(String(modifs.lifeExpectancy));
    await champVie.blur();
  }
}

export async function lireLocalStoragePrincipal(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEYS.persistStore);
}

export async function listerBasesIndexedDB(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    if (typeof indexedDB.databases !== 'function') return [];
    const dbs = await indexedDB.databases();
    return dbs.map((d) => d.name).filter((n): n is string => typeof n === 'string');
  });
}

export async function inspecterPayloadIndexedDBGrandCalcul(page: Page): Promise<{
  dbFound: string | null;
  recordCount: number;
  hasPlaintextMonthlySeries: boolean;
}> {
  return page.evaluate(async () => {
    if (typeof indexedDB.databases !== 'function') {
      return { dbFound: null, recordCount: 0, hasPlaintextMonthlySeries: false };
    }
    const dbs = await indexedDB.databases();
    const candidates = dbs
      .map((d) => d.name)
      .filter((n): n is string => typeof n === 'string' && /grand.?calcul/i.test(n));
    const dbName = candidates[0] ?? null;
    if (!dbName) return { dbFound: null, recordCount: 0, hasPlaintextMonthlySeries: false };

    return new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => resolve({ dbFound: dbName, recordCount: 0, hasPlaintextMonthlySeries: false });
      req.onsuccess = () => {
        const db = req.result;
        const stores = Array.from(db.objectStoreNames);
        if (stores.length === 0) {
          db.close();
          resolve({ dbFound: dbName, recordCount: 0, hasPlaintextMonthlySeries: false });
          return;
        }
        const tx = db.transaction(stores[0], 'readonly');
        const store = tx.objectStore(stores[0]);
        const getAllReq = store.getAll();
        getAllReq.onerror = () => {
          db.close();
          resolve({ dbFound: dbName, recordCount: 0, hasPlaintextMonthlySeries: false });
        };
        getAllReq.onsuccess = () => {
          const rows = getAllReq.result ?? [];
          const serialized = JSON.stringify(rows);
          const hasPlaintext = serialized.includes('"p50":') && serialized.includes('"monthIndex":');
          db.close();
          resolve({
            dbFound: dbName,
            recordCount: rows.length,
            hasPlaintextMonthlySeries: hasPlaintext,
          });
        };
      };
    });
  });
}

export async function corrompreEnregistrementGrandCalculIDB(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (typeof indexedDB.databases !== 'function') return false;
    const dbs = await indexedDB.databases();
    const dbName = dbs
      .map((d) => d.name)
      .find((n): n is string => typeof n === 'string' && /grand.?calcul/i.test(n));
    if (!dbName) return false;

    return new Promise((resolve) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => resolve(false);
      req.onsuccess = () => {
        const db = req.result;
        const storeName = db.objectStoreNames[0];
        if (!storeName) {
          db.close();
          resolve(false);
          return;
        }
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const keysReq = store.getAllKeys();
        keysReq.onerror = () => {
          db.close();
          resolve(false);
        };
        keysReq.onsuccess = () => {
          const keys = keysReq.result ?? [];
          if (keys.length === 0) {
            db.close();
            resolve(false);
            return;
          }
          const enregistrement: Record<string, unknown> = {
            payload: 'corrupted',
            encrypted: true,
            iv: 'Y29ycnVwdGVkLWl2',
            ciphertext: 'Y29ycnVwdGVkLWNpcGhlcnRleHQ=',
          };
          if (typeof store.keyPath === 'string') {
            enregistrement[store.keyPath] = keys[0];
            store.put(enregistrement);
          } else if (Array.isArray(store.keyPath) && store.keyPath.length > 0) {
            const valeurs = Array.isArray(keys[0]) ? keys[0] : [keys[0]];
            store.keyPath.forEach((kp, idx) => {
              enregistrement[kp] = valeurs[idx] ?? keys[0];
            });
            store.put(enregistrement);
          } else {
            store.put(enregistrement, keys[0]);
          }
        };
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
      };
    });
  });
}

export async function supprimerClesAppareilIDB(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (typeof indexedDB.databases !== 'function') return false;
    const dbs = await indexedDB.databases();
    const secureDb = dbs
      .map((d) => d.name)
      .find((n): n is string => typeof n === 'string' && /secure|key/i.test(n));
    if (!secureDb) return false;
    return new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(secureDb);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(false);
    });
  });
}

export async function auditerCiblesTactilesConteneur(
  conteneur: Locator,
  minPx = 44,
): Promise<string[]> {
  return conteneur.evaluate((root, min) => {
    const selControls =
      'button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="slider"]';
    const anomalies: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selControls))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.classList.contains('sr-only')) continue;
      if (el.closest('[hidden], [aria-hidden="true"]')) continue;
      if (getComputedStyle(el).visibility === 'hidden') continue;
      if (r.width < min - 0.5 || r.height < min - 0.5) {
        const nom = (el.getAttribute('aria-label') || el.textContent || el.tagName)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40);
        anomalies.push(`${el.tagName.toLowerCase()} « ${nom} » ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return anomalies;
  }, minPx);
}

export async function auditerAbsenceHoverTransform(conteneur: Locator): Promise<void> {
  const classesInterdites = conteneur.locator(
    '[class*="hover:scale-"], [class*="hover:-translate-y-"], [class*="hover:translate-y-"]',
  );
  await expect(classesInterdites).toHaveCount(0);
}

export async function largeurDefilable(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
}

export function extraireNombresCAD(texte: string): number[] {
  const matches = texte.match(/-?\d[\d\s\u00a0\u202f]*(?:[,.]\d+)?\s*\$/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/\$/g, '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n));
}

export function extrairePourcentages(texte: string): number[] {
  const matches = texte.match(/-?\d+(?:[,.]\d+)?\s*%/g) ?? [];
  return matches
    .map((m) => Number(m.replace(/%/g, '').replace(/\s/g, '').replace(',', '.')))
    .filter((n) => Number.isFinite(n));
}

export function extraireAges(texte: string): number[] {
  const matches = texte.match(/\b(\d{2,3})\s*ans\b/gi) ?? [];
  return matches
    .map((m) => Number(m.replace(/ans/i, '').trim()))
    .filter((n) => Number.isFinite(n));
}

export function extraireTauxSurvie(texte: string): number | null {
  const match = texte.match(
    /(?:survie|réussite)[^%\n—]{0,60}?(?:\n[^%\n—]{0,40}?)?(?<![\d.,])([-\u2212]?\d+(?:[,.]\d+)?)\s*%/i,
  );
  if (!match) return null;
  const val = Number(match[1].replace('\u2212', '-').replace(',', '.'));
  return Number.isFinite(val) ? val : null;
}

export function extraireCVaR95(texte: string): number | null {
  const match = texte.match(
    /CVaR(?:\s*95)?[^$\n—]{0,60}?(?:\n[^$\n—]{0,40}?)?(?<![\d.,])([-\u2212]?\d[\d\s\u00a0\u202f]*(?:[,.]\d+)?)\s*\$/i,
  );
  if (!match) return null;
  const val = Number(
    match[1]
      .replace('\u2212', '-')
      .replace(/[\s\u00a0\u202f]/g, '')
      .replace(',', '.'),
  );
  return Number.isFinite(val) ? val : null;
}

export function verifierTexteSansValeursInvalides(texte: string): void {
  expect(texte).not.toMatch(/\bNaN\b/);
  expect(texte).not.toMatch(/\bundefined\b/);
  expect(texte).not.toMatch(/\bInfinity\b/);
  expect(texte).not.toContain('null $');
}

export interface ResultatDepliageExplicationR3 {
  carte: Locator;
  toggle: Locator;
  region: Locator;
  regionTexte: string;
}

/**
 * Attend le montage Suspense du panneau R3, cible la carte demandée (ou la première),
 * vérifie la transition `aria-expanded="false" -> "true"`, la visibilité de `#${regionId}` (`role="region"`),
 * la présence des justifications fiscales ARC/RQ et d'au moins un montant CAD non nul.
 */
export async function deplierEtVerifierExplicationR3(
  page: Page,
  filtreCarte?: RegExp,
): Promise<ResultatDepliageExplicationR3> {
  const exp = zoneExplications(page);
  await expect(exp).toBeVisible({ timeout: 15_000 });
  await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });

  const carte = filtreCarte
    ? exp.locator('ol li article').filter({ hasText: filtreCarte }).first()
    : exp.locator('ol li article').first();
  await expect(carte).toBeVisible({ timeout: 10_000 });

  const toggle = carte.locator('button[aria-expanded]').first();
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  const regionId = await toggle.getAttribute('aria-controls');
  expect(regionId).toBeTruthy();
  const region = page.locator(`#${regionId}`);
  await expect(region).toBeVisible({ timeout: 5_000 });
  await expect(region).toHaveAttribute('role', 'region');

  const regionTexte = await region.innerText();
  verifierTexteSansValeursInvalides(regionTexte);
  expect(regionTexte).toContain('Justifications fiscales (ARC / Revenu Québec)');
  expect(extraireNombresCAD(regionTexte).length).toBeGreaterThan(0);

  return { carte, toggle, region, regionTexte };
}

/**
 * Lit le montant CAD d'une ligne `<th scope="row">` dans la carte R2 « Impôt successoral latent au décès ».
 */
export async function lireLigneSuccessionCAD(
  page: Page,
  blocSuccession: Locator,
  labelRe: RegExp,
): Promise<number> {
  const row = blocSuccession
    .locator('tr')
    .filter({ has: page.locator('th', { hasText: labelRe }) })
    .first();
  await expect(row).toBeVisible();
  const nums = extraireNombresCAD(await row.locator('td').first().innerText());
  expect(nums.length).toBe(1);
  return nums[0];
}

/**
 * Prouve après `page.reload()` que le dernier Grand Calcul a été restauré depuis IndexedDB
 * (avant toute réactivation du mode discret).
 */
export async function verifierRestaurationGrandCalculIDB(
  page: Page,
  iterationsAttendues = 50_000,
): Promise<{ panel: Locator; pred: Locator; exp: Locator }> {
  const panel = zoneGrandCalcul(page);
  const pred = zonePredictions(page);
  const exp = zoneExplications(page);

  const iterPattern = new RegExp(
    `\\b${String(iterationsAttendues).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s\\u00a0\\u202f]?')}\\s+simulations\\b`,
    'i',
  );

  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(barreProgressionGrandCalcul(panel)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Relancer le Grand Calcul', exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel.getByText('Aucun calcul enregistré', { exact: true })).toHaveCount(0);
  expect(await panel.innerText()).toMatch(iterPattern);
  expect(extraireNombresCAD(await panel.innerText()).length).toBeGreaterThan(0);

  await expect(pred).toBeVisible({ timeout: 15_000 });
  await expect(pred.getByText('En attente du Grand Calcul')).toHaveCount(0, { timeout: 10_000 });
  const predTexte = await pred.innerText();
  verifierTexteSansValeursInvalides(predTexte);
  expect(extraireNombresCAD(predTexte).length).toBeGreaterThan(0);

  await expect(exp).toBeVisible({ timeout: 15_000 });
  await expect(exp.locator('button[aria-expanded]').first()).toBeVisible({ timeout: 15_000 });
  const expTexte = await exp.innerText();
  verifierTexteSansValeursInvalides(expTexte);
  expect(extraireNombresCAD(expTexte).length).toBeGreaterThan(0);

  return { panel, pred, exp };
}

/**
 * Vérifie que le mode discret masque tout montant CAD dans les 3 panneaux Grand Calcul
 * tout en affichant `•••` et `Montant masqué` (.sr-only).
 */
export async function verifierModeDiscretGrandCalcul(page: Page): Promise<void> {
  const panel = zoneGrandCalcul(page);
  const pred = zonePredictions(page);
  const exp = zoneExplications(page);

  expect(extraireNombresCAD(await pred.innerText())).toEqual([]);
  expect(extraireNombresCAD(await exp.innerText())).toEqual([]);
  expect(extraireNombresCAD(await panel.innerText())).toEqual([]);

  await expect(pred.getByText('•••').first()).toBeVisible();
  await expect(pred.getByText('Montant masqué').first()).toBeAttached();
  await expect(exp.getByText('•••').first()).toBeVisible();
  await expect(exp.getByText('Montant masqué').first()).toBeAttached();
}
