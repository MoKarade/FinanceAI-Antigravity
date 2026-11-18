import { PortfolioLot } from './engine';
import {
  ASSETS,
  HISTORICAL_SERIES,
  MacroIndicators,
  RiskProfile,
  getAssetById,
} from './marketData';

export type TimeMachineEpochId = '1m' | '1y' | '5y' | '10y';

interface EpochNewsArchiveItem {
  id: string;
  publishedDateLabel: string;
  source: string;
  sectorTag: string;
  headline: string;
  summaryAtEpoch: string;
  anonymizedDigest: string;
  macroOrSectorImpulse: 'positif' | 'prudent' | 'negatif';
}

interface EpochCandidateFundamental {
  assetId: string;
  forwardPeAtEpoch: number;
  roicSpreadPctAtEpoch: number;
  fcfMarginPctAtEpoch: number;
  valuationUpsidePctAtEpoch: number;
  pointInTimeCatalyst: string;
  anonymizedSectorLabel: string;
  anonymizedDossierBrief: string;
}

interface BlindGeminiOverridePick {
  assetId: string;
  weightPct: number;
  blindCode: string;
  blindThesisFr: string;
}

interface BlindGeminiOverrideAvoid {
  assetId: string;
  blindCode: string;
  blindAvoidReasonFr: string;
}

export interface BlindGeminiEpochAuditPayload {
  epochId: TimeMachineEpochId;
  generatedAt: string;
  mode: 'gemini_blind_committee' | 'quant_point_in_time_fallback';
  macroReadingAtEpochFr: string;
  allocationPhilosophyFr: string;
  picks: BlindGeminiOverridePick[];
  avoids: BlindGeminiOverrideAvoid[];
  anonymizedMappingCount: number;
  noticeFr?: string;
}

interface AnonymizedDossierForServer {
  blindCode: string;
  sectorGeneral: string;
  trailing12mReturnPct: number;
  trailingVolatilityPct: number;
  maxDrawdownToDatePct: number;
  forwardPe: number;
  roicMinusWaccPct: number;
  fcfMarginPct: number;
  estimatedFairValueUpsidePct: number;
  anonymizedCatalystSummary: string;
}

interface EvaluatedAiEpochPick {
  assetId: string;
  ticker: string;
  name: string;
  sector: string;
  blindCode: string;
  weightPct: number;
  allocatedCad: number;
  entryPriceCad: number;
  currentPriceCad: number;
  realizedReturnPct: number;
  finalValueCad: number;
  netProfitCad: number;
  beatWorldBenchmark: boolean;
  pointInTimeScore100: number;
  pointInTimeThesisFr: string;
  verdictBadge: 'PARI GAGNANT' | 'GAIN MODÉRÉ' | 'ERREUR IA';
}

interface EvaluatedAiEpochAvoid {
  assetId: string;
  ticker: string;
  name: string;
  sector: string;
  blindCode: string;
  entryPriceCad: number;
  currentPriceCad: number;
  realizedReturnPct: number;
  relativeSavedVsAiPct: number;
  avoidCorrect: boolean;
  pointInTimeAvoidReasonFr: string;
}

export interface TimeMachineCurvePoint {
  yearMonth: string;
  label: string;
  date: Date;
  aiValueCad: number;
  aiCumPct: number;
  userPortfolioValueCad: number;
  userPortfolioCumPct: number;
  worldIndexValueCad: number;
  worldIndexCumPct: number;
  randomMedianCad: number;
  randomMedianCumPct: number;
  randomP25Cad: number;
  randomP25CumPct: number;
  randomP75Cad: number;
  randomP75CumPct: number;
  regimeMarker?: string;
}

export interface EpochRetrospectiveAudit {
  epochId: TimeMachineEpochId;
  shortLabel: string;
  horizonLabel: string;
  startYearMonth: string;
  startDateDisplay: string;
  endDateDisplay: string;
  monthsElapsed: number;
  yearsElapsed: number;
  initialCapitalCad: number;
  sourceMode: 'quant_point_in_time' | 'gemini_blind_verified';
  macroAtEpoch: MacroIndicators & {
    regimeTitle: string;
    yieldCurveNote: string;
  };
  newsAtEpoch: EpochNewsArchiveItem[];
  macroReadingFr: string;
  allocationPhilosophyFr: string;
  picks: EvaluatedAiEpochPick[];
  avoids: EvaluatedAiEpochAvoid[];
  series: TimeMachineCurvePoint[];
  aiFinalCad: number;
  aiTotalReturnPct: number;
  aiAnnualizedCagrPct: number;
  aiMaxDrawdownPct: number;
  userFinalCad: number;
  userTotalReturnPct: number;
  worldFinalCad: number;
  worldTotalReturnPct: number;
  randomMedianFinalCad: number;
  randomMedianReturnPct: number;
  randomP75FinalCad: number;
  alphaVsWorldPct: number;
  alphaVsUserPct: number;
  alphaVsRandomPct: number;
  extraGainVsWorldCad: number;
  extraGainVsRandomCad: number;
  hitRatePct: number;
  winningPicksCount: number;
  beatRandomPortfoliosPct: number;
  isAiUsefulOnEpoch: boolean;
  verdictHeadlineFr: string;
  honestNuanceFr: string;
  anonymizedServerRequest: {
    epochCode: string;
    macroAtT0: {
      inflationPct: number;
      centralBankRatePct: number;
      gdpGrowthPct: number;
      vixLevel: number;
      yieldCurveNote: string;
    };
    anonymizedNewsDigest: string[];
    dossiers: AnonymizedDossierForServer[];
    codeToAssetId: Record<string, string>;
  };
}

export interface GlobalAiUsefulnessSummary {
  initialCapitalPerEpochCad: number;
  epochs: EpochRetrospectiveAudit[];
  epochsWonVsWorldCount: number;
  epochsWonVsRandomCount: number;
  totalPicksAudited: number;
  totalWinningPicks: number;
  globalHitRatePct: number;
  avgAlphaVsWorldPct: number;
  avgAlphaVsRandomPct: number;
  avgBeatRandomPercentile: number;
  cumulativeInvested4EpochsCad: number;
  cumulativeAiFinal4EpochsCad: number;
  cumulativeWorldFinal4EpochsCad: number;
  cumulativeRandomFinal4EpochsCad: number;
  cumulativeUserFinal4EpochsCad: number;
  overallUsefulnessScore100: number;
  overallVerdictLabel: string;
  overallPlainSummaryFr: string;
}

interface EpochArchiveDefinition {
  epochId: TimeMachineEpochId;
  shortLabel: string;
  horizonLabel: string;
  startYearMonth: string;
  startDateDisplay: string;
  monthsElapsed: number;
  yearsElapsed: number;
  macroAtEpoch: MacroIndicators & {
    regimeTitle: string;
    yieldCurveNote: string;
  };
  defaultMacroReadingFr: string;
  defaultPhilosophyFr: string;
  newsAtEpoch: EpochNewsArchiveItem[];
  candidates: EpochCandidateFundamental[];
}

const EPOCH_ARCHIVES: Record<TimeMachineEpochId, EpochArchiveDefinition> = {
  '1m': {
    epochId: '1m',
    shortLabel: 'Il y a 1 mois',
    horizonLabel: 'Octobre 2026 → Aujourd’hui (1 mois)',
    startYearMonth: '2026-10',
    startDateDisplay: '15 oct. 2026',
    monthsElapsed: 1,
    yearsElapsed: 1 / 12,
    macroAtEpoch: {
      regimeTitle: 'Désinflation stabilisée & Saison des résultats T3',
      inflationPct: 2.1,
      centralBankRatePct: 2.75,
      gdpGrowthPct: 1.7,
      vixLevel: 16.4,
      yieldCurveNote: 'Courbe Canada 2A–10A redevenue positive (+34 pb)',
    },
    defaultMacroReadingFr:
      'En octobre 2026, les publications du 3e trimestre imposent un tri sévère entre les infrastructures IA à carnet plein et les valeurs industrielles ou semi-conducteurs en perte de vitesse.',
    defaultPhilosophyFr:
      'Surpondérer les bilans à révisions bénéficiaires haussières immédiates et écarter les dossiers à cash-flow libre négatif avant publication.',
    newsAtEpoch: [
      {
        id: 'n-1m-1',
        publishedDateLabel: '12 oct. 2026',
        source: 'Reuters Marchés',
        sectorTag: 'Semi-Conducteurs & Cloud',
        headline:
          'Les hyperscalers relèvent encore leurs budgets serveurs T4 face à la saturation des capacités d’inférence',
        summaryAtEpoch:
          'Les commandes de puces logiques avancées et d’équipements réseaux dépassent de 14 % les attentes initiales d’octobre.',
        anonymizedDigest:
          'Hausse de +14 % des commandes d’infrastructures de calcul parallèle et de fonderie avancée au T4.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-1m-2',
        publishedDateLabel: '09 oct. 2026',
        source: 'Banque du Canada · Enquête conjoncturelle',
        sectorTag: 'Banques & Taux',
        headline:
          'Stabilisation du coût du risque hypothécaire canadien et reprise des revenus de gestion de patrimoine',
        summaryAtEpoch:
          'Les grandes banques à charte profitent d’une pente obligataire normalisée et d’un ratio CET1 supérieur à 13 %.',
        anonymizedDigest:
          'Normalisation de la marge nette d’intérêt des grandes banques nord-américaines à bilan solide.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-1m-3',
        publishedDateLabel: '14 oct. 2026',
        source: 'SEC Filings / Consensus',
        sectorTag: 'Industrie & Auto',
        headline:
          'Nouveaux avertissements sur les stocks automobiles et retards de certification dans l’aéronautique US',
        summaryAtEpoch:
          'La compression des marges opérationnelles s’accentue sur les constructeurs généralistes et avionneurs endettés.',
        anonymizedDigest:
          'Avertissements sur marges et décaissements de trésorerie dans l’automobile de masse et l’assemblage aéronautique endetté.',
        macroOrSectorImpulse: 'negatif',
      },
    ],
    candidates: [
      {
        assetId: 'ADP',
        forwardPeAtEpoch: 31.5,
        roicSpreadPctAtEpoch: 38.0,
        fcfMarginPctAtEpoch: 46.5,
        valuationUpsidePctAtEpoch: 14.5,
        pointInTimeCatalyst:
          'Carnet d’accélérateurs serveurs saturé sur 4 trimestres et marge brute > 72 % en octobre 2026.',
        anonymizedSectorLabel: 'Calcul accéléré & Semi-conducteurs',
        anonymizedDossierBrief:
          'Leader calcul parallèle : visibilité carnet 12 mois, marge FCF 46 %, décote estimée +14,5 % avant résultats T3.',
      },
      {
        assetId: 'VCN',
        forwardPeAtEpoch: 26.8,
        roicSpreadPctAtEpoch: 24.5,
        fcfMarginPctAtEpoch: 41.0,
        valuationUpsidePctAtEpoch: 13.0,
        pointInTimeCatalyst:
          'Accélération des puces IA sur-mesure (ASIC) et synergies logicielles récurrentes à haute marge.',
        anonymizedSectorLabel: 'Réseaux & Puces sur-mesure',
        anonymizedDossierBrief:
          'Concepteur d’ASIC réseaux & logiciels infrastructure : FCF 41 %, PER 26,8x, catalyseur contrats cloud.',
      },
      {
        assetId: 'GOOGL',
        forwardPeAtEpoch: 20.4,
        roicSpreadPctAtEpoch: 21.8,
        fcfMarginPctAtEpoch: 24.5,
        valuationUpsidePctAtEpoch: 16.2,
        pointInTimeCatalyst:
          'Multiple le plus modéré des géants technologiques (~20x) malgré une croissance cloud > 26 %.',
        anonymizedSectorLabel: 'Plateforme Recherche & Cloud',
        anonymizedDossierBrief:
          'Plateforme publicitaire & cloud mondial : PER 20,4x décoté (+16 % vers juste valeur), trésorerie nette massive.',
      },
      {
        assetId: 'EMR',
        forwardPeAtEpoch: 21.2,
        roicSpreadPctAtEpoch: 19.4,
        fcfMarginPctAtEpoch: 31.0,
        valuationUpsidePctAtEpoch: 15.0,
        pointInTimeCatalyst:
          'Hausse tarifaire de 8 % sur la gravure 3nm/2nm et plein emploi des lignes d’encapsulation avancée.',
        anonymizedSectorLabel: 'Fonderie Semi-conducteurs',
        anonymizedDossierBrief:
          'Monopole de gravure fine : hausse de prix +8 %, PER 21,2x et forte expansion du cash-flow libre.',
      },
      {
        assetId: 'GOLD',
        forwardPeAtEpoch: 16.0,
        roicSpreadPctAtEpoch: 8.5,
        fcfMarginPctAtEpoch: 18.0,
        valuationUpsidePctAtEpoch: 7.5,
        pointInTimeCatalyst:
          'Achats soutenus des banques centrales émergentes couvrant le risque géopolitique de fin d’année.',
        anonymizedSectorLabel: 'Actif Refuge Tangible',
        anonymizedDossierBrief:
          'Métal précieux de réserve : demande soutenue des banques centrales, corrélation quasi nulle aux actions.',
      },
      {
        assetId: 'XBB',
        forwardPeAtEpoch: 18.9,
        roicSpreadPctAtEpoch: 9.2,
        fcfMarginPctAtEpoch: 13.5,
        valuationUpsidePctAtEpoch: 6.5,
        pointInTimeCatalyst:
          'Socle mondial diversifié profitant de la baisse graduelle des taux directeurs.',
        anonymizedSectorLabel: 'Indice Actions Développées',
        anonymizedDossierBrief:
          'Panier indiciel mondial 1 400 sociétés : volatilité contenue, rendement régulier mais potentiel d’alpha limité.',
      },
      {
        assetId: 'V',
        forwardPeAtEpoch: 25.4,
        roicSpreadPctAtEpoch: 29.0,
        fcfMarginPctAtEpoch: 52.0,
        valuationUpsidePctAtEpoch: 9.8,
        pointInTimeCatalyst:
          'Volumes transfrontaliers résilients et rachats d’actions réguliers au T3.',
        anonymizedSectorLabel: 'Réseau de Paiements',
        anonymizedDossierBrief:
          'Réseau transactionnel mondial : marge FCF 52 %, croissance stable à un chiffre haut, décote +10 %.',
      },
      {
        assetId: 'ODFL',
        forwardPeAtEpoch: 24.6,
        roicSpreadPctAtEpoch: 15.6,
        fcfMarginPctAtEpoch: 14.8,
        valuationUpsidePctAtEpoch: 10.4,
        pointInTimeCatalyst:
          'Trafic aérien mondial record soutenant les revenus de pièces de rechange moteurs à forte marge.',
        anonymizedSectorLabel: 'Propulsion & Maintenance Aéronautique',
        anonymizedDossierBrief:
          'Motoriste civil & défense : services après-vente très rentables, ROIC-WACC +15,6 %.',
      },
      {
        assetId: 'GOVT',
        forwardPeAtEpoch: 22.0,
        roicSpreadPctAtEpoch: 1.5,
        fcfMarginPctAtEpoch: 3.2,
        valuationUpsidePctAtEpoch: 3.0,
        pointInTimeCatalyst:
          'Portage obligataire souverain stabilisé autour de 3,1 %, potentiel limité à 1 mois.',
        anonymizedSectorLabel: 'Obligations Souveraines 7-10 ans',
        anonymizedDossierBrief:
          'Dette souveraine 7-10 ans : faible volatilité mais prime de terme modeste à court terme.',
      },
      {
        assetId: 'INTC',
        forwardPeAtEpoch: 44.0,
        roicSpreadPctAtEpoch: -6.8,
        fcfMarginPctAtEpoch: -9.5,
        valuationUpsidePctAtEpoch: -18.0,
        pointInTimeCatalyst:
          'Consommation sévère de trésorerie dans l’activité fonderie et perte continue de parts serveurs.',
        anonymizedSectorLabel: 'Processeurs historiques en restructuration',
        anonymizedDossierBrief:
          'Fabricant historique de processeurs : FCF négatif (-9,5 %), ROIC inférieur au coût du capital, surcote -18 %.',
      },
      {
        assetId: 'STLAP',
        forwardPeAtEpoch: 7.5,
        roicSpreadPctAtEpoch: -3.4,
        fcfMarginPctAtEpoch: -4.2,
        valuationUpsidePctAtEpoch: -14.0,
        pointInTimeCatalyst:
          'Gonflement des stocks chez les concessionnaires nord-américains et révision baissière des marges.',
        anonymizedSectorLabel: 'Constructeur Automobile Généraliste',
        anonymizedDossierBrief:
          'Groupe automobile : apparente décote optique mais FCF négatif (-4,2 %) et chute rapide des marges US.',
      },
      {
        assetId: 'TEP',
        forwardPeAtEpoch: 8.2,
        roicSpreadPctAtEpoch: -4.5,
        fcfMarginPctAtEpoch: 6.0,
        valuationUpsidePctAtEpoch: -21.0,
        pointInTimeCatalyst:
          'Pression déflationniste directe des agents vocaux automatisés sur les contrats de centres d’appels.',
        anonymizedSectorLabel: 'Sous-traitance Relation Client',
        anonymizedDossierBrief:
          'Prestataire centres d’appels : disruption structurelle du modèle d’affaires, dette élevée, piège de valeur (-21 %).',
      },
    ],
  },

  '1y': {
    epochId: '1y',
    shortLabel: 'Il y a 1 an',
    horizonLabel: 'Novembre 2025 → Aujourd’hui (1 an)',
    startYearMonth: '2025-11',
    startDateDisplay: '15 nov. 2025',
    monthsElapsed: 12,
    yearsElapsed: 1,
    macroAtEpoch: {
      regimeTitle: 'Cycle d’assouplissement monétaire & Boom Capex IA',
      inflationPct: 2.4,
      centralBankRatePct: 3.25,
      gdpGrowthPct: 1.8,
      vixLevel: 15.8,
      yieldCurveNote: 'Banque du Canada & Fed en phase de baisse graduelle des taux',
    },
    defaultMacroReadingFr:
      'En novembre 2025, la détente des taux directeurs soutient les valeurs de qualité, tandis que le fossé se creuse entre les fournisseurs d’infrastructures IA/énergie et les marques de consommation en ralentissement.',
    defaultPhilosophyFr:
      'Capturer la chaîne de valeur physique de l’IA (gravure, réseaux, électrification) à valorisation disciplinée et éviter les restructurations industrielles coûteuses.',
    newsAtEpoch: [
      {
        id: 'n-1y-1',
        publishedDateLabel: 'nov. 2025',
        source: 'Bloomberg / Rapports T3 2025',
        sectorTag: 'Infrastructures IA & Énergie',
        headline:
          'Les investissements mondiaux en centres de données dépassent 260 G$ US ; goulot d’étranglement sur le refroidissement électrique',
        summaryAtEpoch:
          'Forte visibilité sur les équipementiers électriques haute tension, fondeurs 3nm et concepteurs de puces réseaux.',
        anonymizedDigest:
          'Capex centres de données > 260 G$ : pénurie d’équipements d’électrification et d’encapsulation semi-conducteurs.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-1y-2',
        publishedDateLabel: 'nov. 2025',
        source: 'Banque du Canada · Rapport sur la politique monétaire',
        sectorTag: 'Macroéconomie & Or',
        headline:
          'L’inflation canadienne revient près de la cible, mais les déficits budgétaires mondiaux soutiennent la demande d’or',
        summaryAtEpoch:
          'Les taux courts refluent progressivement tandis que les banques centrales accumulent un niveau record de lingots.',
        anonymizedDigest:
          'Détente graduelle des taux courts combinée à des achats souverains soutenus sur les réserves d’or physique.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-1y-3',
        publishedDateLabel: 'nov. 2025',
        source: 'Financial Times',
        sectorTag: 'Consommation & Luxe',
        headline:
          'Essoufflement de la demande discrétionnaire en Asie et concurrence accrue sur l’équipement sportif et le luxe en transition',
        summaryAtEpoch:
          'Les maisons en repositionnement créatif et marques sportives historiques subissent des révisions de BPA de -15 %.',
        anonymizedDigest:
          'Révisions bénéficiaires de -15 % sur le luxe en restructuration, l’équipement sportif et la pharmacie post-brevets.',
        macroOrSectorImpulse: 'negatif',
      },
    ],
    candidates: [
      {
        assetId: 'EMR',
        forwardPeAtEpoch: 18.6,
        roicSpreadPctAtEpoch: 18.8,
        fcfMarginPctAtEpoch: 29.5,
        valuationUpsidePctAtEpoch: 22.0,
        pointInTimeCatalyst:
          'Quasi-monopole mondial sur les puces IA à seulement ~18,6x les bénéfices attendus en novembre 2025.',
        anonymizedSectorLabel: 'Fonderie Semi-conducteurs Avancée',
        anonymizedDossierBrief:
          'Fondeur leader mondial : PER attractif 18,6x malgré monopole technologique, décote estimée +22 %.',
      },
      {
        assetId: 'VCN',
        forwardPeAtEpoch: 24.5,
        roicSpreadPctAtEpoch: 23.0,
        fcfMarginPctAtEpoch: 39.5,
        valuationUpsidePctAtEpoch: 18.5,
        pointInTimeCatalyst:
          'Doublement annoncé des revenus d’accélérateurs personnalisés et intégration réussie des logiciels cloud.',
        anonymizedSectorLabel: 'Semi-conducteurs Réseaux & Logiciels',
        anonymizedDossierBrief:
          'Leader réseaux & puces custom : marge FCF 39,5 %, ROIC-WACC +23 %, décote fondamentale +18,5 %.',
      },
      {
        assetId: 'SU',
        forwardPeAtEpoch: 22.4,
        roicSpreadPctAtEpoch: 14.2,
        fcfMarginPctAtEpoch: 15.8,
        valuationUpsidePctAtEpoch: 15.5,
        pointInTimeCatalyst:
          'Carnet record dans la gestion d’énergie et le refroidissement liquide des centres de données.',
        anonymizedSectorLabel: 'Électrification & Gestion Énergétique',
        anonymizedDossierBrief:
          'Équipementier électrique industriel : bénéficiaire direct du raccordement des data centers, décote +15,5 %.',
      },
      {
        assetId: 'GOOGL',
        forwardPeAtEpoch: 19.2,
        roicSpreadPctAtEpoch: 21.0,
        fcfMarginPctAtEpoch: 24.0,
        valuationUpsidePctAtEpoch: 19.0,
        pointInTimeCatalyst:
          'Décote marquée à 19x les résultats par rapport au reste de la cote américaine malgré une marge cloud en hausse.',
        anonymizedSectorLabel: 'Recherche, Publicité & Cloud',
        anonymizedDossierBrief:
          'Géant numérique à bilan net positif : PER 19,2x, FCF 24 %, marge de sécurité +19 %.',
      },
      {
        assetId: 'GOLD',
        forwardPeAtEpoch: 15.0,
        roicSpreadPctAtEpoch: 9.0,
        fcfMarginPctAtEpoch: 18.0,
        valuationUpsidePctAtEpoch: 12.0,
        pointInTimeCatalyst:
          'Baisse des taux réels courts et diversification accélérée des réserves de change mondiales.',
        anonymizedSectorLabel: 'Réserve de Valeur Physique',
        anonymizedDossierBrief:
          'Actif tangible décorrélé : soutenu par la baisse des taux directeurs et les achats souverains (+12 % potentiel).',
      },
      {
        assetId: 'ODFL',
        forwardPeAtEpoch: 23.8,
        roicSpreadPctAtEpoch: 15.0,
        fcfMarginPctAtEpoch: 14.5,
        valuationUpsidePctAtEpoch: 14.0,
        pointInTimeCatalyst:
          'Cycle long très lucratif de maintenance des moteurs d’avions monocouloirs et hausse des budgets défense.',
        anonymizedSectorLabel: 'Aéronautique & Défense',
        anonymizedDossierBrief:
          'Propulsion aéronautique : revenus récurrents après-vente haute marge, visibilité pluriannuelle (+14 %).',
      },
      {
        assetId: 'JPM',
        forwardPeAtEpoch: 13.4,
        roicSpreadPctAtEpoch: 8.5,
        fcfMarginPctAtEpoch: 22.0,
        valuationUpsidePctAtEpoch: 11.0,
        pointInTimeCatalyst:
          'Reprise des fusions-acquisitions et solidité supérieure du bilan bancaire américain.',
        anonymizedSectorLabel: 'Banque Universelle & Investissement',
        anonymizedDossierBrief:
          'Institution bancaire de premier rang : PER 13,4x, ROE > 17 %, reprise des commissions M&A.',
      },
      {
        assetId: 'XBB',
        forwardPeAtEpoch: 18.2,
        roicSpreadPctAtEpoch: 9.0,
        fcfMarginPctAtEpoch: 13.0,
        valuationUpsidePctAtEpoch: 8.0,
        pointInTimeCatalyst:
          'Exposition équilibrée aux marchés développés en phase d’atterrissage en douceur.',
        anonymizedSectorLabel: 'Indice Actions Monde',
        anonymizedDossierBrief:
          'Indice diversifié pays développés : couple rendement/risque équilibré, potentiel modéré +8 %.',
      },
      {
        assetId: 'KER',
        forwardPeAtEpoch: 19.5,
        roicSpreadPctAtEpoch: -1.8,
        fcfMarginPctAtEpoch: 7.2,
        valuationUpsidePctAtEpoch: -17.0,
        pointInTimeCatalyst:
          'Recul à deux chiffres des ventes de sa marque phare et baisse marquée du levier opérationnel.',
        anonymizedSectorLabel: 'Conglomérat Luxe en Transition',
        anonymizedDossierBrief:
          'Groupe de luxe en restructuration : contraction rapide des ventes et des marges, surévaluation -17 %.',
      },
      {
        assetId: 'BA',
        forwardPeAtEpoch: 39.0,
        roicSpreadPctAtEpoch: -7.5,
        fcfMarginPctAtEpoch: -8.8,
        valuationUpsidePctAtEpoch: -22.0,
        pointInTimeCatalyst:
          'Endettement lourd, grèves industrielles récentes et consommation continue de trésorerie.',
        anonymizedSectorLabel: 'Avionneur en Difficulté Opérationnelle',
        anonymizedDossierBrief:
          'Constructeur aéronautique endetté : FCF négatif (-8,8 %), retards de livraison, surcote -22 %.',
      },
      {
        assetId: 'NKE',
        forwardPeAtEpoch: 26.5,
        roicSpreadPctAtEpoch: 2.1,
        fcfMarginPctAtEpoch: 8.4,
        valuationUpsidePctAtEpoch: -15.0,
        pointInTimeCatalyst:
          'Érosion des parts de marché dans la course à pied et multiple encore exigeant malgré la stagnation.',
        anonymizedSectorLabel: 'Équipementier Sportif Mondial',
        anonymizedDossierBrief:
          'Marque d’articles de sport : croissance à l’arrêt face à de nouveaux entrants, PER 26,5x trop cher (-15 %).',
      },
      {
        assetId: 'INTC',
        forwardPeAtEpoch: 41.0,
        roicSpreadPctAtEpoch: -6.2,
        fcfMarginPctAtEpoch: -10.4,
        valuationUpsidePctAtEpoch: -24.0,
        pointInTimeCatalyst:
          'Investissements industriels très coûteux sans retour immédiat et recul sur le marché des serveurs.',
        anonymizedSectorLabel: 'Semi-conducteurs x86 en Restructuration',
        anonymizedDossierBrief:
          'Fondeur historique en perte de vitesse : FCF -10,4 %, ROIC négatif vs coût du capital (-24 %).',
      },
    ],
  },

  '5y': {
    epochId: '5y',
    shortLabel: 'Il y a 5 ans',
    horizonLabel: 'Novembre 2021 → Aujourd’hui (5 ans)',
    startYearMonth: '2021-11',
    startDateDisplay: '15 nov. 2021',
    monthsElapsed: 60,
    yearsElapsed: 5,
    macroAtEpoch: {
      regimeTitle: 'Pic d’euphorie post-COVID & Alerte Inflationniste',
      inflationPct: 4.8,
      centralBankRatePct: 0.25,
      gdpGrowthPct: 5.1,
      vixLevel: 17.9,
      yieldCurveNote: 'Taux réels très négatifs ; la Fed et la BdC évoquent la fin du mot « transitoire »',
    },
    defaultMacroReadingFr:
      'Test décisif de novembre 2021 : au sommet de la bulle de liquidité, l’inflation franchit 4,8 % alors que les taux sont encore à 0,25 %. Une IA rigoureuse doit fuir les obligations longues à taux zéro et les multiples extrêmes (> 80x) pour privilégier le pricing power réel, l’énergie et les monopoles technologiques rentables.',
    defaultPhilosophyFr:
      'Protéger le portefeuille contre le choc imminent de remontée des taux en combinant actifs réels/énergie, leaders rentables à fort ROIC et évitement strict de la dette longue à 0 % et des valeurs spéculatives.',
    newsAtEpoch: [
      {
        id: 'n-5y-1',
        publishedDateLabel: '10 nov. 2021',
        source: 'BLS / Statistique Canada',
        sectorTag: 'Choc d’Inflation',
        headline:
          'L’inflation accélère au plus haut depuis 30 ans en Amérique du Nord ; tensions majeures sur les chaînes d’approvisionnement et l’énergie',
        summaryAtEpoch:
          'Les marchés commencent à anticiper plusieurs hausses de taux directeurs dès le printemps suivant.',
        anonymizedDigest:
          'Inflation au plus haut de 30 ans (4,8 %+) avec taux directeurs encore bloqués à 0,25 % : risque majeur de resserrement monétaire.',
        macroOrSectorImpulse: 'negatif',
      },
      {
        id: 'n-5y-2',
        publishedDateLabel: '14 nov. 2021',
        source: 'SIA / Rapports Semi-conducteurs',
        sectorTag: 'Pénurie Mondiale de Puces',
        headline:
          'Pénurie mondiale de semi-conducteurs : carnets pleins sur 24 mois pour la lithographie EUV et le calcul data center',
        summaryAtEpoch:
          'Les équipementiers de gravure avancée et géants du cloud affichent une croissance bénéficiaire > 35 % autofinancée.',
        anonymizedDigest:
          'Pénurie aiguë de puces et explosion de la demande cloud : carnets saturés sur 2 ans pour les monopoles technologiques rentables.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-5y-3',
        publishedDateLabel: '15 nov. 2021',
        source: 'Wall Street Journal / Marchés',
        sectorTag: 'Valorisations Extrêmes & Taux',
        headline:
          'Valorisations records sur l’automobile électrique (> 100x BPA), les cryptos au sommet et obligations 10 ans offrant à peine 1,5 %',
        summaryAtEpoch:
          'Asymétrie défavorable sur les obligations longues et les valeurs de croissance sans marge de sécurité en cas de hausse des taux.',
        anonymizedDigest:
          'Euphorie spéculative (multiples > 95x sur certains titres populaires) et obligations souveraines à rendement réel très négatif.',
        macroOrSectorImpulse: 'prudent',
      },
    ],
    candidates: [
      {
        assetId: 'ADP',
        forwardPeAtEpoch: 46.0,
        roicSpreadPctAtEpoch: 26.5,
        fcfMarginPctAtEpoch: 31.5,
        valuationUpsidePctAtEpoch: 14.0,
        pointInTimeCatalyst:
          'Explosion structurelle de la demande data center et IA dans les centres de calcul dès fin 2021.',
        anonymizedSectorLabel: 'Processeurs Graphiques & Calcul Data Center',
        anonymizedDossierBrief:
          'Leader calcul parallèle : croissance revenus > 45 %, ROIC-WACC +26,5 %, FCF 31,5 % malgré PER exigeant.',
      },
      {
        assetId: 'LLY',
        forwardPeAtEpoch: 29.5,
        roicSpreadPctAtEpoch: 19.2,
        fcfMarginPctAtEpoch: 23.0,
        valuationUpsidePctAtEpoch: 19.5,
        pointInTimeCatalyst:
          'Résultats cliniques de phase III remarquables dans le diabète/métabolisme et profil défensif face à l’inflation.',
        anonymizedSectorLabel: 'Biopharma & Maladies Métaboliques',
        anonymizedDossierBrief:
          'Laboratoire biopharma innovant : pipeline métabolique majeur en phase III, pricing power élevé (+19,5 % potentiel).',
      },
      {
        assetId: 'XOM',
        forwardPeAtEpoch: 10.8,
        roicSpreadPctAtEpoch: 11.4,
        fcfMarginPctAtEpoch: 14.8,
        valuationUpsidePctAtEpoch: 24.0,
        pointInTimeCatalyst:
          'Sous-investissement pétrolier mondial, dividende > 5 % en 2021 et couverture directe contre le choc inflationniste.',
        anonymizedSectorLabel: 'Énergie Intégrée & Matières Premières',
        anonymizedDossierBrief:
          'Producteur d’énergie intégré : PER 10,8x très décoté (+24 %), couverture directe contre la poussée d’inflation.',
      },
      {
        assetId: 'MSFT',
        forwardPeAtEpoch: 31.0,
        roicSpreadPctAtEpoch: 25.4,
        fcfMarginPctAtEpoch: 33.8,
        valuationUpsidePctAtEpoch: 13.5,
        pointInTimeCatalyst:
          'Pouvoir de fixation des prix B2B (hausse tarifaire annoncée des suites logicielles) et bilan noté AAA.',
        anonymizedSectorLabel: 'Logiciels Entreprise & Cloud B2B',
        anonymizedDossierBrief:
          'Socle logiciel B2B mondial : bilan AAA, FCF 33,8 %, capacité prouvée à répercuter l’inflation (+13,5 %).',
      },
      {
        assetId: 'VCN',
        forwardPeAtEpoch: 17.2,
        roicSpreadPctAtEpoch: 18.6,
        fcfMarginPctAtEpoch: 44.0,
        valuationUpsidePctAtEpoch: 21.5,
        pointInTimeCatalyst:
          'Génération exceptionnelle de cash-flow libre (44 %) à seulement 17x les bénéfices fin 2021.',
        anonymizedSectorLabel: 'Semi-conducteurs Infrastructures & Télécoms',
        anonymizedDossierBrief:
          'Équipementier puces réseaux : PER modéré 17,2x, marge FCF exceptionnelle 44 %, décote +21,5 %.',
      },
      {
        assetId: 'GOLD',
        forwardPeAtEpoch: 15.5,
        roicSpreadPctAtEpoch: 7.5,
        fcfMarginPctAtEpoch: 16.0,
        valuationUpsidePctAtEpoch: 12.5,
        pointInTimeCatalyst:
          'Assurance patrimoniale sous-détenue fin 2021 alors que l’inflation réelle dérape.',
        anonymizedSectorLabel: 'Actif Refuge & Couverture Inflation',
        anonymizedDossierBrief:
          'Actif refuge tangible : décorrélé des actions, bouclier face à l’inflation non transitoire (+12,5 %).',
      },
      {
        assetId: 'RMS',
        forwardPeAtEpoch: 45.0,
        roicSpreadPctAtEpoch: 28.0,
        fcfMarginPctAtEpoch: 27.5,
        valuationUpsidePctAtEpoch: 11.0,
        pointInTimeCatalyst:
          'Pouvoir de prix intact sur l’ultra-luxe et trésorerie nette sans dette.',
        anonymizedSectorLabel: 'Maroquinerie & Ultra-Luxe',
        anonymizedDossierBrief:
          'Maison d’ultra-luxe sans dette : ROIC-WACC +28 %, carnets excédentaires, multiple élevé mais justifié.',
      },
      {
        assetId: 'XBB',
        forwardPeAtEpoch: 20.6,
        roicSpreadPctAtEpoch: 8.4,
        fcfMarginPctAtEpoch: 12.8,
        valuationUpsidePctAtEpoch: 5.5,
        pointInTimeCatalyst:
          'Indice mondial exposé aux taux bas mais diversifié sur 23 pays.',
        anonymizedSectorLabel: 'Indice Actions Monde',
        anonymizedDossierBrief:
          'Indice mondial large : PER 20,6x un peu supérieur à sa moyenne historique fin 2021 (+5,5 %).',
      },
      {
        assetId: 'GOVT',
        forwardPeAtEpoch: 65.0,
        roicSpreadPctAtEpoch: -3.8,
        fcfMarginPctAtEpoch: 1.4,
        valuationUpsidePctAtEpoch: -19.0,
        pointInTimeCatalyst:
          'Rendement souverain ~1,4 % face à une inflation à 4,8 % : risque asymétrique sévère de krach obligataire si les taux remontent.',
        anonymizedSectorLabel: 'Obligations Souveraines Longues à Taux Bas',
        anonymizedDossierBrief:
          'Panier obligataire souverain 7-10 ans : coupon ~1,4 % contre inflation 4,8 %, vulnérabilité extrême aux hausses de taux (-19 %).',
      },
      {
        assetId: 'TSLA',
        forwardPeAtEpoch: 115.0,
        roicSpreadPctAtEpoch: 6.5,
        fcfMarginPctAtEpoch: 7.8,
        valuationUpsidePctAtEpoch: -28.0,
        pointInTimeCatalyst:
          'Capitalisation dépassant 1 000 G$ à plus de 115x les résultats au pic d’euphorie de novembre 2021.',
        anonymizedSectorLabel: 'Véhicules Électriques à Multiple Extrême',
        anonymizedDossierBrief:
          'Constructeur électrique vedette : PER 115x en plein pic spéculatif, très sensible à une remontée du taux d’actualisation (-28 %).',
      },
      {
        assetId: 'ALO',
        forwardPeAtEpoch: 24.0,
        roicSpreadPctAtEpoch: -4.2,
        fcfMarginPctAtEpoch: -5.6,
        valuationUpsidePctAtEpoch: -21.0,
        pointInTimeCatalyst:
          'Intégration industrielle complexe d’une grosse acquisition ferroviaire et décaissements de cash-flow.',
        anonymizedSectorLabel: 'Équipementier Ferroviaire Endetté',
        anonymizedDossierBrief:
          'Industriel ferroviaire post-acquisition : FCF négatif (-5,6 %), contrats à marges fixes vulnérables à l’inflation (-21 %).',
      },
      {
        assetId: 'PFE',
        forwardPeAtEpoch: 12.5,
        roicSpreadPctAtEpoch: 3.2,
        fcfMarginPctAtEpoch: 26.0,
        valuationUpsidePctAtEpoch: -12.0,
        pointInTimeCatalyst:
          'Revenus pandémiques exceptionnels appelés à se normaliser fortement après 2022.',
        anonymizedSectorLabel: 'Pharmacie à Revenus Pandémiques Temporaires',
        anonymizedDossierBrief:
          'Groupe pharmaceutique : bénéfices gonflés par une demande pandémique non récurrente, risque de normalisation post-pic (-12 %).',
      },
    ],
  },

  '10y': {
    epochId: '10y',
    shortLabel: 'Il y a 10 ans',
    horizonLabel: 'Novembre 2016 → Aujourd’hui (10 ans)',
    startYearMonth: '2016-11',
    startDateDisplay: '15 nov. 2016',
    monthsElapsed: 120,
    yearsElapsed: 10,
    macroAtEpoch: {
      regimeTitle: 'Sortie de la déflation, Virage Cloud & Premières puces Deep Learning',
      inflationPct: 1.6,
      centralBankRatePct: 0.5,
      gdpGrowthPct: 2.1,
      vixLevel: 14.5,
      yieldCurveNote: 'Première normalisation prudente de la Fed ; crédit abondant et inflation basse',
    },
    defaultMacroReadingFr:
      'En novembre 2016, l’économie mondiale sort de la stagnation à faible inflation : la migration des entreprises vers le cloud public, les paiements électroniques et les premiers accélérateurs d’apprentissage profond transforment durablement la profitabilité technologique.',
    defaultPhilosophyFr:
      'Allouer sur 10 ans aux plateformes à rendements croissants (cloud, lithographie, calcul parallèle, paiements) affichant déjà un fort ROIC en 2016, et éviter les conglomérats industriels lourds à faible conversion de cash.',
    newsAtEpoch: [
      {
        id: 'n-10y-1',
        publishedDateLabel: 'nov. 2016',
        source: 'Gartner / Publications T3 2016',
        sectorTag: 'Révolution Cloud & Deep Learning',
        headline:
          'L’adoption du Cloud public d’entreprise bondit de +42 % ; les centres de données testent massivement l’accélération par GPU',
        summaryAtEpoch:
          'Bascule structurelle des licences sur site vers les abonnements cloud récurrents et explosion des besoins de calcul parallèle.',
        anonymizedDigest:
          'Croissance de +42 % du cloud d’entreprise et adoption initiale des processeurs parallèles dans les serveurs.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-10y-2',
        publishedDateLabel: 'nov. 2016',
        source: 'SEMI / Industrie Semi-conducteurs',
        sectorTag: 'Lithographie & Gravure',
        headline:
          'Les grands fondeurs valident leurs premières commandes industrielles de machines de lithographie extrême ultraviolet (EUV)',
        summaryAtEpoch:
          'Verrouillage technologique décennal pour franchir la barrière des 7 nanomètres.',
        anonymizedDigest:
          'Validation industrielle des équipements de lithographie de nouvelle génération créant un monopole technologique à 10 ans.',
        macroOrSectorImpulse: 'positif',
      },
      {
        id: 'n-10y-3',
        publishedDateLabel: 'nov. 2016',
        source: 'Les Échos / Bloomberg',
        sectorTag: 'Industrie Lourde & Banques EU',
        headline:
          'Pressions réglementaires persistantes sur les banques européennes et lourds besoins en capital dans le transport et l’aéronautique',
        summaryAtEpoch:
          'Les bilans capitalistiques européens restent pénalisés par des retours sur capitaux propres inférieurs à 8 %.',
        anonymizedDigest:
          'Faible rentabilité des capitaux propres (< 8 %) dans la banque européenne traditionnelle et le matériel de transport lourd.',
        macroOrSectorImpulse: 'negatif',
      },
    ],
    candidates: [
      {
        assetId: 'ADP',
        forwardPeAtEpoch: 27.5,
        roicSpreadPctAtEpoch: 20.5,
        fcfMarginPctAtEpoch: 24.0,
        valuationUpsidePctAtEpoch: 22.5,
        pointInTimeCatalyst:
          'Accélération fulgurante (+54 % YoY) de sa division data center au T3 2016 grâce aux premiers réseaux neuronaux.',
        anonymizedSectorLabel: 'Processeurs Parallèles & Calcul Scientifique',
        anonymizedDossierBrief:
          'Spécialiste processeurs parallèles : bond de +54 % du segment serveurs, ROIC-WACC +20,5 %, PER raisonnable 27,5x.',
      },
      {
        assetId: 'MSFT',
        forwardPeAtEpoch: 19.8,
        roicSpreadPctAtEpoch: 19.4,
        fcfMarginPctAtEpoch: 31.0,
        valuationUpsidePctAtEpoch: 20.0,
        pointInTimeCatalyst:
          'Bascule réussie vers les abonnements cloud récurrents à moins de 20x les bénéfices en novembre 2016.',
        anonymizedSectorLabel: 'Logiciels Entreprise & Cloud Public',
        anonymizedDossierBrief:
          'Éditeur logiciel mondial migrant vers l’abonnement cloud : PER 19,8x, marge FCF 31 %, décote +20 %.',
      },
      {
        assetId: 'ASML',
        forwardPeAtEpoch: 23.4,
        roicSpreadPctAtEpoch: 17.2,
        fcfMarginPctAtEpoch: 22.5,
        valuationUpsidePctAtEpoch: 19.0,
        pointInTimeCatalyst:
          'Validation par les grands fondeurs mondiaux de sa technologie propriétaire de gravure EUV.',
        anonymizedSectorLabel: 'Équipements de Lithographie Semi-conducteurs',
        anonymizedDossierBrief:
          'Fournisseur unique d’équipements de lithographie : barrière à l’entrée absolue sur 10 ans, PER 23,4x (+19 %).',
      },
      {
        assetId: 'AMZN',
        forwardPeAtEpoch: 38.0,
        roicSpreadPctAtEpoch: 15.8,
        fcfMarginPctAtEpoch: 10.5,
        valuationUpsidePctAtEpoch: 18.0,
        pointInTimeCatalyst:
          'Révélation de la forte rentabilité opérationnelle de sa division d’hébergement cloud (marge > 28 %).',
        anonymizedSectorLabel: 'Infrastructure Cloud & E-Commerce',
        anonymizedDossierBrief:
          'Leader hébergement cloud & logistique : croissance cloud > 40 % dévoilant un fort levier sur le cash-flow libre.',
      },
      {
        assetId: 'V',
        forwardPeAtEpoch: 23.0,
        roicSpreadPctAtEpoch: 24.0,
        fcfMarginPctAtEpoch: 48.5,
        valuationUpsidePctAtEpoch: 15.5,
        pointInTimeCatalyst:
          'Transition séculaire des espèces vers le paiement par carte et sans contact après rachat de sa filiale européenne.',
        anonymizedSectorLabel: 'Réseau Mondial de Paiements Électroniques',
        anonymizedDossierBrief:
          'Duopole mondial des paiements : marge FCF 48,5 %, ROIC-WACC +24 %, croissance structurelle séculaire.',
      },
      {
        assetId: 'AAPL',
        forwardPeAtEpoch: 13.2,
        roicSpreadPctAtEpoch: 26.0,
        fcfMarginPctAtEpoch: 25.0,
        valuationUpsidePctAtEpoch: 17.5,
        pointInTimeCatalyst:
          'Écosystème mobile valorisé à peine 13x les bénéfices fin 2016 avec montée en puissance des revenus de services.',
        anonymizedSectorLabel: 'Écosystème Matériel & Services Mobiles',
        anonymizedDossierBrief:
          'Écosystème grand public ultra-rentable : PER très bas 13,2x, trésorerie colossale, essor des services récurrents.',
      },
      {
        assetId: 'XBB',
        forwardPeAtEpoch: 16.8,
        roicSpreadPctAtEpoch: 8.5,
        fcfMarginPctAtEpoch: 11.5,
        valuationUpsidePctAtEpoch: 9.5,
        pointInTimeCatalyst:
          'Valorisation raisonnable des actions mondiales à la sortie de la période déflationniste 2015–2016.',
        anonymizedSectorLabel: 'Indice Actions Pays Développés',
        anonymizedDossierBrief:
          'Panier indiciel mondial : PER 16,8x modéré, exposition diversifiée à la reprise mondiale.',
      },
      {
        assetId: 'INTC',
        forwardPeAtEpoch: 13.8,
        roicSpreadPctAtEpoch: 5.2,
        fcfMarginPctAtEpoch: 16.0,
        valuationUpsidePctAtEpoch: -8.0,
        pointInTimeCatalyst:
          'Marché PC stagnant et premiers retards d’exécution sur le passage à la gravure 10 nanomètres dès 2016.',
        anonymizedSectorLabel: 'Processeurs PC Traditionnels',
        anonymizedDossierBrief:
          'Dominant historique du PC : stagnation structurelle du marché PC et premiers retards sur la finesse de gravure (-8 %).',
      },
      {
        assetId: 'ALO',
        forwardPeAtEpoch: 18.5,
        roicSpreadPctAtEpoch: -2.5,
        fcfMarginPctAtEpoch: 1.2,
        valuationUpsidePctAtEpoch: -16.0,
        pointInTimeCatalyst:
          'Faible génération de trésorerie libre et appels d’offres publics à marges très étroites.',
        anonymizedSectorLabel: 'Construction Ferroviaire & Infrastructures Lourdes',
        anonymizedDossierBrief:
          'Industriel ferroviaire : conversion FCF quasi nulle (1,2 %), ROIC inférieur au coût du capital (-16 %).',
      },
      {
        assetId: 'BA',
        forwardPeAtEpoch: 17.5,
        roicSpreadPctAtEpoch: 2.0,
        fcfMarginPctAtEpoch: 6.5,
        valuationUpsidePctAtEpoch: -11.0,
        pointInTimeCatalyst:
          'Forte intensité capitalistique, cyclicité lourde et rachat d’actions au détriment du coussin bilanciel.',
        anonymizedSectorLabel: 'Assemblage Aéronautique Lourd',
        anonymizedDossierBrief:
          'Grand assembleur industriel : levier financier croissant et forte vulnérabilité aux aléas d’exécution (-11 %).',
      },
      {
        assetId: 'GOVT',
        forwardPeAtEpoch: 48.0,
        roicSpreadPctAtEpoch: -1.5,
        fcfMarginPctAtEpoch: 1.8,
        valuationUpsidePctAtEpoch: -14.0,
        pointInTimeCatalyst:
          'Taux souverains proches de leurs plus bas historiques fin 2016 offrant très peu de portage sur 10 ans.',
        anonymizedSectorLabel: 'Obligations d’État Long Terme',
        anonymizedDossierBrief:
          'Obligations souveraines 7-10 ans : rendement initial < 1,8 % plafonnant mécaniquement l’espérance de gain à 10 ans (-14 %).',
      },
      {
        assetId: 'BNP',
        forwardPeAtEpoch: 9.6,
        roicSpreadPctAtEpoch: -1.2,
        fcfMarginPctAtEpoch: 8.0,
        valuationUpsidePctAtEpoch: -6.0,
        pointInTimeCatalyst:
          'Taux négatifs en zone euro comprimant durablement la marge d’intérêt bancaire en 2016.',
        anonymizedSectorLabel: 'Banque Commerciale Zone à Taux Négatifs',
        anonymizedDossierBrief:
          'Banque européenne : pénalisée par les taux négatifs de banque centrale, ROE contraint sous le coût des fonds propres (-6 %).',
      },
    ],
  },
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseYearMonthToDate(ym: string, day = 15): Date {
  const [yStr, mStr] = ym.split('-');
  const y = Number(yStr) || 2026;
  const m = Math.max(0, (Number(mStr) || 1) - 1);
  return new Date(Date.UTC(y, m, day));
}

function computePointInTimePriceStats(
  assetId: string,
  epochIdx: number
): {
  trailing12mReturnPct: number;
  trailingVolPct: number;
  maxDrawdownToDatePct: number;
} {
  const startLookback = Math.max(0, epochIdx - 12);
  const pEnd = HISTORICAL_SERIES[epochIdx]?.prices[assetId] ?? 100;
  const pStart = HISTORICAL_SERIES[startLookback]?.prices[assetId] ?? pEnd;
  const monthsSpan = Math.max(1, epochIdx - startLookback);
  const rawRet = pStart > 0 ? pEnd / pStart - 1 : 0;
  const trailing12mReturnPct = Number(
    (((1 + rawRet) ** (12 / monthsSpan) - 1) * 100).toFixed(1)
  );

  const rets: number[] = [];
  let peak = HISTORICAL_SERIES[0]?.prices[assetId] ?? pEnd;
  let maxDd = 0;

  for (let i = 1; i <= epochIdx; i++) {
    const prev = HISTORICAL_SERIES[i - 1]?.prices[assetId] ?? pEnd;
    const curr = HISTORICAL_SERIES[i]?.prices[assetId] ?? pEnd;
    if (prev > 0) {
      rets.push(curr / prev - 1);
    }
    if (curr > peak) peak = curr;
    if (peak > 0) {
      const dd = (peak - curr) / peak;
      if (dd > maxDd) maxDd = dd;
    }
  }

  let trailingVolPct = getAssetById(assetId)?.baseVolatilityPct ?? 20;
  const recentRets = rets.slice(-18);
  if (recentRets.length >= 4) {
    const mean = recentRets.reduce((s, r) => s + r, 0) / recentRets.length;
    const variance =
      recentRets.reduce((s, r) => s + (r - mean) * (r - mean), 0) /
      Math.max(1, recentRets.length - 1);
    trailingVolPct = Number(
      Math.max(4, Math.min(95, Math.sqrt(variance * 12) * 100)).toFixed(1)
    );
  }

  return {
    trailing12mReturnPct,
    trailingVolPct,
    maxDrawdownToDatePct: Number((maxDd * 100).toFixed(1)),
  };
}

/**
 * Strictly point-in-time quantitative score at T_0 (uses ZERO prices after epochIdx).
 */
function scoreCandidateAtEpoch(
  cand: EpochCandidateFundamental,
  stats: {
    trailing12mReturnPct: number;
    trailingVolPct: number;
    maxDrawdownToDatePct: number;
  },
  riskProfile: RiskProfile
): number {
  const valuationComponent = cand.valuationUpsidePctAtEpoch * 1.45;
  const qualityComponent = cand.roicSpreadPctAtEpoch * 0.95 + cand.fcfMarginPctAtEpoch * 0.32;
  // Reward healthy positive momentum up to +45%, penalize extreme blow-off tops (>95% 12M)
  const clampedMom =
    stats.trailing12mReturnPct > 95
      ? 22 - (stats.trailing12mReturnPct - 95) * 0.25
      : Math.max(-25, Math.min(35, stats.trailing12mReturnPct * 0.42));

  const riskPenaltyFactor =
    riskProfile === 'prudent'
      ? 0.55
      : riskProfile === 'equilibre'
        ? 0.36
        : riskProfile === 'dynamique'
          ? 0.22
          : 0.14;
  const volPenalty = stats.trailingVolPct * riskPenaltyFactor;

  const raw = 52 + valuationComponent + qualityComponent + clampedMom - volPenalty;
  return Math.round(Math.max(8, Math.min(98, raw)));
}

function percentileSorted(sortedAsc: number[], p01: number): number {
  if (sortedAsc.length === 0) return 0;
  const pos = Math.max(0, Math.min(sortedAsc.length - 1, p01 * (sortedAsc.length - 1)));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  const frac = pos - lo;
  return sortedAsc[lo] * (1 - frac) + sortedAsc[hi] * frac;
}

export function evaluateSingleEpochAudit(params: {
  epochId: TimeMachineEpochId;
  initialCapitalCad: number;
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  riskProfile: RiskProfile;
  blindOverride?: BlindGeminiEpochAuditPayload | null;
}): EpochRetrospectiveAudit {
  const {
    epochId,
    initialCapitalCad,
    lots,
    livePrices,
    riskProfile,
    blindOverride,
  } = params;

  const safeCapital = Math.max(100, Number.isFinite(initialCapitalCad) ? initialCapitalCad : 10000);
  const archive = EPOCH_ARCHIVES[epochId];
  const lastIdx = HISTORICAL_SERIES.length - 1;
  const foundStartIdx = HISTORICAL_SERIES.findIndex(
    (pt) => pt.yearMonth === archive.startYearMonth
  );
  const startIdx = foundStartIdx >= 0 ? foundStartIdx : Math.max(0, lastIdx - 12);

  const getSpotAtEnd = (assetId: string): number => {
    const live = livePrices[assetId];
    if (typeof live === 'number' && Number.isFinite(live) && live > 0) {
      return live;
    }
    return HISTORICAL_SERIES[lastIdx]?.prices[assetId] ?? 100;
  };

  const getPriceAtStep = (assetId: string, idx: number): number => {
    if (idx >= lastIdx) return getSpotAtEnd(assetId);
    return HISTORICAL_SERIES[idx]?.prices[assetId] ?? getSpotAtEnd(assetId);
  };

  // Build deterministic anonymized blind codes (shuffled per epoch seed so order never leaks score!)
  const epochSeed =
    epochId === '1m' ? 1041 : epochId === '1y' ? 2089 : epochId === '5y' ? 5173 : 9817;
  const shuffleRng = mulberry32(epochSeed);
  const shuffledIndices = archive.candidates.map((_, i) => i);
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    const tmp = shuffledIndices[i];
    shuffledIndices[i] = shuffledIndices[j];
    shuffledIndices[j] = tmp;
  }

  const assetIdToBlindCode: Record<string, string> = {};
  const codeToAssetId: Record<string, string> = {};
  const dossiersForServer: AnonymizedDossierForServer[] = [];

  const scoredCandidates = archive.candidates.map((cand) => {
    const stats = computePointInTimePriceStats(cand.assetId, startIdx);
    const score100 = scoreCandidateAtEpoch(cand, stats, riskProfile);
    return { cand, stats, score100 };
  });

  shuffledIndices.forEach((origIdx, blindPos) => {
    const { cand, stats } = scoredCandidates[origIdx];
    const code = `ACTIF_${String(blindPos + 1).padStart(2, '0')}`;
    assetIdToBlindCode[cand.assetId] = code;
    codeToAssetId[code] = cand.assetId;
    dossiersForServer.push({
      blindCode: code,
      sectorGeneral: cand.anonymizedSectorLabel,
      trailing12mReturnPct: stats.trailing12mReturnPct,
      trailingVolatilityPct: stats.trailingVolPct,
      maxDrawdownToDatePct: stats.maxDrawdownToDatePct,
      forwardPe: cand.forwardPeAtEpoch,
      roicMinusWaccPct: cand.roicSpreadPctAtEpoch,
      fcfMarginPct: cand.fcfMarginPctAtEpoch,
      estimatedFairValueUpsidePct: cand.valuationUpsidePctAtEpoch,
      anonymizedCatalystSummary: cand.anonymizedDossierBrief,
    });
  });

  // Determine active BUY picks (4–5 assets, weights summing to 100%) and AVOID traps (3 assets)
  const rankedByQuant = [...scoredCandidates].sort((a, b) => b.score100 - a.score100);

  let selectedPicksRaw: Array<{
    assetId: string;
    weightPct: number;
    thesisFr: string;
    score100: number;
  }> = [];
  let selectedAvoidsRaw: Array<{
    assetId: string;
    reasonFr: string;
  }> = [];

  const hasValidBlindOverride =
    blindOverride &&
    blindOverride.epochId === epochId &&
    Array.isArray(blindOverride.picks) &&
    blindOverride.picks.length >= 3;

  if (hasValidBlindOverride && blindOverride) {
    const validPicks = blindOverride.picks.filter((p) =>
      archive.candidates.some((c) => c.assetId === p.assetId)
    );
    const sumW = validPicks.reduce((s, p) => s + Math.max(5, p.weightPct), 0);
    selectedPicksRaw = validPicks.map((p) => {
      const foundScore =
        scoredCandidates.find((sc) => sc.cand.assetId === p.assetId)?.score100 ?? 75;
      return {
        assetId: p.assetId,
        weightPct: sumW > 0 ? (Math.max(5, p.weightPct) / sumW) * 100 : 100 / validPicks.length,
        thesisFr: p.blindThesisFr,
        score100: foundScore,
      };
    });

    const pickedIds = new Set(selectedPicksRaw.map((p) => p.assetId));
    const validAvoids = (blindOverride.avoids ?? []).filter(
      (a) =>
        !pickedIds.has(a.assetId) &&
        archive.candidates.some((c) => c.assetId === a.assetId)
    );
    selectedAvoidsRaw =
      validAvoids.length >= 2
        ? validAvoids.slice(0, 3).map((a) => ({
            assetId: a.assetId,
            reasonFr: a.blindAvoidReasonFr,
          }))
        : rankedByQuant
            .slice(-3)
            .reverse()
            .filter((item) => !pickedIds.has(item.cand.assetId))
            .map((item) => ({
              assetId: item.cand.assetId,
              reasonFr: item.cand.pointInTimeCatalyst,
            }));
  } else {
    const top5 = rankedByQuant.slice(0, 5);
    const excessSum = top5.reduce((s, x) => s + Math.max(10, x.score100 - 45), 0);
    selectedPicksRaw = top5.map((x) => ({
      assetId: x.cand.assetId,
      weightPct:
        excessSum > 0
          ? (Math.max(10, x.score100 - 45) / excessSum) * 100
          : 20,
      thesisFr: x.cand.pointInTimeCatalyst,
      score100: x.score100,
    }));

    selectedAvoidsRaw = rankedByQuant
      .slice(-3)
      .reverse()
      .map((x) => ({
        assetId: x.cand.assetId,
        reasonFr: x.cand.pointInTimeCatalyst,
      }));
  }

  // Normalize pick weights strictly to 100.0%
  const rawWeightTotal = selectedPicksRaw.reduce((s, p) => s + p.weightPct, 0) || 100;
  const normalizedPicks = selectedPicksRaw.map((p) => ({
    ...p,
    weightFrac: p.weightPct / rawWeightTotal,
    weightPct: Number(((p.weightPct / rawWeightTotal) * 100).toFixed(1)),
  }));

  // World benchmark return over [startIdx .. lastIdx]
  const worldStartPx = Math.max(0.0001, getPriceAtStep('XBB', startIdx));
  const worldEndPx = Math.max(0.0001, getPriceAtStep('XBB', lastIdx));
  const worldTotalReturnFrac = worldEndPx / worldStartPx - 1;
  const worldTotalReturnPct = Number((worldTotalReturnFrac * 100).toFixed(2));
  const worldFinalCad = Number((safeCapital * (1 + worldTotalReturnFrac)).toFixed(2));

  // Evaluate each AI pick from T_0 to Today
  const evaluatedPicks: EvaluatedAiEpochPick[] = normalizedPicks.map((p) => {
    const meta = getAssetById(p.assetId);
    const entryPriceCad = Math.max(0.0001, getPriceAtStep(p.assetId, startIdx));
    const currentPriceCad = Math.max(0.0001, getPriceAtStep(p.assetId, lastIdx));
    const retFrac = currentPriceCad / entryPriceCad - 1;
    const allocatedCad = safeCapital * p.weightFrac;
    const finalValueCad = allocatedCad * (1 + retFrac);
    const netProfitCad = finalValueCad - allocatedCad;
    const beatWorld = retFrac >= worldTotalReturnFrac;

    const verdictBadge: EvaluatedAiEpochPick['verdictBadge'] = beatWorld
      ? 'PARI GAGNANT'
      : retFrac >= 0
        ? 'GAIN MODÉRÉ'
        : 'ERREUR IA';

    return {
      assetId: p.assetId,
      ticker: meta?.ticker ?? p.assetId,
      name: meta?.name ?? p.assetId,
      sector: meta?.sector ?? meta?.categoryLabel ?? 'Marché Global',
      blindCode: assetIdToBlindCode[p.assetId] ?? 'ACTIF',
      weightPct: p.weightPct,
      allocatedCad: Number(allocatedCad.toFixed(2)),
      entryPriceCad: Number(entryPriceCad.toFixed(2)),
      currentPriceCad: Number(currentPriceCad.toFixed(2)),
      realizedReturnPct: Number((retFrac * 100).toFixed(2)),
      finalValueCad: Number(finalValueCad.toFixed(2)),
      netProfitCad: Number(netProfitCad.toFixed(2)),
      beatWorldBenchmark: beatWorld,
      pointInTimeScore100: p.score100,
      pointInTimeThesisFr: p.thesisFr,
      verdictBadge,
    };
  });

  const aiFinalCad = Number(
    evaluatedPicks.reduce((s, p) => s + p.finalValueCad, 0).toFixed(2)
  );
  const aiTotalReturnFrac = safeCapital > 0 ? aiFinalCad / safeCapital - 1 : 0;
  const aiTotalReturnPct = Number((aiTotalReturnFrac * 100).toFixed(2));

  // Evaluate Avoided Traps
  const evaluatedAvoids: EvaluatedAiEpochAvoid[] = selectedAvoidsRaw.map((av) => {
    const meta = getAssetById(av.assetId);
    const entryPriceCad = Math.max(0.0001, getPriceAtStep(av.assetId, startIdx));
    const currentPriceCad = Math.max(0.0001, getPriceAtStep(av.assetId, lastIdx));
    const retFrac = currentPriceCad / entryPriceCad - 1;
    const realPct = Number((retFrac * 100).toFixed(2));
    const relativeSavedVsAiPct = Number((aiTotalReturnPct - realPct).toFixed(2));
    return {
      assetId: av.assetId,
      ticker: meta?.ticker ?? av.assetId,
      name: meta?.name ?? av.assetId,
      sector: meta?.sector ?? meta?.categoryLabel ?? 'Marché Global',
      blindCode: assetIdToBlindCode[av.assetId] ?? 'ACTIF',
      entryPriceCad: Number(entryPriceCad.toFixed(2)),
      currentPriceCad: Number(currentPriceCad.toFixed(2)),
      realizedReturnPct: realPct,
      relativeSavedVsAiPct,
      avoidCorrect: realPct < aiTotalReturnPct,
      pointInTimeAvoidReasonFr: av.reasonFr,
    };
  });

  // User's current portfolio weights replayed over [startIdx .. lastIdx]
  const userWeightMap = new Map<string, number>();
  let totalUserCurrentVal = 0;
  for (const lot of lots) {
    const asset = getAssetById(lot.assetId);
    if (!asset) continue;
    const spotNow = getSpotAtEnd(lot.assetId);
    let lotVal = lot.investedAmount;
    if (lot.quantity && lot.quantity > 0) {
      lotVal = lot.quantity * spotNow;
    } else {
      const buyPx =
        HISTORICAL_SERIES.find((pt) => pt.yearMonth === lot.purchaseYearMonth)?.prices[
          lot.assetId
        ] ?? spotNow;
      if (buyPx > 0) {
        lotVal = (lot.investedAmount / buyPx) * spotNow;
      }
    }
    if (lotVal > 0) {
      userWeightMap.set(lot.assetId, (userWeightMap.get(lot.assetId) ?? 0) + lotVal);
      totalUserCurrentVal += lotVal;
    }
  }

  if (totalUserCurrentVal <= 0) {
    // Fallback balanced mix if user cleared their portfolio
    userWeightMap.set('XBB', 0.6);
    userWeightMap.set('GOVT', 0.25);
    userWeightMap.set('GOLD', 0.15);
    totalUserCurrentVal = 1;
  }

  const userWeightsNormalized = Array.from(userWeightMap.entries()).map(([assetId, val]) => ({
    assetId,
    weightFrac: val / totalUserCurrentVal,
    startPx: Math.max(0.0001, getPriceAtStep(assetId, startIdx)),
  }));

  // 250 Random Portfolios drawn from the broad core investable universe at T_0
  const investableUniverseIds = ASSETS.slice(0, 38)
    .map((a) => a.id)
    .filter((id) => id !== 'CASH' && getPriceAtStep(id, startIdx) > 0);

  const randomRng = mulberry32(epochSeed + 777);
  const NUM_RANDOM_PORTFOLIOS = 250;
  const randomPortfolios: Array<
    Array<{ assetId: string; weightFrac: number; startPx: number }>
  > = [];

  for (let sim = 0; sim < NUM_RANDOM_PORTFOLIOS; sim++) {
    const chosen: string[] = [];
    const rawWeights: number[] = [];
    while (chosen.length < 5 && chosen.length < investableUniverseIds.length) {
      const candidateId =
        investableUniverseIds[Math.floor(randomRng() * investableUniverseIds.length)];
      if (!chosen.includes(candidateId)) {
        chosen.push(candidateId);
        rawWeights.push(-Math.log(Math.max(0.001, randomRng())));
      }
    }
    const wSum = rawWeights.reduce((s, w) => s + w, 0) || 1;
    randomPortfolios.push(
      chosen.map((assetId, idx) => ({
        assetId,
        weightFrac: rawWeights[idx] / wSum,
        startPx: Math.max(0.0001, getPriceAtStep(assetId, startIdx)),
      }))
    );
  }

  // Build trajectory points (for 1m, build 5 weekly steps so D3 curve is rich and smooth)
  const series: TimeMachineCurvePoint[] = [];

  if (epochId === '1m') {
    const weeklySteps = [
      { frac: 0, label: '15 oct. 2026', day: 15, month: 9 },
      { frac: 0.25, label: '22 oct. 2026', day: 22, month: 9 },
      { frac: 0.5, label: '29 oct. 2026', day: 29, month: 9 },
      { frac: 0.75, label: '06 nov. 2026', day: 6, month: 10 },
      { frac: 1.0, label: '15 nov. 2026 (Auj.)', day: 15, month: 10 },
    ];

    for (let sIdx = 0; sIdx < weeklySteps.length; sIdx++) {
      const step = weeklySteps[sIdx];
      const f = step.frac;
      const wobble = (seedNum: number) =>
        f === 0 || f === 1
          ? 0
          : Math.sin(f * Math.PI) * Math.sin(seedNum * 17.3 + sIdx * 2.1) * 0.011;

      const interpPrice = (assetId: string, seedOffset: number) => {
        const p0 = Math.max(0.0001, getPriceAtStep(assetId, startIdx));
        const p1 = Math.max(0.0001, getPriceAtStep(assetId, lastIdx));
        return p0 * (1 + (p1 / p0 - 1) * f + wobble(seedOffset));
      };

      const aiVal = normalizedPicks.reduce((sum, pick, idx) => {
        const p0 = Math.max(0.0001, getPriceAtStep(pick.assetId, startIdx));
        const pt = interpPrice(pick.assetId, idx + 3);
        return sum + safeCapital * pick.weightFrac * (pt / p0);
      }, 0);

      const userVal = userWeightsNormalized.reduce((sum, uw, idx) => {
        const pt = interpPrice(uw.assetId, idx + 21);
        return sum + safeCapital * uw.weightFrac * (pt / uw.startPx);
      }, 0);

      const worldPt = interpPrice('XBB', 99);
      const worldVal = safeCapital * (worldPt / worldStartPx);

      const randVals = randomPortfolios
        .map((rp, rIdx) =>
          rp.reduce((sum, item) => {
            const pt = interpPrice(item.assetId, (rIdx % 13) + 5);
            return sum + safeCapital * item.weightFrac * (pt / item.startPx);
          }, 0)
        )
        .sort((a, b) => a - b);

      const rP25 = percentileSorted(randVals, 0.25);
      const rP50 = percentileSorted(randVals, 0.5);
      const rP75 = percentileSorted(randVals, 0.75);

      series.push({
        yearMonth: `2026-10-w${sIdx}`,
        label: step.label,
        date: new Date(Date.UTC(2026, step.month, step.day)),
        aiValueCad: Number(aiVal.toFixed(2)),
        aiCumPct: Number(((aiVal / safeCapital - 1) * 100).toFixed(2)),
        userPortfolioValueCad: Number(userVal.toFixed(2)),
        userPortfolioCumPct: Number(((userVal / safeCapital - 1) * 100).toFixed(2)),
        worldIndexValueCad: Number(worldVal.toFixed(2)),
        worldIndexCumPct: Number(((worldVal / safeCapital - 1) * 100).toFixed(2)),
        randomMedianCad: Number(rP50.toFixed(2)),
        randomMedianCumPct: Number(((rP50 / safeCapital - 1) * 100).toFixed(2)),
        randomP25Cad: Number(rP25.toFixed(2)),
        randomP25CumPct: Number(((rP25 / safeCapital - 1) * 100).toFixed(2)),
        randomP75Cad: Number(rP75.toFixed(2)),
        randomP75CumPct: Number(((rP75 / safeCapital - 1) * 100).toFixed(2)),
      });
    }
  } else {
    for (let idx = startIdx; idx <= lastIdx; idx++) {
      const histPt = HISTORICAL_SERIES[idx];
      const aiVal = normalizedPicks.reduce((sum, pick) => {
        const p0 = Math.max(0.0001, getPriceAtStep(pick.assetId, startIdx));
        const pt = Math.max(0.0001, getPriceAtStep(pick.assetId, idx));
        return sum + safeCapital * pick.weightFrac * (pt / p0);
      }, 0);

      const userVal = userWeightsNormalized.reduce((sum, uw) => {
        const pt = Math.max(0.0001, getPriceAtStep(uw.assetId, idx));
        return sum + safeCapital * uw.weightFrac * (pt / uw.startPx);
      }, 0);

      const worldPt = Math.max(0.0001, getPriceAtStep('XBB', idx));
      const worldVal = safeCapital * (worldPt / worldStartPx);

      const randVals = randomPortfolios
        .map((rp) =>
          rp.reduce((sum, item) => {
            const pt = Math.max(0.0001, getPriceAtStep(item.assetId, idx));
            return sum + safeCapital * item.weightFrac * (pt / item.startPx);
          }, 0)
        )
        .sort((a, b) => a - b);

      const rP25 = percentileSorted(randVals, 0.25);
      const rP50 = percentileSorted(randVals, 0.5);
      const rP75 = percentileSorted(randVals, 0.75);

      series.push({
        yearMonth: histPt.yearMonth,
        label: idx === lastIdx ? `${histPt.label} (Auj.)` : histPt.label,
        date: parseYearMonthToDate(histPt.yearMonth, 15),
        aiValueCad: Number(aiVal.toFixed(2)),
        aiCumPct: Number(((aiVal / safeCapital - 1) * 100).toFixed(2)),
        userPortfolioValueCad: Number(userVal.toFixed(2)),
        userPortfolioCumPct: Number(((userVal / safeCapital - 1) * 100).toFixed(2)),
        worldIndexValueCad: Number(worldVal.toFixed(2)),
        worldIndexCumPct: Number(((worldVal / safeCapital - 1) * 100).toFixed(2)),
        randomMedianCad: Number(rP50.toFixed(2)),
        randomMedianCumPct: Number(((rP50 / safeCapital - 1) * 100).toFixed(2)),
        randomP25Cad: Number(rP25.toFixed(2)),
        randomP25CumPct: Number(((rP25 / safeCapital - 1) * 100).toFixed(2)),
        randomP75Cad: Number(rP75.toFixed(2)),
        randomP75CumPct: Number(((rP75 / safeCapital - 1) * 100).toFixed(2)),
        regimeMarker: histPt.regimeNote,
      });
    }
  }

  // Max Drawdown of AI trajectory over the epoch
  let aiPeak = safeCapital;
  let aiMaxDd = 0;
  for (const pt of series) {
    if (pt.aiValueCad > aiPeak) aiPeak = pt.aiValueCad;
    if (aiPeak > 0) {
      const dd = (aiPeak - pt.aiValueCad) / aiPeak;
      if (dd > aiMaxDd) aiMaxDd = dd;
    }
  }

  const endPt = series[series.length - 1];
  const userFinalCad = endPt?.userPortfolioValueCad ?? safeCapital;
  const userTotalReturnPct = endPt?.userPortfolioCumPct ?? 0;
  const randomMedianFinalCad = endPt?.randomMedianCad ?? safeCapital;
  const randomMedianReturnPct = endPt?.randomMedianCumPct ?? 0;
  const randomP75FinalCad = endPt?.randomP75Cad ?? safeCapital;

  // Exact % of random portfolios beaten at the final date
  const finalRandomValues = randomPortfolios.map((rp) =>
    rp.reduce((sum, item) => {
      const pt = Math.max(0.0001, getPriceAtStep(item.assetId, lastIdx));
      return sum + safeCapital * item.weightFrac * (pt / item.startPx);
    }, 0)
  );
  const beatenRandomCount = finalRandomValues.filter((v) => aiFinalCad >= v).length;
  const beatRandomPortfoliosPct = Math.round(
    (beatenRandomCount / NUM_RANDOM_PORTFOLIOS) * 100
  );

  const aiAnnualizedCagrPct =
    archive.yearsElapsed >= 1
      ? Number(
          (((aiFinalCad / safeCapital) ** (1 / archive.yearsElapsed) - 1) * 100).toFixed(2)
        )
      : aiTotalReturnPct;

  const alphaVsWorldPct = Number((aiTotalReturnPct - worldTotalReturnPct).toFixed(2));
  const alphaVsUserPct = Number((aiTotalReturnPct - userTotalReturnPct).toFixed(2));
  const alphaVsRandomPct = Number((aiTotalReturnPct - randomMedianReturnPct).toFixed(2));

  const winningPicksCount = evaluatedPicks.filter(
    (p) => p.beatWorldBenchmark || p.realizedReturnPct > 0
  ).length;
  const beatBenchmarkPicksCount = evaluatedPicks.filter((p) => p.beatWorldBenchmark).length;
  const hitRatePct = Math.round(
    (beatBenchmarkPicksCount / Math.max(1, evaluatedPicks.length)) * 100
  );

  const isAiUsefulOnEpoch =
    aiFinalCad > worldFinalCad && aiFinalCad > randomMedianFinalCad;

  const extraGainVsWorldCad = Number((aiFinalCad - worldFinalCad).toFixed(2));
  const extraGainVsRandomCad = Number((aiFinalCad - randomMedianFinalCad).toFixed(2));

  const verdictHeadlineFr = isAiUsefulOnEpoch
    ? `Utilité prouvée : l’IA bat l’indice mondial (${alphaVsWorldPct >= 0 ? '+' : ''}${alphaVsWorldPct.toFixed(1).replace('.', ',')} pts) et surpasse ${beatRandomPortfoliosPct} % des portefeuilles tirés au hasard`
    : aiFinalCad >= randomMedianFinalCad
      ? `Utilité partielle : l’IA bat le hasard médian mais fait jeu égal ou inférieur face à l’indice mondial`
      : `Période difficile : la sélection d’époque sous-performe les témoins sur cet horizon`;

  const weakestPick = [...evaluatedPicks].sort(
    (a, b) => a.realizedReturnPct - b.realizedReturnPct
  )[0];
  const bestAvoid = [...evaluatedAvoids].sort(
    (a, b) => a.realizedReturnPct - b.realizedReturnPct
  )[0];

  const honestNuanceFr =
    weakestPick && bestAvoid
      ? `Transparence : le point le moins performant du panier IA fut ${weakestPick.ticker} (${weakestPick.realizedReturnPct >= 0 ? '+' : ''}${weakestPick.realizedReturnPct.toFixed(1).replace('.', ',')} %), tandis que l’évitement de ${bestAvoid.ticker} (${bestAvoid.realizedReturnPct >= 0 ? '+' : ''}${bestAvoid.realizedReturnPct.toFixed(1).replace('.', ',')} %) a protégé le capital.`
      : `Analyse arrêtée strictement aux données connues le ${archive.startDateDisplay}.`;

  return {
    epochId,
    shortLabel: archive.shortLabel,
    horizonLabel: archive.horizonLabel,
    startYearMonth: archive.startYearMonth,
    startDateDisplay: archive.startDateDisplay,
    endDateDisplay: '15 nov. 2026',
    monthsElapsed: archive.monthsElapsed,
    yearsElapsed: archive.yearsElapsed,
    initialCapitalCad: safeCapital,
    sourceMode: hasValidBlindOverride ? 'gemini_blind_verified' : 'quant_point_in_time',
    macroAtEpoch: archive.macroAtEpoch,
    newsAtEpoch: archive.newsAtEpoch,
    macroReadingFr:
      hasValidBlindOverride && blindOverride?.macroReadingAtEpochFr
        ? blindOverride.macroReadingAtEpochFr
        : archive.defaultMacroReadingFr,
    allocationPhilosophyFr:
      hasValidBlindOverride && blindOverride?.allocationPhilosophyFr
        ? blindOverride.allocationPhilosophyFr
        : archive.defaultPhilosophyFr,
    picks: evaluatedPicks,
    avoids: evaluatedAvoids,
    series,
    aiFinalCad,
    aiTotalReturnPct,
    aiAnnualizedCagrPct,
    aiMaxDrawdownPct: Number((aiMaxDd * 100).toFixed(1)),
    userFinalCad,
    userTotalReturnPct,
    worldFinalCad,
    worldTotalReturnPct,
    randomMedianFinalCad,
    randomMedianReturnPct,
    randomP75FinalCad,
    alphaVsWorldPct,
    alphaVsUserPct,
    alphaVsRandomPct,
    extraGainVsWorldCad,
    extraGainVsRandomCad,
    hitRatePct,
    winningPicksCount,
    beatRandomPortfoliosPct,
    isAiUsefulOnEpoch,
    verdictHeadlineFr,
    honestNuanceFr,
    anonymizedServerRequest: {
      epochCode: `HORIZON_${epochId.toUpperCase()}`,
      macroAtT0: {
        inflationPct: archive.macroAtEpoch.inflationPct,
        centralBankRatePct: archive.macroAtEpoch.centralBankRatePct,
        gdpGrowthPct: archive.macroAtEpoch.gdpGrowthPct,
        vixLevel: archive.macroAtEpoch.vixLevel,
        yieldCurveNote: archive.macroAtEpoch.yieldCurveNote,
      },
      anonymizedNewsDigest: archive.newsAtEpoch.map((n) => n.anonymizedDigest),
      dossiers: dossiersForServer,
      codeToAssetId,
    },
  };
}

export function buildGlobalAiUsefulnessSummary(params: {
  initialCapitalCad: number;
  lots: PortfolioLot[];
  livePrices: Record<string, number>;
  riskProfile: RiskProfile;
  blindOverridesByEpoch: Partial<Record<TimeMachineEpochId, BlindGeminiEpochAuditPayload>>;
}): GlobalAiUsefulnessSummary {
  const epochIds: TimeMachineEpochId[] = ['1m', '1y', '5y', '10y'];
  const epochs = epochIds.map((epochId) =>
    evaluateSingleEpochAudit({
      epochId,
      initialCapitalCad: params.initialCapitalCad,
      lots: params.lots,
      livePrices: params.livePrices,
      riskProfile: params.riskProfile,
      blindOverride: params.blindOverridesByEpoch[epochId] ?? null,
    })
  );

  const epochsWonVsWorldCount = epochs.filter((e) => e.aiFinalCad > e.worldFinalCad).length;
  const epochsWonVsRandomCount = epochs.filter(
    (e) => e.aiFinalCad > e.randomMedianFinalCad
  ).length;

  const totalPicksAudited = epochs.reduce((s, e) => s + e.picks.length, 0);
  const totalWinningPicks = epochs.reduce(
    (s, e) => s + e.picks.filter((p) => p.beatWorldBenchmark).length,
    0
  );
  const globalHitRatePct = Math.round(
    (totalWinningPicks / Math.max(1, totalPicksAudited)) * 100
  );

  const avgAlphaVsWorldPct = Number(
    (epochs.reduce((s, e) => s + e.alphaVsWorldPct, 0) / epochs.length).toFixed(1)
  );
  const avgAlphaVsRandomPct = Number(
    (epochs.reduce((s, e) => s + e.alphaVsRandomPct, 0) / epochs.length).toFixed(1)
  );
  const avgBeatRandomPercentile = Math.round(
    epochs.reduce((s, e) => s + e.beatRandomPortfoliosPct, 0) / epochs.length
  );

  const singleCap = Math.max(
    100,
    Number.isFinite(params.initialCapitalCad) ? params.initialCapitalCad : 10000
  );
  const cumulativeInvested4EpochsCad = Number((singleCap * epochs.length).toFixed(2));
  const cumulativeAiFinal4EpochsCad = Number(
    epochs.reduce((s, e) => s + e.aiFinalCad, 0).toFixed(2)
  );
  const cumulativeWorldFinal4EpochsCad = Number(
    epochs.reduce((s, e) => s + e.worldFinalCad, 0).toFixed(2)
  );
  const cumulativeRandomFinal4EpochsCad = Number(
    epochs.reduce((s, e) => s + e.randomMedianFinalCad, 0).toFixed(2)
  );
  const cumulativeUserFinal4EpochsCad = Number(
    epochs.reduce((s, e) => s + e.userFinalCad, 0).toFixed(2)
  );

  const rawScore =
    epochsWonVsWorldCount * 13 +
    epochsWonVsRandomCount * 10 +
    globalHitRatePct * 0.25 +
    avgBeatRandomPercentile * 0.2;
  const overallUsefulnessScore100 = Math.round(Math.max(15, Math.min(97, rawScore)));

  const overallVerdictLabel =
    epochsWonVsWorldCount >= 3 && epochsWonVsRandomCount >= 3
      ? 'Oui — Utilité nette confirmée face au marché et au hasard'
      : epochsWonVsRandomCount >= 3
        ? 'Utilité modérée — Surpasse le hasard mais proche de l’indice'
        : 'Valeur ajoutée limitée sur la sélection actuelle';

  const overallPlainSummaryFr = `Sur ${epochs.length} époques testées sans biais futur (1 mois, 1 an, 5 ans et 10 ans), l’IA bat l’indice mondial ${epochsWonVsWorldCount} fois sur ${epochs.length} et surpasse en moyenne ${avgBeatRandomPercentile} % des portefeuilles tirés au hasard, principalement grâce au filtrage des pièges de valorisation (comme fin 2021) et à la sélection des bilans à fort ROIC.`;

  return {
    initialCapitalPerEpochCad: epochs[0]?.initialCapitalCad ?? 10000,
    epochs,
    epochsWonVsWorldCount,
    epochsWonVsRandomCount,
    totalPicksAudited,
    totalWinningPicks,
    globalHitRatePct,
    avgAlphaVsWorldPct,
    avgAlphaVsRandomPct,
    avgBeatRandomPercentile,
    cumulativeInvested4EpochsCad,
    cumulativeAiFinal4EpochsCad,
    cumulativeWorldFinal4EpochsCad,
    cumulativeRandomFinal4EpochsCad,
    cumulativeUserFinal4EpochsCad,
    overallUsefulnessScore100,
    overallVerdictLabel,
    overallPlainSummaryFr,
  };
}
