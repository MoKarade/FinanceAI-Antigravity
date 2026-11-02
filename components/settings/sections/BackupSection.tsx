// components/settings/sections/BackupSection.tsx
// Onglet Sauvegarde :
// 1. État du dossier actif et indicateur de protection (bouclier anti-mode test + persistance)
// 2. Récupération directe des points de sauvegarde détectés (IndexedDB, localStorage, Google Drive)
// 3. Synchronisation unifiée Cloud Firestore + Cloud SQL (PostgreSQL) via compte Google
// 4. Carte de synchronisation Google Drive
// 5. Instantanés locaux (AutoBackupPanel) et export/import de fichiers (BackupPanel)

import React, { useEffect, useState, useCallback } from 'react';
import { GoogleDriveSyncCard } from '../GoogleDriveSyncCard';
import { AutoBackupPanel } from '../AutoBackupPanel';
import { BackupPanel } from '../BackupPanel';
import { useFirebaseAuth } from '../../auth/FirebaseAuthGate';
import { useFinanceStore } from '../../../store/useFinanceStore';
import {
  recoverUser230kData,
  chercherEtRestaurerDepuisGoogleDrive,
  listRecoverableSnapshots,
  restoreSpecificSnapshot,
  computeCandidateNetWorth,
  isStarterTemplateState,
  ensureDefaultGoogleAuthConfigured,
  type RecoverableSnapshotInfo,
} from '../../../services/dataRecovery';
import {
  getSyncStatus,
  subscribeSyncStatus,
  connectAndSync,
  type SyncStatus,
} from '../../../services/sync/syncOrchestrator';
import {
  queryStoragePersisted,
  requestPersistentStorage,
  type EtatPersistance,
} from '../../../services/storagePersistence';
import { formatCAD, formatDate } from '../../../utils/format';
import { PrivateAmount } from '../../ui/PrivateAmount';
import { showToast } from '../../ui/Toast';
import { Icon } from '../../ui/Icon';
import { Card } from '../../ui/Card';

export const BackupSection: React.FC = () => {
  ensureDefaultGoogleAuthConfigured();

  const state = useFinanceStore();
  const {
    user,
    syncStatus: cloudStatus,
    isSigningIn,
    signInWithGoogle,
    signOutUser,
    syncWorkspaceNow,
    restoreFromCloudSqlNow,
  } = useFirebaseAuth();

  const transactionsCount = state.transactions.length;
  const assetsCount = state.assets.length;
  const debtsCount = state.debts.length;
  const documentsCount = (state.documents ?? []).length;
  const isCurrentStarter = isStarterTemplateState(state);

  const [isRecovering, setIsRecovering] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getSyncStatus);
  const [storageState, setStorageState] = useState<EtatPersistance>('inconnue');
  const [recoverableSnapshots, setRecoverableSnapshots] = useState<RecoverableSnapshotInfo[]>([]);

  const currentNetWorth = computeCandidateNetWorth(state);

  const refreshRecoverableList = useCallback(async () => {
    const list = await listRecoverableSnapshots();
    setRecoverableSnapshots(list);
  }, []);

  useEffect(() => {
    ensureDefaultGoogleAuthConfigured();
    setSyncStatus(getSyncStatus());
    void refreshRecoverableList();
    return subscribeSyncStatus(setSyncStatus);
  }, [refreshRecoverableList, transactionsCount, assetsCount]);

  useEffect(() => {
    let cancelled = false;
    void queryStoragePersisted().then((res) => {
      if (!cancelled) setStorageState(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRestoreProtectedDossier = async () => {
    setIsRecovering(true);
    try {
      const driveRes = await chercherEtRestaurerDepuisGoogleDrive();
      if (driveRes?.restored) {
        if (user) {
          await syncWorkspaceNow();
        }
        await refreshRecoverableList();
        showToast(
          `Dossier retrouvé (${driveRes.sourceLabel} · ${formatCAD(driveRes.netWorth)}).`,
          'success',
        );
        return;
      }
      const res = await recoverUser230kData(true);
      if (user && res.restored) {
        await syncWorkspaceNow();
      }
      await refreshRecoverableList();
      showToast(
        `Dossier rétabli (${res.sourceLabel} · ${formatCAD(res.netWorth)}).`,
        'success',
      );
    } finally {
      setIsRecovering(false);
    }
  };

  const handleRestoreSpecificPoint = async (snap: RecoverableSnapshotInfo) => {
    restoreSpecificSnapshot(snap);
    if (user) {
      await syncWorkspaceNow();
    }
    await refreshRecoverableList();
    showToast(
      `Sauvegarde restaurée (${snap.label} · ${formatCAD(snap.netWorth)}).`,
      'success',
    );
  };

  const handleRequestPersistentStorage = async () => {
    const res = await requestPersistentStorage();
    setStorageState(res);
    if (res === 'accordee') {
      showToast('Stockage persistant confirmé par le navigateur.', 'success');
    } else {
      showToast('Persistance gérée automatiquement par le navigateur.', 'info');
    }
  };

  const handleConnectGoogleAccount = async () => {
    ensureDefaultGoogleAuthConfigured();
    await signInWithGoogle();
    await refreshRecoverableList();
  };

  const handleConnectDriveDirect = async () => {
    ensureDefaultGoogleAuthConfigured();
    await connectAndSync();
    const driveRecovered = await chercherEtRestaurerDepuisGoogleDrive();
    if (driveRecovered?.restored) {
      showToast(
        `Dossier Google Drive restauré (${driveRecovered.sourceLabel} · ${formatCAD(driveRecovered.netWorth)}).`,
        'success',
      );
    } else if (getSyncStatus().connected) {
      showToast('Google Drive connecté et synchronisé.', 'success');
    }
    await refreshRecoverableList();
  };

  return (
    <div className="space-y-6" data-testid="backup-page-redesigned">
      <section
        aria-label="État du dossier actif et bouclier de protection"
        className="rounded-3xl bg-surface border border-bordure p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-bordure">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-tiny font-semibold uppercase tracking-wider text-succes-texte">
              <Icon name="shield" size={14} aria-hidden="true" />
              <span>
                {state.isTestMode
                  ? 'Mode test actif · Dossier réel verrouillé en sécurité'
                  : isCurrentStarter
                    ? 'Profil de départ détecté · Recherche de sauvegarde disponible'
                    : 'Protection automatique active'}
                {' · '}
                <PrivateAmount>{formatCAD(currentNetWorth)}</PrivateAmount>
              </span>
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-ink-50 tracking-tight">
              État du dossier &amp; Protection
            </h3>
            <p className="text-meta text-ink-300 max-w-2xl leading-relaxed">
              Chaque modification de votre dossier est enregistrée automatiquement et isolée du mode
              test. Si un profil de départ ou de démonstration est affiché, cliquez sur le bouton
              ci-contre pour fouiller Google Drive et vos sauvegardes locales.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={isRecovering}
              onClick={() => void handleRestoreProtectedDossier()}
              className="touch-target h-11 px-4 rounded-2xl bg-succes-fond text-succes-texte border border-bordure text-xs font-semibold inline-flex items-center gap-2 hover:opacity-90 transition-opacity focus-ring whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Icon name="lifebuoy" size={15} aria-hidden="true" />
              <span>
                {isRecovering
                  ? 'Recherche et restauration…'
                  : state.isTestMode
                    ? 'Quitter le mode test et rétablir mon dossier'
                    : 'Retrouver mes données (Drive & sauvegardes)'}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <div className="rounded-2xl bg-fond border border-bordure p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-tiny font-semibold uppercase tracking-wider text-ink-400">
                1. Inventaire du dossier actif
              </span>
              <Icon name="package" size={16} className="text-succes-texte" aria-hidden="true" />
            </div>
            {/* NOMBRE-NON-MONETAIRE */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div className="flex items-center justify-between text-ink-300">
                <span>Transactions</span>
                <span className="font-mono font-semibold text-ink-50">{transactionsCount}</span>
              </div>
              <div className="flex items-center justify-between text-ink-300">
                <span>Actifs</span>
                <span className="font-mono font-semibold text-ink-50">{assetsCount}</span>
              </div>
              <div className="flex items-center justify-between text-ink-300">
                <span>Dettes</span>
                <span className="font-mono font-semibold text-ink-50">{debtsCount}</span>
              </div>
              <div className="flex items-center justify-between text-ink-300">
                <span>Documents</span>
                <span className="font-mono font-semibold text-ink-50">{documentsCount}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-fond border border-bordure p-4 flex flex-col justify-between gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-tiny font-semibold uppercase tracking-wider text-ink-400">
                2. Garanties anti-perte
              </span>
              <Icon name="lock" size={16} className="text-repere" aria-hidden="true" />
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between gap-2 text-ink-300">
                <span>Bouclier anti-mode test</span>
                <span className="font-semibold text-succes-texte">Actif</span>
              </div>
              <div className="flex items-center justify-between gap-2 text-ink-300">
                <span>Stockage navigateur</span>
                {storageState === 'accordee' ? (
                  <span className="font-semibold text-succes-texte">Persistant</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleRequestPersistentStorage()}
                    className="touch-target h-11 px-2.5 rounded-lg text-tiny font-semibold text-repere underline underline-offset-2 hover:opacity-80"
                  >
                    Activer la persistance
                  </button>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 text-ink-300">
                <span>Cloud Firestore &amp; Cloud SQL</span>
                <span className="font-semibold text-ink-50">
                  {user ? 'Synchronisés' : 'Prêts (1 clic Google)'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {recoverableSnapshots.length > 0 && (
          <div className="rounded-2xl bg-fond border border-bordure p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-tiny font-semibold uppercase tracking-wider text-ink-300">
                Points de restauration détectés sur cet appareil ({recoverableSnapshots.length})
              </span>
            </div>
            <div className="space-y-2">
              {recoverableSnapshots.slice(0, 6).map((snap) => (
                <div
                  key={snap.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface border border-bordure px-3.5 py-2.5 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink-50">{snap.label}</span>
                      {snap.isCustomUserDossier && (
                        <span className="px-2 py-0.5 rounded-md bg-succes-fond text-succes-texte border border-bordure text-tiny font-semibold">
                          Dossier personnel
                        </span>
                      )}
                    </div>
                    {/* NOMBRE-NON-MONETAIRE */}
                    <div className="text-tiny text-ink-400 font-mono">
                      {formatDate(snap.timestamp)} · {snap.transactionsCount} transactions ·{' '}
                      {snap.assetsCount} actifs · <PrivateAmount>{formatCAD(snap.netWorth)}</PrivateAmount>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRestoreSpecificPoint(snap)}
                    className="touch-target h-11 px-3.5 rounded-xl bg-repere-fond text-repere border border-bordure-lien text-xs font-semibold hover:opacity-90 focus-ring shrink-0"
                  >
                    Restaurer ce dossier
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <Card
        icon={<Icon name="cloud" size={18} />}
        title="Synchronisation Cloud Firestore & Cloud SQL"
      >
        <div className="space-y-4">
          <p className="text-tiny text-ink-300 leading-relaxed">
            Une seule connexion avec votre compte Google active la sauvegarde temps réel de votre
            dossier dans <strong>Cloud Firestore</strong>, <strong>Cloud SQL (PostgreSQL)</strong> et{' '}
            <strong>Google Drive</strong>, sans jamais avoir à ressaisir d’identifiant technique.
          </p>

          {!user ? (
            <button
              type="button"
              disabled={isSigningIn}
              onClick={() => void handleConnectGoogleAccount()}
              className="touch-target h-11 px-4 rounded-xl bg-repere-fond text-repere border border-bordure-lien text-xs font-semibold inline-flex items-center gap-2 hover:opacity-90 transition-opacity focus-ring whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Icon name="users" size={15} aria-hidden="true" />
              <span>
                {isSigningIn ? 'Connexion…' : 'Se connecter avec mon compte Google'}
              </span>
            </button>
          ) : (
            <div className="space-y-3">
              <div className="text-meta text-ink-200 space-y-0.5">
                <div>
                  Compte Google connecté :{' '}
                  <span className="font-mono font-semibold text-ink-50">
                    {user.email ?? user.uid}
                  </span>
                </div>
                <div className="text-tiny text-ink-400">
                  Firestore :{' '}
                  {cloudStatus.state === 'synced'
                    ? 'Synchronisé en temps réel'
                    : cloudStatus.state === 'syncing'
                      ? 'Synchronisation…'
                      : 'Actif'}{' '}
                  · Cloud SQL (PostgreSQL) :{' '}
                  {cloudStatus.sqlState === 'synced'
                    ? 'Sauvegardé'
                    : cloudStatus.sqlState === 'syncing'
                      ? 'Envoi…'
                      : 'Prêt'}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void syncWorkspaceNow()}
                  className="touch-target h-11 px-3.5 rounded-xl bg-surface-douce border border-bordure-champ text-ink-200 text-xs font-semibold hover:bg-bordure focus-ring"
                >
                  Synchroniser Firestore &amp; Cloud SQL
                </button>
                <button
                  type="button"
                  onClick={() => void restoreFromCloudSqlNow()}
                  className="touch-target h-11 px-3.5 rounded-xl bg-surface-douce border border-bordure-champ text-ink-200 text-xs font-semibold hover:bg-bordure focus-ring"
                >
                  Restaurer depuis Cloud SQL
                </button>
                <button
                  type="button"
                  onClick={() => void signOutUser()}
                  className="touch-target h-11 px-3.5 rounded-xl bg-erreur-fond border border-bordure text-erreur-texte text-xs font-semibold hover:opacity-90 focus-ring"
                >
                  Déconnecter
                </button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {syncStatus.configured ? (
        <GoogleDriveSyncCard />
      ) : (
        <Card icon={<Icon name="cloud" size={18} />} title="Synchronisation Google Drive">
          <div className="space-y-4">
            <p className="text-tiny text-ink-300 leading-relaxed">
              Synchronisez votre dossier dans votre espace privé Google Drive en un clic.
            </p>
            <button
              type="button"
              disabled={syncStatus.busy}
              onClick={() => void handleConnectDriveDirect()}
              className="touch-target h-11 px-4 rounded-xl bg-repere-fond text-repere border border-bordure-lien text-xs font-semibold inline-flex items-center gap-2 hover:opacity-90 transition-opacity focus-ring whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Icon name="cloud" size={15} aria-hidden="true" />
              <span>{syncStatus.busy ? 'Connexion…' : 'Connecter Google Drive'}</span>
            </button>
          </div>
        </Card>
      )}

      <AutoBackupPanel />
      <BackupPanel />
    </div>
  );
};
