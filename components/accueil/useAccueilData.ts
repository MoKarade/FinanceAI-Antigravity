import { useMemo } from 'react';
import { Tab, type AppState } from '../../types';
import type { ProjectionChartPoint } from '../../services/projection/types';
import { presentTermesOfGoal, monthsSince } from '../../services/projection/pastPurchaseInit';
import { assetValueCad, computeMonthlyBudgetAggregates, toCurrencyFactor } from '../../services/portfolio';
import { computePurchaseStats } from '../../utils/assetPurchases';
import { monthlyConsumptionExpenses } from '../../utils/healthRatios';
import { formatNumber } from '../../utils/format';
import {
    LENTILLES_HERO,
    RACCOURCIS_RECHERCHE,
    construireSerie1Mois,
    construireSparklineReelle,
} from './accueilHelpers';
import type {
    JalonPatrimonial,
    LentilleHero,
    PartRepartition,
    PositionSuivie,
    PrioriteActionPatrimoniale,
} from './types';

export interface AccueilPresentFiguresInput {
    state: AppState;
    globalNetWorth: number;
    avoirsHorsImmo: number;
    dettesHorsImmo: number;
    calculatedMonthlySavings: number;
    assetBreakdown: { reer: number; celi: number; reee: number; nonReg: number };
    currentLiquidity: number;
    lentilleHero: LentilleHero;
}

export function useAccueilPresentFigures({
    state,
    globalNetWorth,
    avoirsHorsImmo,
    dettesHorsImmo,
    calculatedMonthlySavings,
    assetBreakdown,
    currentLiquidity,
    lentilleHero,
}: AccueilPresentFiguresInput) {
    const { realEstateEquity, realEstateValeur, realEstateHypotheque, privateBusinessValue } = useMemo(() => {
        const termes = (state.realEstateGoals ?? []).map((g) =>
            presentTermesOfGoal(g, monthsSince(g.purchaseDate)),
        );
        const somme = (f: (t: { valeur: number; hypotheque: number }) => number) =>
            termes.reduce((sum, t) => sum + f(t), 0);
        const rentalValeur = (state.rentalProperties ?? []).reduce(
            (sum, rp) => sum + (Number.isFinite(rp.currentValue) ? rp.currentValue : 0),
            0,
        );
        const rentalHypotheque = (state.rentalProperties ?? []).reduce(
            (sum, rp) => sum + (Number.isFinite(rp.mortgageBalance) ? rp.mortgageBalance : 0),
            0,
        );
        const bizVal = (state.privateBusinesses ?? []).reduce(
            (sum, pb) => sum + (Number.isFinite(pb.estimatedValue) ? pb.estimatedValue : 0) * ((Number.isFinite(pb.ownershipPct) ? pb.ownershipPct : 100) / 100),
            0,
        );
        const valTot = somme((t) => t.valeur) + rentalValeur;
        const hypTot = somme((t) => t.hypotheque) + rentalHypotheque;
        return {
            realEstateEquity: valTot - hypTot,
            realEstateValeur: valTot,
            realEstateHypotheque: hypTot,
            privateBusinessValue: bizVal,
        };
    }, [state.realEstateGoals, state.rentalProperties, state.privateBusinesses]);

    const totalAvoirs = Math.max(0, (Number.isFinite(avoirsHorsImmo) ? avoirsHorsImmo : 0) + realEstateValeur + privateBusinessValue);
    const totalDettes = Math.max(0, (Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0) + realEstateHypotheque);
    const patrimoineNet = (Number.isFinite(globalNetWorth) ? globalNetWorth : 0) + realEstateEquity + privateBusinessValue;
    const epargneMensuelle = Number.isFinite(calculatedMonthlySavings) ? calculatedMonthlySavings : 0;
    const liquidites = Number.isFinite(currentLiquidity) ? Math.max(0, currentLiquidity) : 0;
    const portefeuillePlacements = Math.max(
        0,
        (assetBreakdown.celi || 0) +
            (assetBreakdown.reer || 0) +
            (assetBreakdown.nonReg || 0) +
            (assetBreakdown.reee || 0),
    );

    const valeurHeroAffichee = useMemo(() => {
        if (lentilleHero === 'portefeuille') return portefeuillePlacements;
        if (lentilleHero === 'liquidites') return liquidites;
        if (lentilleHero === 'immobilier') return realEstateEquity;
        return patrimoineNet;
    }, [lentilleHero, portefeuillePlacements, liquidites, realEstateEquity, patrimoineNet]);

    const lentilleCourante = useMemo(
        () => LENTILLES_HERO.find((l) => l.cle === lentilleHero) ?? LENTILLES_HERO[0]!,
        [lentilleHero],
    );

    const prenom = useMemo(() => {
        const brut = state.config?.users?.[0]?.name ?? '';
        return brut.replace(/\s*\(test\)\s*$/i, '').trim();
    }, [state.config?.users]);

    const indicateursPouls = useMemo(() => {
        const cibleRetraite = Math.max(100_000, (state.retirementGoal?.targetMonthlyIncome ?? 4000) * 12 * 25);
        const pctLiberte = Math.min(100, Math.max(0, Math.round((Math.max(0, patrimoineNet) / cibleRetraite) * 100)));
        const ageRetraite = state.retirementGoal?.targetAge ?? 60;

        // [NO-FAKE-DATA] Revenu mensuel issu de computeMonthlyBudgetAggregates (net) ou salaire brut saisi — jamais de 20 % inventé
        const aggsBudget = computeMonthlyBudgetAggregates(
            state.config ?? { users: [] },
            state.budgetItems ?? [],
        );
        const salaireMensuelBrut = (state.config?.users ?? []).reduce(
            (acc, u) => acc + (Number(u.grossSalary) || 0),
            0,
        );
        const revenuReference = aggsBudget.income > 0 ? aggsBudget.income : salaireMensuelBrut;
        const tauxEpargne: number | null =
            revenuReference > 0
                ? Math.round((epargneMensuelle / revenuReference) * 100)
                : null;

        // [NO-FAKE-DATA] Dépenses mensuelles de consommation via monthlyConsumptionExpenses (normalise Weekly/Quarterly/Yearly et exclut Épargne) — aucun plancher 1 500 $ inventé
        const depensesConso = monthlyConsumptionExpenses(state.budgetItems ?? []);
        const moisAutonomie: number | null =
            Number.isFinite(depensesConso) && depensesConso > 0
                ? Number((liquidites / depensesConso).toFixed(1))
                : null;
        const ratioEndettement =
            totalAvoirs > 0 ? Math.min(100, Math.max(0, Math.round((totalDettes / totalAvoirs) * 100))) : 0;

        return {
            cibleRetraite,
            pctLiberte,
            ageRetraite,
            tauxEpargne,
            moisAutonomie,
            depensesConso: Number.isFinite(depensesConso) ? depensesConso : 0,
            revenuReference,
            ratioEndettement,
        };
    }, [
        state.retirementGoal?.targetMonthlyIncome,
        state.retirementGoal?.targetAge,
        patrimoineNet,
        state.config,
        epargneMensuelle,
        state.budgetItems,
        liquidites,
        totalAvoirs,
        totalDettes,
    ]);

    return {
        realEstateEquity,
        realEstateValeur,
        realEstateHypotheque,
        totalAvoirs,
        totalDettes,
        patrimoineNet,
        epargneMensuelle,
        liquidites,
        portefeuillePlacements,
        valeurHeroAffichee,
        lentilleCourante,
        prenom,
        indicateursPouls,
    };
}

export interface AccueilSecondaryPanelsInput {
    state: AppState;
    requete: string;
    todayIso: string;
    segmentActif: string | null;
    assetBreakdown: { reer: number; celi: number; reee: number; nonReg: number };
    realEstateValeur: number;
    liquidites: number;
    portefeuillePlacements: number;
    dettesHorsImmo: number;
    totalDettes: number;
    patrimoineNet: number;
    epargneMensuelle: number;
    fireNumber: number;
    jalonFire: ProjectionChartPoint | null;
    pointRetraite: ProjectionChartPoint | null;
    indicateursPouls: ReturnType<typeof useAccueilPresentFigures>['indicateursPouls'];
}

export function useAccueilSecondaryPanels({
    state,
    requete,
    todayIso,
    segmentActif,
    assetBreakdown,
    realEstateValeur,
    liquidites,
    portefeuillePlacements,
    dettesHorsImmo,
    totalDettes,
    patrimoineNet,
    epargneMensuelle,
    fireNumber,
    jalonFire,
    pointRetraite,
    indicateursPouls,
}: AccueilSecondaryPanelsInput) {
    const partsRepartition = useMemo<PartRepartition[]>(() => {
        const brutes: Array<Omit<PartRepartition, 'pct'>> = [
            {
                id: 'celi',
                code: 'CELI',
                label: 'CELI',
                sousTitre: 'Compte libre d’impôt',
                valeur: Math.max(0, Math.round(assetBreakdown.celi || 0)),
                couleur: 'var(--gf-bleu)',
                classeBarre: 'gf-alloc-celi',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'reer',
                code: 'REER',
                label: 'REER',
                sousTitre: 'Épargne retraite',
                valeur: Math.max(0, Math.round(assetBreakdown.reer || 0)),
                couleur: 'var(--gf-vert)',
                classeBarre: 'gf-alloc-reer',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'immo',
                code: 'IMMO',
                label: 'Immobilier',
                sousTitre: 'Valeur brute des biens',
                valeur: Math.max(0, Math.round(realEstateValeur || 0)),
                couleur: 'var(--gf-ambre)',
                classeBarre: 'gf-alloc-immo',
                tab: Tab.REAL_ESTATE,
            },
            {
                id: 'cash',
                code: 'CASH',
                label: 'Liquidités',
                sousTitre: 'Encaisse disponible',
                valeur: Math.max(0, Math.round(liquidites)),
                couleur: 'var(--gf-cyan)',
                classeBarre: 'gf-alloc-cash',
                tab: Tab.BUDGET,
            },
            {
                id: 'nonreg',
                code: 'N-REG',
                label: 'Non-enregistré',
                sousTitre: 'Comptes ordinaires & REEE',
                valeur: Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0))),
                couleur: 'var(--gf-violet)',
                classeBarre: 'gf-alloc-nonreg',
                tab: Tab.INVESTMENTS,
            },
        ];

        const filtre = brutes.filter((b) => b.valeur > 0);
        const somme = filtre.reduce((acc, b) => acc + b.valeur, 0);
        if (somme <= 0) {
            return [
                {
                    id: 'celi',
                    code: 'PORT',
                    label: 'Placements',
                    sousTitre: 'Aucune position valorisée',
                    valeur: 0,
                    pct: 0,
                    couleur: 'var(--gf-bleu)',
                    classeBarre: 'gf-alloc-celi',
                    tab: Tab.INVESTMENTS,
                },
            ];
        }
        return filtre
            .sort((a, b) => b.valeur - a.valeur)
            .map((b) => ({
                ...b,
                pct: Math.max(1, Math.round((b.valeur / somme) * 100)),
            }));
    }, [assetBreakdown, realEstateValeur, liquidites]);

    const partSelectionnee = useMemo(
        () => partsRepartition.find((p) => p.id === segmentActif) ?? partsRepartition[0]!,
        [partsRepartition, segmentActif],
    );

    // Positions suivies façon Watchlist Google Finance — courbe 1 mois (30 jours) par action
    const positionsSuivies = useMemo<PositionSuivie[]>(() => {
        const actifs = [...(state.assets ?? [])]
            .map((a, idx) => {
                const rec = a as unknown as Record<string, unknown>;
                const val = Math.max(
                    0,
                    Math.round(
                        assetValueCad(a, state.fxRates) ||
                            Number(rec.value) ||
                            0,
                    ),
                );
                const stats = computePurchaseStats(a);
                const fxFactor = toCurrencyFactor(state.fxRates, a.currency || 'CAD');
                let variationPct: number | null = null;
                let gainCad: number | null = null;

                if (stats.totalCost > 0 && Number.isFinite(stats.gainPct)) {
                    variationPct = Number(stats.gainPct.toFixed(2));
                    gainCad = Math.round(stats.totalGain * fxFactor);
                } else if (typeof a.performance === 'number' && Number.isFinite(a.performance) && a.performance !== 0) {
                    variationPct = Number(a.performance.toFixed(2));
                    gainCad = Math.round((val * variationPct) / 100);
                }

                const positif = (variationPct ?? 0) >= 0;
                const qte = a.quantity && a.quantity > 0 ? a.quantity : 1;
                const historiquePrix = (a.priceHistory ?? []).map((p) => p.price * qte * fxFactor);
                const serieBrute =
                    historiquePrix.length >= 2
                        ? historiquePrix
                        : stats.totalCost > 0 && stats.averageCost > 0 && a.currentPrice > 0
                          ? [stats.averageCost * qte * fxFactor, val]
                          : [];
                const serie1Mois = construireSerie1Mois(
                    val,
                    serieBrute,
                    gainCad != null ? Math.round(gainCad / 6) : Math.round(val * 0.012),
                );

                const nomBrut = typeof a.name === 'string' && a.name.trim() ? a.name.trim() : a.symbol || `Titre ${idx + 1}`;
                const symbole = (a.symbol || nomBrut.slice(0, 5) || `T${idx + 1}`).toUpperCase();
                const qteStr =
                    typeof a.quantity === 'number' && a.quantity > 0
                        ? `${Number.isInteger(a.quantity) ? a.quantity : a.quantity.toFixed(2)} act.`
                        : '';
                const decAchat = stats.averageCost >= 1000 ? 0 : 2;
                const decCours = a.currentPrice >= 1000 ? 0 : 2;
                const pruStr =
                    stats.averageCost > 0 && a.currentPrice > 0
                        // MONTANT-MASQUE-AILLEURS : `sousTitreDetail` (`pos.nom`) est rendu dans `<PrivateAmount>` plus bas.
                        ? `${formatNumber(stats.averageCost, { decimals: decAchat })} → ${formatNumber(a.currentPrice, { decimals: decCours })} ${a.currency || 'CAD'}`
                        : '';
                const sousTitreDetail = [qteStr, pruStr].filter(Boolean).join(' · ') || nomBrut;
                return {
                    id: `asset-${symbole}-${idx}`,
                    symbole,
                    nom: sousTitreDetail,
                    compte: a.accountType || 'Portefeuille',
                    valeur: val,
                    variationPct,
                    gainCad,
                    positif,
                    pointsSparkline: construireSparklineReelle(serie1Mois),
                    tab: Tab.INVESTMENTS,
                };
            })
            .filter((a) => a.valeur > 0)
            .sort((a, b) => b.valeur - a.valeur)
            .slice(0, 15);

        if (actifs.length > 0) {
            const totalActifs = Math.max(1, actifs.reduce((s, a) => s + a.valeur, 0));
            return actifs.map((a) => ({
                ...a,
                poidsPct: Math.max(1, Math.round((a.valeur / totalActifs) * 100)),
            }));
        }

        return partsRepartition
            .filter((p) => p.id !== 'cash')
            .map((p) => ({
                id: `pos-${p.id}`,
                symbole: p.code,
                nom: p.label,
                compte: p.sousTitre,
                valeur: p.valeur,
                poidsPct: p.pct,
                variationPct: null,
                gainCad: null,
                positif: true,
                pointsSparkline: construireSparklineReelle(construireSerie1Mois(p.valeur, [], Math.round(p.valeur * 0.01))),
                tab: p.tab,
            }));
    }, [state.assets, state.fxRates, partsRepartition]);

    const resultatsOmnibox = useMemo(() => {
        const q = requete.trim().toLowerCase();
        const pages = q
            ? RACCOURCIS_RECHERCHE.filter((r) => r.label.toLowerCase().includes(q))
            : RACCOURCIS_RECHERCHE.slice(0, 6);
        const titres = q
            ? (state.assets ?? [])
                  .filter(
                      (a) =>
                          (a.symbol && a.symbol.toLowerCase().includes(q)) ||
                          (a.name ?? '').toLowerCase().includes(q),
                  )
                  .slice(0, 4)
            : (state.assets ?? []).slice(0, 3);
        const operations = q
            ? (state.transactions ?? [])
                  .filter(
                      (tx) =>
                          (tx.payee ?? '').toLowerCase().includes(q) ||
                          (tx.category ?? '').toLowerCase().includes(q),
                  )
                  .slice(0, 3)
            : [];
        return { pages, titres, operations };
    }, [requete, state.assets, state.transactions]);

    const operationsRecentes = useMemo(() => {
        return [...(state.transactions ?? [])]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 5);
    }, [state.transactions]);

    // Plan d'action patrimonial personnalisé — calculé 100 % sur les données réelles du dossier (No-fake-data)
    const prioritesPlanAction = useMemo<PrioriteActionPatrimoniale[]>(() => {
        const depensesConso = indicateursPouls.depensesConso;
        const cibleUrgence = depensesConso > 0 ? Math.round(depensesConso * 3) : null;
        const moisAutonomie = indicateursPouls.moisAutonomie;
        const pctUrgence =
            cibleUrgence && cibleUrgence > 0
                ? Math.min(100, Math.max(4, Math.round((liquidites / cibleUrgence) * 100)))
                : liquidites > 0
                  ? 100
                  : 0;
        const surplusCash = cibleUrgence !== null && liquidites > cibleUrgence ? Math.round(liquidites - cibleUrgence) : 0;

        const celiVal = Math.max(0, Math.round(assetBreakdown.celi || 0));
        const reerVal = Math.max(0, Math.round(assetBreakdown.reer || 0));
        const nonRegVal = Math.max(0, Math.round((assetBreakdown.nonReg || 0) + (assetBreakdown.reee || 0)));
        const abriFiscalTotal = celiVal + reerVal;
        const pctAbriFiscal =
            portefeuillePlacements > 0
                ? Math.min(100, Math.max(4, Math.round((abriFiscalTotal / portefeuillePlacements) * 100)))
                : 0;

        const dettesHorsHypo = Math.max(0, Math.round(Number.isFinite(dettesHorsImmo) ? dettesHorsImmo : 0));
        const ratioSolvabilite = Math.max(0, Math.min(100, 100 - indicateursPouls.ratioEndettement));

        const cibleFire = Number.isFinite(fireNumber) && fireNumber > 0 ? Math.round(fireNumber) : indicateursPouls.cibleRetraite;
        const pctFire =
            cibleFire > 0
                ? Math.min(100, Math.max(2, Math.round((Math.max(0, patrimoineNet) / cibleFire) * 100)))
                : 0;

        return [
            {
                id: 'prio-liquidites',
                rang: 'Priorité 1 · Trésorerie & Sécurité',
                titre:
                    moisAutonomie !== null && moisAutonomie >= 3
                        ? 'Coussin de sécurité atteint — excédent déployable'
                        : 'Consolider le coussin de liquidités (3 mois)',
                description:
                    moisAutonomie !== null
                        ? surplusCash > 0
                            // NOMBRE-NON-MONETAIRE : nombre de mois d'autonomie de trésorerie
                            ? `Encaisse de ${moisAutonomie} mois de dépenses courantes. L’excédent au-dessus de 3 mois peut être investi en CELI ou REER.`
                            // NOMBRE-NON-MONETAIRE : nombre de mois d'autonomie de trésorerie
                            : `Autonomie actuelle de ${moisAutonomie} mois de dépenses courantes. Visez 3 mois complets d’encaisse disponible.`
                        : 'Ajustez vos postes budgétaires mensuels pour calibrer précisément votre réserve de sécurité.',
                statutLabel:
                    moisAutonomie !== null
                        // NOMBRE-NON-MONETAIRE : nombre de mois d'autonomie de trésorerie
                        ? `${moisAutonomie} mois d’autonomie`
                        : 'À calibrer',
                statutClasse:
                    moisAutonomie !== null && moisAutonomie >= 3
                        ? 'gf-delta-up'
                        : moisAutonomie !== null && moisAutonomie >= 1.5
                          ? 'gf-delta-amber'
                          : 'gf-delta-neutral',
                montantPrincipal: liquidites,
                cibleMontant: cibleUrgence,
                progressionPct: pctUrgence,
                classeBarre: 'gf-alloc-cash',
                ctaLabel: surplusCash > 0 ? 'Investir l’excédent' : 'Gérer la trésorerie',
                tab: surplusCash > 0 ? Tab.INVESTMENTS : Tab.BUDGET,
            },
            {
                id: 'prio-fiscalite-placements',
                rang: 'Priorité 2 · Enveloppes fiscales ARC / RQ',
                titre:
                    nonRegVal > abriFiscalTotal
                        ? 'Prioriser le transfert vers CELI (7 000 $) & REER'
                        : 'Automatiser les cotisations CELI & REER',
                description:
                    nonRegVal > 0
                        ? `Une part importante du portefeuille est en compte non-enregistré. Maximisez vos droits CELI et REER pour réduire l’impôt annuel.`
                        : 'Continuez d’alimenter vos comptes enregistrés libres d’impôt selon votre taux marginal combiné Québec / Fédéral.',
                statutLabel: `${pctAbriFiscal} % à l’abri de l’impôt`,
                statutClasse: pctAbriFiscal >= 60 ? 'gf-delta-up' : 'gf-delta-amber',
                montantPrincipal: portefeuillePlacements,
                cibleMontant: epargneMensuelle > 0 ? Math.round(epargneMensuelle * 12) : null,
                progressionPct: Math.max(8, pctAbriFiscal),
                classeBarre: 'gf-alloc-celi',
                ctaLabel: 'Optimiser CELI / REER',
                tab: Tab.INVESTMENTS,
            },
            {
                id: 'prio-dettes',
                rang: 'Priorité 3 · Passifs & Effet de levier',
                titre:
                    totalDettes <= 0
                        ? 'Bilan sans dette — capacité d’emprunt intacte'
                        : dettesHorsHypo > 0
                          ? 'Accélérer le remboursement des dettes hors hypothèque'
                          : 'Maîtriser l’amortissement hypothécaire',
                description:
                    totalDettes <= 0
                        ? 'Aucun passif enregistré au bilan. L’intégralité de votre flux mensuel travaille pour la croissance de vos actifs.'
                        : `Ratio d’endettement de ${indicateursPouls.ratioEndettement} % des avoirs totaux. Ciblez en priorité les dettes au taux d’intérêt le plus élevé.`,
                statutLabel:
                    totalDettes <= 0
                        ? '0 % d’endettement'
                        : `Levier ${indicateursPouls.ratioEndettement} %`,
                statutClasse:
                    indicateursPouls.ratioEndettement <= 25
                        ? 'gf-delta-up'
                        : indicateursPouls.ratioEndettement <= 45
                          ? 'gf-delta-amber'
                          : 'gf-delta-down',
                montantPrincipal: totalDettes,
                cibleMontant: dettesHorsHypo > 0 ? dettesHorsHypo : null,
                progressionPct: ratioSolvabilite,
                classeBarre: 'gf-alloc-reer',
                ctaLabel: 'Plan de désendettement',
                tab: Tab.DEBT,
            },
            {
                id: 'prio-retraite-fire',
                rang: 'Priorité 4 · Cap Retraite & Indépendance financière',
                titre: jalonFire
                    ? `Trajectoire d’indépendance financière projetée en ${jalonFire.year}`
                    // NOMBRE-NON-MONETAIRE : âge cible de retraite saisi en réglage
                    : `Cap retraite cible à ${indicateursPouls.ageRetraite} ans`,
                description:
                    pointRetraite && Number.isFinite(pointRetraite.NetWorth)
                        // NOMBRE-NON-MONETAIRE : âge du profil au jalon de retraite
                        ? `Selon la simulation actuelle, votre patrimoine net atteindra son jalon de retraite à ${pointRetraite.age} ans avec les rentes RRQ et PSV.`
                        : 'Simulez vos scénarios Monte-Carlo et vos rentes gouvernementales (RRQ / PSV) pour sécuriser votre décaissement.',
                statutLabel: `${pctFire} % de la cible FIRE`,
                statutClasse: pctFire >= 50 ? 'gf-delta-up' : 'gf-delta-amber',
                montantPrincipal:
                    pointRetraite && Number.isFinite(pointRetraite.NetWorth)
                        ? pointRetraite.NetWorth
                        : patrimoineNet,
                cibleMontant: cibleFire,
                progressionPct: Math.max(6, pctFire),
                classeBarre: 'gf-alloc-immo',
                ctaLabel: 'Explorer la trajectoire',
                tab: Tab.FUTURE,
            },
        ];
    }, [
        indicateursPouls,
        liquidites,
        assetBreakdown,
        portefeuillePlacements,
        dettesHorsImmo,
        fireNumber,
        patrimoineNet,
        epargneMensuelle,
        totalDettes,
        jalonFire,
        pointRetraite,
    ]);

    const prochainsJalons = useMemo<JalonPatrimonial[]>(() => {
        const anneeCourante = Number(todayIso.slice(0, 4)) || 2026;
        const jalons: JalonPatrimonial[] = [];

        for (const immo of state.realEstateGoals ?? []) {
            const anneeAchat = Number((immo.purchaseDate ?? '').slice(0, 4)) || anneeCourante;
            jalons.push({
                id: `immo-${immo.id}`,
                titre: immo.name || 'Bien immobilier',
                categorie: anneeAchat > anneeCourante ? 'Acquisition prévue' : 'Actif immobilier',
                annee: anneeAchat,
                montant: Number(immo.currentValue ?? immo.price) || 0,
                tab: anneeAchat > anneeCourante ? Tab.REAL_ESTATE_PROJECTS : Tab.REAL_ESTATE,
            });
        }

        for (const voyage of state.travelGoals ?? []) {
            jalons.push({
                id: `voyage-${voyage.id}`,
                titre: voyage.destination || 'Projet voyage',
                categorie: 'Projet de vie',
                annee: Number((voyage.date ?? '').slice(0, 4)) || anneeCourante + 1,
                montant: Number(voyage.totalCost) || 0,
                tab: Tab.LIFE_PROJECTS,
            });
        }

        for (const evt of state.lifeEvents ?? []) {
            jalons.push({
                id: `evt-${evt.id}`,
                titre: evt.name || 'Événement de vie',
                categorie: 'Jalon planifié',
                annee: Number((evt.date ?? '').slice(0, 4)) || anneeCourante + 2,
                montant: Math.abs(Number(evt.impactAmount) || 0),
                tab: Tab.LIFE_PROJECTS,
            });
        }

        const ageActuel = state.config?.users?.[0]?.age ?? 35;
        const ageRetraite = state.retirementGoal?.targetAge ?? 60;
        const anneeRetraite = anneeCourante + Math.max(1, ageRetraite - ageActuel);
        jalons.push({
            id: 'jalon-retraite',
            // NOMBRE-NON-MONETAIRE : âge cible de retraite saisi en réglage
            titre: `Retraite cible (${ageRetraite} ans)`,
            categorie: 'Indépendance financière',
            annee: anneeRetraite,
            montant: (state.retirementGoal?.targetMonthlyIncome ?? 4000) * 12,
            tab: Tab.RETIREMENT,
        });

        return jalons.sort((a, b) => a.annee - b.annee).slice(0, 5);
    }, [todayIso, state.realEstateGoals, state.travelGoals, state.lifeEvents, state.config?.users, state.retirementGoal]);

    return {
        partsRepartition,
        partSelectionnee,
        positionsSuivies,
        resultatsOmnibox,
        operationsRecentes,
        prioritesPlanAction,
        prochainsJalons,
    };
}
