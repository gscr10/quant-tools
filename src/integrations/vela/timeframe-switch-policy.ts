import type { Vela } from '@luxalgo/vela';
import type { ChartCell, VelaWorkspace } from '@luxalgo/vela/workspace';
import { installGestureHistory } from './history-gesture-policy.ts';
import { isOnlineHistoryReload } from './online-history-reload.ts';

type MarketSwitch = Parameters<Vela['setMarket']>[0];
type CellChart = Pick<ChartCell, 'chart'> & Partial<Pick<ChartCell, 'host'>>;

/**
 * Apply the product rule for an ordinary market/timeframe switch.
 *
 * Vela intentionally keeps caller supplied range/depth values for explicit
 * history requests. An ordinary timeframe or symbol switch with neither value
 * must start from the newest default-depth bars. Keeping this decision at the
 * integration boundary also covers Vela's topbar, mobile bar, workspace sync,
 * and host calls to `chart.setMarket` without changing the vendored package.
 */
export function normalizeDefaultMarketSwitch(
  current: (Pick<NonNullable<Vela['market']>, 'symbol' | 'timeframe' | 'session' | 'offline'> & {
    /** Vela may echo the currently loaded depth into an identity switch. */
    bars?: number;
  }) | null | undefined,
  next: MarketSwitch,
  defaultBars: number,
): MarketSwitch {
  // Inline data is an explicit, finite fixture supplied by the host. Do not
  // replace its depth or add a viewport preset that could hide its intended
  // window while switching an offline chart.
  if (next.data !== undefined || (current?.offline && next.symbol === undefined)) return next;
  const identityChanged =
    (next.symbol !== undefined && (!current || next.symbol !== current.symbol)) ||
    (next.timeframe !== undefined && (!current || next.timeframe !== current.timeframe)) ||
    (next.session !== undefined && (!current || next.session !== current.session));

  // A visible range or a *different* explicit bar count is a user request
  // (range chips, deep windows, shared links, or a host asking for a specific
  // depth). Vela's topbar internally echoes the current `bars` value when it
  // changes timeframe; that echoed value is not a deliberate depth request and
  // must not preserve a previous 6,000-bar backfill on the new timeframe.
  // Without this distinction, `setTimeframe()` after a deep-history gesture
  // silently bypasses the product rule of starting every new timeframe at the
  // newest default 2,000 bars.
  const echoedCurrentDepth = next.bars !== undefined
    && current?.bars !== undefined
    && next.bars === current.bars;
  if (!identityChanged || next.visibleRange !== undefined || (next.bars !== undefined && !echoedCurrentDepth)) {
    return next;
  }

  const bars = Number.isFinite(defaultBars) && defaultBars > 0
    ? Math.max(1, Math.trunc(defaultBars))
    : 2000;
  return { ...next, bars, visibleRange: 'ALL' };
}

/**
 * Install the default-depth switch policy on every current and future cell.
 * The wrapper is deliberately limited to the public `chart.setMarket` seam;
 * depth-only calls remain the user's explicit deep-history request and are
 * therefore allowed to paginate normally.
 */
export function installDefaultTimeframeSwitchPolicy(
  workspace: VelaWorkspace,
  defaultBars: number,
): () => void {
  const wrappedCharts = new Map<Vela, {
    original: Vela['setMarket'];
    wrapped: Vela['setMarket'];
    dispose: () => void;
  }>();
  let disposed = false;

  const bind = (cell: CellChart): void => {
    if (disposed) return;
    let chart: Vela;
    try {
      chart = cell.chart;
    } catch {
      return;
    }
    if (wrappedCharts.has(chart)) return;
    const original = chart.setMarket;
    if (typeof original !== 'function') return;
    let generation = 0;
    let frameAll = false;
    let framing = false;
    // Vela reports `offline` for any data property, including []. Our Retry
    // seam explicitly marks its forced ONLINE reload. A caller's arbitrary
    // inline [] must remain offline. Remember the host intent across the next
    // gesture/timeframe change without reading private market config.
    let emptyReload = false;
    const gestureHistory = installGestureHistory(chart, cell.host, defaultBars,
      () => !!chart.market?.offline && !emptyReload);
    const frame = (): void => {
      if (!frameAll || disposed) return;
      framing = true;
      try { chart.setVisibleRangePreset?.('ALL'); }
      finally { framing = false; }
    };
    const offViewport = typeof chart.on === 'function'
      ? chart.on('viewport:changed', () => {
        // A user's pan, zoom or explicit date/transaction focus takes ownership
        // of the view. Subsequent resizing must not undo that navigation.
        if (!framing) frameAll = false;
      })
      : () => {};
    const observer = cell.host && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(frame)
      : undefined;
    if (cell.host) observer?.observe(cell.host);
    const wrapped: Vela['setMarket'] = function (this: Vela, next: MarketSwitch) {
      const current = this.market;
      // Vela represents an explicit online retry as `data: []` and leaves the
      // resulting market marked offline until the first successful response.
      // Treat that one retry as online while normalizing the following request,
      // but keep the marker until an identity switch actually succeeds. This
      // prevents a failed switch from changing the next retry contract, while
      // allowing a successful timeframe/session switch to re-enable deliberate
      // history gestures on the new market.
      const wasEmptyReload = emptyReload;
      const effectiveMarket = current && wasEmptyReload ? { ...current, offline: false } : current;
      const adjusted = normalizeDefaultMarketSwitch(effectiveMarket, next, defaultBars);
      const identityChanged =
        (adjusted.symbol !== undefined && adjusted.symbol !== current?.symbol) ||
        (adjusted.timeframe !== undefined && adjusted.timeframe !== current?.timeframe) ||
        (adjusted.session !== undefined && adjusted.session !== current?.session);
      if (next.data !== undefined) emptyReload = next.data.length === 0 && isOnlineHistoryReload(this);
      const request = ++generation;
      frameAll = false;
      if (adjusted.data !== undefined ||
        adjusted.symbol !== undefined && adjusted.symbol !== current?.symbol ||
        adjusted.timeframe !== undefined && adjusted.timeframe !== current?.timeframe ||
        adjusted.session !== undefined && adjusted.session !== current?.session ||
        adjusted.bars !== undefined && adjusted.bars !== current?.bars) gestureHistory.reset();
      return original.call(this, adjusted).then(() => {
        if (identityChanged && wasEmptyReload) emptyReload = false;
        if (disposed || generation !== request || adjusted === next) return;
        // Keep an ordinary switch fitted through layout/mobile resizing until
        // the user navigates. Cold/restored and explicit-range views are not
        // opted in, and a superseded load cannot reclaim a newer viewport.
        frameAll = true;
        frame();
      });
    };
    chart.setMarket = wrapped;
    wrappedCharts.set(chart, {
      original,
      wrapped,
      dispose: () => { generation += 1; frameAll = false; observer?.disconnect(); offViewport(); gestureHistory.dispose(); },
    });
  };

  const unbind = (chart: Vela): void => {
    const record = wrappedCharts.get(chart);
    if (!record) return;
    record.dispose();
    if (chart.setMarket === record.wrapped) chart.setMarket = record.original;
    wrappedCharts.delete(chart);
  };

  for (const cell of workspace.cells()) bind(cell);
  const offCreated = workspace.on('cell:created', ({ id }) => {
    const cell = workspace.cell(id);
    if (cell) bind(cell);
  });
  const offDestroyed = workspace.on('cell:destroyed', ({ id }) => {
    const cell = workspace.cell(id);
    if (cell) return;
    // The cell facade is gone, so only an unreferenced chart can be removed by
    // matching the live chart list. This also handles a layout replacement.
    const live = new Set(workspace.cells().map((entry) => {
      try { return entry.chart; } catch { return null; }
    }));
    for (const chart of wrappedCharts.keys()) if (!live.has(chart)) unbind(chart);
  });
  const offLayout = workspace.on('layout:changed', () => {
    const live = new Set(workspace.cells().map((entry) => {
      try { return entry.chart; } catch { return null; }
    }));
    for (const cell of workspace.cells()) bind(cell);
    for (const chart of wrappedCharts.keys()) if (!live.has(chart)) unbind(chart);
  });

  return () => {
    if (disposed) return;
    disposed = true;
    offCreated();
    offDestroyed();
    offLayout();
    for (const chart of [...wrappedCharts.keys()]) unbind(chart);
  };
}
