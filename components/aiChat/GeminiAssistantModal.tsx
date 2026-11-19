// components/aiChat/GeminiAssistantModal.tsx
//
// Panneau conversationnel de l'assistant Gemini (style Google) : barre latérale d'historique
// (Cloud Firestore si connecté, sinon local), fil de messages avec blocs riches, pastille
// « Modifié : … · Annuler » pour chaque tour qui a écrit dans l'app, composeur `.gf-chat-composer`.
// La logique vit dans `services/assistant/` (boucle agentique, registre d'actions, journal) ;
// ce composant ne fait qu'orchestrer et afficher.
// Mode discret : aucun appel au modèle, et le fil (qui contient des montants en texte libre) n'est
// pas rendu — même règle que l'ancienne carte de réponse.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { useFinanceStore } from '../../store/useFinanceStore';
import { saveApiKeys } from '../../services/secureKeyStore';
import { MESSAGE_IA_MODE_DISCRET, causeErreurIa, messageErreurIa } from '../../services/messageErreurIa';
import {
    cleGemini,
    decouperAvisHonnete,
    extraireContextePatrimonial,
    genererAvisHonneteDossier,
    type ContextePatrimonialGemini,
} from '../../services/geminiAssistant';
import { MODEL_IDS, resolveChatModelKey } from '../../services/aiChat/models';
import { executerTour, executerTourLocal } from '../../services/assistant/agentLoop';
import { creerClientGemini } from '../../services/assistant/clientGemini';
import { annulerGroupe, annulationDisponible } from '../../services/assistant/journalModifications';
import {
    choisirDepot,
    nouvelleConversation,
    titreDepuisQuestion,
    normaliserTitre,
    type DepotConversations,
} from '../../services/assistant/conversations';
import type { Conversation, MessageConversation, ResumeConversation } from '../../services/assistant/types';
import { Tab } from '../../types';
import { BlocRicheVue } from './BlocRicheVue';

interface GeminiAssistantModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialQuery?: string;
    /** Tests : dépôt d'historique injecté (sinon Firestore si connecté, local sinon). */
    depotInjecte?: DepotConversations;
}

const QUESTIONS_RAPIDES = [
    { id: 'bilan', label: 'Bilan express', question: 'Fais un bilan express de mon patrimoine et de mes priorités financières.' },
    { id: 'opportunite', label: 'Analyser Anthropic / titre', question: 'Est-ce que ça vaut le coup d’acheter Anthropic ?' },
    { id: 'plan', label: 'Plan Jour → Décennie', question: 'Donne-moi mon plan d’action clair par jour, semaine, mois, année et décennie.' },
    { id: 'fiscalite', label: 'Optimiser CELI & REER', question: 'Comment optimiser mon CELI, mon REER et réduire mes impôts cette année ?' },
    { id: 'budget', label: 'Transactions & Budget', question: 'Analyse mon budget mensuel, mes transactions d’octobre et novembre et mon épargne.' },
    { id: 'retraite', label: 'Trajectoire retraite', question: 'Suis-je sur la bonne voie pour atteindre mon objectif de retraite ?' },
] as const;

const LIBELLES_ONGLETS: Partial<Record<Tab, string>> = {
    [Tab.DASHBOARD]: 'Accueil', [Tab.TRANSACTIONS]: 'Transactions', [Tab.BUDGET]: 'Budget', [Tab.DEBT]: 'Dettes',
    [Tab.INVESTMENTS]: 'Placements', [Tab.FUTURE]: 'Futur', [Tab.REAL_ESTATE]: 'Immobilier',
    [Tab.REAL_ESTATE_PROJECTS]: 'Projets immobiliers', [Tab.CHILD]: 'Enfant', [Tab.TRAVEL]: 'Voyages',
    [Tab.LIFE_EVENTS]: 'Événements de vie', [Tab.LIFE_PROJECTS]: 'Projets de vie', [Tab.RETIREMENT]: 'Retraite',
    [Tab.TAX]: 'Impôts', [Tab.SETTINGS]: 'Réglages', [Tab.PROFILE]: 'Profil',
};

const nouvelId = (): string => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const heure = (iso: string): string => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit' });
};
const estAnnulation = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError'
    || (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError');

export const GeminiAssistantModal: React.FC<GeminiAssistantModalProps> = ({ isOpen, onClose, initialQuery = '', depotInjecte }) => {
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const isTestMode = useFinanceStore((s) => s.isTestMode);
    const aiChatModel = useFinanceStore((s) => s.aiChatModel);
    const apiKeyGemini = useFinanceStore((s) => cleGemini(s));
    const updateApiKeys = useFinanceStore((s) => s.updateApiKeys);
    const setAppState = useFinanceStore((s) => s.setAppState);
    const setActiveTab = useFinanceStore((s) => s.setActiveTab);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);

    const inputRef = useRef<HTMLTextAreaElement>(null);
    const filRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<AbortController | null>(null);
    const derniereRequeteAutoRef = useRef<string>('');
    const [depot, setDepot] = useState<DepotConversations | null>(depotInjecte ?? null);
    const [resumes, setResumes] = useState<ResumeConversation[]>([]);
    const [conversation, setConversation] = useState<Conversation>(() => nouvelleConversation());
    const [saisie, setSaisie] = useState(initialQuery);
    const [saisieCle, setSaisieCle] = useState('');
    const [panneauCleOuvert, setPanneauCleOuvert] = useState(false);
    const [cleSauvegardeeMsg, setCleSauvegardeeMsg] = useState<string | null>(null);
    const [enCours, setEnCours] = useState(false);
    const [etape, setEtape] = useState<string | null>(null);
    const [alerte, setAlerte] = useState<string | null>(null);
    const [edition, setEdition] = useState<{ id: string; titre: string } | null>(null);
    const [suppressionId, setSuppressionId] = useState<string | null>(null);

    const modeleCle = resolveChatModelKey(aiChatModel) === 'opus' ? 'opus' : 'sonnet';
    const cleConfiguree = apiKeyGemini.length > 0;
    const ctxDossier = useMemo(
        () => extraireContextePatrimonial(useFinanceStore.getState()),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [isOpen, conversation.messages.length, isTestMode],
    );
    const avisDossierInitial = useMemo(() => genererAvisHonneteDossier(ctxDossier), [ctxDossier]);

    const enregistrerCleDirecte = async (e: React.FormEvent) => {
        e.preventDefault();
        const propre = saisieCle.replace(/^["'\s]+|["'\s]+$/g, '');
        if (!propre) return;
        updateApiKeys({ gemini: propre });
        try {
            await saveApiKeys(useFinanceStore.getState().apiKeys);
        } catch {
            // La clé reste active en mémoire pour la session courante.
        }
        setSaisieCle('');
        setPanneauCleOuvert(false);
        setAlerte(null);
        setCleSauvegardeeMsg('Clé API Gemini enregistrée et activée (Gemini 3.8 Flash / 4 Argon prêt).');
    };

    const rafraichirListe = useCallback(async (d: DepotConversations | null) => {
        if (!d) return;
        try { setResumes(await d.lister()); } catch { setAlerte('Historique des conversations indisponible pour le moment.'); }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        let actif = true;
        void (async () => {
            const d = depotInjecte ?? await choisirDepot({ donneesFictives: isTestMode });
            if (!actif) return;
            setDepot(d);
            await rafraichirListe(d);
        })();
        return () => { actif = false; };
    }, [isOpen, isTestMode, depotInjecte, rafraichirListe]);

    useEffect(() => () => controllerRef.current?.abort(), []);

    const enregistrer = useCallback(async (c: Conversation) => {
        if (!depot || c.messages.length === 0) return c;
        try {
            await depot.enregistrer(c);
            const sauvee = { ...c, persistee: true };
            await rafraichirListe(depot);
            return sauvee;
        } catch {
            setAlerte('La conversation n’a pas pu être enregistrée dans l’historique.');
            return c;
        }
    }, [depot, rafraichirListe]);

    const envoyer = async (texte: string) => {
        const question = texte.trim();
        if (!question || enCours) return;
        if (isPrivacyMode) { setAlerte(MESSAGE_IA_MODE_DISCRET); return; }
        setAlerte(null);
        const msgUtilisateur: MessageConversation = { id: nouvelId(), role: 'utilisateur', texte: question, horodatage: new Date().toISOString() };
        const base: Conversation = {
            ...conversation,
            titre: conversation.messages.length === 0 ? titreDepuisQuestion(question) : conversation.titre,
            messages: [...conversation.messages, msgUtilisateur],
        };
        setConversation(base);
        setSaisie('');

        if (!cleConfiguree) {
            const tourLocal = await executerTourLocal(question, isPrivacyMode);
            const msgLocal: MessageConversation = {
                id: nouvelId(),
                role: 'assistant',
                texte: tourLocal.texte,
                horodatage: new Date().toISOString(),
                ...(tourLocal.blocs.length ? { blocs: tourLocal.blocs } : {}),
                ...(tourLocal.navigation.length ? { navigation: tourLocal.navigation } : {}),
                ...(tourLocal.etapes.length ? { etapes: tourLocal.etapes } : {}),
            };
            const convLocale = { ...base, messages: [...base.messages, msgLocal], misAJourLe: new Date().toISOString() };
            setConversation(convLocale);
            setConversation(await enregistrer(convLocale));
            return;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        setEnCours(true);
        let reponse: MessageConversation;
        try {
            const tour = await executerTour({
                client: creerClientGemini(apiKeyGemini),
                modele: MODEL_IDS[modeleCle],
                historique: conversation.messages,
                question,
                isPrivacyMode,
                signal: controller.signal,
                onEtape: (nom) => setEtape(nom),
            });
            reponse = {
                id: nouvelId(), role: 'assistant', texte: tour.texte, horodatage: new Date().toISOString(),
                ...(tour.blocs.length ? { blocs: tour.blocs } : {}),
                ...(tour.modifications.length ? { modifications: tour.modifications } : {}),
                ...(tour.navigation.length ? { navigation: tour.navigation } : {}),
                ...(tour.etapes.length ? { etapes: tour.etapes } : {}),
            };
        } catch (err) {
            if (estAnnulation(err) || controller.signal.aborted) {
                reponse = { id: nouvelId(), role: 'assistant', texte: 'Réponse interrompue.', erreur: true, horodatage: new Date().toISOString() };
            } else {
                const cause = causeErreurIa(err);
                const msgDiag = messageErreurIa(err) ?? `Service distant indisponible (${err instanceof Error ? err.message : String(err)})`;
                if (cause === 'cle-refusee') {
                    setPanneauCleOuvert(true);
                }
                setAlerte(msgDiag);
                const tourSecours = await executerTourLocal(question, isPrivacyMode);
                reponse = {
                    id: nouvelId(),
                    role: 'assistant',
                    texte: `${tourSecours.texte}\n\n(Synthèse locale immédiate — ${msgDiag})`,
                    horodatage: new Date().toISOString(),
                    ...(tourSecours.blocs.length ? { blocs: tourSecours.blocs } : {}),
                    ...(tourSecours.navigation.length ? { navigation: tourSecours.navigation } : {}),
                    ...(tourSecours.etapes.length ? { etapes: tourSecours.etapes } : {}),
                };
            }
        } finally {
            setEnCours(false);
            setEtape(null);
            controllerRef.current = null;
        }
        const finale = { ...base, messages: [...base.messages, reponse], misAJourLe: new Date().toISOString() };
        setConversation(finale);
        setConversation(await enregistrer(finale));
    };

    useEffect(() => {
        if (!isOpen) {
            derniereRequeteAutoRef.current = '';
            return;
        }
        const q = initialQuery.trim();
        if (q && derniereRequeteAutoRef.current !== q) {
            derniereRequeteAutoRef.current = q;
            void envoyer(q);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialQuery]);

    useEffect(() => {
        const el = filRef.current;
        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }, [conversation.messages.length, enCours]);

    const annuler = async (message: MessageConversation) => {
        const ids = (message.modifications ?? []).map((m) => m.id);
        const res = annulerGroupe(ids);
        if (!res.ok) { setAlerte(res.raison); return; }
        const maj = { ...conversation, messages: conversation.messages.map((m) => (m.id === message.id ? { ...m, annulee: true } : m)) };
        setConversation(maj);
        setConversation(await enregistrer(maj));
    };

    const ouvrir = async (id: string) => {
        if (!depot || enCours) return;
        try {
            const c = await depot.charger(id);
            if (c) { setConversation(c); setAlerte(null); }
        } catch {
            setAlerte('Impossible de rouvrir cette conversation pour le moment.');
        }
    };

    const renommer = async () => {
        if (!depot || !edition) return;
        const titre = normaliserTitre(edition.titre);
        try {
            await depot.renommer(edition.id, titre);
            if (conversation.id === edition.id) setConversation({ ...conversation, titre });
            await rafraichirListe(depot);
        } catch {
            setAlerte('Le renommage a échoué.');
        }
        setEdition(null);
    };

    const supprimer = async (id: string) => {
        if (!depot) return;
        try {
            await depot.supprimer(id);
            if (conversation.id === id) setConversation(nouvelleConversation());
            await rafraichirListe(depot);
        } catch {
            setAlerte('La suppression a échoué.');
        }
        setSuppressionId(null);
    };

    const ouvrirOnglet = (onglet: Tab) => { setActiveTab(onglet); onClose(); };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="full"
            initialFocusRef={inputRef}
            icon={
                <span className="w-8 h-8 rounded-full bg-surface-douce border border-bordure inline-flex items-center justify-center shrink-0">
                    <Icon name="sparkles" size={16} className="text-repere shrink-0" />
                </span>
            }
            title="Assistant financier"
            subtitle="Lit et modifie tes données sur demande · chaque modification est annulable"
        >
            <div data-testid="assistant-panneau" className="flex flex-col md:flex-row gap-3 md:gap-4 h-[min(60vh,480px)] max-h-[calc(100dvh-9.5rem)] min-h-[260px] overflow-hidden">
                {/* Barre latérale : historique des conversations */}
                <aside data-testid="assistant-historique" aria-label="Historique des conversations" className="md:w-56 shrink-0 flex flex-col gap-1.5 max-h-28 md:max-h-full overflow-hidden">
                    <button
                        type="button"
                        data-testid="assistant-nouvelle-conversation"
                        onClick={() => { if (!enCours) { setConversation(nouvelleConversation()); setAlerte(null); } }}
                        disabled={enCours}
                        className="touch-target w-full px-3 rounded-xl bg-surface-douce hover:bg-bordure border border-bordure-champ text-ink-50 text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 focus-ring shrink-0"
                    >
                        <Icon name="plus" size={14} aria-hidden="true" />
                        <span>Nouvelle conversation</span>
                    </button>
                    <p className="text-[11px] text-ink-400 px-1 shrink-0">
                        {depot?.genre === 'firestore' ? 'Historique synchronisé (Cloud Firestore)' : 'Historique sur cet appareil'}
                    </p>
                    <ul className="space-y-1 flex-1 min-h-0 overflow-y-auto">
                        {resumes.map((r) => {
                            const actif = r.id === conversation.id;
                            return (
                                <li key={r.id} className={`rounded-xl border ${actif ? 'border-bordure-lien bg-repere-fond' : 'border-bordure bg-surface-douce'}`}>
                                    {edition?.id === r.id ? (
                                        <form className="flex items-center gap-1 p-1" onSubmit={(e) => { e.preventDefault(); void renommer(); }}>
                                            <input
                                                value={edition.titre}
                                                onChange={(e) => setEdition({ id: r.id, titre: e.target.value })}
                                                maxLength={200}
                                                aria-label="Nouveau titre de la conversation"
                                                className="touch-target flex-1 min-w-0 px-2 rounded-lg bg-fond border border-bordure text-xs text-ink-50 focus-ring"
                                            />
                                            <button type="submit" aria-label="Enregistrer le titre" className="touch-target px-2 rounded-lg text-repere focus-ring">
                                                <Icon name="check" size={14} aria-hidden="true" />
                                            </button>
                                        </form>
                                    ) : (
                                        <div className="flex items-center gap-0.5">
                                            <button
                                                type="button"
                                                aria-pressed={actif}
                                                onClick={() => { void ouvrir(r.id); }}
                                                className="touch-target flex-1 min-w-0 text-left px-2.5 text-xs text-ink-100 truncate focus-ring rounded-xl"
                                                title={r.titre}
                                            >
                                                {r.titre}
                                            </button>
                                            <button
                                                type="button"
                                                aria-label={`Renommer « ${r.titre} »`}
                                                onClick={() => setEdition({ id: r.id, titre: r.titre })}
                                                className="touch-target px-1.5 text-ink-300 hover:text-ink-50 focus-ring rounded-lg"
                                            >
                                                <Icon name="edit" size={13} aria-hidden="true" />
                                            </button>
                                            {suppressionId === r.id ? (
                                                <button
                                                    type="button"
                                                    aria-label={`Confirmer la suppression de « ${r.titre} »`}
                                                    onClick={() => { void supprimer(r.id); }}
                                                    className="touch-target px-2 text-[11px] font-semibold text-erreur-texte focus-ring rounded-lg"
                                                >
                                                    Confirmer
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    aria-label={`Supprimer « ${r.titre} »`}
                                                    onClick={() => setSuppressionId(r.id)}
                                                    className="touch-target px-1.5 text-ink-300 hover:text-erreur-texte focus-ring rounded-lg"
                                                >
                                                    <Icon name="trash" size={13} aria-hidden="true" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </aside>

                {/* Fil + composeur */}
                <section className="flex-1 min-w-0 flex flex-col gap-2.5 h-full min-h-0 overflow-hidden" aria-label="Conversation avec Gemini">
                    <div className="flex flex-wrap items-center justify-between gap-2 shrink-0">
                        <h3 className="text-sm font-semibold text-ink-50 truncate">{conversation.titre}</h3>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <button
                                type="button"
                                aria-pressed={panneauCleOuvert}
                                onClick={() => { setPanneauCleOuvert((v) => !v); setCleSauvegardeeMsg(null); }}
                                className={`touch-target px-2.5 rounded-full text-[11px] font-semibold border focus-ring inline-flex items-center gap-1 ${
                                    cleConfiguree ? 'bg-surface-douce text-ink-200 border-bordure' : 'bg-repere-fond text-repere border-bordure-lien'
                                }`}
                            >
                                <Icon name="link" size={12} aria-hidden="true" />
                                <span>{cleConfiguree ? 'Clé API active' : 'Entrer ma clé API'}</span>
                            </button>
                            <div role="group" aria-label="Modèle Gemini" className="inline-flex items-center gap-1">
                                {(['sonnet', 'opus'] as const).map((cle) => (
                                    <button
                                        key={cle}
                                        type="button"
                                        aria-pressed={modeleCle === cle}
                                        onClick={() => setAppState({ aiChatModel: cle })}
                                        className={`touch-target px-3 rounded-full text-[11px] font-semibold border focus-ring ${modeleCle === cle ? 'bg-repere-fond text-repere border-bordure-lien' : 'bg-surface-douce text-ink-200 border-bordure'}`}
                                    >
                                        {cle === 'sonnet' ? '3.8 Flash' : '4 Argon'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {(!cleConfiguree || panneauCleOuvert) && (
                        <form
                            onSubmit={(e) => { void enregistrerCleDirecte(e); }}
                            className="rounded-xl bg-surface-douce border border-bordure p-2.5 text-xs text-ink-200 space-y-2 shrink-0"
                        >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span>
                                    {cleConfiguree
                                        ? 'Remplacer ta clé Google AI Studio (chiffrée AES-256-GCM sur cet appareil) :'
                                        : 'Colle ta clé Google AI Studio (AIza…) ici pour activer Gemini 3.8 Flash / 4 Argon en direct :'}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <a
                                        href="https://aistudio.google.com/apikey"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="touch-target px-2.5 rounded-full bg-fond border border-bordure text-[11px] text-repere hover:underline inline-flex items-center gap-1 focus-ring"
                                    >
                                        <span>Obtenir une clé AI Studio</span>
                                        <span aria-hidden="true">↗</span>
                                    </a>
                                    <button
                                        type="button"
                                        onClick={() => { onClose(); navigateWithFocus(Tab.SETTINGS, 'apiKeys-gemini'); }}
                                        className="touch-target px-2.5 rounded-full bg-fond text-ink-200 border border-bordure text-[11px] font-medium hover:text-ink-50 focus-ring"
                                    >
                                        Réglages →
                                    </button>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="password"
                                    value={saisieCle}
                                    onChange={(e) => setSaisieCle(e.target.value)}
                                    placeholder="AIzaSy..."
                                    aria-label="Clé API Google Gemini"
                                    className="touch-target flex-1 min-w-0 rounded-lg bg-fond border border-bordure px-3 text-xs text-ink-50 placeholder-ink-400 focus-ring font-mono"
                                />
                                <button
                                    type="submit"
                                    disabled={!saisieCle.trim()}
                                    className="touch-target px-3.5 rounded-full bg-repere-fond text-repere border border-bordure-lien text-xs font-semibold hover:opacity-90 disabled:opacity-50 focus-ring shrink-0"
                                >
                                    Enregistrer la clé
                                </button>
                            </div>
                        </form>
                    )}

                    {cleSauvegardeeMsg && (
                        <div role="status" className="rounded-xl bg-surface-douce border border-bordure px-3 py-2 text-xs text-succes-texte flex items-center justify-between gap-2 shrink-0">
                            <span>{cleSauvegardeeMsg}</span>
                            <button
                                type="button"
                                onClick={() => setCleSauvegardeeMsg(null)}
                                aria-label="Fermer la confirmation"
                                className="touch-target px-2 text-ink-300 hover:text-ink-50 focus-ring rounded-lg"
                            >
                                ×
                            </button>
                        </div>
                    )}

                    {(alerte || isPrivacyMode) && (
                        <div role="alert" className="rounded-xl bg-surface-douce border border-bordure px-3 py-2 text-xs text-alerte-texte flex items-center gap-2 shrink-0">
                            <Icon name={isPrivacyMode ? 'eye-off' : 'alert'} size={15} className="shrink-0" aria-hidden="true" />
                            <span>{isPrivacyMode ? MESSAGE_IA_MODE_DISCRET : alerte}</span>
                        </div>
                    )}

                    {!isPrivacyMode && (
                        <div ref={filRef} data-testid="assistant-fil" aria-live="polite" className="flex-1 min-h-0 rounded-2xl bg-fond border border-bordure p-3 sm:p-4 space-y-3 overflow-y-auto">
                            {conversation.messages.length === 0 && (
                                <div className="space-y-3">
                                    <div
                                        data-testid="assistant-avis-honnete-dossier"
                                        className="rounded-xl bg-surface-douce border border-bordure px-3.5 py-2.5 space-y-1"
                                    >
                                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">
                                            <Icon name="sparkles" size={13} className="text-repere shrink-0" aria-hidden="true" />
                                            <span>Synthèse du dossier</span>
                                        </div>
                                        <p className="text-xs sm:text-sm text-ink-100 leading-relaxed">
                                            {avisDossierInitial}
                                        </p>
                                    </div>
                                    <p className="text-xs text-ink-300">
                                        Pose une question, demande ton plan d’action (jour, semaine, mois, année, décennie) ou une modification (« ajoute une dette », « monte mon budget épicerie »). Tout changement est annulable d’un clic.
                                    </p>
                                    <div role="group" aria-label="Questions rapides" className="flex flex-wrap gap-1.5">
                                        {QUESTIONS_RAPIDES.map((q) => (
                                            <button
                                                key={q.id}
                                                type="button"
                                                onClick={() => { void envoyer(q.question); }}
                                                className="touch-target px-3 rounded-full text-xs font-medium bg-surface-douce text-ink-200 border border-bordure hover:text-ink-50 focus-ring inline-flex items-center gap-1.5"
                                            >
                                                <Icon name="sparkles" size={13} className="text-repere" aria-hidden="true" />
                                                <span>{q.label}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {conversation.messages.map((m) => (
                                <MessageVue key={m.id} message={m} ctxDossier={ctxDossier} onAnnuler={annuler} onOuvrirOnglet={ouvrirOnglet} />
                            ))}
                            {enCours && (
                                <div className="rounded-xl bg-surface-douce border border-bordure px-3.5 py-2.5 text-xs text-ink-200 flex items-center gap-2.5" data-testid="assistant-en-cours">
                                    <Icon name="sparkles" size={14} className="text-repere animate-spin shrink-0" aria-hidden="true" />
                                    <span className="font-medium">
                                        {etape === 'analyser_opportunite_placement'
                                            ? 'Comité multi-agents en cours (4 analystes + synthèse)…'
                                            : etape
                                              ? `Gemini utilise : ${etape.replace(/_/g, ' ')}…`
                                              : 'Gemini réfléchit…'}
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    <form
                        data-testid="assistant-composeur"
                        onSubmit={(e) => { e.preventDefault(); void envoyer(saisie); }}
                        className={`gf-chat-composer p-2 flex items-end gap-2 shrink-0 ${enCours ? 'gemini-rainbow-active' : ''}`}
                    >
                        <textarea
                            ref={inputRef}
                            value={saisie}
                            rows={1}
                            onChange={(e) => setSaisie(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void envoyer(saisie); }
                            }}
                            placeholder="Demande à Gemini : plan d’action, graphique, transactions d’octobre/novembre ou modification…"
                            aria-label="Message pour Gemini"
                            className="touch-target flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink-50 placeholder-ink-400 focus-ring rounded-lg"
                        />
                        {enCours ? (
                            <button
                                type="button"
                                data-testid="assistant-arreter"
                                onClick={() => controllerRef.current?.abort()}
                                aria-label="Arrêter la réponse"
                                className="touch-target px-4 rounded-full bg-surface-douce text-ink-100 border border-bordure text-xs font-semibold focus-ring shrink-0"
                            >
                                Arrêter
                            </button>
                        ) : (
                            <button
                                type="submit"
                                data-testid="assistant-envoyer"
                                disabled={!saisie.trim() || isPrivacyMode}
                                aria-label="Envoyer le message à Gemini"
                                className="touch-target gf-send-circle px-4 text-xs font-semibold disabled:opacity-50 focus-ring inline-flex items-center gap-1.5 shrink-0"
                            >
                                <Icon name="send" size={14} aria-hidden="true" />
                                <span>Envoyer</span>
                            </button>
                        )}
                    </form>
                </section>
            </div>
        </Modal>
    );
};

const MessageVue: React.FC<{
    message: MessageConversation;
    ctxDossier: ContextePatrimonialGemini;
    onAnnuler: (m: MessageConversation) => void;
    onOuvrirOnglet: (t: Tab) => void;
}> = ({ message, ctxDossier, onAnnuler, onOuvrirOnglet }) => {
    if (message.role === 'utilisateur') {
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-repere-fond border border-bordure-lien px-3 py-2 text-sm text-ink-50 whitespace-pre-wrap">
                    {message.texte}
                </div>
            </div>
        );
    }
    const mods = message.modifications ?? [];
    const ids = mods.map((m) => m.id);
    const annulable = !message.annulee && annulationDisponible(ids);
    const { avis, detail } = message.erreur
        ? { avis: null, detail: message.texte }
        : decouperAvisHonnete(message.texte, ctxDossier);
    return (
        <div className="flex items-start gap-2.5" data-testid="assistant-message">
            <span className="mt-0.5 w-6 h-6 rounded-full bg-surface-douce border border-bordure inline-flex items-center justify-center shrink-0">
                <Icon name="sparkles" size={12} className="text-repere" aria-hidden="true" />
            </span>
            <div className="flex-1 min-w-0 space-y-2.5">
                {avis && (
                    <div
                        data-testid="assistant-avis-honnete"
                        className="rounded-xl bg-surface-douce border border-bordure px-3.5 py-2.5 space-y-1"
                    >
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-300">
                            <Icon name="sparkles" size={12} className="text-repere shrink-0" aria-hidden="true" />
                            <span>En bref</span>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-ink-50 leading-relaxed whitespace-pre-wrap">
                            {avis}
                        </p>
                    </div>
                )}
                {detail && (
                    <div className="space-y-1">
                        {avis && (
                            <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                                Détail &amp; analyse
                            </span>
                        )}
                        <p className={`text-sm leading-relaxed whitespace-pre-wrap ${message.erreur ? 'text-alerte-texte' : 'text-ink-100'}`}>
                            {detail}
                        </p>
                    </div>
                )}
                {(message.blocs ?? []).map((b, i) => (
                    <div key={i} className="rounded-xl border border-bordure bg-surface p-3">
                        <BlocRicheVue bloc={b} />
                    </div>
                ))}
                {mods.length > 0 && (
                    <div data-testid="assistant-pastille-modification" className="inline-flex flex-wrap items-center gap-2 rounded-full border border-bordure bg-surface-douce px-3 py-1 text-[11px] text-ink-200">
                        <Icon name="edit" size={12} aria-hidden="true" />
                        <span>{message.annulee ? 'Annulé : ' : 'Modifié : '}{mods.map((m) => m.resume).join(' · ')}</span>
                        {!message.annulee && (
                            <button
                                type="button"
                                data-testid="assistant-annuler"
                                disabled={!annulable}
                                onClick={() => onAnnuler(message)}
                                className="touch-target px-2 font-semibold text-repere disabled:opacity-50 focus-ring rounded-full"
                                title={annulable ? 'Restaurer l’état d’avant cette modification' : 'Annulation expirée (session précédente)'}
                            >
                                {annulable ? 'Annuler' : 'Annulation expirée'}
                            </button>
                        )}
                    </div>
                )}
                {(message.navigation ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                        {[...new Set(message.navigation)].map((t) => (
                            <button
                                key={t}
                                type="button"
                                onClick={() => onOuvrirOnglet(t)}
                                className="touch-target px-3 rounded-full text-xs font-semibold gf-delta-neutral hover:opacity-90 focus-ring inline-flex items-center gap-1"
                            >
                                <span>Ouvrir : {LIBELLES_ONGLETS[t] ?? t}</span>
                                <span aria-hidden="true">↗</span>
                            </button>
                        ))}
                    </div>
                )}
                <span className="block font-mono text-[11px] text-ink-400">{heure(message.horodatage)}</span>
            </div>
        </div>
    );
};
