// tests/helpers/panneauJour.tsx
// Monte `<FutureRichTooltip>` avec des props par défaut inoffensives pour les tests unitaires
// hérités du panneau du jour (section par défaut sélectionnable via `defaultSection`).
import React from 'react';
import { render } from '@testing-library/react';
import { FutureRichTooltip } from '../../components/future/FutureRichTooltip';
import type { PointJour } from '../../components/projection/panneauJour/sections';
import type { OrigineJour } from '../../components/future/jourAffiche';
import type { PasNavigation } from '../../components/future/panneauPas';
import type { SectionPanneauId } from '../../components/future/panneauSections';

export interface OptionsPanneauJour {
    origine?: OrigineJour;
    isOpen?: boolean;
    scenarioLabel?: string;
    defaultSection?: SectionPanneauId;
    userName1?: string;
    userName2?: string;
    onOpenDetail?: () => void;
    onStep?: (dir: -1 | 1, pas: PasNavigation) => void;
    pas?: PasNavigation;
    onPasChange?: (pas: PasNavigation) => void;
    canStepPrev?: boolean;
    canStepNext?: boolean;
    onRelease?: () => void;
}

export function renderPanneauJour(data: PointJour | null, o: OptionsPanneauJour = {}) {
    const origine = o.origine ?? 'epingle';
    return render(
        <FutureRichTooltip
            point={data}
            isOpen={o.isOpen ?? true}
            isPinned={origine !== 'survol'}
            origine={origine}
            anchorXRatio={0.2}
            scenarioLabel={o.scenarioLabel ?? 'Trajectoire réelle'}
            defaultSection={o.defaultSection}
            userName1={o.userName1}
            userName2={o.userName2}
            onOpenDetail={o.onOpenDetail ?? (() => {})}
            onStep={o.onStep ?? (() => {})}
            pas={o.pas ?? 'jour'}
            onPasChange={o.onPasChange ?? (() => {})}
            canStepPrev={o.canStepPrev ?? true}
            canStepNext={o.canStepNext ?? true}
            onUnpin={o.onRelease ?? (() => {})}
        />,
    );
}
