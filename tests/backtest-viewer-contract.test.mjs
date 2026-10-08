import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  backtestTradeDisplayNumber,
  backtestTradeExcursionValue,
  backtestTradePriceDigits,
  backtestTradeSizeValue,
  backtestTradesHaveExcursions,
  backtestTradesHaveSize,
  DEFAULT_TRADE_SORT,
  formatBacktestTradeMetric,
  formatBacktestTradeValue,
  isBacktestTradeLocationTime,
  nextBacktestTradeSort,
  sortBacktestTrades,
} from '../src/features/backtesting/trade-log.ts';
import {
  formatTradeAnalysisValue,
  shouldRenderTradeAnalysisEmpty,
} from '../src/features/backtesting/trade-analysis-view.ts';
import {
  formatBacktestCurrency,
  formatBacktestRange,
  formatExecutionPrecision,
} from '../src/features/backtesting/backtest-format.ts';

test('Dock and Viewer share one UTC report-range formatter', () => {
  const report = {
    range: {
      from: Date.UTC(2026, 0, 1, 0, 30),
      to: Date.UTC(2026, 0, 2, 0, 30),
    },
  };
  assert.equal(formatBacktestRange(report), 'Jan 1 - Jan 2, 2026');
});

test('Dock and Viewer display activity dates while preserving legacy host ranges', () => {
  const range = { from: Date.UTC(2025, 11, 1), to: Date.UTC(2026, 0, 3) };
  const activityRange = { from: Date.UTC(2025, 11, 31, 23), to: Date.UTC(2026, 0, 1, 1) };
  assert.equal(formatBacktestRange({ range, activityRange }), 'Dec 31, 2025 - Jan 1, 2026');
  assert.equal(formatBacktestRange({ range, activityRange: null }), '');
  assert.equal(formatBacktestRange({ range, activityRange: null,
    window: { preset: 'custom', label: 'Custom dates', from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 0, 31) } }),
  'Jan 1 - Jan 31, 2026', 'a selected calculation window remains visible without closed activity');
  assert.equal(formatBacktestRange({ range }), 'Dec 1, 2025 - Jan 3, 2026');
  const oneExit = Date.UTC(2026, 0, 2);
  assert.equal(formatBacktestRange({ range, activityRange: { from: oneExit, to: oneExit } }), 'Jan 2 - Jan 2, 2026');
});

test('Viewer report revisions preserve the active panel scroll position', async () => {
  const source = await readFile(new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url), 'utf8');
  assert.match(source, /const previousPanelScrollTop = this\.panel\.scrollTop/);
  assert.match(source, /if \(!liveUpdated\) this\.panel\.scrollTop = restoredPanelScrollTop/);
});

test('Performance currency formatting preserves reference sub-unit precision', () => {
  assert.equal(formatBacktestCurrency(-0.9705555555), '-0.9705556');
  assert.equal(formatBacktestCurrency(0.5), '0.50');
  assert.equal(formatBacktestCurrency(3), '3.00');
  assert.equal(formatBacktestCurrency(null), '—');
});

test('Viewer normalizes account currency before splitting KPI units', async () => {
  const source = await readFile(new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url), 'utf8');
  const workbench = await readFile(new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url), 'utf8');
  assert.match(source, /return report\.currency\?\.trim\(\)\.toUpperCase\(\) \|\| 'USD'/);
  assert.match(workbench, /const currency = report\.currency\?\.trim\(\)\.toUpperCase\(\) \|\| 'USD'/);
});

test('execution precision header metadata is explicit and fallback-safe', () => {
  const applied = formatExecutionPrecision({
    requested: true,
    applied: true,
    requestedPrecision: 'lower-timeframe',
    appliedPrecision: 'lower-timeframe',
    lowerTimeframe: '10',
    parentBars: 3,
    lowerBars: 18,
    coveredParentBars: 3,
    coverage: 1,
  });
  assert.equal(applied?.text, 'LTF → LTF 10 · 100%');
  assert.match(applied?.detail ?? '', /requested Lower timeframe/);
  assert.match(applied?.detail ?? '', /applied Lower timeframe/);
  assert.match(applied?.detail ?? '', /coverage 100% \(3\/3 parent bars; 18 lower bars\)/);
  assert.equal(applied?.fallback, false);

  const fallback = formatExecutionPrecision({
    requested: true,
    applied: false,
    requestedPrecision: 'lower-timeframe',
    appliedPrecision: 'chart-ohlc',
    lowerTimeframe: '10',
    parentBars: 3,
    lowerBars: 0,
    coveredParentBars: 0,
    coverage: 0,
    fallbackReason: 'lower-data-empty',
  });
  assert.equal(fallback?.text, 'LTF → OHLC 10 · 0% · lower data empty');
  assert.equal(fallback?.fallback, true);
  assert.match(fallback?.detail ?? '', /fallback lower data empty \[lower-data-empty\]/);
  assert.equal(fallback?.fallbackReason, 'lower-data-empty');

  const defaultPrecision = formatExecutionPrecision({
    requested: false,
    applied: false,
    requestedPrecision: 'chart-ohlc',
    appliedPrecision: 'chart-ohlc',
    parentBars: 3,
    lowerBars: 0,
    coveredParentBars: 0,
    coverage: 0,
    fallbackReason: 'not-requested',
  });
  // The default chart-OHLC mode is intentionally title/ARIA-only so ordinary
  // report headers retain the reference date-range pixels.
  assert.equal(defaultPrecision?.text, '');
  assert.equal(defaultPrecision?.fallback, false);
  assert.match(defaultPrecision?.detail ?? '', /fallback none$/);
});

test('Trades Log defaults to Trade # descending and keeps equal keys stable', () => {
  const trades = [
    { id: 'a', number: 2, entryTime: 20, netPnl: 1 },
    { id: 'b', number: 10, entryTime: 10, netPnl: -1 },
    { id: 'c', number: 10, entryTime: 30, netPnl: 2 },
    { id: 'd', number: 1, entryTime: 40, netPnl: 0 },
  ];

  assert.deepEqual(DEFAULT_TRADE_SORT, { key: 'number', direction: -1 });
  assert.deepEqual(
    sortBacktestTrades(trades).map((trade) => trade.id),
    ['b', 'c', 'a', 'd'],
  );
  assert.deepEqual(
    nextBacktestTradeSort(DEFAULT_TRADE_SORT, 'number'),
    { key: 'number', direction: 1 },
  );
  assert.deepEqual(
    nextBacktestTradeSort({ key: 'entryTime', direction: 1 }, 'mae'),
    { key: 'mae', direction: -1 },
  );
});

test('Trades Log equal metric values retain reference Trade # descending order', () => {
  // Live reference inspection: an all-size-1 SMA log stays newest-first in
  // both Size directions, and zero MFE/MAE ties use the same numeric order.
  const trades = [
    { id: 'older', number: 2, size: 1, mfe: 0, mae: 0 },
    { id: 'newer', number: 10, size: 1, mfe: 0, mae: 0 },
    { id: 'duplicate', number: 10, size: 1, mfe: 0, mae: 0 },
    { id: 'open', number: 0, size: 1, mfe: 0, mae: 0 },
  ];
  for (const key of ['size', 'mfe', 'mae']) {
    for (const direction of [-1, 1]) {
      assert.deepEqual(
        sortBacktestTrades(trades, { key, direction }).map((trade) => trade.id),
        ['newer', 'duplicate', 'older', 'open'],
      );
    }
  }
});

test('Trades Log sorts every visible metric and formats price/excursion contracts', () => {
  const trades = [
    { id: 'a', size: 1, mfe: 4, mae: 10, cumulativePnl: 5 },
    { id: 'b', size: 3, mfe: 9, mae: 4, cumulativePnl: 2 },
    { id: 'missing', size: null, mfe: null, mae: null, cumulativePnl: null },
  ];
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'size', direction: -1 }).map((trade) => trade.id),
    ['b', 'a', 'missing'],
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'size', direction: 1 }).map((trade) => trade.id),
    ['missing', 'a', 'b'],
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'mae', direction: -1 }).map((trade) => trade.id),
    ['a', 'b', 'missing'],
    'MAE sorting follows the raw excursion magnitude used by the reference',
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'mae', direction: 1 }).map((trade) => trade.id),
    ['missing', 'b', 'a'],
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'mfe', direction: 1 }).map((trade) => trade.id),
    ['missing', 'a', 'b'],
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'mfe', direction: -1 }).map((trade) => trade.id),
    ['b', 'a', 'missing'],
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'cumulativePnl', direction: 1 }).map((trade) => trade.id),
    ['missing', 'b', 'a'],
  );
  assert.deepEqual(
    sortBacktestTrades(trades, { key: 'cumulativePnl', direction: -1 }).map((trade) => trade.id),
    ['a', 'b', 'missing'],
  );
  const timed = [{ id: 'missing', entryTime: null }, { id: 'dated', entryTime: 100 }];
  assert.deepEqual(
    sortBacktestTrades(timed, { key: 'entryTime', direction: 1 }).map((trade) => trade.id),
    ['missing', 'dated'],
  );
  assert.deepEqual(
    sortBacktestTrades(timed, { key: 'entryTime', direction: -1 }).map((trade) => trade.id),
    ['dated', 'missing'],
  );
  assert.equal(backtestTradeExcursionValue('mfe', 12.5), 12.5);
  assert.equal(backtestTradeExcursionValue('mae', 12.5), -12.5);
  assert.equal(backtestTradeExcursionValue('mae', -12.5), -12.5);
  assert.equal(backtestTradePriceDigits(10_000), 2);
  assert.equal(backtestTradePriceDigits(100), 4);
  assert.equal(backtestTradePriceDigits(1), 5);
  assert.equal(backtestTradePriceDigits(0.5), 8);
  assert.equal(formatBacktestTradeValue(1_000_000), '1.0M');
  assert.equal(formatBacktestTradeValue(999_999), '999,999.00');
  assert.equal(formatBacktestTradeValue(1), '1.00');
  assert.equal(formatBacktestTradeValue(0), '0.00');
  assert.equal(formatBacktestTradeValue(-0), '0.00');
  assert.equal(formatBacktestTradeValue(0.5), '0.5');
  assert.equal(formatBacktestTradeValue(1e-7), '0.0000001');
  assert.equal(formatBacktestTradeValue(1e-8), '1.00e-8');
  assert.equal(formatBacktestTradeValue(-0.123456), '-0.123456');
  assert.equal(formatBacktestTradeValue(null), '—');
  assert.equal(formatBacktestTradeMetric(0, 'USD', true), '+0.00 USD');
  assert.equal(formatBacktestTradeMetric(-0, 'USD', true), '+0.00 USD');
  assert.equal(formatBacktestTradeMetric(0.25, 'USD', true), '+0.25 USD');
  assert.equal(formatBacktestTradeMetric(-0.123456, 'USD', true), '-0.123456 USD');
  assert.equal(formatBacktestTradeMetric(0.25, 'USD'), '0.25 USD');
  assert.equal(formatBacktestTradeMetric(null, 'USD', true), '—');
  assert.equal(backtestTradeSizeValue(-3), 3);
  assert.equal(backtestTradesHaveSize([{ size: 0 }, { size: null }]), false);
  assert.equal(backtestTradesHaveSize([{ size: 0 }, { size: -2 }]), true);
  assert.equal(backtestTradesHaveExcursions([{ mfe: null, mae: undefined }]), false);
  assert.equal(backtestTradesHaveExcursions([{ mfe: null, mae: 0 }]), true);
  assert.equal(isBacktestTradeLocationTime(0), false);
  assert.equal(isBacktestTradeLocationTime('0'), false);
  assert.equal(isBacktestTradeLocationTime('N/A'), false);
  assert.equal(isBacktestTradeLocationTime('not-a-date'), false);
  assert.equal(isBacktestTradeLocationTime('2026-09-26T12:00:00Z'), true);
  assert.equal(isBacktestTradeLocationTime(1_700_000_000_000), true);
  const fallbackTrades = [{ size: 1 }, { size: 3 }];
  assert.deepEqual(
    sortBacktestTrades(fallbackTrades).map((trade) => (
      backtestTradeDisplayNumber(trade, fallbackTrades.indexOf(trade))
    )),
    [2, 1],
    'fallback Trade # values remain tied to source order while sorting',
  );
});

test('Trades Log keeps the evidence-constrained visible controls', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/features/backtesting/backtest.css', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /Export CSV/);
  assert.doesNotMatch(source, /label: 'Direction'/);
  for (const definition of [
    "{ key: 'number', label: 'Trade #', sort: 'number' }",
    "{ key: 'entryTime', label: 'Entry', sort: 'entryTime' }",
    "{ key: 'exitTime', label: 'Exit', sort: 'exitTime' }",
    "{ key: 'netPnl', label: 'Net P&L', sort: 'netPnl' }",
    "{ key: 'cumulativePnl', label: 'Cumulative P&L', sort: 'cumulativePnl' }",
  ]) assert.ok(source.includes(definition), definition);
  assert.match(source, /key: 'size', label: 'Size', sort: 'size' as const/);
  assert.match(source, /label: 'MFE', sort: 'mfe'/);
  assert.match(source, /label: 'MAE', sort: 'mae'/);
  assert.match(source, /Maximum favorable excursion/);
  assert.match(source, /Maximum adverse excursion/);
  assert.match(source, /controlLabel\.title = column\.tooltip/);
  assert.match(source, /control\.title = column\.tooltip/);
  assert.match(source, /control\.setAttribute\('aria-label', `\$\{column\.label\}: \$\{column\.tooltip\}`\)/);
  assert.doesNotMatch(source, /cell\.title = TRADE_EXCURSION_TOOLTIPS/);
  assert.match(source, /quant-backtest-direction-badge quant-backtest-direction-/);
  assert.match(source, /const direction = trade\.direction === 'long' \|\| trade\.direction === 'short'/);
  assert.match(source, /formatTradePrice\(price, currency\)/);
  assert.match(source, /formatBacktestTradeMetric\(trade\.netPnl, currency, true\)/);
  assert.match(source, /formatBacktestTradeMetric\(displayValue, currency, key === 'cumulativePnl'\)/);
  assert.match(source, /currency\.toUpperCase\(\)/);
  assert.match(source, /return `N\/A \$\{normalizedCurrency\}`/);
  assert.match(source, /toLocaleString\(undefined, options\)/);
  assert.match(source, /weekday: 'short'/);
  assert.match(source, /day: '2-digit'/);
  assert.match(source, /hour12: false/);
  assert.match(source, /timeZone: 'UTC'/);
  assert.match(source, /const openExit = side === 'exit' && trade\.status === 'open'/);
  assert.match(source, /const displayTime = openExit[\s\S]*\? null : value/);
  assert.match(source, /openExit \? 'Open' : formatTradeDateTime/);
  assert.match(source, /this\.callbacks\.onTradeLocate/);
  assert.match(source, /isBacktestTradeLocationTime\(value\)/);
  assert.match(source, /backtestTradesHaveSize\(trades\)/);
  assert.match(source, /backtestTradesHaveExcursions\(trades\)/);
  assert.match(source, /table\.dataset\.tradeLayout = 'full'/);
  assert.match(source, /const colgroup = createElement\(this\.doc, 'colgroup'\)/);
  assert.match(source, /Show \$\{side\} on chart/);
  assert.match(source, /data-trade-locate="\$\{side\}"/);
  assert.match(source, /CROSSHAIR_ICON_MARKUP/);
  assert.match(source, /this\.tradeSort\.direction === 1 \? 'chevron-up' : 'chevron-down'/);
  assert.match(source, /quant-backtest-segment-icon/);
  assert.match(source, /quant-backtest-log-card/);
  assert.match(styles, /\.quant-backtest-locate[\s\S]*width: 24px/);
  assert.match(styles, /\.quant-backtest-locate \.quant-backtest-icon[\s\S]*width: 14px/);
  assert.match(styles, /tbody tr:hover \.quant-backtest-locate/);
  assert.match(styles, /tbody tr:focus-within \.quant-backtest-locate/);
  assert.match(styles, /@media \(hover: none\)/);
  assert.match(styles, /\.quant-backtest-trade-time[\s\S]*text-align: left/);
  assert.match(styles, /\.quant-backtest-trade-time-details[\s\S]*align-items: flex-start/);
  assert.match(styles, /thead th:nth-child\(2\)[\s\S]*text-align: left/);
  assert.match(styles, /\.quant-backtest-trade-table \{[\s\S]*border: 0;[\s\S]*font-size: 14px;[\s\S]*line-height: 20px/);
  assert.match(styles, /\.quant-backtest-trade-table th,[\s\S]*padding: 8px 16px/);
  assert.match(styles, /\.quant-backtest-trade-table thead th[\s\S]*position: sticky[\s\S]*text-transform: none/);
  assert.match(styles, /@media \(min-width: 1024px\)[\s\S]*quant-backtest-trade-table\[data-trade-layout='full'\][\s\S]*width: 1080\.875px[\s\S]*table-layout: fixed/);
  assert.match(styles, /quant-backtest-trade-table\[data-trade-layout='full'\] col:nth-child\(8\)[\s\S]*width: 120\.9375px/);
  assert.match(styles, /\.quant-backtest-log-card[\s\S]*padding: 16px[\s\S]*border: 1px solid/);
  assert.match(styles, /\.quant-backtest-trade-datetime,[\s\S]*font-size: 14px/);
});

test('Trades Log view mode uses icon-only tabs and monthly realized calendar summaries', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const calendar = await readFile(
    new URL('../src/features/backtesting/trade-calendar-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /mode\.setAttribute\('role', 'tablist'\)/);
  assert.match(source, /viewModeLabel\.textContent = 'View Mode'/);
  assert.match(source, /control\.setAttribute\('role', 'tab'\)/);
  assert.match(source, /control\.setAttribute\('aria-selected'/);
  assert.match(source, /control\.setAttribute\('aria-controls', 'quant-backtest-trades-view-panel'\)/);
  assert.match(source, /mode\.setAttribute\('aria-orientation', 'horizontal'\)/);
  assert.match(source, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]\.includes\(event\.key\)/);
  assert.match(source, /event\.key === 'Home'/);
  assert.match(source, /event\.key === 'End'/);
  assert.match(source, /panel\.id = 'quant-backtest-trades-view-panel'/);
  assert.doesNotMatch(source, /control\.setAttribute\('aria-pressed'/);
  assert.match(calendar, /Previous month/);
  assert.match(calendar, /Next month/);
  assert.match(calendar, /Move to current month/);
  assert.match(calendar, /Month Net P&L/);
  assert.match(calendar, /Best Day/);
  assert.match(calendar, /Worst Day/);
  assert.match(calendar, /Avg Trades per Day/);
  assert.match(calendar, /summarizeBacktestTradeCalendarMonth/);
  assert.match(calendar, /headerRow\.setAttribute\('role', 'row'\)/);
  assert.match(calendar, /weekRow\.setAttribute\('role', 'row'\)/);
  assert.match(calendar, /control\.dataset\.calendarNavigation = name/);
  assert.match(source, /\[data-calendar-navigation="\$\{focusTarget\}"\]/);
  assert.match(source, /currentCalendarMonthKey\(\)/);
  const executionReset = source.match(/if \(previousExecution !== nextExecution\) \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  assert.match(executionReset, /this\.lastSimulationSignature = null/);
  assert.match(executionReset, /this\.simulationSettingsOpen = false/);
  assert.match(source, /if \(shouldResetBacktestTradeCalendar\(this\.report, report\)\)/);
  assert.match(source, /cache\.reportRevision === reportRevision\s*&& cache\.trades === trades/);
  assert.match(source, /focusedCalendarNavigation/);
  assert.match(source, /if \(this\.activeTab === 'log'\) return this\.renderTradesLog\(\)/);
  assert.match(source, /function reportTimezone\(report: BacktestReport\)/);
  assert.match(source, /data-timezone="\$\{escapeHtml\(timezone\)\}"/);
  assert.match(calendar, /grid\.setAttribute\('aria-readonly', 'true'\)/);
  assert.match(calendar, /title\.setAttribute\('aria-live', 'polite'\)/);
  assert.match(calendar, /empty\.setAttribute\('role', 'status'\)/);
  assert.match(calendar, /No closed trades in this month\./);
});

test('Viewer tabs expose an explicit accessible tab-to-panel relationship', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /tabButton\.id = `quant-backtest-tab-\$\{tab\.id\}`/);
  assert.match(source, /tabButton\.setAttribute\('aria-controls', 'quant-backtest-panel'\)/);
  assert.match(source, /this\.panel\.id = 'quant-backtest-panel'/);
  assert.match(source, /this\.panel\.setAttribute\('aria-labelledby', 'quant-backtest-tab-performance'\)/);
  assert.match(source, /this\.panel\.setAttribute\('aria-labelledby', `quant-backtest-tab-\$\{tab\}`\)/);
});

test('Trades Analysis uses the dedicated reference structure and exact fixed tables', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const analysis = await readFile(
    new URL('../src/features/backtesting/trade-analysis-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /import \{ renderTradeAnalysisView \} from '\.\/trade-analysis-view\.ts'/);
  assert.match(viewer, /return renderTradeAnalysisView\(this\.doc, this\.requireReport\(\)\)/);
  assert.match(viewer, /this\.activeTab === 'analysis'[\s\S]*renderTradeAnalysisView\(this\.doc, this\.report\)/);
  assert.doesNotMatch(viewer, /renderSectionHeading\(this\.doc, 'Trades Analysis'\)/);
  assert.doesNotMatch(viewer, /renderWinRateChart/);
  assert.doesNotMatch(viewer, /quant-backtest-frequency-card/);
  for (const definition of [
    "{ key: 'trades', label: 'Closed Trades', kind: 'count' }",
    "{ key: 'winningTrades', label: 'Winning Trades', kind: 'count' }",
    "{ key: 'losingTrades', label: 'Losing Trades', kind: 'count' }",
    "{ key: 'breakevenTrades', label: 'Breakeven Trades', kind: 'count' }",
    "{ key: 'winRate', label: 'Win Rate', kind: 'percent' }",
    "{ key: 'averageTrade', label: 'Avg P&L', kind: 'currency', colorize: true }",
    "{ key: 'averageWinner', label: 'Avg Winning Trade', kind: 'currency' }",
    "{ key: 'averageLoser', label: 'Avg Losing Trade', kind: 'currency' }",
    "{ key: 'largestWinner', label: 'Largest Winning Trade', kind: 'currency' }",
    "{ key: 'largestLoser', label: 'Largest Losing Trade', kind: 'currency' }",
  ]) assert.ok(analysis.includes(definition), definition);
  for (const label of [
    'Avg Trade Duration (bars)',
    'Avg Winning Trade Duration (bars)',
    'Avg Losing Trade Duration (bars)',
    'Avg Trades per Day',
    'Avg Trades per Week',
    'Longest Trade (bars)',
    'Shortest Trade (bars)',
    'Longest Winning Streak (bars)',
    'Longest Losing Streak (bars)',
  ]) assert.ok(analysis.includes(`label: '${label}'`), label);
  assert.match(analysis, /metricHead\.setAttribute\('aria-label', 'Metric'\)/);
  assert.match(analysis, /empty\.textContent = 'No trades available'/);
  assert.match(analysis, /shouldRenderTradeAnalysisEmpty\(report\)/);
  assert.match(analysis, /formatBacktestTradeValue\(number\)/);
  assert.match(analysis, /analysis\?\.durationComparison/);
});

test('Trades Analysis remains empty for open-only reports despite the presentation projection', () => {
  const base = {
    strategyName: 'Reference strategy',
    summary: { trades: 0 },
    analysis: { comparison: { all: { trades: 1, breakevenTrades: 1 } } },
  };
  assert.equal(shouldRenderTradeAnalysisEmpty({ ...base, status: 'open-only' }), true);
  assert.equal(shouldRenderTradeAnalysisEmpty({ ...base, status: 'no-trades' }), true);
  assert.equal(shouldRenderTradeAnalysisEmpty({ ...base, status: 'ready' }), true);
  assert.equal(shouldRenderTradeAnalysisEmpty({
    ...base,
    status: 'ready',
    summary: { trades: { value: 1, unit: 'count' } },
  }), false);
  assert.equal(shouldRenderTradeAnalysisEmpty({
    ...base,
    status: 'ready',
    analysis: { ...base.analysis, closedTradeCount: 1 },
    trades: [{ status: 'closed', netPnl: 0 }],
  }), false, 'a real breakeven closed trade must not be mistaken for open-only');
});

test('Trades Analysis keeps the reference null formatting split between duration rows', () => {
  assert.equal(formatTradeAnalysisValue(null, 'number', 'USD', true), '0');
  assert.equal(formatTradeAnalysisValue(undefined, 'number', 'USD', true), '0');
  assert.equal(formatTradeAnalysisValue(null, 'number', 'USD'), '-');
  assert.equal(formatTradeAnalysisValue(354.4, 'number', 'USD'), '354.4');
});

test('Backtest transient states expose atomic live-region semantics', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /function markStatusRegion\(/);
  assert.match(viewer, /element\.setAttribute\('role', politeness === 'assertive' \? 'alert' : 'status'\)/);
  assert.match(viewer, /element\.setAttribute\('aria-live', politeness\)/);
  assert.match(viewer, /element\.setAttribute\('aria-atomic', 'true'\)/);
  assert.match(viewer, /markStatusRegion\(container\);[\s\S]*const spinner/);
  assert.match(viewer, /markStatusRegion\(container, 'assertive'\);[\s\S]*Backtest unavailable/);
});

test('Trades Analysis registers donut, histogram references, and duration scatter', async () => {
  const analysis = await readFile(
    new URL('../src/features/backtesting/trade-analysis-view.ts', import.meta.url),
    'utf8',
  );
  const renderer = await readFile(
    new URL('../src/features/backtesting/highcharts-renderer.ts', import.meta.url),
    'utf8',
  );
  assert.match(analysis, /`P&L Distribution \(\$\{reportCurrency\(report\)\}\)`/);
  assert.match(analysis, /kind: 'pie'/);
  assert.match(analysis, /innerSize: '75%'/);
  assert.match(analysis, /tooltipMode: 'winrate'/);
  assert.match(analysis, /xAxisTickInterval: binWidth/);
  assert.match(analysis, /xAxisLabelDecimals: 2/);
  assert.match(analysis, /columnPointRange: binWidth/);
  assert.match(analysis, /columnBorderRadius: 2/);
  assert.match(analysis, /kind: 'scatter'/);
  assert.match(analysis, /xAxisTitle: 'Duration \(bars\)'/);
  assert.match(analysis, /yAxisTitle: 'Trade P&L'/);
  assert.match(analysis, /tooltipMode: 'duration-pnl'/);
  assert.match(analysis, /report\.analysis\?\.durationTrend/);
  assert.doesNotMatch(analysis, /function regressionSeries/);
  assert.match(analysis, /tooltipMode: 'distribution'/);
  assert.match(analysis, /xAxisLabelRotation: -45/);
  assert.match(analysis, /width: 2/);
  assert.match(analysis, /\['Profit', PROFIT_COLOR\], \['Loss', LOSS_COLOR\]/);
  assert.match(analysis, /category\.toLowerCase\(\)\.includes\('breakeven'\)/);
  assert.match(renderer, /ReportChartKind = 'line' \| 'column' \| 'pie' \| 'scatter'/);
  assert.match(renderer, /readonly innerSize\?: string \| number/);
  assert.match(renderer, /readonly plotLines\?: readonly ReportChartPlotLine\[\]/);
  assert.match(renderer, /series\.kind \?\? options\.kind/);
  assert.match(renderer, /symbol: 'circle'/);
  assert.match(renderer, /numeric\.toFixed\(options\.xAxisLabelDecimals\)/);
  assert.match(renderer, /<b>Interval:<\/b> \$\{escapeTooltip\(from\)\} \| \$\{escapeTooltip\(to\)\}/);
  assert.match(renderer, /options\.tooltipMode === 'winrate'/);
  assert.match(renderer, /options\.tooltipMode === 'duration-pnl'/);
  assert.match(renderer, /headerFormat: ''/);
  assert.match(renderer, /useHTML: true/);
  assert.match(renderer, /compactTooltipCurrency/);
  assert.match(renderer, /quant-backtest-analysis-tooltip-trade/);
  assert.match(renderer, /quant-backtest-analysis-tooltip-direction/);
  assert.match(renderer, /quant-backtest-analysis-tooltip-pnl/);
  assert.match(renderer, /quant-backtest-analysis-tooltip-dot/);
  assert.match(renderer, /quant-backtest-analysis-tooltip-time/);
  assert.match(renderer, /const pnlColor = typeof this\.y === 'number' && this\.y < 0/);
  assert.doesNotMatch(renderer, /`Duration: \$\{escapeTooltip/);
  assert.match(renderer, /\(UTC\)/);
});

test('Trades Analysis styling is scoped and SVG grid lines cannot override layout grids', async () => {
  const styles = await readFile(
    new URL('../src/features/backtesting/backtest.css', import.meta.url),
    'utf8',
  );
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const analysis = await readFile(
    new URL('../src/features/backtesting/trade-analysis-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(styles, /\.quant-backtest-analysis \{[\s\S]*padding-right: 32px;[\s\S]*padding-left: 32px;/);
  assert.match(styles, /\.quant-backtest-analysis-overview \{[\s\S]*gap: 24px/);
  assert.match(styles, /\.quant-backtest-analysis-distribution-host \{[\s\S]*height: 200px/);
  assert.match(styles, /\.quant-backtest-analysis-donut-host \{[\s\S]*height: 180px/);
  assert.match(styles, /\.quant-backtest-analysis-duration-host \{[\s\S]*height: 250px/);
  assert.match(styles, /\.quant-backtest-analysis-table \{[\s\S]*border: 0;[\s\S]*background: transparent/);
  assert.match(styles, /\.quant-backtest-performance[\s\S]*> \.quant-backtest-chart-grid[\s\S]*> \.quant-backtest-chart-frame:first-child/);
  assert.doesNotMatch(styles, /^\.quant-backtest-chart-frame:first-child/m);
  assert.match(styles, /\.quant-backtest-chart-grid-lines \{/);
  assert.doesNotMatch(styles, /\.quant-backtest-chart-grid \{\s*fill:/);
  assert.doesNotMatch(viewer, /setAttribute\('class', 'quant-backtest-chart-grid'\)/);
  assert.doesNotMatch(analysis, /setAttribute\('class', 'quant-backtest-chart-grid'\)/);
});

test('Performance Viewer preserves the reference header identity and missing-cell contracts', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/features/backtesting/backtest.css', import.meta.url),
    'utf8',
  );
  const workbench = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /reportDisplaySymbol/);
  assert.match(viewer, /reportTimeframeLabel/);
  assert.match(viewer, /formatExecutionPrecision\(this\.report\.execution\?\.precision\)/);
  assert.match(viewer, /dataset\.executionFallback/);
  assert.match(viewer, /dataset\.executionFallbackReason/);
  assert.match(viewer, /rawProvider\.toLowerCase\(\) === 'unknown'/);
  // The current live reference uses an X; Return to chart behavior is unchanged.
  assert.match(viewer, /icon\(doc, 'close'\)/);
  const format = await readFile(
    new URL('../src/features/backtesting/backtest-format.ts', import.meta.url),
    'utf8',
  );
  assert.match(format, /Intl\.DateTimeFormat\('en-US'/);
  assert.match(format, /fromYear === toYear/);
  assert.match(workbench, /formatBacktestRange\(this\.report\)/);
  assert.match(workbench, /formatExecutionPrecision\(this\.report\.execution\?\.precision\)/);
  assert.match(workbench, /dataset\.executionFallback/);
  assert.match(workbench, /dataset\.executionFallbackReason/);
  assert.match(viewer, /column\.id === 'all' && row\.group === 'Benchmark' \? '-'/);
  assert.match(viewer, /column\.id === 'all' \? '—' : ''/);
  // Risk-adjusted ratios keep the reference's three-decimal display precision
  // while their underlying formula/capital contract remains engine-defined.
  assert.match(viewer, /\{ key: 'calmar', label: 'Calmar Ratio', unit: 'ratio', group: 'Risk-Adjusted Performance' \}/);
  assert.match(viewer, /\{ key: 'sharpe', label: 'Sharpe Ratio', unit: 'ratio', group: 'Risk-Adjusted Performance' \}/);
  assert.match(viewer, /\{ key: 'sortino', label: 'Sortino Ratio', unit: 'ratio', group: 'Risk-Adjusted Performance' \}/);
  assert.match(viewer, /digits = unit === 'count' \? 0 : unit === 'ratio' \? 3 : 2/);
  assert.match(styles, /quant-backtest-viewer-back:focus-visible/);
  assert.match(styles, /quant-backtest-viewer-heading > span:last-child/);
  assert.match(styles, /data-execution-fallback='true'/);
  assert.match(styles, /quant-backtest-viewer-header \{[\s\S]*border-bottom: 0/);
});

test('Viewer market labels normalize stablecoin and separated USD symbols without changing report identity', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /normalizeReportMarketSymbol/);
  assert.match(viewer, /upper\.endsWith\('USDT'\)/);
  assert.match(viewer, /upper\.endsWith\('USDC'\)/);
  assert.match(viewer, /withoutPerpetualSuffix = raw\.replace\(\/\\\.P\$\/i/);
  assert.match(viewer, /reportDisplaySymbol/);
});

test('Simulation only commits one run per changed form state', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const simulation = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  // `input` would fire for every keystroke and used to race the report
  // replacement with the subsequent native `change` event.
  assert.doesNotMatch(simulation, /addEventListener\('input'/);
  assert.match(viewer, /lastSimulationSignature/);
  assert.match(simulation, /customInput\.addEventListener\('change', commit\)/);
  assert.match(simulation, /variation\.addEventListener\('change', commitVariation\)/);
});

test('Simulation cumulative mode renders paths and calendar respects report timezone', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const simulation = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(simulation, /function pathChart/);
  assert.match(simulation, /kind: 'arearange'/);
  assert.match(simulation, /function cumulativeSimulationBins/);
  assert.match(simulation, /simulation\.bands\.p5/);
  assert.match(simulation, /simulation\.bands\.p95/);
  const calendar = await readFile(
    new URL('../src/features/backtesting/trade-calendar.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /const timezone = report\.timezone \?\? 'UTC'/);
  assert.match(viewer, /aggregateBacktestTradeCalendar\(trades, timezone\)/);
  assert.match(calendar, /calendarDateKey\(trade\.exitTime, timezone\)/);
});

test('report charts register local Highcharts upgrades while retaining SVG fallback', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const analysis = await readFile(
    new URL('../src/features/backtesting/trade-analysis-view.ts', import.meta.url),
    'utf8',
  );
  const simulation = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  const renderer = await readFile(
    new URL('../src/features/backtesting/highcharts-renderer.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /registerReportChart/);
  assert.match(viewer, /enhanceReportCharts/);
  assert.match(viewer, /destroyReportCharts\(this\.panel\)/);
  assert.match(viewer, /quant-backtest-chart-host/);
  assert.match(viewer, /Cumulative P&L/);
  assert.match(analysis, /registerReportChart/);
  assert.match(analysis, /P&L Distribution/);
  assert.match(analysis, /quant-backtest-analysis-fallback-chart/);
  assert.match(simulation, /registerReportChart/);
  assert.match(simulation, /quant-backtest-simulation-chart-fallback/);
  assert.match(renderer, /import\('highcharts(?:\/esm\/highcharts\.js)?'\)/);
  assert.match(renderer, /dataset\.quantReportChart/);
  assert.match(renderer, /const generations = new WeakMap/);
  assert.match(renderer, /existing\.chart\.reflow\(\)/);
  assert.match(renderer, /ResizeObserver/);
  assert.match(renderer, /chart\.destroy\(\)/);
  assert.doesNotMatch(renderer, /https?:\/\//);
});

test('Highcharts upgrades keep a non-empty SVG accessibility label', async () => {
  const renderer = await readFile(
    new URL('../src/features/backtesting/highcharts-renderer.ts', import.meta.url),
    'utf8',
  );
  // Highcharts core (without its optional accessibility module) emits an
  // empty aria-label on .highcharts-root. The adapter must repair that label
  // after both a fresh upgrade and an instance reuse/reflow.
  assert.match(renderer, /function applyChartAccessibility\(host: HTMLElement, label: string\)/);
  assert.match(renderer, /svg\.highcharts-root/);
  assert.match(renderer, /svg\.setAttribute\('aria-label', label\)/);
  assert.match(renderer, /data-quant-report-description/);
  assert.match(renderer, /applyChartAccessibility\(host, options\.label\)/g);
});

test('cumulative P&L chart exposes realized-ledger provenance without claiming exact equity', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const types = await readFile(
    new URL('../src/features/backtesting/backtest-types.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /markCumulativePnlSource/);
  assert.doesNotMatch(viewer, /note\.textContent = 'Realized from closed trades'/);
  assert.match(types, /hasRealizedPnlCurve\?: boolean/);
  assert.match(types, /BacktestCumulativePnlSource/);
  assert.match(types, /cumulativePnlSource\?: BacktestCumulativePnlSource/);
});

test('report chart cleanup is wired to close, destroy, and every panel replacement', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const workbench = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  const closeBody = source.match(/close\(\): void \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  const destroyBody = source.match(/destroy\(\): void \{([\s\S]*?)\n\s*\}/)?.[1] ?? '';
  assert.match(closeBody, /destroyReportCharts\(this\.panel\)/);
  assert.match(destroyBody, /destroyReportCharts\(this\.panel\)/);
  assert.match(source, /destroyReportCharts\(this\.panel\);\n\s*if \(!this\.report\)/);
  assert.match(source, /void enhanceReportCharts\(this\.panel\)/);
  assert.match(workbench, /destroyReportCharts\(this\.dockMetrics\)/);
  assert.match(workbench, /if \(!this\.report\)[\s\S]*?destroyReportCharts\(this\.dockMetrics\);\n\s*this\.dockMetrics\.replaceChildren\(\)/);
});

test('Simulation exposes independent views and enables preserve only when variation is active', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /variation\.min = '0'/);
  assert.match(source, /variation\.max = '100'/);
  assert.match(source, /preserve\.disabled = simulation\.variationPercent === 0/);
  assert.match(source, /onChange\(\{ outcomeChartMode \}\)/);
  assert.match(source, /onChange\(\{ drawdownChartMode \}\)/);
  assert.match(source, /simulation\.outcomeHistogram/);
  assert.match(source, /simulation\.drawdownHistogram/);
  assert.match(source, /simulationShowsOutcome\(simulation\)/);
});

test('Simulation viewer renders the partial-history warning supplied by the controller', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /report\.simulationWarning/);
  assert.match(source, /quant-backtest-simulation-warning/);
});

test('Simulation modal and async redraws preserve one isolated focus lifecycle', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  const simulation = await readFile(
    new URL('../src/features/backtesting/simulation-view.ts', import.meta.url),
    'utf8',
  );
  assert.match(viewer, /focusedSimulationControl/);
  assert.match(viewer, /this\.restoreSimulationFocus\(focusedSimulationControl\)/);
  assert.match(viewer, /const dialogOpen = this\.simulationSettingsOpen \|\| Boolean\(dialog\)/);
  assert.match(viewer, /pendingSimulationFocus/);
  assert.match(viewer, /addEventListener\('keydown', this\.onDocumentKeydown, true\)/);
  assert.match(viewer, /currentFocus === 'settings:variation'/);
  assert.match(viewer, /const focusable = focusableElements\(focusRoot\)/);
  assert.match(viewer, /current\.getAttribute\('aria-hidden'\) === 'true'/);
  assert.match(viewer, /candidate\.dataset\.simulationFocus === focusKey/);
  assert.match(viewer, /candidate\.dataset\.simulationSettingsTrigger !== undefined/);
  assert.match(viewer, /addEventListener\('resize', this\.onViewportResize\)/);
  assert.match(viewer, /removeEventListener\('resize', this\.onViewportResize\)/);
  assert.match(viewer, /focusableElements\(dialog\)\.includes\(active\)/);
  assert.match(viewer, /focusedSimulationDialog/);
  assert.match(viewer, /applySimulationModalIsolation/);
  assert.match(viewer, /node\.inert = modal/);
  assert.match(viewer, /node\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(viewer, /simulationSettingsReturnTarget/);
  assert.match(viewer, /preferred \?\? fallback/);
  assert.match(simulation, /dataset\.simulationFocus/);
  assert.match(simulation, /controlsSimulation/);
});

test('Viewer focus loop honors roving tabindex for inactive tabs', async () => {
  const viewer = await readFile(
    new URL('../src/features/backtesting/backtest-viewer.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    viewer,
    /if \(node\.tabIndex < 0\) return false/,
    'programmatic Tab trapping must not focus inactive tab buttons',
  );
});

test('Dock collapse removes the hidden resize control from keyboard and pointer interaction', async () => {
  const workbench = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/features/backtesting/backtest.css', import.meta.url),
    'utf8',
  );
  assert.match(workbench, /if \(this\.collapsed\) return;/);
  assert.match(workbench, /this\.separator\.tabIndex = -1/);
  assert.match(workbench, /this\.separator\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(workbench, /this\.separator\.setAttribute\('aria-disabled', 'true'\)/);
  assert.match(workbench, /this\.separator\.setAttribute\('aria-keyshortcuts', 'ArrowUp ArrowDown Shift\+ArrowUp Shift\+ArrowDown Home End'\)/);
  assert.match(styles, /\.quant-backtest-dock\.is-collapsed \.quant-backtest-dock-separator \{[\s\S]*pointer-events: none/);
});

test('compact view matches the reference breakpoint with one Backtest entry and no Dock reservation', async () => {
  const workbench = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  const styles = await readFile(
    new URL('../src/features/backtesting/backtest.css', import.meta.url),
    'utf8',
  );
  assert.match(workbench, /quant-backtest-mobile-trigger/);
  assert.match(workbench, /this\.mobileViewerButton\.addEventListener\('click', \(\) => this\.openViewer\(\)\)/);
  assert.match(workbench, /return width <= 1023/);
  assert.match(workbench, /!this\.viewer\.isOpen && !this\.isCompactViewport\(\)/);
  assert.match(styles, /@media \(max-width: 1023px\)[\s\S]*quant-backtest-mobile-trigger:not\(\[hidden\]\)[\s\S]*display: inline-flex/);
});

test('Trade locate returns to the chart before invoking the host navigator', async () => {
  const source = await readFile(
    new URL('../src/features/backtesting/backtest-workbench.ts', import.meta.url),
    'utf8',
  );
  const callback = source.match(/onTradeLocate:\s*\(trade, side\) => \{([\s\S]*?)\n\s*\},\n\s*onSimulationChange/);
  assert.ok(callback, 'workbench must own the locate lifecycle callback');
  const closeIndex = callback[1].indexOf('this.closeViewer()');
  const hostIndex = callback[1].indexOf('this.port.onTradeLocate?.(trade, side)');
  assert.ok(closeIndex >= 0, 'locate should close the report viewer');
  assert.ok(hostIndex > closeIndex, 'host navigation should run after viewer cleanup');
});
