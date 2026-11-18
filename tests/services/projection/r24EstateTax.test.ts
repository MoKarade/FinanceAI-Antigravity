import { describe, it, expect } from 'vitest';
import { calculateFiscalReport, QC_FEDERAL_ABATEMENT_RATE, type FiscalReport } from '../../../utils/tax';
import { computeEstateNetWorth, type EstateCalcInputs } from '../../../services/projection/estateCalculation';
import {
    __runScenarioForTests as runScenario,
    runGrandCalculShard,
    mergeGrandCalculShards,
    computeGrandCalculDeterministicBaseline,
    type SimulationParams,
} from '../../../services/projection';
import type { ProjectionConfig, BudgetConfig, RetirementGoal, RentalProperty, RealEstateGoal, LifeEvent } from '../../../types';

const makeEstateInputs = (overrides: Partial<EstateCalcInputs> = {}): EstateCalcInputs => ({
    liquid: 30_000,
    celi: 120_000,
    celiapp: 0,
    reer: 400_000,
    nonReg: 200_000,
    nonRegACB: 100_000,
    crypto: 0,
    cryptoACB: 0,
    reee: 0,
    realEstateEquity: 0,
    mortgageBalance: 0,
    smithManoeuvreDebt: 0,
    incomeRetirement: 2500,
    accRentesYear: 0,
    accRetraitsReerYear: 0,
    grossMarcBaseAnnual: 0,
    grossAnnaBaseAnnual: 0,
    simSalaryGrowth: 2,
    simulationYears: 15,
    startYear: 2026,
    currentAge: 60,
    retirementTargetAge: 65,
    governmentPension: 1500,
    lifeExpectancy: 90,
    activeUsersCount: 1,
    simInflation: 2,
    enableMonteCarlo: false,
    startingCash: 20_000,
    startingCELI: 50_000,
    startingCELIAPP: 0,
    startingREER: 150_000,
    startingNonReg: 50_000,
    startingCrypto: 0,
    startingREEE: 0,
    ...overrides,
});

const makeScenarioParams = (overrides: {
    age?: number;
    years?: number;
    rentalProperties?: RentalProperty[];
    realEstateGoals?: RealEstateGoal[];
    lifeEvents?: LifeEvent[];
    useStochasticMortality?: boolean;
} = {}): SimulationParams => {
    const age = overrides.age ?? 60;
    const projection: ProjectionConfig = {
        years: overrides.years ?? 20,
        returnRate: 6.0,
        inflationRate: 2.0,
        savingsMode: 'manual',
        manualContribution: 0,
        usePortfolioRate: false,
        returnRates: { celi: 6, reer: 6, nonReg: 6, crypto: 0, cash: 2 },
        emergencyFundMonths: 3,
        salaryGrowth: 2.0,
        propertyGrowthRate: 3,
        useStochasticMortality: overrides.useStochasticMortality ?? false,
    };
    const config: BudgetConfig = {
        users: [
            {
                name: 'SuccessionTest',
                grossSalary: 0,
                netSalary: 0,
                color: '#10b981',
                age,
                birthYear: 2026 - age,
                canadaArrivalYear: 1980,
                hasOwnedPropertyLast4Years: true,
                celiContributed: 0,
                rrspContributed: 0,
            },
        ],
        splitMode: '50/50',
    } as unknown as BudgetConfig;
    const retirementGoal: RetirementGoal = {
        targetAge: 60,
        targetMonthlyIncome: 4000,
        governmentPension: 1500,
        lifeExpectancy: 90,
    };
    return {
        projection,
        calculatedStartingCash: 25_000,
        liveCSVBalances: {
            CELI: 100_000,
            CELIAPP: 0,
            REER: 350_000,
            NON_ENREG: 120_000,
            CRYPTO: 0,
            REEE: 0,
        },
        realEstateGoals: overrides.realEstateGoals ?? [],
        debts: [],
        childGoals: [],
        travelGoals: [],
        lifeEvents: overrides.lifeEvents ?? [],
        retirementGoal,
        config,
        baseGrossAnnual: 0,
        baseNetAnnual: 0,
        currentRentExpense: 1600,
        baseMonthlyExpenses: 3200,
        startYear: 2026,
        startMonth: 0,
        rentalProperties: overrides.rentalProperties ?? [],
        financialGoals: [],
    };
};

describe('R2.4 — Impôt successoral latent (ARC / RQ), locatif DPA & mortalité précoce', () => {
    it('ventile fedEstateTax (ARC après abattement 16,5 % QC) et qcEstateTax (RQ) avec somme exacte', () => {
        const res = computeEstateNetWorth(makeEstateInputs(), calculateFiscalReport);
        expect(res.fedEstateTax).not.toBeNull();
        expect(res.qcEstateTax).not.toBeNull();
        expect(res.fedEstateTax!).toBeGreaterThan(0);
        expect(res.qcEstateTax!).toBeGreaterThan(0);
        expect(res.fedEstateTax! + res.qcEstateTax!).toBeCloseTo(res.totalEstateTax, 2);
        expect(res.taxableBreakdown.rrspRrif).toBe(400_000);
        expect(res.taxableBreakdown.capitalGainsTaxable).toBe(50_000); // 50% de 100k gain NonReg
        expect(res.taxableBreakdown.rentalRecapture).toBe(0);
        expect(res.projectedDeathAge).toBe(75);
        expect(QC_FEDERAL_ABATEMENT_RATE).toBe(0.165);
    });

    it('reste compatible avec les stubs partiels { totalTax } (no-fake-data : fed/qc = null)', () => {
        const partialStub = ((gross: number) => ({ totalTax: gross * 0.25 } as unknown as FiscalReport));
        const res = computeEstateNetWorth(makeEstateInputs(), partialStub);
        expect(res.totalEstateTax).toBeGreaterThan(0);
        expect(res.fedEstateTax).toBeNull();
        expect(res.qcEstateTax).toBeNull();
    });

    it('inclut le gain en capital (50 %) et la récupération de DPA (100 % LIR 13(1)) des immeubles locatifs, et les partage au divorce', () => {
        const rental: RentalProperty = {
            id: 'r-test',
            name: 'Duplex Test',
            purchasePrice: 500_000,
            currentValue: 650_000,
            mortgageBalance: 200_000,
            mortgageRate: 4.5,
            amortizationYears: 25,
            monthlyRent: 3200,
            vacancyPct: 5,
            monthlyExpenses: 800,
            propertyGrowthRate: 0,
            ccaTaken: 40_000,
        };
        const withRental = runScenario(makeScenarioParams({ years: 5, rentalProperties: [rental] }), 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        const withoutRental = runScenario(makeScenarioParams({ years: 5, rentalProperties: [] }), 'AUTO_MARGINAL', false, false, 0, 'BASE', {});

        // Seule la DPA antérieure réellement déduite (ccaTaken = 40 000) est récupérable (jamais la DPA non déduite en simulation)
        expect(withRental.estateTaxableBreakdown?.rentalRecapture).toBeCloseTo(40_000, 2);
        expect(withRental.estateTaxableBreakdown?.capitalGainsTaxable).toBeGreaterThan(withoutRental.estateTaxableBreakdown?.capitalGainsTaxable ?? 0);
        expect(withRental.totalEstateTax).toBeGreaterThan(withoutRental.totalEstateTax);

        // Sans DPA antérieure (ccaTaken = 0), aucune récupération fantôme n'est imposée, mais la plus-value (50 %) est bien imposée
        const noPriorCcaRental: RentalProperty = {
            ...rental,
            currentValue: 700_000,
            ccaTaken: 0,
        };
        const withZeroCca = runScenario(makeScenarioParams({ years: 20, rentalProperties: [noPriorCcaRental] }), 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        const withoutZeroCca = runScenario(makeScenarioParams({ years: 20, rentalProperties: [] }), 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(withZeroCca.estateTaxableBreakdown?.rentalRecapture).toBe(0);
        expect(
            (withZeroCca.estateTaxableBreakdown?.capitalGainsTaxable ?? 0)
            - (withoutZeroCca.estateTaxableBreakdown?.capitalGainsTaxable ?? 0),
        ).toBeGreaterThanOrEqual(99_999);

        // Parité .filter(Boolean) entre initRentalStates et rentalTaxBases si une entrée nullish se glisse
        const sparseRes = runScenario(
            makeScenarioParams({ years: 5, rentalProperties: [null as unknown as RentalProperty, rental] }),
            'AUTO_MARGINAL',
            false,
            false,
            0,
            'BASE',
            {},
        );
        expect(sparseRes.estateTaxableBreakdown?.rentalRecapture).toBeCloseTo(40_000, 2);

        // Vérifie la proportionnalité après divorce (divorceSplitPct = 50 %)
        const paramsDiv = makeScenarioParams({
            years: 5,
            rentalProperties: [rental],
        });
        paramsDiv.config.users.push({
            name: 'Conjoint',
            grossSalary: 0,
            netSalary: 0,
            color: '#3b82f6',
            age: 60,
            birthYear: 1966,
            canadaArrivalYear: 1980,
            hasOwnedPropertyLast4Years: true,
            celiContributed: 0,
            rrspContributed: 0,
        } as unknown as BudgetConfig['users'][number]);
        paramsDiv.projection.divorceEnabled = true;
        paramsDiv.projection.divorceAnnualProbability = 0.99;
        paramsDiv.projection.divorceSplitPct = 50;
        // Déclenche au moins un divorce en MC pour vérifier la réduction de rentalRecapture
        let divorcedRun: ReturnType<typeof runScenario> | null = null;
        for (let k = 0; k < 40; k++) {
            const candidate = runScenario(paramsDiv, 'AUTO_MARGINAL', true, false, k, 'BASE', {});
            if ((candidate.estateTaxableBreakdown?.rentalRecapture ?? 0) < withRental.estateTaxableBreakdown!.rentalRecapture * 0.75) {
                divorcedRun = candidate;
                break;
            }
        }
        expect(divorcedRun).not.toBeNull();
    });

    it('calcule elapsedYearsAtEnd = m / 12 lors d’un décès stochastique précoce (tryMortality) et zéroïse la VAN post-mortem', () => {
        const earlyParams = makeScenarioParams({ age: 92, years: 10, useStochasticMortality: true });
        let earlyFound = false;
        for (let k = 0; k < 25; k++) {
            const r = runScenario(earlyParams, 'AUTO_MARGINAL', true, false, k, 'BASE', {});
            if (r.projectedDeathAge < 102) {
                earlyFound = true;
                expect(r.projectedDeathAge).toBeCloseTo(92 + (r.chartData.length / 12), 4);
                break;
            }
        }
        expect(earlyFound).toBe(true);

        // Comparaison isDeceasedEarly: true vs false sur computeEstateNetWorth
        const aliveEstate = computeEstateNetWorth(makeEstateInputs({ isDeceasedEarly: false }), calculateFiscalReport);
        const deadEarlyEstate = computeEstateNetWorth(makeEstateInputs({ isDeceasedEarly: true }), calculateFiscalReport);
        expect(deadEarlyEstate.estateNetWorth).toBeLessThan(aliveEstate.estateNetWorth);
        expect(deadEarlyEstate.estateNetWorth).toBeCloseTo(deadEarlyEstate.finalRawNetWorth - deadEarlyEstate.totalEstateTax, 2);
    });

    it('agrège les quantiles MC d’impôt successoral et préserve P5 <= P50 <= P95 + déflation réelle', () => {
        const params = makeScenarioParams({ age: 58, years: 15 });
        params.liveCSVBalances.REER = 800_000;
        params.liveCSVBalances.NON_ENREG = 300_000;
        const shard = runGrandCalculShard(
            params,
            { iterations: 50_000, enableMacroRegimes: true, includeHistoricalCrises: false, seed: 31 },
            0,
            60,
        );
        const baseline = computeGrandCalculDeterministicBaseline(params);
        const merged = mergeGrandCalculShards([shard], {
            paramsSig: 'r24-mc',
            durationMs: 10,
            regimesEnabled: true,
            historicalCrisesEnabled: false,
            startYear: params.startYear,
            currentAge: 58,
            ...baseline,
        });

        const est = merged.estateTax;
        expect(est.deterministicTotal).not.toBeNull();
        expect(est.deterministicFed).not.toBeNull();
        expect(est.deterministicQc).not.toBeNull();
        expect(est.deterministicFed! + est.deterministicQc!).toBeCloseTo(est.deterministicTotal!, 2);
        expect(est.mcTotalP5).not.toBeNull();
        expect(est.mcTotalP50).not.toBeNull();
        expect(est.mcTotalP95).not.toBeNull();
        expect(est.mcTotalP5!).toBeLessThanOrEqual(est.mcTotalP50!);
        expect(est.mcTotalP50!).toBeLessThanOrEqual(est.mcTotalP95!);
        expect(est.mcFedP50!).toBeGreaterThan(0);
        expect(est.mcQcP50!).toBeGreaterThan(0);
        expect(est.mcRealTotalP50!).toBeLessThanOrEqual(est.mcTotalP50!);
    });

    it('partage proportionnellement le coût (p.cost) d’un RealEstateGoal non-résidence principale au divorce pour le gain en capital successoral', () => {
        const secondaryProp: RealEstateGoal = {
            id: 'chalet-1',
            name: 'Chalet locatif',
            isActive: true,
            isOwned: true,
            purchaseDate: '2020-01-01',
            price: 500_000,
            downPayment: 100_000,
            mortgageRate: 4.0,
            amortization: 25,
            totalClosingCosts: 0,
            monthlyPayment: 2100,
            unrecoverableMonthly: 300,
            isPrimaryResidence: false,
            propertyGrowthRate: 5,
        };
        const noDivParams = makeScenarioParams({ years: 10, realEstateGoals: [secondaryProp] });
        noDivParams.liveCSVBalances.REER = 0;
        noDivParams.liveCSVBalances.NON_ENREG = 0;
        noDivParams.liveCSVBalances.CELI = 200_000;
        noDivParams.config.users.push({
            name: 'Conjoint',
            grossSalary: 0,
            netSalary: 0,
            color: '#3b82f6',
            age: 60,
            birthYear: 1966,
            canadaArrivalYear: 1980,
            hasOwnedPropertyLast4Years: true,
            celiContributed: 0,
            rrspContributed: 0,
        } as unknown as BudgetConfig['users'][number]);

        const noDiv = runScenario(noDivParams, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        const baseCg = noDiv.estateTaxableBreakdown?.capitalGainsTaxable ?? 0;
        expect(baseCg).toBeGreaterThan(200_000);

        const divParams = makeScenarioParams({ years: 10, realEstateGoals: [secondaryProp] });
        divParams.liveCSVBalances.REER = 0;
        divParams.liveCSVBalances.NON_ENREG = 0;
        divParams.liveCSVBalances.CELI = 200_000;
        divParams.config.users = noDivParams.config.users;
        divParams.projection.divorceEnabled = true;
        divParams.projection.divorceAnnualProbability = 1.0;
        divParams.projection.divorceSplitPct = 50;

        // Itération MC qui déclenche le divorce : capitalGainsTaxable doit être exactement 50 % du scénario sans divorce
        let divorcedCg: number | null = null;
        for (let k = 0; k < 20; k++) {
            const res = runScenario(divParams, 'AUTO_MARGINAL', true, false, k, 'BASE', {});
            const cg = res.estateTaxableBreakdown?.capitalGainsTaxable ?? 0;
            if (cg > 0 && Math.abs(cg - baseCg * 0.5) < 1) {
                divorcedCg = cg;
                break;
            }
        }
        expect(divorcedCg).not.toBeNull();
        expect(divorcedCg!).toBeCloseTo(baseCg * 0.5, 2);
    });

    it('exonère la résidence principale de gain en capital (0 CG) contrairement à un immeuble secondaire et résiste aux entrées NaN', () => {
        const basePrimary: RealEstateGoal = {
            id: 'rp-1',
            name: 'Maison principale',
            isActive: true,
            isOwned: true,
            purchaseDate: '2020-01-01',
            price: 500_000,
            downPayment: 100_000,
            mortgageRate: 4.0,
            amortization: 25,
            totalClosingCosts: 0,
            monthlyPayment: 2100,
            unrecoverableMonthly: 300,
            isPrimaryResidence: true,
            propertyGrowthRate: 5,
        };
        const secondary: RealEstateGoal = { ...basePrimary, id: 'sec-1', name: 'Chalet', isPrimaryResidence: false };

        const pPrimary = makeScenarioParams({ years: 10, realEstateGoals: [basePrimary] });
        pPrimary.liveCSVBalances.REER = 0;
        pPrimary.liveCSVBalances.NON_ENREG = 0;
        pPrimary.liveCSVBalances.CELI = 100_000;

        const pSecondary = makeScenarioParams({ years: 10, realEstateGoals: [secondary] });
        pSecondary.liveCSVBalances.REER = 0;
        pSecondary.liveCSVBalances.NON_ENREG = 0;
        pSecondary.liveCSVBalances.CELI = 100_000;

        const resPrimary = runScenario(pPrimary, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        const resSecondary = runScenario(pSecondary, 'AUTO_MARGINAL', false, false, 0, 'BASE', {});
        expect(resPrimary.estateTaxableBreakdown?.capitalGainsTaxable).toBe(0);
        expect(resSecondary.estateTaxableBreakdown?.capitalGainsTaxable).toBeGreaterThan(100_000);

        const nanEstate = computeEstateNetWorth(
            makeEstateInputs({
                nonReg: Number.NaN,
                nonRegACB: Number.NaN,
                realEstateLatentGain: Number.NaN,
                rentalRecaptureTaxable: Number.NaN,
                liquidDebt: Number.NaN,
            }),
            calculateFiscalReport,
        );
        expect(Number.isFinite(nanEstate.estateNetWorth)).toBe(true);
        expect(Number.isFinite(nanEstate.totalEstateTax)).toBe(true);
        expect(Number.isFinite(nanEstate.taxableBreakdown.capitalGainsTaxable)).toBe(true);
    });
});
