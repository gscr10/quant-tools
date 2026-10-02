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

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function rawTrade(trade: Trade): Record<string, unknown> | undefined {
  return trade.raw && typeof trade.raw === 'object'
    ? trade.raw as Record<string, unknown>
    : undefined;
}

function timestampField(trade: Trade, kind: 'entry' | 'exit'): number | null {
  const source = trade as unknown as Record<string, unknown>;
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

function pnlMetrics(rows: readonly Trade[]): TradeAnalysisPnlMetrics {
  const deltas = rows.map(analysisTradePnl);
  const finiteDeltas = deltas.filter((value): value is number => value !== null);
  const winners = finiteDeltas.filter((value) => value > 0);
  const losers = finiteDeltas.filter((value) => value < 0);
  const breakevens = finiteDeltas.filter((value) => value === 0);
  return Object.freeze({
    trades: finiteDeltas.length,
    winningTrades: winners.length,
    losingTrades: losers.length,
    breakevenTrades: breakevens.length,
    winRate: rows.length > 0 ? winners.length / rows.length : null,
    // The reference coerces a missing delta to zero for this row-level mean.
    averageTrade: rows.length > 0
      ? deltas.reduce<number>((total, value) => total + (value ?? 0), 0) / rows.length
      : null,
    averageWinner: average(winners),
    averageLoser: average(losers),
    largestWinner: winners.length > 0 ? Math.max(...winners) : null,
    largestLoser: losers.length > 0 ? Math.min(...losers) : null,
  });
}

function epochMilliseconds(timestamp: number): number {
  return Math.abs(timestamp) >= 100_000_000_000 ? timestamp : timestamp * 1_000;
}

function utcDayBucket(timestamp: number): string | null {
  const date = new Date(epochMilliseconds(timestamp));
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function utcSundayWeekBucket(timestamp: number): string | null {
  const date = new Date(epochMilliseconds(timestamp));
  if (Number.isNaN(date.valueOf())) return null;
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function durationMetrics(
  rows: readonly Trade[],
  timeframe: string | null | undefined,
): TradeAnalysisDurationMetrics {
  const records = rows.map((trade, index) => ({
    trade,
    index,
    delta: analysisTradePnl(trade),
    duration: timestampDurationBars(trade, timeframe),
    exitTime: timestampField(trade, 'exit'),
  }));
  const durations = records
    .map(({ duration }) => duration)
    .filter((value): value is number => value !== null);
  const winningDurations = records
    .filter(({ delta }) => delta !== null && delta > 0)
    .map(({ duration }) => duration)
    .filter((value): value is number => value !== null);
  const losingDurations = records
    .filter(({ delta }) => delta !== null && delta < 0)
    .map(({ duration }) => duration)
    .filter((value): value is number => value !== null);
  const exitTimes = records
    .map(({ exitTime }) => exitTime)
    .filter((value): value is number => value !== null);
  const days = new Set(exitTimes.map(utcDayBucket).filter((value): value is string => value !== null));
  const weeks = new Set(exitTimes.map(utcSundayWeekBucket).filter((value): value is string => value !== null));

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
    averageDurationBars: average(durations),
    averageWinningDurationBars: average(winningDurations),
    averageLosingDurationBars: average(losingDurations),
    averageTradesPerDay: days.size > 0 ? rows.length / days.size : null,
    averageTradesPerWeek: weeks.size > 0 ? rows.length / weeks.size : null,
    longestDurationBars: durations.length > 0 ? Math.max(...durations) : null,
    shortestDurationBars: durations.length > 0 ? Math.min(...durations) : null,
    longestWinningStreakBars: longestWinningStreakBars > 0 ? longestWinningStreakBars : null,
    longestLosingStreakBars: longestLosingStreakBars > 0 ? longestLosingStreakBars : null,
  });
}

function directionMetrics(
  rows: readonly Trade[],
  timeframe: string | null | undefined,
): TradeAnalysisDirectionMetrics {
  return Object.freeze({
    pnl: pnlMetrics(rows),
    duration: durationMetrics(rows, timeframe),
  });
}

/** Exact zero-anchored histogram algorithm captured from the reference app. */
export function createTradeAnalysisHistogram(
  input: readonly number[],
): readonly TradeAnalysisHistogramBin[] {
  const values = input.filter((value) => Number.isFinite(value));
  if (values.length === 0) return Object.freeze([]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const requestedBins = Math.ceil(Math.sqrt(values.length));
  let width = (maximum - minimum) / requestedBins;
  if (!Number.isFinite(width) || width === 0) {
    width = Math.abs(maximum) || Math.abs(minimum) || 1;
  }
  const lower = -Math.ceil(Math.abs(minimum) / width) * width;
  const upper = Math.ceil(maximum / width) * width;
  const binCount = Math.max(1, Math.round((upper - lower) / width));
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of values) {
    const rawIndex = Math.floor((value - lower) / width);
    const index = Math.max(0, Math.min(binCount - 1, rawIndex));
    counts[index] += 1;
  }
  return Object.freeze(counts.map((count, index) => {
    const from = lower + index * width;
    const to = from + width;
    const midpoint = from + width / 2;
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
  const minimumX = Math.min(...points.map((point) => point.durationBars));
  const maximumX = Math.max(...points.map((point) => point.durationBars));
  const firstY = intercept + slope * minimumX;
  const lastY = intercept + slope * maximumX;
  if (![slope, intercept, firstY, lastY].every(Number.isFinite)) return Object.freeze([]);
  return Object.freeze([
    Object.freeze({ x: minimumX, y: firstY }),
    Object.freeze({ x: maximumX, y: lastY }),
  ]);
}

export function calculateTradeAnalysis(report: BacktestReport): TradeAnalysisResult {
  const rows = [...report.analysisRows];
  const timeframe = report.context?.timeframe;
  const longRows = rows.filter((trade) => analysisTradeDirection(trade) === 'long');
  const shortRows = rows.filter((trade) => analysisTradeDirection(trade) === 'short');
  const pnlValues = rows
    .map(analysisTradePnl)
    .filter((value): value is number => value !== null);
  const durationPnl = rows.flatMap((trade): TradeAnalysisScatterPoint[] => {
    const pnl = analysisTradePnl(trade);
    const duration = scatterDurationBars(trade, report);
    if (pnl === null || duration === null) return [];
    const direction = analysisTradeDirection(trade);
    return [{
      durationBars: duration,
      pnl,
      direction,
      exitTime: timestampField(trade, 'exit'),
      // Captured tooltip title is intentionally generic and must not expose a
      // provider/engine trade id or local numbering convention.
      label: 'Trade',
      color: pnl >= 0 ? TRADE_ANALYSIS_PROFIT_COLOR : TRADE_ANALYSIS_LOSS_COLOR,
    }];
  });
  return Object.freeze({
    all: directionMetrics(rows, timeframe),
    long: directionMetrics(longRows, timeframe),
    short: directionMetrics(shortRows, timeframe),
    pnlHistogram: createTradeAnalysisHistogram(pnlValues),
    durationPnl: Object.freeze(durationPnl.map((point) => Object.freeze(point))),
    durationTrend: createDurationTrend(durationPnl),
  });
}
