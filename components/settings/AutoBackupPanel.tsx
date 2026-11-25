// P1.3 — Panel UI pour les backups automatiques rolling IndexedDB.
//
// Affiche la liste des backups (du plus récent au plus ancien),
// permet de : restaurer un backup, supprimer, créer un nouveau manuellement,
// vider tout.

import React, { useEffect, useState, useCallback } from 'react';
import { Card } from '../ui/Card';
import { ConfirmModal } from '../ui/ConfirmModal';
import { showToast } from '../ui/Toast';
import { formatDate } from '../../utils/format';
import { Icon } from '../ui/Icon';
import {
    listBackups, createBackupNow, deleteBackup, clearAllBackups, restoreBackup,
    getBackupStats, type BackupEntry,
} from '../../services/backupAuto';

export const AutoBackupPanel: React.FC = () => {
    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [stats, setStats] = useState<{ count: number; totalBytes: number; oldest?: number; newest?: number }>({ count: 0, totalBytes: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [confirmRestore, setConfirmRestore] = useState<BackupEntry | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<BackupEntry | null>(null);
    const [confirmClearAll, setConfirmClearAll] = useState(false);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        const [list, s] = await Promise.all([listBackups(), getBackupStats()]);
        setBackups(list);
        setStats(s);
        setIsLoading(false);
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    const handleCreate = async () => {
        setIsCreating(true);
        const r = await createBackupNow('manual', { intent: 'archive', donneesFictives: false });
        setIsCreating(false);
        if (r.ok) {
            showToast(`Backup créé (${(r.entry.sizeBytes / 1024).toFixed(1)} KB).`, 'success');
            refresh();
        } else {
            showToast("Impossible de créer le backup (localStorage vide ou IndexedDB indispo).", 'error');
        }
    };

    const handleRestore = async () => {
        if (!confirmRestore) return;
        const ok = await restoreBackup(confirmRestore.id, false);
        setConfirmRestore(null);
        if (!ok) showToast('Restauration échouée.', 'error');
        // Si ok → window.location.reload() est déjà déclenché par restoreBackup
    };

    const handleDelete = async () => {
        if (!confirmDelete) return;
        await deleteBackup(confirmDelete.id);
        setConfirmDelete(null);
        showToast('Backup supprimé.', 'info');
        refresh();
    };

    const handleClearAll = async () => {
        await clearAllBackups();
        setConfirmClearAll(false);
        showToast('Tous les backups supprimés.', 'info');
        refresh();
    };

    return (
        <Card
            icon={<Icon name="lifebuoy" size={18} className="text-repere" />}
            title="Instantanés automatiques locaux (IndexedDB · 7 jours glissants)"
        >
            <ConfirmModal
                isOpen={!!confirmRestore}
                onConfirm={handleRestore}
                onCancel={() => setConfirmRestore(null)}
                title="Restaurer ce backup ?"
                message={confirmRestore ? `Restaurer le backup du ${formatDate(confirmRestore.timestamp)} ? L'état actuel sera écrasé. Un backup auto de l'état courant sera créé avant la restauration. La page va recharger.` : ''}
                confirmLabel="Restaurer"
            />
            <ConfirmModal
                isOpen={!!confirmDelete}
                onConfirm={handleDelete}
                onCancel={() => setConfirmDelete(null)}
                title="Supprimer ce backup ?"
                message={confirmDelete ? `Supprimer le backup du ${formatDate(confirmDelete.timestamp)} ? Cette action est irréversible.` : ''}
                confirmLabel="Supprimer"
            />
            <ConfirmModal
                isOpen={confirmClearAll}
                onConfirm={handleClearAll}
                onCancel={() => setConfirmClearAll(false)}
                title="Vider tous les backups ?"
                message={`Supprimer définitivement les ${backups.length} backup(s) ? Action irréversible.`}
                confirmLabel="Vider"
            />

            <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-bordure">
                    <p className="text-meta text-ink-300 leading-relaxed">
                        Un instantané chiffré en mémoire locale est enregistré chaque jour ainsi
                        qu’avant toute restauration pour garantir un retour arrière immédiat.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                            type="button"
                            onClick={handleCreate}
                            disabled={isCreating}
                            className="px-3.5 py-2 bg-repere-fond hover:opacity-90 border border-bordure-lien text-repere text-xs font-semibold rounded-xl transition-opacity focus-ring disabled:opacity-50"
                        >
                            {isCreating ? 'Création…' : '+ Backup maintenant'}
                        </button>
                        <button
                            type="button"
                            onClick={refresh}
                            className="px-3.5 py-2 bg-surface-douce hover:bg-bordure border border-bordure text-ink-200 text-xs font-semibold rounded-xl transition-colors focus-ring"
                        >
                            ↻ Rafraîchir
                        </button>
                        {backups.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setConfirmClearAll(true)}
                                className="px-3.5 py-2 bg-erreur-fond hover:opacity-90 border border-bordure text-erreur-texte text-xs font-semibold rounded-xl transition-opacity focus-ring"
                            >
                                Vider tout
                            </button>
                        )}
                    </div>
                </div>

                {/* Métriques des instantanés locaux */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-fond rounded-2xl p-3.5 border border-bordure">
                        <div className="text-tiny font-semibold text-ink-400 uppercase tracking-wider">
                            Instantanés
                        </div>
                        <div className="text-lg font-bold text-ink-50 font-mono mt-0.5">
                            {stats.count}
                        </div>
                    </div>
                    <div className="bg-fond rounded-2xl p-3.5 border border-bordure">
                        <div className="text-tiny font-semibold text-ink-400 uppercase tracking-wider">
                            Volume local
                        </div>
                        {/* NOMBRE-NON-MONETAIRE */}
                        <div className="text-lg font-bold text-ink-50 font-mono mt-0.5">
                            {(stats.totalBytes / 1024).toFixed(1)} KB
                        </div>
                    </div>
                    <div className="bg-fond rounded-2xl p-3.5 border border-bordure">
                        <div className="text-tiny font-semibold text-ink-400 uppercase tracking-wider">
                            Plus récent
                        </div>
                        <div className="text-sm font-bold text-ink-50 mt-1">
                            {stats.newest ? formatDate(stats.newest) : '—'}
                        </div>
                    </div>
                    <div className="bg-fond rounded-2xl p-3.5 border border-bordure">
                        <div className="text-tiny font-semibold text-ink-400 uppercase tracking-wider">
                            Plus ancien
                        </div>
                        <div className="text-sm font-bold text-ink-50 mt-1">
                            {stats.oldest ? formatDate(stats.oldest) : '—'}
                        </div>
                    </div>
                </div>

                {/* Journal chronologique des instantanés */}
                {isLoading ? (
                    <div className="text-meta text-ink-400 py-6 text-center">
                        Chargement des instantanés locaux…
                    </div>
                ) : backups.length === 0 ? (
                    <div className="rounded-2xl bg-fond border border-bordure p-6 text-center space-y-1.5">
                        <p className="text-sm font-semibold text-ink-200">
                            Aucun instantané local enregistré
                        </p>
                        <p className="text-tiny text-ink-400">
                            Un instantané automatique sera créé au prochain démarrage ou en cliquant
                            sur « + Backup maintenant ».
                        </p>
                    </div>
                ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-1">
                        {backups.map((entry) => (
                            <div
                                key={entry.id}
                                className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 p-3 bg-fond rounded-2xl border border-bordure hover:border-bordure-champ transition-colors text-meta"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-9 h-9 rounded-xl bg-surface border border-bordure flex items-center justify-center shrink-0">
                                        <Icon
                                            name={entry.source === 'auto' ? 'clock' : 'check'}
                                            size={16}
                                            className={
                                                entry.source === 'auto'
                                                    ? 'text-repere'
                                                    : 'text-succes-texte'
                                            }
                                            aria-hidden="true"
                                        />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-ink-50 font-semibold font-mono text-xs sm:text-sm">
                                                {formatDate(entry.timestamp)}{' '}
                                                {new Date(entry.timestamp).toLocaleTimeString(
                                                    'fr-CA',
                                                    { hour: '2-digit', minute: '2-digit' },
                                                )}
                                            </span>
                                            <span
                                                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
                                                    entry.source === 'auto'
                                                        ? 'bg-repere-fond text-repere border-bordure-lien'
                                                        : 'bg-succes-fond text-succes-texte border-bordure'
                                                }`}
                                            >
                                                {entry.source === 'auto' ? 'Auto' : 'Manuel'}
                                            </span>
                                        </div>
                                        {/* NOMBRE-NON-MONETAIRE */}
                                        <div className="text-tiny text-ink-400 font-mono mt-0.5">
                                            {(entry.sizeBytes / 1024).toFixed(1)} KB · IndexedDB
                                            local
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0 ml-auto">
                                    <button
                                        type="button"
                                        onClick={() => setConfirmRestore(entry)}
                                        className="px-3 py-1.5 text-xs font-semibold bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl text-ink-100 transition-colors focus-ring"
                                        title="Restaurer ce backup (reload)"
                                    >
                                        ↻ Restaurer
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setConfirmDelete(entry)}
                                        className="px-2.5 py-1.5 text-xs text-ink-400 hover:text-erreur-texte hover:bg-erreur-fond border border-transparent hover:border-bordure transition-colors focus-ring rounded-xl"
                                        title="Supprimer ce backup"
                                        aria-label={`Supprimer le backup du ${formatDate(entry.timestamp)}`}
                                    >
                                        <Icon name="trash" size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Card>
    );
};
