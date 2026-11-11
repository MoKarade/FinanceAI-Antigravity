// services/projection/historicalReturns.ts
// W1.2 — Bootstrap historique des rendements réels du marché US.
//
// Au lieu de tirer des rendements gaussiens (qui sous-estiment les queues),
// on rééchantillonne des blocs consécutifs de l'historique réel S&P 500
// + inflation US. Capture les vrais krachs (1929, 1973-74, 2000-02, 2008, 2020).
//
// Source: Robert Shiller data (yale.edu/~shiller), rendements annuels nominaux
// total return du S&P 500 + CPI inflation US. Période 1928-2024 (97 ans).
//
// Les valeurs sont des proxys / fortement arrondies pour rester compactes;
// elles capturent l'essentiel des distributions (crashs et booms).

export interface YearReturn {
    year: number;
    sp500TotalReturn: number;   // total return nominal (%), incl. dividendes
    bondReturn: number;         // 10Y Treasury return nominal (%)
    inflationRate: number;      // CPI US (%)
    canadianCpi?: number;       // CPI Canada (%) — Statistique Canada série v41690973
    tsxTotalReturn?: number;    // Rendement total composé S&P/TSX en CAD (%)
    canadianBondReturn?: number;// Rendement obligations gouvernementales CA 10 ans (%)
    usdCadReturn?: number;      // Variation annuelle du taux de change USD/CAD (%)
}

// Données 1928-2024 (rendements en %). Source: Aswath Damodaran (NYU Stern).
// Format compact. Pour usage projection on convertit en mois.
const HISTORICAL_RETURNS_US: YearReturn[] = [
    { year: 1928, sp500TotalReturn: 43.81, bondReturn:  0.84, inflationRate: -1.15 },
    { year: 1929, sp500TotalReturn: -8.30, bondReturn:  4.20, inflationRate:  0.58 },
    { year: 1930, sp500TotalReturn:-25.12, bondReturn:  4.54, inflationRate: -6.40 },
    { year: 1931, sp500TotalReturn:-43.84, bondReturn: -2.56, inflationRate: -9.32 },
    { year: 1932, sp500TotalReturn: -8.64, bondReturn:  8.79, inflationRate:-10.27 },
    { year: 1933, sp500TotalReturn: 49.98, bondReturn:  1.86, inflationRate:  0.76 },
    { year: 1934, sp500TotalReturn: -1.19, bondReturn:  7.96, inflationRate:  1.52 },
    { year: 1935, sp500TotalReturn: 46.74, bondReturn:  4.47, inflationRate:  2.99 },
    { year: 1936, sp500TotalReturn: 31.94, bondReturn:  5.02, inflationRate:  1.45 },
    { year: 1937, sp500TotalReturn:-35.34, bondReturn:  1.38, inflationRate:  2.86 },
    { year: 1938, sp500TotalReturn: 29.28, bondReturn:  4.21, inflationRate: -2.78 },
    { year: 1939, sp500TotalReturn: -1.10, bondReturn:  4.41, inflationRate: -1.15 },
    { year: 1940, sp500TotalReturn: -10.67, bondReturn: 5.40, inflationRate:  0.97 },
    { year: 1941, sp500TotalReturn:-12.77, bondReturn:  -2.02, inflationRate: 9.93 },
    { year: 1942, sp500TotalReturn: 19.17, bondReturn:  2.29, inflationRate:  9.03 },
    { year: 1943, sp500TotalReturn: 25.06, bondReturn:  2.49, inflationRate:  2.96 },
    { year: 1944, sp500TotalReturn: 19.03, bondReturn:  2.58, inflationRate:  2.30 },
    { year: 1945, sp500TotalReturn: 35.82, bondReturn:  3.80, inflationRate:  2.25 },
    { year: 1946, sp500TotalReturn: -8.43, bondReturn:  3.13, inflationRate: 18.13 },
    { year: 1947, sp500TotalReturn:  5.20, bondReturn:  0.92, inflationRate:  8.84 },
    { year: 1948, sp500TotalReturn:  5.70, bondReturn:  1.95, inflationRate:  2.99 },
    { year: 1949, sp500TotalReturn: 18.30, bondReturn:  4.66, inflationRate: -2.07 },
    { year: 1950, sp500TotalReturn: 30.81, bondReturn:  0.43, inflationRate:  5.93 },
    { year: 1951, sp500TotalReturn: 23.68, bondReturn: -0.30, inflationRate:  6.00 },
    { year: 1952, sp500TotalReturn: 18.15, bondReturn:  2.27, inflationRate:  0.75 },
    { year: 1953, sp500TotalReturn: -1.21, bondReturn:  4.14, inflationRate:  0.75 },
    { year: 1954, sp500TotalReturn: 52.56, bondReturn:  3.29, inflationRate: -0.74 },
    { year: 1955, sp500TotalReturn: 32.60, bondReturn: -1.34, inflationRate:  0.37 },
    { year: 1956, sp500TotalReturn:  7.44, bondReturn: -2.26, inflationRate:  2.99 },
    { year: 1957, sp500TotalReturn:-10.46, bondReturn:  6.80, inflationRate:  2.90 },
    { year: 1958, sp500TotalReturn: 43.72, bondReturn: -2.10, inflationRate:  1.76 },
    { year: 1959, sp500TotalReturn: 12.06, bondReturn: -2.65, inflationRate:  1.73 },
    { year: 1960, sp500TotalReturn:  0.34, bondReturn: 11.64, inflationRate:  1.36 },
    { year: 1961, sp500TotalReturn: 26.64, bondReturn:  2.06, inflationRate:  0.67 },
    { year: 1962, sp500TotalReturn: -8.81, bondReturn:  5.69, inflationRate:  1.33 },
    { year: 1963, sp500TotalReturn: 22.61, bondReturn:  1.68, inflationRate:  1.64 },
    { year: 1964, sp500TotalReturn: 16.42, bondReturn:  3.73, inflationRate:  0.97 },
    { year: 1965, sp500TotalReturn: 12.40, bondReturn:  0.72, inflationRate:  1.92 },
    { year: 1966, sp500TotalReturn: -9.97, bondReturn:  2.91, inflationRate:  3.46 },
    { year: 1967, sp500TotalReturn: 23.80, bondReturn: -1.58, inflationRate:  3.04 },
    { year: 1968, sp500TotalReturn: 10.81, bondReturn:  3.27, inflationRate:  4.72 },
    { year: 1969, sp500TotalReturn: -8.24, bondReturn: -5.01, inflationRate:  6.20 },
    { year: 1970, sp500TotalReturn:  3.56, bondReturn: 16.75, inflationRate:  5.57 },
    { year: 1971, sp500TotalReturn: 14.22, bondReturn:  9.79, inflationRate:  3.27 },
    { year: 1972, sp500TotalReturn: 18.76, bondReturn:  2.82, inflationRate:  3.41 },
    { year: 1973, sp500TotalReturn:-14.31, bondReturn:  3.66, inflationRate:  8.71 },
    { year: 1974, sp500TotalReturn:-25.90, bondReturn:  1.99, inflationRate: 12.34 },
    { year: 1975, sp500TotalReturn: 37.00, bondReturn:  3.61, inflationRate:  6.94 },
    { year: 1976, sp500TotalReturn: 23.83, bondReturn: 15.98, inflationRate:  4.86 },
    { year: 1977, sp500TotalReturn: -6.98, bondReturn:  1.29, inflationRate:  6.70 },
    { year: 1978, sp500TotalReturn:  6.51, bondReturn: -0.78, inflationRate:  9.02 },
    { year: 1979, sp500TotalReturn: 18.52, bondReturn:  0.67, inflationRate: 13.29 },
    { year: 1980, sp500TotalReturn: 31.74, bondReturn: -2.99, inflationRate: 12.52 },
    { year: 1981, sp500TotalReturn: -4.70, bondReturn:  8.20, inflationRate:  8.92 },
    { year: 1982, sp500TotalReturn: 20.42, bondReturn: 32.81, inflationRate:  3.83 },
    { year: 1983, sp500TotalReturn: 22.34, bondReturn:  3.20, inflationRate:  3.79 },
    { year: 1984, sp500TotalReturn:  6.15, bondReturn: 13.73, inflationRate:  3.95 },
    { year: 1985, sp500TotalReturn: 31.24, bondReturn: 25.71, inflationRate:  3.80 },
    { year: 1986, sp500TotalReturn: 18.49, bondReturn: 24.28, inflationRate:  1.10 },
    { year: 1987, sp500TotalReturn:  5.81, bondReturn: -4.96, inflationRate:  4.43 },
    { year: 1988, sp500TotalReturn: 16.54, bondReturn:  8.22, inflationRate:  4.42 },
    { year: 1989, sp500TotalReturn: 31.48, bondReturn: 17.69, inflationRate:  4.65 },
    { year: 1990, sp500TotalReturn: -3.06, bondReturn:  6.24, inflationRate:  6.11 },
    { year: 1991, sp500TotalReturn: 30.23, bondReturn: 15.00, inflationRate:  3.06 },
    { year: 1992, sp500TotalReturn:  7.49, bondReturn:  9.36, inflationRate:  2.90 },
    { year: 1993, sp500TotalReturn:  9.97, bondReturn: 14.21, inflationRate:  2.75 },
    { year: 1994, sp500TotalReturn:  1.33, bondReturn: -8.04, inflationRate:  2.67 },
    { year: 1995, sp500TotalReturn: 37.20, bondReturn: 23.48, inflationRate:  2.54 },
    { year: 1996, sp500TotalReturn: 23.82, bondReturn:  1.43, inflationRate:  3.32 },
    { year: 1997, sp500TotalReturn: 31.86, bondReturn:  9.94, inflationRate:  1.70 },
    { year: 1998, sp500TotalReturn: 28.34, bondReturn: 14.92, inflationRate:  1.61 },
    { year: 1999, sp500TotalReturn: 20.89, bondReturn: -8.25, inflationRate:  2.68 },
    { year: 2000, sp500TotalReturn: -9.03, bondReturn: 16.66, inflationRate:  3.39 },
    { year: 2001, sp500TotalReturn:-11.85, bondReturn:  5.57, inflationRate:  1.55 },
    { year: 2002, sp500TotalReturn:-21.97, bondReturn: 15.12, inflationRate:  2.38 },
    { year: 2003, sp500TotalReturn: 28.36, bondReturn:  0.38, inflationRate:  1.88 },
    { year: 2004, sp500TotalReturn: 10.74, bondReturn:  4.49, inflationRate:  3.26 },
    { year: 2005, sp500TotalReturn:  4.83, bondReturn:  2.87, inflationRate:  3.42 },
    { year: 2006, sp500TotalReturn: 15.61, bondReturn:  1.96, inflationRate:  2.54 },
    { year: 2007, sp500TotalReturn:  5.48, bondReturn: 10.21, inflationRate:  4.08 },
    { year: 2008, sp500TotalReturn:-36.55, bondReturn: 20.10, inflationRate:  0.09 },
    { year: 2009, sp500TotalReturn: 25.94, bondReturn: -11.12, inflationRate: 2.72 },
    { year: 2010, sp500TotalReturn: 14.82, bondReturn:  8.46, inflationRate:  1.50 },
    { year: 2011, sp500TotalReturn:  2.10, bondReturn: 16.04, inflationRate:  2.96 },
    { year: 2012, sp500TotalReturn: 15.89, bondReturn:  2.97, inflationRate:  1.74 },
    { year: 2013, sp500TotalReturn: 32.15, bondReturn: -9.10, inflationRate:  1.50 },
    { year: 2014, sp500TotalReturn: 13.52, bondReturn: 10.75, inflationRate:  0.76 },
    { year: 2015, sp500TotalReturn:  1.36, bondReturn:  1.28, inflationRate:  0.73 },
    { year: 2016, sp500TotalReturn: 11.74, bondReturn:  0.69, inflationRate:  2.07 },
    { year: 2017, sp500TotalReturn: 21.61, bondReturn:  2.80, inflationRate:  2.11 },
    { year: 2018, sp500TotalReturn: -4.23, bondReturn:  0.01, inflationRate:  1.91 },
    { year: 2019, sp500TotalReturn: 31.21, bondReturn:  9.64, inflationRate:  2.29 },
    { year: 2020, sp500TotalReturn: 18.02, bondReturn: 11.33, inflationRate:  1.36 },
    { year: 2021, sp500TotalReturn: 28.47, bondReturn: -4.42, inflationRate:  7.04 },
    { year: 2022, sp500TotalReturn:-18.04, bondReturn:-17.83, inflationRate:  6.45 },
    { year: 2023, sp500TotalReturn: 26.06, bondReturn:  3.88, inflationRate:  3.35 },
    { year: 2024, sp500TotalReturn: 25.02, bondReturn:  0.58, inflationRate:  2.95 },
];

function enrichYearReturn(y: YearReturn): YearReturn {
    const canadianCpi = CANADIAN_CPI[y.year] ?? y.inflationRate;
    const tsxTotalReturn = CANADIAN_TSX_RETURN[y.year] ?? Number((y.sp500TotalReturn * 0.85 + 1.2).toFixed(2));
    const canadianBondReturn = CANADIAN_BOND_RETURN[y.year] ?? y.bondReturn;
    const usdCadReturn = USD_CAD_FX_CHANGE[y.year] ?? 0;
    return {
        ...y,
        canadianCpi,
        tsxTotalReturn,
        canadianBondReturn,
        usdCadReturn,
    };
}

/**
 * Échantillonne un bloc de N années consécutives parmi l'historique.
 * Si le bloc dépasse la fin du dataset, on wrap-around (concat début).
 */
function sampleHistoricalBlock(
    rng: () => number,
    blockYears: number,
): YearReturn[] {
    const n = HISTORICAL_RETURNS_US.length;
    const start = Math.floor(rng() * n);
    const block: YearReturn[] = [];
    for (let i = 0; i < blockYears; i++) {
        block.push(enrichYearReturn(HISTORICAL_RETURNS_US[(start + i) % n]));
    }
    return block;
}

/**
 * Pour une projection de N années, construit une séquence annuelle
 * en assemblant des blocs successifs de `blockSize` années.
 * Cela capture la corrélation temporelle (booms longs, récessions persistantes).
 */
export function buildHistoricalSequence(
    rng: () => number,
    totalYears: number,
    blockSize: number = 24,
): YearReturn[] {
    const seq: YearReturn[] = [];
    while (seq.length < totalYears) {
        const block = sampleHistoricalBlock(rng, blockSize);
        seq.push(...block);
    }
    return seq.slice(0, totalYears);
}

/**
 * W4.5 — Replay historique. Force la simulation à utiliser les rendements
 * réels à partir d'une année donnée (ex: 1929 pour tester un krach
 * pendant la décennie critique).
 */
export function buildReplaySequence(
    startYear: number,
    totalYears: number,
): YearReturn[] {
    const idx = HISTORICAL_RETURNS_US.findIndex(y => y.year === startYear);
    if (idx === -1) return HISTORICAL_RETURNS_US.slice(0, totalYears).map(enrichYearReturn);
    const seq: YearReturn[] = [];
    for (let i = 0; i < totalYears; i++) {
        seq.push(enrichYearReturn(HISTORICAL_RETURNS_US[(idx + i) % HISTORICAL_RETURNS_US.length]));
    }
    return seq;
}

// ───────────────────────────────────────────────────────────────────────────
// CPI Canada 1928-2024 — Statistique Canada (série historique v41690973)
// Tableau (variation annuelle %, fin d'année). Différence notable avec US:
// inflation plus modérée années 70 (CA avait des contrôles de prix).
// Source: Bank of Canada CPI data + StatCan tables 18-10-0004.
// ───────────────────────────────────────────────────────────────────────────
const CANADIAN_CPI: Record<number, number> = {
    1928:  1.1,  1929:  0.0,  1930: -3.4,  1931: -8.9,  1932: -9.3,
    1933: -3.4,  1934:  0.7,  1935:  1.4,  1936:  2.1,  1937:  3.4,
    1938: -0.7,  1939:  0.0,  1940:  3.4,  1941:  6.4,  1942:  4.1,
    1943:  1.7,  1944:  0.7,  1945:  1.6,  1946:  3.5,  1947:  9.9,
    1948: 14.4,  1949:  3.0,  1950:  2.9,  1951: 10.6,  1952:  2.4,
    1953: -0.9,  1954:  0.6,  1955:  0.1,  1956:  1.5,  1957:  3.3,
    1958:  2.6,  1959:  1.1,  1960:  1.2,  1961:  0.4,  1962:  1.7,
    1963:  1.8,  1964:  1.9,  1965:  2.4,  1966:  3.7,  1967:  3.6,
    1968:  4.0,  1969:  4.6,  1970:  3.4,  1971:  2.8,  1972:  4.8,
    1973:  7.5,  1974: 10.9,  1975: 10.7,  1976:  7.5,  1977:  8.0,
    1978:  8.9,  1979:  9.1,  1980: 10.1,  1981: 12.5,  1982: 10.8,
    1983:  5.8,  1984:  4.3,  1985:  4.0,  1986:  4.1,  1987:  4.4,
    1988:  4.0,  1989:  5.0,  1990:  4.8,  1991:  5.6,  1992:  1.5,
    1993:  1.8,  1994:  0.2,  1995:  2.2,  1996:  1.6,  1997:  1.6,
    1998:  1.0,  1999:  1.7,  2000:  2.7,  2001:  2.5,  2002:  2.2,
    2003:  2.8,  2004:  1.9,  2005:  2.2,  2006:  2.0,  2007:  2.1,
    2008:  2.4,  2009:  0.3,  2010:  1.8,  2011:  2.9,  2012:  1.5,
    2013:  0.9,  2014:  1.9,  2015:  1.1,  2016:  1.4,  2017:  1.6,
    2018:  2.3,  2019:  1.9,  2020:  0.7,  2021:  3.4,  2022:  6.8,
    2023:  3.9,  2024:  2.4,
};

// FIX cycle 2 code-reviewer (MEDIUM): suppression de la mutation top-level
// de HISTORICAL_RETURNS_US (effet de bord cross-test). Le CPI canadien est
// désormais lu à la demande via canadianInflationFor(year, fallback).

/**
 * Récupère le CPI canadien pour une année donnée, avec fallback US si manquant.
 */
export function canadianInflationFor(year: number, fallbackUsCpi: number): number {
    return CANADIAN_CPI[year] ?? fallbackUsCpi;
}

// ───────────────────────────────────────────────────────────────────────────
// S&P/TSX Composite Total Return (CAD, %) 1928-2024
// Sources : CIA / Institut canadien des actuaires (Rapport sur les statistiques
// économiques canadiennes 1924-2024) & Banque du Canada.
// ───────────────────────────────────────────────────────────────────────────
const CANADIAN_TSX_RETURN: Record<number, number> = {
    1928: 31.5, 1929: -11.2, 1930: -28.4, 1931: -34.6, 1932: -10.8,
    1933: 48.2, 1934: 12.4,  1935: 27.8,  1936: 24.5,  1937: -18.9,
    1938: 8.4,  1939: -2.1,  1940: -18.5, 1941: -1.4,  1942: 14.8,
    1943: 24.1, 1944: 13.5,  1945: 33.2,  1946: -1.8,  1947: 2.9,
    1948: 9.8,  1949: 19.4,  1950: 42.1,  1951: 24.3,  1952: -1.5,
    1953: 2.1,  1954: 39.4,  1955: 27.2,  1956: 12.3,  1957: -20.6,
    1958: 31.3, 1959: 4.6,   1960: 1.8,   1961: 32.7,  1962: -7.1,
    1963: 15.6, 1964: 25.4,  1965: 6.7,   1966: -7.1,  1967: 18.1,
    1968: 22.5, 1969: -0.8,  1970: -3.6,  1971: 8.0,   1972: 27.4,
    1973: 0.3,  1974: -25.9, 1975: 18.5,  1976: 11.0,  1977: 10.7,
    1978: 29.7, 1979: 44.8,  1980: 30.1,  1981: -10.2, 1982: 5.5,
    1983: 35.5, 1984: -2.4,  1985: 25.1,  1986: 8.9,   1987: 5.9,
    1988: 11.1, 1989: 21.4,  1990: -14.8, 1991: 12.0,  1992: -1.4,
    1993: 32.5, 1994: -0.2,  1995: 14.5,  1996: 28.3,  1997: 15.0,
    1998: -1.6, 1999: 31.7,  2000: 7.4,   2001: -12.6, 2002: -12.4,
    2003: 26.7, 2004: 14.5,  2005: 24.1,  2006: 17.3,  2007: 9.8,
    2008: -33.0,2009: 35.1,  2010: 17.6,  2011: -8.7,  2012: 7.2,
    2013: 13.0, 2014: 10.6,  2015: -8.3,  2016: 21.1,  2017: 9.1,
    2018: -8.9, 2019: 22.9,  2020: 5.6,   2021: 25.1,  2022: -5.8,
    2023: 11.8, 2024: 21.7,
};

// Variation annuelle USD/CAD (%) — > 0 signifie appréciation de l'USD face au CAD
// (amortit les krachs boursiers mondiaux pour un investisseur canadien non couvert, ex: 2008 +22.1 %).
const USD_CAD_FX_CHANGE: Record<number, number> = {
    1970: -5.6, 1971: -0.9, 1972: -0.7, 1973: 0.0,  1974: -0.9,
    1975: 2.6,  1976: -0.7, 1977: 8.5,  1978: 8.4,  1979: -1.5,
    1980: 2.3,  1981: -0.8, 1982: 3.6,  1983: 1.2,  1984: 6.2,
    1985: 5.8,  1986: -1.2, 1987: -5.9, 1988: -8.2, 1989: -3.0,
    1990: 0.2,  1991: -0.4, 1992: 10.0, 1993: 4.2,  1994: 5.9,
    1995: -2.7, 1996: 0.4,  1997: 4.3,  1998: 7.1,  1999: -5.8,
    2000: 3.9,  2001: 6.2,  2002: -1.0, 2003: -18.0,2004: -7.5,
    2005: -3.4, 2006: 0.0,  2007: -14.8,2008: 22.1, 2009: -13.7,
    2010: -5.4, 2011: 2.3,  2012: -2.2, 2013: 6.9,  2014: 9.1,
    2015: 19.3, 2016: -2.9, 2017: -6.4, 2018: 8.5,  2019: -4.8,
    2020: -1.9, 2021: -0.7, 2022: 7.0,  2023: -2.3, 2024: 8.6,
};

const CANADIAN_BOND_RETURN: Record<number, number> = {
    2000: 10.3, 2001: 8.1,  2002: 8.7,  2003: 6.7,  2004: 7.1,
    2005: 6.5,  2006: 4.1,  2007: 3.7,  2008: 6.4,  2009: 5.4,
    2010: 6.7,  2011: 9.7,  2012: 3.6,  2013: -1.2, 2014: 8.8,
    2015: 3.5,  2016: 1.7,  2017: 2.5,  2018: 1.4,  2019: 6.9,
    2020: 8.7,  2021: -2.5, 2022: -11.7,2023: 6.7,  2024: 4.2,
};

export function tsxReturnFor(year: number, fallbackSp500: number): number {
    return CANADIAN_TSX_RETURN[year] ?? Number((fallbackSp500 * 0.85 + 1.2).toFixed(2));
}

export function usdCadReturnFor(year: number): number {
    return USD_CAD_FX_CHANGE[year] ?? 0;
}

export function canadianBondReturnFor(year: number, fallbackUsBond: number): number {
    return CANADIAN_BOND_RETURN[year] ?? fallbackUsBond;
}

/**
 * Convertit un rendement en devise étrangère (ex. USD) en rendement CAD :
 * (1 + r_US) * (1 + r_FX) - 1
 */
export function convertUsdReturnToCad(rUsdDecimal: number, rFxDecimal: number): number {
    return (1 + rUsdDecimal) * (1 + rFxDecimal) - 1;
}

/**
 * Calcule le rendement réel après déflation de l'inflation (formule de Fisher) :
 * (1 + r_nominal) / (1 + inflation) - 1
 */
export function computeRealReturnFromInflation(nominalDecimal: number, inflationDecimal: number): number {
    if (inflationDecimal <= -1) return nominalDecimal;
    return (1 + nominalDecimal) / (1 + inflationDecimal) - 1;
}

export function getHistoricalReturnsDataset(): ReadonlyArray<YearReturn> {
    return HISTORICAL_RETURNS_US.map(enrichYearReturn);
}
