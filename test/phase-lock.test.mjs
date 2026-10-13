import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhaseLockState, updatePhaseLock } from '../src/core/phase-lock.mjs';

test('phase lock drives ahead device slower and bounded', () => {
  const s = createPhaseLockState();
  const r = updatePhaseLock(s, { errorMs: 20, dtSec: 0.12 });
  assert.ok(r.correctionPpm < 0);
  assert.ok(Math.abs(r.correctionPpm) <= 20000);
});

test('phase lock drives behind device faster', () => {
  const s = createPhaseLockState();
  const r = updatePhaseLock(s, { errorMs: -20, dtSec: 0.12 });
  assert.ok(r.correctionPpm > 0);
});

test('phase lock converges to deadband without integral windup', () => {
  const s = createPhaseLockState();
  for (let i = 0; i < 80; i++) updatePhaseLock(s, { errorMs: 0.3, dtSec: 0.12 });
  assert.ok(Math.abs(s.correctionPpm) < 200);
  assert.ok(Math.abs(s.integralMsSec) < 10);
});

test('phase lock reduces a moderate simulated phase error quickly', () => {
  const s = createPhaseLockState();
  let errorMs = 20;
  const dtSec = 0.12;
  for (let i = 0; i < 18; i++) {
    const r = updatePhaseLock(s, { errorMs, dtSec });
    errorMs += (r.correctionPpm / 1e6) * dtSec * 1000;
  }
  assert.ok(Math.abs(errorMs) < 5, `expected <5ms residual, got ${errorMs.toFixed(2)}ms`);
});
