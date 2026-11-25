// components/ui/commandPaletteActions.tsx
//
// [S5-REFONTE-PERF] Ce qui doit exister DÈS le démarrage pour la palette Ctrl/Cmd + K : le raccourci
// global (`useCommandPalette`), l'ouverture depuis un bouton (`ouvrirPaletteCommandes`) et la liste
// des actions de navigation. Le composant de la palette (`CommandPalette.tsx`) est chargé à la
// demande, à la première ouverture — il n'a rien à faire dans le chemin critique.
import React, { useState, useEffect } from 'react';
import { Tab } from '../../types';
import { Icon } from './Icon';

export interface CommandAction {
    /** Id stable (utile pour key React). */
    id: string;
    /** Label affiché à l'utilisateur. */
    label: string;
    /** Catégorie pour grouper visuellement (ex: "Navigation", "Action"). */
    group: string;
    /** Icône (emoji ou node). */
    icon?: React.ReactNode;
    /** Mots-clés additionnels pour le filtrage (alias). */
    keywords?: string[];
    /** Handler exécuté au Enter ou click. */
    onSelect: () => void;
}


/**
 * Hook global qui écoute Cmd+K / Ctrl+K et toggle un state interne.
 * Retourne { isOpen, close } à brancher dans <CommandPalette>.
 */
export function useCommandPalette() {
    const [isOpen, setIsOpen] = useState(false);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setIsOpen(prev => !prev);
            }
            if (e.key === 'Escape') setIsOpen(false);
        };
        // [S5-REFONTE-FUTUR] Le champ « Rechercher… » de l'en-tête Futur (maquette F-bureau) ouvre la
        // MÊME palette : un évènement DOM plutôt qu'un contexte, la palette vit dans App et l'écran
        // Futur est chargé à part (lazy) — aucun fil à tirer entre les deux.
        const ouvrir = () => setIsOpen(true);
        window.addEventListener('keydown', handler);
        window.addEventListener(EVT_OUVRIR_PALETTE, ouvrir);
        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener(EVT_OUVRIR_PALETTE, ouvrir);
        };
    }, []);
    return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
}

const EVT_OUVRIR_PALETTE = 'financeai:ouvrir-palette';

/** Ouvre la palette de commandes (Ctrl/Cmd + K) depuis n'importe quel écran. */
export function ouvrirPaletteCommandes(): void {
    window.dispatchEvent(new Event(EVT_OUVRIR_PALETTE));
}

/** Helper : génère les actions de navigation pour tous les Tabs. */
export function makeNavigationActions(setActiveTab: (t: Tab) => void): CommandAction[] {
    const sz = 16;
    const navMap: Array<{ tab: Tab; label: string; icon: React.ReactNode; keywords?: string[] }> = [
        { tab: Tab.DASHBOARD, label: 'Accueil', icon: <Icon name="dashboard" size={sz} />, keywords: ['dashboard', 'home', 'accueil', 'google', 'synthese'] },
        { tab: Tab.TRANSACTIONS, label: 'Transactions', icon: <Icon name="transactions" size={sz} />, keywords: ['transac', 'depense', 'achats'] },
        { tab: Tab.BUDGET, label: 'Budget', icon: <Icon name="budget" size={sz} />, keywords: ['budget', 'depenses', 'abonnements', 'charges fixes', 'objectifs', 'planification'] },
        { tab: Tab.DEBT, label: 'Dettes', icon: <Icon name="debt" size={sz} />, keywords: ['debt', 'pret', 'credit'] },
        { tab: Tab.INVESTMENTS, label: 'Placements', icon: <Icon name="investments" size={sz} />, keywords: ['invest', 'investissements', 'bourse', 'actions', 'valoria', 'quant', 'ia', '7 agents', 'd3', 'marche', 'conseiller'] },
        { tab: Tab.FUTURE, label: 'Futur', icon: <Icon name="future" size={sz} />, keywords: ['future', 'projection', 'simulation', 'mc'] },
        { tab: Tab.REAL_ESTATE, label: 'Immobilier', icon: <Icon name="real-estate" size={sz} />, keywords: ['immo', 'maison', 'hypotheque'] },
        // [REFONTE-NAV-L3] Projets d'achat futurs (Vie) — l'actuel reste sous « Immobilier ».
        { tab: Tab.REAL_ESTATE_PROJECTS, label: 'Projets immo', icon: <Icon name="building" size={sz} />, keywords: ['projet immo', 'achat', 'futur', 'maison', 'hypotheque'] },
        { tab: Tab.CHILD, label: 'Enfants', icon: <Icon name="child" size={sz} />, keywords: ['enfant', 'reee', 'famille'] },
        // Phase F.12 — Tab.TRAVEL et Tab.LIFE_EVENTS fusionnés en LIFE_PROJECTS
        { tab: Tab.LIFE_PROJECTS, label: 'Projets de vie', icon: <Icon name="life-projects" size={sz} />, keywords: ['voyage', 'travel', 'mariage', 'event', 'parcours', 'projet'] },
        { tab: Tab.RETIREMENT, label: 'Retraite', icon: <Icon name="retirement" size={sz} />, keywords: ['retraite', 'pension', 'rrq'] },
        { tab: Tab.TAX, label: 'Impôts', icon: <Icon name="tax" size={sz} />, keywords: ['tax', 'impot', 'declaration', 'centre fiscal'] },
        { tab: Tab.SETTINGS, label: 'Réglages', icon: <Icon name="settings" size={sz} />, keywords: ['settings', 'config', 'parametres'] },
        { tab: Tab.PROFILE, label: 'Profil', icon: <Icon name="settings" size={sz} />, keywords: ['profil', 'profile', 'utilisateur', 'user', 'identite', 'salaire', 'retraite', 'sante', 'carriere'] },
    ];
    return navMap.map(({ tab, label, icon, keywords }) => ({
        id: `nav:${tab}`,
        label: `Aller à : ${label}`,
        group: 'Navigation',
        icon,
        keywords,
        onSelect: () => setActiveTab(tab),
    }));
}

/** Actions rapides et liens profonds Valoria pour la palette Ctrl+K (sans alourdir le bundle d'entrée). */
export function makeValoriaCommandActions(
    navigateWithFocus: (tab: Tab, section?: string) => void,
    assets?: ReadonlyArray<{ symbol?: string; name?: string }>,
    watchlist?: ReadonlyArray<string>,
): CommandAction[] {
    const sz = 16;
    const views: Array<{ id: string; section: string; label: string; keywords: string[] }> = [
        { id: 'tab:recommendations', section: 'tab:recommendations', label: 'Valoria : Conseils & Recommandés', keywords: ['valoria', 'conseil', 'recommande', 'acheter', 'alleger'] },
        { id: 'tab:ai_proof', section: 'tab:ai_proof', label: 'Valoria : Preuve IA à l’aveugle', keywords: ['valoria', 'preuve', 'aveugle', 'gemini'] },
        { id: 'tab:intelligence', section: 'tab:intelligence', label: 'Valoria : Comité des 7 Agents & Futur 2031', keywords: ['valoria', 'agents', 'futur', 'inflation', 'causal'] },
        { id: 'lab:backtest', section: 'lab:backtest', label: 'Valoria : Backtest historique ($ CAD)', keywords: ['valoria', 'backtest', 'historique'] },
        { id: 'lab:montecarlo', section: 'lab:montecarlo', label: 'Valoria : Monte Carlo (10 000 scénarios)', keywords: ['valoria', 'monte carlo', 'simulation'] },
        { id: 'lab:quant_models', section: 'lab:quant_models', label: 'Valoria : Modèles Black-Litterman & Fama-French', keywords: ['valoria', 'black-litterman', 'fama', 'quant'] },
    ];

    const out: CommandAction[] = views.map((v) => ({
        id: `valoria:${v.id}`,
        label: v.label,
        group: 'Placements · Quant IA',
        icon: <Icon name="sparkles" size={sz} />,
        keywords: v.keywords,
        onSelect: () => navigateWithFocus(Tab.INVESTMENTS, v.section),
    }));

    const seen = new Set<string>();
    for (const a of assets ?? []) {
        const sym = (a.symbol ?? '').trim().toUpperCase();
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        const nom = (a.name ?? '').trim();
        out.push({
            id: `valoria:asset:${sym}`,
            label: nom ? `Rayon-X Valoria : ${sym} — ${nom}` : `Rayon-X Valoria : ${sym}`,
            group: 'Placements · Quant IA',
            icon: <Icon name="chart" size={sz} />,
            keywords: ['valoria', 'rayon-x', 'titre', sym.toLowerCase(), nom.toLowerCase()].filter(Boolean),
            onSelect: () => navigateWithFocus(Tab.INVESTMENTS, `asset:${sym}`),
        });
        if (seen.size >= 25) break;
    }

    for (const w of watchlist ?? []) {
        const sym = w.trim().toUpperCase();
        if (!sym || seen.has(sym) || seen.size >= 25) continue;
        seen.add(sym);
        out.push({
            id: `valoria:watch:${sym}`,
            label: `Rayon-X Valoria (Suivi) : ${sym}`,
            group: 'Placements · Quant IA',
            icon: <Icon name="chart" size={sz} />,
            keywords: ['valoria', 'watchlist', 'suivi', 'rayon-x', sym.toLowerCase()],
            onSelect: () => navigateWithFocus(Tab.INVESTMENTS, `asset:${sym}`),
        });
    }

    return out;
}

