import { timeframeToMs } from '@luxalgo/vela';
import type { VelaWorkspace } from '@luxalgo/vela/workspace';
import type { BacktestExecutionFocus } from '../../domain/ports/workspace-port.ts';

/**
 * The native Vela renderer exposes a public `highlights` feature: a list of
 * time bands painted behind the candles.  It is the only public, renderer
 * agnostic way to make a located fill stand out.  Keep the band deliberately
 * translucent so the real strategy trade marker remains visible above it.
 *
 * This is a chart-level highlight, not a claim that Vela selected an internal
 * trade marker.  Vela 0.7.x does not expose a marker-id selection API; callers
 * still get the exact crosshair/price line through `setExternalCrosshair`.
 */
const ENTRY_HIGHLIGHT_COLOR = 'rgba(37, 99, 235, 0.18)';
const EXIT_HIGHLIGHT_COLOR = 'rgba(239, 68, 68, 0.18)';

interface HighlightBand {
  readonly from: number;
  readonly to: number;
  readonly color: string;
}

/** The last band installed for each cell, so a second locate replaces it. */
const activeTradeHighlights = new WeakMap<VelaWorkspace, Map<string, HighlightBand>>();

function isHighlightBand(value: unknown): value is HighlightBand {
  if (!value || typeof value !== 'object') return false;
  const band = value as Partial<HighlightBand>;
  const from = band.from;
  const to = band.to;
  return typeof from === 'number'
    && typeof to === 'number'
    && Number.isFinite(from)
    && Number.isFinite(to)
    && to > from
    && typeof band.color === 'string';
}

function sameHighlight(a: HighlightBand, b: HighlightBand): boolean {
  return a.from === b.from && a.to === b.to && a.color === b.color;
}

/**
 * Add a narrow public highlight band for the located execution.  Unsupported
 * renderers simply skip this step; range/crosshair focus remains useful on
 * those backends.  Reading the existing feature before writing it preserves
 * host-provided highlight bands (for example session shading).
 */
function highlightExecution(
  workspace: VelaWorkspace,
  cellId: string,
  timeframe: string,
  input: BacktestExecutionFocus,
): void {
  const chart = workspace.cell(cellId)?.chart;
  if (!chart) return;
  const renderer = chart.renderer;
  if (typeof renderer.supports !== 'function'
    || !renderer.supports('highlights')
    || typeof renderer.get !== 'function'
    || typeof renderer.set !== 'function') return;

  const duration = timeframeToMs(timeframe);
  const to = input.time <= Number.MAX_SAFE_INTEGER - duration
    ? input.time + duration
    : input.time;
  if (!Number.isFinite(input.time) || !Number.isFinite(to) || to <= input.time) return;

  const previous = activeTradeHighlights.get(workspace)?.get(cellId);
  const current = renderer.get('highlights');
  const bands = Array.isArray(current)
    ? current.filter(isHighlightBand).map((band) => ({
      from: band.from,
      to: band.to,
      color: band.color,
    }))
    : [];
  const retained = previous === undefined
    ? bands
    : bands.filter((band) => !sameHighlight(band, previous));
  const band: HighlightBand = {
    from: input.time,
    to,
    color: input.side === 'entry' ? ENTRY_HIGHLIGHT_COLOR : EXIT_HIGHLIGHT_COLOR,
  };
  renderer.set('highlights', [...retained, band]);

  let byCell = activeTradeHighlights.get(workspace);
  if (!byCell) {
    byCell = new Map();
    activeTradeHighlights.set(workspace, byCell);
  }
  byCell.set(cellId, band);
}

/**
 * Public Vela chart seam used by the Backtesting feature's locate controls.
 * Keeping this in a narrow integration module makes it testable without
 * loading the application's `.pine` manifest and prevents feature code from
 * reaching into renderer internals.
 */
export function focusBacktestExecution(
  workspace: VelaWorkspace,
  input: BacktestExecutionFocus,
): boolean {
  const cell = workspace.cell(input.cellId);
  if (!cell || !Number.isFinite(input.time)) return false;

  workspace.setActiveCell(input.cellId);
  const current = cell.chart.getVisibleRange();
  const span = current && current.to > current.from
    ? current.to - current.from
    : 86_400_000;
  const half = Math.max(span * 0.35, 60_000);
  cell.chart.setVisibleRange({ from: input.time - half, to: input.time + half });
  if (cell.chart.renderer.supportsExternalCrosshair) {
    cell.chart.renderer.setExternalCrosshair(input.time, input.price ?? null);
  }
  highlightExecution(workspace, input.cellId, cell.timeframe, input);
  cell.focus();
  return true;
}
