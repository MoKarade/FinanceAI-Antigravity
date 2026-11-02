import React, { useMemo, useState } from 'react';
import { RealEstateGoal } from '../../types';
import { partitionRealEstateGoals } from '../../services/realEstatePartition';
import { formatCompactCAD } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';
import { RealEstateWorkspace } from '../realestate/RealEstateWorkspace';

/**
 * [REFONTE-NAV-L3] Page « Projets immo » (destination Vie = ce que je PRÉVOIS).
 * N'affiche que les projets d'achat FUTURS (partition pure sur la même tranche
 * `realEstateGoals` — aucune migration de store, le moteur de projection consomme
 * la tranche complète à l'identique). Les biens DÉTENUS vivent dans
 * Configurations → Immobilier (`components/RealEstate.tsx`).
 */
interface RealEstateProjectsProps {
    availableCash: number;
    goals: RealEstateGoal[];
    setGoals: (g: RealEstateGoal[]) => void;
}

type LentilleProjetImmo = 'acquisition' | 'miseDeFonds' | 'scenarios';

const LENTILLES_PROJETS: ReadonlyArray<{ id: LentilleProjetImmo; label: string; code: string }> = [
    { id: 'acquisition', label: 'Plan d’acquisition', code: 'ACQ' },
    { id: 'miseDeFonds', label: 'Mise de fonds & frais', code: 'CASH' },
    { id: 'scenarios', label: 'Acheter vs Louer', code: 'SIM' },
];

export const RealEstateProjects: React.FC<RealEstateProjectsProps> = ({ availableCash, goals, setGoals }) => {
    const { future } = useMemo(() => partitionRealEstateGoals(goals), [goals]);
    const [lentille, setLentille] = useState<LentilleProjetImmo>('acquisition');

    const statsProjets = useMemo(() => {
        const actifs = future.filter((g) => g.isActive);
        const volumeAcquisition = actifs.reduce((sum, g) => sum + (Number(g.price) || 0), 0);
        const miseDeFondsTotale = actifs.reduce((sum, g) => sum + (Number(g.downPayment) || 0), 0);
        const financementPrevu = Math.max(0, volumeAcquisition - miseDeFondsTotale);
        const couvertureCashPct =
            miseDeFondsTotale > 0
                ? Math.min(100, Math.max(0, Math.round((availableCash / miseDeFondsTotale) * 100)))
                : 100;
        return {
            nbProjetsActifs: actifs.length,
            volumeAcquisition,
            miseDeFondsTotale,
            financementPrevu,
            couvertureCashPct,
            cashSuffisant: availableCash >= miseDeFondsTotale,
        };
    }, [future, availableCash]);

    return (
        <div className="space-y-4">
            {/* Bandeau Google Finance Beta — Cote des scénarios d'acquisition immobilière */}
            <section
                aria-label="Cote et synthèse des projets d'acquisition immobilière"
                className="gf-terminal-card gf-card-interactive bg-surface border border-bordure rounded-2xl overflow-hidden"
            >
                <div className="gf-page-header border-0 rounded-none bg-surface px-4 py-3 flex flex-wrap items-center justify-between gap-2.5 border-b border-bordure">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="gf-ticker-symbol">
                            <span className="w-1.5 h-1.5 rounded-full bg-current gf-pulse-live" aria-hidden="true" />
                            IMMO:SIM · ACQUISITION
                        </span>
                        <span
                            className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold ${
                                statsProjets.cashSuffisant ? 'gf-delta-up' : 'gf-delta-amber'
                            }`}
                        >
                            {statsProjets.cashSuffisant ? 'Mise de fonds couverte' : 'Épargne en constitution'}
                        </span>
                        <span className="px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold gf-delta-neutral">
                            {/* NOMBRE-NON-MONETAIRE : nombre de scénarios d'achat planifiés */}
                            {`${statsProjets.nbProjetsActifs} scénario(s)`}
                        </span>
                    </div>

                    <div
                        role="group"
                        aria-label="Lentille d'analyse des projets immobiliers"
                        className="gf-subtab-bar flex items-center gap-1 overflow-x-auto no-scrollbar max-w-full"
                    >
                        {LENTILLES_PROJETS.map((item) => (
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
                            Volume d’acquisition
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                {formatCompactCAD(statsProjets.volumeAcquisition)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-neutral">
                                Cible
                            </span>
                        </div>
                    </div>

                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Mise de fonds cible
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-ink-50 tabular-nums">
                                {formatCompactCAD(statsProjets.miseDeFondsTotale)}
                            </PrivateAmount>
                            <span
                                className={`px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold ${
                                    statsProjets.cashSuffisant ? 'gf-delta-up' : 'gf-delta-amber'
                                }`}
                            >
                                <PrivateAmount>{`${statsProjets.couvertureCashPct} %`}</PrivateAmount>
                            </span>
                        </div>
                    </div>

                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Hypothèque projetée
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-ink-200 tabular-nums">
                                {formatCompactCAD(statsProjets.financementPrevu)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-amber">
                                Financement
                            </span>
                        </div>
                    </div>

                    <div className="gf-quote-cell bg-fond">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-ink-400">
                            Encaisse disponible
                        </span>
                        <div className="flex items-baseline justify-between gap-2 mt-0.5">
                            <PrivateAmount className="font-mono text-sm sm:text-base font-bold text-succes-texte tabular-nums">
                                {formatCompactCAD(availableCash)}
                            </PrivateAmount>
                            <span className="px-1.5 py-0.5 rounded-sm font-mono text-[10px] font-semibold gf-delta-up">
                                Mobilisable
                            </span>
                        </div>
                    </div>
                </div>
            </section>

            <RealEstateWorkspace
                variant="projet"
                availableCash={availableCash}
                allGoals={goals}
                visibleGoals={future}
                setAllGoals={setGoals}
            />
        </div>
    );
};
