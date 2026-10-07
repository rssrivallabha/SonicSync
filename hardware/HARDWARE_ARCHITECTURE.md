# SonicSync Hardware Architecture

## Prototype target

The first physical timing node is intentionally simple:

```
Wi-Fi
  │
ESP32-S3-WROOM / DevKitC-1
  │
  ├── I²S BCLK
  ├── I²S LRCLK
  ├── I²S DATA
  └── GPIO SYNC MARKER
  │
MAX98357A
  │
4 Ω / 3 W full-range speaker
```

The audio path stays digital until the Class-D output stage. The GPIO marker is generated from the same playback schedule used by the audio engine and is exported to a test header.

The ESP32-S3 is the preferred first node because the WROOM-2 family provides dual-core LX7 processing up to 240 MHz, 512 KB SRAM, Wi-Fi 802.11 b/g/n, Bluetooth LE 5, I²S and a rich peripheral set. ESP32-S3-WROOM-2 also supports PSRAM/flash configurations suitable for buffered audio. urlEspressif ESP32-S3-WROOM-2 datasheethttps://documentation.espressif.com/esp32-s3-wroom-2_datasheet_en.html

The official DevKitC-1 exposes the MCU I/O for breadboard/jumper prototyping and provides a 5 V to 3.3 V regulator. urlEspressif DevKitC-1 user guidehttps://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html

## Why MAX98357A for the first node

MAX98357A accepts standard I²S directly and drives the speaker without a separate analog DAC. At 5 V it is specified for up to 3.2 W into 4 Ω, supports 8–96 kHz sample rates, requires no MCLK, and includes click/pop reduction and thermal/short protection. urlAnalog Devices MAX98357A product pagehttps://www.analog.com/en/products/max98357a.html

This removes two variables from the first proof:
- external analog line-level wiring
- a separate DAC-to-amplifier clock/latency boundary

It does **not** prove the final product should use MAX98357A. It is a controlled experimental output stage.

## Reference SBC architecture

A second architecture is retained for comparison:

```
Wi-Fi
  │
Raspberry Pi Zero 2 W
  │
I²S
  │
PCM5102A / PCM5122 DAC
  │
analog line
  │
TPA3116D2 / TPA3130D2 Class-D
  │
speaker
```

Pi Zero 2 W provides a quad-core 1 GHz Cortex-A53 and 512 MB LPDDR2, plus 2.4 GHz Wi-Fi and Bluetooth 4.2/BLE. It is much easier to use for codecs, filesystems and diagnostic tooling, but Linux scheduling introduces a larger software stack between synchronization decisions and audio output. urlRaspberry Pi Zero 2 W product briefhttps://datasheets.raspberrypi.com/zero/raspberry-pi-zero-2-w-product-brief.pdf

## Hardware/clock decision

### Baseline node

Use the ESP32's supported audio-clock generation and measure it. Do not claim that the MCU oscillator is a precision shared audio clock.

### Controlled-clock experiment

Reserve a clock test interface for a future revision:

```
24.576 MHz TCXO
       │
clock buffer / divider / audio-clock generator
       │
audio DAC / codec MCLK or BCLK/LRCLK domain
```

A current India-listed option is ECS-TXO-3225MV-245.7-TR: 24.576 MHz, 2.5 ppm, 3.6 V HCMOS, 3.2 × 2.5 mm, listed around ₹205/unit at element14 India. urlelement14 India 24.576 MHz TCXO listinghttps://in.element14.com/c/crystals-oscillators/oscillators/temperature-compensated-tcxo-oscillators?frequency-nom=24.576mhz

The TCXO cannot simply be wired to an ESP32 I²S peripheral and assumed to discipline its output clock. A clock-capable audio front-end or explicit clock-conditioning architecture is required. The experiment therefore remains a separate hardware revision.

PCM5102A is useful as a reference DAC because it accepts 16/24/32-bit I²S and supports up to 384 kHz, with an integrated audio PLL using BCK as its reference and no mandatory MCLK. urlTI PCM5102A datasheethttps://www.ti.com/lit/ds/symlink/pcm5102a.pdf

PCM5122 is an alternative reference DAC family with configurable digital filtering and an audio PLL. urlTI PCM5122 datasheethttps://www.ti.com/lit/gpn/PCM5122

## Electrical synchronization marker

The node exports a dedicated 3.3 V GPIO marker.

Marker event:

```
scheduled playback target
        │
        ├── GPIO changes state
        │
        └── audio click begins in the scheduled audio buffer
```

The physical test equipment then measures the two paths independently.

The marker is an engineering measurement signal and is never represented as an end-user latency claim.

## Power architecture

Bench prototype:

```
5 V / ≥2 A regulated supply
      ├── ESP32-S3 DevKitC-1
      └── MAX98357A
```

Portable prototype:

```
3.7 V protected Li-ion
      │
power-path / boost regulator
      │
regulated 5 V rail
      ├── ESP32-S3
      └── MAX98357A
```

Battery runtime must be measured under the real audio level and radio workload; it is not inferred from nominal amplifier power alone.

## Isolation of responsibilities

The hardware node exposes:
- transport endpoint
- local media cache
- audio decoder
- audio scheduler
- sample-rate/clock information
- GPIO marker
- output-route identity
- power/thermal health
- calibration constants

The SonicSync sync core does not depend on the ESP32-specific APIs.
