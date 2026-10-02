import { calendarDateKey } from '../../domain/calendar.ts';
import type { BacktestReport, BacktestTrade } from './backtest-types.ts';

type BacktestTradeCalendarRun = Pick<BacktestReport, 'key' | 'runId'>;

export interface BacktestTradeCalendarDay {
  readonly date: string;
  readonly pnl: number;
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly winRate: number;
}

export interface BacktestTradeCalendarMonth {
  readonly month: string;
  readonly days: readonly BacktestTradeCalendarDay[];
  readonly netPnl: number;
  readonly bestDay: BacktestTradeCalendarDay | null;
  readonly worstDay: BacktestTradeCalendarDay | null;
  readonly averageTradesPerDay: number;
}

function finitePnl(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function backtestTradeCalendarRunIdentity(
  report: BacktestTradeCalendarRun | null,
): string | null {
  if (!report) return null;
  return JSON.stringify([
    report.key?.cellId ?? '',
    report.key?.indicatorId ?? '',
    report.runId ?? '',
  ]);
}

/**
 * A live revision belongs to the same run and must preserve the month being
 * inspected. A new run is a new report session and starts from the current
 * month, even when it belongs to the same strategy instance.
 */
export function shouldResetBacktestTradeCalendar(
  previous: BacktestTradeCalendarRun | null,
  next: BacktestTradeCalendarRun | null,
): boolean {
  return backtestTradeCalendarRunIdentity(previous)
    !== backtestTradeCalendarRunIdentity(next);
}

/**
 * Build the reference Calendar population from realized exits only. Open
 * trades and malformed exit sentinels never enter a date bucket.
 */
export function aggregateBacktestTradeCalendar(
  trades: readonly BacktestTrade[],
  timezone = 'UTC',
): ReadonlyMap<string, BacktestTradeCalendarDay> {
  const mutable = new Map<string, {
    pnl: number;
    tradeCount: number;
    winningTrades: number;
  }>();

  trades.forEach((trade) => {
    if (trade.status === 'open' || trade.exitTime === null || trade.exitTime === undefined) return;
    const date = calendarDateKey(trade.exitTime, timezone);
    if (!date) return;
    const pnl = finitePnl(trade.netPnl);
    // A realized Calendar requires a known realized value. Treating a missing
    // value as a genuine zero would fabricate an active breakeven day and
    // diverge from the Performance bucket population.
    if (pnl === null) return;
    const day = mutable.get(date) ?? { pnl: 0, tradeCount: 0, winningTrades: 0 };
    day.pnl += pnl;
    day.tradeCount += 1;
    if (pnl > 0) day.winningTrades += 1;
    mutable.set(date, day);
  });

  return new Map([...mutable.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, day]) => [date, Object.freeze({
      date,
      pnl: Object.is(day.pnl, -0) ? 0 : day.pnl,
      tradeCount: day.tradeCount,
      winningTrades: day.winningTrades,
      winRate: day.tradeCount > 0 ? (day.winningTrades / day.tradeCount) * 100 : 0,
    })]));
}

export function summarizeBacktestTradeCalendarMonth(
  days: ReadonlyMap<string, BacktestTradeCalendarDay>,
  month: string,
): BacktestTradeCalendarMonth {
  const monthDays = [...days.values()].filter((day) => day.date.startsWith(`${month}-`));
  const netPnl = monthDays.reduce((total, day) => total + day.pnl, 0);
  const tradeCount = monthDays.reduce((total, day) => total + day.tradeCount, 0);
  const bestDay = monthDays.length === 0
    ? null
    : monthDays.reduce((best, day) => day.pnl > best.pnl ? day : best);
  const worstDay = monthDays.length === 0
    ? null
    : monthDays.reduce((worst, day) => day.pnl < worst.pnl ? day : worst);

  return Object.freeze({
    month,
    days: Object.freeze(monthDays),
    netPnl: Object.is(netPnl, -0) ? 0 : netPnl,
    bestDay,
    worstDay,
    // The reference divides by realized trading days, not calendar days.
    averageTradesPerDay: monthDays.length > 0 ? tradeCount / monthDays.length : 0,
  });
}
