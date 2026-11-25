import type { IconName } from '../ui/Icon';
import { parseValoriaFocusSection } from '../../services/valoria/valoriaIntegration';

export type PlacementsSubTab = 'portfolio' | 'ai_committee';
export type InitialPlacementsSubTab = PlacementsSubTab | 'quant_advisor';

export const PLACEMENTS_TABS: Array<{ id: PlacementsSubTab; label: string; icon: IconName }> = [
    { id: 'portfolio', label: 'Mon portefeuille', icon: 'chart' },
    { id: 'ai_committee', label: 'Analyse IA', icon: 'sparkles' },
];

export function shouldOpenExpertTools(section?: string | null): boolean {
    const target = parseValoriaFocusSection(section);
    return Boolean(target.tab || target.lab || target.assetId);
}

export interface AllocationItem {
    id: string;
    value: number;
    /** Performance % de PRIX NATIF sur la période choisie ; null = pas d'historique (« — »). */
    trendPct: number | null;
    weight: number;
    dividendYearly: number;
    name: string;
    sector: string;
    region: string;
    yield: number;
    freq: number;
    nextPayMonth?: number;
    symbol?: string;
}

export interface SeriesWithTrend {
    id: string;
    name: string;
    /** Variation % sur la période choisie ; null = pas de baseline dans la fenêtre (« — »). */
    trend: number | null;
    isTotal: boolean;
}

export interface DividendItem extends AllocationItem {
    nextPayout: string;
    amountPerPayout: number;
}

export type TargetModelEntry = Readonly<{
    id: string;
    label: string;
    targetPct: number;
    sectors: ReadonlyArray<string>;
    icon: IconName;
    color: string;
}>;
