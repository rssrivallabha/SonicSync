import { updateRateController, RateControllerConfig, RateControllerState } from "./rate-controller";

export interface SimulatedNode {
  readonly id: string;
  readonly initialPhaseErrorSeconds: number;
  readonly driftPpm: number;
  readonly confidence: number;
}

export interface SimulationSample {
  readonly timeSeconds: number;
  readonly nodeErrorsSeconds: readonly number[];
  readonly maxAbsoluteErrorSeconds: number;
  readonly rangeSeconds: number;
}

export interface ConvergenceSimulation {
  readonly samples: readonly SimulationSample[];
  readonly finalMaxAbsoluteErrorSeconds: number;
  readonly finalRangeSeconds: number;
}

export function simulateConvergence(
  nodes: readonly SimulatedNode[],
  durationSeconds: number,
  stepSeconds: number,
  config: RateControllerConfig,
): ConvergenceSimulation {
  if (nodes.length === 0) throw new RangeError("at least one node is required");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new RangeError("durationSeconds must be positive");
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new RangeError("stepSeconds must be positive");

  const errors = nodes.map((node) => node.initialPhaseErrorSeconds);
  const states: RateControllerState[] = nodes.map(() => ({ integral: 0, previousError: 0 }));
  const samples: SimulationSample[] = [];

  for (let time = 0; time <= durationSeconds + stepSeconds / 2; time += stepSeconds) {
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i]!;
      const correction = updateRateController(states[i]!, { phaseErrorSeconds: errors[i]!, driftPpm: node.driftPpm, confidence: node.confidence, dtSeconds: stepSeconds }, config);
      states[i] = correction.state;
      errors[i] -= (correction.rate - 1) * stepSeconds;
      errors[i] += (node.driftPpm / 1e6) * stepSeconds;
    }

    const maxAbsoluteErrorSeconds = Math.max(...errors.map(Math.abs));
    const rangeSeconds = Math.max(...errors) - Math.min(...errors);
    samples.push({ timeSeconds: Number(time.toFixed(9)), nodeErrorsSeconds: [...errors], maxAbsoluteErrorSeconds, rangeSeconds });
  }

  const last = samples[samples.length - 1]!;
  return {
    samples,
    finalMaxAbsoluteErrorSeconds: last.maxAbsoluteErrorSeconds,
    finalRangeSeconds: last.rangeSeconds,
  };
}
