import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

import { Context, PineTS, Provider } from 'index';

async function runTAFunctionWithArgs(taFunction: string, ...args) {
    // Use the same dataset as the original tests for consistency
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'ta', taFunction, ...args);

    return result;
}

describe('Technical Analysis - Support & Resistance', () => {
    it('PIVOTHIGH - Pivot High Detection', async () => {
        const result = await runTAFunctionWithArgs('pivothigh', 'high', 5, 5);

        const part = result.values.reverse().slice(0, 10);
        console.log(' PIVOTHIGH ', part);
        expect(part).toBeDefined();
        expect(part.length).toBe(10);
        expect(part.every((v) => typeof v === 'number' || isNaN(v))).toBe(true);
        // Check that we have some pivot highs detected
        expect(part.some((v) => !isNaN(v))).toBe(true);
    });

    it('PIVOTLOW - Pivot Low Detection', async () => {
        const result = await runTAFunctionWithArgs('pivotlow', 'low', 5, 5);

        const part = result.values.reverse().slice(0, 10);
        console.log(' PIVOTLOW ', part);
        expect(part).toBeDefined();
        expect(part.length).toBe(10);
        expect(part.every((v) => typeof v === 'number' || isNaN(v))).toBe(true);
        // Check that we have some pivot lows detected
        expect(part.some((v) => !isNaN(v))).toBe(true);
    });
});

