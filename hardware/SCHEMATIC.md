# SonicSync MVP Schematic

This is the breadboard/prototype wiring specification. It is not yet a production PCB schematic.

## Power

```
REGULATED 5V
   │
   ├──────── ESP32-S3 DevKitC-1 5V/VBUS
   │
   └──────── MAX98357A VIN
GND
   │
   ├──────── ESP32 GND
   ├──────── MAX98357A GND
   └──────── measurement GND where electrically safe
```

Use local 0.1 µF and bulk 100 µF decoupling near the amplifier module.

## I²S

Example GPIO assignment; actual pins must be selected from the final firmware pin map and verified against the exact DevKit revision.

```
ESP32-S3                     MAX98357A

I2S BCLK  -----------------> BCLK
I2S LRCLK ----------------> LRC
I2S DATA  ----------------> DIN
GPIO EN   ----------------> SD_MODE
GND      -----------------> GND
5V       -----------------> VIN
```

MAX98357A speaker output is bridge-tied:

```
SPK+  ───────── speaker +
SPK−  ───────── speaker −
```

Do not connect either speaker terminal to system ground.

## Measurement header

Use a dedicated 3-pin header:

```
PIN 1: SYNC_MARKER GPIO
PIN 2: 3.3V
PIN 3: GND
```

Optionally expose a second header for a safe audio-reference point in revisions that include a line-level DAC.

## Status

One LED on a non-critical GPIO:

- solid: powered
- slow blink: disconnected
- fast blink: connecting
- double pulse: synchronized
- error pattern: fault

Status indication must never run from the audio-critical interrupt path.

## Production revision

A future PCB should separate:
- radio/MCU ground return
- digital audio ground
- high-current Class-D return
- speaker current path
- measurement connector

and should provide test pads for BCLK/LRCLK, GPIO marker, supply rail and reset.
