import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';
import { showToast } from '../ui/Toast';
import { useFinanceStore } from '../../store/useFinanceStore';
import { Tab } from '../../types';
import { formatRelative } from '../../utils/relativeTime';
import { fxSourceEffective } from '../../services/fx/provenance';
import { fetchFxRates } from '../../services/finance';
import { getSyncStatus, subscribeSyncStatus, pushNow, type SyncStatus } from '../../services/sync/syncOrchestrator';
import { getLocalPayload } from '../../services/sync/syncSnapshot';
import { modeDonneesFictives } from '../../store/modeTestActif';
import { STORAGE_KEYS } from '../../utils/storageKeys';
import { construireSauvegardeEtat, messageRefusSauvegarde } from '../../services/sauvegardeJson';
import { markBackupDone } from '../../services/backupReminder';
import { useFirebaseAuth } from '../auth/FirebaseAuthGate';

interface HubConnexionsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

/**
 * Centre unifié de Connexions, Synchronisation et Import rapide (style Google Finance).
 * Regroupe les 5 canaux d'ingestion et de sauvegarde de Marc avec leur statut de faisabilité
 * en direct et des actions immédiates en 1 clic.
 */
export const HubConnexionsModal: React.FC<HubConnexionsModalProps> = ({ isOpen, onClose }) => {
    const apiKeys = useFinanceStore((s) => s.apiKeys);
    const fintableRoles = useFinanceStore((s) => s.fintableRoles);
    const fintableReport = useFinanceStore((s) => s.fintableSyncReport);
    const fxRates = useFinanceStore((s) => s.fxRates);
    const assets = useFinanceStore((s) => s.assets);
    const transactions = useFinanceStore((s) => s.transactions);
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const updateFxRates = useFinanceStore((s) => s.updateFxRates);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);
    const setActiveTab = useFinanceStore((s) => s.setActiveTab);

    const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus);
    const [fxBusy, setFxBusy] = useState(false);
    const [driveBusy, setDriveBusy] = useState(false);
    const {
        user: firebaseUser,
        syncStatus: cloudStatus,
        syncWorkspaceNow,
        restoreInitialDataNow,
        signInWithGoogle,
    } = useFirebaseAuth();
    const isCloudConnected = Boolean(firebaseUser) || syncStatus.connected;

    useEffect(() => {
        if (!isOpen) return;
        setSyncStatus(getSyncStatus());
        return subscribeSyncStatus(setSyncStatus);
    }, [isOpen]);

    if (!isOpen) return null;

    const nbComptesFintable = Object.keys(fintableRoles ?? {}).length;
    const fintablePret = Boolean(apiKeys?.fintable) && nbComptesFintable > 0;
    const fxSource = fxSourceEffective({ fxRates });

    const allerVers = (tab: Tab, section?: string) => {
        onClose();
        if (section) {
            navigateWithFocus(tab, section);
        } else {
            setActiveTab(tab);
        }
    };

    const actualiserDevises = async () => {
        setFxBusy(true);
        try {
            const rates = await fetchFxRates();
            updateFxRates(rates);
            showToast(`Devises actualisées (USD = ${rates.USD.toFixed(4)} · EUR = ${rates.EUR.toFixed(4)})`, 'success');
        } catch {
            showToast('Impossible de joindre la Banque du Canada pour le moment.', 'error');
        } finally {
            setFxBusy(false);
        }
    };

    const sauvegarderDriveMaintenant = async () => {
        setDriveBusy(true);
        try {
            if (firebaseUser) {
                await syncWorkspaceNow();
            } else {
                await pushNow();
                showToast('Sauvegarde Google Drive synchronisée.', 'success');
            }
        } catch {
            showToast('Échec de la synchronisation Cloud.', 'error');
        } finally {
            setDriveBusy(false);
        }
    };

    const recupererDossierCloud = async () => {
        setDriveBusy(true);
        try {
            await restoreInitialDataNow();
        } finally {
            setDriveBusy(false);
        }
    };

    const exporterJsonMaintenant = () => {
        let blobPresent = false;
        try {
            blobPresent = localStorage.getItem(STORAGE_KEYS.persistStore) !== null;
        } catch {
            // stockage indisponible
        }
        const res = construireSauvegardeEtat(getLocalPayload().payload, modeDonneesFictives(), Date.now(), blobPresent);
        if (!res.ok) {
            showToast(messageRefusSauvegarde(res.cause), 'error');
            return;
        }
        const blob = new Blob([JSON.stringify(res.sauvegarde, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `financeai_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        markBackupDone();
        showToast('Sauvegarde JSON complète téléchargée.', 'success');
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Connexions, Synchronisation & Import rapide"
            size="lg"
        >
            <div className="space-y-4">
                <p className="text-xs sm:text-sm text-ink-300 leading-relaxed">
                    Toutes tes sources de données financières au même endroit. Importe un relevé en 1 clic, vérifie la
                    fraîcheur de tes connexions bancaires et boursières, ou sauvegarde ton état complet.
                </p>

                {/* 1. Import intelligent de relevés (CSV / PDF / Disnat / Paie / Feuillets) */}
                <div className="p-4 rounded-xl bg-surfaceHighlight border border-bordure space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-surface-douce text-repere" aria-hidden="true">
                                <Icon name="import" size={18} />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-ink-50">
                                    1. Import rapide de relevés (CSV &amp; PDF)
                                </h3>
                                <p className="text-xs text-ink-300">
                                    Relevés bancaires, cartes, courtier Disnat/Wealthsimple, feuillets fiscaux et talons de paie
                                </p>
                            </div>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold gf-delta-up">
                            100 % opérationnel
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => allerVers(Tab.TRANSACTIONS)}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="transactions" size={14} />
                            <span>Importer relevé bancaire ({isPrivacyMode ? '••' : `${transactions.length} tx`})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => allerVers(Tab.INVESTMENTS)}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="investments" size={14} />
                            <span>Importer positions courtier ({isPrivacyMode ? '••' : `${assets.length} actifs`})</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => allerVers(Tab.TAX)}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="tax" size={14} />
                            <span>Feuillets fiscaux &amp; paie</span>
                        </button>
                    </div>
                </div>

                {/* 2. Synchronisation bancaire Fintable */}
                <div className="p-4 rounded-xl bg-surfaceHighlight border border-bordure space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-surface-douce text-succes-texte" aria-hidden="true">
                                <Icon name="bank" size={18} />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-ink-50">
                                    2. Synchronisation bancaire Fintable
                                </h3>
                                <p className="text-xs text-ink-300">
                                    {fintableReport?.at
                                        ? `Dernière synchro : ${formatRelative(fintableReport.at)} · ${nbComptesFintable} compte(s) mappé(s)`
                                        : 'Relais sécurisé /api/fintable avec déduplication et réconciliation'}
                                </p>
                            </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${fintablePret ? 'gf-delta-up' : 'gf-delta-amber'}`}>
                            {fintablePret ? 'Configuré' : 'Jeton à lier'}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                            type="button"
                            onClick={() => allerVers(Tab.SETTINGS, 'fintable-card')}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="refresh" size={14} />
                            <span>{fintablePret ? 'Lancer ou gérer la synchro Fintable' : 'Configurer Fintable dans Réglages'}</span>
                        </button>
                    </div>
                </div>

                {/* 3. Cours de marché en direct & Taux de change Banque du Canada */}
                <div className="p-4 rounded-xl bg-surfaceHighlight border border-bordure space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-surface-douce text-alerte-texte" aria-hidden="true">
                                <Icon name="chart" size={18} />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-ink-50">
                                    3. Cours de marché &amp; Devises (Banque du Canada · Yahoo · Finnhub · CoinGecko)
                                </h3>
                                <p className="text-xs text-ink-300 font-mono tabular-nums">
                                    USD = {fxRates.USD.toFixed(4)} CAD · EUR = {fxRates.EUR.toFixed(4)} CAD ({fxSource === 'api' ? 'Banque du Canada en direct' : 'Taux de repli'})
                                </p>
                            </div>
                        </div>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold gf-delta-up">
                            En direct
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                            type="button"
                            disabled={fxBusy}
                            onClick={actualiserDevises}
                            className="gf-chip touch-target text-ink-100 disabled:opacity-50"
                        >
                            <Icon name="refresh" size={14} />
                            <span>{fxBusy ? 'Actualisation BdC…' : 'Actualiser taux Banque du Canada'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => allerVers(Tab.INVESTMENTS)}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="investments" size={14} />
                            <span>Gérer les cours du portefeuille</span>
                        </button>
                    </div>
                </div>

                {/* 4. Sauvegarde Cloud Google (Firestore & Drive) & Export JSON complet */}
                <div className="p-4 rounded-xl bg-surfaceHighlight border border-bordure space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-surface-douce text-repere" aria-hidden="true">
                                <Icon name="cloud" size={18} />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-ink-50">
                                    4. Cloud Google (Firestore &amp; Drive) &amp; Fichier JSON
                                </h3>
                                <p className="text-xs text-ink-300">
                                    {firebaseUser
                                        ? `Compte Google connecté (${firebaseUser.email ?? 'Session permanente'}) · Cloud Firestore ${cloudStatus.state === 'synced' ? 'synchronisé en temps réel' : 'actif'}`
                                        : syncStatus.connected
                                            ? `Google Drive connecté (${syncStatus.passphraseActive ? 'chiffré AES-GCM' : 'dossier privé appData'})`
                                            : 'Connexion Google unique permanente ou export local JSON 4.0 instantané'}
                                </p>
                            </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${isCloudConnected ? 'gf-delta-up' : 'gf-delta-neutral'}`}>
                            {isCloudConnected ? 'Cloud Google actif' : 'JSON local prêt'}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                            type="button"
                            disabled={driveBusy}
                            onClick={() => void recupererDossierCloud()}
                            className="gf-chip touch-target text-succes-texte disabled:opacity-50"
                        >
                            <Icon name="lifebuoy" size={14} />
                            <span>{driveBusy ? 'Récupération…' : 'Récupérer mon dossier Cloud / Drive'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={exporterJsonMaintenant}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="import" size={14} />
                            <span>Télécharger sauvegarde JSON</span>
                        </button>
                        {isCloudConnected ? (
                            <button
                                type="button"
                                disabled={driveBusy}
                                onClick={() => void sauvegarderDriveMaintenant()}
                                className="gf-chip touch-target text-ink-100 disabled:opacity-50"
                            >
                                <Icon name="cloud" size={14} />
                                <span>{driveBusy ? 'Synchronisation…' : 'Synchroniser Cloud Google'}</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void signInWithGoogle()}
                                className="gf-chip touch-target text-ink-100"
                            >
                                <Icon name="users" size={14} />
                                <span>Connecter mon compte Google</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
};
