/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import blueprint from '../../firebase-blueprint.json';
import {
    sanitizeForFirestore,
    extractSanitizedWorkspacePayload,
    packWorkspacePayloadForFirestore,
    unpackWorkspacePayloadFromFirestore,
    makeSafeRevisionId,
    extractRemoteTimestampMs,
    PERSISTED_WORKSPACE_KEYS,
    SAFE_ID_REGEX,
    MAX_DISPLAY_NAME_LENGTH,
    MAX_EMAIL_LENGTH,
} from '../../services/firebase/workspaceSync';
import {
    handleFirestoreError,
    OperationType,
    type FirestoreErrorInfo,
} from '../../services/firebase/firebaseClient';
import {
    firestoreService,
    getDocument,
    createDocument,
    updateDocument,
    deleteDocument,
    requireAuthenticatedUser,
    verifyFirestoreConnectionDiagnostic,
    validateFirebaseConfiguration,
} from '../../services/firebase/firestoreService';
import firebaseAppletConfig from '../../firebase-applet-config.json';
import { buildStarterState } from '../../utils/starterData';
import { computeDossierRichness } from '../../services/dataRecovery';
import { FirebaseAuthGate } from '../../components/auth/FirebaseAuthGate';
import { AccueilGoogle } from '../../components/AccueilGoogle';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesSource = readFileSync(rulesPath, 'utf8');

interface EvalContext {
    authUid: string | null;
    emailVerified: boolean;
    pathUserId: string;
    requestTimeMs: number;
    existingDoc?: Record<string, unknown> | null;
}

/**
 * Évaluateur déterministe des prédicats de `firestore.rules` (UserProfile & FinancialWorkspace)
 * pour éprouver les 12 charges utiles adverses (« Dirty Dozen ») et les opérations légitimes.
 */
function evaluateWorkspaceWrite(
    op: 'create' | 'update',
    incoming: Record<string, unknown>,
    ctx: EvalContext,
): boolean {
    if (!ctx.authUid || !ctx.emailVerified) return false;
    if (ctx.authUid !== ctx.pathUserId) return false;
    if (!SAFE_ID_REGEX.test(ctx.pathUserId) || ctx.pathUserId.length > 128) return false;

    const required = ['ownerId', 'schemaVersion', 'revisionId', 'statePayload', 'createdAt', 'updatedAt'];
    const keys = Object.keys(incoming);
    if (!required.every((k) => keys.includes(k))) return false;
    if (!keys.every((k) => required.includes(k))) return false;

    if (typeof incoming.ownerId !== 'string' || incoming.ownerId !== ctx.authUid || incoming.ownerId !== ctx.pathUserId) {
        return false;
    }
    if (typeof incoming.schemaVersion !== 'number' || !Number.isInteger(incoming.schemaVersion) || incoming.schemaVersion < 1 || incoming.schemaVersion > 100) {
        return false;
    }
    if (typeof incoming.revisionId !== 'string' || incoming.revisionId.length < 1 || incoming.revisionId.length > 64 || !SAFE_ID_REGEX.test(incoming.revisionId)) {
        return false;
    }
    if (typeof incoming.statePayload !== 'object' || incoming.statePayload === null || Array.isArray(incoming.statePayload)) {
        return false;
    }
    const payloadObj = incoming.statePayload as Record<string, unknown>;
    if (Object.keys(payloadObj).length > 30 || 'apiKeys' in payloadObj) {
        return false;
    }

    if (op === 'create') {
        return incoming.createdAt === ctx.requestTimeMs && incoming.updatedAt === ctx.requestTimeMs;
    }

    if (!ctx.existingDoc) return false;
    if (incoming.ownerId !== ctx.existingDoc.ownerId) return false;
    if (incoming.createdAt !== ctx.existingDoc.createdAt) return false;
    if (incoming.updatedAt !== ctx.requestTimeMs) return false;

    const allowedUpdateKeys = new Set(['schemaVersion', 'revisionId', 'statePayload', 'updatedAt']);
    const changedKeys = keys.filter((k) => incoming[k] !== ctx.existingDoc![k]);
    return changedKeys.every((k) => allowedUpdateKeys.has(k));
}

function evaluateUserProfileWrite(
    op: 'create' | 'update',
    incoming: Record<string, unknown>,
    ctx: EvalContext,
): boolean {
    if (!ctx.authUid || !ctx.emailVerified) return false;
    if (ctx.authUid !== ctx.pathUserId) return false;
    if (!SAFE_ID_REGEX.test(ctx.pathUserId) || ctx.pathUserId.length > 128) return false;

    const required = ['uid', 'email', 'createdAt', 'updatedAt'];
    const allowed = ['uid', 'displayName', 'email', 'photoURL', 'createdAt', 'updatedAt'];
    const keys = Object.keys(incoming);
    if (!required.every((k) => keys.includes(k))) return false;
    if (!keys.every((k) => allowed.includes(k))) return false;

    if (typeof incoming.uid !== 'string' || incoming.uid !== ctx.authUid || incoming.uid !== ctx.pathUserId) {
        return false;
    }
    if (typeof incoming.email !== 'string' || incoming.email.length < 3 || incoming.email.length > MAX_EMAIL_LENGTH) {
        return false;
    }
    if ('displayName' in incoming && (typeof incoming.displayName !== 'string' || incoming.displayName.length > MAX_DISPLAY_NAME_LENGTH)) {
        return false;
    }
    if ('photoURL' in incoming && (typeof incoming.photoURL !== 'string' || incoming.photoURL.length > 500)) {
        return false;
    }

    if (op === 'create') {
        return incoming.createdAt === ctx.requestTimeMs && incoming.updatedAt === ctx.requestTimeMs;
    }
    if (!ctx.existingDoc) return false;
    return (
        incoming.uid === ctx.existingDoc.uid &&
        incoming.createdAt === ctx.existingDoc.createdAt &&
        incoming.updatedAt === ctx.requestTimeMs
    );
}

const MONTH_ID_REGEX = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

function hasExactKeys(incoming: Record<string, unknown>, fields: string[]): boolean {
    const keys = Object.keys(incoming);
    return fields.every((k) => keys.includes(k)) && keys.every((k) => fields.includes(k));
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isOwnerCtx(ctx: EvalContext): boolean {
    if (!ctx.authUid || !ctx.emailVerified) return false;
    if (ctx.authUid !== ctx.pathUserId) return false;
    return SAFE_ID_REGEX.test(ctx.pathUserId) && ctx.pathUserId.length <= 128;
}

/** Miroir de `isValidTransactionMonth` (workspaces/{userId}/transactionMonths/{monthId}). */
function evaluateTransactionMonthWrite(
    op: 'create' | 'update',
    monthId: string,
    incoming: Record<string, unknown>,
    ctx: EvalContext,
): boolean {
    if (!isOwnerCtx(ctx)) return false;
    if (!MONTH_ID_REGEX.test(monthId)) return false;
    if (!hasExactKeys(incoming, ['ownerId', 'month', 'count', 'jsonChunks', 'revisionId', 'updatedAt'])) return false;
    if (incoming.ownerId !== ctx.authUid || incoming.ownerId !== ctx.pathUserId) return false;
    if (incoming.month !== monthId) return false;
    if (!isIntInRange(incoming.count, 0, 5000)) return false;
    const chunks = incoming.jsonChunks;
    if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 20) return false;
    const isValidChunk = (c: unknown) => typeof c === 'string' && c.length <= 900_000;
    if (!isValidChunk(chunks[0]) || !isValidChunk(chunks[chunks.length - 1])) return false;
    const rev = incoming.revisionId;
    if (typeof rev !== 'string' || rev.length < 1 || rev.length > 64 || !SAFE_ID_REGEX.test(rev)) return false;
    if (incoming.updatedAt !== ctx.requestTimeMs) return false;
    if (op === 'create') return true;
    if (!ctx.existingDoc) return false;
    return incoming.ownerId === ctx.existingDoc.ownerId && incoming.month === ctx.existingDoc.month;
}

/** Miroir de `isValidConversation` (workspaces/{userId}/conversations/{conversationId}). */
function evaluateConversationWrite(
    op: 'create' | 'update',
    conversationId: string,
    incoming: Record<string, unknown>,
    ctx: EvalContext,
): boolean {
    if (!isOwnerCtx(ctx)) return false;
    if (!SAFE_ID_REGEX.test(conversationId) || conversationId.length > 128) return false;
    if (!hasExactKeys(incoming, ['ownerId', 'title', 'messagesJson', 'messageCount', 'createdAt', 'updatedAt'])) return false;
    if (incoming.ownerId !== ctx.authUid || incoming.ownerId !== ctx.pathUserId) return false;
    if (typeof incoming.title !== 'string' || incoming.title.length < 1 || incoming.title.length > 200) return false;
    if (typeof incoming.messagesJson !== 'string' || incoming.messagesJson.length > 900_000) return false;
    if (!isIntInRange(incoming.messageCount, 0, 2000)) return false;
    if (incoming.updatedAt !== ctx.requestTimeMs) return false;
    if (op === 'create') return incoming.createdAt === ctx.requestTimeMs;
    if (!ctx.existingDoc) return false;
    return incoming.ownerId === ctx.existingDoc.ownerId && incoming.createdAt === ctx.existingDoc.createdAt;
}

describe('Firestore Security Rules & Dirty Dozen Red Team Audit', () => {
    const SERVER_TIME = 1_762_000_000_000;
    const validCtx: EvalContext = {
        authUid: 'user_alpha_01',
        emailVerified: true,
        pathUserId: 'user_alpha_01',
        requestTimeMs: SERVER_TIME,
        existingDoc: {
            ownerId: 'user_alpha_01',
            schemaVersion: 1,
            revisionId: 'rev_initial',
            statePayload: { initialBalances: {} },
            createdAt: SERVER_TIME - 5000,
            updatedAt: SERVER_TIME - 5000,
        },
    };

    it('vérifie la synchronisation structurelle entre firebase-blueprint.json et firestore.rules', () => {
        expect(rulesSource).toContain("rules_version = '2';");
        expect(rulesSource).toContain('match /{document=**}');
        expect(rulesSource).toContain('allow read, write: if false;');
        expect(rulesSource).toContain('request.auth.token.email_verified == true');
        expect(rulesSource).toContain('match /users/{userId}');
        expect(rulesSource).toContain('match /workspaces/{userId}');
        expect(rulesSource).toContain("!('apiKeys' in data.statePayload)");
        expect(blueprint.firestore['/users/{userId}']).toBeDefined();
        expect(blueprint.firestore['/workspaces/{userId}']).toBeDefined();
    });

    it('rejette les 12 charges utiles adverses (« Dirty Dozen ») et autorise les écritures légitimes', () => {
        const validPayload = {
            ownerId: 'user_alpha_01',
            schemaVersion: 1,
            revisionId: 'rev_legit_01',
            statePayload: { initialBalances: { celi: 10000 } },
            createdAt: SERVER_TIME,
            updatedAt: SERVER_TIME,
        };

        // Cas légitime autorisé
        expect(evaluateWorkspaceWrite('create', validPayload, validCtx)).toBe(true);

        // 1. Usurpation d'identité (ownerId tiers)
        expect(
            evaluateWorkspaceWrite(
                'create',
                { ...validPayload, ownerId: 'user_victim_99' },
                validCtx,
            ),
        ).toBe(false);

        // 2. Injection de champ fantôme (Shadow Update : isAdmin: true)
        expect(
            evaluateWorkspaceWrite(
                'create',
                { ...validPayload, isAdmin: true },
                validCtx,
            ),
        ).toBe(false);

        // 3. Courriel non vérifié (email_verified == false)
        expect(
            evaluateWorkspaceWrite('create', validPayload, {
                ...validCtx,
                emailVerified: false,
            }),
        ).toBe(false);

        // 4. Écriture transversale sur le chemin d'un autre utilisateur
        expect(
            evaluateWorkspaceWrite('create', validPayload, {
                ...validCtx,
                pathUserId: 'user_other_02',
            }),
        ).toBe(false);

        // 5. Altération du champ immuable createdAt lors d'un update
        expect(
            evaluateWorkspaceWrite(
                'update',
                {
                    ...validPayload,
                    createdAt: SERVER_TIME,
                    updatedAt: SERVER_TIME,
                },
                validCtx,
            ),
        ).toBe(false);

        // 6. Altération du propriétaire ownerId lors d'un update
        expect(
            evaluateWorkspaceWrite(
                'update',
                {
                    ...validPayload,
                    ownerId: 'user_other_02',
                    createdAt: SERVER_TIME - 5000,
                    updatedAt: SERVER_TIME,
                },
                validCtx,
            ),
        ).toBe(false);

        // 7. Horodatage updatedAt forgé par le client
        expect(
            evaluateWorkspaceWrite(
                'update',
                {
                    ...validPayload,
                    createdAt: SERVER_TIME - 5000,
                    updatedAt: SERVER_TIME + 99999,
                },
                validCtx,
            ),
        ).toBe(false);

        // 8. Dépassement de taille sur UserProfile.displayName (> 120 caractères)
        expect(
            evaluateUserProfileWrite(
                'create',
                {
                    uid: 'user_alpha_01',
                    email: 'test@example.com',
                    displayName: 'A'.repeat(200),
                    createdAt: SERVER_TIME,
                    updatedAt: SERVER_TIME,
                },
                validCtx,
            ),
        ).toBe(false);

        // 9. Empoisonnement de revisionId avec caractères interdits
        expect(
            evaluateWorkspaceWrite(
                'create',
                { ...validPayload, revisionId: 'rev/../ malicious' },
                validCtx,
            ),
        ).toBe(false);

        // 10. Corruption de type sur statePayload (chaîne JSON au lieu de Map)
        expect(
            evaluateWorkspaceWrite(
                'create',
                { ...validPayload, statePayload: '{}' },
                validCtx,
            ),
        ).toBe(false);

        // 11. Corruption de schemaVersion (entier négatif)
        expect(
            evaluateWorkspaceWrite(
                'create',
                { ...validPayload, schemaVersion: -1 },
                validCtx,
            ),
        ).toBe(false);

        // 12. Tentative d'injection de clés API dans statePayload
        expect(
            evaluateWorkspaceWrite(
                'create',
                {
                    ...validPayload,
                    statePayload: { apiKeys: { anthropic: 'secret' } },
                },
                validCtx,
            ),
        ).toBe(false);
    });

    it('assainit le dossier patrimonial complet sans jamais exposer apiKeys ni undefined', () => {
        const starter = buildStarterState();
        const dirtyState = {
            ...starter,
            apiKeys: {
                anthropic: 'AIzaSyFakeSecretKeyValue',
                fintable: 'fintable_secret',
            },
        };

        const payload = extractSanitizedWorkspacePayload(dirtyState as never);
        expect(payload).not.toHaveProperty('apiKeys');
        expect(JSON.stringify(payload)).not.toContain('AIzaSyFakeSecretKeyValue');
        expect(payload).toHaveProperty('config');
        expect(payload).toHaveProperty('transactions');
        expect(payload).toHaveProperty('assets');
        expect(payload).toHaveProperty('retirementGoal');

        const rev = makeSafeRevisionId();
        expect(SAFE_ID_REGEX.test(rev)).toBe(true);
        expect(
            sanitizeForFirestore({
                a: undefined,
                b: Number.NaN,
                inf: Number.POSITIVE_INFINITY,
                apiKeys: 'hidden',
                c: 42,
            }),
        ).toEqual({
            b: null,
            inf: null,
            c: 42,
        });
        expect(PERSISTED_WORKSPACE_KEYS).toContain('brokerLedger');
        expect(PERSISTED_WORKSPACE_KEYS).toContain('instruments');
        expect(PERSISTED_WORKSPACE_KEYS).toContain('aiChatCostUsdTotal');
        expect(PERSISTED_WORKSPACE_KEYS).toContain('revealedProjectionSig');
    });

    it('formate les erreurs de permission Firestore selon le contrat JSON FirestoreErrorInfo', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        let thrownMessage = '';
        try {
            handleFirestoreError(
                new Error('Missing or insufficient permissions.'),
                OperationType.WRITE,
                'workspaces/user_alpha_01',
            );
        } catch (err) {
            thrownMessage = err instanceof Error ? err.message : String(err);
        } finally {
            spy.mockRestore();
        }

        const parsed = JSON.parse(thrownMessage) as FirestoreErrorInfo;
        expect(parsed.error).toContain('Missing or insufficient permissions');
        expect(parsed.operationType).toBe(OperationType.WRITE);
        expect(parsed.path).toBe('workspaces/user_alpha_01');
        expect(parsed.authInfo).toBeDefined();
    });

    it('initialise firestoreService depuis firebase-applet-config.json et exige une authentification sur chaque opération CRUD', async () => {
        expect(firestoreService.config.projectId).toBe(firebaseAppletConfig.projectId);
        expect(firestoreService.config.firestoreDatabaseId).toBe(
            firebaseAppletConfig.firestoreDatabaseId,
        );
        expect(firestoreService.db).toBeDefined();
        expect(firestoreService.auth).toBeDefined();

        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(getDocument('workspaces', 'user_alpha_01')).rejects.toThrow(
                /Authentification Firebase requise/,
            );
            await expect(
                createDocument('workspaces', 'user_alpha_01', { ownerId: 'user_alpha_01' }),
            ).rejects.toThrow(/Authentification Firebase requise/);
            await expect(
                updateDocument('workspaces', 'user_alpha_01', { schemaVersion: 2 }),
            ).rejects.toThrow(/Authentification Firebase requise/);
            await expect(deleteDocument('workspaces', 'user_alpha_01')).rejects.toThrow(
                /Authentification Firebase requise/,
            );

            // Rejette également si l'utilisateur authentifié ne correspond pas au propriétaire attendu
            expect(() =>
                requireAuthenticatedUser(OperationType.WRITE, 'workspaces/user_victim_99', {
                    expectedUid: 'user_victim_99',
                    authenticatedUser: { uid: 'user_alpha_01' } as never,
                }),
            ).toThrow(/Accès refusé/);

            // Autorise lorsque l'utilisateur authentifié correspond au propriétaire attendu
            const verifiedUser = requireAuthenticatedUser(
                OperationType.GET,
                'workspaces/user_alpha_01',
                {
                    expectedUid: 'user_alpha_01',
                    authenticatedUser: { uid: 'user_alpha_01', email: 'test@example.com' } as never,
                },
            );
            expect(verifiedUser.uid).toBe('user_alpha_01');
        } finally {
            spy.mockRestore();
        }
    });

    it('affiche le portail de connexion Google obligatoire lorsque aucun utilisateur Firebase n’est connecté', () => {
        render(
            React.createElement(FirebaseAuthGate, {
                forceAuthGate: true,
                children: React.createElement('div', { 'data-testid': 'protected-dashboard' }, 'Contenu protégé'),
            }),
        );

        expect(screen.getByTestId('firebase-auth-gate')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Continuer avec Google/i })).toBeInTheDocument();
        expect(screen.queryByTestId('protected-dashboard')).not.toBeInTheDocument();
    });

    it('exécute le diagnostic de connexion entre firestoreService et firebase-applet-config.json et journalise le résultat en console', async () => {
        const validation = validateFirebaseConfiguration(firebaseAppletConfig);
        expect(validation.valid).toBe(true);
        expect(validation.missingOrInvalidFields).toEqual([]);

        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        try {
            // Cas 1 : Sonde réseau simulée avec réponse permission-denied (prouve l'atteignabilité du serveur)
            const successReport = await verifyFirestoreConnectionDiagnostic({
                serverProbe: async () => {
                    throw new Error('Missing or insufficient permissions.');
                },
            });
            expect(successReport.ok).toBe(true);
            expect(successReport.projectId).toBe(firebaseAppletConfig.projectId);
            expect(successReport.firestoreDatabaseId).toBe(firebaseAppletConfig.firestoreDatabaseId);
            expect(successReport.serviceAligned).toBe(true);
            expect(successReport.serverReachable).toBe(true);
            expect(infoSpy).toHaveBeenCalledWith(
                expect.stringContaining('[FirestoreDiagnostic] Connexion vérifiée avec succès'),
                expect.objectContaining({
                    projectId: firebaseAppletConfig.projectId,
                    firestoreDatabaseId: firebaseAppletConfig.firestoreDatabaseId,
                }),
            );

            // Cas 2 : Sonde réseau hors ligne (the client is offline) -> journalise une erreur explicite
            const offlineReport = await verifyFirestoreConnectionDiagnostic({
                serverProbe: async () => {
                    throw new Error('Failed to get document because the client is offline.');
                },
            });
            expect(offlineReport.ok).toBe(false);
            expect(offlineReport.serverReachable).toBe(false);
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining('[FirestoreDiagnostic] Échec de connexion au serveur Cloud Firestore'),
                expect.objectContaining({
                    projectId: firebaseAppletConfig.projectId,
                    firestoreDatabaseId: firebaseAppletConfig.firestoreDatabaseId,
                }),
            );
        } finally {
            infoSpy.mockRestore();
            errorSpy.mockRestore();
        }
    });

    it('compacte les dossiers volumineux (< 1 Mo) avec packWorkspacePayloadForFirestore tout en respectant firestore.rules', () => {
        const starter = buildStarterState();
        const hugeHistory = Array.from({ length: 1500 }, (_, i) => ({
            date: `2022-01-${String((i % 28) + 1).padStart(2, '0')}`,
            value: 100 + i * 0.25,
        }));
        const hugeTransactions = Array.from({ length: 2200 }, (_, i) => ({
            id: `tx_${i}`,
            date: '2025-05-10',
            description: `Opération financière détaillée numéro ${i} avec métadonnées complètes`,
            amount: 125.5,
            type: 'expense',
            category: 'Alimentation',
        }));

        const heavyPayload = extractSanitizedWorkspacePayload({
            ...starter,
            assets: (starter.assets ?? []).map((a) => ({
                ...a,
                history: hugeHistory,
                priceHistory: hugeHistory,
            })),
            transactions: hugeTransactions as never,
        } as never);

        const packed = packWorkspacePayloadForFirestore(heavyPayload);
        expect(packed._packedFormat).toBe('json_v1');
        expect(Array.isArray(packed.jsonChunks)).toBe(true);
        expect(Object.keys(packed).length).toBeLessThanOrEqual(30);
        expect(packed).not.toHaveProperty('apiKeys');

        // Taille totale en octets strictement inférieure à 800 Ko (plafond Firestore = 1 048 576 octets)
        const serializedPackedSize = new TextEncoder().encode(JSON.stringify(packed)).byteLength;
        expect(serializedPackedSize).toBeLessThan(800_000);

        // Validation par l'évaluateur des règles Firestore
        expect(
            evaluateWorkspaceWrite(
                'update',
                {
                    ownerId: 'user_alpha_01',
                    schemaVersion: 1,
                    revisionId: 'rev_packed_01',
                    statePayload: packed,
                    createdAt: SERVER_TIME - 5000,
                    updatedAt: SERVER_TIME,
                },
                validCtx,
            ),
        ).toBe(true);

        // Dépaquetage transparent (format compacté + rétrocompatibilité Map native)
        const unpacked = unpackWorkspacePayloadFromFirestore(packed);
        expect(unpacked).not.toBeNull();
        expect(unpacked?.config).toEqual(heavyPayload.config);
        expect(Array.isArray(unpacked?.assets)).toBe(true);

        const legacyUnpacked = unpackWorkspacePayloadFromFirestore({
            initialBalances: { celi: 5000 },
            apiKeys: { anthropic: 'secret' },
        });
        expect(legacyUnpacked).toEqual({ initialBalances: { celi: 5000 } });
    });

    it('extrait fidèlement l’horodatage Firestore (updatedAt) pour éviter qu’un document distant plus ancien n’écrase un état local plus récent', () => {
        expect(firebaseAppletConfig.projectId).toBe('financeai-demo-public');
        expect(
            extractRemoteTimestampMs({
                updatedAt: { toMillis: () => 1_762_000_500_000 },
            }),
        ).toBe(1_762_000_500_000);
        expect(
            extractRemoteTimestampMs({
                updatedAt: { seconds: 1_762_000_000 },
            }),
        ).toBe(1_762_000_000_000);
        expect(
            extractRemoteTimestampMs(
                {},
                { lastUpdate: 1_762_000_123_000 },
            ),
        ).toBe(1_762_000_123_000);
    });

    it('affiche la page d’accueil style Google Finance (AccueilGoogle) sans erreur d’exécution', () => {
        const starter = buildStarterState();
        render(
            React.createElement(AccueilGoogle, {
                state: starter as never,
                setActiveTab: () => {},
                isPrivacyMode: false,
                globalNetWorth: 230_000,
                avoirsHorsImmo: 180_000,
                dettesHorsImmo: 15_000,
                calculatedMonthlySavings: 2_100,
                assetBreakdown: { celi: 75_000, reer: 65_000, reee: 10_000, nonReg: 20_000 },
                currentLiquidity: 10_000,
            }),
        );

        expect(screen.getByTestId('accueil-google-view')).toBeTruthy();
        expect(screen.getByTestId('preuves-sources-panel')).toBeTruthy();
        expect(screen.getByText(/Flux 30j/i)).toBeTruthy();
        expect(screen.getByText(/Preuves & Sources/i)).toBeTruthy();
    });

    it('computeDossierRichness favorise un dossier complet face au gabarit de départ', () => {
        const starter = buildStarterState();
        const richDossier = {
            ...starter,
            assets: Array.from({ length: 12 }, (_, idx) => ({
                id: `asset-${idx}`,
                symbol: `SYM${idx}`,
                name: `Titre ${idx}`,
                quantity: 10,
                currentPrice: 150,
                currency: 'CAD' as const,
                accountType: 'CELI' as const,
                sector: 'Tech',
            })),
            transactions: Array.from({ length: 200 }, (_, idx) => ({
                id: `tx-${idx}`,
                date: '2026-05-01',
                payee: 'Marchand',
                category: 'Épicerie',
                amount: -45,
                status: 'cleared' as const,
            })),
        };
        expect(computeDossierRichness(starter)).toBe(0);
        expect(computeDossierRichness(richDossier as never)).toBeGreaterThan(1_000);
    });

    it('déclare les sous-collections transactionMonths et conversations sous workspaces/{userId} avec validateurs stricts', () => {
        expect(rulesSource).toContain('match /transactionMonths/{monthId}');
        expect(rulesSource).toContain('match /conversations/{conversationId}');
        expect(rulesSource).toContain("monthId.matches('^[0-9]{4}-(0[1-9]|1[0-2])$')");
        expect(rulesSource).toContain(
            "data.keys().hasOnly(['ownerId', 'month', 'count', 'jsonChunks', 'revisionId', 'updatedAt'])",
        );
        expect(rulesSource).toContain(
            "data.keys().hasOnly(['ownerId', 'title', 'messagesJson', 'messageCount', 'createdAt', 'updatedAt'])",
        );
        expect(rulesSource).toContain('data.jsonChunks is list');
        expect(rulesSource).toContain('data.jsonChunks.size() <= 20');
        expect(rulesSource).toContain('data.messagesJson.size() <= 900000');
        expect(rulesSource).toContain('incoming().month == existing().month');
        // Les deux sous-collections imbriquées sont bien dans le bloc workspaces/{userId}
        const wsIndex = rulesSource.indexOf('match /workspaces/{userId}');
        expect(rulesSource.indexOf('match /transactionMonths/{monthId}')).toBeGreaterThan(wsIndex);
        expect(rulesSource.indexOf('match /conversations/{conversationId}')).toBeGreaterThan(wsIndex);
        // Les validateurs sont appelés en create ET en update (pas de contournement par update)
        expect(rulesSource.match(/isValidTransactionMonth\(incoming\(\), userId, monthId\)/g)?.length).toBe(2);
        expect(rulesSource.match(/isValidConversation\(incoming\(\), userId\)/g)?.length).toBe(2);
    });

    it('transactionMonths : autorise les écritures légitimes et rejette les charges adverses', () => {
        const monthCtx: EvalContext = {
            ...validCtx,
            existingDoc: {
                ownerId: 'user_alpha_01',
                month: '2026-05',
                count: 10,
                jsonChunks: ['[]'],
                revisionId: 'rev_initial',
                updatedAt: SERVER_TIME - 5000,
            },
        };
        const valid = {
            ownerId: 'user_alpha_01',
            month: '2026-05',
            count: 42,
            jsonChunks: ['[{"id":"tx_1"}]', '[{"id":"tx_2"}]'],
            revisionId: 'rev_mois_01',
            updatedAt: SERVER_TIME,
        };

        expect(evaluateTransactionMonthWrite('create', '2026-05', valid, monthCtx)).toBe(true);
        expect(evaluateTransactionMonthWrite('update', '2026-05', valid, monthCtx)).toBe(true);

        // Identifiant de mois invalide (mois 13, format libre)
        expect(evaluateTransactionMonthWrite('create', '2026-13', { ...valid, month: '2026-13' }, monthCtx)).toBe(false);
        expect(evaluateTransactionMonthWrite('create', '2026-5', { ...valid, month: '2026-5' }, monthCtx)).toBe(false);
        // month différent de l'identifiant du document
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, month: '2026-06' }, monthCtx)).toBe(false);
        // Usurpation d'identité et chemin d'un autre utilisateur
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, ownerId: 'user_victim_99' }, monthCtx)).toBe(false);
        expect(
            evaluateTransactionMonthWrite('create', '2026-05', valid, { ...monthCtx, pathUserId: 'user_other_02' }),
        ).toBe(false);
        // Courriel non vérifié
        expect(evaluateTransactionMonthWrite('create', '2026-05', valid, { ...monthCtx, emailVerified: false })).toBe(false);
        // Champ fantôme et champ manquant
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, apiKeys: 'secret' }, monthCtx)).toBe(false);
        const sansRevision: Record<string, unknown> = { ...valid };
        delete sansRevision.revisionId;
        expect(evaluateTransactionMonthWrite('create', '2026-05', sansRevision, monthCtx)).toBe(false);
        // Bornes de count (négatif, > 5000, décimal)
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, count: -1 }, monthCtx)).toBe(false);
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, count: 5001 }, monthCtx)).toBe(false);
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, count: 1.5 }, monthCtx)).toBe(false);
        // jsonChunks : type, liste vide, trop de blocs, bloc trop gros
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, jsonChunks: '[]' }, monthCtx)).toBe(false);
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, jsonChunks: [] }, monthCtx)).toBe(false);
        expect(
            evaluateTransactionMonthWrite('create', '2026-05', { ...valid, jsonChunks: Array(21).fill('[]') }, monthCtx),
        ).toBe(false);
        expect(
            evaluateTransactionMonthWrite('create', '2026-05', { ...valid, jsonChunks: ['x'.repeat(900_001)] }, monthCtx),
        ).toBe(false);
        // revisionId empoisonné
        expect(evaluateTransactionMonthWrite('create', '2026-05', { ...valid, revisionId: 'rev/../x' }, monthCtx)).toBe(false);
        // updatedAt forgé par le client
        expect(evaluateTransactionMonthWrite('update', '2026-05', { ...valid, updatedAt: SERVER_TIME + 1 }, monthCtx)).toBe(false);
        // Update ne peut pas changer month (document existant d'un autre mois)
        expect(
            evaluateTransactionMonthWrite('update', '2026-05', valid, {
                ...monthCtx,
                existingDoc: { ...monthCtx.existingDoc, month: '2026-04' },
            }),
        ).toBe(false);
    });

    it('conversations : autorise les écritures légitimes et rejette les charges adverses', () => {
        const convCtx: EvalContext = {
            ...validCtx,
            existingDoc: {
                ownerId: 'user_alpha_01',
                title: 'Question REER',
                messagesJson: '[]',
                messageCount: 0,
                createdAt: SERVER_TIME - 5000,
                updatedAt: SERVER_TIME - 5000,
            },
        };
        const validCreate = {
            ownerId: 'user_alpha_01',
            title: 'Question REER',
            messagesJson: '[{"role":"user","text":"Bonjour"}]',
            messageCount: 1,
            createdAt: SERVER_TIME,
            updatedAt: SERVER_TIME,
        };
        const validUpdate = { ...validCreate, createdAt: SERVER_TIME - 5000, messageCount: 2 };

        expect(evaluateConversationWrite('create', 'conv_01', validCreate, convCtx)).toBe(true);
        expect(evaluateConversationWrite('update', 'conv_01', validUpdate, convCtx)).toBe(true);

        // Identifiant de conversation invalide
        expect(evaluateConversationWrite('create', 'conv/../01', validCreate, convCtx)).toBe(false);
        // Usurpation d'identité, chemin tiers, courriel non vérifié
        expect(evaluateConversationWrite('create', 'conv_01', { ...validCreate, ownerId: 'user_victim_99' }, convCtx)).toBe(false);
        expect(
            evaluateConversationWrite('create', 'conv_01', validCreate, { ...convCtx, pathUserId: 'user_other_02' }),
        ).toBe(false);
        expect(evaluateConversationWrite('create', 'conv_01', validCreate, { ...convCtx, emailVerified: false })).toBe(false);
        // Clé secrète hors liste refusée
        expect(
            evaluateConversationWrite('create', 'conv_01', { ...validCreate, apiKeys: { gemini: 'secret' } }, convCtx),
        ).toBe(false);
        // Bornes title / messagesJson / messageCount
        expect(evaluateConversationWrite('create', 'conv_01', { ...validCreate, title: '' }, convCtx)).toBe(false);
        expect(evaluateConversationWrite('create', 'conv_01', { ...validCreate, title: 'T'.repeat(201) }, convCtx)).toBe(false);
        expect(
            evaluateConversationWrite('create', 'conv_01', { ...validCreate, messagesJson: 'x'.repeat(900_001) }, convCtx),
        ).toBe(false);
        expect(evaluateConversationWrite('create', 'conv_01', { ...validCreate, messagesJson: [] }, convCtx)).toBe(false);
        expect(evaluateConversationWrite('create', 'conv_01', { ...validCreate, messageCount: 2001 }, convCtx)).toBe(false);
        expect(evaluateConversationWrite('create', 'conv_01', { ...validCreate, messageCount: -1 }, convCtx)).toBe(false);
        // createdAt forgé en create, modifié en update
        expect(
            evaluateConversationWrite('create', 'conv_01', { ...validCreate, createdAt: SERVER_TIME - 1 }, convCtx),
        ).toBe(false);
        expect(evaluateConversationWrite('update', 'conv_01', { ...validUpdate, createdAt: SERVER_TIME }, convCtx)).toBe(false);
        // updatedAt forgé
        expect(
            evaluateConversationWrite('update', 'conv_01', { ...validUpdate, updatedAt: SERVER_TIME + 1 }, convCtx),
        ).toBe(false);
    });
});



