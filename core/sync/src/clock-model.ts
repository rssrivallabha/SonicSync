import { ClockFit } from "./clock.js";

export class ClockModel {
  private fit: ClockFit = { offsetSeconds: 0, driftPpm: 0, uncertaintySeconds: Number.POSITIVE_INFINITY, confidence: 0 };
  private lockedAtLocalSeconds: number | null = null;

  update(fit: ClockFit, localReferenceSeconds: number): void {
    if (!Number.isFinite(localReferenceSeconds) || localReferenceSeconds < 0) throw new RangeError("invalid localReferenceSeconds");
    if (!Number.isFinite(fit.offsetSeconds) || !Number.isFinite(fit.driftPpm) || !Number.isFinite(fit.uncertaintySeconds) || fit.uncertaintySeconds < 0 || fit.confidence < 0 || fit.confidence > 1) {
      throw new RangeError("invalid clock fit");
    }
    this.fit = fit;
    this.lockedAtLocalSeconds = localReferenceSeconds;
  }

  isLocked(): boolean {
    return this.lockedAtLocalSeconds !== null && this.fit.confidence > 0;
  }

  localToRemote(localSeconds: number): number {
    if (!this.isLocked() || this.lockedAtLocalSeconds === null) throw new Error("clock is not locked");
    const delta = localSeconds - this.lockedAtLocalSeconds;
    return localSeconds + this.fit.offsetSeconds + (this.fit.driftPpm / 1e6) * delta;
  }

  remoteToLocal(remoteSeconds: number): number {
    if (!this.isLocked() || this.lockedAtLocalSeconds === null) throw new Error("clock is not locked");
    const drift = this.fit.driftPpm / 1e6;
    return (remoteSeconds - this.fit.offsetSeconds + drift * this.lockedAtLocalSeconds) / (1 + drift);
  }

  uncertaintySeconds(): number {
    return this.fit.uncertaintySeconds;
  }

  confidence(): number {
    return this.fit.confidence;
  }

  snapshot(): ClockFit {
    return { ...this.fit };
  }
}
