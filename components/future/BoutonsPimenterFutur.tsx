import React, { useRef } from 'react';
import type { ProjectionConfig, RetirementGoal } from '../../types';
import { Icon } from '../ui/Icon';

interface BoutonsPimenterFuturProps {
    projection: ProjectionConfig;
    retirementGoal: RetirementGoal;
    runMC: boolean;
    setRunMC: (v: boolean) => void;
    /** Applique immédiatement les changements de projection/retraite et révèle la courbe future sans latence. */
    onInstantUpdate: (nextProjection: ProjectionConfig, nextRetirementGoal?: RetirementGoal) => void;
    /** Valeur nette projetée en fin d'horizon (pour retour visuel instantané). */
    finalNetWorth?: number | null;
    /** Ouvre le panneau détaillé des leviers et hypothèses si l'utilisateur souhaite fouiller. */
    onOpenDeepControls?: () => void;
    deepControlsOpen?: boolean;
}

/**
 * Barre de scénarios instantanés (« Pimenter le futur ») de style Google Finance.
 * Chaque bouton agit comme une puce interactive à bascule (toggle) qui met à jour
 * la trajectoire future instantanément sans écran intermédiaire.
 */
export const BoutonsPimenterFutur: React.FC<BoutonsPimenterFuturProps> = ({
    projection,
    retirementGoal,
    runMC,
    setRunMC,
    onInstantUpdate,
    onOpenDeepControls,
    deepControlsOpen,
}) => {
    // Mémorise les valeurs initiales de base avant activation des puces pour restaurer fidèlement au clic retour
    const baseRef = useRef<{
        retirementAge: number;
        returnRate: number;
        returnRates: NonNullable<ProjectionConfig['returnRates']>;
    }>({
        retirementAge: retirementGoal.targetAge || 65,
        returnRate: projection.returnRate ?? 6,
        returnRates: projection.returnRates ?? {
            celi: 6,
            reer: 6,
            nonReg: 6,
            crypto: 8,
            cash: 2,
        },
    });

    const epargneBoostActif = (projection.appliedSavingsMultiplier ?? 1) > 1.05;
    const retraiteDevanceeActive = (retirementGoal.targetAge || 65) <= baseRef.current.retirementAge - 3;
    const rendementBoostActif = (projection.returnRates?.celi ?? projection.returnRate ?? 6) >= (baseRef.current.returnRates.celi ?? 6) + 1.4;
    const chocBoursierActif = Boolean(projection.stressTestEnabled);
    const levierSmithActif = Boolean(projection.useSmithManoeuvre);

    const nbActifs =
        (epargneBoostActif ? 1 : 0) +
        (retraiteDevanceeActive ? 1 : 0) +
        (rendementBoostActif ? 1 : 0) +
        (chocBoursierActif ? 1 : 0) +
        (levierSmithActif ? 1 : 0) +
        (runMC ? 1 : 0);

    const basculerEpargneBoost = () => {
        const suivant = epargneBoostActif ? 1 : 1.25;
        onInstantUpdate({
            ...projection,
            appliedSavingsMultiplier: suivant,
        });
    };

    const basculerRetraiteDevancee = () => {
        if (!retraiteDevanceeActive) {
            baseRef.current.retirementAge = retirementGoal.targetAge || 65;
            const nouvelAge = Math.max(45, baseRef.current.retirementAge - 3);
            onInstantUpdate(projection, {
                ...retirementGoal,
                targetAge: nouvelAge,
            });
        } else {
            onInstantUpdate(projection, {
                ...retirementGoal,
                targetAge: baseRef.current.retirementAge,
            });
        }
    };

    const basculerRendementBoost = () => {
        if (!rendementBoostActif) {
            const actuels = projection.returnRates ?? {
                celi: projection.returnRate ?? 6,
                reer: projection.returnRate ?? 6,
                nonReg: projection.returnRate ?? 6,
                crypto: 8,
                cash: 2,
            };
            baseRef.current.returnRate = projection.returnRate ?? 6;
            baseRef.current.returnRates = { ...actuels };
            onInstantUpdate({
                ...projection,
                returnRate: Number((baseRef.current.returnRate + 1.5).toFixed(2)),
                returnRates: {
                    ...actuels,
                    celi: Number((actuels.celi + 1.5).toFixed(2)),
                    reer: Number((actuels.reer + 1.5).toFixed(2)),
                    nonReg: Number((actuels.nonReg + 1.5).toFixed(2)),
                },
            });
        } else {
            onInstantUpdate({
                ...projection,
                returnRate: baseRef.current.returnRate,
                returnRates: { ...baseRef.current.returnRates },
            });
        }
    };

    const basculerChocBoursier = () => {
        if (!chocBoursierActif) {
            onInstantUpdate({
                ...projection,
                stressTestEnabled: true,
                stressTestDrop: projection.stressTestDrop || 25,
                stressTestYear: projection.stressTestYear || 3,
                stressTestRecoveryMonths: projection.stressTestRecoveryMonths || 24,
            });
        } else {
            onInstantUpdate({
                ...projection,
                stressTestEnabled: false,
            });
        }
    };

    const basculerLevierSmith = () => {
        onInstantUpdate({
            ...projection,
            useSmithManoeuvre: !levierSmithActif,
        });
    };

    const basculerMonteCarlo = () => {
        setRunMC(!runMC);
        onInstantUpdate(projection);
    };

    const toutReinitialiser = () => {
        if (runMC) setRunMC(false);
        onInstantUpdate(
            {
                ...projection,
                appliedSavingsMultiplier: 1,
                returnRate: baseRef.current.returnRate,
                returnRates: { ...baseRef.current.returnRates },
                stressTestEnabled: false,
                useSmithManoeuvre: false,
            },
            {
                ...retirementGoal,
                targetAge: baseRef.current.retirementAge,
            },
        );
    };

    return (
        <div
            data-testid="boutons-pimenter-futur"
            role="group"
            aria-label="Boutons rapides pour simuler le futur"
            className="flex items-center gap-1.5 pt-2 border-t border-bordure overflow-x-auto no-scrollbar sm:flex-wrap pb-0.5"
        >
            <button
                type="button"
                aria-pressed={epargneBoostActif}
                onClick={basculerEpargneBoost}
                className={`gf-chip touch-target whitespace-nowrap ${epargneBoostActif ? 'gf-chip-active' : ''}`}
                title="Augmenter le rythme d’épargne mensuel de 25 % pour mesurer l’effet boule de neige"
            >
                <span aria-hidden="true">💰</span>
                <span>Épargne +25 %</span>
            </button>

            <button
                type="button"
                aria-pressed={retraiteDevanceeActive}
                onClick={basculerRetraiteDevancee}
                className={`gf-chip touch-target whitespace-nowrap ${retraiteDevanceeActive ? 'gf-chip-active' : ''}`}
                title="Avancer l’âge cible de la retraite de 3 ans"
            >
                <span aria-hidden="true">🏖️</span>
                <span>Retraite −3 ans</span>
            </button>

            <button
                type="button"
                aria-pressed={rendementBoostActif}
                onClick={basculerRendementBoost}
                className={`gf-chip touch-target whitespace-nowrap ${rendementBoostActif ? 'gf-chip-active' : ''}`}
                title="Ajouter +1,5 % de rendement annuel sur les placements (CELI, REER, Non-enreg.)"
            >
                <span aria-hidden="true">📈</span>
                <span>Rendement +1,5 %</span>
            </button>

            <button
                type="button"
                aria-pressed={chocBoursierActif}
                onClick={basculerChocBoursier}
                className={`gf-chip touch-target whitespace-nowrap ${chocBoursierActif ? 'gf-chip-active' : ''}`}
                title="Simuler un krach boursier de −25 % à l’année 3 avec reprise sur 24 mois"
            >
                <span aria-hidden="true">🌩️</span>
                <span>Krach −25 %</span>
            </button>

            <button
                type="button"
                aria-pressed={levierSmithActif}
                onClick={basculerLevierSmith}
                className={`gf-chip touch-target whitespace-nowrap ${levierSmithActif ? 'gf-chip-active' : ''}`}
                title="Activer ou désactiver la Manœuvre Smith (conversion de l’hypothèque en levier d’investissement déductible)"
            >
                <span aria-hidden="true">🔄</span>
                <span>Manœuvre Smith</span>
            </button>

            <button
                type="button"
                aria-pressed={runMC}
                onClick={basculerMonteCarlo}
                className={`gf-chip touch-target whitespace-nowrap ${runMC ? 'gf-chip-active' : ''}`}
                title="Afficher le couloir d’incertitude probabiliste Monte Carlo (P10 / P50 / P90)"
            >
                <span aria-hidden="true">🎲</span>
                <span>Couloir Monte Carlo</span>
            </button>

            {nbActifs > 0 && (
                <button
                    type="button"
                    onClick={toutReinitialiser}
                    className="touch-target px-2 text-xs font-medium text-ink-300 hover:text-ink-100 underline underline-offset-2 whitespace-nowrap shrink-0"
                >
                    Réinitialiser ({nbActifs})
                </button>
            )}

            {onOpenDeepControls && (
                <button
                    type="button"
                    aria-expanded={deepControlsOpen}
                    onClick={onOpenDeepControls}
                    className="gf-chip touch-target ml-auto text-ink-200 hover:text-ink-50 whitespace-nowrap shrink-0"
                >
                    <Icon name="settings" size={14} />
                    <span>{deepControlsOpen ? 'Fermer' : 'Réglages'}</span>
                </button>
            )}
        </div>
    );
};
