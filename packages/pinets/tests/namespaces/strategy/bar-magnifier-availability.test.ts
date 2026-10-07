import { describe, expect, it } from 'vitest';
import { PineTS } from '../../../src/PineTS.class';

const HOUR = 3_600_000, CHILD = HOUR / 6, START = Date.UTC(2024, 0, 1);
const bars = (count: number, duration: number) => Array.from({ length: count }, (_, i) => ({
    openTime: START + i * duration, closeTime: START + (i + 1) * duration,
    open: 100, high: 101, low: 99, close: 100, volume: 1,
}));
const SOURCE = '//@version=6\nstrategy("Availability", use_bar_magnifier=true)\n';
const parents = bars(4, HOUR), children = bars(24, CHILD);

async function precision(rows = children, asOf?: number) {
    const ctx = await new PineTS(parents, 'BTCUSDT', '60', undefined, undefined, undefined, {
        barMagnifier: { requested: true, lowerTimeframe: '10', bars: rows, ...(asOf === undefined ? {} : { asOf }) },
    }).run(SOURCE);
    return ctx.executionPrecision;
}

describe('Historical precision availability metadata', () => {
    it('requires a consumed child to have closed at the captured snapshot time', async () => {
        expect(await precision(children, START + 4 * HOUR - 1)).toMatchObject({
            applied: false, fallbackReason: 'forming-lower-bar', coveredParentBars: 3, coverage: .75,
        });
        expect(await precision(children, START + 4 * HOUR)).toMatchObject({ applied: true, coverage: 1 });
    });

    it('counts available parents after missing old history and after an internal gap', async () => {
        expect(await precision(children.slice(8))).toMatchObject({
            applied: false, fallbackReason: 'partial-lower-coverage', coveredParentBars: 2, coverage: .5,
        });
        expect(await precision(children.filter((_bar, i) => i !== 8))).toMatchObject({
            applied: false, fallbackReason: 'gapped-lower-bars', coveredParentBars: 3, coverage: .75,
        });
    });

    it('ignores inclusive next-parent data without ignoring tentative consumed children', async () => {
        const plusNext = bars(25, CHILD);
        expect(await precision(plusNext, START + 4 * HOUR)).toMatchObject({ applied: true, coverage: 1 });
        expect(await precision(plusNext, START + 4 * HOUR - 1)).toMatchObject({
            applied: false, fallbackReason: 'forming-lower-bar', coveredParentBars: 3,
        });
    });

    it('keeps inclusive close stamps and rejects invalid cutoff metadata', async () => {
        const inclusive = children.map(bar => ({ ...bar, closeTime: bar.closeTime - 1 }));
        expect(await precision(inclusive, START + 4 * HOUR - 1)).toMatchObject({ applied: false, fallbackReason: 'forming-lower-bar' });
        expect(await precision(inclusive, START + 4 * HOUR)).toMatchObject({ applied: true });
        expect(await precision(children, Number.NaN)).toMatchObject({ applied: false, coverage: 0 });
        expect(await precision(children, Infinity)).toMatchObject({ applied: false, coverage: 0 });
    });
});
