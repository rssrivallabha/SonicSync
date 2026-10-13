import { adaptiveLeadMs, estimateClock, ntpSample } from '../src/core/clock.mjs';
import { boundedRateCorrection, phaseErrorMs } from '../src/core/timeline.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : fallback; };
const nodes = arg('nodes', 12);
const durationSec = arg('duration', 60);
const baseLatency = arg('latency', 50);
const jitter = arg('jitter', 15);
const driftRangePpm = arg('drift', 80);
const loss = Math.max(0, Math.min(0.5, arg('loss', 0.01)));
const dtSec = 0.01;
const syncPeriodSec = 1;
const leadMs = adaptiveLeadMs({ rttMs: baseLatency * 2, jitterMs: jitter, uncertaintyMs: Math.max(2, jitter / 2) });
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
const random = rng(0x5eedc0de);
const models = Array.from({ length: nodes }, (_, id) => ({
  id, driftPpm: (random() * 2 - 1) * driftRangePpm, pathJitter: jitter * (0.5 + random()), outputMs: 10 + random() * 45,
  localPos: 0, correctionPpm: 0, samples: [], clock: null
}));

const startSec = 5;
const errors = [];
for (let step = 0; step <= durationSec / dtSec; step++) {
  const tSec = step * dtSec;
  const tMs = tSec * 1000;
  const authoritative = Math.max(0, tSec - startSec);
  for (const n of models) {
    if (tSec >= startSec && step > 0) {
      const rate = 1 + (n.driftPpm + n.correctionPpm) / 1e6;
      n.localPos += dtSec * rate;
      const err = phaseErrorMs(authoritative, n.localPos);
      errors.push(Math.abs(err));
    }
    if (step % Math.round(syncPeriodSec / dtSec) === 0 && step > 0 && random() > loss) {
      const network = Math.max(1, baseLatency + (random() * 2 - 1) * n.pathJitter);
      const t1 = tMs + n.driftPpm * tMs / 1e6;
      const t2 = t1 + network / 2;
      const t3 = t2 + 0.2;
      const t4 = t3 + network / 2;
      n.samples.push(ntpSample({ t1, t2, t3, t4 }));
      n.samples = n.samples.slice(-32);
      n.clock = estimateClock(n.samples);
      const measuredError = phaseErrorMs(authoritative + leadMs / 1000, n.localPos + leadMs / 1000 * (1 + n.driftPpm / 1e6));
      n.correctionPpm = boundedRateCorrection(measuredError, { maxPpm: 1000, deadbandMs: 2, gainPpmPerMs: 8 });
    }
  }
}
errors.sort((a,b)=>a-b);
const q = p => errors[Math.min(errors.length - 1, Math.max(0, Math.floor(errors.length * p) - 1))] || 0;
const max = errors.at(-1) || 0;
console.log(JSON.stringify({ nodes, durationSec, assumptions: { baseLatency, jitter, driftRangePpm, loss }, leadMs, softwarePhaseErrorMs: { p50:q(.5), p90:q(.9), p95:q(.95), p99:q(.99), max }, note:'Simulation only. Acoustic skew and real output latency require physical measurement.' }, null, 2));
