// hooks/useInvestmentCommittee.ts
// Orchestration React du Comité Multi-Agents de placements :
// - restaure l'historique chiffré IndexedDB pour la portée active (real vs test:<persona>) ;
// - exécute les 5 agents avec progression en direct et annulation propre (AbortController) ;
// - bloque sans appel en mode discret ;
// - isole les analyses lors d'un changement de mode test / persona ou d'un démontage.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFinanceStore } from '../store/useFinanceStore';
import { cleGemini } from '../services/geminiAssistant';
import { MESSAGE_IA_MODE_DISCRET, messageErreurIa } from '../services/messageErreurIa';
import { runMultiAgentCommittee } from '../services/investments/multiAgentCommittee';
import {
    clearCommitteeHistory,
    deleteCommitteeAnalysis,
    loadCommitteeHistory,
    saveCommitteeAnalysis,
    type CommitteeStorageScope,
} from '../services/investments/committeeHistoryStore';
import type {
    CommitteeAnalysisReport,
    CommitteeProgressEvent,
    CommitteeAgentRunner,
} from '../services/investments/multiAgentCommitteeTypes';

export type CommitteeRunStatus = 'idle' | 'running' | 'done' | 'error';

export interface UseInvestmentCommitteeOptions {
    agentRunner?: CommitteeAgentRunner;
    fetchFn?: typeof fetch;
}

export interface UseInvestmentCommitteeReturn {
    history: CommitteeAnalysisReport[];
    activeAnalysis: CommitteeAnalysisReport | null;
    status: CommitteeRunStatus;
    progress: CommitteeProgressEvent | null;
    error: string | null;
    isPrivacyMode: boolean;
    hasGeminiKey: boolean;
    runAnalysis: (question: string, targetAmountCad?: number) => Promise<CommitteeAnalysisReport | null>;
    cancelAnalysis: () => void;
    selectAnalysis: (id: string) => void;
    deleteAnalysis: (id: string) => Promise<void>;
    clearHistory: () => Promise<void>;
}

const isAbortErr = (err: unknown): boolean =>
    (err instanceof Error && err.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');

const REAL_SCOPE: CommitteeStorageScope = { isTestMode: false, personaId: null };

export function useInvestmentCommittee(
    options: UseInvestmentCommitteeOptions = {},
): UseInvestmentCommitteeReturn {
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const apiKey = useFinanceStore((s) => cleGemini(s));

    const [history, setHistory] = useState<CommitteeAnalysisReport[]>([]);
    const [activeAnalysis, setActiveAnalysis] = useState<CommitteeAnalysisReport | null>(null);
    const [status, setStatus] = useState<CommitteeRunStatus>('idle');
    const [progress, setProgress] = useState<CommitteeProgressEvent | null>(null);
    const [error, setError] = useState<string | null>(null);

    const abortRef = useRef<AbortController | null>(null);
    const optionsRef = useRef(options);
    optionsRef.current = options;

    // Restauration au montage + annulation propre au démontage
    useEffect(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        let cancelled = false;
        setStatus('idle');
        setProgress(null);
        setError(null);
        setActiveAnalysis(null);

        void loadCommitteeHistory(REAL_SCOPE).then((items) => {
            if (cancelled) return;
            setHistory(items);
            setActiveAnalysis((prev) => prev ?? items[0] ?? null);
        });

        return () => {
            cancelled = true;
            abortRef.current?.abort();
        };
    }, []);

    const cancelAnalysis = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        setStatus((prev) => (prev === 'running' ? 'idle' : prev));
        setProgress(null);
    }, []);

    const runAnalysis = useCallback(
        async (question: string, targetAmountCad?: number): Promise<CommitteeAnalysisReport | null> => {
            const live = useFinanceStore.getState();
            if (live.isPrivacyMode) {
                setError(MESSAGE_IA_MODE_DISCRET);
                setStatus('error');
                return null;
            }
            const trimmed = question.trim();
            if (!trimmed) {
                setError('Saisis un titre ou une question à analyser.');
                setStatus('error');
                return null;
            }

            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            setStatus('running');
            setError(null);
            setProgress({
                phase: 'gathering',
                agentStates: {
                    market_news: 'pending',
                    fundamentals: 'pending',
                    risk_bear: 'pending',
                    portfolio_qc_tax: 'pending',
                    chair_synthesis: 'pending',
                },
                message: 'Initialisation du comité multi-agents…',
            });

            try {
                const liveKey = cleGemini(live);
                const report = await runMultiAgentCommittee({
                    question: trimmed,
                    state: live,
                    apiKey: liveKey,
                    isPrivacyMode: live.isPrivacyMode,
                    isTestMode: false,
                    targetAmountCad,
                    signal: controller.signal,
                    onProgress: (ev) => {
                        if (!controller.signal.aborted) {
                            setProgress(ev);
                        }
                    },
                    agentRunner: optionsRef.current.agentRunner,
                    fetchFn: optionsRef.current.fetchFn,
                });

                setActiveAnalysis(report);
                setStatus('done');
                setProgress(null);

                const savedList = await saveCommitteeAnalysis(REAL_SCOPE, report);
                setHistory(savedList);
                return report;
            } catch (err) {
                if (isAbortErr(err)) {
                    setStatus('idle');
                    setProgress(null);
                    return null;
                }
                const msg =
                    err instanceof Error && err.message === MESSAGE_IA_MODE_DISCRET
                        ? MESSAGE_IA_MODE_DISCRET
                        : messageErreurIa(err);
                setError(msg);
                setStatus('error');
                setProgress(null);
                return null;
            } finally {
                if (abortRef.current === controller) {
                    abortRef.current = null;
                }
            }
        },
        [],
    );

    const selectAnalysis = useCallback(
        (id: string) => {
            const found = history.find((h) => h.id === id);
            if (found) {
                setActiveAnalysis(found);
                setError(null);
            }
        },
        [history],
    );

    const deleteAnalysis = useCallback(
        async (id: string) => {
            const next = await deleteCommitteeAnalysis(REAL_SCOPE, id);
            setHistory(next);
            setActiveAnalysis((prev) => (prev?.id === id ? next[0] ?? null : prev));
        },
        [],
    );

    const clearHistory = useCallback(async () => {
        await clearCommitteeHistory(REAL_SCOPE);
        setHistory([]);
        setActiveAnalysis(null);
    }, []);

    return {
        history,
        activeAnalysis,
        status,
        progress,
        error,
        isPrivacyMode,
        hasGeminiKey: apiKey.trim().length > 0,
        runAnalysis,
        cancelAnalysis,
        selectAnalysis,
        deleteAnalysis,
        clearHistory,
    };
}
