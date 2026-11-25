// hooks/useTodayIsoLocal.ts
// Horloge calendaire locale PARTAGÉE au niveau module (mois & jour YYYY-MM-DD),
// extraite de hooks/useSimulationParams.ts afin que App/Accueil et les autres écrans
// ne tirent pas buildSimulationParams ni valoriaFutureEngine dans le chunk d'entrée.

import { useSyncExternalStore } from 'react';
import { todayIsoLocal } from '../services/projection/dailyRefine';

const monthEpochOf = (): number => {
    const d = new Date();
    return d.getFullYear() * 12 + d.getMonth();
};

const _monthListeners = new Set<() => void>();
let _monthTimer: ReturnType<typeof setInterval> | null = null;
const _notifyMonth = (): void => {
    _monthListeners.forEach((l) => l());
};
const _onMonthVisibility = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        _notifyMonth();
    }
};

const _subscribeMonthEpoch = (cb: () => void): (() => void) => {
    _monthListeners.add(cb);
    if (_monthTimer === null && typeof window !== 'undefined') {
        _monthTimer = setInterval(_notifyMonth, 60 * 60 * 1000);
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', _onMonthVisibility);
        }
    }
    return () => {
        _monthListeners.delete(cb);
        if (_monthListeners.size === 0 && _monthTimer !== null) {
            clearInterval(_monthTimer);
            _monthTimer = null;
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', _onMonthVisibility);
            }
        }
    };
};

const _getMonthEpoch = (): number => monthEpochOf();
const _getTodayIso = (): string => todayIsoLocal();

/**
 * Retourne l'époque mensuelle locale courante (`year * 12 + month`), partagée au niveau module.
 */
export function useMonthEpoch(): number {
    return useSyncExternalStore(_subscribeMonthEpoch, _getMonthEpoch, _getMonthEpoch);
}

/**
 * Retourne la date calendaire locale courante (`YYYY-MM-DD`) de manière réactive.
 * Partage l'horloge module-level (tick horaire + retour d'onglet).
 */
export function useTodayIsoLocal(): string {
    return useSyncExternalStore(_subscribeMonthEpoch, _getTodayIso, _getTodayIso);
}
