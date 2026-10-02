/**
 * Pure Monte Carlo simulation primitives matching the LuxAlgo reference
 * workspace's Simulation contract.
 *
 * This module deliberately has no controller, storage, worker, or view
 * dependencies. Public collections are copied and frozen so callers cannot
 * mutate either their inputs or a completed simulation result.
 */

export const BACKTEST_SIMULATION_DEFAULT_SEED = 12_648_430;
export const BACKTEST_SIMULATION_HISTOGRAM_BINS = 30;
export const BACKTEST_SIMULATION_MAX_BAND_POINTS = 512;

export type ReferenceSimulationMode = 'resample' | 'shuffle';

export interface BacktestSimulationExcursions {
  readonly mae: readonly number[];
}

export interface BacktestSimulationInput {
  readonly deltas: readonly number[];
  readonly excursions?: BacktestSimulationExcursions;
  readonly initialCapital: number;
  readonly runs: number;
  readonly mode: ReferenceSimulationMode;
  readonly seed: number;
  /** Decimal scale: 0.1 means a 10% random P&L variation. */
  readonly variation?: number;
  readonly preserveWinLoss?: boolean;
}

export interface BacktestSimulationProgress {
  readonly completedRuns: number;
  readonly totalRuns: number;
  readonly fraction: number;
}

export interface BacktestSimulationExecutionOptions {
  /** Cooperative cancellation for the synchronous fallback and deterministic tests. */
  readonly signal?: { readonly aborted: boolean };
  /** Called before the first run and at bounded intervals while work advances. */
  readonly onProgress?: (progress: BacktestSimulationProgress) => void;
}

export class BacktestSimulationCancelledError extends Error {
  readonly completedRuns: number;
  readonly totalRuns: number;

  constructor(completedRuns: number, totalRuns: number) {
    super(`Backtest simulation cancelled after ${completedRuns}/${totalRuns} runs`);
    this.name = 'BacktestSimulationCancelledError';
    this.completedRuns = completedRuns;
    this.totalRuns = totalRuns;
  }
}

export interface BacktestEquityWalkOptions {
  readonly mae?: readonly number[];
}

export interface BacktestEquityWalk {
  /** Cumulative net profit, starting at zero; never the account balance. */
  readonly path: readonly number[];
  readonly final: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownAbs: number;
  readonly openMaxDrawdown: number;
  readonly openMaxDrawdownAbs: number;
  readonly longestLosingStreak: number;
  readonly maxDrawdownDuration: number;
  readonly recoveryDuration: number;
  readonly recovered: boolean;
}

export interface BacktestSimulationBands {
  readonly index: readonly number[];
  readonly p5: readonly number[];
  readonly p25: readonly number[];
  readonly p50: readonly number[];
  readonly p75: readonly number[];
  readonly p95: readonly number[];
}

export interface BacktestSimulationStreaks {
  readonly longestLosingStreak: readonly number[];
  readonly maxDrawdownDuration: readonly number[];
  readonly recoveryDuration: readonly number[];
}

export interface BacktestSimulationResult {
  readonly bands: BacktestSimulationBands;
  readonly finals: readonly number[];
  readonly maxDrawdowns: readonly number[];
  readonly maxDrawdownsAbs: readonly number[];
  readonly openMaxDrawdowns: readonly number[];
  readonly openMaxDrawdownsAbs: readonly number[];
  readonly probProfit: number;
  readonly medianFinal: number;
  readonly p5Final: number;
  readonly p95Final: number;
  readonly p95Drawdown: number;
  readonly p99Drawdown: number;
  readonly streaks: BacktestSimulationStreaks;
}

export interface SimulationHistogramBin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

function freezeNumbers(values: ArrayLike<number> | Iterable<number>): readonly number[] {
  return Object.freeze(Array.from(values));
}

function freezeBands(bands: {
  readonly index: ArrayLike<number> | Iterable<number>;
  readonly p5: ArrayLike<number> | Iterable<number>;
  readonly p25: ArrayLike<number> | Iterable<number>;
  readonly p50: ArrayLike<number> | Iterable<number>;
  readonly p75: ArrayLike<number> | Iterable<number>;
  readonly p95: ArrayLike<number> | Iterable<number>;
}): BacktestSimulationBands {
  return Object.freeze({
    index: freezeNumbers(bands.index),
    p5: freezeNumbers(bands.p5),
    p25: freezeNumbers(bands.p25),
    p50: freezeNumbers(bands.p50),
    p75: freezeNumbers(bands.p75),
    p95: freezeNumbers(bands.p95),
  });
}

function freezeStreaks(streaks: {
  readonly longestLosingStreak: ArrayLike<number> | Iterable<number>;
  readonly maxDrawdownDuration: ArrayLike<number> | Iterable<number>;
  readonly recoveryDuration: ArrayLike<number> | Iterable<number>;
}): BacktestSimulationStreaks {
  return Object.freeze({
    longestLosingStreak: freezeNumbers(streaks.longestLosingStreak),
    maxDrawdownDuration: freezeNumbers(streaks.maxDrawdownDuration),
    recoveryDuration: freezeNumbers(streaks.recoveryDuration),
  });
}

function emptySimulationResult(): BacktestSimulationResult {
  return Object.freeze({
    bands: freezeBands({ index: [], p5: [], p25: [], p50: [], p75: [], p95: [] }),
    finals: freezeNumbers([]),
    maxDrawdowns: freezeNumbers([]),
    maxDrawdownsAbs: freezeNumbers([]),
    openMaxDrawdowns: freezeNumbers([]),
    openMaxDrawdownsAbs: freezeNumbers([]),
    probProfit: 0,
    medianFinal: 0,
    p5Final: 0,
    p95Final: 0,
    p95Drawdown: 0,
    p99Drawdown: 0,
    streaks: freezeStreaks({
      longestLosingStreak: [],
      maxDrawdownDuration: [],
      recoveryDuration: [],
    }),
  });
}

/** Mulberry32, using the same unsigned 32-bit operations as the reference. */
export function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    let value = state = (state + 1_831_565_813) >>> 0;
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Walks realized equity and the MAE-aware open-equity envelope.
 *
 * Missing or non-finite MAE values fall back to the trade's full realized
 * loss. Drawdowns intentionally remain zero when starting capital is not a
 * finite positive number, while path and streak calculations still run.
 */
export function walkBacktestEquity(
  deltas: readonly number[],
  initialCapital: number,
  options: BacktestEquityWalkOptions = {},
): BacktestEquityWalk {
  const walk = walkEquityInto(
    deltas,
    initialCapital,
    options.mae,
    new Float64Array(deltas.length + 1),
  );
  return Object.freeze({
    ...walk,
    path: freezeNumbers(walk.path),
  });
}

/** Linear interpolation over an already ascending collection. */
export function linearPercentileSorted(values: ArrayLike<number>, quantile: number): number {
  if (values.length === 0) return 0;
  const position = quantile * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

/** Linear percentile without mutating the caller's collection. */
export function linearPercentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  return linearPercentileSorted([...values].sort((left, right) => left - right), quantile);
}

export function buildSimulationHistogram(
  values: readonly number[],
  binCount: number = BACKTEST_SIMULATION_HISTOGRAM_BINS,
): readonly SimulationHistogramBin[] {
  if (values.length === 0 || binCount <= 0 || !Number.isInteger(binCount)) return Object.freeze([]);

  let minimum = Infinity;
  let maximum = -Infinity;
  for (const value of values) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }

  const tolerance = 1e-9 * Math.max(1, Math.abs(minimum), Math.abs(maximum));
  if (maximum - minimum <= tolerance) {
    return Object.freeze([Object.freeze({ from: minimum, to: maximum, count: values.length })]);
  }

  const width = (maximum - minimum) / binCount;
  const bins = Array.from({ length: binCount }, (_, index): SimulationHistogramBin => ({
    from: minimum + index * width,
    to: minimum + (index + 1) * width,
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - minimum) / width));
    const bin = bins[index];
    bins[index] = { from: bin.from, to: bin.to, count: bin.count + 1 };
  }
  return Object.freeze(bins.map((bin) => Object.freeze(bin)));
}

export function drawdownProbability(values: readonly number[], threshold: number): number {
  if (values.length === 0) return 0;
  let matches = 0;
  for (const value of values) {
    if (value >= threshold) matches += 1;
  }
  return matches / values.length;
}

export function ruinProbability(drawdownRatios: readonly number[]): number {
  return drawdownProbability(drawdownRatios, 1);
}

function sampledPathIndices(tradeCount: number): number[] {
  const sampleCount = Math.min(tradeCount + 1, BACKTEST_SIMULATION_MAX_BAND_POINTS);
  if (sampleCount === tradeCount + 1) {
    return Array.from({ length: sampleCount }, (_, index) => index);
  }
  return Array.from(
    { length: sampleCount },
    (_, index) => Math.round(index * tradeCount / (sampleCount - 1)),
  );
}

function laplaceNoise(random: () => number, scale: number): number {
  const centered = random() - 0.5;
  const safeTail = Math.max(1e-12, 1 - 2 * Math.abs(centered));
  return -scale * Math.sign(centered) * Math.log(safeTail);
}

/**
 * Runs the reference Resample (bootstrap) or cumulative Shuffle simulation.
 * Every source trade's MAE follows that trade through sampling, shuffling,
 * and variation.
 */
export function simulateBacktestReference(input: BacktestSimulationInput): BacktestSimulationResult {
  return simulateBacktestReferenceControlled(input);
}

/**
 * Reference simulation with execution hooks used by the local Worker adapter.
 * The hooks are observational only: omitting them follows the exact same hot
 * loop and random-number order as `simulateBacktestReference`.
 */
export function simulateBacktestReferenceControlled(
  input: BacktestSimulationInput,
  options: BacktestSimulationExecutionOptions = {},
): BacktestSimulationResult {
  const {
    deltas,
    excursions,
    initialCapital,
    runs,
    mode,
    seed,
    variation = 0,
    preserveWinLoss = false,
  } = input;
  const tradeCount = deltas.length;
  const appliesVariation = Number.isFinite(variation) && variation > 0;
  const validExcursions = excursions?.mae.length === tradeCount ? excursions : undefined;

  if (
    tradeCount === 0
    || !Number.isSafeInteger(runs)
    || runs <= 0
    || !(Number.isFinite(initialCapital) && initialCapital > 0)
  ) {
    return emptySimulationResult();
  }

  let completedRuns = 0;
  const progressStep = Math.max(1, Math.ceil(runs / 100));
  const notifyProgress = (): void => {
    if (options.signal?.aborted) {
      throw new BacktestSimulationCancelledError(completedRuns, runs);
    }
    options.onProgress?.(Object.freeze({
      completedRuns,
      totalRuns: runs,
      fraction: completedRuns / runs,
    }));
    // A progress callback may synchronously flip a mutable signal. Check it
    // again so cancellation at the final progress event cannot publish a
    // result that the caller has already superseded.
    if (options.signal?.aborted) {
      throw new BacktestSimulationCancelledError(completedRuns, runs);
    }
  };
  notifyProgress();

  const random = createMulberry32(seed);
  const bandIndices = sampledPathIndices(tradeCount);
  const sampledPaths = bandIndices.map(() => new Float64Array(runs));
  const pathBuffer = new Float64Array(tradeCount + 1);
  const finals: number[] = [];
  const maxDrawdowns: number[] = [];
  const maxDrawdownsAbs: number[] = [];
  const openMaxDrawdowns: number[] = [];
  const openMaxDrawdownsAbs: number[] = [];
  const longestLosingStreak: number[] = [];
  const maxDrawdownDuration: number[] = [];
  const recoveryDuration: number[] = [];

  // The reference deliberately keeps this working order between Shuffle
  // runs. Resample overwrites every position on every run.
  const workingDeltas = deltas.slice();
  const workingMae = validExcursions ? validExcursions.mae.slice() : undefined;
  const variedDeltas = Array<number>(tradeCount);
  const variedMae = workingMae ? Array<number>(tradeCount) : undefined;

  for (let run = 0; run < runs; run += 1) {
    if (mode === 'shuffle') {
      for (let index = tradeCount - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        const delta = workingDeltas[index];
        workingDeltas[index] = workingDeltas[swapIndex];
        workingDeltas[swapIndex] = delta;
        if (workingMae) {
          const mae = workingMae[index];
          workingMae[index] = workingMae[swapIndex];
          workingMae[swapIndex] = mae;
        }
      }
    } else {
      for (let index = 0; index < tradeCount; index += 1) {
        const sampleIndex = Math.floor(random() * tradeCount);
        workingDeltas[index] = deltas[sampleIndex];
        if (workingMae && validExcursions) {
          workingMae[index] = validExcursions.mae[sampleIndex];
        }
      }
    }

    if (appliesVariation) {
      for (let index = 0; index < tradeCount; index += 1) {
        const delta = workingDeltas[index];
        const factor = 1 + laplaceNoise(random, variation);
        const varied = delta * factor;
        variedDeltas[index] = preserveWinLoss
          ? Math.sign(delta) * Math.abs(varied)
          : varied;
        if (variedMae && workingMae) variedMae[index] = workingMae[index] * Math.abs(factor);
      }
    }

    // Inline the path copy optimization while preserving the public walk's
    // immutable return contract. This is the only hot loop in this module.
    const walk = walkEquityInto(
      appliesVariation ? variedDeltas : workingDeltas,
      initialCapital,
      appliesVariation ? variedMae : workingMae,
      pathBuffer,
    );
    for (let index = 0; index < bandIndices.length; index += 1) {
      sampledPaths[index][run] = walk.path[bandIndices[index]];
    }
    finals.push(walk.final);
    maxDrawdowns.push(walk.maxDrawdown);
    maxDrawdownsAbs.push(walk.maxDrawdownAbs);
    openMaxDrawdowns.push(walk.openMaxDrawdown);
    openMaxDrawdownsAbs.push(walk.openMaxDrawdownAbs);
    longestLosingStreak.push(walk.longestLosingStreak);
    maxDrawdownDuration.push(walk.maxDrawdownDuration);
    recoveryDuration.push(walk.recoveryDuration);
    completedRuns = run + 1;
    if (completedRuns % progressStep === 0 || completedRuns === runs) notifyProgress();
  }

  const bands = {
    index: bandIndices,
    p5: [] as number[],
    p25: [] as number[],
    p50: [] as number[],
    p75: [] as number[],
    p95: [] as number[],
  };
  for (const sampledPath of sampledPaths) {
    sampledPath.sort();
    bands.p5.push(linearPercentileSorted(sampledPath, 0.05));
    bands.p25.push(linearPercentileSorted(sampledPath, 0.25));
    bands.p50.push(linearPercentileSorted(sampledPath, 0.5));
    bands.p75.push(linearPercentileSorted(sampledPath, 0.75));
    bands.p95.push(linearPercentileSorted(sampledPath, 0.95));
  }

  const sortedFinals = [...finals].sort((left, right) => left - right);
  const sortedDrawdowns = [...maxDrawdowns].sort((left, right) => left - right);
  return Object.freeze({
    bands: freezeBands(bands),
    finals: freezeNumbers(finals),
    maxDrawdowns: freezeNumbers(maxDrawdowns),
    maxDrawdownsAbs: freezeNumbers(maxDrawdownsAbs),
    openMaxDrawdowns: freezeNumbers(openMaxDrawdowns),
    openMaxDrawdownsAbs: freezeNumbers(openMaxDrawdownsAbs),
    probProfit: finals.filter((value) => value > 0).length / runs,
    medianFinal: linearPercentileSorted(sortedFinals, 0.5),
    p5Final: linearPercentileSorted(sortedFinals, 0.05),
    p95Final: linearPercentileSorted(sortedFinals, 0.95),
    p95Drawdown: linearPercentileSorted(sortedDrawdowns, 0.95),
    p99Drawdown: linearPercentileSorted(sortedDrawdowns, 0.99),
    streaks: freezeStreaks({
      longestLosingStreak,
      maxDrawdownDuration,
      recoveryDuration,
    }),
  });
}

/** Internal allocation-free equivalent of walkBacktestEquity. */
function walkEquityInto(
  deltas: readonly number[],
  initialCapital: number,
  mae: readonly number[] | undefined,
  path: Float64Array,
): Omit<BacktestEquityWalk, 'path'> & { readonly path: Float64Array } {
  const tradeCount = deltas.length;
  path[0] = 0;
  const calculatesDrawdown = Number.isFinite(initialCapital) && initialCapital > 0;
  let cumulative = 0;
  let peakEquity = initialCapital;
  let peakIndex = 0;
  let maxDrawdown = 0;
  let maxDrawdownAbs = 0;
  let deepestPeakIndex = 0;
  let deepestTroughIndex = 0;
  let openMaxDrawdown = 0;
  let openMaxDrawdownAbs = 0;
  let currentLosingStreak = 0;
  let longestLosingStreak = 0;

  for (let index = 0; index < tradeCount; index += 1) {
    const delta = deltas[index];

    if (calculatesDrawdown) {
      const candidateMae = mae?.[index];
      const adverseExcursion = typeof candidateMae === 'number' && Number.isFinite(candidateMae)
        ? candidateMae
        : Math.max(0, -delta);
      const openDrawdownAbs = peakEquity - (initialCapital + cumulative - adverseExcursion);
      if (openDrawdownAbs > openMaxDrawdownAbs) openMaxDrawdownAbs = openDrawdownAbs;
      const openDrawdown = openDrawdownAbs / peakEquity;
      if (openDrawdown > openMaxDrawdown) openMaxDrawdown = openDrawdown;
    }

    cumulative += delta;
    path[index + 1] = cumulative;

    if (calculatesDrawdown) {
      const equity = initialCapital + cumulative;
      if (equity > peakEquity) {
        peakEquity = equity;
        peakIndex = index + 1;
      }
      const drawdownAbs = peakEquity - equity;
      if (drawdownAbs > maxDrawdownAbs) maxDrawdownAbs = drawdownAbs;
      const drawdown = drawdownAbs / peakEquity;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        deepestPeakIndex = peakIndex;
        deepestTroughIndex = index + 1;
      }
      if (drawdownAbs > openMaxDrawdownAbs) openMaxDrawdownAbs = drawdownAbs;
      if (drawdown > openMaxDrawdown) openMaxDrawdown = drawdown;
    }

    currentLosingStreak = delta < 0 ? currentLosingStreak + 1 : 0;
    if (currentLosingStreak > longestLosingStreak) longestLosingStreak = currentLosingStreak;
  }

  let recovered = maxDrawdown === 0;
  let recoveryDuration = 0;
  if (maxDrawdown > 0) {
    const priorPeak = path[deepestPeakIndex];
    let recoveryIndex = deepestTroughIndex + 1;
    while (recoveryIndex <= tradeCount && path[recoveryIndex] < priorPeak) recoveryIndex += 1;
    recovered = recoveryIndex <= tradeCount;
    recoveryDuration = (recovered ? recoveryIndex : tradeCount) - deepestTroughIndex;
  }

  return {
    path,
    final: cumulative,
    maxDrawdown,
    maxDrawdownAbs,
    openMaxDrawdown,
    openMaxDrawdownAbs,
    longestLosingStreak,
    maxDrawdownDuration: deepestTroughIndex - deepestPeakIndex,
    recoveryDuration,
    recovered,
  };
}
