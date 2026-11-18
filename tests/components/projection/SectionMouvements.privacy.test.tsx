/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionMouvements, type PointJour } from '../../../components/projection/panneauJour/sections';
import { FutureDetailModal } from '../../../components/projection/FutureDetailModal';
import { renderPanneauJour } from '../../helpers/panneauJour';
import { buildDailyLedger } from '../../../services/projection/dailyLedger';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { ProjectionChartPoint } from '../../../services/projection/types';

const initialStore = useFinanceStore.getState();

function makeDay1PointFromLedger(): PointJour {
    const months: ProjectionChartPoint[] = [
        {
            monthIndex: 0,
            year: 2026,
            age: 84,
            dateLabel: 'déc. 2026',
            NetWorth: 25_000,
            Liquidites: 25_000,
        },
        {
            monthIndex: 1,
            year: 2027,
            age: 85,
            dateLabel: 'janv. 2027',
            NetWorth: 12_655,
            Liquidites: 0,
            LiquidDebt: 12_345,
            Expenses: 12_345,
            flowEvents: ['⚠️ Dépense non couverte (comptes de décaissement épuisés) : 12 345 $ — portée en dette'],
            lifeEvents: ['🏥 Soins de longue durée déclenchés à 85 ans'],
        },
    ];

    const days = buildDailyLedger({
        months,
        startYear: 2027,
        startMonth: 0,
        dated: { recurring: [], monthlyNetSalary: 0, monthlyDebtPayment: 0 },
    });
    expect(days.length).toBeGreaterThanOrEqual(1);
    return days[0] as PointJour;
}

describe('Mode Discret — SectionMouvements, PanneauJour et FutureDetailModal (événements Jour 1)', () => {
    beforeEach(() => {
        useFinanceStore.setState(initialStore, true);
    });

    it('affiche les flowEvents/lifeEvents du Jour 1 hors mode discret et les retire totalement du DOM en mode discret', () => {
        const day1 = makeDay1PointFromLedger();
        expect(day1.dayOfMonth).toBe(1);
        expect(day1.flowEvents?.length).toBe(1);
        expect(day1.lifeEvents?.length).toBe(1);

        // 1) Hors mode discret : SectionMouvements affiche les montants CAD et l'âge des événements
        const { rerender, container } = render(<SectionMouvements data={day1} />);
        expect(container.textContent).toContain('12 345 $');
        expect(container.textContent).toContain('85 ans');

        // 2) Mode discret actif : zéro montant CAD, zéro âge, zéro texte d'événement dans le DOM
        useFinanceStore.setState({ isPrivacyMode: true });
        rerender(<SectionMouvements data={day1} />);
        expect(container.textContent).not.toContain('$');
        expect(container.textContent).not.toContain('12 345');
        expect(container.textContent).not.toContain('85 ans');
        expect(container.textContent).not.toContain('Soins de longue durée');
        expect(screen.getByText(/2 événements masqués/i)).toBeInTheDocument();
    });

    it('masque aussi l’âge dans PanneauJour et les événements/âge dans FutureDetailModal en mode discret', () => {
        const day1 = makeDay1PointFromLedger();

        // PanneauJour hors mode discret -> âge visible
        useFinanceStore.setState({ isPrivacyMode: false });
        const pj = renderPanneauJour(day1);
        expect(pj.container.textContent).toContain('Âge 85');
        expect(pj.container.textContent).toContain('12 345 $');
        pj.unmount();

        // PanneauJour en mode discret -> âge, $ et événement absents
        useFinanceStore.setState({ isPrivacyMode: true });
        const pjPriv = renderPanneauJour(day1);
        expect(pjPriv.container.textContent).not.toContain('Âge 85');
        expect(pjPriv.container.textContent).not.toContain('85 ans');
        expect(pjPriv.container.textContent).not.toContain('12 345');
        expect(pjPriv.container.textContent).not.toContain('$');
        pjPriv.unmount();

        // FutureDetailModal en mode discret -> flowEvents/lifeEvents et âge masqués
        const modal = render(
            <FutureDetailModal
                point={day1}
                chartData={[day1]}
                isPrivacyMode
                onClose={vi.fn()}
            />,
        );
        const bodyText = document.body.textContent ?? '';
        expect(bodyText).not.toContain('12 345');
        expect(bodyText).not.toContain('85 ans');
        expect(bodyText).not.toContain('Âge 85');
        expect(bodyText).not.toContain('Soins de longue durée');
        expect(bodyText).not.toContain('$');
        expect(screen.getByText(/2 événements ce mois-ci/i)).toBeInTheDocument();
        modal.unmount();
    });
});
