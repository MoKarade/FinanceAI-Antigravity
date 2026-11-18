import React, { useId, useMemo } from 'react';
import type { FinancialGoal } from '../../types';
import { formatCAD } from '../../utils/format';
import { PrivateAmount } from './PrivateAmount';
import { NO_DATA_LABEL } from './emptyAware';

export type NiveauUrgenceObjectif = 'critique' | 'elevee' | 'moderee' | 'faible' | 'atteint';

interface MetriquesObjectifFinancier {
    id: string;
    nom: string;
    montantActuel: number | null;
    montantCible: number | null;
    pourcentage: number | null;
    urgence: NiveauUrgenceObjectif;
    libelleUrgence: string;
    moisRestants: number | null;
    echeanceTexte: string;
    compteCible?: string;
}

interface ConfigurationGradientUrgence {
    stopDebut: string;
    stopMilieu?: string;
    stopFin: string;
    classeTexte: string;
    classeBordure: string;
}

const GRADIENTS_URGENCE: Record<NiveauUrgenceObjectif, ConfigurationGradientUrgence> = {
    critique: {
        stopDebut: 'var(--bordure-champ)',
        stopMilieu: 'var(--texte-doux)',
        stopFin: 'var(--bordure-champ)',
        classeTexte: 'text-ink-200',
        classeBordure: 'border-bordure-champ',
    },
    elevee: {
        stopDebut: 'var(--texte-doux)',
        stopMilieu: 'var(--accent-fonce)',
        stopFin: 'var(--texte-doux)',
        classeTexte: 'text-ink-200',
        classeBordure: 'border-bordure',
    },
    moderee: {
        stopDebut: 'var(--accent-fonce)',
        stopMilieu: 'var(--accent)',
        stopFin: 'var(--accent-fonce)',
        classeTexte: 'text-ink-100',
        classeBordure: 'border-bordure',
    },
    faible: {
        stopDebut: 'var(--accent)',
        stopMilieu: 'var(--accent-fonce)',
        stopFin: 'var(--accent)',
        classeTexte: 'text-ink-50',
        classeBordure: 'border-bordure',
    },
    atteint: {
        stopDebut: 'var(--accent)',
        stopMilieu: 'var(--accent)',
        stopFin: 'var(--accent)',
        classeTexte: 'text-ink-50',
        classeBordure: 'border-bordure-champ',
    },
};

const LIBELLES_URGENCE: Record<NiveauUrgenceObjectif, string> = {
    critique: 'Urgence critique',
    elevee: 'Échéance proche',
    moderee: 'Rythme à soutenir',
    faible: 'En bonne voie',
    atteint: 'Objectif atteint',
};

/**
 * Calcule le nombre de mois entre `todayIso` (AAAA-MM-JJ) et `deadline` (AAAA-MM ou AAAA-MM-JJ).
 */
function calculerMoisRestants(deadline: string | undefined, todayIso: string): number | null {
    if (!deadline || typeof deadline !== 'string') return null;
    const match = /^(\d{4})-(\d{2})/.exec(deadline.trim());
    const matchToday = /^(\d{4})-(\d{2})/.exec(todayIso.trim());
    if (!match || !matchToday) return null;

    const anneeFin = Number(match[1]);
    const moisFin = Number(match[2]);
    const anneeCourante = Number(matchToday[1]);
    const moisCourant = Number(matchToday[2]);

    if (!Number.isFinite(anneeFin) || !Number.isFinite(moisFin)) return null;
    return (anneeFin - anneeCourante) * 12 + (moisFin - moisCourant);
}

/**
 * Détermine le niveau d'urgence d'un objectif financier selon son avancement (%) et les mois restants.
 */
export function determinerUrgenceObjectif(
    pourcentage: number | null,
    moisRestants: number | null,
    completed?: boolean,
): NiveauUrgenceObjectif {
    if (completed || (pourcentage !== null && pourcentage >= 100)) {
        return 'atteint';
    }
    if (pourcentage === null) {
        return 'moderee';
    }
    if (moisRestants !== null) {
        if (moisRestants <= 0) return 'critique';
        if (moisRestants <= 6 && pourcentage < 75) return 'critique';
        if (moisRestants <= 12 && pourcentage < 40) return 'critique';
        if (moisRestants <= 12 && pourcentage < 80) return 'elevee';
        if (moisRestants <= 24 && pourcentage < 50) return 'elevee';
        if (moisRestants <= 36 && pourcentage < 75) return 'moderee';
    }
    if (pourcentage < 25) return 'elevee';
    if (pourcentage < 65) return 'moderee';
    return 'faible';
}

function formaterEcheanceRestante(moisRestants: number | null, deadline: string | undefined): string {
    if (moisRestants === null) return deadline ? `Échéance ${deadline}` : 'Sans échéance';
    if (moisRestants < 0) return 'Échéance dépassée';
    if (moisRestants === 0) return 'Ce mois-ci';
    // MONTANT-MASQUE-AILLEURS : rendu sous PrivateAmount dans la carte d'objectif
    if (moisRestants < 12) return `${moisRestants} mois restants`;
    const annees = Math.floor(moisRestants / 12);
    const mois = moisRestants % 12;
    // MONTANT-MASQUE-AILLEURS : rendu sous PrivateAmount dans la carte d'objectif
    if (mois === 0) return `${annees} an${annees > 1 ? 's' : ''} restant${annees > 1 ? 's' : ''}`;
    return `${annees} a ${mois} m restants`;
}

/**
 * Extrait et normalise les métriques d'un `FinancialGoal` (supporte aussi les fixtures de test `target`/`current`).
 * Aucune valeur non finie n'est jamais convertie en 0.
 */
function evaluerObjectifFinancier(
    goal: FinancialGoal,
    todayIso: string,
): MetriquesObjectifFinancier {
    const brut = goal as FinancialGoal & {
        target?: number;
        current?: number;
        accountType?: string;
    };

    const cibleRaw = brut.targetAmount ?? brut.target;
    const actuelRaw = brut.manualCurrentAmount ?? brut.current ?? 0;

    const montantCible = typeof cibleRaw === 'number' && Number.isFinite(cibleRaw) && cibleRaw > 0 ? cibleRaw : null;
    const montantActuel = typeof actuelRaw === 'number' && Number.isFinite(actuelRaw) ? Math.max(0, actuelRaw) : null;

    const pourcentage =
        goal.completed
            ? 100
            : montantCible !== null && montantActuel !== null
              ? Math.max(0, Math.min(100, Math.round((montantActuel / montantCible) * 100)))
              : null;

    const moisRestants = calculerMoisRestants(goal.deadline, todayIso);
    const urgence = determinerUrgenceObjectif(pourcentage, moisRestants, goal.completed);

    return {
        id: goal.id,
        nom: goal.name,
        montantActuel,
        montantCible,
        pourcentage,
        urgence,
        libelleUrgence: LIBELLES_URGENCE[urgence],
        moisRestants,
        echeanceTexte: formaterEcheanceRestante(moisRestants, goal.deadline),
        compteCible: goal.targetAccount ?? brut.accountType,
    };
}

export interface FinancialGoalProgressRingProps {
    goal: FinancialGoal;
    todayIso?: string;
    size?: number;
    strokeWidth?: number;
    compact?: boolean;
}

/**
 * Jauge circulaire animée pour un objectif financier (`FinancialGoal`), avec dégradé de couleurs
 * dynamique selon l'urgence de l'échéance et le pourcentage de complétion.
 */
export const FinancialGoalProgressRing: React.FC<FinancialGoalProgressRingProps> = ({
    goal,
    todayIso = new Date().toISOString().slice(0, 10),
    size = 84,
    strokeWidth = 7,
    compact = false,
}) => {
    const rawId = useId();
    const gradientId = useMemo(() => `goal-grad-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`, [rawId]);
    const metriques = useMemo(() => evaluerObjectifFinancier(goal, todayIso), [goal, todayIso]);
    const configGradient = GRADIENTS_URGENCE[metriques.urgence];

    const rayon = (size - strokeWidth) / 2;
    const circonference = 2 * Math.PI * rayon;
    const fraction = metriques.pourcentage !== null ? metriques.pourcentage / 100 : 0;
    const dashOffset = circonference * (1 - Math.max(0, Math.min(1, fraction)));

    const ariaLabel =
        metriques.pourcentage !== null
            ? `${metriques.nom} : ${metriques.pourcentage} % complété (${metriques.libelleUrgence})`
            : `${metriques.nom} : ${NO_DATA_LABEL}`;

    if (compact) {
        return (
            <div
                className="relative inline-flex items-center justify-center shrink-0"
                style={{ width: size, height: size }}
                role="img"
                aria-label={ariaLabel}
                data-testid={`goal-ring-${metriques.id}`}
                data-urgency={metriques.urgence}
            >
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible" aria-hidden="true">
                    <defs>
                        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={configGradient.stopDebut} />
                            {configGradient.stopMilieu && <stop offset="50%" stopColor={configGradient.stopMilieu} />}
                            <stop offset="100%" stopColor={configGradient.stopFin} />
                        </linearGradient>
                    </defs>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={rayon}
                        fill="none"
                        stroke="var(--bordure)"
                        strokeWidth={strokeWidth}
                    />
                    {metriques.pourcentage !== null && (
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={rayon}
                            fill="none"
                            stroke={`url(#${gradientId})`}
                            strokeWidth={strokeWidth}
                            strokeLinecap="butt"
                            strokeDasharray={circonference}
                            // MONTANT-MASQUE-AILLEURS : jauge accompagnant le pourcentage sous PrivateAmount
                            strokeDashoffset={dashOffset}
                            style={{
                                transition: 'stroke-dashoffset 0.85s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                        />
                    )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {metriques.pourcentage !== null ? (
                        <PrivateAmount className={`font-mono text-xs font-bold tabular-nums ${configGradient.classeTexte}`}>
                            {`${metriques.pourcentage} %`}
                        </PrivateAmount>
                    ) : (
                        <span className="font-mono text-xs font-bold text-ink-400" aria-hidden="true">—</span>
                    )}
                </div>
            </div>
        );
    }

    return (
        <article
            className="rounded-none bg-surface p-5 hover:bg-surface-douce transition-colors duration-100 flex items-center gap-4 min-w-0"
            data-testid={`goal-card-${metriques.id}`}
            data-urgency={metriques.urgence}
        >
            <div
                className="relative inline-flex items-center justify-center shrink-0"
                style={{ width: size, height: size }}
                role="img"
                aria-label={ariaLabel}
                data-testid={`goal-ring-${metriques.id}`}
            >
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible" aria-hidden="true">
                    <defs>
                        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={configGradient.stopDebut} />
                            {configGradient.stopMilieu && <stop offset="50%" stopColor={configGradient.stopMilieu} />}
                            <stop offset="100%" stopColor={configGradient.stopFin} />
                        </linearGradient>
                    </defs>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={rayon}
                        fill="none"
                        stroke="var(--bordure)"
                        strokeWidth={strokeWidth}
                    />
                    {metriques.pourcentage !== null && (
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={rayon}
                            fill="none"
                            stroke={`url(#${gradientId})`}
                            strokeWidth={strokeWidth}
                            strokeLinecap="butt"
                            strokeDasharray={circonference}
                            // MONTANT-MASQUE-AILLEURS : jauge accompagnant le pourcentage sous PrivateAmount
                            strokeDashoffset={dashOffset}
                            style={{
                                transition: 'stroke-dashoffset 0.85s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                        />
                    )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    {metriques.pourcentage !== null ? (
                        <PrivateAmount className={`font-mono text-sm font-bold tabular-nums leading-none ${configGradient.classeTexte}`}>
                            {`${metriques.pourcentage} %`}
                        </PrivateAmount>
                    ) : (
                        <>
                            <span className="font-mono text-sm font-bold text-ink-400" aria-hidden="true">—</span>
                            <span className="sr-only">{NO_DATA_LABEL}</span>
                        </>
                    )}
                </div>
            </div>

            <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2 min-w-0">
                    <h3 className="text-body font-bold text-ink-50 tracking-normal line-clamp-2 break-words">{metriques.nom}</h3>
                </div>

                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-300">
                    <span className={`font-semibold ${configGradient.classeTexte}`}>{metriques.libelleUrgence}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-ink-400">
                        <PrivateAmount>{metriques.echeanceTexte}</PrivateAmount>
                    </span>
                    {metriques.compteCible && (
                        <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-ink-300">{metriques.compteCible}</span>
                        </>
                    )}
                </div>

                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-sm font-mono tabular-nums">
                    {metriques.montantActuel !== null && metriques.montantCible !== null ? (
                        <span className="text-ink-200 truncate">
                            <PrivateAmount className="font-bold text-ink-50">{formatCAD(metriques.montantActuel)}</PrivateAmount>
                            <span className="text-ink-400"> / </span>
                            <PrivateAmount className="text-ink-300">{formatCAD(metriques.montantCible)}</PrivateAmount>
                        </span>
                    ) : (
                        <span className="text-ink-400" aria-hidden="true">—</span>
                    )}
                </div>
            </div>
        </article>
    );
};

export interface FinancialGoalsProgressSectionProps {
    goals: FinancialGoal[];
    todayIso?: string;
}

/**
 * Grille d'objectifs financiers (`financialGoals`) affichant chaque objectif avec son anneau de progression
 * et son dégradé d'urgence.
 */
export const FinancialGoalsProgressSection: React.FC<FinancialGoalsProgressSectionProps> = ({
    goals,
    todayIso = new Date().toISOString().slice(0, 10),
}) => {
    const objectifsActifs = useMemo(
        () => (goals ?? []).filter((g) => g.status !== 'archived'),
        [goals],
    );

    if (objectifsActifs.length === 0) return null;

    const gridColsClass =
        objectifsActifs.length === 1
            ? 'grid-cols-1'
            : objectifsActifs.length === 2
              ? 'grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-bordure'
              : objectifsActifs.length === 4
                ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-bordure'
                : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-bordure';

    return (
        <section
            aria-label="Progression des objectifs financiers"
            data-testid="financial-goals-progress-section"
            className="premium-card rounded-xl bg-surface border border-bordure divide-y divide-bordure overflow-hidden"
        >
            <div className="flex items-baseline justify-between gap-3 px-6 py-4">
                <h2 className="text-base sm:text-lg font-semibold text-ink-50 tracking-normal">Objectifs financiers</h2>
                <span className="font-mono text-xs sm:text-sm tabular-nums text-ink-300">
                    {objectifsActifs.length} objectif{objectifsActifs.length > 1 ? 's' : ''}
                </span>
            </div>
            <div className={`grid ${gridColsClass}`}>
                {objectifsActifs.map((goal) => (
                    <FinancialGoalProgressRing key={goal.id} goal={goal} todayIso={todayIso} />
                ))}
            </div>
        </section>
    );
};
