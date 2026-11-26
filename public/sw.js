// P2.9 PWA — service worker minimal.
//
// Stratégie :
//   * cache-first sur /assets/* (chunks hashés, immutable — safe)
//   * network-first sur tout le reste (index.html, manifest.json, etc.)
//   * skipWaiting + clientsClaim → mise à jour aggressive au prochain reload
//
// Compatible avec lazyWithRetry (P1.4) : on ne cache JAMAIS index.html
// avec un TTL long ; les chunks 404 ne peuvent donc pas survivre en cache.
//
// Note : ce SW est uniquement chargé en PROD (vite import.meta.env.PROD).

const CACHE_NAME = 'financeai-v46'; // v46 : Étape 4 menu ultra-court (6 écrans essentiels + espace Planification), Réglages épurés aux 4 besoins, Placements recentré sur les gains, interface solo par défaut ; v45 : Étape 3 architecture modulaire (unification socle Gemini, découpage AccueilGoogle et Placements, 0 warning ESLint et nettoyage exports) ; v44 : Étape 2 vitesse et démarrage instantané (coupure fuite 450 Ko au boot, retrait i18next et framer-motion cœur, préchargement mobile doux, Accueil fenêtré) ; v43 : Étape 1 sécurité, grand ménage et nettoyage bundle ; v42 : Visibilité et continuité des courbes Monte Carlo P10/P50/P90 sur Futur et Accueil (raccord dès le mois courant, bouton et légende dédiés, préréglage 2025→ sur Accueil) ; v41 : Monte Carlo calibré sur les courbes réelles depuis janvier 2025 (rendement TWR, volatilité, creux maximal, courbe passée raccordée au cône 10k et vue 2025→ dans Futur) ; v40 : Suppression du flash de mauvaise somme à l'ouverture (compaction miroir sans perte de soldes, garde anti-écrasement IDB, réhydratation IDB & FX synchrone, attente propre de la synchronisation Cloud Firestore avant premier affichage et jalons Accueil honnêtes) ; v39 : Refonte complète du classement automatique (règles perso unifiées sur Fintable/CSV/UI, dictionnaire QC/CA enrichi, retours/crédits en Remboursement, Interac, marchands mixtes, alignement postes du budget, demande de règle permanente à la correction, IA contextuelle groupée en arrière-plan et reclassement historique réversible) ; v38 : Courbe Accueil expressive et interactive (1A par défaut, cadrage Y dynamique, jonction continue Présent→Futur), réparation clé API Google Gemini + bouton Tester la clé, sync auto Fintable fiable et retrait des alertes de mauvais sync ; v37 : Placements simplifiés (2 onglets + Outils experts) et Comité Multi-Agents 5 spécialistes (Placements + LIA global, support actions & sociétés privées non cotées ex. Anthropic, historique chiffré IndexedDB) ; v36 : Futur 4.0 — 4 scénarios unifiés, simulation profonde 100k+ Web Workers, audit passé réel + actualités, infobulle intégrée FutureRichTooltip et mémoire chiffrée IndexedDB ; v35 : affichage Monte Carlo enrichi et consolidation des contrôles Futur ; v34 : consolidation UI, grilles pleine largeur et correction des débordements Desktop/Mobile ; v33 : fusion Placements, moteur Futur 7 Agents multi-horizon et durcissement anti-cache HTML sur /assets/* ; v32 : Valoria intégration profonde (signaux Placements/Accueil, modal confirmation CELI/REER, pont Futur/Retraite, assistant Gemini + Ctrl+K) ; v31 : Valoria Quant IA 100 %
const PRECACHE_URLS = ['/manifest.json', '/icon.svg'];

// [CF-ACCESS] Une réponse mettable en cache doit être une réponse DIRECTE de notre origine : ni redirigée (session
// Access expirée = 302 vers la page de connexion Cloudflare, dont le HTML en 200 serait sinon mémorisé À LA PLACE de
// l'app — le bug de juin 2026), ni opaque, ni d'un autre type que « basic ».
function cacheable(res) {
    return !!res && res.status === 200 && res.type === 'basic' && !res.redirected;
}

// P2.9 fix : précache individuel (vs cache.addAll qui échoue all-or-nothing).
// Sur Vercel, '/index.html' peut 404 (rewrite vers '/'), ce qui
// faisait tomber tout le batch. Maintenant chaque resource est tentée
// séparément, on continue même si une échoue.
async function precacheIndividually(cache) {
    await Promise.all(PRECACHE_URLS.map(async (url) => {
        try {
            const res = await fetch(url, { cache: 'reload' });
            if (res.ok && cacheable(res)) await cache.put(url, res);
        } catch {
            // silent : la resource manquante ne bloque pas le SW
        }
    }));
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => precacheIndividually(cache))
            .then(() => self.skipWaiting())
            .catch(() => { /* silent fail — le SW fonctionnera quand même au prochain fetch */ })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then(async (keys) => {
                const anciens = keys.filter((k) => k !== CACHE_NAME);
                await Promise.all(anciens.map((k) => caches.delete(k)));
                await self.clients.claim();
                if (anciens.length > 0) {
                    const fenetres = await self.clients.matchAll({ type: 'window' });
                    await Promise.all(fenetres.map((c) => c.navigate(c.url).catch(() => {})));
                }
            })
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return; // pas de cache pour Era / Finnhub / Anthropic

    // [CF-ACCESS / FIREBASE-AUTH] /api/* et /__/* : jamais mis en cache ni servis par le SW.
    if (url.pathname.startsWith('/api/')) return;
    if (url.pathname.startsWith('/__/')) return;

    // Cache-first pour /assets/* (chunks Vite hashés, immutable)
    // + portfolio-history.csv (historique immuable côté serveur, peut être
    // grand ~50KB, vaut le coup d'éviter le re-fetch à chaque load).
    if (url.pathname.startsWith('/assets/') ||
        url.pathname === '/portfolio-history.csv' ||
        url.pathname === '/test-portfolio-history.csv') {
        event.respondWith(
            caches.match(req).then((hit) => {
                if (hit) return hit;
                return fetch(req).then((res) => {
                    const isAssetPath = url.pathname.startsWith('/assets/');
                    const contentType = (res.headers.get('content-type') || '').toLowerCase();
                    if (isAssetPath && contentType.includes('text/html')) {
                        return Response.error();
                    }
                    if (!cacheable(res)) return res;
                    const clone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
                    return res;
                }).catch(() => hit || Response.error());
            })
        );
        return;
    }

    // Network-first pour index.html et le reste (avec fallback cache offline).
    // 2026-05-22 : les requêtes de navigation sont forcées en `no-store`. Sans
    // ça, fetch(req) pouvait servir un index.html depuis le cache HTTP du
    // navigateur (stale) → index pointant vers d'anciens hashes de chunks →
    // utilisateur coincé sur du vieux code après un deploy. Online = toujours
    // frais ; offline = fallback cache via le .catch ci-dessous.
    const cibleFetch = req.mode === 'navigate' ? req.url : req;
    const fetchOpts = req.mode === 'navigate' ? { cache: 'no-store' } : undefined;
    event.respondWith(
        fetch(cibleFetch, fetchOpts)
            .then((res) => {
                if (!cacheable(res)) return res;
                const clone = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
                return res;
            })
            .catch(() => caches.match(req).then((hit) => hit || caches.match('/index.html')))
    );
});
