/**
 * Pure selectors for the reference Trades Analysis workspace.
 *
 * The reference page intentionally treats its visible open/current row as a
 * zero-P&L compatibility row.  That projection lives only in this module: it
 * must never change the canonical closed/open populations used by Summary,
 * Calendar, Trade Log, or Simulation.
 */

import {
  isTradeOpen,
  tradeDirection,
  tradeNetPnl,
  type BacktestReport,
  type Trade,
  type TradeDirection,
} from './backtesting.ts';

export const TRADE_ANALYSIS_PROFIT_COLOR = '#089981';
export const TRADE_ANALYSIS_LOSS_COLOR = '#f23645';
export const TRADE_ANALYSIS_BREAKEVEN_COLOR = '#ff9800';
export const TRADE_ANALYSIS_NEUTRAL_COLOR = '#71717a';

export const TRADE_ANALYSIS_COMPARISON_KEYS = [
  'trades',
  'winningTrades',
  'losingTrades',
  'breakevenTrades',
  'winRate',
  'averageTrade',
  'averageWinner',
  'averageLoser',
  'largestWinner',
  'largestLoser',
] as const;

export const TRADE_ANALYSIS_DURATION_KEYS = [
  'averageDurationBars',
  'averageWinningDurationBars',
  'averageLosingDurationBars',
  'averageTradesPerDay',
  'averageTradesPerWeek',
  'longestDurationBars',
  'shortestDurationBars',
  'longestWinningStreakBars',
  'longestLosingStreakBars',
] as const;

export interface TradeAnalysisPnlMetrics {
  /** Reference label: Closed Trades. Includes the projected current row. */
  readonly trades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakevenTrades: number;
  /** Ratio in [0, 1]; the UI adapter converts it to percentage points. */
  readonly winRate: number | null;
  readonly averageTrade: number | null;
  readonly averageWinner: number | null;
  readonly averageLoser: number | null;
  readonly largestWinner: number | null;
  readonly largestLoser: number | null;
}

export interface TradeAnalysisDurationMetrics {
  readonly averageDurationBars: number | null;
  readonly averageWinningDurationBars: number | null;
  readonly averageLosingDurationBars: number | null;
  readonly averageTradesPerDay: number | null;
  readonly averageTradesPerWeek: number | null;
  readonly longestDurationBars: number | null;
  readonly shortestDurationBars: number | null;
  readonly longestWinningStreakBars: number | null;
  readonly longestLosingStreakBars: number | null;
}

export interface TradeAnalysisDirectionMetrics {
  readonly pnl: TradeAnalysisPnlMetrics;
  readonly duration: TradeAnalysisDurationMetrics;
}

export interface TradeAnalysisHistogramBin {
  readonly midpoint: number;
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly color: string;
}

export interface TradeAnalysisScatterPoint {
  readonly durationBars: number;
  readonly pnl: number;
  readonly direction: TradeDirection;
  readonly exitTime: number | null;
  readonly label: string;
  readonly color: string;
}

export interface TradeAnalysisTrendPoint {
  readonly x: number;
  readonly y: number;
}

export interface TradeAnalysisResult {
  readonly all: TradeAnalysisDirectionMetrics;
  readonly long: TradeAnalysisDirectionMetrics;
  readonly short: TradeAnalysisDirectionMetrics;
  readonly pnlHistogram: readonly TradeAnalysisHistogramBin[];
  readonly durationPnl: readonly TradeAnalysisScatterPoint[];
  /** OLS trend represented by its min/max-x endpoints. */
  readonly durationTrend: readonly TradeAnalysisTrendPoint[];
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? (Object.is(value, -0) ? 0 : value)
    : null;
}

function rawTrade(trade: Trade): Record<string, unknown> | undefined {
  return trade.raw && typeof trade.raw === 'object'
    ? trade.raw as Record<string, unknown>
    : undefined;
}

function timestampField(trade: Trade, kind: 'entry' | 'exit'): number | null {
  const source = trade as unknown as Record<string, unknown>;
  const direct = finite(kind === 'entry' ? source.entryTime : source.exitTime);
  if (direct !== null && direct > 0) return direct;
  const raw = rawTrade(trade);
  const candidates = kind === 'entry'
    ? [
      source.entryTime,
      source.openedTimestamp,
      source.opened_at_timestamp,
      source.opened_at,
      raw?.entryTime,
      raw?.openedTimestamp,
      raw?.opened_at_timestamp,
      raw?.opened_at,
    ]
    : [
      source.exitTime,
      source.closedTimestamp,
      source.closed_at_timestamp,
      source.closed_at,
      raw?.exitTime,
      raw?.closedTimestamp,
      raw?.closed_at_timestamp,
      raw?.closed_at,
    ];
  for (const candidate of candidates) {
    const value = finite(candidate);
    if (value !== null && value > 0) return value;
  }
  return null;
}

/** Reference direction resolver: `direction ?? position`. */
export function analysisTradeDirection(trade: Trade): TradeDirection {
  const source = trade as unknown as Record<string, unknown>;
  const raw = rawTrade(trade);
  const candidate = raw?.direction
    ?? raw?.position
    ?? source.position
    ?? source.direction;
  const normalized = String(candidate ?? '').trim().toLowerCase();
  if (normalized === 'short' || normalized === 'sell' || normalized === '-1') return 'short';
  if (normalized === 'long' || normalized === 'buy' || normalized === '1') return 'long';
  return tradeDirection(trade);
}

/**
 * Reference-only P&L projection. An open row is represented as a closed,
 * zero-P&L/breakeven row by Trades Analysis even though the domain continues
 * to retain `status: open` and `exitTime: null`.
 */
export function analysisTradePnl(trade: Trade): number | null {
  const source = trade as unknown as Record<string, unknown>;
  const raw = rawTrade(trade);
  // An explicitly present delta (including null) is authoritative for the
  // captured reference row. Local Vela ledgers have no delta and fall back to
  // the provider-neutral P&L resolver.
  if (Object.prototype.hasOwnProperty.call(source, 'delta')) return finite(source.delta);
  if (raw && Object.prototype.hasOwnProperty.call(raw, 'delta')) return finite(raw.delta);
  if (isTradeOpen(trade) && timestampField(trade, 'exit') === null) return 0;
  return finite(tradeNetPnl(trade));
}

/** Parse Vela/Pine/Binance timeframe spellings into minutes. */
export function timeframeMinutes(timeframe: string | null | undefined): number | null {
  const text = String(timeframe ?? '').trim();
  if (!text) return null;

  if (text === 'D') return 24 * 60;
  if (text === 'W') return 7 * 24 * 60;
  if (text === 'M') return 30 * 24 * 60;

  // Pine's canonical minute timeframes are bare numbers. Preserve the case of
  // M because Pine/Binance use it for an approximate calendar month.
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const value = Number(text);
    return value > 0 && Number.isFinite(value) ? value : null;
  }

  const match = /^(\d+(?:\.\d+)?)([a-zA-Z]+)$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const rawUnit = match[2];
  if (rawUnit === 'M') return value * 30 * 24 * 60;
  switch (rawUnit.toLowerCase()) {
    case 's':
    case 'sec':
    case 'second':
    case 'seconds':
      return value / 60;
    case 'm':
    case 'min':
    case 'minute':
    case 'minutes':
      return value;
    case 'h':
    case 'hr':
    case 'hour':
    case 'hours':
      return value * 60;
    case 'd':
    case 'day':
    case 'days':
      return value * 24 * 60;
    case 'w':
    case 'week':
    case 'weeks':
      return value * 7 * 24 * 60;
    case 'mo':
    case 'month':
    case 'months':
      return value * 30 * 24 * 60;
    default:
      return null;
  }
}

function timestampScale(entryTime: number, exitTime: number): number {
  // The local PineTS bridge emits epoch milliseconds. The captured reference
  // payload uses epoch seconds. Domain adapters are allowed to normalize
  // either representation, so use the epoch magnitude to retain both.
  return Math.max(Math.abs(entryTime), Math.abs(exitTime)) >= 100_000_000_000
    ? 1_000
    : 1;
}

/**
 * Duration contract shared by the duration table and timestamp fallback of
 * the scatter plot. It is deliberately non-inclusive: unlike the older local
 * KPI, no `+ 1` bar is applied to a timestamp difference.
 */
export function timestampDurationBars(
  trade: Trade,
  timeframe: string | null | undefined,
): number | null {
  const entry = timestampField(trade, 'entry');
  const exit = timestampField(trade, 'exit');
  const minutes = timeframeMinutes(timeframe);
  return durationFromTimestamps(entry, exit, minutes);
}

function durationFromTimestamps(entry: number | null, exit: number | null, minutes: number | null): number | null {
  if (entry === null || exit === null || minutes === null) return null;
  const differenceSeconds = (exit - entry) / timestampScale(entry, exit);
  if (!Number.isFinite(differenceSeconds) || differenceSeconds <= 0) return null;
  return Math.max(1, differenceSeconds / 60 / minutes);
}

function explicitDurationBars(trade: Trade): number | null {
  const source = trade as unknown as Record<string, unknown>;
  const raw = rawTrade(trade);
  return finite(source.duration_bars)
    ?? finite(source.durationBars)
    ?? finite(raw?.duration_bars)
    ?? finite(raw?.durationBars);
}

/**
 * Scatter duration follows the reference's exact two-step resolver: prefer
 * explicit `duration_bars`, then derive bars from timestamps/timeframe. The
 * local exact bar-index capability belongs to chart location and other domain
 * metrics; inserting its inclusive `+1` duration here would change the
 * reference Analysis scatter and its OLS trend.
 */
export function scatterDurationBars(
  trade: Trade,
  report: Pick<BacktestReport, 'context'>,
): number | null {
  const explicit = explicitDurationBars(trade);
  if (explicit !== null) return explicit;
  return timestampDurationBars(trade, report.context?.timeframe);
}

interface AnalysisRecord {
  readonly index: number;
  readonly delta: number | null;
  readonly duration: number | null;
  readonly exitTime: number | null;
}

function pnlMetrics(rows: readonly AnalysisRecord[]): TradeAnalysisPnlMetrics {
  let count = 0;
  let winners = 0;
  let losers = 0;
  let breakevens = 0;
  let total = 0;
  let positive = 0;
  let negative = 0;
  let largestWinner: number | null = null;
  let largestLoser: number | null = null;
  for (const { delta } of rows) {
    if (delta === null) continue;
    count += 1;
    total += delta;
    if (delta > 0) {
      winners += 1;
      positive += delta;
      largestWinner = largestWinner === null ? delta : Math.max(largestWinner, delta);
    } else if (delta < 0) {
      losers += 1;
      negative += delta;
      largestLoser = largestLoser === null ? delta : Math.min(largestLoser, delta);
    } else breakevens += 1;
  }
  return Object.freeze({
    trades: count,
    winningTrades: winners,
    losingTrades: losers,
    breakevenTrades: breakevens,
    winRate: rows.length > 0 ? winners / rows.length : null,
    // The reference coerces a missing delta to zero for this row-level mean.
    averageTrade: rows.length > 0
      ? total / rows.length
      : null,
    averageWinner: winners > 0 ? positive / winners : null,
    averageLoser: losers > 0 ? negative / losers : null,
    largestWinner,
    largestLoser,
  });
}

function epochMilliseconds(timestamp: number): number {
  return Math.abs(timestamp) >= 100_000_000_000 ? timestamp : timestamp * 1_000;
}

function utcDayBucket(timestamp: number): number | null {
  const epoch = epochMilliseconds(timestamp);
  // These buckets are used only for distinct-day/week counts, never labels.
  // An integer UTC day preserves the Date range and boundary semantics
  // without allocating Date/ISO strings for every direction of a large ledger.
  return Number.isFinite(epoch) && Math.abs(epoch) <= 8.64e15
    ? Math.floor(epoch / 86_400_000)
    : null;
}

function durationMetrics(
  records: readonly AnalysisRecord[],
): TradeAnalysisDurationMetrics {
  let durationCount = 0;
  let durationSum = 0;
  let winningCount = 0;
  let winningSum = 0;
  let losingCount = 0;
  let losingSum = 0;
  let longestDurationBars: number | null = null;
  let shortestDurationBars: number | null = null;
  const days = new Set<number>();
  const weeks = new Set<number>();
  for (const { duration, delta, exitTime } of records) {
    if (duration !== null) {
      durationCount += 1;
      durationSum += duration;
      longestDurationBars = longestDurationBars === null ? duration : Math.max(longestDurationBars, duration);
      shortestDurationBars = shortestDurationBars === null ? duration : Math.min(shortestDurationBars, duration);
      if (delta !== null && delta > 0) { winningCount += 1; winningSum += duration; }
      if (delta !== null && delta < 0) { losingCount += 1; losingSum += duration; }
    }
    const day = exitTime === null ? null : utcDayBucket(exitTime);
    if (day !== null) {
      days.add(day);
      // Epoch day zero is Thursday; Sunday starts the next week.
      weeks.add(Math.floor((day + 4) / 7));
    }
  }

  // Invalid/missing exits sort after finite exits. The original input index is
  // the deterministic tie-break and keeps equal-timestamp rows stable.
  const ordered = [...records].sort((left, right) => {
    if (left.exitTime === null && right.exitTime === null) return left.index - right.index;
    if (left.exitTime === null) return 1;
    if (right.exitTime === null) return -1;
    return left.exitTime - right.exitTime || left.index - right.index;
  });
  let currentWinningBars = 0;
  let currentLosingBars = 0;
  let longestWinningStreakBars = 0;
  let longestLosingStreakBars = 0;
  for (const record of ordered) {
    if (record.duration === null || record.delta === null || record.exitTime === null) {
      currentWinningBars = 0;
      currentLosingBars = 0;
      continue;
    }
    if (record.delta > 0) {
      currentWinningBars += record.duration;
      currentLosingBars = 0;
    } else {
      // Reference compatibility: breakeven belongs to the losing streak.
      currentLosingBars += record.duration;
      currentWinningBars = 0;
    }
    longestWinningStreakBars = Math.max(longestWinningStreakBars, currentWinningBars);
    longestLosingStreakBars = Math.max(longestLosingStreakBars, currentLosingBars);
  }

  return Object.freeze({
    averageDurationBars: durationCount > 0 ? durationSum / durationCount : null,
    averageWinningDurationBars: winningCount > 0 ? winningSum / winningCount : null,
    averageLosingDurationBars: losingCount > 0 ? losingSum / losingCount : null,
    averageTradesPerDay: days.size > 0 ? records.length / days.size : null,
    averageTradesPerWeek: weeks.size > 0 ? records.length / weeks.size : null,
    longestDurationBars,
    shortestDurationBars,
    longestWinningStreakBars: longestWinningStreakBars > 0 ? longestWinningStreakBars : null,
    longestLosingStreakBars: longestLosingStreakBars > 0 ? longestLosingStreakBars : null,
  });
}

function directionMetrics(
  rows: readonly AnalysisRecord[],
): TradeAnalysisDirectionMetrics {
  return Object.freeze({
    pnl: pnlMetrics(rows),
    duration: durationMetrics(rows),
  });
}

/** Reference zero-anchored buckets with a bounded allocation for nearly equal
 * floating-point P&Ls. A tiny observed spread must not allocate trillions of
 * empty buckets between zero and an otherwise ordinary trade profit. */
export function createTradeAnalysisHistogram(
  input: readonly number[],
): readonly TradeAnalysisHistogramBin[] {
  const values = input.filter((value) => Number.isFinite(value));
  if (values.length === 0) return Object.freeze([]);
  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  const requestedBins = Math.ceil(Math.sqrt(values.length));
  let width = (maximum - minimum) / requestedBins;
  if (!Number.isFinite(width) || width === 0) {
    width = Math.abs(maximum) || Math.abs(minimum) || 1;
  }
  const estimatedBins = Math.ceil(maximum / width) + Math.ceil(Math.abs(minimum) / width);
  const magnitude = Math.max(Math.abs(minimum), Math.abs(maximum));
  if (!Number.isFinite(estimatedBins) || estimatedBins > 256 || magnitude / width > 1e9) {
    // Large absolute bucket indices lose integer precision even when an
    // all-negative cluster needs only a few bins. Widen that case too.
    const wider = magnitude / Math.max(1, Math.min(128, requestedBins)) * (1 + 2 * Number.EPSILON);
    width = Number.isFinite(wider) && wider > 0 ? wider : magnitude || 1;
  }
  // Work in integer bucket coordinates so two finite extreme endpoints do
  // not overflow while subtracting their absolute monetary values.
  const lowerIndex = -Math.ceil(Math.abs(minimum) / width);
  const upperIndex = Math.ceil(maximum / width);
  const binCount = Math.max(1, Math.min(256, upperIndex - lowerIndex));
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of values) {
    const rawIndex = Math.floor(value / width - lowerIndex);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    counts[index] += 1;
  }
  return Object.freeze(counts.map((count, index) => {
    const bound = (value: number): number => Math.max(-Number.MAX_VALUE, Math.min(Number.MAX_VALUE, value));
    const from = bound((lowerIndex + index) * width);
    const to = bound((lowerIndex + index + 1) * width);
    const midpoint = from / 2 + to / 2;
    return Object.freeze({
      midpoint,
      from,
      to,
      count,
      color: midpoint >= 0 ? TRADE_ANALYSIS_PROFIT_COLOR : TRADE_ANALYSIS_LOSS_COLOR,
    });
  }));
}

/**
 * Ordinary least-squares regression for Duration vs P&L. A line cannot be
 * identified from fewer than two finite points or from zero x variance.
 */
export function createDurationTrend(
  input: readonly Pick<TradeAnalysisScatterPoint, 'durationBars' | 'pnl'>[],
): readonly TradeAnalysisTrendPoint[] {
  const points = input.filter(({ durationBars, pnl }) => (
    Number.isFinite(durationBars) && Number.isFinite(pnl)
  ));
  if (points.length < 2) return Object.freeze([]);
  const meanX = points.reduce((total, point) => total + point.durationBars, 0) / points.length;
  const meanY = points.reduce((total, point) => total + point.pnl, 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const deltaX = point.durationBars - meanX;
    covariance += deltaX * (point.pnl - meanY);
    variance += deltaX * deltaX;
  }
  if (!Number.isFinite(variance) || variance <= 0) return Object.freeze([]);
  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  for (const point of points) {
    minimumX = Math.min(minimumX, point.durationBars);
    maximumX = Math.max(maximumX, point.durationBars);
  }
  const firstY = intercept + slope * minimumX;
  const lastY = intercept + slope * maximumX;
  if (![slope, intercept, firstY, lastY].every(Number.isFinite)) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ x: minimumX, y: firstY }),
    Object.freeze({ x: maximumX, y: lastY }),
  ]);
}

export function calculateTradeAnalysis(report: BacktestReport): TradeAnalysisResult {
  const minutes = timeframeMinutes(report.context?.timeframe);
  const rows: AnalysisRecord[] = [];
  const longRows: AnalysisRecord[] = [];
  const shortRows: AnalysisRecord[] = [];
  const pnlValues: number[] = [];
  const durationPnl: TradeAnalysisScatterPoint[] = [];
  // Resolve each row once. All/Long/Short share the same immutable record,
  // including raw reference aliases and the open-row compatibility projection.
  // Parsing the timeframe and timestamps again in each table/plot direction
  // otherwise dominates a 100k ledger's first aggregate.
  for (const trade of report.analysisRows) {
    const pnl = analysisTradePnl(trade);
    const exitTime = timestampField(trade, 'exit');
    const timestampDuration = durationFromTimestamps(timestampField(trade, 'entry'), exitTime, minutes);
    const duration = explicitDurationBars(trade) ?? timestampDuration;
    const direction = analysisTradeDirection(trade);
    const record = { index: rows.length, delta: pnl, duration: timestampDuration, exitTime };
    rows.push(record);
    if (direction === 'long') longRows.push(record);
    if (direction === 'short') shortRows.push(record);
    if (pnl !== null) pnlValues.push(pnl);
    if (pnl === null || duration === null) continue;
    durationPnl.push(Object.freeze({
      durationBars: duration,
      pnl,
      direction,
      exitTime,
      // Captured tooltip title is intentionally generic and must not expose a
      // provider/engine trade id or local numbering convention.
      label: 'Trade',
      color: pnl >= 0 ? TRADE_ANALYSIS_PROFIT_COLOR : TRADE_ANALYSIS_LOSS_COLOR,
    }));
  }
  return Object.freeze({
    all: directionMetrics(rows),
    long: directionMetrics(longRows),
    short: directionMetrics(shortRows),
    pnlHistogram: createTradeAnalysisHistogram(pnlValues),
    durationPnl: Object.freeze(durationPnl),
    durationTrend: createDurationTrend(durationPnl),
  });
}
