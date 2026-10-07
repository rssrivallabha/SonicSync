function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function generateDeviceIdentity(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function generateSessionToken(byteLength = 32): string {
  if (!Number.isSafeInteger(byteLength) || byteLength < 16 || byteLength > 256) throw new RangeError("invalid token length");
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}
