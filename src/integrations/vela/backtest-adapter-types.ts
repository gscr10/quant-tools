import type {
  ContextSelect,
  EngineContextSnapshot,
  IndicatorHandle,
  InputSchema,
  InputValue,
  ScriptRun,
  StrategyTrade,
} from '@luxalgo/vela';

/** Local bridge extension carried by PineTS round-trip ledger rows. */
export interface BacktestAdapterTrade extends StrategyTrade {
  readonly entryBarIndex?: number;
  readonly exitBarIndex?: number;
}

/** The stable application identity for one strategy instance in one workspace cell. */
export interface BacktestAdapterKey {
  readonly cellId: string;
  readonly indicatorId: string;
}

export type BacktestAdapterStatus =
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

export type BacktestAdapterFinality =
  | 'historical-final'
  | 'live-provisional'
  | 'partial-history'
  | 'unknown';

/**
 * History loading facts published by Vela's public chart events.  `complete`
 * means that the chart reached the end of the currently available history;
 * it does not silently turn an aborted/depth-limited load into a full report.
 */
export type BacktestAdapterHistoryReason = 'depth' | 'genesis' | 'aborted';
export interface BacktestAdapterHistoryState {
  readonly loaded: number | null;
  readonly target: number | null;
  readonly barsLoaded: number | null;
  readonly oldestTime: number | null;
  readonly complete: boolean;
  readonly reason?: BacktestAdapterHistoryReason | null;
  readonly progress: number | null;
}

export type BacktestAdapterLedgerState = 'idle' | 'pending' | 'ready' | 'error';
export type BacktestAdapterSeriesState = 'idle' | 'pending' | 'ready' | 'error';

/**
 * The parameter surface exposed by Vela's public IndicatorHandle.  Keeping
 * schema and current values together prevents consumers from accidentally
 * treating declaration defaults as the values that were actually used for a
 * run (a particularly easy mistake after a Properties edit).
 */
export interface BacktestAdapterParameterState {
  readonly schema: readonly InputSchema[];
  readonly values: Readonly<Record<string, InputValue>>;
}

/**
 * Bounded execution metadata available on ScriptRun/EngineContextSnapshot.
 * `barIndex` is the last computed bar, not a trade fill index.  A null value
 * means the engine has not produced a run yet.
 */
export interface BacktestAdapterExecutionState {
  readonly barIndex: number | null;
  readonly time: number | null;
  readonly phase: EngineContextSnapshot['phase'] | null;
  /** Plot keys that can be passed to `readSeries`; no raw series is copied into
   * every snapshot because a deep history transfer can be very large. */
  readonly seriesKeys: readonly string[];
  /** Truthful Bar Magnifier request/application status from the local engine. */
  readonly precision?: BacktestAdapterPrecisionState;
}

export type BacktestAdapterPrecision = 'chart-ohlc' | 'lower-timeframe' | 'tick';
export interface BacktestAdapterPrecisionState {
  readonly requested: boolean;
  readonly applied: boolean;
  readonly requestedPrecision: BacktestAdapterPrecision;
  readonly appliedPrecision: BacktestAdapterPrecision;
  readonly lowerTimeframe?: string;
  readonly parentBars: number;
  readonly lowerBars: number;
  readonly coveredParentBars: number;
  readonly coverage: number;
  readonly fallbackReason?: string;
}

/** Build identity emitted by the local Vela-PineTS execution boundary. */
export interface BacktestAdapterBuildPackage {
  readonly schemaVersion: 1;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly upstreamSha: string;
  readonly localPatchRevision: string;
  readonly reportSchemaVersion: number;
  readonly sentinel: string;
  readonly buildFingerprint: string;
}

export interface BacktestAdapterBridgeBuild extends BacktestAdapterBuildPackage {
  readonly bridgeSha: string;
  readonly embeddedPinetsSha: string;
  readonly embeddedPinetsFingerprint: string;
}

export interface BacktestAdapterProvenance {
  readonly execution: 'in-process' | 'worker';
  readonly engine: BacktestAdapterBuildPackage;
  readonly bridge: BacktestAdapterBridgeBuild;
  readonly buildFingerprint: string;
  readonly workerFingerprint?: string;
  readonly sentinel: string;
}

export interface BacktestAdapterSeriesPoint {
  readonly time: number;
  readonly value: number | null;
}

/**
 * One authoritative close-of-bar account observation emitted by the local
 * PineTS broker. Percentage fields use display percentage points at this
 * boundary (12.5 means 12.5%); the provider-neutral domain converts them to
 * ratios exactly once.
 */
export interface BacktestAdapterReportPoint {
  readonly barIndex: number;
  readonly time: number;
  readonly closeTime?: number;
  readonly equity: number;
  readonly realizedPnl: number;
  readonly openPnl: number;
  readonly underwater: number;
  readonly underwaterPercent: number | null;
  readonly maxDrawdown: number;
  readonly maxDrawdownPercent: number;
  readonly benchmarkEquity: number | null;
  readonly benchmarkPnl: number | null;
  readonly benchmarkReturnPercent: number | null;
}

export interface BacktestAdapterReportSeries {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly snapshotRevision: number;
  readonly barIndex: number;
  readonly points: readonly BacktestAdapterReportPoint[];
}

export interface BacktestAdapterReportTail {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly snapshotRevision: number;
  readonly barIndex: number;
  /** Same wire envelope as the full series, bounded to zero or one point. */
  readonly points: readonly BacktestAdapterReportPoint[];
}

/**
 * A validated lifecycle row from the local PineTS broker audit stream.
 *
 * These DTOs deliberately stay neutral and event-shaped.  They are not Vela
 * renderer fills and they do not collapse several physical parent/reversal
 * ids into one guessed id.  The application maps them to the domain ledger
 * only after the enclosing identity has been accepted.
 */
export type BacktestAdapterAuditOrderKind = 'created' | 'filled' | 'cancelled' | 'rejected';
export type BacktestAdapterAuditOrderType = 'market' | 'limit' | 'stop' | 'stop-limit';
export type BacktestAdapterAuditCategory = 'entry' | 'exit';

export interface BacktestAdapterAuditOrder {
  readonly eventId: string;
  readonly orderId: string;
  readonly sourceOrderId?: string;
  readonly kind: BacktestAdapterAuditOrderKind;
  readonly barIndex: number;
  readonly time: number;
  readonly direction: -1 | 0 | 1;
  readonly qty: number;
  readonly orderType: BacktestAdapterAuditOrderType;
  readonly category?: BacktestAdapterAuditCategory;
  readonly limit?: number;
  readonly stop?: number;
  readonly fillPrice?: number;
  readonly fillQty?: number;
  readonly tradeIds?: readonly string[];
  readonly reason?: string;
  readonly parentOrderIds?: readonly string[];
  readonly reversalOfOrderId?: string;
  readonly reversalOfTradeIds?: readonly string[];
  readonly requestedQty?: number;
  readonly cumulativeFillQty?: number;
  readonly remainingQty?: number;
  readonly fillSequence?: number;
  readonly isPartial?: boolean;
}

export interface BacktestAdapterAuditFill {
  readonly fillId: string;
  readonly orderId: string;
  readonly sourceOrderId?: string;
  readonly barIndex: number;
  readonly time: number;
  readonly direction: -1 | 0 | 1;
  readonly qty: number;
  readonly price: number;
  readonly orderType: BacktestAdapterAuditOrderType;
  readonly category?: BacktestAdapterAuditCategory;
  readonly tradeIds?: readonly string[];
  readonly parentOrderIds?: readonly string[];
  readonly reversalOfOrderId?: string;
  readonly reversalOfTradeIds?: readonly string[];
  readonly requestedQty?: number;
  readonly cumulativeQty?: number;
  readonly remainingQty?: number;
  readonly fillSequence?: number;
  readonly isPartial?: boolean;
}

export interface BacktestAdapterAuditLedger {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly snapshotRevision: number;
  readonly barIndex: number;
  readonly sequence: number;
  readonly orderEvents: readonly BacktestAdapterAuditOrder[];
  readonly fillEvents: readonly BacktestAdapterAuditFill[];
}

export type BacktestAdapterAuditState = 'idle' | 'pending' | 'ready' | 'error';

/** Clone-safe diagnostics carried alongside the legacy Error object. */
export interface BacktestAdapterError {
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
}

const ERROR_TEXT_LIMIT = 512;
const ERROR_URL_LIMIT = 2_048;

/** Normalize an arbitrary provider/engine/worker error for the app boundary. */
export function backtestAdapterErrorOf(error: unknown): BacktestAdapterError {
  const value = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : { message: error };
  const message = typeof value.message === 'string' && value.message.length > 0
    ? value.message.slice(0, ERROR_TEXT_LIMIT)
    : String(error ?? 'Backtest failed').slice(0, ERROR_TEXT_LIMIT);
  const name = typeof value.name === 'string' && value.name.length > 0
    ? value.name.slice(0, ERROR_TEXT_LIMIT)
    : undefined;
  const method = typeof value.method === 'string' && value.method.length > 0
    ? value.method.slice(0, ERROR_TEXT_LIMIT)
    : undefined;
  const code = typeof value.code === 'string' && value.code.length > 0
    ? value.code.slice(0, ERROR_TEXT_LIMIT)
    : undefined;
  const provider = typeof value.provider === 'string' && value.provider.length > 0
    ? value.provider.slice(0, ERROR_TEXT_LIMIT)
    : undefined;
  const kind = value.kind === 'pine-runtime' || value.kind === 'provider'
    || value.kind === 'worker' || value.kind === 'compile' || value.kind === 'unknown'
    ? value.kind
    : name === 'PineRuntimeError' || method !== undefined
      ? 'pine-runtime'
      : name?.startsWith('Provider') || provider !== undefined
        ? 'provider'
        : name === 'SyntaxError' || name?.includes('Compile')
          ? 'compile'
        : name?.toLowerCase().includes('worker')
          ? 'worker'
          : undefined;
  const status = typeof value.status === 'number' && Number.isFinite(value.status)
    ? value.status
    : undefined;
  const timeoutMs = typeof value.timeoutMs === 'number' && Number.isFinite(value.timeoutMs)
    ? value.timeoutMs
    : undefined;
  const url = typeof value.url === 'string' && value.url.length > 0
    ? value.url.slice(0, ERROR_URL_LIMIT)
    : undefined;
  const retryable = typeof value.retryable === 'boolean'
    ? value.retryable
    : kind === 'provider'
      && (name === 'ProviderTimeoutError'
        || status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500))
      ? true
      : undefined;
  return Object.freeze({
    message,
    ...(name ? { name } : {}),
    ...(kind ? { kind } : {}),
    ...(method ? { method } : {}),
    ...(code ? { code } : {}),
    ...(provider ? { provider } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(url ? { url } : {}),
    ...(retryable !== undefined ? { retryable } : {}),
  });
}

/** Capabilities available from the unmodified Vela 0.7 + Vela-PineTS bridge. */
export interface BacktestAdapterCapabilities {
  readonly tradeLedger: boolean;
  readonly exactEquityCurve: boolean;
  readonly exactDrawdownCurve: boolean;
  readonly riskRatios: boolean;
  readonly benchmark: boolean;
  readonly rawOrders: boolean;
  readonly rawFills: boolean;
  readonly barIndices: boolean;
  readonly individualOpenPnl: boolean;
  readonly executionPrecision: BacktestAdapterPrecision;
}

export const CURRENT_VELA_BACKTEST_CAPABILITIES: BacktestAdapterCapabilities = Object.freeze({
  tradeLedger: true,
  exactEquityCurve: false,
  exactDrawdownCurve: false,
  riskRatios: false,
  benchmark: false,
  rawOrders: false,
  rawFills: false,
  barIndices: false,
  // StrategyTrade deliberately omits `pnl` while open; only account-level
  // StrategyState.openPnl is available in the public bridge.
  individualOpenPnl: false,
  executionPrecision: 'chart-ohlc',
});

/**
 * A serializable-ish view of the public Vela execution surfaces.
 *
 * Vela 0.7 does not expose an engine run id. `runToken` is therefore deliberately
 * host-generated and must not be presented as a PineTS broker id. It is stable for
 * the adapter revision and gives consumers a safe correlation key until the bridge
 * publishes an immutable run/snapshot token.
 */
export interface BacktestAdapterSnapshot {
  readonly key: BacktestAdapterKey;
  readonly revision: number;
  readonly epoch: number;
  readonly runToken: string | null;
  readonly status: BacktestAdapterStatus;
  readonly finality: BacktestAdapterFinality;
  /** Public Vela history coverage; absent only for legacy third-party fixtures. */
  readonly history?: BacktestAdapterHistoryState;
  readonly ledgerState: BacktestAdapterLedgerState;
  /** Revision of the accepted ledger; absent only in legacy producers. */
  readonly ledgerRevision?: number | null;
  readonly capabilities: BacktestAdapterCapabilities;
  readonly visible: boolean;
  readonly handle: Readonly<Pick<IndicatorHandle, 'id' | 'title' | 'source'>>;
  /** Data-only run metadata. Executable engine methods never cross this seam. */
  readonly run: Readonly<Omit<ScriptRun, 'trades' | 'series'>> | null;
  readonly context: EngineContextSnapshot | null;
  /** `null` means that a complete ledger has not been read for this revision. */
  readonly trades: readonly BacktestAdapterTrade[] | null;
  /** Validated local broker audit rows for the current context identity. */
  readonly auditState?: BacktestAdapterAuditState;
  readonly auditLedger?: BacktestAdapterAuditLedger;
  /** Event-shaped order/fill projections. Empty when auditState is not ready. */
  readonly orders?: readonly BacktestAdapterAuditOrder[];
  readonly fills?: readonly BacktestAdapterAuditFill[];
  /** Full per-bar report data is fetched only for a settled run. */
  readonly reportSeries?: BacktestAdapterReportSeries;
  readonly seriesState?: BacktestAdapterSeriesState;
  /** Inputs and declaration properties used by this indicator instance. */
  readonly inputs?: BacktestAdapterParameterState;
  readonly props?: BacktestAdapterParameterState;
  /** Last computed position and the plot keys available through `readSeries`.
   * Optional for third-party/fixture sources compiled against the pre-contract shape. */
  readonly execution?: BacktestAdapterExecutionState;
  /** Optional on third-party engines and pre-fingerprint fixtures. */
  readonly provenance?: BacktestAdapterProvenance;
  readonly error: Error | null;
  readonly errorDetails?: BacktestAdapterError;
  readonly source?: string;
}

export type BacktestAdapterEvent =
  | {
      readonly type: 'snapshot';
      readonly snapshot: BacktestAdapterSnapshot;
    }
  | {
      readonly type: 'removed';
      readonly key: BacktestAdapterKey;
    }
  | {
      readonly type: 'stale-drop';
      readonly key: BacktestAdapterKey;
      readonly revision: number;
      readonly epoch: number;
      readonly reason: string;
    }
  | {
      readonly type: 'error';
      readonly key: BacktestAdapterKey;
      readonly revision: number;
      readonly epoch: number;
      readonly error: Error;
      readonly errorDetails?: BacktestAdapterError;
    };

export type BacktestAdapterListener = (event: BacktestAdapterEvent) => void;

export const BACKTEST_CONTEXT_SELECT: ContextSelect = [
  'meta',
  'strategy',
  'trades',
  'warnings',
];

/** Per-run context selection: intentionally excludes the unbounded trade ledger. */
export const BACKTEST_SUMMARY_CONTEXT_SELECT: ContextSelect = [
  'meta',
  'strategy',
  'warnings',
];
