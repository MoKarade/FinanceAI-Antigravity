// services/projection/realPastAndNewsAnalyzer.ts
// Audit du passé réel (transactions, budget, frais RFG, retenue US CELI) et collecte
// best-effort des actualités / fondamentaux Valoria + synthèse Gemini 100 % anonymisée.
//
// Règle no-fake-data : toute métrique absente ou non mesurable vaut `null`, jamais `0`.
// Zéro import direct du store Zustand (préserve la pureté de services/projection*).

import type {
    Asset,
    BudgetCategory,
    BudgetConfig,
    Debt,
    ProjectionConfig,
    RealEstateGoal,
    RetirementGoal,
    Transaction,
    ValoriaRiskProfile,
} from '../../types';
import { isSavingsNature } from '../../utils/budget';
import { formatCAD, formatPercent } from '../../utils/format';
import {
    PROMPT_DATA_ISOLATION_NOTE,
    sanitizePromptText,
    wrapUserData,
} from '../../utils/promptSafety';
import { isCreditBack, isTransferOrVirement } from '../../utils/spendRules';
import { US_DIVIDEND_WITHHOLDING_RATE } from '../../utils/tax';
import { resolveAssetFundamental } from '../assetFundamentals';
import { chat, MODEL_HAIKU } from '../gemini';
import { assetValueCad, monthlyAmountFor } from '../portfolio';
import { ASSETS, MARKET_REGIMES, type MacroIndicators } from '../valoria/marketData';
import { resolveFinanceAISymbol } from '../valoria/financeAiBridge';
import {
    buildPortfolioNewsIntelligence,
    type RawNewsFeedItem,
} from '../valoria/newsCatalystEngine';
import {
    auditSpendingWindow,
    classifyIncompressibleVsDiscretionary,
    computeLifestyleCreep,
    computeVolatilityAndSeasonality,
    detectPayCadence,
    detectRecurringPrelevements,
    filterSpendingTransactions,
} from './behavioralProfile';
import type {
    MacroAndNewsSignalBundle,
    MacroNewsSignalItem,
    RealPastDiagnostic,
} from './deepForecastTypes';
import { round2 } from './helpers';
import type { SimulationParams } from './types';
import {
    computeValoriaFutureForecast,
    type ValoriaFutureForecastResult,
} from './valoriaFutureEngine';

export interface RealPastAnalyzerInput {
    transactions?: readonly Transaction[];
    assets?: readonly Asset[];
    fxRates?: Record<string, number>;
    debts?: readonly Debt[];
    budgetItems?: readonly BudgetCategory[];
    realEstateGoals?: readonly RealEstateGoal[];
    config?: BudgetConfig;
    projection?: ProjectionConfig;
    retirementGoal?: RetirementGoal;
    /** Date ISO de référence optionnelle (tests déterministes). */
    referenceDateIso?: string;
}

const MONTH_LABELS_FR = [
    'Janvier',
    'Février',
    'Mars',
    'Avril',
    'Mai',
    'Juin',
    'Juillet',
    'Août',
    'Septembre',
    'Octobre',
    'Novembre',
    'Décembre',
] as const;

const NETWORK_TIMEOUT_MS = 3500;
const DUMMY_KEY_PATTERNS = /^(?:demo|fake|placeholder|none|null|undefined|test|xxx+)$/i;

function isValidIsoDatePrefix(raw: unknown): raw is string {
    return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.trim());
}

/**
 * Calcule le total mensuel des dépenses budgétées (hors postes d'épargne).
 * Retourne null si aucun poste budgétaire actif de dépense n'est configuré (no-fake-data).
 */
function computeBudgetedExpensesMonthlyCad(
    budgetItems: readonly BudgetCategory[] | undefined,
): number | null {
    if (!budgetItems || budgetItems.length === 0) return null;
    let sum = 0;
    let validCount = 0;
    for (const item of budgetItems) {
        if (!item || isSavingsNature(item.nature)) continue;
        if (!Number.isFinite(item.target) || item.target <= 0) continue;
        const m = monthlyAmountFor(item);
        if (Number.isFinite(m) && m > 0) {
            sum += m;
            validCount++;
        }
    }
    return validCount > 0 && sum > 0 ? round2(sum) : null;
}

/**
 * Mesure les frais RFG moyens pondérés et l'érosion fiscale annuelle estimée
 * (frais de gestion + retenue à la source US 15 % non récupérable en CELI/CELIAPP
 * et dividendes internationaux sans convention en compte non-enregistré).
 */
function computePortfolioFeeAndTaxDrag(
    assets: readonly Asset[] | undefined,
    fxRates: Record<string, number> | undefined,
): {
    weightedMerPct: number | null;
    estimatedAnnualFeeAndTaxDragCad: number | null;
    totalPortfolioCad: number;
} {
    if (!assets || assets.length === 0) {
        return {
            weightedMerPct: null,
            estimatedAnnualFeeAndTaxDragCad: null,
            totalPortfolioCad: 0,
        };
    }

    let totalPortfolioCad = 0;
    let weightedMerSum = 0;
    let annualDragCad = 0;

    for (const a of assets) {
        if (!a || !Number.isFinite(a.quantity) || !Number.isFinite(a.currentPrice)) continue;
        if (a.quantity <= 0 || a.currentPrice <= 0) continue;
        const valCad = assetValueCad(a, fxRates);
        if (!Number.isFinite(valCad) || valCad <= 0) continue;

        const fund = resolveAssetFundamental(a.symbol);
        const mer = Number.isFinite(fund.mer) && fund.mer >= 0 ? fund.mer : 0;
        const divYieldDec =
            typeof a.dividendYield === 'number' && Number.isFinite(a.dividendYield) && a.dividendYield > 0
                ? a.dividendYield / 100
                : fund.dividendYield;

        totalPortfolioCad += valCad;
        weightedMerSum += valCad * mer;

        let taxDragRate = 0;
        const acc = (a.accountType ?? 'NON-ENREG').toUpperCase();
        if ((acc === 'CELI' || acc === 'CELIAPP') && fund.usForeignDivFraction > 0) {
            taxDragRate = fund.usForeignDivFraction * divYieldDec * US_DIVIDEND_WITHHOLDING_RATE;
        } else if (
            acc === 'NON-ENREG' &&
            (fund.assetClass === 'INT_EQUITY' || fund.assetClass === 'EM_EQUITY')
        ) {
            taxDragRate = divYieldDec * US_DIVIDEND_WITHHOLDING_RATE;
        }

        annualDragCad += valCad * (mer + taxDragRate);
    }

    if (totalPortfolioCad <= 0) {
        return {
            weightedMerPct: null,
            estimatedAnnualFeeAndTaxDragCad: null,
            totalPortfolioCad: 0,
        };
    }

    return {
        weightedMerPct: round2((weightedMerSum / totalPortfolioCad) * 100),
        estimatedAnnualFeeAndTaxDragCad: round2(annualDragCad),
        totalPortfolioCad: round2(totalPortfolioCad),
    };
}

/**
 * Audit 100 % pur et déterministe du passé réel (transactions, budget, dettes, portefeuille).
 * Respecte strictement la règle `no-fake-data` : toute métrique non mesurable vaut `null`.
 */
export function analyzeRealPastDossier(input: RealPastAnalyzerInput): RealPastDiagnostic {
    const rawTransactions = input.transactions ?? [];
    const validTx = rawTransactions
        .filter(
            (t): t is Transaction =>
                Boolean(t) &&
                !t.isDuplicate &&
                Number.isFinite(t.amount) &&
                isValidIsoDatePrefix(t.date),
        )
        .sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)));

    const transactionsAnalyzed = validTx.length;
    const firstTransactionDate = transactionsAnalyzed > 0 ? validTx[0].date.slice(0, 10) : null;
    const lastTransactionDate =
        transactionsAnalyzed > 0 ? validTx[transactionsAnalyzed - 1].date.slice(0, 10) : null;

    const allMonthsSet = new Set<string>();
    for (const t of validTx) {
        allMonthsSet.add(t.date.slice(0, 7));
    }
    const allMonthsSorted = Array.from(allMonthsSet).sort();
    const monthsCovered = allMonthsSorted.length;

    const budgetedMonthlyExpensesCad = computeBudgetedExpensesMonthlyCad(input.budgetItems);
    const { weightedMerPct, estimatedAnnualFeeAndTaxDragCad } = computePortfolioFeeAndTaxDrag(
        input.assets,
        input.fxRates,
    );

    // Cas dossier sans historique bancaire exploitable
    if (transactionsAnalyzed === 0 || monthsCovered === 0) {
        const emptyFindings: string[] = [
            'Historique de transactions encore vide ou trop court : aucune habitude de dépense, dérive ou saisonnalité n’a été inventée.',
        ];
        if (budgetedMonthlyExpensesCad !== null) {
            emptyFindings.push(
                `La projection de base s’appuie sur votre budget cible de ${formatCAD(budgetedMonthlyExpensesCad)}/mois.`,
            );
        } else {
            emptyFindings.push(
                'Aucun poste de dépenses budgétaires configuré : complétez l’onglet Budget ou importez vos relevés pour affiner le diagnostic.',
            );
        }
        if (weightedMerPct !== null && estimatedAnnualFeeAndTaxDragCad !== null) {
            emptyFindings.push(
                `Frais RFG moyens pondérés du portefeuille estimés à ${formatPercent(weightedMerPct, 2)} (fuite annuelle frais + retenue US estimée : ${formatCAD(estimatedAnnualFeeAndTaxDragCad)}/an).`,
            );
        } else {
            emptyFindings.push(
                'Aucun placement valorisé détecté pour mesurer le RFG pondéré ou la retenue US sur dividendes.',
            );
        }

        return {
            transactionsAnalyzed: 0,
            monthsCovered: 0,
            firstTransactionDate: null,
            lastTransactionDate: null,
            observedMonthlyIncomeCad: null,
            observedMonthlyExpensesCad: null,
            budgetedMonthlyExpensesCad,
            monthlySpendingGapCad: null,
            observedSavingsRatePct: null,
            lifestyleCreepAnnualPct: null,
            fixedExpensesSharePct: null,
            discretionarySharePct: null,
            peakSpendingMonthLabel: null,
            lowSpendingMonthLabel: null,
            weightedMerPct,
            estimatedAnnualFeeAndTaxDragCad,
            expenseVolatilityPct: null,
            findingsFr: emptyFindings.slice(0, 5),
        };
    }

    // Revenus mensuels réels observés (hors transferts et remboursements de dépenses)
    let totalObservedIncome = 0;
    let incomeTxCount = 0;
    for (const t of validTx) {
        if (t.isTransfer || isTransferOrVirement(t) || isCreditBack(t)) continue;
        if (t.amount > 0) {
            totalObservedIncome += t.amount;
            incomeTxCount++;
        }
    }
    const observedMonthlyIncomeCad =
        incomeTxCount > 0 && monthsCovered > 0 ? round2(totalObservedIncome / monthsCovered) : null;

    // Dépenses réelles filtrées via behavioralProfile.ts
    const spendingTx = filterSpendingTransactions(validTx);
    const spendingByYm = new Map<string, number>();
    const categoryMonthlyTotals = new Map<string, Map<string, number>>();

    for (const t of spendingTx) {
        const ym = t.date.slice(0, 7);
        const delta = -t.amount; // sortie positive, remboursement en déduction
        spendingByYm.set(ym, (spendingByYm.get(ym) ?? 0) + delta);

        const cat = (t.category || 'Autre').trim() || 'Autre';
        let catMonths = categoryMonthlyTotals.get(cat);
        if (!catMonths) {
            catMonths = new Map<string, number>();
            categoryMonthlyTotals.set(cat, catMonths);
        }
        catMonths.set(ym, (catMonths.get(ym) ?? 0) + delta);
    }

    const spendingMonthsSorted = Array.from(spendingByYm.keys()).sort();
    const recentSpendingMonths = spendingMonthsSorted.slice(-12);

    let observedMonthlyExpensesCad: number | null = null;
    let fixedExpensesSharePct: number | null = null;
    let discretionarySharePct: number | null = null;
    let lifestyleCreepAnnualPct: number | null = null;
    let peakSpendingMonthLabel: string | null = null;
    let lowSpendingMonthLabel: string | null = null;
    let expenseVolatilityPct: number | null = null;

    if (recentSpendingMonths.length > 0) {
        const monthlySeries = recentSpendingMonths.map((ym) => Math.max(0, spendingByYm.get(ym) ?? 0));
        const totalRecentSpending = monthlySeries.reduce((s, v) => s + v, 0);

        if (totalRecentSpending > 0) {
            observedMonthlyExpensesCad = round2(totalRecentSpending / recentSpendingMonths.length);

            // Référence normalisée au 28 du dernier mois pour éviter le dépassement JS setMonth sur le 31
            const lastSpendYm = recentSpendingMonths[recentSpendingMonths.length - 1];
            const safeRefIso = input.referenceDateIso ?? `${lastSpendYm}-28`;
            const windowAudit = auditSpendingWindow(validTx, recentSpendingMonths.length, safeRefIso);

            if (windowAudit.totalSpendingCad > 0) {
                fixedExpensesSharePct = round2(windowAudit.fixedRatio * 100);
                discretionarySharePct = round2(100 - fixedExpensesSharePct);
            } else {
                const seriesMap = new Map<string, number[]>();
                for (const [cat, ymMap] of categoryMonthlyTotals.entries()) {
                    seriesMap.set(
                        cat,
                        recentSpendingMonths.map((ym) => Math.max(0, ymMap.get(ym) ?? 0)),
                    );
                }
                const classified = classifyIncompressibleVsDiscretionary(seriesMap);
                fixedExpensesSharePct = round2(classified.fixedRatio * 100);
                discretionarySharePct = round2(100 - fixedExpensesSharePct);
            }

            if (recentSpendingMonths.length >= 3 && observedMonthlyExpensesCad > 0) {
                const creep = computeLifestyleCreep(monthlySeries);
                const rawCreepPct = (creep.annualSlopeCad / observedMonthlyExpensesCad) * 100;
                lifestyleCreepAnnualPct = round2(Math.max(-25, Math.min(25, rawCreepPct)));

                const volRes = computeVolatilityAndSeasonality(monthlySeries);
                expenseVolatilityPct = round2(volRes.monthlyVolatilityPct * 100);
            }

            if (recentSpendingMonths.length >= 2) {
                const calBuckets: Array<{ sum: number; count: number }> = Array.from(
                    { length: 12 },
                    () => ({ sum: 0, count: 0 }),
                );
                for (const ym of spendingMonthsSorted) {
                    const calIdx = Number(ym.slice(5, 7)) - 1;
                    if (calIdx >= 0 && calIdx < 12) {
                        calBuckets[calIdx].sum += Math.max(0, spendingByYm.get(ym) ?? 0);
                        calBuckets[calIdx].count += 1;
                    }
                }
                let peakIdx = -1;
                let peakAvg = -Infinity;
                let lowIdx = -1;
                let lowAvg = Infinity;
                for (let m = 0; m < 12; m++) {
                    if (calBuckets[m].count === 0) continue;
                    const avg = calBuckets[m].sum / calBuckets[m].count;
                    if (avg > peakAvg) {
                        peakAvg = avg;
                        peakIdx = m;
                    }
                    if (avg < lowAvg) {
                        lowAvg = avg;
                        lowIdx = m;
                    }
                }
                if (peakIdx >= 0) peakSpendingMonthLabel = MONTH_LABELS_FR[peakIdx];
                if (lowIdx >= 0) lowSpendingMonthLabel = MONTH_LABELS_FR[lowIdx];
            }
        }
    }

    const monthlySpendingGapCad =
        observedMonthlyExpensesCad !== null && budgetedMonthlyExpensesCad !== null
            ? round2(observedMonthlyExpensesCad - budgetedMonthlyExpensesCad)
            : null;

    const observedSavingsRatePct =
        observedMonthlyIncomeCad !== null &&
        observedMonthlyIncomeCad > 0 &&
        observedMonthlyExpensesCad !== null
            ? round2(((observedMonthlyIncomeCad - observedMonthlyExpensesCad) / observedMonthlyIncomeCad) * 100)
            : null;

    // Constats en français simple (3 à 5 puces sourcées sur les chiffres observés)
    const findingsFr: string[] = [];
    const paySchedule = detectPayCadence(validTx);
    const recurringCount = detectRecurringPrelevements(validTx).length;

    const cadenceLabel =
        paySchedule.frequency === 'biweekly'
            ? 'paie aux 2 semaines'
            : paySchedule.frequency === 'weekly'
              ? 'paie hebdomadaire'
              : paySchedule.frequency === 'semi-monthly'
                ? 'paie bimensuelle'
                : paySchedule.frequency === 'monthly'
                  ? 'paie mensuelle'
                  : 'flux irréguliers';

    if (observedMonthlyIncomeCad !== null && observedMonthlyExpensesCad !== null && observedSavingsRatePct !== null) {
        findingsFr.push(
            `Sur ${monthsCovered} mois analysés (${transactionsAnalyzed} opérations, ${cadenceLabel}), vos revenus moyens sont de ${formatCAD(observedMonthlyIncomeCad)}/mois contre ${formatCAD(observedMonthlyExpensesCad)}/mois de dépenses (taux d’épargne réel : ${formatPercent(observedSavingsRatePct, 1)}).`,
        );
    } else if (observedMonthlyExpensesCad !== null) {
        findingsFr.push(
            `Sur ${monthsCovered} mois analysés (${transactionsAnalyzed} opérations), vos dépenses réelles atteignent ${formatCAD(observedMonthlyExpensesCad)}/mois (${recurringCount} prélèvement(s) récurrent(s) repéré(s)).`,
        );
    } else {
        findingsFr.push(
            `Historique partiel (${monthsCovered} mois, ${transactionsAnalyzed} opérations) : les dépenses catégorisées sont insuffisantes pour mesurer un rythme mensuel fiable.`,
        );
    }

    if (monthlySpendingGapCad !== null && budgetedMonthlyExpensesCad !== null) {
        if (monthlySpendingGapCad > 25) {
            findingsFr.push(
                `Écart au budget : vos dépenses réelles dépassent la cible budgétaire (${formatCAD(budgetedMonthlyExpensesCad)}/mois) de +${formatCAD(monthlySpendingGapCad)}/mois.`,
            );
        } else if (monthlySpendingGapCad < -25) {
            findingsFr.push(
                `Discipline budgétaire : vous dépensez ${formatCAD(Math.abs(monthlySpendingGapCad))}/mois de moins que votre budget prévu (${formatCAD(budgetedMonthlyExpensesCad)}/mois).`,
            );
        } else {
            findingsFr.push(
                `Dépenses alignées sur votre budget cible (${formatCAD(budgetedMonthlyExpensesCad)}/mois à ±${formatCAD(Math.abs(monthlySpendingGapCad))} près).`,
            );
        }
    }

    if (lifestyleCreepAnnualPct !== null && fixedExpensesSharePct !== null && discretionarySharePct !== null) {
        const creepText =
            lifestyleCreepAnnualPct > 1.0
                ? `dérive du train de vie mesurée à +${formatPercent(lifestyleCreepAnnualPct, 1)}/an`
                : lifestyleCreepAnnualPct < -1.0
                  ? `tendance à la baisse du train de vie (${formatPercent(lifestyleCreepAnnualPct, 1)}/an)`
                  : `train de vie stable (${formatPercent(lifestyleCreepAnnualPct, 1)}/an)`;
        findingsFr.push(
            `Structure des sorties : ${formatPercent(fixedExpensesSharePct, 0)} de charges incompressibles et ${formatPercent(discretionarySharePct, 0)} de discrétionnaire, avec ${creepText}.`,
        );
    } else if (monthsCovered < 3) {
        findingsFr.push(
            'Historique inférieur à 3 mois : la dérive annuelle du train de vie et la volatilité des dépenses restent non mesurables pour l’instant.',
        );
    }

    if (peakSpendingMonthLabel && lowSpendingMonthLabel && expenseVolatilityPct !== null) {
        findingsFr.push(
            `Saisonnalité : mois le plus chargé en ${peakSpendingMonthLabel} et le plus léger en ${lowSpendingMonthLabel} (volatilité mensuelle de ${formatPercent(expenseVolatilityPct, 1)}).`,
        );
    }

    if (weightedMerPct !== null && estimatedAnnualFeeAndTaxDragCad !== null) {
        findingsFr.push(
            `Coût du portefeuille : frais RFG pondérés de ${formatPercent(weightedMerPct, 2)} et fuite combinée frais + retenues dividendes US estimée à ${formatCAD(estimatedAnnualFeeAndTaxDragCad)}/an.`,
        );
    }

    return {
        transactionsAnalyzed,
        monthsCovered,
        firstTransactionDate,
        lastTransactionDate,
        observedMonthlyIncomeCad,
        observedMonthlyExpensesCad,
        budgetedMonthlyExpensesCad,
        monthlySpendingGapCad,
        observedSavingsRatePct,
        lifestyleCreepAnnualPct,
        fixedExpensesSharePct,
        discretionarySharePct,
        peakSpendingMonthLabel,
        lowSpendingMonthLabel,
        weightedMerPct,
        estimatedAnnualFeeAndTaxDragCad,
        expenseVolatilityPct,
        findingsFr: findingsFr.slice(0, 5),
    };
}

// ----------------------------------------------------------------------------
// Collecte actualités / macro / fondamentaux Valoria + synthèse Gemini anonymisée
// ----------------------------------------------------------------------------

interface AnonymizedHoldingSlot {
    code: string;
    weightPct: number;
    categoryLabel: string;
    sectorLabel: string;
    accountTypeLabel: string;
    sentimentScore: number | null;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactAssetTokens(text: string, forbiddenTokens: ReadonlyArray<string>): string {
    let clean = sanitizePromptText(text, 120);
    for (const tok of forbiddenTokens) {
        const trimmed = tok.trim();
        if (trimmed.length >= 2) {
            clean = clean.replace(new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'gi'), '[ACTIF]');
        }
    }
    // Masquer d'éventuels montants en dollars qui se seraient glissés dans un libellé libre
    clean = clean.replace(/\d[\d\s.,]*\s*(?:\$|CAD|USD|EUR)/gi, '[MONTANT]');
    return clean;
}

/**
 * Construit un prompt 100 % ANONYMISÉ (`ACTIF_01`, `ACTIF_02`..., poids %, secteurs,
 * sentiment agrégé) sans AUCUN symbole boursier réel, montant en $, nom de personne,
 * ni `0` pour une valeur absente (`(non disponible)`).
 * Exporté pour vérification unitaire stricte.
 */
export function buildAnonymizedNewsAndMacroPrompt(input: {
    slots: ReadonlyArray<AnonymizedHoldingSlot>;
    portfolioSentimentScore: number | null;
    annualizedReturnAdjustmentPct: number;
    volatilityMultiplier: number;
    horizonYears: number;
    macroHeadlineFr: string;
    forbiddenTokens?: ReadonlyArray<string>;
}): string {
    const forbidden = input.forbiddenTokens ?? [];
    const fmtNumOrNa = (v: number | null | undefined, suffix = '', decimals = 1): string =>
        typeof v === 'number' && Number.isFinite(v)
            ? `${v.toFixed(decimals).replace('.', ',')}${suffix}`
            : '(non disponible)';

    const lines: string[] = [];
    if (input.slots.length === 0) {
        lines.push('- Aucune ligne de placement active (portefeuille vide : analyse macro générale uniquement).');
    } else {
        for (const s of input.slots.slice(0, 12)) {
            const cat = redactAssetTokens(s.categoryLabel, forbidden) || 'Actif diversifié';
            const sec = redactAssetTokens(s.sectorLabel, forbidden) || 'Multi-secteurs';
            const weight = fmtNumOrNa(s.weightPct, ' %', 1);
            const sent = s.sentimentScore !== null && Number.isFinite(s.sentimentScore)
                ? `${Math.round(s.sentimentScore)}/100`
                : '(non disponible)';
            lines.push(
                `- ${s.code} | poids ${weight} | catégorie ${cat} | secteur ${sec} | enveloppe ${s.accountTypeLabel} | sentiment ${sent}`,
            );
        }
    }

    const headerLines = [
        `Horizon simulé : ${Number.isFinite(input.horizonYears) ? `${Math.round(input.horizonYears)} ans` : '(non disponible)'}`,
        `Sentiment global portefeuille : ${input.portfolioSentimentScore !== null && Number.isFinite(input.portfolioSentimentScore) ? `${Math.round(input.portfolioSentimentScore)}/100` : '(non disponible)'}`,
        `Ajustement rendement annuel actualités : ${fmtNumOrNa(input.annualizedReturnAdjustmentPct, ' %/an', 2)}`,
        `Multiplicateur volatilité court terme : ${fmtNumOrNa(input.volatilityMultiplier, 'x', 2)}`,
        `Contexte macro : ${redactAssetTokens(input.macroHeadlineFr, forbidden) || '(non disponible)'}`,
    ].join('\n');

    return `Tu es stratégiste financier canadien francophone. Rédige une synthèse macro et portefeuille de 2 à 3 phrases claires en français simple, sans jargon inutile, pour éclairer les 4 scénarios de projection retraite/patrimoine au Québec/Canada.
Règles strictes : n'invente aucun chiffre, ne mentionne aucun montant en dollars, et cite uniquement les codes anonymisés (ACTIF_01, etc.) si utile.

${wrapUserData(`${headerLines}\n\nPositions anonymisées :\n${lines.join('\n')}`)}`;
}

async function fetchJsonSafe(
    url: string,
    signal: AbortSignal,
): Promise<{ ok: boolean; status: number; data: unknown }> {
    const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
    });
    if (!resp.ok) {
        return { ok: false, status: resp.status, data: null };
    }
    const contentType = (resp.headers?.get?.('content-type') ?? '').toLowerCase();
    // Vite preview renvoie index.html (200 text/html) pour toute route API absente : on l'écarte proprement
    if (contentType && !contentType.includes('application/json')) {
        return { ok: false, status: resp.status, data: null };
    }
    const text = await resp.text();
    const parsed: unknown = JSON.parse(text);
    return { ok: true, status: resp.status, data: parsed };
}

function buildCombinedAbortController(
    externalSignal: AbortSignal | undefined,
    timeoutMs: number,
): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new Error(`Timeout réseau après ${timeoutMs} ms`));
    }, timeoutMs);
    let onExternalAbort: (() => void) | undefined;
    if (externalSignal) {
        if (externalSignal.aborted) {
            controller.abort(externalSignal.reason);
        } else {
            onExternalAbort = () => controller.abort(externalSignal.reason);
            externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
    }
    return {
        controller,
        cleanup: () => {
            clearTimeout(timer);
            if (externalSignal && onExternalAbort) {
                externalSignal.removeEventListener('abort', onExternalAbort);
            }
        },
    };
}

function mapAccountBucketLabel(accountType?: string): string {
    const acc = (accountType ?? '').trim().toUpperCase();
    if (acc === 'CELI' || acc === 'CELIAPP') return 'CELI/CELIAPP';
    if (acc === 'REER' || acc === 'REEE') return 'REER/REEE';
    if (acc === 'CRYPTO') return 'Crypto';
    return 'Non-enregistré';
}

function buildDeterministicNewsSynthesisFr(input: {
    hasHoldings: boolean;
    portfolioSentimentScore: number | null;
    portfolioSentimentLabel: string;
    annualizedReturnAdjustmentPct: number;
    volatilityMultiplier: number;
    macroHeadlineFr: string;
    valoriaConsensus100: number | null;
}): string {
    if (!input.hasHoldings) {
        return `Lecture macroéconomique neutre : ${input.macroHeadlineFr}. Sans titres détaillés dans votre portefeuille, les scénarios s’appuient sur les normes IQPF 2026 et les régimes macroéconomiques canadiens.`;
    }
    const adjSign = input.annualizedReturnAdjustmentPct >= 0 ? '+' : '';
    const adjStr = `${adjSign}${input.annualizedReturnAdjustmentPct.toFixed(2).replace('.', ',')} %/an`;
    const volStr = `×${input.volatilityMultiplier.toFixed(2).replace('.', ',')}`;
    const consensusClause =
        input.valoriaConsensus100 !== null ? ` Consensus quantitatif Valoria : ${input.valoriaConsensus100}/100.` : '';
    return `Signal actualités & macro (${input.portfolioSentimentLabel}, score ${input.portfolioSentimentScore ?? 0}/100) : ${input.macroHeadlineFr}. Impact intégré sur l’espérance de rendement : ${adjStr} avec un facteur de dispersion de ${volStr}.${consensusClause}`;
}

function normalizeRawNewsFeedItems(rawItems: unknown): RawNewsFeedItem[] {
    if (!Array.isArray(rawItems)) return [];
    const fallbackDate = new Date().toISOString();
    const normalized: RawNewsFeedItem[] = [];
    for (let i = 0; i < rawItems.length; i++) {
        const entry = rawItems[i];
        if (!entry || typeof entry !== 'object') continue;
        const rec = entry as Record<string, unknown>;
        const title = typeof rec.title === 'string' ? rec.title.trim() : '';
        if (!title) continue;
        const tickerCandidate =
            typeof rec.ticker === 'string' && rec.ticker.trim().length > 0
                ? rec.ticker.trim()
                : typeof rec.symbol === 'string' && rec.symbol.trim().length > 0
                  ? rec.symbol.trim()
                  : 'MACRO';
        normalized.push({
            id:
                typeof rec.id === 'string' && rec.id.trim().length > 0
                    ? rec.id.trim()
                    : `live-news-${i + 1}`,
            ticker: tickerCandidate,
            ...(typeof rec.assetId === 'string' && rec.assetId.trim().length > 0
                ? { assetId: rec.assetId.trim() }
                : {}),
            title,
            publisher:
                typeof rec.publisher === 'string' && rec.publisher.trim().length > 0
                    ? rec.publisher.trim()
                    : 'Actualités financières',
            publishedAt:
                typeof rec.publishedAt === 'string' && rec.publishedAt.trim().length > 0
                    ? rec.publishedAt.trim()
                    : fallbackDate,
            ...(typeof rec.url === 'string' && rec.url.trim().length > 0
                ? { url: rec.url.trim() }
                : {}),
            ...(typeof rec.summary === 'string' && rec.summary.trim().length > 0
                ? { summary: rec.summary.trim() }
                : {}),
            isLiveWeb: rec.isLiveWeb !== false,
        });
    }
    return normalized;
}

export async function collectLiveNewsAndFundamentals(input: {
    params: SimulationParams;
    assets?: Asset[];
    fxRates?: Record<string, number>;
    valoriaRiskProfile?: ValoriaRiskProfile;
    apiKey?: string | null;
    signal?: AbortSignal;
    skipNetwork?: boolean;
}): Promise<{
    newsBundle: MacroAndNewsSignalBundle;
    valoriaForecast: ValoriaFutureForecastResult | null;
}> {
    const assets = input.assets ?? [];
    const fxRates = input.fxRates ?? {};
    const horizonYears = input.params.projection?.years ?? 30;

    let valoriaForecast: ValoriaFutureForecastResult | null = null;
    try {
        valoriaForecast = computeValoriaFutureForecast({
            assets,
            fxRates,
            riskProfile: input.valoriaRiskProfile,
            appliedReturnProfile: input.params.projection?.appliedReturnProfile,
            horizonYears,
            cashRatePct: input.params.projection?.returnRates?.cash,
        });
    } catch {
        valoriaForecast = null;
    }

    // Cartographie poids réels et tickers pour le moteur d'actualités
    const heldRaw: Array<{
        asset: Asset;
        assetId: string;
        ticker: string;
        valCad: number;
        categoryLabel: string;
        sectorLabel: string;
    }> = [];
    let totalPortfolioCad = 0;

    for (const a of assets) {
        if (!a || !Number.isFinite(a.quantity) || !Number.isFinite(a.currentPrice)) continue;
        if (a.quantity <= 0 || a.currentPrice <= 0) continue;
        const valCad = assetValueCad(a, fxRates);
        if (!Number.isFinite(valCad) || valCad <= 0) continue;

        const cleanSym = (a.symbol ?? '').trim().toUpperCase();
        if (!cleanSym) continue;
        const matched = resolveFinanceAISymbol(cleanSym, cleanSym, a.name);
        const assetId = matched?.id ?? cleanSym;
        const fund = resolveAssetFundamental(cleanSym);

        totalPortfolioCad += valCad;
        heldRaw.push({
            asset: a,
            assetId,
            ticker: matched?.ticker ?? cleanSym,
            valCad,
            categoryLabel: matched?.categoryLabel ?? fund.assetClass,
            sectorLabel: a.sector || matched?.sector || fund.assetClass,
        });
    }

    const heldWeightsByAssetId: Record<string, number> = {};
    const uniqueTickers: string[] = [];
    const seenTickers = new Set<string>();

    for (const h of heldRaw) {
        if (totalPortfolioCad > 0) {
            heldWeightsByAssetId[h.assetId] =
                (heldWeightsByAssetId[h.assetId] ?? 0) + h.valCad / totalPortfolioCad;
        }
        if (!seenTickers.has(h.ticker)) {
            seenTickers.add(h.ticker);
            uniqueTickers.push(h.ticker);
        }
    }

    const macro: MacroIndicators = { ...MARKET_REGIMES[0].indicators };
    let liveArticles: RawNewsFeedItem[] = [];
    let liveNetworkSucceeded = false;

    if (!input.skipNetwork && typeof fetch === 'function' && !input.signal?.aborted) {
        const { controller, cleanup } = buildCombinedAbortController(input.signal, NETWORK_TIMEOUT_MS);
        try {
            const tickerParam = encodeURIComponent(uniqueTickers.slice(0, 10).join(','));
            const fetchNews = async (): Promise<RawNewsFeedItem[]> => {
                if (uniqueTickers.length === 0) return [];
                try {
                    const primary = await fetchJsonSafe(
                        `/api/news/intelligence?tickers=${tickerParam}`,
                        controller.signal,
                    );
                    if (primary.ok && primary.data && typeof primary.data === 'object') {
                        const obj = primary.data as { articles?: unknown };
                        if (Array.isArray(obj.articles)) {
                            liveNetworkSucceeded = true;
                            return normalizeRawNewsFeedItems(obj.articles);
                        }
                    }
                    if (primary.status === 404) {
                        const alt = await fetchJsonSafe(
                            `/api/valoria/news?tickers=${tickerParam}`,
                            controller.signal,
                        );
                        if (alt.ok && alt.data && typeof alt.data === 'object') {
                            const obj = alt.data as { articles?: unknown };
                            if (Array.isArray(obj.articles)) {
                                liveNetworkSucceeded = true;
                                return normalizeRawNewsFeedItems(obj.articles);
                            }
                        }
                    }
                } catch {
                    // Best-effort silencieux
                }
                return [];
            };

            const fetchMarket = async (): Promise<void> => {
                try {
                    const primary = await fetchJsonSafe('/api/market/verified-feed', controller.signal);
                    let data = primary.ok ? primary.data : null;
                    if (!primary.ok && primary.status === 404) {
                        const alt = await fetchJsonSafe('/api/valoria/market', controller.signal);
                        if (alt.ok) data = alt.data;
                    }
                    if (data && typeof data === 'object') {
                        liveNetworkSucceeded = true;
                        const rec = data as {
                            macro?: Partial<MacroIndicators>;
                            inflationPct?: number;
                            centralBankRatePct?: number;
                        };
                        if (rec.macro) {
                            if (typeof rec.macro.inflationPct === 'number' && Number.isFinite(rec.macro.inflationPct)) {
                                macro.inflationPct = rec.macro.inflationPct;
                            }
                            if (
                                typeof rec.macro.centralBankRatePct === 'number' &&
                                Number.isFinite(rec.macro.centralBankRatePct)
                            ) {
                                macro.centralBankRatePct = rec.macro.centralBankRatePct;
                            }
                            if (typeof rec.macro.vixLevel === 'number' && Number.isFinite(rec.macro.vixLevel)) {
                                macro.vixLevel = rec.macro.vixLevel;
                            }
                        }
                    }
                } catch {
                    // Best-effort silencieux
                }
            };

            const [articlesRes] = await Promise.allSettled([fetchNews(), fetchMarket()]);
            if (articlesRes.status === 'fulfilled') {
                liveArticles = articlesRes.value;
            }
        } catch {
            // Repli déterministe complet
        } finally {
            cleanup();
        }
    }

    const candidateAssetIds = Object.keys(heldWeightsByAssetId);
    const newsIntel = buildPortfolioNewsIntelligence({
        heldWeightsByAssetId,
        candidateAssetIds,
        liveArticles,
        macro,
    });

    const hasHoldings = heldRaw.length > 0 && totalPortfolioCad > 0;
    const portfolioSentimentScore = hasHoldings ? newsIntel.portfolioSentimentScore : null;
    const portfolioSentimentLabel = hasHoldings
        ? newsIntel.portfolioSentimentLabel
        : 'Neutre (aucun titre évalué)';
    const annualizedReturnAdjustmentPct = hasHoldings
        ? round2(Math.max(-2.5, Math.min(2.5, newsIntel.portfolioAnnualizedReturnImpactPct)))
        : 0;

    let weightedVolMult = 0;
    let volWeightSum = 0;
    for (const [assetId, w] of Object.entries(heldWeightsByAssetId)) {
        const sum = newsIntel.byAssetId.get(assetId);
        if (sum && w > 0) {
            weightedVolMult += sum.omegaUncertaintyMultiplier * w;
            volWeightSum += w;
        }
    }
    const volatilityMultiplier =
        volWeightSum > 0 ? round2(Math.max(0.9, Math.min(1.35, weightedVolMult / volWeightSum))) : 1.0;

    const macroHeadlineFr =
        newsIntel.macroHeadlineSummary ||
        newsIntel.macroArticles[0]?.title ||
        'Conditions macroéconomiques canadiennes et mondiales équilibrées';

    const rawSignals = [
        ...newsIntel.macroArticles.slice(0, 2),
        ...newsIntel.topPortfolioArticles.slice(0, 4),
    ];
    const keySignals: MacroNewsSignalItem[] = rawSignals.slice(0, 6).map((art) => ({
        id: art.id,
        title: art.title,
        category: art.categoryLabel,
        impactLabel: `${art.sentimentLabel} (${art.expectedReturnShockPct >= 0 ? '+' : ''}${art.expectedReturnShockPct.toFixed(1).replace('.', ',')} %/an)`,
        plainFrench: art.plainFrenchImpact,
        direction: art.sentimentScore >= 14 ? 'positif' : art.sentimentScore <= -12 ? 'risque' : 'neutre',
        isLive: Boolean(art.isLiveWeb),
    }));

    const liveArticlesUsed = Math.max(
        newsIntel.liveArticlesCount,
        liveArticles.filter((a) => a && typeof a.title === 'string' && a.title.trim().length > 0).length,
    );
    const offlineFallbackUsed = !liveNetworkSucceeded;

    // Consolidation des slots anonymisés ACTIF_01..12 pour synthèse Gemini optionnelle
    const consolidatedSlots = new Map<string, AnonymizedHoldingSlot>();
    const forbiddenTokens: string[] = [];
    for (const h of heldRaw) {
        forbiddenTokens.push(h.asset.symbol, h.ticker, h.assetId);
        if (h.asset.name) forbiddenTokens.push(h.asset.name);
        const existing = consolidatedSlots.get(h.assetId);
        const wPct = totalPortfolioCad > 0 ? (h.valCad / totalPortfolioCad) * 100 : 0;
        const assetNews = newsIntel.byAssetId.get(h.assetId);
        if (existing) {
            existing.weightPct = round2(existing.weightPct + wPct);
        } else {
            consolidatedSlots.set(h.assetId, {
                code: 'ACTIF_00',
                weightPct: round2(wPct),
                categoryLabel: h.categoryLabel,
                sectorLabel: h.sectorLabel,
                accountTypeLabel: mapAccountBucketLabel(h.asset.accountType),
                sentimentScore:
                    assetNews && assetNews.articleCount > 0 ? assetNews.compositeSentimentScore : null,
            });
        }
    }
    for (const a of ASSETS) {
        if (heldWeightsByAssetId[a.id]) {
            forbiddenTokens.push(a.ticker, a.id, a.name);
        }
    }

    const sortedSlots = Array.from(consolidatedSlots.values())
        .sort((a, b) => b.weightPct - a.weightPct)
        .slice(0, 12)
        .map((slot, idx) => ({
            ...slot,
            code: `ACTIF_${String(idx + 1).padStart(2, '0')}`,
        }));

    let aiSynthesisFr = buildDeterministicNewsSynthesisFr({
        hasHoldings,
        portfolioSentimentScore,
        portfolioSentimentLabel,
        annualizedReturnAdjustmentPct,
        volatilityMultiplier,
        macroHeadlineFr,
        valoriaConsensus100: hasHoldings ? (valoriaForecast?.portfolioConsensus100 ?? null) : null,
    });
    let usedGemini = false;

    const cleanApiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
    const canCallGemini =
        !input.skipNetwork &&
        !input.signal?.aborted &&
        cleanApiKey.length >= 10 &&
        !DUMMY_KEY_PATTERNS.test(cleanApiKey);

    if (canCallGemini) {
        try {
            const prompt = buildAnonymizedNewsAndMacroPrompt({
                slots: sortedSlots,
                portfolioSentimentScore,
                annualizedReturnAdjustmentPct,
                volatilityMultiplier,
                horizonYears,
                macroHeadlineFr,
                forbiddenTokens,
            });
            const geminiText = await chat([{ role: 'user', content: prompt }], cleanApiKey, {
                model: MODEL_HAIKU,
                system: `Tu es analyste macroéconomique canadien (Québec/Canada, en dollars canadiens CAD).\n${PROMPT_DATA_ISOLATION_NOTE}`,
                maxTokens: 450,
                signal: input.signal,
                timeoutMs: NETWORK_TIMEOUT_MS,
            });
            const trimmed = geminiText.trim();
            if (trimmed.length >= 12) {
                aiSynthesisFr = trimmed;
                usedGemini = true;
            }
        } catch {
            // Capture silencieusement toute erreur Gemini et conserve le repli déterministe français
        }
    }

    return {
        newsBundle: {
            collectedAtIso: new Date().toISOString(),
            liveArticlesUsed,
            offlineFallbackUsed,
            portfolioSentimentScore,
            portfolioSentimentLabel,
            annualizedReturnAdjustmentPct,
            volatilityMultiplier,
            macroHeadlineFr,
            keySignals,
            aiSynthesisFr,
            usedGemini,
        },
        valoriaForecast,
    };
}
