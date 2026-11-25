// [DURCISSEMENT-GARDE] Tests unitaires de server/garde.ts : débit, plafond de corps, IP client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    reinitialiserLimites, essayerDebit, tailleCompteurs, lireCorpsBorne, CORPS_MAX_OCTETS, CorpsTropGros, ipClient,
} from '../../server/garde';

beforeEach(() => {
    reinitialiserLimites();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('débit et compteurs en mémoire', () => {
    it('la fenêtre se referme après une minute', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-25T12:00:00Z'));
        expect(essayerDebit('x', 1).ok).toBe(true);
        expect(essayerDebit('x', 1).ok).toBe(false);
        vi.setSystemTime(new Date('2026-09-25T12:01:01Z'));
        expect(essayerDebit('x', 1).ok).toBe(true);
    });

    it('mémoire BORNÉE : 2 500 IP distinctes ne font pas grossir les compteurs au-delà de 2 000, et les récentes restent', () => {
        for (let i = 0; i < 2_500; i++) essayerDebit(`ip:${i}`, 5);
        expect(tailleCompteurs()).toBeLessThanOrEqual(2_000);
        expect(essayerDebit('ip:2499', 1).ok).toBe(false);   // la plus récente est encore là (déjà comptée une fois)
        expect(essayerDebit('ip:0', 1).ok).toBe(true);       // la plus ancienne a été évincée : compteur neuf
    });
});

describe('plafond de corps (~200 Ko)', () => {
    it('Content-Length annoncé trop grand → CorpsTropGros sans rien lire', async () => {
        const gros = 'x'.repeat(CORPS_MAX_OCTETS + 10);
        const req = new Request('http://localhost/api/test', {
            method: 'POST',
            headers: { 'content-length': String(gros.length) },
            body: gros,
        });
        await expect(lireCorpsBorne(req)).rejects.toBeInstanceOf(CorpsTropGros);
    });

    it('sans Content-Length (flux) : la lecture s\'arrête au plafond', async () => {
        const morceau = new TextEncoder().encode('x'.repeat(64 * 1024));
        let envoyes = 0;
        const flux = new ReadableStream<Uint8Array>({
            pull(c) { if (envoyes++ < 100) c.enqueue(morceau); else c.close(); },
        });
        const req = new Request('http://localhost/api/test', { method: 'POST', body: flux, duplex: 'half' } as RequestInit);
        await expect(lireCorpsBorne(req)).rejects.toBeInstanceOf(CorpsTropGros);
        expect(envoyes).toBeLessThan(10);
    });

    it('un corps de taille normale passe', async () => {
        const req = new Request('http://localhost/api/test', { method: 'POST', body: '{"ok":true}' });
        expect(await lireCorpsBorne(req)).toBe('{"ok":true}');
    });
});

describe('IP du client : la plateforme d\'abord', () => {
    it('x-vercel-forwarded-for l\'emporte sur un x-forwarded-for préfixé par l\'attaquant', () => {
        const h = new Headers({ 'x-forwarded-for': '1.2.3.4, 203.0.113.50', 'x-vercel-forwarded-for': '203.0.113.50' });
        expect(ipClient(h)).toBe('203.0.113.50');
        expect(ipClient(new Headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '203.0.113.51' }))).toBe('203.0.113.51');
        expect(ipClient(new Headers({ 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }))).toBe('198.51.100.9');
        expect(ipClient(new Headers())).toBe('inconnue');
    });
});
