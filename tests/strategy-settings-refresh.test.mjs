import assert from 'node:assert/strict';
import test from 'node:test';
import { StrategySettingsPanel } from '../src/features/backtesting/strategy-settings.ts';

const snapshot = () => ({
  key: { cellId: 'cell', indicatorId: 'strategy' }, title: 'Strategy', source: 'strategy("S")', visible: true,
  inputs: [{ key: 'length', title: 'Length', type: 'int', defval: 9, min: 1,
    when: [{ key: 'enabled', anyOf: [true, 'auto'] }] }],
  props: [{ key: 'use_bar_magnifier', title: 'Magnifier', type: 'bool', defval: false }],
  inputValues: { length: 12, enabled: true }, propValues: { use_bar_magnifier: false },
});

// Exercise the public update state transition with a render spy. Browser
// tests separately verify actual Vela popup and focus preservation.
function panelState(initial = snapshot()) {
  const panel = Object.assign(Object.create(StrategySettingsPanel.prototype), {
    snapshot: initial, inputs: { ...initial.inputValues }, props: { ...initial.propValues },
    element: { hidden: false }, dirty: false, renders: 0, closes: 0, opens: [],
    render() { this.renders++; }, close() { this.closes++; }, open(value) { this.opens.push(value); },
  });
  return panel;
}

test('equivalent fresh settings DTO keeps the live form and accepts the newest snapshot', () => {
  const original = snapshot();
  const panel = panelState(original);
  const originalInputs = panel.inputs;
  const originalProps = panel.props;
  const next = structuredClone(original);
  next.inputValues = { enabled: true, length: 12 };
  next.key = { indicatorId: 'strategy', cellId: 'cell' };
  panel.update(next);
  assert.equal(panel.renders, 0, 'report-only revisions must not rebuild or close a popup');
  assert.equal(panel.snapshot, next, 'the latest authoritative snapshot is retained');
  assert.equal(panel.inputs, originalInputs);
  assert.equal(panel.props, originalProps);
});

test('actual settings values and schema/metadata changes still rebuild a pristine form', () => {
  const changes = [
    next => { next.inputValues.length = 21; },
    next => { next.propValues.use_bar_magnifier = true; },
    next => { next.inputs[0].min = 5; },
    next => { next.inputs[0].when[0].anyOf = [false]; },
    next => { next.inputs[0].options = ['9', '21']; },
    next => { next.props[0].defval = true; },
    next => { next.title = 'Renamed'; },
    next => { next.source = 'strategy("New source")'; },
    next => { next.visible = false; },
  ];
  for (const change of changes) {
    const panel = panelState();
    const next = snapshot(); change(next);
    panel.update(next);
    assert.equal(panel.renders, 1);
    assert.deepEqual(panel.inputs, next.inputValues);
    assert.deepEqual(panel.props, next.propValues);
    assert.notEqual(panel.inputs, next.inputValues, 'draft values remain isolated');
    assert.equal(panel.snapshot, next);
  }
});

test('dirty drafts survive value refresh while real schema changes remain visible', () => {
  const panel = panelState();
  panel.dirty = true;
  panel.inputs.length = 18;
  const next = snapshot(); next.inputValues.length = 21;
  panel.update(next);
  assert.equal(panel.renders, 0);
  assert.equal(panel.inputs.length, 18);
  const changedSchema = structuredClone(next);
  changedSchema.inputs[0].max = 20;
  panel.update(changedSchema);
  assert.equal(panel.renders, 1, 'updated validation/schema cannot be hidden by the draft guard');
  assert.equal(panel.inputs.length, 18);
  assert.equal(panel.snapshot, changedSchema);
});

test('refresh identity and disappearance keep their existing session boundaries', () => {
  const panel = panelState();
  const next = snapshot(); next.key.indicatorId = 'other-strategy';
  panel.update(next);
  assert.deepEqual(panel.opens, [next]);
  panel.update(null);
  assert.equal(panel.closes, 1);
});
