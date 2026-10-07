import { RoomAuthority, TimelineCommand } from "./types";

const EPSILON = 1e-9;

export function positionAt(authority: RoomAuthority, nowSeconds: number): number {
  if (!Number.isFinite(nowSeconds) || nowSeconds < 0) {
    throw new RangeError("nowSeconds must be a finite non-negative number");
  }

  if (authority.playbackState !== "PLAYING" || authority.anchorTimeSeconds === null) {
    return authority.anchorPositionSeconds;
  }

  return Math.max(
    0,
    authority.anchorPositionSeconds +
      (nowSeconds - authority.anchorTimeSeconds) * authority.rate,
  );
}

function nextAuthority(
  authority: RoomAuthority,
  patch: Partial<RoomAuthority>,
  incrementEpoch: boolean,
): RoomAuthority {
  return {
    ...authority,
    ...patch,
    timelineEpoch: authority.timelineEpoch + (incrementEpoch ? 1 : 0),
    revision: authority.revision + 1,
  };
}

export function initialAuthority(): RoomAuthority {
  return {
    trackId: null,
    trackGeneration: 0,
    playbackState: "STOPPED",
    anchorPositionSeconds: 0,
    anchorTimeSeconds: null,
    rate: 1,
    volume: 1,
    mute: false,
    timelineEpoch: 0,
    revision: 0,
  };
}

export function applyCommand(
  authority: RoomAuthority,
  command: TimelineCommand,
): RoomAuthority {
  if (command.timelineEpoch < authority.timelineEpoch) {
    return authority;
  }

  if (
    command.timelineEpoch === authority.timelineEpoch &&
    command.revision <= authority.revision
  ) {
    return authority;
  }

  switch (command.kind) {
    case "PLAY": {
      return nextAuthority(
        authority,
        {
          playbackState: "PLAYING",
          anchorPositionSeconds: command.positionSeconds ?? positionAt(authority, command.effectiveAtSeconds),
          anchorTimeSeconds: command.effectiveAtSeconds,
          rate: command.rate ?? authority.rate,
        },
        true,
      );
    }

    case "PAUSE": {
      return nextAuthority(
        authority,
        {
          playbackState: "PAUSED",
          anchorPositionSeconds: positionAt(authority, command.effectiveAtSeconds),
          anchorTimeSeconds: null,
        },
        true,
      );
    }

    case "STOP": {
      return nextAuthority(
        authority,
        {
          playbackState: "STOPPED",
          anchorPositionSeconds: positionAt(authority, command.effectiveAtSeconds),
          anchorTimeSeconds: null,
        },
        true,
      );
    }

    case "RESET": {
      return nextAuthority(
        authority,
        {
          playbackState: "STOPPED",
          anchorPositionSeconds: 0,
          anchorTimeSeconds: null,
        },
        true,
      );
    }

    case "SEEK": {
      if (command.positionSeconds === undefined || command.positionSeconds < 0) {
        throw new RangeError("SEEK requires a non-negative positionSeconds");
      }
      return nextAuthority(
        authority,
        {
          playbackState: authority.playbackState === "PLAYING" ? "PLAYING" : "PAUSED",
          anchorPositionSeconds: command.positionSeconds,
          anchorTimeSeconds:
            authority.playbackState === "PLAYING" ? command.effectiveAtSeconds : null,
        },
        true,
      );
    }

    case "RATE": {
      if (command.rate === undefined || !Number.isFinite(command.rate) || command.rate <= 0) {
        throw new RangeError("RATE requires a positive finite rate");
      }
      const position = positionAt(authority, command.effectiveAtSeconds);
      return nextAuthority(
        authority,
        {
          anchorPositionSeconds: position,
          anchorTimeSeconds:
            authority.playbackState === "PLAYING" ? command.effectiveAtSeconds : null,
          rate: command.rate,
        },
        false,
      );
    }

    case "VOLUME": {
      if (
        command.volume === undefined ||
        !Number.isFinite(command.volume) ||
        command.volume < 0 ||
        command.volume > 1
      ) {
        throw new RangeError("VOLUME must be between 0 and 1");
      }
      return nextAuthority(authority, { volume: command.volume }, false);
    }

    case "MUTE": {
      if (command.mute === undefined) {
        throw new RangeError("MUTE requires mute");
      }
      return nextAuthority(authority, { mute: command.mute }, false);
    }
  }
}

export function isApproximatelyEqual(a: number, b: number, toleranceSeconds: number): boolean {
  return Math.abs(a - b) <= toleranceSeconds + EPSILON;
}
