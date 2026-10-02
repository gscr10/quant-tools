import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  diffBacktestSettingValues,
  resolveBacktestSettingValues,
  validateBacktestSettingsDraft,
} from '../src/domain/backtest-settings.ts';
import { VelaBacktestControlAdapter } from '../src/integrations/vela/backtest-control-adapter.ts';

const key = { cellId: 'cell-1', indicatorId: 'strategy-1' };

test('settings keep Inputs and Properties namespaces independent', () => {
  const snapshot = {
    inputs: [{ key: 'initial_capital', title: 'Signal length', type: 'int', defval: 3, max: 10 }],
    props: [{ key: 'initial_capital', title: 'Capital', type: 'float', defval: 10000, min: 100 }],
  };
  assert.equal(validateBacktestSettingsDraft(snapshot, { initial_capital: 4 }, { initial_capital: 2000 }), null);
  assert.match(validateBacktestSettingsDraft(snapshot, { initial_capital: 1.5 }, { initial_capital: 2000 }), /whole number/);
  assert.deepEqual(resolveBacktestSettingValues(snapshot.inputs, {}), { initial_capital: 3 });
  assert.deepEqual(resolveBacktestSettingValues(snapshot.props, {}), { initial_capital: 10000 });
});

test('visibility validation resolves omitted section values to schema defaults', () => {
  const snapshot = {
    inputs: [
      { key: 'enabled', title: 'Enabled', type: 'bool', defval: true },
      { key: 'count', title: 'Count', type: 'int', defval: 2, when: { key: 'enabled', equals: true } },
    ],
    props: [{ key: 'enabled', title: 'Unrelated property', type: 'bool', defval: false }],
  };
  assert.match(validateBacktestSettingsDraft(snapshot, { count: 1.5 }, { enabled: false }), /whole number/);
  assert.equal(validateBacktestSettingsDraft(snapshot, { enabled: false, count: 1.5 }, {}), null);
});

class SettingsHandle {
  id = 'strategy-1';
  title = 'Settings strategy';
  source = 'strategy("Settings strategy")';
  nativeType = undefined;
  visible = true;
  inputs = [{
    key: 'length',
    title: 'Length',
    type: 'int',
    defval: 20,
    min: 1,
    max: 200,
    step: 1,
    group: 'Inputs',
  }];
  props = [{
    key: 'initial_capital',
    title: 'Initial capital',
    type: 'float',
    defval: 10_000,
    min: 0,
  }, {
    key: 'use_bar_magnifier',
    title: 'Use bar magnifier',
    type: 'bool',
    defval: false,
  }];
  inputValues() {
    return { length: 34 };
  }
  propValues() {
    return { initial_capital: 25_000 };
  }
}

test('control adapter exposes a copied Inputs/Properties snapshot', () => {
  const handle = new SettingsHandle();
  const adapter = new VelaBacktestControlAdapter({
    cell() {
      return { chart: { indicators: () => [handle] } };
    },
  });
  const snapshot = adapter.readSettings(key);
  assert.ok(snapshot);
  assert.equal(snapshot.title, 'Settings strategy');
  assert.equal(snapshot.inputs[0].key, 'length');
  assert.equal(snapshot.props[0].key, 'initial_capital');
  assert.equal(snapshot.props[1].key, 'use_bar_magnifier');
  assert.equal(snapshot.props[1].defval, false);
  assert.equal(snapshot.inputValues.length, 34);
  assert.equal(snapshot.propValues.initial_capital, 25_000);
  assert.notEqual(snapshot.inputValues, handle.inputValues());
});

test('settings diff keeps precision on the real Properties batch and skips unchanged tabs', () => {
  const inputSchema = [{ key: 'length', title: 'Length', type: 'int', defval: 20 }];
  const propSchema = [{
    key: 'use_bar_magnifier',
    title: 'Use bar magnifier',
    type: 'bool',
    defval: false,
  }];

  assert.deepEqual(diffBacktestSettingValues(inputSchema, { length: 34 }, { length: 34 }), {});
  assert.deepEqual(
    diffBacktestSettingValues(propSchema, {}, { use_bar_magnifier: true }),
    { use_bar_magnifier: true },
  );
  assert.deepEqual(
    diffBacktestSettingValues(propSchema, { use_bar_magnifier: true }, {}),
    { use_bar_magnifier: false },
    'an absent draft resolves to the real schema default',
  );
});

test('settings validation follows visibility and enforces numeric step/min/max rules', () => {
  const snapshot = {
    key,
    title: 'Conditional settings',
    visible: true,
    inputs: [
      {
        key: 'mode',
        title: 'Mode',
        type: 'string',
        defval: 'off',
        options: ['off', 'on'],
      },
      {
        key: 'amount',
        title: 'Amount',
        type: 'float',
        defval: 1,
        min: 0,
        max: 10,
        step: 0.1,
      },
      {
        key: 'onlyWhenOn',
        title: 'Only when on',
        type: 'float',
        defval: 1,
        min: 0,
        max: 10,
        step: 1,
        when: { key: 'mode', equals: 'on' },
      },
    ],
    props: [],
    inputValues: {},
    propValues: {},
  };

  // Hidden NaN drafts are retained but cannot block an Apply while their
  // visibility condition is false.
  assert.equal(
    validateBacktestSettingsDraft(snapshot, {
      mode: 'off',
      amount: 0.3,
      onlyWhenOn: Number.NaN,
    }, {}),
    null,
  );
  assert.match(
    validateBacktestSettingsDraft(snapshot, { mode: 'off', amount: 0.35 }, {}) ?? '',
    /Amount must use increments of 0\.1/,
  );
  assert.match(
    validateBacktestSettingsDraft(snapshot, { mode: 'off', amount: 11 }, {}) ?? '',
    /Amount must be at most 10/,
  );
  assert.match(
    validateBacktestSettingsDraft({
      ...snapshot,
      inputs: [{ key: 'count', title: 'Count', type: 'int', defval: 1 }],
    }, { count: 1.5 }, {}) ?? '',
    /Count must be a whole number/,
  );
  assert.match(
    validateBacktestSettingsDraft(snapshot, { mode: 'on', amount: 1, onlyWhenOn: 0.5 }, {}) ?? '',
    /Only when on must use increments of 1/,
  );
  assert.match(
    validateBacktestSettingsDraft(snapshot, { mode: 'invalid', amount: 1 }, {}) ?? '',
    /Mode has an invalid option/,
  );
});

test('control adapter does not project native indicators into strategy settings', () => {
  const adapter = new VelaBacktestControlAdapter({
    cell() {
      return { chart: { indicators: () => [{ id: key.indicatorId, nativeType: 'sma' }] } };
    },
  });
  assert.equal(adapter.readSettings(key), null);
});

test('settings UI keeps the reference Ok/reset-defaults/cancel contract and both tabs', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/strategy-settings.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /dataset\.settingsTab/);
  assert.match(source, /Inputs/);
  assert.match(source, /Properties/);
  assert.match(source, /Reset defaults/);
  assert.match(source, /Cancel/);
  assert.match(source, /Ok/);
  assert.match(source, /aria-modal', 'true'/);
  assert.match(source, /Reset defaults is draft-only/);
  assert.match(source, /setError\('Unable to apply settings/);
  assert.match(source, /this\.options\.onApply\(this\.snapshot/);
  assert.match(source, /BAR_MAGNIFIER_PROP = 'use_bar_magnifier'/);
  assert.match(source, /Backtest precision/);
  assert.match(source, /Default precision/);
  assert.match(source, /High precision/);
  assert.match(source, /provider fallback/);
});

test('backtest workbench exposes settings from the Dock while Viewer stays reference-shaped', async () => {
  const [workbench, viewer, feature] = await Promise.all([
    readFile(new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/backtest-feature.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(workbench, /Open strategy settings/);
  assert.match(workbench, /new StrategySettingsPanel/);
  assert.doesNotMatch(viewer, /onOpenSettings/);
  assert.doesNotMatch(viewer, /aria-label', 'Open strategy settings'/);
  assert.match(feature, /control\.readSettings\(report\.key\)/);
  assert.match(feature, /diffBacktestSettingValues/);
  assert.match(feature, /control\.applySettings\(key, inputPatch, propPatch\)/);
});

test('backtest shell closes through one focus lifecycle and exposes truthful Dock ARIA', async () => {
  const [workbench, feature] = await Promise.all([
    readFile(new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/app/backtest-feature.ts', import.meta.url), 'utf8'),
  ]);

  const emptyReportBranch = workbench.match(
    /private render\(\): void \{\s*if \(!this\.report\) \{([\s\S]*?)\n\s*\}\n\s*this\.element\.dataset\.state/,
  );
  assert.ok(emptyReportBranch, 'expected the no-report render branch');
  assert.match(emptyReportBranch[1], /this\.closeViewer\(\)/);
  assert.doesNotMatch(emptyReportBranch[1], /this\.viewer\.close\(\)/);
  assert.match(workbench, /onClose: \(\) => this\.restoreSettingsFocus\(\)/);
  assert.match(workbench, /private settingsReturnFocus: HTMLElement \| null = null/);
  assert.match(workbench, /current\.hidden \|\| current\.inert/);
  assert.match(workbench, /this\.port\.onFocusFallback\?\.\(\)/);
  assert.match(feature, /onFocusFallback: \(\) => workspace\.cell\(workspace\.active\.id\)\?\.focus\(\)/);

  assert.match(workbench, /this\.separator\.setAttribute\('aria-controls', this\.dock\.id\)/);
  assert.match(workbench, /this\.collapseButton\.setAttribute\('aria-controls', this\.dockBody\.id\)/);
  assert.match(workbench, /const effectiveMax = this\.effectiveMaxDockHeight\(\)/);
  assert.match(workbench, /setAttribute\('aria-valuemax', String\(effectiveMax\)\)/);
});

test('fire-and-forget Workbench host notifications absorb async rejection', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  const notifyBody = source.match(
    /private notifyPort\(callback: \(\) => unknown\): void \{([\s\S]*?)\n\s*\}\n\}/,
  )?.[1];
  assert.ok(notifyBody, 'expected the Workbench host-notification boundary');
  assert.match(notifyBody, /const result = callback\(\)/);
  assert.match(notifyBody, /typeof \(result as PromiseLike<unknown>\)\.then === 'function'/);
  assert.match(notifyBody, /void Promise\.resolve\(result\)\.catch\(\(\) => undefined\)/);
  assert.match(notifyBody, /Keep the host callback synchronous/);
});
