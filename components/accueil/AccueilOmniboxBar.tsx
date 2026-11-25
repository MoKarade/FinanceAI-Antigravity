import React from 'react';
import { Tab, type Asset, type Transaction } from '../../types';
import { assetValueCad } from '../../services/portfolio';
import { formatCAD } from '../../utils/format';
import { Icon, type IconName } from '../ui/Icon';
import { PrivateAmount } from '../ui/PrivateAmount';
import { PrivateText } from '../ui/PrivateText';

interface AccueilOmniboxBarProps {
    syncState: string;
    requete: string;
    setRequete: (val: string) => void;
    rechercheOuverte: boolean;
    setRechercheOuverte: (val: boolean) => void;
    resultatsOmnibox: {
        pages: ReadonlyArray<{ tab: Tab; label: string; icon: IconName }>;
        titres: ReadonlyArray<Asset>;
        operations: ReadonlyArray<Transaction>;
    };
    fxRates: Record<string, number> | undefined;
    setActiveTab: (tab: Tab) => void;
    onOpenConnexions: () => void;
}

export const AccueilOmniboxBar: React.FC<AccueilOmniboxBarProps> = ({
    syncState,
    requete,
    setRequete,
    rechercheOuverte,
    setRechercheOuverte,
    resultatsOmnibox,
    fxRates,
    setActiveTab,
    onOpenConnexions,
}) => (
    <div className="px-5 sm:px-8 py-4 bg-surface flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-center justify-between lg:justify-start gap-3 shrink-0">
            <span
                className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-fond border border-bordure text-xs font-mono text-ink-200"
                title="Synchronisation automatique en temps réel entre PC et mobile"
            >
                <span className="w-2.5 h-2.5 rounded-full gf-alloc-reer gf-pulse-live" aria-hidden="true" />
                <span>{syncState === 'syncing' ? 'Sync Cloud…' : 'Direct · PC & Mobile'}</span>
            </span>
        </div>

        <div className="relative flex-1 max-w-xl mx-auto w-full">
            <div className="gf-omnibox-pill relative flex items-center px-4 py-0.5">
                <Icon
                    name="search"
                    size={17}
                    className="text-ink-300 pointer-events-none shrink-0"
                    aria-hidden="true"
                />
                <input
                    type="search"
                    value={requete}
                    onFocus={() => setRechercheOuverte(true)}
                    onBlur={() => {
                        setTimeout(() => setRechercheOuverte(false), 160);
                    }}
                    onChange={(e) => {
                        setRequete(e.target.value);
                        setRechercheOuverte(true);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setRechercheOuverte(false);
                        } else if (e.key === 'Enter' && resultatsOmnibox.pages[0]) {
                            setActiveTab(resultatsOmnibox.pages[0].tab);
                            setRechercheOuverte(false);
                            setRequete('');
                        }
                    }}
                    placeholder="Rechercher un compte, un titre ou une opération…"
                    aria-label="Rechercher dans votre patrimoine"
                    className="champ-nu touch-target w-full pl-3 pr-3 bg-transparent text-sm text-ink-50 placeholder-ink-400 focus-ring"
                />
            </div>

            {rechercheOuverte && (
                <div
                    role="listbox"
                    aria-label="Suggestions rapides"
                    className="absolute left-0 right-0 top-full mt-2.5 rounded-xl bg-surface border border-bordure-champ divide-y divide-bordure z-40 text-left shadow-xl overflow-hidden"
                >
                    <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-bordure">
                        {resultatsOmnibox.pages.map((p) => (
                            <button
                                key={p.tab}
                                type="button"
                                onClick={() => {
                                    setActiveTab(p.tab);
                                    setRechercheOuverte(false);
                                    setRequete('');
                                }}
                                className="touch-target px-4 py-3 flex items-center gap-2.5 text-sm text-ink-100 hover:bg-surface-douce transition-colors duration-100 focus-ring"
                            >
                                <Icon name={p.icon} size={15} className="text-ink-400 shrink-0" aria-hidden="true" />
                                <span className="truncate font-medium">{p.label}</span>
                            </button>
                        ))}
                    </div>
                    {resultatsOmnibox.titres.length > 0 && (
                        <div className="divide-y divide-bordure">
                            {resultatsOmnibox.titres.map((asset, idx) => (
                                <button
                                    key={`${asset.symbol}-${idx}`}
                                    type="button"
                                    onClick={() => {
                                        setActiveTab(Tab.INVESTMENTS);
                                        setRechercheOuverte(false);
                                        setRequete('');
                                    }}
                                    className="touch-target w-full px-4 py-3 flex items-center justify-between gap-3 text-sm hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                >
                                    <span className="font-mono font-semibold text-ink-50">
                                        {asset.symbol || asset.name}
                                    </span>
                                    <PrivateAmount className="font-mono tabular-nums text-ink-200">
                                        {formatCAD(assetValueCad(asset, fxRates))}
                                    </PrivateAmount>
                                </button>
                            ))}
                        </div>
                    )}
                    {resultatsOmnibox.operations.length > 0 && (
                        <div className="divide-y divide-bordure">
                            {resultatsOmnibox.operations.map((tx) => (
                                <button
                                    key={tx.id}
                                    type="button"
                                    onClick={() => {
                                        setActiveTab(Tab.TRANSACTIONS);
                                        setRechercheOuverte(false);
                                        setRequete('');
                                    }}
                                    className="touch-target w-full px-4 py-3 flex items-center justify-between gap-3 text-sm hover:bg-surface-douce transition-colors duration-100 focus-ring"
                                >
                                    <PrivateText quoi="marchand" className="truncate text-ink-100">{tx.payee}</PrivateText>
                                    <PrivateAmount className="font-mono font-semibold tabular-nums text-ink-200 shrink-0">
                                        {formatCAD(tx.amount)}
                                    </PrivateAmount>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
            <button
                type="button"
                onClick={onOpenConnexions}
                aria-label="Importer ou synchroniser des comptes"
                className="touch-target px-4 py-2 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs sm:text-sm font-medium text-ink-100 inline-flex items-center gap-2 transition-colors duration-100 focus-ring whitespace-nowrap"
            >
                <Icon name="cloud" size={15} className="text-ink-300" aria-hidden="true" />
                <span>Comptes & Sync</span>
            </button>
        </div>
    </div>
);
