/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { D3MonteCarloModule } from '../../../components/valoria/D3MonteCarloModule';
import { getLatestPrices } from '../../../services/valoria/marketData';

describe('D3MonteCarloModule — courbe passée depuis janvier 2025', () => {
    it('affiche la courbe passée depuis janv. 2025 raccordée au cône stochastique et la ligne Aujourd’hui', () => {
        const prices = getLatestPrices();
        const spotXbb = prices.XBB ?? 100;
        const dailyHistoryCad: [string, number][] = [];
        for (let i = 0; i < 23; i++) {
            const y = 2025 + Math.floor(i / 12);
            const m = (i % 12) + 1;
            dailyHistoryCad.push([
                `${y}-${String(m).padStart(2, '0')}-15`,
                Number((spotXbb * (0.92 + i * 0.004)).toFixed(2)),
            ]);
        }

        const { container } = render(
            <D3MonteCarloModule
                lots={[
                    {
                        id: 'lot-xbb',
                        assetId: 'XBB',
                        investedAmount: 25_000,
                        purchaseYearMonth: '2025-01',
                        purchaseDate: '2025-01-10',
                        quantity: 250,
                        baseSpotPriceCad: spotXbb,
                        dailyHistoryCad,
                    },
                ]}
                livePrices={prices}
            />,
        );

        expect(screen.getByTestId('d3-montecarlo-fan-svg')).toBeTruthy();
        expect(container.querySelector('[data-testid="d3-mc-past-curve"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="d3-mc-today-line"]')).not.toBeNull();
        expect(screen.getByText(/Passé réel \(depuis janv\. 2025\)/i)).toBeTruthy();
        expect(screen.getByText(/Aujourd’hui/i)).toBeTruthy();
    });
});
