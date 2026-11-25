/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { toHaveNoViolations } from 'vitest-axe/dist/matchers';
import { MultiAgentCommitteeView } from '../../../components/investments/MultiAgentCommitteeView';
import { useFinanceStore } from '../../../store/useFinanceStore';
import { MESSAGE_IA_MODE_DISCRET } from '../../../services/messageErreurIa';
import type { CommitteeAgentCallRequest } from '../../../services/investments/multiAgentCommitteeTypes';

expect.extend({ toHaveNoViolations });

function makeMockAgentRunner() {
    return vi.fn(async (req: CommitteeAgentCallRequest) => {
        if (req.agentId === 'chair_synthesis') {
            return {
                text: JSON.stringify({
                    entityStatus: 'private_unlisted',
                    resolvedTicker: null,
                    verdict: 'EXPOSITION_INDIRECTE',
                    conviction: 81,
                    executiveSummary:
                        'Anthropic est privée et non cotée ; privilégier AMZN ou GOOGL dans le REER/CELI pour une exposition indirecte liquide.',
                    consensus: ['Forte adoption entreprise de Claude'],
                    disagreements: ['Prime de valorisation IA vs besoins GPU élevés'],
                    actionPlan: ['Analyser AMZN et GOOGL avant toute entrée'],
                    indirectProxies: [
                        { symbol: 'AMZN', name: 'Amazon.com', rationale: 'Actionnaire stratégique et hébergeur AWS Bedrock.' },
                    ],
                    invalidationConditions: ['Annonce officielle d’introduction en bourse (S-1)'],
                    recommendedWrapper: 'REER ou CELI via titres cotés indirects',
                }),
                sources: [],
                usedWebSearch: false,
                modelUsed: 'gemini-2.5-flash',
            };
        }
        return {
            text: JSON.stringify({
                stance: req.agentId === 'risk_bear' ? 'PRUDENT' : 'INDIRECT',
                confidence: 78,
                summary: `Synthèse agent ${req.agentId}.`,
                keyPoints: [`Fait vérifié (${req.agentId})`],
                risks: [`Vigilance (${req.agentId})`],
            }),
            sources: req.useWebSearch
                ? [{ title: 'Anthropic News', url: 'https://www.anthropic.com/news', domain: 'anthropic.com' }]
                : [],
            usedWebSearch: req.useWebSearch,
            modelUsed: 'gemini-2.5-flash',
        };
    });
}

describe('MultiAgentCommitteeView', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', undefined);
        act(() => {
            useFinanceStore.setState({
                isPrivacyMode: false,
                apiKeys: { gemini: 'gemini-test-key', finnhub: '' },
                assets: [],
            } as never);
        });
    });

    it('exécute l’analyse multi-agents sur Anthropic, affiche verdict, désaccords, sources et passe vitest-axe', async () => {
        const runner = makeMockAgentRunner();
        const { container } = render(<MultiAgentCommitteeView committeeOptions={{ agentRunner: runner }} />);

        expect(await axe(container)).toHaveNoViolations();

        fireEvent.click(screen.getByRole('button', { name: 'Acheter Anthropic ?' }));

        await waitFor(() => expect(screen.getByTestId('committee-report')).toBeInTheDocument());

        expect(screen.getByTestId('committee-verdict-badge')).toHaveTextContent('Non coté — Exposition indirecte');
        expect(screen.getByText(/Société privée non cotée/i)).toBeInTheDocument();
        expect(screen.getByText(/Points d’accord entre les agents/i)).toBeInTheDocument();
        expect(screen.getByText(/Désaccords & points de tension/i)).toBeInTheDocument();
        expect(screen.getByTestId('agent-card-market_news')).toBeInTheDocument();
        expect(screen.getByTestId('agent-card-fundamentals')).toBeInTheDocument();
        expect(screen.getByTestId('agent-card-risk_bear')).toBeInTheDocument();
        expect(screen.getByTestId('agent-card-portfolio_qc_tax')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Anthropic News/i })).toHaveAttribute('href', 'https://www.anthropic.com/news');

        expect(await axe(container)).toHaveNoViolations();
    });

    it('mode discret : bloque l’analyse sans aucun appel au runner IA et affiche MESSAGE_IA_MODE_DISCRET', async () => {
        act(() => {
            useFinanceStore.setState({ isPrivacyMode: true } as never);
        });
        const runner = vi.fn();
        render(<MultiAgentCommitteeView committeeOptions={{ agentRunner: runner }} />);

        expect(screen.getByTestId('committee-privacy-banner')).toHaveTextContent(MESSAGE_IA_MODE_DISCRET);
        expect(screen.getByRole('button', { name: /Analyser \(5 agents\)/i })).toBeDisabled();
        expect(runner).not.toHaveBeenCalled();
    });
});
