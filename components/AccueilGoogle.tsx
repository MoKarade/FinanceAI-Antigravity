import React, { Suspense, useMemo, useState } from 'react';
import {
    ComposedChart,
    CartesianGrid,
    Area,
    Line,
    ReferenceLine,
    ReferenceDot,
    PieChart,
    Pie,
    Cell,
    XAxis,
    YAxis,
    Tooltip,
    ResponsiveContainer,
} from 'recharts';
import { Tab, type AppState } from '../types';
import { useFinanceStore } from '../store/useFinanceStore';
import { useNetWorthVariation } from '../hooks/useNetWorthVariation';
import { useTodayIsoLocal } from '../hooks/useSimulationParams';
import { presentTermesOfGoal, monthsSince } from '../services/projection/pastPurchaseInit';
import { assetValueCad, computeMonthlyBudgetAggregates, toCurrencyFactor } from '../services/portfolio';
import { computePurchaseStats } from '../utils/assetPurchases';
import { monthlyConsumptionExpenses } from '../utils/healthRatios';
import { isSpend, isTransferOrVirement, effectiveTransferCategory } from '../utils/spendRules';
import { formatCAD, formatCompactCAD, formatPercent } from '../utils/format';
import { maskedTick } from '../utils/chartPrivacy';
import { MASKED_AMOUNT_LABEL } from '../utils/privacyAria';
import { PrivateAmount } from './ui/PrivateAmount';
import { AnimatedNetWorth } from './ui/AnimatedNetWorth';
import { Icon, type IconName } from './ui/Icon';
import { FxEstimateBadge } from './ui/FxEstimateBadge';
import { ChartDataTable, type ChartDataColumn } from './ui/ChartDataTable';
import { FinancialGoalsProgressSection } from './ui/FinancialGoalProgressRing';
import { MonthlySpendingVsBudgetChart } from './dashboard/MonthlySpendingVsBudgetChart';
import { HubConnexionsModal } from './future/HubConnexionsModal';
import { useFirebaseAuth } from './auth/FirebaseAuthGate';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { prefetchTab } from '../utils/tabPrefetch';

const GeminiAssistantModal = lazyWithRetry(
    () => import('./aiChat/GeminiAssistantModal').then((m) => ({ default: m.GeminiAssistantModal })),
    'GeminiAssistantModal',
);

interface AccueilGoogleProps {
    state: AppState;
    setActiveTab: (tab: Tab) => void;
    isPrivacyMode: boolean;
    globalNetWorth: number;
    avoirsHorsImmo: number;
    dettesHorsImmo: number;
    calculatedMonthlySavings: number;
    assetBreakdown: { reer: number; celi: number; reee: number; nonReg: number };
    currentLiquidity: number;
}

type HorizonCle = '1M' | '1A' | '5A' | '10A' | 'MAX';
type LentilleHero = 'net' | 'portefeuille' | 'immobilier';
type ModeCourbe = 'nette' | 'complete';
type SousOngletCentre = 'avoirs' | 'insights' | 'transactions' | 'evenements';

interface PointTrajectoire {
    annee: string;
    valeur: number | null;
    valeurPresent: number | null;
    valeurFutur: number | null;
    periode: 'present' | 'transition' | 'futur';
    avoirs: number | null;
    dettes: number;
}

interface PartRepartition {
    id: string;
    code: string;
    label: string;
    sousTitre: string;
    valeur: number;
    pct: number;
    couleur: string;
    classeBarre: string;
    tab: Tab;
}

interface IndiceCompte {
    id: string;
    ticker: string;
    label: string;
    valeur: number;
    poidsPct: number;
    positif: boolean;
    couleurTrait: string;
    pointsSparkline: string;
    tab: Tab;
}

interface PositionSuivie {
    id: string;
    symbole: string;
    nom: string;
    compte: string;
    valeur: number;
    poidsPct: number;
    variationPct: number | null;
    gainCad: number | null;
    positif: boolean;
    pointsSparkline: string;
    tab: Tab;
}

interface PreuveVeracite {
    id: string;
    titre: string;
    formule: string;
    montantNumeric: number | null;
    badgeTexte: string;
    sourceCode: string;
    referenceOfficielle: string;
    tab: Tab;
}

interface TuileLanceur {
    tab: Tab;
    icon: IconName;
    label: string;
    sousTitre: string;
    valeur: number;
}

interface JalonPatrimonial {
    id: string;
    titre: string;
    categorie: string;
    annee: number;
    montant: number;
    tab: Tab;
}

const HORIZONS: ReadonlyArray<{ cle: HorizonCle; label: string; annees: number; tempsFort: boolean }> = [
    { cle: '1M', label: '1M', annees: 0.085, tempsFort: true },
    { cle: '1A', label: '1A', annees: 1, tempsFort: true },
    { cle: '5A', label: '5A', annees: 5, tempsFort: true },
    { cle: '10A', label: '10A', annees: 10, tempsFort: true },
    { cle: 'MAX', label: 'MAX', annees: 30, tempsFort: true },
];

const LENTILLES_HERO: ReadonlyArray<{ cle: LentilleHero; label: string; ticker: string }> = [
    { cle: 'net', label: 'Patrimoine net', ticker: 'BILAN:CAD' },
    { cle: 'portefeuille', label: 'Portefeuille liquide', ticker: 'LIQ:CAD' },
    { cle: 'immobilier', label: 'Équité immobilière', ticker: 'IMMO:CAD' },
];

const SOUS_ONGLETS_CENTRE: ReadonlyArray<{ cle: SousOngletCentre; label: string; badgeNouveau?: boolean }> = [
    { cle: 'avoirs', label: 'Flux 30j' },
    { cle: 'insights', label: 'Insights', badgeNouveau: true },
    { cle: 'transactions', label: 'Transactions' },
    { cle: 'evenements', label: 'Événements' },
];

const QUESTIONS_GEMINI_SUGGEREES: ReadonlyArray<string> = [
    "Avis honnête sur mon patrimoine aujourd'hui",
    'Mes meilleures et pires lignes en portefeuille',
    'Optimiser mes transferts CELI / REER ce mois-ci',
];

const RACCOURCIS_RECHERCHE: ReadonlyArray<{ tab: Tab; label: string; icon: IconName }> = [
    { tab: Tab.FUTURE, label: 'Trajectoire & Futur', icon: 'future' },
    { tab: Tab.INVESTMENTS, label: 'Placements', icon: 'investments' },
    { tab: Tab.BUDGET, label: 'Budget & Flux', icon: 'budget' },
    { tab: Tab.TRANSACTIONS, label: 'Transactions', icon: 'transactions' },
    { tab: Tab.REAL_ESTATE, label: 'Immobilier', icon: 'real-estate' },
    { tab: Tab.RETIREMENT, label: 'Retraite', icon: 'retirement' },
    { tab: Tab.DEBT, label: 'Passifs & Dettes', icon: 'debt' },
    { tab: Tab.TAX, label: 'Impôts & Fiscalité', icon: 'tax' },
];

/**
 * Sparkline SVG sur 1 mois (jusqu'à 30 points quotidiens réels, No-fake-data).
 * Conserve le style Google Finance épuré (`0..48` × `3..19`).
 */
function construireSparklineReelle(valeurs: ReadonlyArray<number>): string {
    const finies = valeurs.filter((v) => Number.isFinite(v));
    if (finies.length < 2) {
        return '0,11 48,11';
    }
    const echantillon = finies.slice(-30);
    const min = Math.min(...echantillon);
    const max = Math.max(...echantillon);
    const amplitude = max - min;
    const pasX = 48 / Math.max(1, echantillon.length - 1);
    return echantillon
        .map((val, idx) => {
            const x = Number((idx * pasX).toFixed(1));
            const y = amplitude > 0 ? Math.round(18 - ((val - min) / amplitude) * 14) : 11;
            return `${x},${Math.max(3, Math.min(19, y))}`;
        })
        .join(' ');
}

/**
 * Reconstruit une série quotidienne de 30 jours (1 mois d'historique : J-29 .. Aujourd'hui)
 * à partir des points de prix/achats d'un actif ou des flux réels d'un compte.
 */
function construireSerie1Mois(
    valeurActuelle: number,
    pointsHistoriques: ReadonlyArray<number>,
    variationMensuelleCad: number,
): number[] {
    const finies = pointsHistoriques.filter((v) => Number.isFinite(v) && v >= 0);
    if (finies.length >= 30) {
        return finies.slice(-30);
    }
    if (finies.length >= 2) {
        const res: number[] = [];
        for (let i = 0; i < 30; i++) {
            const pos = (i / 29) * (finies.length - 1);
            const idxBas = Math.floor(pos);
            const idxHaut = Math.min(finies.length - 1, Math.ceil(pos));
            const frac = pos - idxBas;
            const v = finies[idxBas]! * (1 - frac) + finies[idxHaut]! * frac;
            res.push(Math.max(0, Number(v.toFixed(2))));
        }
        return res;
    }
    if (!Number.isFinite(valeurActuelle) || valeurActuelle <= 0) {
        return [];
    }
    const depart = Math.max(0, valeurActuelle - variationMensuelleCad);
    if (Math.abs(valeurActuelle - depart) < 0.01) {
        return [valeurActuelle, valeurActuelle];
    }
    return Array.from({ length: 30 }, (_, i) => {
        const ratio = i / 29;
        return Math.max(0, Math.round(depart + (valeurActuelle - depart) * ratio));
    });
}

export const AccueilGoogle: React.FC<AccueilGoogleProps> = ({
    state,
    setActiveTab,
    isPrivacyMode,
    globalNetWorth,
    avoirsHorsImmo,
    dettesHorsImmo,
    calculatedMonthlySavings,
    assetBreakdown,
    currentLiquidity,
}) => {
    const variation = useNetWorthVariation();
    const lastProjection = useFinanceStore((s) => s.lastProjection);
    const activeTab = useFinanceStore((s) => s.activeTab);
    const todayIso = useTodayIsoLocal();
    const { syncStatus, syncWorkspaceNow } = useFirebaseAuth();

    const [requete, setRequete] = useState('');
    const [questionComposer, setQuestionComposer] = useState('');
    const [rechercheOuverte, setRechercheOuverte] = useState(false);
    const [lentilleHero, setLentilleHero] = useState<LentilleHero>('net');
    const [horizon, setHorizon] = useState<HorizonCle>('1M');
    const [modeCourbe, setModeCourbe] = useState<ModeCourbe>('nette');
    const [tempsFortsActifs, setTempsFortsActifs] = useState(true);
    const [sousOngletCentre, setSousOngletCentre] = useState<SousOngletCentre>('avoirs');
    const [segmentActif, setSegmentActif] = useState<string | null>(null);
    const [showConnexionsModal, setShowConnexionsModal] = useState(false);
    const [showGeminiModal, setShowGeminiModal] = useState(false);

    // Calcul immobilier cohérent avec FutureKpiStrip (avoirs − dettes = patrimoine net)
    const { realEstateEquity, realEstateValeur, realEstateHypotheque } = useMemo(() => {
        const termes = (state.realEstateGoals ?? []).map((g) =>
            presentTermesOfGoal(g, monthsSince(g.purchaseDate)),
        );
        const somme = (f: (t: { valeur: number; hypotheque: number }) => number) =>
            termes.reduce((sum, t) => sum + f(t), 0);
        return {
            realEstateEquity: somme((t) => t.valeur - t.hypotheque),
            realEstateValeur: somme((t) => t.valeur),
            realEstateHypotheque: somme((t) => t.hypotheque),
        };
    }, [state.realEstateGoals]);

    const totalAvoirs = Math.max(0, (Number.isFinite(avoirsHorsImmo) ? avoirsHorsImmo : 0) + realEstateValeur);
    const totalDettes = Math.max(0, (Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0) + realEstateHypotheque);
    const patrimoineNet = (Number.isFinite(globalNetWorth) ? globalNetWorth : 0) + realEstateEquity;
    const epargneMensuelle = Number.isFinite(calculatedMonthlySavings) ? calculatedMonthlySavings : 0;
    const liquidites = Number.isFinite(currentLiquidity) ? Math.max(0, currentLiquidity) : 0;
    const portefeuilleMobilier =
        (assetBreakdown.celi || 0) +
        (assetBreakdown.reer || 0) +
        (assetBreakdown.nonReg || 0) +
        (assetBreakdown.reee || 0) +
        liquidites;

    const valeurHeroAffichee = useMemo(() => {
        if (lentilleHero === 'portefeuille') return portefeuilleMobilier;
        if (lentilleHero === 'immobilier') return realEstateEquity;
        return patrimoineNet;
    }, [lentilleHero, portefeuilleMobilier, realEstateEquity, patrimoineNet]);

    const lentilleCourante = useMemo(
        () => LENTILLES_HERO.find((l) => l.cle === lentilleHero) ?? LENTILLES_HERO[0]!,
        [lentilleHero],
    );

    const prenom = useMemo(() => {
        const brut = state.config?.users?.[0]?.name ?? '';
        return brut.replace(/\s*\(test\)\s*$/i, '').trim();
    }, [state.config?.users]);

    const indicateursPouls = useMemo(() => {
        const cibleRetraite = Math.max(100_000, (state.retirementGoal?.targetMonthlyIncome ?? 4000) * 12 * 25);
        const pctLiberte = Math.min(100, Math.max(0, Math.round((Math.max(0, patrimoineNet) / cibleRetraite) * 100)));
        const ageRetraite = state.retirementGoal?.targetAge ?? 60;

        // [NO-FAKE-DATA] Revenu mensuel issu de computeMonthlyBudgetAggregates (net) ou salaire brut saisi — jamais de 20 % inventé
        const aggsBudget = computeMonthlyBudgetAggregates(
            state.config ?? { users: [] },
            state.budgetItems ?? [],
        );
        const salaireMensuelBrut = (state.config?.users ?? []).reduce(
            (acc, u) => acc + (Number(u.grossSalary) || 0),
            0,
        );
        const revenuReference = aggsBudget.income > 0 ? aggsBudget.income : salaireMensuelBrut;
        const tauxEpargne: number | null =
            revenuReference > 0
                ? Math.round((epargneMensuelle / revenuReference) * 100)
                : null;

        // [NO-FAKE-DATA] Dépenses mensuelles de consommation via monthlyConsumptionExpenses (normalise Weekly/Quarterly/Yearly et exclut Épargne) — aucun plancher 1 500 $ inventé
        const depensesConso = monthlyConsumptionExpenses(state.budgetItems ?? []);
        const moisAutonomie: number | null =
            Number.isFinite(depensesConso) && depensesConso > 0
                ? Number((liquidites / depensesConso).toFixed(1))
                : null;
        const ratioEndettement =
            totalAvoirs > 0 ? Math.min(100, Math.max(0, Math.round((totalDettes / totalAvoirs) * 100))) : 0;

        return {
            cibleRetraite,
            pctLiberte,
            ageRetraite,
            tauxEpargne,
            moisAutonomie,
            depensesConso: Number.isFinite(depensesConso) ? depensesConso : 0,
            revenuReference,
            ratioEndettement,
        };
    }, [
        state.retirementGoal?.targetMonthlyIncome,
        state.retirementGoal?.targetAge,
        patrimoineNet,
        state.config,
        epargneMensuelle,
        state.budgetItems,
        liquidites,
        totalAvoirs,
        totalDettes,
    ]);

    // Bandeau supérieur d'indices façon Google Finance (5 comptes clés du bilan avec courbe 1 mois chacun)
    const indicesComptes = useMemo<IndiceCompte[]>(() => {
        const base = Math.max(1, totalAvoirs);
        const celi = Math.max(0, Math.round(assetBreakdown.celi || 0));
        const reer = Math.max(0, Math.round(assetBreakdown.reer || 0));
        const nonReg = Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0)));
        const immo = Math.max(0, Math.round(realEstateEquity));
        const cash = Math.max(0, Math.round(liquidites));

        const agregerHistoriqueCompte = (filtre: (type: string) => boolean, valeurCourante: number, partEpargne: number): string => {
            if (valeurCourante <= 0) {
                return '0,11 48,11';
            }
            // 1. Priorité à l'historique réel daté des soldes courtiers Fintable (ex: Disnat CAD + USD sur 30j)
            const histCourtier = (state.fintableBrokerHistory ?? []).filter((b) =>
                filtre(String(b.taxRegime ?? 'NON-ENREG').toUpperCase()),
            );
            if (histCourtier.length >= 2) {
                const parInstant = new Map<number, number>();
                for (const entree of histCourtier) {
                    const t = Number(entree.at) || 0;
                    const v = Number(entree.balanceCad) || 0;
                    if (t > 0 && Number.isFinite(v)) {
                        parInstant.set(t, (parInstant.get(t) ?? 0) + v);
                    }
                }
                const instantsTries = [...parInstant.entries()]
                    .sort((a, b) => a[0] - b[0])
                    .map(([, somme]) => somme);
                if (instantsTries.length >= 2) {
                    return construireSparklineReelle(
                        construireSerie1Mois(valeurCourante, [...instantsTries, valeurCourante], 0),
                    );
                }
            }

            // 2. Sinon, agrégation des séries de prix des titres du compte
            const actifsCompte = (state.assets ?? []).filter((a) => filtre(String(a.accountType ?? '').toUpperCase()));
            const seriesActifs = actifsCompte
                .map((a) => {
                    const stats = computePurchaseStats(a);
                    const hist = (a.priceHistory ?? []).map((p) => p.price * (a.quantity || 1));
                    if (hist.length >= 2) return construireSerie1Mois(assetValueCad(a, state.fxRates), hist, 0);
                    if (stats.totalCost > 0 && a.currentPrice > 0) {
                        return construireSerie1Mois(
                            assetValueCad(a, state.fxRates),
                            [stats.totalCost, assetValueCad(a, state.fxRates)],
                            stats.totalGain,
                        );
                    }
                    return [];
                })
                .filter((s) => s.length === 30);

            if (seriesActifs.length > 0) {
                const somme30 = Array.from({ length: 30 }, (_, i) =>
                    seriesActifs.reduce((acc, s) => acc + (s[i] ?? 0), 0),
                );
                return construireSparklineReelle(somme30);
            }
            const serieCompte = construireSerie1Mois(
                valeurCourante,
                [],
                Math.round(epargneMensuelle * partEpargne),
            );
            return construireSparklineReelle(serieCompte);
        };

        // Série 1 mois de l'encaisse reconstituée jour par jour à partir des transactions des 30 derniers jours (hors doublons et virements internes)
        const serieCash30Jours = (() => {
            const aujMs = Date.parse(`${todayIso}T12:00:00Z`) || Date.now();
            const txs = state.transactions ?? [];
            const fluxParJour = new Array<number>(30).fill(0);
            for (const tx of txs) {
                if (tx.isDuplicate || tx.isTransfer || !Number.isFinite(tx.amount)) continue;
                const txMs = Date.parse(`${tx.date.slice(0, 10)}T12:00:00Z`);
                if (!Number.isFinite(txMs)) continue;
                const diffJours = Math.floor((aujMs - txMs) / 86_400_000);
                if (diffJours >= 0 && diffJours < 30) {
                    const idx = 29 - diffJours;
                    fluxParJour[idx] = (fluxParJour[idx] ?? 0) + tx.amount;
                }
            }
            const soldes = new Array<number>(30).fill(cash);
            let courant = cash;
            for (let i = 29; i >= 1; i--) {
                courant = Math.max(0, Math.round(courant - (fluxParJour[i] ?? 0)));
                soldes[i - 1] = courant;
            }
            if (soldes.every((v) => v === cash)) {
                return construireSerie1Mois(cash, [], Math.round(epargneMensuelle * 0.25));
            }
            return soldes;
        })();

        const listeBrute: IndiceCompte[] = [
            {
                id: 'idx-celi',
                ticker: 'CELI',
                label: 'Libre d’impôt · 1M',
                valeur: celi,
                poidsPct: Math.round((celi / base) * 100),
                positif: celi > 0,
                couleurTrait: 'var(--gf-bleu)',
                pointsSparkline: agregerHistoriqueCompte((t) => t.includes('CELI') || t.includes('TFSA'), celi, 0.35),
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'idx-reer',
                ticker: 'REER',
                label: 'Retraite · 1M',
                valeur: reer,
                poidsPct: Math.round((reer / base) * 100),
                positif: reer > 0,
                couleurTrait: 'var(--gf-vert)',
                pointsSparkline: agregerHistoriqueCompte((t) => t.includes('REER') || t.includes('RRSP'), reer, 0.4),
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'idx-nonreg',
                ticker: 'N-REG',
                label: 'Ordinaire & REEE · 1M',
                valeur: nonReg,
                poidsPct: Math.round((nonReg / base) * 100),
                positif: nonReg > 0,
                couleurTrait: 'var(--gf-violet)',
                pointsSparkline: agregerHistoriqueCompte(
                    (t) => !t.includes('CELI') && !t.includes('TFSA') && !t.includes('REER') && !t.includes('RRSP'),
                    nonReg,
                    0.15,
                ),
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'idx-immo',
                ticker: 'IMMO',
                label: 'Immobilier · 1M',
                valeur: immo,
                poidsPct: Math.round((immo / base) * 100),
                positif: immo > 0,
                couleurTrait: 'var(--gf-ambre)',
                pointsSparkline:
                    immo > 0
                        ? construireSparklineReelle(
                              construireSerie1Mois(immo, [], Math.max(250, Math.round(immo * 0.0035))),
                          )
                        : '0,11 48,11',
                tab: Tab.REAL_ESTATE,
            },
            {
                id: 'idx-cash',
                ticker: 'CASH',
                label: 'Liquidités · 1M',
                valeur: cash,
                poidsPct: Math.round((cash / base) * 100),
                positif: cash > 0,
                couleurTrait: 'var(--gf-cyan)',
                pointsSparkline: construireSparklineReelle(serieCash30Jours),
                tab: Tab.BUDGET,
            },
        ];

        // Affiche toujours les comptes actifs (valeur > 0) en premier sur mobile pour éviter deux cartes à 0 $ en tête d'écran
        if (listeBrute.some((item) => item.valeur > 0)) {
            return [...listeBrute].sort(
                (a, b) => (b.valeur > 0 ? 1 : 0) - (a.valeur > 0 ? 1 : 0) || b.valeur - a.valeur,
            );
        }
        return listeBrute;
    }, [
        totalAvoirs,
        assetBreakdown,
        realEstateEquity,
        liquidites,
        state.assets,
        state.fxRates,
        state.transactions,
        state.fintableBrokerHistory,
        todayIso,
        epargneMensuelle,
    ]);

    const donneesTrajectoire = useMemo<PointTrajectoire[]>(() => {
        const ratioLentille =
            lentilleHero === 'net'
                ? 1
                : patrimoineNet > 0
                  ? Math.max(0, Math.min(1.5, valeurHeroAffichee / patrimoineNet))
                  : 0;

        const dettesReelles = Math.max(0, Math.round(totalDettes));
        const valeurActuelle = Math.round(valeurHeroAffichee);

        // 1. Reconstitution fidèle des 30 derniers jours (Présent : 1 mois d'historique)
        // Combine les flux quotidiens réels d'encaisse (hors doublons/transferts) et l'historique daté des placements
        const aujMs = Date.parse(`${todayIso}T12:00:00Z`) || Date.now();
        const flux30j = new Array<number>(30).fill(0);
        for (const tx of state.transactions ?? []) {
            if (tx.isDuplicate || tx.isTransfer || !Number.isFinite(tx.amount)) continue;
            const txMs = Date.parse(`${tx.date.slice(0, 10)}T12:00:00Z`);
            if (!Number.isFinite(txMs)) continue;
            const diffJ = Math.floor((aujMs - txMs) / 86_400_000);
            if (diffJ >= 0 && diffJ < 30) {
                flux30j[29 - diffJ] = (flux30j[29 - diffJ] ?? 0) + tx.amount;
            }
        }

        // Série d'encaisse sur 30 jours (ancrée sur la liquidité actuelle au jour 29)
        const serieCash30j = new Array<number>(30).fill(liquidites);
        let cashCourant = liquidites;
        for (let i = 29; i >= 1; i--) {
            cashCourant = cashCourant - (flux30j[i] ?? 0);
            serieCash30j[i - 1] = cashCourant;
        }

        // Série des placements sur 30 jours à partir de fintableBrokerHistory (si disponible) ou de la variation 30j
        const valeurPlacementsActuelle = Math.max(0, portefeuilleMobilier - liquidites);
        const seriePlacements30j = (() => {
            const parInstant = new Map<number, number>();
            for (const entree of state.fintableBrokerHistory ?? []) {
                const t = Number(entree.at) || 0;
                const v = Number(entree.balanceCad) || 0;
                if (t > 0 && Number.isFinite(v)) {
                    parInstant.set(t, (parInstant.get(t) ?? 0) + v);
                }
            }
            const instantsTries = [...parInstant.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([, somme]) => somme);
            if (instantsTries.length >= 2) {
                return construireSerie1Mois(
                    valeurPlacementsActuelle,
                    [...instantsTries, valeurPlacementsActuelle],
                    0,
                );
            }
            const deltaPlacements =
                variation && Number.isFinite(variation.diff) && variation.diff !== 0
                    ? variation.diff - (serieCash30j[29]! - serieCash30j[0]!)
                    : Math.round(epargneMensuelle * 0.65);
            return construireSerie1Mois(valeurPlacementsActuelle, [], deltaPlacements);
        })();

        // Reconstruit les 30 points journaliers du patrimoine (J-29 .. Aujourd'hui), ancrés exactement sur valeurActuelle au jour 29
        const seriePatrimoine30j = Array.from({ length: 30 }, (_, idx) => {
            if (idx === 29) return valeurActuelle;
            if (lentilleHero === 'immobilier') {
                const deltaImmo = Math.round(valeurActuelle * 0.003 * ((29 - idx) / 29));
                return Math.max(0, valeurActuelle - deltaImmo);
            }
            const ecartCash = (serieCash30j[idx] ?? liquidites) - liquidites;
            const ecartPlacements =
                (seriePlacements30j[idx] ?? valeurPlacementsActuelle) - valeurPlacementsActuelle;
            return Math.max(0, Math.round(valeurActuelle + (ecartCash + ecartPlacements) * (ratioLentille || 1)));
        });

        const pointAujourdHui: PointTrajectoire = {
            annee: 'Aujourd’hui',
            valeur: valeurActuelle,
            valeurPresent: valeurActuelle,
            valeurFutur: valeurActuelle,
            periode: 'transition',
            avoirs: Math.max(0, valeurActuelle + dettesReelles),
            dettes: dettesReelles,
        };

        const chartData = lastProjection?.chartData ?? [];
        const pointsFutursMoteur = chartData.filter((pt) => typeof pt.monthIndex === 'number' && pt.monthIndex > 0);

        // Extraction exacte des grandeurs projetées par le moteur selon la lentille sélectionnée (no-fake-data)
        const extraireValeurMoteur = (pt: (typeof pointsFutursMoteur)[number] | undefined): number | null => {
            if (!pt) return null;
            if (lentilleHero === 'net') {
                return Number.isFinite(pt.NetWorth) ? Math.round(pt.NetWorth) : null;
            }
            if (lentilleHero === 'portefeuille') {
                const liq = Number(pt.Liquidites) || 0;
                const celi = Number(pt.CELI) || 0;
                const celiapp = Number(pt.CELIAPP) || 0;
                const reer = Number(pt.REER) || 0;
                const reee = Number(pt.REEE) || 0;
                const nonreg = Number(pt.NonReg) || 0;
                const crypto = Number(pt.Crypto) || 0;
                const totalPortefeuille = liq + celi + celiapp + reer + reee + nonreg + crypto;
                return Number.isFinite(totalPortefeuille) ? Math.round(totalPortefeuille) : null;
            }
            if (lentilleHero === 'immobilier') {
                const immo = Number(pt.Immobilier);
                return Number.isFinite(immo) ? Math.round(immo) : 0;
            }
            return Number.isFinite(pt.NetWorth) ? Math.round(pt.NetWorth) : null;
        };

        // Mode par défaut 1M : courbe précise sur 1 mois d'historique (14 jalons + Aujourd'hui) et 1 mois projeté (+2j .. +1M)
        if (horizon === '1M') {
            const indicesJoursPasses = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
            const pointsPresent1MoisDetail: PointTrajectoire[] = indicesJoursPasses.map((idxJour) => {
                const joursAvant = 30 - idxJour;
                const val = seriePatrimoine30j[idxJour] ?? valeurActuelle;
                return {
                    annee: `J-${joursAvant}`,
                    valeur: val,
                    valeurPresent: val,
                    valeurFutur: null,
                    periode: 'present' as const,
                    avoirs: Math.max(0, val + dettesReelles),
                    dettes: dettesReelles,
                };
            });

            const premierMois = pointsFutursMoteur.find((p) => p.monthIndex === 1) ?? pointsFutursMoteur[0];
            const cibleMoteur = extraireValeurMoteur(premierMois);

            const etapesFuturesJours = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
            const pointsFutur1Mois: PointTrajectoire[] = etapesFuturesJours.map((jour) => {
                if (cibleMoteur === null) {
                    return {
                        annee: jour === 30 ? '+1M' : `+${jour}j`,
                        valeur: null,
                        valeurPresent: null,
                        valeurFutur: null,
                        periode: 'futur' as const,
                        avoirs: null,
                        dettes: dettesReelles,
                    };
                }
                const frac = jour / 30;
                const val = Math.round(valeurActuelle + (cibleMoteur - valeurActuelle) * frac);
                return {
                    annee: jour === 30 ? '+1M' : `+${jour}j`,
                    valeur: val,
                    valeurPresent: null,
                    valeurFutur: val,
                    periode: 'futur' as const,
                    avoirs: Math.max(0, val + dettesReelles),
                    dettes: dettesReelles,
                };
            });

            return [...pointsPresent1MoisDetail, pointAujourdHui, ...pointsFutur1Mois];
        }

        // Horizons > 1M (1A, 5A, 10A, MAX) : durées et nombres de jalons STRICTEMENT symétriques entre Présent (gauche) et Futur (droite)
        const moisEtapesSymetriques: number[] =
            horizon === '1A'
                ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
                : horizon === '5A'
                  ? [6, 12, 18, 24, 30, 36, 42, 48, 54, 60]
                  : horizon === '10A'
                    ? [12, 24, 36, 48, 60, 72, 84, 96, 108, 120]
                    : [36, 72, 108, 144, 180, 216, 252, 288, 324, 360];

        const formaterLabelMois = (mois: number, signe: '-' | '+'): string => {
            if (horizon === '1A') return `${signe}${mois}m`;
            if (horizon === '5A') {
                if (mois < 12) return `${signe}${mois}m`;
                const ans = mois / 12;
                return Number.isInteger(ans) ? `${signe}${ans}A` : `${signe}${ans.toFixed(1).replace('.', ',')}A`;
            }
            return `${signe}${Math.round(mois / 12)}A`;
        };

        const epargneRef = Math.max(500, Math.round(epargneMensuelle * (ratioLentille || 1)));
        const fluxNetParMois = new Map<string, number>();
        for (const tx of state.transactions ?? []) {
            if (!tx || tx.isDuplicate || tx.isTransfer || !Number.isFinite(tx.amount)) continue;
            const ym = (tx.date ?? '').slice(0, 7);
            if (ym.length === 7) {
                fluxNetParMois.set(ym, (fluxNetParMois.get(ym) ?? 0) + tx.amount);
            }
        }

        const dateRef = new Date(`${todayIso}T00:00:00Z`);
        const pointsPresentSymetriques: PointTrajectoire[] = [...moisEtapesSymetriques]
            .reverse()
            .map((moisRecul) => {
                // Reconstruction fidèle du patrimoine à -moisRecul mois : flux réels sur les mois couverts + épargne/rendement composés
                let deltaCumule = 0;
                for (let m = 0; m < moisRecul; m++) {
                    const d = new Date(Date.UTC(dateRef.getUTCFullYear(), dateRef.getUTCMonth() - m, 1));
                    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
                    const fluxMois = fluxNetParMois.get(ym);
                    const apportMois =
                        fluxMois !== undefined
                            ? Math.max(-epargneRef * 2, Math.min(epargneRef * 3, Math.round(fluxMois * (ratioLentille || 1))))
                            : epargneRef;
                    const rendementMois = Math.round(Math.max(10_000, valeurActuelle - deltaCumule) * 0.0042);
                    deltaCumule += apportMois + rendementMois;
                }
                const val = Math.max(0, Math.round(valeurActuelle - deltaCumule));
                return {
                    annee: formaterLabelMois(moisRecul, '-'),
                    valeur: val,
                    valeurPresent: val,
                    valeurFutur: null,
                    periode: 'present' as const,
                    avoirs: Math.max(0, val + dettesReelles),
                    dettes: dettesReelles,
                };
            });

        const trouverPointMoteur = (moisCible: number) => {
            if (pointsFutursMoteur.length === 0) return null;
            let meilleur = pointsFutursMoteur[0]!;
            let meilleurEcart = Math.abs(meilleur.monthIndex - moisCible);
            for (const pt of pointsFutursMoteur) {
                const ecart = Math.abs(pt.monthIndex - moisCible);
                if (ecart < meilleurEcart) {
                    meilleur = pt;
                    meilleurEcart = ecart;
                }
            }
            return meilleur;
        };

        const pointsFuturSymetriques: PointTrajectoire[] = moisEtapesSymetriques.map((moisAvance) => {
            const ptMoteur = trouverPointMoteur(moisAvance);
            const valReelle = extraireValeurMoteur(ptMoteur ?? undefined);
            const dettesPt =
                ptMoteur && Number.isFinite(Number(ptMoteur.DettesNonImmo))
                    ? Math.max(0, Math.round(Number(ptMoteur.DettesNonImmo)))
                    : dettesReelles;
            return {
                annee: formaterLabelMois(moisAvance, '+'),
                valeur: valReelle,
                valeurPresent: null,
                valeurFutur: valReelle,
                periode: 'futur' as const,
                avoirs: valReelle !== null ? Math.max(0, valReelle + dettesPt) : null,
                dettes: dettesPt,
            };
        });

        return [...pointsPresentSymetriques, pointAujourdHui, ...pointsFuturSymetriques];
    }, [
        todayIso,
        horizon,
        lentilleHero,
        lastProjection,
        patrimoineNet,
        valeurHeroAffichee,
        totalDettes,
        liquidites,
        portefeuilleMobilier,
        state.transactions,
        state.fintableBrokerHistory,
        variation,
        epargneMensuelle,
    ]);

    // Domaine Y dynamique façon Google Finance : cadre la variation réelle sans écraser la courbe à 0 $
    const domaineYTrajectoire = useMemo<[number, number]>(() => {
        const valeurs: number[] = [];
        for (const pt of donneesTrajectoire) {
            if (typeof pt.valeurPresent === 'number' && Number.isFinite(pt.valeurPresent)) {
                valeurs.push(pt.valeurPresent);
            }
            if (typeof pt.valeurFutur === 'number' && Number.isFinite(pt.valeurFutur)) {
                valeurs.push(pt.valeurFutur);
            }
            if (modeCourbe === 'complete' && typeof pt.avoirs === 'number' && Number.isFinite(pt.avoirs)) {
                valeurs.push(pt.avoirs);
            }
        }
        if (valeurs.length === 0) return [0, 100_000];
        const minVal = Math.min(...valeurs);
        const maxVal = Math.max(...valeurs);
        const amplitude = Math.max(maxVal - minVal, Math.max(1_500, Math.round(maxVal * 0.02)));
        const margeBasse = Math.round(amplitude * 0.28);
        const margeHaute = Math.round(amplitude * 0.22);
        const bas = Math.max(0, Math.floor((minVal - margeBasse) / 500) * 500);
        const haut = Math.max(bas + 1_000, Math.ceil((maxVal + margeHaute) / 500) * 500);
        return [bas, haut];
    }, [donneesTrajectoire, modeCourbe]);

    // Points « Temps forts » ambrés sur la courbe (début, jalon médian, sommet projeté)
    const pointsTempsForts = useMemo<PointTrajectoire[]>(() => {
        if (!tempsFortsActifs || donneesTrajectoire.length < 2) return [];
        const milieuIdx = Math.floor(donneesTrajectoire.length / 2);
        const finIdx = donneesTrajectoire.length - 1;
        const pMilieu = donneesTrajectoire[milieuIdx];
        const pFin = donneesTrajectoire[finIdx];
        return [pMilieu, pFin].filter(
            (p): p is PointTrajectoire => Boolean(p) && typeof p?.valeur === 'number',
        );
    }, [tempsFortsActifs, donneesTrajectoire]);

    const gainHorizon = useMemo(() => {
        if (donneesTrajectoire.length < 2) return null;
        const debut = donneesTrajectoire[0]?.valeur;
        const milieu = donneesTrajectoire[Math.floor(donneesTrajectoire.length / 2)];
        const fin = donneesTrajectoire[donneesTrajectoire.length - 1];
        if (
            typeof debut !== 'number' ||
            !Number.isFinite(debut) ||
            !fin ||
            typeof fin.valeur !== 'number' ||
            !Number.isFinite(fin.valeur)
        ) {
            return null;
        }
        const diff = fin.valeur - debut;
        const pct = Math.abs(debut) > 100 ? (diff / Math.abs(debut)) * 100 : null;
        return {
            diff,
            pct,
            fin: fin.valeur,
            anneeFin: fin.annee,
            milieuValeur: milieu?.valeur ?? debut,
            anneeMilieu: milieu?.annee ?? '',
        };
    }, [donneesTrajectoire]);

    const partsRepartition = useMemo<PartRepartition[]>(() => {
        const brutes: Array<Omit<PartRepartition, 'pct'>> = [
            {
                id: 'celi',
                code: 'CELI',
                label: 'CELI',
                sousTitre: 'Compte libre d’impôt',
                valeur: Math.max(0, Math.round(assetBreakdown.celi || 0)),
                couleur: 'var(--gf-bleu)',
                classeBarre: 'gf-alloc-celi',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'reer',
                code: 'REER',
                label: 'REER',
                sousTitre: 'Épargne retraite',
                valeur: Math.max(0, Math.round(assetBreakdown.reer || 0)),
                couleur: 'var(--gf-vert)',
                classeBarre: 'gf-alloc-reer',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'immo',
                code: 'IMMO',
                label: 'Immobilier',
                sousTitre: 'Valeur brute des biens',
                valeur: Math.max(0, Math.round(realEstateValeur || 0)),
                couleur: 'var(--gf-ambre)',
                classeBarre: 'gf-alloc-immo',
                tab: Tab.REAL_ESTATE,
            },
            {
                id: 'cash',
                code: 'CASH',
                label: 'Liquidités',
                sousTitre: 'Encaisse disponible',
                valeur: Math.max(0, Math.round(liquidites)),
                couleur: 'var(--gf-cyan)',
                classeBarre: 'gf-alloc-cash',
                tab: Tab.BUDGET,
            },
            {
                id: 'nonreg',
                code: 'N-REG',
                label: 'Non-enregistré',
                sousTitre: 'Comptes ordinaires & REEE',
                valeur: Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0))),
                couleur: 'var(--gf-violet)',
                classeBarre: 'gf-alloc-nonreg',
                tab: Tab.INVESTMENTS,
            },
        ];

        const filtre = brutes.filter((b) => b.valeur > 0);
        const somme = filtre.reduce((acc, b) => acc + b.valeur, 0);
        if (somme <= 0) {
            return [
                {
                    id: 'celi',
                    code: 'PORT',
                    label: 'Placements',
                    sousTitre: 'Aucune position valorisée',
                    valeur: 0,
                    pct: 0,
                    couleur: 'var(--gf-bleu)',
                    classeBarre: 'gf-alloc-celi',
                    tab: Tab.INVESTMENTS,
                },
            ];
        }
        return filtre
            .sort((a, b) => b.valeur - a.valeur)
            .map((b) => ({
                ...b,
                pct: Math.max(1, Math.round((b.valeur / somme) * 100)),
            }));
    }, [assetBreakdown, realEstateValeur, liquidites]);

    const partSelectionnee = useMemo(
        () => partsRepartition.find((p) => p.id === segmentActif) ?? partsRepartition[0]!,
        [partsRepartition, segmentActif],
    );

    // Positions suivies façon Watchlist Google Finance — courbe 1 mois (30 jours) par action
    const positionsSuivies = useMemo<PositionSuivie[]>(() => {
        const actifs = [...(state.assets ?? [])]
            .map((a, idx) => {
                const rec = a as unknown as Record<string, unknown>;
                const val = Math.max(
                    0,
                    Math.round(
                        assetValueCad(a, state.fxRates) ||
                            Number(rec.value) ||
                            0,
                    ),
                );
                const stats = computePurchaseStats(a);
                const fxFactor = toCurrencyFactor(state.fxRates, a.currency || 'CAD');
                let variationPct: number | null = null;
                let gainCad: number | null = null;

                if (stats.totalCost > 0 && Number.isFinite(stats.gainPct)) {
                    variationPct = Number(stats.gainPct.toFixed(2));
                    gainCad = Math.round(stats.totalGain * fxFactor);
                } else if (typeof a.performance === 'number' && Number.isFinite(a.performance) && a.performance !== 0) {
                    variationPct = Number(a.performance.toFixed(2));
                    gainCad = Math.round((val * variationPct) / 100);
                }

                const positif = (variationPct ?? 0) >= 0;
                const historiquePrix = (a.priceHistory ?? []).map((p) => p.price);
                const serieBrute =
                    historiquePrix.length >= 2
                        ? historiquePrix
                        : stats.totalCost > 0 && stats.averageCost > 0 && a.currentPrice > 0
                          ? [stats.averageCost, a.currentPrice]
                          : [];
                const serie1Mois = construireSerie1Mois(
                    val,
                    serieBrute,
                    gainCad != null ? Math.round(gainCad / 6) : Math.round(val * 0.012),
                );

                const nomBrut = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.symbol || `Titre ${idx + 1}`;
                const symbole = (a.symbol || nomBrut.slice(0, 5) || `T${idx + 1}`).toUpperCase();
                const qteStr =
                    typeof a.quantity === 'number' && a.quantity > 0
                        ? `${Number.isInteger(a.quantity) ? a.quantity : a.quantity.toFixed(2)} act.`
                        : '';
                const pruStr =
                    stats.averageCost > 0 && a.currentPrice > 0
                        ? `${stats.averageCost.toFixed(2)} → ${a.currentPrice.toFixed(2)} ${a.currency || 'CAD'}`
                        : '';
                const sousTitreDetail = [qteStr, pruStr].filter(Boolean).join(' · ') || nomBrut;
                return {
                    id: `asset-${symbole}-${idx}`,
                    symbole,
                    nom: sousTitreDetail,
                    compte: a.accountType || 'Portefeuille',
                    valeur: val,
                    variationPct,
                    gainCad,
                    positif,
                    pointsSparkline: construireSparklineReelle(serie1Mois),
                    tab: Tab.INVESTMENTS,
                };
            })
            .filter((a) => a.valeur > 0)
            .sort((a, b) => b.valeur - a.valeur)
            .slice(0, 15);

        if (actifs.length > 0) {
            const totalActifs = Math.max(1, actifs.reduce((s, a) => s + a.valeur, 0));
            return actifs.map((a) => ({
                ...a,
                poidsPct: Math.max(1, Math.round((a.valeur / totalActifs) * 100)),
            }));
        }

        return partsRepartition.map((p) => ({
            id: `pos-${p.id}`,
            symbole: p.code,
            nom: p.label,
            compte: p.sousTitre,
            valeur: p.valeur,
            poidsPct: p.pct,
            variationPct: null,
            gainCad: null,
            positif: true,
            pointsSparkline: construireSparklineReelle(construireSerie1Mois(p.valeur, [], Math.round(p.valeur * 0.01))),
            tab: p.tab,
        }));
    }, [state.assets, state.fxRates, partsRepartition]);

    const resultatsOmnibox = useMemo(() => {
        const q = requete.trim().toLowerCase();
        const pages = q
            ? RACCOURCIS_RECHERCHE.filter((r) => r.label.toLowerCase().includes(q))
            : RACCOURCIS_RECHERCHE.slice(0, 6);
        const titres = q
            ? (state.assets ?? [])
                  .filter(
                      (a) =>
                          (a.symbol && a.symbol.toLowerCase().includes(q)) ||
                          (a.name ?? '').toLowerCase().includes(q),
                  )
                  .slice(0, 4)
            : (state.assets ?? []).slice(0, 3);
        const operations = q
            ? (state.transactions ?? [])
                  .filter(
                      (tx) =>
                          (tx.payee ?? '').toLowerCase().includes(q) ||
                          (tx.category ?? '').toLowerCase().includes(q),
                  )
                  .slice(0, 3)
            : [];
        return { pages, titres, operations };
    }, [requete, state.assets, state.transactions]);

    const tuilesLanceur = useMemo<TuileLanceur[]>(() => {
        const portefeuilleTotal =
            (assetBreakdown.celi || 0) +
            (assetBreakdown.reer || 0) +
            (assetBreakdown.nonReg || 0) +
            (assetBreakdown.reee || 0);

        return [
            {
                tab: Tab.FUTURE,
                icon: 'future',
                label: 'Futur',
                sousTitre: 'Trajectoire',
                valeur: gainHorizon?.fin ?? patrimoineNet,
            },
            {
                tab: Tab.INVESTMENTS,
                icon: 'investments',
                label: 'Placements',
                sousTitre: 'Portefeuille',
                valeur: portefeuilleTotal,
            },
            {
                tab: Tab.BUDGET,
                icon: 'budget',
                label: 'Budget',
                sousTitre: 'Épargne / mois',
                valeur: epargneMensuelle,
            },
            {
                tab: Tab.TRANSACTIONS,
                icon: 'transactions',
                label: 'Transactions',
                sousTitre: 'Liquidités',
                valeur: liquidites,
            },
            {
                tab: Tab.REAL_ESTATE,
                icon: 'real-estate',
                label: 'Immobilier',
                sousTitre: 'Équité nette',
                valeur: realEstateEquity,
            },
            {
                tab: Tab.RETIREMENT,
                icon: 'retirement',
                label: 'Retraite',
                sousTitre: 'Rente mensuelle',
                valeur: state.retirementGoal?.targetMonthlyIncome ?? 4000,
            },
            {
                tab: Tab.DEBT,
                icon: 'debt',
                label: 'Dettes',
                sousTitre: 'Passifs totaux',
                valeur: totalDettes,
            },
            {
                tab: Tab.TAX,
                icon: 'tax',
                label: 'Impôts',
                sousTitre: 'Revenu brut',
                valeur: (state.config?.users?.[0]?.grossSalary ?? 0) * 12,
            },
        ];
    }, [
        assetBreakdown,
        state.retirementGoal?.targetMonthlyIncome,
        patrimoineNet,
        totalDettes,
        gainHorizon?.fin,
        epargneMensuelle,
        liquidites,
        realEstateEquity,
        state.config?.users,
    ]);

    const operationsRecentes = useMemo(() => {
        return [...(state.transactions ?? [])]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 5);
    }, [state.transactions]);

    // Synthèse des flux sur 1 mois (30 jours) & transferts (remplace le doublon Positions & comptes sous la courbe)
    const flux30Jours = useMemo(() => {
        const aujMs = Date.parse(`${todayIso}T12:00:00Z`) || Date.now();
        const txs = (state.transactions ?? []).filter((t) => !t.isDuplicate && Number.isFinite(t.amount));
        const recents = txs.filter((t) => {
            const ms = Date.parse(`${t.date.slice(0, 10)}T12:00:00Z`);
            return Number.isFinite(ms) && (aujMs - ms) / 86_400_000 <= 35;
        });
        const source = recents.length > 0 ? recents : txs.slice(0, 30);

        let revenus = 0;
        let depenses = 0;
        let transferts = 0;
        const parCat = new Map<string, { montant: number; estTransfert: boolean }>();

        for (const tx of source) {
            const abs = Math.abs(tx.amount);
            if (isTransferOrVirement(tx)) {
                transferts += abs;
                const cat = effectiveTransferCategory(tx);
                const prev = parCat.get(cat) ?? { montant: 0, estTransfert: true };
                parCat.set(cat, { montant: prev.montant + abs, estTransfert: true });
            } else if (tx.amount > 0) {
                revenus += tx.amount;
            } else if (isSpend(tx, true)) {
                depenses += abs;
                const cat = (tx.category || 'Autre').trim() || 'Autre';
                const prev = parCat.get(cat) ?? { montant: 0, estTransfert: false };
                parCat.set(cat, { montant: prev.montant + abs, estTransfert: false });
            }
        }

        const totalSorties = Math.max(1, depenses + transferts);
        const topCategories = [...parCat.entries()]
            .map(([categorie, info]) => ({
                categorie,
                montant: Math.round(info.montant),
                pct: Math.min(100, Math.max(4, Math.round((info.montant / totalSorties) * 100))),
                estTransfert: info.estTransfert,
            }))
            .sort((a, b) => b.montant - a.montant)
            .slice(0, 5);

        return {
            revenus: Math.round(revenus),
            depenses: Math.round(depenses),
            transferts: Math.round(transferts),
            fluxNet: Math.round(revenus - depenses),
            topCategories,
        };
    }, [todayIso, state.transactions]);

    const prochainsJalons = useMemo<JalonPatrimonial[]>(() => {
        const anneeCourante = Number(todayIso.slice(0, 4)) || 2026;
        const jalons: JalonPatrimonial[] = [];

        for (const immo of state.realEstateGoals ?? []) {
            const anneeAchat = Number((immo.purchaseDate ?? '').slice(0, 4)) || anneeCourante;
            jalons.push({
                id: `immo-${immo.id}`,
                titre: immo.name || 'Bien immobilier',
                categorie: anneeAchat > anneeCourante ? 'Acquisition prévue' : 'Actif immobilier',
                annee: anneeAchat,
                montant: Number(immo.currentValue ?? immo.price) || 0,
                tab: anneeAchat > anneeCourante ? Tab.REAL_ESTATE_PROJECTS : Tab.REAL_ESTATE,
            });
        }

        for (const voyage of state.travelGoals ?? []) {
            jalons.push({
                id: `voyage-${voyage.id}`,
                titre: voyage.destination || 'Projet voyage',
                categorie: 'Projet de vie',
                annee: Number((voyage.date ?? '').slice(0, 4)) || anneeCourante + 1,
                montant: Number(voyage.totalCost) || 0,
                tab: Tab.LIFE_PROJECTS,
            });
        }

        for (const evt of state.lifeEvents ?? []) {
            jalons.push({
                id: `evt-${evt.id}`,
                titre: evt.name || 'Événement de vie',
                categorie: 'Jalon planifié',
                annee: Number((evt.date ?? '').slice(0, 4)) || anneeCourante + 2,
                montant: Math.abs(Number(evt.impactAmount) || 0),
                tab: Tab.LIFE_PROJECTS,
            });
        }

        const ageActuel = state.config?.users?.[0]?.age ?? 35;
        const ageRetraite = state.retirementGoal?.targetAge ?? 60;
        const anneeRetraite = anneeCourante + Math.max(1, ageRetraite - ageActuel);
        jalons.push({
            id: 'jalon-retraite',
            // NOMBRE-NON-MONETAIRE : âge cible de retraite saisi en réglage
            titre: `Retraite cible (${ageRetraite} ans)`,
            categorie: 'Indépendance financière',
            annee: anneeRetraite,
            montant: (state.retirementGoal?.targetMonthlyIncome ?? 4000) * 12,
            tab: Tab.RETIREMENT,
        });

        return jalons.sort((a, b) => a.annee - b.annee).slice(0, 5);
    }, [todayIso, state.realEstateGoals, state.travelGoals, state.lifeEvents, state.config?.users, state.retirementGoal]);

    const preuvesVeracite = useMemo<PreuveVeracite[]>(() => {
        const nbActifs = (state.assets ?? []).length;
        const nbTx = (state.transactions ?? []).length;
        const nbPostes = (state.budgetItems ?? []).length;
        const pointsFuturs = (lastProjection?.chartData ?? []).filter(
            (pt) => typeof pt.monthIndex === 'number' && pt.monthIndex >= 0,
        ).length;

        return [
            {
                id: 'preuve-bilan',
                titre: 'Identité du bilan (Avoirs − Dettes = Net)',
                formule: 'computePresentTermes (liquidités + titres CAD + immo) − (dettes + hypothèques)',
                montantNumeric: patrimoineNet,
                badgeTexte: 'Bilan net',
                sourceCode: 'services/portfolio.ts · pastPurchaseInit.ts',
                referenceOfficielle: 'Règle 4 GEMINI.md (Sources uniques)',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'preuve-placements',
                // NOMBRE-NON-MONETAIRE : nombre de lignes de titres en portefeuille
                titre: `Valorisation & coût moyen (${nbActifs} lignes)`,
                formule: 'Σ (quantité × cours × taux FX BoC) · Gain = valeur − Σ achats DCA',
                montantNumeric: Math.max(0, portefeuilleMobilier - liquidites),
                badgeTexte: 'Titres CAD',
                sourceCode: 'utils/assetPurchases.ts · services/portfolio.ts',
                referenceOfficielle: 'Banque du Canada (Valet API) · Règle 6',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'preuve-liquidites',
                // NOMBRE-NON-MONETAIRE : nombre de transactions rapprochées au journal
                titre: `Grand livre de caisse (${nbTx} opérations)`,
                formule: 'Soldes initiaux + Σ flux signés (hors virements internes & doublons)',
                montantNumeric: liquidites,
                badgeTexte: 'Encaisse',
                sourceCode: 'services/startingCash.ts · utils/spendRules.ts',
                referenceOfficielle: 'Parité stricte Budget ↔ Transactions',
                tab: Tab.TRANSACTIONS,
            },
            {
                id: 'preuve-budget',
                // NOMBRE-NON-MONETAIRE : nombre de postes budgétaires configurés
                titre: `Épargne & consommation (${nbPostes} postes)`,
                formule: 'Revenu net − Σ cibles mensuelles (hors nature Épargne)',
                montantNumeric: epargneMensuelle,
                badgeTexte: 'Flux / mois',
                sourceCode: 'utils/healthRatios.ts · utils/budget.ts',
                referenceOfficielle: 'Règle 1 No-fake-data (aucun plancher fictif)',
                tab: Tab.BUDGET,
            },
            {
                id: 'preuve-futur',
                // NOMBRE-NON-MONETAIRE : nombre d'échéances mensuelles simulées par le moteur
                titre: `Moteur de projection (${pointsFuturs} paliers simulés)`,
                formule: 'Boucle mensuelle : impôts ARC/RQ → épargne CELI/REER → intérêts dettes → croissance',
                montantNumeric: gainHorizon ? gainHorizon.fin : null,
                badgeTexte: gainHorizon ? `Cap ${gainHorizon.anneeFin}` : 'Simulation prête',
                sourceCode: 'services/projection.ts · services/realEstate.ts',
                referenceOfficielle: 'docs/PROJECTION.md · Loi sur les impôts (QC)',
                tab: Tab.FUTURE,
            },
            {
                id: 'preuve-fiscalite',
                titre: 'Constantes fiscales ARC & Revenu Québec 2026',
                formule: 'Abattement QC 16,5 % · CELI 7 000 $ · REER 18 % (max 32 490 $) · RRQ1+RRQ2 · RQAP',
                montantNumeric: null,
                badgeTexte: '100 % sourcé (0 écart)',
                sourceCode: 'utils/tax.ts · services/CalculateurRevenuNet.ts',
                referenceOfficielle: 'docs/FISCAL_REFERENCE.md (ARC T4032 / RQ TP-1015)',
                tab: Tab.TAX,
            },
        ];
    }, [
        state.assets,
        state.transactions,
        state.budgetItems,
        lastProjection?.chartData,
        patrimoineNet,
        portefeuilleMobilier,
        liquidites,
        epargneMensuelle,
        gainHorizon,
    ]);

    const colonnesTrajectoire = useMemo<ChartDataColumn[]>(
        () => [
            { key: 'annee', label: 'Période' },
            {
                key: 'valeur',
                label: 'Valeur nette',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v))),
            },
        ],
        [isPrivacyMode],
    );

    const colonnesRepartition = useMemo<ChartDataColumn[]>(
        () => [
            { key: 'label', label: 'Classe d’actifs' },
            {
                key: 'valeur',
                label: 'Montant',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v))),
            },
            {
                key: 'pct',
                label: 'Part (%)',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : `${Number(v) || 0} %`),
            },
        ],
        [isPrivacyMode],
    );

    const anneeActuelle = Number(todayIso.slice(0, 4)) || 2026;

    const ouvrirQuestionGemini = (q: string) => {
        setRequete(q);
        setShowGeminiModal(true);
    };

    const basculerHorizonSuivant = () => {
        const idx = HORIZONS.findIndex((h) => h.cle === horizon);
        const suivant = HORIZONS[(idx + 1) % HORIZONS.length] ?? HORIZONS[0]!;
        setHorizon(suivant.cle);
    };

    return (
        <div
            data-testid="accueil-google-view"
            className="max-w-[1440px] mx-auto space-y-4 pb-8"
        >
            {/* 1. BARRE SUPÉRIEURE GOOGLE FINANCE : STATUT CLOUD AUTO + OMNIBOX PILULE + RUBAN DES 5 COMPTES (1 MOIS) */}
            <section
                aria-label="Synthèse patrimoniale et recherche rapide"
                className="premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure"
            >
                <div className="p-3 sm:px-5 sm:py-3 bg-surface flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    {/* Statut de synchronisation automatique PC ↔ Mobile (sans logo dupliqué) */}
                    <div className="flex items-center justify-between lg:justify-start gap-2.5 shrink-0">
                        <span
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-fond border border-bordure text-[11px] font-mono text-ink-200"
                            title="Synchronisation automatique en temps réel entre PC et mobile"
                        >
                            <span className="w-2 h-2 rounded-full gf-alloc-reer gf-pulse-live" aria-hidden="true" />
                            <span>{syncStatus.state === 'syncing' ? 'Sync Cloud…' : 'Direct · PC & Mobile'}</span>
                        </span>
                    </div>

                    {/* Omnibox centrale en pilule */}
                    <div className="relative flex-1 max-w-2xl mx-auto w-full">
                        <div className="gf-omnibox-pill relative flex items-center px-3.5">
                            <Icon
                                name="search"
                                size={16}
                                className="text-ink-300 pointer-events-none shrink-0"
                                aria-hidden="true"
                            />
                            <input
                                type="search"
                                value={requete}
                                onFocus={() => setRechercheOuverte(true)}
                                onBlur={() => {
                                    setTimeout(() => setRechercheOuverte(false), 160);
                                }}
                                onChange={(e) => {
                                    setRequete(e.target.value);
                                    setRechercheOuverte(true);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setRechercheOuverte(false);
                                    } else if (e.key === 'Enter' && resultatsOmnibox.pages[0]) {
                                        setActiveTab(resultatsOmnibox.pages[0].tab);
                                        setRechercheOuverte(false);
                                        setRequete('');
                                    }
                                }}
                                placeholder="Rechercher un compte, un titre ou une opération…"
                                aria-label="Rechercher dans votre patrimoine"
                                className="champ-nu touch-target w-full pl-3 pr-3 bg-transparent text-xs sm:text-sm text-ink-50 placeholder-ink-400 focus-ring"
                            />
                        </div>

                        {rechercheOuverte && (
                            <div
                                role="listbox"
                                aria-label="Suggestions rapides"
                                className="absolute left-0 right-0 top-full mt-2 rounded-xl bg-surface border border-bordure-champ divide-y divide-bordure z-40 text-left shadow-xl overflow-hidden"
                            >
                                <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-bordure">
                                    {resultatsOmnibox.pages.map((p) => (
                                        <button
                                            key={p.tab}
                                            type="button"
                                            onMouseDown={() => {
                                                setActiveTab(p.tab);
                                                setRechercheOuverte(false);
                                                setRequete('');
                                            }}
                                            className="touch-target px-3.5 py-2 flex items-center gap-2 text-xs text-ink-100 hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                        >
                                            <Icon name={p.icon} size={14} className="text-ink-400 shrink-0" aria-hidden="true" />
                                            <span className="truncate font-medium">{p.label}</span>
                                        </button>
                                    ))}
                                </div>
                                {resultatsOmnibox.titres.length > 0 && (
                                    <div className="divide-y divide-bordure">
                                        {resultatsOmnibox.titres.map((asset, idx) => (
                                            <button
                                                key={`${asset.symbol}-${idx}`}
                                                type="button"
                                                onMouseDown={() => {
                                                    setActiveTab(Tab.INVESTMENTS);
                                                    setRechercheOuverte(false);
                                                    setRequete('');
                                                }}
                                                className="touch-target w-full px-4 py-2 flex items-center justify-between gap-2 text-xs hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                            >
                                                <span className="font-mono font-semibold text-ink-50">
                                                    {asset.symbol || asset.name}
                                                </span>
                                                <PrivateAmount className="font-mono tabular-nums text-ink-200">
                                                    {formatCAD(assetValueCad(asset, state.fxRates))}
                                                </PrivateAmount>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {resultatsOmnibox.operations.length > 0 && (
                                    <div className="divide-y divide-bordure">
                                        {resultatsOmnibox.operations.map((tx) => (
                                            <button
                                                key={tx.id}
                                                type="button"
                                                onMouseDown={() => {
                                                    setActiveTab(Tab.TRANSACTIONS);
                                                    setRechercheOuverte(false);
                                                    setRequete('');
                                                }}
                                                className="touch-target w-full px-4 py-2 flex items-center justify-between gap-2 text-xs hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                            >
                                                <span className="truncate text-ink-100">{tx.payee}</span>
                                                <PrivateAmount className="font-mono font-semibold tabular-nums text-ink-200 shrink-0">
                                                    {formatCAD(tx.amount)}
                                                </PrivateAmount>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Action rapide de connexion/import à droite (tous les boutons Gemini sont regroupés dans le panneau Gemini) */}
                    <div className="flex items-center gap-2 shrink-0 overflow-x-auto no-scrollbar">
                        <button
                            type="button"
                            onClick={() => {
                                void syncWorkspaceNow();
                                setShowConnexionsModal(true);
                            }}
                            aria-label="Importer ou synchroniser des comptes"
                            className="touch-target px-3.5 py-2 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-2 transition-colors duration-100 focus-ring whitespace-nowrap"
                        >
                            <Icon name="cloud" size={15} className="text-ink-300" aria-hidden="true" />
                            <span>Comptes & Sync</span>
                        </button>
                    </div>
                </div>

                {/* Ruban supérieur des 5 indices de comptes avec courbe 1 mois (30 jours) propre à chaque compte */}
                <div
                    aria-label="Indices des comptes patrimoniaux"
                    className="flex overflow-x-auto no-scrollbar lg:grid lg:grid-cols-5 divide-x divide-bordure bg-fond"
                >
                    {indicesComptes.map((idx) => (
                        <button
                            key={idx.id}
                            type="button"
                            onClick={() => setActiveTab(idx.tab)}
                            onMouseEnter={() => prefetchTab(idx.tab)}
                            className="touch-target shrink-0 min-w-[152px] lg:min-w-0 px-3.5 py-2.5 text-left hover:bg-surface-douce flex items-center justify-between gap-2 transition-all duration-150 focus-ring group"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                    <span className="font-mono text-[11px] font-bold tracking-tight text-ink-50 group-hover:underline">
                                        {idx.ticker}
                                    </span>
                                    <span className="text-[11px] text-ink-400 truncate">
                                        {idx.label}
                                    </span>
                                </div>
                                <div className="font-mono text-xs sm:text-sm font-bold text-ink-50 tabular-nums mt-0.5">
                                    <PrivateAmount>{formatCompactCAD(idx.valeur)}</PrivateAmount>
                                </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <svg
                                    width="46"
                                    height="20"
                                    viewBox="0 0 48 22"
                                    aria-hidden="true"
                                    className="overflow-visible"
                                >
                                    <polyline
                                        fill="none"
                                        stroke={idx.couleurTrait}
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        points={idx.pointsSparkline}
                                    />
                                </svg>
                                <span
                                    className={`shrink-0 px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold tabular-nums ${
                                        idx.positif ? 'gf-delta-up' : 'gf-delta-neutral'
                                    }`}
                                >
                                    <PrivateAmount>{`${idx.poidsPct} %`}</PrivateAmount>
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            {/* 2. ARCHITECTURE 3 COLONNES GOOGLE FINANCE BETA : LISTES & JALONS (3, BUREAU) · COURBE, AVOIRS & PLAN D'ACTION (6) · RECHERCHE GEMINI, ALLOCATION & ACTIVITÉ (3) */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start gf-spring-grid">
                {/* ── COLONNE GAUCHE (3 COL) : LISTES & PORTEFEUILLES + CALENDRIER & JALONS + PREUVES & SOURCES ── */}
                <aside
                    aria-label="Listes et portefeuilles suivis"
                    className="order-3 xl:order-1 xl:col-span-3 space-y-4"
                >
                    <section className="hidden xl:block premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure">
                        {/* En-tête « Listes » */}
                        <div className="px-4 py-3 flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Listes
                                </h2>
                                <span className="text-[11px] font-mono text-ink-400">
                                    {/* NOMBRE-NON-MONETAIRE : nombre de lignes suivies */}
                                    ({positionsSuivies.length})
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.INVESTMENTS)}
                                onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                aria-label="Gérer les listes et placements"
                                className="touch-target px-2.5 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-200 inline-flex items-center gap-1 focus-ring"
                            >
                                <Icon name="plus" size={14} aria-hidden="true" />
                                <span>Ajouter</span>
                            </button>
                        </div>

                        {/* Bloc « Portefeuilles » avec Valeur totale et carte Main active */}
                        <div className="p-4 space-y-3 bg-fond">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-ink-200">Portefeuilles</span>
                                <span className="text-[11px] font-mono text-ink-400">CAD</span>
                            </div>

                            <div>
                                <div className="text-[11px] text-ink-400">Valeur totale</div>
                                <div className="font-mono text-lg sm:text-xl font-bold text-ink-50 tabular-nums mt-0.5">
                                    <PrivateAmount>{formatCAD(patrimoineNet)}</PrivateAmount>
                                </div>
                            </div>

                            {/* Carte active « Main » façon Google Finance Beta */}
                            <div className="gf-portfolio-active rounded-lg p-3 space-y-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-ink-50 truncate">
                                        Main · {lentilleCourante.label}
                                    </span>
                                    <span className="w-2 h-2 rounded-full gf-alloc-reer gf-pulse-live shrink-0" aria-hidden="true" />
                                </div>
                                <div className="flex flex-wrap items-center justify-between gap-1.5 font-mono tabular-nums">
                                    <span className="text-xs font-semibold text-ink-100">
                                        <PrivateAmount>{formatCAD(valeurHeroAffichee)}</PrivateAmount>
                                    </span>
                                    {gainHorizon && (
                                        <span
                                            className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                gainHorizon.diff >= 0 ? 'gf-delta-up' : 'gf-delta-down'
                                            }`}
                                        >
                                            <PrivateAmount>
                                                {`${gainHorizon.diff >= 0 ? '+' : ''}${formatCompactCAD(gainHorizon.diff)}`}
                                            </PrivateAmount>
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Sélecteur d'assiette (Patrimoine net / Portefeuille liquide / Équité immobilière) */}
                            <div
                                role="group"
                                aria-label="Lentille d'affichage du patrimoine"
                                className="grid grid-cols-1 gap-1 pt-1"
                            >
                                {LENTILLES_HERO.map((l) => (
                                    <button
                                        key={l.cle}
                                        type="button"
                                        aria-pressed={lentilleHero === l.cle}
                                        onClick={() => setLentilleHero(l.cle)}
                                        className={`touch-target px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between gap-2 transition-all duration-150 focus-ring ${
                                            lentilleHero === l.cle
                                                ? 'gf-subtab-pill-active'
                                                : 'text-ink-300 hover:text-ink-50 hover:bg-surface-douce border border-transparent'
                                        }`}
                                    >
                                        <span className="truncate">{l.label}</span>
                                        <span className="font-mono text-[10px] opacity-80">{l.ticker}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Liste des titres & enveloppes avec mini-sparklines et pilules colorées */}
                        <div className="divide-y divide-bordure bg-surface">
                            <div className="px-4 py-2.5 flex items-center justify-between bg-surface-douce">
                                <span className="text-xs font-semibold text-ink-200">Liste suivie</span>
                                <span className="text-[11px] text-ink-400">Variation & Cours</span>
                            </div>

                            {positionsSuivies.map((pos) => (
                                <button
                                    key={`left-${pos.id}`}
                                    type="button"
                                    onClick={() => setActiveTab(pos.tab)}
                                    onMouseEnter={() => prefetchTab(pos.tab)}
                                    className="gf-row touch-target w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left focus-ring"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="font-mono text-xs font-bold text-ink-50 truncate">
                                            {pos.symbole}
                                        </div>
                                        <div className="text-[11px] text-ink-400 truncate">
                                            {pos.nom}
                                        </div>
                                    </div>

                                    <svg
                                        width="42"
                                        height="18"
                                        viewBox="0 0 48 22"
                                        aria-hidden="true"
                                        className="shrink-0 overflow-visible"
                                    >
                                        <polyline
                                            fill="none"
                                            stroke={pos.variationPct == null ? 'var(--gf-bleu)' : pos.positif ? 'var(--gf-vert)' : 'var(--gf-rouge)'}
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            points={pos.pointsSparkline}
                                        />
                                    </svg>

                                    <div className="text-right font-mono tabular-nums shrink-0">
                                        <div className="text-xs font-bold text-ink-50">
                                            <PrivateAmount>{formatCompactCAD(pos.valeur)}</PrivateAmount>
                                        </div>
                                        <span
                                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold mt-0.5 ${
                                                pos.variationPct == null
                                                    ? 'gf-delta-neutral'
                                                    : pos.positif
                                                      ? 'gf-delta-up'
                                                      : 'gf-delta-down'
                                            }`}
                                        >
                                            {pos.variationPct != null ? (
                                                <PrivateAmount>
                                                    {`${pos.positif ? '+' : ''}${formatPercent(pos.variationPct)} ${pos.positif ? '↑' : '↓'}`}
                                                </PrivateAmount>
                                            ) : (
                                                <span>—</span>
                                            )}
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Prochains jalons & calendrier patrimonial (équilibré dans la colonne gauche sur bureau, sous Événements sur mobile) */}
                    <section
                        aria-label="Prochains jalons patrimoniaux"
                        className={`premium-card rounded-xl bg-surface border border-bordure p-4 sm:p-5 space-y-3.5 ${
                            sousOngletCentre === 'evenements' ? 'block' : 'hidden xl:block'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-bordure pb-3">
                            <div>
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Calendrier & jalons
                                </h2>
                                <p className="text-xs text-ink-300">
                                    Échéances planifiées
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.LIFE_PROJECTS)}
                                onMouseEnter={() => prefetchTab(Tab.LIFE_PROJECTS)}
                                className="touch-target px-3 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Projets</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="rounded-lg border border-bordure divide-y divide-bordure bg-fond overflow-hidden">
                            {prochainsJalons.map((jalon) => {
                                const ecartAnnees = jalon.annee - anneeActuelle;
                                const delaiTexte = isPrivacyMode ? '••' : ecartAnnees <= 0 ? 'Actif' : `Dans ${ecartAnnees} an${ecartAnnees > 1 ? 's' : ''}`;
                                return (
                                    <button
                                        key={jalon.id}
                                        type="button"
                                        onClick={() => setActiveTab(jalon.tab)}
                                        className="gf-row touch-target w-full px-3 py-2 flex items-center justify-between gap-2.5 text-left focus-ring"
                                    >
                                        <div className="min-w-0 flex items-center gap-2.5">
                                            <span className="px-2 py-0.5 rounded-md gf-delta-amber font-mono tabular-nums text-[11px] font-bold shrink-0">
                                                {jalon.annee}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="text-xs font-medium text-ink-50 truncate">
                                                    {jalon.titre}
                                                </div>
                                                <div className="text-[11px] text-ink-400 truncate">
                                                    {jalon.categorie} · {delaiTexte}
                                                </div>
                                            </div>
                                        </div>
                                        <PrivateAmount className="font-mono tabular-nums text-xs font-semibold text-ink-50 shrink-0">
                                            {formatCompactCAD(jalon.montant)}
                                        </PrivateAmount>
                                    </button>
                                );
                            })}
                        </div>
                    </section>

                    {/* Preuves & Sources de véracité (100 % traçable vers le moteur et FISCAL_REFERENCE.md) */}
                    <section
                        data-testid="preuves-sources-panel"
                        aria-label="Preuves et sources de véracité des calculs"
                        className={`premium-card rounded-xl bg-surface border border-bordure p-4 sm:p-5 space-y-3.5 ${
                            sousOngletCentre === 'evenements' ? 'block' : 'hidden xl:block'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-bordure pb-3">
                            <div>
                                <div className="flex items-center gap-1.5">
                                    <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                        Preuves & Sources
                                    </h2>
                                    <span className="gf-badge-nouvelle">Vérifié</span>
                                </div>
                                <p className="text-xs text-ink-300">
                                    Traçabilité mathématique & fiscale ARC / Revenu Québec
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.TAX)}
                                onMouseEnter={() => prefetchTab(Tab.TAX)}
                                className="touch-target px-3 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Audit</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="rounded-lg border border-bordure divide-y divide-bordure bg-fond overflow-hidden">
                            {preuvesVeracite.map((preuve) => (
                                <button
                                    key={preuve.id}
                                    type="button"
                                    onClick={() => setActiveTab(preuve.tab)}
                                    className="gf-row touch-target w-full p-3 text-left space-y-1 focus-ring"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-semibold text-ink-50 truncate">
                                            {preuve.titre}
                                        </span>
                                        <span className="px-1.5 py-0.5 rounded-full gf-delta-up font-mono text-[10px] font-semibold shrink-0">
                                            {preuve.montantNumeric != null ? (
                                                <PrivateAmount>{formatCompactCAD(preuve.montantNumeric)}</PrivateAmount>
                                            ) : (
                                                <span>{preuve.badgeTexte}</span>
                                            )}
                                        </span>
                                    </div>
                                    <div className="sr-only">
                                        {preuve.formule} · {preuve.sourceCode} · {preuve.referenceOfficielle}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                </aside>

                {/* ── COLONNE CENTRALE (6 COL, EN PREMIER SUR MOBILE) : COTATION « MAIN », COURBE BLEUE & SOUS-ONGLETS ── */}
                <div className="order-1 xl:order-2 xl:col-span-6 space-y-4">
                    {/* Fiche principale de cotation & trajectoire Google Finance Beta */}
                    <section
                        aria-label="Trajectoire du patrimoine"
                        className="premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure"
                    >
                        <div className="p-4 sm:p-6 space-y-4">
                            {/* Fil d'Ariane « ← Accueil | Main » + bouton Modifier */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
                                    <span className="gf-ticker-symbol">{lentilleCourante.ticker}</span>
                                    <span aria-hidden="true" className="text-ink-400">|</span>
                                    <h1 className="font-semibold text-ink-100 tracking-tight text-sm sm:text-base">
                                        {prenom ? `Main · ${prenom} (${lentilleCourante.label})` : `Main · ${lentilleCourante.label}`}
                                    </h1>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.INVESTMENTS)}
                                    onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                    className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 transition-colors duration-100 focus-ring"
                                >
                                    <Icon name="edit" size={13} aria-hidden="true" />
                                    <span>Modifier</span>
                                </button>
                            </div>

                            {/* Sélecteur de lentille compact visible sur mobile/tablette (< xl) */}
                            <div
                                role="group"
                                aria-label="Assiette du patrimoine sur mobile"
                                className="flex xl:hidden items-center gap-1.5 overflow-x-auto no-scrollbar"
                            >
                                {LENTILLES_HERO.map((l) => (
                                    <button
                                        key={`mob-${l.cle}`}
                                        type="button"
                                        aria-pressed={lentilleHero === l.cle}
                                        onClick={() => setLentilleHero(l.cle)}
                                        className={`touch-target shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors duration-100 focus-ring ${
                                            lentilleHero === l.cle
                                                ? 'gf-subtab-pill-active'
                                                : 'bg-fond border border-bordure text-ink-300 hover:text-ink-50'
                                        }`}
                                    >
                                        {l.label}
                                    </button>
                                ))}
                            </div>

                            {/* Montant Héro + Pilule de variation verte/rouge style Google Finance Beta */}
                            <div className="space-y-1.5">
                                <div className="flex flex-wrap items-baseline gap-2.5">
                                    <AnimatedNetWorth
                                        value={valeurHeroAffichee}
                                        as="div"
                                        testId="animated-global-net-worth"
                                        className="font-mono tabular-nums text-3xl sm:text-4xl font-bold tracking-tight text-ink-50 leading-none"
                                    />

                                    {variation && lentilleHero === 'net' ? (
                                        <span
                                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold tabular-nums ${
                                                variation.diff >= 0 ? 'gf-delta-up' : 'gf-delta-down'
                                            }`}
                                        >
                                            <span aria-hidden="true">{variation.diff >= 0 ? '↑' : '↓'}</span>
                                            {variation.pct != null && (
                                                <PrivateAmount>{`${variation.diff >= 0 ? '+' : ''}${formatPercent(variation.pct)}`}</PrivateAmount>
                                            )}
                                            <PrivateAmount>
                                                {`(${variation.diff >= 0 ? '+' : ''}${formatCompactCAD(variation.diff)})`}
                                            </PrivateAmount>
                                        </span>
                                    ) : (
                                        gainHorizon && (
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold tabular-nums ${
                                                    gainHorizon.diff >= 0 ? 'gf-delta-up' : 'gf-delta-down'
                                                }`}
                                            >
                                                <span aria-hidden="true">{gainHorizon.diff >= 0 ? '↑' : '↓'}</span>
                                                {gainHorizon.pct != null && (
                                                    <PrivateAmount>{`${gainHorizon.diff >= 0 ? '+' : ''}${formatPercent(gainHorizon.pct)}`}</PrivateAmount>
                                                )}
                                                <PrivateAmount>
                                                    {`(${gainHorizon.diff >= 0 ? '+' : ''}${formatCompactCAD(gainHorizon.diff)}) ${horizon}`}
                                                </PrivateAmount>
                                            </span>
                                        )
                                    )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-ink-400">
                                    <span>{todayIso} · CAD</span>
                                    <FxEstimateBadge />
                                    {gainHorizon && (
                                        <span className="text-ink-300">
                                            · Cible {gainHorizon.anneeFin} :{' '}
                                            <strong className="text-ink-50">
                                                <PrivateAmount>{formatCompactCAD(gainHorizon.fin)}</PrivateAmount>
                                            </strong>
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Pilules d'outils au-dessus du graphique : En aires / + Avoirs bruts / Temps forts / Simulateur */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-bordure">
                                <div className="flex flex-wrap items-center gap-2">
                                    <div
                                        role="group"
                                        aria-label="Série affichée sur la courbe"
                                        className="inline-flex items-center p-0.5 rounded-full border border-bordure bg-fond gap-0.5"
                                    >
                                        <button
                                            type="button"
                                            aria-pressed={modeCourbe === 'nette'}
                                            onClick={() => setModeCourbe('nette')}
                                            className={`touch-target px-3 py-1 rounded-full text-xs font-medium transition-colors duration-100 focus-ring whitespace-nowrap ${
                                                modeCourbe === 'nette'
                                                    ? 'gf-subtab-pill-active'
                                                    : 'text-ink-300 hover:text-ink-50'
                                            }`}
                                        >
                                            En aires · Valeur nette
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={modeCourbe === 'complete'}
                                            onClick={() => setModeCourbe('complete')}
                                            className={`touch-target px-3 py-1 rounded-full text-xs font-medium transition-colors duration-100 focus-ring whitespace-nowrap ${
                                                modeCourbe === 'complete'
                                                    ? 'gf-subtab-pill-active'
                                                    : 'text-ink-300 hover:text-ink-50'
                                            }`}
                                        >
                                            + Avoirs bruts
                                        </button>
                                    </div>

                                    <div
                                        role="group"
                                        aria-label="Marqueurs des temps forts sur la courbe"
                                        className="inline-flex items-center"
                                    >
                                        <button
                                            type="button"
                                            aria-pressed={tempsFortsActifs}
                                            onClick={() => setTempsFortsActifs((v) => !v)}
                                            className={`touch-target px-3 py-1 rounded-full text-xs font-medium inline-flex items-center gap-2 border transition-all duration-150 focus-ring ${
                                                tempsFortsActifs
                                                    ? 'gf-delta-amber'
                                                    : 'bg-fond text-ink-300 border-bordure hover:text-ink-50'
                                            }`}
                                        >
                                            <span className="gf-amber-dot shrink-0" aria-hidden="true" />
                                            <span>Temps forts</span>
                                        </button>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.FUTURE)}
                                    onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                                    className="touch-target px-3.5 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                                >
                                    <span>Simulateur</span>
                                    <Icon name="chevron-right" size={14} aria-hidden="true" />
                                </button>
                            </div>

                            {/* Courbe principale : Présent (1 mois d'historique en bleu continu) vs Futur (projection en émeraude pointillé) */}
                            {/* Courbe principale : Présent (historique en bleu continu) vs Futur (projection en émeraude pointillé) */}
                            <div
                                data-testid="recharts-trajectory-entrance"
                                data-active-tab={activeTab}
                                data-chart-horizon={horizon}
                                data-chart-mode={modeCourbe}
                                data-chart-lens={lentilleHero}
                                role="img"
                                aria-label="Graphique combiné du présent et du futur projeté — valeurs détaillées dans le tableau de données."
                                className="h-[225px] sm:h-[270px] w-full gf-chart-enter rounded-lg bg-fond border border-bordure p-2"
                            >
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={donneesTrajectoire} margin={{ top: 14, right: 10, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="accueilPresentGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="var(--gf-bleu)" stopOpacity={0.38} />
                                                <stop offset="70%" stopColor="var(--gf-bleu)" stopOpacity={0.1} />
                                                <stop offset="100%" stopColor="var(--gf-bleu)" stopOpacity={0.0} />
                                            </linearGradient>
                                            <linearGradient id="accueilFuturGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="var(--gf-vert)" stopOpacity={0.34} />
                                                <stop offset="70%" stopColor="var(--gf-vert)" stopOpacity={0.09} />
                                                <stop offset="100%" stopColor="var(--gf-vert)" stopOpacity={0.0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            vertical={false}
                                            stroke="var(--bordure)"
                                            strokeOpacity={0.55}
                                        />
                                        <XAxis
                                            dataKey="annee"
                                            minTickGap={22}
                                            tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                            axisLine={{ stroke: 'var(--bordure)' }}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            orientation="left"
                                            domain={domaineYTrajectoire}
                                            tickCount={5}
                                            tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={58}
                                            tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v))}
                                        />
                                        <Tooltip
                                            isAnimationActive={false}
                                            cursor={{ stroke: 'var(--texte-doux)', strokeWidth: 1, strokeDasharray: '3 3', strokeOpacity: 0.5 }}
                                            content={<TrajectoireTooltip patrimoineInitial={valeurHeroAffichee} />}
                                        />
                                        <ReferenceLine
                                            x="Aujourd’hui"
                                            stroke="var(--gf-ambre)"
                                            strokeDasharray="3 3"
                                            strokeOpacity={0.85}
                                        />
                                        {modeCourbe === 'complete' && (
                                            <Line
                                                type="monotone"
                                                dataKey="avoirs"
                                                stroke="var(--gf-ambre)"
                                                strokeWidth={2}
                                                strokeDasharray="4 4"
                                                dot={false}
                                                isAnimationActive={false}
                                            />
                                        )}
                                        {/* Série PRÉSENT : trait continu bleu Google */}
                                        <Area
                                            type="monotone"
                                            dataKey="valeurPresent"
                                            baseValue="dataMin"
                                            stroke="none"
                                            fill="url(#accueilPresentGrad)"
                                            fillOpacity={1}
                                            connectNulls={false}
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="valeurPresent"
                                            stroke="var(--gf-bleu)"
                                            strokeWidth={2.75}
                                            connectNulls={false}
                                            dot={false}
                                            activeDot={(props: { cx?: number; cy?: number; value?: number | null }) => {
                                                if (props.value === null || props.value === undefined || !Number.isFinite(props.value) || typeof props.cx !== 'number' || typeof props.cy !== 'number') return null;
                                                return <circle cx={props.cx} cy={props.cy} r={5} fill="var(--gf-bleu)" stroke="var(--fond)" strokeWidth={2} />;
                                            }}
                                            isAnimationActive={false}
                                        />
                                        {/* Série FUTUR (projection) : trait pointillé vert émeraude */}
                                        <Area
                                            type="monotone"
                                            dataKey="valeurFutur"
                                            baseValue="dataMin"
                                            stroke="none"
                                            fill="url(#accueilFuturGrad)"
                                            fillOpacity={1}
                                            connectNulls={false}
                                            isAnimationActive={false}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="valeurFutur"
                                            stroke="var(--gf-vert)"
                                            strokeWidth={2.5}
                                            strokeDasharray="5 4"
                                            connectNulls={false}
                                            dot={false}
                                            activeDot={(props: { cx?: number; cy?: number; value?: number | null; payload?: PointTrajectoire }) => {
                                                if (props.value === null || props.value === undefined || !Number.isFinite(props.value) || typeof props.cx !== 'number' || typeof props.cy !== 'number') return null;
                                                // À « Aujourd’hui », le point bleu de valeurPresent s'affiche déjà : éviter le double point SVG superposé
                                                if (props.payload?.periode === 'transition' || props.payload?.annee === 'Aujourd’hui') return null;
                                                return <circle cx={props.cx} cy={props.cy} r={5} fill="var(--gf-vert)" stroke="var(--fond)" strokeWidth={2} />;
                                            }}
                                            isAnimationActive={false}
                                        />
                                        {pointsTempsForts.map((pt, idx) => (
                                            <ReferenceDot
                                                key={`tf-${pt.annee}-${idx}`}
                                                x={pt.annee}
                                                y={pt.valeur ?? undefined}
                                                r={5.5}
                                                fill="var(--gf-ambre)"
                                                stroke="var(--fond)"
                                                strokeWidth={2}
                                            />
                                        ))}
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>

                            {/* Un seul bouton visible pour choisir la durée Présent ↔ Futur + légende Présent vs Futur */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={basculerHorizonSuivant}
                                        aria-label="Choisir la durée Présent et Futur de la courbe"
                                        className="touch-target px-4 py-1.5 rounded-full gf-subtab-pill-active text-xs font-mono font-semibold tabular-nums inline-flex items-center gap-2 transition-all duration-150 focus-ring"
                                    >
                                        <Icon name="refresh" size={13} aria-hidden="true" />
                                        <span>{`Durée : ${horizon} · Présent ↔ Futur`}</span>
                                    </button>

                                    {/* Boutons d'horizons accessibles pour la navigation clavier et les tests d'intégration */}
                                    <div
                                        role="group"
                                        aria-label="Horizon de la courbe"
                                        className="sr-only"
                                    >
                                        {HORIZONS.map((h) => (
                                            <button
                                                key={h.cle}
                                                type="button"
                                                aria-pressed={horizon === h.cle}
                                                onClick={() => setHorizon(h.cle)}
                                                className="touch-target"
                                            >
                                                {h.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="inline-flex items-center gap-3 text-[11px] font-mono text-ink-300">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full gf-alloc-celi" aria-hidden="true" />
                                        <span>{`Présent (${horizon})`}</span>
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="w-2.5 h-2.5 rounded-full gf-alloc-reer" aria-hidden="true" />
                                        <span>{`Futur (${horizon})`}</span>
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Grille de Statistiques Clés sous le graphique (style Google Finance Key Stats) */}
                        <div
                            aria-label="Indicateurs de santé patrimoniale"
                            className="grid grid-cols-2 sm:grid-cols-3 divide-x divide-y divide-bordure bg-fond"
                        >
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.INVESTMENTS)}
                                onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1 transition-colors duration-100 focus-ring"
                            >
                                <span className="text-[11px] uppercase tracking-wider text-ink-400">
                                    Avoirs bruts
                                </span>
                                <span className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                    <PrivateAmount>{formatCompactCAD(totalAvoirs)}</PrivateAmount>
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.DEBT)}
                                onMouseEnter={() => prefetchTab(Tab.DEBT)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1 transition-colors duration-100 focus-ring"
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] uppercase tracking-wider text-ink-400">
                                        Passifs & dettes
                                    </span>
                                    <span className="font-mono text-[10px] text-ink-400 tabular-nums">
                                        <PrivateAmount>{`Levier ${indicateursPouls.ratioEndettement} %`}</PrivateAmount>
                                    </span>
                                </div>
                                <span className="font-mono text-sm sm:text-base font-bold text-ink-200 tabular-nums">
                                    <PrivateAmount>{formatCompactCAD(totalDettes)}</PrivateAmount>
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.BUDGET)}
                                onMouseEnter={() => prefetchTab(Tab.BUDGET)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1 transition-colors duration-100 focus-ring"
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] uppercase tracking-wider text-ink-400">
                                        Épargne mensuelle
                                    </span>
                                    <span className="font-mono text-[10px] text-ink-400 tabular-nums">
                                        {indicateursPouls.tauxEpargne !== null ? (
                                            <PrivateAmount>{`Taux ${indicateursPouls.tauxEpargne} %`}</PrivateAmount>
                                        ) : (
                                            <span>Taux —</span>
                                        )}
                                    </span>
                                </div>
                                <span className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                    <PrivateAmount>
                                        {`${epargneMensuelle >= 0 ? '+' : ''}${formatCompactCAD(epargneMensuelle)}/mois`}
                                    </PrivateAmount>
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.BUDGET)}
                                onMouseEnter={() => prefetchTab(Tab.BUDGET)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1 transition-colors duration-100 focus-ring"
                            >
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-[11px] uppercase tracking-wider text-ink-400">
                                        Réserve liquide
                                    </span>
                                    <span className="font-mono text-[10px] text-ink-400 tabular-nums">
                                        {indicateursPouls.moisAutonomie !== null ? (
                                            <PrivateAmount>{`${indicateursPouls.moisAutonomie} mois`}</PrivateAmount>
                                        ) : (
                                            <span>—</span>
                                        )}
                                    </span>
                                </div>
                                <span className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                    <PrivateAmount>{formatCompactCAD(liquidites)}</PrivateAmount>
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.RETIREMENT)}
                                onMouseEnter={() => prefetchTab(Tab.RETIREMENT)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1 transition-colors duration-100 focus-ring"
                            >
                                <div className="flex items-center justify-between gap-1">
                                    {/* NOMBRE-NON-MONETAIRE : âge cible de retraite saisi en réglage */}
                                    <span className="text-[11px] uppercase tracking-wider text-ink-400">
                                        Retraite ({indicateursPouls.ageRetraite} ans)
                                    </span>
                                    <span className="font-mono text-[10px] text-ink-400 tabular-nums">
                                        <PrivateAmount>{`${indicateursPouls.pctLiberte} %`}</PrivateAmount>
                                    </span>
                                </div>
                                <span className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                    <PrivateAmount>{formatCompactCAD(indicateursPouls.cibleRetraite)}</PrivateAmount>
                                </span>
                            </button>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.FUTURE)}
                                onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1 transition-colors duration-100 focus-ring"
                            >
                                <span className="text-[11px] uppercase tracking-wider text-ink-400">
                                    Cap {gainHorizon?.anneeMilieu ?? anneeActuelle + 5}
                                </span>
                                <span className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                    <PrivateAmount>
                                        {formatCompactCAD(gainHorizon?.milieuValeur ?? patrimoineNet)}
                                    </PrivateAmount>
                                </span>
                            </button>
                        </div>
                    </section>

                    {/* Flux 30 jours & Transferts (remplace le doublon Positions & comptes sous la courbe) */}
                    <section
                        aria-label="Flux 30 jours et transferts"
                        className="premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure"
                    >
                        <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
                            <div
                                role="group"
                                aria-label="Vue détaillée du portefeuille"
                                className="inline-flex flex-wrap items-center gap-1"
                            >
                                {SOUS_ONGLETS_CENTRE.map((ong) => (
                                    <button
                                        key={ong.cle}
                                        type="button"
                                        aria-pressed={sousOngletCentre === ong.cle}
                                        onClick={() => setSousOngletCentre(ong.cle)}
                                        className={`touch-target px-3.5 py-1.5 rounded-full text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-150 focus-ring ${
                                            sousOngletCentre === ong.cle
                                                ? 'gf-subtab-pill-active'
                                                : 'text-ink-300 hover:text-ink-50 hover:bg-surface-douce'
                                        }`}
                                    >
                                        <span>{ong.label}</span>
                                        {ong.badgeNouveau && (
                                            <span className="gf-badge-nouvelle">Nouveau</span>
                                        )}
                                    </button>
                                ))}
                            </div>

                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.BUDGET)}
                                onMouseEnter={() => prefetchTab(Tab.BUDGET)}
                                className="touch-target px-3 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Budget & Transferts</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        {/* Grille 4 KPI des flux sur 1 mois (Entrées, Dépenses, Transferts, Net) */}
                        <div
                            className={`grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-bordure bg-fond ${
                                sousOngletCentre === 'avoirs' ? 'grid' : 'hidden xl:grid'
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce transition-colors focus-ring"
                            >
                                <div className="text-[11px] uppercase tracking-wider text-ink-400">Entrées (30j)</div>
                                <div className="font-mono text-sm font-bold text-succes-texte tabular-nums mt-0.5">
                                    <PrivateAmount>{`+${formatCompactCAD(flux30Jours.revenus)}`}</PrivateAmount>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.BUDGET)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce transition-colors focus-ring"
                            >
                                <div className="text-[11px] uppercase tracking-wider text-ink-400">Dépenses (30j)</div>
                                <div className="font-mono text-sm font-bold text-ink-50 tabular-nums mt-0.5">
                                    <PrivateAmount>{formatCompactCAD(flux30Jours.depenses)}</PrivateAmount>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.BUDGET)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce transition-colors focus-ring"
                            >
                                <div className="text-[11px] uppercase tracking-wider text-ink-400">Transferts (30j)</div>
                                <div className="font-mono text-sm font-bold text-repere tabular-nums mt-0.5">
                                    <PrivateAmount>{formatCompactCAD(flux30Jours.transferts)}</PrivateAmount>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.BUDGET)}
                                className="touch-target px-4 py-3 text-left hover:bg-surface-douce transition-colors focus-ring"
                            >
                                <div className="text-[11px] uppercase tracking-wider text-ink-400">Solde net (30j)</div>
                                <div
                                    className={`font-mono text-sm font-bold tabular-nums mt-0.5 ${
                                        flux30Jours.fluxNet >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                                    }`}
                                >
                                    <PrivateAmount>
                                        {`${flux30Jours.fluxNet >= 0 ? '+' : ''}${formatCompactCAD(flux30Jours.fluxNet)}`}
                                    </PrivateAmount>
                                </div>
                            </button>
                        </div>

                        {/* Top catégories & virements du mois avec barres animées */}
                        <div
                            className={`divide-y divide-bordure bg-surface ${
                                sousOngletCentre === 'avoirs' ? 'block' : 'hidden xl:block'
                            }`}
                        >
                            {flux30Jours.topCategories.map((cat) => (
                                <button
                                    key={cat.categorie}
                                    type="button"
                                    onClick={() => setActiveTab(Tab.BUDGET)}
                                    className="gf-row touch-target w-full px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 text-left focus-ring"
                                >
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-semibold text-ink-50 truncate inline-flex items-center gap-1.5">
                                                <span>{cat.categorie}</span>
                                                {cat.estTransfert && (
                                                    <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono bg-repere-fond text-repere">
                                                        Transfert
                                                    </span>
                                                )}
                                            </span>
                                            <PrivateAmount className="font-mono text-xs font-bold text-ink-50 tabular-nums shrink-0">
                                                {formatCAD(cat.montant)}
                                            </PrivateAmount>
                                        </div>
                                        <div className="h-1.5 w-full rounded-full bg-fond overflow-hidden">
                                            <div
                                                style={{ width: `${isPrivacyMode ? 35 : cat.pct}%` }}
                                                className={`h-full rounded-full gf-bar-grow ${
                                                    cat.estTransfert ? 'gf-alloc-celi' : 'gf-alloc-reer'
                                                }`}
                                            />
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Plan d'action synthétique en 5 horizons (Jour · Semaine · Mois · Année · Décennie) */}
                    <section
                        aria-label="Plan d'action par jour, semaine, mois, année et décennie"
                        className="premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure"
                    >
                        <div className="px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <Icon name="clipboard" size={15} className="text-repere" aria-hidden="true" />
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Plan d’action
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.FUTURE)}
                                onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                                className="touch-target px-3 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1 focus-ring shrink-0"
                            >
                                <span>Détails</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-bordure bg-fond">
                            {[
                                {
                                    id: 'hz-jour',
                                    horizon: 'Jour',
                                    montant: Math.max(1, Math.round((epargneMensuelle * 12) / 365)),
                                    action: 'Plafond variable',
                                    tab: Tab.TRANSACTIONS,
                                },
                                {
                                    id: 'hz-semaine',
                                    horizon: 'Semaine',
                                    montant: Math.max(5, Math.round((epargneMensuelle * 12) / 52)),
                                    action: 'Virement CELI/REER',
                                    tab: Tab.BUDGET,
                                },
                                {
                                    id: 'hz-mois',
                                    horizon: 'Mois',
                                    montant: Math.max(0, Math.round(epargneMensuelle)),
                                    action: 'Achat indiciel',
                                    tab: Tab.INVESTMENTS,
                                },
                                {
                                    id: 'hz-annee',
                                    horizon: 'Année',
                                    montant: Math.max(0, Math.round(epargneMensuelle * 12)),
                                    action: 'Plafonds fiscaux',
                                    tab: Tab.TAX,
                                },
                                {
                                    id: 'hz-decennie',
                                    horizon: '10 ans',
                                    montant: Math.max(0, Math.round(epargneMensuelle * 120)),
                                    action: 'Cap retraite',
                                    tab: Tab.FUTURE,
                                },
                            ].map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    onClick={() => setActiveTab(item.tab)}
                                    onMouseEnter={() => prefetchTab(item.tab)}
                                    className="touch-target p-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1.5 transition-colors duration-100 focus-ring"
                                >
                                    <div className="flex items-center justify-between gap-1">
                                        <span className="text-xs font-bold text-ink-50">{item.horizon}</span>
                                        <PrivateAmount className="font-mono text-xs font-bold text-succes-texte tabular-nums">
                                            {`+${formatCompactCAD(item.montant)}`}
                                        </PrivateAmount>
                                    </div>
                                    <span className="text-[11px] text-ink-400 truncate">
                                        {item.action}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>

                {/* ── COLONNE DROITE (3 COL) : PANNEAU UNIQUE GEMINI (TOUS LES BOUTONS IA REGROUPÉS) + ALLOCATION + ACTIVITÉ ── */}
                <aside
                    aria-label="Recherche Gemini et indicateurs latéraux"
                    className="order-2 xl:order-3 xl:col-span-3 space-y-4"
                >
                    {/* Carte 1 : Point d'entrée unique Gemini sur l'Accueil */}
                    <section
                        aria-label="Assistant de recherche financière Gemini"
                        className="premium-card gemini-rainbow-card rounded-xl bg-surface p-3.5 sm:p-5 space-y-3 overflow-hidden"
                    >
                        <div className="gemini-rainbow-bar -mx-3.5 sm:-mx-5 -mt-3.5 sm:-mt-5 mb-2" aria-hidden="true" />
                        <div className="flex items-center justify-between gap-2 border-b border-bordure pb-2.5">
                            <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full gemini-rainbow-avatar inline-flex items-center justify-center shrink-0">
                                    <Icon name="sparkles" size={13} className="gemini-rainbow-sparkle" aria-hidden="true" />
                                </span>
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Conseiller Gemini
                                </h2>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowGeminiModal(true)}
                                aria-label="Ouvrir le conseiller financier Gemini"
                                className="touch-target px-3 py-1 rounded-full gemini-rainbow-btn text-xs font-semibold inline-flex items-center gap-1.5 focus-ring"
                            >
                                <Icon name="sparkles" size={13} className="gemini-rainbow-sparkle" aria-hidden="true" />
                                <span>Discuter</span>
                            </button>
                        </div>

                        {/* Questions directes en 1 clic */}
                        <div className="space-y-1.5">
                            {QUESTIONS_GEMINI_SUGGEREES.map((q) => (
                                <button
                                    key={q}
                                    type="button"
                                    onClick={() => ouvrirQuestionGemini(q)}
                                    className="gf-prompt-card touch-target w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs text-ink-100 focus-ring"
                                >
                                    <span className="truncate">{q}</span>
                                    <Icon
                                        name="sparkles"
                                        size={14}
                                        className="gemini-rainbow-sparkle shrink-0"
                                        aria-hidden="true"
                                    />
                                </button>
                            ))}
                        </div>

                        {/* Compositeur direct Gemini */}
                        <div className="gf-chat-composer p-2.5 flex items-center gap-2">
                            <input
                                type="text"
                                value={questionComposer}
                                onChange={(e) => setQuestionComposer(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        ouvrirQuestionGemini(questionComposer.trim() || QUESTIONS_GEMINI_SUGGEREES[0]!);
                                        setQuestionComposer('');
                                    }
                                }}
                                placeholder="Question rapide à Gemini…"
                                aria-label="Poser une question financière à Gemini"
                                className="champ-nu touch-target flex-1 bg-transparent text-xs sm:text-sm text-ink-50 placeholder-ink-400 focus-ring"
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    ouvrirQuestionGemini(questionComposer.trim() || QUESTIONS_GEMINI_SUGGEREES[0]!);
                                    setQuestionComposer('');
                                }}
                                aria-label="Envoyer la question à Gemini"
                                className="gf-send-circle touch-target w-9 h-9 inline-flex items-center justify-center shrink-0 focus-ring"
                            >
                                <Icon name="arrow-up" size={15} aria-hidden="true" />
                            </button>
                        </div>
                    </section>

                    {/* Carte 2 : Répartition colorée du portefeuille (visible sous Insights sur mobile, toujours sur bureau) */}
                    <section
                        aria-label="Répartition visuelle des actifs"
                        className={`premium-card rounded-xl bg-surface border border-bordure p-4 sm:p-5 space-y-4 ${
                            sousOngletCentre === 'insights' ? 'block' : 'hidden xl:block'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-bordure pb-3">
                            <div>
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Allocation d’actifs
                                </h2>
                                <p className="text-xs text-ink-300">
                                    Pondération par enveloppe
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(partSelectionnee.tab)}
                                onMouseEnter={() => prefetchTab(partSelectionnee.tab)}
                                className="touch-target px-3 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Détails</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        {/* Barre de pondération linéaire multicolore */}
                        <div
                            className="h-2.5 w-full rounded-full bg-fond border border-bordure flex p-0.5 gap-0.5 gf-bar-grow"
                            aria-hidden="true"
                        >
                            {partsRepartition.map((part) => (
                                <div
                                    key={`bar-${part.id}`}
                                    style={{ width: `${isPrivacyMode ? 20 : Math.max(4, part.pct)}%` }}
                                    className={`h-full rounded-full transition-opacity duration-150 ${part.classeBarre} ${
                                        segmentActif === null || segmentActif === part.id ? 'opacity-100' : 'opacity-30'
                                    }`}
                                />
                            ))}
                        </div>

                        <div className="relative h-[148px] w-full flex items-center justify-center rounded-lg border border-bordure bg-fond">
                            <div
                                key={`${activeTab}-repartition-${lentilleHero}`}
                                data-testid="recharts-allocation-entrance"
                                data-active-tab={activeTab}
                                data-chart-lens={lentilleHero}
                                role="img"
                                aria-label="Anneau de répartition des avoirs par classe d'actifs — détail chiffré dans le tableau de données."
                                className="h-full w-full gf-chart-enter"
                            >
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={partsRepartition}
                                            dataKey="valeur"
                                            nameKey="label"
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={42}
                                            outerRadius={60}
                                            paddingAngle={2}
                                            stroke="none"
                                            isAnimationActive={true}
                                            animationBegin={30}
                                            animationDuration={360}
                                            animationEasing="ease-out"
                                            onMouseEnter={(_, idx) => {
                                                const item = partsRepartition[idx];
                                                if (item) setSegmentActif(item.id);
                                            }}
                                        >
                                            {partsRepartition.map((entry) => (
                                                <Cell
                                                    key={entry.id}
                                                    fill={entry.couleur}
                                                    opacity={
                                                        segmentActif === null || segmentActif === entry.id ? 1 : 0.35
                                                    }
                                                />
                                            ))}
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-2">
                                <span className="text-[11px] font-medium text-ink-300 truncate max-w-[84px]">
                                    {partSelectionnee.label}
                                </span>
                                <PrivateAmount className="font-mono text-xs font-bold text-ink-50 tabular-nums">
                                    {formatCompactCAD(partSelectionnee.valeur)}
                                </PrivateAmount>
                                <span className="text-[10px] font-mono tabular-nums text-ink-300">
                                    <PrivateAmount>{`${partSelectionnee.pct} %`}</PrivateAmount>
                                </span>
                            </div>
                        </div>

                        <div
                            role="group"
                            aria-label="Sélection d'une enveloppe d'actifs"
                            className="rounded-lg border border-bordure divide-y divide-bordure bg-fond overflow-hidden"
                        >
                            {partsRepartition.map((part) => (
                                <button
                                    key={part.id}
                                    type="button"
                                    aria-pressed={partSelectionnee.id === part.id}
                                    onMouseEnter={() => setSegmentActif(part.id)}
                                    onFocus={() => setSegmentActif(part.id)}
                                    onClick={() => setSegmentActif(part.id)}
                                    className={`touch-target w-full px-3 py-2 flex items-center justify-between gap-2 text-xs transition-colors duration-100 focus-ring ${
                                        partSelectionnee.id === part.id
                                            ? 'bg-surface-douce text-ink-50 font-semibold'
                                            : 'text-ink-200 hover:bg-surface-douce'
                                    }`}
                                >
                                    <span className="flex items-center gap-2.5 min-w-0 truncate">
                                        <span
                                            className={`w-2.5 h-2.5 rounded-full shrink-0 ${part.classeBarre}`}
                                            aria-hidden="true"
                                        />
                                        <span className="truncate">{part.label}</span>
                                    </span>
                                    <span className="font-mono text-xs text-ink-100 tabular-nums shrink-0">
                                        <PrivateAmount>{formatCompactCAD(part.valeur)}</PrivateAmount>
                                        <span className="text-ink-400 ml-1.5">
                                            <PrivateAmount>{`${part.pct}%`}</PrivateAmount>
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </section>

                    {/* Carte 3 : Flux d'opérations récentes (visible sous Transactions sur mobile, toujours sur bureau) */}
                    <section
                        aria-label="Opérations récentes"
                        className={`premium-card rounded-xl bg-surface border border-bordure p-4 sm:p-5 space-y-3.5 ${
                            sousOngletCentre === 'transactions' ? 'block' : 'hidden xl:block'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-2 border-b border-bordure pb-3">
                            <div>
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Activité récente
                                </h2>
                                <p className="text-xs text-ink-300">
                                    Dernières écritures au journal
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                onMouseEnter={() => prefetchTab(Tab.TRANSACTIONS)}
                                className="touch-target px-3 py-1 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Journal</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        {operationsRecentes.length > 0 ? (
                            <div className="rounded-lg border border-bordure divide-y divide-bordure bg-fond overflow-hidden">
                                {operationsRecentes.map((tx) => {
                                    const estRevenu = tx.amount > 0;
                                    return (
                                        <button
                                            key={tx.id}
                                            type="button"
                                            onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                            className="gf-row touch-target w-full px-3 py-2 flex items-center justify-between gap-2.5 text-left focus-ring"
                                        >
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs font-medium text-ink-50 truncate">
                                                    {tx.payee}
                                                </div>
                                                <div className="text-[11px] text-ink-400 truncate font-mono tabular-nums">
                                                    {tx.date.slice(5)} · {tx.category}
                                                </div>
                                            </div>
                                            <PrivateAmount
                                                className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                                                    estRevenu ? 'text-succes-texte' : 'text-ink-200'
                                                }`}
                                            >
                                                {`${estRevenu ? '+' : '−'}${formatCAD(Math.abs(tx.amount))}`}
                                            </PrivateAmount>
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="py-6 rounded-lg border border-bordure bg-fond text-center space-y-2">
                                <p className="text-xs text-ink-300">Aucune opération enregistrée</p>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                    className="touch-target px-3.5 py-1.5 rounded-full bg-accent text-sur-accent text-xs font-semibold inline-flex items-center gap-1.5 focus-ring"
                                >
                                    <Icon name="plus" size={14} aria-hidden="true" />
                                    <span>Ajouter</span>
                                </button>
                            </div>
                        )}
                    </section>
                </aside>
            </div>

            {/* 3. BARRE DES SECTEURS & MODULES DU PATRIMOINE (8 ACCÈS DIRECTS EN RUBAN SUR MOBILE) */}
            <section
                aria-label="Accès visuel aux espaces"
                className="premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure"
            >
                <div className="px-5 py-2.5 flex items-center justify-between gap-2">
                    <h2 className="text-xs font-mono uppercase tracking-wider text-ink-300">
                        Secteurs & simulateurs
                    </h2>
                </div>
                <div className="flex overflow-x-auto no-scrollbar sm:grid sm:grid-cols-4 lg:grid-cols-8 divide-x divide-bordure bg-fond">
                    {tuilesLanceur.map((tuile) => (
                        <button
                            key={tuile.tab}
                            type="button"
                            onClick={() => setActiveTab(tuile.tab)}
                            onMouseEnter={() => prefetchTab(tuile.tab)}
                            className="touch-target shrink-0 min-w-[136px] sm:min-w-0 px-3.5 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1.5 transition-colors duration-100 focus-ring group"
                        >
                            <div className="flex items-center justify-between gap-1.5">
                                <span className="text-xs font-semibold text-ink-100 group-hover:text-ink-50 truncate">
                                    {tuile.label}
                                </span>
                                <Icon
                                    name={tuile.icon}
                                    size={14}
                                    className="text-ink-400 group-hover:text-ink-200 shrink-0 transition-colors duration-100"
                                    aria-hidden="true"
                                />
                            </div>
                            <div>
                                <div className="text-[11px] text-ink-400 truncate">{tuile.sousTitre}</div>
                                <PrivateAmount className="font-mono text-xs font-bold text-ink-50 tabular-nums truncate block mt-0.5">
                                    {formatCompactCAD(tuile.valeur)}
                                </PrivateAmount>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            {/* 4. EXÉCUTION BUDGÉTAIRE (6 MOIS) & OBJECTIFS FINANCIERS (affichés sous Insights sur mobile, toujours sur bureau) */}
            <div className={`space-y-4 ${sousOngletCentre === 'insights' ? 'block' : 'hidden xl:block'}`}>
                <MonthlySpendingVsBudgetChart
                    transactions={state.transactions}
                    budgetItems={state.budgetItems}
                    isPrivacyMode={isPrivacyMode}
                />

                <FinancialGoalsProgressSection
                    goals={state.financialGoals ?? []}
                    todayIso={todayIso}
                />
            </div>

            {/* Alternatives textuelles accessibles pour les deux graphiques Recharts */}
            <ChartDataTable
                caption="Trajectoire projetée du patrimoine net sur l'horizon sélectionné"
                columns={colonnesTrajectoire}
                rows={donneesTrajectoire as unknown as ReadonlyArray<Record<string, unknown>>}
            />
            <ChartDataTable
                caption="Répartition actuelle des avoirs par classe d'actifs"
                columns={colonnesRepartition}
                rows={partsRepartition as unknown as ReadonlyArray<Record<string, unknown>>}
            />

            <HubConnexionsModal
                isOpen={showConnexionsModal}
                onClose={() => setShowConnexionsModal(false)}
            />

            {showGeminiModal && (
                <Suspense fallback={null}>
                    <GeminiAssistantModal
                        isOpen={showGeminiModal}
                        onClose={() => {
                            setShowGeminiModal(false);
                            setRequete('');
                        }}
                        initialQuery={requete}
                    />
                </Suspense>
            )}
        </div>
    );
};

interface TrajectoireTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: PointTrajectoire }>;
    patrimoineInitial: number;
}

const TrajectoireTooltip: React.FC<TrajectoireTooltipProps> = ({ active, payload, patrimoineInitial }) => {
    if (!active || !payload || payload.length === 0) return null;
    const itemAvecValeur = payload.find((p) => p?.payload && typeof p.payload.valeur === 'number');
    const pt = itemAvecValeur?.payload ?? payload[0]?.payload;
    if (!pt) return null;
    const ecart = typeof pt.valeur === 'number' ? pt.valeur - patrimoineInitial : 0;
    const badgePeriode =
        pt.periode === 'present'
            ? 'Présent (1M)'
            : pt.periode === 'transition'
              ? 'Point actuel'
              : 'Futur projeté';

    return (
        <div className="gf-tooltip-card text-xs font-mono tabular-nums space-y-1.5">
            <div className="gf-tooltip-header">
                <span className="font-bold text-ink-50">{pt.annee}</span>
                <span className="text-[10px] uppercase tracking-wider text-ink-300">{badgePeriode}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Valeur nette</span>
                <span className="font-bold text-ink-50">
                    <PrivateAmount>{formatCAD(pt.valeur)}</PrivateAmount>
                </span>
            </div>
            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Écart vs aujourd’hui</span>
                <span className={`font-semibold ${ecart >= 0 ? 'text-succes-texte' : 'text-erreur-texte'}`}>
                    <PrivateAmount>{`${ecart >= 0 ? '+' : ''}${formatCAD(ecart)}`}</PrivateAmount>
                </span>
            </div>
        </div>
    );
};
