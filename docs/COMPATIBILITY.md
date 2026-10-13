# Compatibility

## Web / PWA

Modern Chromium, Edge, Firefox and Safari are the browser baseline. iOS web playback remains subject to WebKit audio-activation and route constraints; the native iOS path is the serious playback target.

## Native platforms

Android: Nearby Connections + Oboe/AAudio path, with platform permissions and audio-focus/background constraints.

iOS/iPadOS: Network.framework + AVAudioSession/AVAudioEngine, with Local Network permission, interruptions, route changes and background constraints.

Windows: WASAPI output backend.

macOS: Core Audio output backend.

Linux: PipeWire output backend when the development/runtime environment provides it.

## Audio routes

Speaker, wired, Bluetooth, USB, HDMI and AirPlay-like routes can have different output latency. Route changes invalidate acoustic calibration and must trigger a fresh route/latency measurement before making tight skew claims.

## Capture/source limitations

System/application/microphone capture must use supported OS APIs. Protected-content/DRM restrictions are not bypassed. Unsupported capture sources are surfaced as explicit capability errors.
