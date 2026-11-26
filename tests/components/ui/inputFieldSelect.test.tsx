// [DETTE-UI-PRIMITIVES] (lot 156) — les trois primitives de formulaire. La migration est une
// PRÉSERVATION visuelle : chaque variant reproduit l'ENSEMBLE de classes que l'écran migré
// peignait déjà (l'ordre des classes dans l'attribut est indifférent au CSS — on compare des
// ensembles, pas des chaînes).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';

const classes = (el: Element | null) => new Set((el?.className ?? '').split(/\s+/).filter(Boolean));

describe('[DETTE-UI-PRIMITIVES] Input', () => {
    it('variant compact + accent = exactement les classes historiques d\'AdvancedProjectionParams', () => {
        const { container } = render(<Input accent="warning" type="number" aria-label="x" />);
        expect(classes(container.querySelector('input'))).toEqual(new Set(
            'w-full bg-dark border border-warning-500/20 rounded-sm px-2 py-1 text-meta text-white' /* [S5-TAILWIND4] rounded → rounded-sm (même 0,25rem) */.split(' '),
        ));
    });

    it('variant large + extras = exactement les classes historiques d\'Onboarding', () => {
        const { container } = render(<Input variant="large" className="mt-1 font-mono" aria-label="x" />);
        expect(classes(container.querySelector('input'))).toEqual(new Set(
            'w-full bg-dark border border-white/10 rounded-card px-3 py-2 text-ink-50 text-body mt-1 font-mono focus-ring'.split(' '),
        ));
    });

    it('les props HTML traversent telles quelles (type, min, inputMode)', () => {
        const { container } = render(<Input type="number" min={18} inputMode="numeric" aria-label="x" />);
        const el = container.querySelector('input') as HTMLInputElement;
        expect(el.type).toBe('number');
        expect(el.min).toBe('18');
        expect(el.inputMode).toBe('numeric');
    });
});

describe('[DETTE-UI-PRIMITIVES] Select', () => {
    it('reproduit les classes historiques du select de ProjectionControls', () => {
        const { container } = render(<Select aria-label="x"><option value="a">A</option></Select>);
        expect(classes(container.querySelector('select'))).toEqual(new Set(
            'bg-dark border border-border rounded-sm px-2 py-1 text-meta text-ink-100' /* [S5-TAILWIND4] rounded → rounded-sm */.split(' '),
        ));
        expect(container.querySelectorAll('option')).toHaveLength(1);
    });
});
