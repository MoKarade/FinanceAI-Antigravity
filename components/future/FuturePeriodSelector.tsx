// components/future/FuturePeriodSelector.tsx
//
// Contrôle de zoom fluide de style Google Finance : remplace l'ancienne barre de 6 boutons d'horizons
// rigides par une indication sobre du zoom continu (molette / pincer / glisser), un raccourci
// « Aujourd'hui » et une pastille « Réinitialiser le zoom » dès que la fenêtre est zoomée.

import React from 'react';
import type { TimeChartZoom } from '../../hooks/useTimeChartZoom';
import type { ProjectionChartPoint } from '../../services/projection/types';

interface Props {
    variant: 'buttons' | 'compact';
    zoom: TimeChartZoom<ProjectionChartPoint>;
    todayPresetRange: [number, number] | null;
    idxForYears: (years: number) => number;
    lastMonthIndex: number;
    onFullscreen: () => void;
}

export const FuturePeriodSelector: React.FC<Props> = ({
    variant,
    zoom,
    todayPresetRange,
    idxForYears,
    lastMonthIndex,
    onFullscreen,
}) => {
    const isTodayRange = Boolean(
        todayPresetRange &&
            zoom.isZoomed &&
            zoom.range?.[0] === todayPresetRange[0] &&
            zoom.range?.[1] === todayPresetRange[1],
    );

    const horizons = [5, 10, 20].filter((y) => y * 12 < lastMonthIndex);

    if (variant === 'compact') {
        return (
            <div className="flex items-center gap-1.5 flex-wrap">
                <div className="gf-chart-toolbar">
                    {zoom.isZoomed && (
                        <>
                            <button
                                type="button"
                                onClick={() => zoom.panByRatio(-0.35)}
                                className="touch-target gf-chart-ctrl-btn focus-ring"
                                title="Déplacer la courbe vers la gauche"
                                aria-label="Déplacer la courbe vers la gauche"
                            >
                                ‹
                            </button>
                            <button
                                type="button"
                                onClick={() => zoom.panByRatio(0.35)}
                                className="touch-target gf-chart-ctrl-btn focus-ring"
                                title="Déplacer la courbe vers la droite"
                                aria-label="Déplacer la courbe vers la droite"
                            >
                                ›
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={zoom.zoomOut}
                        disabled={!zoom.isZoomed}
                        className="touch-target gf-chart-ctrl-btn focus-ring"
                        title="Dézoomer"
                        aria-label="Dézoomer"
                    >
                        −
                    </button>
                    <button
                        type="button"
                        onClick={zoom.zoomIn}
                        className="touch-target gf-chart-ctrl-btn focus-ring"
                        title="Zoomer"
                        aria-label="Zoomer"
                    >
                        +
                    </button>
                </div>
                {zoom.isZoomed && (
                    <button
                        type="button"
                        onClick={zoom.reset}
                        className="h-11 px-3 rounded-full text-xs font-semibold gf-delta-neutral focus-ring"
                        title="Réinitialiser le zoom et afficher toute la courbe Passé + Futur"
                    >
                        Tout voir
                    </button>
                )}
                {todayPresetRange && (
                    <button
                        type="button"
                        aria-pressed={isTodayRange}
                        onClick={() =>
                            isTodayRange
                                ? zoom.reset()
                                : zoom.showRange(todayPresetRange[0], todayPresetRange[1])
                        }
                        className={`h-11 px-3 rounded-full text-xs font-medium border transition-colors focus-ring ${
                            isTodayRange
                                ? 'gf-delta-amber'
                                : 'bg-surface border-bordure text-ink-200 hover:text-ink-50'
                        }`}
                        title="Centrer le zoom fluide autour d'aujourd'hui"
                    >
                        Aujourd’hui
                    </button>
                )}
                <button
                    type="button"
                    onClick={onFullscreen}
                    aria-label="Plein écran"
                    title="Plein écran (Échap pour quitter)"
                    className="h-11 w-11 rounded-lg bg-surface border border-bordure flex items-center justify-center text-ink-300 hover:text-ink-50 focus-ring shrink-0"
                >
                    <span aria-hidden="true">⛶</span>
                </button>
            </div>
        );
    }

    return (
        <div role="group" aria-label="Contrôles de zoom fluide" className="flex items-center gap-2 flex-wrap">
            <div className="gf-chart-toolbar">
                {horizons.map((y) => {
                    const targetEnd = idxForYears(y);
                    const actif = Boolean(zoom.isZoomed && zoom.range?.[0] === 0 && zoom.range?.[1] === targetEnd);
                    return (
                        <button
                            key={y}
                            type="button"
                            aria-pressed={actif}
                            onClick={() => (actif ? zoom.reset() : zoom.showRange(0, targetEnd))}
                            className={`touch-target gf-chart-ctrl-btn focus-ring ${actif ? 'gf-chart-ctrl-btn-active' : ''}`}
                            // NOMBRE-NON-MONETAIRE : DUREE-FIXE de bouton de zoom (5, 10, 20 ans)
                            title={`Zoomer sur ${y} ans`}
                        >
                            {y}A
                        </button>
                    );
                })}
                {zoom.isZoomed && (
                    <>
                        <button
                            type="button"
                            onClick={() => zoom.panByRatio(-0.35)}
                            className="touch-target gf-chart-ctrl-btn focus-ring"
                            title="Déplacer la fenêtre vers le passé (gauche)"
                            aria-label="Déplacer la fenêtre vers la gauche"
                        >
                            ‹
                        </button>
                        <button
                            type="button"
                            onClick={() => zoom.panByRatio(0.35)}
                            className="touch-target gf-chart-ctrl-btn focus-ring"
                            title="Déplacer la fenêtre vers le futur (droite)"
                            aria-label="Déplacer la fenêtre vers la droite"
                        >
                            ›
                        </button>
                    </>
                )}
                <button
                    type="button"
                    onClick={zoom.zoomOut}
                    disabled={!zoom.isZoomed}
                    className="touch-target gf-chart-ctrl-btn focus-ring"
                    title="Dézoomer la courbe"
                    aria-label="Dézoomer la courbe"
                >
                    −
                </button>
                <button
                    type="button"
                    onClick={zoom.zoomIn}
                    className="touch-target gf-chart-ctrl-btn focus-ring"
                    title="Zoomer sur la courbe"
                    aria-label="Zoomer sur la courbe"
                >
                    +
                </button>
            </div>
            {todayPresetRange && (
                <button
                    type="button"
                    aria-pressed={isTodayRange}
                    onClick={() =>
                        isTodayRange
                            ? zoom.reset()
                            : zoom.showRange(todayPresetRange[0], todayPresetRange[1])
                    }
                    className={`touch-target h-9 px-3 rounded-full text-xs font-semibold border transition-colors focus-ring ${
                        isTodayRange
                            ? 'gf-delta-amber'
                            : 'bg-surfaceHighlight border-bordure text-ink-200 hover:text-ink-50 hover:border-bordure-champ'
                    }`}
                    title="Centrer la fenêtre autour d'aujourd'hui (±1 an) ou revenir à la vue complète"
                >
                    Aujourd’hui
                </button>
            )}
            {zoom.isZoomed && (
                <button
                    type="button"
                    onClick={zoom.reset}
                    className="h-9 px-3 rounded-full text-xs font-semibold gf-delta-neutral hover:opacity-90 transition-opacity focus-ring"
                    title="Réinitialiser le zoom pour revoir toute la trajectoire Passé + Aujourd'hui + Futur"
                >
                    Réinitialiser le zoom
                </button>
            )}
        </div>
    );
};
