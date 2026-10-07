import { describe, expect, it } from 'vitest';
import type { OHLCV, PreparedScript } from '@luxalgo/vela/plugin';
import type { MainToWorker, WorkerToMain } from '../src/pinets-worker/protocol';
import { preparePine, indicatorFor, runPineStatic } from '../src/pinets/runtime';
import { pineContextSelect } from '../src/pinets/reportSeries';
import { snapshotFromCtx, type PineContextSnapshot } from '../src/pinets/contextSnapshot';

const HOUR = 60 * 60_000;
const TEN_MIN = 10 * 60_000;
const T0 = Date.UTC(2024, 0, 2);

const parent = (index: number, price: number): OHLCV & { openTime: number; closeTime: number } => ({
    time: T0 + index * HOUR,
    openTime: T0 + index * HOUR,
    closeTime: T0 + (index + 1) * HOUR - 1,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
});

const child = (index: number, open: number, high: number, low: number, close: number): OHLCV & { openTime: number; closeTime: number } => ({
    time: T0 + index * TEN_MIN,
    openTime: T0 + index * TEN_MIN,
    closeTime: T0 + (index + 1) * TEN_MIN - 1,
    open,
    high,
    low,
    close,
    volume: 1,
});

const parents = [100, 100, 110, 120, 130].map((price, index) => parent(index, price));
const children = [
    // Parent 0 queues the initial long; parent 1 supplies its next open.
    child(0, 100, 100, 100, 100), child(1, 100, 100, 100, 100), child(2, 100, 100, 100, 100),
    child(3, 100, 100, 100, 100), child(4, 100, 100, 100, 100), child(5, 100, 100, 100, 100),
    // Parent 1 adds B on fill recalculation until the pyramiding cap.
    child(6, 100, 100, 100, 100), child(7, 100, 100, 100, 100), child(8, 100, 100, 100, 100),
    child(9, 100, 100, 100, 100), child(10, 100, 100, 100, 100), child(11, 100, 100, 100, 100),
    // Parent 2 queues the partial close; parent 3 supplies its next open.
    child(12, 110, 110, 110, 110), child(13, 110, 110, 110, 110), child(14, 110, 110, 110, 110),
    child(15, 110, 110, 110, 110), child(16, 110, 110, 110, 110), child(17, 110, 110, 110, 110),
    // Parent 3: recalculation queues a reversal at the next child open, 120.
    child(18, 120, 120, 120, 120), child(19, 120, 120, 120, 120), child(20, 120, 120, 120, 120),
    child(21, 120, 120, 120, 120), child(22, 120, 120, 120, 120), child(23, 120, 120, 120, 120),
    ...Array.from({ length: 6 }, (_, offset) => child(24 + offset, 130, 130, 130, 130)),
];

const SOURCE = `//@version=6
strategy('combined worker parity', initial_capital=10000, pyramiding=3,
    default_qty_type=strategy.fixed, commission_type=strategy.commission.cash_per_contract,
    commission_value=0.5, margin_long=50, margin_short=50,
    use_bar_magnifier=true, calc_on_order_fills=true)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=1)
if bar_index == 2
    strategy.close('A', qty=1)
if bar_index == 3
    strategy.entry('S', strategy.short, qty=2)
`;

type WorkerHarness = { send(message: MainToWorker): void; out: WorkerToMain[] };
let harness: WorkerHarness | undefined;

async function workerHarness(): Promise<WorkerHarness> {
    if (harness) return harness;
    const out: WorkerToMain[] = [];
    const listeners: Array<(event: { data: unknown }) => void> = [];
    (globalThis as Record<string, unknown>).self = {
        postMessage: (message: unknown) => out.push(structuredClone(message as WorkerToMain)),
        addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.push(listener),
    };
    await import('../src/pinets-worker/worker');
    harness = { send: (message) => listeners.forEach((listener) => listener({ data: structuredClone(message) })), out };
    return harness;
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 0));
    if (!predicate()) throw new Error('worker complex parity timed out');
}

function withoutRunIdentity(snapshot: PineContextSnapshot | null): PineContextSnapshot | null {
    if (!snapshot) return snapshot;
    const strategy = snapshot.strategy
        ? Object.fromEntries(Object.entries(snapshot.strategy).filter(([key]) => key !== 'reportRunId' && key !== 'reportSnapshotRevision'))
        : undefined;
    const auditLedger = snapshot.auditLedger
        ? { ...snapshot.auditLedger, runId: '<run>' }
        : undefined;
    const { provenance, ...portable } = snapshot;
    void provenance;
    return { ...portable, ...(strategy ? { strategy } : {}), ...(auditLedger ? { auditLedger } : {}) } as PineContextSnapshot;
}

describe('combined broker semantics across worker and in-process engines', () => {
    it('keeps margin, commission, partial close, reversal, recalculation and magnifier output in parity', async () => {
        const prepared = preparePine(SOURCE, 'combined-worker-parity');
        const precision = {
            requested: true as const,
            lowerTimeframe: '10',
            bars: children,
            asOf: T0 + parents.length * HOUR,
        };
        const select = pineContextSelect('strategy', 'trades', 'auditLedger');
        const inProcess = await runPineStatic({
            ind: indicatorFor({}, SOURCE, {}), bars: parents,
            market: { symbol: 'BTCUSDT', timeframe: '60' }, visibleRange: undefined,
            prepared, instanceId: 'combined-worker-parity', inputs: {}, props: {},
            fetchSeries: undefined, barMagnifier: precision,
        });
        const inProcessSnapshot = snapshotFromCtx(inProcess.ctx, 'idle', select);
        expect(inProcessSnapshot.executionPrecision).toMatchObject({
            applied: true, coverage: 1, parentBars: 5, lowerBars: 30,
        });
        expect(inProcessSnapshot.strategy).toBeDefined();
        expect(inProcessSnapshot.trades?.length).toBeGreaterThan(0);
        expect(inProcessSnapshot.auditLedger?.fillEvents.length).toBeGreaterThan(0);

        const w = await workerHarness();
        const prepareReqId = 7101;
        w.send({ kind: 'prepare', reqId: prepareReqId, source: SOURCE, instanceId: 'combined-worker-parity' });
        await waitFor(() => w.out.some((message) => message.kind === 'prepared' && message.reqId === prepareReqId));
        const preparedMessage = w.out.find(
            (message): message is Extract<WorkerToMain, { kind: 'prepared' }> => message.kind === 'prepared' && message.reqId === prepareReqId,
        )!;
        expect(preparedMessage.error).toBeUndefined();
        const sessionId = 7102;
        w.send({
            kind: 'execute', sessionId, prepared: preparedMessage.prepared as PreparedScript,
            market: { symbol: 'BTCUSDT', timeframe: '60' }, bars: parents, inputs: {},
            mode: 'static', historyState: 'complete', barMagnifier: precision,
        });
        await waitFor(() => w.out.some((message) => message.kind === 'done' && message.sessionId === sessionId));
        const contextReqId = 7103;
        w.send({ kind: 'getContext', sessionId, reqId: contextReqId, select });
        await waitFor(() => w.out.some((message) => message.kind === 'contextResult' && message.reqId === contextReqId));
        const workerSnapshot = w.out.find(
            (message): message is Extract<WorkerToMain, { kind: 'contextResult' }> => message.kind === 'contextResult' && message.reqId === contextReqId,
        )!.snapshot;
        expect(workerSnapshot?.executionPrecision).toMatchObject({ applied: true, coverage: 1 });
        expect(withoutRunIdentity(workerSnapshot)).toEqual(withoutRunIdentity(inProcessSnapshot));
        const rejected = workerSnapshot?.auditLedger?.orderEvents.filter((event) => event.kind === 'rejected') ?? [];
        // calc_on_order_fills intentionally replays the strategy on the same
        // parent bar. Once pyramiding is full, those follow-up entries are
        // rejected by policy; parity requires the same explicit reason in
        // both engines rather than treating a legitimate policy rejection as
        // an execution failure.
        expect(rejected.length).toBeGreaterThan(0);
        expect(rejected.every((event) => event.reason === 'pyramiding')).toBe(true);
        expect(workerSnapshot?.auditLedger?.fillEvents.some((event) => event.reversalOfOrderId !== undefined)).toBe(true);
        w.send({ kind: 'stop', sessionId });
    }, 30_000);
});
