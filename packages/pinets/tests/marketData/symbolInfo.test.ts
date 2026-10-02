// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { Provider } from '../../src/marketData/Provider.class';

describe('BinanceProvider.getSymbolInfo', () => {
    const binance = Provider.Binance;

    describe('Spot Market Symbols', () => {
        it('should return correct symbol info for BTCUSDT', async () => {
            const symbolInfo = await binance.getSymbolInfo('BTCUSDT');

            expect(symbolInfo).not.toBeNull();
            expect(symbolInfo.ticker).toBe('BTCUSDT');
            expect(symbolInfo.tickerid).toBe('BINANCE:BTCUSDT');
            expect(symbolInfo.prefix).toBe('BINANCE');
            expect(symbolInfo.root).toBe('BTC');
            expect(symbolInfo.basecurrency).toBe('BTC');
            expect(symbolInfo.currency).toBe('USDT');
            expect(symbolInfo.type).toBe('crypto');
            expect(symbolInfo.current_contract).toBe('');
            expect(symbolInfo.session).toBe('24x7');
            expect(symbolInfo.timezone).toBe('Etc/UTC');
            expect(symbolInfo.country).toBe('');
        });

        it('should return correct symbol info for ETHUSDT', async () => {
            const symbolInfo = await binance.getSymbolInfo('ETHUSDT');

            expect(symbolInfo).not.toBeNull();
            expect(symbolInfo.ticker).toBe('ETHUSDT');
            expect(symbolInfo.root).toBe('ETH');
            expect(symbolInfo.basecurrency).toBe('ETH');
            expect(symbolInfo.currency).toBe('USDT');
            expect(symbolInfo.type).toBe('crypto');
        });

        it('should have valid price filters', async () => {
            const symbolInfo = await binance.getSymbolInfo('BTCUSDT');

            expect(symbolInfo).not.toBeNull();
            expect(symbolInfo.mintick).toBeGreaterThan(0);
            expect(symbolInfo.pricescale).toBeGreaterThan(0);
            expect(symbolInfo.minmove).toBe(1);
            expect(symbolInfo.pointvalue).toBeGreaterThan(0);
            expect(symbolInfo.mincontract).toBeGreaterThan(0);
        });

        it('should calculate pricescale correctly from tickSize', async () => {
            const symbolInfo = await binance.getSymbolInfo('BTCUSDT');

            expect(symbolInfo).not.toBeNull();
            // pricescale should be inverse of tickSize
            const expectedPricescale = Math.round(1 / symbolInfo.mintick);
            expect(symbolInfo.pricescale).toBe(expectedPricescale);
        });
    });

    describe('Perpetual Futures Symbols', () => {
        it('should return correct symbol info for BTCUSDT.P', async () => {
            const symbolInfo = await binance.getSymbolInfo('BTCUSDT.P');

            expect(symbolInfo).not.toBeNull();
            expect(symbolInfo.ticker).toBe('BTCUSDT.P'); // Should preserve .P suffix
            expect(symbolInfo.tickerid).toBe('BINANCE:BTCUSDT.P'); // Should include .P
            expect(symbolInfo.prefix).toBe('BINANCE');
            expect(symbolInfo.root).toBe('BTC'); // Root is base asset only
            expect(symbolInfo.basecurrency).toBe('BTC');
            expect(symbolInfo.currency).toBe('USDT');
            expect(symbolInfo.type).toBe('futures'); // Should be futures, not crypto
            expect(symbolInfo.current_contract).toBe('Perpetual');
            expect(symbolInfo.description).toContain('Perpetual');
            expect(symbolInfo.session).toBe('24x7');
        });

        it('should return correct symbol info for ETHUSDT.P', async () => {
            const symbolInfo = await binance.getSymbolInfo('ETHUSDT.P');

            expect(symbolInfo).not.toBeNull();
            expect(symbolInfo.ticker).toBe('ETHUSDT.P');
            expect(symbolInfo.root).toBe('ETH');
            expect(symbolInfo.type).toBe('futures');
            expect(symbolInfo.current_contract).toBe('Perpetual');
        });
    });

    describe('Stock-specific fields (N/A for crypto)', () => {
        it('should set stock-specific fields to default values', async () => {
            const symbolInfo = await binance.getSymbolInfo('BTCUSDT');

            expect(symbolInfo).not.toBeNull();

            // Company Data
            expect(symbolInfo.employees).toBe(0);
            expect(symbolInfo.industry).toBe('');
            expect(symbolInfo.sector).toBe('');
            expect(symbolInfo.shareholders).toBe(0);
            expect(symbolInfo.shares_outstanding_float).toBe(0);
            expect(symbolInfo.shares_outstanding_total).toBe(0);

            // Analyst Ratings
            expect(symbolInfo.recommendations_buy).toBe(0);
            expect(symbolInfo.recommendations_buy_strong).toBe(0);
            expect(symbolInfo.recommendations_date).toBe(0);
            expect(symbolInfo.recommendations_hold).toBe(0);
            expect(symbolInfo.recommendations_sell).toBe(0);
            expect(symbolInfo.recommendations_sell_strong).toBe(0);
            expect(symbolInfo.recommendations_total).toBe(0);

            // Price Targets
            expect(symbolInfo.target_price_average).toBe(0);
            expect(symbolInfo.target_price_date).toBe(0);
            expect(symbolInfo.target_price_estimates).toBe(0);
            expect(symbolInfo.target_price_high).toBe(0);
            expect(symbolInfo.target_price_low).toBe(0);
            expect(symbolInfo.target_price_median).toBe(0);

            // Other N/A fields
            expect(symbolInfo.isin).toBe('');
            expect(symbolInfo.expiration_date).toBe(0);
        });
    });

    describe('Error Handling', () => {
        it('should return null for invalid symbol', async () => {
            const symbolInfo = await binance.getSymbolInfo('INVALIDSYMBOL123456');

            expect(symbolInfo).toBeNull();
        });

        it('should handle network errors gracefully', async () => {
            // Test with malformed symbol that might cause API errors
            const symbolInfo = await binance.getSymbolInfo('');

            expect(symbolInfo).toBeNull();
        });
    });
});
