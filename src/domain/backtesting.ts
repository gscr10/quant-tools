/**
 * Framework-independent backtesting domain contracts.
 *
 * This module intentionally contains no Vela, PineTS, DOM, or storage imports.
 * Adapters may map a provider's result into these contracts and the rest of the
 * application can then consume an immutable, provider-neutral report.
 */

import type { BacktestSettingsSnapshot } from './ports/backtest-settings.ts';
import type { BacktestExecutionSnapshot } from './ports/backtest-results.ts';
import type { BacktestResolvedWindow } from './ports/backtest-window.ts';

export const BACKTEST_SCHEMA_VERSION = 1 as const;

// Only arrays produced by our recursively copied/frozen report factory are
// trusted. Object.isFrozen(array) alone says nothing about mutable elements,
// getters or nested provider fields and must never authorize memoization.
const immutableReportLedgers = new WeakSet<readonly unknown[]>();
const immutableReports = new WeakSet<object>();
const ownedImmutableDtos = new WeakSet<object>();
const reportPopulationCache = new WeakMap<readonly unknown[], {
  readonly epsilon: number;
  readonly includeOpen: boolean;
  readonly value: TradePopulations;
}>();

export type BacktestStatus =
  | 'waiting-data'
  | 'compiling'
  | 'computing'
  | 'updating'
  | 'ready'
  | 'suspended'
  | 'no-data'
  | 'no-trades'
  | 'open-only'
  | 'partial'
  | 'error';

/** Structured, provider-neutral error metadata retained across app layers. */
export interface BacktestError {
  readonly message: string;
  readonly name?: string;
  readonly kind?: 'pine-runtime' | 'provider' | 'worker' | 'compile' | 'unknown';
  readonly method?: string;
  readonly code?: string;
  readonly provider?: string;
  readonly status?: number;
  readonly timeoutMs?: number;
  readonly url?: string;
  readonly retryable?: boolean;
  /** A non-serializable cause may be retained for in-process diagnostics only. */
  readonly cause?: unknown;
}

export type BacktestFinality =
  | 'historical-final'
  | 'live-provisional'
  | 'partial-history'
  | 'unknown';

export interface BacktestKey {
  readonly cellId: string;
  readonly indicatorId: string;
}

/** A stable map key which cannot collide when either component contains `:`. */
export function backtestKeyId(key: BacktestKey): string {
  return `${encodeURIComponent(key.cellId)}::${encodeURIComponent(key.indicatorId)}`;
}

export type TradeDirection = 'long' | 'short' | 'unknown';
export type PositionSide = 'flat' | 'long' | 'short';
export type OrderSide = 'buy' | 'sell' | 'unknown';

export type TradeStatus = 'open' | 'closed' | 'breakeven';
export type OrderStatus =
  | 'created'
  | 'submitted'
  | 'accepted'
  | 'partially-filled'
  | 'filled'
  | 'cancelled'
  | 'rejected'
  | 'expired'
  | 'unknown';
export type OrderType =
  | 'market'
  | 'limit'
  | 'stop'
  | 'stop-limit'
  | 'close'
  | 'unknown';

export type NumericValue = number | null;

export interface TradeLeg {
  readonly id?: string | number;
  readonly time: number | null;
  readonly price: number | null;
  readonly quantity?: number | null;
  readonly comment?: string | null;
  readonly barIndex?: number | null;
}

export interface Trade {
  readonly id: string | number;
  readonly tradeNumber?: number | null;
  readonly direction: TradeDirection;
  readonly quantity: number;
  readonly entryTime: NumericValue;
  readonly entryPrice: NumericValue;
  /** `null` is the only canonical representation of an open trade exit. */
  readonly exitTime: NumericValue;
  readonly exitPrice: NumericValue;
  readonly status?: TradeStatus;
  readonly entry?: TradeLeg;
  readonly exit?: TradeLeg | null;
  /** Net P&L after commission, fees, and slippage when supplied by the engine. */
  readonly netPnl?: NumericValue;
  /** Gross P&L before costs. Kept separate from the report's gross aggregates. */
  readonly grossPnl?: NumericValue;
  /** Provider aliases are retained so adapters can preserve source information. */
  readonly pnl?: NumericValue;
  readonly profit?: NumericValue;
  readonly realizedPnl?: NumericValue;
  readonly unrealizedPnl?: NumericValue;
  readonly openPnl?: NumericValue;
  readonly commission?: NumericValue;
  readonly fees?: NumericValue;
  readonly slippage?: NumericValue;
  readonly returnPct?: NumericValue;
  readonly mae?: NumericValue;
  readonly mfe?: NumericValue;
  readonly entryOrderId?: string | number | null;
  readonly exitOrderId?: string | number | null;
  readonly parentOrderId?: string | number | null;
  readonly reversalOfTradeId?: string | number | null;
  readonly entryBarIndex?: number | null;
  readonly exitBarIndex?: number | null;
  readonly durationMs?: number | null;
  readonly comment?: string | null;
  readonly tag?: string | null;
  /** Plain report DTO only; native containers, accessors and executable values
   * must be normalized by the provider before createBacktestReport(). */
  readonly raw?: unknown;
}

/** A normalized trade always has explicit nullable exit fields. */
export type NormalizedTrade = Trade & {
  readonly exitTime: number | null;
  readonly exitPrice: number | null;
  readonly status: TradeStatus;
};

export interface Order {
  readonly id: string | number;
  /** Event id when this row came from an append-only broker audit stream. */
  readonly eventId?: string | number;
  /** Physical/source order id; lifecycle rows may share this value. */
  readonly sourceOrderId?: string | number | null;
  readonly type: OrderType;
  readonly category?: 'entry' | 'exit';
  readonly side: OrderSide;
  readonly status?: OrderStatus;
  readonly quantity: number;
  readonly requestedQuantity?: number | null;
  readonly filledQuantity?: number | null;
  readonly remainingQuantity?: number | null;
  readonly fillSequence?: number | null;
  readonly isPartial?: boolean | null;
  readonly time: number | null;
  readonly price?: number | null;
  readonly limitPrice?: number | null;
  readonly stopPrice?: number | null;
  readonly direction?: TradeDirection;
  readonly tradeId?: string | number | null;
  readonly tradeIds?: readonly (string | number)[];
  readonly parentOrderId?: string | number | null;
  readonly parentOrderIds?: readonly (string | number)[];
  readonly reversalOfOrderId?: string | number | null;
  readonly reversalOfTradeIds?: readonly (string | number)[];
  readonly barIndex?: number | null;
  readonly comment?: string | null;
  readonly reason?: string | null;
  readonly raw?: unknown;
}

export interface Fill {
  readonly id: string | number;
  readonly orderId: string | number | null;
  readonly sourceOrderId?: string | number | null;
  readonly type?: OrderType;
  readonly category?: 'entry' | 'exit';
  readonly tradeId?: string | number | null;
  readonly tradeIds?: readonly (string | number)[];
  readonly reversalOfTradeId?: string | number | null;
  readonly reversalOfTradeIds?: readonly (string | number)[];
  readonly reversalOfOrderId?: string | number | null;
  readonly side: OrderSide;
  readonly quantity: number;
  readonly requestedQuantity?: number | null;
  readonly cumulativeQuantity?: number | null;
  readonly remainingQuantity?: number | null;
  readonly fillSequence?: number | null;
  readonly isPartial?: boolean | null;
  readonly parentOrderIds?: readonly (string | number)[];
  readonly parentOrderId?: string | number | null;
  readonly price: number;
  readonly time: number | null;
  readonly fee?: number | null;
  readonly feeCurrency?: string | null;
  readonly barIndex?: number | null;
  readonly liquidity?: 'maker' | 'taker' | 'unknown';
  readonly raw?: unknown;
}

export interface PositionState {
  readonly side: PositionSide;
  readonly quantity: number;
  readonly avgPrice: number | null;
  readonly entryTime?: number | null;
  readonly unrealizedPnl?: number | null;
  readonly realizedPnl?: number | null;
}

export interface AccountState {
  readonly initialCapital: number | null;
  readonly currency?: string | null;
  readonly maxContractsHeldAll?: number | null;
  readonly maxContractsHeldLong?: number | null;
  readonly maxContractsHeldShort?: number | null;
  readonly equity?: number | null;
  readonly balance?: number | null;
  readonly realizedPnl?: number | null;
  readonly unrealizedPnl?: number | null;
  readonly grossProfit?: number | null;
  readonly grossLoss?: number | null;
  readonly maxDrawdown?: number | null;
  readonly maxDrawdownPct?: number | null;
  readonly maxRunup?: number | null;
  readonly position?: PositionState | null;
}

export interface BacktestRange {
  readonly from: number | null;
  readonly to: number | null;
}

export interface HistoryCoverage {
  readonly loaded?: number | null;
  readonly target?: number | null;
  readonly barsLoaded?: number | null;
  readonly oldestTime?: number | null;
  readonly requested?: BacktestRange;
  readonly actual?: BacktestRange;
  readonly effectiveStrategy?: BacktestRange;
  readonly complete: boolean;
  readonly reason?: string | null;
  readonly progress?: number | null;
}

export interface EquityPoint {
  readonly time: number;
  readonly equity: number;
  readonly pnl?: number;
  /** Close-to-close underwater amount relative to the prior equity peak. */
  readonly drawdown?: number;
  /** Ratio form (0.125 means 12.5%), unlike the bridge's percentage points. */
  readonly drawdownPct?: number;
  /** Broker-emulator cumulative intrabar maximum, kept distinct from underwater. */
  readonly maxDrawdown?: number;
  /** Ratio form of the cumulative intrabar maximum. */
  readonly maxDrawdownPct?: number;
  readonly barIndex?: number;
}

export interface BenchmarkPoint {
  readonly time: number;
  readonly value: number;
  readonly pnl?: number;
  readonly returnPct?: number;
  readonly barIndex?: number;
}

export interface BacktestBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly barIndex?: number;
}

export interface BacktestCapabilities {
  readonly tradeLedger: boolean;
  readonly exactEquityCurve: boolean;
  readonly exactDrawdownCurve: boolean;
  readonly riskRatios: boolean;
  readonly benchmark: boolean;
  readonly rawOrders: boolean;
  readonly rawFills: boolean;
  readonly barIndices: boolean;
  readonly individualOpenPnl: boolean;
  readonly executionPrecision: 'chart-ohlc' | 'lower-timeframe' | 'tick';
}

export type MetricUnit =
  | 'currency'
  | 'percent'
  | 'ratio'
  | 'count'
  | 'contracts'
  | 'duration';
export type MetricSource = 'engine' | 'trade-ledger' | 'derived';
export type MetricUnavailableReason =
  | 'not-exposed'
  | 'not-applicable'
  | 'insufficient-data'
  | 'partial-history'
  | 'partial-ledger'
  | 'division-by-zero';

export interface BacktestMetric {
  readonly value: number | null;
  readonly unit: MetricUnit;
  readonly source: MetricSource;
  readonly unavailableReason?: MetricUnavailableReason;
}

export interface BacktestProvenance {
  readonly engine?: { name: string; version?: string; sha?: string };
  readonly bridge?: { name: string; version?: string; sha?: string };
  readonly host?: { name: string; version?: string; sha?: string };
  readonly buildFingerprint?: string;
  readonly workerFingerprint?: string;
  readonly sentinel?: string;
}

export interface BacktestContext {
  readonly provider: string;
  readonly symbol: string;
  readonly displaySymbol?: string;
  readonly timeframe: string;
  readonly timezone?: string;
  readonly currency?: string;
  readonly pricePrecision?: number;
  readonly range?: BacktestRange;
}

export interface SimulationConfig {
  readonly mode: 'resample' | 'shuffle';
  readonly runs: number;
  readonly pnlVariationPct: number;
  readonly preserveWinLoss: boolean;
  readonly drawdownThreshold?: number | null;
  readonly drawdownThresholdUnit?: 'currency' | 'percent' | null;
  readonly seed?: number | string | null;
}

export interface SimulationPath {
  readonly values: readonly number[];
  readonly endingPnl: number;
  readonly maxDrawdown: number;
  readonly maxLosingStreak: number;
}

export interface SimulationResult {
  readonly config: SimulationConfig;
  readonly populationSize: number;
  readonly paths: readonly SimulationPath[];
  readonly endingPnls: readonly number[];
  readonly drawdowns: readonly number[];
  readonly probabilityOfProfit: number | null;
  readonly medianOutcome: number | null;
  readonly p95Drawdown: number | null;
  readonly p99Drawdown: number | null;
  readonly riskOfRuin: number | null;
  readonly thresholdBreachProbability: number | null;
  readonly p95LosingStreak: number | null;
}

export interface BacktestMetricGroup {
  readonly [metric: string]: unknown;
}

export interface BacktestReport {
  readonly schemaVersion: number;
  readonly key: BacktestKey;
  readonly revision: number;
  readonly runId: string;
  readonly snapshotToken?: string | null;
  readonly title?: string;
  readonly source?: { id?: string; name?: string; kind?: string };
  readonly status: BacktestStatus;
  readonly finality: BacktestFinality;
  readonly forming?: boolean;
  readonly context?: BacktestContext;
  /** Explicit dates of the bounded dataset used for this engine run. */
  readonly window?: BacktestResolvedWindow;
  /** Inputs/Properties schema and the values used for this run. */
  readonly settings?: BacktestSettingsSnapshot;
  /** Last bounded engine position; does not imply a complete equity series. */
  readonly execution?: BacktestExecutionSnapshot;
  readonly history?: HistoryCoverage;
  readonly account?: AccountState;
  readonly trades: readonly Trade[];
  /** Derived once at report creation; selectors still recompute defensively. */
  readonly closedTrades: readonly Trade[];
  readonly openTrades: readonly Trade[];
  readonly analysisRows: readonly Trade[];
  readonly orders: readonly Order[];
  readonly fills: readonly Fill[];
  readonly bars: readonly BacktestBar[];
  readonly equitySeries: readonly EquityPoint[];
  readonly benchmarkSeries: readonly BenchmarkPoint[];
  readonly summary?: BacktestMetricGroup;
  readonly performance?: BacktestMetricGroup;
  readonly analysis?: BacktestMetricGroup;
  readonly simulation?: SimulationResult;
  readonly warnings: readonly string[];
  readonly error?: BacktestError | null;
  readonly capabilities: BacktestCapabilities;
  readonly provenance?: BacktestProvenance;
  readonly availability?: Readonly<Record<string, string | boolean>>;
}

export interface BacktestReportInit
  extends Partial<Omit<BacktestReport, 'key' | 'trades' | 'closedTrades' | 'openTrades' | 'analysisRows' | 'orders' | 'fills' | 'bars' | 'equitySeries' | 'benchmarkSeries' | 'capabilities'>> {
  readonly key: BacktestKey;
  /** Raw provider trades are accepted and normalized at this boundary. */
  readonly trades?: readonly unknown[];
  readonly orders?: readonly unknown[];
  readonly fills?: readonly unknown[];
  readonly bars?: readonly BacktestBar[];
  readonly equitySeries?: readonly EquityPoint[];
  readonly benchmarkSeries?: readonly BenchmarkPoint[];
  readonly capabilities?: Partial<BacktestCapabilities>;
}

const DEFAULT_CAPABILITIES: BacktestCapabilities = {
  tradeLedger: false,
  exactEquityCurve: false,
  exactDrawdownCurve: false,
  riskRatios: false,
  benchmark: false,
  rawOrders: false,
  rawFills: false,
  barIndices: false,
  individualOpenPnl: false,
  executionPrecision: 'chart-ohlc',
};

/**
 * Reports cross an adapter boundary and are consumed by several independent
 * renderers.  A readonly TypeScript type is not enough here: callers can
 * still mutate nested arrays/objects at runtime and poison every subsequent
 * selector.  Clone first so freezing a report never freezes provider-owned
 * objects, then recursively freeze the report-owned graph.
 */
function cloneAndFreeze<T>(value: T, seen = new WeakMap<object, unknown>(), path = '$'): T {
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new TypeError(`Unsupported report DTO value at ${path}`);
  }
  if (value === null || typeof value !== 'object') return value;
  // Previously validated domain-owned data is already isolated from callers.
  // Reusing it avoids cloning raw ledger metadata again while finalizing the
  // same report. Never infer this ownership from Object.isFrozen alone.
  if (ownedImmutableDtos.has(value)) return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`Unsupported report DTO object at ${path}; normalize to plain data first`);
  }
  const source = value as object;
  const existing = seen.get(source);
  if (existing) return existing as T;
  const target = (Array.isArray(value) ? [] : {}) as Record<PropertyKey, unknown>;
  seen.set(source, target);
  Reflect.ownKeys(source).forEach((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (!descriptor) return;
    if (typeof key === 'symbol' || !('value' in descriptor)) {
      throw new TypeError(`Unsupported report DTO accessor or symbol at ${path}.${String(key)}`);
    }
    const copied = cloneAndFreeze(descriptor.value, seen, `${path}.${key}`);
    // Define, rather than assign, so a literal __proto__ field remains data.
    Object.defineProperty(target, key, {
      value: copied, enumerable: descriptor.enumerable, configurable: key !== 'length', writable: true,
    });
  });
  Object.freeze(target);
  ownedImmutableDtos.add(target);
  return target as T;
}

/**
 * Creates an isolated immutable report from plain DTO data (objects, arrays,
 * primitives, shared references and cycles). Native containers, Date, class
 * instances, functions, symbol keys and accessors are rejected, not silently
 * erased. Providers must explicitly normalize such metadata before publishing.
 */
export function createBacktestReport(init: BacktestReportInit): BacktestReport {
  // Validate/copy before any normalizer spreads or reads provider properties.
  init = cloneAndFreeze(init);
  const normalizedTrades = Object.freeze((init.trades ?? [])
    .map(trade => {
      const row = Object.freeze(normalizeTrade(trade));
      ownedImmutableDtos.add(row);
      return row;
    }));
  ownedImmutableDtos.add(normalizedTrades);
  // Their nested data comes exclusively from the validated/deep-frozen init.
  // Population selectors can therefore reuse these normalized rows while
  // assembling the report, rather than producing a second normalized copy.
  immutableReportLedgers.add(normalizedTrades);
  const populations = selectTradePopulations(normalizedTrades);
  const normalizedOrders = normalizeOrders(init.orders ?? []);
  const normalizedFills = normalizeFills(init.fills ?? []);
  const report = {
    schemaVersion: BACKTEST_SCHEMA_VERSION,
    key: init.key,
    revision: init.revision ?? 0,
    runId: init.runId ?? `${backtestKeyId(init.key)}:0`,
    snapshotToken: init.snapshotToken ?? null,
    title: init.title,
    source: init.source,
    status: init.status ?? 'waiting-data',
    finality: init.finality ?? 'unknown',
    forming: init.forming ?? false,
    context: init.context,
    window: init.window,
    settings: freezeSettings(init.settings),
    execution: freezeExecution(init.execution),
    history: init.history,
    account: init.account,
    trades: normalizedTrades,
    closedTrades: populations.closedTrades,
    openTrades: populations.openTrades,
    analysisRows: populations.analysisRows,
    orders: normalizedOrders,
    fills: normalizedFills,
    bars: Object.freeze([...(init.bars ?? [])]),
    equitySeries: Object.freeze([...(init.equitySeries ?? [])]),
    benchmarkSeries: Object.freeze([...(init.benchmarkSeries ?? [])]),
    summary: init.summary,
    performance: init.performance,
    analysis: init.analysis,
    simulation: init.simulation,
    warnings: Object.freeze([...(init.warnings ?? [])]),
    error: init.error ?? null,
    capabilities: Object.freeze({ ...DEFAULT_CAPABILITIES, ...(init.capabilities ?? {}) }),
    provenance: freezeProvenance(init.provenance),
    availability: init.availability,
  } satisfies BacktestReport;
  const frozen = cloneAndFreeze(report);
  immutableReportLedgers.add(frozen.trades);
  immutableReports.add(frozen);
  return frozen;
}

/** Proof of factory ownership; shallow Object.freeze is not sufficient. */
export function isImmutableBacktestReport(value: object): value is BacktestReport {
  return immutableReports.has(value);
}

function freezeProvenance(provenance: BacktestProvenance | undefined): BacktestProvenance | undefined {
  if (!provenance) return undefined;
  return Object.freeze({
    ...provenance,
    ...(provenance.engine ? { engine: Object.freeze({ ...provenance.engine }) } : {}),
    ...(provenance.bridge ? { bridge: Object.freeze({ ...provenance.bridge }) } : {}),
    ...(provenance.host ? { host: Object.freeze({ ...provenance.host }) } : {}),
  });
}

function freezeSettings(settings: BacktestSettingsSnapshot | undefined): BacktestSettingsSnapshot | undefined {
  if (!settings) return settings;
  const freezeSchema = (schema: readonly BacktestSettingsSnapshot['inputs'][number][]) => Object.freeze(
    schema.map((item) => Object.freeze({
      ...item,
      ...(item.options ? { options: Object.freeze([...item.options]) } : {}),
    })),
  );
  return Object.freeze({
    ...settings,
    key: Object.freeze({ ...settings.key }),
    inputs: freezeSchema(settings.inputs),
    props: freezeSchema(settings.props),
    inputValues: Object.freeze({ ...settings.inputValues }),
    propValues: Object.freeze({ ...settings.propValues }),
  });
}

function freezeExecution(execution: BacktestExecutionSnapshot | undefined): BacktestExecutionSnapshot | undefined {
  if (!execution) return execution;
  return Object.freeze({
    ...execution,
    seriesKeys: Object.freeze([...execution.seriesKeys]),
    ...(execution.precision ? { precision: Object.freeze({ ...execution.precision }) } : {}),
  });
}

/**
 * Values emitted by some strategy engines for an open exit. They are accepted
 * only at the adapter boundary and never enter date buckets or closed metrics.
 */
export const OPEN_EXIT_TIME_SENTINELS = Object.freeze([
  0,
  '0',
  '0.0',
  '1970-01-01',
  '1970-01-01T00:00:00.000Z',
  'epoch',
  'n/a',
  'na',
  'none',
  'null',
  'undefined',
  'open',
  'current',
  '-',
  '—',
] as const);

const OPEN_EXIT_TEXT = new Set(
  OPEN_EXIT_TIME_SENTINELS.filter((value) => typeof value === 'string')
    .map((value) => String(value).trim().toLowerCase()),
);

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Converts provider exit timestamps into the canonical nullable form.
 * Numeric timestamps are deliberately not unit-converted: the adapter knows
 * whether its source uses milliseconds or seconds and should normalize that
 * before calling this function.
 */
export function normalizeExitTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
  }
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (OPEN_EXIT_TEXT.has(text)) return null;
    const numeric = finiteNumber(text);
    if (numeric !== null) return numeric > 0 ? numeric : null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const numeric = finiteNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

export function normalizeExitPrice(value: unknown, exitTime: number | null): number | null {
  if (exitTime === null) return null;
  const numeric = finiteNumber(value);
  return numeric === null ? null : numeric;
}

function normalizeDirection(value: unknown): TradeDirection {
  if (value === 'long' || value === 'short' || value === 'unknown') return value;
  const direction = String(value ?? '').trim().toLowerCase();
  if (direction === 'short' || direction === 'sell' || direction === '-1') return 'short';
  if (direction === 'long' || direction === 'buy' || direction === '1') return 'long';
  return 'unknown';
}

function normalizeNumericField(value: unknown): number | null {
  return finiteNumber(value);
}

function normalizeOrderSide(value: unknown): OrderSide {
  const side = String(value ?? '').trim().toLowerCase();
  if (side === 'sell' || side === 'short' || side === '-1') return 'sell';
  if (side === 'buy' || side === 'long' || side === '1') return 'buy';
  return 'unknown';
}

function normalizeOrderType(value: unknown): OrderType {
  const type = String(value ?? '').trim().toLowerCase();
  if (type === 'market' || type === 'limit' || type === 'stop' || type === 'stop-limit' || type === 'close') return type;
  return 'unknown';
}

function normalizeOrderStatus(source: Record<string, unknown>): OrderStatus {
  const status = String(source.status ?? source.kind ?? '').trim().toLowerCase();
  if (status === 'filled' && source.isPartial === true) return 'partially-filled';
  if (status === 'created' || status === 'submitted' || status === 'accepted'
    || status === 'partially-filled' || status === 'filled' || status === 'cancelled'
    || status === 'rejected' || status === 'expired') return status;
  return 'unknown';
}

function copiedIds(value: unknown): readonly (string | number)[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((item): item is string | number => (
    (typeof item === 'string' && item.length > 0)
    || (typeof item === 'number' && Number.isFinite(item))
  ));
  return ids.length === value.length ? Object.freeze(ids) : undefined;
}

/** Converts a provider order into the serializable domain ledger shape. */
export function normalizeOrder(input: unknown): Order {
  const source = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const quantity = normalizeNumericField(source.quantity ?? source.qty ?? source.size) ?? 0;
  const time = normalizeExitTime(source.time ?? source.timestamp ?? source.createdAt);
  return {
    ...(source as Partial<Order>),
    id: (source.id ?? source.orderId ?? `order-${time ?? 'unknown'}`) as string | number,
    ...(source.eventId !== undefined ? { eventId: source.eventId as string | number } : {}),
    ...(source.sourceOrderId !== undefined ? { sourceOrderId: source.sourceOrderId as string | number | null } : {}),
    type: normalizeOrderType(source.type ?? source.orderType),
    ...(source.category === 'entry' || source.category === 'exit' ? { category: source.category } : {}),
    side: normalizeOrderSide(source.side ?? source.direction),
    status: normalizeOrderStatus(source),
    quantity,
    ...(source.requestedQuantity !== undefined || source.requestedQty !== undefined
      ? { requestedQuantity: normalizeNumericField(source.requestedQuantity ?? source.requestedQty) }
      : {}),
    ...(source.filledQuantity !== undefined || source.filledQty !== undefined || source.cumulativeFillQty !== undefined
      ? { filledQuantity: normalizeNumericField(source.filledQuantity ?? source.filledQty ?? source.cumulativeFillQty) }
      : {}),
    ...(source.remainingQuantity !== undefined || source.remainingQty !== undefined
      ? { remainingQuantity: normalizeNumericField(source.remainingQuantity ?? source.remainingQty) }
      : {}),
    ...(source.fillSequence !== undefined ? { fillSequence: normalizeNumericField(source.fillSequence) } : {}),
    ...(typeof source.isPartial === 'boolean' ? { isPartial: source.isPartial } : {}),
    time,
    price: normalizeNumericField(source.price ?? source.fillPrice),
    limitPrice: normalizeNumericField(source.limitPrice ?? source.limit),
    stopPrice: normalizeNumericField(source.stopPrice ?? source.stop),
    ...(source.direction !== undefined ? { direction: normalizeDirection(source.direction) } : {}),
    ...(source.tradeId !== undefined ? { tradeId: source.tradeId as string | number } : {}),
    ...(copiedIds(source.tradeIds) ? { tradeIds: copiedIds(source.tradeIds)! } : {}),
    ...(source.parentOrderId !== undefined ? { parentOrderId: source.parentOrderId as string | number } : {}),
    ...(copiedIds(source.parentOrderIds) ? { parentOrderIds: copiedIds(source.parentOrderIds)! } : {}),
    ...(source.reversalOfOrderId !== undefined ? { reversalOfOrderId: source.reversalOfOrderId as string | number } : {}),
    ...(copiedIds(source.reversalOfTradeIds) ? { reversalOfTradeIds: copiedIds(source.reversalOfTradeIds)! } : {}),
    barIndex: normalizeNumericField(source.barIndex),
    ...(typeof source.comment === 'string' ? { comment: source.comment } : {}),
    ...(typeof source.reason === 'string' ? { reason: source.reason } : {}),
  };
}

export function normalizeOrders(orders: readonly unknown[]): readonly Order[] {
  return Object.freeze(orders.map((order) => normalizeOrder(order)));
}

/** Converts a provider fill (including Vela StrategyFill) into the domain shape. */
export function normalizeFill(input: unknown): Fill {
  const source = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const time = normalizeExitTime(source.time ?? source.timestamp ?? source.createdAt);
  return {
    ...(source as Partial<Fill>),
    id: (source.id ?? source.fillId ?? `fill-${time ?? 'unknown'}`) as string | number,
    orderId: (source.orderId ?? source.id ?? null) as string | number | null,
    ...(source.sourceOrderId !== undefined ? { sourceOrderId: source.sourceOrderId as string | number | null } : {}),
    ...(source.type !== undefined || source.orderType !== undefined
      ? { type: normalizeOrderType(source.type ?? source.orderType) }
      : {}),
    ...(source.category === 'entry' || source.category === 'exit' ? { category: source.category } : {}),
    ...(source.tradeId !== undefined ? { tradeId: source.tradeId as string | number } : {}),
    ...(copiedIds(source.tradeIds) ? { tradeIds: copiedIds(source.tradeIds)! } : {}),
    ...(source.reversalOfTradeId !== undefined ? { reversalOfTradeId: source.reversalOfTradeId as string | number } : {}),
    ...(copiedIds(source.reversalOfTradeIds) ? { reversalOfTradeIds: copiedIds(source.reversalOfTradeIds)! } : {}),
    ...(source.reversalOfOrderId !== undefined
      ? { reversalOfOrderId: source.reversalOfOrderId as string | number | null }
      : {}),
    side: normalizeOrderSide(source.side ?? source.direction),
    quantity: normalizeNumericField(source.quantity ?? source.qty ?? source.size) ?? 0,
    ...(source.requestedQuantity !== undefined || source.requestedQty !== undefined
      ? { requestedQuantity: normalizeNumericField(source.requestedQuantity ?? source.requestedQty) }
      : {}),
    ...(source.cumulativeQuantity !== undefined || source.cumulativeQty !== undefined
      ? { cumulativeQuantity: normalizeNumericField(source.cumulativeQuantity ?? source.cumulativeQty) }
      : {}),
    ...(source.remainingQuantity !== undefined || source.remainingQty !== undefined
      ? { remainingQuantity: normalizeNumericField(source.remainingQuantity ?? source.remainingQty) }
      : {}),
    ...(source.fillSequence !== undefined ? { fillSequence: normalizeNumericField(source.fillSequence) } : {}),
    ...(typeof source.isPartial === 'boolean' ? { isPartial: source.isPartial } : {}),
    ...(source.parentOrderId !== undefined ? { parentOrderId: source.parentOrderId as string | number } : {}),
    ...(copiedIds(source.parentOrderIds) ? { parentOrderIds: copiedIds(source.parentOrderIds)! } : {}),
    price: normalizeNumericField(source.price ?? source.fillPrice) ?? 0,
    time,
    fee: normalizeNumericField(source.fee ?? source.commission),
    feeCurrency: (source.feeCurrency ?? null) as string | null,
    barIndex: normalizeNumericField(source.barIndex),
    liquidity: source.liquidity === 'maker' || source.liquidity === 'taker' ? source.liquidity : 'unknown',
  };
}

export function normalizeFills(fills: readonly unknown[]): readonly Fill[] {
  return Object.freeze(fills.map((fill) => normalizeFill(fill)));
}

/** Normalizes an engine trade without mutating or dropping its raw fields. */
export function normalizeTrade(input: unknown): NormalizedTrade {
  const source = input !== null && typeof input === 'object' ? input as Record<string, unknown> : {};
  const entry = source.entry && typeof source.entry === 'object' ? source.entry as Record<string, unknown> : undefined;
  const exit = source.exit && typeof source.exit === 'object' ? source.exit as Record<string, unknown> : undefined;
  const exitTime = source.open === true
    ? null
    : normalizeExitTime(source.exitTime ?? source.closeTime ?? source.exitTimestamp ?? exit?.time);
  const entryTime = normalizeExitTime(source.entryTime ?? source.openTime ?? source.entryTimestamp ?? entry?.time);
  const status: TradeStatus = exitTime === null || source.open === true
    ? 'open'
    : source.status === 'breakeven'
      ? 'breakeven'
      : 'closed';
  const rawDirection = source.direction ?? source.side ?? source.positionSide;
  const quantity = normalizeNumericField(source.quantity ?? source.size ?? source.contracts ?? source.qty) ?? 0;
  const entryPrice = normalizeNumericField(source.entryPrice ?? source.openPrice ?? entry?.price);
  const exitPrice = normalizeExitPrice(source.exitPrice ?? source.closePrice ?? exit?.price, exitTime);
  const id = (source.id ?? source.tradeId ?? source.number ?? `trade-${entryTime ?? 'unknown'}`) as string | number;
  return {
    ...(source as Partial<Trade>),
    id,
    tradeNumber: normalizeNumericField(source.tradeNumber ?? source.number),
    direction: normalizeDirection(rawDirection),
    quantity,
    entryTime,
    entryPrice,
    exitTime,
    exitPrice,
    status,
    netPnl: normalizeNumericField(source.netPnl ?? source.netProfit ?? source.pnl ?? source.profit ?? source.realizedPnl),
    grossPnl: normalizeNumericField(source.grossPnl ?? source.grossProfit),
    pnl: normalizeNumericField(source.pnl),
    profit: normalizeNumericField(source.profit),
    realizedPnl: normalizeNumericField(source.realizedPnl),
    unrealizedPnl: normalizeNumericField(source.unrealizedPnl ?? source.openPnl),
    openPnl: normalizeNumericField(source.openPnl),
    commission: normalizeNumericField(source.commission),
    fees: normalizeNumericField(source.fees ?? source.fee),
    slippage: normalizeNumericField(source.slippage),
    returnPct: normalizeNumericField(source.returnPct ?? source.profitPercent),
    mae: normalizeNumericField(source.mae ?? source.maxDrawdown),
    mfe: normalizeNumericField(source.mfe ?? source.maxRunup),
    entryOrderId: (source.entryOrderId ?? entry?.id ?? null) as string | number | null,
    exitOrderId: (source.exitOrderId ?? exit?.id ?? null) as string | number | null,
    parentOrderId: (source.parentOrderId ?? null) as string | number | null,
    entryBarIndex: normalizeNumericField(
      source.entryBarIndex ?? entry?.barIndex ?? source.entry_bar_index,
    ),
    exitBarIndex: exitTime === null
      ? null
      : normalizeNumericField(
          source.exitBarIndex ?? exit?.barIndex ?? source.exit_bar_index,
        ),
    reversalOfTradeId: (source.reversalOfTradeId ?? null) as string | number | null,
    durationMs: normalizeNumericField(source.durationMs),
    raw: source.raw ?? input,
  };
}

export function normalizeTrades(trades: readonly unknown[]): readonly NormalizedTrade[] {
  return Object.freeze(trades.map((trade) => normalizeTrade(trade)));
}

export function isTradeOpen(trade: Trade): boolean {
  return normalizeExitTime(trade.exitTime) === null || trade.status === 'open';
}

export function isTradeClosed(trade: Trade): boolean {
  return !isTradeOpen(trade);
}

export function tradeNetPnl(trade: Trade): number | null {
  const source = trade as unknown as Record<string, unknown>;
  const direct = finiteNumber(source.netPnl);
  if (direct !== null) return Object.is(direct, -0) ? 0 : direct;
  const candidates = [source.pnl, source.profit, source.realizedPnl];
  for (const value of candidates) {
    const numeric = finiteNumber(value);
    if (numeric !== null) return Object.is(numeric, -0) ? 0 : numeric;
  }
  const gross = finiteNumber(source.grossPnl);
  if (gross !== null) {
    const costs =
      Math.abs(finiteNumber(source.commission) ?? 0) +
      Math.abs(finiteNumber(source.fees) ?? 0) +
      Math.abs(finiteNumber(source.slippage) ?? 0);
    return gross - costs;
  }
  const entryPrice = finiteNumber(source.entryPrice ?? source.openPrice);
  const exitPrice = finiteNumber(source.exitPrice ?? source.closePrice);
  const quantity = finiteNumber(source.quantity ?? source.size ?? source.contracts);
  if (entryPrice !== null && exitPrice !== null && quantity !== null && !isTradeOpen(trade)) {
    const direction = normalizeDirection(source.direction ?? source.side ?? source.positionSide);
    if (direction !== 'unknown') {
      const grossFromPrices = direction === 'short'
        ? (entryPrice - exitPrice) * Math.abs(quantity)
        : (exitPrice - entryPrice) * Math.abs(quantity);
      const costs =
        Math.abs(finiteNumber(source.commission) ?? 0) +
        Math.abs(finiteNumber(source.fees) ?? 0) +
        Math.abs(finiteNumber(source.slippage) ?? 0);
      return grossFromPrices - costs;
    }
  }
  return null;
}

export function tradeUnrealizedPnl(trade: Trade): number | null {
  const source = trade as unknown as Record<string, unknown>;
  const explicit = finiteNumber(source.unrealizedPnl ?? source.openPnl);
  if (explicit !== null) return explicit;
  if (!isTradeOpen(trade)) return finiteNumber(source.pnl);
  const entryPrice = finiteNumber(source.entryPrice ?? source.openPrice);
  const markPrice = finiteNumber(source.currentPrice ?? source.markPrice ?? source.lastPrice);
  const quantity = finiteNumber(source.quantity ?? source.size ?? source.contracts);
  if (entryPrice !== null && markPrice !== null && quantity !== null) {
    const direction = normalizeDirection(source.direction ?? source.side ?? source.positionSide);
    if (direction !== 'unknown') {
      return (direction === 'short' ? entryPrice - markPrice : markPrice - entryPrice) * Math.abs(quantity);
    }
  }
  return finiteNumber(source.pnl);
}

export function tradeDirection(trade: Trade): TradeDirection {
  return normalizeDirection((trade as unknown as Record<string, unknown>).direction);
}

export interface TradePopulations {
  readonly allTrades: readonly NormalizedTrade[];
  readonly closedTrades: readonly NormalizedTrade[];
  readonly openTrades: readonly NormalizedTrade[];
  /** Reference-compatible rows; includes open/current rows by default. */
  readonly analysisRows: readonly NormalizedTrade[];
  /** Only eligible closed rows are passed to Resample/Shuffle. */
  readonly simulationPopulation: readonly NormalizedTrade[];
  readonly longTrades: readonly NormalizedTrade[];
  readonly shortTrades: readonly NormalizedTrade[];
  readonly winningTrades: readonly NormalizedTrade[];
  readonly losingTrades: readonly NormalizedTrade[];
  readonly breakevenTrades: readonly NormalizedTrade[];
}

export interface PopulationSelectorOptions {
  readonly includeOpenInAnalysis?: boolean;
  readonly breakevenEpsilon?: number;
}

/**
 * Produces every named population from one immutable trade ledger. This is the
 * sole source for Summary, Analysis, and Simulation denominators.
 */
export function selectTradePopulations(
  trades: readonly unknown[],
  options: PopulationSelectorOptions = {},
): TradePopulations {
  const trusted = immutableReportLedgers.has(trades);
  const epsilon = Math.max(0, options.breakevenEpsilon ?? 1e-8);
  const includeOpen = options.includeOpenInAnalysis !== false;
  const cached = trusted ? reportPopulationCache.get(trades) : undefined;
  if (cached && cached.epsilon === epsilon && cached.includeOpen === includeOpen) return cached.value;
  const normalized = trusted ? trades as readonly NormalizedTrade[] : normalizeTrades(trades);
  const closedTrades = normalized.filter(isTradeClosed);
  const openTrades = normalized.filter(isTradeOpen);
  const analysisRows = options.includeOpenInAnalysis === false ? closedTrades : normalized;
  const simulationPopulation = closedTrades.filter((trade) => tradeNetPnl(trade) !== null);
  const classify = (trade: NormalizedTrade): 'win' | 'loss' | 'even' => {
    const pnl = tradeNetPnl(trade) ?? 0;
    if (pnl > epsilon) return 'win';
    if (pnl < -epsilon) return 'loss';
    return 'even';
  };
  const value = {
    allTrades: Object.freeze(normalized),
    closedTrades: Object.freeze(closedTrades),
    openTrades: Object.freeze(openTrades),
    analysisRows: Object.freeze(analysisRows),
    simulationPopulation: Object.freeze(simulationPopulation),
    longTrades: Object.freeze(normalized.filter((trade) => tradeDirection(trade) === 'long')),
    shortTrades: Object.freeze(normalized.filter((trade) => tradeDirection(trade) === 'short')),
    winningTrades: Object.freeze(closedTrades.filter((trade) => classify(trade) === 'win')),
    losingTrades: Object.freeze(closedTrades.filter((trade) => classify(trade) === 'loss')),
    breakevenTrades: Object.freeze(closedTrades.filter((trade) => classify(trade) === 'even')),
  };
  if (trusted) {
    Object.freeze(value);
    // Every member array contains only the already owned normalized rows.
    // The report factory may retain these exact immutable populations.
    Object.values(value).forEach(array => ownedImmutableDtos.add(array));
    ownedImmutableDtos.add(value);
    reportPopulationCache.set(trades, { epsilon, includeOpen, value });
  }
  return value;
}

/** Compatibility aliases used by feature adapters. */
export const selectTradePopulation = selectTradePopulations;
export const normalizeExitTimestamp = normalizeExitTime;
export const normalizeOpenExitTime = normalizeExitTime;
export const isOpenTrade = isTradeOpen;
export const isClosedTrade = isTradeClosed;
export const getTradeNetPnl = tradeNetPnl;
export const getTradeUnrealizedPnl = tradeUnrealizedPnl;
export const selectPopulations = selectTradePopulations;
