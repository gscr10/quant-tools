import type {
  BacktestComparison,
  BacktestMetricValue,
  BacktestPoint,
  BacktestReport,
} from './backtest-types.ts';
import {
  registerReportChart,
  type ReportChartPoint,
  type ReportChartSeries,
} from './highcharts-renderer.ts';
import { formatBacktestTradeValue } from './trade-log.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROFIT_COLOR = '#089981';
const LOSS_COLOR = '#f23645';
const BREAKEVEN_COLOR = '#ff9800';
const NEUTRAL_COLOR = '#71717a';

type ComparisonColumn = keyof BacktestComparison;
type AnalysisValueKind = 'count' | 'percent' | 'currency' | 'number';

interface AnalysisTableRow {
  readonly key: string;
  readonly label: string;
  readonly kind: AnalysisValueKind;
  readonly colorize?: boolean;
  readonly nullAsZero?: boolean;
}

const COMPARISON_COLUMNS: ReadonlyArray<{ readonly id: ComparisonColumn; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'long', label: 'Long' },
  { id: 'short', label: 'Short' },
];

const TRADE_ROWS: readonly AnalysisTableRow[] = [
  { key: 'trades', label: 'Closed Trades', kind: 'count' },
  { key: 'winningTrades', label: 'Winning Trades', kind: 'count' },
  { key: 'losingTrades', label: 'Losing Trades', kind: 'count' },
  { key: 'breakevenTrades', label: 'Breakeven Trades', kind: 'count' },
  { key: 'winRate', label: 'Win Rate', kind: 'percent' },
  { key: 'averageTrade', label: 'Avg P&L', kind: 'currency', colorize: true },
  { key: 'averageWinner', label: 'Avg Winning Trade', kind: 'currency' },
  { key: 'averageLoser', label: 'Avg Losing Trade', kind: 'currency' },
  { key: 'largestWinner', label: 'Largest Winning Trade', kind: 'currency' },
  { key: 'largestLoser', label: 'Largest Losing Trade', kind: 'currency' },
];

const DURATION_ROWS: readonly AnalysisTableRow[] = [
  { key: 'averageDurationBars', label: 'Avg Trade Duration (bars)', kind: 'number', nullAsZero: true },
  { key: 'averageWinningDurationBars', label: 'Avg Winning Trade Duration (bars)', kind: 'number', nullAsZero: true },
  { key: 'averageLosingDurationBars', label: 'Avg Losing Trade Duration (bars)', kind: 'number', nullAsZero: true },
  { key: 'averageTradesPerDay', label: 'Avg Trades per Day', kind: 'number', nullAsZero: true },
  { key: 'averageTradesPerWeek', label: 'Avg Trades per Week', kind: 'number', nullAsZero: true },
  { key: 'longestDurationBars', label: 'Longest Trade (bars)', kind: 'number' },
  { key: 'shortestDurationBars', label: 'Shortest Trade (bars)', kind: 'number' },
  { key: 'longestWinningStreakBars', label: 'Longest Winning Streak (bars)', kind: 'number' },
  { key: 'longestLosingStreakBars', label: 'Longest Losing Streak (bars)', kind: 'number' },
];

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

function finite(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

function unwrapMetric(value: BacktestMetricValue | undefined): number | null {
  if (typeof value === 'number') return finite(value);
  if (!value) return null;
  return finite(value.value);
}

function reportCurrency(report: BacktestReport): string {
  const currency = report.currency?.trim();
  return currency ? currency.toUpperCase() : 'USD';
}

function formatNumber(value: number | null, digits: number): string {
  if (value === null) return '-';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatTradeAnalysisValue(
  value: BacktestMetricValue | undefined,
  kind: AnalysisValueKind,
  currency: string,
  nullAsZero = false,
): string {
  const number = unwrapMetric(value) ?? (nullAsZero ? 0 : null);
  if (number === null) return '-';
  if (kind === 'count') return formatNumber(number, 0);
  if (kind === 'percent') return `${formatNumber(number, 2)}%`;
  if (kind === 'currency') return `${formatBacktestTradeValue(number)} ${currency}`;
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function chartTitle(doc: Document, text: string): HTMLHeadingElement {
  const title = createElement(doc, 'h4', 'quant-backtest-analysis-chart-title');
  title.textContent = text;
  return title;
}

function emptyChart(doc: Document): HTMLElement {
  const empty = createElement(doc, 'div', 'quant-backtest-analysis-chart-empty');
  empty.textContent = 'No data available';
  return empty;
}

function analysisPoint(point: BacktestPoint, fallbackX: number): ReportChartPoint | null {
  const y = finite(point.y);
  const x = finite(point.x) ?? fallbackX;
  if (y === null) return null;
  return {
    x,
    y,
    ...(point.label ? { label: point.label } : {}),
    ...(point.color ? { color: point.color } : {}),
    ...(finite(point.from) === null ? {} : { from: point.from }),
    ...(finite(point.to) === null ? {} : { to: point.to }),
    ...(point.direction ? { direction: point.direction } : {}),
    ...(point.time === undefined ? {} : { time: point.time }),
  };
}

function renderPnlDistribution(doc: Document, report: BacktestReport): HTMLElement {
  const analysis = report.analysis;
  const frame = createElement(doc, 'section', 'quant-backtest-analysis-chart quant-backtest-analysis-distribution');
  const title = `P&L Distribution (${reportCurrency(report)})`;
  frame.appendChild(chartTitle(doc, title));
  const points = (analysis?.pnlDistribution ?? []).flatMap((point, index) => {
    const normalized = analysisPoint(point, index);
    return normalized ? [normalized] : [];
  });
  if (points.length === 0) {
    frame.appendChild(emptyChart(doc));
    return frame;
  }

  const host = createElement(doc, 'div', 'quant-backtest-analysis-chart-host quant-backtest-analysis-distribution-host');
  const svg = createSvgElement(doc, 'svg');
  svg.classList.add('quant-backtest-analysis-fallback-chart');
  svg.setAttribute('viewBox', '0 0 640 200');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const plotLeft = 36;
  const plotRight = 626;
  const plotTop = 12;
  const plotBottom = 164;
  const boundaries = points.flatMap((point) => [finite(point.from), finite(point.to), point.x])
    .filter((value): value is number => value !== null);
  const minX = Math.min(...boundaries);
  const maxX = Math.max(...boundaries);
  const spanX = maxX - minX || 1;
  const maxY = Math.max(1, ...points.map((point) => point.y));
  const xAt = (value: number) => plotLeft + ((value - minX) / spanX) * (plotRight - plotLeft);
  const yAt = (value: number) => plotBottom - (value / maxY) * (plotBottom - plotTop);
  const grid = createSvgElement(doc, 'path');
  grid.setAttribute('class', 'quant-backtest-chart-grid-lines');
  grid.setAttribute('d', `M${plotLeft} ${plotTop}H${plotRight}M${plotLeft} ${(plotTop + plotBottom) / 2}H${plotRight}M${plotLeft} ${plotBottom}H${plotRight}`);
  svg.appendChild(grid);
  points.forEach((point, index) => {
    const from = finite(point.from);
    const to = finite(point.to);
    const inferredWidth = (plotRight - plotLeft) / Math.max(1, points.length);
    const left = from === null ? plotLeft + inferredWidth * index : xAt(from);
    const right = to === null ? left + inferredWidth : xAt(to);
    const rect = createSvgElement(doc, 'rect');
    rect.setAttribute('class', 'quant-backtest-analysis-histogram-bar');
    rect.setAttribute('x', String(left + 1));
    rect.setAttribute('y', String(yAt(point.y)));
    rect.setAttribute('width', String(Math.max(1, right - left - 2)));
    rect.setAttribute('height', String(Math.max(1, plotBottom - yAt(point.y))));
    rect.setAttribute('fill', point.color ?? (point.x >= 0 ? PROFIT_COLOR : LOSS_COLOR));
    const tooltip = createSvgElement(doc, 'title');
    tooltip.textContent = `${formatNumber(from ?? point.x, 2)} – ${formatNumber(to ?? point.x, 2)}: ${formatNumber(point.y, 0)} trades`;
    rect.appendChild(tooltip);
    svg.appendChild(rect);
  });
  const references = (analysis?.pnlReferenceLines ?? []).flatMap((point) => {
    const value = finite(point.y);
    return value === null ? [] : [{ value, label: String(point.x), color: point.color ?? NEUTRAL_COLOR }];
  });
  references.forEach((reference) => {
    const line = createSvgElement(doc, 'path');
    const x = xAt(reference.value);
    line.setAttribute('class', 'quant-backtest-analysis-reference-line');
    line.setAttribute('stroke', reference.color);
    line.setAttribute('d', `M${x} ${plotTop}V${plotBottom}`);
    svg.appendChild(line);
  });
  host.appendChild(svg);
  frame.appendChild(host);
  const firstBoundary = finite(points[0]?.from);
  const lastBoundary = finite(points.at(-1)?.to);
  const binWidth = firstBoundary === null
    ? null
    : finite(points[0]?.to) === null
      ? null
      : (points[0].to as number) - firstBoundary;
  registerReportChart(host, {
    kind: 'column',
    label: title,
    axis: 'linear',
    points,
    height: 200,
    tooltipMode: 'distribution',
    xAxisLabelRotation: -45,
    xAxisLabelDecimals: 2,
    ...(firstBoundary === null ? {} : { xAxisMin: firstBoundary }),
    ...(lastBoundary === null ? {} : { xAxisMax: lastBoundary }),
    ...(binWidth === null || binWidth <= 0 ? {} : {
      xAxisTickInterval: binWidth,
      columnPointRange: binWidth,
    }),
    columnBorderRadius: 2,
    plotLines: references.map((reference) => ({
      axis: 'x',
      value: reference.value,
      color: reference.color,
      width: 2,
      dashStyle: 'Dash',
    })),
  });

  const legend = createElement(doc, 'div', 'quant-backtest-analysis-legend quant-backtest-analysis-reference-legend');
  references.forEach((reference) => {
    const item = createElement(doc, 'span', 'quant-backtest-analysis-legend-item');
    const swatch = createElement(doc, 'span', 'quant-backtest-analysis-legend-line');
    swatch.style.borderColor = reference.color;
    const label = createElement(doc, 'span');
    label.textContent = reference.label;
    item.append(swatch, label);
    legend.appendChild(item);
  });
  frame.appendChild(legend);
  return frame;
}

function winRateColor(category: string, color?: string): string {
  if (color) return color;
  const key = category.toLowerCase();
  if (key.includes('winner')) return PROFIT_COLOR;
  if (key.includes('loser')) return LOSS_COLOR;
  return BREAKEVEN_COLOR;
}

function winRateLabel(category: string): string {
  const key = category.toLowerCase();
  if (key.includes('winner')) return 'winners';
  if (key.includes('loser')) return 'losers';
  return 'breakevens';
}

function renderWinRateDonut(doc: Document, report: BacktestReport): HTMLElement {
  const analysis = report.analysis;
  const frame = createElement(doc, 'section', 'quant-backtest-analysis-chart quant-backtest-analysis-winrate');
  frame.appendChild(chartTitle(doc, 'Winrate'));
  const values = (analysis?.winRateBreakdown ?? []).flatMap((point, index) => {
    const count = finite(point.y);
    if (count === null || count < 0) return [];
    const category = String(point.x);
    if (count === 0 && category.toLowerCase().includes('breakeven')) return [];
    return [{
      x: index,
      y: count,
      category,
      label: category,
      color: winRateColor(category, point.color),
    } satisfies ReportChartPoint];
  });
  if (values.length === 0) {
    frame.appendChild(emptyChart(doc));
    return frame;
  }
  const body = createElement(doc, 'div', 'quant-backtest-analysis-winrate-body');
  const chart = createElement(doc, 'div', 'quant-backtest-analysis-donut');
  const host = createElement(doc, 'div', 'quant-backtest-analysis-chart-host quant-backtest-analysis-donut-host');
  const svg = createSvgElement(doc, 'svg');
  svg.classList.add('quant-backtest-analysis-fallback-chart');
  svg.setAttribute('viewBox', '0 0 220 180');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Winrate');
  const total = values.reduce((sum, point) => sum + point.y, 0);
  const radius = 62;
  const circumference = Math.PI * 2 * radius;
  let offset = 0;
  values.forEach((point) => {
    const circle = createSvgElement(doc, 'circle');
    const length = total > 0 ? (point.y / total) * circumference : 0;
    circle.setAttribute('class', 'quant-backtest-analysis-donut-segment');
    circle.setAttribute('cx', '110');
    circle.setAttribute('cy', '90');
    circle.setAttribute('r', String(radius));
    circle.setAttribute('stroke', point.color ?? NEUTRAL_COLOR);
    circle.setAttribute('stroke-dasharray', `${length} ${circumference - length}`);
    circle.setAttribute('stroke-dashoffset', String(-offset));
    const tooltip = createSvgElement(doc, 'title');
    tooltip.textContent = `${point.category}: ${formatNumber(point.y, 0)}`;
    circle.appendChild(tooltip);
    svg.appendChild(circle);
    offset += length;
  });
  host.appendChild(svg);
  chart.appendChild(host);
  const center = createElement(doc, 'div', 'quant-backtest-analysis-donut-center');
  const centerValue = createElement(doc, 'strong');
  const percent = finite(analysis?.winRatePercent)
    ?? (total > 0
      ? ((values.find((point) => point.category?.toLowerCase().includes('winner'))?.y ?? 0) / total) * 100
      : 0);
  centerValue.textContent = `${formatNumber(Math.round(percent), 0)}%`;
  const centerLabel = createElement(doc, 'span');
  centerLabel.textContent = 'WINRATE';
  center.append(centerValue, centerLabel);
  chart.appendChild(center);
  registerReportChart(host, {
    kind: 'pie',
    label: 'Winrate',
    axis: 'category',
    categories: values.map((point) => point.category ?? point.label ?? ''),
    points: values,
    height: 180,
    innerSize: '75%',
    tooltipMode: 'winrate',
  });
  body.appendChild(chart);

  const legend = createElement(doc, 'div', 'quant-backtest-analysis-winrate-legend');
  values.forEach((point) => {
    const item = createElement(doc, 'div', 'quant-backtest-analysis-winrate-legend-item');
    const marker = createElement(doc, 'span', 'quant-backtest-analysis-legend-dot');
    marker.style.backgroundColor = point.color ?? NEUTRAL_COLOR;
    const copy = createElement(doc, 'span');
    const count = createElement(doc, 'strong');
    count.textContent = formatNumber(point.y, 0);
    const label = createElement(doc, 'small');
    label.textContent = winRateLabel(point.category ?? '');
    copy.append(count, label);
    item.append(marker, copy);
    legend.appendChild(item);
  });
  body.appendChild(legend);
  frame.appendChild(body);
  return frame;
}

function renderAnalysisTable(
  doc: Document,
  comparison: BacktestComparison | undefined,
  rows: readonly AnalysisTableRow[],
  currency: string,
  captionText: string,
): HTMLTableElement {
  const table = createElement(doc, 'table', 'quant-backtest-analysis-table');
  const caption = createElement(doc, 'caption');
  caption.textContent = captionText;
  table.appendChild(caption);
  const head = createElement(doc, 'thead');
  const headRow = createElement(doc, 'tr');
  const metricHead = createElement(doc, 'th');
  metricHead.scope = 'col';
  metricHead.setAttribute('aria-label', 'Metric');
  const metricHeadLabel = createElement(doc, 'span', 'quant-backtest-visually-hidden');
  metricHeadLabel.textContent = 'Metric';
  metricHead.appendChild(metricHeadLabel);
  headRow.appendChild(metricHead);
  COMPARISON_COLUMNS.forEach((column) => {
    const cell = createElement(doc, 'th');
    cell.scope = 'col';
    cell.textContent = column.label;
    headRow.appendChild(cell);
  });
  head.appendChild(headRow);
  table.appendChild(head);
  const body = createElement(doc, 'tbody');
  rows.forEach((row) => {
    const tableRow = createElement(doc, 'tr');
    const label = createElement(doc, 'th');
    label.scope = 'row';
    label.textContent = row.label;
    tableRow.appendChild(label);
    COMPARISON_COLUMNS.forEach((column) => {
      const cell = createElement(doc, 'td');
      const value = comparison?.[column.id]?.[row.key];
      cell.textContent = formatTradeAnalysisValue(value, row.kind, currency, row.nullAsZero);
      if (row.colorize) {
        const number = unwrapMetric(value);
        cell.classList.add(number === null || number === 0
          ? 'quant-backtest-analysis-value-neutral'
          : number > 0
            ? 'quant-backtest-analysis-value-positive'
            : 'quant-backtest-analysis-value-negative');
      }
      tableRow.appendChild(cell);
    });
    body.appendChild(tableRow);
  });
  table.appendChild(body);
  return table;
}

function renderDurationScatter(doc: Document, report: BacktestReport): HTMLElement {
  const currency = reportCurrency(report);
  const title = `Duration vs P&L (${currency})`;
  const frame = createElement(doc, 'section', 'quant-backtest-analysis-chart quant-backtest-analysis-duration-chart');
  frame.appendChild(chartTitle(doc, title));
  const points = (report.analysis?.durationPnl ?? []).flatMap((point, index) => {
    const normalized = analysisPoint(point, index);
    return normalized ? [normalized] : [];
  });
  if (points.length === 0) {
    frame.appendChild(emptyChart(doc));
    return frame;
  }
  const trades = points.map((point) => ({
    ...point,
    color: point.color ?? (point.y >= 0 ? PROFIT_COLOR : LOSS_COLOR),
  }));
  const trendPoints = (report.analysis?.durationTrend ?? []).flatMap((point, index) => {
    const normalized = analysisPoint(point, index);
    return normalized ? [normalized] : [];
  });
  const trend: ReportChartSeries | null = trendPoints.length === 2
    ? {
      name: 'Trend',
      kind: 'line',
      color: NEUTRAL_COLOR,
      dashStyle: 'Dash',
      showInLegend: false,
      enableMouseTracking: false,
      markerEnabled: false,
      points: trendPoints,
    }
    : null;
  const series: ReportChartSeries[] = [
    { name: 'Trade', kind: 'scatter', points: trades },
    ...(trend ? [trend] : []),
  ];
  const host = createElement(doc, 'div', 'quant-backtest-analysis-chart-host quant-backtest-analysis-duration-host');
  const svg = createSvgElement(doc, 'svg');
  svg.classList.add('quant-backtest-analysis-fallback-chart');
  svg.setAttribute('viewBox', '0 0 960 250');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  const plotLeft = 48;
  const plotRight = 946;
  const plotTop = 12;
  const plotBottom = 214;
  const minX = Math.min(0, ...points.map((point) => point.x));
  const maxX = Math.max(1, ...points.map((point) => point.x));
  const minY = Math.min(0, ...points.map((point) => point.y));
  const maxY = Math.max(0, ...points.map((point) => point.y));
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const xAt = (value: number) => plotLeft + ((value - minX) / spanX) * (plotRight - plotLeft);
  const yAt = (value: number) => plotBottom - ((value - minY) / spanY) * (plotBottom - plotTop);
  const grid = createSvgElement(doc, 'path');
  grid.setAttribute('class', 'quant-backtest-chart-grid-lines');
  grid.setAttribute('d', `M${plotLeft} ${plotTop}H${plotRight}M${plotLeft} ${(plotTop + plotBottom) / 2}H${plotRight}M${plotLeft} ${plotBottom}H${plotRight}`);
  svg.appendChild(grid);
  const zero = createSvgElement(doc, 'path');
  zero.setAttribute('class', 'quant-backtest-chart-zero');
  zero.setAttribute('d', `M${plotLeft} ${yAt(0)}H${plotRight}`);
  svg.appendChild(zero);
  if (trend) {
    const line = createSvgElement(doc, 'path');
    line.setAttribute('class', 'quant-backtest-analysis-trend-line');
    line.setAttribute('d', `M${xAt(trend.points[0].x)} ${yAt(trend.points[0].y)}L${xAt(trend.points[1].x)} ${yAt(trend.points[1].y)}`);
    svg.appendChild(line);
  }
  points.forEach((point) => {
    const marker = createSvgElement(doc, 'circle');
    marker.setAttribute('class', 'quant-backtest-analysis-scatter-point');
    marker.setAttribute('cx', String(xAt(point.x)));
    marker.setAttribute('cy', String(yAt(point.y)));
    marker.setAttribute('r', '4');
    marker.setAttribute('fill', point.color ?? (point.y >= 0 ? PROFIT_COLOR : LOSS_COLOR));
    const tooltip = createSvgElement(doc, 'title');
    tooltip.textContent = `${point.label ?? 'Trade'}: ${formatNumber(point.y, 2)} ${currency}, ${formatNumber(point.x, 2)} bars`;
    marker.appendChild(tooltip);
    svg.appendChild(marker);
  });
  host.appendChild(svg);
  frame.appendChild(host);
  registerReportChart(host, {
    kind: 'scatter',
    label: title,
    axis: 'linear',
    points,
    series,
    height: 250,
    xAxisTitle: 'Duration (bars)',
    yAxisTitle: 'Trade P&L',
    tooltipMode: 'duration-pnl',
    currency,
  });
  const legend = createElement(doc, 'div', 'quant-backtest-analysis-legend quant-backtest-analysis-scatter-legend');
  ([['Profit', PROFIT_COLOR], ['Loss', LOSS_COLOR]] as const).forEach(([labelText, color]) => {
    const item = createElement(doc, 'span', 'quant-backtest-analysis-legend-item');
    const marker = createElement(doc, 'span', 'quant-backtest-analysis-legend-dot');
    marker.style.backgroundColor = color;
    const label = createElement(doc, 'span');
    label.textContent = labelText;
    item.append(marker, label);
    legend.appendChild(item);
  });
  frame.appendChild(legend);
  return frame;
}

/** The reference gates the entire page on canonical closed trades. An open
 * compatibility row may join Analysis only after at least one real closed
 * trade exists; it must never make an open-only strategy look closed. */
export function shouldRenderTradeAnalysisEmpty(report: BacktestReport): boolean {
  const closedTradeCount = finite(report.analysis?.closedTradeCount)
    ?? report.trades?.filter((trade) => trade.status !== 'open').length
    ?? unwrapMetric(report.summary?.trades ?? report.metrics?.trades);
  return report.status === 'no-trades'
    || report.status === 'open-only'
    || closedTradeCount === 0;
}

/** Reference-compatible Trades Analysis page. It intentionally owns its
 * fixed rows instead of inheriting Performance fallbacks or generic cards. */
export function renderTradeAnalysisView(doc: Document, report: BacktestReport): HTMLElement {
  const container = createElement(doc, 'div', 'quant-backtest-page quant-backtest-analysis');
  if (shouldRenderTradeAnalysisEmpty(report)) {
    const empty = createElement(doc, 'div', 'quant-backtest-analysis-empty');
    empty.textContent = 'No trades available';
    container.appendChild(empty);
    return container;
  }

  const analysis = report.analysis;
  const overview = createElement(doc, 'div', 'quant-backtest-analysis-overview');
  overview.append(
    renderPnlDistribution(doc, report),
    renderWinRateDonut(doc, report),
  );
  container.appendChild(overview);
  const currency = reportCurrency(report);
  container.appendChild(renderAnalysisTable(
    doc,
    analysis?.comparison,
    TRADE_ROWS,
    currency,
    'Trade analysis by direction',
  ));
  container.appendChild(renderDurationScatter(doc, report));
  container.appendChild(renderAnalysisTable(
    doc,
    analysis?.durationComparison,
    DURATION_ROWS,
    currency,
    'Trade duration analysis by direction',
  ));
  return container;
}
