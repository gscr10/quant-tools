import type { BacktestTrade } from './backtest-types.ts';

export type BacktestTradeSortKey =
  | 'number'
  | 'entryTime'
  | 'exitTime'
  | 'size'
  | 'netPnl'
  | 'mfe'
  | 'mae'
  | 'cumulativePnl';

export interface BacktestTradeSort {
  key: BacktestTradeSortKey;
  direction: 1 | -1;
}

/**
 * A sorted ledger row together with its original source position.  Keeping
 * the position beside the row is important for large logs: the Viewer only
 * renders one page, but it still needs a deterministic fallback Trade # when
 * the engine did not publish a number.  Carrying the index through the sort
 * avoids rebuilding a 100k-entry Map on every page/sort render and also keeps
 * duplicate object references unambiguous.
 */
export interface BacktestTradeEntry {
  readonly trade: BacktestTrade;
  readonly sourceIndex: number;
}

/**
 * The bounded portion of a sorted ledger that is allowed into the DOM.
 *
 * A report may contain tens of thousands of trades, but the Trades Log should
 * never materialize the complete ledger as table rows. Keeping this window
 * contract next to the stable sort makes the memory/DOM bound testable without
 * booting the Viewer and leaves the original source index available for
 * deterministic Trade # fallbacks and chart-location actions.
 */
export interface BacktestTradeWindow {
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly start: number;
  readonly end: number;
  readonly entries: readonly BacktestTradeEntry[];
}

/** Hard DOM safety ceiling; callers may request a smaller page for fixtures. */
export const MAX_BACKTEST_TRADE_PAGE_SIZE = 200;

/** Return one bounded page from an already sorted ledger. */
export function getBacktestTradeWindow(
  sorted: readonly BacktestTradeEntry[],
  requestedPage: number,
  requestedPageSize = 200,
): BacktestTradeWindow {
  const pageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
    ? Math.min(MAX_BACKTEST_TRADE_PAGE_SIZE, requestedPageSize)
    : MAX_BACKTEST_TRADE_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Number.isSafeInteger(requestedPage)
    ? Math.min(totalPages - 1, Math.max(0, requestedPage))
    : 0;
  const start = page * pageSize;
  const end = Math.min(sorted.length, start + pageSize);
  return {
    page,
    pageSize,
    totalPages,
    start,
    end,
    entries: sorted.slice(start, end),
  };
}

/** The reference log opens in Trade # descending order. */
export const DEFAULT_TRADE_SORT: Readonly<BacktestTradeSort> = Object.freeze({
  key: 'number',
  direction: -1,
});

/** The reference starts every newly selected sort key descending. Repeated
 * activation toggles the active direction. */
export function nextBacktestTradeSort(
  current: BacktestTradeSort,
  key: BacktestTradeSortKey,
): BacktestTradeSort {
  if (current.key === key) {
    return { key, direction: current.direction === 1 ? -1 : 1 };
  }
  return { key, direction: -1 };
}

type SortValue = number | string | null;

// NumberFormat construction is surprisingly expensive in a large Trades Log:
// a 200-row page can format more than a thousand cells.  These formatters are
// immutable and preserve the exact `en-US` grouping/precision contract while
// avoiding one Intl allocation per cell.
const TRADE_TWO_DECIMAL_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const TRADE_SEVEN_DECIMAL_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 7,
});

export function backtestTradeDisplayNumber(
  trade: BacktestTrade,
  sourceIndex: number,
): string | number {
  const raw = trade.number;
  return raw === null || raw === undefined || raw === '' ? sourceIndex + 1 : raw;
}

function tradeSortValue(
  trade: BacktestTrade,
  key: BacktestTradeSortKey,
  sourceIndex: number,
): SortValue {
  if (key === 'number') {
    const raw = backtestTradeDisplayNumber(trade, sourceIndex);
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : String(raw);
  }
  if (key === 'size') return backtestTradeSizeValue(trade.size) ?? 0;
  if (key === 'mfe' || key === 'mae') {
    const value = trade[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  if (key === 'cumulativePnl') {
    const value = trade.cumulativePnl;
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
  if (key === 'netPnl') {
    const value = trade.netPnl;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return value;
  }
  const raw = key === 'entryTime' ? trade.entryTime : trade.exitTime;
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function backtestTradeSizeValue(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.abs(value) : null;
}

export function backtestTradesHaveSize(trades: readonly BacktestTrade[]): boolean {
  return trades.some((trade) => {
    const value = backtestTradeSizeValue(trade.size);
    return value !== null && value !== 0;
  });
}

export function backtestTradesHaveExcursions(trades: readonly BacktestTrade[]): boolean {
  return trades.some((trade) => (
    (typeof trade.mfe === 'number' && Number.isFinite(trade.mfe))
    || (typeof trade.mae === 'number' && Number.isFinite(trade.mae))
  ));
}

export function isBacktestTradeLocationTime(
  value: number | string | null | undefined,
): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0;
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized) return false;
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric > 0;
  return Number.isFinite(Date.parse(normalized));
}

/** Reference precision for Entry/Exit prices. */
export function backtestTradePriceDigits(value: number): 2 | 4 | 5 | 8 {
  const magnitude = Math.abs(value);
  if (magnitude >= 10_000) return 2;
  if (magnitude >= 100) return 4;
  if (magnitude >= 1) return 5;
  return 8;
}

/** Exact value formatter used by the reference Trades Log.  This is
 * intentionally distinct from price precision and the compact K/M/B/T
 * formatter used by other report surfaces. */
export function formatBacktestTradeValue(
  value: number | null | undefined,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  if (magnitude >= 1_000_000) return `${(normalized / 1_000_000).toFixed(1)}M`;
  if (magnitude >= 1 || normalized === 0) {
    return TRADE_TWO_DECIMAL_FORMATTER.format(normalized);
  }
  if (magnitude < 1e-7) return normalized.toExponential(2);
  return TRADE_SEVEN_DECIMAL_FORMATTER.format(normalized);
}

export function formatBacktestTradeMetric(
  value: number | null | undefined,
  currency?: string,
  signed = false,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = signed && normalized >= 0 ? '+' : '';
  const suffix = currency ? ` ${currency}` : '';
  return `${sign}${formatBacktestTradeValue(normalized)}${suffix}`;
}

/** Pine exposes MAE as a positive drawdown magnitude; the log presents it as
 * an adverse (negative) currency amount. MFE retains its source sign. */
export function backtestTradeExcursionValue(
  kind: 'mfe' | 'mae',
  value: number | null | undefined,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return kind === 'mae' ? -Math.abs(value) : value;
}

function compareSortValues(left: SortValue, right: SortValue, direction: 1 | -1): number {
  // Defensive null ordering is retained for malformed trade numbers and
  // missing Net P&L. Reference-normalized times and other metrics use zero.
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  if (typeof left === 'number' && typeof right === 'number') {
    return (left - right) * direction;
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  }) * direction;
}

/** Stable, deterministic ordering for the Trades Log and pure unit tests. */
export function sortBacktestTrades(
  trades: readonly BacktestTrade[],
  sort: BacktestTradeSort = DEFAULT_TRADE_SORT,
): BacktestTrade[] {
  return sortBacktestTradeEntries(trades, sort).map(({ trade }) => trade);
}

/** The reference retains its Trade # descending order when another column
 * has equal values. Keep source order only for genuinely duplicate numbers. */
export function sortBacktestTradeEntries(
  trades: readonly BacktestTrade[],
  sort: BacktestTradeSort = DEFAULT_TRADE_SORT,
): BacktestTradeEntry[] {
  return trades
    .map((trade, sourceIndex) => ({ trade, sourceIndex }))
    .sort((left, right) => (
      compareSortValues(
        tradeSortValue(left.trade, sort.key, left.sourceIndex),
        tradeSortValue(right.trade, sort.key, right.sourceIndex),
        sort.direction,
      ) || (sort.key === 'number' ? 0 : compareSortValues(
        tradeSortValue(left.trade, 'number', left.sourceIndex),
        tradeSortValue(right.trade, 'number', right.sourceIndex),
        -1,
      )) || left.sourceIndex - right.sourceIndex
    ))
}
