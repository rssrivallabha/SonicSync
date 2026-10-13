import test from 'node:test';
import assert from 'node:assert/strict';
import { adaptiveLeadMs, estimateClock, ntpSample } from '../src/core/clock.mjs';
import { boundedRateCorrection, phaseErrorMs, positionAt } from '../src/core/timeline.mjs';
import { SyncStateMachine, STATES } from '../src/core/state-machine.mjs';
import { validateControlMessage, isFreshCommand, envelope, PROTOCOL_VERSION } from '../src/core/protocol.mjs';
import { ContentAddressedMediaStore } from '../src/core/media-store.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sampleSet = (offset = 12, driftPpm = 50) => Array.from({ length: 12 }, (_, i) => {
  const midpoint = i * 1000;
  const o = offset + midpoint * driftPpm / 1e6;
  return ntpSample({ t1: midpoint, t2: midpoint + 25 + o, t3: midpoint + 26 + o, t4: midpoint + 52 });
});

test('authoritative timeline extrapolates from future anchor', () => {
  assert.equal(positionAt({ trackId: 'x', state: 'playing', startedAt: 1000, anchorPosition: 2, rate: 1 }, 3500), 4.5);
});

test('phase correction is bounded and deadbanded', () => {
  assert.equal(boundedRateCorrection(1), 0);
  assert.ok(Math.abs(boundedRateCorrection(10000)) <= 1200);
  assert.equal(Math.round(phaseErrorMs(10, 10.025)), 25);
});

test('clock estimator resists noisy outlier', () => {
  const s = sampleSet();
  s.push(ntpSample({ t1: 12000, t2: 40000, t3: 40001, t4: 12052 }));
  const c = estimateClock(s);
  assert.ok(c.locked);
  assert.ok(Math.abs(c.offsetMs - 12) < 3);
  assert.ok(Math.abs(c.driftPpm - 50) < 20);
});

test('adaptive lead has safety floor and ceiling', () => {
  assert.equal(adaptiveLeadMs({ rttMs: 0, jitterMs: 0, uncertaintyMs: 0, floor: 1000, ceiling: 8000 }), 1000);
  assert.equal(adaptiveLeadMs({ rttMs: 5000, jitterMs: 5000, uncertaintyMs: 5000, floor: 1000, ceiling: 8000 }), 8000);
});

test('state machine invalidates stale generations', () => {
  const sm = new SyncStateMachine(STATES.DISCONNECTED);
  sm.transition(STATES.CONNECTING);
  sm.transition(STATES.AUTHENTICATING);
  sm.transition(STATES.JOINED);
  sm.transition(STATES.PREPARING);
  const before = sm.generation;
  sm.invalidate('seek superseded');
  assert.equal(sm.generation, before + 1);
  assert.throws(() => sm.transition(STATES.PLAYING), /Illegal transition/);
});

test('protocol validator rejects unknown and oversized messages', () => {
  assert.equal(validateControlMessage({ type: 'start' }).ok, true);
  assert.equal(validateControlMessage({ type: 'wat' }).ok, false);
  assert.equal(validateControlMessage({ type: 'start', x: 'a'.repeat(200) }, { maxBytes: 50 }).error, 'CONTROL_PACKET_TOO_LARGE');
});


test('freshness guard rejects older timeline generations', () => {
  assert.equal(isFreshCommand({ revision: 10, timelineEpoch: 4 }, { revision: 10, timelineEpoch: 4 }), true);
  assert.equal(isFreshCommand({ revision: 9, timelineEpoch: 4 }, { revision: 10, timelineEpoch: 4 }), false);
  assert.equal(isFreshCommand({ revision: 11, timelineEpoch: 3 }, { revision: 10, timelineEpoch: 4 }), false);
});

test('content-addressed store reuses identical payload', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonicsync-media-'));
  const temp1 = path.join(dir, 'a.tmp'); fs.writeFileSync(temp1, 'same-audio');
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256').update('same-audio').digest('hex');
  const store = new ContentAddressedMediaStore(dir);
  const first = store.putFile(temp1, hash, '.wav');
  assert.equal(fs.existsSync(first), true);
  const temp2 = path.join(dir, 'b.tmp'); fs.writeFileSync(temp2, 'same-audio');
  const second = store.putFile(temp2, hash, '.wav');
  assert.equal(first, second);
  assert.equal(fs.readFileSync(second, 'utf8'), 'same-audio');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('protocol envelope is valid and monotonic-time based', () => {
  const m = envelope('ping', {}, { timestamp: 123.5, revision: 4, timelineEpoch: 2 });
  assert.equal(m.protocolVersion, PROTOCOL_VERSION);
  assert.equal(m.timestamp, 123.5);
  assert.equal(m.revision, 4);
  assert.equal(m.timelineEpoch, 2);
  assert.ok(m.messageId);
});
