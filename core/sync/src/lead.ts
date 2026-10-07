export interface SyncLeadInputs {
  readonly minimumLeadSeconds: number;
  readonly p99NetworkDelaySeconds: number;
  readonly clockUncertaintySeconds: number;
  readonly schedulingMarginSeconds: number;
}

export interface SyncTarget {
  readonly targetServerTimeSeconds: number;
  readonly targetPositionSeconds: number;
  readonly targetEpoch: number;
}

export function computeSyncLead(inputs: SyncLeadInputs): number {
  const values = [
    inputs.minimumLeadSeconds,
    inputs.p99NetworkDelaySeconds,
    inputs.clockUncertaintySeconds,
    inputs.schedulingMarginSeconds,
  ];

  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("sync lead inputs must be finite and non-negative");
  }

  return Math.max(...values);
}

export function createFutureSyncTarget(
  nowServerTimeSeconds: number,
  currentPositionSeconds: number,
  rate: number,
  epoch: number,
  leadSeconds: number,
): SyncTarget {
  if (![nowServerTimeSeconds, currentPositionSeconds, rate, leadSeconds].every(Number.isFinite)) {
    throw new RangeError("sync target inputs must be finite");
  }
  if (nowServerTimeSeconds < 0 || currentPositionSeconds < 0 || leadSeconds < 0 || rate <= 0) {
    throw new RangeError("invalid sync target input");
  }

  const targetServerTimeSeconds = nowServerTimeSeconds + leadSeconds;
  return {
    targetServerTimeSeconds,
    targetPositionSeconds: currentPositionSeconds + leadSeconds * rate,
    targetEpoch: epoch,
  };
}
