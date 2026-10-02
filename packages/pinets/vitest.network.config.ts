import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Explicit opt-in suite for tests that exercise live Binance data or contain
 * live-provider cases. It is intentionally separate from `test:offline` so a
 * blocked exchange cannot be mistaken for a passing deterministic suite.
 */
const networkDependentFiles = [
    'tests/core/livestream.test.ts',
    'tests/core/pagination.test.ts',
    'tests/core/pinescript.test.ts',
    'tests/core/stream.test.ts',
    'tests/core/udt-method-mutation.test.ts',
    'tests/indicators/Institutional_Bias.test.ts',
    'tests/indicators/macd-pinescript.test.ts',
    'tests/indicators/pine_supertrend.test.ts',
    'tests/marketData/symbolInfo.test.ts',
    'tests/namespaces/array/access.test.ts',
    'tests/namespaces/array/calculations.test.ts',
    'tests/namespaces/array/creation.test.ts',
    'tests/namespaces/barstate.test.ts',
    'tests/namespaces/math/basic-operations.test.ts',
    'tests/namespaces/math/exponential-logarithmic.test.ts',
    'tests/namespaces/math/statistical.test.ts',
    'tests/namespaces/math/trigonometric.test.ts',
    'tests/namespaces/math/utilities.test.ts',
    'tests/namespaces/request-cross-tf.test.ts',
    'tests/namespaces/request-streaming.test.ts',
    'tests/namespaces/request.test.ts',
    'tests/namespaces/ta/moving-averages.test.ts',
    'tests/namespaces/ta/oscillators-momentum.test.ts',
    'tests/namespaces/ta/statistical-functions.test.ts',
    'tests/namespaces/ta/support-resistance.test.ts',
    'tests/namespaces/ta/trend-analysis.test.ts',
    'tests/namespaces/ta/volatility-range.test.ts',
    'tests/namespaces/time-function.test.ts',
    'tests/namespaces/timeframe-change.test.ts',
    'tests/transpiler/parser-fixes.test.ts',
];

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        globals: true,
        environment: 'node',
        include: networkDependentFiles,
        exclude: ['node_modules'],
        testTimeout: 30_000,
        hookTimeout: 30_000,
    },
});
