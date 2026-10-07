import {
  applyCommand,
  initialAuthority,
  positionAt,
  isApproximatelyEqual,
  estimateClock,
  probeOffset,
  transition,
  updateRateController,
  computeSyncMetrics,
  positionRangeSeconds,
} from "../core/sync/src";

import { validateProtocolMessage } from "../core/protocol/src";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`, error);
    throw error;
  }
}

run("authoritative timeline advances only while playing", () => {
  const authority = initialAuthority();

  const playing = applyCommand(authority, {
    kind: "PLAY",
    revision: 1,
    timelineEpoch: 0,
    effectiveAtSeconds: 10,
    positionSeconds: 5,
  });

  equal(positionAt(playing, 12), 7, "playing timeline");

  const paused = applyCommand(playing, {
    kind: "PAUSE",
    revision: 3,
    timelineEpoch: 1,
    effectiveAtSeconds: 20,
  });

  equal(paused.playbackState, "PAUSED", "pause state");
  assert(
    isApproximatelyEqual(positionAt(paused, 100), 15, 1e-9),
    "pause must retain position",
  );
});

run("stop retains position and resume continues from retained position", () => {
  let authority = initialAuthority();

  authority = applyCommand(authority, {
    kind: "PLAY",
    revision: 1,
    timelineEpoch: 0,
    effectiveAtSeconds: 1,
    positionSeconds: 0,
  });

  authority = applyCommand(authority, {
    kind: "STOP",
    revision: 2,
    timelineEpoch: 1,
    effectiveAtSeconds: 11,
  });

  const retained = positionAt(authority, 100);
  equal(retained, 10, "retained stop position");

  authority = applyCommand(authority, {
    kind: "PLAY",
    revision: 4,
    timelineEpoch: 2,
    effectiveAtSeconds: 20,
  });

  equal(positionAt(authority, 25), 15, "resume continuity");
});

run("stale command cannot revive an obsolete timeline", () => {
  let authority = initialAuthority();

  authority = applyCommand(authority, {
    kind: "PLAY",
    revision: 10,
    timelineEpoch: 2,
    effectiveAtSeconds: 10,
    positionSeconds: 4,
  });

  const stale = applyCommand(authority, {
    kind: "PLAY",
    revision: 99,
    timelineEpoch: 1,
    effectiveAtSeconds: 11,
    positionSeconds: 0,
  });

  equal(JSON.stringify(stale), JSON.stringify(authority), "stale command guard");
});

run("invalid state transitions are rejected", () => {
  const result = transition("STOPPED", "PAUSE");
  equal(result.accepted, false, "invalid transition");
});

run("NTP-style clock probe and robust estimator produce finite values", () => {
  const samples = [
    { t1: 0, t2: 0.012, t3: 0.013, t4: 0.020 },
    { t1: 1, t2: 1.0121, t3: 1.0131, t4: 1.0202 },
    { t1: 2, t2: 2.0119, t3: 2.0129, t4: 2.0201 },
    { t1: 3, t2: 3.0122, t3: 3.0132, t4: 3.0203 },
  ];

  const single = probeOffset(samples[0]!);
  assert(single.offsetSeconds > 0, "offset should be positive");
  assert(single.rttSeconds >= 0, "RTT should be non-negative");

  const fit = estimateClock(samples);
  assert(Number.isFinite(fit.offsetSeconds), "finite offset");
  assert(Number.isFinite(fit.driftPpm), "finite drift");
  assert(fit.uncertaintySeconds > 0, "uncertainty exists");
  assert(fit.confidence > 0, "confidence exists");
});

run("rate controller fails safe when clock confidence is poor", () => {
  const result = updateRateController(
    { integral: 0, previousError: 0 },
    {
      phaseErrorSeconds: 0.1,
      driftPpm: 100,
      confidence: 0.2,
      dtSeconds: 0.1,
    },
    {
      kp: 0.2,
      ki: 0.01,
      kd: 0.01,
      maxCorrection: 0.005,
      integralLimit: 0.1,
      deadbandSeconds: 0.0005,
    },
  );

  equal(result.rate, 1, "unsafe correction must be disabled");
  equal(result.state.integral, 0, "integrator must reset");
});

run("sync metrics compute distribution of playback error", () => {
  const observations = [
    {
      deviceId: "a",
      positionSeconds: 10.000,
      observedAtSeconds: 1,
      confidence: 1,
    },
    {
      deviceId: "b",
      positionSeconds: 10.003,
      observedAtSeconds: 1,
      confidence: 1,
    },
    {
      deviceId: "c",
      positionSeconds: 9.998,
      observedAtSeconds: 1,
      confidence: 1,
    },
  ];

  const metrics = computeSyncMetrics(observations, 10);
  equal(metrics.sampleCount, 3, "sample count");
  assert(
    Math.abs(positionRangeSeconds(observations) - 0.005) < 1e-12,
    "position range",
  );
  assert(
    Math.abs(metrics.maxErrorSeconds - 0.003) < 1e-12,
    "max error",
  );
});

run("protocol validator rejects malformed messages and accepts valid base messages", () => {
  assert(!validateProtocolMessage({}).valid, "empty object must fail");

  const result = validateProtocolMessage({
    protocolVersion: 1,
    messageType: "HELLO",
    messageId: "m1",
    roomId: "room",
    senderId: "node",
    timelineEpoch: 0,
    commandRevision: 0,
    timestamp: 123,
  });

  assert(result.valid, "valid hello must pass");
});

console.log("ALL PHASE-1 FOUNDATION TESTS PASSED");
