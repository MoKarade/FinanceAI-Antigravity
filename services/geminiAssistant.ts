// services/geminiAssistant.ts
//
// Assistant patrimonial interactif Google Gemini (gemini-3.8-flash) pour FinanceAI :
// Synthèse instantanée + appel Gemini accessible depuis l'Omnibox de la page d'accueil
// et la barre de navigation.
// branché sur les sources uniques du moteur : `assetValueCad`, `computePresentNetWorth`,
// `computeCurrentLiquidity`, `computeTotalDebt`, `presentTermesOfGoal`, `calculateFiscalReport`
// et `state.lastProjection?.chartData`.

import { formatCAD } from '../utils/format';
import { cleanGeminiApiKey } from './aiChat/geminiCore';
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
    for (const rp of state.rentalProperties ?? []) {
        const val = Number.isFinite(rp.currentValue) ? rp.currentValue : 0;
        const mort = Number.isFinite(rp.mortgageBalance) ? rp.mortgageBalance : 0;
        immobilierValeur += val;
        immobilierHypotheque += mort;
    }
    let entreprisesValeur = 0;
    for (const pb of state.privateBusinesses ?? []) {
        const val = Number.isFinite(pb.estimatedValue) ? pb.estimatedValue : 0;
        const pct = Number.isFinite(pb.ownershipPct) ? pb.ownershipPct / 100 : 1;
        entreprisesValeur += val * pct;
    }
    const immobilierNet = immobilierValeur - immobilierHypotheque;

    const budgetAgg = computeMonthlyBudgetAggregates(
        state.config ?? { users: [] },
        state.budgetItems ?? [],
    );
    const revenuNetMensuel = revenuNetMensuelFiscal > 0 ? revenuNetMensuelFiscal : budgetAgg.income;
    const epargneMensuelle = Math.max(0, revenuNetMensuel - budgetAgg.expenses);

    const patrimoineNet = nwHorsImmo + immobilierNet + entreprisesValeur;

    const ageActuel = Number(u0?.age) || 35;
    const ageRetraiteCible = Number(state.retirementGoal?.targetAge) || 65;
    const revenuRetraiteCible = Number(state.retirementGoal?.targetMonthlyIncome) || 4000;

    const chartData =
        (state as AppState & { lastProjection?: { chartData?: Array<Record<string, unknown>> } | null })
            .lastProjection?.chartData ?? [];
    const pointRetraite =
        chartData.find((p: Record<string, unknown>) => Number(p.age) === ageRetraiteCible) ??
        chartData[chartData.length - 1];
    const recRetraite = pointRetraite as unknown as Record<string, unknown> | undefined;
    const totalProjete = recRetraite ? Number(recRetraite.NetWorth ?? recRetraite.Total) : NaN;
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
 * Génère un avis franc, direct et chiffré en 1 à 2 phrases sur le dossier de l'utilisateur
 * (affiché tout en haut du chat avant le détail).
 */
export function genererAvisHonneteDossier(
    ctx: ContextePatrimonialGemini,
    question = '',
): string {
    const q = question.toLowerCase();
    const tauxEpargne =
        ctx.revenuNetMensuel > 0
            ? Math.round((ctx.epargneMensuelle / ctx.revenuNetMensuel) * 100)
            : ctx.salaireBrutMensuel > 0
              ? Math.round((ctx.epargneMensuelle / ctx.salaireBrutMensuel) * 100)
              : 0;
    const cibleRetraite = Math.max(100_000, ctx.revenuRetraiteCible * 12 * 25);
    const progressionRetraite = Math.min(100, Math.max(0, Math.round((ctx.patrimoineNet / cibleRetraite) * 100)));

    if (q.includes('impôt') || q.includes('impot') || q.includes('celi') || q.includes('reer') || q.includes('fiscal')) {
        return ctx.salaireBrutMensuel * 12 > 75_000
            ? `Soyons francs : avec un taux marginal de ${ctx.tauxMarginalPct.toFixed(1)} %, chaque dollar non cotisé en REER te coûte cher en impôt ARC/Revenu Québec — priorise le REER puis réinvestis le remboursement en CELI.`
            : `L’heure juste : ton CELI (${promptCad(ctx.celi)}) doit passer avant le REER à ton palier fiscal actuel pour garder 100 % de ta croissance libre d’impôt et accessible.`;
    }
    if (q.includes('budget') || q.includes('dépense') || q.includes('depense') || q.includes('transaction') || q.includes('octobre') || q.includes('novembre')) {
        return ctx.dettesTotales > 0
            ? `Soyons directs : tu dégages ${promptCad(ctx.epargneMensuelle)}/mois (${tauxEpargne} %), mais tes ${promptCad(ctx.dettesTotales)} de dettes freinent ton enrichissement — attaque la dette la plus coûteuse et automatise le reste le jour de paie.`
            : `Verdict franc : ton taux d’épargne est à ${tauxEpargne} % (${promptCad(ctx.epargneMensuelle)}/mois) sans dette court terme — le vrai levier maintenant est de verrouiller ton virement dès la paie pour éviter la dérive des dépenses variables.`;
    }
    if (q.includes('retraite') || q.includes('futur') || q.includes('60 ans') || q.includes('65 ans')) {
        return progressionRetraite >= 50
            ? `En bref : tu es déjà à ${progressionRetraite} % de ta cible retraite (${promptCad(cibleRetraite)}) — ta trajectoire est solide, l’enjeu est maintenant d’optimiser l’ordre de décaissement futur.`
            : `Sans détour : à ${progressionRetraite} % de ta cible de ${promptCad(cibleRetraite)} pour ${ctx.ageRetraiteCible} ans, c’est la régularité de tes ${promptCad(ctx.epargneMensuelle)}/mois investis en CELI/REER qui fera toute la différence.`;
    }
    if (ctx.dettesTotales > 0) {
        return `En toute franchise : ta valeur nette atteint ${promptCad(ctx.patrimoineNet)} avec ${promptCad(ctx.epargneMensuelle)}/mois d’épargne (${tauxEpargne} %), mais éliminer tes ${promptCad(ctx.dettesTotales)} de dettes hors hypothèque reste ton rendement garanti numéro 1.`;
    }
    if (tauxEpargne >= 20) {
        return `Verdict honnête : ta base est très saine (${promptCad(ctx.patrimoineNet)} de valeur nette, ${tauxEpargne} % d’épargne mensuelle soit ${promptCad(ctx.epargneMensuelle)}/mois) — ne laisse pas dormir trop de liquidités (${promptCad(ctx.liquidites)}) hors du CELI/REER.`;
    }
    return `L’heure juste sur ton dossier : ta valeur nette est à ${promptCad(ctx.patrimoineNet)} avec ${promptCad(ctx.epargneMensuelle)}/mois d’épargne (${tauxEpargne} %) — viser 20 % d’épargne automatisée le jour de paie accélérera nettement ton cap vers ${ctx.ageRetraiteCible} ans.`;
}

/**
 * Découpe le texte d'une réponse de l'assistant entre l'avis honnête rapide (en haut)
 * et le détail explicatif (en dessous).
 */
export function decouperAvisHonnete(
    texte: string,
    ctxFallback?: ContextePatrimonialGemini,
): { avis: string | null; detail: string } {
    const brut = texte.trim();
    if (!brut) return { avis: null, detail: '' };

    const matchPrefixe = brut.match(/^(?:\*\*|##\s*)?AVIS\s+HONN[ÊE]TE(?:\s*[·:—-]\s*|\*\*[\s:—-]*)(.+?)(?:\n\n|\r\n\r\n|$)([\s\S]*)$/i);
    if (matchPrefixe) {
        const avis = matchPrefixe[1].trim();
        const reste = matchPrefixe[2].trim();
        return {
            avis: avis || null,
            detail: reste || avis,
        };
    }

    const blocs = brut.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
    if (blocs.length >= 2) {
        const premier = blocs[0].replace(/^(?:\*\*|##\s*)?Avis\s+honn[êe]te\s*[:—-]?\s*/i, '').trim();
        return {
            avis: premier,
            detail: blocs.slice(1).join('\n\n'),
        };
    }

    if (ctxFallback && brut.length > 90) {
        return {
            avis: genererAvisHonneteDossier(ctxFallback, brut),
            detail: brut,
        };
    }

    return { avis: null, detail: brut };
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
    const avis = genererAvisHonneteDossier(ctx, question);
    const cibleRetraite = Math.max(100_000, ctx.revenuRetraiteCible * 12 * 25);
    const progressionRetraite = Math.min(100, Math.max(0, Math.round((ctx.patrimoineNet / cibleRetraite) * 100)));
    const anneesAvantRetraite = Math.max(1, ctx.ageRetraiteCible - ctx.ageActuel);
    const tauxEpargne =
        ctx.revenuNetMensuel > 0
            ? Math.round((ctx.epargneMensuelle / ctx.revenuNetMensuel) * 100)
            : ctx.salaireBrutMensuel > 0
              ? Math.round((ctx.epargneMensuelle / ctx.salaireBrutMensuel) * 100)
              : 0;

    if (q.includes('plan') || q.includes('action') || q.includes('jour') || q.includes('semaine') || q.includes('mois') || q.includes('décennie') || q.includes('decennie') || q.includes('quoi faire')) {
        const epargneJour = Math.round(ctx.epargneMensuelle / 30);
        const epargneSemaine = Math.round((ctx.epargneMensuelle * 12) / 52);
        const epargneAn = Math.round(ctx.epargneMensuelle * 12);
        return {
            texte: `AVIS HONNÊTE : ${avis}\n\nPlan d’action Gemini 3.8 Flash pour ${ctx.prenom} : ta feuille de route décline ton épargne de ${promptCad(ctx.epargneMensuelle)}/mois en gestes concrets par jour (${promptCad(epargneJour)}/j), par semaine (${promptCad(epargneSemaine)}/sem) et par année (${promptCad(epargneAn)}/an).`,
            pointsCles: [
                `Par jour & semaine : plafonne les dépenses variables courantes et vire automatiquement ${promptCad(epargneSemaine)} chaque jeudi de paie vers tes comptes enregistrés.`,
                `Par mois & année : répartis ${promptCad(ctx.epargneMensuelle)}/mois entre CELI (${promptCad(ctx.celi)} accumulé) et REER (${promptCad(ctx.reer)} accumulé, taux marginal ${ctx.tauxMarginalPct.toFixed(1)} %).`,
                `Par décennie : vise le cap de retraite à ${ctx.ageRetraiteCible} ans (${promptCad(cibleRetraite)}) avec décaissement fiscalement optimal (CELI → Non-enregistré → REER/FERR + RRQ/PSV).`,
            ],
            actionsSuggerees: [
                { label: 'Ouvrir le Plan d’action (Futur)', tab: Tab.FUTURE },
                { label: 'Ajuster mon Budget', tab: Tab.BUDGET },
            ],
            source: 'moteur-local',
        };
    }

    if (q.includes('impôt') || q.includes('impot') || q.includes('celi') || q.includes('reer') || q.includes('fiscal')) {
        const priorite =
            ctx.salaireBrutMensuel * 12 > 75_000
                ? `Cotiser en priorité au REER pour réduire ton revenu imposable au taux marginal combiné de ${ctx.tauxMarginalPct.toFixed(1)} % (Québec + Fédéral), puis réinvestir le remboursement d’impôt en CELI.`
                : 'Prioriser le CELI pour conserver une flexibilité totale à l’abri de l’impôt, tout en accumulant tes droits REER pour les années à plus haut revenu.';
        return {
            texte: `AVIS HONNÊTE : ${avis}\n\nAnalyse Gemini 3.8 Flash (Fiscalité & Comptes enregistrés) : ton portefeuille enregistré cumule ${promptCad(ctx.celi)} en CELI et ${promptCad(ctx.reer)} en REER.`,
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

    if (q.includes('budget') || q.includes('dépense') || q.includes('depense') || q.includes('épargne') || q.includes('epargne') || q.includes('transaction') || q.includes('octobre') || q.includes('novembre')) {
        return {
            texte: `AVIS HONNÊTE : ${avis}\n\nAnalyse Gemini 3.8 Flash (Trésorerie, Transactions & Budget) : ta capacité d’épargne mensuelle est estimée à ${promptCad(ctx.epargneMensuelle)}/mois (taux d’épargne d’environ ${tauxEpargne} %).`,
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
            texte: `AVIS HONNÊTE : ${avis}\n\nAnalyse Gemini 3.8 Flash (Trajectoire Retraite à ${ctx.ageRetraiteCible} ans) : tu as atteint ${progressionRetraite} % de ton capital cible (${promptCad(cibleRetraite)}) à ${anneesAvantRetraite} ans de l’échéance.`,
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
        texte: `AVIS HONNÊTE : ${avis}\n\nSynthèse Gemini 3.8 Flash pour ${ctx.prenom} : ta valeur nette s’établit à ${promptCad(ctx.patrimoineNet)}, soutenue par ${promptCad(ctx.celi + ctx.reer + ctx.nonEnregistre)} de placements et ${promptCad(ctx.immobilierNet)} d’équité immobilière.`,
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
    return cleanGeminiApiKey(state.apiKeys?.gemini ?? '');
}
