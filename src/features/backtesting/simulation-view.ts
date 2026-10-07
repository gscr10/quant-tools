import { backtestIcon } from './backtest-icons.ts';
import { formatBacktestPerformanceValue } from './backtest-format.ts';
import type {
  BacktestReport,
  BacktestSimulation,
  BacktestSimulationChange,
  BacktestSimulationChartMode,
  BacktestSimulationHistogramBin,
} from './backtest-types.ts';
import {
  registerReportChart,
  type ReportChartDataPoint,
  type ReportChartPoint,
  type ReportChartPlotLine,
  type ReportChartRangePoint,
  type ReportChartSeries,
  type ReportChartValueUnit,
} from './highcharts-renderer.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROFIT_COLOR = '#089981';
const LOSS_COLOR = '#f23645';
const NEUTRAL_COLOR = '#71717a';
// Opaque boundaries stay legible over the layered translucent bands. The
// original fills and every simulated value are retained.
const PATH_BOUNDARY_COLOR = '#a1a1aa';
// Text is drawn on the elevated #1c1d20 label surface. The reference's
// neutral/red series colors measure 3.49:1/4.33:1 there, below small-text AA.
// Preserve graph colors while using readable annotation colors.
const NEUTRAL_TEXT_COLOR = '#a1a1aa';
const LOSS_TEXT_COLOR = '#f5404e';
const RUN_OPTIONS = [250, 1_000, 2_500] as const;
const DRAWDOWN_PRESETS = [1.5, 2, 3] as const;

const HELP = Object.freeze({
  runs: 'How many alternative histories to simulate. More runs make smoother charts but take longer.',
  method: 'Resample picks trades at random, with repeats, so totals vary. Shuffle keeps the same trades in a new order, so only drawdowns vary.',
  drawdownThreshold: "A drawdown level to test, expressed as a multiple of the backtest's actual max drawdown (2× = twice as deep). Pick a preset or type your own. The P(drawdown) stat shows how often runs got that bad.",
  drawdownUnit: 'Show drawdowns in money or as a % of the equity peak they fell from.',
  view: 'Histogram: how many runs landed in each range. Cumulative: the share of runs at or below each level.',
  variation: 'Randomly nudges each trade’s profit or loss by about this much, every time it appears. 0 uses the trades as they are.',
  preserveWinLoss: 'Winners stay winners and losers stay losers. Only their size changes.',
});

let helpSequence = 0;
let fallbackGradientSequence = 0;

export interface SimulationViewOptions {
  readonly document: Document;
  readonly report: BacktestReport;
  readonly settingsOpen: boolean;
  readonly onSettingsOpenChange: (open: boolean) => void;
  readonly onChange: (change: BacktestSimulationChange) => void;
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

function svgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
): SVGElementTagNameMap[K] {
  return doc.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
}

function button(doc: Document, label: string, className: string): HTMLButtonElement {
  const node = element(doc, 'button', className);
  node.type = 'button';
  node.textContent = label;
  return node;
}

function settingsIcon(doc: Document): SVGSVGElement {
  return backtestIcon(doc, 'settings-2');
}

function settingsHint(doc: Document, text: string): HTMLElement {
  const hint = element(doc, 'small', 'quant-backtest-simulation-settings-hint');
  hint.textContent = text;
  return hint;
}

function help(doc: Document, label: string, copy: string): HTMLElement {
  helpSequence += 1;
  const wrapper = element(doc, 'span', 'quant-backtest-simulation-help');
  const trigger = button(doc, '', 'quant-backtest-simulation-help-trigger');
  const glyph = svgElement(doc, 'svg');
  glyph.setAttribute('viewBox', '0 0 24 24');
  glyph.setAttribute('aria-hidden', 'true');
  glyph.setAttribute('focusable', 'false');
  const ring = svgElement(doc, 'circle');
  ring.setAttribute('cx', '12'); ring.setAttribute('cy', '12'); ring.setAttribute('r', '10');
  glyph.appendChild(ring);
  for (const d of ['M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01']) {
    const path = svgElement(doc, 'path');
    path.setAttribute('d', d);
    glyph.appendChild(path);
  }
  trigger.appendChild(glyph);
  const tooltip = element(doc, 'span', 'quant-backtest-simulation-help-tooltip');
  tooltip.id = `quant-backtest-simulation-help-${helpSequence}`;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  tooltip.textContent = copy;
  trigger.setAttribute('aria-label', `About ${label}`);
  trigger.setAttribute('aria-describedby', tooltip.id);
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = copy;
  let pinned = false;
  let hovered = false;
  let focused = false;
  const keepTooltipInViewport = (): void => {
    tooltip.style.marginLeft = '0px';
    const viewportWidth = doc.documentElement.clientWidth;
    if (viewportWidth <= 0) return;
    const rect = tooltip.getBoundingClientRect();
    const viewportInset = 8;
    let offset = 0;
    if (rect.left < viewportInset) {
      offset = viewportInset - rect.left;
    } else if (rect.right > viewportWidth - viewportInset) {
      offset = viewportWidth - viewportInset - rect.right;
    }
    tooltip.style.marginLeft = `${offset}px`;
  };
  const sync = (): void => {
    tooltip.hidden = !(pinned || hovered || focused);
    trigger.setAttribute('aria-expanded', String(!tooltip.hidden));
    if (tooltip.hidden) {
      tooltip.style.removeProperty('margin-left');
    } else {
      keepTooltipInViewport();
    }
  };
  trigger.addEventListener('click', () => {
    pinned = !pinned;
    sync();
  });
  wrapper.addEventListener('mouseenter', () => {
    hovered = true;
    sync();
  });
  wrapper.addEventListener('mouseleave', () => {
    hovered = false;
    sync();
  });
  trigger.addEventListener('focus', () => {
    focused = true;
    sync();
  });
  trigger.addEventListener('blur', () => {
    focused = false;
    pinned = false;
    sync();
  });
  wrapper.append(trigger, tooltip);
  return wrapper;
}

function fieldLabel(doc: Document, label: string, copy?: string): HTMLElement {
  const row = element(doc, 'span', 'quant-backtest-simulation-field-label');
  row.append(label);
  if (copy) row.appendChild(help(doc, label, copy));
  return row;
}

function reportCurrency(report: BacktestReport): string {
  return report.currency?.trim().toUpperCase() || 'USD';
}

function finite(value: number): number {
  return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : 0;
}

function formatValue(value: number, maximumFractionDigits = 2): string {
  return finite(value).toLocaleString('en-US', { maximumFractionDigits });
}

function formatMoney(value: number): string {
  // Simulation and Performance use the same reference value formatter:
  // retain cents, sub-unit precision and uppercase million suffixes.
  return formatBacktestPerformanceValue(finite(value));
}

function formatRatio(value: number): string {
  return `${(finite(value) * 100).toFixed(1)}%`;
}

function formatPercentPoints(value: number): string {
  return `${finite(value).toFixed(1)}%`;
}

export function simulationShowsOutcome(simulation: BacktestSimulation): boolean {
  return simulation.method === 'resample' || simulation.variationPercent > 0;
}

export function cumulativeSimulationBins(
  bins: readonly BacktestSimulationHistogramBin[],
): readonly ReportChartPoint[] {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  if (bins.length === 0) return Object.freeze([]);
  const points: ReportChartPoint[] = [{ x: bins[0].from, y: 0 }];
  let cumulative = 0;
  bins.forEach((bin) => {
    cumulative += bin.count;
    points.push({
      x: bin.to,
      y: total > 0 ? cumulative / total : 0,
    });
  });
  return Object.freeze(points.map((point) => Object.freeze(point)));
}

function segmented<T extends string | number>(
  doc: Document,
  label: string,
  values: readonly Readonly<{ value: T; label: string; title?: string }>[],
  current: T,
  onChange: (value: T) => void,
): HTMLElement {
  const group = element(doc, 'div', 'quant-backtest-simulation-segmented');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  values.forEach((choice) => {
    const option = button(doc, choice.label, 'quant-backtest-simulation-segment');
    option.dataset.simulationFocus = `segment:${label}:${String(choice.value)}`;
    const active = choice.value === current;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
    if (choice.title) option.title = choice.title;
    option.addEventListener('click', () => {
      if (!active) onChange(choice.value);
    });
    group.appendChild(option);
  });
  return group;
}

function controlGroup(
  doc: Document,
  label: string,
  copy: string,
  control: HTMLElement,
  className = '',
): HTMLElement {
  const field = element(
    doc,
    'div',
    `quant-backtest-simulation-toolbar-field${className ? ` ${className}` : ''}`,
  );
  field.append(fieldLabel(doc, label, copy), control);
  return field;
}

function drawdownThresholdControl(
  doc: Document,
  simulation: BacktestSimulation,
  onChange: (change: BacktestSimulationChange) => void,
): HTMLElement {
  const group = element(doc, 'div', 'quant-backtest-simulation-segmented quant-backtest-simulation-dd-group');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Drawdown threshold');
  const actualDrawdownPercent = simulation.usesMae
    ? simulation.actual.openMaxDrawdownPercent
    : simulation.actual.maxDrawdownPercent;
  DRAWDOWN_PRESETS.forEach((multiple) => {
    const option = button(doc, `${multiple}× DD`, 'quant-backtest-simulation-segment');
    option.dataset.simulationFocus = `drawdown:${multiple}`;
    const active = simulation.drawdownMultiple === multiple;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
    option.title = `${(actualDrawdownPercent * multiple).toFixed(1)}% drawdown`;
    option.addEventListener('click', () => {
      if (!active) onChange({ drawdownMultiple: multiple });
    });
    group.appendChild(option);
  });
  const custom = element(doc, 'label', 'quant-backtest-simulation-dd-custom');
  const customInput = element(doc, 'input');
  customInput.type = 'number';
  customInput.inputMode = 'decimal';
  customInput.min = '0.1';
  customInput.step = '0.5';
  customInput.value = String(simulation.drawdownMultiple);
  customInput.dataset.simulationFocus = 'drawdown:custom';
  customInput.setAttribute('aria-label', 'Custom drawdown multiple');
  const commit = (): void => {
    const parsed = Number.parseFloat(customInput.value);
    const next = Number.isFinite(parsed) && parsed > 0 ? parsed : simulation.drawdownMultiple;
    customInput.value = String(next);
    if (next !== simulation.drawdownMultiple) onChange({ drawdownMultiple: next });
  };
  customInput.addEventListener('change', commit);
  customInput.addEventListener('blur', commit);
  custom.append(customInput, '×');
  if (!DRAWDOWN_PRESETS.includes(simulation.drawdownMultiple as 1.5 | 2 | 3)) {
    custom.classList.add('active');
  }
  group.appendChild(custom);
  return group;
}

function methodControl(
  doc: Document,
  simulation: BacktestSimulation,
  onChange: (change: BacktestSimulationChange) => void,
): HTMLElement {
  return segmented(doc, 'Method', [
    { value: 'resample', label: 'Resample', title: 'Pick trades at random, with repeats' },
    { value: 'shuffle', label: 'Shuffle', title: 'Same trades, new order' },
  ] as const, simulation.method, (method) => onChange({ method }));
}

function unitControl(
  doc: Document,
  report: BacktestReport,
  simulation: BacktestSimulation,
  onChange: (change: BacktestSimulationChange) => void,
): HTMLElement {
  return segmented(doc, 'Drawdown unit', [
    { value: 'currency', label: reportCurrency(report) },
    { value: 'percent', label: '%' },
  ] as const, simulation.drawdownUnit, (drawdownUnit) => onChange({ drawdownUnit }));
}

function chartModeControl(
  doc: Document,
  label: string,
  current: BacktestSimulationChartMode,
  onChange: (mode: BacktestSimulationChartMode) => void,
): HTMLElement {
  return segmented(doc, label, [
    { value: 'histogram', label: 'Histogram' },
    { value: 'cumulative', label: 'Cumulative', title: 'Share of runs at or below each level' },
  ] as const, current, onChange);
}

function desktopToolbar(
  doc: Document,
  report: BacktestReport,
  simulation: BacktestSimulation,
  settingsOpen: boolean,
  onChange: (change: BacktestSimulationChange) => void,
  onOpenSettings: () => void,
): HTMLElement {
  const toolbar = element(doc, 'div', 'quant-backtest-simulation-toolbar');
  toolbar.append(
    controlGroup(doc, 'Method', HELP.method, methodControl(doc, simulation, onChange)),
    controlGroup(
      doc,
      'Drawdown ≥',
      HELP.drawdownThreshold,
      drawdownThresholdControl(doc, simulation, onChange),
    ),
    controlGroup(doc, 'Drawdown unit', HELP.drawdownUnit, unitControl(doc, report, simulation, onChange)),
  );
  const settings = button(doc, '', 'quant-backtest-simulation-settings-button');
  settings.dataset.simulationSettingsTrigger = 'desktop';
  settings.dataset.simulationFocus = 'settings:desktop';
  settings.setAttribute('aria-label', 'Simulation settings');
  settings.setAttribute('aria-haspopup', 'dialog');
  settings.setAttribute('aria-expanded', String(settingsOpen));
  settings.appendChild(settingsIcon(doc));
  settings.addEventListener('click', onOpenSettings);
  toolbar.appendChild(settings);
  return toolbar;
}

function settingsFields(
  doc: Document,
  simulation: BacktestSimulation,
  onChange: (change: BacktestSimulationChange) => void,
): HTMLElement {
  const fields = element(doc, 'div', 'quant-backtest-simulation-settings-fields');
  const runsField = element(doc, 'div', 'quant-backtest-simulation-settings-field');
  runsField.appendChild(fieldLabel(doc, 'Simulations', HELP.runs));
  runsField.appendChild(settingsHint(doc, 'Number of alternative histories to simulate.'));
  const runs = element(doc, 'select');
  runs.id = 'quant-backtest-simulation-runs';
  runs.setAttribute('aria-label', 'Simulations');
  runs.dataset.simulationFocus = 'settings:runs';
  RUN_OPTIONS.forEach((value) => {
    const option = element(doc, 'option');
    option.value = String(value);
    option.textContent = value.toLocaleString('en-US');
    option.selected = value === simulation.runs;
    runs.appendChild(option);
  });
  if (!RUN_OPTIONS.includes(simulation.runs as 250 | 1000 | 2500)) {
    const option = element(doc, 'option');
    option.value = String(simulation.runs);
    option.textContent = simulation.runs.toLocaleString('en-US');
    option.selected = true;
    runs.appendChild(option);
  }
  runs.addEventListener('change', () => onChange({ runs: Number(runs.value) }));
  runsField.appendChild(simulationRunsControl(doc, runs));

  const variationField = element(doc, 'label', 'quant-backtest-simulation-settings-field');
  variationField.appendChild(fieldLabel(doc, 'Random P&L variation', HELP.variation));
  variationField.appendChild(settingsHint(doc, 'Randomly vary each trade’s profit or loss by this percentage.'));
  const variationWrap = element(doc, 'span', 'quant-backtest-simulation-variation');
  const variation = element(doc, 'input');
  variation.id = 'quant-backtest-simulation-variation';
  variation.dataset.simulationFocus = 'settings:variation';
  variation.type = 'number';
  variation.inputMode = 'decimal';
  variation.min = '0';
  variation.max = '100';
  variation.step = '1';
  variation.value = String(simulation.variationPercent);
  const commitVariation = (): void => {
    const parsed = Number.parseFloat(variation.value);
    const next = Math.min(100, Math.max(0, Number.isFinite(parsed) ? parsed : 0));
    variation.value = String(next);
    if (next !== simulation.variationPercent) onChange({ variationPercent: next });
  };
  variation.addEventListener('change', commitVariation);
  variation.addEventListener('blur', commitVariation);
  variationWrap.append(variation, '%');
  variationField.appendChild(variationWrap);

  const preserveField = element(doc, 'label', 'quant-backtest-simulation-preserve');
  const preserve = element(doc, 'input');
  preserve.id = 'quant-backtest-simulation-preserve';
  preserve.dataset.simulationFocus = 'settings:preserve';
  preserve.type = 'checkbox';
  preserve.checked = simulation.preserveWinLoss;
  preserve.disabled = simulation.variationPercent === 0;
  preserve.addEventListener('change', () => onChange({ preserveWinLoss: preserve.checked }));
  const preserveText = element(doc, 'span');
  preserveText.append('Preserve win/loss', help(doc, 'Preserve win/loss', HELP.preserveWinLoss));
  preserveText.appendChild(settingsHint(doc, 'Keep winners profitable and losers unprofitable.'));
  preserveField.append(preserve, preserveText);
  fields.append(runsField, variationField, preserveField);
  return fields;
}

/** Desktop presentation of the native value model. Keep the popup inside the
 * modal, so report replacement and destroy cannot leave a portal or listener. */
function simulationRunsControl(doc: Document, model: HTMLSelectElement): HTMLElement {
  if (!doc.defaultView?.matchMedia('(min-width: 1024px)').matches) return model;
  const wrapper = element(doc, 'div', 'quant-backtest-simulation-runs');
  model.classList.add('quant-backtest-simulation-runs-native');
  model.tabIndex = -1;
  model.setAttribute('aria-hidden', 'true');
  delete model.dataset.simulationFocus;
  const trigger = button(doc, model.value, 'quant-backtest-simulation-runs-trigger');
  trigger.dataset.simulationFocus = 'settings:runs';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-label', 'Simulations');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const caption = element(doc, 'span');
  caption.textContent = model.value;
  trigger.replaceChildren(caption, backtestIcon(doc, 'chevron-down'));
  const menu = element(doc, 'div', 'quant-backtest-simulation-runs-menu');
  menu.id = 'quant-backtest-simulation-runs-options';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Simulations');
  menu.hidden = true;
  const close = (restore = true): void => {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    if (restore && trigger.isConnected) trigger.focus({ preventScroll: true });
  };
  const options = [...model.options].map((option) => {
    const choice = button(doc, `${Number(option.value).toLocaleString('en-US')} runs`, 'quant-backtest-simulation-runs-option');
    choice.tabIndex = -1;
    choice.setAttribute('role', 'option');
    choice.setAttribute('aria-selected', String(option.selected));
    if (option.selected) {
      const check = svgElement(doc, 'svg');
      check.setAttribute('viewBox', '0 0 24 24');
      check.setAttribute('aria-hidden', 'true');
      check.classList.add('quant-backtest-icon');
      const path = svgElement(doc, 'path');
      path.setAttribute('d', 'M20 6 9 17l-5-5');
      check.appendChild(path); choice.appendChild(check);
    }
    choice.addEventListener('click', () => {
      model.value = option.value;
      close();
      model.dispatchEvent(new Event('change', { bubbles: true }));
    });
    menu.appendChild(choice);
    return choice;
  });
  const open = (): void => {
    menu.hidden = false;
    menu.style.top = `${-Math.max(0, model.selectedIndex) * 32}px`;
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', menu.id);
    options[Math.max(0, model.selectedIndex)]?.focus({ preventScroll: true });
  };
  model.addEventListener('change', () => { caption.textContent = model.value; });
  trigger.addEventListener('click', () => menu.hidden ? open() : close());
  trigger.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    open();
    if (event.key === 'Home') options[0]?.focus();
    if (event.key === 'End') options.at(-1)?.focus();
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const current = options.indexOf(doc.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[index]?.focus();
  });
  wrapper.addEventListener('focusout', (event) => {
    if (event.relatedTarget instanceof Node && !wrapper.contains(event.relatedTarget)) close(false);
  });
  wrapper.append(model, trigger, menu);
  return wrapper;
}

function mobileControlFields(
  doc: Document,
  report: BacktestReport,
  simulation: BacktestSimulation,
  onChange: (change: BacktestSimulationChange) => void,
): HTMLElement {
  const fields = element(doc, 'div', 'quant-backtest-simulation-mobile-controls');
  const add = (label: string, copy: string, control: HTMLElement): void => {
    const field = element(doc, 'section', 'quant-backtest-simulation-mobile-field');
    const heading = element(doc, 'div');
    const title = element(doc, 'strong');
    const description = element(doc, 'span');
    title.textContent = label;
    description.textContent = copy;
    heading.append(title, description);
    field.append(heading, control);
    fields.appendChild(field);
  };
  add('Method', HELP.method, methodControl(doc, simulation, onChange));
  add(
    'Drawdown ≥',
    HELP.drawdownThreshold,
    drawdownThresholdControl(doc, simulation, onChange),
  );
  add('Drawdown unit', HELP.drawdownUnit, unitControl(doc, report, simulation, onChange));
  if (simulationShowsOutcome(simulation)) {
    add(
      'Outcome distribution',
      HELP.view,
      chartModeControl(doc, 'Outcome distribution', simulation.outcomeChartMode, (outcomeChartMode) => {
        onChange({ outcomeChartMode });
      }),
    );
  }
  add(
    'Drawdown distribution',
    HELP.view,
    chartModeControl(doc, 'Drawdown distribution', simulation.drawdownChartMode, (drawdownChartMode) => {
      onChange({ drawdownChartMode });
    }),
  );
  return fields;
}

function settingsOverlay(
  doc: Document,
  report: BacktestReport,
  simulation: BacktestSimulation,
  onChange: (change: BacktestSimulationChange) => void,
  onClose: () => void,
): HTMLElement {
  const overlay = element(doc, 'div', 'quant-backtest-simulation-settings');
  const backdrop = button(doc, '', 'quant-backtest-simulation-settings-backdrop');
  backdrop.setAttribute('aria-label', 'Close simulation settings');
  backdrop.addEventListener('click', onClose);
  const dialog = element(doc, 'section', 'quant-backtest-simulation-settings-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'quant-backtest-simulation-settings-title');
  dialog.tabIndex = -1;
  const handle = element(doc, 'span', 'quant-backtest-simulation-settings-handle');
  handle.setAttribute('aria-hidden', 'true');
  const header = element(doc, 'header', 'quant-backtest-simulation-settings-header');
  const heading = element(doc, 'div');
  const title = element(doc, 'h3');
  const description = element(doc, 'p');
  title.id = 'quant-backtest-simulation-settings-title';
  title.textContent = 'Simulation settings';
  description.textContent = 'How many runs to simulate, and how much to vary each trade.';
  description.id = 'quant-backtest-simulation-settings-description';
  dialog.setAttribute('aria-describedby', description.id);
  heading.append(title, description);
  const close = button(doc, '', 'quant-backtest-simulation-settings-close');
  close.appendChild(backtestIcon(doc, 'close'));
  close.setAttribute('aria-label', 'Close simulation settings');
  close.dataset.simulationFocus = 'settings:close';
  close.addEventListener('click', onClose);
  header.append(heading, close);
  const body = element(doc, 'div', 'quant-backtest-simulation-settings-body');
  body.append(
    mobileControlFields(doc, report, simulation, onChange),
    settingsFields(doc, simulation, onChange),
  );
  dialog.append(handle, header, body);
  overlay.append(backdrop, dialog);
  overlay.addEventListener('pointerdown', (event) => {
    const expanded = dialog.querySelector<HTMLButtonElement>(
      '.quant-backtest-simulation-runs-trigger[aria-expanded="true"]',
    );
    if (expanded && event.target instanceof Node
      && !expanded.parentElement?.contains(event.target)) expanded.click();
  }, true);
  return overlay;
}

function kpi(
  doc: Document,
  label: string,
  value: string,
  unit?: string,
  tone: 'positive' | 'negative' | 'neutral' = 'neutral',
  title?: string,
): HTMLElement {
  const item = element(doc, 'div', 'quant-backtest-simulation-kpi');
  if (title) item.title = title;
  const name = element(doc, 'span');
  name.textContent = label;
  const amount = element(doc, 'strong', `quant-backtest-tone-${tone}`);
  amount.textContent = value;
  if (unit) {
    const suffix = element(doc, 'small');
    suffix.textContent = unit;
    amount.append(' ', suffix);
  }
  item.append(name, amount);
  return item;
}

function metrics(
  doc: Document,
  report: BacktestReport,
  simulation: BacktestSimulation,
): HTMLElement {
  const currency = reportCurrency(report);
  const result = element(doc, 'div', 'quant-backtest-simulation-metrics');
  const showsOutcome = simulationShowsOutcome(simulation);
  if (showsOutcome) {
    result.append(
      kpi(
        doc,
        'Probability of profit',
        formatRatio(simulation.metrics.probabilityOfProfit),
        undefined,
        simulation.metrics.probabilityOfProfit >= 0.5 ? 'positive' : 'negative',
      ),
      kpi(
        doc,
        'Median outcome',
        formatMoney(simulation.metrics.medianOutcome),
        currency,
        simulation.metrics.medianOutcome >= 0 ? 'positive' : 'negative',
      ),
    );
  } else {
    result.appendChild(kpi(
      doc,
      'Final net profit (every run)',
      formatMoney(simulation.metrics.medianOutcome),
      currency,
    ));
  }
  const percentUnit = simulation.drawdownUnit === 'percent';
  const p95 = percentUnit
    ? formatPercentPoints(simulation.metrics.p95DrawdownPercent)
    : formatMoney(simulation.metrics.p95Drawdown);
  const p99 = percentUnit
    ? formatPercentPoints(simulation.metrics.p99DrawdownPercent)
    : formatMoney(simulation.metrics.p99Drawdown);
  const actualValue = simulation.usesMae
    ? (percentUnit
        ? formatPercentPoints(simulation.actual.openMaxDrawdownPercent)
        : formatMoney(simulation.actual.openMaxDrawdown))
    : (percentUnit
        ? formatPercentPoints(simulation.actual.maxDrawdownPercent)
        : formatMoney(simulation.actual.maxDrawdown));
  const actualKind = simulation.usesMae ? 'open max drawdown' : 'max drawdown';
  result.append(
    kpi(doc, 'P95–P99 drawdown', `${p95} - ${p99}`, percentUnit ? undefined : currency),
    kpi(
      doc,
      'Risk of ruin',
      formatRatio(simulation.metrics.riskOfRuin),
      undefined,
      simulation.metrics.riskOfRuin > 0 ? 'negative' : 'positive',
      'How often a run lost all of the starting capital',
    ),
    kpi(
      doc,
      `P(drawdown ≥ ${formatPercentPoints(simulation.metrics.thresholdPercent)})`,
      formatRatio(simulation.metrics.drawdownProbability),
      undefined,
      simulation.metrics.drawdownProbability > 0.05 ? 'negative' : 'positive',
      `How often a run’s ${actualKind} reached ${formatValue(simulation.drawdownMultiple, 2)}× the backtest’s real ${actualKind}`,
    ),
    kpi(doc, 'P95 max losing streak', String(simulation.metrics.p95LosingStreak), 'trades'),
    kpi(
      doc,
      `Actual ${actualKind}`,
      actualValue,
      percentUnit ? undefined : currency,
      'neutral',
      simulation.usesMae
        ? 'The backtest’s deepest equity dip counting each trade’s worst unrealized loss (MAE).'
        : 'The backtest’s deepest dip in realized equity, measured at trade closes.',
    ),
  );
  return result;
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function chartBounds(points: readonly ReportChartDataPoint[]): Bounds {
  const x = points.map((point) => point.x).filter(Number.isFinite);
  const y = points.flatMap((point) => (
    'y' in point && typeof point.y === 'number'
      ? [point.y]
      : 'low' in point ? [point.low, point.high] : []
  )).filter(Number.isFinite);
  const minX = Math.min(...x, 0);
  const maxX = Math.max(...x, 1);
  const minY = Math.min(...y, 0);
  const maxY = Math.max(...y, 1);
  return { minX, maxX, minY, maxY };
}

function fallbackSvg(
  doc: Document,
  label: string,
  points: readonly ReportChartDataPoint[],
  height: number,
): { svg: SVGSVGElement; xAt: (value: number) => number; yAt: (value: number) => number } {
  const svg = svgElement(doc, 'svg');
  svg.classList.add('quant-backtest-simulation-chart-fallback');
  svg.setAttribute('viewBox', `0 0 640 ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const plot = { left: 42, right: 626, top: 12, bottom: height - 28 };
  const bounds = chartBounds(points);
  const spanX = bounds.maxX - bounds.minX || 1;
  const spanY = bounds.maxY - bounds.minY || 1;
  const xAt = (value: number) => plot.left + (value - bounds.minX) / spanX * (plot.right - plot.left);
  const yAt = (value: number) => plot.bottom - (value - bounds.minY) / spanY * (plot.bottom - plot.top);
  return { svg, xAt, yAt };
}

function chartPanel(
  doc: Document,
  titleText: string,
  chart: HTMLElement,
  actions?: HTMLElement,
): HTMLElement {
  const panel = element(doc, 'section', 'quant-backtest-simulation-chart-panel');
  const header = element(doc, 'header');
  const title = element(doc, 'h3');
  title.textContent = titleText;
  header.appendChild(title);
  if (actions) header.appendChild(actions);
  panel.append(header, chart);
  return panel;
}

function pathChart(
  doc: Document,
  report: BacktestReport,
  simulation: BacktestSimulation,
): HTMLElement {
  const host = element(doc, 'div', 'quant-backtest-simulation-chart-host quant-backtest-simulation-paths-host');
  const indices = simulation.bands.index;
  const outer: ReportChartRangePoint[] = indices.map((x, index) => ({
    x,
    low: simulation.bands.p5[index] ?? 0,
    high: simulation.bands.p95[index] ?? 0,
  }));
  const inner: ReportChartRangePoint[] = indices.map((x, index) => ({
    x,
    low: simulation.bands.p25[index] ?? 0,
    high: simulation.bands.p75[index] ?? 0,
  }));
  const median: ReportChartPoint[] = indices.map((x, index) => ({
    x,
    y: simulation.bands.p50[index] ?? 0,
  }));
  const actual: ReportChartPoint[] = simulation.actual.path.flatMap((point, index) => (
    typeof point.y === 'number' && Number.isFinite(point.y)
      ? [{ x: typeof point.x === 'number' ? point.x : index, y: point.y }]
      : []
  ));
  const all = [...outer, ...actual, ...median];
  const fallback = fallbackSvg(doc, 'Simulated Net Profit Paths', all, 320);
  const outerPolygon = svgElement(doc, 'polygon');
  outerPolygon.setAttribute('class', 'quant-backtest-simulation-band quant-backtest-simulation-band-outer');
  outerPolygon.setAttribute('points', [
    ...outer.map((point) => `${fallback.xAt(point.x)},${fallback.yAt('high' in point ? point.high : 0)}`),
    ...[...outer].reverse().map((point) => `${fallback.xAt(point.x)},${fallback.yAt('low' in point ? point.low : 0)}`),
  ].join(' '));
  const innerPolygon = svgElement(doc, 'polygon');
  innerPolygon.setAttribute('class', 'quant-backtest-simulation-band quant-backtest-simulation-band-inner');
  innerPolygon.setAttribute('points', [
    ...inner.map((point) => `${fallback.xAt(point.x)},${fallback.yAt('high' in point ? point.high : 0)}`),
    ...[...inner].reverse().map((point) => `${fallback.xAt(point.x)},${fallback.yAt('low' in point ? point.low : 0)}`),
  ].join(' '));
  const medianPath = svgElement(doc, 'polyline');
  medianPath.setAttribute('class', 'quant-backtest-simulation-median');
  medianPath.setAttribute('points', median.map((point) => (
    `${fallback.xAt(point.x)},${fallback.yAt(point.y)}`
  )).join(' '));
  const actualPath = svgElement(doc, 'polyline');
  actualPath.setAttribute('class', 'quant-backtest-simulation-actual-path');
  actualPath.setAttribute('points', actual.map((point) => (
    `${fallback.xAt(point.x)},${fallback.yAt(point.y)}`
  )).join(' '));
  fallback.svg.append(outerPolygon, innerPolygon, medianPath, actualPath);
  host.appendChild(fallback.svg);
  const series: ReportChartSeries<ReportChartDataPoint>[] = [
    {
      name: '5–95% band',
      kind: 'arearange',
      points: outer,
      color: PATH_BOUNDARY_COLOR,
      fillColor: 'rgba(113, 113, 122, 0.15)',
      lineWidth: 1,
      dashStyle: 'ShortDash',
      enableMouseTracking: true,
      markerEnabled: false,
      zIndex: 1,
    },
    {
      name: '25–75% band',
      kind: 'arearange',
      points: inner,
      color: PATH_BOUNDARY_COLOR,
      fillColor: 'rgba(113, 113, 122, 0.30)',
      lineWidth: 1,
      enableMouseTracking: true,
      markerEnabled: false,
      zIndex: 2,
    },
    {
      name: 'Median simulation',
      kind: 'line',
      points: median,
      color: PATH_BOUNDARY_COLOR,
      dashStyle: 'Dash',
      lineWidth: 1.5,
      markerEnabled: false,
      zIndex: 3,
    },
    {
      name: 'Actual',
      kind: 'line',
      points: actual,
      color: PROFIT_COLOR,
      lineWidth: 2,
      markerEnabled: false,
      zIndex: 4,
    },
  ];
  registerReportChart(host, {
    kind: 'line',
    label: 'Simulated Net Profit Paths',
    axis: 'linear',
    points: [],
    series,
    height: 320,
    xAxisTitle: 'Trade #',
    yAxisTitle: `Net profit (${reportCurrency(report)})`,
    tooltipMode: 'simulation-paths',
    valueUnit: 'currency',
    currency: reportCurrency(report),
    chartSpacing: [10, 10, 5, 10],
    yAxisGridLineWidth: 0,
    showZeroLine: false,
    xAxisTickColor: '#333333',
  });
  const legend = element(doc, 'div', 'quant-backtest-simulation-chart-legend');
  [
    ['actual', 'Actual backtest'],
    ['median', 'Median simulation'],
    ['band-inner', '25–75% band'],
    ['band-outer', '5–95% band'],
  ].forEach(([kind, label]) => {
    const item = element(doc, 'span');
    const swatch = element(doc, 'i', `quant-backtest-simulation-legend-${kind}`);
    item.append(swatch, label);
    legend.appendChild(item);
  });
  const content = element(doc, 'div');
  content.append(host, legend);
  return chartPanel(doc, 'Simulated Net Profit Paths', content);
}

function distributionChart(
  doc: Document,
  options: {
    readonly title: string;
    readonly bins: readonly BacktestSimulationHistogramBin[];
    readonly mode: BacktestSimulationChartMode;
    readonly actual: number;
    readonly p5: number;
    readonly p95: number;
    readonly splitAt: number;
    readonly belowColor: string;
    readonly aboveColor: string;
    readonly actualLabelColor: string;
    readonly xAxisTitle: string;
    readonly valueUnit: ReportChartValueUnit;
    readonly currency?: string;
    readonly onModeChange: (mode: BacktestSimulationChartMode) => void;
  },
): HTMLElement {
  const actions = chartModeControl(doc, options.title, options.mode, options.onModeChange);
  actions.classList.add('quant-backtest-simulation-chart-actions');
  const host = element(doc, 'div', 'quant-backtest-simulation-chart-host quant-backtest-simulation-distribution-host');
  const histogram = options.bins.map((bin) => {
    const x = (bin.from + bin.to) / 2;
    return {
      x,
      y: bin.count,
      from: bin.from,
      to: bin.to,
      count: bin.count,
      color: x < options.splitAt ? options.belowColor : options.aboveColor,
    } satisfies ReportChartDataPoint;
  });
  const cumulative = cumulativeSimulationBins(options.bins);
  const points = options.mode === 'histogram' ? histogram : cumulative;
  const fallback = fallbackSvg(doc, options.title, points, 240);
  if (options.mode === 'histogram') {
    const width = 584 / Math.max(1, histogram.length);
    const zero = fallback.yAt(0);
    histogram.forEach((point, index) => {
      const bar = svgElement(doc, 'rect');
      bar.setAttribute('x', String(42 + index * width + 1));
      bar.setAttribute('y', String(fallback.yAt(point.y)));
      bar.setAttribute('width', String(Math.max(1, width - 2)));
      bar.setAttribute('height', String(Math.max(1, zero - fallback.yAt(point.y))));
      bar.setAttribute('fill', point.color ?? options.aboveColor);
      fallback.svg.appendChild(bar);
    });
  } else {
    fallbackGradientSequence += 1;
    const gradientId = `quant-backtest-simulation-gradient-${fallbackGradientSequence}`;
    const defs = svgElement(doc, 'defs');
    const gradient = svgElement(doc, 'linearGradient');
    gradient.id = gradientId;
    gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
    gradient.setAttribute('x1', '42');
    gradient.setAttribute('x2', '626');
    const splitOffset = Math.max(0, Math.min(1, (fallback.xAt(options.splitAt) - 42) / 584));
    [
      [0, options.belowColor],
      [splitOffset, options.belowColor],
      [splitOffset, options.aboveColor],
      [1, options.aboveColor],
    ].forEach(([offset, color]) => {
      const stop = svgElement(doc, 'stop');
      stop.setAttribute('offset', String(offset));
      stop.setAttribute('stop-color', String(color));
      gradient.appendChild(stop);
    });
    defs.appendChild(gradient);
    fallback.svg.appendChild(defs);
    const area = svgElement(doc, 'polygon');
    area.setAttribute('class', 'quant-backtest-simulation-cumulative-area');
    area.style.fill = `url(#${gradientId})`;
    area.style.fillOpacity = '0.15';
    area.setAttribute('points', [
      `${fallback.xAt(points[0]?.x ?? 0)},${fallback.yAt(0)}`,
      ...points.map((point) => `${fallback.xAt(point.x)},${fallback.yAt(point.y)}`),
      `${fallback.xAt(points.at(-1)?.x ?? 0)},${fallback.yAt(0)}`,
    ].join(' '));
    const line = svgElement(doc, 'polyline');
    line.setAttribute('class', 'quant-backtest-simulation-cumulative-line');
    line.style.stroke = `url(#${gradientId})`;
    line.setAttribute('points', points.map((point) => (
      `${fallback.xAt(point.x)},${fallback.yAt(point.y)}`
    )).join(' '));
    fallback.svg.append(area, line);
  }
  host.appendChild(fallback.svg);
  const plotLines: ReportChartPlotLine[] = [
    {
      axis: 'x',
      value: options.p5,
      color: NEUTRAL_COLOR,
      dashStyle: 'Dot',
      label: 'P5',
      labelAlign: 'right',
      labelUseHTML: true,
      labelX: -5,
      labelY: 26,
      labelColor: NEUTRAL_TEXT_COLOR,
      labelBackgroundColor: 'var(--quant-backtest-surface)',
      labelPadding: '1px 4px',
      labelBorderRadius: '3px',
      labelFontSize: '10px',
      zIndex: 4,
    },
    {
      axis: 'x',
      value: options.p95,
      color: NEUTRAL_COLOR,
      dashStyle: 'Dot',
      label: 'P95',
      labelAlign: 'left',
      labelUseHTML: true,
      labelX: 5,
      labelY: 26,
      labelColor: NEUTRAL_TEXT_COLOR,
      labelBackgroundColor: 'var(--quant-backtest-surface)',
      labelPadding: '1px 4px',
      labelBorderRadius: '3px',
      labelFontSize: '10px',
      zIndex: 4,
    },
    {
      axis: 'x',
      value: options.actual,
      color: options.actual >= 0 ? options.aboveColor : options.belowColor,
      width: 2,
      dashStyle: 'Dash',
      label: 'Actual',
      labelAlign: 'left',
      labelUseHTML: true,
      labelX: 5,
      labelY: 12,
      labelColor: options.actualLabelColor,
      labelBackgroundColor: 'var(--quant-backtest-surface)',
      labelPadding: '1px 4px',
      labelBorderRadius: '3px',
      labelFontSize: '10px',
      zIndex: 5,
    },
  ];
  registerReportChart(host, {
    kind: options.mode === 'histogram' ? 'column' : 'area',
    label: options.title,
    axis: 'linear',
    points,
    height: 240,
    xAxisTitle: options.xAxisTitle,
    ...(options.mode === 'cumulative'
      ? { yAxisTitle: '% of runs', yAxisMin: 0, yAxisMax: 1, yAxisPercent: true }
      : {}),
    lineColor: options.aboveColor,
    positiveColor: options.aboveColor,
    negativeColor: options.belowColor,
    ...(options.mode === 'cumulative' ? {
      series: [{
        name: 'Runs at or below',
        kind: 'area' as const,
        points: cumulative,
        color: options.aboveColor,
        lineWidth: 2,
        fillOpacity: 0.15,
        markerEnabled: false,
        zoneAxis: 'x' as const,
        zones: [
          { value: options.splitAt, color: options.belowColor },
          { color: options.aboveColor },
        ],
      }],
    } : {}),
    plotLines,
    tooltipMode: 'simulation-distribution',
    valueUnit: options.valueUnit,
    currency: options.currency,
    columnBorderRadius: 0,
    columnGroupPadding: 0,
    columnPointPadding: 0.05,
    chartSpacing: [10, 10, 5, 10],
    yAxisGridLineWidth: 0,
    showZeroLine: false,
    xAxisTickColor: '#333333',
  });
  return chartPanel(doc, options.title, host, actions);
}

function streaks(doc: Document, simulation: BacktestSimulation): HTMLElement {
  const panel = element(doc, 'section', 'quant-backtest-simulation-streaks');
  const title = element(doc, 'h3');
  title.textContent = 'Streaks & Recovery';
  const scroll = element(doc, 'div');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Streaks and recovery table');
  const table = element(doc, 'table');
  const head = element(doc, 'thead');
  const headerRow = element(doc, 'tr');
  ['Metric', 'Actual', 'Median', 'P95'].forEach((label) => {
    const cell = element(doc, 'th');
    cell.scope = 'col';
    cell.textContent = label;
    headerRow.appendChild(cell);
  });
  head.appendChild(headerRow);
  const body = element(doc, 'tbody');
  [
    ['Longest losing streak', simulation.streaks.longestLosingStreak],
    ['Max DD duration', simulation.streaks.maxDrawdownDuration],
    ['Recovery duration', simulation.streaks.recoveryDuration],
  ].forEach(([label, values]) => {
    const row = element(doc, 'tr');
    const name = element(doc, 'td');
    name.textContent = String(label);
    row.appendChild(name);
    const metric = values as BacktestSimulation['streaks']['longestLosingStreak'];
    [metric.actual, metric.median, metric.p95].forEach((value) => {
      const cell = element(doc, 'td');
      cell.textContent = `${value} trades`;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  table.append(head, body);
  scroll.appendChild(table);
  const note = element(doc, 'p');
  note.textContent = 'Max DD duration counts trades from the peak before the deepest drawdown to its trough; recovery counts trades from that trough back to the prior peak. A run that ends still under water contributes the trades it had left, so recovery figures are a floor.';
  panel.append(title, scroll, note);
  return panel;
}

function methodology(doc: Document, simulation: BacktestSimulation): HTMLElement {
  const note = element(doc, 'p', 'quant-backtest-simulation-methodology');
  let copy = `Built from this backtest’s ${simulation.populationSize} closed trades (net P&L, after commission), so the simulations can only replay the trades it saw: they measure repeatability and sequencing risk, not new market regimes.`;
  copy += simulation.usesMae
    ? ' Drawdowns count each trade’s worst unrealized loss (its MAE), the same way the engine measures the Performance tab’s max drawdown. Streak and recovery counts stay on closed trades.'
    : ' This backtest carries no MAE/MFE, so drawdowns use closed trades only and can read lower than the Performance tab’s bar-by-bar figure.';
  if (simulation.method === 'shuffle' && simulation.variationPercent === 0) {
    copy += ' In Shuffle mode every run ends at the same total by design.';
  }
  if (simulation.variationPercent > 0) {
    copy += ` Each trade is also nudged by about ${formatValue(simulation.variationPercent, 2)}%${simulation.preserveWinLoss ? ' without changing its sign' : ''}.`;
  }
  note.textContent = copy;
  return note;
}

function simulationRunStatus(
  doc: Document,
  report: BacktestReport,
  onChange: (change: BacktestSimulationChange) => void,
): HTMLElement | null {
  const run = report.simulationRun;
  if (!run) return null;
  const status = element(
    doc,
    'div',
    `quant-backtest-simulation-run-status is-${run.status}`,
  );
  status.dataset.simulationRunStatus = run.status;
  const copy = element(doc, 'div');
  const title = element(doc, 'strong');
  const detail = element(doc, 'span');
  if (run.status === 'pending') {
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    title.textContent = `Running ${run.totalRuns.toLocaleString('en-US')} simulations…`;
    detail.textContent = `${run.completedRuns.toLocaleString('en-US')} of ${run.totalRuns.toLocaleString('en-US')} complete`;
    const progress = element(doc, 'progress');
    progress.max = 1;
    progress.value = run.progress;
    progress.setAttribute('aria-label', 'Simulation progress');
    copy.append(title, detail);
    status.append(copy, progress);
  } else {
    status.setAttribute('role', 'alert');
    title.textContent = 'Simulation could not be completed';
    detail.textContent = run.message || 'The previous result is still shown. Try the simulation again.';
    const retry = button(doc, 'Retry', 'quant-backtest-button quant-backtest-simulation-retry');
    retry.dataset.simulationFocus = 'run:retry';
    retry.addEventListener('click', () => onChange({ ...run.settings }));
    copy.append(title, detail);
    status.append(copy, retry);
  }
  return status;
}

export function renderSimulationView(options: SimulationViewOptions): HTMLElement {
  const { document: doc, report, settingsOpen, onSettingsOpenChange, onChange } = options;
  const container = element(doc, 'div', 'quant-backtest-page quant-backtest-simulation');
  container.id = 'Simulation';
  const simulation = report.simulation;
  if (!simulation) {
    const empty = element(doc, 'div', 'quant-backtest-state quant-backtest-simulation-empty');
    if (report.simulationUnavailableReason === 'invalid-initial-capital') {
      empty.textContent = 'The simulation needs a starting capital to measure drawdowns against.';
    } else if (report.simulationUnavailableReason === 'no-closed-trades') {
      empty.textContent = 'No closed trades to simulate.';
    } else {
      empty.textContent = 'Simulation requires a settled closed-trade ledger.';
    }
    container.appendChild(empty);
    return container;
  }

  const controlsSimulation: BacktestSimulation = report.simulationRun
    ? { ...simulation, ...report.simulationRun.settings }
    : simulation;

  container.appendChild(desktopToolbar(
    doc,
    report,
    controlsSimulation,
    settingsOpen,
    onChange,
    () => onSettingsOpenChange(true),
  ));
  if (report.simulationWarning) {
    const warning = element(doc, 'p', 'quant-backtest-simulation-warning');
    warning.setAttribute('role', 'status');
    warning.textContent = report.simulationWarning;
    container.appendChild(warning);
  }
  const runStatus = simulationRunStatus(doc, report, onChange);
  if (runStatus) container.appendChild(runStatus);
  const content = element(doc, 'div', 'quant-backtest-simulation-content');
  content.append(metrics(doc, report, simulation), pathChart(doc, report, simulation));

  const showsOutcome = simulationShowsOutcome(simulation);
  const distributions = element(
    doc,
    'div',
    `quant-backtest-simulation-distributions${showsOutcome ? '' : ' single'}`,
  );
  if (showsOutcome) {
    distributions.appendChild(distributionChart(doc, {
      title: `Outcome Distribution (${reportCurrency(report)})`,
      bins: simulation.outcomeHistogram,
      mode: simulation.outcomeChartMode,
      actual: simulation.actual.finalPnl,
      p5: simulation.metrics.p5Outcome,
      p95: simulation.metrics.p95Outcome,
      splitAt: 0,
      belowColor: LOSS_COLOR,
      aboveColor: PROFIT_COLOR,
      actualLabelColor: simulation.actual.finalPnl >= 0 ? PROFIT_COLOR : LOSS_TEXT_COLOR,
      xAxisTitle: `Final net profit (${reportCurrency(report)})`,
      valueUnit: 'currency',
      currency: reportCurrency(report),
      onModeChange: (outcomeChartMode) => onChange({ outcomeChartMode }),
    }));
  }
  const percentUnit = simulation.drawdownUnit === 'percent';
  const actualDrawdown = simulation.usesMae
    ? (percentUnit ? simulation.actual.openMaxDrawdownPercent / 100 : simulation.actual.openMaxDrawdown)
    : (percentUnit ? simulation.actual.maxDrawdownPercent / 100 : simulation.actual.maxDrawdown);
  distributions.appendChild(distributionChart(doc, {
    title: simulation.usesMae ? 'Open Max Drawdown Distribution' : 'Max Drawdown Distribution',
    bins: simulation.drawdownHistogram,
    mode: simulation.drawdownChartMode,
    actual: actualDrawdown,
    p5: percentUnit ? simulation.metrics.p5DrawdownPercent / 100 : simulation.metrics.p5Drawdown,
    p95: percentUnit ? simulation.metrics.p95DrawdownPercent / 100 : simulation.metrics.p95Drawdown,
    splitAt: percentUnit ? simulation.metrics.p95DrawdownPercent / 100 : simulation.metrics.p95Drawdown,
    belowColor: 'rgba(242, 54, 69, 0.4)',
    aboveColor: LOSS_COLOR,
    actualLabelColor: LOSS_TEXT_COLOR,
    xAxisTitle: percentUnit
      ? `${simulation.usesMae ? 'Open max' : 'Max'} drawdown (% of peak equity)`
      : `${simulation.usesMae ? 'Open max' : 'Max'} drawdown (${reportCurrency(report)})`,
    valueUnit: percentUnit ? 'percent' : 'currency',
    ...(percentUnit ? {} : { currency: reportCurrency(report) }),
    onModeChange: (drawdownChartMode) => onChange({ drawdownChartMode }),
  }));
  content.append(distributions, streaks(doc, simulation), methodology(doc, simulation));
  container.appendChild(content);

  const mobileSettings = button(doc, '', 'quant-backtest-simulation-mobile-settings');
  mobileSettings.dataset.simulationSettingsTrigger = 'mobile';
  mobileSettings.dataset.simulationFocus = 'settings:mobile';
  mobileSettings.setAttribute('aria-label', 'Simulation settings');
  mobileSettings.setAttribute('aria-haspopup', 'dialog');
  mobileSettings.setAttribute('aria-expanded', String(settingsOpen));
  mobileSettings.appendChild(settingsIcon(doc));
  mobileSettings.addEventListener('click', () => onSettingsOpenChange(true));
  container.appendChild(mobileSettings);

  if (settingsOpen) {
    const overlay = settingsOverlay(doc, report, controlsSimulation, onChange, () => {
      onSettingsOpenChange(false);
    });
    // The dialog remains inside the mounted Simulation page so charts do not
    // tear down. Hide every sibling from keyboard and accessibility traversal
    // while the modal surface is active.
    [...container.children].forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      child.inert = true;
      child.setAttribute('aria-hidden', 'true');
    });
    container.appendChild(overlay);
  }
  return container;
}
