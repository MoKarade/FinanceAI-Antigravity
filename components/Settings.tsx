// components/Settings.tsx
// G22-N4 — Refonte en sous-onglets thématiques. Settings est désormais un
// orchestrateur léger : il délègue chaque thème à une section dédiée sous
// components/settings/sections/ (la sauvegarde lit l'état persisté elle-même).
//
// Sous-onglets : Comptes et soldes | Patrimoine | Clés API | Sauvegarde
// (+ lien « Profil ↗ » hors tablist : c'est une autre page, pas un onglet).
// (« Hypothèses éco » du plan initial est sans objet ici : les hypothèses
// économiques vivent dans l'onglet Futur. « Patrimoine » accueille les panneaux
// W5.x qui n'avaient pas de section dédiée.)
//
// Deep-link cross-tab : si une bannière d'un autre onglet pointe vers un champ
// de Configuration (data-focus-section), on ouvre d'office le bon sous-onglet
// pour que usePendingFocus trouve l'élément et scrolle dessus.

import React, { useState } from 'react';
import { PageHeader } from './ui/PageHeader';
import { Icon, type IconName } from './ui/Icon';
import { SubTabs, TabPanel } from './ui/SubTabs';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { AppState, Transaction, Tab } from '../types';
import { useFinanceStore } from '../store/useFinanceStore';
import { usePendingFocus } from '../utils/usePendingFocus';
import { useViewportXl } from '../hooks/useViewportXl';
import { AccountsSection } from './settings/sections/AccountsSection';
import { PatrimoineSection } from './settings/sections/PatrimoineSection';
import { IntegrationsSection } from './settings/sections/IntegrationsSection';
import { FintableSyncCard } from './settings/FintableSyncCard';
import { FxRatesCard } from './settings/FxRatesCard';
import { BackupSection } from './settings/sections/BackupSection';

interface SettingsProps {
  apiKeys: AppState['apiKeys'];
  setApiKeys: (keys: AppState['apiKeys']) => void;
  config: AppState['config'];
  setConfig: (c: AppState['config']) => void;
  onImportData: (data: string) => void;
  initialBalances: Record<string, number>;
  setInitialBalances: (balances: Record<string, number>) => void;
  transactions: Transaction[];
}

type SubTab = 'compte' | 'banque' | 'ia' | 'sauvegarde';

const SUB_TABS: ReadonlyArray<{ id: SubTab; label: string; icon: IconName }> = [
  { id: 'compte', label: 'Compte', icon: 'bank' },
  { id: 'banque', label: 'Banque auto', icon: 'link' },
  { id: 'ia', label: 'Clé IA', icon: 'sparkles' },
  { id: 'sauvegarde', label: 'Sauvegarde', icon: 'cloud' },
];

/** Mappe un data-focus-section (deep-link) vers le sous-onglet qui le contient. */
function subTabForSection(section: string | null | undefined): SubTab | null {
  if (!section) return null;
  if (section.startsWith('apiKeys-')) return 'ia';
  // [FINTABLE-STALE-ALERT] La bannière « import figé » de l'Accueil pointe ici.
  if (section.startsWith('fintable-')) return 'banque';
  if (section.startsWith('fx-')) return 'banque';
  return null;
}

export const Settings: React.FC<SettingsProps> = ({
  apiKeys,
  setApiKeys,
  config: _config,
  setConfig: _setConfig,
  initialBalances,
  setInitialBalances,
  transactions,
  onImportData,
}) => {
  const pendingFocus = useFinanceStore(s => s.pendingFocus);

  const [sub, setSub] = useState<SubTab | null>(() => {
    if (pendingFocus && pendingFocus.tab === Tab.SETTINGS && Date.now() <= pendingFocus.expiresAt) {
      return subTabForSection(pendingFocus.section);
    }
    return null;
  });

  usePendingFocus(Tab.SETTINGS);

  const large = useViewportXl();
  const setActiveTab = useFinanceStore(s => s.setActiveTab);
  const aFaire = (id: SubTab) => id === 'ia' && !(apiKeys.gemini || apiKeys.anthropic);
  const onglets = SUB_TABS.map((t) => ({
    ...t,
    badge: aFaire(t.id) ? <span className="text-alerte-texte">à faire</span> : undefined,
  }));

  const contenu = (id: SubTab): React.ReactNode => {
    switch (id) {
      case 'compte':
        return (
          <div className="space-y-6">
            <AccountsSection
              initialBalances={initialBalances}
              setInitialBalances={setInitialBalances}
              transactions={transactions}
              onImportData={onImportData}
              apiKey={apiKeys.gemini || apiKeys.anthropic || ''}
            />
            <CollapsibleSection
              title="Patrimoine étendu (optionnel)"
              subtitle="Assurances, immeubles locatifs, entreprises privées et biens cycliques"
              icon={<Icon name="real-estate" size={16} />}
              headingLevel={3}
              defaultOpen={false}
            >
              <PatrimoineSection />
            </CollapsibleSection>
          </div>
        );
      case 'banque':
        return (
          <div className="space-y-6">
            <FintableSyncCard />
            <div data-focus-section="fx-rates">
              <FxRatesCard />
            </div>
          </div>
        );
      case 'ia':
        return <IntegrationsSection apiKeys={apiKeys} setApiKeys={setApiKeys} />;
      case 'sauvegarde':
        return <BackupSection />;
    }
  };

  const enTete = <PageHeader title="Réglages" />;

  // [S5-REFONTE-REGLAGES] Bureau large (≥ xl) : menu à gauche (onglets verticaux), section à droite.
  if (large) {
    const actif = sub ?? 'compte';
    return (
      <div className="space-y-6 stagger-in">
        {enTete}
        <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-5 items-start">
          <div className="gf-terminal-card p-3 min-w-0 flex flex-col gap-1 bg-surface border border-bordure">
            <SubTabs<SubTab>
              idPrefix="config"
              label="Sections des réglages"
              tabs={onglets}
              active={actif}
              onSelect={setSub}
              orientation="vertical"
            />
            {/* Hors tablist : le Profil est une autre page, pas un onglet de celle-ci. */}
            <button
              type="button"
              onClick={() => setActiveTab(Tab.PROFILE)}
              className="touch-target min-h-11 px-3 rounded-[10px] flex items-center justify-between gap-2 text-body text-ink-300 hover:bg-surface-douce hover:text-ink-50 transition-colors focus-ring"
            >
              Profil <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="gf-terminal-card p-4 sm:p-5 min-w-0 bg-surface border border-bordure">
            {SUB_TABS.map(({ id }) => (
              <TabPanel key={id} idPrefix="config" tab={id} when={actif === id}>{contenu(id)}</TabPanel>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Mobile et bureau étroit (maquette M-reglages) : liste des sections (on touche pour ouvrir).
  // Une section ouverte remplace la liste, avec un retour.
  const ouverte = sub ? SUB_TABS.find((t) => t.id === sub) : undefined;
  if (ouverte) {
    return (
      <div className="space-y-6 stagger-in">
        {enTete}
        <div
          role="group"
          aria-label="Accès rapide aux sections"
          className="gf-subtab-bar flex items-center gap-1.5 overflow-x-auto no-scrollbar"
        >
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={ouverte.id === t.id}
              onClick={() => setSub(t.id)}
              className={`touch-target gf-subtab-pill px-3.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-ring ${
                ouverte.id === t.id
                  ? 'gf-subtab-pill-active text-ink-50 font-semibold'
                  : 'text-ink-300 hover:bg-surface-douce hover:text-ink-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <section aria-labelledby="reglages-section-titre" className="gf-terminal-card p-4 rounded-2xl bg-surface border border-bordure space-y-4">
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => { setSub(null); requestAnimationFrame(() => document.getElementById(`reglages-ligne-${ouverte.id}`)?.focus()); }}
              className="touch-target self-start min-h-11 px-2 text-meta text-ink-400 hover:text-ink-100 focus-ring rounded-sm"
            >
              ‹ Toutes les sections
            </button>
            <h2 id="reglages-section-titre" tabIndex={-1} className="text-[20px] font-semibold text-ink-50 focus:outline-hidden">{ouverte.label}</h2>
          </div>
          {contenu(ouverte.id)}
        </section>
      </div>
    );
  }

  const ouvrir = (id: SubTab) => {
    setSub(id);
    requestAnimationFrame(() => document.getElementById('reglages-section-titre')?.focus());
  };
  const ligne = 'touch-target gf-row w-full min-h-[52px] px-4 flex items-center justify-between gap-3 text-left text-body text-ink-50 hover:bg-surface-douce transition-colors focus-ring';
  return (
    <div className="space-y-4 stagger-in">
      {enTete}
      <nav aria-label="Sections des réglages" className="gf-terminal-card rounded-2xl bg-surface border border-bordure overflow-hidden">
        <button type="button" onClick={() => setActiveTab(Tab.PROFILE)} className={ligne}>
          Profil <span className="text-ink-400" aria-hidden="true">›</span>
        </button>
        {SUB_TABS.map((t) => (
          <button key={t.id} id={`reglages-ligne-${t.id}`} type="button" onClick={() => ouvrir(t.id)} className={`${ligne} border-t border-bordure`}>
            {t.label}
            <span className="flex items-center gap-3">
              {aFaire(t.id) && <span className="text-meta text-alerte-texte">à faire</span>}
              <span className="text-ink-400" aria-hidden="true">›</span>
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
};
