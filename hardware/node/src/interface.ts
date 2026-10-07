export type AudioRoute = "BUILT_IN" | "WIRED" | "USB" | "BLUETOOTH" | "HDMI" | "OTHER";

export interface HardwareNodeCapabilities {
  readonly nodeId: string;
  readonly sampleRates: readonly number[];
  readonly channels: number;
  readonly audioRoute: AudioRoute;
  readonly hardwareTimestamp: boolean;
  readonly gpioTestOutput: boolean;
  readonly estimatedPowerWatts: number;
}

export interface HardwareNode {
  getCapabilities(): HardwareNodeCapabilities;
  connect(endpoint: string): Promise<void>;
  disconnect(): Promise<void>;
  preload(trackId: string, bytes: Uint8Array): Promise<void>;
  arm(targetTimeSeconds: number, positionSeconds: number): Promise<void>;
  setVolume(linearGain: number): Promise<void>;
  setMute(muted: boolean): Promise<void>;
  emitSyncMarker(timestampSeconds: number): Promise<void>;
  getHealth(): Promise<{
    underruns: number;
    cpuPercent?: number;
    temperatureC?: number;
    supplyVolts?: number;
  }>;
}
