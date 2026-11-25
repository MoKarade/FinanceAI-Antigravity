// components/Profile.tsx
// PH3 (brief Marc) — Onglet PROFIL UNIFIÉ : regroupe TOUT le setup utilisateur (identité, salaire,
// fiscal, répartition couple, carrière & rémunération variable, paramètres de retraite, enfants),
// jusqu'ici éparpillé dans Configuration, Impôts, Budget, Retraite, Enfant. Migration UI PURE :
// chaque sous-composant lit/écrit les MÊMES clés store qu'avant → ZÉRO perte de données.
//
// [PROFIL-SOUS-ONGLETS 2026-08-17] Les cinq groupes empilés deviennent QUATRE sous-onglets.
// Découpage choisi par Marc (`docs/adr/0012-quatre-decisions-de-marc-2026-08-17.md`) : Identité · Revenus · Profils enregistrés.
// ⚠️ Ses trois bacs ne couvraient pas Retraite ni Enfants — d'où un 4e onglet plutôt que de les
// rétrograder sous « Revenus » (faux : ce ne sont pas des revenus d'aujourd'hui) ou de les perdre.
// Écart signalé à Marc, pas décidé en silence.
//
// ⚠️ Idiome REPRIS de `Retirement.tsx` / `BudgetWorkspace.tsx` (Lots 4 et 5), à l'identique :
// `role="tablist"` + boutons `role="tab"`. Ne PAS inventer un 4e patron de sous-onglets dans le
// dépôt — la cohérence de navigation compte plus qu'une amélioration locale. La lacune commune aux
// trois (pas de `role="tabpanel"` ni d'`aria-controls`) est réelle mais se corrige en UN ticket sur
// les trois écrans, pas en divergeant ici : `[A11Y-SUBTABS-TABPANEL]`.
import React, { useState } from 'react';
import { useFinanceStore } from '../store/useFinanceStore';
import { Tab } from '../types';
import { usePendingFocus } from '../utils/usePendingFocus';
import { PageHeader } from './ui/PageHeader';
import type { IconName } from './ui/Icon';
import { SubTabs, TabPanel } from './ui/SubTabs';
import { UsersCard } from './settings/sections/UsersCard';
import { SavedProfilesCard } from './profile/SavedProfilesCard';
import { UserConfigFields, RepartitionField } from './settings/UserConfigFields';
import { RetirementSettingsCard } from './retirement/RetirementSettingsCard';
import { RetirementIncomeCard } from './retirement/RetirementIncomeCard';

type ProfileSubTab = 'identite' | 'revenus' | 'retraite' | 'profils';

const PROFILE_SUB_TABS: ReadonlyArray<{ id: ProfileSubTab; label: string; icon: IconName }> = [
    { id: 'identite', label: 'Identité', icon: 'users' },
    { id: 'revenus', label: 'Revenus', icon: 'cash' },
    { id: 'retraite', label: 'Retraite et enfants', icon: 'retirement' },
    { id: 'profils', label: 'Profils enregistrés', icon: 'settings' },
];

/**
 * [BANDEAUX-VERS-PROFIL] Sous-onglet qui porte une section de deep-link (`data-focus-section`) :
 * il doit être OUVERT au montage, sinon le champ visé n'est pas dans le DOM et le défilement ne
 * trouve rien. `null` : section inconnue → l'onglet par défaut.
 */
function sousOngletPourSection(section: string | null | undefined): ProfileSubTab | null {
    if (!section) return null;
    if (/^profile-user\d-(card|name|age)$/.test(section)) return 'identite';
    if (/^profile-user\d-(grossSalary|netSalary)$/.test(section)) return 'revenus';
    if (/^profile-(retirementAge|lifeExpectancy|retirementIncome)$/.test(section)) return 'retraite';
    return null;
}

/** Petit intertitre de regroupement style Google Finance (les sous-composants rendent déjà leurs propres Cards). */
const GroupTitle: React.FC<{ children: React.ReactNode; ticker?: string }> = ({ children, ticker }) => (
    <div className="gf-row flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-surface border border-bordure mt-2 -mb-1">
        <h2 className="text-meta font-bold uppercase tracking-wider text-ink-200">{children}</h2>
        {ticker && (
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                {ticker}
            </span>
        )}
    </div>
);

export const Profile: React.FC = () => {
    const config = useFinanceStore((s) => s.config);
    const setConfig = (c: typeof config) => useFinanceStore.getState().setAppState({ config: c });
    const pendingFocus = useFinanceStore((s) => s.pendingFocus);
    // Deep-link (bandeaux « donnée manquante », prérequis de page) : on démarre sur le sous-onglet
    // qui porte le champ, pour qu'il soit monté quand `usePendingFocus` le cherche.
    const [subTab, setSubTab] = useState<ProfileSubTab>(() => {
        if (pendingFocus && pendingFocus.tab === Tab.PROFILE && Date.now() <= pendingFocus.expiresAt) {
            return sousOngletPourSection(pendingFocus.section) ?? 'identite';
        }
        return 'identite';
    });
    usePendingFocus(Tab.PROFILE);

    return (
        <div className="space-y-6 stagger-in pb-20">
            {/* [S5-REFONTE-PROFIL] Maquettes : sous-onglets dans l'en-tête, phrase d'intro sous le filet. */}
            <PageHeader
                title="Profil"
                nav={
                    <SubTabs<ProfileSubTab>
                        idPrefix="profil"
                        label="Sections Profil"
                        tabs={PROFILE_SUB_TABS}
                        active={subTab}
                        onSelect={setSubTab}
                    />
                }
            />

            {/* Champs à remplir du profil. */}
            <TabPanel idPrefix="profil" tab="identite" when={subTab === 'identite'}>
                <div className="gf-terminal-card p-3 sm:p-4 bg-surface border border-bordure">
                    <UsersCard config={config} setConfig={setConfig} />
                </div>
            </TabPanel>

            <TabPanel idPrefix="profil" tab="revenus" when={subTab === 'revenus'}>
                <div className="gf-terminal-card p-3 sm:p-4 space-y-5 bg-surface border border-bordure">
                    <GroupTitle ticker="SALAIRES · ARC & RQ">Revenus &amp; fiscalité</GroupTitle>
                    <UserConfigFields section="salary" />
                    <UserConfigFields section="fiscal" />
                    <RepartitionField />

                    {/* PH3-c — champs santé/civil/emploi morts purgés ; reste carrière + rémunération variable. */}
                    <GroupTitle ticker="BONUS · RSU · OPTIONS">Carrière &amp; rémunération variable</GroupTitle>
                    <UserConfigFields section="detailed" />
                </div>
            </TabPanel>

            <TabPanel idPrefix="profil" tab="retraite" when={subTab === 'retraite'}>
                <div className="gf-terminal-card p-3 sm:p-4 space-y-5 bg-surface border border-bordure">
                    <GroupTitle ticker="RRQ · PSV · RENTES">Retraite</GroupTitle>
                    <RetirementSettingsCard />
                    <RetirementIncomeCard />

                    <GroupTitle ticker="FAMILLE · REEE">Enfants</GroupTitle>
                    <UserConfigFields section="children" />
                </div>
            </TabPanel>

            <TabPanel idPrefix="profil" tab="profils" when={subTab === 'profils'}>
                <div className="gf-terminal-card p-3 sm:p-4 bg-surface border border-bordure">
                    <SavedProfilesCard config={config} setConfig={setConfig} />
                </div>
            </TabPanel>
        </div>
    );
};
