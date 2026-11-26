// components/future/FutureRichTooltip.tsx
// Infobulle riche intégrée au conteneur `relative` du graphique Futur 4.0 :
//   - Au repos (`!isOpen` ou valeur nette non finie) : ne rend rien (`null`), la courbe reste libre.
//   - Au survol (`!isPinned`) : aperçu compact `pointer-events-none` positionné automatiquement à droite ou à gauche.
//   - Épinglée au clic/tactile (`isPinned`) : panneau interactif `pointer-events-auto` avec navigation Veille/Lendemain,
//     pas réglable, Détail complet, indice de point tournant, fourchette [P10, P90] et les 4 sections de `PANNEAU_SECTIONS`.
//   - Zéro `position: fixed`, zéro `createPortal`, zéro couleur en dur, confidentialité stricte via PrivateAmount/PrivateText.

import React, { useEffect, useId, useState } from 'react';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { PrivateText } from '../ui/PrivateText';
import { SubTabs, TabPanel } from '../ui/SubTabs';
import { formatCompactCAD, formatIsoDay } from '../../utils/format';
import {
    SectionComptes,
    SectionFlux,
    SectionMouvements,
    SectionValeurNette,
    type PointJour,
} from '../projection/panneauJour/sections';
import { PANNEAU_SECTIONS, PANNEAU_SECTION_IDS, type SectionPanneauId } from './panneauSections';
import { PAS_NAVIGATION, PAS_PAR_DEFAUT, type PasNavigation } from './panneauPas';

export interface FutureRichTooltipProps {
    point: PointJour | null;
    isOpen: boolean;
    isPinned: boolean;
    origine: 'ancre' | 'survol' | 'epingle';
    anchorXRatio: number | null;
    scenarioLabel: string;
    turningPointHint?: string | null;
    userName1?: string;
    userName2?: string;
    onOpenDetail: () => void;
    onStep?: (dir: -1 | 1, pas: PasNavigation) => void;
    pas?: PasNavigation;
    onPasChange?: (pas: PasNavigation) => void;
    canStepPrev?: boolean;
    canStepNext?: boolean;
    onUnpin: () => void;
    defaultSection?: SectionPanneauId;
    tooltipRef?: React.RefObject<HTMLDivElement | null>;
}

const RENDU_SECTION: Record<
    SectionPanneauId,
    (p: { data: PointJour; userName1?: string; userName2?: string }) => React.ReactNode
> = {
    valeur: ({ data }) => <SectionValeurNette data={data} />,
    flux: ({ data, userName1, userName2 }) => (
        <SectionFlux data={data} userName1={userName1} userName2={userName2} />
    ),
    comptes: ({ data }) => <SectionComptes data={data} />,
    mouvements: ({ data }) => <SectionMouvements data={data} />,
};

export const FutureRichTooltip: React.FC<FutureRichTooltipProps> = ({
    point,
    isOpen,
    isPinned,
    origine,
    anchorXRatio,
    scenarioLabel,
    turningPointHint,
    userName1,
    userName2,
    onOpenDetail,
    onStep,
    pas,
    onPasChange,
    canStepPrev,
    canStepNext,
    onUnpin,
    defaultSection,
    tooltipRef,
}) => {
    const reactId = useId();
    const idPrefix = `future-rich-tooltip-${reactId}`;
    const [activeSection, setActiveSection] = useState<SectionPanneauId>(
        defaultSection ?? PANNEAU_SECTION_IDS[0],
    );

    useEffect(() => {
        if (defaultSection) {
            setActiveSection(defaultSection);
        }
    }, [defaultSection]);

    if (!isOpen || !point || !Number.isFinite(point.NetWorth)) {
        return null;
    }

    const activePas = pas ?? PAS_PAR_DEFAUT;
    const aidePas = PAS_NAVIGATION.find((p) => p.id === activePas) ?? PAS_NAVIGATION[0];
    const sideClass =
        anchorXRatio !== null && anchorXRatio > 0.55
            ? 'sm:left-3 sm:right-auto'
            : 'sm:right-3 sm:left-auto';

    const dateText = point.dateLabel || (point.dayIso ? formatIsoDay(point.dayIso) : '—');
    const ageFinite = typeof point.age === 'number' && Number.isFinite(point.age);
    const hasRange =
        typeof point.P10 === 'number'
        && Number.isFinite(point.P10)
        && typeof point.P90 === 'number'
        && Number.isFinite(point.P90);
    const hasCoreRange =
        typeof point.P25 === 'number'
        && Number.isFinite(point.P25)
        && typeof point.P75 === 'number'
        && Number.isFinite(point.P75);

    const rangeBlock = hasRange ? (
        <div className="rounded-xl bg-surface-douce border border-bordure px-2.5 py-2 space-y-1 text-tiny">
            <div className="flex items-center justify-between gap-2">
                <span className="text-texte-doux font-semibold">Fourchette possible (prudent – favorable)</span>
                <PrivateAmount className="font-mono font-bold text-texte">
                    {formatCompactCAD(point.P10)} – {formatCompactCAD(point.P90)}
                </PrivateAmount>
            </div>
            {hasCoreRange && (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-texte-doux">Zone la plus probable (1 chance sur 2)</span>
                    <PrivateAmount className="font-mono font-semibold text-repere">
                        {formatCompactCAD(point.P25)} – {formatCompactCAD(point.P75)}
                    </PrivateAmount>
                </div>
            )}
        </div>
    ) : null;

    if (!isPinned) {
        return (
            <div
                data-testid="future-rich-tooltip"
                data-pinned="false"
                data-origine={origine}
                className={`pointer-events-none absolute top-3 left-3 ${sideClass} z-20 w-[min(390px,calc(100%-1.5rem))] max-h-[calc(100%-1.5rem)] overflow-y-auto rounded-card border border-bordure-champ bg-surface p-3 shadow-lg space-y-2.5`}
            >
                <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-body font-extrabold text-texte tracking-tight">
                            {dateText}
                        </span>
                        <span className="text-tiny font-bold text-repere bg-repere-doux border border-repere/30 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Âge <PrivateAmount>{ageFinite ? Math.round(point.age as number) : '—'}</PrivateAmount>
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="inline-flex items-center rounded-full border border-bordure-champ bg-surface-douce px-2 py-0.5 text-tiny font-bold text-texte-doux">
                            Aperçu
                        </span>
                        <span className="inline-flex items-center rounded-full border border-bordure-champ bg-surface-douce px-2 py-0.5 text-tiny font-semibold text-texte-doux truncate max-w-full">
                            {scenarioLabel}
                        </span>
                    </div>
                </div>

                <SectionValeurNette data={point} />

                {rangeBlock}

                <div className="border-t border-bordure pt-2">
                    <SectionFlux data={point} userName1={userName1} userName2={userName2} />
                </div>

                <p className="text-tiny text-texte-doux border-t border-bordure pt-2 m-0">
                    Cliquer pour épingler ce jour
                </p>
            </div>
        );
    }

    return (
        <div
            ref={tooltipRef}
            tabIndex={-1}
            role="region"
            aria-label="Détail du jour épinglé sur le graphique"
            data-testid="future-rich-tooltip"
            data-pinned="true"
            data-origine={origine}
            onKeyDown={(e) => {
                if (e.key === 'Escape') {
                    e.stopPropagation();
                    onUnpin();
                }
            }}
            className={`pointer-events-auto focus-ring relative mt-2 w-full sm:mt-0 sm:absolute sm:top-3 ${sideClass} z-20 sm:w-[min(460px,calc(100%-1.5rem))] sm:max-h-[calc(100%-1.5rem)] flex flex-col overflow-hidden rounded-card border border-accent/60 bg-surface shadow-xl`}
        >
            <div data-tooltip-actions="" className="shrink-0 p-3.5 pb-2.5 border-b border-bordure space-y-2.5">
                <div className="flex items-start justify-between gap-2 min-w-0">
                    <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                            <span className="inline-flex items-center rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-tiny font-bold text-accent">
                                Jour épinglé
                            </span>
                            <span className="inline-flex items-center rounded-full border border-bordure-champ bg-surface-douce px-2 py-0.5 text-tiny font-semibold text-texte-doux truncate max-w-full">
                                {scenarioLabel}
                            </span>
                        </div>
                        <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-body font-extrabold text-texte tracking-tight">
                                {dateText}
                            </span>
                            <span className="text-tiny font-bold text-repere bg-repere-doux border border-repere/30 px-2 py-0.5 rounded-full whitespace-nowrap">
                                Âge <PrivateAmount>{ageFinite ? Math.round(point.age as number) : '—'}</PrivateAmount>
                            </span>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onUnpin}
                        aria-label="Fermer le détail épinglé"
                        className="touch-target min-h-11 min-w-11 focus-ring inline-flex items-center justify-center gap-1 rounded-lg border border-bordure-champ bg-surface-douce px-2.5 py-2 text-tiny font-bold text-texte hover:bg-bordure shrink-0 transition-colors"
                    >
                        <Icon name="close" size={15} />
                        <span>Fermer</span>
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {onStep && (
                        <>
                            <button
                                type="button"
                                onClick={() => onStep(-1, activePas)}
                                disabled={canStepPrev === false}
                                aria-label={`Veille — ${aidePas.aide}`}
                                title={aidePas.aide}
                                className="touch-target min-h-11 focus-ring inline-flex items-center justify-center rounded-lg border border-bordure-champ bg-surface-douce px-2.5 py-2 text-tiny font-bold text-texte hover:bg-bordure disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            >
                                ← Veille
                            </button>
                            <button
                                type="button"
                                onClick={() => onStep(1, activePas)}
                                disabled={canStepNext === false}
                                aria-label={`Lendemain — ${aidePas.aide}`}
                                title={aidePas.aide}
                                className="touch-target min-h-11 focus-ring inline-flex items-center justify-center rounded-lg border border-bordure-champ bg-surface-douce px-2.5 py-2 text-tiny font-bold text-texte hover:bg-bordure disabled:opacity-40 disabled:pointer-events-none transition-colors"
                            >
                                Lendemain →
                            </button>
                        </>
                    )}

                    {onPasChange && (
                        <div
                            role="group"
                            aria-label="Pas des flèches"
                            className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-fond border border-bordure"
                        >
                            {PAS_NAVIGATION.map((p) => (
                                <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => onPasChange(p.id)}
                                    aria-pressed={activePas === p.id}
                                    title={p.aide}
                                    className={`touch-target min-h-11 focus-ring inline-flex items-center justify-center px-2.5 py-1.5 text-tiny font-bold rounded-sm transition-colors ${
                                        activePas === p.id
                                            ? 'bg-accent text-sur-accent'
                                            : 'text-texte-doux hover:text-texte hover:bg-surface-douce'
                                    }`}
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={onOpenDetail}
                        className="touch-target min-h-11 focus-ring inline-flex items-center justify-center rounded-lg border border-accent/45 bg-accent/15 px-3 py-2 text-tiny font-bold text-accent hover:bg-accent/25 transition-colors"
                    >
                        Détail complet →
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 pt-2.5 space-y-3">
                {turningPointHint && turningPointHint.trim() !== '' && (
                    <div className="rounded-xl border border-repere/30 bg-repere-doux px-2.5 py-2 text-tiny text-texte break-words">
                        <span className="font-bold text-repere uppercase tracking-wider mr-1.5">
                            Point tournant :
                        </span>
                        <PrivateText quoi="memo">{turningPointHint}</PrivateText>
                    </div>
                )}

                {rangeBlock}

                <div className="space-y-2.5">
                    <SubTabs<SectionPanneauId>
                        idPrefix={idPrefix}
                        label="Sections du jour épinglé"
                        tabs={PANNEAU_SECTIONS.map((s) => ({
                            id: s.id,
                            label: s.label,
                            icon: s.icon,
                        }))}
                        active={activeSection}
                        onSelect={setActiveSection}
                    />

                    {PANNEAU_SECTIONS.map((s) => (
                        <TabPanel
                            key={s.id}
                            idPrefix={idPrefix}
                            tab={s.id}
                            when={activeSection === s.id}
                            className="focus-ring rounded-card"
                        >
                            {RENDU_SECTION[s.id]({ data: point, userName1, userName2 })}
                        </TabPanel>
                    ))}
                </div>
            </div>
        </div>
    );
};
