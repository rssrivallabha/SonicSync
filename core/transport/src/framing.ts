const HEADER_BYTES = 4;

export function encodeFrame(payload: Uint8Array): Uint8Array {
  if (payload.length > 0xffffffff) throw new RangeError("payload too large");
  const frame = new Uint8Array(HEADER_BYTES + payload.length);
  const view = new DataView(frame.buffer);
  view.setUint32(0, payload.length, false);
  frame.set(payload, HEADER_BYTES);
  return frame;
}

export function decodeFrames(buffer: Uint8Array): { readonly frames: readonly Uint8Array[]; readonly remainder: Uint8Array } {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_BYTES) {
    const length = new DataView(buffer.buffer, buffer.byteOffset + offset, HEADER_BYTES).getUint32(0, false);
    if (buffer.length - offset - HEADER_BYTES < length) break;
    frames.push(buffer.slice(offset + HEADER_BYTES, offset + HEADER_BYTES + length));
    offset += HEADER_BYTES + length;
  }
  return { frames, remainder: buffer.slice(offset) };
}
