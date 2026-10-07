export interface MediaChunk { readonly index: number; readonly bytes: Uint8Array; }

export class ChunkStore {
  private readonly chunks = new Map<number, Uint8Array>();

  put(chunk: MediaChunk): void {
    if (!Number.isSafeInteger(chunk.index) || chunk.index < 0) throw new RangeError("invalid chunk index");
    this.chunks.set(chunk.index, new Uint8Array(chunk.bytes));
  }

  has(index: number): boolean { return this.chunks.has(index); }
  missing(totalChunks: number): number[] {
    const result: number[] = [];
    for (let i = 0; i < totalChunks; i += 1) if (!this.chunks.has(i)) result.push(i);
    return result;
  }

  assemble(totalChunks: number): Uint8Array {
    if (!Number.isSafeInteger(totalChunks) || totalChunks < 0) throw new RangeError("invalid totalChunks");
    const missing = this.missing(totalChunks);
    if (missing.length > 0) throw new Error(`media incomplete: ${missing.join(",")}`);
    const size = Array.from(this.chunks.values()).reduce((sum, bytes) => sum + bytes.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (let i = 0; i < totalChunks; i += 1) {
      const bytes = this.chunks.get(i)!;
      output.set(bytes, offset);
      offset += bytes.length;
    }
    return output;
  }
}
