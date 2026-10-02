// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceProvider } from '../../src/marketData/Binance/BinanceProvider.class';

const GLOBAL_FETCH = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = GLOBAL_FETCH;
    vi.restoreAllMocks();
});

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

const btcKline = [
    1_700_000_000_000,
    '100',
    '110',
    '90',
    '105',
    '12',
    1_700_000_059_999,
    '1200',
    3,
    '6',
    '600',
    '0',
];

describe('BinanceProvider bounded endpoint recovery', () => {
    it('aborts a stalled global request and continues through the US mirror', async () => {
        const calls: string[] = [];
        let aborted = false;
        globalThis.fetch = vi.fn((input, init) => {
            const url = String(input);
            calls.push(url);
            if (url.startsWith('https://api.binance.com')) {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        aborted = true;
                        reject(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                });
            }
            return Promise.resolve(jsonResponse([btcKline]));
        }) as typeof fetch;

        const provider = new BinanceProvider({ requestTimeoutMs: 10 });
        const bars = await provider.getMarketData('BTCUSDT', '1', 1);

        expect(aborted).toBe(true);
        expect(bars).toHaveLength(1);
        expect(calls).toEqual([
            'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1',
            'https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1',
        ]);
    });

    it('retries the mirror when a cached endpoint stalls on the data request', async () => {
        const calls: string[] = [];
        globalThis.fetch = vi.fn((input, init) => {
            const url = String(input);
            calls.push(url);
            if (url.startsWith('https://api.binance.com')) {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                });
            }
            return Promise.resolve(jsonResponse([btcKline]));
        }) as typeof fetch;

        const provider = new BinanceProvider({ requestTimeoutMs: 10 });
        const bars = await provider.getMarketData('BTCUSDT', '1', 1);

        expect(bars).toHaveLength(1);
        expect(calls).toEqual([
            'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1',
            'https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1',
        ]);
    });

    it('bounds futures exchangeInfo requests without inventing a mirror', async () => {
        const calls: string[] = [];
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        globalThis.fetch = vi.fn((input, init) => {
            const url = String(input);
            calls.push(url);
            return new Promise<Response>((_resolve, reject) => {
                init?.signal?.addEventListener('abort', () => {
                    reject(new DOMException('aborted', 'AbortError'));
                }, { once: true });
            });
        }) as typeof fetch;

        const provider = new BinanceProvider({ requestTimeoutMs: 10 });
        await expect(provider.getSymbolInfo('BTCUSDT.P')).resolves.toBeNull();

        expect(calls).toEqual(['https://fapi.binance.com/fapi/v1/exchangeInfo']);
    });

    it('does not cache an empty timeout result, so a later request can recover', async () => {
        const calls: string[] = [];
        let phase = 0;
        globalThis.fetch = vi.fn((input, init) => {
            const url = String(input);
            calls.push(url);
            if (phase === 0) {
                return new Promise<Response>((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => {
                        reject(new DOMException('aborted', 'AbortError'));
                    }, { once: true });
                });
            }
            return Promise.resolve(jsonResponse([btcKline]));
        }) as typeof fetch;

        const provider = new BinanceProvider({ requestTimeoutMs: 5 });
        await expect(provider.getMarketData('BTCUSDT', '1', 1)).resolves.toEqual([]);
        phase = 1;
        await expect(provider.getMarketData('BTCUSDT', '1', 1)).resolves.toHaveLength(1);

        // The second call must reach the network; an empty first response was
        // a timeout fallback, not a cacheable market-data result.
        expect(calls.length).toBe(3);
    });
});
