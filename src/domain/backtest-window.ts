import type { BacktestResolvedWindow, BacktestWindowSelection } from './ports/backtest-window.ts';

export type { BacktestResolvedWindow, BacktestWindowPreset, BacktestWindowSelection } from './ports/backtest-window.ts';

/** Calendar months, clamped at month end (March 31 → February 28/29). */
function subtractMonths(time: number, months: number): number {
  const date = new Date(time);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

export function backtestWindowLabel(selection: BacktestWindowSelection | undefined): string {
  if (!selection || selection.preset === 'default') return 'Default · 2,000 bars';
  return ({ '1M': '1 month', '3M': '3 months', '6M': '6 months', '1Y': '1 year', custom: 'Custom dates' } as const)[selection.preset];
}

/** Freeze a request at click time. Report metadata only: trades, account and
 * curves must come from a new engine run on the bounded dataset. Dates use UTC. */
export function resolveBacktestWindow(
  selection: BacktestWindowSelection,
  now = Date.now(),
): BacktestResolvedWindow | undefined {
  if (selection.preset === 'default') return undefined;
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 } as const;
  const end = selection.preset === 'custom' ? selection.to : now;
  const from = selection.preset === 'custom' ? selection.from : subtractMonths(now, months[selection.preset]);
  if (typeof from !== 'number' || typeof end !== 'number' || !Number.isFinite(from)
    || !Number.isFinite(end) || from < 0 || from >= end || from >= now) {
    throw new Error('Choose a valid start and end date. Start must be before now.');
  }
  const to = Math.min(now, end);
  return Object.freeze({ preset: selection.preset, from, to, label: backtestWindowLabel(selection) });
}
