export const NEW_PINE_SCRIPT = `//@version=6
indicator("My Indicator", overlay=true)

plot(ta.ema(close, 14), "EMA 14", color.orange)
`;

export function extractPineTitle(source: string): string {
  const match = /(?:indicator|strategy|library)\s*\(\s*(?:title\s*=\s*)?["']([^"']+)["']/.exec(source);
  return match?.[1] ?? 'Untitled indicator';
}
