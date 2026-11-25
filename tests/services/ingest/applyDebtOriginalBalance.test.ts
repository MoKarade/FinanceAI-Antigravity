// tests/services/ingest/applyDebtOriginalBalance.test.ts
import { formatCAD } from '../../../utils/format';

const escRx = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
import { describe, it, expect } from 'vitest';
import { applyDocument, type DebtPayload } from '../../../services/ingest/applyDocument';
import { etatFictif } from '../../helpers/etatFictif';
import { applyDebtSpec } from '../../../services/aiTools/specs/applyDebt.spec';
import { amortirDettePassee, supplementAmortiAuMoisAbsolu } from '../../../services/projection/debtAmortization';
import { moisAbsolu } from '../../../services/projection/debtSchedule';
import type { AppState, Debt } from '../../../types';

const baseState = (): AppState => etatFictif();

const pretAuto = (over: Partial<DebtPayload> = {}): DebtPayload => ({
    kind: 'debt',
    name: 'Prêt auto Honda Civic',
    balance: 18000,
    originalBalance: 30000,
    interestRate: 5,
    minimumPayment: 560,
    debtKind: 'auto',
    startDate: '2024-01-15',
    ...over,
});

const ajoute = (p: DebtPayload, state: AppState = baseState()): Debt =>
    applyDocument(state, p).nextState.debts[0] as Debt;

describe('[DEBT-MCP-ORIGINALBALANCE] écriture du montant emprunté', () => {
    it('AJOUT : le champ arrive dans la dette écrite', () => {
        expect(ajoute(pretAuto()).originalBalance).toBe(30000);
    });

    it('AJOUT sans le champ : la dette n\'en porte pas — non-régression stricte', () => {
        const d = ajoute(pretAuto({ originalBalance: undefined }));
        expect(d.originalBalance).toBeUndefined();
        expect('originalBalance' in d).toBe(false);
    });

    it('MISE À JOUR PARTIELLE : le champ seul suffit à réveiller une dette déjà en base', () => {
        const apres = applyDocument(baseState(), pretAuto({ originalBalance: undefined })).nextState;
        const { nextState, changes } = applyDocument(apres, {
            kind: 'debt', name: 'Prêt auto Honda Civic', originalBalance: 30000,
        });
        expect((nextState.debts[0] as Debt).originalBalance).toBe(30000);
        expect(changes.map(c => c.field)).toContain('debts[0].originalBalance');
        expect(nextState.debts).toHaveLength(1);
    });
});

describe('[DEBT-MCP-ORIGINALBALANCE] refus d\'une origine incohérente', () => {
    it('refuse un montant emprunté INFÉRIEUR au solde actuel, en nommant les deux chiffres', () => {
        expect(() => applyDocument(baseState(), pretAuto({ originalBalance: 12000 })))
            .toThrow(new RegExp(`montant emprunté.*${escRx(formatCAD(12000))}.*INFÉRIEUR.*${escRx(formatCAD(18000))}`, 'i'));
    });

    it('⚠️ le refus se juge sur les valeurs EFFECTIVES, pas sur le payload seul', () => {
        const apres = applyDocument(baseState(), pretAuto({ originalBalance: undefined })).nextState;
        expect(() => applyDocument(apres, {
            kind: 'debt', name: 'Prêt auto Honda Civic', originalBalance: 12000,
        })).toThrow(/INFÉRIEUR/i);
        const avecOrigine = applyDocument(baseState(), pretAuto()).nextState;
        expect(() => applyDocument(avecOrigine, {
            kind: 'debt', name: 'Prêt auto Honda Civic', balance: 45000,
        })).toThrow(/INFÉRIEUR/i);
    });

    it('l\'égalité est ACCEPTÉE : un prêt tout juste contracté n\'a rien remboursé', () => {
        expect(ajoute(pretAuto({ originalBalance: 18000 })).originalBalance).toBe(18000);
    });
});

describe('[DEBT-MCP-ORIGINALBALANCE] bornes côté MÉTIER (l\'import PDF ne passe pas par Zod)', () => {
    const refuse = (v: unknown): void => {
        expect(() => applyDocument(baseState(), pretAuto({ originalBalance: v as number })))
            .toThrow(/Montant emprunté invalide/i);
    };
    it('refuse NaN, Infinity, zéro, négatif et aberrant', () => {
        refuse(Number.NaN);
        refuse(Number.POSITIVE_INFINITY);
        refuse(0);
        refuse(-30000);
        refuse(50_000_001);
    });
    it('« rien n\'a été écrit » est vrai : l\'état d\'entrée n\'est pas muté', () => {
        const state = baseState();
        const avant = JSON.stringify(state.debts ?? []);
        expect(() => applyDocument(state, pretAuto({ originalBalance: -1 }))).toThrow();
        expect(JSON.stringify(state.debts ?? [])).toBe(avant);
    });
});

describe('[DEBT-MCP-ORIGINALBALANCE] le schéma du tool (la bretelle)', () => {
    it('expose le champ, et son libellé dit la CONSÉQUENCE plutôt que le type', () => {
        const champ = applyDebtSpec.inputSchema.originalBalance;
        expect(champ).toBeDefined();
        const { description } = champ;
        expect(description ?? '').toMatch(/contrat/i);
        expect(description ?? '').toMatch(/estime JAMAIS|n'invente|jamais à partir/i);
    });
    it('refuse un négatif et un non-fini AVANT le métier', () => {
        expect(applyDebtSpec.inputSchema.originalBalance.safeParse(-1).success).toBe(false);
        expect(applyDebtSpec.inputSchema.originalBalance.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
        expect(applyDebtSpec.inputSchema.originalBalance.safeParse(30000).success).toBe(true);
    });
});

describe('[DEBT-MCP-ORIGINALBALANCE] ATTEIGNABILITÉ — du payload d\'ingestion jusqu\'à la courbe du passé', () => {
    const AUJ = moisAbsolu('2026-01-15') as number;
    const AUJ_ISO = '2026-01-15';

    it('une dette importée reçoit VRAIMENT une courbe d\'amortissement', () => {
        const d = ajoute(pretAuto());
        const r = amortirDettePassee(d, AUJ, AUJ_ISO, []);
        expect(r.forme).toBe('ok');
        if (r.forme !== 'ok') throw new Error('inatteignable');
        expect(r.soldes[r.soldes.length - 1]).toBeCloseTo(18000, 6);
    });

    it('le passé doit PLUS, et le supplément décroît vers aujourd\'hui', () => {
        const d = ajoute(pretAuto());
        const debut = moisAbsolu('2024-01-15') as number;
        const supDebut = supplementAmortiAuMoisAbsolu([d], debut, AUJ, AUJ_ISO, []);
        const supRecent = supplementAmortiAuMoisAbsolu([d], AUJ - 1, AUJ, AUJ_ISO, []);
        expect(supDebut).toBeGreaterThan(5000);
        expect(supRecent).toBeGreaterThan(0);
        expect(supRecent).toBeLessThan(supDebut);
        expect(supplementAmortiAuMoisAbsolu([d], AUJ, AUJ, AUJ_ISO, [])).toBe(0);
    });

    it('SANS le champ, la même dette reste PLATE — c\'est bien lui qui débloque, rien d\'autre', () => {
        const d = ajoute(pretAuto({ originalBalance: undefined }));
        expect(amortirDettePassee(d, AUJ, AUJ_ISO, [])).toEqual({ forme: 'inapplicable', cause: 'donnees-manquantes' });
        expect(supplementAmortiAuMoisAbsolu([d], moisAbsolu('2024-01-15') as number, AUJ, AUJ_ISO, [])).toBe(0);
    });

    it('un BAIL à TAUX NON NUL est refusé — mais plus pour la raison qu\'on croyait', () => {
        const d = ajoute(pretAuto({ debtKind: 'auto-lease' }));
        expect(d.originalBalance).toBe(30000);
        expect(amortirDettePassee(d, AUJ, AUJ_ISO, [])).toEqual({ forme: 'inapplicable', cause: 'taux-sur-solde-tout-compris' });
    });

    it('un BAIL à TAUX NUL importé s\'amortit — la chaîne complète, pas le module seul', () => {
        const d = ajoute(pretAuto({
            debtKind: 'auto-lease', interestRate: 0, balance: 38500, minimumPayment: 1000,
            originalBalance: undefined, startDate: '2025-06-10',
        }));
        expect(d.kind).toBe('auto-lease');
        const r = amortirDettePassee(d, AUJ, AUJ_ISO, []);
        if (r.forme !== 'ok') throw new Error(`bail à taux nul refusé : ${r.cause}`);
        for (let k = 1; k < r.soldes.length; k++) {
            expect(r.soldes[k - 1] - r.soldes[k]).toBeCloseTo(1000, 6);
        }
        expect(r.soldes[r.soldes.length - 1]).toBe(38500);
        expect(r.soldes.length).toBeGreaterThan(1);
    });
});
