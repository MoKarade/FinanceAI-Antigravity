import React, { useState } from 'react';
import { ConcretePortfolioXRay } from '../../services/valoria/multiAssetQuantEngine';
import {
  formatEur,
  formatPct,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface PortfolioXRaySectionProps {
  xray: ConcretePortfolioXRay;
  onInspectAsset: (assetId: string) => void;
}

type XRayTab = 'stress' | 'income_fees' | 'tax_cad' | 'exposure';

export const PortfolioXRaySection: React.FC<PortfolioXRaySectionProps> = ({
  xray,
  onInspectAsset,
}) => {
  const [activeTab, setActiveTab] = useState<XRayTab>('stress');

  const inc = xray.incomeAndFees;
  const netCarryDelta = inc.netAnnualCarryAfterCad - inc.netAnnualCarryBeforeCad;

  return (
    <div className="bg-surface/70 border border-bordure rounded-lg p-5 space-y-5">
      {/* Header & Interactive Diagnostic Mode Selector */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-bordure">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-texte">
            Radiographie Concrète du Portefeuille (Avant vs Après Arbitrages en $ CAD)
          </h3>
          <p className="text-xs text-texte-doux">
            Chocs historiques réels, dividendes/coupons nets de frais RFG, exposition devises et optimisation fiscale canadienne (CELI · REER · Non-enregistré).
          </p>
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-1 p-1 bg-fond border border-bordure rounded-md shrink-0">
          <button aria-pressed={Boolean(activeTab === 'stress')}
            type="button"
            onClick={() => setActiveTab('stress')}
            className={`min-h-11 min-w-11 px-2.5 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'stress'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Stress-Tests ($ CAD)
          </button>
          <button aria-pressed={Boolean(activeTab === 'income_fees')}
            type="button"
            onClick={() => setActiveTab('income_fees')}
            className={`min-h-11 min-w-11 px-2.5 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'income_fees'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Revenus &amp; Frais
          </button>
          <button aria-pressed={Boolean(activeTab === 'tax_cad')}
            type="button"
            onClick={() => setActiveTab('tax_cad')}
            className={`min-h-11 min-w-11 px-2.5 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'tax_cad'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Fiscalité CELI/REER
          </button>
          <button aria-pressed={Boolean(activeTab === 'exposure')}
            type="button"
            onClick={() => setActiveTab('exposure')}
            className={`min-h-11 min-w-11 px-2.5 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'exposure'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Devises &amp; Secteurs
          </button>
        </div>
      </div>

      {/* TAB 1: 4 CONCRETE MACRO & HISTORICAL STRESS TESTS */}
      {activeTab === 'stress' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-bordure text-texte-doux">
                <th className="py-2 pr-3 font-medium">Scénario de choc macroéconomique</th>
                <th className="py-2 px-3 font-medium text-right">
                  Portefeuille Actuel
                </th>
                <th className="py-2 px-3 font-medium text-right">
                  Après Arbitrages Pro
                </th>
                <th className="py-2 pl-3 font-medium text-right">
                  Capital Protégé / Gain Net
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bordure">
              {xray.stressScenarios.map((sc) => {
                const isGainBefore = sc.impactBeforePct >= 0;
                const isGainAfter = sc.impactAfterPct >= 0;
                const isImproved = sc.capitalProtectedCad >= 0;

                return (
                  <tr key={sc.id} className="hover:bg-surface-douce/30 transition-colors">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-texte">
                        {sc.title}{' '}
                        <span className="font-normal text-texte-doux">
                          · {sc.historicalRef}
                        </span>
                      </div>
                      <p className="text-[11px] text-texte-doux mt-0.5">
                        {sc.description}
                      </p>
                    </td>

                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        isGainBefore ? 'text-succes-texte' : 'text-erreur-texte'
                      }`}
                    >
                      <div className="font-semibold">
                        {formatSignedEur(sc.impactBeforeCad, 0)}
                      </div>
                      <div className="text-[11px]">
                        {formatSignedPct(sc.impactBeforePct, 1)}
                      </div>
                    </td>

                    <td
                      className={`py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        isGainAfter ? 'text-succes-texte' : 'text-alerte-texte'
                      }`}
                    >
                      <div className="font-semibold">
                        {formatSignedEur(sc.impactAfterCad, 0)}
                      </div>
                      <div className="text-[11px]">
                        {formatSignedPct(sc.impactAfterPct, 1)}
                      </div>
                    </td>

                    <td
                      className={`py-3 pl-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        isImproved ? 'text-succes-texte' : 'text-texte-doux'
                      }`}
                    >
                      {sc.capitalProtectedCad > 0
                        ? `+${formatEur(sc.capitalProtectedCad, 0)} préservés`
                        : sc.capitalProtectedCad < 0
                          ? formatSignedEur(sc.capitalProtectedCad, 0)
                          : 'Neutre'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 2: PASSIVE INCOME (DIVIDENDS + COUPONS + STAKING) & FEE DRAG */}
      {activeTab === 'income_fees' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 font-mono tabular-nums">
          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Revenus passifs bruts / an
            </span>
            <div className="text-base font-bold text-texte">
              {formatEur(inc.grossAnnualIncomeBeforeCad, 0)} →{' '}
              <span className="text-succes-texte">
                {formatEur(inc.grossAnnualIncomeAfterCad, 0)}
              </span>
            </div>
            <span className="block font-sans text-[11px] text-texte-doux">
              Rendement courant : {formatPct(inc.portfolioYieldBeforePct, 2)} →{' '}
              {formatPct(inc.portfolioYieldAfterPct, 2)} / an
            </span>
          </div>

          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Rente mensuelle moyenne ($ CAD)
            </span>
            <div className="text-base font-bold text-texte">
              {formatEur(inc.monthlyPassiveIncomeBeforeCad, 0)} →{' '}
              <span className="text-succes-texte">
                {formatEur(inc.monthlyPassiveIncomeAfterCad, 0)} / mois
              </span>
            </div>
            <span className="block font-sans text-[11px] text-texte-doux">
              Dividendes actions + coupons + staking
            </span>
          </div>

          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Frais de gestion cachés (RFG / TER)
            </span>
            <div className="text-base font-bold text-texte">
              {formatEur(inc.annualFeesBeforeCad, 0)} →{' '}
              <span>{formatEur(inc.annualFeesAfterCad, 0)} / an</span>
            </div>
            <span className="block font-sans text-[11px] text-alerte-texte">
              Impact composé 10 ans : ~{formatEur(inc.compounded10yFeesAfterCad, 0)}
            </span>
          </div>

          <div className="space-y-1">
            <span className="block font-sans text-xs text-texte-doux">
              Cash-Flow Net Annuel (Revenus − Frais)
            </span>
            <div className="text-base font-bold text-succes-texte">
              {formatEur(inc.netAnnualCarryAfterCad, 0)} / an
            </div>
            <span className="block font-sans text-[11px] text-texte">
              Variation : {formatSignedEur(netCarryDelta, 0)} / an après arbitrages
            </span>
          </div>
        </div>
      )}

      {/* TAB 3: CANADIAN TAX WRAPPER OPTIMIZATION (CELI / REER / NON-ENREGISTRÉ) */}
      {activeTab === 'tax_cad' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-texte">
            <span>
              Répartition optimale de vos lignes selon les conventions fiscales ARC &amp; Canada–É.-U. (retenue IRS 15 %, crédit pour dividendes déterminés canadiens, exonération CELI).
            </span>
            <span className="font-mono tabular-nums font-semibold text-succes-texte whitespace-nowrap">
              Gain fiscal estimé : +{formatEur(xray.totalAnnualTaxOptimizedCad, 0)} / an
            </span>
          </div>

          <div className="overflow-x-auto border-t border-bordure pt-2">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-bordure text-texte-doux">
                  <th className="py-2 pr-3 font-medium">Actif cible</th>
                  <th className="py-2 px-3 font-medium text-right">Montant ($ CAD)</th>
                  <th className="py-2 px-3 font-medium">Compte recommandé</th>
                  <th className="py-2 px-3 font-medium">Justification fiscale concrète</th>
                  <th className="py-2 pl-3 font-medium text-right">Économie / an</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bordure">
                {xray.taxWrapperLines.slice(0, 10).map((line) => (
                  <tr
                    key={line.assetId}
                    className="hover:bg-surface-douce/30 transition-colors"
                  >
                    <td className="py-2.5 pr-3">
                      <button
                        type="button"
                        onClick={() => onInspectAsset(line.assetId)}
                        className="min-h-11 font-semibold text-texte hover:text-succes-texte transition-colors text-left cursor-pointer"
                      >
                        <span className="font-mono">{line.ticker}</span> · {line.name}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-texte whitespace-nowrap">
                      {formatEur(line.valueCad, 0)}
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-succes-texte whitespace-nowrap">
                      {line.recommendedWrapper}
                    </td>
                    <td className="py-2.5 px-3 text-texte-doux max-w-md">
                      {line.concreteRule}
                    </td>
                    <td className="py-2.5 pl-3 text-right font-mono tabular-nums text-succes-texte whitespace-nowrap">
                      +{formatEur(line.estimatedAnnualTaxSavedCad, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: CURRENCY & SECTOR EXPOSURE */}
      {activeTab === 'exposure' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
          <div className="space-y-2.5">
            <h4 className="font-semibold text-texte pb-1 border-b border-bordure">
              Exposition aux Devises Sous-Jacentes (valorisées en $ CAD)
            </h4>
            <div className="space-y-2 font-mono tabular-nums">
              {xray.currencyBreakdown.map((c) => (
                <div key={c.currency} className="space-y-1">
                  <div className="flex items-center justify-between text-texte">
                    <span className="font-sans font-medium text-texte">
                      {c.currency}
                    </span>
                    <span>
                      {formatPct(c.weightBeforePct, 1)} →{' '}
                      <strong className="text-texte">
                        {formatPct(c.weightAfterPct, 1)}
                      </strong>{' '}
                      ({formatEur(c.valueAfterCad, 0)})
                    </span>
                  </div>
                  <svg className="w-full h-1.5 block" aria-hidden="true">
                    <rect
                      width="100%"
                      height="6"
                      rx="2"
                      className="fill-fond"
                    />
                    <rect
                      width={`${Math.min(100, Math.max(0, c.weightAfterPct))}%`}
                      height="6"
                      rx="2"
                      className="fill-succes-texte"
                    />
                  </svg>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            <h4 className="font-semibold text-texte pb-1 border-b border-bordure">
              Répartition Sectorielle &amp; Classes d’Actifs (Plafond Pro 24 %)
            </h4>
            <div className="space-y-2 font-mono tabular-nums">
              {xray.sectorBreakdown.slice(0, 6).map((s) => (
                <div key={s.sector} className="space-y-1">
                  <div className="flex items-center justify-between text-texte">
                    <span className="font-sans text-texte truncate pr-2">
                      {s.sector}
                    </span>
                    <span className="whitespace-nowrap">
                      {formatPct(s.weightBeforePct, 1)} →{' '}
                      <strong
                        className={
                          s.weightAfterPct > 28
                            ? 'text-alerte-texte'
                            : 'text-texte'
                        }
                      >
                        {formatPct(s.weightAfterPct, 1)}
                      </strong>
                    </span>
                  </div>
                  <svg className="w-full h-1.5 block" aria-hidden="true">
                    <rect
                      width="100%"
                      height="6"
                      rx="2"
                      className="fill-fond"
                    />
                    <rect
                      width={`${Math.min(100, Math.max(0, s.weightAfterPct))}%`}
                      height="6"
                      rx="2"
                      className={
                        s.weightAfterPct > 28 ? 'fill-alerte-texte' : 'fill-repere'
                      }
                    />
                  </svg>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
