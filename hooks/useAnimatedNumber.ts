import { useEffect, useRef, useState } from 'react';

/**
 * Interpole de manière fluide via `requestAnimationFrame` un montant numérique
 * lorsqu'il change, tout en rendant immédiatement la valeur cible au premier affichage.
 */
export function useAnimatedNumber(target: number | null, durationMs = 240): number | null {
    const [displayValue, setDisplayValue] = useState<number | null>(target);
    const currentRef = useRef<number | null>(target);

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

        const startVal = currentRef.current;
        if (
            isTestEnv ||
            prefersReducedMotion ||
            typeof window === 'undefined' ||
            typeof window.requestAnimationFrame !== 'function' ||
            startVal === null ||
            Math.abs(target - startVal) < 1
        ) {
            currentRef.current = target;
            setDisplayValue(target);
            return;
        }

        const duration = Math.max(100, durationMs);
        const now = (): number =>
            typeof performance !== 'undefined' && typeof performance.now === 'function'
                ? performance.now()
                : Date.now();
        const startTime = now();
        let rafId = 0;

        const step = (): void => {
            const elapsed = Math.max(0, now() - startTime);
            const t = Math.min(1, elapsed / duration);
            const eased = 1 - Math.pow(1 - t, 3);
            const nextVal = startVal + (target - startVal) * eased;
            currentRef.current = nextVal;
            setDisplayValue(nextVal);
            if (t < 1) {
                rafId = window.requestAnimationFrame(step);
            } else {
                currentRef.current = target;
                setDisplayValue(target);
            }
        };

        rafId = window.requestAnimationFrame(step);
        return () => {
            window.cancelAnimationFrame(rafId);
        };
    }, [target, durationMs]);

    return displayValue;
}
