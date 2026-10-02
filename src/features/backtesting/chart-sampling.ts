import type {
  ReportChartDataPoint,
  ReportChartRangePoint,
} from './highcharts-renderer.ts';

/**
 * A deterministic, shape-preserving sampler for report charts.
 *
 * The report still owns the complete point series (and can expose it to the
 * tooltip adapter), while the SVG/Highcharts render path only receives a
 * bounded number of points.  Keeping the first/last point and each bucket's
 * extrema prevents a narrow spike or a terminal value from disappearing.
 */
export function downsampleReportChartPoints<T extends ReportChartDataPoint>(
  points: readonly T[],
  maxPoints = 2_000,
): T[] {
  // Treat malformed budgets as an explicit request to keep the source.  The
  // previous `Math.floor(NaN)` path produced a NaN bucket count and could make
  // a defensive caller spin forever; an infinite budget is likewise already
  // satisfied by the unbounded source.
  if (!Number.isFinite(maxPoints) || maxPoints < 3 || points.length <= maxPoints) {
    return [...points];
  }
  const target = Math.max(3, Math.floor(maxPoints));
  const interior = points.length - 2;
  const bucketCount = Math.max(1, Math.floor((target - 2) / 2));
  const bucketSize = interior / bucketCount;
  const selected = new Set<number>([0, points.length - 1]);
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(points.length - 1, 1 + Math.floor((bucket + 1) * bucketSize));
    if (end <= start) continue;
    let lowIndex = start;
    let highIndex = start;
    let low = pointLow(points[start]);
    let high = pointHigh(points[start]);
    for (let index = start + 1; index < end; index += 1) {
      const candidateLow = pointLow(points[index]);
      const candidateHigh = pointHigh(points[index]);
      if (candidateLow < low) {
        low = candidateLow;
        lowIndex = index;
      }
      if (candidateHigh > high) {
        high = candidateHigh;
        highIndex = index;
      }
    }
    selected.add(lowIndex);
    selected.add(highIndex);
  }
  return [...selected].sort((left, right) => left - right).map((index) => points[index]);
}

/** Return the closest raw point for a rendered point's x coordinate. */
export function nearestReportChartPoint(
  points: readonly ReportChartDataPoint[] | undefined,
  x: number,
): ReportChartDataPoint | undefined {
  if (!points || points.length === 0 || !Number.isFinite(x)) return undefined;
  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = points[middle].x;
    if (value === x) return points[middle];
    if (value < x) low = middle + 1;
    else high = middle - 1;
  }
  const right = points[Math.min(points.length - 1, low)];
  const left = points[Math.max(0, low - 1)];
  return Math.abs(right.x - x) < Math.abs(left.x - x) ? right : left;
}

function pointLow(point: ReportChartDataPoint): number {
  if (isRangePoint(point)) return Number.isFinite(point.low) ? point.low : 0;
  return Number.isFinite(point.y) ? point.y : 0;
}

function pointHigh(point: ReportChartDataPoint): number {
  if (isRangePoint(point)) return Number.isFinite(point.high) ? point.high : 0;
  return Number.isFinite(point.y) ? point.y : 0;
}

function isRangePoint(point: ReportChartDataPoint): point is ReportChartRangePoint {
  return 'low' in point && 'high' in point;
}
