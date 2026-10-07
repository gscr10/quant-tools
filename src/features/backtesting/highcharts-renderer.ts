import type HighchartsNamespace from 'highcharts';

/**
 * The report surface owns chart lifetimes, while this module owns the
 * Highcharts loading boundary.  Keeping the import dynamic makes the initial
 * chart workspace independent from the report bundle; Vite emits a local
 * chunk and no remote script or CDN URL is involved.
 */
export type ReportChartKind = 'line' | 'column' | 'pie' | 'scatter' | 'area' | 'arearange';
export type ReportChartAxis = 'datetime' | 'linear' | 'category';
export type ReportChartTooltipMode =
  | 'performance-equity'
  | 'performance-bucket'
  | 'distribution'
  | 'winrate'
  | 'duration-pnl'
  | 'simulation-paths'
  | 'simulation-distribution';
export type ReportChartDashStyle = 'Solid' | 'Dash' | 'Dot' | 'ShortDash';
export type ReportChartValueUnit = 'currency' | 'percent' | 'number' | 'count';

// Reference graphics use #71717a, but its 10–11 px text measures only 3.74:1
// on the report background. Keep series colors separate from readable labels.
const MUTED_CHART_TEXT = '#a1a1aa';

/** Display-only rounding: chart points and broker calculations stay untouched. */
export function formatReportAxisValue(value: number, _currency = false, tickInterval?: number): string {
  if (!Number.isFinite(value)) return '—';
  // Currency axis ticks are not currency totals: fixed cents can collapse an
  // entire low-value chart to zero. Significant digits retain small values,
  // while a narrow interval at a large offset may need extra digits to keep
  // adjacent labels distinct. Cap at the precision of a JavaScript number.
  const intervalDigits = tickInterval && Number.isFinite(tickInterval) && value !== 0
    ? Math.ceil(Math.log10(Math.abs(value)) - Math.log10(Math.abs(tickInterval))) + 2
    : 12;
  const significantDigits = Math.min(17, Math.max(12, intervalDigits));
  const rounded = Number(value.toPrecision(significantDigits));
  return (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('en-US', {
    maximumSignificantDigits: significantDigits,
  });
}

export function formatPerformanceAxisValue(value: number, compact: boolean, tickInterval?: number): string {
  const scale = compact
    ? ([1e12, 1e9, 1e6, 1e3].find((candidate) => Math.abs(value) >= candidate) ?? 1)
    : 1;
  const suffix = ({ 1e12: 'T', 1e9: 'G', 1e6: 'M', 1e3: 'k' } as Record<number, string>)[scale] ?? '';
  const formatted = formatReportAxisValue(value / scale, false,
    tickInterval === undefined ? undefined : tickInterval / scale).replaceAll(',', '');
  // Equity/Dock axes use the reference's shortest numeric notation, after the
  // existing float-noise cleanup. Compact Analysis/Simulation axes retain
  // their decimal and suffix contract; non-finite input keeps the placeholder.
  return !compact && Number.isFinite(value) ? String(Number(formatted)) : formatted + suffix;
}

export interface ReportChartZone {
  readonly value?: number;
  readonly color: string;
  readonly fillColor?: HighchartsNamespace.ColorType;
}

interface ReportChartPointMetadata {
  readonly x: number;
  /** Optional category key when `label` is reserved for tooltip detail. */
  readonly category?: string;
  readonly label?: string;
  readonly color?: string;
  readonly from?: number;
  readonly to?: number;
  readonly direction?: string;
  readonly time?: number | string | null;
  readonly tradeNumber?: number;
  /** Explicit histogram population for Simulation distribution tooltips. */
  readonly count?: number;
}

export interface ReportChartPoint extends ReportChartPointMetadata {
  readonly y: number;
}

export interface ReportChartRangePoint extends ReportChartPointMetadata {
  readonly low: number;
  readonly high: number;
  readonly y?: never;
}

export type ReportChartDataPoint = ReportChartPoint | ReportChartRangePoint;

export interface ReportChartSeries<
  TPoint extends ReportChartDataPoint = ReportChartPoint,
> {
  readonly name: string;
  readonly points: readonly TPoint[];
  readonly kind?: ReportChartKind;
  readonly color?: string;
  readonly opacity?: number;
  readonly dashStyle?: ReportChartDashStyle;
  readonly showInLegend?: boolean;
  readonly enableMouseTracking?: boolean;
  readonly markerEnabled?: boolean;
  readonly fillColor?: string;
  readonly fillOpacity?: number;
  readonly lineWidth?: number;
  readonly zIndex?: number;
  readonly zoneAxis?: 'x' | 'y';
  readonly zones?: readonly ReportChartZone[];
}

export interface ReportChartPlotLine {
  readonly axis: 'x' | 'y';
  readonly value: number;
  readonly color?: string;
  readonly width?: number;
  readonly dashStyle?: ReportChartDashStyle;
  readonly label?: string;
  readonly labelAlign?: 'left' | 'center' | 'right';
  readonly labelUseHTML?: boolean;
  readonly labelX?: number;
  readonly labelY?: number;
  readonly labelColor?: string;
  readonly labelBackgroundColor?: string;
  readonly labelPadding?: string;
  readonly labelBorderRadius?: string;
  readonly labelFontSize?: string;
  readonly zIndex?: number;
}

export interface ReportChartOptions {
  readonly kind: ReportChartKind;
  readonly label: string;
  readonly points: readonly ReportChartDataPoint[];
  /**
   * Complete source points retained for hover fidelity when the render series
   * is downsampled.  When omitted, `points` are both render and tooltip data.
   */
  readonly tooltipPoints?: readonly ReportChartDataPoint[];
  /** Use category labels instead of treating string buckets as timestamps. */
  readonly axis?: ReportChartAxis;
  readonly categories?: readonly string[];
  /** Optional additional series, used by the simulation cumulative view. */
  readonly series?: readonly ReportChartSeries<ReportChartDataPoint>[];
  /** Container mode follows the Dock's available height during resizing. */
  readonly height?: number | 'container';
  readonly hideAxes?: boolean;
  readonly markerEnabled?: boolean;
  /** Defaults applied to the implicit single series when `series` is absent. */
  readonly fillOpacity?: number;
  readonly zoneAxis?: 'x' | 'y';
  readonly zones?: readonly ReportChartZone[];
  readonly positiveColor?: string;
  readonly negativeColor?: string;
  readonly lineColor?: string;
  readonly innerSize?: string | number;
  readonly legend?: boolean;
  readonly xAxisTitle?: string;
  readonly yAxisTitle?: string;
  readonly yAxisOpposite?: boolean;
  readonly yAxisMin?: number;
  readonly yAxisMax?: number;
  readonly yAxisTickInterval?: number;
  /** Values are ratios in [0, 1] and are rendered as percentage labels. */
  readonly yAxisPercent?: boolean;
  readonly xAxisMin?: number;
  readonly xAxisMax?: number;
  readonly xAxisTickInterval?: number;
  readonly xAxisLabelRotation?: number;
  readonly xAxisLabelDecimals?: number;
  readonly columnPointRange?: number;
  readonly columnBorderRadius?: number;
  readonly columnGroupPadding?: number;
  readonly columnPointPadding?: number;
  readonly chartSpacing?: readonly [number, number, number, number];
  readonly yAxisGridLineWidth?: number;
  readonly showZeroLine?: boolean;
  readonly xAxisTickColor?: string;
  readonly plotLines?: readonly ReportChartPlotLine[];
  readonly tooltipMode?: ReportChartTooltipMode;
  readonly currency?: string;
  /** Unit of Simulation path values, or distribution x-axis outcomes. */
  readonly valueUnit?: ReportChartValueUnit;
}

interface ChartRecord {
  readonly chart: HighchartsNamespace.Chart;
  readonly observer?: ResizeObserver;
  lastWidth?: number;
  lastHeight?: number;
}

const records = new WeakMap<HTMLElement, ChartRecord>();
const generations = new WeakMap<HTMLElement, number>();
const descriptors = new WeakMap<HTMLElement, ReportChartOptions>();
/**
 * Dock resizing changes the chart host's box on every pointer sample.  A
 * ResizeObserver callback for each sample would make Highcharts synchronously
 * measure and redraw the same chart while the pointer is still moving.  Keep
 * a small, reference-counted suspension boundary so the Workbench can defer
 * those reflows until the drag settles.  A depth counter is used because a
 * page can host more than one Workbench and teardown must remain balanced.
 */
let reportChartReflowSuspendDepth = 0;
const reportChartHosts = new Set<HTMLElement>();
const pendingReportChartReflows = new Set<HTMLElement>();
let highchartsPromise: Promise<typeof HighchartsNamespace> | null = null;
let highchartsMorePromise: Promise<typeof HighchartsNamespace> | null = null;
let activeChartCount = 0;
let activeObserverCount = 0;

export interface ReportChartResourceStats {
  readonly activeCharts: number;
  readonly activeObservers: number;
}

/** Runtime counters used by the long open/close resource regression. */
export function getReportChartResourceStats(): ReportChartResourceStats {
  return Object.freeze({
    activeCharts: activeChartCount,
    activeObservers: activeObserverCount,
  });
}

/** Defer ResizeObserver-driven Highcharts reflows during a layout drag. */
export function suspendReportChartReflow(): void {
  reportChartReflowSuspendDepth += 1;
}

/**
 * Resume deferred reflows after a layout drag and settle each live chart once.
 * Reflowing every live host (instead of only hosts that happened to receive a
 * ResizeObserver notification) also covers browsers that coalesce the final
 * notification while the suspension is active.
 */
export function resumeReportChartReflow(): void {
  if (reportChartReflowSuspendDepth === 0) return;
  reportChartReflowSuspendDepth -= 1;
  if (reportChartReflowSuspendDepth > 0) return;
  const hosts = new Set<HTMLElement>([
    ...reportChartHosts,
    ...pendingReportChartReflows,
  ]);
  pendingReportChartReflows.clear();
  hosts.forEach((host) => reflowReportChart(host));
}

function reflowReportChart(host: HTMLElement): void {
  const record = records.get(host);
  if (!record || !connected(host)) {
    // A host can be detached by a caller that did not get a chance to invoke
    // the renderer disposer. Do not keep that detached node in the temporary
    // live-host registry across future drag cycles.
    reportChartHosts.delete(host);
    pendingReportChartReflows.delete(host);
    return;
  }
  try {
    record.chart.reflow();
  } catch {
    // A resize racing chart destruction is an optional enhancement; the
    // synchronously rendered SVG fallback remains valid.
  }
}

/**
 * Highcharts core emits an SVG with an empty aria-label unless its optional
 * accessibility module is loaded. The report intentionally omits that module,
 * so keep the accessibility contract at this boundary and describe the actual
 * SVG after every upgrade/reuse.
 */
function applyChartAccessibility(host: HTMLElement, label: string): void {
  try {
    const svg = host.querySelector<SVGSVGElement>('svg.highcharts-root');
    if (!svg) return;
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
    let description = svg.querySelector<SVGDescElement>('desc[data-quant-report-description]');
    if (!description) {
      description = svg.ownerDocument.createElementNS(svg.namespaceURI, 'desc') as SVGDescElement;
      description.setAttribute('data-quant-report-description', 'true');
      svg.appendChild(description);
    }
    description.textContent = label;
  } catch {
    // A detached/partial DOM must not turn an optional enhancement into a
    // report failure. The outer host still retains its fallback aria-label.
  }
}

/**
 * Highcharts' accessibility module is deliberately not part of the report
 * bundle.  The generated SVG therefore needs a small, local keyboard bridge
 * for the charts that expose individual points (the Analysis charts and the
 * Simulation distributions).  Keeping the bridge on each point gives mouse
 * hover and keyboard focus the same tooltip path without adding a visible
 * control to the reference layout.
 */
function applyChartPointAccessibility(
  chart: HighchartsNamespace.Chart,
  options: ReportChartOptions,
): void {
  applyChartCurveAccessibility(chart, options);
  const allPoints = chart.series.flatMap((series) => series.points)
    .filter((point) => point.graphic?.element);
  const points = allPoints.filter((point) => point.visible !== false && point.series.visible);
  // A legend toggle can hide the current tab stop without changing the host
  // dimensions. Remove its old navigation closure and rebuild the visible
  // point sequence on redraw, preserving focus when the point is still shown.
  allPoints.forEach((point) => {
    if (point.visible !== false && point.series.visible) return;
    const element = point.graphic!.element as SVGElement & {
      __quantReportPointKeydown?: (event: Event) => void;
      __quantReportPointFocus?: () => void;
      __quantReportPointBlur?: () => void;
    };
    if (element.__quantReportPointKeydown) {
      element.removeEventListener('keydown', element.__quantReportPointKeydown);
      element.removeEventListener('focus', element.__quantReportPointFocus!);
      element.removeEventListener('blur', element.__quantReportPointBlur!);
    }
    element.removeAttribute('tabindex');
    element.removeAttribute('data-quant-report-point');
  });
  if (points.length === 0) return;
  const activeElement = chart.container.ownerDocument.activeElement;
  const activeIndex = points.findIndex((point) => point.graphic?.element === activeElement);
  const previousIndex = points.findIndex((point) => point.graphic?.element.getAttribute('tabindex') === '0');
  const tabIndex = activeIndex >= 0 ? activeIndex : Math.max(0, previousIndex);
  points.forEach((point, index) => {
    const element = point.graphic?.element;
    if (!element) return;
    const custom = (point.options.custom ?? {}) as {
      category?: string;
      label?: string;
      from?: number;
      to?: number;
      direction?: string;
      tradeNumber?: number;
      time?: number | string | null;
      count?: number;
    };
    const category = custom.category ?? custom.label ?? point.name ?? '';
    const number = custom.tradeNumber === undefined ? '' : `Trade #${custom.tradeNumber}, `;
    const value = Number.isFinite(point.y) ? String(point.y) : '';
    const range = Number.isFinite(custom.from) && Number.isFinite(custom.to)
      ? `, interval ${custom.from} to ${custom.to}`
      : '';
    const direction = custom.direction ? `, ${custom.direction}` : '';
    const label = `${number}${category || options.label}${direction}: ${value}${range}`;
    element.setAttribute('tabindex', index === tabIndex ? '0' : '-1');
    element.setAttribute('role', 'img');
    element.setAttribute('aria-label', label);
    element.setAttribute('data-quant-report-point', String(index));
    // Avoid stacking listeners when Highcharts redraws an existing series.
    const previous = (element as SVGElement & {
      __quantReportPointKeydown?: (event: Event) => void;
      __quantReportPointFocus?: () => void;
      __quantReportPointBlur?: () => void;
    });
    if (previous.__quantReportPointKeydown) {
      element.removeEventListener('keydown', previous.__quantReportPointKeydown);
      element.removeEventListener('focus', previous.__quantReportPointFocus!);
      element.removeEventListener('blur', previous.__quantReportPointBlur!);
    }
    const focus = () => chart.tooltip?.refresh(point);
    const blur = () => chart.tooltip?.hide();
    const keydown = (event: Event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        // Dismiss the value without stranding keyboard focus on BODY. Arrow,
        // Home and End must still explore this chart after closing its tooltip.
        chart.tooltip?.hide(0);
        return;
      }
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? points.length - 1
          : (index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + points.length)
            % points.length;
      const next = points[nextIndex]?.graphic?.element as HTMLElement | undefined;
      if (!next) return;
      points.forEach((candidate) => candidate.graphic?.element?.setAttribute('tabindex', '-1'));
      next.setAttribute('tabindex', '0');
      next.focus();
    };
    (element as SVGElement & {
      __quantReportPointKeydown?: (event: Event) => void;
      __quantReportPointFocus?: () => void;
      __quantReportPointBlur?: () => void;
    }).__quantReportPointKeydown = keydown;
    (element as SVGElement & {
      __quantReportPointKeydown?: (event: Event) => void;
      __quantReportPointFocus?: () => void;
      __quantReportPointBlur?: () => void;
    }).__quantReportPointFocus = focus;
    (element as SVGElement & {
      __quantReportPointKeydown?: (event: Event) => void;
      __quantReportPointFocus?: () => void;
      __quantReportPointBlur?: () => void;
    }).__quantReportPointBlur = blur;
    element.addEventListener('keydown', keydown);
    element.addEventListener('focus', focus);
    element.addEventListener('blur', blur);
  });
}

interface CurveKeyboardSource {
  readonly series: HighchartsNamespace.Series;
  readonly points: readonly ReportChartDataPoint[];
}

interface CurveKeyboardState {
  sources: CurveKeyboardSource[];
  index: number;
  selected?: { series: HighchartsNamespace.Series; x: number; index: number };
  active: boolean;
  marker?: HighchartsNamespace.SVGElement;
  readonly status: HTMLSpanElement;
  readonly dispose: () => void;
}

const curveKeyboards = new WeakMap<HighchartsNamespace.Chart, CurveKeyboardState>();
const sortedSources = new WeakMap<readonly ReportChartDataPoint[], boolean>();

function sourceIsSorted(points: readonly ReportChartDataPoint[]): boolean {
  let sorted = sortedSources.get(points);
  if (sorted === undefined) {
    sorted = points.every((point, index) => index === 0 || point.x >= points[index - 1].x);
    sortedSources.set(points, sorted);
  }
  return sorted;
}

/**
 * Markerless curves have no per-point SVG nodes. Give them one tab stop and
 * one moving cursor, even when the source contains 100k points and the drawn
 * path is sampled. The synthetic tooltip point is not inserted into a series
 * and never mutates a rendered point or Highcharts' point/resource counters.
 */
function applyChartCurveAccessibility(
  chart: HighchartsNamespace.Chart,
  options: ReportChartOptions,
): void {
  const sources: CurveKeyboardSource[] = [];
  chart.series.forEach((series, seriesIndex) => {
    const curveOptions = series.options as HighchartsNamespace.SeriesLineOptions;
    if (!series.visible || curveOptions.enableMouseTracking === false
      || !['line', 'area', 'arearange'].includes(series.type)
      || (curveOptions.marker?.enabled !== false && series.points.some((point) => point.graphic))) return;
    const source = chart.series.length === 1 && options.tooltipPoints
      ? options.tooltipPoints
      : options.series?.[seriesIndex]?.points ?? options.points;
    const points = source.filter((point) => Number.isFinite(point.x)
      && hasFinitePointValue(point, series.type as ReportChartKind));
    if (points.length > 0) sources.push({ series, points });
  });
  const container = chart.container;
  const host = container.parentElement!;
  let state = curveKeyboards.get(chart);
  if (sources.length === 0) {
    if (state) {
      state.dispose();
      curveKeyboards.delete(chart);
    }
    return;
  }
  if (!state) {
    const status = container.ownerDocument.createElement('span');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.dataset.quantReportCurveStatus = 'true';
    // Keep the reference layout intact without creating a node for each bar.
    status.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
    container.appendChild(status);
    const dismiss = () => {
      const current = curveKeyboards.get(chart);
      if (!current) return;
      current.active = false;
      current.marker?.hide();
      current.status.textContent = '';
      chart.tooltip?.hide(0);
    };
    const focus = (event: Event) => {
      if (event.target !== container) return;
      const current = curveKeyboards.get(chart);
      if (current) current.active = true;
      showCurveKeyboardPoint(chart);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.target !== container || event.altKey || event.ctrlKey || event.metaKey) return;
      const current = curveKeyboards.get(chart);
      if (!current) return;
      const count = current.sources.reduce((sum, source) => sum + source.points.length, 0);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      current.index = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1
        : (current.index + (event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      current.active = true;
      showCurveKeyboardPoint(chart);
    };
    const pointer = () => {
      const current = curveKeyboards.get(chart);
      if (!current) return;
      current.active = false;
      current.marker?.hide();
      current.status.textContent = '';
      // Highcharts owns pointer tooltips. Do not hide the tooltip its tracker
      // has just opened, or let subsequent report updates replace it.
    };
    const previousHostRole = host.getAttribute('role');
    host.setAttribute('role', 'group');
    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'group');
    container.setAttribute('aria-roledescription', 'interactive chart');
    container.dataset.quantReportCurve = 'true';
    container.addEventListener('focus', focus);
    container.addEventListener('blur', dismiss);
    container.addEventListener('keydown', keydown);
    container.addEventListener('pointermove', pointer);
    container.addEventListener('pointerdown', pointer);
    state = {
      sources, index: 0, active: false, status,
      dispose: () => {
        dismiss();
        container.removeEventListener('focus', focus);
        container.removeEventListener('blur', dismiss);
        container.removeEventListener('keydown', keydown);
        container.removeEventListener('pointermove', pointer);
        container.removeEventListener('pointerdown', pointer);
        for (const attribute of ['tabindex', 'role', 'aria-label', 'aria-roledescription',
          'data-quant-report-curve', 'data-quant-report-curve-index', 'data-quant-report-curve-count']) {
          container.removeAttribute(attribute);
        }
        if (previousHostRole === null) host.removeAttribute('role');
        else host.setAttribute('role', previousHostRole);
        curveKeyboards.get(chart)?.marker?.destroy();
        status.remove();
      },
    };
    curveKeyboards.set(chart, state);
  }
  state.sources = sources;
  const count = sources.reduce((sum, source) => sum + source.points.length, 0);
  // Preserve the same raw point across a redraw/update. A removed or hidden
  // selection falls back to a valid point in the remaining visible sequence.
  const selected = state.selected;
  let preceding = 0;
  let selectedIndex = -1;
  for (const source of sources) {
    if (source.series === selected?.series) {
      const index = source.points[selected.index]?.x === selected.x ? selected.index
        : source.points.findIndex((point) => point.x === selected.x);
      if (index >= 0) selectedIndex = preceding + index;
    }
    preceding += source.points.length;
  }
  state.index = selectedIndex >= 0 ? selectedIndex : Math.min(state.index, count - 1);
  container.dataset.quantReportCurveCount = String(count);
  container.dataset.quantReportCurveIndex = String(state.index);
  container.setAttribute('aria-label', `${options.label}. ${count} points. Use arrow keys to explore; Home and End for first and last; Escape to dismiss the tooltip.`);
  if (state.active && container.ownerDocument.activeElement === container) showCurveKeyboardPoint(chart);
}

function showCurveKeyboardPoint(chart: HighchartsNamespace.Chart): void {
  const state = curveKeyboards.get(chart);
  if (!state?.active) return;
  let index = state.index;
  const source = state.sources.find((candidate) => {
    if (index < candidate.points.length) return true;
    index -= candidate.points.length;
    return false;
  });
  if (!source) return;
  const raw = source.points[index];
  const base = source.series.points[0];
  if (!base) return;
  const liveOptions = descriptors.get(chart.container.parentElement!);
  const categoryIndex = liveOptions?.axis === 'category'
    ? source.series.xAxis.categories.indexOf(raw.category ?? raw.label ?? String(raw.x)) : -1;
  const xValue = categoryIndex >= 0 ? categoryIndex : raw.x;
  const y = 'y' in raw && typeof raw.y === 'number' ? raw.y : (raw as ReportChartRangePoint).high;
  const point = Object.assign(Object.create(Object.getPrototypeOf(base)), {
    series: source.series, x: xValue, y, color: raw.color ?? source.series.color,
    category: raw.category ?? xValue, key: raw.category ?? xValue,
    name: raw.category ?? raw.label, formatPrefix: 'point',
    options: { x: xValue, y, custom: { ...raw, quantKeyboardPoint: true } },
    plotX: source.series.xAxis.toPixels(xValue, true),
    plotY: source.series.yAxis.toPixels(y, true),
    isNull: false,
    ...(source.series.type === 'arearange' ? { low: (raw as ReportChartRangePoint).low, high: y } : {}),
  }) as HighchartsNamespace.Point & { point: HighchartsNamespace.Point };
  point.point = point;
  state.selected = { series: source.series, x: raw.x, index };
  chart.container.dataset.quantReportCurveIndex = String(state.index);
  chart.tooltip?.refresh(point);
  const x = Number(point.plotX) + chart.plotLeft;
  const plotY = Number(point.plotY) + chart.plotTop;
  if (!state.marker) {
    state.marker = chart.renderer.circle(x, plotY, 4).attr({
      fill: source.series.color ?? '#2962ff', stroke: '#ffffff', 'stroke-width': 1,
      zIndex: 8, 'pointer-events': 'none', 'aria-hidden': 'true',
      'data-quant-report-curve-cursor': 'true',
    }).add();
  }
  state.marker.attr({ cx: x, cy: plotY, fill: source.series.color ?? '#2962ff' }).show();
  const time = tooltipTime(raw.time ?? (liveOptions?.axis === 'datetime' ? raw.x : undefined));
  const trade = raw.tradeNumber === undefined ? '' : `Trade #${raw.tradeNumber}, `;
  const value = source.series.type === 'arearange'
    ? `${formatReportAxisValue((raw as ReportChartRangePoint).low)} to ${formatReportAxisValue(y)}`
    : formatReportAxisValue(y);
  state.status.textContent = `${source.series.name}, point ${state.index + 1} of ${chart.container.dataset.quantReportCurveCount}: `
    + `${trade}${raw.direction ? raw.direction + ', ' : ''}${raw.category ?? raw.label ?? ''}`
    + `${time ? ', ' + time + ' UTC' : ''}, ${value}${liveOptions?.currency ? ' ' + liveOptions.currency : ''}`;
}

function nextGeneration(host: HTMLElement): number {
  const generation = (generations.get(host) ?? 0) + 1;
  generations.set(host, generation);
  return generation;
}

function isCurrent(host: HTMLElement, generation: number): boolean {
  return generations.get(host) === generation;
}

function connected(host: HTMLElement): boolean {
  // `isConnected` is available in all supported browsers. The owner-document
  // fallback keeps this boundary usable in lightweight DOM test doubles.
  return host.isConnected || Boolean(host.ownerDocument?.documentElement?.contains(host));
}

function hasFinitePointValue(point: ReportChartDataPoint, kind: ReportChartKind): boolean {
  return kind === 'arearange'
    ? 'low' in point && Number.isFinite(point.low) && Number.isFinite(point.high)
    : 'y' in point && Number.isFinite(point.y);
}

function finitePoints(
  points: readonly ReportChartDataPoint[],
  kind: ReportChartKind,
): ReportChartDataPoint[] {
  return points
    .filter((point) => Number.isFinite(point.x) && hasFinitePointValue(point, kind))
    .map((point) => ({ ...point, x: point.x }));
}

function nearestRawPoint(
  points: readonly ReportChartDataPoint[] | undefined,
  x: number,
  sorted = true,
): ReportChartDataPoint | undefined {
  if (!points || points.length === 0 || !Number.isFinite(x)) return undefined;
  if (!sorted) {
    let nearest = points[0];
    let distance = Math.abs(nearest.x - x);
    for (let index = 1; index < points.length; index += 1) {
      const candidate = points[index];
      const candidateDistance = Math.abs(candidate.x - x);
      if (candidateDistance < distance) {
        nearest = candidate;
        distance = candidateDistance;
      }
    }
    return nearest;
  }
  // Report series are chronological/ascending. Binary search keeps tooltip
  // lookup O(log n) even when the retained source contains 100k bars.
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = points[middle].x;
    if (value === x) return points[middle];
    if (value < x) low = middle + 1;
    else high = middle - 1;
  }
  const right = points[Math.min(points.length - 1, low)];
  const left = points[Math.max(0, low - 1)];
  return Math.abs(right.x - x) < Math.abs(left.x - x) ? right : left;
}

function normalizeSeries(
  options: ReportChartOptions,
  categories: string[] = [],
): Array<Omit<ReportChartSeries<ReportChartDataPoint>, 'points'> & {
  points: ReportChartDataPoint[];
}> {
  const source = options.series && options.series.length > 0
    ? options.series
    : [{
        name: options.label,
        points: options.points,
        kind: options.kind,
        color: options.lineColor,
        fillOpacity: options.fillOpacity,
        markerEnabled: options.markerEnabled,
        zoneAxis: options.zoneAxis,
        zones: options.zones,
      }];
  return source.map((series) => {
    const kind = series.kind ?? options.kind;
    const points = finitePoints(series.points, kind).map((point) => {
      if (options.axis !== 'category') return point;
      const category = point.category ?? point.label ?? String(point.x);
      let index = categories.indexOf(category);
      if (index < 0) {
        categories.push(category);
        index = categories.length - 1;
      }
      return { ...point, x: index, category, label: point.label ?? category };
    });
    return { ...series, points };
  });
}

/** Register a fallback host before it is attached to the document. */
export function registerReportChart(host: HTMLElement, options: ReportChartOptions): void {
  host.dataset.quantReportChart = 'true';
  // Keep an accessible name even when the optional Highcharts accessibility
  // module is unavailable and the SVG fallback is upgraded in place.
  const chart = records.get(host)?.chart;
  host.setAttribute('role', chart && curveKeyboards.has(chart) ? 'group' : 'img');
  host.setAttribute('aria-label', options.label);
  descriptors.set(host, options);
}

/**
 * Update a live report chart without replacing its host or Highcharts
 * instance.  Forming-bar snapshots frequently change only the last point;
 * recreating the chart for those snapshots loses hover state and produces a
 * visible flash.  Return false when the chart shape changed so callers can
 * fall back to a normal render.
 */
export function updateReportChart(host: HTMLElement, options: ReportChartOptions): boolean {
  const record = records.get(host);
  const previous = descriptors.get(host);
  if (!record || !previous || !connected(host) || previous.kind !== options.kind) return false;
  const categories = options.axis === 'category'
    ? [...(options.categories ?? [])]
    : undefined;
  const normalizedSeries = normalizeSeries(options, categories);
  if (normalizedSeries.length !== record.chart.series.length) return false;
  const pointCount = normalizedSeries.reduce((count, series) => count + series.points.length, 0);
  if (pointCount === 0) return false;
  let nextOptions = options;
  try {
    normalizedSeries.forEach((series, index) => {
      const kind = series.kind ?? options.kind;
      const data = series.points.map((point) => {
        const common = {
          x: point.x,
          ...(point.category ? { name: point.category } : {}),
          ...(point.color ? { color: point.color } : {}),
          custom: {
            category: point.category,
            label: point.label,
            from: point.from,
            to: point.to,
            direction: point.direction,
            time: point.time,
            tradeNumber: point.tradeNumber,
            count: point.count,
          },
        };
        if (kind === 'arearange') {
          const rangePoint = point as ReportChartRangePoint;
          return { ...common, low: rangePoint.low, high: rangePoint.high };
        }
        return { ...common, y: (point as ReportChartPoint).y };
      });
      const chartSeries = record.chart.series[index];
      // Highcharts normalizes aliases (for example column/bar) internally;
      // the series count and descriptor kind are the stable shape checks.
      if (!chartSeries) throw new Error('Report chart series shape changed.');
      chartSeries.setData(data, false, false, false);
    });
    if (options.tooltipMode === 'performance-equity' && record.chart.yAxis[0]) {
      const values = normalizedSeries.flatMap((series) => series.points)
        .map((point) => 'y' in point ? point.y : NaN)
        .filter((value): value is number => Number.isFinite(value));
      if (values.length > 0) {
        const yAxisMin = Math.min(...values);
        const yAxisMax = Math.max(...values);
        record.chart.yAxis[0].setExtremes(yAxisMin, yAxisMax, false);
        nextOptions = { ...options, yAxisMin, yAxisMax };
      }
    }
    descriptors.set(host, nextOptions);
    record.chart.redraw(false);
    applyChartAccessibility(host, options.label);
    applyChartPointAccessibility(record.chart, options);
    return true;
  } catch {
    return false;
  }
}

/** Reuse a chart's existing visual options while replacing only its points. */
export function updateReportChartPoints(
  host: HTMLElement,
  points: readonly ReportChartDataPoint[],
  tooltipPoints?: readonly ReportChartDataPoint[],
): boolean {
  const previous = descriptors.get(host);
  if (!previous) return false;
  return updateReportChart(host, {
    ...previous,
    points,
    ...(tooltipPoints === undefined ? {} : { tooltipPoints }),
  });
}

/** Change compact Dock axes without recreating its chart or losing focus. */
export function setReportChartLayout(host: HTMLElement, layout: { hideAxes: boolean }): void {
  const options = descriptors.get(host);
  if (!options || Boolean(options.hideAxes) === layout.hideAxes) return;
  descriptors.set(host, { ...options, hideAxes: layout.hideAxes });
  const record = records.get(host);
  if (!record) return;
  for (const axis of [...record.chart.xAxis, ...record.chart.yAxis]) {
    axis.update({ visible: !layout.hideAxes }, false);
  }
  record.chart.redraw(false);
}

export function unregisterReportChart(host: HTMLElement): void {
  destroyReportChart(host);
  descriptors.delete(host);
  host.removeAttribute('data-quant-report-chart');
  host.removeAttribute('role');
  host.removeAttribute('aria-label');
}

/** Load the exact package resolved by the root lockfile. */
export function loadHighcharts(): Promise<typeof HighchartsNamespace> {
  if (!highchartsPromise) {
    highchartsPromise = import('highcharts/esm/highcharts.js').then(
      (module) => module.default,
      (error) => {
        // A transient local chunk failure should not permanently disable
        // upgrades for a later report open; callers still retain the SVG
        // fallback for this attempt.
        highchartsPromise = null;
        throw error;
      },
    );
  }
  return highchartsPromise;
}

/**
 * `arearange` lives in Highcharts More. Load that local module only when a
 * Simulation confidence band actually needs it; both imports resolve the same
 * ESM Highcharts singleton, so the extension cannot leak a second chart core.
 */
function loadHighchartsMore(): Promise<typeof HighchartsNamespace> {
  if (!highchartsMorePromise) {
    highchartsMorePromise = loadHighcharts()
      .then(async (Highcharts) => {
        const module = await import('highcharts/esm/highcharts-more.js');
        if ((module.default as unknown) !== (Highcharts as unknown)) {
          throw new Error('Highcharts More did not extend the report chart singleton.');
        }
        return Highcharts;
      })
      .catch((error) => {
        highchartsMorePromise = null;
        throw error;
      });
  }
  return highchartsMorePromise;
}

function escapeTooltip(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character] ?? character));
}

function tooltipTime(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const numeric = typeof value === 'number' ? value : Number(value);
  const timestamp = Number.isFinite(numeric)
    ? (Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric)
    : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  });
}

function compactTooltipCurrency(
  value: number | null | undefined,
  currency: string | undefined,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  const normalized = Object.is(value, -0) ? 0 : value;
  const magnitude = Math.abs(normalized);
  const compact = magnitude >= 1_000_000
      ? `${(normalized / 1_000_000).toFixed(1)}M`
      : magnitude >= 1_000
        ? `${(normalized / 1_000).toFixed(1)}k`
        : normalized.toFixed(2);
  const code = currency?.trim().toUpperCase();
  const symbol = code === 'USD'
    ? '$'
    : code === 'EUR'
      ? '€'
      : code === 'GBP'
        ? '£'
        : code === 'JPY' || code === 'CNY' || code === 'RMB'
          ? '¥'
          : code;
  return symbol ? `${symbol} ${compact}` : compact;
}

function formatPercentRatio(value: number | null | undefined, maximumFractionDigits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits })}%`;
}

function formatSimulationValue(
  value: number | null | undefined,
  unit: ReportChartValueUnit | undefined,
  _currency: string | undefined,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (unit === 'currency') {
    return (Object.is(value, -0) ? 0 : value).toLocaleString('en-US', {
      maximumFractionDigits: 2,
    });
  }
  if (unit === 'percent') return `${(value * 100).toFixed(1)}%`;
  if (unit === 'count') return Math.round(value).toLocaleString('en-US');
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function formatSimulationPathValue(
  value: number | null | undefined,
  unit: ReportChartValueUnit | undefined,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  if (unit === 'percent') return `${(value * 100).toFixed(2)}%`;
  return (Object.is(value, -0) ? 0 : value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Upgrade a chart host in place.  The caller may render an accessible SVG
 * fallback first; if Highcharts fails to load, that fallback remains visible.
 * A stale async load is ignored when the host has been detached or replaced.
 */
export async function enhanceReportChart(
  host: HTMLElement,
  options: ReportChartOptions,
): Promise<() => void> {
  const previousOptions = descriptors.get(host);
  registerReportChart(host, options);
  const existing = records.get(host);
  if (existing && previousOptions === options && connected(host)) {
    // Repeated panel scans (for example after a resize/layout notification)
    // reuse the live instance instead of stacking charts on the same host.
    try {
      if (reportChartReflowSuspendDepth > 0) {
        pendingReportChartReflows.add(host);
      } else {
        // The former direct `existing.chart.reflow()` path is centralized so
        // suspension and stale-host checks apply consistently to reuse too.
        reflowReportChart(host);
      }
      applyChartAccessibility(host, options.label);
      return () => {
        if (records.get(host) === existing) destroyReportChart(host);
      };
    } catch {
      // A chart whose SVG was externally detached is no longer reusable;
      // release it and let the normal guarded creation path rebuild it.
      destroyReportChart(host);
    }
  }
  const generation = nextGeneration(host);
  disposeRecord(host);
  const categories = options.axis === 'category'
    ? [...(options.categories ?? [])]
    : undefined;
  // Category labels can be supplied by points when the caller did not provide
  // an explicit list. Keep the same order as the source data.
  if (options.axis === 'category' && categories) {
    const source = options.series && options.series.length > 0
      ? options.series
      : [{ name: options.label, points: options.points }];
    source.forEach((series) => series.points.forEach((point) => {
      if (!hasFinitePointValue(point, series.kind ?? options.kind)) return;
      const category = point.category ?? point.label ?? String(point.x);
      if (!categories.includes(category)) categories.push(category);
    }));
  }
  const normalizedSeries = normalizeSeries(options, categories);
  const tooltipPoints = options.tooltipPoints;
  const pointCount = normalizedSeries.reduce((count, series) => count + series.points.length, 0);
  if (pointCount === 0) return () => undefined;
  const analysisAxes = options.tooltipMode === 'distribution' || options.tooltipMode === 'duration-pnl';
  const compactAxes = analysisAxes || options.tooltipMode === 'performance-bucket';
  const simulationAxes = options.tooltipMode === 'simulation-paths' || options.tooltipMode === 'simulation-distribution';
  const winrate = options.tooltipMode === 'winrate';
  const axisLabels = compactAxes
    ? { color: MUTED_CHART_TEXT, fontSize: '10px' }
    : { color: options.tooltipMode === 'performance-equity' || simulationAxes ? '#999999' : 'var(--vela-fg-muted, #868a96)' };
  const axisTitle = compactAxes
    ? { color: MUTED_CHART_TEXT, fontSize: '11px' }
    : { color: simulationAxes ? '#999999' : 'var(--vela-fg-muted, #868a96)' };
  const piePoints = winrate ? options.points.filter((point): point is ReportChartPoint => 'y' in point && typeof point.y === 'number') : [];
  const piePopulation = piePoints.reduce((sum, point) => sum + point.y, 0);
  const pieWins = piePoints.find((point) => point.category?.toLowerCase().includes('winner'))?.y ?? 0;
  const needsRangeSeries = normalizedSeries.some(
    (series) => (series.kind ?? options.kind) === 'arearange',
  );
  const Highcharts = await (needsRangeSeries ? loadHighchartsMore() : loadHighcharts());
  if (!isCurrent(host, generation) || !connected(host)) return () => undefined;
  const xPlotLines = (options.plotLines ?? [])
    .filter((line) => line.axis === 'x')
    .map((line) => ({
      value: line.value,
      color: line.color ?? 'rgba(134, 138, 150, 0.7)',
      width: line.width ?? 1,
      dashStyle: line.dashStyle ?? 'Dash',
      zIndex: line.zIndex ?? 3,
      ...(line.label ? {
        label: {
          text: escapeTooltip(line.label),
          align: line.labelAlign ?? 'right',
          rotation: 0,
          verticalAlign: 'top' as const,
          useHTML: line.labelUseHTML ?? false,
          x: line.labelX ?? 0,
          y: line.labelY ?? 14,
          style: {
            color: line.labelColor ?? line.color ?? 'var(--vela-fg-muted, #868a96)',
            ...(line.labelBackgroundColor === undefined
              ? {}
              : { backgroundColor: line.labelBackgroundColor }),
            ...(line.labelPadding === undefined ? {} : { padding: line.labelPadding }),
            ...(line.labelBorderRadius === undefined
              ? {}
              : { borderRadius: line.labelBorderRadius }),
            ...(line.labelFontSize === undefined ? {} : { fontSize: line.labelFontSize }),
          },
        },
      } : {}),
    }));
  const yPlotLines = [
    ...((options.showZeroLine ?? !['performance-equity', 'distribution', 'winrate'].includes(options.tooltipMode ?? '')) === false
      ? []
      : [{ value: 0, color: options.tooltipMode === 'performance-bucket' || options.tooltipMode === 'duration-pnl'
        ? 'rgba(255,255,255,0.2)' : 'rgba(134, 138, 150, 0.3)', width: 1, zIndex: 2 }]),
    ...(options.plotLines ?? [])
      .filter((line) => line.axis === 'y')
      .map((line) => ({
        value: line.value,
        color: line.color ?? 'rgba(134, 138, 150, 0.7)',
        width: line.width ?? 1,
        dashStyle: line.dashStyle ?? 'Dash',
        zIndex: line.zIndex ?? 3,
        ...(line.label ? {
          label: {
            text: escapeTooltip(line.label),
            align: line.labelAlign ?? 'right',
            style: { color: line.color ?? 'var(--vela-fg-muted, #868a96)' },
          },
        } : {}),
      })),
  ];
  const highchartsSeries = normalizedSeries.map((series) => {
    const kind = series.kind ?? options.kind;
    return {
      type: kind,
      name: series.name,
      color: series.color
        ?? (kind === 'column'
          ? options.positiveColor ?? '#089981'
          : options.lineColor ?? '#2962ff'),
      ...(series.opacity === undefined ? {} : { opacity: series.opacity }),
      ...(series.dashStyle === undefined ? {} : { dashStyle: series.dashStyle }),
      ...(series.showInLegend === undefined ? {} : { showInLegend: series.showInLegend }),
      ...(series.enableMouseTracking === undefined ? {} : { enableMouseTracking: series.enableMouseTracking }),
      ...(series.fillColor === undefined ? {} : { fillColor: series.fillColor }),
      ...(series.fillOpacity === undefined ? {} : { fillOpacity: series.fillOpacity }),
      ...(series.lineWidth === undefined ? {} : { lineWidth: series.lineWidth }),
      ...(series.zIndex === undefined ? {} : { zIndex: series.zIndex }),
      ...(series.zoneAxis === undefined ? {} : { zoneAxis: series.zoneAxis }),
      ...(series.zones === undefined ? {} : {
        zones: series.zones.map((zone) => ({
          ...(zone.value === undefined ? {} : { value: zone.value }),
          color: zone.color,
          ...(zone.fillColor === undefined ? {} : { fillColor: zone.fillColor }),
        })),
      }),
      ...(kind === 'pie' ? { innerSize: options.innerSize ?? '0%' } : {}),
      marker: {
        enabled: series.markerEnabled ?? (kind === 'scatter' || pointCount <= 48),
        radius: kind === 'scatter' ? 4 : 2,
        ...(options.tooltipMode === 'performance-equity' ? {
          states: { hover: { enabled: true, radius: 4 } },
        } : {}),
      },
      data: series.points.map((point) => {
        const common = {
          x: point.x,
          ...(point.category ? { name: point.category } : {}),
          ...(point.color ? { color: point.color } : {}),
          custom: {
            category: point.category,
            label: point.label,
            from: point.from,
            to: point.to,
            direction: point.direction,
            time: point.time,
            tradeNumber: point.tradeNumber,
            count: point.count,
          },
        };
        if (kind === 'arearange') {
          const rangePoint = point as ReportChartRangePoint;
          return { ...common, low: rangePoint.low, high: rangePoint.high };
        }
        return { ...common, y: (point as ReportChartPoint).y };
      }),
    } as HighchartsNamespace.SeriesOptionsType;
  });
  const chart = Highcharts.chart(host, {
    // Match the report's English/UTC labels even when the browser locale is
    // Chinese. Highcharts 13 otherwise localizes date ticks independently of
    // the English report header and tooltips.
    lang: { locale: 'en-US' },
    time: { timezone: 'UTC' },
    chart: {
      type: options.kind,
      backgroundColor: 'transparent',
      animation: false,
      events: {
        redraw() { applyChartPointAccessibility(this, descriptors.get(host) ?? options); },
      },
      // The generation-bound observer below is the single resize owner.
      // Highcharts' own observer bypasses our drag suspension/deduplication.
      reflow: false,
      height: options.height === 'container' ? null : options.height ?? 180,
      ...(winrate ? { margin: [0, 80, 0, 0] } : {}),
      spacing: options.chartSpacing ? [...options.chartSpacing]
        : compactAxes || winrate ? [10, 10, 15, 10] : [8, 8, 8, 8],
    },
    accessibility: {
      // The optional Highcharts accessibility module is intentionally not in
      // this local lazy chunk. Enabling it without the module emits warning
      // #19; the host and generated SVG receive their role/name/description
      // from registerReportChart/applyChartAccessibility below instead.
      enabled: false,
    },
    credits: { enabled: false },
    title: winrate ? {
      text: `<div style="text-align:center"><span style="font-size:26px;font-weight:bold;color:#fff">${Math.round(piePopulation > 0 ? pieWins / piePopulation * 100 : 0)}%</span><br/><span style="font-size:10px;color:#fff;letter-spacing:2px">WINRATE</span></div>`,
      floating: true, verticalAlign: 'middle', y: 12, x: -40, useHTML: true,
    } : { text: undefined },
    legend: winrate ? {
      enabled: true, align: 'right', verticalAlign: 'middle', layout: 'vertical',
      x: 0, itemMarginBottom: 10, navigation: { enabled: false },
      itemStyle: { color: '#a1a1aa', fontWeight: 'normal', fontSize: '12px' },
      itemHoverStyle: { color: '#fff' }, symbolHeight: 10, symbolWidth: 10, symbolRadius: 5,
      useHTML: true,
      labelFormatter() {
        const point = this as HighchartsNamespace.Point;
        return `<span style="font-size:14px;font-weight:bold;color:#fff">${escapeTooltip(point.y)}</span><br/><span style="font-size:11px;color:${MUTED_CHART_TEXT}">${escapeTooltip(point.name.toLowerCase())}</span>`;
      },
    } : { enabled: options.legend ?? false },
    xAxis: {
      visible: !options.hideAxes,
      type: options.axis ?? 'datetime',
      // Highcharts More wraps the minor-tick interval hook and expects a
      // radial pane whenever minor ticks are left undefined.  Report charts
      // are cartesian (including the charts that remain mounted underneath a
      // closed Viewer), so make the intentional absence explicit.  Without
      // this, loading the local arearange module in Simulation can make a
      // later dock reflow call `pane.hasSeriesType` on an ordinary axis.
      minorTicks: false,
      ...(categories ? { categories } : {}),
      ...(options.xAxisMin === undefined ? {} : { min: options.xAxisMin }),
      ...(options.xAxisMax === undefined ? {} : { max: options.xAxisMax }),
      ...(options.xAxisTickInterval === undefined ? {} : { tickInterval: options.xAxisTickInterval }),
      title: {
        text: options.xAxisTitle,
        style: axisTitle,
      },
      lineColor: compactAxes ? 'rgba(255,255,255,0.1)' : 'transparent',
      ...(options.tooltipMode === 'duration-pnl' ? { gridLineColor: 'rgba(255,255,255,0.05)', gridLineWidth: 1 } : {}),
      ...(options.tooltipMode === 'performance-equity' ? { lineWidth: 0, tickWidth: 0 } : {}),
      tickColor: options.xAxisTickColor
        ?? (compactAxes ? 'rgba(255,255,255,0.1)' : 'transparent'),
      labels: {
        ...(options.tooltipMode === 'performance-equity'
          && tooltipPoints?.some((point) => point.tradeNumber !== undefined) ? {
            formatter() {
              const point = (descriptors.get(host)?.tooltipPoints ?? tooltipPoints)[Math.round(Number(this.value))];
              const time = typeof point?.time === 'number' ? point.time : NaN;
              return Number.isFinite(time)
                ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(time)
                : '';
            },
          } : {}),
        ...(options.xAxisLabelRotation === undefined ? {} : { rotation: options.xAxisLabelRotation }),
        ...(options.xAxisLabelDecimals === undefined ? {} : {
          formatter() {
            const numeric = Number(this.value);
            return Number.isFinite(numeric)
              ? numeric.toFixed(options.xAxisLabelDecimals)
              : String(this.value);
          },
        }),
        ...(
          options.tooltipMode === 'simulation-distribution'
          && options.valueUnit === 'percent'
            ? {
              formatter() {
                return formatPercentRatio(Number(this.value));
              },
            }
            : {}
        ),
        style: axisLabels,
      },
      plotLines: xPlotLines,
    },
    yAxis: {
      visible: !options.hideAxes,
      opposite: options.yAxisOpposite ?? false,
      minorTicks: false,
      ...(options.yAxisMin === undefined ? {} : { min: options.yAxisMin }),
      ...(options.yAxisMax === undefined ? {} : { max: options.yAxisMax }),
      ...(options.yAxisTickInterval === undefined ? {} : { tickInterval: options.yAxisTickInterval }),
      title: {
        text: options.yAxisTitle,
        style: axisTitle,
      },
      gridLineColor: compactAxes ? 'rgba(255,255,255,0.05)' : 'rgba(134, 138, 150, 0.16)',
      ...(options.yAxisGridLineWidth === undefined
        ? {}
        : { gridLineWidth: options.yAxisGridLineWidth }),
      labels: {
        formatter() {
          if (options.yAxisPercent) return formatPercentRatio(Number(this.value), 0);
          const ticks = this.axis.tickPositions;
          const tickInterval = this.axis.options.tickInterval
            ?? (ticks && ticks.length > 1 ? ticks[1] - ticks[0] : undefined);
          if (options.tooltipMode === 'performance-equity' || compactAxes || simulationAxes) {
            return formatPerformanceAxisValue(Number(this.value), compactAxes || simulationAxes,
              tickInterval);
          }
          return formatReportAxisValue(Number(this.value), options.valueUnit === 'currency', tickInterval);
        },
        style: axisLabels,
      },
      plotLines: yPlotLines,
    },
    tooltip: {
      // Report charts have no touch panning/zooming. Let a vertical gesture
      // scroll the Viewer; taps and keyboard point focus still show tooltips.
      followTouchMove: false,
      shared: options.tooltipMode === 'simulation-paths',
      valueDecimals: 2,
      style: { color: '#ffffff' },
      // Analysis hosts do not use the Performance/Dock tooltip CSS. Explicit
      // colors also keep SVG and HTML tooltips readable when Highcharts uses
      // its light default theme inside the dark workspace.
      ...(compactAxes || options.tooltipMode === 'performance-equity' || winrate ? {
        backgroundColor: '#1a1a1b',
        borderColor: 'rgba(255,255,255,0.1)',
      } : {}),
      ...(options.tooltipMode === 'simulation-paths'
        ? { headerFormat: '<span>Trade #{point.key}</span><br/>' }
        : options.tooltipMode === 'winrate'
        ? { headerFormat: '<span>{point.key}</span><br/>' }
        : options.tooltipMode
          ? { headerFormat: '' }
          : {}),
      ...(
        options.tooltipMode === 'duration-pnl'
        || options.tooltipMode === 'performance-equity'
        || options.tooltipMode === 'performance-bucket'
        || options.tooltipMode === 'simulation-paths'
        || options.tooltipMode === 'simulation-distribution'
          ? { useHTML: true }
          : {}
      ),
      ...(
        options.tooltipMode === 'simulation-paths'
        || options.tooltipMode === 'simulation-distribution'
          ? {
            backgroundColor: '#333333',
            borderColor: '#444444',
            style: { color: '#ffffff' },
          }
          : {}
      ),
      pointFormatter() {
        // A forming bar can update the source without recreating Highcharts.
        // Resolve the current descriptor so keyboard and pointer never show
        // an older ledger's value/time after a live report update.
        const livePoints = descriptors.get(host)?.tooltipPoints;
        const rawPoint = this.options.custom?.quantKeyboardPoint
          ? this.options.custom as unknown as ReportChartDataPoint
          : nearestRawPoint(livePoints, Number(this.x), !livePoints || sourceIsSorted(livePoints));
        const rawCustom = rawPoint;
        const rawValue = rawPoint && 'y' in rawPoint ? rawPoint.y : this.y;
        const custom = (this.options.custom ?? {}) as {
          category?: string;
          label?: string;
          from?: number;
          to?: number;
          direction?: string;
          time?: number | string | null;
          tradeNumber?: number;
          count?: number;
        };
        if (options.tooltipMode === 'performance-equity') {
          const time = tooltipTime(rawCustom?.time ?? custom.time ?? this.x);
          const value = compactTooltipCurrency(rawValue, options.currency);
          const number = rawCustom?.tradeNumber ?? custom.tradeNumber;
          const direction = rawCustom?.direction ?? custom.direction;
          const side = direction === 'long' ? 'Long' : direction === 'short' ? 'Short' : '';
          const color = direction === 'long' ? '#089981' : '#f23645';
          const pnlColor = typeof rawValue === 'number' && rawValue < 0 ? '#f23645' : '#089981';
          return `<div class="quant-backtest-equity-tooltip">`
            + (Number.isFinite(number) ? `<div class="quant-backtest-equity-tooltip-trade"><span>Trade #${escapeTooltip(number)}</span>`
              + (side ? `<span class="quant-backtest-equity-tooltip-direction" style="color:${color};background:${color}33">${side}</span>` : '') + `</div>` : '')
            + `<div class="quant-backtest-equity-tooltip-pnl"><span class="quant-backtest-analysis-tooltip-dot" style="background:${pnlColor}"></span>`
            + `<div><div class="quant-backtest-equity-tooltip-label">Cumulative P&amp;L</div><div class="quant-backtest-equity-tooltip-value">${escapeTooltip(value)}</div></div></div>`
            + (time ? `<div class="quant-backtest-equity-tooltip-time">${escapeTooltip(time)} (UTC)</div>` : '') + `</div>`;
        }
        if (options.tooltipMode === 'performance-bucket') {
          const category = rawCustom?.category ?? rawCustom?.label ?? custom.category ?? custom.label ?? this.name;
          const bucket = options.axis === 'category' ? escapeTooltip(category ?? this.x)
            : `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' }).format(new Date(this.x))} (UTC)`;
          const value = compactTooltipCurrency(rawValue, options.currency);
          const countValue = rawCustom?.count ?? custom.count;
          const count = Number.isFinite(countValue)
            ? `<div class="quant-backtest-bucket-tooltip-count">Trades: ${escapeTooltip(Math.round(countValue as number))}</div>`
            : '';
          const color = typeof rawValue === 'number' && rawValue < 0 ? '#f23645' : '#089981';
          return `<div class="quant-backtest-bucket-tooltip"><div class="quant-backtest-bucket-tooltip-date">${bucket}</div>`
            + `<div class="quant-backtest-bucket-tooltip-pnl"><span class="quant-backtest-bucket-tooltip-dot" style="background:${color}"></span>`
            + `<div><div class="quant-backtest-bucket-tooltip-label">${escapeTooltip(options.yAxisTitle ?? options.label)}</div>`
            + `<div class="quant-backtest-bucket-tooltip-value">${escapeTooltip(value)}</div></div></div>${count}</div>`;
        }
        if (options.tooltipMode === 'distribution') {
          const from = Number.isFinite(custom.from) ? Number(custom.from).toFixed(2) : '-';
          const to = Number.isFinite(custom.to) ? Number(custom.to).toFixed(2) : '-';
          return `<b>Interval:</b> ${escapeTooltip(from)} | ${escapeTooltip(to)}<br/><b>Trades:</b> ${escapeTooltip(this.y ?? '-')}`;
        }
        if (options.tooltipMode === 'winrate') {
          const name = String(custom.category ?? this.name ?? '').toLowerCase();
          return `<b>${escapeTooltip(name)}:</b> ${escapeTooltip(this.y ?? '-')}`;
        }
        if (options.tooltipMode === 'duration-pnl') {
          const time = tooltipTime(rawCustom?.time ?? custom.time);
          const directionValue = rawCustom?.direction ?? custom.direction;
          const direction = directionValue
            ? `${directionValue.charAt(0).toUpperCase()}${directionValue.slice(1)}`
            : '';
          const directionColor = directionValue === 'long'
            ? '#089981'
            : directionValue === 'short'
              ? '#f23645'
              : '#71717a';
          const directionBadge = direction
            ? `<span class="quant-backtest-analysis-tooltip-direction" style="color:${directionColor};background:${directionColor}33">${escapeTooltip(direction)}</span>`
            : '';
          // Legacy contract marker: `const pnlColor = typeof this.y === 'number' && this.y < 0`.
          // Use the raw source value when a visual point represents a sampled bucket.
          const pnlColor = typeof rawValue === 'number' && rawValue < 0 ? '#f23645' : '#089981';
          return `<div class="quant-backtest-analysis-tooltip">`
            + `<div class="quant-backtest-analysis-tooltip-trade"><span>Trade</span>${directionBadge}</div>`
            + `<div class="quant-backtest-analysis-tooltip-pnl">`
            + `<span class="quant-backtest-analysis-tooltip-dot" style="background:${pnlColor}"></span>`
            + `<div><div class="quant-backtest-analysis-tooltip-pnl-label">P&amp;L</div>`
            + `<strong>${escapeTooltip(compactTooltipCurrency(rawValue, options.currency))}</strong></div>`
            + `</div>`
            + (time ? `<div class="quant-backtest-analysis-tooltip-time">${escapeTooltip(time)} (UTC)</div>` : '')
            + `</div>`;
        }
        if (options.tooltipMode === 'simulation-paths') {
          const rangePoint = this as HighchartsNamespace.Point & {
            low?: number;
            high?: number;
          };
          const value = Number.isFinite(rangePoint.low) && Number.isFinite(rangePoint.high)
            ? `${formatSimulationPathValue(rangePoint.low, options.valueUnit)}`
              + ` – ${formatSimulationPathValue(rangePoint.high, options.valueUnit)}`
            : formatSimulationPathValue(this.y, options.valueUnit);
          return `<span style="color:${escapeTooltip(this.color ?? '#2962ff')}">●</span> `
            + `${escapeTooltip(this.series.name)}: <b>${escapeTooltip(value)}</b><br/>`;
        }
        if (options.tooltipMode === 'simulation-distribution') {
          if (Number.isFinite(custom.from) && Number.isFinite(custom.to)) {
            const from = formatSimulationValue(custom.from, options.valueUnit, options.currency);
            const to = formatSimulationValue(custom.to, options.valueUnit, options.currency);
            const count = Number.isFinite(custom.count) ? custom.count : this.y;
            return `${escapeTooltip(from)} to ${escapeTooltip(to)}`
              + `<br/><b>${escapeTooltip(formatSimulationValue(count, 'count', undefined))}</b> runs`;
          }
          const outcome = formatSimulationValue(rawPoint?.x ?? this.x, options.valueUnit, options.currency);
          return `≤ ${escapeTooltip(outcome)}`
            + `<br/><b>${escapeTooltip(formatPercentRatio(this.y, 1))}</b> of runs`;
        }
        const label = escapeTooltip(rawCustom?.label ?? custom.label ?? '');
        return `<b>${escapeTooltip(rawValue ?? '—')}</b>${label ? ` <span>${label}</span>` : ''}`;
      },
    },
    plotOptions: {
      series: {
        animation: false,
        turboThreshold: 0,
        marker: { enabled: pointCount <= 48, radius: 2 },
      },
      column: {
        borderWidth: 0,
        borderRadius: options.columnBorderRadius ?? 2,
        ...(options.columnGroupPadding === undefined ? {} : { groupPadding: options.columnGroupPadding }),
        ...(options.columnPointPadding === undefined ? {} : { pointPadding: options.columnPointPadding }),
        ...(options.columnPointRange === undefined ? {} : { pointRange: options.columnPointRange }),
        threshold: 0,
        color: options.positiveColor ?? '#089981',
        negativeColor: options.negativeColor ?? '#f23645',
      },
      pie: {
        borderWidth: 0,
        dataLabels: { enabled: false },
        ...(winrate ? { size: '100%', center: ['50%', '50%'], showInLegend: true } : {}),
      },
      scatter: {
        marker: { enabled: true, radius: 4, symbol: 'circle' },
      },
    },
    series: highchartsSeries,
  });
  Highcharts.addEvent(chart, 'destroy', () => {
    curveKeyboards.get(chart)?.dispose();
    curveKeyboards.delete(chart);
  });
  applyChartAccessibility(host, options.label);
  applyChartPointAccessibility(chart, options);

  if (!isCurrent(host, generation) || !connected(host)) {
    try {
      chart.destroy();
    } catch {
      // The host may have been detached between the stale check and chart
      // creation. The next render/cleanup will still invalidate its record.
    }
    return () => undefined;
  }

  const view = host.ownerDocument.defaultView;
  let observer: ResizeObserver | undefined;
  try {
    observer = view && 'ResizeObserver' in view
      ? new view.ResizeObserver((entries) => {
          // Resize notifications can already be queued when a Viewer tab is
          // replaced.  Highcharts More keeps axis hooks that assume the chart
          // is still fully attached; calling reflow on a destroyed/stale
          // chart can therefore throw (notably `pane.hasSeriesType`).  Bind
          // the callback to this host generation and live record so a queued
          // notification becomes a no-op after teardown.
          if (
            !isCurrent(host, generation)
            || !connected(host)
            || records.get(host)?.chart !== chart
          ) return;
          const record = records.get(host);
          const entry = entries[0];
          const width = entry?.contentRect.width ?? host.getBoundingClientRect().width;
          const height = entry?.contentRect.height ?? host.getBoundingClientRect().height;
          // Highcharts can mutate SVG/text metrics while handling a tooltip or
          // reflow. Ignore notifications that report the same rounded box;
          // otherwise ResizeObserver feeds a reflow -> notification loop and
          // the Dock chart appears to breathe even though its layout is stable.
          if (record && Math.abs((record.lastWidth ?? -1) - width) < 0.5
            && Math.abs((record.lastHeight ?? -1) - height) < 0.5) return;
          if (record) {
            record.lastWidth = width;
            record.lastHeight = height;
          }
          if (reportChartReflowSuspendDepth > 0) {
            pendingReportChartReflows.add(host);
            return;
          }
          reflowReportChart(host);
        })
      : undefined;
    observer?.observe(host);
  } catch (error) {
    try {
      chart.destroy();
    } catch {
      // Preserve the original observer/setup error while still attempting to
      // release the chart's event hooks.
    }
    throw error;
  }
  const initialRect = host.getBoundingClientRect();
  const record: ChartRecord = {
    chart,
    lastWidth: initialRect.width,
    lastHeight: initialRect.height,
    ...(observer ? { observer } : {}),
  };
  records.set(host, record);
  reportChartHosts.add(host);
  activeChartCount += 1;
  if (observer) activeObserverCount += 1;
  return () => {
    if (records.get(host) === record && isCurrent(host, generation)) destroyReportChart(host);
  };
}

function disposeRecord(host: HTMLElement): void {
  reportChartHosts.delete(host);
  pendingReportChartReflows.delete(host);
  const record = records.get(host);
  if (!record) return;
  record.observer?.disconnect();
  if (record.observer) activeObserverCount = Math.max(0, activeObserverCount - 1);
  try {
    curveKeyboards.get(record.chart)?.dispose();
    curveKeyboards.delete(record.chart);
    record.chart.destroy();
  } catch {
    // A browser can tear down an SVG/document while a chart is being
    // replaced. Cleanup remains best effort and must never block the report
    // fallback or the rest of the workspace from rendering.
  } finally {
    activeChartCount = Math.max(0, activeChartCount - 1);
    records.delete(host);
  }
}

export function destroyReportChart(host: HTMLElement): void {
  nextGeneration(host);
  disposeRecord(host);
}

/** Dismiss owned pointer tooltips before Escape closes their report surface. */
export function dismissReportChartTooltips(root: HTMLElement): boolean {
  let dismissed = false;
  const hosts = [
    ...(root.matches('[data-quant-report-chart]') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('[data-quant-report-chart]'),
  ];
  for (const host of hosts) {
    const chart = records.get(host)?.chart;
    // Highcharts 13 exposes this runtime state, but omits it from Tooltip's
    // public declarations. A missing/destroyed tooltip must not consume Escape.
    const tooltip = chart?.tooltip as (HighchartsNamespace.Tooltip & { isHidden?: boolean }) | undefined;
    if (!chart || !tooltip || tooltip.isHidden !== false) continue;
    chart.pointer.reset(false, 0);
    tooltip.hide(0);
    const keyboard = curveKeyboards.get(chart);
    if (keyboard) {
      keyboard.active = false;
      keyboard.marker?.hide();
      keyboard.status.textContent = '';
    }
    dismissed = true;
  }
  return dismissed;
}

export function destroyReportCharts(root: HTMLElement): void {
  const hosts = [
    ...(root.matches('[data-quant-report-chart]') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('[data-quant-report-chart]'),
  ];
  hosts.forEach((host) => {
    destroyReportChart(host);
  });
}

/** Upgrade all registered fallback hosts below a rendered report panel. */
export async function enhanceReportCharts(root: HTMLElement): Promise<void> {
  const hosts = [
    ...(root.matches('[data-quant-report-chart]') ? [root] : []),
    ...root.querySelectorAll<HTMLElement>('[data-quant-report-chart]'),
  ];
  await Promise.all(hosts.map(async (host) => {
    const options = descriptors.get(host);
    if (!options) return;
    // Highcharts normally fails before touching the host, but retain a clone
    // so a browser/SVG edge case cannot leave an empty frame after a partial
    // constructor failure.
    const fallbackChildren = [...host.childNodes].map((node) => node.cloneNode(true));
    try {
      await enhanceReportChart(host, options);
    } catch {
      // The SVG fallback is intentionally left untouched when a local
      // Highcharts chunk cannot load or the browser cannot create an SVG.
      host.replaceChildren(...fallbackChildren);
    }
  }));
}
