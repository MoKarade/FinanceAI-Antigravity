import React, { useEffect, useRef, useState } from 'react';
import { formatCAD, formatCompactCAD } from '../../utils/format';
import { PrivateAmount } from './PrivateAmount';
import { NO_DATA_LABEL } from './emptyAware';

export interface AnimatedNetWorthProps {
    /** Valeur numérique cible (ex. globalNetWorth ou patrimoineNet). */
    value: number;
    /** Format d'affichage monétaire : complet (formatCAD) ou compact (formatCompactCAD). */
    format?: 'full' | 'compact';
    /** Affiche un signe « + » explicite lorsque la valeur est strictement positive. */
    signed?: boolean;
    /** Élément conteneur rendu (`div` par défaut, `span` pour un flux en ligne). */
    as?: 'div' | 'span';
    /** Classes utilitaires appliquées au conteneur du montant. */
    className?: string;
    /** Durée de l'interpolation du compteur numérique en millisecondes. */
    durationMs?: number;
    /** Identifiant de test pour cibler le compteur animé. */
    testId?: string;
}

/**
 * Compteur numérique fluide sans dépendance lourde (`requestAnimationFrame` + CSS).
 * - Affiche immédiatement la valeur cible au premier rendu (aucun flash à 0 $ au montage).
 * - Lorsqu'une mise à jour de `value` survient (ex. `globalNetWorth`), interpole de façon fluide
 *   du montant précédent vers le nouveau montant tout en appliquant une subtile impulsion visuelle.
 * - Respecte intégralement le mode discret (`<PrivateAmount>`) et `prefers-reduced-motion`.
 */
export const AnimatedNetWorth: React.FC<AnimatedNetWorthProps> = ({
    value,
    format = 'full',
    signed = false,
    as = 'div',
    className = '',
    durationMs = 520,
    testId = 'animated-global-net-worth',
}) => {
    const isFiniteTarget = Number.isFinite(value);
    const [displayValue, setDisplayValue] = useState<number>(isFiniteTarget ? value : 0);
    const [isAnimating, setIsAnimating] = useState(false);
    const previousValueRef = useRef<number | null>(isFiniteTarget ? value : null);
    const displayValueRef = useRef<number>(isFiniteTarget ? value : 0);

    useEffect(() => {
        if (!Number.isFinite(value)) {
            previousValueRef.current = null;
            setIsAnimating(false);
            return;
        }

        const prev = previousValueRef.current;
        previousValueRef.current = value;

        const prefersReducedMotion =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (
            prev === null ||
            prefersReducedMotion ||
            typeof window === 'undefined' ||
            typeof window.requestAnimationFrame !== 'function' ||
            Math.abs(value - prev) < 0.5
        ) {
            displayValueRef.current = value;
            setDisplayValue(value);
            setIsAnimating(false);
            return;
        }

        const startVal = Number.isFinite(displayValueRef.current) ? displayValueRef.current : prev;
        const duration = Math.max(120, durationMs);
        const now = (): number =>
            typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now();
        const startTime = now();
        let rafId = 0;

        setIsAnimating(true);

        const step = (): void => {
            const elapsed = Math.max(0, now() - startTime);
            const t = Math.min(1, elapsed / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            const nextVal = startVal + (value - startVal) * eased;
            displayValueRef.current = nextVal;
            setDisplayValue(nextVal);
            if (t < 1) {
                rafId = window.requestAnimationFrame(step);
            } else {
                displayValueRef.current = value;
                setDisplayValue(value);
                setIsAnimating(false);
            }
        };

        rafId = window.requestAnimationFrame(step);

        return () => {
            window.cancelAnimationFrame(rafId);
        };
    }, [value, durationMs]);

    if (!isFiniteTarget) {
        const FallbackTag = as;
        return (
            <FallbackTag className={className} data-testid={testId}>
                <span aria-hidden="true">—</span>
                <span className="sr-only">{NO_DATA_LABEL}</span>
            </FallbackTag>
        );
    }

    const Tag = as;
    const prefix = signed && displayValue > 0 ? '+' : '';

    return (
        <Tag
            data-testid={testId}
            data-target-value={Math.round(value)}
            data-current-value={Math.round(displayValue)}
            data-animating={isAnimating ? 'true' : 'false'}
            className={`inline-block origin-left transition-transform duration-300 ease-out ${
                isAnimating ? 'scale-[1.018]' : 'scale-100'
            }`}
        >
            {format === 'compact' ? (
                <PrivateAmount as={as} className={className}>
                    {`${prefix}${formatCompactCAD(displayValue)}`}
                </PrivateAmount>
            ) : (
                <PrivateAmount as={as} className={className}>
                    {`${prefix}${formatCAD(displayValue)}`}
                </PrivateAmount>
            )}
        </Tag>
    );
};
