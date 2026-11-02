// services/dataRecovery.ts
// Bouclier anti-mode test, recherche multi-sources (IndexedDB, localStorage, Google Drive)
// et restauration fidèle du dossier réel de l'utilisateur.

import type { AppState } from '../types';
import { INITIAL_REAL_ESTATE_GOAL, DEFAULT_FX_RATES } from '../constants';
import { useFinanceStore } from '../store/useFinanceStore';
import { listBackups, readStoredPayload } from './backupAuto';
import { getOrCreateDeviceKey } from './secureKeyStore';
import { sanitizePersonaArtifacts } from './personaSanitizer';
import { hasMeaningfulData } from '../utils/onboarding';
import { buildStarterState } from '../utils/starterData';
import { computePresentTermes } from './portfolio';
import { presentTermesOfGoal, monthsSince } from './projection/pastPurchaseInit';
import { initSync, pullNow } from './sync/syncOrchestrator';
import { isGoogleAuthConfigured, getCachedToken } from './googleDrive/gisAuth';
import {
    findSyncFile,
    readSyncFile,
    listAppDataFiles,
    readAppDataFile,
} from './googleDrive/driveAppData';
import { STORAGE_KEYS } from '../utils/storageKeys';
import firebaseAppletConfig from '../firebase-applet-config.json';

const PROTECTED_DOSSIER_STORAGE_KEY = 'financeai:protected_dossier:v1';
const GOOGLE_DRIVE_CLIENT_ID_STORAGE_KEY = 'financeai:google_drive_client_id:v1';

/** Active automatiquement l'authentification Google Drive avec le client OAuth provisionné. */
export function ensureDefaultGoogleAuthConfigured(): void {
    const isTestEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
    if (isTestEnv) return;
    if (isGoogleAuthConfigured()) return;
    const envClientId =
        typeof import.meta !== 'undefined'
            ? (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()
            : undefined;
    const clientId = envClientId || firebaseAppletConfig.oAuthClientId?.trim() || '';
    if (clientId) {
        initSync(clientId);
    }
}

export interface RecoverableSnapshotInfo {
    id: string;
    label: string;
    timestamp: number;
    netWorth: number;
    transactionsCount: number;
    assetsCount: number;
    isCustomUserDossier: boolean;
    state: Partial<AppState>;
}

/** Détecte si un état est lui-même un persona de test actif. */
function isTestPersonaState(candidate: Record<string, unknown>): boolean {
    if (candidate.isTestMode === true) return true;
    if (typeof candidate.activeTestPersonaId === 'string' && candidate.activeTestPersonaId.length > 0) {
        return true;
    }
    const config = candidate.config as { users?: Array<{ name?: string }> } | undefined;
    const users = config?.users ?? [];
    if (users.some((u) => /\(test\)/i.test(u?.name ?? ''))) {
        return true;
    }
    return false;
}

/** Détecte si un état est le gabarit starter synthétique (Alex / init-cat-logement / init-debt-auto). */
export function isStarterTemplateState(candidate: Partial<AppState> | null | undefined): boolean {
    if (!candidate) return false;
    const firstUserName = candidate.config?.users?.[0]?.name ?? '';
    const hasStarterBudget = (candidate.budgetItems ?? []).some((b) => b.id === 'init-cat-logement');
    const hasStarterDebt = (candidate.debts ?? []).some((d) => d.id === 'init-debt-auto');
    const hasStarterGoal = (candidate.financialGoals ?? []).some((g) => g.id === 'init-goal-urgence');
    const hasBrokerLedger = Array.isArray(candidate.brokerLedger) && candidate.brokerLedger.length > 0;
    if (hasBrokerLedger) return false;
    if (firstUserName === 'Alex' && (hasStarterBudget || hasStarterDebt || hasStarterGoal)) {
        return true;
    }
    return (hasStarterBudget && hasStarterDebt) || (hasStarterDebt && hasStarterGoal);
}

/** Détecte la présence de la propriété fictive `init-prop-principale` (+203 k$ → ~430 k$). */
export function hasInflatedStarterProperty(candidate: Partial<AppState> | null | undefined): boolean {
    if (!candidate) return false;
    return (candidate.realEstateGoals ?? []).some((g) => g.id === 'init-prop-principale');
}

/** Retire la propriété fictive `init-prop-principale` (+203 k$) et assainit les artefacts de test. */
export function cleanCandidateState(raw: Partial<AppState>): Partial<AppState> {
    const rawCopy: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof val === 'function') continue;
        if (
            key === 'apiKeys' ||
            key === 'activeTab' ||
            key === 'isPrivacyMode' ||
            key === 'lastProjection' ||
            key === 'projectionStatus' ||
            key === 'projectionRefus' ||
            key === 'lockedProjection' ||
            key === 'pendingFocus' ||
            key === 'isTestMode' ||
            key === 'activeTestPersonaId' ||
            key === 'realDataSnapshot'
        ) {
            continue;
        }
        rawCopy[key] = val;
    }

    const { state: sanitized } = sanitizePersonaArtifacts(rawCopy as Partial<AppState>);
    const cleaned: Partial<AppState> = { ...sanitized };

    if (hasInflatedStarterProperty(cleaned)) {
        const remaining = (cleaned.realEstateGoals ?? []).filter((g) => g.id !== 'init-prop-principale');
        cleaned.realEstateGoals =
            remaining.length > 0 ? remaining : [structuredClone(INITIAL_REAL_ESTATE_GOAL)];
    }

    if (isStarterTemplateState(cleaned)) {
        const hasInvertedSalary = (cleaned.transactions ?? []).some(
            (t) => t.payee === 'Paie nette déposée' && t.amount < 0,
        );
        if (hasInvertedSalary || hasInflatedStarterProperty(raw)) {
            return buildStarterState();
        }
    }

    return cleaned;
}

/** Calcule le patrimoine net complet (avoirs − dettes + équité immobilière) d'un candidat. */
export function computeCandidateNetWorth(candidate: Partial<AppState>): number {
    const todayIso = new Date().toISOString().slice(0, 10);
    const fxRates = candidate.fxRates ?? DEFAULT_FX_RATES;
    const termes = computePresentTermes(
        candidate.initialBalances ?? {},
        candidate.transactions ?? [],
        candidate.assets ?? [],
        fxRates,
        candidate.debts ?? [],
        0,
        todayIso,
    );
    const globalNw = termes.avoirs - termes.dettes;
    const realEstateEquity = (candidate.realEstateGoals ?? []).reduce((sum, g) => {
        const t = presentTermesOfGoal(g, monthsSince(g.purchaseDate));
        return sum + (t.valeur - t.hypotheque);
    }, 0);
    return Math.round(globalNw + realEstateEquity);
}

/**
 * Enregistre automatiquement une empreinte protégée du dossier réel (hors mode test et hors gabarit Alex).
 * Le mode test et le gabarit de départ ne peuvent jamais écraser cette empreinte.
 */
export function saveProtectedDossierSnapshot(
    state: Partial<AppState> & { isTestMode?: boolean; activeTestPersonaId?: string | null },
): void {
    if (typeof localStorage === 'undefined') return;
    if (isTestPersonaState(state as Record<string, unknown>)) return;
    if (isStarterTemplateState(state)) return;
    if (hasInflatedStarterProperty(state)) return;
    if (!hasMeaningfulData(state)) return;

    try {
        const cleaned = cleanCandidateState(state);
        const payload = {
            timestamp: Date.now(),
            state: cleaned,
        };
        localStorage.setItem(PROTECTED_DOSSIER_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Ignorer si quota atteint
    }
}

/** Lit l'empreinte protégée du dossier réel si elle existe (et qu'elle n'est pas le gabarit Alex). */
function loadProtectedDossierSnapshot(): { timestamp: number; state: Partial<AppState> } | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const raw = localStorage.getItem(PROTECTED_DOSSIER_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { timestamp?: number; state?: Partial<AppState> };
        if (!parsed || typeof parsed.state !== 'object' || !parsed.state) return null;
        if (isTestPersonaState(parsed.state as Record<string, unknown>)) return null;
        const cleaned = cleanCandidateState(parsed.state);
        if (!hasMeaningfulData(cleaned)) return null;
        return {
            timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
            state: cleaned,
        };
    } catch {
        return null;
    }
}

/** Extrait un `Partial<AppState>` depuis n'importe quel format d'enveloppe (`{ store: { state } }`, `{ payload: { state } }`, `{ state }`, ou racine). */
function extractStateFromAnyEnvelope(raw: unknown): Partial<AppState> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    if (obj.store && typeof obj.store === 'object' && obj.store !== null) {
        const storeObj = obj.store as Record<string, unknown>;
        if (storeObj.state && typeof storeObj.state === 'object' && storeObj.state !== null) {
            return storeObj.state as Partial<AppState>;
        }
    }
    if (obj.payload && typeof obj.payload === 'object' && obj.payload !== null) {
        const payloadObj = obj.payload as Record<string, unknown>;
        if (payloadObj.state && typeof payloadObj.state === 'object' && payloadObj.state !== null) {
            return payloadObj.state as Partial<AppState>;
        }
        return payloadObj as Partial<AppState>;
    }
    if (obj.state && typeof obj.state === 'object' && obj.state !== null) {
        return obj.state as Partial<AppState>;
    }
    return obj as Partial<AppState>;
}

/**
 * Inspecte le bouclier (`realDataSnapshot`, empreinte protégée, sauvegardes auto IndexedDB et clés legacy)
 * pour lister tous les points de restauration valides hors mode test.
 */
export async function listRecoverableSnapshots(): Promise<RecoverableSnapshotInfo[]> {
    const out: RecoverableSnapshotInfo[] = [];
    const seenSignatures = new Set<string>();

    const addCandidate = (
        raw: unknown,
        id: string,
        label: string,
        timestamp: number,
    ) => {
        const extracted = extractStateFromAnyEnvelope(raw);
        if (!extracted) return;
        const record = extracted as Record<string, unknown>;

        if (record.realDataSnapshot && typeof record.realDataSnapshot === 'object') {
            addCandidate(
                record.realDataSnapshot,
                `${id}_realDataSnapshot`,
                `${label} (avant mode test)`,
                timestamp,
            );
        }

        if (isTestPersonaState(record)) return;

        const cleaned = cleanCandidateState(extracted);
        if (!hasMeaningfulData(cleaned)) return;

        const netWorth = computeCandidateNetWorth(cleaned);
        const txCount = (cleaned.transactions ?? []).length;
        const assetsCount =
            (cleaned.assets ?? []).length + ((cleaned.brokerLedger ?? []).length > 0 ? 1 : 0);
        const isCustom = !isStarterTemplateState(cleaned);
        const firstUser = cleaned.config?.users?.[0]?.name ?? '';
        const sig = `${firstUser}:${netWorth}:${txCount}:${assetsCount}:${isCustom ? 'custom' : 'starter'}`;
        if (seenSignatures.has(sig)) return;
        seenSignatures.add(sig);

        out.push({
            id,
            label,
            timestamp,
            netWorth,
            transactionsCount: txCount,
            assetsCount: (cleaned.assets ?? []).length,
            isCustomUserDossier: isCustom,
            state: cleaned,
        });
    };

    const current = useFinanceStore.getState();
    if (current.realDataSnapshot) {
        addCandidate(
            current.realDataSnapshot,
            'store-real-snapshot',
            'Dossier verrouillé avant le mode test',
            Date.now(),
        );
    }

    const protectedSnap = loadProtectedDossierSnapshot();
    if (protectedSnap) {
        addCandidate(
            protectedSnap.state,
            'protected-dossier',
            'Empreinte protégée automatique',
            protectedSnap.timestamp,
        );
    }

    try {
        const backups = await listBackups();
        if (backups.length > 0) {
            let deviceKey: CryptoKey | null = null;
            try {
                deviceKey = await getOrCreateDeviceKey();
            } catch {
                deviceKey = null;
            }
            const sortedBackups = [...backups].sort((a, b) => b.timestamp - a.timestamp);
            for (const entry of sortedBackups) {
                try {
                    const plaintext = await readStoredPayload(entry, deviceKey);
                    const parsed = JSON.parse(plaintext) as unknown;
                    addCandidate(
                        parsed,
                        entry.id,
                        `Instantané local (${new Date(entry.timestamp).toLocaleDateString('fr-CA')})`,
                        entry.timestamp,
                    );
                } catch {
                    // Ignorer une entrée illisible
                }
            }
        }
    } catch {
        // IndexedDB indisponible
    }

    if (typeof localStorage !== 'undefined') {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('__financeai_backup_')) {
                    const rawDump = localStorage.getItem(key);
                    if (!rawDump) continue;
                    const parsedDump = JSON.parse(rawDump) as {
                        dump?: Record<string, string | null>;
                    };
                    const persistRaw = parsedDump.dump?.[STORAGE_KEYS.persistStore];
                    if (persistRaw) {
                        addCandidate(
                            JSON.parse(persistRaw),
                            key,
                            'Archive de secours localStorage',
                            Date.now() - 60_000,
                        );
                    }
                }
            }
        } catch {
            // Ignorer
        }
    }

    out.sort((a, b) => {
        if (a.isCustomUserDossier !== b.isCustomUserDossier) {
            return a.isCustomUserDossier ? -1 : 1;
        }
        return b.timestamp - a.timestamp;
    });

    return out;
}

/** Applique un état restauré dans le store Zustand, met à jour localStorage et désactive tout mode test. */
function applyRecoveredState(candidate: Partial<AppState>): void {
    const cleaned = cleanCandidateState(candidate);
    useFinanceStore.setState((prev) => ({
        ...prev,
        ...cleaned,
        apiKeys: prev.apiKeys,
        isTestMode: false,
        activeTestPersonaId: null,
        realDataSnapshot: null,
        lastUpdate: Date.now(),
    }));
    if (!isStarterTemplateState(cleaned)) {
        saveProtectedDossierSnapshot(cleaned);
    }
}

/** Restaure un point de sauvegarde spécifique choisi par l'utilisateur. */
export function restoreSpecificSnapshot(snapshot: RecoverableSnapshotInfo): void {
    applyRecoveredState(snapshot.state);
}

/**
 * Fouille Google Drive (`appDataFolder`) avec le jeton Google actif
 * pour retrouver et restaurer le vrai dossier de l'utilisateur (hors gabarit Alex).
 */
export async function chercherEtRestaurerDepuisGoogleDrive(): Promise<{
    restored: boolean;
    netWorth: number;
    sourceLabel: string;
} | null> {
    const token = getCachedToken();
    if (!token) return null;

    // 1. Fichier principal `financeai-sync.json` dans `appDataFolder`
    try {
        const syncRef = await findSyncFile(token);
        if (syncRef) {
            const envelope = await readSyncFile(token, syncRef.id);
            if (envelope.enc) {
                await pullNow();
                const afterPull = useFinanceStore.getState();
                if (!isStarterTemplateState(afterPull) && hasMeaningfulData(afterPull)) {
                    return {
                        restored: true,
                        netWorth: computeCandidateNetWorth(afterPull),
                        sourceLabel: 'Google Drive (sauvegarde chiffrée)',
                    };
                }
            } else if (envelope.payload) {
                const candidate = extractStateFromAnyEnvelope(envelope.payload);
                if (candidate && hasMeaningfulData(candidate) && !isStarterTemplateState(candidate)) {
                    await pullNow();
                    const afterPull = useFinanceStore.getState();
                    return {
                        restored: true,
                        netWorth: computeCandidateNetWorth(afterPull),
                        sourceLabel: 'Google Drive (synchronisation principale)',
                    };
                }
            }
        }
    } catch {
        // Continuer vers les fichiers de secours Drive
    }

    // 2. Autres fichiers `.json` / `.bak.json` dans `appDataFolder`
    try {
        const appDataFiles = await listAppDataFiles(token, '.json');
        const sortedFiles = [...appDataFiles].sort((a, b) =>
            (b.modifiedTime || '').localeCompare(a.modifiedTime || ''),
        );
        for (const file of sortedFiles) {
            try {
                const rawContent = await readAppDataFile<unknown>(token, file.id);
                const candidate = extractStateFromAnyEnvelope(rawContent);
                if (
                    candidate &&
                    !isTestPersonaState(candidate as Record<string, unknown>) &&
                    hasMeaningfulData(candidate) &&
                    !isStarterTemplateState(candidate)
                ) {
                    applyRecoveredState(candidate);
                    return {
                        restored: true,
                        netWorth: computeCandidateNetWorth(useFinanceStore.getState()),
                        sourceLabel: `Google Drive (${file.name})`,
                    };
                }
            } catch {
                // Fichier suivant
            }
        }
    } catch {
        // appDataFolder inaccessible ou hors-ligne
    }

    return null;
}

/**
 * Restaure automatiquement le vrai dossier de l'utilisateur depuis `realDataSnapshot`,
 * IndexedDB, l'empreinte protégée ou Google Drive, en remplaçant systématiquement
 * le gabarit synthétique (`Alex`) dès qu'une vraie sauvegarde existe.
 */
export async function recoverUser230kData(force = false): Promise<{
    restored: boolean;
    netWorth: number;
    sourceLabel: string;
}> {
    ensureDefaultGoogleAuthConfigured();
    try {
        const savedClientId = localStorage.getItem(GOOGLE_DRIVE_CLIENT_ID_STORAGE_KEY)?.trim();
        if (savedClientId) {
            initSync(savedClientId);
        }
    } catch {
        // localStorage indisponible
    }

    const current = useFinanceStore.getState();
    const currentHas430kBug = hasInflatedStarterProperty(current);
    const currentIsStarter = isStarterTemplateState(current);

    if (
        current.realDataSnapshot &&
        hasMeaningfulData(current.realDataSnapshot) &&
        !isStarterTemplateState(current.realDataSnapshot)
    ) {
        const cleanedSnap = cleanCandidateState(current.realDataSnapshot);
        applyRecoveredState(cleanedSnap);
        return {
            restored: true,
            netWorth: computeCandidateNetWorth(cleanedSnap),
            sourceLabel: 'Bouclier anti-mode test',
        };
    }

    if (currentHas430kBug) {
        const cleanedCurrent = cleanCandidateState(current);
        applyRecoveredState(cleanedCurrent);
    }

    // 1. Recherche prioritaire d'un vrai dossier personnalisé dans IndexedDB / localStorage
    const candidates = await listRecoverableSnapshots();
    const customCandidate = candidates.find((c) => c.isCustomUserDossier);
    if (
        customCandidate &&
        (force || currentIsStarter || currentHas430kBug || current.isTestMode || !hasMeaningfulData(current))
    ) {
        applyRecoveredState(customCandidate.state);
        return {
            restored: true,
            netWorth: customCandidate.netWorth,
            sourceLabel: customCandidate.label,
        };
    }

    // 2. Recherche dans Google Drive si le dossier courant est encore le gabarit de départ ou sur demande explicite
    if (force || currentIsStarter || !hasMeaningfulData(current)) {
        const driveRecovered = await chercherEtRestaurerDepuisGoogleDrive();
        if (driveRecovered) {
            return driveRecovered;
        }
    }

    if (force && candidates.length > 0) {
        const best = candidates[0]!;
        applyRecoveredState(best.state);
        return {
            restored: true,
            netWorth: best.netWorth,
            sourceLabel: best.label,
        };
    }

    if (currentHas430kBug) {
        const updated = useFinanceStore.getState();
        return {
            restored: true,
            netWorth: computeCandidateNetWorth(updated),
            sourceLabel: 'Dossier protégé',
        };
    }

    if (force && !hasMeaningfulData(current)) {
        const starter = buildStarterState();
        applyRecoveredState(starter);
        return {
            restored: true,
            netWorth: computeCandidateNetWorth(starter),
            sourceLabel: 'Dossier initial',
        };
    }

    if (!currentIsStarter) {
        saveProtectedDossierSnapshot(current);
    }
    return {
        restored: false,
        netWorth: computeCandidateNetWorth(current),
        sourceLabel: 'Dossier actif',
    };
}
