import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { Indicator } from '../../src/Indicator';

const bars = Array.from({ length: 3 }, (_, i) => ({
    openTime: 1_704_067_200_000 + i * 900_000,
    closeTime: 1_704_067_200_000 + (i + 1) * 900_000 - 1,
    open: 100, high: 101, low: 99, close: 100, volume: 1,
}));
const source = `//@version=6
indicator("Timeframe inputs")
tf = input.timeframe("15", "Timeframe")
other = input.timeframe("D", "Other timeframe")
plot(tf == "60" ? 60 : tf == "" ? 0 : 15, "chosen")
plot(other == "W" ? 7 : 1, "other")`;

async function run(inputs?: Record<string, unknown>) {
    const ctx = await new PineTS(bars, 'BTCUSDT', '15').run(new Indicator(source, inputs));
    return Object.fromEntries(['chosen', 'other'].map((key) => [key, ctx.plots[key].data.map((point) => point.value)]));
}

describe('input.timeframe runtime override contract', () => {
    it('uses each declared default when no override exists', async () => {
        expect(await run()).toEqual({ chosen: [15, 15, 15], other: [1, 1, 1] });
    });
    it('applies independent varId overrides on every bar', async () => {
        expect(await run({ tf: '60', other: 'W' })).toEqual({ chosen: [60, 60, 60], other: [7, 7, 7] });
    });
    it('retains title-keyed compatibility and an empty Chart timeframe override', async () => {
        expect(await run({ Timeframe: '' })).toEqual({ chosen: [0, 0, 0], other: [1, 1, 1] });
    });
});
