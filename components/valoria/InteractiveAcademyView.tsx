import React, { useMemo, useState } from 'react';
import { VALORIA_PALETTE } from '../../services/valoria/valoriaPalettes';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { simulateFeeImpact } from '../../services/valoria/engine';
import {
  formatCompactEur,
  formatEur,
  formatPct,
  formatSignedPct,
} from '../../services/valoria/valoriaFormatters';

interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

interface LessonModule {
  id: 'budget' | 'assets' | 'market' | 'strategies';
  indexLabel: string;
  title: string;
  rules: { label: string; metric: string; detail: string }[];
  questions: QuizQuestion[];
}

const LESSONS: LessonModule[] = [
  {
    id: 'budget',
    indexLabel: '01. Trésorerie',
    title: 'Ratio 50/30/20 & Matelas de Sécurité',
    rules: [
      {
        label: 'Socle liquide garanti',
        metric: '3 à 6 mois',
        detail: 'Charges fixes sur Compte Épargne / CPG / Fonds CORRA ($ CAD)',
      },
      {
        label: 'Taux d’investissement cible',
        metric: '≥ 20 % net',
        detail: 'Virement automatique programmé début de mois',
      },
      {
        label: 'Règle de liquidité',
        metric: 'Horizon > 5 ans',
        detail: 'Zéro épargne court terme exposée aux actions',
      },
    ],
    questions: [
      {
        id: 'b1',
        prompt: 'Rôle principal de l’épargne de précaution avant d’investir en bourse ?',
        options: [
          'Viser un rendement supérieur à 10 %/an',
          'Couvrir 3 à 6 mois de charges sans vendre ses actifs en plein krach',
          'Arbitrer les devises à court terme',
        ],
        correctIndex: 1,
        explanation:
          'Exact : le matelas liquide évite toute vente forcée à perte lors d’un choc boursier.',
      },
      {
        id: 'b2',
        prompt: 'Dans la structure 50 / 30 / 20, que représente la poche 20 % ?',
        options: [
          'Les frais de courtage annuels',
          'Les charges fixes de logement',
          'Le flux mensuel d’épargne et d’investissement capitalisant',
        ],
        correctIndex: 2,
        explanation:
          'Correct : automatiser 20 % dès perception du revenu construit l’effet boule de neige.',
      },
    ],
  },
  {
    id: 'assets',
    indexLabel: '02. Allocation',
    title: 'Couple Rendement / Risque & Corrélation',
    rules: [
      {
        label: 'Moteur de croissance',
        metric: 'Actions (CELI/REER)',
        detail: 'Prime de risque historique ~7–9 %/an, σ ~15 %',
      },
      {
        label: 'Amortisseur & portage',
        metric: 'Oblig. IG / Or',
        detail: 'Faible corrélation réduisant le Max Drawdown',
      },
      {
        label: 'Poche asymétrique',
        metric: 'Crypto ≤ 5–10 %',
        detail: 'Volatilité ~60 %/an : calibrer par budget de risque',
      },
    ],
    questions: [
      {
        id: 'a1',
        prompt: 'Pourquoi combiner Actions, Obligations et Or dans un portefeuille ?',
        options: [
          'Leurs corrélations imparfaites réduisent la volatilité globale et améliorent le Sharpe',
          'Les obligations surperforment toujours les actions sur 20 ans',
          'Pour annuler les frais de gestion des ETF',
        ],
        correctIndex: 0,
        explanation:
          'Exact : la décorrélation diminue le risque du portefeuille sans sacrifier proportionnellement le rendement.',
      },
      {
        id: 'a2',
        prompt: 'Quel calibrage institutionnel s’applique aux cryptomonnaies (σ > 55 %) ?',
        options: [
          '100 % de la trésorerie court terme',
          'Une poche satellite plafonnée (2 % à 10 %) rééquilibrée périodiquement',
          'Un substitut sans risque au fonds monétaire CORRA',
        ],
        correctIndex: 1,
        explanation:
          'Exact : à 60 % de volatilité, 10 % en crypto pèse déjà ~30 % du risque total du portefeuille.',
      },
    ],
  },
  {
    id: 'market',
    indexLabel: '03. Macro & Taux',
    title: 'Duration Obligataire, Taux Réels & Cycles',
    rules: [
      {
        label: 'Sensibilité taux (Duration)',
        metric: 'ΔPrix ≈ -D × Δy',
        detail: 'Duration 8 ans + hausse taux +1 % ≈ -8 % sur le cours',
      },
      {
        label: 'Stagflation (IPC ↑, PIB ↓)',
        metric: 'Or & CORRA',
        detail: 'Protection contre l’érosion des taux réels',
      },
      {
        label: 'Désinflation / Baisse taux',
        metric: 'Actions & Tech',
        detail: 'Expansion des multiples PER et baisse du taux d’actualisation',
      },
    ],
    questions: [
      {
        id: 'm1',
        prompt: 'Impact d’une hausse rapide des taux directeurs sur une obligation fixe de duration 8 ans ?',
        options: [
          'Son cours baisse mécaniquement (~8 % par point de taux) pour s’aligner sur le nouveau rendement',
          'Son cours double immédiatement',
          'Son coupon fixe devient variable',
        ],
        correctIndex: 0,
        explanation:
          'Exact : valeur obligataire et taux évoluent en sens inverse selon la duration.',
      },
      {
        id: 'm2',
        prompt: 'Quels actifs résistent le mieux en stagflation (inflation forte + croissance nulle) ?',
        options: [
          'Les obligations zéro-coupon à 30 ans',
          'L’or physique, le monétaire CORRA et les valeurs à fort pricing power',
          'Les sociétés non rentables très endettées',
        ],
        correctIndex: 1,
        explanation:
          'Correct : le monétaire capte la hausse des taux courts et l’or couvre la dépréciation monétaire.',
      },
    ],
  },
  {
    id: 'strategies',
    indexLabel: '04. Exécution & Frais',
    title: 'DCA, Frais RFG & Fiscalité CELI / REER vs Non-Enregistré',
    rules: [
      {
        label: 'Écart de frais composés',
        metric: '0,20 % vs 1,85 %',
        detail: '+45 k$ conservés sur 20 ans (450 $/mois à 7,5 %)',
      },
      {
        label: 'Enveloppes fiscales CAD',
        metric: 'CELI 0 % impôt',
        detail: 'Croissance et retraits libres d’impôt vs compte non-enregistré',
      },
      {
        label: 'Lissage du point d’entrée',
        metric: 'DCA programmé',
        detail: 'Acquiert plus d’unités lors des replis de marché',
      },
    ],
    questions: [
      {
        id: 's1',
        prompt: 'Mécanisme mathématique du DCA mensuel lors d’un repli boursier de -25 % ?',
        options: [
          'Un montant fixe achète 33 % de parts supplémentaires, abaissant le PRU',
          'Il bloque la valeur liquidative de l’ETF',
          'Il supprime la volatilité de l’indice',
        ],
        correctIndex: 0,
        explanation:
          'Exact : la moyenne harmonique des prix d’achat abaisse le prix de revient unitaire (PRU).',
      },
      {
        id: 's2',
        prompt: 'Pourquoi 1,65 % de frais de gestion annuels supplémentaires amputent-ils jusqu’à 25 % du gain sur 20 ans ?',
        options: [
          'Les frais ne s’appliquent qu’à la sortie',
          'Les frais prélevés chaque année cessent eux-mêmes de capitaliser des intérêts composés',
          'Les frais augmentent le taux directeur BCE',
        ],
        correctIndex: 1,
        explanation:
          'Parfait : l’érosion des frais est exponentielle, exactement comme la capitalisation.',
      },
    ],
  },
];

interface InteractiveAcademyViewProps {
  completedQuestionIds: string[];
  onMarkQuestionCompleted: (questionId: string) => void;
  onResetProgress: () => void;
}

export const InteractiveAcademyView: React.FC<InteractiveAcademyViewProps> = ({
  completedQuestionIds,
  onMarkQuestionCompleted,
  onResetProgress,
}) => {
  const [activeLessonId, setActiveLessonId] = useState<LessonModule['id']>('budget');
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});

  const [netIncome, setNetIncome] = useState<number>(2800);
  const [essentialExpenses, setEssentialExpenses] = useState<number>(1450);
  const [lifestyleExpenses, setLifestyleExpenses] = useState<number>(750);
  const [currentEmergencyCash, setCurrentEmergencyCash] = useState<number>(3500);

  const [mixEquities, setMixEquities] = useState<number>(55);
  const [mixBonds, setMixBonds] = useState<number>(25);
  const [mixCrypto, setMixCrypto] = useState<number>(8);

  const [simInflation, setSimInflation] = useState<number>(2.2);
  const [simCbRate, setSimCbRate] = useState<number>(2.5);

  const [feeMonthly, setFeeMonthly] = useState<number>(300);
  const [feeYears, setFeeYears] = useState<number>(20);
  const [activeFeeRate, setActiveFeeRate] = useState<number>(1.85);

  const activeLesson = useMemo(
    () => LESSONS.find((l) => l.id === activeLessonId) ?? LESSONS[0],
    [activeLessonId]
  );

  const totalQuestions = LESSONS.reduce((acc, l) => acc + l.questions.length, 0);
  const completedModulesCount = LESSONS.filter((l) =>
    l.questions.every((q) => completedQuestionIds.includes(q.id))
  ).length;

  const monthlySavingsCapacity = Math.max(0, netIncome - essentialExpenses - lifestyleExpenses);
  const savingsRatePct = netIncome > 0 ? (monthlySavingsCapacity / netIncome) * 100 : 0;
  const targetEmergencyFund = essentialExpenses * 4;
  const emergencyGap = Math.max(0, targetEmergencyFund - currentEmergencyCash);
  const monthsToSafety =
    monthlySavingsCapacity > 0 ? Math.ceil(emergencyGap / monthlySavingsCapacity) : null;

  const mixGold = Math.max(0, 100 - mixEquities - mixBonds - mixCrypto);
  const totalMixRaw = mixEquities + mixBonds + mixCrypto + mixGold || 100;
  const wEq = mixEquities / totalMixRaw;
  const wBd = mixBonds / totalMixRaw;
  const wCr = mixCrypto / totalMixRaw;
  const wGd = mixGold / totalMixRaw;
  const mixExpectedReturn = wEq * 8.4 + wBd * 4.0 + wCr * 15.5 + wGd * 5.8;
  const mixExpectedVol = (wEq * 15.5 + wBd * 6.2 + wCr * 58 + wGd * 13) * 0.82;
  const mixSharpe = (mixExpectedReturn - 2.2) / Math.max(1, mixExpectedVol);
  const mixCrisis2020 = wEq * -28 + wBd * 4 + wCr * -36 + wGd * 9;

  const macroAssetImpacts = useMemo(() => {
    const infShock = simInflation - 2.0;
    const rateShock = simCbRate - 2.25;
    return [
      {
        label: 'Actions Monde (ETF)',
        returnEst: Number((8.2 - infShock * 0.6 - rateShock * 1.1).toFixed(1)),
      },
      {
        label: 'Obligations Souveraines 10 ans',
        returnEst: Number((3.8 - infShock * 1.25 - rateShock * 1.4).toFixed(1)),
      },
      {
        label: 'Cryptomonnaies (BTC/ETH)',
        returnEst: Number((14.5 - infShock * 0.9 - rateShock * 2.9).toFixed(1)),
      },
      {
        label: 'Or Physique',
        returnEst: Number((5.8 + infShock * 1.35 - rateShock * 0.3).toFixed(1)),
      },
      {
        label: 'Fonds Monétaire CORRA ($ CAD)',
        returnEst: Number(Math.max(0.1, simCbRate - 0.05).toFixed(1)),
      },
    ];
  }, [simInflation, simCbRate]);

  const feeSeries = useMemo(
    () =>
      simulateFeeImpact({
        initialCapital: 10000,
        monthlyContribution: feeMonthly,
        years: feeYears,
        grossReturnPct: 7.5,
        etfFeePct: 0.2,
        activeFundFeePct: activeFeeRate,
      }),
    [feeMonthly, feeYears, activeFeeRate]
  );
  const feeLast = feeSeries[feeSeries.length - 1];

  const handleAnswer = (q: QuizQuestion, optIdx: number) => {
    setSelectedAnswers((prev) => ({ ...prev, [q.id]: optIdx }));
    if (optIdx === q.correctIndex) {
      onMarkQuestionCompleted(q.id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Compact Header & Mastery Bar */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 pb-4 border-b border-bordure">
        <div>
          <p className="text-xs font-medium text-texte-doux mb-0.5">
            4 simulateurs quantitatifs · Repères chiffrés CELI / REER · Validation par cas pratiques
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-texte">
            Laboratoire Pédagogique &amp; Modèles Financiers
          </h1>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="font-mono tabular-nums text-texte">
            Modules{' '}
            <span className="font-semibold text-succes-texte">
              {completedModulesCount}/{LESSONS.length}
            </span>{' '}
            · Quiz{' '}
            <span className="font-semibold text-texte">
              {completedQuestionIds.length}/{totalQuestions}
            </span>
          </div>
          {completedQuestionIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSelectedAnswers({});
                onResetProgress();
              }}
              className="min-h-11 min-w-11 inline-flex items-center gap-1 text-texte-doux hover:text-texte transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Réinitialiser</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 Module Cards */}
      <nav
        aria-label="Modules de formation financière"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        {LESSONS.map((lesson) => {
          const isCurrent = lesson.id === activeLessonId;
          const isDone = lesson.questions.every((q) =>
            completedQuestionIds.includes(q.id)
          );
          return (
            <button
              key={lesson.id}
              type="button"
              onClick={() => setActiveLessonId(lesson.id)}
              className={`min-h-11 text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                isCurrent
                  ? 'bg-surface-douce text-texte border-succes-texte/60'
                  : 'bg-surface text-texte border-bordure hover:bg-surface-douce/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs mb-1">
                <span className={isCurrent ? 'text-succes-texte font-medium' : 'text-texte-doux'}>
                  {lesson.indexLabel}
                </span>
                {isDone && (
                  <CheckCircle2
                    className="w-4 h-4 shrink-0 text-succes-texte"
                    aria-label="Module validé"
                  />
                )}
              </div>
              <div className="font-semibold text-xs sm:text-sm leading-snug text-texte">
                {lesson.title}
              </div>
            </button>
          );
        })}
      </nav>

      {/* Two-Zone Interactive Lab + Validation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <section className="lg:col-span-7 bg-surface border border-bordure rounded-lg p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-bordure pb-3">
            <h2 className="text-base font-bold text-texte">{activeLesson.title}</h2>
            <span className="text-xs font-mono text-succes-texte">{activeLesson.indexLabel}</span>
          </div>

          {activeLesson.id === 'budget' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="bud-income"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Revenu net</span>
                    <span className="font-mono tabular-nums">{formatEur(netIncome, 0)}</span>
                  </label>
                  <input
                    id="bud-income"
                    type="range"
                    min="1200"
                    max="7000"
                    step="100"
                    value={netIncome}
                    onChange={(e) => setNetIncome(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bud-essential"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Charges fixes (cible ≤50%)</span>
                    <span className="font-mono tabular-nums">
                      {formatEur(essentialExpenses, 0)}
                    </span>
                  </label>
                  <input
                    id="bud-essential"
                    type="range"
                    min="600"
                    max="4500"
                    step="50"
                    value={essentialExpenses}
                    onChange={(e) => setEssentialExpenses(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bud-lifestyle"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Dépenses variables (≤30%)</span>
                    <span className="font-mono tabular-nums">
                      {formatEur(lifestyleExpenses, 0)}
                    </span>
                  </label>
                  <input
                    id="bud-lifestyle"
                    type="range"
                    min="100"
                    max="2500"
                    step="50"
                    value={lifestyleExpenses}
                    onChange={(e) => setLifestyleExpenses(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="bud-cash"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Trésorerie disponible</span>
                    <span className="font-mono tabular-nums">
                      {formatEur(currentEmergencyCash, 0)}
                    </span>
                  </label>
                  <input
                    id="bud-cash"
                    type="range"
                    min="0"
                    max="20000"
                    step="250"
                    value={currentEmergencyCash}
                    onChange={(e) => setCurrentEmergencyCash(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Dual Visual Comparison: Actual vs 50/30/20 Benchmark */}
              <div className="p-3.5 bg-fond border border-bordure rounded-sm space-y-2.5">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-texte-doux">
                    <span>Votre répartition réelle</span>
                    <span>
                      Fixes {Math.round((essentialExpenses / netIncome) * 100)}% · Var.{' '}
                      {Math.round((lifestyleExpenses / netIncome) * 100)}% · Épargne{' '}
                      {Math.round(savingsRatePct)}%
                    </span>
                  </div>
                  <div className="h-3 w-full rounded-sm overflow-hidden flex bg-surface">
                    <div
                      style={{
                        // NOMBRE-NON-MONETAIRE : simulateur pédagogique règle 50/30/20
                        width: `${Math.min(100, (essentialExpenses / netIncome) * 100)}%`,
                      }}
                      className="bg-bordure-champ"
                    />
                    <div
                      style={{
                        // NOMBRE-NON-MONETAIRE : simulateur pédagogique dépenses loisirs
                        width: `${Math.min(100, (lifestyleExpenses / netIncome) * 100)}%`,
                      }}
                      className="bg-alerte-texte"
                    />
                    {/* NOMBRE-NON-MONETAIRE : simulateur pédagogique taux d'épargne */}
                    <div
                      style={{ width: `${Math.max(0, savingsRatePct)}%` }}
                      className="bg-accent"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-texte-doux">
                    <span>Référence institutionnelle 50 / 30 / 20</span>
                    <span>50% · 30% · 20%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-sm overflow-hidden flex bg-surface opacity-60">
                    <div style={{ width: '50%' }} className="bg-bordure-champ" />
                    <div style={{ width: '30%' }} className="bg-alerte-texte" />
                    <div style={{ width: '20%' }} className="bg-accent" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="font-sans text-[11px] text-texte-doux">Capacité DCA</div>
                  <div className="text-sm font-semibold text-succes-texte mt-0.5">
                    {formatEur(monthlySavingsCapacity, 0)}/mois
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="font-sans text-[11px] text-texte-doux">Cible 4 mois</div>
                  <div className="text-sm font-semibold text-texte mt-0.5">
                    {formatEur(targetEmergencyFund, 0)}
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="font-sans text-[11px] text-texte-doux">Statut bourse</div>
                  <div className="text-xs font-sans font-semibold text-texte mt-0.5">
                    {emergencyGap === 0
                      ? '▲ Prêt à investir'
                      : monthsToSafety !== null
                        // NOMBRE-NON-MONETAIRE : simulateur pédagogique mois avant réserve
                        ? `◆ Palier à ${monthsToSafety} mois`
                        : '▼ Flux négatif'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeLesson.id === 'assets' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="mix-eq"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Actions</span>
                    <span className="font-mono tabular-nums">{Math.round(wEq * 100)}%</span>
                  </label>
                  <input
                    id="mix-eq"
                    type="range"
                    min="0"
                    max="90"
                    step="5"
                    value={mixEquities}
                    onChange={(e) => setMixEquities(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mix-bd"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Obligations</span>
                    <span className="font-mono tabular-nums">{Math.round(wBd * 100)}%</span>
                  </label>
                  <input
                    id="mix-bd"
                    type="range"
                    min="0"
                    max="80"
                    step="5"
                    value={mixBonds}
                    onChange={(e) => setMixBonds(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="mix-cr"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Crypto</span>
                    <span className="font-mono tabular-nums">{Math.round(wCr * 100)}%</span>
                  </label>
                  <input
                    id="mix-cr"
                    type="range"
                    min="0"
                    max="40"
                    step="2"
                    value={mixCrypto}
                    onChange={(e) => setMixCrypto(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Stacked Visual Allocation + Quantitative Gauges */}
              <div className="p-3.5 bg-fond border border-bordure rounded-sm space-y-3">
                <div className="h-3 w-full rounded-sm overflow-hidden flex bg-surface">
                  {/* NOMBRE-NON-MONETAIRE : allocation théorique pédagogique */}
                  <div style={{ width: `${wEq * 100}%` }} className="bg-accent" />
                  <div style={{ width: `${wBd * 100}%` }} className="bg-accent" />
                  {/* NOMBRE-NON-MONETAIRE : allocation théorique crypto/or */}
                  <div style={{ width: `${wCr * 100}%` }} className="bg-accent" />
                  <div style={{ width: `${wGd * 100}%` }} className="bg-alerte-texte" />
                </div>
                <div className="flex justify-between text-[11px] font-mono text-texte-doux">
                  <span>Actions {Math.round(wEq * 100)}%</span>
                  <span>Oblig. {Math.round(wBd * 100)}%</span>
                  <span>Crypto {Math.round(wCr * 100)}%</span>
                  <span>Or/Cash {Math.round(wGd * 100)}%</span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2.5 font-mono tabular-nums">
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="text-[11px] font-sans text-texte-doux">Espérance</div>
                  <div className="text-sm font-semibold text-succes-texte mt-0.5">
                    {formatPct(mixExpectedReturn, 1)}/an
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="text-[11px] font-sans text-texte-doux">Volatilité σ</div>
                  <div className="text-sm font-semibold text-texte mt-0.5">
                    {formatPct(mixExpectedVol, 1)}
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="text-[11px] font-sans text-texte-doux">Sharpe</div>
                  <div className="text-sm font-semibold text-succes-texte mt-0.5">
                    {mixSharpe.toFixed(2).replace('.', ',')}
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="text-[11px] font-sans text-texte-doux">Stress COVID</div>
                  <div className="text-sm font-semibold text-erreur-texte mt-0.5">
                    {formatSignedPct(mixCrisis2020, 1)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeLesson.id === 'market' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="sim-inf"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Inflation IPC</span>
                    <span className="font-mono tabular-nums">{formatPct(simInflation, 1)}</span>
                  </label>
                  <input
                    id="sim-inf"
                    type="range"
                    min="0.5"
                    max="7.0"
                    step="0.5"
                    value={simInflation}
                    onChange={(e) => setSimInflation(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="sim-rate"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Taux directeur BCE</span>
                    <span className="font-mono tabular-nums">{formatPct(simCbRate, 2)}</span>
                  </label>
                  <input
                    id="sim-rate"
                    type="range"
                    min="0.0"
                    max="5.5"
                    step="0.25"
                    value={simCbRate}
                    onChange={(e) => setSimCbRate(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="p-3.5 bg-fond border border-bordure rounded-sm space-y-2.5">
                {macroAssetImpacts.map((row) => {
                  const positive = row.returnEst >= 0;
                  const barPct = Math.min(100, Math.abs(row.returnEst) * 5.5);
                  return (
                    <div key={row.label} className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-texte">{row.label}</span>
                        <span
                          className={`font-mono tabular-nums font-semibold ${
                            positive ? 'text-succes-texte' : 'text-erreur-texte'
                          }`}
                        >
                          {positive ? '▲ ' : '▼ '}
                          {formatSignedPct(row.returnEst, 1)}/an
                        </span>
                      </div>
                      <div className="h-2 bg-surface rounded-sm overflow-hidden">
                        {/* NOMBRE-NON-MONETAIRE : barre comparative pédagogique */}
                        <div
                          style={{ width: `${barPct}%` }}
                          className={`h-full ${positive ? 'bg-accent' : 'bg-erreur-texte'}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeLesson.id === 'strategies' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="fee-monthly"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>DCA mensuel</span>
                    <span className="font-mono tabular-nums">{formatEur(feeMonthly, 0)}</span>
                  </label>
                  <input
                    id="fee-monthly"
                    type="range"
                    min="50"
                    max="1000"
                    step="50"
                    value={feeMonthly}
                    onChange={(e) => setFeeMonthly(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="fee-years"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Horizon</span>
                    {/* NOMBRE-NON-MONETAIRE : curseur pédagogique de durée */}
                    <span className="font-mono tabular-nums">{feeYears} ans</span>
                  </label>
                  <input
                    id="fee-years"
                    type="range"
                    min="5"
                    max="30"
                    step="1"
                    value={feeYears}
                    onChange={(e) => setFeeYears(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label
                    htmlFor="fee-active"
                    className="flex justify-between text-xs font-medium text-texte mb-1"
                  >
                    <span>Frais fonds actif</span>
                    <span className="font-mono tabular-nums">
                      {formatPct(activeFeeRate, 2)}
                    </span>
                  </label>
                  <input
                    id="fee-active"
                    type="range"
                    min="0.8"
                    max="2.5"
                    step="0.05"
                    value={activeFeeRate}
                    onChange={(e) => setActiveFeeRate(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="w-full overflow-x-auto">
                <svg
                  viewBox="0 0 600 175"
                  className="w-full h-auto"
                  role="img"
                  aria-label="Comparaison ETF faibles frais contre fonds à frais élevés"
                >
                  {(() => {
                    const maxF = Math.max(feeLast.etfValue, 1000) * 1.06;
                    const xF = (i: number) => 52 + (i / (feeSeries.length - 1)) * 530;
                    const yF = (v: number) => 12 + 140 - (v / maxF) * 140;
                    return (
                      <>
                        {[0, 0.5, 1].map((r) => (
                          <g key={r}>
                            <line
                              x1="52"
                              y1={yF(maxF * r)}
                              x2="582"
                              y2={yF(maxF * r)}
                              stroke={VALORIA_PALETTE.gridSlate}
                              strokeDasharray="3 3"
                            />
                            <text
                              x="46"
                              y={yF(maxF * r) + 4}
                              textAnchor="end"
                              className="fill-texte-doux text-[10px] font-mono"
                            >
                              {formatCompactEur(maxF * r)}
                            </text>
                          </g>
                        ))}
                        <path
                          d={feeSeries
                            .map(
                              (p, i) =>
                                `${i === 0 ? 'M' : 'L'}${xF(i).toFixed(1)},${yF(p.invested).toFixed(1)}`
                            )
                            .join(' ')}
                          fill="none"
                          stroke={VALORIA_PALETTE.textSlate}
                          strokeWidth="1.4"
                          strokeDasharray="2 2"
                        />
                        <path
                          d={feeSeries
                            .map(
                              (p, i) =>
                                `${i === 0 ? 'M' : 'L'}${xF(i).toFixed(1)},${yF(p.activeValue).toFixed(1)}`
                            )
                            .join(' ')}
                          fill="none"
                          stroke={VALORIA_PALETTE.redLight}
                          strokeWidth="2"
                        />
                        <path
                          d={feeSeries
                            .map(
                              (p, i) =>
                                `${i === 0 ? 'M' : 'L'}${xF(i).toFixed(1)},${yF(p.etfValue).toFixed(1)}`
                            )
                            .join(' ')}
                          fill="none"
                          stroke={VALORIA_PALETTE.teal}
                          strokeWidth="2.4"
                        />
                      </>
                    );
                  })()}
                </svg>
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="font-sans text-[11px] text-texte-doux">ETF (0,20 %/an)</div>
                  <div className="font-semibold text-succes-texte mt-0.5">
                    {formatEur(feeLast.etfValue, 0)}
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="font-sans text-[11px] text-texte-doux">
                    Fonds ({formatPct(activeFeeRate, 2)})
                  </div>
                  <div className="font-semibold text-texte mt-0.5">
                    {formatEur(feeLast.activeValue, 0)}
                  </div>
                </div>
                <div className="p-2.5 bg-fond border border-bordure rounded-sm">
                  <div className="font-sans text-[11px] text-texte-doux">Gain frais évités</div>
                  <div className="font-semibold text-succes-texte mt-0.5">
                    +{formatEur(feeLast.feesLost, 0)}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Compact 3-Column Institutional Reference Rules (Replaces Long Prose Block) */}
          <div className="pt-3 border-t border-bordure grid grid-cols-1 sm:grid-cols-3 gap-3">
            {activeLesson.rules.map((r) => (
              <div
                key={r.label}
                className="p-3 bg-fond border border-bordure rounded-sm space-y-0.5"
              >
                <div className="text-[11px] text-texte-doux">{r.label}</div>
                <div className="text-xs font-mono font-semibold text-succes-texte">
                  {r.metric}
                </div>
                <div className="text-[11px] text-texte leading-snug">{r.detail}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Right Zone: Validation Cases */}
        <aside className="lg:col-span-5 bg-surface border border-bordure rounded-lg p-5 space-y-5">
          <div className="border-b border-bordure pb-3">
            <h3 className="text-base font-semibold text-texte">
              Validation des acquis
            </h3>
          </div>

          <div className="space-y-5 divide-y divide-bordure">
            {activeLesson.questions.map((q, qIndex) => {
              const chosen = selectedAnswers[q.id];
              const isValidated = completedQuestionIds.includes(q.id);

              return (
                <div key={q.id} className={qIndex > 0 ? 'pt-5 space-y-2.5' : 'space-y-2.5'}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-texte leading-snug">
                      {qIndex + 1}. {q.prompt}
                    </p>
                    {isValidated && (
                      <span className="text-[11px] font-medium text-succes-texte shrink-0">
                        ▲ Validé
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {q.options.map((opt, optIdx) => {
                      const isSelected = chosen === optIdx;
                      const isRight = optIdx === q.correctIndex;

                      let btnStyle =
                        'bg-fond/70 text-texte border-bordure hover:bg-surface-douce';
                      if (isSelected) {
                        btnStyle = isRight
                          ? 'bg-succes-fond text-succes-texte border-succes-texte font-medium'
                          : 'bg-erreur-fond text-erreur-texte border-erreur-texte';
                      }

                      return (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleAnswer(q, optIdx)}
                          className={`min-h-11 w-full text-left px-3 py-2 text-xs rounded-md border transition-colors cursor-pointer ${btnStyle}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  {chosen !== undefined && (
                    <p
                      role="status"
                      className={`text-[11px] leading-snug pt-0.5 ${
                        chosen === q.correctIndex ? 'text-succes-texte' : 'text-erreur-texte'
                      }`}
                    >
                      {chosen === q.correctIndex
                        ? q.explanation
                        : 'Incorrect — ajustez les curseurs du modèle à gauche pour observer l’impact.'}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
};
