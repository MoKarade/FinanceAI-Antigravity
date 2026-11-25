import { Tab } from '../../types';
import type { ProjectionChartPoint } from '../../services/projection/types';
import type { IconName } from '../ui/Icon';
import type { HorizonCle, LentilleHero } from './types';

export const EMPTY_CHART_POINTS: ProjectionChartPoint[] = [];
export const X_AXIS_DOMAIN: ['dataMin', 'dataMax'] = ['dataMin', 'dataMax'];
export const RENDER_MAX_POINTS = 700;
export const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'] as const;

export const CURVE_FIELDS: ReadonlySet<string> = new Set([
    'Liquidites', 'CELI', 'CELIAPP', 'REER', 'REEE', 'NonReg', 'Crypto', 'Immobilier', 'Entreprise',
    'ImpotLatent', 'FluxImpots', 'P10', 'P50', 'P90', 'NetWorth', 'lockedNetWorth',
    'DettesNonImmo', 'DetteLevierSmith', 'year', 'age', 'isPast',
]);

export const HORIZONS: ReadonlyArray<{ cle: HorizonCle; label: string; annees: number; tempsFort: boolean }> = [
    { cle: '1M', label: '1M', annees: 0.085, tempsFort: true },
    { cle: '3M', label: '3M', annees: 0.25, tempsFort: true },
    { cle: '1A', label: '1A', annees: 1, tempsFort: true },
    { cle: '5A', label: '5A', annees: 5, tempsFort: true },
    { cle: '10A', label: '10A', annees: 10, tempsFort: true },
    { cle: 'MAX', label: 'MAX', annees: 30, tempsFort: true },
    { cle: '2025', label: '2025→', annees: 3, tempsFort: true },
];

export const LENTILLES_HERO: ReadonlyArray<{ cle: LentilleHero; label: string; ticker: string }> = [
    { cle: 'net', label: 'Patrimoine net', ticker: 'BILAN:CAD' },
    { cle: 'portefeuille', label: 'Portefeuille', ticker: 'PORT:CAD' },
    { cle: 'liquidites', label: 'Liquidités', ticker: 'CASH:CAD' },
    { cle: 'immobilier', label: 'Équité immobilière', ticker: 'IMMO:CAD' },
];

export const RACCOURCIS_RECHERCHE: ReadonlyArray<{ tab: Tab; label: string; icon: IconName }> = [
    { tab: Tab.FUTURE, label: 'Trajectoire & Futur', icon: 'future' },
    { tab: Tab.INVESTMENTS, label: 'Placements', icon: 'investments' },
    { tab: Tab.BUDGET, label: 'Budget & Flux', icon: 'budget' },
    { tab: Tab.TRANSACTIONS, label: 'Transactions', icon: 'transactions' },
    { tab: Tab.REAL_ESTATE, label: 'Immobilier', icon: 'real-estate' },
    { tab: Tab.RETIREMENT, label: 'Retraite', icon: 'retirement' },
    { tab: Tab.DEBT, label: 'Passifs & Dettes', icon: 'debt' },
    { tab: Tab.TAX, label: 'Impôts & Fiscalité', icon: 'tax' },
];

export function classePastilleValoria(sig: 'RENFORCER' | 'CONSERVER' | 'ALLEGER'): string {
    if (sig === 'RENFORCER') return 'gf-delta-up';
    if (sig === 'ALLEGER') return 'gf-delta-down';
    return 'gf-delta-neutral';
}

export function calculerEchelleNetteSerree(valeurs: ReadonlyArray<number>): { ticks: number[]; domaine: [number, number] } {
    if (valeurs.length === 0) return { ticks: [0, 50_000, 100_000], domaine: [0, 100_000] };
    const minVal = Math.min(...valeurs);
    const maxVal = Math.max(...valeurs);
    if (minVal === maxVal) {
        if (minVal === 0) return { ticks: [0, 50, 100], domaine: [0, 100] };
        const pad = Math.max(500, Math.round(Math.abs(maxVal) * 0.05));
        const bas = minVal >= 0 ? Math.max(0, Math.floor(minVal - pad)) : Math.floor(minVal - pad);
        const haut = Math.ceil(maxVal + pad);
        const mid = Math.round((bas + haut) / 2);
        return { ticks: [bas, mid, haut], domaine: [bas, haut] };
    }
    const span = maxVal - minVal;
    const basBrut = minVal >= 0 ? Math.max(0, minVal - span * 0.12) : minVal - span * 0.12;
    const hautBrut = maxVal + span * 0.14;
    const plage = Math.max(100, hautBrut - basBrut);
    const brutPas = plage / 4;
    const mag = 10 ** Math.floor(Math.log10(brutPas));
    const norm = brutPas / mag;
    const mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    const step = Math.max(50, Math.round(mult * mag));
    const bas = minVal >= 0
        ? Math.max(0, Math.floor(basBrut / step) * step)
        : Math.floor(basBrut / step) * step;
    const haut = Math.max(bas + step, Math.ceil(hautBrut / step) * step);
    const ticks: number[] = [];
    for (let t = bas; t <= haut + step * 0.001; t += step) {
        ticks.push(Math.round(t));
    }
    return { ticks, domaine: [bas, haut] };
}

/**
 * Sparkline SVG sur 1 mois (jusqu'à 30 points quotidiens réels, No-fake-data).
 * Conserve le style Google Finance épuré (`0..48` × `3..19`).
 */
export function construireSparklineReelle(valeurs: ReadonlyArray<number>): string {
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
            const y = amplitude > 0 ? Number((18.5 - ((val - min) / amplitude) * 15).toFixed(1)) : 11;
            return `${x},${Math.max(2.5, Math.min(19, y))}`;
        })
        .join(' ');
}

/**
 * Reconstruit une série quotidienne de 30 jours (1 mois d'historique : J-29 .. Aujourd'hui)
 * à partir des points de prix/achats d'un actif ou des flux réels d'un compte.
 */
export function construireSerie1Mois(
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
