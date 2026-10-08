import test from 'node:test';
import assert from 'node:assert/strict';
import { backtestWindowLabel, resolveBacktestWindow } from '../src/domain/backtest-window.ts';

test('default keeps the provider-backed 2,000 bar contract', () => {
  assert.equal(resolveBacktestWindow({ preset: 'default' }), undefined);
  assert.equal(backtestWindowLabel({ preset: 'default' }), 'Default · 2,000 bars');
});

test('named windows freeze UTC calendar dates at click time', () => {
  const now = Date.UTC(2026, 9, 8, 12, 30);
  for (const [preset, month, year] of [['1M', 8, 2026], ['3M', 6, 2026], ['6M', 3, 2026], ['1Y', 9, 2025]]) {
    const resolved = resolveBacktestWindow({ preset }, now);
    assert.equal(resolved.from, Date.UTC(year, month, 8, 12, 30));
    assert.equal(resolved.to, now);
    assert.ok(Object.isFrozen(resolved));
  }
});

test('calendar month subtraction clamps month ends and leap years', () => {
  assert.equal(resolveBacktestWindow({ preset: '1M' }, Date.UTC(2026, 2, 31)).from, Date.UTC(2026, 1, 28));
  assert.equal(resolveBacktestWindow({ preset: '1M' }, Date.UTC(2024, 2, 31)).from, Date.UTC(2024, 1, 29));
  assert.equal(resolveBacktestWindow({ preset: '1Y' }, Date.UTC(2024, 1, 29)).from, Date.UTC(2023, 1, 28));
});

test('custom dates preserve an earlier end and clamp a future end to now', () => {
  const now = Date.UTC(2026, 9, 8);
  const from = Date.UTC(2026, 0, 1);
  assert.equal(resolveBacktestWindow({ preset: 'custom', from, to: Date.UTC(2026, 1, 1) }, now).to, Date.UTC(2026, 1, 1));
  assert.equal(resolveBacktestWindow({ preset: 'custom', from, to: Date.UTC(2027, 0, 1) }, now).to, now);
});

test('invalid custom date windows are rejected before starting a provider request', () => {
  for (const selection of [
    { preset: 'custom', from: 20, to: 10 },
    { preset: 'custom', from: 10, to: 10 },
    { preset: 'custom', from: Number.NaN, to: 20 },
    { preset: 'custom', from: 10, to: Infinity },
    { preset: 'custom', from: -1, to: 20 },
    { preset: 'custom', from: 100, to: 200 },
    { preset: 'custom' },
  ]) assert.throws(() => resolveBacktestWindow(selection, 100), /valid start and end date/);
});
