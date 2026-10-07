export interface RateControllerConfig {
  readonly kp: number;
  readonly ki: number;
  readonly kd: number;
  readonly maxCorrection: number;
  readonly integralLimit: number;
  readonly deadbandSeconds: number;
}

export interface RateControllerState {
  readonly integral: number;
  readonly previousError: number;
}

export interface RateCorrectionInput {
  readonly phaseErrorSeconds: number;
  readonly driftPpm: number;
  readonly confidence: number;
  readonly dtSeconds: number;
}

export function updateRateController(
  state: RateControllerState,
  input: RateCorrectionInput,
  config: RateControllerConfig,
): { state: RateControllerState; rate: number } {
  if (input.dtSeconds <= 0 || !Number.isFinite(input.dtSeconds)) {
    throw new RangeError("dtSeconds must be positive");
  }

  if (input.confidence < 0.5) {
    return { state: { integral: 0, previousError: input.phaseErrorSeconds }, rate: 1 };
  }

  const error = Math.abs(input.phaseErrorSeconds) <= config.deadbandSeconds
    ? 0
    : input.phaseErrorSeconds;

  const nextIntegral = Math.max(
    -config.integralLimit,
    Math.min(
      config.integralLimit,
      state.integral + error * input.dtSeconds,
    ),
  );

  const derivative = (error - state.previousError) / input.dtSeconds;
  const driftComponent = input.driftPpm / 1e6;

  const raw =
    config.kp * error +
    config.ki * nextIntegral +
    config.kd * derivative +
    driftComponent;

  const correction = Math.max(-config.maxCorrection, Math.min(config.maxCorrection, raw));

  return {
    state: {
      integral: nextIntegral,
      previousError: error,
    },
    rate: 1 + correction,
  };
}
