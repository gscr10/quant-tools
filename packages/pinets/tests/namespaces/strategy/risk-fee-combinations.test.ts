import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';
import { Series } from '../../../src/Series';
import { initializeStrategy, prepareRiskDay } from '../../../src/namespaces/strategy/utils';

const HOUR = 3_600_000;
const CHILD = 600_000;
const T0 = Date.UTC(2024, 0, 1);
const flat = (openTime: number, duration: number, price: number) => ({
    openTime, closeTime: openTime + duration, open: price, high: price, low: price, close: price, volume: 1,
});

async function run(prices: number[], source: string, magnified: boolean) {
    const parents = prices.map((price, i) => flat(T0 + i * HOUR, HOUR, price));
    const children = prices.flatMap((price, i) => Array.from({ length: 6 }, (_, j) => flat(T0 + i * HOUR + j * CHILD, CHILD, price)));
    return new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined,
        magnified ? { barMagnifier: { requested: true, lowerTimeframe: '10', bars: children } } : undefined).run(source);
}

describe.each([false, true])('independent combined accounting (magnified=%s)', (magnified) => {
    it.each(['cash', 'percent_of_equity'])('measures intraday %s loss from the day maximum, including earlier gains', async (type) => {
        const result = await run([100, 100, 300, 180, 180], `//@version=6
strategy('day peak loss', initial_capital=1000, pyramiding=5)
strategy.risk.max_intraday_loss(${type === 'cash' ? 100 : 10}, strategy.${type})
if bar_index == 0
    strategy.entry('A', strategy.long, qty=1)
if bar_index == 3
    strategy.entry('B', strategy.long, qty=1)
`, magnified);
        // 1000 -> 1200 -> 1080 is a 120 / 10% intraday drawdown. Measuring
        // from day-open 1000 instead would incorrectly admit B at +80 net.
        expect(result.strategy._order_events!.filter(event => event.kind === 'rejected').map(event => event.sourceOrderId)).toContain('B');
        expect(result.strategy._risk_intraday_halted).toBe(true);
    });

    it.each(['percent', 'cash_per_contract', 'cash_per_order'])('conserves %s fees through pyramid, partial close and reversal', async (feeType) => {
        const result = await run([100, 100, 110, 120, 130], `//@version=6
strategy('fee combination', initial_capital=10000, pyramiding=5,
    commission_type=strategy.commission.${feeType}, commission_value=1)
if bar_index == 0
    strategy.entry('A', strategy.long, qty=2)
if bar_index == 1
    strategy.entry('B', strategy.long, qty=1)
if bar_index == 2
    strategy.close('A', qty=1)
if bar_index == 3
    strategy.entry('S', strategy.short, qty=2)
`, magnified);
        // Fills: buy 2@100, buy 1@110, sell 1@120, reversal sell 4@130.
        // Gross realized = 20 + 30 + 20 = 70. Fee notionals = 200+110+120+520.
        const totalFee = feeType === 'percent' ? 9.5 : feeType === 'cash_per_contract' ? 8 : 4;
        const closedFee = result.strategy.closedtrades.reduce((sum, trade) => sum + (trade.commission ?? 0), 0);
        const openFee = result.strategy.opentrades.reduce((sum, trade) => sum + (trade.commission ?? 0), 0);
        expect(closedFee + openFee).toBeCloseTo(totalFee, 10);
        expect(result.strategy.netprofit).toBeCloseTo(70 - totalFee, 10);
        expect(result.strategy.position_size).toBe(-2);
        expect(result.strategy.opentrades).toMatchObject([{ entry_id: 'S', entry_price: 130, size: -2 }]);
        expect(result.strategy.closedtrades.map(trade => [trade.entry_id, trade.size, trade.exit_price])).toEqual([
            ['A', 1, 120], ['A', 1, 130], ['B', 1, 130],
        ]);
    });

    it.each([1, -1])('applies %s-side market slippage in minimum ticks on entry and close', async (direction) => {
        const result = await run([100, 100, 110], `//@version=6
strategy('slippage cash', initial_capital=10000, slippage=3,
    commission_type=strategy.commission.cash_per_contract, commission_value=0.5)
if bar_index == 0
    strategy.entry('A', strategy.${direction === 1 ? 'long' : 'short'}, qty=2)
if bar_index == 1
    strategy.close('A')
`, magnified);
        // BTC fallback mintick=0.01: adverse 0.03 on each leg; 2 contracts
        // lose 0.12 to slippage plus 2.00 in entry+exit commissions.
        expect(result.strategy.closedtrades[0].entry_price).toBeCloseTo(100 + direction * 0.03, 10);
        expect(result.strategy.closedtrades[0].exit_price).toBeCloseTo(110 - direction * 0.03, 10);
        expect(result.strategy.netprofit).toBeCloseTo(direction * 20 - 0.12 - 2, 10);
    });
});

describe('exchange risk days across daylight saving transitions', () => {
    it.each([
        ['spring', ['2024-03-10T04:59:00Z', '2024-03-10T05:00:00Z', '2024-03-10T06:59:00Z', '2024-03-10T07:00:00Z', '2024-03-11T04:00:00Z'], ['2024-03-09', '2024-03-10', '2024-03-10', '2024-03-10', '2024-03-11']],
        ['fall', ['2024-11-03T03:59:00Z', '2024-11-03T04:00:00Z', '2024-11-03T05:59:00Z', '2024-11-03T06:00:00Z', '2024-11-04T05:00:00Z'], ['2024-11-02', '2024-11-03', '2024-11-03', '2024-11-03', '2024-11-04']],
    ])('resets only at exchange midnight through %s DST', (_label, times, days) => {
        const context: any = { idx: 0, data: { openTime: new Series([]) }, pine: { syminfo: { timezone: 'America/New_York' } } };
        initializeStrategy(context, { initial_capital: 1000 });
        times.forEach((time, i) => {
            context.idx = i;
            context.data.openTime = new Series([Date.parse(time)]);
            prepareRiskDay(context);
            expect(context.strategy._risk_day_key).toBe(days[i]);
            expect(context.strategy._risk_day_filled_orders).toBe(i === 2 || i === 3 ? 7 : 0);
            context.strategy._risk_day_filled_orders = 7;
        });
    });
});
