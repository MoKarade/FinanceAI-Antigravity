import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileJson,
  Globe,
  Minimize2,
  Upload,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { MacroIndicators, RiskProfile } from '../../services/valoria/marketData';
import { PortfolioLot, PortfolioSummary } from '../../services/valoria/engine';
import { computePortfolioRiskMetrics } from '../../services/valoria/quantAnalytics';
import { analyzeEquityUniverse } from '../../services/valoria/equityQuantEngine';
import {
  buildCompactFinanceAIExportJson,
  buildFinanceAICsvExport,
  buildFinanceAIExportPayload,
  FinanceAIBudgetSync,
  FinanceAIImportResult,
  parseFinanceAIPayload,
  SAMPLE_FINANCEAI_JSON,
} from '../../services/valoria/financeAiBridge';
import { formatEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';

interface FinanceAIBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  portfolioSummary: PortfolioSummary;
  livePrices: Record<string, number>;
  macro: MacroIndicators;
  riskProfile: RiskProfile;
  syncedBudget: FinanceAIBudgetSync | null;
  onImportFinanceAI: (params: {
    lots: Omit<PortfolioLot, 'id'>[];
    mode: 'replace' | 'merge';
    budgetSync: FinanceAIBudgetSync | null;
    detectedRiskProfile: RiskProfile | null;
    watchlistAssetIds: string[];
  }) => void;
  onNavigateToSignals: () => void;
}

type BridgeTab = 'import' | 'export' | 'api';

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2).replace('.', ',')} Mo`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1).replace('.', ',')} Ko`;
  }
  return `${bytes} o`;
}

export const FinanceAIBridgeModal: React.FC<FinanceAIBridgeModalProps> = ({
  isOpen,
  onClose,
  portfolioSummary,
  livePrices,
  macro,
  riskProfile,
  syncedBudget,
  onImportFinanceAI,
  onNavigateToSignals,
}) => {
  const [activeTab, setActiveTab] = useState<BridgeTab>('import');
  const [rawInput, setRawInput] = useState<string>('');
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastImportReport, setLastImportReport] = useState<FinanceAIImportResult | null>(
    null
  );
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isProcessingLargeFile, setIsProcessingLargeFile] = useState<boolean>(false);
  const [copiedFlag, setCopiedFlag] = useState<string | null>(null);

  const [exportFormatMode, setExportFormatMode] = useState<'standard' | 'compact'>(
    'standard'
  );

  const [remoteUrl, setRemoteUrl] = useState<string>('');
  const [apiStatusMsg, setApiStatusMsg] = useState<string | null>(null);
  const [apiErrorMsg, setApiErrorMsg] = useState<string | null>(null);
  const [apiLoading, setApiLoading] = useState<boolean>(false);

  const riskMetrics = useMemo(
    () =>
      computePortfolioRiskMetrics(
        portfolioSummary.lots.map((l) => l.lot),
        livePrices
      ),
    [portfolioSummary.lots, livePrices]
  );

  const equitySummary = useMemo(
    () =>
      analyzeEquityUniverse({
        livePrices,
        macro,
        riskProfile,
        evaluatedLots: portfolioSummary.lots,
        totalPortfolioValue: portfolioSummary.totalCurrentValue,
      }),
    [livePrices, macro, riskProfile, portfolioSummary]
  );

  const exportPayload = useMemo(
    () =>
      buildFinanceAIExportPayload({
        portfolioSummary,
        riskMetrics,
        equitySummary,
        riskProfile,
        monthlySavingsCapacityEur: syncedBudget?.monthlySavingsCapacityEur ?? 350,
        macro,
      }),
    [portfolioSummary, riskMetrics, equitySummary, riskProfile, syncedBudget, macro]
  );

  const formattedExportText = useMemo(() => {
    if (exportFormatMode === 'compact') {
      return buildCompactFinanceAIExportJson(exportPayload);
    }
    return JSON.stringify(exportPayload, null, 2);
  }, [exportPayload, exportFormatMode]);

  const exportTextBytes = useMemo(
    () => new TextEncoder().encode(formattedExportText).length,
    [formattedExportText]
  );

  if (!isOpen) return null;

  const bridgeEndpointUrl = `${window.location.origin}/api/financeai/bridge`;

  const handleRunImport = (
    sourceText = rawInput,
    options?: { updateTextareaWithCompact?: boolean; fileName?: string }
  ) => {
    try {
      setParseError(null);
      const parsed = parseFinanceAIPayload(sourceText);

      if (
        options?.updateTextareaWithCompact ||
        sourceText.length > 25_000 ||
        parsed.compactionStats?.wasCompacted
      ) {
        if (parsed.compactPreviewJson) {
          setRawInput(parsed.compactPreviewJson);
        }
      }

      if (options?.fileName) {
        setLoadedFileName(options.fileName);
      }

      onImportFinanceAI({
        lots: parsed.importedLots,
        mode: importMode,
        budgetSync: parsed.budgetSync,
        detectedRiskProfile: parsed.detectedRiskProfile,
        watchlistAssetIds: parsed.watchlistAssetIds,
      });
      setLastImportReport(parsed);
    } catch (err: unknown) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la lecture des données FinanceAI.'
      );
    }
  };

  const processSelectedFile = async (file: File) => {
    setIsProcessingLargeFile(true);
    setParseError(null);
    try {
      const content = await file.text();
      if (content.length <= 25_000) {
        setRawInput(content);
      }
      handleRunImport(content, {
        updateTextareaWithCompact: true,
        fileName: file.name,
      });
    } catch (err: unknown) {
      setParseError(
        err instanceof Error
          ? err.message
          : 'Impossible de lire ce fichier FinanceAI.'
      );
    } finally {
      setIsProcessingLargeFile(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void processSelectedFile(file);
    e.target.value = '';
  };

  const handleDropFile = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    void processSelectedFile(file);
  };

  const handleTextareaPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData?.getData('text') ?? '';
    if (pasted.length > 25_000) {
      e.preventDefault();
      setLoadedFileName('Presse-papiers volumineux');
      handleRunImport(pasted, { updateTextareaWithCompact: true });
    }
  };

  const handleCopyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFlag(label);
      window.setTimeout(() => setCopiedFlag(null), 2000);
    } catch {
      setCopiedFlag(null);
    }
  };

  const handleDownloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePublishToLiveBridge = async () => {
    setApiLoading(true);
    setApiErrorMsg(null);
    setApiStatusMsg(null);
    try {
      const res = await fetch('/api/financeai/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportPayload),
      });
      if (!res.ok) {
        throw new Error('Échec de publication sur le pont API local.');
      }
      setApiStatusMsg(
        `Snapshot publié (${exportPayload.positions.length} positions + ${exportPayload.tacticalSignals.buyNow.length} signaux Achat + ${exportPayload.tacticalSignals.sellOrTrimNow.length} signaux Vente disponibles sur GET /api/financeai/bridge).`
      );
    } catch (err: unknown) {
      setApiErrorMsg(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setApiLoading(false);
    }
  };

  const handlePullRemoteFinanceAI = async () => {
    if (!remoteUrl.trim()) {
      setApiErrorMsg('Renseignez l’URL JSON de votre application FinanceAI.');
      return;
    }
    setApiLoading(true);
    setApiErrorMsg(null);
    setApiStatusMsg(null);
    try {
      const res = await fetch('/api/financeai/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteUrl: remoteUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Impossible de joindre cette URL FinanceAI.');
      }
      const textPayload = JSON.stringify(data.remotePayload, null, 2);
      handleRunImport(textPayload, { updateTextareaWithCompact: true });
      setApiStatusMsg('Portefeuille FinanceAI distant importé, allégé et audité avec succès.');
    } catch (err: unknown) {
      setApiErrorMsg(
        err instanceof Error ? err.message : 'Erreur de connexion à FinanceAI.'
      );
    } finally {
      setApiLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Importer ou Exporter FinanceAI ($ CAD)"
      subtitle="Support natif des sauvegardes FinanceAI volumineuses et conversion automatique en $ CAD"
      size="xl"
    >
      <div className="space-y-4">
        {/* Navigation Tabs */}
        <div className="pb-2 border-b border-bordure flex flex-wrap items-center gap-3 text-xs font-medium">
          {(
            [
              { id: 'import', label: '1. Importer depuis FinanceAI' },
              { id: 'export', label: '2. Exporter vers FinanceAI' },
              { id: 'api', label: '3. API Live (50 Mo)' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`min-h-11 px-3 py-2 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === t.id
                  ? 'border-accent text-texte font-semibold'
                  : 'border-transparent text-texte-doux hover:text-texte'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Modal Body */}
        <div className="space-y-4 text-xs">
          {activeTab === 'import' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDraggingFile(true);
                }}
                onDragLeave={() => setIsDraggingFile(false)}
                onDrop={handleDropFile}
                className={`p-4 rounded-xl border border-dashed transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isDraggingFile
                    ? 'border-accent bg-surface'
                    : 'border-bordure-champ bg-surface/60'
                }`}
              >
                <div className="space-y-1">
                  <div className="font-semibold text-texte flex items-center gap-2">
                    <Upload className="w-4 h-4 text-texte shrink-0" />
                    <span>
                      {isProcessingLargeFile
                        ? 'Compression et extraction du fichier en cours…'
                        : 'Glissez-déposez votre fichier .json FinanceAI (même > 5 Mo)'}
                    </span>
                  </div>
                  <p className="text-[11px] text-texte-doux">
                    Extrait instantanément vos positions et cours quotidiens en $ CAD sans bloquer le navigateur.
                  </p>
                </div>

                <label className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer shrink-0 whitespace-nowrap">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Choisir fichier .json / .csv</span>
                  <input
                    type="file"
                    aria-label="Importer un fichier JSON ou CSV FinanceAI"
                    accept=".json,.csv,.txt,application/json,text/csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setLoadedFileName('Démo FinanceAI');
                      setRawInput(SAMPLE_FINANCEAI_JSON);
                      handleRunImport(SAMPLE_FINANCEAI_JSON);
                    }}
                    className="min-h-11 px-3 py-1.5 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl cursor-pointer"
                  >
                    Charger &amp; tester un export démo
                  </button>
                  {loadedFileName && (
                    <span className="text-[11px] font-mono text-texte-doux">
                      Source : {loadedFileName}
                    </span>
                  )}
                </div>

                <div className="inline-flex p-0.5 bg-surface border border-bordure rounded-xl">
                  <button aria-pressed={Boolean(importMode === 'replace')}
                    type="button"
                    onClick={() => setImportMode('replace')}
                    className={`min-h-11 min-w-11 px-2.5 py-1 rounded-lg cursor-pointer ${
                      importMode === 'replace'
                        ? 'bg-accent text-sur-accent font-semibold'
                        : 'text-texte-doux'
                    }`}
                  >
                    Remplacer
                  </button>
                  <button aria-pressed={Boolean(importMode === 'merge')}
                    type="button"
                    onClick={() => setImportMode('merge')}
                    className={`min-h-11 min-w-11 px-2.5 py-1 rounded-lg cursor-pointer ${
                      importMode === 'merge'
                        ? 'bg-accent text-sur-accent font-semibold'
                        : 'text-texte-doux'
                    }`}
                  >
                    Fusionner
                  </button>
                </div>
              </div>

              {lastImportReport?.compactionStats?.wasCompacted && (
                <div className="p-3 bg-surface border border-bordure-champ rounded-xl flex flex-wrap items-center justify-between gap-2 text-[11px] text-texte">
                  <div className="flex items-center gap-2">
                    <Minimize2 className="w-3.5 h-3.5 text-succes-texte shrink-0" />
                    <span>
                      <strong>JSON volumineux allégé :</strong>{' '}
                      <span className="font-mono">
                        {formatByteSize(lastImportReport.compactionStats.originalBytes)} →{' '}
                        {formatByteSize(lastImportReport.compactionStats.compactBytes)}
                      </span>
                    </span>
                  </div>
                  {lastImportReport.compactionStats.appliedFxSummary && (
                    <span className="font-mono text-succes-texte">
                      Converti en $ CAD ({lastImportReport.compactionStats.appliedFxSummary})
                    </span>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="financeai-paste-box"
                  className="block text-texte font-medium mb-1.5"
                >
                  Aperçu compact ou collage direct
                </label>
                <textarea
                  id="financeai-paste-box"
                  rows={5}
                  value={rawInput}
                  onPaste={handleTextareaPaste}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder={`Collez un export JSON FinanceAI ou CSV :\n{"version":"4.0","store":{"state":{"assets":[{"symbol":"ADP","quantity":90,"buyPrice":175.29,"currency":"USD"}]}}}`}
                  className="min-h-11 w-full p-3 font-mono text-[11px] bg-surface border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ"
                />
              </div>

              {parseError && (
                <div
                  role="alert"
                  className="p-3 text-erreur-texte bg-erreur-fond border border-erreur-texte/40 rounded-xl"
                >
                  {parseError}
                </div>
              )}

              {lastImportReport && (
                <div className="p-4 bg-surface border border-succes-texte/40 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-succes-texte flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      Synchronisation active ({lastImportReport.importedLots.length} lignes importées)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onNavigateToSignals();
                      }}
                      className="min-h-11 text-texte hover:underline font-semibold cursor-pointer"
                    >
                      Voir mes conseils →
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono tabular-nums text-[11px]">
                    <div className="p-2 bg-fond border border-bordure rounded-lg">
                      <span className="text-texte-doux block font-sans">Épargne mensuelle</span>
                      <strong className="text-texte">
                        {lastImportReport.budgetSync
                          ? `${formatEur(lastImportReport.budgetSync.monthlySavingsCapacityEur, 0)} / mois`
                          : 'Non spécifiée'}
                      </strong>
                    </div>
                    <div className="p-2 bg-fond border border-bordure rounded-lg">
                      <span className="text-texte-doux block font-sans">Alertes Vente</span>
                      <strong
                        className={
                          equitySummary.heldSellAlerts.length > 0
                            ? 'text-erreur-texte'
                            : 'text-succes-texte'
                        }
                      >
                        {equitySummary.heldSellAlerts.length} titre(s) à alléger
                      </strong>
                    </div>
                    <div className="p-2 bg-fond border border-bordure rounded-lg">
                      <span className="text-texte-doux block font-sans">Profil détecté</span>
                      <strong className="text-texte capitalize">
                        {lastImportReport.detectedRiskProfile ?? riskProfile}
                      </strong>
                    </div>
                  </div>

                  {lastImportReport.unmatchedSymbols.length > 0 && (
                    <p className="text-[11px] text-erreur-texte">
                      Symboles non reconnus ({lastImportReport.unmatchedSymbols.length}) :{' '}
                      <span className="font-mono">
                        {lastImportReport.unmatchedSymbols.join(', ')}
                      </span>
                    </p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleRunImport(rawInput)}
                  className="min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
                >
                  Importer &amp; Analyser
                </button>
              </div>
            </div>
          )}

          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 font-mono tabular-nums">
                <div className="p-3 bg-surface border border-bordure rounded-xl">
                  <span className="text-texte-doux block font-sans text-[11px]">
                    Positions synchronisées
                  </span>
                  <strong className="text-sm text-texte">
                    {exportPayload.positions.length} ({formatEur(exportPayload.portfolioMetrics.totalValueEur, 0)})
                  </strong>
                </div>
                <div className="p-3 bg-surface border border-bordure rounded-xl">
                  <span className="text-texte-doux block font-sans text-[11px]">
                    Opportunités d’achat
                  </span>
                  <strong className="text-sm text-succes-texte">
                    ▲ {exportPayload.tacticalSignals.buyNow.length} actions ({formatSignedPct(equitySummary.avgTopBuyUpsidePct, 1)})
                  </strong>
                </div>
                <div className="p-3 bg-surface border border-bordure rounded-xl">
                  <span className="text-texte-doux block font-sans text-[11px]">
                    Alertes vente
                  </span>
                  <strong className="text-sm text-erreur-texte">
                    ▼ {exportPayload.tacticalSignals.sellOrTrimNow.length} actions
                  </strong>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] text-texte-doux font-mono">
                  Taille : {formatByteSize(exportTextBytes)}
                </span>
                <div className="inline-flex p-0.5 bg-surface border border-bordure rounded-xl">
                  <button aria-pressed={Boolean(exportFormatMode === 'standard')}
                    type="button"
                    onClick={() => setExportFormatMode('standard')}
                    className={`min-h-11 min-w-11 px-2.5 py-1 rounded-lg cursor-pointer ${
                      exportFormatMode === 'standard'
                        ? 'bg-accent text-sur-accent font-semibold'
                        : 'text-texte-doux'
                    }`}
                  >
                    JSON Complet
                  </button>
                  <button aria-pressed={Boolean(exportFormatMode === 'compact')}
                    type="button"
                    onClick={() => setExportFormatMode('compact')}
                    className={`min-h-11 min-w-11 px-2.5 py-1 rounded-lg cursor-pointer ${
                      exportFormatMode === 'compact'
                        ? 'bg-accent text-sur-accent font-semibold'
                        : 'text-texte-doux'
                    }`}
                  >
                    JSON Ultra-Compact (&lt; 1,5 Ko)
                  </button>
                </div>
              </div>

              <pre className="p-3 bg-surface border border-bordure rounded-xl font-mono text-[10.5px] text-texte max-h-52 overflow-y-auto whitespace-pre-wrap break-all">
                {formattedExportText}
              </pre>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyText(formattedExportText, 'json')}
                  className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    {copiedFlag === 'json' ? 'Copié !' : 'Copier JSON'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadFile(
                      buildFinanceAICsvExport(exportPayload),
                      'valoria-financeai-signaux.csv',
                      'text/csv;charset=utf-8'
                    )
                  }
                  className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exporter .CSV</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleDownloadFile(
                      formattedExportText,
                      exportFormatMode === 'compact'
                        ? 'valoria-financeai-lite.json'
                        : 'valoria-financeai-bridge.json',
                      'application/json'
                    )
                  }
                  className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
                >
                  <FileJson className="w-3.5 h-3.5" />
                  <span>Télécharger (.json)</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'api' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-surface border border-bordure rounded-xl space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-texte flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-texte" />
                    Endpoint REST ouvert (CORS activé · jusqu’à 50 Mo)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(bridgeEndpointUrl, 'url')}
                    className="min-h-11 text-texte hover:underline font-mono text-[11px] cursor-pointer"
                  >
                    {copiedFlag === 'url' ? 'URL copiée !' : 'Copier l’URL'}
                  </button>
                </div>
                <code className="block p-2 bg-fond border border-bordure rounded-lg font-mono text-[11px] text-texte select-all">
                  {bridgeEndpointUrl}
                </code>
                <button
                  type="button"
                  disabled={apiLoading}
                  onClick={handlePublishToLiveBridge}
                  className="min-h-11 px-3.5 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl cursor-pointer"
                >
                  Publier sur l’API Live
                </button>
              </div>

              <div className="p-3.5 bg-surface border border-bordure rounded-xl space-y-2">
                <label
                  htmlFor="remote-financeai-url"
                  className="block font-semibold text-texte"
                >
                  Synchroniser depuis une URL FinanceAI externe
                </label>
                <div className="flex gap-2">
                  <input
                    id="remote-financeai-url"
                    type="url"
                    placeholder="https://votre-app-financeai.run.app/api/portfolio"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    className="min-h-11 flex-1 px-3 py-1.5 font-mono text-xs bg-fond border border-bordure rounded-xl text-texte outline-hidden focus-ring focus:border-bordure-champ"
                  />
                  <button
                    type="button"
                    disabled={apiLoading}
                    onClick={handlePullRemoteFinanceAI}
                    className="min-h-11 px-3.5 py-1.5 text-xs font-medium text-texte bg-surface-douce hover:bg-surface-douce border border-bordure-champ rounded-xl cursor-pointer whitespace-nowrap"
                  >
                    Synchroniser
                  </button>
                </div>
              </div>

              {apiStatusMsg && (
                <div className="p-3 text-succes-texte bg-succes-fond border border-succes-texte/40 rounded-xl">
                  {apiStatusMsg}
                </div>
              )}
              {apiErrorMsg && (
                <div className="p-3 text-erreur-texte bg-erreur-fond border border-erreur-texte/40 rounded-xl">
                  {apiErrorMsg}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
