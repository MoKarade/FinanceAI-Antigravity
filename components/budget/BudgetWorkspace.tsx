// components/budget/BudgetWorkspace.tsx
// G22-N3 — regroupe Budget + Planif/Abos en sous-onglets dans l'onglet « Budget ».
//
// L'ancien onglet « Planif & Abos » (Planning) est fusionné ici : on ne touche pas
// au composant Budget lui-même, on le compose avec Planning (charges fixes & abos).
//
// [REFONTE-NAV-L5] Le workspace porte désormais l'EN-TÊTE DE PAGE (h1 = TAB_LABELS,
// commun aux sous-onglets — un seul h1 par destination, comme Transactions)
// et consomme le deep-link `pendingFocus` venu de Transactions (« Voir au budget »
// sur une catégorie → section `poste:<nom>` → sous-onglet Budget + scroll au poste).
//
// [NAV-REMOVE-OBJECTIFS-TAB] L'onglet « Objectifs » (savingsGoals) a été retiré du
// produit (UI + moteur) — décision Marc 2026-08-27. Ce fichier n'a plus que trois
// sous-onglets : Budget / Charges fixes & Abos / Santé.

import React, { useEffect, useState } from 'react';
import { Tab, type Transaction, type BudgetConfig, type BudgetCategory } from '../../types';
import { TAB_LABELS } from '../../constants';
import { useFinanceStore } from '../../store/useFinanceStore';
import { usePendingFocus } from '../../utils/usePendingFocus';
import { Budget } from '../Budget';
import { Planning } from '../Planning';
import { HealthIndicator } from '../dashboard/HealthIndicator';
import { PageHeader } from '../ui/PageHeader';
import { type IconName } from '../ui/Icon';
import { showToast } from '../ui/Toast';
import { useViewportBelowLg } from '../../hooks/useViewportBelowLg';
import { isCoupleMode } from '../../services/couple/netWorthByOwner';
import { maybeRunDailyFintableSync } from '../../services/fintable/autoSync';
import { useBudgetPilotage, ChoixPeriode, NavigateurPeriode, ChoixPersonne } from './pilotage';
import { SubTabs, TabPanel } from '../ui/SubTabs';

interface BudgetWorkspaceProps {
    transactions: Transaction[];
    config: BudgetConfig;
    budgetItems: BudgetCategory[];
    setBudgetItems: (items: BudgetCategory[]) => void;
    apiKey: string;
}

type SubTab = 'budget' | 'fixed' | 'sante';

const SUB_TABS: ReadonlyArray<{ id: SubTab; label: string; icon: IconName }> = [
    { id: 'budget', label: 'Budget', icon: 'chart' },
    { id: 'fixed', label: 'Charges fixes et abonnements', icon: 'clock' },
    { id: 'sante', label: 'Santé', icon: 'health' }, // [PH4-D] indicateur de santé financière ramené du Dashboard
];

/** [REFONTE-NAV-L5] Section de deep-link → sous-onglet (même patron que Settings). */
function subTabForSection(section: string | null | undefined): SubTab | null {
    if (!section) return null;
    if (section.startsWith('poste:')) return 'budget';
    if (section === 'abonnements' || section === 'fixed') return 'fixed';
    if (section === 'sante') return 'sante';
    return null;
}

export const BudgetWorkspace: React.FC<BudgetWorkspaceProps> = ({
    transactions, config, budgetItems, setBudgetItems, apiKey,
}) => {
    // [REFONTE-NAV-L5] Deep-link : démarrer sur le sous-onglet ciblé pour que l'élément
    // `data-focus-section` soit monté quand usePendingFocus tente le scroll (patron Settings).
    const pendingFocus = useFinanceStore(s => s.pendingFocus);
    const [sub, setSub] = useState<SubTab>(() => {
        if (pendingFocus && pendingFocus.tab === Tab.BUDGET && Date.now() <= pendingFocus.expiresAt) {
            return subTabForSection(pendingFocus.section) ?? 'budget';
        }
        return 'budget';
    });
    // Consomme pendingFocus + scroll vers le poste ciblé (one-shot).
    usePendingFocus(Tab.BUDGET);

    // Rafraîchit la banque en arrière-plan à l'ouverture de Budget si configurée et âgée de > 5 min.
    const fintableToken = useFinanceStore((s) => s.apiKeys?.fintable ?? '');
    useEffect(() => {
        if (!fintableToken) return;
        let cancelled = false;
        void maybeRunDailyFintableSync({
            maxAgeMs: 5 * 60_000,
            attemptCooldownMs: 2 * 60_000,
            autoCreditCards: true,
        }).then((outcome) => {
            if (cancelled || !outcome.ran) return;
            if (outcome.report.error === null && outcome.report.transactionsAdded > 0) {
                showToast(`Budget actualisé : ${outcome.report.transactionsAdded} transaction(s) synchronisée(s).`, 'success');
            }
        });
        return () => { cancelled = true; };
    }, [fintableToken]);

    // [S5-REFONTE-BUDGET] En-tête des maquettes : onglets à côté du titre ; période, mois affiché et
    // personne à droite (sous-onglet Budget seulement). Sur mobile : le mois à droite du titre, la
    // période et la personne sous les onglets.
    const pilotage = useBudgetPilotage();
    const etroit = useViewportBelowLg();
    const noms: [string, string] | null = isCoupleMode(config.users)
        ? [config.users[0]?.name || 'P1', config.users[1]?.name || 'P2']
        : null;
    const surBudget = sub === 'budget';

    return (
        <div className="space-y-3 sm:space-y-5 stagger-in">
            {/* [REFONTE-NAV-L5] En-tête de page : titre = TAB_LABELS (cohérence de la destination
                Transactions), stable quel que soit le sous-onglet actif. */}
            <PageHeader
                title={TAB_LABELS[Tab.BUDGET]}
                nav={
                    <div className="overflow-x-auto no-scrollbar max-w-full">
                        <SubTabs<SubTab>
                            idPrefix="budget"
                            label="Sections Budget"
                            tabs={SUB_TABS}
                            active={sub}
                            onSelect={setSub}
                        />
                    </div>
                }
                actions={surBudget ? (
                    etroit ? <NavigateurPeriode p={pilotage} /> : (
                        <span className="flex flex-wrap items-center justify-end gap-2">
                            <ChoixPeriode p={pilotage} />
                            <NavigateurPeriode p={pilotage} />
                            {noms && <ChoixPersonne p={pilotage} noms={noms} />}
                        </span>
                    )
                ) : undefined}
            />
            {surBudget && etroit && (
                <div className="gf-terminal-card px-2.5 py-1.5 flex flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar bg-surface border border-bordure">
                    <ChoixPeriode p={pilotage} />
                    {noms && <ChoixPersonne p={pilotage} noms={noms} />}
                </div>
            )}

            <TabPanel idPrefix="budget" tab="budget" when={sub === 'budget'}>
                <Budget transactions={transactions} config={config} budgetItems={budgetItems} setBudgetItems={setBudgetItems} apiKey={apiKey} pilotage={pilotage} />
            </TabPanel>
            <TabPanel idPrefix="budget" tab="fixed" when={sub === 'fixed'}>
                <Planning transactions={transactions} apiKey={apiKey} />
            </TabPanel>
            <TabPanel idPrefix="budget" tab="sante" when={sub === 'sante'}>
                <HealthIndicator />
            </TabPanel>
        </div>
    );
};
