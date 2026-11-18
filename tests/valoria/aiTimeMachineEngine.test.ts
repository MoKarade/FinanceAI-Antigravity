import { describe, expect, it } from 'vitest';
import {
  buildGlobalAiUsefulnessSummary,
  evaluateSingleEpochAudit,
  TimeMachineEpochId,
} from '../../services/valoria/aiTimeMachineEngine';
import { getLatestPrices } from '../../services/valoria/marketData';

export function runAiTimeMachineSelfCheck(): boolean {
  const livePrices = getLatestPrices();
  const demoLots = [
    { id: 't1', assetId: 'XBB', investedAmount: 10000, purchaseYearMonth: '2025-01' },
    { id: 't2', assetId: 'ADP', investedAmount: 5000, purchaseYearMonth: '2026-08' },
  ];

  const epochs: TimeMachineEpochId[] = ['1m', '1y', '5y', '10y'];
  for (const epochId of epochs) {
    const audit = evaluateSingleEpochAudit({
      epochId,
      initialCapitalCad: 10000,
      lots: demoLots,
      livePrices,
      riskProfile: 'equilibre',
    });

    if (audit.picks.length < 3 || audit.avoids.length < 2) {
      throw new Error(`Invalid picks/avoids count on epoch ${epochId}`);
    }

    const totalWeight = audit.picks.reduce((s, p) => s + p.weightPct, 0);
    if (Math.abs(totalWeight - 100) > 0.6) {
      throw new Error(`Weights do not sum to 100% on ${epochId}: ${totalWeight}`);
    }

    if (audit.series.length < 2) {
      throw new Error(`Insufficient curve points on ${epochId}`);
    }

    if (!Number.isFinite(audit.aiFinalCad) || audit.aiFinalCad <= 0) {
      throw new Error(`Invalid final CAD value on ${epochId}`);
    }
  }

  const global = buildGlobalAiUsefulnessSummary({
    initialCapitalCad: 10000,
    lots: demoLots,
    livePrices,
    riskProfile: 'equilibre',
    blindOverridesByEpoch: {},
  });

  return (
    global.epochs.length === 4 &&
    global.overallUsefulnessScore100 >= 0 &&
    global.overallUsefulnessScore100 <= 100
  );
}

describe('aiTimeMachineEngine — Zero Look-Ahead Bias & 4 époques', () => {
  it('runAiTimeMachineSelfCheck() passe à 100 % sur 1m, 1y, 5y et 10y', () => {
    expect(runAiTimeMachineSelfCheck()).toBe(true);
  });

  it('filtre strictement les courbes et choix à la date T_0 sans biais look-ahead sur livePrices', () => {
    const livePrices = getLatestPrices();
    const mutatedFuturePrices = { ...livePrices };
    for (const k of Object.keys(mutatedFuturePrices)) {
      mutatedFuturePrices[k] = mutatedFuturePrices[k] * 1.37;
    }
    const demoLots = [
      { id: 't1', assetId: 'XBB', investedAmount: 10000, purchaseYearMonth: '2025-01' },
    ];
    const baseSummary = buildGlobalAiUsefulnessSummary({
      initialCapitalCad: 10000,
      lots: demoLots,
      livePrices,
      riskProfile: 'equilibre',
      blindOverridesByEpoch: {},
    });
    const futureMutatedSummary = buildGlobalAiUsefulnessSummary({
      initialCapitalCad: 10000,
      lots: demoLots,
      livePrices: mutatedFuturePrices,
      riskProfile: 'equilibre',
      blindOverridesByEpoch: {},
    });

    expect(baseSummary.epochs).toHaveLength(4);
    for (let i = 0; i < baseSummary.epochs.length; i++) {
      const epoch = baseSummary.epochs[i];
      const mutatedEpoch = futureMutatedSummary.epochs[i];
      expect(epoch.series[0]?.yearMonth.startsWith(epoch.startYearMonth)).toBe(true);
      expect(epoch.picks.map((p) => p.assetId)).toEqual(mutatedEpoch.picks.map((p) => p.assetId));
      expect(epoch.avoids.map((a) => a.assetId)).toEqual(mutatedEpoch.avoids.map((a) => a.assetId));
      expect(epoch.anonymizedServerRequest.dossiers.every((d) => /^ACTIF_\d{2}$/.test(d.blindCode))).toBe(true);
      expect(Number.isFinite(epoch.aiTotalReturnPct)).toBe(true);
    }
  });
});

