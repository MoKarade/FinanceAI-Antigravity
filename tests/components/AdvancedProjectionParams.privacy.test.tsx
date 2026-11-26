// tests/components/AdvancedProjectionParams.privacy.test.tsx
//
// [A11Y-PRIVACY-PARAMS-AVANCES] — le plus gros bloc de données réelles jamais masqué du dépôt.
// 40 champs numériques, ZÉRO référence au mode discret avant ce lot.
// (⚠️ 40, pas 41 : un `<input type="number">` du fichier vit dans le TEXTE d'un commentaire.)
//
// CRITÈRE RETENU, mécanique et vérifiable : on masque les MONTANTS, c'est-à-dire les champs dont le
// libellé porte un `$` (14 sur 40). On laisse en clair les %, durées en mois, âges, probabilités et
// itérations Monte Carlo — ce ne sont pas des sommes, et le contrat du mode discret porte sur les
// montants (même décision que le bonus en % de #629).
//
// ⚠️ Le critère est appliqué À LA MAIN, champ par champ. Il n'est PAS implémenté en regex à
// l'exécution : leçon `TEXT-HEURISTIC-OVER-USER-TEXT` — une heuristique de texte sur un libellé est
// une source de faux positifs dès qu'un libellé peut contenir du texte utilisateur. En revanche,
// s'en servir comme GARDE DE TEST par scan de SOURCE est légitime (même famille que
// `chartPrivacyScan.test.ts`) : c'est ce que fait le dernier bloc de ce fichier.
//
// ⚠️ Les `<label>` de ce fichier n'étaient associés à AUCUN champ (ni `htmlFor`/`id`, ni
// enveloppement). Les 14 boutons masqués auraient donc été ANONYMES et indistinguables — la leçon
// `BudgetGroupTable` de #629. L'association a été câblée pour ces 14 champs, et testée.
// ⚠️ Depuis `[A11Y-LABELS-PARAMS-AVANCES]` (lot 50), les **40** champs du fichier sont câblés, pas
// seulement les 14 montants : le préfixe `app-` ne désigne donc plus « un montant ». Les assertions
// de ce fichier visent les 14 ids de `MONTANTS`, jamais le préfixe.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AdvancedProjectionParams } from '../../components/AdvancedProjectionParams';
import { useFinanceStore } from '../../store/useFinanceStore';
import type { ProjectionConfig } from '../../types';
import { stripCommentsJsx } from '../../utils/stripComments';

const setPrivacy = (on: boolean) => act(() => { useFinanceStore.setState({ isPrivacyMode: on }); });

// Montants « uniques » : aucun autre nombre de l'écran ne peut les imiter par hasard.
const MONTANTS: Record<string, number> = {
    divorceAlimonyMonthly: 1731,
    ciPayoutAmount: 91337,
    ciExtraMonthlyExpense: 2417,
    inheritanceExpectedAmount: 483221,
    snowbirdExtraMonthlyCost: 3719,
    boomerangSupportMonthly: 1791,
    caregivingMonthly: 1447,
};

// Valeurs NON monétaires, qui doivent rester lisibles : elles prouvent que le masquage est CIBLÉ et
// pas un « on cache tout » (qui rendrait le panneau inutilisable sans rien protéger de plus).
const NON_MONTANTS = {
    ltdIncomeReplacementPct: 63,
    ltdDurationMonths: 29,
    inheritanceExpectedAtAge: 67,
    jobLossDurationMonths: 7,
    snowbirdMonthsPerYear: 4,
    boomerangStartAge: 23,
    caregivingDurationMonths: 41,
    rrqSurvivorPct: 58,
    bootstrapBlockSize: 36,
};

const projection = {
    divorceEnabled: true, ltdEnabled: true, criticalIllnessEnabled: true,
    inheritanceEnabled: true, jobLossEnabled: true, modelSurvivor: true,
    snowbirdEnabled: true,
    ...MONTANTS, ...NON_MONTANTS,
} as unknown as ProjectionConfig;

const renderPanel = () =>
    render(<AdvancedProjectionParams projection={projection} updateProj={vi.fn()} />);

/** Valeurs réellement présentes dans les champs éditables. */
const inputValues = (c: HTMLElement) =>
    [...c.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value).join('|');

/** Texte + attributs porteurs de texte + valeurs des champs, espaces retirées. */
const allText = (c: HTMLElement) => {
    const attrs = [...c.querySelectorAll('[title], [aria-label], [placeholder]')]
        .map((el) => `${el.getAttribute('title') ?? ''} ${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('placeholder') ?? ''}`)
        .join(' ');
    return `${c.textContent ?? ''} ${attrs} ${inputValues(c)}`.replace(/[\s  ]/g, '');
};

beforeEach(() => { setPrivacy(false); });
afterEach(() => { cleanup(); setPrivacy(false); });

describe('[A11Y-PRIVACY-PARAMS-AVANCES] les 14 montants', () => {
    it('mode discret INACTIF : les 14 montants sont LISIBLES (le test discrimine)', () => {
        const { container } = renderPanel();
        const values = inputValues(container);
        for (const [cle, montant] of Object.entries(MONTANTS)) {
            expect(values, `${cle} devrait être lisible hors mode discret`).toContain(String(montant));
        }
    });

    it('mode discret ACTIF : les 14 montants SORTENT du DOM', () => {
        setPrivacy(true);
        const { container } = renderPanel();
        const text = allText(container);
        for (const [cle, montant] of Object.entries(MONTANTS)) {
            expect(text, `${cle} fuyait`).not.toContain(String(montant));
        }
    });

    // Le masquage doit être CIBLÉ : tout cacher protégerait autant, mais rendrait le panneau
    // illisible. Ce test échoue si quelqu'un « simplifie » en masquant tous les champs.
    it('mode discret ACTIF : %, durées, âges et itérations restent LISIBLES', () => {
        setPrivacy(true);
        const { container } = renderPanel();
        const values = inputValues(container);
        for (const [cle, valeur] of Object.entries(NON_MONTANTS)) {
            expect(values, `${cle} n'est pas un montant : il ne doit PAS être masqué`).toContain(String(valeur));
        }
    });

    it('mode discret ACTIF : le clic révèle un champ NUMÉRIQUE éditable', () => {
        setPrivacy(true);
        const { container } = renderPanel();
        const btn = container.querySelector('#app-inheritanceExpectedAmount') as HTMLButtonElement;
        expect(btn.tagName, 'le champ doit être masqué au repos').toBe('BUTTON');
        act(() => { fireEvent.click(btn); });
        const champ = container.querySelector('#app-inheritanceExpectedAmount') as HTMLInputElement;
        expect(champ.tagName).toBe('INPUT');
        expect(champ.type, 'le champ révélé doit rester numérique').toBe('number');
        expect(champ.value).toBe(String(MONTANTS.inheritanceExpectedAmount));
    });
});

// ── Nommage ───────────────────────────────────────────────────────────────────────────────────
describe('[A11Y-PRIVACY-PARAMS-AVANCES] nom accessible des champs masqués', () => {
    it('mode discret ACTIF : les 7 montants gardent CHACUN le libellé qu’ils affichent', () => {
        setPrivacy(true);
        const { container } = renderPanel();
        const attendus: Record<string, string> = {
            'app-divorceAlimonyMonthly': 'Pension alimentaire $/mois',
            'app-ciPayoutAmount': 'Capital forfaitaire reçu $',
            'app-ciExtraMonthlyExpense': 'Dépenses additionnelles $/mois',
            'app-inheritanceExpectedAmount': 'Héritage attendu $',
            'app-snowbirdExtraMonthlyCost': 'Surcoût mensuel ($)',
            'app-boomerangSupportMonthly': 'Boomerang $/mois',
            'app-caregivingMonthly': 'Caregiving $/mois',
        };
        expect(Object.keys(attendus), 'les 7 champs masqués doivent TOUS être listés').toHaveLength(7);
        for (const [id, nom] of Object.entries(attendus)) {
            expect(container.querySelector(`#${id}`), `${id} doit garder son nom`).toHaveAccessibleName(nom);
        }
    });

    it('mode discret ACTIF : les 7 noms sont TOUS distincts', () => {
        setPrivacy(true);
        const { container } = renderPanel();
        const noms = Object.keys(MONTANTS)
            .map((cle) => container.querySelector(`#app-${cle}`))
            .map((el) => el?.getAttribute('aria-label') ?? el?.textContent ?? '');
        expect(noms).toHaveLength(7);
        const libelles = Object.keys(MONTANTS)
            .map((cle) => container.querySelector(`label[for="app-${cle}"]`)?.textContent ?? '')
            .filter((t) => t !== '');
        expect(libelles, 'un champ montant a perdu son <label>').toHaveLength(7);
        expect(new Set(libelles).size, 'deux champs montants portent le MÊME libellé').toBe(7);
    });
});

// ── Garde de SOURCE : le critère « libellé en $ ⇒ champ masqué », appliqué au fichier ─────────
// Un test de RENDU ne voit que les champs effectivement montés (la moitié du panneau est derrière
// des `projection.xxxEnabled`). Un scan de SOURCE, lui, voit TOUT le fichier — y compris un champ
// ajouté demain dans une section que la fixture n'active pas.
describe('[A11Y-PRIVACY-PARAMS-AVANCES] garde de source : tout libellé en $ pilote un champ masqué', () => {
    const source = readFileSync(resolve(__dirname, '../../components/AdvancedProjectionParams.tsx'), 'utf8');

    /**
     * Source DÉCOMMENTÉE, base unique de tout ce bloc. Les commentaires JSX sont retirés UNE fois,
     * pour deux raisons distinctes qui se règlent du même geste :
     *  1. `divorceSplitPct` porte un commentaire de 5 lignes entre son `</label>` et son champ —
     *     sans ce nettoyage, sa paire échappe au scan (angle mort silencieux, vécu) ;
     *  2. ce même commentaire contient le TEXTE `<input type="number">`, cité en exemple — un
     *     décompte sur la source brute voit donc un champ FANTÔME de plus qu'il n'en existe.
     * ⚠️ Nettoyer d'abord, scanner ensuite — plutôt que de tolérer les commentaires DANS la regex
     * de paires. Un `(?:\{\/\*[\s\S]*?\*\/\}\s*)*` y imbrique deux quantificateurs et ouvre un
     * backtracking exponentiel (signalé par CodeQL). Ici chaque motif reste linéaire.
     *
     * ⚠️ `[GUARD-STRIPCOMMENTS-DUPLIQUE]` (lot 52) : la copie locale ne retirait que les commentaires
     * JSX (accolade + bloc) — un bloc hors JSX et un commentaire de LIGNE en fin de ligne de code y
     * survivaient tous les deux. La source unique traite les trois formes, et elle connaît en plus
     * les littéraux de chaîne, les gabarits et les regex.
     */
    const propre = stripCommentsJsx(source);

    /** Chaque `<label>…</label>`, avec le contrôle qui le suit. */
    const paires = () => {
        const out: Array<{ libelle: string; controle: string }> = [];
        const re = /<label[^>]*>([^<]*)<\/label>\s*(<[A-Za-z]+)/g;
        for (const m of propre.matchAll(re)) out.push({ libelle: m[1], controle: m[2] });
        return out;
    };

    // ⚠️ LA garde de la garde. Un scan qui rate silencieusement des champs donne un vert qui ne
    // veut rien dire — et c'est arrivé : le commentaire JSX de `divorceSplitPct` faisait tomber
    // le compte à 40 sans qu'aucune assertion ne s'en aperçoive. On exige donc que le scan couvre
    // TOUS les champs numériques du fichier. Le jour où quelqu'un ajoute un champ dans une forme
    // que la regex ne reconnaît pas, c'est CE test qui parle, pas un faux vert.
    it('le scan couvre TOUS les champs numériques du fichier (aucun angle mort)', () => {
        const champs = propre.match(/type="number"/g) ?? [];
        expect(champs.length, 'le fichier compte 33 champs numériques réels').toBe(33);
        expect(paires(), `le scan ne voit que ${paires().length} champs sur ${champs.length}`)
            .toHaveLength(champs.length);
    });

    it('la garde voit bien des libellés en $ (sinon elle ne prouverait rien)', () => {
        const enDollars = paires().filter((p) => p.libelle.includes('$'));
        expect(enDollars.length, 'aucun libellé en $ trouvé : le scan est cassé, pas le fichier').toBe(7);
    });

    it('AUCUN libellé en $ ne pilote un <input> nu', () => {
        const fautifs = paires()
            .filter((p) => p.libelle.includes('$') && p.controle !== '<PrivateNumberInput')
            .map((p) => `« ${p.libelle.trim()} » → ${p.controle}`);
        expect(fautifs, 'un montant est saisi en clair, quel que soit le mode discret').toEqual([]);
    });

    // Symétrique : le masquage doit rester CIBLÉ. Un champ sans `$` masqué par mégarde serait une
    // perte de lisibilité gratuite — et le signe que quelqu'un a masqué au jugé plutôt qu'au critère.
    it('AUCUN libellé SANS $ ne pilote un champ masqué', () => {
        const fautifs = paires()
            .filter((p) => !p.libelle.includes('$') && p.controle === '<PrivateNumberInput')
            .map((p) => `« ${p.libelle.trim()} »`);
        expect(fautifs, "ce champ n'est pas un montant : le masquer coûte de la lisibilité pour rien").toEqual([]);
    });
});
