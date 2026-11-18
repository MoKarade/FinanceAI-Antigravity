import React, { useEffect, useMemo, useRef, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { motion } from 'framer-motion';
import { ArrowRight, Check, RefreshCw, Send } from 'lucide-react';
import {
  ASSETS,
  MacroIndicators,
  RiskProfile,
  getAssetById,
} from '../../services/valoria/marketData';
import { PortfolioLot } from '../../services/valoria/engine';
import {
  AnalystTradeRecommendation,
  ProAnalystAdvisoryReport,
} from '../../services/valoria/proAnalystAdvisor';
import { MultiAssetUniverseSummary } from '../../services/valoria/multiAssetQuantEngine';
import {
  AgentConsultationResponse,
  AssetProbableFuture,
  buildConsultationTurnResponse,
} from '../../services/valoria/agentAdvisorChatEngine';
import { PriceTargetRangeBar } from './VisualPrimitives';
import { PrivateAmount } from '../ui/PrivateAmount';
import {
  formatCompactEur,
  formatEur,
  formatPriceCad,
  formatSignedEur,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';
import { fetchValoriaAgentChat } from '../../services/valoria/valoriaAiClient';

interface ChatTurnItem {
  id: string;
  role: 'user' | 'assistant';
  userQuestion?: string;
  response?: AgentConsultationResponse;
  isLiveGeminiEnriched?: boolean;
  isEnriching?: boolean;
}

interface AgentConsultationChatViewProps {
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
  advisory: ProAnalystAdvisoryReport;
  universe: MultiAssetUniverseSummary;
  geminiApiKey?: string;
  initialFocusAssetId?: string | null;
  onInspectAsset: (assetId: string) => void;
  onExecuteSingleOrder: (assetId: string, deltaCad: number) => void;
  onApplyFullAdvisoryPlan: (
    sells: AnalystTradeRecommendation[],
    buys: AnalystTradeRecommendation[]
  ) => void;
}

const SIM_AMOUNTS_CAD = [2500, 5000, 10000];

const ProbableFutureConeSvg: React.FC<{ future: AssetProbableFuture }> = ({
  future,
}) => {
  const width = 420;
  const height = 176;
  const padLeft = 48;
  const padRight = 56;
  const padTop = 18;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const pts = future.horizonPoints;
  const allVals = [
    ...pts.flatMap((p) => [
      p.p10PessimisticCad,
      p.p50ProbableCad,
      p.p90OptimisticCad,
    ]),
    future.fairValueCad,
  ].filter((v) => Number.isFinite(v) && v > 0);

  const minVal = Math.min(...allVals) * 0.92;
  const maxVal = Math.max(...allVals) * 1.06;
  const span = Math.max(0.01, maxVal - minVal);

  const xAt = (idx: number) =>
    padLeft + (idx / Math.max(1, pts.length - 1)) * plotW;
  const yAt = (val: number) =>
    padTop + (1 - (val - minVal) / span) * plotH;

  const p90Coords = pts.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.p90OptimisticCad).toFixed(1)}`);
  const p10CoordsRev = [...pts]
    .reverse()
    .map((p, revIdx) => {
      const origIdx = pts.length - 1 - revIdx;
      return `${xAt(origIdx).toFixed(1)},${yAt(p.p10PessimisticCad).toFixed(1)}`;
    });
  const fanPolygon = [...p90Coords, ...p10CoordsRev].join(' ');
  const p50Polyline = pts
    .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.p50ProbableCad).toFixed(1)}`)
    .join(' ');
  const p90Polyline = p90Coords.join(' ');
  const p10Polyline = pts
    .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.p10PessimisticCad).toFixed(1)}`)
    .join(' ');

  const strokeColor =
    future.verdictTone === 'rose'
      ? VALORIA_PALETTE.rose
      : future.verdictTone === 'emerald'
        ? VALORIA_PALETTE.emerald
        : VALORIA_PALETTE.lineZinc;

  const fairY = yAt(future.fairValueCad);
  const lastPt = pts[pts.length - 1];

  const fmtAxis = (v: number) =>
    v >= 1000 ? formatCompactEur(v) : formatPriceCad(v);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto overflow-visible select-none"
      role="img"
      aria-label={`Projection probable sur 5 ans pour ${future.ticker} en dollars canadiens`}
    >
      {/* Subtle horizontal grid */}
      {[0, 0.5, 1].map((frac) => {
        const y = padTop + frac * plotH;
        const val = maxVal - frac * span;
        return (
          <g key={frac}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              stroke={VALORIA_PALETTE.gridZinc}
              strokeWidth="1"
            />
            <text
              x={padLeft - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-texte-doux font-mono text-[9px]"
            >
              {fmtAxis(val)}
            </text>
          </g>
        );
      })}

      {/* DCF Fair Value reference line */}
      {fairY >= padTop && fairY <= padTop + plotH && (
        <g>
          <line
            x1={padLeft}
            y1={fairY}
            x2={width - padRight}
            y2={fairY}
            stroke={VALORIA_PALETTE.mutedZinc}
            strokeWidth="1"
            strokeDasharray="3 3"
          />
          <text
            x={padLeft + 4}
            y={Math.max(padTop + 9, fairY - 4)}
            className="fill-texte-doux font-mono text-[8.5px]"
          >
            Vraie valeur {fmtAxis(future.fairValueCad)}
          </text>
        </g>
      )}

      {/* P10-P90 Fan */}
      <polygon points={fanPolygon} fill={strokeColor} fillOpacity="0.14" />
      <polyline
        points={p90Polyline}
        fill="none"
        stroke={strokeColor}
        strokeOpacity="0.45"
        strokeWidth="1"
        strokeDasharray="2 2"
      />
      <polyline
        points={p10Polyline}
        fill="none"
        stroke={VALORIA_PALETTE.mutedZinc}
        strokeOpacity="0.6"
        strokeWidth="1"
        strokeDasharray="2 2"
      />

      {/* Central Probable Trajectory (P50) */}
      <polyline
        points={p50Polyline}
        fill="none"
        stroke={strokeColor}
        strokeWidth="2.4"
      />

      {/* Start & End Anchors */}
      <circle
        cx={xAt(0)}
        cy={yAt(future.spotPriceCad)}
        r="3.5"
        fill={VALORIA_PALETTE.textWhiteSoft}
      />
      <circle
        cx={xAt(pts.length - 1)}
        cy={yAt(lastPt.p50ProbableCad)}
        r="4"
        fill={strokeColor}
      />

      {/* Right-hand 2031 Quantile Readouts */}
      <text
        x={width - padRight + 6}
        y={Math.max(padTop + 8, yAt(lastPt.p90OptimisticCad) + 3)}
        className="fill-succes-texte font-mono text-[9px]"
      >
        P90 {fmtAxis(lastPt.p90OptimisticCad)}
      </text>
      <text
        x={width - padRight + 6}
        y={yAt(lastPt.p50ProbableCad) + 3}
        className="fill-texte font-mono font-semibold text-[9.5px]"
      >
        P50 {fmtAxis(lastPt.p50ProbableCad)}
      </text>
      <text
        x={width - padRight + 6}
        y={Math.min(padTop + plotH + 4, yAt(lastPt.p10PessimisticCad) + 3)}
        className="fill-erreur-texte font-mono text-[9px]"
      >
        P10 {fmtAxis(lastPt.p10PessimisticCad)}
      </text>

      {/* X-Axis Labels */}
      {pts.map((p, i) => (
        <text
          key={p.yearLabel}
          x={xAt(i)}
          y={height - 6}
          textAnchor="middle"
          className="fill-texte-doux font-mono text-[9px]"
        >
          {p.yearLabel}
        </text>
      ))}
    </svg>
  );
};

export const AgentConsultationChatView: React.FC<
  AgentConsultationChatViewProps
> = ({
  lots,
  livePrices,
  macro,
  riskProfile,
  advisory,
  universe,
  geminiApiKey = '',
  initialFocusAssetId = null,
  onInspectAsset,
  onExecuteSingleOrder,
  onApplyFullAdvisoryPlan,
}) => {
  const defaultFocusId =
    initialFocusAssetId ??
    advisory.buyRecommendations[0]?.assetId ??
    advisory.sellRecommendations[0]?.assetId ??
    advisory.heldLines[0]?.assetId ??
    'GOOGL';

  const [selectedAssetId, setSelectedAssetId] = useState<string>(defaultFocusId);
  const [simSide, setSimSide] = useState<'BUY' | 'SELL'>('BUY');
  const [simAmountCad, setSimAmountCad] = useState<number>(5000);
  const [questionInput, setQuestionInput] = useState<string>('');
  const [appliedBanner, setAppliedBanner] = useState<string | null>(null);
  const [showCustomSimulator, setShowCustomSimulator] = useState<boolean>(false);
  const lastHandledInitialAssetRef = useRef<string | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);

  // Build deterministic initial welcome turn grounded in the user's real portfolio
  const initialWelcomeResponse = useMemo(
    () =>
      buildConsultationTurnResponse({
        question:
          'Fais le point entre ce que j’ai en portefeuille, ce que je dois vendre ou garder, et quel serait un bon investissement.',
        explicitFocusAssetId: defaultFocusId,
        lots,
        livePrices,
        macro,
        riskProfile,
        advisory,
        universe,
      }),
    [defaultFocusId, lots, livePrices, macro, riskProfile, advisory, universe]
  );

  const [turns, setTurns] = useState<ChatTurnItem[]>(() => [
    {
      id: 'welcome-turn',
      role: 'assistant',
      response: initialWelcomeResponse,
      isLiveGeminiEnriched: false,
      isEnriching: false,
    },
  ]);

  // Keep welcome turn fresh if portfolio lots/profile changed and user hasn't chatted yet
  useEffect(() => {
    setTurns((prev) => {
      if (prev.length === 1 && prev[0].id === 'welcome-turn') {
        return [
          {
            ...prev[0],
            response: initialWelcomeResponse,
          },
        ];
      }
      return prev;
    });
  }, [initialWelcomeResponse]);

  useEffect(() => {
    if (turns.length > 1 && threadScrollRef.current) {
      threadScrollRef.current.scrollTo({
        top: threadScrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [turns.length]);

  const submitConsultationQuestion = async (opts: {
    questionText: string;
    focusOverrideId?: string;
    sideOverride?: 'BUY' | 'SELL' | 'FULL_PLAN';
    amountOverrideCad?: number;
  }) => {
    const cleanQ = opts.questionText.trim();
    if (!cleanQ) return;

    const targetId = opts.focusOverrideId ?? selectedAssetId;
    const deterministicResp = buildConsultationTurnResponse({
      question: cleanQ,
      explicitFocusAssetId: targetId,
      explicitActionSide: opts.sideOverride,
      explicitAmountCad: opts.amountOverrideCad,
      lots,
      livePrices,
      macro,
      riskProfile,
      advisory,
      universe,
    });

    setSelectedAssetId(deterministicResp.focusAssetId);
    if (deterministicResp.impactSimulation.actionType === 'SELL') {
      setSimSide('SELL');
    } else if (deterministicResp.impactSimulation.actionType === 'BUY') {
      setSimSide('BUY');
    }

    const userTurnId = `u-${Date.now()}`;
    const assistantTurnId = `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const historyForApi = turns
      .slice(-6)
      .map((t) => ({
        role: t.role,
        text:
          t.role === 'user'
            ? t.userQuestion ?? ''
            : t.response?.plainFrenchAnswer ?? '',
      }))
      .filter((m) => m.text.length > 0);

    setTurns((prev) => [
      ...prev,
      {
        id: userTurnId,
        role: 'user',
        userQuestion: cleanQ,
      },
      {
        id: assistantTurnId,
        role: 'assistant',
        response: deterministicResp,
        isLiveGeminiEnriched: false,
        isEnriching: true,
      },
    ]);

    try {
      const data = await fetchValoriaAgentChat(geminiApiKey, {
        question: cleanQ,
        history: historyForApi,
        verifiedGroundingContext: deterministicResp.verifiedGroundingContext,
      });

      if (data.ok && data.plainFrenchAnswer) {
        setTurns((prev) =>
          prev.map((t) => {
            if (t.id !== assistantTurnId || !t.response) return t;
            const mergedVoices =
              Array.isArray(data.agentVoices) && data.agentVoices.length > 0
                ? data.agentVoices.slice(0, 3).map((v, idx) => {
                    const baseVoice = t.response!.agentVoices[idx];
                    const cleanV = v.verdict.toUpperCase();
                    const safeVerdict: 'ACHETER' | 'GARDER' | 'ÉVITER' =
                      cleanV.includes('ACHET')
                        ? 'ACHETER'
                        : cleanV.includes('ÉVIT') || cleanV.includes('VEND')
                          ? 'ÉVITER'
                          : 'GARDER';
                    return {
                      code: v.code || baseVoice?.code || `AG-0${idx + 1}`,
                      shortTitle:
                        v.shortTitle || baseVoice?.shortTitle || 'Agent Spécialisé',
                      verdict: baseVoice?.verdict ?? safeVerdict,
                      score100: baseVoice?.score100 ?? 72,
                      keyMetric: baseVoice?.keyMetric ?? 'Données vérifiées $ CAD',
                      message: v.message || baseVoice?.message || '',
                    };
                  })
                : t.response.agentVoices;

            return {
              ...t,
              isLiveGeminiEnriched:
                data.source === 'gemini_live_committee' || data.source === 'gemini',
              isEnriching: false,
              response: {
                ...t.response,
                headlineVerdict:
                  data.headlineVerdict && data.headlineVerdict.length > 8
                    ? data.headlineVerdict
                    : t.response.headlineVerdict,
                plainFrenchAnswer:
                  data.plainFrenchAnswer ?? t.response.plainFrenchAnswer,
                agentVoices: mergedVoices,
                followUpPrompts:
                  Array.isArray(data.followUpPrompts) &&
                  data.followUpPrompts.length >= 2
                    ? data.followUpPrompts.slice(0, 3)
                    : t.response.followUpPrompts,
              },
            };
          })
        );
        return;
      }
    } catch {
      // Deterministic 7-Agent CoT response remains active seamlessly
    }

    setTurns((prev) =>
      prev.map((t) =>
        t.id === assistantTurnId ? { ...t, isEnriching: false } : t
      )
    );
  };

  // Auto-focus when user jumps from another tab with initialFocusAssetId
  useEffect(() => {
    if (
      initialFocusAssetId &&
      initialFocusAssetId !== lastHandledInitialAssetRef.current &&
      getAssetById(initialFocusAssetId)
    ) {
      lastHandledInitialAssetRef.current = initialFocusAssetId;
      const asset = getAssetById(initialFocusAssetId)!;
      const isHeld = advisory.heldLines.some(
        (h) => h.assetId === initialFocusAssetId
      );
      setSelectedAssetId(initialFocusAssetId);
      void submitConsultationQuestion({
        questionText: isHeld
          ? `Dois-je vendre, alléger ou garder ma position sur ${asset.ticker}, qu’est-ce que ça engendre et quel est son avenir probable ?`
          : `Est-ce que ${asset.ticker} est un bon investissement, qu’est-ce qu’un achat de ${formatEur(simAmountCad, 0)} engendre et quel est son avenir probable ?`,
        focusOverrideId: initialFocusAssetId,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocusAssetId]);

  // Live right-hand visual simulator synchronized with selectedAssetId + simSide + simAmountCad
  const liveVisualContext = useMemo(
    () =>
      buildConsultationTurnResponse({
        question:
          simSide === 'SELL'
            ? `Qu'est-ce que ça engendre si je vends ${selectedAssetId} ?`
            : `Qu'est-ce que ça engendre si j'investis ${formatEur(simAmountCad, 0)} sur ${selectedAssetId} ?`,
        explicitFocusAssetId: selectedAssetId,
        explicitActionSide: simSide,
        explicitAmountCad: simAmountCad,
        lots,
        livePrices,
        macro,
        riskProfile,
        advisory,
        universe,
      }),
    [
      selectedAssetId,
      simSide,
      simAmountCad,
      lots,
      livePrices,
      macro,
      riskProfile,
      advisory,
      universe,
    ]
  );

  const selectedAsset = getAssetById(selectedAssetId) ?? ASSETS[0];
  const isSelectedHeld = advisory.heldLines.some(
    (h) => h.assetId === selectedAssetId
  );

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!questionInput.trim()) return;
    const q = questionInput;
    setQuestionInput('');
    void submitConsultationQuestion({ questionText: q });
  };

  const imp = liveVisualContext.impactSimulation;
  const fut = liveVisualContext.assetFuture;

  return (
    <div className="space-y-5">
      {appliedBanner && (
        <div
          role="status"
          className="px-4 py-2.5 bg-succes-fond border border-succes-texte/40 rounded-xl flex items-center justify-between gap-3 text-xs font-mono text-succes-texte"
        >
          <span className="inline-flex items-center gap-2">
            <Check className="w-4 h-4 text-succes-texte shrink-0" />
            {appliedBanner}
          </span>
          <button
            type="button"
            onClick={() => setAppliedBanner(null)}
            className="min-h-11 text-texte-doux hover:text-texte cursor-pointer"
          >
            Fermer
          </button>
        </div>
      )}

      {/* Unboxed Editorial Header + Calm Asset Selector */}
      <section className="pb-5 border-b border-bordure space-y-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-texte">
              Dialogue avec les 7 Agents &amp; Simulateur ($ CAD)
            </h1>
            <p className="text-xs text-texte-doux mt-1">
              Sélectionnez une position actuelle, une idée recommandée ou posez votre question en français simple.
            </p>
          </div>
          <div className="text-xs font-mono tabular-nums text-texte-doux">
            <span className="text-succes-texte">✓ Cours vérifiés</span>
            <span aria-hidden="true"> · </span>
            <span>Raisonnement 5 étapes</span>
          </div>
        </div>

        {/* Clear Separation: Left = Ce que j'ai | Right = Ce qui est recommandé */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Group A: Mes positions actuelles */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs text-texte-doux">
              <span className="font-medium text-texte">
                Mes positions actuelles
              </span>
              <span className="font-mono tabular-nums">{advisory.heldLines.length} lignes</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {advisory.heldLines.length === 0 ? (
                <span className="text-xs text-texte-doux">
                  Aucune position détenue actuellement.
                </span>
              ) : (
                advisory.heldLines.map((h) => {
                  const isActive = selectedAssetId === h.assetId;
                  const needsSell =
                    h.verdict === 'VENDRE' || h.verdict === 'ALLÉGER';
                  return (
                    <button
                      key={`held-chip-${h.assetId}`}
                      type="button"
                      onClick={() => {
                        setSelectedAssetId(h.assetId);
                        setSimSide(needsSell ? 'SELL' : 'BUY');
                        void submitConsultationQuestion({
                          questionText: needsSell
                            ? `Pourquoi ${h.verdict.toLowerCase()} ma ligne ${h.ticker} (${formatEur(h.currentValueCad, 0)}) et qu’est-ce que ça engendre ?`
                            : `Dois-je garder ou renforcer ma ligne ${h.ticker} (${formatEur(h.currentValueCad, 0)}) et quel est son avenir probable ?`,
                          focusOverrideId: h.assetId,
                          sideOverride: needsSell ? 'SELL' : 'BUY',
                        });
                      }}
                      className={`min-w-11 min-h-11 px-2.5 py-1.5 rounded-lg text-xs font-mono tabular-nums transition-colors whitespace-nowrap cursor-pointer border ${
                        isActive
                          ? 'bg-accent text-sur-accent border-accent font-semibold'
                          : needsSell
                            ? 'bg-surface/40 text-erreur-texte border-bordure hover:border-erreur-texte/50'
                            : 'bg-surface/40 text-texte border-bordure hover:border-bordure-champ'
                      }`}
                    >
                      {needsSell ? '▼ ' : '● '}
                      {h.ticker} · {formatCompactEur(h.currentValueCad)}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Group B: Idées recommandées */}
          <div className="space-y-2.5 pt-3 lg:pt-0 border-t lg:border-t-0 lg:pl-6 lg:border-l border-bordure">
            <div className="flex items-center justify-between text-xs text-texte-doux">
              <span className="font-medium text-succes-texte">
                Idées recommandées à étudier
              </span>
              <span className="font-mono tabular-nums">Score 5/5</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {liveVisualContext.topBuyIdeas.map((b) => {
                const isActive = selectedAssetId === b.assetId;
                return (
                  <button
                    key={`rec-chip-${b.assetId}`}
                    type="button"
                    onClick={() => {
                      setSelectedAssetId(b.assetId);
                      setSimSide('BUY');
                      setSimAmountCad(b.suggestedTicketCad);
                      void submitConsultationQuestion({
                        questionText: `Pourquoi ${b.ticker} est recommandé à l’achat, qu’est-ce qu’un investissement de ${formatEur(b.suggestedTicketCad, 0)} engendre et quel est son avenir probable ?`,
                        focusOverrideId: b.assetId,
                        sideOverride: 'BUY',
                        amountOverrideCad: b.suggestedTicketCad,
                      });
                    }}
                    className={`min-w-11 min-h-11 px-2.5 py-1.5 rounded-lg text-xs font-mono tabular-nums transition-colors whitespace-nowrap cursor-pointer border ${
                      isActive
                        ? 'bg-accent text-sur-accent border-succes-texte font-semibold'
                        : 'bg-fond text-succes-texte border-bordure hover:border-succes-texte/60'
                    }`}
                  >
                    ▲ {b.ticker} · {formatEur(b.spotPriceCad, 0)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* 4 Core One-Click Questions + Clean Collapsible Custom Simulator */}
        <div className="pt-3 border-t border-bordure flex flex-col sm:flex-row sm:flex-wrap sm:items-center justify-between gap-2">
          <div className="flex sm:flex-wrap items-center gap-2 overflow-x-auto no-scrollbar max-w-full pb-0.5 sm:pb-0">
            <button
              type="button"
              onClick={() =>
                void submitConsultationQuestion({
                  questionText:
                    'Quel serait un bon investissement vérifié en ce moment et pourquoi ?',
                })
              }
              className="min-h-11 px-3 py-1.5 text-xs font-medium bg-fond hover:bg-surface-douce text-texte border border-bordure rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Quel bon investissement ?
            </button>
            <button
              type="button"
              onClick={() =>
                void submitConsultationQuestion({
                  questionText:
                    simSide === 'SELL'
                      ? `Qu’est-ce que ça engendre sur mon portefeuille si je vends ${selectedAsset.ticker} ?`
                      : `Qu’est-ce que ça engendre sur mon portefeuille si j’investis ${formatEur(simAmountCad, 0)} sur ${selectedAsset.ticker} ?`,
                  focusOverrideId: selectedAssetId,
                  sideOverride: simSide,
                  amountOverrideCad: simAmountCad,
                })
              }
              className="min-h-11 px-3 py-1.5 text-xs font-medium bg-fond hover:bg-surface-douce text-texte border border-bordure rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Qu’est-ce que ça engendre ({selectedAsset.ticker}) ?
            </button>
            <button
              type="button"
              onClick={() =>
                void submitConsultationQuestion({
                  questionText:
                    'Dans ce que j’ai actuellement, que dois-je vendre, alléger ou garder ?',
                  sideOverride: 'FULL_PLAN',
                })
              }
              className="min-h-11 px-3 py-1.5 text-xs font-medium bg-fond hover:bg-surface-douce text-texte border border-bordure rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Que vendre ou garder ?
            </button>
            <button
              type="button"
              onClick={() =>
                void submitConsultationQuestion({
                  questionText: `Quel est l’avenir probable de ${selectedAsset.ticker} sur 1 an et d’ici 2031 ?`,
                  focusOverrideId: selectedAssetId,
                })
              }
              className="min-h-11 px-3 py-1.5 text-xs font-medium bg-fond hover:bg-surface-douce text-texte border border-bordure rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Avenir probable de {selectedAsset.ticker} ?
            </button>
          </div>

          <button
            type="button"
            aria-expanded={showCustomSimulator}
            onClick={() => setShowCustomSimulator((v) => !v)}
            className="min-h-11 px-3 py-1.5 text-xs font-mono text-texte hover:text-texte bg-fond border border-bordure rounded-lg transition-colors whitespace-nowrap cursor-pointer self-start sm:self-auto"
          >
            {showCustomSimulator ? 'Fermer simulateur' : 'Autre actif / montant'}
          </button>
        </div>

        {showCustomSimulator && (
          <div className="pt-3 border-t border-bordure flex flex-wrap items-center gap-2">
            <label htmlFor="chat-asset-picker" className="text-xs text-texte-doux">
              Actif ({ASSETS.length}) :
            </label>
            <select
              id="chat-asset-picker"
              value={selectedAssetId}
              onChange={(e) => {
                setSelectedAssetId(e.target.value);
                setSimSide('BUY');
              }}
              className="min-h-11 bg-fond border border-bordure rounded-lg px-2.5 py-1.5 text-base sm:text-xs font-mono text-texte max-w-full sm:max-w-[240px]"
            >
              {ASSETS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.ticker} — {a.name}
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-center gap-1.5">
              {SIM_AMOUNTS_CAD.map((amt) => (
                <button aria-pressed={Boolean(simSide === 'BUY' && simAmountCad === amt)}
                  key={amt}
                  type="button"
                  onClick={() => {
                    setSimSide('BUY');
                    setSimAmountCad(amt);
                  }}
                  className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-mono tabular-nums rounded-lg border transition-colors cursor-pointer ${
                    simSide === 'BUY' && simAmountCad === amt
                      ? 'bg-succes-texte text-sur-accent border-succes-texte font-semibold'
                      : 'bg-fond text-texte border-bordure hover:border-bordure-champ'
                  }`}
                >
                  +{formatEur(amt, 0)}
                </button>
              ))}
              {isSelectedHeld && (
                <button aria-pressed={Boolean(simSide === 'SELL')}
                  type="button"
                  onClick={() => setSimSide('SELL')}
                  className={`min-w-11 min-h-11 px-2.5 py-1 text-xs font-mono rounded-lg border transition-colors cursor-pointer ${
                    simSide === 'SELL'
                      ? 'bg-erreur-texte text-sur-accent border-erreur-texte font-semibold'
                      : 'bg-fond text-erreur-texte border-bordure hover:border-erreur-texte/60'
                  }`}
                >
                  Simuler Vendre
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Main 2-Column Workspace: Left = Conversation | Right = Visual Impact & Future Cone */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 items-start">
        {/* LEFT (7 cols): Interactive Agent & AI Thread + Composer */}
        <section className="lg:col-span-7 bg-surface/25 border border-bordure rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-bordure">
            <h2 className="text-sm font-semibold text-texte">
              Fil de conseil — Comité des 7 Agents
            </h2>
            {turns.length > 1 && (
              <button
                type="button"
                onClick={() =>
                  setTurns([
                    {
                      id: 'welcome-turn',
                      role: 'assistant',
                      response: initialWelcomeResponse,
                    },
                  ])
                }
                className="min-h-11 text-[11px] font-mono text-texte-doux hover:text-texte cursor-pointer"
              >
                Réinitialiser le fil
              </button>
            )}
          </div>

          <div
            ref={threadScrollRef}
            className="space-y-4 max-h-[640px] overflow-y-auto pr-1"
          >
            {turns.map((turn) => {
              if (turn.role === 'user') {
                return (
                  <motion.div
                    key={turn.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.16 }}
                    className="flex justify-end"
                  >
                    <div className="max-w-[85%] px-3.5 py-2.5 rounded-xl bg-accent text-sur-accent text-xs font-medium">
                      {turn.userQuestion}
                    </div>
                  </motion.div>
                );
              }

              const r = turn.response;
              if (!r) return null;

              const toneClass =
                r.verdictTone === 'emerald'
                  ? 'text-succes-texte'
                  : r.verdictTone === 'rose'
                    ? 'text-erreur-texte'
                    : 'text-texte';

              return (
                <motion.div
                  key={turn.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="p-4 sm:p-5 rounded-xl bg-fond/65 border border-bordure space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className={`text-xs font-mono font-semibold ${toneClass}`}>
                      {r.headlineVerdict}
                    </div>
                    <span className="text-[10px] font-mono text-texte-doux whitespace-nowrap shrink-0">
                      {turn.isEnriching ? (
                        <span className="inline-flex items-center gap-1 text-texte">
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          Synthèse IA…
                        </span>
                      ) : turn.isLiveGeminiEnriched ? (
                        '7 Agents + IA Direct'
                      ) : (
                        '7 Agents Vérifiés'
                      )}
                    </span>
                  </div>

                  <p className="text-xs text-texte leading-relaxed">
                    {r.plainFrenchAnswer}
                  </p>

                  {/* 3 Specialist Agent Micro-Reactions */}
                  <div className="pt-2 border-t border-bordure divide-y divide-bordure">
                    {r.agentVoices.map((ag) => {
                      const vColor =
                        ag.verdict === 'ACHETER'
                          ? 'text-succes-texte'
                          : ag.verdict === 'ÉVITER'
                            ? 'text-erreur-texte'
                            : 'text-texte';
                      const vArrow =
                        ag.verdict === 'ACHETER'
                          ? '▲'
                          : ag.verdict === 'ÉVITER'
                            ? '▼'
                            : '●';
                      return (
                        <div
                          key={`${turn.id}-${ag.code}`}
                          className="py-1.5 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 text-[11px]"
                        >
                          <div className="font-mono tabular-nums whitespace-nowrap">
                            <span className="text-texte-doux">{ag.code}</span>{' '}
                            <span className="font-semibold text-texte">
                              {ag.shortTitle}
                            </span>
                            <span aria-hidden="true" className="text-texte-doux">
                              {' '}
                              ·{' '}
                            </span>
                            <span className={`font-semibold ${vColor}`}>
                              {/* NOMBRE-NON-MONETAIRE : score quantitatif d'actif public */}
                              {vArrow} {ag.verdict} ({ag.score100}/100)
                            </span>
                          </div>
                          <span className="text-texte-doux sm:text-right">
                            {ag.message}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Actionable Trade Execution + Follow-Up Buttons */}
                  <div className="pt-2 border-t border-bordure flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {r.impactSimulation.actionType === 'FULL_PLAN' &&
                      (advisory.sellRecommendations.length > 0 ||
                        advisory.buyRecommendations.length > 0) ? (
                        <button
                          type="button"
                          onClick={() => {
                            onApplyFullAdvisoryPlan(
                              advisory.sellRecommendations,
                              advisory.buyRecommendations
                            );
                            setAppliedBanner(
                              'Plan recommandé appliqué à votre portefeuille ($ CAD).'
                            );
                          }}
                          className="min-h-11 px-3 py-1.5 text-[11px] font-semibold bg-succes-texte hover:bg-accent-fonce text-sur-accent rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Appliquer le plan recommandé
                        </button>
                      ) : (
                        Math.abs(r.impactSimulation.deltaCad) >= 50 &&
                        r.impactSimulation.isPriceCrossVerified && (
                          <button
                            type="button"
                            onClick={() => {
                              onExecuteSingleOrder(
                                r.impactSimulation.assetId,
                                r.impactSimulation.deltaCad
                              );
                              setAppliedBanner(
                                `Ordre appliqué : ${r.impactSimulation.deltaCad > 0 ? 'Achat' : 'Vente'} ${r.impactSimulation.ticker} (${formatSignedEur(r.impactSimulation.deltaCad, 0)}).`
                              );
                            }}
                            className={`min-h-11 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                              r.impactSimulation.deltaCad < 0
                                ? 'bg-erreur-texte hover:bg-erreur-texte text-sur-accent'
                                : 'bg-succes-texte hover:bg-accent-fonce text-sur-accent'
                            }`}
                          >
                            {r.impactSimulation.deltaCad < 0
                              ? `Exécuter Vente ${r.impactSimulation.ticker} (${formatSignedEur(r.impactSimulation.deltaCad, 0)})`
                              : `Exécuter Achat ${r.impactSimulation.ticker} (+${formatEur(r.impactSimulation.deltaCad, 0)})`}
                          </button>
                        )
                      )}

                      <button
                        type="button"
                        onClick={() => onInspectAsset(r.focusAssetId)}
                        className="min-h-11 min-w-11 px-2.5 py-1.5 text-[11px] font-mono text-texte hover:text-texte bg-surface border border-bordure rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Fiche {r.assetFuture.ticker}
                      </button>
                    </div>
                  </div>

                  {/* Clickable Follow-Up Suggestions */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {r.followUpPrompts.map((fp) => (
                      <button
                        key={fp}
                        type="button"
                        onClick={() =>
                          void submitConsultationQuestion({ questionText: fp })
                        }
                        className="min-h-11 min-w-11 inline-flex items-center gap-1 text-[11px] text-texte-doux hover:text-texte transition-colors text-left cursor-pointer"
                      >
                        <ArrowRight className="w-3 h-3 shrink-0" />
                        <span>{fp}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Natural Language Question Input */}
          <form
            onSubmit={handleFormSubmit}
            className="pt-3 border-t border-bordure flex items-center gap-2"
          >
            <label htmlFor="agent-chat-input" className="sr-only">
              Poser une question aux 7 Agents et à l’IA
            </label>
            <input
              id="agent-chat-input"
              type="text"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder="Votre question (ex: Acheter GOOGL ? Vendre INTC ?)"
              className="flex-1 min-w-0 min-h-[44px] px-3.5 py-2.5 text-base sm:text-xs bg-fond border border-bordure rounded-xl text-texte placeholder:text-texte-doux outline-hidden focus-ring focus:border-bordure-champ"
            />
            <button
              type="submit"
              className="min-w-11 inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3.5 sm:px-4 py-2.5 text-xs font-semibold bg-accent hover:bg-accent-fonce text-sur-accent rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Demander</span>
            </button>
          </form>
        </section>

        {/* RIGHT (5 cols): Live Synchronized Visual Proof ("Ce que ça engendre" + "Avenir Probable") */}
        <div className="lg:col-span-5 space-y-5">
          {/* Card 1: Impact sur le portefeuille */}
          <section className="bg-surface/25 border border-bordure rounded-2xl p-5 space-y-3.5">
            <div className="flex items-baseline justify-between gap-2 pb-2.5 border-b border-bordure">
              <div>
                <h3 className="text-sm font-semibold text-texte">
                  Impact estimé sur votre portefeuille
                </h3>
                <p className="text-[11px] text-texte-doux">
                  Comparaison directe :{' '}
                  <strong className="text-texte">Ce que j’ai</strong> vs{' '}
                  <strong className="text-succes-texte">
                    {imp.actionType === 'SELL' ? 'Après vente' : 'Après achat'}{' '}
                    {imp.ticker} ({formatSignedEur(imp.deltaCad, 0)})
                  </strong>
                </p>
              </div>
            </div>

            <div className="divide-y divide-bordure text-xs font-mono tabular-nums">
              <div className="py-1.5 grid grid-cols-12 text-[11px] text-texte-doux">
                <span className="col-span-5 font-sans">Indicateur</span>
                <span className="col-span-3 text-right font-sans">Actuel</span>
                <span className="col-span-4 text-right font-sans text-texte">
                  Après simulation
                </span>
              </div>

              <div className="py-2 grid grid-cols-12 items-center">
                <span className="col-span-5 font-sans text-texte">
                  Note Santé
                </span>
                <span className="col-span-3 text-right text-texte-doux">
                  <PrivateAmount>{imp.healthScoreBefore100}/100</PrivateAmount>
                </span>
                <span
                  className={`col-span-4 text-right font-semibold ${
                    imp.healthDeltaPts >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                  }`}
                >
                  <PrivateAmount>
                    {imp.healthScoreAfter100}/100 ({imp.healthDeltaPts >= 0 ? `+${imp.healthDeltaPts}` : imp.healthDeltaPts})
                  </PrivateAmount>
                </span>
              </div>

              <div className="py-2 grid grid-cols-12 items-center">
                <span className="col-span-5 font-sans text-texte">
                  Capital 5 ans (2031)
                </span>
                <span className="col-span-3 text-right text-texte-doux">
                  {formatCompactEur(imp.median5yBeforeCad)}
                </span>
                <span
                  className={`col-span-4 text-right font-semibold ${
                    imp.median5yDeltaCad >= 0
                      ? 'text-succes-texte'
                      : 'text-erreur-texte'
                  }`}
                >
                  {formatCompactEur(imp.median5yAfterCad)} (
                  {formatSignedEur(imp.median5yDeltaCad, 0)})
                </span>
              </div>

              <div className="py-2 grid grid-cols-12 items-center">
                <span className="col-span-5 font-sans text-texte">
                  Pire mois (VaR 95%)
                </span>
                <span className="col-span-3 text-right text-texte-doux">
                  −{formatEur(imp.var95MonthlyBeforeCad, 0)}
                </span>
                <span
                  className={`col-span-4 text-right font-semibold ${
                    imp.var95DeltaCad <= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                  }`}
                >
                  −{formatEur(imp.var95MonthlyAfterCad, 0)}
                </span>
              </div>

              <div className="py-2 grid grid-cols-12 items-center">
                <span className="col-span-5 font-sans text-texte">
                  Dividendes / an
                </span>
                <span className="col-span-3 text-right text-texte-doux">
                  {formatEur(imp.annualIncomeBeforeCad, 0)}
                </span>
                <span
                  className={`col-span-4 text-right font-semibold ${
                    imp.annualIncomeDeltaCad >= 0
                      ? 'text-succes-texte'
                      : 'text-texte'
                  }`}
                >
                  {formatEur(imp.annualIncomeAfterCad, 0)} (
                  {formatSignedEur(imp.annualIncomeDeltaCad, 0)})
                </span>
              </div>

              <div className="py-2 grid grid-cols-12 items-center">
                <span className="col-span-5 font-sans text-texte">
                  Poids {imp.ticker}
                </span>
                <span className="col-span-3 text-right text-texte-doux">
                  <PrivateAmount>{imp.weightBeforePct.toFixed(1)} %</PrivateAmount>
                </span>
                <span
                  className={`col-span-4 text-right font-semibold ${
                    imp.isOverConcentrationCap ? 'text-erreur-texte' : 'text-texte'
                  }`}
                >
                  <PrivateAmount>
                    {imp.weightAfterPct.toFixed(1)} % (max {imp.maxAllowedWeightPct} %)
                  </PrivateAmount>
                </span>
              </div>
            </div>

            {Math.abs(imp.deltaCad) >= 50 && imp.isPriceCrossVerified && (
              <button
                type="button"
                onClick={() => {
                  onExecuteSingleOrder(imp.assetId, imp.deltaCad);
                  setAppliedBanner(
                    `Ordre appliqué dans votre portefeuille : ${imp.ticker} (${formatSignedEur(imp.deltaCad, 0)}).`
                  );
                }}
                className={`w-full min-h-11 py-2.5 px-3.5 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                  imp.deltaCad < 0
                    ? 'bg-erreur-texte hover:bg-erreur-texte text-sur-accent'
                    : 'bg-succes-texte hover:bg-accent-fonce text-sur-accent'
                }`}
              >
                {imp.deltaCad < 0
                  ? `Appliquer : Vendre ${imp.ticker} (${formatSignedEur(imp.deltaCad, 0)})`
                  : `Appliquer : +${formatEur(imp.deltaCad, 0)} sur ${imp.ticker} (${imp.optimalWrapper})`}
              </button>
            )}
          </section>

          {/* Card 2: Avenir probable de l'actif (2026 -> 2031) */}
          <section className="bg-surface/25 border border-bordure rounded-2xl p-5 space-y-3.5">
            <div className="flex items-baseline justify-between gap-2 pb-2.5 border-b border-bordure">
              <div>
                <h3 className="text-sm font-semibold text-texte">
                  Avenir probable : {fut.ticker} ({fut.name})
                </h3>
                <p className="text-[11px] font-mono tabular-nums text-texte-doux">
                  Cours vérifié {formatEur(fut.spotPriceCad, 2)} · Vraie valeur{' '}
                  {formatEur(fut.fairValueCad, 2)} (
                  {formatSignedPct(fut.upsideToFairPct, 1)})
                </p>
              </div>
              <span
                className={`text-xs font-mono font-bold whitespace-nowrap ${
                  fut.verdictTone === 'emerald'
                    ? 'text-succes-texte'
                    : fut.verdictTone === 'rose'
                      ? 'text-erreur-texte'
                      : 'text-texte'
                }`}
              >
                {fut.verdictTone === 'emerald'
                  ? '▲'
                  : fut.verdictTone === 'rose'
                    ? '▼'
                    : '●'}{' '}
                {fut.verdictLabel}
              </span>
            </div>

            <ProbableFutureConeSvg future={fut} />

            <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono tabular-nums">
              <div>
                <span className="block text-[10px] font-sans text-texte-doux">
                  Prudent 2031 (P10)
                </span>
                <span className="text-xs font-semibold text-erreur-texte">
                  {formatEur(fut.p10At5yCad, fut.p10At5yCad < 20 ? 2 : 0)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-sans text-texte-doux">
                  Probable 2031 (P50)
                </span>
                <span className="text-xs font-bold text-texte">
                  {formatEur(fut.p50At5yCad, fut.p50At5yCad < 20 ? 2 : 0)} (
                  {formatSignedPct(fut.return5yProbablePct, 0)})
                </span>
              </div>
              <div>
                <span className="block text-[10px] font-sans text-texte-doux">
                  Optimiste 2031 (P90)
                </span>
                <span className="text-xs font-semibold text-succes-texte">
                  {formatEur(fut.p90At5yCad, fut.p90At5yCad < 20 ? 2 : 0)}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-bordure space-y-2">
              <PriceTargetRangeBar
                spotCad={fut.spotPriceCad}
                fairCad={fut.fairValueCad}
                stopCad={fut.stopLossCad}
                targetCad={fut.target12mCad}
              />

              <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-texte-doux">
                <span>
                  {/* NOMBRE-NON-MONETAIRE : score consensus public du comité */}
                  Comité : {fut.committeeBuyVotes}/7 favorables ({fut.compositeAgentScore100}/100)
                </span>
                <span className="text-succes-texte">
                  {fut.probabilityPositive5yPct} % prob. gain 5 ans
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
