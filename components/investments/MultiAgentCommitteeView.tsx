// components/investments/MultiAgentCommitteeView.tsx
//
// Interface du Comité d'Investissement Multi-Agents (5 agents : 4 spécialistes en parallèle
// + Président) pour FinanceAI : analyse tout titre coté OU entreprise privée non cotée
// (ex. Anthropic) avec sources Web, consensus/désaccords, proxies indirects et historique
// chiffré IndexedDB. Respect strict des tokens sémantiques, cibles >= 44 px et mode discret.

import React, { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { formatCAD, formatVariationPct } from '../../utils/format';
import { MESSAGE_IA_MODE_DISCRET } from '../../services/messageErreurIa';
import {
    useInvestmentCommittee,
    type UseInvestmentCommitteeOptions,
} from '../../hooks/useInvestmentCommittee';
import type {
    CommitteeAgentId,
    CommitteeAgentStance,
    CommitteeAgentStatus,
    CommitteeAnalysisReport,
    CommitteeVerdict,
} from '../../services/investments/multiAgentCommitteeTypes';

export interface MultiAgentCommitteeViewProps {
    initialQuestion?: string | null;
    onClearInitialQuestion?: () => void;
    onAddTicker?: (symbol: string) => void;
    onOpenSettings?: () => void;
    committeeOptions?: UseInvestmentCommitteeOptions;
}

const STARTER_PROMPTS: ReadonlyArray<{ id: string; label: string; question: string }> = [
    {
        id: 'anthropic',
        label: 'Acheter Anthropic ?',
        question: 'Est-ce que ça vaut le coup d’acheter Anthropic ?',
    },
    {
        id: 'xeqt_vfv',
        label: 'XEQT.TO ou VFV.TO ?',
        question: 'Est-ce que ça vaut le coup de renforcer XEQT.TO ou VFV.TO dans mon CELI ?',
    },
    {
        id: 'msft',
        label: 'Analyser MSFT',
        question: 'Est-ce que ça vaut le coup d’acheter MSFT maintenant malgré sa valorisation ?',
    },
    {
        id: 'portfolio_check',
        label: 'Risque portefeuille',
        question: 'Mon portefeuille actuel est-il trop concentré en technologie américaine ?',
    },
];

const AGENT_PIPELINE_LABELS: ReadonlyArray<{
    id: CommitteeAgentId;
    label: string;
    icon: IconName;
}> = [
    { id: 'market_news', label: 'Marché & Actus Web', icon: 'globe' },
    { id: 'fundamentals', label: 'Fondamentaux', icon: 'chart' },
    { id: 'risk_bear', label: 'Risques & Avocat du diable', icon: 'shield' },
    { id: 'portfolio_qc_tax', label: 'Portefeuille & Fiscalité QC', icon: 'tax' },
    { id: 'chair_synthesis', label: 'Synthèse Président', icon: 'sparkles' },
];

function verdictPillClass(verdict: CommitteeVerdict): string {
    if (verdict === 'ACHETER' || verdict === 'ACCUMULER') return 'gf-delta-up';
    if (verdict === 'EVITER') return 'gf-delta-down';
    if (verdict === 'EXPOSITION_INDIRECTE' || verdict === 'ATTENDRE') return 'gf-delta-amber';
    return 'gf-delta-neutral';
}

function stancePillClass(stance: CommitteeAgentStance): string {
    if (stance === 'FAVORABLE') return 'gf-delta-up';
    if (stance === 'DEFAVORABLE') return 'gf-delta-down';
    if (stance === 'PRUDENT' || stance === 'INDIRECT') return 'gf-delta-amber';
    return 'gf-delta-neutral';
}

function stanceLabel(stance: CommitteeAgentStance): string {
    switch (stance) {
        case 'FAVORABLE':
            return 'Favorable';
        case 'DEFAVORABLE':
            return 'Défavorable';
        case 'PRUDENT':
            return 'Prudent';
        case 'INDIRECT':
            return 'Exposition indirecte';
        default:
            return 'Neutre';
    }
}

function agentStatusLabel(st: CommitteeAgentStatus): string {
    switch (st) {
        case 'running':
            return 'En cours';
        case 'done':
            return 'Terminé';
        case 'fallback':
            return 'Repli local';
        case 'error':
            return 'Erreur';
        default:
            return 'En attente';
    }
}

function entityStatusLabel(status: CommitteeAnalysisReport['entityStatus']): string {
    switch (status) {
        case 'private_unlisted':
            return 'Société privée non cotée';
        case 'public_listed':
            return 'Titre coté en bourse';
        case 'portfolio_question':
            return 'Audit de portefeuille';
        default:
            return 'Thème ou secteur';
    }
}

export const MultiAgentCommitteeView: React.FC<MultiAgentCommitteeViewProps> = ({
    initialQuestion,
    onClearInitialQuestion,
    onAddTicker,
    onOpenSettings,
    committeeOptions,
}) => {
    const {
        history,
        activeAnalysis,
        status,
        progress,
        error,
        isPrivacyMode,
        hasGeminiKey,
        runAnalysis,
        cancelAnalysis,
        selectAnalysis,
        deleteAnalysis,
        clearHistory,
    } = useInvestmentCommittee(committeeOptions);

    const [questionInput, setQuestionInput] = useState(
        initialQuestion ?? 'Est-ce que ça vaut le coup d’acheter Anthropic ?',
    );
    const autoLaunchedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!initialQuestion || isPrivacyMode) return;
        if (autoLaunchedRef.current === initialQuestion) return;
        autoLaunchedRef.current = initialQuestion;
        setQuestionInput(initialQuestion);
        void runAnalysis(initialQuestion).finally(() => {
            onClearInitialQuestion?.();
        });
    }, [initialQuestion, isPrivacyMode, runAnalysis, onClearInitialQuestion]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!questionInput.trim() || status === 'running' || isPrivacyMode) return;
        void runAnalysis(questionInput);
    };

    const handleStarter = (q: string) => {
        setQuestionInput(q);
        if (!isPrivacyMode && status !== 'running') {
            void runAnalysis(q);
        }
    };

    return (
        <div data-testid="multi-agent-committee-view" className="space-y-5">
            {/* Formulaire d'interrogation multi-agents */}
            <section
                aria-labelledby="committee-heading"
                className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 sm:p-5 space-y-4"
            >
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                            <Icon name="sparkles" size={18} className="text-repere shrink-0" />
                            <h2 id="committee-heading" className="text-base sm:text-lg font-bold text-ink-50">
                                Comité d’investissement multi-agents
                            </h2>
                        </div>
                        <p className="text-xs sm:text-sm text-ink-300 leading-relaxed">
                            Pose une question sur n’importe quelle action, FNB, crypto ou entreprise privée non cotée (ex. Anthropic). 4 analystes spécialisés confrontent leurs thèses avant le verdict final.
                        </p>
                    </div>
                    <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-semibold ${
                            hasGeminiKey ? 'gf-delta-up' : 'gf-delta-amber'
                        }`}
                    >
                        <Icon name={hasGeminiKey ? 'globe' : 'info'} size={13} />
                        <span>{hasGeminiKey ? 'Gemini Web actif' : 'Mode local (sans clé Gemini)'}</span>
                    </span>
                </div>

                {isPrivacyMode && (
                    <div
                        role="status"
                        data-testid="committee-privacy-banner"
                        className="rounded-xl bg-alerte-fond border border-bordure-champ px-4 py-3 text-xs sm:text-sm text-alerte-texte flex items-start gap-2.5"
                    >
                        <Icon name="lock" size={16} className="shrink-0 mt-0.5" />
                        <span>{MESSAGE_IA_MODE_DISCRET}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
                    <label htmlFor="committee-question-input" className="sr-only">
                        Question ou titre à analyser par le comité IA
                    </label>
                    <input
                        id="committee-question-input"
                        type="text"
                        value={questionInput}
                        onChange={(e) => setQuestionInput(e.target.value)}
                        disabled={isPrivacyMode}
                        placeholder="Ex. Est-ce que ça vaut le coup d’acheter Anthropic ? ou Analyser MSFT"
                        className="touch-target min-h-11 flex-1 rounded-xl bg-surface-douce border border-bordure-champ px-3.5 py-2 text-sm text-texte placeholder-ink-400 focus-ring disabled:opacity-50"
                    />
                    {status === 'running' ? (
                        <button
                            type="button"
                            onClick={cancelAnalysis}
                            className="touch-target min-h-11 px-4 rounded-xl bg-surface-douce border border-bordure-champ text-sm font-semibold text-texte hover:bg-bordure transition-colors focus-ring shrink-0"
                        >
                            Annuler
                        </button>
                    ) : (
                        <button
                            type="submit"
                            disabled={isPrivacyMode || !questionInput.trim()}
                            className="touch-target min-h-11 px-5 rounded-xl bg-accent text-sur-accent text-sm font-semibold hover:opacity-90 transition-opacity focus-ring disabled:opacity-50 inline-flex items-center justify-center gap-2 shrink-0"
                        >
                            <Icon name="sparkles" size={15} />
                            <span>Analyser (5 agents)</span>
                        </button>
                    )}
                </form>

                <div role="group" aria-label="Exemples de questions d’investissement" className="flex flex-wrap gap-2">
                    {STARTER_PROMPTS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            disabled={isPrivacyMode || status === 'running'}
                            onClick={() => handleStarter(item.question)}
                            className="touch-target min-h-11 px-3.5 py-1.5 rounded-full bg-surface-douce border border-bordure-champ text-xs font-medium text-ink-100 hover:bg-bordure transition-colors focus-ring disabled:opacity-50"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </section>

            {/* Progression en direct par agent */}
            {status === 'running' && progress && (
                <section
                    aria-label="Progression du comité multi-agents"
                    aria-live="polite"
                    data-testid="committee-progress"
                    className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 space-y-3"
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-ink-100 flex items-center gap-2">
                            <Icon name="sparkles" size={15} className="text-repere animate-spin" />
                            <span>{progress.message}</span>
                        </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                        {AGENT_PIPELINE_LABELS.map((agent) => {
                            const st = progress.agentStates[agent.id];
                            return (
                                <div
                                    key={agent.id}
                                    className="rounded-xl bg-surface-douce border border-bordure px-3 py-2.5 flex items-center justify-between gap-2"
                                >
                                    <div className="flex items-center gap-2 min-w-0">
                                        <Icon name={agent.icon} size={14} className="text-repere shrink-0" />
                                        <span className="text-xs font-semibold text-ink-100 truncate">
                                            {agent.label}
                                        </span>
                                    </div>
                                    <span
                                        className={`text-[11px] font-mono font-semibold shrink-0 px-2 py-0.5 rounded-full ${
                                            st === 'done'
                                                ? 'gf-delta-up'
                                                : st === 'running'
                                                  ? 'gf-delta-amber'
                                                  : 'gf-delta-neutral'
                                        }`}
                                    >
                                        {agentStatusLabel(st)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {/* Erreur explicite */}
            {error && (
                <div
                    role="status"
                    className="rounded-2xl bg-erreur-fond border border-bordure-champ px-4 py-3 text-sm text-erreur-texte flex items-start gap-2.5"
                >
                    <Icon name="alert" size={16} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                </div>
            )}

            {/* Rapport actif (strictement masqué si mode discret activé) */}
            {!isPrivacyMode && activeAnalysis && (
                <article
                    aria-labelledby="committee-verdict-title"
                    data-testid="committee-report"
                    className="space-y-5"
                >
                    {/* Carte Verdict du Président */}
                    <section className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 sm:p-5 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-bordure">
                            <div className="space-y-1.5 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold gf-delta-neutral">
                                        {entityStatusLabel(activeAnalysis.entityStatus)}
                                    </span>
                                    {activeAnalysis.resolvedTicker && (
                                        <span className="gf-ticker-symbol">{activeAnalysis.resolvedTicker}</span>
                                    )}
                                    <span className="text-[11px] font-mono text-ink-400">
                                        {activeAnalysis.source === 'gemini_web'
                                            ? 'Recherche Web Gemini'
                                            : activeAnalysis.source === 'gemini'
                                              ? 'Analyse Gemini'
                                              : 'Diagnostic local'}
                                    </span>
                                </div>
                                <h3
                                    id="committee-verdict-title"
                                    className="text-lg sm:text-xl font-bold text-ink-50"
                                >
                                    {activeAnalysis.subject}
                                </h3>
                                <p className="text-xs text-ink-400">
                                    Question analysée : {activeAnalysis.question}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                                <span
                                    data-testid="committee-verdict-badge"
                                    className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-mono font-bold ${verdictPillClass(
                                        activeAnalysis.verdict,
                                    )}`}
                                >
                                    {activeAnalysis.verdictLabel}
                                </span>
                                <span className="px-3 py-1.5 rounded-full text-xs font-mono font-semibold bg-surface-douce border border-bordure text-ink-100">
                                    {activeAnalysis.conviction !== null ? (
                                        <>
                                            Conviction <PrivateAmount>{activeAnalysis.conviction}</PrivateAmount>/100
                                        </>
                                    ) : (
                                        'Conviction non notée (mode local)'
                                    )}
                                </span>
                            </div>
                        </div>

                        {activeAnalysis.fallbackNotice && (
                            <div className="rounded-xl bg-alerte-fond border border-bordure-champ px-3.5 py-2.5 text-xs sm:text-sm text-alerte-texte flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                    <Icon name="info" size={15} className="shrink-0 mt-0.5" />
                                    <span>{activeAnalysis.fallbackNotice}</span>
                                </div>
                                {onOpenSettings && !hasGeminiKey && (
                                    <button
                                        type="button"
                                        onClick={onOpenSettings}
                                        className="touch-target min-h-11 px-3 py-1.5 rounded-full bg-surface border border-bordure-champ text-xs font-semibold text-texte hover:bg-surface-douce transition-colors focus-ring shrink-0"
                                    >
                                        Ouvrir Réglages IA
                                    </button>
                                )}
                            </div>
                        )}

                        {activeAnalysis.liveQuote && (
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div className="rounded-xl bg-surface-douce border border-bordure p-3">
                                    <div className="text-[11px] font-mono uppercase text-ink-400">Cours CAD</div>
                                    <div className="font-mono text-sm sm:text-base font-bold text-ink-50 mt-0.5">
                                        {activeAnalysis.liveQuote.priceCad !== null ? (
                                            <PrivateAmount>{formatCAD(activeAnalysis.liveQuote.priceCad)}</PrivateAmount>
                                        ) : (
                                            '—'
                                        )}
                                    </div>
                                </div>
                                <div className="rounded-xl bg-surface-douce border border-bordure p-3">
                                    <div className="text-[11px] font-mono uppercase text-ink-400">Rendement 12 mois</div>
                                    <div className="font-mono text-sm sm:text-base font-bold text-ink-50 mt-0.5">
                                        {/* MONTANT-PUBLIC : variation publique du titre coté (pas celle du portefeuille). */}
                                        {formatVariationPct(activeAnalysis.liveQuote.trailing1YReturnPct, 1)}
                                    </div>
                                </div>
                                <div className="rounded-xl bg-surface-douce border border-bordure p-3">
                                    <div className="text-[11px] font-mono uppercase text-ink-400">Volatilité ann.</div>
                                    <div className="font-mono text-sm sm:text-base font-bold text-ink-50 mt-0.5">
                                        {/* MONTANT-PUBLIC : volatilité publique historique du titre coté. */}
                                        {activeAnalysis.liveQuote.volatilityPct !== null
                                            ? `${activeAnalysis.liveQuote.volatilityPct.toFixed(1)} %`
                                            : '—'}
                                    </div>
                                </div>
                                <div className="rounded-xl bg-surface-douce border border-bordure p-3">
                                    <div className="text-[11px] font-mono uppercase text-ink-400">Enveloppe QC/CA</div>
                                    <div className="text-xs font-semibold text-ink-100 mt-0.5">
                                        {activeAnalysis.recommendedWrapper || '—'}
                                    </div>
                                </div>
                            </div>
                        )}

                        <p className="text-sm text-ink-100 leading-relaxed">{activeAnalysis.executiveSummary}</p>

                        {!activeAnalysis.liveQuote && activeAnalysis.recommendedWrapper && (
                            <div className="rounded-xl bg-surface-douce border border-bordure px-3.5 py-2.5 text-xs sm:text-sm text-ink-200 flex items-center gap-2">
                                <Icon name="tax" size={15} className="text-repere shrink-0" />
                                <span>
                                    <strong className="text-ink-50">Enveloppe fiscale QC/CA :</strong>{' '}
                                    {activeAnalysis.recommendedWrapper}
                                </span>
                            </div>
                        )}

                        {/* Vecteurs indirects pour sociétés privées non cotées */}
                        {activeAnalysis.indirectProxies.length > 0 && (
                            <div className="rounded-xl bg-surface-douce border border-bordure p-3.5 space-y-2.5">
                                <div className="text-xs font-bold uppercase tracking-wider text-ink-300">
                                    Pistes d’exposition indirecte cotées en bourse
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                    {activeAnalysis.indirectProxies.map((proxy) => (
                                        <div
                                            key={proxy.symbol}
                                            className="rounded-xl bg-surface border border-bordure p-3 flex items-start justify-between gap-2.5"
                                        >
                                            <div className="min-w-0 space-y-0.5">
                                                <div className="flex items-center gap-2">
                                                    <span className="gf-ticker-symbol">{proxy.symbol}</span>
                                                    <span className="text-xs font-semibold text-ink-100 truncate">
                                                        {proxy.name}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-ink-300 leading-snug">{proxy.rationale}</p>
                                            </div>
                                            <button
                                                type="button"
                                                disabled={isPrivacyMode || status === 'running'}
                                                onClick={() =>
                                                    handleStarter(`Est-ce que ça vaut le coup d’acheter ${proxy.symbol} ?`)
                                                }
                                                className="touch-target min-h-11 px-3 py-1.5 rounded-full bg-surface-douce border border-bordure-champ text-xs font-semibold text-texte hover:bg-bordure transition-colors focus-ring shrink-0"
                                            >
                                                Analyser {proxy.symbol}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Plan d'action & Conditions d'invalidation */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {activeAnalysis.actionPlan.length > 0 && (
                                <div className="rounded-xl bg-surface-douce border border-bordure p-3.5 space-y-2">
                                    <div className="text-xs font-bold uppercase tracking-wider text-ink-300">
                                        Plan d’action recommandé
                                    </div>
                                    <ul className="space-y-1.5 text-xs sm:text-sm text-ink-100 list-disc pl-4">
                                        {activeAnalysis.actionPlan.map((step, idx) => (
                                            <li key={idx}>{step}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {activeAnalysis.invalidationConditions.length > 0 && (
                                <div className="rounded-xl bg-surface-douce border border-bordure p-3.5 space-y-2">
                                    <div className="text-xs font-bold uppercase tracking-wider text-ink-300">
                                        Ce qui changerait le verdict
                                    </div>
                                    <ul className="space-y-1.5 text-xs sm:text-sm text-ink-100 list-disc pl-4">
                                        {activeAnalysis.invalidationConditions.map((cond, idx) => (
                                            <li key={idx}>{cond}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>

                        {activeAnalysis.entityStatus === 'public_listed' &&
                            activeAnalysis.resolvedTicker &&
                            onAddTicker && (
                                <div className="pt-1 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => onAddTicker(activeAnalysis.resolvedTicker!)}
                                        className="touch-target min-h-11 px-4 py-2 rounded-full bg-surface-douce border border-bordure-champ text-xs sm:text-sm font-semibold text-texte hover:bg-bordure transition-colors focus-ring inline-flex items-center gap-2"
                                    >
                                        <Icon name="plus" size={15} />
                                        <span>Ajouter {activeAnalysis.resolvedTicker} à mon portefeuille</span>
                                    </button>
                                </div>
                            )}
                    </section>

                    {/* Accords et Désaccords du comité */}
                    {(activeAnalysis.consensus.length > 0 || activeAnalysis.disagreements.length > 0) && (
                        <section
                            aria-label="Consensus et désaccords du comité"
                            className="grid grid-cols-1 md:grid-cols-2 gap-3"
                        >
                            <div className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 space-y-2">
                                <div className="text-xs font-bold uppercase tracking-wider text-succes-texte flex items-center gap-1.5">
                                    <Icon name="check" size={14} />
                                    <span>Points d’accord entre les agents</span>
                                </div>
                                <ul className="space-y-1.5 text-xs sm:text-sm text-ink-100 list-disc pl-4">
                                    {activeAnalysis.consensus.map((pt, i) => (
                                        <li key={i}>{pt}</li>
                                    ))}
                                </ul>
                            </div>
                            <div className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 space-y-2">
                                <div className="text-xs font-bold uppercase tracking-wider text-alerte-texte flex items-center gap-1.5">
                                    <Icon name="alert" size={14} />
                                    <span>Désaccords & points de tension</span>
                                </div>
                                <ul className="space-y-1.5 text-xs sm:text-sm text-ink-100 list-disc pl-4">
                                    {activeAnalysis.disagreements.map((pt, i) => (
                                        <li key={i}>{pt}</li>
                                    ))}
                                </ul>
                            </div>
                        </section>
                    )}

                    {/* Les 4 rapports indépendants des spécialistes */}
                    <section aria-label="Rapports individuels des 4 agents" className="space-y-2.5">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-ink-300">
                            Rapports indépendants des 4 spécialistes
                        </h4>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                            {activeAnalysis.agents.map((agent) => (
                                <div
                                    key={agent.id}
                                    data-testid={`agent-card-${agent.id}`}
                                    className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 space-y-2.5"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold text-ink-50">{agent.title}</div>
                                            <div className="text-[11px] text-ink-400">{agent.role}</div>
                                        </div>
                                        <span
                                            className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-mono font-semibold ${stancePillClass(
                                                agent.stance,
                                            )}`}
                                        >
                                            {stanceLabel(agent.stance)}
                                            {agent.confidence !== null ? ` · ${agent.confidence}%` : ''}
                                        </span>
                                    </div>
                                    <p className="text-xs sm:text-sm text-ink-100 leading-relaxed">{agent.summary}</p>
                                    {agent.keyPoints.length > 0 && (
                                        <ul className="space-y-1 text-xs text-ink-200 list-disc pl-4">
                                            {agent.keyPoints.map((k, idx) => (
                                                <li key={idx}>{k}</li>
                                            ))}
                                        </ul>
                                    )}
                                    {agent.risks.length > 0 && (
                                        <div className="pt-2 border-t border-bordure text-xs text-ink-300 space-y-1">
                                            <div className="font-semibold text-ink-200">Vigilance :</div>
                                            <ul className="list-disc pl-4 space-y-0.5">
                                                {agent.risks.map((r, idx) => (
                                                    <li key={idx}>{r}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* Sources Web vérifiées */}
                    {activeAnalysis.sources.length > 0 && (
                        <section
                            aria-label="Sources Web consultées"
                            className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 space-y-2.5"
                        >
                            <div className="text-xs font-bold uppercase tracking-wider text-ink-300 flex items-center gap-1.5">
                                <Icon name="link" size={14} />
                                <span>Sources Web vérifiées</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {activeAnalysis.sources.map((src) => (
                                    <a
                                        key={src.url}
                                        href={src.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="touch-target min-h-11 inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-douce border border-bordure-champ text-xs text-ink-100 hover:bg-bordure transition-colors focus-ring"
                                    >
                                        <Icon name="globe" size={13} className="text-repere shrink-0" />
                                        <span className="truncate max-w-[220px]">{src.title}</span>
                                        <span className="text-[11px] font-mono text-ink-400 shrink-0">
                                            ({src.domain})
                                        </span>
                                    </a>
                                ))}
                            </div>
                        </section>
                    )}
                </article>
            )}

            {/* Historique chiffré IndexedDB */}
            {!isPrivacyMode && history.length > 0 && (
                <section
                    aria-label="Analyses récentes mémorisées"
                    className="gf-terminal-card bg-surface border border-bordure rounded-2xl p-4 space-y-3"
                >
                    <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-ink-300 flex items-center gap-1.5">
                            <Icon name="clock" size={14} />
                            <span>Historique récent ({history.length}) — chiffré localement</span>
                        </div>
                        <button
                            type="button"
                            onClick={() => void clearHistory()}
                            className="touch-target min-h-11 px-3 py-1.5 rounded-full bg-surface-douce border border-bordure-champ text-xs font-medium text-ink-300 hover:text-erreur-texte transition-colors focus-ring"
                        >
                            Effacer tout
                        </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {history.map((item) => {
                            const selected = activeAnalysis?.id === item.id;
                            return (
                                <div
                                    key={item.id}
                                    className={`inline-flex items-center rounded-xl border ${
                                        selected
                                            ? 'bg-surface-douce border-bordure-champ'
                                            : 'bg-fond border-bordure'
                                    }`}
                                >
                                    <button
                                        type="button"
                                        onClick={() => selectAnalysis(item.id)}
                                        className="touch-target min-h-11 px-3 py-1.5 text-left text-xs font-medium text-ink-100 hover:text-ink-50 focus-ring rounded-l-xl"
                                    >
                                        <span className="font-semibold">{item.subject}</span>
                                        <span className="text-ink-400"> · {item.verdictLabel}</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void deleteAnalysis(item.id)}
                                        aria-label={`Supprimer l’analyse ${item.subject}`}
                                        className="touch-target min-h-11 px-2.5 text-ink-400 hover:text-erreur-texte focus-ring rounded-r-xl"
                                    >
                                        <Icon name="trash" size={13} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
};
