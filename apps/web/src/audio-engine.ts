import { ClockModel } from "../../../core/sync/src/index.js";

export interface ScheduledBuffer {
  readonly source: AudioBufferSourceNode;
  readonly audioContextTimeSeconds: number;
  readonly localMonotonicTimeSeconds: number;
}

export class WebAudioEngine {
  private readonly context: AudioContext;

  constructor() {
    this.context = new AudioContext();
  }

  async unlock(): Promise<void> {
    if (this.context.state !== "running") await this.context.resume();
  }

  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    const owned = bytes.slice(0);
    return this.context.decodeAudioData(owned);
  }

  schedule(
    buffer: AudioBuffer,
    remoteTargetSeconds: number,
    clock: ClockModel,
    outputGain = 1,
  ): ScheduledBuffer {
    if (!Number.isFinite(remoteTargetSeconds) || remoteTargetSeconds < 0) throw new RangeError("invalid remote target");
    if (!Number.isFinite(outputGain) || outputGain < 0 || outputGain > 1) throw new RangeError("invalid output gain");
    if (!clock.isLocked()) throw new Error("clock is not locked");

    const localNow = performance.now() / 1000;
    const localTarget = clock.remoteToLocal(remoteTargetSeconds);
    const delta = localTarget - localNow;
    const audioWhen = this.context.currentTime + Math.max(0, delta);

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(outputGain, audioWhen);
    source.connect(gain);
    gain.connect(this.context.destination);
    source.start(audioWhen);

    return { source, audioContextTimeSeconds: audioWhen, localMonotonicTimeSeconds: localTarget };
  }

  stop(source: AudioBufferSourceNode, whenSeconds = this.context.currentTime): void {
    source.stop(Math.max(this.context.currentTime, whenSeconds));
  }

  get currentTimeSeconds(): number { return this.context.currentTime; }
}
