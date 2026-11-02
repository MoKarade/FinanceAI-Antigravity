import React, { useMemo, useState } from 'react';
import {
    ComposedChart,
    Bar,
    Area,
    Line,
    ReferenceLine,
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
import { GeminiAssistantModal } from './aiChat/GeminiAssistantModal';
import { prefetchTab } from '../utils/tabPrefetch';

export interface AccueilGoogleProps {
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

type HorizonCle = '1A' | '5A' | '10A' | 'MAX';
type LentilleHero = 'net' | 'portefeuille' | 'immobilier';
type ModeCourbe = 'nette' | 'complete';

interface PointTrajectoire {
    annee: string;
    valeur: number;
    avoirs: number;
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
    tab: Tab;
}

interface PositionSuivie {
    id: string;
    symbole: string;
    nom: string;
    compte: string;
    valeur: number;
    poidsPct: number;
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

const HORIZONS: ReadonlyArray<{ cle: HorizonCle; label: string; annees: number }> = [
    { cle: '1A', label: '1A', annees: 1 },
    { cle: '5A', label: '5A', annees: 5 },
    { cle: '10A', label: '10A', annees: 10 },
    { cle: 'MAX', label: 'MAX', annees: 30 },
];

const LENTILLES_HERO: ReadonlyArray<{ cle: LentilleHero; label: string; ticker: string }> = [
    { cle: 'net', label: 'Patrimoine net', ticker: 'BILAN:CAD' },
    { cle: 'portefeuille', label: 'Portefeuille liquide', ticker: 'LIQ:CAD' },
    { cle: 'immobilier', label: 'Équité immobilière', ticker: 'IMMO:CAD' },
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
 * Page d'accueil — Style Google Finance :
 * - Bandeau supérieur d'indices des comptes (CELI, REER, Non-enregistré, Immobilier, Liquidités)
 * - Barre de recherche Omnibox façon Google Finance
 * - Grille principale 8/4 : Cotation du patrimoine net + graphique interactif + statistiques clés + positions suivies à gauche ;
 *   Répartition du portefeuille + activité récente + calendrier des jalons à droite.
 */
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

    const [requete, setRequete] = useState('');
    const [rechercheOuverte, setRechercheOuverte] = useState(false);
    const [lentilleHero, setLentilleHero] = useState<LentilleHero>('net');
    const [horizon, setHorizon] = useState<HorizonCle>('10A');
    const [modeCourbe, setModeCourbe] = useState<ModeCourbe>('nette');
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

        const salaireMensuelBrut = (state.config?.users ?? []).reduce(
            (acc, u) => acc + (Number(u.grossSalary) || 0),
            0,
        );
        const tauxEpargne =
            salaireMensuelBrut > 0
                ? Math.round((epargneMensuelle / salaireMensuelBrut) * 100)
                : epargneMensuelle > 0
                  ? 20
                  : 0;

        const depensesMensuelles = Math.max(
            1_500,
            (state.budgetItems ?? [])
                .filter((b) => b.nature !== 'Epargne')
                .reduce((acc, b) => acc + (Number(b.target) || 0), 0),
        );
        const moisAutonomie = Number((liquidites / depensesMensuelles).toFixed(1));
        const ratioEndettement =
            totalAvoirs > 0 ? Math.min(100, Math.max(0, Math.round((totalDettes / totalAvoirs) * 100))) : 0;

        return {
            cibleRetraite,
            pctLiberte,
            ageRetraite,
            tauxEpargne,
            moisAutonomie,
            ratioEndettement,
        };
    }, [
        state.retirementGoal?.targetMonthlyIncome,
        state.retirementGoal?.targetAge,
        patrimoineNet,
        state.config?.users,
        epargneMensuelle,
        state.budgetItems,
        liquidites,
        totalAvoirs,
        totalDettes,
    ]);

    // Bandeau supérieur d'indices façon Google Finance (5 comptes clés du bilan)
    const indicesComptes = useMemo<IndiceCompte[]>(() => {
        const base = Math.max(1, totalAvoirs);
        const celi = Math.max(0, Math.round(assetBreakdown.celi || 0));
        const reer = Math.max(0, Math.round(assetBreakdown.reer || 0));
        const nonReg = Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0)));
        const immo = Math.max(0, Math.round(realEstateEquity));
        const cash = Math.max(0, Math.round(liquidites));

        return [
            {
                id: 'idx-celi',
                ticker: 'CELI',
                label: 'Compte libre d’impôt',
                valeur: celi,
                poidsPct: Math.round((celi / base) * 100),
                positif: celi > 0,
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'idx-reer',
                ticker: 'REER',
                label: 'Retraite enregistrée',
                valeur: reer,
                poidsPct: Math.round((reer / base) * 100),
                positif: reer > 0,
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'idx-nonreg',
                ticker: 'N-REG',
                label: 'Non-enregistré & REEE',
                valeur: nonReg,
                poidsPct: Math.round((nonReg / base) * 100),
                positif: nonReg > 0,
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'idx-immo',
                ticker: 'IMMO',
                label: 'Équité immobilière',
                valeur: immo,
                poidsPct: Math.round((immo / base) * 100),
                positif: immo > 0,
                tab: Tab.REAL_ESTATE,
            },
            {
                id: 'idx-cash',
                ticker: 'CASH',
                label: 'Liquidités & encaisse',
                valeur: cash,
                poidsPct: Math.round((cash / base) * 100),
                positif: cash > 0,
                tab: Tab.BUDGET,
            },
        ];
    }, [totalAvoirs, assetBreakdown, realEstateEquity, liquidites]);

    const donneesTrajectoire = useMemo<PointTrajectoire[]>(() => {
        const anneeCourante = Number(todayIso.slice(0, 4)) || 2026;
        const cfgHorizon = HORIZONS.find((h) => h.cle === horizon) ?? HORIZONS[2]!;
        const nbAnnees = cfgHorizon.annees;
        const ratioLentille =
            patrimoineNet > 0
                ? Math.max(0.15, Math.min(1.5, valeurHeroAffichee / patrimoineNet))
                : 1;

        const chartData = lastProjection?.chartData ?? [];
        const pointsFuturs = chartData.filter((pt) => typeof pt.monthIndex === 'number' && pt.monthIndex >= 0);

        if (pointsFuturs.length >= 2) {
            const maxMois = nbAnnees * 12;
            const filtres = pointsFuturs.filter((pt) => pt.monthIndex <= maxMois);
            const source = filtres.length >= 2 ? filtres : pointsFuturs;
            const pas = Math.max(1, Math.floor(source.length / 9));
            const echantillon: PointTrajectoire[] = [];
            for (let i = 0; i < source.length; i += pas) {
                const pt = source[i]!;
                const baseVal = Number.isFinite(pt.NetWorth) ? pt.NetWorth : patrimoineNet;
                const val = Math.round(baseVal * ratioLentille);
                echantillon.push({
                    annee: String(pt.year ?? anneeCourante + Math.round(pt.monthIndex / 12)),
                    valeur: val,
                    avoirs: Math.max(0, val + Math.round(Number(pt.DettesNonImmo) || 0)),
                    dettes: Math.max(0, Math.round(Number(pt.DettesNonImmo) || 0)),
                });
            }
            const dernier = source[source.length - 1];
            if (dernier && echantillon[echantillon.length - 1]?.annee !== String(dernier.year)) {
                const baseFin = Number.isFinite(dernier.NetWorth) ? dernier.NetWorth : patrimoineNet;
                const valFin = Math.round(baseFin * ratioLentille);
                echantillon.push({
                    annee: String(dernier.year ?? anneeCourante + nbAnnees),
                    valeur: valFin,
                    avoirs: Math.max(0, valFin),
                    dettes: Math.max(0, Math.round(Number(dernier.DettesNonImmo) || 0)),
                });
            }
            return echantillon;
        }

        const tauxAnnuel = (state.projection?.returnRate ?? 6.5) / 100;
        const points: PointTrajectoire[] = [];
        const nbPoints = Math.min(nbAnnees, 9);
        for (let i = 0; i <= nbPoints; i++) {
            const t = (i / Math.max(1, nbPoints)) * nbAnnees;
            const facteur = Math.pow(1 + tauxAnnuel, t);
            const cumulEpargne =
                tauxAnnuel > 0.001
                    ? epargneMensuelle * 12 * ((facteur - 1) / tauxAnnuel)
                    : epargneMensuelle * 12 * t;
            const valeurProjetee = Math.round(valeurHeroAffichee * facteur + cumulEpargne * ratioLentille);
            const dettesProjetees = Math.round(totalDettes * Math.max(0, 1 - t / 25));
            points.push({
                annee: String(Math.round(anneeCourante + t)),
                valeur: valeurProjetee,
                avoirs: Math.max(0, valeurProjetee + dettesProjetees),
                dettes: dettesProjetees,
            });
        }
        return points;
    }, [todayIso, horizon, lastProjection, patrimoineNet, valeurHeroAffichee, state.projection?.returnRate, epargneMensuelle, totalDettes]);

    const gainHorizon = useMemo(() => {
        if (donneesTrajectoire.length < 2) return null;
        const debut = donneesTrajectoire[0]!.valeur;
        const milieu = donneesTrajectoire[Math.floor(donneesTrajectoire.length / 2)]!;
        const fin = donneesTrajectoire[donneesTrajectoire.length - 1]!;
        const diff = fin.valeur - debut;
        const pct = Math.abs(debut) > 100 ? (diff / Math.abs(debut)) * 100 : null;
        return { diff, pct, fin: fin.valeur, anneeFin: fin.annee, milieuValeur: milieu.valeur, anneeMilieu: milieu.annee };
    }, [donneesTrajectoire]);

    const partsRepartition = useMemo<PartRepartition[]>(() => {
        const brutes: Array<Omit<PartRepartition, 'pct'>> = [
            {
                id: 'celi',
                code: 'CELI',
                label: 'CELI',
                sousTitre: 'Compte libre d’impôt',
                valeur: Math.max(0, Math.round(assetBreakdown.celi || 0)),
                couleur: 'var(--accent)',
                classeBarre: 'bg-accent',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'reer',
                code: 'REER',
                label: 'REER',
                sousTitre: 'Épargne retraite',
                valeur: Math.max(0, Math.round(assetBreakdown.reer || 0)),
                couleur: 'var(--accent-fonce)',
                classeBarre: 'bg-accent-fonce',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'immo',
                code: 'IMMO',
                label: 'Immobilier',
                sousTitre: 'Valeur brute des biens',
                valeur: Math.max(0, Math.round(realEstateValeur || 0)),
                couleur: 'var(--texte-doux)',
                classeBarre: 'bg-ink-300',
                tab: Tab.REAL_ESTATE,
            },
            {
                id: 'cash',
                code: 'CASH',
                label: 'Liquidités',
                sousTitre: 'Encaisse disponible',
                valeur: Math.max(0, Math.round(liquidites)),
                couleur: 'var(--bordure-champ)',
                classeBarre: 'bg-bordure-champ',
                tab: Tab.BUDGET,
            },
            {
                id: 'nonreg',
                code: 'N-REG',
                label: 'Non-enregistré',
                sousTitre: 'Comptes ordinaires & REEE',
                valeur: Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0))),
                couleur: 'var(--texte)',
                classeBarre: 'bg-ink-200',
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
                    sousTitre: 'Portefeuille global',
                    valeur: 1,
                    pct: 100,
                    couleur: 'var(--accent)',
                    classeBarre: 'bg-accent',
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

    // Positions suivies façon Watchlist Google Finance
    const positionsSuivies = useMemo<PositionSuivie[]>(() => {
        const actifs = [...(state.assets ?? [])]
            .map((a, idx) => {
                const rec = a as unknown as Record<string, unknown>;
                const val = Math.max(
                    0,
                    Math.round(
                        (Number(a.quantity) || 0) * (Number(a.currentPrice) || 0) ||
                            Number(rec.value) ||
                            0,
                    ),
                );
                const nomBrut = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.symbol || `Titre ${idx + 1}`;
                const symbole = (a.symbol || nomBrut.slice(0, 5) || `T${idx + 1}`).toUpperCase();
                return {
                    id: `asset-${symbole}-${idx}`,
                    symbole,
                    nom: nomBrut,
                    compte: a.accountType || 'Portefeuille',
                    valeur: val,
                    tab: Tab.INVESTMENTS,
                };
            })
            .filter((a) => a.valeur > 0)
            .sort((a, b) => b.valeur - a.valeur)
            .slice(0, 6);

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
            tab: p.tab,
        }));
    }, [state.assets, partsRepartition]);

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

    const colonnesTrajectoire = useMemo<ChartDataColumn[]>(
        () => [
            { key: 'annee', label: 'Année' },
            {
                key: 'valeur',
                label: 'Valeur nette projetée',
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v) || 0)),
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
                format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v) || 0)),
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

    return (
        <div
            data-testid="accueil-google-view"
            className="max-w-7xl mx-auto space-y-5 pb-8"
        >
            {/* 1. BANDEAU D'INDICES PATRIMONIAUX & BARRE DE RECHERCHE STYLE GOOGLE FINANCE */}
            <section
                aria-label="Synthèse patrimoniale et recherche rapide"
                className="rounded-md bg-surface border border-bordure divide-y divide-bordure"
            >
                {/* Ruban supérieur des 5 indices de comptes (Google Finance Market Strip) */}
                <div
                    aria-label="Indices des comptes patrimoniaux"
                    className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y lg:divide-y-0 divide-bordure bg-fond"
                >
                    {indicesComptes.map((idx) => (
                        <button
                            key={idx.id}
                            type="button"
                            onClick={() => setActiveTab(idx.tab)}
                            onMouseEnter={() => prefetchTab(idx.tab)}
                            className="touch-target px-3.5 py-2.5 text-left hover:bg-surface-douce flex items-center justify-between gap-2 transition-colors duration-100 focus-ring group"
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
                            <span
                                className={`shrink-0 px-2 py-0.5 rounded-sm font-mono text-[11px] font-semibold tabular-nums border ${
                                    idx.positif
                                        ? 'bg-succes-fond text-succes-texte border-bordure'
                                        : 'bg-surface-douce text-ink-300 border-bordure'
                                }`}
                            >
                                <PrivateAmount>{`${idx.poidsPct} %`}</PrivateAmount>
                            </span>
                        </button>
                    ))}
                </div>

                {/* Barre de recherche centrale Omnibox façon Google Finance */}
                <div className="p-4 sm:px-6 sm:py-4 bg-surface">
                    <div className="relative">
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
                            <div className="relative flex-1 flex items-center rounded-sm border border-bordure-champ bg-fond focus-within:border-accent transition-colors duration-100">
                                <Icon
                                    name="search"
                                    size={16}
                                    className="absolute left-3.5 text-ink-300 pointer-events-none"
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
                                    placeholder="Rechercher un titre, un FNB, un compte ou une écriture…"
                                    aria-label="Rechercher dans votre patrimoine"
                                    className="champ-nu touch-target w-full pl-10 pr-4 bg-transparent text-xs sm:text-sm text-ink-50 placeholder-ink-400 focus-ring"
                                />
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => setShowConnexionsModal(true)}
                                    aria-label="Importer ou synchroniser des comptes"
                                    className="touch-target px-3.5 py-2 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-2 transition-colors duration-100 focus-ring whitespace-nowrap"
                                >
                                    <Icon name="cloud" size={15} className="text-ink-300" aria-hidden="true" />
                                    <span>Synchroniser</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setShowGeminiModal(true)}
                                    aria-label="Ouvrir le conseiller financier Gemini"
                                    className="touch-target px-4 py-2 rounded-sm bg-accent text-sur-accent hover:bg-accent-fonce text-xs font-semibold inline-flex items-center gap-2 transition-colors duration-100 focus-ring whitespace-nowrap"
                                >
                                    <Icon name="sparkles" size={15} aria-hidden="true" />
                                    <span>Analyser</span>
                                </button>
                            </div>
                        </div>

                        {rechercheOuverte && (
                            <div
                                role="listbox"
                                aria-label="Suggestions rapides"
                                className="absolute left-0 right-0 top-full mt-1.5 rounded-sm bg-surface border border-bordure-champ divide-y divide-bordure z-40 text-left"
                            >
                                <button
                                    type="button"
                                    onMouseDown={() => {
                                        setRechercheOuverte(false);
                                        setShowGeminiModal(true);
                                    }}
                                    className="touch-target w-full px-4 py-2.5 bg-surface-douce flex items-center justify-between gap-2 text-xs font-medium text-ink-50 hover:bg-fond transition-colors duration-100 focus-ring"
                                >
                                    <span className="truncate">
                                        {requete.trim()
                                            ? `Interroger votre dossier : « ${requete.trim()} »`
                                            : 'Ouvrir l’analyse patrimoniale'}
                                    </span>
                                    <Icon name="arrow-right" size={14} className="text-ink-300" aria-hidden="true" />
                                </button>
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
                                                    {formatCAD((asset.quantity || 0) * (asset.currentPrice || 0))}
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
                </div>
            </section>

            {/* 2. GRILLE PRINCIPALE GOOGLE FINANCE : COTATION & COURBE (8 COL) + RAIL LATÉRAL (4 COL) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
                {/* COLONNE GAUCHE (8 COL) : FICHE DE COTATION PATRIMONIALE, COURBE & POSITIONS SUIVIES */}
                <div className="lg:col-span-8 space-y-5">
                    {/* Fiche principale de cotation & trajectoire Google Finance */}
                    <section
                        aria-label="Trajectoire du patrimoine"
                        className="rounded-md bg-surface border border-bordure divide-y divide-bordure"
                    >
                        {/* En-tête de cotation Google Finance */}
                        <div className="p-5 sm:p-6 space-y-4">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                                <div className="space-y-1">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-300">
                                        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                                            {lentilleCourante.ticker}
                                        </span>
                                        <span aria-hidden="true" className="text-ink-400">·</span>
                                        <h1 className="font-medium text-ink-200 tracking-tight">
                                            {prenom ? `${prenom} — ${lentilleCourante.label}` : lentilleCourante.label}
                                        </h1>
                                        <span aria-hidden="true" className="text-ink-400">·</span>
                                        <span className="font-mono text-[11px] tabular-nums text-ink-400">{todayIso}</span>
                                        <FxEstimateBadge />
                                    </div>

                                    {/* Valeur principale + Variation style Google Finance */}
                                    <div className="flex flex-wrap items-baseline gap-3 pt-1">
                                        <AnimatedNetWorth
                                            value={valeurHeroAffichee}
                                            as="div"
                                            testId="animated-global-net-worth"
                                            className="font-mono tabular-nums text-3xl sm:text-5xl font-bold tracking-tight text-ink-50 leading-none"
                                        />

                                        {variation && lentilleHero === 'net' && (
                                            <span
                                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs font-mono font-semibold tabular-nums ${
                                                    variation.diff >= 0
                                                        ? 'bg-succes-fond text-succes-texte border-bordure'
                                                        : 'bg-erreur-fond text-erreur-texte border-bordure'
                                                }`}
                                            >
                                                <span aria-hidden="true">{variation.diff >= 0 ? '▲' : '▼'}</span>
                                                <PrivateAmount>
                                                    {`${variation.diff >= 0 ? '+' : ''}${formatCompactCAD(variation.diff)}`}
                                                </PrivateAmount>
                                                {variation.pct != null && (
                                                    <PrivateAmount>{`(${formatPercent(variation.pct)})`}</PrivateAmount>
                                                )}
                                            </span>
                                        )}

                                        {gainHorizon && (
                                            <span className="text-xs font-mono tabular-nums text-ink-300">
                                                Projection {gainHorizon.anneeFin} :{' '}
                                                <strong className="text-ink-50">
                                                    <PrivateAmount>{formatCompactCAD(gainHorizon.fin)}</PrivateAmount>
                                                </strong>{' '}
                                                (
                                                <PrivateAmount>
                                                    {`${gainHorizon.diff >= 0 ? '+' : ''}${formatCompactCAD(gainHorizon.diff)}`}
                                                </PrivateAmount>
                                                )
                                            </span>
                                        )}
                                    </div>
                                </div>

                                {/* Sélecteur d'assiette (Patrimoine net / Portefeuille / Immobilier) */}
                                <div
                                    role="group"
                                    aria-label="Lentille d'affichage du patrimoine"
                                    className="inline-flex flex-wrap items-center p-0.5 rounded-sm border border-bordure bg-fond gap-0.5 self-start"
                                >
                                    {LENTILLES_HERO.map((l) => (
                                        <button
                                            key={l.cle}
                                            type="button"
                                            aria-pressed={lentilleHero === l.cle}
                                            onClick={() => setLentilleHero(l.cle)}
                                            className={`touch-target px-3 py-1.5 rounded-sm text-xs font-medium transition-colors duration-100 focus-ring whitespace-nowrap shrink-0 ${
                                                lentilleHero === l.cle
                                                    ? 'bg-accent text-sur-accent font-semibold'
                                                    : 'text-ink-300 hover:text-ink-50 hover:bg-surface-douce'
                                            }`}
                                        >
                                            {l.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Barre d'outils du graphique façon Google Finance (Périodes 1A / 5A / 10A / MAX + Série) */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-bordure">
                                <div
                                    role="group"
                                    aria-label="Horizon de la courbe"
                                    className="inline-flex items-center p-0.5 rounded-sm border border-bordure bg-fond gap-0.5"
                                >
                                    {HORIZONS.map((h) => (
                                        <button
                                            key={h.cle}
                                            type="button"
                                            aria-pressed={horizon === h.cle}
                                            onClick={() => setHorizon(h.cle)}
                                            className={`touch-target px-3 py-1 rounded-sm text-xs font-mono font-semibold tabular-nums transition-colors duration-100 focus-ring whitespace-nowrap shrink-0 ${
                                                horizon === h.cle
                                                    ? 'bg-accent text-sur-accent'
                                                    : 'text-ink-300 hover:text-ink-50'
                                            }`}
                                        >
                                            {h.label}
                                        </button>
                                    ))}
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <div
                                        role="group"
                                        aria-label="Série affichée sur la courbe"
                                        className="inline-flex items-center p-0.5 rounded-sm border border-bordure bg-fond gap-0.5"
                                    >
                                        <button
                                            type="button"
                                            aria-pressed={modeCourbe === 'nette'}
                                            onClick={() => setModeCourbe('nette')}
                                            className={`touch-target px-2.5 py-1 rounded-sm text-xs font-medium transition-colors duration-100 focus-ring whitespace-nowrap shrink-0 ${
                                                modeCourbe === 'nette'
                                                    ? 'bg-surface-douce text-ink-50 font-semibold border border-bordure-champ'
                                                    : 'text-ink-300 hover:text-ink-50 border border-transparent'
                                            }`}
                                        >
                                            Valeur nette
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={modeCourbe === 'complete'}
                                            onClick={() => setModeCourbe('complete')}
                                            className={`touch-target px-2.5 py-1 rounded-sm text-xs font-medium transition-colors duration-100 focus-ring whitespace-nowrap shrink-0 ${
                                                modeCourbe === 'complete'
                                                    ? 'bg-surface-douce text-ink-50 font-semibold border border-bordure-champ'
                                                    : 'text-ink-300 hover:text-ink-50 border border-transparent'
                                            }`}
                                        >
                                            + Avoirs bruts
                                        </button>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={() => setActiveTab(Tab.FUTURE)}
                                        onMouseEnter={() => prefetchTab(Tab.FUTURE)}
                                        className="touch-target px-3 py-1 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                                    >
                                        <span>Simulateur</span>
                                        <Icon name="chevron-right" size={14} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>

                            {/* Courbe interactive façon Google Finance */}
                            <div
                                key={`${activeTab}-trajectoire-${horizon}-${modeCourbe}-${lentilleHero}`}
                                data-testid="recharts-trajectory-entrance"
                                data-active-tab={activeTab}
                                data-chart-horizon={horizon}
                                data-chart-mode={modeCourbe}
                                data-chart-lens={lentilleHero}
                                role="img"
                                aria-label="Graphique combiné des paliers annuels et de la courbe du patrimoine selon l'horizon sélectionné — valeurs détaillées dans le tableau de données."
                                className="h-[220px] sm:h-[245px] w-full gf-chart-enter"
                            >
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={donneesTrajectoire} margin={{ top: 10, right: 6, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="accueilStepAreaGrad" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                                                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis
                                            dataKey="annee"
                                            tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                            axisLine={{ stroke: 'var(--bordure)' }}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            orientation="right"
                                            tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                            axisLine={false}
                                            tickLine={false}
                                            width={56}
                                            tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v))}
                                        />
                                        <Tooltip
                                            isAnimationActive={false}
                                            content={<TrajectoireTooltip patrimoineInitial={valeurHeroAffichee} />}
                                        />
                                        <ReferenceLine
                                            y={indicateursPouls.cibleRetraite}
                                            stroke="var(--bordure-champ)"
                                            strokeDasharray="3 3"
                                            strokeOpacity={0.75}
                                        />
                                        <Bar
                                            dataKey="valeur"
                                            fill="var(--bordure-champ)"
                                            fillOpacity={0.2}
                                            radius={[2, 2, 0, 0]}
                                            maxBarSize={22}
                                            isAnimationActive={true}
                                            animationDuration={320}
                                        />
                                        {modeCourbe === 'complete' && (
                                            <Line
                                                type="monotone"
                                                dataKey="avoirs"
                                                stroke="var(--texte-doux)"
                                                strokeWidth={1.75}
                                                strokeDasharray="4 4"
                                                dot={{ r: 2.5, fill: 'var(--texte-doux)', strokeWidth: 0 }}
                                                isAnimationActive={true}
                                                animationDuration={340}
                                            />
                                        )}
                                        <Area
                                            type="monotone"
                                            dataKey="valeur"
                                            stroke="none"
                                            fill="url(#accueilStepAreaGrad)"
                                            fillOpacity={1}
                                            isAnimationActive={true}
                                            animationDuration={360}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="valeur"
                                            stroke="var(--accent)"
                                            strokeWidth={2.25}
                                            dot={{ r: 3, fill: 'var(--accent)', strokeWidth: 0 }}
                                            activeDot={{ r: 4.5, fill: 'var(--accent)' }}
                                            isAnimationActive={true}
                                            animationDuration={380}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
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
                                        <PrivateAmount>{`Taux ${indicateursPouls.tauxEpargne} %`}</PrivateAmount>
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
                                        <PrivateAmount>{`${indicateursPouls.moisAutonomie} mois`}</PrivateAmount>
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

                    {/* Tableau Watchlist Google Finance : Vos positions & comptes suivis */}
                    <section
                        aria-label="Positions et comptes suivis"
                        className="rounded-md bg-surface border border-bordure divide-y divide-bordure"
                    >
                        <div className="px-5 py-3.5 flex items-center justify-between gap-2">
                            <div>
                                <h2 className="text-sm sm:text-base font-semibold text-ink-50 tracking-tight">
                                    Positions & comptes en portefeuille
                                </h2>
                                <p className="text-xs text-ink-300">
                                    Principales lignes cotées et enveloppes patrimoniales
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setActiveTab(Tab.INVESTMENTS)}
                                onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                className="touch-target px-3 py-1 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Portefeuille complet</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="divide-y divide-bordure bg-fond">
                            {positionsSuivies.map((pos) => (
                                <button
                                    key={pos.id}
                                    type="button"
                                    onClick={() => setActiveTab(pos.tab)}
                                    onMouseEnter={() => prefetchTab(pos.tab)}
                                    className="touch-target w-full px-4 sm:px-5 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                >
                                    <div className="min-w-0 flex items-center gap-3">
                                        <span className="w-14 shrink-0 px-2 py-0.5 rounded-sm bg-surface border border-bordure-champ font-mono text-[11px] font-bold text-ink-50 text-center truncate">
                                            {pos.symbole}
                                        </span>
                                        <div className="min-w-0">
                                            <div className="text-xs font-semibold text-ink-50 truncate">
                                                {pos.nom}
                                            </div>
                                            <div className="text-[11px] text-ink-400 truncate">
                                                {pos.compte}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums">
                                        <span className="text-xs font-bold text-ink-50">
                                            <PrivateAmount>{formatCAD(pos.valeur)}</PrivateAmount>
                                        </span>
                                        <span className="px-2 py-0.5 rounded-sm bg-surface-douce border border-bordure text-[11px] font-semibold text-ink-200">
                                            <PrivateAmount>{`${pos.poidsPct} %`}</PrivateAmount>
                                        </span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </section>
                </div>

                {/* COLONNE DROITE (4 COL) : RAIL GOOGLE FINANCE (ALLOCATION, ACTIVITÉ RÉCENTE, JALONS) */}
                <div className="lg:col-span-4 space-y-5">
                    {/* Carte 1 : Répartition du portefeuille */}
                    <section
                        aria-label="Répartition visuelle des actifs"
                        className="rounded-md bg-surface border border-bordure p-5 space-y-4"
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
                                className="touch-target px-3 py-1 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Détails</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        {/* Barre de pondération linéaire */}
                        <div
                            className="h-2.5 w-full rounded-sm bg-fond border border-bordure flex p-0.5 gap-0.5"
                            aria-hidden="true"
                        >
                            {partsRepartition.map((part) => (
                                <div
                                    key={`bar-${part.id}`}
                                    style={{ width: `${isPrivacyMode ? 20 : Math.max(4, part.pct)}%` }}
                                    className={`h-full transition-opacity duration-100 ${part.classeBarre} ${
                                        segmentActif === null || segmentActif === part.id ? 'opacity-100' : 'opacity-30'
                                    }`}
                                />
                            ))}
                        </div>

                        <div className="relative h-[148px] w-full flex items-center justify-center rounded-sm border border-bordure bg-fond">
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

                        <div className="rounded-sm border border-bordure divide-y divide-bordure bg-fond">
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
                                            className={`w-2 h-2 shrink-0 ${part.classeBarre}`}
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

                    {/* Carte 2 : Flux d'opérations récentes */}
                    <section
                        aria-label="Opérations récentes"
                        className="rounded-md bg-surface border border-bordure p-5 space-y-3.5"
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
                                className="touch-target px-3 py-1 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Journal</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        {operationsRecentes.length > 0 ? (
                            <div className="rounded-sm border border-bordure divide-y divide-bordure bg-fond">
                                {operationsRecentes.map((tx) => {
                                    const estRevenu = tx.amount < 0;
                                    return (
                                        <button
                                            key={tx.id}
                                            type="button"
                                            onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                            className="touch-target w-full px-3 py-2 flex items-center justify-between gap-2.5 text-left hover:bg-surface-douce transition-colors duration-100 focus-ring"
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
                            <div className="py-6 rounded-sm border border-bordure bg-fond text-center space-y-2">
                                <p className="text-xs text-ink-300">Aucune opération enregistrée</p>
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                    className="touch-target px-3.5 py-1.5 rounded-sm bg-accent text-sur-accent text-xs font-semibold inline-flex items-center gap-1.5 focus-ring"
                                >
                                    <Icon name="plus" size={14} aria-hidden="true" />
                                    <span>Ajouter</span>
                                </button>
                            </div>
                        )}
                    </section>

                    {/* Carte 3 : Prochains jalons & calendrier patrimonial */}
                    <section
                        aria-label="Prochains jalons patrimoniaux"
                        className="rounded-md bg-surface border border-bordure p-5 space-y-3.5"
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
                                className="touch-target px-3 py-1 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 inline-flex items-center gap-1 transition-colors duration-100 focus-ring whitespace-nowrap shrink-0"
                            >
                                <span>Projets</span>
                                <Icon name="chevron-right" size={14} aria-hidden="true" />
                            </button>
                        </div>

                        <div className="rounded-sm border border-bordure divide-y divide-bordure bg-fond">
                            {prochainsJalons.map((jalon) => {
                                const ecartAnnees = jalon.annee - anneeActuelle;
                                const delaiTexte = isPrivacyMode
                                    ? '••'
                                    : ecartAnnees <= 0
                                      ? 'Actif'
                                      : `Dans ${ecartAnnees} an${ecartAnnees > 1 ? 's' : ''}`;
                                return (
                                    <button
                                        key={jalon.id}
                                        type="button"
                                        onClick={() => setActiveTab(jalon.tab)}
                                        className="touch-target w-full px-3 py-2 flex items-center justify-between gap-2.5 text-left hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                    >
                                        <div className="min-w-0 flex items-center gap-2.5">
                                            <span className="px-1.5 py-0.5 rounded-sm bg-surface border border-bordure font-mono tabular-nums text-[11px] font-bold text-ink-200 shrink-0">
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
                </div>
            </div>

            {/* 3. BARRE DES SECTEURS & MODULES DU PATRIMOINE (8 ACCÈS DIRECTS) */}
            <section
                aria-label="Accès visuel aux espaces"
                className="rounded-md bg-surface border border-bordure divide-y divide-bordure"
            >
                <div className="px-5 py-3 flex items-center justify-between gap-2">
                    <h2 className="text-xs font-mono uppercase tracking-wider text-ink-300">
                        Modules & simulateurs FinanceAI
                    </h2>
                    <span className="text-[11px] text-ink-400">Accès direct par secteur</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-y lg:divide-y-0 divide-bordure bg-fond">
                    {tuilesLanceur.map((tuile) => (
                        <button
                            key={tuile.tab}
                            type="button"
                            onClick={() => setActiveTab(tuile.tab)}
                            onMouseEnter={() => prefetchTab(tuile.tab)}
                            className="touch-target px-3.5 py-3 text-left hover:bg-surface-douce flex flex-col justify-between gap-1.5 transition-colors duration-100 focus-ring group"
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

            {/* 4. EXÉCUTION BUDGÉTAIRE (6 MOIS) & OBJECTIFS FINANCIERS */}
            <MonthlySpendingVsBudgetChart
                transactions={state.transactions}
                budgetItems={state.budgetItems}
                isPrivacyMode={isPrivacyMode}
            />

            <FinancialGoalsProgressSection
                goals={state.financialGoals ?? []}
                todayIso={todayIso}
            />

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
                <GeminiAssistantModal
                    isOpen={showGeminiModal}
                    onClose={() => setShowGeminiModal(false)}
                    initialQuery={requete}
                />
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
    const pt = payload[0]?.payload;
    if (!pt) return null;
    const ecart = pt.valeur - patrimoineInitial;

    return (
        <div className="rounded-sm bg-surface border border-bordure-champ p-3 text-xs font-mono tabular-nums space-y-1.5">
            <div className="flex items-center justify-between gap-4 border-b border-bordure pb-1">
                <span className="font-bold text-ink-50">Année {pt.annee}</span>
                <span className="text-[10px] uppercase tracking-wider text-ink-300">Projection</span>
            </div>
            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Valeur nette</span>
                <span className="font-bold text-ink-50">
                    <PrivateAmount>{formatCAD(pt.valeur)}</PrivateAmount>
                </span>
            </div>
            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Avoirs bruts</span>
                <span className="font-semibold text-ink-200">
                    <PrivateAmount>{formatCAD(pt.avoirs)}</PrivateAmount>
                </span>
            </div>
            <div className="flex items-center justify-between gap-4">
                <span className="text-ink-300">Écart net</span>
                <span className="font-semibold text-ink-50">
                    <PrivateAmount>{`${ecart >= 0 ? '+' : ''}${formatCompactCAD(ecart)}`}</PrivateAmount>
                </span>
            </div>
        </div>
    );
};

export default AccueilGoogle;
