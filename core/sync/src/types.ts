export type PlaybackState =
  | "STOPPED"
  | "PLAYING"
  | "PAUSED"
  | "SEEKING"
  | "RESYNCING"
  | "DEGRADED"
  | "RECONNECTING"
  | "FAILED";

export interface RoomAuthority {
  readonly trackId: string | null;
  readonly trackGeneration: number;
  readonly playbackState: PlaybackState;
  readonly anchorPositionSeconds: number;
  readonly anchorTimeSeconds: number | null;
  readonly rate: number;
  readonly volume: number;
  readonly mute: boolean;
  readonly timelineEpoch: number;
  readonly revision: number;
}

export interface TimelineCommand {
  readonly kind: "PLAY" | "PAUSE" | "STOP" | "RESET" | "SEEK" | "RATE" | "VOLUME" | "MUTE";
  readonly revision: number;
  readonly timelineEpoch: number;
  readonly effectiveAtSeconds: number;
  readonly positionSeconds?: number;
  readonly rate?: number;
  readonly volume?: number;
  readonly mute?: boolean;
}

export interface ClockEstimate {
  readonly offsetSeconds: number;
  readonly driftPpm: number;
  readonly uncertaintySeconds: number;
  readonly confidence: number;
  readonly sampleCount: number;
}

export interface PlaybackObservation {
  readonly deviceId: string;
  readonly positionSeconds: number;
  readonly observedAtSeconds: number;
  readonly confidence: number;
}

export interface SyncMetrics {
  readonly minPositionSeconds: number;
  readonly maxPositionSeconds: number;
  readonly p50Seconds: number;
  readonly p90Seconds: number;
  readonly p95Seconds: number;
  readonly p99Seconds: number;
  readonly maxErrorSeconds: number;
  readonly sampleCount: number;
}
