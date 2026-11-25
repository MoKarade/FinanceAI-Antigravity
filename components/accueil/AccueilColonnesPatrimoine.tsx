import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { Tab, type Transaction } from '../../types';
import type { ValoriaQuickSignal } from '../../services/valoria/valoriaIntegration';
import { formatCAD, formatCompactCAD, formatPercent } from '../../utils/format';
import { prefetchTab } from '../../utils/tabPrefetch';
import { ChartDataTable, type ChartDataColumn } from '../ui/ChartDataTable';
import { Icon } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { PrivateText } from '../ui/PrivateText';
import { classePastilleValoria } from './accueilHelpers';
import type {
    JalonPatrimonial,
    LentilleHero,
    PartRepartition,
    PositionSuivie,
    PrioriteActionPatrimoniale,
} from './types';

interface AccueilColonnesPatrimoineProps {
    activeTab: Tab;
    lentilleHero: LentilleHero;
    setActiveTab: (tab: Tab) => void;
    navigateWithFocus: (tab: Tab, focus: string) => void;
    isPrivacyMode: boolean;
    positionsSuivies: PositionSuivie[];
    valoriaSignals: Record<string, ValoriaQuickSignal>;
    valoriaWatchlist: string[];
    partsRepartition: PartRepartition[];
    partSelectionnee: PartRepartition;
    segmentActif: string | null;
    setSegmentActif: (id: string | null) => void;
    epargneMensuelle: number;
    prioritesPlanAction: PrioriteActionPatrimoniale[];
    operationsRecentes: Transaction[];
    prochainsJalons: JalonPatrimonial[];
    anneeActuelle: number;
    onAskGemini: (query: string) => void;
    colonnesRepartition: ChartDataColumn[];
}

export const AccueilColonnesPatrimoine: React.FC<AccueilColonnesPatrimoineProps> = ({
    activeTab,
    lentilleHero,
    setActiveTab,
    navigateWithFocus,
    isPrivacyMode,
    positionsSuivies,
    valoriaSignals,
    valoriaWatchlist,
    partsRepartition,
    partSelectionnee,
    segmentActif,
    setSegmentActif,
    epargneMensuelle,
    prioritesPlanAction,
    operationsRecentes,
    prochainsJalons,
    anneeActuelle,
    onAskGemini,
    colonnesRepartition,
}) => (
    <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-bordure bg-surface">
        {/* ── COLONNE GAUCHE (7 COL) : LISTE SUIVIE & ALLOCATION D'ACTIFS ── */}
        <div className="lg:col-span-7 divide-y divide-bordure">
            {/* Liste suivie des positions */}
            <section aria-label="Listes et portefeuilles suivis" className="divide-y divide-bordure">
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                            Portefeuilles & Liste suivie
                        </h2>
                        <span className="text-xs font-mono text-ink-400">
                            {/* NOMBRE-NON-MONETAIRE : nombre de lignes suivies */}
                            ({positionsSuivies.length})
                        </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => navigateWithFocus(Tab.INVESTMENTS, 'tab:portfolio')}
                            onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                            className="touch-target min-h-11 px-3.5 py-1.5 rounded-full border border-bordure-champ bg-surface hover:bg-surface-douce text-xs font-medium text-texte inline-flex items-center gap-1.5 focus-ring"
                        >
                            <Icon name="sparkles" size={14} aria-hidden="true" />
                            <span>Conseiller 7 Agents</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab(Tab.INVESTMENTS)}
                            onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                            className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                        >
                            <span>Placements</span>
                            <Icon name="chevron-right" size={14} aria-hidden="true" />
                        </button>
                    </div>
                </div>

                <div className="divide-y divide-bordure">
                    {positionsSuivies.slice(0, 8).map((pos) => {
                        const sig = valoriaSignals[pos.symbole.toUpperCase()];
                        const isHeldAsset = pos.id.startsWith('asset-');
                        return (
                            <div
                                key={`left-${pos.id}`}
                                className="gf-row px-4 sm:px-6 py-3 flex items-center justify-between gap-2.5 sm:gap-3 min-w-0"
                            >
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(pos.tab)}
                                    onMouseEnter={() => prefetchTab(pos.tab)}
                                    className="touch-target min-h-11 min-w-0 flex-1 flex items-center justify-between gap-2.5 sm:gap-4 text-left focus-ring rounded-lg py-0.5"
                                >
                                    <div className="min-w-0 flex-1 space-y-0.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono text-sm font-bold text-ink-50 shrink-0">
                                                {pos.symbole}
                                            </span>
                                            <span className="text-xs text-ink-400 font-mono truncate">
                                                {pos.compte}
                                            </span>
                                        </div>
                                        <div className="text-xs text-ink-400 min-w-0">
                                            <PrivateAmount as="div" className="truncate">{pos.nom}</PrivateAmount>
                                        </div>
                                    </div>

                                    <svg
                                        width="56"
                                        height="22"
                                        viewBox="0 0 48 22"
                                        aria-hidden="true"
                                        className="shrink-0 overflow-visible hidden sm:block"
                                    >
                                        <polyline
                                            fill="none"
                                            stroke={pos.variationPct == null ? 'var(--gf-bleu)' : pos.positif ? 'var(--gf-vert)' : 'var(--gf-rouge)'}
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            points={pos.pointsSparkline}
                                        />
                                    </svg>

                                    <div className="text-right font-mono tabular-nums shrink-0 space-y-0.5">
                                        <div className="text-sm font-bold text-ink-50">
                                            <PrivateAmount>{formatCompactCAD(pos.valeur)}</PrivateAmount>
                                        </div>
                                        <span
                                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                pos.variationPct == null
                                                    ? 'gf-delta-neutral'
                                                    : pos.positif
                                                      ? 'gf-delta-up'
                                                      : 'gf-delta-down'
                                            }`}
                                        >
                                            {pos.variationPct != null ? (
                                                <PrivateAmount>
                                                    {`${pos.positif ? '+' : ''}${formatPercent(pos.variationPct)}`}
                                                </PrivateAmount>
                                            ) : (
                                                <span>{`${pos.poidsPct} %`}</span>
                                            )}
                                        </span>
                                    </div>
                                </button>

                                {isHeldAsset && sig && (
                                    <button
                                        type="button"
                                        onClick={() => navigateWithFocus(Tab.INVESTMENTS, `asset:${pos.symbole}`)}
                                        onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                        className={`touch-target min-h-11 px-2.5 py-1 rounded-full text-xs font-mono font-semibold shrink-0 whitespace-nowrap focus-ring ${classePastilleValoria(sig.signal)}`}
                                    >
                                        {/* NOMBRE-NON-MONETAIRE : score quantitatif public Valoria */}
                                        <span>{sig.labelCourt} · {sig.score100}</span>
                                        <span className="sr-only"> — Rayon-X Valoria de {pos.symbole}</span>
                                    </button>
                                )}
                            </div>
                        );
                    })}

                    {/* Liste suivie Valoria synchronisée */}
                    {(() => {
                        const heldRoots = new Set(
                            positionsSuivies
                                .filter((p) => p.id.startsWith('asset-'))
                                .map((p) => p.symbole.toUpperCase().split('.')[0]),
                        );
                        const watchlistOnly = valoriaWatchlist.filter(
                            (sym) => !heldRoots.has(sym.trim().toUpperCase().split('.')[0]),
                        );
                        if (watchlistOnly.length === 0) return null;
                        return (
                            <div className="px-6 py-3.5 bg-fond/40 space-y-2">
                                <div className="flex items-center justify-between gap-2 text-xs text-ink-400">
                                    <span className="font-semibold text-ink-200">
                                        Liste suivie Valoria ({watchlistOnly.length})
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => navigateWithFocus(Tab.INVESTMENTS, 'tab:market')}
                                        className="touch-target min-h-11 px-2 text-xs font-medium text-ink-200 hover:text-ink-50 underline underline-offset-2 focus-ring rounded-md"
                                    >
                                        Explorer les marchés
                                    </button>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {watchlistOnly.slice(0, 6).map((sym) => {
                                        const sig = valoriaSignals[sym.trim().toUpperCase()];
                                        return (
                                            <button
                                                key={`watch-${sym}`}
                                                type="button"
                                                onClick={() => navigateWithFocus(Tab.INVESTMENTS, `asset:${sym}`)}
                                                onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                                className="touch-target min-h-11 px-3 py-1.5 rounded-full border border-bordure bg-surface hover:bg-surface-douce text-xs font-mono text-ink-100 inline-flex items-center gap-2 focus-ring"
                                            >
                                                <span className="font-bold">{sym}</span>
                                                {sig && (
                                                    <>
                                                        <span className="text-ink-400">
                                                            {/* MONTANT-PUBLIC : cours public de marché */}
                                                            {formatCAD(sig.spotPriceCad)}
                                                        </span>
                                                        <span
                                                            className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${classePastilleValoria(sig.signal)}`}
                                                        >
                                                            {/* NOMBRE-NON-MONETAIRE : score quantitatif public Valoria */}
                                                            {sig.score100}
                                                        </span>
                                                    </>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </section>

            {/* Allocation d'actifs compacte */}
            <section aria-label="Répartition visuelle des actifs" className="divide-y divide-bordure">
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                        Allocation d’actifs
                    </h2>
                    <button
                        type="button"
                        onClick={() => setActiveTab(partSelectionnee.tab)}
                        onMouseEnter={() => prefetchTab(partSelectionnee.tab)}
                        className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                    >
                        <span>Détails</span>
                        <Icon name="chevron-right" size={14} aria-hidden="true" />
                    </button>
                </div>

                <div className="p-6 grid grid-cols-1 sm:grid-cols-12 gap-6 items-center">
                    <div className="sm:col-span-5 relative h-[150px] w-full flex items-center justify-center">
                        <div
                            key={`${activeTab}-repartition-${lentilleHero}`}
                            data-testid="recharts-allocation-entrance"
                            data-active-tab={activeTab}
                            data-chart-lens={lentilleHero}
                            role="img"
                            aria-label="Anneau de répartition des avoirs par classe d'actifs — détail chiffré dans le tableau de données."
                            className="h-full w-full gf-chart-enter"
                        >
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={partsRepartition}
                                        dataKey="valeur"
                                        nameKey="label"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={44}
                                        outerRadius={64}
                                        paddingAngle={2}
                                        stroke="none"
                                        isAnimationActive={true}
                                        animationBegin={30}
                                        animationDuration={360}
                                        animationEasing="ease-out"
                                        onMouseEnter={(_, idx) => {
                                            const item = partsRepartition[idx];
                                            if (item) setSegmentActif(item.id);
                                        }}
                                    >
                                        {partsRepartition.map((entry) => (
                                            <Cell
                                                key={entry.id}
                                                fill={entry.couleur}
                                                opacity={
                                                    segmentActif === null || segmentActif === entry.id ? 1 : 0.35
                                                }
                                            />
                                        ))}
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 space-y-0.5">
                            <span className="text-xs font-medium text-ink-300 truncate max-w-[90px]">
                                {partSelectionnee.label}
                            </span>
                            <PrivateAmount className="font-mono text-sm font-bold text-ink-50 tabular-nums">
                                {formatCompactCAD(partSelectionnee.valeur)}
                            </PrivateAmount>
                        </div>
                    </div>

                    <div
                        role="group"
                        aria-label="Sélection d'une enveloppe d'actifs"
                        className="sm:col-span-7 space-y-1.5"
                    >
                        {partsRepartition.map((part) => (
                            <button
                                key={part.id}
                                type="button"
                                aria-pressed={partSelectionnee.id === part.id}
                                onMouseEnter={() => setSegmentActif(part.id)}
                                onFocus={() => setSegmentActif(part.id)}
                                onClick={() => setSegmentActif(part.id)}
                                className={`touch-target w-full px-3.5 py-2 rounded-lg flex items-center justify-between gap-3 text-sm transition-colors duration-100 focus-ring ${
                                    partSelectionnee.id === part.id
                                        ? 'bg-surface-douce text-ink-50 font-semibold'
                                        : 'text-ink-200 hover:bg-surface-douce'
                                }`}
                            >
                                <span className="flex items-center gap-2.5 min-w-0 truncate">
                                    <span
                                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${part.classeBarre}`}
                                        aria-hidden="true"
                                    />
                                    <span className="truncate">{part.label}</span>
                                </span>
                                <span className="font-mono text-sm text-ink-100 tabular-nums shrink-0">
                                    <PrivateAmount>{formatCompactCAD(part.valeur)}</PrivateAmount>
                                    <span className="text-ink-400 ml-2">
                                        <PrivateAmount>{`${part.pct}%`}</PrivateAmount>
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </section>
            <ChartDataTable
                caption="Répartition actuelle des avoirs par classe d'actifs"
                columns={colonnesRepartition}
                rows={partsRepartition as unknown as ReadonlyArray<Record<string, unknown>>}
            />
        </div>

        {/* ── COLONNE DROITE (5 COL) : PLAN D'ACTION ÉPURÉ, ACTIVITÉ & CALENDRIER ── */}
        <div className="lg:col-span-5 divide-y divide-bordure">
            {/* Plan d'action patrimonial épuré avec bouton direct vers Gemini */}
            <section
                data-testid="plan-action-ameliore"
                aria-label="Plan d'action patrimonial"
                className="divide-y divide-bordure"
            >
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2.5">
                        <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                            Plan d’action patrimonial
                        </h2>
                        <span className="sr-only">Actions prioritaires recommandées</span>
                        <span className="sr-only">Cadence d’exécution programmée</span>
                        <span
                            className={`px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${
                                epargneMensuelle > 0 ? 'gf-delta-up' : 'gf-delta-neutral'
                            }`}
                        >
                            <PrivateAmount>
                                {`${epargneMensuelle >= 0 ? '+' : ''}${formatCompactCAD(epargneMensuelle)}/mois`}
                            </PrivateAmount>
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={() =>
                            onAskGemini(
                                'Quelles sont les 3 meilleures actions concrètes à exécuter ce mois-ci sur mon portefeuille et mon budget ?',
                            )
                        }
                        className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 transition-colors focus-ring whitespace-nowrap shrink-0"
                    >
                        <Icon name="sparkles" size={14} className="text-repere" aria-hidden="true" />
                        <span>Gemini</span>
                    </button>
                </div>

                <div className="divide-y divide-bordure">
                    {prioritesPlanAction.map((prio) => (
                        <button
                            key={prio.id}
                            type="button"
                            onClick={() => setActiveTab(prio.tab)}
                            onMouseEnter={() => prefetchTab(prio.tab)}
                            className="gf-row touch-target w-full px-6 py-4 text-left flex items-center justify-between gap-4 focus-ring group"
                        >
                            <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="text-sm font-semibold text-ink-50 line-clamp-2 leading-snug group-hover:underline">
                                        {prio.titre}
                                    </span>
                                </div>
                                <div className="h-1.5 w-full max-w-[220px] rounded-full bg-fond overflow-hidden">
                                    <div
                                        style={{ width: `${isPrivacyMode ? 50 : prio.progressionPct}%` }}
                                        className={`h-full rounded-full gf-bar-grow ${prio.classeBarre}`}
                                    />
                                </div>
                            </div>

                            <div className="flex items-center gap-2.5 shrink-0">
                                <span
                                    className={`px-2.5 py-0.5 rounded-full font-mono text-xs font-semibold tabular-nums ${prio.statutClasse}`}
                                >
                                    <PrivateAmount>{prio.statutLabel}</PrivateAmount>
                                </span>
                                <Icon name="chevron-right" size={14} className="text-ink-400" aria-hidden="true" />
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            {/* Activité récente épurée */}
            <section aria-label="Opérations récentes" className="divide-y divide-bordure">
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                        Activité récente
                    </h2>
                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                        onMouseEnter={() => prefetchTab(Tab.TRANSACTIONS)}
                        className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                    >
                        <span>Journal</span>
                        <Icon name="chevron-right" size={14} aria-hidden="true" />
                    </button>
                </div>

                {operationsRecentes.length > 0 ? (
                    <div className="divide-y divide-bordure">
                        {operationsRecentes.slice(0, 4).map((tx) => {
                            const estRevenu = tx.amount > 0;
                            return (
                                <button
                                    key={tx.id}
                                    type="button"
                                    onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                                    className="gf-row touch-target w-full px-6 py-3 flex items-center justify-between gap-3 text-left focus-ring"
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-ink-50 truncate">
                                            <PrivateText quoi="marchand">{tx.payee}</PrivateText>
                                        </div>
                                        <div className="text-xs text-ink-400 truncate font-mono tabular-nums">
                                            {tx.date.slice(5)} · <PrivateText quoi="categorie">{tx.category}</PrivateText>
                                        </div>
                                    </div>
                                    <PrivateAmount
                                        className={`font-mono text-sm font-semibold tabular-nums shrink-0 ${
                                            estRevenu ? 'text-succes-texte' : 'text-ink-200'
                                        }`}
                                    >
                                        {`${estRevenu ? '+' : '−'}${formatCAD(Math.abs(tx.amount))}`}
                                    </PrivateAmount>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="px-6 py-5 flex items-center justify-between gap-3">
                        <span className="text-sm text-ink-300">Aucune opération enregistrée</span>
                        <button
                            type="button"
                            onClick={() => setActiveTab(Tab.TRANSACTIONS)}
                            className="touch-target px-3.5 py-1.5 rounded-full bg-accent text-sur-accent text-xs font-semibold inline-flex items-center gap-1.5 focus-ring"
                        >
                            <Icon name="plus" size={14} aria-hidden="true" />
                            <span>Ajouter</span>
                        </button>
                    </div>
                )}
            </section>

            {/* Calendrier & jalons compact */}
            <section aria-label="Prochains jalons patrimoniaux" className="divide-y divide-bordure">
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-ink-50 tracking-normal">
                        Calendrier & jalons
                    </h2>
                    <button
                        type="button"
                        onClick={() => setActiveTab(Tab.LIFE_PROJECTS)}
                        onMouseEnter={() => prefetchTab(Tab.LIFE_PROJECTS)}
                        className="touch-target px-3.5 py-1.5 rounded-full border border-bordure bg-fond hover:bg-surface-douce text-xs font-medium text-ink-100 inline-flex items-center gap-1.5 focus-ring"
                    >
                        <span>Projets</span>
                        <Icon name="chevron-right" size={14} aria-hidden="true" />
                    </button>
                </div>

                <div className="divide-y divide-bordure">
                    {prochainsJalons.slice(0, 3).map((jalon) => {
                        const ecartAnnees = jalon.annee - anneeActuelle;
                        const delaiTexte = isPrivacyMode ? '••' : ecartAnnees <= 0 ? 'Actif' : `Dans ${ecartAnnees} an${ecartAnnees > 1 ? 's' : ''}`;
                        return (
                            <button
                                key={jalon.id}
                                type="button"
                                onClick={() => setActiveTab(jalon.tab)}
                                className="gf-row touch-target w-full px-6 py-3 flex items-center justify-between gap-3 text-left focus-ring"
                            >
                                <div className="min-w-0 flex items-center gap-3">
                                    <span className="px-2 py-0.5 rounded-md gf-delta-amber font-mono tabular-nums text-xs font-bold shrink-0">
                                        {jalon.annee}
                                    </span>
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-ink-50 truncate">
                                            {jalon.titre}
                                        </div>
                                        <div className="text-xs text-ink-400 truncate">
                                            {jalon.categorie} · {delaiTexte}
                                        </div>
                                    </div>
                                </div>
                                <PrivateAmount className="font-mono tabular-nums text-sm font-semibold text-ink-50 shrink-0">
                                    {formatCompactCAD(jalon.montant)}
                                </PrivateAmount>
                            </button>
                        );
                    })}
                </div>
            </section>

            {/* Pied de traçabilité discret en une seule ligne (Preuves & Sources) */}
            <div
                data-testid="preuves-sources-panel"
                className="px-6 py-3 bg-fond flex items-center justify-between gap-3 text-xs text-ink-400"
            >
                <span className="inline-flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full gf-alloc-reer" aria-hidden="true" />
                    <span>Preuves & Sources · Calculs ARC & Revenu Québec 2026 vérifiés</span>
                </span>
                <button
                    type="button"
                    onClick={() => setActiveTab(Tab.TAX)}
                    className="touch-target px-2.5 py-1 rounded-full hover:text-ink-100 font-medium underline focus-ring"
                >
                    Fiscalité
                </button>
            </div>
        </div>
    </div>
);
