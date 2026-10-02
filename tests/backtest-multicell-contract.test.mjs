import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Backtest feature re-selects the authoritative active cell after layout changes', async () => {
  const source = await readFile(
    new URL('../src/app/backtest-feature.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /workspace\.on\('layout:changed'/);
  assert.match(source, /layoutUnsubscribe/);
  assert.match(source, /layout subscription/);
  assert.match(source, /layoutUnsubscribe = workspace\.on\('layout:changed', \(\) => \{\s*selectLiveCell\(\);/);
});
