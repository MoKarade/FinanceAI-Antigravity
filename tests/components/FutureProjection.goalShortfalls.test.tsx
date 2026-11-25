// tests/components/FutureProjection.goalShortfalls.test.tsx
// [ENG-GOALSHORTFALLS-EXPOSE] Le bandeau « objectif non financé » consomme `goalShortfalls`
// dès l'affichage immédiat de FutureProjection (Futur 4.0) et masque les montants en mode discret.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { FutureProjection } from '../../components/FutureProjection';
import { useFinanceStore } from '../../store/useFinanceStore';
import { getPersonaOrDefault, DEFAULT_PERSONA_ID } from '../fixtures/testFixtures';
import { formatCAD } from '../../utils/format';
import type { ProjectionResult } from '../../services/projection/types';

vi.mock('recharts', async () => {
    const React = await import('react');
    const P = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
    return {
        ResponsiveContainer: P, PieChart: P, BarChart: P, LineChart: P, AreaChart: P, ComposedChart: P,
        Pie: () => null, Bar: () => null, Area: () => null, Line: () => null, Cell: () => null,
        Legend: () => null, ReferenceLine: () => null, ReferenceArea: () => null, ReferenceDot: () => null,
        XAxis: () => null, YAxis: () => null, Tooltip: () => null, CartesianGrid: () => null,
    };
});
vi.mock('../../services/errorLogger', () => ({ logError: vi.fn(), logErrorThrottled: vi.fn(), onLogEntry: vi.fn(() => () => {}), __resetErrorThrottle: vi.fn(), }));
vi.mock('../../services/deepForecastStore', () => ({
    loadAppliedDeepForecast: vi.fn(async () => ({ status: 'empty' as const })),
    saveAppliedDeepForecast: vi.fn(async () => true),
    clearAppliedDeepForecast: vi.fn(async () => true),
}));

function Harness() {
    const projection = useFinanceStore((s) => s.projection);
    const config = useFinanceStore((s) => s.config);
    const retirementGoal = useFinanceStore((s) => s.retirementGoal);
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    return (
        <FutureProjection
            initialBalances={{}}
            transactions={[]}
            budgetItems={[]}
            config={config}
            realEstateGoals={[]}
            retirementGoal={retirementGoal}
            setRetirementGoal={(g) => act(() => { useFinanceStore.setState({ retirementGoal: g }); })}
            calculatedMonthlySavings={2000}
            projection={projection}
            setProjection={(p) => act(() => { useFinanceStore.setState({ projection: p }); })}
            isPrivacyMode={isPrivacyMode}
        />
    );
}

const scenarioAvec = (goalShortfalls: { count: number; total: number } | undefined) =>
    ({ strategyName: 'AUTO_MARGINAL', chartData: [], goalShortfalls } as unknown as ProjectionResult);

const monterDirect = async (goalShortfalls: { count: number; total: number } | undefined) => {
    const persona = getPersonaOrDefault(DEFAULT_PERSONA_ID);
    act(() => {
        useFinanceStore.getState().resetState();
        useFinanceStore.setState({
            ...(persona.build() as Record<string, unknown>),
            projectionRunMC: false, projectionStatus: 'idle',
            lastProjection: { chartData: [], fireNumber: 400_000, allResults: [scenarioAvec(goalShortfalls)] },
            isProjectionLocked: false, lockedProjection: null,
        });
    });
    render(<Harness />);
    await waitFor(() => expect(screen.getByRole('region', { name: /Projection affichée/i })).toBeInTheDocument());
};

const montantAffiche = (n: number): string => formatCAD(n).replace(/\s/g, ' ');

describe('[ENG-GOALSHORTFALLS-EXPOSE] le bandeau des objectifs non financés', () => {
    afterEach(() => {
        act(() => { useFinanceStore.getState().setPrivacyMode(false); });
        cleanup();
    });

    it('objectifs manqués → le bandeau dit le fait ET le manque en dollars', async () => {
        await monterDirect({ count: 2, total: 15_000 });
        expect(screen.getByText(/2 objectifs n'ont pas pu être financés en entier/)).toBeInTheDocument();
        expect(screen.getByText(montantAffiche(15_000))).toBeInTheDocument();
    });

    it('mode discret : le montant disparaît, le FAIT reste lisible', async () => {
        await monterDirect({ count: 1, total: 9_000 });
        expect(screen.getByText(montantAffiche(9_000))).toBeInTheDocument();
        act(() => { useFinanceStore.getState().setPrivacyMode(true); });
        expect(screen.queryByText(montantAffiche(9_000))).not.toBeInTheDocument();
        expect(screen.getByText(/Un objectif n'a pas pu être financé en entier/)).toBeInTheDocument();
    });

    it('aucun manque (ou champ absent) → AUCUN bandeau', async () => {
        await monterDirect({ count: 0, total: 0 });
        expect(screen.queryByText(/pas pu être financé/)).not.toBeInTheDocument();
        cleanup();
        await monterDirect(undefined);
        expect(screen.queryByText(/pas pu être financé/)).not.toBeInTheDocument();
    });
});
