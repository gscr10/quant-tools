import type { BarRange, OHLCV } from '@luxalgo/vela';

export interface HistoryGap {
  readonly from: number;
  readonly to: number;
  readonly missing: number;
}

interface CandleStep {
  readonly milliseconds?: number;
  readonly months?: number;
}

/** Binance months are calendar based; Hyperliquid 1M is a native 30-day bin. */
export type HistoryCalendar = 'utc-month' | 'fixed-30-days';

function candleStep(timeframe: string, calendar: HistoryCalendar): CandleStep | null {
  if (typeof timeframe !== 'string') return null;
  const value = timeframe.trim();
  const month = /^(?:(\d+)M|M|(\d+)[mM][oO])$/.exec(value);
  if (month) {
    const months = Number(month[1] ?? month[2] ?? 1);
    if (!Number.isSafeInteger(months) || months <= 0) return null;
    if (calendar === 'fixed-30-days') {
      const milliseconds = months * 30 * 86_400_000;
      return Number.isSafeInteger(milliseconds) ? { milliseconds } : null;
    }
    return { months };
  }
  const fixed = /^(\d+)?(m|h|d|w)?$/i.exec(value);
  if (!fixed || !value) return null;
  const amount = Number(fixed[1] ?? 1);
  const unit = (fixed[2] ?? 'm').toLowerCase();
  const multiplier = unit === 'w' ? 604_800_000 : unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) && milliseconds > 0 ? { milliseconds } : null;
}

function moveMonth(time: number, months: number): number {
  const date = new Date(time);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

/** Only apply to venues with a continuous crypto candle calendar. This checks
 * internal holes, never invents history before a listing or after its last bar.
 * Monthly bars use the venue's explicit calendar, never infer it from a gap. */
export function historyGaps(bars: readonly Pick<OHLCV, 'time'>[], timeframe: string, calendar: HistoryCalendar = 'utc-month'): HistoryGap[] {
  const step = candleStep(timeframe, calendar);
  if (!step) return [];
  const gaps: HistoryGap[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const before = bars[index - 1]!.time;
    const after = bars[index]!.time;
    if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before) continue;
    if (step.milliseconds !== undefined) {
      const missing = Math.ceil((after - before) / step.milliseconds) - 1;
      if (missing > 0) gaps.push({ from: before + step.milliseconds,
        to: before + missing * step.milliseconds, missing });
    } else {
      const first = moveMonth(before, step.months!);
      if (!Number.isFinite(first) || first >= after) continue;
      const start = new Date(before), end = new Date(after);
      const monthDistance = (end.getUTCFullYear() - start.getUTCFullYear()) * 12
        + end.getUTCMonth() - start.getUTCMonth();
      const missing = Math.max(1, Math.ceil(monthDistance / step.months!) - 1);
      gaps.push({ from: first, to: moveMonth(before, missing * step.months!), missing });
    }
  }
  return gaps;
}

export class HistoryGapError extends Error {
  readonly name = 'HistoryGapError';
  readonly gaps: readonly HistoryGap[];
  constructor(timeframe: string, gaps: readonly HistoryGap[]) {
    const first = gaps[0]!;
    super(`Candle history has an unresolved ${timeframe} gap (${new Date(first.from).toISOString()} – ${new Date(first.to).toISOString()}). Retry history before using complete backtest results.`);
    this.gaps = Object.freeze(gaps.map(gap => Object.freeze({ ...gap })));
  }
}

export function assertHistoryContinuous(bars: readonly Pick<OHLCV, 'time'>[], timeframe: string, calendar: HistoryCalendar = 'utc-month'): void {
  const gaps = historyGaps(bars, timeframe, calendar);
  if (gaps.length) throw new HistoryGapError(timeframe, gaps);
}

/** A constant request budget bounds damaged/illiquid upstream responses. An
 * unfilled interval is an explicit error, including skipped over-budget gaps;
 * an empty re-fetch cannot silently certify a sparse series as complete. */
export async function repairHistoryGaps(
  bars: readonly OHLCV[],
  timeframe: string,
  load: (range: BarRange) => Promise<OHLCV[]>,
  calendar: HistoryCalendar = 'utc-month',
): Promise<OHLCV[]> {
  const gaps = historyGaps(bars, timeframe, calendar);
  if (!gaps.length) return [...bars];
  const byTime = new Map(bars.map(bar => [bar.time, bar]));
  for (const gap of gaps.slice(0, 8)) {
    if (gap.missing > 1_000) continue;
    // A transport/validation error must retain its original identity and reach
    // the normal provider/Workspace Retry path, not become a successful hole.
    const received = await load({ from: gap.from, to: gap.to, limit: gap.missing });
    for (const bar of received) {
      if (bar.time >= gap.from && bar.time <= gap.to) byTime.set(bar.time, bar);
    }
  }
  const repaired = [...byTime.values()].sort((a, b) => a.time - b.time);
  assertHistoryContinuous(repaired, timeframe, calendar);
  return repaired;
}
