import type { Tab, AppState } from '../../types';
import type { ProjectionChartPoint } from '../../services/projection/types';

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

export type HorizonCle = '1M' | '3M' | '1A' | '5A' | '10A' | 'MAX' | '2025';
export type LentilleHero = 'net' | 'portefeuille' | 'liquidites' | 'immobilier';
export type ModeCourbe = 'nette' | 'complete';

export interface PrioriteActionPatrimoniale {
    id: string;
    rang: string;
    titre: string;
    description: string;
    statutLabel: string;
    statutClasse: 'gf-delta-up' | 'gf-delta-amber' | 'gf-delta-neutral' | 'gf-delta-down';
    montantPrincipal: number | null;
    cibleMontant: number | null;
    progressionPct: number;
    classeBarre: string;
    ctaLabel: string;
    tab: Tab;
}

export type PointTrajectoire = ProjectionChartPoint & {
    annee: string;
    valeur: number | null;
    valeurPresent: number | null;
    valeurFutur: number | null;
    periode: 'present' | 'transition' | 'futur';
    avoirs: number | null;
    dettes: number;
    portefeuille: number | null;
    mcP10: number | null;
    mcP50: number | null;
    mcP90: number | null;
};

export interface PartRepartition {
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

export interface PositionSuivie {
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

export interface JalonPatrimonial {
    id: string;
    titre: string;
    categorie: string;
    annee: number;
    montant: number;
    tab: Tab;
}
