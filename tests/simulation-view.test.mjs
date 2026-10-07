import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  cumulativeSimulationBins,
  simulationShowsOutcome,
} from '../src/features/backtesting/simulation-view.ts';

test('Shuffle without variation hides variable-outcome UI only', () => {
  assert.equal(simulationShowsOutcome({ method: 'shuffle', variationPercent: 0 }), false);
  assert.equal(simulationShowsOutcome({ method: 'shuffle', variationPercent: 0.01 }), true);
  assert.equal(simulationShowsOutcome({ method: 'resample', variationPercent: 0 }), true);
});

test('cumulative distributions start at zero and finish at one', () => {
  const points = cumulativeSimulationBins([
    { from: -2, to: 0, count: 2 },
    { from: 0, to: 3, count: 1 },
  ]);
  assert.deepEqual(points, [
    { x: -2, y: 0 },
    { x: 0, y: 2 / 3 },
    { x: 3, y: 1 },
  ]);
  assert.ok(Object.isFrozen(points));
  points.forEach((point) => assert.ok(Object.isFrozen(point)));
  assert.deepEqual(cumulativeSimulationBins([]), []);
});

test('Simulation view freezes the captured reference surface without a duplicate page title', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/features/backtesting/backtest.css', import.meta.url),
    'utf8',
  );
  for (const label of [
    'Resample',
    'Shuffle',
    'Drawdown ≥',
    'Simulation settings',
    'Random P&L',
    'Preserve win/loss',
    'Probability of profit',
    'Median outcome',
    'P95–P99 drawdown',
    'Risk of ruin',
    'P95 max losing streak',
    'Simulated Net Profit Paths',
    'Outcome Distribution',
    'Open Max Drawdown Distribution',
    'Streaks & Recovery',
  ]) assert.ok(source.includes(label), label);
  assert.match(source, /const RUN_OPTIONS = \[250, 1_000, 2_500\]/);
  assert.match(source, /const DRAWDOWN_PRESETS = \[1\.5, 2, 3\]/);
  assert.match(source, /`\$\{multiple\}× DD`/);
  assert.match(source, /Final net profit \(every run\)/);
  assert.match(source, /simulation\.method === 'shuffle' && simulation\.variationPercent === 0/);
  assert.match(source, /settingsOpen:[\s\S]*onSettingsOpenChange/);
  assert.match(source, /aria-modal/);
  assert.match(source, /element\(doc, 'div', 'quant-backtest-simulation-settings-backdrop'\)/);
  assert.match(source, /backdrop\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(source, /mouseenter/);
  assert.match(source, /trigger\.addEventListener\('focus'/);
  assert.match(source, /simulationRunStatus/);
  assert.match(source, /Running \$\{run\.totalRuns\.toLocaleString/);
  assert.match(source, /progress\.setAttribute\('aria-label', 'Simulation progress'\)/);
  assert.match(source, /status\.setAttribute\('role', 'alert'\)/);
  assert.match(source, /onChange\(\{ \.\.\.run\.settings \}\)/);
  assert.match(source, /child\.inert = true/);
  assert.match(source, /child\.setAttribute\('aria-hidden', 'true'\)/);
  assert.doesNotMatch(source, /renderSectionHeading\([^\n]*'Simulation'/);
  assert.match(styles, /quant-backtest-simulation-toolbar[\s\S]*position: sticky/);
  assert.match(styles, /quant-backtest-simulation-settings-dialog/);
  assert.match(styles, /quant-backtest-simulation-run-status/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
});

test('Simulation charts carry reference bands, actual lines, annotations, and independent modes', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /name: '5–95% band'[\s\S]*kind: 'arearange'/);
  assert.match(source, /name: '25–75% band'[\s\S]*kind: 'arearange'/);
  assert.match(source, /name: 'Median simulation'[\s\S]*dashStyle: 'Dash'/);
  assert.match(source, /name: 'Actual'/);
  assert.match(source, /\['actual', 'Actual backtest'\]/);
  assert.match(source, /label: 'P5'/);
  assert.match(source, /label: 'P95'/);
  assert.match(source, /label: 'Actual'/);
  assert.match(source, /onChange\(\{ outcomeChartMode \}\)/);
  assert.match(source, /onChange\(\{ drawdownChartMode \}\)/);
  assert.match(source, /yAxisPercent: true/);
  assert.match(source, /zoneAxis: 'x'/);
  assert.match(source, /zones: \[[\s\S]*value: options\.splitAt/);
  assert.match(source, /columnGroupPadding: 0/);
  assert.match(source, /columnPointPadding: 0\.05/);
  assert.match(source, /columnBorderRadius: 0/);
  assert.match(source, /yAxisGridLineWidth: 0/);
  assert.match(source, /showZeroLine: false/);
  assert.match(source, /labelBackgroundColor: 'var\(--quant-backtest-surface\)'/);
});
