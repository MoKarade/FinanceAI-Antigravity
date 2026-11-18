import React, { useMemo, useState } from 'react';
import {
    Tab,
    type Asset,
    type ProjectionConfig,
    type ValoriaRiskProfile,
} from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { computeValoriaFutureForecast } from '../../services/projection/valoriaFutureEngine';
import {
    fetchValoriaFutureForecastBrief,
    type ValoriaFutureAiBriefResponse,
} from '../../services/valoria/valoriaAiClient';
import { formatCAD, formatPercent } from '../../utils/format';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';

export interface FutureValoriaPlacementsPanelProps {
    assets: ReadonlyArray<Asset>;
    fxRates: Record<string, number>;
    projection: ProjectionConfig;
    valoriaRiskProfile?: ValoriaRiskProfile;
    apiKey?: string;
    onUpdateProjection: (patch: Partial<ProjectionConfig>) => void;
}

export const FutureValoriaPlacementsPanel: React.FC<FutureValoriaPlacementsPanelProps> = ({
    assets,
    fxRates,
    projection,
    valoriaRiskProfile,
    apiKey = '',
    onUpdateProjection,
}) => {
    const navigateWithFocus = useFinanceStore((s) => s.navigateWithFocus);
    const horizonYears = Math.max(10, Math.round(projection.years || 30));

    const forecast = useMemo(
        () =>
            computeValoriaFutureForecast({
                assets,
                fxRates,
                riskProfile: valoriaRiskProfile,
                appliedReturnProfile: projection.appliedReturnProfile,
                horizonYears,
                cashRatePct: projection.returnRates?.cash,
            }),
        [assets, fxRates, valoriaRiskProfile, projection.appliedReturnProfile, horizonYears, projection.returnRates?.cash],
    );

    const [briefState, setBriefState] = useState<{
        sig: string;
        data: ValoriaFutureAiBriefResponse;
    } | null>(null);
    const [briefLoading, setBriefLoading] = useState(false);
    const [showHoldings, setShowHoldings] = useState(false);

    const portfolioSig = `${forecast.totalEvaluatedCad}-${forecast.portfolioConsensus100}-${horizonYears}`;
    const activeBrief = briefState && briefState.sig === portfolioSig ? briefState.data : null;
    const isAgentsActive = projection.returnAssumptionsMode === 'valoria_agents';

    const handleActivateAgents = () => {
        onUpdateProjection({
            returnAssumptionsMode: 'valoria_agents',
            returnRates: forecast.summaryRates,
            usEquityShareCeli: forecast.schedule.usShareCeliPct,
            usEquityDividendYield: forecast.schedule.usDivYieldCeliPct,
        });
    };

    const handleRunAiBrief = async () => {
        setBriefLoading(true);
        try {
            const resp = await fetchValoriaFutureForecastBrief(apiKey, {
                horizonYears,
                regimeName: forecast.regimeName,
                portfolioConsensus100: forecast.portfolioConsensus100,
                shortTermRatePct: forecast.shortTermPortfolioRatePct,
                longTermRatePct: forecast.longTermPortfolioRatePct,
                iqpfBenchmarkPct: forecast.iqpfRates.celi,
                currentValueCad: forecast.projectedPortfolioCad.today,
                projected5yP50Cad: forecast.projectedPortfolioCad.y5.p50,
                projected10yP50Cad: forecast.projectedPortfolioCad.y10.p50,
                projectedHorizonP50Cad: forecast.projectedPortfolioCad.horizon.p50,
                usShareCeliPct: forecast.schedule.usShareCeliPct,
                topHoldings: forecast.holdings.slice(0, 8).map((h) => ({
                    symbol: h.symbol,
                    envelope: h.accountType,
                    weightPct: h.weightPct,
                    agentScore100: h.agentScore100,
                    shortTermNetRatePct: h.shortTermNetRatePct,
                    longTermNetRatePct: h.longTermNetRatePct,
                })),
            });
            setBriefState({ sig: portfolioSig, data: resp });
        } finally {
            setBriefLoading(false);
        }
    };

    if (assets.length === 0 || forecast.totalEvaluatedCad <= 0) {
        return (
            <section
                aria-label="Prévisions des placements par les 7 agents Valoria"
                className="gf-terminal-card bg-surface border border-bordure p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3"
            >
                <div className="flex items-center gap-2.5 min-w-0">
                    <span className="p-2 rounded-lg bg-surface-douce text-texte border border-bordure shrink-0">
                        <Icon name="sparkles" size={16} aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                        <h3 className="text-base font-bold text-texte">
                            Placements · Prévisions des 7 Agents IA
                        </h3>
                        <p className="text-xs text-texte-secondaire">
                            Ajoute des titres dans Placements pour projeter chaque position et enveloppe fiscale.
                        </p>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => navigateWithFocus(Tab.INVESTMENTS)}
                    className="touch-target min-h-11 px-4 py-2 rounded-full border border-bordure-champ bg-surface-douce hover:bg-surface text-xs font-semibold text-texte transition-colors focus-ring inline-flex items-center gap-1.5 shrink-0"
                >
                    <Icon name="investments" size={14} aria-hidden="true" />
                    <span>Ouvrir Placements</span>
                </button>
            </section>
        );
    }

    const activeEnvelopes = forecast.envelopes.filter((e) => e.currentValueCad > 0);
    const hasCeliUsDrag = forecast.schedule.usShareCeliPct >= 5;
    const envelopeGridCols =
        activeEnvelopes.length === 1
            ? 'grid-cols-1'
            : activeEnvelopes.length === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : activeEnvelopes.length === 3
                ? 'grid-cols-1 md:grid-cols-3'
                : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

    return (
        <section
            aria-label="Prévisions des placements par les 7 agents Valoria"
            className="gf-terminal-card bg-surface border border-bordure p-4 sm:p-5 space-y-4"
        >
            {/* En-tête compact + activation + actions */}
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1 min-w-0 sm:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base sm:text-lg font-bold text-texte">
                            Placements · Prévisions 7 Agents IA
                        </h3>
                        {/* NOMBRE-NON-MONETAIRE : score consensus public 0-100 du comité d'agents */}
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-surface-douce text-texte border border-bordure whitespace-nowrap">
                            Comité {forecast.portfolioConsensus100}/100
                        </span>
                        <span className="text-xs text-texte-secondaire">
                            {forecast.regimeName}
                        </span>
                    </div>
                    <p className="text-xs text-texte-secondaire">
                        Convergence DCF + Black-Litterman + 7 Agents (ans 1–5 vers équilibre IQPF 2026) · Ledoit-Wolf &amp; sauts Merton.
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <button
                        type="button"
                        aria-pressed={isAgentsActive}
                        onClick={handleActivateAgents}
                        className={`touch-target min-h-11 px-3.5 py-2 rounded-full text-xs font-semibold transition-colors focus-ring inline-flex items-center gap-1.5 border text-left max-w-full ${
                            isAgentsActive
                                ? 'gf-chip-active border-bordure-champ'
                                : 'bg-surface-douce hover:bg-surface border-bordure-champ text-texte'
                        }`}
                    >
                        <Icon name={isAgentsActive ? 'check' : 'sparkles'} size={14} aria-hidden="true" />
                        <span>
                            {isAgentsActive
                                ? 'Actif sur la courbe Futur'
                                : 'Propulser la courbe Futur par les 7 Agents'}
                        </span>
                    </button>
                    <button
                        type="button"
                        onClick={() => navigateWithFocus(Tab.INVESTMENTS, 'tab:intelligence')}
                        className="touch-target min-h-11 px-3 py-2 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-medium text-texte transition-colors focus-ring inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                        <Icon name="globe" size={14} aria-hidden="true" />
                        <span>Conseiller</span>
                    </button>
                </div>
            </div>

            {/* 4 cartes d'horizons P10–P50–P90 (toujours 4 tuiles = 100 % de largeur) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-card bg-surface-douce border border-bordure p-3 space-y-0.5 min-w-0">
                    <div className="text-[11px] font-medium text-texte-secondaire">Capital investi actuel</div>
                    <div className="text-lg font-mono font-bold text-texte">
                        <PrivateAmount>{formatCAD(forecast.projectedPortfolioCad.today)}</PrivateAmount>
                    </div>
                    <div className="text-[11px] text-texte-secondaire truncate">
                        {/* NOMBRE-NON-MONETAIRE : nombre de lignes en portefeuille */}
                        {forecast.holdings.length} position{forecast.holdings.length > 1 ? 's' : ''} évaluée{forecast.holdings.length > 1 ? 's' : ''}
                    </div>
                </div>

                <div className="rounded-card bg-surface-douce border border-bordure p-3 space-y-0.5 min-w-0">
                    {/* NOMBRE-NON-MONETAIRE : libellé horizon fixe 5 ans */}
                    <div className="text-[11px] font-medium text-texte-secondaire">Médiane à 5 ans (P50)</div>
                    <div className="text-lg font-mono font-bold text-texte">
                        <PrivateAmount>{formatCAD(forecast.projectedPortfolioCad.y5.p50)}</PrivateAmount>
                    </div>
                    <div className="text-[11px] text-texte-secondaire truncate">
                        P10–P90 :{' '}
                        <PrivateAmount>
                            {formatCAD(forecast.projectedPortfolioCad.y5.p10)} – {formatCAD(forecast.projectedPortfolioCad.y5.p90)}
                        </PrivateAmount>
                    </div>
                </div>

                <div className="rounded-card bg-surface-douce border border-bordure p-3 space-y-0.5 min-w-0">
                    {/* NOMBRE-NON-MONETAIRE : libellé horizon fixe 10 ans */}
                    <div className="text-[11px] font-medium text-texte-secondaire">Médiane à 10 ans (P50)</div>
                    <div className="text-lg font-mono font-bold text-texte">
                        <PrivateAmount>{formatCAD(forecast.projectedPortfolioCad.y10.p50)}</PrivateAmount>
                    </div>
                    <div className="text-[11px] text-texte-secondaire truncate">
                        P10–P90 :{' '}
                        <PrivateAmount>
                            {formatCAD(forecast.projectedPortfolioCad.y10.p10)} – {formatCAD(forecast.projectedPortfolioCad.y10.p90)}
                        </PrivateAmount>
                    </div>
                </div>

                <div className="rounded-card bg-surface-douce border border-bordure p-3 space-y-0.5 min-w-0">
                    {/* NOMBRE-NON-MONETAIRE : durée d'horizon en années */}
                    <div className="text-[11px] font-medium text-texte-secondaire">
                        Horizon {forecast.projectedPortfolioCad.horizon.years} ans (P50)
                    </div>
                    <div className="text-lg font-mono font-bold text-texte">
                        <PrivateAmount>{formatCAD(forecast.projectedPortfolioCad.horizon.p50)}</PrivateAmount>
                    </div>
                    <div className="text-[11px] text-texte-secondaire truncate">
                        Net :{' '}
                        <PrivateAmount>
                            {formatPercent(forecast.shortTermPortfolioRatePct / 100, 1)} → {formatPercent(forecast.longTermPortfolioRatePct / 100, 1)}
                        </PrivateAmount>
                    </div>
                </div>
            </div>

            {/* Grille adaptative des enveloppes actives (jamais de colonne vide) */}
            {activeEnvelopes.length > 0 && (
                <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-texte-secondaire">
                        {/* NOMBRE-NON-MONETAIRE : paramètre alpha de shrinkage Ledoit-Wolf */}
                        <span>Enveloppes actives (Ledoit-Wolf α={forecast.shrinkageAlpha.toFixed(2)})</span>
                        {hasCeliUsDrag && (
                            <span>
                                Retenue US 15 % intégrée sur{' '}
                                <PrivateAmount>{Math.round(forecast.schedule.usShareCeliPct)} %</PrivateAmount> du CELI
                            </span>
                        )}
                    </div>
                    <div className={`grid ${envelopeGridCols} gap-2.5`}>
                        {activeEnvelopes.map((env) => (
                            <div
                                key={env.envelope}
                                className="rounded-card border border-bordure bg-surface-douce/50 px-3 py-2.5 space-y-1 min-w-0"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-bold text-texte truncate">{env.label}</span>
                                    <span className="text-[11px] font-mono text-texte-secondaire shrink-0">
                                        σ <PrivateAmount>{formatPercent(env.annualVolatilityPct / 100, 1)}</PrivateAmount>
                                    </span>
                                </div>
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="text-sm font-mono font-semibold text-texte">
                                        <PrivateAmount>{formatCAD(env.currentValueCad)}</PrivateAmount>
                                    </span>
                                    {/* NOMBRE-NON-MONETAIRE : échéance fixe 10 ans */}
                                    <span className="text-[11px] font-mono text-texte-secondaire">
                                        10a : <PrivateAmount>{formatCAD(env.projected10yMedianCad)}</PrivateAmount>
                                    </span>
                                </div>
                                <div className="text-[11px] text-texte-secondaire flex items-center justify-between gap-2">
                                    {/* NOMBRE-NON-MONETAIRE : fenêtre fixe ans 1-5 vs an 6+ */}
                                    <span>Ans 1–5 → 6+</span>
                                    <span className="font-mono text-texte">
                                        <PrivateAmount>
                                            {formatPercent(env.shortTermRatePct / 100, 1)} → {formatPercent(env.longTermRatePct / 100, 1)}
                                        </PrivateAmount>
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Lecture du comité + Synthèse Gemini IA + bascule compacte du détail par titre */}
            <div className="rounded-card bg-surface-douce border border-bordure p-3.5 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-texte">
                        <Icon name="shield" size={14} aria-hidden="true" />
                        <span>Lecture stratégique du comité d’agents</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            aria-expanded={showHoldings}
                            onClick={() => setShowHoldings((v) => !v)}
                            className="touch-target min-h-11 px-3 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-medium text-texte transition-colors focus-ring inline-flex items-center gap-1.5"
                        >
                            <Icon name="investments" size={14} aria-hidden="true" />
                            <span>
                                {/* NOMBRE-NON-MONETAIRE : nombre de titres dans le portefeuille */}
                                {showHoldings
                                    ? 'Masquer le détail par titre'
                                    : `Détail par titre · Rayon-X (${forecast.holdings.length})`}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={handleRunAiBrief}
                            disabled={briefLoading}
                            className="touch-target min-h-11 px-3.5 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-semibold text-texte transition-colors focus-ring inline-flex items-center gap-1.5 disabled:opacity-60"
                        >
                            <Icon name="sparkles" size={14} aria-hidden="true" />
                            <span>{briefLoading ? 'Analyse Gemini en cours…' : 'Synthèse Gemini IA'}</span>
                        </button>
                    </div>
                </div>

                <p className="text-xs text-texte leading-relaxed">
                    <PrivateAmount>{forecast.deterministicReadingFr}</PrivateAmount>
                </p>

                {activeBrief && (
                    <div className="pt-2 border-t border-bordure space-y-1.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-texte">
                                <PrivateAmount>{activeBrief.headlineFr}</PrivateAmount>
                            </span>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-surface border border-bordure text-texte-secondaire shrink-0">
                                {activeBrief.source === 'gemini' ? 'Gemini IA Live' : 'Synthèse Quant'}
                            </span>
                        </div>
                        <p className="text-texte-secondaire leading-relaxed">
                            <PrivateAmount>{activeBrief.trajectoryAnalysisFr}</PrivateAmount>
                        </p>
                        <p className="text-texte-secondaire leading-relaxed">
                            <strong className="text-texte">Enveloppes :</strong>{' '}
                            <PrivateAmount>{activeBrief.envelopeActionFr}</PrivateAmount>
                        </p>
                        <p className="text-texte-secondaire leading-relaxed">
                            <strong className="text-texte">Risques Merton / Quant :</strong>{' '}
                            <PrivateAmount>{activeBrief.riskWatchFr}</PrivateAmount>
                        </p>
                    </div>
                )}

                {showHoldings && (
                    <div className="pt-2 border-t border-bordure overflow-x-auto">
                        <table className="w-full text-left text-xs">
                            <thead className="bg-surface text-texte-secondaire border-b border-bordure">
                                <tr>
                                    <th scope="col" className="py-2 px-2.5 font-semibold">Titre</th>
                                    <th scope="col" className="py-2 px-2.5 font-semibold">Valeur</th>
                                    <th scope="col" className="py-2 px-2.5 font-semibold">7 Agents</th>
                                    {/* NOMBRE-NON-MONETAIRE : fenêtre fixe ans 1-5 vs an 6+ */}
                                    <th scope="col" className="py-2 px-2.5 font-semibold">Ans 1–5 → 6+</th>
                                    {/* NOMBRE-NON-MONETAIRE : échéance fixe 10 ans */}
                                    <th scope="col" className="py-2 px-2.5 font-semibold">Médiane 10 ans</th>
                                    <th scope="col" className="py-2 px-2.5 font-semibold">Cible</th>
                                    <th scope="col" className="py-2 px-2.5 font-semibold text-right">Rayon-X</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-bordure bg-surface">
                                {forecast.holdings.slice(0, 8).map((h) => (
                                    <tr key={`${h.symbol}-${h.accountType}`} className="hover:bg-surface-douce/60">
                                        <td className="py-2 px-2.5">
                                            <div className="font-bold text-texte whitespace-nowrap">{h.symbol}</div>
                                            <div className="text-[11px] text-texte-secondaire whitespace-nowrap">
                                                {h.accountType} · <PrivateAmount>{formatPercent(h.weightPct / 100, 1)}</PrivateAmount>
                                            </div>
                                        </td>
                                        <td className="py-2 px-2.5 font-mono text-texte whitespace-nowrap">
                                            <PrivateAmount>{formatCAD(h.currentValueCad)}</PrivateAmount>
                                        </td>
                                        <td className="py-2 px-2.5 whitespace-nowrap">
                                            {/* NOMBRE-NON-MONETAIRE : score consensus public 0-100 et nombre de votes */}
                                            <span className="font-mono font-semibold text-texte">
                                                {h.verdictArrow} {h.agentScore100}/100
                                            </span>
                                            {/* NOMBRE-NON-MONETAIRE : décompte de votes sur 7 */}
                                            <div className="text-[11px] text-texte-secondaire">
                                                {h.buyVotes} pour · {h.neutralVotes} neutre · {h.sellVotes} prudence
                                            </div>
                                        </td>
                                        <td className="py-2 px-2.5 font-mono text-texte whitespace-nowrap">
                                            <PrivateAmount>
                                                {formatPercent(h.shortTermNetRatePct / 100, 1)} → {formatPercent(h.longTermNetRatePct / 100, 1)}
                                            </PrivateAmount>
                                        </td>
                                        <td className="py-2 px-2.5 font-mono font-semibold text-texte whitespace-nowrap">
                                            <PrivateAmount>{formatCAD(h.projected10yCad.p50)}</PrivateAmount>
                                        </td>
                                        <td className="py-2 px-2.5 text-texte-secondaire whitespace-nowrap">{h.optimalWrapper}</td>
                                        <td className="py-2 px-2.5 text-right whitespace-nowrap">
                                            <button
                                                type="button"
                                                onClick={() => navigateWithFocus(Tab.INVESTMENTS, `asset:${h.symbol}`)}
                                                aria-label={`Explorer ${h.symbol} dans le Rayon-X Placements`}
                                                className="touch-target min-h-11 px-3 py-1.5 rounded-full border border-bordure-champ bg-surface-douce hover:bg-surface text-xs font-medium text-texte transition-colors focus-ring inline-flex items-center gap-1"
                                            >
                                                <span>Rayon-X</span>
                                                <Icon name="arrow-up" size={12} className="rotate-45" aria-hidden="true" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </section>
    );
};
