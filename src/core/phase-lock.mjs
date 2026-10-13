export function createPhaseLockState() {
  return { filteredErrorMs: 0, integralMsSec: 0, initialized: false, correctionPpm: 0 };
}

export function updatePhaseLock(state, {
  errorMs,
  dtSec,
  kpPpmPerMs = 900,
  kiPpmPerMsSec = 60,
  maxCorrectionPpm = 20_000,
  deadbandMs = 0.8,
  filterAlpha = 0.22,
  integralClampMsSec = 120,
  integralLeakPerSecond = 0.18
} = {}) {
  const error = Number.isFinite(errorMs) ? errorMs : 0;
  const dt = Math.max(0.001, Math.min(1, Number.isFinite(dtSec) ? dtSec : 0.18));
  const a = Math.max(0.02, Math.min(1, filterAlpha));
  state.filteredErrorMs = state.initialized ? state.filteredErrorMs * (1 - a) + error * a : error;
  state.initialized = true;

  const decay = Math.max(0, Math.min(1, Math.exp(-Math.max(0, integralLeakPerSecond) * dt)));
  state.integralMsSec *= decay;
  if (Math.abs(state.filteredErrorMs) <= deadbandMs) {
    state.integralMsSec *= 0.45;
    state.correctionPpm *= 0.65;
    if (Math.abs(state.correctionPpm) < 25) state.correctionPpm = 0;
    return { correctionPpm: state.correctionPpm, filteredErrorMs: state.filteredErrorMs, integralMsSec: state.integralMsSec, inDeadband: true };
  }

  state.integralMsSec += state.filteredErrorMs * dt;
  state.integralMsSec = Math.max(-integralClampMsSec, Math.min(integralClampMsSec, state.integralMsSec));
  const requested = -(kpPpmPerMs * state.filteredErrorMs + kiPpmPerMsSec * state.integralMsSec);
  const target = Math.max(-maxCorrectionPpm, Math.min(maxCorrectionPpm, requested));
  state.correctionPpm = state.correctionPpm * 0.55 + target * 0.45;
  return { correctionPpm: state.correctionPpm, filteredErrorMs: state.filteredErrorMs, integralMsSec: state.integralMsSec, inDeadband: false };
}
