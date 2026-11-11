/**
 * Tests Unitaires Approfondis — Portefeuilles, PBR Réel & Asset Location (F13 à F16)
 *
 * Modules testés :
 * - services/assetFundamentals.ts (Normes IQPF 2026, Fisher, MER, table FNB, résolution)
 * - services/projection/portfolioAnalytics.ts (ACB, Retenue IRS 15 %, Asset Location, REEE PSE vs PAE)
 * - services/projection/startingBalancesFromAssets.ts (derivePortfolioStartingACBs)
 * - utils/tax.ts (computeTaxableCapitalGain)
 */

import { describe, it, expect } from 'vitest';
import {
    IQPF_2026_INFLATION,
    IQPF_2026_EXPECTED_RETURNS,
    IQPF_2026_VOLATILITY,
    CANADIAN_US_BENCHMARK_ETFS,
    computeRealReturn,
    computeNetReturn,
    computePortfolioWeightedReturn,
    resolveAssetFundamental,
} from '../../services/assetFundamentals';
import {
    computeInitialACB,
    computeInitialAcbCad,
    computeAnnualTaxDrag,
    computeAssetLocationTaxDrag,
    recommendOptimalAssetLocation,
    computeReeeBalances,
    computeReeeWithdrawal,
    computeReeeStudentTax,
    computeReeeClosingSettlement,
} from '../../services/projection/portfolioAnalytics';
import { derivePortfolioStartingACBs } from '../../services/projection/startingBalancesFromAssets';
import { computeTaxableCapitalGain, CAPITAL_GAINS_INCLUSION_STANDARD } from '../../utils/tax';
import type { Asset } from '../../types';

describe('F13 — services/assetFundamentals.ts : Normes de projection IQPF 2026', () => {
    it('Rendements nominaux espérés conformes à la grille IQPF 2026', () => {
        expect(IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY).toBe(0.064);
        expect(IQPF_2026_EXPECTED_RETURNS.US_EQUITY).toBe(0.065);
        expect(IQPF_2026_EXPECTED_RETURNS.INT_EQUITY).toBe(0.066);
        expect(IQPF_2026_EXPECTED_RETURNS.EM_EQUITY).toBe(0.077);
        expect(IQPF_2026_EXPECTED_RETURNS.CAN_BOND).toBe(0.039);
        expect(IQPF_2026_EXPECTED_RETURNS.CASH).toBe(0.027);
    });

    it('Inflation de référence fixée à 2,00 %', () => {
        expect(IQPF_2026_INFLATION).toBe(0.020);
    });

    it('Volatilités annuelles conformes à la hiérarchie de risque', () => {
        expect(IQPF_2026_VOLATILITY.CASH).toBe(0.015);
        expect(IQPF_2026_VOLATILITY.CAN_BOND).toBe(0.065);
        expect(IQPF_2026_VOLATILITY.CAN_EQUITY).toBe(0.145);
        expect(IQPF_2026_VOLATILITY.US_EQUITY).toBe(0.152);
        expect(IQPF_2026_VOLATILITY.INT_EQUITY).toBe(0.165);
        expect(IQPF_2026_VOLATILITY.EM_EQUITY).toBe(0.210);

        expect(IQPF_2026_VOLATILITY.CAN_BOND).toBeLessThan(IQPF_2026_VOLATILITY.CAN_EQUITY);
        expect(IQPF_2026_VOLATILITY.CAN_EQUITY).toBeLessThan(IQPF_2026_VOLATILITY.EM_EQUITY);
    });

    it('computeRealReturn applique la formule de Fisher exacte (1+r)/(1+i)-1', () => {
        // Actions canadiennes : (1 + 0.064) / (1 + 0.020) - 1 = 0.043137
        const realCanEq = computeRealReturn(IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY);
        expect(realCanEq).toBeCloseTo(0.043137, 5);

        // Marché monétaire : (1 + 0.027) / (1 + 0.020) - 1 = 0.006863
        const realCash = computeRealReturn(IQPF_2026_EXPECTED_RETURNS.CASH);
        expect(realCash).toBeCloseTo(0.006863, 5);

        // Cas nominal négatif ou limite
        expect(computeRealReturn(-1)).toBe(-1);
        expect(computeRealReturn(0)).toBeCloseTo(-0.0196, 4);
    });

    it('computeNetReturn soustrait le RFG (MER) sans produire de RFG négatif', () => {
        const netVfv = computeNetReturn(0.065, 0.0009); // 6.5 % brut - 0.09 % RFG
        expect(netVfv).toBeCloseTo(0.0641, 4);

        const netMutual = computeNetReturn(0.065, 0.0250); // 6.5 % brut - 2.50 % RFG
        expect(netMutual).toBeCloseTo(0.0400, 4);

        // RFG négatif ignoré
        expect(computeNetReturn(0.05, -0.01)).toBe(0.05);
    });

    it('computePortfolioWeightedReturn calcule la moyenne pondérée sans division par zéro', () => {
        const holdings = [
            { balance: 60000, expectedReturn: 0.064 },
            { balance: 40000, expectedReturn: 0.039 },
        ];
        const weighted = computePortfolioWeightedReturn(holdings);
        // 0.60 * 6.4 % + 0.40 * 3.9 % = 3.84 % + 1.56 % = 5.40 %
        expect(weighted).toBeCloseTo(0.054, 5);

        // Portefeuille vide ou solde total nul
        expect(computePortfolioWeightedReturn([])).toBe(0);
        expect(computePortfolioWeightedReturn([{ balance: 0, expectedReturn: 0.07 }])).toBe(0);
    });

    it('CANADIAN_US_BENCHMARK_ETFS contient les FNB majeurs avec métadonnées exactes', () => {
        expect(CANADIAN_US_BENCHMARK_ETFS.XIC).toBeDefined();
        expect(CANADIAN_US_BENCHMARK_ETFS.XIC.eligibleCanadianDivFraction).toBe(1.0);
        expect(CANADIAN_US_BENCHMARK_ETFS.VOO).toBeDefined();
        expect(CANADIAN_US_BENCHMARK_ETFS.VOO.usForeignDivFraction).toBe(1.0);
        expect(CANADIAN_US_BENCHMARK_ETFS.ZAG).toBeDefined();
        expect(CANADIAN_US_BENCHMARK_ETFS.ZAG.interestFraction).toBe(1.0);
        expect(CANADIAN_US_BENCHMARK_ETFS['CASH.TO']).toBeDefined();
        expect(CANADIAN_US_BENCHMARK_ETFS.XEQT).toBeDefined();
    });

    it('resolveAssetFundamental résout par symbole ou déduit une classe calibrée', () => {
        const xic = resolveAssetFundamental('xic');
        expect(xic.symbol).toBe('XIC');
        expect(xic.assetClass).toBe('CAN_EQUITY');

        const vfv = resolveAssetFundamental('VFV.TO');
        expect(vfv.symbol).toBe('VFV');
        expect(vfv.assetClass).toBe('US_EQUITY');

        const bondUnknown = resolveAssetFundamental('MY-BOND-FUND');
        expect(bondUnknown.assetClass).toBe('CAN_BOND');

        const cadUnknown = resolveAssetFundamental('STOCK.TO');
        expect(cadUnknown.assetClass).toBe('CAN_EQUITY');

        const usUnknown = resolveAssetFundamental('AAPL');
        expect(usUnknown.assetClass).toBe('US_EQUITY');
    });
});

describe('F14 — Qualification des dividendes & Retenue IRS 15 % (Article XXI)', () => {
    it('computeAnnualTaxDrag : exemption totale de retenue IRS 15 % en REER', () => {
        const drag = computeAnnualTaxDrag({
            symbol: 'VOO',
            accountType: 'REER',
            currentValueCad: 100000,
            dividendYield: 0.015,
            usForeignDivFraction: 1.0,
        });
        expect(drag.irsWithholdingCad).toBe(0);
        expect(drag.netDividendCad).toBe(1500);
        expect(drag.netYield).toBe(0.015);
        expect(drag.taxDragRate).toBe(0);
    });

    it('computeAnnualTaxDrag : perte sèche non récupérable de 15 % en CELI et REEE', () => {
        const dragCeli = computeAnnualTaxDrag({
            symbol: 'VOO',
            accountType: 'CELI',
            currentValueCad: 100000,
            dividendYield: 0.015,
            usForeignDivFraction: 1.0,
        });
        expect(dragCeli.irsWithholdingCad).toBe(225); // 100 000 * 1.5 % * 15 %
        expect(dragCeli.netDividendCad).toBe(1275);
        expect(dragCeli.netYield).toBeCloseTo(0.01275, 5);
        expect(dragCeli.taxDragRate).toBeCloseTo(0.00225, 5);

        const dragReee = computeAnnualTaxDrag({
            symbol: 'VFV',
            accountType: 'REEE',
            currentValueCad: 50000,
            dividendYield: 0.02,
            usForeignDivFraction: 1.0,
        });
        expect(dragReee.irsWithholdingCad).toBe(150); // 50 000 * 2.0 % * 15 %
    });

    it('computeAnnualTaxDrag : zéro retenue sur titres sans dividendes ou sans composante US', () => {
        const dragXic = computeAnnualTaxDrag({
            symbol: 'XIC',
            accountType: 'CELI',
            currentValueCad: 80000,
            dividendYield: 0.028,
            usForeignDivFraction: 0,
        });
        expect(dragXic.irsWithholdingCad).toBe(0);

        const dragGrowth = computeAnnualTaxDrag({
            symbol: 'TECH',
            accountType: 'CELI',
            currentValueCad: 50000,
            dividendYield: 0,
            usForeignDivFraction: 1.0,
        });
        expect(dragGrowth.irsWithholdingCad).toBe(0);
    });
});

describe('F15 — Initialisation du PBR réel (ACB) au Mois Zéro', () => {
    it('computeInitialACB calcule la somme des achats en CAD', () => {
        const purchases = [
            { date: '2023-01-01', shares: 50, price: 100, currency: 'CAD' }, // 5 000 $
            { date: '2024-01-01', shares: 50, price: 120, currency: 'CAD' }, // 6 000 $
        ];
        expect(computeInitialACB(purchases)).toBe(11000);
        expect(computeInitialAcbCad(purchases)).toBe(11000);
    });

    it('computeInitialACB convertit les achats en USD avec le taux de change', () => {
        const purchasesUsd = [
            { date: '2023-05-01', shares: 10, price: 200, currency: 'USD', exchangeRateToCad: 1.35 }, // 2000 USD * 1.35 = 2700 CAD
        ];
        expect(computeInitialACB(purchasesUsd)).toBeCloseTo(2700, 2);
    });

    it('computeInitialACB replie sur le solde si la liste d\'achats est vide', () => {
        expect(computeInitialACB([], 25000)).toBe(25000);
        expect(computeInitialACB(undefined, 18000)).toBe(18000);
        expect(computeInitialACB([], 0)).toBe(0);
    });

    it('derivePortfolioStartingACBs dérive indépendamment nonRegACB et cryptoACB', () => {
        const assets: Asset[] = [
            {
                symbol: 'XIC',
                name: 'iShares Core S&P/TSX',
                performance: 0,
                accountType: 'NON-ENREG',
                quantity: 100,
                currentPrice: 40, // 4 000 $ valeur
                currency: 'CAD',
                dateBought: '2023-01-01',
                purchases: [{ date: '2023-01-01', quantity: 100, price: 30 }], // 3 000 $ coût
            },
            {
                symbol: 'BTC',
                name: 'Bitcoin',
                performance: 0,
                accountType: 'CRYPTO',
                quantity: 0.1,
                currentPrice: 80000, // 8 000 $ valeur
                currency: 'CAD',
                dateBought: '2024-01-01',
                purchases: [{ date: '2024-01-01', quantity: 0.1, price: 60000 }], // 6 000 $ coût
            },
            {
                symbol: 'VEQT',
                name: 'Vanguard All-Equity',
                performance: 0,
                accountType: 'CELI',
                quantity: 500,
                currentPrice: 40,
                currency: 'CAD',
                dateBought: '2022-01-01',
                purchases: [{ date: '2022-01-01', quantity: 500, price: 30 }],
            },
        ];

        const startingACBs = derivePortfolioStartingACBs(assets, { USD: 1.35 }, { nonReg: 5000, crypto: 8000 });
        // nonRegAcbSum = 3 000 $ + 1 000 $ encaisse non allouée (5 000 $ cible - 4 000 $ titres) = 4 000 $
        expect(startingACBs.nonRegACB).toBe(4000);
        // cryptoAcbSum = 6 000 $
        expect(startingACBs.cryptoACB).toBe(6000);
    });

    it('computeTaxableCapitalGain applique le taux standard uniforme de 50 %', () => {
        expect(computeTaxableCapitalGain(10000)).toBe(5000);
        expect(computeTaxableCapitalGain(0)).toBe(0);
        expect(computeTaxableCapitalGain(-5000)).toBe(0);
        expect(CAPITAL_GAINS_INCLUSION_STANDARD).toBe(0.50);

        // Option bipalier (50 % <= 250k$, 66.67 % > 250k$)
        const gain350k = computeTaxableCapitalGain(350000, 1, true, 250000);
        // 250 000 * 0.50 + 100 000 * (2/3) = 125 000 + 66 666.67 = 191 666.67
        expect(gain350k).toBeCloseTo(191666.67, 1);
    });
});

describe('F16 — Asset Location optimale & REEE à double poche PSE vs PAE', () => {
    it('computeAssetLocationTaxDrag évalue correctement le frottement par compte', () => {
        const usAsset = CANADIAN_US_BENCHMARK_ETFS.VOO;
        // En REER : 0 drag
        expect(computeAssetLocationTaxDrag('REER', usAsset, 0.40)).toBe(0);
        // En CELI : 1.5 % yield * 1.0 usFraction * 15 % = 0.225 %
        expect(computeAssetLocationTaxDrag('CELI', usAsset, 0.40)).toBeCloseTo(0.00225, 5);

        const bondAsset = CANADIAN_US_BENCHMARK_ETFS.ZAG;
        // En REER : 0 drag
        expect(computeAssetLocationTaxDrag('REER', bondAsset, 0.40)).toBe(0);
        // En NonReg : 3.9 % yield * 100 % intérêt * 40 % marginal = 1.56 %
        expect(computeAssetLocationTaxDrag('NON-ENREG', bondAsset, 0.40)).toBeCloseTo(0.0156, 4);
    });

    it('recommendOptimalAssetLocation oriente chaque classe vers le compte fiscalement optimal', () => {
        const recoBonds = recommendOptimalAssetLocation('CAN_BOND');
        expect(recoBonds.recommendedAccount).toBe('REER');

        const recoUs = recommendOptimalAssetLocation('US_EQUITY');
        expect(recoUs.recommendedAccount).toBe('REER');

        const recoCanEq = recommendOptimalAssetLocation('CAN_EQUITY');
        expect(recoCanEq.recommendedAccount).toBe('CELI');

        const recoInt = recommendOptimalAssetLocation('INT_EQUITY');
        expect(recoInt.recommendedAccount).toBe('CELI');
    });

    it('computeReeeBalances compartimente PSE et PAE', () => {
        const balances = computeReeeBalances(30000, 7200 + 3600, 15000);
        expect(balances.pseBalance).toBe(30000);
        expect(balances.paeBalance).toBe(25800);
        expect(balances.total).toBe(55800);
    });

    it('computeReeeWithdrawal vide en priorité la poche PAE avant la poche PSE', () => {
        // Solde initial : PSE 20 000 $, PAE 10 000 $
        const w1 = computeReeeWithdrawal(6000, 20000, 10000);
        expect(w1.withdrawalPae).toBe(6000);
        expect(w1.withdrawalPse).toBe(0);
        expect(w1.newPaeBalance).toBe(4000);
        expect(w1.newPseBalance).toBe(20000);

        // Retrait qui dépasse le PAE restant
        const w2 = computeReeeWithdrawal(8000, 20000, 4000);
        expect(w2.withdrawalPae).toBe(4000);
        expect(w2.withdrawalPse).toBe(4000);
        expect(w2.newPaeBalance).toBe(0);
        expect(w2.newPseBalance).toBe(16000);
    });

    it('computeReeeStudentTax neutralise les retraits PAE sous le BPA de l\'étudiant', () => {
        // Retrait PAE de 12 000 $ : sous le BPA fédéral (16 452 $) et QC (18 952 $) -> 0 $ d'impôt
        const taxZero = computeReeeStudentTax(12000, 0);
        expect(taxZero.studentTotalTax).toBe(0);

        // Retrait PAE de 25 000 $ : excédent imposable au palier de 14 %
        const taxHigh = computeReeeStudentTax(25000, 0);
        expect(taxHigh.studentFedTax).toBeGreaterThan(0);
        expect(taxHigh.studentQcTax).toBeGreaterThan(0);
        expect(taxHigh.studentTotalTax).toBeGreaterThan(0);
    });

    it('computeReeeClosingSettlement règle la fermeture à 25 ans avec remboursement des subventions et PSE franc d\'impôt', () => {
        // Solde restant : PSE 20 000 $, PAE 9 000 $ (dont 4 000 $ de subventions inutilisées et 5 000 $ de rendements)
        const settlement = computeReeeClosingSettlement(20000, 9000, 4000, 0, 0.40);

        // 1. PSE (20 000 $) restitué franc d'impôt
        expect(settlement.pseRefundToParent).toBe(20000);
        // 2. Subventions (4 000 $) remboursées au gouvernement
        expect(settlement.grantsRefundToGovernment).toBe(4000);
        // 3. Rendements restants (5 000 $) imposés avec surtaxe 20 %
        expect(settlement.taxableAip).toBe(5000);
        expect(settlement.aipPenaltyTax).toBe(1000); // 20 %
        expect(settlement.aipOrdinaryTax).toBe(2000); // 40 %
        expect(settlement.aipNetCashToParent).toBe(2000); // 5000 - 1000 - 2000
        expect(settlement.totalCashToParent).toBe(22000); // 20 000 PSE + 2 000 net PRA
    });

    it('computeReeeClosingSettlement permet le roulement REER parent jusqu\'à 50 000 $ sans surtaxe', () => {
        // Solde restant avec 10 000 $ de rendements, et le parent a 15 000 $ de droits REER
        const settlementRrsp = computeReeeClosingSettlement(15000, 10000, 0, 15000, 0.40);
        expect(settlementRrsp.rrspRollover).toBe(10000);
        expect(settlementRrsp.taxableAip).toBe(0);
        expect(settlementRrsp.aipPenaltyTax).toBe(0);
        expect(settlementRrsp.totalCashToParent).toBe(15000); // PSE seul en cash, 10 000 $ dans le REER
    });
});
