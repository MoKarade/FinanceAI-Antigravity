// services/geminiAssistant.ts
//
// Assistant patrimonial interactif Google Gemini (gemini-3.8-flash) pour FinanceAI :
// Synthèse instantanée + appel Gemini 3.8 Flash accessible depuis l'Omnibox de la page d'accueil
// et la barre de navigation.

import { formatCAD } from '../utils/format';
import { MESSAGE_IA_MODE_DISCRET, messageErreurIa } from './messageErreurIa';
import { chat } from './claude';
import { GEMINI_DEFAULT_MODEL, estCleGemini, creerClientCompatibleGemini } from './geminiClientAdapter';
import type { AppState } from '../types';
import { Tab } from '../types';

export { GEMINI_DEFAULT_MODEL, estCleGemini, creerClientCompatibleGemini };

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
    ageActuel: number;
    ageRetraiteCible: number;
    revenuRetraiteCible: number;
}

export interface ReponseAssistantGemini {
    texte: string;
    pointsCles: string[];
    actionsSuggerees: Array<{ label: string; tab: Tab }>;
    source: 'gemini-api' | 'moteur-local';
}

export function extraireContextePatrimonial(state: AppState): ContextePatrimonialGemini {
    const u0 = state.config?.users?.[0];
    const prenom = (u0?.name ?? '').replace(/\s*\(test\)\s*$/i, '').trim() || 'Alex';
    const salaireBrutMensuel = (state.config?.users ?? []).reduce((s, u) => s + (Number(u.grossSalary) || 0), 0);

    let celi = 0;
    let reer = 0;
    let nonEnregistre = 0;
    for (const a of state.assets ?? []) {
        const val = (Number(a.quantity) || 0) * (Number(a.currentPrice) || 0);
        if (!Number.isFinite(val) || val <= 0) continue;
        const type = (a.accountType || '').toUpperCase();
        if (type.includes('CELI')) celi += val;
        else if (type.includes('REER') || type.includes('RRSP')) reer += val;
        else nonEnregistre += val;
    }

    const liquidites = Object.values(state.initialBalances ?? {}).reduce(
        (s, v) => s + (Number.isFinite(Number(v)) ? Number(v) : 0),
        0,
    );

    const immobilierNet = (state.realEstateGoals ?? []).reduce((s, g) => {
        const val = Number(g.currentValue ?? g.price) || 0;
        const hyp = Number(g.mortgageBalance) || Math.max(0, (Number(g.price) || 0) - (Number(g.downPayment) || 0));
        return s + Math.max(0, val - hyp);
    }, 0);

    const dettesTotales = (state.debts ?? []).reduce((s, d) => s + (Number(d.balance) || 0), 0);
    const depensesBudget = (state.budgetItems ?? [])
        .filter((b) => b.nature !== 'Epargne')
        .reduce((s, b) => s + (Number(b.target) || 0), 0);
    const epargneMensuelle = Math.max(0, salaireBrutMensuel * 0.68 - depensesBudget);

    const patrimoineNet = celi + reer + nonEnregistre + liquidites + immobilierNet - dettesTotales;

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
        ageActuel: Number(u0?.age) || 35,
        ageRetraiteCible: Number(state.retirementGoal?.targetAge) || 60,
        revenuRetraiteCible: Number(state.retirementGoal?.targetMonthlyIncome) || 4000,
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
        ctx.salaireBrutMensuel > 0 ? Math.round((ctx.epargneMensuelle / ctx.salaireBrutMensuel) * 100) : 0;

    if (q.includes('impôt') || q.includes('impot') || q.includes('celi') || q.includes('reer') || q.includes('fiscal')) {
        const priorite =
            ctx.salaireBrutMensuel * 12 > 75_000
                ? 'Cotiser en priorité au REER pour réduire ton revenu imposable aux paliers marginaux élevés (Québec + Fédéral), puis réinvestir le remboursement d’impôt en CELI.'
                : 'Prioriser le CELI pour conserver une flexibilité totale à l’abri de l’impôt, tout en accumulant tes droits REER pour les années à plus haut revenu.';
        return {
            texte: `Analyse Gemini Flash (Fiscalité & Comptes enregistrés) : ton portefeuille enregistré cumule ${formatCAD(ctx.celi)} en CELI et ${formatCAD(ctx.reer)} en REER.`,
            pointsCles: [
                priorite,
                `Revenu brut annuel estimé du ménage : ${formatCAD(ctx.salaireBrutMensuel * 12)}/an.`,
                `Placement hors comptes enregistrés (${formatCAD(ctx.nonEnregistre)}) : à transférer progressivement vers CELI/REER si des droits de cotisation sont disponibles.`,
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
            texte: `Analyse Gemini Flash (Trésorerie & Budget) : ta capacité d’épargne mensuelle est estimée à ${formatCAD(ctx.epargneMensuelle)}/mois (taux d’épargne d’environ ${tauxEpargne} %).`,
            pointsCles: [
                `Liquidités disponibles : ${formatCAD(ctx.liquidites)} pour ton coussin de sécurité.`,
                ctx.dettesTotales > 0
                    ? `Solde de dettes hors hypothèque : ${formatCAD(ctx.dettesTotales)} — accélérer le remboursement des dettes à taux élevé augmente directement ton flux mensuel libre.`
                    : `Aucune dette de consommation déclarée : 100 % de ton épargne peut être investie.`,
                `Automatiser un virement de ${formatCAD(Math.round(ctx.epargneMensuelle * 0.8))}/mois dès le jour de paie sécurise ta trajectoire.`,
            ],
            actionsSuggerees: [
                { label: 'Ajuster mon Budget', tab: Tab.BUDGET },
                { label: 'Explorer mes Transactions', tab: Tab.TRANSACTIONS },
            ],
            source: 'moteur-local',
        };
    }

    if (q.includes('retraite') || q.includes('futur') || q.includes('60 ans') || q.includes('65 ans') || q.includes('indépendance')) {
        return {
            texte: `Analyse Gemini Flash (Trajectoire Retraite à ${ctx.ageRetraiteCible} ans) : tu as atteint ${progressionRetraite} % de ton capital cible (${formatCAD(cibleRetraite)}) à ${anneesAvantRetraite} ans de l’échéance.`,
            pointsCles: [
                `Valeur nette actuelle : ${formatCAD(ctx.patrimoineNet)} pour une rente cible de ${formatCAD(ctx.revenuRetraiteCible)}/mois.`,
                `Horizon de capitalisation : ${anneesAvantRetraite} ans restants avec une épargne estimée à ${formatCAD(ctx.epargneMensuelle)}/mois.`,
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
        texte: `Synthèse Gemini Flash pour ${ctx.prenom} : ta valeur nette s’établit à ${formatCAD(ctx.patrimoineNet)}, soutenue par ${formatCAD(ctx.celi + ctx.reer + ctx.nonEnregistre)} de placements et ${formatCAD(ctx.immobilierNet)} d’équité immobilière.`,
        pointsCles: [
            `Progression vers l’indépendance financière (${ctx.ageRetraiteCible} ans) : ${progressionRetraite} % de la cible (${formatCAD(cibleRetraite)}).`,
            `Répartition : CELI ${formatCAD(ctx.celi)} · REER ${formatCAD(ctx.reer)} · Liquidités ${formatCAD(ctx.liquidites)}.`,
            ctx.dettesTotales > 0
                ? `Dettes à surveiller : ${formatCAD(ctx.dettesTotales)} — consulte le plan de désendettement.`
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
 * Interroge Gemini 3.8 Flash avec le contexte patrimonial de l'utilisateur.
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
    const apiKey = state.apiKeys?.anthropic?.trim() || (import.meta.env.VITE_GEMINI_API_KEY as string | undefined)?.trim() || '';

    if (!apiKey) {
        return syntheseLocale;
    }

    try {
        const promptSysteme = [
            'Tu es Gemini, le conseiller financier personnel intégré à FinanceAI (Québec / Canada 2026).',
            'Réponds en français, en tutoyant l’utilisateur, de manière claire, structurée et concise (maximum 4 phrases + 3 points d’action concrets séparés par des sauts de ligne commençant par "- ").',
            `Contexte patrimonial réel de ${ctx.prenom} :`,
            `- Valeur nette : ${formatCAD(ctx.patrimoineNet)}`,
            `- CELI : ${formatCAD(ctx.celi)} | REER : ${formatCAD(ctx.reer)} | Non-enregistré : ${formatCAD(ctx.nonEnregistre)}`,
            `- Liquidités : ${formatCAD(ctx.liquidites)} | Équité immobilière : ${formatCAD(ctx.immobilierNet)} | Dettes : ${formatCAD(ctx.dettesTotales)}`,
            `- Salaire brut mensuel ménage : ${formatCAD(ctx.salaireBrutMensuel)} | Épargne mensuelle : ${formatCAD(ctx.epargneMensuelle)}`,
            `- Retraite visée : ${ctx.ageRetraiteCible} ans (actuel : ${ctx.ageActuel} ans) avec ${formatCAD(ctx.revenuRetraiteCible)}/mois.`,
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
