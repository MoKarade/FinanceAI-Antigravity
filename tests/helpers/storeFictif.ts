// tests/helpers/storeFictif.tsx
//
// Rendu d'un composant BRANCHÉ sur le store Zustand (`useFinanceStore`), à partir d'un état connu.
// Remplace le motif recopié dans les tests de composants :
//   const initialState = useFinanceStore.getState();
//   beforeEach(() => useFinanceStore.setState(initialState, true));
//
// ⚠️ L'état de référence est capturé au PREMIER import de ce module, donc avant que le moindre test
// ne touche au store — exactement ce que faisait la capture en tête de fichier.
//
// Usage :
//   beforeEach(() => reinitialiserStore());
//   renduAvecStore(<MonComposant />, { config: { ...etatInitialStore().config, ... } });
import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { useFinanceStore } from '../../store/useFinanceStore';

type EtatStore = ReturnType<typeof useFinanceStore.getState>;

const ETAT_INITIAL: EtatStore = useFinanceStore.getState();

/** L'état du store tel qu'il était avant le premier test du fichier. */
export function etatInitialStore(): EtatStore {
    return ETAT_INITIAL;
}

/** Remet le store EXACTEMENT dans son état initial (remplacement complet, pas une fusion). */
export function reinitialiserStore(): void {
    useFinanceStore.setState(ETAT_INITIAL, true);
}

/** Applique `surcharges` au store (fusion), puis rend `ui`. Ne réinitialise pas : voir `reinitialiserStore`. */
export function renduAvecStore(ui: ReactElement, surcharges: Partial<EtatStore> = {}): RenderResult {
    useFinanceStore.setState(surcharges);
    return render(ui);
}
