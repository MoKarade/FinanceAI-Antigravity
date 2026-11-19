// services/investments/multiAgentCommitteeTypes.ts
// Contrats TypeScript stricts du Comité Multi-Agents d'analyse de placements.

export type CommitteeEntityStatus =
    | 'public_listed'
    | 'private_unlisted'
    | 'sector_or_theme'
    | 'portfolio_question';

export type CommitteeVerdict =
    | 'ACHETER'
    | 'ACCUMULER'
    | 'EXPOSITION_INDIRECTE'
    | 'ATTENDRE'
    | 'EVITER'
    | 'CONSERVER';

export type CommitteeAgentId =
    | 'market_news'
    | 'fundamentals'
    | 'risk_bear'
    | 'portfolio_qc_tax'
    | 'chair_synthesis';

export type CommitteeSpecialistAgentId = Exclude<CommitteeAgentId, 'chair_synthesis'>;

export type CommitteeAgentStance =
    | 'FAVORABLE'
    | 'PRUDENT'
    | 'DEFAVORABLE'
    | 'INDIRECT'
    | 'NEUTRE';

export type CommitteeAgentStatus = 'pending' | 'running' | 'done' | 'fallback' | 'error';

export interface CommitteeSourceLink {
    title: string;
    url: string;
    domain: string;
}

export interface CommitteeIndirectProxy {
    symbol: string;
    name: string;
    rationale: string;
}

export interface CommitteeAgentReport {
    id: CommitteeSpecialistAgentId;
    title: string;
    role: string;
    stance: CommitteeAgentStance;
    confidence: number | null;
    summary: string;
    keyPoints: string[];
    risks: string[];
    sources: CommitteeSourceLink[];
    sourceMode: 'gemini_web' | 'gemini' | 'fallback';
}

export interface CommitteeLiveQuote {
    symbol: string;
    name: string;
    priceCad: number | null;
    nativePrice: number | null;
    currency: string | null;
    volatilityPct: number | null;
    trailing1YReturnPct: number | null;
    categoryLabel: string | null;
}

export interface CommitteeNewsHeadline {
    title: string;
    publisher: string;
    publishedAt: string;
    url: string | null;
}

export interface CommitteeAnalysisReport {
    id: string;
    createdAt: string;
    question: string;
    subject: string;
    entityStatus: CommitteeEntityStatus;
    resolvedTicker: string | null;
    liveQuote: CommitteeLiveQuote | null;
    verdict: CommitteeVerdict;
    verdictLabel: string;
    conviction: number | null;
    executiveSummary: string;
    consensus: string[];
    disagreements: string[];
    actionPlan: string[];
    indirectProxies: CommitteeIndirectProxy[];
    invalidationConditions: string[];
    recommendedWrapper: string | null;
    agents: CommitteeAgentReport[];
    sources: CommitteeSourceLink[];
    source: 'gemini_web' | 'gemini' | 'fallback';
    fallbackNotice: string | null;
    durationMs: number;
    modelUsed: string | null;
}

export interface CommitteeProgressEvent {
    phase: 'gathering' | 'agents' | 'synthesis' | 'done';
    agentStates: Record<CommitteeAgentId, CommitteeAgentStatus>;
    message: string;
}

export interface CommitteeAgentCallRequest {
    agentId: CommitteeAgentId;
    model: string;
    systemInstruction: string;
    prompt: string;
    useWebSearch: boolean;
    signal?: AbortSignal;
}

export interface CommitteeAgentCallResponse {
    text: string;
    sources: CommitteeSourceLink[];
    usedWebSearch: boolean;
    modelUsed: string;
}

export type CommitteeAgentRunner = (
    req: CommitteeAgentCallRequest,
) => Promise<CommitteeAgentCallResponse>;
