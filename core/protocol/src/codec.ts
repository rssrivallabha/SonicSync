import { ProtocolMessage } from "./messages.js";
import { validateProtocolMessage } from "./validation.js";

export const DEFAULT_MAX_PROTOCOL_BYTES = 64 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function encodeProtocolMessage(message: ProtocolMessage, maxBytes = DEFAULT_MAX_PROTOCOL_BYTES): Uint8Array {
  const validation = validateProtocolMessage(message);
  if (!validation.valid) throw new Error(`invalid protocol message: ${validation.reason}`);
  const bytes = encoder.encode(JSON.stringify(message));
  if (bytes.length > maxBytes) throw new RangeError("protocol message too large");
  return bytes;
}

export function decodeProtocolMessage(bytes: Uint8Array, maxBytes = DEFAULT_MAX_PROTOCOL_BYTES): ProtocolMessage {
  if (bytes.length > maxBytes) throw new RangeError("protocol message too large");
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(bytes)); } catch { throw new Error("invalid protocol encoding"); }
  const validation = validateProtocolMessage(parsed);
  if (!validation.valid) throw new Error(`invalid protocol message: ${validation.reason}`);
  return parsed as ProtocolMessage;
}
