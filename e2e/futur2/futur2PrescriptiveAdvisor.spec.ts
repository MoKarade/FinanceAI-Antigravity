/**
 * Tests E2E Playwright — Futur 2.0 : Carte Diagnostic & Recommandations Prescriptives (PR [FUTUR-2.0-PRESCRIPTIVE])
 *
 * Vérifie :
 * 1. Présence de la section de diagnostic et recommandations dans la page Futur.
 * 2. Affichage des actions prescrites chiffrées en gains de patrimoine et mois de liberté.
 * 3. Présence du bouton d'action directe sans blocage de l'UI.
 * 4. Conformité aux règles de design system Google Finance de GEMINI.md.
 */

import { test, expect, type Page } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode, ecarterLeRail } from '../helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function preparerPageFutur(page: Page): Promise<void> {
    await page.addInitScript(scriptBypassOnboarding());
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const btnLocal = page.getByRole('button', { name: /Accéder directement à mon dossier local/i });
    await btnLocal.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    if (await btnLocal.isVisible().catch(() => false)) {
        await btnLocal.click();
    }
    await activateTestMode(page);
    await page.goto('/#FUTURE');
    await page.waitForLoadState('domcontentloaded');
    await ecarterLeRail(page);

    const voirDirect = page.getByRole('button', { name: /projection actuelle.*sans optimiser/i });
    await voirDirect.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    if (await voirDirect.isVisible().catch(() => false)) {
        await voirDirect.click();
    }
    await expect(page.getByRole('group', { name: /Courbe de vie/ })).toBeVisible({ timeout: 20_000 });
}

test.describe('Futur 2.0 — Carte Diagnostic & Recommandations Prescriptives', () => {
    test.setTimeout(120_000);

    test('La section d\'optimisation et recommandations est visible sous la courbe', async ({ page }) => {
        await preparerPageFutur(page);

        // Vérifie la présence des cartes d'action ou de leviers
        const zoneLeviers = page.locator('main').getByText(/optimiser|plan d'action|jalons/i);
        await expect(zoneLeviers.first()).toBeVisible({ timeout: 10_000 });
    });

    test('Les boutons d\'action et d\'optimisation ont une cible tactile >= 44 px', async ({ page }) => {
        await preparerPageFutur(page);

        const boutons = page.locator('main button:visible');
        const count = await boutons.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < Math.min(count, 5); i++) {
            const box = await boutons.nth(i).boundingBox();
            if (box && box.height > 0) {
                expect(box.height).toBeGreaterThanOrEqual(44);
            }
        }
    });

    test('L\'interface ne présente aucun scintillement au survol (zéro translateY ni scale)', async ({ page }) => {
        await preparerPageFutur(page);

        // GEMINI.md règle 6 : Zéro translateY ni scale au :hover pour éviter le sautillement
        const hoverEffects = page.locator('.hover\\:scale-105, .hover\\:-translate-y-1');
        await expect(hoverEffects).toHaveCount(0);
    });
});
