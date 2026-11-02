import { useEffect, useRef, useState } from 'react';
import { animate, useMotionValue } from 'framer-motion';

/**
 * Interpole de manière fluide via `framer-motion` (`useMotionValue` + `animate`) un montant numérique
 * lorsqu'il change, tout en rendant immédiatement la valeur cible au premier affichage.
 */
export function useAnimatedNumber(target: number | null, durationMs = 240): number | null {
    const [displayValue, setDisplayValue] = useState<number | null>(target);
    const currentRef = useRef<number | null>(target);
    const motionVal = useMotionValue(target !== null && Number.isFinite(target) ? target : 0);

    useEffect(() => {
        if (target === null || !Number.isFinite(target)) {
            currentRef.current = null;
            setDisplayValue(null);
            return;
        }

        const isTestEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
        const prefersReducedMotion =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (
            isTestEnv ||
            prefersReducedMotion ||
            typeof window === 'undefined' ||
            currentRef.current === null ||
            Math.abs(target - currentRef.current) < 1
        ) {
            currentRef.current = target;
            motionVal.set(target);
            setDisplayValue(target);
            return;
        }

        motionVal.set(currentRef.current);

        const controls = animate(motionVal, target, {
            duration: Math.max(0.1, durationMs / 1000),
            ease: [0.16, 1, 0.3, 1],
            onUpdate: (latest) => {
                currentRef.current = latest;
                setDisplayValue(latest);
            },
            onComplete: () => {
                currentRef.current = target;
                setDisplayValue(target);
            },
        });

        return () => {
            controls.stop();
        };
    }, [target, durationMs, motionVal]);

    return displayValue;
}

