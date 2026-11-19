import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AppState, Transaction } from '../../types';

const mocks = vi.hoisted(() => ({
    categorizeBatch: vi.fn(),
}));

vi.mock('../../services/gemini', () => ({
    categorizeBatch: mocks.categorizeBatch,
}));

import {
    scheduleBackgroundAiCategorization,
    buildFewShotExamples,
    type BackgroundAiStorePort,
} from '../../services/transactions/backgroundAiCategorize';

const tx = (id: number, payee: string, extra: Partial<Transaction> = {}): Transaction => ({
    id,
    date: '2026-10-15',
    payee,
    amount: -45,
    category: 'Non catégorisé',
    status: 'processed',
    ...extra,
});

describe('backgroundAiCategorize — classement IA en arrière-plan', () => {
    let memState: Pick<AppState, 'apiKeys' | 'transactions' | 'budgetItems' | 'categorizationRules'> & { isTestMode?: boolean };
    let storePort: BackgroundAiStorePort;

    beforeEach(() => {
        mocks.categorizeBatch.mockReset();
        memState = {
            isTestMode: false,
            apiKeys: { gemini: 'fake-gemini-key', finnhub: '' },
            transactions: [],
            budgetItems: [
                { id: 'b1', name: 'Épicerie & Alimentation', target: 600, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
            ],
            categorizationRules: [
                { id: 'r1', pattern: 'METRO', category: 'Épicerie', createdAt: '2026-01-01' },
            ],
        };
        storePort = {
            getState: () => memState,
            setAppState: (patch) => {
                memState = { ...memState, ...patch };
            },
            isTestModeNow: () => memState.isTestMode === true,
        };
    });

    it('ne fait rien en mode test ou sans clé Gemini', async () => {
        memState = { ...memState, isTestMode: true, transactions: [tx(1, 'BOUTIQUE TEST')] };
        expect((await scheduleBackgroundAiCategorization([1], storePort)).ran).toBe(false);
        expect(mocks.categorizeBatch).not.toHaveBeenCalled();

        memState = { ...memState, isTestMode: false, apiKeys: { gemini: '', finnhub: '' } };
        expect((await scheduleBackgroundAiCategorization([1], storePort)).ran).toBe(false);
        expect(mocks.categorizeBatch).not.toHaveBeenCalled();
    });

    it('envoie uniquement les cibles à vérifier, aligne vers le budget et ne réécrit pas une édition manuelle concurrente', async () => {
        memState = {
            ...memState,
            transactions: [
                tx(1, 'MARCHAND INCONNU', { category: 'Non catégorisé' }),
                tx(2, 'MARCHAND CONCURRENT', { category: 'Non catégorisé' }),
                tx(3, 'DEJA MANUEL', { category: 'Loisirs', status: 'manual', confidence: 100 }),
            ],
        };

        mocks.categorizeBatch.mockImplementation(async (candidates: Transaction[]) => {
            // Simule une correction manuelle effectuée par l'utilisateur pendant l'appel réseau sur id=2
            memState = {
                ...memState,
                transactions: memState.transactions.map((t) =>
                    t.id === 2 ? { ...t, category: 'Voyages', status: 'manual', confidence: 100, isVerified: true } : t,
                ),
            };
            return candidates.map((t) => ({
                ...t,
                category: 'Épicerie',
                isTransfer: false,
                confidence: 89,
                isAiProcessed: true,
                status: 'processed' as const,
            }));
        });

        const outcome = await scheduleBackgroundAiCategorization([1, 2, 3], storePort);
        expect(outcome.ran).toBe(true);
        expect(mocks.categorizeBatch).toHaveBeenCalledTimes(1);

        const sentIds = mocks.categorizeBatch.mock.calls[0][0].map((t: Transaction) => t.id);
        expect(sentIds).toEqual([1, 2]);
        const deps = mocks.categorizeBatch.mock.calls[0][4];
        expect(deps.context.groupByMerchant).toBe(true);
        expect(deps.context.fewShotExamples[0].merchant).toBe('METRO');

        const after = new Map(memState.transactions.map((t) => [t.id, t]));
        // id=1 aligné sur le nom du poste budget
        expect(after.get(1)?.category).toBe('Épicerie & Alimentation');
        // id=2 modifié à la main pendant le fetch → conservé intact
        expect(after.get(2)?.category).toBe('Voyages');
        expect(after.get(2)?.status).toBe('manual');
    });

    it('buildFewShotExamples exclut tout montant et respecte la limite', () => {
        const ex = buildFewShotExamples(
            [tx(10, 'CAFE NORD', { status: 'manual', category: 'Restaurants', amount: -12.34 })],
            [{ id: 'r1', pattern: 'METRO', category: 'Épicerie', createdAt: '2026-01-01' }],
        );
        expect(ex).toHaveLength(2);
        expect(JSON.stringify(ex)).not.toContain('12.34');
    });
});
