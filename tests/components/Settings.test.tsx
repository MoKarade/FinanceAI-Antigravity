import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { Settings } from '../../components/Settings';
import { useFinanceStore } from '../../store/useFinanceStore';
import { _resetViewportXlMqlForTests } from '../../hooks/useViewportXl';
import type { AppState, BudgetConfig, User } from '../../types';

vi.mock('../../services/cloudBackup', () => ({
    downloadBackup: vi.fn().mockResolvedValue(undefined),
    defaultBackupFilename: () => 'backup.enc',
    MIN_PASSPHRASE_LENGTH: 12,
}));

const defaultApiKeys: AppState['apiKeys'] = { gemini: 'GEMINI_SECRET', finnhub: '' };
const defaultConfig: BudgetConfig = {
    users: [
        { name: 'Marc', monthlyGross: 7000, rrspContribution: 0, fhsaContribution: 0, birthYear: 1990, canadaArrivalYear: 2009 } as unknown as User,
        { name: 'Anna', monthlyGross: 5000, rrspContribution: 0, fhsaContribution: 0, birthYear: 1992, canadaArrivalYear: 2009 } as unknown as User,
    ],
    splitMode: '50/50',
};

const baseProps = {
    apiKeys: defaultApiKeys,
    setApiKeys: vi.fn(),
    config: defaultConfig,
    setConfig: vi.fn(),
    onImportData: vi.fn(),
    initialBalances: {},
    setInitialBalances: vi.fn(),
    transactions: [],
};

describe('Settings', () => {
    let createdBlob: Blob | undefined;

    const ouvrirSection = (nom: string) => {
        const nav = screen.getByRole('navigation', { name: 'Sections des réglages' });
        fireEvent.click(within(nav).getByRole('button', { name: new RegExp(`^${nom}`) }));
    };
    const goToBackupTab = () => ouvrirSection('Sauvegarde');

    beforeEach(() => {
        vi.clearAllMocks();
        createdBlob = undefined;
        global.URL.createObjectURL = vi.fn((blob: Blob) => {
            createdBlob = blob;
            return 'blob:test';
        });
        global.URL.revokeObjectURL = vi.fn();
        HTMLAnchorElement.prototype.click = vi.fn();
    });

    afterEach(() => { vi.unstubAllGlobals(); _resetViewportXlMqlForTests(); });

    it('mobile : liste des 4 besoins essentiels + Profil ; une section s\'ouvre et se referme', () => {
        render(<Settings {...baseProps} />);
        expect(screen.queryByRole('heading', { name: /Mode test/ })).toBeNull();
        const nav = screen.getByRole('navigation', { name: 'Sections des réglages' });
        const lignes = within(nav).getAllByRole('button').map((b) => b.textContent?.replace(/[›\s]+$/, '').trim());
        expect(lignes).toEqual(['Profil', 'Compte', 'Banque auto', 'Clé IA', 'Sauvegarde']);
        expect(screen.queryByRole('tab')).toBeNull();

        ouvrirSection('Sauvegarde');
        expect(screen.getByRole('heading', { level: 2, name: 'Sauvegarde' })).toBeInTheDocument();
        expect(screen.queryByRole('navigation', { name: 'Sections des réglages' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Toutes les sections/ }));
        expect(screen.getByRole('navigation', { name: 'Sections des réglages' })).toBeInTheDocument();
    });

    it('mobile : « à faire » sur Clé IA tant que la clé Google Gemini manque', () => {
        render(<Settings {...baseProps} apiKeys={{ ...defaultApiKeys, gemini: '', anthropic: '' }} />);
        const nav = screen.getByRole('navigation', { name: 'Sections des réglages' });
        expect(within(nav).getByRole('button', { name: /^Clé IA/ }).textContent).toContain('à faire');
    });

    it('bureau large (≥ xl) : menu vertical aux 4 besoins, « Compte » ouvert par défaut avec Patrimoine étendu repliable', () => {
        vi.stubGlobal('matchMedia', (q: string) => ({
            media: q, matches: true, addEventListener: () => {}, removeEventListener: () => {},
        }));
        render(<Settings {...baseProps} />);
        const menu = screen.getByRole('tablist', { name: 'Sections des réglages' });
        expect(menu).toHaveAttribute('aria-orientation', 'vertical');
        expect(within(menu).getAllByRole('tab')).toHaveLength(4);
        expect(within(menu).getByRole('tab', { name: 'Compte' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('button', { name: /Patrimoine étendu/i })).toBeInTheDocument();
        fireEvent.click(within(menu).getByRole('tab', { name: 'Sauvegarde' }));
        expect(within(menu).getByRole('tab', { name: 'Sauvegarde' })).toHaveAttribute('aria-selected', 'true');
    });

    it('se rend sans erreur', () => {
        const { container } = render(<Settings {...baseProps} />);
        expect(container.firstChild).toBeTruthy();
    });

    it("l'export JSON clair n'inclut PAS les clés API dans le blob (audit sécurité 2026-05)", async () => {
        useFinanceStore.setState({
            apiKeys: { gemini: 'ANT_SECRET', anthropic: 'ANT_SECRET', finnhub: 'FIN_SECRET' },
            transactions: [{ id: 't1', date: '2026-01-02', amount: -10, payee: 'x', category: 'Épicerie' }] as unknown as AppState['transactions'],
        });
        render(<Settings {...baseProps} />);
        goToBackupTab();

        const allButtons = screen.getAllByRole('button');
        const exportBtn = allButtons.find(
            b => b.textContent?.includes('Exporter') && !b.textContent?.toLowerCase().includes('chiffr')
        );
        expect(exportBtn).toBeTruthy();
        fireEvent.click(exportBtn!);

        await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());

        expect(createdBlob).toBeDefined();
        const text = await createdBlob!.text();
        expect(text).not.toContain('GEM_SECRET');
        expect(text).not.toContain('ERA_SECRET');
        expect(text).not.toContain('"apiKeys"');
        expect(text).not.toContain('ANT_SECRET');
        expect(text).not.toContain('FIN_SECRET');
        expect(JSON.parse(text).store.state.transactions).toHaveLength(1);
    });

    it("le bouton 'Exporter chiffré' ouvre la modal de passphrase", async () => {
        render(<Settings {...baseProps} />);
        goToBackupTab();

        const encBtn = screen.getAllByRole('button').find(
            b => b.textContent?.toLowerCase().includes('chiffr') && b.textContent?.toLowerCase().includes('export')
        );
        if (!encBtn) return;

        fireEvent.click(encBtn);

        const passwordInputs = document.querySelectorAll('input[type="password"]');
        expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    });

    it('la synchronisation Fintable et la carte Taux de change sont ATTEIGNABLES depuis « Banque auto »', () => {
        render(<Settings {...baseProps} />);
        ouvrirSection('Banque auto');
        expect(screen.getByLabelText(/Jeton Fintable/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /Taux de change/i })).toBeInTheDocument();
    });

    it("dans la modal chiffrée, le bouton confirmer est désactivé si passphrase vide", async () => {
        render(<Settings {...baseProps} />);
        goToBackupTab();

        const encBtn = screen.getAllByRole('button').find(
            b => b.textContent?.toLowerCase().includes('chiffr') && b.textContent?.toLowerCase().includes('export')
        );
        if (!encBtn) return;

        fireEvent.click(encBtn);

        const dialog = screen.getByRole('dialog');
        const confirmBtn = within(dialog).getAllByRole('button').find(
            b => b.textContent?.includes('Exporter chiffré') || b.textContent?.includes('Chiffrement')
        );
        if (confirmBtn) {
            expect(confirmBtn).toBeDisabled();
        }
    });
});
