import React, { useState, useRef, useMemo } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';
import { formatCAD } from '../../utils/format';
import { MESSAGE_IA_MODE_DISCRET } from '../../services/messageErreurIa';
import {
    extraireContextePatrimonial,
    genererSyntheseLocaleGemini,
    interrogerAssistantGemini,
    type ReponseAssistantGemini,
} from '../../services/geminiAssistant';
import { Tab } from '../../types';

interface GeminiAssistantModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
}

interface EchangeGemini {
    id: string;
    question: string;
    reponse: ReponseAssistantGemini;
    horodatage: string;
}

const QUESTIONS_RAPIDES = [
    {
        id: 'bilan',
        label: 'Bilan express',
        question: 'Fais un bilan express de mon patrimoine et de mes priorités financières.',
    },
    {
        id: 'fiscalite',
        label: 'Optimiser CELI & REER',
        question: 'Comment optimiser mon CELI, mon REER et réduire mes impôts cette année ?',
    },
    {
        id: 'budget',
        label: 'Budget & épargne',
        question: 'Analyse mon budget mensuel, mes liquidités et mon taux d’épargne.',
    },
    {
        id: 'retraite',
        label: 'Trajectoire retraite',
        question: 'Suis-je sur la bonne voie pour atteindre mon objectif de retraite ?',
    },
] as const;

export const GeminiAssistantModal: React.FC<GeminiAssistantModalProps> = ({
    isOpen,
    onClose,
    initialQuery = '',
}) => {
    const state = useFinanceStore();
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const setActiveTab = useFinanceStore((s) => s.setActiveTab);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);

    const inputRef = useRef<HTMLInputElement>(null);
    const [saisie, setSaisie] = useState(initialQuery);
    const [questionActiveId, setQuestionActiveId] = useState<string>('bilan');
    const [enChargement, setEnChargement] = useState(false);
    const [erreurDiscret, setErreurDiscret] = useState<string | null>(null);

    const contexte = useMemo(() => extraireContextePatrimonial(state), [state]);
    const syntheseInitiale = useMemo(
        () => genererSyntheseLocaleGemini(QUESTIONS_RAPIDES[0].question, contexte),
        [contexte],
    );

    const [echanges, setEchanges] = useState<EchangeGemini[]>([]);

    const cleConfiguree = Boolean(
        state.apiKeys?.anthropic?.trim() ||
            (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim(),
    );

    const soumettreQuestion = async (texteQuestion: string, idPuce?: string) => {
        const q = texteQuestion.trim();
        if (!q || enChargement) return;
        if (idPuce) setQuestionActiveId(idPuce);

        if (isPrivacyMode) {
            setErreurDiscret(MESSAGE_IA_MODE_DISCRET);
            return;
        }
        setErreurDiscret(null);
        setEnChargement(true);
        try {
            const rep = await interrogerAssistantGemini(q, state, isPrivacyMode);
            const heure = new Date().toLocaleTimeString('fr-CA', {
                hour: '2-digit',
                minute: '2-digit',
            });
            setEchanges((prev) => [
                ...prev,
                {
                    id: `${Date.now()}-${prev.length}`,
                    question: q,
                    reponse: rep,
                    horodatage: heure,
                },
            ]);
            setSaisie('');
        } catch (err) {
            setErreurDiscret(err instanceof Error ? err.message : MESSAGE_IA_MODE_DISCRET);
        } finally {
            setEnChargement(false);
        }
    };

    const dernierEchange = echanges[echanges.length - 1];
    const reponseAffichee = dernierEchange ? dernierEchange.reponse : syntheseInitiale;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            initialFocusRef={inputRef}
            icon={<Icon name="sparkles" size={22} className="text-repere shrink-0" />}
            title="Gemini · Conseiller patrimonial"
            subtitle="Propulsé par Google Gemini 3.8 Flash · Analyse instantanée de ton dossier"
        >
            <div className="space-y-4">
                {/* En-tête d'état Gemini + KPI rapides du dossier */}
                <div className="rounded-2xl bg-surface-douce border border-bordure p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex items-center gap-1" aria-hidden="true">
                            <span className="w-2 h-2 rounded-full bg-repere" />
                            <span className="w-2 h-2 rounded-full bg-erreur-texte" />
                            <span className="w-2 h-2 rounded-full bg-alerte-texte" />
                            <span className="w-2 h-2 rounded-full bg-succes-texte" />
                        </span>
                        <span className="text-xs font-semibold text-ink-100">
                            {cleConfiguree
                                ? 'Gemini 3.8 Flash actif (clé connectée)'
                                : 'Gemini Flash · Mode synthèse instantanée locale'}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2.5 py-1 rounded-full bg-surface border border-bordure text-ink-200 font-mono">
                            Valeur nette : <PrivateAmount>{formatCAD(contexte.patrimoineNet)}</PrivateAmount>
                        </span>
                        <span className="px-2.5 py-1 rounded-full bg-surface border border-bordure text-ink-200 font-mono">
                            Épargne : <PrivateAmount>{`${formatCAD(contexte.epargneMensuelle)}/mois`}</PrivateAmount>
                        </span>
                        {!cleConfiguree && (
                            <button
                                type="button"
                                onClick={() => {
                                    onClose();
                                    navigateWithFocus(Tab.SETTINGS, 'apiKeys-anthropic');
                                }}
                                className="touch-target px-3 py-1 rounded-full bg-repere-fond text-repere border border-bordure-lien font-semibold hover:opacity-90 transition-opacity focus-ring"
                            >
                                Connecter ma clé Gemini →
                            </button>
                        )}
                    </div>
                </div>

                {/* Puces de questions rapides style Google Search */}
                <div
                    role="group"
                    aria-label="Analyses rapides Gemini"
                    className="flex flex-wrap items-center gap-1.5"
                >
                    {QUESTIONS_RAPIDES.map((item) => {
                        const actif = questionActiveId === item.id;
                        return (
                            <button
                                key={item.id}
                                type="button"
                                aria-pressed={actif}
                                onClick={() => {
                                    void soumettreQuestion(item.question, item.id);
                                }}
                                className={`touch-target px-3 py-1.5 rounded-full text-xs font-medium transition-all focus-ring inline-flex items-center gap-1.5 ${
                                    actif
                                        ? 'bg-repere-fond text-repere border border-bordure-lien font-semibold'
                                        : 'bg-surface-douce text-ink-200 border border-bordure hover:text-ink-50'
                                }`}
                            >
                                <Icon name="sparkles" size={13} className="text-repere" aria-hidden="true" />
                                <span>{item.label}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Alerte Mode Discret si actif */}
                {erreurDiscret && (
                    <div
                        role="alert"
                        className="rounded-xl bg-surface-douce border border-bordure p-3 text-xs text-alerte-texte flex items-center gap-2"
                    >
                        <Icon name="eye-off" size={15} className="shrink-0" aria-hidden="true" />
                        <span>{erreurDiscret}</span>
                    </div>
                )}

                {/* Carte de réponse structurée Gemini (Aperçu IA style Google) */}
                {!isPrivacyMode && (
                    <section
                        aria-label="Réponse de l'assistant Gemini"
                        aria-live="polite"
                        className="rounded-2xl bg-fond border border-bordure p-4 space-y-3"
                    >
                        {dernierEchange && (
                            <div className="flex items-center justify-between gap-2 pb-2 border-b border-bordure text-xs text-ink-300">
                                <span className="font-medium text-ink-100 truncate">
                                    « {dernierEchange.question} »
                                </span>
                                <span className="font-mono text-[11px] text-ink-400 shrink-0">
                                    {dernierEchange.horodatage}
                                </span>
                            </div>
                        )}

                        <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 w-6 h-6 rounded-full bg-repere-fond border border-bordure-lien inline-flex items-center justify-center shrink-0">
                                <Icon name="sparkles" size={13} className="text-repere" aria-hidden="true" />
                            </span>
                            <p className="text-xs sm:text-sm text-ink-100 leading-relaxed font-medium">
                                {enChargement ? 'Gemini analyse tes comptes et ta trajectoire…' : reponseAffichee.texte}
                            </p>
                        </div>

                        <ul className="space-y-1.5 pl-8">
                            {reponseAffichee.pointsCles.map((pt, idx) => (
                                <li
                                    key={idx}
                                    className="text-xs text-ink-200 leading-relaxed flex items-start gap-2"
                                >
                                    <span className="text-repere font-bold shrink-0" aria-hidden="true">
                                        •
                                    </span>
                                    <span>{pt}</span>
                                </li>
                            ))}
                        </ul>

                        {/* Actions directes vers les modules de l'application */}
                        {reponseAffichee.actionsSuggerees.length > 0 && (
                            <div className="pt-2 border-t border-bordure flex flex-wrap items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                                    Actions directes :
                                </span>
                                {reponseAffichee.actionsSuggerees.map((act) => (
                                    <button
                                        key={`${act.tab}-${act.label}`}
                                        type="button"
                                        onClick={() => {
                                            setActiveTab(act.tab);
                                            onClose();
                                        }}
                                        className="touch-target px-3 py-1 rounded-full text-xs font-semibold gf-delta-neutral hover:opacity-90 transition-opacity focus-ring inline-flex items-center gap-1"
                                    >
                                        <span>{act.label}</span>
                                        <span aria-hidden="true">↗</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>
                )}

                {/* Barre de saisie style Omnibox Gemini */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        void soumettreQuestion(saisie);
                    }}
                    className="flex items-center gap-2 pt-1"
                >
                    <div className="relative flex-1">
                        <Icon
                            name="sparkles"
                            size={15}
                            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-repere pointer-events-none"
                            aria-hidden="true"
                        />
                        <input
                            ref={inputRef}
                            type="text"
                            value={saisie}
                            onChange={(e) => setSaisie(e.target.value)}
                            placeholder="Pose une question à Gemini (ex. combien cotiser au REER, budget, retraite…)"
                            aria-label="Poser une question financière à Gemini"
                            className="touch-target w-full pl-10 pr-4 rounded-full bg-fond border border-bordure text-xs sm:text-sm text-ink-50 placeholder-ink-400 focus-ring"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={enChargement || !saisie.trim()}
                        aria-label="Envoyer la question à Gemini"
                        className="touch-target px-4 rounded-full bg-repere-fond text-repere border border-bordure-lien text-xs sm:text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity focus-ring inline-flex items-center gap-1.5 shrink-0"
                    >
                        <Icon name="send" size={14} aria-hidden="true" />
                        <span>Demander</span>
                    </button>
                </form>
            </div>
        </Modal>
    );
};
