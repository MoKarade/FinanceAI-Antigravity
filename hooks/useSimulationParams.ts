// hooks/useSimulationParams.ts
// PH2-c (clé de voûte) — assemble les `SimulationParams` + les dérivations passé/présent
// À PARTIR DU STORE UNIQUEMENT (self-contained), pour que le MÊME calcul de params serve
// à la fois le moteur app-level (`ProjectionEngine`) ET l'affichage de `FutureProjection`.
// Garantit la « source unique » : zéro divergence de params entre les deux call-sites.
//
// `calculatedMonthlySavings` est passé en argument car il est dérivé en amont par
// `useDerivedFinancials` (App) — on évite de le recalculer ici.

import { useMemo } from 'react';
import { computeCashLedgerDetailed } from '../services/startingCash';
import { useFinanceStore } from '../store/useFinanceStore';
import { useShallow } from 'zustand/shallow';
import { buildSimulationParams, derivePortfolioStartingACBs } from '../services/projection/buildSimulationParams';
import { avecHorizonEsperanceDeVie } from '../services/projection/horizon';
import { buildBehavioralProfileFromTransactions } from '../services/projection/behavioralProfile';
import { computeAccountReturnRatesForMode } from '../services/assetFundamentals';
import type { SimulationParams } from '../services/projection';
import { computeValoriaFutureForecast } from '../services/projection/valoriaFutureEngine';
import { computePastCurveCalibration, toSimulationPastCurveCalibration, type SimulationPastCurveCalibration } from '../services/projection/pastCurveCalibration';
import type { Transaction, User } from '../types';
import { usePastPortfolioHistory } from './usePastPortfolioHistory';
import { deriveStartingBalancesFromHistory } from '../services/history/startingBalancesFromHistory';
import { appliquerAutoriteCourtier, mentionAutoriteCourtier } from '../services/fintable/autoriteCourtier';
import { tauxCourantsDepuisEtat, reconcileBrokerBalances } from '../services/fintable/brokerBalances';
import { holdingsCadByRegime, jumeauxPorteursDepuisActifs } from '../services/fintable/holdingsByRegime';
import { useMonthEpoch, useTodayIsoLocal } from './useTodayIsoLocal';

export { useTodayIsoLocal } from './useTodayIsoLocal';

const EMPTY_ARRAY: never[] = [];

interface SimulationParamsBundle {
    /** Entrée du moteur : `calculateFutureProjection(params, …)`. */
    params: SimulationParams;
    /** Reconstruction du portefeuille passé (sert aussi au préfixe « passé réel » du graphe). */
    pastHistory: ReturnType<typeof usePastPortfolioHistory>;
    /** Soldes de placement de DÉPART (continuité passé↔futur au mois 0). */
    liveCSVBalances: ReturnType<typeof deriveStartingBalancesFromHistory>;
    /** [FINTABLE-AUTORITE-AUJOURDHUI] La phrase qui explique la marche au raccord, ou `''`.
     *  Remontée jusqu'ici plutôt que recalculée dans le composant : le FAIT vient du module qui
     *  DÉCIDE, jamais d'une seconde lecture des mêmes champs
     *  (`UN-LOT-QUI-CHANGE-CE-QU-UN-ECRAN-MONTRE-PERIME-CE-QU-IL-AFFIRME`). */
    mentionAutoriteCourtier: string;
    /** Cash de départ reconstitué (soldes initiaux + flux de transactions). */
    calculatedStartingCash: number;
    startYear: number;
    startMonth: number;
    todayMonthIndex: number;
    pastCurveCalibration?: SimulationPastCurveCalibration;
}

/**
 * Source unique des `SimulationParams`. Lit toutes les tranches du store via un seul
 * sélecteur `useShallow` (références stables → recalcul seulement quand une tranche change),
 * réplique à l'identique les dérivations qui vivaient dans `FutureProjection` (extraction LITTÉRALE ;
 * `buildSimulationParams` est verrouillé par tests/services/buildSimulationParams.parity.test.ts et
 * le moteur de bout en bout par tests/components/ProjectionEngine.test.tsx — pas de test DIRECT du
 * hook, cf BACKLOG).
 */
export function useSimulationParams(calculatedMonthlySavings: number): SimulationParamsBundle {
    const {
        projection: storeProjection, config, realEstateGoals, debts, childGoals, travelGoals, lifeEvents,
        retirementGoal, financialGoals, budgetItems, initialBalances, transactions,
        insurancePolicies, vehicleReplacements, majorRenovations, charitableGoals,
        rentalProperties, privateBusinesses,
    } = useFinanceStore(useShallow((st) => ({
        projection: st.projection,
        config: st.config,
        realEstateGoals: st.realEstateGoals ?? EMPTY_ARRAY,
        debts: st.debts ?? EMPTY_ARRAY,
        childGoals: st.childGoals ?? EMPTY_ARRAY,
        travelGoals: st.travelGoals ?? EMPTY_ARRAY,
        lifeEvents: st.lifeEvents ?? EMPTY_ARRAY,
        retirementGoal: st.retirementGoal,
        financialGoals: st.financialGoals ?? EMPTY_ARRAY,
        budgetItems: st.budgetItems ?? EMPTY_ARRAY,
        initialBalances: st.initialBalances,
        transactions: st.transactions ?? EMPTY_ARRAY,
        insurancePolicies: st.insurancePolicies ?? EMPTY_ARRAY,
        vehicleReplacements: st.vehicleReplacements ?? EMPTY_ARRAY,
        majorRenovations: st.majorRenovations ?? EMPTY_ARRAY,
        charitableGoals: st.charitableGoals ?? EMPTY_ARRAY,
        rentalProperties: st.rentalProperties ?? EMPTY_ARRAY,
        privateBusinesses: st.privateBusinesses ?? EMPTY_ARRAY,
    })));

    // PH2-c-1 (résolu) : ce hook est monté 2× quand Futur est ouvert (ProjectionEngine + FutureProjection),
    // mais le fetch Finnhub de usePastPortfolioHistory est désormais DÉDUPLIQUÉ AU NIVEAU MODULE
    // (cache partagé + useSyncExternalStore) → un seul fetch, jonction passé↔futur cohérente.
    // A1/A3 — soldes de DÉPART dérivés de la même reconstruction que la courbe passée
    // (continuité passé↔futur au mois 0 : le futur démarre sur le portefeuille réel).
    const pastHistory = usePastPortfolioHistory();
    const soldesReconstruits = useMemo(
        () => deriveStartingBalancesFromHistory(pastHistory.points),
        [pastHistory.points],
    );

    // [FINTABLE-AUTORITE-AUJOURDHUI] Le total du COURTIER fait autorité sur le point de départ.
    //
    // ⚠️ C'est LE point d'injection : `liveCSVBalances` est à la fois le mois 0 du moteur et le
    // point sur lequel la courbe Futur démarre. Le poser ailleurs (dans un composant, dans une
    // carte) aurait donné une valeur affichée qui ne correspond à aucun calcul — la classe
    // `UN-CHIFFRE-QUI-SERT-DE-DENOMINATEUR-N-EST-PAS-UN-CHIFFRE-AFFICHE`, prise à l'envers.
    //
    // ⚠️ Rendu IDENTIQUE quand il n'y a rien à appliquer (pas de synchro Fintable, aucun régime
    // déclaré, total non fini) : pour qui n'utilise pas la synchro, ce lot ne déplace pas un dollar.
    const brokerBalances = useFinanceStore((s) => s.fintableBrokerBalances);
    const assetsPourRegime = useFinanceStore((s) => s.assets);
    const fxPourRegime = useFinanceStore((s) => s.fxRates);
    const fxSourcePourRegime = useFinanceStore((s) => s.fxRatesSource);
    const fxEstimePourRegime = useFinanceStore((s) => s.fxRatesEstimated);
    const valoriaRiskProfile = useFinanceStore((s) => s.valoriaRiskProfile);
    const autorite = useMemo(
        () => appliquerAutoriteCourtier(
            soldesReconstruits,
            // [FINTABLE-AUTORITE-PARTOUT étape 0] Reconversion AU TAUX DU JOUR : un compte en
            // devise étrangère écarté faute de taux à la synchro redevient convertible dès que le
            // vrai taux est connu, sans attendre la synchro suivante.
            reconcileBrokerBalances(
                brokerBalances,
                holdingsCadByRegime(assetsPourRegime, fxPourRegime),
                tauxCourantsDepuisEtat({ fxRates: fxPourRegime, fxRatesSource: fxSourcePourRegime, fxRatesEstimated: fxEstimePourRegime }),
            ),
            // [FINTABLE-AUTORITE-PARTOUT étape 3] Le fait « le jumeau porte-t-il quelque chose ? »
            // vient des AVOIRS, plus des soldes de départ : lu dans une base de calcul, le refus
            // `famille-mixte` répondait sur la base du moteur et ne pouvait pas tirer côté écran.
            jumeauxPorteursDepuisActifs(assetsPourRegime, fxPourRegime),
        ),
        [soldesReconstruits, brokerBalances, assetsPourRegime, fxPourRegime, fxSourcePourRegime, fxEstimePourRegime],
    );
    const liveCSVBalances = autorite.soldes;
    const mentionAutorite = useMemo(
        () => mentionAutoriteCourtier(autorite.ecartTotal, autorite.regimesAppliques),
        [autorite],
    );

    // [CASH-NAN-SILENT] SOURCE UNIQUE (`services/startingCash.ts`). C'est CETTE copie que consomme
    // `ProjectionEngine`, donc le cash de départ de toute la projection : elle faisait
    // `Number(v) || 0` sans la moindre trace, alors que le patron `HARDEN-*-NAN` est appliqué
    // 65 lignes plus haut dans `portfolio.ts` et dans `computeRawNetWorth`.
    // [ENG-INFINITY-NON-GARDE-A-LA-FRONTIERE] La variante DÉTAILLÉE : le total ne dit rien de ce que
    // le ledger a écarté, et c'est justement l'inventaire des termes jetés qui permet de REFUSER
    // (`TRACER-AU-LIEU-DE-JETER-DESARME-LA-GARDE-AVAL` — deux portes, une pour lire, une pour écrire).
    const ledgerCash = useMemo(
        () => computeCashLedgerDetailed(initialBalances, transactions as Transaction[]),
        [initialBalances, transactions],
    );
    const calculatedStartingCash = ledgerCash.cash;

    // La projection démarre AUJOURD'HUI (mois courant), pas au 1er janvier en dur :
    // passé reconstruit et futur projeté se rejoignent au point « aujourd'hui ».
    // [FUTUR-HIST-DAILY-REFRESH] « Aujourd'hui » (mois) AVANCE quand le mois calendaire change, même onglet ouvert
    // (avant : figé au MONTAGE via `useMemo([])`). Source PARTAGÉE module-level (une seule horloge pour les 2 montages
    // du hook → pas de divergence inter-instances, cf bloc ci-dessus). Granularité MOIS (passé/moteur mensuels).
    const monthEpoch = useMonthEpoch();
    const { startYear, startMonth } = useMemo(
        () => ({ startYear: Math.floor(monthEpoch / 12), startMonth: monthEpoch % 12 }),
        [monthEpoch],
    );

    const todayIsoPourDettes = useTodayIsoLocal();

    const todayMonthIndex = useMemo(() => {
        const now = new Date();
        return Math.max(0, (now.getFullYear() - startYear) * 12 + (now.getMonth() - startMonth));
    }, [startYear, startMonth]);

    // Lot 0 — assemblage AppState → SimulationParams = fonction PURE (réutilisable hors React).
    const params = useMemo<SimulationParams>(() => {
        const retMode = storeProjection?.returnAssumptionsMode;
        const baseHorizonProj = avecHorizonEsperanceDeVie(storeProjection, config, retirementGoal);
        const valoriaForecast = retMode === 'valoria_agents'
            ? computeValoriaFutureForecast({
                assets: assetsPourRegime ?? EMPTY_ARRAY,
                fxRates: fxPourRegime ?? {},
                riskProfile: valoriaRiskProfile,
                appliedReturnProfile: baseHorizonProj?.appliedReturnProfile,
                horizonYears: baseHorizonProj?.years ?? 30,
                cashRatePct: baseHorizonProj?.returnRates?.cash,
            })
            : null;
        const projection = valoriaForecast
            ? {
                ...baseHorizonProj,
                returnRates: valoriaForecast.summaryRates,
            }
            : (retMode === 'iqpf' || retMode === 'real_holdings')
                ? {
                    ...baseHorizonProj,
                    returnRates: computeAccountReturnRatesForMode(
                        retMode,
                        baseHorizonProj.returnRates,
                        assetsPourRegime ?? EMPTY_ARRAY,
                        fxPourRegime ?? {},
                    ),
                }
                : baseHorizonProj;

        const expMode = projection?.expenseProjectionMode;
        const behavioralProfile = expMode === 'real' || expMode === 'hybrid'
            ? (() => {
                const users = (config?.users ?? []) as unknown as User[];
                const netMonthly = users.reduce((s, u) => s + ((u?.netSalary || u?.salary || 0) as number), 0);
                const budgetTarget = Math.max(0, netMonthly - calculatedMonthlySavings);
                return buildBehavioralProfileFromTransactions(
                    transactions as Transaction[],
                    budgetTarget,
                    todayIsoPourDettes,
                    expMode,
                );
            })()
            : undefined;

        const acbOverrides = (retMode === 'real_holdings' || retMode === 'valoria_agents') && (assetsPourRegime?.length ?? 0) > 0
            ? (() => {
                const acbs = derivePortfolioStartingACBs(
                    assetsPourRegime ?? EMPTY_ARRAY,
                    fxPourRegime ?? {},
                    { nonReg: liveCSVBalances.NON_ENREG, crypto: liveCSVBalances.CRYPTO },
                );
                return { initialNonRegACB: acbs.nonRegACB, initialCryptoACB: acbs.cryptoACB };
            })()
            : {};

        return buildSimulationParams({
            // [HORIZON-ESPERANCE-DE-VIE] Durée = jusqu'à l'espérance de vie de la personne 1 (source
            // unique, même règle que deriveSimulationInputsFromState).
            projection: avecHorizonEsperanceDeVie(projection, config, retirementGoal),
            config,
            liveCSVBalances,
            calculatedStartingCash,
            termesFautifsCash: ledgerCash.termesFautifs,
            realEstateGoals,
            debts,
            // [DETTE-VIREMENTS-REELS] Les virements qui remboursent une dette liée à un marchand.
            transactions: transactions as Transaction[],
            // [DETTE-SOLDE-INSTANTANE-FIGE] Le JOUR, pas seulement le mois : un solde DATÉ se ramène à
            // aujourd'hui au prélèvement près. Même horloge partagée que `startYear`/`startMonth`
            // (`useTodayIsoLocal` lit le même store externe), donc aucune seconde source de temps.
            aujourdhuiIso: todayIsoPourDettes,
            childGoals,
            travelGoals,
            lifeEvents,
            retirementGoal,
            financialGoals,
            budgetItems,
            calculatedMonthlySavings,
            startYear,
            startMonth,
            insurancePolicies,
            vehicleReplacements,
            majorRenovations,
            charitableGoals,
            rentalProperties,
            privateBusinesses,
            behavioralProfile,
            ...acbOverrides,
            ...(valoriaForecast ? { valoriaSchedule: valoriaForecast.schedule } : {}),
        });
    }, [storeProjection, calculatedStartingCash, ledgerCash.termesFautifs, liveCSVBalances, realEstateGoals, debts, childGoals, travelGoals, lifeEvents, retirementGoal, config, budgetItems, calculatedMonthlySavings, insurancePolicies, vehicleReplacements, majorRenovations, charitableGoals, rentalProperties, privateBusinesses, financialGoals, startYear, startMonth, todayIsoPourDettes, transactions, assetsPourRegime, fxPourRegime, valoriaRiskProfile]);

    const pastCurveCalibration = useMemo(
        () =>
            toSimulationPastCurveCalibration(
                computePastCurveCalibration({
                    assets: assetsPourRegime ?? EMPTY_ARRAY,
                    fxRates: fxPourRegime ?? {},
                    transactions: transactions as Transaction[],
                    debts,
                    realEstateGoals,
                    calculatedStartingCash,
                    priorReturnPct:
                        typeof storeProjection?.returnRate === 'number' &&
                        Number.isFinite(storeProjection.returnRate)
                            ? storeProjection.returnRate
                            : 6.5,
                    referenceDateIso: todayIsoPourDettes,
                }),
            ),
        [
            assetsPourRegime,
            fxPourRegime,
            transactions,
            debts,
            realEstateGoals,
            calculatedStartingCash,
            storeProjection?.returnRate,
            todayIsoPourDettes,
        ],
    );

    return {
        params, pastHistory, liveCSVBalances, calculatedStartingCash,
        startYear, startMonth, todayMonthIndex,
        mentionAutoriteCourtier: mentionAutorite,
        ...(pastCurveCalibration ? { pastCurveCalibration } : {}),
    };
}
