export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function syntheticBars(count = 1500, start = 64000, stepMs = 3_600_000): Bar[] {
  const rand = mulberry32(42);
  const bars: Bar[] = [];
  const openTime = Date.UTC(2024, 5, 3);
  let close = start;
  for (let i = 0; i < count; i++) {
    const trend = Math.sin(i / 90) * 55 + Math.sin(i / 17) * 18;
    const shock = (rand() - 0.5) * 2 * 240;
    const open = close;
    close = Math.max(1000, open + trend * 0.25 + shock);
    const wick = Math.abs(shock) + 20 + rand() * 140;
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volume = Math.round(400 + rand() * 2600 + Math.abs(shock) * 3);
    bars.push({ time: openTime + i * stepMs, open, high, low, close, volume });
  }
  return bars;
}
