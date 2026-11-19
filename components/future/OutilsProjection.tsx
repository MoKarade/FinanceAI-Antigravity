export type FutureDrawerId = 'hypotheses' | 'plan' | 'historique';

/** Source unique de l'`id` DOM du tiroir associé — consommée dans `FutureProjection.tsx`
 *  (`aria-controls` des boutons ET `<Drawer id=…>`), pour que les deux ne divergent jamais. */
export function tiroirDomId(id: FutureDrawerId): string {
    return `future-drawer-${id}`;
}
