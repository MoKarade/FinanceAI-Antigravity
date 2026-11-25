// cloudrun/proxy/server.mjs — adaptateur `node:http` ↔ Request/Response Web du relais (cf. relais.mjs).
// Cloud Run fournit PORT. Lecture du corps bornée à 2 Mo max pour `POST /api/financeai/bridge`.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { traiter } from './relais.mjs';

const port = Number(process.env.PORT) || 8080;
const CORPS_MAX_OCTETS = 2 * 1024 * 1024;
const HUB_OPTS = {
    hubProjectId: process.env.HUBPERSO_PROJECT_ID,
    hubOwnerEmail: process.env.HUBPERSO_OWNER_EMAIL,
    firestoreBase: process.env.FINANCEAI_FIRESTORE_BASE,
    financeaiProjectId: process.env.FINANCEAI_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT,
    firestoreDatabaseId: process.env.FINANCEAI_FIRESTORE_DB_ID,
    fintableToken: process.env.FINTABLE_TOKEN,
};

function lireCorpsHttp(req, maxOctets) {
    return new Promise((resolve, reject) => {
        const annonce = Number(req.headers['content-length']);
        if (Number.isFinite(annonce) && annonce > maxOctets) {
            reject(Object.assign(new Error('Corps trop volumineux.'), { code: 'PAYLOAD_TOO_LARGE' }));
            return;
        }
        const morceaux = [];
        let total = 0;
        let termine = false;
        req.on('data', (chunk) => {
            if (termine) return;
            total += chunk.length;
            if (total > maxOctets) {
                termine = true;
                req.destroy();
                reject(Object.assign(new Error('Corps trop volumineux.'), { code: 'PAYLOAD_TOO_LARGE' }));
                return;
            }
            morceaux.push(chunk);
        });
        req.on('end', () => {
            if (!termine) resolve(Buffer.concat(morceaux, total));
        });
        req.on('error', (err) => {
            if (!termine) reject(err);
        });
    });
}

createServer(async (req, res) => {
    const controleur = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controleur.abort(); });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }

    const methode = (req.method ?? 'GET').toUpperCase();
    let body;
    if (methode === 'POST' || methode === 'PUT' || methode === 'PATCH') {
        try {
            body = await lireCorpsHttp(req, CORPS_MAX_OCTETS);
        } catch (err) {
            const status = err?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
            res.writeHead(status, {
                'content-type': 'application/json',
                'cache-control': 'no-store',
                'x-content-type-options': 'nosniff',
            });
            res.end(JSON.stringify({
                error: {
                    type: status === 413 ? 'payload_too_large' : 'invalid_body',
                    message: status === 413 ? 'Corps de requête limité à 2 Mo.' : 'Corps de requête invalide.',
                },
            }));
            return;
        }
    }

    // Hôte fixe : seule la partie chemin + requête de l'URL entrante est utilisée.
    const request = new Request(new URL(req.url ?? '/', 'http://relais.local'), {
        method: methode,
        headers,
        body,
        signal: controleur.signal,
    });
    const reponse = await traiter(request, HUB_OPTS);
    const sortie = {};
    reponse.headers.forEach((v, k) => { sortie[k] = v; });
    res.writeHead(reponse.status, sortie);
    if (!reponse.body || methode === 'HEAD') { res.end(); return; }
    Readable.fromWeb(reponse.body).on('error', () => res.destroy()).pipe(res);
}).listen(port, () => {
    console.error(`[proxy] à l'écoute sur ${port}`);
});
