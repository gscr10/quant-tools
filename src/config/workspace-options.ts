export const WORKSPACE_HISTORY_BARS = 2000;

export const WORKSPACE_DEFAULTS = {
  layout: '1',
  // The default market is pinned to Binance so a cold symbol index cannot
  // delay the first chart. Persisted user selections remain unchanged.
  symbol: 'binance:BTCUSDT',
  timeframe: '15',
  // Keep enough history for indicator warm-up and a useful backtest window.
  // Binance/Hyperliquid integrations paginate or window this request as needed.
  bars: WORKSPACE_HISTORY_BARS,
  live: true,
  theme: 'dark',
  timezone: 'Etc/UTC',
  defaultLanguage: 'pine',
} as const;

export const WORKSPACE_TOPBAR = {
  left: [
    'symbol',
    'timeframes',
    'style',
    'layout',
    'indicators',
    'quant-favorites',
    'quant-templates',
    'undo-redo',
  ],
  right: ['quant-build-version', 'panels', 'screenshot'],
};
