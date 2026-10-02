import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

async function runMathFunctionWithArgs(mathFunction: string, ...args) {
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'math', mathFunction, ...args);

    return result;
}

describe('Math - Utilities', () => {
    it.todo('math.random - Random number generator');
    
    it.todo('math.todegrees - Convert radians to degrees');
    
    it.todo('math.toradians - Convert degrees to radians');
});

