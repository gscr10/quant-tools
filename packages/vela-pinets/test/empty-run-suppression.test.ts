import { describe, it, expect } from 'vitest';
import { Vela } from '@luxalgo/vela';
import type { MarketDataFeed, VelaTheme, IndicatorRenderHandle, VisibleRange, InputChangeEvent, CrosshairEvent, ClickEvent } from '@luxalgo/vela';
import type { Pane, ScenePatch, InputValue } from '@luxalgo/vela/plugin';
import { PineEngine } from '../src/pinets/PineEngine';
import { declarationExecuted } from '../src/pinets/normalizeContext';
import type { MainToWorker, WorkerToMain } from '../src/pinets-worker/protocol';
import type { ExecutionRequest, ExecutionHandlers } from '@luxalgo/vela/plugin';
import type { IndicatorModel } from '@luxalgo/vela/plugin';
import type { OHLCV } from '@luxalgo/vela/plugin';
import { pineContextSelect } from '../src/pinets/reportSeries';
import type { PineContextSnapshot } from '../src/pinets/contextSnapshot';

type Unsubscribe = () => void;

/**
 * The product invariant under test: a run over ZERO bars (empty initial load — auth
 * race, unresolved symbol, transient feed failure) never executes the script body, so
 * it must emit NO model at all. Before this rule, such a run fabricated default
 * metadata (`title: "Indicator"`, `overlay: false`) and emitted it as a normal model —
 * the host then finalized pane routing off flags that contradict the declaration,
 * permanently stranding an overlay indicator in a sub pane titled "Indicator".
 */

const OVERLAY_SOURCE = `//@version=6
indicator("Order Block Entry Indicator", overlay = true)
plot(ta.atr(14) > 0 ? close : na, title = "Test")
`;

const PANE_SOURCE = `//@version=6
indicator("Momentum Probe")
plot(close - open, title = "Mom")
`;

const REPORT_SOURCE = `//@version=6
strategy("Worker report", initial_capital=10000, currency=currency.EUR)
if bar_index == 0
    strategy.entry("Long", strategy.long, 2)
if bar_index == 2
    strategy.close("Long")
plot(close)
`;

const SECONDARY_FETCH_SOURCE = `//@version=6
indicator("Secondary fetch race")
remote = request.security("ETHUSDT", "60", close)
plot(remote)
`;

function makeBars(n: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) {
        out.push({ time: 1_700_000_000_000 + i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1 });
    }
    return out;
}

async function waitFor(cond: () => boolean, ms = 20_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 20));
    }
}

/** A generous window for anything the empty run might still (wrongly) emit. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 300));

// ── in-process engine, static sessions ─────────────────────────────────────────

/** Execute `source` over an initially EMPTY bar array, then deepen it and poke. */
async function runEmptyThenBars(source: string): Promise<{ empty: IndicatorModel[]; after: IndicatorModel[] }> {
    const engine = new PineEngine();
    const prepared = await engine.prepare(source, 'empty-1');
    const bars: OHLCV[] = [];
    const models: IndicatorModel[] = [];
    const errors: Error[] = [];
    const handlers: ExecutionHandlers = { onModel: (m) => models.push(m), onError: (e) => errors.push(e) };
    const req: ExecutionRequest = {
        prepared,
        market: { symbol: 'TEST', timeframe: '60' },
        bars,
        getBars: () => bars,
        fetchSeries: async () => [],
        inputs: {},
        props: {},
        mode: 'static',
        historyState: 'complete',
    };
    const session = engine.execute(req, handlers);
    await settle();
    const empty = [...models];

    bars.push(...makeBars(50));
    session.notifyBars();
    await waitFor(() => models.length > empty.length);
    session.stop();
    expect(errors).toEqual([]);
    return { empty, after: models.slice(empty.length) };
}

describe('PineEngine: an empty static run emits no fabricated model', () => {
    it('overlay script: nothing emitted before bars; the correct full model after', async () => {
        const { empty, after } = await runEmptyThenBars(OVERLAY_SOURCE);
        // Either nothing at all (the fix), or — at minimum — nothing contradicting the declaration.
        for (const m of empty) {
            expect(m.overlay).toBe(true);
            expect(m.title).toBe('Order Block Entry Indicator');
        }
        expect(empty).toHaveLength(0);

        const real = after[after.length - 1]!;
        expect(real.title).toBe('Order Block Entry Indicator');
        expect(real.overlay).toBe(true);
        expect(real.paneHint).toBe('price');
        expect(real.series.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('non-overlay script: the empty run claims nothing; the real model stays off the price pane', async () => {
        const { empty, after } = await runEmptyThenBars(PANE_SOURCE);
        for (const m of empty) {
            expect(m.overlay).toBe(false);
            expect(m.title).toBe('Momentum Probe');
        }
        expect(empty).toHaveLength(0);

        const real = after[after.length - 1]!;
        expect(real.title).toBe('Momentum Probe');
        expect(real.overlay).toBe(false);
        expect(real.paneHint).toBe('new');
        expect(real.series.length).toBeGreaterThanOrEqual(1);
    }, 30_000);
});

// ── in-process engine, live stream ─────────────────────────────────────────────

describe('PineEngine: a live stream opened over zero bars emits no fabricated model', () => {
    it('stays silent until the complete snapshot restarts it over real bars', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(OVERLAY_SOURCE, 'live-1');
        const bars: OHLCV[] = [];
        const models: IndicatorModel[] = [];
        const session = engine.execute(
            {
                prepared,
                market: { symbol: 'TEST', timeframe: '60' },
                bars,
                getBars: () => bars,
                fetchSeries: async () => [],
                inputs: {},
                mode: 'live',
                historyState: 'complete',
            },
            { onModel: (m) => models.push(m) },
        );
        await new Promise((r) => setTimeout(r, 1500)); // > one stream poll interval
        expect(models).toHaveLength(0);

        bars.push(...makeBars(50));
        session.notifyBars('complete'); // restart over the now-real history
        await waitFor(() => models.length > 0);
        session.stop();
        const real = models[models.length - 1]!;
        expect(real.title).toBe('Order Block Entry Indicator');
        expect(real.overlay).toBe(true);
        expect(real.series.length).toBeGreaterThanOrEqual(1);
    }, 30_000);
});

// ── the worker module (its own bundled copy of the prepare/model code) ─────────

/**
 * Drive the REAL worker module over its message protocol. `worker.ts` reads the
 * worker-global `self` at module scope, so a shim must exist before the import; the
 * module is cached, so one bridge serves every test (session ids keep them apart).
 */
type WorkerBridge = { send(msg: MainToWorker): void; out: WorkerToMain[] };
let bridge: WorkerBridge | null = null;
async function workerBridge(): Promise<WorkerBridge> {
    if (bridge) return bridge;
    const out: WorkerToMain[] = [];
    const listeners: Array<(e: { data: unknown }) => void> = [];
    (globalThis as Record<string, unknown>).self = {
        postMessage: (m: unknown) => out.push(m as WorkerToMain),
        addEventListener: (_t: string, cb: (e: { data: unknown }) => void) => listeners.push(cb),
    };
    await import('../src/pinets-worker/worker');
    bridge = { send: (msg) => listeners.forEach((l) => l({ data: msg })), out };
    return bridge;
}

/** The worker-side equivalent of {@link runEmptyThenBars}. */
async function workerEmptyThenBars(source: string, sessionId: number): Promise<{ empty: IndicatorModel[]; after: IndicatorModel[] }> {
    const w = await workerBridge();
    const models = (): IndicatorModel[] => w.out.filter((m): m is Extract<WorkerToMain, { kind: 'model' }> => m.kind === 'model' && m.sessionId === sessionId).map((m) => m.model);
    const dones = (): number => w.out.filter((m) => m.kind === 'done' && m.sessionId === sessionId).length;
    const errors = (): WorkerToMain[] => w.out.filter((m) => m.kind === 'error' && m.sessionId === sessionId);

    const reqId = sessionId * 1000;
    w.send({ kind: 'prepare', reqId, source, instanceId: `w-${sessionId}` });
    await waitFor(() => w.out.some((m) => m.kind === 'prepared' && m.reqId === reqId));
    const preparedMsg = w.out.find((m): m is Extract<WorkerToMain, { kind: 'prepared' }> => m.kind === 'prepared' && m.reqId === reqId)!;
    expect(preparedMsg.error).toBeUndefined();

    w.send({ kind: 'execute', sessionId, prepared: preparedMsg.prepared!, market: { symbol: 'TEST', timeframe: '60' }, bars: [], inputs: {}, mode: 'static', historyState: 'complete' });
    await waitFor(() => dones() >= 1); // the empty run acked — its bookkeeping still balances
    await settle();
    const empty = models();

    w.send({ kind: 'notifyBars', sessionId, bars: makeBars(50) });
    await waitFor(() => models().length > empty.length);
    w.send({ kind: 'stop', sessionId });
    expect(errors()).toEqual([]);
    return { empty, after: models().slice(empty.length) };
}

describe('worker module: an empty static run emits no fabricated model', () => {
    it('overlay script: nothing posted before bars; the correct full model after', async () => {
        const { empty, after } = await workerEmptyThenBars(OVERLAY_SOURCE, 1);
        for (const m of empty) {
            expect(m.overlay).toBe(true);
            expect(m.title).toBe('Order Block Entry Indicator');
        }
        expect(empty).toHaveLength(0);

        const real = after[after.length - 1]!;
        expect(real.title).toBe('Order Block Entry Indicator');
        expect(real.overlay).toBe(true);
        expect(real.paneHint).toBe('price');
        expect(real.series.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('non-overlay script: the empty run claims nothing; the real model stays off the price pane', async () => {
        const { empty, after } = await workerEmptyThenBars(PANE_SOURCE, 2);
        for (const m of empty) {
            expect(m.overlay).toBe(false);
            expect(m.title).toBe('Momentum Probe');
        }
        expect(empty).toHaveLength(0);

        const real = after[after.length - 1]!;
        expect(real.title).toBe('Momentum Probe');
        expect(real.overlay).toBe(false);
        expect(real.series.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('returns the real PineTS report series only for an explicit worker selection', async () => {
        const w = await workerBridge();
        const sessionId = 3;
        const prepareReqId = 3_000;
        w.send({ kind: 'prepare', reqId: prepareReqId, source: REPORT_SOURCE, instanceId: 'worker-report' });
        await waitFor(() => w.out.some((m) => m.kind === 'prepared' && m.reqId === prepareReqId));
        const prepared = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'prepared' }> => m.kind === 'prepared' && m.reqId === prepareReqId,
        )!.prepared!;
        const bars = makeBars(4);
        w.send({
            kind: 'execute',
            sessionId,
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars,
            inputs: {},
            mode: 'static',
            historyState: 'complete',
        });
        await waitFor(() => w.out.some((m) => m.kind === 'done' && m.sessionId === sessionId));

        const ordinaryReqId = 3_001;
        w.send({ kind: 'getContext', sessionId, reqId: ordinaryReqId });
        await waitFor(() => w.out.some((m) => m.kind === 'contextResult' && m.reqId === ordinaryReqId));
        const ordinary = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'contextResult' }> => m.kind === 'contextResult' && m.reqId === ordinaryReqId,
        )!.snapshot as PineContextSnapshot;
        expect(ordinary.reportSeries).toBeUndefined();
        expect(ordinary.reportTail).toBeUndefined();

        const selectedReqId = 3_002;
        w.send({
            kind: 'getContext',
            sessionId,
            reqId: selectedReqId,
            select: pineContextSelect('strategy', 'trades', 'reportSeries', 'reportTail'),
        });
        await waitFor(() => w.out.some((m) => m.kind === 'contextResult' && m.reqId === selectedReqId));
        const selected = structuredClone(w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'contextResult' }> => m.kind === 'contextResult' && m.reqId === selectedReqId,
        )!.snapshot) as PineContextSnapshot;

        expect(selected.provenance?.execution).toBe('worker');
        expect(selected.reportSeries).toMatchObject({
            schemaVersion: 1,
            snapshotRevision: 1,
            barIndex: bars.length - 1,
        });
        expect(selected.reportSeries?.runId).toBeTruthy();
        expect(selected.reportSeries?.points).toHaveLength(bars.length);
        expect(selected.reportTail).toEqual({
            ...selected.reportSeries,
            points: [selected.reportSeries?.points.at(-1)],
        });
        expect(selected.strategy).toMatchObject({
            accountCurrency: 'EUR',
            maxContractsHeldAll: 2,
            maxContractsHeldLong: 2,
            maxContractsHeldShort: 0,
            reportRunId: selected.reportSeries?.runId,
            reportSnapshotRevision: 1,
            reportPointCount: bars.length,
        });
        const indexedTrades = selected.trades as Array<{
            entryBarIndex?: number;
            exitBarIndex?: number;
            open: boolean;
        }> | undefined;
        expect(indexedTrades).toHaveLength(1);
        expect(indexedTrades?.[0]).toMatchObject({
            entryBarIndex: 1,
            exitBarIndex: 3,
            open: false,
        });
        w.send({ kind: 'stop', sessionId });
    }, 30_000);

    it('settles and suppresses a pending secondary fetch when the worker session stops', async () => {
        const w = await workerBridge();
        const sessionId = 4;
        const prepareReqId = 4_000;
        w.send({ kind: 'prepare', reqId: prepareReqId, source: SECONDARY_FETCH_SOURCE, instanceId: 'worker-fetch-race' });
        await waitFor(() => w.out.some((m) => m.kind === 'prepared' && m.reqId === prepareReqId));
        const prepared = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'prepared' }> => m.kind === 'prepared' && m.reqId === prepareReqId,
        )!.prepared!;
        w.send({
            kind: 'execute',
            sessionId,
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars: makeBars(3),
            inputs: {},
            mode: 'static',
            historyState: 'complete',
        });
        await waitFor(() => w.out.some((m) => m.kind === 'fetchSeries' && m.sessionId === sessionId));
        const request = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'fetchSeries' }> => m.kind === 'fetchSeries' && m.sessionId === sessionId,
        )!;
        const errors = (): WorkerToMain[] => w.out.filter((m) => m.kind === 'error' && m.sessionId === sessionId);

        w.send({ kind: 'stop', sessionId });
        // A provider response can race the stop frame. It must not revive the
        // stopped run or emit an error after its pending promise was settled.
        w.send({ kind: 'fetchSeriesResult', reqId: request.reqId, error: 'late provider failure' });
        await settle();
        expect(errors()).toEqual([]);
    }, 30_000);

    it('forwards provider metadata from a secondary fetch failure to the session error', async () => {
        const w = await workerBridge();
        const sessionId = 5;
        const prepareReqId = 5_000;
        w.send({ kind: 'prepare', reqId: prepareReqId, source: SECONDARY_FETCH_SOURCE, instanceId: 'worker-provider-error' });
        await waitFor(() => w.out.some((m) => m.kind === 'prepared' && m.reqId === prepareReqId));
        const prepared = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'prepared' }> => m.kind === 'prepared' && m.reqId === prepareReqId,
        )!.prepared!;
        w.send({
            kind: 'execute',
            sessionId,
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars: makeBars(3),
            inputs: {},
            mode: 'static',
            historyState: 'complete',
        });
        await waitFor(() => w.out.some((m) => m.kind === 'fetchSeries' && m.sessionId === sessionId));
        const request = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'fetchSeries' }> => m.kind === 'fetchSeries' && m.sessionId === sessionId,
        )!;
        w.send({
            kind: 'fetchSeriesResult',
            reqId: request.reqId,
            error: 'binance request timed out',
            errorDetails: {
                name: 'ProviderTimeoutError',
                kind: 'provider',
                provider: 'binance',
                timeoutMs: 20,
            },
        });
        await waitFor(() => w.out.some((m) => m.kind === 'error' && m.sessionId === sessionId));
        const error = w.out.find(
            (m): m is Extract<WorkerToMain, { kind: 'error' }> => m.kind === 'error' && m.sessionId === sessionId,
        )!;
        expect(error.message).toBe('binance request timed out');
        expect(error.error).toMatchObject({
            name: 'ProviderTimeoutError',
            kind: 'provider',
            provider: 'binance',
            timeoutMs: 20,
        });
        w.send({ kind: 'stop', sessionId });
    }, 30_000);
});

// ── regression: an EXECUTED run's metadata stays authoritative ─────────────────

describe('an executed run still takes metadata from the runtime declaration', () => {
    it('a variable overlay arg (invisible to the static scan) resolves from the run, even after an empty first run', async () => {
        // The static scan cannot resolve `overlay=ov`, so the raw-source regex guess
        // applies at prepare — only the EXECUTED declaration knows the true value.
        const source = '//@version=5\nov = true\nindicator("Var Overlay", overlay=ov)\nplot(close)\n';
        const { empty, after } = await runEmptyThenBars(source);
        expect(empty).toHaveLength(0);
        const real = after[after.length - 1]!;
        expect(real.title).toBe('Var Overlay');
        expect(real.overlay).toBe(true);
        expect(real.paneHint).toBe('price');
    }, 30_000);

    it('declarationExecuted keys on the executed declaration, not a default-initialized shape', () => {
        expect(declarationExecuted({ plots: {} })).toBe(false);
        expect(declarationExecuted({ plots: {}, indicator: {} })).toBe(false);
        expect(declarationExecuted({ plots: {}, indicator: {}, strategy: { config: {} } })).toBe(false);
        expect(declarationExecuted({ indicator: { title: 'I' } })).toBe(true);
        expect(declarationExecuted({ strategy: { config: { title: 'S' } } })).toBe(true);
        expect(declarationExecuted({ fullContext: { indicator: { title: 'I' } } })).toBe(true);
    });
});

// ── end-to-end: the user's scenario through the built Vela + the real engine ──

/** First load resolves EMPTY (auth race / transient failure); every later load serves bars. */
class FlakyFirstLoadFeed implements MarketDataFeed {
    loads = 0;
    load(): Promise<OHLCV[]> {
        this.loads += 1;
        return Promise.resolve(this.loads === 1 ? [] : makeBars(60).map((b) => ({ ...b })));
    }
    subscribe(): Unsubscribe {
        return () => {};
    }
}

/** Minimal renderer fake: records every mount, ensured pane, and legend status flip. */
class RecordingRenderer {
    readonly name = 'fake';
    readonly features: readonly string[] = [];
    readonly capabilities = {
        panes: true, paneManagement: false, fills: 'native', bgcolor: 'native', hline: 'native', markers: true,
        barcolor: 'native', perPointColor: true, drawings: true, userDrawings: false, tables: true, trades: true, inputsUI: true,
    } as const;
    mountedModels: IndicatorModel[] = [];
    panes: Pane[] = [];
    statuses: Array<{ id: string; status: string }> = [];
    bars: OHLCV[] = [];
    mount(_c: HTMLElement, _t: VelaTheme): void {}
    setTheme(): void {}
    resize(): void {}
    destroy(): void {}
    applyFeature(): void {}
    readFeature(): unknown {
        return undefined;
    }
    setBars(bars: OHLCV[]): void {
        this.bars = bars;
    }
    updateBar(): void {}
    ensurePane(p: Pane): void {
        this.panes.push(p);
    }
    removePane(): void {}
    mountIndicator(model: IndicatorModel): IndicatorRenderHandle {
        this.mountedModels.push(model);
        return { id: model.id };
    }
    updateIndicator(_h: IndicatorRenderHandle, _p: ScenePatch): void {}
    removeIndicator(): void {}
    setIndicatorInputs(_h: IndicatorRenderHandle, _v: Record<string, InputValue>): void {}
    setIndicatorStatus(h: IndicatorRenderHandle, status: string): void {
        this.statuses.push({ id: h.id, status });
    }
    onInputChange(_cb: (e: InputChangeEvent) => void): Unsubscribe {
        return () => {};
    }
    onRemoveIndicator(_cb: (id: string) => void): Unsubscribe {
        return () => {};
    }
    onCrosshairMove(_cb: (e: CrosshairEvent) => void): Unsubscribe {
        return () => {};
    }
    onClick(_cb: (e: ClickEvent) => void): Unsubscribe {
        return () => {};
    }
    getVisibleRange(): VisibleRange | null {
        return null;
    }
    setVisibleRange(): void {}
    onViewportChange(_cb: (r: VisibleRange) => void): Unsubscribe {
        return () => {};
    }
}

describe('end-to-end (built Vela + PineEngine): overlay indicator on a chart whose first load is empty', () => {
    it('shows the legend placeholder on the PRICE pane with the declared title while loading, and recovers when data arrives', async () => {
        const renderer = new RecordingRenderer();
        const feed = new FlakyFirstLoadFeed();
        const chart = new Vela(
            {} as unknown as HTMLElement,
            { symbol: 'TEST', timeframe: '60', live: false, volume: false },
            { renderer, engines: [new PineEngine()], dataFeed: feed },
        );
        const added: string[] = [];
        const errors: string[] = [];
        chart.on('indicator:added', (e) => added.push(e.id));
        chart.on('indicator:error', (e) => errors.push(e.error.message));

        const h = chart.addIndicator(OVERLAY_SOURCE);
        await chart.ready();
        await waitFor(() => renderer.mountedModels.some((m) => m.id === h.id));
        await settle(); // a generous window for anything the zero-bar run might (wrongly) emit

        // While loading: the indicator IS on the chart — one mount, the price pane, the
        // declared title, spinner on. Not announced, no sub pane, no error.
        const mountsFor = (): IndicatorModel[] => renderer.mountedModels.filter((m) => m.id === h.id);
        expect(errors).toEqual([]);
        expect(mountsFor()).toHaveLength(1);
        expect(mountsFor()[0]?.paneId).toBe('price');
        expect(mountsFor()[0]?.title).toBe('Order Block Entry Indicator');
        expect(renderer.panes.every((p) => p.id === 'price')).toBe(true);
        expect(renderer.statuses.filter((s) => s.id === h.id).pop()?.status).toBe('loading');
        expect(added).toHaveLength(0);

        // The host retries the market (its auth landed): this load serves real bars.
        await chart.setMarket({ symbol: 'TEST2' });
        await waitFor(() => added.length > 0);

        const last = mountsFor()[mountsFor().length - 1];
        expect(last?.paneId).toBe('price');
        expect(last?.title).toBe('Order Block Entry Indicator');
        expect(last?.series.length).toBeGreaterThanOrEqual(1);
        expect(renderer.statuses.filter((s) => s.id === h.id).pop()?.status).toBe('idle');
        expect(added).toEqual([h.id]);
        expect(errors).toEqual([]);
        chart.destroy();
    }, 30_000);
});
