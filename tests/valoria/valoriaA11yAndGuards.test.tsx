/**
 * @vitest-environment jsdom
 *
 * Audit d'accessibilité WCAG (vitest-axe), cibles tactiles >= 44 px,
 * conformité `no-fake-data`, isolation stricte des écritures (ADR-V3) et
 * gardes statiques des composants et services Valoria.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type * as AxeCore from 'axe-core';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ValoriaWorkspace } from '../../components/valoria/ValoriaWorkspace';
import { useFinanceStore } from '../../store/useFinanceStore';
import { TEST_ASSETS } from '../../services/testAssets';
import { stripComments, stripCommentsJsx } from '../../utils/stripComments';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'fr', changeLanguage: () => Promise.resolve() },
  }),
}));

async function expectNoSeriousViolations(container: HTMLElement): Promise<void> {
  const results = await axe(container);
  const serious = (results.violations || []).filter(
    (v: AxeCore.Result) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.description}`),
    'Violations WCAG serious/critical détectées par Axe',
  ).toEqual([]);
}

function hauteurEtablie(classes: string): number {
  if (/(^|\s)touch-target(?=\s|$)/.test(classes)) return 44;
  let h = 0;
  for (const m of classes.matchAll(/(?<![\w-])(?:min-)?h-(\d+(?:\.\d+)?)(?![\w.-])/g)) {
    h = Math.max(h, Number(m[1]) * 4);
  }
  for (const m of classes.matchAll(/(?<![\w-])size-(\d+(?:\.\d+)?)(?![\w.-])/g)) {
    h = Math.max(h, Number(m[1]) * 4);
  }
  for (const m of classes.matchAll(/(?<![\w-])(?:min-)?h-\[(\d+(?:\.\d+)?)px\]/g)) {
    h = Math.max(h, Number(m[1]));
  }
  for (const m of classes.matchAll(/(?<![\w-])(?:min-)?h-\[(\d+(?:\.\d+)?)rem\]/g)) {
    h = Math.max(h, Number(m[1]) * 16);
  }
  return h;
}

function assertTouchTargetClasses(container: HTMLElement): void {
  const controls = container.querySelectorAll(
    'button, input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="hidden"]):not([type="file"]), select, textarea, [role="switch"], [role="tab"]',
  );
  for (const el of controls) {
    if (el.closest('[hidden], [aria-hidden="true"]')) continue;
    const cls = el.getAttribute('class') ?? '';
    expect(
      hauteurEtablie(cls),
      `Contrôle sans classe >= 44px : ${el.tagName} "${el.textContent?.trim()}" (${cls})`,
    ).toBeGreaterThanOrEqual(44);
  }
}

function listerFichiersRecursifs(dir: string, extRegex: RegExp): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const nom of readdirSync(dir)) {
    const chemin = join(dir, nom);
    if (statSync(chemin).isDirectory()) {
      out.push(...listerFichiersRecursifs(chemin, extRegex));
    } else if (extRegex.test(chemin)) {
      out.push(chemin);
    }
  }
  return out;
}

const initialStore = useFinanceStore.getState();

describe('ValoriaWorkspace — Accessibilité Axe, Isolation & Gardes', () => {
  beforeEach(() => {
    localStorage.clear();
    useFinanceStore.setState(initialStore, true);

    vi.stubGlobal(
      'ResizeObserver',
      class {
        private cb: ResizeObserverCallback;
        constructor(cb: ResizeObserverCallback) {
          this.cb = cb;
        }
        observe(target: Element) {
          this.cb(
            [
              {
                target,
                contentRect: { width: 960, height: 420 } as DOMRectReadOnly,
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: false,
            offlineFallback: true,
            articles: [],
            dispatches: [],
            sourcesVerified: [],
            results: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    if (typeof SVGElement !== 'undefined') {
      const proto = SVGElement.prototype as unknown as {
        getBBox?: () => { x: number; y: number; width: number; height: number };
        getComputedTextLength?: () => number;
        getTotalLength?: () => number;
      };
      if (!proto.getBBox) {
        proto.getBBox = () => ({ x: 0, y: 0, width: 120, height: 24 });
      }
      if (!proto.getComputedTextLength) {
        proto.getComputedTextLength = () => 48;
      }
      if (!proto.getTotalLength) {
        proto.getTotalLength = () => 100;
      }
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('état vide honnête (no-fake-data) : zéro violation Axe serious/critical, cibles >= 44px et aucun lot démo auto-injecté', async () => {
    useFinanceStore.setState({
      assets: [],
      transactions: [],
      budgetItems: [],
      initialBalances: {},
      isPrivacyMode: false,
      isTestMode: false,
    });

    const { container } = render(<ValoriaWorkspace />);

    const workspace = screen.getByTestId('valoria-workspace');
    expect(workspace).toBeInTheDocument();

    // Règle no-fake-data : aucun titre fictif auto-chargé quand state.assets est vide
    expect(workspace.textContent).toMatch(/Aucune position|Aucun placement|Portefeuille vide/i);
    expect(workspace.textContent).not.toContain('PAYX');
    expect(workspace.textContent).not.toContain('ASML');

    assertTouchTargetClasses(container);
    await expectNoSeriousViolations(container);
  });

  it('état peuplé en simulation isolée : zéro violation Axe, bannière simulation visible et Mode Discret respecté', async () => {
    useFinanceStore.setState({
      assets: structuredClone(TEST_ASSETS),
      fxRates: { USD: 1.37, EUR: 1.48, CAD: 1 },
      initialBalances: { LIQUIDITE: 8500 },
      transactions: [],
      budgetItems: [],
      isPrivacyMode: false,
    });

    const { container, rerender } = render(<ValoriaWorkspace />);

    expect(screen.getByTestId('valoria-workspace')).toBeInTheDocument();
    expect(screen.getByTestId('valoria-simulation-banner')).toBeInTheDocument();
    expect(screen.getByTestId('valoria-workspace').textContent).toMatch(/VFV|VEQT|AAPL|BTC/i);

    assertTouchTargetClasses(container);
    await expectNoSeriousViolations(container);

    // Bascule Mode Discret : aucun montant personnel ne fuite, `•••` et `Montant masqué` présents
    useFinanceStore.setState({ isPrivacyMode: true });
    rerender(<ValoriaWorkspace />);

    await waitFor(() => {
      expect(screen.getByTestId('valoria-workspace').textContent).toContain('•••');
      expect(screen.getAllByText('Montant masqué').length).toBeGreaterThan(0);
    });
    await expectNoSeriousViolations(container);
  });

  it('isolation stricte des écritures (ADR-V3) : charger le Bac à Sable ou exécuter un ordre simulé ne modifie jamais state.assets', async () => {
    // 1. Sur état vide : charger l'exemple Bac à Sable laisse state.assets à []
    useFinanceStore.setState({
      assets: [],
      initialBalances: {},
      transactions: [],
      isPrivacyMode: false,
    });
    const { unmount } = render(<ValoriaWorkspace />);

    const btnExemple = screen.getByRole('button', { name: /Charger l[’']exemple|Bac à sable/i });
    fireEvent.click(btnExemple);
    expect(useFinanceStore.getState().assets).toEqual([]);
    expect(useFinanceStore.getState().initialBalances).toEqual({});
    unmount();

    // 2. Sur état peuplé : exécuter un ordre simulé dans Recommandé ne touche ni assets ni initialBalances
    const assetsInitiaux = structuredClone(TEST_ASSETS);
    useFinanceStore.setState({
      assets: structuredClone(assetsInitiaux),
      fxRates: { USD: 1.37, EUR: 1.48, CAD: 1 },
      initialBalances: { LIQUIDITE: 8500 },
      transactions: [],
      isPrivacyMode: false,
    });
    const beforeAssets = structuredClone(useFinanceStore.getState().assets);
    const beforeLiquidite = useFinanceStore.getState().initialBalances.LIQUIDITE;

    render(<ValoriaWorkspace />);
    const tabRecommande =
      screen.queryAllByRole('tab', { name: /\bRecommandé\b/i })[0]
      ?? screen.getAllByRole('button', { name: /\bRecommandé\b/i })[0];
    fireEvent.click(tabRecommande);

    const btnOrdre = screen.queryAllByRole('button', { name: /Acheter \+|Vendre |Tout appliquer/i })[0];
    expect(btnOrdre, 'Un bouton d’ordre simulé doit être disponible dans Recommandé').toBeTruthy();
    fireEvent.click(btnOrdre);

    expect(useFinanceStore.getState().assets).toEqual(beforeAssets);
    expect(useFinanceStore.getState().initialBalances.LIQUIDITE).toBe(beforeLiquidite);
    expect(useFinanceStore.getState().transactions).toEqual([]);
  });

  it('gardes statiques Valoria : tokens sémantiques (0 hex / 0 palette Tailwind), zéro hover transform et zéro couplage store dans services/valoria', () => {
    const racine = process.cwd();
    const dirComposants = resolve(racine, 'components/valoria');
    const dirServices = resolve(racine, 'services/valoria');

    expect(existsSync(resolve(dirComposants, 'ValoriaWorkspace.tsx'))).toBe(true);

    const fichiersTsx = listerFichiersRecursifs(dirComposants, /\.tsx$/);
    expect(fichiersTsx.length).toBeGreaterThan(0);

    const familles =
      'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
    const utilitaires =
      'bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow|decoration|accent|caret|placeholder';
    const rePalette = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*(?:${utilitaires})-(?:${familles})-\\d{2,3}(?![\\w-])`);
    const reBlancNoir = new RegExp(`(?<![\\w-])(?:[a-z0-9-]+:)*(?:${utilitaires})-(?:white|black)(?![\\w-])`);
    const reHex = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/;

    const infractionsVisuelles: string[] = [];
    for (const fichier of fichiersTsx) {
      const code = stripCommentsJsx(readFileSync(fichier, 'utf8'));
      const rel = fichier.replace(`${racine}\\`, '').replace(/\\/g, '/');
      if (rePalette.test(code)) infractionsVisuelles.push(`${rel} : classe palette Tailwind détectée`);
      if (reBlancNoir.test(code)) infractionsVisuelles.push(`${rel} : white/black Tailwind détecté`);
      if (reHex.test(code)) infractionsVisuelles.push(`${rel} : couleur hex en dur détectée`);
      if (/hover:(?:scale|-?translate-y)-/.test(code)) {
        infractionsVisuelles.push(`${rel} : hover:scale/translate-y interdit`);
      }
      if (/onMouseDown\s*=/.test(code)) {
        infractionsVisuelles.push(`${rel} : navigation onMouseDown interdite`);
      }
    }
    expect(infractionsVisuelles).toEqual([]);

    // Frontière services/ <-> store/ dans services/valoria/
    const fichiersServices = listerFichiersRecursifs(dirServices, /\.ts$/);
    const infractionsStore: string[] = [];
    for (const fichier of fichiersServices) {
      const code = stripComments(readFileSync(fichier, 'utf8'));
      if (/(?:from\s+|import\(\s*)['"][^'"]*store\//.test(code)) {
        infractionsStore.push(fichier);
      }
    }
    expect(infractionsStore).toEqual([]);
  });
});
