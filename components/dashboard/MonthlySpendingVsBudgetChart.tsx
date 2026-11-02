import React, { useMemo, useState } from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Cell,
    ReferenceLine,
} from 'recharts';
import { Tab, type BudgetCategory, type Transaction } from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { useTodayIsoLocal } from '../../hooks/useSimulationParams';
import { computeBudgetParity, isSavingsNature } from '../../utils/budget';
import { lastMonths } from '../../utils/budgetSync';
import { isSpend, spendAmountOf, isHorsComparaisonBudget } from '../../utils/spendRules';
import { monthlyConsumptionExpenses, monthlyTargetOf, computeBudgetParityScore } from '../../utils/healthRatios';
import { formatCAD, formatCompactCAD } from '../../utils/format';
import { maskedTick } from '../../utils/chartPrivacy';
import { MASKED_AMOUNT_LABEL } from '../../utils/privacyAria';
import { PrivateAmount } from '../ui/PrivateAmount';
import { Icon } from '../ui/Icon';
import { ChartDataTable, type ChartDataColumn } from '../ui/ChartDataTable';

type ModeVue = 'mensuel' | 'postes';

interface PointMensuel {
    moisCle: string;
    label: string;
    depenses: number;
    budget: number;
    ecart: number;
    estMoisCourant: boolean;
}

interface PointPoste {
    poste: string;
    depenses: number;
    budget: number;
    ecart: number;
}

interface MonthlySpendingVsBudgetChartProps {
    transactions?: readonly Transaction[];
    budgetItems?: readonly BudgetCategory[];
    isPrivacyMode?: boolean;
    className?: string;
}

function formaterMoisCourt(moisIso: string): string {
    const [y, m] = moisIso.split('-').map(Number);
    if (!y || !m) return moisIso;
    const d = new Date(y, m - 1, 1);
    return d.toLocaleDateString('fr-CA', { month: 'short' });
}

/**
 * Graphique à barres Recharts « Dépenses mensuelles vs Budget cible » pour visualiser
 * la santé budgétaire sur le tableau de bord principal et dans l'écran Santé financière.
 * Utilise la source unique (`monthlyConsumptionExpenses`, `computeBudgetParity`, `spendAmountOf`).
 */
export const MonthlySpendingVsBudgetChart: React.FC<MonthlySpendingVsBudgetChartProps> = ({
    transactions: propTransactions,
    budgetItems: propBudgetItems,
    isPrivacyMode: propPrivacyMode,
    className = '',
}) => {
    const storeTransactions = useFinanceStore((s) => s.transactions);
    const storeBudgetItems = useFinanceStore((s) => s.budgetItems);
    const storePrivacy = useFinanceStore((s) => s.isPrivacyMode);
    const activeTab = useFinanceStore((s) => s.activeTab);
    const setActiveTab = useFinanceStore((s) => s.setActiveTab);
    const todayIso = useTodayIsoLocal();

    const transactions = propTransactions ?? storeTransactions;
    const budgetItems = propBudgetItems ?? storeBudgetItems;
    const isPrivacyMode = propPrivacyMode ?? storePrivacy;

    const [modeVue, setModeVue] = useState<ModeVue>('mensuel');

    const dateRef = useMemo(() => {
        const [y, m, d] = todayIso.split('-').map(Number);
        if (!y || !m || !d) return new Date();
        return new Date(y, m - 1, d);
    }, [todayIso]);

    const moisCourantCle = todayIso.slice(0, 7);

    // Budget mensuel cible de consommation (hors épargne, source unique healthRatios)
    const budgetMensuelBrut = useMemo(
        () => monthlyConsumptionExpenses(budgetItems),
        [budgetItems],
    );
    const budgetMensuel = Number.isFinite(budgetMensuelBrut) && budgetMensuelBrut > 0
        ? Math.round(budgetMensuelBrut)
        : 0;

    // Série 1 : 6 derniers mois (Dépenses réelles vs Budget cible)
    const donneesMensuelles = useMemo<PointMensuel[]>(() => {
        const cles = lastMonths(6, dateRef);
        const totauxParMois = new Map<string, number>(cles.map((c) => [c, 0]));

        for (const t of transactions) {
            if (!isSpend(t) || isHorsComparaisonBudget(t)) continue;
            const m = t.date?.slice(0, 7) ?? '';
            if (!totauxParMois.has(m)) continue;
            const montant = spendAmountOf(t);
            if (!Number.isFinite(montant)) continue;
            totauxParMois.set(m, (totauxParMois.get(m) ?? 0) + montant);
        }

        return cles.map((moisCle) => {
            const depenses = Math.max(0, Math.round(totauxParMois.get(moisCle) ?? 0));
            return {
                moisCle,
                label: formaterMoisCourt(moisCle),
                depenses,
                budget: budgetMensuel,
                ecart: budgetMensuel - depenses,
                estMoisCourant: moisCle === moisCourantCle,
            };
        });
    }, [transactions, dateRef, budgetMensuel, moisCourantCle]);

    // Parité et score d'adhérence sur le mois courant
    const { donneesPostes, depenseMoisCourant, scoreAdherence } = useMemo(() => {
        const txMois = transactions.filter(
            (t) => (t.date?.slice(0, 7) ?? '') === moisCourantCle && isSpend(t),
        );
        const parity = computeBudgetParity(txMois, budgetItems);
        const score = computeBudgetParityScore(parity.actualsMap, budgetItems);

        const postes: PointPoste[] = [];
        for (const item of budgetItems) {
            if (isSavingsNature(item.nature)) continue;
            const cible = monthlyTargetOf(item);
            if (!Number.isFinite(cible)) continue;
            const reel = Math.max(0, Math.round(parity.actualsMap[item.name] ?? 0));
            const budgetArrondi = Math.max(0, Math.round(cible));
            if (budgetArrondi === 0 && reel === 0) continue;
            postes.push({
                poste: item.name,
                depenses: reel,
                budget: budgetArrondi,
                ecart: budgetArrondi - reel,
            });
        }

        postes.sort((a, b) => Math.max(b.depenses, b.budget) - Math.max(a.depenses, a.budget));

        const depenseCourante = Number.isFinite(parity.totalSpent)
            ? Math.max(0, Math.round(parity.totalSpent))
            : 0;

        return {
            donneesPostes: postes.slice(0, 7),
            depenseMoisCourant: depenseCourante,
            scoreAdherence: score !== null && Number.isFinite(score) ? Math.round(score) : null,
        };
    }, [transactions, budgetItems, moisCourantCle]);

    const ecartMoisCourant = budgetMensuel > 0 ? budgetMensuel - depenseMoisCourant : null;
    const estSousBudget = ecartMoisCourant !== null && ecartMoisCourant >= 0;

    const colonnesMensuelles = useMemo<ChartDataColumn[]>(() => [
        { key: 'label', label: 'Mois' },
        {
            key: 'depenses',
            label: 'Dépenses réelles',
            format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v) || 0)),
        },
        {
            key: 'budget',
            label: 'Budget cible',
            format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v) || 0)),
        },
    ], [isPrivacyMode]);

    const colonnesPostes = useMemo<ChartDataColumn[]>(() => [
        { key: 'poste', label: 'Poste budgétaire' },
        {
            key: 'depenses',
            label: 'Dépensé ce mois',
            format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v) || 0)),
        },
        {
            key: 'budget',
            label: 'Budget cible',
            format: (v) => (isPrivacyMode ? MASKED_AMOUNT_LABEL : formatCAD(Number(v) || 0)),
        },
    ], [isPrivacyMode]);

    const aucuneDonnee = budgetMensuel === 0 && donneesMensuelles.every((d) => d.depenses === 0);

    return (
        <section
            data-testid="monthly-spending-vs-budget-chart"
            aria-label="Dépenses mensuelles vs Budget cible"
            className={`rounded-md bg-surface border border-bordure divide-y divide-bordure gf-chart-enter ${className}`}
        >
            {/* En-tête : titre, indicateurs de santé budgétaire du mois et sélecteur de vue */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4">
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-base font-semibold text-ink-50 tracking-tight">
                            Dépenses mensuelles vs Budget
                        </h2>
                        {ecartMoisCourant !== null && (
                            <span
                                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-sm border text-xs font-medium font-mono tabular-nums ${
                                    estSousBudget
                                        ? 'bg-surface-douce text-ink-50 border-bordure-champ'
                                        : 'bg-erreur-fond text-erreur-texte border-bordure'
                                }`}
                            >
                                <span aria-hidden="true">{estSousBudget ? '✓' : '▲'}</span>
                                {estSousBudget ? (
                                    <span>
                                        Marge : <PrivateAmount>{formatCAD(ecartMoisCourant)}</PrivateAmount>
                                    </span>
                                ) : (
                                    <span>
                                        Dépassement : <PrivateAmount>{formatCAD(Math.abs(ecartMoisCourant))}</PrivateAmount>
                                    </span>
                                )}
                            </span>
                        )}
                        {scoreAdherence !== null && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-sm border border-bordure bg-fond text-xs font-mono tabular-nums font-medium text-ink-200">
                                Adhérence : <PrivateAmount>{`${scoreAdherence}/100`}</PrivateAmount>
                            </span>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
                    <div
                        role="group"
                        aria-label="Mode d'affichage du graphique budgétaire"
                        className="inline-flex items-center p-0.5 rounded-sm border border-bordure bg-fond gap-0.5"
                    >
                        <button
                            type="button"
                            aria-pressed={modeVue === 'mensuel'}
                            onClick={() => setModeVue('mensuel')}
                            className={`touch-target px-3 py-1 rounded-sm text-xs font-medium transition-colors duration-100 focus-ring ${
                                modeVue === 'mensuel'
                                    ? 'bg-accent text-sur-accent font-semibold'
                                    : 'text-ink-300 hover:text-ink-50 hover:bg-surface-douce'
                            }`}
                        >
                            6 derniers mois
                        </button>
                        <button
                            type="button"
                            aria-pressed={modeVue === 'postes'}
                            onClick={() => setModeVue('postes')}
                            className={`touch-target px-3 py-1 rounded-sm text-xs font-medium transition-colors duration-100 focus-ring ${
                                modeVue === 'postes'
                                    ? 'bg-accent text-sur-accent font-semibold'
                                    : 'text-ink-300 hover:text-ink-50 hover:bg-surface-douce'
                            }`}
                        >
                            Par poste ce mois
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.BUDGET)}
                        className="touch-target inline-flex items-center gap-1 px-3 py-1 rounded-sm border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs font-medium text-ink-100 transition-colors duration-100 focus-ring"
                    >
                        <span>Voir au Budget</span>
                        <Icon name="chevron-right" size={14} aria-hidden="true" />
                    </button>
                </div>
            </div>

            {/* Résumé chiffré rapide du mois en cours — grille 3 colonnes en Blanc & Gris */}
            <div className="grid grid-cols-2 sm:grid-cols-3 divide-y sm:divide-y-0 divide-x divide-bordure bg-fond">
                <div className="px-5 py-3.5 space-y-0.5">
                    <p className="text-xs text-ink-300">Dépensé ce mois</p>
                    <p className="text-base sm:text-lg font-bold font-mono tabular-nums text-ink-50">
                        <PrivateAmount>{formatCAD(depenseMoisCourant)}</PrivateAmount>
                    </p>
                </div>
                <div className="px-5 py-3.5 space-y-0.5">
                    <p className="text-xs text-ink-300">Budget mensuel cible</p>
                    <p className="text-base sm:text-lg font-bold font-mono tabular-nums text-ink-200">
                        {budgetMensuel > 0 ? <PrivateAmount>{formatCAD(budgetMensuel)}</PrivateAmount> : '—'}
                    </p>
                </div>
                <div className="col-span-2 sm:col-span-1 px-5 py-3.5 space-y-0.5">
                    <p className="text-xs text-ink-300">Rythme de consommation</p>
                    <p
                        className={`text-base sm:text-lg font-bold font-mono tabular-nums ${
                            ecartMoisCourant === null
                                ? 'text-ink-300'
                                : estSousBudget
                                    ? 'text-ink-50'
                                    : 'text-erreur-texte'
                        }`}
                    >
                        {budgetMensuel > 0 ? (
                            <PrivateAmount>{`${Math.round((depenseMoisCourant / budgetMensuel) * 100)} %`}</PrivateAmount>
                        ) : (
                            '—'
                        )}
                    </p>
                </div>
            </div>

            {/* Graphique à barres Recharts */}
            <div className="p-5 sm:p-6 bg-surface space-y-3">
                {aucuneDonnee ? (
                    <div className="py-8 text-center text-xs text-ink-400">
                        Aucune dépense ou cible budgétaire enregistrée sur les 6 derniers mois.
                    </div>
                ) : modeVue === 'mensuel' ? (
                    <div
                        key={`${activeTab}-mensuel`}
                        data-testid="recharts-budget-entrance"
                        data-active-tab={activeTab}
                        data-chart-mode="mensuel"
                        role="img"
                        aria-label="Comparaison mensuelle des dépenses réelles et du budget cible sur les 6 derniers mois — détail chiffré dans le tableau de données."
                        className="h-[190px] sm:h-[210px] w-full pt-1 gf-chart-enter"
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={donneesMensuelles}
                                margin={{ top: 10, right: 6, left: 0, bottom: 4 }}
                                barGap={5}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="var(--bordure)"
                                />
                                <XAxis
                                    dataKey="label"
                                    tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                    axisLine={{ stroke: 'var(--bordure)' }}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={50}
                                    tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v))}
                                />
                                <Tooltip
                                    isAnimationActive={true}
                                    animationDuration={90}
                                    cursor={{ fill: 'var(--surface-douce)', opacity: 0.45 }}
                                    content={<BudgetMensuelTooltip />}
                                />
                                {budgetMensuel > 0 && (
                                    <ReferenceLine
                                        y={budgetMensuel}
                                        stroke="var(--bordure-champ)"
                                        strokeDasharray="4 4"
                                        strokeWidth={1}
                                    />
                                )}
                                <Bar
                                    dataKey="budget"
                                    name="Budget cible"
                                    fill="var(--bordure-champ)"
                                    fillOpacity={0.3}
                                    radius={[2, 2, 0, 0]}
                                    maxBarSize={30}
                                    isAnimationActive={true}
                                    animationBegin={0}
                                    animationDuration={320}
                                    animationEasing="ease-out"
                                />
                                <Bar
                                    dataKey="depenses"
                                    name="Dépenses réelles"
                                    radius={[2, 2, 0, 0]}
                                    maxBarSize={30}
                                    isAnimationActive={true}
                                    animationBegin={50}
                                    animationDuration={360}
                                    animationEasing="ease-out"
                                >
                                    {donneesMensuelles.map((entry) => {
                                        const depasse = entry.budget > 0 && entry.depenses > entry.budget;
                                        return (
                                            <Cell
                                                key={entry.moisCle}
                                                fill={depasse ? 'var(--texte-doux)' : 'var(--accent)'}
                                            />
                                        );
                                    })}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                ) : (
                    <div
                        key={`${activeTab}-postes`}
                        data-testid="recharts-budget-entrance"
                        data-active-tab={activeTab}
                        data-chart-mode="postes"
                        role="img"
                        aria-label="Comparaison des dépenses du mois en cours et du budget cible par poste — détail chiffré dans le tableau de données."
                        className="h-[205px] w-full pt-1 gf-chart-enter"
                    >
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                                data={donneesPostes}
                                margin={{ top: 10, right: 12, left: 0, bottom: 4 }}
                                barGap={5}
                            >
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    vertical={false}
                                    stroke="var(--bordure)"
                                />
                                <XAxis
                                    dataKey="poste"
                                    tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                    axisLine={{ stroke: 'var(--bordure)' }}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fill: 'var(--texte-doux)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={64}
                                    tickFormatter={maskedTick(isPrivacyMode, (v: number) => formatCompactCAD(v))}
                                />
                                <Tooltip
                                    isAnimationActive={true}
                                    animationDuration={90}
                                    cursor={{ fill: 'var(--surface-douce)', opacity: 0.45 }}
                                    content={<BudgetPosteTooltip />}
                                />
                                <Bar
                                    dataKey="budget"
                                    name="Budget cible"
                                    fill="var(--bordure-champ)"
                                    fillOpacity={0.3}
                                    radius={[2, 2, 0, 0]}
                                    maxBarSize={26}
                                    isAnimationActive={true}
                                    animationBegin={0}
                                    animationDuration={320}
                                    animationEasing="ease-out"
                                />
                                <Bar
                                    dataKey="depenses"
                                    name="Dépensé ce mois"
                                    radius={[2, 2, 0, 0]}
                                    maxBarSize={26}
                                    isAnimationActive={true}
                                    animationBegin={50}
                                    animationDuration={360}
                                    animationEasing="ease-out"
                                >
                                    {donneesPostes.map((entry) => {
                                        const depasse = entry.budget > 0 && entry.depenses > entry.budget;
                                        return (
                                            <Cell
                                                key={entry.poste}
                                                fill={depasse ? 'var(--texte-doux)' : 'var(--accent)'}
                                            />
                                        );
                                    })}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {/* Légende monochrome Blanc & Gris */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-bordure text-xs text-ink-300">
                    <div className="flex flex-wrap items-center gap-4">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-1 bg-accent" aria-hidden="true" />
                            <span>Sous budget</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-1 bg-ink-300" aria-hidden="true" />
                            <span>Dépassement</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-1 bg-bordure-champ opacity-60" aria-hidden="true" />
                            <span>Cible</span>
                        </span>
                    </div>
                </div>
            </div>

            {/* Alternative textuelle accessible aux lecteurs d'écran */}
            {modeVue === 'mensuel' ? (
                <ChartDataTable
                    caption="Comparaison mensuelle des dépenses réelles et du budget cible sur 6 mois"
                    columns={colonnesMensuelles}
                    rows={donneesMensuelles as unknown as ReadonlyArray<Record<string, unknown>>}
                />
            ) : (
                <ChartDataTable
                    caption="Comparaison des dépenses du mois en cours et du budget cible par poste"
                    columns={colonnesPostes}
                    rows={donneesPostes as unknown as ReadonlyArray<Record<string, unknown>>}
                />
            )}
        </section>
    );
};

interface BudgetMensuelTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: PointMensuel }>;
}

const BudgetMensuelTooltip: React.FC<BudgetMensuelTooltipProps> = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const pt = payload[0]?.payload;
    if (!pt) return null;
    const depasse = pt.budget > 0 && pt.depenses > pt.budget;
    const ratio = pt.budget > 0 ? Math.round((pt.depenses / pt.budget) * 100) : null;

    return (
        <div className="gf-tooltip-card rounded-sm border border-bordure-champ bg-surface">
            <div className="gf-tooltip-header">
                <span className="font-mono text-xs font-bold text-ink-50">
                    {pt.label}
                </span>
                {ratio !== null && (
                    <span className="px-1.5 py-0.5 rounded-sm border border-bordure bg-surface-douce text-[10px] font-mono tabular-nums font-semibold text-ink-100">
                        <PrivateAmount>{`${ratio} %`}</PrivateAmount>
                    </span>
                )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:block sm:space-y-1">
                <div className="gf-tooltip-row">
                    <span className="text-xs text-ink-300">
                        Dépensé
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-ink-50">
                        <PrivateAmount>{formatCAD(pt.depenses)}</PrivateAmount>
                    </span>
                </div>
                <div className="gf-tooltip-row">
                    <span className="text-xs text-ink-300">
                        Budget
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-ink-200">
                        <PrivateAmount>{formatCAD(pt.budget)}</PrivateAmount>
                    </span>
                </div>
            </div>
            {pt.budget > 0 && (
                <>
                    <div className="hidden sm:block gf-tooltip-bar-track" aria-hidden="true">
                        <div
                            className="gf-tooltip-bar-fill"
                            style={{
                                width: `${Math.min(100, Math.max(0, ratio ?? 0))}%`,
                                backgroundColor: depasse ? 'var(--texte-doux)' : 'var(--accent)',
                            }}
                        />
                    </div>
                    <div className="gf-tooltip-divider gf-tooltip-row">
                        <span className="text-xs text-ink-300">{depasse ? 'Dépassement' : 'Marge'}</span>
                        <span className="font-mono font-semibold tabular-nums text-ink-50">
                            <PrivateAmount>{formatCAD(Math.abs(pt.ecart))}</PrivateAmount>
                        </span>
                    </div>
                </>
            )}
        </div>
    );
};

interface BudgetPosteTooltipProps {
    active?: boolean;
    payload?: Array<{ payload: PointPoste }>;
}

const BudgetPosteTooltip: React.FC<BudgetPosteTooltipProps> = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const pt = payload[0]?.payload;
    if (!pt) return null;
    const depasse = pt.budget > 0 && pt.depenses > pt.budget;
    const ratio = pt.budget > 0 ? Math.round((pt.depenses / pt.budget) * 100) : null;

    return (
        <div className="gf-tooltip-card rounded-sm border border-bordure-champ bg-surface">
            <div className="gf-tooltip-header">
                <span className="font-mono text-xs font-bold text-ink-50 truncate">{pt.poste}</span>
                {ratio !== null && (
                    <span className="px-1.5 py-0.5 rounded-sm border border-bordure bg-surface-douce text-[10px] font-mono tabular-nums font-semibold text-ink-100">
                        <PrivateAmount>{`${ratio} %`}</PrivateAmount>
                    </span>
                )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 sm:block sm:space-y-1">
                <div className="gf-tooltip-row">
                    <span className="text-xs text-ink-300">
                        Dépensé
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-ink-50">
                        <PrivateAmount>{formatCAD(pt.depenses)}</PrivateAmount>
                    </span>
                </div>
                <div className="gf-tooltip-row">
                    <span className="text-xs text-ink-300">
                        Budget
                    </span>
                    <span className="font-mono font-semibold tabular-nums text-ink-200">
                        <PrivateAmount>{formatCAD(pt.budget)}</PrivateAmount>
                    </span>
                </div>
            </div>
            {pt.budget > 0 && (
                <>
                    <div className="hidden sm:block gf-tooltip-bar-track" aria-hidden="true">
                        <div
                            className="gf-tooltip-bar-fill"
                            style={{
                                width: `${Math.min(100, Math.max(0, ratio ?? 0))}%`,
                                backgroundColor: depasse ? 'var(--texte-doux)' : 'var(--accent)',
                            }}
                        />
                    </div>
                    <div className="gf-tooltip-divider gf-tooltip-row">
                        <span className="text-xs text-ink-300">{depasse ? 'Dépassement' : 'Reste'}</span>
                        <span className="font-mono font-semibold tabular-nums text-ink-50">
                            <PrivateAmount>{formatCAD(Math.abs(pt.ecart))}</PrivateAmount>
                        </span>
                    </div>
                </>
            )}
        </div>
    );
};


