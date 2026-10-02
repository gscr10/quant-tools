/** Existing local BTC/ETH vectors shared by chart providers and the report.
 * No remote fallback: unknown tickers retain the host's initials badge. */
export type LocalAsset = 'BTC' | 'ETH';
type AssetPath = readonly [d: string, fill: string, rule?: string];

const BTC_PATH = 'M39.936 24.704c.515-3.494-2.13-5.357-5.773-6.622l1.18-4.708-2.877-.716-1.148 4.592-2.296-.549 1.164-4.625-2.878-.715-1.181 4.725-1.83-.433v-.016l-3.976-.999-.766 3.078s2.13.5 2.096.516c1.165.3 1.365 1.065 1.332 1.664l-1.332 5.39.3.1-.316-.067-1.88 7.537c-.133.35-.5.882-1.314.665.033.05-2.08-.499-2.08-.499l-1.43 3.278 3.743.931 2.046.533-1.198 4.775 2.878.715 1.165-4.725 2.312.599-1.18 4.708 2.877.716 1.181-4.775c4.908.931 8.602.566 10.15-3.877 1.247-3.576-.067-5.623-2.646-6.987 1.88-.416 3.294-1.664 3.66-4.21zm-6.572 9.217c-.882 3.577-6.904 1.63-8.85 1.164l1.58-6.338c1.946.499 8.202 1.447 7.27 5.157zm.882-9.267c-.799 3.244-5.823 1.597-7.437 1.198l1.43-5.74c1.631.4 6.855 1.165 6.007 4.542z';

const ETH_PATHS: readonly AssetPath[] = [
  ['M27.92 8.28v13.6l-11.67 6.45L27.92 8.28Z', '#e7f0ff'],
  ['m16.25 28.33-.07.1 11.74 7.45v-14l-11.67 6.45Z', '#a5b9ee'],
  ['M27.92 8.28v13.6l11.88 6.56h.01L27.98 8.17l-.06.1Z', '#a5b8f0'],
  ['m39.8 28.44-11.82 7.48-.06-.04v-14l11.88 6.56Z', '#687fcb'],
  ['M28 47.82 16.09 30.55l11.9 7.26 11.91-7.26L28 47.82Z', '#a8b9ef'],
  ['M28.02 37.8H28l-11.91-7.25 11.9 17.27.03-.03v-10Z', '#e8f1ff'],
  ['M27.8 8.1a.2.2 0 0 1 .36 0l11.81 20.23a.2.2 0 0 1-.06.27l-11.82 7.48a.2.2 0 0 1-.22 0L16.1 28.6a.2.2 0 0 1-.06-.27L27.8 8.1Z', '#fff', 'evenodd'],
];

export function localAssetGeometry(asset: LocalAsset): {
  background: string;
  paths: readonly AssetPath[];
  stops: readonly (readonly [string, string])[];
} {
  return asset === 'BTC'
    ? { background: '#f7931a', paths: [[BTC_PATH, '#fff']], stops: [] }
    : { background: '#465191', paths: ETH_PATHS,
      stops: [['0', '#465191'], ['0.36', '#32498f'], ['0.7', '#555e99'], ['1', '#4f5795']] };
}

/** Match the base asset, not arbitrary startsWith (ETHFI/BTCDOM are not ETH/BTC). */
export function localAssetTicker(ticker: string): LocalAsset | undefined {
  const bare = ticker.trim().toUpperCase().split(':').at(-1)?.replace(/\.P$/, '') ?? '';
  const match = /^(BTC|ETH)(?:[\/_-]?(?:USDT|USDC|USD|BUSD|FDUSD|DAI|EUR|TRY|BNB|JPY|GBP|AUD|BRL|BTC|ETH))?$/.exec(bare);
  return match?.[1] as LocalAsset | undefined;
}

const iconUrls = new Map<LocalAsset, string>();

/** Inline images are self-contained, synchronous, and do not taint canvas export. */
export function resolveLocalSymbolIcon(symbol: { ticker: string }): string | undefined {
  const asset = localAssetTicker(symbol.ticker);
  if (!asset) return undefined;
  const cached = iconUrls.get(asset);
  if (cached) return cached;
  const { background, paths, stops } = localAssetGeometry(asset);
  // The fixed ID lives inside this image's separate SVG document, never in the
  // shared HTML tree. Inline Viewer SVGs still allocate per-instance IDs.
  const gradient = stops.length
    ? `<defs><linearGradient id="asset" x1="0" y1="0" x2="0" y2="1">${stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('')}</linearGradient></defs>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56">${gradient}<rect width="56" height="56" fill="${stops.length ? 'url(#asset)' : background}"/>${paths.map(([d, fill, rule]) => `<path d="${d}" fill="${fill}"${rule ? ` fill-rule="${rule}"` : ''}/>`).join('')}</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  iconUrls.set(asset, url);
  return url;
}
