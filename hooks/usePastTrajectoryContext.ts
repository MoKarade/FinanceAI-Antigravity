// hooks/usePastTrajectoryContext.ts
// Version allégée des dérivations passé/présent destinée à `AccueilGoogle` :
// expose uniquement `{ pastHistory, calculatedStartingCash, startYear, startMonth,
// todayMonthIndex, pastCurveCalibration }` SANS importer `buildSimulationParams` ni
// `valoriaFutureEngine` (coupe 450+ Ko de JS du chargement initial d'Accueil).

import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { computeCashLedgerDetailed } from '../services/startingCash';
import { useFinanceStore } from '../store/useFinanceStore';
import {
    computePastCurveCalibration,
    toSimulationPastCurveCalibration,
    type SimulationPastCurveCalibration,
} from '../services/projection/pastCurveCalibration';
import type { Transaction } from '../types';
import { usePastPortfolioHistory } from './usePastPortfolioHistory';
import { useMonthEpoch, useTodayIsoLocal } from './useTodayIsoLocal';

const EMPTY_ARRAY: never[] = [];

export interface PastTrajectoryContext {
    pastHistory: ReturnType<typeof usePastPortfolioHistory>;
    calculatedStartingCash: number;
    startYear: number;
    startMonth: number;
    todayMonthIndex: number;
    pastCurveCalibration?: SimulationPastCurveCalibration;
}

/**
 * Assemble uniquement le contexte historique et présent dont l'écran Accueil a besoin,
 * avec exactement la même horloge partagée (`useMonthEpoch` / `useTodayIsoLocal`) et
 * la même calibration passée que `useSimulationParams`.
 */
export function usePastTrajectoryContext(): PastTrajectoryContext {
    const {
        assets,
        fxRates,
        transactions,
        debts,
        realEstateGoals,
        initialBalances,
        priorReturnRate,
    } = useFinanceStore(useShallow((st) => ({
        assets: st.assets ?? EMPTY_ARRAY,
        fxRates: st.fxRates,
        transactions: st.transactions ?? EMPTY_ARRAY,
        debts: st.debts ?? EMPTY_ARRAY,
        realEstateGoals: st.realEstateGoals ?? EMPTY_ARRAY,
        initialBalances: st.initialBalances,
        priorReturnRate: st.projection?.returnRate,
    })));

    const pastHistory = usePastPortfolioHistory();

    const ledgerCash = useMemo(
        () => computeCashLedgerDetailed(initialBalances, transactions as Transaction[]),
        [initialBalances, transactions],
    );
    const calculatedStartingCash = ledgerCash.cash;

    const monthEpoch = useMonthEpoch();
    const { startYear, startMonth } = useMemo(
        () => ({ startYear: Math.floor(monthEpoch / 12), startMonth: monthEpoch % 12 }),
        [monthEpoch],
    );

    const todayIso = useTodayIsoLocal();

    const todayMonthIndex = useMemo(() => {
        const now = new Date();
        return Math.max(0, (now.getFullYear() - startYear) * 12 + (now.getMonth() - startMonth));
    }, [startYear, startMonth]);

    const pastCurveCalibration = useMemo(
        () =>
            toSimulationPastCurveCalibration(
                computePastCurveCalibration({
                    assets,
                    fxRates: fxRates ?? {},
                    transactions: transactions as Transaction[],
                    debts,
                    realEstateGoals,
                    calculatedStartingCash,
                    priorReturnPct:
                        typeof priorReturnRate === 'number' && Number.isFinite(priorReturnRate)
                            ? priorReturnRate
                            : 6.5,
                    referenceDateIso: todayIso,
                }),
            ),
        [
            assets,
            fxRates,
            transactions,
            debts,
            realEstateGoals,
            calculatedStartingCash,
            priorReturnRate,
            todayIso,
        ],
    );

    return {
        pastHistory,
        calculatedStartingCash,
        startYear,
        startMonth,
        todayMonthIndex,
        ...(pastCurveCalibration ? { pastCurveCalibration } : {}),
    };
}
