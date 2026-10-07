export interface AudioClock {
  nowSeconds(): number;
}

export interface ScheduledPlayback {
  readonly targetTimeSeconds: number;
  readonly targetPositionSeconds: number;
  readonly timelineEpoch: number;
  readonly commandRevision: number;
}

export type ScheduleDecision =
  | { readonly kind: "WAIT"; readonly remainingSeconds: number }
  | { readonly kind: "START"; readonly schedule: ScheduledPlayback }
  | { readonly kind: "STALE"; readonly schedule: ScheduledPlayback };

export class PlaybackScheduler {
  private scheduled: ScheduledPlayback | null = null;

  arm(schedule: ScheduledPlayback): void {
    if (!Number.isFinite(schedule.targetTimeSeconds) || !Number.isFinite(schedule.targetPositionSeconds) || schedule.targetTimeSeconds < 0 || schedule.targetPositionSeconds < 0) {
      throw new RangeError("invalid playback schedule");
    }
    this.scheduled = { ...schedule };
  }

  invalidate(): void {
    this.scheduled = null;
  }

  inspect(nowSeconds: number, currentEpoch: number, currentRevision: number): ScheduleDecision {
    if (this.scheduled === null) throw new Error("no playback schedule armed");
    if (this.scheduled.timelineEpoch < currentEpoch || (this.scheduled.timelineEpoch === currentEpoch && this.scheduled.commandRevision < currentRevision)) {
      return { kind: "STALE", schedule: { ...this.scheduled } };
    }
    if (nowSeconds < this.scheduled.targetTimeSeconds) {
      return { kind: "WAIT", remainingSeconds: this.scheduled.targetTimeSeconds - nowSeconds };
    }
    return { kind: "START", schedule: { ...this.scheduled } };
  }

  current(): ScheduledPlayback | null {
    return this.scheduled === null ? null : { ...this.scheduled };
  }
}
