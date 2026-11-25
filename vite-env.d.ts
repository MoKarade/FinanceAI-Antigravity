/// <reference types="vite/client" />

// Variables d'env exposées au front (préfixe VITE_).
// VITE_AUDIT_HORS_RESEAU=1 (LIGHTHOUSE-HORS-RESEAU) coupe l'appel à la Banque du Canada : posé par le seul
// workflow `lighthouse.yml`, pour que l'audit ne dépende d'aucun service tiers (`services/finance.ts`).
interface ImportMetaEnv {
    readonly VITE_AUDIT_HORS_RESEAU?: string;
}
interface ImportMeta {
    readonly env: ImportMetaEnv;
}

// Phase A.4 — version exacte, injectée par Vite define au build.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_DATE__: string;

// Support Vite ?raw imports pour CSV bundlés (mode test).
declare module '*.csv?raw' {
    const content: string;
    export default content;
}

