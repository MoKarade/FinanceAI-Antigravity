// tests/services/ingest/deleteItem.test.ts
import { describe, it, expect } from 'vitest';
import { applyDocument, type DeleteItemPayload } from '../../../services/ingest/applyDocument';
import { buildDefaultAppState } from '../../../services/aiTools/appStateDefaults';
import { scrubWriteResultForModel } from '../../../services/aiTools/specs/scrubWriteResult';
import type { AppState, Asset, Debt } from '../../../types';

const baseState = (): AppState => buildDefaultAppState();

function richState(): AppState {
    const s = baseState();
    s.assets = [
        { symbol: 'VFV.TO', name: 'Vanguard S&P 500', quantity: 10, currency: 'CAD', currentPrice: 140, performance: 0, dateBought: '2025-01-01', accountType: 'CELI' },
        { symbol: 'VFV.TO', name: 'Vanguard S&P 500', quantity: 5, currency: 'CAD', currentPrice: 140, performance: 0, dateBought: '2025-06-01', accountType: 'REER' },
        { symbol: 'BTC', name: 'Bitcoin', quantity: 0.1, currency: 'CAD', currentPrice: 90000, performance: 0, dateBought: '2024-01-01', accountType: 'CRYPTO' },
    ] as Asset[];
    s.debts = [
        { id: 'debt_1700000000000', name: 'Prêt auto Honda', balance: 12000, interestRate: 6.9, minimumPayment: 300, category: 'Car' },
    ] as Debt[];
    return s;
}

const del = (entity: DeleteItemPayload['entity'], name: string, accountType?: string): DeleteItemPayload =>
    ({ kind: 'delete_item', entity, name, ...(accountType ? { accountType } : {}) });

describe('applyDeleteItem — actif (« vente totale »)', () => {
    it('supprime l\'actif ciblé (symbole unique) et laisse les autres intacts', () => {
        const { nextState, changes, summary } = applyDocument(richState(), del('asset', 'btc'));
        expect(nextState.assets.some((a) => a.symbol === 'BTC')).toBe(false);
        expect(nextState.assets).toHaveLength(2);
        expect(changes[0].after).toBe('supprimé');
        expect(String(changes[0].note)).toMatch(/contribution passée/);
        expect(summary).toMatch(/Sauvegarde/);
    });

    it('symbole détenu dans 2 comptes SANS accountType → throw (jamais de choix silencieux)', () => {
        expect(() => applyDocument(richState(), del('asset', 'VFV.TO'))).toThrow(/Plusieurs actifs|précise le compte/i);
    });

    it('avec accountType → supprime le BON compte seulement', () => {
        const { nextState } = applyDocument(richState(), del('asset', 'vfv.to', 'CELI'));
        const rest = nextState.assets.filter((a) => a.symbol === 'VFV.TO');
        expect(rest).toHaveLength(1);
        expect(rest[0].accountType).toBe('REER');
    });

    it('accountType fourni mais INVALIDE → message distinct listant les comptes réels (pas « précise le compte »)', () => {
        expect(() => applyDocument(richState(), del('asset', 'VFV.TO', 'TFSA-WRONG')))
            .toThrow(/dans le compte « TFSA-WRONG ».*CELI.*REER/s);
    });

    it('montant NON FINI sur l\'entité → « (non disponible) » dans l\'aperçu, jamais un « 0 » fabriqué', () => {
        const s = richState();
        s.debts[0].balance = NaN;
        const { changes } = applyDocument(s, del('debt', 'Prêt auto Honda'));
        expect(String(changes[0].before)).toContain('(non disponible)');
        expect(String(changes[0].before)).not.toMatch(/^0 \$/);
    });

    it('symbole inconnu → throw, rien supprimé, état non muté', () => {
        const s = richState();
        expect(() => applyDocument(s, del('asset', 'TSLA'))).toThrow(/Aucun actif/);
        expect(s.assets).toHaveLength(3);
    });
});

describe('applyDeleteItem — dette', () => {
    it('supprime la dette par nom (casse/accents ignorés) avec note « NW monte »', () => {
        const { nextState, changes } = applyDocument(richState(), del('debt', '  prêt auto honda '));
        expect(nextState.debts).toHaveLength(0);
        expect(String(changes[0].note)).toMatch(/patrimoine net MONTE/);
    });

    it('nom de dette inconnu → throw explicite', () => {
        expect(() => applyDocument(richState(), del('debt', 'Marge inexistante'))).toThrow(/Aucune dette/);
    });

    it('une entity INATTENDUE lève, et ne supprime SURTOUT pas une dette par défaut', () => {
        const s = richState();
        const rogue = { kind: 'delete_item', entity: 'savings_goal', name: 'Prêt auto Honda' } as unknown as DeleteItemPayload;
        expect(() => applyDocument(s, rogue)).toThrow(/non supporté.*savings_goal|Attendu : asset ou debt/);
        expect(s.debts).toHaveLength(1);
    });

    it('deux dettes à noms équivalents → throw (renommer d\'abord)', () => {
        const s = richState();
        s.debts = [...s.debts, { id: 'debt_1700000000001', name: 'PRÊT AUTO HONDA', balance: 1, interestRate: 1, minimumPayment: 1, category: 'Car' } as Debt];
        expect(() => applyDocument(s, del('debt', 'Prêt auto Honda'))).toThrow(/Plusieurs dettes/);
    });
});

describe('scrub des textes d\'écriture — la prose de sécurité SURVIT au retour vers le modèle', () => {
    it('les avertissements clés (courbe passée, NW monte, annulable) ne sont PAS tronqués par le scrub', () => {
        const { changes, summary } = applyDocument(richState(), del('asset', 'BTC'));
        const safe = scrubWriteResultForModel(summary, changes);
        expect(String(safe.changes[0].note)).toContain('contribution passée');
        expect(String(safe.changes[0].note)).toContain('transactions bancaires');
        expect(safe.summary).toContain('annulable via Réglages');

        const debt = applyDocument(richState(), del('debt', 'Prêt auto Honda'));
        expect(String(scrubWriteResultForModel(debt.summary, debt.changes).changes[0].note)).toContain('patrimoine net MONTE');
    });
});
