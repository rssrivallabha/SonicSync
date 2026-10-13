# Android Native Track — v10

Status: **source implemented; integration-ready; device build not executable in the current Linux container**.

The native playback stack is intentionally not a browser wrapper:

- Discovery/nearby transport: Google Nearby Connections `P2P_CLUSTER`.
- Audio output: Oboe 1.11.0 at 48 kHz float output, low-latency/exclusive requested, callback-driven.
- Monotonic clock model: `SystemClock.elapsedRealtimeNanos()` with NTP-style t1/t2/t3/t4 samples.
- Foreground media playback service is present for lifecycle handling.
- Native WAV PCM16 reader is included as the deterministic validation media path.

The Android low-latency path follows the current Oboe guidance: low-latency performance mode, exclusive mode when available, 48 kHz, data callbacks, and no blocking work inside the callback. citeturn820368search0

The current Google Play services Nearby artifact is 19.5.1 as of September 28, 2026. citeturn850302search12turn850302search4
