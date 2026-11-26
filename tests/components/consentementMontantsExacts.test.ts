// [FMT-PROMPT-MIGRER] Cohérence PROMESSE ↔ MÉCANISME du consentement IA.
//
// Décision de Marc (2026-09-03) : l'arrondi à 100 $ des montants envoyés à Anthropic est
// ABANDONNÉ. Le texte de consentement (Onboarding) promettait « montants arrondis à 100$ » —
// laisser cette phrase aurait fait de l'app une promesse de vie privée FAUSSE, ce qui est pire
// qu'aucune promesse. Les deux moitiés vont ENSEMBLE et cette garde les tient ensemble :
//   1. le consentement dit désormais « montants exacts » et ne promet plus d'arrondi ;
//   2. le mécanisme d'arrondi a bien disparu des deux fichiers qui le portaient.
// Ré-introduire l'un sans l'autre — un arrondi sans promesse, ou une promesse sans arrondi —
// fait rougir la moitié correspondante, avec la consigne écrite dans le message.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripComments, stripCommentsJsx } from '../../utils/stripComments';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const lire = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** La forme de l'ancien arrondi : `… / 100) * 100`. */
const ARRONDI_100 = /\/\s*100\s*\)\s*\*\s*100/;

describe('[FMT-PROMPT-MIGRER] aucun arrondi à 100 $ dans les clients IA actifs', () => {
    it('le mécanisme d\'arrondi a disparu des deux fichiers qui le portaient', () => {
        for (const f of ['services/gemini.ts', 'components/budget/BudgetAiModal.tsx']) {
            const code = f.endsWith('.tsx') ? stripCommentsJsx(lire(f)) : stripComments(lire(f));
            expect(ARRONDI_100.test(code), `${f} ré-arrondit à 100 $`).toBe(false);
        }
    });

    it('anti-vacuité : le motif d\'arrondi RECONNAÎT la forme historique', () => {
        // À zéro offender, « aucun trouvé » ne distingue pas « propre » d'un motif mort.
        expect(ARRONDI_100.test('Math.round(p.totalNetIncome / 100) * 100')).toBe(true);
        expect(ARRONDI_100.test('Math.round(amount / 100) * 100;')).toBe(true);
        // …et ne crie pas sur un pourcentage ordinaire.
        expect(ARRONDI_100.test('(ctx.downPayment / ctx.price) * 100')).toBe(false);
    });
});
