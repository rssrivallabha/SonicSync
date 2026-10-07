const HEADER_BYTES = 4;
export const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;

export function encodeFrame(payload: Uint8Array, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES): Uint8Array {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0 || maxFrameBytes > 0xffffffff) throw new RangeError("invalid maxFrameBytes");
  if (payload.length > maxFrameBytes) throw new RangeError("payload too large");
  const frame = new Uint8Array(HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length, false);
  frame.set(payload, HEADER_BYTES);
  return frame;
}

export function decodeFrames(buffer: Uint8Array, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES): { readonly frames: readonly Uint8Array[]; readonly remainder: Uint8Array } {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0 || maxFrameBytes > 0xffffffff) throw new RangeError("invalid maxFrameBytes");
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_BYTES) {
    const header = buffer.slice(offset, offset + HEADER_BYTES);
    const length = new DataView(header.buffer as ArrayBuffer).getUint32(0, false);
    if (length > maxFrameBytes) throw new RangeError("frame exceeds configured maximum");
    if (buffer.length - offset - HEADER_BYTES < length) break;
    frames.push(buffer.slice(offset + HEADER_BYTES, offset + HEADER_BYTES + length));
    offset += HEADER_BYTES + length;
  }
  return { frames, remainder: buffer.slice(offset) };
}
