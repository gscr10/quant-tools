import { backtestIcon as icon, backtestIconMarkup } from './backtest-icons.ts';
import {
  type BacktestComparison,
  type BacktestMetricValue,
  type BacktestPoint,
  type BacktestReport,
  type BacktestTab,
  type BacktestTrade,
  type BacktestViewerCallbacks,
} from './backtest-types.ts';
import { localAssetGeometry, localAssetTicker } from '../../shared/asset-logos.ts';
import {
  backtestTradeDisplayNumber,
  backtestTradeExcursionValue,
  backtestTradePriceDigits,
  backtestTradeSizeValue,
  backtestTradesHaveExcursions,
  backtestTradesHaveSize,
  DEFAULT_TRADE_SORT,
  formatBacktestTradeMetric,
  getBacktestTradeWindow,
  isBacktestTradeLocationTime,
  nextBacktestTradeSort,
  sortBacktestTradeEntries,
  type BacktestTradeSort,
  type BacktestTradeEntry,
  type BacktestTradeSortKey,
} from './trade-log.ts';
import {
  destroyReportCharts,
  dismissReportChartTooltips,
  enhanceReportCharts,
  registerReportChart,
  updateReportChartPoints,
  type ReportChartAxis,
  type ReportChartPoint,
  type ReportChartTooltipMode,
} from './highcharts-renderer.ts';
import { currentCalendarMonthKey, isCalendarMonthKey } from '../../shared/calendar.ts';
import { normalizeCalendarTimezone } from '../../domain/calendar.ts';
import { renderBacktestTradeCalendar } from './trade-calendar-view.ts';
import {
  formatBacktestCurrency,
  formatBacktestPerformanceValue,
  formatBacktestRange,
  formatExecutionPrecision,
} from './backtest-format.ts';
import {
  aggregateBacktestTradeCalendar,
  shouldResetBacktestTradeCalendar,
  type BacktestTradeCalendarDay,
} from './trade-calendar.ts';
import { renderTradeAnalysisView } from './trade-analysis-view.ts';
import { renderSimulationView } from './simulation-view.ts';
import { downsampleReportChartPoints } from './chart-sampling.ts';

const TABS: ReadonlyArray<{ id: BacktestTab; label: string }> = [
  { id: 'performance', label: 'Performance' },
  { id: 'analysis', label: 'Trades Analysis' },
  { id: 'log', label: 'Trades Log' },
  { id: 'simulation', label: 'Simulation' },
];

const COMPARISON_COLUMNS: ReadonlyArray<{ id: keyof BacktestComparison; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'long', label: 'Long' },
  { id: 'short', label: 'Short' },
];

const TRADE_EXCURSION_TOOLTIPS = Object.freeze({
  mfe: 'Maximum favorable excursion',
  mae: 'Maximum adverse excursion',
});

type MetricRow = { key: string; label: string; unit?: string; group?: string };

const PERFORMANCE_ROWS: ReadonlyArray<MetricRow> = [
  { key: 'netProfit', label: 'Net Profit', unit: 'currency' },
  { key: 'cagr', label: 'CAGR', unit: '%' },
  { key: 'grossProfit', label: 'Gross Profit', unit: 'currency' },
  { key: 'grossLoss', label: 'Gross Loss', unit: 'currency' },
  { key: 'profitFactor', label: 'Profit Factor' },
  { key: 'averagePnlPerDay', label: 'Average P&L per Day', unit: 'currency' },
  { key: 'averagePnlPerWeek', label: 'Average P&L per Week', unit: 'currency' },
  { key: 'drawdown', label: 'Drawdown' },
  { key: 'calmar', label: 'Calmar Ratio', unit: 'ratio', group: 'Risk-Adjusted Performance' },
  { key: 'sharpe', label: 'Sharpe Ratio', unit: 'ratio', group: 'Risk-Adjusted Performance' },
  { key: 'sortino', label: 'Sortino Ratio', unit: 'ratio', group: 'Risk-Adjusted Performance' },
  { key: 'buyAndHoldPnl', label: 'Buy and Hold PnL', unit: 'currency', group: 'Benchmark' },
  { key: 'buyAndHoldPercent', label: 'Buy and Hold % Gain', unit: '%', group: 'Benchmark' },
  { key: 'strategyOutperformance', label: 'Strategy Outperformance', unit: 'currency', group: 'Benchmark' },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

function createElement<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  return element;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

function button(doc: Document, label: string, className: string): HTMLButtonElement {
  const element = createElement(doc, 'button', className);
  element.type = 'button';
  element.textContent = label;
  return element;
}

/**
 * Escape values before inserting the bounded Trades Log page through
 * `innerHTML`.  Trade values are normally numeric, but malformed/provider
 * fixtures may contain strings and must never become markup.
 */
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** The only SVG used by the fast Trades Log row template. */
const CROSSHAIR_ICON_MARKUP = backtestIconMarkup('crosshair', 14);

function focusableElements(root: HTMLElement): HTMLElement[] {
  const view = root.ownerDocument.defaultView;
  return [...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((node) => {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    // Preserve roving-tabindex semantics. The selector includes ordinary
    // buttons for convenience, but inactive report/settings tabs use
    // tabIndex=-1 and must not be pulled into the programmatic Tab loop.
    if (node.tabIndex < 0) return false;
    for (let current: HTMLElement | null = node; current; current = current.parentElement) {
      if (current.hidden || current.inert || current.getAttribute('aria-hidden') === 'true') {
        return false;
      }
      if (view) {
        const style = view.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      if (current === root) break;
    }
    return true;
  });
}

function unwrapMetric(value: BacktestMetricValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  return typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : null;
}

function metricValue(report: BacktestReport, key: string): number | null {
  const value = report.metrics?.[key] ?? report.summary?.[key];
  return unwrapMetric(value);
}

function formatNumber(value: number | null, digits = 2): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const rounded = Object.is(value, -0) ? 0 : value;
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMetric(
  value: BacktestMetricValue | undefined,
  unit?: string,
  signed = false,
  digits = unit === 'count' ? 0 : unit === 'ratio' ? 3 : 2,
): string {
  const number = unwrapMetric(value);
  if (number === null) return '—';
  const sign = signed && number > 0 ? '+' : '';
  const suffix = unit === '%' ? '%' : unit && unit !== 'count' && unit !== 'ratio' ? ` ${unit}` : '';
  const formatted = unit && unit !== '%' && unit !== 'count' && unit !== 'ratio'
    ? formatBacktestCurrency(number)
    : formatNumber(number, digits);
  return `${sign}${formatted}${suffix}`;
}

function formatTradeDateTime(
  value: number | string | null | undefined,
  timezone = 'UTC',
): string {
  if (value === null || value === undefined || value === '') return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  // `Date#toLocaleString` constructs an Intl formatter on every call in
  // several Chromium versions.  A 200-row page formats 400 timestamps, so
  // retaining one formatter materially lowers page-turn latency without
  // changing the reference's locale/UTC output contract.
  const normalizedTimezone = normalizeCalendarTimezone(timezone);
  let formatter = tradeDateTimeFormatters.get(normalizedTimezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      // Keep UTC as the literal fallback contract while honoring a valid
      // report timezone for non-UTC workspaces and DST boundaries.
      // Fallback option remains `timeZone: 'UTC'` for legacy reports.
      timeZone: normalizedTimezone || 'UTC',
    });
    tradeDateTimeFormatters.set(normalizedTimezone, formatter);
  }
  // Equivalent legacy contract: `date.toLocaleString(undefined, options)`.
  return formatter.format(date);
}

const tradeDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatTradePrice(value: number | null | undefined, currency: string): string {
  const normalizedCurrency = currency.toUpperCase();
  if (typeof value !== 'number' || !Number.isFinite(value)) return `N/A ${normalizedCurrency}`;
  const digits = backtestTradePriceDigits(value);
  const normalizedValue = Object.is(value, -0) ? 0 : value;
  let formatter = tradePriceFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    tradePriceFormatters.set(digits, formatter);
  }
  return `${formatter.format(normalizedValue)} ${normalizedCurrency}`;
}

const tradePriceFormatters = new Map<number, Intl.NumberFormat>();

/** Keep account units smaller than amounts without changing the readable
 * plain-text price/metric contract used by copying and assistive tooling. */
function tradeMoneyMarkup(formatted: string, currency: string): string {
  const suffix = ` ${currency}`;
  if (!formatted.endsWith(suffix)) return escapeHtml(formatted);
  return `${escapeHtml(formatted.slice(0, -suffix.length))}`
    + '<span class="quant-backtest-trade-money-gap"> </span>'
    + `<span class="quant-backtest-trade-currency">${escapeHtml(currency)}</span>`;
}

function reportCurrency(report: BacktestReport): string {
  // Provider/account payloads are not required to use a canonical case. Keep
  // every Viewer surface (metric suffixes, table cells, chart axes and the
  // KPI unit split) on one display contract so a `usd` payload cannot render
  // as `12.00 usd` in one place and `USD` in another.
  return report.currency?.trim().toUpperCase() || 'USD';
}

/**
 * LuxAlgo's report header uses a display-oriented USD pair label while the
 * chart/provider keeps the exchange symbol intact (for example BTCUSDT and
 * ETHUSDT become BTCUSD and ETHUSD; BTC-USD also becomes BTCUSD). Keep this
 * normalization in the Viewer only so report identity, Provider requests and
 * engine provenance continue to expose the original symbol.
 */
function normalizeReportMarketSymbol(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  const withoutPerpetualSuffix = raw.replace(/\.P$/i, '');
  const compact = withoutPerpetualSuffix.replace(/[\s:_\-/]/g, '');
  const upper = compact.toUpperCase();
  if (!/^[A-Z0-9]+(?:USD|USDT|USDC)$/.test(upper)) return raw;
  if (upper.endsWith('USDT') || upper.endsWith('USDC')) {
    return `${upper.slice(0, -4)}USD`;
  }
  return upper;
}

function reportDisplaySymbol(report: BacktestReport): string {
  const explicit = report.displaySymbol?.trim();
  if (explicit && explicit.toLowerCase() !== 'unknown') {
    return normalizeReportMarketSymbol(explicit);
  }
  const symbol = report.symbol?.trim() ?? '';
  const separator = symbol.indexOf(':');
  const result = (separator >= 0 ? symbol.slice(separator + 1) : symbol).trim();
  return result.toLowerCase() === 'unknown' ? '' : normalizeReportMarketSymbol(result);
}

function reportTimeframeLabel(report: BacktestReport): string {
  const raw = report.timeframe?.trim() ?? '';
  if (!raw || raw.toLowerCase() === 'unknown') return '';
  if (/^[0-9]+(?:\.[0-9]+)?$/.test(raw)) {
    const minutes = Number(raw);
    if (minutes >= 1_440 && minutes % 1_440 === 0) return `${minutes / 1_440}D`;
    if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
    return `${raw}m`;
  }
  const normalized = raw.toUpperCase();
  if (normalized === 'D') return '1D';
  if (normalized === 'W') return '1W';
  if (normalized === 'M') return '1M';
  return raw;
}

/** Normalize adapter-provided display timezones before formatting log rows. */
function reportTimezone(report: BacktestReport): string {
  return normalizeCalendarTimezone(report.timezone);
}

function reportAssetLabel(report: BacktestReport): string {
  const symbol = reportDisplaySymbol(report).toUpperCase();
  const asset = localAssetTicker(symbol);
  if (asset === 'BTC') return '₿';
  if (asset === 'ETH') return 'Ξ';
  return symbol.replace(/[^A-Z0-9]/g, '').slice(0, 2) || '•';
}

/** Small local asset mark matching the reference's circular market identity.
 * It intentionally uses inline SVG so report rendering never reaches a remote
 * logo host (and keeps the mark crisp at the 20px header size). */
let nextAssetLogoId = 0;

function assetLogo(doc: Document, asset: string): SVGSVGElement {
  const svg = createSvgElement(doc, 'svg');
  // Use the same local vector marks as the reference symbol identity instead
  // of rendering a text glyph (font metrics make the old ₿/Ξ approximation
  // visibly different across browsers).
  svg.setAttribute('viewBox', '0 0 56 56');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const background = createSvgElement(doc, 'rect');
  const geometry = asset === '₿' || asset === 'Ξ'
    ? localAssetGeometry(asset === '₿' ? 'BTC' : 'ETH') : null;
  background.setAttribute('width', '56'); background.setAttribute('height', '56');
  background.setAttribute('fill', geometry?.background ?? '#292b32');
  svg.appendChild(background);
  if (geometry?.stops.length) {
    const defs = createSvgElement(doc, 'defs');
    const gradient = createSvgElement(doc, 'linearGradient');
    const gradientId = `quant-eth-gradient-${++nextAssetLogoId}`;
    gradient.setAttribute('id', gradientId);
    gradient.setAttribute('x1', '0'); gradient.setAttribute('y1', '0');
    gradient.setAttribute('x2', '0'); gradient.setAttribute('y2', '1');
    geometry.stops.forEach(([offset, color]) => {
      const stop = createSvgElement(doc, 'stop');
      stop.setAttribute('offset', offset); stop.setAttribute('stop-color', color); gradient.appendChild(stop);
    });
    defs.appendChild(gradient); svg.appendChild(defs);
    background.setAttribute('fill', `url(#${gradientId})`);
  }
  geometry?.paths.forEach(([d, fill, rule]) => {
    const mark = createSvgElement(doc, 'path');
    mark.setAttribute('d', d); mark.setAttribute('fill', fill);
    if (rule) mark.setAttribute('fill-rule', rule);
    svg.appendChild(mark);
  });
  if (!geometry) {
    // Unknown symbols still need a useful local identity.  A neutral initials
    // badge is deterministic, has no network dependency, and keeps the
    // header legible when a provider has no asset vector.
    const fallback = createSvgElement(doc, 'text');
    fallback.setAttribute('x', '28');
    fallback.setAttribute('y', '29');
    fallback.setAttribute('text-anchor', 'middle');
    fallback.setAttribute('dominant-baseline', 'middle');
    fallback.setAttribute('fill', 'currentColor');
    fallback.setAttribute('font-family', 'system-ui, sans-serif');
    fallback.setAttribute('font-size', asset.length > 1 ? '18' : '22');
    fallback.setAttribute('font-weight', '650');
    fallback.textContent = asset.trim().slice(0, 2).toUpperCase() || '•';
    svg.appendChild(fallback);
  }
  return svg;
}

/**
 * Live Pine reports can publish several snapshots while the current bar is
 * forming.  Rebuilding the whole Viewer for snapshots that cannot change a
 * visible chart causes Highcharts to be destroyed/recreated and appears as a
 * persistent flash. Keep this signature limited to rendered chart data; open
 * mark-to-market updates are intentionally not a reason to tear down a chart.
 */
function reportChartSignature(report: BacktestReport | null): string {
  if (!report) return 'empty';
  const pointSignature = (points: readonly BacktestPoint[] | undefined): unknown => points?.map((point) => [
    point.x,
    point.y,
    point.from,
    point.to,
    point.color,
    point.label,
    point.time,
    point.tradeNumber,
  ]) ?? null;
  return JSON.stringify([
    report.cumulativePnlSource,
    pointSignature(report.cumulativePnl),
    pointSignature(report.netDailyPnl),
    pointSignature(report.weekdayPerformance),
    report.analysis,
    report.comparison,
    report.simulationRun,
    report.simulation,
  ]);
}

/**
 * Forming-bar snapshots can update the mark-to-market KPI without changing
 * any plotted point (for example when the engine emits a scalar-only
 * revision). Keep this signature separate from chart data so those values
 * are refreshed in place instead of leaving stale Performance KPIs visible.
 */
function reportPerformanceKpiSignature(report: BacktestReport | null): string {
  if (!report) return 'empty';
  return JSON.stringify([
    report.metrics ?? null,
    report.summary ?? null,
    report.analysis?.winRateBreakdown ?? null,
  ]);
}

function isTransientReportStatus(status: BacktestReport['status'] | undefined): boolean {
  return status === 'compiling' || status === 'computing' || status === 'updating';
}

function isPendingReportStatus(status: BacktestReport['status'] | undefined): boolean {
  return status === 'loading' || status === 'waiting-data' || status === 'partial'
    || isTransientReportStatus(status);
}

function isTerminalReportStatus(status: BacktestReport['status'] | undefined): boolean {
  return status === 'error'
    || status === 'no-data'
    || status === 'no-trades'
    || status === 'open-only'
    || status === 'suspended';
}

function toneFor(value: number | null): string {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}

function performanceMetricTone(key: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'neutral';
  if (key === 'profitFactor') return value > 1 ? 'positive' : 'negative';
  if (key === 'netProfit'
    || key === 'averagePnlPerDay'
    || key === 'averagePnlPerWeek'
    || key === 'buyAndHoldPnl'
    || key === 'buyAndHoldPercent'
    || key === 'strategyOutperformance') {
    return value > 0 ? 'positive' : 'negative';
  }
  if (key === 'calmar' || key === 'sharpe' || key === 'sortino') return toneFor(value);
  return 'neutral';
}

interface RenderChartData {
  readonly values: Array<{ x: number; y: number; label?: string; count?: number }>;
  readonly axis: ReportChartAxis;
  readonly categories?: readonly string[];
  readonly reportPoints: readonly ReportChartPoint[];
  readonly tooltipPoints: readonly ReportChartPoint[];
}

const MAX_RENDER_CHART_POINTS = 2_000;
const TRADES_PAGE_SIZE = 200;

function chartData(points: readonly BacktestPoint[] | undefined): RenderChartData {
  const countFromLabel = (label: string | undefined): number | undefined => {
    const match = label?.match(/^(\d+)\s+trades?$/i);
    return match ? Number(match[1]) : undefined;
  };
  const source = (points ?? []).flatMap((point, index) => {
    if (point.y === null || !Number.isFinite(point.y)) return [];
    return [{
      sourceX: point.x,
      index,
      y: point.y,
      detail: point.label,
      count: point.count ?? countFromLabel(point.label),
      time: point.time,
      direction: point.direction,
      tradeNumber: point.tradeNumber,
    }];
  });
  const stringPoints = source.filter((point) => typeof point.sourceX === 'string');
  const dateBuckets = stringPoints.length === source.length
    && stringPoints.length > 0
    && stringPoints.every((point) => /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(point.sourceX)));
  if (dateBuckets) {
    const tooltipPoints = source.map((point) => ({
      x: Number.isFinite(Date.parse(String(point.sourceX)))
        ? Date.parse(String(point.sourceX))
        : point.index,
      y: point.y,
      category: String(point.sourceX),
      label: point.detail,
      count: point.count,
    }));
    const reportPoints = downsampleReportChartPoints(tooltipPoints, MAX_RENDER_CHART_POINTS);
    return {
      values: reportPoints,
      axis: 'datetime',
      reportPoints,
      tooltipPoints,
    };
  }
  const categorical = stringPoints.length > 0;
  if (categorical) {
    const categories: string[] = [];
    const tooltipPoints = source.map((point) => {
      const category = String(point.sourceX);
      if (!categories.includes(category)) categories.push(category);
      return {
        x: categories.indexOf(category),
        y: point.y,
        category,
        label: point.detail ?? category,
        count: point.count,
      };
    });
    const reportPoints = downsampleReportChartPoints(tooltipPoints, MAX_RENDER_CHART_POINTS);
    return {
      values: reportPoints.map((point) => ({ x: point.x, y: point.y, label: point.label, count: point.count })),
      axis: 'category',
      categories,
      reportPoints,
      tooltipPoints,
    };
  }
  const tooltipPoints = source.map((point) => ({
    x: typeof point.sourceX === 'number' && Number.isFinite(point.sourceX) ? point.sourceX : point.index,
    y: point.y,
    label: point.detail,
    count: point.count,
    time: point.time,
    direction: point.direction,
    tradeNumber: point.tradeNumber,
  }));
  const reportPoints = downsampleReportChartPoints(tooltipPoints, MAX_RENDER_CHART_POINTS);
  const axis: ReportChartAxis = tooltipPoints.some((point) => Math.abs(point.x) >= 1e11)
    ? 'datetime'
    : 'linear';
  return {
    values: reportPoints,
    axis,
    reportPoints,
    tooltipPoints,
  };
}

function renderEmpty(doc: Document, message: string): HTMLElement {
  const empty = createElement(doc, 'div', 'quant-backtest-empty');
  empty.textContent = message;
  return empty;
}

/**
 * Mark transient report states as a single, atomic announcement region.
 *
 * The Viewer replaces its panel subtree whenever a run changes state. Without
 * an explicit live region, screen readers usually miss the transition from
 * compiling → ready/error (and may read a partially replaced subtree). Keep
 * the semantics on the state container so the visual layout and the existing
 * retry/focus behavior remain unchanged.
 */
function markStatusRegion(
  element: HTMLElement,
  politeness: 'polite' | 'assertive' = 'polite',
): void {
  element.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
  element.setAttribute('aria-live', politeness);
  element.setAttribute('aria-atomic', 'true');
}

function renderMiniChart(
  doc: Document,
  points: readonly BacktestPoint[] | undefined,
  mode: 'line' | 'bar' | 'area' = 'line',
  label = 'Chart',
  options: {
    readonly height?: number;
    readonly currency?: string;
    readonly tooltipMode?: ReportChartTooltipMode;
    readonly yAxisTitle?: string;
    readonly positiveColor?: string;
    readonly negativeColor?: string;
    readonly lineColor?: string;
    readonly yAxisOpposite?: boolean;
  } = {},
): HTMLElement {
  const frame = createElement(doc, 'div', 'quant-backtest-chart-frame');
  const title = createElement(doc, 'span', 'quant-backtest-chart-label');
  title.textContent = label;
  if (!label) title.setAttribute('aria-hidden', 'true');
  frame.appendChild(title);
  const data = chartData(points);
  const values = data.values;
  if (values.length === 0) {
    frame.appendChild(renderEmpty(doc, 'No data available'));
    return frame;
  }
  const svg = createSvgElement(doc, 'svg');
  svg.classList.add('quant-backtest-chart');
  svg.setAttribute('viewBox', '0 0 640 220');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const grid = createSvgElement(doc, 'path');
  grid.setAttribute('class', 'quant-backtest-chart-grid-lines');
  grid.setAttribute('d', 'M42 20H620M42 110H620M42 200H620M42 20V200');
  if (options.tooltipMode !== 'performance-equity') svg.appendChild(grid);
  const min = Math.min(0, ...values.map((point) => point.y));
  const max = Math.max(0, ...values.map((point) => point.y));
  const span = max - min || 1;
  const xAt = (index: number) => 42 + (index / Math.max(1, values.length - 1)) * 578;
  const yAt = (value: number) => 200 - ((value - min) / span) * 180;
  const zero = yAt(0);
  const zeroLine = createSvgElement(doc, 'path');
  zeroLine.setAttribute('class', 'quant-backtest-chart-zero');
  zeroLine.setAttribute('d', `M42 ${zero.toFixed(2)}H620`);
  svg.appendChild(zeroLine);
  if (mode === 'bar') {
    const width = Math.max(2, Math.min(24, 560 / values.length));
    values.forEach((point, index) => {
      if (options.tooltipMode === 'performance-equity') return;
      const rect = createSvgElement(doc, 'rect');
      const x = xAt(index) - width / 2;
      const y = point.y >= 0 ? yAt(point.y) : zero;
      rect.setAttribute('x', x.toFixed(2));
      rect.setAttribute('y', y.toFixed(2));
      rect.setAttribute('width', width.toFixed(2));
      rect.setAttribute('height', Math.max(1, Math.abs(zero - yAt(point.y))).toFixed(2));
      rect.setAttribute('class', point.y >= 0 ? 'quant-backtest-chart-bar positive' : 'quant-backtest-chart-bar negative');
      svg.appendChild(rect);
    });
  } else {
    if (mode === 'area') {
      const fill = createSvgElement(doc, 'polygon');
      const linePoints = values.map((point, index) => `${xAt(index).toFixed(2)},${yAt(point.y).toFixed(2)}`);
      fill.setAttribute('points', [
        `${xAt(0).toFixed(2)},${zero.toFixed(2)}`,
        ...linePoints,
        `${xAt(values.length - 1).toFixed(2)},${zero.toFixed(2)}`,
      ].join(' '));
      fill.setAttribute('class', 'quant-backtest-chart-area-fill');
      svg.appendChild(fill);
    }
    const polyline = createSvgElement(doc, 'polyline');
    polyline.setAttribute('class', mode === 'area'
      ? 'quant-backtest-chart-line quant-backtest-chart-area-line'
      : 'quant-backtest-chart-line');
    polyline.setAttribute('points', values.map((point, index) => `${xAt(index).toFixed(2)},${yAt(point.y).toFixed(2)}`).join(' '));
    svg.appendChild(polyline);
    values.forEach((point, index) => {
      if (index !== values.length - 1 && values.length > 24) return;
      const circle = createSvgElement(doc, 'circle');
      circle.setAttribute('class', 'quant-backtest-chart-dot');
      circle.setAttribute('cx', xAt(index).toFixed(2));
      circle.setAttribute('cy', yAt(point.y).toFixed(2));
      circle.setAttribute('r', values.length > 24 ? '2' : '3');
      svg.appendChild(circle);
    });
  }
  const host = createElement(doc, 'div', 'quant-backtest-chart-host');
  host.dataset.rawPointCount = String(data.tooltipPoints.length);
  host.dataset.renderPointCount = String(data.reportPoints.length);
  host.dataset.downsampled = String(data.reportPoints.length < data.tooltipPoints.length);
  host.appendChild(svg);
  frame.appendChild(host);
  if (mode === 'bar') {
    const legend = createElement(doc, 'div', 'quant-backtest-chart-legend');
    for (const [labelText, color] of [
      ['Profit', options.positiveColor ?? '#089981'],
      ['Loss', options.negativeColor ?? '#f23645'],
    ] as const) {
      const item = createElement(doc, 'span', 'quant-backtest-chart-legend-item');
      const swatch = createElement(doc, 'span', 'quant-backtest-chart-legend-swatch');
      swatch.style.backgroundColor = color;
      swatch.setAttribute('aria-hidden', 'true');
      item.append(swatch, doc.createTextNode(labelText));
      legend.appendChild(item);
    }
    frame.appendChild(legend);
  }
  registerReportChart(host, {
    kind: mode === 'area' ? 'area' : mode === 'bar' ? 'column' : 'line',
    label,
    axis: data.axis,
    categories: data.categories,
    points: data.reportPoints,
    tooltipPoints: data.tooltipPoints,
    height: options.height ?? 180,
    currency: options.currency,
    tooltipMode: options.tooltipMode,
    yAxisTitle: options.yAxisTitle,
    positiveColor: options.positiveColor,
    negativeColor: options.negativeColor,
    lineColor: options.lineColor,
    yAxisOpposite: options.yAxisOpposite,
    ...(options.tooltipMode === 'performance-equity' ? {
      markerEnabled: false,
      chartSpacing: [10, 10, 5, 10] as const,
      yAxisGridLineWidth: 0,
      yAxisMin: Math.min(...values.map((point) => point.y)),
      yAxisMax: Math.max(...values.map((point) => point.y)),
    } : {}),
    ...(mode === 'area'
      ? {
          zoneAxis: 'y' as const,
          zones: [
            {
              value: 0,
              color: options.negativeColor ?? '#f23645',
              fillColor: {
                linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                stops: [
                  [0, 'rgba(242,54,69,0.05)'],
                  [0.2, 'rgba(242,54,69,0.15)'],
                  [0.4, 'rgba(242,54,69,0.30)'],
                  [0.6, 'rgba(242,54,69,0.45)'],
                  [0.8, 'rgba(242,54,69,0.65)'],
                  [1, 'rgba(242,54,69,0.85)'],
                ],
              },
            },
            {
              color: options.positiveColor ?? '#089981',
              fillColor: {
                linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                stops: [
                  [0, 'rgba(8,153,129,0.85)'],
                  [0.2, 'rgba(8,153,129,0.65)'],
                  [0.4, 'rgba(8,153,129,0.45)'],
                  [0.6, 'rgba(8,153,129,0.30)'],
                  [0.8, 'rgba(8,153,129,0.15)'],
                  [1, 'rgba(8,153,129,0.05)'],
                ],
              },
            },
          ],
        }
      : {}),
  });
  return frame;
}

function markCumulativePnlSource(
  doc: Document,
  chart: HTMLElement,
  source: BacktestReport['cumulativePnlSource'],
): void {
  if (!source) return;
  chart.dataset.cumulativePnlSource = source;
  if (source !== 'realized-ledger') return;
  // This is the reference Summary population, not a degraded equity fallback.
  // Keep provenance machine-readable without adding a non-reference badge.
  chart.setAttribute('role', 'group');
  chart.setAttribute('aria-label', 'Cumulative P&L (realized closed trades)');
}

function renderMetricTable(
  doc: Document,
  report: BacktestReport,
  rows: ReadonlyArray<MetricRow>,
  comparison?: BacktestComparison,
): HTMLElement {
  const table = createElement(doc, 'table', 'quant-backtest-metric-table');
  const caption = createElement(doc, 'caption');
  caption.textContent = 'Backtest metrics';
  table.appendChild(caption);
  const head = createElement(doc, 'thead');
  const headRow = createElement(doc, 'tr');
  const metricHead = createElement(doc, 'th');
  metricHead.scope = 'col';
  // LuxAlgo leaves the first comparison-table header visually empty. Keep an
  // accessible name without introducing visible text that shifts the column.
  metricHead.setAttribute('aria-label', 'Metric');
  const metricHeadLabel = createElement(doc, 'span', 'quant-backtest-visually-hidden');
  metricHeadLabel.textContent = 'Metric';
  metricHead.appendChild(metricHeadLabel);
  headRow.appendChild(metricHead);
  COMPARISON_COLUMNS.forEach((column) => {
    const th = createElement(doc, 'th');
    th.scope = 'col';
    th.textContent = column.label;
    headRow.appendChild(th);
  });
  head.appendChild(headRow);
  table.appendChild(head);
  const body = createElement(doc, 'tbody');
  let previousGroup: string | undefined;
  rows.forEach((row) => {
    if (row.group && row.group !== previousGroup) {
      const groupRow = createElement(doc, 'tr', 'quant-backtest-metric-group');
      const groupCell = createElement(doc, 'th');
      groupCell.scope = 'rowgroup';
      groupCell.colSpan = COMPARISON_COLUMNS.length + 1;
      groupCell.textContent = row.group;
      groupRow.appendChild(groupCell);
      body.appendChild(groupRow);
      previousGroup = row.group;
    } else if (!row.group) {
      previousGroup = undefined;
    }
    const tr = createElement(doc, 'tr');
    const label = createElement(doc, 'th');
    label.scope = 'row';
    label.textContent = row.label;
    if (row.key === 'netProfit') label.title = 'Realized net P&L plus unrealized P&L (mark-to-market).';
    if (row.key === 'strategyOutperformance') label.title = 'Net Profit (including unrealized P&L) minus Buy and Hold P&L, in account currency.';
    tr.appendChild(label);
    COMPARISON_COLUMNS.forEach((column) => {
      const td = createElement(doc, 'td');
      const emptyDirection = column.id !== 'all' && report.trades !== undefined
        && !report.trades.some((trade) => trade.direction === column.id);
      if (emptyDirection && ['netProfit', 'grossProfit', 'grossLoss', 'profitFactor',
        'averagePnlPerDay', 'averagePnlPerWeek'].includes(row.key)) {
        td.textContent = '-';
        td.classList.add('quant-backtest-tone-neutral');
        tr.appendChild(td);
        return;
      }
      const source = comparison?.[column.id];
      const raw = row.key === 'drawdown'
        ? undefined
        : source?.[row.key];
      // Only the aggregate column may fall back to the report-level metric.
      // Directional columns are explicitly unavailable when the adapter did
      // not publish a long/short comparison; copying All here makes a report
      // look directional even though no such population was calculated.
      const value = raw === undefined && row.key !== 'drawdown' && column.id === 'all'
        ? metricValue(report, row.key)
        : unwrapMetric(raw);
      if (row.key === 'drawdown') {
        // Directional columns must not inherit the aggregate drawdown.  A
        // missing Long/Short population is genuinely unavailable; only All
        // may fall back to the report-level metric.
        const amount = source && Object.hasOwn(source, 'maxDrawdown')
          ? unwrapMetric(source.maxDrawdown)
          : null;
        const percent = source && Object.hasOwn(source, 'maxDrawdownPercent')
          ? unwrapMetric(source.maxDrawdownPercent)
          : null;
        const fallbackAmount = column.id === 'all' ? metricValue(report, 'maxDrawdown') : null;
        const resolvedAmount = amount ?? fallbackAmount;
        const fallbackPercent = column.id === 'all' ? metricValue(report, 'maxDrawdownPercent') : null;
        const resolvedPercent = percent ?? fallbackPercent;
        if (resolvedAmount === null) {
          td.textContent = column.id === 'all' ? '—' : '';
        } else {
          td.textContent = formatBacktestPerformanceValue(resolvedAmount);
          const unit = createElement(doc, 'span', 'quant-backtest-metric-unit');
          unit.textContent = ` ${reportCurrency(report)}`;
          td.appendChild(unit);
          if (resolvedPercent !== null) {
            const percent = createElement(doc, 'span', 'quant-backtest-metric-unit');
            percent.textContent = ` (${formatBacktestPerformanceValue(resolvedPercent, 'drawdown-percent')}%)`;
            td.appendChild(percent);
          }
        }
        td.classList.add('quant-backtest-tone-neutral');
      } else {
        const signed = row.key === 'netProfit'
          || row.key === 'buyAndHoldPnl'
          || row.key === 'buyAndHoldPercent'
          || row.key === 'strategyOutperformance';
        const unit = row.key === 'trades'
          ? 'count'
          : row.key === 'profitFactor'
            ? 'ratio'
            : row.unit === 'currency' ? reportCurrency(report) : row.unit;
        const missing = value === null;
        if (missing) {
          td.textContent = column.id === 'all' && row.group === 'Benchmark' ? '-' : column.id === 'all' ? '—' : '';
        } else {
          const sign = signed && value > 0 ? '+' : '';
          const formatted = unit === 'count'
            ? formatNumber(value, 0)
            : formatBacktestPerformanceValue(value, unit === 'ratio' ? 'ratio' : 'value');
          td.textContent = `${sign}${formatted}${unit === '%' ? '%' : ''}`;
          if (unit && !['%', 'count', 'ratio'].includes(unit)) {
            const currency = createElement(doc, 'span', 'quant-backtest-metric-unit');
            currency.textContent = ` ${unit}`;
            td.appendChild(currency);
          }
        }
        td.classList.add(`quant-backtest-tone-${performanceMetricTone(row.key, value)}`);
      }
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  table.appendChild(body);
  return table;
}

function renderKpi(
  doc: Document,
  label: string,
  value: string,
  tone: string,
  secondary?: string,
  currency?: string,
): HTMLElement {
  const item = createElement(doc, 'div', 'quant-backtest-kpi');
  const name = createElement(doc, 'span', 'quant-backtest-kpi-label');
  name.textContent = label;
  const valueRow = createElement(doc, 'div', 'quant-backtest-kpi-value-row');
  const amount = createElement(doc, 'strong', `quant-backtest-kpi-value quant-backtest-tone-${tone}`);
  const suffix = currency ? ` ${currency.toUpperCase()}` : '';
  if (suffix && value.endsWith(suffix)) {
    amount.append(doc.createTextNode(value.slice(0, -suffix.length)));
    const unit = createElement(doc, 'span', 'quant-backtest-kpi-currency');
    unit.textContent = suffix;
    amount.appendChild(unit);
  } else {
    amount.textContent = value;
  }
  valueRow.appendChild(amount);
  if (secondary) {
    const detail = createElement(doc, 'span', 'quant-backtest-kpi-secondary');
    detail.textContent = secondary;
    valueRow.appendChild(detail);
  }
  item.append(name, valueRow);
  return item;
}

function performanceSummaryKpis(doc: Document, report: BacktestReport): HTMLElement {
  const bar = createElement(doc, 'div', 'quant-backtest-performance-kpi-bar');
  // The KPI strip intentionally scrolls horizontally on narrow screens. Give
  // that scroll container a keyboard target and an accessible name so keyboard
  // and assistive-technology users can reach the clipped metrics.
  bar.tabIndex = 0;
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Performance summary metrics');
  const currency = reportCurrency(report);
  const net = metricValue(report, 'netProfit');
  const trades = metricValue(report, 'trades');
  const winRate = metricValue(report, 'winRate');
  const breakdown = report.analysis?.winRateBreakdown ?? [];
  const breakdownValue = (name: string): number | null => {
    const point = breakdown.find((item) => String(item.x).toLowerCase() === name);
    return point && typeof point.y === 'number' && Number.isFinite(point.y) ? point.y : null;
  };
  const winners = metricValue(report, 'winningTrades') ?? breakdownValue('winners');
  const losers = metricValue(report, 'losingTrades') ?? breakdownValue('losers');
  const drawdown = metricValue(report, 'maxDrawdown');
  const drawdownPercent = metricValue(report, 'maxDrawdownPercent');
  const factor = metricValue(report, 'profitFactor');
  const factorTone = factor === null ? 'neutral' : factor > 1 ? 'positive' : 'negative';
  const winBreakdown = winners !== null || losers !== null
    ? `${formatNumber(winners, 0)} | ${formatNumber(losers, 0)}`
    : undefined;
  const drawdownDetail = drawdownPercent === null ? undefined : formatMetric(drawdownPercent, '%');
  bar.append(
    renderKpi(
      doc,
      'Net Profit',
      formatMetric(net, currency, true),
      net === null ? 'neutral' : net > 0 ? 'positive' : 'negative',
      undefined,
      currency,
    ),
    renderKpi(doc, 'Trades', formatMetric(trades, 'count'), 'neutral'),
    renderKpi(doc, 'Win Rate', formatMetric(winRate, '%'), 'neutral', winBreakdown),
    renderKpi(doc, 'Max Drawdown', formatMetric(drawdown, currency), 'neutral', drawdownDetail, currency),
    renderKpi(doc, 'Profit Factor', formatMetric(factor, 'ratio'), factorTone),
  );
  return bar;
}

function renderSectionHeading(doc: Document, title: string, description?: string): HTMLElement {
  const heading = createElement(doc, 'div', 'quant-backtest-section-heading');
  const titleEl = createElement(doc, 'h3');
  titleEl.textContent = title;
  heading.appendChild(titleEl);
  if (description) {
    const copy = createElement(doc, 'p');
    copy.textContent = description;
    heading.appendChild(copy);
  }
  return heading;
}

export class BacktestViewer {
  readonly element: HTMLElement;

  private readonly tabs: HTMLButtonElement[] = [];
  private readonly header: HTMLElement;
  private readonly tabList: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly range: HTMLElement;
  private readonly market: HTMLElement;
  private readonly marketBadge: HTMLElement;
  private readonly marketSymbol: HTMLElement;
  private readonly marketDivider: HTMLElement;
  private readonly marketTimeframe: HTMLElement;
  private readonly favoriteButton: HTMLButtonElement;
  private report: BacktestReport | null = null;
  private activeTab: BacktestTab = 'performance';
  private openState = false;
  private destroyed = false;
  private tradeView: 'list' | 'calendar' = 'list';
  private tradeCalendarMonth: string | null = null;
  private tradeCalendarCache: {
    readonly trades: readonly BacktestTrade[];
    readonly reportRevision: string | null;
    readonly timezone: string;
    readonly days: ReadonlyMap<string, BacktestTradeCalendarDay>;
  } | null = null;
  private tradeSort: BacktestTradeSort = { ...DEFAULT_TRADE_SORT };
  private tradePage = 0;
  private tradeSortedCache: {
    readonly trades: readonly BacktestTrade[];
    readonly key: BacktestTradeSortKey;
    readonly direction: 1 | -1;
    readonly sorted: readonly BacktestTradeEntry[];
  } | null = null;
  /** Prevent duplicate recomputes when a host dispatches the same form state
   * through both a native change event and a synthetic UI event. */
  private lastSimulationSignature: string | null = null;
  private simulationSettingsOpen = false;
  private simulationSettingsReturnTarget: 'desktop' | 'mobile' = 'desktop';
  // A native Tab move can synchronously blur a simulation input.  Its blur
  // handler may publish a new report before the browser finishes moving
  // focus; at that point activeElement is BODY (or a detached old control).
  // Keep the intended modal control separately so a report redraw can restore
  // it and Escape remains handled by the Viewer.
  private pendingSimulationFocus: string | null = null;
  private readonly onDocumentKeydown = (event: KeyboardEvent): void => {
    // A synchronous input blur/report redraw can leave activeElement on BODY,
    // so the event no longer bubbles through the Viewer section. Keep Escape
    // available at the document boundary while this modal is mounted.
    if (event.key !== 'Escape' || !this.openState || event.defaultPrevented) return;
    const dialog = this.panel.querySelector<HTMLElement>(
      '.quant-backtest-simulation-settings-dialog',
    );
    if (!this.simulationSettingsOpen && !dialog) return;
    const expandedRuns = dialog?.querySelector<HTMLButtonElement>(
      '.quant-backtest-simulation-runs-trigger[aria-expanded="true"]',
    );
    if (expandedRuns) {
      event.preventDefault(); event.stopPropagation();
      expandedRuns.click();
      return;
    }
    if (!this.simulationSettingsOpen) this.simulationSettingsOpen = true;
    this.onViewerKeydown(event);
    event.stopPropagation();
  };
  private pendingPanelScrollTop: number | null = null;
  private readonly onViewerKeydown = (event: KeyboardEvent): void => {
    if (!this.openState) return;
    if (event.key === 'Escape') {
      // Point controls/popovers may already have handled their own Escape.
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (this.simulationSettingsOpen) {
        this.setSimulationSettingsOpen(false);
        return;
      }
      // Hover does not move focus off a Tab/header button. Dismiss the chart's
      // visible content first, keeping focus and the report open until the next
      // Escape. Only this Viewer's charts participate, never a background Cell.
      if (dismissReportChartTooltips(this.panel)) return;
      this.callbacks.onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = this.panel.querySelector<HTMLElement>(
      '.quant-backtest-simulation-settings-dialog',
    );
    const settingsOpen = this.simulationSettingsOpen || Boolean(dialog);
    const focusRoot = settingsOpen
      ? dialog ?? this.element
      : this.element;
    const focusable = focusableElements(focusRoot);
    if (focusable.length === 0) return;
    const current = this.doc.activeElement;
    const index = current instanceof HTMLElement ? focusable.indexOf(current) : -1;
    // Variation changes the enabled state of the following Preserve control.
    // The pre-blur focus list therefore cannot be used for this Tab move: blur
    // commits the value and redraws the dialog before the next control exists.
    // Commit first, then compute the next/previous control from the replacement
    // dialog so focus never lands on a detached node or BODY.
    if (this.simulationSettingsOpen
      && current instanceof HTMLInputElement
      && current.dataset.simulationFocus === 'settings:variation') {
      event.preventDefault();
      current.blur();
      queueMicrotask(() => {
        if (this.destroyed || !this.openState || !this.simulationSettingsOpen
          || this.activeTab !== 'simulation') return;
        const dialog = this.panel.querySelector<HTMLElement>(
          '.quant-backtest-simulation-settings-dialog',
        );
        const fresh = dialog ? focusableElements(dialog) : [];
        const freshIndex = fresh.findIndex(
          (candidate) => candidate.dataset.simulationFocus === 'settings:variation',
        );
        if (freshIndex < 0 || fresh.length === 0) return;
        const targetIndex = event.shiftKey
          ? (freshIndex <= 0 ? fresh.length - 1 : freshIndex - 1)
          : (freshIndex === fresh.length - 1 ? 0 : freshIndex + 1);
        const target = fresh[targetIndex];
        if (target) {
          this.pendingSimulationFocus = target.dataset.simulationFocus ?? null;
          target.focus();
        }
      });
      return;
    }
    const next = event.shiftKey
      ? (index <= 0 ? focusable.length - 1 : index - 1)
      : (index < 0 || index === focusable.length - 1 ? 0 : index + 1);
    event.preventDefault();
    const target = focusable[next];
    if (settingsOpen && target?.dataset.simulationFocus) {
      this.pendingSimulationFocus = target.dataset.simulationFocus;
    }
    // Variation starts with Preserve disabled.  Its value is committed by
    // blur, which enables Preserve and rebuilds the dialog.  Record the
    // post-commit target and blur explicitly so the rebuilt control receives
    // focus instead of wrapping to a detached Close button/BODY.
    const currentFocus = current instanceof HTMLElement
      ? current.dataset.simulationFocus
      : undefined;
    const preserve = dialog?.querySelector<HTMLElement>(
      '[data-simulation-focus="settings:preserve"]',
    );
    if (settingsOpen && !event.shiftKey && currentFocus === 'settings:variation'
      && preserve instanceof HTMLInputElement && preserve.disabled) {
      this.pendingSimulationFocus = 'settings:preserve';
      if (current instanceof HTMLElement) current.blur();
    } else {
      target?.focus();
    }
    // The target's blur/change callback can replace the dialog synchronously.
    // Refetch the replacement after that callback has completed instead of
    // leaving focus on a detached node (which browsers reset to BODY).
    if (settingsOpen && this.pendingSimulationFocus) {
      const focusKey = this.pendingSimulationFocus;
      queueMicrotask(() => {
        if (this.destroyed || !this.openState
          || this.activeTab !== 'simulation') return;
        this.restoreSimulationFocus(focusKey);
      });
    }
  };
  private readonly onViewportResize = (): void => {
    if (!this.openState || !this.simulationSettingsOpen || this.activeTab !== 'simulation') return;
    queueMicrotask(() => {
      if (this.destroyed || !this.openState
        || !this.simulationSettingsOpen || this.activeTab !== 'simulation') return;
      const dialog = this.panel.querySelector<HTMLElement>(
        '.quant-backtest-simulation-settings-dialog',
      );
      if (!dialog) return;
      const active = this.doc.activeElement;
      if (active === dialog) return;
      if (active instanceof HTMLElement
        && dialog.contains(active)
        && focusableElements(dialog).includes(active)) return;
      dialog.focus();
    });
  };

  constructor(private readonly doc: Document, private readonly callbacks: BacktestViewerCallbacks) {
    this.element = createElement(doc, 'section', 'quant-backtest-viewer');
    this.element.setAttribute('aria-label', 'Backtest report');
    this.element.setAttribute('role', 'region');
    this.element.addEventListener('keydown', this.onViewerKeydown);
    this.doc.addEventListener('keydown', this.onDocumentKeydown, true);
    this.doc.defaultView?.addEventListener('resize', this.onViewportResize);
    this.element.hidden = true;

    this.header = createElement(doc, 'header', 'quant-backtest-viewer-header');
    const back = button(doc, '', 'quant-backtest-viewer-back');
    back.prepend(icon(doc, 'close'));
    back.setAttribute('aria-label', 'Return to chart');
    back.title = 'Return to chart';
    back.addEventListener('click', () => this.callbacks.onClose());
    const heading = createElement(doc, 'div', 'quant-backtest-viewer-heading');
    const market = createElement(doc, 'div', 'quant-backtest-viewer-market');
    market.setAttribute('role', 'group');
    this.market = market;
    this.marketBadge = createElement(doc, 'span', 'quant-backtest-viewer-market-badge');
    this.marketBadge.setAttribute('aria-hidden', 'true');
    this.marketSymbol = createElement(doc, 'span', 'quant-backtest-viewer-market-symbol');
    this.marketDivider = createElement(doc, 'span', 'quant-backtest-viewer-market-divider');
    this.marketDivider.setAttribute('aria-hidden', 'true');
    this.marketTimeframe = createElement(doc, 'span', 'quant-backtest-viewer-market-timeframe');
    market.append(this.marketBadge, this.marketSymbol, this.marketDivider, this.marketTimeframe);
    this.title = createElement(doc, 'h2');
    this.range = createElement(doc, 'span');
    this.range.setAttribute('role', 'note');
    heading.append(market, this.title, this.range);
    this.favoriteButton = button(doc, 'Save strategy', 'quant-backtest-favorite');
    this.favoriteButton.replaceChildren(icon(doc, 'star'));
    this.favoriteButton.setAttribute('aria-label', 'Save strategy');
    this.favoriteButton.addEventListener('click', () => {
      if (this.report) this.callbacks.onToggleFavorite?.(this.report);
    });
    this.element.appendChild(this.header);
    // The reference Viewer header exposes only navigation and the strategy
    // favorite action. Settings remain available from the chart Dock; adding
    // a second Viewer entry changes the one-to-one interaction contract.
    this.header.append(back, heading, this.favoriteButton);

    this.tabList = createElement(doc, 'div', 'quant-backtest-tabs');
    this.tabList.setAttribute('role', 'tablist');
    this.tabList.setAttribute('aria-label', 'Backtest report sections');
    TABS.forEach((tab) => {
      const tabButton = button(doc, tab.label, 'quant-backtest-tab');
      tabButton.dataset.tab = tab.id;
      tabButton.id = `quant-backtest-tab-${tab.id}`;
      tabButton.setAttribute('role', 'tab');
      tabButton.setAttribute('aria-controls', 'quant-backtest-panel');
      tabButton.addEventListener('click', () => this.selectTab(tab.id));
      tabButton.addEventListener('keydown', (event) => this.onTabKeydown(event, tab.id));
      this.tabs.push(tabButton);
      this.tabList.appendChild(tabButton);
    });
    this.element.appendChild(this.tabList);

    this.panel = createElement(doc, 'div', 'quant-backtest-viewer-panel');
    this.panel.id = 'quant-backtest-panel';
    this.panel.setAttribute('role', 'tabpanel');
    this.panel.setAttribute('aria-labelledby', 'quant-backtest-tab-performance');
    this.panel.tabIndex = 0;
    this.element.appendChild(this.panel);
    this.selectTab('performance', false);
  }

  get isOpen(): boolean {
    return this.openState;
  }

  get tab(): BacktestTab {
    return this.activeTab;
  }

  setReport(report: BacktestReport | null): void {
    const previousReport = this.report;
    const previousExecution = this.report
      ? `${this.report.key?.cellId ?? ''}:${this.report.key?.indicatorId ?? ''}:${this.report.runId ?? ''}:${this.report.revision ?? ''}`
      : null;
    const nextExecution = report
      ? `${report.key?.cellId ?? ''}:${report.key?.indicatorId ?? ''}:${report.runId ?? ''}:${report.revision ?? ''}`
      : null;
    if (previousExecution !== nextExecution) {
      this.lastSimulationSignature = null;
      this.simulationSettingsOpen = false;
      this.pendingSimulationFocus = null;
      this.tradePage = 0;
      this.tradeSortedCache = null;
    }
    if (shouldResetBacktestTradeCalendar(this.report, report)) {
      this.tradeCalendarMonth = null;
      this.tradeCalendarCache = null;
    }
    if (!report) {
      this.tradeCalendarCache = null;
      this.simulationSettingsOpen = false;
      this.pendingSimulationFocus = null;
    }
    const sameExecution = previousReport && report
      && previousReport.key?.cellId === report.key?.cellId
      && previousReport.key?.indicatorId === report.key?.indicatorId;
    const sameReportContext = sameExecution
      && previousReport.provider === report.provider
      && previousReport.symbol === report.symbol
      && previousReport.timeframe === report.timeframe;
    if (!sameReportContext || (report && isTerminalReportStatus(report.status))) {
      this.pendingPanelScrollTop = null;
    }
    const hasRenderedCharts = Boolean(this.panel.querySelector('.quant-backtest-chart-host'));
    const transientLiveSnapshot = sameExecution
      && hasRenderedCharts
      && isTransientReportStatus(report.status);
    const chartDataUnchanged = sameExecution
      && hasRenderedCharts
      && previousReport
      && reportChartSignature(previousReport) === reportChartSignature(report);
    const performanceKpisUnchanged = sameExecution
      && hasRenderedCharts
      && previousReport
      && reportPerformanceKpiSignature(previousReport) === reportPerformanceKpiSignature(report);
    // A new engine run can coincidentally produce identical chart/KPI values.
    // It still represents a different report and must refresh the header and
    // reset run-scoped controls instead of being treated as a no-op snapshot.
    const runChanged = Boolean(previousReport && report && previousReport.runId !== report.runId);
    const terminalStatusChanged = Boolean(previousReport && report
      && previousReport.status !== report.status
      && (isTerminalReportStatus(previousReport.status) || isTerminalReportStatus(report.status)));

    this.report = report;
    if (!report) {
      this.tradePage = 0;
      this.tradeSortedCache = null;
    }
    if (this.openState) {
      // Favorite changes do not change report charts or KPI values. Refresh
      // this projection even when the chart-preserving fast path skips render.
      this.updateFavoriteButton();
      const active = this.doc.activeElement;
      const previousPanelScrollTop = this.panel.scrollTop;
      const pending = report && isPendingReportStatus(report.status);
      if (pending && sameReportContext && this.pendingPanelScrollTop === null
        && previousReport && !isPendingReportStatus(previousReport.status)) {
        // A loading message is shorter than a report, so the DOM clamps its
        // scrollTop to zero. Keep the offset outside the DOM until the same
        // strategy/market's content returns, including consecutive updates.
        this.pendingPanelScrollTop = previousPanelScrollTop;
      }
      const restoredPanelScrollTop = sameReportContext
        ? this.pendingPanelScrollTop ?? previousPanelScrollTop
        : 0;
      const focusedId = active instanceof HTMLElement && this.element.contains(active)
        ? active.id || null
        : null;
      const focusedCalendarNavigation = active instanceof HTMLElement && this.element.contains(active)
        ? active.dataset.calendarNavigation
        : undefined;
      const focusedSimulationControl = active instanceof HTMLElement && this.element.contains(active)
        ? active.dataset.simulationFocus
        : (this.simulationSettingsOpen
          || Boolean(this.panel.querySelector('.quant-backtest-simulation-settings-dialog')))
          ? this.pendingSimulationFocus ?? undefined
          : undefined;
      const focusedSimulationDialog = active instanceof HTMLElement
        && active.classList.contains('quant-backtest-simulation-settings-dialog');
      // Keep the Viewer mounted for forming-bar snapshots. When the visible
      // chart tail changes, update mounted Highcharts series and summary KPIs
      // in place; if the chart shape cannot be reused, fall back to a normal
      // render. This avoids replacing the panel with a loading state on every
      // mark-to-market tick while preserving the terminal render contract.
      const liveUpdated = transientLiveSnapshot && (!chartDataUnchanged || !performanceKpisUnchanged)
        ? this.updateTransientPerformance()
        : false;
      if (runChanged || terminalStatusChanged || (!chartDataUnchanged || !performanceKpisUnchanged)
        && (!transientLiveSnapshot || !liveUpdated)) this.render();
      // Same-context report revisions preserve the shared panel offset;
      // transient updates already keep its subtree mounted. This is not a
      // separate scroll memory for each Tab.
      if (!liveUpdated) this.panel.scrollTop = restoredPanelScrollTop;
      if (!pending) this.pendingPanelScrollTop = null;
      if (focusedCalendarNavigation) {
        this.element.querySelector<HTMLButtonElement>(
          `[data-calendar-navigation="${focusedCalendarNavigation}"]`,
        )?.focus();
      } else if (focusedSimulationControl) {
        this.restoreSimulationFocus(focusedSimulationControl);
      } else if (focusedSimulationDialog) {
        this.panel.querySelector<HTMLElement>('.quant-backtest-simulation-settings-dialog')?.focus();
      } else if (focusedId) {
        const replacement = this.doc.getElementById(focusedId);
        if (replacement instanceof HTMLElement && this.element.contains(replacement)) replacement.focus();
      }
    }
  }

  /** Update the visible Performance charts without replacing the panel DOM. */
  private updateTransientPerformance(): boolean {
    if (!this.report || !this.panel.querySelector('.quant-backtest-performance')) return false;
    const chartSources = {
      cumulative: this.report.cumulativePnl,
      daily: this.report.netDailyPnl,
      weekday: this.report.weekdayPerformance,
    };
    const frames = [...this.panel.querySelectorAll<HTMLElement>('.quant-backtest-chart-frame')];
    const updated = frames
      .map((frame) => {
        const host = frame.querySelector<HTMLElement>('.quant-backtest-chart-host[data-quant-report-chart]');
        if (!host) return true; // an empty chart has no mounted instance to update.
        const label = frame.querySelector<HTMLElement>('.quant-backtest-chart-label')?.textContent ?? '';
        const source = label.startsWith('Cumulative P&L')
          ? chartSources.cumulative
          : label.startsWith('Net Daily PNL')
            ? chartSources.daily
            : label.startsWith('Weekday Performance')
              ? chartSources.weekday
              : undefined;
        if (!source) return true;
        const data = chartData(source);
        return updateReportChartPoints(host, data.reportPoints, data.tooltipPoints);
      });
    if (updated.length === 0) return false;
    const currentKpis = this.panel.querySelector<HTMLElement>('.quant-backtest-performance-kpi-bar');
    if (currentKpis) {
      const nextKpis = performanceSummaryKpis(this.doc, this.report);
      currentKpis.replaceChildren(...[...nextKpis.childNodes]);
    }
    return updated.every(Boolean);
  }

  private restoreSimulationFocus(focusKey: string): void {
    const dialog = this.panel.querySelector<HTMLElement>(
      '.quant-backtest-simulation-settings-dialog',
    );
    const dialogOpen = this.simulationSettingsOpen || Boolean(dialog);
    const focusRoot = dialogOpen && dialog ? dialog : this.element;
    const focusable = focusableElements(focusRoot);
    const replacement = focusable.find(
      (candidate) => candidate.dataset.simulationFocus === focusKey,
    );
    if (replacement) {
      replacement.focus();
      if (this.doc.activeElement === replacement) this.pendingSimulationFocus = null;
      return;
    }

    // A responsive transition can hide the control that owned focus while a
    // Worker report redraw is in flight. Keep focus on the active modal, or on
    // the visible settings entry point that exposes those controls.
    if (dialogOpen && dialog) {
      dialog.focus();
      this.pendingSimulationFocus = null;
      return;
    }
    const settingsTrigger = focusable.find(
      (candidate) => candidate.dataset.simulationSettingsTrigger !== undefined,
    );
    (settingsTrigger
      ?? this.tabs.find((tab) => tab.dataset.tab === 'simulation')
      ?? this.panel).focus();
    this.pendingSimulationFocus = null;
  }

  open(report: BacktestReport | null): void {
    if (this.destroyed) return;
    this.report = report;
    this.lastSimulationSignature = null;
    this.simulationSettingsOpen = false;
    this.pendingSimulationFocus = null;
    this.tradeCalendarMonth = null;
    this.tradeCalendarCache = null;
    this.tradePage = 0;
    this.tradeSortedCache = null;
    // A new Viewer mount starts at Performance/top, matching the reference.
    this.openState = false;
    this.pendingPanelScrollTop = null;
    this.selectTab('performance', false);
    this.openState = true;
    this.element.hidden = false;
    this.render();
    this.panel.scrollTop = 0;
    this.tabs[0]?.focus();
  }

  close(): void {
    if (this.destroyed) return;
    this.openState = false;
    this.pendingPanelScrollTop = null;
    this.simulationSettingsOpen = false;
    this.pendingSimulationFocus = null;
    this.applySimulationModalIsolation();
    this.tradeCalendarCache = null;
    this.tradeSortedCache = null;
    destroyReportCharts(this.panel);
    this.element.hidden = true;
  }

  destroy(): void {
    this.destroyed = true;
    this.simulationSettingsOpen = false;
    this.applySimulationModalIsolation();
    destroyReportCharts(this.panel);
    this.element.removeEventListener('keydown', this.onViewerKeydown);
    this.doc.removeEventListener('keydown', this.onDocumentKeydown, true);
    this.doc.defaultView?.removeEventListener('resize', this.onViewportResize);
    this.element.remove();
    this.report = null;
    this.tradeCalendarCache = null;
  }

  private selectTab(tab: BacktestTab, notify = true): void {
    // Re-selecting the active tab is a no-op in the reference workspace.
    // Re-rendering here would erase scroll/hover state without navigation.
    if (this.openState && this.activeTab === tab) return;
    // Reference Tabs replace children of one scroll container. Carry only its
    // current DOM offset into the next content; assignment naturally clamps
    // to that content's height. A pending placeholder must not resurrect a
    // different Tab's deferred offset after navigation.
    const sharedScrollTop = this.panel.scrollTop;
    this.pendingPanelScrollTop = null;
    if (this.activeTab === 'simulation' && tab !== 'simulation') {
      this.lastSimulationSignature = null;
      this.simulationSettingsOpen = false;
      this.pendingSimulationFocus = null;
    }
    this.activeTab = tab;
    this.tabs.forEach((tabButton) => {
      const active = tabButton.dataset.tab === tab;
      tabButton.classList.toggle('active', active);
      tabButton.setAttribute('aria-selected', String(active));
      tabButton.tabIndex = active ? 0 : -1;
    });
    this.panel.setAttribute('aria-labelledby', `quant-backtest-tab-${tab}`);
    if (notify) this.callbacks.onTabChange?.(tab);
    if (this.openState) {
      this.render();
      this.panel.scrollTop = sharedScrollTop;
    }
  }

  private onTabKeydown(event: KeyboardEvent, tab: BacktestTab): void {
    const index = TABS.findIndex((item) => item.id === tab);
    if (index < 0) return;
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    this.selectTab(TABS[next].id);
    this.tabs[next]?.focus();
  }

  private render(): void {
    const sharedScrollTop = this.panel.scrollTop;
    // Every render replaces the panel subtree. Dispose chart instances first
    // so ResizeObservers and Highcharts' global event hooks cannot outlive a
    // tab/report revision while an async local chunk is still loading.
    destroyReportCharts(this.panel);
    if (!this.report) {
      this.title.textContent = 'Backtest';
      this.range.textContent = '';
      this.range.hidden = true;
      this.range.removeAttribute('title');
      this.range.removeAttribute('aria-label');
      delete this.range.dataset.executionPrecision;
      delete this.range.dataset.executionFallback;
      delete this.range.dataset.executionFallbackReason;
      this.market.hidden = true;
      this.marketBadge.replaceChildren(assetLogo(this.doc, '•'));
      delete this.marketBadge.dataset.asset;
      this.marketSymbol.textContent = '';
      this.marketTimeframe.textContent = '';
      this.marketSymbol.removeAttribute('aria-label');
      this.updateFavoriteButton();
      this.panel.replaceChildren(renderEmpty(this.doc, 'No backtest report available.'));
      this.applySimulationModalIsolation();
      return;
    }
    const displaySymbol = reportDisplaySymbol(this.report);
    const timeframe = reportTimeframeLabel(this.report);
    const rawProvider = this.report.provider?.trim() ?? '';
    const provider = rawProvider.toLowerCase() === 'unknown' ? '' : rawProvider;
    this.market.hidden = !displaySymbol && !timeframe;
    this.marketBadge.hidden = !displaySymbol;
    this.marketSymbol.hidden = !displaySymbol;
    this.marketDivider.hidden = !displaySymbol || !timeframe;
    this.marketTimeframe.hidden = !timeframe;
    const assetLabel = reportAssetLabel(this.report);
    this.marketBadge.replaceChildren(assetLogo(this.doc, assetLabel));
    this.marketBadge.dataset.asset = assetLabel;
    this.marketSymbol.textContent = displaySymbol;
    this.marketTimeframe.textContent = timeframe;
    this.market.setAttribute(
      'aria-label',
      [provider && displaySymbol ? `${displaySymbol} on ${provider}` : displaySymbol, timeframe].filter(Boolean).join(', '),
    );
    this.marketBadge.title = provider ? provider.toUpperCase() : '';
    this.title.textContent = this.report.strategyName;
    const range = formatBacktestRange(this.report);
    const precision = formatExecutionPrecision(this.report.execution?.precision);
    this.range.textContent = [range, precision?.text].filter(Boolean).join(' · ');
    this.range.hidden = !this.range.textContent;
    if (precision) {
      this.range.title = precision.detail;
      this.range.setAttribute(
        'aria-label',
        range ? `${range}; ${precision.detail}` : precision.detail,
      );
      // Keep a machine-readable value even when default OHLC is intentionally
      // hidden from the visible date line for pixel parity.
      this.range.dataset.executionPrecision = precision.text || 'OHLC';
      this.range.dataset.executionFallback = String(precision.fallback);
      if (precision.fallbackReason) this.range.dataset.executionFallbackReason = precision.fallbackReason;
      else delete this.range.dataset.executionFallbackReason;
    } else {
      this.range.removeAttribute('title');
      this.range.removeAttribute('aria-label');
      delete this.range.dataset.executionPrecision;
      delete this.range.dataset.executionFallback;
      delete this.range.dataset.executionFallbackReason;
    }
    this.updateFavoriteButton();
    this.panel.replaceChildren(this.renderPanel());
    this.applySimulationModalIsolation();
    this.panel.scrollTop = sharedScrollTop;
    // Keep the SVG fallback synchronously visible and upgrade only after the
    // rendered hosts are attached. Failures are contained by the renderer.
    void enhanceReportCharts(this.panel);
  }

  private updateFavoriteButton(): void {
    const favorite = this.report?.favorite === true;
    const label = favorite ? 'Remove from saved' : 'Save strategy';
    this.favoriteButton.classList.toggle('active', favorite);
    this.favoriteButton.setAttribute('aria-pressed', String(favorite));
    this.favoriteButton.setAttribute('aria-label', label);
    this.favoriteButton.title = label;
  }

  private applySimulationModalIsolation(): void {
    const modal = this.openState && this.simulationSettingsOpen;
    [this.header, this.tabList].forEach((node) => {
      node.inert = modal;
      if (modal) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    });
  }

  private renderPanel(): HTMLElement {
    if (!this.report) return renderEmpty(this.doc, 'No backtest report available.');
    if (isPendingReportStatus(this.report.status)) {
      return this.renderLoading(this.report.status);
    }
    if (this.report.status === 'error') return this.renderError();
    if (this.report.status === 'suspended') return this.renderStatus('Strategy hidden', 'Show the strategy on the chart to refresh its report.');
    if (this.report.status === 'no-data') return this.renderStatus('No market data', 'The selected provider did not return bars for this strategy.');
    if (this.report.status === 'no-trades') {
      if (this.activeTab === 'analysis') return renderTradeAnalysisView(this.doc, this.report);
      if (this.activeTab === 'simulation') return this.renderSimulation();
      if (this.activeTab === 'log') return this.renderTradesLog();
      return this.renderPerformance();
    }
    if (this.report.status === 'open-only') {
      if (this.activeTab === 'analysis') return renderTradeAnalysisView(this.doc, this.report);
      if (this.activeTab === 'simulation') return this.renderSimulation();
      if (this.activeTab === 'log') return this.renderTradesLog();
      return this.renderPerformance();
    }
    switch (this.activeTab) {
      case 'analysis': return this.renderAnalysis();
      case 'log': return this.renderTradesLog();
      case 'simulation': return this.renderSimulation();
      case 'performance': return this.renderPerformance();
    }
  }

  private renderLoading(status: string | undefined): HTMLElement {
    const container = createElement(this.doc, 'div', 'quant-backtest-state');
    markStatusRegion(container);
    const spinner = createElement(this.doc, 'span', 'quant-backtest-spinner');
    spinner.setAttribute('aria-hidden', 'true');
    const text = createElement(this.doc, 'p');
    text.textContent = status === 'waiting-data'
      ? 'Waiting for market data…'
      : status === 'compiling'
        ? 'Compiling strategy…'
        : status === 'updating'
          ? 'Updating backtest…'
          : 'Running backtest…';
    container.append(spinner, text);
    return container;
  }

  private renderStatus(title: string, message: string): HTMLElement {
    const container = createElement(this.doc, 'div', 'quant-backtest-state');
    markStatusRegion(container);
    const heading = createElement(this.doc, 'h3');
    heading.textContent = title;
    const copy = createElement(this.doc, 'p');
    copy.textContent = message;
    container.append(heading, copy);
    return container;
  }

  private renderError(): HTMLElement {
    const container = createElement(this.doc, 'div', 'quant-backtest-state quant-backtest-state-error');
    // Keep the coarse origin available to host styling/telemetry without
    // exposing provider URLs or changing the reference-facing copy.
    if (this.report?.errorDetails?.kind) {
      container.dataset.errorKind = this.report.errorDetails.kind;
    }
    // Runtime/compile failures should interrupt the current status announcement
    // so the user is not left with an apparently running strategy. The retry
    // control remains inside the same atomic region and is announced once.
    markStatusRegion(container, 'assertive');
    const title = createElement(this.doc, 'h3');
    title.textContent = 'Backtest unavailable';
    const message = createElement(this.doc, 'p');
    message.textContent = this.report?.error || 'The strategy could not be evaluated.';
    container.append(title, message);
    if (this.callbacks.onRetry) {
      const retry = button(this.doc, 'Try again', 'quant-backtest-button quant-backtest-button-primary');
      retry.prepend(icon(this.doc, 'refresh'));
      retry.addEventListener('click', () => this.callbacks.onRetry?.());
      container.appendChild(retry);
    }
    return container;
  }

  private renderPerformance(): HTMLElement {
    const report = this.requireReport();
    const container = createElement(this.doc, 'div', 'quant-backtest-page quant-backtest-performance');
    const currency = reportCurrency(report).toUpperCase();
    const summary = createElement(this.doc, 'section', 'quant-backtest-summary-section');
    summary.id = 'Summary';
    const hasClosedTrades = (report.trades ?? []).some((trade) => trade.status === 'closed')
      || (report.cumulativePnl?.length ?? 0) > 0;
    const cumulativeChart = hasClosedTrades ? renderMiniChart(
      this.doc,
      report.cumulativePnl,
      'area',
      'Cumulative P&L',
      {
        height: 300,
        currency: reportCurrency(report),
        tooltipMode: 'performance-equity',
        lineColor: '#089981',
        positiveColor: '#089981',
        negativeColor: '#f23645',
        yAxisOpposite: true,
      },
    ) : this.renderStatus(
      report.status === 'open-only' ? 'Open trades only' : 'No trades',
      report.status === 'open-only'
        ? 'No closed trades are available yet; realized metrics and simulation are unavailable.'
        : 'The strategy completed without producing a closed or open trade.',
    );
    cumulativeChart.classList.add('quant-backtest-summary-chart-frame');
    markCumulativePnlSource(this.doc, cumulativeChart, report.cumulativePnlSource);
    summary.append(cumulativeChart, performanceSummaryKpis(this.doc, report));
    container.appendChild(summary);

    container.appendChild(renderSectionHeading(this.doc, 'Performance'));
    const performanceCard = createElement(this.doc, 'section', 'quant-backtest-performance-card');
    const charts = createElement(this.doc, 'div', 'quant-backtest-chart-grid');
    if (hasClosedTrades) charts.append(
      renderMiniChart(this.doc, report.netDailyPnl, 'bar', `Net Daily PNL (${currency})`, {
        height: 250,
        currency: reportCurrency(report),
        tooltipMode: 'performance-bucket',
        yAxisTitle: 'Net Daily P&L',
        positiveColor: '#089981',
        negativeColor: '#f23645',
      }),
      renderMiniChart(this.doc, report.weekdayPerformance, 'bar', `Weekday Performance (${currency})`, {
        height: 250,
        currency: reportCurrency(report),
        tooltipMode: 'performance-bucket',
        yAxisTitle: 'Weekday P&L',
        positiveColor: '#089981',
        negativeColor: '#f23645',
      }),
    );
    if (hasClosedTrades) performanceCard.appendChild(charts);
    performanceCard.appendChild(renderMetricTable(this.doc, report, PERFORMANCE_ROWS, report.comparison));
    container.appendChild(performanceCard);
    return container;
  }

  private renderAnalysis(): HTMLElement {
    return renderTradeAnalysisView(this.doc, this.requireReport());
  }

  private renderTradesLog(): HTMLElement {
    const report = this.requireReport();
    const container = createElement(this.doc, 'div', 'quant-backtest-page quant-backtest-trades-log');
    // Keep the log toolbar and its table in the same bordered surface.  The
    // reference treats this as one card, with a 16px inner gutter; putting the
    // wrapper around both siblings also keeps the card intact in Calendar
    // mode and when the table is horizontally scrollable on narrow screens.
    const card = createElement(this.doc, 'section', 'quant-backtest-log-card');
    if (report.status === 'no-trades' || report.status === 'open-only') {
      const state = createElement(this.doc, 'div', 'quant-backtest-log-state');
      markStatusRegion(state);
      const title = createElement(this.doc, 'strong');
      const message = createElement(this.doc, 'span');
      if (report.status === 'open-only') {
        title.textContent = 'Open trades only';
        message.textContent = 'No closed trades are available yet; the Calendar contains realized exits only.';
      } else {
        title.textContent = 'No trades';
        message.textContent = 'The strategy completed without producing a closed or open trade.';
      }
      state.append(title, message);
      card.appendChild(state);
    }
    const heading = createElement(this.doc, 'div', 'quant-backtest-log-header');
    const toolbar = createElement(this.doc, 'div', 'quant-backtest-log-toolbar');
    const viewModeLabel = createElement(this.doc, 'span', 'quant-backtest-log-view-label');
    viewModeLabel.textContent = 'View Mode';
    const mode = createElement(this.doc, 'div', 'quant-backtest-segmented');
    mode.setAttribute('role', 'tablist');
    mode.setAttribute('aria-label', 'Trades Log view mode');
    mode.setAttribute('aria-orientation', 'horizontal');
    (['list', 'calendar'] as const).forEach((view) => {
      const label = view === 'list' ? 'List view' : 'Calendar view';
      const control = button(this.doc, '', 'quant-backtest-segment quant-backtest-segment-icon');
      control.appendChild(icon(this.doc, view));
      control.id = `quant-backtest-trades-view-${view}`;
      control.setAttribute('aria-controls', 'quant-backtest-trades-view-panel');
      control.dataset.tradeView = view;
      control.setAttribute('role', 'tab');
      control.setAttribute('aria-label', label);
      control.title = label;
      control.classList.toggle('active', this.tradeView === view);
      control.setAttribute('aria-selected', String(this.tradeView === view));
      control.tabIndex = this.tradeView === view ? 0 : -1;
      control.addEventListener('click', () => {
        this.tradeView = view;
        this.render();
        this.element.querySelector<HTMLButtonElement>(`[data-trade-view="${view}"]`)?.focus();
      });
      control.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home'
          ? 'list'
          : event.key === 'End'
            ? 'calendar'
            : view === 'list' ? 'calendar' : 'list';
        this.tradeView = next;
        this.render();
        this.element.querySelector<HTMLButtonElement>(`[data-trade-view="${next}"]`)?.focus();
      });
      mode.appendChild(control);
    });
    toolbar.append(viewModeLabel, mode);
    heading.appendChild(toolbar);
    const panel = this.tradeView === 'calendar'
      ? this.renderTradeCalendar(report.trades ?? [])
      : this.renderTradeTable(report.trades ?? []);
    panel.setAttribute('role', 'tabpanel');
    panel.id = 'quant-backtest-trades-view-panel';
    panel.setAttribute('aria-labelledby', `quant-backtest-trades-view-${this.tradeView}`);
    panel.tabIndex = 0;
    card.append(heading, panel);
    container.appendChild(card);
    return container;
  }

  private renderTradeTable(trades: readonly BacktestTrade[]): HTMLElement {
    const tableWrap = createElement(this.doc, 'div', 'quant-backtest-table-wrap');
    const table = createElement(this.doc, 'table', 'quant-backtest-trade-table');
    const caption = createElement(this.doc, 'caption');
    caption.textContent = `${trades.length} trades`;
    table.appendChild(caption);
    const head = createElement(this.doc, 'thead');
    const row = createElement(this.doc, 'tr');
    const hasSize = backtestTradesHaveSize(trades);
    const hasExcursions = backtestTradesHaveExcursions(trades);
    // The reference desktop log has a stable eight-column geometry when the
    // report publishes Size, MFE and MAE. Keep that contract opt-in: reports
    // without optional columns must retain the content-sized table and the
    // narrow layout must continue to use its horizontal scroller.
    if (hasSize && hasExcursions) table.dataset.tradeLayout = 'full';
    const columns: Array<{ key: string; label: string; sort?: BacktestTradeSortKey; tooltip?: string }> = [
      { key: 'number', label: 'Trade #', sort: 'number' },
      { key: 'entryTime', label: 'Entry', sort: 'entryTime' },
      { key: 'exitTime', label: 'Exit', sort: 'exitTime' },
      ...(hasSize ? [{ key: 'size', label: 'Size', sort: 'size' as const }] : []),
      { key: 'netPnl', label: 'Net P&L', sort: 'netPnl' },
      ...(hasExcursions ? [
        { key: 'mfe', label: 'MFE', sort: 'mfe' as const, tooltip: TRADE_EXCURSION_TOOLTIPS.mfe },
        { key: 'mae', label: 'MAE', sort: 'mae' as const, tooltip: TRADE_EXCURSION_TOOLTIPS.mae },
      ] : []),
      { key: 'cumulativePnl', label: 'Cumulative P&L', sort: 'cumulativePnl' },
    ];
    if (hasSize && hasExcursions) {
      // Keep the measured desktop widths in the stylesheet, but emit a
      // colgroup so the fixed-layout rule remains independent of row content.
      // Mobile intentionally ignores those widths and keeps the horizontal
      // scroller used by the reference narrow layout.
      const colgroup = createElement(this.doc, 'colgroup');
      for (let index = 0; index < columns.length; index += 1) {
        colgroup.appendChild(createElement(this.doc, 'col'));
      }
      table.appendChild(colgroup);
    }
    columns.forEach((column) => {
      const th = createElement(this.doc, 'th');
      th.scope = 'col';
      if (column.sort) {
        const control = button(this.doc, '', 'quant-backtest-sort');
        control.dataset.tradeSort = column.sort;
        const controlLabel = createElement(this.doc, 'span');
        controlLabel.textContent = column.label;
        if (column.tooltip) {
          controlLabel.title = column.tooltip;
          control.title = column.tooltip;
          control.setAttribute('aria-label', `${column.label}: ${column.tooltip}`);
        }
        const sortState = this.tradeSort.key === column.sort
          ? this.tradeSort.direction === 1 ? 'ascending' : 'descending'
          : 'not sorted';
        // Preserve the reference tooltip names for MFE/MAE (the E2E contract
        // uses them as stable accessible labels) while giving plain headers a
        // useful sort state announcement.
        if (!column.tooltip) control.setAttribute('aria-label', `${column.label}, ${sortState}`);
        control.appendChild(controlLabel);
        if (this.tradeSort.key === column.sort) {
          control.appendChild(icon(this.doc, this.tradeSort.direction === 1 ? 'chevron-up' : 'chevron-down', 12));
        }
        control.addEventListener('click', () => this.toggleTradeSort(column.sort as BacktestTradeSortKey));
        th.appendChild(control);
        th.setAttribute('aria-sort', this.tradeSort.key === column.sort ? (this.tradeSort.direction === 1 ? 'ascending' : 'descending') : 'none');
      } else {
        th.textContent = column.label;
      }
      row.appendChild(th);
    });
    head.appendChild(row);
    table.appendChild(head);
    const body = createElement(this.doc, 'tbody');
    const sorted = this.getSortedTradeEntries(trades);
    const tradeWindow = getBacktestTradeWindow(sorted, this.tradePage, TRADES_PAGE_SIZE);
    this.tradePage = tradeWindow.page;
    table.setAttribute('aria-rowcount', String(Math.max(1, sorted.length + 1)));
    table.dataset.totalTradeCount = String(sorted.length);
    table.dataset.renderedTradeCount = String(tradeWindow.entries.length);
    table.dataset.tradeWindowStart = String(tradeWindow.start);
    table.dataset.tradeWindowEnd = String(tradeWindow.end);
    row.setAttribute('aria-rowindex', '1');
    if (sorted.length === 0) {
      const emptyRow = createElement(this.doc, 'tr');
      const emptyCell = createElement(this.doc, 'td');
      emptyCell.colSpan = columns.length;
      emptyCell.appendChild(renderEmpty(this.doc, 'No trades in this report'));
      emptyRow.appendChild(emptyCell);
      body.appendChild(emptyRow);
    } else {
      const currency = reportCurrency(this.report as BacktestReport).toUpperCase();
      const timezone = reportTimezone(this.report as BacktestReport);
      const canLocate = Boolean(
        this.callbacks.onTradeLocate
        && this.report?.capabilities?.canLocateTrades !== false,
      );
      const metricKeys = hasExcursions
        ? (['mfe', 'mae', 'cumulativePnl'] as const)
        : (['cumulativePnl'] as const);

      // A page contains at most 200 rows, but each row previously required
      // dozens of DOM nodes plus two listener closures.  Build the bounded
      // page as one HTML fragment and use one delegated listener below.  This
      // preserves the exact classes/ARIA/data attributes while making page
      // turns independent of the full report size and materially reducing
      // Chromium's synchronous DOM cost.
      const rowMarkup = tradeWindow.entries.map(({ trade, sourceIndex }, index) => {
        const number = escapeHtml(backtestTradeDisplayNumber(trade, sourceIndex ?? index));
        const direction = trade.direction === 'long' || trade.direction === 'short'
          ? `<span class="quant-backtest-direction-badge quant-backtest-direction-${trade.direction}">${trade.direction}</span>`
          : '';
        const timeCell = (side: 'entry' | 'exit'): string => {
          const value = side === 'entry' ? trade.entryTime : trade.exitTime;
          const price = side === 'entry' ? trade.entryPrice : trade.exitPrice;
          const openExit = side === 'exit' && trade.status === 'open';
          const displayTime = openExit && (value === null || value === undefined || value === '') ? null : value;
          const hasLocation = !openExit && canLocate && isBacktestTradeLocationTime(value);
          const label = `Show ${side} on chart`;
          const locate = hasLocation
            ? `<button type="button" class="quant-backtest-locate" data-trade-locate="${side}" data-trade-source-index="${sourceIndex}" aria-label="${label}" title="${label}">${CROSSHAIR_ICON_MARKUP}</button>`
            : '';
          return `<td class="quant-backtest-trade-time"><span class="quant-backtest-trade-time-details">`
            + `<span class="quant-backtest-trade-datetime" data-timezone="${escapeHtml(timezone)}" title="Displayed in ${escapeHtml(timezone)}">${escapeHtml(openExit ? 'Open' : formatTradeDateTime(displayTime, timezone))}</span>`
            + `<span class="quant-backtest-trade-price">${tradeMoneyMarkup(formatTradePrice(price, currency), currency)}</span>`
            + `</span>${locate}</td>`;
        };
        const size = hasSize
          ? `<td>${escapeHtml(formatBacktestTradeMetric(backtestTradeSizeValue(trade.size)))}</td>`
          : '';
        const pnl = formatBacktestTradeMetric(trade.netPnl, currency, true);
        const metrics = metricKeys.map((key) => {
          const value = trade[key as 'mfe' | 'mae' | 'cumulativePnl'];
          const displayValue = key === 'mfe' || key === 'mae'
            ? backtestTradeExcursionValue(key, value)
            : value;
          return `<td>${tradeMoneyMarkup(formatBacktestTradeMetric(displayValue, currency, key === 'cumulativePnl'), currency)}</td>`;
        }).join('');
        return `<tr aria-rowindex="${tradeWindow.start + index + 2}" data-trade-source-index="${sourceIndex}">`
          + `<th scope="row" class="quant-backtest-trade-number"><span class="quant-backtest-trade-number-value">${number}</span>${direction}</th>`
          + timeCell('entry')
          + timeCell('exit')
          + size
          + `<td class="quant-backtest-tone-${toneFor(trade.netPnl ?? null)}">${tradeMoneyMarkup(pnl, currency)}</td>`
          + metrics
          + '</tr>';
      }).join('');
      body.innerHTML = rowMarkup;
      body.addEventListener('click', (event) => {
        const target = event.target instanceof Element
          ? event.target.closest<HTMLButtonElement>('button[data-trade-locate]')
          : null;
        if (!target || !body.contains(target)) return;
        const sourceIndex = Number(target.dataset.tradeSourceIndex);
        if (!Number.isSafeInteger(sourceIndex)) return;
        const entry = sorted.find((candidate) => candidate.sourceIndex === sourceIndex);
        const side = target.dataset.tradeLocate;
        if (!entry || (side !== 'entry' && side !== 'exit')) return;
        this.callbacks.onTradeLocate?.(entry.trade, side);
      });
    }
    table.appendChild(body);
    tableWrap.appendChild(table);
    if (sorted.length > TRADES_PAGE_SIZE) {
      tableWrap.appendChild(this.renderTradePagination(sorted.length, tradeWindow.totalPages));
    }
    return tableWrap;
  }

  private getSortedTradeEntries(
    trades: readonly BacktestTrade[],
  ): readonly BacktestTradeEntry[] {
    const cache = this.tradeSortedCache;
    if (cache
      && cache.trades === trades
      && cache.key === this.tradeSort.key
      && cache.direction === this.tradeSort.direction) {
      return cache.sorted;
    }
    const sorted = sortBacktestTradeEntries(trades, this.tradeSort);
    this.tradeSortedCache = {
      trades,
      key: this.tradeSort.key,
      direction: this.tradeSort.direction,
      sorted,
    };
    return sorted;
  }

  private renderTradePagination(totalTrades: number, totalPages: number): HTMLElement {
    const pagination = createElement(this.doc, 'nav', 'quant-backtest-trade-pagination');
    pagination.setAttribute('aria-label', 'Trades Log pages');
    pagination.dataset.tradePage = String(this.tradePage);
    pagination.dataset.tradePageSize = String(TRADES_PAGE_SIZE);
    pagination.dataset.tradeTotal = String(totalTrades);
    const previous = button(this.doc, 'Previous', 'quant-backtest-button quant-backtest-trade-pagination-button');
    previous.dataset.tradePagination = 'previous';
    previous.disabled = this.tradePage <= 0;
    previous.addEventListener('click', () => {
      if (this.tradePage <= 0) return;
      this.tradePage -= 1;
      this.refreshTradeTable();
      this.focusTradePagination('previous');
    });
    const next = button(this.doc, 'Next', 'quant-backtest-button quant-backtest-trade-pagination-button');
    next.dataset.tradePagination = 'next';
    next.disabled = this.tradePage >= totalPages - 1;
    next.addEventListener('click', () => {
      if (this.tradePage >= totalPages - 1) return;
      this.tradePage += 1;
      this.refreshTradeTable();
      this.focusTradePagination('next');
    });
    const status = createElement(this.doc, 'span', 'quant-backtest-trade-pagination-status');
    const from = this.tradePage * TRADES_PAGE_SIZE + 1;
    const to = Math.min(totalTrades, from + TRADES_PAGE_SIZE - 1);
    status.textContent = `${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${totalTrades.toLocaleString('en-US')} trades · page ${this.tradePage + 1} of ${totalPages}`;
    status.setAttribute('aria-live', 'polite');
    pagination.append(previous, status, next);
    return pagination;
  }

  private focusTradePagination(preferred: 'previous' | 'next'): void {
    // At the first/last page the activated control becomes disabled. Focus
    // the remaining enabled page control instead of losing keyboard focus
    // when the old table subtree is removed.
    const target = this.element.querySelector<HTMLButtonElement>(
      `[data-trade-pagination="${preferred}"]:not(:disabled)`,
    ) ?? this.element.querySelector<HTMLButtonElement>('[data-trade-pagination]:not(:disabled)');
    if (target && this.doc.activeElement !== target) target.focus();
  }

  /**
   * Replace only the paged table subtree after a Trades Log page change.
   * Rebuilding the complete Viewer here needlessly tears down report charts,
   * toolbar listeners, and the surrounding tab panel; it also makes a 200-row
   * page transition pay the cost of every other Viewer surface.  Keep a safe
   * full-render fallback for calls made while the log is not mounted (for
   * example during a report revision or a stale event).
   */
  private refreshTradeTable(): void {
    if (!this.openState || this.activeTab !== 'log' || !this.report) {
      this.render();
      return;
    }
    const current = this.panel.querySelector<HTMLElement>(
      '.quant-backtest-trades-log .quant-backtest-table-wrap',
    );
    if (!current) {
      this.render();
      return;
    }
    const replacement = this.renderTradeTable(this.report.trades ?? []);
    const currentTable = current.querySelector<HTMLTableElement>('.quant-backtest-trade-table');
    const nextTable = replacement.querySelector<HTMLTableElement>('.quant-backtest-trade-table');
    const currentPagination = current.querySelector<HTMLElement>('.quant-backtest-trade-pagination');
    const nextPagination = replacement.querySelector<HTMLElement>('.quant-backtest-trade-pagination');
    if (currentTable && nextTable && currentPagination && nextPagination) {
      // Retain the active pager and the scroll/tab panel instead of removing
      // focus and immediately forcing a full 200-row layout to restore it.
      // Existing listeners read this.tradePage; only their display state
      // changes while paging within the same report.
      currentTable.replaceWith(nextTable);
      Object.assign(currentPagination.dataset, nextPagination.dataset);
      for (const side of ['previous', 'next']) {
        const control = currentPagination.querySelector<HTMLButtonElement>(`[data-trade-pagination="${side}"]`);
        const nextControl = nextPagination.querySelector<HTMLButtonElement>(`[data-trade-pagination="${side}"]`);
        if (control && nextControl) control.disabled = nextControl.disabled;
      }
      const status = currentPagination.querySelector('.quant-backtest-trade-pagination-status');
      const nextStatus = nextPagination.querySelector('.quant-backtest-trade-pagination-status');
      if (status && nextStatus) status.textContent = nextStatus.textContent;
      return;
    }
    // Pagination only replaces the list subtree, whose tabpanel semantics
    // were originally assigned by renderTradesLog. Carry them forward so
    // screen-reader and keyboard navigation still reach the same panel.
    for (const name of ['role', 'id', 'aria-labelledby', 'tabindex']) {
      const value = current.getAttribute(name);
      if (value !== null) replacement.setAttribute(name, value);
    }
    current.replaceWith(replacement);
  }

  private renderTradeCalendar(trades: readonly BacktestTrade[]): HTMLElement {
    const report = this.requireReport();
    const timezone = report.timezone ?? 'UTC';
    const reportRevision = report.runId !== undefined || report.revision !== undefined
      ? `${report.key?.cellId ?? ''}:${report.key?.indicatorId ?? ''}:${report.runId ?? ''}:${report.revision ?? ''}`
      : null;
    let cache = this.tradeCalendarCache;
    const sameLedger = cache !== null
      && cache.reportRevision === reportRevision
      && cache.trades === trades;
    if (
      !sameLedger
      || cache?.timezone !== timezone
    ) {
      cache = {
        trades,
        reportRevision,
        timezone,
        days: aggregateBacktestTradeCalendar(trades, timezone),
      };
      this.tradeCalendarCache = cache;
    }
    const month = isCalendarMonthKey(this.tradeCalendarMonth)
      ? this.tradeCalendarMonth
      : currentCalendarMonthKey();
    this.tradeCalendarMonth = month;
    return renderBacktestTradeCalendar(this.doc, {
      days: cache.days,
      currency: reportCurrency(report),
      month,
      onMonthChange: (nextMonth, focusTarget) => {
        this.tradeCalendarMonth = nextMonth;
        this.render();
        this.element.querySelector<HTMLButtonElement>(
          `[data-calendar-navigation="${focusTarget}"]`,
        )?.focus();
      },
    });
  }

  private toggleTradeSort(key: BacktestTradeSortKey): void {
    this.tradeSort = nextBacktestTradeSort(this.tradeSort, key);
    this.tradePage = 0;
    this.tradeSortedCache = null;
    this.render();
    this.element.querySelector<HTMLButtonElement>(`[data-trade-sort="${key}"]`)?.focus();
  }

  private renderSimulation(): HTMLElement {
    const report = this.requireReport();
    return renderSimulationView({
      document: this.doc,
      report,
      settingsOpen: this.simulationSettingsOpen,
      onSettingsOpenChange: (open) => this.setSimulationSettingsOpen(open),
      onChange: (change) => {
        const reportKey = this.report
          ? `${this.report.key?.cellId ?? ''}:${this.report.key?.indicatorId ?? ''}:${this.report.runId ?? ''}:${this.report.revision ?? ''}:${this.report.simulationRun?.requestId ?? ''}:${this.report.simulationRun?.status ?? ''}`
          : '';
        const signature = `${reportKey}:${JSON.stringify(change)}`;
        if (signature === this.lastSimulationSignature) return;
        this.lastSimulationSignature = signature;
        this.callbacks.onSimulationChange?.(change);
      },
    });
  }

  private setSimulationSettingsOpen(open: boolean): void {
    if (this.simulationSettingsOpen === open || this.activeTab !== 'simulation') return;
    if (open) {
      const trigger = this.doc.activeElement;
      if (trigger instanceof HTMLElement && trigger.dataset.simulationSettingsTrigger === 'mobile') {
        this.simulationSettingsReturnTarget = 'mobile';
      } else {
        this.simulationSettingsReturnTarget = 'desktop';
      }
    }
    if (!open) this.pendingSimulationFocus = null;
    this.simulationSettingsOpen = open;
    this.render();
    queueMicrotask(() => {
      if (this.destroyed || !this.openState || this.activeTab !== 'simulation') return;
      if (open) {
        this.panel.querySelector<HTMLElement>('.quant-backtest-simulation-settings-dialog')?.focus();
        return;
      }
      const focusable = focusableElements(this.element);
      const preferred = focusable.find(
        (candidate) => candidate.dataset.simulationSettingsTrigger
          === this.simulationSettingsReturnTarget,
      );
      const fallback = focusable.find(
        (candidate) => candidate.dataset.simulationSettingsTrigger !== undefined,
      );
      (preferred ?? fallback ?? this.tabs.find((tab) => tab.dataset.tab === 'simulation') ?? this.panel)
        .focus();
    });
  }

  private requireReport(): BacktestReport {
    if (!this.report) throw new Error('Backtest viewer report is not available');
    return this.report;
  }
}
