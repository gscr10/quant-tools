import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBacktestPerformanceValue } from '../src/features/backtesting/backtest-format.ts';

test('Performance values preserve reference precision across display thresholds', () => {
  const cases = [
    [0, '0.00'], [-0, '0.00'], [0.1, '0.1'], [-0.1, '-0.1'],
    [0.000123456789, '0.0001235'], [-0.000123456789, '-0.0001235'],
    [1e-7, '0.0000001'], [1e-8, '1.00e-8'], [-1e-8, '-1.00e-8'],
    [1, '1.00'], [-1, '-1.00'], [1234.56789, '1,234.57'],
    [999999.99, '999,999.99'], [1000000, '1.0M'], [-1234567.89, '-1.2M'],
  ];
  for (const [input, expected] of cases) assert.equal(formatBacktestPerformanceValue(input), expected, String(input));
  for (const input of [null, undefined, NaN, Infinity, -Infinity]) assert.equal(formatBacktestPerformanceValue(input), '—');
});

test('Performance ratios and drawdown percentages keep their distinct reference formats', () => {
  assert.equal(formatBacktestPerformanceValue(1234.56789, 'ratio'), '1234.568');
  assert.equal(formatBacktestPerformanceValue(1e-8, 'ratio'), '0.000');
  assert.equal(formatBacktestPerformanceValue(1000000, 'ratio'), '1000000.000');
  assert.equal(formatBacktestPerformanceValue(0, 'drawdown-percent'), '0');
  assert.equal(formatBacktestPerformanceValue(1.2, 'drawdown-percent'), '1.2');
  assert.equal(formatBacktestPerformanceValue(1.234567, 'drawdown-percent'), '1.23');
  assert.equal(formatBacktestPerformanceValue(1e-8, 'drawdown-percent'), '1.00e-8');
  assert.equal(formatBacktestPerformanceValue(1000000, 'drawdown-percent'), '1.0M');
});
