import React, { useMemo, useState } from 'react';
import { RealEstateGoal } from '../types';
import { partitionRealEstateGoals } from '../services/realEstatePartition';
import { presentEquityOfGoal, monthsSince } from '../services/projection/pastPurchaseInit';
import { formatCompactCAD } from '../utils/format';
import { PrivateAmount } from './ui/PrivateAmount';
import { RealEstateWorkspace } from './realestate/RealEstateWorkspace';

/**
 * [REFONTE-NAV-L3] Page « Immobilier » (destination Configurations = ce que j'AI).
 * N'affiche que les biens ACTUELS (détenus aujourd'hui — partition pure sur la même
 * tranche `realEstateGoals`, jamais migrée). Les projets d'achat FUTURS vivent dans
 * Vie → Projets immo (`components/life/RealEstateProjects.tsx`).
 */
interface RealEstateProps {
    availableCash: number;
    goals: RealEstateGoal[];
    setGoals: (g: RealEstateGoal[]) => void;
}

type LentilleParcImmo = 'synthese' | 'equite' | 'levier';

const LENTILLES_PARC: ReadonlyArray<{ id: LentilleParcImmo; label: string; code: string }> = [
    { id: 'synthese', label: 'Vue d’ensemble du parc', code: 'PARC' },
    { id: 'equite', label: 'Équité & valeur nette', code: 'ÉQUITÉ' },
    { id: 'levier', label: 'Amortissement & levier', code: 'LEVIER' },
];

export const RealEstate: React.FC<RealEstateProps> = ({ availableCash, goals, setGoals }) => {
    const { actual } = useMemo(() => partitionRealEstateGoals(goals), [goals]);
    const [lentille, setLentille] = useState<LentilleParcImmo>('synthese');

    const statsParc = useMemo(() => {
        const actifs = actual.filter((g) => g.isActive);
        const valeurBrute = actifs.reduce((sum, g) => sum + (Number(g.currentValue ?? g.price) || 0), 0);
        const equiteNette = actifs.reduce(
            (sum, g) => sum + presentEquityOfGoal(g, monthsSince(g.purchaseDate)),
            0,
        );
        const soldeHypothecaire = Math.max(0, valeurBrute - equiteNette);
        const ratioEquitePct = valeurBrute > 0 ? Math.min(100, Math.max(0, Math.round((equiteNette / valeurBrute) * 100))) : 0;
        return {
            nbActifs: actifs.length,
            valeurBrute,
            equiteNette,
            soldeHypothecaire,
            ratioEquitePct,
        };
    }, [actual]);

    return (
        <div className="space-y-4">
            {/* Bandeau Google Finance Beta — Cote du parc immobilier détenu */}
            <section
                aria-label="Cote et synthèse du parc immobilier"
                className="gf-terminal-card gf-card-interactive bg-surface border border-bordure rounded-2xl overflow-hidden"
            >
                <div className="gf-page-header border-0 rounded-none bg-surface px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-bordure">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="gf-ticker-symbol">
                            <span className="w-1.5 h-1.5 rounded-full bg-current gf-pulse-live" aria-hidden="true" />
                            IMMO:QC · PARC &amp; ÉQUITÉ
                        </span>
                        <span
                            className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold ${
                                statsParc.nbActifs > 0 ? 'gf-delta-up' : 'gf-delta-amber'
                            }`}
                        >
                            {/* NOMBRE-NON-MONETAIRE : nombre de propriétés actives dans le parc */}
                            {statsParc.nbActifs > 0 ? `${statsParc.nbActifs} actif(s)` : 'Aucun bien actif'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold gf-delta-neutral">
                            CAD · Québec
                        </span>
                    </div>

                    <div
                        role="group"
                        aria-label="Lentille de lecture du parc immobilier"
                        className="gf-subtab-bar flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full"
                    >
                        {LENTILLES_PARC.map((item) => (
                            <button
                                key={item.id}
                                type="button"
                                aria-pressed={lentille === item.id}
                                onClick={() => setLentille(item.id)}
                                className={`touch-target gf-subtab-pill shrink-0 px-3 py-1 text-xs font-medium inline-flex items-center gap-1.5 focus-ring ${
                                    lentille === item.id
                                        ? 'gf-subtab-pill-active text-ink-50'
                                        : 'text-ink-300 hover:text-ink-50 hover:bg-surface-douce'
                                }`}
                            >
                                <span>{item.label}</span>
                                <span className="font-mono text-[10px] text-ink-400">{item.code}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="gf-quote-strip border-0 rounded-none">
                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Valeur brute du parc
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                {formatCompactCAD(statsParc.valeurBrute)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-neutral">
                                Actif
                            </span>
                        </div>
                    </div>

                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Équité nette cumulée
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-succes-texte tabular-nums">
                                {formatCompactCAD(statsParc.equiteNette)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-up">
                                <PrivateAmount>{`${statsParc.ratioEquitePct} %`}</PrivateAmount>
                            </span>
                        </div>
                    </div>

                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Solde hypothécaire
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-ink-200 tabular-nums">
                                {formatCompactCAD(statsParc.soldeHypothecaire)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-amber">
                                Passif immo
                            </span>
                        </div>
                    </div>

                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Encaisse mobilisable
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                {formatCompactCAD(availableCash)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-neutral">
                                Liquidités
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            <RealEstateWorkspace
                variant="actuel"
                availableCash={availableCash}
                allGoals={goals}
                visibleGoals={actual}
                setAllGoals={setGoals}
            />
        </div>
    );
};
