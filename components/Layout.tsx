import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Tab, FinancialGoal, User } from '../types';
import { TAB_LABELS } from '../constants';
import { NAV_GROUPS, MOBILE_BAR_TABS, PROFILE_TAB, navItemOfTab } from './navDestinations';
import { CoupleModeBadge } from './ui/CoupleModeBadge';
import { showToast } from './ui/Toast';
import { Icon } from './ui/Icon';
import { useFinanceStore } from '../store/useFinanceStore';
import { BackupReminder } from './BackupReminder';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { isCoupleMode } from '../services/couple/netWorthByOwner';
import { HubConnexionsModal } from './future/HubConnexionsModal';
import { GoogleFinanceTickerBar } from './app/GoogleFinanceTickerBar';
import { prefetchTab, getAdjacentTabs } from '../utils/tabPrefetch';

const BandeauModeTest = lazyWithRetry(() => import('./test/BandeauModeTest').then(m => ({ default: m.BandeauModeTest })), 'BandeauModeTest');
const GeminiAssistantModal = lazyWithRetry(() => import('./aiChat/GeminiAssistantModal').then(m => ({ default: m.GeminiAssistantModal })), 'GeminiAssistantModal');

interface LayoutProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  children: React.ReactNode;
  lastUpdate: number;
  isLoading: boolean;
  isPrivacyMode: boolean;
  togglePrivacyMode: () => void;
  netWorth: number;
  monthlySavings?: number;
  financialGoals?: FinancialGoal[];
  currentValues?: { celi: number, reer: number, liquidity: number };
  onOpenGuide?: () => void;
  onGeneratePDF?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
  activeTab,
  setActiveTab,
  children,
  lastUpdate: _lastUpdate,
  isLoading: _isLoading,
  isPrivacyMode,
  togglePrivacyMode,
  netWorth,
  monthlySavings = 0,
  financialGoals: _financialGoals = [],
  currentValues = { celi: 0, reer: 0, liquidity: 0 },
  onOpenGuide: _onOpenGuide,
  onGeneratePDF: _onGeneratePDF
}) => {
  useTranslation();
  const [showMobileDrawer, setShowMobileDrawer] = React.useState(false);
  const [showConnexionsModal, setShowConnexionsModal] = React.useState(false);
  const [showGeminiModal, setShowGeminiModal] = React.useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const searchContainerRef = React.useRef<HTMLDivElement>(null);

  const ongletPrecedent = React.useRef<Tab | null>(null);
  const [annonceRoute, setAnnonceRoute] = React.useState('');
  React.useEffect(() => {
    const precedent = ongletPrecedent.current;
    ongletPrecedent.current = activeTab;
    if (precedent === null || precedent === activeTab) return;
    document.getElementById('main')?.focus({ preventScroll: true });
    setAnnonceRoute(TAB_LABELS[activeTab]);
  }, [activeTab]);

  // Préchargement automatique des onglets adjacents dès qu'on arrive sur un onglet
  const { prev: prevTab, next: nextTab } = React.useMemo(() => getAdjacentTabs(activeTab), [activeTab]);
  React.useEffect(() => {
    prefetchTab(prevTab);
    prefetchTab(nextTab);
  }, [prevTab, nextTab]);

  React.useEffect(() => {
    if (!searchOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!searchContainerRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [searchOpen]);

  const isNavActive = (tab: Tab) => navItemOfTab(activeTab)?.tab === tab;
  const itemsMobilePlus = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => !MOBILE_BAR_TABS.includes(it.tab)) }))
    .filter((g) => g.items.length > 0);
  const surPagePlus = !MOBILE_BAR_TABS.includes(activeTab);

  const groupeActif = NAV_GROUPS.find((g) =>
    g.items.some((it) => it.tab === activeTab || it.alsoActiveFor?.includes(activeTab)),
  );

  const panneauPlusRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!showMobileDrawer) return;
    panneauPlusRef.current?.querySelector<HTMLElement>('button, a')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMobileDrawer(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMobileDrawer]);

  const isTestMode = useFinanceStore(s => s.isTestMode);
  const coupleConfig = useFinanceStore(s => s.config);
  const assets = useFinanceStore(s => s.assets);
  const setAppState = useFinanceStore(s => s.setAppState);
  const isCouple = isCoupleMode(coupleConfig?.users);
  const toggleCoupleMode = () => {
    if (!coupleConfig) return;
    const users: User[] = coupleConfig.users as User[];
    if (isCouple) {
      setAppState({ config: { ...coupleConfig, users: [users[0]] as unknown as [User, User] } });
      return;
    }
    showToast('Définis d\'abord ton conjoint (nom + âge) dans Profil pour passer en couple.', 'info');
    useFinanceStore.getState().setActiveTab(Tab.PROFILE);
  };

  const prenoms = ((coupleConfig?.users ?? []) as User[])
    .map((u) => (u?.name ?? '').replace(/\s*\(test\)\s*$/i, '').trim())
    .filter(Boolean);
  const libelleProfil = prenoms.length ? prenoms.join(' et ') : 'Profil';
  const initiales = prenoms.length ? prenoms.map((n) => n[0]!.toUpperCase()).join('').slice(0, 2) : 'P';

  const resultatsRecherche = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const destinations = [
      ...NAV_GROUPS.flatMap((g) => g.items.map((it) => ({ tab: it.tab, label: it.label, group: g.label, icon: it.icon }))),
      { tab: PROFILE_TAB, label: 'Profil', group: 'Dossier', icon: 'users' as const },
    ];
    const pagesFiltrees = q
      ? destinations.filter((d) => d.label.toLowerCase().includes(q) || d.group.toLowerCase().includes(q))
      : destinations.slice(0, 6);
    const titresFiltres = q
      ? (assets ?? [])
          .filter((a) => (a.symbol && a.symbol.toLowerCase().includes(q)) || a.name.toLowerCase().includes(q))
          .slice(0, 4)
      : [];
    return { pagesFiltrees, titresFiltres };
  }, [searchQuery, assets]);

  const largeurSidebar = isSidebarCollapsed ? 'w-[72px]' : 'w-[232px]';
  const margeMain = isSidebarCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[232px]';

  return (
    <div className={`min-h-screen flex flex-col md:flex-row text-ink-100 font-sans ${isPrivacyMode ? 'privacy-active' : ''} ${isTestMode ? 'test-mode-active' : ''}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-200 focus:px-4 focus:py-2 focus:rounded-card focus:bg-primary focus:text-dark focus:font-bold"
      >
        Aller au contenu principal
      </a>

      <div role="status" aria-live="polite" className="sr-only">{annonceRoute}</div>

      {isTestMode && (
        <Suspense fallback={<div className="fixed top-0 left-0 right-0 z-150 h-10 bg-warning-600" aria-hidden="true" />}>
          <BandeauModeTest />
        </Suspense>
      )}
      <style>{`
        .privacy-active .privacy-blur {
            filter: blur(8px) !important;
            opacity: 0.5 !important;
            transition: all 0.3s ease;
            user-select: none !important;
        }
        .privacy-active table td:nth-child(n+2):not(:last-child) {
            filter: blur(5px) !important;
            opacity: 0.6 !important;
        }
        .privacy-active .recharts-cartesian-axis-tick-value tspan,
        .privacy-active .recharts-tooltip-item-value,
        .privacy-active .recharts-tooltip-label,
        .privacy-active .recharts-legend-item-text {
            filter: blur(6px) !important;
            opacity: 0.3 !important;
            color: transparent !important;
        }
        .privacy-active input[type="number"],
        .privacy-active input[type="range"] + span,
        .privacy-active .font-mono {
            filter: blur(6px) !important;
            opacity: 0.6 !important;
        }
      `}</style>

      {/* Barre latérale bureau (≥ lg) : repliable, icônes + indicateurs animés + préchargement au survol */}
      <aside className={`hidden lg:flex fixed top-0 left-0 bottom-0 z-40 ${largeurSidebar} flex-col gap-2.5 bg-fond border-r border-bordure px-3 pb-3 transition-all duration-200 ${isTestMode ? 'pt-14' : 'pt-3.5'}`}>
        <div className="flex items-center justify-between px-1.5" title={`v${__APP_VERSION__} • ${__GIT_SHA__} — build ${__BUILD_DATE__}`}>
          <div className="flex items-center gap-2 min-w-0">
            <img src="/icon.svg" alt="" width={30} height={30} className="w-[30px] h-[30px] rounded-[9px] shrink-0" aria-hidden="true" />
            {!isSidebarCollapsed && (
              <div className="flex items-baseline gap-1.5 min-w-0">
                <p className="sr-only">FinanceAI</p>
                <span className="text-[15px] font-bold tracking-tight select-none truncate" aria-hidden="true">
                  <span className="gf-logo-b">F</span>
                  <span className="gf-logo-r">i</span>
                  <span className="gf-logo-y">n</span>
                  <span className="gf-logo-b">a</span>
                  <span className="gf-logo-g">n</span>
                  <span className="gf-logo-r">c</span>
                  <span className="gf-logo-y">e</span>
                  <span className="gf-logo-b">A</span>
                  <span className="gf-logo-g">I</span>
                </span>
                <span className="gf-badge-nouvelle shrink-0">Beta</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setIsSidebarCollapsed((v) => !v)}
            aria-label={isSidebarCollapsed ? 'Déplier le menu latéral' : 'Replier le menu latéral'}
            title={isSidebarCollapsed ? 'Déplier le menu latéral' : 'Replier le menu latéral'}
            className="touch-target h-8 w-8 rounded-lg flex items-center justify-center text-ink-400 hover:text-ink-50 hover:bg-surface-douce focus-ring shrink-0"
          >
            <Icon name={isSidebarCollapsed ? 'chevron-right' : 'chevron-left'} size={15} aria-hidden="true" />
          </button>
        </div>

        <nav aria-label="Navigation principale" className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2.5 pr-0.5">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <p className={isSidebarCollapsed ? 'sr-only' : 'px-2.5 pb-1 text-[11px] font-semibold tracking-[0.08em] uppercase text-ink-400'}>
                {group.label}
              </p>
              {group.items.map((item) => {
                const actif = isNavActive(item.tab);
                return (
                  <button
                    key={item.tab}
                    type="button"
                    data-tour-id={`nav-${item.tab}`}
                    onClick={() => setActiveTab(item.tab)}
                    onMouseEnter={() => prefetchTab(item.tab)}
                    onFocus={() => prefetchTab(item.tab)}
                    title={isSidebarCollapsed ? item.label : undefined}
                    aria-current={actif ? 'page' : undefined}
                    className={`touch-target gf-nav-item group h-9 px-2.5 rounded-[10px] flex items-center gap-2.5 text-left focus-ring ${
                      isSidebarCollapsed ? 'justify-center text-[0px]' : 'text-body'
                    } ${
                      actif ? 'gf-nav-item-active text-ink-50 font-semibold' : 'text-ink-300 hover:bg-surface-douce hover:text-ink-50'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      size={16}
                      aria-hidden="true"
                      className={`shrink-0 transition-transform duration-200 group-hover:scale-110 ${
                        actif ? 'text-repere' : 'text-ink-400 group-hover:text-ink-100'
                      }`}
                    />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex flex-col gap-2 shrink-0 pt-2 border-t border-bordure">
          <button
            type="button"
            onClick={() => setShowGeminiModal(true)}
            title={isSidebarCollapsed ? 'Conseiller Gemini' : undefined}
            aria-label="Ouvrir le conseiller financier Gemini"
            className="touch-target gemini-rainbow-btn h-10 px-2.5 rounded-xl flex items-center justify-center gap-2 text-meta font-semibold hover:opacity-95 transition-opacity focus-ring"
          >
            <Icon name="sparkles" size={16} className="gemini-rainbow-sparkle shrink-0" aria-hidden="true" />
            <span className={isSidebarCollapsed ? 'sr-only' : 'truncate'}>Conseiller Gemini</span>
          </button>
          <button
            type="button"
            onClick={() => setShowConnexionsModal(true)}
            title={isSidebarCollapsed ? 'Importer / Synchroniser' : undefined}
            className="touch-target h-10 px-2.5 rounded-xl flex items-center justify-center gap-2 text-meta font-semibold gf-delta-neutral hover:opacity-90 transition-opacity focus-ring"
          >
            <Icon name="cloud" size={16} className="shrink-0" aria-hidden="true" />
            <span className={isSidebarCollapsed ? 'sr-only' : 'truncate'}>+ Importer / Sync</span>
          </button>
          <button
            type="button"
            data-tour-id={`nav-${PROFILE_TAB}`}
            onClick={() => setActiveTab(PROFILE_TAB)}
            onMouseEnter={() => prefetchTab(PROFILE_TAB)}
            onFocus={() => prefetchTab(PROFILE_TAB)}
            title={isSidebarCollapsed ? `${libelleProfil} · Profil` : undefined}
            aria-current={activeTab === PROFILE_TAB ? 'page' : undefined}
            className={`touch-target gf-nav-item h-11 px-2 rounded-xl flex items-center gap-2.5 text-left text-body focus-ring border ${
              activeTab === PROFILE_TAB ? 'gf-nav-item-active text-ink-50 font-semibold' : 'border-bordure text-ink-200 hover:bg-surface-douce'
            }`}
          >
            <span className="w-7 h-7 rounded-full bg-surface-douce flex items-center justify-center text-meta font-bold text-primary shrink-0" aria-hidden="true">{initiales}</span>
            <span className={isSidebarCollapsed ? 'sr-only' : 'truncate'}>{libelleProfil} · Profil</span>
          </button>
          <div className={`flex items-center ${isSidebarCollapsed ? 'flex-col gap-1.5' : 'gap-1'}`}>
            <button
              type="button"
              onClick={togglePrivacyMode}
              aria-label={isPrivacyMode ? 'Quitter le mode discret' : 'Activer le mode discret'}
              aria-pressed={isPrivacyMode}
              title="Mode discret"
              className={`touch-target h-9 px-2.5 rounded-[10px] flex items-center gap-2 text-meta transition-colors focus-ring ${
                isPrivacyMode ? 'bg-surface-douce text-ink-50' : 'text-ink-400 hover:bg-surface-douce hover:text-ink-50'
              }`}
            >
              <Icon name={isPrivacyMode ? 'eye-off' : 'eye'} size={16} className="shrink-0" />
              <span className={isSidebarCollapsed ? 'sr-only' : ''}>{isPrivacyMode ? 'Quitter discret' : 'Discret'}</span>
            </button>
            <button
              type="button"
              onClick={toggleCoupleMode}
              aria-pressed={isCouple}
              title={isCouple ? 'Mode Couple actif — cliquer pour repasser en Individuel' : 'Mode Individuel — cliquer pour passer en Couple'}
              className="touch-target inline-flex items-center justify-center rounded-full hover:opacity-80 transition-opacity focus-ring"
            >
              <CoupleModeBadge compact />
            </button>
          </div>
        </div>
      </aside>

      {/* Contenu principal avec barre supérieure épurée style Google Finance */}
      <main
        id="main"
        tabIndex={-1}
        className={`flex-1 ${margeMain} px-2.5 sm:px-4 lg:px-6 pb-20 lg:pb-6 ${isTestMode ? 'pt-12 sm:pt-14' : 'pt-2 sm:pt-3 lg:pt-4'} overflow-y-auto min-h-dvh relative z-0 scroll-smooth focus:outline-hidden`}
      >
        <div className="max-w-7xl mx-auto space-y-2.5 sm:space-y-3.5 lg:space-y-4 animate-premium-in">
          {/* Barre supérieure unique : fil d'Ariane + barre de recherche directe (masquée sur Accueil qui possède déjà son Omnibox) */}
          {activeTab !== Tab.DASHBOARD && (
          <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-bordure">
            <div className="flex items-center gap-2 min-w-0 shrink-0">
              {surPagePlus && (
                <button
                  type="button"
                  onClick={() => setShowMobileDrawer(true)}
                  className="touch-target lg:hidden -ml-1.5 px-1.5 min-h-11 min-w-11 inline-flex items-center text-meta text-ink-400 hover:text-ink-100 focus-ring rounded-sm"
                >
                  ‹ Plus
                </button>
              )}
              <div className="hidden sm:inline-flex items-baseline gap-1 select-none shrink-0 pr-1.5 border-r border-bordure" aria-hidden="true">
                <span className="text-xs font-bold tracking-tight">
                  <span className="gf-logo-b">F</span>
                  <span className="gf-logo-r">i</span>
                  <span className="gf-logo-y">n</span>
                  <span className="gf-logo-b">a</span>
                  <span className="gf-logo-g">n</span>
                  <span className="gf-logo-r">c</span>
                  <span className="gf-logo-y">e</span>
                  <span className="gf-logo-b">A</span>
                  <span className="gf-logo-g">I</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-ink-400 truncate">
                <span className="font-semibold uppercase tracking-wider text-repere">
                  {groupeActif ? groupeActif.label : 'Dossier'}
                </span>
                <span aria-hidden="true">/</span>
                <span className="font-semibold text-ink-100 truncate">{TAB_LABELS[activeTab]}</span>
                <span className="gf-badge-nouvelle hidden md:inline-flex">Beta</span>
              </div>
            </div>

            <div ref={searchContainerRef} className="relative flex-1 min-w-0 max-w-[220px] sm:max-w-none sm:flex-none sm:w-80 lg:w-96">
              <div className="relative flex items-center gf-omnibox-pill px-3 h-9 sm:h-10">
                <Icon name="search" size={14} className="text-ink-400 pointer-events-none shrink-0" aria-hidden="true" />
                <input
                  type="search"
                  value={searchQuery}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSearchOpen(false);
                    } else if (e.key === 'Enter' && resultatsRecherche.pagesFiltrees[0]) {
                      setActiveTab(resultatsRecherche.pagesFiltrees[0].tab);
                      setSearchOpen(false);
                      setSearchQuery('');
                    }
                  }}
                  placeholder="Rechercher page, titre…"
                  aria-label="Rechercher une page, un titre ou une opération"
                  className="touch-target champ-nu w-full h-9 pl-2 pr-1 text-xs text-ink-50 placeholder:text-ink-400"
                />
              </div>

              {searchOpen && (
                <div
                  role="listbox"
                  aria-label="Résultats de recherche rapide"
                  className="absolute right-0 mt-1.5 w-[min(20rem,calc(100vw-1.5rem))] sm:w-full rounded-2xl bg-surface border border-bordure-champ shadow-2xl py-2 z-50 divide-y divide-bordure"
                >
                  <div className="px-2 pb-1">
                    <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Pages</p>
                    {resultatsRecherche.pagesFiltrees.map((dest) => (
                      <button
                        key={dest.tab}
                        type="button"
                        onClick={() => {
                          setActiveTab(dest.tab);
                          setSearchOpen(false);
                          setSearchQuery('');
                        }}
                        onMouseEnter={() => prefetchTab(dest.tab)}
                        className="touch-target w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs text-ink-100 hover:bg-surface-douce focus-ring"
                      >
                        <span className="flex items-center gap-2">
                          <Icon name={dest.icon} size={14} className="text-repere" aria-hidden="true" />
                          <span className="font-medium text-ink-50">{dest.label}</span>
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full gf-delta-neutral">{dest.group}</span>
                      </button>
                    ))}
                  </div>

                  {resultatsRecherche.titresFiltres.length > 0 && (
                    <div className="px-2 pt-2">
                      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">Titres en portefeuille</p>
                      {resultatsRecherche.titresFiltres.map((asset, idx) => (
                        <button
                          key={`${asset.symbol}-${idx}`}
                          type="button"
                          onClick={() => {
                            setActiveTab(Tab.INVESTMENTS);
                            setSearchOpen(false);
                            setSearchQuery('');
                          }}
                          className="touch-target w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs text-ink-100 hover:bg-surface-douce focus-ring"
                        >
                          <span className="font-semibold font-mono text-repere">{asset.symbol || asset.name}</span>
                          <span className="text-[11px] text-ink-300 truncate max-w-[160px]">{asset.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          )}

          {activeTab !== Tab.DASHBOARD && (
            <GoogleFinanceTickerBar
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              netWorth={netWorth}
              monthlySavings={monthlySavings}
              currentValues={currentValues}
              isPrivacyMode={isPrivacyMode}
            />
          )}

          <BackupReminder onNavigateToSettings={() => setActiveTab(Tab.SETTINGS)} />
          {children}
        </div>
      </main>

      {/* Barre du bas (mobile, < lg) : Accueil, Futur, Transactions, Budget, Plus. Cibles ≥ 44 px. */}
      <nav aria-label="Navigation mobile" className="lg:hidden fixed bottom-0 left-0 right-0 h-[64px] z-100 grid grid-cols-5 px-1.5 pt-1 pb-1.5 pb-safe bg-fond/95 backdrop-blur-md border-t border-bordure">
        {MOBILE_BAR_TABS.map((tab) => {
          const item = navItemOfTab(tab)!;
          const actif = activeTab === tab && !showMobileDrawer;
          return (
            <button
              key={tab}
              type="button"
              data-tour-id={`nav-${tab}`}
              onClick={() => { setActiveTab(tab); setShowMobileDrawer(false); }}
              onMouseEnter={() => prefetchTab(tab)}
              onTouchStart={() => prefetchTab(tab)}
              aria-current={activeTab === tab ? 'page' : undefined}
              className={`touch-target flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors focus-ring rounded-xl ${actif ? 'text-ink-50 font-semibold bg-repere-doux border border-bordure' : 'text-ink-400 hover:text-ink-200'}`}
            >
              <Icon name={item.icon} size={20} aria-hidden="true" className={actif ? 'text-repere' : ''} />
              {item.label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setShowMobileDrawer((v) => !v)}
          aria-label="Plus d'options"
          aria-expanded={showMobileDrawer}
          className={`touch-target flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors focus-ring rounded-xl ${showMobileDrawer || surPagePlus ? 'text-ink-50 font-semibold bg-repere-doux border border-bordure' : 'text-ink-400 hover:text-ink-200'}`}
        >
          <Icon name="more" size={20} aria-hidden="true" className={showMobileDrawer || surPagePlus ? 'text-repere' : ''} />
          Plus
        </button>
      </nav>

      {/* Menu « Plus » (mobile) : un écran à part entière, au-dessus du contenu, sous la barre du bas. */}
      {showMobileDrawer && (
        <div ref={panneauPlusRef} className={`lg:hidden fixed inset-x-0 bottom-[64px] ${isTestMode ? 'top-10' : 'top-0'} z-90 bg-fond overflow-y-auto px-4 pt-4 pb-6 flex flex-col gap-3.5 animate-fade-in`}>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-ink-50">Plus</h2>
            <span className="gf-badge-nouvelle">Google Finance Beta</span>
          </div>
          <button
            type="button"
            onClick={() => { setActiveTab(PROFILE_TAB); setShowMobileDrawer(false); }}
            onMouseEnter={() => prefetchTab(PROFILE_TAB)}
            aria-current={activeTab === PROFILE_TAB ? 'page' : undefined}
            className="touch-target h-[54px] px-3.5 rounded-[14px] bg-surface border border-bordure flex items-center gap-3 text-left focus-ring"
          >
            <span className="w-8 h-8 rounded-full bg-surface-douce flex items-center justify-center text-meta font-bold text-primary shrink-0" aria-hidden="true">{initiales}</span>
            <span className="flex-1 min-w-0 flex flex-col">
              <span className="font-semibold text-ink-50 truncate">{libelleProfil}</span>
              <span className="text-meta text-ink-400">Profil</span>
            </span>
            <span className="text-ink-400" aria-hidden="true">›</span>
          </button>
          <div role="navigation" aria-label="Autres destinations" className="flex flex-col gap-3">
            {itemsMobilePlus.map((group) => (
              <section key={group.id} className="flex flex-col">
                <h3 className="px-1 pb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-ink-400">{group.label}</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.items.map((item) => (
                    <button
                      key={item.tab}
                      type="button"
                      onClick={() => { setActiveTab(item.tab); setShowMobileDrawer(false); }}
                      onMouseEnter={() => prefetchTab(item.tab)}
                      onTouchStart={() => prefetchTab(item.tab)}
                      aria-current={isNavActive(item.tab) ? 'page' : undefined}
                      className={`touch-target w-full h-[48px] px-3 rounded-xl border border-bordure flex items-center justify-between text-left text-xs font-medium focus-ring ${isNavActive(item.tab) ? 'text-ink-50 font-semibold bg-surface-douce border-bordure-champ' : 'bg-surface text-ink-100 hover:bg-surface-douce'}`}
                    >
                      <span className="flex items-center gap-2 min-w-0 truncate">
                        <Icon name={item.icon} size={16} aria-hidden="true" className={`shrink-0 ${isNavActive(item.tab) ? 'text-repere' : 'text-ink-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <span className="text-ink-400 shrink-0 ml-1" aria-hidden="true">›</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <section className="flex flex-col">
            <h3 className="px-1 pb-1.5 text-[11px] font-semibold tracking-[0.08em] uppercase text-ink-400">Préférences</h3>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={togglePrivacyMode}
                aria-label={isPrivacyMode ? 'Quitter le mode discret' : 'Activer le mode discret'}
                aria-pressed={isPrivacyMode}
                className="touch-target w-full h-[48px] px-3 rounded-xl bg-surface border border-bordure flex items-center justify-between text-xs text-ink-100 focus-ring"
              >
                <span className="flex items-center gap-1.5 truncate"><Icon name={isPrivacyMode ? 'eye-off' : 'eye'} size={16} aria-hidden="true" />Mode discret</span>
                <span className="text-[11px] text-ink-400">{isPrivacyMode ? 'actif' : 'inactif'}</span>
              </button>
              <button
                type="button"
                onClick={toggleCoupleMode}
                aria-pressed={isCouple}
                className="touch-target w-full h-[48px] px-3 rounded-xl bg-surface border border-bordure flex items-center justify-between text-xs text-ink-100 focus-ring"
              >
                <span>Ménage</span>
                <CoupleModeBadge compact />
              </button>
            </div>
          </section>
        </div>
      )}

      <HubConnexionsModal
        isOpen={showConnexionsModal}
        onClose={() => setShowConnexionsModal(false)}
      />

      {showGeminiModal && (
        <Suspense fallback={null}>
          <GeminiAssistantModal
            isOpen={showGeminiModal}
            onClose={() => setShowGeminiModal(false)}
          />
        </Suspense>
      )}
    </div>
  );
};
