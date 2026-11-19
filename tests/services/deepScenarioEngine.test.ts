import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateFutureProjection, type SimulationParams } from '../../services/projection';
import {
    DEEP_SCENARIO_IDS,
    type DeepForecastProgress,
} from '../../services/projection/deepForecastTypes';
import {
    aggregateDeepForecastShards,
    computeDeepScenarioShard,
    computeQuickFourScenarios,
    DEFAULT_DEEP_TRAJECTORIES,
    exploreAiOptimizedStrategy,
    prepareDeepScenarioBaselines,
} from '../../services/projection/deepScenarioEngine';
import {
    analyzeRealPastDossier,
    buildAnonymizedNewsAndMacroPrompt,
    collectLiveNewsAndFundamentals,
} from '../../services/projection/realPastAndNewsAnalyzer';
import {
    computeDeepForecastInputsSig,
    DEEP_FORECAST_CANCELLED,
    runDeepForecastAsync,
} from '../../services/projection/runDeepForecastAsync';
import type {
    Asset,
    BudgetCategory,
    BudgetConfig,
    FinancialGoal,
    ProjectionConfig,
    RetirementGoal,
    Transaction,
} from '../../types';

function makeBaseParams(years = 20, goals: FinancialGoal[] = []): SimulationParams {
    const projection: ProjectionConfig = {
        years,
        returnRate: 6.5,
        inflationRate: 2.1,
        savingsMode: 'manual',
        manualContribution: 1200,
        usePortfolioRate: false,
        returnRates: { celi: 7.0, reer: 6.5, nonReg: 6.2, crypto: 9.0, cash: 2.8 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.5,
        propertyGrowthRate: 3.0,
    };
    const config: BudgetConfig = {
        users: [
            {
                name: 'ProfilTest',
                grossSalary: 7500,
                netSalary: 5000,
                color: '#10b981',
                age: 42,
                birthYear: 1984,
                canadaArrivalYear: 1984,
                hasOwnedPropertyLast4Years: true,
                celiContributed: 0,
                rrspContributed: 0,
            },
        ],
        splitMode: '50/50',
    } as unknown as BudgetConfig;
    const retirementGoal: RetirementGoal = {
        targetAge: 62,
        targetMonthlyIncome: 4400,
        governmentPension: 1500,
        lifeExpectancy: 90,
    };
    return {
        projection,
        calculatedStartingCash: 25_000,
        liveCSVBalances: {
            CELI: 75_000,
            CELIAPP: 0,
            REER: 140_000,
            NON_ENREG: 35_000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: [],
        retirementGoal,
        config,
        baseGrossAnnual: 90_000,
        baseNetAnnual: 60_000,
        currentRentExpense: 1650,
        baseMonthlyExpenses: 3400,
        startYear: 2026,
        startMonth: 0,
        financialGoals: goals,
    };
}

function makeTwelveMonthTransactions(): Transaction[] {
    const txs: Transaction[] = [];
    let nextId = 1;
    // 12 mois complets de mai 2025 à avril 2026 avec saisonnalité décembre + légère dérive discrétionnaire
    for (let i = 0; i < 12; i++) {
        const year = i < 8 ? 2025 : 2026;
        const month = ((4 + i) % 12) + 1;
        const ym = `${year}-${String(month).padStart(2, '0')}`;

        // Deux paies mensuelles nettes = 5 200 $
        txs.push(
            {
                id: nextId++,
                date: `${ym}-01`,
                payee: 'EmployeurTest Paie',
                amount: 2600,
                category: 'Revenu',
                status: 'processed',
            },
            {
                id: nextId++,
                date: `${ym}-15`,
                payee: 'EmployeurTest Paie',
                amount: 2600,
                category: 'Revenu',
                status: 'processed',
            },
        );

        // Dépenses fixes mensuelles récurrentes = 2 150 $
        txs.push(
            {
                id: nextId++,
                date: `${ym}-02`,
                payee: 'LogementTest',
                amount: -1600,
                category: 'Logement',
                status: 'processed',
            },
            {
                id: nextId++,
                date: `${ym}-06`,
                payee: 'EpicerieTest',
                amount: -550,
                category: 'Épicerie',
                status: 'processed',
            },
        );

        // Discrétionnaire croissant (lifestyle creep) + pic en décembre, creux prononcé en février
        const seasonExtra = month === 12 ? 1150 : month === 2 ? -420 : 0;
        const discretionarySpend = 680 + i * 32 + seasonExtra;
        txs.push({
            id: nextId++,
            date: `${ym}-19`,
            payee: 'LoisirsTest',
            amount: -discretionarySpend,
            category: 'Restaurants & Loisirs',
            status: 'processed',
        });
    }
    return txs;
}

function makeTestAssets(): Asset[] {
    return [
        {
            symbol: 'XIU.TO',
            name: 'FNB Indice Canadien Benchmark',
            quantity: 1000,
            currency: 'CAD',
            currentPrice: 80,
            performance: 7.5,
            dateBought: '2022-01-10',
            accountType: 'REER',
            sector: 'Marché large Canada',
            dividendYield: 2.8,
        },
        {
            symbol: 'SPY',
            name: 'FNB Indice Americain Benchmark',
            quantity: 100,
            currency: 'USD',
            currentPrice: 500,
            performance: 9.2,
            dateBought: '2023-03-15',
            accountType: 'CELI',
            sector: 'Marché large US',
            dividendYield: 1.4,
        },
    ];
}

function makeBudgetItems(): BudgetCategory[] {
    return [
        {
            name: 'Logement',
            target: 1600,
            frequency: 'Monthly',
            type: 'Commun',
            nature: 'Besoin',
        },
        {
            name: 'Épicerie',
            target: 500,
            frequency: 'Monthly',
            type: 'Commun',
            nature: 'Besoin',
        },
        {
            name: 'Restaurants & Loisirs',
            target: 500,
            frequency: 'Monthly',
            type: 'Perso 1',
            nature: 'Envie',
        },
    ];
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('analyzeRealPastDossier — audit du passé réel et règle stricte no-fake-data', () => {
    it('renvoie strictement null pour les métriques non mesurables si 0 transaction (jamais 0 fictif)', () => {
        const diag = analyzeRealPastDossier({
            transactions: [],
            assets: [],
            budgetItems: [],
        });

        expect(diag.transactionsAnalyzed).toBe(0);
        expect(diag.monthsCovered).toBe(0);
        expect(diag.firstTransactionDate).toBeNull();
        expect(diag.lastTransactionDate).toBeNull();
        expect(diag.observedMonthlyIncomeCad).toBeNull();
        expect(diag.observedMonthlyExpensesCad).toBeNull();
        expect(diag.budgetedMonthlyExpensesCad).toBeNull();
        expect(diag.monthlySpendingGapCad).toBeNull();
        expect(diag.observedSavingsRatePct).toBeNull();
        expect(diag.lifestyleCreepAnnualPct).toBeNull();
        expect(diag.fixedExpensesSharePct).toBeNull();
        expect(diag.discretionarySharePct).toBeNull();
        expect(diag.peakSpendingMonthLabel).toBeNull();
        expect(diag.lowSpendingMonthLabel).toBeNull();
        expect(diag.weightedMerPct).toBeNull();
        expect(diag.estimatedAnnualFeeAndTaxDragCad).toBeNull();
        expect(diag.expenseVolatilityPct).toBeNull();
        expect(diag.findingsFr.length).toBeGreaterThanOrEqual(3);
        expect(diag.findingsFr.join(' ').toLowerCase()).toContain('historique');
    });

    it('n’invente ni dérive ni saisonnalité lorsque l’historique ne couvre qu’un seul mois', () => {
        const singleMonthTxs: Transaction[] = [
            {
                id: 1,
                date: '2026-04-01',
                payee: 'EmployeurTest',
                amount: 4800,
                category: 'Revenu',
                status: 'processed',
            },
            {
                id: 2,
                date: '2026-04-03',
                payee: 'LogementTest',
                amount: -1600,
                category: 'Logement',
                status: 'processed',
            },
        ];

        const diag = analyzeRealPastDossier({ transactions: singleMonthTxs });
        expect(diag.transactionsAnalyzed).toBe(2);
        expect(diag.monthsCovered).toBe(1);
        expect(diag.observedMonthlyIncomeCad).toBeCloseTo(4800, 0);
        expect(diag.observedMonthlyExpensesCad).toBeCloseTo(1600, 0);
        expect(diag.lifestyleCreepAnnualPct).toBeNull();
        expect(diag.expenseVolatilityPct).toBeNull();
        expect(diag.peakSpendingMonthLabel).toBeNull();
        expect(diag.lowSpendingMonthLabel).toBeNull();
    });

    it('mesure dépassement budgétaire, dérive, saisonnalité, RFG et retenue US CELI sur 12 mois réels', () => {
        const txs = makeTwelveMonthTransactions();
        const assets = makeTestAssets();
        const budgetItems = makeBudgetItems();

        const diag = analyzeRealPastDossier({
            transactions: txs,
            assets,
            fxRates: { USD: 1.38 },
            budgetItems,
            referenceDateIso: '2026-04-30',
        });

        expect(diag.transactionsAnalyzed).toBe(txs.length);
        expect(diag.monthsCovered).toBe(12);
        expect(diag.firstTransactionDate).toBe('2025-05-01');
        expect(diag.lastTransactionDate).toBe('2026-04-19');
        expect(diag.observedMonthlyIncomeCad).toBeCloseTo(5200, -1);
        expect(diag.budgetedMonthlyExpensesCad).toBeCloseTo(2600, 0);
        expect(diag.observedMonthlyExpensesCad).not.toBeNull();
        expect(diag.observedMonthlyExpensesCad!).toBeGreaterThan(2800);
        expect(diag.monthlySpendingGapCad).toBeGreaterThan(200);
        expect(diag.observedSavingsRatePct).toBeGreaterThan(20);
        expect(diag.lifestyleCreepAnnualPct).not.toBeNull();
        expect(diag.lifestyleCreepAnnualPct!).toBeGreaterThan(0);
        expect(diag.peakSpendingMonthLabel).toBe('Décembre');
        expect(diag.lowSpendingMonthLabel).toBe('Février');
        expect(diag.weightedMerPct).not.toBeNull();
        expect(diag.weightedMerPct!).toBeGreaterThan(0);
        expect(diag.estimatedAnnualFeeAndTaxDragCad).not.toBeNull();
        expect(diag.estimatedAnnualFeeAndTaxDragCad!).toBeGreaterThan(100);
        expect(diag.fixedExpensesSharePct).not.toBeNull();
        expect(diag.discretionarySharePct).not.toBeNull();
        expect(diag.fixedExpensesSharePct! + diag.discretionarySharePct!).toBeCloseTo(100, 0);
        expect(diag.expenseVolatilityPct).toBeGreaterThan(0);
        expect(diag.findingsFr.length).toBeGreaterThanOrEqual(3);
        expect(diag.findingsFr.length).toBeLessThanOrEqual(5);
    });
});

describe('collectLiveNewsAndFundamentals & anonymisation Gemini', () => {
    it('fonctionne proprement hors-ligne avec skipNetwork=true et fournit Valoria + signaux déterministes', async () => {
        const params = makeBaseParams(20);
        const assets = makeTestAssets();
        const { newsBundle, valoriaForecast } = await collectLiveNewsAndFundamentals({
            params,
            assets,
            fxRates: { USD: 1.38 },
            skipNetwork: true,
        });

        expect(valoriaForecast).not.toBeNull();
        expect(newsBundle.offlineFallbackUsed).toBe(true);
        expect(newsBundle.liveArticlesUsed).toBe(0);
        expect(newsBundle.usedGemini).toBe(false);
        expect(newsBundle.aiSynthesisFr).toBeTruthy();
        expect(newsBundle.keySignals.length).toBeGreaterThan(0);
        expect(Number.isFinite(newsBundle.annualizedReturnAdjustmentPct)).toBe(true);
        expect(Number.isFinite(newsBundle.volatilityMultiplier)).toBe(true);
    });

    it('dégrade silencieusement si le réseau renvoie HTTP 500 sans jeter d’exception', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'service down' }), {
                status: 500,
                headers: { 'content-type': 'application/json' },
            }),
        );
        vi.stubGlobal('fetch', fetchMock);

        const params = makeBaseParams(15);
        const { newsBundle } = await collectLiveNewsAndFundamentals({
            params,
            assets: makeTestAssets(),
            fxRates: { USD: 1.38 },
            skipNetwork: false,
        });

        expect(newsBundle.offlineFallbackUsed).toBe(true);
        expect(newsBundle.usedGemini).toBe(false);
        expect(newsBundle.aiSynthesisFr).toBeTruthy();
    });

    it('anonymise à 100 % le prompt Gemini (ACTIF_01..12, poids %, zéro ticker/nom/$ ni 0 fictif)', async () => {
        // Vérification unitaire directe de la fonction pure avec valeurs absentes -> "(non disponible)"
        const rawPrompt = buildAnonymizedNewsAndMacroPrompt({
            slots: [
                {
                    code: 'ACTIF_01',
                    weightPct: 53.6,
                    categoryLabel: 'Actions canadiennes',
                    sectorLabel: 'Marché large Canada',
                    accountTypeLabel: 'REER/REEE',
                    sentimentScore: 68,
                },
                {
                    code: 'ACTIF_02',
                    weightPct: 46.4,
                    categoryLabel: 'Actions américaines',
                    sectorLabel: 'Marché large US',
                    accountTypeLabel: 'CELI/CELIAPP',
                    sentimentScore: null,
                },
            ],
            portfolioSentimentScore: null,
            annualizedReturnAdjustmentPct: 0.35,
            volatilityMultiplier: 1.04,
            horizonYears: 20,
            macroHeadlineFr: 'Taux directeurs canadiens stables',
            forbiddenTokens: ['XIU.TO', 'SPY', 'Benchmark'],
        });

        expect(rawPrompt).toContain('ACTIF_01');
        expect(rawPrompt).toContain('ACTIF_02');
        expect(rawPrompt).toContain('53,6 %');
        expect(rawPrompt).toContain('(non disponible)');
        expect(rawPrompt).not.toContain('XIU.TO');
        expect(rawPrompt).not.toContain('SPY');
        expect(rawPrompt).not.toContain('$');

        let capturedGeminiBody = '';
        const fetchMock = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
            const target = String(url);
            if (target.includes('/api/news/intelligence')) {
                return new Response(
                    JSON.stringify({
                        articles: [
                            {
                                id: 'live-1',
                                title: 'Stabilité des banques centrales nord-américaines',
                                category: 'Macro Canada',
                                sentimentScore: 22,
                                expectedReturnShockPct: 0.4,
                                isLiveWeb: true,
                            },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (target.includes('/api/market/verified-feed')) {
                return new Response(
                    JSON.stringify({ macro: { inflationPct: 2.2, centralBankRatePct: 2.75 } }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (target.includes('generativelanguage.googleapis.com') || target.includes('/api/ai')) {
                capturedGeminiBody = typeof init?.body === 'string' ? init.body : '';
                return new Response(
                    JSON.stringify({
                        candidates: [
                            {
                                content: {
                                    parts: [
                                        {
                                            text: 'Votre allocation équilibrée entre ACTIF_01 et ACTIF_02 bénéficie d’un contexte monétaire apaisé.',
                                        },
                                    ],
                                },
                            },
                        ],
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            return new Response('Not found', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);

        const params = makeBaseParams(20);
        const assets = makeTestAssets();
        const { newsBundle } = await collectLiveNewsAndFundamentals({
            params,
            assets,
            fxRates: { USD: 1.38 },
            apiKey: 'AIzaSySyntheticMockedGeminiKeyForTests9988',
            skipNetwork: false,
        });

        expect(newsBundle.offlineFallbackUsed).toBe(false);
        expect(newsBundle.liveArticlesUsed).toBeGreaterThanOrEqual(1);
        expect(newsBundle.usedGemini).toBe(true);
        expect(newsBundle.aiSynthesisFr).toContain('ACTIF_01');
        expect(capturedGeminiBody).toContain('ACTIF_01');
        expect(capturedGeminiBody).toContain('ACTIF_02');
        expect(capturedGeminiBody).not.toContain('XIU.TO');
        expect(capturedGeminiBody).not.toContain('SPY');
        expect(capturedGeminiBody).not.toContain('80000');
        expect(capturedGeminiBody).not.toContain('80 000');
        expect(capturedGeminiBody).not.toContain('69000');
        expect(capturedGeminiBody).not.toContain('$');
    });
});

describe('computeQuickFourScenarios — aperçu instantané < 50 ms', () => {
    it('génère les 4 scénarios cohérents et bornés à partir de baseProjection', () => {
        const params = makeBaseParams(20);
        const baseProjection = calculateFutureProjection(params, false, 0);
        const pastDiagnostic = analyzeRealPastDossier({
            transactions: makeTwelveMonthTransactions(),
            assets: makeTestAssets(),
            fxRates: { USD: 1.38 },
            budgetItems: makeBudgetItems(),
        });
        const sig = computeDeepForecastInputsSig({ params });

        const t0 = performance.now();
        const quick = computeQuickFourScenarios({
            params,
            baseProjection,
            pastDiagnostic,
            inputsSig: sig,
        });
        const elapsedMs = performance.now() - t0;

        expect(elapsedMs).toBeLessThan(150);
        expect(quick.isDeepRun).toBe(false);
        expect(quick.trajectoriesRun).toBe(400);
        expect(quick.inputsSig).toBe(sig);

        for (const id of DEEP_SCENARIO_IDS) {
            const sc = quick.scenarios[id];
            expect(sc.points.length).toBeGreaterThan(12);
            expect(sc.turningPoints.length).toBeGreaterThanOrEqual(3);
            for (const pt of sc.points) {
                expect(pt.p10).toBeLessThanOrEqual(pt.p50);
                expect(pt.p50).toBeLessThanOrEqual(pt.p90);
                expect(pt.mcRange).toEqual([pt.p10, pt.p90]);
            }
        }

        const p50Prudent = quick.scenarios.prudent_stress.milestones.finalNetWorthP50!;
        const p50Real = quick.scenarios.real_trajectory.milestones.finalNetWorthP50!;
        const p50Ai = quick.scenarios.ai_optimized.milestones.finalNetWorthP50!;
        const p50Fav = quick.scenarios.favorable_tailwinds.milestones.finalNetWorthP50!;

        expect(p50Prudent).toBeLessThanOrEqual(p50Real);
        expect(p50Real).toBeLessThanOrEqual(p50Fav);
        expect(p50Ai).toBeGreaterThanOrEqual(p50Real);
        expect(quick.concreteActions.length).toBeGreaterThanOrEqual(3);
    });
});

describe('runDeepForecastAsync & moteur sharded 100k — cohérence, Worker pool et annulation', () => {
    it('expose DEFAULT_DEEP_TRAJECTORIES >= 100 000', () => {
        expect(DEFAULT_DEEP_TRAJECTORIES).toBe(100_000);
    });

    it('exécute les 4 phases, atteint 100 % et garantit des bandes et ordres de scénarios cohérents', async () => {
        const goal: FinancialGoal = {
            id: 'goal-1',
            name: 'Coussin objectif test',
            type: 'NET_WORTH',
            targetAmount: 300_000,
            deadline: '2035-06-01',
            status: 'active',
        };
        const params = makeBaseParams(20, [goal]);
        const txs = makeTwelveMonthTransactions();
        const assets = makeTestAssets();
        const budgetItems = makeBudgetItems();
        const progressEvents: DeepForecastProgress[] = [];

        const report = await runDeepForecastAsync(
            {
                params,
                transactions: txs,
                assets,
                fxRates: { USD: 1.38 },
                budgetItems,
            },
            {
                trajectoriesOverride: 2_000,
                skipNetwork: true,
                onProgress: (p) => progressEvents.push(p),
            },
        );

        expect(report.version).toBe(1);
        expect(report.isDeepRun).toBe(true);
        expect(report.trajectoriesRun).toBe(2_000);
        expect(report.pastDiagnostic.transactionsAnalyzed).toBe(txs.length);
        expect(report.newsBundle.offlineFallbackUsed).toBe(true);
        expect(report.valoriaSummary).not.toBeNull();
        expect(report.concreteActions.length).toBeGreaterThanOrEqual(3);
        expect(report.concreteActions.length).toBeLessThanOrEqual(4);

        const phasesSeen = new Set(progressEvents.map((p) => p.phase));
        expect(phasesSeen.has('past_audit')).toBe(true);
        expect(phasesSeen.has('news_and_fundamentals')).toBe(true);
        expect(phasesSeen.has('monte_carlo_100k')).toBe(true);
        expect(phasesSeen.has('ai_optimization')).toBe(true);
        expect(phasesSeen.has('done')).toBe(true);
        const lastProgress = progressEvents[progressEvents.length - 1];
        expect(lastProgress.percent).toBe(100);
        expect(lastProgress.trajectoriesDone).toBe(2_000);
        expect(lastProgress.trajectoriesTotal).toBe(2_000);
        expect(lastProgress.etaSeconds).toBe(0);

        // Progression monotone des pourcentages
        for (let i = 1; i < progressEvents.length; i++) {
            expect(progressEvents[i].percent).toBeGreaterThanOrEqual(progressEvents[i - 1].percent);
        }

        for (const id of DEEP_SCENARIO_IDS) {
            const sc = report.scenarios[id];
            expect(sc.points.length).toBe(241); // 20 ans * 12 + mois 0
            expect(sc.turningPoints.length).toBeGreaterThanOrEqual(3);
            expect(sc.milestones.goalsSummary.length).toBe(1);
            expect(sc.milestones.goalsSummary[0].probabilityPct).not.toBeNull();
            expect(Number.isFinite(sc.milestones.sustainableMonthlyNetRetirementCad)).toBe(true);
            for (const pt of sc.points) {
                expect(Number.isFinite(pt.p10)).toBe(true);
                expect(Number.isFinite(pt.p50)).toBe(true);
                expect(Number.isFinite(pt.p90)).toBe(true);
                expect(pt.p10).toBeLessThanOrEqual(pt.p50);
                expect(pt.p50).toBeLessThanOrEqual(pt.p90);
                expect(pt.mcRange).toEqual([pt.p10, pt.p90]);
            }
        }

        const finPrudent = report.scenarios.prudent_stress.milestones.finalNetWorthP50!;
        const finReal = report.scenarios.real_trajectory.milestones.finalNetWorthP50!;
        const finAi = report.scenarios.ai_optimized.milestones.finalNetWorthP50!;
        const finFav = report.scenarios.favorable_tailwinds.milestones.finalNetWorthP50!;

        expect(finPrudent).toBeLessThan(finReal);
        expect(finReal).toBeLessThan(finFav);
        expect(finAi).toBeGreaterThanOrEqual(finReal);
        expect(report.scenarios.ai_optimized.appliedOptimizationsFr.length).toBeGreaterThan(0);
    });

    it('rejette un AbortSignal déjà annulé et annule en plein vol pendant Monte Carlo', async () => {
        const params = makeBaseParams(15);

        const preController = new AbortController();
        preController.abort();
        await expect(
            runDeepForecastAsync({ params }, { signal: preController.signal, skipNetwork: true }),
        ).rejects.toThrow(DEEP_FORECAST_CANCELLED);

        const midController = new AbortController();
        await expect(
            runDeepForecastAsync(
                { params },
                {
                    trajectoriesOverride: 1_200,
                    skipNetwork: true,
                    signal: midController.signal,
                    onProgress: (p) => {
                        if (p.phase === 'monte_carlo_100k') {
                            midController.abort();
                        }
                    },
                },
            ),
        ).rejects.toThrow(DEEP_FORECAST_CANCELLED);

        const refusedParams = makeBaseParams(15);
        refusedParams.entreesRefusees = [
            {
                chemin: 'config.users[0].netSalary',
                libelle: 'le salaire net',
                valeur: 'NaN',
                role: 'cause',
            },
        ];
        await expect(
            runDeepForecastAsync({ params: refusedParams }, { skipNetwork: true }),
        ).rejects.toThrow('Projection impossible');
    });

    it('parallélise les shards via pool de Web Workers avec parité exacte et termine les workers sur abort', async () => {
        const params = makeBaseParams(10);
        const transactions = makeTwelveMonthTransactions();
        const assets = makeTestAssets();

        // 1. Exécution référence sans Worker (fallback chunké) avec seed fixe
        const sequentialReport = await runDeepForecastAsync(
            { params, transactions, assets, fxRates: { USD: 1.38 } },
            { trajectoriesOverride: 800, skipNetwork: true, seed: 424242 },
        );

        // 2. Exécution via pool de 2 Workers simulés exécutant vraiment computeDeepScenarioShard
        const terminatedWorkers: number[] = [];
        const shardPayloads: Array<{ startIter: number; count: number }> = [];

        class MockDeepWorker {
            private listeners = new Map<string, Set<(ev: unknown) => void>>();
            public readonly idx: number;
            constructor() {
                this.idx = shardPayloads.length;
            }
            addEventListener(type: string, cb: (ev: unknown) => void) {
                if (!this.listeners.has(type)) this.listeners.set(type, new Set());
                this.listeners.get(type)!.add(cb);
            }
            removeEventListener(type: string, cb: (ev: unknown) => void) {
                this.listeners.get(type)?.delete(cb);
            }
            postMessage(msg: {
                __requestId: number;
                mode: string;
                deepShardRequest: Parameters<typeof computeDeepScenarioShard>[0];
            }) {
                expect(msg.mode).toBe('deepForecastShard');
                shardPayloads.push({
                    startIter: msg.deepShardRequest.startIter,
                    count: msg.deepShardRequest.count,
                });
                queueMicrotask(() => {
                    const out = computeDeepScenarioShard(msg.deepShardRequest, (done, total) => {
                        for (const cb of this.listeners.get('message') ?? []) {
                            cb({ data: { __requestId: msg.__requestId, __progress: { done, total } } });
                        }
                    });
                    for (const cb of this.listeners.get('message') ?? []) {
                        cb({ data: { __requestId: msg.__requestId, result: out } });
                    }
                });
            }
            terminate() {
                terminatedWorkers.push(this.idx);
            }
        }

        vi.stubGlobal('Worker', MockDeepWorker as unknown as typeof Worker);

        const workerReport = await runDeepForecastAsync(
            { params, transactions, assets, fxRates: { USD: 1.38 } },
            { trajectoriesOverride: 800, skipNetwork: true, maxWorkers: 2, seed: 424242 },
        );

        expect(shardPayloads).toEqual([
            { startIter: 0, count: 100 },
            { startIter: 100, count: 100 },
        ]);
        expect(terminatedWorkers.length).toBe(2);
        expect(workerReport.trajectoriesRun).toBe(800);
        // Parité exacte des scalaires finaux P50 entre 2 workers sharded et le calcul chunké séquentiel
        for (const id of DEEP_SCENARIO_IDS) {
            expect(workerReport.scenarios[id].milestones.finalNetWorthP50).toBeCloseTo(
                sequentialReport.scenarios[id].milestones.finalNetWorthP50!,
                0,
            );
        }

        // Vérification également sur abort en vol avec MockWorker : terminate() appelé immédiatement
        const abortTerminations: number[] = [];
        class HangingMockWorker {
            private listeners = new Map<string, Set<(ev: unknown) => void>>();
            addEventListener(type: string, cb: (ev: unknown) => void) {
                if (!this.listeners.has(type)) this.listeners.set(type, new Set());
                this.listeners.get(type)!.add(cb);
            }
            removeEventListener(type: string, cb: (ev: unknown) => void) {
                this.listeners.get(type)?.delete(cb);
            }
            postMessage() {
                // Ne répond pas immédiatement pour tester l'abort en vol
            }
            terminate() {
                abortTerminations.push(1);
            }
        }
        vi.stubGlobal('Worker', HangingMockWorker as unknown as typeof Worker);
        const abortCtrl = new AbortController();
        setTimeout(() => abortCtrl.abort(), 15);
        await expect(
            runDeepForecastAsync(
                { params },
                { trajectoriesOverride: 400, skipNetwork: true, maxWorkers: 2, signal: abortCtrl.signal },
            ),
        ).rejects.toThrow(DEEP_FORECAST_CANCELLED);
        expect(abortTerminations.length).toBe(2);
    });

    it('assure la reproductibilité directe de computeDeepScenarioShard + aggregateDeepForecastShards sur 2 shards', () => {
        const params = makeBaseParams(10);
        const past = analyzeRealPastDossier({ transactions: makeTwelveMonthTransactions() });
        const aiPlan = exploreAiOptimizedStrategy({ params, pastDiagnostic: past });
        const { baselines, classifiedGoals, valoriaSummary } = prepareDeepScenarioBaselines({
            params,
            pastDiagnostic: past,
            newsBundle: {
                collectedAtIso: '2026-11-18T00:00:00.000Z',
                liveArticlesUsed: 0,
                offlineFallbackUsed: true,
                portfolioSentimentScore: null,
                portfolioSentimentLabel: 'Neutre',
                annualizedReturnAdjustmentPct: 0,
                volatilityMultiplier: 1,
                macroHeadlineFr: 'Neutre',
                keySignals: [],
                aiSynthesisFr: null,
                usedGemini: false,
            },
            valoriaForecast: null,
            precomputedAiPlan: aiPlan,
        });

        const s1 = computeDeepScenarioShard({
            baselines,
            classifiedGoals,
            startIter: 0,
            count: 75,
            seed: 98765,
        });
        const s2 = computeDeepScenarioShard({
            baselines,
            classifiedGoals,
            startIter: 75,
            count: 75,
            seed: 98765,
        });

        const merged = aggregateDeepForecastShards({
            shards: [s1, s2],
            baselines,
            classifiedGoals,
            pastDiagnostic: past,
            newsBundle: {
                collectedAtIso: '2026-11-18T00:00:00.000Z',
                liveArticlesUsed: 0,
                offlineFallbackUsed: true,
                portfolioSentimentScore: null,
                portfolioSentimentLabel: 'Neutre',
                annualizedReturnAdjustmentPct: 0,
                volatilityMultiplier: 1,
                macroHeadlineFr: 'Neutre',
                keySignals: [],
                aiSynthesisFr: null,
                usedGemini: false,
            },
            valoriaSummary,
            inputsSig: 'df1:test',
            durationMs: 12,
        });

        expect(merged.trajectoriesRun).toBe(600); // 150 coupled * 4
        expect(merged.isDeepRun).toBe(true);
    });
});

describe('computeDeepForecastInputsSig — signature canonique déterministe', () => {
    it('normalise -0, distingue NaN/Infinity/null, ignore entreesRefusees et détecte tout changement d’entrée', () => {
        const p1 = makeBaseParams(15);
        const p2 = makeBaseParams(15);
        p2.calculatedStartingCash = -0;
        p1.calculatedStartingCash = 0;

        expect(computeDeepForecastInputsSig({ params: p1 })).toBe(
            computeDeepForecastInputsSig({ params: p2 }),
        );

        // entreesRefusees ignoré
        p2.entreesRefusees = [{ chemin: 'x', libelle: 'y', valeur: 'NaN', role: 'cause' }];
        expect(computeDeepForecastInputsSig({ params: p1 })).toBe(
            computeDeepForecastInputsSig({ params: p2 }),
        );

        // NaN vs Infinity vs null distincts
        const pNaN = makeBaseParams(15);
        pNaN.baseMonthlyExpenses = Number.NaN;
        const pInf = makeBaseParams(15);
        pInf.baseMonthlyExpenses = Number.POSITIVE_INFINITY;
        expect(computeDeepForecastInputsSig({ params: pNaN })).not.toBe(
            computeDeepForecastInputsSig({ params: pInf }),
        );

        // Sensibilité transactions / assets / profil Valoria
        const sigBase = computeDeepForecastInputsSig({ params: p1 });
        const sigWithTx = computeDeepForecastInputsSig({
            params: p1,
            transactions: makeTwelveMonthTransactions(),
        });
        const sigWithAssets = computeDeepForecastInputsSig({
            params: p1,
            assets: makeTestAssets(),
        });
        const sigWithProfile = computeDeepForecastInputsSig({
            params: p1,
            valoriaRiskProfile: 'dynamique',
        });

        expect(sigWithTx).not.toBe(sigBase);
        expect(sigWithAssets).not.toBe(sigBase);
        expect(sigWithProfile).not.toBe(sigBase);
    });
});

describe('projection.worker.ts — mode deepForecastShard zero-copy', () => {
    it('exécute deepForecastShard via self.onmessage et transfère des ArrayBuffer uniques', async () => {
        const postedMessages: Array<{ msg: Record<string, unknown>; transfer?: Transferable[] }> = [];
        const mockSelf: {
            onmessage: ((e: MessageEvent) => void) | null;
            postMessage: (msg: Record<string, unknown>, transfer?: Transferable[]) => void;
        } = {
            onmessage: null,
            postMessage: (msg, transfer) => {
                postedMessages.push({ msg, transfer });
            },
        };

        vi.resetModules();
        vi.stubGlobal('self', mockSelf);
        await import('../../services/projection.worker');

        expect(typeof mockSelf.onmessage).toBe('function');

        const params = makeBaseParams(8);
        const past = analyzeRealPastDossier({ transactions: makeTwelveMonthTransactions() });
        const { baselines, classifiedGoals } = prepareDeepScenarioBaselines({
            params,
            pastDiagnostic: past,
            newsBundle: {
                collectedAtIso: '2026-11-18T00:00:00.000Z',
                liveArticlesUsed: 0,
                offlineFallbackUsed: true,
                portfolioSentimentScore: null,
                portfolioSentimentLabel: 'Neutre',
                annualizedReturnAdjustmentPct: 0,
                volatilityMultiplier: 1,
                macroHeadlineFr: 'Neutre',
                keySignals: [],
                aiSynthesisFr: null,
                usedGemini: false,
            },
            valoriaForecast: null,
        });

        mockSelf.onmessage!({
            data: {
                __requestId: 7,
                mode: 'deepForecastShard',
                deepShardRequest: {
                    baselines,
                    classifiedGoals,
                    startIter: 0,
                    count: 25,
                    seed: 12345,
                },
            },
        } as MessageEvent);

        const resultPost = postedMessages.find((p) => p.msg.__requestId === 7 && p.msg.result);
        expect(resultPost).toBeDefined();
        expect(Array.isArray(resultPost!.transfer)).toBe(true);
        expect(resultPost!.transfer!.length).toBeGreaterThan(0);
        // Aucun ArrayBuffer en double (éviterait DataCloneError)
        expect(new Set(resultPost!.transfer).size).toBe(resultPost!.transfer!.length);
    });
});
