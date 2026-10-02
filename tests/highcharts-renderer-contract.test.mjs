import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const rendererUrl = new URL(
  '../src/features/backtesting/highcharts-renderer.ts',
  import.meta.url,
);

test('Simulation chart adapter exposes local confidence-band and annotation contracts', async () => {
  const source = await readFile(rendererUrl, 'utf8');

  assert.match(source, /'area' \| 'arearange'/);
  assert.match(source, /interface ReportChartRangePoint[\s\S]*readonly low: number;[\s\S]*readonly high: number;/);
  assert.match(source, /readonly fillColor\?: string;/);
  assert.match(source, /readonly fillOpacity\?: number;/);
  assert.match(source, /readonly lineWidth\?: number;/);
  assert.match(source, /readonly zIndex\?: number;/);
  assert.match(source, /readonly zoneAxis\?: 'x' \| 'y';/);
  assert.match(source, /readonly zones\?: readonly ReportChartZone\[\];/);
  assert.match(source, /readonly label\?: string;/);
  assert.match(source, /readonly labelAlign\?: 'left' \| 'center' \| 'right';/);
  assert.match(source, /\{ \.\.\.common, low: rangePoint\.low, high: rangePoint\.high \}/);

  assert.match(source, /import\('highcharts\/esm\/highcharts\.js'\)/);
  assert.match(source, /import\('highcharts\/esm\/highcharts-more\.js'\)/);
  assert.match(source, /needsRangeSeries \? loadHighchartsMore\(\) : loadHighcharts\(\)/);
  assert.match(source, /records\.get\(host\)\?\.chart !== chart/);
  assert.match(source, /export function suspendReportChartReflow\(\): void/);
  assert.match(source, /export function resumeReportChartReflow\(\): void/);
  assert.match(source, /reportChartReflowSuspendDepth/);
  assert.match(source, /pendingReportChartReflows/);
  assert.match(source, /reportChartHosts\.delete\(host\);\n\s*pendingReportChartReflows\.delete\(host\)/);
  assert.match(source, /minorTicks: false/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test('Dock resize suspends chart reflow and settles it once after pointerup', async () => {
  const workbench = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  const renderer = await readFile(rendererUrl, 'utf8');
  assert.match(workbench, /suspendReportChartReflow\(\)/);
  assert.match(workbench, /resumeReportChartReflow\(\)/);
  assert.match(workbench, /let reflowSuspended = true/);
  assert.match(workbench, /if \(!reflowSuspended\) return/);
  assert.match(renderer, /if \(reportChartReflowSuspendDepth > 0\)/);
  assert.match(renderer, /hosts\.forEach\(\(host\) => reflowReportChart\(host\)\)/);
  assert.match(renderer, /reflow: false/);
  assert.doesNotMatch(renderer, /reflow: true/);
});

test('Dock chart flex sizing cannot depend on Highcharts intrinsic SVG width', async () => {
  const css = await readFile(new URL('../src/features/backtesting/backtest.css', import.meta.url), 'utf8');
  assert.match(css, /\.quant-backtest-dock-sparkline > \.quant-backtest-chart-host\s*\{[^}]*flex: 1 1 0;[^}]*width: 100%;[^}]*height: 164px;[^}]*min-height: 164px;/);
});

test('Simulation chart adapter formats percent axes and mode-specific tooltips', async () => {
  const source = await readFile(rendererUrl, 'utf8');

  assert.match(source, /readonly yAxisPercent\?: boolean;/);
  assert.match(source, /options\.yAxisPercent[\s\S]*formatPercentRatio\(Number\(this\.value\), 0\)/);
  assert.match(source, /options\.tooltipMode === 'simulation-distribution'[\s\S]*options\.valueUnit === 'percent'/);
  assert.match(source, /'simulation-paths'/);
  assert.match(source, /'simulation-distribution'/);
  assert.match(source, /Trade #\{point\.key\}/);
  assert.match(source, /<br\/><b>\$\{escapeTooltip\(formatSimulationValue\(count, 'count', undefined\)\)\}<\/b> runs/);
  assert.match(source, /<br\/><b>\$\{escapeTooltip\(formatPercentRatio\(this\.y, 1\)\)\}<\/b> of runs/);
  assert.match(source, /formatSimulationValue\(custom\.from, options\.valueUnit, options\.currency\)/);
  assert.match(source, /backgroundColor: '#333333'/);
  assert.match(source, /borderColor: '#444444'/);
  assert.match(source, /gridLineWidth: options\.yAxisGridLineWidth/);
  assert.match(source, /groupPadding: options\.columnGroupPadding/);
  assert.match(source, /pointPadding: options\.columnPointPadding/);
});
