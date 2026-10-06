import { describe, expect, it } from 'vitest';
import type { IndicatorModel, OHLCV, PreparedScript } from '@luxalgo/vela/plugin';

import { PineEngine } from '../src/pinets/PineEngine';
import type { PineContextSnapshot } from '../src/pinets/contextSnapshot';
import type { MainToWorker, WorkerToMain } from '../src/pinets-worker/protocol';

const START = Date.UTC(2024, 0, 1);
const MINUTE = 60_000;

function bars(prices: number[]): OHLCV[] {
    return prices.map((price, index) => ({
        time: START + index * MINUTE,
        open: price, high: price, low: price, close: price, volume: 1,
    }));
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('close entries runtime test timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

let nextRequestId = 1;
let worker: { send(message: MainToWorker): void; out: WorkerToMain[] } | undefined;
async function realWorkerRuntime() {
    if (worker) return worker;
    const out: WorkerToMain[] = [];
    const listeners: Array<(event: { data: MainToWorker }) => void> = [];
    (globalThis as Record<string, unknown>).self = {
        postMessage: (message: WorkerToMain) => out.push(structuredClone(message)),
        addEventListener: (_type: string, listener: (event: { data: MainToWorker }) => void) => listeners.push(listener),
    };
    await import('../src/pinets-worker/worker');
    worker = { out, send: (message) => listeners.forEach((listener) => listener({ data: structuredClone(message) })) };
    return worker;
}

function verifyAccounting(snapshot: PineContextSnapshot | null) {
    const trades = snapshot?.trades ?? [];
    const state = snapshot?.strategy;
    const open = trades.filter((trade) => trade.open);
    const closed = trades.filter((trade) => !trade.open);
    const price = snapshot?.barIndex === 3 ? 120 : 130;
    expect(new Set(trades.map((trade) => trade.id)).size).toBe(trades.length);
    expect(closed.reduce((sum, trade) => sum + (trade.pnl ?? 0), 0)).toBe(state?.netPnl);
    expect(open.reduce((sum, trade) => sum + (price - trade.entry.price) * trade.qty, 0)).toBe(state?.openPnl);
    expect(open.reduce((sum, trade) => sum + trade.qty, 0)).toBe(state?.position);
    expect(10000 + state!.netPnl + state!.openPnl).toBe(state?.equity);
}

describe('FIFO accounting rows through both engine execution paths', () => {
    it.each([
        { rule: 'FIFO', partial: false },
        { rule: 'ANY', partial: false },
        { rule: 'FIFO', partial: true },
        { rule: 'ANY', partial: true },
    ])('$rule, partial=$partial: preserves chart entries, open rows and later brackets', async ({ rule, partial }) => {
        const source = `//@version=6
strategy('Accounting projection', initial_capital=10000, pyramiding=2, close_entries_rule='${rule}')
if bar_index == 0
    strategy.entry('A', strategy.long, qty=5)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=10)
if bar_index == 2
    strategy.close('B'${partial ? ', qty_percent=25' : ''})
    strategy.exit('first bracket', from_entry='A', limit=130)
`;
        const engine = new PineEngine();
        const prepared = await engine.prepare(source, 'accounting-projection');
        const market = { symbol: 'BTCUSDT', timeframe: '1' };
        let currentBars = bars([100, 100, 110, 120]);
        let completed = 0;
        let lastModel: IndicatorModel | undefined;
        const errors: Error[] = [];
        const session = engine.execute({
            prepared, market, bars: currentBars, getBars: () => currentBars,
            inputs: {}, mode: 'static', historyState: 'complete',
        }, {
            onModel: (model) => { lastModel = model; },
            onDone: () => { completed += 1; },
            onError: (error) => errors.push(error),
        });
        const runtime = await realWorkerRuntime();
        const prepareId = nextRequestId++;
        const sessionId = nextRequestId++;
        try {
            runtime.send({ kind: 'prepare', reqId: prepareId, source, instanceId: 'accounting-projection' });
            await waitFor(() => runtime.out.some((message) => message.kind === 'prepared' && message.reqId === prepareId));
            const response = runtime.out.find((message): message is Extract<WorkerToMain, { kind: 'prepared' }> =>
                message.kind === 'prepared' && message.reqId === prepareId)!;
            expect(response.error).toBeUndefined();
            runtime.send({
                kind: 'execute', sessionId, prepared: response.prepared as PreparedScript,
                market, bars: currentBars, inputs: {}, mode: 'static', historyState: 'complete',
            });

            for (const pass of [1, 2]) {
                await waitFor(() => completed === pass && runtime.out.filter((message) => message.kind === 'done' && message.sessionId === sessionId).length === pass);
                expect(errors).toEqual([]);
                expect(runtime.out.filter((message) => message.kind === 'error' && message.sessionId === sessionId)).toEqual([]);
                const snapshot = await session.getContext?.(['strategy', 'trades']) as PineContextSnapshot;
                const requestId = nextRequestId++;
                runtime.send({ kind: 'getContext', sessionId, reqId: requestId, select: ['strategy', 'trades'] });
                await waitFor(() => runtime.out.some((message) => message.kind === 'contextResult' && message.reqId === requestId));
                const workerSnapshot = runtime.out.find((message): message is Extract<WorkerToMain, { kind: 'contextResult' }> =>
                    message.kind === 'contextResult' && message.reqId === requestId)!.snapshot;
                verifyAccounting(snapshot);
                verifyAccounting(workerSnapshot);
                expect(workerSnapshot?.trades).toEqual(snapshot.trades);
                const entries = lastModel?.trades?.filter((trade) => trade.kind === 'entry');
                expect(entries?.map((trade) => [trade.label, trade.price, trade.qty])).toEqual([
                    ['A', 100, 5], ['B', 110, 10],
                ]);
                const workerModel = runtime.out.filter((message): message is Extract<WorkerToMain, { kind: 'model' }> =>
                    message.kind === 'model' && message.sessionId === sessionId).at(-1)!.model;
                expect(workerModel.trades).toEqual(lastModel?.trades);

                if (pass === 1) {
                    expect(snapshot.trades?.filter((trade) => trade.open).map((trade) => [trade.entry.id, trade.qty, trade.entry.price]))
                        .toEqual(partial
                            ? rule === 'FIFO' ? [['A', 2.5, 100], ['B', 10, 110]] : [['A', 5, 100], ['B', 7.5, 110]]
                            : rule === 'FIFO' ? [['B', 5, 110]] : [['A', 5, 100]]);
                    currentBars = bars([100, 100, 110, 120, 130]);
                    session.notifyBars();
                    runtime.send({ kind: 'notifyBars', sessionId, bars: currentBars });
                } else {
                    expect(snapshot.strategy?.netPnl).toBe(partial ? 175 : 250);
                    expect(snapshot.trades?.filter((trade) => trade.open).map((trade) => [trade.entry.id, trade.qty]))
                        .toEqual(partial ? [['B', 7.5]] : []);
                }
            }
        } finally {
            session.stop();
            runtime.send({ kind: 'stop', sessionId });
        }
    }, 15000);
});
