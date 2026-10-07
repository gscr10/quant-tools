import type { Vela } from '@luxalgo/vela';

/**
 * Vela 0.7.7 bounds native pan/zoom to loaded candles; it does not request older
 * candles when a pointer reaches that boundary. Connect deliberate gestures to
 * the public depth-only backfill API. Viewport events alone MUST NOT fetch:
 * initial ALL, resize, linked cells and transaction focus also emit them.
 */
export function installGestureHistory(
  chart: Vela,
  host?: HTMLElement,
  pageBars = 2_000,
  isOffline: () => boolean = () => chart.market?.offline ?? false,
): {
  reset(): void;
  dispose(): void;
} {
  let disposed = false;
  let generation = 0;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let history: { oldest: number; loaded: number; exhausted: boolean; failed: boolean } | null = null;
  let pointer: { id: number; x: number; y: number } | null = null;
  const clearTimer = (): void => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
  const reset = (): void => {
    generation += 1;
    pending = false;
    history = null;
    pointer = null;
    clearTimer();
  };
  if (!host?.addEventListener) return { reset, dispose: () => { disposed = true; reset(); } };

  const stopHistory = chart.on('history:complete', event => {
    history = {
      oldest: event.oldestTime,
      loaded: event.barsLoaded,
      exhausted: event.reason === 'genesis' || event.reason !== 'aborted' && event.barsLoaded < (chart.market?.bars ?? pageBars),
      failed: event.reason === 'aborted',
    };
  });
  const cancelDrawing = (): void => { pointer = null; clearTimer(); };
  const stopDrawing = chart.on('drawing:edited', cancelDrawing);
  const stopDraft = chart.on('drawing:draft', cancelDrawing);
  const stopSelection = chart.on('drawing:selected', event => { if (event.id) cancelDrawing(); });

  const requestOlder = (): void => {
    timer = undefined;
    const market = chart.market;
    const range = chart.getVisibleRange();
    if (disposed || pending || isOffline() || !history || history.exhausted || history.failed || history.loaded === 0 || !range) return;
    // getVisibleRange is clipped to actual candles. Reaching its oldest edge
    // is the evidence that this user gesture needs data outside the window.
    // Native zoom leaves a small bounded right margin and rounds candle
    // endpoints during animation. Allow its final few candles, never an
    // arbitrary time span inherited from another resolution.
    const edgeTolerance = Math.max(1, (range.to - range.from) / Math.max(1, history.loaded - 1)) * 8;
    if (range.from > history.oldest + edgeTolerance) return;
    const depth = Math.max(history.loaded, market.bars ?? 0) + pageBars;
    if (!Number.isSafeInteger(depth)) return;
    // Invoke the installed public wrapper (including the history observer).
    // It synchronously resets this policy; capture ownership AFTER that reset.
    const attempt = chart.setMarket({ bars: depth });
    const requestGeneration = generation;
    pending = true;
    void attempt.then(async () => {
      if (!disposed && generation === requestGeneration) await chart.historyComplete();
    }).catch(() => {
      // Provider/history observers retain the visible error and Retry state.
      // Never convert failure into genesis or silently repeat a failed page.
    }).finally(() => {
      if (generation === requestGeneration) pending = false;
    });
  };
  const schedule = (): void => {
    if (pending) return;
    clearTimer();
    // One finite page per gesture/burst, after Vela has applied native input.
    // No viewport/history callback recursively starts another page.
    timer = setTimeout(requestOlder, 180);
  };
  const isPlot = (event: MouseEvent): boolean => {
    if (!event.isTrusted || chart.drawings?.getTool() || chart.drawings?.getMode()) return false;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return false;
    const plot = target.tagName === 'CANVAS' ? target.parentElement : target;
    if (!plot?.querySelector(':scope > canvas') || !host.contains(plot)) return false;
    const rect = plot.getBoundingClientRect();
    const gutter = Number.parseFloat(getComputedStyle(plot).getPropertyValue('--vela-scale-gutter')) || 0;
    return event.clientX < rect.right - gutter && event.clientY < rect.bottom - 24;
  };
  const down = (event: PointerEvent): void => {
    if (pointer || !event.isPrimary || event.button !== 0 || !isPlot(event)) {
      pointer = null;
      return;
    }
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const up = (event: PointerEvent): void => {
    const start = pointer;
    pointer = null;
    if (!start || event.pointerId !== start.id || !event.isTrusted) return;
    const dx = event.clientX - start.x;
    if (dx >= 16 && dx > Math.abs(event.clientY - start.y) * 1.5) schedule();
  };
  const cancel = (): void => { pointer = null; };
  const wheel = (event: WheelEvent): void => {
    if (!isPlot(event)) return;
    const pan = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : null;
    if (pan !== null ? pan < 0 : event.deltaY > 0) schedule();
  };
  host.addEventListener('pointerdown', down, true);
  host.addEventListener('pointerup', up);
  host.addEventListener('pointercancel', cancel);
  host.addEventListener('wheel', wheel, { passive: true });
  return {
    reset,
    dispose: () => {
      disposed = true;
      reset();
      stopHistory(); stopDrawing(); stopDraft(); stopSelection();
      host.removeEventListener('pointerdown', down, true);
      host.removeEventListener('pointerup', up);
      host.removeEventListener('pointercancel', cancel);
      host.removeEventListener('wheel', wheel);
    },
  };
}
