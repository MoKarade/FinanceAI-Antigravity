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
    const setAppState = useFinanceStore((s) => s.setAppState);
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);
    const setActiveTab = useFinanceStore((s) => s.setActiveTab);

    const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus);
    const [fxBusy, setFxBusy] = useState(false);
    const [driveBusy, setDriveBusy] = useState(false);

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
            setAppState({ fxRates: rates });
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
            await pushNow();
            showToast('Sauvegarde Google Drive synchronisée.', 'success');
        } catch {
            showToast('Échec de l’envoi vers Google Drive.', 'error');
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
                            <span>Importer relevé bancaire ({transactions.length} tx)</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => allerVers(Tab.INVESTMENTS)}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="investments" size={14} />
                            <span>Importer positions courtier ({assets.length} actifs)</span>
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

                {/* 4. Sauvegarde Google Drive & Export JSON complet */}
                <div className="p-4 rounded-xl bg-surfaceHighlight border border-bordure space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5">
                            <span className="p-2 rounded-lg bg-surface-douce text-repere" aria-hidden="true">
                                <Icon name="cloud" size={18} />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-ink-50">
                                    4. Sauvegarde Google Drive &amp; Fichier JSON
                                </h3>
                                <p className="text-xs text-ink-300">
                                    {syncStatus.connected
                                        ? `Google Drive connecté (${syncStatus.passphraseActive ? 'chiffré AES-GCM' : 'dossier privé appData'})`
                                        : 'Export local JSON 4.0 instantané ou synchronisation Google Drive'}
                                </p>
                            </div>
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${syncStatus.connected ? 'gf-delta-up' : 'gf-delta-neutral'}`}>
                            {syncStatus.connected ? 'Drive actif' : 'JSON local prêt'}
                        </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                        <button
                            type="button"
                            onClick={exporterJsonMaintenant}
                            className="gf-chip touch-target text-ink-100"
                        >
                            <Icon name="import" size={14} />
                            <span>Télécharger sauvegarde JSON</span>
                        </button>
                        {syncStatus.connected ? (
                            <button
                                type="button"
                                disabled={driveBusy}
                                onClick={sauvegarderDriveMaintenant}
                                className="gf-chip touch-target text-ink-100 disabled:opacity-50"
                            >
                                <Icon name="cloud" size={14} />
                                <span>{driveBusy ? 'Synchronisation…' : 'Pousser vers Google Drive'}</span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                onClick={() => allerVers(Tab.SETTINGS)}
                                className="gf-chip touch-target text-ink-100"
                            >
                                <Icon name="settings" size={14} />
                                <span>Configurer Google Drive / Restaurer</span>
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </Modal>
    );
};
