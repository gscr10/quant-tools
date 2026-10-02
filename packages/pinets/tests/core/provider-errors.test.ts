import { describe, expect, it } from 'vitest';
import { PineTS } from '../../src/PineTS.class';

describe('PineTS provider readiness errors', () => {
    it('rejects ready/run with the original provider error instead of hanging', async () => {
        const providerError = Object.assign(
            new Error('binance request timed out'),
            {
                name: 'ProviderTimeoutError',
                provider: 'binance',
                timeoutMs: 25,
                retryable: true,
            },
        );
        const provider = {
            getMarketData: async () => { throw providerError; },
            getSymbolInfo: async () => ({}),
        };
        const pine = new PineTS(provider as never, 'BTCUSDT', '60');

        await expect(pine.ready()).rejects.toBe(providerError);
        await expect(pine.run('//@version=6\nindicator("timeout")\nplot(close)')).rejects.toBe(providerError);
    });
});
