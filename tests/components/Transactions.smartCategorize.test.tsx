import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { Transactions } from '../../components/Transactions';
import { useFinanceStore } from '../../store/useFinanceStore';
import type { BudgetCategory, CategorizationRule, Transaction } from '../../types';

vi.mock('../../services/gemini', () => ({
    categorizeBatch: vi.fn(),
    CATEGORIZE_MODEL_ID: 'gemini-3.5-flash-lite',
}));
vi.mock('../../components/ui/Toast', () => ({ showToast: vi.fn() }));

const BUDGET_ITEMS: BudgetCategory[] = [
    { id: 'b1', name: 'Épicerie & Alimentation', target: 600, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
    { id: 'b2', name: 'Transport', target: 300, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
];

function TransactionsHarness({ initialTxs, initialRules = [] }: { initialTxs: Transaction[]; initialRules?: CategorizationRule[] }) {
    const [txs, setTxs] = useState<Transaction[]>(initialTxs);
    const [rules, setRules] = useState<CategorizationRule[]>(initialRules);
    return (
        <div>
            <div data-testid="rules-count">{rules.length}</div>
            <Transactions
                transactions={txs}
                setTransactions={setTxs}
                apiKey=""
                budgetItems={BUDGET_ITEMS}
                categorizationRules={rules}
                setCategorizationRules={setRules}
            />
        </div>
    );
}

describe('Transactions — classement intelligent, apprentissage et reclassement réversible', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn();
        useFinanceStore.setState({ isPrivacyMode: false });
    });

    afterEach(() => {
        useFinanceStore.setState({ isPrivacyMode: false });
    });

    it('compte Non catégorisé et faible confiance dans À vérifier et permet de confirmer en un clic', () => {
        render(
            <TransactionsHarness
                initialTxs={[
                    { id: 1, date: '2026-10-10', payee: 'MARCHAND XYZ', amount: -42, category: 'Non catégorisé', status: 'processed' },
                    { id: 2, date: '2026-10-11', payee: 'COSTCO WHOLESALE', amount: -450, category: 'Épicerie & Alimentation', status: 'processed', confidence: 65 },
                    { id: 3, date: '2026-10-12', payee: 'TIM HORTONS', amount: -6, category: 'Restaurants', status: 'processed', confidence: 95 },
                ]}
            />,
        );

        expect(screen.getByText('À vérifier · 2')).toBeInTheDocument();
        expect(screen.getByText(/transactions · 1 groupe à classer/)).toBeInTheDocument();

        const confirmBtn = screen.getByLabelText('Confirmer la catégorie de COSTCO WHOLESALE');
        fireEvent.click(confirmBtn);
        expect(screen.getByText('À vérifier · 1')).toBeInTheDocument();
    });

    it('propose de créer une règle permanente à chaque correction manuelle et préserve les autres lignes manuelles', () => {
        render(
            <TransactionsHarness
                initialTxs={[
                    { id: 1, date: '2026-10-10', payee: 'CAFE DU MATIN #12', amount: -5.5, category: 'Non catégorisé', status: 'processed' },
                    { id: 2, date: '2026-10-11', payee: 'CAFE DU MATIN #99', amount: -6.2, category: 'Non catégorisé', status: 'processed' },
                    { id: 3, date: '2026-10-12', payee: 'CAFE DU MATIN #01', amount: -9.0, category: 'Loisirs', status: 'manual' },
                ]}
            />,
        );

        // Correction manuelle sur #1 → ouvre le bandeau de proposition
        fireEvent.change(screen.getByLabelText('Catégorie de CAFE DU MATIN #12'), { target: { value: 'Restaurants' } });
        expect(screen.getByRole('region', { name: 'Apprentissage automatique' })).toBeInTheDocument();
        expect(screen.getByText(/Créer la règle \(\+1 dans l'historique\)/)).toBeInTheDocument();

        // Tester "Seulement cette ligne" sur #2 d'abord ou tester "Créer la règle" :
        fireEvent.click(screen.getByText(/Créer la règle/));
        expect(screen.getByTestId('rules-count').textContent).toBe('1');
        // #2 passe en Restaurants, #3 verrouillé manuel reste Loisirs
        expect((screen.getByLabelText('Catégorie de CAFE DU MATIN #99') as HTMLSelectElement).value).toBe('Restaurants');
        expect((screen.getByLabelText('Catégorie de CAFE DU MATIN #01') as HTMLSelectElement).value).toBe('Loisirs');

        // En mode discret, le motif du bandeau d'apprentissage est masqué
        fireEvent.change(screen.getByLabelText('Catégorie de CAFE DU MATIN #12'), { target: { value: 'Transport' } });
        const promptRegion = screen.getByRole('region', { name: 'Apprentissage automatique' });
        expect(promptRegion.textContent).toContain('CAFE DU MATIN');
        act(() => {
            useFinanceStore.setState({ isPrivacyMode: true });
        });
        expect(screen.getByRole('region', { name: 'Apprentissage automatique' }).textContent).not.toContain('CAFE DU MATIN');
        expect(screen.getByRole('region', { name: 'Apprentissage automatique' }).textContent).not.toContain('Transport');
    });

    it('Tout recatégoriser affiche un résumé clair et Annuler le reclassement restaure l\'état initial', () => {
        render(
            <TransactionsHarness
                initialTxs={[
                    { id: 1, date: '2026-10-10', payee: 'METRO CENTRE', amount: -80, category: 'Autre', status: 'processed' },
                    { id: 2, date: '2026-10-11', payee: 'IGA EXTRA', amount: -40, category: 'Loisirs', status: 'manual' },
                ]}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Recatégoriser tout l'historique/i }));

        // METRO -> aligné sur poste budget 'Épicerie & Alimentation' ; IGA manuel reste 'Loisirs'
        expect((screen.getByLabelText('Catégorie de METRO CENTRE') as HTMLSelectElement).value).toBe('Épicerie & Alimentation');
        expect((screen.getByLabelText('Catégorie de IGA EXTRA') as HTMLSelectElement).value).toBe('Loisirs');

        expect(screen.getByRole('status', { name: 'Résumé du reclassement' })).toBeInTheDocument();
        expect(screen.getByText(/1 transaction\(s\) mise\(s\) à jour/)).toBeInTheDocument();
        expect(screen.getByText(/1 correction\(s\) manuelle\(s\) préservée\(s\)/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Annuler le reclassement' }));
        expect((screen.getByLabelText('Catégorie de METRO CENTRE') as HTMLSelectElement).value).toBe('Autre');
    });
});
