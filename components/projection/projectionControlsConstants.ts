// components/projection/projectionControlsConstants.ts
// [FUTUR-MOBILE-PR4] Tableaux de configuration partagés entre ProjectionControls (desktop)
// et ProjectionControlsMobile (mobile) — extraits dans un module feuille pour éviter
// l'import circulaire entre les deux vues.

export const STOCHASTIC_TOGGLES = [
    { key: 'useStochasticMortality', label: 'Mortalité', title: "Active des tirages aléatoires de date de décès (tables Stats Can 2020-2022) en mode Monte Carlo. La simulation s'arrête à la mort." },
    { key: 'ltcEnabled', label: 'Soins LD', title: "Soins de longue durée (CHSLD/RPA). Probabilité croissante après 65 ans (1% → 25%/an)." },
    { key: 'jobLossEnabled', label: 'Perte emploi', title: "Perte d'emploi stochastique en MC. Probabilité annuelle ~3% (Stats Can). Pendant N mois, revenu du user principal = 55% (assurance-emploi)." },
    { key: 'modelSurvivor', label: 'Survivant', title: "Modélise le décès du conjoint en MC (RRQ survivant 60%, PSV cesse, DB selon election)." },
    { key: 'useHistoricalBootstrap', label: 'Bootstrap historique', title: "Échantillonne l'historique réel S&P 500 + inflation US 1928-2024 (97 ans)." },
    { key: 'divorceEnabled', label: 'Divorce', title: "Divorce stochastique (MC). Probabilité annuelle ~1.5% (cumul ~36% sur 30 ans)." },
    { key: 'ltdEnabled', label: 'Invalidité', title: "Invalidité longue durée stochastique. Probabilité annuelle ~0.5%." },
    { key: 'criticalIllnessEnabled', label: 'Maladie grave', title: "Maladie grave stochastique. Probabilité ~0.3%/an." },
    { key: 'inheritanceEnabled', label: 'Héritage', title: "Héritage probabilisé. Tirage dans la fenêtre [âge attendu ± uncertaintyY]." },
    { key: 'snowbirdEnabled', label: 'Snowbird', title: "Snowbird (4-6 mois en US/Mexique en hiver à la retraite). Surcoût mensuel ~1500$." },
] as const;

export const INFLATION_CATEGORIES = [
    { key: 'inflationHousing',   label: 'Logement',   weight: 30, def: 4.0 },
    { key: 'inflationFood',      label: 'Alim.',      weight: 17, def: 3.5 },
    { key: 'inflationTransport', label: 'Transport',  weight: 15, def: 2.5 },
    { key: 'inflationHealth',    label: 'Santé',      weight: 5,  def: 4.5 },
    { key: 'inflationLeisure',   label: 'Loisirs',    weight: 6,  def: 1.5 },
    { key: 'inflationOther',     label: 'Autres',     weight: 27, def: 2.0 },
] as const;

export const REPLAY_OPTIONS = [
    { value: '',     label: '— Aucun (mode normal) —' },
    { value: '1929', label: '1929 — Grande Dépression' },
    { value: '1973', label: '1973 — Choc pétrolier + stagflation' },
    { value: '2000', label: '2000 — Bulle dot-com' },
    { value: '2008', label: '2008 — Crise financière' },
    { value: '2020', label: '2020 — COVID' },
    { value: '2022', label: '2022 — Inflation post-COVID' },
];
