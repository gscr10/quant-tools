import type { BacktestReport } from './backtest-types.ts';
import type { BacktestExecutionSnapshot } from '../../domain/ports/backtest-results.ts';

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Format full account-currency values for chart/KPI surfaces. Normal-sized
 * amounts keep two fractional digits, while
 * values between -1 and 1 retain up to seven digits (with at least two).
 */
export function formatBacktestCurrency(
  value: number | null | undefined,
  locale = 'en-US',
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  const maximumFractionDigits = magnitude > 0 && magnitude < 1 ? 7 : 2;
  const key = `${locale}:${maximumFractionDigits}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits });
    // Locale is caller-provided. Keep this presentation cache bounded across
    // repeated workspace language changes as well as large table pages.
    if (currencyFormatters.size >= 16) currencyFormatters.delete(currencyFormatters.keys().next().value!);
    currencyFormatters.set(key, formatter);
  }
  return formatter.format(normalized);
}

const performanceWholeFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const performanceFractionFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 7 });
const performanceDrawdownFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** The reference Performance table preserves sub-unit values and compacts
 * millions. Keep this display policy separate from chart/KPI formatting and
 * from numeric report values used for calculations or export. */
export function formatBacktestPerformanceValue(
  value: number | null | undefined,
  kind: 'value' | 'ratio' | 'drawdown-percent' = 'value',
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  if (kind === 'ratio') return normalized.toFixed(3);
  if (magnitude >= 1_000_000) return `${(normalized / 1_000_000).toFixed(1)}M`;
  if (magnitude !== 0 && magnitude < 1e-7) return normalized.toExponential(2);
  if (kind === 'drawdown-percent') return performanceDrawdownFormatter.format(normalized);
  return (magnitude >= 1 || magnitude === 0 ? performanceWholeFormatter : performanceFractionFormatter).format(normalized);
}

/**
 * A compact, truthful description of the broker precision used for a report.
 *
 * This is deliberately presentation-only: the adapter/domain metadata remains
 * the source of truth and the formatter never infers precision from strategy
 * properties or from the presence of lower-timeframe rows.
 */
export interface ExecutionPrecisionDisplay {
  readonly text: string;
  readonly detail: string;
  readonly fallback: boolean;
  /** Stable engine code retained for diagnostics and machine-readable UI state. */
  readonly fallbackReason?: string;
}

type ExecutionPrecision = NonNullable<BacktestExecutionSnapshot['precision']>;

const EXECUTION_PRECISION_LABELS: Readonly<Record<ExecutionPrecision['requestedPrecision'], string>> = {
  'chart-ohlc': 'Chart OHLC',
  'lower-timeframe': 'Lower timeframe',
  tick: 'Tick',
};

const EXECUTION_PRECISION_SHORT_LABELS: Readonly<Record<ExecutionPrecision['requestedPrecision'], string>> = {
  'chart-ohlc': 'OHLC',
  'lower-timeframe': 'LTF',
  tick: 'Tick',
};

/** Human-readable labels for the stable PineTS fallback reason codes. */
const FALLBACK_REASON_LABELS: Readonly<Record<string, string>> = {
  'not-requested': 'not requested',
  'live-mode-not-supported': 'live mode unsupported',
  'lower-timeframe-undetermined': 'no supported lower timeframe',
  'lower-data-unavailable': 'lower data unavailable',
  'lower-data-empty': 'lower data empty',
  'invalid-parent-bars': 'invalid parent bars',
  'duplicate-parent-bars': 'duplicate parent bars',
  'overlapping-parent-bars': 'overlapping parent bars',
  'invalid-lower-bars': 'invalid lower bars',
  'duplicate-lower-bars': 'duplicate lower bars',
  'overlapping-lower-bars': 'overlapping lower bars',
  'gapped-lower-bars': 'gapped lower bars',
  'out-of-range-lower-bars': 'lower bars out of range',
  'partial-lower-coverage': 'partial lower coverage',
  'forming-lower-bar': 'lower bar still forming',
};

function fallbackReasonLabel(reason: string): string {
  const known = FALLBACK_REASON_LABELS[reason];
  if (known) return known;
  return reason.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'unknown reason';
}

function precisionCoverage(coverage: number): string {
  if (!Number.isFinite(coverage)) return '—';
  const bounded = Math.max(0, Math.min(1, coverage));
  const percentage = Math.round(bounded * 1_000) / 10;
  return `${Number.isInteger(percentage) ? percentage.toFixed(0) : percentage.toFixed(1)}%`;
}

/** Format execution precision for the existing Dock/Viewer header line. */
export function formatExecutionPrecision(
  precision: BacktestExecutionSnapshot['precision'] | undefined,
): ExecutionPrecisionDisplay | null {
  if (!precision) return null;
  const requestedLabel = EXECUTION_PRECISION_LABELS[precision.requestedPrecision] ?? precision.requestedPrecision;
  const appliedLabel = EXECUTION_PRECISION_LABELS[precision.appliedPrecision] ?? precision.appliedPrecision;
  const requestedShort = EXECUTION_PRECISION_SHORT_LABELS[precision.requestedPrecision] ?? precision.requestedPrecision;
  const appliedShort = EXECUTION_PRECISION_SHORT_LABELS[precision.appliedPrecision] ?? precision.appliedPrecision;
  const lowerTimeframe = precision.lowerTimeframe?.trim();
  const coverage = precisionCoverage(precision.coverage);
  const fallback = precision.requested && !precision.applied;
  const fallbackReason = precision.fallbackReason?.trim() || '';
  const fallbackLabel = fallbackReason ? fallbackReasonLabel(fallbackReason) : '';

  // Keep the visible text short enough to coexist with the existing date range;
  // the title/ARIA detail below carries the complete auditable envelope. The
  // default chart-OHLC mode stays out of the visible date line to preserve the
  // reference header pixels, while remaining discoverable through detail and
  // data attributes.
  const text = precision.requested
    ? `${requestedShort} → ${appliedShort}${lowerTimeframe ? ` ${lowerTimeframe}` : ''} · ${coverage}${fallbackLabel ? ` · ${fallbackLabel}` : fallback ? ' · fallback' : ''}`
    : '';
  const lowerDetail = lowerTimeframe || 'not provided';
  const detail = [
    `Execution precision: requested ${precision.requested ? requestedLabel : `${requestedLabel} (not requested)`}`,
    `applied ${appliedLabel}`,
    `lower timeframe ${lowerDetail}`,
    `coverage ${coverage} (${precision.coveredParentBars}/${precision.parentBars} parent bars; ${precision.lowerBars} lower bars)`,
    `fallback ${fallback ? (fallbackLabel || 'unspecified') : 'none'}${fallback && fallbackReason && fallbackLabel !== fallbackReason ? ` [${fallbackReason}]` : ''}`,
  ].join('; ');
  return Object.freeze({
    text,
    detail,
    fallback,
    ...(fallbackReason ? { fallbackReason } : {}),
  });
}

function parseReportDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** Format the activity label identically in the summary Dock and full Viewer.
 * Keep the loaded report range available to history/navigation consumers. */
export function formatBacktestRange(report: Pick<BacktestReport, 'range' | 'activityRange' | 'window'>): string {
  // An explicit calculation window is the user's requested report boundary,
  // even when its first/last trade occurred well inside it (or no trades ran).
  const range = report.window
    ? { from: report.window.from, to: report.window.to }
    : report.activityRange === undefined ? report.range : report.activityRange;
  if (range?.label) return range.label;
  const from = parseReportDate(range?.from);
  const to = parseReportDate(range?.to);
  if (!from && !to) return '';
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const full = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (from && to) {
    const fromYear = from.getUTCFullYear();
    const toYear = to.getUTCFullYear();
    return fromYear === toYear
      ? `${monthDay.format(from)} - ${monthDay.format(to)}, ${toYear}`
      : `${full.format(from)} - ${full.format(to)}`;
  }
  const single = from ?? to;
  return single ? full.format(single) : '';
}
