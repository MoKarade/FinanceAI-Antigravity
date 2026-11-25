import React from 'react';
import { Tab } from '../../types';
import type { ProjectionChartPoint } from '../../services/projection/types';
import { formatCompactCAD } from '../../utils/format';
import { prefetchTab } from '../../utils/tabPrefetch';
import { PrivateAmount } from '../ui/PrivateAmount';

interface AccueilRepereBandeauProps {
    setActiveTab: (tab: Tab) => void;
    patrimoineNet: number;
    jalonFire: ProjectionChartPoint | null;
    fireNumber: number;
    pctLiberte: number;
    pointRetraite: ProjectionChartPoint | null;
    ageRetraite: number;
    lastProjectionPresent: boolean;
    projectionStatus: string;
    dernierPoint: ProjectionChartPoint | null;
    patrimoineKpiValue?: string | null;
}

export const AccueilRepereBandeau: React.FC<AccueilRepereBandeauProps> = ({
    setActiveTab,
    patrimoineNet,
    jalonFire,
    fireNumber,
    pctLiberte,
    pointRetraite,
    ageRetraite,
    lastProjectionPresent,
    projectionStatus,
    dernierPoint,
    patrimoineKpiValue,
}) => (
    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-bordure bg-fond">
        <button
            type="button"
            onClick={() => setActiveTab(Tab.INVESTMENTS)}
            onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
            className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-300">Aujourd’hui</span>
                <span className="w-2 h-2 rounded-full gf-alloc-celi shrink-0" aria-hidden="true" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-ink-50 tabular-nums">
                <PrivateAmount>{formatCompactCAD(patrimoineNet)}</PrivateAmount>
            </div>
            <div className="text-xs text-ink-400">Bilan net actuel</div>
        </button>

        <button
            type="button"
            onClick={() => setActiveTab(Tab.FUTURE)}
            onMouseEnter={() => prefetchTab(Tab.FUTURE)}
            className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-300">
                    {jalonFire ? `Jalon FIRE (${jalonFire.year})` : 'Cible FIRE'}
                </span>
                <span className="w-2 h-2 rounded-full gf-alloc-immo shrink-0" aria-hidden="true" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-alerte-texte tabular-nums">
                <PrivateAmount>
                    {jalonFire && Number.isFinite(jalonFire.NetWorth)
                        ? formatCompactCAD(jalonFire.NetWorth)
                        : Number.isFinite(fireNumber) && fireNumber > 0
                          ? formatCompactCAD(fireNumber)
                          : '—'}
                </PrivateAmount>
            </div>
            <div className="text-xs text-ink-400">
                <PrivateAmount>{`${pctLiberte} % accompli`}</PrivateAmount>
            </div>
        </button>

        <button
            type="button"
            onClick={() => setActiveTab(Tab.RETIREMENT)}
            onMouseEnter={() => prefetchTab(Tab.RETIREMENT)}
            className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-300">
                    {/* NOMBRE-NON-MONETAIRE : âge de la retraite sur la carte jalon */}
                    {pointRetraite ? `Retraite (${pointRetraite.age} ans)` : `Retraite (${ageRetraite} ans)`}
                </span>
                <span className="w-2 h-2 rounded-full gf-alloc-reer shrink-0" aria-hidden="true" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-ink-50 tabular-nums">
                {lastProjectionPresent && pointRetraite && Number.isFinite(pointRetraite.NetWorth) ? (
                    <PrivateAmount>{formatCompactCAD(pointRetraite.NetWorth)}</PrivateAmount>
                ) : (
                    <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">
                            {projectionStatus === 'computing' ? 'Calcul en cours' : 'Simulation requise'}
                        </span>
                    </>
                )}
            </div>
            <div className="text-xs text-ink-400">Patrimoine projeté</div>
        </button>

        <button
            type="button"
            onClick={() => setActiveTab(Tab.FUTURE)}
            onMouseEnter={() => prefetchTab(Tab.FUTURE)}
            className="touch-target px-5 sm:px-6 py-4 text-left hover:bg-surface-douce space-y-1 transition-colors focus-ring"
        >
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-300">
                    {/* NOMBRE-NON-MONETAIRE : âge de fin d'horizon sur la carte jalon */}
                    {dernierPoint ? `Fin d’horizon (${dernierPoint.age} ans)` : 'Fin d’horizon'}
                </span>
                <span className="w-2 h-2 rounded-full gf-alloc-nonreg shrink-0" aria-hidden="true" />
            </div>
            <div className="font-mono text-base sm:text-lg font-bold text-ink-50 tabular-nums">
                {patrimoineKpiValue ? (
                    <PrivateAmount>{patrimoineKpiValue}</PrivateAmount>
                ) : lastProjectionPresent && dernierPoint && Number.isFinite(dernierPoint.NetWorth) ? (
                    <PrivateAmount>{formatCompactCAD(dernierPoint.NetWorth)}</PrivateAmount>
                ) : (
                    <>
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">
                            {projectionStatus === 'computing' ? 'Calcul en cours' : 'Simulation requise'}
                        </span>
                    </>
                )}
            </div>
            <div className="text-xs text-ink-400">Capital final simulé</div>
        </button>
    </div>
);
