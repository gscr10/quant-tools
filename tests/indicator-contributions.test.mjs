import test from 'node:test';
import assert from 'node:assert/strict';
import { legendActions } from '@luxalgo/vela/plugin';
import { registerIndicatorContributions } from '../src/features/indicators/indicator-contributions.vela.ts';
import { resolveScriptIndicatorName } from '../src/integrations/vela/indicator-display-name.ts';
import { indicatorSourceKey } from '../src/domain/indicators.ts';

const source = '//@version=6\nstrategy("Declared strategy", overlay=true)\nplot(close)';
const instance = (id, name, script = source) => ({ handle: { id }, entry: { name, script } });

test('script display name follows the exact Workspace instance across cells and duplicate sources', () => {
  const workspace = { cells: () => [
    { instances: [instance('first', 'Personal alias')] },
    { instances: [instance('second', 'Other cell alias'), instance('third', 'EMA', 'indicator("EMA")')] },
  ] };
  assert.equal(resolveScriptIndicatorName(workspace, 'first', 'Indicator', source), 'Personal alias');
  assert.equal(resolveScriptIndicatorName(workspace, 'second', 'Indicator', source), 'Other cell alias');
  assert.equal(resolveScriptIndicatorName(workspace, 'third', 'Indicator', 'indicator("EMA")'), 'EMA');
  assert.equal(resolveScriptIndicatorName(workspace, 'first', 'Indicator', 'strategy("Other source")'), 'Other source');
});

test('raw or removed handles retain explicit titles and use the existing Pine fallback for placeholders', () => {
  const workspace = { cells: () => [] };
  assert.equal(resolveScriptIndicatorName(workspace, 'raw', 'Engine title', source), 'Engine title');
  assert.equal(resolveScriptIndicatorName(workspace, 'raw', 'Indicator', source), 'Declared strategy');
  assert.equal(resolveScriptIndicatorName(workspace, 'raw', '', "indicator(title='Named indicator')"), 'Named indicator');
  assert.equal(resolveScriptIndicatorName(workspace, 'raw', 'Indicator', 'plot(close)'), 'Untitled indicator');
});

test('registered legend favorite and code actions share display names without changing source identity or saved names', () => {
  const calls = [], favorites = [];
  const workspace = { cells: () => [{ instances: [instance('personal', 'Personal alias')] }] };
  const actions = {
    openManager() {}, toggleFavorites() {}, openNativeInfo() {},
    resolveNativeIndicator: () => undefined,
    resolveScriptIndicatorName: (...args) => resolveScriptIndicatorName(workspace, ...args),
    openScript: (...args) => calls.push(args), syncManager() {},
  };
  const dispose = registerIndicatorContributions(
    { toggle: favorite => { favorites.push(favorite); return true; } },
    { list: () => [{ name: 'Saved file name', script: source }] }, actions,
  );
  try {
    const favorite = legendActions().find(action => action.id === 'quant-favorite-indicator');
    const code = legendActions().find(action => action.id === 'quant-open-indicator-code');
    for (const item of [
      { id: 'personal', title: 'Indicator', source, expected: 'Personal alias', saved: 'Saved file name' },
      { id: 'raw', title: 'Indicator', source: 'indicator("Volume study")\nplot(volume)', expected: 'Volume study' },
      { id: 'raw2', title: 'Indicator', source: 'strategy("Reversal audit")\nplot(open)', expected: 'Reversal audit' },
      { id: 'fallback', title: 'Indicator', source: 'plot(close)', expected: 'Untitled indicator' },
    ]) {
      favorite.run({ toast() {} }, item);
      code.run({}, item);
      assert.equal(favorites.at(-1).name, item.expected);
      assert.equal(favorites.at(-1).key, `script:${indicatorSourceKey(item.source)}`);
      assert.equal(favorites.at(-1).script, item.source);
      assert.deepEqual(calls.at(-1), [item.expected, item.source, item.saved]);
    }
  } finally { dispose(); }
});
