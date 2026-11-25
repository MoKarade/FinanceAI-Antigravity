// services/assistant/actionRegistry.ts
//
// Registre UNIQUE des actions de l'assistant Gemini : { nom, description, schéma Zod, type
// ('lecture' | 'ecriture'), tranches, exécuter(état, args) }. Il agrège :
//   1. les specs PARTAGÉES avec le serveur MCP (`services/aiTools/registry.ts` → `mcp/tools/*.spec.ts`,
//      importées, jamais modifiées) — mêmes réponses que le serveur MCP ;
//   2. des actions GÉNÉRIQUES générées depuis `tranches.ts` : pour chaque tranche persistée du store,
//      lister / ajouter / modifier / supprimer (collections) ou consulter / modifier (objets) ;
//   3. les actions d'application : naviguer_vers_onglet, lancer_projection, afficher_bloc,
//      consulter_taux_change.
//
// Écritures : appliquées DIRECTEMENT (décision Marc), chacune journalisée avec instantané avant/après
// (`journalModifications.ts`) → bouton « Annuler » dans le fil. Avant toute écriture, l'état candidat
// est revérifié (`validateAppStateShape` + `verifierTypesRestaures`) : une écriture qui rendrait le
// blob persistant illisible au prochain lancement est REFUSÉE, jamais appliquée.
// ⚠️ `apiKeys` n'est jamais lu (snapshot sans clés) ni écrit (retiré de tout patch).

import { z } from 'zod';
import type { AppState } from '../../types';
import { Tab } from '../../types';
import { READ_SPECS, WRITE_SPECS } from '../aiTools/registry';
import { snapshotAppState, facadeStoreAssistant } from '../aiTools/appStateProvider';
import type { AnyReadToolSpec, AnyWriteToolSpec } from '../aiTools/specs/_toolSpec';
import type { ToolTextResult } from '../aiTools/specs/_dataAware';
import { scrubMcpDeep } from '../aiTools/specs/_dataAware';
import { applyDocument } from '../ingest/applyDocument';
import { scrubWriteResultForModel } from '../aiTools/specs/scrubWriteResult';
import { validateAppStateShape } from '../aiTools/appStateSchema';
import { verifierTypesRestaures, resumeTechniqueDesFautifs } from '../verifierTypesRestaures';
import { PROMPT_DATA_ISOLATION_NOTE } from '../../utils/promptSafety';
import { TRANCHES, jsonSur, type TrancheCollection, type TrancheListeTexte, type TrancheObjet } from './tranches';
import { argsAfficherBloc, type BlocRiche } from './blocsRiches';
import { journaliserEcriture, type EntreeJournal } from './journalModifications';

type TypeAction = 'lecture' | 'ecriture';

/** Ce que l'exécution d'une action rend à la boucle agentique. */
interface ResultatAction {
    /** Charge utile renvoyée au modèle (sérialisable JSON). */
    pourModele: unknown;
    /** Résumé lisible (écritures : libellé de la pastille « Modifié : … »). */
    resume?: string;
    /** Bloc riche à afficher dans le fil (`afficher_bloc`). */
    bloc?: BlocRiche;
    /** Onglet ouvert par `naviguer_vers_onglet`. */
    navigation?: Tab;
}

export interface ContexteExecution {
    signal?: AbortSignal;
}

export interface ActionAssistant {
    nom: string;
    description: string;
    schema: z.ZodType;
    type: TypeAction;
    /** Tranches du store LUES (lecture) ou ÉCRITES (écriture) — lues par la garde de couverture. */
    tranches: string[];
    executer: (etat: AppState, args: never, ctx: ContexteExecution) => Promise<ResultatAction>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const enveloppeDonnees = (donnees: unknown): Record<string, unknown> => ({
    securite: PROMPT_DATA_ISOLATION_NOTE,
    donnees: scrubMcpDeep(donnees),
});

/** Lecture brute (non normalisée) d'une tranche du store vivant — copie profonde. */
function lireTranche(cle: keyof AppState): unknown {
    return facadeStoreAssistant.lire(cle);
}

/**
 * Applique un patch de tranches au store après vérification de l'état CANDIDAT complet.
 * Lève une erreur claire (renvoyée au modèle) si la forme ou les types deviennent invalides.
 */
function appliquerPatch(patch: Partial<AppState>): void {
    const sur = { ...patch } as Record<string, unknown>;
    delete sur.apiKeys;
    const candidat: Record<string, unknown> = { ...facadeStoreAssistant.persistables(), ...sur };
    validateAppStateShape(candidat);
    const fautifs = verifierTypesRestaures(candidat);
    if (fautifs.length > 0) {
        throw new Error(`Écriture refusée : l'état deviendrait illisible au prochain lancement — ${resumeTechniqueDesFautifs(fautifs)}`);
    }
    facadeStoreAssistant.ecrire(sur as Partial<AppState>);
}

const estObjet = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Fusion profonde « patch » : objets fusionnés récursivement, `null` efface la clé, tableaux d'objets
 * fusionnés PAR INDEX (pour `config.users` : `[{}, {…}]` ne touche que la 2e personne), autres
 * tableaux remplacés.
 */
function fusionProfonde(base: unknown, patch: unknown): unknown {
    if (Array.isArray(patch)) {
        if (Array.isArray(base) && patch.every(estObjet)) {
            const out = [...base];
            patch.forEach((p, i) => { out[i] = fusionProfonde(base[i], p); });
            return out;
        }
        return structuredClone(patch);
    }
    if (estObjet(patch)) {
        const out: Record<string, unknown> = estObjet(base) ? { ...base } : {};
        for (const [k, v] of Object.entries(patch)) {
            if (v === null) delete out[k];
            else out[k] = fusionProfonde(out[k], v);
        }
        return out;
    }
    return patch;
}

const libelleId = z.union([z.string().min(1).max(120), z.number().int()]);

function nouvelIdentifiant(liste: Array<Record<string, unknown>>, type: 'string' | 'number'): string | number {
    if (type === 'number') {
        const max = liste.reduce((m, el) => (typeof el.id === 'number' && Number.isFinite(el.id) && el.id > m ? el.id : m), 0);
        return Math.max(max + 1, Date.now());
    }
    const alea = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`;
    return `ia-${alea}`;
}

function trouverIndex(
    liste: Array<Record<string, unknown>>,
    tranche: TrancheCollection,
    args: { id?: string | number; index?: number },
): number {
    if (tranche.identifiant && args.id !== undefined) {
        const i = liste.findIndex((el) => String(el.id) === String(args.id));
        if (i < 0) throw new Error(`Aucun élément « ${tranche.singulier} » avec l'id ${String(args.id)}.`);
        return i;
    }
    if (args.index !== undefined) {
        if (args.index < 0 || args.index >= liste.length) throw new Error(`Index ${args.index} hors limites (0 à ${liste.length - 1}).`);
        return args.index;
    }
    throw new Error(tranche.identifiant ? 'Précise `id` (ou `index` donné par lister).' : 'Précise `index` (donné par lister).');
}

const sansId = (champs: Record<string, unknown>): Record<string, unknown> => {
    const { id: _id, ...reste } = champs;
    void _id;
    return reste;
};

// ── Actions génériques ─────────────────────────────────────────────────────

function actionsCollection(t: TrancheCollection): ActionAssistant[] {
    const cle = String(t.cle);
    const complet = z.object(Object.fromEntries(
        Object.entries(t.champs).map(([k, s]) => [k, t.requis.includes(k) ? s : s.optional()]),
    )).catchall(jsonSur);
    const partiel = z.object(Object.fromEntries(
        Object.entries(t.champs).map(([k, s]) => [k, s.nullable().optional()]),
    )).catchall(jsonSur);
    const cible = z.object({
        ...(t.identifiant ? { id: libelleId.optional().describe('Identifiant (`id`) de l\'élément.') } : {}),
        index: z.number().int().min(0).optional().describe('Position donnée par `_index` dans lister.'),
    });

    const liste = (): Array<Record<string, unknown>> => {
        const v = lireTranche(t.cle);
        return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
    };

    return [
        {
            nom: `lister_${t.pluriel}`,
            description: `Liste : ${t.description} Pagination (debut, limite ≤ 100) et recherche texte.`,
            type: 'lecture',
            tranches: [cle],
            schema: z.object({
                debut: z.number().int().min(0).optional(),
                limite: z.number().int().min(1).max(100).optional(),
                recherche: z.string().max(80).optional(),
            }).strict(),
            executer: async (_etat, args: { debut?: number; limite?: number; recherche?: string }) => {
                const tous = liste().map((el, i) => ({ _index: i, ...el }));
                const q = args.recherche?.trim().toLowerCase();
                let filtres = q ? tous.filter((el) => JSON.stringify(el).toLowerCase().includes(q)) : tous;
                if (filtres.some((el) => typeof (el as Record<string, unknown>).date === 'string')) {
                    filtres = [...filtres].sort((a, b) =>
                        String((b as Record<string, unknown>).date ?? '').localeCompare(String((a as Record<string, unknown>).date ?? '')));
                }
                const debut = args.debut ?? 0;
                const limite = args.limite ?? 50;
                return {
                    pourModele: enveloppeDonnees({ total: filtres.length, debut, elements: filtres.slice(debut, debut + limite) }),
                };
            },
        },
        {
            nom: `ajouter_${t.singulier}`,
            description: `Ajoute : ${t.description} Champs requis : ${t.requis.join(', ') || 'aucun'}. L'id est généré.`,
            type: 'ecriture',
            tranches: [cle],
            schema: z.object({ element: complet.refine((e) => !('id' in e), 'ne fournis pas `id` (généré)') }).strict(),
            executer: async (_etat, args: { element: Record<string, unknown> }) => {
                const actuelle = liste();
                const element = t.identifiant
                    ? { id: nouvelIdentifiant(actuelle, t.typeId ?? 'string'), ...args.element }
                    : { ...args.element };
                appliquerPatch({ [cle]: [...actuelle, element] } as Partial<AppState>);
                return {
                    pourModele: { applique: true, element: scrubMcpDeep(element) },
                    resume: `${t.singulier.replace(/_/g, ' ')} ajouté(e)`,
                };
            },
        },
        {
            nom: `modifier_${t.singulier}`,
            description: `Modifie un élément (${t.description}) : seuls les champs fournis changent ; null efface un champ facultatif.`,
            type: 'ecriture',
            tranches: [cle],
            schema: cible.extend({ champs: partiel }).strict(),
            executer: async (_etat, args: { id?: string | number; index?: number; champs: Record<string, unknown> }) => {
                const actuelle = liste();
                const i = trouverIndex(actuelle, t, args);
                const fusion = fusionProfonde(actuelle[i], sansId(args.champs)) as Record<string, unknown>;
                if (t.identifiant) fusion.id = actuelle[i].id;
                const verif = complet.safeParse(sansId(fusion));
                if (!verif.success) throw new Error(`Élément invalide après modification : ${verif.error.issues[0]?.path.join('.')} — ${verif.error.issues[0]?.message}`);
                const prochaine = [...actuelle];
                prochaine[i] = fusion;
                appliquerPatch({ [cle]: prochaine } as Partial<AppState>);
                return {
                    pourModele: { applique: true, element: scrubMcpDeep(fusion) },
                    resume: `${t.singulier.replace(/_/g, ' ')} modifié(e)`,
                };
            },
        },
        {
            nom: `supprimer_${t.singulier}`,
            description: `Supprime un élément (${t.description}).`,
            type: 'ecriture',
            tranches: [cle],
            schema: cible.strict(),
            executer: async (_etat, args: { id?: string | number; index?: number }) => {
                const actuelle = liste();
                const i = trouverIndex(actuelle, t, args);
                const retire = actuelle[i];
                appliquerPatch({ [cle]: actuelle.filter((_, j) => j !== i) } as Partial<AppState>);
                return {
                    pourModele: { applique: true, retire: scrubMcpDeep(retire) },
                    resume: `${t.singulier.replace(/_/g, ' ')} supprimé(e)`,
                };
            },
        },
    ];
}

function actionsListeTexte(t: TrancheListeTexte): ActionAssistant[] {
    const cle = String(t.cle);
    const liste = (): string[] => {
        const v = lireTranche(t.cle);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    };
    const valeur = z.string().min(1).max(200);
    return [
        {
            nom: `lister_${t.pluriel}`, description: `Liste : ${t.description}`, type: 'lecture', tranches: [cle],
            schema: z.object({}).strict(),
            executer: async () => ({ pourModele: enveloppeDonnees({ elements: liste() }) }),
        },
        {
            nom: `ajouter_${t.singulier}`, description: `Ajoute : ${t.description}`, type: 'ecriture', tranches: [cle],
            schema: z.object({ valeur }).strict(),
            executer: async (_e, args: { valeur: string }) => {
                const l = liste();
                if (!l.includes(args.valeur)) appliquerPatch({ [cle]: [...l, args.valeur] } as Partial<AppState>);
                return { pourModele: { applique: true }, resume: `${t.singulier.replace(/_/g, ' ')} ajouté` };
            },
        },
        {
            nom: `modifier_${t.singulier}`, description: `Renomme une valeur : ${t.description}`, type: 'ecriture', tranches: [cle],
            schema: z.object({ ancienne: valeur, nouvelle: valeur }).strict(),
            executer: async (_e, args: { ancienne: string; nouvelle: string }) => {
                const l = liste();
                if (!l.includes(args.ancienne)) throw new Error(`Valeur introuvable : ${args.ancienne}`);
                appliquerPatch({ [cle]: l.map((x) => (x === args.ancienne ? args.nouvelle : x)) } as Partial<AppState>);
                return { pourModele: { applique: true }, resume: `${t.singulier.replace(/_/g, ' ')} modifié` };
            },
        },
        {
            nom: `supprimer_${t.singulier}`, description: `Retire une valeur : ${t.description}`, type: 'ecriture', tranches: [cle],
            schema: z.object({ valeur }).strict(),
            executer: async (_e, args: { valeur: string }) => {
                const l = liste();
                if (!l.includes(args.valeur)) throw new Error(`Valeur introuvable : ${args.valeur}`);
                appliquerPatch({ [cle]: l.filter((x) => x !== args.valeur) } as Partial<AppState>);
                return { pourModele: { applique: true }, resume: `${t.singulier.replace(/_/g, ' ')} retiré` };
            },
        },
    ];
}

function actionsObjet(t: TrancheObjet): ActionAssistant[] {
    const cle = String(t.cle);
    const partiel = z.object(Object.fromEntries(
        Object.entries(t.champs).map(([k, s]) => [k, s.nullable().optional()]),
    )).catchall(jsonSur);
    const actions: ActionAssistant[] = [
        {
            nom: `consulter_${t.nom}`, description: `Consulte : ${t.description}`, type: 'lecture', tranches: [cle],
            schema: z.object({}).strict(),
            executer: async () => ({ pourModele: enveloppeDonnees({ valeur: lireTranche(t.cle) ?? null }) }),
        },
        {
            nom: `modifier_${t.nom}`,
            description: `Modifie : ${t.description} Fusion profonde : seuls les champs fournis changent ; null efface.`,
            type: 'ecriture', tranches: [cle],
            schema: z.object({ champs: partiel }).strict(),
            executer: async (_e, args: { champs: Record<string, unknown> }) => {
                const suivant = fusionProfonde(lireTranche(t.cle), args.champs);
                appliquerPatch({ [cle]: suivant } as Partial<AppState>);
                return { pourModele: { applique: true, valeur: scrubMcpDeep(suivant) }, resume: `${t.nom.replace(/_/g, ' ')} modifié` };
            },
        },
    ];
    if (t.supprimable) {
        actions.push({
            nom: `supprimer_${t.nom}`, description: `Retire : ${t.description}`, type: 'ecriture', tranches: [cle],
            schema: z.object({}).strict(),
            executer: async () => {
                appliquerPatch({ [cle]: undefined } as Partial<AppState>);
                return { pourModele: { applique: true }, resume: `${t.nom.replace(/_/g, ' ')} retiré` };
            },
        });
    }
    return actions;
}

// ── Specs partagées (MCP) ──────────────────────────────────────────────────

function lireResultatOutil(r: ToolTextResult): unknown {
    const texte = r.content.map((c) => c.text).join('\n');
    let charge: unknown = texte;
    try { charge = JSON.parse(texte); } catch { /* texte brut : renvoyé tel quel */ }
    return r.isError ? { erreur: charge } : charge;
}

function actionDepuisSpecLecture(spec: AnyReadToolSpec): ActionAssistant {
    return {
        nom: spec.name,
        description: spec.description,
        type: 'lecture',
        tranches: [],
        schema: z.object(spec.inputSchema).strict(),
        executer: async (_etat, args: Record<string, unknown>) => ({
            pourModele: lireResultatOutil(await spec.handler(args, async () => snapshotAppState())),
        }),
    };
}

function actionDepuisSpecEcriture(spec: AnyWriteToolSpec): ActionAssistant {
    return {
        nom: spec.name,
        // Les écritures s'appliquent directement ici (annulables depuis le fil) : la mention de
        // confirmation en deux temps de certaines specs ne s'applique pas à cette surface.
        description: `${spec.description} (Dans cette app : appliqué directement, annulable par l'utilisateur.)`,
        type: 'ecriture',
        tranches: [],
        schema: z.object(spec.inputSchema).strict(),
        executer: async (_etat, args: Record<string, unknown>) => {
            const avant = snapshotAppState();
            const res = applyDocument(avant, spec.toDocument(args));
            if (res.changes.length === 0) {
                return { pourModele: { applique: false, resume: scrubWriteResultForModel(res.summary, []).summary } };
            }
            // Seules les tranches réellement changées sont écrites (jamais le reste de l'état normalisé).
            const patch: Record<string, unknown> = {};
            for (const k of Object.keys(res.nextState) as Array<keyof AppState>) {
                if (k === 'apiKeys') continue;
                if (JSON.stringify(res.nextState[k]) !== JSON.stringify(avant[k])) patch[k] = res.nextState[k];
            }
            appliquerPatch(patch as Partial<AppState>);
            const sur = scrubWriteResultForModel(res.summary, res.changes);
            return { pourModele: { applique: true, resume: sur.summary, changements: sur.changes }, resume: sur.summary };
        },
    };
}

// ── Actions d'application ─────────────────────────────────────────────────

const ONGLETS = Object.values(Tab) as [Tab, ...Tab[]];

const pause = (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }, { once: true });
});

const fini = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const actionsApplication: ActionAssistant[] = [
    {
        nom: 'naviguer_vers_onglet',
        description: 'Ouvre un onglet de l\'application (ex. BUDGET, DEBT, FUTURE, INVESTMENTS, TAX, RETIREMENT).',
        type: 'lecture', tranches: [],
        schema: z.object({ onglet: z.enum(ONGLETS) }).strict(),
        executer: async (_e, args: { onglet: Tab }) => {
            facadeStoreAssistant.ouvrirOnglet(args.onglet);
            return { pourModele: { ouvert: args.onglet }, navigation: args.onglet };
        },
    },
    {
        nom: 'lancer_projection',
        description: 'Relance la projection de l\'application (moteur officiel) et rend un résumé annuel du patrimoine net projeté. monteCarlo active la simulation stochastique.',
        type: 'lecture', tranches: [],
        schema: z.object({ monteCarlo: z.boolean().optional() }).strict(),
        executer: async (_e, args: { monteCarlo?: boolean }, ctx) => {
            if (args.monteCarlo !== undefined) facadeStoreAssistant.activerMonteCarlo(args.monteCarlo);
            // Le moteur (ProjectionEngine) recalcule de lui-même après tout changement (anti-rebond
            // 60-180 ms) : on lui laisse le temps de démarrer, puis on attend la fin du calcul.
            await pause(400, ctx.signal);
            const limite = Date.now() + 20_000;
            while (facadeStoreAssistant.etatProjection().statut === 'computing' && Date.now() < limite) {
                await pause(200, ctx.signal);
            }
            const s = facadeStoreAssistant.etatProjection();
            const chart = s.chartData;
            if (!chart || chart.length === 0) {
                return { pourModele: { disponible: false, motif: s.refus ?? 'Projection indisponible (configuration incomplète ou calcul en cours).' } };
            }
            const parAnnee = new Map<number, Record<string, unknown>>();
            for (const p of chart as unknown as Array<Record<string, unknown>>) {
                const annee = fini(p.year);
                if (annee !== null) parAnnee.set(annee, p);
            }
            const points = [...parAnnee.values()].slice(0, 60).map((p) => ({
                annee: fini(p.year), age: fini(p.age), patrimoineNet: fini(p.NetWorth ?? p.Total),
            }));
            return { pourModele: { disponible: true, statut: s.statut, points } };
        },
    },
    {
        nom: 'afficher_bloc',
        description: 'Affiche un bloc riche dans la conversation : graphique (ligne/barres/aire/secteurs), liste, tableau ou cartes_chiffres. Valeurs numériques brutes (jamais formatées) ; null si inconnue — jamais 0 inventé.',
        type: 'lecture', tranches: [],
        schema: argsAfficherBloc,
        executer: async (_e, args: z.infer<typeof argsAfficherBloc>) => ({ pourModele: { affiche: true }, bloc: args.bloc }),
    },
    {
        nom: 'consulter_taux_change',
        description: 'Consulte les taux de change en vigueur (USD, EUR → CAD) et leur provenance.',
        type: 'lecture', tranches: ['fxRates'],
        schema: z.object({}).strict(),
        executer: async () => ({ pourModele: facadeStoreAssistant.tauxChange() }),
    },
    {
        nom: 'consulter_diagnostic_valoria',
        description: 'Consulte le diagnostic quantitatif Valoria (Comité des 7 Agents, signaux Renforcer/Conserver/Alléger par titre, efficacité fiscale QC/CA CELI/REER/Non-enregistré et comparaison projection Futur 5 ans). Optionnellement filtré sur un symbole boursier.',
        type: 'lecture', tranches: [],
        schema: z.object({ symbole: z.string().min(1).max(24).optional() }).strict(),
        executer: async (etat, args: { symbole?: string }) => {
            const { buildValoriaAssistantDiagnostic } = await import('../valoria/valoriaIntegration');
            const proj = facadeStoreAssistant.etatProjection();
            const lastProj = proj.chartData ? ({ chartData: proj.chartData } as never) : null;
            const valoriaWatchlist = facadeStoreAssistant.lire('valoriaWatchlist') as AppState['valoriaWatchlist'] | undefined;
            const valoriaRiskProfile = facadeStoreAssistant.lire('valoriaRiskProfile') as AppState['valoriaRiskProfile'] | undefined;
            const etatAvecValoria: AppState = {
                ...etat,
                ...(Array.isArray(valoriaWatchlist) ? { valoriaWatchlist } : {}),
                ...(valoriaRiskProfile ? { valoriaRiskProfile } : {}),
            };
            return { pourModele: enveloppeDonnees(buildValoriaAssistantDiagnostic(etatAvecValoria, new Date().getFullYear(), args.symbole, lastProj)) };
        },
    },
    {
        nom: 'analyser_opportunite_placement',
        description: 'Exécute le Comité Multi-Agents réel (4 analystes indépendants + synthèse présidentielle avec recherche Web Google Search) pour évaluer un achat/vente de titre coté (action, FNB, crypto) OU d’entreprise privée non cotée (ex. Anthropic, OpenAI, SpaceX) avec impact portefeuille et fiscalité Québec/Canada.',
        type: 'lecture',
        tranches: [],
        schema: z.object({
            question: z.string().min(3).max(400),
            montantCibleCad: z.number().positive().finite().optional(),
        }).strict(),
        executer: async (etat, args: { question: string; montantCibleCad?: number }, ctx) => {
            const report = await facadeStoreAssistant.lancerComitePlacement(
                etat,
                args.question,
                args.montantCibleCad,
                ctx.signal,
            );
            const { buildCommitteeTableauBloc } = await import('../investments/multiAgentCommittee');
            try {
                const { saveCommitteeAnalysis } = await import('../investments/committeeHistoryStore');
                await saveCommitteeAnalysis({ isTestMode: false, personaId: null }, report);
            } catch {
                // Sauvegarde historique best-effort : ne bloque jamais la réponse assistant.
            }
            return {
                pourModele: enveloppeDonnees({
                    sujet: report.subject,
                    statutEntite: report.entityStatus,
                    symboleCote: report.resolvedTicker,
                    cotationReelle: report.liveQuote,
                    verdict: report.verdict,
                    libelleVerdict: report.verdictLabel,
                    conviction: report.conviction,
                    resumeExecutif: report.executiveSummary,
                    accords: report.consensus,
                    desaccords: report.disagreements,
                    proxiesIndirects: report.indirectProxies,
                    enveloppeRecommandee: report.recommendedWrapper,
                    planAction: report.actionPlan,
                    conditionsInvalidation: report.invalidationConditions,
                    sources: report.sources,
                    sourceMode: report.source,
                    avertissementRepli: report.fallbackNotice,
                    agents: report.agents.map((a) => ({
                        agent: a.title,
                        position: a.stance,
                        confiance: a.confidence,
                        synthese: a.summary,
                        pointsCles: a.keyPoints,
                        risques: a.risks,
                    })),
                }),
                bloc: buildCommitteeTableauBloc(report),
            };
        },
    },
];

// ── Registre ───────────────────────────────────────────────────────────────

function construireRegistre(): ActionAssistant[] {
    const generiques = TRANCHES.flatMap((t) =>
        t.genre === 'collection' ? actionsCollection(t) : t.genre === 'liste_texte' ? actionsListeTexte(t) : actionsObjet(t));
    const toutes = [
        ...READ_SPECS.map(actionDepuisSpecLecture),
        ...WRITE_SPECS.map(actionDepuisSpecEcriture),
        ...generiques,
        ...actionsApplication,
    ];
    const noms = new Set<string>();
    for (const a of toutes) {
        if (noms.has(a.nom)) throw new Error(`Action en double dans le registre : ${a.nom}`);
        if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(a.nom)) throw new Error(`Nom d'action invalide : ${a.nom}`);
        noms.add(a.nom);
    }
    return toutes;
}

export const ACTIONS: ActionAssistant[] = construireRegistre();
const PAR_NOM = new Map(ACTIONS.map((a) => [a.nom, a]));

function trouverAction(nom: string): ActionAssistant | undefined {
    return PAR_NOM.get(nom);
}

/** JSON Schema accepté par Gemini (`parametersJsonSchema`) : objet inline, sans $ref ni méta ni `not`. */
function versSchemaGemini(schema: z.ZodType): Record<string, unknown> {
    const brut = z.toJSONSchema(schema, { target: 'draft-7', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    const nettoyer = (n: unknown): unknown => {
        if (Array.isArray(n)) return n.map(nettoyer);
        if (!estObjet(n)) return n;
        if ('$ref' in n || 'not' in n) return {};
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(n)) {
            if (k === '$schema' || k === '$defs' || k === 'definitions' || k === 'propertyNames' || k === '$id' || k === 'additionalProperties') continue;
            if (k === 'const') {
                out.enum = [v];
                continue;
            }
            out[k] = nettoyer(v);
        }
        return out;
    };
    return nettoyer(brut) as Record<string, unknown>;
}

export interface DeclarationOutil {
    name: string;
    description: string;
    parametersJsonSchema: Record<string, unknown>;
}

let declarationsCache: DeclarationOutil[] | null = null;
/** Déclarations envoyées au modèle (toutes les actions du registre). */
export function declarationsOutils(): DeclarationOutil[] {
    declarationsCache ??= ACTIONS.map((a) => ({
        name: a.nom,
        description: a.description.slice(0, 1000),
        parametersJsonSchema: versSchemaGemini(a.schema),
    }));
    return declarationsCache;
}

export interface ResultatExecution {
    resultat: ResultatAction;
    entree: EntreeJournal | null;
    erreur: boolean;
}

/**
 * Point d'entrée unique de la boucle agentique : valide (Zod strict), exécute, journalise.
 * Ne lève jamais : une erreur devient une charge utile honnête pour le modèle.
 */
export async function executerAction(nom: string, argsBruts: unknown, ctx: ContexteExecution = {}): Promise<ResultatExecution> {
    const action = trouverAction(nom);
    if (!action) return { resultat: { pourModele: { erreur: `Action inconnue : ${nom}` } }, entree: null, erreur: true };
    const parse = action.schema.safeParse(argsBruts ?? {});
    if (!parse.success) {
        const issues = parse.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`);
        return { resultat: { pourModele: { erreur: 'Arguments invalides', details: issues } }, entree: null, erreur: true };
    }
    const executer = action.executer as (etat: AppState, args: unknown, ctx: ContexteExecution) => Promise<ResultatAction>;
    try {
        if (action.type === 'lecture') {
            const etat = action.tranches.length === 0 && nom !== 'afficher_bloc' ? snapshotAppState() : (undefined as unknown as AppState);
            return { resultat: await executer(etat, parse.data, ctx), entree: null, erreur: false };
        }
        let resultat: ResultatAction = { pourModele: null };
        const entree = await journaliserEcriture(nom, async () => {
            resultat = await executer(snapshotAppState(), parse.data, ctx);
            return resultat.resume ?? nom;
        });
        return { resultat, entree, erreur: false };
    } catch (err) {
        if (ctx.signal?.aborted) throw err;
        const message = err instanceof Error ? err.message : String(err);
        return { resultat: { pourModele: { erreur: message.slice(0, 600) } }, entree: null, erreur: true };
    }
}
