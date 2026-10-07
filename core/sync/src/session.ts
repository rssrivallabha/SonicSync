import { PlaybackState, RoomAuthority } from "./types";

export type ConnectionState = "DISCONNECTED" | "DISCOVERING" | "CONNECTING" | "AUTHENTICATING" | "CONNECTED" | "DEGRADED" | "RECONNECTING" | "FAILED";

export interface Readiness {
  readonly mediaReady: boolean;
  readonly decoderReady: boolean;
  readonly audioEngineReady: boolean;
  readonly clockReady: boolean;
  readonly outputReady: boolean;
}

export interface SessionState {
  readonly connection: ConnectionState;
  readonly playback: PlaybackState;
  readonly readiness: Readiness;
  readonly roomEpoch: number;
  readonly trackGeneration: number;
  readonly authority: RoomAuthority;
}

export function emptyReadiness(): Readiness {
  return { mediaReady: false, decoderReady: false, audioEngineReady: false, clockReady: false, outputReady: false };
}

export function requiredReady(readiness: Readiness): boolean {
  return readiness.mediaReady && readiness.decoderReady && readiness.audioEngineReady && readiness.clockReady && readiness.outputReady;
}

export function initialSession(): SessionState {
  return {
    connection: "DISCONNECTED",
    playback: "STOPPED",
    readiness: emptyReadiness(),
    roomEpoch: 0,
    trackGeneration: 0,
    authority: { trackId: null, trackGeneration: 0, playbackState: "STOPPED", anchorPositionSeconds: 0, anchorTimeSeconds: null, rate: 1, volume: 1, mute: false, timelineEpoch: 0, revision: 0 },
  };
}
