// cloudrun/proxy/server.mjs — adaptateur `node:http` ↔ Request/Response Web du relais (cf. relais.mjs).
// Cloud Run fournit PORT. Seul GET/HEAD est utile : le corps des requêtes n'est jamais lu.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { traiter } from './relais.mjs';

const port = Number(process.env.PORT) || 8080;

createServer(async (req, res) => {
    const controleur = new AbortController();
    res.on('close', () => { if (!res.writableFinished) controleur.abort(); });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
        if (v === undefined) continue;
        headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    }
    // Hôte fixe : seule la partie chemin + requête de l'URL entrante est utilisée.
    const request = new Request(new URL(req.url ?? '/', 'http://relais.local'), { method: req.method, headers, signal: controleur.signal });
    const reponse = await traiter(request);
    const sortie = {};
    reponse.headers.forEach((v, k) => { sortie[k] = v; });
    res.writeHead(reponse.status, sortie);
    if (!reponse.body || req.method === 'HEAD') { res.end(); return; }
    Readable.fromWeb(reponse.body).on('error', () => res.destroy()).pipe(res);
}).listen(port, () => {
    console.error(`[proxy] à l'écoute sur ${port}`);
});
