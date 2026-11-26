// services/projection.ts — moteur de projection financière (migré depuis utils/useFutureSimulation.ts)
import { formatCAD } from '../utils/format';
import { calculateFiscalReport, getMarginalRate, calculateDividendTax, getDividendGrossUpRate, calculateGrossWithholdingRRSP, getResidencyStartYear, CAPITAL_GAINS_INCLUSION_STANDARD, FHSA_ANNUAL_LIMIT_PER_USER, FHSA_LIFETIME_LIMIT_PER_USER, PSV_ELIGIBILITY_AGE, PSV_RESIDENCY_START_AGE, PENSION_SPLIT_MIN_AGE, RRQ_STANDARD_START_AGE } from '../utils/tax';
import { RRIF_RATES, round2, welcomeTax } from './projection/helpers';
import { salaryShares, splitByShares, stepReerByUser, addByWeights } from './projection/perUserBalances';
import { logError, logErrorThrottled } from './errorLogger';
import { runMonteCarlo, effectiveMcIterations, effectiveDeepMcIterations, type MonteCarloResult } from './projection/monteCarlo';
import type { EngineOverrides, StrategyConfig } from './projection/strategyConfig';
import { returnRatesForProfile } from './projection/strategyConfig';
import {
    runStrategySearch,
    runTournamentStrategySearch,
    evaluateShapleyForWinner,
    type StrategySearchResult,
    type RunStrategySearchOptions,
    type TournamentSearchOptions,
    type ShapleyAttributionItem,
} from './projection/strategySearch';
import { ASSET_LOCATION_BONUS_PP } from './projection/strategySpace';
import { SCENARIO_DEFINITIONS, strategyDefFor } from './projection/scenarios';
import { applyW5Effects, applyAgeBasedExpenses } from './projection/w5Effects';
import { repartirRevenuGagne, montantsParProprietaireVides } from './projection/revenuGagnePartage';
import { tryCriticalIllness, tryInheritance, tryMortality, trySpouseMortality, tryLtcTrigger, ltcMonthlyCost, tryDivorce, clampSplitPct, DIVORCE_SPLIT_PCT_DEFAULT } from './projection/stochasticEvents';
import { processAprilSettlement } from './projection/taxApril';
import { computeOasClawback, computeAnnualNonRegDividends, processTaxLossHarvesting, processGainHarvesting, processDecemberTaxFiling } from './projection/taxDecember';
import { processJanuaryReset } from './projection/taxJanuary';
import { phaseDette, estLePremierMoisApresLeTerme } from './projection/debtSchedule';
import { initRentalStates, processRentalMonth, rentalInterestParImmeuble, computeCcaRecapture, type RentalState } from './projection/rentalMonth';
import { processAutoVehicleReplacement } from './projection/vehicleCycle';
import { buildHistoricalSequence, buildReplaySequence, type YearReturn } from './projection/historicalReturns';
import { computeRetirementIncome, computeDbPensionMonthly, RRQ_DEFERRED_START_AGE } from './projection/retirementIncome';
import { processOneChild } from './projection/childrenReee';
// [FUTUR-FIRE-STRUCT] Libellé du jalon FIRE partagé avec ses consommateurs (le texte n'est plus
// dupliqué en dur : un lecteur qui doit matcher le libellé compare à la MÊME constante).
import { FIRE_LIFE_EVENT } from './projection/fireMilestone';
import { computeActiveIncome, prestationAeNetteMensuelle } from './projection/activeIncome';
import { processReerMeltdown } from './projection/meltdownReer';
import { initPastPurchase } from './projection/pastPurchaseInit';
import { SCHL_AMORT_MAX_INSURED_STANDARD } from './realEstate';
import { applyTravelExpenses, applyLifeEvents, computeStressTest, applyFinancialGoalDeadlines, computeIncomeLossFactor, computePerteEmploiLossPct } from './projection/monthlyEvents';
import { computeLatentTax } from './projection/latentTax';
import { computeGlidepathRates } from './projection/glidepathRates';
import type { RealEstateGoal, Debt, PrivateBusiness, RentalProperty, ChildGoal } from '../types';
import { processCashflowAllocation, type CashflowState } from './projection/cashflowAllocation';
import { processRealEstate, type RealEstateState, type PropertyStateMutable } from './projection/realEstateMonth';
import { buildMonthlyDataPoint, estPointAllege } from './projection/monthlyOutput';
import { FIRE_TARGET_MULTIPLE } from './projection/modelAssumptions';
import { computeRawNetWorth } from './projection/netWorth';
import { computePrivateBusinessValue } from './projection/privateBusinessValue';
import { applyMonthlyGrowth } from './projection/growthApplication';
import { buildSeededRng, computeHistoricalContributionRoom, computeRrqAdjustment, computeIncomeBaseline, computeScenarioOverrides, makeSmileLifestyleFactor } from './projection/setupSimulation';
import { handleNonRegSale as portfolioNonRegSale, handleCryptoSale as portfolioCryptoSale, applyCapitalDisposition } from './projection/portfolioOps';
import { computeEstateNetWorth } from './projection/estateCalculation';
import { computeMonthlyMarketRates, type StressTestConfig } from './projection/marketShocks';
import { createMacroRegimeState, type MacroRegimeRunConfig } from './projection/macroRegimes';
import {
    runGrandCalculShardWithRunner,
    mergeGrandCalculShards,
    clampGrandCalculIterations,
    computeRetirementRealReturnFactor,
    computeSustainableMonthlyNetReal,
    GRAND_CALCUL_ITERATIONS_MIN,
    GRAND_CALCUL_ITERATIONS_MAX,
    GRAND_CALCUL_ITERATIONS_DEFAULT,
    type MergeGrandCalculMeta,
} from './projection/grandCalcul';
import { computeEffectiveExpenseInflation } from './projection/monthlyCalcs';
import { computeProjectedExpenses, createDefaultBehavioralProfile, type BehavioralProfile } from './projection/behavioralProfile';
import {
    type AllocationStrategy,
    type FutureScenarioType,
    type ProjectionChartPoint,
    type ProjectionResult,
    type SimulationParams,
    type GrandCalculConfig,
    type GrandCalculShardResult,
} from './projection/types';
export type {
    AllocationStrategy,
    FutureScenarioType,
    ProjectionChartPoint,
    ProjectionResult,
    LiveCSVBalances,
    SimulationParams,
    MacroRegimeId,
    GrandCalculConfig,
    FiAgeDistribution,
    GoalProbabilityResult,
    GuaranteedPurchasingPower,
    EstateTaxSummary,
    CompactMonthlyQuantileShard,
    GrandCalculMonthlyBand,
    GrandCalculShardResult,
    GrandCalculResult,
} from './projection/types';
export type { StrategySearchResult, ConfigResult, ShapleyAttributionItem, TournamentSearchOptions } from './projection/strategySearch';
export type { StrategyConfig } from './projection/strategyConfig';
export {
    rankConfigResults,
    explainWinner,
    OBJECTIVE_LABELS,
    type RankedConfig,
    type OptimizeObjective,
} from './projection/strategyConfigRanking';

// Cycle 7 split: calculateGrossNeeded retiré (dead code, jamais appelé)

// Cœur du moteur de projection. Simule un scénario complet, mois par mois, sur
// l'horizon choisi. Chaque mois enchaîne dans l'ordre : croissance des
// placements (rendements ± aléa Monte Carlo), revenus (salaires/rentes),
// dépenses de vie + service des dettes, impôts, immobilier (hypothèque, valeur),
// puis agrégation de la valeur nette du mois. En mode Monte Carlo, runScenario
// est rappelée N fois avec un RNG seedé déterministe (reproductible).
// Retourne la série temporelle (chartData) + les agrégats de fin (estate, FIRE).
/**
 * [ENG-MC-OBSERVABILITY] Options de DIAGNOSTIC — délibérément séparées d'`EngineOverrides`, qui
 * porte des LEVIERS de stratégie explorés par la recherche (`strategySpace`). Un drapeau de
 * diagnostic glissé là-dedans serait balayé comme s'il changeait le plan financier.
 */
type EnginePropertyState = PropertyStateMutable & { cost: number; isPrimaryResidence: boolean };

interface PreparedScenarioSetup {
    effProj: SimulationParams['projection'];
    effectiveBehavioralProfile: BehavioralProfile;
    startLiquid: number;
    startCeli: number;
    startCeliapp: number;
    startReer: number;
    startNonReg: number;
    startCrypto: number;
    startReee: number;
    activeRE: RealEstateGoal[];
    activeChild: ChildGoal[];
    activeRentals: RentalProperty[];
    baseRentalStates: RentalState[];
    baseRentalTaxBases: Array<{ purchaseCost: number; priorCcaTaken: number }>;
    privateBusinessValue: number;
    baseBusinessStates: PrivateBusiness[];
    rentalNames: string[];
    basePropertiesState: EnginePropertyState[];
    bootRealEstateEquity: number;
    bootMortgageBalance: number;
    bootPrimaryHousingOffset: number;
    baseActiveDebts: Debt[];
    totalHistoricalCeliRoom: number;
    totalHistoricalRrspRoom: number;
    activeUsersCount: number;
    smileLifestyleFactor: (age: number) => number;
    fhsaEligibleUsersCount: number;
    fhsaRoomInitial: number;
    celiappOpeningYear: number;
    fhsaLifetimeContrib: number;
    hasPurchasedPrimaryInitial: boolean;
    hasFuturePurchase: boolean;
    psvResidencyYearsBase: [number, number];
    simInflation: number;
    baseRates: { celi: number; reer: number; nonReg: number; crypto: number; cash: number };
    incomeMarcNetMonthly: number;
    incomeAnnaNetMonthly: number;
    grossMarcBaseAnnual: number;
    grossAnnaBaseAnnual: number;
    reerSharesInitial: number[];
    reerByUserInitial: number[];
    simSalaryGrowth: number;
    simEFMonths: number;
    stressTestConfig: StressTestConfig | null;
    totalMonths: number;
    loopDates: Date[];
    loopYears: Int32Array;
    loopMonths: Int32Array;
    loopIsoMonths: string[];
    hasW5Collections: boolean;
    hasAgeBasedExpenses: boolean;
    hasTravelGoals: boolean;
    hasLifeEvents: boolean;
    hasFinancialGoals: boolean;
    goalMonthMask: Uint8Array;
    travelMonthMask: Uint8Array;
    lifeEventMonthMask: Uint8Array;
    getMonthOffset: (dateStr: string | undefined | null) => number;
}

const EMPTY_CHART_DATA: ProjectionChartPoint[] = [];
const EMPTY_STRING_LOGS: string[] = [];
const EMPTY_EVENT_DAYS: Record<string, number> = {};

function prepareScenarioSetup(params: SimulationParams, scenarioType: FutureScenarioType): PreparedScenarioSetup {
    const {
        projection, calculatedStartingCash, liveCSVBalances, realEstateGoals, debts,
        childGoals, travelGoals, lifeEvents, config, baseGrossAnnual, baseMonthlyExpenses,
        startYear, startMonth = 0, insurancePolicies = [], vehicleReplacements = [],
        majorRenovations = [], charitableGoals = [], rentalProperties = [],
        privateBusinesses = [], financialGoals = [], behavioralProfile,
    } = params;

    const getMonthOffset = (dateStr: string | undefined | null): number => {
        if (!dateStr || typeof dateStr !== 'string' || dateStr.length < 7) return 0;
        const year = parseInt(dateStr.slice(0, 4), 10);
        const month = parseInt(dateStr.slice(5, 7), 10) - 1;
        if (isNaN(year) || isNaN(month)) {
            logErrorThrottled(`monthOffset-invalide:${dateStr}`, {
                source: 'projection', severity: 'warning',
                message: 'Date illisible dans la simulation — offset 0 appliqué',
                context: { date: dateStr.slice(0, 10) },
            });
            return 0;
        }
        return (year - startYear) * 12 + (month - startMonth);
    };

    const effProj = scenarioType === 'COMPOUND_STRESS'
        ? { ...projection, ltcEnabled: true }
        : projection;

    const effectiveBehavioralProfile: BehavioralProfile = behavioralProfile
        ? { ...behavioralProfile }
        : createDefaultBehavioralProfile(baseMonthlyExpenses);
    const effProjExtended = effProj as unknown as {
        expenseProjectionMode?: 'budget' | 'real' | 'hybrid';
        hybridConvergenceStartMonths?: number;
        hybridConvergenceEndMonths?: number;
        customLifestyleCreep?: number;
    };
    if (effProjExtended.expenseProjectionMode) {
        effectiveBehavioralProfile.expenseMode = effProjExtended.expenseProjectionMode;
    }
    if (effProjExtended.hybridConvergenceStartMonths) {
        effectiveBehavioralProfile.convergenceStartMonth = effProjExtended.hybridConvergenceStartMonths;
    }
    if (effProjExtended.hybridConvergenceEndMonths) {
        effectiveBehavioralProfile.convergenceEndMonth = effProjExtended.hybridConvergenceEndMonths;
    }
    if (effProjExtended.customLifestyleCreep !== undefined) {
        effectiveBehavioralProfile.lifestyleCreepAnnual = effProjExtended.customLifestyleCreep;
    }

    const startLiquid = Number(effProj.useManualBalances ? (effProj.manualCash ?? calculatedStartingCash) : calculatedStartingCash) || 0;
    const startCeli = Number(effProj.useManualBalances ? (effProj.manualCELI ?? liveCSVBalances.CELI) : liveCSVBalances.CELI) || 0;
    const startCeliapp = Number(liveCSVBalances.CELIAPP) || 0;
    const startReer = Number(effProj.useManualBalances ? (effProj.manualREER ?? liveCSVBalances.REER) : liveCSVBalances.REER) || 0;
    const startNonReg = Number(effProj.useManualBalances ? (effProj.manualNonReg ?? liveCSVBalances.NON_ENREG) : liveCSVBalances.NON_ENREG) || 0;
    const startCrypto = Number(effProj.useManualBalances ? (effProj.manualCrypto ?? liveCSVBalances.CRYPTO) : liveCSVBalances.CRYPTO) || 0;
    const startReee = Number(liveCSVBalances.REEE) || 0;

    const activeRE = (realEstateGoals || []).filter(g => !!g).map(g => {
        const price = Number.isFinite(g.price) ? g.price : 0;
        const downPayment = Number.isFinite(g.downPayment) ? g.downPayment : 0;
        const mortgageRate = Number.isFinite(g.mortgageRate) ? g.mortgageRate : 0;
        const amortization = Number.isFinite(g.amortization) && (g.amortization as number) > 0
            ? g.amortization : SCHL_AMORT_MAX_INSURED_STANDARD;
        const hadCorruption = [g.price, g.downPayment, g.mortgageRate, g.amortization]
            .some(v => v != null && !Number.isFinite(Number(v)));
        if (hadCorruption) {
            logError({
                source: 'projection', severity: 'warning',
                message: 'RealEstateGoal à champ non numérique normalisé (projection)',
                context: { id: g.id, name: g.name },
            });
        }
        return { ...g, price, downPayment, mortgageRate, amortization };
    });
    const activeChild = (childGoals || []).filter(g => !!g);

    const activeRentals = (rentalProperties ?? []).filter(Boolean);
    const baseRentalStates = initRentalStates(activeRentals);
    const baseRentalTaxBases = activeRentals.map(rp => {
        const val = Math.max(0, Number.isFinite(Number(rp?.currentValue)) ? Number(rp.currentValue) : 0);
        const pp = Number.isFinite(Number(rp?.purchasePrice)) ? Number(rp.purchasePrice) : 0;
        const cca = Number.isFinite(Number(rp?.ccaTaken)) ? Number(rp.ccaTaken) : 0;
        return {
            purchaseCost: pp > 0 ? pp : val,
            priorCcaTaken: Math.max(0, cca),
        };
    });
    const privateBusinessValue = computePrivateBusinessValue(privateBusinesses);
    const baseBusinessStates = privateBusinesses.map(b => ({ ...b }));
    const rentalNames = activeRentals.map(rp => rp?.name || 'immeuble locatif');

    const basePropertiesState: EnginePropertyState[] = activeRE.map(g => {
        const purchaseOffset = getMonthOffset(g.purchaseDate);
        const past = g.isActive && purchaseOffset < 0 && g.isOwned !== false ? initPastPurchase(g, -purchaseOffset) : null;
        return {
            id: g.id || 'anon',
            isBought: !!past,
            mortgage: past ? past.mortgage : (g.price || 0) - (g.downPayment || 0),
            currentValue: past ? past.currentValue : (g.price || 0),
            calculatedPmt: past ? past.calculatedPmt : 0,
            isPaidOff: past ? past.isPaidOff : false,
            isSold: false,
            cost: g.price || 0,
            isPrimaryResidence: g.isPrimaryResidence ?? false,
        };
    });
    let bootRealEstateEquity = 0;
    let bootMortgageBalance = 0;
    for (const p of basePropertiesState) {
        if (p.isBought) {
            bootRealEstateEquity += p.currentValue - p.mortgage;
            bootMortgageBalance += p.mortgage;
        }
    }
    const bootPrimaryHousingOffset = basePropertiesState.reduce((s, p, i) =>
        s + (p.isBought && p.isPrimaryResidence
            ? p.calculatedPmt + (activeRE[i]?.unrecoverableMonthly || 0)
            : 0), 0);

    const baseActiveDebts = (debts || []).filter(d => !!d).map(d => {
        const balance = Number.isFinite(d.balance) ? d.balance : 0;
        const interestRate = Number.isFinite(d.interestRate) ? d.interestRate : 0;
        const minimumPayment = Number.isFinite(d.minimumPayment) ? d.minimumPayment : 0;
        if (balance !== d.balance || interestRate !== d.interestRate || minimumPayment !== d.minimumPayment) {
            logError({
                source: 'projection', severity: 'warning',
                message: 'Dette à champ non numérique normalisée à 0 (projection)',
                context: { id: d.id, name: d.name },
            });
        }
        return { ...d, balance, interestRate, minimumPayment };
    });

    const { totalHistoricalCeliRoom, totalHistoricalRrspRoom, activeUsersCount } =
        computeHistoricalContributionRoom(config.users, baseGrossAnnual, startYear);
    const smileLifestyleFactor = makeSmileLifestyleFactor(effProj.useSmileCurve);

    let fhsaEligibleUsersCount = config.users.filter(u => u && !u.hasOwnedPropertyLast4Years).length;
    if (startCeliapp > 0 && fhsaEligibleUsersCount === 0) fhsaEligibleUsersCount = 1;
    const celiappOpeningYear = startCeliapp > 0 ? (startYear - 1) : startYear;
    const fhsaRoomInitial = startYear === celiappOpeningYear
        ? FHSA_ANNUAL_LIMIT_PER_USER * fhsaEligibleUsersCount
        : 0;
    const fhsaLifetimeContrib = Math.min(startCeliapp, FHSA_LIFETIME_LIMIT_PER_USER * fhsaEligibleUsersCount);

    const hasPurchasedPrimaryInitial = basePropertiesState.some(p => p.isBought && p.isPrimaryResidence);
    const hasFuturePurchase = realEstateGoals.some(g => g.isActive && g.isPrimaryResidence);

    const psvResidencyYearsBase: [number, number] = [0, 0];
    config.users.filter(u => u).forEach((u, idx) => {
        const birthYear = u.birthYear || (startYear - (u.age || 30));
        const residencyStart = getResidencyStartYear(birthYear, u.isImmigrant, u.canadaArrivalYear);
        psvResidencyYearsBase[idx] = Math.max(0, startYear - Math.max(residencyStart, birthYear + PSV_RESIDENCY_START_AGE));
    });

    const { simInflation, baseRates } = computeScenarioOverrides(
        projection as unknown as { inflationRate?: number; returnRates?: { celi: number; reer: number; nonReg: number; crypto: number; cash: number } } & Record<string, unknown>,
        scenarioType,
    );

    const { incomeMarcNetMonthly, incomeAnnaNetMonthly, grossMarcBaseAnnual, grossAnnaBaseAnnual } =
        computeIncomeBaseline(config.users, startYear);

    const reerSharesInitial = salaryShares(
        activeUsersCount > 1 ? [grossMarcBaseAnnual, grossAnnaBaseAnnual] : [grossMarcBaseAnnual + grossAnnaBaseAnnual],
    );
    const reerByUserInitial = splitByShares(startReer, reerSharesInitial);
    const simSalaryGrowth = effProj.salaryGrowth ?? 2.5;
    const simEFMonths = effProj.emergencyFundMonths || 3;

    const stressTestConfig: StressTestConfig | null = effProj.stressTestEnabled ? {
        enabled: true,
        year: effProj.stressTestYear || 5,
        recoveryMonths: effProj.stressTestRecoveryMonths || 24,
        inflationShock: effProj.stressTestInflationShock || 0,
    } : null;

    const totalMonths = projection.years * 12 + 1;
    const loopDates: Date[] = new Array(totalMonths);
    const loopYears = new Int32Array(totalMonths);
    const loopMonths = new Int32Array(totalMonths);
    const loopIsoMonths: string[] = new Array(totalMonths);
    for (let i = 0; i < totalMonths; i++) {
        const dt = new Date(startYear, startMonth + i, 1);
        loopDates[i] = dt;
        const y = dt.getFullYear();
        const mo = dt.getMonth();
        loopYears[i] = y;
        loopMonths[i] = mo;
        loopIsoMonths[i] = `${y}-${String(mo + 1).padStart(2, '0')}`;
    }

    const goalMonthMask = new Uint8Array(totalMonths);
    if (financialGoals.length > 0) {
        for (let i = 0; i < totalMonths; i++) {
            const iso = loopIsoMonths[i];
            for (let gi = 0; gi < financialGoals.length; gi++) {
                const g = financialGoals[gi];
                if (!g || g.status === 'archived' || g.completed) continue;
                const d = typeof g.deadline === 'string' ? g.deadline.trim() : '';
                if (d && d.startsWith(iso)) {
                    goalMonthMask[i] = 1;
                    break;
                }
            }
        }
    }

    const travelMonthMask = new Uint8Array(totalMonths);
    if (travelGoals.length > 0) {
        for (let i = 0; i < totalMonths; i++) {
            const iso = loopIsoMonths[i];
            for (let ti = 0; ti < travelGoals.length; ti++) {
                const t = travelGoals[ti];
                if (t?.date && typeof t.date === 'string' && t.date.startsWith(iso)) {
                    travelMonthMask[i] = 1;
                    break;
                }
            }
        }
    }

    const lifeEventMonthMask = new Uint8Array(totalMonths);
    if (lifeEvents.length > 0) {
        for (let i = 0; i < totalMonths; i++) {
            const iso = loopIsoMonths[i];
            for (let li = 0; li < lifeEvents.length; li++) {
                const e = lifeEvents[li];
                if (e?.date && typeof e.date === 'string' && e.date.startsWith(iso)) {
                    lifeEventMonthMask[i] = 1;
                    break;
                }
            }
        }
    }

    const hasW5Collections = insurancePolicies.length > 0
        || vehicleReplacements.length > 0
        || majorRenovations.length > 0
        || charitableGoals.length > 0
        || activeRentals.length > 0
        || privateBusinesses.length > 0;

    const hasAgeBasedExpenses = Boolean(
        (effProj.boomerangSupportMonthly || 0) > 0
        || (effProj.caregivingMonthly || 0) > 0
        || effProj.snowbirdEnabled,
    );

    return {
        effProj,
        effectiveBehavioralProfile,
        startLiquid,
        startCeli,
        startCeliapp,
        startReer,
        startNonReg,
        startCrypto,
        startReee,
        activeRE,
        activeChild,
        activeRentals,
        baseRentalStates,
        baseRentalTaxBases,
        privateBusinessValue,
        baseBusinessStates,
        rentalNames,
        basePropertiesState,
        bootRealEstateEquity,
        bootMortgageBalance,
        bootPrimaryHousingOffset,
        baseActiveDebts,
        totalHistoricalCeliRoom,
        totalHistoricalRrspRoom,
        activeUsersCount,
        smileLifestyleFactor,
        fhsaEligibleUsersCount,
        fhsaRoomInitial,
        celiappOpeningYear,
        fhsaLifetimeContrib,
        hasPurchasedPrimaryInitial,
        hasFuturePurchase,
        psvResidencyYearsBase,
        simInflation,
        baseRates,
        incomeMarcNetMonthly,
        incomeAnnaNetMonthly,
        grossMarcBaseAnnual,
        grossAnnaBaseAnnual,
        reerSharesInitial,
        reerByUserInitial,
        simSalaryGrowth,
        simEFMonths,
        stressTestConfig,
        totalMonths,
        loopDates,
        loopYears,
        loopMonths,
        loopIsoMonths,
        hasW5Collections,
        hasAgeBasedExpenses,
        hasTravelGoals: travelGoals.length > 0,
        hasLifeEvents: lifeEvents.length > 0,
        hasFinancialGoals: financialGoals.length > 0,
        goalMonthMask,
        travelMonthMask,
        lifeEventMonthMask,
        getMonthOffset,
    };
}

interface ScenarioDiagnostics {
    /**
     * Émettre le point mensuel COMPLET même sous Monte-Carlo. **Tests uniquement.**
     * Sous MC, `buildMonthlyDataPoint` ne rend normalement que `{ NetWorth, monthIndex }` (perf).
     * Or le divorce, la mortalité du conjoint, le LTC et la perte d'emploi n'existent QUE sous MC :
     * leurs flux mensuels étaient donc INVÉRIFIABLES. Trois lots ont dû se rabattre sur des
     * agrégats ou des tests de fonction pure faute de pouvoir les observer.
     */
    verboseMonthlyPoints?: boolean;
    /** Configuration optionnelle des régimes macroéconomiques et crises historiques (Grand Calcul R1). */
    macroRegimes?: MacroRegimeRunConfig;
    /** Setup précalculé (hissé hors de la boucle MC dans runGrandCalculShard / runMonteCarlo). */
    preparedSetup?: PreparedScenarioSetup;
    /** Tampon préalloué pour NetWorth mensuel en mode pointAllege (zéro allocation d'objet par mois). */
    netWorthBuffer?: Float64Array;
}

const runScenario = (params: SimulationParams, strategy: AllocationStrategy, enableMonteCarlo = false, delayPensions = false, mcIterationIndex = 0, scenarioType: FutureScenarioType = 'BASE', overrides: EngineOverrides = {}, diagnostics: ScenarioDiagnostics = {}) => {
    const { projection, calculatedStartingCash, liveCSVBalances, travelGoals, lifeEvents, retirementGoal, config, baseGrossAnnual, baseNetAnnual, currentRentExpense, startYear, startMonth = 0, insurancePolicies = [], vehicleReplacements = [], majorRenovations = [], charitableGoals = [], financialGoals = [] } = params;
    const setup = diagnostics.preparedSetup ?? prepareScenarioSetup(params, scenarioType);
    const pointAllege = estPointAllege(enableMonteCarlo, diagnostics.verboseMonthlyPoints);
    const netWorthBuf = pointAllege ? diagnostics.netWorthBuffer : undefined;
    let netWorthBufLen = 0;

    // Cycle 22 split: RNG seedé déterministique → ./projection/setupSimulation
    const rng = buildSeededRng(scenarioType, strategy, mcIterationIndex);
    const macroState = diagnostics.macroRegimes
        ? createMacroRegimeState(diagnostics.macroRegimes, scenarioType, strategy, mcIterationIndex)
        : null;

    const getMonthOffset = setup.getMonthOffset;
    const effProj = setup.effProj;
    const effectiveBehavioralProfile = setup.effectiveBehavioralProfile;

    const data: ProjectionChartPoint[] = [];

    let liquid = setup.startLiquid;
    let celi = setup.startCeli;
    let celiapp = setup.startCeliapp;
    let reer = setup.startReer;
    let nonReg = setup.startNonReg;
    let crypto = setup.startCrypto;
    let reee = setup.startReee;

    const activeRE = setup.activeRE;
    const activeChild = setup.activeChild;
    const activeRentals = setup.activeRentals;
    const rentalStates = setup.baseRentalStates.length > 0
        ? setup.baseRentalStates.map(rs => ({ ...rs }))
        : [];
    const rentalTaxBases = setup.baseRentalTaxBases.length > 0
        ? setup.baseRentalTaxBases.map(tb => ({ ...tb }))
        : [];
    let privateBusinessValue = setup.privateBusinessValue;
    let businessStates = setup.baseBusinessStates.length > 0
        ? setup.baseBusinessStates.map(b => ({ ...b }))
        : [];
    const rentalNames = setup.rentalNames;

    let propertiesState = setup.basePropertiesState.length > 0
        ? setup.basePropertiesState.map(p => ({ ...p }))
        : [];
    let realEstateEquity = setup.bootRealEstateEquity;
    let mortgageBalance = setup.bootMortgageBalance;
    const bootPrimaryHousingOffset = setup.bootPrimaryHousingOffset;

    let activeDebts = setup.baseActiveDebts.length > 0
        ? setup.baseActiveDebts.map(d => ({ ...d }))
        : [];
    let hasHitFire = false;

    const user1 = config.users[0];
    const currentAge = user1?.age || 30;
    const { totalHistoricalCeliRoom, totalHistoricalRrspRoom, activeUsersCount } = setup;
    const smileLifestyleFactor = setup.smileLifestyleFactor;

    let useManualBalances = effProj.useManualBalances ?? false;
    let manualCELIRoom = effProj.manualCELIRoom ?? 0;
    let manualRRSPRoom = effProj.manualREERRoom ?? 0;

    let celiRoom = useManualBalances ? manualCELIRoom : Math.max(0, totalHistoricalCeliRoom - celi);
    let rrspRoom = useManualBalances ? manualRRSPRoom : Math.max(0, totalHistoricalRrspRoom - reer);

    let fhsaEligibleUsersCount = setup.fhsaEligibleUsersCount;
    let fhsaRoom = setup.fhsaRoomInitial;
    const celiappOpeningYear = setup.celiappOpeningYear;
    let fhsaClosingYear: number | null = -1;
    let fhsaLifetimeContrib = setup.fhsaLifetimeContrib;
    let accFhsaYear = 0;

    let hasPurchasedPrimary = setup.hasPurchasedPrimaryInitial;
    const hasFuturePurchase = setup.hasFuturePurchase;
    let hasLoggedRetirement = false;

    const psvResidencyYears: [number, number] = [setup.psvResidencyYearsBase[0], setup.psvResidencyYearsBase[1]];
    const { simInflation, baseRates } = setup;
    const activeValoriaSchedule = (scenarioType !== 'ECONOMIC_WINTER' && scenarioType !== 'COMPOUND_STRESS')
        ? params.valoriaSchedule
        : undefined;

    let overrideRetirementAge = retirementGoal.targetAge || 65;
    if (scenarioType === 'LIBERTE_55') overrideRetirementAge = 55;
    const effectiveRetirementAge = overrideRetirementAge;
    const retirementMonthIndex = (effectiveRetirementAge - currentAge) * 12;

    const savingsMult = projection.appliedSavingsMultiplier ?? 1;
    const realMonthlySavings = baseNetAnnual / 12 - params.baseMonthlyExpenses;
    const adjustedRealExpenses = (savingsMult !== 1 && realMonthlySavings > 0)
        ? Math.max(0, baseNetAnnual / 12 - realMonthlySavings * savingsMult)
        : params.baseMonthlyExpenses;
    const effectiveBaseExpenses = adjustedRealExpenses;
    const fireTargetAnnual = effectiveBaseExpenses * 12;
    const fireTargetNetWorth = fireTargetAnnual * FIRE_TARGET_MULTIPLE;

    let month1ActionPlan: { monthlyCashflow: number; strategy: AllocationStrategy } | null = null;
    let accGrossIncomeYearByUser: [number, number] = [0, 0];
    let grossIncomeEnAttenteByUser: [number, number] = [0, 0];
    let accRrspYear = 0;

    let taxCurrentYear = { revenu: 0, gains: 0, reer: 0, divers: 0, donCredit: 0 };
    let taxPreviousYear = { revenu: 0, gains: 0, reer: 0, divers: 0, donCredit: 0 };
    let reconciledUnsettledTax = 0;

    let accRetraitsReerYear = 0;
    let accRentesYear = 0;
    let rapBorrowed = 0;
    let rapRepaymentDueTotal = 0;
    let rapRepaymentStartOffset = 0;
    let hasUsedRap = false;
    let celiWithdrawalsThisYear = 0;

    let oasClawbackNextPeriod = 0;
    let monthlyOasReduction = 0;
    let monthsSinceLastVehicle = 0;
    let smithManoeuvreDebt = 0;
    let smithInterestDeductibleYear = 0;
    let capitalLossBank = 0;
    let accCapitalGainsYear = 0;
    let prevPortfolioNW = 0;
    let guytonKlinger_indexationFactor = 1;
    let expenseMultiplier = 1;

    let totalTaxesPaid = 0;
    let totalGrowth = 0;
    let totalExpenses = 0;
    let shortfallMonths = 0;
    let liquidDebt = 0;
    let goalShortfallCount = 0;
    let goalShortfallTotal = 0;

    let reeeTracker: Record<string, {
        scee: number;
        iqee: number;
        contribLifetime: number;
        pseBalance: number;
        paeBalance: number;
        remainingScee: number;
        remainingIqee: number;
    }> = {};

    const { incomeMarcNetMonthly, incomeAnnaNetMonthly, grossMarcBaseAnnual, grossAnnaBaseAnnual } = setup;

    let reerShares = setup.reerSharesInitial.slice();
    let reerByUser = setup.reerByUserInitial.slice();
    let accRetraitsReerYearByUser: number[] = reerShares.map(() => 0);
    let ferrAnnualByUser: number[] = reerShares.map(() => 0);

    const simSalaryGrowth = setup.simSalaryGrowth;
    const simEFMonths = setup.simEFMonths;
    const stressTestConfig = setup.stressTestConfig;
    const { psvBasePension } = computeRrqAdjustment(delayPensions, retirementGoal);

    // D2.2: RRIF_RATES et welcomeTax → ./projection/helpers

    // Patrimoine net via la SOURCE UNIQUE (computeRawNetWorth) → rawNetWorth, prevNW et la
    // succession utilisent la MÊME formule. Closure : lit les valeurs courantes des variables de
    // boucle à chaque appel. [audit money-critical 2026-06-16]
    // [DETTE-DATES] Mois courant de la boucle, publié ici pour que `sumActiveDebts` (closure définie
    // AVANT la boucle) puisse écarter les dettes PAS ENCORE COMMENCÉES. Sans ça, un prêt signé dans
    // six mois pèserait sur le bilan dès aujourd'hui — une dette qu'on n'a pas encore est une
    // donnée inventée, exactement ce que le no-fake-data interdit.
    let moisCourantPourDettes = 0;
    const sumActiveDebts = (): number => activeDebts.reduce(
        (s, d) => (phaseDette(d, startYear, startMonth, moisCourantPourDettes) === 'a-venir'
            ? s
            : s + (Number.isFinite(d.balance) ? d.balance : 0)),
        0,
    );
    const currentRawNetWorth = (): number => computeRawNetWorth({
        liquid, celi, celiapp, reer, nonReg, crypto, reee, realEstateEquity,
        privateBusinessValue,
        liquidDebt, smithManoeuvreDebt, activeDebtsTotal: sumActiveDebts(),
    });

    let prevCELI = celi, prevREER = reer, prevLiquid = liquid;
    // prevNW DOIT suivre la MÊME formule que rawNetWorth (celiapp + realEstateEquity − toutes les
    // dettes), sinon diffNW = rawNetWorth − prevNW est faussé en permanence. [finding prevNW]
    let prevNW = currentRawNetWorth();
    // minNetWorth (suivi du plus bas patrimoine sur la projection) part du VRAI patrimoine de départ,
    // dettes initiales incluses (même source unique que prevNW). Sinon, pour un persona endetté, le min
    // démarrait surévalué de Σ(dettes) → safetyScore/goalSeek surestimaient la sécurité. [fix review 2026-06-16]
    let minNetWorth = currentRawNetWorth();

    // D2.8: État LTC (Long-Term Care). Une fois déclenché, le coût mensuel
    // s'ajoute aux dépenses jusqu'à la fin de la simulation.
    let ltcActive = false;

    // F15 — Initialisation du PBR réel (ACB) au mois zéro depuis les achats historiques.
    // Repli sans données simulées sur le solde de départ si non renseigné.
    let nonRegACB = (params.initialNonRegACB !== undefined && Number.isFinite(params.initialNonRegACB))
        ? Math.max(0, params.initialNonRegACB)
        : nonReg;
    let cryptoACB = (params.initialCryptoACB !== undefined && Number.isFinite(params.initialCryptoACB))
        ? Math.max(0, params.initialCryptoACB)
        : crypto;


    // Cycle 25 split: handleNonRegSale partagé → ./projection/portfolioOps
    // Closure-wrapper: synchronise les let locaux avec le state object.
    // [PV-11c] — le paramètre `_label` (jamais consommé, suggérait un log inexistant) est retiré.
    const handleNonRegSale = (amount: number): number => {
        const ms = { nonReg, nonRegACB, capitalLossBank, accCapitalGainsYear };
        const sold = portfolioNonRegSale(ms, amount);
        nonReg = ms.nonReg;
        nonRegACB = ms.nonRegACB;
        capitalLossBank = ms.capitalLossBank;
        accCapitalGainsYear = ms.accCapitalGainsYear;
        return sold;
    };
    // [PV-7] Closure crypto symétrique : gain proportionnel + banque de pertes (cf portfolioOps).
    const handleCryptoSaleLocal = (amount: number): number => {
        const ms = { crypto, cryptoACB, capitalLossBank, accCapitalGainsYear };
        const sold = portfolioCryptoSale(ms, amount);
        crypto = ms.crypto;
        cryptoACB = ms.cryptoACB;
        capitalLossBank = ms.capitalLossBank;
        accCapitalGainsYear = ms.accCapitalGainsYear;
        return sold;
    };

    let incomeRetirement = 0; // Scoped outside for Estate NW calculation
    // A1 — revenu de retraite mensuel ATTRIBUABLE par conjoint (RRQ/PSV/DB), pour
    // l'impôt par conjoint en décembre. Total == incomeRetirement.
    let incomeRetirementPerUser: number[] = [];
    // Phase 3 (fractionnement 65+) : composante DB (rente viagère) mensuelle PAR CONJOINT — partie
    // ADMISSIBLE au fractionnement à tout âge (vs RRQ/PSV non fractionnables). Cf taxDecember.
    let incomeRetirementDbPerUser: number[] = [];
    // FA-3a — SRG mensuel familial (NON imposable) : exclu de l'assiette de décembre.
    let incomeRetirementGis = 0;
    // FA-3b — revenu imposable AUTRE de l'année PRÉCÉDENTE (retraits REER + loyers, nominal),
    // capturé au reset de janvier : assiette du test SRG (le vrai SRG regarde l'année passée).
    let prevYearOtherIncomeForGisNominal = 0;
    // PV-9 — gains en capital RÉALISÉS de l'année courante (BRUT, avant inclusion 50 %), capturés
    // AVANT le reset de décembre. Servent à 2 assiettes : le clawback PSV de l'année N (décembre)
    // et le test SRG de l'année N+1 (`prevYearCapitalGainsForGisNominal`, lag comme les retraits REER).
    let capitalGainsRealizedThisYear = 0;
    let prevYearCapitalGainsForGisNominal = 0;
    // Phase 3 Tier 3 — split par source (RRQ + PSV + privée) pour chartData
    let pensionRRQ = 0;
    let pensionPSV = 0;
    let pensionPrivee = 0;
    let pensionOasReduction = 0;

    // D2.8: Mortalité stochastique. En MC, à chaque début d'année on tire la
    // probabilité de décès du user principal. Le loop arrête à la mort.
    let isDead = false;

    // W1.4: Survivant. Si modelSurvivor=ON, lorsque le CONJOINT (user2) décède
    // (trySpouseMortality), on continue avec user1 SURVIVANT, avec ajustements :
    // - RRQ du défunt → 60 % versés au survivant (max RRQ standard)
    // - PSV du défunt → cesse ; revenu actif user2 → 0 (activeIncome.ts)
    // - DB → continue selon dbElectionType / dbSurvivorPct
    // - REER du défunt → roulé au survivant sans imposition immédiate
    // (FA-10 : l'ancien commentaire disait l'INVERSE — « user1 mort, user2 vivant » —
    // alors que l'implémentation zéroïse user2 ; corrigé pour éviter les contresens.)
    let spouseAlive = activeUsersCount > 1;
    let survivorMode = false;        // user2 (conjoint) mort, user1 SURVIVANT
    let survivorTriggerLogged = false; // log à la prochaine itération (logEvent défini in-loop)
    const rrqSurvivorPct = (effProj.rrqSurvivorPct ?? 60) / 100;
    const dbSurvivorPct = (effProj.spouseDbSurvivorPct ?? retirementGoal.dbSurvivorPct ?? 60) / 100;

    // W1.2: Bootstrap historique - construit une séquence par scénario MC
    // W4.5: Replay historique - mode déterministe forcé à partir d'une année
    const replayYear = effProj.replayHistoricalYear;
    const useBootstrap = !!effProj.useHistoricalBootstrap && enableMonteCarlo;
    let historicalSequence: YearReturn[] | null = null;
    if (replayYear) {
        historicalSequence = buildReplaySequence(replayYear, projection.years + 1);
    } else if (useBootstrap) {
        historicalSequence = buildHistoricalSequence(rng, projection.years + 1, effProj.bootstrapBlockSize ?? 24);
    }

    // D2.10: Perte d'emploi stochastique. unemployedMonthsRemaining > 0
    // pendant la période sans emploi (revenu réduit à 55% capé AE).
    let unemployedMonthsRemaining = 0;

    // W3.x — États événements de vie stochastiques (résident hors loop)
    let divorced = false;                       // une fois divorcé, reste divorcé
    /** [ENG-DIVORCE-REEE-COTISATIONS] Part patrimoniale cumulée — pilote les COTISATIONS REEE. */
    let reeeContribShare = 1;
    let divorceLogged = false;
    let ltdMonthsRemaining = 0;                 // invalidité longue durée
    let ltdLogged = false;
    let inheritanceReceived = false;
    let ciTriggered = false;                     // FIX agent: empêche re-déclenchement maladie grave

    const totalMonths = setup.totalMonths;
    const loopDates = setup.loopDates;
    const loopYears = setup.loopYears;
    const loopMonths = setup.loopMonths;
    const loopIsoMonths = setup.loopIsoMonths;

    let elapsedYearsAtEnd = projection.years;
    let cumulativeCpiMultiplier = 1;
    let firstFireAge: number | null = null;
    let firstFireMonthIndex: number | null = null;
    const goalOutcomes: Record<string, { met: boolean; shortfallReal: number; shortfallNominal: number }> = {};
    let retirementMonthsEvaluated = 0;
    let retFundedRealSum = 0;
    let retAnnuityFvFactor = 0;

    for (let m = 0; m < totalMonths; m++) {
        moisCourantPourDettes = m;   // [DETTE-DATES] cf. `sumActiveDebts` — closure sur ce compteur
        const currentLoopDate = loopDates[m];
        const currentMonthIndex = loopMonths[m];
        const loopYear = loopYears[m];
        const schedYear = Math.floor(m / 12);
        const pickScheduleRate = (arr: ReadonlyArray<number>, fb: number) =>
            arr.length > 0 ? (arr[Math.min(schedYear, arr.length - 1)] ?? fb) : fb;
        const yearBaseRates = activeValoriaSchedule
            ? {
                celi: pickScheduleRate(activeValoriaSchedule.celiRatesByYear, baseRates.celi),
                reer: pickScheduleRate(activeValoriaSchedule.reerRatesByYear, baseRates.reer),
                nonReg: pickScheduleRate(activeValoriaSchedule.nonRegRatesByYear, baseRates.nonReg),
                crypto: pickScheduleRate(activeValoriaSchedule.cryptoRatesByYear, baseRates.crypto),
                cash: pickScheduleRate(activeValoriaSchedule.cashRatesByYear, baseRates.cash),
            }
            : baseRates;


        const age = currentAge + Math.floor(m / 12);
        // [FISC-BANDES-FRERES-SANS-AGEOPTS] Âge PROJETÉ du conjoint, hissé ICI plutôt que recopié :
        // il servait au dépôt de décembre, il sert maintenant aussi à l'impôt latent. Deux écritures
        // de la même expression divergent en silence — et la seconde aurait en plus introduit un
        // deuxième littéral `30` dans ce fichier, que le ratchet fiscal a immédiatement signalé.
        const ageSpouseProjete = config.users[1] ? (config.users[1].age || 30) + Math.floor(m / 12) : undefined;
        const isRetired = age >= effectiveRetirementAge;

        // Cycle 9 split: mortalité user + conjoint → ./projection/stochasticEvents
        if (tryMortality({ m, currentMonthIndex, age, enableMonteCarlo, rng }, effProj, isDead)) {
            isDead = true;
        }
        const spouseAge = (config.users[1]?.age || 30) + Math.floor(m / 12);
        // [ENG-DIVORCE, panel #613 — ÉLEVÉ-3] `!divorced` : un DIVORCÉ ne devient pas VEUF de son
        // ex. Sans cette garde, la mort de l'ex basculait le ménage en `survivorMode` et lui
        // ouvrait les prestations de survivant — mesuré dans 96 itérations MC sur 101, pour
        // −2 555,20 $/mois (PSV ×0,5, DB ×0,6, RRQ ×0,8). Direction conservatrice, mais c'est la
        // contradiction LITTÉRALE de la justification du correctif (« un divorcé ne touche AUCUNE
        // prestation de survivant ») : le code disait l'inverse de son commentaire.
        if (!divorced && trySpouseMortality({ m, currentMonthIndex, enableMonteCarlo, rng }, effProj, spouseAge, spouseAlive, survivorMode)) {
            spouseAlive = false;
            survivorMode = true;
            survivorTriggerLogged = false;
        }

        if (isDead) {
            elapsedYearsAtEnd = m / 12;
            break;
        }

        // --- 1. GROWTH & MARKET SHOCKS ---
        // Cycle 27 split: chocs de marché + bootstrap historique + stress test inflation → ./projection/marketShocks
        const { mcCeliRate, mcReerRate, mcNonRegRate, mcCryptoRate, mcCashRate, currentInflation } =
            computeMonthlyMarketRates(m, enableMonteCarlo, yearBaseRates, simInflation, historicalSequence, stressTestConfig, rng, macroState, activeValoriaSchedule, params.pastCurveCalibration);

        if (m > 0) {
            cumulativeCpiMultiplier *= Math.pow(Math.max(1e-6, 1 + currentInflation / 100), 1 / 12);
        }

        // Cycle 29 split: inflation effective des dépenses → ./projection/monthlyCalcs
        const effectiveExpenseInflation = computeEffectiveExpenseInflation(age, isRetired, currentInflation, effProj);
        // [ENG-GK-THRESHOLD-KNIFE] indexation PROPORTIONNELLE au facteur GK (1 = pleine,
        // 0 = gel — extrêmes identiques à l'ancien booléen ; entre les deux, le lissage
        // remplace le seuil couteau).
        if (guytonKlinger_indexationFactor > 0) {
            expenseMultiplier *= Math.pow(1 + (effectiveExpenseInflation * guytonKlinger_indexationFactor) / 100, 1 / 12);
        }

        prevCELI = celi;
        prevREER = reer;
        prevLiquid = liquid;
        // prevNW = rawNetWorth du mois précédent (source unique) → diffNW = variation nette EXACTE.
        prevNW = currentRawNetWorth();

        let monthlyIncome = 0;
        let monthlyExpenses = 0;
        let uncoveredThisMonth = 0;
        let incomeMarc = 0;
        let incomeAnna = 0;
        incomeRetirement = 0;
        incomeRetirementPerUser = [];
        incomeRetirementDbPerUser = [];
        pensionRRQ = 0;
        pensionPSV = 0;
        pensionPrivee = 0;
        // [ESTATE-NPV-07] `incomeRetirementGis` et `pensionOasReduction` manquaient à ce reset alors
        // que leurs SIX voisins immédiats y sont — `PATRON-APPLIQUE-A-COTE-MAIS-PAS-ICI`. Inoffensif
        // tant que `isRetired` est monotone, mais ces champs PILOTENT désormais un calcul
        // money-critical (l'assiette du facteur net de la VAN successorale).
        incomeRetirementGis = 0;
        pensionOasReduction = 0;
        let childGrossCost = 0;
        let childBenefits = 0;
        let childMonthlyCost = 0;
        let reeeContribMonthly = 0;
        let reeePayoutMonthly = 0;
        let immoHypo = 0;
        let immoCharges = 0;
        let immoInterest = 0;
        let immoPrincipal = 0;

        let lifeEventsLog: string[] = pointAllege ? EMPTY_STRING_LOGS : [];
        // [Panel #552, ÉLEVÉ financial-integrity] Rendre VISIBLE l'hypothèse « bien passé =
        // détenu » : un objectif d'achat à date passée jamais réalisé serait sinon promu bien
        // détenu EN SILENCE (équité + dette fantômes). Le vrai discriminant (champ isOwned) est
        // au BACKLOG [ENG-PAST-OWNED-VS-PLANNED] — décision UX Marc requise.
        if (!pointAllege && m === 0) {
            propertiesState.forEach((p, i) => {
                if (p.isBought) {
                    lifeEventsLog.push(`🏠 ${activeRE[i]?.name || 'Propriété'} : supposée DÉTENUE depuis ${activeRE[i]?.purchaseDate || '?'} (équité de départ ${formatCAD(Math.round(p.currentValue - p.mortgage))})`);
                }
            });
        }
        let flowEventsLog: string[] = pointAllege ? EMPTY_STRING_LOGS : [];
        const eventDaysLog: Record<string, number> = pointAllege ? EMPTY_EVENT_DAYS : {};
        const ambiguousEventDays: Set<string> | null = pointAllege ? null : new Set<string>();
        const logEvent = (arr: string[], msg: string, day?: number) => {
            if (pointAllege || arr.length >= 50) return;
            const seenBefore = arr.includes(msg);
            arr.push(msg);
            const hasDay = Number.isFinite(day) && (day as number) >= 1 && (day as number) <= 31;
            if (!hasDay) {
                if (msg in eventDaysLog) delete eventDaysLog[msg];
                if (seenBefore) ambiguousEventDays!.add(msg);
                return;
            }
            const rounded = Math.round(day as number);
            if (seenBefore && (!(msg in eventDaysLog) || eventDaysLog[msg] !== rounded)) {
                delete eventDaysLog[msg];
                ambiguousEventDays!.add(msg);
                return;
            }
            if (!ambiguousEventDays!.has(msg)) eventDaysLog[msg] = rounded;
        };

        // W1.4: log différé du décès conjoint (déclenché plus haut avant l'init de logEvent)
        if (survivorMode && !survivorTriggerLogged) {
            if (!pointAllege) {
                const spouseAge = (config.users[1]?.age || 30) + Math.floor(m / 12);
                logEvent(lifeEventsLog, `🖤 Décès du conjoint à ${spouseAge} ans — bascule en mode survivant`);
            }
            const mergedReer = reerByUser.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
            reerByUser = reerByUser.map((_, i) => (i === 0 ? mergedReer : 0));
            reerShares = reerShares.map((_, i) => (i === 0 ? 1 : 0));
            survivorTriggerLogged = true;
        }

        // V90: Windfall Injection (L'Héritage Inattendu)
        if (scenarioType === 'WINDFALL' && m === 60) {
            const windfallAmount = 250000;
            liquid += windfallAmount;
            if (!pointAllege) {
                logEvent(lifeEventsLog, `🎁 Héritage Inattendu: +${formatCAD(windfallAmount)}`);
                logEvent(flowEventsLog, `💰 WINDFALL: Injection de surplus.`);
            }
        }

        // Phase 4 #4 — Héritage tardif: même montant mais 20 ans plus tard.
        // Teste la capacité à tenir le pont financier longtemps avant l'apport.
        if (scenarioType === 'LATE_INHERITANCE' && m === 240) {
            const lateAmount = 250000;
            liquid += lateAmount;
            if (!pointAllege) {
                logEvent(lifeEventsLog, `⏳ Héritage Tardif (an 20): +${formatCAD(lateAmount)}`);
                logEvent(flowEventsLog, `💰 LATE_INHERITANCE: enfin libéré.`);
            }
        }

        // Phase 2: Restitution du CELI en JANVIER (Mois 0)
        if (currentMonthIndex === 0 && m > 0) {
            celiRoom += celiWithdrawalsThisYear; // +0 si aucun retrait → celiRoom inchangé (zéro effet $)
            if (!pointAllege && celiWithdrawalsThisYear > 0) flowEventsLog.push(`🔄 CELI: Régénération de l'espace de cotisation`);
            celiWithdrawalsThisYear = 0;
        }
        let fluxImpots = 0;
        let impotGainsMois = 0; // V29: Gains en capital (taxes payées ce mois ou différées)
        let impotDiversMois = 0; // V29: Taxes divers (FHSA, etc.)
        let retraitReerMois = 0;
        // [WHT-DISPLAY-EXACT volet a] Retenue REER PAR TIRAGE cumulée sur le mois (cascade + sauvetage
        // de découvert) → compteur d'affichage `totalTaxesPaid` exact (barème par palier non additif).
        let rrspWithholdingMois = 0;
        let retraitCeliMois = 0;
        let impotReerMois = 0; // V24: Impôt sur retraits REER, séparé de fluxImpots
        let impotSalaireMois = 0; // V36: Impôt sur salaire (retenues/provision)
        let taxOnRrif = 0; // V49: Impôt FERR retenu à la source
        /**
         * [ENG-FERR-NETTRANSFER-MUET] Part du retrait FERR de CE mois. La FERR EST un retrait REER :
         * elle doit entrer dans `withdrawalREER`, donc dans le flux PUBLIÉ `NetTransferREER`. Mais
         * `stepReerByUser` doit l'EXCLURE : elle a déjà été retirée de la part EXACTE de chaque
         * conjoint (`ferrGrossByUser`, facteur RRIF de SON âge), et la re-soustraire AU PRORATA
         * fausserait le partage d'un couple à écart d'âge. Un montant, deux registres, deux règles.
         */
        let ferrWithdrawalMois = 0;
        /**
         * [ENG-DIVORCE-FLUX-MUET] Part du REER CÉDÉE au divorce ce mois-ci. Même règle que
         * `ferrWithdrawalMois` : elle DOIT entrer dans `withdrawalREER` (flux publié) et être EXCLUE
         * de `stepReerByUser`, qui verrait sinon une seconde soustraction sur un registre déjà
         * consolidé par le callback lui-même.
         */
        let divorceReerWithdrawalMois = 0;

        // V27: Variables de suivi pour le mois en cours
        let contribCELI = 0, withdrawalCELI = 0;
        let contribREER = 0, withdrawalREER = 0;
        let contribNonReg = 0, withdrawalNonReg = 0;
        // [ENG-MELTDOWN-JAMBE-ARRIVEE] Jambe d'ARRIVÉE du meltdown, registre SÉPARÉ de
        // `contribNonReg` (les deux n'ont pas les mêmes lecteurs). Il alimente (1) le flux publié
        // `NetTransferNonReg` (lot 157) et (2) depuis [ENG-MELTDOWN-MIMOIS] (décision Marc
        // 2026-09-04) la base d'exclusion de croissance de mi-mois de `growthApplication`, par son
        // PROPRE paramètre — l'argent arrivé en cours de mois ne touche qu'un demi-mois de
        // rendement, comme les cotisations ordinaires. Le verser dans `contribNonReg` resterait
        // faux : ce registre-là est aussi un affichage (`ContribNonReg` publié).
        let arriveeMeltdownNonReg = 0;
        let contribCrypto = 0, withdrawalCrypto = 0;
        let contribLiquid = 0, withdrawalLiquid = 0;
        let contribCELIAPP = 0, withdrawalCELIAPP = 0;
        let contribREEE = 0, withdrawalREEE = 0;

        let growthCELI = 0, growthPctCELI = 0;
        let growthREER = 0, growthPctREER = 0;
        let growthNonReg = 0, growthPctNonReg = 0;
        let growthCrypto = 0, growthPctCrypto = 0;
        let growthLiquid = 0, growthPctLiquid = 0;
        let growthCELIAPP = 0, growthPctCELIAPP = 0;
        let growthREEE = 0, growthPctREEE = 0;


        // Le temps passe et on vit au Canada, retraité ou non (jusqu'à 65 ans max pour l'accumulation PSV)
        config.users.filter(u => u).forEach((u, idx) => {
            const birthYear = u.birthYear || (startYear - (u.age || 30));
            const currentAgeUser = loopYear - birthYear;
            if (currentAgeUser >= PSV_RESIDENCY_START_AGE && currentAgeUser < PSV_ELIGIBILITY_AGE) {
                psvResidencyYears[idx] += 1 / 12;
            }
        });

        // Cycle 10 split: divorce → ./projection/stochasticEvents (tryDivorce)
        // Le splitter callback mute toutes les locales en un point.
        // [panel #613 — MOYEN-8] `spouseAlive` : on ne divorce pas d'un conjoint DÉCÉDÉ. La
        // mortalité est évaluée plus haut dans le MÊME mois, donc le cas est atteignable — mesuré
        // 14 itérations sur 101 avec une conjointe âgée. Le défaut préexistait pour les actifs ;
        // le partage des dettes l'aurait AGGRAVÉ (le veuf voyait aussi ses dettes divisées par 2).
        if (spouseAlive && tryDivorce({ m, currentMonthIndex, enableMonteCarlo, rng }, effProj, divorced, (keep) => {
            // [ENG-DIVORCE-FLUX-MUET] La part CÉDÉE quitte les comptes : c'est un FLUX, et la
            // forme-flux (« solde(m) − solde(m−1) == MarketGrowth + NetTransfer ») exige qu'il soit
            // publié. Sans ces sept lignes, des centaines de milliers de dollars disparaissaient sans
            // aucune cause visible. MESURÉ au mois du divorce, sur une fixture MC déterministe
            // (partage 50 %) : CELI 119 007,53 $ · REER 91 679,66 $ · Crypto 15 599,16 $ ·
            // REEE 9 088,89 $ · Liquidités 12 492,83 $ de résiduel inexpliqué.
            // ⚠️ Capturé AVANT la mise à l'échelle : après, la part cédée n'est plus lisible nulle part.
            const cede = 1 - keep;
            withdrawalLiquid += liquid * cede;
            withdrawalCELI += celi * cede;
            withdrawalCELIAPP += celiapp * cede;
            withdrawalNonReg += nonReg * cede;
            withdrawalCrypto += crypto * cede;
            withdrawalREEE += reee * cede;
            // ⚠️ UN MONTANT, DEUX REGISTRES, DEUX RÈGLES. `withdrawalREER` alimente le flux publié
            // MAIS AUSSI `stepReerByUser`, qui re-soustrait AU PRORATA du registre per-conjoint. Or
            // ce registre est déjà consolidé plus bas dans CE MÊME callback (`reerByUser = [reer, 0]`,
            // avec le total DÉJÀ réduit) : laisser passer la part cédée la retirerait DEUX fois.
            // Même traitement que la FERR (`ferrWithdrawalMois`).
            const reerCede = reer * cede;
            withdrawalREER += reerCede;
            divorceReerWithdrawalMois += reerCede;

            liquid *= keep;
            celi *= keep;
            celiapp *= keep;
            reer *= keep;
            nonReg *= keep;
            nonRegACB *= keep;
            crypto *= keep;
            cryptoACB *= keep;
            reee *= keep;
            realEstateEquity *= keep;
            mortgageBalance *= keep;
            // [ENG-W5-BUSINESS-DIVORCE-NON-PARTAGE] Même traitement que `realEstateEquity` ci-dessus :
            // une valeur de patrimoine SOMMÉE dans `computeRawNetWorth`, jamais un compte à
            // mouvements mensuels — pas de registre `withdrawalXXX` à alimenter (elle n'en a jamais
            // eu, `ENG-W5-BUSINESS-DIVORCE-NON-PARTAGE` visait justement son absence de tout
            // mécanisme). La cession de VALEUR n'est donc pas publiée dans un flux séparé, exactement
            // comme pour l'équité immobilière.
            privateBusinessValue *= keep;
            // ⚠️ [ENG-W5-BUSINESS-DIVORCE-NON-PARTAGE, revue #954] `businessStates` PARTAGE le même
            // fait que `privateBusinessValue` (la propriété de l'entreprise) mais alimente un AUTRE
            // registre — le dividende mensuel encaissé et imposé dans `applyW5Effects`. Trouvé par
            // deux revues indépendantes : sans cette ligne, le ménage restant continuait de toucher
            // et de se faire imposer 100 % du dividende annuel de l'entreprise, indéfiniment, pendant
            // que son équité au bilan tombait à `keep` — un même actif, deux registres, un seul
            // partagé (`PARTAGER-LE-MONTANT-PAS-SES-REFLETS`). Mesuré (900 000 $, dividende
            // 60 000 $/an, `keep` 0,25) : +5 000 $/mois de revenu non partagé, ≈ 405 000 $ composés
            // sur les 9 années restantes d'un horizon de 10 ans — plus gros que la correction de
            // valeur elle-même sur un horizon long.
            businessStates = businessStates.map(b => ({ ...b, ownershipPct: b.ownershipPct * keep }));
            // ⚠️ [ENG-DIVORCE-SCALE-UNBOUGHT] `p.isBought` : on ne partage que les biens RÉELLEMENT
            // DÉTENUS. Pour un bien pas encore acheté, `currentValue` et `mortgage` ne sont pas des
            // actifs du couple — ce sont les PARAMÈTRES SEMÉS du futur achat (`price` et
            // `price − downPayment`), que `realEstateMonth` consomme tels quels au moment de l'achat
            // (`const p = pState.mortgage`).
            // MESURÉ sur un achat à 500 000 $ / mise de fonds 100 000 $ après un divorce à `keep`
            // 0,5 : le cash sorti reste IDENTIQUE (105 000 $, il vient de `goal`, pas de l'état),
            // mais le bien acheté vaut 250 000 $ pour une hypothèque de 199 664 $ — l'équité obtenue
            // tombe de 100 672 $ à 50 336 $. **La moitié de la mise de fonds s'évapore à l'achat.**
            // Deux sources pour une même opération : le débit vient du BUT, l'actif de l'ÉTAT.
            propertiesState = propertiesState.map(p => (p.isBought ? {
                ...p,
                currentValue: p.currentValue * keep,
                mortgage: p.mortgage * keep,
                calculatedPmt: p.calculatedPmt * keep,
                cost: Number.isFinite(p.cost) ? p.cost * keep : 0,
            } : p));
            // [ENG-W5-RENTAL-OFFBALANCE] Les IMMEUBLES LOCATIFS se partagent comme le reste du
            // patrimoine familial. Oubliés ici, ils survivaient INTACTS au divorce pendant que tous
            // les autres actifs étaient divisés — MESURÉ : équité de 337 224 $ conservée à 100 %
            // alors que le CELI passait de 231 723 $ à 107 770 $. Trouvé par une revue automatique
            // sur la PR ; c'est la classe `MODULE-ECRIT-HORS-CHECKLIST` appliquée à un état que je
            // venais MOI-MÊME d'introduire — un état persistant nouveau doit être confronté à TOUS
            // les mutateurs globaux existants (divorce, décès, événements de vie), pas seulement au
            // chemin heureux.
            //
            // ⚠️ La MENSUALITÉ est partagée elle aussi, contrairement au chemin des buts immobiliers
            // (`propertiesState` ci-dessus ne touche pas `calculatedPmt`). Payer la mensualité
            // ENTIÈRE sur une hypothèque réduite de moitié amortirait le prêt deux fois trop vite et
            // ponctionnerait un cashflow que le divorcé n'a plus. La divergence est VOLONTAIRE et
            // assumée ; l'asymétrie du chemin des buts est un défaut préexistant, tracé au BACKLOG
            // (`[ENG-DIVORCE-PMT-NON-PARTAGEE]`) plutôt que corrigé ici — il re-baserait des goldens.
            for (let ri = 0; ri < rentalStates.length; ri++) {
                const rs = rentalStates[ri];
                rs.currentValue *= keep;
                rs.mortgage *= keep;
                rs.monthlyPayment *= keep;
                rs.ucc *= keep;
                rs.initialCost *= keep;
                rs.totalCcaClaimed *= keep;
                if (rentalTaxBases[ri]) {
                    rentalTaxBases[ri].purchaseCost *= keep;
                    rentalTaxBases[ri].priorCcaTaken *= keep;
                }
            }
            // [ENG-DIVORCE-DEBT-ASYMMETRY] Les dettes NON immobilières se partagent au MÊME taux que
            // les actifs — DÉCISION MARC 2026-08-13 (esprit du patrimoine familial québécois : on
            // partage la valeur NETTE, pas les actifs bruts ; cf. docs/adr/).
            // Avant : seule l'hypothèque suivait `keep`. Mesuré : après avoir cédé 100 % des ACTIFS,
            // le patrimoine restait à −81 827 $ — 100 k$ de dettes intactes en face de rien.
            activeDebts = activeDebts.map(d => ({
                ...d,
                balance: Number.isFinite(d.balance) ? d.balance * keep : d.balance,
                // [panel #613 — MOYEN-9] Le paiement MINIMUM suit le solde. Sans ça, une dette
                // divisée par deux continuait d'être remboursée au rythme calibré pour la dette
                // ENTIÈRE : extinction ~2× trop rapide et, surtout, AUCUNE détente de trésorerie
                // pour quelqu'un qui vient de perdre la moitié de ses revenus. Incohérence
                // INTRODUITE par le partage des dettes — elle n'existait pas avant.
                minimumPayment: Number.isFinite(d.minimumPayment) ? d.minimumPayment * keep : d.minimumPayment,
            }));
            liquidDebt *= keep;
            smithManoeuvreDebt *= keep;
            // [ENG-DIVORCE-REGISTRE-PERCONJOINT] Le registre REER per-conjoint doit suivre le split,
            // sinon l'invariant Σ(reerByUser) == reer casse (le total vient d'être multiplié par
            // `keep`). Le ménage passe à UNE tête : tout ce qui reste est au déclarant restant, même
            // consolidation que le décès — la différence étant qu'ici le total a d'abord été réduit.
            reerByUser = reerByUser.map((_, i) => (i === 0 ? reer : 0));
            // ⚠️ …ET LES PARTS AVEC (panel #613 — ÉLEVÉ-2). Sans cette ligne, la consolidation
            // ci-dessus est annulée dès la première cotisation : `stepReerByUser` répartit par
            // `shares[i]` et repeuple le slot de l'ex. L'invariant Σ restait numériquement vert
            // (0 violation sur 36 461 observations) alors que la SÉMANTIQUE était fausse — un
            // invariant de somme ne dit rien de l'ATTRIBUTION.
            reerShares = reerShares.map((_, i) => (i === 0 ? 1 : 0));
            // [ENG-DIVORCE-TAXDEBT-UNSPLIT] La CRÉANCE (ou la DETTE) fiscale se partage comme le
            // reste. `taxPreviousYear` porte l'impôt de l'année du COUPLE, réglé en avril : sans
            // ce partage, un divorcé ayant cédé 100 % de son patrimoine voyait quand même arriver
            // le remboursement INTÉGRAL du couple — mesuré 26 948,77 $ crédités sur un patrimoine
            // de 135 $, montant identique au témoin sans divorce. Symétrique et plus grave dans
            // l'autre sens : il aurait porté SEUL une dette d'impôt du ménage.
            // C'est la DÉCISION VERROUILLÉE de Marc (`docs/adr/`) : on partage la valeur
            // NETTE — c'est elle qui a justifié d'ajouter les dettes au split, et une créance
            // fiscale née pendant l'union est de la valeur nette comme une autre.
            // Effet de bord corrigé au passage : ce remboursement non partagé rendait
            // `totalTaxesPaid` NÉGATIF (« impôt à vie : −12 992,70 $ »).
            // `taxCurrentYear` est partagé aussi, par SYMÉTRIE : il vaut ~0 en janvier (remis à
            // zéro en décembre), donc l'effet est nul aujourd'hui — mais laisser un seul des deux
            // registres suivre le split est exactement le motif « règle dupliquée corrigée à
            // moitié » qui a déjà coûté deux NO-GO sur ce lot.
            const splitTaxBucket = (b: typeof taxPreviousYear): typeof taxPreviousYear => ({
                revenu: b.revenu * keep, gains: b.gains * keep, reer: b.reer * keep,
                divers: b.divers * keep, donCredit: b.donCredit * keep,
            });
            taxPreviousYear = splitTaxBucket(taxPreviousYear);
            taxCurrentYear = splitTaxBucket(taxCurrentYear);
            // [ENG-DIVORCE-REEE-COTISATIONS] Le SOLDE du REEE vient d'être partagé (`reee *= keep`
            // ci-dessus). Les COTISATIONS futures doivent suivre la même clé — décision Marc
            // 2026-08-17 — et `keep` n'existe que dans cette callback : sans le RETENIR ici, le
            // déclarant continuait de cotiser la part ENTIÈRE sur un régime réduit de moitié.
            // Multiplicatif, pas affecté : un second divorce doit composer avec le premier.
            reeeContribShare *= keep;
        })) {
            divorced = true;
        }
        if (divorced && !divorceLogged) {
            if (!pointAllege) {
                logEvent(lifeEventsLog, `💔 Divorce — partage de ${clampSplitPct(effProj.divorceSplitPct ?? DIVORCE_SPLIT_PCT_DEFAULT)}% du patrimoine NET (actifs et dettes)`);
            }
            divorceLogged = true;
        }

        // [FISC-DIVORCE-INCOME-PHANTOM] Le divorce coupait les ACTIFS mais gardait le revenu ET la
        // fiscalité de COUPLE : le conjoint parti continuait d'encaisser son salaire à vie (mesuré :
        // 85 k$/an de revenu fantôme sur un couple à 183 k$ brut) et le ménage restait imposé à deux
        // têtes. Cette erreur DOMINE la coupe de patrimoine — et la garde de conservation ne peut pas
        // l'attraper : l'argent reste conservé, il est simplement INVENTÉ au bon endroit.
        //
        // `soloHousehold` = « il ne reste qu'UN déclarant dans ce ménage ». Décès et divorce y mènent
        // tous les deux, et la plomberie fiscale existait déjà pour le décès (`survivorMode`) : on la
        // RÉUTILISE au lieu d'ouvrir un second chemin qui divergerait.
        // ⚠️ Ne remplace PAS `survivorMode` partout : les PRESTATIONS DE SURVIVANT (RRQ réversible,
        // PSV, DB du conjoint décédé) n'existent pas pour un divorcé — `computeRetirementIncome`
        // continue donc de recevoir `survivorMode`, pas ce drapeau.
        // ⚠️ POSITION — corrigée après mesure (panel #613). J'avais d'abord posé ce drapeau AVANT
        // le bloc `tryDivorce`, en affirmant que le décalage d'un mois était sans effet puisque le
        // divorce n'arme qu'en janvier et que le dépôt fiscal est en décembre. C'était FAUX : le
        // dépôt de décembre était bien épargné, mais pas la PHASE REVENUS — mesuré 5 094,90 $ de
        // salaire du conjoint encaissé pendant l'année du divorce, et intégralement conservé
        // (le split précède la trésorerie du mois). Ce revenu gonflait aussi le revenu gagné annuel (aujourd'hui `accGrossIncomeYearByUser`),
        // donc l'espace REER de l'année suivante, alors que décembre déclarait `grossAnna = 0`.
        // `tryDivorce` est donc désormais évalué JUSTE AU-DESSUS, avant les revenus.
        const soloHousehold = survivorMode || divorced;
        // [FISC-LATENT-PENSION-CREDIT] Rente DB mensuelle PAR DÉCLARANT, effondrée sur une seule
        // tête après un décès ou un divorce — exactement comme `ages` et `taxFilers`. Source unique
        // consommée par le dépôt de décembre ET par l'impôt latent.
        const dbPerUserMonthly = (): number[] => soloHousehold
            ? [incomeRetirementDbPerUser.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0)]
            : incomeRetirementDbPerUser;

        // Nombre de CONTRIBUABLES du ménage — ≠ `activeUsersCount`, qui reste la taille NOMINALE et
        // sert de diviseur d'agrégats. Hissé ici (il vivait dans le seul bloc de décembre) parce
        // qu'il pilote désormais aussi le meltdown REER : deux copies de la même règle finissent
        // toujours par diverger, et c'est exactement ce qui s'est produit (`taxFilers` = 1 au dépôt
        // fiscal pendant que le meltdown visait encore un revenu de DEUX déclarants).
        const taxFilers = soloHousehold ? 1 : activeUsersCount;

        // ---- PHASE RETRAITE ----
        if (isRetired) {
            if (!hasLoggedRetirement) {
                if (!pointAllege) lifeEventsLog.push('📍 Début Retraite');
                hasLoggedRetirement = true;
            }
            // Cycle 13 split: calcul RRQ/PSV/DB → ./projection/retirementIncome
            const retirementBreakdown = computeRetirementIncome(
                { m, age, simInflation,
                  // [FISC-DIVORCE-INCOME-PHANTOM + panel #613 ÉLEVÉ-1] Après un divorce, les rentes
                  // du conjoint partent avec lui.
                  // ⚠️ `activeUsersCount` reste INCHANGÉ, et c'est CONTRE-INTUITIF : ici ce n'est pas
                  // un compteur de bénéficiaires mais le DIVISEUR de l'agrégat ménage
                  // (`(base/activeUsersCount) × poids_i`, sommé sur `users`). La réduction vient de
                  // la liste d'users RACCOURCIE, plus bas. Le premier correctif passait AUSSI
                  // `activeUsersCount: 1` : le `/N` annulait alors le retrait du conjoint — Δ rentes
                  // MESURÉ = 0,00 $/mois, et +398 $/mois à salaires inégaux (le divorce enrichissait).
                  activeUsersCount,
                  // La DB (`dbPensionMonthly`) est un montant MÉNAGE que rien ne divise : elle exige
                  // un facteur EXPLICITE, sinon un divorcé gardait 100 % de la pension du couple.
                  householdPensionShare: divorced ? 1 / Math.max(1, activeUsersCount) : 1,
                  // Le SRG est la seule prestation dont le barème dépend de la COMPOSITION du
                  // ménage : ni le diviseur ci-dessus ni la liste d'users raccourcie ne
                  // l'atteignent (ces lignes-là ne bouclent pas sur `users`). D'où ce compteur de
                  // TÊTES explicite. `soloHousehold` et non `divorced` : le veuf y arrive aussi,
                  // même si `survivorMode` le couvre déjà — les deux voies doivent dire la même
                  // chose, sinon la prochaine correction n'en bougera qu'une (c'est exactement ce
                  // qui a produit la contradiction `taxFilers` / meltdown).
                  householdAdults: soloHousehold ? 1 : activeUsersCount,
                  baseGrossAnnual, delayPensions,
                  survivorMode, monthlyOasReduction, dbSurvivorPct, rrqSurvivorPct, psvResidencyYears,
                  startYear,
                  // FA-3b — le test SRG regarde le revenu de l'ANNÉE PRÉCÉDENTE (retraits REER + loyers).
                  otherIncomeAnnualLaggedNominal: prevYearOtherIncomeForGisNominal,
                  // PV-9 — + gains en capital RÉALISÉS de l'année précédente (BRUT ; ×0,5 appliqué dans computeRetirementIncome).
                  prevYearCapitalGainsForGisNominal },
                retirementGoal,
                // C'EST ICI que la réduction opère : un seul user ⇒ la somme
                // `(base/activeUsersCount) × poids_i` ne porte plus que sur le déclarant restant.
                divorced ? config.users.slice(0, 1) : config.users,
            );
            incomeRetirement = retirementBreakdown.total;
            incomeRetirementPerUser = retirementBreakdown.perUser.map(p => p.total);
            incomeRetirementDbPerUser = retirementBreakdown.perUser.map(p => p.privee);
            incomeRetirementGis = retirementBreakdown.gis;
            pensionRRQ = retirementBreakdown.rrq;
            pensionPSV = retirementBreakdown.psv;
            pensionPrivee = retirementBreakdown.privee;
            pensionOasReduction = retirementBreakdown.oasReduction;
            monthlyIncome = incomeRetirement;

            // D2.3: monthlyExpenses est défini de façon unique dans le bloc
            // EXPENSES & EVENTS plus bas (évite la double affectation).
        } else {
            // ---- PHASE ACTIVE ----
            // Cycle 15 split: salaire + job loss/LTD + bonus/RSU → ./projection/activeIncome
            const aiResult = computeActiveIncome(
                { m, currentMonthIndex, simSalaryGrowth, enableMonteCarlo, rng,
                  // `survivorMode` est le nom du PARAMÈTRE ; sa sémantique côté activeIncome est
                  // « pas de revenu de conjoint » — vrai au décès comme au divorce.
                  incomeMarcNetMonthly, incomeAnnaNetMonthly, survivorMode: soloHousehold,
                  grossMarcBaseAnnual, grossAnnaBaseAnnual,
                  unemployedMonthsRemaining, ltdMonthsRemaining, ltdLogged,
                  // [AE-PLAFOND-MANQUANT] prestation AE par le brut plafonné, imposée à assiette nulle
                  loopYear, simInflation, calculateFiscalReport },
                effProj,
                config.users,
            );
            incomeMarc = aiResult.incomeMarc;
            incomeAnna = aiResult.incomeAnna;
            monthlyIncome = aiResult.monthlyIncome;
            // [FISC-EVENT-INCOMELOSS] événements de perte de revenu DATÉS (PERTE_EMPLOI/SABBATIQUE/
            // ACCIDENT) : réduisent le revenu MÉNAGE de incomeLossPercent % pendant durationMonths mois
            // (sémantique Marc 2026-06-18 : % perdu + durée, niveau ménage). On réduit le NET (`monthlyIncome`,
            // cashflow) ET `accGrossAdd` du même facteur. ⚠️ `accGrossAdd` alimente UNIQUEMENT l'espace REER
            // de l'an+1 (`taxJanuary.ts`), PAS l'impôt salarial de décembre (calculé sur `grossMarcBaseAnnual`
            // PLEIN — vérifié empiriquement, ΔFluxImpots = 0). Le fix NE modélise donc PAS le remboursement
            // d'impôt qu'une vraie perte de revenu déclencherait → biais CONSERVATEUR (NW post-perte
            // légèrement sous-estimé), IDENTIQUE au chômage STOCHASTIQUE existant (`activeIncome.ts` AE 55 %/
            // LTD). Conservation préservée (résiduel < 1 $, moneyConservation). Appliqué AVANT le bloc enfants
            // (prestations revenu-testées recalculées sur le revenu réduit). RETRAITE : non appliqué (pas de
            // revenu d'EMPLOI à perdre) → un événement daté en retraite est inerte. Interaction avec une perte
            // STOCHASTIQUE (Monte-Carlo) le même mois : composition MULTIPLICATIVE (× 0,55 × facteur), bornée
            // [0, 1] — voulu (aléa MC + événement planifié = deux pertes distinctes).
            const incomeLossFactor = setup.hasLifeEvents ? computeIncomeLossFactor(lifeEvents, currentLoopDate) : 1;
            let activeGrossAddByUser = aiResult.accGrossAddByUser;
            if (incomeLossFactor < 1) {
                incomeMarc *= incomeLossFactor;
                incomeAnna *= incomeLossFactor;
                monthlyIncome *= incomeLossFactor;
                activeGrossAddByUser = [activeGrossAddByUser[0] * incomeLossFactor, activeGrossAddByUser[1] * incomeLossFactor];
                if (!pointAllege) logEvent(lifeEventsLog, `📉 Perte de revenu planifiée (-${Math.round((1 - incomeLossFactor) * 100)} %)`);

                const pertePct = computePerteEmploiLossPct(lifeEvents, currentLoopDate);
                if (pertePct > 0) {
                    const yearsElapsedAe = Math.floor(m / 12);
                    const sgf = Math.pow(1 + simSalaryGrowth / 100, yearsElapsedAe);
                    const aeCtx = {
                        simInflation, yearsElapsed: yearsElapsedAe, loopYear,
                        enableMonteCarlo, calculateFiscalReport,
                    };
                    const marcDejaAuChomage = unemployedMonthsRemaining > 0 || aiResult.newUnemployedMonths > 0;
                    const aeMarc = marcDejaAuChomage ? 0
                        : prestationAeNetteMensuelle(grossMarcBaseAnnual * sgf, aeCtx) * pertePct;
                    const aeAnna = soloHousehold ? 0
                        : prestationAeNetteMensuelle(grossAnnaBaseAnnual * sgf, aeCtx) * pertePct;
                    if (aeMarc + aeAnna > 0) {
                        incomeMarc += aeMarc;
                        incomeAnna += aeAnna;
                        monthlyIncome += aeMarc + aeAnna;
                        if (!pointAllege) logEvent(lifeEventsLog, `💼 Prestation d'assurance-emploi versée pendant la perte d'emploi planifiée`);
                    }
                }
            }
            // [Revue #679 ÉLEVÉ-1] Ménage à UN SEUL déclarant : le mode « sandbox »
            // (computeIncomeBaseline) splitte TOUJOURS le revenu théorique 55/45, même avec un
            // seul user — sans repli, la part « 45 % » atterrit à l'index 1 qu'aucun roomUsers ne
            // lit : −12 173 $/an de droits mesurés (−50 159 $ de NW à 12 ans). MÊME critère que
            // reerShares (l. 438) — pas soloHousehold : après décès/divorce, activeIncome met déjà
            // le brut du conjoint à 0 et le repli est alors un no-op.
            // [SANDBOX-CURSEURS-THEORIQUES-RETRAIT] Le split 55/45 n'existe plus (mode neutralisé) :
            // le repli reste en filet, sans effet tant qu'un solo n'a aucun brut à l'index 1.
            // [RRSP-FIRST-YEAR-13M] Le revenu gagné du mois est mis EN ATTENTE ici et versé à
            // l'accumulateur annuel APRÈS le reset de janvier (juste après le bloc `janResult`).
            // Versé ici, le revenu de JANVIER entrait dans l'assiette de l'année qui venait de se
            // clore : le premier cycle comptait 13 mois. Mesuré sur un mono-gagnant à 100 000 $ —
            // droits REER de 19 500 $ au lieu de 18 000 $ (= 18 000 × 13/12, +8,33 %), une seule
            // fois, puis 18 000 $/an.
            // ⚠️ Le SECOND producteur du même accumulateur (le congé parental, plus bas) verse
            // DÉJÀ après le bloc de janvier : ce lot aligne les deux, il n'invente pas une règle.
            // ⚠️ `accCapitalGainsYear` a l'air d'avoir le même défaut (il est alimenté avant
            // janvier) — il ne l'a PAS : il est accumulé, imposé et remis à zéro entièrement dans
            // le bloc de DÉCEMBRE, donc sa position par rapport à janvier est sans objet. Vérifié
            // avant d'élargir ce lot.
            if (activeUsersCount > 1) {
                grossIncomeEnAttenteByUser[0] += activeGrossAddByUser[0];
                grossIncomeEnAttenteByUser[1] += activeGrossAddByUser[1];
            } else {
                grossIncomeEnAttenteByUser[0] += activeGrossAddByUser[0] + activeGrossAddByUser[1];
            }
            unemployedMonthsRemaining = aiResult.newUnemployedMonths;
            ltdMonthsRemaining = aiResult.newLtdMonths;
            ltdLogged = aiResult.ltdLogged;
            if (!pointAllege && aiResult.lifeEventLogs.length > 0) {
                aiResult.lifeEventLogs.forEach(msg => logEvent(lifeEventsLog, msg));
            }
        }

        // --- 3. MONTHLY EXPENSES & EVENTS ---
        if (isRetired) {
            // D2.5: Smile Curve appliquée au besoin de retraite (1 si flag off).
            const baseRetTargetMonthly = Number.isFinite(retirementGoal.targetMonthlyIncome)
                ? Math.abs(retirementGoal.targetMonthlyIncome)
                : 0;
            monthlyExpenses = baseRetTargetMonthly * expenseMultiplier * smileLifestyleFactor(age);
        } else {
            // Active phase income & expenses — Jalon 2 (F12) : 3 modes (budget, réel, hybride)
            const calMonth = (startMonth + m - 1) % 12;
            const stochasticZ = (enableMonteCarlo && effectiveBehavioralProfile.expenseMode !== 'budget' && effectiveBehavioralProfile.expenseVolatility > 0)
                ? (rng() * 2 - 1)
                : 0;
            monthlyExpenses = computeProjectedExpenses(
                m,
                effectiveBaseExpenses,
                effectiveBehavioralProfile,
                {
                    calendarMonth: calMonth,
                    expenseMultiplier,
                    enableMonteCarlo,
                    stochasticZ,
                }
            );
        }

        // Cycle 9 split: LTC trigger + coût mensuel → ./projection/stochasticEvents
        if (tryLtcTrigger({ age, enableMonteCarlo, rng }, effProj, ltcActive)) {
            ltcActive = true;
            if (!pointAllege) logEvent(lifeEventsLog, `🏥 Soins de longue durée déclenchés à ${age} ans`);
        }
        if (ltcActive) {
            monthlyExpenses += ltcMonthlyCost(effProj, expenseMultiplier);
        }

        if (divorced) {
            const alimony = effProj.divorceAlimonyMonthly || 0;
            monthlyExpenses += alimony * expenseMultiplier;
        }


        // Cycle 8 split: événements stochastiques one-shot (CI + héritage)
        if (enableMonteCarlo && currentMonthIndex === 0 && m > 0 && (effProj.criticalIllnessEnabled || effProj.inheritanceEnabled)) {
            const stochCtx = { m, currentMonthIndex, age, currentAge, expenseMultiplier, enableMonteCarlo, rng };
            const stochMutator = {
                addLiquid: (amt: number) => { liquid += amt; },
                addExpense: (amt: number) => { monthlyExpenses += amt; },
                logLife: (msg: string, day?: number) => { if (!pointAllege) logEvent(lifeEventsLog, msg, day); },
            };
            if (tryCriticalIllness(stochCtx, effProj, ciTriggered, stochMutator)) ciTriggered = true;
            if (tryInheritance(stochCtx, effProj, inheritanceReceived, stochMutator)) inheritanceReceived = true;
        }

        // Cycle 7 split: Sandwich generation (boomerang + caregiving) + Snowbird
        if (setup.hasAgeBasedExpenses) {
            applyAgeBasedExpenses(
                { age, currentMonthIndex, isRetired, expenseMultiplier },
                effProj,
                { addExpense: (amt) => { monthlyExpenses += amt; } }
            );
        }

        // Cycle 7 split: 6 effets W5.x extraits dans ./projection/w5Effects.ts
        if (setup.hasW5Collections || !pointAllege) {
            const w5Resultat = applyW5Effects(
                {
                    m, currentMonthIndex, currentLoopDate, startYear, startMonth, expenseMultiplier,
                    rentalInterestMensuelParImmeuble: rentalInterestParImmeuble(rentalStates),
                    skipLogs: pointAllege,
                },
                { insurancePolicies, vehicleReplacements, majorRenovations, charitableGoals, rentalProperties: activeRentals, privateBusinesses: businessStates },
                {
                    addExpense: (amt) => { monthlyExpenses += amt; },
                    addIncome: (amt) => { monthlyIncome += amt; },
                    subtractLiquid: (amt) => { liquid -= amt; },
                    addTaxRevenu: (amt) => { taxCurrentYear.revenu += amt; },
                    addTaxGains: (amt) => { taxCurrentYear.gains += amt; },
                    addTaxDivers: (amt) => { taxCurrentYear.divers += amt; },
                    addDonationCredit: (amt) => { taxCurrentYear.donCredit += amt; },
                    logFlow: (msg, day?: number) => { if (!pointAllege) logEvent(flowEventsLog, msg, day); },
                    logLife: (msg, day?: number) => { if (!pointAllege) logEvent(lifeEventsLog, msg, day); },
                }
            );
            const [locatif0, locatif1] = repartirRevenuGagne(w5Resultat.rentalNoiMensuelParProprietaire, { activeUsersCount, soloHousehold });
            grossIncomeEnAttenteByUser[0] += locatif0;
            grossIncomeEnAttenteByUser[1] += locatif1;
        }

        // --- 4. TAX WITHHOLDING & APRIL SETTLEMENT ---
        let taxPaidRevenu = 0;
        let taxPaidGains = 0;
        let taxPaidDivers = 0;
        let taxPaidREER = 0;
        if (currentMonthIndex === 3 && m > 0) {
            const aprilResult = processAprilSettlement(currentMonthIndex, m, taxPreviousYear, {
                subtractLiquid: (amt) => { liquid -= amt; },
                addNonReg: (amt) => { nonReg += amt; },
                addNonRegACB: (amt) => { nonRegACB += amt; },
                logFlow: (msg, day?: number) => { if (!pointAllege) logEvent(flowEventsLog, msg, day); },
            }, pointAllege);
            taxPaidRevenu = aprilResult.taxPaidRevenu;
            taxPaidGains = aprilResult.taxPaidGains;
            taxPaidDivers = aprilResult.taxPaidDivers;
            taxPaidREER = aprilResult.taxPaidREER;
            contribNonReg += aprilResult.reinvestedNonReg;
            if (aprilResult.fluxImpots !== 0) {
                fluxImpots = aprilResult.fluxImpots;
                impotSalaireMois = taxPaidRevenu;
                impotReerMois = taxPaidREER;
                impotGainsMois = taxPaidGains;
                impotDiversMois = taxPaidDivers;
            }
            reconciledUnsettledTax = 0;
            taxPreviousYear = aprilResult.newTaxPreviousYear;
        }

        // [FISC-SRCDED-NOOP — retenue mensuelle retirée 2026-06-26] La provision salariale mensuelle
        // (`computeMonthlyWithholding`) était VESTIGIALE : sa sortie accumulée dans `taxCurrentYear.revenu`
        // était ÉCRASÉE par l'override de décembre (`taxDecember`, balise « V30: Override ») avant tout
        // règlement → jamais consommée (prouvé : perturbation +999 999/mois ⇒ golden byte-identique, 2331
        // tests d'intégration inchangés). Le flag T1213 agit correctement via le chemin décembre (`taxDecember`,
        // balise « V49: Retenue source »). On conserve UNIQUEMENT la remise à 0 de l'affichage « impôt salaire »
        // pour le non-retraité (annule l'affectation d'avril ci-dessus : le règlement d'avril s'affiche via
        // `fluxImpots`, pas `impotSalaireMois`).
        if (!isRetired) {
            impotSalaireMois = 0;
        }


        // Cycle 12 split: January reset → ./projection/taxCycle.processJanuaryReset
        if (currentMonthIndex === 0 && m > 0) {
            const janResult = processJanuaryReset(
                currentMonthIndex,
                {
                    m, startYear, simInflation, age, isRetired, activeUsersCount: taxFilers,
                    oasClawbackNextPeriod, hasPurchasedPrimary,
                    celiappOpeningYear,
                    fhsaEligibleUsersCount: soloHousehold ? Math.min(1, fhsaEligibleUsersCount) : fhsaEligibleUsersCount,
                    users: config.users,
                    roomUsers: soloHousehold ? config.users.slice(0, 1) : config.users,
                    celiapp, reer, reerByUser, liquid, nonReg, crypto, celi,
                    accGrossIncomeYearByUser, accRetraitsReerYearOld: accRetraitsReerYear,
                    incomeRetirementMonthly: incomeRetirement,
                    fhsaRoomCurrent: fhsaRoom, fhsaLifetimeContrib,
                    celiRoomCurrent: celiRoom, rrspRoomCurrent: rrspRoom,
                    taxCurrentYearGains: taxCurrentYear.gains,
                    prevPortfolioNW, loopYear,
                    skipLogs: pointAllege,
                },
                { RRIF_RATES, calculateFiscalReport },
            );
            if (janResult) {
                prevYearOtherIncomeForGisNominal = accRetraitsReerYear + accRentesYear;
                prevYearCapitalGainsForGisNominal = capitalGainsRealizedThisYear;
                accRetraitsReerYear = janResult.accRetraitsReerYearReset;
                accRetraitsReerYearByUser = accRetraitsReerYearByUser.map(() => 0);
                accRentesYear = janResult.accRentesYearReset;
                monthlyOasReduction = janResult.monthlyOasReduction;
                celiRoom += janResult.celiRoomDelta;
                fhsaRoom = janResult.fhsaRoomNew;
                if (janResult.celiappTransferToReer > 0) {
                    reer += janResult.celiappTransferToReer;
                    celiapp = 0;
                    withdrawalCELIAPP += janResult.celiappTransferToReer;
                    contribREER += janResult.celiappTransferToReer;
                }
                if (janResult.rrspRoomReset) {
                    rrspRoom = 0;
                } else {
                    rrspRoom += janResult.rrspRoomDelta;
                }
                accGrossIncomeYearByUser = [0, 0];
                ferrAnnualByUser = reerShares.map((_, i) => {
                    const v = janResult.ferrGrossByUser?.[i];
                    return Number.isFinite(v) ? Math.max(0, v as number) : 0;
                });
                if (janResult.ferrMandatoryGross > 0) {
                    taxOnRrif = janResult.ferrTaxOnRrif;
                    reer -= janResult.ferrMandatoryGross;
                    taxCurrentYear.reer += janResult.ferrTaxOnRrif;
                    impotReerMois += janResult.ferrTaxOnRrif;
                    accRetraitsReerYear += janResult.ferrMandatoryGross;
                    retraitReerMois += janResult.ferrMandatoryGross;
                    withdrawalREER += janResult.ferrMandatoryGross;
                    ferrWithdrawalMois += janResult.ferrMandatoryGross;
                    reerByUser = reerByUser.map((v, i) => Math.max(0, (Number.isFinite(v) ? v : 0) - (janResult.ferrGrossByUser[i] ?? 0)));
                    accRetraitsReerYearByUser = accRetraitsReerYearByUser.map((v, i) => (Number.isFinite(v) ? v : 0) + (janResult.ferrGrossByUser[i] ?? 0));
                    liquid += janResult.ferrMandatoryGross;
                    if (!pointAllege && janResult.ferrLogMsg) flowEventsLog.push(janResult.ferrLogMsg);
                }
                guytonKlinger_indexationFactor = janResult.guytonKlingerIndexationFactor;
                prevPortfolioNW = janResult.newPrevPortfolioNW;
                if (!pointAllege && janResult.logs.length > 0) {
                    janResult.logs.forEach(msg => flowEventsLog.push(msg));
                }
            }
        }

        // [RRSP-FIRST-YEAR-13M] Versement du revenu gagné du mois, APRÈS le reset de janvier :
        // il appartient à l'année qui COMMENCE, jamais à celle qui vient de se clore. Rien entre
        // sa mise en attente et ce point ne lit `accGrossIncomeYearByUser`, et aucun `continue`
        // ne saute cette ligne (vérifié) — le mois ne peut donc pas se perdre.
        accGrossIncomeYearByUser[0] += grossIncomeEnAttenteByUser[0];
        accGrossIncomeYearByUser[1] += grossIncomeEnAttenteByUser[1];
        grossIncomeEnAttenteByUser = [0, 0];

        // Cycle 10/23 split: Auto-vehicle → ./projection/vehicleCycle (processAutoVehicleReplacement)
        monthsSinceLastVehicle++;
        if (effProj.vehicleReplacementEnabled && m > 0) {
            const vehResult = processAutoVehicleReplacement(m, monthsSinceLastVehicle, effProj.vehicleReplacementEnabled, simInflation, pointAllege);
            if (vehResult.cost > 0) {
                liquid -= vehResult.cost;
                if (vehResult.resetCounter) monthsSinceLastVehicle = 0;
                if (!pointAllege && vehResult.logMsg) lifeEventsLog.push(vehResult.logMsg);
            }
        }

        // ---- DETTES ----
        let debtPayments = 0;
        for (let di = 0; di < activeDebts.length; di++) {
            const d = activeDebts[di];
            const phase = phaseDette(d, startYear, startMonth, m);
            if (!pointAllege
                && phase === 'terminee'
                && d.balance > 0.005
                && estLePremierMoisApresLeTerme(d, startYear, startMonth, m)) {
                lifeEventsLog.push(
                    `⚠️ ${d.name} : fin du terme, il reste ${formatCAD(Math.round(d.balance))} à régler`,
                );
            }

            if (phase === 'active' && d.balance > 0) {
                const interest = (d.balance * (d.interestRate / 100)) / 12;
                const principalFloor = d.balance / 300;
                const effectiveMinimum = Math.max(d.minimumPayment, interest + principalFloor);
                const payment = Math.min(d.balance + interest, effectiveMinimum);
                d.balance = d.balance + interest - payment;
                debtPayments += payment;
            }
        }
        monthlyExpenses += debtPayments;

        // Cycle 20 split: tout l'immobilier mensuel → ./projection/realEstateMonth
        const reState: RealEstateState = {
            liquid, celi, celiapp, reer, nonReg, nonRegACB, capitalLossBank,
            monthlyIncome, monthlyExpenses, accRentesYear, accCapitalGainsYear,
            realEstateEquity, mortgageBalance, hasPurchasedPrimary,
            hasUsedRap, rapBorrowed, rapRepaymentDueTotal, rapRepaymentStartOffset,
            smithManoeuvreDebt, smithInterestDeductibleYear,
            fhsaClosingYear,
            taxCurrentYearReer: taxCurrentYear.reer, impotReerMois,
            withdrawalLiquid, withdrawalCELI, withdrawalNonReg, withdrawalREER, contribLiquid,
            celiWithdrawalsThisYear, retraitCeliMois,
            retraitReerMois, rrspWithholdingMois, accRetraitsReerYearAdd: 0,
            rapMissedRepaymentAdd: 0,
            immoInterest, immoPrincipal, immoHypo, immoCharges,
            totalRentalIncome: 0,
            rentalEarnedParProprietaire: montantsParProprietaireVides(),
            lifeEventLogs: pointAllege ? EMPTY_STRING_LOGS : [],
            flowEventLogs: pointAllege ? EMPTY_STRING_LOGS : [],
        };
        processRealEstate(
            reState,
            { m, loopYear, isRetired, activeUsersCount, simInflation, simSalaryGrowth,
              grossMarcBaseAnnual, grossAnnaBaseAnnual, incomeRetirement,
              taxFilers,
              useSmithManoeuvre: effProj.useSmithManoeuvre === true, currentRentExpense,
              bootPrimaryHousingOffset,
              skipRapForPurchase: overrides.skipRapForPurchase ?? (strategy === 'PRIO_CELI_NO_RAP'),
              downsizeThisMonth: effProj.appliedDownsize === true && m === Math.max(0, retirementMonthIndex),
              otherDebtMonthly: debtPayments,
              skipLogs: pointAllege },
            activeRE,
            propertiesState,
            getMonthOffset,
            welcomeTax,
        );
        liquid = reState.liquid; celi = reState.celi; celiapp = reState.celiapp;
        reer = reState.reer; nonReg = reState.nonReg; nonRegACB = reState.nonRegACB;
        capitalLossBank = reState.capitalLossBank;
        monthlyIncome = reState.monthlyIncome; monthlyExpenses = reState.monthlyExpenses;
        accRentesYear = reState.accRentesYear; accCapitalGainsYear = reState.accCapitalGainsYear;
        realEstateEquity = reState.realEstateEquity; mortgageBalance = reState.mortgageBalance;
        hasPurchasedPrimary = reState.hasPurchasedPrimary;
        // [FISC-RRSP-RENTAL-EARNED] Loyer des buts locatifs → revenu gagné du propriétaire. Ce site est
        // APRÈS le bloc de janvier ET après le versement du tampon : on écrit l'accumulateur DIRECTEMENT
        // (passer par le tampon décalerait décembre dans l'année suivante).
        {
            const [locatif0, locatif1] = repartirRevenuGagne(reState.rentalEarnedParProprietaire, { activeUsersCount, soloHousehold });
            accGrossIncomeYearByUser[0] += locatif0;
            accGrossIncomeYearByUser[1] += locatif1;
        }

        hasUsedRap = reState.hasUsedRap; rapBorrowed = reState.rapBorrowed;
        rapRepaymentDueTotal = reState.rapRepaymentDueTotal;
        rapRepaymentStartOffset = reState.rapRepaymentStartOffset;
        smithManoeuvreDebt = reState.smithManoeuvreDebt;
        smithInterestDeductibleYear = reState.smithInterestDeductibleYear;
        fhsaClosingYear = reState.fhsaClosingYear;
        taxCurrentYear.reer = reState.taxCurrentYearReer;
        impotReerMois = reState.impotReerMois;
        withdrawalLiquid = reState.withdrawalLiquid; withdrawalCELI = reState.withdrawalCELI;
        withdrawalNonReg = reState.withdrawalNonReg; withdrawalREER = reState.withdrawalREER;
        contribLiquid = reState.contribLiquid;
        celiWithdrawalsThisYear = reState.celiWithdrawalsThisYear;
        retraitCeliMois = reState.retraitCeliMois;
        // [REER-RETRAIT-IMMO-REGISTRE] + [REER-IMMO-HORS-ASSIETTE] — le module alimente désormais
        // TOUS les registres du retrait REER, pas seulement le solde et la retenue :
        // l'AFFICHAGE (`retraitReerMois`, `rrspWithholdingMois`) et surtout l'ASSIETTE
        // (`accRetraitsReerYear` + sa ventilation per-conjoint) que décembre impose.
        // ⚠️ `accRetraitsReerYearAdd` EXCLUT le RAP, non imposable.
        retraitReerMois = reState.retraitReerMois;
        rrspWithholdingMois = reState.rrspWithholdingMois;
        if (reState.accRetraitsReerYearAdd > 0) {
            accRetraitsReerYear += reState.accRetraitsReerYearAdd;
            accRetraitsReerYearByUser = addByWeights(accRetraitsReerYearByUser, reState.accRetraitsReerYearAdd, reerByUser);
        }
        // [ENG-RAP-MISSED-REPAYMENT-TAX] Un versement RAP DÛ et non fait s'ajoute au revenu
        // imposable de l'année (ARC, ligne 12900) — même assiette annuelle que ci-dessus, mais
        // registre d'entrée SÉPARÉ : ce n'est pas un retrait du REER, il n'a ni retenue à la
        // source ni ligne « RetraitREER » à l'affichage.
        // ⚠️ Ventilation per-conjoint par `reerByUser` (prorata des soldes REER), la même
        // approximation que le retrait immobilier juste au-dessus : le moteur ne mémorise pas QUI
        // a emprunté au RAP (le plafond est pourtant un droit par personne). Faute d'attribution
        // réelle, le prorata est la répartition la moins arbitraire disponible ici — c'est une
        // limite ASSUMÉE, consignée dans `FISCAL_REFERENCE.md`.
        if (reState.rapMissedRepaymentAdd > 0) {
            accRetraitsReerYear += reState.rapMissedRepaymentAdd;
            accRetraitsReerYearByUser = addByWeights(accRetraitsReerYearByUser, reState.rapMissedRepaymentAdd, reerByUser);
        }
        immoInterest = reState.immoInterest; immoPrincipal = reState.immoPrincipal;
        immoHypo = reState.immoHypo; immoCharges = reState.immoCharges;
        // [ENG-W5-RENTAL-OFFBALANCE] Les immeubles locatifs, APRÈS **toutes** les réaffectations
        // depuis `reState` — y compris `immoInterest`/`immoPrincipal`/`immoHypo`, qui sont ÉCRASÉES
        // (`=`, pas `+=`) trois lignes plus haut. Placé avant, le `+=` de ce bloc disparaissait en
        // SILENCE : le service de dette locatif n'aurait jamais atteint l'affichage, et le lot
        // aurait été vert en test et inerte à l'écran (`CORRECTIF-VERT-EN-TEST-INERTE-EN-PROD`).
        // Les trois volets vont ENSEMBLE — valeur au bilan, hypothèque au bilan, service
        // de la dette en dépense. Chacun seul serait pire que le statu quo : l'équité sans le
        // service donnerait une hypothèque qui ne descend jamais.
        // ⚠️ `equity` est DÉJÀ nette (valeur − hypothèque), comme `realEstateEquity` : on ne
        // re-soustrait JAMAIS `rentalMortgage` du patrimoine (double comptage interdit par la
        // source unique `computeRawNetWorth`).
        if (rentalStates.length > 0) {
            const rm = processRentalMonth(rentalStates, rentalNames);
            realEstateEquity += rm.equity;
            mortgageBalance += rm.mortgageBalance;
            monthlyExpenses += rm.debtService;
            immoInterest += rm.interest;
            immoPrincipal += rm.principal;
            immoHypo += rm.debtService;
            if (!pointAllege && rm.logs.length > 0) rm.logs.forEach(msg => logEvent(lifeEventsLog, msg));
        }
        const totalRentalIncome = reState.totalRentalIncome;
        if (!pointAllege) {
            if (reState.lifeEventLogs.length > 0) reState.lifeEventLogs.forEach(msg => logEvent(lifeEventsLog, msg));
            if (reState.flowEventLogs.length > 0) reState.flowEventLogs.forEach(msg => logEvent(flowEventsLog, msg));
        }

        // ---- ENFANTS & REEE ----
        // Cycle 14 split: processOneChild → ./projection/childrenReee.
        // Les variables liquid/reee/monthlyIncome/incomeAnna sont commitées après le forEach.
        /**
         * [ENG-DIVORCE-CHILDREN-REEE] Part des enfants qui reste à la charge du déclarant.
         *
         * Décision Marc 2026-08-17 (`docs/adr/`) : **garde PARTAGÉE 50/50**. Après un
         * divorce, les COÛTS d'enfants et les ALLOCATIONS familiales se partagent donc moitié-
         * moitié — cohérent avec le régime réel (en garde partagée, l'ACE se divise 50/50).
         *
         * ⚠️ Défaut NEUTRE (1) hors divorce ⇒ rétrocompat BIT-IDENTIQUE, sous test.
         *
         * ⚠️ ELLE EST TRANSMISE, PLUS APPLIQUÉE ICI — et c'est la leçon du lot. Le premier jet
         * multipliait quelques champs du RÉSULTAT (`childGrossCostAdd`, `monthlyExpenseDelta`…).
         * Ça oblige à se souvenir des 3 à 5 registres que chaque montant d'enfant alimente, et
         * DEUX ont été oubliés — mesurés par deux agents indépendants :
         *   • allocations encaissées à 100 % (`monthlyIncomeDelta` jamais partagé) mais publiées à
         *     50 % : 332 $/mois contre 166 $ affichés, 75 957 $ d'écart sur le patrimoine final ;
         *   • décaissement REEE d'études ENTIER face à une dépense à 50 % : +1 450 $/mois de
         *     trésorerie née de nulle part, régime de l'enfant vidé 2× trop vite.
         * En partageant le MONTANT à la source, tout dérivé suit par construction. Classe maison
         * « un flux alimente PLUSIEURS registres », cette fois traitée à la racine.
         *
         * ⚠️ Elle ne s'applique PAS aux flux REEE : le régime suit le partage PATRIMONIAL
         * (`reeeContribShare`), pas la garde — deuxième décision de Marc le même jour. Ni au RQAP
         * ni à l'économie de transport du congé parental, qui dépendent du congé de l'ex-conjoint.
         */
        const childCustodyShare = divorced ? 0.5 : 1;
        let _childLiquid = liquid;
        let _childReee = reee;
        let _childMonthlyIncome = monthlyIncome;
        let _childIncomeAnna = incomeAnna;
        activeChild.forEach((child, idx) => {
            const birthOffset = getMonthOffset(child.birthDate);
            // [S5-REFONTE-ENFANTS] Décision de Marc (25/09) : un enfant planifié compte TOUJOURS dans le
            // Futur — plus d'interrupteur « actif » (l'ancien `isActive` est ignoré ; `childrenCount`
            // plus bas comptait déjà tous les enfants, le moteur devient cohérent avec lui-même).
            if (m < Math.max(0, birthOffset)) return;
            // birthOffset < 0 = enfant né AVANT le début de projection : il a déjà
            // son âge réel (m − birthOffset, donc > m) et n'est PAS « nouveau-né »
            // au mois 0. Le « first month » (congé parental, 1ers frais…) ne se
            // déclenche QUE s'il naît pendant la projection. Avant ce fix, un enfant
            // déjà né était traité comme nouveau-né à m=0 (revenu de congé parental
            // fantôme, ex. 2e parent inexistant chez un parent seul). Exposé par le
            // démarrage « aujourd'hui » (tout enfant existant a birthOffset < 0).
            const childAgeMonths = m - birthOffset;
            const isFirstMonth = m === birthOffset;
            const childId = child.id || `enfant_${idx}`;
            const tracker = reeeTracker[childId] ?? {
                scee: 0,
                iqee: 0,
                contribLifetime: 0,
                pseBalance: _childReee,
                paeBalance: 0,
                remainingScee: 0,
                remainingIqee: 0,
            };
            const result = processOneChild(
                child, idx, isFirstMonth, childAgeMonths,
                {
                    m, loopYear, simSalaryGrowth, simInflation, expenseMultiplier,
                    isRetired, grossMarcBaseAnnual,
                    // [REEE-CONGE-SANS-GARDE-SOLO] `soloHousehold` comme aux QUATRE autres sites qui
                    // passent ce salaire (l. 1197, 1229, 1909, 2114). Il manquait ICI : après décès ou
                    // divorce, le bloc enfants déclenchait le congé parental sur un salaire que le
                    // ménage ne touche plus — MESURÉ : −5 000 $/mois de brut RETIRÉ (−60 k$/an, jamais
                    // crédité) et +2 436 $/mois de prestation RQAP fabriquée pour un parent absent.
                    // Corriger le PRODUCTEUR, pas le consommateur : le module enfants n'a aucun moyen
                    // de savoir que le second parent a disparu.
                    grossAnnaBaseAnnual: soloHousehold ? 0 : grossAnnaBaseAnnual,
                    incomeAnna: _childIncomeAnna,
                    liquid: _childLiquid,
                    reee: _childReee,
                    pseBalance: tracker.pseBalance,
                    paeBalance: tracker.paeBalance,
                    remainingSceeGrants: tracker.remainingScee,
                    remainingIqeeGrants: tracker.remainingIqee,
                    // [ENG-DIVORCE-ALLOC-ASSIETTE] (décision Marc 2026-09-05, réponse 14 : « comme mesuré »)
                    // L'assiette de la RÉCUPÉRATION des allocations (`householdGross > 150 000`) est le
                    // revenu du MÉNAGE QUI RESTE : après un divorce ou un décès, le salaire de l'ex-conjoint
                    // (ou du défunt) n'y entre plus — même règle que `grossAnnaBaseAnnual` juste au-dessus
                    // et que `taxFilers`. Avant, un parent seul se voyait récupérer ses allocations sur un
                    // revenu qui incluait celui de l'ex : mesuré 166 $ → 250 $/mois au mois 36 sur la
                    // fixture de `divorceEnfantsScenario` (98 400 $ seul < 150 000 $ : plus de récupération).
                    // ⚠️ La récupération s'applique toujours au revenu du parent restant : un solo à
                    // 168 000 $ reste récupéré (garde dédiée) — `soloHousehold` change l'ASSIETTE, pas la règle.
                    householdGross: grossMarcBaseAnnual + (soloHousehold ? 0 : grossAnnaBaseAnnual),
                    trackerScee: tracker.scee, trackerIqee: tracker.iqee,
                    trackerReeeContribLifetime: tracker.contribLifetime ?? 0,
                    enableMonteCarlo,
                    reeeContribShare,
                    childCustodyShare,
                },
                calculateFiscalReport,
            );
            // ⚠️ AUCUNE part appliquée ici : elle l'est à la SOURCE (`childCustodyShare` dans le
            // ctx). Multiplier les champs du RÉSULTAT obligeait à se souvenir des 3 à 5 registres
            // que chaque montant alimente — deux ont été oubliés (allocations, retrait d'études),
            // mesurés par deux agents indépendants. Partager le montant, pas ses reflets.
            _childLiquid += result.liquidDelta;
            _childReee = result.reeeNewBalance;
            monthlyExpenses += result.monthlyExpenseDelta;
            _childMonthlyIncome += result.monthlyIncomeDelta;
            if (result.newIncomeAnna !== null) _childIncomeAnna = result.newIncomeAnna;
            // Le congé parental modélisé est TOUJOURS celui d'Anna (childrenReee `annaIsOnMatLeave`,
            // `accGrossDelta -= annaGrossMonthly`) : le retrait s'attribue à l'index 1. Si le congé
            // devient per-parent un jour, cette attribution doit suivre.
            accGrossIncomeYearByUser[1] += result.accGrossDelta;
            reeeTracker[result.childId] = {
                scee: result.newTrackerScee,
                iqee: result.newTrackerIqee,
                contribLifetime: result.newTrackerReeeContribLifetime,
                pseBalance: result.newPseBalance,
                paeBalance: result.newPaeBalance,
                remainingScee: result.remainingSceeGrants,
                remainingIqee: result.remainingIqeeGrants,
            };

            childGrossCost += result.childGrossCostAdd;
            childBenefits += result.childBenefitsAdd;
            childMonthlyCost += result.childMonthlyCostAdd;
            reeeContribMonthly += result.reeeContribAdd;
            withdrawalLiquid += result.withdrawalLiquidAdd;
            withdrawalREEE += result.withdrawalREEEAdd;
            reeePayoutMonthly += result.reeePayoutAdd;
            contribREEE += result.contribREEEAdd;
            contribLiquid += result.contribLiquidAdd;
            taxCurrentYear.divers += result.taxDiversAdd;
            result.lifeEventLogs.forEach(msg => logEvent(lifeEventsLog, msg));
            result.flowEventLogs.forEach(msg => logEvent(flowEventsLog, msg));
        });
        liquid = _childLiquid;
        reee = _childReee;
        monthlyIncome = _childMonthlyIncome;
        incomeAnna = _childIncomeAnna;

        const currentIsoMonth = loopIsoMonths[m];
        // Cycle 16 split: voyages + événements de vie + stress test → ./projection/monthlyEvents
        if (setup.travelMonthMask[m]) {
            applyTravelExpenses(travelGoals, currentIsoMonth, expenseMultiplier, {
                addExpense: (n) => { monthlyExpenses += n; },
                logFlow: (s, day?: number) => { if (!pointAllege) logEvent(flowEventsLog, s, day); },
            }, pointAllege);
        }
        if (setup.lifeEventMonthMask[m]) {
            applyLifeEvents(lifeEvents, currentIsoMonth, expenseMultiplier, propertiesState, {
                shockPortfolio: (f) => { celi *= f; reer *= f; nonReg *= f; crypto *= f; },
                addLiquid: (n) => { liquid += n; },
                addExpense: (n) => { monthlyExpenses += n; },
                adjustRealEstate: (eq, mort) => { realEstateEquity += eq; mortgageBalance += mort; },
                realizeCapitalDisposition: (rawGain) => {
                    const ms = { capitalLossBank, accCapitalGainsYear };
                    const result = applyCapitalDisposition(ms, rawGain);
                    capitalLossBank = ms.capitalLossBank;
                    accCapitalGainsYear = ms.accCapitalGainsYear;
                    return result;
                },
                logLife: (s, day?: number) => { if (!pointAllege) logEvent(lifeEventsLog, s, day); },
                logFlow: (s, day?: number) => { if (!pointAllege) logEvent(flowEventsLog, s, day); },
            }, pointAllege);
        }

        // Wiring 2026-05: FinancialGoal aux deadlines
        if (setup.goalMonthMask[m]) {
            const goalMutator = {
                withdrawFromAccount: (account: 'CELI' | 'REER' | 'NON-ENREG' | 'CRYPTO' | 'LIQUID', amount: number): number => {
                    let remaining = amount;
                    if (account === 'LIQUID' || account === 'NON-ENREG') {
                        const fromLiquid = Math.min(Math.max(0, liquid), remaining);
                        liquid -= fromLiquid; remaining -= fromLiquid;
                        withdrawalLiquid += fromLiquid;
                        if (remaining > 0 && account === 'NON-ENREG' && nonReg > 0) {
                            const fromNR = handleNonRegSale(remaining);
                            remaining -= fromNR;
                            withdrawalNonReg += fromNR;
                        }
                    } else if (account === 'CELI') {
                        const drawn = Math.min(celi, remaining);
                        celi -= drawn; celiWithdrawalsThisYear += drawn; remaining -= drawn;
                        withdrawalCELI += drawn;
                    } else if (account === 'REER') {
                        const drawn = Math.min(reer, remaining);
                        reer -= drawn; accRetraitsReerYear += drawn; remaining -= drawn;
                        accRetraitsReerYearByUser = addByWeights(accRetraitsReerYearByUser, drawn, reerByUser);
                        withdrawalREER += drawn;
                        retraitReerMois += drawn;
                    } else if (account === 'CRYPTO') {
                        const drawn = handleCryptoSaleLocal(remaining);
                        remaining -= drawn;
                        withdrawalCrypto += drawn;
                    }
                    return amount - remaining;
                },
                addExpense: (_n: number) => { /* déjà soustrait du compte ciblé */ },
                logFlow: (s: string, day?: number) => { if (!pointAllege) logEvent(flowEventsLog, s, day); },
                getNetWorth: currentRawNetWorth,
                onGoalEvaluated: (goalKey: string, met: boolean, shortfallReal: number, shortfallNominal: number) => {
                    if (goalKey) {
                        goalOutcomes[goalKey] = { met, shortfallReal, shortfallNominal };
                    }
                },
                onGoalShortfall: (_goalName: string, asked: number, drawn: number) => {
                    goalShortfallCount++;
                    goalShortfallTotal += Math.max(0, asked - Math.max(0, drawn));
                },
            };
            applyFinancialGoalDeadlines(financialGoals, currentIsoMonth, expenseMultiplier, goalMutator, pointAllege);
        }
        // [ENG-STRESSTEST-GROWTH-UNREGISTERED] Le krach et la reprise MUTENT les soldes — c'est bien
        // un mouvement de MARCHÉ, exactement comme le rendement mensuel. Ils n'alimentaient pourtant
        // AUCUN registre de flux : mesuré 371 782 $ de patrimoine apparus (puis disparus) sans
        // qu'aucun `MarketGrowth*` ne l'explique. La conservation du bilan restait verte — elle
        // compare des SOLDES entre eux et se moque de savoir si un flux justifie l'écart.
        //
        // ⚠️ Les deltas sont MÉMORISÉS ici et versés APRÈS `applyMonthlyGrowth` : ce dernier
        // ASSIGNE (`growthCELI = g.celi.growth`), il n'accumule pas. Les ajouter maintenant les
        // ferait écraser quelques centaines de lignes plus bas — silencieusement.
        let shockCELI = 0, shockREER = 0, shockNonReg = 0, shockCrypto = 0;
        const stressResult = computeStressTest(effProj, m);
        if (stressResult.crashFactor !== 1) {
            const f = stressResult.crashFactor - 1;
            shockCELI += celi * f; shockREER += reer * f;
            shockNonReg += nonReg * f; shockCrypto += crypto * f;
            celi *= stressResult.crashFactor; reer *= stressResult.crashFactor;
            nonReg *= stressResult.crashFactor; crypto *= stressResult.crashFactor;
            if (stressResult.log) logEvent(lifeEventsLog, stressResult.log);
        }
        if (stressResult.recoveryFactor !== 1) {
            // La reprise ne touche PAS le crypto (choix d'origine conservé) : ne rien inventer ici.
            const f = stressResult.recoveryFactor - 1;
            shockCELI += celi * f; shockREER += reer * f; shockNonReg += nonReg * f;
            celi *= stressResult.recoveryFactor; reer *= stressResult.recoveryFactor; nonReg *= stressResult.recoveryFactor;
        }

        let monthlyCashflow = monthlyIncome - monthlyExpenses;
        const targetEF = monthlyExpenses * simEFMonths;
        // V31: Coussin Passif — on laisse tomber l'EF à 50% avant de vendre des actifs
        const criticalThreshold = targetEF * 0.5;

        if (m === 1 && month1ActionPlan === null) month1ActionPlan = { monthlyCashflow, strategy };

        // Cycle 19 split: shortfall + excess allocation → ./projection/cashflowAllocation
        // [PV-1] build/apply factorisés en closures : le MÊME état (mêmes champs, même
        // recopie) sert à l'allocation régulière ET au sauvetage de découvert plus bas —
        // zéro risque de divergence de champs entre les deux appels.
        const buildCashState = (): CashflowState => ({
            liquid, celi, reer, celiapp, nonReg, nonRegACB, capitalLossBank, crypto, cryptoACB,
            celiRoom, rrspRoom, fhsaRoom,
            taxCurrentYearReer: taxCurrentYear.reer,
            accRetraitsReerYear, accCapitalGainsYear, accRrspYear, accFhsaYear,
            fhsaLifetimeContrib, celiWithdrawalsThisYear,
            retraitReerMois, rrspWithholdingMois, retraitCeliMois,
            withdrawalREER, withdrawalCELI, withdrawalNonReg, withdrawalCrypto,
            contribCELI, contribREER, contribNonReg, contribCELIAPP,
            shortfallMonths,
            uncoveredShortfall: 0,
            flowEventLogs: pointAllege ? EMPTY_STRING_LOGS : [],
        });
        const applyCashState = (cs: CashflowState): void => {
            liquid = cs.liquid; celi = cs.celi; reer = cs.reer;
            celiapp = cs.celiapp; nonReg = cs.nonReg; nonRegACB = cs.nonRegACB;
            capitalLossBank = cs.capitalLossBank; crypto = cs.crypto; cryptoACB = cs.cryptoACB;
            celiRoom = cs.celiRoom; rrspRoom = cs.rrspRoom; fhsaRoom = cs.fhsaRoom;
            taxCurrentYear.reer = cs.taxCurrentYearReer;
            if (cs.accRetraitsReerYear !== accRetraitsReerYear) {
                accRetraitsReerYearByUser = addByWeights(accRetraitsReerYearByUser, cs.accRetraitsReerYear - accRetraitsReerYear, reerByUser);
            }
            accRetraitsReerYear = cs.accRetraitsReerYear;
            accCapitalGainsYear = cs.accCapitalGainsYear;
            accRrspYear = cs.accRrspYear; accFhsaYear = cs.accFhsaYear;
            fhsaLifetimeContrib = cs.fhsaLifetimeContrib;
            celiWithdrawalsThisYear = cs.celiWithdrawalsThisYear;
            retraitReerMois = cs.retraitReerMois; rrspWithholdingMois = cs.rrspWithholdingMois; retraitCeliMois = cs.retraitCeliMois;
            withdrawalREER = cs.withdrawalREER; withdrawalCELI = cs.withdrawalCELI;
            withdrawalNonReg = cs.withdrawalNonReg; withdrawalCrypto = cs.withdrawalCrypto;
            contribCELI = cs.contribCELI; contribREER = cs.contribREER;
            contribNonReg = cs.contribNonReg; contribCELIAPP = cs.contribCELIAPP;
            shortfallMonths = cs.shortfallMonths;
            if (!pointAllege && cs.flowEventLogs.length > 0) {
                cs.flowEventLogs.forEach(msg => logEvent(flowEventsLog, msg));
            }
        };
        const cashflowCtxBase = {
            targetEF, criticalThreshold, isRetired, strategy,
            m, loopYear, enableMonteCarlo, activeUsersCount, survivorMode: soloHousehold,
            grossMarcBaseAnnual, grossAnnaBaseAnnual, simSalaryGrowth,
            incomeRetirement, accRentesYear, hasFuturePurchase, hasPurchasedPrimary,
            contributionOrder: overrides.contributionOrder, debtFirst: overrides.debtFirst,
            skipLogs: pointAllege,
        };
        const shortfallMonthsAtMonthStart = shortfallMonths;

        const cashState = buildCashState();
        processCashflowAllocation(
            cashState,
            { monthlyCashflow, ...cashflowCtxBase },
            activeDebts,
            calculateFiscalReport,
            calculateGrossWithholdingRRSP,
        );
        applyCashState(cashState);
        if (cashState.uncoveredShortfall > 1) {
            liquidDebt += cashState.uncoveredShortfall;
            uncoveredThisMonth += cashState.uncoveredShortfall;
            if (!pointAllege) {
                logEvent(flowEventsLog, `⚠️ Dépense non couverte (comptes de décaissement épuisés) : ${formatCAD(Math.round(cashState.uncoveredShortfall))} — portée en dette`);
            }
        }

        // Cycle 15 split: REER Meltdown → ./projection/meltdownReer
        const meltResult = processReerMeltdown(
            { m, isRetired, simSalaryGrowth, taxFilers, incomeRetirement,
              accRetraitsReerYear, accRentesYear, grossMarcBaseAnnual,
              grossAnnaBaseAnnual: soloHousehold ? 0 : grossAnnaBaseAnnual,
              reer, nonReg, celi, realEstateEquity, skipLogs: pointAllege },
            strategy,
        );
        if (meltResult) {
            reer -= meltResult.reerDrawn;
            nonReg += meltResult.nonRegAdd;
            nonRegACB += meltResult.nonRegAdd;
            // FISC-REER-WHT-DOUBLE (2026-06-16) : la retenue est un ACOMPTE d'impôt payé en avril via
            // le bucket .reer (ci-dessous). On la conserve au patrimoine (liquide) jusque-là — sinon le
            // brut sort du REER, seul le net entre en nonReg, et avril re-débite la retenue = double
            // comptage. Avec cette ligne le meltdown est NW-neutre (reer −brut, nonReg +net, liquid
            // +retenue), et la retenue n'est débitée qu'UNE fois (avril). Cohérent avec drawReer/CF-2.
            liquid += meltResult.withholding;
            // [WHT-DISPLAY-MELTDOWN + ENG-MELTDOWN-FLOW-INVISIBLE] (findings MESURÉS 2026-07-31)
            // Le meltdown est un RETRAIT REER comme les autres : il alimente les compteurs
            // d'AFFICHAGE comme les tirages en cascade — sinon (1) `totalTaxesPaid` suivait une
            // convention DIFFÉRENTE des autres stratégies (mesuré sur le scénario du test :
            // ratio MELTDOWN/AUTO 0,601 → 1,400) et `strategyRanking` recommandait MELTDOWN_REER
            // à tort sous l'objectif « impôt » (corrigé, mesuré) ; (2) `chartData.RetraitREER`
            // rendait ~96 % des sorties invisibles (30 496 $ affichés pour 794 303 $ tirés).
            // Aucun impact NW : PROUVÉ bit-identique (301 mois × 9 grandeurs, 2 worktrees).
            // NB : depuis [PROJ-TTP-DOUBLECOUNT] (2026-08-01), `rrspWithholdingMois` n'entre PLUS
            // dans totalTaxesPaid (l'impôt arrive au compteur via le débit d'avril du bucket
            // .reer, une seule fois) et n'atteint PAS chartData (vérifié par grep — panel #554) :
            // son seul rôle restant est le re-crédit CF-2 de cashflowAllocation (NW-neutralité).
            retraitReerMois += meltResult.reerDrawn;
            // [ENG-NETTRANSFER-REER-INCOMPLET] Registre des TRANSFERTS, oublié ici alors que la FERR
            // l'a reçu le 2026-08-19 (`[ENG-FERR-NETTRANSFER-MUET]`) : le meltdown est un retrait
            // REER comme les autres, il doit apparaître dans le flux PUBLIÉ `NetTransferREER`.
            // MESURÉ sous la stratégie MELTDOWN_REER : le solde REER chutait de 34 794 $ en un mois
            // pour 802 $ de flux publiés (pire résiduel 35 596,32 $), soit 1 849 080,59 $ d'écart
            // cumulé entre `RetraitREER` (affichage) et `ContribREER − NetTransferREER` (transferts)
            // sur 156 mois de retrait. Après : 0,10 $ (arrondi au cent).
            // ⚠️ Contrairement à la FERR, ce montant N'EST PAS exclu de `stepReerByUser` : la FERR
            // sort de la part EXACTE de chaque conjoint (facteur RRIF de SON âge), alors que le
            // meltdown est attribué AU PRORATA (`addByWeights` ci-dessous). Le soustraire au prorata
            // dans le registre per-conjoint est donc la MÊME règle, pas une seconde.
            // [ENG-MELTDOWN-JAMBE-ARRIVEE] (lot 157) La jambe d'ARRIVÉE est publiée via le
            // registre dédié — PAS via `contribNonReg` (qui est aussi un affichage publié).
            // [ENG-MELTDOWN-MIMOIS] (décision Marc 2026-09-04) : ce registre est AUSSI passé à
            // `growthApplication` pour exclure l'arrivée du mois plein de croissance — le
            // rendement fantôme de mi-mois est corrigé (les goldens NEUTRALITÉ ont été re-basés
            // SCIEMMENT avec la mesure dans le commit du lot).
            arriveeMeltdownNonReg += meltResult.nonRegAdd;
            withdrawalREER += meltResult.reerDrawn;
            rrspWithholdingMois += meltResult.withholding;
            accRetraitsReerYear += meltResult.reerDrawn;
            // 5e source de retrait REER (audit fiscal-accuracy) : attribuer le meltdown par conjoint
            // comme FERR/goals/cashflow, sinon Σ(byUser) < accRetraitsReerYear → sous-imposition sous
            // le scénario MELTDOWN_REER (l'opposé du but de la Phase 2).
            accRetraitsReerYearByUser = addByWeights(accRetraitsReerYearByUser, meltResult.reerDrawn, reerByUser);
            taxCurrentYear.reer += meltResult.withholding;
            if (!pointAllege && meltResult.log) logEvent(flowEventsLog, meltResult.log);
        }

        // Cycle 11 split: December tax filing → ./projection/taxCycle.processDecemberTaxFiling
        // [FISC-DEC-FLUX-ASSIETTE-TIMING] (décision Marc 2026-09-05, réponse 15 : CORRIGER) Ce bloc
        // vivait AVANT la cascade d'allocation, le meltdown, l'immobilier (RAP) et les objectifs du
        // MÊME décembre : il lisait `accRetraitsReerYear`, `taxCurrentYear` et les autres
        // accumulateurs annuels avant qu'ils ne soient alimentés, puis janvier les remettait à zéro —
        // les retraits REER de décembre n'entraient dans l'assiette d'AUCUNE année (fuite d'assiette,
        // pas une convention de calendrier). Déplacé en FIN de mois, après le dernier producteur
        // (le meltdown ; le transfert NonReg → CELI/REER qui suit ne produit ni retrait ni revenu).
        // Mesuré (banc `scripts/mesureOrdreBoucle.ts`, clef `dec_fin_de_mois`) : totalTaxesPaid
        // +25 568 $ (retraités AUTO), +14 751 $ (MELTDOWN), −2 991 $ (couple actif : les cotisations
        // REER de décembre sont enfin déduites l'année où elles sont faites), ≈ 0 $ (droits saturants).
        // L'ordre est gardé par `tests/services/projection.engineOrder.test.ts` (assertion INVERSÉE
        // avec son histoire) — le remettre en haut de boucle rouvrirait la fuite en silence.
        if (currentMonthIndex === 11 && m > 0) {
            const yearsElapsed = Math.floor(m / 12);
            const inflationFactor = Math.pow(1 + simInflation / 100, yearsElapsed);
            // FA-10 — `taxFilers` (déclaré en tête d'itération) : nombre de CONTRIBUABLES du ménage.
            // Sert ici à la récolte de gains (palier ×1) ET au dépôt fiscal ci-dessous.
            // [ENG-DIVORCE-REGISTRE-PERCONJOINT] DEUX portes y mènent : le décès et le DIVORCE. Le
            // divorce était fiscalement INERTE — mesuré : Δ impôt = 0 $ EXACT sur 30 ans, alors que
            // la différence entre 1 et 2 contribuables vaut ~187 k$ d'impôt cumulé.

            // Levier « récolte de gains » (timing) : réalise des gains non-enreg latents dans une
            // année à faible revenu pour remplir le 1er palier (ACB relevé). À FAIRE AVANT le dépôt
            // fiscal de décembre → le gain réalisé entre dans accCapitalGainsYear et est imposé CETTE
            // année (au taux bas), sans fuite (l'ACB monte du montant imposé).
            // FA-10 : palier du SURVIVANT seul (×1) et sans le salaire fantôme du défunt — sinon le
            // levier récoltait avec une marge de palier doublée par un contribuable mort.
            const ghOtherNominal = isRetired
                ? (incomeRetirement * 12 + accRentesYear + accRetraitsReerYear)
                : (grossMarcBaseAnnual + (soloHousehold ? 0 : grossAnnaBaseAnnual)) * Math.pow(1 + simSalaryGrowth / 100, yearsElapsed);
            const gh = overrides.gainHarvesting
                ? processGainHarvesting({
                    enabled: true,
                    nonReg, nonRegACB, otherTaxableNominal: ghOtherNominal,
                    existingGainsNominal: accCapitalGainsYear, activeUsersCount: taxFilers, loopYear,
                    capitalLossBank, skipLogs: pointAllege,
                })
                : { harvestedGain: 0, consumedLoss: 0, logMsg: undefined };
            if (gh.harvestedGain > 0) {
                accCapitalGainsYear += gh.harvestedGain - gh.consumedLoss;
                capitalLossBank -= gh.consumedLoss;
                nonRegACB += gh.harvestedGain;
                if (!pointAllege && gh.logMsg) logEvent(flowEventsLog, gh.logMsg);
            }

            const decResult = processDecemberTaxFiling(
                currentMonthIndex,
                {
                    m, loopYear, isRetired, enableMonteCarlo,
                    yearsElapsed, inflationFactor,
                    activeUsersCount: taxFilers,
                    grossMarcBaseAnnual,
                    grossAnnaBaseAnnual: soloHousehold ? 0 : grossAnnaBaseAnnual,
                    simSalaryGrowth,
                    optimizeSourceDeductions: false,
                    incomeRetirementMonthly: incomeRetirement,
                    incomeRetirementGisMonthly: incomeRetirementGis,
                    incomeRetirementPerUserMonthly: soloHousehold ? undefined : incomeRetirementPerUser,
                    incomeRetirementDbPerUserMonthly: dbPerUserMonthly(),
                    nonReg, baseNonRegRate: yearBaseRates.nonReg,
                    accRrspYear, accFhsaYear, smithInterestDeductibleYear,
                    accRentesYear, accRetraitsReerYear, accCapitalGainsYear,
                    accRetraitsReerYearByUser: soloHousehold ? undefined : accRetraitsReerYearByUser,
                    age,
                    ageSpouse: !soloHousehold ? ageSpouseProjete : undefined,
                    childrenCount: activeChild.length,
                    ramqExemptAdultsCount: soloHousehold
                        ? (config.users[0]?.hasPrivateDrugInsurance ? 1 : 0)
                        : config.users.filter(u => u?.hasPrivateDrugInsurance).length,
                    enablePensionSplitting: effProj.appliedPensionSplitting !== false,
                    skipLogs: pointAllege,
                },
                { calculateFiscalReport, getMarginalRate, calculateDividendTax, getDividendGrossUpRate },
                taxCurrentYear,
            );
            taxCurrentYear = decResult.newTaxCurrentYear;
            nonRegACB += decResult.nonRegACBAdd;
            reconciledUnsettledTax = (Number.isFinite(taxCurrentYear.revenu) ? taxCurrentYear.revenu : 0)
                + (Number.isFinite(taxCurrentYear.gains) ? taxCurrentYear.gains : 0)
                + (Number.isFinite(taxCurrentYear.divers) ? taxCurrentYear.divers : 0)
                + (Number.isFinite(taxCurrentYear.reer) ? taxCurrentYear.reer : 0);
            if (!pointAllege && decResult.logs.length > 0) {
                decResult.logs.forEach(msg => logEvent(flowEventsLog, msg));
            }

            capitalGainsRealizedThisYear = accCapitalGainsYear;

            if (isRetired && age >= PENSION_SPLIT_MIN_AGE) {
                const oasBeneficiaries = soloHousehold ? 1 : activeUsersCount;
                const gisShare = incomeRetirementGis / Math.max(1, oasBeneficiaries);
                const oasResult = computeOasClawback(
                    currentMonthIndex, m, isRetired, age, expenseMultiplier,
                    incomeRetirement - incomeRetirementGis, accRetraitsReerYear, accRentesYear,
                    psvBasePension, simInflation,
                    oasBeneficiaries,
                    soloHousehold ? undefined : incomeRetirementPerUser.map((v) => v - gisShare),
                    soloHousehold ? undefined : accRetraitsReerYearByUser,
                    capitalGainsRealizedThisYear,
                    pensionPSV - incomeRetirementGis,
                    computeAnnualNonRegDividends(nonReg, yearBaseRates.nonReg ?? 0) * getDividendGrossUpRate('eligible'),
                    pointAllege,
                );
                oasClawbackNextPeriod = oasResult.clawbackAnnual;
                if (!pointAllege && oasResult.logMsg) flowEventsLog.push(oasResult.logMsg);
            }

            accCapitalGainsYear = 0;
            smithInterestDeductibleYear = 0;
            accRrspYear = 0;
            accFhsaYear = 0;

            taxPreviousYear = { ...taxCurrentYear };
            taxCurrentYear = { revenu: 0, gains: 0, reer: 0, divers: 0, donCredit: 0 };

            const currentNonRegRate = (enableMonteCarlo || historicalSequence !== null) ? mcNonRegRate : yearBaseRates.nonReg;
            const tlhResult = processTaxLossHarvesting(currentMonthIndex, m, nonReg, nonRegACB, currentNonRegRate, pointAllege);
            if (tlhResult.harvestedLoss > 0) {
                capitalLossBank += tlhResult.harvestedLoss;
                nonRegACB += tlhResult.acbDelta;
                if (!pointAllege && tlhResult.logMsg) logEvent(flowEventsLog, tlhResult.logMsg);
            }
        }

        // Transfert NonReg → CELI/REER si espace
        // [ENG-INV-FLUXFORM-COVERAGE] Ce bloc VEND du non-enregistré pour remplir les droits
        // disponibles — un vrai mouvement d'argent entre deux comptes de l'utilisateur — et ne
        // publiait AUCUN flux : ni `withdrawalNonReg`, ni `contribCELI`, ni `contribREER`. Mesuré
        // sur un scénario ordinaire (stress-test désactivé) : 51 197 $ de variation de NonReg
        // inexpliquée en un mois, et 26 458 $ côté REER. Les gardes de conservation restaient
        // VERTES — elles comparent des soldes entre eux et ne demandent jamais « quel flux
        // justifie cet écart ». D'où la garde de forme-flux qui accompagne ce correctif.
        // ⚠️ `accRrspYear` était DÉJÀ alimenté (le suivi fiscal était juste) : seul l'AFFICHAGE des
        // flux mentait. C'est précisément ce qui rendait le défaut indétectable côté impôt.
        if (nonReg > 0) {
            if (celiRoom > 0) {
                const a = Math.min(nonReg, celiRoom); const s = handleNonRegSale(a);
                celi += s; celiRoom -= s;
                withdrawalNonReg += s; contribCELI += s;
            }
            if (rrspRoom > 0 && nonReg > 0 && !isRetired) {
                const a = Math.min(nonReg, rrspRoom); const s = handleNonRegSale(a);
                reer += s; rrspRoom -= s; accRrspYear += s;
                withdrawalNonReg += s;
                // ⚠️ `contribREER` alimente AUSSI `stepReerByUser` (registre REER per-conjoint,
                // celui qui a produit deux NO-GO de panel) — d'où une MESURE avant de le toucher.
                // Résultat : effet NUL. Patrimoine final ET `reerByUserFinal` bit-identiques sur
                // 3 stratégies avec salaires très inégaux (8 200 $ vs 3 100 $/mois) :
                // `[714314, 270046]` des deux côtés. La raison est structurelle — `stepReerByUser`
                // réconcilie sur `poolEnd: reer`, donc la cotisation était DÉJÀ absorbée, avec
                // exactement les mêmes parts salariales. Ce `+=` ne change que la PUBLICATION du
                // flux, pas l'attribution. (J'avais d'abord écrit ici que l'attribution « devenait
                // juste » : la mesure a réfuté cette affirmation.)
                contribREER += s;
            }
        }

        // [PV-1] Sauvetage du liquide négatif (choix Marc 2026-06-10 : cascade de vente).
        // Des débits DIRECTS du liquide (impôt d'avril taxApril.ts, véhicules/rénos W5,
        // échéances d'objectifs) peuvent le rendre négatif sans passer par le cashflow ;
        // applyMidMonthGrowth clampait ensuite à 0 (helpers.ts `Math.max`) → la dette était
        // EFFACÉE et le patrimoine surévalué (jusqu'à plusieurs centaines de k$ sur 30 ans).
        // Correctif : dernier point AVANT la croissance — si le liquide est négatif, on
        // couvre le découvert par la MÊME cascade que le shortfall régulier (stratégie de
        // retrait respectée, retenue REER comptée via taxCurrentYearReer, garde-fous PBMA/OAS).
        // Avec liquid=0 en entrée, la cascade ne puise pas sous zéro et son invariant CF-2 ramène le
        // liquide à la retenue REER prélevée (acompte d'impôt conservé jusqu'à avril, cf FISC-REER-WHT-
        // DOUBLE) : les ventes financent exactement le découvert (net), la retenue reste au patrimoine.
        // Cas insolvable (comptes épuisés ou cap OAS) : résiduel JOURNALISÉ, VISIBLE (flowEvents +
        // shortfallMonths) ET désormais PORTÉ EN DETTE [PV-6] (`liquidDebt`, soustrait du patrimoine
        // net mensuel et successoral) — plus d'absorption silencieuse qui surévaluait le patrimoine.
        if (liquid < -0.5) {
            const overdraft = -liquid;
            liquid = 0;
            const rescueState = buildCashState();
            const assetsBeforeRescue = rescueState.celi + rescueState.reer + rescueState.nonReg + rescueState.crypto;
            const withholdingBeforeRescue = rescueState.taxCurrentYearReer;
            processCashflowAllocation(
                rescueState,
                { monthlyCashflow: -overdraft, ...cashflowCtxBase },
                activeDebts,
                calculateFiscalReport,
                calculateGrossWithholdingRRSP,
            );
            applyCashState(rescueState);
            // Couvert (net) = baisse brute des actifs − retenue REER comptabilisée à part.
            const grossDrawn = assetsBeforeRescue - (celi + reer + nonReg + crypto);
            const covered = grossDrawn - (taxCurrentYear.reer - withholdingBeforeRescue);
            const residual = overdraft - covered;
            if (!pointAllege) {
                logEvent(flowEventsLog, `🏦 Découvert de liquidités couvert par vente de placements : ${formatCAD(Math.round(Math.min(covered, overdraft)))} sur ${formatCAD(Math.round(overdraft))}`);
            }
            if (residual > 1) {
                liquidDebt += residual; // [PV-6] porté en dette (plus absorbé silencieusement)
                uncoveredThisMonth += residual;
                if (!pointAllege) {
                    logEvent(flowEventsLog, `⚠️ Découvert NON couvert (comptes insuffisants) : ${formatCAD(Math.round(residual))} — porté en dette`);
                }
            }
            // Un seul incrément de shortfallMonths par mois, même si l'allocation régulière
            // ET le sauvetage ont chacun constaté un déficit.
            shortfallMonths = Math.min(shortfallMonths, shortfallMonthsAtMonthStart + 1);
        }

        // Cycle 18 split: glidepath + taux effectifs → ./projection/glidepathRates
        const gr = computeGlidepathRates({
            m, retirementMonthIndex, isRetired, simInflation, enableMonteCarlo,
            mcCeliRate, mcReerRate, mcNonRegRate, mcCryptoRate, mcCashRate, baseRates: yearBaseRates,
            usEquityShareCeli: activeValoriaSchedule ? activeValoriaSchedule.usShareCeliPct : effProj.usEquityShareCeli,
            usEquityDividendYield: activeValoriaSchedule ? activeValoriaSchedule.usDivYieldCeliPct : effProj.usEquityDividendYield,
            hasHistoricalSequence: historicalSequence !== null,
        });
        const { effectiveCeliRate, effectiveReerRate, effectiveNonRegRate, activeCeliRate, activeCryptoRate, activeCashRate } = gr;

        // F16 — REEE : calcul des compartiments PSE (capital) et PAE (subventions + rendements)
        const totalPse = Object.values(reeeTracker).reduce((s, t) => s + (t.pseBalance ?? 0), 0);
        const totalPae = Object.values(reeeTracker).reduce((s, t) => s + (t.paeBalance ?? 0), 0);

        // Cycle 24 split: croissance mensuelle 7 actifs → ./projection/growthApplication
        const g = applyMonthlyGrowth({
            prevCELI, celi, effectiveCeliRate,
            celiapp, activeCeliRate,
            prevREER, reer, effectiveReerRate,
            nonReg, contribNonReg, arriveeMeltdownNonReg, effectiveNonRegRate,
            crypto, activeCryptoRate,
            prevLiquid, liquid, activeCashRate,
            reee, contribREEE,
            pseBalance: totalPse,
            paeBalance: totalPae,
        });
        celi = g.celi.newVal; growthCELI = g.celi.growth; growthPctCELI = g.celi.pct;
        celiapp = g.celiapp.newVal; growthCELIAPP = g.celiapp.growth; growthPctCELIAPP = g.celiapp.pct;
        reer = g.reer.newVal; growthREER = g.reer.growth; growthPctREER = g.reer.pct;
        // Registre REER par conjoint : retrait pro-rata, cotisation par part salariale, croissance
        // (et RAP/meltdown) absorbées pro-rata par la réconciliation au solde commun final `reer`.
        reerByUser = stepReerByUser(reerByUser, { withdrawal: withdrawalREER - ferrWithdrawalMois - divorceReerWithdrawalMois, contribution: contribREER, poolEnd: reer, shares: reerShares });
        nonReg = g.nonReg.newVal; growthNonReg = g.nonReg.growth; growthPctNonReg = g.nonReg.pct;
        crypto = g.crypto.newVal; growthCrypto = g.crypto.growth; growthPctCrypto = g.crypto.pct;
        liquid = g.liquid.newVal; growthLiquid = g.liquid.growth; growthPctLiquid = g.liquid.pct;
        reee = g.reee.newVal; growthREEE = g.reee.growth; growthPctREEE = g.reee.pct;
        totalGrowth += g.totalGrowth;

        // F16 : la croissance de placement mensuelle du REEE est créditée aux poches PAE des enfants
        if (g.reee.growth !== 0 && (totalPse + totalPae) > 0) {
            for (const cId of Object.keys(reeeTracker)) {
                const tr = reeeTracker[cId];
                const childTot = (tr.pseBalance ?? 0) + (tr.paeBalance ?? 0);
                if (childTot > 0) {
                    const share = childTot / (totalPse + totalPae);
                    tr.paeBalance = Math.max(0, (tr.paeBalance ?? 0) + g.reee.growth * share);
                }
            }
        }

        // [ENG-STRESSTEST-GROWTH-UNREGISTERED] Versement des deltas de choc/reprise APRÈS les
        // assignations ci-dessus (qui écrasent). `+=` et non `=` : un mois peut porter les deux.
        // Le choc entre dans `MarketGrowth*` parce que c'en EST un — un krach est un rendement
        // négatif, pas une catégorie à part. Hors stress-test, tous ces deltas valent 0 : la
        // rétrocompat est bit-identique.
        if (shockCELI !== 0) { growthCELI += shockCELI; totalGrowth += shockCELI; }
        if (shockREER !== 0) { growthREER += shockREER; totalGrowth += shockREER; }
        if (shockNonReg !== 0) { growthNonReg += shockNonReg; totalGrowth += shockNonReg; }
        if (shockCrypto !== 0) { growthCrypto += shockCrypto; totalGrowth += shockCrypto; }

        if (isRetired) {
            retirementMonthsEvaluated++;
            const safeCpi = Math.max(1e-9, cumulativeCpiMultiplier);
            const fundedNominal = Math.max(0, monthlyExpenses - uncoveredThisMonth);
            retFundedRealSum += fundedNominal / safeCpi;
            const finGrowth = growthCELI + growthREER + growthNonReg + growthCrypto + growthLiquid + growthCELIAPP;
            const finEnd = Math.max(0, liquid + celi + celiapp + reer + nonReg + crypto);
            const finBase = Math.max(0, finEnd - finGrowth);
            const realFactor = computeRetirementRealReturnFactor(finGrowth, finBase, currentInflation);
            retAnnuityFvFactor = retAnnuityFvFactor * realFactor + 1;
        }
        // [PROJ-TTP-DOUBLECOUNT] (panel #551, MESURÉ au cent — corrigé 2026-08-01) « Impôt à vie »
        // = Σ des flux d'impôt réellement DÉBITÉS du liquide, c'est-à-dire `fluxImpots` SEUL :
        // avril débite le bucket `.reer` ENTIER (taxApril.ts — retenues cascade + meltdown + FERR,
        // toutes provisionnées dedans) + `.revenu` (le COMPLÉMENT de décembre). Les retenues ne
        // sont « débitées qu'UNE fois, en avril » (contrat FISC-REER-WHT-DOUBLE,
        // cashflowAllocation.ts : le brut reste au patrimoine jusqu'au règlement) — ajouter
        // `rrspWithholdingMois` et `taxOnRrif` ici RE-COMPTAIT donc les mêmes dollars (mesuré :
        // MELTDOWN 321 122 $ affichés pour 131 871 $ réels, +144 % ; AUTO 229 338 $ pour
        // 29 806 $). L'ancien raisonnement (« décembre n'ajoute que le complément ») protégeait
        // l'ASSIETTE, pas le compteur : le complément ET les acomptes passent tous deux par avril.
        // Borne assumée : les acomptes de la DERNIÈRE année (sans avril suivant) ne sont pas
        // comptés — vision cash honnête ; la succession a son propre `totalEstateTax`.
        totalTaxesPaid += fluxImpots;
        totalExpenses += monthlyExpenses;

        // Patrimoine net = actifs − TOUTES les dettes. realEstateEquity est DÉJÀ net
        // d'hypothèque (pas de re-soustraction de mortgageBalance). On soustrait :
        //   • liquidDebt          — découvert non couvert porté en dette [PV-6]
        //   • smithManoeuvreDebt  — HELOC du levier Smith (l'actif réinvesti est dans NonReg,
        //                           déjà compté → sans cette soustraction, NW gonflé du HELOC)
        //   • activeDebtsTotal    — prêts/cartes/auto PRÉEXISTANTS (sinon le solde dû surévalue
        //                           le patrimoine ET rembourser le principal érode le NW au plein
        //                           paiement au lieu du seul intérêt — money-critical, 2026-06-16).
        // Cohérent avec la succession (estateCalculation : finalRawNetWorth).
        const activeDebtsTotal = sumActiveDebts();
        const rawNetWorth = currentRawNetWorth();
        if (rawNetWorth < minNetWorth) minNetWorth = rawNetWorth;

        // V23 Fix 1: FIRE comparaison en dollars futurs (inflation-ajustée ; alignée sur CPI cumulée sous MC/régimes)
        const useStochCpi = enableMonteCarlo || historicalSequence !== null || macroState !== null;
        const futureFireTarget = fireTargetNetWorth * (useStochCpi ? cumulativeCpiMultiplier : Math.pow(1 + simInflation / 100, m / 12));
        if (!hasHitFire && rawNetWorth >= futureFireTarget) {
            if (!pointAllege) logEvent(lifeEventsLog, FIRE_LIFE_EVENT);
            hasHitFire = true;
        }
        if (firstFireAge === null && futureFireTarget > 0 && Number.isFinite(rawNetWorth) && rawNetWorth >= futureFireTarget) {
            firstFireMonthIndex = m;
            firstFireAge = currentAge + m / 12;
        }

        if (pointAllege) {
            if (netWorthBuf) {
                netWorthBuf[m] = round2(rawNetWorth);
                netWorthBufLen = m + 1;
            } else {
                data.push({ NetWorth: round2(rawNetWorth), monthIndex: m } as ProjectionChartPoint);
            }
            continue;
        }

        let impotLatent = 0;
        let reeeContribCum = 0;
        let reeeGrantsCum = 0;
        let dividendIncome = 0;
        let taxableInvIncome = 0;
        let marginalTaxRate = 0;
        let effectiveTaxRate = 0;
        if (!pointAllege) {
            // Cycle 17 split: impôt latent → ./projection/latentTax
            // FISC-LATENT-RE — inclure le gain latent des immeubles LOCATIFS (RP exclue, exempte au décès),
            // pour cohérence avec le bilan successoral (même Σ que realEstateLatentGain plus bas, estateCalculation).
            const realEstateLatentGainNow = propertiesState
                .filter(p => p.isBought && !p.isSold && !p.isPrimaryResidence)
                .reduce((s, p) => s + Math.max(0, p.currentValue - (p.cost ?? 0)), 0);
            impotLatent = computeLatentTax(
                // [ENG-DIVORCE-LATENTTAX] `activeUsersCount` est ici un NOMBRE DE DÉCLARANTS : il
                // divise le revenu pour calculer l'impôt d'UNE déclaration, puis le remultiplie. Après
                // un divorce, tout le patrimoine latent pèse sur UNE seule déclaration, donc sur des
                // paliers plus élevés. Passer 2 lissait la facture sur deux têtes fictives — mesuré :
                // impôt latent −337 063 $ au lieu de −390 189 $, soit **53 126 $ sous-estimés**, et un
                // patrimoine net d'impôt affiché d'autant trop haut.
                // Même famille que `taxFilers` (dépôt fiscal) et `taxJanuary` : ces trois-là doivent
                // dire la même chose, sinon la prochaine correction n'en bougera qu'une.
                { m, loopYear, simInflation, simSalaryGrowth, isRetired, activeUsersCount: taxFilers,
                  grossMarcBaseAnnual,
                  // Le salaire d'un ex-conjoint parti ne fait plus partie de l'assiette — même motif
                  // qu'au dépôt de décembre et au meltdown REER.
                  grossAnnaBaseAnnual: soloHousehold ? 0 : grossAnnaBaseAnnual,
                  accRentesYear, incomeRetirement,
                  // [FISC-BANDES-FRERES-SANS-AGEOPTS] Âges des DÉCLARANTS, même expression qu'au
                  // dépôt de décembre (`ages = [ctx.age, ctx.ageSpouse]`) : sans eux, l'impôt latent
                  // ignorait les crédits d'âge et sous-estimait la dette fiscale de ~1 854 $ par
                  // déclarant de 65 ans et plus. Le tableau suit `taxFilers` : après un décès ou un
                  // divorce, il ne reste qu'une déclaration, donc qu'un âge.
                  ages: soloHousehold ? [age] : [age, ageSpouseProjete],
                  // [FISC-LATENT-PENSION-CREDIT] L'assiette du crédit pour revenu de retraite, par
                  // la MÊME source unique que le dépôt de décembre. Les DEUX moitiés voyagent depuis
                  // le lot 200 : la rente DB (mensuelle nominale) et les retraits FERR de l'année
                  // (`ferrAnnualByUser`, fixés en janvier — jamais l'accumulateur année-à-date, qui
                  // rendrait l'écran dépendant du mois de lancement). Même effondrement solo que `ages`.
                  dbPensionPerUserMonthly: dbPerUserMonthly(),
                  ferrAnnualPerUser: soloHousehold ? [ferrAnnualByUser[0]] : ferrAnnualByUser,
                  reer, nonReg, nonRegACB, crypto, cryptoACB, realEstateLatentGain: realEstateLatentGainNow, enableMonteCarlo },
                calculateFiscalReport,
            );

            // Centralisation Phase 3 Tier 2 — cumul REEE (somme sur tous les enfants)
            reeeContribCum = Object.values(reeeTracker).reduce((s, t) => s + (t.contribLifetime ?? 0), 0);
            reeeGrantsCum = Object.values(reeeTracker).reduce((s, t) => s + (t.scee ?? 0) + (t.iqee ?? 0), 0);

            // Centralisation Phase 3 Tier 3 — dividendes mensuels + revenus de
            // placement imposables (50% des gains capital + 100% des dividendes).
            // Approximation : rendement non-reg × 30% × balance, divisé par 12.
            // [FISC-DIV-DERIVED-BASES] 3e copie de la formule remplacée par la source unique.
            dividendIncome = computeAnnualNonRegDividends(nonReg, yearBaseRates.nonReg ?? 0) / 12;
            taxableInvIncome = dividendIncome + (accCapitalGainsYear * CAPITAL_GAINS_INCLUSION_STANDARD) / 12;

            // Phase 3 Tier 3 — taux d'imposition marginal et effectif (PAR ADULTE)
            // Source : calculateFiscalReport sur le revenu brut annuel courant.
            // En retraite : on combine pensions + retraits REER pour le calcul.
            // [ENG-DIVORCE-DISPLAY-RATES] Après un divorce, ce taux AFFICHÉ additionnait encore les deux
            // salaires puis divisait par 2 : il montrait le taux d'un ménage qui n'existe plus. Les deux
            // gestes du lot s'appliquent ici comme partout — `taxFilers` au dénominateur, salaire de
            // l'ex retiré du numérateur. C'est une sortie d'AFFICHAGE (taux marginal/effectif du point
            // mensuel), pas une assiette de calcul : rien d'autre n'en dépend.
            const grossHouseholdAnnual = grossMarcBaseAnnual + (soloHousehold ? 0 : grossAnnaBaseAnnual);
            const grossPerUserAnnual = isRetired
                ? (incomeRetirement * 12 + accRetraitsReerYear) / Math.max(1, taxFilers)
                : grossHouseholdAnnual / Math.max(1, taxFilers);
            const fiscalReportTier3 = grossPerUserAnnual > 0
                ? calculateFiscalReport(grossPerUserAnnual, 0, 0, loopYear, true /* skip breakdown pour perf */)
                : null;
            marginalTaxRate = fiscalReportTier3 ? fiscalReportTier3.marginalRate * 100 : 0;
            effectiveTaxRate = fiscalReportTier3 ? fiscalReportTier3.averageRate : 0;
        }

        // Cycle 21 split: assemblage data.push → ./projection/monthlyOutput
        data.push(buildMonthlyDataPoint({
            m, retirementMonthIndex, fireTargetNetWorth, futureFireTarget,
            simInflation, expenseMultiplier, effectiveBaseExpenses, enableMonteCarlo,
            verboseMonthlyPoints: diagnostics.verboseMonthlyPoints,
            rawNetWorth, currentLoopDate, loopYear, age, isRetired,
            incomeMarc, incomeAnna, incomeRetirement, monthlyIncome, monthlyExpenses,
            childMonthlyCost, childGrossCost, childBenefits,
            reeeContribMonthly, reeePayoutMonthly,
            reeeContribCum, reeeGrantsCum,
            dividendIncome, taxableInvIncome,
            marginalTaxRate, effectiveTaxRate,
            pensionRRQ, pensionPSV, pensionPrivee,
            immoHypo, immoCharges, immoInterest, immoPrincipal, totalRentalIncome,
            liquid, celi, celiapp, reer, reee, nonReg, crypto,
            retraitReerMois, retraitCeliMois, celiRoom, rrspRoom, fhsaRoom,
            rapRepaymentDueTotal, realEstateEquity, mortgageBalance, activeDebtsTotal,
            privateBusinessValue,
            liquidDebt, smithManoeuvreDebt,
            prevNW, prevCELI, prevREER, prevLiquid,
            impotLatent, fluxImpots, impotReerMois, impotSalaireMois, impotGainsMois, impotDiversMois,
            taxPaidRevenu, taxPaidGains, taxPaidDivers, taxPaidREER, taxOnRrif,
            contribCELI, withdrawalCELI, contribREER, withdrawalREER,
            contribNonReg, withdrawalNonReg, arriveeMeltdownNonReg, contribCrypto, withdrawalCrypto,
            contribCELIAPP, withdrawalCELIAPP,
            contribREEE, withdrawalREEE,
            growthCELI, growthREER, growthNonReg, growthCrypto, growthLiquid, growthCELIAPP, growthREEE,
            growthPctCELI, growthPctREER, growthPctNonReg, growthPctCrypto, growthPctLiquid, growthPctCELIAPP, growthPctREEE,
            taxCurrentYear, taxPreviousYear,
            lifeEventsLog, flowEventsLog, eventDaysLog,
        }));
    }

    // Cycle 26 split: bilan successoral → ./projection/estateCalculation
    // RE-GAIN-SUCC — gain latent des immeubles LOCATIFS non vendus à la fin (RP exclue, exempte au décès)
    // + gain en capital et récupération de DPA (100 % LIR 13(1)) des immeubles locatifs W5.
    const propLatentGain = propertiesState
        .filter(p => p.isBought && !p.isSold && !p.isPrimaryResidence)
        .reduce((s, p) => s + Math.max(0, p.currentValue - (p.cost ?? 0)), 0);
    let rentalLatentGain = 0;
    let rentalRecaptureTaxable = 0;
    for (let ri = 0; ri < rentalStates.length; ri++) {
        const rs = rentalStates[ri];
        const tb = rentalTaxBases[ri];
        const cost = tb ? tb.purchaseCost : rs.initialCost;
        const priorCca = tb ? tb.priorCcaTaken : 0;
        // La DPA pendant la simulation n'est pas transmise à applyW5Effects (actualCca = 0) :
        // seule la DPA antérieure réellement déduite avant simulation (rp.ccaTaken) est récupérable au décès.
        const effectiveEndUcc = Math.max(0, cost - priorCca);
        const recap = computeCcaRecapture(rs.currentValue, cost, effectiveEndUcc);
        rentalLatentGain += recap.capitalGainGross;
        rentalRecaptureTaxable += recap.recapture100Pct;
    }
    const realEstateLatentGain = propLatentGain + rentalLatentGain;
    const estate = computeEstateNetWorth({
        liquid, celi, celiapp, reer, nonReg, nonRegACB, crypto, cryptoACB, reee,
        realEstateEquity, mortgageBalance, realEstateLatentGain, rentalRecaptureTaxable, isDeceasedEarly: isDead,
        smithManoeuvreDebt, liquidDebt,
        // [ENG-W5-BUSINESS-OFFBALANCE] La succession aussi : sans ce terme, le legs sous-évaluait le
        // patrimoine de la valeur ENTIÈRE de l'entreprise (mesuré 2 M$ dans le persona W5).
        privateBusinessValue,
        // [fix 2026-06-16] dettes actives résiduelles en fin de sim : soustraites du patrimoine
        // successoral comme dans le NW mensuel (sinon « Patrimoine projeté » diverge du graphe).
        activeDebtsTotal: sumActiveDebts(),
        incomeRetirement, accRentesYear, accRetraitsReerYear,
        grossMarcBaseAnnual, grossAnnaBaseAnnual, simSalaryGrowth,
        simulationYears: elapsedYearsAtEnd,
        startYear, currentAge,
        retirementTargetAge: retirementGoal.targetAge,
        governmentPension: retirementGoal.governmentPension,
        // [ESTATE-LIFEEXPECTANCY-95-DUR] L'horizon de la VAN des rentes est la saisie de l'utilisateur
        // (défaut 90 dans le module, jamais ici — un second défaut à ce site redivergerait).
        lifeExpectancy: retirementGoal.lifeExpectancy,
        // FA-8 — estimés précis par rente (per-personne) : priment sur le split 65/35 dans le NPV estate,
        // comme dans le revenu de retraite (plus de divergence silencieuse).
        rrqEstimateMonthly: retirementGoal.rrqEstimateMonthly,
        psvEstimateMonthly: retirementGoal.psvEstimateMonthly,
        // [ESTATE-NPV-07] Rentes RÉELLEMENT versées au dernier point (nominal, familial) : elles
        // portent le prorata gains/résidence et l'indexation que les estimés de saisie ci-dessus
        // n'ont pas. Elles ne servent QU'À isoler la tranche imposable dans le facteur net d'impôt
        // de la VAN — la VAN elle-même reste bâtie sur les estimés (convention FA-8 inchangée).
        pensionRrqMonthlyFinal: pensionRRQ,
        pensionPsvMonthlyFinal: pensionPSV,
        pensionGisMonthlyFinal: incomeRetirementGis,
        pensionOasReductionMonthlyFinal: pensionOasReduction,
        // [ESTATE-NPV-07] Proxy de contexte tant que la DB n'est pas versée. ⚠️ Calculé par la
        // SOURCE UNIQUE `computeDbPensionMonthly` (partagée avec `retirementIncome.ts`), et NON
        // recopié : la re-dérivation avait produit trois divergences mesurées (indexation partielle,
        // âge de début, facteur de survivant). `age` est forcé au-delà de `dbPensionStartAge` parce
        // qu'on veut « ce que la DB vaudra », pas « ce qu'elle vaut aujourd'hui » ; `inflFactor` est
        // porté à l'année finale, comme `rrqExpected`.
        dbPensionMonthlyPlanned: computeDbPensionMonthly({
            retirementGoal,
            age: Math.max(currentAge + elapsedYearsAtEnd, retirementGoal.dbPensionStartAge ?? retirementGoal.targetAge),
            inflFactor: Math.pow(1 + simInflation / 100, elapsedYearsAtEnd),
            survivorMode, dbSurvivorPct,
            // ⚠️ `divorced` SEUL, PAS `survivorMode || divorced` — exactement comme l'appel de
            // référence de `computeRetirementIncome` 1 200 lignes plus haut. Le décès est DÉJÀ porté
            // par `dbSurvivorFactor = survivorMode ? dbSurvivorPct : 1` À L'INTÉRIEUR de la source
            // unique ; y ajouter un `1/N` réduit DEUX FOIS. J'avais recopié l'expression de la ligne
            // voisine (`householdPensionShare` du repli `governmentPension`), où le halving survivant
            // est légitime parce que l'agrégat couvre les DEUX conjoints. MESURÉ : proxy/réel = 0,5000
            // en mode survivant (contre 1,0000 en couple intact et en divorce), soit jusqu'à
            // 17 067 $ de patrimoine successoral surestimé tant que la DB n'a pas démarré, et une
            // marche résiduelle de ~2 k$ à son démarrage — la falaise même que ce terme supprime.
            householdPensionShare: divorced ? 1 / Math.max(1, activeUsersCount) : 1,
        }),
        pensionPriveeMonthlyFinal: pensionPrivee,
        // [ENG-DIVORCE-ESTATE-PENSION] Le compteur de TÊTES : il MULTIPLIE ici un estimé
        // per-personne pour reconstituer le familial — sémantique INVERSE de `retirementIncome`,
        // où le même nom désigne un DIVISEUR d'agrégat. D'où une lecture ligne à ligne avant de
        // câbler (le piège homonyme a déjà coûté un NO-GO sur ce lot).
        // ⚠️ `survivorMode || divorced` et non `soloHousehold` : ce dernier est déclaré DANS la
        // boucle mensuelle et n'existe plus ici. Les deux drapeaux, eux, vivent au niveau du
        // scénario et portent l'état FINAL du ménage — ce qui est exactement la bonne question
        // pour un bilan successoral.
        activeUsersCount: (survivorMode || divorced) ? 1 : activeUsersCount,
        // Et la PART, pour le repli sur l'agrégat familial `governmentPension`, que rien ne divise.
        householdPensionShare: (survivorMode || divorced) ? 1 / Math.max(1, activeUsersCount) : 1,
        simInflation, enableMonteCarlo,
        startingCash: calculatedStartingCash,
        startingCELI: liveCSVBalances.CELI || 0,
        startingCELIAPP: liveCSVBalances.CELIAPP || 0,
        startingREER: liveCSVBalances.REER || 0,
        startingNonReg: liveCSVBalances.NON_ENREG || 0,
        startingCrypto: liveCSVBalances.CRYPTO || 0,
        startingREEE: liveCSVBalances.REEE || 0,
    }, calculateFiscalReport);

    const grossFinancialEnd = Math.max(0, liquid + celi + celiapp + reer + nonReg + crypto);
    const financialDebtsAndUnsettled = liquidDebt + smithManoeuvreDebt + sumActiveDebts()
        + (Number.isFinite(reconciledUnsettledTax) ? Math.max(0, reconciledUnsettledTax) : 0);
    const finTaxableEnd = reer
        + Math.max(0, nonReg - nonRegACB) * CAPITAL_GAINS_INCLUSION_STANDARD
        + Math.max(0, crypto - cryptoACB) * CAPITAL_GAINS_INCLUSION_STANDARD;
    const totalEstateLiquidationEnd = estate.taxableBreakdown.rrspRrif
        + estate.taxableBreakdown.capitalGainsTaxable
        + estate.taxableBreakdown.rentalRecapture;
    const sustainableMonthlyNetReal = computeSustainableMonthlyNetReal({
        retirementMonthsEvaluated,
        retFundedRealSum,
        retAnnuityFvFactor,
        grossFinancial: grossFinancialEnd,
        financialDebtsAndUnsettled,
        finTaxable: finTaxableEnd,
        totalEstateLiquidation: totalEstateLiquidationEnd,
        totalEstateTax: estate.totalEstateTax,
        cumCpiFactor: cumulativeCpiMultiplier,
        lifeExpectancy: retirementGoal.lifeExpectancy,
        effectiveRetirementAge,
    });

    // Bug détecté en mode test : chartData parfois vide silencieusement
    // (lastProjection jamais set côté store). Trace explicite pour faciliter
    // le debug local quand on voit "Patrimoine projeté: 0.00M$" en UI.
    if (!netWorthBuf && data.length === 0) {
        // Anomalie moteur (« Patrimoine projeté: 0.00M$ » en UI) : visible dans les diagnostics,
        // pas seulement en console. logError est worker-safe (no-op de persistance hors localStorage).
        logError({ source: 'projection', severity: 'warning', message: 'runScenario a retourné chartData=[] (early break mortalité ou boucle skippée ?)', context: { years: projection.years, isDead, estateNetWorth: estate.estateNetWorth } });
    }

    return {
        chartData: netWorthBuf ? EMPTY_CHART_DATA : data,
        ...(netWorthBuf ? { netWorthSeries: netWorthBuf, netWorthSeriesLen: netWorthBufLen } : {}),
        actionPlan: month1ActionPlan,
        fireNumber: fireTargetNetWorth || 0,
        firstFireAge,
        firstFireMonthIndex,
        goalOutcomes,
        finalExpenseMultiplier: expenseMultiplier,
        cumCpiFactorAtEnd: cumulativeCpiMultiplier,
        finalNetWorth: estate.finalRawNetWorth,
        estateNetWorth: estate.estateNetWorth,
        reerByUserFinal: reerByUser,
        // [ENG-TTP-UNSETTLED-HORIZON] (panel #554/#555, mesuré NET : 8,6 % du compteur à 10 ans,
        // 51,5 % à 2 ans, 100 % à 1 an) : la dernière année RÉCONCILIÉE par décembre n'a jamais
        // son avril → sa dette échappe à totalTaxesPaid. On l'expose SÉPARÉMENT (l'affichage additionne)
        // plutôt que de la fondre dans le compteur : l'identité totalTaxesPaid == Σ FluxImpots reste
        // vraie et testable. SURTOUT PAS taxCurrentYear (année partielle NON réconciliée = retenues
        // brutes → ré-introduirait la sur-estimation). Signé (négatif = remboursement dû au
        // patrimoine). Couvre aussi le décès mi-simulation (break avant avril — même chemin de
        // retour). `totalEstateTax` est une grandeur DISJOINTE (impôt de liquidation).
        unsettledTaxAtHorizon: Number.isFinite(reconciledUnsettledTax) ? reconciledUnsettledTax : 0,
        totalEstateTax: estate.totalEstateTax,
        fedEstateTax: estate.fedEstateTax,
        qcEstateTax: estate.qcEstateTax,
        estateTaxableBreakdown: estate.taxableBreakdown,
        projectedDeathAge: estate.projectedDeathAge,
        sustainableMonthlyNetReal,
        retirementMonthsEvaluated,
        totalTaxesPaid: totalTaxesPaid || 0,
        totalGrowth: totalGrowth || 0,
        totalExpenses,
        minNetWorth,
        // Borné à [0, 1] : la boucle peut tourner 1 mois de plus que years*12
        // (extension retraite/horizon) → un ratio brut > 1 était possible (vu
        // en audit : persona « couple endetté » à 100,2 %). Un taux de manque
        // est par définition une fraction.
        shortfallRate: Math.min(1, shortfallMonths / (projection.years * 12)),
        // [PV-11a] — objectifs partiellement financés (≠ shortfallMonths/cashflow).
        goalShortfalls: { count: goalShortfallCount, total: Math.round(goalShortfallTotal) },
        startNW: estate.startNW,
    };
};

// Cycle 7 split: runMonteCarlo extrait dans ./projection/monteCarlo

// FA-12 — hook TEST-ONLY : l'API publique (calculateFutureProjection) ne lance les scénarios
// qu'en déterministe (enableMonteCarlo=false) et AGRÈGE le Monte Carlo (percentiles). Le test
// d'intégration survivorMode doit piloter UNE itération MC seedée précise : la mortalité du
// conjoint (trySpouseMortality) n'est tirée que sous enableMonteCarlo. Ne pas utiliser hors tests.
export const __runScenarioForTests = runScenario;

/** [BUDGET-SENSIBILITE-MOTEUR] Épargne mensuelle supplémentaire simulée pour `savingsSensitivity`
 *  — hypothèse de PRÉSENTATION (le « +100 $/mois » que la tuile de Budget posait déjà), pas une
 *  constante fiscale : elle ne va pas dans FISCAL_REFERENCE. */
export const SAVINGS_SENSITIVITY_MONTHLY = 100;

function resolveEffectiveStrategyParams(params: SimulationParams) {
    const proj = params.projection;
    const appliedOverrides: EngineOverrides = {
        contributionOrder: proj.appliedContributionOrder,
        debtFirst: proj.appliedDebtFirst,
        skipRapForPurchase: proj.appliedSkipRap,
        gainHarvesting: proj.appliedGainHarvesting,
    };
    const profileRates = returnRatesForProfile(proj.appliedReturnProfile, proj.returnRates);
    const effectiveReturnRates = proj.appliedAssetLocation && profileRates
        ? {
            ...profileRates,
            celi: profileRates.celi + ASSET_LOCATION_BONUS_PP,
            reer: profileRates.reer + ASSET_LOCATION_BONUS_PP,
            nonReg: profileRates.nonReg + ASSET_LOCATION_BONUS_PP,
        }
        : profileRates;
    const effectiveParams: SimulationParams = effectiveReturnRates && effectiveReturnRates !== proj.returnRates
        ? { ...params, projection: { ...proj, returnRates: effectiveReturnRates } }
        : params;
    const selectedDef = strategyDefFor(proj.withdrawalStrategy);
    return { effectiveParams, appliedOverrides, selectedDef };
}

export const calculateFutureProjection = (params: SimulationParams, runMC: boolean = false, selectedIdx: number = 0, onlyStratTypes?: string[]): ProjectionResult => {
    // G21 C5 — leviers « appliqués » depuis l'optimiseur (orthogonaux à l'axe
    // scénario). EngineOverrides threadés à TOUS les scénarios + bonus de rendement
    // NonReg pour l'asset location (clone immutable, effet modulé par le solde réel).
    // Tous absents ⇒ comportement historique strictement inchangé.
    const { effectiveParams, appliedOverrides, selectedDef } = resolveEffectiveStrategyParams(params);

    // [UI-SCEN] (2026-06-09, demande Marc « enlève les plans de base ») — la stratégie de
    // gestion est un PARAMÈTRE (projection.withdrawalStrategy) : par défaut le moteur ne
    // calcule QUE ce scénario réaliste (1 simulation au lieu de 11 — ÷11 en déterministe ;
    // en Monte Carlo le gain porte sur la part déterministe). Les stress-tests sont demandés EXPLICITEMENT via `onlyStratTypes`
    // (panneau de l'onglet Optimisation). Parmi les façons de gérer (kind 'strategy',
    // toutes stratType BASE), seule la SÉLECTIONNÉE est calculée — y compris quand
    // onlyStratTypes contient 'BASE' (goalSeek : 1 sim au lieu de 5).
    let activeDefs: typeof SCENARIO_DEFINITIONS;
    if (onlyStratTypes) {
        const matching = SCENARIO_DEFINITIONS.filter(d => onlyStratTypes.includes(d.stratType))
            .filter(d => d.kind !== 'strategy' || d === selectedDef);
        activeDefs = matching.length > 0 ? matching : [selectedDef];
    } else {
        activeDefs = [selectedDef];
    }
    const results: ProjectionResult[] = activeDefs.map(def => ({
        // [UI-SCEN] — un stress « monde » (def.strategy AUTO_MARGINAL) tourne sous la stratégie
        // SÉLECTIONNÉE : le delta vs réaliste mesure l'effet du CHOC seul, pas un changement de
        // stratégie. LIBERTE_55 (PRIO_REER) garde sa stratégie voulue. Sélection par défaut =
        // AUTO_MARGINAL → strictement identique à l'historique (goldens stables).
        ...runScenario(
            effectiveParams,
            def.kind !== 'strategy' && def.strategy === 'AUTO_MARGINAL' ? selectedDef.strategy : def.strategy,
            false, def.delayPensions, 0, def.stratType, appliedOverrides,
        ),
        strategy: def.strategy,
        strategyName: def.strategyName,
        stratType: def.stratType,
        delayPensions: def.delayPensions,
        stratDescription: def.stratDescription,
        pros: def.pros,
        cons: def.cons,
        icon: def.icon,
        kind: def.kind,
    }));
    // [UI-SCEN] — référence du gainVsAuto = le scénario SÉLECTIONNÉ (results[0] par défaut ;
    // pour un run stress-only, le panneau compare lui-même à lastProjection — gainVsAuto y
    // est relatif au 1er stress, à ignorer côté UI).
    const resBase = results[0];

    // [BUDGET-SENSIBILITE-MOTEUR] Sensibilité à l'épargne : le MÊME scénario que `resBase` (même
    // stratégie, même report de rentes, mêmes leviers), dépenses réduites de
    // `SAVINGS_SENSITIVITY_MONTHLY`. Calculée seulement sur le chemin de PRODUCTION (pas
    // d'`onlyStratTypes`) : goal seek dichotomise en appelant `['BASE']` 10 à 25 fois et le
    // stress-test cible ses scénarios — leur ajouter un run doublerait leur coût pour une valeur
    // qu'ils ne lisent pas. Coût mesuré sur le chemin de production (MC 100 itérations) : +2,5 à
    // 4,1 %. [SANDBOX-CURSEURS-THEORIQUES-RETRAIT] L'ancienne branche « dépenses théoriques »
    // (réduire `theoreticalExpenses`) a disparu avec la neutralisation de `useTheoretical` : le
    // moteur ne lit plus que `baseMonthlyExpenses` (via `effectiveBaseExpenses`), c'est donc lui
    // qu'on réduit — un paramètre non câblé rendrait la mesure MUETTE et fausse.
    let savingsSensitivity: ProjectionResult['savingsSensitivity'] = null;
    if (!onlyStratTypes) {
        const plus: SimulationParams = { ...effectiveParams, baseMonthlyExpenses: Math.max(0, effectiveParams.baseMonthlyExpenses - SAVINGS_SENSITIVITY_MONTHLY) };
        const withExtra = runScenario(plus, selectedDef.strategy, false, selectedDef.delayPensions, 0, selectedDef.stratType, appliedOverrides);
        const dEstate = (withExtra.estateNetWorth ?? NaN) - (resBase.estateNetWorth ?? NaN);
        const dFinal = (withExtra.finalNetWorth ?? NaN) - (resBase.finalNetWorth ?? NaN);
        savingsSensitivity = Number.isFinite(dEstate) && Number.isFinite(dFinal)
            ? { extraMonthlySavings: SAVINGS_SENSITIVITY_MONTHLY, deltaEstateNetWorth: dEstate, deltaFinalNetWorth: dFinal }
            : null;
    }

    // V50: Stable indexing for the UI (we don't sort the main results array anymore)
    const sortedByEstate = [...results].sort((a, b) => (b.estateNetWorth ?? 0) - (a.estateNetWorth ?? 0));
    const best = sortedByEstate[0];

    // Add gain info to each result relative to the standard 'Base' scenario (resBase)
    results.forEach(res => {
        res.gainVsAuto = (res.estateNetWorth ?? 0) - (resBase.estateNetWorth ?? 0);
    });

    // V42: Run MC on the targeted/selected strategy
    const target = results[selectedIdx] || best;
    let successRate: number | null = null;
    let mcIterationsRun: number | null = null;
    let cvar95: number | null = null;
    let fvi: number | null = null;
    let expertMetrics: MonteCarloResult['expertMetrics'] | null = null;

    if (runMC) {
        // Cycle 5 audit UI: monteCarloIterations désormais lu depuis ProjectionConfig
        // (panneau Paramètres Avancés). En mode Futur 2.0 (`mcPowerTier` explicite), autorise jusqu'à 10 000 itérations.
        const MC_ITERATIONS = params.projection.mcPowerTier
            ? effectiveDeepMcIterations(params.projection.monteCarloIterations, params.projection.mcPowerTier)
            : effectiveMcIterations(params.projection.monteCarloIterations);
        // Cycle 7 split: runScenario injecté pour éviter dépendance circulaire.
        // G21 C4 fix : utilise la stratégie réelle du scénario ciblé (avant,
        // 'AUTO_MARGINAL' était hardcodé → le MC ignorait le scénario sélectionné).
        const mcResult = runMonteCarlo(runScenario, effectiveParams, (target.strategy as AllocationStrategy) ?? 'AUTO_MARGINAL', target.delayPensions as boolean, MC_ITERATIONS, appliedOverrides);
        successRate = mcResult.successRate;
        fvi = mcResult.fvi;
        cvar95 = mcResult.cvar95 ?? null;
        expertMetrics = mcResult.expertMetrics;
        // [MC-LABEL-FROZEN] Le compte voyage AVEC le résultat : le libellé de l'écran Futur lisait
        // la config vivante, donc mentait dès qu'on bougeait le curseur sans relancer.
        mcIterationsRun = mcResult.iterationsRun;

        target.chartData.forEach((d, i) => {
            d.P5 = mcResult.p5Data?.[i] ?? null;
            d.P10 = mcResult.p10Data[i] ?? null;
            d.P25 = mcResult.p25Data?.[i] ?? null;
            d.P50 = mcResult.p50Data[i] ?? null;
            d.P75 = mcResult.p75Data?.[i] ?? null;
            d.P90 = mcResult.p90Data[i] ?? null;
            d.P95 = mcResult.p95Data?.[i] ?? null;
        });

        const delayStr = target.delayPensions ? 'repousser vos rentes gouvernementales à 70 ans' : 'prendre vos rentes gouvernementales aux âges normaux';
        const stratStr = (target.strategyName as string ?? '').split(' / ')[0];
        const isBest = results.length > 1 && target === best; // [UI-SCEN] 1 résultat = aucune comparaison → pas de « optimale »
        target.aiNote = `${isBest ? 'Stratégie optimale : ' : ''}Simulation basée sur **${stratStr}** et **${delayStr}**. Indice de Vitalité : ${fvi}%.`;
    } else {
        target.chartData.forEach((d) => {
            d.P5 = null; d.P10 = null; d.P25 = null; d.P50 = null; d.P75 = null; d.P90 = null; d.P95 = null;
        });
        // [UI-SCEN] — le report des rentes passe par les âges rrqStartAge/psvStartAge (#210),
        // plus par delayPensions (toujours false dans STRATEGY_DEFS) : on lit les âges réels.
        // [ENG-LIBELLE-RRQ-70-VS-72] Le repli DÉRIVE de la source unique du moteur. Il disait `70`
        // alors que `delayPensions` met la RRQ à 72 — un repli aujourd'hui inatteignable
        // (`delayPensions` est `false` dans les onze définitions de `scenarios.ts`, donc la branche
        // exige `rrqStart` défini), mais à valeur FAUSSE : une bombe le jour où le chemin se rouvre.
        const rrqStart = params.retirementGoal?.rrqStartAge;
        const delayStr = target.delayPensions || (rrqStart !== undefined && rrqStart > RRQ_STANDARD_START_AGE)
            ? `rentes reportées (RRQ ${rrqStart ?? RRQ_DEFERRED_START_AGE} ans)` : 'rentes aux âges choisis';
        const stratStr = (target.strategyName as string ?? '').split(' / ')[0];
        target.aiNote = `Simulation déterministe (**${stratStr}** + **${delayStr}**).`;
    }

    return {
        ...target,
        successRate: fvi || successRate, // V65: Display FVI as health score
        // [MCP-RETIREMENT-VERDICT] — survie BRUTE Monte Carlo (% de runs avec patrimoine final > 0,
        // monteCarlo.ts:92), NON écrasée par le FVI : `successRate` ci-dessus EST le FVI (score
        // composite survie 30 % + sécurité 30 % + efficacité 20 % + legs 20 %) → un verdict de
        // soutenabilité qui seuillait dessus pouvait dire « plan solide » à 50 % de survie réelle
        // (finding panel 2026-07-14). Champ ADDITIF : aucun consommateur existant ne change.
        survivalRatePct: successRate,
        fvi,
        mcIterationsRun,
        cvar95,
        expertMetrics: expertMetrics ?? undefined,
        savingsSensitivity,
        allResults: results,
        bestStrategyIdx: results.indexOf(best)
    };
};

// G21 C5 commit 4 — évalue un sous-ensemble de StrategyConfig par Monte Carlo.
// Injecte le runScenario privé dans runStrategySearch. Très coûteux (N configs ×
// jusqu'à 1000 sims) → appeler via le pool multi-worker (runStrategySearchAsync),
// jamais sur le thread de rendu. Le sharding sur plusieurs cœurs se fait en amont :
// chaque worker reçoit sa part de `configs`.
export const calculateStrategySearch = (
    params: SimulationParams,
    configs: ReadonlyArray<StrategyConfig>,
    opts: RunStrategySearchOptions = {},
): StrategySearchResult => runStrategySearch(runScenario, params, configs, opts);

export const calculateTournamentStrategySearch = (
    params: SimulationParams,
    configs: ReadonlyArray<StrategyConfig>,
    opts: TournamentSearchOptions = {},
): StrategySearchResult => runTournamentStrategySearch(runScenario, params, configs, opts);

export const calculateShapleyAttribution = (
    params: SimulationParams,
    baselineConfig: StrategyConfig,
    winnerConfig: StrategyConfig,
    monthlyExpenses?: number,
): ShapleyAttributionItem[] => evaluateShapleyForWinner(runScenario, params, baselineConfig, winnerConfig, monthlyExpenses);

/**
 * Exécute un lot (shard) du mode lourd « Grand Calcul » à mémoire bornée.
 * Injecte `runScenario` avec la stratégie effective et les régimes macroéconomiques optionnels.
 */
export const runGrandCalculShard = (
    params: SimulationParams,
    config: GrandCalculConfig,
    startIter: number,
    count: number,
    onProgress?: (done: number, total: number) => void,
): GrandCalculShardResult => {
    const { effectiveParams, appliedOverrides, selectedDef } = resolveEffectiveStrategyParams(params);
    const preparedSetup = prepareScenarioSetup(effectiveParams, selectedDef.stratType);
    const netWorthBuffer = new Float64Array(preparedSetup.totalMonths);
    return runGrandCalculShardWithRunner(
        (p, s, mc, dp, idx, st, ov, gc) => runScenario(p, s, mc, dp, idx, st, ov, {
            macroRegimes: gc,
            preparedSetup,
            netWorthBuffer,
        }),
        params,
        config,
        startIter,
        count,
        onProgress,
        {
            effectiveParams,
            strategy: selectedDef.strategy,
            delayPensions: selectedDef.delayPensions,
            scenarioType: selectedDef.stratType,
            overrides: appliedOverrides,
        },
    );
};

/**
 * Calcule la référence déterministe (notamment l'impôt successoral ARC/RQ de base)
 * à passer dans `meta.deterministicEstate` lors de la fusion `mergeGrandCalculShards`.
 */
export const computeGrandCalculDeterministicBaseline = (params: SimulationParams): {
    deterministicEstate: NonNullable<MergeGrandCalculMeta['deterministicEstate']>;
} => {
    const { effectiveParams, appliedOverrides, selectedDef } = resolveEffectiveStrategyParams(params);
    const base = runScenario(
        effectiveParams,
        selectedDef.strategy,
        false,
        selectedDef.delayPensions,
        0,
        selectedDef.stratType,
        appliedOverrides,
    );
    return {
        deterministicEstate: {
            total: Number.isFinite(base.totalEstateTax) ? base.totalEstateTax : null,
            fed: base.fedEstateTax ?? null,
            qc: base.qcEstateTax ?? null,
            taxableBreakdown: base.estateTaxableBreakdown ?? {
                rrspRrif: null,
                capitalGainsTaxable: null,
                rentalRecapture: null,
            },
            projectedDeathAge: Number.isFinite(base.projectedDeathAge) ? base.projectedDeathAge : null,
        },
    };
};

export {
    mergeGrandCalculShards,
    clampGrandCalculIterations,
    GRAND_CALCUL_ITERATIONS_MIN,
    GRAND_CALCUL_ITERATIONS_MAX,
    GRAND_CALCUL_ITERATIONS_DEFAULT,
};
export type { MergeGrandCalculMeta };
