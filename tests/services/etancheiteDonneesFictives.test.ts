// tests/services/etancheiteDonneesFictives.test.ts
//
// [SANDBOX-ETANCHEITE] Ce que ce fichier défend : **rien de ce que l'app PUBLIE ne doit sortir
// pendant qu'elle tourne sur des données fictives** (mode test persona, et demain le bac à sable).
//
// ⚠️ Pourquoi ce lot existe alors que le mode test vit depuis des mois. Mesuré le 2026-09-21 :
// `services/backupAuto.ts`, `services/pdfReport.ts` et `services/gemini.ts` ne contenaient
// AUCUNE occurrence de `isTestMode` — zéro, dans les trois. C'était tolérable tant que le mode
// test ne servait qu'à des personas figés (« Karim », « jc-re1 ») : un persona ne ressemble à
// rien de réel, donc personne ne confond. Ça cesse de l'être dès que l'état fictif est une COPIE
// du dossier réel légèrement modifiée — elle est indiscernable du vrai dans un PDF, dans une
// sauvegarde relue six mois plus tard, ou dans une réponse du modèle.
//
// ⚠️ Ce que ces gardes ne couvrent PAS, et c'est écrit plutôt que sous-entendu : les prompts
// envoyés au modèle (`services/gemini.ts`). C'est le seul des trois canaux qui SORT de la
// machine — le backup va dans IndexedDB (local, chiffré par une clé de device) et le PDF reste
// sur le disque. Il est traité à part parce qu'il n'a pas de point d'entrée unique (sept
// fonctions, trois appels SDK directs) et parce que la réponse juste n'y est probablement pas un
// refus : demander conseil SUR un scénario est l'usage même du bac à sable.
// ⚠️ CORRECTION (2026-09-22, RE-MESURÉ) : la phrase ci-dessus disait « sept fonctions, trois
// appels SDK directs, pas de point d'entrée unique ». FAUX dans les deux sens. Mesuré sur
// `\.messages\.(create|stream)\(` : **CINQ** points de contact SDK, et ils portent TOUS un
// `system` — quatre dans `services/gemini.ts` (chat, chatStream, analyzePayslip,
// analyzeBankStatement) et un dans l'agent d'outils (`services/aiTools/agentLoop.ts`, retiré le
// 29/10/2026 avec l'ancien assistant, FinanceAI#15 : il ne reste que les quatre de `claude.ts`).
// Il y avait donc bien une taille de guêpe.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/errorLogger', () => ({
    logError: vi.fn(),
    logErrorThrottled: vi.fn(), onLogEntry: vi.fn(() => () => {}), __resetErrorThrottle: vi.fn(),
}));

import { createBackupNow, type BackupResultat } from '../../services/backupAuto';

const PAYLOAD = JSON.stringify({ state: { users: [] }, version: 7 });

/** Le seul champ qui nous intéresse ici : la cause, quand il y en a une. */
const cause = (r: BackupResultat): string | null => (r.ok ? null : r.cause);

describe('[SANDBOX-ETANCHEITE] backup : on n’ARCHIVE pas du fictif, mais on garde le FILET', () => {
    beforeEach(() => {
        localStorage.setItem('financeai-storage', PAYLOAD);
    });
    afterEach(() => {
        localStorage.clear();
        vi.unstubAllGlobals();
    });

    it('ARCHIVE + données fictives → REFUS nommé, et le refus ne dépend pas d’une panne', async () => {
        // ⚠️ ANTI-VACUITÉ : le payload est présent et IndexedDB n'est pas sabotée. Sans ça, un
        // refus serait tout aussi vrai d'un localStorage vide — la garde dirait « ça refuse »
        // sans rien dire de la RAISON, et resterait verte si on retirait la règle.
        expect(localStorage.getItem('financeai-storage')).toBeTruthy();

        const r = await createBackupNow('manual', { intent: 'archive', donneesFictives: true });
        expect(cause(r)).toBe('donnees-fictives');
    });

    it('CONTRÔLE NÉGATIF — même appel sur des données RÉELLES : plus de refus de règle', async () => {
        // On ne peut pas asserter le succès ici (jsdom n'a pas d'IndexedDB utilisable dans tous
        // les environnements) ; ce qui compte est que la cause CHANGE. Si elle restait
        // `donnees-fictives`, la garde du dessus serait satisfaite par un refus inconditionnel.
        const r = await createBackupNow('manual', { intent: 'archive', donneesFictives: false });
        expect(cause(r)).not.toBe('donnees-fictives');
    });

    it('FILET + données fictives → JAMAIS refusé (c’est l’opération suivante qu’il protège)', async () => {
        // C'est l'assertion la plus importante du fichier, et la moins intuitive. Refuser ici
        // casserait trois protections d'un coup : `services/aiTools/writeExecutor.ts` fait de la
        // réussite du backup la CONDITION de l'écriture (donc l'assistant ne pourrait plus rien
        // écrire dans le bac à sable), `services/sync/syncPull.ts` journaliserait « restauration
        // SANS filet » à chaque pull, et `restoreBackup` perdrait le sien.
        const r = await createBackupNow('auto', { intent: 'filet', donneesFictives: true });
        expect(cause(r)).not.toBe('donnees-fictives');
    });

    it('les deux intentions se DISTINGUENT sur des entrées par ailleurs identiques', async () => {
        // Perturbation : si un lot futur faisait de `intent` un paramètre décoratif (refus
        // inconditionnel, ou jamais de refus), l'une de ces deux lignes rougirait.
        const archive = await createBackupNow('manual', { intent: 'archive', donneesFictives: true });
        const filet = await createBackupNow('manual', { intent: 'filet', donneesFictives: true });
        expect(cause(archive)).toBe('donnees-fictives');
        expect(cause(filet)).not.toBe('donnees-fictives');
    });

    it('« rien à sauvegarder » et « refusé par règle » ne se confondent pas', async () => {
        // `UN-SERVICE-QUI-REND-LA-MEME-VALEUR-POUR-N-SITUATIONS-REND-SON-ECRAN-MUET` : avant ce
        // lot, les deux rendaient `null`, donc l'écran ne pouvait afficher qu'un seul message —
        // et il disait « localStorage vide ou IndexedDB indispo », ce qui envoie chercher une
        // panne quand la seule chose qui s'est passée est une règle métier.
        localStorage.clear();
        const vide = await createBackupNow('manual', { intent: 'archive', donneesFictives: false });
        expect(cause(vide)).toBe('rien-a-sauvegarder');

        localStorage.setItem('financeai-storage', PAYLOAD);
        const fictif = await createBackupNow('manual', { intent: 'archive', donneesFictives: true });
        expect(cause(fictif)).toBe('donnees-fictives');
        expect(cause(vide)).not.toBe(cause(fictif));
    });
});
