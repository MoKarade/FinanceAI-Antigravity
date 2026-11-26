import React, { useState } from 'react';
import { ExternalLink, Globe, RefreshCw, Search } from 'lucide-react';
import {
  AnalyzedNewsArticle,
  AssetNewsSummary,
  PortfolioNewsIntelligence,
} from '../../services/valoria/newsCatalystEngine';
import { AnalystTradeRecommendation, HeldLineDiagnostic } from '../../services/valoria/proAnalystAdvisor';
import { formatSignedPct } from '../../services/valoria/valoriaFormatters';
import { fetchValoriaGeminiNewsGrounding } from '../../services/valoria/valoriaAiClient';
import { PrivateAmount } from '../ui/PrivateAmount';
import { safeExternalHttpUrl } from '../../utils/safeExternalUrl';

interface LiveNewsCatalystViewProps {
  newsIntelligence: PortfolioNewsIntelligence;
  heldLines: HeldLineDiagnostic[];
  buyRecommendations: AnalystTradeRecommendation[];
  regimeName: string;
  isFetchingLiveNews: boolean;
  geminiApiKey?: string;
  onRefreshLiveNews: () => void;
  onInspectAsset: (assetId: string) => void;
}

type NewsFilterScope = 'portfolio' | 'opportunities' | 'macro';

export const LiveNewsCatalystView: React.FC<LiveNewsCatalystViewProps> = ({
  newsIntelligence,
  heldLines,
  buyRecommendations,
  regimeName,
  isFetchingLiveNews,
  geminiApiKey = '',
  onRefreshLiveNews,
  onInspectAsset,
}) => {
  const [scope, setScope] = useState<NewsFilterScope>('portfolio');
  const [isGroundingLoading, setIsGroundingLoading] = useState<boolean>(false);
  const [groundingResult, setGroundingResult] = useState<{
    markdownBrief: string;
    sources: Array<{ uri: string; title: string }>;
  } | null>(null);
  const [groundingError, setGroundingError] = useState<string | null>(null);

  const handleRunDeepWebSearch = async () => {
    setIsGroundingLoading(true);
    setGroundingError(null);
    try {
      const tickers = Array.from(
        new Set([
          ...heldLines.slice(0, 5).map((h) => h.ticker),
          ...buyRecommendations.slice(0, 3).map((b) => b.ticker),
        ])
      );
      const data = await fetchValoriaGeminiNewsGrounding(geminiApiKey, {
        tickers,
        regimeName,
      });
      if (!data.ok) {
        setGroundingError('Synthèse Web momentanément indisponible.');
      } else {
        setGroundingResult({
          markdownBrief: data.markdownBrief ?? '',
          sources: data.sources ?? [],
        });
      }
    } catch {
      setGroundingError(
        'Connexion au moteur de recherche Web interrompue. Le flux d’actualités boursières ci-dessous reste actif.'
      );
    } finally {
      setIsGroundingLoading(false);
    }
  };

  const heldSummaries: AssetNewsSummary[] = heldLines
    .map((h) => newsIntelligence.byAssetId.get(h.assetId))
    .filter((x): x is AssetNewsSummary => Boolean(x));

  const buySummaries: AssetNewsSummary[] = buyRecommendations
    .map((b) => newsIntelligence.byAssetId.get(b.assetId))
    .filter((x): x is AssetNewsSummary => Boolean(x));

  const toneColor = (score: number): string => {
    if (score >= 15) return 'text-succes-texte';
    if (score <= -15) return 'text-erreur-texte';
    return 'text-texte';
  };

  const tonePrefix = (score: number): string => {
    if (score >= 35) return '▲▲ ';
    if (score >= 15) return '▲ ';
    if (score <= -30) return '▼▼ ';
    if (score <= -15) return '▼ ';
    return '• ';
  };

  return (
    <div className="space-y-6">
      {/* Top Plain-French Summary of News Impact */}
      <section className="bg-surface/70 border border-bordure rounded-lg p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <h2 className="text-lg font-semibold text-texte">
              Analyse des Actualités &amp; Impact Direct sur vos Recommandations
            </h2>
            <p className="text-sm text-texte leading-relaxed">
              Chaque dépêche financière et annonce de banque centrale (Banque du Canada, Fed) est analysée et convertie en un bonus ou malus de rendement annuel injecté directement dans nos calculs d’achat et de vente.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onRefreshLiveNews}
              disabled={isFetchingLiveNews}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-texte bg-fond hover:bg-surface-douce disabled:opacity-50 border border-bordure-champ rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isFetchingLiveNews ? 'animate-spin' : ''}`}
              />
              <span>
                {isFetchingLiveNews ? 'Actualisation…' : 'Actualiser les dépêches'}
              </span>
            </button>

            <button
              type="button"
              onClick={handleRunDeepWebSearch}
              disabled={isGroundingLoading}
              className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              <span>
                {isGroundingLoading
                  ? 'Recherche Web en cours…'
                  : 'Synthèse Web approfondie'}
              </span>
            </button>
          </div>
        </div>

        {/* 4-Column Clear News Pulse */}
        <div className="pt-4 border-t border-bordure grid grid-cols-2 lg:grid-cols-4 gap-4 lg:divide-x lg:divide-bordure font-mono tabular-nums">
          <div className="lg:pr-4">
            <span className="block font-sans text-xs text-texte-doux">
              Climat médiatique de vos titres
            </span>
            <div
              className={`mt-1 text-base font-bold ${toneColor(
                newsIntelligence.portfolioSentimentScore
              )}`}
            >
              {tonePrefix(newsIntelligence.portfolioSentimentScore)}
              {newsIntelligence.portfolioSentimentLabel} (
              <PrivateAmount>
                {newsIntelligence.portfolioSentimentScore >= 0 ? '+' : ''}
                {newsIntelligence.portfolioSentimentScore}/100
              </PrivateAmount>)
            </div>
            <span className="text-[11px] font-sans text-texte-doux">
              Pondéré selon la taille de vos positions
            </span>
          </div>

          <div className="lg:px-4">
            <span className="block font-sans text-xs text-texte-doux">
              Effet sur votre rendement estimé
            </span>
            <div
              className={`mt-1 text-base font-bold ${toneColor(
                newsIntelligence.portfolioSentimentScore
              )}`}
            >
              {formatSignedPct(
                newsIntelligence.portfolioAnnualizedReturnImpactPct,
                2
              )}{' '}
              / an
            </div>
            <span className="text-[11px] font-sans text-texte-doux">
              Intégré dans le modèle Black-Litterman
            </span>
          </div>

          <div className="lg:px-4">
            <span className="block font-sans text-xs text-texte-doux">
              Titres portés vs sous pression
            </span>
            <div className="mt-1 text-base font-bold text-texte">
              <span className="text-succes-texte">
                {newsIntelligence.bullishHeldCount} portés
              </span>{' '}
              ·{' '}
              <span className="text-erreur-texte">
                {newsIntelligence.bearishHeldCount} sous pression
              </span>
            </div>
            <span className="text-[11px] font-sans text-texte-doux">
              Sur vos {heldLines.length} position(s) détenue(s)
            </span>
          </div>

          <div className="lg:pl-4">
            <span className="block font-sans text-xs text-texte-doux">
              Couverture du flux financier
            </span>
            <div className="mt-1 text-base font-bold text-succes-texte">
              {newsIntelligence.liveArticlesCount > 0
                ? `${newsIntelligence.liveArticlesCount} dépêches Web en direct`
                : 'Veille institutionnelle active'}
            </div>
            <span className="text-[11px] font-sans text-texte-doux">
              Yahoo Finance · Google Actualités · Macro
            </span>
          </div>
        </div>

        {/* Optional Deep Google Search Grounding Result */}
        {groundingError && (
          <div
            role="status"
            className="p-3.5 bg-fond border border-bordure rounded-md text-xs text-alerte-texte"
          >
            {groundingError}
          </div>
        )}

        {groundingResult && (
          <div className="p-4 bg-fond border border-succes-texte/40 rounded-md space-y-3">
            <div className="flex items-center justify-between gap-2 text-xs text-succes-texte font-semibold">
              <span className="inline-flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>Synthèse Web en direct sur vos actifs ($ CAD)</span>
              </span>
              <button
                type="button"
                onClick={() => setGroundingResult(null)}
                className="min-h-11 text-texte-doux hover:text-texte font-normal cursor-pointer"
              >
                Fermer
              </button>
            </div>
            <div className="text-xs text-texte leading-relaxed whitespace-pre-line">
              {groundingResult.markdownBrief}
            </div>
            {groundingResult.sources.length > 0 && (
              <div className="pt-2 border-t border-bordure flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-texte-doux">
                <span className="font-medium text-texte">Sources Web vérifiées :</span>
                {groundingResult.sources.map((src, i) => {
                  const safeUri = safeExternalHttpUrl(src.uri);
                  if (!safeUri) return null;
                  return (
                    <a
                      key={`${safeUri}-${i}`}
                      href={safeUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-succes-texte hover:underline"
                    >
                      <span className="truncate max-w-[220px]">{src.title}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-surface border border-bordure rounded-md">
          <button aria-pressed={Boolean(scope === 'portfolio')}
            type="button"
            onClick={() => setScope('portfolio')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              scope === 'portfolio'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Mes positions détenues ({heldSummaries.length})
          </button>
          <button aria-pressed={Boolean(scope === 'opportunities')}
            type="button"
            onClick={() => setScope('opportunities')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              scope === 'opportunities'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Idées d’achat recommandées ({buySummaries.length})
          </button>
          <button aria-pressed={Boolean(scope === 'macro')}
            type="button"
            onClick={() => setScope('macro')}
            className={`min-h-11 px-3 py-1.5 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              scope === 'macro'
                ? 'bg-accent text-sur-accent font-semibold'
                : 'text-texte-doux hover:text-texte'
            }`}
          >
            Banque du Canada, Fed &amp; Macro ({newsIntelligence.macroArticles.length})
          </button>
        </div>
      </div>

      {/* News Content by Selected Scope */}
      {scope === 'macro' ? (
        <div className="bg-surface/70 border border-bordure rounded-lg divide-y divide-bordure">
          {newsIntelligence.macroArticles.map((art: AnalyzedNewsArticle) => (
            <article key={art.id} className="p-5 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-texte-doux">
                <div>
                  <span className="font-mono font-semibold text-succes-texte">
                    {art.ticker}
                  </span>
                  <span aria-hidden="true"> · </span>
                  <span>{art.categoryLabel}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{art.publisher}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{art.publishedAt}</span>
                </div>
                <span
                  className={`font-mono tabular-nums font-semibold ${toneColor(
                    art.sentimentScore
                  )}`}
                >
                  {tonePrefix(art.sentimentScore)}
                  {/* NOMBRE-NON-MONETAIRE : score sentiment public de l'article */}
                  {art.sentimentLabel} ({art.sentimentScore >= 0 ? '+' : ''}
                  {art.sentimentScore}/100)
                </span>
              </div>
              <h3 className="text-sm font-semibold text-texte">{art.title}</h3>
              {art.summary && (
                <p className="text-xs text-texte leading-relaxed">{art.summary}</p>
              )}
              <p className="text-xs text-succes-texte">{art.plainFrenchImpact}</p>
            </article>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {(scope === 'portfolio' ? heldSummaries : buySummaries).map((summary) => (
            <section
              key={summary.assetId}
              className="bg-surface/70 border border-bordure rounded-lg p-5 flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3 pb-3 border-b border-bordure">
                  <div>
                    <button
                      type="button"
                      onClick={() => onInspectAsset(summary.assetId)}
                      className="min-h-11 text-left group cursor-pointer"
                    >
                      <h3 className="text-base font-bold text-texte group-hover:text-succes-texte transition-colors">
                        <span className="font-mono">{summary.ticker}</span> —{' '}
                        {summary.name.split(' (')[0]}
                      </h3>
                    </button>
                    <div className="text-xs text-texte-doux mt-0.5">
                      <span>Thème dominant : {summary.dominantCatalystLabel}</span>
                      <span aria-hidden="true"> · </span>
                      <span>
                        {summary.liveWebCount > 0
                          ? `${summary.liveWebCount} article(s) Web en direct`
                          : 'Synthèse fondamentale & sectorielle'}
                      </span>
                    </div>
                  </div>

                  <div className="text-right font-mono tabular-nums shrink-0">
                    <div
                      className={`text-sm font-bold ${toneColor(
                        summary.compositeSentimentScore
                      )}`}
                    >
                      {tonePrefix(summary.compositeSentimentScore)}
                      {summary.sentimentLabel}
                    </div>
                    <div className="text-[11px] text-texte-doux">
                      Impact :{' '}
                      {formatSignedPct(summary.blackLittermanNewsShockPct, 1)}/an
                    </div>
                  </div>
                </div>

                {/* Plain French Takeaway */}
                <p className="text-xs text-texte leading-relaxed pb-3 border-b border-bordure">
                  {summary.plainFrenchTakeaway}
                </p>

                {/* Individual Headlines */}
                <div className="divide-y divide-bordure">
                  {summary.articles.map((art) => (
                    <article key={art.id} className="py-2.5 first:pt-0 last:pb-0 space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-texte-doux">
                        <span>
                          {art.publisher} · {art.publishedAt}
                          {art.isLiveWeb ? ' · En direct' : ''}
                        </span>
                        <span
                          className={`font-mono tabular-nums ${toneColor(
                            art.sentimentScore
                          )}`}
                        >
                          {art.sentimentScore >= 0 ? '+' : ''}
                          {art.sentimentScore}
                        </span>
                      </div>
                      <div className="text-xs font-medium text-texte leading-snug">
                        {(() => {
                          const safeUrl = safeExternalHttpUrl(art.url);
                          return safeUrl ? (
                            <a
                              href={safeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-succes-texte inline-flex items-baseline gap-1"
                            >
                              <span>{art.title}</span>
                              <ExternalLink className="w-3 h-3 shrink-0 self-center text-texte-doux" />
                            </a>
                          ) : (
                            art.title
                          );
                        })()}
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-bordure flex justify-end">
                <button
                  type="button"
                  onClick={() => onInspectAsset(summary.assetId)}
                  className="min-h-11 text-xs font-medium text-succes-texte hover:underline cursor-pointer"
                >
                  Ouvrir la fiche complète (DCF 3 scénarios &amp; sensibilité) →
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
