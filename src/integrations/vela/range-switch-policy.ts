import { timeframeToMs, type Vela } from '@luxalgo/vela';
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace';

/** The shape used by Vela's public `ChartCell.applyRange` seam. */
export interface WorkspaceRangePreset {
  readonly id: string;
  readonly preset: '1D' | '1W' | '1M' | '3M' | '6M' | '1Y' | '5Y' | 'YTD' | 'ALL';
  readonly bars?: number;
  /** Native Vela supplies this, but the policy deliberately ignores it. */
  readonly tf?: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const RANGE_SPANS: Readonly<Record<WorkspaceRangePreset['preset'], number | null>> = {
  '1D': DAY_MS,
  '1W': 7 * DAY_MS,
  '1M': 30 * DAY_MS,
  '3M': 90 * DAY_MS,
  '6M': 180 * DAY_MS,
  '1Y': 365 * DAY_MS,
  '5Y': 5 * 365 * DAY_MS,
  YTD: null,
  ALL: null,
};

function currentYearStart(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), 0, 1);
}

/**
 * Return the number of bars needed to display a named range at the chart's
 * current resolution. The native bottombar pairs each chip with a finer
 * resolution (1D→1m, 7D→5m, ...), which is useful for the reference product
 * but changes the user's selected timeframe. Quant keeps the selected
 * resolution and expands history only when the requested window needs it.
 */
export function rangeBarsForTimeframe(
  preset: Pick<WorkspaceRangePreset, 'preset' | 'bars'>,
  timeframe: string,
  now = Date.now(),
): number | undefined {
  if (preset.preset === 'ALL') {
    // ALL means all history currently requested by the chart. Vela's native
    // chip asks for 5,000 bars; preserve that useful upper bound while keeping
    // an already deeper user request intact in the caller.
    return Math.max(5_000, preset.bars ?? 0);
  }
  const tfMs = timeframeToMs(timeframe);
  if (!Number.isFinite(tfMs) || tfMs <= 0) return undefined;
  const from = preset.preset === 'YTD'
    ? currentYearStart(now)
    : now - (RANGE_SPANS[preset.preset] ?? DAY_MS);
  const span = Math.max(tfMs, now - from);
  // Include a small boundary margin. Vela's named preset is inclusive and the
  // latest bar can be an in-progress candle, so truncating at exactly span/tf
  // can leave the left edge one bar short.
  return Math.max(1, Math.ceil(span / tfMs) + 2);
}

type CellWithRange = Pick<ChartCell, 'chart' | 'applyRange'> & {
  timeframe: string;
  activeRangeId: string | null;
};

/**
 * Install the product range contract on every workspace cell. Bottom chips
 * frame a date window without changing the top-left timeframe. If that window
 * is deeper than the loaded tail, only `bars` is increased; the existing
 * timeframe switch policy therefore leaves the chart resolution untouched.
 */
export function installDateRangePolicy(workspace: VelaWorkspace): () => void {
  const originals = new Map<ChartCell, ChartCell['applyRange']>();
  type RangeRequest = {
    readonly generation: number;
    readonly preset: WorkspaceRangePreset;
    readonly requested: number | undefined;
    readonly shouldLoad: boolean;
    readonly symbol: string | undefined;
    readonly timeframe: string;
  };
  type RangeState = {
    generation: number;
    framedGeneration: number;
    current: RangeRequest | undefined;
    pending: RangeRequest | undefined;
    inFlight: Promise<void> | undefined;
    drainScheduled: boolean;
    drainTimer: ReturnType<typeof setTimeout> | undefined;
    disposed: boolean;
    offMarket: () => void;
  };
  const states = new WeakMap<object, RangeState>();
  let disposed = false;

  const bind = (candidate: ChartCell): void => {
    if (disposed || originals.has(candidate)) return;
    const cell = candidate as unknown as CellWithRange;
    const original = candidate.applyRange;
    if (typeof original !== 'function') return;
    originals.set(candidate, original);
    const state: RangeState = {
      generation: 0,
      framedGeneration: 0,
      current: undefined,
      pending: undefined,
      inFlight: undefined,
      drainScheduled: false,
      drainTimer: undefined,
      disposed: false,
      offMarket: () => {},
    };
    states.set(candidate, state);

    // A topbar symbol/timeframe switch is an identity change, whereas the
    // depth-only setMarket used by this policy is not. Invalidate any pending
    // date-range request only for the former so an old 5Y completion cannot
    // reframe a newly selected 1m chart.
    state.offMarket = typeof candidate.chart?.on === 'function'
      ? candidate.chart.on('market:changed', () => {
        if (state.disposed || disposed) return;
        state.generation += 1;
        state.current = undefined;
        state.pending = undefined;
        state.framedGeneration = 0;
        if (state.drainTimer !== undefined) clearTimeout(state.drainTimer);
        state.drainTimer = undefined;
        state.drainScheduled = false;
        cell.activeRangeId = null;
      })
      : () => {};

    const frame = (request: RangeRequest): void => {
      if (disposed || state.disposed || state.current?.generation !== request.generation) return;
      const market = candidate.chart.market;
      if (market?.symbol !== request.symbol || market?.timeframe !== request.timeframe) return;
      if (state.framedGeneration === request.generation) return;
      state.framedGeneration = request.generation;
      chartFor(candidate).setVisibleRangePreset(request.preset.preset);
    };
    const drain = async (): Promise<void> => {
      state.drainScheduled = false;
      if (disposed || state.disposed || state.inFlight) return;
      const request = state.pending;
      if (!request) return;
      state.pending = undefined;
      const chart = chartFor(candidate);
      // Another click may have made the requested window fit in the already
      // loaded tail while this request was queued. Frame it without issuing a
      // second history load.
      const loaded = Number(chart.market?.bars ?? 0);
      if (request.requested === undefined || request.requested <= loaded || chart.market?.offline) {
        frame(request);
        return;
      }

      // Keep at most one ranged setMarket in flight. Vela merges concurrent
      // setMarket calls and the largest request can otherwise win the market
      // depth even when the user has already selected a smaller final range.
      let operation: Promise<void>;
      try {
        operation = chart.setMarket({
          bars: request.requested,
          visibleRange: request.preset.preset,
        });
      } catch {
        // Keep a synchronous host failure inside the chart's normal error
        // surface and let a newer queued selection proceed.
        const latest = state.current;
        if (latest && latest.generation !== request.generation) {
          if (latest.shouldLoad) state.pending = latest;
          else frame(latest);
        }
        if (state.pending) scheduleDrain(state, drain);
        return;
      }
      state.inFlight = operation;
      try {
        await operation;
        // A ranged setMarket resolves after the first head paint while Vela
        // continues deep backfill behind it. Re-frame only after that per-load
        // history promise settles; otherwise the late backfill resets the
        // renderer to its default latest-tail viewport.
        await chart.historyComplete?.();
        frame(request);
      } catch {
        // The chart's own history error surface remains authoritative. A newer
        // queued click is still drained below; the failed stale request cannot
        // overwrite that selection.
      } finally {
        if (state.inFlight === operation) state.inFlight = undefined;
        const latest = state.current;
        if (latest && latest.generation !== request.generation) {
          if (latest.shouldLoad) state.pending = latest;
          else frame(latest);
        }
        if (state.pending) scheduleDrain(state, drain);
      }
    };
    const wrapped = function (this: ChartCell, preset: WorkspaceRangePreset): void {
      if (disposed || state.disposed) return;
      const chart = chartFor(candidate);
      const generation = ++state.generation;
      // Keep the chip's selected state in the public cell mirror. The native
      // implementation does this before issuing its timeframe switch.
      cell.activeRangeId = preset.id;

      const requested = rangeBarsForTimeframe(preset, cell.timeframe);
      const loaded = Number(chart.market?.bars ?? 0);
      const shouldLoad = requested !== undefined && requested > loaded && !chart.market?.offline;
      const request: RangeRequest = {
        generation,
        preset,
        requested,
        shouldLoad,
        symbol: chart.market?.symbol,
        timeframe: cell.timeframe,
      };
      state.current = request;
      if (!shouldLoad) {
        state.pending = undefined;
        frame(request);
        return;
      }

      // Keep the current timeframe: omitting `timeframe` is intentional. The
      // wrapper is also safe for a native preset that has no `tf` field.
      state.pending = request;
      scheduleDrain(state, drain);
    };
    candidate.applyRange = wrapped;
  };

  const unbind = (candidate: ChartCell): void => {
    const original = originals.get(candidate);
    if (!original) return;
    const state = states.get(candidate);
    if (state) {
      state.disposed = true;
      state.generation += 1;
      state.current = undefined;
      state.pending = undefined;
      if (state.drainTimer !== undefined) clearTimeout(state.drainTimer);
      state.drainTimer = undefined;
      state.drainScheduled = false;
      state.offMarket();
      state.offMarket = () => {};
    }
    if (candidate.applyRange !== original) candidate.applyRange = original;
    originals.delete(candidate);
  };

  const unbindDestroyedCells = (): void => {
    const live = new Set(workspace.cells());
    for (const cell of originals.keys()) {
      if (!live.has(cell)) unbind(cell);
    }
  };

  for (const cell of workspace.cells()) bind(cell);
  const offCreated = workspace.on('cell:created', ({ id }) => {
    const cell = workspace.cell(id);
    if (cell) bind(cell);
  });
  const offDestroyed = workspace.on('cell:destroyed', ({ id }) => {
    const cell = workspace.cell(id);
    if (cell) return;
    // The cell facade normally disappears before this event reaches the host;
    // remove its strong Map entry immediately so repeated layout changes do not
    // retain old charts until the whole Workspace is destroyed.
    unbindDestroyedCells();
  });
  const offLayout = workspace.on('layout:changed', () => {
    unbindDestroyedCells();
    for (const cell of workspace.cells()) bind(cell);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    offCreated();
    offDestroyed();
    offLayout();
    for (const cell of [...originals.keys()]) unbind(cell);
  };
}

function chartFor(candidate: ChartCell): Vela {
  return candidate.chart as Vela;
}

function scheduleDrain(state: {
  drainScheduled: boolean;
  drainTimer: ReturnType<typeof setTimeout> | undefined;
}, drain: () => Promise<void>): void {
  if (state.drainScheduled) return;
  state.drainScheduled = true;
  // Pointer clicks arrive in separate tasks. A short debounce lets a rapid
  // 5Y→3M sequence settle before Vela starts the potentially multi-million-bar
  // request for the first chip, while keeping a single click imperceptible.
  state.drainTimer = setTimeout(() => {
    state.drainTimer = undefined;
    void drain();
  }, 60);
}
