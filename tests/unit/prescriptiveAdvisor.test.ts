import { describe, it, expect } from 'vitest';
import {
    recommendOptimalRrspContribution,
    recommendAssetLocationSwaps,
    recommendTaxLossHarvesting,
    recommendBehavioralActions,
    recommendStructuralActions,
    computeRrqBreakEvenAge,
    generatePrescriptiveRecommendations,
} from '../../services/projection/prescriptiveAdvisor';
import type { BehavioralProfile } from '../../services/projection/behavioralProfile';
import type { Asset } from '../../types';
import type { SimulationParams } from '../../services/projection/types';

function makeParams(): SimulationParams {
    return {
        projection: {
            years: 25,
            returnRate: 6.5,
            inflationRate: 2.0,
            savingsMode: 'budget',
            manualContribution: 0,
            usePortfolioRate: false,
            returnRates: { celi: 6.5, reer: 6.5, nonReg: 6.5, crypto: 8, cash: 2.5 },
            manualREERRoom: 30000,
        },
        calculatedStartingCash: 12000,
        liveCSVBalances: {
            CELI: 75000,
            CELIAPP: 0,
            REER: 320000,
            NON_ENREG: 50000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: [],
        debts: [
            { id: 'd1', name: 'Carte crédit', balance: 8500, interestRate: 19.99, minimumPayment: 250, category: 'CreditCard' },
        ],
        childGoals: [
            {
                id: 'c1',
                name: 'Enfant 1',
                birthYear: 2023,
                daycareCost: 9,
                reeeContribution: 208,
                governmentBenefits: 450,
            } as never,
        ],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal: {
            targetAge: 62,
            lifeExpectancy: 92,
            targetMonthlyIncome: 4200,
            governmentPension: 1850,
        },
        config: {
            users: [
                { name: 'Alex', netSalary: 6500, grossSalary: 11250, color: '#3b82f6', age: 38 },
                { name: 'Sam', netSalary: 0, grossSalary: 0, color: '#10b981', age: 38 },
            ],
            splitMode: '50/50',
        },
        baseGrossAnnual: 135000,
        baseNetAnnual: 78000,
        currentRentExpense: 1600,
        baseMonthlyExpenses: 4000,
        startYear: 2026,
        startMonth: 0,
    };
}

describe('Lot 5 — Moteur de conseils prescriptifs chiffrés (F21)', () => {
    it('recommande la cotisation REER optimale au TMED avant le 1er mars avec impact des prestations familiales', () => {
        const rec = recommendOptimalRrspContribution(135000, 25000, {
            year: 2026,
            childrenCount: 1,
            monthlyExpenses: 4000,
        });
        expect(rec).not.toBeNull();
        expect(rec!.horizon).toBe('immediate');
        expect(rec!.urgencyDeadline).toBe('1er mars 2027');
        expect(rec!.impact.amountDollars).toBeGreaterThan(1000);
        expect(rec!.impact.effectiveTmedRate).toBeGreaterThan(0.45);
    });

    it('retourne null (No-Fake-Data) lorsque le droit REER est nul ou le revenu sous le premier palier', () => {
        expect(recommendOptimalRrspContribution(135000, 0)).toBeNull();
        expect(recommendOptimalRrspContribution(35000, 15000)).toBeNull();
        expect(recommendOptimalRrspContribution(NaN, 15000)).toBeNull();
    });

    it('détecte les titres américains détenus en CELI subissant la retenue IRS 15 % et chiffre le swap REER', () => {
        const assets: Asset[] = [
            {
                symbol: 'VOO',
                name: 'Vanguard S&P 500 ETF',
                accountType: 'CELI',
                quantity: 120,
                currentPrice: 500,
                currency: 'USD',
                performance: 0,
                dateBought: '2024-01-10',
            },
        ];
        const swaps = recommendAssetLocationSwaps(assets, { USD: 1.38 }, 25, 100000, 4000);
        expect(swaps.length).toBe(1);
        expect(swaps[0].horizon).toBe('immediate');
        expect(swaps[0].title).toContain('VOO');
        expect(swaps[0].impact.annualSavingsDollars).toBeGreaterThan(100);
        expect(swaps[0].impact.amountDollars).toBeGreaterThan(5000);
    });

    it('détecte les opportunités de Tax-Loss Harvesting avant le 31 décembre sur le PBR réel (purchases[])', () => {
        const assets: Asset[] = [
            {
                symbol: 'ZFL.TO',
                name: 'Indice Obligations Long Terme',
                accountType: 'NON-ENREG' as never,
                quantity: 1000,
                currentPrice: 12,
                currency: 'CAD',
                performance: -30,
                dateBought: '2022-03-15',
                purchases: [{ date: '2022-03-15', quantity: 1000, price: 17.5 }],
            },
        ];
        const tlh = recommendTaxLossHarvesting(assets, {}, 0.4571, 2026, 4000);
        expect(tlh).not.toBeNull();
        expect(tlh!.urgencyDeadline).toBe('31 décembre 2026');
        expect(tlh!.impact.amountDollars).toBeCloseTo(5500 * 0.5 * 0.4571, -1);
    });

    it('chiffre les 2 mois magiques à 3 paies et la réduction de la dérive discrétionnaire (Comportemental)', () => {
        const profile: BehavioralProfile = {
            expenseMode: 'real',
            convergenceStartMonth: 12,
            convergenceEndMonth: 36,
            realMonthlyExpenses: 4700,
            fixedRatio: 0.6,
            discretionaryRatio: 0.4,
            lifestyleCreepAnnual: 0.03,
            expenseVolatility: 0.09,
            seasonalityFactors: Array(12).fill(1),
            paySchedule: {
                frequency: 'biweekly',
                payDays: [5, 19],
                threePayMonths: [4, 9],
                typicalNetPay: 2500,
                confidence: 'high',
            },
        };

        const recs = recommendBehavioralActions(profile, 4000, 20, 0.066, 4000);
        expect(recs.length).toBe(2);
        expect(recs.some((r) => r.id === 'rec-behavioral-magic-paychecks')).toBe(true);
        expect(recs.some((r) => r.id === 'rec-behavioral-discretionary-drift')).toBe(true);
        expect(recs[0].impact.monthsFreedom).toBeGreaterThan(0);
    });

    it('calcule le point mort actuariel exact du report RRQ à 70 ans et trie toutes les recommandations par impact décroissant', () => {
        const breakEven = computeRrqBreakEvenAge(70);
        expect(breakEven).toBeCloseTo((70 * 1.42 - 65) / 0.42, 2);

        const params = makeParams();
        const struct = recommendStructuralActions(params);
        expect(struct.length).toBeGreaterThanOrEqual(2);

        const all = generatePrescriptiveRecommendations({
            params,
            assets: [
                {
                    symbol: 'VOO',
                    name: 'S&P 500 US',
                    accountType: 'CELI',
                    quantity: 100,
                    currentPrice: 500,
                    currency: 'USD',
                    performance: 0,
                    dateBought: '2024-01-10',
                },
            ],
            fxRates: { USD: 1.38 },
        });
        expect(all.length).toBeGreaterThanOrEqual(3);
        for (let i = 1; i < all.length; i++) {
            expect(all[i - 1].impact.amountDollars).toBeGreaterThanOrEqual(all[i].impact.amountDollars);
        }
    });
});
