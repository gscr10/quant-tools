import assert from 'node:assert/strict';
import test from 'node:test';
import { createBacktestReport } from '../src/domain/backtesting.ts';
import { formatReportAxisValue } from '../src/features/backtesting/highcharts-renderer.ts';

test('O03: currency and numeric axis text discard artifacts without modifying source values', () => {
  const value = 2.9999999999999716;
  assert.equal(formatReportAxisValue(value, true), '3');
  assert.equal(formatReportAxisValue(value), '3');
  assert.equal(formatReportAxisValue(-0.000001, true), '-0.000001');
  assert.equal(formatReportAxisValue(1234.567, true), '1,234.567');
  assert.equal(formatReportAxisValue(0.000000123456), '0.000000123456');
  assert.equal(value, 2.9999999999999716);
});

test('O03: small adjacent money ticks, tiny negative values and signed zero stay truthful', () => {
  assert.equal(formatReportAxisValue(0.000001, true, 0.000001), '0.000001');
  assert.equal(formatReportAxisValue(0.000002, true, 0.000001), '0.000002');
  assert.equal(formatReportAxisValue(-0.000000000000001, true), '-0.000000000000001');
  assert.equal(formatReportAxisValue(-0, true), '0');
  assert.equal(formatReportAxisValue(-2.9999999999999716, true), '-3');
  assert.equal(formatReportAxisValue(1.000000000001, true, 1e-12), '1.000000000001');
  assert.equal(formatReportAxisValue(1.000000000002, true, 1e-12), '1.000000000002');
});

const base = () => ({ key: { cellId: 'audit', indicatorId: 'dto' } });
for (const [name, value] of [
  ['Date', new Date(1000)], ['Map', new Map([['venue', 'audit']])],
  ['Set', new Set(['audit'])], ['Uint8Array', new Uint8Array([1, 2])],
  ['function', () => 1], ['class instance', new (class Metadata { value = 1; })()],
]) {
  test(`O01: reports explicitly reject unsupported ${name} rather than corrupting it`, () => {
    assert.throws(() => createBacktestReport({ ...base(), performance: { nested: value } }), /Unsupported report DTO/);
  });
}
test('O01: accessors are rejected without invoking them or silently omitting fields', () => {
  let reads = 0;
  assert.throws(() => createBacktestReport({ ...base(), context: { get symbol() { reads++; return 'BTC'; } } }), /Unsupported report DTO accessor/);
  assert.equal(reads, 0);
});
test('O01: raw trade metadata and canonical getter fields use the same explicit boundary', () => {
  const source = { id: 'raw', entryTime: new Date(1000), exitTime: new Date(2000) };
  assert.throws(() => createBacktestReport({ ...base(), trades: [source] }), /Unsupported report DTO object at \$\.trades\.0\.entryTime/);
  assert.equal(source.exitTime.getTime(), 2000);
  let reads = 0;
  assert.throws(() => createBacktestReport({ ...base(), account: { get initialCapital() { reads++; return 1000; } } }), /Unsupported report DTO accessor/);
  assert.equal(reads, 0);
});
test('O01: plain cycles, arrays and own __proto__ data survive defensively', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true},"data":[1,2]}');
  value.self = value;
  const report = createBacktestReport({ ...base(), performance: value });
  assert.equal(Object.getPrototypeOf(report.performance), Object.prototype);
  assert.equal(Object.hasOwn(report.performance, '__proto__'), true);
  assert.equal(report.performance.__proto__.polluted, true);
  assert.equal(report.performance.self, report.performance);
  assert.ok(Object.isFrozen(report.performance.data));
  assert.equal(Object.isFrozen(value), false);
});
