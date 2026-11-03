// services/assistant/types.ts
//
// Modèle d'une conversation de l'assistant (sérialisable JSON — persisté dans Cloud Firestore
// `workspaces/{uid}/conversations/{id}.messagesJson`, ou en local hors connexion).

import type { Tab } from '../../types';
import type { BlocRiche } from './blocsRiches';
import type { EntreeJournal } from './journalModifications';

export interface MessageConversation {
    id: string;
    role: 'utilisateur' | 'assistant';
    texte: string;
    /** ISO 8601. */
    horodatage: string;
    blocs?: BlocRiche[];
    /** Écritures appliquées pendant ce tour (métadonnées ; les instantanés restent en mémoire). */
    modifications?: EntreeJournal[];
    /** Le groupe de modifications de ce tour a été annulé par l'utilisateur. */
    annulee?: boolean;
    navigation?: Tab[];
    /** Noms des actions appelées pendant le tour (fil « Étapes »). */
    etapes?: string[];
    /** Message d'erreur honnête (le tour n'a pas abouti). */
    erreur?: boolean;
}

export interface Conversation {
    id: string;
    titre: string;
    messages: MessageConversation[];
    /** ISO 8601 (indicatif côté client ; la vérité Firestore est `updatedAt`). */
    misAJourLe: string;
    /** Le document existe déjà côté dépôt (mise à jour plutôt que création). */
    persistee: boolean;
}

export interface ResumeConversation {
    id: string;
    titre: string;
    misAJourLe: string;
    messageCount: number;
}
