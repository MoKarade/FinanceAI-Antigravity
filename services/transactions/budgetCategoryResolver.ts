// services/transactions/budgetCategoryResolver.ts
// Résout une catégorie canonique vers le nom EXACT du poste correspondant dans le budget de
// l'utilisateur (ex. « Épicerie » -> « Épicerie & Alimentation »), sans faux positifs de sous-chaînes.

import type { BudgetCategory } from '../../types';
import { isSavingsNature } from '../../utils/budget';
import { categoryKey } from '../import/categoryRules';

const SYSTEM_CATEGORIES_NO_REMAP = new Set([
    'salaire',
    'revenus divers',
    'remboursement',
    'transfert',
    'virement',
    'virements',
    'impots',
    'investissement',
    'non categorise',
    'uncategorized',
    'autre',
    'inconnu',
    'unknown',
    '',
]);

const BUDGET_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
    epicerie: ['alimentation', 'nourriture', 'supermarche', 'depanneur', 'marche'],
    logement: ['habitation', 'loyer', 'hypotheque', 'hydro', 'electricite', 'maison', 'residence'],
    transport: ['auto', 'voiture', 'essence', 'carburant', 'mobilite', 'deplacement', 'vehicule'],
    restaurants: ['restaurant', 'resto', 'sorties', 'cafes', 'repas'],
    magasinage: ['achats', 'shopping', 'vetements', 'habillement', 'quincaillerie'],
    sante: ['pharmacie', 'bien etre', 'soins', 'medecin', 'gym'],
    abonnements: ['telecom', 'internet', 'cellulaire', 'forfaits', 'telephone', 'medias'],
    loisirs: ['divertissement', 'culture', 'sport', 'jeux', 'sorties'],
    voyages: ['voyage', 'vacances', 'deplacements'],
    assurances: ['assurance'],
    'frais bancaires': ['frais', 'banque'],
};

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizedTextForWords(s: string): string {
    return categoryKey(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsWholePhrase(haystackWords: string, needleWords: string): boolean {
    if (!haystackWords || !needleWords) return false;
    const rx = new RegExp(`(?:^| )${escapeRegExp(needleWords)}(?: |$)`);
    return rx.test(haystackWords);
}

/**
 * Résout une catégorie canonique vers le nom exact du poste de budget correspondant, s'il existe.
 * Les catégories système (Salaire, Remboursement, Transfert, Impôts, Autre, etc.) ne sont jamais remappées.
 */
export function resolveToBudgetCategory(
    canonicalCategory: string,
    budgetItems: readonly BudgetCategory[] = [],
): string {
    const trimmed = (canonicalCategory ?? '').trim();
    if (!trimmed) return trimmed;

    const targetKey = categoryKey(trimmed);
    if (SYSTEM_CATEGORIES_NO_REMAP.has(targetKey)) return trimmed;

    const eligibleItems = budgetItems.filter((item) => {
        const name = (item?.name ?? '').trim();
        return name.length > 0 && !isSavingsNature(item.nature ?? '');
    });
    if (eligibleItems.length === 0) return trimmed;

    // 1. Correspondance exacte (insensible casse/accents)
    const exact = eligibleItems.find((item) => categoryKey(item.name) === targetKey);
    if (exact) return exact.name;

    // 2. Mot ou syntagme entier dans le nom du poste (évite « Sport » ⊂ « Transport »)
    const targetWords = normalizedTextForWords(trimmed);
    const wordHit = eligibleItems.find((item) => {
        const itemWords = normalizedTextForWords(item.name);
        return containsWholePhrase(itemWords, targetWords)
            || (itemWords.length >= 4 && containsWholePhrase(targetWords, itemWords));
    });
    if (wordHit) return wordHit.name;

    // 3. Synonymes maîtrisés QC/FR (mots entiers uniquement)
    const synonyms = BUDGET_SYNONYMS[targetWords] ?? BUDGET_SYNONYMS[targetKey] ?? [];
    if (synonyms.length > 0) {
        const synHit = eligibleItems.find((item) => {
            const itemWords = normalizedTextForWords(item.name);
            return synonyms.some((syn) => containsWholePhrase(itemWords, syn));
        });
        if (synHit) return synHit.name;
    }

    return trimmed;
}
