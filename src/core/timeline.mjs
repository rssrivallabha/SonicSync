export const PLAYING_STATES = new Set(['playing', 'pausing', 'stopping']);

export function positionAt(timeline, atMs) {
  if (!timeline?.trackId) return 0;
  if (PLAYING_STATES.has(timeline.state) && Number.isFinite(timeline.startedAt)) {
    const rate = Number.isFinite(timeline.rate) ? timeline.rate : 1;
    return Math.max(0, (atMs - timeline.startedAt) / 1000 * rate + (timeline.anchorPosition ?? 0));
  }
  return Math.max(0, Number(timeline.position) || 0);
}

export function makeAnchor(position, effectiveAt, rate = 1) {
  return { anchorPosition: Math.max(0, Number(position) || 0), startedAt: Number(effectiveAt), rate: Number.isFinite(rate) ? rate : 1 };
}

export function transitionTimeline(timeline, event, payload = {}, atMs = 0) {
  const next = { ...timeline };
  if (event === 'start' || event === 'resume') {
    const position = Math.max(0, Number(payload.position ?? timeline.position) || 0);
    const at = Number(payload.effectiveAt ?? atMs);
    next.state = 'playing';
    next.position = position;
    next.anchorPosition = position;
    next.startedAt = at;
    next.positionCapturedAt = at;
  } else if (event === 'pause' || event === 'stop') {
    const position = positionAt(timeline, Number(payload.effectiveAt ?? atMs));
    next.position = position;
    next.anchorPosition = position;
    next.startedAt = null;
    next.state = event === 'pause' ? 'paused' : 'stopped';
  } else if (event === 'reset') {
    next.position = 0;
    next.anchorPosition = 0;
    next.startedAt = null;
    next.state = timeline.trackId ? 'ready' : 'idle';
  } else if (event === 'seek') {
    const position = Math.max(0, Number(payload.position) || 0);
    next.position = position;
    next.anchorPosition = position;
    if (next.state === 'playing') next.startedAt = Number(payload.effectiveAt ?? atMs);
  }
  return next;
}

export function phaseErrorMs(authoritativePositionSec, localPositionSec, trimMs = 0) {
  return (Number(localPositionSec) - Number(authoritativePositionSec)) * 1000 - Number(trimMs || 0);
}

export function boundedRateCorrection(errorMs, { maxPpm = 1200, deadbandMs = 3, gainPpmPerMs = 18 } = {}) {
  const e = Number(errorMs) || 0;
  if (Math.abs(e) <= deadbandMs) return 0;
  return Math.max(-maxPpm, Math.min(maxPpm, -e * gainPpmPerMs));
}
