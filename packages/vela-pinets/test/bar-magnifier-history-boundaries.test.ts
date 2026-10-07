import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OHLCV } from '@luxalgo/vela/plugin';
import type { BarMagnifierStatus } from 'pinets';
import { indicatorFor, LowerTimeframeFetchCache, preparePine, runPineStatic } from '../src/pinets/runtime';

const HOUR = 3_600_000;
const CHILD = HOUR / 6;
const T0 = Date.UTC(2024, 0, 1);
const SOURCE = `//@version=6
strategy('Precision history boundaries', use_bar_magnifier=true, default_qty_type=strategy.fixed, default_qty_value=1)
if bar_index % 5 == 0
    strategy.entry('L', strategy.long)
if bar_index >= 1
    strategy.exit('X', 'L', stop=95, limit=105)
`;

function feed(count: number): { parents: OHLCV[]; children: OHLCV[] } {
    const parents = Array.from({ length: count }, (_, index) => ({
        time: T0 + index * HOUR, open: 100, high: index % 5 === 2 ? 110 : 101,
        low: index % 5 === 2 ? 80 : 99, close: 100, volume: 6,
    }));
    const children = Array.from({ length: count * 6 }, (_, index) => {
        const parent = Math.floor(index / 6), slot = index % 6;
        const prices = parent % 5 !== 2 ? [100, 101, 99, 100]
            : slot === 0 ? [100, 101, 94, 96]
                : slot === 1 ? [96, 110, 96, 105]
                    : slot === 2 ? [105, 106, 80, 100] : [100, 101, 99, 100];
        return { time: T0 + index * CHILD, open: prices[0]!, high: prices[1]!,
            low: prices[2]!, close: prices[3]!, volume: 1 };
    });
    return { parents, children };
}

interface Result {
    executionPrecision: BarMagnifierStatus;
    strategy: { closedtrades: Array<{ entry_price: number; exit_price: number; profit: number }> };
}

async function run(parents: OHLCV[], fetchSeries: () => Promise<OHLCV[]>, cache?: LowerTimeframeFetchCache): Promise<Result> {
    return (await runPineStatic({ ind: indicatorFor({}, SOURCE, {}), bars: parents,
        market: { symbol: 'hyperliquid:BTC', timeframe: '60' }, visibleRange: undefined,
        prepared: preparePine(SOURCE, 'history-boundary'), instanceId: 'history-boundary',
        inputs: {}, props: {}, fetchSeries, lowerTimeframeFetchCache: cache,
    })).ctx as Result;
}

afterEach(() => vi.restoreAllMocks());

describe('Bar Magnifier historical child availability', () => {
    it('rejects a still-forming child, then refetches the closed window without reusing tentative OHLC', async () => {
        const { parents, children } = feed(4);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(T0 + 4 * HOUR - 1);
        const cache = new LowerTimeframeFetchCache({ ttlMs: Infinity });
        let calls = 0;
        const fetcher = async (): Promise<OHLCV[]> => { calls += 1; return children; };
        const forming = await run(parents, fetcher, cache);
        expect(forming.executionPrecision).toMatchObject({ applied: false,
            fallbackReason: 'forming-lower-bar', parentBars: 4, coveredParentBars: 3, coverage: .75 });
        // The fallback uses the parent high-first path: target 105 before
        // stop 95. The unconfirmed last child cannot certify the whole run.
        expect(forming.strategy.closedtrades).toMatchObject([{ entry_price: 100, exit_price: 105 }]);
        expect(cache.size).toBe(0);

        clock.mockReturnValue(T0 + 4 * HOUR);
        const closed = await run(parents, fetcher, cache);
        expect(closed.executionPrecision).toMatchObject({ applied: true, coverage: 1 });
        expect(closed.strategy.closedtrades).toMatchObject([{ entry_price: 100, exit_price: 95 }]);
        expect(calls).toBe(2);
    });

    it('reports all covered parents when a provider returns only its newest 5,000 children', async () => {
        const { parents, children } = feed(2_000);
        const available = children.slice(-5_000);
        const ctx = await run(parents, async () => available);
        // 5,000 = 833 complete 1h parents plus two children of the preceding
        // parent. Earlier missing rows must not zero the available coverage.
        expect(ctx.executionPrecision).toMatchObject({ applied: false,
            fallbackReason: 'partial-lower-coverage', parentBars: 2_000,
            lowerBars: 5_000, coveredParentBars: 833, coverage: 833 / 2_000 });
        expect(ctx.strategy.closedtrades).toHaveLength(400);
        expect(ctx.strategy.closedtrades.every(trade => trade.entry_price === 100 && trade.exit_price === 105)).toBe(true);
        // This intentionally executes the full 2,000-parent/5,000-child
        // broker path. Keep its explicit budget above Vitest's 5s default so
        // a slow CI worker cannot turn a valid coverage assertion into a
        // timeout-only failure.
    }, 20_000);

    it('does not advance the snapshot cutoff while awaiting a child response', async () => {
        const { parents, children } = feed(4);
        const clock = vi.spyOn(Date, 'now').mockReturnValue(T0 + 4 * HOUR - 1);
        const ctx = await run(parents, async () => {
            clock.mockReturnValue(T0 + 5 * HOUR);
            return children;
        });
        expect(ctx.executionPrecision).toMatchObject({ applied: false,
            fallbackReason: 'forming-lower-bar', coveredParentBars: 3, coverage: .75 });
        expect(ctx.strategy.closedtrades).toMatchObject([{ entry_price: 100, exit_price: 105 }]);
    });

    it('does not consume an inclusive next-parent child whose OHLC is still in the future', async () => {
        const { parents, children } = feed(4);
        vi.spyOn(Date, 'now').mockReturnValue(T0 + 4 * HOUR);
        const extra = { time: T0 + 4 * HOUR, open: 100, high: 1_000_000, low: 0, close: 50, volume: 1 };
        const ctx = await run(parents, async () => [...children, extra]);
        expect(ctx.executionPrecision).toMatchObject({ applied: true, coveredParentBars: 4, coverage: 1 });
        expect(ctx.strategy.closedtrades).toMatchObject([{ entry_price: 100, exit_price: 95 }]);
    });
});
