// services/assistant/blocsRiches.ts
//
// Blocs de réponse RICHES que l'assistant peut afficher dans le fil (outil `afficher_bloc`) :
// graphique (ligne / barres / aire / secteurs), liste, tableau, cartes de chiffres.
//
// ⚠️ No-fake-data : une valeur absente ou non finie est `null` — jamais `0`. Le rendu
// (`components/aiChat/BlocRicheVue.tsx`) l'affiche « — ». Le schéma refuse NaN / Infinity
// (`z.number().finite()`), donc une valeur fabriquée par le modèle ne peut pas passer pour un chiffre.
// Les montants sont des NOMBRES (jamais des chaînes déjà formatées) : le formatage passe par
// `formatCAD` / `formatPercent` au rendu, dans `<PrivateAmount>` (mode discret respecté).

import { z } from 'zod';

const valeurNumerique = z.number().finite().nullable();
const unite = z.enum(['cad', 'pourcent', 'nombre', 'texte']);

const blocGraphique = z.object({
    type: z.literal('graphique'),
    titre: z.string().min(1).max(120),
    forme: z.enum(['ligne', 'barres', 'aire', 'secteurs']),
    unite: unite.exclude(['texte']).describe('Unité des valeurs : cad (montant en dollars canadiens), pourcent (déjà ×100) ou nombre.'),
    series: z.array(z.object({
        cle: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/),
        libelle: z.string().min(1).max(60),
    }).strict()).min(1).max(6),
    points: z.array(z.object({
        etiquette: z.string().min(1).max(40).describe('Abscisse (année, mois, catégorie…).'),
        valeurs: z.record(z.string().max(40), valeurNumerique).describe('Valeur de chaque série (clé = `cle` de la série) ; null si inconnue.'),
    }).strict()).min(1).max(120),
}).strict();

const blocListe = z.object({
    type: z.literal('liste'),
    titre: z.string().max(120).optional(),
    ordonnee: z.boolean().optional(),
    elements: z.array(z.string().min(1).max(400)).min(1).max(30),
}).strict();

const cellule = z.union([z.string().max(200), z.number().finite(), z.null()]);

const blocTableau = z.object({
    type: z.literal('tableau'),
    titre: z.string().max(120).optional(),
    colonnes: z.array(z.object({
        cle: z.string().min(1).max(40).regex(/^[a-zA-Z0-9_]+$/),
        libelle: z.string().min(1).max(60),
        unite,
    }).strict()).min(1).max(8),
    lignes: z.array(z.record(z.string().max(40), cellule)).min(1).max(60),
}).strict();

const blocCartes = z.object({
    type: z.literal('cartes_chiffres'),
    titre: z.string().max(120).optional(),
    cartes: z.array(z.object({
        libelle: z.string().min(1).max(60),
        valeur: valeurNumerique,
        unite: unite.exclude(['texte']),
        variationPct: valeurNumerique.optional().describe('Variation en % (déjà ×100), facultative.'),
    }).strict()).min(1).max(8),
}).strict();

/** Un bloc riche validé. */
export const blocRicheSchema = z.discriminatedUnion('type', [blocGraphique, blocListe, blocTableau, blocCartes]);
export type BlocRiche = z.infer<typeof blocRicheSchema>;
export type BlocGraphique = z.infer<typeof blocGraphique>;
export type BlocTableau = z.infer<typeof blocTableau>;
export type BlocCartes = z.infer<typeof blocCartes>;
export type BlocListe = z.infer<typeof blocListe>;

/** Arguments de l'outil `afficher_bloc`. */
export const argsAfficherBloc = z.object({ bloc: blocRicheSchema }).strict();
