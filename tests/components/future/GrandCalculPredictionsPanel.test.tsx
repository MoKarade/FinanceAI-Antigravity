/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { GrandCalculPredictionsPanel } from '../../../components/future/GrandCalculPredictionsPanel';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { GrandCalculResult } from '../../../services/projection/types';

const populatedResult: GrandCalculResult = {
    version: 1,
    paramsSig: 'gc1:r2:test:1',
    createdAt: '2026-11-17T00:00:00Z',
    durationMs: 1_500,
    iterationsRun: 50_000,
    regimesEnabled: true,
    historicalCrisesEnabled: true,
    survivalRatePct: 90,
    cvar95: 120_000,
    monthlyBands: [],
    fiAge: {
        reachedPct: 84.5,
        p5Age: 52,
        p50Age: 59,
        p95Age: 68,
        horizonAge: 90,
    },
    goalProbabilities: [
        {
            goalId: 'g1',
            name: 'Fonds urgence',
            deadline: '2030-06',
            targetAmount: 30_000,
            probabilityPct: 94.2,
            medianShortfall: 0,
            status: 'evaluated',
        },
        {
            goalId: 'g2',
            name: 'Projet lointain',
            deadline: '2099-01',
            targetAmount: 200_000,
            probabilityPct: null,
            medianShortfall: null,
            status: 'beyond_horizon',
        },
    ],
    guaranteedPurchasingPower: {
        p95SecurityMonthlyNetReal: 3_100,
        p90SecurityMonthlyNetReal: 3_450,
        p50SecurityMonthlyNetReal: 4_300,
        retirementMonthsEvaluated: 300,
    },
    estateTax: {
        deterministicTotal: 95_000,
        deterministicFed: 40_000,
        deterministicQc: 55_000,
        mcTotalP5: 45_000,
        mcTotalP50: 98_000,
        mcTotalP95: 180_000,
        mcFedP50: 41_000,
        mcQcP50: 57_000,
        mcRealTotalP50: 62_000,
        taxableBreakdown: {
            rrspRrif: 250_000,
            capitalGainsTaxable: 45_000,
            rentalRecapture: 15_000,
        },
        projectedDeathAge: 90,
    },
};

const initialStore = useFinanceStore.getState();

describe('GrandCalculPredictionsPanel (R2)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('délègue à ProjectionRequired si projectionRefus est défini', () => {
        useFinanceStore.setState({ projectionRefus: 'Salaire illisible' });
        render(<GrandCalculPredictionsPanel result={null} />);

        expect(screen.getByRole('status')).toHaveTextContent(/Donnée illisible/i);
        expect(screen.queryByRole('region', { name: /Prédictions/i })).not.toBeInTheDocument();
    });

    it('affiche les 4 cartes sémantiques avec « — » avant tout Grand Calcul (no-fake-data)', () => {
        render(<GrandCalculPredictionsPanel result={null} />);

        const region = screen.getByRole('region', { name: /Prédictions et jalons avancés/i });
        expect(region).toBeInTheDocument();

        expect(within(region).getByRole('region', { name: /indépendance financière/i })).toBeInTheDocument();
        expect(within(region).getByRole('region', { name: /objectifs? financiers?/i })).toBeInTheDocument();
        expect(within(region).getByRole('region', { name: /pouvoir d'achat/i })).toBeInTheDocument();
        expect(within(region).getByRole('region', { name: /impôt successoral/i })).toBeInTheDocument();

        expect(region.textContent).not.toMatch(/0\s*\$/);
        expect(within(region).getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(8);
    });

    it('signale un stockage illisible via role="status"', () => {
        render(<GrandCalculPredictionsPanel result={null} unreadableStorage />);

        expect(screen.getByRole('status')).toHaveTextContent(/Sauvegarde locale illisible/i);
    });

    it('respecte l’ordre strict des quantiles et la ventilation ARC/RQ + MC sur les 4 cartes', () => {
        render(<GrandCalculPredictionsPanel result={populatedResult} />);

        // 1. FI Age : P5 <= P50 <= P95 avant horizonAge
        const fiCard = screen.getByRole('region', { name: /indépendance financière/i });
        const fiAges = [...(fiCard.textContent ?? '').matchAll(/(\d{2,3})\s*ans/g)].map((m) => Number(m[1]));
        expect(fiAges).toEqual([52, 59, 68, 90]);

        // 2. Objectifs financiers
        const goalsCard = screen.getByRole('region', { name: /objectifs? financiers?/i });
        expect(within(goalsCard).getByText('Fonds urgence')).toBeInTheDocument();
        expect(within(goalsCard).getByText('Projet lointain')).toBeInTheDocument();
        expect(within(goalsCard).getByText('Hors horizon')).toBeInTheDocument();

        // 3. Pouvoir d'achat réel mensuel net garanti : P95 <= P90 <= P50 en dollars constants / mois
        const ppCard = screen.getByRole('region', { name: /pouvoir d'achat/i });
        expect(ppCard.textContent).toMatch(/dollars constants/i);
        expect(ppCard.textContent).toMatch(/\/\s*mois/i);
        const ppAmounts = [...(ppCard.textContent ?? '').matchAll(/(\d[\d\s\u00a0\u202f]*)\s*\$/g)].map((m) =>
            Number(m[1].replace(/[\s\u00a0\u202f]/g, '')),
        );
        expect(ppAmounts).toEqual([3100, 3450, 4300]);

        // 4. Impôt successoral : tableaux sémantiques déterministe (Total, ARC, RQ) puis MC (P5, P50, P95) + ventilation + âge décès
        const estateCard = screen.getByRole('region', { name: /impôt successoral/i });
        const tables = within(estateCard).getAllByRole('table');
        expect(tables.length).toBe(3);

        const detRows = within(tables[0]).getAllByRole('row');
        expect(within(detRows[0]).getByRole('rowheader')).toHaveTextContent(/Total/i);
        expect(within(detRows[0]).getByRole('cell')).toHaveTextContent(/95[\s\u00a0\u202f]000\s*\$/);
        expect(within(detRows[1]).getByRole('rowheader')).toHaveTextContent(/ARC/i);
        expect(within(detRows[1]).getByRole('cell')).toHaveTextContent(/40[\s\u00a0\u202f]000\s*\$/);
        expect(within(detRows[2]).getByRole('rowheader')).toHaveTextContent(/Revenu Québec/i);
        expect(within(detRows[2]).getByRole('cell')).toHaveTextContent(/55[\s\u00a0\u202f]000\s*\$/);

        const mcRows = within(tables[1]).getAllByRole('row');
        expect(within(mcRows[0]).getByRole('rowheader')).toHaveTextContent(/^P5$/i);
        expect(within(mcRows[0]).getByRole('cell')).toHaveTextContent(/45[\s\u00a0\u202f]000\s*\$/);
        expect(within(mcRows[1]).getByRole('rowheader')).toHaveTextContent(/^P50$/i);
        expect(within(mcRows[1]).getByRole('cell')).toHaveTextContent(/98[\s\u00a0\u202f]000\s*\$/);
        expect(within(mcRows[2]).getByRole('rowheader')).toHaveTextContent(/^P95$/i);
        expect(within(mcRows[2]).getByRole('cell')).toHaveTextContent(/180[\s\u00a0\u202f]000\s*\$/);

        const estateText = estateCard.textContent ?? '';
        expect(estateText).toMatch(/REER\s*\/\s*FERR/i);
        expect(estateText).toMatch(/Gain en capital imposable/i);
        expect(estateText).toMatch(/Récupération DPA/i);
        expect(estateText).toMatch(/90\s*ans/);
    });

    it('affiche un état vide honnête si goalProbabilities est vide et « — » si FI inatteignable', () => {
        const unreachable: GrandCalculResult = {
            ...populatedResult,
            fiAge: { reachedPct: 0, p5Age: null, p50Age: null, p95Age: null, horizonAge: 90 },
            goalProbabilities: [],
        };
        render(<GrandCalculPredictionsPanel result={unreachable} />);

        const goalsCard = screen.getByRole('region', { name: /objectifs? financiers?/i });
        expect(goalsCard).toHaveTextContent(/Aucun objectif financier/i);

        const fiCard = screen.getByRole('region', { name: /indépendance financière/i });
        expect(within(fiCard).getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(3);
    });

    it('masque tous les montants, pourcentages, âges et mois en mode discret', () => {
        useFinanceStore.setState({ isPrivacyMode: true });
        const { container } = render(<GrandCalculPredictionsPanel result={populatedResult} />);

        expect(container.textContent).not.toContain('$');
        expect(container.textContent).not.toContain('59 ans');
        expect(container.textContent).not.toContain('300 mois');
        expect(container.textContent).not.toContain('84,5');
        expect(screen.getAllByText('Montant masqué').length).toBeGreaterThanOrEqual(10);
    });

    it('couvre les statuts already_completed / invalid_deadline, badge isStale, retirementMonthsEvaluated: 0, NaN et masquage des noms d’objectifs', () => {
        const edgeResult: GrandCalculResult = {
            ...populatedResult,
            fiAge: { reachedPct: Number.NaN, p5Age: Number.NaN, p50Age: null, p95Age: null, horizonAge: 90 },
            goalProbabilities: [
                {
                    goalId: 'g-done',
                    name: 'Léguer 500 k$',
                    deadline: '2030-01',
                    targetAmount: 500_000,
                    probabilityPct: 100,
                    medianShortfall: 0,
                    status: 'already_completed',
                },
                {
                    goalId: 'g-bad',
                    name: 'Objectif sans échéance',
                    deadline: '',
                    targetAmount: 25_000,
                    probabilityPct: null,
                    medianShortfall: null,
                    status: 'invalid_deadline',
                },
            ],
            guaranteedPurchasingPower: {
                p95SecurityMonthlyNetReal: null,
                p90SecurityMonthlyNetReal: null,
                p50SecurityMonthlyNetReal: null,
                retirementMonthsEvaluated: 0,
            },
        };

        const { rerender, container } = render(<GrandCalculPredictionsPanel result={edgeResult} isStale />);
        expect(screen.getByRole('status')).toHaveTextContent(/Paramètres modifiés/i);
        expect(screen.getByText('Atteint')).toBeInTheDocument();
        expect(screen.getByText('Échéance invalide')).toBeInTheDocument();
        expect(container.textContent).not.toContain('NaN');
        // retirementMonthsEvaluated === 0 et deadline === '' utilisent emptyAware (« Pas de donnée »)
        expect(screen.getAllByText('Pas de donnée').length).toBeGreaterThanOrEqual(7);

        // Mode discret : un nom d'objectif contenant un montant (« Léguer 500 k$ ») disparaît du DOM
        useFinanceStore.setState({ isPrivacyMode: true });
        rerender(<GrandCalculPredictionsPanel result={edgeResult} />);
        expect(container.textContent).not.toContain('Léguer 500 k$');
        expect(container.textContent).not.toContain('500 k$');
        expect(container.textContent).not.toContain('$');
        expect(screen.getAllByText('Valeur masquée').length).toBeGreaterThanOrEqual(2);
    });
});
