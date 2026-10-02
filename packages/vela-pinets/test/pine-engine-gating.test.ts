import { describe, it, expect } from 'vitest';
import { PineEngine } from '../src/pinets/PineEngine';
import type { ExecutionRequest, ExecutionHandlers } from '@luxalgo/vela/plugin';
import type { IndicatorModel } from '@luxalgo/vela/plugin';
import type { OHLCV } from '@luxalgo/vela/plugin';
import { PINE_EXECUTION_BUILD_INFO } from '../src/build-info';
import { pineContextSelect } from '../src/pinets/reportSeries';
import type { PineContextSnapshot } from '../src/pinets/contextSnapshot';
import type { StrategyReportState } from '../src/pinets/strategyState';

/**
 * Policy-A gating of the IN-PROCESS engine (the worker engine shares the same
 * policy; its main-thread half is covered in pine-worker-engine.test.ts): a
 * session started during a history backfill holds every run — merging state
 * changes meanwhile — until the `'complete'` notification, then runs ONCE over
 * the full history.
 */

const SOURCE = `//@version=5
indicator("Gate probe", overlay=true)
plot(close, "c")
`;

const STRATEGY_SOURCE = `//@version=6
strategy("Report identity", overlay=true, initial_capital=10000)
plot(close, "c")
`;

function makeBars(n: number): OHLCV[] {
    const out: OHLCV[] = [];
    for (let i = 0; i < n; i += 1) {
        out.push({ time: 1_700_000_000_000 + i * 60_000, open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1 });
    }
    return out;
}

async function waitFor(cond: () => boolean, ms = 10_000): Promise<void> {
    const deadline = Date.now() + ms;
    while (!cond()) {
        if (Date.now() > deadline) throw new Error('timed out waiting for condition');
        await new Promise((r) => setTimeout(r, 20));
    }
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 150));

async function prepared(engine: PineEngine): Promise<ExecutionRequest['prepared']> {
    return engine.prepare(SOURCE, 'gate-1');
}

function makeReq(p: ExecutionRequest['prepared'], bars: OHLCV[], extra: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return { prepared: p, market: { symbol: 'TEST', timeframe: '60' }, bars, getBars: () => bars, inputs: {}, mode: 'static', ...extra };
}

describe('PineEngine policy-A gating (static)', () => {
    it('keeps malformed prepare failures asynchronous like the Worker engine', async () => {
        const engine = new PineEngine();
        let pending: Promise<ExecutionRequest['prepared']>;
        expect(() => {
            pending = engine.prepare(null as unknown as string, 'bad-source');
        }).not.toThrow();
        await expect(pending!).rejects.toBeInstanceOf(Error);
    });

    it('routes static host callback failures through onError without rejecting the run chain', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const bars = makeBars(4);
        const errors: Error[] = [];
        const session = engine.execute(makeReq(p, bars), {
            onModel: () => { throw new Error('model renderer failed'); },
            onError: (error) => errors.push(error),
        });
        await waitFor(() => errors.length > 0);
        expect(errors[0]?.message).toBe('model renderer failed');
        session.stop();
    });

    it('contains a throwing completion callback and still schedules later updates', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const bars = makeBars(4);
        const models: IndicatorModel[] = [];
        const errors: Error[] = [];
        let doneCalls = 0;
        const session = engine.execute(makeReq(p, bars), {
            onModel: (model) => models.push(model),
            onDone: () => { doneCalls += 1; throw new Error('done renderer failed'); },
            onError: (error) => errors.push(error),
        });
        await waitFor(() => doneCalls === 1);
        expect(errors[0]?.message).toBe('done renderer failed');
        session.notifyBars();
        await waitFor(() => models.length >= 2);
        expect(doneCalls).toBeGreaterThanOrEqual(2);
        session.stop();
    });

    it('runs immediately when no historyState is given (regression: today’s behavior)', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const models: IndicatorModel[] = [];
        engine.execute(makeReq(p, makeBars(10)), { onModel: (m) => models.push(m) });
        await waitFor(() => models.length === 1);
    });

    it('returns null and becomes inert after a static session is stopped', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const bars = makeBars(4);
        const models: IndicatorModel[] = [];
        const session = engine.execute(makeReq(p, bars), { onModel: (model) => models.push(model) });
        await waitFor(() => models.length === 1);

        session.stop();
        await expect(session.getContext?.()).resolves.toBeNull();
        const before = models.length;
        session.update({ Length: 99 });
        session.setVisibleRange({ left: bars[0]!.time, right: bars.at(-1)!.time });
        session.notifyBars();
        await settle();
        expect(models).toHaveLength(before);
    });

    it('publishes the in-process build fingerprint and local sentinel through context', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        expect((p.token as { build?: unknown }).build).toEqual(PINE_EXECUTION_BUILD_INFO);
        const models: IndicatorModel[] = [];
        const session = engine.execute(makeReq(p, makeBars(10)), { onModel: (model) => models.push(model) });
        await waitFor(() => models.length === 1);
        const context = await session.getContext?.() as (Awaited<ReturnType<NonNullable<typeof session.getContext>>>
            & { provenance?: { execution?: string; buildFingerprint?: string; sentinel?: string } }) | null;
        expect(context?.provenance).toMatchObject({
            execution: 'in-process',
            buildFingerprint: PINE_EXECUTION_BUILD_INFO.buildFingerprint,
            sentinel: PINE_EXECUTION_BUILD_INFO.sentinel,
        });
        session.stop();
    });

    it('defers under backfill: no run on start/update/setVisibleRange/tick — ONE run on complete', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const bars = makeBars(10);
        const models: IndicatorModel[] = [];
        const errors: Error[] = [];
        const handlers: ExecutionHandlers = { onModel: (m) => models.push(m), onError: (e) => errors.push(e) };
        const session = engine.execute(makeReq(p, bars, { historyState: 'backfill' }), handlers);

        session.update({ anything: 1 });
        session.setVisibleRange({ left: bars[0]!.time, right: bars[9]!.time });
        session.notifyBars('backfill'); // chunk prepended
        session.notifyBars(); // live tick during backfill — still held (policy A)
        await settle();
        expect(models).toHaveLength(0);
        expect(errors).toHaveLength(0);

        bars.unshift(...makeBars(5).map((b) => ({ ...b, time: b.time - 5 * 60_000 }))); // history deepened
        session.notifyBars('complete');
        await waitFor(() => models.length === 1);
        // The single run saw the FULL deepened history (15 bars → 15 plotted points).
        const series = models[0]!.series.find((s) => 'points' in s) as { points: unknown[] } | undefined;
        expect(series?.points).toHaveLength(15);

        // After completion the session behaves normally: a tick re-runs.
        session.notifyBars();
        await waitFor(() => models.length === 2);
        session.stop();
    });

    it('backfill pokes on a NON-deferred session are ignored; complete is just a run', async () => {
        const engine = new PineEngine();
        const p = await prepared(engine);
        const models: IndicatorModel[] = [];
        const session = engine.execute(makeReq(p, makeBars(10)), { onModel: (m) => models.push(m) });
        await waitFor(() => models.length === 1);

        session.notifyBars('backfill'); // a mid-life backfill started — hold further runs? No:
        await settle(); // policy A only DEFERS; an already-produced model stays, backfill pokes are skipped
        expect(models).toHaveLength(1);

        session.notifyBars('complete');
        await waitFor(() => models.length === 2);
        session.stop();
    });

    it('static reruns rotate runId; repeated getContext calls do not advance revision', async () => {
        const engine = new PineEngine();
        const p = await engine.prepare(STRATEGY_SOURCE, 'static-report');
        const bars = makeBars(4);
        const models: IndicatorModel[] = [];
        const session = engine.execute(makeReq(p, bars), { onModel: (model) => models.push(model) });
        await waitFor(() => models.length === 1);

        const readSummary = async (): Promise<StrategyReportState> => {
            const snapshot = await session.getContext?.(pineContextSelect('strategy')) as PineContextSnapshot | null;
            return snapshot!.strategy as StrategyReportState;
        };
        const first = await readSummary();
        const repeated = await readSummary();
        expect(first.reportRunId).toBeTruthy();
        expect(repeated.reportRunId).toBe(first.reportRunId);
        expect(first.reportSnapshotRevision).toBe(1);
        expect(repeated.reportSnapshotRevision).toBe(1);

        const report = await session.getContext?.(
            pineContextSelect('strategy', 'reportSeries', 'reportTail'),
        ) as PineContextSnapshot | null;
        expect(report?.reportSeries).toMatchObject({
            schemaVersion: 1,
            runId: first.reportRunId,
            snapshotRevision: 1,
            barIndex: bars.length - 1,
        });
        expect(report?.reportSeries?.points).toHaveLength(bars.length);
        expect(report?.reportSeries?.points[0]).toEqual(expect.objectContaining({
            barIndex: 0,
            time: bars[0]!.time,
            equity: 10_000,
            realizedPnl: 0,
            openPnl: 0,
            underwater: 0,
            underwaterPercent: 0,
            maxDrawdown: 0,
            maxDrawdownPercent: 0,
            benchmarkEquity: null,
            benchmarkPnl: null,
            benchmarkReturnPercent: null,
        }));
        expect(report?.reportTail).toEqual({
            ...report?.reportSeries,
            points: [report?.reportSeries?.points.at(-1)],
        });
        expect(report?.strategy).toMatchObject({
            reportRunId: report?.reportSeries?.runId,
            reportSnapshotRevision: report?.reportSeries?.snapshotRevision,
            reportPointCount: bars.length,
        });

        session.notifyBars();
        await waitFor(() => models.length === 2);
        const rerun = await readSummary();
        expect(rerun.reportRunId).not.toBe(first.reportRunId);
        expect(rerun.reportSnapshotRevision).toBe(1);
        session.stop();
    });

    it('a live stream keeps runId and advances revision only when a tick evaluates', async () => {
        const engine = new PineEngine();
        const p = await engine.prepare(STRATEGY_SOURCE, 'live-report');
        const bars = makeBars(4);
        const models: IndicatorModel[] = [];
        const session = engine.execute(makeReq(p, bars, { mode: 'live' }), { onModel: (model) => models.push(model) });
        await waitFor(() => models.length >= 1);

        const read = async (): Promise<StrategyReportState> => {
            const snapshot = await session.getContext?.(pineContextSelect('strategy')) as PineContextSnapshot | null;
            return snapshot!.strategy as StrategyReportState;
        };
        const first = await read();
        const repeated = await read();
        expect(repeated.reportRunId).toBe(first.reportRunId);
        expect(repeated.reportSnapshotRevision).toBe(first.reportSnapshotRevision);
        const firstTail = await session.getContext?.(
            pineContextSelect('strategy', 'reportTail'),
        ) as PineContextSnapshot | null;
        expect(firstTail?.reportTail).toMatchObject({
            schemaVersion: 1,
            runId: first.reportRunId,
            snapshotRevision: first.reportSnapshotRevision,
            barIndex: bars.length - 1,
        });
        expect(firstTail?.reportTail?.points).toHaveLength(1);

        const before = models.length;
        bars[bars.length - 1] = { ...bars[bars.length - 1]!, close: bars[bars.length - 1]!.close + 2 };
        session.notifyBars();
        await waitFor(() => models.length > before);
        const tick = await read();
        expect(tick.reportRunId).toBe(first.reportRunId);
        expect(tick.reportSnapshotRevision).toBeGreaterThan(first.reportSnapshotRevision ?? 0);
        expect(tick.reportPointCount).toBe(first.reportPointCount);
        const tickTail = await session.getContext?.(
            pineContextSelect('strategy', 'reportTail'),
        ) as PineContextSnapshot | null;
        expect(tickTail?.reportTail?.runId).toBe(first.reportRunId);
        expect(tickTail?.reportTail?.snapshotRevision).toBe(tick.reportSnapshotRevision);
        expect(tickTail?.reportTail?.points).toHaveLength(1);
        session.stop();
    }, 20_000);
});
