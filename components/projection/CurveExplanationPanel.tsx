import React, { useId, useMemo } from 'react';
import type { GrandCalculResult, ProjectionChartPoint } from '../../services/projection/types';
import {
    buildCurveExplanations,
    explainPointAtMonth,
    type CurveExplanationBreakdown,
    type CurveInflectionExplanation,
    type ExplanationSegment,
} from '../../services/projection/curveExplainer';
import type { OrigineJour } from '../future/jourAffiche';
import { formatCAD, formatNumber, formatPercent } from '../../utils/format';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { PrivateAmount } from '../ui/PrivateAmount';
import { emptyAware } from '../ui/emptyAware';

export interface CurveExplanationPanelProps {
    chartData: ProjectionChartPoint[];
    grandCalculResult?: GrandCalculResult | null;
    selectedPoint?: ProjectionChartPoint | null;
    selectedOrigin?: OrigineJour;
    onSelectMonth?: (monthIndex: number) => void;
}

const CATEGORY_LABELS: Record<CurveInflectionExplanation['category'], string> = {
    accumulation: 'Accumulation',
    evenement: 'Événement',
    retraite: 'Retraite',
    pension: 'Rentes publiques',
    ferr: 'FERR',
    objectif: 'Objectif',
    epuisement: 'Épuisement',
    succession: 'Succession',
};

const ORIGIN_LABELS: Record<OrigineJour, string> = {
    ancre: "Aujourd'hui",
    survol: 'Aperçu',
    epingle: 'Épinglé',
};

function renderSegments(segments: ExplanationSegment[]): React.ReactNode {
    return segments.map((seg, idx) => {
        switch (seg.kind) {
            case 'text':
                return <React.Fragment key={idx}>{seg.text}</React.Fragment>;
            case 'cad':
                return (
                    <PrivateAmount key={idx} className="font-mono font-semibold text-texte tabular-nums">
                        {formatCAD(seg.value)}
                    </PrivateAmount>
                );
            case 'pct':
                return (
                    <PrivateAmount key={idx} className="font-mono font-semibold text-texte tabular-nums">
                        {formatPercent(seg.value, seg.decimals ?? 1)}
                    </PrivateAmount>
                );
            case 'age':
                return (
                    <PrivateAmount key={idx} className="font-mono font-semibold text-texte tabular-nums">
                        {seg.value !== null && Number.isFinite(seg.value) ? `${Math.round(seg.value)} ans` : '—'}
                    </PrivateAmount>
                );
            case 'number':
                return (
                    <PrivateAmount key={idx} className="font-mono font-semibold text-texte tabular-nums">
                        {formatNumber(seg.value)}
                    </PrivateAmount>
                );
        }
    });
}

const BreakdownRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-2 text-tiny">
        <span className="text-texte-doux">{label}</span>
        <span className="font-mono text-texte tabular-nums">{children}</span>
    </div>
);

const AGE_TOKEN_RE = /(\b\d{1,3}\s*ans\b)/gi;

function renderRationaleLine(line: string): React.ReactNode {
    const parts = line.split(AGE_TOKEN_RE);
    if (parts.length === 1) return line;
    return parts.map((part, idx) =>
        /^\d{1,3}\s*ans$/i.test(part) ? (
            <PrivateAmount key={idx}>{part}</PrivateAmount>
        ) : (
            <React.Fragment key={idx}>{part}</React.Fragment>
        ),
    );
}

const Level2Details: React.FC<{ level2: CurveExplanationBreakdown }> = ({ level2 }) => {
    const { accumulationFlows, decaissementFlows, fiscalDetails } = level2;
    return (
        <div className="space-y-3 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-bordure bg-fond p-3 space-y-1.5">
                    <div className="text-tiny font-semibold text-texte">Accumulation</div>
                    <BreakdownRow label="Revenus nets (emploi / entreprise)">
                        <PrivateAmount>{formatCAD(accumulationFlows.employmentAndBusinessNet)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Cotisations">
                        <PrivateAmount>{formatCAD(accumulationFlows.contributionsTotal)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Rendement des placements">
                        <PrivateAmount>{formatCAD(accumulationFlows.investmentGrowth)}</PrivateAmount>
                    </BreakdownRow>
                </div>

                <div className="rounded-lg border border-bordure bg-fond p-3 space-y-1.5">
                    <div className="text-tiny font-semibold text-texte">Décaissement</div>
                    <BreakdownRow label="Dépenses de vie">
                        <PrivateAmount>{formatCAD(decaissementFlows.livingExpenses)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Rentes et prestations brutes">
                        <PrivateAmount>{formatCAD(decaissementFlows.pensionsGross)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Retraits du portefeuille">
                        <PrivateAmount>{formatCAD(decaissementFlows.withdrawalsTotal)}</PrivateAmount>
                    </BreakdownRow>
                </div>

                <div className="rounded-lg border border-bordure bg-fond p-3 space-y-1.5">
                    <div className="text-tiny font-semibold text-texte">Fiscalité</div>
                    <BreakdownRow label="Impôt sur le revenu">
                        <PrivateAmount>{formatCAD(fiscalDetails.incomeTaxTotal)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Taux marginal">
                        <PrivateAmount>{formatPercent(fiscalDetails.marginalTaxRatePct, 1)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Taux effectif">
                        <PrivateAmount>{formatPercent(fiscalDetails.effectiveTaxRatePct, 1)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Récupération PSV">
                        <PrivateAmount>{formatCAD(fiscalDetails.oasClawback)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Taux minimum FERR">
                        <PrivateAmount>{formatPercent(fiscalDetails.rrifMinimumRatePct, 2)}</PrivateAmount>
                    </BreakdownRow>
                    <BreakdownRow label="Impôt latent / successoral">
                        <PrivateAmount>{formatCAD(fiscalDetails.latentTaxTotal)}</PrivateAmount>
                    </BreakdownRow>
                </div>
            </div>

            {fiscalDetails.rationaleFr.length > 0 && (
                <div className="rounded-lg border border-bordure bg-fond p-3 space-y-1">
                    <div className="text-tiny font-semibold text-texte-doux">Justifications fiscales (ARC / Revenu Québec)</div>
                    <ul className="list-disc pl-4 space-y-1 text-tiny text-texte-doux">
                        {fiscalDetails.rationaleFr.map((line, idx) => (
                            <li key={idx}>{renderRationaleLine(line)}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const ExplanationCard: React.FC<{
    exp: CurveInflectionExplanation;
    badge?: string;
    onSelectMonth?: (monthIndex: number) => void;
}> = ({ exp, badge, onSelectMonth }) => {
    const yearDisplay = Number.isFinite(exp.year) ? String(Math.round(exp.year)) : '—';
    const isSensitiveMilestone = exp.category === 'objectif' || exp.category === 'epuisement';
    const categoryLabel = CATEGORY_LABELS[exp.category] ?? exp.category;

    return (
        <article className="rounded-xl border border-bordure bg-surface-douce p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                    {badge && (
                        <span className="inline-flex items-center rounded-full border border-bordure-champ bg-repere-doux px-2.5 py-0.5 text-tiny font-medium text-repere">
                            {badge}
                        </span>
                    )}
                    <span className="inline-flex items-center rounded-full border border-bordure bg-fond px-2.5 py-0.5 text-tiny text-texte-doux">
                        {categoryLabel}
                    </span>
                    <span className="text-tiny font-mono text-texte-doux tabular-nums">
                        {isSensitiveMilestone ? (
                            <PrivateAmount>{yearDisplay}</PrivateAmount>
                        ) : (
                            emptyAware(yearDisplay)
                        )}{' '}
                        ·{' '}
                        <PrivateAmount>
                            {Number.isFinite(exp.age) ? `${Math.round(exp.age)} ans` : '—'}
                        </PrivateAmount>
                    </span>
                </div>

                {onSelectMonth && (
                    <button
                        type="button"
                        onClick={() => onSelectMonth(Math.trunc(exp.monthIndex))}
                        className="touch-target min-h-11 px-3 py-1.5 rounded-lg border border-bordure-champ bg-fond text-meta text-texte hover:bg-bordure transition-colors focus-ring shrink-0"
                    >
                        Voir sur la courbe
                    </button>
                )}
            </div>

            <div className="space-y-1.5">
                <h3 className="text-h3 text-texte">{exp.titleFr}</h3>
                <p className="text-body text-texte leading-relaxed">
                    {renderSegments(exp.level1Segments)}
                </p>
            </div>

            <CollapsibleSection
                title="Détail chiffré et justifications fiscales"
                defaultOpen={false}
                headingLevel={4}
                variant="quiet"
            >
                <Level2Details level2={exp.level2} />
            </CollapsibleSection>
        </article>
    );
};

export const CurveExplanationPanel: React.FC<CurveExplanationPanelProps> = ({
    chartData,
    grandCalculResult = null,
    selectedPoint = null,
    selectedOrigin = 'ancre',
    onSelectMonth,
}) => {
    const titleId = useId();

    const explanations = useMemo(
        () => buildCurveExplanations(chartData, grandCalculResult),
        [chartData, grandCalculResult],
    );

    const selectedMonthKey = useMemo(() => {
        if (!selectedPoint) return null;
        if (typeof selectedPoint.hostMonthIndex === 'number' && Number.isFinite(selectedPoint.hostMonthIndex)) {
            return Math.trunc(selectedPoint.hostMonthIndex);
        }
        if (typeof selectedPoint.monthIndex === 'number' && Number.isFinite(selectedPoint.monthIndex)) {
            return Math.trunc(selectedPoint.monthIndex);
        }
        return null;
    }, [selectedPoint]);

    const isPastPoint = Boolean(
        selectedPoint &&
            (selectedPoint.isPast === true ||
                selectedPoint.dayIsReal === true ||
                (typeof selectedPoint.monthIndex === 'number' && selectedPoint.monthIndex < 0) ||
                (selectedMonthKey !== null && selectedMonthKey < 0)),
    );

    const selectedExplanation = useMemo(() => {
        if (isPastPoint || selectedMonthKey === null) return null;
        return explainPointAtMonth(chartData, selectedMonthKey, grandCalculResult);
    }, [chartData, isPastPoint, selectedMonthKey, grandCalculResult]);

    return (
        <section
            aria-labelledby={titleId}
            className="rounded-2xl bg-surface border border-bordure px-3.5 py-4 sm:px-5 sm:py-5 space-y-4"
        >
            <div className="space-y-1">
                <h2 id={titleId} className="text-h2 text-texte">
                    Explications de la courbe — Pourquoi la courbe fait ça
                </h2>
                <p className="text-meta text-texte-doux">
                    Synthèse en langage clair des inflexions clés, avec détail chiffré et justifications fiscales dépliables.
                </p>
            </div>

            {isPastPoint && (
                <div
                    role="status"
                    className="rounded-xl border border-bordure bg-surface-douce px-3.5 py-2.5 text-meta text-texte-doux"
                >
                    Jour passé reconstruit — les explications portent sur la trajectoire future.
                </div>
            )}

            {selectedExplanation && (
                <div className="space-y-2">
                    <div className="text-tiny font-semibold uppercase tracking-wide text-texte-doux">
                        Point inspecté sur la courbe
                    </div>
                    <ExplanationCard
                        exp={selectedExplanation}
                        badge={ORIGIN_LABELS[selectedOrigin] ?? 'Sélection'}
                    />
                </div>
            )}

            {explanations.length === 0 ? (
                <div className="rounded-xl border border-bordure bg-surface-douce px-4 py-4 text-meta text-texte-doux">
                    Aucune inflexion future disponible pour le moment.
                </div>
            ) : (
                <ol className="space-y-3">
                    {explanations.map((exp) => (
                        <li key={exp.id}>
                            <ExplanationCard
                                exp={exp}
                                onSelectMonth={onSelectMonth}
                            />
                        </li>
                    ))}
                </ol>
            )}
        </section>
    );
};
