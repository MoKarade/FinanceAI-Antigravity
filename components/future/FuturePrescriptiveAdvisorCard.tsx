// components/future/FuturePrescriptiveAdvisorCard.tsx
// Lot 6 (F24) — Carte de Diagnostic & Conseils Prescriptifs Chiffrés sur 3 horizons :
//  - Immédiat (fiscalité de l'année en cours : REER au TMED, Asset Location US, récolte de pertes sur PBR réel)
//  - Comportemental (mois à 3 paies, réduction de la dérive de dépenses)
//  - Structurel (point mort actuariel RRQ/PSV, Meltdown REER anti-clawback PSV, dettes coûteuses)
// Règles GEMINI.md :
//  - No-fake-data : n'affiche que les actions avec un gain réel calculé > 0 ; état honnête sinon.
//  - Sobriété Google Finance : cibles tactiles >= 44 px, zéro hover scale/translateY, `<PrivateAmount>`.

import React, { useMemo, useState } from 'react';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { formatCAD, formatPercent } from '../../utils/format';
import {
    generatePrescriptiveRecommendations,
    type PrescriptiveAdvice,
    type PrescriptiveHorizon,
} from '../../services/projection/prescriptiveAdvisor';
import type { SimulationParams, ProjectionResult } from '../../services/projection/types';
import type { Asset, ProjectionConfig, RetirementGoal } from '../../types';

interface FuturePrescriptiveAdvisorCardProps {
    params: SimulationParams;
    projectionResult?: ProjectionResult | null;
    assets: readonly Asset[];
    fxRates: Record<string, number>;
    projection: ProjectionConfig;
    retirementGoal: RetirementGoal;
    onApplyLever: (nextProj: ProjectionConfig, nextRetGoal?: RetirementGoal) => void;
}

const HORIZON_META: Record<PrescriptiveHorizon, { label: string; pillClass: string }> = {
    immediate: {
        label: 'Immédiat · Cette année fiscale',
        pillClass: 'border-accent/40 bg-accent-fonce/15 text-texte',
    },
    behavioral: {
        label: 'Comportemental · Habitudes mensuelles',
        pillClass: 'border-alerte-texte/35 bg-alerte-fond text-alerte-texte',
    },
    structural: {
        label: 'Structurel · Décisions de vie',
        pillClass: 'border-succes-texte/35 bg-succes-fond text-succes-texte',
    },
};

export const FuturePrescriptiveAdvisorCard: React.FC<FuturePrescriptiveAdvisorCardProps> = ({
    params,
    projectionResult,
    assets,
    fxRates,
    projection,
    retirementGoal,
    onApplyLever,
}) => {
    const [appliedIds, setAppliedIds] = useState<Record<string, boolean>>({});
    const [horizonFilter, setHorizonFilter] = useState<'all' | PrescriptiveHorizon>('all');

    const recommendations = useMemo(
        () =>
            generatePrescriptiveRecommendations({
                params,
                projectionResult,
                assets,
                fxRates,
                behavioralProfile: params.behavioralProfile,
            }),
        [params, projectionResult, assets, fxRates],
    );

    const visibleItems = useMemo(
        () => (horizonFilter === 'all' ? recommendations : recommendations.filter((r) => r.horizon === horizonFilter)),
        [recommendations, horizonFilter],
    );

    const handleApply = (item: PrescriptiveAdvice) => {
        if (!item.associatedLever) return;
        const nextProj: ProjectionConfig = item.associatedLever.projectionPatch
            ? { ...projection, ...item.associatedLever.projectionPatch }
            : projection;
        const nextRet: RetirementGoal | undefined = item.associatedLever.retirementPatch
            ? { ...retirementGoal, ...item.associatedLever.retirementPatch }
            : undefined;
        onApplyLever(nextProj, nextRet);
        setAppliedIds((prev) => ({ ...prev, [item.id]: true }));
    };

    return (
        <section
            aria-labelledby="futur-conseils-prescriptifs-titre"
            className="rounded-2xl bg-surface border border-bordure p-4 sm:p-5 space-y-3.5"
        >
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h3 id="futur-conseils-prescriptifs-titre" className="text-meta font-black text-texte flex items-center gap-2">
                        <Icon name="sparkles" size={16} className="text-accent" />
                        <span>Plan d&apos;action prescriptif chiffré</span>
                    </h3>
                    <p className="text-tiny text-texte-doux mt-0.5">
                        Optimisations fiscales ARC / Revenu Québec, habitudes réelles et décisions actuarielles triées par impact en dollars.
                    </p>
                </div>

                {/* Filtre d'horizon */}
                <div role="group" aria-label="Filtrer les recommandations par horizon" className="inline-flex flex-wrap gap-1 rounded-xl bg-surface-douce border border-bordure p-1">
                    {([
                        { id: 'all', label: 'Tous' },
                        { id: 'immediate', label: 'Immédiat' },
                        { id: 'behavioral', label: 'Comportemental' },
                        { id: 'structural', label: 'Structurel' },
                    ] as const).map((tab) => {
                        const active = horizonFilter === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                aria-pressed={active}
                                onClick={() => setHorizonFilter(tab.id)}
                                className={`touch-target min-h-11 rounded-lg px-2.5 py-1 text-tiny font-bold focus-ring transition-colors ${
                                    active
                                        ? 'bg-accent text-sur-accent'
                                        : 'text-texte-doux hover:bg-fond hover:text-texte'
                                }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {visibleItems.length === 0 ? (
                <div className="rounded-xl border border-bordure bg-surface-douce p-3.5 text-tiny text-texte-doux">
                    Aucune optimisation additionnelle détectée sur cet horizon avec les données actuelles de ton dossier.
                </div>
            ) : (
                <div
                    className={`grid gap-3 ${
                        visibleItems.length === 1
                            ? 'grid-cols-1'
                            : visibleItems.length === 3
                              ? 'grid-cols-1 xl:grid-cols-3'
                              : 'grid-cols-1 lg:grid-cols-2'
                    }`}
                >
                    {visibleItems.map((item) => {
                        const meta = HORIZON_META[item.horizon];
                        const isApplied = Boolean(appliedIds[item.id]);
                        return (
                            <article
                                key={item.id}
                                className="flex flex-col justify-between rounded-xl border border-bordure bg-surface-douce p-3.5 gap-3"
                            >
                                <div className="space-y-2">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-tiny font-bold ${meta.pillClass}`}>
                                            {meta.label}
                                        </span>
                                        {item.urgencyDeadline && (
                                            <span className="text-tiny font-semibold text-alerte-texte">
                                                Échéance : {item.urgencyDeadline}
                                            </span>
                                        )}
                                    </div>

                                    <h4 className="text-meta font-bold text-texte leading-snug">{item.title}</h4>
                                    <p className="text-tiny text-texte-doux leading-relaxed">
                                        <PrivateAmount>{item.description}</PrivateAmount>
                                    </p>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-bordure pt-2.5">
                                    <div className="flex flex-wrap items-baseline gap-2.5">
                                        <span className="text-meta font-black text-succes-texte tabular-nums">
                                            +<PrivateAmount>{formatCAD(item.impact.amountDollars)}</PrivateAmount>
                                        </span>
                                        {item.impact.monthsFreedom !== undefined && item.impact.monthsFreedom > 0 && (
                                            <span className="text-tiny font-semibold text-texte-doux tabular-nums">
                                                · +<PrivateAmount>{item.impact.monthsFreedom}</PrivateAmount> mois de liberté
                                            </span>
                                        )}
                                        {item.impact.effectiveTmedRate !== undefined && (
                                            <span className="text-tiny text-texte-doux tabular-nums">
                                                · TMED <PrivateAmount>{formatPercent(item.impact.effectiveTmedRate * 100)}</PrivateAmount>
                                            </span>
                                        )}
                                    </div>

                                    {item.associatedLever && (
                                        <button
                                            type="button"
                                            disabled={isApplied}
                                            onClick={() => handleApply(item)}
                                            className="touch-target min-h-11 rounded-lg border border-accent bg-accent/15 hover:bg-accent/25 disabled:opacity-60 px-3 py-1.5 text-tiny font-bold text-texte focus-ring transition-colors"
                                        >
                                            {isApplied ? 'Levier appliqué ✓' : 'Simuler ce levier'}
                                        </button>
                                    )}
                                </div>
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
};
