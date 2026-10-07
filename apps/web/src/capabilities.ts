export interface BrowserAudioCapabilities {
  readonly audioContext: boolean;
  readonly webAudio: boolean;
  readonly audioOutputTimestamp: boolean;
  readonly mediaSession: boolean;
  readonly serviceWorker: boolean;
}

export function detectBrowserAudioCapabilities(): BrowserAudioCapabilities {
  const audioContext =
    "AudioContext" in globalThis || "webkitAudioContext" in globalThis;
  const webAudio = audioContext && "AudioBufferSourceNode" in globalThis;

  return {
    audioContext,
    webAudio,
    audioOutputTimestamp:
      webAudio &&
      typeof AudioContext.prototype.getOutputTimestamp === "function",
    mediaSession: "mediaSession" in navigator,
    serviceWorker: "serviceWorker" in navigator,
  };
}
