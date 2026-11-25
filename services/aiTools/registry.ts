// services/aiTools/registry.ts
//
// [AITOOLS-B] Registre des tools consommés par le chat Gemini IN-APP (tool-use).
// Ce sont les MÊMES specs que le serveur MCP (mcp/tools/*.spec.ts) — la parité « mêmes réponses
// que le serveur MCP » est garantie par construction (une seule logique) et verrouillée par
// tests/aiTools/registryParity.test.ts (même état → même payload).
//
// Périmètre Lot B : LECTURE SEULE (11 tools — 8 data-aware + 3 calculateurs stateless).
// Les 5 tools d'écriture (apply_*) arrivent au Lot D avec le flux de CONFIRMATION obligatoire
// (diff avant/après + clic Appliquer) — JAMAIS d'écriture sans confirmation (exigence Marc).
// Exclus définitifs : `ping` (health-check serveur), `connect_drive` (OAuth loopback Node —
// l'app EST la source de données, ce tool n'a pas de sens ici).
//
// ⚠️ Browser-safe : ce module (et tout services/aiTools/) ne doit JAMAIS importer le SDK serveur
// MCP ni un module Node-only — garde : tests/aiTools/noMcpSdkInSpecs.test.ts.

import type { AnyReadToolSpec, AnyWriteToolSpec } from './specs/_toolSpec';
import { getFinancialOverviewSpec } from './specs/getFinancialOverview.spec';
import { getHoldingsSpec } from './specs/getHoldings.spec';
import { getProjectionSpec } from './specs/getProjection.spec';
import { getTaxSituationSpec } from './specs/getTaxSituation.spec';
import { getRetirementOutlookSpec } from './specs/getRetirementOutlook.spec';
import { getNextBestActionsSpec } from './specs/getNextBestActions.spec';
import { searchTransactionsSpec } from './specs/searchTransactions.spec';
import { simulateWhatIfSpec } from './specs/simulateWhatIf.spec';
import { getTaxRoomSpec } from './specs/getTaxRoom.spec';
import { calculateRealEstateSpec } from './specs/calculateRealEstate.spec';
import { runProjectionSpec } from './specs/runProjection.spec';
import { applyDebtSpec } from './specs/applyDebt.spec';
import { applyPayslipSpec } from './specs/applyPayslip.spec';
import { applyBankStatementSpec } from './specs/applyBankStatement.spec';
import { applyBrokerStatementSpec } from './specs/applyBrokerStatement.spec';
import { applyTaxSlipSpec } from './specs/applyTaxSlip.spec';
import { setCashSpec } from './specs/setCash.spec';
import { setBudgetItemSpec } from './specs/setBudgetItem.spec';
import { deleteItemSpec } from './specs/deleteItem.spec';

/** Tools de LECTURE exposés au chat in-app. AUCUNE mutation possible par ces handlers. */
export const READ_SPECS: AnyReadToolSpec[] = [
    getFinancialOverviewSpec,
    getHoldingsSpec,
    getProjectionSpec,
    getTaxSituationSpec,
    getRetirementOutlookSpec,
    getNextBestActionsSpec,
    searchTransactionsSpec,
    simulateWhatIfSpec,
    getTaxRoomSpec,
    calculateRealEstateSpec,
    runProjectionSpec,
];

/**
 * [AITOOLS-D] Tools d'ÉCRITURE exposés au chat in-app — les MÊMES specs que le serveur MCP.
 * ⚠️ Contrat NON NÉGOCIABLE (exigence Marc « aucune donnée changée » sans consentement) : ces specs
 * ne PERSISTENT rien (`toDocument` seulement) — l'écriture réelle passe par
 * `services/aiTools/writeExecutor.ts` : diff pur → CONFIRMATION visuelle (modal) → clic Appliquer.
 * La boucle agentique ne les déclare à l'API QUE si un exécuteur de confirmation est branché.
 */
export const WRITE_SPECS: AnyWriteToolSpec[] = [
    applyDebtSpec,
    applyPayslipSpec,
    applyBankStatementSpec,
    applyBrokerStatementSpec,
    applyTaxSlipSpec,
    setCashSpec,
    setBudgetItemSpec,
    deleteItemSpec,
];
