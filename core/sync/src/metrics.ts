import { PlaybackObservation, SyncMetrics } from "./types";

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) return sorted[lower]!;

  const weight = index - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * weight;
}

export function computeSyncMetrics(
  observations: readonly PlaybackObservation[],
  targetPositionSeconds: number,
): SyncMetrics {
  if (observations.length === 0) {
    return {
      minPositionSeconds: 0,
      maxPositionSeconds: 0,
      p50Seconds: 0,
      p90Seconds: 0,
      p95Seconds: 0,
      p99Seconds: 0,
      maxErrorSeconds: 0,
      sampleCount: 0,
    };
  }

  const positions = observations.map((o) => o.positionSeconds);
  const errors = positions.map((p) => Math.abs(p - targetPositionSeconds));

  return {
    minPositionSeconds: Math.min(...positions),
    maxPositionSeconds: Math.max(...positions),
    p50Seconds: percentile(errors, 0.5),
    p90Seconds: percentile(errors, 0.9),
    p95Seconds: percentile(errors, 0.95),
    p99Seconds: percentile(errors, 0.99),
    maxErrorSeconds: Math.max(...errors),
    sampleCount: observations.length,
  };
}

export function positionRangeSeconds(
  observations: readonly PlaybackObservation[],
): number {
  if (observations.length < 2) return 0;

  const positions = observations.map((o) => o.positionSeconds);
  return Math.max(...positions) - Math.min(...positions);
}
