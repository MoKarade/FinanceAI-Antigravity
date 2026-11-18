import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { PrivateAmount } from '../ui/PrivateAmount';
import { showToast } from '../ui/Toast';
import { useFinanceStore } from '../../store/useFinanceStore';
import { isCoupleMode } from '../../services/couple/netWorthByOwner';
import { todayIsoLocal } from '../../services/projection/dailyRefine';
import {
  applyValoriaOrdersToRealPortfolio,
  type ValoriaApplyOrderCandidate,
  type ValoriaRealOrderExecution,
} from '../../services/valoria/valoriaIntegration';
import { formatCad, formatSignedEur } from '../../services/valoria/valoriaFormatters';
import type { AssetOwner, RegisteredAccountType } from '../../types';

const ACCOUNT_OPTIONS: ReadonlyArray<{ value: RegisteredAccountType; label: string }> = [
  { value: 'CELI', label: 'CELI (libre d’impôt)' },
  { value: 'CELIAPP', label: 'CELIAPP (première propriété)' },
  { value: 'REER', label: 'REER (déductible / traité US)' },
  { value: 'REEE', label: 'REEE (études enfants)' },
  { value: 'NON-ENREG', label: 'Non-enregistré (CTO)' },
  { value: 'CRYPTO', label: 'Cryptoactifs' },
];

interface ApplyValoriaToPortfolioModalProps {
  isOpen: boolean;
  onClose: () => void;
  orders: ReadonlyArray<ValoriaApplyOrderCandidate>;
  onApplied: (appliedCount: number) => void;
}

/**
 * Modale de confirmation explicite avant toute écriture d'un ordre simulé ou recommandé
 * Valoria dans les tranches réelles `assets`, `investmentAccounts` et `investmentTransactions`.
 */
export const ApplyValoriaToPortfolioModal: React.FC<ApplyValoriaToPortfolioModalProps> = ({
  isOpen,
  onClose,
  orders,
  onApplied,
}) => {
  const assets = useFinanceStore((s) => s.assets);
  const investmentAccounts = useFinanceStore((s) => s.investmentAccounts);
  const investmentTransactions = useFinanceStore((s) => s.investmentTransactions);
  const fxRates = useFinanceStore((s) => s.fxRates);
  const config = useFinanceStore((s) => s.config);
  const setAppState = useFinanceStore((s) => s.setAppState);

  const couple = isCoupleMode(config?.users);
  const user1Name = config?.users?.[0]?.name || 'Conjoint 1';
  const user2Name = config?.users?.[1]?.name || 'Conjoint 2';

  const [accountChoices, setAccountChoices] = useState<Record<number, RegisteredAccountType>>({});
  const [ownerChoice, setOwnerChoice] = useState<AssetOwner>('user1');

  useEffect(() => {
    if (!isOpen) return;
    const defaults: Record<number, RegisteredAccountType> = {};
    orders.forEach((o, idx) => {
      defaults[idx] = o.suggestedAccount;
    });
    setAccountChoices(defaults);
    setOwnerChoice('user1');
  }, [isOpen, orders]);

  const handleConfirm = () => {
    if (orders.length === 0) {
      onClose();
      return;
    }

    const executions: ValoriaRealOrderExecution[] = orders.map((o, idx) => {
      const accountType = accountChoices[idx] ?? o.suggestedAccount;
      const effectiveOwner: AssetOwner =
        !couple || (ownerChoice === 'joint' && accountType !== 'NON-ENREG' && accountType !== 'CRYPTO')
          ? ownerChoice === 'joint'
            ? 'user1'
            : ownerChoice
          : ownerChoice;
      return {
        ...o,
        accountType,
        owner: couple ? effectiveOwner : 'user1',
      };
    });

    const result = applyValoriaOrdersToRealPortfolio({
      assets,
      investmentAccounts,
      investmentTransactions,
      orders: executions,
      fxRates,
      dateIso: todayIsoLocal(),
    });

    if (result.appliedCount > 0) {
      setAppState({
        assets: result.assets,
        investmentAccounts: result.investmentAccounts,
        investmentTransactions: result.investmentTransactions,
      });
      showToast(
        `${result.appliedCount} ordre(s) Valoria enregistré(s) dans Placements.`,
        'success'
      );
      onApplied(result.appliedCount);
    } else {
      showToast('Aucun ordre applicable sur le portefeuille réel.', 'info');
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Appliquer à mes Placements réels"
      subtitle="Révisez le régime enregistré et l’impact en $ CAD avant d’enregistrer dans votre dossier FinanceAI."
      size="lg"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 px-4 py-2 text-xs font-medium text-texte bg-surface hover:bg-surface-douce border border-bordure-champ rounded-xl transition-colors focus-ring cursor-pointer"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={orders.length === 0}
            className="min-h-11 px-4 py-2 text-xs font-semibold text-sur-accent bg-accent hover:bg-accent-fonce rounded-xl transition-colors focus-ring disabled:opacity-50 cursor-pointer"
          >
            Confirmer dans Placements ({orders.length})
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="p-3 rounded-xl bg-alerte-fond border border-bordure text-xs text-alerte-texte">
          Tant que vous ne cliquez pas sur Confirmer, vos positions réelles restent intactes. Une fois confirmée, chaque opération est ajoutée à votre onglet Placements et au journal des transactions courtier.
        </div>

        {couple && (
          <div className="space-y-1.5">
            <label
              htmlFor="valoria-apply-owner"
              className="block text-xs font-medium text-texte-doux"
            >
              Propriétaire du compte enregistré
            </label>
            <select
              id="valoria-apply-owner"
              value={ownerChoice}
              onChange={(e) => setOwnerChoice(e.target.value as AssetOwner)}
              className="min-h-11 w-full px-3 py-2 text-xs bg-fond border border-bordure-champ rounded-xl text-texte outline-hidden focus-ring"
            >
              <option value="user1">{user1Name}</option>
              <option value="user2">{user2Name}</option>
              <option value="joint">Compte conjoint (Non-enregistré / Crypto)</option>
            </select>
          </div>
        )}

        <div className="divide-y divide-bordure border border-bordure rounded-xl bg-fond/60">
          {orders.map((order, idx) => {
            const isBuy = order.deltaCad >= 0;
            const qty = Math.abs(order.deltaCad) / Math.max(0.01, order.spotPriceCad);
            const selectedAcc = accountChoices[idx] ?? order.suggestedAccount;
            return (
              <div
                key={`apply-order-${order.symbol}-${idx}`}
                className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold ${
                        isBuy ? 'bg-succes-fond text-succes-texte' : 'bg-erreur-fond text-erreur-texte'
                      }`}
                    >
                      {isBuy ? 'ACHAT' : 'VENTE'}
                    </span>
                    <span className="font-mono text-sm font-bold text-texte">
                      {order.symbol}
                    </span>
                    <span className="text-xs text-texte-doux truncate">{order.name}</span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-texte-doux flex flex-wrap items-center gap-2">
                    <PrivateAmount className={isBuy ? 'text-succes-texte font-semibold' : 'text-erreur-texte font-semibold'}>
                      {formatSignedEur(order.deltaCad, 0)}
                    </PrivateAmount>
                    <span>·</span>
                    <span>
                      ~<PrivateAmount>{qty.toFixed(2)}</PrivateAmount> parts à{' '}
                      {/* MONTANT-PUBLIC : cours unitaire de marché */}
                      {formatCad(order.spotPriceCad, 2)}
                    </span>
                  </div>
                </div>

                <div className="sm:w-56 shrink-0">
                  <label
                    htmlFor={`valoria-apply-acc-${idx}`}
                    className="sr-only"
                  >
                    Compte fiscal pour {order.symbol}
                  </label>
                  <select
                    id={`valoria-apply-acc-${idx}`}
                    value={selectedAcc}
                    onChange={(e) =>
                      setAccountChoices((prev) => ({
                        ...prev,
                        [idx]: e.target.value as RegisteredAccountType,
                      }))
                    }
                    className="min-h-11 w-full px-3 py-2 text-xs bg-surface border border-bordure-champ rounded-xl text-texte outline-hidden focus-ring"
                  >
                    {ACCOUNT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
};
