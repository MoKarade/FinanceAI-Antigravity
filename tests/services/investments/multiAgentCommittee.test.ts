import { describe, it, expect, vi } from 'vitest';
import { buildDefaultAppState } from '../../../mcp/state/appStateDefaults';
import { MESSAGE_IA_MODE_DISCRET } from '../../../services/messageErreurIa';
import {
    runMultiAgentCommittee,
    extractSubjectFromQuestion,
    detectKnownPrivateCompany,
} from '../../../services/investments/multiAgentCommittee';
import type { CommitteeAgentCallRequest, CommitteeProgressEvent } from '../../../services/investments/multiAgentCommitteeTypes';
import type { AppState, Asset, User } from '../../../types';

function makeTestState(overrides: Partial<AppState> = {}): AppState {
    const base = buildDefaultAppState();
    return {
        ...base,
        config: {
            ...base.config,
            users: [
                { ...base.config.users[0], name: 'PersonneConfidentielle', grossSalary: 7500 },
                base.config.users[1],
            ] as [User, User],
        },
        assets: [
            {
                id: 'a1',
                symbol: 'XEQT.TO',
                name: 'iShares Core Equity ETF',
                sector: 'Index',
                region: 'Global',
                accountType: 'CELI',
                currency: 'CAD',
                quantity: 100,
                currentPrice: 32,
                buyPrice: 28,
                performance: 14,
                dateBought: '2025-01-10',
                dividendYield: 1.9,
            } as Asset,
            {
                id: 'a2',
                symbol: 'NVDA',
                name: 'NVIDIA',
                sector: 'Technologie',
                region: 'USA',
                accountType: 'REER',
                currency: 'USD',
                quantity: 10,
                currentPrice: 130,
                buyPrice: 95,
                performance: 36,
                dateBought: '2025-02-01',
                dividendYield: 0.03,
            } as Asset,
        ],
        ...overrides,
    };
}

describe('multiAgentCommittee — détection et anonymisation', () => {
    it('détecte Anthropic comme société privée et extrait le sujet proprement', () => {
        expect(detectKnownPrivateCompany("Est-ce que ça vaut le coup d'acheter Anthropic ?")?.name).toBe('Anthropic');
        const ext = extractSubjectFromQuestion("Est-ce que ça vaut le coup d'acheter Anthropic ?");
        expect(ext.subject).toBe('Anthropic');
        expect(ext.explicitTicker).toBeNull();
    });

    it('bloque immédiatement en mode discret sans aucun appel réseau ni IA', async () => {
        const fetchSpy = vi.fn();
        const runnerSpy = vi.fn();
        await expect(
            runMultiAgentCommittee({
                question: "Est-ce que ça vaut le coup d'acheter Anthropic ?",
                state: makeTestState(),
                isPrivacyMode: true,
                apiKey: 'fake-key',
                fetchFn: fetchSpy as unknown as typeof fetch,
                agentRunner: runnerSpy,
            }),
        ).rejects.toThrow(MESSAGE_IA_MODE_DISCRET);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(runnerSpy).not.toHaveBeenCalled();
    });

    it('en l’absence de clé API, produit un diagnostic local honnête (conviction null, zéro donnée inventée)', async () => {
        const events: CommitteeProgressEvent[] = [];
        const report = await runMultiAgentCommittee({
            question: "Est-ce que ça vaut le coup d'acheter Anthropic ?",
            state: makeTestState(),
            apiKey: '',
            onProgress: (e) => events.push(e),
        });

        expect(report.source).toBe('fallback');
        expect(report.conviction).toBeNull();
        expect(report.entityStatus).toBe('private_unlisted');
        expect(report.verdict).toBe('EXPOSITION_INDIRECTE');
        expect(report.indirectProxies.map((p) => p.symbol)).toContain('AMZN');
        expect(report.agents).toHaveLength(4);
        expect(report.fallbackNotice).toMatch(/Clé API Google Gemini absente/i);
        expect(events[events.length - 1]?.phase).toBe('done');
    });
});

describe('multiAgentCommittee — comité à 5 agents en parallèle', () => {
    it('exécute les 4 spécialistes puis le président sur Anthropic et préserve sources et désaccords', async () => {
        const calls: CommitteeAgentCallRequest[] = [];
        const agentRunner = vi.fn(async (req: CommitteeAgentCallRequest) => {
            calls.push(req);
            if (req.agentId === 'chair_synthesis') {
                return {
                    text: JSON.stringify({
                        entityStatus: 'private_unlisted',
                        resolvedTicker: null,
                        verdict: 'EXPOSITION_INDIRECTE',
                        conviction: 78,
                        executiveSummary: 'Anthropic reste privée et non achetable en CELI/REER ; privilégier une exposition indirecte cotée via AMZN ou GOOGL.',
                        consensus: ['Forte traction commerciale sur les modèles Claude en entreprise.'],
                        disagreements: ['L’Agent Fondamentaux valorise l’effet de levier cloud, tandis que l’Agent Risques alerte sur la dépendance aux capitaux et aux GPU.'],
                        actionPlan: ['Analyser AMZN ou GOOGL avant tout achat en REER ou CELI.'],
                        indirectProxies: [{ symbol: 'AMZN', name: 'Amazon.com', rationale: 'Partenaire et actionnaire AWS Bedrock.' }],
                        invalidationConditions: ['Dépôt officiel S-1 d’introduction en bourse d’Anthropic.'],
                        recommendedWrapper: 'REER ou CELI via véhicules cotés indirects',
                    }),
                    sources: [],
                    usedWebSearch: false,
                    modelUsed: 'gemini-2.5-flash',
                };
            }
            return {
                text: JSON.stringify({
                    stance: req.agentId === 'risk_bear' ? 'DEFAVORABLE' : 'INDIRECT',
                    confidence: 80,
                    summary: `Rapport structuré pour ${req.agentId}.`,
                    keyPoints: [`Point vérifié (${req.agentId})`],
                    risks: [`Risque relevé (${req.agentId})`],
                }),
                sources: req.useWebSearch
                    ? [{ title: 'Source test', url: 'https://www.anthropic.com/news', domain: 'anthropic.com' }]
                    : [],
                usedWebSearch: req.useWebSearch,
                modelUsed: 'gemini-2.5-flash',
            };
        });

        const report = await runMultiAgentCommittee({
            question: "Est-ce que ça vaut le coup d'acheter Anthropic ?",
            state: makeTestState(),
            apiKey: 'gemini-test-key',
            agentRunner,
        });

        expect(calls.map((c) => c.agentId).slice(0, 4)).toEqual([
            'market_news',
            'fundamentals',
            'risk_bear',
            'portfolio_qc_tax',
        ]);
        expect(calls[4]?.agentId).toBe('chair_synthesis');

        // Vérifie qu'aucun nom personnel n'est envoyé aux prompts et que ACTIF_01 est utilisé
        for (const c of calls) {
            expect(c.prompt).not.toContain('PersonneConfidentielle');
            expect(c.prompt).toContain('ACTIF_01');
        }

        expect(report.source).toBe('gemini_web');
        expect(report.entityStatus).toBe('private_unlisted');
        expect(report.verdict).toBe('EXPOSITION_INDIRECTE');
        expect(report.conviction).toBe(78);
        expect(report.disagreements[0]).toMatch(/Agent Fondamentaux/);
        expect(report.sources).toHaveLength(1);
        expect(report.sources[0]?.url).toBe('https://www.anthropic.com/news');
    });

    it('résiste si 1 agent renvoie du JSON cassé : les 3 autres et le président aboutissent', async () => {
        const agentRunner = vi.fn(async (req: CommitteeAgentCallRequest) => {
            if (req.agentId === 'risk_bear') {
                return { text: 'Réponse non JSON totalement cassée', sources: [], usedWebSearch: false, modelUsed: 'gemini-2.5-flash' };
            }
            if (req.agentId === 'chair_synthesis') {
                return {
                    text: '```json\n{"entityStatus":"public_listed","resolvedTicker":"NVDA","verdict":"CONSERVER","conviction":66,"executiveSummary":"NVDA reste déjà bien représenté dans le portefeuille REER.","consensus":["Momentum solide"],"disagreements":["Valorisation élevée"],"actionPlan":["Éviter de surpondérer au-delà de 15 %"],"indirectProxies":[],"invalidationConditions":["Ralentissement des capex IA"],"recommendedWrapper":"REER"}\n```',
                    sources: [],
                    usedWebSearch: false,
                    modelUsed: 'gemini-2.5-flash',
                };
            }
            return {
                text: JSON.stringify({
                    stance: 'FAVORABLE',
                    confidence: 74,
                    summary: 'Fondamentaux solides sur les centres de données.',
                    keyPoints: ['Croissance GPU soutenue'],
                    risks: ['Valorisation exigeante'],
                }),
                sources: [],
                usedWebSearch: req.useWebSearch,
                modelUsed: 'gemini-2.5-flash',
            };
        });

        const report = await runMultiAgentCommittee({
            question: 'Analyser NVDA pour mon REER',
            state: makeTestState(),
            apiKey: 'gemini-test-key',
            agentRunner,
        });

        expect(report.entityStatus).toBe('public_listed');
        expect(report.resolvedTicker).toBe('NVDA');
        expect(report.verdict).toBe('CONSERVER');
        expect(report.agents.find((a) => a.id === 'risk_bear')?.sourceMode).toBe('fallback');
        expect(report.agents.filter((a) => a.sourceMode !== 'fallback')).toHaveLength(3);
    });

    it('respecte AbortSignal immédiatement', async () => {
        const ac = new AbortController();
        ac.abort(new DOMException('Annulé', 'AbortError'));
        await expect(
            runMultiAgentCommittee({
                question: 'Analyser XEQT.TO',
                state: makeTestState(),
                apiKey: 'gemini-test-key',
                signal: ac.signal,
            }),
        ).rejects.toThrow(/Annulé|Abort/);
    });
});
