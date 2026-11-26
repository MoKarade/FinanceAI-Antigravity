import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PlanningHubBar } from '../../components/PlanningHubBar';
import { Tab } from '../../types';

describe('PlanningHubBar', () => {
    it('affiche les 5 destinations de Planification et marque la page courante', () => {
        const onSelectTab = vi.fn();
        render(<PlanningHubBar activeTab={Tab.RETIREMENT} onSelectTab={onSelectTab} />);

        const nav = screen.getByRole('navigation', { name: 'Espace Planification' });
        const buttons = within(nav).getAllByRole('button');
        expect(buttons.map((b) => b.textContent?.trim())).toEqual([
            'Retraite',
            'Immobilier',
            'Enfants',
            'Projets de vie',
            'Impôts',
        ]);
        expect(within(nav).getByRole('button', { name: 'Retraite' })).toHaveAttribute('aria-current', 'page');

        fireEvent.click(within(nav).getByRole('button', { name: 'Impôts' }));
        expect(onSelectTab).toHaveBeenCalledWith(Tab.TAX);
    });

    it('marque Immobilier actif lorsque Projets immo (REAL_ESTATE_PROJECTS) est affiché', () => {
        render(<PlanningHubBar activeTab={Tab.REAL_ESTATE_PROJECTS} onSelectTab={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Immobilier' })).toHaveAttribute('aria-current', 'page');
    });
});
