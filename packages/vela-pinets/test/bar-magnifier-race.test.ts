import { describe, expect, it, vi } from 'vitest';
import type { OHLCV, IndicatorModel } from '@luxalgo/vela/plugin';
import { PineEngine } from '../src/pinets/PineEngine';
import { LowerTimeframeFetchCache } from '../src/pinets/runtime';

const HOUR = 60 * 60_000;
const T0 = Date.UTC(2024, 0, 1);

const parent = (index: number, close = 100): OHLCV => ({
    time: T0 + index * HOUR,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
});

const child = (time: number): OHLCV => ({
    time,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
});

const SOURCE = `//@version=6
strategy('lower-feed race', use_bar_magnifier=true)
plot(close, 'close')
`;

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (!predicate()) throw new Error('timed out waiting for PineEngine run');
}

function pointCount(model: IndicatorModel): number {
    const series = model.series.find((entry) => 'points' in entry) as { points?: unknown[] } | undefined;
    return series?.points?.length ?? 0;
}

describe('PineEngine static Bar Magnifier races', () => {
    it('invalidates same-range lower data on notifyBars and serializes runs', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(SOURCE, 'lower-feed-race');
        const bars = [parent(0)];
        const pending: Array<(value: OHLCV[]) => void> = [];
        let fetchCalls = 0;
        const fetchSeries = async (): Promise<OHLCV[]> => {
            fetchCalls += 1;
            return new Promise<OHLCV[]>((resolve) => pending.push(resolve));
        };
        const models: IndicatorModel[] = [];
        const session = engine.execute({
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars,
            getBars: () => bars,
            inputs: {},
            mode: 'static',
            fetchSeries,
        }, { onModel: (model) => models.push(model) });

        await waitFor(() => fetchCalls === 1);
        // The forming parent keeps the same provider range. Its lower candles
        // nevertheless changed, so this notification must force a new fetch.
        bars[0] = parent(0, 101);
        session.notifyBars();

        // Worker parity: the second run waits behind the in-flight first run;
        // there must be no loose concurrent lower fetch or stale model race.
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fetchCalls).toBe(1);
        pending.shift()!( [child(T0)] );
        await waitFor(() => fetchCalls === 2);
        pending.shift()!( [child(T0)] );
        await waitFor(() => models.length === 2);

        expect(models.map(pointCount)).toEqual([1, 1]);
        expect(fetchCalls).toBe(2);
        session.stop();
    });

    it('publishes the newest queued snapshot last when bars grow during a fetch', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(SOURCE, 'lower-feed-order');
        const bars = [parent(0)];
        const pending: Array<(value: OHLCV[]) => void> = [];
        let fetchCalls = 0;
        const fetchSeries = async (): Promise<OHLCV[]> => {
            fetchCalls += 1;
            return new Promise<OHLCV[]>((resolve) => pending.push(resolve));
        };
        const models: IndicatorModel[] = [];
        const session = engine.execute({
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars,
            getBars: () => bars,
            inputs: {},
            mode: 'static',
            fetchSeries,
        }, { onModel: (model) => models.push(model) });

        await waitFor(() => fetchCalls === 1);
        bars.push(parent(1, 102));
        session.notifyBars();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(fetchCalls).toBe(1);
        pending.shift()!([child(T0)]);
        await waitFor(() => fetchCalls === 2);
        pending.shift()!([child(T0), child(T0 + HOUR)]);
        await waitFor(() => models.length === 2);

        // The stale first run cannot arrive after the fresh second run. The
        // final model reflects the two-parent snapshot observed at notifyBars.
        expect(models.map(pointCount)).toEqual([1, 2]);
        session.stop();
    });

    it('suppresses a provider error that resolves after ExecutionSession.stop', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(SOURCE, 'lower-feed-stop-race');
        const bars = [parent(0)];
        let rejectFetch!: (error: Error) => void;
        let fetchCalls = 0;
        const fetchSeries = async (): Promise<OHLCV[]> => {
            fetchCalls += 1;
            return new Promise<OHLCV[]>((_resolve, reject) => { rejectFetch = reject; });
        };
        const errors: Error[] = [];
        const session = engine.execute({
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars,
            getBars: () => bars,
            inputs: {},
            mode: 'static',
            fetchSeries,
        }, { onModel: () => undefined, onError: (error) => errors.push(error) });

        await waitFor(() => fetchCalls === 1);
        session.stop();
        rejectFetch(new Error('late lower-feed failure'));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(errors).toEqual([]);
    });

    it('clears lower-feed cache before restarting a live stream', async () => {
        const clear = vi.spyOn(LowerTimeframeFetchCache.prototype, 'clear');
        const engine = new PineEngine();
        const prepared = await engine.prepare(SOURCE, 'lower-feed-live-restart');
        const bars = [parent(0)];
        const models: IndicatorModel[] = [];
        const session = engine.execute({
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            bars,
            getBars: () => bars,
            inputs: {},
            mode: 'live',
            historyState: 'backfill',
        }, { onModel: (model) => models.push(model) });

        try {
            // Completing history starts the first stream and must begin with a
            // fresh lower-feed window, even though this live path currently
            // reports Bar Magnifier as unsupported while child refresh is not
            // synchronized.
            session.notifyBars('complete');
            await waitFor(() => models.length >= 1);
            const afterComplete = clear.mock.calls.length;

            // Input updates restart the persistent stream as well. A reused
            // parent range must not retain the previous stream's child data.
            session.update({ probe: 1 });
            await waitFor(() => models.length >= 2);
            expect(clear.mock.calls.length).toBeGreaterThan(afterComplete);
        } finally {
            session.stop();
            clear.mockRestore();
        }
    }, 20_000);
});
