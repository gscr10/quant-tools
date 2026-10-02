import test from 'node:test';
import assert from 'node:assert/strict';
import { localAssetTicker, localAssetGeometry, resolveLocalSymbolIcon } from '../src/shared/asset-logos.ts';

test('local asset matching accepts supported bases, not similarly named tokens', () => {
  for (const ticker of ['BTC', 'BTCUSDT', 'BINANCE:BTCUSDT.P', 'btc/usd', 'BTC-USD', 'BTC_USDC']) {
    assert.equal(localAssetTicker(ticker), 'BTC', ticker);
  }
  for (const ticker of ['ETH', 'ETHUSDT', 'ETHBTC', 'HYPERLIQUID:ETH', 'ETH/USDC']) {
    assert.equal(localAssetTicker(ticker), 'ETH', ticker);
  }
  for (const ticker of ['ETHFIUSDT', 'BTCDOMUSDT', 'BTCSTUSDT', 'WBTC', 'SOLUSDT', '<svg>', '']) {
    assert.equal(localAssetTicker(ticker), undefined, ticker);
    assert.equal(resolveLocalSymbolIcon({ticker}), undefined, ticker);
  }
});

test('provider image and inline Viewer geometry share the original local vectors', () => {
  for (const asset of ['BTC', 'ETH']) {
    const url = resolveLocalSymbolIcon({ticker:asset});
    const source = decodeURIComponent(url.slice(url.indexOf(',')+1));
    assert.match(url, /^data:image\/svg\+xml;charset=utf-8,/);
    assert.match(source, /^<svg /);
    assert.doesNotMatch(source, /<(?:image|script)|(?:href|onload)=/);
    for (const [d, fill] of localAssetGeometry(asset).paths) {
      assert.ok(source.includes(`d="${d}" fill="${fill}"`));
    }
    assert.equal(resolveLocalSymbolIcon({ticker:asset+'USDT'}), url);
  }
});
