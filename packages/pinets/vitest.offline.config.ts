import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Deterministic package suite.
 *
 * The excluded files either call a live provider directly or contain a mix of
 * deterministic and live cases. They are intentionally excluded as whole
 * files until their live cases are split out and supplied with checked-in
 * fixtures. This keeps an offline pass honest instead of silently replacing
 * an exchange response with an empty array.
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
        include: ['tests/**/*.test.ts'],
        exclude: ['node_modules', ...networkDependentFiles],
    },
});
