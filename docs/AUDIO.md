# Audio Engine Contract

## Music mode

1. Import/fetch source.
2. Cache and verify SHA-256.
3. Decode locally.
4. Publish READY only after audio is usable.
5. Schedule local playback against the shared timeline.
6. Apply SonicSync gain, per-device trim and output-latency compensation.

## Live mode

Live microphone/external/system-audio sources require a separate low-latency transport with sequencing, jitter buffering and packet-loss handling. The current browser pilot intentionally keeps live-source capture separate from preload music playback.

## Source abstraction

Target source types: file, system mix, application source where the OS allows it, microphone, external input and live source. Protected content/DRM is never bypassed.
