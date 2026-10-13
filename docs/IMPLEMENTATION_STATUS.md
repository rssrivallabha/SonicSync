# Implementation Status

## Software implemented in the current continuation

- Shared authoritative timeline, bounded phase correction and explicit lifecycle state handling.
- NTP-like clock estimation with RTT filtering, robust offset selection, drift estimation, uncertainty and confidence.
- Versioned control envelopes and stale-command/epoch validation.
- Content-addressed media storage, hash verification, resumable transfers and queue controls.
- Browser/PWA integration using the existing LAN/WebRTC architecture.
- Android native path: Nearby Connections transport, Oboe output engine, WAV PCM decode, native scheduling and playback service.
- iOS native path: Network.framework local discovery/transport, AVAudioSession/AVAudioEngine output scheduling, clock estimator and participant state machine.
- Desktop native path: WASAPI/Core Audio/PipeWire backend scaffolding with platform-specific scheduling.
- ESP32-S3 hardware node: Wi-Fi control receiver, authenticated scheduled playback, SPIFFS WAV source, I2S output and GPIO timing marker.
- GPIO timestamp measurement fixture and measurement-analysis tooling.
- Deterministic sync simulation and performance matrix generation.
- CI/static/native/hardware source checks.

## Validation boundary

Native source and common-build validation is automated where the current Linux environment permits it. Device-level Android/iOS builds require Android SDK/NDK or Xcode on the appropriate host. ESP-IDF hardware firmware build and physical GPIO/acoustic measurements require the corresponding toolchain and hardware.

The project never treats simulation numbers as acoustic evidence and never labels software phase error as node-to-node acoustic skew.

See `BUILD_STATUS.md`, `CURRENT_STATUS.md`, `NEXT_ACTIONS.md` and `docs/RELEASE-READINESS.md` for the exact verification state.
