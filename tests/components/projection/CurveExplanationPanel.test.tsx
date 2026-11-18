/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { CurveExplanationPanel } from '../../../components/projection/CurveExplanationPanel';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { GrandCalculResult, ProjectionChartPoint } from '../../../services/projection/types';

function makeChartData(): ProjectionChartPoint[] {
    return [
        {
            monthIndex: 0,
            year: 2026,
            age: 40,
            dateLabel: '2026-01',
            NetWorth: 200_000,
            Liquidites: 20_000,
            CELI: 60_000,
            REER: 120_000,
            Income: 6_000,
            Expenses: 3_500,
            ContribCELI: 500,
            ContribREER: 800,
            MarketGrowthCELI: 300,
            MarketGrowthREER: 600,
            marginalTaxRate: 37.1,
            effectiveTaxRate: 21.4,
            ImpotSalaireMois: 1_400,
            ImpotLatent: 35_000,
        },
        {
            monthIndex: 120,
            year: 2036,
            age: 50,
            dateLabel: '2036-01',
            NetWorth: 550_000,
            Liquidites: 30_000,
            CELI: 180_000,
            REER: 340_000,
            Income: 6_500,
            Expenses: 3_800,
            lifeEvents: ['Achat chalet'],
            ImpotLatent: 90_000,
        },
        {
            monthIndex: 300,
            year: 2051,
            age: 65,
            dateLabel: '2051-01',
            NetWorth: 1_200_000,
            Liquidites: 40_000,
            CELI: 400_000,
            REER: 760_000,
            isRetired: true,
            pensionRRQ: 1_100,
            pensionPSV: 720,
            Expenses: 4_500,
            ImpotRetraitREER: 600,
            ImpotLatent: 190_000,
        },
        {
            monthIndex: 384,
            year: 2058,
            age: 72,
            dateLabel: '2058-01',
            NetWorth: 1_100_000,
            Liquidites: 40_000,
            CELI: 420_000,
            REER: 640_000,
            isRetired: true,
            pensionRRQ: 1_200,
            pensionPSV: 780,
            Expenses: 4_700,
            ImpotRetraitREER: 900,
            ImpotLatent: 170_000,
        },
    ];
}

const initialStore = useFinanceStore.getState();

describe('CurveExplanationPanel (R3)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('affiche la synthèse Niveau 1 et garde les volets Niveau 2 fermés puis indépendamment dépliables', () => {
        const chartData = makeChartData();
        render(<CurveExplanationPanel chartData={chartData} />);

        const region = screen.getByRole('region', { name: /Explications de la courbe/i });
        expect(region).toBeInTheDocument();

        const accordions = within(region).getAllByRole('button', {
            name: /Détail chiffré et justifications fiscales/i,
        });
        expect(accordions.length).toBeGreaterThanOrEqual(3);
        for (const btn of accordions) {
            expect(btn).toHaveAttribute('aria-expanded', 'false');
        }

        // Déplier deux volets indépendamment
        fireEvent.click(accordions[0]);
        fireEvent.click(accordions[1]);

        expect(accordions[0]).toHaveAttribute('aria-expanded', 'true');
        expect(accordions[1]).toHaveAttribute('aria-expanded', 'true');
        expect(accordions[2]).toHaveAttribute('aria-expanded', 'false');

        const detailRegions = within(region).getAllByRole('region');
        expect(detailRegions.length).toBeGreaterThanOrEqual(2);
        expect(detailRegions[0]).toHaveTextContent(/Accumulation/i);
        expect(detailRegions[0]).toHaveTextContent(/Décaissement/i);
        expect(detailRegions[0]).toHaveTextContent(/Fiscalité/i);
    });

    it('résout un point quotidien via hostMonthIndex, gère le passé et déclenche onSelectMonth au clic', () => {
        const chartData = makeChartData();
        const onSelectMonth = vi.fn();

        const dailySelected: ProjectionChartPoint = {
            ...chartData[2],
            monthIndex: 300.45,
            hostMonthIndex: 300,
            isDailyPoint: true,
        };

        const { rerender } = render(
            <CurveExplanationPanel
                chartData={chartData}
                selectedPoint={dailySelected}
                selectedOrigin="epingle"
                onSelectMonth={onSelectMonth}
            />,
        );

        expect(screen.getByText('Point inspecté sur la courbe')).toBeInTheDocument();
        expect(screen.getByText('Épinglé')).toBeInTheDocument();

        const jumpButtons = screen.getAllByRole('button', { name: /Voir sur la courbe/i });
        fireEvent.click(jumpButtons[0]);
        expect(onSelectMonth).toHaveBeenCalledTimes(1);

        // Point passé négatif (-5 et -0.5 qui donne Math.trunc === -0) -> note honnête
        rerender(
            <CurveExplanationPanel
                chartData={chartData}
                selectedPoint={{ monthIndex: -5, NetWorth: 150_000, dayIsReal: true }}
                selectedOrigin="survol"
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(/Jour passé reconstruit/i);

        rerender(
            <CurveExplanationPanel
                chartData={chartData}
                selectedPoint={{ monthIndex: -0.5, isPast: true, dayIsReal: true, NetWorth: 149_000 }}
                selectedOrigin="survol"
            />,
        );
        expect(screen.getByRole('status')).toHaveTextContent(/Jour passé reconstruit/i);
        expect(screen.queryByText('Point inspecté sur la courbe')).not.toBeInTheDocument();
    });

    it('protège contre NaN sur year/age non finis et gère un tableau vide honnêtement', () => {
        const unbandedPoint: ProjectionChartPoint[] = [
            {
                monthIndex: 0,
                NetWorth: 100_000,
            },
        ];

        const { container, rerender } = render(<CurveExplanationPanel chartData={unbandedPoint} />);
        expect(container.textContent).not.toContain('NaN');
        expect(container.textContent).not.toContain('undefined');

        rerender(<CurveExplanationPanel chartData={[]} />);
        expect(screen.getByText(/Aucune inflexion future/i)).toBeInTheDocument();
    });

    it('masque toutes les valeurs numériques personnelles aux niveaux 1 et 2 en mode discret (y compris projectedDeathAge dans rationaleFr)', () => {
        useFinanceStore.setState({ isPrivacyMode: true });
        const chartData = makeChartData();
        const grandCalculWithEstate: GrandCalculResult = {
            version: 1,
            paramsSig: 'gc1:priv:1',
            createdAt: '2026-11-17T00:00:00Z',
            durationMs: 1000,
            iterationsRun: 50_000,
            regimesEnabled: true,
            historicalCrisesEnabled: true,
            survivalRatePct: 92,
            cvar95: 150_000,
            monthlyBands: [],
            fiAge: { reachedPct: 80, p5Age: 52, p50Age: 60, p95Age: 68, horizonAge: 90 },
            goalProbabilities: [],
            guaranteedPurchasingPower: {
                p95SecurityMonthlyNetReal: 3_000,
                p90SecurityMonthlyNetReal: 3_300,
                p50SecurityMonthlyNetReal: 4_000,
                retirementMonthsEvaluated: 240,
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
        const { container } = render(
            <CurveExplanationPanel chartData={chartData} grandCalculResult={grandCalculWithEstate} />,
        );

        const accordions = screen.getAllByRole('button', {
            name: /Détail chiffré et justifications fiscales/i,
        });
        for (const btn of accordions) {
            fireEvent.click(btn);
        }

        expect(container.textContent).not.toContain('$');
        expect(container.textContent).not.toContain('40 ans');
        expect(container.textContent).not.toContain('90 ans');
        expect(container.textContent).not.toContain('21,4');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(5);
    });

    it('traite un point quotidien réel du mois 0 (dayIsReal: true, hostMonthIndex: 0) comme un jour passé reconstruit', () => {
        const chartData = makeChartData();
        render(
            <CurveExplanationPanel
                chartData={chartData}
                selectedPoint={{
                    monthIndex: 0.25,
                    hostMonthIndex: 0,
                    isDailyPoint: true,
                    dayIsReal: true,
                    NetWorth: 199_500,
                }}
                selectedOrigin="survol"
            />,
        );

        expect(screen.getByRole('status')).toHaveTextContent(/Jour passé reconstruit/i);
        expect(screen.queryByText('Point inspecté sur la courbe')).not.toBeInTheDocument();
    });

    it('rend emptyAware (Pas de donnée) sur une année non finie et masque année + âge médian FIRE en mode discret', () => {
        // 1) Année NaN -> tiret accessible « Pas de donnée »
        useFinanceStore.setState({ isPrivacyMode: false });
        const nanYearData: ProjectionChartPoint[] = [
            {
                monthIndex: 0,
                year: Number.NaN,
                age: 40,
                NetWorth: 100_000,
            },
        ];
        const { unmount } = render(<CurveExplanationPanel chartData={nanYearData} />);
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(1);
        unmount();

        // 2) Mode discret sur jalon FIRE (objectif) et épuisement : année et fiAge.p50Age masqués
        useFinanceStore.setState({ isPrivacyMode: true });
        const fireAndDepletionData: ProjectionChartPoint[] = [
            {
                monthIndex: 0,
                year: 2026,
                age: 40,
                NetWorth: 300_000,
                FireTarget: 1_000_000,
            },
            {
                monthIndex: 168,
                year: 2040,
                age: 54,
                NetWorth: 1_100_000,
                FireTarget: 1_000_000,
            },
            {
                monthIndex: 360,
                year: 2056,
                age: 70,
                NetWorth: -5_000,
                LiquidDebt: 5_000,
                isRetired: true,
            },
        ];
        const gcResult: GrandCalculResult = {
            version: 1,
            paramsSig: 'gc1:priv-fire',
            createdAt: '2026-11-17T00:00:00Z',
            durationMs: 100,
            iterationsRun: 50_000,
            regimesEnabled: true,
            historicalCrisesEnabled: false,
            survivalRatePct: 80,
            cvar95: 0,
            monthlyBands: [],
            fiAge: { reachedPct: 75, p5Age: 50, p50Age: 57, p95Age: null, horizonAge: 90 },
            goalProbabilities: [],
            guaranteedPurchasingPower: {
                p95SecurityMonthlyNetReal: 2500,
                p90SecurityMonthlyNetReal: 2900,
                p50SecurityMonthlyNetReal: 3500,
                retirementMonthsEvaluated: 200,
            },
            estateTax: {
                deterministicTotal: 0,
                deterministicFed: 0,
                deterministicQc: 0,
                mcTotalP5: 0,
                mcTotalP50: 0,
                mcTotalP95: 0,
                mcFedP50: 0,
                mcQcP50: 0,
                mcRealTotalP50: 0,
                taxableBreakdown: { rrspRrif: 0, capitalGainsTaxable: 0, rentalRecapture: 0 },
                projectedDeathAge: 90,
            },
        };
        const { container } = render(
            <CurveExplanationPanel chartData={fireAndDepletionData} grandCalculResult={gcResult} />,
        );
        expect(container.textContent).not.toContain('2040');
        expect(container.textContent).not.toContain('2056');
        expect(container.textContent).not.toContain('57 ans');
        expect(container.textContent).not.toContain('54 ans');
        expect(container.textContent).not.toContain('$');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(4);
    });
});
