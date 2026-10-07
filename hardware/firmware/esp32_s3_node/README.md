# SonicSync ESP32-S3 Speaker Node Firmware

Prototype target: ESP32-S3 DevKitC-1 + MAX98357A + 4 ohm / 3 W speaker.

## Runtime path

Wi-Fi UDP
-> PCM packet buffer
-> PSRAM ring buffer when available, with internal-RAM fallback for the N8 board
-> I2S
-> MAX98357A
-> speaker

The node supports:
- Wi-Fi connection and reconnection
- local PCM buffering
- scheduled playback start
- test-click scheduling
- volume
- mute
- status LED
- packet/drop/underrun counters
- GPIO synchronization marker

## Packet format

The packet begins with a fixed 32-byte little-endian C struct:

- magic
- protocol version
- type
- sequence
- sample rate
- channel count
- frame count
- target monotonic microsecond time
- command
- command value

PCM packets carry signed 16-bit stereo PCM at 48 kHz.

## Commands

PLAY schedules buffered PCM at the supplied target time.

STOP clears the scheduled timeline and PCM buffer.

VOLUME sets 0–100%.

MUTE toggles output gain.

TEST_CLICK generates a short 1 kHz burst at the supplied target time.

## Measurement marker

GPIO 4 is used as the SYNC_MARKER test output. It is intentionally exposed independently of the speaker output so a scope or logic analyzer can compare the marker with an electrically safe audio reference.

The marker is a software-side scheduling marker, not a hardware timestamp. The purpose of the first prototype is to measure the resulting uncertainty.

## Security boundary

This firmware currently uses an unauthenticated UDP prototype protocol. It must only be used on a controlled laboratory network. Authenticated/encrypted transport is required before deployment on shared networks.

## Build

Use PlatformIO with the ESP32-S3 DevKitC-1 target.

Set Wi-Fi credentials in include/config.h, then run:

pio run

To flash:

pio run -t upload

Serial monitor:

pio device monitor

Hardware build and acoustic measurements are separate from firmware compilation.
