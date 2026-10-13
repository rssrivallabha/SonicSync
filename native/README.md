# SonicSync Native Track

This directory contains native playback/transport implementations that share the same SonicSync room/timeline contract as the web client.

## Android

`native/android` uses Google Nearby Connections for nearby/local peer transport and Oboe for a low-latency 48 kHz native playback engine. PCM media is decoded on-device and scheduled against a monotonic deadline; the browser is not used as the production audio engine.

## iOS / iPadOS

`native/ios/SonicSyncIOS` uses Network.framework for Bonjour discovery/local TCP transport and AVAudioSession + AVAudioEngine + AVAudioPlayerNode for native playback scheduling. Route changes and output latency are exposed to the sync layer.

## Desktop

`native/desktop` contains platform backends for WASAPI on Windows, Core Audio on macOS, and PipeWire on Linux. The CMake build explicitly reports when a platform audio development SDK is unavailable; it never treats that case as a working runtime backend.

## Verification boundary

Source-level checks run in the Node validation suite. Swift parsing/package-manifest checks and Linux CMake compilation are executable in the current environment. Final Android/iOS/device-specific validation still requires the corresponding SDK/toolchain and physical hardware. Acoustic skew, output latency, drift, and calibration values must be measured rather than inferred.
