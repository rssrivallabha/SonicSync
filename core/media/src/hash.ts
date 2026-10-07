export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = new Uint8Array(bytes);
  const buffer = owned.buffer as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function verifySha256Hex(bytes: Uint8Array, expected: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const actual = await sha256Hex(bytes);
  return actual === expected;
}
