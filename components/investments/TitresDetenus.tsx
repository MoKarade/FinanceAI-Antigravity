// components/investments/TitresDetenus.tsx
//
// [S5-REFONTE-PLACEMENTS] Les titres détenus (maquettes E/M-placements) : tableau Titre · Compte ·
// Propriétaire · Valeur · Poids au bureau, liste compacte sur mobile. Valeurs en CAD (prix natif × FX),
// triées de la plus grosse à la plus petite ; le propriétaire n'apparaît qu'en mode couple.
import React from 'react';
import { formatCAD, formatNumber, formatSigned } from '../../utils/format';
import { PrivateAmount } from '../ui/PrivateAmount';

export interface LigneTitre {
    cle: string;
    symbole: string;
    nom?: string;
    compte: string;
    proprietaire?: string;
    quantite?: number;
    devise?: string;
    prixAchat?: number;
    coursActuel?: number;
    gainCad?: number;
    gainPct?: number | null;
    valeur: number;
    /** Part du portefeuille (%). */
    poids: number;
}

/** Libellé et couleur des comptes (couleurs des séries du graphe). */
const COMPTES: Record<string, { libelle: string; couleur: string }> = {
    CELI: { libelle: 'CELI', couleur: '#34b39a' },
    CELIAPP: { libelle: 'CELIAPP', couleur: '#7dd3c0' },
    REER: { libelle: 'REER', couleur: '#7c93f2' },
    'NON-ENREG': { libelle: 'Non-enregistré', couleur: '#d4a24c' },
    CRYPTO: { libelle: 'Crypto', couleur: '#a78bfa' },
    REEE: { libelle: 'REEE', couleur: '#56b6d6' },
    MARGE: { libelle: 'Marge', couleur: '#e0703a' },
    AUTRE: { libelle: 'Autre', couleur: '#8896a8' },
};
const compteDe = (type?: string) => COMPTES[type || 'NON-ENREG'] ?? COMPTES.AUTRE;

const poidsTexte = (p: number) => `${formatNumber(p, { decimals: 1 })} %`;
const qteTexte = (q: number) => `${formatNumber(q, { decimals: Number.isInteger(q) ? 0 : 2 })} act.`;

export const TitresDetenus: React.FC<{ lignes: LigneTitre[]; couple: boolean; etroit: boolean }> = ({ lignes, couple, etroit }) => {
    const hasHoldingDetails = lignes.some((l) => typeof l.quantite === 'number' && l.quantite > 0);
    if (etroit) {
        return (
            <section aria-labelledby="titres-titre" className="rounded-2xl bg-surface border border-white/6 px-4 pt-4 pb-1 min-w-0">
                <h2 id="titres-titre" className="text-[11px] font-semibold tracking-[0.08em] uppercase text-ink-400 pb-2">Titres détenus</h2>
                <ul>
                    {lignes.map((l) => {
                        const c = compteDe(l.compte);
                        const posGain = (l.gainPct ?? 0) >= 0;
                        return (
                            <li key={l.cle} className="flex items-center gap-3 py-3 border-t border-white/5">
                                <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: c.couleur }} aria-hidden="true" />
                                <span className="flex-1 min-w-0 flex flex-col gap-0.5">
                                    <span className="flex items-center gap-2 min-w-0">
                                        <span className="font-mono font-bold text-ink-50 truncate">{l.symbole}</span>
                                        {typeof l.quantite === 'number' && l.quantite > 0 && (
                                            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-sm bg-surfaceHighlight text-ink-200 shrink-0">
                                                <PrivateAmount>{qteTexte(l.quantite)}</PrivateAmount>
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-meta text-ink-400 truncate">
                                        {l.prixAchat && l.coursActuel ? (
                                            <PrivateAmount>
                                                {`Acheté ${formatNumber(l.prixAchat, { decimals: 2 })} → ${formatNumber(l.coursActuel, { decimals: 2 })} ${l.devise || ''}`}
                                            </PrivateAmount>
                                        ) : (
                                            `${c.libelle}${couple && l.proprietaire ? ` · ${l.proprietaire}` : ''}`
                                        )}
                                    </span>
                                </span>
                                <span className="flex flex-col items-end shrink-0 gap-0.5">
                                    <PrivateAmount className="font-mono font-bold text-ink-50">{formatCAD(l.valeur)}</PrivateAmount>
                                    <span className="flex items-center gap-1.5 font-mono text-meta">
                                        {l.gainPct != null && Number.isFinite(l.gainPct) && (
                                            <span className={posGain ? 'text-succes-texte font-semibold' : 'text-erreur-texte font-semibold'}>
                                                <PrivateAmount>{`${posGain ? '+' : ''}${l.gainPct.toFixed(2)} %`}</PrivateAmount>
                                            </span>
                                        )}
                                        <span className="text-ink-400"><PrivateAmount>{poidsTexte(l.poids)}</PrivateAmount></span>
                                    </span>
                                </span>
                            </li>
                        );
                    })}
                </ul>
            </section>
        );
    }
    return (
        <section aria-label="Titres détenus" className="rounded-2xl bg-surface border border-white/6 overflow-hidden min-w-0">
            <table className="w-full text-body">
                <caption className="sr-only">Titres détenus : compte, {couple ? 'propriétaire, ' : ''}valeur et poids dans le portefeuille</caption>
                <thead>
                    <tr className="text-left text-[11px] font-semibold tracking-[0.06em] uppercase text-ink-400">
                        <th scope="col" className="px-5 h-12 font-semibold">Titre</th>
                        {hasHoldingDetails && <th scope="col" className="px-3 font-semibold text-right">Détenu</th>}
                        {hasHoldingDetails && <th scope="col" className="px-3 font-semibold text-right">Acheté → Cours</th>}
                        {hasHoldingDetails && <th scope="col" className="px-3 font-semibold text-right">Gain / Perte</th>}
                        <th scope="col" className="px-3 font-semibold">Compte</th>
                        {couple && <th scope="col" className="px-3 font-semibold">Propriétaire</th>}
                        <th scope="col" className="px-3 font-semibold text-right">Valeur</th>
                        <th scope="col" className="px-5 font-semibold text-right">Poids</th>
                    </tr>
                </thead>
                <tbody>
                    {lignes.map((l) => {
                        const c = compteDe(l.compte);
                        const posGain = (l.gainPct ?? 0) >= 0;
                        return (
                            <tr key={l.cle} className="border-t border-white/5">
                                <th scope="row" className="px-5 h-[52px] text-left font-mono font-bold text-ink-50">
                                    <div className="flex flex-col">
                                        <span>{l.symbole}</span>
                                        {l.nom && <span className="font-sans font-normal text-[11px] text-ink-400 truncate max-w-[180px]">{l.nom}</span>}
                                    </div>
                                </th>
                                {hasHoldingDetails && (
                                    <td className="px-3 text-right font-mono text-ink-100">
                                        {typeof l.quantite === 'number' && l.quantite > 0 ? (
                                            <PrivateAmount>{qteTexte(l.quantite)}</PrivateAmount>
                                        ) : '—'}
                                    </td>
                                )}
                                {hasHoldingDetails && (
                                    <td className="px-3 text-right font-mono text-meta text-ink-300">
                                        {l.prixAchat && l.coursActuel ? (
                                            <PrivateAmount>
                                                {`${formatNumber(l.prixAchat, { decimals: 2 })} → ${formatNumber(l.coursActuel, { decimals: 2 })} ${l.devise || ''}`}
                                            </PrivateAmount>
                                        ) : '—'}
                                    </td>
                                )}
                                {hasHoldingDetails && (
                                    <td className="px-3 text-right font-mono text-meta">
                                        {l.gainPct != null && Number.isFinite(l.gainPct) ? (
                                            <div className="flex flex-col items-end">
                                                <span className={posGain ? 'text-succes-texte font-semibold' : 'text-erreur-texte font-semibold'}>
                                                    <PrivateAmount>{`${posGain ? '+' : ''}${l.gainPct.toFixed(2)} %`}</PrivateAmount>
                                                </span>
                                                {typeof l.gainCad === 'number' && Number.isFinite(l.gainCad) && (
                                                    <span className="text-[11px] text-ink-400">
                                                        <PrivateAmount>{formatSigned(l.gainCad, { withCurrency: true })}</PrivateAmount>
                                                    </span>
                                                )}
                                            </div>
                                        ) : '—'}
                                    </td>
                                )}
                                <td className="px-3">
                                    <span className="inline-flex items-center gap-1.5 h-6 px-2 rounded-full bg-surfaceHighlight text-meta text-ink-200">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.couleur }} aria-hidden="true" />{c.libelle}
                                    </span>
                                </td>
                                {couple && <td className="px-3 text-ink-300">{l.proprietaire}</td>}
                                <td className="px-3 text-right"><PrivateAmount className="font-mono text-ink-50">{formatCAD(l.valeur)}</PrivateAmount></td>
                                <td className="px-5 text-right font-mono text-ink-300"><PrivateAmount>{poidsTexte(l.poids)}</PrivateAmount></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </section>
    );
};
