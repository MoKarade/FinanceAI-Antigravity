/**
 * [FUTUR-DAILY-STACK-X] Le rang d'empilement des pastilles décrit ce qui est À L'ÉCRAN.
 *
 * Ce test OBSERVE le vrai pipeline du composant (construction des événements → filtre de fenêtre →
 * écrêtage `sampleEvenly` → `ReferenceDot`) en capturant les `payload` que le graphe reçoit
 * réellement.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../../services/testFixtures';

const capturés: Array<{ monthIndex: number; subIdx: number; label: string }> = [];

vi.mock('recharts', async () => {
    const React = await import('react');
    const P = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
    return {
        ResponsiveContainer: P, PieChart: P, BarChart: P, LineChart: P, AreaChart: P,
        ComposedChart: ({ children }: { children?: React.ReactNode }) => {
            capturés.length = 0;
            return React.createElement('div', null, children);
        },
        Pie: () => null, Bar: () => null, Area: () => null, Line: () => null, Cell: () => null,
        Legend: () => null, ReferenceLine: () => null, ReferenceArea: () => null,
        ReferenceDot: (props: { shape?: { props?: { payload?: { monthIndex: number; subIdx: number; label: string }; kind?: string } } }) => {
            const p = props.shape?.props?.payload;
            if (p && props.shape?.props?.kind === 'life') capturés.push({ monthIndex: p.monthIndex, subIdx: p.subIdx, label: p.label });
            return null;
        },
        XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
    };
});
vi.mock('../../services/errorLogger', () => ({ logError: vi.fn(), logErrorThrottled: vi.fn() }));
vi.mock('../../services/deepForecastStore', () => ({
    loadAppliedDeepForecast: vi.fn(async () => ({ status: 'empty' as const })),
    saveAppliedDeepForecast: vi.fn(async () => true),
    clearAppliedDeepForecast: vi.fn(async () => true),
}));

const MOIS = 60;
function chartDataDense() {
    const pts = [];
    for (let m = 0; m < MOIS; m++) {
        const lifeEvents = [`Événement A ${m}`];
        if (m % 5 === 0) lifeEvents.push(`Événement B ${m}`, `Événement C ${m}`);
        if (m === 20) lifeEvents.push('Objectif FIRE Atteint 🔥');
        pts.push({
            monthIndex: m, year: 2026 + Math.floor(m / 12), age: 35 + Math.floor(m / 12),
            dateLabel: `mois ${m}`, NetWorth: 100_000 + m * 1_000,
            lifeEvents, flowEvents: [],
        });
    }
    return pts;
}

function Harness() {
    const projection = useFinanceStore((s) => s.projection);
    const config = useFinanceStore((s) => s.config);
    const retirementGoal = useFinanceStore((s) => s.retirementGoal);
    return (
        <FutureProjection
            initialBalances={useFinanceStore.getState().initialBalances ?? {}}
            transactions={[]} budgetItems={[]} config={config} realEstateGoals={[]}
            retirementGoal={retirementGoal}
            setRetirementGoal={(g) => act(() => { useFinanceStore.setState({ retirementGoal: g }); })}
            calculatedMonthlySavings={2000}
            projection={projection}
            setProjection={(p) => act(() => { useFinanceStore.setState({ projection: p }); })}
        />
    );
}

async function pastillesVieAffichées() {
    capturés.length = 0;
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument());
    await waitFor(() => expect(capturés.length).toBeGreaterThan(0));
    return [...capturés];
}

describe('[FUTUR-DAILY-STACK-X] rang d\'empilement des pastilles', () => {
    beforeEach(() => {
        const persona = getPersonaOrDefault(DEFAULT_PERSONA_ID);
        act(() => {
            useFinanceStore.getState().enableTestMode(persona.build(), persona.id);
            useFinanceStore.setState({
                projectionRunMC: false, projectionStatus: 'idle',
                lastProjection: { chartData: chartDataDense(), fireNumber: 400_000, allResults: [] } as never,
                isProjectionLocked: false, lockedProjection: null,
            });
        });
    });
    afterEach(() => cleanup());

    it('l\'écrêtage MORD vraiment sur cette fixture (sinon le test ne prouve rien)', async () => {
        const vues = await pastillesVieAffichées();
        const produits = chartDataDense().reduce((n, p) => n + p.lifeEvents.length, 0);
        expect(produits).toBeGreaterThan(vues.length);
        expect(vues.length).toBeGreaterThan(5);
    });

    it('chaque mois montré commence au rang 0 et n\'a aucun étage vide', async () => {
        const vues = await pastillesVieAffichées();
        const parMois = new Map<number, number[]>();
        for (const v of vues) parMois.set(v.monthIndex, [...(parMois.get(v.monthIndex) ?? []), v.subIdx]);

        for (const [mois, rangs] of parMois) {
            const triés = [...rangs].sort((a, b) => a - b);
            expect(triés, `mois ${mois}`).toEqual(triés.map((_, i) => i));
        }
        expect(Math.max(...[...parMois.values()].map((r) => r.length))).toBeGreaterThan(1);
    });
});
