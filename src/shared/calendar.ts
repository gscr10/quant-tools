const ENGLISH_MONTHS = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]);

export interface CalendarMonthLayout {
  readonly year: number;
  readonly month: number;
  readonly daysInMonth: number;
  readonly firstWeekday: number;
}

/** Reference Calendar starts at, and can jump back to, the browser's month. */
export function currentCalendarMonthKey(now: Date | number = Date.now()): string {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.valueOf())) return new Date().toISOString().slice(0, 7);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function isCalendarMonthKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5));
  return month >= 1 && month <= 12;
}

export function calendarMonthLayout(monthKey: string): CalendarMonthLayout {
  if (!isCalendarMonthKey(monthKey)) throw new TypeError(`Invalid calendar month: ${monthKey}`);
  const year = Number(monthKey.slice(0, 4));
  const month = Number(monthKey.slice(5));
  return Object.freeze({
    year,
    month,
    daysInMonth: new Date(Date.UTC(year, month, 0)).getUTCDate(),
    firstWeekday: new Date(Date.UTC(year, month - 1, 1)).getUTCDay(),
  });
}

export function shiftCalendarMonth(monthKey: string, offset: number): string {
  const { year, month } = calendarMonthLayout(monthKey);
  const value = new Date(Date.UTC(year, month - 1 + Math.trunc(offset), 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The reference heading is deliberately English rather than locale-derived. */
export function formatCalendarMonthLabel(monthKey: string): string {
  const { year, month } = calendarMonthLayout(monthKey);
  return `${ENGLISH_MONTHS[month - 1]} ${year}`;
}

/** Best/worst-day labels follow browser locale while preserving the day key. */
export function formatCalendarDayLabel(
  dateKey: string,
  locale?: string | readonly string[],
): string {
  const parsed = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(dateKey);
  if (!parsed) return dateKey;
  const value = new Date(Date.UTC(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    month: 'short',
    day: '2-digit',
  }).format(value);
}
