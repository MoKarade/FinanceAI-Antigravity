import React, { useMemo, useState } from 'react';
import { Link2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  ASSETS,
  MARKET_REGIMES,
  type RegimeId,
  type RiskProfile,
} from '../../services/valoria/marketData';
import { getAssetSubClass } from '../../services/valoria/globalMarketCatalog';
import type { PortfolioLot } from '../../services/valoria/engine';
import type { HeldLineDiagnostic } from '../../services/valoria/proAnalystAdvisor';
import { D3PriceSparkline30d } from './D3PriceSparkline30d';
import { formatEur, formatSignedPct } from '../../services/valoria/valoriaFormatters';

interface PortfolioControlHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  heldLines: HeldLineDiagnostic[];
  lots: PortfolioLot[];
  riskProfile: RiskProfile;
  regimeId: RegimeId;
  availableCashCad: number;
  marketUniverseVersion: number;
  isRefreshingVerified?: boolean;
  verifiedFeedStatus?: string | null;
  onSelectRiskProfile: (profile: RiskProfile) => void;
  onSelectRegime: (id: RegimeId) => void;
  onChangeAvailableCashCad: (val: number) => void;
  onAddLot: (lot: Omit<PortfolioLot, 'id'>) => void;
  onExecuteSingleOrder: (assetId: string, deltaCad: number) => void;
  onRemoveAssetHoldings: (assetId: string) => void;
  onResetDemoPortfolio: () => void;
  onClearPortfolio: () => void;
  onOpenFinanceAIBridge: () => void;
  onRefreshVerifiedPrices?: () => void;
}

const RISK_PROFILES: { id: RiskProfile; label: string; hint: string }[] = [
  { id: 'prudent', label: 'Prudent', hint: 'Priorité sécurité' },
  { id: 'equilibre', label: 'Équilibré', hint: 'Croissance calme' },
  { id: 'dynamique', label: 'Dynamique', hint: 'Croissance forte' },
  { id: 'offensif', label: 'Offensif', hint: 'Rendement max' },
];

export const PortfolioControlHubModal: React.FC<PortfolioControlHubModalProps> = ({
  isOpen,
  onClose,
  heldLines,
  lots,
  riskProfile,
  regimeId,
  availableCashCad,
  marketUniverseVersion,
  isRefreshingVerified = false,
  verifiedFeedStatus = null,
  onSelectRiskProfile,
  onSelectRegime,
  onChangeAvailableCashCad,
  onAddLot,
  onExecuteSingleOrder,
  onRemoveAssetHoldings,
  onResetDemoPortfolio,
  onClearPortfolio,
  onOpenFinanceAIBridge,
  onRefreshVerifiedPrices,
}) => {
  const [section, setSection] = useState<'positions' | 'settings'>('positions');
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('RY');
  const [amountInput, setAmountInput] = useState<string>('5000');
  const [cashInput, setCashInput] = useState<string>(
    availableCashCad > 0 ? String(availableCashCad) : '0'
  );
  const [formError, setFormError] = useState<string | null>(null);

  const groupedPickerOptions = useMemo(() => {
    void marketUniverseVersion;
    const q = searchFilter.trim().toUpperCase();
    const filtered = ASSETS.filter((a) => {
      if (!q) return true;
      return `${a.ticker} ${a.id} ${a.name} ${a.categoryLabel} ${a.sector ?? ''}`
        .toUpperCase()
        .includes(q);
    });

    const groups = [
      { label: 'Actions Canada (S&P/TSX)', items: [] as typeof filtered },
      { label: 'Actions États-Unis (S&P 500 / Nasdaq)', items: [] as typeof filtered },
      { label: 'Actions Europe & Asie', items: [] as typeof filtered },
      { label: 'Cryptomonnaies, Layer-1 & DeFi', items: [] as typeof filtered },
      { label: 'ETF Indiciels Mondiaux & Canadiens', items: [] as typeof filtered },
      { label: 'Obligations, Monétaire, Or & REITs', items: [] as typeof filtered },
    ];

    for (const a of filtered) {
      const sc = getAssetSubClass(a);
      if (sc === 'action_ca') groups[0].items.push(a);
      else if (sc === 'action_us') groups[1].items.push(a);
      else if (sc === 'action_eu_asia') groups[2].items.push(a);
      else if (sc === 'crypto_l1_defi') groups[3].items.push(a);
      else if (sc === 'etf_indice') groups[4].items.push(a);
      else groups[5].items.push(a);
    }

    return {
      groups: groups.filter((g) => g.items.length > 0),
      flat: filtered,
    };
  }, [searchFilter, marketUniverseVersion]);

  const effectiveSelectedId = useMemo(() => {
    if (groupedPickerOptions.flat.some((a) => a.id === selectedAssetId)) {
      return selectedAssetId;
    }
    return groupedPickerOptions.flat[0]?.id ?? selectedAssetId;
  }, [groupedPickerOptions.flat, selectedAssetId]);

  if (!isOpen) return null;

  const handleAddPositionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(amountInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 50) {
      setFormError('Montant minimal requis : 50 $ CAD.');
      return;
    }
    if (!effectiveSelectedId) {
      setFormError('Sélectionnez un actif valide.');
      return;
    }
    setFormError(null);
    onAddLot({
      assetId: effectiveSelectedId,
      investedAmount: Math.round(parsed),
      purchaseYearMonth: '2026-11',
    });
  };

  const handleCashChange = (valStr: string) => {
    setCashInput(valStr);
    const num = Number(valStr.replace(',', '.'));
    if (Number.isFinite(num) && num >= 0) {
      onChangeAvailableCashCad(Math.round(num));
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Gérer mon Portefeuille & Réglages ($ CAD)"
      subtitle="Saisies, positions, imports et paramètres au même endroit."
      size="lg"
    >
      <div className="space-y-4">
        {/* Section Switcher */}
        <div className="pb-3 flex flex-wrap items-center justify-between gap-2 border-b border-bordure shrink-0">
          <div className="inline-flex items-center gap-1 p-1 bg-surface border border-bordure rounded-xl">
            <button
              type="button"
              aria-pressed={section === 'positions'}
              onClick={() => setSection('positions')}
              className={`min-h-11 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                section === 'positions'
                  ? 'bg-accent text-sur-accent'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              Mes Positions ({heldLines.length})
            </button>
            <button
              type="button"
              aria-pressed={section === 'settings'}
              onClick={() => setSection('settings')}
              className={`min-h-11 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
                section === 'settings'
                  ? 'bg-accent text-sur-accent'
                  : 'text-texte-doux hover:text-texte'
              }`}
            >
              <span className="sm:hidden">Profil &amp; Climat</span>
              <span className="hidden sm:inline">Profil, Liquidités &amp; Climat</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFinanceAIBridge();
            }}
            className="min-w-11 inline-flex items-center gap-1.5 min-h-11 px-3 py-1.5 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Pont FinanceAI</span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="space-y-5">
          {section === 'positions' ? (
            <>
              {/* Add Position Form */}
              <form
                onSubmit={handleAddPositionSubmit}
                className="p-4 bg-surface/60 border border-bordure rounded-2xl space-y-3"
              >
                <div className="text-xs font-semibold text-texte">
                  Ajouter un placement à ce que j’ai
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="hub-filter-ticker"
                      className="block text-[11px] text-texte-doux mb-1"
                    >
                      Filtrer un symbole
                    </label>
                    <input
                      id="hub-filter-ticker"
                      type="text"
                      value={searchFilter}
                      onChange={(e) => setSearchFilter(e.target.value)}
                      placeholder="ADP, RY, BTC, ZAG…"
                      className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-fond border border-bordure rounded-lg text-texte placeholder:text-texte-doux outline-hidden focus-ring focus:border-bordure-champ"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="hub-amount-cad"
                      className="block text-[11px] text-texte-doux mb-1"
                    >
                      Montant investi ($ CAD)
                    </label>
                    <input
                      id="hub-amount-cad"
                      type="number"
                      min={50}
                      step={100}
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-fond border border-bordure rounded-lg text-texte outline-hidden focus-ring focus:border-bordure-champ"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="hub-select-asset"
                    className="block text-[11px] text-texte-doux mb-1"
                  >
                    Actif ({groupedPickerOptions.flat.length} disponibles)
                  </label>
                  <select
                    id="hub-select-asset"
                    value={effectiveSelectedId}
                    onChange={(e) => setSelectedAssetId(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-fond border border-bordure rounded-lg text-texte outline-hidden focus-ring focus:border-bordure-champ"
                  >
                    {groupedPickerOptions.groups.map((grp) => (
                      <optgroup key={grp.label} label={grp.label}>
                        {grp.items.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.ticker} — {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                {formError && (
                  <p role="alert" className="text-xs font-mono text-erreur-texte">
                    {formError}
                  </p>
                )}

                <button
                  type="submit"
                  className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Ajouter cette position</span>
                </button>
              </form>

              {/* Current Positions List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-texte">
                    Lignes détenues ({heldLines.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={onResetDemoPortfolio}
                      className="min-h-11 text-[11px] text-texte-doux hover:text-texte underline cursor-pointer"
                    >
                      Portefeuille démo
                    </button>
                    {lots.length > 0 && (
                      <button
                        type="button"
                        onClick={onClearPortfolio}
                        className="min-h-11 text-[11px] text-erreur-texte hover:text-erreur-texte underline cursor-pointer"
                      >
                        Tout vider
                      </button>
                    )}
                  </div>
                </div>

                {heldLines.length === 0 ? (
                  <p className="py-6 text-center text-xs text-texte-doux border border-bordure rounded-xl">
                    Aucune ligne détenue actuellement.
                  </p>
                ) : (
                  <div className="divide-y divide-bordure border border-bordure rounded-2xl px-4 bg-surface/40">
                    {heldLines.map((line) => (
                      <div
                        key={line.assetId}
                        className="py-3 flex items-center justify-between gap-2 font-mono tabular-nums text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-texte truncate">
                            {line.ticker}{' '}
                            <span className="font-sans font-normal text-texte-doux">
                              · {line.name.split(' (')[0]}
                            </span>
                          </div>
                          <div className="text-[11px] text-texte-doux">
                            {formatEur(line.currentValueCad, 0)} ·{' '}
                            <span
                              className={
                                line.pnlPct >= 0 ? 'text-succes-texte' : 'text-erreur-texte'
                              }
                            >
                              {formatSignedPct(line.pnlPct, 1)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <D3PriceSparkline30d
                            assetId={line.assetId}
                            spotPriceCad={line.spotPriceCad}
                            width={52}
                            height={20}
                          />
                          <button
                            type="button"
                            onClick={() => onExecuteSingleOrder(line.assetId, 1000)}
                            className="min-w-11 min-h-11 px-2.5 py-1.5 text-[11px] text-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-lg cursor-pointer"
                          >
                            +1 000 $
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveAssetHoldings(line.assetId)}
                            aria-label={`Supprimer ${line.ticker}`}
                            className="min-w-11 min-h-11 min-w-[38px] inline-flex items-center justify-center text-texte-doux hover:text-erreur-texte hover:bg-surface-douce rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-5">
              {/* Risk Profile */}
              <div className="p-4 bg-surface/60 border border-bordure rounded-2xl space-y-2.5">
                <span className="block text-xs font-semibold text-texte">
                  Votre tolérance au risque
                </span>
                <div className="grid grid-cols-2 gap-2">
                  {RISK_PROFILES.map((p) => (
                    <button aria-pressed={Boolean(riskProfile === p.id)}
                      key={p.id}
                      type="button"
                      onClick={() => onSelectRiskProfile(p.id)}
                      className={`min-h-11 p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                        riskProfile === p.id
                          ? 'bg-accent text-sur-accent border-accent'
                          : 'bg-fond text-texte border-bordure hover:border-bordure-champ'
                      }`}
                    >
                      <div className="text-xs font-semibold">{p.label}</div>
                      <div
                        className={`text-[11px] ${
                          riskProfile === p.id ? 'text-texte-doux' : 'text-texte-doux'
                        }`}
                      >
                        {p.hint}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Available Cash */}
              <div className="p-4 bg-surface/60 border border-bordure rounded-2xl space-y-2">
                <label
                  htmlFor="hub-cash-cad"
                  className="block text-xs font-semibold text-texte"
                >
                  Liquidités additionnelles à investir ($ CAD)
                </label>
                <input
                  id="hub-cash-cad"
                  type="number"
                  min={0}
                  step={250}
                  value={cashInput}
                  onChange={(e) => handleCashChange(e.target.value)}
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs font-mono tabular-nums bg-fond border border-bordure rounded-lg text-texte outline-hidden focus-ring focus:border-bordure-champ"
                />
              </div>

              {/* Economic Climate */}
              <div className="p-4 bg-surface/60 border border-bordure rounded-2xl space-y-2">
                <label
                  htmlFor="hub-macro-select"
                  className="block text-xs font-semibold text-texte"
                >
                  Climat économique &amp; Taux Banque du Canada
                </label>
                <select
                  id="hub-macro-select"
                  value={regimeId}
                  onChange={(e) => onSelectRegime(e.target.value as RegimeId)}
                  className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-fond border border-bordure rounded-lg text-texte outline-hidden focus-ring focus:border-bordure-champ"
                >
                  {MARKET_REGIMES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} (Taux BdC {r.indicators.centralBankRatePct} % · IPC{' '}
                      {r.indicators.inflationPct} %)
                    </option>
                  ))}
                </select>
              </div>

              {/* Live Price Feed Refresh */}
              {onRefreshVerifiedPrices && (
                <div className="p-4 bg-surface/60 border border-bordure rounded-2xl flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold text-texte">
                      Flux de marché certifiés ($ CAD)
                    </div>
                    <div className="text-[11px] text-texte-doux">
                      {verifiedFeedStatus ?? 'Banque du Canada · Yahoo Finance · CoinGecko'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onRefreshVerifiedPrices}
                    disabled={isRefreshingVerified}
                    className="min-h-11 min-w-11 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-texte bg-fond hover:bg-surface-douce border border-bordure-champ rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isRefreshingVerified ? 'animate-spin' : ''}`}
                    />
                    <span>Actualiser</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
