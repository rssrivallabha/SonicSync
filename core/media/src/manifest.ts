export interface TrackMetadata {
  readonly trackId: string;
  readonly hash: string;
  readonly sizeBytes: number;
  readonly durationSeconds: number;
  readonly sampleRate: number;
  readonly channels: number;
  readonly codec: string;
  readonly bitrateKbps?: number;
  readonly filename: string;
}

export function validateTrackMetadata(track: TrackMetadata): void {
  if (!/^[a-f0-9]{64}$/.test(track.hash)) throw new RangeError("hash must be a SHA-256 hex string");
  if (!track.trackId || track.trackId.length > 256) throw new RangeError("invalid trackId");
  if (!track.filename || track.filename.includes("..") || track.filename.includes("/") || track.filename.includes("\\")) throw new RangeError("unsafe filename");
  if (!Number.isSafeInteger(track.sizeBytes) || track.sizeBytes < 0) throw new RangeError("invalid sizeBytes");
  if (!Number.isFinite(track.durationSeconds) || track.durationSeconds < 0) throw new RangeError("invalid durationSeconds");
  if (!Number.isFinite(track.sampleRate) || track.sampleRate <= 0) throw new RangeError("invalid sampleRate");
  if (!Number.isSafeInteger(track.channels) || track.channels < 1) throw new RangeError("invalid channels");
  if (!track.codec || track.codec.length > 64) throw new RangeError("invalid codec");
}
