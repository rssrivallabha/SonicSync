import { TimelineCommand } from "./types.js";

export interface CommandOptions {
  readonly positionSeconds?: number;
  readonly rate?: number;
  readonly volume?: number;
  readonly mute?: boolean;
}

const TIMELINE_COMMANDS = new Set<TimelineCommand["kind"]>(["PLAY", "PAUSE", "STOP", "RESET", "SEEK", "RATE"]);

export class CommandSequencer {
  private revision = 0;
  private timelineEpoch = 0;

  next(kind: TimelineCommand["kind"], effectiveAtSeconds: number, options: CommandOptions = {}): TimelineCommand {
    if (!Number.isFinite(effectiveAtSeconds) || effectiveAtSeconds < 0) {
      throw new RangeError("effectiveAtSeconds must be finite and non-negative");
    }

    this.revision += 1;
    if (TIMELINE_COMMANDS.has(kind)) this.timelineEpoch += 1;

    return {
      kind,
      revision: this.revision,
      timelineEpoch: this.timelineEpoch,
      effectiveAtSeconds,
      ...options,
    };
  }

  snapshot(): { readonly revision: number; readonly timelineEpoch: number } {
    return { revision: this.revision, timelineEpoch: this.timelineEpoch };
  }
}
