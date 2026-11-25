/**
 * [FUTUR-AXE-Y-MINIMAL] Le badge flottant « Aujourd'hui » (`TodayValueBadge`, sur le graphe Futur)
 * affiche immédiatement la valeur réelle non-NaN et se masque strictement à `***` en mode discret.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { TodayValueBadge } from '../../components/projection/ProjectionTooltip';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../fixtures/testFixtures';

let badgeValues: Array<string | undefined>;

vi.mock('recharts', async () => {
    const React = await import('react');
    const P = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
    return {
        ResponsiveContainer: P, PieChart: P, BarChart: P, LineChart: P, AreaChart: P,
        ComposedChart: ({ children }: { children?: React.ReactNode }) => {
            badgeValues = [];
            return React.createElement('div', null, children);
        },
        Pie: () => null, Bar: () => null, Area: () => null, Line: () => null, Cell: () => null,
        Legend: () => null, ReferenceLine: () => null, ReferenceArea: () => null,
        ReferenceDot: (props: { shape?: { props?: { value?: string } } }) => {
            const v = props.shape?.props?.value;
            if (v !== undefined) badgeValues.push(v);
            return null;
        },
        XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
    };
});
vi.mock('../../services/errorLogger', () => ({ logError: vi.fn(), logErrorThrottled: vi.fn(), onLogEntry: vi.fn(() => () => {}), __resetErrorThrottle: vi.fn(), }));
vi.mock('../../services/deepForecastStore', () => ({
    loadAppliedDeepForecast: vi.fn(async () => ({ status: 'empty' as const })),
    saveAppliedDeepForecast: vi.fn(async () => true),
    clearAppliedDeepForecast: vi.fn(async () => true),
}));

function chartDataMinimale() {
    return [
        { monthIndex: 0, year: 2026, age: 35, dateLabel: 'mois 0', NetWorth: 253_417, lifeEvents: [], flowEvents: [] },
        { monthIndex: 12, year: 2027, age: 36, dateLabel: 'mois 12', NetWorth: 300_000, lifeEvents: [], flowEvents: [] },
    ];
}

function Harness() {
    const projection = useFinanceStore((s) => s.projection);
    const config = useFinanceStore((s) => s.config);
    const retirementGoal = useFinanceStore((s) => s.retirementGoal);
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    return (
        <FutureProjection
            initialBalances={useFinanceStore.getState().initialBalances ?? {}}
            transactions={[]} budgetItems={[]} config={config} realEstateGoals={[]}
            retirementGoal={retirementGoal}
            setRetirementGoal={(g) => act(() => { useFinanceStore.setState({ retirementGoal: g }); })}
            calculatedMonthlySavings={2000}
            projection={projection}
            setProjection={(p) => act(() => { useFinanceStore.setState({ projection: p }); })}
            isPrivacyMode={isPrivacyMode}
        />
    );
}

async function afficherEtCapturer(isPrivacyMode: boolean) {
    badgeValues = [];
    const persona = getPersonaOrDefault(DEFAULT_PERSONA_ID);
    act(() => {
        useFinanceStore.getState().resetState();
        useFinanceStore.setState({
            ...(persona.build() as Record<string, unknown>),
            projectionRunMC: false, projectionStatus: 'idle',
            lastProjection: { chartData: chartDataMinimale(), fireNumber: 400_000, allResults: [] } as never,
            isProjectionLocked: false, lockedProjection: null,
            isPrivacyMode,
        });
    });
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument());
    await waitFor(() => expect(badgeValues.length).toBeGreaterThan(0));
    return badgeValues;
}

describe('[FUTUR-AXE-Y-MINIMAL] badge flottant « Aujourd\'hui »', () => {
    afterEach(() => cleanup());

    it('affiche une valeur RÉELLE (jamais "NaN", jamais un tiret « — » qui flotterait sans repère)', async () => {
        const valeurs = await afficherEtCapturer(false);
        expect(valeurs.length).toBeGreaterThan(0);
        for (const v of valeurs) {
            expect(v).not.toMatch(/NaN|undefined/);
            expect(v).not.toBe('—');
            expect(v).toMatch(/^\d[\d\s]*\s?(k\$|M\$)$/);
        }
    });

    it('masque la valeur en mode discret (source unique maskedTick, jamais un « *** » recopié)', async () => {
        const valeurs = await afficherEtCapturer(true);
        expect(valeurs.length).toBeGreaterThan(0);
        expect(valeurs).toContain('***');
        for (const v of valeurs) expect(v).toBe('***');
    });
});

describe('[FUTUR-AXE-Y-MINIMAL] TodayValueBadge — no-fake-data en isolation', () => {
    afterEach(() => cleanup());

    it('ne rend RIEN quand cx/cy ne sont pas finis (NaN, undefined) ou value est vide', () => {
        const cas: Array<{ cx?: number; cy?: number; value?: string }> = [
            { cx: NaN, cy: 100, value: '127 k$' },
            { cx: 50, cy: NaN, value: '127 k$' },
            { cx: 50, cy: 100, value: undefined },
            { cx: 50, cy: 100, value: '' },
            { cx: undefined, cy: 100, value: '127 k$' },
        ];
        for (const props of cas) {
            const { container, unmount } = render(<svg><TodayValueBadge {...props} /></svg>);
            expect(container.querySelector('text'), JSON.stringify(props)).toBeNull();
            unmount();
        }
    });

    it('rend la pastille avec le texte exact quand cx/cy/value sont valides', () => {
        const { container } = render(<svg><TodayValueBadge cx={50} cy={100} value="127 k$" /></svg>);
        expect(container.querySelector('text')?.textContent).toBe('127 k$');
    });
});
