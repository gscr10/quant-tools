/** Pure aggregation, population, formatting, and simulation functions. */

import {
  type BacktestReport,
  type BacktestBar,
  type BacktestMetric,
  type MetricSource,
  type MetricUnit,
  type MetricUnavailableReason,
  type BenchmarkPoint,
  type EquityPoint,
  type NormalizedTrade,
  type SimulationConfig,
  type SimulationPath,
  type SimulationResult,
  type Trade,
  type TradePopulations,
  isTradeOpen,
  selectTradePopulations,
  tradeDirection,
  tradeNetPnl,
  tradeUnrealizedPnl,
} from './backtesting.ts';
import { calendarDateParts } from './calendar.ts';
export { calendarDateKey } from './calendar.ts';

export type { BacktestMetric, MetricSource, MetricUnit, MetricUnavailableReason } from './backtesting.ts';

export function metric(
  value: number | null,
  unit: MetricUnit,
  source: MetricSource = 'derived',
  unavailableReason?: MetricUnavailableReason,
): BacktestMetric {
  const numeric = value === null || Number.isFinite(value) || value === Infinity || value === -Infinity ? value : null;
  const normalized = numeric !== null && Object.is(numeric, -0) ? 0 : numeric;
  return normalized === null && unavailableReason
    ? { value: null, unit, source, unavailableReason }
    : { value: normalized, unit, source };
}

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function finite(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? (Object.is(parsed, -0) ? 0 : parsed) : null;
  }
  return null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function valuesForTrades(trades: readonly Trade[]): number[] {
  return trades.map(tradeNetPnl).filter((value): value is number => value !== null && Number.isFinite(value));
}

function openPnlForTrades(trades: readonly Trade[]): number {
  return sum(
    trades
      .map(tradeUnrealizedPnl)
      .filter((value): value is number => value !== null && Number.isFinite(value)),
  );
}

export interface TradeKpis {
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly breakevenTrades: number;
  readonly winRate: number | null;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly realizedNet: number;
  readonly unrealizedNet: number;
  readonly markToMarketNet: number;
  readonly profitFactor: number | null;
  readonly averageTrade: number | null;
  readonly averageWinner: number | null;
  readonly averageLoser: number | null;
  readonly largestWinner: number | null;
  readonly largestLoser: number | null;
  readonly expectancy: number | null;
  readonly totalQuantity: number;
  readonly maxQuantity: number | null;
}

export interface DirectionalKpis {
  readonly all: TradeKpis;
  readonly long: TradeKpis;
  readonly short: TradeKpis;
}

export interface SummaryMetrics extends TradeKpis, DirectionalKpis {
  readonly directionalValuationsAvailable: boolean;
  readonly netProfit: number;
  readonly netProfitPct: number | null;
  readonly maxDrawdown: number | null;
  readonly maxDrawdownPct: number | null;
}

const DEFAULT_EPSILON = 1e-8;

function kpisForTrades(
  trades: readonly Trade[],
  openTrades: readonly Trade[] = [],
  breakevenEpsilon = DEFAULT_EPSILON,
): TradeKpis {
  const pnlValues = valuesForTrades(trades);
  const winning = pnlValues.filter((value) => value > breakevenEpsilon);
  const losing = pnlValues.filter((value) => value < -breakevenEpsilon);
  const breakeven = pnlValues.filter((value) => Math.abs(value) <= breakevenEpsilon);
  const grossProfit = sum(winning);
  const grossLoss = Math.abs(sum(losing));
  const realizedNet = sum(pnlValues);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : pnlValues.length > 0 && grossProfit > 0 ? Infinity : null;
  const averageTrade = pnlValues.length > 0 ? realizedNet / pnlValues.length : null;
  const averageWinner = winning.length > 0 ? grossProfit / winning.length : null;
  const averageLoser = losing.length > 0 ? -grossLoss / losing.length : null;
  // Realized Summary win-rate excludes zero/breakeven outcomes from its
  // denominator. Trades/average P&L still retain the full closed population.
  const winLossCount = winning.length + losing.length;
  const winRate = winLossCount > 0 ? winning.length / winLossCount : null;
  const quantity = trades.map((trade) => finite(trade.quantity)).filter((value): value is number => value !== null);
  const open = openPnlForTrades(openTrades);
  return {
    tradeCount: trades.length,
    winningTrades: winning.length,
    losingTrades: losing.length,
    breakevenTrades: breakeven.length,
    winRate,
    grossProfit,
    grossLoss,
    realizedNet,
    unrealizedNet: open,
    markToMarketNet: realizedNet + open,
    profitFactor,
    averageTrade,
    averageWinner,
    averageLoser,
    largestWinner: winning.length > 0 ? Math.max(...winning) : null,
    largestLoser: losing.length > 0 ? Math.min(...losing) : null,
    expectancy: averageTrade,
    totalQuantity: sum(quantity),
    maxQuantity: quantity.length > 0 ? Math.max(...quantity) : null,
  };
}

function asTradeArray(input: BacktestReport | readonly Trade[]): readonly Trade[] {
  return isBacktestReport(input) ? input.trades : input;
}

function isBacktestReport(input: BacktestReport | readonly Trade[]): input is BacktestReport {
  return !Array.isArray(input) && typeof input === 'object' && input !== null && 'trades' in input;
}

function reportAccount(input: BacktestReport | readonly Trade[]): { initialCapital: number | null; openPnl: number | null } {
  if (!isBacktestReport(input)) return { initialCapital: null, openPnl: null };
  return {
    initialCapital: finite(input.account?.initialCapital),
    openPnl: finite(input.account?.unrealizedPnl),
  };
}

function directionalKpis(populations: TradePopulations, epsilon: number): DirectionalKpis {
  return {
    all: kpisForTrades(populations.closedTrades, populations.openTrades, epsilon),
    long: kpisForTrades(
      populations.closedTrades.filter((trade) => tradeDirection(trade) === 'long'),
      populations.openTrades.filter((trade) => tradeDirection(trade) === 'long'),
      epsilon,
    ),
    short: kpisForTrades(
      populations.closedTrades.filter((trade) => tradeDirection(trade) === 'short'),
      populations.openTrades.filter((trade) => tradeDirection(trade) === 'short'),
      epsilon,
    ),
  };
}

function summaryClosedTrades(populations: TradePopulations, epsilon: number): readonly NormalizedTrade[] {
  return populations.closedTrades.filter((trade) => {
    const pnl = tradeNetPnl(trade);
    return pnl !== null && Math.abs(pnl) > epsilon;
  });
}

function maxDrawdownFromEquity(equity: readonly number[]): { amount: number | null; pct: number | null } {
  if (equity.length === 0) return { amount: null, pct: null };
  let peak = equity[0];
  let amount = 0;
  let pct: number | null = null;
  for (const value of equity) {
    if (value > peak) peak = value;
    const drawdown = peak - value;
    if (drawdown > amount) {
      amount = drawdown;
      pct = peak !== 0 ? drawdown / Math.abs(peak) : null;
    }
  }
  return { amount, pct };
}

function derivedEquitySeries(
  report: BacktestReport | readonly Trade[],
  closedTrades: readonly NormalizedTrade[],
): readonly EquityPoint[] {
  if (isBacktestReport(report) && report.equitySeries.length > 0) return report.equitySeries;
  const account = reportAccount(report);
  const initial = account.initialCapital ?? 0;
  let equity = initial;
  const points: EquityPoint[] = [];
  const sorted = [...closedTrades].sort((a, b) => (a.exitTime ?? 0) - (b.exitTime ?? 0));
  for (const trade of sorted) {
    const pnl = tradeNetPnl(trade);
    if (pnl === null || trade.exitTime === null) continue;
    equity += pnl;
    points.push({ time: trade.exitTime, equity, pnl });
  }
  // An open-only snapshot has no historical timestamp to anchor a formal
  // equity point. Do not synthesize Date.now(): that would make drawdown/CAGR
  // appear available while silently changing on every render.
  return points;
}

/**
 * Summary/Dock KPI contract. Closed trade counts and win-rate denominator are
 * intentionally independent from `analysisRows` so open rows do not dilute
 * the Summary's realized win rate.
 */
export function calculateSummaryMetrics(
  input: BacktestReport | readonly Trade[],
  options: { readonly breakevenEpsilon?: number } = {},
): SummaryMetrics {
  const epsilon = Math.max(0, options.breakevenEpsilon ?? DEFAULT_EPSILON);
  const populations = selectTradePopulations(asTradeArray(input), { breakevenEpsilon: epsilon });
  // The reference Summary excludes zero-result rows from its Trades and
  // win-rate population, while Analysis deliberately keeps those rows.
  const directional = { ...directionalKpis(
    { ...populations, closedTrades: summaryClosedTrades(populations, epsilon) },
    epsilon,
  ) };
  const all = directional.all;
  const account = reportAccount(input);
  const openPnl = account.openPnl ?? all.unrealizedNet;
  const accountRealized = isBacktestReport(input) ? finite(input.account?.realizedPnl) : null;
  const markToMarketNet = (accountRealized ?? all.realizedNet) + openPnl;
  // Pine reports open P&L at account level; its open ledger row need not
  // expose unrealizedPnl. Attribute that scalar only when the ledger proves
  // a single open direction. Never prorate an ambiguous hedged population.
  const openDirections = new Set(populations.openTrades.map(tradeDirection));
  const openDirection = openDirections.size === 1 ? [...openDirections][0] : null;
  const directionalValuationsAvailable = (account.openPnl !== null && (openDirection === 'long' || openDirection === 'short'))
    || populations.openTrades.every((trade) => tradeDirection(trade) !== 'unknown' && tradeUnrealizedPnl(trade) !== null);
  if (account.openPnl !== null && (openDirection === 'long' || openDirection === 'short')) {
    directional[openDirection] = {
      ...directional[openDirection],
      unrealizedNet: openPnl,
      markToMarketNet: directional[openDirection].realizedNet + openPnl,
    };
  }
  // Pine charges entry commission immediately, including for still-open lots.
  // Closed-trade P&L already includes its own fees. Attribute outstanding fees
  // only when the account/ledger difference independently confirms them;
  // never distribute an unexplained residual to make the columns add up.
  const openFees = populations.openTrades.reduce((total, trade) => total + Math.abs(finite(trade.commission) ?? 0), 0);
  if (accountRealized !== null && openFees > 0 &&
      Math.abs(accountRealized - all.realizedNet + openFees) <= DEFAULT_EPSILON * Math.max(1, Math.abs(accountRealized))) {
    for (const direction of ['long', 'short'] as const) {
      const fees = populations.openTrades.filter((trade) => tradeDirection(trade) === direction)
        .reduce((total, trade) => total + Math.abs(finite(trade.commission) ?? 0), 0);
      directional[direction] = { ...directional[direction], markToMarketNet: directional[direction].markToMarketNet - fees };
    }
  }
  directional.all = { ...all, unrealizedNet: openPnl, markToMarketNet };
  const equity = derivedEquitySeries(input, populations.closedTrades).map((point) => point.equity);
  const derivedDrawdown = maxDrawdownFromEquity(equity);
  const drawdown = {
    amount: isBacktestReport(input) && finite(input.account?.maxDrawdown) !== null
      ? finite(input.account?.maxDrawdown)
      : derivedDrawdown.amount,
    pct: isBacktestReport(input) && finite(input.account?.maxDrawdownPct) !== null
      ? finite(input.account?.maxDrawdownPct)
      : derivedDrawdown.pct,
  };
  const capital = account.initialCapital;
  return {
    ...all,
    unrealizedNet: openPnl,
    markToMarketNet,
    netProfit: markToMarketNet,
    directionalValuationsAvailable,
    netProfitPct: capital !== null && capital !== 0 ? markToMarketNet / Math.abs(capital) : null,
    maxDrawdown: drawdown.amount,
    maxDrawdownPct: drawdown.pct,
    ...directional,
  };
}

export interface PerformancePoint {
  readonly time: number;
  readonly equity: number;
  readonly cumulativePnl: number;
  readonly drawdown: number;
  readonly drawdownPct: number | null;
}

/**
 * One realized cumulative-P&L observation per closed trade.  This is
 * intentionally not an equity point: the reference Summary chart is paired
 * with `trades_history` / `historical_net_profit`, whereas the engine's
 * per-bar equity stream remains the authoritative source for risk metrics.
 */
export interface RealizedPnlPoint {
  readonly time: number;
  readonly cumulativePnl: number;
}

export interface BucketPerformance {
  readonly bucket: string;
  readonly pnl: number;
  readonly tradeCount: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
}

export interface PerformanceMetrics extends DirectionalKpis {
  readonly equityCurve: readonly PerformancePoint[];
  readonly cumulativePnl: readonly RealizedPnlPoint[];
  readonly drawdownCurve: readonly PerformancePoint[];
  readonly benchmarkCurve: readonly BenchmarkPoint[];
  readonly netDailyPnl: readonly BucketPerformance[];
  readonly weeklyPerformance: readonly BucketPerformance[];
  readonly weekdayPerformance: readonly BucketPerformance[];
  readonly averagePnlPerDay: Readonly<Record<'all' | 'long' | 'short', number | null>>;
  readonly averagePnlPerWeek: Readonly<Record<'all' | 'long' | 'short', number | null>>;
  readonly maxDrawdown: number | null;
  readonly maxDrawdownPct: number | null;
  readonly cagr: number | null;
  readonly sharpe: number | null;
  readonly sortino: number | null;
  readonly calmar: number | null;
  readonly buyAndHoldPnl: number | null;
  readonly buyAndHoldPct: number | null;
  readonly strategyOutperformance: number | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Reference Summary curve contract: one point per realized trade, ordered by
 * exit.  Keep zero-result closed trades: reference `historical_net_profit`
 * is index-paired with `trades_history`, while the Summary trade-count KPI
 * independently excludes breakeven rows.  Source order breaks timestamp ties
 * deterministically, rather than inventing an engine order id ordering.
 */
function realizedCumulativePnlSeries(
  closedTrades: readonly NormalizedTrade[],
): readonly RealizedPnlPoint[] {
  const ordered = closedTrades
    .map((trade, index) => ({ trade, index }))
    .filter(({ trade }) => trade.exitTime !== null && tradeNetPnl(trade) !== null)
    .sort((left, right) => (left.trade.exitTime! - right.trade.exitTime!) || left.index - right.index);
  let cumulativePnl = 0;
  return ordered.map(({ trade }) => {
    cumulativePnl += tradeNetPnl(trade)!;
    return { time: trade.exitTime!, cumulativePnl };
  });
}

function mondayBucket(parts: NonNullable<ReturnType<typeof calendarDateParts>>): string {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const delta = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - delta);
  return date.toISOString().slice(0, 10);
}

function bucketRows(
  trades: readonly NormalizedTrade[],
  bucket: (trade: NormalizedTrade) => string | null,
): BucketPerformance[] {
  const groups = new Map<string, { pnl: number; count: number; wins: number; losses: number }>();
  for (const trade of trades) {
    const key = bucket(trade);
    const pnl = tradeNetPnl(trade);
    if (key === null || pnl === null) continue;
    const row = groups.get(key) ?? { pnl: 0, count: 0, wins: 0, losses: 0 };
    row.pnl += pnl;
    row.count += 1;
    if (pnl > DEFAULT_EPSILON) row.wins += 1;
    if (pnl < -DEFAULT_EPSILON) row.losses += 1;
    groups.set(key, row);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, row]) => ({
      bucket: key,
      pnl: row.pnl,
      tradeCount: row.count,
      winningTrades: row.wins,
      losingTrades: row.losses,
    }));
}

function averageBucketPnl(rows: readonly BucketPerformance[]): number | null {
  return rows.length > 0 ? sum(rows.map((row) => row.pnl)) / rows.length : null;
}

function returnsFromEquity(points: readonly PerformancePoint[]): number[] {
  const returns: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].equity;
    const current = points[index].equity;
    if (previous !== 0 && Number.isFinite(previous) && Number.isFinite(current)) returns.push(current / previous - 1);
  }
  return returns;
}

function annualizedRatios(points: readonly PerformancePoint[], periodsPerYear = 252): { sharpe: number | null; sortino: number | null } {
  const returns = returnsFromEquity(points);
  if (returns.length < 2) return { sharpe: null, sortino: null };
  const mean = sum(returns) / returns.length;
  const variance = sum(returns.map((value) => (value - mean) ** 2)) / (returns.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length > 1 ? Math.sqrt(sum(downside.map((value) => value ** 2)) / (downside.length - 1)) : 0;
  return {
    sharpe: standardDeviation > 0 ? (mean / standardDeviation) * Math.sqrt(periodsPerYear) : null,
    sortino: downsideDeviation > 0 ? (mean / downsideDeviation) * Math.sqrt(periodsPerYear) : null,
  };
}

function cagrForPoints(points: readonly PerformancePoint[], initialCapital: number | null): number | null {
  if (points.length < 1 || initialCapital === null || initialCapital <= 0) return null;
  const start = initialCapital;
  const end = points[points.length - 1].equity;
  const elapsedYears = (points[points.length - 1].time - points[0].time) / (365.2425 * 24 * 60 * 60 * 1000);
  if (elapsedYears <= 0 || start <= 0 || end < 0) return null;
  return (end / start) ** (1 / elapsedYears) - 1;
}

function benchmarkStats(report: BacktestReport, initialCapital: number | null): { curve: readonly BenchmarkPoint[]; pnl: number | null; pct: number | null } {
  const curve = report.benchmarkSeries.length > 0
    ? report.benchmarkSeries
    : deriveBenchmarkSeries(report.bars, initialCapital);
  if (report.benchmarkSeries.length > 0 && curve.length > 0) {
    const last = curve[curve.length - 1];
    const pnl = finite(last.pnl);
    const pct = finite(last.returnPct);
    // Engine benchmark points are anchored to the first actual fill. Their
    // first emitted close can already have moved away from that fill price,
    // so deriving return from firstPoint -> lastPoint would silently drop the
    // first bar's move. Use the broker-provided cumulative values instead.
    if (pnl !== null || pct !== null) {
      return { curve, pnl, pct };
    }
  }
  if (curve.length < 2) return { curve, pnl: null, pct: null };
  const first = curve[0].value;
  const last = curve[curve.length - 1].value;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return { curve, pnl: null, pct: null };
  const pct = last / first - 1;
  return { curve, pnl: initialCapital !== null ? initialCapital * pct : last - first, pct };
}

function deriveBenchmarkSeries(bars: readonly BacktestBar[], initialCapital: number | null): readonly BenchmarkPoint[] {
  if (bars.length === 0) return [];
  const firstClose = finite(bars[0].close);
  if (firstClose === null || firstClose === 0) return [];
  return bars
    .filter((bar) => Number.isFinite(bar.time) && Number.isFinite(bar.close))
    .map((bar) => {
      const returnPct = bar.close / firstClose - 1;
      return {
        time: bar.time,
        value: bar.close,
        pnl: initialCapital === null ? undefined : initialCapital * returnPct,
        returnPct,
        barIndex: bar.barIndex,
      };
    });
}

export function calculatePerformanceMetrics(
  report: BacktestReport,
  options: { readonly timezone?: string; readonly periodsPerYear?: number } = {},
): PerformanceMetrics {
  const populations = selectTradePopulations(report.trades);
  const summary = calculateSummaryMetrics(report);
  const sourcePoints = derivedEquitySeries(report, populations.closedTrades);
  const cumulativePnl = realizedCumulativePnlSeries(populations.closedTrades);
  let peak = -Infinity;
  const equityCurve: PerformancePoint[] = sourcePoints.map((point) => {
    peak = Math.max(peak, point.equity);
    const derivedDrawdown = Math.max(0, peak - point.equity);
    // Local PineTS report points carry the broker's authoritative close
    // underwater path.  Preserve it when present; a trade-ledger fallback has
    // no such field and continues to use the deterministic peak calculation.
    const drawdown = finite(point.drawdown) ?? derivedDrawdown;
    const drawdownPct = finite(point.drawdownPct)
      ?? (peak !== 0 ? derivedDrawdown / Math.abs(peak) : null);
    return {
      time: point.time,
      equity: point.equity,
      cumulativePnl: finite(point.pnl)
        ?? point.equity - (report.account?.initialCapital ?? 0),
      drawdown,
      drawdownPct,
    };
  });
  const ratios = annualizedRatios(equityCurve, options.periodsPerYear ?? 252);
  const benchmark = benchmarkStats(report, report.account?.initialCapital ?? null);
  const timezone = options.timezone ?? report.context?.timezone ?? 'UTC';
  const buckets = populations.closedTrades;
  const calendarPartsByTrade = new Map(buckets.map((trade) => [
    trade,
    trade.exitTime === null ? null : calendarDateParts(trade.exitTime, timezone),
  ]));
  const weekday = bucketRows(buckets, (trade) => {
    const parts = calendarPartsByTrade.get(trade);
    return parts ? WEEKDAY_LABELS[parts.weekday] ?? null : null;
  });
  const weekdayByBucket = new Map(weekday.map((row) => [row.bucket, row]));
  const fixedWeekday = WEEKDAY_LABELS.map((bucket) => weekdayByBucket.get(bucket) ?? {
    bucket,
    pnl: 0,
    tradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
  });
  const directions = {
    all: buckets,
    long: buckets.filter((trade) => tradeDirection(trade) === 'long'),
    short: buckets.filter((trade) => tradeDirection(trade) === 'short'),
  } as const;
  const dailyRows = (trades: readonly NormalizedTrade[]) => bucketRows(
    trades,
    (trade) => calendarPartsByTrade.get(trade)?.key ?? null,
  );
  const weeklyRows = (trades: readonly NormalizedTrade[]) => bucketRows(trades, (trade) => {
    const parts = calendarPartsByTrade.get(trade);
    return parts ? mondayBucket(parts) : null;
  });
  const netDailyPnl = dailyRows(directions.all);
  const weeklyPerformance = weeklyRows(directions.all);
  return {
    ...summary,
    equityCurve: Object.freeze(equityCurve),
    cumulativePnl: Object.freeze(cumulativePnl),
    drawdownCurve: Object.freeze(equityCurve),
    benchmarkCurve: benchmark.curve,
    netDailyPnl,
    weeklyPerformance,
    weekdayPerformance: Object.freeze(fixedWeekday),
    averagePnlPerDay: Object.freeze({
      all: averageBucketPnl(netDailyPnl),
      long: averageBucketPnl(dailyRows(directions.long)),
      short: averageBucketPnl(dailyRows(directions.short)),
    }),
    averagePnlPerWeek: Object.freeze({
      all: averageBucketPnl(weeklyPerformance),
      long: averageBucketPnl(weeklyRows(directions.long)),
      short: averageBucketPnl(weeklyRows(directions.short)),
    }),
    maxDrawdown: summary.maxDrawdown,
    maxDrawdownPct: summary.maxDrawdownPct,
    cagr: cagrForPoints(equityCurve, report.account?.initialCapital ?? null),
    sharpe: ratios.sharpe,
    sortino: ratios.sortino,
    // Calmar is CAGR divided by maximum drawdown percentage.  Using total
    // return here silently changes the unit and materially overstates short
    // windows; keep it unavailable when either authoritative component is not
    // defined or drawdown is zero.
    calmar: summary.maxDrawdownPct && summary.maxDrawdownPct > 0
      ? (() => {
          const cagr = cagrForPoints(equityCurve, report.account?.initialCapital ?? null);
          return cagr === null ? null : cagr / summary.maxDrawdownPct;
        })()
      : null,
    buyAndHoldPnl: benchmark.pnl,
    buyAndHoldPct: benchmark.pct,
    // Same mark-to-market population as visible Net Profit, in account currency.
    strategyOutperformance: benchmark.pnl === null ? null : summary.markToMarketNet - benchmark.pnl,
  };
}

export interface AnalysisMetrics extends TradeKpis {
  readonly rowCount: number;
  readonly openRows: number;
  readonly averageDurationMs: number | null;
  readonly medianDurationMs: number | null;
  readonly maxDurationMs: number | null;
  readonly averageDurationBars: number | null;
  readonly medianDurationBars: number | null;
  readonly maxDurationBars: number | null;
  readonly averageMfe: number | null;
  readonly averageMae: number | null;
  readonly maxWinningStreak: number;
  readonly maxLosingStreak: number;
  readonly currentWinningStreak: number;
  readonly currentLosingStreak: number;
  readonly analysisWinRate: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function streaks(trades: readonly Trade[], epsilon = DEFAULT_EPSILON): {
  maxWin: number;
  maxLoss: number;
  currentWin: number;
  currentLoss: number;
} {
  let maxWin = 0;
  let maxLoss = 0;
  let win = 0;
  let loss = 0;
  for (const trade of trades) {
    const pnl = tradeNetPnl(trade);
    if (pnl === null) continue;
    if (pnl > epsilon) {
      win += 1;
      loss = 0;
    } else if (pnl < -epsilon) {
      loss += 1;
      win = 0;
    } else {
      win = 0;
      loss = 0;
    }
    maxWin = Math.max(maxWin, win);
    maxLoss = Math.max(maxLoss, loss);
  }
  return { maxWin, maxLoss, currentWin: win, currentLoss: loss };
}

export function calculateAnalysisMetrics(
  input: BacktestReport | readonly Trade[],
  options: { readonly breakevenEpsilon?: number } = {},
): AnalysisMetrics {
  const epsilon = options.breakevenEpsilon ?? DEFAULT_EPSILON;
  const populations = selectTradePopulations(asTradeArray(input), { breakevenEpsilon: epsilon });
  const rows = populations.analysisRows;
  const closed = populations.closedTrades;
  const base = kpisForTrades(closed, populations.openTrades, epsilon);
  const durations = closed
    .map((trade) => {
      if (trade.durationMs !== null && trade.durationMs !== undefined && trade.durationMs >= 0) return trade.durationMs;
      if (trade.entryTime !== null && trade.exitTime !== null) return Math.max(0, trade.exitTime - trade.entryTime);
      return null;
    })
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const barIndexCapability = !isBacktestReport(input) || input.capabilities.barIndices;
  const candidateDurationBars = closed.map((trade) => {
    const entry = trade.entryBarIndex;
    const exit = trade.exitBarIndex;
    if (
      typeof entry !== 'number'
      || !Number.isSafeInteger(entry)
      || entry < 0
      || typeof exit !== 'number'
      || !Number.isSafeInteger(exit)
      || exit < entry
    ) return null;
    // Match Pine/TradingView's "Average bars in trades" convention: both the
    // entry and exit bars are part of the holding period, so a same-bar trade
    // lasts one bar rather than zero.
    return exit - entry + 1;
  });
  // Duration aggregates describe the whole closed-trade population. A mixed
  // ledger must remain unavailable instead of silently averaging only the
  // subset whose indices happened to survive a provider/bridge boundary.
  const durationBars = barIndexCapability
    && candidateDurationBars.length > 0
    && candidateDurationBars.every((value): value is number => value !== null)
    ? candidateDurationBars
    : [];
  const mfe = closed.map((trade) => finite(trade.mfe)).filter((value): value is number => value !== null);
  const mae = closed.map((trade) => finite(trade.mae)).filter((value): value is number => value !== null);
  // Open/current rows remain visible in Analysis but are never classified as
  // winners or losers from a provisional `pnl` field.
  const rowValues = valuesForTrades(rows.filter((trade) => !isTradeOpen(trade)));
  const wins = rowValues.filter((value) => value > epsilon).length;
  const rowDenominator = rows.length;
  const streak = streaks(closed, epsilon);
  return {
    ...base,
    rowCount: rows.length,
    openRows: populations.openTrades.length,
    averageDurationMs: durations.length > 0 ? sum(durations) / durations.length : null,
    medianDurationMs: median(durations),
    maxDurationMs: durations.length > 0 ? Math.max(...durations) : null,
    averageDurationBars: durationBars.length > 0 ? sum(durationBars) / durationBars.length : null,
    medianDurationBars: median(durationBars),
    maxDurationBars: durationBars.length > 0 ? Math.max(...durationBars) : null,
    averageMfe: mfe.length > 0 ? sum(mfe) / mfe.length : null,
    averageMae: mae.length > 0 ? sum(mae) / mae.length : null,
    maxWinningStreak: streak.maxWin,
    maxLosingStreak: streak.maxLoss,
    currentWinningStreak: streak.currentWin,
    currentLosingStreak: streak.currentLoss,
    analysisWinRate: rowDenominator > 0 ? wins / rowDenominator : null,
  };
}

export type SimulationMode = SimulationConfig['mode'];

export interface SimulationOptions {
  readonly mode?: SimulationMode;
  readonly runs?: number;
  readonly pnlVariationPct?: number;
  readonly preserveWinLoss?: boolean;
  readonly drawdownThreshold?: number | null;
  readonly drawdownThresholdUnit?: 'currency' | 'percent' | null;
  readonly seed?: number | string | null;
  /** Cooperative cancellation hook for a future Worker/host runner. */
  readonly signal?: { readonly aborted: boolean };
  /** Called at the start and periodically as runs complete. */
  readonly onProgress?: (progress: SimulationProgress) => void;
}

export interface SimulationProgress {
  readonly completedRuns: number;
  readonly totalRuns: number;
  readonly fraction: number;
}

/** Upper bound shared by the synchronous fallback and the future Worker. */
export const MAX_SIMULATION_RUNS = 10_000;

/** Thrown when a caller cancels a simulation before it completes. */
export class SimulationCancelledError extends Error {
  readonly completedRuns: number;
  readonly totalRuns: number;

  constructor(completedRuns: number, totalRuns: number) {
    super(`Simulation cancelled after ${completedRuns}/${totalRuns} runs`);
    this.name = 'SimulationCancelledError';
    this.completedRuns = completedRuns;
    this.totalRuns = totalRuns;
  }
}

function seedNumber(seed: number | string | null | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed ?? 'quant-tools');
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** Small deterministic PRNG; production may pass a random seed, tests pass a fixed one. */
export function createSeededRandom(seed: number | string | null | undefined): () => number {
  let state = seedNumber(seed) || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    state >>>= 0;
    return state / 0x100000000;
  };
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return sorted[index];
}

function maxDrawdown(values: readonly number[]): number {
  let peak = 0;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, peak - value);
  }
  return drawdown;
}

function maxLosingStreak(values: readonly number[], epsilon = DEFAULT_EPSILON): number {
  let current = 0;
  let maximum = 0;
  for (const value of values) {
    if (value < -epsilon) current += 1;
    else current = 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function shuffledIndices(length: number, random: () => number): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [indices[index], indices[swap]] = [indices[swap], indices[index]];
  }
  return indices;
}

function variedPnl(value: number, variationPct: number, random: () => number): number {
  if (variationPct <= 0) return value;
  const variation = (random() * 2 - 1) * variationPct;
  return value * (1 + variation);
}

function simulationConfig(options: SimulationOptions): SimulationConfig {
  const requestedRuns = options.runs ?? 1000;
  const runs = Number.isFinite(requestedRuns)
    ? Math.min(MAX_SIMULATION_RUNS, Math.max(1, Math.floor(requestedRuns)))
    : 1000;
  return {
    mode: options.mode ?? 'resample',
    runs,
    // Keep the public contract in percentage points (10 means ±10%). The
    // sampler converts it to a ratio only at the point where it varies a fill.
    pnlVariationPct: Math.max(0, options.pnlVariationPct ?? 0),
    preserveWinLoss: options.preserveWinLoss ?? false,
    drawdownThreshold: options.drawdownThreshold ?? null,
    drawdownThresholdUnit: options.drawdownThresholdUnit ?? null,
    seed: options.seed ?? null,
  };
}

/**
 * Runs deterministic Resample/Shuffle over the same closed-trade population
 * used by the viewer. Shuffle preserves the total outcome; Resample does not.
 */
export function runSimulation(
  input: BacktestReport | readonly Trade[],
  options: SimulationOptions = {},
): SimulationResult {
  const populations = selectTradePopulations(asTradeArray(input));
  const sourceTrades = populations.simulationPopulation;
  const sourcePnls = valuesForTrades(sourceTrades);
  const config = simulationConfig(options);
  const random = createSeededRandom(config.seed);
  const paths: SimulationPath[] = [];
  let completedRuns = 0;
  const progressStep = Math.max(1, Math.ceil(config.runs / 100));
  const notifyProgress = (completed: number): void => {
    if (options.signal?.aborted) throw new SimulationCancelledError(completed, config.runs);
    options.onProgress?.({
      completedRuns: completed,
      totalRuns: config.runs,
      fraction: config.runs > 0 ? completed / config.runs : 1,
    });
    // A progress callback may request cancellation synchronously. Check again
    // so cancellation at the final progress event cannot return a fake result.
    if (options.signal?.aborted) throw new SimulationCancelledError(completed, config.runs);
  };
  notifyProgress(0);
  for (let run = 0; run < config.runs; run += 1) {
    const values: number[] = [];
    if (sourcePnls.length > 0) {
      const indices = config.mode === 'shuffle' ? shuffledIndices(sourcePnls.length, random) : [];
      for (let index = 0; index < sourcePnls.length; index += 1) {
        const sourceIndex = config.mode === 'shuffle' ? indices[index] : Math.floor(random() * sourcePnls.length);
        values.push(variedPnl(sourcePnls[sourceIndex], config.pnlVariationPct / 100, random));
      }
    }
    // Preserve win/loss means the sign sequence is retained while magnitudes
    // are sampled from the corresponding source class.
    if (config.preserveWinLoss && sourcePnls.length > 1) {
      const wins = sourcePnls.filter((value) => value > DEFAULT_EPSILON);
      const losses = sourcePnls.filter((value) => value < -DEFAULT_EPSILON);
      for (let index = 0; index < values.length; index += 1) {
        const original = sourcePnls[index % sourcePnls.length];
        // Breakeven is its own class. Treating zero as a win would turn a
        // genuine flat trade into a positive outcome when preserve mode is
        // enabled, changing both the sign sequence and the realized total.
        if (Math.abs(original) <= DEFAULT_EPSILON) {
          values[index] = 0;
          continue;
        }
        const candidates = original > 0 ? wins : losses;
        if (candidates.length > 0) {
          const magnitude = Math.abs(candidates[Math.floor(random() * candidates.length)]);
          values[index] = original > 0 ? magnitude : -magnitude;
        }
      }
    }
    let running = 0;
    const cumulative = values.map((value) => {
      running += value;
      return running;
    });
    const endingPnl = cumulative.length > 0 ? cumulative[cumulative.length - 1] : 0;
    paths.push({
      values: Object.freeze(cumulative),
      endingPnl,
      maxDrawdown: maxDrawdown(cumulative),
      maxLosingStreak: maxLosingStreak(values),
    });
    completedRuns = run + 1;
    if (completedRuns % progressStep === 0 || completedRuns === config.runs) {
      notifyProgress(completedRuns);
    }
  }
  const endingPnls = paths.map((path) => path.endingPnl);
  const drawdowns = paths.map((path) => path.maxDrawdown);
  const initialCapital = isBacktestReport(input) ? finite(input.account?.initialCapital) : null;
  const threshold = config.drawdownThreshold;
  // A percentage threshold has no defined currency conversion without an
  // initial capital base. Keep the probability unavailable rather than
  // silently interpreting the percentage as a currency amount.
  const thresholdValue = threshold === null || threshold === undefined
    ? null
    : config.drawdownThresholdUnit === 'percent'
      ? initialCapital === null ? null : Math.abs(initialCapital) * Math.abs(threshold) / 100
      : Math.abs(threshold);
  const thresholdBreachProbability = thresholdValue === null || sourcePnls.length === 0 || paths.length === 0
    ? null
    : paths.filter((path) => path.maxDrawdown >= thresholdValue).length / paths.length;
  const riskOfRuin = initialCapital !== null && initialCapital > 0 && paths.length > 0
    ? paths.filter((path) => {
        let minimum = 0;
        for (const value of path.values) minimum = Math.min(minimum, value);
        return minimum <= -initialCapital;
      }).length / paths.length
    : null;
  return {
    config,
    populationSize: sourcePnls.length,
    paths: Object.freeze(paths),
    endingPnls: Object.freeze(endingPnls),
    drawdowns: Object.freeze(drawdowns),
    probabilityOfProfit: sourcePnls.length > 0 && endingPnls.length > 0
      ? endingPnls.filter((value) => value > 0).length / endingPnls.length
      : null,
    medianOutcome: sourcePnls.length > 0 ? percentile(endingPnls, 0.5) : null,
    p95Drawdown: sourcePnls.length > 0 ? percentile(drawdowns, 0.95) : null,
    p99Drawdown: sourcePnls.length > 0 ? percentile(drawdowns, 0.99) : null,
    riskOfRuin,
    thresholdBreachProbability,
    p95LosingStreak: sourcePnls.length > 0 ? percentile(paths.map((path) => path.maxLosingStreak), 0.95) : null,
  };
}

export const calculateSimulationMetrics = runSimulation;
export const calculateKpis = calculateSummaryMetrics;
export const calculatePerformance = calculatePerformanceMetrics;
export const calculateAnalysis = calculateAnalysisMetrics;
export const computeSummaryMetrics = calculateSummaryMetrics;
export const computePerformanceMetrics = calculatePerformanceMetrics;
export const computeAnalysisMetrics = calculateAnalysisMetrics;
export const simulateBacktest = runSimulation;
export { selectTradePopulations } from './backtesting.ts';

export function selectSummaryPopulation(input: BacktestReport | readonly Trade[]): readonly NormalizedTrade[] {
  const populations = selectTradePopulations(asTradeArray(input));
  return populations.closedTrades.filter((trade) => {
    const pnl = tradeNetPnl(trade);
    return pnl !== null && Math.abs(pnl) > DEFAULT_EPSILON;
  });
}

export function selectAnalysisPopulation(input: BacktestReport | readonly Trade[]): readonly NormalizedTrade[] {
  return selectTradePopulations(asTradeArray(input)).analysisRows;
}

export function selectSimulationPopulation(input: BacktestReport | readonly Trade[]): readonly NormalizedTrade[] {
  return selectTradePopulations(asTradeArray(input)).simulationPopulation;
}

export interface FormattedMetricOptions {
  readonly unit?: MetricUnit;
  readonly locale?: string;
  readonly currency?: string;
  readonly maximumFractionDigits?: number;
  readonly minimumFractionDigits?: number;
  readonly unavailableText?: string;
}

/** Stable UI formatter; calculations remain numeric and locale-independent. */
export function formatMetricValue(value: number | null | undefined, options: FormattedMetricOptions = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return options.unavailableText ?? '—';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '-∞';
  const normalized = Object.is(value, -0) ? 0 : value;
  const fractionDigits = options.maximumFractionDigits ?? (options.unit === 'percent' ? 2 : 2);
  const formatter = new Intl.NumberFormat(options.locale ?? 'en-US', {
    style: options.unit === 'currency' ? 'currency' : 'decimal',
    currency: options.currency ?? 'USD',
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  });
  const formatted = formatter.format(options.unit === 'percent' ? normalized * 100 : normalized);
  return options.unit === 'percent' ? `${formatted}%` : formatted;
}

export function formatDuration(durationMs: number | null | undefined, unavailableText = '—'): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return unavailableText;
  const totalSeconds = Math.floor(durationMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Returns metric wrappers for consumers that need explicit source/availability. */
export function summaryMetricMap(summary: SummaryMetrics): Readonly<Record<string, BacktestMetric>> {
  return {
    netProfit: metric(summary.netProfit, 'currency', 'derived'),
    netProfitPct: metric(summary.netProfitPct, 'percent', 'derived', summary.netProfitPct === null ? 'division-by-zero' : undefined),
    trades: metric(summary.tradeCount, 'count', 'trade-ledger'),
    winRate: metric(summary.winRate, 'percent', 'trade-ledger', summary.winRate === null ? 'insufficient-data' : undefined),
    grossProfit: metric(summary.grossProfit, 'currency', 'trade-ledger'),
    grossLoss: metric(summary.grossLoss, 'currency', 'trade-ledger'),
    profitFactor: metric(summary.profitFactor, 'ratio', 'trade-ledger', summary.profitFactor === null ? 'division-by-zero' : undefined),
    maxDrawdown: metric(summary.maxDrawdown, 'currency', 'derived', summary.maxDrawdown === null ? 'insufficient-data' : undefined),
  };
}
