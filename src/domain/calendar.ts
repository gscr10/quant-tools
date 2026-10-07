import { normalizeExitTime } from './backtesting.ts';

const CALENDAR_FORMATTERS = new Map<string, Intl.DateTimeFormat>();
const NORMALIZED_TIMEZONES = new Map<string, string>();

/**
 * Return an IANA timezone that can safely be passed to Intl.  Adapter data
 * may contain an empty/unknown display timezone (or a stale value after a
 * workspace restore); callers should not let that turn a report render into
 * a RangeError.  Keep the original spelling for valid zones because aliases
 * such as `Etc/UTC` are useful in diagnostics and have identical bucket
 * semantics.
 */
export function normalizeCalendarTimezone(timezone: string | null | undefined): string {
  const candidate = typeof timezone === 'string' ? timezone.trim() : '';
  if (!candidate) return 'UTC';
  const cached = NORMALIZED_TIMEZONES.get(candidate);
  if (cached) return cached;
  try {
    // Constructing the formatter is the only portable way to validate an
    // IANA identifier in all supported browsers.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(0);
    NORMALIZED_TIMEZONES.set(candidate, candidate);
    return candidate;
  } catch {
    NORMALIZED_TIMEZONES.set(candidate, 'UTC');
    return 'UTC';
  }
}

function calendarFormatter(timezone: string): Intl.DateTimeFormat {
  const normalizedTimezone = normalizeCalendarTimezone(timezone);
  const cached = CALENDAR_FORMATTERS.get(normalizedTimezone);
  if (cached) return cached;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: normalizedTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    CALENDAR_FORMATTERS.set(normalizedTimezone, formatter);
    return formatter;
  } catch {
    const fallback = normalizedTimezone === 'UTC'
      ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
      : calendarFormatter('UTC');
    CALENDAR_FORMATTERS.set(normalizedTimezone, fallback);
    return fallback;
  }
}

export interface CalendarDateParts {
  readonly key: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
}

/**
 * Canonical calendar bucket in the requested IANA timezone. Provider string
 * timestamps and open/epoch sentinels follow the same normalization contract
 * as the backtest ledger.
 */
export function calendarDateParts(
  value: Date | number | string,
  timezone = 'UTC',
): CalendarDateParts | null {
  const timestamp = normalizeExitTime(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  // UTC is the default report timezone. Its calendar fields are already
  // available without the allocation-heavy Intl.formatToParts path, which
  // otherwise dominates every 100k-trade Performance/Calendar projection.
  // Named regional zones still use Intl, preserving DST and historic offsets.
  const normalizedTimezone = normalizeCalendarTimezone(timezone);
  if (normalizedTimezone === 'UTC' || normalizedTimezone === 'Etc/UTC'
    || normalizedTimezone === 'Etc/GMT' || normalizedTimezone === 'GMT') {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const day = date.getUTCDate();
    return Object.freeze({
      key: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      year, month, day, weekday: date.getUTCDay(),
    });
  }
  const parts = Object.fromEntries(calendarFormatter(normalizedTimezone)
    .formatToParts(date)
    .map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  if (Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)) {
    const key = `${parts.year}-${parts.month}-${parts.day}`;
    return Object.freeze({
      key,
      year,
      month,
      day,
      weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    });
  }
  return null;
}

/** Stable YYYY-MM-DD bucket in the requested IANA timezone. */
export function calendarDateKey(
  value: Date | number | string,
  timezone = 'UTC',
): string {
  return calendarDateParts(value, timezone)?.key ?? '';
}
