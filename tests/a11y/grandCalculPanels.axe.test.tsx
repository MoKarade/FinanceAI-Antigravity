/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type * as AxeCore from 'axe-core';
import { GrandCalculPanel } from '../../components/future/GrandCalculPanel';
import { GrandCalculPredictionsPanel } from '../../components/future/GrandCalculPredictionsPanel';
import { CurveExplanationPanel } from '../../components/projection/CurveExplanationPanel';
import { useFinanceStore } from '../../store/useFinanceStore';
import type { GrandCalculResult, ProjectionChartPoint } from '../../services/projection/types';

async function expectNoSeriousViolations(container: HTMLElement) {
    const results = await axe(container);
    const serious = (results.violations || []).filter(
        (v: AxeCore.Result) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toHaveLength(0);
}

function assertTouchTargetClasses(container: HTMLElement) {
    const controls = container.querySelectorAll('button, input, select, textarea, [role="switch"]');
    for (const el of controls) {
        const cls = el.getAttribute('class') ?? '';
        expect(
            cls.includes('touch-target') || cls.includes('min-h-11') || cls.includes('h-11'),
            `Contrôle sans classe 44px : ${el.tagName} "${el.textContent?.trim()}" (${cls})`,
        ).toBe(true);
    }
}

const sampleResult: GrandCalculResult = {
    version: 1,
    paramsSig: 'gc1:axe:test:1',
    createdAt: '2026-11-17T00:00:00Z',
    durationMs: 1_200,
    iterationsRun: 50_000,
    regimesEnabled: true,
    historicalCrisesEnabled: true,
    survivalRatePct: 90.5,
    cvar95: 150_000,
    monthlyBands: [
        { monthIndex: 0, year: 2026, age: 40, p5: 100_000, p10: 110_000, p25: 120_000, p50: 130_000, p75: 140_000, p90: 150_000, p95: 160_000 },
    ],
    fiAge: { reachedPct: 86, p5Age: 52, p50Age: 58, p95Age: 65, horizonAge: 90 },
    goalProbabilities: [
        {
            goalId: 'g1',
            name: 'Coussin',
            deadline: '2030-01',
            targetAmount: 25_000,
            probabilityPct: 95,
            medianShortfall: 0,
            status: 'evaluated',
        },
    ],
    guaranteedPurchasingPower: {
        p95SecurityMonthlyNetReal: 3_000,
        p90SecurityMonthlyNetReal: 3_300,
        p50SecurityMonthlyNetReal: 4_100,
        retirementMonthsEvaluated: 300,
    },
    estateTax: {
        deterministicTotal: 80_000,
        deterministicFed: 35_000,
        deterministicQc: 45_000,
        mcTotalP5: 40_000,
        mcTotalP50: 82_000,
        mcTotalP95: 140_000,
        mcFedP50: 36_000,
        mcQcP50: 46_000,
        mcRealTotalP50: 55_000,
        taxableBreakdown: { rrspRrif: 200_000, capitalGainsTaxable: 30_000, rentalRecapture: 0 },
        projectedDeathAge: 90,
    },
};

const chartData: ProjectionChartPoint[] = [
    {
        monthIndex: 0,
        year: 2026,
        age: 40,
        dateLabel: '2026-01',
        NetWorth: 200_000,
        Income: 6_000,
        Expenses: 3_500,
        ImpotLatent: 30_000,
    },
    {
        monthIndex: 300,
        year: 2051,
        age: 65,
        dateLabel: '2051-01',
        NetWorth: 900_000,
        isRetired: true,
        pensionRRQ: 1_100,
        pensionPSV: 720,
        Expenses: 4_200,
        ImpotLatent: 120_000,
    },
];

const initialStore = useFinanceStore.getState();

describe('Accessibilité WCAG (vitest-axe) — Panneaux M4 R1/R2/R3', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('GrandCalculPanel — états idle, running, ready+stale et error sans violation ni cible < 44px', async () => {
        const baseProps = {
            result: null,
            status: 'idle' as const,
            progress: null,
            error: null,
            config: { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: true },
            onUpdateConfig: () => {},
            isStale: false,
            showBands: true,
            onToggleBands: () => {},
            onLaunch: () => {},
            onCancel: () => {},
            onClear: () => {},
            isRunning: false,
            isRestoring: false,
            refusMessage: null,
        };

        const { container, rerender } = render(<GrandCalculPanel {...baseProps} />);
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        rerender(
            <GrandCalculPanel
                {...baseProps}
                status="running"
                isRunning
                progress={{ done: 25_000, total: 50_000, pct: 50, simPerSec: 10_000, etaMs: 2_500 }}
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        rerender(<GrandCalculPanel {...baseProps} result={sampleResult} status="ready" isStale />);
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        rerender(<GrandCalculPanel {...baseProps} status="error" error="Erreur lors du Grand Calcul" />);
        await expectNoSeriousViolations(container);
    });

    it('GrandCalculPredictionsPanel — états vide, peuplé et illisible sans violation', async () => {
        const { container, rerender } = render(<GrandCalculPredictionsPanel result={null} />);
        await expectNoSeriousViolations(container);

        rerender(<GrandCalculPredictionsPanel result={sampleResult} isStale />);
        await expectNoSeriousViolations(container);

        rerender(<GrandCalculPredictionsPanel result={null} unreadableStorage />);
        await expectNoSeriousViolations(container);
    });

    it('CurveExplanationPanel — replié et déplié sans violation ni cible < 44px', async () => {
        const { container } = render(
            <CurveExplanationPanel
                chartData={chartData}
                grandCalculResult={sampleResult}
                selectedPoint={chartData[0]}
                onSelectMonth={() => {}}
            />,
        );
        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);

        const firstAccordion = container.querySelector('button[aria-expanded="false"]');
        expect(firstAccordion).not.toBeNull();
        if (firstAccordion) fireEvent.click(firstAccordion);

        await expectNoSeriousViolations(container);
        assertTouchTargetClasses(container);
    });
});
