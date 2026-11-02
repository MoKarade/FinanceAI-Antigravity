import React, { useMemo, useState } from 'react';
import { PageHeader } from './ui/PageHeader';
import { Icon } from './ui/Icon';
import { EmptyState } from './ui/EmptyState';
import { ConfirmModal } from './ui/ConfirmModal';
import { PrivateAmount } from './ui/PrivateAmount';
import { VieCurveLink } from './vie/VieCurveLink';
import { FormulaireProjet } from './vie/FormulaireProjet';
import { FriseProjets, couleurProjet } from './vie/FriseProjets';
import { ImpactProjet } from './vie/ImpactProjet';
import { dateLongue } from './vie/dateLongue';
import { listerProjets, filtrer, joursRestants, redater, type Filtre } from './vie/projetsDeVie';
import { useViewportBelowLg } from '../hooks/useViewportBelowLg';
import { useTodayIsoLocal } from '../hooks/useSimulationParams';
import { formatCAD } from '../utils/format';
import { TAB_LABELS } from '../constants';
import { Tab, type TravelGoal, type LifeEvent, type FinancialGoal } from '../types';
import { useFinanceStore } from '../store/useFinanceStore';
import { FinancialGoalsProgressSection } from './ui/FinancialGoalProgressRing';

const EMPTY_GOALS: FinancialGoal[] = [];

/**
 * [S5-REFONTE-PROJETS] « Projets de vie » aux maquettes (E-projets / M-projets) : voyages et
 * événements réunis sur UNE frise (glisser = changer d'année), une liste filtrable et la carte
 * d'impact du projet choisi. Remplace Travel.tsx + LifeEvents.tsx (Phase F.12) : les stores restent
 * séparés (`travelGoals`, `lifeEvents`), la page les présente ensemble.
 */

interface LifeProjectsProps {
    travelGoals: TravelGoal[];
    setTravelGoals: (goals: TravelGoal[]) => void;
    lifeEvents: LifeEvent[];
    setLifeEvents: (events: LifeEvent[]) => void;
    netWorth: number;
    returnRate: number;
}

const FILTRES: ReadonlyArray<{ id: Filtre; libelle: string }> = [
    { id: 'tout', libelle: 'Tout' },
    { id: 'voyages', libelle: 'Voyages' },
    { id: 'evenements', libelle: 'Événements' },
];

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

export const LifeProjects: React.FC<LifeProjectsProps> = ({
    travelGoals, setTravelGoals, lifeEvents, setLifeEvents, netWorth, returnRate,
}) => {
    const aujourdhui = useTodayIsoLocal();
    const compacte = useViewportBelowLg();
    const financialGoals = useFinanceStore(s => s.financialGoals) ?? EMPTY_GOALS;
    const [filtre, setFiltre] = useState<Filtre>('tout');
    const [selection, setSelection] = useState<string | null>(null);
    const [ajout, setAjout] = useState(false);
    const [aSupprimer, setASupprimer] = useState<string | null>(null);

    const tous = useMemo(() => listerProjets(travelGoals, lifeEvents), [travelGoals, lifeEvents]);
    const visibles = useMemo(() => filtrer(tous, filtre), [tous, filtre]);
    // Projet choisi : celui cliqué, sinon le prochain à venir, sinon le premier.
    const choisi = tous.find((p) => p.cle === selection)
        ?? tous.find((p) => p.date.slice(0, 10) >= aujourdhui) ?? tous[0] ?? null;

    const nbVoyages = travelGoals.length;
    const nbEvenements = lifeEvents.length;

    const appliquerDate = (cle: string, date: string) => {
        const r = redater(cle, date, travelGoals, lifeEvents);
        if (r.voyages) setTravelGoals(r.voyages);
        if (r.evenements) setLifeEvents(r.evenements);
    };
    const supprimer = () => {
        if (!aSupprimer) return;
        const id = aSupprimer.split('_').slice(1).join('_');
        if (aSupprimer.startsWith('travel_')) setTravelGoals(travelGoals.filter((t) => t.id !== id));
        else setLifeEvents(lifeEvents.filter((e) => e.id !== id));
        if (selection === aSupprimer) setSelection(null);
        setASupprimer(null);
    };

    const filtres = (classe: string) => (
        <div role="group" aria-label="Filtrer les projets" className={`gf-subtab-bar overflow-x-auto no-scrollbar ${classe}`}>
            {FILTRES.map((f) => (
                <button
                    key={f.id}
                    type="button"
                    onClick={() => setFiltre(f.id)}
                    aria-pressed={filtre === f.id}
                    className={`touch-target gf-subtab-pill min-h-11 lg:min-h-9 px-3.5 rounded-lg text-[13px] whitespace-nowrap transition-colors focus-ring ${compacte ? 'flex-1' : ''} ${
                        filtre === f.id ? (compacte ? 'gf-subtab-pill-active bg-ink-50 text-dark font-semibold' : 'gf-subtab-pill-active bg-surface-douce text-ink-50 font-semibold') : 'text-ink-300 hover:bg-surface-douce hover:text-ink-50'
                    }`}
                >
                    {f.libelle}
                </button>
            ))}
        </div>
    );

    return (
        <div className="space-y-5 stagger-in pb-10">
            <ConfirmModal
                isOpen={!!aSupprimer}
                onConfirm={supprimer}
                onCancel={() => setASupprimer(null)}
                title="Supprimer le projet"
                message="Supprimer définitivement ce projet ?"
                confirmLabel="Supprimer"
            />
            <PageHeader
                title={TAB_LABELS[Tab.LIFE_PROJECTS]}
                badge={
                    <span className="inline-flex flex-wrap items-center gap-2">
                        <span className="gf-ticker-symbol">
                            <span className="w-1.5 h-1.5 rounded-full bg-current gf-pulse-live" aria-hidden="true" />
                            PROJETS:VIE · HORIZON
                        </span>
                        <span className="text-meta lg:text-body text-ink-400">
                            {pluriel(tous.length, 'projet', 'projets')} · {pluriel(nbVoyages, 'voyage', 'voyages')} · {pluriel(nbEvenements, 'événement', 'événements')}
                        </span>
                    </span>
                }
                actions={
                    <span className="flex items-center gap-3">
                        <span className="hidden lg:inline-flex"><VieCurveLink /></span>
                        <button
                            type="button"
                            onClick={() => setAjout((v) => !v)}
                            aria-expanded={ajout}
                            aria-label={ajout ? 'Fermer' : 'Nouveau projet'}
                            className="touch-target min-h-11 px-3.5 lg:px-4 rounded-lg border border-bordure-champ lg:border-transparent text-ink-50 lg:bg-primary lg:text-dark text-body lg:font-bold hover:bg-surface-douce lg:hover:opacity-90 transition-colors focus-ring"
                        >
                            {ajout ? 'Fermer' : <><span className="lg:hidden">Nouveau</span><span className="hidden lg:inline">Nouveau projet</span></>}
                        </button>
                    </span>
                }
            />

            {tous.length > 0 && (
                <section aria-label="Cote des projets de vie" className="gf-quote-strip">
                    <div className="gf-quote-cell">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400">
                                Budget total engagé
                            </span>
                            <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-amber">
                                {tous.length} projet{tous.length > 1 ? 's' : ''}
                            </span>
                        </div>
                        <PrivateAmount as="div" className="font-mono text-[20px] font-bold text-ink-50 tabular-nums">
                            {formatCAD(tous.reduce((s, p) => s + p.cout, 0))}
                        </PrivateAmount>
                        <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-douce overflow-hidden flex" aria-hidden="true">
                            <div
                                className="h-full bg-repere"
                                // NOMBRE-NON-MONETAIRE : BARRE-DECORATIVE accompagnant le budget sous PrivateAmount
                                style={{ width: `${Math.round((tous.filter((p) => p.genre === 'voyage').reduce((s, p) => s + p.cout, 0) / Math.max(1, tous.reduce((s, p) => s + p.cout, 0))) * 100)}%` }}
                            />
                            <div className="h-full bg-alerte-texte" style={{ flex: 1 }} />
                        </div>
                    </div>
                    <div className="gf-quote-cell">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400">
                                Voyages planifiés
                            </span>
                            <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-neutral">
                                Voyages
                            </span>
                        </div>
                        <PrivateAmount as="div" className="font-mono text-[20px] font-bold text-ink-50 tabular-nums">
                            {formatCAD(tous.filter((p) => p.genre === 'voyage').reduce((s, p) => s + p.cout, 0))}
                        </PrivateAmount>
                    </div>
                    <div className="gf-quote-cell">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400">
                                Événements majeurs
                            </span>
                            <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-neutral">
                                Jalons
                            </span>
                        </div>
                        <PrivateAmount as="div" className="font-mono text-[20px] font-bold text-ink-50 tabular-nums">
                            {formatCAD(tous.filter((p) => p.genre === 'evenement').reduce((s, p) => s + p.cout, 0))}
                        </PrivateAmount>
                    </div>
                    <div className="gf-quote-cell">
                        <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10px] font-semibold tracking-wider uppercase text-ink-400">
                                Projet sélectionné
                            </span>
                            <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold gf-delta-up">
                                Actif
                            </span>
                        </div>
                        {choisi ? (
                            <PrivateAmount as="div" className="font-mono text-[20px] font-bold text-ink-50 tabular-nums truncate">
                                {formatCAD(choisi.cout)}
                            </PrivateAmount>
                        ) : (
                            <div className="font-mono text-[20px] font-bold text-ink-400">—</div>
                        )}
                    </div>
                </section>
            )}

            <FinancialGoalsProgressSection goals={financialGoals} todayIso={aujourdhui} />

            {ajout && (
                <FormulaireProjet
                    voyages={travelGoals} setVoyages={setTravelGoals}
                    evenements={lifeEvents} setEvenements={setLifeEvents}
                    onFermer={() => setAjout(false)}
                />
            )}

            {tous.length === 0 ? (
                !ajout && (
                    <EmptyState
                        icon={<Icon name="life-projects" size={30} />}
                        title="Aucun projet"
                        description="Planifie un voyage ou un événement (rénovation, mariage, sabbatique…) pour voir son effet sur ta courbe Future."
                        cta={<button type="button" onClick={() => setAjout(true)} className="touch-target min-h-11 px-4 rounded-lg bg-primary text-dark text-body font-bold focus-ring">Nouveau projet</button>}
                    />
                )
            ) : (
                <>
                    {compacte && filtres('flex gap-1 p-1 rounded-xl bg-surface border border-bordure')}
                    <FriseProjets
                        items={compacte ? visibles : tous}
                        selection={choisi?.cle ?? null}
                        onSelection={setSelection}
                        onRedater={appliquerDate}
                        aujourdhui={aujourdhui}
                        compacte={compacte}
                    />
                    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px] gap-5 items-start">
                        {!compacte && (
                            <section aria-label="Projets" className="gf-terminal-card rounded-2xl bg-surface border border-bordure overflow-hidden">
                                <div className="px-4 py-3 bg-fond border-b border-bordure flex items-center justify-between gap-2">
                                    {filtres('flex gap-1')}
                                    <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                                        {visibles.length} ligne{visibles.length > 1 ? 's' : ''}
                                    </span>
                                </div>
                                <ul className="gf-spring-grid">
                                    {visibles.map((p) => {
                                        const couleur = couleurProjet(p);
                                        const j = joursRestants(p.date, aujourdhui);
                                        return (
                                            <li key={p.cle} className="border-t border-bordure first:border-t-0">
                                                <button
                                                    type="button"
                                                    aria-pressed={choisi?.cle === p.cle}
                                                    onClick={() => setSelection(p.cle)}
                                                    className={`touch-target gf-row gf-card-interactive w-full min-h-[72px] px-5 grid grid-cols-[44px_minmax(0,1fr)_90px_120px] gap-3.5 items-center text-left transition-colors focus-ring ${choisi?.cle === p.cle ? 'bg-surface-douce' : 'hover:bg-surface-douce'}`}
                                                >
                                                    <span className="w-10 h-10 rounded-xl bg-surface-douce border border-bordure flex items-center justify-center" style={{ color: couleur }} aria-hidden="true"><Icon name={p.icone} size={18} /></span>
                                                    <span className="flex flex-col gap-0.5 min-w-0">
                                                        <span className="font-semibold text-ink-50 truncate">{p.nom}</span>
                                                        <span className="font-mono text-meta text-ink-400">{dateLongue(p.date)}</span>
                                                    </span>
                                                    <span className="font-mono text-meta text-ink-300">{p.genre === 'voyage' ? (j >= 0 ? `dans ${j} j` : 'passé') : 'événement'}</span>
                                                    <PrivateAmount className="text-right font-mono font-bold text-ink-50">{formatCAD(p.cout)}</PrivateAmount>
                                                </button>
                                            </li>
                                        );
                                    })}
                                    {visibles.length === 0 && (
                                        <li className="border-t border-bordure px-5 py-6 text-meta text-ink-400">Aucun projet dans cette catégorie.</li>
                                    )}
                                </ul>
                            </section>
                        )}
                        {choisi && (
                            <ImpactProjet
                                projet={choisi}
                                patrimoine={netWorth}
                                rendement={returnRate}
                                onRedater={appliquerDate}
                                onSupprimer={setASupprimer}
                            />
                        )}
                    </div>
                </>
            )}

            {/* Mobile : le lien vers la courbe ferme la page, en pleine largeur (maquette M-projets). */}
            {compacte && <div className="[&>button]:w-full"><VieCurveLink /></div>}
        </div>
    );
};
