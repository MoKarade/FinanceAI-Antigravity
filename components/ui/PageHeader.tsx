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
export const PageHeader: React.FC<PageHeaderProps> = ({
    title, subtitle, badge, actions, nav, className = '',
}) => (
    <header className={`gf-page-header flex flex-wrap items-center justify-between gap-2.5 sm:gap-3 ${className}`}>
        <div className={`min-w-[min(220px,100%)] flex-1 ${nav ? 'lg:flex-none' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 sm:gap-x-3 sm:gap-y-2">
                <h1 className="text-xl sm:text-[24px] leading-7 sm:leading-8 font-bold tracking-tight text-ink-50">{title}</h1>
                {badge && <div className="gf-quote-badge text-xs max-w-full">{badge}</div>}
            </div>
            {subtitle && (
                <p className="text-xs sm:text-[13px] leading-4 sm:leading-5 text-ink-400 mt-1 max-w-2xl">{subtitle}</p>
            )}
        </div>
        {/* Sous-onglets : à côté du titre (bureau) ; au téléphone, pleine largeur SOUS le titre et
            ses actions (maquettes M-impots, M-enfants, M-profil). */}
        {nav && <div className="order-last lg:order-none basis-full lg:basis-auto min-w-0 lg:ml-3 lg:mr-auto">{nav}</div>}
        {actions && (
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 max-w-full">
                {actions}
            </div>
        )}
    </header>
);


