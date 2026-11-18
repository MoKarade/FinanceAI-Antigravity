// components/future/FutureSimulationControls.tsx
// Lot 6 (F22) — Bandeau de commande de simulation Futur 2.0 (Design System Google Finance).
// Expose les 3 sélecteurs segmentés :
//  1. Base de dépenses : Budget cible / Comportement réel / Hybride
//  2. Hypothèses de rendements : Personnalisé / Normes IQPF 2026 / Actions réelles
//  3. Puissance Monte Carlo : Éclair (250) / Standard (1 000) / Approfondi (5 000) / Deep (10 000)
// Ainsi qu'un accès direct à la modale « Anatomie d'une année ».

import React from 'react';
import { Icon } from '../ui/Icon';
import { MC_POWER_TIERS, type McPowerTier } from '../../services/projection/monteCarlo';
import type { ProjectionConfig } from '../../types';

type ExpenseMode = NonNullable<ProjectionConfig['expenseProjectionMode']>;
type ReturnMode = NonNullable<ProjectionConfig['returnAssumptionsMode']>;

interface FutureSimulationControlsProps {
    projection: ProjectionConfig;
    runMC: boolean;
    setRunMC: (v: boolean) => void;
    onUpdateProjection: (next: ProjectionConfig) => void;
    onOpenYearAnatomy: () => void;
    selectedYear?: number;
}

const EXPENSE_OPTIONS: ReadonlyArray<{ value: ExpenseMode; label: string; hint: string }> = [
    { value: 'budget', label: 'Budget cible', hint: 'Projette tes dépenses cibles budgétées' },
    { value: 'real', label: 'Comportement réel', hint: 'Projette tes habitudes de dépenses constatées sur tes transactions' },
    { value: 'hybrid', label: 'Hybride', hint: 'Converge progressivement du réel (an 1) vers le budget cible (an 3)' },
];

const RETURN_OPTIONS: ReadonlyArray<{ value: ReturnMode; label: string; hint: string }> = [
    { value: 'custom', label: 'Personnalisé', hint: 'Taux configurés manuellement par enveloppe' },
    { value: 'iqpf', label: 'Normes IQPF 2026', hint: 'Hypothèses officielles IQPF / FP Canada 2026' },
    { value: 'real_holdings', label: 'Actions réelles', hint: 'Rendements nets de RFG et PBR réel de tes titres détenus' },
    { value: 'valoria_agents', label: 'Agents IA (7 Agents)', hint: 'Prévisions multi-horizon des 7 agents, Black-Litterman, DCF et krachs Merton' },
];

const MC_TIER_OPTIONS: ReadonlyArray<{ value: McPowerTier; label: string; count: number }> = [
    { value: 'eclair', label: 'Éclair', count: MC_POWER_TIERS.eclair },
    { value: 'standard', label: 'Standard', count: MC_POWER_TIERS.standard },
    { value: 'approfondi', label: 'Approfondi', count: MC_POWER_TIERS.approfondi },
    { value: 'deep_search', label: 'Deep', count: MC_POWER_TIERS.deep_search },
];

export const FutureSimulationControls: React.FC<FutureSimulationControlsProps> = ({
    projection,
    runMC,
    setRunMC,
    onUpdateProjection,
    onOpenYearAnatomy,
    selectedYear,
}) => {
    const activeExpenseMode: ExpenseMode = projection.expenseProjectionMode ?? 'budget';
    const activeReturnMode: ReturnMode = projection.returnAssumptionsMode ?? 'custom';
    const activeMcTier: McPowerTier = projection.mcPowerTier ?? 'standard';

    const handleExpenseChange = (mode: ExpenseMode) => {
        onUpdateProjection({
            ...projection,
            expenseProjectionMode: mode,
        });
    };

    const handleReturnChange = (mode: ReturnMode) => {
        onUpdateProjection({
            ...projection,
            returnAssumptionsMode: mode,
        });
    };

    return (
        <section
            aria-label="Commandes de simulation Futur 2.0"
            className="rounded-2xl bg-surface border border-bordure px-3.5 py-3 sm:px-5 sm:py-3.5"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                    {/* 1. Base de dépenses */}
                    <div className="flex flex-col gap-1">
                        <span className="text-tiny font-bold text-texte-doux">Base de dépenses</span>
                        <div
                            role="group"
                            aria-label="Base de dépenses"
                            className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-surface-douce border border-bordure p-1"
                        >
                            {EXPENSE_OPTIONS.map((opt) => {
                                const active = activeExpenseMode === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        aria-pressed={active}
                                        title={opt.hint}
                                        onClick={() => handleExpenseChange(opt.value)}
                                        className={`touch-target min-h-11 rounded-lg px-2.5 py-1.5 text-tiny font-bold focus-ring transition-colors ${
                                            active
                                                ? 'bg-accent text-sur-accent'
                                                : 'text-texte-doux hover:bg-fond hover:text-texte'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 2. Hypothèses de rendements */}
                    <div className="flex flex-col gap-1">
                        <span className="text-tiny font-bold text-texte-doux">Rendements</span>
                        <div
                            role="group"
                            aria-label="Hypothèses de rendements"
                            className="inline-flex flex-wrap items-center gap-1 rounded-xl bg-surface-douce border border-bordure p-1"
                        >
                            {RETURN_OPTIONS.map((opt) => {
                                const active = activeReturnMode === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        aria-pressed={active}
                                        title={opt.hint}
                                        onClick={() => handleReturnChange(opt.value)}
                                        className={`touch-target min-h-11 rounded-lg px-2.5 py-1.5 text-tiny font-bold focus-ring transition-colors ${
                                            active
                                                ? 'bg-accent text-sur-accent'
                                                : 'text-texte-doux hover:bg-fond hover:text-texte'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* 3. Couloir Monte Carlo (sélecteur unique sans redondance) */}
                    <div className="flex flex-col gap-1">
                        <label htmlFor="future-mc-power-select" className="text-tiny font-bold text-texte-doux">
                            Couloir Monte Carlo
                        </label>
                        <select
                            id="future-mc-power-select"
                            aria-label="Puissance Monte Carlo"
                            value={runMC ? activeMcTier : 'off'}
                            onChange={(e) => {
                                const val = e.target.value;
                                if (val === 'off') {
                                    setRunMC(false);
                                    return;
                                }
                                const tier = val as McPowerTier;
                                if (!runMC) setRunMC(true);
                                onUpdateProjection({
                                    ...projection,
                                    mcPowerTier: tier,
                                    monteCarloIterations: MC_POWER_TIERS[tier],
                                });
                            }}
                            className="touch-target min-h-11 rounded-xl border border-bordure bg-surface-douce px-3 py-2 text-tiny font-bold text-texte focus-ring transition-colors tabular-nums cursor-pointer"
                        >
                            <option value="off">Désactivé (courbe nette)</option>
                            {MC_TIER_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {/* NOMBRE-NON-MONETAIRE : palier technique fixe d'itérations Monte Carlo */}
                                    {opt.label} ({opt.count.toLocaleString('fr-CA')})
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Bouton d'accès direct à l'anatomie annuelle */}
                <button
                    type="button"
                    onClick={onOpenYearAnatomy}
                    className="touch-target min-h-11 inline-flex items-center gap-2 rounded-xl border border-bordure bg-surface-douce hover:bg-fond px-3.5 py-2 text-tiny font-bold text-texte focus-ring transition-colors"
                >
                    <Icon name="chart" size={15} className="text-accent" />
                    {/* NOMBRE-NON-MONETAIRE : année calendaire sélectionnée */}
                    <span>Anatomie d&apos;une année{selectedYear ? ` (${selectedYear})` : ''}</span>
                </button>
            </div>
        </section>
    );
};
