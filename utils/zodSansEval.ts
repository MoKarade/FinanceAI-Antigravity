// utils/zodSansEval.ts
//
// [S5-ZOD4-CSP] zod 4 compile ses validateurs d'objets avec `new Function` (JIT), après avoir TESTÉ si
// eval est permis. Notre CSP interdit eval (pas de 'unsafe-eval', index.html + vercel.json) : le test
// lui-même est une violation CSP que le navigateur journalise, même si zod l'attrape. Mesuré le 24/09/2026
// (PR #1055) : Lighthouse « bonnes pratiques » 0,96 au lieu de 1 (audit inspector-issues, « Content
// security policy »), budget bloquant. `jitless` coupe le JIT ET le test (zod/v4/core/util.js, allowsEval).
// Importé EN PREMIER par index.tsx, avant tout schéma. `zod/v4/core` et non `zod` : l'entrée ne tire que
// la configuration, pas toute la bibliothèque (chargée à la demande par les écrans qui s'en servent).
import { config } from 'zod/v4/core';

config({ jitless: true });

// [CSP-VITE-REACT-REFRESH] La CSP stricte d'index.html (script-src 'self', sans 'unsafe-inline')
// bloque le préambule inline injecté par @vitejs/plugin-react en mode développement. Initialiser
// les crochets sur window ici (premier module exécuté avant tout composant .tsx) empêche l'erreur
// "@vitejs/plugin-react can't detect preamble. Something is wrong." qui bloquait le rendu initial.
if (typeof window !== 'undefined') {
    const win = window as unknown as {
        $RefreshReg$?: (type?: unknown, id?: string) => void;
        $RefreshSig$?: () => <T>(type: T) => T;
        __vite_plugin_react_preamble_installed__?: boolean;
    };
    if (typeof win.$RefreshReg$ !== 'function') {
        win.$RefreshReg$ = () => {};
    }
    if (typeof win.$RefreshSig$ !== 'function') {
        win.$RefreshSig$ = () => (type) => type;
    }
    win.__vite_plugin_react_preamble_installed__ = true;
}

