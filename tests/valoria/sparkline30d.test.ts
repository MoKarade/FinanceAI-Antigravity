import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildAsset30DaySparklineSeries } from '../../services/valoria/sparkline30d';

test('buildAsset30DaySparklineSeries extracts a 30-calendar-day trajectory pinned to live $ CAD spot', () => {
  const adp = buildAsset30DaySparklineSeries('ADP', 202.5);
  assert.equal(adp.assetId, 'ADP');
  assert.equal(adp.ticker, 'ADP');
  assert.ok(adp.points.length >= 18 && adp.points.length <= 31);
  assert.equal(adp.endPriceCad, 202.5);
  assert.ok(Number.isFinite(adp.change30dPct));
  assert.ok(adp.minPriceCad <= adp.endPriceCad);
  assert.ok(adp.maxPriceCad >= adp.endPriceCad);

  const startMs = Date.parse(`${adp.points[0].dateISO}T00:00:00Z`);
  const endMs = Date.parse(`${adp.points[adp.points.length - 1].dateISO}T00:00:00Z`);
  const spanDays = (endMs - startMs) / (24 * 3600 * 1000);
  assert.ok(spanDays >= 25 && spanDays <= 31, `Expected ~30d span, got ${spanDays}`);
});

test('buildAsset30DaySparklineSeries handles low-volatility CASH and custom daily histories without NaN', () => {
  const cash = buildAsset30DaySparklineSeries('CASH', 50);
  assert.ok(cash.points.length >= 18);
  assert.equal(cash.endPriceCad, 50);
  assert.ok(Number.isFinite(cash.change30dPct));

  const custom = buildAsset30DaySparklineSeries('RY', undefined, [
    { date: '2026-09-15', valueCad: 158 },
    { date: '2026-10-10', valueCad: 162 },
    { date: '2026-10-24', valueCad: 166.5 },
    { date: '2026-11-06', valueCad: 171.2 },
  ]);
  // 2026-09-15 is >30d before 2026-11-06, so only the 3 points inside the 30d window remain
  assert.equal(custom.points.length, 3);
  assert.equal(custom.startPriceCad, 162);
  assert.equal(custom.endPriceCad, 171.2);
  assert.equal(custom.isPositive30d, true);
  assert.ok(custom.change30dPct > 5);
});
