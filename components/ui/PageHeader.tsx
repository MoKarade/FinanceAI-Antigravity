import React from 'react';

interface PageHeaderProps {
    title: string;
    /**
     * [A11Y-PRIVACY-CHAINES-RESTANTES] `React.ReactNode`, pas `string` : un sous-titre de page mêle
     * du contexte (« 2 biens détenus ») et parfois un MONTANT. Typé `string`, il forçait l'appelant
     * à composer la phrase entière — donc à noyer le montant dans une chaîne, où plus rien ne peut
     * le masquer. Même correctif que `DualKPIStat.sublabel` au lot 59.
     */
    subtitle?: React.ReactNode;
    icon?: React.ReactNode;
    badge?: React.ReactNode;
    actions?: React.ReactNode;
    /** Sous-onglets de la page, À CÔTÉ du titre (bureau) ou dessous (mobile) — maquettes Profil, Immobilier… */
    nav?: React.ReactNode;
    className?: string;
}

/**
 * En-tête standard de page (haut de chaque onglet).
 * [S5-REFONTE-R2] Maquettes : titre 26 px gras, sous-titre discret, actions à droite, filet sous
 * l'en-tête. Plus d'icône devant le titre (les maquettes n'en ont pas) : `icon` reste accepté pour
 * ne pas casser les appelants, et n'est plus rendu.
 * Mobile (maquettes M-*) : actions à droite du titre tant que ça tient, pas de filet (il sépare
 * l'en-tête du contenu seulement sur bureau, où l'en-tête court sur toute la largeur).
 */
const TICKER_PAR_TITRE: Record<string, { code: string; bourse: string }> = {
    Transactions: { code: 'FLUX:TX', bourse: 'TRÉSORERIE · CAD' },
    Budget: { code: 'BUDG:MENS', bourse: 'FLUX MENSUELS · CAD' },
    Placements: { code: 'PORTF:CAD', bourse: 'TSX / NYSE · CAD' },
    Immobilier: { code: 'IMMO:QC', bourse: 'FONCIER · QUÉBEC' },
    Dettes: { code: 'PASSIF:DET', bourse: 'AMORTISSEMENT · CAD' },
    Impôts: { code: 'FISC:QC', bourse: 'ARC & REVENU QC · CAD' },
    Retraite: { code: 'RETR:VIE', bourse: 'PROJECTION RENTE · CAD' },
    Projets: { code: 'PROJ:VIE', bourse: 'JALONS DE VIE · CAD' },
    Enfants: { code: 'FAM:REEE', bourse: 'SUBVENTIONS & REEE · CAD' },
    Profil: { code: 'DOSSIER:ID', bourse: 'MÉNAGE & REVENUS · CAD' },
    Réglages: { code: 'SYS:CFG', bourse: 'SYNCHRONISATION · CAD' },
    Futur: { code: 'PATR:CAD', bourse: 'TRAJECTOIRE NETTE · CAD' },
};

export const PageHeader: React.FC<PageHeaderProps> = ({
    title, subtitle, badge, actions, nav, className = '',
}) => {
    const ticker = TICKER_PAR_TITRE[title] ?? { code: 'COTE:CAD', bourse: 'DOSSIER PERSONNEL · CAD' };
    return (
        <header className={`gf-page-header flex flex-wrap items-center justify-between gap-2 sm:gap-3 lg:pb-5 lg:border-b border-white/6 ${className}`}>
            <div className="basis-full flex items-center justify-between gap-2 pb-1 border-b border-bordure">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                    <span className="gf-ticker-symbol shrink-0" aria-hidden="true">
                        <span className="w-1.5 h-1.5 rounded-full bg-current gf-pulse-live" />
                        {ticker.code}
                    </span>
                    <span className="font-mono text-[9px] sm:text-[10px] tracking-wider uppercase text-ink-400 truncate">
                        {ticker.bourse}
                    </span>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1.5 font-mono text-[10px] text-ink-400 shrink-0" aria-hidden="true">
                    <span>Cote en direct</span>
                    <span>·</span>
                    <span className="text-ink-300">CAD ($)</span>
                </span>
            </div>
            <div className={`min-w-0 flex-1 ${nav ? 'lg:flex-none' : ''}`}>
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 sm:gap-x-4 sm:gap-y-2.5">
                    <h1 className="text-xl sm:text-[26px] leading-7 sm:leading-8 font-bold tracking-tight text-ink-50">{title}</h1>
                    {badge && <div className="gf-quote-badge text-xs max-w-full">{badge}</div>}
                </div>
                {subtitle && (
                    <p className="text-xs sm:text-[13px] leading-4 sm:leading-5 text-ink-400 mt-0.5 sm:mt-1 max-w-2xl">{subtitle}</p>
                )}
            </div>
            {/* Sous-onglets : à côté du titre (bureau) ; au téléphone, pleine largeur SOUS le titre et
                ses actions (maquettes M-impots, M-enfants, M-profil). */}
            {nav && <div className="order-last lg:order-none basis-full lg:basis-auto min-w-0 lg:ml-3 lg:mr-auto">{nav}</div>}
            {actions && (
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0">
                    {actions}
                </div>
            )}
        </header>
    );
};

