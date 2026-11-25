/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useInvestmentCommittee } from '../../hooks/useInvestmentCommittee';
import { useFinanceStore } from '../../store/useFinanceStore';
import { MESSAGE_IA_MODE_DISCRET } from '../../services/messageErreurIa';
import type { CommitteeAgentCallRequest } from '../../services/investments/multiAgentCommitteeTypes';

describe('hooks/useInvestmentCommittee', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', undefined);
        useFinanceStore.setState({
            isPrivacyMode: false,
            apiKeys: { gemini: 'gemini-test-key', finnhub: '' },
            assets: [],
        } as never);
    });

    it('bloque l’analyse en mode discret sans appeler les agents', async () => {
        useFinanceStore.setState({ isPrivacyMode: true } as never);
        const runner = vi.fn();
        const { result } = renderHook(() => useInvestmentCommittee({ agentRunner: runner }));

        await act(async () => {
            await result.current.runAnalysis("Est-ce que ça vaut le coup d'acheter Anthropic ?");
        });

        expect(runner).not.toHaveBeenCalled();
        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe(MESSAGE_IA_MODE_DISCRET);
    });

    it('exécute le comité 5 agents et expose le rapport actif', async () => {
        const agentRunner = vi.fn(async (req: CommitteeAgentCallRequest) => {
            if (req.agentId === 'chair_synthesis') {
                return {
                    text: JSON.stringify({
                        entityStatus: 'private_unlisted',
                        resolvedTicker: null,
                        verdict: 'EXPOSITION_INDIRECTE',
                        conviction: 75,
                        executiveSummary: 'Anthropic est non cotée ; envisager AMZN/GOOGL.',
                        consensus: ['Leader IA'],
                        disagreements: ['Coût GPU vs marge'],
                        actionPlan: ['Analyser AMZN'],
                        indirectProxies: [{ symbol: 'AMZN', name: 'Amazon', rationale: 'Partenaire AWS' }],
                        invalidationConditions: ['Annonce IPO'],
                        recommendedWrapper: 'REER/CELI',
                    }),
                    sources: [],
                    usedWebSearch: false,
                    modelUsed: 'gemini-2.5-flash',
                };
            }
            return {
                text: JSON.stringify({
                    stance: 'INDIRECT',
                    confidence: 76,
                    summary: 'Analyse OK.',
                    keyPoints: ['Point clé'],
                    risks: ['Risque clé'],
                }),
                sources: [],
                usedWebSearch: false,
                modelUsed: 'gemini-2.5-flash',
            };
        });

        const { result } = renderHook(() => useInvestmentCommittee({ agentRunner }));

        await act(async () => {
            await result.current.runAnalysis("Est-ce que ça vaut le coup d'acheter Anthropic ?");
        });

        await waitFor(() => expect(result.current.status).toBe('done'));
        expect(result.current.activeAnalysis?.subject).toBe('Anthropic');
        expect(result.current.activeAnalysis?.verdict).toBe('EXPOSITION_INDIRECTE');
        expect(result.current.history[0]?.id).toBe(result.current.activeAnalysis?.id);
    });
});
