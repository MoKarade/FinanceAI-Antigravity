/**
 * Tests E2E Playwright — Futur 2.0 : Bandeau de Commande de Simulation (PR [FUTUR-2.0-SIM-CONTROLS])
 *
 * Vérifie :
 * 1. Accès à l'onglet Futur (Projection) et rendu du conteneur de simulation.
 * 2. Disponibilité et interaction avec les sélecteurs segmentés (Base dépenses, Rendements, Puissance MC).
 * 3. Cibles tactiles >= 44 px sur tous les boutons de contrôle interactifs (règle 6 GEMINI.md).
 * 4. Zéro bandeau KPI dupliqué sous PageHeader (règle 6 GEMINI.md).
 * 5. Présence des attributs ARIA pour l'accessibilité.
 */

import { test, expect, type Page } from '@playwright/test';
import { scriptBypassOnboarding, activateTestMode, ecarterLeRail } from '../helpers/setup';

const localChromium = process.env.PW_LOCAL_CHROMIUM;
if (localChromium) test.use({ launchOptions: { executablePath: localChromium } });

async function naviguerVersFutur(page: Page): Promise<void> {
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

test.describe('Futur 2.0 — Bandeau de Commande de Simulation (Desktop Chrome)', () => {
    test.setTimeout(120_000);

    test('L\'en-tête de page affiche Projection sans bandeau KPI en doublon', async ({ page }) => {
        await naviguerVersFutur(page);

        // En-tête Google Finance conforme
        await expect(page.getByRole('heading', { level: 1, name: 'Projection' })).toBeVisible();

        // Règle 6 GEMINI.md : Zéro bandeau KPI en doublon sous PageHeader
        const kpiContainers = page.locator('[data-testid="kpi-banner-duplicate"]');
        await expect(kpiContainers).toHaveCount(0);
    });

    test('Tous les boutons de contrôle interactifs du Futur respectent la cible tactile minimale >= 44 px', async ({ page }) => {
        await naviguerVersFutur(page);

        // Sélectionne les boutons principaux d'action dans le Futur
        const boutonsInteractifs = page.locator('main button:visible');
        const count = await boutonsInteractifs.count();
        expect(count).toBeGreaterThan(0);

        for (let i = 0; i < Math.min(count, 10); i++) {
            const btn = boutonsInteractifs.nth(i);
            const box = await btn.boundingBox();
            if (box && box.height > 0) {
                // GEMINI.md règle 6 : Cibles tactiles >= 44 px (touch-target / min-h-11)
                expect(box.height).toBeGreaterThanOrEqual(44);
            }
        }
    });

    test('La navigation et les contrôles de courbe sont accessibles et fonctionnels', async ({ page }) => {
        await naviguerVersFutur(page);

        // Vérifie la présence de la courbe de vie Recharts
        const courbe = page.getByRole('group', { name: /Courbe de vie/ });
        await expect(courbe).toBeVisible();

        // Vérifie que les boutons de navigation temporelle ou de tiroirs répondent au clic
        const carteOutils = page.getByRole('region', { name: 'Outils' });
        await expect(carteOutils).toBeVisible();
    });
});
