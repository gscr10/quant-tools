// Build the NEUTRAL, serializable EngineContextSnapshot from a PineTS run context.
// Same narrow-contract philosophy as PineRun.ts: we read a few known fields and
// deep-copy only what survives structured cloning — live references never escape.
import type { EngineContextSnapshot, ContextSelect } from '@luxalgo/vela/plugin';
import { normalizeContext } from './normalizeContext';
import { toStrategyState, toStrategyTrades } from './strategyState';
import type { PineExecutionProvenance } from '../build-info';
import type { BarMagnifierStatus } from 'pinets';
import {
    AUDIT_LEDGER_CONTEXT_KEY,
    AUDIT_LEDGER_SCHEMA_VERSION,
    REPORT_SERIES_CONTEXT_KEY,
    REPORT_TAIL_CONTEXT_KEY,
    reportIdentityOf,
    type StrategyAuditCategory,
    type StrategyAuditFillEvent,
    type StrategyAuditLedgerSnapshot,
    type StrategyAuditOrderEvent,
    type StrategyAuditOrderKind,
    type StrategyAuditOrderType,
    type StrategyReportPoint,
    type StrategyReportSeriesSnapshot,
} from './reportSeries';

/** Optional addon metadata carried beside (never inside) script business data. */
export type PineContextSnapshot = EngineContextSnapshot & {
    readonly provenance?: PineExecutionProvenance;
    /** Actual broker precision; requested/applied are intentionally separate. */
    readonly executionPrecision?: BarMagnifierStatus;
    readonly reportSeries?: StrategyReportSeriesSnapshot;
    readonly reportTail?: StrategyReportSeriesSnapshot;
    /** Explicitly selected, bridge-local PineTS lifecycle audit. */
    readonly auditLedger?: StrategyAuditLedgerSnapshot;
};

interface RawCtx {
    fullContext?: RawCtx;
    idx?: unknown;
    length?: unknown;
    params?: Record<string, unknown>;
    const?: Record<string, unknown>;
    var?: Record<string, unknown>;
    let?: Record<string, unknown>;
    strategy?: {
        _report_series?: unknown;
        _order_events?: unknown;
        _fill_events?: unknown;
        _ledger_sequence?: unknown;
    };
    executionPrecision?: BarMagnifierStatus;
    warnings?: Array<{ message?: unknown; method?: unknown; bar?: unknown }>;
}

const finite = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const nullableFinite = (value: unknown): number | null => finite(value) ?? null;

function reportPoint(raw: unknown): StrategyReportPoint | undefined {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const p = raw as Record<string, unknown>;
    const barIndex = finite(p.barIndex);
    const time = finite(p.time);
    const equity = finite(p.equity);
    const realizedPnl = finite(p.realizedPnl);
    const openPnl = finite(p.openPnl);
    const underwater = finite(p.underwater);
    const maxDrawdown = finite(p.maxDrawdown);
    const maxDrawdownPercent = finite(p.maxDrawdownPercent);
    if (
        barIndex === undefined
        || time === undefined
        || equity === undefined
        || realizedPnl === undefined
        || openPnl === undefined
        || underwater === undefined
        || maxDrawdown === undefined
        || maxDrawdownPercent === undefined
    ) return undefined;
    const closeTime = finite(p.closeTime);
    return {
        barIndex,
        time,
        ...(closeTime !== undefined ? { closeTime } : {}),
        equity,
        realizedPnl,
        openPnl,
        underwater,
        underwaterPercent: nullableFinite(p.underwaterPercent),
        maxDrawdown,
        maxDrawdownPercent,
        benchmarkEquity: nullableFinite(p.benchmarkEquity),
        benchmarkPnl: nullableFinite(p.benchmarkPnl),
        benchmarkReturnPercent: nullableFinite(p.benchmarkReturnPercent),
    };
}

function reportSnapshot(
    raw: unknown,
    identity: ReturnType<typeof reportIdentityOf>,
    barIndex: number,
    tailOnly: boolean,
): StrategyReportSeriesSnapshot | undefined {
    if (!identity || !Array.isArray(raw)) return undefined;
    const source = tailOnly ? raw.slice(-1) : raw;
    const points = source.map(reportPoint).filter((point): point is StrategyReportPoint => point !== undefined);
    return {
        schemaVersion: 1,
        runId: identity.runId,
        snapshotRevision: identity.snapshotRevision,
        barIndex,
        points,
    };
}

const AUDIT_ORDER_KINDS: readonly StrategyAuditOrderKind[] = ['created', 'filled', 'cancelled', 'rejected'];
const AUDIT_ORDER_TYPES: readonly StrategyAuditOrderType[] = ['market', 'limit', 'stop', 'stop-limit'];
const AUDIT_CATEGORIES: readonly StrategyAuditCategory[] = ['entry', 'exit'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const finiteNumber = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const safeNonNegativeInteger = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return undefined;
    return value;
};

const nonEmptyString = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

const optionalFinite = (source: Record<string, unknown>, key: string): number | undefined | null => {
    if (!(key in source) || source[key] === undefined) return undefined;
    const value = finiteNumber(source[key]);
    return value === undefined ? null : value;
};

const optionalString = (source: Record<string, unknown>, key: string): string | undefined | null => {
    if (!(key in source) || source[key] === undefined) return undefined;
    const value = nonEmptyString(source[key]);
    return value === undefined ? null : value;
};

const optionalCategory = (source: Record<string, unknown>): StrategyAuditCategory | undefined | null => {
    if (!('category' in source) || source.category === undefined) return undefined;
    return AUDIT_CATEGORIES.includes(source.category as StrategyAuditCategory)
        ? source.category as StrategyAuditCategory
        : null;
};

const optionalStringArray = (source: Record<string, unknown>, key: string): readonly string[] | undefined | null => {
    if (!(key in source) || source[key] === undefined) return undefined;
    if (!Array.isArray(source[key])) return null;
    const ids = source[key].map((value) => nonEmptyString(value));
    return ids.every((value): value is string => value !== undefined) ? Object.freeze(ids) : null;
};

const optionalBoolean = (source: Record<string, unknown>, key: string): boolean | undefined | null => {
    if (!(key in source) || source[key] === undefined) return undefined;
    return typeof source[key] === 'boolean' ? source[key] : null;
};

const optionalNonNegativeInteger = (source: Record<string, unknown>, key: string): number | undefined | null => {
    if (!(key in source) || source[key] === undefined) return undefined;
    return safeNonNegativeInteger(source[key]) ?? null;
};

/**
 * Freeze an audit envelope at the public bridge boundary. Worker structured
 * cloning removes the source realm's frozen bits, so PineWorkerEngine calls
 * this helper again after receiving a context result.
 */
export function freezeAuditLedgerSnapshot(snapshot: StrategyAuditLedgerSnapshot): StrategyAuditLedgerSnapshot {
    // The Worker boundary is a trust boundary: a malformed host/test frame
    // must not throw from the message dispatcher and strand a pending
    // getContext() promise. Valid snapshots are produced by
    // auditLedgerSnapshot(); this guard only makes the re-freeze helper
    // fail-safe for externally supplied structured-clone data.
    if (
        snapshot == null
        || typeof snapshot !== 'object'
        || !Array.isArray(snapshot.orderEvents)
        || !Array.isArray(snapshot.fillEvents)
    ) return snapshot;
    for (const event of snapshot.orderEvents) {
        if (isRecord(event)) {
            if (Array.isArray(event.tradeIds)) Object.freeze(event.tradeIds);
            if (Array.isArray(event.parentOrderIds)) Object.freeze(event.parentOrderIds);
            if (Array.isArray(event.reversalOfTradeIds)) Object.freeze(event.reversalOfTradeIds);
            Object.freeze(event);
        }
    }
    for (const event of snapshot.fillEvents) {
        if (isRecord(event)) {
            if (Array.isArray(event.tradeIds)) Object.freeze(event.tradeIds);
            if (Array.isArray(event.parentOrderIds)) Object.freeze(event.parentOrderIds);
            if (Array.isArray(event.reversalOfTradeIds)) Object.freeze(event.reversalOfTradeIds);
            Object.freeze(event);
        }
    }
    Object.freeze(snapshot.orderEvents);
    Object.freeze(snapshot.fillEvents);
    return Object.freeze(snapshot);
}

function auditOrderEvent(raw: unknown): StrategyAuditOrderEvent | undefined {
    if (!isRecord(raw)) return undefined;
    const eventId = nonEmptyString(raw.eventId);
    const orderId = nonEmptyString(raw.orderId);
    const kind = AUDIT_ORDER_KINDS.includes(raw.kind as StrategyAuditOrderKind)
        ? raw.kind as StrategyAuditOrderKind
        : undefined;
    const barIndex = safeNonNegativeInteger(raw.barIndex);
    const time = finiteNumber(raw.time);
    const direction = raw.direction === -1 || raw.direction === 0 || raw.direction === 1 ? raw.direction : undefined;
    const qty = finiteNumber(raw.qty);
    const orderType = AUDIT_ORDER_TYPES.includes(raw.orderType as StrategyAuditOrderType)
        ? raw.orderType as StrategyAuditOrderType
        : undefined;
    if (
        eventId === undefined
        || orderId === undefined
        || kind === undefined
        || barIndex === undefined
        || time === undefined
        || time < 0
        || direction === undefined
        || qty === undefined
        || qty < 0
        || orderType === undefined
    ) return undefined;
    const category = optionalCategory(raw);
    const sourceOrderId = optionalString(raw, 'sourceOrderId');
    const limit = optionalFinite(raw, 'limit');
    const stop = optionalFinite(raw, 'stop');
    const fillPrice = optionalFinite(raw, 'fillPrice');
    const fillQty = optionalFinite(raw, 'fillQty');
    const tradeIds = optionalStringArray(raw, 'tradeIds');
    const reason = optionalString(raw, 'reason');
    const parentOrderIds = optionalStringArray(raw, 'parentOrderIds');
    const reversalOfOrderId = optionalString(raw, 'reversalOfOrderId');
    const reversalOfTradeIds = optionalStringArray(raw, 'reversalOfTradeIds');
    const requestedQty = optionalFinite(raw, 'requestedQty');
    const cumulativeFillQty = optionalFinite(raw, 'cumulativeFillQty');
    const remainingQty = optionalFinite(raw, 'remainingQty');
    const fillSequence = optionalNonNegativeInteger(raw, 'fillSequence');
    const isPartial = optionalBoolean(raw, 'isPartial');
    if (
        category === null
        || sourceOrderId === null
        || limit === null
        || stop === null
        || fillPrice === null
        || fillQty === null
        || tradeIds === null
        || reason === null
        || parentOrderIds === null
        || reversalOfOrderId === null
        || reversalOfTradeIds === null
        || requestedQty === null
        || cumulativeFillQty === null
        || remainingQty === null
        || fillSequence === null
        || isPartial === null
    ) return undefined;
    if (fillQty !== undefined && (fillQty < 0 || !Number.isFinite(fillQty))) return undefined;
    if (
        (requestedQty !== undefined && requestedQty < 0)
        || (cumulativeFillQty !== undefined && cumulativeFillQty < 0)
        || (remainingQty !== undefined && remainingQty < 0)
    ) return undefined;
    return {
        eventId,
        orderId,
        ...(sourceOrderId !== undefined ? { sourceOrderId } : {}),
        kind,
        barIndex,
        time,
        direction,
        qty,
        orderType,
        ...(category !== undefined ? { category } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(stop !== undefined ? { stop } : {}),
        ...(fillPrice !== undefined ? { fillPrice } : {}),
        ...(fillQty !== undefined ? { fillQty } : {}),
        ...(tradeIds !== undefined ? { tradeIds } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(parentOrderIds !== undefined ? { parentOrderIds } : {}),
        ...(reversalOfOrderId !== undefined ? { reversalOfOrderId } : {}),
        ...(reversalOfTradeIds !== undefined ? { reversalOfTradeIds } : {}),
        ...(requestedQty !== undefined ? { requestedQty } : {}),
        ...(cumulativeFillQty !== undefined ? { cumulativeFillQty } : {}),
        ...(remainingQty !== undefined ? { remainingQty } : {}),
        ...(fillSequence !== undefined ? { fillSequence } : {}),
        ...(isPartial !== undefined ? { isPartial } : {}),
    };
}

function auditFillEvent(raw: unknown): StrategyAuditFillEvent | undefined {
    if (!isRecord(raw)) return undefined;
    const fillId = nonEmptyString(raw.fillId);
    const orderId = nonEmptyString(raw.orderId);
    const sourceOrderId = optionalString(raw, 'sourceOrderId');
    const barIndex = safeNonNegativeInteger(raw.barIndex);
    const time = finiteNumber(raw.time);
    const direction = raw.direction === -1 || raw.direction === 0 || raw.direction === 1 ? raw.direction : undefined;
    const qty = finiteNumber(raw.qty);
    const price = finiteNumber(raw.price);
    const orderType = AUDIT_ORDER_TYPES.includes(raw.orderType as StrategyAuditOrderType)
        ? raw.orderType as StrategyAuditOrderType
        : undefined;
    const category = optionalCategory(raw);
    const tradeIds = optionalStringArray(raw, 'tradeIds');
    const parentOrderIds = optionalStringArray(raw, 'parentOrderIds');
    const reversalOfOrderId = optionalString(raw, 'reversalOfOrderId');
    const reversalOfTradeIds = optionalStringArray(raw, 'reversalOfTradeIds');
    const requestedQty = optionalFinite(raw, 'requestedQty');
    const cumulativeQty = optionalFinite(raw, 'cumulativeQty');
    const remainingQty = optionalFinite(raw, 'remainingQty');
    const fillSequence = optionalNonNegativeInteger(raw, 'fillSequence');
    const isPartial = optionalBoolean(raw, 'isPartial');
    if (
        fillId === undefined
        || orderId === undefined
        || sourceOrderId === null
        || barIndex === undefined
        || time === undefined
        || time < 0
        || direction === undefined
        || qty === undefined
        || qty < 0
        || price === undefined
        || orderType === undefined
        || category === null
        || tradeIds === null
        || parentOrderIds === null
        || reversalOfOrderId === null
        || reversalOfTradeIds === null
        || requestedQty === null
        || cumulativeQty === null
        || remainingQty === null
        || fillSequence === null
        || isPartial === null
    ) return undefined;
    if (
        (requestedQty !== undefined && requestedQty < 0)
        || (cumulativeQty !== undefined && cumulativeQty < 0)
        || (remainingQty !== undefined && remainingQty < 0)
    ) return undefined;
    return {
        fillId,
        orderId,
        ...(sourceOrderId !== undefined ? { sourceOrderId } : {}),
        barIndex,
        time,
        direction,
        qty,
        price,
        orderType,
        ...(category !== undefined ? { category } : {}),
        ...(tradeIds !== undefined ? { tradeIds } : {}),
        ...(parentOrderIds !== undefined ? { parentOrderIds } : {}),
        ...(reversalOfOrderId !== undefined ? { reversalOfOrderId } : {}),
        ...(reversalOfTradeIds !== undefined ? { reversalOfTradeIds } : {}),
        ...(requestedQty !== undefined ? { requestedQty } : {}),
        ...(cumulativeQty !== undefined ? { cumulativeQty } : {}),
        ...(remainingQty !== undefined ? { remainingQty } : {}),
        ...(fillSequence !== undefined ? { fillSequence } : {}),
        ...(isPartial !== undefined ? { isPartial } : {}),
    };
}

/**
 * Convert and validate the private PineTS ledger only when the experimental
 * selector was requested. Any malformed row invalidates the whole envelope;
 * returning a partial stream would make it unsafe to compare with trades.
 */
/** Validate and normalize a cloned audit envelope before a host consumes it. */
export function validateAuditLedgerSnapshot(value: unknown): StrategyAuditLedgerSnapshot | undefined {
    if (!isRecord(value) || value.schemaVersion !== AUDIT_LEDGER_SCHEMA_VERSION) return undefined;
    const runId = nonEmptyString(value.runId);
    const snapshotRevision = safeNonNegativeInteger(value.snapshotRevision);
    const barIndex = safeNonNegativeInteger(value.barIndex);
    const sequence = safeNonNegativeInteger(value.sequence);
    if (
        runId === undefined
        || snapshotRevision === undefined
        || snapshotRevision < 1
        || barIndex === undefined
        || sequence === undefined
        || !Array.isArray(value.orderEvents)
        || !Array.isArray(value.fillEvents)
    ) return undefined;
    const normalizedOrders: StrategyAuditOrderEvent[] = [];
    const normalizedFills: StrategyAuditFillEvent[] = [];
    const orderEventIds = new Set<string>();
    const fillEventIds = new Set<string>();
    for (const raw of value.orderEvents) {
        const event = auditOrderEvent(raw);
        if (!event || orderEventIds.has(event.eventId)) return undefined;
        orderEventIds.add(event.eventId);
        normalizedOrders.push(event);
    }
    for (const raw of value.fillEvents) {
        const event = auditFillEvent(raw);
        if (!event || fillEventIds.has(event.fillId)) return undefined;
        fillEventIds.add(event.fillId);
        normalizedFills.push(event);
    }
    const snapshot: StrategyAuditLedgerSnapshot = {
        schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
        runId,
        snapshotRevision,
        barIndex,
        sequence,
        orderEvents: normalizedOrders,
        fillEvents: normalizedFills,
    };
    return freezeAuditLedgerSnapshot(snapshot);
}

function auditLedgerSnapshot(
    strategy: RawCtx['strategy'],
    identity: ReturnType<typeof reportIdentityOf>,
    barIndex: number,
): StrategyAuditLedgerSnapshot | undefined {
    if (!strategy || !identity || !Array.isArray(strategy._order_events) || !Array.isArray(strategy._fill_events)) return undefined;
    const sequence = safeNonNegativeInteger(strategy._ledger_sequence);
    const normalizedBarIndex = safeNonNegativeInteger(barIndex);
    if (sequence === undefined || normalizedBarIndex === undefined) return undefined;
    return validateAuditLedgerSnapshot({
        schemaVersion: AUDIT_LEDGER_SCHEMA_VERSION,
        runId: identity.runId,
        snapshotRevision: identity.snapshotRevision,
        barIndex: normalizedBarIndex,
        sequence,
        orderEvents: strategy._order_events,
        fillEvents: strategy._fill_events,
    });
}

/** Deep-copy a value if it survives structured cloning; undefined otherwise. */
function cloneable(v: unknown): unknown {
    try {
        return structuredClone(v);
    } catch {
        return undefined;
    }
}

/**
 * A PineTS variable's value AT THE LAST COMPUTED BAR. The transpiler stores a series as
 * `{ data: [...one entry per bar...] }`, and the snapshot contract is current values, not
 * per-bar buffers — a host wanting the history asks for the plot instead.
 */
function currentValue(v: unknown): unknown {
    const data = Array.isArray(v) ? v : v != null && typeof v === 'object' && Array.isArray((v as { data?: unknown }).data) ? (v as { data: unknown[] }).data : null;
    return cloneable(data ? data[data.length - 1] : v);
}

/**
 * The name as WRITTEN in the source. PineTS scopes globals as `glb<n>_<name>`; that scheme
 * is the transpiler's business and the contract forbids leaking it. Bucket names go too —
 * a script's `posSize` is `posSize`, wherever the transpiler filed it.
 */
function sourceName(key: string): string {
    return key.replace(/^glb\d+_/, '');
}

/** Serializable subset of a variables bucket, keyed by source names, at the current bar. */
function pickVars(bucket: Record<string, unknown> | undefined, into: Record<string, unknown>): void {
    if (!bucket) return;
    for (const [k, v] of Object.entries(bucket)) {
        if (k.startsWith('_')) continue;
        const c = currentValue(v);
        if (c !== undefined) into[sourceName(k)] = c;
    }
}

export function snapshotFromCtx(
    ctx: unknown,
    phase: EngineContextSnapshot['phase'],
    select?: ContextSelect,
    provenance?: PineExecutionProvenance,
): PineContextSnapshot {
    const c = (ctx ?? {}) as RawCtx;
    const root = c.fullContext ?? c;
    const want = (k: keyof EngineContextSnapshot): boolean => !select || select.includes(k);
    const selected = select as readonly string[] | undefined;
    // Private report channels are intentionally opt-in even when select is omitted.
    const wantReportSeries = selected?.includes(REPORT_SERIES_CONTEXT_KEY) === true;
    const wantReportTail = selected?.includes(REPORT_TAIL_CONTEXT_KEY) === true;
    // The audit stream is even narrower: unlike strategy/trades it is never
    // included by a broad/default selection and is only copied for the
    // explicit, versioned experimental selector.
    const wantAuditLedger = selected?.includes(AUDIT_LEDGER_CONTEXT_KEY) === true;
    const run = want('meta') || want('plots') ? normalizeContext(ctx) : null;
    const reportIdentity = reportIdentityOf(root);

    const plots: EngineContextSnapshot['plots'] = {};
    if (run && want('plots')) {
        for (const p of run.plots) {
            if (p.key.startsWith('__')) continue; // engine-internal channels (drawings buffers)
            plots[p.key] = p.data.map((pt) => ({ time: pt.time, value: cloneable(pt.value) ?? null }));
        }
    }
    const variables: Record<string, unknown> = {};
    if (want('variables')) {
        // `params` holds the transpiler's positional slots (the literal `0` in
        // `ta.crossover(x, 0)`), never anything the script named — it stays out.
        pickVars(root.const, variables);
        pickVars(root.var, variables);
        pickVars(root.let, variables);
    }
    // Only a strategy() script builds a broker ledger; its absence is what tells the core
    // this run is an ordinary indicator.
    const strategy = want('strategy') ? toStrategyState(root.strategy, reportIdentity) : undefined;
    const trades = want('trades') && root.strategy ? toStrategyTrades(root.strategy) : undefined;
    const barIndexRaw = typeof root.idx === 'number' ? root.idx : typeof root.length === 'number' ? root.length - 1 : -1;
    const reportSeries = wantReportSeries
        ? reportSnapshot(root.strategy?._report_series, reportIdentity, barIndexRaw, false)
        : undefined;
    const reportTail = wantReportTail
        ? reportSnapshot(root.strategy?._report_series, reportIdentity, barIndexRaw, true)
        : undefined;
    const auditLedger = wantAuditLedger
        ? auditLedgerSnapshot(root.strategy, reportIdentity, barIndexRaw)
        : undefined;
    return {
        language: 'pine',
        phase,
        barIndex: barIndexRaw,
        meta: run && want('meta')
            ? { title: run.meta.title, overlay: run.meta.overlay, precision: run.meta.precision, shorttitle: run.meta.shorttitle }
            : { title: '', overlay: false },
        plots,
        variables,
        ...(strategy ? { strategy } : {}),
        ...(trades && trades.length > 0 ? { trades } : {}),
        ...(reportSeries ? { reportSeries } : {}),
        ...(reportTail ? { reportTail } : {}),
        ...(auditLedger ? { auditLedger } : {}),
        ...(root.executionPrecision ? { executionPrecision: cloneable(root.executionPrecision) as BarMagnifierStatus } : {}),
        warnings: want('warnings')
            ? (root.warnings ?? []).map((w) => ({ message: String(w.message ?? ''), method: typeof w.method === 'string' ? w.method : undefined, bar: Number(w.bar ?? 0) }))
            : [],
        ...(provenance ? { provenance } : {}),
    };
}
