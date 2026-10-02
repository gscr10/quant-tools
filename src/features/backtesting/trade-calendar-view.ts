import {
  calendarMonthLayout,
  currentCalendarMonthKey,
  formatCalendarDayLabel,
  formatCalendarMonthLabel,
  shiftCalendarMonth,
} from '../../shared/calendar.ts';
import {
  summarizeBacktestTradeCalendarMonth,
  type BacktestTradeCalendarDay,
} from './trade-calendar.ts';
import { formatBacktestTradeMetric } from './trade-log.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const WEEKDAYS = Object.freeze(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);

export interface BacktestTradeCalendarViewOptions {
  readonly days: ReadonlyMap<string, BacktestTradeCalendarDay>;
  readonly currency: string;
  readonly month: string;
  readonly onMonthChange: (
    month: string,
    focusTarget: 'previous' | 'next' | 'current',
  ) => void;
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

function navigationIcon(
  doc: Document,
  name: 'previous' | 'next' | 'current',
): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('quant-backtest-calendar-nav-icon');
  const paths = name === 'previous'
    ? ['m15 18-6-6 6-6']
    : name === 'next'
      ? ['m9 18 6-6-6-6']
      : ['M17 12H3', 'm11 18 6-6-6-6', 'M21 5v14'];
  paths.forEach((value) => {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', value);
    svg.appendChild(path);
  });
  return svg;
}

function navigationButton(
  doc: Document,
  name: 'previous' | 'next' | 'current',
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const control = element(doc, 'button', 'quant-backtest-calendar-nav');
  control.type = 'button';
  control.setAttribute('aria-label', label);
  control.title = label;
  control.dataset.calendarNavigation = name;
  control.appendChild(navigationIcon(doc, name));
  control.addEventListener('click', onClick);
  return control;
}

function money(
  doc: Document,
  value: number,
  currency: string,
  className: string,
): HTMLElement {
  const wrapper = element(doc, 'span', `${className} quant-backtest-calendar-money`);
  if (value > 0) wrapper.classList.add('is-positive');
  if (value < 0) wrapper.classList.add('is-negative');
  const amount = element(doc, 'span', 'quant-backtest-calendar-amount');
  amount.textContent = formatBacktestTradeMetric(value, undefined, true);
  const unit = element(doc, 'span', 'quant-backtest-calendar-currency');
  unit.textContent = currency;
  wrapper.append(amount, unit);
  return wrapper;
}

function renderDayDetails(
  doc: Document,
  day: BacktestTradeCalendarDay,
  currency: string,
): HTMLElement {
  const details = element(doc, 'div', 'quant-backtest-calendar-day-details');
  details.appendChild(money(doc, day.pnl, currency, 'quant-backtest-calendar-day-pnl'));
  const count = element(doc, 'span', 'quant-backtest-calendar-day-meta');
  count.textContent = `${day.tradeCount} trade${day.tradeCount === 1 ? '' : 's'}`;
  const winRate = element(doc, 'span', 'quant-backtest-calendar-day-meta');
  winRate.textContent = `${day.winRate.toFixed(0)}% win`;
  details.append(count, winRate);
  return details;
}

function summaryItem(doc: Document, label: string): HTMLElement {
  const item = element(doc, 'div', 'quant-backtest-calendar-summary-item');
  const caption = element(doc, 'span', 'quant-backtest-calendar-summary-label');
  caption.textContent = label;
  item.appendChild(caption);
  return item;
}

function appendDaySummary(
  doc: Document,
  parent: HTMLElement,
  day: BacktestTradeCalendarDay | null,
  currency: string,
): void {
  const value = element(doc, 'div', 'quant-backtest-calendar-summary-value');
  const date = element(doc, 'span', 'quant-backtest-calendar-summary-date');
  date.textContent = day ? formatCalendarDayLabel(day.date) : '—';
  value.appendChild(date);
  if (day) value.appendChild(money(doc, day.pnl, currency, 'quant-backtest-calendar-summary-money'));
  parent.appendChild(value);
}

export function renderBacktestTradeCalendar(
  doc: Document,
  options: BacktestTradeCalendarViewOptions,
): HTMLElement {
  const currency = options.currency.trim().toUpperCase() || 'USD';
  const summary = summarizeBacktestTradeCalendarMonth(options.days, options.month);
  const layout = calendarMonthLayout(options.month);
  const container = element(doc, 'div', 'quant-backtest-calendar');

  const heading = element(doc, 'div', 'quant-backtest-calendar-heading');
  const navigation = element(doc, 'div', 'quant-backtest-calendar-navigation');
  navigation.append(
    navigationButton(doc, 'previous', 'Previous month', () => {
      options.onMonthChange(shiftCalendarMonth(options.month, -1), 'previous');
    }),
  );
  const title = element(doc, 'strong');
  title.textContent = formatCalendarMonthLabel(options.month);
  title.setAttribute('aria-live', 'polite');
  title.setAttribute('aria-atomic', 'true');
  navigation.append(
    title,
    navigationButton(doc, 'next', 'Next month', () => {
      options.onMonthChange(shiftCalendarMonth(options.month, 1), 'next');
    }),
    navigationButton(doc, 'current', 'Move to current month', () => {
      options.onMonthChange(currentCalendarMonthKey(), 'current');
    }),
  );
  heading.appendChild(navigation);
  container.appendChild(heading);

  const grid = element(doc, 'div', 'quant-backtest-calendar-grid');
  grid.setAttribute('role', 'grid');
  grid.setAttribute('aria-readonly', 'true');
  grid.setAttribute('aria-label', formatCalendarMonthLabel(options.month));
  const headerRow = element(doc, 'div', 'quant-backtest-calendar-row');
  headerRow.setAttribute('role', 'row');
  WEEKDAYS.forEach((weekday) => {
    const header = element(doc, 'span', 'quant-backtest-calendar-weekday');
    header.setAttribute('role', 'columnheader');
    header.textContent = weekday;
    headerRow.appendChild(header);
  });
  grid.appendChild(headerRow);
  let weekRow = element(doc, 'div', 'quant-backtest-calendar-row');
  weekRow.setAttribute('role', 'row');
  let weekCellCount = 0;
  const appendWeekCell = (cell: HTMLElement): void => {
    weekRow.appendChild(cell);
    weekCellCount += 1;
    if (weekCellCount < 7) return;
    grid.appendChild(weekRow);
    weekRow = element(doc, 'div', 'quant-backtest-calendar-row');
    weekRow.setAttribute('role', 'row');
    weekCellCount = 0;
  };
  for (let index = 0; index < layout.firstWeekday; index += 1) {
    const blank = element(doc, 'div', 'quant-backtest-calendar-day is-padding');
    blank.setAttribute('role', 'gridcell');
    blank.setAttribute('aria-label', 'Outside current month');
    appendWeekCell(blank);
  }
  for (let dayNumber = 1; dayNumber <= layout.daysInMonth; dayNumber += 1) {
    const date = `${options.month}-${String(dayNumber).padStart(2, '0')}`;
    const value = options.days.get(date);
    const state = value
      ? value.pnl > 0
        ? 'is-profit'
        : value.pnl < 0
          ? 'is-loss'
          : 'is-flat'
      : 'is-inactive';
    const day = element(doc, 'div', `quant-backtest-calendar-day ${state}`);
    day.setAttribute('role', 'gridcell');
    day.dataset.date = date;
    const dateElement = element(doc, 'time');
    dateElement.dateTime = date;
    dateElement.textContent = String(dayNumber);
    day.appendChild(dateElement);
    if (value) {
      day.appendChild(renderDayDetails(doc, value, currency));
      day.setAttribute(
        'aria-label',
        `${date}: ${formatBacktestTradeMetric(value.pnl, currency, true)}, ${value.tradeCount} trade${value.tradeCount === 1 ? '' : 's'}, ${value.winRate.toFixed(0)}% win`,
      );
    } else {
      day.setAttribute('aria-label', `${date}: No closed trades`);
    }
    appendWeekCell(day);
  }
  if (weekCellCount > 0) grid.appendChild(weekRow);
  container.appendChild(grid);

  if (summary.days.length === 0) {
    const empty = element(doc, 'p', 'quant-backtest-calendar-empty');
    empty.setAttribute('role', 'status');
    empty.setAttribute('aria-live', 'polite');
    empty.textContent = 'No closed trades in this month.';
    container.appendChild(empty);
  }

  const summaryElement = element(doc, 'div', 'quant-backtest-calendar-summary');
  const net = summaryItem(doc, 'Month Net P&L');
  net.dataset.calendarSummary = 'net-pnl';
  net.appendChild(money(doc, summary.netPnl, currency, 'quant-backtest-calendar-summary-money'));
  const best = summaryItem(doc, 'Best Day');
  best.dataset.calendarSummary = 'best-day';
  appendDaySummary(doc, best, summary.bestDay, currency);
  const worst = summaryItem(doc, 'Worst Day');
  worst.dataset.calendarSummary = 'worst-day';
  appendDaySummary(doc, worst, summary.worstDay, currency);
  const average = summaryItem(doc, 'Avg Trades per Day');
  average.dataset.calendarSummary = 'average-trades';
  const averageValue = element(doc, 'span', 'quant-backtest-calendar-summary-average');
  averageValue.textContent = formatBacktestTradeMetric(summary.averageTradesPerDay);
  average.appendChild(averageValue);
  summaryElement.append(net, best, worst, average);
  container.appendChild(summaryElement);
  return container;
}
