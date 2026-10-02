import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calendarMonthLayout,
  currentCalendarMonthKey,
  formatCalendarDayLabel,
  formatCalendarMonthLabel,
  isCalendarMonthKey,
  shiftCalendarMonth,
} from '../src/shared/calendar.ts';
import {
  calendarDateKey,
  normalizeCalendarTimezone,
} from '../src/domain/calendar.ts';
import {
  aggregateBacktestTradeCalendar,
  shouldResetBacktestTradeCalendar,
  summarizeBacktestTradeCalendarMonth,
} from '../src/features/backtesting/trade-calendar.ts';

test('Trades Calendar preserves live revisions but resets for a new run', () => {
  const firstRevision = {
    key: { cellId: 'cell-1', indicatorId: 'strategy-1' },
    runId: 'run-1',
    revision: 1,
  };
  assert.equal(shouldResetBacktestTradeCalendar(null, firstRevision), true);
  assert.equal(shouldResetBacktestTradeCalendar(firstRevision, {
    ...firstRevision,
    revision: 2,
  }), false);
  assert.equal(shouldResetBacktestTradeCalendar(firstRevision, {
    ...firstRevision,
    runId: 'run-2',
    revision: 1,
  }), true);
  assert.equal(shouldResetBacktestTradeCalendar(firstRevision, {
    ...firstRevision,
    key: { cellId: 'cell-2', indicatorId: 'strategy-1' },
  }), true);
  assert.equal(shouldResetBacktestTradeCalendar(firstRevision, null), true);
});

test('calendar primitives retain timezone buckets and stable month navigation', () => {
  const instant = Date.parse('2026-09-01T00:30:00.000Z');
  assert.equal(calendarDateKey(instant, 'UTC'), '2026-09-01');
  assert.equal(calendarDateKey(instant, 'America/Los_Angeles'), '2026-08-31');
  assert.equal(calendarDateKey(instant, 'invalid/timezone'), '2026-09-01');
  assert.equal(calendarDateKey(String(instant), 'UTC'), '2026-09-01');
  assert.equal(calendarDateKey(0, 'UTC'), '');
  assert.equal(calendarDateKey('0', 'UTC'), '');
  assert.equal(calendarDateKey('1970-01-01T00:00:00.000Z', 'UTC'), '');
  assert.equal(calendarDateKey(Number.MAX_VALUE, 'UTC'), '');
  assert.equal(calendarDateKey(Date.parse('2026-03-08T09:30:00.000Z'), 'America/Los_Angeles'), '2026-03-08');
  assert.equal(calendarDateKey(Date.parse('2026-03-08T10:30:00.000Z'), 'America/Los_Angeles'), '2026-03-08');
  assert.equal(calendarDateKey(Date.parse('2026-08-31T16:30:00.000Z'), 'Asia/Tokyo'), '2026-09-01');
  assert.equal(currentCalendarMonthKey(new Date(2026, 8, 26, 12)), '2026-09');
  assert.equal(isCalendarMonthKey('2026-09'), true);
  assert.equal(isCalendarMonthKey('2026-13'), false);
  assert.deepEqual(calendarMonthLayout('2026-09'), {
    year: 2026,
    month: 9,
    daysInMonth: 30,
    firstWeekday: 2,
  });
  assert.equal(shiftCalendarMonth('2026-01', -1), '2025-12');
  assert.equal(shiftCalendarMonth('2026-12', 1), '2027-01');
  assert.equal(formatCalendarMonthLabel('2026-09'), 'September 2026');
  assert.equal(formatCalendarDayLabel('2026-09-17', 'en-US'), 'Sep 17');
  assert.equal(calendarMonthLayout('2028-02').daysInMonth, 29);
});

test('calendar timezone normalization is deterministic at invalid and DST boundaries', () => {
  assert.equal(normalizeCalendarTimezone(undefined), 'UTC');
  assert.equal(normalizeCalendarTimezone(''), 'UTC');
  assert.equal(normalizeCalendarTimezone('invalid/timezone'), 'UTC');
  assert.equal(normalizeCalendarTimezone('America/Los_Angeles'), 'America/Los_Angeles');

  // The two instants straddle the US spring-forward boundary. Both remain in
  // the same local trading date, while an invalid adapter timezone safely
  // falls back to UTC instead of throwing during Calendar rendering.
  assert.equal(
    calendarDateKey(Date.parse('2026-03-08T09:30:00.000Z'), 'America/Los_Angeles'),
    '2026-03-08',
  );
  assert.equal(
    calendarDateKey(Date.parse('2026-03-08T10:30:00.000Z'), 'America/Los_Angeles'),
    '2026-03-08',
  );
  assert.equal(
    calendarDateKey(Date.parse('2026-03-08T10:30:00.000Z'), 'invalid/timezone'),
    '2026-03-08',
  );
});

test('Trades Calendar excludes open rows and summarizes realized trading days', () => {
  const trades = [
    {
      id: 'winner',
      status: 'closed',
      exitTime: Date.parse('2026-09-01T00:30:00.000Z'),
      netPnl: 100,
    },
    {
      id: 'loser-same-day',
      status: 'closed',
      exitTime: Date.parse('2026-09-01T05:30:00.000Z'),
      netPnl: -40,
    },
    {
      id: 'loser-prior-day',
      status: 'closed',
      exitTime: Date.parse('2026-08-30T20:00:00.000Z'),
      netPnl: -20,
    },
    {
      id: 'open-sentinel',
      status: 'open',
      exitTime: null,
      netPnl: 999,
    },
    {
      id: 'malformed-exit',
      status: 'closed',
      exitTime: 'N/A',
      netPnl: 999,
    },
    {
      id: 'closed-epoch-number',
      status: 'closed',
      exitTime: 0,
      netPnl: 999,
    },
    {
      id: 'closed-epoch-string',
      status: 'closed',
      exitTime: '1970-01-01T00:00:00.000Z',
      netPnl: 999,
    },
  ];

  const days = aggregateBacktestTradeCalendar(trades, 'America/Los_Angeles');
  assert.deepEqual([...days.keys()], ['2026-08-30', '2026-08-31']);
  assert.deepEqual(days.get('2026-08-31'), {
    date: '2026-08-31',
    pnl: 60,
    tradeCount: 2,
    winningTrades: 1,
    winRate: 50,
  });
  const august = summarizeBacktestTradeCalendarMonth(days, '2026-08');
  assert.equal(august.netPnl, 40);
  assert.equal(august.bestDay?.date, '2026-08-31');
  assert.equal(august.worstDay?.date, '2026-08-30');
  assert.equal(august.averageTradesPerDay, 1.5);

  const september = summarizeBacktestTradeCalendarMonth(days, '2026-09');
  assert.equal(september.netPnl, 0);
  assert.equal(september.bestDay, null);
  assert.equal(september.worstDay, null);
  assert.equal(september.averageTradesPerDay, 0);
});

test('Trades Calendar skips unknown P&L and keeps real zero/tie days deterministic', () => {
  const trades = [
    { id: 'unknown', status: 'closed', exitTime: '2026-09-01T01:00:00Z', netPnl: null },
    { id: 'not-finite', status: 'closed', exitTime: '2026-09-01T02:00:00Z', netPnl: Number.NaN },
    { id: 'flat', status: 'closed', exitTime: '2026-09-02T01:00:00Z', netPnl: 0 },
    { id: 'tie-a', status: 'closed', exitTime: '2026-09-03T01:00:00Z', netPnl: 10 },
    { id: 'tie-b', status: 'closed', exitTime: '2026-09-04T01:00:00Z', netPnl: 10 },
  ];

  const days = aggregateBacktestTradeCalendar(trades, 'UTC');
  assert.deepEqual([...days.keys()], ['2026-09-02', '2026-09-03', '2026-09-04']);
  assert.equal(days.get('2026-09-02')?.tradeCount, 1);
  assert.equal(days.get('2026-09-02')?.winRate, 0);
  const summary = summarizeBacktestTradeCalendarMonth(days, '2026-09');
  assert.equal(summary.netPnl, 20);
  assert.equal(summary.bestDay?.date, '2026-09-03');
  assert.equal(summary.worstDay?.date, '2026-09-02');
  assert.equal(summary.averageTradesPerDay, 1);
});
