// Lucide glyphs (ISC), plus the existing Vela native Settings glyph.
// Keep native coordinates: scaling/rounding individual paths changes the
// geometry, and placing a 24-unit glyph in a 16-unit viewport clips it.
type Shape = readonly [tag: 'path' | 'circle' | 'rect' | 'line', attributes: Readonly<Record<string, string>>];
const path = (d: string): Shape => ['path', { d }];
const shapes = {
  close: [path('M18 6 6 18'), path('m6 6 12 12')],
  star: [path('M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z')],
  'chevron-up': [path('m18 15-6-6-6 6')],
  'chevron-down': [path('m6 9 6 6 6-6')],
  maximize: [path('M15 3h6v6'), path('m21 3-7 7'), path('m3 21 7-7'), path('M9 21H3v-6')],
  gauge: [path('m12 14 4-4'), path('M3.34 19a10 10 0 1 1 17.32 0')],
  ghost: [path('M9 10h.01'), path('M15 10h.01'), path('M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z')],
  list: ['M3 5h.01', 'M3 12h.01', 'M3 19h.01', 'M8 5h13', 'M8 12h13', 'M8 19h13'].map(path),
  calendar: [path('M8 2v4'), path('M16 2v4'), ['rect', { x: '3', y: '4', width: '18', height: '18', rx: '2' }], path('M3 10h18')],
  crosshair: [
    ['circle', { cx: '12', cy: '12', r: '10' }],
    ['line', { x1: '22', x2: '18', y1: '12', y2: '12' }],
    ['line', { x1: '6', x2: '2', y1: '12', y2: '12' }],
    ['line', { x1: '12', x2: '12', y1: '6', y2: '2' }],
    ['line', { x1: '12', x2: '12', y1: '22', y2: '18' }],
  ],
  'settings-2': [path('M14 17H5'), path('M19 7h-9'), ['circle', { cx: '17', cy: '17', r: '3' }], ['circle', { cx: '7', cy: '7', r: '3' }]],
  refresh: [path('M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8'), path('M21 3v5h-5'), path('M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16'), path('M8 16H3v5')],
  settings: [path('M6.55 1.4h2.9l.32 1.72c.48.14.92.38 1.3.7l1.66-.55 1.45 2.5-1.35 1.1c.08.34.12.7.12 1.07s-.04.73-.12 1.07l1.35 1.1-1.45 2.5-1.66-.55a4.3 4.3 0 0 1-1.3.7L9.45 14.6h-2.9l-.32-1.72a4.3 4.3 0 0 1-1.3-.7l-1.66.55-1.45-2.5 1.35-1.1A4.4 4.4 0 0 1 3.05 7.94c0-.37.04-.73.12-1.07l-1.35-1.1 1.45-2.5 1.66.55c.38-.32.82-.56 1.3-.7L6.55 1.4z'), ['circle', { cx: '8', cy: '8', r: '2.2' }]],
} satisfies Record<string, readonly Shape[]>;

export type BacktestIconName = keyof typeof shapes;

/** Only closed-over glyph constants enter this markup, never report text. */
export function backtestIconMarkup(name: BacktestIconName, size = 16): string {
  const native = name === 'settings';
  const extent = native ? 16 : 24;
  const dimension = Number.isFinite(size) && size > 0 ? size : 16;
  const body = (shapes[name] as readonly Shape[]).map(([tag, attrs]) =>
    `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(' ')}></${tag}>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}"`
    + ` aria-hidden="true" focusable="false" class="quant-backtest-icon" data-backtest-glyph="${name}"`
    + ` style="width:${dimension}px;height:${dimension}px;stroke-width:${native ? 1.2 : 1.5}">${body}</svg>`;
}

export function backtestIcon(doc: Document, name: BacktestIconName, size = 16): SVGSVGElement {
  const host = doc.createElement('span');
  host.innerHTML = backtestIconMarkup(name, size);
  return host.firstElementChild as SVGSVGElement;
}
