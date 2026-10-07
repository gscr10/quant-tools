import assert from 'node:assert/strict';
import test from 'node:test';
import { createBacktestReport } from '../src/domain/backtesting.ts';
import { formatPerformanceAxisValue, formatReportAxisValue } from '../src/features/backtesting/highcharts-renderer.ts';

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

test('D10: equity/Dock axis notation matches the reference positive, negative and zero thresholds', () => {
  // The original getChartOptions axis uses String(value), independently
  // executed from the reference module. These are axis labels, not table
  // amounts, whose scientific threshold and fractional padding differ.
  for (const [value, expected] of [
    [0, '0'], [-0, '0'], [2e-8, '2e-8'], [-2e-8, '-2e-8'],
    [1e-7, '1e-7'], [-1e-7, '-1e-7'],
    [9.99999999999e-7, '9.99999999999e-7'], [-9.99999999999e-7, '-9.99999999999e-7'],
    [1e-6, '0.000001'], [-1e-6, '-0.000001'],
    [1.00000000001e-6, '0.00000100000000001'], [-1.00000000001e-6, '-0.00000100000000001'],
    [1.23456e-7, '1.23456e-7'], [-1.23456e-7, '-1.23456e-7'],
    [-1e-15, '-1e-15'], [Number.MIN_VALUE, '5e-324'], [-Number.MIN_VALUE, '-5e-324'],
    [1234.567, '1234.567'], [1e20, '100000000000000000000'], [1e21, '1e+21'],
  ]) {
    assert.equal(formatPerformanceAxisValue(value, false), expected, String(value));
  }
});

test('D10: shortest notation preserves local rounding, narrow tick precision and nonfinite protection', () => {
  assert.equal(formatPerformanceAxisValue(2.9999999999999716, false), '3');
  assert.equal(formatPerformanceAxisValue(-2.9999999999999716, false), '-3');
  assert.equal(formatPerformanceAxisValue(9.999999999999997e-7, false), '0.000001');
  assert.equal(formatPerformanceAxisValue(1.000000000001, false, 1e-12), '1.000000000001');
  assert.equal(formatPerformanceAxisValue(1.000000000002, false, 1e-12), '1.000000000002');
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(formatPerformanceAxisValue(value, false), '—');
  }
});

test('D10: compact Analysis/Simulation axes keep decimal and suffix formatting', () => {
  for (const [value, expected] of [
    [0, '0'], [-0, '0'], [2e-8, '0.00000002'], [-2e-8, '-0.00000002'],
    [999, '999'], [1000, '1k'], [-1500, '-1.5k'],
    [1e6, '1M'], [2.5e9, '2.5G'], [-1.25e12, '-1.25T'],
  ]) assert.equal(formatPerformanceAxisValue(value, true), expected, String(value));
  assert.equal(formatPerformanceAxisValue(1000.000000001, true, 1e-9), '1.000000000001k');
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
