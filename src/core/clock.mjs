function median(values) {
  const a = [...values].filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function mad(values, center) {
  return median(values.map(v => Math.abs(v - center)));
}

export function ntpSample({ t1, t2, t3, t4 }) {
  const rtt = Math.max(0, (t4 - t1) - (t3 - t2));
  const offset = ((t2 - t1) + (t3 - t4)) / 2;
  return { t1, t2, t3, t4, rtt, offset, midpoint: (t1 + t4) / 2 };
}

export function estimateClock(samples, { minSamples = 3, maxSamples = 64 } = {}) {
  const clean = samples.filter(s => Number.isFinite(s?.offset) && Number.isFinite(s?.rtt)).slice(-maxSamples);
  if (!clean.length) return { locked: false, offsetMs: 0, driftPpm: 0, jitterMs: 0, uncertaintyMs: Infinity, confidence: 0, rttMs: 0, sampleCount: 0 };
  const rtts = clean.map(s => s.rtt);
  const minRtt = Math.min(...rtts);
  const eligible = clean.filter(s => s.rtt <= minRtt + Math.max(2, median(rtts) * 0.25));
  const offsets = eligible.map(s => s.offset);
  const center = median(offsets);
  const spread = Math.max(0, mad(offsets, center) * 1.4826);
  const robust = eligible.filter(s => Math.abs(s.offset - center) <= Math.max(2, spread * 3.5));

  let driftPpm = 0;
  if (robust.length >= 3) {
    const t0 = robust[0].midpoint;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const s of robust) {
      const x = s.midpoint - t0;
      const y = s.offset;
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const den = robust.length * sxx - sx * sx;
    if (Math.abs(den) > 1e-9) {
      const slopeMsPerMs = (robust.length * sxy - sx * sy) / den;
      driftPpm = Math.max(-500, Math.min(500, slopeMsPerMs * 1e6));
    }
  }

  const uncertainty = Math.max(0.5, spread + Math.max(0, minRtt / 2));
  const confidence = Math.max(0, Math.min(1, (robust.length / Math.max(minSamples, 8)) * (1 / (1 + uncertainty / 8))));
  return {
    locked: clean.length >= minSamples && robust.length >= minSamples,
    offsetMs: center,
    driftPpm,
    jitterMs: spread,
    uncertaintyMs: uncertainty,
    confidence,
    rttMs: median(robust.map(s => s.rtt)),
    sampleCount: clean.length
  };
}

export function adaptiveLeadMs({ rttMs = 20, jitterMs = 5, uncertaintyMs = 2, reliability = 1, floor = 1000, ceiling = 8000 } = {}) {
  const reliabilityPenalty = Math.max(0, Math.min(1, 1 - reliability)) * 800;
  const lead = 450 + Math.max(0, rttMs) * 3.5 + Math.max(0, jitterMs) * 5 + Math.max(0, uncertaintyMs) * 7 + reliabilityPenalty;
  return Math.round(Math.min(ceiling, Math.max(floor, lead)));
}

export { median };
