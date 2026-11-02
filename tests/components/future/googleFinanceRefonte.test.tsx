/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { GoogleFinanceHero } from '../../../components/future/GoogleFinanceHero';
import { BoutonsPimenterFutur } from '../../../components/future/BoutonsPimenterFutur';
import { HubConnexionsModal } from '../../../components/future/HubConnexionsModal';
import { useFinanceStore } from '../../../store/useFinanceStore';
import type { PointJour } from '../../../components/projection/panneauJour/sections';
import type { ProjectionConfig, RetirementGoal } from '../../../types';

describe('Refonte Google Finance — GoogleFinanceHero & BoutonsPimenterFutur', () => {
    beforeEach(() => {
        act(() => {
            useFinanceStore.getState().setPrivacyMode(false);
        });
    });

    afterEach(() => {
        act(() => {
            useFinanceStore.getState().setPrivacyMode(false);
        });
        cleanup();
    });

    const pointAncre: PointJour = {
        name: '2026-10-30',
        dateLabel: '30 oct. 2026',
        dayIso: '2026-10-30',
        monthIndex: 9.9,
        hostMonthIndex: 9,
        dayOfMonth: 30,
        year: 2026,
        age: 30,
        NetWorth: 250_000,
        Liquidites: 25_000,
        CELI: 85_000,
        REER: 90_000,
        Immobilier: 80_000,
        DettesNonImmo: 30_000,
        isToday: true,
        isPast: true,
    } as PointJour;

    const pointFutur: PointJour = {
        ...pointAncre,
        name: '2036-10-30',
        dateLabel: '30 oct. 2036',
        dayIso: '2036-10-30',
        monthIndex: 129.9,
        hostMonthIndex: 129,
        year: 2036,
        age: 40,
        NetWorth: 750_000,
        isToday: false,
        isPast: false,
    } as PointJour;

    it('affiche le patrimoine net et l’écart positif (+$ et +%) lors du survol d’un point futur', () => {
        render(
            <GoogleFinanceHero
                jourAffiche={pointFutur}
                pointAncre={pointAncre}
                estFige={false}
                onLibererJour={vi.fn()}
                isZoomed={false}
                onResetZoom={vi.fn()}
                onFocusToday={vi.fn()}
            />,
        );

        expect(screen.getByTestId('google-finance-hero')).toBeInTheDocument();
        expect(screen.getByText(/Projection future/i)).toBeInTheDocument();
        expect(screen.getByText(/30 oct\. 2036/i)).toBeInTheDocument();
        expect(screen.getByText(/200,0 %/i)).toBeInTheDocument();
    });

    it('masque intégralement les montants et pourcentages en mode discret', () => {
        act(() => {
            useFinanceStore.getState().setPrivacyMode(true);
        });
        const { container } = render(
            <GoogleFinanceHero
                jourAffiche={pointFutur}
                pointAncre={pointAncre}
                estFige={true}
                onLibererJour={vi.fn()}
                isZoomed={true}
                onResetZoom={vi.fn()}
                onFocusToday={vi.fn()}
            />,
        );

        expect(container.textContent).not.toContain('750');
        expect(container.textContent).not.toContain('200,0 %');
        expect(screen.getByText(/Réinitialiser le zoom/i)).toBeInTheDocument();
    });

    it('déclenche la mise à jour instantanée du futur au clic sur un bouton de scénario', () => {
        const onInstantUpdate = vi.fn();
        const setRunMC = vi.fn();
        const projection: ProjectionConfig = {
            years: 30,
            returnRate: 6,
            inflationRate: 2,
            savingsMode: 'manual',
            manualContribution: 1000,
            usePortfolioRate: false,
            returnRates: { celi: 6, reer: 6, nonReg: 6, crypto: 8, cash: 2 },
        };
        const retirementGoal: RetirementGoal = {
            targetAge: 65,
            targetMonthlyIncome: 4000,
            governmentPension: 1200,
        };

        render(
            <BoutonsPimenterFutur
                projection={projection}
                retirementGoal={retirementGoal}
                runMC={false}
                setRunMC={setRunMC}
                onInstantUpdate={onInstantUpdate}
                finalNetWorth={1_250_000}
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Épargne \+25 %/i }));
        expect(onInstantUpdate).toHaveBeenCalledTimes(1);
        expect(onInstantUpdate.mock.calls[0][0].appliedSavingsMultiplier).toBe(1.25);

        fireEvent.click(screen.getByRole('button', { name: /Retraite −3 ans/i }));
        expect(onInstantUpdate).toHaveBeenCalledTimes(2);
        expect(onInstantUpdate.mock.calls[1][1].targetAge).toBe(62);
    });

    it('affiche les 4 canaux de connexion et d’import rapide dans HubConnexionsModal sans IA ni Lia', () => {
        render(<HubConnexionsModal isOpen={true} onClose={vi.fn()} />);

        expect(screen.getByText(/1\. Import rapide de relevés/i)).toBeInTheDocument();
        expect(screen.getByText(/2\. Synchronisation bancaire Fintable/i)).toBeInTheDocument();
        expect(screen.getByText(/3\. Cours de marché & Devises/i)).toBeInTheDocument();
        expect(screen.getByText(/4\. Cloud Google \(Firestore & Drive\) & Fichier JSON/i)).toBeInTheDocument();
        expect(screen.queryByText(/Connecteur MCP Claude & Analyse IA/i)).not.toBeInTheDocument();
    });

    it('fournit un dossier patrimonial initial complet (buildStarterState) et une navigation adjacente fluide', async () => {
        const { buildStarterState } = await import('../../../utils/starterData');
        const { getAdjacentTabs, ORDERED_NAV_TABS } = await import('../../../utils/tabPrefetch');
        const { Tab } = await import('../../../types');

        const starter = buildStarterState();
        expect(starter.config?.users[0]?.grossSalary).toBeGreaterThan(0);
        expect((starter.assets ?? []).length).toBeGreaterThanOrEqual(3);
        expect((starter.transactions ?? []).length).toBeGreaterThan(10);
        expect(starter.retirementGoal?.targetAge).toBe(60);

        const adj = getAdjacentTabs(Tab.FUTURE);
        expect(adj.next).toBe(Tab.TRANSACTIONS);
        expect(ORDERED_NAV_TABS).toContain(Tab.FUTURE);
        expect(ORDERED_NAV_TABS).toContain(Tab.PROFILE);
    });

    it('affiche le graphique Recharts Dépenses mensuelles vs Budget cible et bascule entre 6 mois et par poste', async () => {
        const { MonthlySpendingVsBudgetChart } = await import('../../../components/dashboard/MonthlySpendingVsBudgetChart');
        const { buildStarterState } = await import('../../../utils/starterData');
        const starter = buildStarterState();

        render(
            <MonthlySpendingVsBudgetChart
                transactions={starter.transactions}
                budgetItems={starter.budgetItems}
                isPrivacyMode={false}
            />,
        );

        expect(screen.getByTestId('monthly-spending-vs-budget-chart')).toBeInTheDocument();
        expect(screen.getByText(/Dépenses mensuelles vs Budget/i)).toBeInTheDocument();
        expect(screen.getByText(/Dépensé ce mois/i)).toBeInTheDocument();
        expect(screen.getByText(/Budget mensuel cible/i)).toBeInTheDocument();

        const btnPostes = screen.getByRole('button', { name: /Par poste ce mois/i });
        expect(btnPostes).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(btnPostes);
        expect(btnPostes).toHaveAttribute('aria-pressed', 'true');
    });

    it('affiche le bandeau de cotations GoogleFinanceTickerBar et les symboles de cote dans PageHeader sur chaque page', async () => {
        const { GoogleFinanceTickerBar } = await import('../../../components/app/GoogleFinanceTickerBar');
        const { PageHeader } = await import('../../../components/ui/PageHeader');
        const { Tab } = await import('../../../types');
        const setActiveTab = vi.fn();

        render(
            <>
                <GoogleFinanceTickerBar
                    activeTab={Tab.FUTURE}
                    setActiveTab={setActiveTab}
                    netWorth={410_000}
                    monthlySavings={1_850}
                    currentValues={{ celi: 92_000, reer: 118_000, liquidity: 28_500 }}
                />
                <PageHeader title="Placements" badge={<span>Diversification 88/100</span>} />
            </>,
        );

        expect(screen.getByText('PATR:CAD')).toBeInTheDocument();
        expect(screen.getByText('FLUX:MENS')).toBeInTheDocument();
        expect(screen.getByText('PORTF:CAD')).toBeInTheDocument();

        const btnFlux = screen.getByRole('button', { name: /FLUX:MENS/i });
        fireEvent.click(btnFlux);
        expect(setActiveTab).toHaveBeenCalledWith(Tab.BUDGET);
    });

    it('permet de naviguer entre les pages via ChartQuickLinks, les jalons/leviers de Futur et la barre de recherche directe sans Ctrl K', async () => {
        const { ChartQuickLinks } = await import('../../../components/ui/ChartQuickLinks');
        const { TableJalons, CarteLeviers } = await import('../../../components/future/JalonsLeviers');
        const { Tab } = await import('../../../types');
        const onJalonClick = vi.fn();
        const onLevierClick = vi.fn();

        render(
            <>
                <ChartQuickLinks
                    label="Sources de la courbe"
                    links={[
                        { label: 'Placements', tab: Tab.INVESTMENTS, detail: 'Comptes & titres' },
                        { label: 'Dettes', tab: Tab.DEBT, detail: 'Passifs' },
                    ]}
                />
                <TableJalons
                    etroit={false}
                    jalons={[
                        {
                            cle: 'retraite',
                            libelle: 'Retraite',
                            annee: '2055',
                            age: '60',
                            montant: null,
                            onClick: onJalonClick,
                        },
                    ]}
                />
                <CarteLeviers
                    etroit={false}
                    nbLeviers={8}
                    resume="Retraite à 60 ans"
                    onOptimiser={vi.fn()}
                    leviers={[
                        { libelle: 'Âge de retraite', valeur: '60 ans', onClick: onLevierClick },
                    ]}
                />
            </>,
        );

        fireEvent.click(screen.getByRole('button', { name: /Placements/i }));
        expect(useFinanceStore.getState().activeTab).toBe(Tab.INVESTMENTS);

        fireEvent.click(screen.getByRole('button', { name: /^Retraite$/i }));
        expect(onJalonClick).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole('button', { name: /Âge de retraite/i }));
        expect(onLevierClick).toHaveBeenCalledTimes(1);
    });

    it('permet de basculer entre Courbe nette et Par compte, de comparer deux points A ↔ B et de cliquer les jalons rapides', async () => {
        const { FutureCurveToolbar } = await import('../../../components/future/FutureCurveControls');
        const { Tab } = await import('../../../types');
        const onChangeModeCourbe = vi.fn();
        const onToggleComparaison = vi.fn();
        const onClearComparaison = vi.fn();
        const onFocusJalon = vi.fn();
        const onNaviguerTab = vi.fn();
        const onToggleMC = vi.fn();

        render(
            <FutureCurveToolbar
                modeCourbe="empilee"
                onChangeModeCourbe={onChangeModeCourbe}
                modeComparaison={true}
                onToggleComparaison={onToggleComparaison}
                pointComparaisonA={pointAncre}
                pointComparaisonB={pointFutur}
                onClearComparaison={onClearComparaison}
                jalonsRapides={[
                    {
                        cle: 'fire',
                        libelle: 'FIRE',
                        annee: 2035,
                        point: pointFutur,
                        index: 10,
                        tabCible: Tab.INVESTMENTS,
                        libelleCible: 'Placements',
                        ton: 'fire',
                    },
                ]}
                onFocusJalon={onFocusJalon}
                onNaviguerTab={onNaviguerTab}
                runMC={true}
                onToggleMC={onToggleMC}
                mcLabel="Monte Carlo (100 itér.)"
            />,
        );

        fireEvent.click(screen.getByRole('button', { name: /Courbe nette/i }));
        expect(onChangeModeCourbe).toHaveBeenCalledWith('nette');

        expect(screen.getByText(/30 oct\. 2026/i)).toBeInTheDocument();
        expect(screen.getByText(/30 oct\. 2036/i)).toBeInTheDocument();
        expect(screen.getByText(/\+200\.0 %/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /Ouvrir Placements depuis le jalon FIRE/i }));
        expect(onNaviguerTab).toHaveBeenCalledWith(Tab.INVESTMENTS);
    });

    it('affiche la jauge circulaire FinancialGoalProgressRing avec le pourcentage et le dégradé selon l’urgence', async () => {
        const {
            FinancialGoalProgressRing,
            FinancialGoalsProgressSection,
            determinerUrgenceObjectif,
        } = await import('../../../components/ui/FinancialGoalProgressRing');
        const { Tab } = await import('../../../types');
        void Tab;

        expect(determinerUrgenceObjectif(20, 3, false)).toBe('critique');
        expect(determinerUrgenceObjectif(45, 10, false)).toBe('elevee');
        expect(determinerUrgenceObjectif(60, 24, false)).toBe('moderee');
        expect(determinerUrgenceObjectif(85, 18, false)).toBe('faible');
        expect(determinerUrgenceObjectif(100, 12, true)).toBe('atteint');

        render(
            <FinancialGoalsProgressSection
                todayIso="2026-10-30"
                goals={[
                    {
                        id: 'g-crit',
                        name: 'Toiture urgente',
                        type: 'CUSTOM',
                        targetAmount: 10000,
                        manualCurrentAmount: 2500,
                        deadline: '2027-01-15',
                        targetAccount: 'NON-ENREG',
                    },
                    {
                        id: 'g-serein',
                        name: 'Coussin sécurité',
                        type: 'LIQUIDITY',
                        targetAmount: 20000,
                        manualCurrentAmount: 17000,
                        deadline: '2028-12-31',
                        targetAccount: 'CELI',
                    },
                    {
                        id: 'g-invalide',
                        name: 'Objectif sans cible',
                        type: 'CUSTOM',
                        targetAmount: Number.NaN,
                        manualCurrentAmount: 1000,
                        deadline: '2028-06-01',
                    },
                ]}
            />,
        );

        expect(screen.getByTestId('financial-goals-progress-section')).toBeInTheDocument();
        expect(screen.getByTestId('goal-card-g-crit')).toHaveAttribute('data-urgency', 'critique');
        expect(screen.getByTestId('goal-card-g-serein')).toHaveAttribute('data-urgency', 'faible');
        expect(screen.getByText('25 %')).toBeInTheDocument();
        expect(screen.getByText('85 %')).toBeInTheDocument();
        expect(screen.getByText('Urgence critique')).toBeInTheDocument();
        expect(screen.getByText('En bonne voie')).toBeInTheDocument();

        // Garde non-fini : jamais de 0 % ni de NaN % quand targetAmount est non fini
        const carteInvalide = screen.getByTestId('goal-card-g-invalide');
        expect(carteInvalide.textContent).toContain('—');
        expect(carteInvalide.textContent).not.toContain('NaN');
        expect(carteInvalide.textContent).not.toContain('0 %');

        // Mode compact
        render(
            <FinancialGoalProgressRing
                compact
                todayIso="2026-10-30"
                goal={{
                    id: 'g-done',
                    name: 'REER complété',
                    type: 'REER',
                    targetAmount: 15000,
                    manualCurrentAmount: 15000,
                    completed: true,
                    deadline: '2027-03-01',
                }}
            />,
        );
        expect(screen.getByTestId('goal-ring-g-done')).toHaveAttribute('data-urgency', 'atteint');
        expect(screen.getByText('100 %')).toBeInTheDocument();
    });

    it('déclenche une animation d’entrée fluide (gf-chart-enter) sur les composants Recharts lors du changement d’onglet du tableau de bord', async () => {
        const { MonthlySpendingVsBudgetChart } = await import('../../../components/dashboard/MonthlySpendingVsBudgetChart');
        const { ZoomableTimeChart } = await import('../../../components/ui/ZoomableTimeChart');
        const { buildStarterState } = await import('../../../utils/starterData');
        const { Tab } = await import('../../../types');
        const starter = buildStarterState();

        act(() => {
            useFinanceStore.getState().setActiveTab(Tab.FUTURE);
        });

        render(
            <>
                <MonthlySpendingVsBudgetChart
                    transactions={starter.transactions}
                    budgetItems={starter.budgetItems}
                    isPrivacyMode={false}
                />
                <ZoomableTimeChart
                    data={[
                        { date: '2026-09-01', CELI: 50000, REER: 70000 },
                        { date: '2026-10-01', CELI: 52500, REER: 71500 },
                    ]}
                    xKey="date"
                    series={[
                        { key: 'CELI', color: 'var(--succes-texte)', name: 'CELI' },
                        { key: 'REER', color: 'var(--repere)', name: 'REER' },
                    ]}
                />
            </>,
        );

        const budgetEntrance = screen.getByTestId('recharts-budget-entrance');
        const zoomableEntrance = screen.getByTestId('zoomable-chart-entrance');

        expect(budgetEntrance.className).toContain('gf-chart-enter');
        expect(budgetEntrance).toHaveAttribute('data-active-tab', Tab.FUTURE);
        expect(budgetEntrance).toHaveAttribute('data-chart-mode', 'mensuel');

        expect(zoomableEntrance.className).toContain('gf-chart-enter');
        expect(zoomableEntrance).toHaveAttribute('data-active-tab', Tab.FUTURE);

        // Bascule vers l'onglet Budget : les conteneurs Recharts reflètent le nouvel onglet et relancent l'entrée
        act(() => {
            useFinanceStore.getState().setActiveTab(Tab.BUDGET);
        });

        const budgetEntranceAfterTab = screen.getByTestId('recharts-budget-entrance');
        expect(budgetEntranceAfterTab.className).toContain('gf-chart-enter');
        expect(budgetEntranceAfterTab).toHaveAttribute('data-active-tab', Tab.BUDGET);
        expect(screen.getByTestId('zoomable-chart-entrance')).toHaveAttribute('data-active-tab', Tab.BUDGET);

        // Bascule du sous-mode du graphique (6 derniers mois -> Par poste ce mois)
        fireEvent.click(screen.getByRole('button', { name: /Par poste ce mois/i }));
        const budgetEntrancePostes = screen.getByTestId('recharts-budget-entrance');
        expect(budgetEntrancePostes.className).toContain('gf-chart-enter');
        expect(budgetEntrancePostes).toHaveAttribute('data-chart-mode', 'postes');
    });

    it('affiche la page Accueil plein visuel style Google (AccueilGoogle) avec Omnibox, pouls patrimonial, courbe, répartition, opérations et jalons', async () => {
        const { AccueilGoogle } = await import('../../../components/AccueilGoogle');
        const { buildStarterState } = await import('../../../utils/starterData');
        const { Tab } = await import('../../../types');
        const starter = buildStarterState();
        const setActiveTab = vi.fn();

        render(
            <AccueilGoogle
                state={starter as never}
                setActiveTab={setActiveTab}
                isPrivacyMode={false}
                globalNetWorth={320_000}
                avoirsHorsImmo={350_000}
                dettesHorsImmo={30_000}
                calculatedMonthlySavings={1_800}
                assetBreakdown={{ celi: 95_000, reer: 110_000, reee: 15_000, nonReg: 35_000 }}
                currentLiquidity={25_000}
            />,
        );

        expect(screen.getByTestId('accueil-google-view')).toBeInTheDocument();
        expect(screen.getByRole('searchbox', { name: /Rechercher dans votre patrimoine/i })).toBeInTheDocument();
        expect(screen.getByText('Trajectoire')).toBeInTheDocument();
        expect(screen.getByText('Allocation d’actifs')).toBeInTheDocument();
        expect(screen.getByText('Activité récente')).toBeInTheDocument();
        expect(screen.getByText('Calendrier & jalons')).toBeInTheDocument();

        const trajectoireEntrance = screen.getByTestId('recharts-trajectory-entrance');
        const allocationEntrance = screen.getByTestId('recharts-allocation-entrance');
        const budgetEntrance = screen.getByTestId('recharts-budget-entrance');

        expect(trajectoireEntrance.className).toContain('gf-chart-enter');
        expect(allocationEntrance.className).toContain('gf-chart-enter');
        expect(budgetEntrance.className).toContain('gf-chart-enter');

        // Vérifie que les sections principales et tuiles portent bien la classe d'élévation premium-card
        const heroSection = screen.getByLabelText(/Synthèse patrimoniale et recherche rapide/i);
        expect(heroSection.className).toContain('premium-card');
        expect(screen.getByTestId('monthly-spending-vs-budget-chart').className).toContain('premium-card');

        // Deux sélecteurs d'assiette coexistent (colonne gauche ≥ xl, pilules mobiles < xl) : un seul
        // est affiché à la fois en CSS. Cliquer l'un doit annoncer l'état actif sur LES DEUX.
        const btnsLentillePortefeuille = screen.getAllByRole('button', { name: /Portefeuille liquide/i });
        expect(btnsLentillePortefeuille.length).toBeGreaterThanOrEqual(1);
        fireEvent.click(btnsLentillePortefeuille[0]!);
        for (const btn of btnsLentillePortefeuille) {
            expect(btn).toHaveAttribute('aria-pressed', 'true');
        }
        expect(screen.getByTestId('recharts-trajectory-entrance')).toHaveAttribute('data-chart-lens', 'portefeuille');
        expect(screen.getByTestId('recharts-allocation-entrance')).toHaveAttribute('data-chart-lens', 'portefeuille');

        const btnModeAvoirs = screen.getByRole('button', { name: /\+ Avoirs/i });
        fireEvent.click(btnModeAvoirs);
        expect(btnModeAvoirs).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('recharts-trajectory-entrance')).toHaveAttribute('data-chart-mode', 'complete');

        const btnHorizon5A = screen.getByRole('button', { name: '5A' });
        fireEvent.click(btnHorizon5A);
        expect(btnHorizon5A).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('recharts-trajectory-entrance')).toHaveAttribute('data-chart-horizon', '5A');

        // Changement d'onglet global : tous les graphiques Recharts du tableau de bord reflètent le nouvel onglet
        act(() => {
            useFinanceStore.getState().setActiveTab(Tab.DASHBOARD);
        });
        expect(screen.getByTestId('recharts-trajectory-entrance')).toHaveAttribute('data-active-tab', Tab.DASHBOARD);
        expect(screen.getByTestId('recharts-allocation-entrance')).toHaveAttribute('data-active-tab', Tab.DASHBOARD);
        expect(screen.getByTestId('recharts-budget-entrance')).toHaveAttribute('data-active-tab', Tab.DASHBOARD);

        fireEvent.click(screen.getByRole('button', { name: /Simulateur/i }));
        expect(setActiveTab).toHaveBeenCalledWith(Tab.FUTURE);
    });

    it('anime de manière fluide le compteur numérique framer-motion de globalNetWorth lors de sa mise à jour', async () => {
        const { AccueilGoogle } = await import('../../../components/AccueilGoogle');
        const { buildStarterState } = await import('../../../utils/starterData');
        const { formatCAD } = await import('../../../utils/format');
        const starter = buildStarterState();
        const stateSansImmo = { ...starter, realEstateGoals: [] };
        const setActiveTab = vi.fn();

        const { rerender } = render(
            <AccueilGoogle
                state={stateSansImmo as never}
                setActiveTab={setActiveTab}
                isPrivacyMode={false}
                globalNetWorth={300_000}
                avoirsHorsImmo={330_000}
                dettesHorsImmo={30_000}
                calculatedMonthlySavings={1_800}
                assetBreakdown={{ celi: 95_000, reer: 110_000, reee: 15_000, nonReg: 35_000 }}
                currentLiquidity={25_000}
            />,
        );

        const counter = screen.getByTestId('animated-global-net-worth');
        expect(counter).toHaveAttribute('data-target-value', '300000');
        expect(counter).toHaveAttribute('data-current-value', '300000');
        expect(counter.textContent).toContain(formatCAD(300_000));

        // Mise à jour de globalNetWorth : déclenche l'interpolation framer-motion vers 420 000 $
        rerender(
            <AccueilGoogle
                state={stateSansImmo as never}
                setActiveTab={setActiveTab}
                isPrivacyMode={false}
                globalNetWorth={420_000}
                avoirsHorsImmo={450_000}
                dettesHorsImmo={30_000}
                calculatedMonthlySavings={1_800}
                assetBreakdown={{ celi: 95_000, reer: 110_000, reee: 15_000, nonReg: 35_000 }}
                currentLiquidity={25_000}
            />,
        );

        expect(counter).toHaveAttribute('data-target-value', '420000');
        expect(counter).toHaveAttribute('data-animating', 'true');

        // Attend la fin de l'animation du compteur numérique
        await vi.waitFor(
            () => {
                expect(counter).toHaveAttribute('data-current-value', '420000');
                expect(counter).toHaveAttribute('data-animating', 'false');
                expect(counter.textContent).toContain(formatCAD(420_000));
            },
            { timeout: 1500 },
        );
    });
});
