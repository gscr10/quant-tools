import { registerNativeIndicator, unregisterNativeIndicator, timeframeToMs } from '@luxalgo/vela';
import type { IndicatorHandle, NativeIndicatorContext } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import { BACKTEST_EXECUTION_HIGHLIGHT_TYPE, type BacktestExecutionFocus } from '../../domain/ports/workspace-port.ts';

const activeHighlights = new WeakMap<VelaWorkspace, () => void>();

/** Release the transient annotation before Workspace persistence/teardown. */
export function clearBacktestExecutionFocus(workspace: VelaWorkspace): void {
  activeHighlights.get(workspace)?.();
}

function highlightExecution(workspace: VelaWorkspace, input: BacktestExecutionFocus): void {
  const cell = workspace.cell(input.cellId);
  if (!cell) return;
  const chart = cell.chart;
  let handle: IndicatorHandle | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const unsubs: (() => void)[] = [];
  const clear = (): void => {
    if (closed) return;
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    for (const unsubscribe of unsubs) unsubscribe();
    if (activeHighlights.get(workspace) === cleanup) activeHighlights.delete(workspace);
    try {
      if (handle) {
        // Vela records raw native removals in the shell's undo stack. A timed
        // navigation annotation is not a user edit and must not consume Undo.
        if (cell.history) cell.history.silently(() => handle?.remove());
        else handle.remove();
      }
    } catch { /* Chart may already be gone. */ }
    try { chart.renderer.setExternalCrosshair(null); } catch { /* Optional renderer seam. */ }
  };
  const cleanup = (): void => clear();
  activeHighlights.set(workspace, cleanup);
  const direction = input.direction === 'short' ? 'Short' : input.direction === 'long' ? 'Long' : '';
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', month: 'short', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(input.time));
  const text = `Trade #${input.tradeNumber ?? ''} · ${direction} ${input.side}\n${date}`;
  // Vela captures the descriptor synchronously. Register it only for this
  // instance so the transient type never remains in the indicator catalog.
  registerNativeIndicator({
    type: BACKTEST_EXECUTION_HIGHLIGHT_TYPE,
    title: 'Backtest trade highlight',
    paneHint: 'price', overlay: true, legend: false, multiInstance: true,
    inputsSchema: () => [], defaultInputs: () => ({}),
    create: () => {
      let context: NativeIndicatorContext | null = null;
      const paint = (): void => {
        if (!context || closed) return;
        context.emit({ labels: [{
          id: 'backtest-trade-highlight', paneId: 'price', xloc: 'bar_time',
          x: input.time, y: input.price ?? 0, yloc: 'abovebar', text,
          style: 'label_down', color: '#2962ff', textColor: '#ffffff',
          size: 'small', textAlign: 'center', fontFamily: 'default', overlay: true,
        }], lines: [] });
        context.setStatus('idle');
      };
      return {
        start: (value) => { context = value; paint(); }, onBars: paint,
        onViewport: () => undefined, setInputs: () => undefined,
        suspend: () => undefined, resume: paint,
        stop: () => { context = null; clear(); },
      };
    },
  });
  try {
    handle = chart.addNativeIndicator(BACKTEST_EXECUTION_HIGHLIGHT_TYPE);
    unsubs.push(chart.on('load:start', cleanup), chart.on('market:changed', cleanup));
    unsubs.push(chart.on('indicator:removed', ({ id }) => { if (id === input.indicatorId) cleanup(); }));
    unsubs.push(workspace.on('cell:active', ({ id }) => { if (id !== input.cellId) cleanup(); }));
    timer = setTimeout(cleanup, 4_000);
  } catch {
    clear();
    // An unsupported annotation backend does not undo successful navigation.
  } finally {
    unregisterNativeIndicator(BACKTEST_EXECUTION_HIGHLIGHT_TYPE);
  }
}

/** Public chart navigation, bound to the market that produced the report. */
export function focusBacktestExecution(
  workspace: VelaWorkspace,
  input: BacktestExecutionFocus,
): boolean {
  const cell = workspace.cell(input.cellId);
  if (!cell || !Number.isFinite(input.time) || !Number.isFinite(new Date(input.time).getTime())) return false;
  const market = cell.chart.market;
  // market is the REQUESTED identity and changes before async history finishes.
  // The shell cell can still expose the old symbol during that interval.
  if (input.symbol !== undefined && input.symbol !== (market?.symbol ?? cell.symbol)) return false;
  if (input.timeframe !== undefined && input.timeframe !== (market?.timeframe ?? cell.timeframe)) return false;
  if (typeof cell.chart.indicators === 'function'
    && !cell.chart.indicators().some((handle) => handle.id === input.indicatorId)) return false;
  const half = 60 * timeframeToMs(market?.timeframe ?? cell.timeframe);
  if (!Number.isFinite(half) || half <= 0) return false;
  workspace.setActiveCell(input.cellId);
  // Navigate before mutating the previous execution annotation.  A chart
  // range failure must be transaction-like: it cannot clear the old marker
  // (which can trigger a Vela context/revision update) and then leave the
  // report changed even though no new location was applied.
  cell.chart.setVisibleRange({ from: input.time - half, to: input.time + half });
  clearBacktestExecutionFocus(workspace);
  highlightExecution(workspace, input);
  if (cell.chart.renderer.supportsExternalCrosshair) {
    try {
      cell.chart.renderer.setExternalCrosshair(input.time, Number.isFinite(input.price) ? input.price : null);
    } catch { /* Viewport and label still identify the execution. */ }
  }
  cell.focus();
  return true;
}
