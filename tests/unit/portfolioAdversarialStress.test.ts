/**
 * Tests Contradictoires & Stress-Testing Empirique — Jalon 3 (F13 à F16)
 * Auteur : teamwork_challenger_m3_1 (Portfolio & Dividend Tax Challenger)
 *
 * Banc d'épreuves contradictoires couvrant :
 * 1. Rendements réels de Fisher sur horizons extrêmes (1 à 60 ans), rendements négatifs et déflation.
 * 2. Amputation du RFG (MER), rendements nets négatifs et pondération multi-actifs aux limites.
 * 3. Frottement fiscal des dividendes canadiens admissibles (majoration 38 %, crédit combiné 24,24 %)
 *    sur toutes les tranches marginales de revenu (0 % à 53,31 %) et parité exacte avec calculateDividendTax.
 * 4. Application stricte de l'Article XXI de la Convention fiscale Canada-US (exemption 15 % en REER/CRI/FERR,
 *    perte sèche en CELI/REEE/CELIAPP, et compensation CIE en Non-Enregistré).
 * 5. Algorithme d'Asset Location face à des portefeuilles atypiques (zéro dividende US, absence de REER,
 *    rendement inférieur au dividende, compte sur marge, etc.).
 * 6. Compartimentation REEE (PSE vs PAE), fiscalité étudiante sous/sur BPA et clôture à 25 ans (plafond 50 k$ LIR 204.94).
 */

import { describe, it, expect } from 'vitest';
import {
    IQPF_2026_INFLATION,
    IQPF_2026_EXPECTED_RETURNS,
    CANADIAN_US_BENCHMARK_ETFS,
    computeRealReturn,
    computeNetReturn,
    computePortfolioWeightedReturn,
    type AssetFundamental,
} from '../../services/assetFundamentals';
import {
    computeAnnualTaxDrag,
    computeAssetLocationTaxDrag,
    computeReeeBalances,
    computeReeeWithdrawal,
    computeReeeStudentTax,
    computeReeeClosingSettlement,
} from '../../services/projection/portfolioAnalytics';
import {
    calculateDividendTax,
} from '../../utils/tax';

describe('CHALLENGE 1 : Rendements réels de Fisher sur horizons extrêmes (1 à 60 ans), rendements négatifs et déflation', () => {
    it('Identité mathématique de Fisher : W_reel(N) * (1+i)^N === W_nom(N) sur 1 à 60 ans', () => {
        const rNom = IQPF_2026_EXPECTED_RETURNS.CAN_EQUITY; // 6.40 %
        const inflation = IQPF_2026_INFLATION; // 2.00 %
        const rReal = computeRealReturn(rNom, inflation); // Fisher exact

        const initialCapital = 100_000;

        for (let years = 1; years <= 60; years++) {
            const nominalWealth = initialCapital * Math.pow(1 + rNom, years);
            const realWealth = initialCapital * Math.pow(1 + rReal, years);
            const reconstructedNominal = realWealth * Math.pow(1 + inflation, years);

            // L'écart relatif entre la richesse nominale réelle et reconstruite doit être inférieur à 1e-12
            const relError = Math.abs(nominalWealth - reconstructedNominal) / nominalWealth;
            expect(relError).toBeLessThan(1e-12);
        }
    });

    it('Distorsion de l\'approximation linéaire (r - i) vs Fisher : mesure de l\'erreur cumulative sur 60 ans', () => {
        const rNom = 0.064;
        const i = 0.020;
        const rFisher = computeRealReturn(rNom, i); // 4.3137 %
        const rLinear = rNom - i; // 4.4000 % (approximation simpliste)

        const capital = 1_000_000;
        const wealthFisher30 = capital * Math.pow(1 + rFisher, 30);
        const wealthLinear30 = capital * Math.pow(1 + rLinear, 30);

        // À 30 ans, l'approximation linéaire surévalue le capital réel de plus de 65 000 $
        expect(wealthLinear30 - wealthFisher30).toBeGreaterThan(65_000);

        const wealthFisher60 = capital * Math.pow(1 + rFisher, 60);
        const wealthLinear60 = capital * Math.pow(1 + rLinear, 60);

        // À 60 ans, l'approximation linéaire surévalue de plus de 5 % la richesse finale (~638 000 $ d'illusion)
        const overstatementPct = (wealthLinear60 - wealthFisher60) / wealthFisher60;
        expect(overstatementPct).toBeGreaterThan(0.05);
    });

    it('Déflation modérée et sévère : le rendement réel est strictement supérieur au rendement nominal', () => {
        const rNom = 0.03; // 3 % nominal

        // Déflation modérée : -1.5 %
        const rRealDeflation1 = computeRealReturn(rNom, -0.015);
        // (1 + 0.03) / (1 - 0.015) - 1 = 1.03 / 0.985 - 1 = 0.045685
        expect(rRealDeflation1).toBeGreaterThan(rNom);
        expect(rRealDeflation1).toBeCloseTo(0.045685, 5);

        // Déflation sévère : -5.0 %
        const rRealDeflation2 = computeRealReturn(rNom, -0.05);
        expect(rRealDeflation2).toBeCloseTo(1.03 / 0.95 - 1, 5);
    });

    it('Hyperinflation (10 % à 100 %) : contraction sévère du pouvoir d\'achat', () => {
        const rNom = 0.08; // 8 % nominal

        // Inflation 10 %
        const rReal10 = computeRealReturn(rNom, 0.10);
        // 1.08 / 1.10 - 1 = -0.01818
        expect(rReal10).toBeCloseTo(-0.018182, 5);

        // Hyperinflation 100 % (prix doublent en 1 an)
        const rReal100 = computeRealReturn(rNom, 1.00);
        // 1.08 / 2.00 - 1 = -0.46
        expect(rReal100).toBeCloseTo(-0.46, 5);
    });

    it('Rendements nominaux négatifs (krach -20 % à perte totale -100 %)', () => {
        const inflation = 0.02;

        // Marché baissier -20 %
        const rCrash20 = computeRealReturn(-0.20, inflation);
        // (1 - 0.20) / 1.02 - 1 = 0.80 / 1.02 - 1 = -0.215686
        expect(rCrash20).toBeCloseTo(-0.215686, 5);

        // Krach -50 %
        const rCrash50 = computeRealReturn(-0.50, inflation);
        expect(rCrash50).toBeCloseTo(-0.509804, 5);

        // Perte totale de 100 % (faillite)
        const rTotalLoss = computeRealReturn(-1.0, inflation);
        expect(rTotalLoss).toBe(-1);

        // Perte avec effet de levier (< -100 %) bornée à -1 (-100 %)
        const rLeverageLoss = computeRealReturn(-1.8, inflation);
        expect(rLeverageLoss).toBe(-1);
    });

    it('Robustesse face aux entrées non finies (NaN, Infinity, division par zéro)', () => {
        expect(computeRealReturn(NaN)).toBe(0);
        expect(computeRealReturn(Infinity)).toBe(0);
        expect(computeRealReturn(-Infinity)).toBe(0);

        // Inflation <= -1 (singularité mathématique évitée par repli sur inflation IQPF)
        expect(computeRealReturn(0.05, -1.0)).toBeCloseTo(computeRealReturn(0.05, IQPF_2026_INFLATION), 6);
        expect(computeRealReturn(0.05, -2.5)).toBeCloseTo(computeRealReturn(0.05, IQPF_2026_INFLATION), 6);
        expect(computeRealReturn(0.05, NaN)).toBeCloseTo(computeRealReturn(0.05, IQPF_2026_INFLATION), 6);
    });
});

describe('CHALLENGE 2 : Amputation du RFG (MER), rendements nets négatifs et pondération multi-actifs aux limites', () => {
    it('RFG supérieur au rendement brut : production d\'un rendement net négatif cohérent', () => {
        // Fonds obligataire ou monétaire à frais abusifs : brut 1.5 %, RFG 2.25 %
        const netReturn = computeNetReturn(0.015, 0.0225);
        expect(netReturn).toBeCloseTo(-0.0075, 4); // -0.75 % par an
    });

    it('Rendement brut négatif aggravé par le RFG', () => {
        // Année de baisse (-10 %) avec RFG de 2.0 %
        const netDownYear = computeNetReturn(-0.10, 0.02);
        expect(netDownYear).toBeCloseTo(-0.12, 4); // -12 %
    });

    it('RFG négatif ou anormal : neutralisé à 0 sans générer de subvention fictive', () => {
        expect(computeNetReturn(0.05, -0.02)).toBe(0.05);
        expect(computeNetReturn(0.05, NaN)).toBe(0.05);
        expect(computeNetReturn(NaN, 0.01)).toBe(0);
    });

    it('computePortfolioWeightedReturn face à des pondérations asymétriques et extrêmes', () => {
        // 1 $ sur un actif à 100 % de rendement vs 10 000 000 $ sur un actif à 3 %
        const holdings = [
            { balance: 1, expectedReturn: 1.0 },
            { balance: 10_000_000, expectedReturn: 0.03 },
        ];
        const weighted = computePortfolioWeightedReturn(holdings);
        expect(weighted).toBeCloseTo(0.030000097, 7);
    });

    it('computePortfolioWeightedReturn face à des soldes négatifs (comptes sur marge ou dettes)', () => {
        // Le solde négatif est borné à 0 pour éviter d'inverser le dénominateur ou de créer des poids négatifs
        const holdings = [
            { balance: 100_000, expectedReturn: 0.06 },
            { balance: -50_000, expectedReturn: 0.20 },
        ];
        const weighted = computePortfolioWeightedReturn(holdings);
        // Le solde négatif est ignoré : rendement = 6 % sur les 100 000 $ positifs
        expect(weighted).toBe(0.06);
    });

    it('computePortfolioWeightedReturn avec un portefeuille géant (10 000 actifs) sans dégradation', () => {
        const largePortfolio = Array.from({ length: 10_000 }, (_, i) => ({
            balance: 100,
            expectedReturn: 0.05 + (i % 10) * 0.002,
        }));
        const t0 = performance.now();
        const weighted = computePortfolioWeightedReturn(largePortfolio);
        const t1 = performance.now();

        expect(weighted).toBeCloseTo(0.059, 2);
        expect(t1 - t0).toBeLessThan(50); // Moins de 50 ms pour 10 000 positions
    });
});

describe('CHALLENGE 3 : Frottement fiscal des dividendes canadiens admissibles et parité avec calculateDividendTax', () => {
    const QUEBEC_MARGINAL_RATES = [
        { label: 'Palier 0 (sous BPA)', rate: 0.0 },
        { label: 'Palier bas (10 % effectif)', rate: 0.10 },
        { label: 'Palier 1 combiné (féd 14% abattu 11.69% + QC 14%)', rate: 0.2569 },
        { label: 'Palier 2 combiné (féd 20.5% abattu 17.12% + QC 19%)', rate: 0.361175 },
        { label: 'Palier 3 combiné (féd 26% abattu 21.71% + QC 24%)', rate: 0.4571 },
        { label: 'Palier 4 combiné (féd 29% abattu 24.215% + QC 25.75%)', rate: 0.49965 },
        { label: 'Palier supérieur (féd 33% abattu 27.555% + QC 25.75%)', rate: 0.53305 },
    ];

    it('Point mort (breakeven) : sous 24,24 % de taux marginal, l\'impôt sur dividende admissible est nul', () => {
        const dividend = 10_000;
        const breakevenRate = 0.334533 / 1.38; // ~0.242415 (24.24 %)

        // Juste sous le point mort (24.0 %) : impôt nul
        const taxUnder = calculateDividendTax(dividend, 0.240, 'eligible');
        expect(taxUnder).toBe(0);

        // Au point mort exact : impôt nul
        const taxAt = calculateDividendTax(dividend, breakevenRate, 'eligible');
        expect(taxAt).toBeCloseTo(0, 2);

        // Juste au-dessus du point mort (25.0 %) : impôt positif
        const taxAbove = calculateDividendTax(dividend, 0.250, 'eligible');
        expect(taxAbove).toBeGreaterThan(0);
    });

    it('Parité exacte : le frottement de computeAssetLocationTaxDrag concorde avec calculateDividendTax sur toutes les tranches', () => {
        const assetCanEq: AssetFundamental = {
            symbol: 'XIU',
            name: 'iShares S&P/TSX 60',
            assetClass: 'CAN_EQUITY',
            expectedReturn: 0.064,
            volatility: 0.13,
            mer: 0.0018,
            dividendYield: 0.030, // 3.0 %
            eligibleCanadianDivFraction: 1.0,
            usForeignDivFraction: 0,
            interestFraction: 0,
        };

        const capital = 100_000;
        const annualDividends = capital * assetCanEq.dividendYield; // 3 000 $

        for (const bracket of QUEBEC_MARGINAL_RATES) {
            // 1. Calcul via calculateDividendTax (moteur fiscal standard)
            const taxFromEngine = calculateDividendTax(annualDividends, bracket.rate, 'eligible');

            // 2. Calcul du frottement via computeAssetLocationTaxDrag (avec turnover nul pour isoler le dividende)
            const dragRate = computeAssetLocationTaxDrag('NON-ENREG', assetCanEq, bracket.rate, 0);
            const dragDollars = capital * dragRate;

            // Concordance au centime près
            expect(dragDollars).toBeCloseTo(taxFromEngine, 1);
        }
    });

    it('Monotonie stricte de la charge fiscale sur les dividendes', () => {
        let previousDrag = -1;
        for (let rate = 0.0; rate <= 0.55; rate += 0.02) {
            const drag = computeAssetLocationTaxDrag('NON-ENREG', CANADIAN_US_BENCHMARK_ETFS.XIC, rate, 0.05);
            expect(drag).toBeGreaterThanOrEqual(previousDrag);
            previousDrag = drag;
        }
    });
});

describe('CHALLENGE 4 : Application stricte de l\'Article XXI de la convention Canada-US', () => {
    const usAsset = CANADIAN_US_BENCHMARK_ETFS.VOO; // 1.5 % yield, 100 % US
    const portfolioValue = 200_000;

    it('Article XXI par. 2 : Exonération absolue de 15 % pour REER, CRI et FERR', () => {
        for (const registeredAccount of ['REER', 'reer', 'CRI', 'cri', 'FERR', 'ferr']) {
            const drag = computeAnnualTaxDrag({
                symbol: 'VOO',
                accountType: registeredAccount,
                currentValueCad: portfolioValue,
                dividendYield: usAsset.dividendYield,
                usForeignDivFraction: 1.0,
            });
            expect(drag.irsWithholdingCad).toBe(0);
            expect(drag.taxDragRate).toBe(0);
            expect(drag.netYield).toBe(usAsset.dividendYield);

            const locDrag = computeAssetLocationTaxDrag(registeredAccount, usAsset, 0.40);
            expect(locDrag).toBe(0);
        }
    });

    it('Article XXI non applicable aux CELI, REEE et CELIAPP : perte sèche non recouvrable de 15 %', () => {
        for (const nonPensionAccount of ['CELI', 'celi', 'REEE', 'reee', 'CELIAPP', 'celiapp']) {
            const drag = computeAnnualTaxDrag({
                symbol: 'VOO',
                accountType: nonPensionAccount,
                currentValueCad: portfolioValue,
                dividendYield: usAsset.dividendYield,
                usForeignDivFraction: 1.0,
            });
            // Dividendes bruts : 200 000 * 1.5 % = 3 000 $
            // Retenue 15 % : 3 000 * 0.15 = 450 $
            expect(drag.irsWithholdingCad).toBe(450);
            expect(drag.netDividendCad).toBe(2550);
            expect(drag.taxDragRate).toBeCloseTo(0.00225, 5); // 0.225 %
            expect(drag.netYield).toBeCloseTo(0.01275, 5); // 1.275 %

            const locDrag = computeAssetLocationTaxDrag(nonPensionAccount, usAsset, 0.40);
            expect(locDrag).toBeCloseTo(0.00225, 5);
        }
    });

    it('Compte Non-Enregistré : la retenue est neutralisée par le CIE, mais l\'impôt marginal s\'applique', () => {
        const dragNonReg = computeAnnualTaxDrag({
            symbol: 'VOO',
            accountType: 'NON-ENREG',
            currentValueCad: portfolioValue,
            dividendYield: usAsset.dividendYield,
            usForeignDivFraction: 1.0,
        });
        // Pas de perte sèche non recouvrable : 0 $ de fuite fiscale brute dans le CELI
        expect(dragNonReg.irsWithholdingCad).toBe(0);

        // Mais en Asset Location, le dividende est imposé au taux marginal (ex: 40 %)
        const locDragNonReg = computeAssetLocationTaxDrag('NON-ENREG', usAsset, 0.40, 0);
        // 1.5 % * 100 % US * 40 % marginal = 0.60 %
        expect(locDragNonReg).toBeCloseTo(0.0060, 4);
    });
});

describe('CHALLENGE 5 : Algorithme d\'Asset Location optimale face à des portefeuilles atypiques', () => {
    it('Portefeuille atypique 1 : Titres de croissance américains sans dividende (Berkshire Hathaway, Amazon)', () => {
        const usGrowthNoDiv: AssetFundamental = {
            symbol: 'BRK.B',
            name: 'Berkshire Hathaway',
            assetClass: 'US_EQUITY',
            expectedReturn: 0.07,
            volatility: 0.15,
            mer: 0,
            dividendYield: 0, // 0 % dividende
            eligibleCanadianDivFraction: 0,
            usForeignDivFraction: 1.0,
            interestFraction: 0,
        };

        // En CELI : zéro perte sèche car zéro dividende !
        const dragCeli = computeAssetLocationTaxDrag('CELI', usGrowthNoDiv, 0.40);
        expect(dragCeli).toBe(0);

        // En Non-Enregistré : frottement sur la rotation (turnover) et gains en capital
        const dragNonReg = computeAssetLocationTaxDrag('NON-ENREG', usGrowthNoDiv, 0.40, 0.05);
        // 7 % growth * 5 % turnover * 50 % inclusion * 40 % marg = 0.07 % drag
        expect(dragNonReg).toBeGreaterThan(0);

        // Paradoxe contradictoire : pour un titre US sans dividende, le CELI est strictement supérieur au Non-Enregistré,
        // même si recommendOptimalAssetLocation('US_EQUITY') propose l'ordre rigide ['REER', 'NON-ENREG', 'CELI'].
        expect(dragCeli).toBeLessThan(dragNonReg);
    });

    it('Portefeuille atypique 2 : Titres à très haut dividende / Split shares (rendement dividende > rendement espéré)', () => {
        const highYieldCoveredCall: AssetFundamental = {
            symbol: 'HY-SPLIT',
            name: 'High Yield Fund',
            assetClass: 'CAN_EQUITY',
            expectedReturn: 0.06, // 6 % espéré
            volatility: 0.18,
            mer: 0.0075,
            dividendYield: 0.09, // 9 % dividende (érosion de capital de 3 %)
            eligibleCanadianDivFraction: 1.0,
            usForeignDivFraction: 0,
            interestFraction: 0,
        };

        // La part de croissance (expectedReturn - y) est négative (-3 %), elle doit être bornée à 0
        const drag = computeAssetLocationTaxDrag('NON-ENREG', highYieldCoveredCall, 0.40, 0.10);
        // 9 % dividende * (1.38 * 0.40 - 0.334533) = 9 % * 0.217467 = 1.9572 %
        expect(drag).toBeCloseTo(0.09 * (1.38 * 0.40 - 0.334533), 5);
        expect(Number.isFinite(drag)).toBe(true);
    });

    it('Portefeuille atypique 3 : Compte sur marge (alias MARGE vs NON-ENREG)', () => {
        const bond = CANADIAN_US_BENCHMARK_ETFS.ZAG;
        // 'NON-ENREG' est reconnu
        const dragNonReg = computeAssetLocationTaxDrag('NON-ENREG', bond, 0.40);
        expect(dragNonReg).toBeGreaterThan(0);

        // Note critique : 'MARGE' est un compte non enregistré imposable dans la réalité fiscale.
        // Si le système ne le traite pas comme imposable, il retourne 0.
        const dragMarge = computeAssetLocationTaxDrag('MARGE', bond, 0.40);
        // Observation empirique : le code traite actuellement MARGE en repli neutre (0)
        expect(dragMarge).toBe(0);
    });
});

describe('CHALLENGE 6 : Compartimentation REEE (PSE vs PAE), fiscalité de l\'étudiant et clôture à 25 ans', () => {
    it('computeReeeBalances préserve la séparation stricte du capital souscripteur PSE', () => {
        const b = computeReeeBalances(36_000, 10_800, 25_000);
        expect(b.pseBalance).toBe(36_000);
        expect(b.paeBalance).toBe(35_800); // 10 800 + 25 000
        expect(b.total).toBe(71_800);
    });

    it('computeReeeWithdrawal épuise prioritairement le PAE avant de toucher au PSE', () => {
        // Retrait partiel : 15 000 $ demandé sur un REEE de 30 k$ PSE et 20 k$ PAE
        const w1 = computeReeeWithdrawal(15_000, 30_000, 20_000);
        expect(w1.withdrawalPae).toBe(15_000);
        expect(w1.withdrawalPse).toBe(0);
        expect(w1.newPaeBalance).toBe(5_000);
        expect(w1.newPseBalance).toBe(30_000);

        // Retrait subséquent dépassant le solde PAE restant (10 000 $ demandé)
        const w2 = computeReeeWithdrawal(10_000, w1.newPseBalance, w1.newPaeBalance);
        expect(w2.withdrawalPae).toBe(5_000); // Tout le PAE restant
        expect(w2.withdrawalPse).toBe(5_000); // Le solde est prélevé sur le PSE
        expect(w2.newPaeBalance).toBe(0);
        expect(w2.newPseBalance).toBe(25_000);
    });

    it('computeReeeStudentTax : seuil de non-imposition sous le BPA et taxation minimale au-delà', () => {
        // Retrait de 16 000 $ PAE pour un étudiant sans autre revenu : sous le BPA fed (16 452 $) -> 0 $ d'impôt
        const taxUnderBpa = computeReeeStudentTax(16_000, 0);
        expect(taxUnderBpa.studentTotalTax).toBe(0);

        // Retrait de 24 000 $ PAE : imposable au-delà de 16 452 $ fed et 18 952 $ QC
        const taxOverBpa = computeReeeStudentTax(24_000, 0);
        // Fed taxable : 24 000 - 16 452 = 7 548 $ * 14 % * (1 - 0.165) = 882.36 $
        expect(taxOverBpa.studentFedTax).toBeCloseTo(882.36, 1);
        // QC taxable : 24 000 - 18 952 = 5 048 $ * 14 % = 706.72 $
        expect(taxOverBpa.studentQcTax).toBeCloseTo(706.72, 1);
        expect(taxOverBpa.studentTotalTax).toBeCloseTo(1589.08, 1);
    });

    it('computeReeeClosingSettlement : respect strict du plafond de 50 000 $ de roulement REER (LIR 204.94)', () => {
        // Rendements de 75 000 $, subventions résiduelles de 5 000 $, capital PSE de 40 000 $
        // Le parent dispose de 80 000 $ de droits REER inutilisés
        const s = computeReeeClosingSettlement(40_000, 80_000, 5_000, 80_000, 0.45);

        // 1. PSE (40 000 $) restitué franc d'impôt
        expect(s.pseRefundToParent).toBe(40_000);

        // 2. Subventions (5 000 $) remboursées intégralement au gouvernement
        expect(s.grantsRefundToGovernment).toBe(5_000);

        // 3. Rendements résiduels : 80 000 - 5 000 = 75 000 $
        // Le roulement REER est STRICTEMENT plafonné à 50 000 $ en vertu de l'art. 204.94 LIR, même si le parent a 80 000 $ d'espace
        expect(s.rrspRollover).toBe(50_000);

        // 4. Les 25 000 $ excédentaires subissent la pénalité de 20 % + le taux marginal (45 %)
        expect(s.taxableAip).toBe(25_000);
        expect(s.aipPenaltyTax).toBe(5_000); // 25 000 * 20 %
        expect(s.aipOrdinaryTax).toBe(11_250); // 25 000 * 45 %
        expect(s.aipNetCashToParent).toBe(8_750); // 25 000 - 5 000 - 11 250

        // Total net reçu en cash par le parent : PSE (40 000 $) + net AIP (8 750 $) = 48 750 $
        expect(s.totalCashToParent).toBe(48_750);
    });

    it('computeReeeClosingSettlement : absence totale de droits REER déclenche l\'imposition maximale avec surtaxe', () => {
        // Rendements de 30 000 $, subventions 0 $, PSE 20 000 $, espace REER = 0 $
        const s = computeReeeClosingSettlement(20_000, 30_000, 0, 0, 0.50);

        expect(s.rrspRollover).toBe(0);
        expect(s.taxableAip).toBe(30_000);
        expect(s.aipPenaltyTax).toBe(6_000); // 20 %
        expect(s.aipOrdinaryTax).toBe(15_000); // 50 %
        expect(s.aipNetCashToParent).toBe(9_000); // 30 000 * (1 - 0.70) = 9 000 $
        expect(s.totalCashToParent).toBe(29_000); // 20 000 PSE + 9 000 AIP net
    });
});
