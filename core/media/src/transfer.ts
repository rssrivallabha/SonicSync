import { ChunkStore, MediaChunk } from "./chunk-store";

export interface TransferPlan {
  readonly totalBytes: number;
  readonly chunkSizeBytes: number;
  readonly totalChunks: number;
}

export function createTransferPlan(totalBytes: number, chunkSizeBytes: number): TransferPlan {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) throw new RangeError("invalid totalBytes");
  if (!Number.isSafeInteger(chunkSizeBytes) || chunkSizeBytes <= 0) throw new RangeError("invalid chunkSizeBytes");
  return {
    totalBytes,
    chunkSizeBytes,
    totalChunks: Math.ceil(totalBytes / chunkSizeBytes),
  };
}

export function putVerifiedChunk(plan: TransferPlan, store: ChunkStore, chunk: MediaChunk): void {
  if (chunk.index < 0 || chunk.index >= plan.totalChunks) throw new RangeError("chunk index outside transfer plan");
  if (chunk.bytes.length > plan.chunkSizeBytes) throw new RangeError("chunk exceeds configured chunk size");
  const isLast = chunk.index === plan.totalChunks - 1;
  const minimumLastSize = plan.totalBytes - plan.chunkSizeBytes * Math.max(0, plan.totalChunks - 1);
  const expectedLength = isLast ? Math.max(0, minimumLastSize) : plan.chunkSizeBytes;
  if (plan.totalChunks > 0 && chunk.bytes.length !== expectedLength) throw new RangeError("chunk length does not match plan");
  store.put(chunk);
}

export function transferComplete(plan: TransferPlan, store: ChunkStore): boolean {
  return store.missing(plan.totalChunks).length === 0;
}
