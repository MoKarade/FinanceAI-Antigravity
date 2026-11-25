import { useState, useMemo, useCallback } from 'react';
import type { AppState, Asset, RegisteredAccountType } from '../../types';
import type { MarketDataPoint } from '../../services/finance';
import { historyKeyMatchesSymbol } from '../../services/history/buildMarketData';
import { variation24hTitreAffichable, titresAuCoursPerime } from '../../services/history/fraicheurCours';
import { todayIsoLocal } from '../../services/projection/dailyRefine';
import { seriesReturnPct, priceReturnPct, isBenchmarkCandidate, type PerfPeriod } from '../../services/history/periodReturn';
import { resolveAssetMeta, lookupSeedMeta } from '../../services/assetMeta';
import { assetValueCad } from '../../services/portfolio';
import { getQuote, getQuoteDetaille, hasQuoteProvider, clearMarketDataCache, clearNegativeCache, getHistoryDetaille, hasHistoryProvider } from '../../services/marketData';
import { verifierSymboleCotation } from '../../services/verifierSymboleCotation';
import { refreshAssetPrices, applyPricePatches } from '../../services/priceRefresh';
import { logError } from '../../services/errorLogger';
import { showToast } from '../ui/Toast';
import { useFinanceStore } from '../../store/useFinanceStore';
import type { PeriodeGraphe } from './PerformanceComparee';
import type { AllocationItem, DividendItem, SeriesWithTrend } from './investmentsHelpers';

interface UseInvestmentsPortfolioParams {
    assets: Asset[];
    setAssets: (assets: Asset[]) => void;
    fxRates: AppState['fxRates'];
    marketData: MarketDataPoint[];
    perfPeriod: PerfPeriod;
    timeRange: PeriodeGraphe;
    isSyntheticValue: (date: string, key: string) => boolean;
    onAfterDelete?: () => void;
}

const FREQ_MAP: Record<string, number> = { Monthly: 12, Quarterly: 4, Yearly: 1 };
const BUCKET_LABELS: Record<string, string> = {
    TOTAL_CELI: 'CELI (total)',
    TOTAL_REER: 'REER (total)',
    'TOTAL_NON-ENREG': 'Non-enregistré (total)',
    TOTAL_CRYPTO: 'Crypto (total)',
};

/**
 * Calculs dérivés du portefeuille (allocation, secteurs, géographie, dividendes, score,
 * séries filtrées) et actions sur les positions (actualisation cours, édition, suppression).
 */
export const useInvestmentsPortfolio = ({
    assets,
    setAssets,
    fxRates,
    marketData,
    perfPeriod,
    timeRange,
    isSyntheticValue,
    onAfterDelete,
}: UseInvestmentsPortfolioParams) => {
    const {
        currentAllocation,
        geoBreakdown,
        sectorBreakdown,
        dividendCalendar,
        totalAnnualDividends,
        availableSeriesWithTrend,
        diversificationScore,
        portfolioTrend,
        benchmarkTrend,
        benchmarkTrend24,
    } = useMemo(() => {
        const latestValues: Record<string, number> = {};
        if (marketData.length > 0) {
            const allKeys = new Set<string>();
            marketData.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));
            const cleanKeys = Array.from(allKeys).filter(k =>
                k !== 'date' && k !== 'Date' && !k.startsWith('Taux') && k.trim() !== '' && k !== '1' && k.toLowerCase() !== 'colonne 1' && k !== 'Unnamed: 1',
            );
            cleanKeys.forEach(k => {
                for (let i = marketData.length - 1; i >= 0; i--) {
                    const val = Number(marketData[i][k]);
                    if (val > 0) { latestValues[k] = val; break; }
                }
            });
        }

        const availableSeriesWithTrend = Object.keys(latestValues).map(k => {
            const current = latestValues[k] || 0;
            if (current === 0) return null;
            const trend = seriesReturnPct(marketData, k, perfPeriod, isSyntheticValue);
            const isTotal = k === 'TOTAL';
            const meta = lookupSeedMeta(k) || { name: assets.find(a => a.symbol === k)?.name || k.replace('NASDAQ:', '').replace('NYSE:', '') };
            const name = isTotal ? 'TOTAL PORTEFEUILLE' : (BUCKET_LABELS[k] ?? meta.name);
            return { id: k, name, trend, isTotal };
        }).filter((x): x is SeriesWithTrend => x !== null).sort((a, b) => {
            if (a.isTotal !== b.isTotal) return a.isTotal ? -1 : 1;
            if (a.trend === null && b.trend === null) return 0;
            if (a.trend === null) return 1;
            if (b.trend === null) return -1;
            return b.trend - a.trend;
        });

        const totalSerie = availableSeriesWithTrend.find(s => s.isTotal);
        const portfolioTrend = totalSerie?.trend ?? null;

        const benchAsset = assets.find(a => isBenchmarkCandidate(a.symbol, a.name));
        const cw8Serie = availableSeriesWithTrend.find(s => isBenchmarkCandidate(s.id, s.name));
        const benchmarkTrend = priceReturnPct(benchAsset?.priceHistory, perfPeriod)
            ?? (perfPeriod === '24H' ? cw8Serie?.trend ?? null : null);

        const allocation = assets.map(a => {
            const value = assetValueCad(a, fxRates);
            const { source: _metaSource, ...meta } = resolveAssetMeta(a);
            void _metaSource;
            const trendPct = perfPeriod === '24H' && !variation24hTitreAffichable(a.priceHistory, todayIsoLocal())
                ? null
                : priceReturnPct(a.priceHistory, perfPeriod);
            const effYield = a.dividendYield != null && a.dividendYield > 0 ? a.dividendYield : meta.yield;
            const effFreq = a.dividendFreq ? (FREQ_MAP[a.dividendFreq] ?? meta.freq) : meta.freq;
            return { id: a.symbol, value, trendPct, weight: 0, ...meta, yield: effYield, freq: effFreq, dividendYearly: value * (effYield / 100) };
        }).filter((a): a is AllocationItem => a.value > 0);

        const totalPortfolio = allocation.reduce((s, a) => s + a.value, 0) || 1;
        allocation.forEach(a => { a.weight = (a.value / totalPortfolio) * 100; });
        allocation.sort((a, b) => b.value - a.value);

        const geoMap: Record<string, number> = {};
        const sectorMap: Record<string, number> = {};
        allocation.forEach(a => {
            geoMap[a.region] = (geoMap[a.region] || 0) + a.value;
            sectorMap[a.sector] = (sectorMap[a.sector] || 0) + a.value;
        });
        const geoData = Object.entries(geoMap).map(([name, value]) => ({ name, value, percent: (value / totalPortfolio) * 100 })).sort((a, b) => b.value - a.value);
        const sectorData = Object.entries(sectorMap).map(([name, value]) => ({ name, value, percent: (value / totalPortfolio) * 100 })).sort((a, b) => b.value - a.value);

        const dividendList: DividendItem[] = [];
        let totalDivs = 0;
        const today = new Date();
        allocation.forEach(asset => {
            if (asset.dividendYearly > 0) {
                totalDivs += asset.dividendYearly;
                let nextMonth = asset.nextPayMonth || (today.getMonth() + 2);
                if (nextMonth > 12) nextMonth -= 12;
                const monthName = new Date(today.getFullYear(), nextMonth - 1, 1).toLocaleDateString('fr-CA', { month: 'long' });
                dividendList.push({ ...asset, nextPayout: monthName, amountPerPayout: asset.dividendYearly / asset.freq });
            }
        });
        const sortedDividends = dividendList.sort((a, b) => b.dividendYearly - a.dividendYearly);

        let indexWeight = 0;
        allocation.forEach(a => { if (a.sector === 'Index' || a.sector === 'Mines/Or') indexWeight += a.weight; });
        let safePts = (indexWeight / 40) * 60;
        if (safePts > 60) safePts = 60;
        let trendPts = 20;
        const portfolioTrend24 = seriesReturnPct(marketData, 'TOTAL', '24H');
        const benchmarkTrend24 = priceReturnPct(benchAsset?.priceHistory, '24H')
            ?? (cw8Serie ? seriesReturnPct(marketData, cw8Serie.id, '24H') : null);
        const pt = portfolioTrend24 ?? 0;
        const bt = benchmarkTrend24 ?? 0;
        if (portfolioTrend24 !== null && pt > bt && pt > 0) trendPts += 20;
        else if (portfolioTrend24 !== null && pt > 0) trendPts += 10;
        else if (portfolioTrend24 !== null && pt < 0) trendPts -= 10;
        if (trendPts > 40) trendPts = 40;
        if (trendPts < 0) trendPts = 0;
        const diversificationScore = Math.round(safePts + trendPts);

        return {
            currentAllocation: allocation,
            geoBreakdown: geoData,
            sectorBreakdown: sectorData,
            dividendCalendar: sortedDividends,
            totalAnnualDividends: totalDivs,
            availableSeriesWithTrend,
            diversificationScore,
            portfolioTrend,
            benchmarkTrend,
            benchmarkTrend24,
        };
    }, [marketData, assets, fxRates, perfPeriod, isSyntheticValue]);

    const filteredMarketData = useMemo(() => {
        if (marketData.length === 0) return [];
        const now = new Date();
        let startDate = new Date(marketData[0].date);
        switch (timeRange) {
            case '1M': startDate = new Date(); startDate.setMonth(now.getMonth() - 1); break;
            case '3M': startDate = new Date(); startDate.setMonth(now.getMonth() - 3); break;
            case '6M': startDate = new Date(); startDate.setMonth(now.getMonth() - 6); break;
        }
        return marketData.filter(d => new Date(d.date) >= startDate);
    }, [marketData, timeRange]);

    const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
    const lastPriceRefreshAt = useMemo(() => {
        const stamps = assets.map(a => a.priceUpdatedAt || 0).filter(t => t > 0);
        return stamps.length > 0 ? Math.max(...stamps) : null;
    }, [assets]);
    const coursPerimes = useMemo(() => titresAuCoursPerime(assets, todayIsoLocal()), [assets]);

    const handleRefreshPrices = useCallback(async () => {
        setIsRefreshingPrices(true);
        try {
            let historySyncFailed = false;
            try {
                const { hydrateAssetHistories, applyHistoryPatches } = await import('../../services/history/hydrateAssetHistories');
                const { setHistorySyncReport } = await import('../../services/history/syncDiagnostics');
                clearMarketDataCache('history');
                clearNegativeCache();
                const current = useFinanceStore.getState().assets ?? [];
                const histRes = await hydrateAssetHistories(current, { getHistory: getHistoryDetaille, hasProvider: hasHistoryProvider }, { force: true });
                setHistorySyncReport({ at: Date.now(), skipped: histRes.skipped, patchedCount: histRes.patches.size });
                if (histRes.patches.size > 0) {
                    const freshAssets = useFinanceStore.getState().assets ?? [];
                    setAssets(applyHistoryPatches(freshAssets, histRes.patches));
                }
            } catch (e) {
                historySyncFailed = true;
                logError({ source: 'network', severity: 'error', message: 'Resynchronisation des historiques échouée (les quotes sont quand même actualisées).', error: e });
            }

            const res = await refreshAssetPrices(useFinanceStore.getState().assets ?? [], { getQuote, hasProvider: hasQuoteProvider }, { force: true });
            if (res.patches.size > 0) {
                const fresh = useFinanceStore.getState().assets ?? [];
                setAssets(applyPricePatches(fresh, res.patches));
            }
            const { updateQuoteSkips } = await import('../../services/history/syncDiagnostics');
            updateQuoteSkips(res.skipped);
            const uncovered = res.skipped.filter(s => s.reason === 'no-quote' || s.reason === 'invalid-price' || s.reason === 'error');
            const mismatched = res.skipped.filter(s => s.reason === 'currency-mismatch');
            if (res.refreshed.length + res.unchanged.length + uncovered.length + mismatched.length === 0) {
                showToast('Aucun titre valorisé à actualiser.', 'info');
            } else {
                const parts: string[] = [`${res.refreshed.length} cours mis à jour`];
                if (res.unchanged.length > 0) parts.push(`${res.unchanged.length} déjà à jour`);
                if (uncovered.length > 0) parts.push(`${uncovered.length} sans cours disponible (${uncovered.map(s => s.symbol).slice(0, 4).join(', ')}${uncovered.length > 4 ? '…' : ''}) — introuvable chez Finnhub/Yahoo : fixe le symbole de cotation dans le diagnostic sous le graphe`);
                if (mismatched.length > 0) parts.push(`${mismatched.length} ignoré(s) : devise du quote ≠ devise stockée (${mismatched.map(s => s.symbol).join(', ')})`);
                if (historySyncFailed) parts.push('historiques de cours NON resynchronisés (échec inattendu) — réessaie dans un instant');
                showToast(parts.join(' · '), historySyncFailed ? 'error' : (uncovered.length + mismatched.length > 0 ? 'info' : 'success'));
            }
        } catch (e) {
            logError({ source: 'network', severity: 'warning', message: 'Actualisation des cours échouée (prix existants conservés)', error: e });
            showToast('Actualisation des cours impossible (réseau/fournisseur). Prix existants conservés.', 'error');
        } finally {
            setIsRefreshingPrices(false);
        }
    }, [setAssets]);

    const handleApplyQuoteSymbol = useCallback(async (assetSymbol: string, quoteSymbol: string) => {
        const trimmed = quoteSymbol.trim();
        if (!trimmed) return;
        const current = useFinanceStore.getState().assets ?? [];
        const actif = current.find((a) => a.symbol === assetSymbol);
        if (!actif) return;
        const verdict = verifierSymboleCotation(actif, trimmed, await getQuoteDetaille(trimmed));
        if (verdict.verdict === 'refuse') {
            showToast(verdict.message, 'error');
            return;
        }
        const next = current.map((a) => a.symbol === assetSymbol
            ? { ...a, historySymbol: trimmed === a.symbol ? undefined : trimmed, priceHistory: [], lastHistorySync: undefined }
            : a);
        setAssets(next);
        await handleRefreshPrices();
        if (verdict.avertissement) showToast(verdict.avertissement, 'info');
    }, [handleRefreshPrices, setAssets]);

    const handleAssetMetaChange = useCallback((symbolKey: string, field: 'sector' | 'region', value: string) => {
        const next = assets.map((a) => historyKeyMatchesSymbol(symbolKey, a.symbol) ? { ...a, [field]: value } : a);
        setAssets(next);
    }, [assets, setAssets]);

    const handleAssetAccountChange = useCallback((symbolKey: string, newAccount: string) => {
        const assetIdx = assets.findIndex(a => historyKeyMatchesSymbol(symbolKey, a.symbol));
        if (assetIdx >= 0) {
            const newAssets = [...assets];
            newAssets[assetIdx] = { ...newAssets[assetIdx], accountType: newAccount as RegisteredAccountType };
            setAssets(newAssets);
        }
    }, [assets, setAssets]);

    const handleDeleteAsset = useCallback((symbolKey: string) => {
        const target = assets.find(a => historyKeyMatchesSymbol(symbolKey, a.symbol));
        if (!target) return;
        setAssets(assets.filter(a => a !== target));
        onAfterDelete?.();
        showToast(`Position ${target.symbol} retirée du portefeuille.`, 'info');
    }, [assets, setAssets, onAfterDelete]);

    return {
        currentAllocation,
        geoBreakdown,
        sectorBreakdown,
        dividendCalendar,
        totalAnnualDividends,
        availableSeriesWithTrend,
        diversificationScore,
        portfolioTrend,
        benchmarkTrend,
        benchmarkTrend24,
        filteredMarketData,
        isRefreshingPrices,
        lastPriceRefreshAt,
        coursPerimes,
        handleRefreshPrices,
        handleApplyQuoteSymbol,
        handleAssetMetaChange,
        handleAssetAccountChange,
        handleDeleteAsset,
    };
};
