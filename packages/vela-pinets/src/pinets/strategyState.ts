// PineTS's broker ledger → Vela's NEUTRAL strategy vocabulary. Same narrow-contract
// philosophy as PineRun.ts: read the few fields we promise, translate the names, and let
// PineTS reshape everything else without this package noticing.
//
// The translation is the point. `EngineContextSnapshot.strategy` is a Vela contract, not a
// Pine one, so a dashboard written against it reads a strategy from ANY engine — which is
// exactly why the Pine spellings (`netprofit`, `wintrades`, `position_avg_price`) stop here.
import type { StrategyState, StrategyTrade } from '@luxalgo/vela/plugin';
import { asString, asNumber } from './PineRun';
import type { PineReportIdentity } from './reportSeries';

/**
 * Report-only fields produced by the local PineTS broker at the end of a
 * settled run.  They are optional on purpose: the public Vela contract only
 * guarantees the portable account summary above, while older/third-party
 * engines may not publish these fields.  Keeping the extension at this
 * translation seam lets the host feature capability-gate each value without
 * widening Vela's registry package or pretending every engine supports it.
 */
export interface StrategyReportState extends StrategyState {
    /** Account currency selected by the strategy declaration. */
    accountCurrency?: string;
    /** Peak absolute/long/short position sizes observed by the broker. */
    maxContractsHeldAll?: number;
    maxContractsHeldLong?: number;
    maxContractsHeldShort?: number;
    /** PineTS stores CAGR in percentage points (e.g. 12.5 = 12.5%). */
    cagr?: number;
    sharpe?: number;
    sortino?: number;
    maxDrawdownPercent?: number;
    maxRunupPercent?: number;
    buyAndHoldPnl?: number;
    /** Percentage points, matching PineTS `buy_and_hold_per_gain`. */
    buyAndHoldPercent?: number;
    strategyOutperformance?: number;
    /** Identity of the engine evaluation that produced this bounded summary. */
    reportRunId?: string;
    reportSnapshotRevision?: number;
    /** O(1) length only. Full report history is explicitly selected separately. */
    reportPointCount?: number;
}

/** The slice of PineTS's `ctx.strategy` this folder reads. */
interface RawStrategy {
    position_size?: unknown;
    position_avg_price?: unknown;
    equity?: unknown;
    openprofit?: unknown;
    netprofit?: unknown;
    grossprofit?: unknown;
    grossloss?: unknown;
    wintrades?: unknown;
    losstrades?: unknown;
    eventrades?: unknown;
    max_drawdown?: unknown;
    max_runup?: unknown;
    max_drawdown_percent_value?: unknown;
    max_runup_percent_value?: unknown;
    initial_capital?: unknown;
    account_currency?: unknown;
    max_contracts_held_all?: unknown;
    max_contracts_held_long?: unknown;
    max_contracts_held_short?: unknown;
    cagr?: unknown;
    sharpe_ratio?: unknown;
    sortino_ratio?: unknown;
    buy_and_hold_pnl?: unknown;
    buy_and_hold_per_gain?: unknown;
    strategy_outperformance?: unknown;
    _report_series?: unknown;
    opentrades?: unknown[];
    closedtrades?: unknown[];
}

const num = (v: unknown): number => asNumber(v) ?? 0;

/** The broker summary at the last computed bar. Null when the script declared no strategy. */
export function toStrategyState(raw: unknown, reportIdentity?: PineReportIdentity): StrategyReportState | undefined {
    if (raw == null || typeof raw !== 'object') return undefined;
    const s = raw as RawStrategy;
    const state: StrategyReportState = {
        position: num(s.position_size),
        avgPrice: num(s.position_avg_price),
        equity: num(s.equity),
        openPnl: num(s.openprofit),
        netPnl: num(s.netprofit),
        grossProfit: num(s.grossprofit),
        grossLoss: num(s.grossloss),
        wins: num(s.wintrades),
        losses: num(s.losstrades),
        even: num(s.eventrades),
        maxDrawdown: num(s.max_drawdown),
        maxRunup: num(s.max_runup),
        initialCapital: num(s.initial_capital),
    };
    const accountCurrency = asString(s.account_currency);
    if (accountCurrency !== undefined) state.accountCurrency = accountCurrency;
    const positionPeaks: Array<[
        'maxContractsHeldAll' | 'maxContractsHeldLong' | 'maxContractsHeldShort',
        unknown,
    ]> = [
        ['maxContractsHeldAll', s.max_contracts_held_all],
        ['maxContractsHeldLong', s.max_contracts_held_long],
        ['maxContractsHeldShort', s.max_contracts_held_short],
    ];
    for (const [key, value] of positionPeaks) {
        const numeric = asNumber(value);
        if (numeric !== undefined) state[key] = numeric;
    }
    type NumericReportKey =
        | 'cagr'
        | 'sharpe'
        | 'sortino'
        | 'maxDrawdownPercent'
        | 'maxRunupPercent'
        | 'buyAndHoldPnl'
        | 'buyAndHoldPercent'
        | 'strategyOutperformance';
    const reportValues: Array<[NumericReportKey, unknown]> = [
        ['cagr', s.cagr],
        ['sharpe', s.sharpe_ratio],
        ['sortino', s.sortino_ratio],
        ['maxDrawdownPercent', s.max_drawdown_percent_value],
        ['maxRunupPercent', s.max_runup_percent_value],
        ['buyAndHoldPnl', s.buy_and_hold_pnl],
        ['buyAndHoldPercent', s.buy_and_hold_per_gain],
        ['strategyOutperformance', s.strategy_outperformance],
    ];
    for (const [key, value] of reportValues) {
        const numeric = asNumber(value);
        if (numeric !== undefined) state[key] = numeric;
    }
    if (reportIdentity) {
        state.reportRunId = reportIdentity.runId;
        state.reportSnapshotRevision = reportIdentity.snapshotRevision;
        state.reportPointCount = Array.isArray(s._report_series) ? s._report_series.length : 0;
    }
    return state;
}

/** Spread an optional numeric field only when the ledger actually carries a finite value. */
const optNum = <K extends string>(key: K, v: unknown): { [P in K]?: number } => {
    const n = asNumber(v);
    return n === undefined ? {} : ({ [key]: n } as { [P in K]: number });
};

/**
 * The ledger as round trips, closed first then open — the order PineTS keeps. `size` is
 * SIGNED there and carries the direction; Vela splits that into `side` + a magnitude, so
 * host code never has to know the sign convention. Malformed entries are dropped.
 *
 * The per-trade ledger rides along under Vela's names: `profit` → `pnl`, `commission`,
 * and Pine's `max_drawdown` / `max_runup` (the trade's adverse / favorable excursion,
 * commission-adjusted the way PineTS latches them) → `maxDrawdown` / `maxRunup`. Each is
 * omitted rather than zeroed when PineTS has not set it (an open trade has no `profit`).
 */
export function toStrategyTrades(raw: unknown): StrategyTrade[] {
    if (raw == null || typeof raw !== 'object') return [];
    const s = raw as RawStrategy;
    const out: StrategyTrade[] = [];
    for (const entry of [...(Array.isArray(s.closedtrades) ? s.closedtrades : []), ...(Array.isArray(s.opentrades) ? s.opentrades : [])]) {
        const t = (entry ?? {}) as Record<string, unknown>;
        const entryPrice = asNumber(t.entry_price);
        const entryTime = asNumber(t.entry_time);
        const size = asNumber(t.size);
        if (entryPrice === undefined || entryTime === undefined || size === undefined || size === 0) continue;
        const exitPrice = asNumber(t.exit_price);
        const exitTime = asNumber(t.exit_time);
        out.push({
            id: asString(t.id) ?? `trade_${out.length}`,
            side: size > 0 ? 'long' : 'short',
            qty: Math.abs(size),
            entry: {
                id: asString(t.entry_id) ?? '',
                time: entryTime,
                price: entryPrice,
                ...(asString(t.entry_comment) !== undefined ? { comment: asString(t.entry_comment)! } : {}),
            },
            ...optNum('entryBarIndex', t.entry_bar_index),
            ...(exitPrice !== undefined && exitTime !== undefined
                ? {
                      exit: {
                          id: asString(t.exit_id) ?? '',
                          time: exitTime,
                          price: exitPrice,
                          ...(asString(t.exit_comment) !== undefined ? { comment: asString(t.exit_comment)! } : {}),
                      },
                  }
                : {}),
            open: t.status !== 'closed',
            ...optNum('pnl', t.profit),
            ...optNum('commission', t.commission),
            ...optNum('maxDrawdown', t.max_drawdown),
            ...optNum('maxRunup', t.max_runup),
            ...optNum('exitBarIndex', t.exit_bar_index),
        });
    }
    return out;
}
