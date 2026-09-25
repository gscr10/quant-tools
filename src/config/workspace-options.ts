export const WORKSPACE_DEFAULTS = {
  layout: '1',
  symbol: 'BTCUSDT',
  timeframe: '15',
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
  right: ['panels', 'screenshot'],
};
