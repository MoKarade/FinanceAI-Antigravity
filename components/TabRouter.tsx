import React, { Suspense } from 'react';
import { Tab, AppState, Transaction } from '../types';
import { TAB_LABELS } from '../constants';
import { ErrorBoundary } from './ui/ErrorBoundary';
// P1 fix — wrap React.lazy avec retry + reload sur chunk-load-error
// (cf hubperso.com regression : "Failed to fetch dynamically imported module")
import { lazyWithRetry } from '../utils/lazyWithRetry';
// [REFONTE-NAV-L2a] Bannière « import bancaire figé » : vivait sur l'ex-Accueil (leçon incident
// 2026-08-05 : une alerte doit être là où l'utilisateur regarde PAR DÉFAUT = désormais le Futur).
// Import statique : store + syncHealth + Icon, rien de lourd ; elle se tait d'elle-même (région
// live vide) quand tout va bien.
import { SyncStaleBanner } from './dashboard/SyncStaleBanner';
// [PERF panel #601, mesuré +17,3 KB] FutureKpiStrip importe useNetWorthVariation →
// usePortfolioHistory → buildMarketData : son import STATIQUE ici tirait tout ça dans le chunk
// de BOOT (leçon CLAUDE.md « hoister un import au niveau App »). Lazy comme les pages ;
// fallback `null` (bandeau léger, un skeleton flasherait plus qu'il n'aiderait).
const FutureKpiStrip = lazyWithRetry(() => import('./FutureKpiStrip').then(m => ({ default: m.FutureKpiStrip })), 'FutureKpiStrip');

const AccueilGoogle = lazyWithRetry(() => import('./AccueilGoogle').then(m => ({ default: m.AccueilGoogle })), 'AccueilGoogle');
const Transactions = lazyWithRetry(() => import('./Transactions').then(m => ({ default: m.Transactions })), 'Transactions');
// G22-N3 — Budget + Planif/Abos fusionnés en sous-onglets via BudgetWorkspace.
const BudgetWorkspace = lazyWithRetry(() => import('./budget/BudgetWorkspace').then(m => ({ default: m.BudgetWorkspace })), 'BudgetWorkspace');
const Investments = lazyWithRetry(() => import('./Investments').then(m => ({ default: m.Investments })), 'Investments');
const RealEstate = lazyWithRetry(() => import('./RealEstate').then(m => ({ default: m.RealEstate })), 'RealEstate');
// [REFONTE-NAV-L3] Projets d'achat FUTURS (destination Vie) — même tranche realEstateGoals,
// partitionnée côté UI (l'ACTUEL reste sous Tab.REAL_ESTATE, destination Config).
const RealEstateProjects = lazyWithRetry(() => import('./life/RealEstateProjects').then(m => ({ default: m.RealEstateProjects })), 'RealEstateProjects');
const ChildPlanning = lazyWithRetry(() => import('./ChildPlanning').then(m => ({ default: m.ChildPlanning })), 'ChildPlanning');
const LifeProjects = lazyWithRetry(() => import('./LifeProjects').then(m => ({ default: m.LifeProjects })), 'LifeProjects');
const Retirement = lazyWithRetry(() => import('./Retirement').then(m => ({ default: m.Retirement })), 'Retirement');
const TaxCenter = lazyWithRetry(() => import('./TaxCenter').then(m => ({ default: m.TaxCenter })), 'TaxCenter');
const Settings = lazyWithRetry(() => import('./Settings').then(m => ({ default: m.Settings })), 'Settings');
const Profile = lazyWithRetry(() => import('./Profile').then(m => ({ default: m.Profile })), 'Profile');
const FutureProjection = lazyWithRetry(() => import('./FutureProjection').then(m => ({ default: m.FutureProjection })), 'FutureProjection');
const DebtManager = lazyWithRetry(() => import('./DebtManager').then(m => ({ default: m.DebtManager })), 'DebtManager');

/** Squelette de page instantané à géométrie stable (zéro saut de mise en page pendant un éventuel chargement). */
const TabLoader: React.FC = () => (
    <div className="space-y-6 animate-fade-in py-2" aria-busy="true" aria-label="Chargement de la vue">
        <div className="flex items-center justify-between gap-4">
            <div className="h-9 w-48 rounded-xl skeleton-box" />
            <div className="h-9 w-36 rounded-xl skeleton-box" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="h-24 rounded-2xl border border-bordure bg-surface skeleton-box" />
            <div className="h-24 rounded-2xl border border-bordure bg-surface skeleton-box" />
            <div className="h-24 rounded-2xl border border-bordure bg-surface skeleton-box" />
            <div className="h-24 rounded-2xl border border-bordure bg-surface skeleton-box" />
        </div>
        <div className="h-96 rounded-2xl border border-bordure bg-surface skeleton-box" />
    </div>
);

interface TabRouterProps {
    activeTab: Tab;
    state: AppState;
    setAppState: (partial: Partial<AppState>) => void;
    setActiveTab: (tab: Tab) => void;
    isPrivacyMode: boolean;
    isLoading: boolean;
    globalNetWorth: number;
    /** [KPI-AVOIRS-DETTES] Les deux termes hors immobilier, du MÊME appel que `globalNetWorth`. */
    avoirsHorsImmo: number;
    dettesHorsImmo: number;
    calculatedMonthlySavings: number;
    assetBreakdown: { reer: number; celi: number; reee: number; nonReg: number };
    currentLiquidity: number;
    onUpdateApiKeys: (keys: AppState['apiKeys']) => void;
    onManualImport: (rawData: string) => void;
}

/**
 * Routeur principal par onglet avec accès direct sans écran de blocage préalable.
 * Tous les onglets s'ouvrent immédiatement avec transitions fluides et préchargement en arrière-plan.
 */
export const TabRouter: React.FC<TabRouterProps> = ({
    activeTab, state, setAppState, setActiveTab, isPrivacyMode, isLoading: _isLoading,
    globalNetWorth, avoirsHorsImmo, dettesHorsImmo, calculatedMonthlySavings, assetBreakdown, currentLiquidity,
    onUpdateApiKeys, onManualImport,
}) => {
    return (
        <Suspense fallback={<TabLoader />}>
            <ErrorBoundary resetKey={activeTab} label={TAB_LABELS[activeTab]}>
                {/* Transition d'onglet sans double cascade stagger-in (chaque page gère déjà sa propre grille) */}
                <div
                    key={activeTab}
                    data-testid="tab-transition-container"
                    data-active-tab={activeTab}
                    className="motion-reduce:animate-none"
                >
                {activeTab === Tab.DASHBOARD && (
                    <>
                        <SyncStaleBanner />
                        <AccueilGoogle
                            state={state}
                            setActiveTab={setActiveTab}
                            isPrivacyMode={isPrivacyMode}
                            globalNetWorth={globalNetWorth}
                            avoirsHorsImmo={avoirsHorsImmo}
                            dettesHorsImmo={dettesHorsImmo}
                            calculatedMonthlySavings={calculatedMonthlySavings}
                            assetBreakdown={assetBreakdown}
                            currentLiquidity={currentLiquidity}
                        />
                    </>
                )}

                {activeTab === Tab.TRANSACTIONS && (
                    <Transactions
                        transactions={state.transactions}
                        setTransactions={(t) => setAppState({ transactions: typeof t === 'function' ? (t as (prev: Transaction[]) => Transaction[])(state.transactions) : t })}
                        apiKey={state.apiKeys.gemini}
                        budgetItems={state.budgetItems}
                        categorizationRules={state.categorizationRules || []}
                        setCategorizationRules={(rules) => setAppState({ categorizationRules: rules })}
                        onImport={onManualImport}
                    />
                )}

                {activeTab === Tab.BUDGET && (
                    <BudgetWorkspace
                        transactions={state.transactions}
                        config={state.config}
                        budgetItems={state.budgetItems}
                        setBudgetItems={(items) => setAppState({ budgetItems: items })}
                        apiKey={state.apiKeys.gemini}
                    />
                )}

                {activeTab === Tab.DEBT && (
                    <DebtManager debts={state.debts} setDebts={(d) => setAppState({ debts: d })} />
                )}

                {activeTab === Tab.INVESTMENTS && (
                    <Investments
                        assets={state.assets} setAssets={(a) => setAppState({ assets: a })}
                        investmentAccounts={state.investmentAccounts}
                        setInvestmentAccounts={(accs) => setAppState({ investmentAccounts: accs })}
                        investmentTransactions={state.investmentTransactions}
                        setInvestmentTransactions={(txs) => setAppState({ investmentTransactions: txs })}
                        apiKey={state.apiKeys.gemini}
                        transactions={state.transactions}
                        budgetItems={state.budgetItems}
                        config={state.config}
                        projection={state.projection}
                        setProjection={(p) => setAppState({ projection: p })}
                    />
                )}

                {activeTab === Tab.TAX && (
                    <TaxCenter
                        config={state.config}
                        assets={state.assets} apiKey={state.apiKeys.gemini}
                    />
                )}

                {activeTab === Tab.REAL_ESTATE && (
                    <RealEstate
                        availableCash={currentLiquidity}
                        goals={state.realEstateGoals}
                        setGoals={(g) => setAppState({ realEstateGoals: g })}
                    />
                )}

                {activeTab === Tab.REAL_ESTATE_PROJECTS && (
                    <RealEstateProjects
                        availableCash={currentLiquidity}
                        goals={state.realEstateGoals}
                        setGoals={(g) => setAppState({ realEstateGoals: g })}
                    />
                )}

                {activeTab === Tab.FUTURE && (
                    <>
                        <SyncStaleBanner />
                        <FutureProjection
                            autoReveal
                            initialBalances={state.initialBalances}
                            transactions={state.transactions}
                            budgetItems={state.budgetItems}
                            config={state.config}
                            realEstateGoals={state.realEstateGoals}
                            setRealEstateGoals={(g) => setAppState({ realEstateGoals: g })}
                            retirementGoal={state.retirementGoal}
                            setRetirementGoal={(g) => setAppState({ retirementGoal: g })}
                            calculatedMonthlySavings={calculatedMonthlySavings}
                            projection={state.projection}
                            setProjection={(p) => setAppState({ projection: p })}
                            isPrivacyMode={isPrivacyMode}
                            bandeauKpi={(variante) => (
                                <Suspense fallback={null}>
                                    <FutureKpiStrip
                                        variante={variante}
                                        netWorth={globalNetWorth}
                                        liquidity={currentLiquidity}
                                        monthlySavings={calculatedMonthlySavings}
                                        avoirsHorsImmo={avoirsHorsImmo}
                                        dettesHorsImmo={dettesHorsImmo}
                                    />
                                </Suspense>
                            )}
                        />
                    </>
                )}

                {activeTab === Tab.CHILD && (
                    <ChildPlanning
                        goals={state.childGoals || []}
                        setGoals={(g) => setAppState({ childGoals: g })}
                        projection={state.projection}
                        currentRESP={assetBreakdown.reee}
                    />
                )}

                {(activeTab === Tab.LIFE_PROJECTS || activeTab === Tab.TRAVEL || activeTab === Tab.LIFE_EVENTS) && (
                    <LifeProjects
                        travelGoals={state.travelGoals}
                        setTravelGoals={(g) => setAppState({ travelGoals: g })}
                        lifeEvents={state.lifeEvents}
                        setLifeEvents={(e) => setAppState({ lifeEvents: e })}
                        netWorth={globalNetWorth}
                        returnRate={state.projection.returnRate}
                    />
                )}

                {activeTab === Tab.RETIREMENT && (
                    <Retirement
                        goal={state.retirementGoal}
                        currentREER={assetBreakdown.reer} currentCELI={assetBreakdown.celi} currentNonReg={assetBreakdown.nonReg}
                        calculatedMonthlySavings={calculatedMonthlySavings}
                        projection={state.projection}
                        config={state.config}
                        initialBalances={state.initialBalances}
                        budgetItems={state.budgetItems}
                        realEstateGoals={state.realEstateGoals}
                        childGoals={state.childGoals || []}
                        travelGoals={state.travelGoals}
                        lifeEvents={state.lifeEvents}
                        debts={state.debts}
                    />
                )}

                {activeTab === Tab.SETTINGS && (
                    <Settings
                        apiKeys={state.apiKeys} setApiKeys={onUpdateApiKeys}
                        config={state.config} setConfig={(c) => setAppState({ config: c })}
                        onImportData={onManualImport}
                        initialBalances={state.initialBalances} setInitialBalances={(b) => setAppState({ initialBalances: b })}
                        transactions={state.transactions}
                        appState={state}
                    />
                )}

                {activeTab === Tab.PROFILE && (
                    <Profile />
                )}
                </div>
            </ErrorBoundary>
        </Suspense>
    );
};
