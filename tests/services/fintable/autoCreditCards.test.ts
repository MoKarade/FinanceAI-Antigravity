/**
 * Récupération automatique des transactions de cartes de crédit Fintable :
 *  1. Auto-routage conservateur des cartes de crédit sans rôle configuré (`kind: 'debt', debtName: ''`) ;
 *  2. Amorçage automatique des cartes jamais vues (sans clic « Rattraper l'historique ») lorsque la bascule
 *     globale est avancée par le compte chèque ;
 *  3. Récupération des achats postés en retard + protection anti-doublon contre les saisies manuelles ;
 *  4. Conversion USD -> CAD uniquement lorsque le taux FX fait autorité.
 */
import { describe, it, expect, vi } from 'vitest';
import {
    runFintableBrowserSync,
    isLikelyCreditCardAccount,
} from '../../../services/fintable/browserSync';
import type { FintableClient } from '../../../services/fintable/client';
import { buildDefaultAppState } from '../../../mcp/state/appStateDefaults';
import type { AppState, Transaction } from '../../../types';

vi.mock('../../../services/errorLogger', () => ({
    logError: vi.fn(),
    logErrorThrottled: vi.fn(),
}));

const NOW = Date.parse('2026-11-18T12:00:00Z');
const now = () => NOW;

function makeState(over: Partial<AppState> = {}): AppState {
    return {
        ...buildDefaultAppState(),
        transactions: [],
        ...over,
    } as AppState;
}

describe('isLikelyCreditCardAccount', () => {
    it('reconnaît les vraies cartes de crédit et exclut les comptes débit/chèque/hypothèque', () => {
        expect(isLikelyCreditCardAccount({ rawType: 'credit', label: 'Mastercard Cash Back 0000' })).toBe(true);
        expect(isLikelyCreditCardAccount({ rawType: 'credit_card', label: 'Compte carte' })).toBe(true);
        expect(isLikelyCreditCardAccount({ rawType: 'depository', label: 'Visa Desjardins' })).toBe(true);
        expect(isLikelyCreditCardAccount({ rawType: 'depository / checking', label: 'Visa Débit' })).toBe(false);
        expect(isLikelyCreditCardAccount({ rawType: 'depository / checking', label: 'Compte chèque' })).toBe(false);
        expect(isLikelyCreditCardAccount({ rawType: 'credit', label: 'Marge de crédit hypothécaire' })).toBe(false);
    });
});

describe('runFintableBrowserSync — autoCreditCards', () => {
    it('Cas 1 : auto-route une carte de crédit sans rôle configuré et importe ses dépenses', async () => {
        const client = {
            get: vi.fn(async (path: string) => {
                if (path === '/accounts') {
                    return {
                        data: [
                            {
                                id: 'acc_visa',
                                connection_id: 'conn_1',
                                name: 'Visa Desjardins',
                                display_name: null,
                                type: 'credit_card',
                                currency: 'CAD',
                                balance: '-320.50',
                                balance_available: null,
                                last_tx_date: '2026-11-16',
                                enabled: true,
                            },
                        ],
                    };
                }
                return { data: [] };
            }),
            getAllPages: vi.fn(async (path: string) =>
                path === '/transactions'
                    ? [
                        {
                            id: 'ft_v1',
                            account_id: 'acc_visa',
                            date: '2026-11-15',
                            amount: '-45.90',
                            currency: 'CAD',
                            description: 'PHARMAPRIX 012',
                            merchant: 'Pharmaprix',
                            pending: false,
                            category: null,
                            updated_at: null,
                        },
                    ]
                    : [],
            ),
        } as unknown as FintableClient;

        const r = await runFintableBrowserSync(makeState({ fintableRoles: {} }), 'jeton', {
            client,
            now,
            autoCreditCards: true,
        });

        expect(r.report.error).toBeNull();
        expect(r.report.accountsWithoutRole).toBe(0);
        expect(r.report.transactionsAdded).toBe(1);
        expect(r.statePatch?.fintableRoles?.acc_visa).toEqual({ kind: 'debt', debtName: '' });
        const addedTx = r.statePatch?.transactions?.find((t) => t.payee === 'Pharmaprix');
        expect(addedTx).toBeDefined();
        expect(addedTx?.accountName).toBe('Visa Desjardins');
        expect(addedTx?.amount).toBe(-45.9);
    });

    it('Cas 2 : débloque automatiquement une carte jamais vue derrière la bascule du compte chèque (sans clic Rattraper)', async () => {
        const vuQueries: Record<string, unknown>[] = [];
        const client = {
            get: vi.fn(async (path: string) => {
                if (path === '/accounts') {
                    return {
                        data: [
                            {
                                id: 'acc_cheque',
                                connection_id: 'conn_1',
                                name: 'Compte chèque',
                                display_name: null,
                                type: 'depository / checking',
                                currency: 'CAD',
                                balance: '2400.00',
                                balance_available: null,
                                last_tx_date: '2026-11-18',
                                enabled: true,
                            },
                            {
                                id: 'acc_carte',
                                connection_id: 'conn_1',
                                name: 'Mastercard',
                                display_name: null,
                                type: 'credit / credit card',
                                currency: 'CAD',
                                balance: '-600.00',
                                balance_available: null,
                                last_tx_date: '2026-11-16',
                                enabled: true,
                            },
                        ],
                    };
                }
                return { data: [] };
            }),
            getAllPages: vi.fn(async (path: string, query: Record<string, unknown>) => {
                if (path !== '/transactions') return [];
                vuQueries.push(query);
                return [
                    {
                        id: 'c1', account_id: 'acc_carte', date: '2026-11-14', amount: '-12.30',
                        currency: 'CAD', description: 'CAFE DU MATIN', merchant: 'Café du Matin',
                        pending: false, category: null, updated_at: null,
                    },
                    {
                        id: 'c2', account_id: 'acc_carte', date: '2026-11-15', amount: '-64.00',
                        currency: 'CAD', description: 'EPICERIE METRO', merchant: 'Metro',
                        pending: false, category: null, updated_at: null,
                    },
                    {
                        id: 'c3', account_id: 'acc_carte', date: '2026-11-16', amount: '-29.99',
                        currency: 'CAD', description: 'STREAMING', merchant: 'Streaming',
                        pending: false, category: null, updated_at: null,
                    },
                ];
            }),
        } as unknown as FintableClient;

        const base = makeState({
            transactions: [
                {
                    id: 1,
                    date: '2026-11-18',
                    payee: 'Paie',
                    amount: 2500,
                    category: 'Revenu',
                    status: 'processed',
                    accountName: 'Compte chèque',
                } as Transaction,
            ],
            fintableRoles: {
                acc_cheque: { kind: 'cash' },
                acc_carte: { kind: 'debt', debtName: '' },
            },
        });

        const r = await runFintableBrowserSync(base, 'jeton', {
            client,
            now,
            autoCreditCards: true,
        });

        // La fenêtre de requête recule à 30 jours (2026-10-19) pour récupérer les achats carte en retard
        expect(vuQueries[0]?.date_from).toBe('2026-10-19');
        expect(r.report.error).toBeNull();
        expect(r.report.transactionsAdded).toBe(3);
        expect(r.report.warnings.some((w) => w.includes('retard de postage'))).toBe(false);
        const importedCardTx = (r.statePatch?.transactions ?? []).filter((t) => t.accountName === 'Mastercard');
        expect(importedCardTx).toHaveLength(3);
    });

    it('Cas 3 : récupère un achat posté en retard tout en bloquant le doublon d’une saisie manuelle sans compte', async () => {
        const client = {
            get: vi.fn(async (path: string) => {
                if (path === '/accounts') {
                    return {
                        data: [
                            {
                                id: 'acc_carte',
                                connection_id: 'conn_1',
                                name: 'Mastercard',
                                display_name: null,
                                type: 'credit',
                                currency: 'CAD',
                                balance: '-200.00',
                                balance_available: null,
                                last_tx_date: '2026-11-17',
                                enabled: true,
                            },
                        ],
                    };
                }
                return { data: [] };
            }),
            getAllPages: vi.fn(async (path: string) =>
                path === '/transactions'
                    ? [
                        // Achat posté en retard après le 17 nov (doit être importé)
                        {
                            id: 'late_new', account_id: 'acc_carte', date: '2026-11-15', amount: '-48.90',
                            currency: 'CAD', description: 'LIBRAIRIE CENTRALE', merchant: 'Librairie Centrale',
                            pending: false, category: null, updated_at: null,
                        },
                        // Déjà saisi manuellement le 12 nov au même montant (-25.00) sous autre libellé -> NE DOIT PAS dupliquer
                        {
                            id: 'dup_manual', account_id: 'acc_carte', date: '2026-11-12', amount: '-25.00',
                            currency: 'CAD', description: 'MARCHE LOCAL XYZ', merchant: 'Marché Local XYZ',
                            pending: false, category: null, updated_at: null,
                        },
                    ]
                    : [],
            ),
        } as unknown as FintableClient;

        const base = makeState({
            transactions: [
                {
                    id: 1,
                    date: '2026-11-17',
                    payee: 'Achat déjà connu',
                    amount: -19.5,
                    category: 'Loisirs',
                    status: 'processed',
                    accountName: 'Mastercard',
                } as Transaction,
                {
                    id: 2,
                    date: '2026-11-12',
                    payee: 'Saisie manuelle utilisateur',
                    amount: -25.0,
                    category: 'Alimentation',
                    status: 'processed',
                } as Transaction,
            ],
            fintableRoles: {
                acc_carte: { kind: 'debt', debtName: '' },
            },
        });

        const r = await runFintableBrowserSync(base, 'jeton', {
            client,
            now,
            autoCreditCards: true,
        });

        expect(r.report.error).toBeNull();
        expect(r.report.transactionsAdded).toBe(1);
        const imported = (r.statePatch?.transactions ?? []).slice(2);
        expect(imported).toHaveLength(1);
        expect(imported[0]?.payee).toBe('Librairie Centrale');
        expect(imported[0]?.amount).toBe(-48.9);
    });

    it('Cas 4 : convertit une dépense carte USD en CAD uniquement si le taux FX fait autorité', async () => {
        const client = {
            get: vi.fn(async (path: string) => {
                if (path === '/accounts') {
                    return {
                        data: [
                            {
                                id: 'acc_usd_card',
                                connection_id: 'conn_1',
                                name: 'Visa USD',
                                display_name: null,
                                type: 'credit_card',
                                currency: 'USD',
                                balance: '-100.00',
                                balance_available: null,
                                last_tx_date: '2026-11-15',
                                enabled: true,
                            },
                        ],
                    };
                }
                return { data: [] };
            }),
            getAllPages: vi.fn(async (path: string) =>
                path === '/transactions'
                    ? [
                        {
                            id: 'usd_1', account_id: 'acc_usd_card', date: '2026-11-15', amount: '-10.00',
                            currency: 'USD', description: 'CLOUD SERVICE', merchant: 'Cloud Service',
                            pending: false, category: null, updated_at: null,
                        },
                    ]
                    : [],
            ),
        } as unknown as FintableClient;

        const withRealFx = makeState({
            fxRates: { CAD: 1, USD: 1.4, EUR: 1.5 },
            fxRatesSource: 'api',
            fxRatesEstimated: false,
            fintableRoles: { acc_usd_card: { kind: 'debt', debtName: '' } },
        });
        const rOk = await runFintableBrowserSync(withRealFx, 'jeton', {
            client,
            now,
            autoCreditCards: true,
        });
        expect(rOk.report.transactionsAdded).toBe(1);
        expect(rOk.statePatch?.transactions?.[0]?.amount).toBe(-14);

        const withFallbackFx = makeState({
            fxRates: { CAD: 1, USD: 1.4, EUR: 1.5 },
            fxRatesSource: 'repli',
            fxRatesEstimated: true,
            fintableRoles: { acc_usd_card: { kind: 'debt', debtName: '' } },
        });
        const rNoFx = await runFintableBrowserSync(withFallbackFx, 'jeton', {
            client,
            now,
            autoCreditCards: true,
        });
        expect(rNoFx.report.transactionsAdded).toBe(0);
    });

    it('Cas 5 : auto-route compte chèque (cash) et compte CELI (investment), et récupère sans doublon une dépense chèque postée en retard', async () => {
        const client = {
            get: vi.fn(async (path: string) => {
                if (path === '/accounts') {
                    return {
                        data: [
                            {
                                id: 'acc_cheque_auto',
                                connection_id: 'conn_1',
                                name: 'Compte chèque Desjardins',
                                display_name: null,
                                type: 'depository / checking',
                                currency: 'CAD',
                                balance: '1850.00',
                                balance_available: null,
                                last_tx_date: '2026-11-18',
                                enabled: true,
                            },
                            {
                                id: 'acc_celi_auto',
                                connection_id: 'conn_1',
                                name: 'Disnat CELI',
                                display_name: null,
                                type: 'investment',
                                currency: 'CAD',
                                balance: '42000.00',
                                balance_available: null,
                                last_tx_date: null,
                                enabled: true,
                            },
                        ],
                    };
                }
                return { data: [] };
            }),
            getAllPages: vi.fn(async (path: string) =>
                path === '/transactions'
                    ? [
                        {
                            id: 'chq_late_1', account_id: 'acc_cheque_auto', date: '2026-11-14', amount: '-52.40',
                            currency: 'CAD', description: 'HYDRO QUEBEC', merchant: 'Hydro-Québec',
                            pending: false, category: null, updated_at: null,
                        },
                    ]
                    : [],
            ),
        } as unknown as FintableClient;

        const base = makeState({
            transactions: [
                {
                    id: 10,
                    date: '2026-11-17',
                    payee: 'Achat récent chèque',
                    amount: -20,
                    category: 'Autre',
                    status: 'processed',
                    accountName: 'Compte chèque Desjardins',
                } as Transaction,
            ],
            fintableRoles: {},
        });

        const r = await runFintableBrowserSync(base, 'jeton', {
            client,
            now,
            autoCreditCards: true,
        });

        expect(r.report.error).toBeNull();
        expect(r.report.accountsWithoutRole).toBe(0);
        expect(r.statePatch?.fintableRoles?.acc_cheque_auto).toEqual({ kind: 'cash' });
        expect(r.statePatch?.fintableRoles?.acc_celi_auto).toEqual({ kind: 'investment', taxRegime: 'CELI' });
        expect(r.report.transactionsAdded).toBe(1);
        expect(r.statePatch?.transactions?.some((t) => t.payee === 'Hydro-Québec')).toBe(true);
    });
});
