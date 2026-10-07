import { describe, expect, it } from 'vitest';
import type { OHLCV } from '@luxalgo/vela/plugin';
import { PineEngine } from '../src/pinets/PineEngine';
import {
    barMagnifierTimeframe,
    indicatorFor,
    LowerTimeframeFetchCache,
    preparePine,
    resolveBarMagnifier,
    runPineStatic,
    secondaryKlines,
} from '../src/pinets/runtime';

const DAY = 24 * 60 * 60_000;

const bars = (count: number): OHLCV[] => Array.from({ length: count }, (_, index) => ({
    time: Date.UTC(2024, 0, 1) + index * DAY,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1,
}));

const strategySource = `
//@version=6
strategy('Magnifier', use_bar_magnifier=true)
`;

async function waitFor(predicate: () => boolean): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 0));
    if (!predicate()) throw new Error('timed out waiting for engine run');
}

describe('Bar Magnifier runtime request resolution', () => {
    it('deduplicates concurrent lower-feed windows and retains successful results', async () => {
        const cache = new LowerTimeframeFetchCache(2);
        const range = { from: 1, to: 2, limit: 10 };
        let calls = 0;
        let requestedRange: { from?: number; to?: number; limit?: number; session?: string } | undefined;
        let release!: (bars: OHLCV[]) => void;
        const fetcher = async (
            _symbol: string,
            _timeframe: string,
            providerRange: { from?: number; to?: number; limit?: number; session?: string },
        ): Promise<OHLCV[]> => {
            calls += 1;
            requestedRange = { ...providerRange };
            return new Promise((resolve) => {
                release = resolve;
            });
        };

        const first = cache.fetch(fetcher, 'BTCUSDT', '60', range);
        const second = cache.fetch(fetcher, 'BTCUSDT', '60', range);
        range.to = 999; // The queued provider request must use the original window.
        expect(second).toBe(first);
        // The provider invocation is deliberately deferred, but both callers
        // still share the same pending promise before it starts.
        await Promise.resolve();
        expect(calls).toBe(1);
        expect(requestedRange).toEqual({ from: 1, to: 2, limit: 10 });
        const child = [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
        release(child);
        await expect(first).resolves.toBe(child);
        range.to = 2;
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toBe(child);
        expect(calls).toBe(1);
    });

    it('uses safe defaults for malformed cache options from a runtime boundary', async () => {
        expect(() => new LowerTimeframeFetchCache(null as never)).not.toThrow();
        expect(() => new LowerTimeframeFetchCache([] as never)).not.toThrow();
        const cache = new LowerTimeframeFetchCache(null as never);
        let calls = 0;
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            return [{ time: calls, open: 1, high: 1, low: 1, close: 1 }];
        };
        await cache.fetch(fetcher, 'BTCUSDT', '10', { from: 1, to: 2, limit: 1 });
        await cache.fetch(fetcher, 'BTCUSDT', '10', { from: 1, to: 2, limit: 1 });
        expect(calls).toBe(1);
    });

    it('expires fulfilled windows by TTL without breaking in-flight dedupe', async () => {
        let now = 1_000;
        const cache = new LowerTimeframeFetchCache({ ttlMs: 100, now: () => now });
        let calls = 0;
        let release!: (bars: OHLCV[]) => void;
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            if (calls === 1) {
                return new Promise((resolve) => { release = resolve; });
            }
            return [{ time: calls, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
        };
        const range = { from: 1, to: 2, limit: 1 };
        const pending = cache.fetch(fetcher, 'BTCUSDT', '60', range);
        now = 10_000; // A slow in-flight request is still coalesced.
        expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).toBe(pending);
        await Promise.resolve();
        release([{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]);
        await pending;
        expect(calls).toBe(1);

        now = 10_099;
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toHaveLength(1);
        expect(calls).toBe(1);
        now = 10_100; // Expiry is inclusive: the entry is stale at its deadline.
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toHaveLength(1);
        expect(calls).toBe(2);
    });

    it('supports explicit provider/window invalidation without cancelling callers', async () => {
        const cache = new LowerTimeframeFetchCache({ ttlMs: Infinity });
        let calls = 0;
        const provider = async (): Promise<OHLCV[]> => {
            calls += 1;
            return [{ time: calls, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
        };
        const otherProvider = async (): Promise<OHLCV[]> => {
            calls += 1;
            return [{ time: calls, open: 2, high: 2, low: 2, close: 2, volume: 1 }];
        };
        const range = { from: 1, to: 2, limit: 1 };
        await cache.fetch(provider, 'BTCUSDT', '60', range);
        await cache.fetch(provider, 'ETHUSDT', '60', range);
        await cache.fetch(otherProvider, 'BTCUSDT', '60', range);
        expect(cache.invalidateWindow(provider, 'BTCUSDT', '60', range)).toBe(true);
        expect(cache.invalidateWindow(provider, 'BTCUSDT', '60', range)).toBe(false);
        await cache.fetch(provider, 'BTCUSDT', '60', range);
        expect(cache.invalidateProvider(provider)).toBe(2); // BTCUSDT + ETHUSDT
        await cache.fetch(provider, 'ETHUSDT', '60', range);
        // The other gateway remains warm and is never invalidated by provider.
        await cache.fetch(otherProvider, 'BTCUSDT', '60', range);
        expect(calls).toBe(5);
    });

    it('isolates cached windows by provider, symbol, timeframe, and range', async () => {
        const cache = new LowerTimeframeFetchCache();
        const range = { from: 1, to: 2, limit: 10, session: 'regular' };
        const calls = { first: 0, second: 0 };
        const firstBars = [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
        const secondBars = [{ time: 1, open: 10, high: 20, low: 0, close: 10, volume: 1 }];
        const firstProvider = async (): Promise<OHLCV[]> => {
            calls.first += 1;
            return firstBars;
        };
        const secondProvider = async (): Promise<OHLCV[]> => {
            calls.second += 1;
            return secondBars;
        };

        await expect(cache.fetch(firstProvider, 'BTCUSDT', '60', range)).resolves.toBe(firstBars);
        // The provider gateway is part of the data identity. A second gateway
        // can represent another venue/account even when every request field is
        // identical, so it must never receive the first provider's candles.
        await expect(cache.fetch(secondProvider, 'BTCUSDT', '60', range)).resolves.toBe(secondBars);
        await expect(cache.fetch(firstProvider, 'BTCUSDT', '60', range)).resolves.toBe(firstBars);

        await cache.fetch(firstProvider, 'ETHUSDT', '60', range);
        await cache.fetch(firstProvider, 'BTCUSDT', '15', range);
        await cache.fetch(firstProvider, 'BTCUSDT', '60', { ...range, to: 3 });

        expect(calls).toEqual({ first: 4, second: 1 });
        expect(cache.size).toBe(5);
    });

    it('does not retain failed lower-feed requests and keeps range keys isolated', async () => {
        const cache = new LowerTimeframeFetchCache(2);
        let calls = 0;
        const fetcher = async (_symbol: string, _timeframe: string, range: { from?: number }): Promise<OHLCV[]> => {
            calls += 1;
            if (calls === 1) throw new Error('temporary gateway failure');
            return [{ time: range.from ?? 0, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
        };
        const range = { from: 10, to: 20, limit: 2 };
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).rejects.toThrow('temporary gateway failure');
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toHaveLength(1);
        expect(calls).toBe(2);

        // A different bound is a different provider request, even when the
        // symbol/timeframe pair is unchanged.
        await cache.fetch(fetcher, 'BTCUSDT', '60', { ...range, to: 21 });
        await cache.fetch(fetcher, 'BTCUSDT', '60', { ...range, session: 'extended' });
        expect(calls).toBe(4);
    });

    it('does not retain an empty lower feed, allowing a later retry to recover data', async () => {
        const cache = new LowerTimeframeFetchCache();
        let calls = 0;
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            return calls === 1 ? [] : [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
        };
        const range = { from: 1, to: 2, limit: 1 };
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toEqual([]);
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toHaveLength(1);
        expect(calls).toBe(2);
    });

    it('does not retain mixed malformed lower rows, allowing a later retry to recover', async () => {
        const cache = new LowerTimeframeFetchCache({ ttlMs: Infinity });
        let calls = 0;
        const valid = { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            return calls === 1 ? [valid, { time: Number.NaN } as OHLCV] : [valid];
        };
        const range = { from: 1, to: 2, limit: 2 };
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toHaveLength(2);
        await expect(cache.fetch(fetcher, 'BTCUSDT', '60', range)).resolves.toEqual([valid]);
        expect(calls).toBe(2);
    });

    it('evicts old windows at the session bound while leaving request.security uncached', async () => {
        const cache = new LowerTimeframeFetchCache(2);
        let calls = 0;
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            return [{ time: calls, open: 1, high: 1, low: 1, close: 1, volume: 1 }];
        };
        const window = (from: number) => ({ from, to: from + 1, limit: 1 });
        await cache.fetch(fetcher, 'BTCUSDT', '60', window(1));
        await cache.fetch(fetcher, 'BTCUSDT', '60', window(2));
        await cache.fetch(fetcher, 'BTCUSDT', '60', window(3));
        expect(cache.size).toBe(2);
        // The oldest entry was evicted; it must be fetched again.
        await cache.fetch(fetcher, 'BTCUSDT', '60', window(1));
        expect(calls).toBe(4);

        let securityCalls = 0;
        const securityFetcher = async (): Promise<OHLCV[]> => {
            securityCalls += 1;
            return [];
        };
        await secondaryKlines(securityFetcher, 'BTCUSDT', '60', 10, 1, 2);
        await secondaryKlines(securityFetcher, 'BTCUSDT', '60', 10, 1, 2);
        expect(securityCalls).toBe(2);
    });

    it('reuses a lower window across static runs only when the caller supplies a session cache', async () => {
        const cache = new LowerTimeframeFetchCache();
        const prepared = preparePine(strategySource, 'cache-session');
        const sourceBars = bars(2);
        let calls = 0;
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            // Reuse is valid only after full broker coverage validation. Both
            // 1D parents need 24 real hourly children, not an arbitrary row.
            return Array.from({ length: 48 }, (_, index) => ({
                time: sourceBars[0]!.time + index * 60 * 60_000,
                open: 100, high: 101, low: 99, close: 100, volume: 1,
            }));
        };
        const run = () => runPineStatic({
            ind: indicatorFor({}, strategySource, {}),
            bars: sourceBars,
            market: { symbol: 'BTCUSDT', timeframe: '1D' },
            visibleRange: undefined,
            prepared,
            instanceId: 'cache-session',
            inputs: {},
            props: {},
            fetchSeries: fetcher,
            lowerTimeframeFetchCache: cache,
        });
        const first = await run();
        expect((first.ctx as { executionPrecision?: unknown }).executionPrecision).toMatchObject({ applied: true, coverage: 1 });
        await run();
        expect(calls).toBe(1);
        cache.clear();
        await run();
        expect(calls).toBe(2);
    });

    it('creates one lower-feed cache per PineEngine execution session', async () => {
        const engine = new PineEngine();
        const prepared = await engine.prepare(strategySource, 'engine-cache-session');
        const sourceBars = bars(2);
        let calls = 0;
        const fetcher = async (): Promise<OHLCV[]> => {
            calls += 1;
            return [{ time: sourceBars[0]!.time, open: 100, high: 101, low: 99, close: 100, volume: 1 }];
        };
        let done = 0;
        const errors: Error[] = [];
        const session = engine.execute({
            prepared,
            market: { symbol: 'BTCUSDT', timeframe: '1D' },
            bars: sourceBars,
            getBars: () => sourceBars,
            inputs: {},
            props: {},
            fetchSeries: fetcher,
            mode: 'static',
        }, { onModel: () => undefined, onDone: () => { done += 1; }, onError: (error) => { errors.push(error); } });
        await waitFor(() => done === 1 || errors.length > 0);
        const executionError = errors[0];
        if (executionError) throw executionError;
        session.notifyBars();
        await waitFor(() => done === 2);
        // notifyBars invalidates the lower-feed window because a forming child
        // candle can change without changing the parent request range.
        expect(calls).toBe(2);
        session.stop();
    });

    it('maps daily charts to 60-minute children', () => {
        expect(barMagnifierTimeframe('1D')).toBe('60');
        expect(barMagnifierTimeframe('D')).toBe('60');
    });

    it('keeps provider-backed TV mappings and disables unavailable second feeds', () => {
        expect(barMagnifierTimeframe('10')).toBe('1');
        expect(barMagnifierTimeframe('10m')).toBe('1');
        expect(barMagnifierTimeframe('15m')).toBe('2');
        expect(barMagnifierTimeframe('30m')).toBe('5');
        expect(barMagnifierTimeframe('60')).toBe('10');
        expect(barMagnifierTimeframe('1h')).toBe('10');
        expect(barMagnifierTimeframe('240')).toBe('30');
        expect(barMagnifierTimeframe('4h')).toBe('30');
        expect(barMagnifierTimeframe('1440')).toBe('60');
        expect(barMagnifierTimeframe('4320')).toBe('240');
        expect(barMagnifierTimeframe('10080')).toBe('D');
        expect(barMagnifierTimeframe('3D')).toBe('240');
        expect(barMagnifierTimeframe('1W')).toBe('D');
        expect(barMagnifierTimeframe('1m')).toBeUndefined();
        expect(barMagnifierTimeframe('5m')).toBeUndefined();
        expect(barMagnifierTimeframe('3m')).toBeUndefined();
        expect(barMagnifierTimeframe('45m')).toBeUndefined();
        expect(barMagnifierTimeframe('2h')).toBeUndefined();
        expect(barMagnifierTimeframe('1M')).toBeUndefined();
    });

    it('reports an explicit mapping fallback for unsupported parent periods', async () => {
        const result = await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            bars(2),
            { symbol: 'BTCUSDT', timeframe: '5' },
            undefined,
            undefined,
        );
        expect(result.input).toEqual({ requested: true });
        expect(result.status).toMatchObject({
            requested: true,
            applied: false,
            requestedPrecision: 'lower-timeframe',
            appliedPrecision: 'chart-ohlc',
            parentBars: 2,
            lowerBars: 0,
            coveredParentBars: 0,
            coverage: 0,
            fallbackReason: 'lower-timeframe-undetermined',
        });
    });

    it('distinguishes an explicitly empty supplied child feed from an omitted feed', async () => {
        const result = await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            bars(2),
            { symbol: 'BTCUSDT', timeframe: '1D' },
            undefined,
            undefined,
            { requested: true, lowerTimeframe: '60', bars: [] },
        );
        expect(result.input).toMatchObject({ requested: true, lowerTimeframe: '60', bars: [] });
        expect(result.status).toMatchObject({
            requested: true,
            applied: false,
            lowerTimeframe: '60',
            lowerBars: 0,
            fallbackReason: 'lower-data-empty',
        });
    });

    it('parses explicit upper-case month child aliases as calendar months', async () => {
        const result = await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            bars(1),
            { symbol: 'BTCUSDT', timeframe: '1D' },
            undefined,
            async (_symbol, timeframe) => {
                // The explicit child is intentionally unsupported as a valid
                // lower feed for a daily parent; this assertion only verifies
                // that it remains a known period and reaches the provider
                // boundary rather than being rejected as an unknown duration.
                expect(timeframe).toBe('2M');
                return [];
            },
            { requested: true, lowerTimeframe: '2M' },
        );
        expect(result.status?.fallbackReason).toBe('lower-data-empty');
    });

    it('treats an unsafe lower timeframe as unknown instead of building an unsafe range', async () => {
        let requestedRange: { from?: number; to?: number; limit?: number } | undefined;
        const result = await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            bars(2),
            { symbol: 'BTCUSDT', timeframe: '1D' },
            undefined,
            async (_symbol, timeframe, range) => {
                expect(timeframe).toBe('999999999999999999999999999999999999M');
                requestedRange = range;
                return [];
            },
            { requested: true, lowerTimeframe: '999999999999999999999999999999999999M' },
        );
        expect(requestedRange?.from).toBe(bars(2)[0]!.time);
        expect(Number.isSafeInteger(requestedRange?.limit)).toBe(true);
        expect(result.status?.fallbackReason).toBe('lower-data-empty');
    });

    it('fetches through the final parent close and scales 1D limits by the child ratio', async () => {
        const sourceBars = bars(6);
        const prepared = preparePine(strategySource, 'magnifier-runtime');
        const ind = indicatorFor({}, strategySource, {});
        let request: { from?: number; to?: number; limit?: number } | undefined;
        await resolveBarMagnifier(
            ind,
            sourceBars,
            { symbol: 'BTCUSDT', timeframe: '1D' },
            undefined,
            async (_symbol, timeframe, range) => {
                expect(timeframe).toBe('60');
                request = range;
                return [];
            },
        );
        expect(request?.from).toBe(sourceBars[0]!.time);
        expect(request?.to).toBe(sourceBars[sourceBars.length - 1]!.time + DAY);
        // Six daily parents need 6 × 24 hourly children. Keep the provider's
        // historical minimum headroom while proving the ratio is not hard-coded
        // to the old 12× estimate.
        expect(request?.limit).toBeGreaterThanOrEqual(sourceBars.length * 24);
        // Keep the prepared value live in this focused contract test so a
        // refactor cannot accidentally remove the declaration scan.
        expect(prepared.meta.title).toBe('Magnifier');
    });

    it('aligns a non-grid parent start backward before requesting lower candles', async () => {
        const start = Date.UTC(2024, 0, 1) + 15 * 60_000;
        const parentBars: OHLCV[] = [{
            time: start,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }];
        let requestedFrom: number | undefined;
        await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            parentBars,
            { symbol: 'BTCUSDT', timeframe: '15' },
            undefined,
            async (_symbol, timeframe, range) => {
                expect(timeframe).toBe('2');
                requestedFrom = range.from;
                return [];
            },
        );
        // The 2m provider grid has a 00:14 bucket crossing the 00:15 parent
        // open; requesting from 00:15 would make BaseProvider aggregate a
        // shifted 2m sequence and force an unnecessary precision fallback.
        expect(requestedFrom).toBe(start - 60_000);
    });

    it('labels live requests as unsupported instead of lower-data-empty', async () => {
        const sourceBars = bars(2);
        const result = await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            sourceBars,
            { symbol: 'BTCUSDT', timeframe: '60' },
            undefined,
            undefined,
            { requested: true, lowerTimeframe: '10', live: true },
        );
        expect(result.status).toMatchObject({
            requested: true,
            applied: false,
            fallbackReason: 'live-mode-not-supported',
        });
    });

    it('accepts an inclusive provider tail at the final parent close', async () => {
        const parentBars = bars(1);
        const childBars: OHLCV[] = Array.from({ length: 25 }, (_, index) => ({
            time: parentBars[0]!.time + index * 60 * 60_000,
            open: 100,
            high: 101,
            low: 99,
            close: 100,
            volume: 1,
        }));
        const result = await runPineStatic({
            ind: indicatorFor({}, strategySource, {}),
            bars: parentBars,
            market: { symbol: 'BTCUSDT', timeframe: '1D' },
            visibleRange: undefined,
            prepared: preparePine(strategySource, 'inclusive-tail'),
            instanceId: 'inclusive-tail',
            inputs: {},
            props: {},
            fetchSeries: async () => childBars,
        });
        expect((result.ctx as { executionPrecision?: unknown }).executionPrecision).toMatchObject({
            requested: true,
            applied: true,
            coveredParentBars: 1,
        });
    });

    it('expands an inclusive final parent closeTime when requesting children', async () => {
        const end = parentBarsEnd(parentBarsOne());
        const parentBars = [{ ...bars(1)[0]!, closeTime: end - 1 } as OHLCV & { closeTime: number }];
        let requestedTo: number | undefined;
        await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            parentBars,
            { symbol: 'BTCUSDT', timeframe: '1D' },
            undefined,
            async (_symbol, _timeframe, range) => {
                requestedTo = range.to;
                return [];
            },
        );
        expect(requestedTo).toBe(end);
    });

    it('uses one-minute ratio for the provider bare m child alias', async () => {
        const sourceBars = bars(2);
        let request: { limit?: number } | undefined;
        await resolveBarMagnifier(
            indicatorFor({}, strategySource, {}),
            sourceBars,
            { symbol: 'BTCUSDT', timeframe: '60' },
            undefined,
            async (_symbol, timeframe, range) => {
                expect(timeframe).toBe('m');
                request = range;
                return [];
            },
            { requested: true, lowerTimeframe: 'm' },
        );
        expect(request?.limit).toBeGreaterThanOrEqual(sourceBars.length * 60);
    });

    it('turns a malformed lower-feed response into a local fallback', async () => {
        const result = await runPineStatic({
            ind: indicatorFor({}, strategySource, {}),
            bars: bars(2),
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            visibleRange: undefined,
            prepared: preparePine(strategySource, 'malformed-lower-feed'),
            instanceId: 'malformed-lower-feed',
            inputs: {},
            props: {},
            // A provider implementation can violate the structural type at a
            // runtime boundary. It must not make childInputBars().map throw.
            fetchSeries: async () => ({ malformed: true } as never),
        });
        expect((result.ctx as { executionPrecision?: unknown }).executionPrecision).toMatchObject({
            requested: true,
            applied: false,
            fallbackReason: 'lower-data-unavailable',
        });
    });

    it('does not throw when a lower-feed array contains malformed rows', async () => {
        const result = await runPineStatic({
            ind: indicatorFor({}, strategySource, {}),
            bars: bars(2),
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            visibleRange: undefined,
            prepared: preparePine(strategySource, 'malformed-lower-row'),
            instanceId: 'malformed-lower-row',
            inputs: {},
            props: {},
            fetchSeries: async () => [null, {
                time: bars(2)[0]!.time,
                open: 100,
                high: 101,
                low: 99,
                close: 100,
                volume: 1,
            }] as never,
        });
        expect((result.ctx as { executionPrecision?: unknown }).executionPrecision).toMatchObject({
            requested: true,
            applied: false,
            fallbackReason: 'invalid-lower-bars',
        });
    });

    it('does not throw when supplied child bars contain malformed rows', async () => {
        const result = await runPineStatic({
            ind: indicatorFor({}, strategySource, {}),
            bars: bars(2),
            market: { symbol: 'BTCUSDT', timeframe: '60' },
            visibleRange: undefined,
            prepared: preparePine(strategySource, 'malformed-supplied-lower-row'),
            instanceId: 'malformed-supplied-lower-row',
            inputs: {},
            props: {},
            fetchSeries: undefined,
            barMagnifier: {
                requested: true,
                lowerTimeframe: '10',
                bars: [null, {
                    openTime: bars(2)[0]!.time,
                    open: 100,
                    high: 101,
                    low: 99,
                    close: 100,
                    volume: 1,
                }] as never,
            },
        });
        expect((result.ctx as { executionPrecision?: unknown }).executionPrecision).toMatchObject({
            requested: true,
            applied: false,
            fallbackReason: 'invalid-lower-bars',
        });
    });

    it('isolates throwing getters in provider and supplied child rows', async () => {
        const providerRow = {} as { time: number };
        Object.defineProperty(providerRow, 'time', { get() { throw new Error('provider getter'); } });
        const suppliedRow = {} as { openTime: number };
        Object.defineProperty(suppliedRow, 'openTime', { get() { throw new Error('supplied getter'); } });
        for (const [fetchSeries, barMagnifier] of [
            [async () => [providerRow as never], undefined],
            [undefined, { requested: true, lowerTimeframe: '10', bars: [suppliedRow as never] }],
        ] as const) {
            const result = await runPineStatic({
                ind: indicatorFor({}, strategySource, {}), bars: bars(2),
                market: { symbol: 'BTCUSDT', timeframe: '60' }, visibleRange: undefined,
                prepared: preparePine(strategySource, 'throwing-child-row'),
                instanceId: `throwing-child-row-${String(Boolean(fetchSeries))}`,
                inputs: {}, props: {}, fetchSeries, barMagnifier,
            });
            expect((result.ctx as { executionPrecision?: unknown }).executionPrecision).toMatchObject({
                requested: true, applied: false, fallbackReason: 'invalid-lower-bars',
            });
        }
    });

    it('turns malformed secondary request.security data into an empty series', async () => {
        await expect(secondaryKlines(
            async () => ({ malformed: true } as never),
            'ETHUSDT',
            '60',
            10,
            1,
            2,
        )).resolves.toEqual([]);
        await expect(secondaryKlines(
            async () => [
                { time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 },
                { time: Number.NaN, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            ],
            'ETHUSDT',
            '60',
            10,
            1,
            2,
        )).resolves.toEqual([{
            openTime: 1,
            open: 1,
            high: 2,
            low: 0,
            close: 1,
            volume: 1,
        }]);
        const hostile = {} as { time: number };
        Object.defineProperty(hostile, 'time', { get() { throw new Error('bad row getter'); } });
        await expect(secondaryKlines(
            async () => [hostile as never, { time: 2, open: 2, high: 3, low: 1, close: 2, volume: 'bad' as never }],
            'ETHUSDT',
            '60',
        )).resolves.toEqual([{
            openTime: 2,
            open: 2,
            high: 3,
            low: 1,
            close: 2,
            volume: 0,
        }]);
        await expect(secondaryKlines(
            async () => [
                { time: 3, open: 3, high: 4, low: 2, close: 3, volume: 1 },
                { time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 },
                { time: 3, open: 30, high: 31, low: 29, close: 30, volume: 2 },
            ],
            'ETHUSDT',
            '60',
        )).resolves.toEqual([
            { openTime: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 },
            { openTime: 3, open: 30, high: 31, low: 29, close: 30, volume: 2 },
        ]);

    });

    it('re-applies secondary range and newest-tail limits when a provider over-fetches', async () => {
        await expect(secondaryKlines(
            async () => [
                { time: 0, open: 0, high: 1, low: 0, close: 1, volume: 1 },
                { time: 1, open: 1, high: 2, low: 1, close: 2, volume: 1 },
                { time: 2, open: 2, high: 3, low: 2, close: 3, volume: 1 },
                { time: 3, open: 3, high: 4, low: 3, close: 4, volume: 1 },
            ],
            'ETHUSDT',
            '60',
            1,
            1,
            2,
        )).resolves.toEqual([{
            openTime: 2,
            open: 2,
            high: 3,
            low: 2,
            close: 3,
            volume: 1,
        }]);
    });

    it('rejects invalid secondary ranges before calling a permissive provider', async () => {
        let calls = 0;
        const fetcher = async () => {
            calls += 1;
            return [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 1 }];
        };
        await expect(secondaryKlines(fetcher, 'ETHUSDT', '60', 0)).resolves.toEqual([]);
        await expect(secondaryKlines(fetcher, 'ETHUSDT', '60', -1)).resolves.toEqual([]);
        await expect(secondaryKlines(fetcher, 'ETHUSDT', '60', 1, 2, 1)).resolves.toEqual([]);
        await expect(secondaryKlines(fetcher, 'ETHUSDT', '60', 1, Number.NaN, 2)).resolves.toEqual([]);
        expect(calls).toBe(0);
    });
});

function parentBarsOne(): OHLCV[] {
    return bars(1);
}

function parentBarsEnd(parentBars: OHLCV[]): number {
    return parentBars[0]!.time + DAY;
}
