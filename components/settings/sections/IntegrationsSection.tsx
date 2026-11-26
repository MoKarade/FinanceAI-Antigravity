// components/settings/sections/IntegrationsSection.tsx
// G22-N4 — extrait de Settings.tsx : clés API & services externes (Google Gemini,
// Finnhub). Comportement identique ; props apiKeys/setApiKeys threadées.

import React, { useState } from 'react';
import { Card } from '../../ui/Card';
import { Icon } from '../../ui/Icon';
import { CollapsibleSection } from '../../ui/CollapsibleSection';
import { GeminiAssistantModal } from '../../aiChat/GeminiAssistantModal';
import { modelLabelFromId } from '../../../services/aiChat/models';
import { testerCleApiGemini, type TestCleGeminiResult } from '../../../services/geminiClientAdapter';
import type { AppState } from '../../../types';

interface IntegrationsSectionProps {
  apiKeys: AppState['apiKeys'];
  setApiKeys: (keys: AppState['apiKeys']) => void;
}

export const IntegrationsSection: React.FC<IntegrationsSectionProps> = ({ apiKeys, setApiKeys }) => {
  const [assistantOuvert, setAssistantOuvert] = useState(false);
  const [afficherCle, setAfficherCle] = useState(false);
  const [testEnCours, setTestEnCours] = useState(false);
  const [resultatTest, setResultatTest] = useState<TestCleGeminiResult | null>(null);
  const cleIa = (apiKeys?.gemini || apiKeys?.anthropic || '').replace(/^["'\s]+|["'\s]+$/g, '');
  const formatValide = cleIa.startsWith('AIza') && cleIa.length >= 20;

  const lancerTestCle = async () => {
    if (!cleIa || testEnCours) return;
    setTestEnCours(true);
    setResultatTest(null);
    try {
      const res = await testerCleApiGemini(cleIa);
      setResultatTest(res);
    } finally {
      setTestEnCours(false);
    }
  };

  return (
    <div className="space-y-6">
    <Card title="Clé API Google Gemini">
      <div className="space-y-4">
        <div data-focus-section="apiKeys-gemini">
          <label htmlFor="apikey-gemini" className="block text-body text-ink-300 mb-1">Clé API Google Gemini (IA — Gemini 3.8 Flash & 4 Argon)</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="apikey-gemini"
              type={afficherCle ? 'text' : 'password'}
              value={cleIa}
              onChange={(e) => {
                setResultatTest(null);
                setApiKeys({ ...apiKeys, gemini: e.target.value.replace(/^["'\s]+|["'\s]+$/g, '') });
              }}
              className="touch-target flex-1 min-w-[220px] bg-dark border border-border rounded-sm px-3 py-2 text-white focus:border-primary outline-hidden font-mono"
              placeholder="AIzaSy..."
              aria-describedby="apikey-gemini-format"
            />
            <button
              type="button"
              onClick={() => setAfficherCle((v) => !v)}
              aria-pressed={afficherCle}
              className="touch-target px-3 py-2 rounded-sm bg-surface-douce border border-bordure text-xs font-medium text-ink-200 hover:text-ink-50 focus-ring shrink-0"
            >
              {afficherCle ? 'Masquer' : 'Afficher'}
            </button>
            <button
              type="button"
              onClick={() => { void lancerTestCle(); }}
              disabled={!cleIa || testEnCours}
              className="touch-target px-3.5 py-2 rounded-sm bg-surface-douce border border-bordure-champ text-xs font-semibold text-ink-50 hover:bg-bordure disabled:opacity-50 focus-ring shrink-0"
            >
              {testEnCours ? 'Test en cours…' : 'Tester la clé'}
            </button>
          </div>
          {resultatTest && (
            <div
              role="status"
              aria-live="polite"
              className={`text-meta mt-1.5 font-medium ${resultatTest.ok ? 'text-succes-texte' : 'text-erreur-texte'}`}
            >
              {resultatTest.ok
                ? `Clé active — connectée à ${modelLabelFromId(resultatTest.model ?? 'gemini-3.8-flash')}.`
                : `Échec du test (${resultatTest.cause ?? 'erreur'}) : ${resultatTest.message ?? 'requête refusée par Google.'}`}
            </div>
          )}
          {cleIa && (
            <div id="apikey-gemini-format" className="text-meta mt-1" role="status" aria-live="polite">
              {formatValide
                ? <span className="text-green-400">Format valide (Gemini 3.8 Flash & Gemini 4 Argon prêts)</span>
                : <span className="text-yellow-400">Format inattendu (devrait commencer par <code className="bg-white/10 px-1 rounded-sm">AIza</code>)</span>
              }
            </div>
          )}
          <p className="text-meta text-ink-400 mt-1">
            Pour Google Gemini 3.8 Flash, Gemini 4 Argon et Gemini 3.5 Flash-Lite — conseiller patrimonial connecté, catégorisation, fiscalité et vision PDF/image. Obtiens ta clé sur{' '}
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-repere underline">aistudio.google.com/apikey</a>
          </p>
        </div>
        <CollapsibleSection
          title="Cours boursiers avancés (Finnhub — optionnel)"
          subtitle="Facultatif : Yahoo Finance fonctionne déjà sans clé"
          headingLevel={3}
          defaultOpen={Boolean(apiKeys?.finnhub)}
        >
          <div className="space-y-3 pt-1">
            <div>
              <label htmlFor="apikey-finnhub" className="block text-body text-ink-300 mb-1">Finnhub API Key (Données boursières)</label>
              <input
                id="apikey-finnhub"
                type="password"
                value={apiKeys?.finnhub || ''}
                onChange={(e) => setApiKeys({ ...apiKeys, finnhub: e.target.value })}
                className="w-full bg-dark border border-border rounded-sm px-3 py-2 text-white focus:border-primary outline-hidden"
                placeholder="d12abc..."
                aria-describedby="apikey-finnhub-format"
              />
              {apiKeys?.finnhub && (
                <div id="apikey-finnhub-format" className="text-meta mt-1" role="status" aria-live="polite">
                  {/^[a-z0-9]{15,}$/i.test(apiKeys.finnhub)
                    ? <span className="text-green-400">Format valide</span>
                    : <span className="text-yellow-400">Format inattendu (alphanumeric ≥ 15 chars)</span>
                  }
                </div>
              )}
              <p className="text-meta text-ink-400 mt-1">
                Ajoute des cotes en direct complémentaires via{' '}
                <a href="https://finnhub.io/register" target="_blank" rel="noopener noreferrer" className="text-repere underline">finnhub.io</a>{' '}
                (gratuit, 60 req/min). Optionnel : sans clé, les cotes publiques fonctionnent déjà.
              </p>
            </div>
            <div className="p-3 bg-info-bg rounded-sm border border-info-border">
              <div className="text-meta text-repere font-bold mb-1">ℹ️ Source de données active</div>
              <p className="text-tiny text-ink-300">
                {apiKeys?.finnhub
                  ? <>Finnhub configuré → cotes et profils d'actifs en direct activés.</>
                  : <>Mode standard actif → Yahoo Finance suffit pour suivre tes titres.</>
                }
              </p>
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </Card>

    <Card icon={<Icon name="sparkles" size={18} className="text-repere" />} title="Assistant financier Google Gemini">
      <div className="space-y-3">
        <p className="text-meta text-ink-300 leading-relaxed">
          Interroge directement <strong>Google Gemini 3.8 Flash</strong> (ou <strong>Gemini 4 Argon</strong>) depuis l’accueil ou la barre supérieure pour analyser ton patrimoine net, obtenir ton plan d’action (jour, semaine, mois, année, décennie), optimiser tes cotisations CELI/REER, diagnostiquer ton budget et lire tes relevés PDF ou talons de paie.
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => setAssistantOuvert(true)}
            className="touch-target px-4 py-2 rounded-full bg-repere-fond text-repere border border-bordure-lien text-xs font-semibold hover:opacity-90 transition-opacity focus-ring inline-flex items-center gap-1.5"
          >
            <Icon name="sparkles" size={14} aria-hidden="true" />
            <span>Ouvrir le conseiller Gemini</span>
          </button>
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="touch-target px-3.5 py-2 rounded-full bg-surface-douce border border-bordure text-xs text-ink-200 hover:text-ink-50 transition-colors focus-ring inline-flex items-center gap-1.5"
          >
            <span>Créer une clé Google AI Studio</span>
            <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </Card>

    {assistantOuvert && (
      <GeminiAssistantModal isOpen={assistantOuvert} onClose={() => setAssistantOuvert(false)} />
    )}
    </div>
  );
};
