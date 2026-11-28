// components/investments/CoursPerimesNotice.tsx
//
// [COURS-AU-TROMPEUR] Dit, avec sa DATE, quel titre a un cours périmé. Remplace l'ancien
// « Cours au <heure du dernier rafraîchissement> », qui laissait croire que tous les cours dataient
// du moment où on les avait demandés. Rien à afficher quand tous les cours connus sont récents.

import React from 'react';
import { formatIsoDay } from '../../utils/format';
import type { TitreAuCoursPerime } from '../../services/history/fraicheurCours';

interface Props {
    titres: TitreAuCoursPerime[];
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

export const CoursPerimesNotice: React.FC<Props> = ({ titres, onRefresh, isRefreshing = false }) => {
    if (titres.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
            <p role="status" className="text-tiny text-warning-400 min-w-0 flex-1">
                {titres.length === 1 ? 'Cours périmé' : 'Cours périmés'} :{' '}
                {titres.map((t, i) => (
                    <React.Fragment key={t.symbol}>
                        {i > 0 && ', '}
                        {t.symbol} (cours du {formatIsoDay(t.date)})
                    </React.Fragment>
                ))}
                . La variation sur 24 h n’est pas affichée pour ces titres.
            </p>
            {onRefresh && (
                <button
                    type="button"
                    onClick={onRefresh}
                    disabled={isRefreshing}
                    aria-busy={isRefreshing}
                    className="touch-target min-h-11 px-3 py-1.5 rounded-xl border border-warning-500/40 bg-surface-douce hover:bg-fond text-tiny font-semibold text-warning-400 disabled:opacity-50 focus-ring shrink-0"
                >
                    {isRefreshing ? 'Actualisation…' : 'Actualiser'}
                </button>
            )}
        </div>
    );
};
