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
    <div className="px-3.5 sm:px-8 py-2 sm:py-4 bg-surface flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
        <div className="flex items-center justify-between gap-2 shrink-0 lg:contents">
            <span
                className="inline-flex items-center gap-2 px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-fond border border-bordure text-[11px] sm:text-xs font-mono text-ink-200 lg:order-1 shrink-0"
                title="Synchronisation automatique en temps réel entre PC et mobile"
            >
                <span className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full gf-alloc-reer gf-pulse-live" aria-hidden="true" />
                <span>
                    {syncState === 'syncing' ? 'Sync…' : 'Direct'}
                    <span className="hidden sm:inline">{syncState === 'syncing' ? ' Cloud' : ' · PC & Mobile'}</span>
                </span>
            </span>

            <div className="flex items-center gap-1.5 shrink-0 lg:order-3">
                <button
                    type="button"
                    onClick={() => setRechercheOuverte(!rechercheOuverte)}
                    aria-label="Rechercher dans votre patrimoine"
                    aria-expanded={rechercheOuverte}
                    className="touch-target min-h-11 min-w-11 lg:hidden rounded-full border border-bordure bg-fond inline-flex items-center justify-center text-ink-200 hover:text-ink-50 focus-ring"
                >
                    <Icon name="search" size={16} aria-hidden="true" />
                </button>
                <button
                    type="button"
                    onClick={onOpenConnexions}
                    aria-label="Importer ou synchroniser des comptes"
                    className="touch-target min-h-11 px-3 sm:px-4 py-1.5 sm:py-2 rounded-full border border-bordure bg-fond hover:bg-surface-douce hover:border-bordure-champ text-xs sm:text-sm font-medium text-ink-100 inline-flex items-center gap-1.5 sm:gap-2 transition-colors duration-100 focus-ring whitespace-nowrap"
                >
                    <Icon name="cloud" size={15} className="text-ink-300" aria-hidden="true" />
                    <span>
                        <span className="hidden sm:inline">Comptes & </span>Sync
                    </span>
                </button>
            </div>
        </div>

        <div className={`${rechercheOuverte ? 'block' : 'hidden lg:block'} relative flex-1 max-w-xl mx-auto w-full lg:order-2`}>
            <div className="gf-omnibox-pill relative flex items-center px-3.5 sm:px-4 py-0.5">
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
    </div>
);
