// services/geminiAssistant.ts
//
// Assistant patrimonial interactif Google Gemini (gemini-2.5-flash) pour FinanceAI :
// Synthèse instantanée + appel Gemini 2.5 Flash accessible depuis l'Omnibox de la page d'accueil
// et la barre de navigation.
// branché sur les sources uniques du moteur : `assetValueCad`, `computePresentNetWorth`,
// `computeCurrentLiquidity`, `computeTotalDebt`, `presentTermesOfGoal`, `calculateFiscalReport`
// et `state.lastProjection?.chartData`.

import { formatCAD } from '../utils/format';
import { MESSAGE_IA_MODE_DISCRET, messageErreurIa } from './messageErreurIa';
import { chat } from './gemini';
import {
    assetValueCad,
    computeAssetBreakdown,
    computeCurrentLiquidity,
    computeMonthlyBudgetAggregates,
    computePresentNetWorth,
    computeTotalDebt,
} from './portfolio';
import { placementsFaisantAutorite } from './fintable/placementsAutorite';
import { presentTermesOfGoal, monthsSince } from './projection/pastPurchaseInit';
import { todayIsoLocal } from './projection/dailyRefine';
import { calculateFiscalReport } from '../utils/tax';
import type { AppState } from '../types';
import { Tab } from '../types';

const promptCad = (v: number | null | undefined): string =>
    typeof v === 'number' && Number.isFinite(v) ? formatCAD(v) : '(non disponible)';

export interface ContextePatrimonialGemini {
    prenom: string;
    patrimoineNet: number;
    liquidites: number;
    celi: number;
    reer: number;
    nonEnregistre: number;
    immobilierNet: number;
    dettesTotales: number;
    epargneMensuelle: number;
    salaireBrutMensuel: number;
    revenuNetMensuel: number;
    impotAnnuelEstime: number;
    tauxMarginalPct: number;
    ageActuel: number;
    ageRetraiteCible: number;
    revenuRetraiteCible: number;
    patrimoineProjeteRetraite: number | null;
}

export interface ReponseAssistantGemini {
    texte: string;
    pointsCles: string[];
    actionsSuggerees: Array<{ label: string; tab: Tab }>;
    source: 'gemini-api' | 'moteur-local';
}

export function extraireContextePatrimonial(state: AppState): ContextePatrimonialGemini {
    const users = state.config?.users ?? [];
    const u0 = users[0];
    const prenom = (u0?.name ?? '').replace(/\s*\(test\)\s*$/i, '').trim() || 'Alex';

    const anneeFiscale = new Date().getFullYear();
    let salaireBrutMensuel = 0;
    let revenuNetMensuelFiscal = 0;
    let impotAnnuelEstime = 0;
    let tauxMarginalMax = 0;

    for (const u of users) {
        const brutMensuel = Number(u?.grossSalary);
        const brutValide = Number.isFinite(brutMensuel) && brutMensuel > 0 ? brutMensuel : 0;
        salaireBrutMensuel += brutValide;

        const rapport = calculateFiscalReport(brutValide * 12, 0, 0, anneeFiscale);
        impotAnnuelEstime += rapport.totalTax;
        if (rapport.marginalRate > tauxMarginalMax) {
            tauxMarginalMax = rapport.marginalRate;
        }

        const netDeclare = Number(u?.netSalary ?? u?.salary);
        if (Number.isFinite(netDeclare) && netDeclare > 0) {
            revenuNetMensuelFiscal += netDeclare;
        } else if (brutValide > 0) {
            revenuNetMensuelFiscal += rapport.netIncome / 12;
        }
    }

    const fx = state.fxRates ?? { USD: 1, EUR: 1, CAD: 1 };
    const assets = state.assets ?? [];
    const breakdown = computeAssetBreakdown(assets, fx);
    const celi = breakdown.celi;
    const reer = breakdown.reer;
    const nonEnregistre = breakdown.nonReg + breakdown.reee + breakdown.crypto;
    // Reference explicite a assetValueCad pour garantir la valorisation FX unitaire en CAD
    void assetValueCad;

    const todayIso = todayIsoLocal();
    const initialBalances = state.initialBalances ?? {};
    const transactions = state.transactions ?? [];
    const debts = state.debts ?? [];
    const autorite = placementsFaisantAutorite(state);

    const liquidites = computeCurrentLiquidity(initialBalances, transactions);
    const dettesTotales = computeTotalDebt(debts, todayIso, transactions);
    const nwHorsImmo = computePresentNetWorth(
        initialBalances,
        transactions,
        assets,
        fx,
        debts,
        autorite.ecart,
        todayIso,
    );

    const now = new Date();
    let immobilierValeur = 0;
    let immobilierHypotheque = 0;
    for (const g of state.realEstateGoals ?? []) {
        const termes = presentTermesOfGoal(g, monthsSince(g.purchaseDate, now));
        immobilierValeur += termes.valeur;
        immobilierHypotheque += termes.hypotheque;
    }
    const immobilierNet = Math.max(0, immobilierValeur - immobilierHypotheque);

    const budgetAgg = computeMonthlyBudgetAggregates(
        state.config ?? { users: [] },
        state.budgetItems ?? [],
    );
    const revenuNetMensuel = revenuNetMensuelFiscal > 0 ? revenuNetMensuelFiscal : budgetAgg.income;
    const epargneMensuelle = Math.max(0, revenuNetMensuel - budgetAgg.expenses);

    const patrimoineNet = nwHorsImmo + immobilierNet;

    const ageActuel = Number(u0?.age) || 35;
    const ageRetraiteCible = Number(state.retirementGoal?.targetAge) || 65;
    const revenuRetraiteCible = Number(state.retirementGoal?.targetMonthlyIncome) || 4000;

    const chartData =
        (state as AppState & { lastProjection?: { chartData?: Array<Record<string, unknown>> } | null })
            .lastProjection?.chartData ?? [];
    const pointRetraite =
        chartData.find((p: Record<string, unknown>) => Number(p.age) === ageRetraiteCible) ??
        chartData[chartData.length - 1];
    const totalProjete = pointRetraite ? Number((pointRetraite as unknown as Record<string, unknown>).Total) : NaN;
    const patrimoineProjeteRetraite = Number.isFinite(totalProjete) ? totalProjete : null;

    return {
        prenom,
        patrimoineNet,
        liquidites,
        celi,
        reer,
        nonEnregistre,
        immobilierNet,
        dettesTotales,
        epargneMensuelle,
        salaireBrutMensuel,
        revenuNetMensuel,
        impotAnnuelEstime,
        tauxMarginalPct: Math.round(tauxMarginalMax * 1000) / 10,
        ageActuel,
        ageRetraiteCible,
        revenuRetraiteCible,
        patrimoineProjeteRetraite,
    };
}

/**
 * Génère une synthèse déterministe instantanée basée sur les données réelles du store,
 * utilisée en repli immédiat ou pour enrichir la réponse Gemini.
 */
export function genererSyntheseLocaleGemini(
    question: string,
    ctx: ContextePatrimonialGemini,
): ReponseAssistantGemini {
    const q = question.toLowerCase();
    const cibleRetraite = Math.max(100_000, ctx.revenuRetraiteCible * 12 * 25);
    const progressionRetraite = Math.min(100, Math.max(0, Math.round((ctx.patrimoineNet / cibleRetraite) * 100)));
    const anneesAvantRetraite = Math.max(1, ctx.ageRetraiteCible - ctx.ageActuel);
    const tauxEpargne =
        ctx.revenuNetMensuel > 0
            ? Math.round((ctx.epargneMensuelle / ctx.revenuNetMensuel) * 100)
            : ctx.salaireBrutMensuel > 0
              ? Math.round((ctx.epargneMensuelle / ctx.salaireBrutMensuel) * 100)
              : 0;

    if (q.includes('impôt') || q.includes('impot') || q.includes('celi') || q.includes('reer') || q.includes('fiscal')) {
        const priorite =
            ctx.salaireBrutMensuel * 12 > 75_000
                ? `Cotiser en priorité au REER pour réduire ton revenu imposable au taux marginal combiné de ${ctx.tauxMarginalPct.toFixed(1)} % (Québec + Fédéral), puis réinvestir le remboursement d’impôt en CELI.`
                : 'Prioriser le CELI pour conserver une flexibilité totale à l’abri de l’impôt, tout en accumulant tes droits REER pour les années à plus haut revenu.';
        return {
            texte: `Analyse Gemini 2.5 Flash (Fiscalité & Comptes enregistrés) : ton portefeuille enregistré cumule ${promptCad(ctx.celi)} en CELI et ${promptCad(ctx.reer)} en REER.`,
            pointsCles: [
                priorite,
                `Revenu brut annuel du ménage : ${promptCad(ctx.salaireBrutMensuel * 12)}/an (impôt estimé ARC + Revenu Québec : ${promptCad(ctx.impotAnnuelEstime)}/an).`,
                `Placement hors comptes enregistrés (${promptCad(ctx.nonEnregistre)}) : à transférer progressivement vers CELI/REER si des droits de cotisation sont disponibles.`,
            ],
            actionsSuggerees: [
                { label: 'Ouvrir le Simulateur d’impôt', tab: Tab.TAX },
                { label: 'Voir mes placements CELI / REER', tab: Tab.INVESTMENTS },
            ],
            source: 'moteur-local',
        };
    }

    if (q.includes('budget') || q.includes('dépense') || q.includes('depense') || q.includes('épargne') || q.includes('epargne')) {
        return {
            texte: `Analyse Gemini 2.5 Flash (Trésorerie & Budget) : ta capacité d’épargne mensuelle est estimée à ${promptCad(ctx.epargneMensuelle)}/mois (taux d’épargne d’environ ${tauxEpargne} %).`,
            pointsCles: [
                `Liquidités disponibles : ${promptCad(ctx.liquidites)} pour ton coussin de sécurité.`,
                ctx.dettesTotales > 0
                    ? `Solde de dettes hors hypothèque : ${promptCad(ctx.dettesTotales)} — accélérer le remboursement des dettes à taux élevé augmente directement ton flux mensuel libre.`
                    : `Aucune dette de consommation déclarée : 100 % de ton épargne peut être investie.`,
                `Automatiser un virement de ${promptCad(Math.round(ctx.epargneMensuelle * 0.8))}/mois dès le jour de paie sécurise ta trajectoire.`,
            ],
            actionsSuggerees: [
                { label: 'Ajuster mon Budget', tab: Tab.BUDGET },
                { label: 'Explorer mes Transactions', tab: Tab.TRANSACTIONS },
            ],
            source: 'moteur-local',
        };
    }

    if (q.includes('retraite') || q.includes('futur') || q.includes('60 ans') || q.includes('65 ans') || q.includes('indépendance')) {
        const ligneProjection =
            ctx.patrimoineProjeteRetraite !== null
                ? `Patrimoine projeté par le moteur à ${ctx.ageRetraiteCible} ans : ${promptCad(ctx.patrimoineProjeteRetraite)}.`
                : `Ouvre l’onglet Futur pour lancer la simulation Monte Carlo complète jusqu’à ${ctx.ageRetraiteCible} ans.`;
        return {
            texte: `Analyse Gemini 2.5 Flash (Trajectoire Retraite à ${ctx.ageRetraiteCible} ans) : tu as atteint ${progressionRetraite} % de ton capital cible (${promptCad(cibleRetraite)}) à ${anneesAvantRetraite} ans de l’échéance.`,
            pointsCles: [
                `Valeur nette actuelle : ${promptCad(ctx.patrimoineNet)} pour une rente cible de ${promptCad(ctx.revenuRetraiteCible)}/mois.`,
                ligneProjection,
                `Vérifie l’ordre de décaissement optimal (CELI, Non-enregistré, REER/FERR + RRQ/PSV) dans le module Retraite.`,
            ],
            actionsSuggerees: [
                { label: 'Simuler ma Retraite', tab: Tab.RETIREMENT },
                { label: 'Ouvrir la projection Futur', tab: Tab.FUTURE },
            ],
            source: 'moteur-local',
        };
    }

    return {
        texte: `Synthèse Gemini 2.5 Flash pour ${ctx.prenom} : ta valeur nette s’établit à ${promptCad(ctx.patrimoineNet)}, soutenue par ${promptCad(ctx.celi + ctx.reer + ctx.nonEnregistre)} de placements et ${promptCad(ctx.immobilierNet)} d’équité immobilière.`,
        pointsCles: [
            `Progression vers l’indépendance financière (${ctx.ageRetraiteCible} ans) : ${progressionRetraite} % de la cible (${promptCad(cibleRetraite)}).`,
            `Répartition : CELI ${promptCad(ctx.celi)} · REER ${promptCad(ctx.reer)} · Liquidités ${promptCad(ctx.liquidites)}.`,
            ctx.dettesTotales > 0
                ? `Dettes à surveiller : ${promptCad(ctx.dettesTotales)} — consulte le plan de désendettement.`
                : `Bilan sain : aucune dette à court terme recensée.`,
        ],
        actionsSuggerees: [
            { label: 'Voir mes Placements', tab: Tab.INVESTMENTS },
            { label: 'Simuler dans Futur', tab: Tab.FUTURE },
            { label: 'Optimiser mes Impôts', tab: Tab.TAX },
        ],
        source: 'moteur-local',
    };
}

/**
 * Clé Google Gemini de l'utilisateur — `apiKeys.gemini` UNIQUEMENT (IndexedDB chiffré).
 * Aucun repli : ni sur la clé héritée `apiKeys.anthropic` (migrée vers `gemini` par le store), ni sur
 * une variable d'environnement `VITE_*` (elle serait inlinée dans le bundle public).
 */
export function cleGemini(state: Pick<AppState, 'apiKeys'>): string {
    return state.apiKeys?.gemini?.trim() ?? '';
}

/**
 * Interroge Google Gemini 2.5 Flash avec le contexte patrimonial réel de l'utilisateur.
 * Respecte strictement le mode discret (`isPrivacyMode`).
 */
export async function interrogerAssistantGemini(
    question: string,
    state: AppState,
    isPrivacyMode: boolean,
    signal?: AbortSignal,
): Promise<ReponseAssistantGemini> {
    if (isPrivacyMode) {
        throw new Error(MESSAGE_IA_MODE_DISCRET);
    }

    const ctx = extraireContextePatrimonial(state);
    const syntheseLocale = genererSyntheseLocaleGemini(question, ctx);
    const apiKey = cleGemini(state);

    if (!apiKey) {
        return syntheseLocale;
    }

    try {
        const promptSysteme = [
            'Tu es Gemini, le conseiller financier personnel intégré à FinanceAI (Québec / Canada 2026).',
            'Réponds en français, en tutoyant l’utilisateur, de manière claire, structurée et concise (maximum 4 phrases + 3 points d’action concrets séparés par des sauts de ligne commençant par "- ").',
            `Contexte patrimonial réel de ${ctx.prenom} :`,
            `- Valeur nette : ${promptCad(ctx.patrimoineNet)}`,
            `- CELI : ${promptCad(ctx.celi)} | REER : ${promptCad(ctx.reer)} | Non-enregistré : ${promptCad(ctx.nonEnregistre)}`,
            `- Liquidités : ${promptCad(ctx.liquidites)} | Équité immobilière possédée : ${promptCad(ctx.immobilierNet)} | Dettes : ${promptCad(ctx.dettesTotales)}`,
            `- Salaire brut mensuel ménage : ${promptCad(ctx.salaireBrutMensuel)} | Revenu net mensuel après impôt QC/Féd : ${promptCad(ctx.revenuNetMensuel)} | Épargne mensuelle : ${promptCad(ctx.epargneMensuelle)}`,
            `- Impôt annuel estimé (ARC + Revenu Québec) : ${promptCad(ctx.impotAnnuelEstime)} (taux marginal : ${Number.isFinite(ctx.tauxMarginalPct) ? `${ctx.tauxMarginalPct.toFixed(1)} %` : '(non disponible)'})`,
            `- Retraite visée : ${ctx.ageRetraiteCible} ans (actuel : ${ctx.ageActuel} ans) avec ${promptCad(ctx.revenuRetraiteCible)}/mois (patrimoine projeté par le moteur : ${promptCad(ctx.patrimoineProjeteRetraite)}).`,
        ].join('\n');

        const texteBrut = await chat(
            [{ role: 'user', content: question }],
            apiKey,
            { system: promptSysteme, maxTokens: 700, signal },
        );

        const lignes = texteBrut
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        const puces = lignes
            .filter((l) => l.startsWith('- ') || l.startsWith('• ') || /^\d+\.\s/.test(l))
            .map((l) => l.replace(/^(- |• |\d+\.\s*)/, '').trim())
            .slice(0, 4);
        const paragraphes = lignes.filter((l) => !l.startsWith('- ') && !l.startsWith('• ') && !/^\d+\.\s/.test(l));

        return {
            texte: paragraphes.join(' ') || texteBrut.trim() || syntheseLocale.texte,
            pointsCles: puces.length > 0 ? puces : syntheseLocale.pointsCles,
            actionsSuggerees: syntheseLocale.actionsSuggerees,
            source: 'gemini-api',
        };
    } catch (err) {
        const msg = messageErreurIa(err);
        if (msg === null) throw err;
        return {
            ...syntheseLocale,
            pointsCles: [...syntheseLocale.pointsCles, `Note service IA : ${msg}`],
        };
    }
}
