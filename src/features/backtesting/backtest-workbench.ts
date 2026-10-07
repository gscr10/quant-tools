import { backtestIcon as svgIcon } from './backtest-icons.ts';
import './backtest.css';
import { BacktestViewer } from './backtest-viewer.ts';
import {
  formatBacktestPerformanceValue,
  formatBacktestRange,
  formatExecutionPrecision,
} from './backtest-format.ts';
import { StrategySettingsPanel } from './strategy-settings.ts';
import {
  destroyReportCharts,
  enhanceReportCharts,
  registerReportChart,
  updateReportChartPoints,
  setReportChartLayout,
  resumeReportChartReflow,
  suspendReportChartReflow,
  type ReportChartPoint,
} from './highcharts-renderer.ts';
import { downsampleReportChartPoints } from './chart-sampling.ts';
import {
  type BacktestReport,
  type BacktestTab,
  type BacktestTrade,
  type BacktestWorkbenchOptions,
  type BacktestWorkbenchPort,
} from './backtest-types.ts';
import type { BacktestDockPreferences } from '../../domain/ports/backtest-preferences.ts';
import type { SettingsControlsPort } from '../../shared/settings-controls.ts';

type BacktestWorkbenchRuntimeOptions = BacktestWorkbenchOptions & {
  readonly settingsControls?: SettingsControlsPort;
  /** Restore focus to the active chart when a closing control is no longer visible. */
  readonly onFocusFallback?: () => void;
};

const DEFAULT_DOCK_HEIGHT = 280;
const MIN_DOCK_HEIGHT = 104;
const COLLAPSED_DOCK_HEIGHT = 45;
const CHART_HIDDEN_BELOW = 190;
const AXES_HIDDEN_BELOW = 230;
/** Bound SVG/Highcharts work while retaining the complete tooltip source. */
const MAX_DOCK_RENDER_POINTS = 2_000;

function resolveRoot(root: HTMLElement | string): HTMLElement {
  if (typeof root !== 'string') return root;
  const element = document.querySelector<HTMLElement>(root);
  if (!element) throw new Error(`Backtest workbench root not found: ${root}`);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

function button(doc: Document, label: string, className: string): HTMLButtonElement {
  const node = element(doc, 'button', className);
  node.type = 'button';
  node.textContent = label;
  return node;
}

function canRestoreFocus(node: HTMLElement | null): node is HTMLElement {
  if (!node?.isConnected || node.matches(':disabled')) return false;
  const view = node.ownerDocument.defaultView;
  for (let current: HTMLElement | null = node; current; current = current.parentElement) {
    if (current.hidden || current.inert) return false;
    if (view) {
      const style = view.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
    }
  }
  return true;
}

function unwrapMetric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const numeric = (value as { value?: unknown }).value;
  return typeof numeric === 'number' && Number.isFinite(numeric) ? numeric : null;
}

function dockIcon(doc: Document, name: 'chevron-up' | 'chevron-down' | 'maximize' | 'ghost'): SVGSVGElement {
  return svgIcon(doc, name, name === 'ghost' ? 32 : 16);
}

function formatDockMetric(value: number | null, unit = '', signed = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const digits = unit === 'count' ? 0 : unit === 'ratio' ? 3 : 2;
  const normalized = Object.is(value, -0) ? 0 : value;
  const sign = signed && normalized > 0 ? '+' : '';
  const suffix = unit === '%' ? '%' : unit && unit !== 'count' && unit !== 'ratio' ? ` ${unit}` : '';
  const formatted = unit && unit !== '%' && unit !== 'count' && unit !== 'ratio'
    ? formatBacktestPerformanceValue(normalized)
    : normalized.toLocaleString('en-US', {
      minimumFractionDigits: unit === '%' ? 0 : digits,
      maximumFractionDigits: digits,
    });
  return `${sign}${formatted}${suffix}`;
}

function reportValue(report: BacktestReport, key: string): unknown {
  return report.metrics?.[key] ?? report.summary?.[key];
}

interface DockMetricCard {
  readonly label: string;
  readonly value: string;
  readonly tone: string;
  readonly secondary?: string;
}

function setDockMetricAmount(amount: HTMLElement, value: string, currency: string): void {
  const suffix = ` ${currency}`;
  if (!value.endsWith(suffix)) {
    amount.textContent = value;
    return;
  }
  amount.textContent = value.slice(0, -suffix.length);
  const unit = element(amount.ownerDocument, 'span', 'quant-backtest-dock-currency');
  unit.textContent = currency;
  amount.appendChild(unit);
}

function dockMetricCards(report: BacktestReport): DockMetricCard[] {
  // Match the Viewer display contract for account currencies. Providers may
  // return lower-case ISO codes; the Dock must not diverge from the report.
  const currency = report.currency?.trim().toUpperCase() || 'USD';
  const net = unwrapMetric(reportValue(report, 'netProfit'));
  const trades = unwrapMetric(reportValue(report, 'trades'));
  const winRate = unwrapMetric(reportValue(report, 'winRate'));
  const winners = unwrapMetric(reportValue(report, 'winningTrades'));
  const losers = unwrapMetric(reportValue(report, 'losingTrades'));
  const drawdown = unwrapMetric(reportValue(report, 'maxDrawdown'));
  const drawdownPct = unwrapMetric(reportValue(report, 'maxDrawdownPercent'));
  const factor = unwrapMetric(reportValue(report, 'profitFactor'));
  return [
    {
      label: 'Net Profit',
      value: formatDockMetric(net, currency, true),
      tone: net === null || net === 0 ? 'neutral' : net > 0 ? 'positive' : 'negative',
    },
    { label: 'Trades', value: formatDockMetric(trades, 'count'), tone: 'neutral' },
    {
      label: 'Win Rate',
      value: formatDockMetric(winRate, '%'),
      tone: 'neutral',
      secondary: winners !== null || losers !== null
        ? `${formatDockMetric(winners, 'count')} | ${formatDockMetric(losers, 'count')}`
        : undefined,
    },
    {
      label: 'Max Drawdown',
      value: formatDockMetric(drawdown, currency),
      tone: 'neutral',
      secondary: drawdownPct === null ? undefined : formatDockMetric(drawdownPct, '%'),
    },
    {
      label: 'Profit Factor',
      value: formatDockMetric(factor, 'ratio'),
      tone: factor === null || factor === 1 ? 'neutral' : factor > 1 ? 'positive' : 'negative',
    },
  ];
}

/**
 * Live adapters may publish a forming-bar snapshot several times per second.
 * The report is immutable, but replacing the chart subtree for every snapshot
 * makes Highcharts visibly blink (and needlessly resets hover state).  Keep a
 * compact signature of what this surface actually renders so mark-to-market
 * updates that do not change the report view are accepted without a rebuild.
 */
function reportSurfaceSignature(report: BacktestReport | null): string {
  if (!report) return 'empty';
  const metricKeys = [
    'netProfit', 'trades', 'winRate', 'winningTrades', 'losingTrades',
    'maxDrawdown', 'maxDrawdownPercent', 'profitFactor',
  ];
  const metric = (key: string): number | null => unwrapMetric(reportValue(report, key));
  const tail = (points: readonly { x: number | string; y: number | null }[] | undefined) => {
    if (!points?.length) return null;
    const point = points[points.length - 1];
    return [points.length, point.x, point.y];
  };
  const lastTrade = report.trades?.[report.trades.length - 1];
  return JSON.stringify({
    key: report.key,
    strategyName: report.strategyName,
    status: ['compiling', 'computing', 'updating'].includes(report.status ?? '') ? 'live' : report.status,
    range: report.range,
    currency: report.currency,
    symbol: report.symbol,
    timeframe: report.timeframe,
    favorite: report.favorite,
    metrics: metricKeys.map(metric),
    cumulative: tail(report.cumulativePnl),
    daily: tail(report.netDailyPnl),
    weekday: tail(report.weekdayPerformance),
    comparison: report.comparison,
    analysis: report.analysis,
    trades: [report.trades?.length ?? 0, lastTrade?.id, lastTrade?.netPnl, lastTrade?.status],
    simulationRun: report.simulationRun,
    simulation: report.simulation,
  });
}

/**
 * Application-level Backtest Dock + Viewer shell.
 *
 * The class only consumes immutable reports and callbacks. It intentionally
 * knows nothing about Vela, PineTS, providers, or strategy execution so it can
 * be mounted against a fixture during UI work and later connected by a
 * controller/adapter.
 */
export class BacktestWorkbench {
  readonly element: HTMLElement;

  private readonly dock: HTMLElement;
  private readonly dockBody: HTMLElement;
  private readonly dockTitle: HTMLElement;
  private readonly dockRange: HTMLElement;
  private readonly collapsedNet: HTMLElement;
  private readonly dockMetrics: HTMLElement;
  private readonly collapseButton: HTMLButtonElement;
  private readonly viewerButton: HTMLButtonElement;
  private readonly settingsButton: HTMLButtonElement;
  private readonly separator: HTMLElement;
  private readonly viewer: BacktestViewer;
  private readonly mobileViewerButton: HTMLButtonElement;
  private readonly settingsPanel: StrategySettingsPanel;
  private readonly port: BacktestWorkbenchRuntimeOptions;
  private readonly defaultDockHeight: number;
  private readonly minDockHeight: number;
  private readonly maxDockHeight: number;
  private report: BacktestReport | null = null;
  private dockHeight: number;
  private collapsed = false;
  private resizeCleanup: (() => void) | null = null;
  private unsubscribe: (() => void) | null = null;
  private resizeListener: (() => void) | null = null;
  private viewerReturnFocus: HTMLElement | null = null;
  private settingsReturnFocus: HTMLElement | null = null;
  private lastNotifiedHeight: number | null = null;
  private lastSurfaceSignature: string | null = null;
  private simulationMounted = false;
  private simulationSessionKey: BacktestReport['key'];
  private destroyed = false;

  constructor(root: HTMLElement | string, options: BacktestWorkbenchRuntimeOptions = {}) {
    const host = resolveRoot(root);
    const doc = host.ownerDocument;
    this.port = options;
    this.defaultDockHeight = Math.max(MIN_DOCK_HEIGHT, options.defaultDockHeight ?? DEFAULT_DOCK_HEIGHT);
    this.minDockHeight = clamp(options.minDockHeight ?? MIN_DOCK_HEIGHT, 72, this.defaultDockHeight);
    this.maxDockHeight = Math.max(this.defaultDockHeight, options.maxDockHeight ?? Number.POSITIVE_INFINITY);
    this.dockHeight = options.dockPreferences?.height ?? this.defaultDockHeight;
    this.collapsed = options.dockPreferences?.collapsed === true;

    this.element = element(doc, 'div', 'quant-backtest-workbench');
    this.dockHeight = clamp(
      this.dockHeight,
      this.minDockHeight,
      this.effectiveMaxDockHeight(),
    );
    this.element.dataset.state = 'empty';
    this.element.dataset.backtestWorkbench = 'true';

    this.dock = element(doc, 'section', 'quant-backtest-dock');
    this.dock.id = 'quant-backtest-dock';
    this.dock.hidden = true;
    this.dock.setAttribute('aria-label', 'Backtest summary');
    this.dock.style.setProperty('--quant-backtest-dock-height', `${this.dockHeight}px`);
    // The resize floor and the collapsed header are two distinct reference
    // states: users can resize the expanded Dock down to 104px, while the
    // explicit collapse action retains the title, result and Viewer entry.
    this.dock.style.setProperty('--quant-backtest-dock-collapsed-height', `${COLLAPSED_DOCK_HEIGHT}px`);
    this.dock.classList.toggle('is-collapsed', this.collapsed);

    this.separator = element(doc, 'div', 'quant-backtest-dock-separator');
    this.separator.setAttribute('role', 'separator');
    this.separator.setAttribute('aria-orientation', 'horizontal');
    this.separator.setAttribute('aria-controls', this.dock.id);
    this.separator.tabIndex = 0;
    this.separator.setAttribute('aria-label', 'Resize backtest summary');
    this.separator.setAttribute('aria-valuemin', String(this.minDockHeight));
    this.separator.setAttribute('aria-valuemax', String(this.effectiveMaxDockHeight()));
    this.separator.setAttribute('aria-valuenow', String(Math.round(this.dockHeight)));
    this.separator.addEventListener('pointerdown', (event) => this.beginResize(event));
    this.separator.addEventListener('keydown', (event) => this.resizeFromKeyboard(event));
    this.separator.addEventListener('dblclick', () => {
      this.setDockHeight(this.defaultDockHeight);
      this.persistDockPreferences();
    });
    this.dock.appendChild(this.separator);

    const header = element(doc, 'header', 'quant-backtest-dock-header');
    const identity = element(doc, 'div', 'quant-backtest-dock-identity');
    this.dockTitle = element(doc, 'strong', 'quant-backtest-dock-title');
    this.dockRange = element(doc, 'span', 'quant-backtest-dock-range');
    this.collapsedNet = element(doc, 'span', 'quant-backtest-dock-collapsed-net');
    identity.append(this.dockTitle, this.dockRange, this.collapsedNet);
    const actions = element(doc, 'div', 'quant-backtest-dock-actions');
    this.collapseButton = button(doc, 'Collapse', 'quant-backtest-icon-button');
    this.collapseButton.prepend(dockIcon(doc, 'chevron-down'));
    this.collapseButton.addEventListener('click', () => this.toggleCollapsed());
    this.settingsButton = button(doc, '', 'quant-backtest-icon-button');
    this.settingsButton.append(svgIcon(doc, 'settings'));
    this.settingsButton.setAttribute('aria-label', 'Open strategy settings');
    this.settingsButton.title = 'Open strategy settings';
    this.settingsButton.addEventListener('click', () => this.openSettings());
    this.settingsButton.hidden = !this.port.settings;
    this.viewerButton = button(doc, '', 'quant-backtest-icon-button');
    this.viewerButton.prepend(dockIcon(doc, 'maximize'));
    this.viewerButton.setAttribute('aria-label', 'Open backtest viewer');
    this.viewerButton.title = 'Open backtest viewer';
    this.viewerButton.addEventListener('click', () => this.openViewer());
    actions.append(this.collapseButton, this.settingsButton, this.viewerButton);
    header.append(identity, actions);
    this.dock.appendChild(header);

    this.dockBody = element(doc, 'div', 'quant-backtest-dock-body');
    this.dockBody.id = 'quant-backtest-dock-content';
    this.collapseButton.setAttribute('aria-controls', this.dockBody.id);
    this.dockMetrics = element(doc, 'div', 'quant-backtest-dock-metrics');
    this.dockBody.appendChild(this.dockMetrics);
    this.dock.appendChild(this.dockBody);

    this.viewer = new BacktestViewer(doc, {
      onClose: () => this.closeViewer(),
      onTabChange: (tab) => {
        if (tab === 'simulation') {
          this.simulationMounted = true;
          this.simulationSessionKey = this.report?.key;
        } else {
          this.endSimulationSession();
        }
        this.port.onTabChange?.(tab);
      },
      onToggleFavorite: (report) => this.port.onToggleFavorite?.(report),
      onTradeLocate: (trade, side) => {
        // Entry/Exit actions are chart navigation commands.  The reference
        // workspace returns to the chart before focusing the execution bar;
        // leaving the Viewer open would hide the newly focused marker and
        // make the callback appear to have done nothing.  Close through the
        // normal lifecycle path so aria/inert state, reserved height and
        // focus restoration are all restored before the host navigation runs.
        this.closeViewer();
        this.notifyPort(() => this.port.onTradeLocate?.(trade, side));
      },
      onSimulationChange: (change) => this.port.onSimulationChange?.(change),
      onRetry: () => this.port.onRetry?.(),
    });

    this.settingsPanel = new StrategySettingsPanel(doc, {
      controls: options.settingsControls,
      onReadAfterFailure: (snapshot) => {
        const report = this.report;
        if (!report || report.key?.cellId !== snapshot.key.cellId
          || report.key?.indicatorId !== snapshot.key.indicatorId) return null;
        return this.port.settings?.read(report) ?? null;
      },
      onApply: (snapshot, inputs, props) => {
        const report = this.report;
        const settings = this.port.settings;
        if (!report || !settings
          || report.key?.cellId !== snapshot.key.cellId
          || report.key?.indicatorId !== snapshot.key.indicatorId) return false;
        return settings.apply(report, inputs, props);
      },
      onClose: () => this.restoreSettingsFocus(),
    });

    // At the reference breakpoint (1023px and below) the chart remains fully
    // visible and the report is opened through a compact chart-area entry.
    // Keep this control in the Workbench lifecycle so it shares the same
    // report and Viewer state and never starts a second backtest run.
    this.mobileViewerButton = button(doc, 'Backtest', 'quant-backtest-mobile-trigger');
    this.mobileViewerButton.prepend(svgIcon(doc, 'gauge'));
    this.mobileViewerButton.setAttribute('aria-label', 'Backtest');
    this.mobileViewerButton.title = 'Backtest';
    this.mobileViewerButton.hidden = true;
    this.mobileViewerButton.addEventListener('click', () => this.openViewer());

    this.element.append(
      this.dock,
      this.viewer.element,
      this.settingsPanel.element,
      this.mobileViewerButton,
    );
    host.appendChild(this.element);
    // The host is only measurable after insertion. Initial preferences and
    // the separator's maximum must use an embedded workspace's own height,
    // rather than retaining the pre-mount window fallback.
    this.clampDockToViewport();

    this.report = options.initialReport ?? options.getSnapshot?.() ?? null;
    this.bindSubscription(options.subscribe);
    this.resizeListener = () => {
      this.clampDockToViewport();
      this.syncResponsiveVisibility();
    };
    doc.defaultView?.addEventListener('resize', this.resizeListener);
    this.render();
  }

  /** Current report, exposed for adapters/tests without leaking internals. */
  get snapshot(): BacktestReport | null {
    return this.report;
  }

  get viewerOpen(): boolean {
    return this.viewer.isOpen;
  }

  get dockCollapsed(): boolean {
    return this.collapsed;
  }

  setReport(report: BacktestReport | null): void {
    if (this.destroyed) return;
    const previousReport = this.report;
    const signature = reportSurfaceSignature(report);
    this.report = report;
    if (this.simulationMounted
      && (this.simulationSessionKey?.cellId !== report?.key?.cellId
        || this.simulationSessionKey?.indicatorId !== report?.key?.indicatorId)) {
      // The store's active report may already belong to another chart. End
      // the old owner's session explicitly rather than resetting "active".
      this.endSimulationSession();
      this.simulationMounted = report !== null;
      this.simulationSessionKey = report?.key;
    }
    if (signature === this.lastSurfaceSignature) return;
    this.lastSurfaceSignature = signature;

    // A forming bar can publish several snapshots per second. Keep the Dock
    // and its Highcharts instance mounted while only the values/tail change;
    // the regular render path remains responsible for status, layout, tabs,
    // and any report whose chart shape changed.
    const sameExecution = previousReport && report
      && previousReport.key?.cellId === report.key?.cellId
      && previousReport.key?.indicatorId === report.key?.indicatorId
      && previousReport.runId === report.runId;
    const transient = report
      && ['compiling', 'computing', 'updating'].includes(report.status ?? '')
      && sameExecution
      && Boolean(this.dockMetrics.querySelector('.quant-backtest-chart-host'));
    if (transient && this.updateLiveDock(report)) {
      if (this.viewer.isOpen) this.viewer.setReport(report);
      return;
    }
    this.render();
  }

  openViewer(): void {
    if (this.destroyed || !this.report) return;
    const active = this.element.ownerDocument.activeElement;
    this.viewerReturnFocus = active instanceof HTMLElement ? active : this.viewerButton;
    this.viewer.open(this.report);
    this.endSimulationSession();
    this.element.dataset.viewer = 'open';
    this.syncResponsiveVisibility();
    this.viewerButton.setAttribute('aria-expanded', 'true');
    this.notifyPort(() => this.port.onOpenViewer?.());
  }

  closeViewer(): void {
    if (this.destroyed) return;
    const wasOpen = this.viewer.isOpen;
    this.viewer.close();
    this.endSimulationSession();
    this.element.dataset.viewer = 'closed';
    this.syncResponsiveVisibility();
    this.viewerButton.setAttribute('aria-expanded', 'false');
    const returnFocus = this.viewerReturnFocus;
    this.viewerReturnFocus = null;
    this.notifyLayout();
    if (wasOpen) this.notifyPort(() => this.port.onCloseViewer?.());
    if (wasOpen) this.restoreFocus(returnFocus);
  }

  destroy(): void {
    if (this.destroyed) return;
    const viewerWasOpen = this.viewer.isOpen;
    this.destroyed = true;
    this.resizeCleanup?.();
    this.resizeCleanup = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const view = this.element.ownerDocument.defaultView;
    if (this.resizeListener && view) view.removeEventListener('resize', this.resizeListener);
    this.resizeListener = null;
    // Dock charts live outside the Viewer panel, so explicitly release their
    // Highcharts instances and ResizeObservers before removing the shell.
    destroyReportCharts(this.dockMetrics);
    this.viewer.destroy();
    this.endSimulationSession();
    this.settingsPanel.destroy();
    this.viewerReturnFocus = null;
    this.settingsReturnFocus = null;
    this.notifyPort(() => this.port.onResize?.(0));
    if (viewerWasOpen) this.notifyPort(() => this.port.onCloseViewer?.());
    this.element.remove();
    this.report = null;
    this.lastSurfaceSignature = null;
  }

  private endSimulationSession(): void {
    const key = this.simulationSessionKey;
    const wasMounted = this.simulationMounted;
    this.simulationMounted = false;
    this.simulationSessionKey = undefined;
    if (wasMounted && key) this.notifyPort(() => this.port.onSimulationSessionEnd?.(key));
  }

  private bindSubscription(subscribe: BacktestWorkbenchOptions['subscribe']): void {
    if (!subscribe) return;
    const cleanup = subscribe((report) => this.setReport(report));
    if (typeof cleanup === 'function') this.unsubscribe = cleanup;
  }

  private render(): void {
    if (!this.report) {
      this.element.dataset.state = 'empty';
      this.closeViewer();
      // A report can disappear without destroying the Workbench (for example
      // when the active strategy is removed). Release the Dock sparkline and
      // its ResizeObserver immediately instead of keeping the old ledger
      // alive behind the hidden shell until the next report or destroy().
      destroyReportCharts(this.dockMetrics);
      this.dockMetrics.replaceChildren();
      this.dockTitle.textContent = '';
      this.dockRange.textContent = '';
      this.collapsedNet.textContent = '';
      this.dockRange.removeAttribute('title');
      this.dockRange.removeAttribute('aria-label');
      delete this.dockRange.dataset.executionPrecision;
      delete this.dockRange.dataset.executionFallback;
      delete this.dockRange.dataset.executionFallbackReason;
      this.dock.hidden = true;
      this.mobileViewerButton.hidden = true;
      this.viewer.setReport(null);
      this.settingsPanel.update(null);
      return;
    }
    this.element.dataset.state = this.report.status ?? 'ready';
    this.dockTitle.textContent = this.report.strategyName;
    this.updateCollapsedNet(this.report);
    const range = formatBacktestRange(this.report);
    const precision = formatExecutionPrecision(this.report.execution?.precision);
    this.dockRange.textContent = [range, precision?.text].filter(Boolean).join(' · ');
    if (precision) {
      this.dockRange.title = precision.detail;
      this.dockRange.setAttribute(
        'aria-label',
        range ? `${range}; ${precision.detail}` : precision.detail,
      );
      // Keep a machine-readable value even when default OHLC is intentionally
      // hidden from the visible date line for pixel parity.
      this.dockRange.dataset.executionPrecision = precision.text || 'OHLC';
      this.dockRange.dataset.executionFallback = String(precision.fallback);
      if (precision.fallbackReason) this.dockRange.dataset.executionFallbackReason = precision.fallbackReason;
      else delete this.dockRange.dataset.executionFallbackReason;
    } else {
      this.dockRange.removeAttribute('title');
      this.dockRange.removeAttribute('aria-label');
      delete this.dockRange.dataset.executionPrecision;
      delete this.dockRange.dataset.executionFallback;
      delete this.dockRange.dataset.executionFallbackReason;
    }
    this.viewer.setReport(this.report);
    if (this.settingsPanel.isOpen) {
      let settings = null;
      try {
        settings = this.port.settings?.read(this.report) ?? null;
      } catch {
        settings = null;
      }
      this.settingsPanel.update(settings);
    }
    this.syncResponsiveVisibility();
    this.renderDockMetrics();
    this.updateCollapseA11y();
    this.notifyLayout();
  }

  /** Open the selected strategy's Inputs/Properties panel from Dock or Viewer. */
  openSettings(): void {
    if (this.destroyed || !this.report || !this.port.settings) return;
    try {
      const snapshot = this.port.settings.read(this.report);
      if (snapshot) {
        if (!this.settingsPanel.isOpen) {
          const active = this.element.ownerDocument.activeElement;
          // Keep the actual trigger for both keyboard and pointer activation.
          // WebKit may leave focus on the canvas after a pointer click, so the
          // explicit Settings button is the stable return target.
          this.settingsReturnFocus = this.settingsButton.isConnected
            ? this.settingsButton
            : active instanceof HTMLElement ? active : null;
        }
        this.settingsPanel.open(snapshot, this.settingsButton);
      }
    } catch {
      // Settings are an optional enhancement; a torn-down chart must not break
      // report navigation or the host Workspace lifecycle.
    }
  }

  private renderDockMetrics(): void {
    if (!this.report) return;
    const doc = this.element.ownerDocument;
    destroyReportCharts(this.dockMetrics);
    this.dockMetrics.replaceChildren();
    const currency = this.report.currency?.trim() || 'USD';
    const cards = dockMetricCards(this.report);
    const metricsRow = element(doc, 'div', 'quant-backtest-dock-kpi-strip');
    metricsRow.tabIndex = 0;
    metricsRow.setAttribute('role', 'region');
    metricsRow.setAttribute('aria-label', 'Backtest summary metrics');
    this.dockMetrics.appendChild(metricsRow);
    cards.forEach(({ label, value, tone, secondary }) => {
      const card = element(doc, 'div', 'quant-backtest-dock-kpi');
      const title = element(doc, 'span');
      title.textContent = label;
      const row = element(doc, 'span', 'quant-backtest-dock-value-row');
      const amount = element(doc, 'strong');
      setDockMetricAmount(amount, value, currency.toUpperCase());
      amount.classList.add(`quant-backtest-tone-${tone}`);
      row.appendChild(amount);
      if (secondary) {
        const detail = element(doc, 'small', 'quant-backtest-dock-value-secondary');
        detail.textContent = secondary;
        row.appendChild(detail);
      }
      card.append(title, row);
      metricsRow.appendChild(card);
    });
    const chart = element(doc, 'div', 'quant-backtest-dock-sparkline');
    const values = this.report.cumulativePnl ?? [];
    if (values.length === 0) {
      if (!(this.report.trades?.length) && (!this.report.status
        || this.report.status === 'ready' || this.report.status === 'no-trades')) {
        chart.classList.add('quant-backtest-dock-empty');
        const title = element(doc, 'strong');
        title.textContent = 'No trades';
        const detail = element(doc, 'span');
        detail.textContent = "This strategy didn't open or close any trades.";
        chart.append(dockIcon(doc, 'ghost'), title, detail);
      }
    } else {
      // Build the complete tooltip source in one pass.  This is intentionally
      // iterative: a spread into Math.min/Math.max becomes a call-stack/argument
      // limit at very large histories, while a temporary `numeric` array adds
      // another O(n) allocation to every Dock render.
      const points: ReportChartPoint[] = [];
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      values.forEach((point, index) => {
        if (point.y === null || !Number.isFinite(point.y)) return;
        const numericX = typeof point.x === 'number'
          ? point.x
          : (() => {
              const parsed = Date.parse(String(point.x));
              return Number.isFinite(parsed) ? parsed : index;
            })();
        points.push({ x: numericX, y: point.y, time: point.time ?? point.x,
          direction: point.direction, tradeNumber: point.tradeNumber });
        min = Math.min(min, point.y);
        max = Math.max(max, point.y);
      });
      // A Dock sparkline is only a visual overview.  Feeding every point into
      // the SVG `polyline` and Highcharts constructor makes a 100k-bar report
      // spend most of its open/resize time serialising a path that cannot be
      // distinguished at this pixel width.  Keep the full source for nearest
      // tooltip lookup, while rendering the same bounded, extrema-preserving
      // series used by the Viewer charts.
      const renderPoints = downsampleReportChartPoints(points, MAX_DOCK_RENDER_POINTS);
      if (!points.length) min = max = 0;
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 320 68');
      svg.setAttribute('role', 'img');
      svg.setAttribute(
        'aria-label',
        this.report.cumulativePnlSource === 'realized-ledger'
          ? 'Cumulative P&L (realized closed trades)'
          : 'Cumulative P&L',
      );
      if (this.report.cumulativePnlSource) {
        chart.dataset.cumulativePnlSource = this.report.cumulativePnlSource;
      }
      const span = max - min || 1;
      const sparklinePoints = renderPoints.map((point, index) => {
        const x = renderPoints.length <= 1 ? 4 : 4 + index / (renderPoints.length - 1) * 312;
        const y = 62 - (point.y - min) / span * 56;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      });
      const polyline = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', sparklinePoints.join(' '));
      polyline.setAttribute('class', 'quant-backtest-sparkline-line');
      svg.appendChild(polyline);
      const host = element(doc, 'div', 'quant-backtest-chart-host');
      host.dataset.rawPointCount = String(points.length);
      host.dataset.renderPointCount = String(renderPoints.length);
      host.dataset.downsampled = String(renderPoints.length < points.length);
      host.appendChild(svg);
      chart.appendChild(host);
      this.dockMetrics.appendChild(chart);
      registerReportChart(host, {
        kind: 'area',
        label: 'Cumulative P&L',
        points: renderPoints,
        tooltipPoints: points,
        axis: points.some((point) => Math.abs(point.x) >= 1e11) ? 'datetime' : 'linear',
        height: 'container',
        hideAxes: this.dockHeight < AXES_HIDDEN_BELOW,
        currency,
        tooltipMode: 'performance-equity',
        markerEnabled: false,
        yAxisOpposite: true,
        yAxisMin: min,
        yAxisMax: max,
        chartSpacing: [4, 2, 2, 2],
        yAxisGridLineWidth: 0,
        lineColor: '#089981',
        positiveColor: '#089981',
        negativeColor: '#f23645',
        zoneAxis: 'y',
        zones: [
          {
            value: 0,
            color: '#f23645',
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
            color: '#089981',
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
      });
      void enhanceReportCharts(chart).then(() => this.syncDockChartLayout());
    }
    if (!chart.isConnected) this.dockMetrics.appendChild(chart);
    this.syncDockChartLayout();
  }

  private updateCollapsedNet(report: BacktestReport): void {
    const card = dockMetricCards(report)[0];
    setDockMetricAmount(this.collapsedNet, card.value, report.currency?.trim().toUpperCase() || 'USD');
    this.collapsedNet.setAttribute('aria-label', `Net Profit ${card.value}`);
    this.collapsedNet.className = `quant-backtest-dock-collapsed-net quant-backtest-tone-${card.tone}`;
  }

  private syncDockChartLayout(): void {
    if (this.destroyed) return;
    const chart = this.dockMetrics.querySelector<HTMLElement>('.quant-backtest-dock-sparkline');
    if (!chart) return;
    const hidden = this.dockHeight < CHART_HIDDEN_BELOW;
    if (hidden && chart.contains(this.element.ownerDocument.activeElement)) {
      this.separator.focus({ preventScroll: true });
    }
    chart.hidden = hidden;
    chart.inert = hidden;
    const host = chart.querySelector<HTMLElement>('[data-quant-report-chart]');
    if (host) setReportChartLayout(host, { hideAxes: this.dockHeight < AXES_HIDDEN_BELOW });
  }

  /** Update forming-bar values and chart data without replacing the Dock DOM. */
  private updateLiveDock(report: BacktestReport): boolean {
    this.updateCollapsedNet(report);
    const cards = [...this.dockMetrics.querySelectorAll<HTMLElement>('.quant-backtest-dock-kpi')];
    const nextCards = dockMetricCards(report);
    if (cards.length !== nextCards.length) return false;
    cards.forEach((card, index) => {
      const next = nextCards[index];
      const row = card.querySelector<HTMLElement>('.quant-backtest-dock-value-row');
      const amount = row?.querySelector<HTMLElement>('strong');
      if (!row || !amount) return;
      setDockMetricAmount(amount, next.value, report.currency?.trim().toUpperCase() || 'USD');
      amount.className = '';
      amount.classList.add(`quant-backtest-tone-${next.tone}`);
      const existingSecondary = row.querySelector<HTMLElement>('small');
      if (next.secondary) {
        const secondary = existingSecondary ?? element(this.element.ownerDocument, 'small', 'quant-backtest-dock-value-secondary');
        secondary.textContent = next.secondary;
        if (!existingSecondary) row.appendChild(secondary);
      } else {
        existingSecondary?.remove();
      }
    });

    const host = this.dockMetrics.querySelector<HTMLElement>('[data-quant-report-chart]');
    const values = report.cumulativePnl ?? [];
    if (!host || values.length === 0) return values.length === 0;
    const points: ReportChartPoint[] = [];
    values.forEach((point, index) => {
      if (point.y === null || !Number.isFinite(point.y)) return;
      const numericX = typeof point.x === 'number'
        ? point.x
        : (() => {
            const parsed = Date.parse(String(point.x));
            return Number.isFinite(parsed) ? parsed : index;
          })();
      points.push({
        x: numericX,
        y: point.y,
        time: point.time ?? point.x,
        direction: point.direction,
        tradeNumber: point.tradeNumber,
      });
    });
    const renderPoints = downsampleReportChartPoints(points, MAX_DOCK_RENDER_POINTS);
    return updateReportChartPoints(host, renderPoints, points);
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
    this.dock.classList.toggle('is-collapsed', this.collapsed);
    this.updateCollapseA11y();
    // A collapsed Dock exposes only its header. If a host toggles the state
    // while focus is on the separator or a future interactive control inside
    // the body, do not leave keyboard focus in a subtree that has just become
    // `display:none`/aria-hidden. Keeping this check against the body rather
    // than a list of controls also covers chart/tooltips added by renderers.
    if (this.collapsed) {
      const active = this.element.ownerDocument.activeElement;
      if (active === this.separator || (active instanceof HTMLElement && this.dockBody.contains(active))) {
        this.collapseButton.focus();
      }
    }
    this.persistDockPreferences();
    this.notifyLayout();
  }

  private updateCollapseA11y(): void {
    this.collapseButton.setAttribute('aria-expanded', String(!this.collapsed));
    const label = this.collapsed ? 'Expand backtest summary' : 'Collapse backtest summary';
    this.collapseButton.setAttribute('aria-label', label);
    this.collapseButton.title = label;
    this.collapseButton.replaceChildren(dockIcon(this.element.ownerDocument, this.collapsed ? 'chevron-up' : 'chevron-down'));
    this.dock.setAttribute('aria-expanded', String(!this.collapsed));
    if (this.collapsed) {
      // The reference collapsed state keeps the summary header. Keep the
      // separator out of the tab order and accessibility tree while that row
      // is active; its previous height is retained and restored on expand.
      this.separator.tabIndex = -1;
      this.separator.setAttribute('aria-hidden', 'true');
      this.separator.setAttribute('aria-disabled', 'true');
    } else {
      this.separator.tabIndex = 0;
      this.separator.removeAttribute('aria-hidden');
      this.separator.removeAttribute('aria-disabled');
      this.separator.setAttribute('aria-keyshortcuts', 'ArrowUp ArrowDown Shift+ArrowUp Shift+ArrowDown Home End');
    }
  }

  private beginResize(event: PointerEvent): void {
    if (event.button !== 0 || this.destroyed || this.viewer.isOpen || this.collapsed) return;
    event.preventDefault();
    const view = this.element.ownerDocument.defaultView;
    if (!view) return;
    // Avoid forcing every mounted Highcharts instance through a synchronous
    // reflow for each pointer sample.  The renderer's reference-counted
    // boundary settles all live charts once when `end` runs below.
    this.resizeCleanup?.();
    suspendReportChartReflow();
    let reflowSuspended = true;
    const separator = event.currentTarget instanceof HTMLElement ? event.currentTarget : this.separator;
    // Keep the drag attached to the separator even when the pointer leaves the
    // thin hit target. Document listeners remain as a compatibility fallback
    // for older DOM shims that do not implement Pointer Capture.
    try {
      separator.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the document listeners below still
      // provide the resize lifecycle when a host shim rejects it.
    }
    const startY = event.clientY;
    const startHeight = this.dockHeight;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const next = startHeight + (startY - moveEvent.clientY);
      this.setDockHeight(next);
    };
    const end = (endEvent?: PointerEvent) => {
      if (endEvent && endEvent.pointerId !== event.pointerId) return;
      if (!reflowSuspended) return;
      reflowSuspended = false;
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', end);
      view.removeEventListener('pointercancel', end);
      try {
        if (separator.hasPointerCapture?.(event.pointerId)) separator.releasePointerCapture?.(event.pointerId);
      } catch {
        // Ignore teardown races from a removed separator or DOM shim.
      } finally {
        if (!this.destroyed && this.dockHeight < CHART_HIDDEN_BELOW) {
          this.setDockHeight(this.minDockHeight);
        }
        resumeReportChartReflow();
        this.resizeCleanup = null;
        this.persistDockPreferences();
      }
    };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', end);
    this.resizeCleanup = end;
  }

  private resizeFromKeyboard(event: KeyboardEvent): void {
    if (this.collapsed) return;
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.setDockHeight(this.dockHeight + step);
      this.persistDockPreferences();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.setDockHeight(this.dockHeight - step);
      this.persistDockPreferences();
    } else if (event.key === 'Home') {
      event.preventDefault();
      this.setDockHeight(this.effectiveMaxDockHeight());
      this.persistDockPreferences();
    } else if (event.key === 'End') {
      event.preventDefault();
      this.setDockHeight(this.minDockHeight);
      this.persistDockPreferences();
    }
  }

  private setDockHeight(height: number): void {
    const effectiveMax = this.effectiveMaxDockHeight();
    this.dockHeight = clamp(height, this.minDockHeight, effectiveMax);
    this.dock.style.setProperty('--quant-backtest-dock-height', `${this.dockHeight}px`);
    this.separator.setAttribute('aria-valuemin', String(this.minDockHeight));
    this.separator.setAttribute('aria-valuemax', String(effectiveMax));
    this.separator.setAttribute('aria-valuenow', String(Math.round(this.dockHeight)));
    this.syncDockChartLayout();
    this.notifyLayout();
  }

  /** Persist only after an intentional user action, never during viewport
   * clamping, Viewer open/close, report updates, or destroy. */
  private persistDockPreferences(): void {
    if (this.destroyed) return;
    const preferences: BacktestDockPreferences = {
      version: 1,
      height: Math.round(this.dockHeight),
      collapsed: this.collapsed,
    };
    this.notifyPort(() => this.port.onDockPreferencesChange?.(preferences));
  }

  private clampDockToViewport(): void {
    this.setDockHeight(this.dockHeight);
  }

  private viewportHeight(): number {
    const availableHeight = this.element.parentElement?.clientHeight
      || this.element.ownerDocument.defaultView?.innerHeight
      || 900;
    return Math.max(this.minDockHeight, Math.round(availableHeight * 0.75));
  }

  private effectiveMaxDockHeight(): number {
    return Math.max(this.minDockHeight, Math.min(this.maxDockHeight, this.viewportHeight()));
  }

  private restoreSettingsFocus(): void {
    const returnFocus = this.settingsReturnFocus;
    this.settingsReturnFocus = null;
    queueMicrotask(() => {
      if (!this.destroyed) this.restoreFocus(returnFocus);
    });
  }

  private restoreFocus(returnFocus: HTMLElement | null): void {
    if (canRestoreFocus(returnFocus)) {
      returnFocus.focus();
      if (this.element.ownerDocument.activeElement === returnFocus) return;
    }
    const active = this.element.ownerDocument.activeElement;
    if (active instanceof HTMLElement && this.element.contains(active)) active.blur();
    this.notifyPort(() => this.port.onFocusFallback?.());
  }

  /** Tell the app shell how much chart height the visible Dock reserves. */
  private notifyLayout(): void {
    const height = this.report && !this.viewer.isOpen && !this.isCompactViewport()
      ? (this.collapsed ? COLLAPSED_DOCK_HEIGHT : this.dockHeight)
      : 0;
    if (height === this.lastNotifiedHeight) return;
    this.lastNotifiedHeight = height;
    this.notifyPort(() => this.port.onResize?.(height));
  }

  private isCompactViewport(): boolean {
    const width = this.element.ownerDocument.defaultView?.innerWidth ?? Number.POSITIVE_INFINITY;
    return width <= 1023;
  }

  /** Keep the chart unobstructed while preserving the report entry point. */
  private syncResponsiveVisibility(): void {
    const compact = this.isCompactViewport();
    const hasReport = this.report !== null;
    const viewerOpen = this.viewer.isOpen;
    this.dock.hidden = !hasReport || viewerOpen || compact;
    this.mobileViewerButton.hidden = !hasReport || viewerOpen;
    this.mobileViewerButton.setAttribute(
      'aria-hidden',
      String(!compact || !hasReport || viewerOpen),
    );
    this.notifyLayout();
  }

  private notifyPort(callback: () => unknown): void {
    try {
      // Keep the host callback synchronous from the Workbench's point of
      // view.  Integrations are nevertheless allowed to return a Promise
      // (for example, when persisting layout/focus state); attach a rejection
      // handler immediately so a fire-and-forget notification cannot become
      // an unhandled rejection after the control event has completed.
      const result = callback();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Host layout/a11y callbacks are optional integration seams. A failure
      // must not make the report controls unusable or break Workspace teardown.
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function createBacktestWorkbench(
  root: HTMLElement | string,
  port: BacktestWorkbenchRuntimeOptions = {},
): BacktestWorkbench {
  return new BacktestWorkbench(root, port);
}

export type {
  BacktestReport,
  BacktestTab,
  BacktestTrade,
  BacktestWorkbenchOptions,
  BacktestWorkbenchPort,
};
