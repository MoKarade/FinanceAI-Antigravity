import React, { useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { InstitutionalQuantReport } from '../../services/valoria/institutionalQuantEngine';
import { ConcretePortfolioXRay } from '../../services/valoria/multiAssetQuantEngine';
import { PortfolioLot, PortfolioSummary } from '../../services/valoria/engine';
import { MacroIndicators } from '../../services/valoria/marketData';
import { PortfolioXRaySection } from './PortfolioXRaySection';
import { D3WatchlistVolatilityChart } from './D3WatchlistVolatilityChart';
import { D3BenchmarkChart } from './D3BenchmarkChart';
import {
  formatEur,
  formatPct,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface DeepQuantModelsViewProps {
  institutionalQuant: InstitutionalQuantReport;
  xray: ConcretePortfolioXRay;
  lots: PortfolioLot[];
  portfolioSummary: PortfolioSummary;
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  watchlistIds: string[];
  marketUniverseVersion: number;
  onAddWatchlistAsset: (assetId: string) => void;
  onRemoveWatchlistAsset: (assetId: string) => void;
  onQuickInvestFromWatchlist: (assetId: string, amountCad: number) => void;
  onInspectAsset: (assetId: string) => void;
}

type QuantSubTab = 'black_litterman' | 'monte_carlo_jumps' | 'factors_xray' | 'd3_charts';

export const DeepQuantModelsView: React.FC<DeepQuantModelsViewProps> = ({
  institutionalQuant,
  xray,
  lots,
  portfolioSummary: _portfolioSummary,
  livePrices,
  macro,
  watchlistIds,
  marketUniverseVersion,
  onAddWatchlistAsset,
  onRemoveWatchlistAsset,
  onQuickInvestFromWatchlist,
  onInspectAsset,
}) => {
  const [subTab, setSubTab] = useState<QuantSubTab>('black_litterman');

  const { blackLitterman, factorAttribution, jumpMonteCarlo } = institutionalQuant;
  const mcBefore = jumpMonteCarlo.before;
  const mcAfter = jumpMonteCarlo.after;
  const maxBarWealth = Math.max(1, mcAfter.p95Bull5yCad, mcBefore.p95Bull5yCad);

  return (
    <div className="space-y-6">
      {/* Clean Sub-Navigation for the 4 Deep Quantitative Pillars */}
      <div className="bg-surface/70 border border-bordure rounded-lg p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-texte">
            Modèles Mathématiques Institutionnels &amp; Graphiques D3 ($ CAD)
          </h2>
          <p className="text-xs sm:text-sm text-texte-doux">
            Tous les calculs qui sous-tendent vos recommandations d’achat et de vente sont détaillés ici et expliqués en français accessible.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-1.5 p-1 bg-fond border border-bordure rounded-md">
          <button aria-pressed={Boolean(subTab === 'black_litterman')}
            type="button"
            onClick={() => setSubTab('black_litterman')}
            className={`min-h-11 px-3 py-2 text-xs font-medium rounded-sm transition-colors whitespace-nowrap truncate cursor-pointer ${
              subTab === 'black_litterman'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            1. Black-Litterman &amp; Ledoit-Wolf
          </button>
          <button aria-pressed={Boolean(subTab === 'monte_carlo_jumps')}
            type="button"
            onClick={() => setSubTab('monte_carlo_jumps')}
            className={`min-h-11 px-3 py-2 text-xs font-medium rounded-sm transition-colors whitespace-nowrap truncate cursor-pointer ${
              subTab === 'monte_carlo_jumps'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            2. Monte Carlo 10 000 Sauts
          </button>
          <button aria-pressed={Boolean(subTab === 'factors_xray')}
            type="button"
            onClick={() => setSubTab('factors_xray')}
            className={`min-h-11 px-3 py-2 text-xs font-medium rounded-sm transition-colors whitespace-nowrap truncate cursor-pointer ${
              subTab === 'factors_xray'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            3. Facteurs Fama-French &amp; Stress
          </button>
          <button aria-pressed={Boolean(subTab === 'd3_charts')}
            type="button"
            onClick={() => setSubTab('d3_charts')}
            className={`min-h-11 px-3 py-2 text-xs font-medium rounded-sm transition-colors whitespace-nowrap truncate cursor-pointer ${
              subTab === 'd3_charts'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            4. Courbes D3 (Volatilité &amp; $ CAD)
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: BAYESIAN BLACK-LITTERMAN + LEDOIT-WOLF */}
      {subTab === 'black_litterman' && (
        <section className="bg-surface/70 border border-bordure rounded-lg p-5 space-y-5">
          {/* Plain-French Explainer (Single-elevation hairline divider) */}
          <div className="pb-4 border-b border-bordure space-y-1.5">
            <div className="text-xs font-semibold text-succes-texte">
              Comment fonctionne ce calcul (en français simple) ?
            </div>
            <p className="text-xs text-texte leading-relaxed">
              Au lieu de deviner l’avenir sur l’historique brut, le modèle <strong>Black-Litterman</strong> (créé chez Goldman Sachs) part du rendement d’équilibre du marché mondial, puis y fusionne mathématiquement : <strong>(1) la vraie valeur comptable de l’entreprise (DCF 3 scénarios &amp; ROIC)</strong> et <strong>(2) le score des actualités récentes</strong>. La matrice de risque est stabilisée par le rétrécissement de <strong>Ledoit-Wolf</strong> (intensité α = {(blackLitterman.shrinkageAlpha * 100).toFixed(1).replace('.', ',')} %, corrélation moyenne ρ = {blackLitterman.averageCorrelation.toFixed(2).replace('.', ',')}).
            </p>
          </div>

          {/* Model Parameters Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pb-4 border-b border-bordure font-mono tabular-nums text-xs">
            <div>
              <span className="block font-sans text-texte-doux">
                Rendement attendu avant arbitrages
              </span>
              <span className="mt-1 block text-base font-bold text-texte">
                {formatPct(institutionalQuant.expectedReturnBeforePct, 2)} / an
              </span>
            </div>
            <div>
              <span className="block font-sans text-texte-doux">
                Rendement postérieur après arbitrages
              </span>
              <span className="mt-1 block text-base font-bold text-succes-texte">
                {formatPct(institutionalQuant.expectedReturnAfterPct, 2)} / an
              </span>
            </div>
            <div>
              <span className="block font-sans text-texte-doux">
                Aversion au risque (δ) &amp; Prior (τ)
              </span>
              <span className="mt-1 block text-base font-bold text-texte">
                δ = {blackLitterman.riskAversionDelta.toFixed(2).replace('.', ',')} · τ ={' '}
                {String(blackLitterman.tauPriorScalar).replace('.', ',')}
              </span>
            </div>
            <div>
              <span className="block font-sans text-texte-doux">
                Rétrécissement covariance Ledoit-Wolf
              </span>
              <span className="mt-1 block text-base font-bold text-succes-texte">
                α = {formatPct(blackLitterman.shrinkageAlpha * 100, 1)}
              </span>
            </div>
          </div>

          {/* Black-Litterman Posterior Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-bordure text-texte-doux">
                  <th className="py-2 pr-3 font-medium">Actif analysé</th>
                  <th className="py-2 px-2 font-medium text-right">
                    Équilibre Marché (Π)
                  </th>
                  <th className="py-2 px-2 font-medium text-right">
                    Vue Fondamentale (DCF)
                  </th>
                  <th className="py-2 px-2 font-medium text-right">
                    Choc Actualités (Δμ)
                  </th>
                  <th className="py-2 px-2 font-medium text-right">
                    Rendement Black-Litterman
                  </th>
                  <th className="py-2 px-2 font-medium text-right">Confiance</th>
                  <th className="py-2 pl-2 font-medium text-right">
                    Poids Actuel → Cible BL
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bordure font-mono tabular-nums">
                {blackLitterman.rows.slice(0, 16).map((row) => (
                  <tr
                    key={row.assetId}
                    className="hover:bg-surface-douce/35 transition-colors"
                  >
                    <td className="py-2.5 pr-3 font-sans">
                      <button
                        type="button"
                        onClick={() => onInspectAsset(row.assetId)}
                        className="min-h-11 text-left hover:text-succes-texte transition-colors cursor-pointer"
                      >
                        <span className="font-mono font-semibold text-texte">
                          {row.ticker}
                        </span>{' '}
                        <span className="text-texte-doux">
                          · {row.name.split(' (')[0]}
                        </span>
                      </button>
                    </td>
                    <td className="py-2.5 px-2 text-right text-texte">
                      {formatPct(row.equilibriumReturnPct, 2)}
                    </td>
                    <td className="py-2.5 px-2 text-right text-texte">
                      {formatPct(row.dcfFundamentalViewPct, 2)}
                    </td>
                    <td
                      className={`py-2.5 px-2 text-right ${
                        row.newsCatalystShockPct > 0.3
                          ? 'text-succes-texte'
                          : row.newsCatalystShockPct < -0.3
                            ? 'text-erreur-texte'
                            : 'text-texte-doux'
                      }`}
                    >
                      {formatSignedPct(row.newsCatalystShockPct, 2)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-bold text-succes-texte">
                      {formatPct(row.posteriorExpectedReturnPct, 2)}
                    </td>
                    <td className="py-2.5 px-2 text-right text-texte">
                      {row.viewConfidencePct} %
                    </td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap">
                      <span className="text-texte-doux">
                        {formatPct(row.currentWeightPct, 1)}
                      </span>{' '}
                      →{' '}
                      <span className="font-semibold text-texte">
                        {formatPct(row.optimalWeightPct, 1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* SUB-TAB 2: MERTON JUMP-DIFFUSION MONTE CARLO (10,000 PATHS) */}
      {subTab === 'monte_carlo_jumps' && (
        <section className="bg-surface/70 border border-bordure rounded-lg p-5 space-y-5">
          <div className="pb-4 border-b border-bordure space-y-1.5">
            <div className="text-xs font-semibold text-succes-texte">
              Pourquoi une simulation « à sauts de Merton » sur 10 000 scénarios ?
            </div>
            <p className="text-xs text-texte leading-relaxed">
              Les simulations classiques sous-estiment gravement les krachs boursiers. Notre moteur simule <strong>10 000 futurs possibles sur 5 ans en $ CAD</strong> en incluant des <strong>chocs soudains de marché (sauts de Poisson)</strong> pour comparer exactement votre portefeuille actuel face au portefeuille optimisé sur les mêmes chocs aléatoires.
            </p>
          </div>

          {/* Key Outcome KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pb-4 border-b border-bordure font-mono tabular-nums text-xs">
            <div>
              <span className="block font-sans text-texte-doux">
                Capital médian à 5 ans (Après conseils)
              </span>
              <span className="mt-1 block text-base font-bold text-succes-texte">
                {formatEur(mcAfter.p50Median5yCad, 0)}
              </span>
              <span className="font-sans text-[11px] text-succes-texte">
                {formatSignedEur(jumpMonteCarlo.median5yGainDeltaCad, 0)} vs sans agir
              </span>
            </div>

            <div>
              <span className="block font-sans text-texte-doux">
                Perte extrême CVaR 99 % (1 % pires années)
              </span>
              <span className="mt-1 block text-base font-bold text-texte">
                -{formatEur(mcBefore.cvar99AnnualCad, 0)} → -
                {formatEur(mcAfter.cvar99AnnualCad, 0)}
              </span>
              <span className="font-sans text-[11px] text-succes-texte">
                {jumpMonteCarlo.tailRiskSaved99Cad >= 0
                  ? `${formatEur(jumpMonteCarlo.tailRiskSaved99Cad, 0)} d’épargne protégée en krach`
                  : 'Profil offensif orienté rendement'}
              </span>
            </div>

            <div>
              <span className="block font-sans text-texte-doux">
                Ratio d’Omega (Gains / Pertes pondérés)
              </span>
              <span className="mt-1 block text-base font-bold text-succes-texte">
                {mcBefore.omegaRatio.toFixed(2)} → {mcAfter.omegaRatio.toFixed(2)}
              </span>
              <span className="font-sans text-[11px] text-texte-doux">
                &gt; 1,50 = asymétrie positive solide
              </span>
            </div>

            <div>
              <span className="block font-sans text-texte-doux">
                Probabilité d’être perdant au bout de 5 ans
              </span>
              <span className="mt-1 block text-base font-bold text-texte">
                {formatPct(mcBefore.probLoss5yPct, 1)} →{' '}
                <span className="text-succes-texte">
                  {formatPct(mcAfter.probLoss5yPct, 1)}
                </span>
              </span>
              <span className="font-sans text-[11px] text-texte-doux">
                Ulcer Index : {mcBefore.ulcerIndexPct} % → {mcAfter.ulcerIndexPct} %
              </span>
            </div>
          </div>

          {/* Visual Quantile Bars Comparison ($ CAD at 5 Years) */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-texte">
              Distribution complète de votre patrimoine dans 5 ans ($ CAD — 10 000 trajectoires)
            </h3>

            {[
              {
                label: 'Scénario Krach Sévère (5e centile — 1 malchance sur 20)',
                beforeVal: mcBefore.p5Bear5yCad,
                afterVal: mcAfter.p5Bear5yCad,
              },
              {
                label: 'Scénario Prudent / Marché Lent (25e centile)',
                beforeVal: mcBefore.p25Conservative5yCad,
                afterVal: mcAfter.p25Conservative5yCad,
              },
              {
                label: 'Scénario Central Médian (50e centile — le plus probable)',
                beforeVal: mcBefore.p50Median5yCad,
                afterVal: mcAfter.p50Median5yCad,
              },
              {
                label: 'Scénario Porteur (75e centile)',
                beforeVal: mcBefore.p75Optimistic5yCad,
                afterVal: mcAfter.p75Optimistic5yCad,
              },
              {
                label: 'Scénario Très Haussier (95e centile)',
                beforeVal: mcBefore.p95Bull5yCad,
                afterVal: mcAfter.p95Bull5yCad,
              },
            ].map((q) => {
              const diff = q.afterVal - q.beforeVal;
              const wBefore = Math.max(4, (q.beforeVal / maxBarWealth) * 100);
              const wAfter = Math.max(4, (q.afterVal / maxBarWealth) * 100);
              return (
                <div
                  key={q.label}
                  className="space-y-1.5 pb-3 border-b border-bordure last:border-b-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-texte font-medium">{q.label}</span>
                    <span className="font-mono tabular-nums">
                      <span className="text-texte-doux">
                        Actuel {formatEur(q.beforeVal, 0)}
                      </span>{' '}
                      →{' '}
                      <strong className="text-texte">
                        Après {formatEur(q.afterVal, 0)}
                      </strong>{' '}
                      <span
                        className={
                          diff >= 0 ? 'text-succes-texte' : 'text-alerte-texte'
                        }
                      >
                        ({formatSignedEur(diff, 0)})
                      </span>
                    </span>
                  </div>

                  <svg
                    viewBox="0 0 100 5"
                    preserveAspectRatio="none"
                    className="w-full h-3 rounded-sm bg-fond overflow-hidden"
                    aria-hidden="true"
                  >
                    <rect
                      x={0}
                      y={0.4}
                      width={wBefore}
                      height={1.8}
                      fill={VALORIA_PALETTE.mutedSlate}
                    />
                    <rect
                      x={0}
                      y={2.8}
                      width={wAfter}
                      height={1.8}
                      fill={VALORIA_PALETTE.teal}
                    />
                  </svg>
                </div>
              );
            })}
            <div className="text-[11px] text-texte-doux flex items-center gap-4">
              <span>Barre grise : Portefeuille actuel sans changement</span>
              <span>·</span>
              <span className="text-succes-texte">
                Barre turquoise : Portefeuille après application des conseils
              </span>
            </div>
          </div>
        </section>
      )}

      {/* SUB-TAB 3: 6-FACTOR FAMA-FRENCH + STRESS-TESTS & CELI/REER */}
      {subTab === 'factors_xray' && (
        <div className="space-y-6">
          <section className="bg-surface/70 border border-bordure rounded-lg p-5 space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-texte">
                Décomposition à 6 Facteurs de Fama-French &amp; Carhart (Régression OLS)
              </h3>
              <p className="text-xs text-texte leading-relaxed">
                {factorAttribution.plainFrenchDiagnosis} (R² expliqué :{' '}
                <span className="font-mono tabular-nums">
                  {(factorAttribution.rSquaredAfter * 100).toFixed(1).replace('.', ',')} %
                </span>
                ).
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-bordure text-texte-doux">
                    <th className="py-2 pr-3 font-medium">Facteur académique</th>
                    <th className="py-2 px-3 font-medium">Signification concrète</th>
                    <th className="py-2 px-2 font-medium text-right">Avant (β)</th>
                    <th className="py-2 px-2 font-medium text-right">Après (β)</th>
                    <th className="py-2 pl-2 font-medium text-right">Stat-t</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bordure">
                  {factorAttribution.factors.map((f) => (
                    <tr key={f.code} className="hover:bg-surface-douce/30">
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <span className="font-mono font-semibold text-succes-texte">
                          {f.code}
                        </span>{' '}
                        <span className="text-texte">· {f.name}</span>
                      </td>
                      <td className="py-2.5 px-3 text-texte-doux">
                        {f.plainFrenchMeaning}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-texte-doux">
                        {f.betaBefore >= 0 ? '+' : ''}
                        {f.betaBefore.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-texte">
                        {f.betaAfter >= 0 ? '+' : ''}
                        {f.betaAfter.toFixed(2)}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono tabular-nums text-texte-doux">
                        {f.tStatAfter.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <PortfolioXRaySection xray={xray} onInspectAsset={onInspectAsset} />
        </div>
      )}

      {/* SUB-TAB 4: D3 VOLATILITY & PORTFOLIO PERFORMANCE CHARTS */}
      {subTab === 'd3_charts' && (
        <div className="space-y-6">
          <D3WatchlistVolatilityChart
            watchlistIds={watchlistIds}
            lots={lots}
            livePrices={livePrices}
            riskFreeRatePct={macro.centralBankRatePct}
            marketUniverseVersion={marketUniverseVersion}
            onAddWatchlistAsset={onAddWatchlistAsset}
            onRemoveWatchlistAsset={onRemoveWatchlistAsset}
            onQuickInvestAsset={onQuickInvestFromWatchlist}
            onInspectAsset={onInspectAsset}
          />

          <div className="bg-surface/70 border border-bordure rounded-lg p-5">
            <D3BenchmarkChart lots={lots} livePrices={livePrices} />
          </div>
        </div>
      )}
    </div>
  );
};
