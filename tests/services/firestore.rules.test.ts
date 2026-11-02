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
        expect(screen.getByText(/Positions & comptes en portefeuille/i)).toBeTruthy();
    });
});



