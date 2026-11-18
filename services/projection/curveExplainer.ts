// services/projection/curveExplainer.ts
//
// Détecteur d'inflexions et générateur d'explications à double niveau (M3 / R3).
// Module 100 % pur : zéro dépendance store/, components/, hooks/, App.tsx ou Node.
// Respecte la règle « no-fake-data » (null pour toute valeur absente/non finie) et le
// masquage <PrivateAmount> côté UI (segments typés sans interpolation brute de $ ou %).

import type { GrandCalculMonthlyBand, GrandCalculResult, ProjectionChartPoint } from './types';
import { isFireReached } from './fireMilestone';
import {
    RRIF_FIRST_WITHDRAWAL_AGE,
    RRIF_PLATEAU_AGE,
    RRIF_RATE_PLATEAU,
    RRSP_TO_RRIF_CONVERSION_AGE,
    round2,
    rrifRateForAge,
} from './helpers';
import {
    CAPITAL_GAINS_INCLUSION_STANDARD,
    FHSA_MAX_HOLDER_AGE,
    FHSA_MAX_PARTICIPATION_YEARS,
    OAS_CLAWBACK_RATE,
    PENSION_SPLIT_MIN_AGE,
    PSV_BONUS_75_PLUS,
    PSV_BONUS_AGE,
    PSV_ELIGIBILITY_AGE,
    QC_FEDERAL_ABATEMENT_RATE,
    RRQ_MAX_DEFERRAL_AGE,
    RRQ_STANDARD_START_AGE,
    RRSP_ROOM_RATE,
} from '../../utils/tax';

export type ExplanationSegment =
    | { kind: 'text'; text: string }
    | { kind: 'cad'; value: number | null }
    | { kind: 'pct'; value: number | null; decimals?: number }
    | { kind: 'age'; value: number | null }
    | { kind: 'number'; value: number | null };

export interface CurveExplanationBreakdown {
    accumulationFlows: {
        employmentAndBusinessNet: number | null;
        contributionsTotal: number | null;
        investmentGrowth: number | null;
    };
    decaissementFlows: {
        livingExpenses: number | null;
        pensionsGross: number | null;
        withdrawalsTotal: number | null;
    };
    fiscalDetails: {
        incomeTaxTotal: number | null;
        marginalTaxRatePct: number | null;
        effectiveTaxRatePct: number | null;
        oasClawback: number | null;
        rrifMinimumRatePct: number | null;
        latentTaxTotal: number | null;
        rationaleFr: string[];
    };
}

export interface CurveInflectionExplanation {
    id: string;
    monthIndex: number;
    year: number;
    age: number;
    category: 'accumulation' | 'evenement' | 'retraite' | 'pension' | 'ferr' | 'objectif' | 'epuisement' | 'succession';
    titleFr: string;
    level1Segments: ExplanationSegment[];
    level2: CurveExplanationBreakdown;
}

type Category = CurveInflectionExplanation['category'];
type EventSubtype =
    | 'immo_achat'
    | 'immo_vente'
    | 'immo_downsizing'
    | 'immo_general'
    | 'krach'
    | 'heritage'
    | 'divorce'
    | 'deces'
    | 'soins'
    | 'perte_emploi'
    | 'celiapp'
    | 'recolte_fiscale'
    | 'impot_avril'
    | 'voyage'
    | 'autre';

type FerrSubtype = 'conversion_71' | 'retrait_72' | 'plateau_95' | 'conjoint_72';
type PensionSubtype = 'rrq' | 'psv' | 'privee' | 'psv_bonus' | 'clawback';
type ObjectifSubtype = 'fire' | 'jalon';
type AccumulationSubtype = 'depart' | 'extinction_dette' | 'acceleration';
type EpuisementSubtype = 'decouvert' | 'patrimoine_nul' | 'actifs_epuises';

interface CandidateSignal {
    category: Category;
    priority: number;
    titleFr: string;
    eventSubtype?: EventSubtype;
    ferrSubtype?: FerrSubtype;
    pensionSubtype?: PensionSubtype;
    objectifSubtype?: ObjectifSubtype;
    accumulationSubtype?: AccumulationSubtype;
    epuisementSubtype?: EpuisementSubtype;
    isAlreadyRetired?: boolean;
    goalMatchName?: string;
    rationaleFr: string[];
}

const COOLDOWN_MONTHS = 24;
const OAS_CLAWBACK_NOISE_CAD = 0.05;
const OAS_CLAWBACK_ONSET_CAD = 1;
const APRIL_TAX_MATERIAL_MIN_CAD = 5_000;
const APRIL_TAX_NW_RATIO = 0.03;
const APRIL_TAX_SPIKE_MULT = 2;
const APRIL_TAX_SPIKE_MIN_CAD = 2_000;
const APRIL_TAX_REPEAT_GROWTH_MIN = 1.25;
const IMMO_DELTA_THRESHOLD_CAD = 5000;
const IMMO_REL_DELTA_THRESHOLD = 0.02;
const ACCUMULATION_JUMP_MIN_CAD = 5000;
const ACCUMULATION_JUMP_MULT = 2.5;
const ACCUMULATION_TRAILING_WINDOW = 3;
const ACCUMULATION_PRIOR_MIN = 6;
const ACCUMULATION_PRIOR_MAX = 12;
const MC_SHOCK_MIN_CAD = 10_000;
const MC_SHOCK_RATIO = 0.15;
const DEBT_HIGH_THRESHOLD = 100;
const DEBT_CLEARED_THRESHOLD = 0.5;
const LIQUID_ASSETS_DEPLETED_THRESHOLD = 1;
const LIQUID_ASSETS_PRIOR_MIN = 1000;
const SMALL_EPSILON = 0.01;
const PERCENT_SCALE = 100;
const PENSION_SPLIT_MAX_SHARE_PCT = 50; // LIR art. 60.03 / T1032 / Annexe Q

const PCT_CLAWBACK = Math.round(OAS_CLAWBACK_RATE * PERCENT_SCALE);
const PCT_CG_INCLUSION = Math.round(CAPITAL_GAINS_INCLUSION_STANDARD * PERCENT_SCALE);
const PCT_RRSP_ROOM = Math.round(RRSP_ROOM_RATE * PERCENT_SCALE);
const PCT_PSV_BONUS = Math.round(PSV_BONUS_75_PLUS * PERCENT_SCALE);
const PCT_RRIF_PLATEAU = Math.round(RRIF_RATE_PLATEAU * PERCENT_SCALE);
const PCT_QC_ABATEMENT = (QC_FEDERAL_ABATEMENT_RATE * PERCENT_SCALE).toFixed(1).replace('.', ',');

function finiteOrNull(v: unknown): number | null {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round2OrNull(v: number | null): number | null {
    return v === null ? null : round2(v);
}

function absFiniteOrNull(v: unknown): number | null {
    const n = finiteOrNull(v);
    return n === null ? null : round2(Math.abs(n));
}

function sumFiniteOrNull(values: ReadonlyArray<unknown>): number | null {
    let sum = 0;
    let hasAny = false;
    for (const v of values) {
        if (typeof v === 'number' && Number.isFinite(v)) {
            sum += v;
            hasAny = true;
        }
    }
    return hasAny ? round2(sum) : null;
}

function positivePartOrNull(v: unknown): number | null {
    const n = finiteOrNull(v);
    return n === null ? null : Math.max(0, n);
}

function negativePartOrNull(v: unknown): number | null {
    const n = finiteOrNull(v);
    return n === null ? null : Math.max(0, -n);
}

function maxFiniteOrNull(a: unknown, b: unknown): number | null {
    const na = finiteOrNull(a);
    const nb = finiteOrNull(b);
    if (na === null) return nb;
    if (nb === null) return na;
    return Math.max(na, nb);
}

function isPositiveFinite(v: unknown): boolean {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function medianOf(values: ReadonlyArray<number>): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

function normalizeMonthKey(p: ProjectionChartPoint): number {
    if (typeof p.hostMonthIndex === 'number' && Number.isFinite(p.hostMonthIndex)) {
        return Math.trunc(p.hostMonthIndex);
    }
    return Math.floor(p.monthIndex);
}

const DAILY_FLOW_FIELDS: ReadonlyArray<keyof ProjectionChartPoint> = [
    'IncomeMarc',
    'IncomeAnna',
    'IncomeRetirement',
    'Income',
    'NetSalary',
    'Expenses',
    'Savings',
    'childCost',
    'childGross',
    'childBenefits',
    'ReeeContrib',
    'ReeePayout',
    'DividendIncome',
    'TaxableInvIncome',
    'pensionRRQ',
    'pensionPSV',
    'pensionPrivee',
    'ImmoHypo',
    'ImmoCharges',
    'ImmoInterest',
    'ImmoPrincipal',
    'RentalIncome',
    'RetraitREER',
    'RetraitCELI',
    'FluxImpots',
    'ImpotRetraitREER',
    'ImpotSalaireMois',
    'ImpotGainsCap',
    'ImpotDivers',
    'TaxPaidRevenu',
    'TaxPaidGains',
    'TaxPaidDivers',
    'TaxPaidREER',
    'WithheldTaxRrif',
    'ContribCELI',
    'ContribREER',
    'ContribNonReg',
    'MarketGrowthCELI',
    'MarketGrowthREER',
    'MarketGrowthNonReg',
    'MarketGrowthCrypto',
    'MarketGrowthLiquid',
    'MarketGrowthCELIAPP',
    'MarketGrowthREEE',
    'NetTransferCELI',
    'NetTransferREER',
    'NetTransferNonReg',
    'NetTransferCrypto',
    'NetTransferLiquid',
    'NetTransferCELIAPP',
    'NetTransferREEE',
    'ExpenseInflationImpact',
    'diffNW',
    'diffCELI',
    'diffREER',
    'diffLiquid',
];

function aggregateDailyMonth(
    mKey: number,
    dailyEntries: ReadonlyArray<{ point: ProjectionChartPoint; rawMonthIndex: number }>,
): ProjectionChartPoint {
    const sorted = [...dailyEntries].sort((a, b) => a.rawMonthIndex - b.rawMonthIndex);
    const latest = sorted[sorted.length - 1].point;
    const aggregated: ProjectionChartPoint = {
        ...latest,
        monthIndex: mKey,
    };
    const aggRecord = aggregated as unknown as Record<string, unknown>;

    for (const field of DAILY_FLOW_FIELDS) {
        let sum = 0;
        let hasFinite = false;
        for (const entry of sorted) {
            const val = entry.point[field];
            if (typeof val === 'number' && Number.isFinite(val)) {
                sum += val;
                hasFinite = true;
            }
        }
        if (hasFinite) {
            aggRecord[field as string] = round2(sum);
        }
    }

    const lifeSeen = new Set<string>();
    const lifeUnion: string[] = [];
    let hasLifeArray = false;
    const flowSeen = new Set<string>();
    const flowUnion: string[] = [];
    let hasFlowArray = false;

    for (const entry of sorted) {
        if (Array.isArray(entry.point.lifeEvents)) {
            hasLifeArray = true;
            for (const msg of entry.point.lifeEvents) {
                if (typeof msg === 'string' && !lifeSeen.has(msg)) {
                    lifeSeen.add(msg);
                    lifeUnion.push(msg);
                }
            }
        }
        if (Array.isArray(entry.point.flowEvents)) {
            hasFlowArray = true;
            for (const msg of entry.point.flowEvents) {
                if (typeof msg === 'string' && !flowSeen.has(msg)) {
                    flowSeen.add(msg);
                    flowUnion.push(msg);
                }
            }
        }
    }

    if (hasLifeArray) aggregated.lifeEvents = lifeUnion;
    if (hasFlowArray) aggregated.flowEvents = flowUnion;

    return aggregated;
}

interface MonthBucket {
    nonDaily?: { point: ProjectionChartPoint; rawMonthIndex: number };
    dailyEntries: Array<{ point: ProjectionChartPoint; rawMonthIndex: number }>;
}

function preprocessFuturePoints(
    chartData: ProjectionChartPoint[] | undefined | null,
): ProjectionChartPoint[] {
    if (!chartData || !Array.isArray(chartData) || chartData.length === 0) return [];

    const byMonth = new Map<number, MonthBucket>();
    for (const raw of chartData) {
        if (!raw || typeof raw !== 'object') continue;
        if (typeof raw.monthIndex !== 'number' || !Number.isFinite(raw.monthIndex)) continue;
        if (typeof raw.NetWorth !== 'number' || !Number.isFinite(raw.NetWorth)) continue;
        if (raw.monthIndex < 0 || raw.dayIsReal === true) continue;

        const mKey = normalizeMonthKey(raw);
        if (mKey < 0) continue;

        let bucket = byMonth.get(mKey);
        if (!bucket) {
            bucket = { dailyEntries: [] };
            byMonth.set(mKey, bucket);
        }

        if (raw.isDailyPoint === true) {
            bucket.dailyEntries.push({ point: raw, rawMonthIndex: raw.monthIndex });
        } else {
            const canonical = raw.monthIndex === mKey ? raw : { ...raw, monthIndex: mKey };
            if (!bucket.nonDaily || raw.monthIndex >= bucket.nonDaily.rawMonthIndex) {
                bucket.nonDaily = { point: canonical, rawMonthIndex: raw.monthIndex };
            }
        }
    }

    const out: ProjectionChartPoint[] = [];
    for (const [mKey, bucket] of byMonth.entries()) {
        if (bucket.nonDaily) {
            out.push(bucket.nonDaily.point);
        } else if (bucket.dailyEntries.length > 0) {
            out.push(aggregateDailyMonth(mKey, bucket.dailyEntries));
        }
    }

    return out.sort((a, b) => a.monthIndex - b.monthIndex);
}

function buildBandsIndex(
    grandCalcul?: GrandCalculResult | null,
): Map<number, GrandCalculMonthlyBand> {
    const map = new Map<number, GrandCalculMonthlyBand>();
    if (!grandCalcul?.monthlyBands) return map;
    for (const band of grandCalcul.monthlyBands) {
        if (band && typeof band.monthIndex === 'number' && Number.isFinite(band.monthIndex)) {
            map.set(Math.trunc(band.monthIndex), band);
        }
    }
    return map;
}

function resolveYearAndAge(
    p: ProjectionChartPoint,
    bands: ReadonlyMap<number, GrandCalculMonthlyBand>,
): { year: number; age: number; ageOrNull: number | null } {
    const band = bands.get(normalizeMonthKey(p));
    const yearVal = finiteOrNull(p.year) ?? finiteOrNull(band?.year);
    const ageVal = finiteOrNull(p.age) ?? finiteOrNull(band?.age);
    return {
        year: yearVal ?? Number.NaN,
        age: ageVal ?? Number.NaN,
        ageOrNull: ageVal,
    };
}

function computeEmploymentAndBusinessNet(p: ProjectionChartPoint): number | null {
    const salaries = sumFiniteOrNull([p.IncomeMarc, p.IncomeAnna]);
    if (p.isRetired === true) {
        return salaries;
    }

    const totalIncome = finiteOrNull(p.Income);
    if (salaries !== null) {
        if (p.isRetired === false && totalIncome !== null) {
            const nonEmployment =
                (finiteOrNull(p.IncomeRetirement) ?? 0) +
                (finiteOrNull(p.RentalIncome) ?? 0) +
                (finiteOrNull(p.childBenefits) ?? 0) +
                (finiteOrNull(p.ReeePayout) ?? 0);
            const activeResidual = Math.max(0, totalIncome - salaries - nonEmployment);
            return round2(salaries + activeResidual);
        }
        return salaries;
    }

    if (p.isRetired === false && totalIncome !== null) {
        const nonEmployment =
            (finiteOrNull(p.IncomeRetirement) ?? 0) +
            (finiteOrNull(p.RentalIncome) ?? 0) +
            (finiteOrNull(p.childBenefits) ?? 0) +
            (finiteOrNull(p.ReeePayout) ?? 0);
        return round2(Math.max(0, totalIncome - nonEmployment));
    }

    return null;
}

function computeOasClawback(p: ProjectionChartPoint): number | null {
    const rrq = finiteOrNull(p.pensionRRQ);
    const psv = finiteOrNull(p.pensionPSV);
    const privee = finiteOrNull(p.pensionPrivee);
    const incRet = finiteOrNull(p.IncomeRetirement);
    if (rrq === null || psv === null || privee === null || incRet === null) {
        return null;
    }
    if (psv <= 0) {
        return 0;
    }
    const diff = round2(Math.max(0, rrq + psv + privee - incRet));
    return diff <= OAS_CLAWBACK_NOISE_CAD ? 0 : diff;
}

function computeRrifMinimumRatePct(
    p: ProjectionChartPoint,
    resolvedAge?: number | null,
): number | null {
    const effectiveAge = resolvedAge !== undefined ? resolvedAge : finiteOrNull(p.age);
    if (effectiveAge === null || effectiveAge < RRIF_FIRST_WITHDRAWAL_AGE) return null;
    const hasRrifEvidence =
        (finiteOrNull(p.REER) ?? 0) > 0 ||
        (finiteOrNull(p.RetraitREER) ?? 0) > 0 ||
        (finiteOrNull(p.WithheldTaxRrif) ?? 0) > 0;
    if (!hasRrifEvidence) return null;
    return round2(rrifRateForAge(effectiveAge) * PERCENT_SCALE);
}

function computeBreakdown(
    p: ProjectionChartPoint,
    rationaleFr: string[],
    isSuccessionPoint: boolean,
    grandCalcul?: GrandCalculResult | null,
    resolvedAge?: number | null,
): CurveExplanationBreakdown {
    const employmentAndBusinessNet = computeEmploymentAndBusinessNet(p);
    const contributionsTotal = sumFiniteOrNull([
        p.ContribCELI,
        p.ContribREER,
        p.ContribNonReg,
        p.ReeeContrib,
        positivePartOrNull(p.NetTransferCELIAPP),
    ]);
    const investmentGrowth = sumFiniteOrNull([
        p.MarketGrowthCELI,
        p.MarketGrowthREER,
        p.MarketGrowthNonReg,
        p.MarketGrowthCrypto,
        p.MarketGrowthLiquid,
        p.MarketGrowthCELIAPP,
        p.MarketGrowthREEE,
    ]);

    const livingExpenses = round2OrNull(finiteOrNull(p.Expenses));
    const pensionsBreakdown = sumFiniteOrNull([p.pensionRRQ, p.pensionPSV, p.pensionPrivee]);
    const pensionsGross =
        pensionsBreakdown !== null ? pensionsBreakdown : round2OrNull(finiteOrNull(p.IncomeRetirement));

    const celiOut = maxFiniteOrNull(p.RetraitCELI, negativePartOrNull(p.NetTransferCELI));
    const withdrawalsTotal = sumFiniteOrNull([
        p.RetraitREER,
        celiOut,
        negativePartOrNull(p.NetTransferNonReg),
        negativePartOrNull(p.NetTransferCrypto),
    ]);

    const fluxImpots = finiteOrNull(p.FluxImpots);
    const incomeTaxTotal =
        fluxImpots !== null && Math.abs(fluxImpots) > SMALL_EPSILON
            ? round2(fluxImpots)
            : sumFiniteOrNull([
                  p.ImpotRetraitREER,
                  p.ImpotSalaireMois,
                  p.ImpotGainsCap,
                  p.ImpotDivers,
              ]);

    const marginalTaxRatePct = round2OrNull(finiteOrNull(p.marginalTaxRate));
    const effectiveTaxRatePct = round2OrNull(finiteOrNull(p.effectiveTaxRate));
    const oasClawback = computeOasClawback(p);
    const rrifMinimumRatePct = computeRrifMinimumRatePct(p, resolvedAge);

    const latentTaxTotal = isSuccessionPoint
        ? (finiteOrNull(grandCalcul?.estateTax?.mcTotalP50) ??
          finiteOrNull(grandCalcul?.estateTax?.deterministicTotal) ??
          absFiniteOrNull(p.ImpotLatent))
        : absFiniteOrNull(p.ImpotLatent);

    return {
        accumulationFlows: {
            employmentAndBusinessNet,
            contributionsTotal,
            investmentGrowth,
        },
        decaissementFlows: {
            livingExpenses,
            pensionsGross,
            withdrawalsTotal,
        },
        fiscalDetails: {
            incomeTaxTotal,
            marginalTaxRatePct,
            effectiveTaxRatePct,
            oasClawback,
            rrifMinimumRatePct,
            latentTaxTotal,
            rationaleFr,
        },
    };
}

function rationaleForAccumulation(): string[] {
    return [
        `REER (ARC) : cotisations déductibles jusqu’à ${PCT_RRSP_ROOM} % du revenu gagné de l’année précédente, dans la limite du plafond annuel; croissance à l’abri de l’impôt jusqu’au retrait.`,
        'CELI (ARC) : cotisations non déductibles, mais rendements et retraits entièrement exonérés d’impôt et exclus du calcul de récupération de la PSV.',
        `Compte non-enregistré : gains en capital inclus à ${PCT_CG_INCLUSION} % lors de la disposition (ARC / Revenu Québec) et dividendes admissibles bénéficiant du crédit d’impôt pour dividendes.`,
    ];
}

function rationaleForRetraite(ageOrNull: number | null): string[] {
    const lines = [
        'Transition retraite : fin des cotisations sociales sur salaire (RRQ, RQAP, AE) et orchestration des retraits (REER, CELI, non-enregistré) selon le taux marginal combiné ARC et Revenu Québec.',
    ];
    if (ageOrNull === null || ageOrNull >= PENSION_SPLIT_MIN_AGE) {
        lines.push(
            `À compter de ${PENSION_SPLIT_MIN_AGE} ans : admissibilité aux crédits d’âge fédéral et québécois ainsi qu’au fractionnement du revenu de pension admissible entre conjoints.`,
        );
    } else {
        lines.push(
            `Avant ${PENSION_SPLIT_MIN_AGE} ans : les crédits d’âge et le fractionnement du revenu de pension FERR s’activeront à compter de ${PENSION_SPLIT_MIN_AGE} ans (ARC / Revenu Québec).`,
        );
    }
    return lines;
}

function rationaleForPension(subtype: PensionSubtype): string[] {
    if (subtype === 'clawback') {
        return [
            `Récupération PSV (ARC) : ${PCT_CLAWBACK} % du revenu net individuel excédant le seuil annuel indexé, plafonnée à la prestation de PSV reçue.`,
            'Les retraits CELI ne s’ajoutent pas au revenu net fiscal et permettent de limiter la récupération de la PSV.',
        ];
    }
    if (subtype === 'psv' || subtype === 'psv_bonus') {
        return [
            `PSV (Service Canada) : admissible dès ${PSV_ELIGIBILITY_AGE} ans selon les années de résidence canadienne; bonification automatique de +${PCT_PSV_BONUS} % dès ${PSV_BONUS_AGE} ans.`,
            `Récupération PSV (ARC) : ${PCT_CLAWBACK} % du revenu net individuel excédant le seuil annuel indexé.`,
        ];
    }
    if (subtype === 'privee') {
        return [
            `Pension privée à prestations déterminées : entièrement imposable à l’ARC et à Revenu Québec, mais admissible au crédit pour revenu de pension et au fractionnement jusqu’à ${PENSION_SPLIT_MAX_SHARE_PCT} % entre conjoints dès ${PENSION_SPLIT_MIN_AGE} ans.`,
        ];
    }
    return [
        `RRQ (Retraite Québec) : âge normal de ${RRQ_STANDARD_START_AGE} ans avec ajustement en cas d’anticipation ou de report jusqu’à ${RRQ_MAX_DEFERRAL_AGE} ans; rente imposable non admissible au crédit pour revenu de pension.`,
    ];
}

function rationaleForFerr(subtype: FerrSubtype): string[] {
    if (subtype === 'conversion_71') {
        return [
            `Conversion REER vers FERR obligatoire au plus tard le 31 décembre de l’année des ${RRSP_TO_RRIF_CONVERSION_AGE} ans (ARC), sans retrait minimum exigé l’année d’ouverture.`,
            `Les retraits FERR débuteront l’année des ${RRIF_FIRST_WITHDRAWAL_AGE} ans selon le facteur prescrit ARC et ouvriront droit au crédit pour revenu de pension.`,
        ];
    }
    if (subtype === 'plateau_95') {
        return [
            `À ${RRIF_PLATEAU_AGE} ans et plus, le facteur de retrait minimum FERR prescrit par l’ARC atteint son plafond annuel de ${PCT_RRIF_PLATEAU} %.`,
            'Les retraits FERR sont imposés au taux marginal combiné ARC et Revenu Québec et comptent dans le test de récupération de la PSV.',
        ];
    }
    return [
        `Premier retrait minimum FERR obligatoire à ${RRIF_FIRST_WITHDRAWAL_AGE} ans selon la table prescrite de l’ARC, progressant avec l’âge jusqu’au plafond de ${PCT_RRIF_PLATEAU} % à ${RRIF_PLATEAU_AGE} ans.`,
        `Les retraits FERR sont imposables et entrent dans le calcul de récupération de la PSV, mais ouvrent droit au crédit pour revenu de pension et au fractionnement jusqu’à ${PENSION_SPLIT_MAX_SHARE_PCT} % (ARC / Revenu Québec).`,
    ];
}

function rationaleForObjectif(subtype: ObjectifSubtype): string[] {
    if (subtype === 'fire') {
        return [
            'Seuil d’indépendance financière (FIRE) : calculé sur la cible patrimoniale indexée à l’inflation afin de soutenir le train de vie projeté.',
            `L’accès aux capitaux avant la retraite dépend de l’ordre de décaissement : retraits CELI non imposables, gains en capital non-enregistrés inclus à ${PCT_CG_INCLUSION} % et retraits REER imposables au taux marginal.`,
        ];
    }
    return [
        `Financement d’un objectif : les retraits CELI demeurent exonérés d’impôt, tandis que les ventes non-enregistrées déclenchent l’inclusion à ${PCT_CG_INCLUSION} % des gains en capital et les retraits REER s’ajoutent au revenu imposable (ARC / Revenu Québec).`,
    ];
}

function rationaleForEpuisement(): string[] {
    return [
        'Tout déficit de trésorerie non couvert par les comptes liquides et de placement est comptabilisé en dette de liquidités et réduit le patrimoine net.',
        'Après épuisement des retraits REER/FERR, la baisse du revenu imposable peut réduire l’impôt combiné ARC/Revenu Québec et ouvrir l’admissibilité au Supplément de revenu garanti (SRG, non imposable).',
    ];
}

function rationaleForEvent(subtype: EventSubtype): string[] {
    switch (subtype) {
        case 'immo_achat':
        case 'immo_vente':
        case 'immo_downsizing':
        case 'immo_general':
            return [
                'Résidence principale exonérée d’impôt sur le gain en capital à la disposition (ARC / Revenu Québec) ; les immeubles locatifs restent soumis à l’imposition du gain en capital et à la récupération d’amortissement.',
                'Un retrait CELIAPP admissible est libre d’impôt et le RAP permet d’utiliser le REER sans impôt immédiat sous réserve d’un remboursement étalé.',
            ];
        case 'celiapp':
            return [
                `Fermeture réglementaire du CELIAPP (ARC) au plus tard à ${FHSA_MAX_HOLDER_AGE} ans ou après ${FHSA_MAX_PARTICIPATION_YEARS} ans de participation : transfert libre d’impôt du solde vers le REER ou le FERR.`,
            ];
        case 'impot_avril':
            return [
                `Échéance annuelle ARC et Revenu Québec au 30 avril : règlement du solde d’impôt (ou remboursement) après application des paliers progressifs et de l’abattement fédéral du Québec de ${PCT_QC_ABATEMENT} %.`,
            ];
        case 'krach':
        case 'recolte_fiscale':
            return [
                `Les pertes en capital cristallisées compensent les gains en capital réalisés (inclusion à ${PCT_CG_INCLUSION} %, ARC et Revenu Québec) sans impact fiscal sur les comptes enregistrés CELI/REER.`,
            ];
        case 'heritage':
            return [
                'Au Canada, un héritage reçu en capital n’est pas imposable entre les mains du bénéficiaire ; les revenus futurs générés par son placement deviennent imposables selon le type de compte.',
            ];
        case 'divorce':
            return [
                'Le partage du patrimoine familial et le fractionnement des droits accumulés suivent les règles civiles et fiscales applicables au Québec (transfert libre d’impôt entre ex-conjoints sous conditions ARC/RQ).',
            ];
        case 'deces':
            return [
                'Roulement au conjoint survivant possible pour les régimes enregistrés (REER/FERR) et biens en immobilisation afin de différer l’imposition réputée au décès.',
            ];
        case 'soins':
            return [
                'Les frais admissibles de soins de longue durée peuvent ouvrir droit au crédit d’impôt pour frais médicaux (ARC et Revenu Québec) au-delà du seuil applicable.',
            ];
        case 'perte_emploi':
            return [
                'Les prestations d’assurance-emploi ou d’invalidité imposables sont assujetties aux impôts ARC et Revenu Québec, mais n’ouvrent pas de nouveaux droits de cotisation REER.',
            ];
        default:
            return [
                `Flux exceptionnel intégré au bilan selon les règles de détention fiscale (CELI libre d’impôt, REER imposable au retrait, non-enregistré imposé à ${PCT_CG_INCLUSION} % sur le gain en capital).`,
            ];
    }
}

function rationaleForSuccession(grandCalcul?: GrandCalculResult | null): string[] {
    const lines = [
        `Disposition réputée au décès (ARC et Revenu Québec) : les gains en capital latents sur comptes non-enregistrés, crypto et immeubles locatifs sont inclus à ${PCT_CG_INCLUSION} %.`,
        'REER et FERR : la valeur résiduelle est incluse à 100 % dans la déclaration fiscale finale (hors roulement au conjoint survivant) ; la résidence principale demeure exonérée.',
        `Immeubles locatifs : récupération de la déduction pour amortissement (DPA) imposable à 100 % et impôt ventilé entre l’ARC (avec abattement du Québec de ${PCT_QC_ABATEMENT} %) et Revenu Québec.`,
    ];
    if (grandCalcul?.estateTax?.projectedDeathAge != null && Number.isFinite(grandCalcul.estateTax.projectedDeathAge)) {
        lines.push(
            `Estimation basée sur l’âge projeté au décès (${Math.round(grandCalcul.estateTax.projectedDeathAge)} ans) et les soldes imposables en fin d’horizon.`,
        );
    }
    return lines;
}

function ageClauseSegments(ageOrNull: number | null): ExplanationSegment[] {
    if (ageOrNull === null) return [];
    return [{ kind: 'text', text: ' à ' }, { kind: 'age', value: Math.round(ageOrNull) }];
}

function buildLevel1ForSignal(
    signal: CandidateSignal,
    p: ProjectionChartPoint,
    breakdown: CurveExplanationBreakdown,
    ageOrNull: number | null,
    grandCalcul?: GrandCalculResult | null,
): ExplanationSegment[] {
    const ageSegs = ageClauseSegments(ageOrNull);

    switch (signal.category) {
        case 'accumulation': {
            if (signal.accumulationSubtype === 'extinction_dette') {
                return [
                    { kind: 'text', text: 'Vos dettes sont entièrement remboursées' },
                    ...ageSegs,
                    { kind: 'text', text: ', libérant votre capacité d’épargne avec un patrimoine net de ' },
                    { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                    { kind: 'text', text: '.' },
                ];
            }
            const growth = breakdown.accumulationFlows.investmentGrowth;
            const contribs = breakdown.accumulationFlows.contributionsTotal;
            const diffNW = finiteOrNull(p.diffNW);
            if (signal.accumulationSubtype === 'acceleration' && diffNW !== null) {
                return [
                    { kind: 'text', text: 'La croissance du patrimoine s’accélère' },
                    ...ageSegs,
                    { kind: 'text', text: ' avec une progression mensuelle de ' },
                    { kind: 'cad', value: diffNW },
                    ...(growth !== null
                        ? [
                              { kind: 'text', text: ' dont ' } as ExplanationSegment,
                              { kind: 'cad', value: growth } as ExplanationSegment,
                              { kind: 'text', text: ' de rendement de marché' } as ExplanationSegment,
                          ]
                        : []),
                    { kind: 'text', text: '.' },
                ];
            }
            if (contribs !== null && growth !== null) {
                return [
                    { kind: 'text', text: 'Votre trajectoire démarre en phase d’accumulation' },
                    ...ageSegs,
                    { kind: 'text', text: ' avec ' },
                    { kind: 'cad', value: contribs },
                    { kind: 'text', text: ' d’épargne investie et ' },
                    { kind: 'cad', value: growth },
                    { kind: 'text', text: ' de rendement mensuel.' },
                ];
            }
            return [
                { kind: 'text', text: 'Votre trajectoire démarre en phase d’accumulation' },
                ...ageSegs,
                { kind: 'text', text: ' avec un patrimoine net initial de ' },
                { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                { kind: 'text', text: '.' },
            ];
        }

        case 'retraite': {
            const pensions = breakdown.decaissementFlows.pensionsGross;
            const withdrawals = breakdown.decaissementFlows.withdrawalsTotal;
            const expenses = breakdown.decaissementFlows.livingExpenses;
            const pp = grandCalcul?.guaranteedPurchasingPower?.p95SecurityMonthlyNetReal;
            const ppClause: ExplanationSegment[] =
                pp != null && Number.isFinite(pp)
                    ? [
                          { kind: 'text', text: ' (pouvoir d’achat réel garanti à P95 : ' },
                          { kind: 'cad', value: pp },
                          { kind: 'text', text: '/mois)' },
                      ]
                    : [];
            if (pensions !== null && withdrawals !== null && expenses !== null) {
                return [
                    {
                        kind: 'text',
                        text: signal.isAlreadyRetired
                            ? 'La phase de retraite active'
                            : 'Le passage à la retraite',
                    },
                    ...ageSegs,
                    { kind: 'text', text: ' s’appuie sur ' },
                    { kind: 'cad', value: pensions },
                    { kind: 'text', text: ' de rentes et ' },
                    { kind: 'cad', value: withdrawals },
                    { kind: 'text', text: ' de retraits mensuels pour couvrir ' },
                    { kind: 'cad', value: expenses },
                    { kind: 'text', text: ' de dépenses' },
                    ...ppClause,
                    { kind: 'text', text: '.' },
                ];
            }
            return [
                { kind: 'text', text: 'La phase de retraite est active' },
                ...ageSegs,
                { kind: 'text', text: ' avec un patrimoine net de ' },
                { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                ...ppClause,
                { kind: 'text', text: '.' },
            ];
        }

        case 'pension': {
            if (signal.pensionSubtype === 'clawback') {
                const claw = breakdown.fiscalDetails.oasClawback;
                return [
                    { kind: 'text', text: 'Le seuil de récupération de la PSV est dépassé' },
                    ...ageSegs,
                    ...(claw !== null
                        ? [
                              { kind: 'text', text: ', réduisant la prestation de ' } as ExplanationSegment,
                              { kind: 'cad', value: claw } as ExplanationSegment,
                              { kind: 'text', text: ' par mois' } as ExplanationSegment,
                          ]
                        : []),
                    { kind: 'text', text: '.' },
                ];
            }
            if (signal.pensionSubtype === 'psv_bonus') {
                const psv = finiteOrNull(p.pensionPSV);
                return [
                    { kind: 'text', text: 'La bonification automatique de ' },
                    { kind: 'pct', value: PCT_PSV_BONUS, decimals: 0 },
                    ...(psv !== null
                        ? [
                              { kind: 'text', text: ' porte votre PSV à ' } as ExplanationSegment,
                              { kind: 'cad', value: psv } as ExplanationSegment,
                              { kind: 'text', text: ' par mois' } as ExplanationSegment,
                          ]
                        : [{ kind: 'text', text: ' bonifie votre PSV' } as ExplanationSegment]),
                    ...ageSegs,
                    { kind: 'text', text: '.' },
                ];
            }
            if (signal.pensionSubtype === 'psv') {
                const psv = finiteOrNull(p.pensionPSV);
                return [
                    { kind: 'text', text: 'La Pension de la sécurité de la vieillesse démarre' },
                    ...ageSegs,
                    ...(psv !== null
                        ? [
                              { kind: 'text', text: ' à ' } as ExplanationSegment,
                              { kind: 'cad', value: psv } as ExplanationSegment,
                              { kind: 'text', text: ' par mois' } as ExplanationSegment,
                          ]
                        : []),
                    { kind: 'text', text: '.' },
                ];
            }
            if (signal.pensionSubtype === 'privee') {
                const privee = finiteOrNull(p.pensionPrivee);
                return [
                    { kind: 'text', text: 'Votre rente de pension privée commence' },
                    ...ageSegs,
                    ...(privee !== null
                        ? [
                              { kind: 'text', text: ' pour ' } as ExplanationSegment,
                              { kind: 'cad', value: privee } as ExplanationSegment,
                              { kind: 'text', text: ' par mois' } as ExplanationSegment,
                          ]
                        : []),
                    { kind: 'text', text: '.' },
                ];
            }
            const rrq = finiteOrNull(p.pensionRRQ);
            return [
                { kind: 'text', text: 'Le versement de la rente RRQ commence' },
                ...ageSegs,
                ...(rrq !== null
                    ? [
                          { kind: 'text', text: ' pour ' } as ExplanationSegment,
                          { kind: 'cad', value: rrq } as ExplanationSegment,
                          { kind: 'text', text: ' par mois' } as ExplanationSegment,
                      ]
                    : []),
                { kind: 'text', text: '.' },
            ];
        }

        case 'ferr': {
            if (signal.ferrSubtype === 'conversion_71') {
                const reer = finiteOrNull(p.REER);
                return [
                    { kind: 'text', text: reer !== null ? 'Votre REER de ' : 'Votre REER' },
                    ...(reer !== null ? [{ kind: 'cad', value: reer } as ExplanationSegment] : []),
                    { kind: 'text', text: reer !== null ? ' doit être converti en FERR' : ' doit être converti en FERR' },
                    ...ageSegs,
                    { kind: 'text', text: ' avant la fin de l’année, sans retrait minimum obligatoire cette année.' },
                ];
            }
            const ratePct = breakdown.fiscalDetails.rrifMinimumRatePct;
            const retrait = finiteOrNull(p.RetraitREER);
            if (signal.ferrSubtype === 'conjoint_72') {
                return [
                    { kind: 'text', text: 'Le premier retrait minimum FERR du conjoint s’applique' },
                    ...ageSegs,
                    ...(retrait !== null && retrait > 0
                        ? [
                              { kind: 'text', text: ', pour ' } as ExplanationSegment,
                              { kind: 'cad', value: retrait } as ExplanationSegment,
                              { kind: 'text', text: ' retirés ce mois-ci' } as ExplanationSegment,
                          ]
                        : []),
                    { kind: 'text', text: '.' },
                ];
            }
            if (signal.ferrSubtype === 'plateau_95') {
                if (ratePct !== null) {
                    return [
                        { kind: 'text', text: 'Le taux de retrait minimum FERR atteint son plafond réglementaire de ' },
                        { kind: 'pct', value: ratePct, decimals: 0 },
                        ...ageSegs,
                        { kind: 'text', text: '.' },
                    ];
                }
                return [
                    { kind: 'text', text: 'Votre FERR atteint le palier de retrait maximal réglementaire' },
                    ...ageSegs,
                    { kind: 'text', text: '.' },
                ];
            }
            const rateClause: ExplanationSegment[] =
                ratePct !== null
                    ? [
                          { kind: 'text', text: ' au taux prescrit de ' },
                          { kind: 'pct', value: ratePct, decimals: 2 },
                      ]
                    : [];
            if (retrait !== null && retrait > 0) {
                return [
                    { kind: 'text', text: 'Le premier retrait minimum FERR obligatoire s’applique' },
                    ...ageSegs,
                    ...rateClause,
                    { kind: 'text', text: ', pour ' },
                    { kind: 'cad', value: retrait },
                    { kind: 'text', text: ' retirés ce mois-ci.' },
                ];
            }
            return [
                { kind: 'text', text: 'Votre FERR entre en phase de retrait minimum obligatoire' },
                ...ageSegs,
                ...rateClause,
                { kind: 'text', text: '.' },
            ];
        }

        case 'objectif': {
            if (signal.objectifSubtype === 'fire') {
                const mcP50 = finiteOrNull(grandCalcul?.fiAge?.p50Age);
                const mcSegs: ExplanationSegment[] =
                    mcP50 !== null
                        ? [
                              { kind: 'text', text: ' (âge médian Monte Carlo : ' },
                              { kind: 'age', value: Math.round(mcP50) },
                              { kind: 'text', text: ')' },
                          ]
                        : [];
                const fireTarget = finiteOrNull(p.FireTarget);
                return [
                    { kind: 'text', text: 'Votre patrimoine net atteint ' },
                    { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                    ...ageSegs,
                    { kind: 'text', text: ', franchissant le seuil d’indépendance financière' },
                    ...(fireTarget !== null
                        ? [
                              { kind: 'text', text: ' de ' } as ExplanationSegment,
                              { kind: 'cad', value: fireTarget } as ExplanationSegment,
                          ]
                        : []),
                    ...mcSegs,
                    { kind: 'text', text: '.' },
                ];
            }
            const matchedGoal = findMatchingGoalProbability(p, signal.goalMatchName, grandCalcul);
            const probSegs: ExplanationSegment[] =
                matchedGoal?.probabilityPct != null && Number.isFinite(matchedGoal.probabilityPct)
                    ? [
                          { kind: 'text', text: ' avec une probabilité d’atteinte de ' },
                          { kind: 'pct', value: matchedGoal.probabilityPct, decimals: 0 },
                      ]
                    : [];
            return [
                { kind: 'text', text: 'Un objectif financier arrive à échéance' },
                ...ageSegs,
                { kind: 'text', text: ' avec un patrimoine net de ' },
                { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                ...probSegs,
                { kind: 'text', text: '.' },
            ];
        }

        case 'epuisement': {
            const liquidDebt = finiteOrNull(p.LiquidDebt);
            if (signal.epuisementSubtype === 'decouvert' && liquidDebt !== null && liquidDebt > 0) {
                return [
                    { kind: 'text', text: 'Les liquidités et placements ne couvrent plus les dépenses' },
                    ...ageSegs,
                    { kind: 'text', text: ', créant une dette de liquidités de ' },
                    { kind: 'cad', value: liquidDebt },
                    { kind: 'text', text: '.' },
                ];
            }
            if (signal.epuisementSubtype === 'actifs_epuises') {
                return [
                    { kind: 'text', text: 'Vos placements financiers liquides sont épuisés' },
                    ...ageSegs,
                    { kind: 'text', text: ', laissant vos rentes soutenir le train de vie courant.' },
                ];
            }
            return [
                { kind: 'text', text: 'Le patrimoine net passe sous zéro' },
                ...ageSegs,
                { kind: 'text', text: ' à ' },
                { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                { kind: 'text', text: ' sous la pression des décaissements.' },
            ];
        }

        case 'evenement': {
            const diffNW = finiteOrNull(p.diffNW);
            const growth = breakdown.accumulationFlows.investmentGrowth;
            const tax = breakdown.fiscalDetails.incomeTaxTotal;
            switch (signal.eventSubtype) {
                case 'immo_achat': {
                    const immo = finiteOrNull(p.Immobilier);
                    return [
                        { kind: 'text', text: 'Une acquisition immobilière modifie la structure de votre bilan' },
                        ...ageSegs,
                        ...(immo !== null
                            ? [
                                  { kind: 'text', text: ', portant l’équité immobilière à ' } as ExplanationSegment,
                                  { kind: 'cad', value: immo } as ExplanationSegment,
                              ]
                            : []),
                        { kind: 'text', text: '.' },
                    ];
                }
                case 'immo_vente':
                    return [
                        { kind: 'text', text: 'Une vente immobilière libère des capitaux' },
                        ...ageSegs,
                        { kind: 'text', text: ' avec un patrimoine net de ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        { kind: 'text', text: '.' },
                    ];
                case 'immo_downsizing':
                    return [
                        { kind: 'text', text: 'Le réajustement immobilier de retraite libère de l’équité' },
                        ...ageSegs,
                        { kind: 'text', text: ' et porte votre patrimoine net à ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        { kind: 'text', text: '.' },
                    ];
                case 'immo_general': {
                    const immo = finiteOrNull(p.Immobilier);
                    return [
                        { kind: 'text', text: 'Une opération immobilière fait évoluer votre équité nette' },
                        ...(immo !== null
                            ? [
                                  { kind: 'text', text: ' à ' } as ExplanationSegment,
                                  { kind: 'cad', value: immo } as ExplanationSegment,
                              ]
                            : []),
                        ...ageSegs,
                        { kind: 'text', text: '.' },
                    ];
                }
                case 'krach': {
                    const drop = growth ?? diffNW;
                    return [
                        { kind: 'text', text: 'Un repli marqué des marchés pèse sur la courbe' },
                        ...ageSegs,
                        ...(drop !== null
                            ? [
                                  { kind: 'text', text: ' avec une variation de ' } as ExplanationSegment,
                                  { kind: 'cad', value: drop } as ExplanationSegment,
                              ]
                            : []),
                        { kind: 'text', text: '.' },
                    ];
                }
                case 'impot_avril':
                    if (tax !== null && tax < 0) {
                        return [
                            { kind: 'text', text: 'La régularisation fiscale annuelle d’avril génère un remboursement d’impôt de ' },
                            { kind: 'cad', value: round2(Math.abs(tax)) },
                            ...ageSegs,
                            { kind: 'text', text: '.' },
                        ];
                    }
                    if (tax !== null && tax > 0) {
                        return [
                            { kind: 'text', text: 'La régularisation fiscale annuelle d’avril génère un solde d’impôt à payer de ' },
                            { kind: 'cad', value: tax },
                            ...ageSegs,
                            { kind: 'text', text: '.' },
                        ];
                    }
                    return [
                        { kind: 'text', text: 'La régularisation fiscale annuelle d’avril ajuste votre bilan fiscal' },
                        ...ageSegs,
                        { kind: 'text', text: '.' },
                    ];
                case 'celiapp':
                    return [
                        { kind: 'text', text: 'Le CELIAPP atteint son échéance réglementaire' },
                        ...ageSegs,
                        { kind: 'text', text: ' et son solde est transféré vers le REER.' },
                    ];
                case 'recolte_fiscale':
                    return [
                        { kind: 'text', text: 'Un arbitrage fiscal de fin d’année ajuste les gains imposables' },
                        ...ageSegs,
                        { kind: 'text', text: ' avec un patrimoine net de ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        { kind: 'text', text: '.' },
                    ];
                case 'heritage':
                    return [
                        { kind: 'text', text: 'Un apport exceptionnel d’héritage augmente le patrimoine net à ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        ...ageSegs,
                        { kind: 'text', text: '.' },
                    ];
                case 'divorce':
                    return [
                        { kind: 'text', text: 'Une séparation entraîne le partage des actifs du ménage' },
                        ...ageSegs,
                        { kind: 'text', text: ', établissant le patrimoine net à ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        { kind: 'text', text: '.' },
                    ];
                case 'deces':
                    return [
                        { kind: 'text', text: 'Le décès du conjoint réorganise les revenus et actifs du ménage' },
                        ...ageSegs,
                        { kind: 'text', text: ' avec un patrimoine net de ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        { kind: 'text', text: '.' },
                    ];
                case 'soins': {
                    const living = breakdown.decaissementFlows.livingExpenses;
                    return [
                        { kind: 'text', text: 'Des frais de soins de longue durée augmentent les décaissements' },
                        ...ageSegs,
                        ...(living !== null
                            ? [
                                  { kind: 'text', text: ' à ' } as ExplanationSegment,
                                  { kind: 'cad', value: living } as ExplanationSegment,
                                  { kind: 'text', text: ' par mois' } as ExplanationSegment,
                              ]
                            : []),
                        { kind: 'text', text: '.' },
                    ];
                }
                case 'perte_emploi':
                    return [
                        { kind: 'text', text: 'Une interruption de revenu réduit temporairement la capacité d’épargne' },
                        ...ageSegs,
                        { kind: 'text', text: '.' },
                    ];
                default:
                    return [
                        { kind: 'text', text: 'Un événement financier ponctuel modifie votre patrimoine net à ' },
                        { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                        ...ageSegs,
                        { kind: 'text', text: '.' },
                    ];
            }
        }

        case 'succession': {
            const horizonSegs: ExplanationSegment[] =
                ageOrNull !== null
                    ? [
                          { kind: 'text', text: 'À l’horizon de ' },
                          { kind: 'age', value: Math.round(ageOrNull) },
                      ]
                    : [{ kind: 'text', text: 'À l’horizon' }];

            const et = grandCalcul?.estateTax;
            const mcTotal = finiteOrNull(et?.mcTotalP50);
            const mcFed = finiteOrNull(et?.mcFedP50);
            const mcQc = finiteOrNull(et?.mcQcP50);
            const detTotal = finiteOrNull(et?.deterministicTotal);
            const detFed = finiteOrNull(et?.deterministicFed);
            const detQc = finiteOrNull(et?.deterministicQc);

            const hasMcTriplet = mcTotal !== null && mcFed !== null && mcQc !== null;
            const hasDetTriplet = detTotal !== null && detFed !== null && detQc !== null;
            const estTotal = hasMcTriplet ? mcTotal : hasDetTriplet ? detTotal : null;
            const estFed = hasMcTriplet ? mcFed : hasDetTriplet ? detFed : null;
            const estQc = hasMcTriplet ? mcQc : hasDetTriplet ? detQc : null;

            if (estTotal !== null && estFed !== null && estQc !== null) {
                return [
                    ...horizonSegs,
                    { kind: 'text', text: ', votre patrimoine net projeté atteint ' },
                    { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                    { kind: 'text', text: ' avec un impôt successoral estimé à ' },
                    { kind: 'cad', value: estTotal },
                    { kind: 'text', text: ' (ARC ' },
                    { kind: 'cad', value: estFed },
                    { kind: 'text', text: ' et Revenu Québec ' },
                    { kind: 'cad', value: estQc },
                    { kind: 'text', text: ').' },
                ];
            }
            const latent = breakdown.fiscalDetails.latentTaxTotal;
            if (latent !== null) {
                return [
                    ...horizonSegs,
                    { kind: 'text', text: ', votre patrimoine net projeté atteint ' },
                    { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                    { kind: 'text', text: ' pour une charge fiscale successorale latente estimée à ' },
                    { kind: 'cad', value: latent },
                    { kind: 'text', text: '.' },
                ];
            }
            return [
                ...horizonSegs,
                { kind: 'text', text: ', votre patrimoine net terminal projeté atteint ' },
                { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                { kind: 'text', text: '.' },
            ];
        }
    }
}

function findMatchingGoalProbability(
    p: ProjectionChartPoint,
    goalMatchName: string | undefined,
    grandCalcul?: GrandCalculResult | null,
) {
    const goals = grandCalcul?.goalProbabilities;
    if (!goals || goals.length === 0) return undefined;
    if (goalMatchName) {
        const lower = goalMatchName.toLowerCase();
        const byName = goals.find((g) => g.name.toLowerCase() === lower);
        if (byName) return byName;
    }
    const y = finiteOrNull(p.year);
    if (y !== null) {
        const prefix = `${Math.round(y)}-`;
        const byYear = goals.find((g) => typeof g.deadline === 'string' && g.deadline.startsWith(prefix));
        if (byYear) return byYear;
    }
    return undefined;
}

function extractGoalNameFromFlowEvent(msg: string): string | undefined {
    const prefixMatch = /^🏆\s+(?:Jalon patrimoine|But financier)\s+\(/.exec(msg);
    if (prefixMatch) {
        const startIdx = prefixMatch[0].length;
        let depth = 1;
        for (let i = startIdx; i < msg.length; i++) {
            const ch = msg[i];
            if (ch === '(') {
                depth++;
            } else if (ch === ')') {
                depth--;
                if (depth === 0) {
                    const extracted = msg.slice(startIdx, i).trim();
                    return extracted.length > 0 ? extracted : undefined;
                }
            }
        }
    }
    const fallback = /^🏆\s+(?:Jalon patrimoine|But financier)\s+\((.+)\)\s*:/.exec(msg);
    return fallback?.[1]?.trim();
}

function isHeritageEventMessage(msg: string): boolean {
    if (
        msg.startsWith('💰 Rembours. TPS/TVQ') ||
        msg.startsWith('💰 Retrait CELIAPP') ||
        msg.startsWith('💰 ↳ Surplus')
    ) {
        return false;
    }
    return (
        msg.startsWith('🎁 Héritage') ||
        msg.startsWith('⏳ Héritage') ||
        /héritage/i.test(msg) ||
        /gain exceptionnel/i.test(msg) ||
        msg.startsWith('💰 Héritage/Gain') ||
        msg.startsWith('💰 WINDFALL') ||
        msg.startsWith('💰 LATE_INHERITANCE') ||
        msg.endsWith(' 💰')
    );
}

function hasNonZeroFerrLog(flowList: ReadonlyArray<string>): boolean {
    for (const msg of flowList) {
        if (!msg.startsWith('🏦 FERR')) continue;
        const brutMatch = /Brut\s+([\d\s\u00a0\u202f.,]+)/i.exec(msg);
        if (!brutMatch) return true;
        const normalized = brutMatch[1].replace(/[\s\u00a0\u202f]/g, '').replace(',', '.');
        const parsed = Number.parseFloat(normalized);
        if (Number.isFinite(parsed) && parsed > SMALL_EPSILON) return true;
    }
    return false;
}

function isJanuaryDateLabel(dateLabel: unknown): boolean {
    if (typeof dateLabel !== 'string' || dateLabel.trim() === '') return true;
    const trimmed = dateLabel.trim().toLowerCase();
    if (trimmed.startsWith('jan')) return true;
    if (/\d{2}\/01\/\d{4}/.test(trimmed)) return true;
    return false;
}

function detectEngineEventSignal(
    p: ProjectionChartPoint,
    prev: ProjectionChartPoint | undefined,
    lastAprilTaxMonth: number,
    prevAprilAbs: number | null,
    prevAprilSign: number,
    lastImmoGeneralMonth: number,
): CandidateSignal | null {
    const life = Array.isArray(p.lifeEvents) ? p.lifeEvents : [];
    const flow = Array.isArray(p.flowEvents) ? p.flowEvents : [];

    for (const msg of life) {
        if (msg.startsWith('🏠 Achat')) {
            return { category: 'evenement', priority: 35, titleFr: 'Acquisition immobilière', eventSubtype: 'immo_achat', rationaleFr: rationaleForEvent('immo_achat') };
        }
        if (msg.startsWith('🏠 Vente')) {
            return { category: 'evenement', priority: 35, titleFr: 'Vente immobilière', eventSubtype: 'immo_vente', rationaleFr: rationaleForEvent('immo_vente') };
        }
        if (msg.startsWith('🏠 Downsizing')) {
            return { category: 'evenement', priority: 35, titleFr: 'Réajustement immobilier', eventSubtype: 'immo_downsizing', rationaleFr: rationaleForEvent('immo_downsizing') };
        }
        if (msg.startsWith('📉 Choc Marché') || msg.includes('Krach (')) {
            return { category: 'evenement', priority: 36, titleFr: 'Choc de marché', eventSubtype: 'krach', rationaleFr: rationaleForEvent('krach') };
        }
        if (isHeritageEventMessage(msg)) {
            return { category: 'evenement', priority: 34, titleFr: 'Apport d’héritage ou gain exceptionnel', eventSubtype: 'heritage', rationaleFr: rationaleForEvent('heritage') };
        }
        if (msg.startsWith('💔 Divorce')) {
            return { category: 'evenement', priority: 38, titleFr: 'Partage patrimonial (séparation)', eventSubtype: 'divorce', rationaleFr: rationaleForEvent('divorce') };
        }
        if (msg.startsWith('🖤 Décès')) {
            return { category: 'evenement', priority: 38, titleFr: 'Décès du conjoint', eventSubtype: 'deces', rationaleFr: rationaleForEvent('deces') };
        }
        if (msg.startsWith('🏥 Soins de longue durée')) {
            return { category: 'evenement', priority: 33, titleFr: 'Soins de longue durée', eventSubtype: 'soins', rationaleFr: rationaleForEvent('soins') };
        }
        if (msg.startsWith('📉 Perte de revenu') || msg.startsWith('💼 Prestation')) {
            return { category: 'evenement', priority: 32, titleFr: 'Interruption de revenu', eventSubtype: 'perte_emploi', rationaleFr: rationaleForEvent('perte_emploi') };
        }
    }

    for (const msg of flow) {
        if (msg.startsWith('🏛️ CELIAPP:')) {
            return { category: 'evenement', priority: 33, titleFr: 'Échéance et transfert du CELIAPP', eventSubtype: 'celiapp', rationaleFr: rationaleForEvent('celiapp') };
        }
        if (msg.startsWith('📉 Choc Marché') || msg.includes('Krach (')) {
            return { category: 'evenement', priority: 36, titleFr: 'Choc de marché', eventSubtype: 'krach', rationaleFr: rationaleForEvent('krach') };
        }
        if (isHeritageEventMessage(msg)) {
            return { category: 'evenement', priority: 34, titleFr: 'Apport d’héritage ou gain exceptionnel', eventSubtype: 'heritage', rationaleFr: rationaleForEvent('heritage') };
        }
        if (msg.startsWith('🛡️ Perte Cristallisée') || msg.startsWith('🌱 Récolte de gains') || msg.startsWith('❄️ Guyton-Klinger')) {
            return { category: 'evenement', priority: 28, titleFr: 'Arbitrage fiscal de portefeuille', eventSubtype: 'recolte_fiscale', rationaleFr: rationaleForEvent('recolte_fiscale') };
        }
        if (msg.startsWith('✈️ Voyage')) {
            return { category: 'evenement', priority: 26, titleFr: 'Projet ou voyage planifié', eventSubtype: 'voyage', rationaleFr: rationaleForEvent('voyage') };
        }
    }

    if (prev) {
        const currImmo = finiteOrNull(p.Immobilier);
        const prevImmo = finiteOrNull(prev.Immobilier);
        if (
            currImmo !== null &&
            prevImmo !== null &&
            Math.abs(currImmo - prevImmo) >= IMMO_DELTA_THRESHOLD_CAD &&
            (Math.abs(prevImmo) < IMMO_DELTA_THRESHOLD_CAD ||
                Math.abs(currImmo - prevImmo) / Math.abs(prevImmo) >= IMMO_REL_DELTA_THRESHOLD) &&
            p.monthIndex - lastImmoGeneralMonth >= COOLDOWN_MONTHS
        ) {
            return { category: 'evenement', priority: 31, titleFr: 'Variation immobilière majeure', eventSubtype: 'immo_general', rationaleFr: rationaleForEvent('immo_general') };
        }

        // Fallback pour séries MC allégées sans champs détaillés : choc net soudain
        const hasDetailedFields =
            p.isRetired !== undefined ||
            p.age !== undefined ||
            p.Expenses !== undefined ||
            p.lifeEvents !== undefined;
        if (!hasDetailedFields && prev.NetWorth > 0) {
            const delta = p.NetWorth - prev.NetWorth;
            if (delta <= -MC_SHOCK_MIN_CAD && delta / prev.NetWorth <= -MC_SHOCK_RATIO) {
                return { category: 'evenement', priority: 30, titleFr: 'Baisse marquée du patrimoine', eventSubtype: 'krach', rationaleFr: rationaleForEvent('krach') };
            }
        }
    }

    const fluxImpots = finiteOrNull(p.FluxImpots);
    if (fluxImpots !== null && Math.abs(fluxImpots) > SMALL_EPSILON) {
        const absFlux = Math.abs(fluxImpots);
        const sign = fluxImpots > 0 ? 1 : -1;
        const materialThreshold = Math.max(
            APRIL_TAX_MATERIAL_MIN_CAD,
            APRIL_TAX_NW_RATIO * Math.max(0, p.NetWorth),
        );
        const isMaterial = absFlux >= materialThreshold;
        const isSpike =
            prevAprilAbs !== null &&
            prevAprilAbs > SMALL_EPSILON &&
            absFlux >= APRIL_TAX_SPIKE_MULT * prevAprilAbs &&
            absFlux >= APRIL_TAX_SPIKE_MIN_CAD;
        const signChanged = prevAprilSign !== 0 && sign !== prevAprilSign;
        const isNotRoutineRepeat =
            prevAprilAbs === null ||
            absFlux >= APRIL_TAX_REPEAT_GROWTH_MIN * prevAprilAbs ||
            signChanged;

        if (
            (isSpike || (isMaterial && isNotRoutineRepeat)) &&
            p.monthIndex - lastAprilTaxMonth >= COOLDOWN_MONTHS
        ) {
            return {
                category: 'evenement',
                priority: 25,
                titleFr: fluxImpots < 0 ? 'Remboursement fiscal annuel (avril)' : 'Régularisation fiscale annuelle',
                eventSubtype: 'impot_avril',
                rationaleFr: rationaleForEvent('impot_avril'),
            };
        }
    }

    return null;
}

function liquidFinancialTotal(p: ProjectionChartPoint): number | null {
    return sumFiniteOrNull([p.CELI, p.REER, p.NonReg, p.Crypto, p.CELIAPP, p.Liquidites]);
}

function mergeRationales(signals: ReadonlyArray<CandidateSignal>): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const s of signals) {
        for (const line of s.rationaleFr) {
            if (!seen.has(line)) {
                seen.add(line);
                out.push(line);
            }
        }
    }
    return out;
}

interface BuiltExplanationEntry {
    explanation: CurveInflectionExplanation;
    signal: CandidateSignal;
}

function buildCurveExplanationEntries(
    chartData: ProjectionChartPoint[] | undefined | null,
    grandCalcul?: GrandCalculResult | null,
): BuiltExplanationEntry[] {
    const future = preprocessFuturePoints(chartData);
    if (future.length === 0) return [];

    const bands = buildBandsIndex(grandCalcul);
    const first = future[0];
    const firstAge = resolveYearAndAge(first, bands).ageOrNull;
    const firstFlowList = Array.isArray(first.flowEvents) ? first.flowEvents : [];
    const firstHasUncoveredDeficitLog = firstFlowList.some(
        (msg) => msg.includes('comptes de décaissement épuisés') || msg.includes('Découvert NON couvert'),
    );

    let retiredStarted = first.isRetired === true;
    let rrqStarted = isPositiveFinite(first.pensionRRQ);
    let psvStarted = isPositiveFinite(first.pensionPSV);
    let priveeStarted = isPositiveFinite(first.pensionPrivee);
    let psvBonusDone =
        firstAge !== null &&
        firstAge >= PSV_BONUS_AGE &&
        isPositiveFinite(first.pensionPSV);
    let clawbackActive = (computeOasClawback(first) ?? 0) > OAS_CLAWBACK_ONSET_CAD;
    let rrifConvDone =
        firstAge !== null &&
        firstAge >= RRSP_TO_RRIF_CONVERSION_AGE;
    let ferrStarted =
        (firstAge !== null && firstAge >= RRIF_FIRST_WITHDRAWAL_AGE) ||
        (firstAge === null &&
            ((finiteOrNull(first.WithheldTaxRrif) ?? 0) > 0 || hasNonZeroFerrLog(firstFlowList)));
    let spouseFerrStarted =
        firstAge !== null &&
        firstAge < RRIF_FIRST_WITHDRAWAL_AGE &&
        ((finiteOrNull(first.WithheldTaxRrif) ?? 0) > 0 || hasNonZeroFerrLog(firstFlowList));
    let ferrPlateauDone =
        firstAge !== null &&
        firstAge >= RRIF_PLATEAU_AGE;
    let fireDone = isFireReached(first);

    let lastClawbackEmitMonth = clawbackActive ? first.monthIndex : -COOLDOWN_MONTHS;
    let lastEpuisementMonth = -COOLDOWN_MONTHS;
    let lastAccumJumpMonth = -COOLDOWN_MONTHS;
    let lastAprilTaxMonth = -COOLDOWN_MONTHS;
    let lastImmoGeneralMonth = -COOLDOWN_MONTHS;
    let prevAprilAbs: number | null = null;
    let prevAprilSign = 0;

    let deficitActive = (finiteOrNull(first.LiquidDebt) ?? 0) > 1 || firstHasUncoveredDeficitLog;
    let netWorthPositiveEver = first.NetWorth > 0;
    let netWorthDepletedEmitted = first.NetWorth <= 0;
    const firstFinAssets = liquidFinancialTotal(first);
    let everHadSignificantFinancialAssets =
        firstFinAssets !== null && firstFinAssets > LIQUID_ASSETS_PRIOR_MIN;
    let financialAssetsDepletedEmitted =
        firstFinAssets !== null && firstFinAssets <= LIQUID_ASSETS_DEPLETED_THRESHOLD;

    const signedDiffHistory: number[] = [];
    const entries: BuiltExplanationEntry[] = [];

    for (let i = 0; i < future.length; i++) {
        const p = future[i];
        const prev = i > 0 ? future[i - 1] : undefined;
        const isFinalPoint = i === future.length - 1;
        const { year, age, ageOrNull } = resolveYearAndAge(p, bands);
        const candidates: CandidateSignal[] = [];

        const currLiquidDebt = (finiteOrNull(p.LiquidDebt) ?? 0) > 1;
        const flowList = Array.isArray(p.flowEvents) ? p.flowEvents : [];
        const lifeList = Array.isArray(p.lifeEvents) ? p.lifeEvents : [];
        const hasUncoveredDeficitLog = flowList.some(
            (msg) => msg.includes('comptes de décaissement épuisés') || msg.includes('Découvert NON couvert'),
        );
        const currDeficitState = currLiquidDebt || hasUncoveredDeficitLog;
        const currFinAssets = liquidFinancialTotal(p);

        // 1. Épuisement (transitions d'état réelles sans répétition en régime permanent)
        if (i === 0 && (currDeficitState || p.NetWorth < 0)) {
            lastEpuisementMonth = p.monthIndex;
            candidates.push({
                category: 'epuisement',
                priority: 95,
                titleFr: currLiquidDebt ? 'Découvert de liquidités initial' : 'Patrimoine net négatif',
                epuisementSubtype: currLiquidDebt ? 'decouvert' : 'patrimoine_nul',
                rationaleFr: rationaleForEpuisement(),
            });
        } else if (i > 0) {
            if (!currDeficitState) {
                deficitActive = false;
            }
            if (p.NetWorth > 0) {
                netWorthPositiveEver = true;
                netWorthDepletedEmitted = false;
            }
            if (currFinAssets !== null && currFinAssets > LIQUID_ASSETS_PRIOR_MIN) {
                everHadSignificantFinancialAssets = true;
                financialAssetsDepletedEmitted = false;
            }

            if (p.monthIndex - lastEpuisementMonth >= COOLDOWN_MONTHS) {
                if (!deficitActive && currDeficitState) {
                    candidates.push({
                        category: 'epuisement',
                        priority: 95,
                        titleFr: 'Épuisement des liquidités',
                        epuisementSubtype: 'decouvert',
                        rationaleFr: rationaleForEpuisement(),
                    });
                } else if (netWorthPositiveEver && !netWorthDepletedEmitted && p.NetWorth <= 0) {
                    candidates.push({
                        category: 'epuisement',
                        priority: 95,
                        titleFr: 'Épuisement du patrimoine net',
                        epuisementSubtype: 'patrimoine_nul',
                        rationaleFr: rationaleForEpuisement(),
                    });
                } else if (
                    everHadSignificantFinancialAssets &&
                    !financialAssetsDepletedEmitted &&
                    currFinAssets !== null &&
                    currFinAssets <= LIQUID_ASSETS_DEPLETED_THRESHOLD
                ) {
                    candidates.push({
                        category: 'epuisement',
                        priority: 90,
                        titleFr: 'Épuisement des placements liquides',
                        epuisementSubtype: 'actifs_epuises',
                        rationaleFr: rationaleForEpuisement(),
                    });
                }
            }
        }

        // 2. Retraite
        const hasRetirementEvent = lifeList.some((msg) => msg === '📍 Début Retraite');
        if (i === 0 && retiredStarted) {
            candidates.push({
                category: 'retraite',
                priority: 85,
                titleFr: 'Phase de retraite active',
                isAlreadyRetired: true,
                rationaleFr: rationaleForRetraite(ageOrNull),
            });
        } else if (i > 0 && !retiredStarted && (p.isRetired === true || hasRetirementEvent)) {
            retiredStarted = true;
            candidates.push({
                category: 'retraite',
                priority: 85,
                titleFr: 'Passage à la retraite',
                rationaleFr: rationaleForRetraite(ageOrNull),
            });
        }

        // 3. Objectif (FIRE structurel via isFireReached + jalons 🏆)
        if (!fireDone && isFireReached(p)) {
            fireDone = true;
            candidates.push({
                category: 'objectif',
                priority: 80,
                titleFr: 'Indépendance financière (FIRE) atteinte',
                objectifSubtype: 'fire',
                rationaleFr: rationaleForObjectif('fire'),
            });
        } else {
            const goalMsg = flowList.find(
                (msg) => msg.startsWith('🏆 Jalon patrimoine') || msg.startsWith('🏆 But financier'),
            );
            if (goalMsg) {
                candidates.push({
                    category: 'objectif',
                    priority: 75,
                    titleFr: 'Échéance d’objectif financier',
                    objectifSubtype: 'jalon',
                    goalMatchName: extractGoalNameFromFlowEvent(goalMsg),
                    rationaleFr: rationaleForObjectif('jalon'),
                });
            }
        }

        // 4. FERR (conversion 71, 1er retrait 72, conjoint à écart d'âge, plateau 95)
        if (i > 0) {
            const reerBal = finiteOrNull(p.REER);
            const nonZeroFerrLog = hasNonZeroFerrLog(flowList);
            const withheldRrif = (finiteOrNull(p.WithheldTaxRrif) ?? 0) > 0;
            const retraitReer = (finiteOrNull(p.RetraitREER) ?? 0) > 0;
            const hasFerrEvidence = (reerBal !== null && reerBal > 0) || retraitReer || withheldRrif;
            const isJanOrSynthetic = isJanuaryDateLabel(p.dateLabel);

            if (
                !spouseFerrStarted &&
                ageOrNull !== null &&
                ageOrNull < RRIF_FIRST_WITHDRAWAL_AGE &&
                (withheldRrif || (nonZeroFerrLog && hasFerrEvidence))
            ) {
                spouseFerrStarted = true;
                candidates.push({
                    category: 'ferr',
                    priority: 71,
                    titleFr: 'Retrait minimum FERR du conjoint',
                    ferrSubtype: 'conjoint_72',
                    rationaleFr: rationaleForFerr('retrait_72'),
                });
            } else if (
                !ferrStarted &&
                hasFerrEvidence &&
                ((ageOrNull !== null &&
                    ageOrNull >= RRIF_FIRST_WITHDRAWAL_AGE &&
                    (isJanOrSynthetic || withheldRrif || nonZeroFerrLog)) ||
                    (ageOrNull === null && (withheldRrif || nonZeroFerrLog)))
            ) {
                ferrStarted = true;
                rrifConvDone = true;
                candidates.push({
                    category: 'ferr',
                    priority: 72,
                    titleFr: 'Premier retrait minimum FERR obligatoire',
                    ferrSubtype: 'retrait_72',
                    rationaleFr: rationaleForFerr('retrait_72'),
                });
            } else if (
                !rrifConvDone &&
                ageOrNull !== null &&
                ageOrNull >= RRSP_TO_RRIF_CONVERSION_AGE &&
                ageOrNull < RRIF_FIRST_WITHDRAWAL_AGE &&
                reerBal !== null &&
                reerBal > 0
            ) {
                rrifConvDone = true;
                candidates.push({
                    category: 'ferr',
                    priority: 70,
                    titleFr: 'Conversion obligatoire REER vers FERR',
                    ferrSubtype: 'conversion_71',
                    rationaleFr: rationaleForFerr('conversion_71'),
                });
            } else if (
                !ferrPlateauDone &&
                ageOrNull !== null &&
                ageOrNull >= RRIF_PLATEAU_AGE &&
                ((reerBal ?? 0) > 0 || retraitReer)
            ) {
                ferrPlateauDone = true;
                candidates.push({
                    category: 'ferr',
                    priority: 68,
                    titleFr: 'Plafond du taux de retrait FERR',
                    ferrSubtype: 'plateau_95',
                    rationaleFr: rationaleForFerr('plateau_95'),
                });
            }
        }

        // 5. Pensions (RRQ, PSV, Privée, PSV 75+, Clawback PSV sur transition uniquement)
        if (i > 0) {
            const clawback = computeOasClawback(p);
            if (!rrqStarted && isPositiveFinite(p.pensionRRQ)) {
                rrqStarted = true;
                candidates.push({
                    category: 'pension',
                    priority: 64,
                    titleFr: 'Début de la rente RRQ',
                    pensionSubtype: 'rrq',
                    rationaleFr: rationaleForPension('rrq'),
                });
            }
            if (!psvStarted && isPositiveFinite(p.pensionPSV)) {
                psvStarted = true;
                candidates.push({
                    category: 'pension',
                    priority: 63,
                    titleFr: 'Début de la PSV',
                    pensionSubtype: 'psv',
                    rationaleFr: rationaleForPension('psv'),
                });
            }
            if (!priveeStarted && isPositiveFinite(p.pensionPrivee)) {
                priveeStarted = true;
                candidates.push({
                    category: 'pension',
                    priority: 62,
                    titleFr: 'Début de la rente privée',
                    pensionSubtype: 'privee',
                    rationaleFr: rationaleForPension('privee'),
                });
            }
            if (
                !psvBonusDone &&
                ageOrNull !== null &&
                ageOrNull >= PSV_BONUS_AGE &&
                isPositiveFinite(p.pensionPSV)
            ) {
                psvBonusDone = true;
                candidates.push({
                    category: 'pension',
                    priority: 61,
                    titleFr: `Bonification PSV à ${PSV_BONUS_AGE} ans`,
                    pensionSubtype: 'psv_bonus',
                    rationaleFr: rationaleForPension('psv_bonus'),
                });
            }
            if (clawback !== null && clawback <= OAS_CLAWBACK_ONSET_CAD) {
                clawbackActive = false;
            } else if (
                clawback !== null &&
                clawback > OAS_CLAWBACK_ONSET_CAD &&
                !clawbackActive &&
                p.monthIndex - lastClawbackEmitMonth >= COOLDOWN_MONTHS
            ) {
                candidates.push({
                    category: 'pension',
                    priority: 60,
                    titleFr: 'Récupération de la PSV déclenchée',
                    pensionSubtype: 'clawback',
                    rationaleFr: rationaleForPension('clawback'),
                });
            }
        }

        // 6. Événements majeurs
        if (i > 0) {
            const eventCandidate = detectEngineEventSignal(
                p,
                prev,
                lastAprilTaxMonth,
                prevAprilAbs,
                prevAprilSign,
                lastImmoGeneralMonth,
            );
            if (eventCandidate) {
                candidates.push(eventCandidate);
            }
        }

        // 7. Accumulation (départ actif, extinction de dette, changement de palier soutenu)
        if (i === 0 && !retiredStarted && !(currDeficitState || p.NetWorth < 0)) {
            candidates.push({
                category: 'accumulation',
                priority: 20,
                titleFr: 'Phase d’accumulation initiale',
                accumulationSubtype: 'depart',
                rationaleFr: rationaleForAccumulation(),
            });
        } else if (i > 0) {
            const prevDebt = prev ? finiteOrNull(prev.DetteTotale) : null;
            const currDebt = finiteOrNull(p.DetteTotale);
            const mortgagePaidOff = lifeList.some(
                (msg) =>
                    msg.startsWith('🏠 Hypothèque remboursée') ||
                    msg.startsWith('🏘️ Hypothèque remboursée'),
            );
            const debtCleared =
                (prevDebt !== null &&
                    currDebt !== null &&
                    prevDebt > DEBT_HIGH_THRESHOLD &&
                    currDebt <= DEBT_CLEARED_THRESHOLD) ||
                mortgagePaidOff;

            if (debtCleared) {
                candidates.push({
                    category: 'accumulation',
                    priority: 50,
                    titleFr: 'Extinction des dettes',
                    accumulationSubtype: 'extinction_dette',
                    rationaleFr: rationaleForAccumulation(),
                });
            } else if (p.isRetired === false) {
                const diffNW = finiteOrNull(p.diffNW);
                if (
                    diffNW !== null &&
                    signedDiffHistory.length >= ACCUMULATION_TRAILING_WINDOW - 1 + ACCUMULATION_PRIOR_MIN &&
                    p.monthIndex - lastAccumJumpMonth >= COOLDOWN_MONTHS
                ) {
                    const trailingSlice = [
                        ...signedDiffHistory.slice(-(ACCUMULATION_TRAILING_WINDOW - 1)),
                        diffNW,
                    ];
                    const priorSlice = signedDiffHistory.slice(
                        -(ACCUMULATION_TRAILING_WINDOW - 1 + ACCUMULATION_PRIOR_MAX),
                        -(ACCUMULATION_TRAILING_WINDOW - 1),
                    );
                    const trailingMed = medianOf(trailingSlice);
                    const priorMed = medianOf(priorSlice);
                    if (
                        trailingMed >= ACCUMULATION_JUMP_MIN_CAD &&
                        priorMed > 0 &&
                        trailingMed >= ACCUMULATION_JUMP_MULT * priorMed
                    ) {
                        candidates.push({
                            category: 'accumulation',
                            priority: 15,
                            titleFr: 'Accélération de l’accumulation',
                            accumulationSubtype: 'acceleration',
                            rationaleFr: rationaleForAccumulation(),
                        });
                    }
                }
            }
        }

        const diffNow = finiteOrNull(p.diffNW);
        if (diffNow !== null) {
            signedDiffHistory.push(diffNow);
            const maxHistory = ACCUMULATION_TRAILING_WINDOW - 1 + ACCUMULATION_PRIOR_MAX;
            if (signedDiffHistory.length > maxHistory) {
                signedDiffHistory.shift();
            }
        }

        const fluxImpotsNow = finiteOrNull(p.FluxImpots);
        if (i > 0 && fluxImpotsNow !== null && Math.abs(fluxImpotsNow) > SMALL_EPSILON) {
            prevAprilAbs = Math.abs(fluxImpotsNow);
            prevAprilSign = fluxImpotsNow > 0 ? 1 : -1;
        }

        // 8. Succession au dernier point (jamais sur une courbe à 1 point à monthIndex: 0)
        const shouldEmitSuccession = isFinalPoint && future.length > 1;
        if (shouldEmitSuccession) {
            candidates.push({
                category: 'succession',
                priority: future.length >= 3 ? 88 : 45,
                titleFr: 'Bilan terminal et impôt successoral',
                rationaleFr: rationaleForSuccession(grandCalcul),
            });
        }

        if (candidates.length === 0) continue;

        candidates.sort((a, b) => b.priority - a.priority);
        const primary = candidates[0];

        if (primary.category === 'epuisement') {
            lastEpuisementMonth = p.monthIndex;
            if (currDeficitState) deficitActive = true;
            if (p.NetWorth <= 0) netWorthDepletedEmitted = true;
            if (currFinAssets !== null && currFinAssets <= LIQUID_ASSETS_DEPLETED_THRESHOLD) {
                financialAssetsDepletedEmitted = true;
            }
        } else if (primary.category === 'pension' && primary.pensionSubtype === 'clawback') {
            clawbackActive = true;
            lastClawbackEmitMonth = p.monthIndex;
        } else if (primary.category === 'evenement' && primary.eventSubtype === 'impot_avril') {
            lastAprilTaxMonth = p.monthIndex;
        } else if (primary.category === 'evenement' && primary.eventSubtype === 'immo_general') {
            lastImmoGeneralMonth = p.monthIndex;
        } else if (primary.category === 'accumulation' && primary.accumulationSubtype === 'acceleration') {
            lastAccumJumpMonth = p.monthIndex;
        }

        const mergedRationales = mergeRationales(candidates);
        const isSuccession = primary.category === 'succession';
        const breakdown = computeBreakdown(p, mergedRationales, isSuccession, grandCalcul, ageOrNull);

        entries.push({
            signal: primary,
            explanation: {
                id: `${primary.category}-${p.monthIndex}`,
                monthIndex: p.monthIndex,
                year,
                age,
                category: primary.category,
                titleFr: primary.titleFr,
                level1Segments: buildLevel1ForSignal(primary, p, breakdown, ageOrNull, grandCalcul),
                level2: breakdown,
            },
        });
    }

    return entries;
}

export function buildCurveExplanations(
    chartData: ProjectionChartPoint[] | undefined | null,
    grandCalcul?: GrandCalculResult | null,
): CurveInflectionExplanation[] {
    return buildCurveExplanationEntries(chartData, grandCalcul).map((entry) => entry.explanation);
}

function buildSynthesizedPointExplanation(
    p: ProjectionChartPoint,
    grandCalcul?: GrandCalculResult | null,
): CurveInflectionExplanation {
    const bands = buildBandsIndex(grandCalcul);
    const { year, age, ageOrNull } = resolveYearAndAge(p, bands);
    const ageSegs = ageClauseSegments(ageOrNull);

    const liquidDebt = finiteOrNull(p.LiquidDebt);
    const isDepleted = (liquidDebt !== null && liquidDebt > 1) || p.NetWorth <= 0;
    const isRetired = p.isRetired === true;

    const category: Category = isDepleted
        ? 'epuisement'
        : isRetired
          ? 'retraite'
          : 'accumulation';

    const titleFr =
        category === 'epuisement'
            ? 'Tension de liquidités'
            : category === 'retraite'
              ? 'Phase de décaissement (retraite)'
              : 'Phase d’accumulation';

    const rationaleFr =
        category === 'epuisement'
            ? rationaleForEpuisement()
            : category === 'retraite'
              ? rationaleForRetraite(ageOrNull)
              : rationaleForAccumulation();

    const breakdown = computeBreakdown(p, rationaleFr, false, grandCalcul, ageOrNull);

    let level1Segments: ExplanationSegment[];
    if (category === 'epuisement') {
        level1Segments =
            liquidDebt !== null && liquidDebt > 1
                ? [
                      { kind: 'text', text: 'Les liquidités disponibles ne suffisent plus' },
                      ...ageSegs,
                      { kind: 'text', text: ', laissant une dette de liquidités de ' },
                      { kind: 'cad', value: liquidDebt },
                      { kind: 'text', text: '.' },
                  ]
                : [
                      { kind: 'text', text: 'Votre patrimoine net s’établit à ' },
                      { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                      ...ageSegs,
                      { kind: 'text', text: ' sous l’effet des décaissements.' },
                  ];
    } else if (category === 'retraite') {
        const pensions = breakdown.decaissementFlows.pensionsGross;
        const withdrawals = breakdown.decaissementFlows.withdrawalsTotal;
        const expenses = breakdown.decaissementFlows.livingExpenses;
        level1Segments =
            pensions !== null && withdrawals !== null && expenses !== null
                ? [
                      { kind: 'text', text: 'En phase de retraite' },
                      ...ageSegs,
                      { kind: 'text', text: ', vos rentes (' },
                      { kind: 'cad', value: pensions },
                      { kind: 'text', text: ') et retraits (' },
                      { kind: 'cad', value: withdrawals },
                      { kind: 'text', text: ') financent ' },
                      { kind: 'cad', value: expenses },
                      { kind: 'text', text: ' de dépenses mensuelles.' },
                  ]
                : [
                      { kind: 'text', text: 'En phase de retraite' },
                      ...ageSegs,
                      { kind: 'text', text: ', votre patrimoine net projeté s’élève à ' },
                      { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                      { kind: 'text', text: '.' },
                  ];
    } else {
        const contribs = breakdown.accumulationFlows.contributionsTotal;
        const growth = breakdown.accumulationFlows.investmentGrowth;
        level1Segments =
            contribs !== null && growth !== null
                ? [
                      { kind: 'text', text: 'En phase d’accumulation' },
                      ...ageSegs,
                      { kind: 'text', text: ', vous investissez ' },
                      { kind: 'cad', value: contribs },
                      { kind: 'text', text: ' avec ' },
                      { kind: 'cad', value: growth },
                      { kind: 'text', text: ' de rendement mensuel pour un patrimoine net de ' },
                      { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                      { kind: 'text', text: '.' },
                  ]
                : [
                      { kind: 'text', text: 'Votre patrimoine net projeté atteint ' },
                      { kind: 'cad', value: finiteOrNull(p.NetWorth) },
                      ...ageSegs,
                      { kind: 'text', text: ' à ce mois.' },
                  ];
    }

    return {
        id: `point-${category}-${p.monthIndex}`,
        monthIndex: p.monthIndex,
        year,
        age,
        category,
        titleFr,
        level1Segments,
        level2: breakdown,
    };
}

export function explainPointAtMonth(
    chartData: ProjectionChartPoint[] | undefined | null,
    monthIndex: number,
    grandCalcul?: GrandCalculResult | null,
): CurveInflectionExplanation | null {
    if (!chartData || !Array.isArray(chartData) || chartData.length === 0) return null;
    if (typeof monthIndex !== 'number' || !Number.isFinite(monthIndex) || monthIndex < 0) {
        return null;
    }

    const future = preprocessFuturePoints(chartData);
    if (future.length === 0) return null;

    const entries = buildCurveExplanationEntries(chartData, grandCalcul);

    // 1. Requête entière : toujours utiliser le point mensuel canonique (ou agrégé quotidien)
    if (Number.isInteger(monthIndex)) {
        const canonicalPoint = future.find((pt) => pt.monthIndex === monthIndex);
        if (!canonicalPoint) return null;

        const matchingEntry = entries.find((entry) => entry.explanation.monthIndex === monthIndex);
        if (matchingEntry) {
            return matchingEntry.explanation;
        }
        return buildSynthesizedPointExplanation(canonicalPoint, grandCalcul);
    }

    // 2. Requête fractionnaire : rechercher le point quotidien/fractionnaire exact (dernier si doublons)
    let rawExact: ProjectionChartPoint | undefined;
    for (const raw of chartData) {
        if (
            raw != null &&
            typeof raw.monthIndex === 'number' &&
            Number.isFinite(raw.monthIndex) &&
            raw.monthIndex === monthIndex &&
            raw.monthIndex >= 0 &&
            raw.dayIsReal !== true &&
            typeof raw.NetWorth === 'number' &&
            Number.isFinite(raw.NetWorth)
        ) {
            rawExact = raw;
        }
    }

    if (!rawExact) return null;

    const targetMonthKey = normalizeMonthKey(rawExact);
    const matchingEntry = entries.find((entry) => entry.explanation.monthIndex === targetMonthKey);
    if (matchingEntry) {
        const bands = buildBandsIndex(grandCalcul);
        const { year, age, ageOrNull } = resolveYearAndAge(rawExact, bands);
        const isSucc = matchingEntry.signal.category === 'succession';
        const breakdown = computeBreakdown(
            rawExact,
            matchingEntry.explanation.level2.fiscalDetails.rationaleFr,
            isSucc,
            grandCalcul,
            ageOrNull,
        );
        return {
            ...matchingEntry.explanation,
            monthIndex: rawExact.monthIndex,
            year: Number.isFinite(year) ? year : matchingEntry.explanation.year,
            age: Number.isFinite(age) ? age : matchingEntry.explanation.age,
            level1Segments: buildLevel1ForSignal(
                matchingEntry.signal,
                rawExact,
                breakdown,
                ageOrNull,
                grandCalcul,
            ),
            level2: breakdown,
        };
    }

    return buildSynthesizedPointExplanation(rawExact, grandCalcul);
}
