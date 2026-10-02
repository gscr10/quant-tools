import { describe, expect, it } from 'vitest';
import type { OHLCV, PreparedScript } from '@luxalgo/vela/plugin';
import type { MainToWorker, WorkerToMain } from '../src/pinets-worker/protocol';
import { preparePine, indicatorFor, runPineStatic } from '../src/pinets/runtime';
import { pineContextSelect } from '../src/pinets/reportSeries';
import { snapshotFromCtx } from '../src/pinets/contextSnapshot';

const HOUR = 60 * 60_000;
const TEN_MIN = 10 * 60_000;
const T0 = Date.UTC(2024, 0, 1);

const parent = (index: number, open: number, high: number, low: number, close: number): OHLCV & { closeTime: number } => ({
    time: T0 + index * HOUR,
    closeTime: T0 + (index + 1) * HOUR - 1,
    open,
    high,
    low,
    close,
    volume: 1,
});

const child = (index: number, open: number, high: number, low: number, close: number): OHLCV & { closeTime: number } => ({
    time: T0 + index * TEN_MIN,
    closeTime: T0 + (index + 1) * TEN_MIN - 1,
    open,
    high,
    low,
    close,
    volume: 1,
});

const bars = [
    parent(0, 100, 101, 99, 100),
    parent(1, 100, 101, 99, 100),
    parent(2, 100, 110, 90, 100),
];
const children = [
    ...Array.from({ length: 12 }, (_, i) => child(i, 100, 101, 99, 100)),
    child(12, 100, 100, 94, 95),
    child(13, 95, 106, 95, 105),
    child(14, 105, 110, 100, 100),
    ...Array.from({ length: 3 }, (_, i) => child(15 + i, 100, 101, 99, 100)),
];

const SOURCE = `
//@version=6
strategy('worker magnifier parity', default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index == 0
    strategy.entry('L', strategy.long)
if bar_index >= 1
    strategy.exit('X', 'L', stop=95, limit=105)
`;

/** Minimal real worker harness, matching the browser Worker message boundary. */
type WorkerHarness = { send(message: MainToWorker): void; out: WorkerToMain[] };
type TradeFixture = {
    id: string;
    entry_time: number;
};
type PineStrategyFixture = {
    closedtrades?: TradeFixture[];
};
type PineRunContextFixture = {
    strategy?: PineStrategyFixture;
};
let harness: WorkerHarness | undefined;
async function workerHarness(): Promise<WorkerHarness> {
    if (harness) return harness;
    const out: WorkerToMain[] = [];
    const listeners: Array<(event: { data: unknown }) => void> = [];
    (globalThis as Record<string, unknown>).self = {
        postMessage: (message: unknown) => out.push(message as WorkerToMain),
        addEventListener: (_type: string, listener: (event: { data: unknown }) => void) => listeners.push(listener),
    };
    await import('../src/pinets-worker/worker');
    harness = { send: (message) => listeners.forEach((listener) => listener({ data: message })), out };
    return harness;
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 0));
    if (!predicate()) throw new Error('worker test timed out');
}

describe('Bar Magnifier worker/in-process parity', () => {
    it('reuses one provider identity across unchanged static worker runs', async () => {
        const source = `//@version=6
strategy('worker lower-feed cache', use_bar_magnifier=true)
plot(close)
`;
        const w = await workerHarness();
        const reqId = 31;
        w.send({ kind: 'prepare', reqId, source, instanceId: 'worker-lower-feed-cache' });
        await waitFor(() => w.out.some((message) => message.kind === 'prepared' && message.reqId === reqId));
        const preparedMessage = w.out.find(
            (message): message is Extract<WorkerToMain, { kind: 'prepared' }> =>
                message.kind === 'prepared' && message.reqId === reqId,
        )!;
        expect(preparedMessage.error).toBeUndefined();

        const sessionId = 32;
        w.send({
            kind: 'execute',
            sessionId,
            prepared: preparedMessage.prepared as PreparedScript,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars: [parent(0, 100, 101, 99, 100)],
            inputs: {},
            mode: 'static',
            historyState: 'complete',
        });
        await waitFor(() => w.out.some(
            (message) => message.kind === 'fetchSeries' && message.sessionId === sessionId,
        ));
        const firstFetch = w.out.find(
            (message): message is Extract<WorkerToMain, { kind: 'fetchSeries' }> =>
                message.kind === 'fetchSeries' && message.sessionId === sessionId,
        )!;
        w.send({ kind: 'fetchSeriesResult', reqId: firstFetch.reqId, bars: [child(0, 100, 101, 99, 100)] });
        await waitFor(() => w.out.some((message) => message.kind === 'done' && message.sessionId === sessionId));

        const fetchCount = (): number => w.out.filter(
            (message) => message.kind === 'fetchSeries' && message.sessionId === sessionId,
        ).length;
        expect(fetchCount()).toBe(1);
        w.send({ kind: 'update', sessionId, inputs: {} });
        await waitFor(() => w.out.filter(
            (message) => message.kind === 'done' && message.sessionId === sessionId,
        ).length === 2);
        // The range and provider session are unchanged.  The worker must keep
        // the same gateway closure so the provider-aware cache can hit.
        expect(fetchCount()).toBe(1);
        w.send({ kind: 'stop', sessionId });
    });

    it('keeps inclusive closeTime fills identical across the worker boundary', async () => {
        const prepared = preparePine(SOURCE, 'worker-parity');
        const precision = {
            requested: true as const,
            lowerTimeframe: '10',
            bars: children.map((bar) => ({
                openTime: bar.time,
                closeTime: bar.closeTime,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
            })),
        };
        const inProcess = await runPineStatic({
            ind: indicatorFor({}, SOURCE, {}),
            bars,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            visibleRange: undefined,
            prepared,
            instanceId: 'worker-parity',
            inputs: {},
            props: {},
            fetchSeries: undefined,
            barMagnifier: precision,
        });
        const inProcessContext = inProcess.ctx as PineRunContextFixture;
        const inProcessTrade = inProcessContext.strategy?.closedtrades?.[0];
        if (!inProcessTrade) throw new Error('in-process strategy did not close a trade');
        expect(inProcessTrade).toMatchObject({ exit_price: 95, exit_time: children[12]!.time, exit_bar_index: 2 });
        const inProcessAudit = snapshotFromCtx(
            inProcess.ctx,
            'idle',
            pineContextSelect('auditLedger'),
        ).auditLedger;
        expect(inProcessAudit?.orderEvents.length).toBeGreaterThan(0);
        expect(inProcessAudit?.fillEvents.length).toBeGreaterThan(0);

        const w = await workerHarness();
        const reqId = 41;
        w.send({ kind: 'prepare', reqId, source: SOURCE, instanceId: 'worker-parity' });
        await waitFor(() => w.out.some((message) => message.kind === 'prepared' && message.reqId === reqId));
        const preparedMessage = w.out.find((message): message is Extract<WorkerToMain, { kind: 'prepared' }> => message.kind === 'prepared' && message.reqId === reqId)!;
        expect(preparedMessage.error).toBeUndefined();
        const sessionId = 42;
        w.send({
            kind: 'execute',
            sessionId,
            prepared: preparedMessage.prepared as PreparedScript,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars,
            inputs: {},
            mode: 'static',
            historyState: 'complete',
            barMagnifier: precision,
        });
        await waitFor(() => w.out.some((message) => message.kind === 'done' && message.sessionId === sessionId));
        const contextRequestId = 43;
        w.send({ kind: 'getContext', sessionId, reqId: contextRequestId, select: ['trades'] });
        await waitFor(() => w.out.some((message) => message.kind === 'contextResult' && message.reqId === contextRequestId));
        const snapshot = w.out.find((message): message is Extract<WorkerToMain, { kind: 'contextResult' }> => message.kind === 'contextResult' && message.reqId === contextRequestId)!.snapshot;
        expect(snapshot?.trades).toMatchObject([{
            id: inProcessTrade.id,
            side: 'long',
            qty: 1,
            entry: { id: 'L', price: 100, time: inProcessTrade.entry_time },
            entryBarIndex: 1,
            exit: { id: 'X', price: 95, time: children[12]!.time },
            exitBarIndex: 2,
            pnl: -5,
            open: false,
        }]);
        const auditRequestId = 44;
        w.send({
            kind: 'getContext',
            sessionId,
            reqId: auditRequestId,
            select: pineContextSelect('auditLedger'),
        });
        await waitFor(() => w.out.some((message) => message.kind === 'contextResult' && message.reqId === auditRequestId));
        const auditSnapshot = w.out.find(
            (message): message is Extract<WorkerToMain, { kind: 'contextResult' }> =>
                message.kind === 'contextResult' && message.reqId === auditRequestId,
        )!.snapshot;
        // Each execution receives its own run identity; the worker must match
        // the in-process lifecycle rows and sequence, while preserving its
        // independently generated runId.
        const { runId: inProcessRunId, ...inProcessLedger } = inProcessAudit!;
        const { runId: workerRunId, ...workerLedger } = auditSnapshot!.auditLedger!;
        expect(workerRunId).not.toBe(inProcessRunId);
        expect(workerLedger).toEqual(inProcessLedger);
        expect(Object.isFrozen(auditSnapshot?.auditLedger)).toBe(true);
        expect(Object.isFrozen(auditSnapshot?.auditLedger?.orderEvents)).toBe(true);
        w.send({ kind: 'stop', sessionId });
    }, 30_000);
});
