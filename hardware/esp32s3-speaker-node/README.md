# ESP32-S3 SonicSync Speaker Node

## What this build actually implements

- ESP32-S3 Wi-Fi control plane.
- 48 kHz / 16-bit stereo I2S output.
- Local PCM16 WAV media from SPIFFS at `/spiffs/test.wav`.
- Future scheduled start using `hostTimeUs` plus `clockOffsetUs`.
- GPIO7 measurement marker on the first output buffer after the scheduled start.
- 440 Hz fallback timing tone when no compatible WAV is present.

This is a deterministic timing/physical reference node, not a claim of production compressed-audio decoding. Full-format media belongs on the Raspberry Pi-class SoC reference until an MCU decoder is validated.

## Build

Install ESP-IDF 5.x, then:

```bash
idf.py set-target esp32s3
idf.py menuconfig
# SonicSync Speaker Node → set Wi-Fi SSID and password
idf.py build
idf.py flash monitor
```

Place a PCM16, 48 kHz WAV at `test.wav` in a SPIFFS image under `/spiffs` during the lab build, or use the fallback tone for timing-only validation.

## Wiring

```text
ESP32 GPIO4 → MAX98357A BCLK
ESP32 GPIO5 → MAX98357A LRC/WS
ESP32 GPIO6 → MAX98357A DIN
ESP32 3V3    → MAX98357A VIN/VDD
ESP32 GND    → MAX98357A GND
MAX98357A OUT+ / OUT- → 4 Ω speaker
ESP32 GPIO7 → oscilloscope / logic analyzer marker
```
