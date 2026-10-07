# SonicSync Android

Native Android playback foundation using Oboe 1.11.0.

Current implementation:
- reads Android output sample-rate and frames-per-buffer properties
- opens an Oboe low-latency output stream
- generates a local scheduled 1 kHz test burst
- exposes native frame count and platform-reported latency
- exposes native callback failure state
- deliberately keeps compressed-media decode and room networking outside the audio callback

The project uses the Oboe 1.11.0 Prefab package from Google Maven. Current Oboe guidance uses a low-latency performance mode and data callback for the low-latency path. The Oboe 1.11.0 release also includes fixes for current NDK compatibility.

This is a native audio execution proof, not a synchronization measurement. No measured acoustic latency or sub-millisecond claim is made.
