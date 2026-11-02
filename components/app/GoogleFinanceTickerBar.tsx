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
}

/**
 * Bandeau supérieur d'indices personnels inspiré de Google Finance (« Aperçu des marchés »).
 * Présent en haut de chaque page pour offrir la lecture instantanée des cotes clés du dossier
 * et basculer d'un clic vers l'écran correspondant.
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
    },
    {
      id: 'placements',
      symbol: 'PORTF:TSE',
      label: 'Portefeuille',
      tab: Tab.INVESTMENTS,
      valueNode: <PrivateAmount>{formatCompactCAD(stats.portefeuille)}</PrivateAmount>,
      badgeText: privacyActif ? '••' : `${stats.nbTitres} titre${stats.nbTitres > 1 ? 's' : ''}`,
      badgeClass: 'gf-delta-neutral',
    },
    {
      id: 'liquidites',
      symbol: 'CASH:CAD',
      label: 'Liquidités',
      tab: Tab.TRANSACTIONS,
      valueNode: <PrivateAmount>{formatCompactCAD(currentValues.liquidity || 0)}</PrivateAmount>,
      badgeText: privacyActif ? '••' : `${stats.nbTx} opér.`,
      badgeClass: (currentValues.liquidity || 0) >= 0 ? 'gf-delta-up' : 'gf-delta-amber',
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
    },
  ];

  return (
    <section
      aria-label="Aperçu des indices du dossier (style Google Finance)"
      className="gf-market-banner"
    >
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
            className={`touch-target gf-market-ticker focus-ring ${
              isCurrent ? 'gf-market-ticker-active' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-1.5 w-full">
              <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400 truncate">
                {item.symbol}
              </span>
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold leading-none shrink-0 ${item.badgeClass}`}
              >
                {item.badgeText}
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-1.5 w-full mt-0.5">
              <span className="text-[11px] font-medium text-ink-300 truncate">{item.label}</span>
              <span className="font-mono text-[13px] font-bold text-ink-50 tabular-nums shrink-0">
                {item.valueNode}
              </span>
            </div>
          </button>
        );
      })}
    </section>
  );
};
