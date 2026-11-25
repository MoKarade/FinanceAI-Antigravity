// tests/services/ingest/setCash.test.ts
import { describe, it, expect } from 'vitest';
import { applyDocument, type CashBalancePayload } from '../../../services/ingest/applyDocument';
import { computeStartingCash } from '../../../services/projection/buildSimulationParams';
import { etatFictif } from '../../helpers/etatFictif';
import type { AppState, Transaction } from '../../../types';

const baseState = (): AppState => etatFictif();
const setCash = (targetCad: number): CashBalancePayload => ({ kind: 'cash_balance', targetCad });

function richState(): AppState {
    const s = baseState();
    s.initialBalances = { REER: 12000, 'Compte chèque BMO': 3000 };
    s.transactions = [
        { id: 1, date: '2026-01-05', amount: 500, category: 'Salaire', payee: 'Paie', accountName: 'Compte chèque BMO', status: 'processed' },
        { id: 2, date: '2026-01-06', amount: -120, category: 'Épicerie', payee: 'Metro', accountName: 'Compte chèque BMO', status: 'processed' },
        { id: 3, date: '2026-01-07', amount: 9999, category: 'Transfert', payee: 'Vir interne', accountName: 'Compte chèque BMO', status: 'processed', isTransfer: true },
        { id: 4, date: '2026-01-08', amount: 7777, category: 'Doublon', payee: 'Dup', accountName: 'Compte chèque BMO', status: 'processed', isDuplicate: true },
    ] satisfies Transaction[];
    return s;
}

describe('applyCashBalance — round-trip exact (le cash calculé atteint la cible)', () => {
    it('depuis un état vierge : crée le compte LIQUIDITE, cash calculé === cible', () => {
        const { nextState, changes, summary } = applyDocument(baseState(), setCash(50000));
        expect(computeStartingCash(nextState.initialBalances, nextState.transactions ?? [])).toBeCloseTo(50000, 6);
        expect(nextState.initialBalances.LIQUIDITE).toBeCloseTo(50000, 6);
        expect(changes).toHaveLength(1);
        expect(changes[0].after).toBe(50000);
        expect(summary).toContain('LIQUIDITE');
    });

    it('avec d\'AUTRES soldes + transactions (transfert/doublon EXCLUS) : DELTA ciblé, cash total === cible', () => {
        const s = richState();
        const before = computeStartingCash(s.initialBalances, s.transactions ?? []);
        expect(before).toBe(15380);
        const { nextState } = applyDocument(s, setCash(20000));
        expect(computeStartingCash(nextState.initialBalances, nextState.transactions ?? [])).toBeCloseTo(20000, 6);
        expect(nextState.initialBalances.REER).toBe(12000);
        expect(nextState.initialBalances['Compte chèque BMO']).toBe(3000);
        expect(nextState.initialBalances.LIQUIDITE).toBeCloseTo(20000 - 15380, 6);
    });

    it('cible INFÉRIEURE au cash actuel : delta négatif, round-trip toujours exact', () => {
        const s = richState();
        const { nextState, changes } = applyDocument(s, setCash(10000));
        expect(computeStartingCash(nextState.initialBalances, nextState.transactions ?? [])).toBeCloseTo(10000, 6);
        expect(nextState.initialBalances.LIQUIDITE).toBeCloseTo(10000 - 15380, 6);
        expect(changes[0].before).toBe(15380);
        expect(changes[0].after).toBe(10000);
    });

    it('cible 0 est valide (vider les liquidités)', () => {
        const s = richState();
        const { nextState } = applyDocument(s, setCash(0));
        expect(computeStartingCash(nextState.initialBalances, nextState.transactions ?? [])).toBeCloseTo(0, 6);
    });
});

describe('applyCashBalance — idempotence (discriminant delta vs écrasement)', () => {
    it('re-demander la MÊME cible → 0 changement (aucune dérive au retry)', () => {
        const first = applyDocument(richState(), setCash(20000));
        const second = applyDocument(first.nextState, setCash(20000));
        expect(second.changes).toHaveLength(0);
        expect(second.summary).toMatch(/déjà à|aucune modification/i);
        expect(computeStartingCash(second.nextState.initialBalances, second.nextState.transactions ?? [])).toBeCloseTo(20000, 6);
    });

    it('cible déjà atteinte à l\'euro près (< 0.005) → no-op', () => {
        const s = richState();
        const { changes } = applyDocument(s, setCash(15380.004));
        expect(changes).toHaveLength(0);
    });

    it('cibles ENCHAÎNÉES A → B (différentes) : le delta s\'ACCUMULE sur LIQUIDITE existant, round-trip exact à chaque étape', () => {
        const a = applyDocument(richState(), setCash(20000));
        expect(computeStartingCash(a.nextState.initialBalances, a.nextState.transactions ?? [])).toBeCloseTo(20000, 6);
        const liqAfterA = a.nextState.initialBalances.LIQUIDITE;
        const b = applyDocument(a.nextState, setCash(33000));
        expect(computeStartingCash(b.nextState.initialBalances, b.nextState.transactions ?? [])).toBeCloseTo(33000, 6);
        expect(b.nextState.initialBalances.LIQUIDITE).toBeCloseTo(liqAfterA + 13000, 6);
    });
});

describe('applyCashBalance — bornes anti-injection + gardes non-fini (throw, rien écrit)', () => {
    it('REJETTE : négatif, non fini (Infinity/NaN), au-delà de la borne', () => {
        for (const t of [-1, -100, Infinity, -Infinity, NaN, 200_000_000]) {
            expect(() => applyDocument(baseState(), setCash(t))).toThrow(/invalide|aberrant/i);
        }
    });

    it('REJETTE si le CASH ACTUEL est non calculable (solde/transaction corrompu = non fini) — pas d\'écriture de NaN', () => {
        const s1 = baseState();
        s1.initialBalances = { LIQUIDITE: Infinity, REER: 1000 };
        expect(() => applyDocument(s1, setCash(50000))).toThrow(/non calculable|corrompu/i);

        const s2 = baseState();
        s2.transactions = [{ id: 1, date: '2026-01-05', amount: Infinity, category: 'Salaire', payee: 'x', status: 'processed' }] satisfies Transaction[];
        expect(() => applyDocument(s2, setCash(50000))).toThrow(/non calculable|corrompu/i);
    });

    it('REJETTE aussi un NaN — que l\'ancienne garde laissait passer (somme finie, cash amputé)', () => {
        const s1 = baseState();
        s1.initialBalances = { LIQUIDITE: Number.NaN, REER: 1000 };
        expect(() => applyDocument(s1, setCash(50000))).toThrow(/non calculable|corrompu/i);

        const s2 = baseState();
        s2.transactions = [{ id: 1, date: '2026-01-05', amount: Number.NaN, category: 'Salaire', payee: 'x', status: 'processed' }] satisfies Transaction[];
        expect(() => applyDocument(s2, setCash(50000))).toThrow(/non calculable|corrompu/i);
    });

    it('un état SAIN écrit toujours normalement (la garde ne sur-bloque pas)', () => {
        const s = baseState();
        s.initialBalances = { LIQUIDITE: 1000, REER: 5000 };
        const r = applyDocument(s, setCash(3000));
        expect(r.changes.length).toBeGreaterThan(0);
        expect(Number.isFinite(r.nextState.initialBalances.LIQUIDITE)).toBe(true);
    });

    it('le rejet ne MUTE pas l\'état d\'entrée (fonction pure)', () => {
        const s = richState();
        const snapshot = JSON.stringify(s.initialBalances);
        try { applyDocument(s, setCash(Infinity)); } catch { /* attendu */ }
        expect(JSON.stringify(s.initialBalances)).toBe(snapshot);
    });
});
