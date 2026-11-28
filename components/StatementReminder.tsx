/**
 * [UX-STATEMENT-REMINDER] Rappel proactif et dismissable : aucune transaction pour le mois courant →
 * le relevé de compte n'est probablement pas encore importé. Le rituel d'import mensuel n'avait aucun
 * filet (la fuite de données de persona est restée invisible des semaines faute de ce signal).
 *
 * Affiché si : transactions réelles en retard d'≥ 1 mois (dernier mois importé < mois courant), on est
 * passé le 5 du mois, et le mode test est inactif.
 *
 * Dismiss keyé par MOIS COURANT : ignorer silence le rappel pour ce mois-ci seulement ; il réapparaît
 * le mois suivant s'il est toujours pertinent (toujours pas d'import).
 */

import React, { useMemo, useState } from 'react';
import { computeStatementReminderStatus } from '../services/statementReminder';
import { useFinanceStore } from '../store/useFinanceStore';
import { useTodayIsoLocal } from '../hooks/useTodayIsoLocal';
import { maybeRunDailyFintableSync } from '../services/fintable/autoSync';
import { showToast } from './ui/Toast';
import { formatMonthYear } from '../utils/format';
import { Tab } from '../types';

const DISMISS_KEY = 'statementReminderDismissedMonth' as const;

const dismissedMonth = (): string | null => {
    try {
        return localStorage.getItem(DISMISS_KEY);
    } catch {
        return null;
    }
};

const saveDismiss = (month: string): void => {
    try {
        localStorage.setItem(DISMISS_KEY, month);
    } catch {
        // Pas critique.
    }
};

const monthLabel = (monthKey: string): string => {
    const [y, m] = monthKey.split('-').map(Number);
    if (!y || !m) return monthKey;
    return formatMonthYear(new Date(y, m - 1, 1));
};

export const StatementReminder: React.FC = () => {
    const transactions = useFinanceStore(s => s.transactions);
    const setActiveTab = useFinanceStore(s => s.setActiveTab);
    const fintableToken = useFinanceStore(s => s.apiKeys?.fintable ?? '');
    const todayIso = useTodayIsoLocal();
    const [dismissedFor, setDismissedFor] = useState<string | null>(() => dismissedMonth());
    const [isSyncing, setIsSyncing] = useState(false);

    const refDate = useMemo(() => {
        const [y, m, d] = todayIso.split('-').map(Number);
        return y && m && d ? new Date(y, m - 1, d) : new Date();
    }, [todayIso]);

    const status = computeStatementReminderStatus(transactions, refDate);
    if (!status.shouldShow) return null;
    if (!status.lastTxMonth) return null; // invariant : shouldShow ⇒ lastTxMonth non-null ; garde sans cast
    if (dismissedFor === status.currentMonth) return null;

    const handleDismiss = () => {
        saveDismiss(status.currentMonth);
        setDismissedFor(status.currentMonth);
    };

    const handleImport = () => {
        setActiveTab(Tab.TRANSACTIONS); // l'import de relevé vit dans l'onglet Transactions
        handleDismiss();
    };

    const handleSyncNow = async () => {
        if (isSyncing) return;
        setIsSyncing(true);
        try {
            const outcome = await maybeRunDailyFintableSync({
                maxAgeMs: 0,
                ignoreCooldown: true,
                autoCreditCards: true,
            });
            if (!outcome.ran) {
                showToast('Synchronisation déjà en cours ou indisponible.', 'info');
                return;
            }
            if (outcome.report.error) {
                showToast(`Sync impossible : ${outcome.report.error}`, 'error');
            } else if (outcome.report.transactionsAdded > 0) {
                showToast(`${outcome.report.transactionsAdded} transaction(s) synchronisée(s).`, 'success');
            } else {
                showToast('Banque déjà à jour.', 'info');
            }
        } finally {
            setIsSyncing(false);
        }
    };

    const behindLabel = status.monthsBehind >= 2
        // NOMBRE-NON-MONETAIRE : retard de relevé en mois (fraîcheur d'une donnée), aucun montant
        ? `depuis ${monthLabel(status.lastTxMonth)} (${status.monthsBehind} mois)`
        : `pour ${monthLabel(status.currentMonth)}`;

    return (
        <div
            role="status"
            aria-label="Rappel import de relevé"
            className="mb-2.5 sm:mb-4 flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 rounded-xl border border-warning-500/30 bg-amber-900/15 px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-body text-amber-200"
        >
            <span className="shrink-0 text-sm sm:text-base" aria-hidden="true">i</span>
            <p className="flex-1 min-w-0 leading-snug line-clamp-1 sm:line-clamp-none">
                Aucune transaction {behindLabel} — ton relevé de compte n&apos;a probablement pas encore été
                importé. Importe-le pour garder ton budget et tes revenus à jour.
            </p>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                {fintableToken && (
                    <button
                        type="button"
                        onClick={() => { void handleSyncNow(); }}
                        disabled={isSyncing}
                        className="touch-target min-h-11 rounded-lg border border-bordure-champ bg-surface-douce px-2.5 py-1 text-meta font-bold text-ink-50 transition-colors hover:bg-fond disabled:opacity-60 focus-ring shrink-0"
                    >
                        {isSyncing ? 'Sync…' : 'Synchroniser la banque'}
                    </button>
                )}
                <button
                    type="button"
                    onClick={handleImport}
                    // [A11Y 1.4.11] fond SOLIDE (bg-amber-700 = 3,97:1 vs page, prominence ok) + survol par
                    // luminosité — `bg-amber-700/60` ne ressortait qu'à ~2:1 du fond (bouton invisible).
                    className="touch-target min-h-11 rounded-lg bg-amber-700 px-2.5 py-1 text-meta font-bold text-white transition-[filter] hover:brightness-110 focus-ring shrink-0"
                >
                    Importer mon relevé
                </button>
                <button
                    type="button"
                    onClick={handleDismiss}
                    aria-label="Plus tard — ignorer ce rappel ce mois-ci"
                    className="touch-target min-h-11 rounded-lg px-2 py-1 text-meta text-ink-300 transition-colors hover:text-white focus-ring shrink-0"
                >
                    Plus tard
                </button>
            </div>
        </div>
    );
};

// Valeur exportée pour les tests.
