export interface PhaseError {
  readonly signedErrorSeconds: number;
  readonly absoluteErrorSeconds: number;
  readonly withinDeadband: boolean;
}

export function computePhaseError(targetPositionSeconds: number, observedPositionSeconds: number, deadbandSeconds = 0): PhaseError {
  if (![targetPositionSeconds, observedPositionSeconds, deadbandSeconds].every(Number.isFinite) || deadbandSeconds < 0) {
    throw new RangeError("invalid phase error inputs");
  }

  const signedErrorSeconds = targetPositionSeconds - observedPositionSeconds;
  const absoluteErrorSeconds = Math.abs(signedErrorSeconds);

  return {
    signedErrorSeconds,
    absoluteErrorSeconds,
    withinDeadband: absoluteErrorSeconds <= deadbandSeconds,
  };
}
