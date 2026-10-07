function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((value) => value.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/.test(value) || value.length % 2 !== 0) throw new RangeError("invalid hex");
  const output = new Uint8Array(value.length / 2);
  for (let i = 0; i < output.length; i += 1) output[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return output;
}

async function hmac(secretHex: string, data: string): Promise<string> {
  const secret = await globalThis.crypto.subtle.importKey("raw", hexToBytes(secretHex).buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await globalThis.crypto.subtle.sign("HMAC", secret, new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(signature));
}

export async function createSessionProof(roomSecretHex: string, roomId: string, senderId: string, nonce: string): Promise<string> {
  if (!roomId || !senderId || !/^[a-f0-9]{16,128}$/.test(nonce)) throw new RangeError("invalid proof inputs");
  return hmac(roomSecretHex, `${roomId}|${senderId}|${nonce}`);
}

export async function verifySessionProof(roomSecretHex: string, roomId: string, senderId: string, nonce: string, proofHex: string): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(proofHex)) return false;
  const expected = await createSessionProof(roomSecretHex, roomId, senderId, nonce);
  return expected === proofHex;
}
