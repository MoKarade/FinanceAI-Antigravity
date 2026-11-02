import React from 'react';
import { ArrowUpRight } from 'lucide-react';

export interface JalonProjection {
    cle: string;
    libelle: string;
    /** Libellé court (téléphone), sinon `libelle`. */
    libelleCourt?: string;
    /** Année (« 2036 », « ≈ 2036 ») ou « — ». */
    annee: React.ReactNode;
    age: React.ReactNode;
    /** Montant DÉJÀ enveloppé par l'appelant (`PrivateAmount`) ou `null` → « — ». */
    montant: React.ReactNode | null;
    /** Teinte du montant : FIRE en ambre (couleur de sa série). */
    ton?: 'fire';
    /** Ligne masquée au téléphone (maquette F-mobile : pas de ligne « Aujourd'hui »). */
    bureauSeulement?: boolean;
    /** Action de navigation directe vers l'écran source du jalon. */
    onClick?: () => void;
}

const ICONE_JALON: Record<string, string> = {
    aujourdhui: '📍',
    fire: '🔥',
    retraite: '🏖️',
    horizon: '🏁',
};

const ICONE_LEVIER: Record<string, string> = {
    'Âge de retraite': '🎂',
    'Ordre de retrait': '🔄',
    'Profil de rendement': '📈',
    'Rentes gouvernementales': '🏛️',
};

export const TableJalons: React.FC<{ jalons: JalonProjection[]; etroit: boolean }> = ({ jalons, etroit }) => {
    const lignes = etroit ? jalons.filter((j) => !j.bureauSeulement) : jalons;
    const th = 'text-[10px] font-semibold tracking-wider uppercase text-ink-400';
    return (
        <section aria-label="Jalons de la projection" className="rounded-2xl bg-surface border border-white/6 overflow-hidden min-w-0 p-3">
            <table className="w-full text-body">
                <caption className="sr-only">Jalons de la projection : année, âge et montant</caption>
                <thead className="sr-only">
                    <tr className="text-left">
                        <th scope="col" className={th}>Jalon</th>
                        <th scope="col" className={th}>Année</th>
                        <th scope="col" className={th}>Âge</th>
                        <th scope="col" className={th}>Montant</th>
                    </tr>
                </thead>
                <tbody className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 gf-spring-grid">
                    {lignes.map((j) => {
                        const texteJalon = etroit ? (j.libelleCourt ?? j.libelle) : j.libelle;
                        const icone = ICONE_JALON[j.cle] ?? '•';
                        return (
                            <tr
                                key={j.cle}
                                onClick={j.onClick}
                                className={`flex flex-col justify-between rounded-xl border border-bordure bg-surfaceHighlight/25 p-3 gf-card-interactive ${
                                    j.onClick ? 'cursor-pointer hover:border-primary/60 hover:bg-surfaceHighlight/45 group' : ''
                                }`}
                            >
                                <th scope="row" className="flex items-center justify-between gap-2 text-left font-normal text-ink-100">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <span aria-hidden="true" className="text-base">{icone}</span>
                                        {j.onClick ? (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    j.onClick?.();
                                                }}
                                                className="touch-target inline-flex items-center gap-1.5 text-left text-xs font-semibold text-ink-100 group-hover:text-repere focus-ring rounded-sm"
                                            >
                                                <span>{texteJalon}</span>
                                                <ArrowUpRight className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
                                            </button>
                                        ) : (
                                            <span className="text-xs font-semibold">{texteJalon}</span>
                                        )}
                                    </span>
                                </th>
                                <td className="mt-2 flex items-baseline justify-between gap-2">
                                    <span className="inline-flex items-center gap-1.5 text-tiny font-mono text-ink-300 bg-surface/60 px-2 py-0.5 rounded-full border border-bordure">
                                        <span>{j.annee}</span>
                                        <span>·</span>
                                        <span>{j.age} ans</span>
                                    </span>
                                    <span className={`font-mono text-sm font-bold whitespace-nowrap ${j.ton === 'fire' ? 'text-warning-400' : 'text-ink-50'}`}>
                                        {j.montant ?? <span className="text-ink-400">—</span>}
                                    </span>
                                </td>
                                <td className="sr-only">{j.age}</td>
                                <td className="sr-only">{j.montant ?? '—'}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </section>
    );
};

export interface LevierAffiche {
    libelle: string;
    valeur: string;
    onClick?: () => void;
}

export const CarteLeviers: React.FC<{
    leviers: LevierAffiche[];
    /** Nom de la stratégie que la courbe affiche (celui du moteur) — absent : rien d'affiché. */
    strategie?: string;
    /** Résumé d'une phrase (téléphone, maquette F-mobile). */
    resume: string;
    nbLeviers: number;
    etroit: boolean;
    onOptimiser: () => void;
}> = ({ leviers, strategie, resume, nbLeviers, etroit, onOptimiser }) => (
    <section aria-labelledby="leviers-titre" className="rounded-2xl bg-surface border border-white/6 p-3.5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2 min-w-0">
            <h2 id="leviers-titre" className="text-sm font-bold text-ink-50">Leviers actifs</h2>
            {strategie && (
                <p className="px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[11px] font-mono font-semibold truncate">
                    {`Stratégie : ${strategie}`}
                </p>
            )}
        </div>
        {etroit ? (
            <p className="text-meta text-ink-300 leading-snug">{resume}</p>
        ) : (
            <dl className="grid grid-cols-2 gap-2 gf-spring-grid">
                {leviers.map((l) => (
                    <div
                        key={l.libelle}
                        onClick={l.onClick}
                        className={`flex flex-col justify-between gap-1 rounded-xl border border-bordure bg-surfaceHighlight/25 p-2.5 gf-card-interactive ${
                            l.onClick ? 'cursor-pointer hover:border-primary/60 hover:bg-surfaceHighlight/45 group' : ''
                        }`}
                    >
                        <dt className="text-[11px] text-ink-300 flex items-center justify-between gap-1">
                            <span className="flex items-center gap-1 min-w-0">
                                <span aria-hidden="true">{ICONE_LEVIER[l.libelle] ?? '⚡'}</span>
                                {l.onClick ? (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            l.onClick?.();
                                        }}
                                        className="touch-target inline-flex items-center gap-1 text-left text-ink-300 group-hover:text-repere focus-ring rounded-sm truncate"
                                    >
                                        <span className="truncate">{l.libelle}</span>
                                        <ArrowUpRight className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
                                    </button>
                                ) : (
                                    <span className="truncate">{l.libelle}</span>
                                )}
                            </span>
                        </dt>
                        <dd className="font-mono text-xs font-bold text-ink-50 truncate">{l.valeur}</dd>
                    </div>
                ))}
            </dl>
        )}
        {!etroit && (
            <button type="button" onClick={onOptimiser} className="sr-only min-h-6">
                Voir les {nbLeviers} leviers
            </button>
        )}
        <button
            type="button"
            onClick={onOptimiser}
            title="Recomposer tes leviers et recalculer la meilleure stratégie"
            className="h-11 rounded-xl bg-primary text-dark text-xs font-bold hover:brightness-105 transition focus-ring cursor-pointer"
        >
            ⚡ Optimiser la stratégie ({nbLeviers} leviers)
        </button>
    </section>
);
