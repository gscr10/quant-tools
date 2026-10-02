import assert from 'node:assert/strict';
import test from 'node:test';
import { BacktestController } from '../src/app/backtest-controller.ts';

test('failed Settings remain invalid across ticks, errors and unrelated runs until a matching new inputs run settles', async () => {
  const key = { cellId: 'independent-settings-cell', indicatorId: 'quantity' };
  let listener;
  const controller = new BacktestController({
    subscribe(fn) { listener = fn; return () => {}; },
    listSnapshots() { return []; },
  });
  await controller.start();
  const make = (revision, runId, cause = 'inputs', qty = 19, override = {}) => ({
    key, epoch: 1, revision, runToken: `event-${revision}`, status: 'no-trades',
    finality: 'historical-final', ledgerState: 'ready', ledgerRevision: revision,
    seriesState: 'ready', reportSeries: { schemaVersion: 1, runId, snapshotRevision: revision, barIndex: 8, points: [] },
    capabilities: { tradeLedger: true }, visible: true,
    handle: { id: key.indicatorId, title: 'Quantity' },
    run: { title: 'Quantity', kind: 'strategy', cause, forming: false },
    context: null, trades: [], error: null,
    inputs: { schema: [], values: { qty } }, props: { schema: [], values: { initial_capital: 20000 } },
    ...override,
  });
  const emit = snapshot => listener({ type: 'snapshot', snapshot });
  const invalid = () => {
    assert.equal(controller.settingsNeedRecovery(key), true);
    assert.equal(controller.getReport(key).status, 'error');
    assert.equal(controller.reportStore.get(key).domain.status, 'error');
    assert.equal(controller.getReport(key).trades, undefined);
    assert.equal(controller.getReport(key).capabilities.canSimulate, false);
  };
  emit(make(1, 'old', 'history', 10));
  emit(make(2, 'old', 'inputs', 19, { status: 'computing', seriesState: 'unavailable', reportSeries: undefined }));
  controller.invalidateSettings(key);
  invalid();
  emit(make(3, 'old', 'tick')); invalid();
  emit(make(4, 'unrelated-history', 'history')); invalid();
  controller.beginSettingsRecovery(key, { qty: 19 }, { initial_capital: 20000 });
  emit(make(5, 'unrelated-history')); invalid();
  emit(make(6, 'new-but-wrong-settings', 'inputs', 10)); invalid();
  emit(make(7, 'tick-with-new-identity', 'tick')); invalid();
  emit(make(8, 'recovery', 'inputs', 19, { status: 'computing' })); invalid();
  emit(make(9, 'recovery', 'history', 19));
  assert.equal(controller.settingsNeedRecovery(key), false);
  assert.equal(controller.getReport(key).status, 'no-trades');
  controller.invalidateSettings(key);
  listener({ type: 'error', key, epoch: 1, revision: 10, error: new Error('context failed') });
  invalid();
  emit(make(11, 'recovery', 'tick')); invalid();
  controller.destroy();
});
