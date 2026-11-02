import React, { useMemo } from 'react';
import { Tab } from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { PrivateAmount } from '../ui/PrivateAmount';
import { AnimatedNetWorth } from '../ui/AnimatedNetWorth';
import { formatCompactCAD, formatSigned } from '../../utils/format';
import { prefetchTab } from '../../utils/tabPrefetch';
import { partitionRealEstateGoals } from '../../services/realEstatePartition';
import { useDerivedFinancials } from '../../utils/useDerivedFinancials';

interface GoogleFinanceTickerBarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  netWorth: number;
  monthlySavings: number;
  currentValues: { celi: number; reer: number; liquidity: number };
  isPrivacyMode?: boolean;
}

interface TickerQuote {
  id: string;
  symbol: string;
  label: string;
  tab: Tab;
  valueNode: React.ReactNode;
  badgeText: React.ReactNode;
  badgeClass: string;
  dotClass: string;
}

/**
 * Bandeau supérieur d'indices personnels inspiré de Google Finance Beta (« Aperçu des marchés »).
 * Présent en haut de chaque page (hors Accueil) avec défilement horizontal fluide sur mobile
 * et grille 6 colonnes sur grand écran pour basculer d'un clic vers l'écran correspondant.
 */
export const GoogleFinanceTickerBar: React.FC<GoogleFinanceTickerBarProps> = ({
  activeTab,
  setActiveTab,
  netWorth,
  monthlySavings,
  currentValues,
  isPrivacyMode,
}) => {
  const state = useFinanceStore();
  const derived = useDerivedFinancials(state);
  const privacyActif = isPrivacyMode ?? state.isPrivacyMode;

  const stats = useMemo(() => {
    const portefeuilleDerive =
      derived.assetBreakdown.celi +
      derived.assetBreakdown.reer +
      derived.assetBreakdown.reee +
      derived.assetBreakdown.nonReg;
    const portefeuilleProps = (currentValues.celi || 0) + (currentValues.reer || 0);
    const portefeuille = portefeuilleDerive > 0 ? portefeuilleDerive : portefeuilleProps;
    const nbTitres = (state.assets ?? []).length;
    const totalDettesBrut = derived.dettesHorsImmo;
    const nbDettes = (state.debts ?? []).length;
    const { actual: immoActuel } = partitionRealEstateGoals(state.realEstateGoals ?? []);
    const nbImmo = immoActuel.length;
    const nbTx = (state.transactions ?? []).length;

    return {
      portefeuille,
      nbTitres,
      totalDettesBrut,
      nbDettes,
      nbImmo,
      nbTx,
    };
  }, [
    currentValues.celi,
    currentValues.reer,
    derived.assetBreakdown,
    derived.dettesHorsImmo,
    state.assets,
    state.debts,
    state.realEstateGoals,
    state.transactions,
  ]);

  const tickers: TickerQuote[] = [
    {
      id: 'patrimoine',
      symbol: 'PATR:CAD',
      label: 'Valeur nette',
      tab: Tab.FUTURE,
      valueNode: <AnimatedNetWorth value={netWorth} format="compact" as="span" testId="animated-ticker-net-worth" />,
      badgeText: netWorth >= 0 ? '▲ Actif net' : '▼ Passif net',
      badgeClass: netWorth >= 0 ? 'gf-delta-up' : 'gf-delta-down',
      dotClass: 'gf-alloc-celi',
    },
    {
      id: 'epargne',
      symbol: 'FLUX:MENS',
      label: 'Flux mensuel',
      tab: Tab.BUDGET,
      valueNode: (
        <PrivateAmount>
          {formatSigned(Math.round(monthlySavings), { withCurrency: true })}
        </PrivateAmount>
      ),
      badgeText: monthlySavings >= 0 ? '▲ Excédent' : '▼ Déficit',
      badgeClass: monthlySavings >= 0 ? 'gf-delta-up' : 'gf-delta-down',
      dotClass: 'gf-alloc-reer',
    },
    {
      id: 'placements',
      symbol: 'PORTF:TSE',
      label: 'Portefeuille',
      tab: Tab.INVESTMENTS,
      valueNode: <PrivateAmount>{formatCompactCAD(stats.portefeuille)}</PrivateAmount>,
      badgeText: privacyActif ? '••' : `${stats.nbTitres} titre${stats.nbTitres > 1 ? 's' : ''}`,
      badgeClass: 'gf-delta-neutral',
      dotClass: 'gf-alloc-nonreg',
    },
    {
      id: 'liquidites',
      symbol: 'CASH:CAD',
      label: 'Liquidités',
      tab: Tab.TRANSACTIONS,
      valueNode: <PrivateAmount>{formatCompactCAD(currentValues.liquidity || 0)}</PrivateAmount>,
      badgeText: privacyActif ? '••' : `${stats.nbTx} opér.`,
      badgeClass: (currentValues.liquidity || 0) >= 0 ? 'gf-delta-up' : 'gf-delta-amber',
      dotClass: 'gf-alloc-cash',
    },
    {
      id: 'dettes',
      symbol: 'DETTE:CAD',
      label: 'Passif & dettes',
      tab: Tab.DEBT,
      valueNode: <PrivateAmount>{formatCompactCAD(stats.totalDettesBrut)}</PrivateAmount>,
      badgeText: privacyActif
        ? '••'
        : stats.totalDettesBrut > 0
          ? `${stats.nbDettes} active${stats.nbDettes > 1 ? 's' : ''}`
          : '0 dette',
      badgeClass: stats.totalDettesBrut > 0 ? 'gf-delta-down' : 'gf-delta-up',
      dotClass: 'gf-alloc-immo',
    },
    {
      id: 'immobilier',
      symbol: 'IMMO:QC',
      label: 'Immobilier & impôts',
      tab: activeTab === Tab.TAX ? Tab.TAX : Tab.REAL_ESTATE,
      valueNode: (
        <span className="font-mono text-[13px] font-bold text-ink-50">
          {privacyActif
            ? '••'
            : stats.nbImmo > 0
              ? `${stats.nbImmo} bien${stats.nbImmo > 1 ? 's' : ''}`
              : 'QC · Féd'}
        </span>
      ),
      badgeText: activeTab === Tab.TAX ? 'Fisc QC' : 'Foncier',
      badgeClass: 'gf-delta-amber',
      dotClass: 'gf-alloc-immo',
    },
  ];

  return (
    <section
      aria-label="Aperçu des indices du dossier (style Google Finance)"
      className="premium-card rounded-xl bg-surface border border-bordure overflow-hidden"
    >
      <div className="flex overflow-x-auto no-scrollbar xl:grid xl:grid-cols-6 divide-x divide-bordure bg-fond">
        {tickers.map((item) => {
          const isCurrent = activeTab === item.tab;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.tab)}
              onMouseEnter={() => prefetchTab(item.tab)}
              onFocus={() => prefetchTab(item.tab)}
              aria-current={isCurrent ? 'page' : undefined}
              className={`touch-target shrink-0 min-w-[162px] sm:min-w-[176px] xl:min-w-0 px-3 py-2 text-left flex flex-col justify-between gap-1 transition-all duration-150 focus-ring group ${
                isCurrent
                  ? 'gf-market-ticker-active bg-surface-douce'
                  : 'hover:bg-surface-douce'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5 w-full">
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.dotClass} ${isCurrent ? 'gf-pulse-live' : ''}`}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-ink-200 group-hover:text-ink-50 truncate">
                    {item.symbol}
                  </span>
                </span>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold leading-none shrink-0 ${item.badgeClass}`}
                >
                  {item.badgeText}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-1.5 w-full">
                <span className="text-[11px] font-medium text-ink-400 group-hover:text-ink-200 truncate">
                  {item.label}
                </span>
                <span className="font-mono text-[13px] font-bold text-ink-50 tabular-nums shrink-0">
                  {item.valueNode}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
