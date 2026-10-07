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
  initialSession,
  requiredReady,
} from "../core/sync/src";

import { validateProtocolMessage } from "../core/protocol/src";
import { InMemoryTransport } from "../core/transport/src";
import { measureMarker } from "../hardware/node/src";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function run(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(() => console.log(`PASS ${name}`));
}

async function main(): Promise<void> {
  await run("authoritative timeline advances only while playing", () => {
    const authority = initialAuthority();
    const playing = applyCommand(authority, { kind: "PLAY", revision: 1, timelineEpoch: 1, effectiveAtSeconds: 10, positionSeconds: 5 });
    equal(positionAt(playing, 12), 7, "playing timeline");
    const paused = applyCommand(playing, { kind: "PAUSE", revision: 2, timelineEpoch: 2, effectiveAtSeconds: 20 });
    equal(paused.playbackState, "PAUSED", "pause state");
    assert(isApproximatelyEqual(positionAt(paused, 100), 15, 1e-9), "pause must retain position");
  });

  await run("stop retains position and resume continues from retained position", () => {
    let authority = initialAuthority();
    authority = applyCommand(authority, { kind: "PLAY", revision: 1, timelineEpoch: 1, effectiveAtSeconds: 1, positionSeconds: 0 });
    authority = applyCommand(authority, { kind: "STOP", revision: 2, timelineEpoch: 2, effectiveAtSeconds: 11 });
    equal(positionAt(authority, 100), 10, "retained stop position");
    authority = applyCommand(authority, { kind: "PLAY", revision: 3, timelineEpoch: 3, effectiveAtSeconds: 20 });
    equal(positionAt(authority, 25), 15, "resume continuity");
  });

  await run("stale command cannot revive an obsolete timeline", () => {
    const authority = applyCommand(initialAuthority(), { kind: "PLAY", revision: 10, timelineEpoch: 2, effectiveAtSeconds: 10, positionSeconds: 4 });
    const stale = applyCommand(authority, { kind: "PLAY", revision: 99, timelineEpoch: 1, effectiveAtSeconds: 11, positionSeconds: 0 });
    equal(JSON.stringify(stale), JSON.stringify(authority), "stale command guard");
  });

  await run("same-epoch stale revision cannot overwrite newer state", () => {
    const authority = applyCommand(initialAuthority(), { kind: "PLAY", revision: 10, timelineEpoch: 1, effectiveAtSeconds: 10, positionSeconds: 4 });
    const stale = applyCommand(authority, { kind: "PAUSE", revision: 9, timelineEpoch: 1, effectiveAtSeconds: 11 });
    equal(JSON.stringify(stale), JSON.stringify(authority), "stale revision guard");
  });

  await run("invalid state transitions are rejected", () => {
    equal(transition("STOPPED", "PAUSE").accepted, false, "invalid transition");
  });

  await run("readiness requires all five components", () => {
    const readiness = initialSession().readiness;
    equal(requiredReady(readiness), false, "empty readiness");
    equal(requiredReady({ ...readiness, mediaReady: true, decoderReady: true, audioEngineReady: true, clockReady: true, outputReady: true }), true, "complete readiness");
  });

  await run("NTP-style clock estimator produces finite values", () => {
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

  await run("rate controller fails safe when confidence is poor", () => {
    const result = updateRateController({ integral: 0, previousError: 0 }, { phaseErrorSeconds: 0.1, driftPpm: 100, confidence: 0.2, dtSeconds: 0.1 }, { kp: 0.2, ki: 0.01, kd: 0.01, maxCorrection: 0.005, integralLimit: 0.1, deadbandSeconds: 0.0005 });
    equal(result.rate, 1, "unsafe correction must be disabled");
    equal(result.state.integral, 0, "integrator must reset");
  });

  await run("sync metrics compute playback error distribution", () => {
    const observations = [
      { deviceId: "a", positionSeconds: 10.000, observedAtSeconds: 1, confidence: 1 },
      { deviceId: "b", positionSeconds: 10.003, observedAtSeconds: 1, confidence: 1 },
      { deviceId: "c", positionSeconds: 9.998, observedAtSeconds: 1, confidence: 1 },
    ];
    const metrics = computeSyncMetrics(observations, 10);
    equal(metrics.sampleCount, 3, "sample count");
    assert(Math.abs(positionRangeSeconds(observations) - 0.005) < 1e-12, "position range");
    assert(Math.abs(metrics.maxErrorSeconds - 0.003) < 1e-12, "max error");
  });

  await run("in-memory transport delivers isolated payload copies", async () => {
    const [a, b] = InMemoryTransport.pair();
    await a.connect({ peerId: "b", kind: "IN_MEMORY", endpoint: "b" });
    await b.connect({ peerId: "a", kind: "IN_MEMORY", endpoint: "a" });
    let received: Uint8Array | null = null;
    const unsubscribe = b.onMessage((payload) => { received = payload; });
    const source = new Uint8Array([1, 2, 3]);
    await a.send(source);
    source[0] = 99;
    assert(received !== null, "message should arrive");
    equal(received![0], 1, "receiver must own payload copy");
    unsubscribe();
    await a.close();
    await b.close();
  });

  await run("hardware marker measurement separates timing domains", () => {
    const result = measureMarker({ markerId: "m1", commandedAtSeconds: 10, gpioTimestampSeconds: 10.001, audioTimestampSeconds: 10.004, acousticArrivalSeconds: 10.009 });
    assert(result.measured, "marker should be measured");
    assert(Math.abs(result.commandToGpioSeconds! - 0.001) < 1e-12, "GPIO latency");
    assert(Math.abs(result.gpioToAudioSeconds! - 0.003) < 1e-12, "audio latency");
    assert(Math.abs(result.audioToAcousticSeconds! - 0.005) < 1e-12, "acoustic latency");
  });

  await run("protocol validator rejects malformed messages", () => {
    assert(!validateProtocolMessage({}).valid, "empty object must fail");
    assert(validateProtocolMessage({ protocolVersion: 1, messageType: "HELLO", messageId: "m1", roomId: "room", senderId: "node", timelineEpoch: 0, commandRevision: 0, timestamp: 123 }).valid, "valid hello");
  });

  console.log("ALL PHASE-1 FOUNDATION TESTS PASSED");
}

main().catch((error: unknown) => { console.error(error); throw error; });
