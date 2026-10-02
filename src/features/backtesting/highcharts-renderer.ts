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
  readonly height?: number;
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
  host.setAttribute('role', 'img');
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
        record.chart.yAxis[0].setExtremes(Math.min(...values), Math.max(...values), false);
      }
    }
    record.chart.redraw(false);
    descriptors.set(host, options);
    applyChartAccessibility(host, options.label);
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

export function unregisterReportChart(host: HTMLElement): void {
  descriptors.delete(host);
  host.removeAttribute('data-quant-report-chart');
  host.removeAttribute('role');
  host.removeAttribute('aria-label');
  destroyReportChart(host);
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
    day: 'numeric',
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
  const compact = magnitude >= 1_000_000_000
    ? `${(normalized / 1_000_000_000).toFixed(1)}b`
    : magnitude >= 1_000_000
      ? `${(normalized / 1_000_000).toFixed(1)}m`
      : magnitude >= 1_000
        ? `${(normalized / 1_000).toFixed(1)}k`
        : normalized.toLocaleString('en-US', { maximumFractionDigits: 2 });
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
  const tooltipPointsSorted = !tooltipPoints
    || tooltipPoints.every((point, index) => index === 0 || point.x >= tooltipPoints[index - 1].x);
  const pointCount = normalizedSeries.reduce((count, series) => count + series.points.length, 0);
  if (pointCount === 0) return () => undefined;
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
    ...(options.showZeroLine === false
      ? []
      : [{ value: 0, color: 'rgba(134, 138, 150, 0.3)', width: 1, zIndex: 2 }]),
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
    chart: {
      type: options.kind,
      backgroundColor: 'transparent',
      animation: false,
      // The generation-bound observer below is the single resize owner.
      // Highcharts' own observer bypasses our drag suspension/deduplication.
      reflow: false,
      height: options.height ?? 180,
      spacing: options.chartSpacing ? [...options.chartSpacing] : [8, 8, 8, 8],
    },
    accessibility: {
      // The optional Highcharts accessibility module is intentionally not in
      // this local lazy chunk. Enabling it without the module emits warning
      // #19; the host and generated SVG receive their role/name/description
      // from registerReportChart/applyChartAccessibility below instead.
      enabled: false,
    },
    credits: { enabled: false },
    title: { text: undefined },
    legend: { enabled: options.legend ?? false },
    xAxis: {
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
        style: { color: 'var(--vela-fg-muted, #868a96)' },
      },
      lineColor: 'transparent',
      tickColor: options.xAxisTickColor ?? 'transparent',
      labels: {
        ...(options.tooltipMode === 'performance-equity'
          && tooltipPoints?.some((point) => point.tradeNumber !== undefined) ? {
            formatter() {
              const point = tooltipPoints[Math.round(Number(this.value))];
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
        style: { color: 'var(--vela-fg-muted, #868a96)' },
      },
      plotLines: xPlotLines,
    },
    yAxis: {
      opposite: options.yAxisOpposite ?? false,
      minorTicks: false,
      ...(options.yAxisMin === undefined ? {} : { min: options.yAxisMin }),
      ...(options.yAxisMax === undefined ? {} : { max: options.yAxisMax }),
      ...(options.yAxisTickInterval === undefined ? {} : { tickInterval: options.yAxisTickInterval }),
      title: {
        text: options.yAxisTitle,
        style: { color: 'var(--vela-fg-muted, #868a96)' },
      },
      gridLineColor: 'rgba(134, 138, 150, 0.16)',
      ...(options.yAxisGridLineWidth === undefined
        ? {}
        : { gridLineWidth: options.yAxisGridLineWidth }),
      labels: {
        formatter() {
          if (options.yAxisPercent) return formatPercentRatio(Number(this.value), 0);
          return formatReportAxisValue(Number(this.value), options.valueUnit === 'currency'
            || options.tooltipMode === 'performance-equity' || options.tooltipMode === 'performance-bucket',
          this.axis.options.tickInterval ?? (this.axis.tickPositions
            && this.axis.tickPositions.length > 1
            ? this.axis.tickPositions[1] - this.axis.tickPositions[0] : undefined));
        },
        style: { color: 'var(--vela-fg-muted, #868a96)' },
      },
      plotLines: yPlotLines,
    },
    tooltip: {
      shared: options.tooltipMode === 'simulation-paths',
      valueDecimals: 2,
      style: { color: '#ffffff' },
      ...(options.tooltipMode === 'simulation-paths'
        ? { headerFormat: '<span>Trade #{point.key}</span><br/>' }
        : options.tooltipMode === 'winrate'
        ? { headerFormat: '<span>{point.key}</span><br/>' }
        : options.tooltipMode
          ? { headerFormat: '' }
          : {}),
      ...(
        options.tooltipMode === 'duration-pnl'
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
        const rawPoint = nearestRawPoint(tooltipPoints, Number(this.x), tooltipPointsSorted);
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
          return `${Number.isFinite(number) ? `<span>Trade #${escapeTooltip(number)}</span>${side ? ` <span style="color:${color}">${side}</span>` : ''}<br/>` : ''}`
            + `<span style="color:#71717a;font-size:11px">Cumulative P&amp;L</span><br/>`
            + `<b>${escapeTooltip(value)}</b>`
            + `${time ? `<br/><span style="color:#a1a1aa;font-size:11px">${escapeTooltip(time)} (UTC)</span>` : ''}`;
        }
        if (options.tooltipMode === 'performance-bucket') {
          const bucket = escapeTooltip(rawCustom?.category ?? rawCustom?.label ?? custom.category ?? custom.label ?? this.name ?? this.x);
          const value = compactTooltipCurrency(rawValue, options.currency);
          const countValue = rawCustom?.count ?? custom.count;
          const count = Number.isFinite(countValue)
            ? `<br/><span style="color:#71717a;font-size:11px">Trades: ${escapeTooltip(Math.round(countValue as number))}</span>`
            : '';
          return `<span style="color:#a1a1aa;font-size:11px">${bucket}</span><br/>`
            + `<span style="color:#71717a;font-size:11px">${escapeTooltip(options.yAxisTitle ?? options.label)}</span><br/>`
            + `<b>${escapeTooltip(value)}</b>${count}`;
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
            ? `<span class="quant-backtest-analysis-tooltip-direction" style="color:${directionColor};border-color:${directionColor};background:${directionColor}1f">${escapeTooltip(direction)}</span>`
            : '';
          // Legacy contract marker: `const pnlColor = typeof this.y === 'number' && this.y < 0`.
          // Use the raw source value when a visual point represents a sampled bucket.
          const pnlColor = typeof rawValue === 'number' && rawValue < 0 ? '#f23645' : '#089981';
          return `<div class="quant-backtest-analysis-tooltip">`
            + `<div class="quant-backtest-analysis-tooltip-trade"><span>Trade</span>${directionBadge}</div>`
            + `<div class="quant-backtest-analysis-tooltip-pnl">`
            + `<span class="quant-backtest-analysis-tooltip-dot" style="background:${pnlColor}"></span>`
            + `<span class="quant-backtest-analysis-tooltip-pnl-label">P&amp;L</span>`
            + `<strong>${escapeTooltip(compactTooltipCurrency(rawValue, options.currency))}</strong>`
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
      },
      scatter: {
        marker: { enabled: true, radius: 4, symbol: 'circle' },
      },
    },
    series: highchartsSeries,
  });
  applyChartAccessibility(host, options.label);

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
