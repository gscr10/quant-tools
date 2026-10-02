import { describe, expect, it } from 'vitest';
import { arrayPrecision, getKlines, runNSFunctionWithArgs } from '../../utils';

async function runMathFunctionWithArgs(mathFunction: string, ...args) {
    const klines = await getKlines('BTCUSDT', '1h', 500, 0, 1736071200000 - 1);

    const result = await runNSFunctionWithArgs(klines, 'math', mathFunction, ...args);

    return result;
}

describe('Math - Trigonometric', () => {
    it.todo('math.acos - Arc cosine (inverse cosine)');
    
    it.todo('math.asin - Arc sine (inverse sine)');
    
    it.todo('math.atan - Arc tangent (inverse tangent)');
    
    it.todo('math.cos - Cosine');
    
    it.todo('math.sin - Sine');
    
    it.todo('math.tan - Tangent');
});

