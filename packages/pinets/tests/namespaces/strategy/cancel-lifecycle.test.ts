import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2024, 0, 1);

function bar(index: number, open: number, high: number, low: number, close: number) {
    return {
        openTime: T0 + index * HOUR,
        closeTime: T0 + (index + 1) * HOUR,
        open,
        high,
        low,
        close,
        volume: 1,
    };
}

async function run(bars: ReturnType<typeof bar>[], body: string, processOrdersOnClose = false) {
    const closeOption = processOrdersOnClose ? ', process_orders_on_close=true' : '';
    const source = `
//@version=6
strategy('cancel lifecycle', initial_capital=10000, default_qty_type=strategy.fixed, default_qty_value=1${closeOption})
${body}
`;
    return new PineTS(bars as any, 'BTCUSDT', '60').run(source) as Promise<any>;
}

describe('strategy.cancel lifecycle', () => {
    it('cancels an immediately-marked order before the current-bar close pass', async () => {
        const bars = [
            bar(0, 100, 105, 80, 95),
            bar(1, 96, 100, 85, 90),
        ];
        const order = `
if bar_index == 0
    strategy.entry('drop', strategy.long, limit=90)
`;

        // Control: the same order is eligible on its creating bar and proves
        // that process_orders_on_close really executes the close broker pass.
        const control = await run(bars, order, true);
        expect(control.strategy.opentrades).toHaveLength(1);
        expect(control.strategy.opentrades[0]).toMatchObject({
            entry_id: 'drop',
            entry_price: 90,
            entry_bar_index: 0,
        });

        const cancelled = await run(
            bars,
            `${order}
if bar_index == 0
    strategy.cancel('drop', immediately=true)
`,
            true,
        );
        expect(cancelled.strategy.opentrades).toHaveLength(0);
        expect(cancelled.strategy.closedtrades).toHaveLength(0);
        expect(cancelled.strategy.pending_orders).toHaveLength(0);
    });

    it.each([
        ['omitted', "strategy.cancel('drop')"],
        ['false', "strategy.cancel('drop', immediately=false)"],
    ])('preserves the default synchronous cancellation behavior when immediately is %s', async (_label, cancelCall) => {
        const bars = [
            bar(0, 100, 105, 80, 95),
            bar(1, 96, 100, 85, 90),
        ];
        const result = await run(
            bars,
            `
if bar_index == 0
    strategy.entry('drop', strategy.long, limit=90)
    ${cancelCall}
`,
            true,
        );

        expect(result.strategy.opentrades).toHaveLength(0);
        expect(result.strategy.closedtrades).toHaveLength(0);
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('keeps an immediately-marked cancellation across later bars', async () => {
        const bars = [
            bar(0, 100, 105, 95, 100),
            bar(1, 100, 104, 94, 99),
            bar(2, 99, 101, 80, 85),
            bar(3, 86, 90, 75, 80),
        ];
        const order = `
if bar_index == 0
    strategy.entry('delayed', strategy.long, limit=90)
`;

        // Control: the pending limit survives bar 1 and fills when bar 2
        // reaches it. The cancellation below therefore has an observable job.
        const control = await run(bars, order, true);
        expect(control.strategy.opentrades).toHaveLength(1);
        expect(control.strategy.opentrades[0]).toMatchObject({
            entry_id: 'delayed',
            entry_price: 90,
            entry_bar_index: 2,
        });

        const cancelled = await run(
            bars,
            `${order}
if bar_index == 1
    strategy.cancel('delayed', immediately=true)
`,
            true,
        );
        expect(cancelled.strategy.opentrades).toHaveLength(0);
        expect(cancelled.strategy.closedtrades).toHaveLength(0);
        expect(cancelled.strategy.pending_orders).toHaveLength(0);
        expect(cancelled.strategy._order_events).toEqual([
            expect.objectContaining({ kind: 'created', sourceOrderId: 'delayed', barIndex: 0, time: T0 }),
            expect.objectContaining({ kind: 'cancelled', sourceOrderId: 'delayed', barIndex: 1, time: T0 + HOUR, reason: 'strategy.cancel' }),
        ]);
    });

    it('cancels only matching pending IDs during the close pass', async () => {
        const bars = [
            bar(0, 100, 105, 80, 95),
            bar(1, 96, 100, 85, 90),
        ];
        const result = await run(
            bars,
            `
if bar_index == 0
    strategy.order('drop', strategy.long, qty=1, limit=90)
    strategy.order('keep', strategy.long, qty=1, limit=91)
    strategy.cancel('drop', immediately=true)
`,
            true,
        );

        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_id: 'keep',
            entry_price: 91,
            entry_bar_index: 0,
        });
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('does not alter an order that already filled on an earlier close pass', async () => {
        const bars = [
            bar(0, 100, 105, 98, 102),
            bar(1, 103, 110, 101, 108),
        ];
        const result = await run(
            bars,
            `
if bar_index == 0
    strategy.entry('filled', strategy.long)
if bar_index == 1
    strategy.cancel('filled', immediately=true)
`,
            true,
        );

        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy.opentrades[0]).toMatchObject({
            entry_id: 'filled',
            entry_price: 102,
            entry_bar_index: 0,
        });
        expect(result.strategy.closedtrades).toHaveLength(0);
        expect(result.strategy.pending_orders).toHaveLength(0);
    });

    it('cancels pending conditional exits as well as entry orders', async () => {
        const bars = [
            bar(0, 100, 101, 99, 100),
            bar(1, 100, 112, 99, 110),
            bar(2, 110, 115, 108, 112),
        ];
        const result = await run(
            bars,
            `
if bar_index == 0
    strategy.entry('L', strategy.long, qty=1)
if strategy.position_size > 0
    strategy.exit('tp', 'L', limit=110)
    strategy.cancel_all()
`,
            true,
        );

        // The entry is filled on bar 0's close. On bar 1 the conditional exit
        // is queued and immediately cancelled before the same close pass can
        // consume its limit. It must not fire on bar 2 either.
        expect(result.strategy.closedtrades).toHaveLength(0);
        expect(result.strategy.opentrades).toHaveLength(1);
        expect(result.strategy._order_events).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceOrderId: 'tp', kind: 'created' }),
            expect.objectContaining({ sourceOrderId: 'tp', kind: 'cancelled', reason: 'strategy.cancel_all' }),
        ]));
    });
});
