// tests/assistant/couvertureStore.test.ts
//
// [ASSISTANT-COUVERTURE] Toute donnée PERSISTÉE du store doit être pilotable par l'assistant :
// au moins une action de LECTURE et une action d'ÉCRITURE du registre (`services/assistant/
// actionRegistry.ts`) la déclarent dans `tranches` — sauf exclusion motivée dans
// `TRANCHES_EXCLUES` (`services/assistant/tranches.ts` : secrets, état d'interface éphémère, mode
// test, provenance FX, données de synchronisation).
//
// Les clés sont MESURÉES, pas recopiées : (1) celles que la persistance écrit réellement
// (`extrairePersistable` sur l'état vivant), (2) les défauts canoniques (`buildDefaultAppState`),
// (3) les clés déclarées dans l'interface `AppState` de `types.ts` (les champs facultatifs absents
// des défauts). Ajouter un champ au store sans action rougit ici — marche à suivre : docs/ASSISTANT.md.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { useFinanceStore } from '../../store/useFinanceStore';
import { extrairePersistable } from '../../store/optionsPersistance';
import { buildDefaultAppState } from '../../services/aiTools/appStateDefaults';
import { ACTIONS, declarationsOutils } from '../../services/assistant/actionRegistry';
import { TRANCHES, TRANCHES_EXCLUES } from '../../services/assistant/tranches';

function clesInterfaceAppState(): string[] {
    const src = readFileSync('types.ts', 'utf8');
    const debut = src.indexOf('export interface AppState {');
    expect(debut, 'interface AppState introuvable dans types.ts').toBeGreaterThan(-1);
    const fin = src.indexOf('\n}', debut);
    const corps = src.slice(debut, fin);
    return [...corps.matchAll(/^ {2}([a-zA-Z_][a-zA-Z0-9_]*)\??:/gm)].map((m) => m[1]);
}

function clesPersistees(): string[] {
    const persistables = extrairePersistable(useFinanceStore.getState());
    const vivantes = Object.entries(persistables).filter(([, v]) => typeof v !== 'function').map(([k]) => k);
    return [...new Set([...vivantes, ...Object.keys(buildDefaultAppState()), ...clesInterfaceAppState()])].sort();
}

describe('[ASSISTANT-COUVERTURE] chaque tranche persistée du store est pilotable par l\'assistant', () => {
    const cles = clesPersistees();

    it('anti-vacuité : le recensement voit les tranches attendues', () => {
        expect(cles.length).toBeGreaterThanOrEqual(40);
        for (const temoin of ['assets', 'transactions', 'budgetItems', 'debts', 'realEstateGoals', 'config', 'retirementGoal', 'subscriptions', 'categorizationRules']) {
            expect(cles).toContain(temoin);
        }
    });

    it('toute clé persistée non exclue a une action de lecture ET une action d\'écriture', () => {
        const manquantes: string[] = [];
        for (const cle of cles) {
            if (cle in TRANCHES_EXCLUES) continue;
            const lecture = ACTIONS.some((a) => a.type === 'lecture' && a.tranches.includes(cle));
            const ecriture = ACTIONS.some((a) => a.type === 'ecriture' && a.tranches.includes(cle));
            if (!lecture || !ecriture) manquantes.push(`${cle} (lecture: ${lecture}, écriture: ${ecriture})`);
        }
        expect(manquantes, `Tranche(s) sans action — ajoute-la à services/assistant/tranches.ts (voir docs/ASSISTANT.md) :\n${manquantes.join('\n')}`).toEqual([]);
    });

    it('les exclusions sont motivées et désignent des clés qui existent encore', () => {
        for (const [cle, raison] of Object.entries(TRANCHES_EXCLUES)) {
            expect(raison.length, `exclusion sans raison : ${cle}`).toBeGreaterThan(5);
            expect(cles, `exclusion fantôme (la clé n'existe plus) : ${cle}`).toContain(cle);
        }
        expect(TRANCHES_EXCLUES).toHaveProperty('apiKeys');
    });

    it('aucune tranche déclarée n\'est aussi exclue, et chaque collection a ses quatre actions', () => {
        for (const t of TRANCHES) {
            expect(TRANCHES_EXCLUES, `${String(t.cle)} est à la fois déclarée et exclue`).not.toHaveProperty(String(t.cle));
            if (t.genre !== 'objet') {
                for (const verbe of ['lister', 'ajouter', 'modifier', 'supprimer']) {
                    const nom = `${verbe}_${verbe === 'lister' ? t.pluriel : t.singulier}`;
                    expect(ACTIONS.some((a) => a.nom === nom), `action manquante : ${nom}`).toBe(true);
                }
            }
        }
    });

    it('aucune action n\'expose ni n\'écrit apiKeys', () => {
        for (const a of ACTIONS) expect(a.tranches).not.toContain('apiKeys');
        const json = JSON.stringify(declarationsOutils());
        expect(json).not.toMatch(/apiKeys/);
    });

    it('les actions génériques et d\'application demandées existent', () => {
        for (const nom of ['naviguer_vers_onglet', 'lancer_projection', 'afficher_bloc', 'lister_placements', 'ajouter_dette', 'modifier_poste_budget', 'supprimer_transaction', 'modifier_objectif_retraite', 'modifier_configuration_menage']) {
            expect(ACTIONS.some((a) => a.nom === nom), nom).toBe(true);
        }
    });

    it('les déclarations envoyées au modèle sont des objets inline (sans $ref ni méta)', () => {
        const decl = declarationsOutils();
        expect(decl.length).toBe(ACTIONS.length);
        // [À vérifier] plafond de déclarations côté API : on reste sous 128 pour garder une marge.
        expect(decl.length).toBeLessThanOrEqual(128);
        for (const d of decl) {
            expect(d.parametersJsonSchema.type, d.name).toBe('object');
            expect(JSON.stringify(d.parametersJsonSchema), d.name).not.toMatch(/"\$ref"|"\$defs"|"\$schema"/);
        }
    });
});
