import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartScale, dailyTotals, reportDate, reportPeriod } from '../src/renderer/report-chart-data.ts';

test('chart ranges follow aggregated daily totals and shrink with filtered data', () => {
  const totals = dailyTotals([{date:'2026-11-02',amountMinor:45000},{date:'2026-11-01',amountMinor:20000},{date:'2026-11-02',amountMinor:55000}]);
  assert.deepEqual(totals,[{date:'2026-11-01',amountMinor:20000},{date:'2026-11-02',amountMinor:100000}]);
  assert.deepEqual(chartScale(totals),{maximum:120000,ticks:[0,30000,60000,90000,120000]});
  assert.equal(chartScale(totals.slice(0,1)).maximum,20000);
  for(const value of [1,25,99,101,999999999]) {
    const scale=chartScale([{amountMinor:value}]);
    assert.ok(scale.maximum>=value);
    assert.equal(scale.ticks[0],0);
    assert.equal(scale.ticks.at(-1),scale.maximum);
    assert.ok(scale.ticks.every(Number.isInteger));
  }
  assert.equal(chartScale([]).maximum,100);
  assert.equal(chartScale([{amountMinor:0}]).maximum,100);
});

test('report dates use day-month-year and single-day periods do not repeat dates', () => {
  assert.equal(reportDate('2026-11-08'), '08-11-2026');
  assert.equal(reportPeriod('2026-11-08', '2026-11-08'), '08-11-2026');
  assert.equal(reportPeriod('2026-11-01', '2026-11-08'), '01-11-2026 to 08-11-2026');
  assert.equal(reportPeriod('2026-12-31', '2027-01-01'), '31-12-2026 to 01-01-2027');
});
