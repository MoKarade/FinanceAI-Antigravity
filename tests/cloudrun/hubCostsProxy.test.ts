// @vitest-environment node
import { createSign, generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { reinitialiserLimites, traiter } from '../../cloudrun/proxy/relais.mjs';

const TEST_OWNER_EMAIL = 'proprietaire@example.com';
const TEST_PROJECT_ID = 'demo-financeai';
const TEST_DB_ID = 'demo-db';
const TEST_HUB_OPTS = {
    hubOwnerEmail: TEST_OWNER_EMAIL,
    financeaiProjectId: TEST_PROJECT_ID,
    firestoreDatabaseId: TEST_DB_ID,
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const NOW_MS = 1_800_000_000_000;

function signJwt(payloadOverrides: Record<string, unknown> = {}, headerOverrides: Record<string, unknown> = {}): string {
    const nowSec = Math.floor(NOW_MS / 1000);
    const header = { alg: 'RS256', kid: 'fin-kid-1', typ: 'JWT', ...headerOverrides };
    const payload = {
        aud: 'hubperso-firebase',
        iss: 'https://securetoken.google.com/hubperso-firebase',
        sub: 'owner-uid',
        email: TEST_OWNER_EMAIL,
        email_verified: true,
        iat: nowSec - 15,
        exp: nowSec + 3600,
        ...payloadOverrides,
    };
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const s = createSign('RSA-SHA256');
    s.update(`${h}.${p}`);
    s.end();
    return `${h}.${p}.${s.sign(privateKey).toString('base64url')}`;
}

interface MockMonthPage {
    status?: number;
    documents?: unknown[];
    nextPageToken?: string;
}

function makeMockFetch(
    workspaceDoc: unknown,
    workspaceStatus = 200,
    monthPages: MockMonthPage[] = [],
    extraRoutes?: (url: string, init?: RequestInit) => Response | null,
) {
    return (async (url: string | URL | Request, init?: RequestInit) => {
        const u = String(url);
        if (extraRoutes) {
            const custom = extraRoutes(u, init);
            if (custom) return custom;
        }
        if (u.includes('securetoken@system.gserviceaccount.com')) {
            return new Response(JSON.stringify({ 'fin-kid-1': PUBLIC_PEM }), {
                status: 200,
                headers: { 'cache-control': 'public, max-age=1800' },
            });
        }
        if (u.includes('metadata.google.internal')) {
            return new Response(JSON.stringify({ access_token: 'adc-test-token', expires_in: 600 }), { status: 200 });
        }
        if (u.includes(':runQuery')) {
            return new Response(
                JSON.stringify([
                    {
                        document: {
                            name: `projects/${TEST_PROJECT_ID}/databases/${TEST_DB_ID}/documents/users/uid-owner-123`,
                            fields: { uid: { stringValue: 'uid-owner-123' } },
                        },
                    },
                ]),
                { status: 200 },
            );
        }
        if (u.includes('/workspaces/uid-owner-123/transactionMonths')) {
            const parsedUrl = new URL(u);
            const pt = parsedUrl.searchParams.get('pageToken') ?? '';
            const idx = pt ? Number(pt.replace('page-', '')) : 0;
            const page = monthPages[idx];
            if (!page) {
                return new Response(JSON.stringify({ documents: [] }), { status: 200 });
            }
            return new Response(
                JSON.stringify({
                    documents: page.documents ?? [],
                    ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}),
                }),
                { status: page.status ?? 200 },
            );
        }
        if (u.includes('/workspaces/uid-owner-123')) {
            return new Response(JSON.stringify(workspaceDoc), { status: workspaceStatus });
        }
        return new Response(JSON.stringify({ error: 'unexpected_url' }), { status: 500 });
    }) as typeof fetch;
}

describe('GET /api/hub-costs (FinanceAI proxy)', () => {
    beforeEach(() => {
        reinitialiserLimites();
    });

    it('gère CORS strict sur OPTIONS 204', async () => {
        const resOk = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                method: 'OPTIONS',
                headers: { origin: 'https://hubperso.com', 'sec-fetch-site': 'cross-site' },
            }),
        );
        expect(resOk.status).toBe(204);
        expect(resOk.headers.get('access-control-allow-origin')).toBe('https://hubperso.com');

        const resRefus = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                method: 'OPTIONS',
                headers: { origin: 'https://evil.example' },
            }),
        );
        expect(resRefus.status).toBe(204);
        expect(resRefus.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('rejette sans jeton, sans HUBPERSO_OWNER_EMAIL ou mauvais utilisateur avec 401', async () => {
        const fetchImpl = makeMockFetch({});
        const rNoToken = await traiter(new Request('http://relais.local/api/hub-costs'), { ...TEST_HUB_OPTS, fetchImpl, now: () => NOW_MS });
        expect(rNoToken.status).toBe(401);

        const badJwt = signJwt({ email: 'autre@example.com' });
        const rWrongUser = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${badJwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl, now: () => NOW_MS },
        );
        expect(rWrongUser.status).toBe(401);

        const validJwt = signJwt();
        const rUnconfiguredOwner = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${validJwt}` },
            }),
            { ...TEST_HUB_OPTS, hubOwnerEmail: '', fetchImpl, now: () => NOW_MS },
        );
        expect(rUnconfiguredOwner.status).toBe(401);
    });

    it('extrait le format unifié (jour/semaine/mois/total/séries) depuis json_v1 et Map natif', async () => {
        const jwt = signJwt();
        // NOW_MS = 1_800_000_000_000 -> 2027-01-15 (vendredi) en America/Toronto ; lundi = 2027-01-11
        const packedDoc = {
            updateTime: '2027-01-15T18:10:00Z',
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        { stringValue: '{"netWorth":999999,"aiChatCostUsdTotal":12.345,' },
                                        { stringValue: '"aiChatCostUsdByDay":{"2026-12-20":5,"2027-01-12":1.25,"2027-01-15":0.5}}' },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };
        const rPacked = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch(packedDoc), now: () => NOW_MS },
        );
        expect(rPacked.status).toBe(200);
        const bodyPacked = await rPacked.json();
        expect(bodyPacked).toEqual({
            appId: 'financeai',
            period: 'month',
            currency: 'USD',
            amountUsd: 1.75,
            todayUsd: 0.5,
            weekUsd: 1.75,
            monthUsd: 1.75,
            totalUsd: 12.345,
            daily: [
                { date: '2026-12-20', amountUsd: 5 },
                { date: '2027-01-12', amountUsd: 1.25 },
                { date: '2027-01-15', amountUsd: 0.5 },
            ],
            monthly: [
                { month: '2026-12', amountUsd: 5 },
                { month: '2027-01', amountUsd: 1.75 },
            ],
            updatedAt: '2027-01-15T18:10:00.000Z',
            summary: {
                metrics: [],
                alerts: [],
                highlights: [],
                activityToday: null,
                activityWeek: null,
                activityMonth: null,
                activityUnit: null,
            },
        });

        const mapDoc = {
            fields: {
                updatedAt: { timestampValue: '2027-01-15T18:15:00Z' },
                statePayload: {
                    mapValue: {
                        fields: {
                            aiChatCostUsdTotal: { doubleValue: 3.5 },
                            aiChatCostUsdByDay: {
                                mapValue: {
                                    fields: {
                                        '2027-01-05': { doubleValue: 1.0 },
                                        '2027-01-15': { doubleValue: 2.5 },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        };
        const rMap = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch(mapDoc), now: () => NOW_MS },
        );
        expect(rMap.status).toBe(200);
        expect(await rMap.json()).toEqual({
            appId: 'financeai',
            period: 'month',
            currency: 'USD',
            amountUsd: 3.5,
            todayUsd: 2.5,
            weekUsd: 2.5,
            monthUsd: 3.5,
            totalUsd: 3.5,
            daily: [
                { date: '2027-01-05', amountUsd: 1 },
                { date: '2027-01-15', amountUsd: 2.5 },
            ],
            monthly: [{ month: '2027-01', amountUsd: 3.5 }],
            updatedAt: '2027-01-15T18:15:00.000Z',
            summary: {
                metrics: [],
                alerts: [],
                highlights: [],
                activityToday: null,
                activityWeek: null,
                activityMonth: null,
                activityUnit: null,
            },
        });

        const rMissing = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch({}, 404), now: () => NOW_MS },
        );
        expect(rMissing.status).toBe(200);
        expect(await rMissing.json()).toEqual({
            appId: 'financeai',
            period: 'month',
            currency: 'USD',
            amountUsd: null,
            todayUsd: null,
            weekUsd: null,
            monthUsd: null,
            totalUsd: null,
            daily: [],
            monthly: [],
            updatedAt: null,
            summary: {
                metrics: [],
                alerts: [],
                highlights: [],
                activityToday: null,
                activityWeek: null,
                activityMonth: null,
                activityUnit: null,
            },
        });

        // Extraction summary (transactions à vérifier + activité + actifs suivis) depuis json_v1
        const summaryJson = JSON.stringify({
            aiChatCostUsdTotal: 2,
            aiChatCostUsdByDay: { '2027-01-15': 0.25 },
            assets: [{ id: 'a1' }, { id: 'a2' }],
            transactions: [
                { date: '2027-01-15', category: 'Non catégorisé' },
                { date: '2027-01-12', category: 'Épicerie', confidence: 55 },
                { date: '2027-01-03', category: 'Loyer', isVerified: true },
                { date: '2027-01-15', category: 'Épicerie', isDuplicate: true },
                { date: '2026-12-20', category: 'Autre', isTransfer: true },
            ],
        });
        const richDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: { arrayValue: { values: [{ stringValue: summaryJson }] } },
                        },
                    },
                },
            },
        };
        const rRich = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch(richDoc), now: () => NOW_MS },
        );
        expect(rRich.status).toBe(200);
        expect((await rRich.json()).summary).toEqual({
            metrics: [
                { label: 'À vérifier', value: '2', tone: 'warn' },
                { label: 'Opérations (mois)', value: '3', tone: 'neutral' },
                { label: 'Actifs suivis', value: '2', tone: 'neutral' },
            ],
            alerts: [{ label: '2 opérations à vérifier', severity: 'warn', target: '#TRANSACTIONS' }],
            highlights: [],
            activityToday: 1,
            activityWeek: 2,
            activityMonth: 3,
            activityUnit: 'opérations',
        });
    });

    it('calcule placements, variation auj/7j, alerte chute, liquidités, impact avenir et semaine glissante le lundi', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z'); // Lundi en America/Toronto
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const deepJson = JSON.stringify({
            aiChatCostUsdTotal: 4.5,
            aiChatCostUsdByDay: { '2027-01-14': 0.8, '2027-01-18': 0.2 },
            fxRates: { USD: 1.4, CAD: 1 },
            initialBalances: { chequing: 5000 },
            retirementGoal: { targetAge: 60, targetMonthlyIncome: 6500 },
            assets: [
                {
                    symbol: 'ACME',
                    quantity: 10,
                    currency: 'USD',
                    currentPrice: 90,
                    priceHistory: [
                        { date: '2027-01-11', price: 100 },
                        { date: '2027-01-15', price: 100 },
                        { date: '2027-01-18', price: 90 },
                    ],
                },
                {
                    symbol: 'VFV',
                    quantity: 10,
                    currency: 'CAD',
                    currentPrice: 120,
                    priceHistory: [
                        { date: '2027-01-11', price: 100 },
                        { date: '2027-01-15', price: 110 },
                        { date: '2027-01-18', price: 120 },
                    ],
                },
            ],
            transactions: [
                { date: '2027-01-14', category: 'Salaire', amount: 1500, isVerified: true },
                { date: '2027-01-18', category: 'Épicerie', amount: -500, isVerified: true },
            ],
        });

        const deepDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: { arrayValue: { values: [{ stringValue: deepJson }] } },
                        },
                    },
                },
            },
        };

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch(deepDoc), now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        // Même un lundi, la semaine glissante (7 j) inclut 2027-01-14 (0,8) + 2027-01-18 (0,2) = 1,0 != todayUsd (0,2)
        expect(body.todayUsd).toBe(0.2);
        expect(body.weekUsd).toBe(1);
        expect(body.summary.activityToday).toBe(1);
        expect(body.summary.activityWeek).toBe(2);

        expect(body.summary.alerts).toContainEqual({
            label: "ACME -10,0 % aujourd'hui",
            severity: 'warn',
            target: '#INVESTMENTS',
        });

        expect(body.summary.highlights).toEqual([
            {
                label: 'Placements',
                value: '2 460 $ CA',
                detail: '-1,6 % auj. · +2,5 % (7 j)',
                tone: 'warn',
                target: '#INVESTMENTS',
                sparkline: [2400, 2500, 2460],
            },
            {
                label: 'Liquidités (banque)',
                value: '6 000 $ CA',
                detail: 'Solde bancaire · 7 j : +1 000 $',
                tone: 'neutral',
                target: '#DASHBOARD',
                sparkline: [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 6500, 6500, 6500, 6500, 6000],
            },
            {
                label: 'Impact avenir',
                value: 'Flux mois : +1 000 $',
                detail: 'Objectif retraite : 60 ans · Cible 6 500 $/mois',
                tone: 'good',
                target: '#FUTURE',
            },
        ]);
    });

    it("n'affiche jamais les dépenses comme des liquidités sans ancre bancaire et respecte manualCash", async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const noAnchorDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                transactions: [
                                                    { date: '2027-01-17', category: 'Épicerie', amount: -320, isVerified: true },
                                                    { date: '2027-01-18', category: 'Essence', amount: -80, isVerified: true },
                                                ],
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const rNoAnchor = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch(noAnchorDoc), now: () => mondayMs },
        );
        expect(rNoAnchor.status).toBe(200);
        const bodyNoAnchor = await rNoAnchor.json();
        expect(bodyNoAnchor.summary.highlights.some((h: { label: string }) => h.label.includes('Liquidités'))).toBe(false);

        const manualDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                initialBalances: { chequing: 1000 },
                                                projection: { useManualBalances: true, manualCash: 18500 },
                                                transactions: [
                                                    { date: '2027-01-18', category: 'Épicerie', amount: -200, isVerified: true },
                                                ],
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const rManual = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl: makeMockFetch(manualDoc), now: () => mondayMs },
        );
        expect(rManual.status).toBe(200);
        const bodyManual = await rManual.json();
        expect(bodyManual.summary.highlights[0]).toEqual({
            label: 'Liquidités (banque)',
            value: '18 500 $ CA',
            detail: 'Solde bancaire manuel',
            tone: 'neutral',
            target: '#DASHBOARD',
        });
    });

    it('charge les transactions mensuelles shardées dans transactionMonths pour calculer les vraies liquidités (24k)', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const shardedDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            transactionsSharded: { booleanValue: true },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                initialBalances: { LIQUIDITE: 30000 },
                                                transactions: [],
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const page0Docs = [
            {
                fields: {
                    jsonChunks: {
                        arrayValue: {
                            values: [
                                {
                                    stringValue: JSON.stringify([
                                        { date: '2026-12-10', category: 'Salaire', amount: 2000, isVerified: true },
                                        { date: '2026-12-15', category: 'Loyer', amount: -5500, isVerified: true },
                                        { date: '2026-12-20', category: 'Virement', amount: -9999, isTransfer: true, isVerified: true },
                                    ]),
                                },
                            ],
                        },
                    },
                },
            },
        ];

        const page1Docs = [
            {
                fields: {
                    jsonChunks: {
                        arrayValue: {
                            values: [
                                {
                                    stringValue: JSON.stringify([
                                        { date: '2027-01-12', category: 'Non catégorisé', amount: -1500 },
                                        { date: '2027-01-16', category: 'Épicerie', amount: -1000, isVerified: true },
                                        { date: '2027-01-16', category: 'Doublon', amount: -1000, isDuplicate: true },
                                    ]),
                                },
                            ],
                        },
                    },
                },
            },
        ];

        const fetchImpl = makeMockFetch(shardedDoc, 200, [
            { documents: page0Docs, nextPageToken: 'page-1' },
            { documents: page1Docs },
        ]);

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs?refresh=1', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.summary.metrics).toEqual([
            { label: 'À vérifier', value: '1', tone: 'warn' },
            { label: 'Opérations (mois)', value: '2', tone: 'neutral' },
        ]);
        expect(body.summary.highlights[0]).toEqual({
            label: 'Liquidités (banque)',
            value: '24 000 $ CA',
            detail: 'Solde bancaire · 7 j : -2 500 $',
            tone: 'neutral',
            target: '#DASHBOARD',
            sparkline: [26500, 26500, 26500, 26500, 26500, 26500, 26500, 25000, 25000, 25000, 25000, 24000, 24000, 24000],
        });
    });

    it('enrichit les placements en direct via Yahoo/BoC et signale un solde bancaire ancien (> 2 j)', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const staleDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                fxRates: { USD: 1.3, CAD: 1 },
                                                initialBalances: { chequing: 10000 },
                                                fintableSyncReport: { at: Date.parse('2026-11-02T17:00:00Z') },
                                                transactions: [
                                                    { date: '2026-11-02', category: 'Salaire', amount: 2000, isVerified: true },
                                                ],
                                                assets: [
                                                    {
                                                        symbol: 'ACME',
                                                        quantity: 10,
                                                        currency: 'USD',
                                                        currentPrice: 100,
                                                        priceHistory: [{ date: '2026-11-04', price: 100 }],
                                                    },
                                                ],
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const fetchImpl = makeMockFetch(staleDoc, 200, [], (u) => {
            if (u.includes('bankofcanada.ca/valet/observations')) {
                return new Response(
                    JSON.stringify({
                        observations: [{ d: '2027-01-18', FXUSDCAD: { v: '1.4000' } }],
                    }),
                    { status: 200 },
                );
            }
            if (u.includes('query1.finance.yahoo.com/v8/finance/chart/ACME')) {
                return new Response(
                    JSON.stringify({
                        chart: {
                            result: [
                                {
                                    meta: { currency: 'USD', regularMarketPrice: 80 },
                                    timestamp: [
                                        Math.floor(Date.parse('2027-01-11T16:00:00Z') / 1000),
                                        Math.floor(Date.parse('2027-01-15T16:00:00Z') / 1000),
                                        Math.floor(Date.parse('2027-01-18T16:00:00Z') / 1000),
                                    ],
                                    indicators: { quote: [{ close: [100, 100, 80] }] },
                                },
                            ],
                        },
                    }),
                    { status: 200 },
                );
            }
            return null;
        });

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs?refresh=1', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.summary.highlights).toEqual([
            {
                label: 'Placements',
                value: '1 120 $ CA',
                detail: '-20,0 % auj. · -20,0 % (7 j)',
                tone: 'warn',
                target: '#INVESTMENTS',
                sparkline: [1400, 1400, 1120],
            },
            {
                label: 'Liquidités (banque)',
                value: '12 000 $ CA',
                detail: 'Solde au 2 nov. · synchroniser FinanceAI',
                tone: 'warn',
                target: '#DASHBOARD',
                sparkline: [12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000, 12000],
            },
        ]);
        expect(body.summary.alerts).toEqual([
            { label: "ACME -20,0 % aujourd'hui", severity: 'warn', target: '#INVESTMENTS' },
            { label: 'Synchro banque FinanceAI au 2 nov.', severity: 'info', target: '#DASHBOARD' },
        ]);
    });

    it('lit les liquidités en direct depuis Fintable V2 (dépôts actifs uniquement) et supprime l’alerte synchro obsolète', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const staleDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                fxRates: { USD: 1.4, CAD: 1 },
                                                initialBalances: { chequing: 10000 },
                                                fintableSyncReport: { at: Date.parse('2026-11-02T17:00:00Z') },
                                                transactions: [
                                                    { date: '2026-11-02', category: 'Salaire', amount: 2000, isVerified: true },
                                                ],
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        let seenAuth = '';
        const fetchImpl = makeMockFetch(staleDoc, 200, [], (u, init) => {
            if (u === 'https://fintable.io/api/v2/accounts') {
                seenAuth = String(new Headers(init?.headers).get('authorization') ?? '');
                return new Response(
                    JSON.stringify({
                        data: [
                            { id: '1', type: 'depository / savings', currency: 'CAD', balance: '23412.27', enabled: true },
                            { id: '2', type: 'depository / checking', currency: 'CAD', balance: '449.00', enabled: true },
                            { id: '3', type: 'depository / savings', currency: 'CAD', balance: '9999.00', enabled: false },
                            { id: '4', type: 'credit / credit card', currency: 'CAD', balance: '-451.64', enabled: true },
                            { id: '5', type: 'investment / brokerage', currency: 'USD', balance: '64543.84', enabled: true },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return null;
        });

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs?refresh=1', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fintableToken: 'fintable-live-jwt', fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        expect(seenAuth).toBe('Bearer fintable-live-jwt');
        const body = await res.json();

        expect(body.summary.highlights).toEqual([
            {
                label: 'Liquidités (banque)',
                value: '23 861 $ CA',
                detail: 'Banque en direct',
                tone: 'neutral',
                target: '#DASHBOARD',
                sparkline: Array(14).fill(23861.27),
            },
        ]);
        expect(body.summary.alerts).toEqual([]);
    });

    it('bascule sans erreur sur le solde Firestore si Fintable V2 échoue (401/500)', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const fallbackDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                initialBalances: { chequing: 10000 },
                                                fintableSyncReport: { at: Date.parse('2026-11-02T17:00:00Z') },
                                                transactions: [
                                                    { date: '2026-11-02', category: 'Salaire', amount: 2000, isVerified: true },
                                                ],
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const fetchImpl = makeMockFetch(fallbackDoc, 200, [], (u) => {
            if (u === 'https://fintable.io/api/v2/accounts') {
                return new Response(JSON.stringify({ error: { type: 'unauthenticated' } }), { status: 401 });
            }
            return null;
        });

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fintableToken: 'expired-jwt', fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        expect(body.summary.highlights[0]).toMatchObject({
            label: 'Liquidités (banque)',
            value: '12 000 $ CA',
            detail: 'Solde au 2 nov. · synchroniser FinanceAI',
            tone: 'warn',
        });
        expect(body.summary.alerts).toContainEqual({
            label: 'Synchro banque FinanceAI au 2 nov.',
            severity: 'info',
            target: '#DASHBOARD',
        });
    });

    it('laisse la priorité au solde bancaire manuel même si fintableToken est configuré', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const manualDoc = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                projection: { useManualBalances: true, manualCash: 19500 },
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        let fintableCalled = false;
        const fetchImpl = makeMockFetch(manualDoc, 200, [], (u) => {
            if (u === 'https://fintable.io/api/v2/accounts') {
                fintableCalled = true;
                return new Response(
                    JSON.stringify({
                        data: [{ id: '1', type: 'depository / checking', currency: 'CAD', balance: '24000', enabled: true }],
                    }),
                    { status: 200 },
                );
            }
            return null;
        });

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fintableToken: 'fintable-live-jwt', fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        expect(fintableCalled).toBe(false);
        const body = await res.json();

        expect(body.summary.highlights).toEqual([
            {
                label: 'Liquidités (banque)',
                value: '19 500 $ CA',
                detail: 'Solde bancaire manuel',
                tone: 'neutral',
                target: '#DASHBOARD',
            },
        ]);
    });

    it('convertit un compte Fintable V2 USD via VERIFIED_BOC_FX_TO_CAD sans fxRates et ignore une devise inconnue', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const docNoFx = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                initialBalances: { chequing: 1000 },
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const fetchImpl = makeMockFetch(docNoFx, 200, [], (u) => {
            if (u === 'https://fintable.io/api/v2/accounts') {
                return new Response(
                    JSON.stringify({
                        data: [
                            { id: '1', type: 'depository / checking', currency: 'USD', balance: '100', enabled: true },
                            { id: '2', type: 'depository / savings', currency: 'XYZ', balance: '99999', enabled: true },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return null;
        });

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs?refresh=1', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fintableToken: 'fintable-live-jwt', fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        // 100 USD * VERIFIED_BOC_FX_TO_CAD.USD (1.3989) = 139.89 CAD (XYZ ignoré, jamais factor = 1)
        expect(body.summary.highlights).toEqual([
            {
                label: 'Liquidités (banque)',
                value: '140 $ CA',
                detail: 'Banque en direct',
                tone: 'neutral',
                target: '#DASHBOARD',
            },
        ]);
    });

    it('convertit un compte Fintable V2 libellé en pence britanniques (GBp) en divisant par 100 avant GBP', async () => {
        const mondayMs = Date.parse('2027-01-18T17:00:00Z');
        const nowSec = Math.floor(mondayMs / 1000);
        const jwt = signJwt({ iat: nowSec - 15, exp: nowSec + 3600 });

        const docNoFx = {
            fields: {
                statePayload: {
                    mapValue: {
                        fields: {
                            _packedFormat: { stringValue: 'json_v1' },
                            jsonChunks: {
                                arrayValue: {
                                    values: [
                                        {
                                            stringValue: JSON.stringify({
                                                initialBalances: { chequing: 1000 },
                                            }),
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            },
        };

        const fetchImpl = makeMockFetch(docNoFx, 200, [], (u) => {
            if (u === 'https://fintable.io/api/v2/accounts') {
                return new Response(
                    JSON.stringify({
                        data: [
                            { id: '1', type: 'depository / savings', currency: 'GBp', balance: '10000', enabled: true },
                        ],
                    }),
                    { status: 200 },
                );
            }
            return null;
        });

        const res = await traiter(
            new Request('http://relais.local/api/hub-costs?refresh=1', {
                headers: { origin: 'https://hubperso.com', authorization: `Bearer ${jwt}` },
            }),
            { ...TEST_HUB_OPTS, fintableToken: 'fintable-live-jwt', fetchImpl, now: () => mondayMs },
        );
        expect(res.status).toBe(200);
        const body = await res.json();

        // 10000 GBp -> 100 GBP * VERIFIED_BOC_FX_TO_CAD.GBP (1.8841) = 188.41 CAD -> 188 $ CA
        expect(body.summary.highlights).toEqual([
            {
                label: 'Liquidités (banque)',
                value: '188 $ CA',
                detail: 'Banque en direct',
                tone: 'neutral',
                target: '#DASHBOARD',
            },
        ]);
    });
});
