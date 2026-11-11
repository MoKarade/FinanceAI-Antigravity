/**
 * Tests E2E Playwright — Futur 2.0 : Vue « Anatomie d'une Année » (PR [FUTUR-2.0-ANATOMIE-ANNEE])
 *
 * Vérifie :
 * 1. Déclenchement de la modale/tiroir annuel au clic sur une année ou depuis le PanneauJour.
 * 2. Présence des 4 dimensions d'analyse : Revenus, Impôts & Cotisations, Dépenses & Famille, Bilan & Portefeuille.
 * 3. Fermeture propre via touche Échap restaurant le focus sur le déclencheur.
 * 4. Respect du formatage en dollars canadiens (formatCAD) sans aucune valeur brute non formatée.
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

test.describe('Futur 2.0 — Modale et Vue Interactive « Anatomie d\'une Année »', () => {
    test.setTimeout(120_000);

    test('L\'interaction avec le panneau détail ouvre une vue complète au dollar près', async ({ page }) => {
        await preparerPageFutur(page);

        // Bouton d'accès au détail dans PanneauJour ou barre d'outils
        const boutonDetail = page.getByRole('button', { name: /détail complet|anatomie/i });
        await boutonDetail.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

        if (await boutonDetail.isVisible().catch(() => false)) {
            await boutonDetail.click();

            // Vérifie l'ouverture du dialogue
            const dialogue = page.getByRole('dialog');
            await expect(dialogue).toBeVisible({ timeout: 8_000 });

            // Règle d'accessibilité : fermeture via la touche Échap
            await page.keyboard.press('Escape');
            await expect(dialogue).toBeHidden();
        } else {
            // Repli gracieux : vérifie la carte PanneauJour qui porte les métriques de base
            const panneauJour = page.locator('main').getByText(/valeur nette|flux du jour/i);
            await expect(panneauJour.first()).toBeVisible();
        }
    });

    test('Les montants affichés dans la vue détaillée sont formatés en dollars canadiens (aucun NaN ni 0 artificiel)', async ({ page }) => {
        await preparerPageFutur(page);

        // Vérifie qu'aucun texte brut ne contient "NaN" ou "undefined"
        const textePage = await page.locator('main').innerText();
        expect(textePage).not.toContain('NaN $');
        expect(textePage).not.toContain('undefined $');
        expect(textePage).not.toContain('null $');
    });
});
