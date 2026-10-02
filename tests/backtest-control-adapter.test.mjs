import assert from 'node:assert/strict';
import test from 'node:test';

import { VelaBacktestControlAdapter } from '../src/integrations/vela/backtest-control-adapter.ts';

const key = { cellId: 'cell-1', indicatorId: 'strategy-1' };

class ThrowingHandle {
  id = 'strategy-1';
  title = 'Throwing strategy';
  source = 'strategy("Throwing strategy")';
  nativeType = undefined;

  context() {
    throw new Error('context failed');
  }

  setInputs() {
    throw new Error('inputs failed');
  }

  setProps() {
    throw new Error('props failed');
  }

  updateCode() {
    throw new Error('code failed');
  }

  setVisible() {
    throw new Error('visibility failed');
  }

  remove() {
    throw new Error('remove failed');
  }
}

class ThrowingChart {
  constructor() {
    this.handle = new ThrowingHandle();
  }

  indicators() {
    return [this.handle];
  }

  runScript() {
    throw new Error('run failed');
  }
}

class ThrowingWorkspace {
  constructor() {
    this.chart = new ThrowingChart();
  }

  cell() {
    return { chart: this.chart };
  }
}

test('control adapter contains synchronous Vela failures at the feature boundary', async () => {
  const adapter = new VelaBacktestControlAdapter(new ThrowingWorkspace());

  assert.equal(adapter.getHandle(key)?.id, 'strategy-1');
  assert.equal(adapter.readSettings(key), null);
  assert.equal(await adapter.readContext(key), null);
  assert.deepEqual(await adapter.readTrades(key), []);
  assert.equal(adapter.setInputs(key, { length: 9 }), false);
  assert.equal(adapter.setProps(key, { initial_capital: 1_000 }), false);
  assert.equal(adapter.applySettings(key, { length: 9 }, { initial_capital: 1_000 }), false);
  assert.equal(adapter.updateCode(key, 'strategy("next")'), false);
  assert.equal(adapter.setVisible(key, false), false);
  assert.equal(adapter.remove(key), false);
  assert.equal(await adapter.runScript('cell-1', 'strategy("run")'), null);
});

test('control adapter treats a torn-down workspace as unavailable', async () => {
  const adapter = new VelaBacktestControlAdapter({
    cell() {
      throw new Error('workspace destroyed');
    },
  });

  assert.equal(adapter.getHandle(key), undefined);
  assert.equal(adapter.readSettings(key), null);
  assert.equal(await adapter.readContext(key), null);
  assert.deepEqual(await adapter.readTrades(key), []);
  assert.equal(adapter.setInputs(key, {}), false);
  assert.equal(adapter.setProps(key, {}), false);
  assert.equal(adapter.applySettings(key, {}, {}), false);
  assert.equal(adapter.updateCode(key, 'strategy("next")'), false);
  assert.equal(adapter.setVisible(key, true), false);
  assert.equal(adapter.remove(key), false);
  assert.equal(await adapter.runScript('cell-1', 'strategy("run")'), null);
});

test('combined Settings reports a failed second setter rather than silent partial success', () => {
  const handle = new ThrowingHandle();
  let inputCalled = 0;
  handle.setInputs = () => { inputCalled++; };
  const adapter = new VelaBacktestControlAdapter({ cell: () => ({ chart: { indicators: () => [handle] } }) });
  assert.equal(adapter.applySettings(key, { length: 11 }, { precision: 3 }), false);
  assert.equal(inputCalled, 1);
});
