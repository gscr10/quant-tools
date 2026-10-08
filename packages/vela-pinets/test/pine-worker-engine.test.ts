import { describe, it, expect } from 'vitest';
import { PineWorkerEngine } from '../src/pinets-worker/PineWorkerEngine';
import { batchPineSettings } from '../src/pinets/settingsBatch';
import type { MainToWorker, WorkerErrorEvent, WorkerToMain, WorkerLike } from '../src/pinets-worker/protocol';
import type { PreparedScript, ExecutionRequest, ExecutionHandlers } from '@luxalgo/vela/plugin';
import type { IndicatorModel } from '@luxalgo/vela/plugin';
import type { OHLCV } from '@luxalgo/vela/plugin';
import { PINE_EXECUTION_BUILD_INFO } from '../src/build-info';
import { pineContextSelect, stampReportIdentity } from '../src/pinets/reportSeries';
import { snapshotFromCtx } from '../src/pinets/contextSnapshot';
import type { PineContextSnapshot } from '../src/pinets/contextSnapshot';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** A fake Worker: records what the proxy posts, and lets the test drive replies. */
class FakeWorker implements WorkerLike {
    posted: MainToWorker[] = [];
    terminated = false;
    /** Optional one-shot structured-clone/post failure for bridge tests. */
    postFailure: unknown = null;
    /** Optional listener-registration failure for construction-boundary tests. */
    throwOnListener: 'message' | 'error' | 'messageerror' | null = null;
    private listener: ((e: { data: unknown }) => void) | null = null;
    private errorListener: ((e: WorkerErrorEvent) => void) | null = null;
    private messageErrorListener: ((e: WorkerErrorEvent) => void) | null = null;
    postMessage(msg: unknown): void {
        if (this.terminated) throw new Error('worker is terminated');
        if (this.postFailure !== null) {
            const failure = this.postFailure;
            this.postFailure = null;
            throw failure instanceof Error ? failure : new Error(String(failure));
        }
        this.posted.push(msg as MainToWorker);
    }
    addEventListener(
        type: 'message' | 'error' | 'messageerror',
        cb: ((e: { data: unknown }) => void) | ((e: WorkerErrorEvent) => void),
    ): void {
        if (this.throwOnListener === type) throw new Error(`cannot add ${type} listener`);
        if (type === 'message') this.listener = cb as (e: { data: unknown }) => void;
        else if (type === 'error') this.errorListener = cb as (e: WorkerErrorEvent) => void;
        else this.messageErrorListener = cb as (e: WorkerErrorEvent) => void;
    }
    terminate(): void {
        this.terminated = true;
    }
    /** Simulate the worker posting a message back to the main thread. */
    reply(msg: WorkerToMain): void {
        this.listener?.({ data: msg });
    }
    fail(event: WorkerErrorEvent = {}): void {
        this.errorListener?.(event);
    }
    failMessage(event: WorkerErrorEvent = {}): void {
        this.messageErrorListener?.(event);
    }
    last<K extends MainToWorker['kind']>(kind: K): Extract<MainToWorker, { kind: K }> | undefined {
        for (let i = this.posted.length - 1; i >= 0; i -= 1) {
            const m = this.posted[i];
            if (m && m.kind === kind) return m as Extract<MainToWorker, { kind: K }>;
        }
        return undefined;
    }
}

const PREPARED: PreparedScript = {
    language: 'pine',
    inputs: [],
    meta: { title: 'EMA', overlay: true },
    reactsToViewport: false,
    token: { source: '//src', instanceId: 'ind-1', build: PINE_EXECUTION_BUILD_INFO },
};

const bar = (t: number): OHLCV => ({ time: t, open: 1, high: 2, low: 0, close: 1, volume: 1 });

const MODEL: IndicatorModel = {
    id: 'ind-1',
    title: 'EMA',
    overlay: true,
    paneHint: 'price',
    series: [],
    fills: [],
    backgrounds: [],
    priceLines: [],
    inputs: [],
    inputValues: {},
};

function makeReq(extra: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return { prepared: PREPARED, market: { symbol: 'BTCUSDT', timeframe: '60' }, bars: [bar(1), bar(2)], inputs: {}, mode: 'static', ...extra };
}

describe('PineWorkerEngine (proxy)', () => {
    it('routes a live-workspace Bar Magnifier request to the static worker protocol', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const prepared = {
            ...PREPARED,
            props: [{ key: 'use_bar_magnifier', title: 'Use bar magnifier', type: 'bool' as const, defval: true }],
        };
        engine.execute(makeReq({ prepared, mode: 'live' }), { onModel: () => {} });
        expect(fake.last('execute')?.mode).toBe('static');
    });

    it('uses the live request property override when the declaration default is off', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const prepared = {
            ...PREPARED,
            props: [{ key: 'use_bar_magnifier', title: 'Use bar magnifier', type: 'bool' as const, defval: false }],
        };
        engine.execute(makeReq({ prepared, mode: 'live', props: { use_bar_magnifier: true } }), { onModel: () => {} });
        expect(fake.last('execute')?.mode).toBe('static');
    });

    it('freezes a host cutoff for property-only precision before crossing the Worker wire', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const prepared = {
            ...PREPARED,
            props: [{ key: 'use_bar_magnifier', title: 'Use bar magnifier', type: 'bool' as const, defval: false }],
        };
        const before = Date.now();
        engine.execute(makeReq({ prepared, mode: 'live', props: { use_bar_magnifier: true } }), { onModel: () => {} });
        const after = Date.now();
        const envelope = fake.last('execute')?.barMagnifier;
        expect(envelope).toMatchObject({ requested: true });
        expect(envelope?.asOf).toBeGreaterThanOrEqual(before);
        expect(envelope?.asOf).toBeLessThanOrEqual(after);
    });

    for (const mode of ['static', 'live'] as const) {
        it(`${mode} posts one combined update for an explicit Settings Apply`, () => {
            const fake = new FakeWorker();
            const engine = new PineWorkerEngine({ createWorker: () => fake });
            const session = engine.execute(makeReq({ mode }), { onModel: () => {} });
            batchPineSettings(() => {
                session.update({ Length: 11 });
                session.update({ Length: 11 }, { precision: 3 });
            });
            expect(fake.posted.filter(m => m.kind === 'update')).toEqual([
                { kind: 'update', sessionId: 1, inputs: { Length: 11 }, props: { precision: 3 } },
            ]);
            batchPineSettings(() => { session.update({ Length: 12 }); session.stop(); });
            expect(fake.posted.filter(m => m.kind === 'update')).toHaveLength(1);
        });
    }
    it('prepare round-trips to the worker', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const p = engine.prepare('//src', 'ind-1');

        const sent = fake.last('prepare');
        expect(sent).toMatchObject({ kind: 'prepare', source: '//src', instanceId: 'ind-1' });

        fake.reply({ kind: 'prepared', reqId: sent!.reqId, prepared: PREPARED });
        await expect(p).resolves.toMatchObject({ meta: { title: 'EMA' } });
    });

    it('rejects a prepared response from a stale/foreign Worker bundle', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const pending = engine.prepare('//src', 'ind-1');
        const sent = fake.last('prepare')!;
        fake.reply({
            kind: 'prepared',
            reqId: sent.reqId,
            prepared: {
                ...PREPARED,
                token: {
                    ...PREPARED.token as Record<string, unknown>,
                    build: {
                        ...PINE_EXECUTION_BUILD_INFO,
                        sentinel: 'old-worker-sentinel',
                    },
                },
            },
        });
        await expect(pending).rejects.toThrow(/build sentinel mismatch/);
    });

    it('preserves compile error metadata from a Worker prepare response', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const pending = engine.prepare('//bad', 'compile-error');
        const sent = fake.last('prepare')!;
        fake.reply({
            kind: 'prepared',
            reqId: sent.reqId,
            error: 'unexpected token',
            errorDetails: { name: 'SyntaxError', kind: 'compile' },
        });
        await expect(pending).rejects.toMatchObject({
            message: 'unexpected token',
            name: 'SyntaxError',
            kind: 'compile',
        });
    });

    it('rejects execution when a caller supplies a stale PreparedScript', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const stale = {
            ...PREPARED,
            token: {
                ...PREPARED.token as Record<string, unknown>,
                build: { ...PINE_EXECUTION_BUILD_INFO, buildFingerprint: 'old-worker-build' },
            },
        } as PreparedScript;
        const session = engine.execute(makeReq({ prepared: stale }), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });
        expect(errors[0]?.message).toMatch(/build sentinel mismatch/);
        expect(fake.posted).toHaveLength(0);
        session.stop();
    });

    it('execute ships bars + routes the worker model to onModel; session methods post', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const models: IndicatorModel[] = [];
        const handlers: ExecutionHandlers = { onModel: (m) => models.push(m) };
        const session = engine.execute(makeReq(), handlers);

        const exec = fake.last('execute');
        expect(exec!.bars).toHaveLength(2);

        fake.reply({ kind: 'model', sessionId: exec!.sessionId, model: MODEL });
        expect(models).toHaveLength(1);
        expect(models[0]!.id).toBe('ind-1');

        session.update({ Length: 50 });
        expect(fake.last('update')).toMatchObject({ inputs: { Length: 50 } });
        session.setVisibleRange({ left: 1, right: 2 });
        expect(fake.last('setVisibleRange')).toMatchObject({ range: { left: 1, right: 2 } });
        // Three runs (execute/update/setVisibleRange) are in flight — ack them so a bar tick
        // posts straight through instead of coalescing behind them.
        fake.reply({ kind: 'done', sessionId: exec!.sessionId });
        fake.reply({ kind: 'done', sessionId: exec!.sessionId });
        fake.reply({ kind: 'done', sessionId: exec!.sessionId });
        session.notifyBars();
        expect(fake.last('notifyBars')!.bars).toHaveLength(2);
        session.stop();
        expect(fake.last('stop')).toBeDefined();
    });

    it('contains host model/alert/warning/done callback failures and keeps run bookkeeping usable', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const session = engine.execute(makeReq(), {
            onModel: () => { throw new Error('model renderer failed'); },
            onAlert: () => { throw new Error('alert renderer failed'); },
            onWarning: () => { throw new Error('warning renderer failed'); },
            onDone: () => { throw new Error('done renderer failed'); },
            onError: (error) => errors.push(error),
        });
        const sessionId = fake.last('execute')!.sessionId;

        // Each frame is delivered through the same synchronous message
        // listener a browser Worker uses. None may escape to the caller.
        expect(() => fake.reply({ kind: 'model', sessionId, model: MODEL })).not.toThrow();
        expect(() => fake.reply({
            kind: 'alert',
            sessionId,
            alert: { id: 'a', message: 'm', barIndex: 0, time: 1 },
        })).not.toThrow();
        expect(() => fake.reply({
            kind: 'warning',
            sessionId,
            warning: { message: 'w', bar: 0 },
        })).not.toThrow();
        expect(() => fake.reply({ kind: 'done', sessionId })).not.toThrow();

        expect(errors.map((error) => error.message)).toEqual([
            'model renderer failed',
            'alert renderer failed',
            'warning renderer failed',
            'done renderer failed',
        ]);

        // `done` still decrements the in-flight counter after a throwing
        // completion callback, so a subsequent bar notification is posted.
        session.notifyBars();
        expect(fake.last('notifyBars')).toBeDefined();
        session.stop();
    });

    it('forwards the Bar Magnifier envelope unchanged to the worker', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const child = { openTime: 1, open: 1, high: 2, low: 0, close: 1 };
        const request = makeReq({
            barMagnifier: {
                requested: true,
                lowerTimeframe: '10',
                bars: [child],
            },
        } as never);
        const session = engine.execute(request, { onModel: () => undefined });
        expect(fake.last('execute')?.barMagnifier).toEqual({
            requested: true,
            lowerTimeframe: '10',
            bars: [child],
        });
        session.stop();
    });

    it('round-trips private report selections and the plain report envelope', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => undefined });
        const pending = session.getContext?.(pineContextSelect('strategy', 'reportSeries'));
        const request = fake.last('getContext')!;
        expect(request.select).toEqual(['strategy', 'reportSeries']);

        const source: PineContextSnapshot = {
            language: 'pine',
            phase: 'idle',
            barIndex: 1,
            meta: { title: '', overlay: false },
            plots: {},
            variables: {},
            warnings: [],
            reportSeries: {
                schemaVersion: 1,
                runId: 'worker-run',
                snapshotRevision: 4,
                barIndex: 1,
                points: [{
                    barIndex: 1,
                    time: 2,
                    equity: 10_010,
                    realizedPnl: 10,
                    openPnl: 0,
                    underwater: 0,
                    underwaterPercent: 0,
                    maxDrawdown: 5,
                    maxDrawdownPercent: 0.05,
                    benchmarkEquity: null,
                    benchmarkPnl: null,
                    benchmarkReturnPercent: null,
                }],
            },
        };
        // structuredClone mirrors the browser Worker transport boundary.
        fake.reply({ kind: 'contextResult', reqId: request.reqId, snapshot: structuredClone(source) });
        const result = await pending as PineContextSnapshot;
        expect(result.reportSeries).toEqual(source.reportSeries);
        expect(result.reportSeries?.points[0]).not.toBe(source.reportSeries?.points[0]);
        session.stop();
    });

    it('keeps an explicitly selected audit ledger identical across the Worker wire', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => undefined });
        const selected = pineContextSelect('auditLedger');
        const pending = session.getContext?.(selected);
        const request = fake.last('getContext')!;
        expect(request.select).toEqual(['auditLedger']);

        const raw: {
            idx: number;
            strategy: {
                _ledger_sequence: number;
                _order_events: Array<Record<string, unknown>>;
                _fill_events: Array<Record<string, unknown>>;
            };
        } = {
            idx: 1,
            strategy: {
                _ledger_sequence: 2,
                _order_events: [{
                    eventId: 'event_1', orderId: 'order_1', kind: 'created',
                    barIndex: 0, time: 1, direction: 1, qty: 1, orderType: 'market',
                }],
                _fill_events: [{
                    fillId: 'fill_1', orderId: 'order_1', barIndex: 1, time: 2,
                    direction: 1, qty: 1, price: 101, orderType: 'market',
                }],
            },
        };
        stampReportIdentity(raw, 'worker-audit-run', 3);
        const inProcess = snapshotFromCtx(raw, 'idle', selected);
        expect(inProcess.auditLedger).toBeDefined();

        // The browser Worker performs structured cloning, which strips source
        // realm frozen bits; PineWorkerEngine must restore them on receipt.
        fake.reply({ kind: 'contextResult', reqId: request.reqId, snapshot: structuredClone(inProcess) });
        const worker = await pending as PineContextSnapshot;
        expect(worker.auditLedger).toEqual(inProcess.auditLedger);
        expect(worker.auditLedger).not.toBe(inProcess.auditLedger);
        expect(Object.isFrozen(worker.auditLedger)).toBe(true);
        expect(Object.isFrozen(worker.auditLedger!.orderEvents)).toBe(true);
        session.stop();
    });

    it('re-freezes the opt-in audit ledger after Worker structured cloning', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => undefined });
        const pending = session.getContext?.(pineContextSelect('auditLedger'));
        const request = fake.last('getContext')!;
        const source: PineContextSnapshot = {
            language: 'pine',
            phase: 'idle',
            barIndex: 1,
            meta: { title: '', overlay: false },
            plots: {},
            variables: {},
            warnings: [],
            auditLedger: {
                schemaVersion: 1,
                runId: 'worker-ledger',
                snapshotRevision: 2,
                barIndex: 1,
                sequence: 2,
                orderEvents: [{
                    eventId: 'event_1', orderId: 'order_1', sourceOrderId: 'L',
                    kind: 'created', barIndex: 0, time: 1, direction: 1,
                    qty: 1, orderType: 'market', category: 'entry',
                }],
                fillEvents: [{
                    fillId: 'fill_1', orderId: 'order_1', sourceOrderId: 'L',
                    barIndex: 1, time: 2, direction: 1, qty: 1,
                    price: 101, orderType: 'market', category: 'entry',
                    tradeIds: ['trade_1'],
                }],
            },
        };
        fake.reply({ kind: 'contextResult', reqId: request.reqId, snapshot: structuredClone(source) });
        const result = await pending as PineContextSnapshot;
        expect(result.auditLedger).toEqual(source.auditLedger);
        expect(Object.isFrozen(result.auditLedger)).toBe(true);
        expect(Object.isFrozen(result.auditLedger!.orderEvents[0])).toBe(true);
        expect(Object.isFrozen(result.auditLedger!.fillEvents[0]!.tradeIds)).toBe(true);
        session.stop();
    });

    it('settles a pending context read on session stop and ignores later session calls', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => undefined });
        const pending = session.getContext?.();
        expect(fake.last('getContext')).toBeDefined();

        session.stop();
        await expect(pending).resolves.toBeNull();

        const posted = fake.posted.length;
        session.update({ Length: 20 });
        session.setVisibleRange({ left: 1, right: 2 });
        session.notifyBars();
        expect(fake.posted).toHaveLength(posted);
        // A second stop is idempotent and does not send another stop frame.
        session.stop();
        expect(fake.posted.filter((message) => message.kind === 'stop')).toHaveLength(1);
    });

    it('maps a malformed Worker context snapshot to null instead of undefined or a thrown frame', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => undefined });
        const pending = session.getContext?.();
        const request = fake.last('getContext')!;

        expect(() => fake.reply({
            kind: 'contextResult',
            reqId: request.reqId,
            snapshot: undefined as never,
        })).not.toThrow();
        await expect(pending).resolves.toBeNull();
        session.stop();
    });

    it('terminating the engine rejects prepares, resolves context reads, and invalidates sessions', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const preparing = engine.prepare('//pending', 'pending');
        const session = engine.execute(makeReq(), { onModel: () => undefined });
        const context = session.getContext?.();

        engine.terminate();
        await expect(preparing).rejects.toThrow('worker terminated');
        await expect(context).resolves.toBeNull();

        const posted = fake.posted.length;
        session.update({ Length: 20 });
        session.notifyBars();
        session.setVisibleRange({ left: 1, right: 2 });
        session.stop();
        expect(fake.posted).toHaveLength(posted);
    });

    it.each([
        ['error', (fake: FakeWorker, event: WorkerErrorEvent) => fake.fail(event)],
        ['messageerror', (fake: FakeWorker, event: WorkerErrorEvent) => fake.failMessage(event)],
    ] as const)('settles all bridge state when the Worker emits %s', async (_kind, fail) => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const preparing = engine.prepare('//pending', 'pending');
        const errors: Error[] = [];
        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });
        const context = session.getContext?.();

        fail(fake, { message: 'worker exploded' });

        await expect(preparing).rejects.toThrow('worker exploded');
        await expect(context).resolves.toBeNull();
        expect(errors.map((error) => error.message)).toEqual(['worker exploded']);
        expect(fake.terminated).toBe(true);

        const posted = fake.posted.length;
        session.update({ Length: 20 });
        session.notifyBars();
        session.setVisibleRange({ left: 1, right: 2 });
        session.stop();
        expect(fake.posted).toHaveLength(posted);
    });

    it('normalizes cross-realm worker errors and uses the event fallback when details are absent', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        engine.execute(makeReq(), { onModel: () => undefined, onError: (error) => errors.push(error) });

        // A DOMException/foreign-realm Error is not necessarily `instanceof
        // Error` in the host realm, but its message should survive the bridge.
        fake.fail({ error: { message: 'cross-realm failure' } });
        expect(errors.map((error) => error.message)).toEqual(['cross-realm failure']);

        const fallbackWorker = new FakeWorker();
        const fallbackEngine = new PineWorkerEngine({ createWorker: () => fallbackWorker });
        const fallback: Error[] = [];
        fallbackEngine.execute(makeReq(), { onModel: () => undefined, onError: (error) => fallback.push(error) });
        fallbackWorker.failMessage({});
        expect(fallback.map((error) => error.message)).toEqual(['PineTS worker message failed']);
    });

    it('preserves structured Pine runtime error metadata from the Worker', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });
        const sessionId = fake.last('execute')!.sessionId;

        fake.reply({
            kind: 'error',
            sessionId,
            message: 'Array index 4 is out of bounds',
            error: { name: 'PineRuntimeError', method: 'array.get' },
        });

        expect(errors).toHaveLength(1);
        expect(errors[0]!.message).toBe('Array index 4 is out of bounds');
        expect(errors[0]!.name).toBe('PineRuntimeError');
        expect((errors[0] as Error & { method?: string }).method).toBe('array.get');
        session.stop();
    });

    it('serializes provider diagnostics on the fetch gateway without breaking old string errors', async () => {
        const fake = new FakeWorker();
        const providerError = Object.assign(new Error('request timed out'), {
            name: 'ProviderTimeoutError',
            provider: 'binance',
            timeoutMs: 25,
            url: 'https://api.binance.com/api/v3/klines',
            retryable: true,
        });
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq({
            fetchSeries: async () => { throw providerError; },
        }), { onModel: () => undefined });
        const sessionId = fake.last('execute')!.sessionId;

        fake.reply({
            kind: 'fetchSeries',
            sessionId,
            reqId: 73,
            symbol: 'ETHUSDT',
            timeframe: '60',
            range: { limit: 2 },
        });
        await flush();

        const response = fake.last('fetchSeriesResult');
        expect(response).toMatchObject({
            kind: 'fetchSeriesResult',
            reqId: 73,
            error: 'request timed out',
            errorDetails: {
                name: 'ProviderTimeoutError',
                kind: 'provider',
                provider: 'binance',
                timeoutMs: 25,
                retryable: true,
            },
        });
        session.stop();
    });

    it('maps provider metadata from a Worker protocol error onto the host Error', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });
        const sessionId = fake.last('execute')!.sessionId;
        fake.reply({
            kind: 'error',
            sessionId,
            message: 'binance HTTP 503',
            error: {
                name: 'ProviderHttpError',
                kind: 'provider',
                provider: 'binance',
                status: 503,
                retryable: true,
            },
        });
        expect(errors).toHaveLength(1);
        expect(errors[0]!.name).toBe('ProviderHttpError');
        expect((errors[0] as Error & { provider?: string }).provider).toBe('binance');
        expect((errors[0] as Error & { status?: number }).status).toBe(503);
        expect((errors[0] as Error & { kind?: string }).kind).toBe('provider');
        session.stop();
    });

    it('keeps run bookkeeping when the host error callback throws', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: () => { throw new Error('renderer failed'); },
        });
        const sessionId = fake.last('execute')!.sessionId;

        // The bridge must contain the callback failure and still acknowledge
        // the protocol run; otherwise every later notifyBars call remains
        // coalesced behind a permanently pending run counter.
        expect(() => fake.reply({ kind: 'error', sessionId, message: 'provider failed' })).not.toThrow();
        session.notifyBars();
        expect(fake.last('notifyBars')).toBeDefined();
        session.stop();
    });

    it('does not report a postMessage failure twice to the initial session', () => {
        const fake = new FakeWorker();
        fake.postFailure = new Error('structured clone failed');
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];

        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });

        expect(errors.map((error) => error.message)).toEqual(['structured clone failed']);
        expect(fake.terminated).toBe(true);
        // The returned inert proxy remains safe after the failed first post.
        session.update({ Length: 20 });
        session.stop();
        expect(errors).toHaveLength(1);
    });

    it('contains postMessage failures from static session mutators', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });

        fake.postFailure = new Error('update structured clone failed');
        expect(() => session.update({ Length: 20 })).not.toThrow();
        expect(errors.map((error) => error.message)).toEqual(['update structured clone failed']);

        // Worker invalidation makes the proxy inert; later chart lifecycle
        // events must remain harmless and must not spawn a replacement worker.
        const posted = fake.posted.length;
        expect(() => session.setVisibleRange({ left: 1, right: 2 })).not.toThrow();
        expect(() => session.notifyBars()).not.toThrow();
        expect(fake.posted).toHaveLength(posted);
    });

    it('contains postMessage failures from live session mutators', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const session = engine.execute(makeReq({ mode: 'live' }), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });

        fake.postFailure = new Error('live update structured clone failed');
        expect(() => session.update({ Length: 20 })).not.toThrow();
        expect(errors.map((error) => error.message)).toEqual(['live update structured clone failed']);
        expect(() => session.setVisibleRange({ left: 1, right: 2 })).not.toThrow();
        expect(() => session.notifyBars()).not.toThrow();
    });

    it('contains a coalesced flush failure when a run acknowledgement arrives', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const errors: Error[] = [];
        const session = engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: (error) => errors.push(error),
        });
        const sessionId = fake.last('execute')!.sessionId;

        // Keep one update dirty behind the initial run, then fail the flush
        // post from runFinished. The protocol callback must not throw.
        session.notifyBars();
        fake.postFailure = new Error('flush structured clone failed');
        expect(() => fake.reply({ kind: 'done', sessionId })).not.toThrow();
        expect(errors.map((error) => error.message)).toEqual(['flush structured clone failed']);
    });

    it('keeps replacement state created from a fatal-worker callback', async () => {
        const first = new FakeWorker();
        const replacement = new FakeWorker();
        const workers = [first, replacement];
        const engine = new PineWorkerEngine({ createWorker: () => workers.shift()! });
        let replacementPrepare: Promise<PreparedScript> | undefined;

        engine.execute(makeReq(), {
            onModel: () => undefined,
            onError: () => {
                // Hosts commonly rebuild an indicator immediately after a
                // worker crash. This must belong to the new worker generation.
                replacementPrepare = engine.prepare('//replacement', 'replacement');
            },
        });

        first.fail({ message: 'worker crashed' });
        const request = replacement.last('prepare');
        expect(request).toBeDefined();
        replacement.reply({ kind: 'prepared', reqId: request!.reqId, prepared: PREPARED });
        await expect(replacementPrepare).resolves.toMatchObject({ meta: { title: 'EMA' } });
        expect(first.terminated).toBe(true);
        expect(replacement.terminated).toBe(false);
    });

    it('does not cache a worker when listener registration fails', async () => {
        const broken = new FakeWorker();
        broken.throwOnListener = 'messageerror';
        const healthy = new FakeWorker();
        const workers = [broken, healthy];
        const engine = new PineWorkerEngine({ createWorker: () => workers.shift()! });

        const failed = engine.prepare('//broken', 'broken');
        await expect(failed).rejects.toThrow('cannot add messageerror listener');
        expect(broken.terminated).toBe(true);

        const retry = engine.prepare('//healthy', 'healthy');
        const request = healthy.last('prepare');
        expect(request).toBeDefined();
        healthy.reply({ kind: 'prepared', reqId: request!.reqId, prepared: PREPARED });
        await expect(retry).resolves.toMatchObject({ meta: { title: 'EMA' } });
    });

    it('drops a late provider response after ExecutionSession.stop without reviving the worker', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        let release!: (bars: OHLCV[]) => void;
        const session = engine.execute(makeReq({
            fetchSeries: async () => new Promise<OHLCV[]>((resolve) => { release = resolve; }),
        }), { onModel: () => undefined });
        const sessionId = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'fetchSeries', sessionId, reqId: 71, symbol: 'ETHUSDT', timeframe: '60', range: { limit: 2 } });
        expect(release).toBeTypeOf('function');
        const postedBeforeStop = fake.posted.length;
        session.stop();
        release([bar(3)]);
        await flush();

        expect(fake.posted.length).toBe(postedBeforeStop + 1); // the stop frame only
        expect(fake.posted.filter((message) => message.kind === 'fetchSeriesResult')).toHaveLength(0);
        expect(fake.terminated).toBe(false);
    });

    it('drops a late provider response after engine.terminate without spawning a replacement worker', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        let release!: (bars: OHLCV[]) => void;
        const session = engine.execute(makeReq({
            fetchSeries: async () => new Promise<OHLCV[]>((resolve) => { release = resolve; }),
        }), { onModel: () => undefined });
        const sessionId = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'fetchSeries', sessionId, reqId: 72, symbol: 'ETHUSDT', timeframe: '60', range: { limit: 2 } });
        expect(release).toBeTypeOf('function');
        engine.terminate();
        expect(fake.terminated).toBe(true);
        const postedAfterTerminate = fake.posted.length;
        release([bar(4)]);
        await flush();

        expect(fake.posted).toHaveLength(postedAfterTerminate);
        // The old session proxy remains safe to call after engine teardown.
        session.stop();
    });

    it('ships declaration props: defaultProps on prepare, props on execute/update', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake, defaultProps: { initial_capital: 50000 } });

        void engine.prepare('//src', 'ind-1');
        expect(fake.last('prepare')).toMatchObject({ defaultProps: { initial_capital: 50000 } });

        // The visibility option rides the prepare message too.
        const gated = new FakeWorker();
        void new PineWorkerEngine({ createWorker: () => gated, props: 'strategy' }).prepare('//src', 'ind-2');
        expect(gated.last('prepare')).toMatchObject({ propsVisibility: 'strategy' });

        const session = engine.execute(makeReq({ props: { initial_capital: 25000, pyramiding: 1 } }), { onModel: () => {} });
        expect(fake.last('execute')!.props).toEqual({ initial_capital: 25000, pyramiding: 1 });

        session.update({ Length: 50 }, { pyramiding: 3 });
        expect(fake.last('update')).toMatchObject({ inputs: { Length: 50 }, props: { pyramiding: 3 } });

        // An inputs-only update carries no props key at all (merge stays worker-side).
        session.update({ Length: 60 });
        expect('props' in fake.last('update')!).toBe(false);
    });

    it('coalesces notifyBars bursts: dirty while a run is in flight, ONE re-run when it lands', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq(), { onModel: () => {} });
        const sid = fake.last('execute')!.sessionId;
        const notifies = (): number => fake.posted.filter((m) => m.kind === 'notifyBars').length;

        // The initial execute run is still in flight → a tick burst (e.g. a gap heal) coalesces.
        session.notifyBars();
        session.notifyBars();
        session.notifyBars();
        expect(notifies()).toBe(0);

        // The run lands → exactly one coalesced notifyBars posts (a fresh snapshot).
        fake.reply({ kind: 'done', sessionId: sid });
        expect(notifies()).toBe(1);

        // That flushed run completes with nothing dirty → no further posts.
        fake.reply({ kind: 'done', sessionId: sid });
        expect(notifies()).toBe(1);

        // Idle session → a tick posts immediately.
        session.notifyBars();
        expect(notifies()).toBe(2);

        // An 'error' also acks a run: a tick during it goes dirty, then flushes on the error.
        session.notifyBars();
        expect(notifies()).toBe(2);
        fake.reply({ kind: 'error', sessionId: sid, message: 'boom' });
        expect(notifies()).toBe(3);
    });

    it('backfill notifications never reach the worker; complete ships a fresh snapshot', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(1), bar(2)];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, historyState: 'backfill' }), { onModel: () => {} });
        const sid = fake.last('execute')!.sessionId;

        // The execute message carries the history state (the worker defers the first run).
        expect(fake.last('execute')!.historyState).toBe('backfill');
        fake.reply({ kind: 'done', sessionId: sid }); // the worker acks the held run

        // Chunk prepends: nothing posts — not even a dirty flag for later.
        session.notifyBars('backfill');
        session.notifyBars('backfill');
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(0);

        // Backfill finished: one notifyBars with the current full snapshot.
        bars.push(bar(3));
        session.notifyBars('complete');
        const complete = fake.last('notifyBars')!;
        expect(complete.bars).toHaveLength(3);
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(1);
    });

    it("a 'complete' arriving while a run is in flight is not lost to coalescing", () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const session = engine.execute(makeReq({ historyState: 'backfill' }), { onModel: () => {} });
        const sid = fake.last('execute')!.sessionId;

        // The held execute run has NOT been acked yet → 'complete' coalesces to dirty…
        session.notifyBars('complete');
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(0);
        // …and flushes as a real run the moment the ack lands.
        fake.reply({ kind: 'done', sessionId: sid });
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(1);
    });

    it('live sessions stream: ticks post 1-bar tails, never full snapshots or run bookkeeping', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(1), bar(2), bar(3)];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, mode: 'live' }), { onModel: () => {} });
        const exec = fake.last('execute')!;
        expect(exec.mode).toBe('live');
        expect(exec.bars).toHaveLength(3);

        // A tick: the forming bar changed — only IT crosses (time >= lastSentTime).
        bars[2] = { ...bars[2]!, close: 42 };
        session.notifyBars();
        const tick = fake.last('bars')!;
        expect(tick.restart).toBeUndefined();
        expect(tick.bars).toHaveLength(1);
        expect(tick.bars[0]!.close).toBe(42);

        // A new bar: forming + new travel together.
        bars.push(bar(4));
        session.notifyBars();
        expect(fake.last('bars')!.bars).toHaveLength(2);

        // The live session never acked anything, yet every message went straight out —
        // no pendingRuns coalescing ever held a live post back.
        expect(fake.posted.filter((m) => m.kind === 'notifyBars')).toHaveLength(0);
        expect(fake.posted.filter((m) => m.kind === 'done' as never)).toHaveLength(0);

        session.update({ Length: 9 });
        expect(fake.last('update')).toMatchObject({ inputs: { Length: 9 } });
        session.notifyBars(); // still flows after an un-acked update
        bars[3] = { ...bars[3]!, close: 7 };
        session.notifyBars();
        expect(fake.last('bars')!.bars[fake.last('bars')!.bars.length - 1]!.close).toBe(7);
        session.stop();
        expect(fake.last('stop')).toBeDefined();
    });

    it('a live session under backfill stays silent until complete restarts the stream over the full depth', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(10), bar(11)];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, mode: 'live', historyState: 'backfill' }), { onModel: () => {} });
        expect(fake.last('execute')!.historyState).toBe('backfill');

        session.notifyBars('backfill'); // chunks land — nothing crosses
        session.notifyBars('backfill');
        expect(fake.posted.filter((m) => m.kind === 'bars')).toHaveLength(0);

        bars.unshift(bar(1), bar(2)); // history deepened
        session.notifyBars('complete');
        const restart = fake.last('bars')!;
        expect(restart.restart).toBe(true);
        expect(restart.bars).toHaveLength(4); // the FULL snapshot

        // lastSentTime was reset by the restart: the next tick ships only the forming bar.
        bars[3] = { ...bars[3]!, close: 5 };
        session.notifyBars();
        expect(fake.last('bars')!.bars).toHaveLength(1);
    });

    it("a live stream 'error' routes to onError without corrupting the static run bookkeeping", () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const bars = [bar(1), bar(2)];
        const errs: Error[] = [];
        const session = engine.execute(makeReq({ bars, getBars: () => bars, mode: 'live' }), { onModel: () => {}, onError: (e) => errs.push(e) });
        const sid = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'error', sessionId: sid, message: 'stream boom' });
        expect(errs[0]?.message).toBe('stream boom');

        // Still fully live afterward: a tick posts immediately.
        bars[1] = { ...bars[1]!, close: 11 };
        session.notifyBars();
        expect(fake.last('bars')!.bars).toHaveLength(1);
    });

    it('serves a worker fetchSeries request via the request gateway', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const secBars = [bar(10), bar(11)];
        let asked: { sym: string; tf: string } | null = null;
        const session = engine.execute(makeReq({ fetchSeries: async (sym, tf) => ((asked = { sym, tf }), secBars) }), { onModel: () => {} });
        const sessionId = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'fetchSeries', sessionId, reqId: 7, symbol: 'ETHUSDT', timeframe: '240', range: { limit: 100 } });
        await flush();

        expect(asked).toEqual({ sym: 'ETHUSDT', tf: '240' });
        expect(fake.last('fetchSeriesResult')).toMatchObject({ reqId: 7, bars: secBars });
        session.stop();
    });

    it('routes concurrent fetchSeries requests through their originating session gateway', async () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const firstBars = [bar(101)];
        const secondBars = [bar(202)];
        const calls: string[] = [];
        const first = engine.execute(makeReq({ fetchSeries: async () => {
            calls.push('first');
            return firstBars;
        } }), { onModel: () => {} });
        const firstSessionId = fake.last('execute')!.sessionId;
        const second = engine.execute(makeReq({ fetchSeries: async () => {
            calls.push('second');
            return secondBars;
        } }), { onModel: () => {} });
        const secondSessionId = fake.last('execute')!.sessionId;
        expect(secondSessionId).not.toBe(firstSessionId);

        // Reply in reverse order to make an accidental "first callback wins"
        // implementation observable.
        fake.reply({ kind: 'fetchSeries', sessionId: secondSessionId, reqId: 22, symbol: 'ETHUSDT', timeframe: '240', range: { limit: 2 } });
        fake.reply({ kind: 'fetchSeries', sessionId: firstSessionId, reqId: 11, symbol: 'BTCUSDT', timeframe: '60', range: { limit: 1 } });
        await flush();

        expect(calls).toEqual(['second', 'first']);
        const responses = fake.posted.filter((message): message is Extract<MainToWorker, { kind: 'fetchSeriesResult' }> => message.kind === 'fetchSeriesResult');
        expect(responses.find((message) => message.reqId === 22)?.bars).toEqual(secondBars);
        expect(responses.find((message) => message.reqId === 11)?.bars).toEqual(firstBars);
        first.stop();
        second.stop();
    });

    it('refines reactsToViewport in place and routes errors', () => {
        const fake = new FakeWorker();
        const engine = new PineWorkerEngine({ createWorker: () => fake });
        const req = makeReq();
        const errs: Error[] = [];
        engine.execute(req, { onModel: () => {}, onError: (e) => errs.push(e) });
        const sid = fake.last('execute')!.sessionId;

        fake.reply({ kind: 'reactsToViewport', sessionId: sid, value: true });
        expect(req.prepared.reactsToViewport).toBe(true);

        fake.reply({ kind: 'error', sessionId: sid, message: 'boom' });
        expect(errs[0]?.message).toBe('boom');
    });
});
