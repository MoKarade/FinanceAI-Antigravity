import React, { useMemo } from 'react';
import { ArrowRight, Landmark, TrendingUp } from 'lucide-react';
import { Tab } from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { buildValoriaFiscalAndFutureContext } from '../../services/valoria/valoriaIntegration';
import { formatCad, formatPct } from '../../services/valoria/valoriaFormatters';
import { PrivateAmount } from '../ui/PrivateAmount';

interface ValoriaFinanceAiHubCardProps {
  valoria5yMedianCad: number;
  expectedCagrBeforePct: number;
  expectedCagrAfterPct: number;
}

/**
 * Pont natif entre Valoria et les moteurs officiels de FinanceAI :
 * 1) Fiscalité QC / Canada (`optimizeAssetLocation`, barème année en cours, salaires mensuels × 12) ;
 * 2) Projection officielle `Futur` (`lastProjection.chartData` ou `<ProjectionRequired>` si absente).
 */
export const ValoriaFinanceAiHubCard: React.FC<ValoriaFinanceAiHubCardProps> = ({
  valoria5yMedianCad,
  expectedCagrBeforePct,
  expectedCagrAfterPct,
}) => {
  const assets = useFinanceStore((s) => s.assets);
  const fxRates = useFinanceStore((s) => s.fxRates);
  const config = useFinanceStore((s) => s.config);
  const lastProjection = useFinanceStore((s) => s.lastProjection);
  const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);

  const ctx = useMemo(
    () =>
      buildValoriaFiscalAndFutureContext({
        assets,
        fxRates,
        config,
        lastProjection: lastProjection ?? null,
        year: new Date().getFullYear(),
      }),
    [assets, fxRates, config, lastProjection]
  );

  return (
    <section
      aria-label="Passerelle Fiscalité québécoise, Futur et Retraite"
      className="grid grid-cols-1 lg:grid-cols-2 gap-4"
    >
      {/* PILIER 1 : FISCALITÉ QC / CANADA (CELI / REER / CELIAPP) */}
      <div className="bg-surface border border-bordure rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-bordure">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-texte-doux shrink-0" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-texte">
              Emplacement fiscal QC / Canada (CELI · REER · CELIAPP)
            </h3>
          </div>
          {ctx.efficiencyScore100 !== null ? (
            <span className="px-2.5 py-1 rounded-full bg-succes-fond text-succes-texte text-xs font-mono font-semibold tabular-nums">
              Efficacité <PrivateAmount>{ctx.efficiencyScore100}</PrivateAmount>/100
            </span>
          ) : (
            <span className="px-2.5 py-1 rounded-full bg-surface-douce text-texte-doux text-xs font-mono">
              Barème {new Date().getFullYear()}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {ctx.envelopes.map((env) => (
            <div
              key={env.code}
              className="p-2.5 rounded-xl bg-fond/70 border border-bordure space-y-0.5"
            >
              <div className="text-[11px] text-texte-doux truncate">{env.label}</div>
              <div className="font-mono text-xs font-bold text-texte tabular-nums">
                <PrivateAmount>{formatCad(env.valueCad, 0)}</PrivateAmount>
              </div>
              <div className="font-mono text-[11px] text-texte-doux tabular-nums">
                <PrivateAmount>{env.sharePct} %</PrivateAmount>
              </div>
            </div>
          ))}
        </div>

        {ctx.totalAnnualTaxLossCad !== null ? (
          <div className="space-y-2 text-xs">
            <div className="p-3 rounded-xl bg-fond/80 border border-bordure flex flex-wrap items-center justify-between gap-2">
              <span className="text-texte-doux">Frottement fiscal annuel estimé</span>
              <span
                className={`font-mono font-bold tabular-nums ${
                  ctx.totalAnnualTaxLossCad > 0 ? 'text-alerte-texte' : 'text-succes-texte'
                }`}
              >
                <PrivateAmount>{formatCad(ctx.totalAnnualTaxLossCad, 0)}/an</PrivateAmount>
              </span>
            </div>
            {ctx.taxRecommendations.slice(0, 2).map((rec, i) => (
              <div
                key={`fiscal-swap-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-surface-douce border border-bordure text-[11px]"
              >
                <span className="text-texte">
                  {rec.currentAccount} → <strong>{rec.recommendedAccount}</strong> · {rec.rationale}
                </span>
                <span className="font-mono text-succes-texte shrink-0">
                  +<PrivateAmount>{formatCad(rec.annualLossCad, 0)}/an</PrivateAmount>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-texte-doux">
            Renseigne ton salaire mensuel dans Profil et tes comptes réels dans Placements pour chiffrer l’impôt évitable selon le barème ARC / Revenu Québec.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => navigateWithFocus(Tab.RETIREMENT)}
            className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fond hover:bg-surface-douce border border-bordure-champ text-xs font-medium text-texte transition-colors focus-ring cursor-pointer"
          >
            <span>Optimiser dans Retraite</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigateWithFocus(Tab.TAX)}
            className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fond hover:bg-surface-douce border border-bordure-champ text-xs font-medium text-texte-doux hover:text-texte transition-colors focus-ring cursor-pointer"
          >
            <span>Centre fiscal</span>
          </button>
        </div>
      </div>

      {/* PILIER 2 : SYNCHRONISATION TRAJECTOIRE FUTUR & BLACK-LITTERMAN */}
      <div className="bg-surface border border-bordure rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-bordure">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-texte-doux shrink-0" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-texte">
              Pont Projection Futur &amp; Black-Litterman
            </h3>
          </div>
          <span className="font-mono text-xs text-succes-texte font-semibold tabular-nums">
            {/* NOMBRE-NON-MONETAIRE : rendement attendu du modèle Black-Litterman */}
            BL {formatPct(expectedCagrBeforePct, 1)} → {formatPct(expectedCagrAfterPct, 1)}/an
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl bg-fond/70 border border-bordure space-y-1">
            <div className="text-[11px] text-texte-doux">Valoria · Médiane 5 ans (P50 optimisé)</div>
            <div className="font-mono text-base font-bold text-texte tabular-nums">
              <PrivateAmount>{formatCad(valoria5yMedianCad, 0)}</PrivateAmount>
            </div>
            <div className="text-[11px] text-texte-doux">
              Simulation 10 000 sauts (portefeuille isolé)
            </div>
          </div>

          <div className="p-3 rounded-xl bg-fond/70 border border-bordure space-y-1">
            <div className="text-[11px] text-texte-doux">
              Moteur Futur ({ctx.projected5yYear ?? '—'})
            </div>
            {ctx.futureAvailable && ctx.projected5yNetWorthCad !== null ? (
              <>
                <div className="font-mono text-base font-bold text-succes-texte tabular-nums">
                  <PrivateAmount>{formatCad(ctx.projected5yNetWorthCad, 0)}</PrivateAmount>
                </div>
                <div className="text-[11px] text-texte-doux">
                  {ctx.projectedRetirementNetWorthCad !== null && ctx.projectedRetirementAge !== null ? (
                    <>
                      Retraite ({ctx.projectedRetirementAge} ans) :{' '}
                      <PrivateAmount>{formatCad(ctx.projectedRetirementNetWorthCad, 0)}</PrivateAmount>
                    </>
                  ) : (
                    'Patrimoine net global officiel'
                  )}
                </div>
              </>
            ) : (
              <div className="text-xs font-mono text-texte-doux">— (projection non lancée)</div>
            )}
          </div>
        </div>

        {!ctx.futureAvailable && (
          <div
            role="status"
            className="p-3 rounded-xl bg-fond/80 border border-bordure text-xs text-texte-doux"
          >
            Ouvre l’onglet Futur au moins une fois pour calculer ta trajectoire officielle — aucune valeur n’est estimée tant que la projection n’est pas lancée.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => navigateWithFocus(Tab.FUTURE)}
            className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent hover:bg-accent-fonce text-sur-accent text-xs font-semibold transition-colors focus-ring cursor-pointer"
          >
            <span>Comparer dans Futur</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigateWithFocus(Tab.INVESTMENTS)}
            className="min-h-11 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-fond hover:bg-surface-douce border border-bordure-champ text-xs font-medium text-texte transition-colors focus-ring cursor-pointer"
          >
            <span>Voir mes Placements</span>
          </button>
        </div>
      </div>
    </section>
  );
};
