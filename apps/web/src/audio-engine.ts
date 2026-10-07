import { ClockModel } from "../../../core/sync/src/index.js";

export interface ScheduledBuffer {
  readonly source: AudioBufferSourceNode;
  readonly audioContextTimeSeconds: number;
  readonly localMonotonicTimeSeconds: number;
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  const scope = globalThis as unknown as {
    readonly AudioContext?: AudioContextConstructor;
    readonly webkitAudioContext?: AudioContextConstructor;
  };

  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export class WebAudioEngine {
  private context: AudioContext | null = null;

  private requireContext(): AudioContext {
    if (this.context === null) {
      throw new Error("audio is locked; user activation is required");
    }
    return this.context;
  }

  async unlock(): Promise<void> {
    if (this.context === null) {
      const Constructor = getAudioContextConstructor();
      if (Constructor === null) {
        throw new Error("Web Audio API is unavailable");
      }
      this.context = new Constructor();
    }

    if (this.context.state !== "running") {
      await this.context.resume();
    }
  }

  async decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
    return this.requireContext().decodeAudioData(bytes.slice(0));
  }

  schedule(
    buffer: AudioBuffer,
    remoteTargetSeconds: number,
    clock: ClockModel,
    outputGain = 1,
  ): ScheduledBuffer {
    const context = this.requireContext();

    if (!Number.isFinite(remoteTargetSeconds) || remoteTargetSeconds < 0) {
      throw new RangeError("invalid remote target");
    }
    if (!Number.isFinite(outputGain) || outputGain < 0 || outputGain > 1) {
      throw new RangeError("invalid output gain");
    }
    if (!clock.isLocked()) {
      throw new Error("clock is not locked");
    }

    const localNow = performance.now() / 1000;
    const localTarget = clock.remoteToLocal(remoteTargetSeconds);
    const delta = localTarget - localNow;
    const audioWhen = context.currentTime + Math.max(0, delta);

    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(outputGain, audioWhen);
    source.connect(gain);
    gain.connect(context.destination);
    source.start(audioWhen);

    return {
      source,
      audioContextTimeSeconds: audioWhen,
      localMonotonicTimeSeconds: localTarget,
    };
  }

  stop(source: AudioBufferSourceNode, whenSeconds?: number): void {
    const context = this.requireContext();
    const when = whenSeconds ?? context.currentTime;
    source.stop(Math.max(context.currentTime, when));
  }

  get currentTimeSeconds(): number {
    return this.requireContext().currentTime;
  }

  get outputTimestamp(): AudioTimestamp | null {
    const context = this.requireContext();
    return typeof context.getOutputTimestamp === "function"
      ? context.getOutputTimestamp()
      : null;
  }

  async close(): Promise<void> {
    if (this.context !== null) {
      await this.context.close();
      this.context = null;
    }
  }
}
