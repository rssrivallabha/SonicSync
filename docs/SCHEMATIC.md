# SonicSync Speaker Node Schematic / Wiring

## ESP32-S3 + MAX98357A first prototype

```text
ESP32-S3 DevKitC-1                 MAX98357A
──────────────────                ─────────
3V3  ──────────────────────────── VIN/VDD
GND  ──────────────────────────── GND
GPIO4 (I2S BCLK) ─────────────── BCLK
GPIO5 (I2S WS/LRCLK) ─────────── LRC
GPIO6 (I2S DOUT) ─────────────── DIN
GPIO7  ────────────────┐
                       └── scope / logic analyzer CH1

MAX98357A OUT+ / OUT- ─────────── 4 Ω speaker
```

Use short I2S wiring, local decoupling at the amplifier, and keep the speaker return isolated from the ESP32 ground lead where practical. Do not connect a class-D bridge output to ground.

## PCM5102A measurement variant

Use the same I2S clock/data lines into the PCM5102A and take its line-level output into the measurement chain. Do not connect the PCM5102A line output directly to a speaker.
