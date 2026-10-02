import type { ContextSelect, EngineContextSnapshot } from '@luxalgo/vela/plugin';

export const REPORT_SERIES_CONTEXT_KEY = 'reportSeries' as const;
export const REPORT_TAIL_CONTEXT_KEY = 'reportTail' as const;
/**
 * Experimental, opt-in selector for the PineTS broker's internal audit
 * stream.  This is deliberately not named `rawOrders`/`rawFills`: the
 * envelope is a bridge-local diagnostic contract and does not advertise the
 * Vela raw-order/fill capabilities.
 */
export const AUDIT_LEDGER_CONTEXT_KEY = 'auditLedger' as const;
export const AUDIT_LEDGER_SCHEMA_VERSION = 1 as const;

export type PineReportContextKey =
    | keyof EngineContextSnapshot
    | typeof REPORT_SERIES_CONTEXT_KEY
    | typeof REPORT_TAIL_CONTEXT_KEY
    | typeof AUDIT_LEDGER_CONTEXT_KEY;

/**
 * Vela forwards context selections to an engine without validating their keys. Keep the
 * one SDK-boundary cast here so hosts can opt into PineTS report data without widening the
 * registry Vela package's engine-neutral ContextSelect contract.
 */
export function pineContextSelect(...keys: readonly PineReportContextKey[]): ContextSelect {
    return keys as ContextSelect;
}

export interface StrategyReportPoint {
    readonly barIndex: number;
    readonly time: number;
    readonly closeTime?: number;
    readonly equity: number;
    readonly realizedPnl: number;
    readonly openPnl: number;
    readonly underwater: number;
    /** Percentage points: 12.5 means 12.5%. */
    readonly underwaterPercent: number | null;
    readonly maxDrawdown: number;
    /** Percentage points: 12.5 means 12.5%. */
    readonly maxDrawdownPercent: number;
    readonly benchmarkEquity: number | null;
    readonly benchmarkPnl: number | null;
    /** Percentage points: 12.5 means 12.5%. */
    readonly benchmarkReturnPercent: number | null;
}

/** Full history for reportSeries; reportTail uses the same envelope with 0–1 points. */
export interface StrategyReportSeriesSnapshot {
    readonly schemaVersion: 1;
    readonly runId: string;
    readonly snapshotRevision: number;
    readonly barIndex: number;
    readonly points: readonly StrategyReportPoint[];
}

export type StrategyAuditOrderKind = 'created' | 'filled' | 'cancelled' | 'rejected';
export type StrategyAuditOrderType = 'market' | 'limit' | 'stop' | 'stop-limit';
export type StrategyAuditCategory = 'entry' | 'exit';

/** A neutral copy of one PineTS internal order lifecycle event. */
export interface StrategyAuditOrderEvent {
    readonly eventId: string;
    readonly orderId: string;
    readonly sourceOrderId?: string;
    readonly kind: StrategyAuditOrderKind;
    readonly barIndex: number;
    readonly time: number;
    readonly direction: -1 | 0 | 1;
    readonly qty: number;
    readonly orderType: StrategyAuditOrderType;
    readonly category?: StrategyAuditCategory;
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

/** A neutral copy of one actual PineTS fill event. */
export interface StrategyAuditFillEvent {
    readonly fillId: string;
    readonly orderId: string;
    readonly sourceOrderId?: string;
    readonly barIndex: number;
    readonly time: number;
    readonly direction: -1 | 0 | 1;
    readonly qty: number;
    readonly price: number;
    readonly orderType: StrategyAuditOrderType;
    readonly category?: StrategyAuditCategory;
    readonly tradeIds?: readonly string[];
    /** Additive relation/progress fields. They remain optional so schema-v1
     * snapshots produced by older local forks continue to validate. */
    readonly parentOrderIds?: readonly string[];
    readonly reversalOfOrderId?: string;
    readonly reversalOfTradeIds?: readonly string[];
    readonly requestedQty?: number;
    readonly cumulativeQty?: number;
    readonly remainingQty?: number;
    readonly fillSequence?: number;
    readonly isPartial?: boolean;
}

/**
 * Versioned diagnostic ledger. It is intentionally separate from
 * `EngineContextSnapshot.strategy` and from the domain `rawOrders/rawFills`
 * capability; consumers must explicitly select `auditLedger` and still must
 * treat this as an experimental, bridge-local event stream.
 */
export interface StrategyAuditLedgerSnapshot {
    readonly schemaVersion: typeof AUDIT_LEDGER_SCHEMA_VERSION;
    readonly runId: string;
    readonly snapshotRevision: number;
    readonly barIndex: number;
    readonly sequence: number;
    readonly orderEvents: readonly StrategyAuditOrderEvent[];
    readonly fillEvents: readonly StrategyAuditFillEvent[];
}

export interface PineReportIdentity {
    readonly runId: string;
    readonly snapshotRevision: number;
}

interface ReportCtx {
    fullContext?: ReportCtx;
    _reportRunId?: unknown;
    _reportSnapshotRevision?: unknown;
}

let reportRunSequence = 0;
const reportRealmId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A new id for one static evaluation or one persistent live-stream lifetime. */
export function nextReportRunId(instanceId: string): string {
    reportRunSequence += 1;
    return `pine-report:${encodeURIComponent(instanceId)}:${reportRealmId}:${reportRunSequence}`;
}

/** Stamp the already-computed raw context before its model becomes observable. */
export function stampReportIdentity(ctx: unknown, runId: string, snapshotRevision: number): void {
    if (ctx == null || typeof ctx !== 'object') return;
    const outer = ctx as ReportCtx;
    const root = outer.fullContext ?? outer;
    root._reportRunId = runId;
    root._reportSnapshotRevision = snapshotRevision;
}

export function reportIdentityOf(ctx: unknown): PineReportIdentity | undefined {
    if (ctx == null || typeof ctx !== 'object') return undefined;
    const outer = ctx as ReportCtx;
    const root = outer.fullContext ?? outer;
    const runId = typeof root._reportRunId === 'string' && root._reportRunId.length > 0
        ? root._reportRunId
        : undefined;
    const snapshotRevision = typeof root._reportSnapshotRevision === 'number'
        && Number.isSafeInteger(root._reportSnapshotRevision)
        && root._reportSnapshotRevision > 0
        ? root._reportSnapshotRevision
        : undefined;
    return runId !== undefined && snapshotRevision !== undefined
        ? { runId, snapshotRevision }
        : undefined;
}
