// tests/services/ingest/lot2Write.test.ts
import { describe, it, expect } from 'vitest';
import { applyDocument } from '../../../services/ingest/applyDocument';
import { buildDefaultAppState } from '../../../services/aiTools/appStateDefaults';
import { annualSalaryToMonthly } from '../../../utils/salary';
import type { AppState } from '../../../types';

function baseState(): AppState {
    const s = buildDefaultAppState();
    const [u0, u1] = s.config.users;
    s.config = {
        ...s.config,
        users: [
            { ...u0, name: 'Moi', grossSalary: 5000, netSalary: 4000 },
            { ...u1, name: 'Anna', grossSalary: 0, netSalary: 0 },
        ],
        splitMode: 'prorata',
    };
    return s;
}

describe('Lot 2 — applyDocument (paie, pur)', () => {
    it('brut/net ANNUELS → stockés MENSUELS, user 0 par défaut', () => {
        const r = applyDocument(baseState(), { kind: 'payslip', grossAnnual: 84000, netAnnual: 60000 });
        expect(r.nextState.config.users[0].grossSalary).toBe(7000);
        expect(r.nextState.config.users[0].netSalary).toBe(5000);
        expect(r.changes.length).toBe(2);
    });

    it('cible par nom (insensible à la casse), sans toucher l\'autre user', () => {
        const r = applyDocument(baseState(), { kind: 'payslip', userName: 'anna', grossAnnual: 120000 });
        expect(r.nextState.config.users[1].grossSalary).toBe(annualSalaryToMonthly(120000));
        expect(r.nextState.config.users[0].grossSalary).toBe(5000);
    });

    it('valeur identique → 1er apply estampille la PROVENANCE, le retry est inerte ([INCOME-PROVENANCE])', () => {
        const first = applyDocument(baseState(), { kind: 'payslip', grossAnnual: 60000 });
        expect(first.changes.length).toBe(1);
        expect(first.changes[0].field).toContain('salarySource');
        const retry = applyDocument(first.nextState, { kind: 'payslip', grossAnnual: 60000 });
        expect(retry.changes.length).toBe(0);
    });

    it('rrspContributedAnnual écrit', () => {
        const r = applyDocument(baseState(), { kind: 'payslip', rrspContributedAnnual: 8000 });
        expect(r.nextState.config.users[0].rrspContributed).toBe(8000);
    });

    it('immutabilité : l\'état d\'origine n\'est pas muté', () => {
        const s = baseState();
        const r = applyDocument(s, { kind: 'payslip', grossAnnual: 84000 });
        expect(s.config.users[0].grossSalary).toBe(5000);
        expect(r.nextState).not.toBe(s);
    });

    it('type inconnu → erreur claire', () => {
        // @ts-expect-error type non supporté volontairement
        expect(() => applyDocument(baseState(), { kind: 'mystere' })).toThrow(/non support/i);
    });
});
