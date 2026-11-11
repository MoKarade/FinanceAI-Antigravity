// components/future/FutureYearAnatomyModal.tsx
// Lot 6 (F23) — Modale interactive « Anatomie d'une année » au dollar près.
// Agrège les 12 mois projetés d'une année calendaire en 4 dimensions :
//  1. Revenus bruts & rentes
//  2. Impôts & cotisations
//  3. Dépenses, famille & hypothèque
//  4. Bilan de fin d'année & enveloppes fiscales
// Règles GEMINI.md :
//  - No-fake-data : valeur absente ou non finie -> « — », jamais un zéro fabriqué.
//  - Formatage : `formatCAD` / `formatPercent` enveloppés dans `<PrivateAmount>`.
//  - Accessibilité : primitive `<Modal>` (`role="dialog"`, `aria-modal="true"`, Échap, restauration du focus).

import React, { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { PrivateAmount } from '../ui/PrivateAmount';
import { formatCAD, formatPercent } from '../../utils/format';
import { NO_DATA_LABEL } from '../ui/emptyAware';
import type { ProjectionChartPoint } from '../../services/projection/types';

interface FutureYearAnatomyModalProps {
    isOpen: boolean;
    onClose: () => void;
    chartData: readonly ProjectionChartPoint[];
    initialYear?: number;
    userName1?: string;
    userName2?: string;
}

function sumField(points: readonly ProjectionChartPoint[], key: keyof ProjectionChartPoint): number | null {
    let sum = 0;
    let seen = false;
    for (const pt of points) {
        const raw = pt[key];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            sum += raw;
            seen = true;
        }
    }
    return seen ? sum : null;
}

function lastFiniteField(points: readonly ProjectionChartPoint[], key: keyof ProjectionChartPoint): number | null {
    for (let i = points.length - 1; i >= 0; i--) {
        const raw = points[i][key];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            return raw;
        }
    }
    return null;
}

const AnatomyRow: React.FC<{
    label: string;
    amount: number | null;
    subtext?: React.ReactNode;
    strong?: boolean;
}> = ({ label, amount, subtext, strong = false }) => (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? 'border-t border-bordure pt-2 font-bold text-texte' : 'text-texte-doux'}`}>
        <div className="min-w-0">
            <span className="text-tiny">{label}</span>
            {subtext && <span className="block text-tiny text-texte-doux/80">{subtext}</span>}
        </div>
        <span className={`text-tiny tabular-nums shrink-0 ${strong ? 'font-black text-texte' : 'font-semibold text-texte'}`}>
            {amount !== null && Number.isFinite(amount)
                ? <PrivateAmount>{formatCAD(Math.round(amount))}</PrivateAmount>
                : <><span aria-hidden="true">—</span><span className="sr-only">{NO_DATA_LABEL}</span></>}
        </span>
    </div>
);

export const FutureYearAnatomyModal: React.FC<FutureYearAnatomyModalProps> = ({
    isOpen,
    onClose,
    chartData,
    initialYear,
    userName1,
    userName2,
}) => {
    const years = useMemo(() => {
        const set = new Set<number>();
        for (const pt of chartData) {
            if (pt.monthIndex >= 0 && typeof pt.year === 'number' && Number.isFinite(pt.year)) {
                set.add(pt.year);
            }
        }
        return Array.from(set).sort((a, b) => a - b);
    }, [chartData]);

    const defaultYear = useMemo(() => {
        if (initialYear && years.includes(initialYear)) return initialYear;
        return years[0] ?? new Date().getFullYear();
    }, [initialYear, years]);

    const [selectedYear, setSelectedYear] = useState<number>(defaultYear);

    const activeYear = years.includes(selectedYear) ? selectedYear : defaultYear;
    const yearIdx = years.indexOf(activeYear);

    const yearPoints = useMemo(
        () => chartData.filter((pt) => pt.monthIndex >= 0 && pt.year === activeYear),
        [chartData, activeYear],
    );

    const ageEnd = lastFiniteField(yearPoints, 'age');
    const marginalRate = lastFiniteField(yearPoints, 'marginalTaxRate');
    const effectiveRate = lastFiniteField(yearPoints, 'effectiveTaxRate');

    // 1. Revenus & rentes
    const income1 = sumField(yearPoints, 'IncomeMarc');
    const income2 = sumField(yearPoints, 'IncomeAnna');
    const rrq = sumField(yearPoints, 'pensionRRQ');
    const psv = sumField(yearPoints, 'pensionPSV');
    const penPriv = sumField(yearPoints, 'pensionPrivee');
    const rental = sumField(yearPoints, 'RentalIncome');
    const divs = sumField(yearPoints, 'DividendIncome');
    const reeeOut = sumField(yearPoints, 'ReeePayout');
    const totalIncome = sumField(yearPoints, 'Income');

    // 2. Impôts & cotisations
    const taxRev = sumField(yearPoints, 'AccruedTaxRevenu') ?? sumField(yearPoints, 'TaxPaidRevenu');
    const taxGains = sumField(yearPoints, 'AccruedTaxGains') ?? sumField(yearPoints, 'TaxPaidGains');
    const taxReer = sumField(yearPoints, 'WithheldTaxRrif') ?? sumField(yearPoints, 'TaxPaidREER');
    const taxDivers = sumField(yearPoints, 'TaxPaidDivers');
    const fluxImpots = sumField(yearPoints, 'FluxImpots');

    // 3. Dépenses, famille & logement
    const expenses = sumField(yearPoints, 'Expenses');
    const childGross = sumField(yearPoints, 'childGross');
    const childBenefits = sumField(yearPoints, 'childBenefits');
    const immoPrincipal = sumField(yearPoints, 'ImmoPrincipal');
    const immoInterest = sumField(yearPoints, 'ImmoInterest');
    const immoCharges = sumField(yearPoints, 'ImmoCharges');
    const savings = sumField(yearPoints, 'Savings');

    // 4. Bilan & enveloppes fiscales (fin d'année)
    const nwEnd = lastFiniteField(yearPoints, 'NetWorth');
    const realNwEnd = lastFiniteField(yearPoints, 'realNetWorth');
    const cashEnd = lastFiniteField(yearPoints, 'Liquidites');
    const celiEnd = lastFiniteField(yearPoints, 'CELI');
    const celiMax = lastFiniteField(yearPoints, 'CELIMax');
    const celiappEnd = lastFiniteField(yearPoints, 'CELIAPP');
    const reerEnd = lastFiniteField(yearPoints, 'REER');
    const reerMax = lastFiniteField(yearPoints, 'REERMax');
    const reeeEnd = lastFiniteField(yearPoints, 'REEE');
    const nonRegEnd = lastFiniteField(yearPoints, 'NonReg');
    const immoEnd = lastFiniteField(yearPoints, 'Immobilier');
    const dettesEnd = lastFiniteField(yearPoints, 'DettesNonImmo');
    const impotLatentEnd = lastFiniteField(yearPoints, 'ImpotLatent');

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            size="xl"
            title={`Anatomie d'une année — ${activeYear}`}
        >
            <div className="space-y-4">
                {/* Barre de navigation d'année */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-douce border border-bordure px-3 py-2">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            disabled={yearIdx <= 0}
                            onClick={() => yearIdx > 0 && setSelectedYear(years[yearIdx - 1])}
                            aria-label="Année précédente"
                            className="touch-target min-h-11 rounded-lg border border-bordure bg-fond px-3 py-1.5 text-tiny font-bold text-texte focus-ring disabled:opacity-40"
                        >
                            ← Précédente
                        </button>
                        <select
                            aria-label="Choisir l'année projetée"
                            value={activeYear}
                            onChange={(e) => setSelectedYear(Number(e.target.value))}
                            className="touch-target min-h-11 rounded-lg border border-bordure-champ bg-fond px-3 py-1.5 text-tiny font-bold text-texte focus-ring tabular-nums"
                        >
                            {years.map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                        <button
                            type="button"
                            disabled={yearIdx === -1 || yearIdx >= years.length - 1}
                            onClick={() => yearIdx >= 0 && yearIdx < years.length - 1 && setSelectedYear(years[yearIdx + 1])}
                            aria-label="Année suivante"
                            className="touch-target min-h-11 rounded-lg border border-bordure bg-fond px-3 py-1.5 text-tiny font-bold text-texte focus-ring disabled:opacity-40"
                        >
                            Suivante →
                        </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-tiny text-texte-doux">
                        {/* NOMBRE-NON-MONETAIRE : nombre de mois agrégés dans l'année calendaire */}
                        <span>{yearPoints.length} mois projeté{yearPoints.length > 1 ? 's' : ''}</span>
                        {ageEnd !== null && (
                            <span>
                                Âge fin d&apos;année : <strong className="text-texte"><PrivateAmount>{Math.floor(ageEnd)} ans</PrivateAmount></strong>
                            </span>
                        )}
                    </div>
                </div>

                {yearPoints.length === 0 ? (
                    <p className="rounded-xl border border-bordure bg-surface-douce p-4 text-tiny text-texte-doux">
                        Aucune donnée mensuelle projetée disponible pour cette année.
                    </p>
                ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                        {/* 1. Revenus & Rentes */}
                        <section className="rounded-xl border border-bordure bg-surface-douce p-3.5">
                            <h3 className="text-meta font-black text-texte mb-2">1. Revenus &amp; Rentes</h3>
                            <AnatomyRow label={`Revenu d'emploi (${userName1 || 'Personne 1'})`} amount={income1} />
                            {income2 !== null && income2 > 0 && (
                                <AnatomyRow label={`Revenu d'emploi (${userName2 || 'Personne 2'})`} amount={income2} />
                            )}
                            <AnatomyRow label="Rente RRQ / RPC" amount={rrq} />
                            <AnatomyRow label="Pension de la Sécurité de la vieillesse (PSV)" amount={psv} />
                            <AnatomyRow label="Rente employeur / privée" amount={penPriv} />
                            <AnatomyRow label="Revenus locatifs nets" amount={rental} />
                            <AnatomyRow label="Dividendes perçus (non-enregistré)" amount={divs} />
                            <AnatomyRow label="Décaissements REEE (PSE + PAE)" amount={reeeOut} />
                            <AnatomyRow label="Total des entrées nettes encaissées" amount={totalIncome} strong />
                        </section>

                        {/* 2. Impôts & Cotisations */}
                        <section className="rounded-xl border border-bordure bg-surface-douce p-3.5">
                            <h3 className="text-meta font-black text-texte mb-2">2. Impôts &amp; Cotisations</h3>
                            <AnatomyRow label="Impôt couru / payé sur le revenu" amount={taxRev} />
                            <AnatomyRow label="Impôt sur gains en capital réalisés" amount={taxGains} />
                            <AnatomyRow label="Retenue fiscale REER / FERR" amount={taxReer} />
                            <AnatomyRow label="Cotisations &amp; régularisations diverses" amount={taxDivers} />
                            <AnatomyRow label="Flux net de règlement fiscal (avril / déc.)" amount={fluxImpots} strong />
                            <div className="mt-2 pt-2 border-t border-bordure flex items-center justify-between text-tiny text-texte-doux">
                                <span>Taux marginal / effectif</span>
                                <span className="font-bold text-texte tabular-nums">
                                    {marginalRate !== null
                                        ? <PrivateAmount>{formatPercent(marginalRate <= 1 ? marginalRate * 100 : marginalRate)}</PrivateAmount>
                                        : NO_DATA_LABEL}
                                    {' / '}
                                    {effectiveRate !== null
                                        ? <PrivateAmount>{formatPercent(effectiveRate <= 1 ? effectiveRate * 100 : effectiveRate)}</PrivateAmount>
                                        : NO_DATA_LABEL}
                                </span>
                            </div>
                        </section>

                        {/* 3. Dépenses & Famille */}
                        <section className="rounded-xl border border-bordure bg-surface-douce p-3.5">
                            <h3 className="text-meta font-black text-texte mb-2">3. Dépenses &amp; Famille</h3>
                            <AnatomyRow label="Train de vie &amp; dépenses courantes" amount={expenses} />
                            <AnatomyRow label="Coûts bruts liés aux enfants" amount={childGross} />
                            <AnatomyRow label="Allocations familiales reçues (ACE + AF Québec)" amount={childBenefits} />
                            <AnatomyRow label="Capital hypothécaire remboursé" amount={immoPrincipal} />
                            <AnatomyRow label="Intérêts hypothécaires" amount={immoInterest} />
                            <AnatomyRow label="Taxes &amp; charges immobilières" amount={immoCharges} />
                            <AnatomyRow label="Épargne nette dirigée vers les comptes" amount={savings} strong />
                        </section>

                        {/* 4. Bilan & Portefeuille */}
                        <section className="rounded-xl border border-bordure bg-surface-douce p-3.5">
                            <h3 className="text-meta font-black text-texte mb-2">4. Bilan &amp; Portefeuille (fin {activeYear})</h3>
                            <AnatomyRow label="Liquidités (coussin)" amount={cashEnd} />
                            <AnatomyRow
                                label="CELI"
                                amount={celiEnd}
                                subtext={celiMax !== null && celiEnd !== null ? (
                                    <>Plafond cumulé : <PrivateAmount>{formatCAD(Math.round(celiMax))}</PrivateAmount></>
                                ) : undefined}
                            />
                            {celiappEnd !== null && celiappEnd > 0 && (
                                <AnatomyRow label="CELIAPP" amount={celiappEnd} />
                            )}
                            <AnatomyRow
                                label="REER / FERR"
                                amount={reerEnd}
                                subtext={reerMax !== null && reerEnd !== null ? (
                                    <>Droits totaux : <PrivateAmount>{formatCAD(Math.round(reerMax))}</PrivateAmount></>
                                ) : undefined}
                            />
                            {reeeEnd !== null && reeeEnd > 0 && (
                                <AnatomyRow label="REEE" amount={reeeEnd} />
                            )}
                            <AnatomyRow label="Compte non enregistré" amount={nonRegEnd} />
                            <AnatomyRow label="Équité immobilière nette" amount={immoEnd} />
                            <AnatomyRow label="Dettes hors hypothèque" amount={dettesEnd} />
                            <AnatomyRow label="Impôt latent estimé à la liquidation" amount={impotLatentEnd} />
                            <AnatomyRow label="Patrimoine net nominal" amount={nwEnd} strong />
                            <AnatomyRow label="Patrimoine net en dollars constants" amount={realNwEnd} />
                        </section>
                    </div>
                )}
            </div>
        </Modal>
    );
};

