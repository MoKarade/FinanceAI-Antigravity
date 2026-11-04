import React, { useMemo, useState } from 'react';
import {
    buildRootBucket,
    getChildBuckets,
    levelName,
    type PlanBucket,
} from '../../services/projection/actionPlanHierarchy';
import { ACTION_ACCOUNTS } from '../../services/projection/yearlyActions';
import { useFinanceStore } from '../../store/useFinanceStore';
import { computeMonthlyBudgetAggregates } from '../../services/portfolio';
import { monthlyConsumptionExpenses } from '../../utils/healthRatios';
import { Icon, type IconName } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { formatCAD } from '../../utils/format';
import { useViewportBelowSm } from '../../hooks/useViewportBelowSm';

interface ActionPlanDrilldownProps {
    chartData: Array<Record<string, unknown>>;
    strategyName?: string;
}

type HorizonActionCle = 'jour' | 'semaine' | 'mois' | 'annee' | 'decennie';

interface FicheHorizonAction {
    cle: HorizonActionCle;
    label: string;
    periode: string;
    icone: IconName;
    cibleMontant: number;
    cibleSuffixe: string;
    plafondOuRevenuLabel: string;
    plafondOuRevenuMontant: number;
    resumeAction: string;
    etapesConcretes: Array<{ titre: string; explication: string; impact: string }>;
}

const cad = (v: number): string => formatCAD(v);

const FlowChips: React.FC<{ flows: PlanBucket['flows'] }> = ({ flows }) => {
    const deposits = ACTION_ACCOUNTS.filter((a) => flows[a.key] > 100);
    const withdrawals = ACTION_ACCOUNTS.filter((a) => flows[a.key] < -100);
    if (deposits.length === 0 && withdrawals.length === 0) {
        return <span className="text-tiny text-ink-400">—</span>;
    }
    return (
        <div className="flex flex-wrap gap-1.5 text-tiny font-mono">
            {deposits.map((a) => (
                <PrivateAmount key={a.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-sky-500/10 text-sky-300">
                    <Icon name="cash" size={11} /> {a.label} +{cad(flows[a.key])}
                </PrivateAmount>
            ))}
            {withdrawals.map((a) => (
                <PrivateAmount key={a.key} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-orange-500/10 text-orange-300">
                    <Icon name="bank" size={11} /> {a.label} −{cad(-flows[a.key])}
                </PrivateAmount>
            ))}
        </div>
    );
};

/**
 * Plan d'action HIÉRARCHIQUE (Couche progressive) : on part d'une vue d'ensemble
 * et on creuse au clic — décennie → 3 ans → année → semestre → trimestre → mois,
 * puis les conseils concrets de la période. « Simple en surface, profond quand on
 * creuse » : chaque niveau montre le net + les mouvements, le clic révèle le détail.
 */
export const ActionPlanDrilldown: React.FC<ActionPlanDrilldownProps> = ({ chartData, strategyName }) => {
    // [FUTUR-MOBILE-PR5] Cibles tactiles 44 px pour « Pourquoi ? » (14 px) et la case « Marquer
    // comme fait » (14 px) — mobile UNIQUEMENT, desktop inchangé (mandat Marc #13).
    const isNarrowViewport = useViewportBelowSm();
    const root = useMemo(() => buildRootBucket(chartData), [chartData]);
    // On stocke le chemin par IDs (stables) et on RE-DÉRIVE les buckets à chaque
    // rendu depuis chartData → toujours frais, robuste si le scénario change.
    const [pathIds, setPathIds] = useState<string[]>([]);
    // Aide de session (NON persistée, volontairement) : conseils cochés « fait » + « pourquoi »
    // dépliés, indexés par clé bucket+rang. Se réinitialise au recalcul de la projection — c'est
    // une checklist de revue, pas un suivi de tâches durable.
    const [done, setDone] = useState<Set<string>>(new Set());
    const [openWhy, setOpenWhy] = useState<Set<string>>(new Set());
    const [horizonActif, setHorizonActif] = useState<HorizonActionCle>('mois');
    const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
        set((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

    const config = useFinanceStore((s) => s.config);
    const budgetItems = useFinanceStore((s) => s.budgetItems);
    const debts = useFinanceStore((s) => s.debts);
    const retirementGoal = useFinanceStore((s) => s.retirementGoal);

    const { trail, children } = useMemo(() => {
        if (!root) return { trail: [] as PlanBucket[], children: [] as PlanBucket[] };
        const t: PlanBucket[] = [root];
        let cur = root;
        for (const id of pathIds) {
            const next = getChildBuckets(chartData, cur).find((k) => k.id === id);
            if (!next) break; // id périmé (scénario changé) → on s'arrête là
            t.push(next);
            cur = next;
        }
        return { trail: t, children: getChildBuckets(chartData, cur) };
    }, [root, chartData, pathIds]);

    const fichesHorizons = useMemo<FicheHorizonAction[]>(() => {
        const aggs = computeMonthlyBudgetAggregates(
            config ?? { users: [] },
            budgetItems ?? [],
        );
        const consoMensuelle = monthlyConsumptionExpenses(budgetItems ?? []);
        const brutMensuel = (config?.users ?? []).reduce(
            (acc, u) => acc + (Number(u?.grossSalary) || 0),
            0,
        );
        const revenuNetMensuel =
            aggs.income > 0
                ? aggs.income
                : brutMensuel > 0
                  ? Math.round(brutMensuel * 0.72)
                  : 4500;

        const nbMoisRoot = Math.max(1, chartData.filter((pt) => typeof pt.monthIndex === 'number' && Number(pt.monthIndex) >= 0).length);
        const epargneMoteurMensuelle = root ? Math.max(0, Math.round((root.deposited - root.withdrawn) / nbMoisRoot)) : 0;
        const epargneBudgetMensuelle = Math.max(0, Math.round(revenuNetMensuel - aggs.expenses));
        const epargneMensuelle = epargneBudgetMensuelle > 0 ? epargneBudgetMensuelle : epargneMoteurMensuelle > 0 ? epargneMoteurMensuelle : Math.round(revenuNetMensuel * 0.2);
        const depensesCourantesMensuelles =
            Number.isFinite(consoMensuelle) && consoMensuelle > 0
                ? Math.round(consoMensuelle)
                : Math.max(1200, Math.round(revenuNetMensuel - epargneMensuelle));

        const epargneJour = Math.max(1, Math.round((epargneMensuelle * 12) / 365));
        const depensesJour = Math.max(10, Math.round((depensesCourantesMensuelles * 12) / 365));
        const epargneSemaine = Math.max(5, Math.round((epargneMensuelle * 12) / 52));
        const depensesSemaine = Math.max(50, Math.round((depensesCourantesMensuelles * 12) / 52));
        const epargneAnnee = Math.round(epargneMensuelle * 12);
        const epargneDecennie = Math.round(epargneAnnee * 10);

        const soldeDettes = (debts ?? []).reduce((acc, d) => acc + Math.max(0, Number(d?.balance) || 0), 0);
        const renteRetraite = Number(retirementGoal?.targetMonthlyIncome) || 4000;

        return [
            {
                cle: 'jour',
                label: 'Par jour',
                periode: 'Discipline quotidienne',
                icone: 'cash',
                cibleMontant: epargneJour,
                cibleSuffixe: '/jour mis de côté',
                plafondOuRevenuLabel: 'Plafond dépenses courantes',
                plafondOuRevenuMontant: depensesJour,
                resumeAction: 'Protéger ta marge quotidienne en gardant tes dépenses variables sous ton plafond journalier.',
                etapesConcretes: [
                    {
                        titre: 'Respecter le budget de vie quotidien',
                        explication: 'Maintiens tes achats courants du jour (repas, cafés, transport, achats spontanés) sous ton plafond journalier calculé à partir de ton budget.',
                        impact: 'Chaque journée sous le plafond préserve intégralement ton flux d’épargne automatique.',
                    },
                    {
                        titre: 'Rapprocher les opérations du jour en 30 secondes',
                        explication: 'Vérifie que les opérations récentes (octobre / novembre et mois en cours) sont bien catégorisées dans l’onglet Transactions.',
                        impact: 'Zéro dépense oubliée et parité exacte entre ton Budget et ton compte bancaire.',
                    },
                    {
                        titre: 'Appliquer la règle des 24 heures sur les envies',
                        explication: 'Tout achat non essentiel supérieur à une journée d’épargne est reporté au lendemain avant décision.',
                        impact: 'Élimine les achats impulsifs qui grugent la capacité de cotisation CELI/REER.',
                    },
                ],
            },
            {
                cle: 'semaine',
                label: 'Par semaine',
                periode: 'Rituel du jeudi (paie)',
                icone: 'refresh',
                cibleMontant: epargneSemaine,
                cibleSuffixe: '/semaine virés auto',
                plafondOuRevenuLabel: 'Enveloppe hebdomadaire',
                plafondOuRevenuMontant: depensesSemaine,
                resumeAction: 'Automatiser le virement d’épargne dès le jeudi matin (jour de paie) avant toute dépense de fin de semaine.',
                etapesConcretes: [
                    {
                        titre: 'Virement automatique du jeudi (« Se payer en premier »)',
                        explication: 'Programme un virement récurrent chaque jeudi de paie directement vers ton CELI ou ton REER.',
                        impact: 'Ton épargne est investie automatiquement sans effort de volonté.',
                    },
                    {
                        titre: soldeDettes > 0 ? 'Accélérer le remboursement des dettes actives' : 'Zéro solde reporté sur les cartes de crédit',
                        explication: soldeDettes > 0
                            ? 'Affecte tout surplus hebdomadaire au paiement de la dette au taux d’intérêt le plus élevé (méthode avalanche).'
                            : 'Acquitte le solde courant de ta carte chaque semaine pour maintenir un taux d’utilisation bas et zéro intérêt.',
                        impact: 'Réduit immédiatement le coût d’intérêt et libère du flux mensuel.',
                    },
                    {
                        titre: 'Bilan rapide de 5 minutes le dimanche',
                        explication: 'Compare tes dépenses de la semaine (épicerie, sorties, essence) à ton enveloppe hebdomadaire.',
                        impact: 'Permet de corriger un écart dès la semaine suivante plutôt qu’en fin d’année.',
                    },
                ],
            },
            {
                cle: 'mois',
                label: 'Par mois',
                periode: 'Allocation mensuelle',
                icone: 'budget',
                cibleMontant: epargneMensuelle,
                cibleSuffixe: '/mois investis',
                plafondOuRevenuLabel: 'Revenu net mensuel',
                plafondOuRevenuMontant: revenuNetMensuel,
                resumeAction: 'Investir méthodiquement chaque mois (DCA) dans tes enveloppes fiscales et contrôler la parité Budget ↔ Transactions.',
                etapesConcretes: [
                    {
                        titre: 'Investissement mensuel programmé (CELI / REER / Non-enreg.)',
                        explication: 'Dès que tes virements mensuels arrivent chez le courtier, achète tes FNB indiciels selon ta répartition cible.',
                        impact: 'Lisse le prix d’achat moyen (DCA) et fait travailler chaque dollar sans délai.',
                    },
                    {
                        titre: 'Clôture mensuelle du journal des transactions',
                        explication: 'Le 1er du mois, passe en revue le graphique Dépenses réelles vs Budget (6 mois) pour valider tes postes Besoins / Envies / Épargne.',
                        impact: 'Garantit que le taux d’épargne réel correspond à la trajectoire simulée dans Futur.',
                    },
                    {
                        titre: 'Vérification du coussin de sécurité liquide',
                        explication: 'Assure-toi que ton encaisse couvre tes mois d’autonomie cibles ; tout excédent au-delà du coussin est basculé vers les placements.',
                        impact: 'Évite de laisser dormir trop de liquidités sous le taux de l’inflation.',
                    },
                ],
            },
            {
                cle: 'annee',
                label: 'Par année',
                periode: 'Calendrier fiscal QC / Canada',
                icone: 'tax',
                cibleMontant: epargneAnnee,
                cibleSuffixe: '/an capitalisés',
                plafondOuRevenuLabel: 'Revenu net annuel',
                plafondOuRevenuMontant: revenuNetMensuel * 12,
                resumeAction: 'Orchestrer tes cotisations REER/CELI avec la fiscalité ARC & Revenu Québec et réinvestir ton remboursement d’impôt.',
                etapesConcretes: [
                    {
                        titre: 'Janvier – Février : Cotisation REER (60 premiers jours)',
                        explication: 'Optimise ta déduction REER selon ton taux marginal combiné Québec + Fédéral dans l’onglet Impôts.',
                        impact: 'Génère un remboursement d’impôt significatif au printemps.',
                    },
                    {
                        titre: 'Mars – Mai : Réinvestissement intégral du remboursement d’impôt',
                        explication: 'Dès réception de l’avis de cotisation ARC et Revenu Québec, injecte 100 % du remboursement d’impôt dans ton CELI.',
                        impact: 'Crée un effet de levier fiscal sans effort budgétaire supplémentaire.',
                    },
                    {
                        titre: 'Octobre – Décembre : Rééquilibrage annuel & droits CELI',
                        explication: 'Rééquilibre tes classes d’actifs qui ont dévié de leur cible et prépare l’utilisation des nouveaux droits CELI du 1er janvier.',
                        impact: 'Maintient le niveau de risque exact choisi dans ta stratégie.',
                    },
                ],
            },
            {
                cle: 'decennie',
                label: 'Par décennie',
                periode: 'Cap retraite & indépendance',
                icone: 'future',
                cibleMontant: epargneDecennie,
                cibleSuffixe: '/décennie d’apports',
                plafondOuRevenuLabel: 'Rente annuelle visée',
                plafondOuRevenuMontant: renteRetraite * 12,
                resumeAction: 'Structurer les grandes phases de ta vie patrimoniale jusqu’à l’indépendance financière puis le décaissement optimal.',
                etapesConcretes: [
                    {
                        titre: 'Décennie d’accumulation : Croissance & élimination des passifs',
                        explication: 'Maximise le plein potentiel des intérêts composés en CELI et REER tout en amortissant l’hypothèque et les dettes.',
                        impact: 'La croissance du portefeuille finit par dépasser l’effort d’épargne salarial.',
                    },
                    {
                        titre: 'Décennie de transition (5 à 10 ans avant la retraite)',
                        explication: 'Constitue une réserve de sécurité (2 à 3 ans de dépenses) pour neutraliser le risque de séquence de rendements au départ en retraite.',
                        impact: 'Protège ton capital contre un repli boursier juste au moment d’arrêter de travailler.',
                    },
                    {
                        titre: `Décennie de décaissement (${strategyName || 'Ordre fiscal optimal'})`,
                        explication: 'Coordonne les retraits entre CELI, Non-enregistré et REER/FERR avec l’âge de demande des rentes RRQ et PSV (bonifiées jusqu’à 70/72 ans).',
                        impact: 'Minimise l’impôt à vie et évite la récupération de la Pension de la Sécurité de la vieillesse (PSV).',
                    },
                ],
            },
        ];
    }, [config, budgetItems, debts, retirementGoal, chartData, root, strategyName]);

    if (!root) return null;

    const current = trail[trail.length - 1];
    const net = current.deposited - current.withdrawn;
    const idsBelowRoot = trail.slice(1).map((b) => b.id);
    const ficheActive = fichesHorizons.find((f) => f.cle === horizonActif) ?? fichesHorizons[2]!;

    const drillTo = (b: PlanBucket) => setPathIds([...idsBelowRoot, b.id]);
    const jumpTo = (trailIdx: number) => setPathIds(trail.slice(1, trailIdx + 1).map((b) => b.id));

    return (
        <div data-testid="action-plan-complet" className="mt-4 rounded-2xl bg-surface border border-bordure p-4 sm:p-5 space-y-5">
            {/* En-tête principal du Plan d'action */}
            <div className="flex items-center justify-between gap-2 flex-wrap border-b border-bordure pb-3">
                <div>
                    <span className="text-sm sm:text-base font-bold text-ink-50 flex items-center gap-2">
                        <Icon name="clipboard" size={16} className="text-repere" />
                        <span>Plan d'action complet · Jour, Semaine, Mois, Année & Décennie</span>
                    </span>
                    <p className="text-xs text-ink-300 mt-0.5">
                        Explications claires et gestes concrets à poser à chaque échelle de temps selon tes chiffres réels
                    </p>
                </div>
                {strategyName && (
                    <span className="px-2.5 py-1 rounded-full bg-repere-fond text-repere border border-bordure-lien text-xs font-mono font-semibold">
                        selon {strategyName}
                    </span>
                )}
            </div>

            {/* 1. Sélecteur des 5 horizons (Jour · Semaine · Mois · Année · Décennie) */}
            <div className="space-y-3">
                <div
                    role="group"
                    aria-label="Échelle de temps du plan d'action"
                    className="grid grid-cols-2 sm:grid-cols-5 gap-2"
                >
                    {fichesHorizons.map((h) => {
                        const actif = h.cle === ficheActive.cle;
                        return (
                            <button
                                key={h.cle}
                                type="button"
                                data-testid={`action-plan-horizon-${h.cle}`}
                                aria-pressed={actif}
                                onClick={() => setHorizonActif(h.cle)}
                                className={`touch-target rounded-xl p-3 text-left border transition-all focus-ring flex flex-col justify-between gap-1.5 ${
                                    actif
                                        ? 'bg-repere-fond border-bordure-lien text-ink-50'
                                        : 'bg-fond border-bordure text-ink-200 hover:bg-surface-douce'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-1.5">
                                    <span className="text-xs font-bold text-ink-50">{h.label}</span>
                                    <Icon name={h.icone} size={14} className={actif ? 'text-repere' : 'text-ink-400'} aria-hidden="true" />
                                </div>
                                <div className="text-[11px] text-ink-400 truncate">{h.periode}</div>
                                <PrivateAmount className="font-mono text-xs sm:text-sm font-bold text-succes-texte tabular-nums">
                                    +{cad(h.cibleMontant)}
                                </PrivateAmount>
                            </button>
                        );
                    })}
                </div>

                {/* Fiche explicative détaillée de l'horizon actif */}
                <div className="rounded-xl bg-fond border border-bordure p-4 space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-bordure pb-3">
                        <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-full bg-repere-fond text-repere text-[11px] font-mono font-bold">
                                    {ficheActive.label}
                                </span>
                                <span className="text-xs sm:text-sm font-bold text-ink-50">
                                    {ficheActive.periode}
                                </span>
                            </div>
                            <p className="text-xs text-ink-200 leading-relaxed">
                                {ficheActive.resumeAction}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                            <div className="rounded-lg bg-surface px-3 py-1.5 border border-bordure">
                                <div className="text-[10px] uppercase tracking-wider text-ink-400">Cible d’épargne</div>
                                <PrivateAmount className="text-xs sm:text-sm font-bold text-succes-texte">
                                    +{cad(ficheActive.cibleMontant)} {ficheActive.cibleSuffixe}
                                </PrivateAmount>
                            </div>
                            <div className="rounded-lg bg-surface px-3 py-1.5 border border-bordure">
                                <div className="text-[10px] uppercase tracking-wider text-ink-400">{ficheActive.plafondOuRevenuLabel}</div>
                                <PrivateAmount className="text-xs sm:text-sm font-bold text-ink-50">
                                    {cad(ficheActive.plafondOuRevenuMontant)}
                                </PrivateAmount>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {ficheActive.etapesConcretes.map((etape, idx) => (
                            <div
                                key={etape.titre}
                                className="rounded-xl bg-surface border border-bordure p-3 flex flex-col justify-between gap-2"
                            >
                                <div className="space-y-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="w-5 h-5 rounded-full bg-repere-fond text-repere font-mono text-[11px] font-bold inline-flex items-center justify-center shrink-0">
                                            {/* NOMBRE-NON-MONETAIRE : numéro d'étape 1, 2, 3 */}
                                            {idx + 1}
                                        </span>
                                        <span className="text-xs font-bold text-ink-50 leading-snug">
                                            {etape.titre}
                                        </span>
                                    </div>
                                    <p className="text-xs text-ink-200 leading-relaxed">
                                        {etape.explication}
                                    </p>
                                </div>
                                <div className="pt-2 border-t border-bordure text-[11px] text-repere font-medium">
                                    Impact : {etape.impact}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 2. Explorateur chronologique de la projection (Décennie → 3 ans → Année → Trimestre → Mois) */}
            <div className="pt-2 border-t border-bordure">
                <div className="text-xs font-bold text-ink-200 mb-2">
                    Explorer les flux projetés par période (Décennie → Année → Mois)
                </div>

            {/* Fil d'Ariane : clique pour remonter d'un niveau. */}
            <nav aria-label="Niveau du plan" className="flex items-center flex-wrap gap-1 text-tiny mb-3">
                {trail.map((b, i) => {
                    const isLast = i === trail.length - 1;
                    return (
                        <React.Fragment key={b.id}>
                            {isLast ? (
                                <span className="px-1.5 py-0.5 rounded-sm bg-primary/15 text-primary font-bold">
                                    {levelName(b.level)} · {b.label}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => jumpTo(i)}
                                    className="px-2 py-1 touch-target rounded-sm text-ink-400 hover:text-ink-100 hover:bg-surface-douce focus-ring transition-colors"
                                >
                                    {b.label}
                                </button>
                            )}
                            {!isLast && <span aria-hidden="true" className="text-ink-400">›</span>}
                        </React.Fragment>
                    );
                })}
            </nav>

            {/* Résumé de la période courante. */}
            <div className="bg-surface-douce rounded-lg p-3 mb-3">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                    <span className="text-meta font-bold text-texte">
                        {current.label}
                        {current.ageStart != null && (
                            <span className="text-ink-400 font-normal">
                                {/* NOMBRE-NON-MONETAIRE : axe d'âge ou d'année de la projection, pas une valeur dérivée du dossier (bornes d'âge du palier) */}
                                {' · '}{current.ageStart}{current.ageEnd != null && current.ageEnd !== current.ageStart ? `–${current.ageEnd}` : ''} ans
                            </span>
                        )}
                    </span>
                    <PrivateAmount className={`text-meta font-bold tabular-nums ${net >= 0 ? 'text-success-400' : 'text-orange-300'}`}>
                        {net >= 0 ? 'Épargne nette +' : 'Décaissement '}{cad(net)}
                    </PrivateAmount>
                </div>
                <FlowChips flows={current.flows} />
                <PrivateAmount as="div" className="text-tiny text-ink-400 mt-2">
                    Patrimoine en fin de période : <span className="text-ink-300 font-mono">{cad(current.netWorthEnd)}</span>
                </PrivateAmount>
            </div>

            {/* Conseils de la période. */}
            <div className="mb-3">
                <div className="text-tiny font-bold text-ink-400 uppercase tracking-wide mb-1.5">Conseils</div>
                <ul className="space-y-1.5">
                    {current.advice.map((item, i) => {
                        const key = `${current.id}-${i}`;
                        const checkable = item.kind !== 'info';
                        const isDone = done.has(key);
                        const whyOpen = openWhy.has(key);
                        const amountClass = item.kind === 'withdraw' || (item.amount ?? 0) < 0 ? 'text-orange-300' : 'text-success-400';
                        return (
                            <li key={key} className="rounded-lg bg-surface-douce border border-bordure px-2.5 py-2">
                                <div className="flex items-start gap-2">
                                    {checkable ? (
                                        // [FUTUR-MOBILE-PR5] `<label>` et NON `<span>` : un `<span>` ne relaie PAS le
                                        // clic à son `<input>` descendant — vérifié par mesure (a11y-auditor de ce
                                        // lot), un tap dans la marge ajoutée ne cochait RIEN. Le `<label>` le fait
                                        // nativement, sans texte visible (le nom accessible reste l'`aria-label` de
                                        // l'input).
                                        <label className={isNarrowViewport ? 'flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 cursor-pointer' : 'mt-0.5 shrink-0 cursor-pointer'}>
                                            <input
                                                type="checkbox"
                                                checked={isDone}
                                                onChange={() => toggle(setDone, key)}
                                                aria-label={`Marquer comme fait : ${item.text}`}
                                                className="h-3.5 w-3.5 cursor-pointer accent-success-500 focus-ring rounded-sm"
                                            />
                                        </label>
                                    ) : (
                                        <span aria-hidden="true" className="mt-0.5 w-3.5 shrink-0 text-center text-ink-500">·</span>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-baseline justify-between gap-2">
                                            <span className={`text-tiny ${isDone ? 'line-through text-ink-400' : checkable ? 'text-ink-100' : 'text-ink-300'}`}>
                                                {item.text}
                                            </span>
                                            {item.amount != null && (
                                                <PrivateAmount className={`text-tiny font-bold tabular-nums shrink-0 ${amountClass}`}>
                                                    {item.amount > 0 ? '+' : ''}{cad(item.amount)}
                                                </PrivateAmount>
                                            )}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => toggle(setOpenWhy, key)}
                                            aria-expanded={whyOpen}
                                            className={`mt-1 inline-flex items-center gap-1 touch-target text-tiny text-primary/80 hover:text-primary focus-ring rounded ${
                                                isNarrowViewport ? 'min-h-[44px]' : ''
                                            }`}
                                        >
                                            Pourquoi&nbsp;? <span aria-hidden="true">{whyOpen ? '▾' : '▸'}</span>
                                        </button>
                                        {whyOpen && (
                                            <p className="mt-1 text-tiny text-ink-400 leading-snug">{item.why}</p>
                                        )}
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>

            {/* Creuser : enfants cliquables. */}
            {children.length > 0 && (
                <div>
                    <div className="text-tiny font-bold text-ink-400 uppercase tracking-wide mb-1.5">
                        Creuser ({levelName(children[0].level).toLowerCase()})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {children.map((b) => {
                            const childNet = b.deposited - b.withdrawn;
                            return (
                                <button
                                    key={b.id}
                                    type="button"
                                    onClick={() => b.hasChildren && drillTo(b)}
                                    disabled={!b.hasChildren}
                                    className={`text-left bg-surface-douce rounded-lg p-2.5 touch-target border border-bordure transition-colors focus-ring ${
                                        b.hasChildren ? 'hover:bg-bordure hover:border-primary/30 cursor-pointer' : 'cursor-default opacity-90'
                                    }`}
                                    title={b.hasChildren ? `Creuser : ${b.label}` : b.label}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-1.5">
                                        <span className="text-meta font-bold text-texte truncate">{b.label}</span>
                                        <span className="flex items-center gap-1.5 shrink-0">
                                            {b.isRetired && <span className="text-tiny text-amber-300 bg-warning-500/10 px-1.5 py-0.5 rounded-sm">Retraite</span>}
                                            <PrivateAmount className={`text-tiny font-mono tabular-nums ${childNet >= 0 ? 'text-success-400' : 'text-orange-300'}`}>
                                                {childNet >= 0 ? '+' : ''}{cad(childNet)}
                                            </PrivateAmount>
                                            {b.hasChildren && <span aria-hidden="true" className="text-ink-500">›</span>}
                                        </span>
                                    </div>
                                    <FlowChips flows={b.flows} />
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
            </div>
        </div>
    );
};
