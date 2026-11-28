import { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Budget } from '../../components/Budget';
import type { BudgetCategory, BudgetConfig, Transaction, User } from '../../types';

vi.mock('recharts', async () => {
    const React = await import('react');
    const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
    return {
        ResponsiveContainer: Passthrough,
        PieChart: Passthrough,
        Pie: () => null,
        Cell: () => null,
        Tooltip: () => null,
        Legend: () => null,
        BarChart: Passthrough,
        Bar: () => null,
        XAxis: () => null,
        YAxis: () => null,
        CartesianGrid: () => null,
        ReferenceLine: () => null,
        LineChart: Passthrough,
        Line: () => null,
    };
});

const coupleConfig: BudgetConfig = {
    users: [
        { name: 'Marc', grossSalary: 6000, netSalary: 4500, color: '#10b981', age: 35, birthYear: 1991, canadaArrivalYear: 1991, hasOwnedPropertyLast4Years: false, celiContributed: 0, rrspContributed: 0 } as unknown as User,
        { name: 'Anna', grossSalary: 6000, netSalary: 4500, color: '#3b82f6', age: 33, birthYear: 1993, canadaArrivalYear: 1993, hasOwnedPropertyLast4Years: false, celiContributed: 0, rrspContributed: 0 } as unknown as User,
    ],
    splitMode: '50/50',
};

describe('Budget — améliorations ergonomie, filtre personne et parité en 1 clic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('filtre les postes par conjoint via personFilter (part du commun + perso du conjoint seulement)', () => {
        const items: BudgetCategory[] = [
            { id: 'c1', name: 'Loyer', target: 2000, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
            { id: 'c2', name: 'Sport Marc', target: 120, frequency: 'Monthly', type: 'Perso 1', nature: 'Envie' },
            { id: 'c3', name: 'Loisirs Anna', target: 150, frequency: 'Monthly', type: 'Perso 2', nature: 'Envie' },
        ];
        const setBudgetItems = vi.fn();
        render(
            <Budget
                transactions={[]}
                config={coupleConfig}
                budgetItems={items}
                setBudgetItems={setBudgetItems}
                apiKey=""
            />,
        );

        expect(screen.getByRole('button', { name: 'Sport Marc' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Loisirs Anna' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: 'Marc' }));

        expect(screen.getByRole('button', { name: 'Sport Marc' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Loisirs Anna' })).toBeNull();
        expect(screen.getByText(/Vue : Marc/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Voir le couple/i }));
        expect(screen.getByRole('button', { name: 'Loisirs Anna' })).toBeInTheDocument();
    });

    it('maintient le budget synchronisé, aligne les postes manuels qui dérivent et nettoie les postes vides en 1 clic', () => {
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 12).toISOString().slice(0, 10);
        const curMonth = new Date(now.getFullYear(), now.getMonth(), 5).toISOString().slice(0, 10);
        const txs: Transaction[] = [
            { id: '1', date: prevMonth, payee: 'Resto', category: 'Restaurants', amount: -400 } as unknown as Transaction,
            { id: '2', date: curMonth, payee: 'Taxi', category: 'Transport', amount: -90 } as unknown as Transaction,
            { id: '3', date: curMonth, payee: 'RQ', category: 'Impôts', amount: -500 } as unknown as Transaction,
        ];
        const initial: BudgetCategory[] = [
            { id: 'r1', name: 'Restaurants', target: 100, frequency: 'Monthly', type: 'Commun', nature: 'Envie', autoTarget: false },
            { id: 'u1', name: 'Poste inutilisé', target: 80, frequency: 'Monthly', type: 'Commun', nature: 'Envie', autoTarget: false },
        ];

        const Wrapper = () => {
            const [items, setItems] = useState(initial);
            return <Budget transactions={txs} config={coupleConfig} budgetItems={items} setBudgetItems={setItems} apiKey="" />;
        };

        render(<Wrapper />);

        // Sync automatique au montage : Transport ajouté automatiquement, Impôts exclu du bouton + Ajouter
        expect(screen.getByRole('button', { name: 'Transport' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Ajouter Impôts au budget' })).toBeNull();

        // « Aligner sur le réel (1) » apparaît pour Restaurants (100 $ vs moy. 400 $)
        const btnAlign = screen.getByRole('button', { name: /Aligner sur le réel \(1\)/i });
        fireEvent.click(btnAlign);
        expect(screen.queryByRole('button', { name: /Aligner sur le réel/i })).toBeNull();

        // Ajouter un poste manuel vide puis le nettoyer d'un seul clic via Parité
        fireEvent.click(screen.getByRole('button', { name: 'Ajouter un poste dans Besoins' }));
        expect(screen.getByRole('button', { name: 'Nouvelle Catégorie' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Nettoyer \(1\)/i }));
        expect(screen.queryByRole('button', { name: 'Nouvelle Catégorie' })).toBeNull();
    });
});
