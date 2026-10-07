import test from "node:test";
import assert from "node:assert/strict";

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

test("authoritative timeline advances only while playing", () => {
  const authority = initialAuthority();
  const playing = applyCommand(authority, {
    kind: "PLAY",
    revision: 1,
    timelineEpoch: 0,
    effectiveAtSeconds: 10,
    positionSeconds: 5,
  });

  assert.equal(positionAt(playing, 12), 7);

  const paused = applyCommand(playing, {
    kind: "PAUSE",
    revision: 3,
    timelineEpoch: 1,
    effectiveAtSeconds: 20,
  });

  assert.equal(paused.playbackState, "PAUSED");
  assert.ok(isApproximatelyEqual(positionAt(paused, 100), 15, 1e-9));
});

test("stop retains position and resume continues from retained position", () => {
  let a = initialAuthority();

  a = applyCommand(a, {
    kind: "PLAY",
    revision: 1,
    timelineEpoch: 0,
    effectiveAtSeconds: 1,
    positionSeconds: 0,
  });

  a = applyCommand(a, {
    kind: "STOP",
    revision: 2,
    timelineEpoch: 1,
    effectiveAtSeconds: 11,
  });

  const retained = positionAt(a, 100);
  assert.equal(retained, 10);

  a = applyCommand(a, {
    kind: "PLAY",
    revision: 4,
    timelineEpoch: 2,
    effectiveAtSeconds: 20,
  });

  assert.equal(positionAt(a, 25), 15);
});

test("stale command cannot revive an obsolete timeline", () => {
  let a = initialAuthority();

  a = applyCommand(a, {
    kind: "PLAY",
    revision: 10,
    timelineEpoch: 2,
    effectiveAtSeconds: 10,
    positionSeconds: 4,
  });

  const before = a;
  const stale = applyCommand(a, {
    kind: "PLAY",
    revision: 99,
    timelineEpoch: 1,
    effectiveAtSeconds: 11,
    positionSeconds: 0,
  });

  assert.deepEqual(stale, before);
});

test("invalid state transitions are rejected", () => {
  const result = transition("STOPPED", "PAUSE");
  assert.equal(result.accepted, false);
});

test("NTP-style clock probe and robust estimator produce finite values", () => {
  const samples = [
    { t1: 0, t2: 0.012, t3: 0.013, t4: 0.020 },
    { t1: 1, t2: 1.0121, t3: 1.0131, t4: 1.0202 },
    { t1: 2, t2: 2.0119, t3: 2.0129, t4: 2.0201 },
    { t1: 3, t2: 3.0122, t3: 3.0132, t4: 3.0203 },
  ];

  const single = probeOffset(samples[0]);
  assert.ok(single.offsetSeconds > 0);
  assert.ok(single.rttSeconds >= 0);

  const fit = estimateClock(samples);
  assert.ok(Number.isFinite(fit.offsetSeconds));
  assert.ok(Number.isFinite(fit.driftPpm));
  assert.ok(fit.uncertaintySeconds > 0);
  assert.ok(fit.confidence > 0);
});

test("rate controller fails safe when clock confidence is poor", () => {
  const result = updateRateController(
    { integral: 0, previousError: 0 },
    { phaseErrorSeconds: 0.1, driftPpm: 100, confidence: 0.2, dtSeconds: 0.1 },
    {
      kp: 0.2,
      ki: 0.01,
      kd: 0.01,
      maxCorrection: 0.005,
      integralLimit: 0.1,
      deadbandSeconds: 0.0005,
    },
  );

  assert.equal(result.rate, 1);
  assert.equal(result.state.integral, 0);
});

test("sync metrics compute distribution of playback error", () => {
  const observations = [
    { deviceId: "a", positionSeconds: 10.000, observedAtSeconds: 1, confidence: 1 },
    { deviceId: "b", positionSeconds: 10.003, observedAtSeconds: 1, confidence: 1 },
    { deviceId: "c", positionSeconds: 9.998, observedAtSeconds: 1, confidence: 1 },
  ];

  const metrics = computeSyncMetrics(observations, 10);
  assert.equal(metrics.sampleCount, 3);
  assert.equal(positionRangeSeconds(observations), 0.005);
  assert.ok(Math.abs(metrics.maxErrorSeconds - 0.003) < 1e-12);
});

test("protocol validator rejects malformed messages and accepts valid base messages", () => {
  assert.equal(validateProtocolMessage({}).valid, false);

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

  assert.equal(result.valid, true);
});
