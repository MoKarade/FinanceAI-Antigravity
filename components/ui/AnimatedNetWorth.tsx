import React, { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
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
    /** Élément conteneur rendu par Framer Motion (`div` par défaut, `span` pour un flux en ligne). */
    as?: 'div' | 'span';
    /** Classes utilitaires appliquées au conteneur du montant. */
    className?: string;
    /** Durée de l'interpolation du compteur numérique en millisecondes. */
    durationMs?: number;
    /** Identifiant de test pour cibler le compteur animé. */
    testId?: string;
}

/**
 * Compteur numérique fluide propulsé par `framer-motion` (`useMotionValue` + `animate` + `motion`).
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
    const motionValue = useMotionValue(isFiniteTarget ? value : 0);
    const [displayValue, setDisplayValue] = useState<number>(isFiniteTarget ? value : 0);
    const [isAnimating, setIsAnimating] = useState(false);
    const previousValueRef = useRef<number | null>(isFiniteTarget ? value : null);

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

        if (prev === null || prefersReducedMotion || Math.abs(value - prev) < 0.5) {
            motionValue.set(value);
            setDisplayValue(value);
            setIsAnimating(false);
            return;
        }

        motionValue.set(prev);
        setIsAnimating(true);

        const controls = animate(motionValue, value, {
            duration: Math.max(0.12, durationMs / 1000),
            ease: [0.16, 1, 0.3, 1],
            onUpdate: (latest) => {
                setDisplayValue(latest);
            },
            onComplete: () => {
                setDisplayValue(value);
                setIsAnimating(false);
            },
        });

        return () => {
            controls.stop();
        };
    }, [value, durationMs, motionValue]);

    if (!isFiniteTarget) {
        const FallbackTag = as;
        return (
            <FallbackTag className={className} data-testid={testId}>
                <span aria-hidden="true">—</span>
                <span className="sr-only">{NO_DATA_LABEL}</span>
            </FallbackTag>
        );
    }

    const MotionTag = as === 'span' ? motion.span : motion.div;
    const prefix = signed && displayValue > 0 ? '+' : '';

    return (
        <MotionTag
            data-testid={testId}
            data-target-value={Math.round(value)}
            data-current-value={Math.round(displayValue)}
            data-animating={isAnimating ? 'true' : 'false'}
            initial={false}
            animate={isAnimating ? { scale: [1, 1.018, 1] } : { scale: 1 }}
            transition={{ duration: 0.36, ease: 'easeOut' }}
            className="inline-block origin-left"
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
        </MotionTag>
    );
};
