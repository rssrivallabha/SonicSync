export interface SyncMarker {
  readonly markerId: string;
  readonly commandedAtSeconds: number;
  readonly gpioTimestampSeconds: number | null;
  readonly audioTimestampSeconds: number | null;
  readonly acousticArrivalSeconds: number | null;
}

export interface LatencyMeasurement {
  readonly commandToGpioSeconds: number | null;
  readonly gpioToAudioSeconds: number | null;
  readonly commandToAudioSeconds: number | null;
  readonly audioToAcousticSeconds: number | null;
  readonly measured: boolean;
}

export function measureMarker(marker: SyncMarker): LatencyMeasurement {
  const commandToGpio = marker.gpioTimestampSeconds === null ? null : marker.gpioTimestampSeconds - marker.commandedAtSeconds;
  const gpioToAudio = marker.gpioTimestampSeconds === null || marker.audioTimestampSeconds === null ? null : marker.audioTimestampSeconds - marker.gpioTimestampSeconds;
  const commandToAudio = marker.audioTimestampSeconds === null ? null : marker.audioTimestampSeconds - marker.commandedAtSeconds;
  const audioToAcoustic = marker.audioTimestampSeconds === null || marker.acousticArrivalSeconds === null ? null : marker.acousticArrivalSeconds - marker.audioTimestampSeconds;
  return { commandToGpioSeconds: commandToGpio, gpioToAudioSeconds: gpioToAudio, commandToAudioSeconds: commandToAudio, audioToAcousticSeconds: audioToAcoustic, measured: commandToGpio !== null || commandToAudio !== null || audioToAcoustic !== null };
}
