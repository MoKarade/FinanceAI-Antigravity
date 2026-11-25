// tests/aiTools/simulateWhatIf.test.ts
import { describe, it, expect } from 'vitest';
import { TEST_PERSONAS } from '../fixtures/testPersonas';
import { normalizeAppState } from '../../services/aiTools/appStateDefaults';
import { simulateWhatIfSpec } from '../../services/aiTools/specs/simulateWhatIf.spec';
import { getProjectionSpec } from '../../services/aiTools/specs/getProjection.spec';
import type { StateProvider, ToolTextResult } from '../../services/aiTools/specs/_dataAware';
import {
    applyWhatIfChanges,
    compareAtHorizons,
    extractYearlySeries,
    isoMonthFrom,
} from '../../services/aiTools/whatIf';
import type { ProjectionChartPoint } from '../../services/projection/types';
import type { AppState } from '../../types';

function karimState(): AppState {
    return normalizeAppState(TEST_PERSONAS.find((p) => p.id === 'karim-immigre')!.build());
}

async function callJson<T extends Record<string, unknown>>(
    spec: { handler: (args: T, getState: StateProvider) => Promise<ToolTextResult> },
    args: T = {} as T,
): Promise<Record<string, unknown>> {
    const res = await spec.handler(args, async () => karimState());
    expect(res.isError).toBeFalsy();
    expect(res.content[0]?.type).toBe('text');
    return JSON.parse(res.content[0].text);
}

const ENGINE_TIMEOUT = 60_000;

describe('simulate_what_if — achat ponctuel (voiture comptant)', () => {
    it('creuse le patrimoine d’≈ le coût à l’an 1 (discriminant de magnitude)', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{ kind: 'achat_ponctuel', label: 'Voiture', amount: 30000 }],
            years: 10,
            includeSeries: true,
        });
        expect(out.currency).toBe('CAD');
        const deltas = out.deltasByHorizon as Array<{ afterYears: number; netWorthDelta: number }>;
        const year1 = deltas.find((d) => d.afterYears === 1)!;
        expect(year1.netWorthDelta).toBeLessThan(-25000);
        expect(year1.netWorthDelta).toBeGreaterThan(-40000);
        const final = deltas[deltas.length - 1];
        expect(final.netWorthDelta).toBeLessThanOrEqual(year1.netWorthDelta);
        const base = out.base as { finalNetWorthNominal: number };
        const whatIf = out.whatIf as { finalNetWorthNominal: number };
        const impact = out.impact as { finalNetWorthDelta: number };
        expect(impact.finalNetWorthDelta).toBe(whatIf.finalNetWorthNominal - base.finalNetWorthNominal);
        expect(impact.finalNetWorthDelta).toBeLessThan(0);
    }, ENGINE_TIMEOUT);

    it('série annuelle : présente, finie, cohérente avec le résumé', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{ kind: 'achat_ponctuel', label: 'Voiture', amount: 30000 }],
            years: 10,
            includeSeries: true,
        });
        const series = out.series as { base: Array<Record<string, number | null>>; whatIf: Array<Record<string, number | null>> };
        expect(series.base.length).toBeGreaterThanOrEqual(10);
        expect(series.whatIf.length).toBe(series.base.length);
        for (const p of series.base) {
            expect(Number.isFinite(p.netWorth)).toBe(true);
        }
        const base = out.base as { finalNetWorthNominal: number };
        expect(series.base[series.base.length - 1].netWorth).toBe(base.finalNetWorthNominal);
    }, ENGINE_TIMEOUT);
});

describe('simulate_what_if — dépense récurrente', () => {
    it('+500 $/mois coûte ≈ 500 × mois écoulés (± croissance perdue)', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{ kind: 'depense_recurrente', label: 'Frais voiture', monthlyAmount: 500 }],
            years: 5,
            includeSeries: false,
        });
        const deltas = out.deltasByHorizon as Array<{ afterYears: number; netWorthDelta: number }>;
        const year5 = deltas.find((d) => d.afterYears === 5)!;
        expect(year5.netWorthDelta).toBeLessThan(-24000);
        expect(year5.netWorthDelta).toBeGreaterThan(-60000);
        expect(out.series).toBeNull();
    }, ENGINE_TIMEOUT);
});

describe('simulate_what_if — salaire', () => {
    it('une hausse de 10 % AUGMENTE le patrimoine final (direction)', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{ kind: 'salaire', changePct: 10 }],
            years: 10,
            includeSeries: false,
        });
        const impact = out.impact as { finalNetWorthDelta: number };
        expect(impact.finalNetWorthDelta).toBeGreaterThan(0);
        const assumptions = out.assumptions as string[];
        expect(assumptions.some((a) => a.includes('proportionnellement'))).toBe(true);
    }, ENGINE_TIMEOUT);

    it('cibler un 2ᵉ conjoint inexistant → erreur claire, pas de crash', async () => {
        const res = await simulateWhatIfSpec.handler(
            { changes: [{ kind: 'salaire', userIndex: 1, changePct: 10 }], years: 5, includeSeries: false },
            async () => karimState(),
        );
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('conjoint');
    }, ENGINE_TIMEOUT);
});

describe('simulate_what_if — achat financé', () => {
    it('voiture financée : patrimoine creusé, hypothèses de financement remontées', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{
                kind: 'achat_ponctuel', label: 'Voiture', amount: 30000,
                financing: { downPayment: 5000, ratePct: 7, termYears: 5 },
            }],
            years: 10,
            includeSeries: false,
        });
        const impact = out.impact as { finalNetWorthDelta: number };
        expect(impact.finalNetWorthDelta).toBeLessThan(-30000);
        const assumptions = out.assumptions as string[];
        expect(assumptions.some((a) => a.includes('amortissement standard'))).toBe(true);
        const applied = out.changesApplied as string[];
        expect(applied.some((a) => a.includes('financé'))).toBe(true);
    }, ENGINE_TIMEOUT);
});

describe('simulate_what_if — fixes du panel 2026-07-13 (discriminants)', () => {
    it('label contenant « vente » : l’achat est quand même DÉBITÉ (mot réservé du moteur assaini)', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{ kind: 'achat_ponctuel', label: 'Nouvelle voiture (vente de l’ancienne)', amount: 30000 }],
            years: 10,
            includeSeries: false,
        });
        const deltas = out.deltasByHorizon as Array<{ afterYears: number; netWorthDelta: number }>;
        const year1 = deltas.find((d) => d.afterYears === 1)!;
        expect(year1.netWorthDelta).toBeLessThan(-25000);
        const assumptions = out.assumptions as string[];
        expect(assumptions.some((a) => a.includes('mot réservé'))).toBe(true);
    }, ENGINE_TIMEOUT);

    it('montant Infinity → erreur claire (pas d’impact fabriqué)', async () => {
        const casInfinis: Array<Parameters<typeof simulateWhatIfSpec.handler>[0]['changes']> = [
            [{ kind: 'achat_ponctuel', label: 'Achat infini', amount: Infinity }],
            [{ kind: 'achat_immobilier', price: Infinity, downPaymentPct: 20, ratePct: 5 }],
            [{ kind: 'nouvelle_dette', label: 'Dette infinie', amount: Infinity, ratePct: 5 }],
        ];
        for (const changes of casInfinis) {
            const res = await simulateWhatIfSpec.handler({ changes, years: 5, includeSeries: false }, async () => karimState());
            expect(res.isError).toBe(true);
            expect(res.content[0].text).toContain('non fini');
        }
    }, ENGINE_TIMEOUT);

    it('changement daté APRÈS l’horizon → erreur claire (pas de « succès » à effet nul)', async () => {
        const res = await simulateWhatIfSpec.handler(
            { changes: [{ kind: 'achat_ponctuel', label: 'Voiture tardive', amount: 30000, monthsFromNow: 40 }], years: 2, includeSeries: false },
            async () => karimState(),
        );
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('horizon');
    }, ENGINE_TIMEOUT);

    it('achat FINANCÉ différé → rejeté (les dettes du moteur démarrent au mois 0)', async () => {
        const res = await simulateWhatIfSpec.handler({
            changes: [{
                kind: 'achat_ponctuel', label: 'Voiture', amount: 30000, monthsFromNow: 24,
                financing: { downPayment: 5000, ratePct: 7, termYears: 5 },
            }],
            years: 10,
            includeSeries: false,
        }, async () => karimState());
        expect(res.isError).toBe(true);
        expect(res.content[0].text).toContain('financement différé');
    }, ENGINE_TIMEOUT);

    it('mise de fonds immo > prix → rejetée', () => {
        expect(() => applyWhatIfChanges(karimState(), [
            { kind: 'achat_immobilier', price: 450000, downPayment: 500000, ratePct: 5 },
        ], new Date(2026, 6, 15))).toThrow(/supérieure au prix/);
    });
});

describe('simulate_what_if — nouvelle dette (magnitude e2e)', () => {
    it('emprunt 10 k$ à 8 % : patrimoine creusé d’≈ le solde + intérêts à l’an 1', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{ kind: 'nouvelle_dette', label: 'Prêt perso', amount: 10000, ratePct: 8 }],
            years: 10,
            includeSeries: false,
        });
        const deltas = out.deltasByHorizon as Array<{ afterYears: number; netWorthDelta: number }>;
        const year1 = deltas.find((d) => d.afterYears === 1)!;
        expect(year1.netWorthDelta).toBeLessThan(-10000);
        expect(year1.netWorthDelta).toBeGreaterThan(-18000);
    }, ENGINE_TIMEOUT);
});

describe('simulate_what_if — achat immobilier (flux EXERCÉ, leçon FUZZ-ONETIME-FLOWS)', () => {
    it('l’achat a bien lieu dans la fenêtre simulée (Immobilier > 0 dans la série what-if)', async () => {
        const out = await callJson(simulateWhatIfSpec, {
            changes: [{
                kind: 'achat_immobilier', price: 200000, downPaymentPct: 20, ratePct: 5,
                amortYears: 25, monthsFromNow: 3, municipality: 'reste_qc',
            }],
            years: 15,
            includeSeries: true,
        });
        const series = out.series as { base: Array<{ immobilier: number | null }>; whatIf: Array<{ immobilier: number | null }> };
        const exercised = series.whatIf.some((p) => (p.immobilier ?? 0) > 0);
        expect(exercised).toBe(true);
        const baseHasProperty = series.base.some((p) => (p.immobilier ?? 0) > 0);
        expect(baseHasProperty).toBe(false);
        const impact = out.impact as { finalNetWorthDelta: number };
        expect(impact.finalNetWorthDelta).not.toBe(0);
    }, ENGINE_TIMEOUT);
});

describe('get_projection — includeSeries', () => {
    it('renvoie la série annuelle sur demande, null sinon', async () => {
        const withSeries = await callJson(getProjectionSpec, { years: 10, scenario: 'BASE', monteCarlo: false, includeSeries: true });
        const series = withSeries.series as Array<{ netWorth: number; age: number | null }>;
        expect(Array.isArray(series)).toBe(true);
        expect(series.length).toBeGreaterThanOrEqual(10);
        expect(Number.isFinite(series[0].netWorth)).toBe(true);
        const without = await callJson(getProjectionSpec, { years: 10, scenario: 'BASE', monteCarlo: false, includeSeries: false });
        expect(without.series).toBeNull();
    }, ENGINE_TIMEOUT);
});

describe('whatIf — unités pures', () => {
    it('applyWhatIfChanges ne mute JAMAIS l’état de base', () => {
        const base = karimState();
        const snapshot = JSON.stringify(base);
        applyWhatIfChanges(base, [
            { kind: 'achat_ponctuel', label: 'Voiture', amount: 30000 },
            { kind: 'salaire', changePct: 10 },
            { kind: 'nouvelle_dette', label: 'Prêt perso', amount: 10000, ratePct: 8 },
        ], new Date(2026, 6, 15));
        expect(JSON.stringify(base)).toBe(snapshot);
    });

    it('achat immobilier : totalClosingCosts SANS taxe de bienvenue (le moteur l’ajoute lui-même)', () => {
        const app = applyWhatIfChanges(karimState(), [
            { kind: 'achat_immobilier', price: 450000, downPaymentPct: 20, ratePct: 5, municipality: 'reste_qc' },
        ], new Date(2026, 6, 15));
        const goal = app.state.realEstateGoals[app.state.realEstateGoals.length - 1];
        expect(goal.totalClosingCosts).toBe(2300);
        expect(goal.downPayment).toBe(90000);
        expect(goal.monthlyPayment).toBeGreaterThan(0);
        expect(goal.isActive).toBe(true);
    });

    it('liste de changements vide → erreur claire', () => {
        expect(() => applyWhatIfChanges(karimState(), [], new Date())).toThrow(/Aucun changement/);
    });

    it('isoMonthFrom : mois suivant + passage d’année', () => {
        expect(isoMonthFrom(new Date(2026, 6, 15), 1)).toBe('2026-08');
        expect(isoMonthFrom(new Date(2026, 11, 3), 2)).toBe('2027-02');
        expect(isoMonthFrom(new Date(2026, 0, 1), 0)).toBe('2026-01');
    });

    it('extractYearlySeries : décembre de chaque année + dernier point, arrondis', () => {
        const chart: ProjectionChartPoint[] = Array.from({ length: 30 }, (_, i) => ({
            monthIndex: i,
            NetWorth: 1000.4 + i,
            year: 2026 + Math.floor(i / 12),
            age: 30 + Math.floor(i / 12),
        }));
        const series = extractYearlySeries(chart);
        expect(series.map((p) => p.netWorth)).toEqual([Math.round(1011.4), Math.round(1023.4), Math.round(1029.4)]);
        expect(series[0].year).toBe(2026);
    });

    it('compareAtHorizons : deltas aux bons jalons, horizon respecté', () => {
        const mk = (nw: (i: number) => number): ProjectionChartPoint[] =>
            Array.from({ length: 120 }, (_, i) => ({ monthIndex: i, NetWorth: nw(i) }));
        const base = mk((i) => 1000 * i);
        const whatIf = mk((i) => 1000 * i - 5000);
        const deltas = compareAtHorizons(base, whatIf, 10);
        expect(deltas.map((d) => d.afterYears)).toEqual([1, 2, 5, 10]);
        for (const d of deltas) expect(d.netWorthDelta).toBe(-5000);
    });
});
