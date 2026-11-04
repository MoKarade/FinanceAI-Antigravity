import React, { useEffect, useMemo } from 'react';
import { formatCAD, formatPercent } from '../utils/format';
import { PrivateAmount } from './ui/PrivateAmount';
import { AnimatedNetWorth } from './ui/AnimatedNetWorth';
import { NO_DATA_LABEL } from './ui/emptyAware';
import { useFinanceStore } from '../store/useFinanceStore';
import { useNetWorthVariation, VARIATION_WINDOW_DAYS } from '../hooks/useNetWorthVariation';
import { presentTermesOfGoal, monthsSince } from '../services/projection/pastPurchaseInit';
import { FxEstimateBadge } from './ui/FxEstimateBadge';
import { Tab } from '../types';
import { prefetchTab } from '../utils/tabPrefetch';
import { ArrowUpRight } from 'lucide-react';

const LIBELLE_CIBLE: Partial<Record<Tab, string>> = {
    [Tab.INVESTMENTS]: 'Placements',
    [Tab.DEBT]: 'Dettes',
    [Tab.BUDGET]: 'Budget',
};

const TUILE_BASE = 'gf-quote-cell min-w-0 rounded-xl bg-surface border px-3.5 py-2.5 flex flex-col gap-1';
const TUILE_CLIQUABLE = 'touch-target cursor-pointer gf-stat-cell border-bordure hover:border-repere hover:bg-surface-douce transition-all duration-200 focus-ring group';
const PIED_CLIQUABLE = 'mt-auto pt-1.5 border-t border-bordure flex items-center justify-between text-[11px] font-semibold text-repere group-hover:text-ink-50 transition-colors';

/**
 * [REFONTE-NAV Lot 1] Bandeau KPI compact AU-DESSUS de la courbe Future (choix Marc :
 * « bandeau compact au-dessus »). Reprend les chiffres de tête de l'ex-Accueil pour que
 * son retrait ne perde rien : patrimoine net, variation 30 j, liquidités, épargne du mois.
 *
 * Valeurs = dérivées RÉELLES du store (useDerivedFinancials via TabRouter + hooks internes),
 * jamais de la projection — le bandeau reste juste même quand la courbe recalcule.
 * No-fake-data : une valeur non finie s'affiche « — » (jamais un 0 $ crédible).
 * [REFONTE-NAV-L2a] Variation 30 j (useNetWorthVariation) + équité immo dans le patrimoine
 * (mêmes conventions que le KPI de l'ex-Accueil, étiquetée). Itération panel #601 : la
 * variation couvre « liquide + placements » PAR CONSTRUCTION (les termes immo/dettes à
 * granularité annuelle/constante fabriquaient des sauts fictifs au 31 décembre) — son
 * assiette de % diffère donc de la tuile Patrimoine et l'étiquette de périmètre le dit
 * (leçon DASH-NETWORTH-CANONICAL). Reste (santé financière…) : Lot 2b.
 */
const KpiTile: React.FC<{
    label: string;
    value: number;
    signed?: boolean;
    /**
     * Précision de périmètre ou variation relative, sous la valeur.
     *
     * ⚠️ TYPÉ `ReactNode`, PAS `string` — leçon du dépôt : « un champ de texte d'interface qui peut
     * contenir un montant ne doit jamais être typé `string` » (déjà payée sur `DualKPIStat.sublabel`
     * et `PageHeader.subtitle`). Un montant interpolé dans une phrase n'est plus un nœud, donc plus
     * masquable — l'appelant doit pouvoir envelopper LA valeur et laisser l'explication lisible.
     *
     * Deux masquages, deux besoins distincts :
     *  · `privateSublabel` — le sous-titre est ENTIÈREMENT un montant (la variation en %) : on masque
     *    tout, l'appelant n'a rien à découper.
     *  · `<PrivateAmount>` posé par l'appelant — le sous-titre MÊLE explication et montant (« dont
     *    X $ d'hypothèque ») : seule la valeur part, la phrase reste. C'est aussi ce qu'exige
     *    `amountPrivacyScan` d'une ligne d'ATTRIBUT — elle porte sa marque À ELLE, le masquage du
     *    voisin ne lui sert jamais d'alibi.
     */
    sublabel?: React.ReactNode;
    privateSublabel?: boolean;
    /** Étiquette de PÉRIMÈTRE (assiette du chiffre), sous le sublabel — jamais privée : elle ne
     *  contient aucune donnée financière, et doit rester lisible même en mode discret. */
    scope?: string;
    /** Signal additionnel à côté du libellé (ex. FxEstimateBadge) — jamais de donnée financière. */
    badge?: React.ReactNode;
    /** Symbole boursier synthétique style Google Finance Beta (sans chiffre ni signe $). */
    symbole?: string;
    /** Ton de la pastille symbole (.gf-delta-up / .gf-delta-down / .gf-delta-neutral / .gf-delta-amber). */
    deltaTone?: 'gf-delta-up' | 'gf-delta-down' | 'gf-delta-neutral' | 'gf-delta-amber';
    /** Couleur de la valeur (maquette : dettes en rouge, épargne en vert). */
    ton?: string;
    /** Navigation directe au clic vers l'écran source (style Google Finance). */
    cibleOnglet?: Tab;
    onClick?: () => void;
}> = ({ label, value, signed = false, sublabel, privateSublabel = false, scope, badge, symbole, deltaTone = 'gf-delta-neutral', ton = 'text-ink-50', cibleOnglet, onClick }) => {
    const nomCible = cibleOnglet ? LIBELLE_CIBLE[cibleOnglet] : undefined;
    return (
        <div
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
            title={nomCible ? `${label} — Ouvrir ${nomCible}` : undefined}
            onClick={onClick}
            onMouseEnter={() => { if (cibleOnglet) prefetchTab(cibleOnglet); }}
            onFocus={() => { if (cibleOnglet) prefetchTab(cibleOnglet); }}
            onKeyDown={(e) => {
                if (onClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onClick();
                }
            }}
            className={`${TUILE_BASE} ${onClick ? TUILE_CLIQUABLE : 'border-bordure'}`}
        >
            <p className="text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-400 flex flex-wrap items-center gap-1.5">
                {label}{badge}
                {symbole && (
                    <span className={`ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-mono font-bold tracking-wider ${deltaTone}`} aria-hidden="true">
                        {symbole}
                    </span>
                )}
            </p>
            {Number.isFinite(value) ? (
                <AnimatedNetWorth
                    value={value}
                    signed={signed}
                    as="div"
                    testId={`animated-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                    className={`text-[20px] leading-tight font-bold font-mono ${ton}`}
                />
            ) : (
                <div className="text-[20px] leading-tight font-bold text-ink-300">
                    {/* [Audit a11y #600, LOW] NO_DATA_LABEL importé (source unique). */}
                    <span aria-hidden="true">—</span>
                    <span className="sr-only">{NO_DATA_LABEL}</span>
                </div>
            )}
            {sublabel && (privateSublabel ? (
                <PrivateAmount as="div" className="text-tiny text-ink-400">{sublabel}</PrivateAmount>
            ) : (
                <p className="text-tiny text-ink-400">{sublabel}</p>
            ))}
            {scope && <p className="text-tiny text-ink-400">{scope}</p>}
            {onClick && nomCible && (
                <span className={PIED_CLIQUABLE} aria-hidden="true">
                    <span>Ouvrir {nomCible}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
            )}
        </div>
    );
};

/**
 * [S5-REFONTE-FUTUR] Où le bandeau se rend (maquettes F-bureau / F-mobile) :
 *  · `bureau` — cinq tuiles (Patrimoine net, Total avoirs, Dettes, Liquidités, Épargne / mois) ;
 *  · `mobile-tete` — le patrimoine net en grand et l'épargne du mois, sous l'en-tête ;
 *  · `mobile-pied` — « Avoirs / dettes » et « Liquidités », en tuiles sous la courbe.
 * La variation 30 j (retirée des tuiles par la maquette) suit le patrimoine net, en une ligne,
 * et seulement quand elle est mesurée : pas de ligne « — » sous le chiffre de tête.
 */
export type VarianteBandeau = 'bureau' | 'mobile-tete' | 'mobile-pied';

export const FutureKpiStrip: React.FC<{
    netWorth: number;
    liquidity: number;
    monthlySavings: number;
    /** [KPI-AVOIRS-DETTES] Les deux TERMES hors immobilier, du MÊME appel que `netWorth`. */
    avoirsHorsImmo: number;
    dettesHorsImmo: number;
    variante?: VarianteBandeau;
}> = ({ netWorth, liquidity, monthlySavings, avoirsHorsImmo, dettesHorsImmo, variante = 'bureau' }) => {
    // [REFONTE-NAV-L2a] Variation 30 j — liquide + placements (hook, pas de prop-drilling).
    // `null` (couverture < 2 points) → tuile « — » : jamais un 0 $ crédible.
    const variation = useNetWorthVariation();
    const setActiveTab = useFinanceStore(s => s.setActiveTab);

    // Préchargement proactif des 3 sous-onglets cibles (Placements, Dettes, Budget) pour une transition instantanée
    useEffect(() => {
        prefetchTab(Tab.INVESTMENTS);
        prefetchTab(Tab.DEBT);
        prefetchTab(Tab.BUDGET);
    }, []);

    // [MED #601] Si l'étendue réelle des données est plus courte que la fenêtre demandée
    // (portefeuille jeune, historique périmé), le périmètre DIT « sur N j de données » au
    // lieu de laisser le titre « 30 j » mentir sur la couverture.
    const variationScope = variation && variation.spanDays < VARIATION_WINDOW_DAYS
        ? `liquide + placements · sur ${variation.spanDays} j de données`
        : 'liquide + placements (courbe historique)';

    // [REFONTE-NAV-L2a] Parité avec le KPI patrimoine de l'ex-Accueil (DASH-NW-DUP) : la prop
    // `netWorth` (useDerivedFinancials → computePresentNetWorth) est HORS immo — l'ex-Accueil y
    // AJOUTAIT l'équité immobilière et l'étiquetait. On reprend les deux ENSEMBLE : ajouter
    // l'étiquette sans la valeur (ou l'inverse) referait la classe « deux patrimoines à l'écran ».
    // `presentEquityOfGoal` porte sa propre garde non-fini (bien exclu + log throttlé).
    // [LOW #601] La porte de l'étiquette est `.some(équité ≠ 0)` — parité EXACTE avec le gate
    // de l'ex-Accueil : deux équités qui se compensent (somme 0) restent de l'immobilier à
    // l'écran, l'étiquette doit s'afficher même si la somme ajoutée est nulle.
    const realEstateGoals = useFinanceStore(s => s.realEstateGoals);
    // [KPI-AVOIRS-DETTES] Les deux termes de CHAQUE bien viennent d'un seul appel
    // (`presentTermesOfGoal`), dont `presentEquityOfGoal` dérive : `valeur − hypothèque === équité`
    // par construction. Les calculer séparément ferait trois chiffres qui cessent de se recomposer
    // au premier correctif appliqué à un seul (`UNE-FORMULE-MONEY-CRITICAL-RECOPIEE-DIVERGE`).
    const { realEstateEquity, realEstateValeur, realEstateHypotheque, hasRealEstate } = useMemo(() => {
        const termes = realEstateGoals.map(g => presentTermesOfGoal(g, monthsSince(g.purchaseDate)));
        const somme = (f: (t: { valeur: number; hypotheque: number }) => number) =>
            termes.reduce((sum, t) => sum + f(t), 0);
        return {
            realEstateEquity: somme(t => t.valeur - t.hypotheque),
            realEstateValeur: somme(t => t.valeur),
            realEstateHypotheque: somme(t => t.hypotheque),
            hasRealEstate: termes.some(t => t.valeur - t.hypotheque !== 0),
        };
    }, [realEstateGoals]);

    /**
     * [KPI-AVOIRS-DETTES] Demande de l'utilisateur : voir sa somme totale d'argent et sa somme
     * totale de dettes. Décision : « ce que je dois » inclut l'hypothèque, AVEC son détail —
     * c'est ce que le sous-titre porte.
     *
     * ⚠️⚠️ L'IDENTITÉ QUE CES TROIS TUILES DOIVENT TENIR À L'ŒIL :
     *     avoirs − dettes = patrimoine net
     * Elle est vraie PAR CONSTRUCTION ici, et il ne faut pas s'en écarter :
     *     avoirs   = (actifs hors immo)      + valeur BRUTE des biens
     *     dettes   = (dettes hors immo)      + hypothèques
     *     net      = (actifs − dettes) hors immo + (valeur − hypothèque)  ← la tuile existante
     * ⚠️ Si les dettes incluent l'hypothèque, les avoirs DOIVENT porter la valeur BRUTE. Mettre
     * l'équité d'un côté et l'hypothèque de l'autre la retrancherait DEUX fois — et trois chiffres
     * d'un même écran qui ne se recomposent pas, c'est la classe de défaut que Marc a signalée
     * quatre fois en deux jours.
     * ⚠️ L'identité tient sur les valeurs BRUTES ; les tuiles, elles, ARRONDISSENT chacune à
     * l'affichage, donc la somme lue peut différer d'un dollar. C'est de l'arrondi d'affichage,
     * pas une dérive — et c'est pour ça que la garde vérifie l'identité sur les nombres, pas sur
     * le texte rendu.
     */
    const avoirs = avoirsHorsImmo + realEstateValeur;
    const dettes = dettesHorsImmo + realEstateHypotheque;

    const net = netWorth + realEstateEquity;
    // [REFONTE-NAV-L2a] Variation 30 j — « liquide + placements » PAR CONSTRUCTION : son assiette
    // diffère du patrimoine net, et la ligne le dit (périmètre toujours écrit à côté).
    const ligneVariation = variation && (
        <p className="text-tiny text-ink-400" data-variation-30j="">
            <span>Variation 30 j </span>
            <PrivateAmount className={variation.diff >= 0 ? 'text-success-400' : 'text-danger-400'}>{`${variation.diff > 0 ? '+' : ''}${formatCAD(variation.diff)}`}</PrivateAmount>
            {variation.pct != null && <> (<PrivateAmount>{`${variation.pct > 0 ? '+' : ''}${formatPercent(variation.pct)}`}</PrivateAmount>)</>}
            <span> · {variationScope}</span>
        </p>
    );
    const detailHypotheque = realEstateHypotheque > 0.5 ? (
        <>dont <PrivateAmount>{formatCAD(realEstateHypotheque)}</PrivateAmount> d'hypothèque</>
    ) : undefined;

    if (variante === 'mobile-tete') {
        return (
            <section aria-label="Indicateurs clés" className="gf-quote-strip flex flex-col gap-1 rounded-xl bg-surface border border-bordure px-3 py-2.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-baseline gap-2 min-w-0">
                        <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-ink-400 flex items-center gap-1 shrink-0">
                            Patrimoine net<FxEstimateBadge />
                            <span className="gf-badge-nouvelle" aria-hidden="true">CAD</span>
                        </p>
                        {Number.isFinite(net)
                            ? (
                                <button
                                    type="button"
                                    onClick={() => setActiveTab(Tab.INVESTMENTS)}
                                    onMouseEnter={() => prefetchTab(Tab.INVESTMENTS)}
                                    className="touch-target font-mono text-lg sm:text-[32px] leading-tight font-bold text-ink-50 hover:text-repere transition-colors focus-ring rounded-sm text-left"
                                >
                                    <AnimatedNetWorth value={net} as="span" testId="animated-mobile-net-worth" />
                                </button>
                            )
                            : <div className="text-lg sm:text-[32px] font-bold text-ink-300"><span aria-hidden="true">—</span><span className="sr-only">{NO_DATA_LABEL}</span></div>}
                    </div>
                    {Number.isFinite(monthlySavings) && (
                        <button
                            type="button"
                            onClick={() => setActiveTab(Tab.BUDGET)}
                            onMouseEnter={() => prefetchTab(Tab.BUDGET)}
                            className={`touch-target px-2 py-0.5 rounded-full text-xs font-mono font-semibold whitespace-nowrap focus-ring ${monthlySavings >= 0 ? 'gf-delta-up' : 'gf-delta-down'}`}
                        >
                            <PrivateAmount>{`${monthlySavings > 0 ? '+' : ''}${formatCAD(monthlySavings)}`}</PrivateAmount>/mois
                        </button>
                    )}
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    {hasRealEstate && <p className="text-tiny text-ink-400">équité immo incluse</p>}
                    {ligneVariation}
                </div>
            </section>
        );
    }
    if (variante === 'mobile-pied') {
        const tuileMobile = 'gf-quote-cell min-w-0 rounded-2xl bg-surface border border-bordure p-3.5 flex flex-col gap-1';
        return (
            <>
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveTab(Tab.DEBT)}
                    onMouseEnter={() => prefetchTab(Tab.DEBT)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab(Tab.DEBT); } }}
                    className={`${tuileMobile} ${TUILE_CLIQUABLE}`}
                >
                    <p className="text-meta text-ink-400 flex items-center justify-between">
                        Avoirs / dettes
                        <ArrowUpRight className="w-3.5 h-3.5 text-ink-400" aria-hidden="true" />
                    </p>
                    <p className="font-mono text-[15px] font-bold leading-snug">
                        <PrivateAmount className="text-ink-50">{formatCAD(avoirs)}</PrivateAmount>{' '}
                        <PrivateAmount className="text-danger-400">{`−${formatCAD(dettes)}`}</PrivateAmount>
                    </p>
                    {detailHypotheque && <p className="text-tiny text-ink-400">{detailHypotheque}</p>}
                </div>
                <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveTab(Tab.BUDGET)}
                    onMouseEnter={() => prefetchTab(Tab.BUDGET)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab(Tab.BUDGET); } }}
                    className={`${tuileMobile} ${TUILE_CLIQUABLE}`}
                >
                    <p className="text-meta text-ink-400 flex items-center justify-between">
                        Liquidités
                        <ArrowUpRight className="w-3.5 h-3.5 text-ink-400" aria-hidden="true" />
                    </p>
                    <PrivateAmount as="div" className="font-mono text-[15px] font-bold text-ink-50">{formatCAD(liquidity)}</PrivateAmount>
                </div>
            </>
        );
    }

    return (
        <section aria-label="Indicateurs clés" className="gf-quote-strip grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 gf-spring-grid p-3 rounded-2xl bg-surface/60 border border-bordure">
            <KpiTile
                label="Patrimoine net"
                value={net}
                sublabel={hasRealEstate ? 'équité immo incluse' : undefined}
                // [FX-FALLBACK-SILENCIEUX] : ce chiffre convertit les avoirs étrangers en CAD via
                // le taux du store — le signal doit vivre ICI (surface la plus vue de l'app).
                badge={<FxEstimateBadge />}
                symbole="BILAN:CAD"
                deltaTone={net >= 0 ? 'gf-delta-up' : 'gf-delta-down'}
                cibleOnglet={Tab.INVESTMENTS}
                onClick={() => setActiveTab(Tab.INVESTMENTS)}
            />
            {/* [KPI-AVOIRS-DETTES] Les deux TERMES, à côté du net qu'ils composent (avoirs − dettes
                = patrimoine net, par construction — voir plus haut). */}
            <KpiTile
                label="Total avoirs"
                value={avoirs}
                sublabel={hasRealEstate ? 'valeur brute des biens incluse' : undefined}
                symbole="ACTIF:BRUT"
                deltaTone="gf-delta-neutral"
                cibleOnglet={Tab.INVESTMENTS}
                onClick={() => setActiveTab(Tab.INVESTMENTS)}
            />
            <KpiTile
                label="Dettes"
                value={dettes}
                ton="text-danger-400"
                // ⚠️ Le détail demandé par Marc est PRIVÉ (montant) : seule la VALEUR est masquée,
                // la phrase reste — la COMPOSITION du total se lit sans qu'aucun chiffre ne sorte.
                sublabel={detailHypotheque}
                symbole="PASSIF:TOT"
                deltaTone={dettes > 0 ? 'gf-delta-down' : 'gf-delta-up'}
                cibleOnglet={Tab.DEBT}
                onClick={() => setActiveTab(Tab.DEBT)}
            />
            <KpiTile
                label="Liquidités"
                value={liquidity}
                symbole="CASH:CAD"
                deltaTone="gf-delta-amber"
                cibleOnglet={Tab.BUDGET}
                onClick={() => setActiveTab(Tab.BUDGET)}
            />
            <KpiTile
                label="Épargne / mois"
                value={monthlySavings}
                signed
                ton="text-success-400"
                symbole="FLUX:MENS"
                deltaTone={monthlySavings >= 0 ? 'gf-delta-up' : 'gf-delta-down'}
                cibleOnglet={Tab.BUDGET}
                onClick={() => setActiveTab(Tab.BUDGET)}
            />
            {ligneVariation && <div className="col-span-full -mt-1 pt-1 border-t border-bordure flex items-center justify-between flex-wrap gap-2">{ligneVariation}</div>}
        </section>
    );
};
