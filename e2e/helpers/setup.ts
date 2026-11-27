/**
 * Helpers partagés entre les tests E2E FinanceAI.
 *
 * bypass_onboarding  — pose le flag localStorage qui saute l'écran de bienvenue.
 * activate_test_mode — injecte les fixtures dans `localStorage['financeai-storage']` (sans mode test prod).
 */
import { type Page } from '@playwright/test';
// ⚠️ Le script est INJECTÉ comme source dans la page : il ne peut pas importer le registre, il
// l'INTERPOLE. C'est la seule forme possible ici, et elle garde la source unique.
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { DEFAULT_PERSONA_ID, getPersonaOrDefault } from '../../tests/fixtures/testFixtures';
import { isPersonaArtifactId } from '../../services/migrations/personaArtifactIds';

/**
 * Bypass l'onboarding et le portail FirebaseAuthGate en injectant les flags
 * localStorage / sessionStorage avant le chargement de la page.
 * À appeler via page.addInitScript() avant page.goto().
 */
export function scriptBypassOnboarding(): string {
  return `
    try {
      localStorage.setItem('${STORAGE_KEYS.onboardingDone}', 'true');
    } catch (e) {
      // localStorage indisponible — ne bloque pas le test
    }
    try {
      sessionStorage.setItem('financeai:offline_bypass', '1');
    } catch (e) {
      // sessionStorage indisponible — ne bloque pas le test
    }
  `;
}

/**
 * Éloigne le pointeur du rail de navigation AVANT toute interaction.
 *
 * ⚠️ LA SOURIS DE PLAYWRIGHT DÉMARRE EN (0,0) — c'est-à-dire SUR le rail. Celui-ci s'ouvre au
 * survol (`isSidebarOpen = (hovered || focused) && !dismissed`, `components/Layout.tsx`) et, par
 * décision assumée (« l'expansion overlay le contenu sans push, pas de jump »), il RECOUVRE les
 * 288 px de gauche (`w-72`) alors que le contenu ne commence qu'à 64 px (`md:ml-16`). Tout
 * contrôle situé dans cette bande devient donc inatteignable au clic tant que le pointeur n'a
 * pas bougé : Playwright réessaie pendant 30 s en répétant « subtree intercepts pointer events »,
 * puis le test expire.
 *
 * Ce n'est PAS le contournement d'un défaut de l'app : un humain qui survole le rail le voit
 * s'ouvrir et déplace sa souris. Ce que le helper reproduit, c'est ce geste-là.
 *
 * MESURÉ le 2026-09-21 sur `main` (4f1466b4), sans aucun changement applicatif :
 * `futureAxis.spec.ts` échoue 3 fois sur 3 (30 s chacune) avec le pointeur en (0,0), et passe
 * une fois le pointeur écarté. Le même mécanisme faisait expirer le job E2E de la CI à son
 * plafond de 30 minutes. Suite complète : 18 tests traités en 29 min et TOUS en échec avant,
 * **52 passés / 2 échoués en 7,4 min** après — les 2 restants étant le MÊME défaut dans un
 * spec qui ne passe pas par `activateTestMode` (d'où l'export).
 *
 * ⚠️ RÈGLE, et c'est pour ça qu'il est EXPORTÉ : tout spec qui clique un contrôle situé dans
 * les 288 px de gauche APRÈS un `goto` doit l'appeler d'abord. Le premier clic d'une page
 * neuve est toujours concerné, puisque le pointeur n'a pas encore bougé de (0,0).
 */
export async function ecarterLeRail(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  await page.mouse.move(vp.width - 5, Math.floor(vp.height / 2));
}

const TRANCHES_LISTES_AVEC_ID = [
  'transactions',
  'assets',
  'investmentTransactions',
  'investmentAccounts',
  'budgetItems',
  'realEstateGoals',
  'childGoals',
  'debts',
  'travelGoals',
  'lifeEvents',
  'financialGoals',
  'categorizationRules',
  'insurancePolicies',
  'rentalProperties',
  'privateBusinesses',
  'vehicleReplacements',
  'majorRenovations',
  'charitableGoals',
  'documents',
] as const;

const TRANCHES_OBJETS_AVEC_ID = ['childGoal', 'weddingGoal'] as const;

function reecrireIdSiArtefact(item: unknown): unknown {
  if (!item || typeof item !== 'object') return item;
  const obj = item as Record<string, unknown>;
  if (typeof obj.id === 'string' && isPersonaArtifactId(obj.id)) {
    return { ...obj, id: `e2e-${obj.id}` };
  }
  return obj;
}

function decalerDateIso(iso: string, deltaMs: number): string {
  const parsed = Date.parse(`${iso}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return iso;
  return new Date(parsed + deltaMs).toISOString().slice(0, 10);
}

/**
 * Normalise une fixture persona pour l'injection directe dans `localStorage['financeai-storage']` :
 * - préfixe `'e2e-'` sur les IDs d'artefacts (évite `purgePersonaArtifacts()` au boot) ;
 * - retire `(test)` des noms utilisateurs (évite `isTestPersonaState`) ;
 * - aligne les dates/horodatages sur l'horloge du navigateur (`browserNowMs`, utile si un spec
 *   fige `window.Date` avant `activateTestMode`, ex. `futureAncreAujourdhui.spec.ts`) et
 *   estampille `assets` (`lastHistorySync` / `priceUpdatedAt`) et `fxRates` pour éviter
 *   tout fetch `/api/history/yahoo` (404 sous `vite preview`) ou mutation en cours de spec.
 */
function normaliserPourE2e(
  rawFixture: Record<string, unknown>,
  browserNowMs: number = Date.now(),
): Record<string, unknown> {
  const nodeNowMs = Date.now();
  const deltaMs = browserNowMs - nodeNowMs;
  const shiftDates = Math.abs(deltaMs) > 60_000;
  const clone = structuredClone(rawFixture);

  for (const key of TRANCHES_LISTES_AVEC_ID) {
    if (Array.isArray(clone[key])) {
      clone[key] = (clone[key] as unknown[]).map(reecrireIdSiArtefact);
    }
  }
  for (const key of TRANCHES_OBJETS_AVEC_ID) {
    if (clone[key] && typeof clone[key] === 'object') {
      clone[key] = reecrireIdSiArtefact(clone[key]);
    }
  }

  if (shiftDates && Array.isArray(clone.transactions)) {
    clone.transactions = (clone.transactions as Array<Record<string, unknown>>).map((t) =>
      typeof t.date === 'string' ? { ...t, date: decalerDateIso(t.date, deltaMs) } : t,
    );
  }

  if (clone.config && typeof clone.config === 'object') {
    const cfg = clone.config as Record<string, unknown>;
    if (Array.isArray(cfg.users)) {
      cfg.users = (cfg.users as Array<Record<string, unknown>>).map((u) =>
        typeof u.name === 'string'
          ? { ...u, name: u.name.replace(/\s*\(test\)/gi, '').trim() }
          : u,
      );
    }
  }

  if (Array.isArray(clone.assets)) {
    clone.assets = (clone.assets as Array<Record<string, unknown>>).map((a) => ({
      ...a,
      ...(shiftDates && Array.isArray(a.priceHistory)
        ? {
            priceHistory: (a.priceHistory as Array<Record<string, unknown>>).map((p) =>
              typeof p.date === 'string' ? { ...p, date: decalerDateIso(p.date, deltaMs) } : p,
            ),
          }
        : {}),
      lastHistorySync: browserNowMs,
      priceUpdatedAt: browserNowMs,
    }));
  }

  clone.lastUpdate = browserNowMs;
  clone.fxRates = { USD: 1.37, EUR: 1.47, CAD: 1, lastFetched: browserNowMs };
  clone.fxRatesEstimated = false;
  clone.fxRatesSource = 'manuel';

  return clone;
}

/**
 * Injecte en one-shot les fixtures d'un persona dans `localStorage['financeai-storage']`
 * (format persisté v7) sans instance React active, puis ouvre l'URL cible.
 * Aucun `addInitScript` permanent : les éditions faites pendant le test (`T2-04`/`T2-05`)
 * survivent à `page.reload()`.
 */
export async function activateTestMode(
  page: Page,
  personaId: string = DEFAULT_PERSONA_ID,
): Promise<void> {
  // Neutralise les requêtes réseau du proxy Yahoo pendant les tests E2E sur fixtures
  // (évite les 404/429 console et toute dérive des prix/historiques injectés sous vite preview).
  await page.route(/\/api\/(?:history|search)\/yahoo/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        chart: { result: [{ meta: {}, timestamp: [], indicators: { quote: [{ close: [] }] } }], error: null },
        quotes: [],
      }),
    }),
  );

  // Neutralise également les appels directs CoinGecko pendant les tests E2E sur fixtures
  // (évite les blocages CORS 429 en rafales lors des reloads multiples).
  await page.route(/^https:\/\/api\.coingecko\.com\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    }),
  );

  // Sous `vite preview` (sans serveur Express /api/*), évite les 404 console sur les flux actualités/marché
  // lors des projections profondes tout en laissant passer un vrai backend s'il est actif.
  await page.route(/\/api\/(?:news\/intelligence|market\/verified-feed)/, async (route) => {
    try {
      const response = await route.fetch();
      const ct = response.headers()['content-type'] ?? '';
      if (response.status() === 404 || response.status() === 405 || ct.includes('text/html')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ok: false, offlineFallback: true, articles: [], quotes: [] }),
        });
        return;
      }
      await route.fulfill({ response });
    } catch {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, offlineFallback: true, articles: [], quotes: [] }),
      });
    }
  });

  const currentUrl = page.url();
  let isAppHttpPage = false;
  let isStaticIconPage = false;
  try {
    if (/^https?:\/\//i.test(currentUrl)) {
      const parsed = new URL(currentUrl);
      isStaticIconPage = parsed.pathname.endsWith('/icon.svg');
      isAppHttpPage = !isStaticIconPage;
    }
  } catch {
    isAppHttpPage = false;
    isStaticIconPage = false;
  }

  const targetUrl = isAppHttpPage ? currentUrl : '/?nogate=1';
  let browserNowMs = isAppHttpPage
    ? await page.evaluate(() => Date.now()).catch(() => Date.now())
    : Date.now();

  // Démonter toute instance React active en naviguant vers une ressource statique même-origine
  // sans <script> (`/icon.svg`) avant de nettoyer IndexedDB et d'écrire `localStorage`.
  // Élimine la course où les effets de montage de `App.tsx` écrasent `localStorage` avant reload().
  if (!isStaticIconPage) {
    await page.goto('/icon.svg', { waitUntil: 'domcontentloaded' });
  }

  if (!isAppHttpPage) {
    browserNowMs = await page.evaluate(() => Date.now()).catch(() => Date.now());
  }

  const persona = getPersonaOrDefault(personaId);
  const normalized = normaliserPourE2e(
    persona.build() as unknown as Record<string, unknown>,
    browserNowMs,
  );
  const payload = JSON.stringify({ state: normalized, version: 7 });

  await page.evaluate(
    async ({ persistKey, onboardingKey, jsonPayload }) => {
      await new Promise<void>((resolve) => {
        if (typeof indexedDB === 'undefined') {
          resolve();
          return;
        }
        let settled = false;
        const done = () => {
          if (!settled) {
            settled = true;
            resolve();
          }
        };
        const timer = setTimeout(done, 1500);
        try {
          const req = indexedDB.deleteDatabase('financeai-unlimited-state');
          req.onsuccess = () => {
            clearTimeout(timer);
            done();
          };
          req.onerror = () => {
            clearTimeout(timer);
            done();
          };
          req.onblocked = () => {
            setTimeout(() => {
              clearTimeout(timer);
              done();
            }, 300);
          };
        } catch {
          clearTimeout(timer);
          done();
        }
      });

      try {
        localStorage.removeItem('financeai:idb_overflow:v1');
        localStorage.removeItem('financeai:idb_partial_mirror:v1');
        localStorage.removeItem('financeai:protected_dossier:v1');
        localStorage.setItem(onboardingKey, 'true');
        localStorage.setItem(persistKey, jsonPayload);
      } catch {
        // localStorage indisponible
      }
      try {
        sessionStorage.setItem('financeai:offline_bypass', '1');
      } catch {
        // sessionStorage indisponible
      }
    },
    {
      persistKey: STORAGE_KEYS.persistStore,
      onboardingKey: STORAGE_KEYS.onboardingDone,
      jsonPayload: payload,
    },
  );

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#main').waitFor({ state: 'visible', timeout: 15_000 });
  await ecarterLeRail(page);
  await fermerLesNotifications(page);
}

/**
 * [E2E-FUTUR-CLICK-ANYWHERE-RECIDIVE] Ferme les notifications (toasts) encore affichées.
 */
async function fermerLesNotifications(page: Page): Promise<void> {
  const zone = page.getByRole('region', { name: 'Notifications' });
  const toasts = zone.locator('[role="status"], [role="alert"]');
  await toasts.first().waitFor({ state: 'visible', timeout: 500 }).catch(() => {});
  const fermer = zone.getByRole('button', { name: 'Fermer la notification' });
  for (let i = 0; i < 5 && (await fermer.count()) > 0; i++) {
    await fermer.first().click({ timeout: 1_000 }).catch(() => {});
  }
  await toasts.first().waitFor({ state: 'detached', timeout: 6_000 }).catch(() => {});
}
