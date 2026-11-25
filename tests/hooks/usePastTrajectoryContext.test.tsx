import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePastTrajectoryContext } from '../../hooks/usePastTrajectoryContext';

describe('usePastTrajectoryContext', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('retourne le contexte passe/present avec startYear/startMonth alignes sur l horloge locale', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 10, 25, 12, 0, 0));

        const { result } = renderHook(() => usePastTrajectoryContext());

        expect(result.current.startYear).toBe(2026);
        expect(result.current.startMonth).toBe(10);
        expect(result.current.todayMonthIndex).toBe(0);
        expect(Number.isFinite(result.current.calculatedStartingCash)).toBe(true);
        expect(Array.isArray(result.current.pastHistory.points)).toBe(true);
    });
});
