import React from 'react';
import { formatCAD, formatVariationPct } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';
import { useFinanceStore } from '../../store/useFinanceStore';

/**
 * Phase D'.5 — tuile fusionnée "Prévu / Réel" pour le Budget.
 *
 * [S5-REFONTE-BUDGET] Tuile des maquettes E/M-budget : libellé + écart en % (réel vs prévu), le RÉEL
 * en grand, une barre (réel / prévu), puis « Prévu » et « Objectif ». L'écart se calcule toujours
 * Réel vs Prévu ; l'objectif reste une TROISIÈME valeur affichée, sans entrer dans le calcul.
 *
 * [BUDGET-REEL-PREVISIONNEL-OBJECTIF] `objectif` optionnel — la cible saisie (somme des cibles de
 * dépense par catégorie pour les tuiles de dépenses, salaire déclaré au profil pour Revenus).
 * Absent → ni libellé ni montant : jamais un « Objectif 0 $ » crédible.
 *
 * Hooks de test : `data-kpi` (la tuile, par libellé), `data-kpi-reel`, `data-kpi-objectif`.
 */

interface DualKPIStatProps {
    label: string;
    prevu: number;
    reel: number;
    /** [BUDGET-REEL-PREVISIONNEL-OBJECTIF] Cible saisie (Objectif) — 3e valeur, optionnelle. */
    objectif?: number;
    /** Ce que « Prévu » veut dire pour cette tuile (infobulle, jamais de montant). */
    titrePrevu?: string;
    /**
     * [A11Y-PRIVACY-SCAN-GLOBAL] Note sous la tuile — `ReactNode` pour que l'appelant masque le
     * montant qu'elle porte (`PrivateAmount`) et garde lisible le texte qui l'entoure.
     */
    note?: React.ReactNode;
    /** Inverse la logique vert/rouge : true pour Dépenses (moins = mieux). */
    invertGoodBad?: boolean;
    /** Couleur de la barre : `ecart` (celle de l'écart, défaut), `succes` (vert), `neutre` (claire). */
    barre?: 'ecart' | 'succes' | 'neutre';
}

export const DualKPIStat: React.FC<DualKPIStatProps> = ({
    label, prevu, reel, objectif, titrePrevu, note, invertGoodBad = false, barre = 'ecart',
}) => {
    const isPrivacyMode = useFinanceStore((s) => s.isPrivacyMode);
    const ecart = reel - prevu;
    // Prévu nul : un écart en % n'a pas de sens → « — » (jamais un « +0,0 % » mesuré en apparence).
    const ecartPct = prevu !== 0 ? (ecart / Math.abs(prevu)) * 100 : null;

    // Dépenses (invertGoodBad) : sous le prévu = vert, jusqu'à +50 % = ambre, au-delà = rouge.
    // Revenus / Restant : au-dessus du prévu = vert, en dessous = rouge.
    const ton = ecartPct === null || ecart === 0 ? 'neutre'
        : invertGoodBad
            ? (ecart <= 0 ? 'succes' : ecartPct <= 50 ? 'alerte' : 'danger')
            : (ecart >= 0 ? 'succes' : 'danger');
    const texte = {
        neutre: 'gf-delta-neutral text-ink-300',
        succes: 'gf-delta-up text-succes-texte',
        alerte: 'gf-delta-amber text-alerte-texte',
        danger: 'gf-delta-down text-erreur-texte',
    }[ton];
    const fond = barre === 'succes' ? 'gf-alloc-reer' : barre === 'neutre' ? 'gf-alloc-celi'
        : { neutre: 'gf-alloc-celi', succes: 'gf-alloc-reer', alerte: 'gf-alloc-immo', danger: 'bg-danger-400' }[ton];
    const remplissage = prevu > 0 ? Math.min(1, Math.max(0, reel / prevu)) : 0;
    // [PRIVACY-RATIOS-DUREES-UNIFORMES] L'écart % et la largeur de la barre sont des ratios réel/prévu : masqués en mode discret.
    const pct = <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold font-mono tabular-nums ${texte}`}><PrivateAmount>{formatVariationPct(ecartPct)}</PrivateAmount></span>;

    return (
        <div data-kpi={label} className="gf-stat-cell gf-quote-cell rounded-2xl bg-surface border border-bordure px-3.5 py-3 lg:px-[18px] lg:py-4 flex flex-col gap-2 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-meta lg:text-[11px] lg:font-semibold lg:tracking-[0.06em] lg:uppercase text-ink-400 truncate">{label}</span>
                <span className="hidden lg:inline text-meta">{pct}</span>
            </div>
            {/* [D6-SR] — montants via PrivateAmount (blur visuel + masquage lecteur d'écran). */}
            <div className="flex items-baseline gap-2 min-w-0">
                <span data-kpi-reel="" className="font-mono text-[18px] lg:text-[26px] leading-tight font-bold text-ink-50 tabular-nums whitespace-nowrap">
                    <PrivateAmount>{formatCAD(reel)}</PrivateAmount>
                </span>
                <span className="lg:hidden text-tiny">{pct}</span>
            </div>
            <span className="block h-1.5 rounded-full bg-surface-douce border border-bordure overflow-hidden gf-bar-grow" aria-hidden="true">
                <span className={`block h-full rounded-full ${fond}`} style={{ width: `${isPrivacyMode ? 0 : remplissage * 100}%` }} />
            </span>
            <div className="flex flex-wrap lg:flex-nowrap items-center lg:justify-between gap-x-1 lg:gap-x-2 pt-1 border-t border-bordure text-[10px] lg:text-meta text-ink-400 font-mono">
                <span title={titrePrevu} data-kpi-prevu="">Prévu <PrivateAmount className="tabular-nums text-ink-200">{formatCAD(prevu)}</PrivateAmount></span>
                {objectif !== undefined && (
                    <>
                        <span className="lg:hidden" aria-hidden="true">·</span>
                        <span>
                            <span className="lg:hidden">Obj.</span><span className="hidden lg:inline">Objectif</span>{' '}
                            <span data-kpi-objectif="" className="tabular-nums text-ink-200"><PrivateAmount>{formatCAD(objectif)}</PrivateAmount></span>
                        </span>
                    </>
                )}
            </div>
            {note && <p className="text-[10px] lg:text-tiny leading-snug text-ink-400">{note}</p>}
        </div>
    );
};
