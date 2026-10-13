import crypto from 'node:crypto';
export const PROTOCOL_VERSION = 2;
export const CONTROL_TYPES = new Set([
  'join','sync','rtcSignal','rtcState','telemetry','ready','requestSync','syncMismatch','syncApplied',
  'start','pause','resume','stop','reset','seek','syncAll','volume','mute','trim','lockRoom','kick','next','previous','queue'
]);

export function envelope(type, body = {}, meta = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    messageId: meta.messageId || crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    timelineEpoch: Number.isFinite(meta.timelineEpoch) ? meta.timelineEpoch : undefined,
    revision: Number.isFinite(meta.revision) ? meta.revision : undefined,
    timestamp: Number.isFinite(meta.timestamp) ? meta.timestamp : performance.timeOrigin + performance.now(),
    ...body
  };
}

export function validateControlMessage(input, { maxBytes = 128 * 1024 } = {}) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) return { ok: false, error: 'CONTROL_PACKET_TOO_LARGE' };
  let message;
  try { message = typeof input === 'string' ? JSON.parse(input) : input; } catch { return { ok: false, error: 'MALFORMED_JSON' }; }
  if (!message || typeof message !== 'object' || Array.isArray(message)) return { ok: false, error: 'INVALID_MESSAGE' };
  if (typeof message.type !== 'string' || !CONTROL_TYPES.has(message.type)) return { ok: false, error: 'UNKNOWN_MESSAGE_TYPE' };
  if (message.protocolVersion != null && message.protocolVersion > PROTOCOL_VERSION) return { ok: false, error: 'UNSUPPORTED_PROTOCOL_VERSION' };
  for (const key of ['room','roomId','senderId','messageId']) if (message[key] != null && typeof message[key] !== 'string') return { ok: false, error: `INVALID_${key.toUpperCase()}` };
  if (message.revision != null && (!Number.isInteger(Number(message.revision)) || Number(message.revision) < 0)) return { ok: false, error: 'INVALID_REVISION' };
  if (message.timelineEpoch != null && (!Number.isInteger(Number(message.timelineEpoch)) || Number(message.timelineEpoch) < 0)) return { ok: false, error: 'INVALID_TIMELINE_EPOCH' };
  return { ok: true, message };
}

export function isFreshCommand(message, { revision = 0, timelineEpoch = 0 } = {}) {
  if (Number.isFinite(message?.revision) && message.revision < revision) return false;
  if (Number.isFinite(message?.timelineEpoch) && message.timelineEpoch < timelineEpoch) return false;
  return true;
}
