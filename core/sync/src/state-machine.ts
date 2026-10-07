import { PlaybackState } from "./types.js";

export type PlayerEvent =
  | "CONNECT"
  | "AUTHENTICATE"
  | "JOIN"
  | "PREPARE"
  | "CLOCK_LOCK"
  | "SCHEDULE"
  | "PLAY"
  | "PAUSE"
  | "STOP"
  | "SEEK"
  | "RESYNC"
  | "DEGRADE"
  | "RECONNECT"
  | "FAIL"
  | "RESET"
  | "DISCONNECT";

const transitions: Readonly<Record<PlaybackState, Partial<Record<PlayerEvent, PlaybackState>>>> = {
  STOPPED: {
    CONNECT: "RECONNECTING",
    PREPARE: "STOPPED",
    PLAY: "PLAYING",
    RESET: "STOPPED",
    DISCONNECT: "RECONNECTING",
  },
  PLAYING: {
    PAUSE: "PAUSED",
    STOP: "STOPPED",
    SEEK: "SEEKING",
    RESYNC: "RESYNCING",
    DEGRADE: "DEGRADED",
    DISCONNECT: "RECONNECTING",
    FAIL: "FAILED",
  },
  PAUSED: {
    PLAY: "PLAYING",
    STOP: "STOPPED",
    SEEK: "SEEKING",
    RESYNC: "RESYNCING",
    DEGRADE: "DEGRADED",
    DISCONNECT: "RECONNECTING",
    FAIL: "FAILED",
  },
  SEEKING: {
    PLAY: "PLAYING",
    PAUSE: "PAUSED",
    FAIL: "FAILED",
  },
  RESYNCING: {
    PLAY: "PLAYING",
    PAUSE: "PAUSED",
    DEGRADE: "DEGRADED",
    FAIL: "FAILED",
  },
  DEGRADED: {
    RESYNC: "RESYNCING",
    RECONNECT: "RECONNECTING",
    PLAY: "PLAYING",
    PAUSE: "PAUSED",
    STOP: "STOPPED",
    FAIL: "FAILED",
  },
  RECONNECTING: {
    CONNECT: "STOPPED",
    AUTHENTICATE: "STOPPED",
    FAIL: "FAILED",
    DISCONNECT: "RECONNECTING",
  },
  FAILED: {
    RESET: "STOPPED",
    CONNECT: "RECONNECTING",
  },
};

export interface TransitionResult {
  readonly state: PlaybackState;
  readonly accepted: boolean;
  readonly reason: string;
}

export function transition(state: PlaybackState, event: PlayerEvent): TransitionResult {
  const next = transitions[state][event];
  if (!next) {
    return {
      state,
      accepted: false,
      reason: `invalid transition: ${state} --${event}-->`,
    };
  }

  return {
    state: next,
    accepted: true,
    reason: "accepted",
  };
}
