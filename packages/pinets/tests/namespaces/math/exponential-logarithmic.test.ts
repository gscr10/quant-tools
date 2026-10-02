import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

async function runMathFunctionWithArgs(mathFunction: string, ...args) {
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'math', mathFunction, ...args);

    return result;
}

describe('Math - Exponential & Logarithmic', () => {
    it.todo('math.exp - Exponential function (e^x)');

    it.todo('math.log - Natural logarithm (base e)');

    it.todo('math.log10 - Base-10 logarithm');

    it.todo('math.pow - Power function (base^exponent)');

    it.todo('math.sqrt - Square root');
});
