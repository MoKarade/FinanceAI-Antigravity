import React, { useState, useMemo, useEffect, useCallback, Suspense } from 'react';
import {
    Asset,
    AppState,
    InvestmentAccount,
    InvestmentTransaction,
    Transaction,
    BudgetCategory,
    BudgetConfig,
    Tab as TabEnum,
} from '../types';
import { Card } from './ui/Card';
import { PageHeader } from './ui/PageHeader';
import { ProjectionStaleBanner } from './ui/ProjectionStaleBanner';
import { Icon } from './ui/Icon';
import { Pill } from './ui/Pill';
import { SubTabs, panelId, tabId } from './ui/SubTabs';
import { Skeleton } from './ui/Skeleton';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { type ValoriaQuickSignal } from '../services/valoria/valoriaIntegration';

const ValoriaWorkspace = lazyWithRetry(
    () => import('./valoria/ValoriaWorkspace').then((m) => ({ default: m.ValoriaWorkspace })),
    'ValoriaWorkspace',
);
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as ReTooltip } from 'recharts';
import { Badge } from './ui/Badge';
import { FxEstimateBadge } from './ui/FxEstimateBadge';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { MarketDataPoint } from '../services/finance';
import { usePortfolioHistory } from '../hooks/usePortfolioHistory';
import { HistoryCoverageNote } from './dashboard/HistoryCoverageNote';
import { HistorySyncDoctor } from './investments/HistorySyncDoctor';
import { historyKeyMatchesSymbol } from '../services/history/buildMarketData';
import { variation24hSerieSiRecente } from '../services/history/fraicheurCours';
import { CoursPerimesNotice } from './investments/CoursPerimesNotice';
import { todayIsoLocal } from '../services/projection/dailyRefine';
import { PERF_PERIODS, PERF_PERIOD_LABELS, type PerfPeriod } from '../services/history/periodReturn';
import { PerformanceComparee, variationFenetre, type PeriodeGraphe } from './investments/PerformanceComparee';
import { TitresDetenus, type LigneTitre } from './investments/TitresDetenus';
import { useViewportBelowLg } from '../hooks/useViewportBelowLg';
import { isCoupleMode } from '../services/couple/netWorthByOwner';
import { TAB_LABELS } from '../constants';
import { CANONICAL_SECTORS, CANONICAL_REGIONS } from '../services/assetMeta';
import { assetValueCad, toCurrencyFactor } from '../services/portfolio';
import { DividendPanel } from './investments/DividendPanel';
import { formatCAD, formatDate, formatNumber, formatVariationPct } from '../utils/format';
import { logError } from '../services/errorLogger';
import { AddStockForm } from './investments/AddStockForm';
import { ImportBrokerPositions } from './investments/ImportBrokerPositions';
import { computePurchaseStats } from '../utils/assetPurchases';
import { useFinanceStore } from '../store/useFinanceStore';
import { horizonAnnees } from '../services/projection/horizon';
import { NetWorthByOwnerCard, nomProprietaire } from './investments/NetWorthByOwnerCard';
import { StockComparisonModal } from './investments/StockComparisonModal';
import { BrokerReconciliationCard } from './investments/BrokerReconciliationCard';
import { CeliAssetNudge } from './CeliAssetNudge';
import { PrivateAmount } from './ui/PrivateAmount';
import { ChartDataTable, type ChartDataColumn } from './ui/ChartDataTable';
import { MASKED_AMOUNT_LABEL } from '../utils/privacyAria';
import { MultiAgentCommitteeView } from './investments/MultiAgentCommitteeView';
import { getRebalanceJustifications, type RebalanceActionInput } from '../services/gemini';
import { messageErreurIa, MESSAGE_IA_MODE_DISCRET } from '../services/messageErreurIa';
import {
    PLACEMENTS_TABS,
    shouldOpenExpertTools,
    type InitialPlacementsSubTab,
    type PlacementsSubTab,
    type TargetModelEntry,
} from './investments/investmentsHelpers';
import { useInvestmentsPortfolio } from './investments/useInvestmentsPortfolio';

export type { PlacementsSubTab } from './investments/investmentsHelpers';

const COLORS_SECTOR: Record<string, string> = {
    'Technologie': '#5b82bf',
    'Industrie': '#c2974f',
    'Finance': '#4f9d86',
    'Mines/Or': '#b8a45e',
    'Index': '#8a7cc0',
    'Crypto': '#f97316',
    'Autre': '#6b7280',
};

const COLORS_REGION: Record<string, string> = {
    'USA': '#5b82bf',
    'Canada': '#ef8fa0',
    'Europe': '#4f9d86',
    'Asie': '#ef4444',
    'Global': '#8a7cc0',
    'Ameriques': '#c2974f',
    'Autre': '#6b7280',
};

const DEFAULT_TARGET_MODEL: ReadonlyArray<TargetModelEntry> = [
    { id: 'index', label: 'Index Mondial', targetPct: 40, sectors: ['Index'], icon: 'globe', color: '#8a7cc0' },
    { id: 'tech', label: 'Technologie', targetPct: 30, sectors: ['Technologie'], icon: 'cpu', color: '#5b82bf' },
    { id: 'ind_fin', label: 'Industrie & Finance', targetPct: 15, sectors: ['Industrie', 'Finance'], icon: 'factory', color: '#c2974f' },
    { id: 'gold', label: 'Or & Matières', targetPct: 10, sectors: ['Mines/Or'], icon: 'gem', color: '#b8a45e' },
    { id: 'cash', label: 'Liquidités', targetPct: 5, sectors: [], icon: 'cash', color: '#4f9d86' },
];

interface AllocationDonutTooltipProps {
    active?: boolean;
    payload?: Array<{ payload?: { name?: string; value?: number; percent?: number }; fill?: string }>;
    isPrivacyMode: boolean;
    categoryLabel: string;
}

const AllocationDonutTooltip: React.FC<AllocationDonutTooltipProps> = ({ active, payload, isPrivacyMode, categoryLabel }) => {
    if (!active || !payload?.length || !payload[0].payload) return null;
    const item = payload[0].payload;
    const val = Number(item.value) || 0;
    const pct = Number(item.percent) || 0;

    return (
        <div className="gf-tooltip-card sm:min-w-[205px]">
            <div className="gf-tooltip-header">
                <span className="font-sans text-[12px] font-bold text-ink-50 truncate max-w-[130px]">{item.name}</span>
                <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-neutral">
                    {categoryLabel}
                </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 sm:mb-2">
                <span className="gf-tooltip-hero text-xs sm:text-[16px]">
                    {isPrivacyMode ? MASKED_AMOUNT_LABEL : <PrivateAmount>{formatCAD(val)}</PrivateAmount>}
                </span>
                <span className="font-mono text-[11px] font-bold text-ink-200">
                    {isPrivacyMode ? MASKED_AMOUNT_LABEL : <PrivateAmount>{pct.toFixed(1)} %</PrivateAmount>}
                </span>
            </div>
            {!isPrivacyMode && (
                <div className="hidden sm:block gf-tooltip-bar-track">
                    <div
                        className="gf-tooltip-bar-fill"
                        style={{
                            // MONTANT-MASQUE-AILLEURS : bloc entier sous !isPrivacyMode
                            width: `${Math.min(100, Math.max(0, pct))}%`,
                            background: 'var(--repere)',
                        }}
                    />
                </div>
            )}
            <div className="hidden sm:block mt-1.5 text-[10px] text-ink-400">
                Cliquer pour filtrer les positions
            </div>
        </div>
    );
};

interface InvestmentsProps {
    assets: Asset[];
    setAssets: (assets: Asset[]) => void;
    investmentAccounts: InvestmentAccount[];
    setInvestmentAccounts: (accounts: InvestmentAccount[]) => void;
    investmentTransactions: InvestmentTransaction[];
    setInvestmentTransactions: (transactions: InvestmentTransaction[]) => void;
    apiKey: string;
    transactions: Transaction[];
    budgetItems: BudgetCategory[];
    config: BudgetConfig;
    projection: AppState['projection'];
    setProjection: (projection: AppState['projection']) => void;
    onOpenValoria?: () => void;
    initialSubTab?: InitialPlacementsSubTab;
}

export const Investments: React.FC<InvestmentsProps> = ({
    assets, setAssets, projection, setProjection, apiKey, onOpenValoria, initialSubTab,
}) => {
    void onOpenValoria;
    // Phase E.7 — apiKey du store (fallback prop pour rétrocompat) pour appeler Gemini
    const geminiKeyFromStore = useFinanceStore(s => s.apiKeys.gemini || s.apiKeys.anthropic);
    const geminiKey = geminiKeyFromStore || apiKey || '';

    // [A11Y-CHARTS] tables de données sr-only pour les donuts d'allocation (Recharts opaque aux
    // lecteurs d'écran). Classe d'actif visible ; Valeur $ ET part % masquées en mode privé (parité PrivateAmount ;
    // [PRIVACY-RATIOS-DUREES-UNIFORMES] : la part d'un portefeuille est un ratio perso).
    const isPrivacyMode = useFinanceStore(s => s.isPrivacyMode);
    const allocationColumns: ChartDataColumn[] = [
        { key: 'name', label: "Classe d'actif" },
        { key: 'value', label: 'Valeur', format: (v) => isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(v) },
        { key: 'percent', label: 'Part', format: (v) => isPrivacyMode ? MASKED_AMOUNT_LABEL : `${(Number(v) || 0).toFixed(1)}%` },
    ];

    const [marketData, setMarketData] = useState<MarketDataPoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    // [S5-REFONTE-PLACEMENTS] Périodes des maquettes (1, 3, 6 mois, tout) ; « Tout » par défaut.
    const [timeRange, setTimeRange] = useState<PeriodeGraphe>('ALL');
    // [INVEST-PERF-PERIOD] Période des variations/performances affichées (demande Marc 2026-07-23 :
    // « la performance actuellement c'est 24h mais je veux pouvoir choisir moi »). Pilote la carte
    // Performance, les chips du graphe et les cartes par titre. Le score de santé reste FIXÉ sur 24h
    // (momentum court terme — indépendant du sélecteur, sinon le badge header changerait avec la vue).
    const [perfPeriod, setPerfPeriod] = useState<PerfPeriod>('24H');
    // Phase E.3 — sous-onglets pour aérer la page (doc directives §4)
    // PH4-INV-4 — « moins de pages » : Rééquilibrage fusionné dans Allocation (4 → 3 sous-onglets).
    const pendingFocus = useFinanceStore(s => s.pendingFocus);
    const [subTab, setSubTab] = useState<PlacementsSubTab>(() =>
        initialSubTab === 'ai_committee' ? 'ai_committee' : 'portfolio',
    );
    const [expertToolsOpen, setExpertToolsOpen] = useState<boolean>(() => {
        if (initialSubTab === 'quant_advisor') return true;
        if (pendingFocus && (pendingFocus.tab === TabEnum.INVESTMENTS || pendingFocus.tab === TabEnum.VALORIA) && Date.now() <= pendingFocus.expiresAt) {
            return shouldOpenExpertTools(pendingFocus.section);
        }
        return false;
    });
    const [allocationOpen, setAllocationOpen] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [committeePrefillQuestion, setCommitteePrefillQuestion] = useState<string | null>(null);
    useEffect(() => {
        if (initialSubTab === 'quant_advisor') {
            setExpertToolsOpen(true);
        } else if (initialSubTab === 'ai_committee') {
            setExpertToolsOpen(false);
            setSubTab('ai_committee');
        }
    }, [initialSubTab]);
    useEffect(() => {
        if (!pendingFocus || (pendingFocus.tab !== TabEnum.INVESTMENTS && pendingFocus.tab !== TabEnum.VALORIA) || Date.now() > pendingFocus.expiresAt) {
            return;
        }
        if (shouldOpenExpertTools(pendingFocus.section)) {
            setExpertToolsOpen(true);
        }
    }, [pendingFocus]);
    const etroit = useViewportBelowLg();
    const configStore = useFinanceStore(s => s.config);
    // Phase E.6 — filtre interactif Geo/Sector cliqué dans la pie
    const [allocationFilter, setAllocationFilter] = useState<{ type: 'region' | 'sector'; value: string } | null>(null);

    // Wiring 2026-05: lecture de la projection vivante depuis le store.
    const lastProjection = useFinanceStore(s => s.lastProjection);
    const navigateWithFocus = useFinanceStore(s => s.navigateWithFocus);
    // [ASSET-FX-DISPLAY] prix des actifs en devise NATIVE → conversion CAD pour toute valeur affichée.
    const fxRates = useFinanceStore(s => s.fxRates);
    const valoriaRiskProfile = useFinanceStore(s => s.valoriaRiskProfile);
    const [valoriaSignals, setValoriaSignals] = useState<Record<string, ValoriaQuickSignal>>({});
    useEffect(() => {
        if (assets.length === 0) {
            setValoriaSignals({});
            return;
        }
        let cancelled = false;
        void import('../services/valoria/valoriaIntegration')
            .then(({ computeValoriaQuickSignals }) => {
                if (cancelled) return;
                setValoriaSignals(
                    computeValoriaQuickSignals({
                        assets,
                        fxRates,
                        riskProfile: valoriaRiskProfile,
                        appliedReturnProfile: projection?.appliedReturnProfile,
                    })
                );
            })
            .catch(() => {
                // Non-bloquant : Placements reste entièrement fonctionnel sans signaux Valoria
            });
        return () => {
            cancelled = true;
        };
    }, [assets, fxRates, valoriaRiskProfile, projection?.appliedReturnProfile]);
    // [HORIZON-ESPERANCE-DE-VIE] La projection va jusqu'à l'espérance de vie de la personne 1 :
    // même durée que le moteur (services/projection/horizon.ts), plus le curseur retiré.
    const agePersonne1 = useFinanceStore(s => s.config?.users?.[0]?.age);
    const retirementGoalHorizon = useFinanceStore(s => s.retirementGoal);
    const projectionHorizonYears = horizonAnnees(agePersonne1, retirementGoalHorizon?.lifeExpectancy);
    const horizonData = useMemo(() => {
        if (!lastProjection?.chartData?.length) return { snapshot: null, corrupt: false };
        const targetMonth = projectionHorizonYears * 12;
        const point = lastProjection.chartData.find(p => p.monthIndex === targetMonth)
            ?? lastProjection.chartData[lastProjection.chartData.length - 1];
        if (!point) return { snapshot: null, corrupt: false };
        // [EP-5] détail par compte retiré → on ne garde que year + netWorth.
        // no-silent-failure : un NetWorth non fini (NaN/±Inf) = point corrompu → snapshot null
        // (→ <ProjectionRequired> déjà câblé) au lieu d'un « 0 $ » / « — » muet. Flag `corrupt`
        // (présent-mais-invalide) → log via effet ; absence pure = repli muet légitime.
        const nw = point.NetWorth;
        if (typeof nw !== 'number' || !Number.isFinite(nw)) {
            return { snapshot: null, corrupt: nw != null };
        }
        return {
            snapshot: {
                year: point.year ?? new Date().getFullYear() + projectionHorizonYears,
                netWorth: nw,
            },
            corrupt: false,
        };
    }, [lastProjection, projectionHorizonYears]);
    const horizonSnapshot = horizonData.snapshot;

    useEffect(() => {
        if (horizonData.corrupt) {
            logError({
                source: 'projection',
                severity: 'warning',
                message: 'Investments horizonSnapshot : NetWorth non fini au point horizon (projection corrompue)',
            });
        }
    }, [horizonData.corrupt]);

    const [targetModel, setTargetModelLocal] = useState<ReadonlyArray<TargetModelEntry>>(() => {
        const pcts = projection?.investmentTargetPcts;
        // ⚠️ `.map` même sans `pcts` : rendre `DEFAULT_TARGET_MODEL` tel quel ferait de l'état une
        // référence VERS la constante du module (cf. le commentaire de sa déclaration).
        return DEFAULT_TARGET_MODEL.map(m => ({ ...m, targetPct: pcts?.[m.id] ?? m.targetPct }));
    });
    const setTargetModel = (model: ReadonlyArray<TargetModelEntry>) => {
        setTargetModelLocal(model);
        const pcts: Record<string, number> = {};
        model.forEach(m => { pcts[m.id] = m.targetPct; });
        setProjection({ ...projection, investmentTargetPcts: pcts });
    };
    const [isRebalanceEdit, setIsRebalanceEdit] = useState(false);
    // Phase E.7 — justifications IA des actions de rééquilibrage
    const [iaJustifications, setIaJustifications] = useState<Map<string, string>>(new Map());
    const [isFetchingJustifications, setIsFetchingJustifications] = useState(false);
    // [AI-REBALANCE-CAUSE-PERDUE] Le MESSAGE, pas un booléen. `[REBALANCE-SILENT-FAIL]` avait déjà
    // vu qu'un tableau vide se lisait « l'IA n'avait rien à ajouter » sur un 429 ou une clé
    // invalide — mais l'état d'erreur qu'il a ajouté ne pouvait rien dire de plus, parce que la
    // CAUSE était jetée dans le service. Elle remonte maintenant jusqu'ici.
    const [justificationsError, setJustificationsError] = useState<string | null>(null);
    // Phase E.9 — modal d'ajout manuel d'une action
    const [showAddStockForm, setShowAddStockForm] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null); // suppression de position (2 clics)
    const [showImportBroker, setShowImportBroker] = useState(false);
    // [REFONTE-NAV-L2b] Comparaison multi-titres (ex-Accueil Phase D.4) : mode sélection dans le
    // sous-onglet Détail. « Comparer » arme le mode → cases à cocher sur les cartes → « Voir
    // courbe » (1 titre) / « Comparer (N) » (2+) ouvre la modale superposée (base 100).
    // Mode EXPLICITE (≠ Accueil où les cases étaient permanentes) : les cartes Détail portent déjà
    // selects/suppression — des cases permanentes ajouteraient une cible cliquable de plus partout.
    const [isCompareMode, setIsCompareMode] = useState(false);
    const [selectedCompareSymbols, setSelectedCompareSymbols] = useState<Set<string>>(new Set());
    const [showComparisonModal, setShowComparisonModal] = useState(false);
    const toggleCompareSymbol = (symbol: string) => {
        setSelectedCompareSymbols(prev => {
            const next = new Set(prev);
            if (next.has(symbol)) next.delete(symbol); else next.add(symbol);
            return next;
        });
    };
    const exitCompareMode = () => {
        setIsCompareMode(false);
        setSelectedCompareSymbols(new Set());
    };
    // [INV-COMPARE-SUBTAB] Le mode comparaison est une UI du sous-onglet Détail : en sortir le
    // désarme. Sinon l'état survivrait en SILENCE (cases cochées invisibles depuis Overview/
    // Allocation) et « Détail » rouvrirait un mode que l'utilisateur croyait quitté.
    useEffect(() => {
        if (subTab === 'portfolio' && !expertToolsOpen && detailOpen) return;
        setIsCompareMode(false);
        setSelectedCompareSymbols(new Set());
    }, [subTab, expertToolsOpen, detailOpen]);

    // --- INSTANT DATA LOAD ---
    // Utilise usePortfolioHistory hook dérivé des données réelles du portefeuille.
    const { history: portfolioHistory, noHistorySymbols, partialHistorySymbols, staleTailSymbols, syntheticTailKeys, gapBridges } = usePortfolioHistory();
    // [PERF-STALE-TAIL-ZERO] Prédicat pour seriesReturnPct : une valeur (date, clé) est-elle raccordée
    // au prix courant (candles KO) ? Deux endpoints synthétiques → « — » plutôt qu'un 0 % trompeur.
    const isSyntheticValue = useCallback(
        (date: string, key: string) => syntheticTailKeys.has(JSON.stringify([date, key])),
        [syntheticTailKeys],
    );
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoading(true);
            const data = portfolioHistory;
            if (cancelled) return;
            setMarketData(data);

            if (data.length > 0) {
                // [panel 2026-07-22] UNION des clés (les lignes réelles sont ÉPARSES — la ligne 0
                // ne porte pas les buckets nuls à cette date ni les actifs achetés plus tard).
                const allKeys = new Set<string>();
                data.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
                // Sélection par défaut : si un seul compte actif reproduit TOTAL, isoler TOTAL pour éviter deux courbes confondues.
                const keysToSelect = [...allKeys].filter(k => k.includes('TOTAL'));
                setSelectedKeys(new Set(keysToSelect.length <= 2 ? ['TOTAL'] : keysToSelect));
            }
            setIsLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [portfolioHistory]);

    const clearConfirmDelete = useCallback(() => setConfirmDeleteId(null), []);
    const {
        currentAllocation,
        geoBreakdown,
        sectorBreakdown,
        dividendCalendar,
        totalAnnualDividends,
        availableSeriesWithTrend,
        diversificationScore,
        portfolioTrend,
        benchmarkTrend,
        benchmarkTrend24,
        filteredMarketData,
        isRefreshingPrices,
        lastPriceRefreshAt,
        coursPerimes,
        handleRefreshPrices,
        handleApplyQuoteSymbol,
        handleAssetMetaChange,
        handleAssetAccountChange,
        handleDeleteAsset,
    } = useInvestmentsPortfolio({
        assets,
        setAssets,
        fxRates,
        marketData,
        perfPeriod,
        timeRange,
        isSyntheticValue,
        onAfterDelete: clearConfirmDelete,
    });

    // D2 (activation) — sans aucun actif, la page affichait un score à 0, une allocation et des
    // graphes vides (barren). On propose un accueil clair « ajoute ton premier placement » +
    // l'onglet Analyse IA accessible directement. Early-return placé APRÈS tous les hooks.
    if (assets.length === 0 && subTab !== 'ai_committee' && !expertToolsOpen) {
        return (
            <div className="space-y-6 stagger-in pb-10 relative">
                <PageHeader
                    title={TAB_LABELS[TabEnum.INVESTMENTS]}
                    nav={
                        <SubTabs<PlacementsSubTab>
                            idPrefix="placements"
                            label="Vues Placements"
                            tabs={PLACEMENTS_TABS}
                            active={subTab}
                            onSelect={(next) => {
                                setExpertToolsOpen(false);
                                setSubTab(next);
                            }}
                        />
                    }
                    actions={
                        <span className="flex flex-wrap items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setShowAddStockForm(true)}
                                className="touch-target min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-sur-accent text-xs font-semibold transition-opacity hover:opacity-90 whitespace-nowrap focus-ring"
                            >
                                <Icon name="plus" size={14} aria-hidden="true" />
                                <span>Ajouter un titre</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setExpertToolsOpen(true)}
                                aria-label="Outils experts · Quant IA"
                                aria-expanded={expertToolsOpen}
                                className="touch-target min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-semibold text-texte transition-colors whitespace-nowrap focus-ring"
                            >
                                <Icon name="flask" size={14} aria-hidden="true" />
                                <span>Outils experts</span>
                            </button>
                        </span>
                    }
                />
                <div className="gf-terminal-card premium-card p-6">
                    <div className="text-center py-12 px-4 space-y-4">
                        <Icon name="investments" size={44} className="text-ink-400 block mx-auto" />
                        <h2 className="text-h2 text-ink-50 font-bold">Ajoute ton premier placement</h2>
                        <p className="text-meta text-ink-300 max-w-md mx-auto leading-snug">
                            Saisis un titre à la main pour voir ton score de diversification, ton allocation
                            géographique/sectorielle et tes revenus passifs, ou interroge directement le Comité IA.
                        </p>
                        <div className="flex flex-wrap justify-center gap-2.5 pt-2">
                            <button
                                type="button"
                                onClick={() => setShowAddStockForm(true)}
                                className="gf-chip gf-chip-active px-4 py-2 rounded-full text-meta font-bold transition-colors focus-ring"
                            >
                                Ajouter un titre
                            </button>
                            <button
                                type="button"
                                onClick={() => setSubTab('ai_committee')}
                                className="touch-target min-h-11 gf-chip px-4 py-2 rounded-full border border-bordure-champ bg-surface-douce text-meta font-semibold text-texte hover:bg-bordure transition-colors focus-ring inline-flex items-center gap-1.5"
                            >
                                <Icon name="sparkles" size={14} aria-hidden="true" />
                                <span>Analyser un titre ou Anthropic (IA)</span>
                            </button>
                        </div>
                    </div>
                </div>
                <AddStockForm
                    isOpen={showAddStockForm}
                    onClose={() => setShowAddStockForm(false)}
                    onAdd={(newAsset) => { if (setAssets) { setAssets([...assets, newAsset]); } }}
                />
            </div>
        );
    }

    // [S5-REFONTE-PLACEMENTS] Vue d'ensemble aux maquettes (E/M-placements) : 4 chiffres, la
    // performance comparée, les titres détenus et « qui possède quoi ».
    const valeurPortefeuille = currentAllocation.reduce((t, a) => t + a.value, 0);
    // Même règle « pas de 0 % figé » que la carte Performance ([PERF-STALE-TAIL-ZERO]).
    // [COURS-AU-TROMPEUR] « Sur 24 h » n'existe que si les deux points de la série sont récents.
    const variation24h = variation24hSerieSiRecente(marketData, 'TOTAL', todayIsoLocal(), isSyntheticValue);
    const variationDepuisDebut = variationFenetre(marketData, 'TOTAL', isSyntheticValue);
    const debutHistorique = marketData[0]?.date ? String(marketData[0].date) : null;
    const moisDebut = debutHistorique
        ? formatDate(new Date(Number(debutHistorique.slice(0, 4)), Number(debutHistorique.slice(5, 7)) - 1, 1), { month: 'short', year: 'numeric' })
        : null;
    const users = configStore?.users ?? [];
    const couple = isCoupleMode(users);
    const lignesTitres: LigneTitre[] = assets
        .map((a, i) => {
            const valeur = assetValueCad(a, fxRates);
            const stats = computePurchaseStats(a);
            const fx = toCurrencyFactor(fxRates, a.currency || 'CAD');
            const prixAchat = stats?.averageCost ?? a.buyPrice;
            const gainCad = stats ? stats.totalGain * fx : undefined;
            const gainPct = stats ? stats.gainPct : null;
            const matchedValoria = valoriaSignals[(a.symbol ?? '').trim().toUpperCase()];
            return {
                cle: `${a.symbol}-${a.accountType ?? ''}-${i}`,
                symbole: a.symbol,
                nom: a.name,
                compte: a.accountType || 'NON-ENREG',
                proprietaire: couple ? nomProprietaire(a, users) : undefined,
                quantite: a.quantity,
                devise: a.currency || 'CAD',
                prixAchat,
                coursActuel: a.currentPrice,
                gainCad,
                gainPct,
                valeur,
                poids: 0,
                historique: (a.priceHistory ?? []).map((p) => p.price).filter((v) => Number.isFinite(v) && v > 0),
                valoria: matchedValoria
                    ? {
                          score100: matchedValoria.score100,
                          signal: matchedValoria.signal,
                          labelCourt: matchedValoria.labelCourt,
                      }
                    : undefined,
            };
        })
        .filter((l) => l.valeur > 0)
        .map((l) => ({ ...l, poids: valeurPortefeuille > 0 ? (l.valeur / valeurPortefeuille) * 100 : 0 }))
        .sort((x, y) => y.valeur - x.valeur);
    const enveloppesAlloc = [
        {
            id: 'celi',
            code: 'CELI',
            label: 'Compte libre d’impôt',
            classePastille: 'gf-alloc-celi',
            valeur: lignesTitres.filter((l) => l.compte === 'CELI' || l.compte === 'CELIAPP').reduce((s, l) => s + l.valeur, 0),
        },
        {
            id: 'reer',
            code: 'REER',
            label: 'Retraite enregistrée',
            classePastille: 'gf-alloc-reer',
            valeur: lignesTitres.filter((l) => l.compte === 'REER').reduce((s, l) => s + l.valeur, 0),
        },
        {
            id: 'nonreg',
            code: 'N-REG',
            label: 'Non-enregistré',
            classePastille: 'gf-alloc-nonreg',
            valeur: lignesTitres.filter((l) => l.compte === 'NON-ENREG' || l.compte === 'REEE').reduce((s, l) => s + l.valeur, 0),
        },
        {
            id: 'crypto',
            code: 'ACTIFS',
            label: 'Crypto & alternatifs',
            classePastille: 'gf-alloc-immo',
            valeur: lignesTitres.filter((l) => l.compte === 'CRYPTO').reduce((s, l) => s + l.valeur, 0),
        },
        {
            id: 'cash',
            code: 'DIV/AN',
            label: 'Rente dividendes / an',
            classePastille: 'gf-alloc-cash',
            valeur: totalAnnualDividends,
        },
    ];
    const couleurVariation = (v: number | null) => (v === null ? 'text-ink-400' : v >= 0 ? 'text-succes-texte' : 'text-erreur-texte');
    const scoreClasses = diversificationScore >= 80
        ? 'gf-delta-up'
        // Maquettes : 40/100 en ambre (à surveiller), le rouge réservé au bas de l'échelle.
        : diversificationScore >= 40 ? 'gf-delta-amber' : 'gf-delta-down';
    const badgeScore = (
        <span
            className={`h-[30px] lg:h-9 px-3 lg:px-4 rounded-full border text-meta lg:text-[13px] font-semibold flex items-center gap-1 whitespace-nowrap ${scoreClasses}`}
            title="Sous-mesure : diversification du portefeuille + tendance vs marché (le score de santé financière GLOBAL est sur l'Accueil)"
        >
            <span>{'Diversification '}</span>
            <span><PrivateAmount>{diversificationScore}</PrivateAmount>/100</span>
        </span>
    );
    const lienFutur = (
        <button type="button" onClick={() => navigateWithFocus(TabEnum.FUTURE)} className="sr-only self-start min-h-6 text-meta text-ink-100 underline underline-offset-2 decoration-bordure-champ hover:text-ink-50 focus-ring rounded-sm">
            {horizonSnapshot ? 'Détail par compte dans Futur →' : 'Calculer la projection dans Futur →'}
        </button>
    );
    const etiquetteTuile = 'font-mono text-meta lg:text-[11px] lg:font-semibold lg:tracking-[0.06em] lg:uppercase text-ink-400';
    const pillVariation = (v: number | null) =>
        v === null ? 'gf-delta-neutral' : v >= 0 ? 'gf-delta-up' : 'gf-delta-down';

    return (
        <div className="space-y-5 stagger-in pb-10 relative">

            {/* [PH2-c-2] — signal inter-onglets : dernier recalcul de projection échoué. */}
            <ProjectionStaleBanner />
            <PageHeader
                title={TAB_LABELS[TabEnum.INVESTMENTS]}
                nav={
                    <SubTabs<PlacementsSubTab>
                        idPrefix="placements"
                        label="Vues Placements"
                        tabs={PLACEMENTS_TABS}
                        active={subTab}
                        onSelect={(next) => {
                            setExpertToolsOpen(false);
                            setSubTab(next);
                        }}
                    />
                }
                actions={
                    // [FX-FALLBACK-SILENCIEUX] : les totaux de cette page convertissent des avoirs
                    // étrangers en CAD — le signal doit vivre ICI (pastille à côté du score).
                    <span className="flex flex-wrap items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setShowAddStockForm(true)}
                            className="touch-target min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent text-sur-accent text-xs font-semibold transition-opacity hover:opacity-90 whitespace-nowrap focus-ring"
                        >
                            <Icon name="plus" size={14} aria-hidden="true" />
                            <span>Ajouter un titre</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setExpertToolsOpen((prev) => !prev)}
                            aria-label="Outils experts · Quant IA"
                            aria-expanded={expertToolsOpen}
                            className="touch-target min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-semibold text-texte transition-colors whitespace-nowrap focus-ring"
                        >
                            <Icon name="flask" size={14} aria-hidden="true" />
                            <span>Outils experts</span>
                        </button>
                        <FxEstimateBadge size="md" />
                        {badgeScore}
                    </span>
                }
            />

            {expertToolsOpen ? (
                <div className="space-y-4">
                    <div className="gf-terminal-card bg-surface border border-bordure px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs sm:text-sm font-semibold text-ink-100">
                            Outils quantitatifs avancés Valoria (7 Agents, Backtest, Black-Litterman)
                        </div>
                        <button
                            type="button"
                            onClick={() => setExpertToolsOpen(false)}
                            className="touch-target min-h-11 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-douce border border-bordure-champ text-xs font-semibold text-texte hover:bg-bordure transition-colors focus-ring"
                        >
                            <Icon name="chevron-left" size={14} aria-hidden="true" />
                            <span>Retour à Placements</span>
                        </button>
                    </div>
                    <Suspense fallback={<Skeleton variant="chart" className="h-96" />}>
                        <ValoriaWorkspace embeddedInPlacements />
                    </Suspense>
                </div>
            ) : (
            <div key={subTab} role="tabpanel" id={panelId('placements', subTab)} aria-labelledby={tabId('placements', subTab)} tabIndex={0} className="space-y-5 focus-ring rounded-card animate-tab-in stagger-in">
            {subTab === 'ai_committee' && (
                <MultiAgentCommitteeView
                    initialQuestion={committeePrefillQuestion}
                    onClearInitialQuestion={() => setCommitteePrefillQuestion(null)}
                    onAddTicker={() => setShowAddStockForm(true)}
                    onOpenSettings={() => navigateWithFocus(TabEnum.SETTINGS)}
                />
            )}

            {/* Ruban d'allocation par enveloppe + KPI + Graphe + Titres détenus + 2 sections repliables */}
            {subTab === 'portfolio' && (
                <>
                    <CoursPerimesNotice titres={coursPerimes} />
                    <CeliAssetNudge onAddAsset={() => setShowAddStockForm(true)} />
                    <BrokerReconciliationCard variant="compact" />
                    <section
                        aria-label="Enveloppes fiscales et flux de dividendes"
                        className="gf-terminal-card bg-surface border border-bordure"
                    >
                <div className="flex overflow-x-auto no-scrollbar lg:grid lg:grid-cols-5 divide-x divide-bordure">
                    {enveloppesAlloc.map((env) => {
                        const poidsEnv = valeurPortefeuille > 0 && env.id !== 'cash'
                            ? Math.round((env.valeur / valeurPortefeuille) * 100)
                            : null;
                        return (
                            <div
                                key={env.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => setDetailOpen(true)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setDetailOpen(true);
                                    }
                                }}
                                className="touch-target shrink-0 min-w-[160px] lg:min-w-0 px-3.5 py-2.5 text-left hover:bg-surface-douce flex items-center justify-between gap-2 transition-colors focus-ring cursor-pointer"
                            >
                                <div className="min-w-0">
                                    <div className="flex items-center gap-1.5">
                                        <span className={`w-2 h-2 rounded-full shrink-0 ${env.classePastille}`} aria-hidden="true" />
                                        <span className="font-mono text-[11px] font-bold tracking-tight text-ink-50">
                                            {env.code}
                                        </span>
                                        <span className="text-[11px] text-ink-400 truncate">
                                            {env.label}
                                        </span>
                                    </div>
                                    <div className="font-mono text-xs sm:text-sm font-bold text-ink-50 tabular-nums mt-0.5">
                                        <PrivateAmount>{formatCAD(env.valeur)}</PrivateAmount>
                                    </div>
                                </div>
                                {poidsEnv !== null && (
                                    <span className={`shrink-0 px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold tabular-nums ${env.valeur > 0 ? 'gf-delta-up' : 'gf-delta-neutral'}`}>
                                        <PrivateAmount>{`${poidsEnv.toFixed(0)}%`}</PrivateAmount>
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
                    </section>

                <section aria-label="Chiffres clés" className="gf-quote-strip">
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setDetailOpen((o) => !o)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailOpen((o) => !o); } }}
                        className="gf-quote-cell touch-target cursor-pointer focus-ring group sm:col-span-1 lg:col-span-2"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className={etiquetteTuile}>Valeur du portefeuille</span>
                            <span className="text-[11px] font-semibold text-ink-200 group-hover:text-ink-50">
                                Voir le détail ▾
                            </span>
                        </div>
                        <div className="flex items-baseline gap-2.5 flex-wrap">
                            <PrivateAmount as="div" className="font-mono text-[22px] font-bold text-ink-50">{formatCAD(valeurPortefeuille)}</PrivateAmount>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-mono font-semibold ${pillVariation(variation24h)}`}>
                                <PrivateAmount>{formatVariationPct(variation24h, 2)}</PrivateAmount> (24h)
                            </span>
                            {variationDepuisDebut !== null && (
                                <span className={`text-xs font-mono ${couleurVariation(variationDepuisDebut)}`}>
                                    · <PrivateAmount>{formatVariationPct(variationDepuisDebut)}</PrivateAmount> depuis {moisDebut ?? 'le début'}
                                </span>
                            )}
                        </div>
                        {/* MONTANT-PUBLIC : variation de l'indice de marché, pas celle du portefeuille. */}
                        {benchmarkTrend24 !== null && <span className="text-tiny text-ink-400">marché (MSCI World) {formatVariationPct(benchmarkTrend24, 2)}</span>}
                        {!isPrivacyMode && lignesTitres.length > 0 && (
                            <div className="mt-1 h-2 w-full rounded-full bg-fond overflow-hidden flex gap-0.5 p-0.5 gf-bar-grow" aria-hidden="true">
                                {lignesTitres.slice(0, 5).map((l, idx) => (
                                    <div
                                        key={l.cle}
                                        className={`h-full ${idx === 0 ? 'gf-alloc-celi' : idx === 1 ? 'gf-alloc-reer' : idx === 2 ? 'gf-alloc-immo' : idx === 3 ? 'gf-alloc-cash' : 'gf-alloc-nonreg'}`}
                                        // MONTANT-MASQUE-AILLEURS : bloc entier sous !isPrivacyMode
                                        style={{ width: `${Math.max(3, l.poids)}%` }}
                                        title={`${l.symbole} (${l.compte})`}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <div
                        role="button"
                        tabIndex={0}
                        onClick={() => navigateWithFocus(TabEnum.FUTURE)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateWithFocus(TabEnum.FUTURE); } }}
                        className="gf-quote-cell touch-target cursor-pointer focus-ring group sm:col-span-1 lg:col-span-2"
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span className={etiquetteTuile}>Patrimoine net en {horizonSnapshot?.year ?? '—'}</span>
                            <span className="text-[11px] font-semibold text-ink-200 group-hover:text-ink-50">
                                Ouvrir Futur ↗
                            </span>
                        </div>
                        {horizonSnapshot
                            ? <PrivateAmount as="div" className="font-mono text-[22px] font-bold text-ink-50">{formatCAD(horizonSnapshot.netWorth)}</PrivateAmount>
                            : <div className="font-mono text-[22px] font-bold text-ink-400">—</div>}
                        {!isPrivacyMode && horizonSnapshot && valeurPortefeuille > 0 && (
                            <div className="mt-1 h-2 w-full rounded-full bg-fond overflow-hidden flex gap-0.5 p-0.5 gf-bar-grow" aria-hidden="true">
                                <div
                                    className="h-full rounded-l-full gf-alloc-celi"
                                    // MONTANT-MASQUE-AILLEURS : bloc entier sous !isPrivacyMode
                                    style={{ width: `${Math.min(95, Math.max(8, (valeurPortefeuille / Math.max(1, horizonSnapshot.netWorth)) * 100))}%` }}
                                />
                                <div className="h-full rounded-r-full gf-alloc-reer" style={{ flex: 1 }} />
                            </div>
                        )}
                        {lienFutur}
                    </div>
                </section>

                <PerformanceComparee
                    donnees={filteredMarketData}
                    series={availableSeriesWithTrend}
                    selection={selectedKeys}
                    onSelection={setSelectedKeys}
                    periode={timeRange}
                    onPeriode={setTimeRange}
                    estSynthetique={isSyntheticValue}
                    chargement={isLoading}
                    etroit={etroit}
                >
                    {/* [HIST-COVERAGE-TOTAL] Même signalement honnête que le Dashboard (composant
                        partagé) : c'est ICI que Marc lit la courbe TOTAL. */}
                    <HistoryCoverageNote noHistorySymbols={noHistorySymbols} partialHistorySymbols={partialHistorySymbols}
                        staleTailSymbols={staleTailSymbols} gapBridges={gapBridges} hasChart={portfolioHistory.length > 0} />
                    {/* [HIST-MULTI-PROVIDER] Diagnostic par titre + remède inline (symbole de cotation,
                        recherche par nom). Jamais rendu en mode test (tickers réels). */}
                    <HistorySyncDoctor onApplyQuoteSymbol={handleApplyQuoteSymbol} isSyncing={isRefreshingPrices} />
                </PerformanceComparee>

                <div className="space-y-5">
                    <TitresDetenus
                        lignes={lignesTitres}
                        couple={couple}
                        etroit={etroit}
                        onSelectSymbole={(sym) => {
                            setSelectedKeys(new Set([sym]));
                            document.getElementById('perf-comparee-titre')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }}
                        onInspectValoria={(sym) => {
                            navigateWithFocus(TabEnum.INVESTMENTS, `asset:${sym}`);
                            setExpertToolsOpen(true);
                        }}
                        onAnalyzeAi={(sym, nom) => {
                            setCommitteePrefillQuestion(
                                `Est-ce que ça vaut le coup d’acheter, conserver ou renforcer ${nom ? `${nom} (${sym})` : sym} ?`,
                            );
                            setExpertToolsOpen(false);
                            setSubTab('ai_committee');
                        }}
                    />
                    {/* CI-1000x Phase 1 (axe B) — répartition du portefeuille par personne (mode couple), pleine largeur sans colonne vide. */}
                    <NetWorthByOwnerCard assets={assets} setAssets={setAssets} />
                </div>

            {/* Section repliable 1 (fermée par défaut) : Répartition & rééquilibrage */}
            <CollapsibleSection
                title="Répartition & rééquilibrage"
                subtitle="Donuts géographique/sectoriel et écarts par rapport aux cibles"
                icon={<Icon name="goal" size={16} />}
                headingLevel={2}
                open={allocationOpen}
                onToggle={setAllocationOpen}
            >
                <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 min-h-[300px]">
                        {/* REGIONS */}
                        <div className="gf-terminal-card p-5 flex flex-col">
                            <div className="flex items-center justify-between gap-2 mb-4 pb-2.5 border-b border-bordure">
                                <h4 className="text-ink-300 text-[11px] font-bold uppercase tracking-wider">Répartition Géographique</h4>
                                <span className="font-mono text-[11px] text-ink-400">{geoBreakdown.length} zones</span>
                            </div>
                            <div className="flex-1 flex flex-col lg:flex-row items-center gap-4">
                                <div className="flex-1 w-full h-[200px]" role="img" aria-label="Donut de répartition géographique du portefeuille">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={geoBreakdown}
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                                stroke="none"
                                                isAnimationActive={true}
                                                animationDuration={340}
                                                animationEasing="ease-out"
                                                onClick={(entry: { name?: string }) => entry.name && setAllocationFilter({ type: 'region', value: entry.name })}
                                                cursor="pointer"
                                            >
                                                {geoBreakdown.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={COLORS_REGION[entry.name] || '#444'}
                                                        opacity={allocationFilter?.type === 'region' && allocationFilter.value !== entry.name ? 0.3 : 1}
                                                    />
                                                ))}
                                            </Pie>
                                            <ReTooltip isAnimationActive={true} animationDuration={90} content={<AllocationDonutTooltip isPrivacyMode={isPrivacyMode} categoryLabel="Région" />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <ChartDataTable
                                    caption="Répartition géographique du portefeuille"
                                    columns={allocationColumns}
                                    rows={geoBreakdown as unknown as ReadonlyArray<Record<string, unknown>>}
                                />
                                <div className="flex-1 w-full space-y-1.5 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                                    {geoBreakdown.map(item => {
                                        const isActive = allocationFilter?.type === 'region' && allocationFilter.value === item.name;
                                        return (
                                            <button
                                                key={item.name}
                                                type="button"
                                                onClick={() => setAllocationFilter(isActive ? null : { type: 'region', value: item.name })}
                                                className={`gf-row w-full flex justify-between items-center text-meta px-3 py-2 rounded-lg transition-colors focus-ring ${
                                                    isActive ? 'bg-bordure border border-bordure-champ' : 'bg-surface-douce hover:bg-bordure border border-transparent'
                                                }`}
                                                aria-pressed={isActive}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS_REGION[item.name] || '#444' }}></span>
                                                    <span className="text-ink-100 font-medium truncate">{item.name}</span>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <PrivateAmount as="div" className="text-texte font-mono font-bold tabular-nums">{formatCAD(item.value)}</PrivateAmount>
                                                    <div className="text-tiny font-mono text-ink-400 tabular-nums"><PrivateAmount>{item.percent.toFixed(1)}%</PrivateAmount></div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* SECTORS */}
                        <div className="gf-terminal-card p-5 flex flex-col">
                            <div className="flex items-center justify-between gap-2 mb-4 pb-2.5 border-b border-bordure">
                                <h4 className="text-ink-300 text-[11px] font-bold uppercase tracking-wider">Répartition Sectorielle</h4>
                                <span className="font-mono text-[11px] text-ink-400">{sectorBreakdown.length} secteurs</span>
                            </div>
                            <div className="flex-1 flex flex-col lg:flex-row items-center gap-4">
                                <div className="flex-1 w-full h-[200px]" role="img" aria-label="Donut de répartition sectorielle du portefeuille">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={sectorBreakdown}
                                                innerRadius={60}
                                                outerRadius={80}
                                                paddingAngle={5}
                                                dataKey="value"
                                                stroke="none"
                                                isAnimationActive={true}
                                                animationDuration={340}
                                                animationEasing="ease-out"
                                                onClick={(entry: { name?: string }) => entry.name && setAllocationFilter({ type: 'sector', value: entry.name })}
                                                cursor="pointer"
                                            >
                                                {sectorBreakdown.map((entry, index) => (
                                                    <Cell
                                                        key={`cell-${index}`}
                                                        fill={COLORS_SECTOR[entry.name] || '#444'}
                                                        opacity={allocationFilter?.type === 'sector' && allocationFilter.value !== entry.name ? 0.3 : 1}
                                                    />
                                                ))}
                                            </Pie>
                                            <ReTooltip isAnimationActive={true} animationDuration={90} content={<AllocationDonutTooltip isPrivacyMode={isPrivacyMode} categoryLabel="Secteur" />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <ChartDataTable
                                    caption="Répartition sectorielle du portefeuille"
                                    columns={allocationColumns}
                                    rows={sectorBreakdown as unknown as ReadonlyArray<Record<string, unknown>>}
                                />
                                <div className="flex-1 w-full space-y-1.5 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                                    {sectorBreakdown.map(item => {
                                        const isActive = allocationFilter?.type === 'sector' && allocationFilter.value === item.name;
                                        return (
                                            <button
                                                key={item.name}
                                                type="button"
                                                onClick={() => setAllocationFilter(isActive ? null : { type: 'sector', value: item.name })}
                                                className={`gf-row w-full flex justify-between items-center text-meta px-3 py-2 rounded-lg transition-colors focus-ring ${
                                                    isActive ? 'bg-bordure border border-bordure-champ' : 'bg-surface-douce hover:bg-bordure border border-transparent'
                                                }`}
                                                aria-pressed={isActive}
                                            >
                                                <div className="flex items-center gap-2.5 min-w-0">
                                                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: COLORS_SECTOR[item.name] || '#444' }}></span>
                                                    <span className="text-ink-100 font-medium truncate">{item.name}</span>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <PrivateAmount as="div" className="text-texte font-mono font-bold tabular-nums">{formatCAD(item.value)}</PrivateAmount>
                                                    <div className="text-tiny font-mono text-ink-400 tabular-nums"><PrivateAmount>{item.percent.toFixed(1)}%</PrivateAmount></div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>

                    {allocationFilter && (
                        <div className="mt-4 p-4 gf-terminal-card">
                            <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-bordure">
                                <h4 className="text-body font-bold text-texte flex items-center gap-2">
                                    <Icon name={allocationFilter.type === 'region' ? 'globe' : 'building'} size={16} className="text-ink-300" />
                                    Actions en <span className="text-primary">{allocationFilter.value}</span>
                                </h4>
                                <button
                                    type="button"
                                    onClick={() => setAllocationFilter(null)}
                                    className="gf-chip text-tiny text-ink-300 hover:text-ink-100 px-3 py-1 rounded-full transition-colors focus-ring"
                                >
                                    Effacer filtre
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                {currentAllocation
                                    .filter(a => allocationFilter.type === 'region' ? a.region === allocationFilter.value : a.sector === allocationFilter.value)
                                    .sort((a, b) => b.value - a.value)
                                    .map(a => (
                                        <div key={a.id} className="gf-row bg-surface-douce p-3.5 rounded-xl border border-bordure flex flex-col justify-between gap-1.5">
                                            <div className="flex justify-between items-start gap-2">
                                                <span className="font-bold text-texte text-body truncate">{a.name}</span>
                                                <span className="px-1.5 py-0.5 rounded-sm bg-fond border border-bordure text-tiny text-ink-300 font-mono tabular-nums"><PrivateAmount>{a.weight.toFixed(1)}%</PrivateAmount></span>
                                            </div>
                                            <div className="flex items-baseline justify-between gap-2 pt-1">
                                                <PrivateAmount as="div" className="text-meta font-mono font-bold text-ink-100 tabular-nums">{formatCAD(a.value)}</PrivateAmount>
                                                <div className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-tiny font-mono font-semibold tabular-nums ${a.trendPct === null ? 'gf-delta-neutral text-ink-400' : a.trendPct >= 0 ? 'gf-delta-up text-success-400' : 'gf-delta-down text-danger-400'}`}>
                                                    {/* MONTANT-PUBLIC : variation du PRIX DE MARCHÉ du titre (décision de Marc : laissée visible). */}
                                                    {a.trendPct === null ? '—' : `${a.trendPct >= 0 ? '+' : ''}${a.trendPct.toFixed(2)}%`} ({PERF_PERIOD_LABELS[perfPeriod]})
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}

                    {currentAllocation.length > 0 && (() => {
                        const totalPortfolio = currentAllocation.reduce((s, a) => s + a.value, 0);

                        const rebalancingActions = targetModel.map(target => {
                            const currentVal = currentAllocation
                                .filter(a => target.sectors.some(s => a.sector === s))
                                .reduce((s, a) => s + a.value, 0);
                            const currentPct = totalPortfolio > 0 ? (currentVal / totalPortfolio) * 100 : 0;
                            const diffPct = currentPct - target.targetPct;
                            const diffAmount = (diffPct / 100) * totalPortfolio;

                            let action: 'SELL' | 'BUY' | 'OK' = 'OK';
                            if (diffPct > 3) action = 'SELL';
                            else if (diffPct < -3) action = 'BUY';

                            return { ...target, currentPct, diffPct, diffAmount, action };
                        });

                        const hasActions = rebalancingActions.some(a => a.action !== 'OK');
                        const sumTargets = targetModel.reduce((sum, t) => sum + t.targetPct, 0);

                        return (
                            <div className="pt-4 border-t border-bordure">
                                <div className="flex items-center gap-2 mb-3">
                                    <Icon name="budget" size={18} className="text-ink-200" />
                                    <h3 className="text-sm font-bold text-texte">Rééquilibrage</h3>
                                    {hasActions ? <Badge variant="warning" size="sm">Action requise</Badge> : <Badge variant="success" size="sm">OK</Badge>}
                                </div>
                                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-bordure">
                                    <div>
                                        <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Assiette de rééquilibrage</div>
                                        <PrivateAmount as="div" className="text-2xl font-bold font-mono text-texte tabular-nums">
                                            {formatCAD(totalPortfolio)}
                                        </PrivateAmount>
                                    </div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {hasActions && geminiKey && (
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (useFinanceStore.getState().isPrivacyMode) {
                                                        setJustificationsError(MESSAGE_IA_MODE_DISCRET);
                                                        return;
                                                    }
                                                    setIsFetchingJustifications(true);
                                                    setJustificationsError(null);
                                                    const inputs: RebalanceActionInput[] = rebalancingActions.map(a => ({
                                                        id: a.id,
                                                        label: a.label,
                                                        action: a.action,
                                                        currentPct: a.currentPct,
                                                        targetPct: a.targetPct,
                                                        diffAmount: a.diffAmount,
                                                    }));
                                                    const res = await getRebalanceJustifications(inputs, geminiKey);
                                                    if (res.forme === 'ok') {
                                                        const map = new Map<string, string>();
                                                        res.justifications.forEach(j => map.set(j.actionId, j.reason));
                                                        setIaJustifications(map);
                                                    } else if (res.forme === 'echec') {
                                                        setJustificationsError(messageErreurIa(res.err));
                                                    } else if (res.forme === 'sans-cle') {
                                                        setJustificationsError(messageErreurIa(null, { cleAbsente: true }));
                                                    } else if (res.forme === 'sans-reponse') {
                                                        setJustificationsError("L'IA n'a rien rendu d'exploitable pour ces actions. Réessaie.");
                                                    }
                                                    setIsFetchingJustifications(false);
                                                }}
                                                disabled={isFetchingJustifications}
                                                className="gf-chip px-3 py-1.5 bg-surface-douce text-texte border border-bordure-champ rounded-full text-meta font-bold hover:bg-accent hover:text-sur-accent transition-colors disabled:opacity-50"
                                            >
                                                {isFetchingJustifications ? 'Analyse…' : 'Pourquoi ces actions ?'}
                                            </button>
                                        )}
                                        {justificationsError !== null && (
                                            <p role="status" className="text-danger-400 text-tiny">
                                                {justificationsError}
                                            </p>
                                        )}
                                        <button
                                            aria-pressed={isRebalanceEdit}
                                            onClick={() => setIsRebalanceEdit(!isRebalanceEdit)}
                                            className={`gf-chip px-3 py-1.5 border rounded-full text-meta font-bold transition-colors ${isRebalanceEdit ? 'gf-chip-active' : 'bg-surface-douce text-texte border-bordure-champ hover:bg-accent hover:text-sur-accent'}`}
                                        >
                                            {isRebalanceEdit ? 'Terminer' : 'Modifier Cibles'}
                                        </button>
                                    </div>
                                </div>

                                {isRebalanceEdit && (
                                    <div
                                        role="status"
                                        aria-live="polite"
                                        className={sumTargets !== 100
                                            ? 'text-danger-400 text-meta font-bold mb-4 bg-erreur-fond p-3 rounded-lg border border-danger-500/20 animate-pulse flex items-center gap-2'
                                            : 'sr-only'}
                                    >
                                        {sumTargets !== 100 && (
                                            <><Icon name="alert" size={14} /> Le total des cibles doit être de 100% (Actuel : {sumTargets}%)</>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-3 mb-6">
                                    {rebalancingActions.map((item, i) => (
                                        <div key={i} className={`gf-terminal-card p-4 rounded-xl border transition-all ${!isRebalanceEdit && item.action === 'SELL' ? 'border-danger-500/30 bg-erreur-fond' :
                                            !isRebalanceEdit && item.action === 'BUY' ? 'border-succes-texte/30 bg-succes-fond' :
                                                'border-bordure bg-surface-douce'
                                            }`}>
                                            <div className="flex items-center justify-between gap-3 mb-2">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-9 h-9 rounded-lg bg-fond border border-bordure flex items-center justify-center shrink-0">
                                                        <Icon name={item.icon} size={18} className="text-ink-200" />
                                                    </div>
                                                    <div>
                                                        <div className="text-texte font-bold text-body">{item.label}</div>
                                                        <div className="text-tiny text-ink-400 flex items-center gap-2 mt-1 font-mono">
                                                            <span>Actuel: <span className="text-ink-200 font-bold"><PrivateAmount>{item.currentPct.toFixed(1)}%</PrivateAmount></span></span>
                                                            <span className="opacity-50">|</span>
                                                            {isRebalanceEdit ? (
                                                                <div className="flex items-center gap-1">
                                                                    <span>Cible:</span>
                                                                    <div className="relative">
                                                                        <input
                                                                            aria-label={`Allocation cible pour ${item.label} (pourcentage)`}
                                                                            type="number"
                                                                            min="0"
                                                                            max="100"
                                                                            className="w-16 bg-fond/50 border border-bordure-champ rounded-sm px-2 py-0.5 text-texte font-bold outline-hidden focus:border-accent focus:ring-1 focus:ring-accent transition-all text-right"
                                                                            value={item.targetPct}
                                                                            onChange={(e) => {
                                                                                const cible = Number(e.target.value);
                                                                                setTargetModel(targetModel.map((m, idx) => (idx === i ? { ...m, targetPct: cible } : m)));
                                                                            }}
                                                                        />
                                                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-300 pointer-events-none text-tiny">%</span>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <span>Cible: <span className="text-texte font-bold">{item.targetPct}%</span></span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    {!isRebalanceEdit && item.action === 'SELL' && (
                                                        <div className="inline-flex items-center px-2.5 py-1 rounded-full font-mono font-bold text-meta gf-delta-down text-danger-400">
                                                            → Vendre <PrivateAmount>{formatCAD(Math.round(Math.abs(item.diffAmount)))}</PrivateAmount>
                                                        </div>
                                                    )}
                                                    {!isRebalanceEdit && item.action === 'BUY' && (
                                                        <div className="inline-flex items-center px-2.5 py-1 rounded-full font-mono font-bold text-meta gf-delta-up text-succes-texte">
                                                            → Acheter <PrivateAmount>{formatCAD(Math.round(Math.abs(item.diffAmount)))}</PrivateAmount>
                                                        </div>
                                                    )}
                                                    {!isRebalanceEdit && item.action === 'OK' && (
                                                        <div className="inline-flex items-center px-2.5 py-1 rounded-full font-mono text-tiny font-bold gf-delta-neutral text-ink-300">
                                                            CIBLE ATTEINTE
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="relative w-full h-2 bg-fond/50 rounded-full overflow-hidden mt-3 shadow-inner">
                                                <div
                                                    className="absolute left-0 top-0 h-full rounded-full transition-all duration-700 shadow-[0_0_10px_rgba(255,255,255,0.2)]"
                                                    style={{
                                                        width: `${isPrivacyMode ? 0 : Math.min(100, item.currentPct)}%`,
                                                        backgroundColor: item.color,
                                                    }}
                                                />
                                                <div
                                                    className="absolute top-0 h-full w-0.5 bg-texte opacity-80 shadow-[0_0_5px_var(--texte)]"
                                                    style={{ left: `${item.targetPct}%` }}
                                                />
                                            </div>
                                            {iaJustifications.has(item.id) && (
                                                <div className="mt-3 pt-3 border-t border-bordure text-tiny text-ink-300 italic flex gap-2">
                                                    <Icon name="sparkles" size={12} className="text-ink-400 shrink-0 mt-0.5" />
                                                    <span className="leading-relaxed">{iaJustifications.get(item.id)}</span>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </CollapsibleSection>

            {/* Section repliable 2 (fermée par défaut) : Détail des titres, DCA & dividendes */}
            <CollapsibleSection
                title="Détail des titres, DCA & dividendes"
                subtitle="Performance par période, coûts moyens, comparaison multi-titres et dividendes"
                icon={<Icon name="package" size={16} />}
                headingLevel={2}
                open={detailOpen}
                onToggle={(next) => {
                    setDetailOpen(next);
                    if (!next) exitCompareMode();
                }}
                badge={<Badge variant="neutral" size="sm">{currentAllocation.length} actifs</Badge>}
            >
                <div className="space-y-5">
                {/* [INVEST-PERF-PERIOD] Période AU CHOIX (24h par défaut) — pilote aussi la variation des
                    cartes par titre ci-dessous. */}
                <Card
                    title={`Performance (${PERF_PERIOD_LABELS[perfPeriod]})`}
                    action={
                        <Pill
                            aria-label="Période de performance"
                            size="sm"
                            value={perfPeriod}
                            onChange={(v) => setPerfPeriod(v as PerfPeriod)}
                            options={PERF_PERIODS.map(p => ({ value: p, label: PERF_PERIOD_LABELS[p] }))}
                        />
                    }
                >
                    <div className="gf-quote-strip sm:grid-cols-2 rounded-xl overflow-hidden">
                        <div className="gf-quote-cell flex flex-col items-center justify-center p-4">
                            <div className="kpi-label mb-1.5">Votre portefeuille</div>
                            <div className={`inline-flex items-center px-3 py-1 rounded-full text-kpi font-mono tabular-nums ${portfolioTrend === null ? 'gf-delta-neutral text-ink-400' : portfolioTrend >= 0 ? 'gf-delta-up text-success-400' : 'gf-delta-down text-danger-400'}`}>
                                <PrivateAmount>{formatVariationPct(portfolioTrend, 2)}</PrivateAmount>
                            </div>
                        </div>
                        <div className="gf-quote-cell flex flex-col items-center justify-center p-4">
                            <div className="kpi-label mb-1.5">Marché (MSCI World)</div>
                            <div className={`inline-flex items-center px-3 py-1 rounded-full text-kpi font-mono tabular-nums ${benchmarkTrend === null ? 'gf-delta-neutral text-ink-400' : benchmarkTrend >= 0 ? 'gf-delta-up text-info-400' : 'gf-delta-down text-danger-400'}`}>
                                {/* MONTANT-PUBLIC : performance de l'indice de référence (marché). */}
                                {formatVariationPct(benchmarkTrend, 2)}
                            </div>
                        </div>
                    </div>
                </Card>
                {/* Phase E.9 — bouton d'ajout manuel d'action · [PRICE-REFRESH-LIVE] actualisation des cours */}
                <div className="gf-terminal-card px-4 py-2.5 flex justify-end items-center gap-2 flex-wrap overflow-x-auto no-scrollbar">
                    {lastPriceRefreshAt != null && (
                        <span className="font-mono text-tiny text-ink-400 mr-auto">
                            {/* [COURS-AU-TROMPEUR] C'est l'heure du dernier rafraîchissement, pas la date des
                                cours : l'âge de chaque cours est dit par CoursPerimesNotice. */}
                            Actualisé le {formatDate(lastPriceRefreshAt)} {new Date(lastPriceRefreshAt).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handleRefreshPrices}
                        disabled={isRefreshingPrices}
                        aria-busy={isRefreshingPrices}
                        className="gf-chip px-3 py-1.5 bg-surface-douce hover:bg-bordure border border-bordure-champ text-ink-200 text-tiny font-bold rounded-full transition-colors focus-ring disabled:opacity-50"
                    >
                        {isRefreshingPrices ? 'Actualisation…' : 'Actualiser les cours'}
                    </button>
                    {/* [REFONTE-NAV-L2b] Comparaison multi-titres (ex-Accueil).
                        [A11Y-COMPARE-FOCUS] UN SEUL bouton bascule PERSISTANT (libellé/action
                        changent, aria-pressed) : l'ancien ternaire démontait le bouton au toggle
                        → focus clavier perdu vers <body> (mesuré). Un élément qui persiste garde
                        le focus PAR CONSTRUCTION — pas de restauration manuelle à maintenir. */}
                    {isCompareMode && (
                        selectedCompareSymbols.size > 0 ? (
                            <button
                                type="button"
                                onClick={() => setShowComparisonModal(true)}
                                className="touch-target gf-chip gf-chip-active inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-tiny font-bold rounded-full transition-colors focus-ring"
                            >
                                <Icon name="chart" size={14} />{selectedCompareSymbols.size === 1 ? 'Voir courbe' : `Comparer (${selectedCompareSymbols.size})`}
                            </button>
                        ) : (
                            <span className="text-tiny text-ink-400 italic">Coche pour comparer</span>
                        )
                    )}
                    <button
                        type="button"
                        onClick={() => (isCompareMode ? exitCompareMode() : setIsCompareMode(true))}
                        aria-pressed={isCompareMode}
                        className={`touch-target gf-chip px-3 py-1.5 border text-tiny font-bold rounded-full transition-colors focus-ring ${isCompareMode ? 'gf-chip-active text-primary' : 'bg-surface-douce hover:bg-bordure border-bordure-champ text-ink-200'}`}
                    >
                        {isCompareMode ? 'Quitter la comparaison' : 'Comparer'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowImportBroker(true)}
                        className="gf-chip px-3 py-1.5 bg-surface-douce hover:bg-bordure border border-bordure-champ text-ink-200 text-tiny font-bold rounded-full transition-colors focus-ring"
                    >
                        Importer (CSV courtier)
                    </button>
                    <button
                        type="button"
                        onClick={() => setShowAddStockForm(true)}
                        className="gf-chip gf-chip-active px-3 py-1.5 bg-primary/15 hover:bg-primary/25 border border-primary/40 text-primary text-tiny font-bold rounded-full transition-colors focus-ring"
                    >
                        + Ajouter une action
                    </button>
                </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {currentAllocation.map((asset) => {
                    // Try to find matching asset in props to get saved account type (matching EXACT)
                    const savedAsset = assets.find(a => historyKeyMatchesSymbol(asset.id, a.symbol));
                    const accountType = savedAsset?.accountType || 'NON-ENREG';
                    // Phase E.8 — stats DCA si purchases[] présent. ⚠️ Prix NATIF de l'actif (comme
                    // buyPrice/purchases[].price) — surtout PAS re-dérivé de asset.value, qui est
                    // désormais en CAD ([ASSET-FX-DISPLAY]) : mélanger CAD et natif fausserait le gain.
                    // (L'ancien `asset.value / quantity` était une identité du prix natif — plus maintenant.)
                    const purchaseStats = savedAsset ? computePurchaseStats(savedAsset) : null;
                    // [REFONTE-NAV-L2b] Sélection pour la comparaison superposée (mode « Comparer »).
                    const isCompareSelected = selectedCompareSymbols.has(asset.id);

                    return (
                        <div key={asset.id} className={`gf-terminal-card premium-card border p-5 rounded-2xl transition-all group relative overflow-hidden flex flex-col justify-between animate-premium-in shadow-xl ${
                            isCompareMode && isCompareSelected ? 'border-primary/40 bg-primary/10' : 'border-bordure hover:border-bordure-champ'
                        }`}>
                            {/* Background Gradient based on sector */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-linear-to-bl/srgb from-bordure to-transparent -mr-8 -mt-8 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"></div>

                            <div>
                                <div className="flex justify-between items-start mb-4 relative z-10">
                                    <div className="flex items-center gap-3 min-w-0">
                                        {/* [REFONTE-NAV-L2b] Case de sélection (mode Comparer uniquement) —
                                            même visuel que l'ex-Accueil, mais bouton DÉDIÉ : la carte porte
                                            déjà selects/suppression, un clic-carte serait ambigu. */}
                                        {isCompareMode && (
                                            // [A11Y-TOUCH] Surface tactile 44px (patron Planning.tsx :
                                            // .touch-target sur le bouton, visuel 16px DANS un span).
                                            // Marge négative : la zone cliquable déborde sans pousser
                                            // la mise en page de la carte.
                                            <button
                                                type="button"
                                                onClick={() => toggleCompareSymbol(asset.id)}
                                                aria-pressed={isCompareSelected}
                                                aria-label={`Comparer ${asset.name}`}
                                                className="touch-target -m-3 flex items-center justify-center shrink-0 focus-ring rounded-sm"
                                            >
                                                <span
                                                    aria-hidden="true"
                                                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                                                        isCompareSelected ? 'bg-primary border-primary' : 'border-bordure-champ hover:border-bordure-champ'
                                                    }`}
                                                >
                                                    {isCompareSelected && <Icon name="check" size={11} className="text-dark" />}
                                                </span>
                                            </button>
                                        )}
                                        <div className="w-10 h-10 rounded-lg flex items-center justify-center font-mono text-meta font-bold text-texte shadow-sm border border-bordure shrink-0" style={{ backgroundColor: COLORS_SECTOR[asset.sector] || '#333' }}>
                                            {asset.name.substring(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-bold text-texte text-body leading-tight tracking-tight truncate">{asset.name}</div>
                                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                <span className="gf-ticker-symbol">{savedAsset?.symbol || asset.id}</span>
                                                <span className="text-tiny text-ink-400 font-medium uppercase tracking-wider">{asset.region}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-lg font-mono font-black text-texte tracking-tight tabular-nums"><PrivateAmount>{asset.weight.toFixed(1)}%</PrivateAmount></div>
                                    </div>
                                </div>

                                <div className="gf-quote-strip grid-cols-2 rounded-xl overflow-hidden text-tiny mb-4 relative z-10">
                                    <div className="gf-quote-cell p-2.5">
                                        <div className="text-ink-400 mb-1 font-bold uppercase tracking-wider text-[10px]">Valeur</div>
                                        <PrivateAmount as="div" className="text-texte font-mono font-bold text-meta tabular-nums">{formatCAD(asset.value)}</PrivateAmount>
                                    </div>
                                    <div className="gf-quote-cell p-2.5">
                                        <div className="text-ink-400 mb-1 font-bold uppercase tracking-wider text-[10px]">Variation {PERF_PERIOD_LABELS[perfPeriod]}</div>
                                        <div className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-mono font-bold text-meta tabular-nums ${asset.trendPct === null ? 'gf-delta-neutral text-ink-400' : asset.trendPct >= 0 ? 'gf-delta-up text-succes-texte' : 'gf-delta-down text-danger-400'}`}>
                                            {/* MONTANT-PUBLIC : variation du PRIX DE MARCHÉ du titre (décision de Marc : laissée visible). */}
                                            {asset.trendPct === null ? '—' : `${asset.trendPct > 0 ? '+' : ''}${asset.trendPct.toFixed(1)}%`}
                                        </div>
                                    </div>
                                </div>
                                {(() => {
                                    const pts = (savedAsset?.priceHistory ?? []).map((p) => p.price).filter((v) => Number.isFinite(v) && v > 0).slice(-60);
                                    if (pts.length < 2) return null;
                                    const minP = Math.min(...pts);
                                    const maxP = Math.max(...pts);
                                    const ampP = maxP - minP;
                                    const w = 240;
                                    const h = 38;
                                    const stepX = w / Math.max(1, pts.length - 1);
                                    const poly = pts.map((v, idx) => {
                                        const x = Number((idx * stepX).toFixed(1));
                                        const y = ampP > 0 ? Number((34 - ((v - minP) / ampP) * 30).toFixed(1)) : 19;
                                        return `${x},${y}`;
                                    }).join(' ');
                                    const hausse = (asset.trendPct ?? (pts[pts.length - 1]! - pts[0]!)) >= 0;
                                    return (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedCompareSymbols(new Set([asset.id]));
                                                setShowComparisonModal(true);
                                            }}
                                            aria-label={`Ouvrir la courbe détaillée de ${asset.name}`}
                                            className="w-full mb-3 px-2.5 py-1.5 rounded-xl bg-fond/70 border border-bordure hover:border-bordure-champ flex items-center justify-between gap-2 transition-colors focus-ring relative z-10"
                                        >
                                            <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                                                <polygon
                                                    points={`0,${h} ${poly} ${w},${h}`}
                                                    fill={hausse ? 'rgba(52, 179, 154, 0.14)' : 'rgba(248, 113, 113, 0.14)'}
                                                />
                                                <polyline
                                                    fill="none"
                                                    stroke={hausse ? 'var(--gf-vert)' : 'var(--gf-rouge)'}
                                                    strokeWidth="1.8"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    points={poly}
                                                />
                                            </svg>
                                            <span className="text-[11px] font-mono text-ink-300 shrink-0">Courbe ↗</span>
                                        </button>
                                    );
                                })()}
                            </div>

                            <div className="flex items-center justify-between pt-3 border-t border-bordure relative z-10 mt-auto gap-2 flex-wrap">
                                <div className="text-tiny text-ink-300 flex items-center gap-1.5 font-mono">
                                    <span className="font-sans font-medium text-ink-400">Yield</span>
                                    <span className={asset.yield > 0 ? "text-success-400 font-bold" : "text-ink-400"}>{asset.yield}%</span>
                                </div>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    {savedAsset && (
                                        confirmDeleteId === asset.id ? (
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteAsset(asset.id)}
                                                className="text-tiny font-bold text-erreur-texte bg-danger-500/25 border border-danger-500/40 px-2 py-1 rounded-lg hover:bg-danger-500/35"
                                            >
                                                Retirer ?
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                onClick={() => { setConfirmDeleteId(asset.id); window.setTimeout(() => setConfirmDeleteId(c => (c === asset.id ? null : c)), 3000); }}
                                                aria-label={`Retirer la position ${savedAsset.symbol}`}
                                                title="Retirer cette position"
                                                className="inline-flex text-ink-500 hover:text-danger-400 px-1.5 py-1.5 rounded-lg transition-colors"
                                            >
                                                <Icon name="trash" size={14} />
                                            </button>
                                        )
                                    )}
                                    {/* [INVEST-ALLOC-GEO-SECTOR] Région/secteur éditables inline :
                                        tout titre est classable même quand aucun provider ne le
                                        connaît (les donuts n'ont plus d'impasse « Autre »). */}
                                    <select
                                        aria-label={`Région pour ${asset.id}`}
                                        value={asset.region}
                                        onChange={(e) => handleAssetMetaChange(asset.id, 'region', e.target.value)}
                                        className="bg-surface-douce border border-bordure rounded-lg px-2 py-1 text-tiny text-ink-200 outline-hidden focus:border-primary/50 transition-colors hover:bg-bordure cursor-pointer"
                                    >
                                        {CANONICAL_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                                        {!CANONICAL_REGIONS.includes(asset.region as never) && <option value={asset.region}>{asset.region}</option>}
                                    </select>
                                    <select
                                        aria-label={`Secteur pour ${asset.id}`}
                                        value={asset.sector}
                                        onChange={(e) => handleAssetMetaChange(asset.id, 'sector', e.target.value)}
                                        className="bg-surface-douce border border-bordure rounded-lg px-2 py-1 text-tiny text-ink-200 outline-hidden focus:border-primary/50 transition-colors hover:bg-bordure cursor-pointer"
                                    >
                                        {CANONICAL_SECTORS.map((s) => <option key={s} value={s}>{s}</option>)}
                                        {!CANONICAL_SECTORS.includes(asset.sector as never) && <option value={asset.sector}>{asset.sector}</option>}
                                    </select>
                                    <select
                                        aria-label={`Type de compte pour ${asset.id}`}
                                        value={accountType}
                                        onChange={(e) => handleAssetAccountChange(asset.id, e.target.value)}
                                        className="bg-surface-douce border border-bordure rounded-lg px-2.5 py-1 text-tiny text-ink-200 font-bold outline-hidden focus:border-primary/50 transition-colors hover:bg-bordure cursor-pointer"
                                    >
                                        <option value="CELI">CELI</option>
                                        <option value="REER">REER</option>
                                        <option value="NON-ENREG">Non-Enreg</option>
                                        <option value="CRYPTO">Crypto</option>
                                    </select>
                                </div>
                            </div>
                            {/* Phase E.8 — Détail détention, PRU et gain sur achat */}
                            {purchaseStats && purchaseStats.purchaseCount >= 1 && (
                                <div className="mt-3 pt-3 border-t border-bordure">
                                    {purchaseStats.purchaseCount > 1 && (
                                        <div className="text-tiny text-info-400 uppercase font-bold mb-1">DCA · {purchaseStats.purchaseCount} achats</div>
                                    )}
                                    <div className="space-y-0.5 text-tiny">
                                        {savedAsset && (
                                            <div className="flex justify-between">
                                                <span className="text-ink-400">Détenu</span>
                                                <PrivateAmount className="font-mono text-ink-100 font-bold">
                                                    {`${formatNumber(savedAsset.quantity, { decimals: Number.isInteger(savedAsset.quantity) ? 0 : 2 })} actions`}
                                                </PrivateAmount>
                                            </div>
                                        )}
                                        {savedAsset && (
                                            <div className="flex justify-between">
                                                <span className="text-ink-400">Acheté → Cours</span>
                                                <PrivateAmount className="font-mono text-ink-200">
                                                    {`${formatNumber(purchaseStats.averageCost, { decimals: 2 })} → ${formatNumber(savedAsset.currentPrice, { decimals: 2 })} ${savedAsset.currency || 'CAD'}`}
                                                </PrivateAmount>
                                            </div>
                                        )}
                                        {/* [ASSET-FX-DISPLAY] les stats DCA sont calculées en devise NATIVE
                                            (prix comparés entre eux) → conversion CAD à l'AFFICHAGE seulement,
                                            pour réconcilier avec la Valeur (CAD) de la même carte. Le % reste
                                            un ratio natif, exact tel quel. */}
                                        <div className="flex justify-between">
                                            <span className="text-ink-400">Coût moyen</span>
                                            <PrivateAmount className="font-mono text-ink-200">{formatCAD(purchaseStats.averageCost * toCurrencyFactor(fxRates, savedAsset?.currency || 'CAD'))}</PrivateAmount>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-ink-400">Gain total</span>
                                            <span className={`font-mono ${purchaseStats.totalGain >= 0 ? 'text-success-400' : 'text-danger-400'}`}>
                                                {purchaseStats.totalGain >= 0 ? '+' : ''}<PrivateAmount>{formatCAD(purchaseStats.totalGain * toCurrencyFactor(fxRates, savedAsset?.currency || 'CAD'))}</PrivateAmount> (<PrivateAmount>{purchaseStats.gainPct.toFixed(1)}%</PrivateAmount>)
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            <DividendPanel
                dividendCalendar={dividendCalendar}
                totalAnnualDividends={totalAnnualDividends}
                currentAllocation={currentAllocation}
                isLoading={isLoading}
                sansCadre
            />
            <BrokerReconciliationCard variant="full" />
            </div>
            </CollapsibleSection>
            </>
            )}

            </div>
            )}

            {/* [REFONTE-NAV-L2b] Modale de comparaison superposée (ex-Accueil Phase D.4) :
                1 titre → mode PRIX ; 2+ → base 100 (%) par défaut (toggle interne à StockChart). */}
            <StockComparisonModal
                symbols={Array.from(selectedCompareSymbols)}
                isOpen={showComparisonModal}
                onClose={() => setShowComparisonModal(false)}
                isPrivacyMode={isPrivacyMode}
            />

            {/* Phase E.9 — Modal d'ajout manuel */}
            <AddStockForm
                isOpen={showAddStockForm}
                onClose={() => setShowAddStockForm(false)}
                onAdd={(newAsset) => {
                    if (setAssets) {
                        setAssets([...assets, newAsset]);
                    }
                }}
            />

            {/* Import positions courtier en lot (CSV). Dédup par symbole : on
                n'ajoute que les titres pas déjà présents (l'utilisateur garde la main). */}
            <ImportBrokerPositions
                isOpen={showImportBroker}
                onClose={() => setShowImportBroker(false)}
                onImport={(newAssets) => {
                    if (setAssets) {
                        const existing = new Set(assets.map(a => a.symbol));
                        const toAdd = newAssets.filter(a => !existing.has(a.symbol));
                        setAssets([...assets, ...toAdd]);
                    }
                }}
            />

        </div>
    );
};
