import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';
import { PineRuntimeError } from '../../src/errors/PineRuntimeError';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2024, 0, 1);

const bars = [
    { openTime: T0, closeTime: T0 + HOUR, open: 1, high: 2, low: 0, close: 1, volume: 1 },
    { openTime: T0 + HOUR, closeTime: T0 + 2 * HOUR, open: 1, high: 2, low: 0, close: 1, volume: 1 },
];

describe('bare error() built-in', () => {
    it('halts execution with a typed Pine runtime error', async () => {
        const engine = new PineTS(bars as any, 'BTCUSDT', '60');
        let caught: unknown;
        try {
            await engine.run(`
//@version=6
indicator('bare error')
if bar_index == 0
    error('fatal guard')
plot(close)
`);
        } catch (error) {
            caught = error;
        }
        expect(caught).toBeInstanceOf(PineRuntimeError);
        expect((caught as PineRuntimeError).message).toBe('fatal guard');
        expect((caught as PineRuntimeError).method).toBe('error');
    });

    it('does not execute when the guard is false', async () => {
        const engine = new PineTS(bars as any, 'BTCUSDT', '60');
        const result: any = await engine.run(`
//@version=6
indicator('bare error guard')
if bar_index > 10
    error('unreachable')
plot(close, 'close')
`);
        expect(result.plots.close.data).toHaveLength(2);
    });
});

