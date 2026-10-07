export interface ProbeSample {
  readonly t1: number;
  readonly t2: number;
  readonly t3: number;
  readonly t4: number;
}

export interface ClockFit {
  readonly offsetSeconds: number;
  readonly driftPpm: number;
  readonly uncertaintySeconds: number;
  readonly confidence: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new RangeError("median requires at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function probeOffset(sample: ProbeSample): { offsetSeconds: number; rttSeconds: number } {
  const offset = ((sample.t2 - sample.t1) + (sample.t3 - sample.t4)) / 2;
  const rtt = (sample.t4 - sample.t1) - (sample.t3 - sample.t2);
  if (!Number.isFinite(offset) || !Number.isFinite(rtt) || rtt < 0) {
    throw new RangeError("invalid clock probe sample");
  }
  return { offsetSeconds: offset, rttSeconds: rtt };
}

export function estimateClock(samples: readonly ProbeSample[]): ClockFit {
  if (samples.length < 3) {
    throw new RangeError("at least 3 probe samples are required");
  }

  const derived = samples.map(probeOffset);
  const rtts = derived.map((x) => x.rttSeconds);
  const minRtt = Math.min(...rtts);
  const filtered = derived.filter((x) => x.rttSeconds <= minRtt + Math.max(0.002, minRtt * 0.25));

  const offsets = filtered.map((x) => x.offsetSeconds);
  const offsetSeconds = median(offsets);
  const deviations = offsets.map((x) => Math.abs(x - offsetSeconds));
  const mad = median(deviations);
  const uncertaintySeconds = Math.max(0.0005, 1.4826 * mad + minRtt / 2);

  const times = samples.map((s) => (s.t1 + s.t4) / 2);
  const centeredT = times.map((t) => t - median(times));
  const centeredO = samples.map(probeOffset).map((x) => x.offsetSeconds - offsetSeconds);
  const denominator = centeredT.reduce((sum, t) => sum + t * t, 0);
  const numerator = centeredT.reduce((sum, t, i) => sum + t * centeredO[i], 0);
  const driftRate = denominator > 0 ? numerator / denominator : 0;

  const confidence = Math.max(
    0,
    Math.min(1, (filtered.length / samples.length) * (1 / (1 + uncertaintySeconds * 1000))),
  );

  return {
    offsetSeconds,
    driftPpm: driftRate * 1e6,
    uncertaintySeconds,
    confidence,
  };
}
