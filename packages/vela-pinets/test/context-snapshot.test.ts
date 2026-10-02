// The neutral engine-context snapshot (src/pinets/contextSnapshot.ts):
// serializable extraction, source-named variables, the neutral strategy translation,
// live-reference stripping, and the select filter.
import { describe, it, expect } from 'vitest';
import { snapshotFromCtx } from '../src/pinets/contextSnapshot';
import { executionProvenance, PINE_EXECUTION_BUILD_INFO } from '../src/build-info';
import { pineContextSelect, stampReportIdentity } from '../src/pinets/reportSeries';

/** A PineTS series variable: one entry per bar, the last one being the current value. */
const series = (...data: unknown[]): { data: unknown[]; offset: number } => ({ data, offset: 0 });

const ctx = {
    idx: 41,
    indicator: { title: 'My Ind', overlay: true, precision: 2 },
    plots: { ema: { title: 'EMA', options: {}, data: [{ time: 1, value: 10 }, { time: 2, value: 11 }] } },
    // The transpiler's positional slots — never anything the script named.
    params: { p3: series(14, 14) },
    var: { glb1_acc: series(1, 2, 3.5), _hidden: series(1), fn: () => 0 },
    let: { glb1_note: series('a', 'hi'), glb2_plain: 7 },
    warnings: [{ message: 'w1', bar: 5 }],
};

const strategyCtx = {
    ...ctx,
    strategy: {
        position_size: 2,
        position_avg_price: 100.5,
        equity: 10_500,
        openprofit: 250,
        netprofit: 500,
        grossprofit: 700,
        grossloss: 200,
        wintrades: 3,
        losstrades: 1,
        eventrades: 0,
        max_drawdown: 80,
        max_runup: 300,
        initial_capital: 10_000,
        account_currency: 'EUR',
        max_contracts_held_all: 5,
        max_contracts_held_long: 5,
        max_contracts_held_short: 2,
        cagr: 12.5,
        sharpe_ratio: 1.2,
        sortino_ratio: 1.8,
        max_drawdown_percent_value: 4.5,
        max_runup_percent_value: 8.25,
        buy_and_hold_pnl: 900,
        buy_and_hold_per_gain: 9,
        strategy_outperformance: -400,
        closedtrades: [
            {
                id: 't1', entry_id: 'Long', entry_price: 100, entry_bar_index: 7, entry_time: 1, exit_id: 'Exit', exit_price: 110, exit_bar_index: 9, exit_time: 2, exit_comment: 'take', size: 2, status: 'closed',
                profit: 19.5, commission: 0.5, max_drawdown: 3.25, max_runup: 22,
            },
        ],
        opentrades: [{ id: 't2', entry_id: 'Short', entry_price: 120, entry_bar_index: 11, entry_time: 3, size: -1, status: 'open' }],
    },
};

const REPORT_POINTS = [
    {
        barIndex: 0,
        time: 1_000,
        closeTime: 1_999,
        equity: 10_000,
        realizedPnl: 0,
        openPnl: 0,
        underwater: 0,
        underwaterPercent: 0,
        maxDrawdown: 4,
        maxDrawdownPercent: 0.04,
        benchmarkEquity: null,
        benchmarkPnl: null,
        benchmarkReturnPercent: null,
    },
    {
        barIndex: 1,
        time: 2_000,
        equity: 10_125,
        realizedPnl: 25,
        openPnl: 100,
        underwater: 0,
        underwaterPercent: 0,
        maxDrawdown: 20,
        maxDrawdownPercent: 0.2,
        benchmarkEquity: 10_100,
        benchmarkPnl: 100,
        benchmarkReturnPercent: 1,
    },
] as const;

function reportCtx(runId = 'run-1', revision = 7) {
    const value = {
        ...strategyCtx,
        strategy: {
            ...strategyCtx.strategy,
            _report_series: REPORT_POINTS.map((point) => ({ ...point })),
        },
    };
    stampReportIdentity(value, runId, revision);
    return value;
}

type AuditFixtureContext = {
    strategy: {
        _ledger_sequence?: number;
        _order_events?: Array<Record<string, unknown>>;
        _fill_events?: Array<Record<string, unknown>>;
    };
};

describe('snapshotFromCtx', () => {
    it('extracts the neutral envelope; functions and _private vars are dropped', () => {
        const s = snapshotFromCtx(ctx, 'idle');
        expect(s).toMatchObject({ language: 'pine', phase: 'idle', barIndex: 41 });
        expect(s.meta).toMatchObject({ title: 'My Ind', overlay: true, precision: 2 });
        expect(s.plots.ema).toEqual([{ time: 1, value: 10 }, { time: 2, value: 11 }]);
        expect(s.warnings).toEqual([{ message: 'w1', method: undefined, bar: 5 }]);
    });

    it('variables use SOURCE names and carry the value at the current bar', () => {
        const s = snapshotFromCtx(ctx, 'idle');
        // The `glb<n>_` scope mangle is the transpiler's business — it must not reach a host,
        // and a series collapses to its last entry rather than a per-bar buffer.
        expect(s.variables).toEqual({ acc: 3.5, note: 'hi', plain: 7 });
    });

    it('the transpiler positional slots stay out of variables', () => {
        // `params.p3` is the literal `14` in `ta.sma(close, 14)`, not something the script named.
        expect(Object.keys(snapshotFromCtx(ctx, 'idle').variables)).not.toContain('p3');
    });

    it('an indicator reports no strategy — its absence is what tags the run', () => {
        const s = snapshotFromCtx(ctx, 'idle');
        expect(s.strategy).toBeUndefined();
        expect(s.trades).toBeUndefined();
    });

    it('translates the broker ledger into the neutral vocabulary', () => {
        const s = snapshotFromCtx(strategyCtx, 'streaming');
        expect(s.strategy).toEqual({
            position: 2,
            avgPrice: 100.5,
            equity: 10_500,
            openPnl: 250,
            netPnl: 500,
            grossProfit: 700,
            grossLoss: 200,
            wins: 3,
            losses: 1,
            even: 0,
            maxDrawdown: 80,
            maxRunup: 300,
            initialCapital: 10_000,
            accountCurrency: 'EUR',
            maxContractsHeldAll: 5,
            maxContractsHeldLong: 5,
            maxContractsHeldShort: 2,
            cagr: 12.5,
            sharpe: 1.2,
            sortino: 1.8,
            maxDrawdownPercent: 4.5,
            maxRunupPercent: 8.25,
            buyAndHoldPnl: 900,
            buyAndHoldPercent: 9,
            strategyOutperformance: -400,
        });
    });

    it('trades become round trips: a signed size splits into side + magnitude', () => {
        const s = snapshotFromCtx(strategyCtx, 'streaming');
        expect(s.trades).toEqual([
            {
                id: 't1', side: 'long', qty: 2, entry: { id: 'Long', time: 1, price: 100 }, entryBarIndex: 7, exit: { id: 'Exit', time: 2, price: 110, comment: 'take' }, exitBarIndex: 9, open: false,
                // Pine's per-trade ledger under Vela's names: profit → pnl, max_drawdown/max_runup → maxDrawdown/maxRunup.
                pnl: 19.5, commission: 0.5, maxDrawdown: 3.25, maxRunup: 22,
            },
            // The open trade set none of them — they stay absent, never zeroed.
            { id: 't2', side: 'short', qty: 1, entry: { id: 'Short', time: 3, price: 120 }, entryBarIndex: 11, open: true },
        ]);
    });

    it('a non-finite ledger value is dropped rather than forwarded', () => {
        const ctxNaN = { ...strategyCtx, strategy: { ...strategyCtx.strategy, opentrades: [{ ...strategyCtx.strategy.opentrades[0], profit: NaN, max_drawdown: 1.5 }] } };
        const open = snapshotFromCtx(ctxNaN, 'streaming').trades!.find((t) => t.id === 't2')!;
        expect(open.pnl).toBeUndefined();
        expect(open.maxDrawdown).toBe(1.5);
    });

    it('snapshots are copies — mutating them never touches the source', () => {
        const nested = { ...ctx, var: { glb1_acc: series({ levels: [1, 2, 3] }) } };
        const s = snapshotFromCtx(nested, 'streaming');
        (s.variables.acc as { levels: number[] }).levels.push(99);
        expect((nested.var.glb1_acc.data[0] as { levels: number[] }).levels).toEqual([1, 2, 3]);
    });

    it('select limits extraction to the requested keys', () => {
        const s = snapshotFromCtx(strategyCtx, 'idle', ['strategy', 'barIndex']);
        expect(s.strategy).toBeDefined();
        expect(s.variables).toEqual({});
        expect(s.plots).toEqual({});
        expect(s.trades).toBeUndefined(); // the ledger is opt-in — it never rides an ordinary pull
        expect(s.meta.title).toBe(''); // meta not selected
    });

    it('prefers fullContext when present (streamed pages)', () => {
        const s = snapshotFromCtx({ fullContext: strategyCtx }, 'streaming');
        expect(s.barIndex).toBe(41);
        expect(s.strategy?.equity).toBe(10_500);
    });

    it('attaches execution provenance without polluting variables or strategy data', () => {
        const provenance = executionProvenance('worker');
        const s = snapshotFromCtx(strategyCtx, 'idle', undefined, provenance);
        expect(s.provenance).toEqual(provenance);
        expect(s.provenance?.buildFingerprint).toBe(PINE_EXECUTION_BUILD_INFO.buildFingerprint);
        expect(s.provenance?.workerFingerprint).toContain('execution=worker');
        expect(s.variables).toEqual({ acc: 3.5, note: 'hi', plain: 7 });
        expect(s.strategy?.netPnl).toBe(500);
    });

    it('keeps report history opt-in while summary carries only O(1) identity and count', () => {
        const source = reportCtx();
        const ordinary = snapshotFromCtx(source, 'idle');
        expect(ordinary.reportSeries).toBeUndefined();
        expect(ordinary.reportTail).toBeUndefined();
        expect(ordinary.strategy).toMatchObject({
            reportRunId: 'run-1',
            reportSnapshotRevision: 7,
            reportPointCount: 2,
        });
        expect(ordinary.strategy).not.toHaveProperty('_report_series');

        const summary = snapshotFromCtx(source, 'idle', ['strategy']);
        expect(summary.reportSeries).toBeUndefined();
        expect(summary.reportTail).toBeUndefined();
        expect(summary.strategy).toMatchObject({ reportRunId: 'run-1', reportSnapshotRevision: 7, reportPointCount: 2 });
    });

    it('returns full reportSeries and one-point reportTail only when explicitly selected', () => {
        const source = reportCtx();
        const full = snapshotFromCtx(source, 'idle', pineContextSelect('reportSeries'));
        expect(full.reportSeries).toEqual({
            schemaVersion: 1,
            runId: 'run-1',
            snapshotRevision: 7,
            barIndex: 41,
            points: REPORT_POINTS,
        });
        expect(full.reportTail).toBeUndefined();
        expect(full.strategy).toBeUndefined();

        const tail = snapshotFromCtx(source, 'streaming', pineContextSelect('reportTail'));
        expect(tail.reportTail).toEqual({
            schemaVersion: 1,
            runId: 'run-1',
            snapshotRevision: 7,
            barIndex: 41,
            points: [REPORT_POINTS[1]],
        });
        expect(tail.reportSeries).toBeUndefined();
    });

    it('report snapshots are plain structured-clone-safe copies with stable old identities', () => {
        const source = reportCtx('old-run', 3);
        const oldSnapshot = snapshotFromCtx(source, 'idle', pineContextSelect('strategy', 'reportSeries'));
        const cloned = structuredClone(oldSnapshot);
        expect(cloned.reportSeries).toEqual(oldSnapshot.reportSeries);

        // A newer engine evaluation stamps the live source, but an already returned
        // snapshot remains an immutable-by-ownership view of the old evaluation.
        stampReportIdentity(source, 'new-run', 1);
        const newer = snapshotFromCtx(source, 'idle', pineContextSelect('strategy', 'reportSeries'));
        expect(oldSnapshot.reportSeries?.runId).toBe('old-run');
        expect(oldSnapshot.reportSeries?.snapshotRevision).toBe(3);
        expect(newer.reportSeries?.runId).toBe('new-run');
        expect(newer.reportSeries?.snapshotRevision).toBe(1);

        const returnedPoint = oldSnapshot.reportSeries!.points[0] as { equity: number };
        returnedPoint.equity = -1;
        expect(source.strategy._report_series[0]!.equity).toBe(10_000);
    });

    it('keeps the internal audit ledger opt-in, validated, and immutable', () => {
        const source = reportCtx('ledger-run', 9) as unknown as AuditFixtureContext;
        source.strategy._ledger_sequence = 4;
        source.strategy._order_events = [
            {
                eventId: 'event_1',
                orderId: 'order_1',
                sourceOrderId: 'L',
                kind: 'created',
                barIndex: 0,
                time: 1,
                direction: 1,
                qty: 1,
                orderType: 'market',
                category: 'entry',
            },
            {
                eventId: 'event_2',
                orderId: 'order_1',
                sourceOrderId: 'L',
                kind: 'filled',
                barIndex: 1,
                time: 2,
                direction: 1,
                qty: 1,
                orderType: 'market',
                category: 'entry',
                fillPrice: 101,
                fillQty: 1,
                tradeIds: ['trade_1'],
                parentOrderIds: ['order_parent'],
                reversalOfOrderId: 'order_old',
                reversalOfTradeIds: ['trade_old'],
                requestedQty: 2,
                cumulativeFillQty: 1,
                remainingQty: 1,
                fillSequence: 1,
                isPartial: true,
            },
        ];
        source.strategy._fill_events = [{
            fillId: 'fill_1',
            orderId: 'order_1',
            sourceOrderId: 'L',
            barIndex: 1,
            time: 2,
            direction: 1,
            qty: 1,
            price: 101,
            orderType: 'market',
            category: 'entry',
            tradeIds: ['trade_1'],
            parentOrderIds: ['order_parent'],
            reversalOfOrderId: 'order_old',
            reversalOfTradeIds: ['trade_old'],
            requestedQty: 2,
            cumulativeQty: 1,
            remainingQty: 1,
            fillSequence: 1,
            isPartial: true,
        }];

        const ordinary = snapshotFromCtx(source, 'idle', pineContextSelect('strategy'));
        expect(ordinary).not.toHaveProperty('auditLedger');

        const audit = snapshotFromCtx(source, 'idle', pineContextSelect('auditLedger'));
        expect(audit.auditLedger).toEqual({
            schemaVersion: 1,
            runId: 'ledger-run',
            snapshotRevision: 9,
            barIndex: 41,
            sequence: 4,
            orderEvents: source.strategy._order_events,
            fillEvents: source.strategy._fill_events,
        });
        expect(Object.isFrozen(audit.auditLedger)).toBe(true);
        expect(Object.isFrozen(audit.auditLedger!.orderEvents[0])).toBe(true);
        expect(Object.isFrozen(audit.auditLedger!.fillEvents[0]!.tradeIds)).toBe(true);
        expect(audit.auditLedger!.orderEvents).not.toBe(source.strategy._order_events);
        expect(audit.auditLedger!.fillEvents[0]!.tradeIds).not.toBe(source.strategy._fill_events[0]!.tradeIds);
        expect(audit.auditLedger!.orderEvents[1]).toMatchObject({
            parentOrderIds: ['order_parent'],
            reversalOfOrderId: 'order_old',
            reversalOfTradeIds: ['trade_old'],
            requestedQty: 2,
            cumulativeFillQty: 1,
            remainingQty: 1,
            fillSequence: 1,
            isPartial: true,
        });
        expect(audit.auditLedger!.fillEvents[0]).toMatchObject({
            parentOrderIds: ['order_parent'],
            reversalOfOrderId: 'order_old',
            reversalOfTradeIds: ['trade_old'],
            requestedQty: 2,
            cumulativeQty: 1,
            remainingQty: 1,
            fillSequence: 1,
            isPartial: true,
        });
        expect(Object.isFrozen(audit.auditLedger!.orderEvents[1]!.parentOrderIds)).toBe(true);
        expect(Object.isFrozen(audit.auditLedger!.fillEvents[0]!.reversalOfTradeIds)).toBe(true);
    });

    it('drops the whole audit envelope when one lifecycle row is malformed', () => {
        const source = reportCtx('bad-ledger', 1) as unknown as AuditFixtureContext;
        source.strategy._ledger_sequence = 1;
        source.strategy._order_events = [{
            eventId: 'event_1', orderId: 'order_1', kind: 'unknown', barIndex: 0,
            time: 1, direction: 1, qty: 1, orderType: 'market',
        }];
        source.strategy._fill_events = [];
        expect(snapshotFromCtx(source, 'idle', pineContextSelect('auditLedger')).auditLedger).toBeUndefined();
    });
});
