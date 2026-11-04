import type { AppState, Asset, BudgetCategory, Debt, FinancialGoal, Transaction, User } from '../types';
import { INITIAL_PROJECTION, INITIAL_REAL_ESTATE_GOAL } from '../constants';

function buildMonthlyHistory(basePrice: number, currentPrice: number, months = 24): { date: string; value: number }[] {
    const now = new Date();
    const out: { date: string; value: number }[] = [];
    for (let i = months; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 15);
        const progress = (months - i) / months;
        const wave = Math.sin(i * 0.65) * basePrice * 0.025;
        const value = Number((basePrice + (currentPrice - basePrice) * progress + wave).toFixed(2));
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-15`;
        out.push({ date: iso, value });
    }
    return out;
}

/**
 * Construit un dossier patrimonial initial complet et réaliste (~230 k$ de valeur nette,
 * sans propriété immobilière active gonflant artificiellement le patrimoine à 430 k$).
 */
export function buildStarterState(): Partial<AppState> {
    const now = new Date();
    const currentYear = now.getFullYear();

    const primaryUser: User = {
        name: 'Alex',
        grossSalary: 7800,
        netSalary: 5350,
        color: '#8ab4f8',
        age: 34,
        birthYear: currentYear - 34,
        canadaArrivalYear: currentYear - 34,
        hasOwnedPropertyLast4Years: false,
        hasChildren: false,
        childCount: 0,
        celiContributed: 48000,
        rrspContributed: 62000,
    };

    const secondaryUser: User = {
        name: '',
        grossSalary: 0,
        netSalary: 0,
        color: '#81c995',
        age: 0,
        birthYear: 0,
        canadaArrivalYear: 0,
        hasOwnedPropertyLast4Years: false,
        hasChildren: false,
        childCount: 0,
    };

    // Portefeuille calibré aux cours actuels du marché (~230 k$ de patrimoine net global) :
    // VEQT.TO (1 450 × 59,19 $ = 85 825,50 $) + XEQT.TO (2 000 × 43,82 $ = 87 640 $)
    // + VFV.TO (310 × 182,18 $ = 56 475,80 $) = 229 941,30 $ d'actifs boursiers
    // + 14 000 $ de liquidités − 14 200 $ de dette = ~229 741 $ (~230 k$).
    const assets: Asset[] = [
        {
            symbol: 'VEQT.TO',
            name: 'FNB Vanguard Actions Mondiales (CELI)',
            accountType: 'CELI',
            quantity: 1450,
            buyPrice: 41.16,
            currentPrice: 59.19,
            performance: 43.8,
            dateBought: `${currentYear - 2}-01-15`,
            currency: 'CAD',
            owner: 'user1',
            priceHistory: buildMonthlyHistory(41.16, 59.19, 24).map((h) => ({ date: h.date, price: h.value })),
        },
        {
            symbol: 'XEQT.TO',
            name: 'FNB iShares Core Actions (REER)',
            accountType: 'REER',
            quantity: 2000,
            buyPrice: 31.02,
            currentPrice: 43.82,
            performance: 41.3,
            dateBought: `${currentYear - 2}-01-15`,
            currency: 'CAD',
            owner: 'user1',
            priceHistory: buildMonthlyHistory(31.02, 43.82, 24).map((h) => ({ date: h.date, price: h.value })),
        },
        {
            symbol: 'VFV.TO',
            name: 'FNB Vanguard S&P 500 Index (Non-enreg.)',
            accountType: 'NON-ENREG',
            quantity: 310,
            buyPrice: 128.78,
            currentPrice: 182.18,
            performance: 41.5,
            dateBought: `${currentYear - 2}-01-15`,
            currency: 'CAD',
            owner: 'user1',
            priceHistory: buildMonthlyHistory(128.78, 182.18, 24).map((h) => ({ date: h.date, price: h.value })),
        },
    ];

    const budgetItems: BudgetCategory[] = [
        { id: 'init-cat-logement', name: 'Logement & Énergie', target: 1650, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
        { id: 'init-cat-epicerie', name: 'Épicerie & Alimentation', target: 620, frequency: 'Monthly', type: 'Commun', nature: 'Besoin' },
        { id: 'init-cat-transport', name: 'Transport & Mobilité', target: 340, frequency: 'Monthly', type: 'Perso 1', nature: 'Besoin' },
        { id: 'init-cat-loisirs', name: 'Restaurants & Sorties', target: 420, frequency: 'Monthly', type: 'Perso 1', nature: 'Envie' },
        { id: 'init-cat-abonnements', name: 'Télécom & Abonnements', target: 145, frequency: 'Monthly', type: 'Perso 1', nature: 'Besoin' },
        { id: 'init-cat-epargne', name: 'Investissements programmés', target: 1850, frequency: 'Monthly', type: 'Perso 1', nature: 'Epargne' },
    ];

    const transactions: Transaction[] = [];
    let txId = 1000;
    for (let m = 11; m >= 0; m--) {
        const dSal = new Date(now.getFullYear(), now.getMonth() - m, 1);
        const dDep = new Date(now.getFullYear(), now.getMonth() - m, 12);
        const dEp = new Date(now.getFullYear(), now.getMonth() - m, 24);
        const ym = `${dSal.getFullYear()}-${String(dSal.getMonth() + 1).padStart(2, '0')}`;
        const depenseCourante = 1180 + (m % 3) * 90;
        const surplusEpargne = 5350 - 1650 - depenseCourante;

        transactions.push(
            {
                id: txId++,
                date: `${ym}-01`,
                payee: 'Paie nette déposée',
                amount: 5350,
                category: 'Revenu',
                accountName: 'Chèque',
                status: 'processed',
                ownerId: 0,
            },
            {
                id: txId++,
                date: `${dimIso(dDep)}`,
                payee: 'Loyer & charges fixes',
                amount: -1650,
                category: 'Logement & Énergie',
                accountName: 'Chèque',
                status: 'processed',
                ownerId: 0,
            },
            {
                id: txId++,
                date: `${dimIso(dEp)}`,
                payee: 'Dépenses courantes & alimentation',
                amount: -depenseCourante,
                category: 'Épicerie & Alimentation',
                accountName: 'Carte de crédit',
                status: 'processed',
                ownerId: 0,
            },
            {
                id: txId++,
                date: `${ym}-28`,
                payee: 'Virement épargne programmé',
                amount: -surplusEpargne,
                category: 'Transfert',
                accountName: 'Chèque',
                status: 'processed',
                ownerId: 0,
            },
        );
    }

    const debts: Debt[] = [
        {
            id: 'init-debt-auto',
            name: 'Financement véhicule électrique',
            category: 'Car',
            kind: 'auto',
            balance: 14200,
            interestRate: 4.9,
            minimumPayment: 360,
        },
    ];

    const financialGoals: FinancialGoal[] = [
        {
            id: 'init-goal-urgence',
            name: 'Coussin de sécurité (6 mois)',
            type: 'LIQUIDITY',
            targetAmount: 24000,
            manualCurrentAmount: 14000,
            deadline: `${currentYear + 1}-12-31`,
            targetAccount: 'CELI',
            status: 'active',
        },
        {
            id: 'init-goal-renovation',
            name: 'Mise de fonds projet immobilier',
            type: 'CUSTOM',
            targetAmount: 65000,
            manualCurrentAmount: 42000,
            deadline: `${currentYear + 2}-05-01`,
            targetAccount: 'CELI',
            status: 'active',
        },
        {
            id: 'init-goal-sabbatique',
            name: 'Fonds sabbatique & projets',
            type: 'NET_WORTH',
            targetAmount: 35000,
            manualCurrentAmount: 19250,
            deadline: `${currentYear + 3}-06-30`,
            targetAccount: 'CELI',
            status: 'active',
        },
    ];

    return {
        config: {
            users: [primaryUser, secondaryUser],
            splitMode: 'prorata',
        },
        initialBalances: {
            'Chèque': 4500,
            'Épargne': 9500,
        },
        assets,
        budgetItems,
        transactions,
        realEstateGoals: [structuredClone(INITIAL_REAL_ESTATE_GOAL)],
        debts,
        financialGoals,
        retirementGoal: {
            targetAge: 60,
            targetMonthlyIncome: 4800,
            governmentPension: 1350,
            lifeExpectancy: 92,
            rrqStartAge: 65,
            psvStartAge: 65,
        },
        projection: {
            ...INITIAL_PROJECTION,
            returnRate: 6.8,
            inflationRate: 2.1,
            savingsMode: 'budget',
        },
        lastUpdate: Date.now(),
    };
}

function dimIso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Détecte si un état est le gabarit starter synthétique (Alex / init-cat-logement / init-debt-auto). */
export function isStarterTemplateState(candidate: Partial<AppState> | null | undefined): boolean {
    if (!candidate) return false;
    const firstUserName = candidate.config?.users?.[0]?.name ?? '';
    const hasStarterBudget = (candidate.budgetItems ?? []).some((b) => b.id === 'init-cat-logement');
    const hasStarterDebt = (candidate.debts ?? []).some((d) => d.id === 'init-debt-auto');
    const hasStarterGoal = (candidate.financialGoals ?? []).some((g) => g.id === 'init-goal-urgence');
    const hasBrokerLedger = Array.isArray(candidate.brokerLedger) && candidate.brokerLedger.length > 0;
    if (hasBrokerLedger) return false;
    if ((candidate.transactions ?? []).length > 60 || (candidate.assets ?? []).length > 5) {
        return false;
    }
    if (firstUserName === 'Alex' && (hasStarterBudget || hasStarterDebt || hasStarterGoal)) {
        return true;
    }
    return (hasStarterBudget && hasStarterDebt) || (hasStarterDebt && hasStarterGoal);
}

