export const WORKSPACE_DEFAULTS = {
  layout: '1',
  symbol: 'BTCUSDT',
  timeframe: '15',
  // Keep enough history for indicator warm-up and a useful backtest window.
  // Binance/Hyperliquid integrations paginate or window this request as needed.
  bars: 2000,
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
