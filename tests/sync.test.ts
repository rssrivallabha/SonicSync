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
  CommandSequencer,
  computeSyncLead,
  createFutureSyncTarget,
  computePhaseError,
  simulateConvergence,
  ClockModel,
  PlaybackScheduler,
} from "../core/sync/src/index.js";
import { ChunkStore, sha256Hex, verifySha256Hex, validateTrackMetadata, createTransferPlan, putVerifiedChunk, transferComplete } from "../core/media/src/index.js";
import { decodeFrames, encodeFrame, NetworkEmulator, listenTcp, TcpTransport } from "../core/transport/src/index.js";

import { validateProtocolMessage } from "../core/protocol/src/index.js";
import { InMemoryTransport } from "../core/transport/src/index.js";
import { measureMarker } from "../hardware/node/src/index.js";
import { TokenBucket, ReplayGuard, generateDeviceIdentity, generateSessionToken, isCommandAuthorized } from "../core/security/src/index.js";

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


  await run("command sequencer owns monotonic revisions and timeline epochs", () => {
    const sequencer = new CommandSequencer();
    const play = sequencer.next("PLAY", 10);
    const volume = sequencer.next("VOLUME", 10, { volume: 0.5 });
    const seek = sequencer.next("SEEK", 12, { positionSeconds: 12 });
    equal(play.revision, 1, "first revision");
    equal(play.timelineEpoch, 1, "first timeline epoch");
    equal(volume.revision, 2, "volume revision");
    equal(volume.timelineEpoch, 1, "volume does not alter timeline epoch");
    equal(seek.revision, 3, "seek revision");
    equal(seek.timelineEpoch, 2, "seek epoch");
  });

  await run("adaptive lead is driven by measured worst-case inputs", () => {
    equal(
      computeSyncLead({
        minimumLeadSeconds: 0.1,
        p99NetworkDelaySeconds: 0.24,
        clockUncertaintySeconds: 0.012,
        schedulingMarginSeconds: 0.03,
      }),
      0.24,
      "lead should use maximum measured component",
    );
  });

  await run("future target advances timeline independently of packet arrival", () => {
    const target = createFutureSyncTarget(100, 12, 1, 7, 0.5);
    equal(target.targetServerTimeSeconds, 100.5, "future time");
    assert(Math.abs(target.targetPositionSeconds - 12.5) < 1e-12, "future position");
    equal(target.targetEpoch, 7, "epoch");
  });

  await run("phase error exposes signed and absolute skew", () => {
    const error = computePhaseError(10, 10.003, 0.0005);
    assert(error.signedErrorSeconds < 0, "signed direction");
    assert(Math.abs(error.absoluteErrorSeconds - 0.003) < 1e-12, "absolute error");
    equal(error.withinDeadband, false, "deadband");
  });

  await run("deterministic convergence simulation is reproducible", () => {
    const config = {
      kp: 0.2,
      ki: 0.01,
      kd: 0.01,
      maxCorrection: 0.005,
      integralLimit: 0.1,
      deadbandSeconds: 0.0005,
    };
    const nodes = [
      { id: "a", initialPhaseErrorSeconds: 0.02, driftPpm: 20, confidence: 1 },
      { id: "b", initialPhaseErrorSeconds: -0.015, driftPpm: -10, confidence: 1 },
    ];
    const first = simulateConvergence(nodes, 5, 0.1, config);
    const second = simulateConvergence(nodes, 5, 0.1, config);
    assert(Math.abs(first.finalRangeSeconds - second.finalRangeSeconds) < 1e-15, "simulation reproducibility");
    assert(first.samples.length > 0, "simulation samples");
  });


  await run("clock model converts between local and remote domains", () => {
    const model = new ClockModel();
    model.update(
      { offsetSeconds: 0.01, driftPpm: 50, uncertaintySeconds: 0.001, confidence: 1 },
      100,
    );
    const remote = model.localToRemote(110);
    const local = model.remoteToLocal(remote);
    assert(Math.abs(local - 110) < 1e-12, "clock round trip");
    equal(model.isLocked(), true, "clock lock");
  });

  await run("scheduler rejects stale playback plans", () => {
    const scheduler = new PlaybackScheduler();
    scheduler.arm({
      targetTimeSeconds: 10,
      targetPositionSeconds: 3,
      timelineEpoch: 4,
      commandRevision: 8,
    });
    equal(scheduler.inspect(9, 4, 8).kind, "WAIT", "wait");
    equal(scheduler.inspect(10, 4, 8).kind, "START", "start");
    equal(scheduler.inspect(10, 5, 1).kind, "STALE", "stale");
  });


  await run("media chunk store is resumable and ordered", () => {
    const store = new ChunkStore();
    store.put({ index: 1, bytes: new Uint8Array([3, 4]) });
    assert(store.has(1), "stored chunk");
    assert(JSON.stringify(store.missing(3)) === JSON.stringify([0, 2]), "missing chunks");
    store.put({ index: 0, bytes: new Uint8Array([1, 2]) });
    store.put({ index: 2, bytes: new Uint8Array([5]) });
    assert(JSON.stringify(Array.from(store.assemble(3))) === JSON.stringify([1, 2, 3, 4, 5]), "ordered assembly");
  });

  await run("track metadata rejects unsafe paths", () => {
    validateTrackMetadata({
      trackId: "track-1",
      hash: "a".repeat(64),
      sizeBytes: 10,
      durationSeconds: 2,
      sampleRate: 48000,
      channels: 2,
      codec: "PCM",
      filename: "track.wav",
    });
    let rejected = false;
    try {
      validateTrackMetadata({
        trackId: "track-1",
        hash: "a".repeat(64),
        sizeBytes: 10,
        durationSeconds: 2,
        sampleRate: 48000,
        channels: 2,
        codec: "PCM",
        filename: "../escape.wav",
      });
    } catch {
      rejected = true;
    }
    assert(rejected, "path traversal must be rejected");
  });

  await run("frame codec handles complete and partial frames", () => {
    const a = encodeFrame(new Uint8Array([1, 2]));
    const b = encodeFrame(new Uint8Array([3]));
    const combined = new Uint8Array(a.length + b.length);
    combined.set(a);
    combined.set(b, a.length);
    const decoded = decodeFrames(combined);
    equal(decoded.frames.length, 2, "frame count");
    equal(decoded.frames[1]![0], 3, "second payload");
    const partial = decodeFrames(combined.slice(0, a.length + 2));
    equal(partial.frames.length, 1, "partial count");
    assert(partial.remainder.length > 0, "partial remainder");
  });

  await run("SHA-256 hashing is content-addressable", async () => {
    const bytes = new TextEncoder().encode("abc");
    const digest = await sha256Hex(bytes);
    equal(digest, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "sha256");
    equal(await verifySha256Hex(bytes, digest), true, "hash verification");
    equal(await verifySha256Hex(bytes, "0".repeat(64)), false, "wrong hash rejection");
  });

  await run("network emulator can run without packet loss", async () => {
    const [a, b] = InMemoryTransport.pair();
    const ea = new NetworkEmulator(a, { latencyMs: 0, jitterMs: 0, packetLossRatio: 0, duplicateRatio: 0 });
    await a.connect({ peerId: "b", kind: "IN_MEMORY", endpoint: "b" });
    await b.connect({ peerId: "a", kind: "IN_MEMORY", endpoint: "a" });
    let seen = 0;
    const unsubscribe = b.onMessage(() => { seen += 1; });
    await ea.connect({ peerId: "b", kind: "IN_MEMORY", endpoint: "b" });
    await ea.send(new Uint8Array([7]));
    equal(seen, 1, "delivery");
    unsubscribe();
    await ea.close();
    await b.close();
  });


  await run("LAN TCP transport exchanges framed payloads", async () => {
    const listener = await listenTcp("127.0.0.1", 0, (transport) => {
      transport.onMessage((payload) => { void transport.send(payload); });
    });

    const client = new TcpTransport();
    await client.connect({ peerId: "server", kind: "LAN", endpoint: `127.0.0.1:${listener.port}` });

    let received: Uint8Array | null = null;
    const unsubscribe = client.onMessage((payload) => { received = payload; });
    await client.send(new Uint8Array([9, 8, 7]));

    const deadline = Date.now() + 1000;
    while (received === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert(received !== null, "TCP echo should arrive");
    assert(JSON.stringify(Array.from(received!)) === JSON.stringify([9, 8, 7]), "TCP payload");
    unsubscribe();
    await client.close();
    await listener.close();
  });


  await run("media transfer plan enforces ordered chunk sizes", () => {
    const plan = createTransferPlan(5, 2);
    const store = new ChunkStore();
    putVerifiedChunk(plan, store, { index: 0, bytes: new Uint8Array([1, 2]) });
    putVerifiedChunk(plan, store, { index: 1, bytes: new Uint8Array([3, 4]) });
    assert(!transferComplete(plan, store), "transfer should remain incomplete");
    putVerifiedChunk(plan, store, { index: 2, bytes: new Uint8Array([5]) });
    assert(transferComplete(plan, store), "transfer should complete");
  });


  await run("protocol validator rejects invalid commands and oversized identifiers", () => {
    const base = {
      protocolVersion: 1,
      messageType: "COMMAND",
      messageId: "m1",
      roomId: "room",
      senderId: "node",
      timelineEpoch: 1,
      commandRevision: 1,
      timestamp: 10,
      effectiveAt: 20,
      command: "PLAY",
      positionSeconds: 2,
    };
    assert(!validateProtocolMessage({ ...base, command: "NOPE" }).valid, "unknown command");
    assert(!validateProtocolMessage({ ...base, positionSeconds: -1 }).valid, "negative position");
    assert(!validateProtocolMessage({ ...base, messageId: "x".repeat(129) }).valid, "oversized message id");
    assert(!validateProtocolMessage({ ...base, command: "MUTE" }).valid, "missing mute payload");
  });

  await run("participant authorization permits sync request only", () => {
    equal(isCommandAuthorized("PARTICIPANT", "SYNC"), true, "sync request");
    equal(isCommandAuthorized("PARTICIPANT", "PLAY"), false, "participant play rejection");
    equal(isCommandAuthorized("HOST", "PLAY"), true, "host play");
  });

  await run("replay guard rejects duplicate and regressed sequences", () => {
    const guard = new ReplayGuard(60);
    assert(guard.accept("node", "m1", 1, 10).accepted, "first message");
    assert(!guard.accept("node", "m1", 1, 11).accepted, "duplicate id");
    assert(!guard.accept("node", "m2", 0, 11).accepted, "regressed sequence");
    assert(guard.accept("node", "m3", 2, 11).accepted, "next sequence");
  });

  await run("token bucket rate limits bursts and refills", () => {
    const bucket = new TokenBucket(2, 1, 0);
    equal(bucket.allow(1, 0), true, "first");
    equal(bucket.allow(1, 0), true, "second");
    equal(bucket.allow(1, 0), false, "burst limit");
    equal(bucket.allow(1, 1), true, "refill");
  });

  await run("device identity and session token generation produce opaque random material", () => {
    const device = generateDeviceIdentity();
    const token = generateSessionToken(32);
    assert(/^[a-f0-9]{32}$/.test(device), "device identity format");
    assert(/^[a-f0-9]{64}$/.test(token), "session token format");
  });

  console.log("ALL PHASE-1/2/3/4 FOUNDATION TESTS PASSED");
}

main().catch((error: unknown) => { console.error(error); throw error; });
