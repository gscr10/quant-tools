import type { Vela } from '@luxalgo/vela';

const onlineReloads = new WeakSet<Vela>();

/** Explicit host intent, never inferred from a caller's empty inline dataset. */
export function isOnlineHistoryReload(chart: Vela): boolean {
  return onlineReloads.has(chart);
}

/** Vela needs data:[] to force a same-market load. Mark only this application
 * Retry call as online; arbitrary setMarket({data:[]}) remains an inline EMPTY
 * contract for the timeframe/gesture policy. The mark is synchronous and does
 * not leak across pending loads, other cells, exceptions or later calls. */
export function reloadOnlineHistory(chart: Vela, bars: number): Promise<void> {
  const nested = onlineReloads.has(chart);
  onlineReloads.add(chart);
  try {
    return chart.setMarket({ bars, data: [] });
  } finally {
    if (!nested) onlineReloads.delete(chart);
  }
}
