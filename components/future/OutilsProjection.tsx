import React from 'react';

export type FutureDrawerId = 'hypotheses' | 'plan' | 'historique';

/** Source unique de l'`id` DOM du tiroir associé — consommée ICI (`aria-controls` des boutons) ET
 *  dans `FutureProjection.tsx` (`<Drawer id=…>`), pour que les deux ne divergent jamais. */
export function tiroirDomId(id: FutureDrawerId): string {
    return `future-drawer-${id}`;
}

const TIROIRS: ReadonlyArray<{ id: FutureDrawerId; icone: string; label: string; detail: string }> = [
    { id: 'hypotheses', icone: '⚙️', label: 'Modifier les hypothèses', detail: 'Rendements, inflation, Monte-Carlo, projets immobiliers' },
    { id: 'plan', icone: '🎯', label: "Plan d'action", detail: 'Ce que la courbe te demande de faire, mois par mois' },
    { id: 'historique', icone: '📊', label: 'Historique', detail: 'Évolution passée du patrimoine, compte par compte' },
];

export const OutilsProjection: React.FC<{
    tiroirOuvert: FutureDrawerId | null;
    onOuvrir: (id: FutureDrawerId) => void;
}> = ({ tiroirOuvert, onOuvrir }) => (
    <section aria-labelledby="outils-projection-titre" className="rounded-2xl bg-surface border border-white/6 p-3.5">
        <h2 id="outils-projection-titre" className="sr-only">Outils</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 gf-spring-grid">
            {TIROIRS.map((t) => (
                <li key={t.id}>
                    <button
                        type="button"
                        onClick={() => onOuvrir(t.id)}
                        aria-haspopup="dialog"
                        aria-expanded={tiroirOuvert === t.id}
                        aria-controls={tiroirDomId(t.id)}
                        aria-describedby={`${tiroirDomId(t.id)}-detail`}
                        className="w-full min-h-[52px] px-3 py-2.5 flex items-center justify-between gap-2 text-left rounded-xl bg-surfaceHighlight/30 hover:bg-surfaceHighlight/60 border border-bordure hover:border-primary/50 gf-card-interactive focus-ring group cursor-pointer"
                    >
                        <span className="flex items-center gap-2 min-w-0">
                            <span aria-hidden="true" className="text-base shrink-0">{t.icone}</span>
                            <span className="text-xs font-semibold text-ink-100 group-hover:text-ink-50 truncate">{t.label}</span>
                            <span id={`${tiroirDomId(t.id)}-detail`} aria-hidden="true" className="sr-only">{t.detail}</span>
                        </span>
                        <span aria-hidden="true" className="text-primary font-bold shrink-0">›</span>
                    </button>
                </li>
            ))}
        </ul>
    </section>
);
