/**
 * @vitest-environment jsdom
 *
 * Tests d'intégration profonde Valoria × FinanceAI v4.0 :
 * - Parsing des liens profonds `pendingFocus` (`asset:`, `tab:`, `lab:`)
 * - Calcul des signaux rapides `computeValoriaQuickSignals` ($ CAD) pour `Placements` et `Accueil`
 * - Pont fiscalité QC/CA (`optimizeAssetLocation` avec salaires mensuels × 12) + pont `Futur` (`no-fake-data`)
 * - Écriture confirmée vs annulée dans `state.assets` / `investmentAccounts` / `investmentTransactions`
 * - Action assistant Gemini `consulter_diagnostic_valoria` & Palette `Ctrl+K` (`makeValoriaCommandActions`)
 * - Accessibilité `vitest-axe` (`ApplyValoriaToPortfolioModal` & `ValoriaFinanceAiHubCard`)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type * as AxeCore from 'axe-core';
import { Tab } from '../../types';
import { useFinanceStore } from '../../store/useFinanceStore';
import { TEST_ASSETS } from '../fixtures/testAssets';
import { INITIAL_CONFIG } from '../../constants';
import {
  applyValoriaOrdersToRealPortfolio,
  buildValoriaAssistantDiagnostic,
  buildValoriaFiscalAndFutureContext,
  computeValoriaQuickSignals,
  parseValoriaFocusSection,
  suggestOptimalCanadianAccount,
} from '../../services/valoria/valoriaIntegration';
import { ApplyValoriaToPortfolioModal } from '../../components/valoria/ApplyValoriaToPortfolioModal';
import { ValoriaFinanceAiHubCard } from '../../components/valoria/ValoriaFinanceAiHubCard';
import { executerAction } from '../../services/assistant/actionRegistry';
import { makeValoriaCommandActions } from '../../components/ui/commandPaletteActions';

const initialStore = useFinanceStore.getState();

async function assertNoSeriousAxeViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container);
  const serious = (results.violations || []).filter(
    (v: AxeCore.Result) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
}

describe('Valoria × FinanceAI — Intégration profonde', () => {
  beforeEach(() => {
    localStorage.clear();
    useFinanceStore.setState(initialStore, true);
  });

  it('parseValoriaFocusSection décode les cibles asset:, tab: et lab:', () => {
    expect(parseValoriaFocusSection('asset:VFV.TO')).toEqual({
      tab: 'portfolio',
      lab: 'unified',
      assetId: 'VFV',
    });
    expect(parseValoriaFocusSection('tab:recommendations')).toEqual({
      tab: 'recommendations',
      lab: 'unified',
    });
    expect(parseValoriaFocusSection('lab:montecarlo')).toEqual({
      lab: 'montecarlo',
    });
    expect(parseValoriaFocusSection('invalide')).toEqual({});
    expect(parseValoriaFocusSection(null)).toEqual({});
  });

  it('computeValoriaQuickSignals et suggestOptimalCanadianAccount produisent des signaux en $ CAD cohérents', () => {
    const signals = computeValoriaQuickSignals({
      assets: TEST_ASSETS,
      watchlistSymbols: ['GOOGL', 'RY.TO'],
      fxRates: { USD: 1.38, EUR: 1.49, CAD: 1 },
      riskProfile: 'equilibre',
    });

    expect(signals['VFV.TO']).toBeDefined();
    expect(signals['VFV.TO'].score100).toBeGreaterThanOrEqual(1);
    expect(signals['VFV.TO'].score100).toBeLessThanOrEqual(99);
    expect(['Renforcer', 'Conserver', 'Alléger']).toContain(signals['VFV.TO'].labelCourt);
    expect(signals.GOOGL).toBeDefined();

    expect(suggestOptimalCanadianAccount('MSFT', undefined, 'US')).toBe('REER');
    expect(suggestOptimalCanadianAccount('VFV.TO')).toBe('CELI');
    expect(suggestOptimalCanadianAccount('BTC-CAD')).toBe('CRYPTO');
    expect(suggestOptimalCanadianAccount('RY.TO', undefined, 'CA')).toBe('CELI');
    // XBB.PA (actions monde EUR), XEQT.TO et VEQT.TO sont des ETF actions, JAMAIS des obligations REER
    expect(suggestOptimalCanadianAccount('XBB.PA', undefined, 'EUROPE')).toBe('NON-ENREG');
    expect(suggestOptimalCanadianAccount('XBB.PA', undefined, 'EUROPE')).not.toBe('REER');
    expect(suggestOptimalCanadianAccount('XEQT.TO')).toBe('CELI');
    expect(suggestOptimalCanadianAccount('VEQT.TO')).toBe('CELI');
    // Véritables FNB obligataires canadiens -> REER prioritaire
    expect(suggestOptimalCanadianAccount('XBB.TO')).toBe('REER');
    expect(suggestOptimalCanadianAccount('ZAG.TO')).toBe('REER');
  });

  it('buildValoriaFiscalAndFutureContext respecte salaires × 12 et no-fake-data si projection absente', () => {
    const configAvecRevenu = structuredClone(INITIAL_CONFIG);
    configAvecRevenu.users[0].grossSalary = 6500;
    configAvecRevenu.users[1].grossSalary = 4500;

    const sansProjection = buildValoriaFiscalAndFutureContext({
      assets: [
        {
          symbol: 'VFV.TO',
          name: 'Vanguard S&P 500',
          quantity: 100,
          currency: 'CAD',
          currentPrice: 135,
          performance: 10,
          dateBought: '2024-01-10',
          accountType: 'CELI',
        },
      ],
      fxRates: { CAD: 1, USD: 1.38 },
      config: configAvecRevenu,
      lastProjection: null,
      year: 2026,
    });

    expect(sansProjection.annualGrossIncomeCad).toBe(132000);
    expect(sansProjection.futureAvailable).toBe(false);
    expect(sansProjection.projected5yNetWorthCad).toBeNull();
    expect(sansProjection.totalAnnualTaxLossCad).not.toBeNull();

    const avecProjection = buildValoriaFiscalAndFutureContext({
      assets: [],
      fxRates: { CAD: 1 },
      config: configAvecRevenu,
      lastProjection: {
        chartData: [
          { monthIndex: 0, year: 2026, age: 35, isRetired: false, NetWorth: 180000 } as never,
          { monthIndex: 60, year: 2031, age: 40, isRetired: false, NetWorth: 345000 } as never,
          { monthIndex: 300, year: 2051, age: 60, isRetired: true, NetWorth: 1120000 } as never,
        ],
      } as never,
      year: 2026,
    });

    expect(avecProjection.futureAvailable).toBe(true);
    expect(avecProjection.projected5yYear).toBe(2031);
    expect(avecProjection.projected5yNetWorthCad).toBe(345000);
    expect(avecProjection.projectedRetirementAge).toBe(60);
    expect(avecProjection.projectedRetirementNetWorthCad).toBe(1120000);
  });

  it('applyValoriaOrdersToRealPortfolio crée/met à jour actifs, comptes et transactions courtier sur confirmation', () => {
    const out = applyValoriaOrdersToRealPortfolio({
      assets: [
        {
          symbol: 'XEQT.TO',
          name: 'iShares XEQT',
          quantity: 100,
          currency: 'CAD',
          currentPrice: 34,
          performance: 8,
          dateBought: '2024-01-01',
          accountType: 'CELI',
          owner: 'user1',
        },
      ],
      investmentAccounts: [],
      investmentTransactions: [],
      orders: [
        {
          symbol: 'XEQT.TO',
          name: 'iShares XEQT',
          deltaCad: 3500,
          spotPriceCad: 35,
          suggestedAccount: 'CELI',
          accountType: 'CELI',
          owner: 'user1',
        },
        {
          symbol: 'RY.TO',
          name: 'Banque Royale',
          deltaCad: 1700,
          spotPriceCad: 170,
          suggestedAccount: 'REER',
          accountType: 'REER',
          owner: 'user1',
        },
      ],
      fxRates: { CAD: 1 },
      dateIso: '2026-11-18',
    });

    expect(out.appliedCount).toBe(2);
    expect(out.assets).toHaveLength(2);
    expect(out.assets[0].quantity).toBeCloseTo(200, 2);
    expect(out.assets[0].purchases).toHaveLength(1);
    expect(out.assets[1].symbol).toBe('RY.TO');
    expect(out.assets[1].accountType).toBe('REER');
    expect(out.investmentAccounts.map((a) => a.type)).toEqual(['CELI', 'REER']);
    expect(out.investmentTransactions).toHaveLength(2);
    expect(out.investmentTransactions[0].type).toBe('BUY');
  });

  it('consulter_diagnostic_valoria fonctionne via executerAction et gère un portefeuille vide honnêtement', async () => {
    useFinanceStore.setState({
      assets: structuredClone(TEST_ASSETS),
      valoriaWatchlist: ['GOOGL'],
      fxRates: { USD: 1.38, EUR: 1.49, CAD: 1 },
    });

    const diag = buildValoriaAssistantDiagnostic(useFinanceStore.getState(), 2026, 'VFV.TO');
    expect(diag.portefeuilleVide).toBe(false);
    expect(Array.isArray(diag.positions)).toBe(true);
    expect(diag.titreDemande).toBeTruthy();

    const actionRes = await executerAction('consulter_diagnostic_valoria', { symbole: 'GOOGL' });
    expect(actionRes.erreur).toBe(false);
    const payload = actionRes.resultat.pourModele as { donnees?: { listeSuivie?: string[] } };
    expect(payload.donnees?.listeSuivie).toContain('GOOGL');
  });

  it('makeValoriaCommandActions génère les raccourcis Ctrl+K pour sections, labos et titres', () => {
    const navSpy = vi.fn();
    const actions = makeValoriaCommandActions(navSpy, [{ symbol: 'VFV.TO', name: 'S&P 500' }], ['RY.TO']);
    expect(actions.length).toBeGreaterThanOrEqual(8);

    const vfvAction = actions.find((a) => a.id === 'valoria:asset:VFV.TO');
    expect(vfvAction).toBeDefined();
    vfvAction?.onSelect();
    expect(navSpy).toHaveBeenCalledWith(Tab.INVESTMENTS, 'asset:VFV.TO');
  });

  it('ApplyValoriaToPortfolioModal & ValoriaFinanceAiHubCard : confirmation écrite vs annulation vierge et zéro violation Axe', async () => {
    useFinanceStore.setState({
      assets: [],
      investmentAccounts: [],
      investmentTransactions: [],
      fxRates: { CAD: 1, USD: 1.38, EUR: 1.49 },
      isPrivacyMode: false,
    });

    const onApplied = vi.fn();
    const onClose = vi.fn();

    const { container: hubContainer } = render(
      <ValoriaFinanceAiHubCard
        valoria5yMedianCad={125000}
        expectedCagrBeforePct={7.4}
        expectedCagrAfterPct={9.2}
      />
    );
    expect(hubContainer.textContent).toContain('Emplacement fiscal QC / Canada');
    await assertNoSeriousAxeViolations(hubContainer);

    const { rerender } = render(
      <ApplyValoriaToPortfolioModal
        isOpen={true}
        onClose={onClose}
        orders={[
          {
            symbol: 'XEQT.TO',
            name: 'iShares XEQT',
            deltaCad: 3500,
            spotPriceCad: 35,
            suggestedAccount: 'CELI',
          },
        ]}
        onApplied={onApplied}
      />
    );

    await assertNoSeriousAxeViolations(document.body);

    // Annuler laisse state.assets à []
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(useFinanceStore.getState().assets).toEqual([]);

    // Confirmer met à jour state.assets et investmentTransactions
    rerender(
      <ApplyValoriaToPortfolioModal
        isOpen={true}
        onClose={onClose}
        orders={[
          {
            symbol: 'XEQT.TO',
            name: 'iShares XEQT',
            deltaCad: 3500,
            spotPriceCad: 35,
            suggestedAccount: 'CELI',
          },
        ]}
        onApplied={onApplied}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Confirmer dans Placements/i }));
    expect(onApplied).toHaveBeenCalledWith(1);
    expect(useFinanceStore.getState().assets).toHaveLength(1);
    expect(useFinanceStore.getState().assets[0].symbol).toBe('XEQT.TO');
    expect(useFinanceStore.getState().investmentTransactions).toHaveLength(1);
  });
});
